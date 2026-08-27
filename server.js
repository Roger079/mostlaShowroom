const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use((_req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});
app.use(express.static('public'));
app.use(express.json({ limit: '15mb' }));

// ---- Security & Authentication ----
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const activeSessions = new Set();

/**
 * Generates a cryptographically secure session token for admin authentication.
 * @returns {string} A 64-character hexadecimal session token.
 */
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Extracts the session token from an HTTP request.
 * Checks Bearer Authorization header, 'x-admin-token' header, or 'token' query param.
 * @param {import('express').Request} req - Express request object.
 * @returns {string|null} Extracted token if present, otherwise null.
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (req.headers['x-admin-token']) {
    return req.headers['x-admin-token'];
  }
  if (req.query && req.query.token) {
    return req.query.token;
  }
  return null;
}

/**
 * Checks whether a given session token is valid and active.
 * @param {string|null} token - Token string to validate.
 * @returns {boolean} True if token exists in active sessions, false otherwise.
 */
function isValidToken(token) {
  return Boolean(token && activeSessions.has(token));
}

/**
 * Express middleware requiring a valid admin authorization token.
 * Responds with 401 Unauthorized if the token is missing or invalid.
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express next middleware callback.
 * @returns {void|import('express').Response}
 */
function requireAdminAuth(req, res, next) {
  const token = extractToken(req);
  if (!isValidToken(token)) {
    return res.status(401).json({ error: 'Unauthorized: Valid admin token required' });
  }
  next();
}

/**
 * Checks if a Socket.IO connection or payload is authenticated with a valid admin token.
 * @param {import('socket.io').Socket} socket - Socket.IO socket instance.
 * @param {string|null} [payloadToken] - Optional token passed in event payload.
 * @returns {boolean} True if socket connection or payload contains a valid admin token.
 */
function isSocketAuthenticated(socket, payloadToken) {
  const token = socket.handshake.auth?.token || payloadToken;
  return isValidToken(token);
}

// ---- In-memory state ----
// Current global language. This is what fixes the "reconnect shows stale
// language" problem: any display that connects (or reconnects) fetches
// this value immediately instead of waiting for the next toggle.
let currentLanguage = 'en';
const customContentPath = path.join(__dirname, 'data', 'custom-content.json');
const screensPath = path.join(__dirname, 'data', 'screens.json');
const customLinks = new Map();

// Track pre-registered displays from screens.json so the admin panel shows online/offline status.
// Map of screenId -> { screenId, screenType, connected, socketId, connectedAt }
const displays = new Map();

/**
 * Ensures that the data storage directory (`data/`) exists.
 * @returns {void}
 */
function ensureDataDirectory() {
  const dir = path.dirname(customContentPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Normalizes a raw screen type identifier into a valid slugified key.
 * Removes invalid characters, converts to lowercase, and trims leading/trailing dashes.
 * @param {string} value - Raw screen type identifier.
 * @returns {string} Normalized screen type key.
 */
function normalizeScreenType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized;
}



function saveScreens() {
  ensureDataDirectory();
  const payload = {
    screens: Array.from(displays.values()).map(d => ({
      name: d.screenId,
      defaultScreenType: d.screenType
    }))
  };
  fs.writeFileSync(screensPath, JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * Parses a content name to extract its base prefix and language code suffix.
 * Example: "promo-en" -> { prefix: "promo", lang: "en" }.
 * @param {string} contentName - File base name or content key.
 * @returns {{ prefix: string, lang: string }|null} Object containing prefix and lang, or null if no match.
 */
function parseContentLanguage(contentName) {
  const match = contentName.match(/^(.*)-([a-z]{2}(?:-[a-z]{2})?)$/i);
  if (!match) return null;
  return { prefix: match[1], lang: match[2].toLowerCase() };
}

/**
 * Helper to add a language code to the Set of languages associated with a screen type key.
 * @param {Map<string, Set<string>>} map - Target map mapping screen types to language Sets.
 * @param {string} key - Screen type key.
 * @param {string} language - Language code (e.g., 'en', 'es').
 * @returns {void}
 */
function addLanguageEntry(map, key, language) {
  if (!map.has(key)) {
    map.set(key, new Set());
  }
  map.get(key).add(language);
}

/**
 * Loads custom content links from disk (`data/custom-content.json`) into the `customLinks` Map.
 * Creates an empty file if it does not exist.
 * @returns {void}
 */
function loadCustomLinks() {
  ensureDataDirectory();
  const defaultData = { links: [] };
  if (!fs.existsSync(customContentPath)) {
    fs.writeFileSync(customContentPath, JSON.stringify(defaultData, null, 2), 'utf8');
    return;
  }

  try {
    const fileContents = fs.readFileSync(customContentPath, 'utf8');
    if (!fileContents.trim()) {
      throw new SyntaxError('File is empty');
    }
    const parsed = JSON.parse(fileContents);
    const links = Array.isArray(parsed?.links) ? parsed.links : [];
    customLinks.clear();
    for (const link of links) {
      const screenType = normalizeScreenType(link.screenType);
      if (!screenType) continue;
      if (!link.urls || typeof link.urls.en !== 'string' || typeof link.urls.es !== 'string') continue;
      customLinks.set(screenType, {
        provider: link.provider || 'link',
        urls: {
          en: link.urls.en.trim(),
          es: link.urls.es.trim()
        }
      });
    }
  } catch (err) {
    console.error('Error loading custom-content.json, re-initializing default data:', err.message);
    fs.writeFileSync(customContentPath, JSON.stringify(defaultData, null, 2), 'utf8');
    customLinks.clear();
  }
}

/**
 * Loads pre-defined screen roster from `data/screens.json` into `displays` Map.
 * Initializes all screens as offline (`connected: false`).
 * @returns {void}
 */
function loadScreens() {
  ensureDataDirectory();
  const defaultData = {
    screens: [
      { name: 'screen1', defaultScreenType: 'telepresencia' }
    ]
  };

  if (!fs.existsSync(screensPath)) {
    fs.writeFileSync(screensPath, JSON.stringify(defaultData, null, 2), 'utf8');
  }

  try {
    const fileContents = fs.readFileSync(screensPath, 'utf8');
    if (!fileContents.trim()) {
      throw new SyntaxError('File is empty');
    }
    const parsed = JSON.parse(fileContents);
    const screensList = Array.isArray(parsed?.screens) ? parsed.screens : [];
    displays.clear();
    for (const screen of screensList) {
      const screenId = String(screen.name || '').trim();
      if (!screenId) continue;
      const screenType = getDefaultScreenType(screen.defaultScreenType || screenId);
      displays.set(screenId, {
        screenId,
        screenType,
        connected: false,
        socketId: null,
        connectedAt: null
      });
    }
  } catch (err) {
    console.error('Error loading screens.json, re-initializing default data:', err.message);
    fs.writeFileSync(screensPath, JSON.stringify(defaultData, null, 2), 'utf8');
    displays.clear();
    displays.set('screen1', {
      screenId: 'screen1',
      screenType: getDefaultScreenType('telepresencia'),
      connected: false,
      socketId: null,
      connectedAt: null
    });
  }
}

/**
 * Saves current custom link configurations from `customLinks` Map to `data/custom-content.json`.
 * @returns {void}
 */
function saveCustomLinks() {
  ensureDataDirectory();
  const payload = {
    links: Array.from(customLinks.entries()).map(([screenType, config]) => ({
      screenType,
      provider: config.provider,
      urls: config.urls
    }))
  };
  fs.writeFileSync(customContentPath, JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * Scans the `public/assets` directory for static image assets and maps screen types to available languages.
 * @returns {Map<string, Set<string>>} Map of screen type keys to Sets of language codes.
 */
function getAssetsByScreenType() {
  const assetsDir = path.join(__dirname, 'public', 'assets');
  const result = new Map();
  if (!fs.existsSync(assetsDir)) {
    return result;
  }

  const files = fs.readdirSync(assetsDir, { withFileTypes: true });
  for (const file of files) {
    if (!file.isFile()) continue;
    const baseName = path.parse(file.name).name;
    const parsed = parseContentLanguage(baseName);
    if (!parsed) continue;
    addLanguageEntry(result, parsed.prefix, parsed.lang);
  }
  return result;
}

/**
 * Aggregates all valid screen types from static assets and custom link configurations.
 * Only returns screen types that have complete bilingual coverage (both 'en' and 'es').
 * @returns {string[]} Alphabetically sorted array of valid screen type keys.
 */
function getScreenTypes() {
  const assetMap = getAssetsByScreenType();
  const allTypes = new Map(assetMap);

  for (const [screenType, config] of customLinks.entries()) {
    if (config.urls.en || config.urls.es) {
      if (config.urls.en) addLanguageEntry(allTypes, screenType, 'en');
      if (config.urls.es) addLanguageEntry(allTypes, screenType, 'es');
    }
  }

  const screenTypes = [];
  for (const [prefix, languages] of allTypes.entries()) {
    if (languages.has('en') || languages.has('es')) {
      screenTypes.push(prefix);
    }
  }
  return screenTypes.sort();
}

/**
 * Resolves the default screen type for a connected display given a requested screen ID/type.
 * Fallbacks to the requested ID if matching, or the first available screen type.
 * @param {string} screenId - Screen ID or screen type requested by the client.
 * @returns {string} Resolved valid screen type.
 */
function getDefaultScreenType(screenId) {
  const screenTypes = getScreenTypes();
  const normalizedScreenId = normalizeScreenType(screenId);
  if (screenTypes.includes(normalizedScreenId)) {
    return normalizedScreenId;
  }
  return screenTypes[0] || normalizedScreenId;
}

/**
 * Broadcasts the current list of rostered displays and connection statuses to all Socket.IO clients.
 * @returns {void}
 */
function broadcastDisplayList() {
  const list = Array.from(displays.values()).map(d => ({
    socketId: d.socketId,
    screenId: d.screenId,
    screenType: d.screenType,
    connected: Boolean(d.connected),
    connectedAt: d.connectedAt
  }));
  io.emit('display-list', list);
}

/**
 * Finds asset filenames for a specific screen type in `public/assets`.
 * @param {string} screenType - Screen type key.
 * @returns {Object<string, string>} Object mapping language code to filename (e.g. { en: 'screen1-en.png', es: 'screen1-es.png' }).
 */
function getAssetFiles(screenType) {
  const assetsDir = path.join(__dirname, 'public', 'assets');
  const files = {};
  if (!fs.existsSync(assetsDir)) {
    return files;
  }

  const dirFiles = fs.readdirSync(assetsDir, { withFileTypes: true });
  for (const file of dirFiles) {
    if (!file.isFile()) continue;
    const baseName = path.parse(file.name).name;
    const parsed = parseContentLanguage(baseName);
    if (parsed && parsed.prefix === screenType) {
      files[parsed.lang] = file.name;
    }
  }
  return files;
}

/**
 * Generates the content configuration object for a given screen type.
 * Returns custom link details if configured, or static image asset mappings.
 * @param {string} screenType - Screen type key.
 * @returns {Object} Content configuration object specifying type ('link' or 'asset') and associated URLs or asset filenames.
 */
function getContentConfig(screenType) {
  const linkConfig = customLinks.get(screenType);
  if (linkConfig) {
    return {
      type: 'link',
      provider: linkConfig.provider,
      urls: linkConfig.urls
    };
  }
  return {
    type: 'asset',
    files: getAssetFiles(screenType)
  };
}

// ---- Auth Endpoints ----

/**
 * POST /api/login
 * Admin authentication endpoint. Validates password and generates session token.
 */
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    const token = generateSessionToken();
    activeSessions.add(token);
    return res.json({ ok: true, token });
  }
  return res.status(401).json({ error: 'Invalid admin password' });
});

/**
 * POST /api/logout
 * Admin logout endpoint. Revokes and removes the session token.
 */
app.post('/api/logout', (req, res) => {
  const token = extractToken(req);
  if (token) {
    activeSessions.delete(token);
  }
  return res.json({ ok: true });
});

/**
 * GET /api/auth-check
 * Session check endpoint. Verifies if current session token is valid.
 */
app.get('/api/auth-check', (req, res) => {
  const token = extractToken(req);
  return res.json({ authenticated: isValidToken(token) });
});

/**
 * GET /api/screens
 * Returns JSON array of all rostered displays.
 */
app.get('/api/screens', (_req, res) => {
  return res.json(Array.from(displays.values()));
});

/**
 * POST /api/screens
 * Admin endpoint to add a new display screen or update an existing screen's default screen type.
 */
app.post('/api/screens', requireAdminAuth, (req, res) => {
  const rawId = String(req.body?.screenId || '').trim();
  const screenKey = normalizeScreenType(rawId);
  const defaultScreenType = normalizeScreenType(req.body?.defaultScreenType);

  if (!screenKey) {
    return res.status(400).json({ error: 'Valid screenId is required' });
  }
  if (!defaultScreenType) {
    return res.status(400).json({ error: 'defaultScreenType is required' });
  }
  if (!getScreenTypes().includes(defaultScreenType)) {
    return res.status(400).json({ error: `Invalid screen type: "${defaultScreenType}"` });
  }

  const existing = displays.get(screenKey);
  if (existing) {
    existing.screenType = defaultScreenType;
  } else {
    displays.set(screenKey, {
      screenId: screenKey,
      screenType: defaultScreenType,
      connected: false,
      socketId: null,
      connectedAt: null
    });
  }

  saveScreens();
  broadcastDisplayList();
  return res.status(existing ? 200 : 201).json({ ok: true, screenId: screenKey, updated: Boolean(existing) });
});

/**
 * DELETE /api/screens/:screenId
 * Admin endpoint to delete a display screen from the roster.
 */
app.delete('/api/screens/:screenId', requireAdminAuth, (req, res) => {
  const screenKey = normalizeScreenType(req.params.screenId);
  if (!screenKey) {
    return res.status(400).json({ error: 'Valid screenId is required' });
  }
  if (!displays.has(screenKey)) {
    return res.status(404).json({ error: 'Screen not found in roster' });
  }

  displays.delete(screenKey);
  saveScreens();
  broadcastDisplayList();
  return res.json({ ok: true, screenId: screenKey });
});

// ---- Content & Display API Endpoints ----

/**
 * GET /screen-types
 * Returns a plain text comma-separated list of all valid screen types.
 */
app.get('/screen-types', (_req, res) => {
  res.type('text/plain').send(getScreenTypes().join(','));
});

/**
 * GET /custom-contents
 * Returns JSON array of all available content library entries (assets & custom links).
 */
app.get('/custom-contents', (_req, res) => {
  const assets = getAssetsByScreenType();
  const rows = [];

  for (const [screenType, languages] of assets.entries()) {
    rows.push({
      screenType,
      source: 'asset',
      hasEnglish: languages.has('en'),
      hasSpanish: languages.has('es')
    });
  }

  for (const [screenType, linkConfig] of customLinks.entries()) {
    rows.push({
      screenType,
      source: 'link',
      provider: linkConfig.provider,
      hasEnglish: Boolean(linkConfig.urls.en),
      hasSpanish: Boolean(linkConfig.urls.es)
    });
  }

  rows.sort((a, b) => a.screenType.localeCompare(b.screenType));
  res.json(rows);
});

/**
 * POST /custom-contents/link
 * Admin endpoint to add or update an external link content entry.
 */
app.post('/custom-contents/link', requireAdminAuth, (req, res) => {
  const screenType = normalizeScreenType(req.body?.screenType);
  const provider = String(req.body?.provider || 'link').trim().toLowerCase();
  const rawUrlEn = String(req.body?.urlEn || '').trim();
  const rawUrlEs = String(req.body?.urlEs || '').trim();

  const urlEn = rawUrlEn || rawUrlEs;
  const urlEs = rawUrlEs || rawUrlEn;

  if (!screenType) {
    return res.status(400).json({ error: 'screenType is required' });
  }
  if (!urlEn && !urlEs) {
    return res.status(400).json({ error: 'At least one URL (English or Spanish) is required' });
  }
  if ((urlEn && !URL.canParse(urlEn)) || (urlEs && !URL.canParse(urlEs))) {
    return res.status(400).json({ error: 'Provided URLs must be valid' });
  }

  customLinks.set(screenType, {
    provider,
    urls: { en: urlEn, es: urlEs }
  });
  saveCustomLinks();
  io.emit('content-library-changed');
  return res.status(201).json({ ok: true, screenType });
});

/**
 * Resolves file extension for media uploads from filename or dataUrl mime-type.
 * @param {string} fileName - Uploaded file name.
 * @param {string} dataUrl - Data URL string.
 * @returns {string} File extension string (e.g. 'mkv', 'mp4', 'png').
 */
function getFileExtension(fileName, dataUrl) {
  if (fileName) {
    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    if (ext) return ext;
  }
  const match = dataUrl.match(/^data:([^;]+);base64,/);
  if (match) {
    const mime = match[1].toLowerCase();
    if (mime.includes('matroska') || mime.includes('mkv')) return 'mkv';
    if (mime.includes('video/mp4')) return 'mp4';
    if (mime.includes('video/webm')) return 'webm';
    if (mime.includes('video/quicktime')) return 'mov';
    if (mime.includes('video/x-msvideo')) return 'avi';
    if (mime.includes('image/png')) return 'png';
    if (mime.includes('image/jpeg')) return 'jpg';
    if (mime.includes('image/gif')) return 'gif';
    if (mime.includes('image/webp')) return 'webp';
    if (mime.includes('image/svg')) return 'svg';
  }
  return 'png';
}

/**
 * Handles uploading media asset files (images & videos including MKV, MP4, WEBM, PNG).
 */
function handleMediaUpload(req, res) {
  const screenType = normalizeScreenType(req.body?.screenType);
  const language = String(req.body?.language || '').trim().toLowerCase();
  const dataUrl = String(req.body?.dataUrl || '');
  const fileName = String(req.body?.fileName || '').trim();

  if (!screenType) {
    return res.status(400).json({ error: 'screenType is required' });
  }
  if (language !== 'en' && language !== 'es') {
    return res.status(400).json({ error: 'language must be en or es' });
  }
  if (!dataUrl.includes(';base64,')) {
    return res.status(400).json({ error: 'Valid base64 data URL is required' });
  }

  const base64Payload = dataUrl.split(';base64,')[1];
  if (!base64Payload) {
    return res.status(400).json({ error: 'File payload is empty' });
  }

  const ext = getFileExtension(fileName, dataUrl);
  const assetsDir = path.join(__dirname, 'public', 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  // Remove existing asset files matching screenType and language prefix to avoid conflicts
  const existingFiles = fs.readdirSync(assetsDir);
  for (const f of existingFiles) {
    const parsed = parseContentLanguage(path.parse(f).name);
    if (parsed && parsed.prefix === screenType && parsed.lang === language) {
      try { fs.unlinkSync(path.join(assetsDir, f)); } catch (_) {}
    }
  }

  const outputName = `${screenType}-${language}.${ext}`;
  const outputPath = path.join(assetsDir, outputName);
  const outputBuffer = Buffer.from(base64Payload, 'base64');
  fs.writeFileSync(outputPath, outputBuffer);
  io.emit('content-library-changed');
  return res.status(201).json({ ok: true, file: outputName });
}

/**
 * POST /custom-contents/media & /custom-contents/png
 * Admin endpoints to upload image/video assets (MKV, MP4, PNG, etc.) as Base64 payloads.
 */
app.post('/custom-contents/media', requireAdminAuth, handleMediaUpload);
app.post('/custom-contents/png', requireAdminAuth, handleMediaUpload);

/**
 * DELETE /custom-contents/:screenType
 * Admin endpoint to delete a content entry (custom link or image asset files).
 */
app.delete('/custom-contents/:screenType', requireAdminAuth, (req, res) => {
  const screenType = normalizeScreenType(req.params.screenType);
  if (!screenType) {
    return res.status(400).json({ error: 'screenType is required' });
  }

  let deleted = false;
  if (customLinks.delete(screenType)) {
    saveCustomLinks();
    deleted = true;
  }

  const assetsDir = path.join(__dirname, 'public', 'assets');
  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile()) continue;
      const baseName = path.parse(file.name).name;
      const parsed = parseContentLanguage(baseName);
      if (!parsed) continue;
      if (parsed.prefix === screenType) {
        fs.unlinkSync(path.join(assetsDir, file.name));
        deleted = true;
      }
    }
  }

  if (!deleted) {
    return res.status(404).json({ error: 'Content not found' });
  }

  io.emit('content-library-changed');
  return res.json({ ok: true });
});

loadCustomLinks();
loadScreens();

/**
 * Socket.IO Real-Time Connection Manager
 * Listens for client connections (displays and admin panels) and handles events.
 */
io.on('connection', (socket) => {
  /**
   * Event: register-display
   * Sent by display instances to announce presence and receive configuration.
   * Only allows connections from screens defined in screens.json.
   */
  socket.on('register-display', (payload) => {
    const displayId = typeof payload === 'object' && payload
      ? payload.displayId || payload.screenId || payload.screenType
      : payload;

    const screenKey = String(displayId || '').trim();
    const display = displays.get(screenKey);

    if (!display) {
      console.warn(`[Socket] Connection rejected for unregistered display: "${displayId}"`);
      socket.emit('error', { message: `Display "${displayId}" is not registered in screens.json` });
      return;
    }

    const requestedScreenType = typeof payload === 'object' && payload
      ? payload.screenType
      : null;
    const screenType = getDefaultScreenType(requestedScreenType || display.screenType);

    display.connected = true;
    display.socketId = socket.id;
    display.connectedAt = Date.now();
    display.screenType = screenType;

    displays.set(screenKey, display);

    socket.emit('display-config', { screenType, language: currentLanguage, content: getContentConfig(screenType) });
    broadcastDisplayList();
  });

  /**
   * Event: request-state
   * Sent by clients requesting current global language state.
   */
  socket.on('request-state', () => {
    socket.emit('language-changed', currentLanguage);
  });

  /**
   * Event: request-display-list
   * Sent by admin panel to fetch current display list.
   */
  socket.on('request-display-list', () => {
    broadcastDisplayList();
  });

  /**
   * Event: set-language
   * Emitted by admin panel to change global display language ('en' or 'es').
   */
  socket.on('set-language', (payload) => {
    const lang = typeof payload === 'object' && payload ? payload.lang : payload;
    const token = typeof payload === 'object' && payload ? payload.token : null;
    if (!isSocketAuthenticated(socket, token)) return;
    if (lang !== 'en' && lang !== 'es') return; // basic validation
    currentLanguage = lang;
    io.emit('language-changed', currentLanguage);
  });

  /**
   * Event: set-display-screen-type
   * Emitted by admin panel to reassign screen type to a display.
   */
  socket.on('set-display-screen-type', (payload) => {
    if (typeof payload !== 'object' || !payload) return;
    const { socketId, screenId, screenType, token } = payload;
    if (!isSocketAuthenticated(socket, token)) return;

    let targetDisplay = null;
    if (screenId && displays.has(screenId)) {
      targetDisplay = displays.get(screenId);
    } else if (socketId) {
      targetDisplay = Array.from(displays.values()).find(d => d.socketId === socketId);
    }
    if (!targetDisplay) return;

    const validScreenTypes = getScreenTypes();
    if (!validScreenTypes.includes(screenType)) return;

    targetDisplay.screenType = screenType;
    displays.set(targetDisplay.screenId, targetDisplay);
    saveScreens();

    if (targetDisplay.socketId) {
      io.to(targetDisplay.socketId).emit('screen-type-changed', { screenType, content: getContentConfig(screenType) });
    }
    broadcastDisplayList();
  });

  /**
   * Event: disconnect
   * Updates screen connection status to offline when a display disconnects.
   */
  socket.on('disconnect', () => {
    for (const [screenId, display] of displays.entries()) {
      if (display.socketId === socket.id) {
        display.connected = false;
        display.socketId = null;
        displays.set(screenId, display);
        broadcastDisplayList();
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signage hub running at http://localhost:${PORT}`);
  console.log(`Admin panel:   http://localhost:${PORT}/admin.html`);
  console.log(`Display demo:  http://localhost:${PORT}/display.html?screen=screen1`);
});
