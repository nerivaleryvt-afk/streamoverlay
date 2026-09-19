/* ═══════════════════════════════════════════════════════════════
   panel.js — Lógica del Panel de Control · Toki
   Depende de: server-url.js, socket.io, electron (ipcRenderer)
   ═══════════════════════════════════════════════════════════════ */

const { ipcRenderer } = require('electron');

let serverIp = '';
let rawLogs = [];
let autoscroll = true;
let logsInterval = null;

const ULTIMA_ACTIVIDAD = { twitch: 0, tiktok: 0, kick: 0, youtube: 0, velora: 0 };
const VIVO_MS = 60000;

const PLATFORMS = {
  twitch:  { enabled: false, label: 'Twitch',  icon: 'ri-twitch-fill',    color: '#a78bfa', cuentas: [] },
  tiktok:  { enabled: false, label: 'TikTok',  icon: 'ri-tiktok-fill',    color: '#fe2c55', cuentas: [] },
  kick:    { enabled: false, label: 'Kick',    icon: 'ri-live-fill',      color: '#53fc18', cuentas: [] },
  youtube: { enabled: false, label: 'YouTube', icon: 'ri-youtube-fill',   color: '#ff3d3d', cuentas: [] },
  velora:  { enabled: false, label: 'Velora',  icon: 'ri-broadcast-fill', color: '#00d9ff', cuentas: [] }
};

const STATE = {
  isLive: false,
  liveSince: null,
  uptimeTick: null,
  viewers: { twitch: 0, tiktok: 0, kick: 0, youtube: 0, velora: 0 },
  diamonds: 0,
  diamondsMeta: 0,
  followsToday: 0,
  lastFollowUser: '',
  messagesThisMinute: 0,
  messagesPeak: 0,
  timeline: [],
  timelineMax: 50,
  lastStream: null,
  obsConnected: false,
  proxyActive: false,
  serverOnline: false
};

/* ──────────────────────────────────────────────
   HELPERS
   ────────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  n = Number(n);
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.floor(n));
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return String(h).padStart(2, '0') + ':' +
         String(m).padStart(2, '0') + ':' +
         String(sec).padStart(2, '0');
}

function fmtDurationShort(ms) {
  if (!ms || ms < 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function fmtRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'hace ' + sec + 's';
  const min = Math.floor(sec / 60);
  if (min < 60) return 'hace ' + min + ' min';
  const hr = Math.floor(min / 60);
  if (hr < 24) return 'hace ' + hr + 'h';
  return 'hace ' + Math.floor(hr / 24) + 'd';
}

function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  const hr = Math.floor(diff / 3600000);
  if (hr < 1) return 'hace menos de 1 hora';
  if (hr < 24) return 'hace ' + hr + ' hora' + (hr !== 1 ? 's' : '');
  return 'el ' + d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) +
         ' a las ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function setLive(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

/* ──────────────────────────────────────────────
   SERVER STATUS
   ────────────────────────────────────────────── */
async function checkServerStatus() {
  try {
    const res = await fetch(window.SERVER_BASE + '/health');
    const data = await res.json();
    if (data.status === 'ok') {
      STATE.serverOnline = true;
      setServerBadge(true);
      updateSystemRow('sysServerDot', true);
      await updatePlatformStatus();
      return;
    }
  } catch (e) {}
  STATE.serverOnline = false;
  setServerBadge(false);
  updateSystemRow('sysServerDot', false);
  renderPlatforms();
}

function setServerBadge(online) {
  const badge = $('server-badge');
  const text = $('server-badge-text');
  if (!badge || !text) return;
  badge.classList.toggle('offline', !online);
  text.textContent = online ? 'Servidor activo' : 'Inactivo';
}

function updateSystemRow(id, ok) {
  const dot = $(id);
  if (!dot) return;
  dot.classList.toggle('ok', !!ok);
}

/* ──────────────────────────────────────────────
   PLATAFORMAS
   ────────────────────────────────────────────── */
function loadPlatformsFromConfig(config) {
  if (!config) config = {};
  const enabled = config.PLATFORMS_ENABLED || {};

  // TWITCH
  PLATFORMS.twitch.enabled = enabled.twitch !== false;
  PLATFORMS.twitch.cuentas = [];
  if (Array.isArray(config.TWITCH_ACCOUNTS) && config.TWITCH_ACCOUNTS.length > 0) {
    config.TWITCH_ACCOUNTS.forEach((acc, i) => {
      const canales = Array.isArray(acc.channels) ? acc.channels : [];
      const nombre = acc.botUsername || canales[0] || ('cuenta-' + (i + 1));
      PLATFORMS.twitch.cuentas.push({
        id: acc.id || ('twitch-' + i),
        nombre: nombre,
        canales: canales
      });
    });
  } else {
    const canales = Array.isArray(config.channels) ? config.channels : [];
    const nombre = config.TWITCH_CHANNEL || canales[0] || '';
    if (nombre) PLATFORMS.twitch.cuentas.push({ id: 'twitch-legacy', nombre: nombre, canales: canales });
  }

  // TIKTOK
  PLATFORMS.tiktok.enabled = enabled.tiktok !== false;
  PLATFORMS.tiktok.cuentas = [];
  const tiktokUsers = Array.isArray(config.TIKTOK_USERS) ? config.TIKTOK_USERS : [];
  if (tiktokUsers.length > 0) {
    tiktokUsers.forEach((u, i) => { if (u) PLATFORMS.tiktok.cuentas.push({ id: 'tiktok-' + i, nombre: String(u) }); });
  } else if (config.TIKTOK_USER_ID) {
    PLATFORMS.tiktok.cuentas.push({ id: 'tiktok-legacy', nombre: String(config.TIKTOK_USER_ID) });
  }

  // KICK
  PLATFORMS.kick.enabled = enabled.kick !== false;
  PLATFORMS.kick.cuentas = [];
  const kickUsers = Array.isArray(config.KICK_USERS) ? config.KICK_USERS : [];
  if (kickUsers.length > 0) {
    kickUsers.forEach((u, i) => { if (u) PLATFORMS.kick.cuentas.push({ id: 'kick-' + i, nombre: String(u) }); });
  } else if (config.KICK_USERNAME) {
    PLATFORMS.kick.cuentas.push({ id: 'kick-legacy', nombre: String(config.KICK_USERNAME) });
  }

  // YOUTUBE
  PLATFORMS.youtube.enabled = enabled.youtube !== false;
  PLATFORMS.youtube.cuentas = [];
  const ytUsers = Array.isArray(config.YOUTUBE_USERS) ? config.YOUTUBE_USERS : [];
  if (ytUsers.length > 0) {
    ytUsers.forEach((u, i) => { if (u) PLATFORMS.youtube.cuentas.push({ id: 'youtube-' + i, nombre: String(u) }); });
  } else if (config.YOUTUBE_USER_ID) {
    PLATFORMS.youtube.cuentas.push({ id: 'youtube-legacy', nombre: String(config.YOUTUBE_USER_ID) });
  }

  // VELORA
  PLATFORMS.velora.enabled = enabled.velora !== false;
  PLATFORMS.velora.cuentas = [];
  if (config.VELORA_USERNAME) {
    PLATFORMS.velora.cuentas.push({ id: 'velora-main', nombre: String(config.VELORA_USERNAME) });
  }

  if (typeof config.JAR_META === 'number') STATE.diamondsMeta = config.JAR_META;

  const nombre =
    (PLATFORMS.tiktok.cuentas[0] && PLATFORMS.tiktok.cuentas[0].nombre) ||
    (PLATFORMS.twitch.cuentas[0] && PLATFORMS.twitch.cuentas[0].nombre) ||
    (PLATFORMS.kick.cuentas[0] && PLATFORMS.kick.cuentas[0].nombre) ||
    (PLATFORMS.youtube.cuentas[0] && PLATFORMS.youtube.cuentas[0].nombre) ||
    (PLATFORMS.velora.cuentas[0] && PLATFORMS.velora.cuentas[0].nombre) || '';
  const nombreLimpio = String(nombre).replace(/^@/, '').trim();
  const el = $('toki-msg-name');
  if (el) el.textContent = nombreLimpio || 'amiga';
}

async function updatePlatformStatus() {
  try {
    const res = await fetch(window.SERVER_BASE + '/get-config');
    const config = await res.json();
    loadPlatformsFromConfig(config);
    renderPlatforms();
    renderHero();
    renderSummary();
  } catch (e) {}
}

function renderPlatforms() {
  const grid = $('platformsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const order = ['twitch', 'tiktok', 'kick', 'youtube', 'velora'];
  let visibles = 0;

  order.forEach(p => {
    const info = PLATFORMS[p];
    if (!info.enabled) return;
    if (!info.enabled && info.cuentas.length === 0) return;
    visibles++;

    const card = document.createElement('div');
    card.className = 'plat ' + p;
    card.id = 'card-' + p;
    card.style.setProperty('--plat-color', info.color);

    const vivo = (Date.now() - (ULTIMA_ACTIVIDAD[p] || 0)) < VIVO_MS;
    card.classList.add(vivo ? 'state-live' : (info.cuentas.length > 0 ? 'state-waiting' : 'state-none'));

    const header = document.createElement('div');
    header.className = 'plat-header';

    const glyph = document.createElement('i');
    glyph.className = info.icon + ' plat-glyph';
    header.appendChild(glyph);

    const headText = document.createElement('div');
    headText.className = 'plat-head-text';

    const label = document.createElement('div');
    label.className = 'plat-label';
    label.textContent = info.label;
    headText.appendChild(label);

    const dot = document.createElement('span');
    dot.className = 'user-dot';
    headText.appendChild(dot);

    header.appendChild(headText);
    card.appendChild(header);

    if (info.cuentas.length > 0) {
      const list = document.createElement('div');
      list.className = 'plat-cuentas';
      info.cuentas.forEach(c => {
        const row = document.createElement('div');
        row.className = 'plat-cuenta';
        const d = document.createElement('span'); d.className = 'cuenta-dot'; row.appendChild(d);
        const name = document.createElement('span'); name.className = 'cuenta-nombre';
        name.textContent = '@' + String(c.nombre).replace(/^@/, '');
        row.appendChild(name);
        if (c.canales && c.canales.length > 1) {
          const extra = document.createElement('span');
          extra.className = 'cuenta-extra';
          extra.textContent = '+' + (c.canales.length - 1);
          row.appendChild(extra);
        }
        list.appendChild(row);
      });
      card.appendChild(list);
    } else {
      const cta = document.createElement('div');
      cta.className = 'plat-cta';
      const link = document.createElement('a');
      link.className = 'plat-cta-link';
      link.href = '/config';
      link.textContent = 'Conectar cuenta →';
      cta.appendChild(link);
      card.appendChild(cta);
    }

    grid.appendChild(card);
  });

  if (visibles === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.style.gridColumn = '1 / -1';
    empty.innerHTML =
      '<div class="empty-icon"><i class="ri-plug-line"></i></div>' +
      '<div class="empty-title">Sin plataformas activas</div>' +
      '<div class="empty-desc">Conectá al menos una plataforma desde Configuración.</div>';
    grid.appendChild(empty);
  }
}

/* ──────────────────────────────────────────────
   HERO
   ────────────────────────────────────────────── */
function renderHero() {
  const hero = $('hero');
  if (!hero) return;

  const liveLeft = $('heroLiveLeft');
  const liveRight = $('heroLiveRight');
  const sumLeft = $('heroSummaryLeft');
  const sumRight = $('heroSummaryRight');
  const emptyLeft = $('heroEmptyLeft');
  if (!liveLeft || !liveRight || !sumLeft || !sumRight || !emptyLeft) return;

  liveLeft.style.display = 'none';
  liveRight.style.display = 'none';
  sumLeft.style.display = 'none';
  sumRight.style.display = 'none';
  emptyLeft.style.display = 'none';

  hero.classList.remove('is-live', 'is-offline-summary', 'is-offline-empty');

  if (STATE.isLive) {
    hero.classList.add('is-live');
    liveLeft.style.display = '';
    liveRight.style.display = '';

    const order = ['twitch', 'tiktok', 'kick', 'youtube', 'velora'];
    let channel = '';
    for (let i = 0; i < order.length; i++) {
      const p = order[i];
      if (PLATFORMS[p].cuentas.length > 0) { channel = PLATFORMS[p].cuentas[0].nombre; break; }
    }
    const chEl = $('heroLiveChannel');
    if (chEl) chEl.textContent = channel || 'Sin nombre';

    const platEl = $('heroLivePlatforms');
    if (platEl) {
      platEl.innerHTML = '';
      order.forEach(p => {
        if (PLATFORMS[p].cuentas.length > 0) {
          const chip = document.createElement('span');
          chip.className = 'hero-chip ' + p;
          chip.textContent = PLATFORMS[p].label;
          platEl.appendChild(chip);
        }
      });
    }
    updateHeroLiveStats();
  } else if (STATE.lastStream) {
    hero.classList.add('is-offline-summary');
    sumLeft.style.display = '';
    sumRight.style.display = '';

    const chEl = $('heroSummaryChannel');
    if (chEl) chEl.textContent = STATE.lastStream.canal || 'Último stream';
    const whenEl = $('heroSummaryWhen');
    if (whenEl) whenEl.textContent = fmtWhen(STATE.lastStream.fin);

    const platEl = $('heroSummaryPlatforms');
    if (platEl) {
      platEl.innerHTML = '';
      (STATE.lastStream.plataformas || []).forEach(p => {
        if (!PLATFORMS[p]) return;
        const chip = document.createElement('span');
        chip.className = 'hero-chip ' + p;
        chip.textContent = PLATFORMS[p].label;
        platEl.appendChild(chip);
      });
    }
    setLive('heroSummaryDuration', fmtDuration(STATE.lastStream.duracionMs || 0));
    setLive('heroSummaryPeak', fmtNumber(STATE.lastStream.viewersPico || 0));
    setLive('heroSummaryDiamonds', fmtNumber(STATE.lastStream.diamantes || 0));
  } else {
    hero.classList.add('is-offline-empty');
    emptyLeft.style.display = '';
  }
}

function updateHeroLiveStats() {
  let totalViewers = 0;
  ['twitch', 'tiktok', 'kick', 'youtube', 'velora'].forEach(p => {
    totalViewers += STATE.viewers[p] || 0;
  });
  setLive('heroLiveViewers', fmtNumber(totalViewers));
  setLive('heroLiveDiamonds', fmtNumber(STATE.diamonds));
  if (STATE.liveSince) setLive('heroLiveUptime', fmtDuration(Date.now() - STATE.liveSince));
}

/* ──────────────────────────────────────────────
   RESUMEN
   ────────────────────────────────────────────── */
function renderSummary() {
  let totalViewers = 0;
  ['twitch', 'tiktok', 'kick', 'youtube', 'velora'].forEach(p => {
    totalViewers += STATE.viewers[p] || 0;
  });

  const featuredLabel = $('summaryFeaturedLabel');
  const featuredBadge = $('summaryFeaturedBadge');
  const featuredValue = $('summaryFeaturedValue');
  const featuredSub = $('summaryFeaturedSub');

  if (STATE.isLive) {
    if (featuredLabel) featuredLabel.textContent = 'Viewers actuales';
    if (featuredBadge) featuredBadge.style.display = '';
    if (featuredValue) featuredValue.textContent = fmtNumber(totalViewers);
    if (featuredSub) featuredSub.textContent = 'Suma de plataformas conectadas';
    const uptimeSub = $('summaryUptimeSub');
    if (uptimeSub && STATE.liveSince) {
      uptimeSub.textContent = 'Desde ' + new Date(STATE.liveSince).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    }
  } else if (STATE.lastStream) {
    if (featuredLabel) featuredLabel.textContent = 'Duración último stream';
    if (featuredBadge) featuredBadge.style.display = 'none';
    if (featuredValue) featuredValue.textContent = fmtDuration(STATE.lastStream.duracionMs || 0);
    if (featuredSub) featuredSub.textContent = fmtWhen(STATE.lastStream.fin);
    const uptimeSub = $('summaryUptimeSub');
    if (uptimeSub) uptimeSub.textContent = 'Viewers promedio: ' + fmtNumber(STATE.lastStream.viewersPromedio || 0);
  } else {
    if (featuredLabel) featuredLabel.textContent = 'Viewers actuales';
    if (featuredBadge) featuredBadge.style.display = 'none';
    if (featuredValue) featuredValue.textContent = '0';
    if (featuredSub) featuredSub.textContent = 'Iniciá un stream para ver datos';
    const uptimeSub = $('summaryUptimeSub');
    if (uptimeSub) uptimeSub.textContent = 'Sin sesión activa';
  }

  const followsSub = $('summaryFollowsSub');
  if (followsSub) followsSub.textContent = STATE.lastFollowUser ? '@' + STATE.lastFollowUser : 'Sin datos';

  const pct = STATE.diamondsMeta > 0 ? Math.min(100, (STATE.diamonds / STATE.diamondsMeta) * 100) : 0;
  const bar = $('summaryDiamondsBar');
  if (bar) bar.style.width = pct + '%';
  const diasSub = $('summaryDiamondsSub');
  if (diasSub) diasSub.textContent = 'Meta: ' + fmtNumber(STATE.diamondsMeta) + ' · ' + Math.floor(pct) + '%';

  const vSub = $('summaryViewersSub');
  if (vSub) vSub.textContent = STATE.viewers.tiktok > 0 ? 'En vivo' : 'Sin datos';
}

/* ──────────────────────────────────────────────
   TIMELINE
   ────────────────────────────────────────────── */
function addTimelineEvent(opts) {
  STATE.timeline.unshift({
    platform: opts.platform || 'twitch',
    icon: opts.icon || '•',
    text: opts.text || '',
    meta: opts.meta || '',
    ts: Date.now()
  });
  if (STATE.timeline.length > STATE.timelineMax) {
    STATE.timeline = STATE.timeline.slice(0, STATE.timelineMax);
  }
  renderTimeline();
}

function renderTimeline() {
  const timeline = $('timeline');
  const empty = $('timelineEmpty');
  if (!timeline) return;

  Array.from(timeline.querySelectorAll('.timeline-item')).forEach(n => n.remove());
  if (STATE.timeline.length === 0) { if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';

  STATE.timeline.forEach(ev => {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.setAttribute('data-platform', ev.platform);
    const icon = document.createElement('div');
    icon.className = 'timeline-icon';
    icon.textContent = ev.icon;
    const body = document.createElement('div');
    body.className = 'timeline-body';
    const text = document.createElement('div');
    text.className = 'timeline-text';
    text.innerHTML = ev.text;
    const meta = document.createElement('div');
    meta.className = 'timeline-meta';
    meta.textContent = ev.meta;
    body.appendChild(text);
    body.appendChild(meta);
    item.appendChild(icon);
    item.appendChild(body);
    timeline.appendChild(item);
  });
}

/* ──────────────────────────────────────────────
   SISTEMA
   ────────────────────────────────────────────── */
async function fetchObsInfo() {
  try {
    const r = await fetch(window.SERVER_BASE + '/api/obs-info');
    if (!r.ok) { updateSystemRow('sysObsDot', false); return; }
    const data = await r.json();
    STATE.obsConnected = !!(data && (data.connected || data.obsConnected));
    updateSystemRow('sysObsDot', STATE.obsConnected);
  } catch (e) { updateSystemRow('sysObsDot', false); }
}

async function fetchProxyStatus() {
  try {
    const r = await fetch(window.SERVER_BASE + '/api/tiktok/proxy/status');
    const p = await r.json();
    STATE.proxyActive = !!(p && (p.active || p.running));
    updateSystemRow('sysProxyDot', STATE.proxyActive);
  } catch (e) { updateSystemRow('sysProxyDot', false); }
}

async function fetchLastStream() {
  try {
    const r = await fetch(window.SERVER_BASE + '/api/last-stream');
    if (!r.ok) return null;
    const data = await r.json();
    STATE.lastStream = data || null;
    return data;
  } catch (e) { STATE.lastStream = null; return null; }
}

function startUptimeTick() {
  if (STATE.uptimeTick) return;
  STATE.uptimeTick = setInterval(() => {
    updateHeroLiveStats();
    if (STATE.isLive && STATE.liveSince) {
      setLive('live-timer', fmtDurationShort(Date.now() - STATE.liveSince));
    }
    if (STATE.isLive) renderPlatforms();
  }, 1000);
}

/* ──────────────────────────────────────────────
   SOCKET
   ────────────────────────────────────────────── */
function initSocket() {
  if (typeof io === 'undefined') return;
  const s = io(window.SERVER_BASE, { transports: ['websocket', 'polling'] });

  s.on('connect', () => { updateSystemRow('sysServerDot', true); });
  s.on('disconnect', () => { updateSystemRow('sysServerDot', false); });

  s.on('chat-message', (msg) => {
    if (!msg) return;
    const p = (msg.platform || '').toLowerCase();
    if (ULTIMA_ACTIVIDAD[p] !== undefined) {
      ULTIMA_ACTIVIDAD[p] = Date.now();
      renderPlatforms();
      if (!STATE.isLive) {
        STATE.isLive = true;
        STATE.liveSince = STATE.liveSince || Date.now();
        startUptimeTick();
        renderHero();
        renderSummary();
      }
    }
    STATE.messagesThisMinute++;
    if (STATE.messagesThisMinute > STATE.messagesPeak) STATE.messagesPeak = STATE.messagesThisMinute;

    const ts = msg.timestamp || Date.now();
    const platLabel = PLATFORMS[msg.platform] ? PLATFORMS[msg.platform].label : msg.platform;

    if (msg.type === 'gift') {
      addTimelineEvent({ platform: msg.platform, icon: '🎁',
        text: '<strong>@' + escapeHtml(msg.username) + '</strong> regaló <strong>' + escapeHtml(msg.giftName || msg.message || '') + '</strong>',
        meta: platLabel + ' · ' + fmtRelative(ts) });
    } else if (msg.type === 'follow') {
      addTimelineEvent({ platform: msg.platform, icon: '⭐',
        text: '<strong>@' + escapeHtml(msg.username) + '</strong> te siguió',
        meta: platLabel + ' · ' + fmtRelative(ts) });
      STATE.followsToday++;
      STATE.lastFollowUser = msg.username || '';
      setLive('live-last-follow', '@' + (msg.username || '—'));
      renderSummary();
    } else if (msg.type === 'sub' || msg.type === 'member' || msg.type === 'resub') {
      addTimelineEvent({ platform: msg.platform, icon: '💜',
        text: '<strong>@' + escapeHtml(msg.username) + '</strong> se suscribió',
        meta: platLabel + ' · ' + fmtRelative(ts) });
    } else if (msg.type === 'cheer') {
      addTimelineEvent({ platform: msg.platform, icon: '💎',
        text: '<strong>@' + escapeHtml(msg.username) + '</strong> donó <strong>' + escapeHtml(msg.message || '') + '</strong>',
        meta: platLabel + ' · ' + fmtRelative(ts) });
    } else if (msg.type === 'ai') {
      addTimelineEvent({ platform: msg.platform, icon: '🤖',
        text: 'IA: ' + escapeHtml((msg.message || '').substring(0, 60)),
        meta: platLabel + ' · ' + fmtRelative(ts) });
    }
  });

  s.on('tiktok-gift', () => {
    ULTIMA_ACTIVIDAD.tiktok = Date.now();
    renderPlatforms();
    if (!STATE.isLive) {
      STATE.isLive = true;
      STATE.liveSince = STATE.liveSince || Date.now();
      startUptimeTick();
      renderHero();
      renderSummary();
    }
  });

  s.on('tiktok-follow', (data) => {
    ULTIMA_ACTIVIDAD.tiktok = Date.now();
    renderPlatforms();
    const u = data && data.username ? String(data.username).replace(/^@/, '') : '';
    if (u) {
      STATE.lastFollowUser = u;
      setLive('live-last-follow', '@' + u);
      STATE.followsToday++;
      renderSummary();
    }
  });

  s.on('tiktok-like', () => { ULTIMA_ACTIVIDAD.tiktok = Date.now(); });
  s.on('youtube-superchat', () => { ULTIMA_ACTIVIDAD.youtube = Date.now(); renderPlatforms(); });
  s.on('youtube-member', () => { ULTIMA_ACTIVIDAD.youtube = Date.now(); });

  s.on('tiktok-viewers', (data) => {
    const n = data && (data.viewerCount ?? data.viewers ?? data.count);
    if (typeof n === 'number') {
      STATE.viewers.tiktok = n;
      setLive('live-viewers', n.toLocaleString('es'));
      updateHeroLiveStats();
      renderSummary();
    }
  });

  s.on('velora-viewers', (data) => {
    const n = data && (data.viewers ?? data.count);
    if (typeof n === 'number') {
      STATE.viewers.velora = n;
      updateHeroLiveStats();
      renderSummary();
    }
  });

  s.on('jar-update', (data) => {
    if (data && typeof data.totalDiamonds === 'number') {
      STATE.diamonds = data.totalDiamonds;
      setLive('live-diamonds', data.totalDiamonds.toLocaleString('es'));
      updateHeroLiveStats();
      renderSummary();
    }
  });

  s.on('jar-reset', () => {
    STATE.diamonds = 0;
    setLive('live-diamonds', '0');
    updateHeroLiveStats();
    renderSummary();
  });

  s.on('timer-update', (data) => {
    if (!data || !data.metaMs) { setLive('live-timer', '—'); return; }
    const restante = Math.max(0, data.metaMs - Date.now());
    setLive('live-timer', fmtDurationShort(restante));
  });

  s.on('hype-train:start', () => {
    addTimelineEvent({ platform: 'twitch', icon: '🔥', text: 'Hype Train <strong>iniciado</strong>', meta: 'Ahora' });
  });
  s.on('hype-train:end', () => {
    addTimelineEvent({ platform: 'twitch', icon: '🔥', text: 'Hype Train <strong>terminado</strong>', meta: 'Ahora' });
  });

  s.on('stats-update', (data) => {
    if (data && typeof data.totalDiamonds === 'number') {
      STATE.diamonds = data.totalDiamonds;
      setLive('live-diamonds', data.totalDiamonds.toLocaleString('es'));
      updateHeroLiveStats();
      renderSummary();
    }
  });
}

/* ──────────────────────────────────────────────
   MODO + IP
   ────────────────────────────────────────────── */
async function loadConnectionMode() {
  const val = $('mode-value');
  const ipBtn = $('ip-btn');
  if (!val) return;
  try {
    const info = await ipcRenderer.invoke('setup:get-info');
    if (info && info.mode) {
      val.textContent = info.mode === 'server' ? 'Modo servidor · PC principal' : 'Modo cliente · PC secundaria';
      if (info.mode === 'server') {
        const res = await fetch(window.SERVER_BASE + '/api/local-ip');
        const data = await res.json();
        if (data && data.ip) {
          serverIp = data.ip;
          const ipText = $('ip-text');
          if (ipText) ipText.textContent = serverIp;
          let oculta = false;
          try { oculta = localStorage.getItem('togi_ip_oculta') === '1'; } catch (e) {}
          if (!oculta && ipBtn) ipBtn.style.display = 'inline-flex';
        }
      }
    }
  } catch (e) {}
}

function copyIp() {
  if (!serverIp) return;
  navigator.clipboard.writeText(serverIp);
  showToast('IP copiada: ' + serverIp, 'ok');
}

function ocultarIp(ev) {
  if (ev) ev.stopPropagation();
  const btn = $('ip-btn');
  if (btn) btn.style.display = 'none';
  try { localStorage.setItem('togi_ip_oculta', '1'); } catch (e) {}
}

/* ──────────────────────────────────────────────
   NAVEGACIÓN + RESTART
   ────────────────────────────────────────────── */
function goTo(path) { window.location.href = window.SERVER_BASE + path; }
function openDeck() { window.location.href = window.SERVER_BASE + '/deck'; }
function reconfigureConnection() { window.location.href = window.SERVER_BASE + '/setup.html'; }

async function restartServers() {
  const btn = $('btn-restart');
  if (btn) btn.disabled = true;
  try {
    await ipcRenderer.invoke('restart-servers');
    showToast('Servidores reiniciados', 'ok');
  } catch (e) {
    showToast('Error al reiniciar', 'err');
  }
  setTimeout(() => { if (btn) btn.disabled = false; }, 2000);
}

/* ══════════════════════════════════════════════
   LOGS (mejorado)
   ══════════════════════════════════════════════ */
let logFilter = 'all';
let logCompact = false;
let logAutoScrollPausedByUser = false;

function openLogs() {
  const modal = $('logs-modal');
  if (modal) modal.classList.add('open');
  refreshLogs();
  if (logsInterval) clearInterval(logsInterval);
  logsInterval = setInterval(refreshLogs, 2000);
}

function closeLogs() {
  const modal = $('logs-modal');
  if (modal) modal.classList.remove('open');
  if (logsInterval) { clearInterval(logsInterval); logsInterval = null; }
}

async function refreshLogs() {
  try {
    const logs = await ipcRenderer.invoke('get-logs');
    rawLogs = logs || [];
    renderLogs();
  } catch (e) {
    const out = $('logs-output');
    if (out) out.innerHTML =
      '<div class="log-empty"><i class="ri-error-warning-line"></i><div class="log-empty-text">Error: ' + escapeHtml(e.message) + '</div></div>';
  }
}

function detectLogLevel(line) {
  if (!line) return 'info';
  if (line.includes('ERROR') || line.includes('✕') || line.includes('❌')) return 'error';
  if (line.includes('WARN') || line.includes('⚠') || line.includes('⚠️')) return 'warn';
  if (line.includes('OK') || line.includes('✅') || line.includes('✔')) return 'success';
  return 'info';
}

function logLevelIcon(level) {
  if (level === 'error') return 'ri-error-warning-line';
  if (level === 'warn') return 'ri-alert-line';
  if (level === 'success') return 'ri-checkbox-circle-line';
  return 'ri-information-line';
}

function parseLogLine(line) {
  const m = line.match(/^\[(.*?)\]\s*(.*)$/);
  if (m) return { time: m[1], msg: m[2] };
  return { time: '', msg: line };
}

function countLogLevels(lines) {
  const counts = { all: lines.length, info: 0, warn: 0, error: 0, success: 0 };
  lines.forEach(l => { counts[detectLogLevel(l)]++; });
  return counts;
}

function setLogFilter(level) {
  logFilter = level;
  document.querySelectorAll('.log-filter-chip').forEach(chip => {
    chip.classList.toggle('active', chip.getAttribute('data-level') === level);
  });
  const labels = { all: 'Todos', info: 'Info', warn: 'Warn', error: 'Error', success: 'OK' };
  const fl = $('console-filter-label');
  if (fl) fl.textContent = 'Filtro: ' + (labels[level] || 'Todos');
  renderLogs();
}

function toggleCompact() {
  logCompact = !logCompact;
  const box = $('logs-modal-box');
  if (box) box.classList.toggle('compact', logCompact);
  const btn = $('btn-compact');
  if (btn) btn.classList.toggle('active', logCompact);
}

function renderLogs() {
  const container = $('logs-output');
  if (!container) return;

  const counts = countLogLevels(rawLogs);
  ['all', 'info', 'warn', 'error', 'success'].forEach(lv => {
    const el = $('chip-count-' + lv);
    if (el) el.textContent = counts[lv];
  });

  const extra = $('logs-title-extra');
  if (extra) {
    extra.textContent = '· ' + rawLogs.length + ' eventos' +
      (counts.error > 0 ? ' · ' + counts.error + ' errores' : '');
  }

  const input = $('log-search-input');
  const q = (input ? input.value : '').toLowerCase().trim();

  let filtered = rawLogs;
  if (logFilter !== 'all') filtered = filtered.filter(l => detectLogLevel(l) === logFilter);
  if (q) filtered = filtered.filter(l => l.toLowerCase().includes(q));

  const count = $('console-count');
  if (count) {
    count.textContent = filtered.length === rawLogs.length
      ? filtered.length + ' eventos'
      : filtered.length + ' / ' + rawLogs.length + ' eventos';
  }

  if (filtered.length === 0) {
    container.innerHTML =
      '<div class="log-empty">' +
        '<i class="ri-file-list-3-line"></i>' +
        '<div class="log-empty-text">' +
          (rawLogs.length === 0 ? 'Sin eventos todavía.' : 'Sin resultados para el filtro actual.') +
        '</div>' +
      '</div>';
    return;
  }

  const html = filtered.map((line, i) => {
    const level = detectLogLevel(line);
    const parsed = parseLogLine(line);
    const icon = logLevelIcon(level);

    let msg = escapeHtml(parsed.msg);
    if (q) {
      const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      msg = msg.replace(re, '<mark>$1</mark>');
    }

    return (
      '<div class="log-line level-' + level + '" data-index="' + i + '">' +
        '<span class="log-time">' + escapeHtml(parsed.time) + '</span>' +
        '<span class="log-icon"><i class="' + icon + '"></i></span>' +
        '<span class="log-msg">' + msg + '</span>' +
        '<button class="log-copy" onclick="copySingleLine(' + i + ')" title="Copiar línea">' +
          '<i class="ri-file-copy-line"></i>' +
        '</button>' +
      '</div>'
    );
  }).join('');

  container.innerHTML = html;

  if (autoscroll && !logAutoScrollPausedByUser) {
    container.scrollTop = container.scrollHeight;
  }
}

function copySingleLine(idx) {
  const input = $('log-search-input');
  const q = (input ? input.value : '').toLowerCase().trim();
  let filtered = rawLogs;
  if (logFilter !== 'all') filtered = filtered.filter(l => detectLogLevel(l) === logFilter);
  if (q) filtered = filtered.filter(l => l.toLowerCase().includes(q));

  const line = filtered[idx];
  if (!line) return;
  navigator.clipboard.writeText(line);
  showToast('Línea copiada', 'ok');
}

function filterLogs() { renderLogs(); }

function toggleAutoscroll() {
  autoscroll = !autoscroll;
  logAutoScrollPausedByUser = !autoscroll;
  const btn = $('btn-autoscroll');
  if (btn) btn.classList.toggle('active', autoscroll);
  const status = $('autoscroll-status');
  if (status) status.classList.toggle('on', autoscroll);
  if (autoscroll) {
    const container = $('logs-output');
    if (container) container.scrollTop = container.scrollHeight;
  }
}

function scrollToBottom() {
  const container = $('logs-output');
  if (!container) return;
  container.scrollTop = container.scrollHeight;
  autoscroll = true;
  logAutoScrollPausedByUser = false;
  const btn = $('btn-autoscroll');
  if (btn) btn.classList.add('active');
  const status = $('autoscroll-status');
  if (status) status.classList.add('on');
  const sb = $('btn-scroll-bottom');
  if (sb) sb.classList.remove('show');
}

function copyConsoleLogs() {
  if (!rawLogs.length) return;
  const input = $('log-search-input');
  const q = (input ? input.value : '').toLowerCase().trim();
  let filtered = rawLogs;
  if (logFilter !== 'all') filtered = filtered.filter(l => detectLogLevel(l) === logFilter);
  if (q) filtered = filtered.filter(l => l.toLowerCase().includes(q));
  navigator.clipboard.writeText(filtered.join('\n'));
  showToast(filtered.length + ' líneas copiadas', 'ok');
}

function clearLogsUI() {
  rawLogs = [];
  renderLogs();
  showToast('Vista limpiada', 'ok');
}

function exportLogs() {
  const input = $('log-search-input');
  const q = (input ? input.value : '').toLowerCase().trim();
  let filtered = rawLogs;
  if (logFilter !== 'all') filtered = filtered.filter(l => detectLogLevel(l) === logFilter);
  if (q) filtered = filtered.filter(l => l.toLowerCase().includes(q));

  if (!filtered.length) {
    showToast('No hay logs para exportar', 'warn');
    return;
  }

  const blob = new Blob([filtered.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fecha = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = 'togipanel-logs-' + fecha + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Logs exportados', 'ok');
}

document.addEventListener('DOMContentLoaded', () => {
  const container = $('logs-output');
  const sb = $('btn-scroll-bottom');
  if (!container || !sb) return;

  container.addEventListener('scroll', () => {
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const atBottom = distanceFromBottom < 30;

    if (atBottom) {
      sb.classList.remove('show');
      if (logAutoScrollPausedByUser === false) {
        autoscroll = true;
        const btn = $('btn-autoscroll');
        if (btn) btn.classList.add('active');
        const status = $('autoscroll-status');
        if (status) status.classList.add('on');
      }
    } else {
      if (container.scrollHeight > container.clientHeight) {
        sb.classList.add('show');
        autoscroll = false;
        logAutoScrollPausedByUser = true;
        const btn = $('btn-autoscroll');
        if (btn) btn.classList.remove('active');
        const status = $('autoscroll-status');
        if (status) status.classList.remove('on');
      }
    }
  });
});

/* ──────────────────────────────────────────────
   TOAST
   ────────────────────────────────────────────── */
function showToast(msg, tipo) {
  const t = $('toast');
  const txt = $('toast-text');
  if (!t || !txt) return;
  txt.textContent = msg;
  t.classList.remove('ok', 'err', 'warn');
  if (tipo) t.classList.add(tipo);
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

/* ──────────────────────────────────────────────
   ARRANQUE
   ────────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLogs();
});

setInterval(() => {
  STATE.messagesThisMinute = 0;
  renderSummary();
}, 60000);

setInterval(() => {
  checkServerStatus();
  fetchObsInfo();
  fetchProxyStatus();
}, 30000);

setInterval(() => {
  if (!STATE.isLive) fetchLastStream().then(() => renderHero());
}, 60000);

setInterval(() => {
  if (!STATE.isLive) renderPlatforms();
}, 5000);

(async function init() {
  await checkServerStatus();
  await loadConnectionMode();
  await cargarEstadoInicialVivo();
  await fetchLastStream();
  renderHero();
  renderSummary();
  renderPlatforms();

  if (typeof io !== 'undefined') {
    initSocket();
  } else {
    const checkIo = setInterval(() => {
      if (typeof io !== 'undefined') {
        clearInterval(checkIo);
        initSocket();
      }
    }, 100);
  }

  console.log('🎛️ panel.js cargado');
})();

async function cargarEstadoInicialVivo() {
  try {
    const r = await fetch(window.SERVER_BASE + '/api/jar-state');
    const j = await r.json();
    if (j && typeof j.totalDiamonds === 'number') {
      STATE.diamonds = j.totalDiamonds;
      setLive('live-diamonds', j.totalDiamonds.toLocaleString('es'));
    }
  } catch (e) {}

  try {
    const r = await fetch(window.SERVER_BASE + '/api/timer-state');
    const t = await r.json();
    if (t && typeof t.metaMs === 'number' && t.metaMs > 0) {
      const restante = Math.max(0, t.metaMs - Date.now());
      setLive('live-timer', fmtDurationShort(restante));
      if (t.modo === 'live') {
        STATE.isLive = true;
        STATE.liveSince = Date.now() - (t.transcurridoMs || 0);
        startUptimeTick();
        renderHero();
        renderSummary();
      }
    } else {
      setLive('live-timer', '—');
    }
  } catch (e) {}
}