const params = new URLSearchParams(location.search);
const rawDisplayId = (params.get('displayId') || params.get('screen') || '').replace(/^["']|["']$/g, '').trim();
const rawScreen = (params.get('screen') || '').replace(/^["']|["']$/g, '').trim();
const displayId = rawDisplayId || Math.floor(Math.random() * 10000).toString().padStart(4, '0');
let currentScreenType = rawScreen || displayId;
let assignedContent = null;

const canvaUrls = {
  en: params.get('canvaEn') || params.get('canva') || '',
  es: params.get('canvaEs') || params.get('canva') || ''
};
const geniallyUrls = {
  en: params.get('geniallyEn') || params.get('genially') || '',
  es: params.get('geniallyEs') || params.get('genially') || ''
};
const embedProviderParam = (params.get('provider') || '').toLowerCase();
const hasCanvaDisplay = Boolean(canvaUrls.en || canvaUrls.es);
const hasGeniallyDisplay = Boolean(geniallyUrls.en || geniallyUrls.es);

const imgEn = document.getElementById('img-en');
const imgEs = document.getElementById('img-es');
const videoEn = document.getElementById('video-en');
const videoEs = document.getElementById('video-es');
const embedEn = document.getElementById('embed-en') || document.getElementById('embed-frame');
const embedEs = document.getElementById('embed-es') || document.getElementById('embed-frame');
const statusEl = document.getElementById('status');

let currentLanguage = 'en';
let statusTimer = null;
let forceShowStatus = false;

/**
 * Updates status badge content and handles intelligent auto-fading.
 * @param {string} text - Status message.
 * @param {'info'|'warning'|'error'} [type='info'] - Status category.
 */
function updateStatus(text, type = 'info') {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.remove('warning', 'error', 'hidden');

  if (type === 'warning') statusEl.classList.add('warning');
  if (type === 'error') statusEl.classList.add('error');

  if (forceShowStatus) return;

  clearTimeout(statusTimer);
  // Errors and warnings stay visible until resolved. Normal statuses fade out in 3.5s
  if (type === 'info') {
    statusTimer = setTimeout(() => {
      if (!forceShowStatus) {
        statusEl.classList.add('hidden');
      }
    }, 3500);
  }
}

// Press 'D' to toggle debug status badge permanently
window.addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') {
    forceShowStatus = !forceShowStatus;
    if (forceShowStatus) {
      statusEl.classList.remove('hidden');
    } else {
      statusEl.classList.add('hidden');
    }
  }
});

/**
 * Determines embed source configuration from URL query parameters.
 */
function getEmbedSource() {
  if (embedProviderParam === 'genially' && hasGeniallyDisplay) {
    return { name: 'genially', urls: geniallyUrls };
  }
  if (embedProviderParam === 'canva' && hasCanvaDisplay) {
    return { name: 'canva', urls: canvaUrls };
  }
  if (hasGeniallyDisplay) {
    return { name: 'genially', urls: geniallyUrls };
  }
  if (hasCanvaDisplay) {
    return { name: 'canva', urls: canvaUrls };
  }
  return null;
}

const embedSource = getEmbedSource();
const hasQueryEmbeddedDisplay = Boolean(embedSource);

/**
 * Validates and returns a normalized display URL.
 */
function getValidDisplayUrl(url) {
  if (!url) return '';
  if (!URL.canParse(url)) return '';
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  return parsed.toString();
}

/**
 * Resolves the appropriate embed URL string for a target language.
 */
function getEmbedUrlForLanguage(lang) {
  const source = assignedContent?.type === 'link' ? assignedContent : embedSource;
  if (!source) return '';
  const byLanguage = source.urls?.[lang];
  if (byLanguage) return byLanguage;
  return source.urls?.en || source.urls?.es || '';
}

/**
 * Pre-renders and displays embed iframes (dual iframes for zero-reload crossfade).
 */
function renderEmbed(lang) {
  const targetUrl = getValidDisplayUrl(getEmbedUrlForLanguage(lang));
  if (!targetUrl) {
    const sourceName = assignedContent?.provider || embedSource?.name || 'embed';
    updateStatus(`${displayId} — URL de ${sourceName} inválida`, 'error');
    return false;
  }

  // Pre-fill both iframes whenever available to make transitions instant
  const urlEn = getValidDisplayUrl(getEmbedUrlForLanguage('en'));
  const urlEs = getValidDisplayUrl(getEmbedUrlForLanguage('es'));

  if (embedEn && urlEn && embedEn.src !== urlEn) {
    embedEn.src = urlEn;
  }
  if (embedEs && urlEs && embedEs.src !== urlEs) {
    embedEs.src = urlEs;
  }

  // Dual iframe crossfade (if separate iframes exist)
  if (embedEn && embedEs && embedEn !== embedEs) {
    embedEn.classList.toggle('visible', lang === 'en');
    embedEs.classList.toggle('visible', lang === 'es');
  } else if (embedEn) {
    if (embedEn.src !== targetUrl) {
      embedEn.src = targetUrl;
    }
    embedEn.classList.add('visible');
  }

  // Hide media layers
  imgEn.classList.remove('visible');
  imgEs.classList.remove('visible');
  videoEn.classList.remove('visible');
  videoEs.classList.remove('visible');
  videoEn.pause();
  videoEs.pause();

  return true;
}

/**
 * Normalizes and stores content configuration received from server.
 */
function setAssignedContent(content) {
  if (!content) {
    assignedContent = null;
    return;
  }
  if (content.type === 'asset') {
    assignedContent = {
      type: 'asset',
      mediaType: content.mediaType || 'image',
      mediaTypes: content.mediaTypes || {},
      files: content.files || {}
    };
    return;
  }
  assignedContent = {
    type: 'link',
    mediaType: content.mediaType || 'embed',
    mediaTypes: content.mediaTypes || {},
    provider: String(content.provider || 'link'),
    urls: {
      en: String(content.urls?.en || ''),
      es: String(content.urls?.es || '')
    }
  };
}

/**
 * Determines media type ('image', 'video', 'gif', 'embed') for a given language code.
 */
function getMediaTypeForLanguage(lang) {
  if (!assignedContent) {
    if (hasQueryEmbeddedDisplay) return 'embed';
    return 'image';
  }
  if (assignedContent.mediaTypes && assignedContent.mediaTypes[lang]) {
    return assignedContent.mediaTypes[lang];
  }
  if (assignedContent.type === 'asset') {
    const file = assignedContent.files?.[lang] || '';
    if (/\.(mp4|mkv|webm|mov|m4v|avi|wmv|ogv|flv|3gp)$/i.test(file)) return 'video';
    if (/\.gif$/i.test(file)) return 'gif';
    return 'image';
  }
  if (assignedContent.type === 'link') {
    const url = assignedContent.urls?.[lang] || '';
    if (assignedContent.provider === 'video' || /\.(mp4|mkv|webm|mov|m4v|avi|wmv|ogv|flv|3gp)($|\?)/i.test(url)) return 'video';
    if (/\.gif($|\?)/i.test(url)) return 'gif';
    if (/\.(png|jpg|jpeg|webp|svg)($|\?)/i.test(url)) return 'image';
    return 'embed';
  }
  return 'image';
}

/**
 * Updates DOM media element source URLs for both English and Spanish layers.
 */
function updateMediaSources() {
  const langEnType = getMediaTypeForLanguage('en');
  const langEsType = getMediaTypeForLanguage('es');

  if (assignedContent?.type === 'link') {
    const srcEn = getValidDisplayUrl(assignedContent.urls?.en);
    const srcEs = getValidDisplayUrl(assignedContent.urls?.es);
    if (langEnType === 'video' && srcEn) {
      const fullUrlEn = new URL(srcEn, location.origin).href;
      if (videoEn.src !== fullUrlEn) {
        videoEn.src = srcEn;
        videoEn.load();
      }
    } else if (srcEn) {
      imgEn.src = srcEn;
    }
    if (langEsType === 'video' && srcEs) {
      const fullUrlEs = new URL(srcEs, location.origin).href;
      if (videoEs.src !== fullUrlEs) {
        videoEs.src = srcEs;
        videoEs.load();
      }
    } else if (srcEs) {
      imgEs.src = srcEs;
    }
  } else {
    const fileEn = assignedContent?.files?.en || `${currentScreenType}-en.png`;
    const fileEs = assignedContent?.files?.es || `${currentScreenType}-es.png`;

    if (langEnType === 'video') {
      const srcEn = `/assets/${fileEn}`;
      const fullUrlEn = new URL(srcEn, location.origin).href;
      if (videoEn.src !== fullUrlEn) {
        videoEn.src = srcEn;
        videoEn.load();
      }
    } else {
      imgEn.src = `/assets/${fileEn}`;
    }

    if (langEsType === 'video') {
      const srcEs = `/assets/${fileEs}`;
      const fullUrlEs = new URL(srcEs, location.origin).href;
      if (videoEs.src !== fullUrlEs) {
        videoEs.src = srcEs;
        videoEs.load();
      }
    } else {
      imgEs.src = `/assets/${fileEs}`;
    }
  }
}

/**
 * Updates active screen type assignment.
 */
function setScreenType(screenType) {
  currentScreenType = screenType;
  updateMediaSources();
  updateStatus(`${displayId} — ${currentScreenType} (${currentLanguage})`);
}

/**
 * Displays active language media layer (with video time-sync and zero-reload iframe transitions).
 */
function showLanguage(lang) {
  currentLanguage = lang;
  updateMediaSources();
  const currentMediaType = getMediaTypeForLanguage(lang);

  if (currentMediaType === 'embed') {
    const rendered = renderEmbed(lang);
    if (rendered) {
      const sourceName = assignedContent?.provider || embedSource?.name || 'embed';
      updateStatus(`${displayId} — ${currentScreenType} (${currentLanguage.toUpperCase()}, ${sourceName})`);
    }
    return;
  }

  if (embedEn) embedEn.classList.remove('visible');
  if (embedEs && embedEs !== embedEn) embedEs.classList.remove('visible');

  const isEn = lang === 'en';
  const isEs = lang === 'es';

  const showVideoEn = isEn && currentMediaType === 'video';
  const showVideoEs = isEs && currentMediaType === 'video';
  const showImgEn = isEn && (currentMediaType === 'image' || currentMediaType === 'gif');
  const showImgEs = isEs && (currentMediaType === 'image' || currentMediaType === 'gif');

  videoEn.classList.toggle('visible', showVideoEn);
  videoEs.classList.toggle('visible', showVideoEs);
  imgEn.classList.toggle('visible', showImgEn);
  imgEs.classList.toggle('visible', showImgEs);

  // Synchronize playback time when toggling between video layers
  if (showVideoEn) {
    if (videoEs.currentTime > 0 && Math.abs(videoEn.currentTime - videoEs.currentTime) > 0.5) {
      try { videoEn.currentTime = videoEs.currentTime; } catch (_) {}
    }
    videoEn.play().catch(() => {});
    videoEs.pause();
  } else if (showVideoEs) {
    if (videoEn.currentTime > 0 && Math.abs(videoEs.currentTime - videoEn.currentTime) > 0.5) {
      try { videoEs.currentTime = videoEn.currentTime; } catch (_) {}
    }
    videoEs.play().catch(() => {});
    videoEn.pause();
  } else {
    videoEn.pause();
    videoEs.pause();
  }

  updateStatus(`${displayId} — ${currentScreenType} (${currentLanguage.toUpperCase()}, ${currentMediaType})`);
}

// Socket.IO Connection Handler
const socket = io();

socket.on('connect', () => {
  updateStatus(`${displayId} — conectado`, 'info');
  socket.emit('register-display', { displayId, screenId: displayId });
  socket.emit('request-state');
});

socket.on('disconnect', () => {
  updateStatus(`${displayId} — reconectando…`, 'warning');
});

socket.on('error', (payload) => {
  updateStatus(payload?.message || `${displayId} — error de conexión`, 'error');
});

socket.on('display-config', ({ screenType, language, content }) => {
  setAssignedContent(content);
  if (screenType) setScreenType(screenType);
  if (language) showLanguage(language);
});

socket.on('language-changed', (lang) => {
  showLanguage(lang);
});

socket.on('screen-type-changed', (payload) => {
  if (typeof payload === 'string') {
    setAssignedContent(null);
    setScreenType(payload);
    showLanguage(currentLanguage);
    return;
  }

  setAssignedContent(payload?.content);
  if (payload?.screenType) {
    setScreenType(payload.screenType);
  }
  showLanguage(currentLanguage);
});
