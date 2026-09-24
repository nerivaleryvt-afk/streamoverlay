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
  if (!text) return 'en';
  const clean = String(text).trim();
  if (clean.length === 0) return 'en';
  if (/^[\d\s.,!?¿¡@#$%^&*()_\-+=\[\]{};:'"<>/\\|`~]+$/.test(clean)) return 'es';
  try {
    if (/^[\p{Emoji}\p{Emoji_Component}\s]+$/u.test(clean)) return 'es';
  } catch (e) {}
  const words = clean.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 3) return 'es';
  if (/[\u3040-\u30FF]/.test(clean)) return 'ja';
  if (/[\u4E00-\u9FFF]/.test(clean)) return 'zh-CN';
  if (/[\uAC00-\uD7AF]/.test(clean)) return 'ko';
  if (/[\u0600-\u06FF]/.test(clean)) return 'ar';
  if (/[\u0400-\u04FF]/.test(clean)) return 'ru';
  if (/[ăâđêôơư]/i.test(clean)) return 'vi';
  if (/[\u0E00-\u0E7F]/.test(clean)) return 'th';
  if (/[ñáéíóúü¿¡]/i.test(clean)) return 'es';
  const spanishWords = [
    'el','la','los','las','un','una','unos','unas','es','son','está','están','estoy','estás','estamos',
    'y','o','pero','porque','qué','cómo','dónde','quién','cuándo','cuál',
    'con','sin','para','por','de','del','al','a','en','se','su','sus','mi','mis','tu','tus',
    'hola','gracias','muy','bien','mal','todo','toda','nada','este','esta','esto','ese','esa','eso',
    'sí','no','ya','aquí','ahí','allí','tengo','tienes','tiene','puedo','puedes','puede',
    'quiero','quieres','quiere','voy','vas','vamos','van','hacer','hago','haces','hace',
    'más','menos','también','tampoco','solo','sólo','cuando','donde','como','que','si',
    'me','te','le','nos','les','lo','os','nosotros','vosotros','ellos','ellas'
  ];
  const spanishHits = words.filter(w => spanishWords.includes(w)).length;
  if (spanishHits >= 1 && (spanishHits / words.length) >= 0.25) return 'es';
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

  dd.querySelectorAll('.tk-item').forEach(item => {
    const id = item.getAttribute('data-view-id');

    item.addEventListener('click', (ev) => {
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
    '<span class="status-dot" style="background:var(--danger);"></span>' +
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
  const iconMap = {
    '💎': 'ri-vip-diamond-fill',
    '❤️': 'ri-heart-3-fill',
    '🔗': 'ri-share-forward-fill',
    '⭐': 'ri-star-fill',
    '💬': 'ri-chat-3-fill'
  };
  const iconClass = iconMap[emoji] || 'ri-bar-chart-line';
  tbody.innerHTML = datos.map((d, i) => {
    const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
    return `<tr class="${rankClass}"><td class="rank">#${i + 1}</td><td class="uname" title="${escapeHtml(d.username)}">${escapeHtml(d.username)}</td><td class="val"><i class="${iconClass}"></i>${Number(d[campoValor] || 0).toLocaleString('es-ES')}</td></tr>`;
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
    return `<tr class="${rankClass}"><td class="rank">#${i + 1}</td><td class="uname" title="${escapeHtml(d.username)}">${escapeHtml(d.username)}</td><td class="val"><i class="ri-money-dollar-circle-fill"></i>$${Number(d.amount || 0).toFixed(2)}</td></tr>`;
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
  if (!feed) return;

  const platform = (msg.platform || 'twitch').toLowerCase();
  const rawText = String(msg.message || '');
  const isJoin = /\bse unió\b/i.test(rawText) || /\bjoined\b/i.test(rawText);

  const emptyMsg = feed.querySelector('.chat-empty');
  if (emptyMsg) emptyMsg.remove();

  if (isJoin) {
    const entry = document.createElement('div');
    entry.className = `chat-message join-message platform-${platform}`;
    entry.dataset.timestamp = Date.now();

    const avatarImg = document.createElement('img');
    avatarImg.className = 'avatar';
    avatarImg.src = msg.avatar || DEFAULT_AVATAR;
    avatarImg.onerror = function () { this.src = DEFAULT_AVATAR; };

    const contentDiv = document.createElement('div');
    contentDiv.style.flex = '1';
    contentDiv.style.minWidth = '0';
    contentDiv.style.display = 'flex';
    contentDiv.style.alignItems = 'center';

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');

    contentDiv.innerHTML = `
      <span class="username">${escapeHtml(msg.username)}</span>
      <span class="join-text">se unió</span>
      <span class="join-time">${hh}:${mm}</span>
    `;

    entry.appendChild(avatarImg);
    entry.appendChild(contentDiv);
    feed.prepend(entry);

    while (feed.children.length > 60) feed.lastChild.remove();
    stats.messages++;
    updateStats();
    return;
  }

  const entry = document.createElement('div');
  entry.className = `chat-message platform-${platform}`;
  entry.dataset.timestamp = Date.now();

  const avatarImg = document.createElement('img');
  avatarImg.className = 'avatar';
  avatarImg.src = msg.avatar || DEFAULT_AVATAR;
  avatarImg.onerror = function () { this.src = DEFAULT_AVATAR; };

  let platformClass = 'platform-twitch';
  if (platform === 'tiktok') platformClass = 'platform-tiktok';
  else if (platform === 'kick') platformClass = 'platform-kick';
    else if (platform === 'youtube') platformClass = 'platform-youtube';
  else if (platform === 'velora') platformClass = 'platform-velora';

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

  const msgPlatform = (msg.platform || 'twitch').toLowerCase();

  // 🟢 Para Kick: botones distintos (Ban / Timeout / Unban / Delete)
  if (msgPlatform === 'kick') {
    modActions.innerHTML = `
      <button class="mod-btn" data-mod-action="ban" title="Ban permanente"><i class="ri-forbid-2-line"></i></button>
      <button class="mod-btn" data-mod-action="timeout" title="Timeout 10min"><i class="ri-time-line"></i></button>
      <button class="mod-btn" data-mod-action="unban" title="Unban"><i class="ri-checkbox-circle-line"></i></button>
      <button class="mod-btn" data-mod-action="delete" title="Borrar mensaje"><i class="ri-delete-bin-line"></i></button>
    `;
  } else {
    modActions.innerHTML = `
      <button class="mod-btn" data-mod-action="ban" title="Ban"><i class="ri-forbid-2-line"></i></button>
      <button class="mod-btn" data-mod-action="timeout" title="Timeout"><i class="ri-time-line"></i></button>
      <button class="mod-btn" data-mod-action="warn" title="Advertir"><i class="ri-alert-line"></i></button>
    `;
  }

  modActions.querySelectorAll('[data-mod-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.modAction;
      const username = msg.username;
      const platform = msgPlatform;
      if (action === 'ban') quickBan(username, platform);
      else if (action === 'timeout') quickTimeout(username, platform);
      else if (action === 'warn') quickWarn(username, platform);
      else if (action === 'unban') quickUnban(username, platform);
      else if (action === 'delete') quickDelete(msg.messageId, msg.chatroomId);
    });
  });

  entry.appendChild(avatarImg);
  entry.appendChild(contentDiv);
  entry.appendChild(modActions);
  feed.prepend(entry);

  if (feed.children.length > 60) feed.lastChild.remove();

  stats.messages++;
  updateStats();

    const messageEl = contentDiv.querySelector('.message');

  if (Array.isArray(msg.parts) && msg.parts.length > 0) {
    messageEl.innerHTML = msg.parts.map(p => {
      if (p.type === 'emote') {
        return `<img class="chat-emote" src="${escapeHtml(p.url)}" alt="${escapeHtml(p.code || '')}" title="${escapeHtml(p.code || '')}" loading="lazy">`;
      }
      return escapeHtml(p.value || '');
    }).join('');
  } else {
    translateText(rawText).then(result => {
      let finalText = result.translated;
      if (censorshipEnabled) finalText = applyGenderReplacements(finalText);
      if (result.translated_ok && result.sourceLang !== 'es') {
        const flag = getFlagByLang(result.sourceLang);
        messageEl.innerHTML = `<span class="lang-flag">${flag}</span> ${escapeHtml(finalText)}`;
      } else {
        messageEl.innerHTML = escapeHtml(finalText);
      }
    }).catch(() => {
      messageEl.innerHTML = escapeHtml(rawText);
    });
  }
}

const MENSAJE_MAX_EDAD_MS = 5 * 60 * 1000;
const LIMPIEZA_INTERVALO_MS = 30 * 1000;

function limpiarMensajesAntiguos() {
  const feed = document.getElementById('liveChat');
  if (!feed) return;
  const cutoff = Date.now() - MENSAJE_MAX_EDAD_MS;
  const hijos = Array.from(feed.children);
  for (const hijo of hijos) {
    if (!hijo.dataset || !hijo.dataset.timestamp) continue;
    const ts = parseInt(hijo.dataset.timestamp, 10);
    if (ts && ts < cutoff) hijo.remove();
  }
  if (feed.children.length === 0) {
    feed.innerHTML = '<div class="chat-empty">Sin mensajes recientes</div>';
  }
}

setInterval(limpiarMensajesAntiguos, LIMPIEZA_INTERVALO_MS);

function updateStats() {
  document.getElementById('totalMessages').textContent = stats.messages;
  document.getElementById('totalBans').textContent = stats.bans;
  document.getElementById('totalActions').textContent = stats.actions;
  updateSidebarCounts();
}

function getChannel() { return document.getElementById('actionChannelSelect').value; }

function quickBan(u, platform) {
  socket.emit('mod-command', { action: 'ban', username: u, reason: 'Ban rápido', channel: getChannel(), platform: platform || 'twitch' });
  stats.bans++; stats.actions++; updateStats();
}
function quickTimeout(u, platform) {
  socket.emit('mod-command', { action: 'timeout', username: u, seconds: 600, channel: getChannel(), platform: platform || 'twitch' });
  stats.actions++; updateStats();
}
function quickWarn(u, platform) {
  socket.emit('mod-command', { action: 'warn', username: u, channel: getChannel(), platform: platform || 'twitch' });
  stats.actions++; updateStats();
}
function quickUnban(u, platform) {
  socket.emit('mod-command', { action: 'unban', username: u, channel: getChannel(), platform: platform || 'twitch' });
  stats.actions++; updateStats();
}
function quickDelete(messageId, chatroomId) {
  socket.emit('mod-command', { action: 'delete', messageId, chatroomId, platform: 'kick' });
  stats.actions++; updateStats();
}

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

let kickDashCategories = [];

function escapeHtmlKickDash(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function kickDashInit() {
  const badge = document.getElementById('kickDashBadge');
  const info = document.getElementById('kickDashInfo');
  const box = document.getElementById('kickStreamInfoBox');
  const editor = document.getElementById('kickDashEditor');
  const notConnected = document.getElementById('kickDashNotConnected');

  if (!badge) return;

  try {
    const r = await fetch(`${window.SERVER_BASE}/api/kick/status`);
    const data = await r.json();

    if (data.connected) {
      badge.textContent = 'CONECTADO';
      badge.style.background = 'rgba(83, 252, 24, 0.12)';
      badge.style.color = '#53fc18';
      badge.style.borderColor = 'rgba(83, 252, 24, 0.4)';

      info.textContent = `Cuenta: ${data.username || 'togikirei'}`;
      info.style.color = 'var(--text)';

      if (box) box.style.display = 'flex';
      if (editor) editor.style.display = 'block';
      if (notConnected) notConnected.style.display = 'none';

      kickDashRecargar();
    } else {
      badge.textContent = 'NO CONECTADO';
      badge.style.background = '';
      badge.style.color = '';
      badge.style.borderColor = '';

      info.textContent = data.reason || 'Sin cuenta de Kick conectada.';
      info.style.color = 'var(--text-muted)';

      if (box) box.style.display = 'none';
      if (editor) editor.style.display = 'none';
      if (notConnected) notConnected.style.display = 'block';
    }
  } catch (e) {
    badge.textContent = 'ERROR';
    info.textContent = 'No se pudo consultar el estado de Kick: ' + e.message;
    info.style.color = 'var(--danger)';
  }
}

async function kickDashRecargar() {
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/kick/stream-info`);
    const data = await r.json();
    if (!data.ok) return;

    const t = document.getElementById('kickCurrentTitle');
    const c = document.getElementById('kickCurrentCategory');
    const titleInput = document.getElementById('kickDashTitle');

    if (t) t.textContent = data.title || '(sin título)';
    if (c) c.textContent = data.categoryName ? `${data.categoryName} · ${data.categoryId || ''}` : '(sin categoría)';
    if (titleInput && !titleInput.matches(':focus')) titleInput.value = data.title || '';
  } catch (e) {
    console.error('Kick recargar error:', e);
  }
}

async function kickDashChangeTitle() {
  const titleInput = document.getElementById('kickDashTitle');
  const resultEl = document.getElementById('kickDashTitleResult');
  const title = (titleInput?.value || '').trim();

  if (!title) {
    resultEl.innerHTML = '<span style="color:var(--warning)">Escribe un título</span>';
    return;
  }

  resultEl.innerHTML = '<span style="color:var(--text-dim)">Cambiando…</span>';

  try {
    const r = await fetch(`${window.SERVER_BASE}/api/kick/stream-info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    const data = await r.json();

    if (data.ok) {
      resultEl.innerHTML = '<span style="color:var(--success)">✅ Título actualizado en Kick</span>';
      setTimeout(kickDashRecargar, 500);
    } else {
      resultEl.innerHTML = `<span style="color:var(--danger)">❌ ${escapeHtmlKickDash(data.error || 'Error desconocido')}</span>`;
    }
  } catch (e) {
    resultEl.innerHTML = `<span style="color:var(--danger)">❌ ${escapeHtmlKickDash(e.message)}</span>`;
  }
}

let kickDashSearchTimer = null;

function kickDashSearchCategory(q) {
  clearTimeout(kickDashSearchTimer);
  const dd = document.getElementById('kickDashCategoryDropdown');

  q = (q || '').trim();
  if (q.length < 2) {
    dd.classList.remove('open');
    kickDashCategories = [];
    return;
  }

  kickDashSearchTimer = setTimeout(async () => {
    try {
      const r = await fetch(`${window.SERVER_BASE}/api/kick/categories?q=${encodeURIComponent(q)}`);
      const data = await r.json();

      if (!data.ok || !Array.isArray(data.results) || data.results.length === 0) {
        dd.innerHTML = '<div class="category-empty">Sin resultados</div>';
        dd.classList.add('open');
        kickDashCategories = [];
        return;
      }

      kickDashCategories = data.results;

      dd.innerHTML = data.results.map((cat, i) => `
        <div class="category-item" onclick="kickDashPickCategory(${i})">
          <div style="width:26px;height:36px;border-radius:3px;background:var(--bg-hover);display:flex;align-items:center;justify-content:center;">
            <i class="ri-live-fill" style="color:#53fc18;opacity:0.6;"></i>
          </div>
          <div class="category-item-info">
            <div class="category-item-name">${escapeHtmlKickDash(cat.name)}</div>
            <div class="category-item-id">ID: ${cat.id}</div>
          </div>
        </div>
      `).join('');
      dd.classList.add('open');
    } catch (e) {
      dd.innerHTML = `<div class="category-empty">Error: ${escapeHtmlKickDash(e.message)}</div>`;
      dd.classList.add('open');
    }
  }, 300);
}

function kickDashPickCategory(i) {
  const cat = kickDashCategories[i];
  if (!cat) return;
  document.getElementById('kickDashCategorySearch').value = cat.name;
  document.getElementById('kickDashSelectedCategoryId').value = cat.id;
  document.getElementById('kickDashSelectedCategoryName').value = cat.name;
  document.getElementById('kickDashCategoryDropdown').classList.remove('open');
}

async function kickDashChangeCategory() {
  const id = document.getElementById('kickDashSelectedCategoryId').value;
  const name = document.getElementById('kickDashSelectedCategoryName').value;
  const resultEl = document.getElementById('kickDashCategoryResult');

  if (!id) {
    resultEl.innerHTML = '<span style="color:var(--warning)">Selecciona una categoría de la lista</span>';
    return;
  }

  resultEl.innerHTML = '<span style="color:var(--text-dim)">Cambiando…</span>';

  try {
    const r = await fetch(`${window.SERVER_BASE}/api/kick/stream-info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: Number(id) })
    });
    const data = await r.json();

    if (data.ok) {
      resultEl.innerHTML = `<span style="color:var(--success)">✅ Categoría cambiada a "${escapeHtmlKickDash(name)}"</span>`;
      setTimeout(kickDashRecargar, 500);
    } else {
      resultEl.innerHTML = `<span style="color:var(--danger)">❌ ${escapeHtmlKickDash(data.error || 'Error desconocido')}</span>`;
    }
  } catch (e) {
    resultEl.innerHTML = `<span style="color:var(--danger)">❌ ${escapeHtmlKickDash(e.message)}</span>`;
  }
}

document.addEventListener('click', (e) => {
  const dd = document.getElementById('kickDashCategoryDropdown');
  const input = document.getElementById('kickDashCategorySearch');
  if (!dd || !input) return;
  if (!dd.contains(e.target) && e.target !== input) dd.classList.remove('open');
});

// ============================================
// PESTAÑAS DE PLATAFORMA (Twitch / Kick)
// ============================================
const LS_KEY_PLATFORM_TAB = 'dashboard:platformTab';

function cambiarTabPlataforma(platform) {
  const tabs = document.querySelectorAll('.platform-tab');
  const contents = document.querySelectorAll('.platform-tab-content');

  tabs.forEach(t => t.classList.toggle('active', t.dataset.platform === platform));

  contents.forEach(c => c.classList.add('hidden'));
  const target = document.getElementById(`tab-content-${platform}`);
  if (target) target.classList.remove('hidden');

  try { localStorage.setItem(LS_KEY_PLATFORM_TAB, platform); } catch (e) {}

  console.log(`🔄 Pestaña cambiada a: ${platform}`);
}

function initPlatformTabs() {
  let saved = 'twitch';
  try {
    const s = localStorage.getItem(LS_KEY_PLATFORM_TAB);
    if (s === 'twitch' || s === 'kick') saved = s;
  } catch (e) {}
  cambiarTabPlataforma(saved);
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
initPlatformTabs();

loadTikTokViews().then(() => loadTikTokView());
setupTikTokRefreshShortcuts();

kickDashInit();
setInterval(kickDashInit, 30000);

// ================================================================
// 🎬 KICK — Crear Clip vía navegador
// ================================================================
(function initKickClipCreator() {
    const btnOpen = document.getElementById('kickCreateClipBtn');
    const modal = document.getElementById('kickClipModal');
    const inputTitle = document.getElementById('kickClipTitle');
    const btnCancel = document.getElementById('kickClipCancel');
    const btnCreate = document.getElementById('kickClipCreate');
    const status = document.getElementById('kickClipStatus');
    const result = document.getElementById('kickClipResult');

    if (!btnOpen || !modal) {
        console.warn('⚠️ [KICK-CLIP] No encontré los elementos del modal en el DOM');
        return;
    }

    function abrirModal() {
        inputTitle.value = '';
        status.textContent = '';
        btnCreate.disabled = false;
        btnCreate.textContent = 'Crear';
        modal.style.display = 'flex';
        setTimeout(() => inputTitle.focus(), 100);
    }

    function cerrarModal() {
        modal.style.display = 'none';
    }

    btnOpen.addEventListener('click', abrirModal);
    btnCancel.addEventListener('click', cerrarModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) cerrarModal();
    });

    btnCreate.addEventListener('click', async () => {
        const titulo = inputTitle.value.trim();
        if (!titulo) {
            status.textContent = '⚠️ El título es obligatorio';
            status.style.color = '#ffb800';
            return;
        }

        btnCreate.disabled = true;
        btnCreate.textContent = '⏳ Creando...';
        status.textContent = 'Esto puede tardar 10-15 segundos...';
        status.style.color = '#a0a5ab';

        try {
            const cfg = await fetch('/get-config').then(r => r.json());
            const username = cfg.KICK_USERS?.[0] || cfg.KICK_USERNAME || '';

            if (!username) {
                throw new Error('No hay usuario de Kick configurado');
            }

            if (!ipcRenderer) {
                throw new Error('ipcRenderer no está disponible (¿nodeIntegration desactivado?)');
            }

            console.log('🎬 [KICK-CLIP] Invocando IPC con:', { titulo, username });

            const r = await ipcRenderer.invoke('kick:create-clip-via-browser', {
                title: titulo,
                username: username
            });

            console.log('🎬 [KICK-CLIP] Respuesta del main:', r);

            if (!r.ok) {
                throw new Error(r.error || 'Error desconocido');
            }

            status.textContent = '✅ Clip creado correctamente';
            status.style.color = '#53fc18';
            btnCreate.textContent = '✅ Hecho';

            if (result) {
                result.textContent = '✅ Clip creado. Aparecerá en kick.com en unos segundos.';
                result.style.color = '#53fc18';
                result.style.display = 'block';
            }

            setTimeout(cerrarModal, 2000);

        } catch (err) {
            console.error('❌ [KICK-CLIP] Error:', err);
            status.textContent = '❌ ' + err.message;
            status.style.color = '#ff4757';
            btnCreate.disabled = false;
            btnCreate.textContent = 'Reintentar';

            if (result) {
                result.textContent = '❌ Error: ' + err.message;
                result.style.color = '#ff4757';
                result.style.display = 'block';
            }
        }
    });
})();
// ════════════════════════════════════════════════════════════════
// 🔑 STREAM KEYS + 🚀 STREAM CONTROL
// ════════════════════════════════════════════════════════════════

(function initStreamTools() {
  'use strict';

  // ─── Estado ───
  let skTabActual = 'obs';   // 'obs' | 'aitum'
  let skServersCache = null; // catálogo de servers por plataforma
  let skEstado = { obs: {}, aitum: {} };

  // ─── Helper para URLs ───
  const apiURL = (path) => (window.SERVER_BASE || '') + path;

  // ─── Escapar HTML ───
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ─── Iconos por plataforma ───
  function iconoPlataforma(platform) {
    const map = {
      twitch:  { icon: 'ri-twitch-fill',    color: '#a78bfa' },
      kick:    { icon: 'ri-live-fill',      color: '#53fc18' },
      youtube: { icon: 'ri-youtube-fill',   color: '#ff3b3b' },
      velora:  { icon: 'ri-broadcast-line', color: '#00d9ff' },
      tiktok:  { icon: 'ri-tiktok-fill',    color: '#ff0080' }
    };
    return map[platform] || { icon: 'ri-global-line', color: '#b8ff00' };
  }

  // ─── Cargar catálogo de servers ───
  async function skCargarServers() {
    if (skServersCache) return skServersCache;
    try {
      const r = await fetch(apiURL('/api/stream-keys/servers'));
      const data = await r.json();
      skServersCache = data.servers || {};
      return skServersCache;
    } catch (e) {
      console.warn('[stream-keys] No se pudo cargar servidores:', e);
      skServersCache = {};
      return {};
    }
  }

  // ─── Cargar y renderizar lista de keys ───
  async function skRecargar() {
    try {
      const r = await fetch(apiURL('/api/stream-keys'));
      const data = await r.json();
      if (!data.ok) return;
      skEstado = data.keys || { obs: {}, aitum: {} };
      skRender();
    } catch (e) {
      console.warn('[stream-keys] Error cargando:', e);
    }
  }

  function skRender() {
    const body = document.getElementById('streamKeysBody');
    if (!body) return;

    const target = skTabActual;
    const keys = skEstado[target] || {};
    const lista = Object.values(keys);

    if (lista.length === 0) {
      body.innerHTML = `
        <div class="tool-empty">
          <i class="ri-key-2-line"></i>
          <span>No hay claves guardadas para ${target === 'obs' ? 'OBS' : 'Aitum'}</span>
        </div>
      `;
      return;
    }

    body.innerHTML = lista.map(k => {
      const meta = iconoPlataforma(k.platform);
      return `
        <div class="sk-item">
          <div class="sk-item-head">
            <div class="sk-item-platform">
              <i class="${meta.icon}" style="color: ${meta.color}"></i>
              <span>${esc(k.label)}</span>
            </div>
            <div class="sk-item-actions">
              <button class="sk-item-btn apply" onclick="skAplicar('${target}', '${esc(k.platform)}')" title="Aplicar a ${target === 'obs' ? 'OBS' : 'Aitum'}">
                <i class="ri-play-circle-line"></i>
              </button>
              <button class="sk-item-btn" onclick="skEditar('${target}', '${esc(k.platform)}')" title="Editar">
                <i class="ri-pencil-line"></i>
              </button>
              <button class="sk-item-btn delete" onclick="skEliminar('${target}', '${esc(k.platform)}')" title="Eliminar">
                <i class="ri-delete-bin-line"></i>
              </button>
            </div>
          </div>
          <div class="sk-item-info">
            <strong>Server</strong><span>${esc(k.server)}</span>
            <strong>Key</strong><span>${esc(k.keyPreview)}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // ─── Cambiar tab (OBS / Aitum) ───
  window.skCambiarTab = function(target) {
    if (!['obs', 'aitum'].includes(target)) return;
    skTabActual = target;

    document.querySelectorAll('#streamKeysTabs .tool-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.target === target);
    });

    skRender();
  };

  // ─── Abrir modal para agregar/editar ───
  window.skAbrirModal = function(target, platform, datos) {
    target = target || skTabActual;
    platform = platform || 'twitch';

    // Crear modal si no existe
    let modal = document.getElementById('skModalBack');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'skModalBack';
      modal.className = 'sk-modal-back';
      modal.innerHTML = `
        <div class="sk-modal">
          <button class="sk-modal-close" onclick="skCerrarModal()">
            <i class="ri-close-line"></i>
          </button>
          <h3><i class="ri-key-2-line"></i> <span id="skModalTitle">Agregar clave</span></h3>

          <div class="sk-field">
            <label>Destino</label>
            <select id="skInputTarget">
              <option value="obs">OBS (Horizontal)</option>
              <option value="aitum">Aitum (Vertical)</option>
            </select>
          </div>

          <div class="sk-field">
            <label>Plataforma</label>
            <select id="skInputPlatform" onchange="skOnPlatformChange()">
              <option value="twitch">Twitch</option>
              <option value="kick">Kick</option>
              <option value="youtube">YouTube</option>
              <option value="velora">Velora</option>
              <option value="tiktok">TikTok (Aitum)</option>
            </select>
          </div>

          <div class="sk-field">
            <label>Servidor RTMP</label>
            <div class="sk-field-row">
              <select id="skInputServerSelect" onchange="skOnServerSelectChange()">
                <!-- se llena por JS -->
              </select>
              <button type="button" onclick="skDetectarTwitch()" title="Detectar mejor server (Twitch)">
                <i class="ri-global-line"></i>
              </button>
            </div>
            <input type="text" id="skInputServer" placeholder="rtmp://..." style="margin-top: 6px;">
            <div class="sk-field-hint" id="skServerHint">Podés elegir de la lista o escribir uno custom</div>
          </div>

          <div class="sk-field">
            <label>Clave de transmisión</label>
            <input type="password" id="skInputKey" placeholder="live_xxxxx..." autocomplete="off" spellcheck="false">
            <div class="sk-field-hint">Solo se muestra una vista previa después de guardar</div>
          </div>

          <div class="sk-field">
            <label>Etiqueta (opcional)</label>
            <input type="text" id="skInputLabel" placeholder="Ej: Twitch principal" autocomplete="off">
          </div>

          <div class="sk-modal-actions">
            <button onclick="skCerrarModal()">Cancelar</button>
            <button class="primary" onclick="skGuardar()">
              <i class="ri-save-line"></i> Guardar
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // Cerrar al hacer click en el fondo
      modal.addEventListener('click', (e) => {
        if (e.target === modal) skCerrarModal();
      });
    }

    // Rellenar campos
    document.getElementById('skModalTitle').textContent = datos ? 'Editar clave' : 'Agregar clave';
    document.getElementById('skInputTarget').value = target;
    document.getElementById('skInputPlatform').value = platform;
    document.getElementById('skInputServer').value = datos?.server || '';
    document.getElementById('skInputKey').value = ''; // nunca mostramos la key real
    document.getElementById('skInputLabel').value = datos?.label || '';

    // Cargar servidores conocidos para la plataforma
    skOnPlatformChange();

    modal.classList.add('show');
  };

  // ─── Cerrar modal ───
  window.skCerrarModal = function() {
    const modal = document.getElementById('skModalBack');
    if (modal) modal.classList.remove('show');
  };

  // ─── Cuando cambia la plataforma en el modal ───
  window.skOnPlatformChange = async function() {
    const platform = document.getElementById('skInputPlatform').value;
    const select = document.getElementById('skInputServerSelect');
    const input = document.getElementById('skInputServer');

    const servers = await skCargarServers();
    const lista = servers[platform] || [];

    if (lista.length === 0) {
      select.innerHTML = '<option value="">— Custom —</option>';
      select.disabled = true;
    } else {
      select.disabled = false;
      select.innerHTML = lista.map(s =>
        `<option value="${esc(s.value)}">${esc(s.label)}</option>`
      ).join('') + '<option value="__custom__">— Custom —</option>';
      // Preseleccionar el primero si el input está vacío
      if (!input.value) {
        input.value = lista[0].value;
      }
    }
  };

  // ─── Cuando cambia el select de servidores ───
  window.skOnServerSelectChange = function() {
    const select = document.getElementById('skInputServerSelect');
    const input = document.getElementById('skInputServer');
    if (select.value && select.value !== '__custom__') {
      input.value = select.value;
    }
  };

  // ─── Detectar server Twitch ───
    window.skDetectarTwitch = async function() {
    const hint = document.getElementById('skServerHint');
    const input = document.getElementById('skInputServer');

    hint.textContent = 'Detectando mejor server...';
    hint.style.color = 'var(--primary)';

    try {
      const r = await fetch(apiURL('/api/stream-keys/detect/twitch'));
      const data = await r.json();

      if (!data.ok) {
        hint.textContent = 'Error: ' + (data.error || 'desconocido');
        hint.style.color = 'var(--danger)';
        return;
      }

      // Debug: mostramos qué llegó
      console.log('[detect/twitch] servidores:', data.servers ? data.servers.length : 0);
      console.log('[detect/twitch] recommended:', data.recommended);

      // 1) Si el backend ya marcó uno como recomendado → usar ese
      let elegido = data.recommended;

      // 2) Si no, buscar en la lista el que tenga recommended=true
      if (!elegido && Array.isArray(data.servers)) {
        elegido = data.servers.find(s => s && s.recommended) || null;
      }

      // 3) Si sigue sin haber → usar el primero de la lista como fallback
      if (!elegido && Array.isArray(data.servers) && data.servers.length > 0) {
        elegido = data.servers[0];
        console.log('[detect/twitch] Fallback: usando el primero de la lista');
      }

      // 4) Si hay elegido y tiene URL → aplicarlo
      if (elegido && elegido.urlTemplate) {
        // urlTemplate: "rtmp://live-scl.twitch.tv/app/{stream_key}" → "rtmp://live-scl.twitch.tv/app"
        const urlLimpia = elegido.urlTemplate.replace('/{stream_key}', '').replace('{stream_key}', '');
        input.value = urlLimpia;
        hint.textContent = (elegido.recommended ? '✅ Recomendado: ' : '📍 Usando: ') + (elegido.name || urlLimpia);
        hint.style.color = elegido.recommended ? 'var(--primary)' : 'var(--warn)';
      } else {
        hint.textContent = 'No se pudo detectar ningún server de Twitch';
        hint.style.color = 'var(--danger)';
      }
    } catch (e) {
      console.error('[detect/twitch] Error:', e);
      hint.textContent = 'Error: ' + e.message;
      hint.style.color = 'var(--danger)';
    }
  };

  // ─── Guardar key ───
  window.skGuardar = async function() {
    const target = document.getElementById('skInputTarget').value;
    const platform = document.getElementById('skInputPlatform').value;
    const server = document.getElementById('skInputServer').value.trim();
    const key = document.getElementById('skInputKey').value.trim();
    const label = document.getElementById('skInputLabel').value.trim();

    if (!server) { alert('Falta el servidor'); return; }
    if (!key) { alert('Falta la clave'); return; }

    try {
      const r = await fetch(apiURL('/api/stream-keys'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, platform, server, key, label })
      });
      const data = await r.json();

      if (data.ok) {
        skCerrarModal();
        await skRecargar();
      } else {
        alert('Error: ' + (data.error || 'desconocido'));
      }
    } catch (e) {
      alert('Error de red: ' + e.message);
    }
  };

  // ─── Editar key existente ───
  window.skEditar = function(target, platform) {
    const datos = skEstado[target]?.[platform];
    if (!datos) return;
    skAbrirModal(target, platform, datos);
  };

  // ─── Eliminar key ───
  window.skEliminar = async function(target, platform) {
    if (!confirm(`¿Eliminar la clave de ${platform} en ${target === 'obs' ? 'OBS' : 'Aitum'}?`)) return;
    try {
      const r = await fetch(apiURL(`/api/stream-keys/${target}/${platform}`), { method: 'DELETE' });
      const data = await r.json();
      if (data.ok) await skRecargar();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  // ─── Aplicar key a OBS o Aitum ───
  window.skAplicar = async function(target, platform) {
    const label = target === 'obs' ? 'OBS' : 'Aitum';
    if (!confirm(`¿Aplicar la clave de ${platform} a ${label}?`)) return;

    try {
      const r = await fetch(apiURL('/api/stream-keys/apply'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, platform })
      });
      const data = await r.json();

      if (data.ok) {
        // Feedback visual simple
        const card = document.getElementById('streamKeysCard');
        if (card) {
          card.style.borderColor = 'var(--primary)';
          setTimeout(() => { card.style.borderColor = ''; }, 800);
        }
      } else {
        alert('Error: ' + (data.error || 'desconocido'));
      }
    } catch (e) {
      alert('Error de red: ' + e.message);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // 🚀 STREAM CONTROL
  // ═══════════════════════════════════════════════════════════════

  function scRenderEstado(target, activo) {
    const col = document.querySelector(`.sc-column[data-target="${target}"]`);
    const status = document.getElementById(`scStatus${target === 'obs' ? 'Obs' : 'Aitum'}`);
    if (!col || !status) return;

    col.classList.toggle('live', activo);
    const dot = status.querySelector('.sc-dot');
    const text = status.querySelector('span:last-child');

    if (activo) {
      if (text) text.textContent = 'LIVE';
    } else {
      if (text) text.textContent = 'Detenido';
    }
  }

  window.scIniciar = async function(target) {
    const label = target === 'obs' ? 'OBS (Horizontal)' : 'Aitum (Vertical)';
    if (!confirm(`¿Iniciar stream en ${label}?`)) return;

    try {
      const r = await fetch(apiURL('/api/stream-control/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target })
      });
      const data = await r.json();

      if (data.ok) {
        scRenderEstado(target, true);
      } else {
        alert('Error: ' + (data.error || 'desconocido'));
      }
    } catch (e) {
      alert('Error de red: ' + e.message);
    }
  };

  window.scDetener = async function(target) {
    const label = target === 'obs' ? 'OBS (Horizontal)' : 'Aitum (Vertical)';
    if (!confirm(`¿Detener stream en ${label}?`)) return;

    try {
      const r = await fetch(apiURL('/api/stream-control/stop'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target })
      });
      const data = await r.json();

      if (data.ok) {
        scRenderEstado(target, false);
      } else {
        alert('Error: ' + (data.error || 'desconocido'));
      }
    } catch (e) {
      alert('Error de red: ' + e.message);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // SOCKETS
  // ═══════════════════════════════════════════════════════════════

  if (typeof socket !== 'undefined' && socket) {
    socket.on('stream-keys:updated', () => skRecargar());
    socket.on('stream-keys:deleted', () => skRecargar());
    socket.on('stream-keys:applied', ({ target, platform }) => {
      console.log(`🔑 Clave aplicada: ${target}/${platform}`);
    });

    socket.on('obs:stream-state', ({ active }) => {
      scRenderEstado('obs', active);
    });

    socket.on('aitum:stream-state', ({ active }) => {
      scRenderEstado('aitum', active);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // ARRANQUE
  // ═══════════════════════════════════════════════════════════════

  document.addEventListener('DOMContentLoaded', () => {
    // Cargar catálogo y lista
    skCargarServers().then(() => skRecargar());

    // Auto-refresh cada 30s
    setInterval(skRecargar, 30000);
  });

  // Si el DOM ya está listo
  if (document.readyState !== 'loading') {
    skCargarServers().then(() => skRecargar());
    setInterval(skRecargar, 30000);
  }

  console.log('[stream-tools] Inicializado');
})();

// ════════════════════════════════════════════════════════════
// 🔑 STREAM TOOLS — Colapsable
// ════════════════════════════════════════════════════════════

const LS_KEY_STREAM_TOOLS_COLLAPSED = 'dashboard:streamToolsCollapsed';

function applyStreamToolsState(collapsed) {
    const wrapper = document.getElementById('streamToolsWrapper');
    const icon = document.getElementById('streamToolsToggleIcon');
    const text = document.getElementById('streamToolsToggleText');
    if (!wrapper) return;

    wrapper.classList.toggle('collapsed', collapsed);
    if (icon) icon.className = collapsed ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line';
    if (text) text.textContent = collapsed ? 'Mostrar' : 'Ocultar';
}

window.toggleStreamTools = function() {
    const wrapper = document.getElementById('streamToolsWrapper');
    if (!wrapper) return;

    const collapsed = !wrapper.classList.contains('collapsed');
    applyStreamToolsState(collapsed);

    try { localStorage.setItem(LS_KEY_STREAM_TOOLS_COLLAPSED, collapsed ? '1' : '0'); } catch (e) {}
};

(function initStreamToolsCollapse() {
    let collapsed = false;
    try { collapsed = localStorage.getItem(LS_KEY_STREAM_TOOLS_COLLAPSED) === '1'; } catch (e) {}
    applyStreamToolsState(collapsed);
})();