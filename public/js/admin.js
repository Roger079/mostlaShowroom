const socket = io();
const tabControl = document.getElementById('tab-control');
const tabContent = document.getElementById('tab-content');
const tabScreens = document.getElementById('tab-screens');

const panelControl = document.getElementById('panel-control');
const panelContent = document.getElementById('panel-content');
const panelScreens = document.getElementById('panel-screens');
const btnEn = document.getElementById('btn-en');
const btnEs = document.getElementById('btn-es');
const currentLangEl = document.getElementById('current-lang');
const listEl = document.getElementById('display-list');
const contentTypeEl = document.getElementById('content-type');
const contentScreenTypeEl = document.getElementById('content-screen-type');
const contentProviderEl = document.getElementById('content-provider');
const contentLinkEnEl = document.getElementById('content-link-en');
const contentLinkEsEl = document.getElementById('content-link-es');
const contentPngEnEl = document.getElementById('content-png-en');
const contentPngEsEl = document.getElementById('content-png-es');
const saveContentBtn = document.getElementById('save-content-btn');
const contentMessageEl = document.getElementById('content-message');
const contentListEl = document.getElementById('content-list');
const linkFieldsEl = document.getElementById('link-fields');
const pngFieldsEl = document.getElementById('png-fields');

const screenIdInputEl = document.getElementById('screen-id-input');
const screenDefaultTypeEl = document.getElementById('screen-default-type');
const saveScreenBtn = document.getElementById('save-screen-btn');
const screenMessageEl = document.getElementById('screen-message');
const screenListEl = document.getElementById('screen-list');

let currentLang = 'en';
let screenTypes = [];
let connectedDisplays = [];
let customContents = [];

// Authentication State & UI
let adminToken = sessionStorage.getItem('adminToken') || '';
const loginOverlay = document.getElementById('login-overlay');
const loginForm = document.getElementById('login-form');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');

/**
 * Constructs HTTP request headers incorporating the active admin session token.
 * @returns {{ Authorization: string, 'Content-Type': string }} Authorization and content-type headers.
 */
function authHeaders() {
  return {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  };
}

/**
 * Displays the full-screen admin login overlay modal and focuses the password input.
 * @returns {void}
 */
function showLoginOverlay() {
  loginOverlay.style.display = 'flex';
  logoutBtn.style.display = 'none';
  loginPassword.value = '';
  loginError.textContent = '';
  setTimeout(() => loginPassword.focus(), 100);
}

/**
 * Hides the admin login overlay modal and shows the logout button.
 * @returns {void}
 */
function hideLoginOverlay() {
  loginOverlay.style.display = 'none';
  logoutBtn.style.display = 'inline-block';
}

/**
 * Verifies current admin authentication token with backend endpoint `/api/auth-check`.
 * Toggles login overlay depending on authentication status.
 * @returns {Promise<boolean>} True if authenticated, false otherwise.
 */
async function checkAuth() {
  if (!adminToken) {
    showLoginOverlay();
    return false;
  }
  try {
    const res = await fetch('/api/auth-check', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (data.authenticated) {
      hideLoginOverlay();
      return true;
    }
  } catch (err) {
    console.error('Auth check failed:', err);
  }
  showLoginOverlay();
  return false;
}

/**
 * Handles admin login form submission. Sends password to backend and stores returned auth token.
 */
loginForm.onsubmit = async (e) => {
  e.preventDefault();
  const password = loginPassword.value;
  loginError.textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      adminToken = data.token;
      sessionStorage.setItem('adminToken', adminToken);
      hideLoginOverlay();
      refreshAdminData().catch((err) => setContentMessage(err.message, true));
    } else {
      loginError.textContent = data.error || 'Invalid password';
    }
  } catch (err) {
    loginError.textContent = 'Connection error. Please try again.';
  }
};

/**
 * Handles admin logout action. Invalidate backend session and clear stored session token.
 */
logoutBtn.onclick = async () => {
  if (adminToken) {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
    } catch (e) { }
  }
  adminToken = '';
  sessionStorage.removeItem('adminToken');
  showLoginOverlay();
};

/**
 * Sanitizes strings to prevent XSS vulnerabilities when inserting dynamic content into HTML.
 * @param {*} value - Input value to sanitize.
 * @returns {string} HTML-escaped string.
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Updates UI state elements for active language selection ('en' or 'es').
 * @param {'en'|'es'} lang - Selected language code.
 * @returns {void}
 */
function setActive(lang) {
  currentLang = lang;
  btnEn.classList.toggle('active', lang === 'en');
  btnEs.classList.toggle('active', lang === 'es');
  currentLangEl.textContent = lang === 'en' ? 'English' : 'Español';
}

/**
 * Switches active visible admin tab panel ('control' or 'content').
 * @param {'control'|'content'} tabName - Target tab name.
 * @returns {void}
 */
function showTab(tabName) {
  tabControl.classList.toggle('active', tabName === 'control');
  tabContent.classList.toggle('active', tabName === 'content');
  if (tabScreens) tabScreens.classList.toggle('active', tabName === 'screens');
  panelControl.classList.toggle('active', tabName === 'control');
  panelContent.classList.toggle('active', tabName === 'content');
  if (panelScreens) panelScreens.classList.toggle('active', tabName === 'screens');
}

/**
 * Generates HTML `<option>` markup for screen type drop-down selectors.
 * @param {string} selectedType - Currently selected screen type key.
 * @returns {string} HTML string containing `<option>` elements.
 */
function getScreenTypeOptions(selectedType) {
  return screenTypes
    .map(type => {
      const selected = type === selectedType ? ' selected' : '';
      return `<option value="${type}"${selected}>${type}</option>`;
    })
    .join('');
}

/**
 * Renders the custom content library entries into the content panel DOM element.
 * @returns {void}
 */
function renderContentList() {
  if (customContents.length === 0) {
    contentListEl.innerHTML = '<span class="muted">No content yet.</span>';
    return;
  }

  contentListEl.innerHTML = customContents
    .map(content => {
      const completeness = content.hasEnglish && content.hasSpanish ? 'ready' : 'missing language';
      const provider = content.provider ? ` / ${escapeHtml(content.provider)}` : '';
      return `
        <div class="content-card">
          <div><strong>${escapeHtml(content.screenType)}</strong> — ${escapeHtml(content.source)}${provider}</div>
          <div class="muted">Status: ${escapeHtml(completeness)}</div>
          <div class="content-actions">
            <button class="danger delete-content-btn" data-screen-type="${escapeHtml(content.screenType)}">Delete</button>
          </div>
        </div>
      `;
    })
    .join('');
}

/**
 * Renders the list of active connected displays into the control panel DOM element.
 * @returns {void}
 */
function renderDisplayList() {
  if (connectedDisplays.length === 0) {
    listEl.innerHTML = '<span id="empty">No displays configured yet</span>';
    return;
  }

  listEl.innerHTML = connectedDisplays
    .map(d => {
      const isOnline = Boolean(d.connected);
      const dotColor = isOnline ? '#0F6E56' : '#94a3b8';
      const statusLabel = isOnline ? 'online' : 'offline';
      return `
        <div class="display-row" style="opacity: ${isOnline ? '1' : '0.65'};">
          <span><span class="dot" style="background: ${dotColor};"></span>${escapeHtml(d.screenId)} <span class="muted">(${statusLabel})</span></span>
          <select class="screen-type-select" data-screen-id="${escapeHtml(d.screenId)}" data-socket-id="${d.socketId || ''}">
            ${getScreenTypeOptions(d.screenType)}
          </select>
        </div>
      `;
    })
    .join('');
}

/**
 * Displays status or error feedback message to the user in the admin content tab.
 * @param {string} message - Message text to display.
 * @param {boolean} isError - True if error message (red styling), false if success/info.
 * @returns {void}
 */
function setContentMessage(message, isError) {
  contentMessageEl.textContent = message;
  contentMessageEl.style.color = isError ? '#a20000' : '#0F6E56';
}

/**
 * Normalizes client-side input string into a slugified screen type key.
 * @param {string} value - Raw screen type input string.
 * @returns {string} Cleaned screen type slug key.
 */
function normalizeScreenType(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Asynchronously reads a local File object and converts it into a Base64 Data URL.
 * @param {File} file - Local file object to read.
 * @returns {Promise<string>} Data URL representation of file content.
 */
async function readFileAsDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Unable to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Safely extracts error message from fetch response, handling JSON and non-JSON (HTML/text) error bodies.
 * @param {Response} response - Fetch response object.
 * @param {string} fallbackMsg - Default error message if parsing fails.
 * @returns {Promise<string>} Detailed error message.
 */
async function getErrorMessage(response, fallbackMsg = 'Request failed') {
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await response.json();
      if (body && body.error) return body.error;
    }
    if (response.status === 413) {
      return 'File size exceeds server upload limit (max 500MB).';
    }
    const text = await response.text();
    if (text && text.trim() && !text.startsWith('<!DOCTYPE') && !text.startsWith('<html')) {
      return text.trim();
    }
  } catch (_) {}
  return `${fallbackMsg} (${response.status} ${response.statusText || ''})`.trim();
}

/**
 * Fetches valid screen types from `/screen-types` endpoint and populates `screenTypes` state array.
 * @returns {Promise<void>}
 */
async function loadScreenTypes() {
  const response = await fetch('/screen-types');
  if (!response.ok) {
    throw new Error(`Failed to load screen types: ${response.status}`);
  }

  const text = await response.text();
  screenTypes = text
    .split(',')
    .map(type => type.trim())
    .filter(Boolean);

  if (screenDefaultTypeEl) {
    screenDefaultTypeEl.innerHTML = getScreenTypeOptions();
  }
}

/**
 * Fetches custom content library entries from `/custom-contents` endpoint and re-renders content list.
 * @returns {Promise<void>}
 */
async function loadCustomContents() {
  const response = await fetch('/custom-contents');
  if (!response.ok) {
    throw new Error(`Failed to load content library: ${response.status}`);
  }
  customContents = await response.json();
  renderContentList();
}

/**
 * Synchronizes all admin panel data by reloading screen types, custom content library, and display states.
 * @returns {Promise<void>}
 */
async function refreshAdminData() {
  await Promise.all([loadScreenTypes(), loadCustomContents()]);
  renderDisplayList();
  renderScreenRoster();
  socket.emit('request-display-list');
}

/**
 * Renders configured screen roster into the screens panel DOM element.
 */
function renderScreenRoster() {
  if (!screenListEl) return;
  if (connectedDisplays.length === 0) {
    screenListEl.innerHTML = '<span class="muted">No rostered screens configured.</span>';
    return;
  }

  screenListEl.innerHTML = connectedDisplays
    .map(d => {
      const isOnline = Boolean(d.connected);
      const dotColor = isOnline ? '#0F6E56' : '#94a3b8';
      const statusLabel = isOnline ? 'online' : 'offline';
      return `
        <div class="content-card" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div>
            <span class="dot" style="background: ${dotColor};"></span>
            <strong>${escapeHtml(d.screenId)}</strong>
            <span class="muted">(${statusLabel})</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <label class="muted" style="font-size: 13px;">Default:</label>
            <select class="roster-type-select" data-screen-id="${escapeHtml(d.screenId)}">
              ${getScreenTypeOptions(d.screenType)}
            </select>
            <button class="danger delete-screen-btn" data-screen-id="${escapeHtml(d.screenId)}">Delete</button>
          </div>
        </div>
      `;
    })
    .join('');
}

function setScreenMessage(message, isError) {
  if (!screenMessageEl) return;
  screenMessageEl.textContent = message;
  screenMessageEl.style.color = isError ? '#a20000' : '#0F6E56';
}

async function saveScreen(screenIdParam, defaultScreenTypeParam) {
  const screenId = normalizeScreenType(screenIdParam || (screenIdInputEl ? screenIdInputEl.value : ''));
  const defaultScreenType = defaultScreenTypeParam || (screenDefaultTypeEl ? screenDefaultTypeEl.value : '');
  if (!screenId) {
    throw new Error('Screen ID is required');
  }
  if (!defaultScreenType) {
    throw new Error('Default screen type is required');
  }
  const response = await fetch('/api/screens', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ screenId, defaultScreenType })
  });
  if (!response.ok) {
    const errMsg = await getErrorMessage(response, 'Unable to save screen');
    throw new Error(errMsg);
  }
}

async function deleteScreen(screenId) {
  const response = await fetch(`/api/screens/${encodeURIComponent(screenId)}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  if (!response.ok) {
    const errMsg = await getErrorMessage(response, 'Unable to delete screen');
    throw new Error(errMsg);
  }
}

/**
 * Toggles visibility of link input fields vs. PNG file upload fields based on content type drop-down.
 * @returns {void}
 */
function updateContentFields() {
  const isLink = contentTypeEl.value === 'link';
  linkFieldsEl.style.display = isLink ? '' : 'none';
  pngFieldsEl.style.display = isLink ? 'none' : '';
}

/**
 * Sends HTTP POST request to `/custom-contents/link` to create/update external URL link content.
 * @param {string} screenType - Screen type key to attach content link to.
 * @returns {Promise<void>}
 */
async function saveLinkContent(screenType) {
  const rawUrlEn = contentLinkEnEl.value.trim();
  const rawUrlEs = contentLinkEsEl.value.trim();
  const urlEn = rawUrlEn || rawUrlEs;
  const urlEs = rawUrlEs || rawUrlEn;

  if (!urlEn && !urlEs) {
    throw new Error('Please provide at least one URL (English or Spanish)');
  }

  const payload = {
    screenType,
    provider: contentProviderEl.value,
    urlEn,
    urlEs
  };
  const response = await fetch('/custom-contents/link', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errMsg = await getErrorMessage(response, 'Unable to save link content');
    throw new Error(errMsg);
  }
}

/**
 * Reads English and/or Spanish media files and uploads them.
 * Automatically duplicates content for both languages if only one file is uploaded.
 * @param {string} screenType - Screen type key to attach media files to.
 * @returns {Promise<void>}
 */
async function savePngContent(screenType) {
  const fileEn = contentPngEnEl.files[0];
  const fileEs = contentPngEsEl.files[0];

  if (!fileEn && !fileEs) {
    throw new Error('Please select at least one media file (English or Spanish)');
  }

  const uploadEn = fileEn || fileEs;
  const uploadEs = fileEs || fileEn;

  const dataUrlEn = await readFileAsDataUrl(uploadEn);
  const responseEn = await fetch('/custom-contents/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      screenType,
      language: 'en',
      fileName: uploadEn.name,
      dataUrl: dataUrlEn
    })
  });
  if (!responseEn.ok) {
    const errMsg = await getErrorMessage(responseEn, 'Unable to upload EN media file');
    throw new Error(errMsg);
  }

  const dataUrlEs = (uploadEs === uploadEn) ? dataUrlEn : await readFileAsDataUrl(uploadEs);
  const responseEs = await fetch('/custom-contents/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      screenType,
      language: 'es',
      fileName: uploadEs.name,
      dataUrl: dataUrlEs
    })
  });
  if (!responseEs.ok) {
    const errMsg = await getErrorMessage(responseEs, 'Unable to upload ES media file');
    throw new Error(errMsg);
  }
}

/**
 * Validates form inputs and saves content (either external link or PNG asset files) to the backend.
 * @returns {Promise<void>}
 */
async function saveContent() {
  const screenType = normalizeScreenType(contentScreenTypeEl.value);
  if (!screenType) {
    throw new Error('Content key is required');
  }
  if (contentTypeEl.value === 'link') {
    await saveLinkContent(screenType);
  } else {
    await savePngContent(screenType);
  }
}

/**
 * Sends HTTP DELETE request to `/custom-contents/:screenType` to remove a content library entry.
 * @param {string} screenType - Screen type key to delete.
 * @returns {Promise<void>}
 */
async function deleteContent(screenType) {
  const response = await fetch(`/custom-contents/${encodeURIComponent(screenType)}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  if (!response.ok) {
    const errMsg = await getErrorMessage(response, 'Unable to delete content');
    throw new Error(errMsg);
  }
}

btnEn.onclick = () => socket.emit('set-language', { lang: 'en', token: adminToken });
btnEs.onclick = () => socket.emit('set-language', { lang: 'es', token: adminToken });
tabControl.onclick = () => showTab('control');
tabContent.onclick = () => showTab('content');
if (tabScreens) tabScreens.onclick = () => showTab('screens');
contentTypeEl.onchange = updateContentFields;

saveContentBtn.onclick = async () => {
  saveContentBtn.disabled = true;
  setContentMessage('Saving content…', false);
  try {
    await saveContent();
    await refreshAdminData();
    setContentMessage('Content saved successfully.', false);
  } catch (error) {
    setContentMessage(error.message, true);
  } finally {
    saveContentBtn.disabled = false;
  }
};

if (saveScreenBtn) {
  saveScreenBtn.onclick = async () => {
    saveScreenBtn.disabled = true;
    setScreenMessage('Saving screen…', false);
    try {
      await saveScreen();
      await refreshAdminData();
      if (screenIdInputEl) screenIdInputEl.value = '';
      setScreenMessage('Screen saved successfully.', false);
    } catch (error) {
      setScreenMessage(error.message, true);
    } finally {
      saveScreenBtn.disabled = false;
    }
  };
}

/**
 * Socket Event: connect
 * Requests current language state and connected display list on connection.
 */
socket.on('connect', () => {
  socket.emit('request-state');
  socket.emit('request-display-list');
});

socket.on('language-changed', setActive);
socket.on('content-library-changed', () => {
  refreshAdminData().catch((error) => setContentMessage(error.message, true));
});

/**
 * Event Listener: Display Screen Type Select Dropdown Change
 * Emits `set-display-screen-type` to server when admin changes a display's assigned screen type.
 */
listEl.addEventListener('change', (event) => {
  const select = event.target.closest('.screen-type-select');
  if (!select) return;

  socket.emit('set-display-screen-type', {
    screenId: select.dataset.screenId,
    socketId: select.dataset.socketId,
    screenType: select.value,
    token: adminToken
  });
});

/**
 * Socket Event: display-list
 * Updates connected displays state array and re-renders display list UI.
 */
socket.on('display-list', (displays) => {
  connectedDisplays = displays;
  renderDisplayList();
  renderScreenRoster();
});

/**
 * Event Listener: Delete Content Library Button Click
 * Handles deletion of custom content items from the library list view.
 */
contentListEl.addEventListener('click', async (event) => {
  const button = event.target.closest('.delete-content-btn');
  if (!button) return;

  const screenType = button.dataset.screenType;
  if (!screenType) return;

  button.disabled = true;
  setContentMessage(`Deleting ${screenType}…`, false);
  try {
    await deleteContent(screenType);
    await refreshAdminData();
    setContentMessage(`Deleted ${screenType}.`, false);
  } catch (error) {
    setContentMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

if (screenListEl) {
  screenListEl.addEventListener('click', async (event) => {
    const button = event.target.closest('.delete-screen-btn');
    if (!button) return;

    const screenId = button.dataset.screenId;
    if (!screenId) return;

    button.disabled = true;
    setScreenMessage(`Deleting ${screenId}…`, false);
    try {
      await deleteScreen(screenId);
      await refreshAdminData();
      setScreenMessage(`Deleted ${screenId}.`, false);
    } catch (error) {
      setScreenMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  screenListEl.addEventListener('change', async (event) => {
    const select = event.target.closest('.roster-type-select');
    if (!select) return;

    const screenId = select.dataset.screenId;
    const defaultScreenType = select.value;
    select.disabled = true;
    setScreenMessage(`Updating default content for ${screenId}…`, false);
    try {
      await saveScreen(screenId, defaultScreenType);
      await refreshAdminData();
      setScreenMessage(`Updated default content for ${screenId}.`, false);
    } catch (error) {
      setScreenMessage(error.message, true);
    } finally {
      select.disabled = false;
    }
  });
}

checkAuth().then((authenticated) => {
  if (authenticated) {
    refreshAdminData().catch((error) => setContentMessage(error.message, true));
  }
});
