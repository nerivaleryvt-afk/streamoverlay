/* ════════════════════════════════════════════════════════════
   CONFIG
   ════════════════════════════════════════════════════════════ */
const _urlParams = new URLSearchParams(location.search);
const TOKEN = _urlParams.get('t') || '';
const API = (p) => `/api/deck${p}?t=${TOKEN}`;
const socket = io();

let STATE = { theme:'cristal', obs:{}, categories:[], buttons:[], widgets:[], userPrefs:null };
let STATS = { tiktok:{}, twitch:{}, youtube:{}, kick:{} };
let PREV_STATS = {};
let FILTER = 'all';
let OBS_CONNECTED = false;
let CURRENT_VIEW = 'deck';
let DECK_ENABLED = true;

/* handles de runtime */
let SOCKETS_STARTED = false;
let STATS_POLL_TIMER = null;
let RESOURCES_POLL_TIMER = null;

/* recursos */
let LAST_RESOURCES = null;
const RESOURCES_POLL_MS = 3000;

/* audio OBS */
let OBS_AUDIO_SOURCES = [];
let OBS_AUDIO_STATES = {}; // { inputName: { muted, volume } }

const YT = {
  superchats: 0,
  totalAmount: 0,
  members: 0,
  messages: 0,
  topSuperchatters: new Map(),
  topMembers: new Map(),
  topChatters: new Map()
};

const CHAT_MESSAGES = [];
const MAX_CHAT = 80;
const RECENT_MSG_KEYS = new Map();
let chatCount = 0;

const DEFAULT_PREFS = {
  views: { deck: true, dashboard: true, stats: true, overlays: true, config: true, aitum: true },
  panelRight: { stats: true, rankings: true, resources: true },
  chat: { translate: true, censor: false, avatars: true },
  theme: 'cristal'
};
let PREFS = JSON.parse(JSON.stringify(DEFAULT_PREFS));

let previewUrl = '';

let catSearchTimer = null;
let catResultsData = [];
let catResultIndex = 0;

/* AITUM */
const AITUM = {
  ok: false,
  vendor: null,
  scenes: [],
  current: null,
  status: { streaming:false, recording:false, backtrack:false, virtual_camera:false },
  loaded: false,
  pollTimer: null
};

const ICONS = [
  'ri-live-line','ri-stop-circle-line','ri-record-circle-line','ri-mic-line','ri-mic-off-line',
  'ri-music-2-line','ri-chat-3-line','ri-delete-bin-line','ri-refresh-line','ri-heart-3-fill',
  'ri-user-add-fill','ri-gift-fill','ri-eye-fill','ri-share-forward-fill','ri-money-dollar-circle-fill',
  'ri-star-fill','ri-fire-fill','ri-camera-line','ri-vidicon-line','ri-volume-up-line',
  'ri-volume-mute-line','ri-play-fill','ri-pause-circle-line','ri-skip-forward-line','ri-settings-3-line',
  'ri-dashboard-line','ri-gamepad-line','ri-trophy-fill','ri-emotion-happy-line','ri-thumb-up-fill',
  'ri-notification-3-line','ri-flashlight-fill','ri-moon-line','ri-sun-line','ri-cloud-line',
  'ri-rocket-line','ri-sword-line','ri-shield-star-line','ri-crown-fill','ri-vip-crown-fill',
  'ri-calendar-line','ri-time-line','ri-map-pin-line','ri-link','ri-code-line','ri-terminal-box-line',
  'ri-cpu-line','ri-database-2-line','ri-keyboard-line','ri-folder-line','ri-apps-2-line'
];
const COLORS = [
  '#5a8ad6','#4fa87a','#d6a84a','#c26a6a','#a78bfa',
  '#ff0050','#00f2ea','#ff7a3a','#3a6df0','#f472b6',
  '#22d3ee','#9198a4'
];
const ACTIONS = [
  {v:'obs:scene',l:'OBS → Cambiar escena',p:true},
  {v:'obs:record:start',l:'OBS → Grabar inicio'},
  {v:'obs:record:stop',l:'OBS → Grabar fin'},
  {v:'obs:stream:start',l:'OBS → Stream inicio'},
  {v:'obs:stream:stop',l:'OBS → Stream fin'},
  {v:'obs:mic:mute',l:'OBS → Silenciar mic (legacy)',p:true},
  {v:'obs:audio:mute',l:'OBS → Silenciar fuente (adaptativo)',p:'audio'},
  {v:'obs:audio:volume',l:'OBS → Volumen de fuente',p:'audio-volume'},
  {v:'obs:audio:mute:all',l:'OBS → Silenciar TODO'},
  {v:'obs:audio:unmute:all',l:'OBS → Reactivar TODO'},
  {v:'obs:audio:list',l:'OBS → Listar fuentes de audio'},
  {v:'obs:scene:list',l:'OBS → Listar escenas'},
  {v:'system:ram:reduce',l:'Sistema → Reducir RAM'},
  {v:'tts:speak',l:'TTS → Hablar'},
  {v:'tts:skip',l:'TTS → Saltar'},
  {v:'tts:pause',l:'TTS → Pausar'},
  {v:'chat:clear',l:'Chat → Limpiar'},
  {v:'tiktok:view',l:'TikTok → Cambiar vista',p:true},
  {v:'config:reload',l:'Config → Recargar'},
  {v:'custom:socket',l:'Custom → Socket libre',p:true}
];
const METRICS = {
  tiktok:['likes','follows','shares','diamonds','viewers','gifts','messages','top_gifters','top_likers','top_sharers'],
  twitch:['messages','bits','subs'],
  youtube:['superchats','members','messages','top_superchatters'],
  kick:['messages']
};
const PLATFORM_COLORS = { tiktok:'#ff0050', twitch:'#a78bfa', youtube:'#ff3d3d', kick:'#4fa87a' };

const OVERLAYS = [
  {
    id: 'hype-train',
    name: 'Hype Train',
    desc: 'Barra de hype train con tren y niveles',
    icon: 'ri-train-line',
    url: '/hype-train.html',
    actions: [
      { label: 'Iniciar', icon: 'ri-play-fill', cls: 'start', event: 'hype-train:start' },
      { label: 'Parar',   icon: 'ri-stop-fill', cls: 'stop',  event: 'hype-train:end' },
      { label: 'Reset',   icon: 'ri-refresh-line', cls: 'reset', event: 'hype-train:reset' }
    ]
  },
  {
    id: 'crystal',
    name: 'Crystal Jar',
    desc: 'Frasco de cristal con diamantes acumulados',
    icon: 'ri-goblet-fill',
    url: '/crystal.html',
    actions: [
      { label: 'Reset', icon: 'ri-refresh-line', cls: 'reset', event: 'jar-reset' }
    ]
  },
  {
    id: 'pride',
    name: 'Pride Flags',
    desc: 'Banderas pride con rotación y explicación',
    icon: 'ri-flag-2-fill',
    url: '/pride.html',
    actions: [
      { label: 'Pausar', icon: 'ri-pause-fill', cls: '', event: 'pride:pause' }
    ]
  },
  {
    id: 'follows',
    name: 'Último Seguidor',
    desc: 'Muestra el último seguidor de TikTok',
    icon: 'ri-user-add-fill',
    url: '/follows.html',
    actions: []
  },
  {
    id: 'stats-bar',
    name: 'Stats Bar',
    desc: 'Barra con likes, follows, shares y diamonds',
    icon: 'ri-bar-chart-fill',
    url: '/stats.html',
    actions: []
  },
  {
    id: 'top-donadores',
    name: 'Top Donadores',
    desc: 'Ranking de top donadores TikTok',
    icon: 'ri-trophy-fill',
    url: '/top-donadores.html',
    actions: []
  },
  {
    id: 'top-likes',
    name: 'Top Likes',
    desc: 'Ranking de usuarios con más likes',
    icon: 'ri-heart-3-fill',
    url: '/top-likes.html',
    actions: []
  },
  {
    id: 'top-shares',
    name: 'Top Compartidos',
    desc: 'Ranking de usuarios que más comparten',
    icon: 'ri-share-forward-fill',
    url: '/top-shares.html',
    actions: []
  }
];

/* ════════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════════ */
async function init(){
  if(!TOKEN){
    try {
      const r = await fetch('/api/deck-token');
      if(r.ok){
        const data = await r.json();
        if(data && data.token){
          const url = new URL(location.href);
          url.searchParams.set('t', data.token);
          location.replace(url.toString());
          return;
        }
      }
    } catch(e){}
    toast('No se pudo obtener token del servidor', 'err');
    return;
  }
  loadPrefs();
  applyPrefs();
  await loadConfig();
  syncPrefsFromServer();
  applyPrefs();
  applyTheme(PREFS.theme);
  await loadGlobalConfig();
  renderAll();
  bindUI();
  if(DECK_ENABLED) startRuntime();
}

async function loadConfig(){
  try {
    const r = await fetch(API(''));
    if(!r.ok){ toast('Error cargando config', 'err'); return; }
    STATE = await r.json();
    if(STATE.theme) PREFS.theme = STATE.theme;
    DECK_ENABLED = STATE.enabled !== false;
    applyDeckEnabled();
  } catch(e){
    console.error('loadConfig', e);
  }
}

/* ════════════════════════════════════════════════════════════
   CONFIG GLOBAL DEL SERVER (/get-config)
   ════════════════════════════════════════════════════════════ */
let GLOBAL_CONFIG = {};

async function loadGlobalConfig(){
  try {
    const r = await fetch('/get-config');
    if(r.ok){
      GLOBAL_CONFIG = await r.json();
      populateChannelSelects();
    }
  } catch(e){
    console.warn('[deck] No se pudo cargar /get-config:', e);
  }
}

function getAllTwitchChannels(){
  const accs = GLOBAL_CONFIG.TWITCH_ACCOUNTS || [];
  const set = new Set();
  accs.forEach(a => (a.channels || []).forEach(c => set.add(c)));
  if(set.size === 0 && Array.isArray(GLOBAL_CONFIG.channels)){
    GLOBAL_CONFIG.channels.forEach(c => set.add(c));
  }
  return Array.from(set);
}

function getAllTwitchAccounts(){
  const accs = GLOBAL_CONFIG.TWITCH_ACCOUNTS || [];
  return accs
    .filter(a => a.botUsername)
    .map(a => ({ username: a.botUsername, channels: a.channels || [] }));
}

function populateChannelSelects(){
  const channels = getAllTwitchChannels();
  const optionsHtml = channels.length
    ? channels.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')
    : `<option value="twitch">twitch</option>`;

  ['modChannel','pollChannel','streamChannel'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    const currentValue = el.value;
    if(el.tagName === 'SELECT'){
      el.innerHTML = optionsHtml;
      if(channels.includes(currentValue)) el.value = currentValue;
      return;
    }
    const select = document.createElement('select');
    select.id = id;
    select.className = el.className;
    select.style.marginBottom = el.style.marginBottom || '';
    select.innerHTML = optionsHtml;
    if(channels.includes(currentValue)) select.value = currentValue;
    el.replaceWith(select);
  });

  const accounts = getAllTwitchAccounts();
  const pickerBar = document.getElementById('accountPickerBar');
  const picker = document.getElementById('activeTwitchAccount');
  if(pickerBar && picker){
    if(accounts.length > 1){
      pickerBar.style.display = 'flex';
      picker.innerHTML = accounts.map(a=>`<option value="${esc(a.username)}">${esc(a.username)}</option>`).join('');
    } else {
      pickerBar.style.display = 'none';
    }
  }
}

/* ════════════════════════════════════════════════════════════
   PREFS
   ════════════════════════════════════════════════════════════ */
function loadPrefs(){
  try {
    const raw = localStorage.getItem('deck:prefs');
    if(raw){
      const parsed = JSON.parse(raw);
      PREFS = { ...DEFAULT_PREFS, ...parsed };
      PREFS.views = { ...DEFAULT_PREFS.views, ...(parsed.views||{}) };
      PREFS.panelRight = { ...DEFAULT_PREFS.panelRight, ...(parsed.panelRight||{}) };
      PREFS.chat = { ...DEFAULT_PREFS.chat, ...(parsed.chat||{}) };
    }
  } catch(e){}
}

function syncPrefsFromServer(){
  const serverPrefs = STATE && STATE.userPrefs;
  if(!serverPrefs || typeof serverPrefs !== 'object') return;
  PREFS = { ...DEFAULT_PREFS, ...serverPrefs };
  PREFS.views = { ...DEFAULT_PREFS.views, ...(serverPrefs.views||{}) };
  PREFS.panelRight = { ...DEFAULT_PREFS.panelRight, ...(serverPrefs.panelRight||{}) };
  PREFS.chat = { ...DEFAULT_PREFS.chat, ...(serverPrefs.chat||{}) };
  try { localStorage.setItem('deck:prefs', JSON.stringify(PREFS)); } catch(e){}
}

let _prefsSaveTimer = null;
function savePrefs(){
  try { localStorage.setItem('deck:prefs', JSON.stringify(PREFS)); } catch(e){}
  socket.emit('deck:prefs-updated', PREFS);

  clearTimeout(_prefsSaveTimer);
  _prefsSaveTimer = setTimeout(async ()=>{
    try {
      await fetch(API('/prefs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(PREFS)
      });
    } catch(e){
      console.warn('[deck] No se pudieron guardar prefs en el server:', e);
    }
  }, 400);
}

function applyPrefs(){
  document.body.classList.toggle('hide-view-dashboard', !PREFS.views.dashboard);
  document.body.classList.toggle('hide-view-stats', !PREFS.views.stats);
  document.body.classList.toggle('hide-view-overlays', !PREFS.views.overlays);
  document.body.classList.toggle('hide-view-aitum', !PREFS.views.aitum);
  document.body.classList.toggle('hide-view-config', !PREFS.views.config);

  if(!PREFS.views[CURRENT_VIEW] && CURRENT_VIEW !== 'deck'){
    switchView('deck');
  }

  const statsCardEl = document.getElementById('statsCard');
  if(statsCardEl) statsCardEl.style.display = PREFS.panelRight.stats ? '' : 'none';
  const topCardEl = document.getElementById('topCard');
  if(topCardEl && !PREFS.panelRight.rankings){
    topCardEl.style.display = 'none';
  }
  const resCardEl = document.getElementById('cardResources');
  if(resCardEl) resCardEl.style.display = PREFS.panelRight.resources === false ? 'none' : '';

  const elDash = document.getElementById('cfgViewDashboard');
  if(elDash) elDash.checked = PREFS.views.dashboard;
  const elStats = document.getElementById('cfgViewStats');
  if(elStats) elStats.checked = PREFS.views.stats;
  const elOv = document.getElementById('cfgViewOverlays');
  if(elOv) elOv.checked = PREFS.views.overlays;
  const cfgAitum = document.getElementById('cfgViewAitum');
  if(cfgAitum) cfgAitum.checked = PREFS.views.aitum;
  const elCfg = document.getElementById('cfgViewConfig');
  if(elCfg) elCfg.checked = PREFS.views.config;
  const elPanelStats = document.getElementById('cfgPanelStats');
  if(elPanelStats) elPanelStats.checked = PREFS.panelRight.stats;
  const elPanelRank = document.getElementById('cfgPanelRankings');
  if(elPanelRank) elPanelRank.checked = PREFS.panelRight.rankings;
  const elPanelRes = document.getElementById('cfgPanelResources');
  if(elPanelRes) elPanelRes.checked = PREFS.panelRight.resources !== false;
  const elTranslate = document.getElementById('cfgChatTranslate');
  if(elTranslate) elTranslate.checked = PREFS.chat.translate;
  const elCensor = document.getElementById('cfgChatCensor');
  if(elCensor) elCensor.checked = PREFS.chat.censor;
  const elAvatars = document.getElementById('cfgChatAvatars');
  if(elAvatars) elAvatars.checked = PREFS.chat.avatars;

  document.querySelectorAll('.theme-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.theme === PREFS.theme);
  });
}

function applyTheme(theme){
  PREFS.theme = theme;
  document.body.className = 'theme-' + theme;
  document.querySelectorAll('.theme-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.theme === theme);
  });
  savePrefs();
}

/* ════════════════════════════════════════════════════════════
   ON/OFF DEL DECK
   ════════════════════════════════════════════════════════════ */
function applyDeckEnabled(){
  const offModal = document.getElementById('deckOffModal');
  const powerPill = document.getElementById('deckPowerPill');
  const powerText = document.getElementById('deckPowerText');

  if(DECK_ENABLED){
    if(offModal) offModal.classList.remove('show');
    if(powerPill){
      powerPill.className = 'pill ok';
      if(powerText) powerText.textContent = 'ON';
    }
  } else {
    if(offModal) offModal.classList.add('show');
    if(powerPill){
      powerPill.className = 'pill danger';
      if(powerText) powerText.textContent = 'OFF';
    }
  }
  try { localStorage.setItem('deck:enabled', DECK_ENABLED ? '1' : '0'); } catch(e){}
}

function startRuntime(){
  if(!SOCKETS_STARTED){
    connectSockets();
    SOCKETS_STARTED = true;
  }
  startStatsPolling();
  startAitumPolling();
  startResourcesPolling();
  loadStreamInfo();
  loadObsAudioSources();
  loadSystemResources();
}

function stopRuntime(){
  if(STATS_POLL_TIMER){ clearInterval(STATS_POLL_TIMER); STATS_POLL_TIMER = null; }
  if(AITUM.pollTimer){ clearInterval(AITUM.pollTimer); AITUM.pollTimer = null; }
  if(RESOURCES_POLL_TIMER){ clearInterval(RESOURCES_POLL_TIMER); RESOURCES_POLL_TIMER = null; }
  if(SOCKETS_STARTED){
    socket.removeAllListeners();
    SOCKETS_STARTED = false;
  }
}

async function setDeckEnabled(enabled){
  try {
    const r = await fetch(API('/enabled'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    if(!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    DECK_ENABLED = !!data.enabled;
    applyDeckEnabled();
    if(DECK_ENABLED){
      startRuntime();
      toast('Deck activado', 'ok');
    } else {
      stopRuntime();
      toast('Deck desactivado', 'ok');
    }
  } catch(e){
    toast('Error cambiando estado', 'err');
    console.error(e);
  }
}

/* ════════════════════════════════════════════════════════════
   VISTAS
   ════════════════════════════════════════════════════════════ */
function switchView(view){
  CURRENT_VIEW = view;
  document.querySelectorAll('.nav-item[data-view]').forEach(n=>{
    n.classList.toggle('active', n.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const el = document.getElementById('view-' + view);
  if(el) el.classList.add('active');

  const TITLES = {
    deck: { icon: 'ri-layout-grid-fill', title: 'Deck de Control', sub: 'Pulsa un botón o añade uno nuevo a tu categoría' },
    dashboard: { icon: 'ri-dashboard-3-line', title: 'Dashboard', sub: 'Chat unificado, moderación, encuestas y control del stream' },
    stats: { icon: 'ri-bar-chart-fill', title: 'Estadísticas', sub: 'Datos en vivo de todas las plataformas' },
    overlays: { icon: 'ri-stack-line', title: 'Overlays', sub: 'Controla y previsualiza tus overlays' },
    aitum: { icon: 'ri-crop-2-line', title: 'Aitum Vertical', sub: 'Escenas verticales y control de outputs' },
    config: { icon: 'ri-settings-3-line', title: 'Configuración', sub: 'Personaliza tu experiencia' }
  };
  const t = TITLES[view] || TITLES.deck;
  document.getElementById('viewTitle').innerHTML = `<i class="${t.icon}"></i> ${t.title}`;
  document.getElementById('viewSubtitle').textContent = t.sub;

  document.getElementById('newBtnBtn').style.display = view === 'deck' ? '' : 'none';

  if(view === 'aitum') loadAitumState();

  if(window.innerWidth <= 900){
    document.querySelector('.sidebar').classList.remove('open');
    document.getElementById('mobileOverlay').classList.remove('show');
  }
}

/* ════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════ */
function renderAll(){
  renderCatNav();
  renderCatFilters();
  renderGrid();
  renderLive();
  renderStatsView();
  renderOverlays();
  renderObsStatus();
  renderResources();
}

function renderCatNav(){
  const el = document.getElementById('catNavList');
  el.innerHTML = STATE.categories.map(c=>{
    const count = STATE.buttons.filter(b=>b.categoryId===c.id).length;
    return `<div class="nav-item ${FILTER===c.id?'active':''}" data-cat="${c.id}">
      <span class="dot" style="background:${c.color}"></span>
      <span>${esc(c.name)}</span>
      <span class="count">${count}</span>
      <button class="edit-cat-mini" data-editcat="${c.id}"><i class="ri-pencil-line"></i></button>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-cat]').forEach(n=>{
    n.onclick = (e)=>{
      const edit = e.target.closest('[data-editcat]');
      if(edit){ openCatModal(edit.dataset.editcat); return; }
      FILTER = (FILTER===n.dataset.cat) ? 'all' : n.dataset.cat;
      switchView('deck');
      renderCatNav(); renderCatFilters(); renderGrid();
    };
  });
}

function renderCatFilters(){
  const el = document.getElementById('catFilters');
  el.innerHTML = `
    <div class="cat-chip ${FILTER==='all'?'active':''}" data-id="all">
      <span class="dot" style="background:#5a8ad6"></span>Todos
    </div>
    ${STATE.categories.map(c=>`
      <div class="cat-chip ${FILTER===c.id?'active':''}" data-id="${c.id}">
        <span class="dot" style="background:${c.color}"></span>${esc(c.name)}
      </div>
    `).join('')}
  `;
  el.querySelectorAll('.cat-chip').forEach(ch=>ch.onclick=()=>{
    FILTER = ch.dataset.id;
    renderCatNav(); renderCatFilters(); renderGrid();
  });
}

function renderGrid(){
  const el = document.getElementById('gridWrap');
  const cats = FILTER==='all' ? STATE.categories : STATE.categories.filter(c=>c.id===FILTER);

  if(!cats.length){
    el.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text-muted)">
      <i class="ri-inbox-line" style="font-size:48px;opacity:.4;display:block;margin-bottom:12px"></i>
      <p style="font-size:14px;font-weight:600">No hay categorías todavía</p>
      <p style="font-size:12px;margin-top:6px">Pulsa + en "Mis categorías" para crear una</p>
    </div>`;
    return;
  }

  el.innerHTML = cats.map(c=>{
    const btns = STATE.buttons.filter(b=>b.categoryId===c.id);
    return `
      <div class="cat-group">
        <div class="cat-group-header">
          <div class="icon" style="background:${hexA(c.color,0.1)};color:${c.color};border:1px solid ${hexA(c.color,0.25)}">
            <i class="${c.icon}"></i>
          </div>
          <h2>${esc(c.name)}</h2>
          <div class="line"></div>
          <span class="badge">${btns.length}</span>
          <button class="edit-cat" data-editcat="${c.id}" title="Editar categoría">
            <i class="ri-settings-3-line"></i>
          </button>
        </div>
        <div class="grid">
          ${btns.map(b=>{
            const isAudio = typeof b.action === 'string' && b.action.startsWith('obs:audio:mute');
            const src = b.payload && b.payload.source;
            const muted = isAudio && src && OBS_AUDIO_STATES[src] && OBS_AUDIO_STATES[src].muted;
            return `
              <div class="deck-btn ${muted?'muted':''}" data-trigger="${b.id}" data-action="${esc(b.action)}" data-source="${esc(src||'')}">
                <small>${esc(b.action)}</small>
                <i class="${b.icon}" style="color:${b.color}"></i>
                <span>${esc(b.label)}</span>
                ${muted ? '<span class="deck-btn-mute-dot"></span>' : ''}
              </div>
            `;
          }).join('')}
          <div class="deck-btn empty" data-addbtn="${c.id}">
            <i class="ri-add-line"></i>
            <span>Añadir</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  el.querySelectorAll('[data-trigger]').forEach(b=>{
  b.onclick = ()=>trigger(b.dataset.trigger);
  b.oncontextmenu = (e)=>{
    e.preventDefault();
    openBtnModal(b.dataset.trigger);
  };
  let pressTimer = null;
  b.addEventListener('touchstart', ()=>{
    pressTimer = setTimeout(()=>{
      pressTimer = null;
      openBtnModal(b.dataset.trigger);
      if(navigator.vibrate) navigator.vibrate(30);
    }, 500);
  }, { passive: true });
  b.addEventListener('touchend', (e)=>{
    if(pressTimer){
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  });
  b.addEventListener('touchmove', ()=>{
    if(pressTimer){
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  });
});
  el.querySelectorAll('[data-addbtn]').forEach(b=>b.onclick=()=>openBtnModal(null, b.dataset.addbtn));
  el.querySelectorAll('[data-editcat]').forEach(b=>b.onclick=()=>openCatModal(b.dataset.editcat));
}

function renderLive(){
  const el = document.getElementById('statsList');
  if(!PREFS.panelRight.stats){
    el.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:12px">Panel desactivado</div>`;
    return;
  }
  const statWidgets = STATE.widgets.filter(w=>w.type==='stat');
  if(!statWidgets.length){
    el.innerHTML = `<div style="text-align:center;padding:20px 8px;color:var(--text-muted);font-size:12px;font-style:italic">
      Sin widgets. Pulsa "Añadir widget"
    </div>`;
  } else {
    el.innerHTML = statWidgets.map(w=>{
      const val = getMetric(w.platform, w.metric);
      const prev = PREV_STATS[w.id];
      const delta = (typeof val==='number' && typeof prev==='number') ? val - prev : 0;
      return `
        <div class="stat-row" data-wid="${w.id}" title="Clic para editar">
          <button class="widget-del" data-delwid="${w.id}" title="Eliminar widget">
            <i class="ri-close-line"></i>
          </button>
          <div class="stat-icon" style="background:${hexA(w.color,0.1)};color:${w.color}">
            <i class="${w.icon}"></i>
          </div>
          <div class="stat-info">
            <div class="stat-value">${fmt(val)}</div>
            <div class="stat-label">${esc(w.title)}</div>
          </div>
          <div class="stat-delta ${delta>0?'show':''}">${delta>0?'+'+delta:''}</div>
        </div>
      `;
    }).join('');

    el.querySelectorAll('[data-delwid]').forEach(btn=>{
      btn.onclick = (e)=>{
        e.stopPropagation();
        quickDeleteWidget(btn.dataset.delwid);
      };
    });
    el.querySelectorAll('.stat-row[data-wid]').forEach(row=>{
      row.onclick = (e)=>{
        if(e.target.closest('[data-delwid]')) return;
        openWidgetModal(row.dataset.wid);
      };
    });
  }

  const rankWidget = STATE.widgets.find(w=>w.type==='ranking');
  const topCard = document.getElementById('topCard');
  if(rankWidget && PREFS.panelRight.rankings){
    topCard.style.display = 'block';
    document.getElementById('topTitle').textContent = rankWidget.title;
    const list = getMetric(rankWidget.platform, rankWidget.metric);
    const topList = document.getElementById('topList');
    if(!Array.isArray(list) || !list.length){
      topList.innerHTML = `<div class="top-empty">Sin datos todavía</div>`;
    } else {
      topList.innerHTML = list.slice(0,5).map((it,i)=>`
        <div class="top-row ${i<3?'p'+(i+1):''}">
          <div class="top-rank">${i+1}</div>
          <img class="top-avatar" src="${esc(it.avatar||'https://i.pravatar.cc/60?u='+encodeURIComponent(it.name||it.user||i))}" alt="">
          <div class="top-name">${esc(it.name||it.user||'—')}</div>
          <div class="top-value"><i class="ri-vip-diamond-fill"></i>${fmt(it.value||it.count||0)}</div>
        </div>
      `).join('');
    }
    document.getElementById('topEditBtn').onclick = ()=>openWidgetModal(rankWidget.id);
  } else {
    topCard.style.display = 'none';
  }

  statWidgets.forEach(w=>{ PREV_STATS[w.id] = getMetric(w.platform, w.metric); });
}

function renderStatsView(){
  let totalLikes = 0, totalFollows = 0, totalShares = 0, totalDiamonds = 0, totalViewers = 0;
  const gifters = new Map(), likers = new Map(), sharers = new Map();

  const tiktokAgg = STATS.tiktok || {};
  totalLikes = Number(tiktokAgg.likes) || 0;
  totalFollows = Number(tiktokAgg.follows) || 0;
  totalShares = Number(tiktokAgg.shares) || 0;
  totalDiamonds = Number(tiktokAgg.diamonds) || 0;
  totalViewers = Number(tiktokAgg.viewers) || 0;

  (tiktokAgg.topGifters || []).forEach(g=>{
    const key = String(g.username||'').toLowerCase();
    const cur = gifters.get(key) || { username: g.username, avatar: g.avatar, value: 0 };
    cur.value += Number(g.diamantes)||0;
    gifters.set(key, cur);
  });
  (tiktokAgg.topLikers || []).forEach(l=>{
    const key = String(l.username||'').toLowerCase();
    const cur = likers.get(key) || { username: l.username, avatar: l.avatar, value: 0 };
    cur.value += Number(l.likes)||0;
    likers.set(key, cur);
  });
  (tiktokAgg.topSharers || []).forEach(s=>{
    const key = String(s.username||'').toLowerCase();
    const cur = sharers.get(key) || { username: s.username, avatar: s.avatar, value: 0 };
    cur.value += Number(s.veces)||0;
    sharers.set(key, cur);
  });

  document.getElementById('stTkLikes').textContent = fmt(totalLikes);
  document.getElementById('stTkFollows').textContent = fmt(totalFollows);
  document.getElementById('stTkShares').textContent = fmt(totalShares);
  document.getElementById('stTkDiamonds').textContent = fmt(totalDiamonds);
  document.getElementById('stTkViewers').textContent = fmt(totalViewers);

  renderTable('stTopGifters', Array.from(gifters.values()).sort((a,b)=>b.value-a.value).slice(0,10), '💎');
  renderTable('stTopLikers', Array.from(likers.values()).sort((a,b)=>b.value-a.value).slice(0,10), '❤️');
  renderTable('stTopSharers', Array.from(sharers.values()).sort((a,b)=>b.value-a.value).slice(0,10), '🔗');

  document.getElementById('stYtSuperchats').textContent = fmt(YT.superchats);
  document.getElementById('stYtAmount').textContent = '$' + YT.totalAmount.toFixed(2);
  document.getElementById('stYtMembers').textContent = fmt(YT.members);
  document.getElementById('stYtMessages').textContent = fmt(YT.messages);

  const ytSuper = Array.from(YT.topSuperchatters.entries())
    .map(([username, value])=>({ username, value }))
    .sort((a,b)=>b.value-a.value).slice(0,10);
  renderTable('stTopSuperchatters', ytSuper, '$', true);

  const ytMembers = Array.from(YT.topMembers.entries())
    .map(([username, value])=>({ username, value }))
    .sort((a,b)=>b.value-a.value).slice(0,10);
  renderTable('stTopMembers', ytMembers, '⭐');

  const ytChatters = Array.from(YT.topChatters.entries())
    .map(([username, value])=>({ username, value }))
    .sort((a,b)=>b.value-a.value).slice(0,10);
  renderTable('stTopChatters', ytChatters, '💬');
}

function renderTable(tbodyId, data, emoji, isMoney=false){
  const el = document.getElementById(tbodyId);
  if(!el) return;
  if(!data.length){
    el.innerHTML = `<tr><td colspan="3" class="empty">Sin datos todavía</td></tr>`;
    return;
  }
  el.innerHTML = data.map((d,i)=>{
    const val = isMoney ? '$' + Number(d.value||0).toFixed(2) : `${emoji} ${fmt(d.value||0)}`;
    return `<tr class="${i<3?'rank-'+(i+1):''}">
      <td class="rank">#${i+1}</td>
      <td class="uname" title="${esc(d.username)}">${esc(d.username)}</td>
      <td class="val">${val}</td>
    </tr>`;
  }).join('');
}

function renderOverlays(){
  const el = document.getElementById('overlaysGrid');
  el.innerHTML = OVERLAYS.map(o=>`
    <div class="overlay-card">
      <div class="overlay-card-head">
        <div class="icon"><i class="${o.icon}"></i></div>
        <div>
          <h3>${esc(o.name)}</h3>
          <p>${esc(o.desc)}</p>
        </div>
      </div>
      <div class="overlay-card-actions">
        ${o.actions.map(a=>`
          <button class="overlay-btn ${a.cls||''}" onclick="overlayAction('${o.id}','${a.event}')">
            <i class="${a.icon}"></i> ${a.label}
          </button>
        `).join('')}
        <button class="overlay-btn" onclick="overlayPreview('${o.id}')">
          <i class="ri-eye-line"></i> Preview
        </button>
      </div>
    </div>
  `).join('');
}

function overlayAction(id, event){
  const o = OVERLAYS.find(x=>x.id===id);
  if(!o) return;
  socket.emit(event, {});
  toast(`${o.name}: ${event.split(':').pop()}`, 'ok');
}

function overlayPreview(id){
  const o = OVERLAYS.find(x=>x.id===id);
  if(!o) return;
  previewUrl = o.url;
  document.getElementById('previewTitle').textContent = o.name;
  document.getElementById('previewFrame').src = o.url;
  openModal('previewModal');
}

function openPreviewInNewWindow(){
  if(previewUrl) window.open(previewUrl, '_blank', 'width=900,height=600');
}

/* CHAT */
function isDuplicateMsg(msg){
  if(!msg || !msg.username || !msg.message) return false;
  const key = `${msg.platform||'twitch'}|${msg.username}|${msg.message}`.toLowerCase();
  const now = Date.now();
  const last = RECENT_MSG_KEYS.get(key);
  if(last && (now - last) < 8000) return true;
  RECENT_MSG_KEYS.set(key, now);
  return false;
}

function addChatMessage(msg){
  if(!msg || !msg.username) return;
  if(isDuplicateMsg(msg)) return;

  const entry = {
    id: 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
    username: msg.username,
    avatar: msg.avatar,
    platform: (msg.platform || 'twitch').toLowerCase(),
    message: msg.message || '',
    translated: null,
    sourceLang: null
  };
  CHAT_MESSAGES.unshift(entry);
  if(CHAT_MESSAGES.length > MAX_CHAT) CHAT_MESSAGES.length = MAX_CHAT;
  chatCount++;
  const badge = document.getElementById('chatCountBadge');
  if(badge) badge.textContent = chatCount;

  if(entry.platform === 'youtube'){
    YT.messages++;
    const u = entry.username;
    YT.topChatters.set(u, (YT.topChatters.get(u)||0) + 1);
    renderStatsView();
  }

  renderChatFeed();

  if(PREFS.chat.translate && entry.message){
    queueTranslate(entry);
  }
}

function renderChatFeed(){
  const el = document.getElementById('dashChatFeed');
  if(!el) return;
  if(!CHAT_MESSAGES.length){
    el.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:30px 10px">
      Esperando mensajes...
    </div>`;
    return;
  }
  el.innerHTML = CHAT_MESSAGES.slice(0,40).map(m=>{
    const avatar = PREFS.chat.avatars
      ? `<img class="chat-avatar" src="${esc(m.avatar||'https://i.imgur.com/OmnpuQH.png')}" onerror="this.src='https://i.imgur.com/OmnpuQH.png'">`
      : '';
    const text = m.translated && m.sourceLang && m.sourceLang !== 'es'
      ? `<span class="lang-flag">${getLangFlag(m.sourceLang)}</span>${esc(m.translated)}`
      : esc(m.message);
    const platform = m.platform || 'twitch';
    const safeUser = esc(m.username).replace(/'/g,"\\'");
    return `
      <div class="chat-msg">
        ${avatar}
        <div class="chat-body">
          <div class="chat-name">
            <span>${esc(m.username)}</span>
            <span class="platform-badge platform-${platform}">${platform}</span>
          </div>
          <div class="chat-text">${text}</div>
        </div>
        <div class="chat-actions">
          <button onclick="quickMod('${safeUser}','ban')"><i class="ri-forbid-2-line"></i></button>
          <button onclick="quickMod('${safeUser}','timeout')"><i class="ri-time-line"></i></button>
          <button onclick="quickMod('${safeUser}','warn')"><i class="ri-alert-line"></i></button>
        </div>
      </div>
    `;
  }).join('');
}

function quickMod(username, action){
  const channelEl = document.getElementById('modChannel');
  const channel = (channelEl && channelEl.value) || 'twitch';
  const payload = { channel, username, action };
  if(action === 'timeout') payload.seconds = 600;
  if(action === 'ban') payload.reason = 'Ban rápido desde deck';
  if(action === 'warn') payload.reason = 'Advertencia desde deck';
  socket.emit('mod-command', payload);
  toast(`${action}: ${username}`, 'ok');
}

const TRANSLATION_CACHE = new Map();
function getLangFlag(lang){
  const flags = { en:'🇺🇸', es:'🇪🇸', pt:'🇧🇷', fr:'🇫🇷', de:'🇩🇪', it:'🇮🇹', ja:'🇯🇵', ko:'🇰🇷', ru:'🇷🇺', ar:'🇸🇦', zh:'🇨🇳', tr:'🇹🇷' };
  return flags[lang] || '🌐';
}
function detectLang(text){
  if(!text) return 'en';
  if(/[áéíóúñ¿¡]/i.test(text)) return 'es';
  if(/[\u3040-\u30FF]/.test(text)) return 'ja';
  if(/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  if(/[\uAC00-\uD7AF]/.test(text)) return 'ko';
  if(/[\u0600-\u06FF]/.test(text)) return 'ar';
  if(/[\u0400-\u04FF]/.test(text)) return 'ru';
  return 'en';
}
function queueTranslate(entry){
  const src = detectLang(entry.message);
  if(src === 'es') return;
  const key = entry.message + '|es';
  if(TRANSLATION_CACHE.has(key)){
    entry.translated = TRANSLATION_CACHE.get(key);
    entry.sourceLang = src;
    renderChatFeed();
    return;
  }
  fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(entry.message)}&langpair=${src}|es`)
    .then(r => r.json())
    .then(d=>{
      const t = d && d.responseData && d.responseData.translatedText;
      if(t && !/^(please|quota|invalid)/i.test(t)){
        TRANSLATION_CACHE.set(key, t);
        entry.translated = t;
        entry.sourceLang = src;
        renderChatFeed();
      }
    })
    .catch(()=>{});
}

function dashMod(action){
  const channelEl = document.getElementById('modChannel');
  const channel = (channelEl && channelEl.value.trim()) || 'twitch';
  const username = document.getElementById('modUsername').value.trim();
  const reason = document.getElementById('modReason').value.trim();
  if(!username){ toast('Falta usuario', 'err'); return; }
  const payload = { channel, username, action };
  if(reason) payload.reason = reason;
  if(action === 'timeout') payload.seconds = 600;
  socket.emit('mod-command', payload);
  toast(`${action}: ${username}`, 'ok');
  document.getElementById('modUsername').value = '';
  document.getElementById('modReason').value = '';
}

function dashAddPollOpt(){
  const container = document.getElementById('pollOptions');
  const n = container.children.length + 1;
  const div = document.createElement('div');
  div.className = 'poll-opt-row';
  div.style.marginBottom = '6px';
  div.innerHTML = `<input class="mod-input poll-opt" placeholder="Opción ${n}">
    <button onclick="this.parentElement.remove()"><i class="ri-close-line"></i></button>`;
  container.appendChild(div);
}

function dashCreatePoll(){
  const channelEl = document.getElementById('pollChannel');
  const channel = (channelEl && channelEl.value.trim()) || 'twitch';
  const question = document.getElementById('pollQuestion').value.trim();
  const options = Array.from(document.querySelectorAll('.poll-opt'))
    .map(i=>i.value.trim()).filter(Boolean);
  if(!question || options.length < 2){
    toast('Falta pregunta o al menos 2 opciones', 'err');
    return;
  }
  socket.emit('create-twitch-poll', { channel, question, options, duration: 300 });
  toast('Encuesta creada', 'ok');
  document.getElementById('pollQuestion').value = '';
  document.querySelectorAll('.poll-opt').forEach(i=>i.value='');
}

function dashChangeTitle(){
  const channelEl = document.getElementById('streamChannel');
  const channel = (channelEl && channelEl.value.trim()) || 'twitch';
  const title = document.getElementById('streamTitle').value.trim();
  if(!title){ toast('Escribe un título', 'err'); return; }
  socket.emit('change-title', { channel, title });
  toast('Cambiando título...', 'ok');
}

function openCatSearch(){
  document.getElementById('catSearchInput').value = '';
  document.getElementById('catResults').innerHTML = `
    <div class="cat-result" style="cursor:default;opacity:0.6">
      <div class="empty-img"></div>
      <div class="cat-result-info">
        <div class="name">Escribe al menos 2 letras...</div>
        <div class="id">Se buscará en la API de Twitch</div>
      </div>
    </div>`;
  openModal('catSearchModal');
  setTimeout(()=>document.getElementById('catSearchInput').focus(), 200);
}

function debouncedCatSearch(){
  clearTimeout(catSearchTimer);
  const q = document.getElementById('catSearchInput').value.trim();
  if(q.length < 2){
    document.getElementById('catResults').innerHTML = `
      <div class="cat-result" style="cursor:default;opacity:0.6">
        <div class="empty-img"></div>
        <div class="cat-result-info">
          <div class="name">Escribe al menos 2 letras...</div>
        </div>
      </div>`;
    return;
  }
  catSearchTimer = setTimeout(()=>searchCategories(q), 320);
}

async function searchCategories(query){
  const channelEl = document.getElementById('streamChannel');
  const channel = (channelEl && channelEl.value.trim()) || 'twitch';
  const box = document.getElementById('catResults');
  box.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">Buscando...</div>`;
  try {
    const r = await fetch(`/api/twitch/search-category?q=${encodeURIComponent(query)}&channel=${encodeURIComponent(channel)}`);
    const data = await r.json();
    if(!data.ok || !Array.isArray(data.results) || !data.results.length){
      box.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">Sin resultados</div>`;
      return;
    }
    catResultsData = data.results;
    catResultIndex = 0;
    box.innerHTML = data.results.map((cat, i)=>`
      <div class="cat-result ${i===0?'active':''}" data-idx="${i}">
        ${cat.boxArt ? `<img src="${esc(cat.boxArt)}" onerror="this.style.display='none'">` : `<div class="empty-img"></div>`}
        <div class="cat-result-info">
          <div class="name">${esc(cat.name)}</div>
          <div class="id">ID: ${esc(cat.id)}</div>
        </div>
      </div>
    `).join('');
    box.querySelectorAll('.cat-result').forEach(el=>{
      el.onclick = ()=>pickCatResult(parseInt(el.dataset.idx));
    });
  } catch(e){
    box.innerHTML = `<div style="padding:20px;text-align:center;color:var(--danger);font-size:12px">Error de red</div>`;
  }
}

function pickCatResult(idx){
  const cat = catResultsData[idx];
  if(!cat) return;
  const channelEl = document.getElementById('streamChannel');
  const channel = (channelEl && channelEl.value.trim()) || 'twitch';
  socket.emit('change-category', { channel, category: cat.id });
  toast(`Categoría: ${cat.name}`, 'ok');
  closeModal('catSearchModal');
  setTimeout(loadStreamInfo, 500);
}

function pickFirstCatResult(){
  if(catResultsData.length > 0) pickCatResult(0);
}

async function loadStreamInfo(){
  const channelEl = document.getElementById('streamChannel');
  const channel = (channelEl && channelEl.value.trim()) || 'twitch';
  try {
    const r = await fetch(`/api/twitch/stream-info?channel=${encodeURIComponent(channel)}`);
    const data = await r.json();
    if(data.ok){
      document.getElementById('currentTitle').textContent = data.title || '—';
      document.getElementById('currentCategory').textContent = data.gameName || '—';
      document.getElementById('streamTitle').value = data.title || '';
    }
  } catch(e){}
}

/* HELPERS */
function getMetric(platform, metric){
  const p = STATS[platform] || {};
  return p[metric] ?? 0;
}
function fmt(n){
  if(typeof n !== 'number') return n;
  if(n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if(n >= 1e3) return (n/1e3).toFixed(1)+'k';
  return n;
}
function hexA(hex, alpha){
  const h = hex.replace('#','');
  const r = parseInt(h.substring(0,2),16);
  const g = parseInt(h.substring(2,4),16);
  const b = parseInt(h.substring(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function esc(s){
  return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function formatUptime(ms){
  if(!ms || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if(days > 0) return `${days}d ${hours}h`;
  if(hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
let toastTimer;
function toast(msg, type=''){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2500);
}

function startStatsPolling(){
  if(STATS_POLL_TIMER) clearInterval(STATS_POLL_TIMER);
  STATS_POLL_TIMER = setInterval(()=>{
    fetch(API('/stats'))
      .then(r=>r.json())
      .then(s=>{ STATS = s; renderLive(); renderStatsView(); })
      .catch(()=>{});
  }, 4000);
}

/* ════════════════════════════════════════════════════════════
   RECURSOS DEL SISTEMA
   ════════════════════════════════════════════════════════════ */
function startResourcesPolling(){
  if(RESOURCES_POLL_TIMER) clearInterval(RESOURCES_POLL_TIMER);
  RESOURCES_POLL_TIMER = setInterval(loadSystemResources, RESOURCES_POLL_MS);
}

async function loadSystemResources(){
  try {
    const r = await fetch(API('/system/resources'));
    if(!r.ok) return;
    const data = await r.json();
    if(!data.ok) return;
    LAST_RESOURCES = data;
    renderResources();
  } catch(e){
    // silencioso
  }
}

function renderResources(){
  const el = document.getElementById('resBody');
  if(!el) return;
  const d = LAST_RESOURCES;
  if(!d){
    el.innerHTML = `<div class="res-empty">Cargando recursos…</div>`;
    return;
  }

  const ramPct = d.ram && typeof d.ram.pct === 'number' ? d.ram.pct : 0;
  const cpuPct = d.cpu && typeof d.cpu.pct === 'number' ? d.cpu.pct : 0;
  const diskPct = d.disco && typeof d.disco.pct === 'number' ? d.disco.pct : 0;
  const ramUsedGB = d.ram ? (d.ram.usadaMB / 1024).toFixed(1) : '—';
  const ramTotalGB = d.ram ? (d.ram.totalMB / 1024).toFixed(0) : '—';
  const diskUsedGB = d.disco ? d.disco.usadaGB : '—';
  const diskTotalGB = d.disco ? d.disco.totalGB : '—';

  const gpuHtml = (Array.isArray(d.gpu) && d.gpu.length)
    ? d.gpu.map(g=>{
        const pct = (g.pct === null || g.pct === undefined) ? null : g.pct;
        const pctTxt = pct === null ? '—' : pct + '%';
        const cls = pct === null ? 'unknown' : pctClass(pct);
        const barW = pct === null ? 0 : Math.min(100, pct);
        return `
          <div class="res-row res-gpu-row">
            <div class="res-label" title="${esc(g.name)}">
              <i class="ri-cpu-line"></i>
              <span class="res-gpu-name">${esc(shortGpuName(g.name))}</span>
            </div>
            <div class="res-bar">
              <div class="res-bar-fill ${cls}" style="width:${barW}%"></div>
            </div>
            <div class="res-value ${cls}">${pctTxt}</div>
          </div>
        `;
      }).join('')
    : `<div class="res-row"><div class="res-label"><i class="ri-cpu-line"></i><span>GPU</span></div><div class="res-bar"><div class="res-bar-fill unknown" style="width:0%"></div></div><div class="res-value unknown">—</div></div>`;

  el.innerHTML = `
    <div class="res-row">
      <div class="res-label"><i class="ri-database-2-line"></i><span>RAM</span></div>
      <div class="res-bar"><div class="res-bar-fill ${pctClass(ramPct)}" style="width:${Math.min(100,ramPct)}%"></div></div>
      <div class="res-value ${pctClass(ramPct)}">${ramPct}%</div>
      <div class="res-sub">${ramUsedGB} / ${ramTotalGB} GB</div>
    </div>

    <div class="res-row">
      <div class="res-label"><i class="ri-cpu-line"></i><span>CPU</span></div>
      <div class="res-bar"><div class="res-bar-fill ${pctClass(cpuPct)}" style="width:${Math.min(100,cpuPct)}%"></div></div>
      <div class="res-value ${pctClass(cpuPct)}">${cpuPct}%</div>
      <div class="res-sub"></div>
    </div>

    <div class="res-gpu-section">
      <div class="res-gpu-title"><i class="ri-cpu-line"></i> GPU</div>
      ${gpuHtml}
    </div>

    <div class="res-row">
      <div class="res-label"><i class="ri-hard-drive-2-line"></i><span>Disco ${esc(d.disco?.letra||'C:')}</span></div>
      <div class="res-bar"><div class="res-bar-fill ${pctClass(diskPct)}" style="width:${Math.min(100,diskPct)}%"></div></div>
      <div class="res-value ${pctClass(diskPct)}">${diskPct}%</div>
      <div class="res-sub">${diskUsedGB} / ${diskTotalGB} GB</div>
    </div>

    <div class="res-row res-row-uptime">
      <div class="res-label"><i class="ri-time-line"></i><span>Uptime</span></div>
      <div class="res-uptime">${formatUptime(d.uptimeMs)}</div>
    </div>
  `;
}

function pctClass(pct){
  if(typeof pct !== 'number') return 'unknown';
  if(pct >= 90) return 'danger';
  if(pct >= 70) return 'warn';
  return 'ok';
}

function shortGpuName(name){
  if(!name) return 'GPU';
  // Acortar nombres largos: "NVIDIA GeForce RTX 3060" → "RTX 3060"
  const m = name.match(/(RTX|GTX|RX|Arc|Radeon|UHD|Iris|Vega)\s*[A-Za-z0-9 ]+/i);
  if(m) return m[0].trim();
  if(name.length > 18) return name.slice(0, 16) + '…';
  return name;
}

async function reduceRam(){
  const btn = document.getElementById('resReduceBtn');
  if(btn){ btn.disabled = true; btn.classList.add('loading'); }
  try {
    const r = await fetch(API('/system/ram/reduce'), { method: 'POST' });
    const data = await r.json();
    if(data && data.ok && data.result){
      const lib = data.result.liberadaMB || 0;
      toast(`RAM liberada: ${lib} MB`, 'ok');
      setTimeout(loadSystemResources, 600);
    } else {
      toast(data.error || 'No se pudo reducir RAM', 'err');
    }
  } catch(e){
    toast('Error de red', 'err');
  } finally {
    if(btn){ btn.disabled = false; btn.classList.remove('loading'); }
  }
}

/* ════════════════════════════════════════════════════════════
   AUDIO OBS
   ════════════════════════════════════════════════════════════ */
async function loadObsAudioSources(){
  try {
    const r = await fetch(API('/obs/audio-sources'));
    if(!r.ok){
      OBS_AUDIO_SOURCES = [];
      renderAudioSourceSelect();
      return;
    }
    const data = await r.json();
    if(data && data.ok && Array.isArray(data.sources)){
      OBS_AUDIO_SOURCES = data.sources;
      OBS_AUDIO_STATES = {};
      data.sources.forEach(s => {
        OBS_AUDIO_STATES[s.name] = { muted: s.muted, volume: s.volume };
      });
      renderAudioSourceSelect();
      // Refrescar botones del grid para mostrar estado muted correcto
      renderGrid();
    }
  } catch(e){
    OBS_AUDIO_SOURCES = [];
    renderAudioSourceSelect();
  }
}

function renderAudioSourceSelect(){
  const sel = document.getElementById('btnAudioSource');
  if(!sel) return;
  const current = sel.value;
  if(!OBS_AUDIO_SOURCES.length){
    sel.innerHTML = `<option value="">(OBS no conectado — sin fuentes)</option>`;
    return;
  }
  sel.innerHTML = OBS_AUDIO_SOURCES.map(s=>{
    const muted = s.muted ? ' 🔇' : '';
    return `<option value="${esc(s.name)}">${esc(s.name)}${muted}</option>`;
  }).join('');
  if(current && OBS_AUDIO_SOURCES.some(s=>s.name===current)){
    sel.value = current;
  }
}

function syncAudioPayload(){
  const action = document.getElementById('btnAction').value;
  const pField = document.getElementById('btnPayload');
  if(action === 'obs:audio:mute'){
    const src = document.getElementById('btnAudioSource')?.value || '';
    pField.value = JSON.stringify({ source: src });
  } else if(action === 'obs:audio:volume'){
    const src = document.getElementById('btnAudioSource')?.value || '';
    const vol = parseFloat(document.getElementById('btnAudioVolume')?.value || '1');
    pField.value = JSON.stringify({ source: src, volume: isFinite(vol) ? vol : 1 });
  }
}

/* ════════════════════════════════════════════════════════════
   ACCIONES
   ════════════════════════════════════════════════════════════ */
async function trigger(id){
  const b = STATE.buttons.find(x=>x.id===id);
  try {
    const r = await fetch(API('/trigger'), {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({id})
    });
    const btn = document.querySelector(`[data-trigger="${id}"]`);
    if(r.ok){
      toast(`▶ ${b?b.label:'Acción'}`, 'ok');
      if(btn){ btn.classList.add('ok'); setTimeout(()=>btn.classList.remove('ok'), 500); }
      // Si la acción es de audio o recursos, refrescar tras breve espera
      if(b && typeof b.action === 'string'){
        if(b.action.startsWith('obs:audio')) setTimeout(loadObsAudioSources, 350);
        if(b.action === 'system:ram:reduce') setTimeout(loadSystemResources, 600);
      }
    } else {
      toast('Error al ejecutar', 'err');
      if(btn){ btn.classList.add('err'); setTimeout(()=>btn.classList.remove('err'), 500); }
    }
  } catch { toast('Error de red', 'err'); }
}

async function resetTikTokStats(){
  if(!confirm('¿Resetear stats TikTok?')) return;
  socket.emit('tiktok-reset-stats');
  toast('Stats TikTok reseteados', 'ok');
}
function resetYouTubeStats(){
  if(!confirm('¿Resetear stats YouTube?')) return;
  YT.superchats = 0; YT.totalAmount = 0; YT.members = 0; YT.messages = 0;
  YT.topSuperchatters.clear(); YT.topMembers.clear(); YT.topChatters.clear();
  renderStatsView();
  toast('Stats YouTube reseteados', 'ok');
}

async function saveSection(section, data){
  try {
    const r = await fetch(API('/'+section), {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(data)
    });
    if(!r.ok){
      const txt = await r.text().catch(()=>'');
      console.error(`[saveSection ${section}] ${r.status}`, txt);
      return false;
    }
    return true;
  } catch(e){
    console.error(`[saveSection ${section}]`, e);
    return false;
  }
}

async function saveCategory(){
  const id = document.getElementById('catId').value;
  const name = document.getElementById('catName').value.trim();
  const icon = document.querySelector('#catIcons button.active')?.dataset.icon || 'ri-folder-line';
  const color = document.querySelector('#catColors button.active')?.dataset.color || COLORS[0];
  if(!name) return toast('Falta nombre', 'err');
  const cats = [...STATE.categories];
  if(id){
    const i = cats.findIndex(c=>c.id===id);
    cats[i] = {...cats[i], name, icon, color};
  } else {
    cats.push({id:'cat-'+Date.now(), name, icon, color});
  }
  if(await saveSection('categories', cats)){
    STATE.categories = cats;
    renderAll();
    closeModal('catModal');
    toast('Categoría guardada', 'ok');
  } else toast('Error guardando', 'err');
}

async function deleteCategory(){
  const id = document.getElementById('catId').value;
  if(!confirm('¿Eliminar categoría y sus botones?')) return;
  STATE.categories = STATE.categories.filter(c=>c.id!==id);
  STATE.buttons = STATE.buttons.filter(b=>b.categoryId!==id);
  await saveSection('categories', STATE.categories);
  await saveSection('buttons', STATE.buttons);
  renderAll();
  closeModal('catModal');
  toast('Eliminada', 'ok');
}

async function saveButton(){
  const id = document.getElementById('btnId').value;
  const label = document.getElementById('btnLabel').value.trim();
  const categoryId = document.getElementById('btnCategory').value;
  const icon = document.querySelector('#btnIcons button.active')?.dataset.icon || 'ri-apps-2-line';
  const color = document.querySelector('#btnColors button.active')?.dataset.color || COLORS[0];
  const action = document.getElementById('btnAction').value;

  // Sincronizar payload antes de leer
  syncAudioPayload();

  let payload = {};
  const pRaw = document.getElementById('btnPayload').value.trim();
  if(pRaw){
    try{ payload = JSON.parse(pRaw); }
    catch{ return toast('Payload JSON inválido','err'); }
  }
  if(!label) return toast('Falta etiqueta','err');
  if(!categoryId) return toast('Elige una categoría','err');
  if((action === 'obs:audio:mute' || action === 'obs:audio:volume') && !payload.source){
    return toast('Elige una fuente de audio', 'err');
  }
  const btns = [...STATE.buttons];
  if(id){
    const i = btns.findIndex(b=>b.id===id);
    btns[i] = {...btns[i], label, categoryId, icon, color, action, payload};
  } else {
    btns.push({id:'b-'+Date.now(), label, categoryId, icon, color, action, payload});
  }
  if(await saveSection('buttons', btns)){
    STATE.buttons = btns;
    renderAll();
    closeModal('btnModal');
    toast('Botón guardado', 'ok');
  } else toast('Error', 'err');
}

async function deleteButton(){
  const id = document.getElementById('btnId').value;
  STATE.buttons = STATE.buttons.filter(b=>b.id!==id);
  await saveSection('buttons', STATE.buttons);
  renderAll();
  closeModal('btnModal');
  toast('Eliminado', 'ok');
}

async function saveWidget(){
  const id = document.getElementById('widgetId').value;
  const title = document.getElementById('widgetTitle').value.trim();
  const type = document.getElementById('widgetType').value;
  const platform = document.getElementById('widgetPlatform').value;
  const metric = document.getElementById('widgetMetric').value;
  const icon = document.querySelector('#widgetIcons button.active')?.dataset.icon || 'ri-bar-chart-line';
  const color = document.querySelector('#widgetColors button.active')?.dataset.color || PLATFORM_COLORS[platform] || COLORS[0];
  if(!title) return toast('Falta título','err');
  const ws = [...STATE.widgets];
  if(id){
    const i = ws.findIndex(w=>w.id===id);
    ws[i] = {...ws[i], title, type, platform, metric, icon, color};
  } else {
    ws.push({id:'w-'+Date.now(), title, type, platform, metric, icon, color});
  }
  if(await saveSection('widgets', ws)){
    STATE.widgets = ws;
    renderLive();
    closeModal('widgetModal');
    toast('Widget guardado', 'ok');
  } else toast('Error', 'err');
}

async function deleteWidget(){
  const id = document.getElementById('widgetId').value;
  STATE.widgets = STATE.widgets.filter(w=>w.id!==id);
  await saveSection('widgets', STATE.widgets);
  renderLive();
  closeModal('widgetModal');
  toast('Eliminado', 'ok');
}

async function quickDeleteWidget(id){
  const w = STATE.widgets.find(x=>x.id===id);
  if(!w) return;
  if(!confirm(`¿Eliminar widget "${w.title}"?`)) return;

  const backup = [...STATE.widgets];
  STATE.widgets = STATE.widgets.filter(x=>x.id!==id);

  const ok = await saveSection('widgets', STATE.widgets);
  if(ok){
    renderLive();
    toast('Widget eliminado', 'ok');
  } else {
    STATE.widgets = backup;
    renderLive();
    toast('Error eliminando widget', 'err');
  }
}

async function saveObs(){
  const obs = {
    host: document.getElementById('obsHost').value.trim(),
    port: parseInt(document.getElementById('obsPort').value)||4455,
    password: document.getElementById('obsPass').value
  };
  const r = await fetch(API('/obs-config'), {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(obs)
  });
  if(r.ok){
    STATE.obs = obs;
    closeModal('obsModal');
    toast('OBS guardado', 'ok');
  } else toast('Error', 'err');
}

async function saveObsFromConfig(){
  const obs = {
    host: document.getElementById('cfgObsHost').value.trim(),
    port: parseInt(document.getElementById('cfgObsPort').value)||4455,
    password: document.getElementById('cfgObsPass').value
  };
  const r = await fetch(API('/obs-config'), {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(obs)
  });
  if(r.ok){ STATE.obs = obs; toast('OBS guardado', 'ok'); }
  else toast('Error', 'err');
}

function openModal(id){ document.getElementById(id).classList.add('show'); }
function closeModal(id){ document.getElementById(id).classList.remove('show'); }

function openObsModal(){
  document.getElementById('obsHost').value = STATE.obs?.host || '127.0.0.1';
  document.getElementById('obsPort').value = STATE.obs?.port || 4455;
  document.getElementById('obsPass').value = STATE.obs?.password || '';
  openModal('obsModal');
}

function openCatModal(id){
  const isNew = !id;
  document.getElementById('catModalTitle').textContent = isNew ? 'Nueva categoría' : 'Editar categoría';
  document.getElementById('catId').value = id || '';
  const c = isNew ? {name:'', icon:'ri-folder-line', color:COLORS[0]} : STATE.categories.find(x=>x.id===id);
  document.getElementById('catName').value = c.name;
  buildIconPicker('catIcons', c.icon);
  buildColorPicker('catColors', c.color);
  document.getElementById('catDeleteBtn').style.display = isNew ? 'none' : 'block';
  openModal('catModal');
}

function openBtnModal(id, presetCat){
  const isNew = !id;
  document.getElementById('btnModalTitle').textContent = isNew ? 'Nuevo botón' : 'Editar botón';
  document.getElementById('btnId').value = id || '';
  const b = isNew
    ? {label:'', categoryId:presetCat||STATE.categories[0]?.id, icon:'ri-apps-2-line', color:COLORS[0], action:'obs:scene', payload:{}}
    : STATE.buttons.find(x=>x.id===id);
  document.getElementById('btnLabel').value = b.label;
  document.getElementById('btnCategory').innerHTML = STATE.categories.map(c=>`<option value="${c.id}" ${c.id===b.categoryId?'selected':''}>${esc(c.name)}</option>`).join('');
  document.getElementById('btnAction').innerHTML = ACTIONS.map(a=>`<option value="${a.v}" ${a.v===b.action?'selected':''}>${a.l}</option>`).join('');
  document.getElementById('btnPayload').value = JSON.stringify(b.payload||{});
  buildIconPicker('btnIcons', b.icon);
  buildColorPicker('btnColors', b.color);
  document.getElementById('btnDeleteBtn').style.display = isNew ? 'none' : 'block';
  // Rellenar dropdown de audio si aplica
  renderAudioSourceSelect();
  // Si el botón guardado tiene source, preseleccionar
  if(b.payload && b.payload.source){
    const sel = document.getElementById('btnAudioSource');
    if(sel) sel.value = b.payload.source;
  }
  if(b.payload && typeof b.payload.volume === 'number'){
    const vol = document.getElementById('btnAudioVolume');
    if(vol){
      vol.value = b.payload.volume;
      const lbl = document.getElementById('btnAudioVolumeLabel');
      if(lbl) lbl.textContent = Math.round(b.payload.volume * 100) + '%';
    }
  }
  togglePayload();
  openModal('btnModal');
}

function togglePayload(){
  const actionVal = document.getElementById('btnAction').value;
  const a = ACTIONS.find(x=>x.v===actionVal);
  const payloadField = document.getElementById('btnPayloadField');
  const audioSourceField = document.getElementById('btnAudioSourceField');
  const audioVolumeField = document.getElementById('btnAudioVolumeField');

  // Reset
  if(payloadField) payloadField.style.display = 'none';
  if(audioSourceField) audioSourceField.style.display = 'none';
  if(audioVolumeField) audioVolumeField.style.display = 'none';

  if(!a) return;

  if(a.p === 'audio'){
    if(audioSourceField) audioSourceField.style.display = 'block';
    if(payloadField) payloadField.style.display = 'none';
    renderAudioSourceSelect();
    syncAudioPayload();
  } else if(a.p === 'audio-volume'){
    if(audioSourceField) audioSourceField.style.display = 'block';
    if(audioVolumeField) audioVolumeField.style.display = 'block';
    if(payloadField) payloadField.style.display = 'none';
    renderAudioSourceSelect();
    syncAudioPayload();
  } else if(a.p === true){
    if(payloadField) payloadField.style.display = 'block';
  }
}

function openWidgetModal(id){
  const isNew = !id;
  document.getElementById('widgetModalTitle').textContent = isNew ? 'Nuevo widget' : 'Editar widget';
  document.getElementById('widgetId').value = id || '';
  const w = isNew
    ? {title:'', type:'stat', platform:'tiktok', metric:'likes', icon:'ri-heart-3-fill', color:'#ff0050'}
    : STATE.widgets.find(x=>x.id===id);
  document.getElementById('widgetTitle').value = w.title;
  document.getElementById('widgetType').value = w.type;
  document.getElementById('widgetPlatform').value = w.platform;
  buildMetricOptions(w.platform, w.metric);
  buildIconPicker('widgetIcons', w.icon);
  buildColorPicker('widgetColors', w.color);
  document.getElementById('widgetDeleteBtn').style.display = isNew ? 'none' : 'block';
  openModal('widgetModal');
}

function buildMetricOptions(platform, selected){
  const el = document.getElementById('widgetMetric');
  el.innerHTML = (METRICS[platform]||[]).map(m=>`<option value="${m}" ${m===selected?'selected':''}>${m}</option>`).join('');
}

function buildIconPicker(elId, selected){
  const el = document.getElementById(elId);
  el.innerHTML = ICONS.map(i=>`<button data-icon="${i}" class="${i===selected?'active':''}"><i class="${i}"></i></button>`).join('');
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>{
    el.querySelectorAll('button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
  });
}

function buildColorPicker(elId, selected){
  const el = document.getElementById(elId);
  el.innerHTML = COLORS.map(c=>`<button data-color="${c}" style="background:${c}" class="${c===selected?'active':''}"></button>`).join('');
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>{
    el.querySelectorAll('button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
  });
}

function openMobileModal(){
  (async ()=>{
    let lanUrl;
    try {
      const r = await fetch(API('/lan-info'));
      const info = await r.json();
      lanUrl = info.url;
    } catch {
      const base = location.origin;
      lanUrl = `${base}/deck?t=${TOKEN}`;
    }
    document.getElementById('mobileUrl').value = lanUrl;
    document.getElementById('qrBox').innerHTML =
      `<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(lanUrl)}" alt="QR" style="border-radius:12px">`;
    openModal('mobileModal');
  })();
}

function exportConfig(){
  const blob = new Blob([JSON.stringify(STATE,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'streamdeck-config.json';
  a.click();
}

async function importConfig(file){
  try {
    const data = JSON.parse(await file.text());
    await saveSection('categories', data.categories||[]);
    await saveSection('buttons', data.buttons||[]);
    await saveSection('widgets', data.widgets||[]);
    if(data.theme){
      await fetch(API('/theme'), {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({theme:data.theme})
      });
    }
    await loadConfig();
    renderAll();
    toast('Importado', 'ok');
  } catch { toast('JSON inválido', 'err'); }
}

/* ════════════════════════════════════════════════════════════
   AITUM VERTICAL
   ════════════════════════════════════════════════════════════ */
async function loadAitumState(){
  try {
    const r = await fetch(API('/aitum/state'));
    if(!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    AITUM.ok = !!data.ok;
    AITUM.vendor = data.vendor || null;
    AITUM.scenes = Array.isArray(data.scenes) ? data.scenes : [];
    AITUM.current = data.current || null;
    AITUM.status = data.status || AITUM.status;
    AITUM.loaded = true;
  } catch(e){
    AITUM.ok = false;
    AITUM.loaded = true;
    console.warn('[aitum] state error:', e);
  }
  renderAitum();
}

function renderAitum(){
  const vendorEl = document.getElementById('aitumVendor');
  const vendorPill = document.getElementById('aitumVendorPill');
  const connEl = document.getElementById('aitumConn');
  const connPill = document.getElementById('aitumConnPill');
  const currentEl = document.getElementById('aitumCurrent');
  const currentPill = document.getElementById('aitumCurrentPill');

  if(vendorEl) vendorEl.textContent = AITUM.vendor || '—';
  if(vendorPill){
    vendorPill.classList.toggle('ok', !!AITUM.vendor);
    vendorPill.classList.toggle('err', !AITUM.vendor && AITUM.loaded);
  }

  if(connEl) connEl.textContent = AITUM.ok ? 'Conectado' : (AITUM.loaded ? 'Sin conexión' : 'Conectando…');
  if(connPill){
    connPill.classList.toggle('ok', AITUM.ok);
    connPill.classList.toggle('err', !AITUM.ok && AITUM.loaded);
  }

  if(currentEl) currentEl.innerHTML = AITUM.current ? `<b>${esc(AITUM.current)}</b>` : '—';
  if(currentPill) currentPill.classList.toggle('ok', !!AITUM.current);

  const navCount = document.getElementById('navAitumScenes');
  if(navCount) navCount.textContent = AITUM.scenes.length || '0';

  const grid = document.getElementById('aitumScenesGrid');
  const countBadge = document.getElementById('aitumSceneCount');
  if(countBadge) countBadge.textContent = AITUM.scenes.length;

  if(grid){
    if(!AITUM.scenes.length){
      grid.innerHTML = `<div class="aitum-empty">
        ${AITUM.ok ? 'No hay escenas verticales disponibles' : 'Aitum Vertical no detectado'}
      </div>`;
    } else {
      grid.innerHTML = AITUM.scenes.map(name=>{
        const active = name === AITUM.current;
        return `<button class="aitum-scene-btn ${active?'active':''}" data-scene="${esc(name)}">
          <i class="ri-layout-masonry-line"></i>
          <span>${esc(name)}</span>
        </button>`;
      }).join('');
      grid.querySelectorAll('[data-scene]').forEach(btn=>{
        btn.onclick = ()=>aitumSwitchScene(btn.dataset.scene);
      });
    }
  }

  renderAitumControls();
}

function renderAitumControls(){
  const el = document.getElementById('aitumControls');
  if(!el) return;

  const s = AITUM.status || {};
  const defs = [
    {
      key: 'streaming',
      label: 'Streaming',
      icon: 'ri-live-line',
      start: 'streaming:start',
      stop: 'streaming:stop',
      toggle: 'streaming:toggle'
    },
    {
      key: 'recording',
      label: 'Grabación',
      icon: 'ri-record-circle-line',
      start: 'recording:start',
      stop: 'recording:stop',
      toggle: 'recording:toggle',
      extra: { label:'Pausar', icon:'ri-pause-circle-line', action:'recording:pause' }
    },
    {
      key: 'backtrack',
      label: 'Backtrack',
      icon: 'ri-history-line',
      start: 'backtrack:start',
      stop: 'backtrack:stop',
      toggle: 'backtrack:toggle',
      extra: { label:'Guardar', icon:'ri-save-line', action:'backtrack:save' }
    },
    {
      key: 'virtual_camera',
      label: 'Cámara Virtual',
      icon: 'ri-camera-line',
      start: 'virtual_camera:start',
      stop: 'virtual_camera:stop',
      toggle: 'virtual_camera:toggle'
    }
  ];

  el.innerHTML = defs.map(d=>{
    const on = !!s[d.key];
    return `<div class="aitum-ctrl">
      <div class="aitum-ctrl-label">
        <i class="${d.icon}"></i>
        <span>${d.label}</span>
      </div>
      <div>
        <span class="aitum-ctrl-state ${on?'on':'off'}">${on?'● ACTIVO':'○ INACTIVO'}</span>
      </div>
      <div class="aitum-ctrl-btns">
        <button class="start" data-aitum-action="${d.start}" title="Iniciar">
          <i class="ri-play-fill"></i> On
        </button>
        <button class="stop" data-aitum-action="${d.stop}" title="Detener">
          <i class="ri-stop-fill"></i> Off
        </button>
        <button class="toggle" data-aitum-action="${d.toggle}" title="Alternar">
          <i class="ri-refresh-line"></i>
        </button>
      </div>
      ${d.extra ? `<div class="aitum-ctrl-btns">
        <button data-aitum-action="${d.extra.action}">
          <i class="${d.extra.icon}"></i> ${d.extra.label}
        </button>
      </div>` : ''}
    </div>`;
  }).join('');

  el.querySelectorAll('[data-aitum-action]').forEach(btn=>{
    btn.onclick = ()=>aitumAction(btn.dataset.aitumAction);
    if(!AITUM.ok) btn.disabled = true;
  });
}

async function aitumSwitchScene(scene){
  if(!scene) return;
  const prev = AITUM.current;
  AITUM.current = scene;
  renderAitum();
  try {
    const r = await fetch(API('/aitum/switch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene })
    });
    const data = await r.json().catch(()=>({}));
    if(r.ok && data.ok !== false){
      toast(`Escena: ${scene}`, 'ok');
    } else {
      AITUM.current = prev;
      renderAitum();
      toast(data.error || 'Error cambiando escena', 'err');
    }
  } catch(e){
    AITUM.current = prev;
    renderAitum();
    toast('Error de red', 'err');
  }
}

async function aitumAction(action){
  if(!action) return;
  try {
    const r = await fetch(API('/aitum/action'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    const data = await r.json().catch(()=>({}));
    if(r.ok && data.ok !== false){
      toast(`Aitum: ${action}`, 'ok');
      setTimeout(loadAitumState, 400);
    } else {
      toast(data.error || 'Error en acción', 'err');
    }
  } catch(e){
    toast('Error de red', 'err');
  }
}

function startAitumPolling(){
  if(AITUM.pollTimer) clearInterval(AITUM.pollTimer);
  AITUM.pollTimer = setInterval(()=>{
    if(CURRENT_VIEW === 'aitum' || document.visibilityState === 'visible'){
      loadAitumState();
    }
  }, 2500);
}

/* ════════════════════════════════════════════════════════════
   BIND UI
   ════════════════════════════════════════════════════════════ */
function bindUI(){
  document.querySelectorAll('.nav-item[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));

  document.getElementById('addCatBtn').onclick = ()=>openCatModal();
  document.getElementById('newBtnBtn').onclick = async ()=>{
    if(!STATE.categories.length){
      const nueva = { id:'cat-'+Date.now(), name:'General', icon:'ri-folder-line', color:'#5a8ad6' };
      const cats = [nueva];
      if(await saveSection('categories', cats)){
        STATE.categories = cats;
        renderAll();
        toast('Categoría "General" creada', 'ok');
      } else return toast('Error creando categoría', 'err');
    }
    const preset = FILTER === 'all' ? STATE.categories[0].id : FILTER;
    openBtnModal(null, preset);
  };
  document.getElementById('addWidgetBtn').onclick = ()=>openWidgetModal();
  document.getElementById('obsPill').onclick = ()=>openObsModal();

  const powerPillEl = document.getElementById('deckPowerPill');
  if(powerPillEl) powerPillEl.onclick = ()=>setDeckEnabled(!DECK_ENABLED);
  const activateBtnEl = document.getElementById('activateDeckBtn');
  if(activateBtnEl) activateBtnEl.onclick = ()=>setDeckEnabled(true);

  document.getElementById('btnNewCatInline').onclick = ()=>{
    closeModal('btnModal');
    openCatModal();
    const originalSave = window.saveCategory;
    window.saveCategory = async function(){
      await originalSave();
      window.saveCategory = originalSave;
      openBtnModal(null, STATE.categories[STATE.categories.length-1]?.id);
    };
  };

  document.getElementById('btnAction').onchange = togglePayload;
  document.getElementById('widgetPlatform').onchange = (e)=>buildMetricOptions(e.target.value);

  // Slider de volumen
  const volSlider = document.getElementById('btnAudioVolume');
  if(volSlider){
    volSlider.oninput = ()=>{
      const lbl = document.getElementById('btnAudioVolumeLabel');
      if(lbl) lbl.textContent = Math.round(parseFloat(volSlider.value) * 100) + '%';
      syncAudioPayload();
    };
  }
  // Select de fuente
  const srcSel = document.getElementById('btnAudioSource');
  if(srcSel){
    srcSel.onchange = ()=>syncAudioPayload();
  }

  const elDash = document.getElementById('cfgViewDashboard');
  if(elDash) elDash.onchange = (e)=>{ PREFS.views.dashboard = e.target.checked; applyPrefs(); savePrefs(); };
  const elStats = document.getElementById('cfgViewStats');
  if(elStats) elStats.onchange = (e)=>{ PREFS.views.stats = e.target.checked; applyPrefs(); savePrefs(); };
  const elOv = document.getElementById('cfgViewOverlays');
  if(elOv) elOv.onchange = (e)=>{ PREFS.views.overlays = e.target.checked; applyPrefs(); savePrefs(); };
  const cfgAitumEl = document.getElementById('cfgViewAitum');
  if(cfgAitumEl) cfgAitumEl.onchange = (e)=>{ PREFS.views.aitum = e.target.checked; applyPrefs(); savePrefs(); };
  const elCfg = document.getElementById('cfgViewConfig');
  if(elCfg) elCfg.onchange = (e)=>{ PREFS.views.config = e.target.checked; applyPrefs(); savePrefs(); };
  const elPanelStats = document.getElementById('cfgPanelStats');
  if(elPanelStats) elPanelStats.onchange = (e)=>{ PREFS.panelRight.stats = e.target.checked; applyPrefs(); renderLive(); savePrefs(); };
  const elPanelRank = document.getElementById('cfgPanelRankings');
  if(elPanelRank) elPanelRank.onchange = (e)=>{ PREFS.panelRight.rankings = e.target.checked; applyPrefs(); renderLive(); savePrefs(); };
  const elPanelRes = document.getElementById('cfgPanelResources');
  if(elPanelRes) elPanelRes.onchange = (e)=>{ PREFS.panelRight.resources = e.target.checked; applyPrefs(); savePrefs(); };
  const elTranslate = document.getElementById('cfgChatTranslate');
  if(elTranslate) elTranslate.onchange = (e)=>{ PREFS.chat.translate = e.target.checked; savePrefs(); };
  const elCensor = document.getElementById('cfgChatCensor');
  if(elCensor) elCensor.onchange = (e)=>{ PREFS.chat.censor = e.target.checked; savePrefs(); };
  const elAvatars = document.getElementById('cfgChatAvatars');
  if(elAvatars) elAvatars.onchange = (e)=>{ PREFS.chat.avatars = e.target.checked; renderChatFeed(); savePrefs(); };

  document.querySelectorAll('.theme-btn').forEach(b=>{
    b.onclick = ()=>applyTheme(b.dataset.theme);
  });

  document.getElementById('exportBtn').onclick = exportConfig;
  document.getElementById('importBtn').onclick = ()=>document.getElementById('importFile').click();
  document.getElementById('importFile').onchange = (e)=>{
    const f = e.target.files[0]; if(!f) return;
    importConfig(f);
    e.target.value = '';
  };

  document.getElementById('mobileBtn').onclick = openMobileModal;

  document.querySelectorAll('.modal-back').forEach(m=>{
    m.onclick = (e)=>{ if(e.target===m) m.classList.remove('show'); };
  });

  const toggleSidebar = document.getElementById('toggleSidebar');
  const toggleAside = document.getElementById('toggleAside');
  const overlay = document.getElementById('mobileOverlay');
  const sidebarEl = document.querySelector('.sidebar');
  const asideEl = document.querySelector('.aside');

  function closeMobilePanels(){
    sidebarEl.classList.remove('open');
    asideEl.classList.remove('open');
    overlay.classList.remove('show');
  }
  toggleSidebar.onclick = ()=>{
    sidebarEl.classList.toggle('open');
    asideEl.classList.remove('open');
    overlay.classList.toggle('show', sidebarEl.classList.contains('open'));
  };
  toggleAside.onclick = ()=>{
    asideEl.classList.toggle('open');
    sidebarEl.classList.remove('open');
    overlay.classList.toggle('show', asideEl.classList.contains('open'));
  };
  overlay.onclick = closeMobilePanels;

  const accPicker = document.getElementById('activeTwitchAccount');
  if(accPicker){
    accPicker.onchange = ()=>{
      const username = accPicker.value;
      const acc = getAllTwitchAccounts().find(a=>a.username === username);
      if(!acc) return;
      const channels = acc.channels.length ? acc.channels : ['twitch'];
      ['modChannel','pollChannel','streamChannel'].forEach(id=>{
        const el = document.getElementById(id);
        if(!el) return;
        const prev = el.value;
        el.innerHTML = channels.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
        if(channels.includes(prev)) el.value = prev;
      });
      toast(`Cuenta: ${username}`, 'ok');
    };
  }
  const aitumRefresh = document.getElementById('aitumRefreshBtn');
  if(aitumRefresh) aitumRefresh.onclick = ()=>loadAitumState();

  // Botón reducir RAM
  const reduceBtn = document.getElementById('resReduceBtn');
  if(reduceBtn) reduceBtn.onclick = reduceRam;

  /* VOLVER AL PANEL */
  
  // Bloquear menú contextual del navegador dentro del deck (pero no en inputs)
document.addEventListener('contextmenu', (e) => {
  const t = e.target;
  const tag = (t.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || t.isContentEditable) return;
  if (t.closest('.modal-back')) return; // permitir en modales (para copiar texto)
  e.preventDefault();
});
  const goBack = () => {
    const anyModalOpen = document.querySelector('.modal-back.show');
    if (anyModalOpen) {
      anyModalOpen.classList.remove('show');
      return;
    }

    if (window.innerWidth <= 900) {
      if (sidebarEl.classList.contains('open') || asideEl.classList.contains('open')) {
        sidebarEl.classList.remove('open');
        asideEl.classList.remove('open');
        overlay.classList.remove('show');
        return;
      }
    }

    window.location.href = (window.SERVER_BASE || '') + '/';
  };

  const backBtnSidebar = document.getElementById('backToPanelBtn');
  if (backBtnSidebar) backBtnSidebar.onclick = goBack;

  const backBtnPill = document.getElementById('backToPanelPill');
  if (backBtnPill) backBtnPill.onclick = goBack;

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    goBack();
  });
}

/* ════════════════════════════════════════════════════════════
   SOCKETS
   ════════════════════════════════════════════════════════════ */
function connectSockets(){
  socket.on('deck:stats-update', s=>{ STATS = s; renderLive(); renderStatsView(); });
  socket.on('deck:obs-status', s=>{
    OBS_CONNECTED = !!s.connected;
    renderObsStatus();
    if(OBS_CONNECTED) loadObsAudioSources();
  });
  socket.on('deck:enabled-updated', d=>{
    const newEnabled = !!(d && d.enabled);
    if(newEnabled === DECK_ENABLED) return;
    DECK_ENABLED = newEnabled;
    applyDeckEnabled();
    if(DECK_ENABLED) startRuntime();
    else stopRuntime();
  });
  socket.on('deck:categories-updated', c=>{ STATE.categories = c; renderAll(); });
  socket.on('deck:buttons-updated', b=>{ STATE.buttons = b; renderAll(); });
  socket.on('deck:widgets-updated', w=>{ STATE.widgets = w; renderLive(); });
  socket.on('deck:theme-updated', t=>{ PREFS.theme = t; applyTheme(t); });
  socket.on('deck:prefs-updated', p=>{
    if(!p || typeof p !== 'object') return;
    PREFS = { ...DEFAULT_PREFS, ...p };
    PREFS.views = { ...DEFAULT_PREFS.views, ...(p.views||{}) };
    PREFS.panelRight = { ...DEFAULT_PREFS.panelRight, ...(p.panelRight||{}) };
    PREFS.chat = { ...DEFAULT_PREFS.chat, ...(p.chat||{}) };
    try { localStorage.setItem('deck:prefs', JSON.stringify(PREFS)); } catch(e){}
    applyPrefs();
  });

  /* ── Audio OBS updates ── */
  socket.on('deck:obs:audio-update', d=>{
    if(!d || !d.inputName) return;
    if(d.type === 'mute'){
      OBS_AUDIO_STATES[d.inputName] = { ...(OBS_AUDIO_STATES[d.inputName]||{}), muted: !!d.inputMuted };
    } else if(d.type === 'volume'){
      OBS_AUDIO_STATES[d.inputName] = { ...(OBS_AUDIO_STATES[d.inputName]||{}), volume: d.inputVolumeMul };
    }
    // Actualizar botones del grid que usen esa fuente
    document.querySelectorAll('.deck-btn[data-source]').forEach(el=>{
      const src = el.dataset.source;
      if(!src || src !== d.inputName) return;
      if(d.type === 'mute'){
        el.classList.toggle('muted', !!d.inputMuted);
      }
    });
    // Actualizar dropdown por si está abierto
    renderAudioSourceSelect();
  });

  socket.on('chat-message', msg=>addChatMessage(msg));

  socket.on('youtube-superchat', data=>{
    if(!data) return;
    YT.superchats++;
    const amt = parseAmount(data.amount);
    YT.totalAmount += amt;
    const u = data.username || 'Anónimo';
    YT.topSuperchatters.set(u, (YT.topSuperchatters.get(u)||0) + amt);
    renderStatsView();
  });
  socket.on('youtube-member', data=>{
    if(!data) return;
    YT.members++;
    const u = data.username || 'Anónimo';
    YT.topMembers.set(u, (YT.topMembers.get(u)||0) + 1);
    renderStatsView();
  });

  socket.on('twitch-poll-created', p=>{ renderActivePoll(p); });
  socket.on('twitch-poll-ended', id=>{
    toast('Encuesta finalizada', 'ok');
    document.getElementById('activePollDisplay').innerHTML = '';
  });

  socket.on('category-change-result', r=>{
    if(r && r.success) toast('Categoría cambiada', 'ok');
    else if(r && r.error) toast(r.error, 'err');
  });
  socket.on('title-change-result', r=>{
    if(r && r.success) toast('Título cambiado', 'ok');
    else if(r && r.error) toast(r.error, 'err');
  });
}

function renderActivePoll(p){
  if(!p) return;
  const el = document.getElementById('activePollDisplay');
  el.innerHTML = `
    <div style="background:#0a0b0e;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:12px">
      <div style="font-weight:700;margin-bottom:6px">${esc(p.question)}</div>
      ${(p.options||[]).map((o,i)=>`
        <div class="poll-active-item">
          <span>${esc(o)}</span>
          <span class="votes">${(p.votes&&p.votes[i])||0} votos</span>
        </div>
      `).join('')}
      <button class="overlay-btn stop" style="margin-top:8px" onclick="endActivePoll('${p.id}')">
        <i class="ri-stop-fill"></i> Finalizar
      </button>
    </div>
  `;
}

function endActivePoll(id){
  socket.emit('end-twitch-poll', { pollId: id });
}

function parseAmount(str){
  if(!str) return 0;
  const m = String(str).replace(',','.').match(/(\d+(\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

function renderObsStatus(){
  const pill = document.getElementById('obsPill');
  const text = document.getElementById('obsPillText');
  if(!pill || !text) return;
  if(OBS_CONNECTED){
    pill.className = 'pill ok';
    text.textContent = 'OBS conectado';
  } else {
    pill.className = 'pill';
    text.textContent = 'OBS desconectado';
  }
  const navDeck = document.getElementById('navDeckCount');
  if(navDeck) navDeck.textContent = STATE.buttons.length;
}

init();