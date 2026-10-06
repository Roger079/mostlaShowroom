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
 * Toast Notification System
 */
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;
  const icon = type === 'success' ? '✔' : type === 'error' ? '✖' : 'ℹ';
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-msg">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 15);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, 2800);
}

/**
 * Constructs HTTP request headers incorporating the active admin session token.
 */
function authHeaders() {
  return {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  };
}

/**
 * Displays the full-screen admin login overlay modal.
 */
function showLoginOverlay() {
  loginOverlay.style.display = 'flex';
  if (logoutBtn) logoutBtn.style.display = 'none';
  loginPassword.value = '';
  loginError.textContent = '';
  setTimeout(() => loginPassword.focus(), 100);
}

/**
 * Hides the admin login overlay modal.
 */
function hideLoginOverlay() {
  loginOverlay.style.display = 'none';
  if (logoutBtn) logoutBtn.style.display = 'inline-block';
}

/**
 * Verifies current admin authentication token with backend endpoint `/api/auth-check`.
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
      showToast('Sesión de administrador iniciada', 'success');
      refreshAdminData().catch((err) => setContentMessage(err.message, true));
    } else {
      loginError.textContent = data.error || 'Contraseña incorrecta';
    }
  } catch (err) {
    loginError.textContent = 'Error de conexión. Intenta de nuevo.';
  }
};

if (logoutBtn) {
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
    showToast('Sesión cerrada', 'info');
  };
}

/**
 * Sanitizes strings to prevent XSS vulnerabilities.
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
 */
function setActive(lang) {
  currentLang = lang;
  btnEn.classList.toggle('active', lang === 'en');
  btnEs.classList.toggle('active', lang === 'es');
  currentLangEl.textContent = lang === 'en' ? 'English' : 'Español';
  renderDisplayList();
}

/**
 * Switches active visible admin tab panel ('control', 'content', 'screens').
 */
function showTab(tabName) {
  tabControl.classList.toggle('active', tabName === 'control');
  tabContent.classList.toggle('active', tabName === 'content');
  if (tabScreens) tabScreens.classList.toggle('active', tabName === 'screens');
  
  // Mobile bottom navigation bar sync
  const mobileBtns = document.querySelectorAll('.mobile-nav-btn');
  mobileBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  panelControl.classList.toggle('active', tabName === 'control');
  panelContent.classList.toggle('active', tabName === 'content');
  if (panelScreens) panelScreens.classList.toggle('active', tabName === 'screens');

  // Scroll smoothly to top on mobile tab change
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Generates HTML `<option>` markup for screen type drop-down selectors.
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
 * Generates rich visual thumbnail HTML for a given screen type and language.
 */
function getThumbnailHtml(screenType, lang = currentLang) {
  const item = customContents.find(c => c.screenType === screenType);
  if (!item) {
    return `
      <div class="thumb-placeholder">
        <span class="thumb-icon">📺</span>
        <span class="thumb-label">${escapeHtml(screenType)}</span>
      </div>
    `;
  }

  if (item.source === 'asset') {
    const file = item.files?.[lang] || item.files?.en || item.files?.es || '';
    if (!file) {
      return `
        <div class="thumb-placeholder">
          <span class="thumb-icon">🖼️</span>
          <span class="thumb-label">${escapeHtml(screenType)}</span>
        </div>
      `;
    }
    const isVideo = /\.(mp4|mkv|webm|mov|m4v|avi|wmv)$/i.test(file);
    if (isVideo) {
      return `
        <div class="thumb-media-box">
          <video class="thumb-preview" src="/assets/${escapeHtml(file)}#t=0.5" preload="metadata" muted playsinline></video>
          <span class="thumb-badge video">▶ Video</span>
        </div>
      `;
    }
    return `
      <div class="thumb-media-box">
        <img class="thumb-preview" src="/assets/${escapeHtml(file)}" alt="${escapeHtml(screenType)}" loading="lazy">
        <span class="thumb-badge image">🖼 Imagen</span>
      </div>
    `;
  }

  // Link source (Canva, Genially, video stream, generic web)
  const provider = (item.provider || 'link').toLowerCase();
  let badgeClass = 'link';
  let icon = '🌐';
  let providerName = 'Enlace Web';

  if (provider === 'canva') {
    badgeClass = 'canva';
    icon = '🎨';
    providerName = 'Canva';
  } else if (provider === 'genially') {
    badgeClass = 'genially';
    icon = '✨';
    providerName = 'Genially';
  } else if (provider === 'video') {
    badgeClass = 'video';
    icon = '🎬';
    providerName = 'Video Stream';
  }

  const targetUrl = item.urls?.[lang] || item.urls?.en || item.urls?.es || '';

  return `
    <div class="thumb-embed-box ${badgeClass}">
      <span class="thumb-embed-icon">${icon}</span>
      <span class="thumb-embed-title">${providerName}</span>
      ${targetUrl ? `<a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer" class="thumb-preview-link" title="Abrir en pestaña nueva">↗ Abrir</a>` : ''}
      <span class="thumb-badge ${badgeClass}">${provider.toUpperCase()}</span>
    </div>
  `;
}

/**
 * Renders the custom content library entries into the content panel with rich thumbnails.
 */
function renderContentList() {
  if (customContents.length === 0) {
    contentListEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📁</div>
        <div class="empty-title">No hay contenidos en la biblioteca</div>
        <div class="empty-subtitle">Agrega un enlace web o sube archivos multimedia arriba.</div>
      </div>
    `;
    return;
  }

  contentListEl.innerHTML = `
    <div class="content-library-grid">
      ${customContents
        .map(content => {
          const isReady = content.hasEnglish && content.hasSpanish;
          const completeness = isReady ? 'Bilingüe (EN/ES)' : (content.hasEnglish ? 'Solo Inglés' : 'Solo Español');
          const thumbHtml = getThumbnailHtml(content.screenType, currentLang);
          const provider = content.provider ? ` (${escapeHtml(content.provider)})` : '';

          return `
            <div class="library-card">
              <div class="library-card-thumb">
                ${thumbHtml}
              </div>
              <div class="library-card-body">
                <div class="library-card-header">
                  <strong>${escapeHtml(content.screenType)}</strong>
                  <span class="library-type-tag">${escapeHtml(content.source)}${provider}</span>
                </div>
                <div class="library-status ${isReady ? 'ready' : 'warning'}">
                  ${isReady ? '✔' : '⚠'} ${completeness}
                </div>
                <div class="library-actions">
                  <button class="danger delete-content-btn" data-screen-type="${escapeHtml(content.screenType)}">
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

/**
 * Renders the list of active connected displays into the showroom grid with visual thumbnails.
 */
function renderDisplayList() {
  const countBadge = document.getElementById('display-count-badge');
  const onlineCount = connectedDisplays.filter(d => d.connected).length;
  if (countBadge) {
    countBadge.textContent = `${onlineCount} de ${connectedDisplays.length} en línea`;
  }

  if (connectedDisplays.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📺</div>
        <div class="empty-title">No hay pantallas conectadas</div>
        <div class="empty-subtitle">Inicia una pantalla con <code>npm run kiosk</code> o abre <code>display.html?screen=screen1</code></div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = connectedDisplays
    .map(d => {
      const isOnline = Boolean(d.connected);
      const statusLabel = isOnline ? 'En línea' : 'Desconectada';
      const statusClass = isOnline ? 'online' : 'offline';
      const thumbHtml = getThumbnailHtml(d.screenType, currentLang);
      const displayUrl = `/display.html?screen=${encodeURIComponent(d.screenId)}`;

      return `
        <div class="display-card ${statusClass}">
          <div class="display-card-thumb">
            ${thumbHtml}
          </div>
          <div class="display-card-body">
            <div class="display-card-header">
              <div class="display-title-wrap">
                <span class="pulse-dot ${statusClass}" title="${statusLabel}"></span>
                <span class="display-name">${escapeHtml(d.screenId)}</span>
              </div>
              <span class="display-status-tag ${statusClass}">${statusLabel}</span>
            </div>

            <div class="display-control-row">
              <label class="control-label">Contenido Asignado</label>
              <select class="screen-type-select" data-screen-id="${escapeHtml(d.screenId)}" data-socket-id="${d.socketId || ''}">
                ${getScreenTypeOptions(d.screenType)}
              </select>
            </div>

            <div class="display-card-footer">
              <a href="${displayUrl}" target="_blank" rel="noopener noreferrer" class="preview-btn">
                <span>🖥️</span> Abrir Display
              </a>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

/**
 * Displays status or error feedback message to the user in the admin content tab.
 */
function setContentMessage(message, isError) {
  contentMessageEl.textContent = message;
  contentMessageEl.style.color = isError ? '#DC2626' : '#16A34A';
}

function normalizeScreenType(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function readFileAsDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Unable to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function getErrorMessage(response, fallbackMsg = 'Request failed') {
  try {
    const data = await response.json();
    return data?.error || fallbackMsg;
  } catch (_) {
    try {
      const text = await response.text();
      return text || fallbackMsg;
    } catch {
      return fallbackMsg;
    }
  }
}

function updateContentFields() {
  const isPng = contentTypeEl.value === 'png';
  linkFieldsEl.style.display = isPng ? 'none' : 'block';
  pngFieldsEl.style.display = isPng ? 'block' : 'none';
}

function setScreenMessage(message, isError) {
  if (!screenMessageEl) return;
  screenMessageEl.textContent = message;
  screenMessageEl.style.color = isError ? '#DC2626' : '#16A34A';
}

function renderScreenTypeDropdown() {
  if (!screenDefaultTypeEl) return;
  screenDefaultTypeEl.innerHTML = screenTypes
    .map(type => `<option value="${type}">${type}</option>`)
    .join('');
}

function renderScreenRoster() {
  if (!screenListEl) return;
  if (connectedDisplays.length === 0) {
    screenListEl.innerHTML = '<span class="muted">No hay pantallas registradas aún.</span>';
    return;
  }

  screenListEl.innerHTML = connectedDisplays
    .map(d => {
      const isOnline = Boolean(d.connected);
      const dotColor = isOnline ? '#16A34A' : '#94A3B8';
      const statusLabel = isOnline ? 'en línea' : 'desconectada';
      return `
        <div class="display-row" style="opacity: ${isOnline ? '1' : '0.75'};">
          <span>
            <span class="dot" style="background: ${dotColor};"></span>
            <strong>${escapeHtml(d.screenId)}</strong>
            <span class="muted">(${statusLabel})</span>
          </span>
          <div style="display:flex; align-items:center; gap:8px;">
            <select class="roster-type-select" data-screen-id="${escapeHtml(d.screenId)}">
              ${getScreenTypeOptions(d.screenType)}
            </select>
            <button class="danger delete-screen-btn" data-screen-id="${escapeHtml(d.screenId)}">Eliminar</button>
          </div>
        </div>
      `;
    })
    .join('');
}

async function fetchScreenTypes() {
  const response = await fetch('/screen-types');
  if (!response.ok) throw new Error('No se pudieron cargar los tipos de pantalla');
  const text = await response.text();
  screenTypes = text.split(',').map(s => s.trim()).filter(Boolean);
  renderScreenTypeDropdown();
}

async function fetchCustomContents() {
  const response = await fetch('/custom-contents');
  if (!response.ok) throw new Error('No se pudieron cargar los contenidos');
  customContents = await response.json();
  renderContentList();
}

async function refreshAdminData() {
  await Promise.all([
    fetchScreenTypes(),
    fetchCustomContents()
  ]);
  renderDisplayList();
  renderScreenRoster();
}

async function saveLinkContent(screenType, provider, urlEn, urlEs) {
  const response = await fetch('/custom-contents/link', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ screenType, provider, urlEn, urlEs })
  });
  if (!response.ok) {
    const errMsg = await getErrorMessage(response, 'No se pudo guardar el contenido');
    throw new Error(errMsg);
  }
}

async function uploadMediaFile(screenType, language, file) {
  const dataUrl = await readFileAsDataUrl(file);
  const response = await fetch('/custom-contents/media', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      screenType,
      language,
      fileName: file.name,
      dataUrl
    })
  });
  if (!response.ok) {
    const errMsg = await getErrorMessage(response, `Error al subir archivo para ${language}`);
    throw new Error(errMsg);
  }
}

async function saveContent() {
  const screenType = normalizeScreenType(contentScreenTypeEl.value);
  if (!screenType) throw new Error('El identificador de pantalla (Key) es requerido');

  const contentType = contentTypeEl.value;
  if (contentType === 'link') {
    const provider = contentProviderEl.value;
    const urlEn = contentLinkEnEl.value.trim();
    const urlEs = contentLinkEsEl.value.trim();
    await saveLinkContent(screenType, provider, urlEn, urlEs);
  } else {
    const fileEn = contentPngEnEl.files?.[0];
    const fileEs = contentPngEsEl.files?.[0] || fileEn;

    if (!fileEn) throw new Error('Se requiere un archivo multimedia para inglés');
    await uploadMediaFile(screenType, 'en', fileEn);
    if (fileEs) {
      await uploadMediaFile(screenType, 'es', fileEs);
    }
  }

  contentScreenTypeEl.value = '';
  contentLinkEnEl.value = '';
  contentLinkEsEl.value = '';
  contentPngEnEl.value = '';
  contentPngEsEl.value = '';
  showToast(`Contenido "${screenType}" guardado`, 'success');
}

async function deleteContent(screenType) {
  const response = await fetch(`/custom-contents/${encodeURIComponent(screenType)}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (!response.ok) {
    const errMsg = await getErrorMessage(response, 'No se pudo eliminar el contenido');
    throw new Error(errMsg);
  }
  showToast(`Contenido "${screenType}" eliminado`, 'info');
}

async function saveScreen(explicitId, explicitType) {
  const rawId = explicitId || screenIdInputEl?.value;
  const screenId = normalizeScreenType(rawId);
  const defaultScreenType = explicitType || screenDefaultTypeEl?.value;

  if (!screenId) throw new Error('El nombre de pantalla es requerido');
  if (!defaultScreenType) throw new Error('Selecciona un contenido por defecto');

  const response = await fetch('/api/screens', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ screenId, defaultScreenType })
  });
  if (!response.ok) {
    const errMsg = await getErrorMessage(response, 'No se pudo guardar la pantalla');
    throw new Error(errMsg);
  }
  showToast(`Pantalla "${screenId}" guardada`, 'success');
}

async function deleteScreen(screenId) {
  const response = await fetch(`/api/screens/${encodeURIComponent(screenId)}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (!response.ok) {
    const errMsg = await getErrorMessage(response, 'No se pudo eliminar la pantalla');
    throw new Error(errMsg);
  }
  showToast(`Pantalla "${screenId}" eliminada del catálogo`, 'info');
}

// User Actions & Event Listeners
btnEn.onclick = () => {
  socket.emit('set-language', { lang: 'en', token: adminToken });
  showToast('Idioma cambiado a English', 'info');
};

btnEs.onclick = () => {
  socket.emit('set-language', { lang: 'es', token: adminToken });
  showToast('Idioma cambiado a Español', 'info');
};

tabControl.onclick = () => showTab('control');
tabContent.onclick = () => showTab('content');
if (tabScreens) tabScreens.onclick = () => showTab('screens');

// Mobile Bottom Navigation Bar Click Listeners
document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
  btn.onclick = () => {
    const tab = btn.dataset.tab;
    if (tab) showTab(tab);
  };
});

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

contentTypeEl.onchange = updateContentFields;

saveContentBtn.onclick = async () => {
  saveContentBtn.disabled = true;
  setContentMessage('Guardando contenido…', false);
  try {
    await saveContent();
    await refreshAdminData();
    setContentMessage('Contenido guardado con éxito.', false);
  } catch (error) {
    setContentMessage(error.message, true);
    showToast(error.message, 'error');
  } finally {
    saveContentBtn.disabled = false;
  }
};

if (saveScreenBtn) {
  saveScreenBtn.onclick = async () => {
    saveScreenBtn.disabled = true;
    setScreenMessage('Guardando pantalla…', false);
    try {
      await saveScreen();
      await refreshAdminData();
      if (screenIdInputEl) screenIdInputEl.value = '';
      setScreenMessage('Pantalla guardada con éxito.', false);
    } catch (error) {
      setScreenMessage(error.message, true);
      showToast(error.message, 'error');
    } finally {
      saveScreenBtn.disabled = false;
    }
  };
}

// Socket Communication
socket.on('connect', () => {
  socket.emit('request-state');
  socket.emit('request-display-list');
});

socket.on('language-changed', setActive);
socket.on('content-library-changed', () => {
  refreshAdminData().catch((error) => setContentMessage(error.message, true));
});

listEl.addEventListener('change', (event) => {
  const select = event.target.closest('.screen-type-select');
  if (!select) return;

  const screenId = select.dataset.screenId;
  const newType = select.value;

  socket.emit('set-display-screen-type', {
    screenId: select.dataset.screenId,
    socketId: select.dataset.socketId,
    screenType: newType,
    token: adminToken
  });

  showToast(`${screenId} reasignada a "${newType}"`, 'success');
  // Re-render thumbnail immediately for real-time responsiveness
  const display = connectedDisplays.find(d => d.screenId === screenId);
  if (display) {
    display.screenType = newType;
    renderDisplayList();
  }
});

socket.on('display-list', (displays) => {
  connectedDisplays = displays;
  renderDisplayList();
  renderScreenRoster();
});

contentListEl.addEventListener('click', async (event) => {
  const button = event.target.closest('.delete-content-btn');
  if (!button) return;

  const screenType = button.dataset.screenType;
  if (!screenType) return;

  button.disabled = true;
  setContentMessage(`Eliminando ${screenType}…`, false);
  try {
    await deleteContent(screenType);
    await refreshAdminData();
    setContentMessage(`Eliminado ${screenType}.`, false);
  } catch (error) {
    setContentMessage(error.message, true);
    showToast(error.message, 'error');
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
    setScreenMessage(`Eliminando ${screenId}…`, false);
    try {
      await deleteScreen(screenId);
      await refreshAdminData();
      setScreenMessage(`Eliminada ${screenId}.`, false);
    } catch (error) {
      setScreenMessage(error.message, true);
      showToast(error.message, 'error');
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
    setScreenMessage(`Actualizando contenido por defecto para ${screenId}…`, false);
    try {
      await saveScreen(screenId, defaultScreenType);
      await refreshAdminData();
      setScreenMessage(`Actualizado para ${screenId}.`, false);
    } catch (error) {
      setScreenMessage(error.message, true);
      showToast(error.message, 'error');
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
