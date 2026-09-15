const socket = io(window.SERVER_BASE, { reconnection: true });
const stats = { messages: 0, bans: 0, actions: 0 };
let currentNativePoll = null;
let currentPrediction = null;
const DEFAULT_AVATAR = 'https://i.imgur.com/OmnpuQH.png';

let ipcRenderer = null;
try { ipcRenderer = require('electron').ipcRenderer; } catch(e) {}

const recentMessages = new Map();
const ultimosStatsTikTok = {};
const youtubeStats = {
  superchats: 0, totalAmount: 0, members: 0, messages: 0,
  topSuperchatters: new Map(), topMembers: new Map(), topChatters: new Map()
};

let censorshipEnabled = false;
const translationCache = new Map();
let translationQueue = [];
let isTranslating = false;
const MYMEMORY_EMAIL = '';
const TRANSLATION_DELAY_MS = 1200;
const SUPPORTED_LANGS = ['en','pt','fr','it','de','ru','ja','ko','zh-CN','ar','tr','nl','pl'];
let translationPausedUntil = 0;
let consecutive429 = 0;

async function loadDashboardConfig() {
  try {
    const response = await fetch(`${window.SERVER_BASE}/get-config`);
    const data = await response.json();
    censorshipEnabled = data.ENABLE_CENSORSHIP || false;
  } catch (e) { censorshipEnabled = false; }
}
loadDashboardConfig();

const genderReplacements = [
  { from: /\bhombre\b/gi, to: 'mujer' }, { from: /\bchico\b/gi, to: 'chica' },
  { from: /\bvarón\b/gi, to: 'mujer' }, { from: /\bseñor\b/gi, to: 'señora' },
  { from: /\bamigo\b/gi, to: 'amiga' }, { from: /\bhermano\b/gi, to: 'hermana' },
  { from: /eres feo/gi, to: 'eres hermosa' }, { from: /eres fea/gi, to: 'eres hermosa' },
  { from: /te odio/gi, to: 'te quiero mucho' }, { from: /cállate/gi, to: 'me encanta escucharte' }
];

function applyGenderReplacements(text) {
  if (!text) return text;
  let result = text;
  for (const rule of genderReplacements) { result = result.replace(rule.from, rule.to); }
  return result;
}

function getFlagByLang(lang) {
  const flags = { 'en': '🇺🇸', 'es': '🇪🇸', 'fr': '🇫🇷', 'de': '🇩🇪', 'it': '🇮🇹', 'pt': '🇧🇷', 'ja': '🇯🇵', 'ko': '🇰🇷', 'zh-CN': '🇨🇳', 'ar': '🇸🇦', 'ru': '🇷🇺', 'th': '🇹🇭', 'vi': '🇻🇳', 'tr': '🇹🇷', 'nl': '🇳🇱', 'pl': '🇵🇱' };
  return flags[lang] || '🌐';
}

function detectLanguage(text) {
  if (!text || /^[\d\s.,!?¿¡]+$/.test(text)) return 'en';
  if (/[\u3040-\u30FF]/.test(text)) return 'ja';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh-CN';
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  if (/[ăâđêôơư]/i.test(text)) return 'vi';
  if (/[\u0E00-\u0E7F]/.test(text)) return 'th';
  const spanishWords = ['el','la','los','las','un','una','es','son','está','están','y','o','pero','porque','qué','cómo','dónde','quién','con','sin','para','por','de','del','al','a','en','se','su','mis','tus','sus','hola','gracias','muy','bien','mal','todo','nada','este','esta'];
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const spanishHits = words.filter(w => spanishWords.includes(w)).length;
  if (spanishHits >= 1 && spanishHits / words.length >= 0.2) return 'es';
  return 'en';
}

function translateText(text, targetLang = 'es') {
  return new Promise((resolve) => {
    if (!text || text.trim().length === 0) {
      resolve({ translated: text, sourceLang: 'es', translated_ok: false });
      return;
    }
    const cleanText = text.trim();
    const sourceLang = detectLanguage(cleanText);
    if (sourceLang === 'es') {
      resolve({ translated: cleanText, sourceLang: 'es', translated_ok: false });
      return;
    }
    const cacheKey = `${cleanText}|${targetLang}`;
    if (translationCache.has(cacheKey)) {
      resolve({ translated: translationCache.get(cacheKey), sourceLang, translated_ok: true });
      return;
    }
    translationQueue.push({ text: cleanText, resolve, sourceLang });
    if (!isTranslating) processTranslationQueue();
  });
}

function buildTranslateUrl(text, sourceLang) {
  const src = SUPPORTED_LANGS.includes(sourceLang) ? sourceLang : 'en';
  let url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${src}|es`;
  if (MYMEMORY_EMAIL) url += `&de=${encodeURIComponent(MYMEMORY_EMAIL)}`;
  return url;
}

function processTranslationQueue() {
  if (isTranslating || translationQueue.length === 0) return;
  const now = Date.now();
  if (now < translationPausedUntil) {
    const wait = translationPausedUntil - now;
    setTimeout(processTranslationQueue, wait);
    return;
  }
  isTranslating = true;
  const item = translationQueue.shift();
  const { text, resolve, sourceLang } = item;
  const url = buildTranslateUrl(text, sourceLang);
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.timeout = 7000;
  const finish = (result, extraDelay = TRANSLATION_DELAY_MS) => {
    resolve(result);
    setTimeout(() => { isTranslating = false; processTranslationQueue(); }, extraDelay);
  };
  xhr.onload = function() {
    let translated = text;
    let ok = false;
    if (xhr.status === 429) {
      consecutive429++;
      const backoff = Math.min(5000 * Math.pow(2, consecutive429 - 1), 30000);
      translationPausedUntil = Date.now() + backoff;
      console.warn(`[MyMemory] 429 recibido. Pausando cola ${backoff/1000}s (intento ${consecutive429}).`);
      finish({ translated: text, sourceLang, translated_ok: false }, 200);
      return;
    }
    if (xhr.status === 403) {
      finish({ translated: text, sourceLang, translated_ok: false });
      return;
    }
    if (xhr.status === 200) {
      try {
        const data = JSON.parse(xhr.responseText);
        const candidate = data.responseData?.translatedText || '';
        const isErrorMsg = /^(please|quota|you used all|invalid|too many|mymemory warning)/i.test(candidate);
        if (candidate && !isErrorMsg) { translated = candidate; ok = true; consecutive429 = 0; }
      } catch (e) { }
    }
    if (ok) translationCache.set(`${text}|es`, translated);
    finish({ translated, sourceLang, translated_ok: ok });
  };
  xhr.onerror = function() { finish({ translated: text, sourceLang, translated_ok: false }); };
  xhr.ontimeout = function() { finish({ translated: text, sourceLang, translated_ok: false }); };
  xhr.send();
}

function isDuplicateMessage(msg) {
  if (!msg || !msg.username || !msg.message) return false;
  const key = `${msg.platform || 'twitch'}|${msg.username}|${msg.message}`.toLowerCase();
  const now = Date.now();
  const last = recentMessages.get(key);
  if (last && (now - last) < 8000) return true;
  recentMessages.set(key, now);

  // Limpieza periódica: si el Map crece mucho, quitamos los antiguos
  if (recentMessages.size > 500) {
    const cutoff = now - 8000;
    for (const [k, t] of recentMessages) {
      if (t < cutoff) recentMessages.delete(k);
    }
  }

  return false;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// ============================================
// PERSISTENCIA UI (localStorage)
// ============================================
const LS_KEYS = {
  TIKTOK_COLLAPSED: 'dashboard:tiktokCollapsed',
  RIGHT_COLLAPSED: 'dashboard:rightCollapsed',
  YOUTUBE_COLLAPSED: 'dashboard:youtubeCollapsed',
  TIKTOK_ACTIVE_VIEW: 'TIKTOK_ACTIVE_VIEW'
};

function lsGetBool(key, def = false) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return def;
    return v === '1' || v === 'true';
  } catch (e) { return def; }
}
function lsSetBool(key, val) {
  try { localStorage.setItem(key, val ? '1' : '0'); } catch (e) {}
}

let tiktokCollapsed  = lsGetBool(LS_KEYS.TIKTOK_COLLAPSED, false);
let rightCollapsed   = lsGetBool(LS_KEYS.RIGHT_COLLAPSED, false);
let youtubeCollapsed = lsGetBool(LS_KEYS.YOUTUBE_COLLAPSED, false);

function applyLayout() {
  const layout = document.getElementById('mainLayout');
  const tiktokContainer = document.getElementById('tiktokViewContainer');
  const rightColumn = document.getElementById('rightColumn');
  layout.classList.remove('tiktok-collapsed', 'right-collapsed', 'both-collapsed');
  if (tiktokCollapsed && rightCollapsed) layout.classList.add('both-collapsed');
  else if (tiktokCollapsed) layout.classList.add('tiktok-collapsed');
  else if (rightCollapsed) layout.classList.add('right-collapsed');
  tiktokContainer.classList.toggle('hidden', tiktokCollapsed);
  rightColumn.classList.toggle('hidden', rightCollapsed);
  const eyeIcon = document.getElementById('toggleTikTokIcon');
  if (eyeIcon) eyeIcon.className = tiktokCollapsed ? 'ri-eye-off-line' : 'ri-eye-line';
  document.getElementById('toggleIcon').className = rightCollapsed ? 'ri-layout-left-line' : 'ri-layout-right-line';
  document.getElementById('toggleText').textContent = rightCollapsed ? 'Mostrar Panel' : 'Ocultar Panel';

  // YouTube
  const ytSection = document.getElementById('section-stats-youtube');
  if (ytSection) ytSection.classList.toggle('hidden', youtubeCollapsed);
  const ytText = document.getElementById('toggleYouTubeText');
  if (ytText) ytText.textContent = youtubeCollapsed ? 'Mostrar YouTube' : 'Ocultar YouTube';
}

function toggleTikTokColumn() {
  tiktokCollapsed = !tiktokCollapsed;
  lsSetBool(LS_KEYS.TIKTOK_COLLAPSED, tiktokCollapsed);
  applyLayout();
}
function toggleRightColumn() {
  rightCollapsed = !rightCollapsed;
  lsSetBool(LS_KEYS.RIGHT_COLLAPSED, rightCollapsed);
  applyLayout();
}
function toggleYouTubeStats() {
  youtubeCollapsed = !youtubeCollapsed;
  lsSetBool(LS_KEYS.YOUTUBE_COLLAPSED, youtubeCollapsed);
  applyLayout();
}

// ============================================
// SELECTOR DE VISTAS TIKTOK
// ============================================
const DEFAULT_TIKTOK_VIEWS = [
  { id: 'slot1', name: 'Cuenta 1', username: '', url: 'https://livecenter.tiktok.com/live_monitor', partition: 'persist:tiktok-slot-1' },
  { id: 'slot2', name: 'Cuenta 2', username: '', url: 'https://livecenter.tiktok.com/live_monitor', partition: 'persist:tiktok-slot-2' },
  { id: 'slot3', name: 'Cuenta 3', username: '', url: 'https://livecenter.tiktok.com/live_monitor', partition: 'persist:tiktok-slot-3' }
];

let TIKTOK_VIEWS = [...DEFAULT_TIKTOK_VIEWS];
let TIKTOK_ACTIVE_VIEW = 'slot1';

async function loadTikTokViews() {
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/tiktok/views`);
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data.views) && data.views.length > 0) {
        TIKTOK_VIEWS = data.views;
        TIKTOK_ACTIVE_VIEW = data.active || data.views[0].id;
        renderTikTokDropdown();
        return;
      }
    }
  } catch (e) {}
  try {
    const saved = localStorage.getItem(LS_KEYS.TIKTOK_ACTIVE_VIEW);
    if (saved && TIKTOK_VIEWS.some(v => v.id === saved)) TIKTOK_ACTIVE_VIEW = saved;
  } catch (e) {}
  renderTikTokDropdown();
}

function renderTikTokDropdown() {
  const dd = document.getElementById('tiktokViewDropdown');
  const label = document.getElementById('tiktokViewLabel');
  const badge = document.getElementById('tkCurrentViewBadge');
  const current = TIKTOK_VIEWS.find(v => v.id === TIKTOK_ACTIVE_VIEW) || TIKTOK_VIEWS[0];

  if (current) {
    label.textContent = current.name;
    if (badge) badge.textContent = current.username ? '@' + current.username : current.name;
  }

  dd.innerHTML = TIKTOK_VIEWS.map(v => `
    <button class="tk-item ${v.id === TIKTOK_ACTIVE_VIEW ? 'active' : ''}" data-view-id="${v.id}">
      <i class="ri-tiktok-fill" style="color:var(--secondary);font-size:13px;"></i>
      <span class="tk-label">
        <span class="tk-name" data-name-id="${v.id}" title="Doble clic para renombrar">${escapeHtml(v.name)}</span>
        <span class="tk-user" data-user-id="${v.id}" title="Doble clic para editar @username">${v.username ? '@' + escapeHtml(v.username) : '+ añadir @'}</span>
      </span>
      <i class="ri-check-line tk-check"></i>
    </button>
  `).join('') + `
    <div class="tk-sep"></div>
    <button class="tk-action" onclick="openTikTokNative()">
      <i class="ri-external-link-line"></i>
      <span>Abrir en ventana externa</span>
    </button>
  `;

  // Enganchar eventos a cada item
  dd.querySelectorAll('.tk-item').forEach(item => {
    const id = item.getAttribute('data-view-id');

    item.addEventListener('click', (ev) => {
      // Ignorar clic si estamos editando
      if (ev.target.classList.contains('editing')) return;
      if (ev.target.closest('.editing')) return;
      switchTikTokView(id);
    });

    const nameEl = item.querySelector('.tk-name');
    const userEl = item.querySelector('.tk-user');

    if (nameEl) {
      nameEl.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        startRenameView(ev, id, nameEl);
      });
    }

    if (userEl) {
      userEl.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        startRenameUsername(ev, id, userEl);
      });
    }
  });
}

function toggleTikTokDropdown(ev) {
  if (ev) ev.stopPropagation();
  const sel = document.getElementById('tiktokViewSelector');
  sel.classList.toggle('open');
}

document.addEventListener('click', (e) => {
  const sel = document.getElementById('tiktokViewSelector');
  if (!sel) return;
  if (!sel.contains(e.target)) sel.classList.remove('open');
});

function switchTikTokView(id) {
  const view = TIKTOK_VIEWS.find(v => v.id === id);
  if (!view) return;
  TIKTOK_ACTIVE_VIEW = id;

  const oldWv = document.getElementById('tiktokView');
  if (!oldWv) return;

  const newWv = document.createElement('webview');
  newWv.id = 'tiktokView';
  newWv.setAttribute('src', view.url || 'https://livecenter.tiktok.com/live_monitor');
  newWv.setAttribute('partition', view.partition || 'persist:tiktok-session');
  newWv.setAttribute('allowpopups', '');
  oldWv.replaceWith(newWv);

  bindTikTokWebviewEvents(newWv);
  renderTikTokDropdown();
  document.getElementById('tiktokViewSelector').classList.remove('open');

  try { localStorage.setItem(LS_KEYS.TIKTOK_ACTIVE_VIEW, id); } catch (e) {}
  fetch(`${window.SERVER_BASE}/api/tiktok/active-view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  }).catch(() => {});
}

// ─── Renombrar vista (nombre) ───
function startRenameView(ev, id, el) {
  ev.stopPropagation();
  const original = el.textContent.trim();
  el.contentEditable = 'true';
  el.classList.add('editing');
  el.focus();

  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  let saved = false;
  const save = async () => {
    if (saved) return;
    saved = true;
    el.contentEditable = 'false';
    el.classList.remove('editing');
    const nuevo = el.textContent.trim().slice(0, 40);
    if (!nuevo || nuevo === original) { el.textContent = original; return; }
    el.textContent = nuevo;
    const v = TIKTOK_VIEWS.find(x => x.id === id);
    if (v) v.name = nuevo;
    renderTikTokDropdown();
    try {
      await fetch(`${window.SERVER_BASE}/api/tiktok/rename-view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: nuevo })
      });
    } catch (e) { console.warn('No se pudo guardar el nombre:', e); }
  };
  const cancel = () => {
    if (saved) return;
    saved = true;
    el.contentEditable = 'false';
    el.classList.remove('editing');
    el.textContent = original;
  };

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  el.addEventListener('blur', save, { once: true });
}

// ─── Editar @username real ───
function startRenameUsername(ev, id, el) {
  ev.stopPropagation();
  const originalRaw = el.textContent.trim();
  const original = originalRaw === '+ añadir @' ? '' : originalRaw.replace(/^@/, '');
  el.textContent = original;
  el.contentEditable = 'true';
  el.classList.add('editing');
  el.focus();

  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  let saved = false;
  const save = async () => {
    if (saved) return;
    saved = true;
    el.contentEditable = 'false';
    el.classList.remove('editing');
    const nuevo = el.textContent.trim().replace(/^@/, '').slice(0, 60);
    if (nuevo === original) {
      el.textContent = nuevo ? '@' + nuevo : '+ añadir @';
      return;
    }
    const v = TIKTOK_VIEWS.find(x => x.id === id);
    if (v) v.username = nuevo;
    el.textContent = nuevo ? '@' + nuevo : '+ añadir @';
    renderTikTokDropdown();
    try {
      const r = await fetch(`${window.SERVER_BASE}/api/tiktok/set-username`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, username: nuevo })
      });
      const data = await r.json();
      console.log('📺 set-username →', data);
    } catch (e) { console.warn('No se pudo guardar el username:', e); }
  };
  const cancel = () => {
    if (saved) return;
    saved = true;
    el.contentEditable = 'false';
    el.classList.remove('editing');
    el.textContent = original ? '@' + original : '+ añadir @';
  };

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  el.addEventListener('blur', save, { once: true });
}

function bindTikTokWebviewEvents(webview) {
  webview.addEventListener('dom-ready', () => {
    if (ipcRenderer) ipcRenderer.send('tiktok-view-loaded', webview.getWebContentsId());
  });

  webview.addEventListener('did-navigate', (e) => {
    const u = (e && e.url) || '';
    console.log('🌐 TikTok webview navegó a:', u);
    if (u.includes('tiktok.com') && !u.includes('/login')) {
      if (ipcRenderer) {
        console.log('🔑 Login detectado. Pidiendo captura de cookies...');
        ipcRenderer.invoke('tiktok:capturar-cookies').then((res) => {
          console.log('📦 Resultado captura:', res);
        }).catch((err) => console.error('❌ Error captura:', err));
      }
    }
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    const u = (e && e.url) || '';
    if (u.includes('tiktok.com') && !u.includes('/login')) {
      if (ipcRenderer) ipcRenderer.invoke('tiktok:capturar-cookies').catch(() => {});
    }
  });

  bindTikTokRetryEvents(webview);
  resetTikTokRetryState();
}

// ============================================
// 🔄 REFRESH + AUTO-RETRY
// ============================================
const TIKTOK_RETRY_DELAY_MS = 8000;
const TIKTOK_MAX_RETRIES = 5;

let tiktokRetryState = { retries: 0, timerId: null, lastGoodUrl: null, failing: false };

function getTikTokWebview() { return document.getElementById('tiktokView'); }
function setRefreshBtnState(state) {
  const btn = document.getElementById('refreshTikTokBtn');
  if (!btn) return;
  btn.classList.remove('loading', 'error', 'retrying');
  if (state) btn.classList.add(state);
}
function clearTikTokRetryTimer() {
  if (tiktokRetryState.timerId) { clearTimeout(tiktokRetryState.timerId); tiktokRetryState.timerId = null; }
}
function resetTikTokRetryState() {
  clearTikTokRetryTimer();
  tiktokRetryState.retries = 0;
  tiktokRetryState.failing = false;
  setRefreshBtnState(null);
}

function refreshTikTokView(isAutoRetry = false) {
  const wv = getTikTokWebview();
  if (!wv) return;
  if (!isAutoRetry) {
    tiktokRetryState.retries = 0;
    tiktokRetryState.failing = false;
    setRefreshBtnState('loading');
  } else {
    setRefreshBtnState('retrying');
  }
  try {
    const currentView = TIKTOK_VIEWS.find(v => v.id === TIKTOK_ACTIVE_VIEW) || TIKTOK_VIEWS[0];
    const targetUrl = (currentView && currentView.url) || 'https://livecenter.tiktok.com/live_monitor';
    const wvUrl = (typeof wv.getURL === 'function') ? wv.getURL() : (wv.src || '');
    if (typeof wv.reload === 'function' && wvUrl && wvUrl !== 'about:blank') {
      wv.reload();
    } else if (typeof wv.loadURL === 'function') {
      wv.loadURL(targetUrl);
    } else if (typeof wv.reload === 'function') {
      wv.reload();
    } else {
      recreateTikTokWebview();
    }
    console.log(`🔄 TikTok refresh ${isAutoRetry ? '(auto-retry ' + tiktokRetryState.retries + '/' + TIKTOK_MAX_RETRIES + ')' : '(manual)'}`);
  } catch (e) {
    console.warn('⚠️ Error al recargar webview TikTok:', e);
    recreateTikTokWebview();
  }
}

function recreateTikTokWebview() {
  const oldWv = getTikTokWebview();
  if (!oldWv) return;
  const currentView = TIKTOK_VIEWS.find(v => v.id === TIKTOK_ACTIVE_VIEW) || TIKTOK_VIEWS[0];
  const url = (currentView && currentView.url) || 'https://livecenter.tiktok.com/live_monitor';
  const partition = (currentView && currentView.partition) || 'persist:tiktok-session';
  const newWv = document.createElement('webview');
  newWv.id = 'tiktokView';
  newWv.setAttribute('src', url);
  newWv.setAttribute('partition', partition);
  newWv.setAttribute('allowpopups', '');
  oldWv.replaceWith(newWv);
  bindTikTokWebviewEvents(newWv);
  console.log('🔁 Webview TikTok recreada en', url);
}

function scheduleTikTokAutoRetry() {
  clearTikTokRetryTimer();
  if (tiktokRetryState.retries >= TIKTOK_MAX_RETRIES) {
    console.warn(`❌ TikTok: límite de ${TIKTOK_MAX_RETRIES} reintentos alcanzado.`);
    setRefreshBtnState('error');
    return;
  }
  tiktokRetryState.retries++;
  console.log(`⏱️ TikTok auto-retry en ${TIKTOK_RETRY_DELAY_MS/1000}s (intento ${tiktokRetryState.retries}/${TIKTOK_MAX_RETRIES})`);
  setRefreshBtnState('retrying');
  tiktokRetryState.timerId = setTimeout(() => {
    tiktokRetryState.timerId = null;
    refreshTikTokView(true);
  }, TIKTOK_RETRY_DELAY_MS);
}

function bindTikTokRetryEvents(webview) {
  webview.addEventListener('did-finish-load', () => {
    clearTikTokRetryTimer();
    tiktokRetryState.retries = 0;
    tiktokRetryState.failing = false;
    tiktokRetryState.lastGoodUrl = (typeof webview.getURL === 'function') ? webview.getURL() : null;
    setRefreshBtnState(null);
    console.log('✅ TikTok webview cargada correctamente');
  });
  webview.addEventListener('did-fail-load', (e) => {
    if (e && e.errorCode === -3) return;
    const url = (e && e.validatedURL) || '';
    if (!url || url === 'about:blank') return;
    console.warn(`⚠️ TikTok did-fail-load: ${e.errorCode} ${e.errorDescription} (${url})`);
    tiktokRetryState.failing = true;
    scheduleTikTokAutoRetry();
  });
  webview.addEventListener('render-process-gone', (e) => {
    console.error('💥 TikTok render-process-gone:', e);
    tiktokRetryState.failing = true;
    scheduleTikTokAutoRetry();
  });
}

function isEditableTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

function setupTikTokRefreshShortcuts() {
  document.addEventListener('keydown', (e) => {
    const isF5 = e.key === 'F5';
    const isCtrlR = (e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R');
    if (!isF5 && !isCtrlR) return;
    if (isEditableTarget(e.target)) return;
    if (tiktokCollapsed) return;
    const wv = getTikTokWebview();
    if (!wv) return;
    e.preventDefault();
    e.stopPropagation();
    console.log(`⌨️ Atajo ${isF5 ? 'F5' : 'Ctrl+R'} → refresh webview TikTok`);
    refreshTikTokView(false);
  }, true);
}

// ============================================
// SIDEBAR
// ============================================
function scrollToSection(targetId) {
  if (targetId === 'section-tiktok-live' && tiktokCollapsed) {
    toggleTikTokColumn();
    setTimeout(() => doScroll(targetId), 320);
    return;
  }
  if ((targetId === 'section-moderation' || targetId === 'section-polls' || targetId === 'section-title-category') && rightCollapsed) {
    toggleRightColumn();
    setTimeout(() => doScroll(targetId), 320);
    return;
  }
  if (targetId === 'section-stats-youtube' && youtubeCollapsed) {
    toggleYouTubeStats();
    setTimeout(() => doScroll(targetId), 200);
    return;
  }
  doScroll(targetId);
}

function doScroll(targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.scrollY - 20;
  window.scrollTo({ top: y, behavior: 'smooth' });
  marcarSidebarActivo(targetId);
}

function marcarSidebarActivo(targetId) {
  document.querySelectorAll('.sidebar-item[data-target]').forEach(item => {
    item.classList.toggle('active', item.dataset.target === targetId);
  });
}

function setupSidebarScrollSpy() {
  const sections = ['section-overview', 'section-chat', 'section-tiktok-live', 'section-moderation', 'section-polls', 'section-title-category', 'section-stats-tiktok', 'section-stats-youtube'];
  const observer = new IntersectionObserver((entries) => {
    const visibles = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visibles.length > 0) marcarSidebarActivo(visibles[0].target.id);
  }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });
  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
}

function updateSidebarCounts() {
  const chatEl = document.getElementById('sideChatCount');
  if (chatEl) { chatEl.textContent = stats.messages; chatEl.classList.toggle('live', stats.messages > 0); }
  const modEl = document.getElementById('sideModCount');
  if (modEl) { modEl.textContent = stats.actions; modEl.classList.toggle('live', stats.actions > 0); }
}

function initSidebar() {
  document.querySelectorAll('.sidebar-item[data-target]').forEach(btn => {
    btn.addEventListener('click', () => scrollToSection(btn.dataset.target));
  });
  setupSidebarScrollSpy();
  updateSidebarCounts();
}

let categorySearchTimer = null;
let categoryResults = [];
let selectedCategoryIndex = -1;

function getSelectedChannel() { return document.getElementById('titleChannelSelect').value; }
async function onTitleCategoryChannelChange() { await loadStreamInfo(); }

async function loadStreamInfo() {
  const channel = getSelectedChannel();
  if (!channel) {
    document.getElementById('currentTitle').textContent = '—';
    document.getElementById('currentCategory').textContent = '—';
    return;
  }
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/twitch/stream-info?channel=${encodeURIComponent(channel)}`);
    const data = await r.json();
    if (data.ok) {
      document.getElementById('currentTitle').textContent = data.title || '(sin título)';
      document.getElementById('currentCategory').textContent = data.gameName ? `${data.gameName} · ${data.gameId}` : '(sin categoría)';
      document.getElementById('streamTitle').value = data.title || '';
    } else {
      document.getElementById('currentTitle').textContent = '—';
      document.getElementById('currentCategory').textContent = '—';
    }
  } catch (e) {
    document.getElementById('currentTitle').textContent = '—';
    document.getElementById('currentCategory').textContent = '—';
  }
}

function onCategorySearchFocus() {
  if (categoryResults.length > 0) document.getElementById('categoryDropdown').classList.add('open');
}

function onCategorySearchInput() {
  const q = document.getElementById('categorySearch').value.trim();
  clearTimeout(categorySearchTimer);
  if (q.length < 2) {
    document.getElementById('categoryDropdown').classList.remove('open');
    categoryResults = [];
    return;
  }
  categorySearchTimer = setTimeout(() => searchCategories(q), 300);
}

async function searchCategories(query) {
  const channel = getSelectedChannel();
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/twitch/search-category?q=${encodeURIComponent(query)}&channel=${encodeURIComponent(channel)}`);
    const data = await r.json();
    if (!data.ok) { categoryResults = []; renderCategoryDropdown([], 'Error al buscar'); return; }
    categoryResults = data.results || [];
    selectedCategoryIndex = categoryResults.length > 0 ? 0 : -1;
    renderCategoryDropdown(categoryResults);
  } catch (e) {
    categoryResults = [];
    renderCategoryDropdown([], 'Error de red');
  }
}

function renderCategoryDropdown(results, emptyMsg) {
  const dd = document.getElementById('categoryDropdown');
  if (!results || results.length === 0) {
    dd.innerHTML = `<div class="category-empty">${emptyMsg || 'Sin resultados'}</div>`;
    dd.classList.add('open');
    return;
  }
  dd.innerHTML = results.map((cat, i) => `
    <div class="category-item ${i === selectedCategoryIndex ? 'active' : ''}"
         onclick="pickCategory(${i})"
         onmouseenter="hoverCategory(${i})">
      ${cat.boxArt ? `<img src="${cat.boxArt}" onerror="this.style.display='none'">` : '<div style="width:26px;height:36px;border-radius:3px;background:var(--bg-hover)"></div>'}
      <div class="category-item-info">
        <div class="category-item-name">${escapeHtml(cat.name)}</div>
        <div class="category-item-id">ID: ${cat.id}</div>
      </div>
    </div>
  `).join('');
  dd.classList.add('open');
}

function hoverCategory(i) {
  selectedCategoryIndex = i;
  document.querySelectorAll('.category-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === i);
  });
}

function pickCategory(i) {
  const cat = categoryResults[i];
  if (!cat) return;
  document.getElementById('categorySearch').value = cat.name;
  document.getElementById('selectedCategoryId').value = cat.id;
  document.getElementById('selectedCategoryName').value = cat.name;
  document.getElementById('categoryDropdown').classList.remove('open');
}

function selectFirstCategory() {
  if (selectedCategoryIndex >= 0 && categoryResults[selectedCategoryIndex]) {
    pickCategory(selectedCategoryIndex);
    setTimeout(() => changeSelectedCategory(), 100);
  }
}

document.addEventListener('click', (e) => {
  const dd = document.getElementById('categoryDropdown');
  const input = document.getElementById('categorySearch');
  if (!dd) return;
  if (!dd.contains(e.target) && e.target !== input) dd.classList.remove('open');
});

async function changeSelectedCategory() {
  const id = document.getElementById('selectedCategoryId').value;
  const channel = getSelectedChannel();
  const resultEl = document.getElementById('categoryResult');
  if (!id || !channel) {
    resultEl.innerHTML = '<span style="color:var(--warning)">Selecciona una categoría de la lista</span>';
    return;
  }
  resultEl.innerHTML = '<span style="color:var(--text-dim)">Cambiando...</span>';
  socket.emit('change-category', { channel, category: id });
}

async function loadChannels() {
  try {
    const response = await fetch(`${window.SERVER_BASE}/get-config`);
    const config = await response.json();
    const channels = config.channels || [];
    const selects = ['actionChannelSelect', 'pollChannelSelect', 'predictionChannelSelect', 'titleChannelSelect', 'categoryChannelSelect'];
    selects.forEach(id => {
      const select = document.getElementById(id);
      if (!select) return;
      select.innerHTML = '';
      channels.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch;
        opt.textContent = ch;
        select.appendChild(opt);
      });
      if (channels.length > 0) {
        select.value = channels[0];
        if (id === 'titleChannelSelect') setTimeout(loadStreamInfo, 100);
      }
    });
  } catch (e) { console.error('Error loadChannels:', e); }
}

async function loadTikTokView() {
  const webview = document.getElementById('tiktokView');
  if (!webview) return;
  try {
    const response = await fetch(`${window.SERVER_BASE}/get-config`);
    const config = await response.json();
    const url = config.CONTROL_URL || 'https://livecenter.tiktok.com/live_monitor';
    const src = (typeof webview.getURL === 'function') ? webview.getURL() : (webview.src || '');
    if (!src || src === 'about:blank' || src === '') {
      const current = TIKTOK_VIEWS.find(v => v.id === TIKTOK_ACTIVE_VIEW) || TIKTOK_VIEWS[0];
      if (current) {
        const newWv = document.createElement('webview');
        newWv.id = 'tiktokView';
        newWv.setAttribute('src', current.url || url);
        newWv.setAttribute('partition', current.partition || 'persist:tiktok-session');
        newWv.setAttribute('allowpopups', '');
        webview.replaceWith(newWv);
        bindTikTokWebviewEvents(newWv);
        return;
      }
    }
    bindTikTokWebviewEvents(webview);
  } catch (e) { console.error('Error loadTikTokView:', e); }
}

function openTikTokNative() { if (ipcRenderer) ipcRenderer.send('open-tiktok-window'); }

socket.on('connect', () => {
  document.getElementById('connectionStatus').innerHTML =
    '<span class="status-dot"></span><span class="status-text">Conectado</span>';
  loadChannels().then(() => loadStreamInfo());
  socket.emit('tiktok-get-stats');
});
socket.on('disconnect', () => {
  document.getElementById('connectionStatus').innerHTML =
    '<span class="status-dot" style="background:var(--danger);box-shadow:0 0 0 0 rgba(248,113,113,0.55);"></span>' +
    '<span class="status-text" style="color:var(--danger);">Desconectado</span>';
});

socket.on('chat-message', (msg) => {
  if (isDuplicateMessage(msg)) return;
  addMessageToFeed(msg);
  if ((msg.platform || '').toLowerCase() === 'youtube') {
    youtubeStats.messages++;
    const u = msg.username || 'Anónimo';
    youtubeStats.topChatters.set(u, (youtubeStats.topChatters.get(u) || 0) + 1);
    renderTablasYouTube();
  }
});

socket.on('stats-update', (data) => {
  if (data.totalBits !== undefined) document.getElementById('totalBits').textContent = data.totalBits;
});

socket.on('tiktok-stats-all', (todos) => {
  if (!todos || typeof todos !== 'object') return;
  for (const usuario in todos) { ultimosStatsTikTok[usuario] = todos[usuario]; }
  renderTablasTikTok();
});
socket.on('tiktok-stats', ({ usuario, stats: s }) => {
  if (!usuario || !s) return;
  ultimosStatsTikTok[usuario] = s;
  renderTablasTikTok();
});
socket.on('tiktok-like', () => renderTablasTikTok());
socket.on('tiktok-gift', () => renderTablasTikTok());
socket.on('tiktok-follow', () => renderTablasTikTok());
socket.on('tiktok-share', () => renderTablasTikTok());
socket.on('tiktok-sub', () => renderTablasTikTok());
socket.on('tiktok-member', () => renderTablasTikTok());
socket.on('tiktok-viewers', (data) => {
  const count = data && (data.espectadores || data.viewerCount);
  if (typeof count === 'number') document.getElementById('tkViewers').textContent = count;
});

// 🔥 Sincronización de vistas entre pestañas
socket.on('tiktok:view-renamed', ({ id, name }) => {
  const v = TIKTOK_VIEWS.find(x => x.id === id);
  if (v) { v.name = name; renderTikTokDropdown(); }
});
socket.on('tiktok:username-changed', ({ id, username }) => {
  const v = TIKTOK_VIEWS.find(x => x.id === id);
  if (v) {
    v.username = username;
    renderTikTokDropdown();
  }
});
socket.on('tiktok:active-view-changed', ({ id, username }) => {
  if (id && id !== TIKTOK_ACTIVE_VIEW) {
    TIKTOK_ACTIVE_VIEW = id;
    renderTikTokDropdown();
    const oldWv = document.getElementById('tiktokView');
    if (oldWv) {
      const view = TIKTOK_VIEWS.find(v => v.id === id);
      if (view) {
        const newWv = document.createElement('webview');
        newWv.id = 'tiktokView';
        newWv.setAttribute('src', view.url || 'https://livecenter.tiktok.com/live_monitor');
        newWv.setAttribute('partition', view.partition || 'persist:tiktok-session');
        newWv.setAttribute('allowpopups', '');
        oldWv.replaceWith(newWv);
        bindTikTokWebviewEvents(newWv);
      }
    }
  } else if (id === TIKTOK_ACTIVE_VIEW && typeof username !== 'undefined') {
    const v = TIKTOK_VIEWS.find(x => x.id === id);
    if (v) v.username = username;
    renderTikTokDropdown();
  }
});

socket.on('youtube-superchat', (data) => {
  if (!data) return;
  youtubeStats.superchats++;
  const amount = parseAmount(data.amount);
  youtubeStats.totalAmount += amount;
  const u = data.username || 'Anónimo';
  youtubeStats.topSuperchatters.set(u, (youtubeStats.topSuperchatters.get(u) || 0) + amount);
  renderTablasYouTube();
});
socket.on('youtube-member', (data) => {
  if (!data) return;
  youtubeStats.members++;
  const u = data.username || 'Anónimo';
  youtubeStats.topMembers.set(u, (youtubeStats.topMembers.get(u) || 0) + 1);
  renderTablasYouTube();
});

function renderTablasTikTok() {
  let totalLikes = 0, totalFollows = 0, totalShares = 0, totalDiamantes = 0, totalViewers = 0;
  const giftersMap = new Map(), likersMap = new Map(), sharersMap = new Map();
  for (const usuario in ultimosStatsTikTok) {
    const s = ultimosStatsTikTok[usuario];
    totalLikes += s.likes || 0;
    totalFollows += s.follows || 0;
    totalShares += s.shares || 0;
    totalDiamantes += s.diamantes || 0;
    totalViewers += s.espectadores || 0;
    for (const g of (s.topGifters || [])) {
      const cur = giftersMap.get(g.username) || { username: g.username, diamantes: 0 };
      cur.diamantes += g.diamantes || 0;
      giftersMap.set(g.username, cur);
    }
    for (const l of (s.topLikers || [])) {
      const cur = likersMap.get(l.username) || { username: l.username, likes: 0 };
      cur.likes += l.likes || 0;
      likersMap.set(l.username, cur);
    }
    for (const sh of (s.topSharers || [])) {
      const cur = sharersMap.get(sh.username) || { username: sh.username, veces: 0 };
      cur.veces += sh.veces || 0;
      sharersMap.set(sh.username, cur);
    }
  }
  document.getElementById('tkLikes').textContent = totalLikes.toLocaleString('es-ES');
  document.getElementById('tkFollows').textContent = totalFollows.toLocaleString('es-ES');
  document.getElementById('tkShares').textContent = totalShares.toLocaleString('es-ES');
  document.getElementById('tkDiamonds').textContent = totalDiamantes.toLocaleString('es-ES');
  document.getElementById('tkViewers').textContent = totalViewers.toLocaleString('es-ES');
  renderTabla('topGiftersTable', Array.from(giftersMap.values()).sort((a, b) => b.diamantes - a.diamantes).slice(0, 10), 'diamantes', '💎');
  renderTabla('topLikersTable', Array.from(likersMap.values()).sort((a, b) => b.likes - a.likes).slice(0, 10), 'likes', '❤️');
  renderTabla('topSharersTable', Array.from(sharersMap.values()).sort((a, b) => b.veces - a.veces).slice(0, 10), 'veces', '🔗');
}

function parseAmount(str) {
  if (!str) return 0;
  const m = String(str).replace(',', '.').match(/(\d+(\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

function renderTablasYouTube() {
  document.getElementById('ytSuperchats').textContent = youtubeStats.superchats.toLocaleString('es-ES');
  document.getElementById('ytSuperchatAmount').textContent = '$' + youtubeStats.totalAmount.toFixed(2);
  document.getElementById('ytMembers').textContent = youtubeStats.members.toLocaleString('es-ES');
  document.getElementById('ytMessages').textContent = youtubeStats.messages.toLocaleString('es-ES');
  const superArr = Array.from(youtubeStats.topSuperchatters.entries()).map(([username, amount]) => ({ username, amount })).sort((a, b) => b.amount - a.amount).slice(0, 10);
  renderTablaAmount('topSuperchattersTable', superArr);
  const membersArr = Array.from(youtubeStats.topMembers.entries()).map(([username, count]) => ({ username, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  renderTabla('topMembersTable', membersArr, 'count', '⭐');
  const chattersArr = Array.from(youtubeStats.topChatters.entries()).map(([username, count]) => ({ username, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  renderTabla('topChattersTable', chattersArr, 'count', '💬');
}

function renderTabla(tbodyId, datos, campoValor, emoji) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  if (!datos || datos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">Sin datos todavía</td></tr>';
    return;
  }
  tbody.innerHTML = datos.map((d, i) => {
    const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
    return `<tr class="${rankClass}"><td class="rank">#${i + 1}</td><td class="uname" title="${escapeHtml(d.username)}">${escapeHtml(d.username)}</td><td class="val">${emoji} ${Number(d[campoValor] || 0).toLocaleString('es-ES')}</td></tr>`;
  }).join('');
}

function renderTablaAmount(tbodyId, datos) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  if (!datos || datos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">Sin datos todavía</td></tr>';
    return;
  }
  tbody.innerHTML = datos.map((d, i) => {
    const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
    return `<tr class="${rankClass}"><td class="rank">#${i + 1}</td><td class="uname" title="${escapeHtml(d.username)}">${escapeHtml(d.username)}</td><td class="val">💎 $${Number(d.amount || 0).toFixed(2)}</td></tr>`;
  }).join('');
}

function resetTikTokStats() {
  if (!confirm('¿Resetear todos los contadores de TikTok?')) return;
  socket.emit('tiktok-reset-stats');
}

function resetYouTubeStats() {
  if (!confirm('¿Resetear todos los contadores de YouTube?')) return;
  youtubeStats.superchats = 0;
  youtubeStats.totalAmount = 0;
  youtubeStats.members = 0;
  youtubeStats.messages = 0;
  youtubeStats.topSuperchatters.clear();
  youtubeStats.topMembers.clear();
  youtubeStats.topChatters.clear();
  renderTablasYouTube();
}

socket.on('twitch-poll-created', (poll) => { if (!poll) return; currentNativePoll = poll; renderNativePoll(); });
socket.on('twitch-poll-ended', (pollId) => { if (currentNativePoll && currentNativePoll.id === pollId) { currentNativePoll.active = false; renderNativePoll(true); } });
socket.on('twitch-prediction-created', (pred) => { if (!pred) return; currentPrediction = pred; renderPrediction(); });
socket.on('twitch-prediction-resolved', (predId) => { if (currentPrediction && currentPrediction.id === predId) { currentPrediction.active = false; renderPrediction(true); } });

socket.on('category-change-result', (r) => {
  document.getElementById('categoryResult').innerHTML = r.success ?
    `<span style="color:var(--success)">${r.message}</span>` :
    `<span style="color:var(--danger)">${r.error}</span>`;
  if (r.success) setTimeout(loadStreamInfo, 500);
});
socket.on('title-change-result', (r) => {
  document.getElementById('titleResult').innerHTML = r.success ?
    `<span style="color:var(--success)">${r.message}</span>` :
    `<span style="color:var(--danger)">${r.error}</span>`;
  if (r.success) setTimeout(loadStreamInfo, 500);
});

function renderNativePoll(showResults = false) {
  const container = document.getElementById('nativePollDisplay');
  if (!currentNativePoll || !currentNativePoll.options) {
    container.innerHTML = '<p style="color:var(--text-dim);font-size:12px;margin:0;">No hay encuestas activas</p>';
    return;
  }
  const poll = currentNativePoll;
  let html = `<div style="font-weight:600;margin-bottom:8px;font-size:12.5px;">${poll.question}</div>`;
  html += poll.options.map((opt, i) => `<div class="poll-display-item"><span>${opt}</span><span class="votes">${poll.votes && poll.votes[i] !== undefined ? poll.votes[i] : 0} votos</span></div>`).join('');
  if (showResults || !poll.active) html += `<div class="poll-result">Encuesta finalizada</div>`;
  else html += `<button class="btn btn-danger btn-sm" onclick="endNativePoll()" style="margin-top:6px;">Finalizar</button>`;
  container.innerHTML = html;
}

function endNativePoll() { if (currentNativePoll) socket.emit('end-twitch-poll', { pollId: currentNativePoll.id }); }

function renderPrediction(showResults = false) {
  const container = document.getElementById('predictionDisplay');
  if (!currentPrediction || !currentPrediction.outcomes) {
    container.innerHTML = '<p style="color:var(--text-dim);font-size:12px;margin:0;">No hay predicciones activas</p>';
    return;
  }
  const pred = currentPrediction;
  let html = `<div style="font-weight:600;margin-bottom:8px;font-size:12.5px;">${pred.question}</div>`;
  html += pred.outcomes.map((o) => `<div class="poll-display-item"><span>${o.title}</span><span class="votes">${o.users ? o.users.length : 0} usuarios</span></div>`).join('');
  if (showResults || !pred.active) html += `<div class="poll-result">Predicción resuelta</div>`;
  else html += `<div style="display:flex;gap:6px;margin-top:6px;"><button class="btn btn-success btn-sm" onclick="resolvePrediction(0)">Opción A</button><button class="btn btn-success btn-sm" onclick="resolvePrediction(1)">Opción B</button></div>`;
  container.innerHTML = html;
}

function resolvePrediction(index) {
  if (!currentPrediction || !currentPrediction.outcomes) return;
  const winningId = currentPrediction.outcomes[index]?.id;
  if (!winningId) return alert('Opción inválida');
  socket.emit('resolve-twitch-prediction', { predictionId: currentPrediction.id, winningOutcomeId: winningId });
}

function addMessageToFeed(msg) {
  if (!msg || !msg.username) return;
  const feed = document.getElementById('liveChat');
  const entry = document.createElement('div');
  const platform = (msg.platform || 'twitch').toLowerCase();
  entry.className = `chat-message platform-${platform}`;
  const avatarImg = document.createElement('img');
  avatarImg.className = 'avatar';
  avatarImg.src = msg.avatar || DEFAULT_AVATAR;
  avatarImg.onerror = function() { this.src = DEFAULT_AVATAR; };
  let platformClass = 'platform-twitch';
  if (platform === 'tiktok') platformClass = 'platform-tiktok';
  else if (platform === 'kick') platformClass = 'platform-kick';
  else if (platform === 'youtube') platformClass = 'platform-youtube';
  const contentDiv = document.createElement('div');
  contentDiv.style.flex = '1';
  contentDiv.style.minWidth = '0';
  contentDiv.innerHTML = `
    <div>
      <span class="username">${escapeHtml(msg.username)}</span>
      <span class="platform-badge ${platformClass}">${platform}</span>
    </div>
    <div class="message">...</div>
  `;
  const modActions = document.createElement('div');
  modActions.className = 'mod-actions';
  modActions.innerHTML = `
    <button class="mod-btn" data-mod-action="ban"><i class="ri-forbid-2-line"></i></button>
    <button class="mod-btn" data-mod-action="timeout"><i class="ri-time-line"></i></button>
    <button class="mod-btn" data-mod-action="warn"><i class="ri-alert-line"></i></button>
  `;
  modActions.querySelectorAll('[data-mod-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.modAction;
      const username = msg.username;
      if (action === 'ban') quickBan(username);
      else if (action === 'timeout') quickTimeout(username);
      else if (action === 'warn') quickWarn(username);
    });
  });
  entry.appendChild(avatarImg);
  entry.appendChild(contentDiv);
  entry.appendChild(modActions);
  feed.prepend(entry);
  if (feed.children.length > 50) feed.lastChild.remove();
  stats.messages++;
  updateStats();
  const messageEl = contentDiv.querySelector('.message');
  translateText(msg.message).then(result => {
    let finalText = result.translated;
    if (censorshipEnabled) finalText = applyGenderReplacements(finalText);
    if (result.translated_ok && result.sourceLang !== 'es') {
      const flag = getFlagByLang(result.sourceLang);
      messageEl.innerHTML = `<span class="lang-flag">${flag}</span> ${escapeHtml(finalText)}`;
    } else {
      messageEl.innerHTML = escapeHtml(finalText);
    }
  }).catch(() => {
    messageEl.innerHTML = escapeHtml(msg.message);
  });
}

function updateStats() {
  document.getElementById('totalMessages').textContent = stats.messages;
  document.getElementById('totalBans').textContent = stats.bans;
  document.getElementById('totalActions').textContent = stats.actions;
  updateSidebarCounts();
}

function getChannel() { return document.getElementById('actionChannelSelect').value; }
function quickBan(u) { socket.emit('mod-command', { action: 'ban', username: u, reason: 'Ban rápido', channel: getChannel() }); stats.bans++; stats.actions++; updateStats(); }
function quickTimeout(u) { socket.emit('mod-command', { action: 'timeout', username: u, seconds: 600, channel: getChannel() }); stats.actions++; updateStats(); }
function quickWarn(u) { socket.emit('mod-command', { action: 'warn', username: u, channel: getChannel() }); stats.actions++; updateStats(); }

function banUser() {
  const u = document.getElementById('username').value;
  const r = document.getElementById('reason').value || 'Violación';
  if (!u) return alert('Usuario vacío');
  socket.emit('mod-command', { action: 'ban', username: u, reason: r, channel: getChannel() });
  stats.bans++; stats.actions++; updateStats();
}
function unbanUser() {
  const u = document.getElementById('username').value;
  if (!u) return alert('Usuario vacío');
  socket.emit('mod-command', { action: 'unban', username: u, channel: getChannel() });
  stats.actions++; updateStats();
}
function timeoutUser() {
  const u = document.getElementById('username').value;
  if (!u) return alert('Usuario vacío');
  socket.emit('mod-command', { action: 'timeout', username: u, seconds: 600, channel: getChannel() });
  stats.actions++; updateStats();
}
function warnUser() {
  const u = document.getElementById('username').value;
  const r = document.getElementById('reason').value || 'Advertencia';
  if (!u) return alert('Usuario vacío');
  socket.emit('mod-command', { action: 'warn', username: u, reason: r, channel: getChannel() });
  stats.actions++; updateStats();
}

function addNativeOption() {
  const container = document.getElementById('nativePollOptions');
  const div = document.createElement('div');
  div.className = 'input-group';
  div.style.marginBottom = '5px';
  div.innerHTML = `<input type="text" class="native-option-input" placeholder="Opción ${container.children.length + 1}"><button class="remove-option-btn" onclick="removeNativeOption(this)"><i class="ri-close-line"></i></button>`;
  container.appendChild(div);
}
function removeNativeOption(btn) {
  const container = document.getElementById('nativePollOptions');
  if (container.children.length > 2) btn.parentElement.remove();
}

function createNativePoll() {
  const q = document.getElementById('nativePollQuestion').value.trim();
  const options = Array.from(document.querySelectorAll('.native-option-input')).map(i => i.value.trim()).filter(v => v !== '');
  if (!q || options.length < 2) return alert('Faltan datos (mínimo 2 opciones)');
  socket.emit('create-twitch-poll', { channel: document.getElementById('pollChannelSelect').value, question: q, options, duration: 300 });
  document.getElementById('nativePollQuestion').value = '';
  document.querySelectorAll('.native-option-input').forEach(i => i.value = '');
}

function createNativePrediction() {
  const q = document.getElementById('predictionQuestion').value.trim();
  const o1 = document.getElementById('predictionOption1').value.trim();
  const o2 = document.getElementById('predictionOption2').value.trim();
  if (!q || !o1 || !o2) return alert('Faltan datos (necesitas 2 opciones)');
  socket.emit('create-twitch-prediction', { channel: document.getElementById('predictionChannelSelect').value, question: q, options: [o1, o2], duration: 300 });
  document.getElementById('predictionQuestion').value = '';
  document.getElementById('predictionOption1').value = '';
  document.getElementById('predictionOption2').value = '';
}

function changeTitle() {
  const title = document.getElementById('streamTitle').value.trim();
  const resultEl = document.getElementById('titleResult');
  if (!title) { resultEl.innerHTML = '<span style="color:var(--warning)">Escribe un título</span>'; return; }
  resultEl.innerHTML = '<span style="color:var(--text-dim)">Cambiando...</span>';
  socket.emit('change-title', { channel: getSelectedChannel(), title });
}

// ============================================
// INICIALIZACIÓN
// ============================================
loadChannels();
updateStats();
renderNativePoll();
renderPrediction();
renderTablasTikTok();
renderTablasYouTube();
applyLayout();
initSidebar();

loadTikTokViews().then(() => loadTikTokView());
setupTikTokRefreshShortcuts();