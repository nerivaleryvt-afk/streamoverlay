// extras/deck.js — StreamDeck web para TogiPanel
const fs = require('fs');
const path = require('path');
const os = require('os');

const DECK_FILE = path.join(__dirname, 'deck.json');

let deckConfig = {
  token: '',
  theme: 'cristal',
  enabled: true,
  obs: { host: '127.0.0.1', port: 4455, password: '' },
  categories: [],
  buttons: [],
  widgets: [],
  userPrefs: null
};

let _io = null;
let _app = null;
let obsWs = null;

/* ════════════════════════════════════════════════════════════
   DETECTAR IP LAN REAL
   ════════════════════════════════════════════════════════════ */
function getLanIP() {
  try {
    const nets = os.networkInterfaces();
    const candidates = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family !== 'IPv4' || net.internal) continue;
        candidates.push({ name, address: net.address });
      }
    }
    const pref = candidates.find(c => c.address.startsWith('192.168.'))
              || candidates.find(c => c.address.startsWith('10.'))
              || candidates.find(c => /^172\.(1[6-9]|2\d|3[01])\./.test(c.address))
              || candidates[0];
    return pref ? pref.address : '127.0.0.1';
  } catch (e) {
    return '127.0.0.1';
  }
}

/* ════════════════════════════════════════════════════════════
   PERSISTENCIA
   ════════════════════════════════════════════════════════════ */
function loadDeck() {
  try {
    if (fs.existsSync(DECK_FILE)) {
      const raw = fs.readFileSync(DECK_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      deckConfig = { ...deckConfig, ...parsed };
    }
    if (!deckConfig.token) {
      deckConfig.token = 'deck-' + Math.random().toString(36).slice(2, 10);
    }
    if (typeof deckConfig.enabled !== 'boolean') deckConfig.enabled = true;
    if (!Array.isArray(deckConfig.categories)) deckConfig.categories = [];
    if (!Array.isArray(deckConfig.buttons))    deckConfig.buttons = [];
    if (!Array.isArray(deckConfig.widgets))    deckConfig.widgets = [];
    if (typeof deckConfig.userPrefs !== 'object' || deckConfig.userPrefs === null) {
      deckConfig.userPrefs = null;
    }
    saveDeck();
  } catch (e) {
    console.error('[deck] Error cargando deck.json:', e.message);
  }
}

function saveDeck() {
  try {
    fs.writeFileSync(DECK_FILE, JSON.stringify(deckConfig, null, 2));
  } catch (e) {
    console.error('[deck] Error guardando deck.json:', e.message);
  }
}

/* ════════════════════════════════════════════════════════════
   OBS WEBSOCKET
   ════════════════════════════════════════════════════════════ */
let obsRetryDelay = 8000;
async function connectObs() {
  if (deckConfig.enabled === false) return;
  try {
    const mod = require('obs-websocket-js');
    const OBSWebSocket = mod.default || mod;
    obsWs = new OBSWebSocket();
    await obsWs.connect(
      `ws://${deckConfig.obs.host}:${deckConfig.obs.port}`,
      deckConfig.obs.password || undefined
    );
    console.log('[deck] OBS conectado a', deckConfig.obs.host + ':' + deckConfig.obs.port);
    if (_io) _io.emit('deck:obs-status', { connected: true });
    obsRetryDelay = 8000;
    obsWs.on('ConnectionClosed', () => {
      console.warn('[deck] OBS desconectado, reintentando en ' + obsRetryDelay + 'ms');
      obsWs = null;
      if (_io) _io.emit('deck:obs-status', { connected: false });
      if (deckConfig.enabled) {
        setTimeout(connectObs, obsRetryDelay);
        obsRetryDelay = Math.min(obsRetryDelay * 2, 60000);
      }
    });
  } catch (e) {
    console.warn('[deck] No se pudo conectar a OBS:', e.message);
    obsWs = null;
    if (_io) _io.emit('deck:obs-status', { connected: false });
    if (deckConfig.enabled) {
      setTimeout(connectObs, obsRetryDelay);
      obsRetryDelay = Math.min(obsRetryDelay * 2, 60000);
    }
  }
}

/* ════════════════════════════════════════════════════════════
   AITUM VERTICAL CANVAS — Vendor requests
   vendorName: "aitum-vertical-canvas"
   ════════════════════════════════════════════════════════════ */
const AITUM_VENDOR = 'aitum-vertical-canvas';

async function callAitum(requestType, requestData = {}) {
  if (!obsWs) throw new Error('OBS no conectado');
  const res = await obsWs.call('CallVendorRequest', {
    vendorName: AITUM_VENDOR,
    requestType,
    requestData
  });
  const data = res && res.responseData ? res.responseData : res;
  if (data && data.success === false) {
    throw new Error(data.error || ('Aitum: ' + requestType + ' falló'));
  }
  return data;
}

/* ── Escenas verticales ── */
async function aitumGetScenes() {
  const data = await callAitum('get_scenes', {});
  return (data && data.scenes) || [];
}

async function aitumGetCurrentScene() {
  const data = await callAitum('current_scene', {});
  return (data && data.scene) || null;
}

async function aitumSwitchScene(sceneName) {
  return callAitum('switch_scene', { scene: sceneName });
}

/* ── Estado de los outputs ── */
async function aitumGetStatus() {
  const data = await callAitum('status', {});
  return {
    streaming: !!(data && data.streaming),
    recording: !!(data && data.recording),
    backtrack: !!(data && data.backtrack),
    virtual_camera: !!(data && data.virtual_camera)
  };
}

/* ── Streaming ── */
async function aitumStartStreaming()  { return callAitum('start_streaming'); }
async function aitumStopStreaming()   { return callAitum('stop_streaming'); }
async function aitumToggleStreaming() { return callAitum('toggle_streaming'); }

/* ── Grabación ── */
async function aitumStartRecording()   { return callAitum('start_recording'); }
async function aitumStopRecording()    { return callAitum('stop_recording'); }
async function aitumToggleRecording()  { return callAitum('toggle_recording'); }
async function aitumPauseRecording()   { return callAitum('pause_recording'); }
async function aitumUnpauseRecording() { return callAitum('unpause_recording'); }
async function aitumAddChapter(name)   { return callAitum('add_chapter', { chapter_name: name || '' }); }

/* ── Backtrack / Replay buffer ── */
async function aitumStartBacktrack()  { return callAitum('start_backtrack'); }
async function aitumStopBacktrack()   { return callAitum('stop_backtrack'); }
async function aitumSaveBacktrack(filename) {
  return callAitum('save_backtrack', filename ? { filename } : {});
}

/* ── Cámara virtual ── */
async function aitumStartVirtualCam() { return callAitum('start_virtual_camera'); }
async function aitumStopVirtualCam()  { return callAitum('stop_virtual_camera'); }

/* ── Actualizar stream key/server ── */
async function aitumUpdateStreamKey(key, index) {
  return callAitum('update_stream_key', { stream_key: key, index: index || 0 });
}
async function aitumUpdateStreamServer(server, index) {
  return callAitum('update_stream_server', { stream_server: server, index: index || 0 });
}

/* ════════════════════════════════════════════════════════════
   EJECUTAR ACCIÓN
   ════════════════════════════════════════════════════════════ */
async function runAction(action, payload) {
  payload = payload || {};

  switch (action) {
    case 'obs:scene':
      if (!obsWs) throw new Error('OBS no conectado');
      await obsWs.call('SetCurrentProgramScene', { sceneName: payload.scene });
      return { ok: true };

    case 'obs:record:start':
      if (!obsWs) throw new Error('OBS no conectado');
      await obsWs.call('StartRecord');
      return { ok: true };

    case 'obs:record:stop':
      if (!obsWs) throw new Error('OBS no conectado');
      await obsWs.call('StopRecord');
      return { ok: true };

    case 'obs:stream:start':
      if (!obsWs) throw new Error('OBS no conectado');
      await obsWs.call('StartStream');
      return { ok: true };

    case 'obs:stream:stop':
      if (!obsWs) throw new Error('OBS no conectado');
      await obsWs.call('StopStream');
      return { ok: true };

    case 'obs:mic:mute':
      if (!obsWs) throw new Error('OBS no conectado');
      await obsWs.call('ToggleInputMute', { inputName: payload.input || 'Mic/Aux' });
      return { ok: true };

    case 'obs:scene:list':
      if (!obsWs) throw new Error('OBS no conectado');
      const scenes = await obsWs.call('GetSceneList');
      return { ok: true, scenes: scenes.scenes.map(s => s.sceneName) };

    /* ── Aitum Vertical ── */
    case 'aitum:scene:switch':
      if (!payload.scene) throw new Error('Falta scene');
      await aitumSwitchScene(payload.scene);
      return { ok: true };

    case 'aitum:streaming:start':    await aitumStartStreaming();    return { ok: true };
    case 'aitum:streaming:stop':     await aitumStopStreaming();     return { ok: true };
    case 'aitum:streaming:toggle':   await aitumToggleStreaming();   return { ok: true };

    case 'aitum:recording:start':    await aitumStartRecording();    return { ok: true };
    case 'aitum:recording:stop':     await aitumStopRecording();     return { ok: true };
    case 'aitum:recording:toggle':   await aitumToggleRecording();   return { ok: true };
    case 'aitum:recording:pause':    await aitumPauseRecording();    return { ok: true };
    case 'aitum:recording:unpause':  await aitumUnpauseRecording();  return { ok: true };
    case 'aitum:recording:chapter':  await aitumAddChapter(payload.name); return { ok: true };

    case 'aitum:backtrack:start':    await aitumStartBacktrack();    return { ok: true };
    case 'aitum:backtrack:stop':     await aitumStopBacktrack();     return { ok: true };
    case 'aitum:backtrack:save':     await aitumSaveBacktrack(payload.filename); return { ok: true };

    case 'aitum:virtualcam:start':   await aitumStartVirtualCam();   return { ok: true };
    case 'aitum:virtualcam:stop':    await aitumStopVirtualCam();    return { ok: true };

    case 'tts:speak':
    case 'tts:skip':
    case 'tts:pause':
      if (_io) _io.emit('deck:tts', { action, payload });
      return { ok: true, forwarded: 'tts' };

    case 'chat:clear':
      if (_io) _io.emit('deck:chat:clear');
      return { ok: true };

    case 'tiktok:view':
      if (_io) _io.emit('deck:tiktok:view', { index: payload.index });
      return { ok: true };

    case 'config:reload':
      if (_io) _io.emit('deck:config:reload');
      return { ok: true };

    case 'custom:socket':
      if (_io) _io.emit(payload.event || 'deck:custom', payload.data || {});
      return { ok: true };

    default:
      throw new Error('Acción desconocida: ' + action);
  }
}

/* ════════════════════════════════════════════════════════════
   ESTADO DE STATS (para widgets)
   ════════════════════════════════════════════════════════════ */
const statsAgg = {
  tiktok:  { likes: 0, follows: 0, shares: 0, diamonds: 0, viewers: 0, gifts: 0, messages: 0, topGifters: [] },
  twitch:  { messages: 0, bits: 0, subs: 0 },
  youtube: { superchats: 0, members: 0, messages: 0, topSuperchatters: [] },
  kick:    { messages: 0 }
};

function agregarTikTok(todos) {
  if (!todos || typeof todos !== 'object') return;
  const agg = { likes: 0, follows: 0, shares: 0, diamonds: 0, viewers: 0, gifts: 0, messages: 0 };
  const gifters = new Map();

  for (const usuario in todos) {
    const s = todos[usuario] || {};
    agg.likes    += Number(s.likes)    || 0;
    agg.follows  += Number(s.follows)  || 0;
    agg.shares   += Number(s.shares)   || 0;
    agg.diamonds += Number(s.diamantes)|| 0;
    agg.viewers  += Number(s.espectadores) || 0;
    agg.gifts    += Number(s.regalosRecibidos) || 0;
    agg.messages += Number(s.mensajes) || 0;

    (s.topGifters || []).forEach(g => {
      const key = String(g.username || '').toLowerCase();
      if (!key) return;
      const prev = gifters.get(key) || { username: g.username, avatar: g.avatar, diamantes: 0 };
      prev.diamantes += Number(g.diamantes) || 0;
      if (!prev.avatar && g.avatar) prev.avatar = g.avatar;
      gifters.set(key, prev);
    });
  }

  Object.assign(statsAgg.tiktok, agg);
  statsAgg.tiktok.topGifters = Array.from(gifters.values())
    .sort((a, b) => b.diamantes - a.diamantes)
    .slice(0, 10);
}

function emitStats() {
  if (deckConfig.enabled === false) return;
  if (_io) _io.emit('deck:stats-update', statsAgg);
}

/* ════════════════════════════════════════════════════════════
   API — TOKEN
   ════════════════════════════════════════════════════════════ */
function checkToken(req, res) {
  if (!deckConfig.token) return true;
  const t = req.query.t || (req.body && req.body.token) || req.headers['x-deck-token'];
  if (t === deckConfig.token) return true;
  res.status(401).json({ error: 'Token inválido' });
  return false;
}

/* ════════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════════ */
function init(app, io) {
  _app = app;
  _io = io;
  loadDeck();
  if (deckConfig.enabled) connectObs();

  app.get('/deck', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'deck.html'));
  });

  app.get('/api/deck', (req, res) => {
    if (!checkToken(req, res)) return;
    res.json({
      token: deckConfig.token,
      theme: deckConfig.theme || 'cristal',
      enabled: deckConfig.enabled !== false,
      categories: deckConfig.categories,
      buttons: deckConfig.buttons,
      widgets: deckConfig.widgets,
      userPrefs: deckConfig.userPrefs,
      obs: {
        host: deckConfig.obs.host,
        port: deckConfig.obs.port,
        connected: !!obsWs
      }
    });
  });

  app.get('/api/deck-token', (req, res) => {
    res.json({ token: deckConfig.token });
  });

  app.get('/api/deck/lan-info', (req, res) => {
    if (!checkToken(req, res)) return;
    const ip = getLanIP();
    const port = (req.socket && req.socket.localPort) || 3000;
    res.json({
      ip,
      port,
      url: `http://${ip}:${port}/deck?t=${deckConfig.token}`
    });
  });

  app.post('/api/deck/categories', (req, res) => {
    if (!checkToken(req, res)) return;
    const categories = Array.isArray(req.body) ? req.body : req.body && req.body.categories;
    if (!Array.isArray(categories)) return res.status(400).json({ error: 'categories debe ser array' });
    deckConfig.categories = categories;
    saveDeck();
    if (_io) _io.emit('deck:categories-updated', categories);
    res.json({ ok: true });
  });

  app.post('/api/deck/buttons', (req, res) => {
    if (!checkToken(req, res)) return;
    const buttons = Array.isArray(req.body) ? req.body : req.body && req.body.buttons;
    if (!Array.isArray(buttons)) return res.status(400).json({ error: 'buttons debe ser array' });
    deckConfig.buttons = buttons;
    saveDeck();
    if (_io) _io.emit('deck:buttons-updated', buttons);
    res.json({ ok: true });
  });

  app.post('/api/deck/widgets', (req, res) => {
    if (!checkToken(req, res)) return;
    const widgets = Array.isArray(req.body) ? req.body : req.body && req.body.widgets;
    if (!Array.isArray(widgets)) return res.status(400).json({ error: 'widgets debe ser array' });
    deckConfig.widgets = widgets;
    saveDeck();
    if (_io) _io.emit('deck:widgets-updated', widgets);
    res.json({ ok: true });
  });

  /* ── Activar/desactivar deck ── */
  app.post('/api/deck/enabled', (req, res) => {
    if (!checkToken(req, res)) return;
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled debe ser boolean' });
    deckConfig.enabled = enabled;
    saveDeck();
    if (_io) _io.emit('deck:enabled-updated', { enabled });
    if (enabled) {
      if (!obsWs) connectObs();
    } else {
      if (obsWs) { try { obsWs.disconnect(); } catch (e) {} obsWs = null; }
      if (_io) _io.emit('deck:obs-status', { connected: false });
    }
    res.json({ ok: true, enabled });
  });

  app.post('/api/deck/theme', (req, res) => {
    if (!checkToken(req, res)) return;
    const { theme } = req.body;
    if (typeof theme !== 'string') return res.status(400).json({ error: 'theme inválido' });
    deckConfig.theme = theme;
    saveDeck();
    if (_io) _io.emit('deck:theme-updated', theme);
    res.json({ ok: true });
  });

  /* ── Preferencias UI del deck ── */
  app.post('/api/deck/prefs', (req, res) => {
    if (!checkToken(req, res)) return;
    const prefs = req.body && (req.body.prefs || req.body);
    if (!prefs || typeof prefs !== 'object') {
      return res.status(400).json({ error: 'prefs inválido' });
    }
    deckConfig.userPrefs = prefs;
    saveDeck();
    if (_io) _io.emit('deck:prefs-updated', prefs);
    res.json({ ok: true });
  });

  app.post('/api/deck/trigger', async (req, res) => {
    if (!checkToken(req, res)) return;
    const { id } = req.body;
    const btn = deckConfig.buttons.find(b => b.id === id);
    if (!btn) return res.status(404).json({ error: 'Botón no encontrado' });
    try {
      const result = await runAction(btn.action, btn.payload || {});
      res.json({ ok: true, result });
    } catch (e) {
      console.error('[deck] Error ejecutando acción:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/deck/obs-config', (req, res) => {
    if (!checkToken(req, res)) return;
    const { host, port, password } = req.body;
    deckConfig.obs = {
      host: host || '127.0.0.1',
      port: parseInt(port, 10) || 4455,
      password: password || ''
    };
    saveDeck();
    if (obsWs) { try { obsWs.disconnect(); } catch (e) {} obsWs = null; }
    if (deckConfig.enabled) connectObs();
    res.json({ ok: true });
  });

  app.get('/api/deck/stats', (req, res) => {
    if (!checkToken(req, res)) return;
    res.json(statsAgg);
  });

  /* ════════════════════════════════════════════════════════════
     AITUM VERTICAL — Endpoints
     ════════════════════════════════════════════════════════════ */

  /* Diagnóstico: lista los requestType soportados */
  app.get('/api/deck/aitum/requests', (req, res) => {
    if (!checkToken(req, res)) return;
    res.json({
      ok: true,
      vendor: AITUM_VENDOR,
      supported: [
        'version', 'switch_scene', 'current_scene', 'get_scenes', 'status',
        'start_streaming', 'stop_streaming', 'toggle_streaming',
        'start_recording', 'stop_recording', 'toggle_recording',
        'start_backtrack', 'stop_backtrack', 'save_backtrack',
        'start_virtual_camera', 'stop_virtual_camera',
        'update_stream_key', 'update_stream_server',
        'add_chapter', 'pause_recording', 'unpause_recording'
      ]
    });
  });

  /* Estado completo: escenas + escena actual + outputs */
  app.get('/api/deck/aitum/state', async (req, res) => {
    if (!checkToken(req, res)) return;
    try {
      const [scenes, current, status] = await Promise.all([
        aitumGetScenes().catch(() => []),
        aitumGetCurrentScene().catch(() => null),
        aitumGetStatus().catch(() => ({}))
      ]);
      res.json({
        ok: true,
        vendor: AITUM_VENDOR,
        scenes: (scenes || []).map(s => (typeof s === 'string' ? s : s.name)),
        current,
        status
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /* Lista de escenas del canvas vertical */
  app.get('/api/deck/aitum/scenes', async (req, res) => {
    if (!checkToken(req, res)) return;
    try {
      const scenes = await aitumGetScenes();
      const current = await aitumGetCurrentScene().catch(() => null);
      res.json({ ok: true, scenes, current });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /* Cambiar escena vertical */
  app.post('/api/deck/aitum/switch', async (req, res) => {
    if (!checkToken(req, res)) return;
    const { scene } = req.body || {};
    if (!scene) return res.status(400).json({ ok: false, error: 'Falta scene' });
    try {
      await aitumSwitchScene(scene);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /* Estado de outputs (streaming/recording/backtrack/virtualcam) */
  app.get('/api/deck/aitum/status', async (req, res) => {
    if (!checkToken(req, res)) return;
    try {
      const status = await aitumGetStatus();
      res.json({ ok: true, status });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /* Acciones sobre outputs */
  app.post('/api/deck/aitum/action', async (req, res) => {
    if (!checkToken(req, res)) return;
    const { action, name, filename } = req.body || {};
    const handlers = {
      'streaming:start':      () => aitumStartStreaming(),
      'streaming:stop':       () => aitumStopStreaming(),
      'streaming:toggle':     () => aitumToggleStreaming(),
      'recording:start':      () => aitumStartRecording(),
      'recording:stop':       () => aitumStopRecording(),
      'recording:toggle':     () => aitumToggleRecording(),
      'recording:pause':      () => aitumPauseRecording(),
      'recording:unpause':    () => aitumUnpauseRecording(),
      'recording:chapter':    () => aitumAddChapter(name),
      'backtrack:start':      () => aitumStartBacktrack(),
      'backtrack:stop':       () => aitumStopBacktrack(),
      'backtrack:save':       () => aitumSaveBacktrack(filename),
      'virtualcam:start':     () => aitumStartVirtualCam(),
      'virtualcam:stop':      () => aitumStopVirtualCam()
    };
    const fn = handlers[action];
    if (!fn) return res.status(400).json({ ok: false, error: 'action desconocida: ' + action });
    try {
      await fn();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /* ════════════════════════════════════════════════════════════
     HOOK SOBRE io.emit — capturamos TODO lo que el servidor emite
     ════════════════════════════════════════════════════════════ */
  const originalEmit = io.emit.bind(io);
  io.emit = function (event, ...args) {
    originalEmit(event, ...args);

    try {
      switch (event) {
        case 'tiktok-stats-all':
          agregarTikTok(args[0]);
          emitStats();
          break;

        case 'tiktok-gift':
          if (args[0] && args[0].esFinal) {
            statsAgg.tiktok.gifts++;
            if (args[0].diamantesTotales) {
              statsAgg.tiktok.diamonds += Number(args[0].diamantesTotales);
            }
            emitStats();
          }
          break;

        case 'tiktok-like':
          if (args[0] && args[0].cantidad) {
            statsAgg.tiktok.likes += Number(args[0].cantidad);
            emitStats();
          }
          break;

        case 'tiktok-follow':
          statsAgg.tiktok.follows++;
          emitStats();
          break;

        case 'tiktok-share':
          statsAgg.tiktok.shares++;
          emitStats();
          break;

        case 'tiktok-viewers':
          if (args[0] && typeof args[0].espectadores === 'number') {
            statsAgg.tiktok.viewers = args[0].espectadores;
            emitStats();
          }
          break;

        case 'chat-message':
          if (args[0] && args[0].platform) {
            const p = String(args[0].platform).toLowerCase();
            if (p === 'tiktok')  statsAgg.tiktok.messages++;
            if (p === 'twitch')  statsAgg.twitch.messages++;
            if (p === 'youtube') statsAgg.youtube.messages++;
            if (p === 'kick')    statsAgg.kick.messages++;
            emitStats();
          }
          break;

        case 'stats-update':
          if (args[0] && typeof args[0].totalBits === 'number') {
            statsAgg.twitch.bits = args[0].totalBits;
            emitStats();
          }
          break;

        case 'youtube-superchat':
          statsAgg.youtube.superchats++;
          emitStats();
          break;

        case 'youtube-member':
          statsAgg.youtube.members++;
          emitStats();
          break;
      }
    } catch (e) {
      // Silencioso
    }
  };

  const lanIP = getLanIP();
  console.log('[deck] Módulo listo. Token:', deckConfig.token);
  console.log('[deck] Enabled:', deckConfig.enabled);
  console.log('[deck] Local:  http://localhost:3000/deck?t=' + deckConfig.token);
  console.log('[deck] Móvil:  http://' + lanIP + ':3000/deck?t=' + deckConfig.token);
}

module.exports = { init };