// ═══════════════════════════════════════════════════════════════
//  overlays.js — Lógica de la galería de overlays
// ═══════════════════════════════════════════════════════════════

const OVERLAY_CONFIGS = {
  'top-donadores': {
    groups: [
      { title: 'Cabecera', vars: [
        { key: '--tiktok-pink', label: 'Rosa principal', default: '#ff0050' },
        { key: '--tiktok-cyan', label: 'Cyan',           default: '#00e5ff' }
      ]},
      { title: 'Filas', vars: [
        { key: '--bordercolor', label: 'Borde fila',     default: '#ff69b4' },
        { key: '--msgcol-hex',  label: 'Fondo fila',     default: '#141820' }
      ]},
      { title: 'Géneros', vars: [
        { key: '--gender-masc', label: 'Masculino', default: '#38bdf8' },
        { key: '--gender-fem',  label: 'Femenino',  default: '#f472b6' },
        { key: '--gender-uni',  label: 'Unisex',    default: '#a78bfa' }
      ]}
    ],
    presets: {
      original: { '--tiktok-pink': '#ff0050', '--tiktok-cyan': '#00e5ff', '--bordercolor': '#ff69b4', '--gender-masc': '#38bdf8', '--gender-fem': '#f472b6', '--gender-uni': '#a78bfa', '--msgcol-hex': '#141820' },
      gold:     { '--tiktok-pink': '#ffd700', '--tiktok-cyan': '#ff8c00', '--bordercolor': '#ffd700', '--gender-masc': '#ffd700', '--gender-fem': '#ffa500', '--gender-uni': '#ffec8b', '--msgcol-hex': '#1a1408' },
      neon:     { '--tiktok-pink': '#00ff88', '--tiktok-cyan': '#00bfff', '--bordercolor': '#00ff88', '--gender-masc': '#00bfff', '--gender-fem': '#00ff88', '--gender-uni': '#7fff00', '--msgcol-hex': '#001a10' }
    }
  },
  'top-likes': {
    groups: [
      { title: 'Cabecera', vars: [
        { key: '--like-pink',    label: 'Rojo corazón', default: '#ff0050' },
        { key: '--like-magenta', label: 'Magenta',      default: '#ec4899' }
      ]},
      { title: 'Filas', vars: [
        { key: '--bordercolor', label: 'Borde fila', default: '#ff69b4' },
        { key: '--msgcol-hex',  label: 'Fondo fila', default: '#141820' }
      ]},
      { title: 'Géneros', vars: [
        { key: '--gender-masc', label: 'Masculino', default: '#38bdf8' },
        { key: '--gender-fem',  label: 'Femenino',  default: '#f472b6' },
        { key: '--gender-uni',  label: 'Unisex',    default: '#a78bfa' }
      ]}
    ],
    presets: {
      original: { '--like-pink': '#ff0050', '--like-magenta': '#ec4899', '--bordercolor': '#ff69b4', '--gender-masc': '#38bdf8', '--gender-fem': '#f472b6', '--gender-uni': '#a78bfa', '--msgcol-hex': '#141820' },
      gold:     { '--like-pink': '#ffd700', '--like-magenta': '#ff8c00', '--bordercolor': '#ffd700', '--gender-masc': '#ffd700', '--gender-fem': '#ffa500', '--gender-uni': '#ffec8b', '--msgcol-hex': '#1a1408' },
      neon:     { '--like-pink': '#00ff88', '--like-magenta': '#00bfff', '--bordercolor': '#00ff88', '--gender-masc': '#00bfff', '--gender-fem': '#00ff88', '--gender-uni': '#7fff00', '--msgcol-hex': '#001a10' }
    }
  },
  'top-shares': {
    groups: [
      { title: 'Cabecera', vars: [
        { key: '--share-cyan', label: 'Cyan', default: '#00e5ff' },
        { key: '--share-teal', label: 'Teal', default: '#14b8a6' }
      ]},
      { title: 'Filas', vars: [
        { key: '--bordercolor', label: 'Borde fila', default: '#00e5ff' },
        { key: '--msgcol-hex',  label: 'Fondo fila', default: '#141820' }
      ]},
      { title: 'Géneros', vars: [
        { key: '--gender-masc', label: 'Masculino', default: '#38bdf8' },
        { key: '--gender-fem',  label: 'Femenino',  default: '#f472b6' },
        { key: '--gender-uni',  label: 'Unisex',    default: '#a78bfa' }
      ]}
    ],
    presets: {
      original: { '--share-cyan': '#00e5ff', '--share-teal': '#14b8a6', '--bordercolor': '#00e5ff', '--gender-masc': '#38bdf8', '--gender-fem': '#f472b6', '--gender-uni': '#a78bfa', '--msgcol-hex': '#141820' },
      gold:     { '--share-cyan': '#ffd700', '--share-teal': '#ff8c00', '--bordercolor': '#ffd700', '--gender-masc': '#ffd700', '--gender-fem': '#ffa500', '--gender-uni': '#ffec8b', '--msgcol-hex': '#1a1408' },
      neon:     { '--share-cyan': '#00ff88', '--share-teal': '#00bfff', '--bordercolor': '#00ff88', '--gender-masc': '#00bfff', '--gender-fem': '#00ff88', '--gender-uni': '#7fff00', '--msgcol-hex': '#001a10' }
    }
  },
  'follows': {
    groups: [
      { title: 'Colores', vars: [
        { key: '--accent-purple', label: 'Morado',        default: '#a78bfa' },
        { key: '--accent-pink',   label: 'Rosa',          default: '#f472b6' },
        { key: '--msgcol-hex',    label: 'Fondo tarjeta', default: '#141820' }
      ]},
      { title: 'Géneros', vars: [
        { key: '--gender-masc', label: 'Masculino', default: '#38bdf8' },
        { key: '--gender-fem',  label: 'Femenino',  default: '#f472b6' },
        { key: '--gender-uni',  label: 'Unisex',    default: '#a78bfa' }
      ]}
    ],
    presets: {
      original: { '--accent-purple': '#a78bfa', '--accent-pink': '#f472b6', '--msgcol-hex': '#141820', '--gender-masc': '#38bdf8', '--gender-fem': '#f472b6', '--gender-uni': '#a78bfa' },
      gold:     { '--accent-purple': '#ffd700', '--accent-pink': '#ff8c00', '--msgcol-hex': '#1a1408', '--gender-masc': '#ffd700', '--gender-fem': '#ffa500', '--gender-uni': '#ffec8b' },
      neon:     { '--accent-purple': '#00ff88', '--accent-pink': '#00bfff', '--msgcol-hex': '#001a10', '--gender-masc': '#00bfff', '--gender-fem': '#00ff88', '--gender-uni': '#7fff00' }
    }
  },
  'stats': {
    groups: [
      { title: 'Colores', vars: [
        { key: '--stat-pink',   label: 'Rosa',   default: '#f472b6' },
        { key: '--stat-purple', label: 'Morado', default: '#a78bfa' }
      ]}
    ],
    presets: {
      original: { '--stat-pink': '#f472b6', '--stat-purple': '#a78bfa' },
      gold:     { '--stat-pink': '#ffd700', '--stat-purple': '#ff8c00' },
      neon:     { '--stat-pink': '#00ff88', '--stat-purple': '#00bfff' }
    }
  }
};

let overlayActual = null;
let valoresActuales = {};
let favFilterActive = false;
let favoritos = JSON.parse(localStorage.getItem('togi_favs') || '[]');

// ─── FAVORITOS ───
function toggleFavorito(key, btn) {
  const idx = favoritos.indexOf(key);
  if (idx >= 0) favoritos.splice(idx, 1);
  else favoritos.push(key);
  localStorage.setItem('togi_favs', JSON.stringify(favoritos));
  btn.classList.toggle('is-fav', favoritos.includes(key));
  const icon = btn.querySelector('i');
  icon.className = favoritos.includes(key) ? 'ri-star-fill' : 'ri-star-line';
  mostrarToast(favoritos.includes(key) ? 'Añadido a favoritos' : 'Quitado de favoritos');
  actualizarHero();
  aplicarFiltros();
}

function toggleFavFilter() {
  favFilterActive = !favFilterActive;
  document.getElementById('favFilterBtn').classList.toggle('active', favFilterActive);
  aplicarFiltros();
}

function aplicarFiltros() {
  const categoria = document.querySelector('.nav-item.active')?.dataset.filter || 'all';
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  let visibles = 0;

  document.querySelectorAll('.overlay-card').forEach(card => {
    const cat = card.dataset.category || '';
    const key = card.dataset.key || '';
    const title = card.querySelector('h3')?.textContent.toLowerCase() || '';
    const desc = card.querySelector('p')?.textContent.toLowerCase() || '';

    const matchCat = categoria === 'all' || cat === categoria;
    const matchQ = !q || title.includes(q) || desc.includes(q);
    const matchFav = !favFilterActive || favoritos.includes(key);

    const visible = matchCat && matchQ && matchFav;
    card.style.display = visible ? '' : 'none';
    if (visible) visibles++;
  });

  document.getElementById('emptyState')?.classList.toggle('show', visibles === 0);
}

function actualizarHero() {
  const total = document.querySelectorAll('.overlay-card').length;
  const custom = Object.keys(OVERLAY_CONFIGS).length + 4;
  const live = document.querySelectorAll('.overlay-card.live').length;

  document.getElementById('heroTotal').textContent = total;
  document.getElementById('heroCustom').textContent = custom;
  document.getElementById('heroLive').textContent = live;
  document.getElementById('countAll').textContent = total;
}

async function copiarTodasUrls() {
  const base = (window.SERVER_BASE || window.location.origin).replace(/\/$/, '');
  const lineas = [];
  document.querySelectorAll('.overlay-card').forEach(card => {
    const key = card.dataset.key;
    const path = card.dataset.path;
    const title = card.querySelector('h3')?.textContent || key;
    if (path) lineas.push(`${title}: ${base}${path}`);
  });
  const texto = lineas.join('\n');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
    } else {
      const ta = document.createElement('textarea');
      ta.value = texto;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    mostrarToast(`${lineas.length} URLs copiadas`);
  } catch (e) {
    mostrarToast('Error copiando');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.overlay-card[data-key]').forEach(card => {
    const key = card.dataset.key;
    const btn = card.querySelector('.fav-btn');
    if (btn && favoritos.includes(key)) {
      btn.classList.add('is-fav');
      const icon = btn.querySelector('i');
      if (icon) icon.className = 'ri-star-fill';
    }
  });
  actualizarHero();
});

// ─── FILTROS ───
function filtrar(categoria, boton) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  boton.classList.add('active');
  aplicarFiltros();
}

function buscar(query) {
  aplicarFiltros();
}

// ─── COPIAR URL ───
async function copiarUrl(path) {
  const base = (window.SERVER_BASE || window.location.origin).replace(/\/$/, '');
  const url = base + path;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    mostrarToast('URL copiada: ' + url);
  } catch (e) {
    mostrarToast('Error copiando URL');
  }
}

// ═══════════════════════════════════════════════════════════════
//  PREVIEWS — Thumbnails estáticos
//  No cargamos iframes. Cada card tiene un thumbnail con icono
//  de categoría + URL. Click → abre overlay real en pestaña nueva.
// ═══════════════════════════════════════════════════════════════

function renderizarThumbnails() {
  document.querySelectorAll('.overlay-card').forEach(card => {
    const previewBox = card.querySelector('.preview-box');
    if (!previewBox) return;

    // Si ya tiene un placeholder propio (TTS) lo dejamos tal cual
    if (previewBox.querySelector('.preview-placeholder')) return;

    // Icono del card
    const iconoEl = card.querySelector('.card-icon i');
    const iconoClase = iconoEl ? iconoEl.className : 'ri-apps-2-line';

    // URL del overlay
    const path = card.dataset.path
      || previewBox.querySelector('.url-text')?.textContent
      || '';

    // Limpiar contenido antiguo (iframes, hints, footers)
    previewBox
      .querySelectorAll('iframe, .preview-frame, .preview-empty-hint, .preview-footer')
      .forEach(el => el.remove());

    // Crear thumbnail
    const thumb = document.createElement('div');
    thumb.className = 'preview-thumb';
    thumb.innerHTML = `
      <div class="preview-thumb-icon"><i class="${iconoClase}"></i></div>
      <div class="preview-thumb-path">${path}</div>
      <div class="preview-thumb-play">
        <i class="ri-play-circle-fill"></i> Ver en vivo
      </div>
    `;
    previewBox.appendChild(thumb);

    // Click → abrir overlay
    previewBox.onclick = (e) => {
      e.stopPropagation();
      if (path) window.open(path, '_blank');
    };
  });
}

document.addEventListener('DOMContentLoaded', renderizarThumbnails);
if (document.readyState !== 'loading') renderizarThumbnails();

// ─── DRAWER GENÉRICO ───
async function abrirConfig(overlayKey, titulo) {
  const config = OVERLAY_CONFIGS[overlayKey];
  if (!config) { mostrarToast('Este overlay no tiene configuración'); return; }

  overlayActual = overlayKey;
  document.getElementById('drawerTitle').textContent = titulo;

  let actuales = {};
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/themes/${overlayKey}`);
    actuales = await r.json() || {};
  } catch (e) {}

  valoresActuales = { ...actuales };
  const body = document.getElementById('drawerBody');
  body.innerHTML = '';

  config.groups.forEach(group => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'cfg-group';
    const title = document.createElement('div');
    title.className = 'cfg-group-title';
    title.textContent = group.title;
    groupDiv.appendChild(title);

    group.vars.forEach(v => {
      const valor = actuales[v.key] || v.default;
      const hexOnly = valor.length === 7 ? valor : valor.substring(0, 7);
      const row = document.createElement('div');
      row.className = 'cfg-row';
      row.innerHTML = `
        <label>${v.label}</label>
        <input type="color" data-var="${v.key}" value="${hexOnly}">
        <input type="text" data-var-text="${v.key}" value="${hexOnly}" maxlength="7">
      `;
      groupDiv.appendChild(row);
    });
    body.appendChild(groupDiv);
  });

  const presetsDiv = document.createElement('div');
  presetsDiv.className = 'cfg-group';
  const presetTitle = document.createElement('div');
  presetTitle.className = 'cfg-group-title';
  presetTitle.textContent = 'Presets';
  presetsDiv.appendChild(presetTitle);

  const presetGrid = document.createElement('div');
  presetGrid.className = 'presets';

  Object.entries(config.presets).forEach(([name, vars]) => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    const swatch = document.createElement('span');
    swatch.className = 'preset-swatch';
    const colores = Object.values(vars).slice(0, 2);
    swatch.style.background = `linear-gradient(135deg, ${colores[0]}, ${colores[1]})`;
    btn.appendChild(swatch);
    btn.appendChild(document.createTextNode(name.charAt(0).toUpperCase() + name.slice(1)));
    btn.onclick = () => aplicarPresetLocal(name);
    presetGrid.appendChild(btn);
  });

  presetsDiv.appendChild(presetGrid);
  body.appendChild(presetsDiv);

  body.querySelectorAll('input[data-var]').forEach(input => {
    input.addEventListener('input', (e) => {
      const key = e.target.dataset.var;
      const val = e.target.value;
      valoresActuales[key] = val;
      const txt = body.querySelector(`input[data-var-text="${key}"]`);
      if (txt) txt.value = val;
    });
  });

  body.querySelectorAll('input[data-var-text]').forEach(input => {
    input.addEventListener('input', (e) => {
      const key = e.target.dataset.varText;
      let val = e.target.value.trim();
      if (!val.startsWith('#')) val = '#' + val;
      if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
      valoresActuales[key] = val;
      const col = body.querySelector(`input[data-var="${key}"]`);
      if (col) col.value = val;
    });
  });

  document.getElementById('drawerOverlay').classList.add('show');
  document.getElementById('drawer').classList.add('show');
}

function cerrarDrawer() {
  document.getElementById('drawerOverlay').classList.remove('show');
  document.getElementById('drawer').classList.remove('show');
  overlayActual = null;
  valoresActuales = {};
}

async function guardarConfig() {
  if (!overlayActual) return;
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/themes/${overlayActual}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valoresActuales)
    });
    const data = await r.json();
    if (data.success) { mostrarToast('Colores guardados'); cerrarDrawer(); }
    else mostrarToast('Error al guardar');
  } catch (e) { mostrarToast('Error de red'); }
}

async function resetearConfig() {
  if (!overlayActual) return;
  if (!confirm('¿Resetear los colores de este overlay?')) return;
  try {
    await fetch(`${window.SERVER_BASE}/api/themes/${overlayActual}`, { method: 'DELETE' });
    mostrarToast('Colores reseteados');
    cerrarDrawer();
  } catch (e) { mostrarToast('Error'); }
}

function aplicarPresetLocal(name) {
  if (!overlayActual) return;
  const config = OVERLAY_CONFIGS[overlayActual];
  const preset = config.presets[name];
  if (!preset) return;
  valoresActuales = { ...valoresActuales, ...preset };
  Object.entries(preset).forEach(([key, val]) => {
    const col = document.querySelector(`#drawerBody input[data-var="${key}"]`);
    const txt = document.querySelector(`#drawerBody input[data-var-text="${key}"]`);
    if (col) col.value = val;
    if (txt) txt.value = val;
  });
  mostrarToast(`Preset "${name}" aplicado`);
}

// ─── DRAWER CRISTAL ───
async function resetearCristal() {
  if (!confirm('¿Resetear la meta?\n\nSe borrarán TODOS los diamantes y el top donador.')) return;
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/jar-state/reset`, { method: 'POST' });
    const data = await r.json();
    if (data.success) mostrarToast('Meta reseteada');
    else mostrarToast('Error al resetear');
  } catch (e) { mostrarToast('Error de red'); }
}

// ─── PRIDE ───
let prideConfig = {
  mode: 'rotate',
  fixedId: 'pride',
  rotateMs: 6000,
  folder: 'HD 1080p',
  showName: true,
  showMeaning: true,
  showColors: true,
  soloBandera: false,
  enabled: null
};
let prideExplain = {};

const PRIDE_ORDEN = [
  'pride', 'progress-pride', 'intersex-progress-pride',
  'trans-pride', 'non-binary-pride', 'genderfluid-pride',
  'genderqueer-pride', 'agender-pride', 'bigender-pride',
  'demigender-pride', 'intersex-pride',
  'lesbian-pride', 'gay-mens-pride-trans-inclusive',
  'bisexual-pride', 'pansexual-pride', 'polysexual-pride',
  'asexual-pride', 'demisexual-pride',
  'philadelphia-pride', 'gilbert-baker-pride', 'queer-pride'
];

const PRIDE_FOLDERS = [
  { id: 'HD 1080p',           label: 'HD 1080p (recomendado)' },
  { id: '512px Icons',        label: '512px Icons' },
  { id: '32px Full Palette',  label: '32px Full Palette' },
  { id: '16px Full Palette',  label: '16px Full Palette' },
  { id: '16px Pico 8 Palette',label: '16px Pico 8 Palette' }
];

async function abrirConfigPride() {
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/pride/config`);
    const data = await r.json();
    if (data && data.ok && data.config) prideConfig = { ...prideConfig, ...data.config };
  } catch (e) {}

  try {
    const r = await fetch('/pride-explain.json');
    prideExplain = await r.json();
  } catch (e) {
    mostrarToast('No se pudo cargar pride-explain.json');
    return;
  }

  const body = document.getElementById('prideDrawerBody');
  body.innerHTML = '';

  const gMode = document.createElement('div');
  gMode.className = 'cfg-group';
  gMode.innerHTML = `<div class="cfg-group-title">Modo</div>`;
  const modes = [
    { v: 'rotate', l: 'Rotación automática',      d: 'Cambia de bandera cada X segundos' },
    { v: 'fixed',  l: 'Fija (una sola bandera)',  d: 'Muestra siempre la misma' },
    { v: 'chat',   l: 'Solo con !bandera (chat)', d: 'Aparece cuando alguien escribe !bandera' }
  ];
  modes.forEach(m => {
    const row = document.createElement('label');
    row.className = 'cfg-radio-row';
    row.innerHTML = `
      <input type="radio" name="prideMode" value="${m.v}" ${prideConfig.mode === m.v ? 'checked' : ''}>
      <div>
        <label>${m.l}</label>
        <small>${m.d}</small>
      </div>
    `;
    gMode.appendChild(row);
  });
  body.appendChild(gMode);

  const gSpeed = document.createElement('div');
  gSpeed.className = 'cfg-group';
  gSpeed.innerHTML = `<div class="cfg-group-title">Velocidad de rotación</div>`;
  const speedRow = document.createElement('div');
  speedRow.className = 'cfg-slider-row';
  speedRow.innerHTML = `
    <label>Segundos por bandera <span id="prideSpeedVal">${(prideConfig.rotateMs/1000).toFixed(0)}s</span></label>
    <input type="range" id="prideSpeed" min="2" max="20" step="1" value="${prideConfig.rotateMs/1000}">
  `;
  gSpeed.appendChild(speedRow);
  body.appendChild(gSpeed);

  const gFolder = document.createElement('div');
  gFolder.className = 'cfg-group';
  gFolder.innerHTML = `<div class="cfg-group-title">Calidad de imagen</div>`;
  const selFolder = document.createElement('select');
  selFolder.id = 'prideFolder';
  PRIDE_FOLDERS.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.label;
    if (prideConfig.folder === f.id) opt.selected = true;
    selFolder.appendChild(opt);
  });
  const folderRow = document.createElement('div');
  folderRow.className = 'cfg-input-row';
  folderRow.appendChild(selFolder);
  gFolder.appendChild(folderRow);
  body.appendChild(gFolder);

  const gOpts = document.createElement('div');
  gOpts.className = 'cfg-group';
  gOpts.innerHTML = `<div class="cfg-group-title">Opciones</div>`;
  const opts = [
    { k: 'showName',    l: 'Mostrar nombre' },
    { k: 'showMeaning', l: 'Mostrar significado' },
    { k: 'showColors',  l: 'Mostrar colores y su explicación' },
    { k: 'soloBandera', l: 'Solo bandera (ocultar todo el texto)' }
  ];
  opts.forEach(o => {
    const row = document.createElement('label');
    row.className = 'cfg-check-row';
    row.innerHTML = `
      <input type="checkbox" data-pride-opt="${o.k}" ${prideConfig[o.k] ? 'checked' : ''}>
      <label>${o.l}</label>
    `;
    gOpts.appendChild(row);
  });
  body.appendChild(gOpts);

  const gFlags = document.createElement('div');
  gFlags.className = 'cfg-group';
  gFlags.innerHTML = `<div class="cfg-group-title">Banderas a mostrar</div>`;

  const toolbar = document.createElement('div');
  toolbar.className = 'flags-actions';
  toolbar.innerHTML = `
    <button onclick="prideToggleAll(true)">Todas</button>
    <button onclick="prideToggleAll(false)">Ninguna</button>
  `;
  gFlags.appendChild(toolbar);

  const grid = document.createElement('div');
  grid.className = 'flags-grid';

  const enabledSet = prideConfig.enabled
    ? new Set(prideConfig.enabled)
    : new Set(PRIDE_ORDEN);

  PRIDE_ORDEN.forEach(id => {
    const item = prideExplain[id];
    if (!item) return;
    const row = document.createElement('label');
    row.className = 'flag-check';
    row.innerHTML = `
      <input type="checkbox" data-pride-flag="${id}" ${enabledSet.has(id) ? 'checked' : ''}>
      <span title="${item.name}">${item.name}</span>
    `;
    grid.appendChild(row);
  });
  gFlags.appendChild(grid);
  body.appendChild(gFlags);

  const gFixed = document.createElement('div');
  gFixed.className = 'cfg-group';
  gFixed.innerHTML = `<div class="cfg-group-title">Bandera fija (modo "Fija")</div>`;
  const selFixed = document.createElement('select');
  selFixed.id = 'prideFixed';
  PRIDE_ORDEN.forEach(id => {
    const item = prideExplain[id];
    if (!item) return;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = item.name;
    if (prideConfig.fixedId === id) opt.selected = true;
    selFixed.appendChild(opt);
  });
  const fixedRow = document.createElement('div');
  fixedRow.className = 'cfg-input-row';
  fixedRow.appendChild(selFixed);
  gFixed.appendChild(fixedRow);
  body.appendChild(gFixed);

  body.querySelectorAll('input[name="prideMode"]').forEach(r => {
    r.addEventListener('change', e => prideConfig.mode = e.target.value);
  });
  body.querySelector('#prideSpeed')?.addEventListener('input', e => {
    prideConfig.rotateMs = parseInt(e.target.value, 10) * 1000;
    document.getElementById('prideSpeedVal').textContent = e.target.value + 's';
  });
  body.querySelector('#prideFolder')?.addEventListener('change', e => prideConfig.folder = e.target.value);
  body.querySelector('#prideFixed')?.addEventListener('change', e => prideConfig.fixedId = e.target.value);
  body.querySelectorAll('input[data-pride-opt]').forEach(c => {
    c.addEventListener('change', e => prideConfig[e.target.dataset.prideOpt] = e.target.checked);
  });

  document.getElementById('prideDrawerOverlay').classList.add('show');
  document.getElementById('prideDrawer').classList.add('show');
}

function prideToggleAll(state) {
  document.querySelectorAll('#prideDrawerBody input[data-pride-flag]').forEach(c => c.checked = state);
}

function cerrarConfigPride() {
  document.getElementById('prideDrawerOverlay').classList.remove('show');
  document.getElementById('prideDrawer').classList.remove('show');
}

async function guardarConfigPride() {
  const enabled = [];
  document.querySelectorAll('#prideDrawerBody input[data-pride-flag]').forEach(c => {
    if (c.checked) enabled.push(c.dataset.prideFlag);
  });
  prideConfig.enabled = enabled.length > 0 ? enabled : null;

  try {
    const r = await fetch(`${window.SERVER_BASE}/api/pride/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prideConfig)
    });
    const data = await r.json();
    if (data.ok) {
      mostrarToast('Configuración Pride guardada');
      cerrarConfigPride();
    } else {
      mostrarToast('Error al guardar');
    }
  } catch (e) {
    mostrarToast('Error de red');
  }
}

async function resetearConfigPride() {
  if (!confirm('¿Resetear la configuración de banderas Pride?')) return;
  try {
    await fetch(`${window.SERVER_BASE}/api/pride/config`, { method: 'DELETE' });
    mostrarToast('Configuración reseteada');
    if (document.getElementById('prideDrawer').classList.contains('show')) {
      cerrarConfigPride();
    }
  } catch (e) {
    mostrarToast('Error');
  }
}

// ─── HYPE TRAIN ───
let hypeConfig = {
  theme: 'cyberpunk',
  duration: 300,
  base: 100,
  factor: 1.4,
  themeChangeEvery: 5,
  milestones: [5, 10, 15, 20, 30, 50],
  titles: [
    { min: 1,  name: 'Pasajero' },
    { min: 5,  name: 'Maquinista' },
    { min: 10, name: 'Capitán' },
    { min: 15, name: 'Comandante' },
    { min: 20, name: 'Leyenda' }
  ],
  sounds: { enabled: true, volume: 0.4, activation: true, gift: true, levelUp: true, milestone: true, sprint: true, end: true, saved: true },
  display: { showTop3: true, showUniqueGifters: true, showRate: true, showTitles: true },
  timerRules: { resetOnLevelUp: true, bonusOnMilestone: 60, maxBonus: 300, savedThreshold: 15, showBonusText: true },
  activation: { giftsRequired: 3, windowMs: 300000, enabled: true }
};

const HYPE_THEMES = [
  { id: 'cyberpunk', name: 'Cyberpunk', desc: 'Magenta / cyan · líneas de escaneo', icon: '⚡' },
  { id: 'cristal',   name: 'Cristal',   desc: 'Púrpura / rosa · blur y glow suave', icon: '💎' },
  { id: 'minimal',   name: 'Minimal',   desc: 'Blanco / negro · limpio sin decoración', icon: '⬜' },
  { id: 'tiktok',    name: 'TikTok',    desc: 'Rosa / cyan · redondeado y vivo',    icon: '🎵' }
];

async function abrirConfigHype() {
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/hype-train/config`);
    const data = await r.json();
    if (data && data.ok && data.config) hypeConfig = { ...hypeConfig, ...data.config };
  } catch (e) {}

  const body = document.getElementById('hypeDrawerBody');
  body.innerHTML = '';

  const gTheme = document.createElement('div');
  gTheme.className = 'cfg-group';
  gTheme.innerHTML = `<div class="cfg-group-title">🎨 Diseño del tren</div>`;

  const themeGrid = document.createElement('div');
  themeGrid.className = 'theme-grid';

  HYPE_THEMES.forEach(t => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-option' + (hypeConfig.theme === t.id ? ' active' : '');
    btn.dataset.theme = t.id;
    btn.innerHTML = `
      <div class="theme-preview ${t.id}"><span>${t.icon}</span></div>
      <span class="theme-name">${t.name}</span>
      <span class="theme-desc">${t.desc}</span>
    `;
    btn.onclick = () => {
      hypeConfig.theme = t.id;
      document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
      btn.classList.add('active');
    };
    themeGrid.appendChild(btn);
  });
  gTheme.appendChild(themeGrid);
  body.appendChild(gTheme);

  const gCurve = document.createElement('div');
  gCurve.className = 'cfg-group';
  gCurve.innerHTML = `<div class="cfg-group-title">📈 Curva de niveles</div>`;

  const curveRow = document.createElement('div');
  curveRow.className = 'cfg-input-row';
  curveRow.innerHTML = `
    <label>Duración del timer (segundos)</label>
    <div><input type="number" id="hypeDuration" min="30" max="3600" step="30" value="${hypeConfig.duration}"></div>
  `;
  gCurve.appendChild(curveRow);

  const baseRow = document.createElement('div');
  baseRow.className = 'cfg-input-row';
  baseRow.innerHTML = `
    <label>Puntos base para nivel 1</label>
    <div><input type="number" id="hypeBase" min="1" step="10" value="${hypeConfig.base}"></div>
  `;
  gCurve.appendChild(baseRow);

  const factorRow = document.createElement('div');
  factorRow.className = 'cfg-input-row';
  factorRow.innerHTML = `
    <label>Factor de crecimiento (1.4 = +40% por nivel)</label>
    <div><input type="number" id="hypeFactor" min="1.01" max="5" step="0.05" value="${hypeConfig.factor}"></div>
  `;
  gCurve.appendChild(factorRow);

  const themeEveryRow = document.createElement('div');
  themeEveryRow.className = 'cfg-input-row';
  themeEveryRow.innerHTML = `
    <label>Cambiar tema cada N niveles</label>
    <div><input type="number" id="hypeThemeEvery" min="1" max="20" step="1" value="${hypeConfig.themeChangeEvery}"></div>
  `;
  gCurve.appendChild(themeEveryRow);

  body.appendChild(gCurve);

  const gMile = document.createElement('div');
  gMile.className = 'cfg-group';
  gMile.innerHTML = `<div class="cfg-group-title">🎯 Hitos (niveles con bonus y fanfarria)</div>`;

  const chips = document.createElement('div');
  chips.className = 'milestone-chips';
  chips.id = 'hypeMilestoneChips';
  (hypeConfig.milestones || []).forEach(m => {
    const chip = document.createElement('span');
    chip.className = 'milestone-chip';
    chip.textContent = m;
    chips.appendChild(chip);
  });
  gMile.appendChild(chips);

  const mileRow = document.createElement('div');
  mileRow.className = 'cfg-input-row';
  mileRow.innerHTML = `
    <label>Niveles separados por coma</label>
    <div><input type="text" id="hypeMilestones" value="${(hypeConfig.milestones || []).join(', ')}" placeholder="5, 10, 15, 20, 30, 50"></div>
  `;
  gMile.appendChild(mileRow);
  body.appendChild(gMile);

  const gTimer = document.createElement('div');
  gTimer.className = 'cfg-group';
  gTimer.innerHTML = `<div class="cfg-group-title">⏱️ Reglas de timer</div>`;

  const resetRow = document.createElement('label');
  resetRow.className = 'cfg-check-row';
  resetRow.innerHTML = `
    <input type="checkbox" id="hypeResetOnLevelUp" ${hypeConfig.timerRules?.resetOnLevelUp !== false ? 'checked' : ''}>
    <label>Resetear el timer al subir de nivel</label>
  `;
  gTimer.appendChild(resetRow);

  const bonusRow = document.createElement('div');
  bonusRow.className = 'cfg-input-row';
  bonusRow.innerHTML = `
    <label>Bonus de tiempo en hito (segundos)</label>
    <div><input type="number" id="hypeBonus" min="0" max="600" step="10" value="${hypeConfig.timerRules?.bonusOnMilestone ?? 60}"></div>
  `;
  gTimer.appendChild(bonusRow);

  const capRow = document.createElement('div');
  capRow.className = 'cfg-input-row';
  capRow.innerHTML = `
    <label>Cap máximo de bonus (segundos)</label>
    <div><input type="number" id="hypeMaxBonus" min="0" max="3600" step="30" value="${hypeConfig.timerRules?.maxBonus ?? 300}"></div>
  `;
  gTimer.appendChild(capRow);

  const savedRow = document.createElement('div');
  savedRow.className = 'cfg-input-row';
  savedRow.innerHTML = `
    <label>Umbral "¡SALVADO!" (segundos restantes)</label>
    <div><input type="number" id="hypeSavedThreshold" min="1" max="120" step="1" value="${hypeConfig.timerRules?.savedThreshold ?? 15}"></div>
  `;
  gTimer.appendChild(savedRow);
  body.appendChild(gTimer);

  const gAct = document.createElement('div');
  gAct.className = 'cfg-group';
  gAct.innerHTML = `<div class="cfg-group-title">🔥 Activación automática</div>`;

  const actEnableRow = document.createElement('label');
  actEnableRow.className = 'cfg-check-row';
  actEnableRow.innerHTML = `
    <input type="checkbox" id="hypeActEnabled" ${hypeConfig.activation?.enabled !== false ? 'checked' : ''}>
    <label>Activar el tren automáticamente con regalos</label>
  `;
  gAct.appendChild(actEnableRow);

  const actGiftsRow = document.createElement('div');
  actGiftsRow.className = 'cfg-input-row';
  actGiftsRow.innerHTML = `
    <label>Regalos necesarios para arrancar</label>
    <div><input type="number" id="hypeActGifts" min="1" max="50" step="1" value="${hypeConfig.activation?.giftsRequired ?? 3}"></div>
  `;
  gAct.appendChild(actGiftsRow);

  const actWindowRow = document.createElement('div');
  actWindowRow.className = 'cfg-input-row';
  actWindowRow.innerHTML = `
    <label>Ventana de tiempo (minutos)</label>
    <div><input type="number" id="hypeActWindow" min="1" max="60" step="1" value="${Math.round((hypeConfig.activation?.windowMs ?? 300000) / 60000)}"></div>
  `;
  gAct.appendChild(actWindowRow);
  body.appendChild(gAct);

  const gSound = document.createElement('div');
  gSound.className = 'cfg-group';
  gSound.innerHTML = `<div class="cfg-group-title">🔊 Sonidos</div>`;

  const sndEnableRow = document.createElement('label');
  sndEnableRow.className = 'cfg-check-row';
  sndEnableRow.innerHTML = `
    <input type="checkbox" id="hypeSndEnabled" ${hypeConfig.sounds?.enabled !== false ? 'checked' : ''}>
    <label>Sonidos activados</label>
  `;
  gSound.appendChild(sndEnableRow);

  const volRow = document.createElement('div');
  volRow.className = 'cfg-slider-row';
  volRow.innerHTML = `
    <label>Volumen <span id="hypeVolVal">${Math.round((hypeConfig.sounds?.volume ?? 0.4) * 100)}%</span></label>
    <input type="range" id="hypeSndVolume" min="0" max="1" step="0.05" value="${hypeConfig.sounds?.volume ?? 0.4}">
  `;
  gSound.appendChild(volRow);
  body.appendChild(gSound);

  const gDisp = document.createElement('div');
  gDisp.className = 'cfg-group';
  gDisp.innerHTML = `<div class="cfg-group-title">👁️ Mostrar en overlay</div>`;

  const dispOpts = [
    { k: 'showTop3',          l: 'Top 3 gifters' },
    { k: 'showUniqueGifters', l: 'Gifters únicos' },
    { k: 'showRate',          l: 'Ritmo (pts/min)' },
    { k: 'showTitles',        l: 'Títulos por rango' }
  ];
  dispOpts.forEach(o => {
    const row = document.createElement('label');
    row.className = 'cfg-check-row';
    row.innerHTML = `
      <input type="checkbox" data-hype-disp="${o.k}" ${hypeConfig.display?.[o.k] !== false ? 'checked' : ''}>
      <label>${o.l}</label>
    `;
    gDisp.appendChild(row);
  });
  body.appendChild(gDisp);

  const gLive = document.createElement('div');
  gLive.className = 'cfg-group';
  gLive.innerHTML = `<div class="cfg-group-title">⚡ Acciones en vivo</div>`;
  const liveRow = document.createElement('div');
  liveRow.className = 'hype-actions';
  liveRow.innerHTML = `
    <button type="button" class="start" onclick="hypeStart()"><i class="ri-play-fill"></i> Arrancar</button>
    <button type="button" class="end" onclick="hypeEnd()"><i class="ri-stop-fill"></i> Terminar</button>
    <button type="button" class="reset" onclick="hypeReset()"><i class="ri-refresh-line"></i> Reset</button>
  `;
  gLive.appendChild(liveRow);
  body.appendChild(gLive);

  document.getElementById('hypeDrawerOverlay').classList.add('show');
  document.getElementById('hypeDrawer').classList.add('show');
}

function cerrarConfigHype() {
  document.getElementById('hypeDrawerOverlay').classList.remove('show');
  document.getElementById('hypeDrawer').classList.remove('show');
}

async function guardarConfigHype() {
  const duration = parseInt(document.getElementById('hypeDuration').value, 10);
  const base = parseInt(document.getElementById('hypeBase').value, 10);
  const factor = parseFloat(document.getElementById('hypeFactor').value);
  const themeEvery = parseInt(document.getElementById('hypeThemeEvery').value, 10);
  const milestonesRaw = document.getElementById('hypeMilestones').value;
  const milestones = milestonesRaw
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n) && n > 0);

  const resetOnLevelUp = document.getElementById('hypeResetOnLevelUp').checked;
  const bonus = parseInt(document.getElementById('hypeBonus').value, 10);
  const maxBonus = parseInt(document.getElementById('hypeMaxBonus').value, 10);
  const savedThreshold = parseInt(document.getElementById('hypeSavedThreshold').value, 10);

  const actEnabled = document.getElementById('hypeActEnabled').checked;
  const actGifts = parseInt(document.getElementById('hypeActGifts').value, 10);
  const actWindowMin = parseInt(document.getElementById('hypeActWindow').value, 10);

  const sndEnabled = document.getElementById('hypeSndEnabled').checked;
  const sndVolume = parseFloat(document.getElementById('hypeSndVolume').value);

  const display = { ...hypeConfig.display };
  document.querySelectorAll('#hypeDrawerBody input[data-hype-disp]').forEach(c => {
    display[c.dataset.hypeDisp] = c.checked;
  });

  const payload = {
    ...hypeConfig,
    theme: hypeConfig.theme,
    duration: isNaN(duration) ? 300 : duration,
    base: isNaN(base) ? 100 : base,
    factor: isNaN(factor) ? 1.4 : factor,
    themeChangeEvery: isNaN(themeEvery) ? 5 : themeEvery,
    milestones: milestones.length ? milestones : [5, 10, 15, 20, 30, 50],
    timerRules: {
      ...hypeConfig.timerRules,
      resetOnLevelUp,
      bonusOnMilestone: isNaN(bonus) ? 60 : bonus,
      maxBonus: isNaN(maxBonus) ? 300 : maxBonus,
      savedThreshold: isNaN(savedThreshold) ? 15 : savedThreshold
    },
    activation: {
      ...hypeConfig.activation,
      enabled: actEnabled,
      giftsRequired: isNaN(actGifts) ? 3 : actGifts,
      windowMs: (isNaN(actWindowMin) ? 5 : actWindowMin) * 60000
    },
    sounds: { ...hypeConfig.sounds, enabled: sndEnabled, volume: isNaN(sndVolume) ? 0.4 : sndVolume },
    display
  };

  try {
    const r = await fetch(`${window.SERVER_BASE}/api/hype-train/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (data.ok) {
      hypeConfig = { ...hypeConfig, ...data.config };
      mostrarToast('Hype Train guardado');
      cerrarConfigHype();
    } else {
      mostrarToast('Error al guardar');
    }
  } catch (e) {
    mostrarToast('Error de red');
  }
}

async function resetHypeConfig() {
  if (!confirm('¿Resetear la configuración del Hype Train a valores por defecto?')) return;
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/hype-train/config`, { method: 'DELETE' });
    const data = await r.json();
    if (data.ok) {
      hypeConfig = { ...data.config };
      mostrarToast('Configuración reseteada');
      cerrarConfigHype();
    }
  } catch (e) { mostrarToast('Error'); }
}

async function hypeStart() {
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/hype-train/start`, { method: 'POST' });
    const data = await r.json();
    if (data.ok) mostrarToast('🚂 Tren arrancado');
    else mostrarToast('Error al arrancar');
  } catch (e) { mostrarToast('Error'); }
}

async function hypeEnd() {
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/hype-train/end`, { method: 'POST' });
    const data = await r.json();
    if (data.ok) mostrarToast('🏁 Tren terminado');
    else mostrarToast('Error al terminar');
  } catch (e) { mostrarToast('Error'); }
}

async function hypeReset() {
  if (!confirm('¿Resetear el estado del tren? Se perderán puntos y nivel.')) return;
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/hype-train/reset`, { method: 'POST' });
    const data = await r.json();
    if (data.ok) mostrarToast('🔄 Tren reseteado');
  } catch (e) { mostrarToast('Error'); }
}

function resetHypeTrain() { hypeReset(); }

let hypeStatePollTimer = null;

async function actualizarHypeEstado() {
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/hype-train/state`);
    const data = await r.json();
    if (!data.ok || !data.state) return;
    const s = data.state;

    const estadoEl = document.getElementById('hypeLiveEstado');
    const nivelEl = document.getElementById('hypeLiveNivel');
    const puntosEl = document.getElementById('hypeLivePuntos');
    const card = document.getElementById('hypeCard');

    if (!estadoEl || !nivelEl || !puntosEl) return;

    if (s.active) {
      estadoEl.textContent = s.timeLeft ? `🔴 ${formatearTiempo(s.timeLeft)}` : '🔴 Activo';
      estadoEl.style.color = 'var(--accent)';
      card?.classList.add('live');
    } else {
      estadoEl.textContent = 'Inactivo';
      estadoEl.style.color = '';
      card?.classList.remove('live');
    }
    nivelEl.textContent = s.level || 0;
    puntosEl.textContent = (s.points || 0).toLocaleString('es-ES');
    actualizarHero();
  } catch (e) {}
}

function formatearTiempo(seg) {
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', () => {
  actualizarHypeEstado();
  hypeStatePollTimer = setInterval(actualizarHypeEstado, 3000);
});

function probar(url) { window.open(url, '_blank'); }

let toastTimer = null;
function mostrarToast(texto) {
  const toast = document.getElementById('toast');
  const text = document.getElementById('toastText');
  if (!toast || !text) return;
  text.textContent = texto;
  const isError = /error/i.test(texto);
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

// ═══════════════════════════════════════════════════════════════
//  STREAM TIMER — Configuración
// ═══════════════════════════════════════════════════════════════

const TIMER_PRESETS = [
  { name: 'Ámbar',   hex: '#e8825a' },
  { name: 'Rosa',    hex: '#ff5cc8' },
  { name: 'Celeste', hex: '#5cc8ff' },
  { name: 'Verde',   hex: '#5cffb0' },
  { name: 'Morado',  hex: '#b45cff' },
  { name: 'Rojo',    hex: '#ff5c5c' },
  { name: 'Blanco',  hex: '#ffffff' }
];

let timerConfig = {
  modo: 'duracion',
  duracionMin: 240,
  horaObjetivo: '22:00',
  color: '#e8825a'
};

async function abrirConfigTimer() {
  try {
    const r = await fetch(`${window.SERVER_BASE}/get-config`);
    const cfg = await r.json();
    timerConfig.modo          = cfg.TIMER_MODO          || 'duracion';
    timerConfig.duracionMin   = cfg.TIMER_DURACION_MIN  || 240;
    timerConfig.horaObjetivo  = cfg.TIMER_HORA_OBJETIVO || '22:00';
    timerConfig.color         = cfg.TIMER_COLOR         || '#e8825a';
  } catch (e) {
    mostrarToast('No pude leer la config');
  }

  const body = document.getElementById('timerDrawerBody');
  body.innerHTML = '';

  const gModo = document.createElement('div');
  gModo.className = 'cfg-group';
  gModo.innerHTML = `<div class="cfg-group-title">Modo</div>`;
  const modes = [
    { v: 'duracion', l: 'Por duración',  d: 'Ej: 4 horas desde que arranca' },
    { v: 'hora',     l: 'Hora exacta',   d: 'Ej: hasta las 22:00' }
  ];
  modes.forEach(m => {
    const row = document.createElement('label');
    row.className = 'cfg-radio-row';
    row.innerHTML = `
      <input type="radio" name="timerModo" value="${m.v}" ${timerConfig.modo === m.v ? 'checked' : ''}>
      <div>
        <label>${m.l}</label>
        <small>${m.d}</small>
      </div>
    `;
    gModo.appendChild(row);
  });
  body.appendChild(gModo);

  const gDur = document.createElement('div');
  gDur.className = 'cfg-group';
  gDur.id = 'timerGrupoDuracion';
  gDur.style.display = timerConfig.modo === 'duracion' ? '' : 'none';
  gDur.innerHTML = `
    <div class="cfg-group-title">Duración</div>
    <div class="cfg-input-row">
      <label>Minutos de stream</label>
      <div><input type="number" id="timerDuracionMin" min="5" max="1440" step="5" value="${timerConfig.duracionMin}"></div>
    </div>
    <div class="cfg-slider-row">
      <label>Atajos</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="preset-btn" data-dur="60">1h</button>
        <button class="preset-btn" data-dur="120">2h</button>
        <button class="preset-btn" data-dur="180">3h</button>
        <button class="preset-btn" data-dur="240">4h</button>
        <button class="preset-btn" data-dur="360">6h</button>
      </div>
    </div>
  `;
  body.appendChild(gDur);

  const gHora = document.createElement('div');
  gHora.className = 'cfg-group';
  gHora.id = 'timerGrupoHora';
  gHora.style.display = timerConfig.modo === 'hora' ? '' : 'none';
  gHora.innerHTML = `
    <div class="cfg-group-title">Hora objetivo</div>
    <div class="cfg-input-row">
      <label>Formato 24h (HH:MM)</label>
      <div><input type="text" id="timerHoraObjetivo" maxlength="5" placeholder="22:00" value="${timerConfig.horaObjetivo}"></div>
    </div>
  `;
  body.appendChild(gHora);

  const gColor = document.createElement('div');
  gColor.className = 'cfg-group';
  gColor.innerHTML = `<div class="cfg-group-title">Color</div>`;
  const grid = document.createElement('div');
  grid.className = 'presets';
  TIMER_PRESETS.forEach(p => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-btn';
    btn.dataset.color = p.hex;
    btn.innerHTML = `<span class="preset-swatch" style="background:${p.hex}"></span>${p.name}`;
    btn.onclick = () => {
      timerConfig.color = p.hex;
      const colorInput = document.getElementById('timerColorPicker');
      const colorText  = document.getElementById('timerColorText');
      if (colorInput) colorInput.value = p.hex;
      if (colorText)  colorText.value  = p.hex;
      document.querySelectorAll('#timerDrawerBody .preset-btn[data-color]').forEach(b => {
        b.classList.toggle('active', b.dataset.color === p.hex);
      });
    };
    grid.appendChild(btn);
  });
  gColor.appendChild(grid);

  const colorRow = document.createElement('div');
  colorRow.className = 'cfg-row';
  colorRow.innerHTML = `
    <label>Personalizado</label>
    <input type="color" id="timerColorPicker" value="${timerConfig.color}">
    <input type="text" id="timerColorText" maxlength="7" value="${timerConfig.color}">
  `;
  gColor.appendChild(colorRow);
  body.appendChild(gColor);

  body.querySelectorAll('input[name="timerModo"]').forEach(r => {
    r.addEventListener('change', e => {
      timerConfig.modo = e.target.value;
      document.getElementById('timerGrupoDuracion').style.display = timerConfig.modo === 'duracion' ? '' : 'none';
      document.getElementById('timerGrupoHora').style.display     = timerConfig.modo === 'hora'     ? '' : 'none';
    });
  });

  body.querySelectorAll('.preset-btn[data-dur]').forEach(b => {
    b.addEventListener('click', () => {
      const inp = document.getElementById('timerDuracionMin');
      if (inp) inp.value = b.dataset.dur;
    });
  });

  const colorPicker = body.querySelector('#timerColorPicker');
  const colorText   = body.querySelector('#timerColorText');
  colorPicker.addEventListener('input', e => {
    timerConfig.color = e.target.value;
    colorText.value   = e.target.value;
    document.querySelectorAll('#timerDrawerBody .preset-btn[data-color]').forEach(b => {
      b.classList.toggle('active', b.dataset.color === e.target.value);
    });
  });
  colorText.addEventListener('input', e => {
    let val = e.target.value.trim();
    if (!val.startsWith('#')) val = '#' + val;
    if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
    timerConfig.color   = val;
    colorPicker.value   = val;
  });

  document.querySelectorAll('#timerDrawerBody .preset-btn[data-color]').forEach(b => {
    b.classList.toggle('active', b.dataset.color === timerConfig.color);
  });

  document.getElementById('timerDrawerOverlay').classList.add('show');
  document.getElementById('timerDrawer').classList.add('show');
}

function cerrarConfigTimer() {
  document.getElementById('timerDrawerOverlay').classList.remove('show');
  document.getElementById('timerDrawer').classList.remove('show');
}

async function guardarConfigTimer() {
  const duracionMin   = parseInt(document.getElementById('timerDuracionMin')?.value || '240', 10);
  const horaObjetivo  = (document.getElementById('timerHoraObjetivo')?.value || '22:00').trim();

  if (timerConfig.modo === 'hora' && !/^\d{1,2}:\d{2}$/.test(horaObjetivo)) {
    mostrarToast('Hora inválida. Usar HH:MM');
    return;
  }

  try {
    const configActual = await (await fetch(`${window.SERVER_BASE}/get-config`)).json();

    const r1 = await fetch(`${window.SERVER_BASE}/save-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...configActual,
        TIMER_MODO: timerConfig.modo,
        TIMER_DURACION_MIN: duracionMin,
        TIMER_HORA_OBJETIVO: horaObjetivo,
        TIMER_COLOR: timerConfig.color
      })
    });
    const d1 = await r1.json();
    if (!d1.success) { mostrarToast('Error guardando config'); return; }

    mostrarToast('Config guardada. El timer arranca con el próximo live.');
    cerrarConfigTimer();
  } catch (e) {
    mostrarToast('Error de red');
  }
}

async function arrancarTimerAhora() {
  const duracionMin   = parseInt(document.getElementById('timerDuracionMin')?.value || '240', 10);
  const horaObjetivo  = (document.getElementById('timerHoraObjetivo')?.value || '22:00').trim();

  if (timerConfig.modo === 'hora' && !/^\d{1,2}:\d{2}$/.test(horaObjetivo)) {
    mostrarToast('Hora inválida. Usar HH:MM');
    return;
  }

  try {
    const r = await fetch(`${window.SERVER_BASE}/api/timer-state/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modoConfig: timerConfig.modo,
        duracionMin,
        horaObjetivo
      })
    });
    const d = await r.json();
    if (!d.ok) { mostrarToast('Error arrancando timer'); return; }
    mostrarToast('Timer arrancado manualmente');
    cerrarConfigTimer();
  } catch (e) {
    mostrarToast('Error de red');
  }
}

async function resetearConfigTimer() {
  if (!confirm('¿Reiniciar el timer? Se borra el tiempo sumado por el chat.')) return;
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/timer-state/reset`, { method: 'POST' });
    const d = await r.json();
    if (d.success) {
      mostrarToast('Timer reiniciado');
      cerrarConfigTimer();
    } else {
      mostrarToast('Error al reiniciar');
    }
  } catch (e) {
    mostrarToast('Error de red');
  }
}

// ─── ATAJOS DE TECLADO ───
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    cerrarDrawer();
    cerrarConfigPride();
    cerrarConfigHype();
    cerrarConfigTimer();
    const si = document.getElementById('searchInput');
    if (si && document.activeElement === si) { si.value = ''; buscar(''); si.blur(); }
  }
  if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
    e.preventDefault();
    document.getElementById('searchInput')?.focus();
  }
});

// ═══════════════════════════════════════════════════════════════
//  OVERLAY CHAT PERSONALIZADO (StreamElements)
// ═══════════════════════════════════════════════════════════════

async function cargarInfoCustomOverlay() {
  const badge = document.getElementById('customOverlayStatus');
  if (!badge) return;
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/custom-overlay/info`);
    const data = await r.json();
    if (data.exists) {
      const fecha = data.date ? new Date(data.date).toLocaleDateString('es-ES') : '';
      badge.textContent = 'activo' + (fecha ? ' · ' + fecha : '');
    } else {
      badge.textContent = 'sin widget';
    }
  } catch (e) {}
}

function recargarPreviewCustomOverlay() {
  // Ya no hay iframes de preview. No-op.
}

async function subirCustomOverlay(file) {
  if (!file) return;
  if (!/\.zip$/i.test(file.name)) { mostrarToast('El archivo debe ser .zip'); return; }
  try {
    mostrarToast('Subiendo...');
    const r = await fetch(`${window.SERVER_BASE}/api/custom-overlay/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: file
    });
    const data = await r.json();
    if (data.ok) {
      mostrarToast(`Widget subido (${data.written.length} archivos)`);
      await cargarInfoCustomOverlay();
    } else {
      mostrarToast('Error: ' + (data.error || 'desconocido'));
    }
  } catch (e) {
    mostrarToast('Error de red al subir');
  }
}

async function borrarCustomOverlay() {
  if (!confirm('¿Eliminar el overlay personalizado actual?')) return;
  try {
    const r = await fetch(`${window.SERVER_BASE}/api/custom-overlay`, { method: 'DELETE' });
    const data = await r.json();
    if (data.ok) {
      mostrarToast('Overlay eliminado');
      await cargarInfoCustomOverlay();
    }
  } catch (e) { mostrarToast('Error al eliminar'); }
}

document.addEventListener('DOMContentLoaded', cargarInfoCustomOverlay);