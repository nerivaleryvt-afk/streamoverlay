/* ═══════════════════════════════════════════════════════════════
   crystal.js — Lógica del overlay de cristal (meta de donaciones)
   Depende de: server-url.js (window.SERVER_BASE)
              socket.io
   ═══════════════════════════════════════════════════════════════ */

const TOP_DONOR_DURATION = 5000;
const MAX_PARTICLES = 60;

const socket = io(window.SERVER_BASE);

const particles     = document.getElementById('particles');
const topDonorWrap  = document.getElementById('topDonorWrap');
const topDonorLabel = document.getElementById('topDonorLabel');
const topAvatar     = document.getElementById('topAvatar');
const topName       = document.getElementById('topName');
const topCoins      = document.getElementById('topCoins');
const giftInfo      = document.getElementById('giftInfo');
const giftIconWrap  = document.getElementById('giftIconWrap');
const giftNameEl    = document.getElementById('giftName');
const giftStreakEl  = document.getElementById('giftStreak');
const totalCoins    = document.getElementById('totalCoins');
const metaCoins     = document.getElementById('metaCoins');
const metaLabel     = document.getElementById('metaLabel');
const progressWrap  = document.getElementById('progressWrap');
const progressFill  = document.getElementById('progressFill');
const progressText  = document.getElementById('progressText');
const ambient       = document.getElementById('ambient');

/* ──────────────────────────────────────────────
   AVATAR DEL TOP DONADOR
   SVG por defecto (sin depender de Imgur)
   ────────────────────────────────────────────── */
const DEFAULT_AVATAR_SVG = `
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"/>
  </svg>`;

function setTopAvatar(url) {
  if (!url) {
    if (!topAvatar.classList.contains('is-default')) {
      topAvatar.classList.add('is-default');
      topAvatar.innerHTML = DEFAULT_AVATAR_SVG;
    }
  } else {
    topAvatar.classList.remove('is-default');
    topAvatar.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.addEventListener('error', () => setTopAvatar(null), { once: true });
    topAvatar.appendChild(img);
  }
}

let meta = 500;
let totalDiamonds = 0;
const userTotals = new Map();
const userAvatars = new Map();
const userLastGift = new Map();
let topDonorTimer = null;
let themeApplied = false;

/* ──────────────────────────────────────────────
   SISTEMA DE PARTÍCULAS CON FÍSICA DE CAÍDA Y APILADO
   ────────────────────────────────────────────── */
const COLS = 10;
const COL_W = 20;
const ROW_H = 14;
const MAX_ROWS = 18;
const PARTICLE_FLOOR_OFFSET = 12;
const MAX_CAPACITY = COLS * MAX_ROWS;

const stack = new Array(COLS).fill(0);

function pickColumnWithFewest() {
  let min = Infinity, candidates = [];
  for (let c = 0; c < COLS; c++) {
    if (stack[c] < min) { min = stack[c]; candidates = [c]; }
    else if (stack[c] === min) candidates.push(c);
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function particlePositionFor(col, row) {
  const x = col * COL_W + (COL_W - 12) / 2;
  const y = (MAX_ROWS - 1 - row) * ROW_H + PARTICLE_FLOOR_OFFSET;
  return { x, y };
}

function particlePositionForGift(col, row) {
  const x = col * COL_W + (COL_W - 18) / 2;
  const y = (MAX_ROWS - 1 - row) * ROW_H + PARTICLE_FLOOR_OFFSET;
  return { x, y };
}

function colRowFromIndex(idx) {
  return { col: idx % COLS, row: Math.floor(idx / COLS) };
}

function meltOldestParticles(count) {
  const candidates = Array.from(particles.children).filter(el => !el.classList.contains('melting'));
  for (let i = 0; i < count && i < candidates.length; i++) {
    const el = candidates[i];
    el.classList.add('melting');
    setTimeout(() => el.remove(), 650);
  }
}

function updateStackFromDOM() {
  stack.fill(0);
  for (const el of particles.children) {
    if (el.classList.contains('melting')) continue;
    const col = parseInt(el.dataset.col, 10);
    if (!isNaN(col) && col >= 0 && col < COLS) stack[col]++;
  }
}

function addParticle(iconUrl, isGold = false) {
  const activeCount = Array.from(particles.children).filter(el => !el.classList.contains('melting')).length;
  if (activeCount >= MAX_CAPACITY) {
    meltOldestParticles(Math.ceil(activeCount * 0.15));
  }

  updateStackFromDOM();

  const col = pickColumnWithFewest();
  const row = stack[col];
  if (row >= MAX_ROWS) return;

  stack[col]++;

  const isGift = !!iconUrl;
  const p = document.createElement('div');
  p.className = 'particle' + (isGold ? ' gold' : '') + (isGift ? ' gift-icon' : '');
  if (isGift) p.style.backgroundImage = `url('${iconUrl}')`;

  const pos = isGift ? particlePositionForGift(col, row) : particlePositionFor(col, row);
  p.style.left = pos.x + 'px';
  p.style.top  = pos.y + 'px';
  p.dataset.col = col;
  p.dataset.row = row;

  p.style.transform = 'translateY(-400px)';
  p.style.opacity = '0';

  particles.appendChild(p);

  void p.offsetWidth;

  requestAnimationFrame(() => {
    p.style.transition = 'transform 0.7s cubic-bezier(0.34, 1.35, 0.64, 1), opacity 0.25s ease-out, background 0.5s ease, box-shadow 0.5s ease';
    p.style.transform = 'translateY(0)';
    p.style.opacity = '1';
  });
}

function reconstruirParticulas() {
  particles.innerHTML = '';
  stack.fill(0);

  const cantidad = Math.min(Math.floor(totalDiamonds / 15), MAX_PARTICLES);
  for (let i = 0; i < cantidad; i++) {
    const { col, row } = colRowFromIndex(i);
    if (col >= COLS) break;
    stack[col] = Math.max(stack[col], row + 1);

    const p = document.createElement('div');
    p.className = 'particle';
    if (Math.random() < 0.15) p.classList.add('gold');
    const pos = particlePositionFor(col, row);
    p.style.left = pos.x + 'px';
    p.style.top  = pos.y + 'px';
    p.dataset.col = col;
    p.dataset.row = row;
    particles.appendChild(p);
  }
}

/* ──────────────────────────────────────────────
   GIFT EMOJI FALLBACK
   ────────────────────────────────────────────── */
const GIFT_EMOJI_FALLBACK = {
  'rosa': '🌹', 'rose': '🌹',
  'gg': '🎮',
  'corazon': '💖', 'corazón': '💖', 'heart': '💖', 'heart-me': '💖',
  'corona': '👑', 'crown': '👑',
  'coconut': '🥥', 'coco': '🥥', 'drink': '🥤',
  'cafe': '☕', 'café': '☕', 'coffee': '☕',
  'helado': '🍦', 'ice cream': '🍦',
  'cerveza': '🍺', 'beer': '🍺',
  'pizza': '🍕',
  'guitarra': '🎸', 'guitar': '🎸',
  'flor': '🌸', 'flower': '🌸',
  'perfume': '💐',
  'diamante': '💎', 'diamond': '💎',
  'galaxy': '🌌', 'galaxia': '🌌',
  'universo': '🌌', 'universe': '🌌',
  'planeta': '🪐', 'planet': '🪐',
  'dragon': '🐉', 'dragón': '🐉',
  'fuego': '🔥', 'fire': '🔥',
  'star': '⭐', 'estrella': '⭐',
  'train': '🚂', 'tren': '🚂',
  'cohete': '🚀', 'rocket': '🚀',
  'oso': '🧸', 'teddy': '🧸', 'bear': '🧸',
  'anillo': '💍', 'ring': '💍',
  'libro': '📕', 'book': '📕'
};

function getEmojiFallback(giftName) {
  if (!giftName) return '🎁';
  const key = String(giftName).toLowerCase().trim();
  if (GIFT_EMOJI_FALLBACK[key]) return GIFT_EMOJI_FALLBACK[key];
  for (const [k, v] of Object.entries(GIFT_EMOJI_FALLBACK)) {
    if (key.includes(k)) return v;
  }
  return '🎁';
}

function formatearNumero(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 10000)   return (n / 1000).toFixed(0) + 'K';
  if (n >= 1000)    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function renderGiftIcon(giftName, giftImage, giftIcon) {
  const icon = giftImage || giftIcon;
  giftIconWrap.innerHTML = '';
  if (icon) {
    const emoji = getEmojiFallback(giftName);
    const img = document.createElement('img');
    img.src = icon;
    img.alt = '';
    img.addEventListener('error', () => {
      giftIconWrap.textContent = emoji;
    }, { once: true });
    giftIconWrap.appendChild(img);
  } else if (giftName) {
    giftIconWrap.textContent = getEmojiFallback(giftName);
  } else {
    giftIconWrap.textContent = '🎁';
  }
}

function crearChispaAmbiental() {
  const s = document.createElement('div');
  s.className = 'ambient-spark';
  s.style.left = Math.random() * 100 + '%';
  s.style.bottom = '-10px';
  s.style.animationDelay = Math.random() * 6 + 's';
  s.style.animationDuration = (4 + Math.random() * 4) + 's';
  ambient.appendChild(s);
  setTimeout(() => s.remove(), 10000);
}
for (let i = 0; i < 3; i++) setTimeout(crearChispaAmbiental, i * 800);
setInterval(crearChispaAmbiental, 3000);

/* ──────────────────────────────────────────────
   TEMA
   ────────────────────────────────────────────── */
function aplicarTema(vars) {
  if (!vars || typeof vars !== 'object') return;
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v !== 'string') continue;
    if (k === '--meta-label')             { metaLabel.textContent = v; continue; }
    if (k === '--topdonor-label')         { topDonorLabel.textContent = v; continue; }
    if (k === '--meta-label-visible')     { metaLabel.style.display = (v === 'false') ? 'none' : ''; continue; }
    if (k === '--topdonor-label-visible') { topDonorLabel.style.display = (v === 'false') ? 'none' : ''; continue; }
    if (k.startsWith('--')) {
      document.documentElement.style.setProperty(k, v);
    }
  }
  themeApplied = true;
}

async function cargarTema() {
  try {
    const r = await fetch(window.SERVER_BASE + '/api/themes/crystal');
    if (!r.ok) return;
    const vars = await r.json();
    if (vars && Object.keys(vars).length > 0) aplicarTema(vars);
  } catch (e) { console.warn('Sin tema:', e.message); }
}

/* ──────────────────────────────────────────────
   ESTILO DEL CRISTAL (jar | bar)
   ────────────────────────────────────────────── */
function aplicarEstiloCristal(estilo) {
  const stage = document.getElementById('stage');
  if (!stage) return;
  const validos = ['jar', 'bar'];
  const elegido = validos.includes(estilo) ? estilo : 'jar';
  stage.setAttribute('data-style', elegido);
  console.log('🎨 Estilo de cristal:', elegido);
}

async function cargarMeta() {
  try {
    const r = await fetch(window.SERVER_BASE + '/get-config');
    if (!r.ok) return;
    const config = await r.json();
    if (typeof config.JAR_META === 'number' && config.JAR_META >= 1) {
      meta = config.JAR_META;
    }
    if (typeof config.CRYSTAL_STYLE === 'string' && config.CRYSTAL_STYLE) {
      aplicarEstiloCristal(config.CRYSTAL_STYLE);
    }
    metaCoins.textContent = formatearNumero(meta);
    updateUI();
  } catch (e) { console.warn('Sin meta:', e.message); }
}

async function cargarEstado() {
  try {
    const r = await fetch(window.SERVER_BASE + '/api/jar-state');
    if (!r.ok) return;
    const state = await r.json();

    totalDiamonds = state.totalDiamonds || 0;
    userTotals.clear();
    userAvatars.clear();
    userLastGift.clear();

    for (const [u, d] of Object.entries(state.userTotals || {})) userTotals.set(u, d);
    for (const [u, a] of Object.entries(state.userAvatars || {})) userAvatars.set(u, a);

    if (state.lastGift) {
      userLastGift.set(state.lastGift.username, {
        giftName: state.lastGift.giftName,
        giftImage: state.lastGift.giftImage,
        giftIcon: state.lastGift.giftIcon,
        repeatCount: state.lastGift.repeatCount
      });
    }

    reconstruirParticulas();
    updateUI();
    mostrarTopHistorico();
  } catch (e) { console.warn('Sin estado:', e.message); }
}

/* ──────────────────────────────────────────────
   TOP DONOR (frasco)
   ────────────────────────────────────────────── */
function showTopDonorTemporal({ username, avatar, diamonds, giftName, giftImage, giftIcon, repeatCount }) {
  setTopAvatar(avatar);
  topName.textContent = username;
  topCoins.textContent = formatearNumero(diamonds);

  if (giftName || giftImage || giftIcon) {
    renderGiftIcon(giftName, giftImage, giftIcon);
    giftNameEl.textContent = giftName || '';

    if (repeatCount && repeatCount > 1) {
      giftStreakEl.textContent = 'x' + repeatCount;
      giftStreakEl.style.display = '';
    } else {
      giftStreakEl.style.display = 'none';
    }

    giftInfo.style.display = 'flex';
  } else {
    giftInfo.style.display = 'none';
  }

  topDonorWrap.classList.add('show');

  clearTimeout(topDonorTimer);
  topDonorTimer = setTimeout(() => mostrarTopHistorico(), TOP_DONOR_DURATION);
}

function mostrarTopHistorico() {
  let topUser = null, topDiamonds = 0;
  for (const [u, d] of userTotals.entries()) {
    if (d > topDiamonds) { topDiamonds = d; topUser = u; }
  }
  if (topUser) {
    setTopAvatar(userAvatars.get(topUser));
    topName.textContent = topUser;
    topCoins.textContent = formatearNumero(topDiamonds);

    const lastGift = userLastGift.get(topUser);
    if (lastGift) {
      renderGiftIcon(lastGift.giftName, lastGift.giftImage, lastGift.giftIcon);
      giftNameEl.textContent = lastGift.giftName || '';

      if (lastGift.repeatCount && lastGift.repeatCount > 1) {
        giftStreakEl.textContent = 'x' + lastGift.repeatCount;
        giftStreakEl.style.display = '';
      } else {
        giftStreakEl.style.display = 'none';
      }

      giftInfo.style.display = 'flex';
    } else {
      giftInfo.style.display = 'none';
    }

    topDonorWrap.classList.add('show');
  } else {
    topDonorWrap.classList.remove('show');
  }
}

/* ──────────────────────────────────────────────
   TOP DONOR de la barra (arriba)
   ────────────────────────────────────────────── */
function actualizarBarTopDonor() {
  const wrap = document.getElementById('barTopDonor');
  if (!wrap) return;

  let topUser = null, topDiamonds = 0;
  for (const [u, d] of userTotals.entries()) {
    if (d > topDiamonds) { topDiamonds = d; topUser = u; }
  }

  const nameEl = document.getElementById('barName');
  const coinsEl = document.getElementById('barCoins');
  const avatarEl = document.getElementById('barAvatar');

  if (topUser) {
    wrap.classList.add('show');
    if (nameEl) nameEl.textContent = topUser;
    if (coinsEl) coinsEl.textContent = formatearNumero(topDiamonds);

    if (avatarEl) {
      const url = userAvatars.get(topUser);
      if (url) {
        avatarEl.classList.remove('is-default');
        avatarEl.innerHTML = '';
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.addEventListener('error', () => {
          avatarEl.classList.add('is-default');
          avatarEl.innerHTML = DEFAULT_AVATAR_SVG;
        }, { once: true });
        avatarEl.appendChild(img);
      } else {
        avatarEl.classList.add('is-default');
        avatarEl.innerHTML = DEFAULT_AVATAR_SVG;
      }
    }
  } else {
    wrap.classList.remove('show');
  }
}

/* ──────────────────────────────────────────────
   UI (meta + progreso + barra)
   ────────────────────────────────────────────── */
function updateUI() {
  totalCoins.textContent = formatearNumero(totalDiamonds);
  metaCoins.textContent = formatearNumero(meta);

  const percent = Math.min((totalDiamonds / meta) * 100, 100);

  // Progreso del frasco
  progressFill.style.width = percent + '%';
  progressText.textContent = Math.round(percent) + '%';
  progressWrap.classList.toggle('show', totalDiamonds > 0);

  // Progreso de la barra
  const barFill = document.querySelector('.bar-fill');
  if (barFill) barFill.style.width = percent + '%';

  const barTotal = document.getElementById('barTotal');
  if (barTotal) barTotal.textContent = formatearNumero(totalDiamonds);

  const barMeta = document.getElementById('barMeta');
  if (barMeta) barMeta.textContent = formatearNumero(meta);

  const barPercent = document.getElementById('barPercent');
  if (barPercent) barPercent.textContent = Math.round(percent) + '%';

  actualizarBarTopDonor();

  document.body.classList.toggle('meta-reached', percent >= 100);
}

/* ──────────────────────────────────────────────
   SOCKET.IO
   ────────────────────────────────────────────── */
socket.on('jar-state', (state) => {
  totalDiamonds = state.totalDiamonds || 0;
  userTotals.clear();
  userAvatars.clear();
  userLastGift.clear();
  for (const [u, d] of Object.entries(state.userTotals || {})) userTotals.set(u, d);
  for (const [u, a] of Object.entries(state.userAvatars || {})) userAvatars.set(u, a);

  if (state.lastGift) {
    userLastGift.set(state.lastGift.username, {
      giftName: state.lastGift.giftName,
      giftImage: state.lastGift.giftImage,
      giftIcon: state.lastGift.giftIcon,
      repeatCount: state.lastGift.repeatCount
    });
  }

  reconstruirParticulas();
  updateUI();
  mostrarTopHistorico();
});

socket.on('jar-update', (data) => {
  totalDiamonds = data.totalDiamonds || 0;

  if (data.userTotals) {
    for (const [u, d] of Object.entries(data.userTotals)) userTotals.set(u, d);
  }

  const lastGift = data.lastGift;
  if (lastGift) {
    if (lastGift.avatar) userAvatars.set(lastGift.username, lastGift.avatar);

    userLastGift.set(lastGift.username, {
      giftName: lastGift.giftName,
      giftImage: lastGift.giftImage,
      giftIcon: lastGift.giftIcon,
      repeatCount: lastGift.repeatCount
    });

    const isGold = (lastGift.diamonds || 0) >= 50;
    const repeat = Math.min(lastGift.repeatCount || 1, 5);
    const icon = lastGift.giftImage || lastGift.giftIcon || null;

    for (let i = 0; i < repeat; i++) {
      setTimeout(() => addParticle(icon, isGold), i * 80);
    }

    showTopDonorTemporal({
      username: lastGift.username,
      avatar: lastGift.avatar,
      diamonds: userTotals.get(lastGift.username) || lastGift.diamonds,
      giftName: lastGift.giftName,
      giftImage: lastGift.giftImage,
      giftIcon: lastGift.giftIcon,
      repeatCount: lastGift.repeatCount
    });
  }
  updateUI();
});

socket.on('jar-reset', () => {
  particles.innerHTML = '';
  stack.fill(0);
  userTotals.clear();
  userAvatars.clear();
  userLastGift.clear();
  totalDiamonds = 0;
  topDonorWrap.classList.remove('show');
  clearTimeout(topDonorTimer);
  updateUI();
});

socket.on('jar-meta-updated', ({ meta: nuevaMeta }) => {
  if (typeof nuevaMeta === 'number' && nuevaMeta >= 1) {
    meta = nuevaMeta;
    updateUI();
  }
});

socket.on('crystal-style-updated', ({ style }) => {
  if (typeof style === 'string') {
    aplicarEstiloCristal(style);
  }
});

socket.on('theme-updated', ({ overlay, vars }) => {
  if (overlay !== 'crystal') return;
  if (!vars || Object.keys(vars).length === 0) {
    metaLabel.textContent = 'Meta';
    topDonorLabel.textContent = 'Top Donador';
    metaLabel.style.display = '';
    topDonorLabel.style.display = '';
  } else {
    aplicarTema(vars);
  }
});

socket.on('connect', () => {
  cargarTema();
  cargarMeta();
  cargarEstado();
});

setTimeout(() => {
  if (!themeApplied) cargarTema();
  cargarMeta();
  cargarEstado();
}, 1000);

/* ──────────────────────────────────────────────
   MODO PREVIEW (?preview=1)
   ────────────────────────────────────────────── */
const params = new URLSearchParams(location.search);
if (params.get('preview') === '1') {
  const fakeUsers = ['Zerody', 'TestUser', 'Ana', 'Luis', 'Carla'];
  const fakeGifts = [
    { name: 'Rosa',          icon: '/img/gifts/rose.png',         diamonds: 1   },
    { name: 'GG',            icon: '/img/gifts/gg.png',           diamonds: 1   },
    { name: 'Corazón',       icon: '/img/gifts/heart-me.png',     diamonds: 5   },
    { name: 'Coconut Drink', icon: '/img/gifts/coconut-drink.png', diamonds: 1  },
    { name: 'Corona',        icon: '/img/gifts/crown.png',        diamonds: 100 }
  ];

  setInterval(() => {
    const user = fakeUsers[Math.floor(Math.random() * fakeUsers.length)];
    const gift = fakeGifts[Math.floor(Math.random() * fakeGifts.length)];
    const repeat = Math.floor(Math.random() * 3) + 1;
    const diamonds = gift.diamonds * repeat;

    totalDiamonds += diamonds;
    userTotals.set(user, (userTotals.get(user) || 0) + diamonds);
    const avatar = `https://i.pravatar.cc/150?u=${user}`;
    userAvatars.set(user, avatar);

    userLastGift.set(user, {
      giftName: gift.name,
      giftImage: gift.icon,
      giftIcon: gift.icon,
      repeatCount: repeat
    });

    const isGold = diamonds >= 50;
    for (let i = 0; i < Math.min(repeat, 5); i++) {
      setTimeout(() => addParticle(gift.icon, isGold), i * 80);
    }

    showTopDonorTemporal({
      username: user,
      avatar: avatar,
      diamonds: userTotals.get(user),
      giftName: gift.name,
      giftImage: gift.icon,
      giftIcon: gift.icon,
      repeatCount: repeat
    });
    updateUI();
  }, 2500);
}