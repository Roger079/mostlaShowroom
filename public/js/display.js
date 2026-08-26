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
const embedFrame = document.getElementById('embed-frame');
const statusEl = document.getElementById('status');
let currentLanguage = 'en';

/**
 * Determines embed source configuration from URL search query parameters (Canva or Genially).
 * @returns {{ name: string, urls: { en: string, es: string } } | null} Embed source object or null.
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
 * @param {string} url - Raw URL to validate.
 * @returns {string} Validated URL string or empty string if invalid.
 */
function getValidDisplayUrl(url) {
  if (!url) return '';
  if (!URL.canParse(url)) {
    return '';
  }
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return '';
  }
  return parsed.toString();
}

/**
 * Resolves the appropriate embed URL string for a target language.
 * @param {'en'|'es'} lang - Target language code.
 * @returns {string} Embed URL string.
 */
function getEmbedUrlForLanguage(lang) {
  const source = assignedContent?.type === 'link' ? assignedContent : embedSource;
  if (!source) return '';
  const byLanguage = source.urls[lang];
  if (byLanguage) return byLanguage;
  return source.urls.en || source.urls.es;
}

/**
 * Renders an iframe embed for the specified language.
 * @param {'en'|'es'} lang - Target language code.
 * @returns {boolean} True if successfully rendered, false if URL is invalid.
 */
function renderEmbed(lang) {
  const embedUrl = getValidDisplayUrl(getEmbedUrlForLanguage(lang));
  if (!embedUrl) {
    const sourceName = assignedContent?.provider || embedSource?.name || 'embed';
    statusEl.textContent = `${displayId} — invalid ${sourceName} url`;
    return false;
  }

  if (embedFrame.src !== embedUrl) {
    embedFrame.src = embedUrl;
  }
  embedFrame.classList.add('visible');
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
 * @param {Object|null} content - Server content payload.
 * @returns {void}
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
 * @param {'en'|'es'} lang - Target language code.
 * @returns {string} Resolved media type keyword.
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
    if (/\.(mp4|webm|mov|m4v)$/i.test(file)) return 'video';
    if (/\.gif$/i.test(file)) return 'gif';
    return 'image';
  }
  if (assignedContent.type === 'link') {
    const url = assignedContent.urls?.[lang] || '';
    if (assignedContent.provider === 'video' || /\.(mp4|webm|mov|m4v)($|\?)/i.test(url)) return 'video';
    if (/\.gif($|\?)/i.test(url)) return 'gif';
    if (/\.(png|jpg|jpeg|webp|svg)($|\?)/i.test(url)) return 'image';
    return 'embed';
  }
  return 'image';
}

/**
 * Updates DOM media element source URLs for both English and Spanish layers.
 * @returns {void}
 */
function updateMediaSources() {
  const langEnType = getMediaTypeForLanguage('en');
  const langEsType = getMediaTypeForLanguage('es');

  if (assignedContent?.type === 'link') {
    const srcEn = getValidDisplayUrl(assignedContent.urls?.en);
    const srcEs = getValidDisplayUrl(assignedContent.urls?.es);
    if (langEnType === 'video' && srcEn) {
      if (videoEn.src !== new URL(srcEn, location.origin).href) videoEn.src = srcEn;
    } else if (srcEn) {
      imgEn.src = srcEn;
    }
    if (langEsType === 'video' && srcEs) {
      if (videoEs.src !== new URL(srcEs, location.origin).href) videoEs.src = srcEs;
    } else if (srcEs) {
      imgEs.src = srcEs;
    }
  } else {
    const fileEn = assignedContent?.files?.en || `${currentScreenType}-en.png`;
    const fileEs = assignedContent?.files?.es || `${currentScreenType}-es.png`;

    if (langEnType === 'video') {
      const srcEn = `/assets/${fileEn}`;
      if (videoEn.src !== new URL(srcEn, location.origin).href) videoEn.src = srcEn;
    } else {
      imgEn.src = `/assets/${fileEn}`;
    }

    if (langEsType === 'video') {
      const srcEs = `/assets/${fileEs}`;
      if (videoEs.src !== new URL(srcEs, location.origin).href) videoEs.src = srcEs;
    } else {
      imgEs.src = `/assets/${fileEs}`;
    }
  }
}

/**
 * Updates active screen type assignment and updates status display text.
 * @param {string} screenType - Screen type key.
 * @returns {void}
 */
function setScreenType(screenType) {
  currentScreenType = screenType;
  updateMediaSources();
  statusEl.textContent = `${displayId} — ${currentScreenType} (${currentLanguage})`;
}

/**
 * Displays active language media layer (toggles opacity transitions and media playback).
 * @param {'en'|'es'} lang - Target language code.
 * @returns {void}
 */
function showLanguage(lang) {
  currentLanguage = lang;
  updateMediaSources();
  const currentMediaType = getMediaTypeForLanguage(lang);

  if (currentMediaType === 'embed') {
    const rendered = renderEmbed(lang);
    if (rendered) {
      const sourceName = assignedContent?.provider || embedSource?.name || 'embed';
      statusEl.textContent = `${displayId} — ${currentScreenType} (${currentLanguage}, ${sourceName})`;
    }
    return;
  }

  embedFrame.classList.remove('visible');

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

  if (showVideoEn) {
    videoEn.play().catch(() => { });
    videoEs.pause();
  } else if (showVideoEs) {
    videoEs.play().catch(() => { });
    videoEn.pause();
  } else {
    videoEn.pause();
    videoEs.pause();
  }

  statusEl.textContent = `${displayId} — ${currentScreenType} (${currentLanguage}, ${currentMediaType})`;
}

// Socket.IO Communication Handler
const socket = io();

socket.on('connect', () => {
  statusEl.textContent = `${displayId} — connected`;
  socket.emit('register-display', { displayId, screenType: currentScreenType });
  socket.emit('request-state');
});

socket.on('disconnect', () => {
  statusEl.textContent = `${displayId} — disconnected, retrying…`;
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
