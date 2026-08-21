const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json({ limit: '15mb' }));

// ---- In-memory state ----
// Current global language. This is what fixes the "reconnect shows stale
// language" problem: any display that connects (or reconnects) fetches
// this value immediately instead of waiting for the next toggle.
let currentLanguage = 'en';
const customContentPath = path.join(__dirname, 'data', 'custom-content.json');
const greetingConfigPath = path.join(__dirname, 'data', 'greeting-config.json');
const customLinks = new Map();

let greetingState = {
  enabled: false,
  name: 'Guest',
  titleEn: 'Welcome',
  titleEs: '¡Bienvenido!',
  subtitleEn: '',
  subtitleEs: ''
};

// Track connected displays so the admin panel can show who's online.
// Map of socket.id -> { screenId, screenType, connectedAt }
const displays = new Map();

function ensureDataDirectory() {
  const dir = path.dirname(customContentPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeScreenType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized;
}

function parseContentLanguage(contentName) {
  const match = contentName.match(/^(.*)-([a-z]{2}(?:-[a-z]{2})?)$/i);
  if (!match) return null;
  return { prefix: match[1], lang: match[2].toLowerCase() };
}

function addLanguageEntry(map, key, language) {
  if (!map.has(key)) {
    map.set(key, new Set());
  }
  map.get(key).add(language);
}

function loadCustomLinks() {
  ensureDataDirectory();
  if (!fs.existsSync(customContentPath)) {
    fs.writeFileSync(customContentPath, JSON.stringify({ links: [] }, null, 2), 'utf8');
    return;
  }

  const fileContents = fs.readFileSync(customContentPath, 'utf8');
  const parsed = JSON.parse(fileContents);
  const links = Array.isArray(parsed.links) ? parsed.links : [];
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
}

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

function loadGreetingConfig() {
  ensureDataDirectory();
  if (!fs.existsSync(greetingConfigPath)) {
    saveGreetingConfig();
    return;
  }

  try {
    const raw = fs.readFileSync(greetingConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    greetingState = {
      enabled: Boolean(parsed.enabled),
      name: String(parsed.name || '').trim(),
      titleEn: String(parsed.titleEn || 'Welcome').trim(),
      titleEs: String(parsed.titleEs || '¡Bienvenido!').trim(),
      subtitleEn: String(parsed.subtitleEn || '').trim(),
      subtitleEs: String(parsed.subtitleEs || '').trim()
    };
  } catch (err) {
    console.error('Failed to load greeting config:', err.message);
  }
}

function saveGreetingConfig() {
  ensureDataDirectory();
  fs.writeFileSync(greetingConfigPath, JSON.stringify(greetingState, null, 2), 'utf8');
}

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

function getScreenTypes() {
  const assetMap = getAssetsByScreenType();
  const allTypes = new Map(assetMap);

  for (const [screenType, config] of customLinks.entries()) {
    if (config.urls.en && config.urls.es) {
      addLanguageEntry(allTypes, screenType, 'en');
      addLanguageEntry(allTypes, screenType, 'es');
    }
  }

  const screenTypes = [];
  for (const [prefix, languages] of allTypes.entries()) {
    if (languages.has('en') && languages.has('es')) {
      screenTypes.push(prefix);
    }
  }
  return screenTypes.sort();
}
  


function getDefaultScreenType(screenId) {
  const screenTypes = getScreenTypes();
  const normalizedScreenId = normalizeScreenType(screenId);
  if (screenTypes.includes(normalizedScreenId)) {
    return normalizedScreenId;
  }
  return screenTypes[0] || normalizedScreenId;
}

function broadcastDisplayList() {
  const list = Array.from(displays.values()).map(d => ({
    socketId: d.socketId,
    screenId: d.screenId,
    screenType: d.screenType,
    connectedAt: d.connectedAt
  }));
  io.emit('display-list', list);
}

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

app.get('/screen-types', (_req, res) => {
  res.type('text/plain').send(getScreenTypes().join(','));
});

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

app.post('/custom-contents/link', (req, res) => {
  const screenType = normalizeScreenType(req.body?.screenType);
  const provider = String(req.body?.provider || 'link').trim().toLowerCase();
  const urlEn = String(req.body?.urlEn || '').trim();
  const urlEs = String(req.body?.urlEs || '').trim();

  if (!screenType) {
    return res.status(400).json({ error: 'screenType is required' });
  }
  if (!urlEn || !urlEs) {
    return res.status(400).json({ error: 'urlEn and urlEs are required' });
  }
  if (!URL.canParse(urlEn) || !URL.canParse(urlEs)) {
    return res.status(400).json({ error: 'Both URLs must be valid' });
  }

  customLinks.set(screenType, {
    provider,
    urls: { en: urlEn, es: urlEs }
  });
  saveCustomLinks();
  io.emit('content-library-changed');
  return res.status(201).json({ ok: true, screenType });
});

app.post('/custom-contents/png', (req, res) => {
  const screenType = normalizeScreenType(req.body?.screenType);
  const language = String(req.body?.language || '').trim().toLowerCase();
  const dataUrl = String(req.body?.dataUrl || '');

  if (!screenType) {
    return res.status(400).json({ error: 'screenType is required' });
  }
  if (language !== 'en' && language !== 'es') {
    return res.status(400).json({ error: 'language must be en or es' });
  }
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    return res.status(400).json({ error: 'Only base64 PNG uploads are supported' });
  }

  const base64Payload = dataUrl.substring('data:image/png;base64,'.length);
  if (!base64Payload) {
    return res.status(400).json({ error: 'PNG payload is empty' });
  }

  const outputName = `${screenType}-${language}.png`;
  const outputPath = path.join(__dirname, 'public', 'assets', outputName);
  const outputBuffer = Buffer.from(base64Payload, 'base64');
  fs.writeFileSync(outputPath, outputBuffer);
  io.emit('content-library-changed');
  return res.status(201).json({ ok: true, file: outputName });
});

app.delete('/custom-contents/:screenType', (req, res) => {
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

app.get('/greeting-config', (_req, res) => {
  res.json(greetingState);
});

app.post('/greeting-config', (req, res) => {
  const data = req.body || {};
  greetingState = {
    enabled: Boolean(data.enabled),
    name: String(data.name || '').trim(),
    titleEn: String(data.titleEn || 'Welcome').trim(),
    titleEs: String(data.titleEs || '¡Bienvenido!').trim(),
    subtitleEn: String(data.subtitleEn || '').trim(),
    subtitleEs: String(data.subtitleEs || '').trim()
  };
  saveGreetingConfig();
  io.emit('greeting-changed', greetingState);
  return res.json({ ok: true, greeting: greetingState });
});

loadCustomLinks();
loadGreetingConfig();

io.on('connection', (socket) => {
  // A client tells us what kind of client it is right after connecting.
  socket.on('register-display', (payload) => {
    const displayId = typeof payload === 'object' && payload
      ? payload.displayId || payload.screenId || payload.screenType
      : payload;
    const requestedScreenType = typeof payload === 'object' && payload
      ? payload.screenType
      : null;
    const screenType = getDefaultScreenType(requestedScreenType || displayId);
    displays.set(socket.id, {
      socketId: socket.id,
      screenId: String(displayId || socket.id),
      screenType,
      connectedAt: Date.now()
    });
    socket.emit('display-config', { screenType, language: currentLanguage, content: getContentConfig(screenType), greeting: greetingState });
    broadcastDisplayList();
  });

  // Any client (display or admin) can ask for current state on load/reconnect.
  socket.on('request-state', () => {
    socket.emit('language-changed', currentLanguage);
    socket.emit('greeting-changed', greetingState);
  });

  socket.on('set-greeting', (data) => {
    if (typeof data !== 'object' || !data) return;
    greetingState = {
      enabled: Boolean(data.enabled),
      name: String(data.name || '').trim(),
      titleEn: String(data.titleEn || 'Welcome').trim(),
      titleEs: String(data.titleEs || '¡Bienvenido!').trim(),
      subtitleEn: String(data.subtitleEn || '').trim(),
      subtitleEs: String(data.subtitleEs || '').trim()
    };
    saveGreetingConfig();
    io.emit('greeting-changed', greetingState);
  });

  socket.on('request-display-list', () => {
    const list = Array.from(displays.values()).map(d => ({
      socketId: d.socketId,
      screenId: d.screenId,
      screenType: d.screenType,
      connectedAt: d.connectedAt
    }));
    socket.emit('display-list', list);
  });

  // Admin panel emits this when someone clicks English / Español.
  socket.on('set-language', (lang) => {
    if (lang !== 'en' && lang !== 'es') return; // basic validation
    currentLanguage = lang;
    io.emit('language-changed', currentLanguage);
  });

  socket.on('set-display-screen-type', ({ socketId, screenType }) => {
    const display = displays.get(socketId);
    if (!display) return;

    const validScreenTypes = getScreenTypes();
    if (!validScreenTypes.includes(screenType)) return;

    display.screenType = screenType;
    displays.set(socketId, display);
    io.to(socketId).emit('screen-type-changed', { screenType, content: getContentConfig(screenType) });
    broadcastDisplayList();
  });

  socket.on('disconnect', () => {
    if (displays.has(socket.id)) {
      displays.delete(socket.id);
      broadcastDisplayList();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signage hub running at http://localhost:${PORT}`);
  console.log(`Admin panel:   http://localhost:${PORT}/admin.html`);
  console.log(`Display demo:  http://localhost:${PORT}/display.html?screen=screen1`);
});
