/* overlay-shim.js — TogiPanel · capa compatibilidad StreamElements
   Fase 1: chat plano
   Fase 2: emotes BTTV / FFZ / 7TV
   Fase 3: badges de rol
   Fase 4: subs, resubs, subgifts, submysterygifts, cheers, gifts, deletes
   Fase 4b: reescritura de alertas con logo por plataforma
   Fase 5: emotes nativos Twitch (globales + canal)
   Fase 5b: emotes top BTTV hardcodeados + 7TV/FFZ del canal
   Fase 5c: badge de plataforma en el mensaje
   Fase 6: traducción al español + auto-borrado de mensajes viejos
   Fase 7: compatibilidad completa con widgets SE (payload completo)
   Fase 8: avatar + type + giftName + service en buildMessageEvent
*/
(function () {
  'use strict';

  const SOCKET_URL = window.location.origin;

  // ─── Config auto-borrado (Fase 6) ───
  const VIDA_MS   = 10000; // cada mensaje dura 10s
  const MAX_FILAS = 10;    // máximo de mensajes visibles

  // ─── Config compatibilidad SE (Fase 7) ───
  const SE_CURRENCY = 'USD';
  const SE_SYMBOL   = '$';

  // ─── Fix ancho de mensajes (widget custom overlay) ───
  (function inyectarAnchoCompacto() {
    const style = document.createElement('style');
    style.id = 'togi-shim-width-fix';
    style.textContent = `
      .main-container {
        align-items: flex-start !important;
      }
      .main-container .message-row {
        max-width: 340px !important;
        width: fit-content !important;
        margin-right: auto !important;
      }
    `;
    document.head.appendChild(style);
    console.log('[shim] Fix de ancho inyectado');
  })();

  // ─── Auto-borrado de filas viejas (Fase 6) ───
  function aplicarAutoBorrado(cont) {
    const observer = new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (!(n instanceof HTMLElement)) continue;
          if (!n.classList.contains('message-row')) continue;

          const filas = cont.querySelectorAll(':scope > .message-row');
          if (filas.length > MAX_FILAS) {
            const sobra = filas.length - MAX_FILAS;
            for (let i = 0; i < sobra; i++) {
              if (filas[i] && filas[i].parentNode) filas[i].remove();
            }
          }

          setTimeout(() => {
            if (!n.parentNode) return;
            n.style.transition = 'opacity 0.4s linear';
            n.style.opacity = '0';
            setTimeout(() => { if (n.parentNode) n.remove(); }, 420);
          }, VIDA_MS);
        }
      }
    });
    observer.observe(cont, { childList: true, subtree: false });
    console.log('[shim-vida] Auto-borrado: ' + VIDA_MS + 'ms, max=' + MAX_FILAS);
  }

  function esperarContenedor() {
    let intentos = 0;
    return new Promise((resolve, reject) => {
      const check = () => {
        const c = document.querySelector('.main-container');
        if (c) return resolve(c);
        intentos++;
        if (intentos > 100) return reject(new Error('sin .main-container'));
        setTimeout(check, 200);
      };
      check();
    });
  }

  esperarContenedor()
    .then(aplicarAutoBorrado)
    .catch(e => console.warn('[shim-vida]', e.message));

  const BADGE_URLS = {
    broadcaster: 'https://static-cdn.jtvnw.net/badges/v1/5527c58c-fb7d-422d-b71b-f309dcb85cc1/1',
    moderator:   'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/1',
    vip:         'https://static-cdn.jtvnw.net/badges/v1/b817aba4-fad8-49e2-b88a-7cc744dfa6ec/1',
    subscriber:  'https://static-cdn.jtvnw.net/badges/v1/5d9f2208-5dd8-11e7-8513-2ff4adfae661/1'
  };

  // ─── Info + logo por plataforma ───
  const PLAT_INFO = {
    twitch:  { nombre: 'Twitch',  color: '#9146FF' },
    tiktok:  { nombre: 'TikTok',  color: '#fe2c55' },
    kick:    { nombre: 'Kick',    color: '#53fc18' },
    youtube: { nombre: 'YouTube', color: '#ff0000' }
  };
  function infoPlat(p) {
    return PLAT_INFO[p] || { nombre: 'Plataforma', color: '#ff4976' };
  }
  function svgPlataforma(p, size) {
    size = size || 20;
    const base = `width="${size}" height="${size}" style="display:inline-block;vertical-align:middle;"`;
    if (p === 'twitch') {
      return `<svg ${base} viewBox="0 0 24 24"><path fill="#9146FF" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>`;
    }
    if (p === 'tiktok') {
      return `<svg ${base} viewBox="0 0 24 24"><path fill="#000" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/></svg>`;
    }
    if (p === 'kick') {
      return `<svg ${base} viewBox="0 0 24 24"><path fill="#53FC18" d="M1.333 0h8v5.333h2.667V2.667h2.667V0h8v8h-2.667v2.667h-2.666v2.666h2.666V16h2.667v8h-8v-2.667h-2.667v-2.666h-2.667V24h-8z"/></svg>`;
    }
    if (p === 'youtube') {
      return `<svg ${base} viewBox="0 0 24 24"><path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12z"/></svg>`;
    }
    return '';
  }

  function badgePlataforma(platform) {
    const map = {
      twitch:  '🟣 ',
      tiktok:  '⚫ ',
      kick:    '🟢 ',
      youtube: '🔴 '
    };
    return map[(platform || '').toLowerCase()] || '🟣 ';
  }

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return Math.abs(h).toString(36);
  }
  function hashColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    h = (h & 0x00FFFFFF) | 0x404040;
    return '#' + ('00000' + h.toString(16)).slice(-6);
  }
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  const _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/api\.streamelements\.com\/kappa\/v2\/channels\//.test(url)) {
      return Promise.resolve(new Response(JSON.stringify({
        provider: 'twitch', username: 'togipanel', _id: 'togipanel'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (/pronouns\.alejo\.io\/api\/users\//.test(url)) {
      return Promise.resolve(new Response('[]', {
        status: 200, headers: { 'Content-Type': 'application/json' }
      }));
    }
    return _fetch(input, init);
  };

  const EMOTE_MAP = new Map();

  // ─── Fase 6: traductor al español ───
  const translationCache = new Map();
  const TRANSLATION_CACHE_MAX = 500;

  function necesitaTraduccion(texto) {
    if (!texto) return false;
    return /[a-zA-Z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(texto);
  }

  async function traducirAlEspanol(texto) {
    if (!texto || !texto.trim()) return texto;
    if (!necesitaTraduccion(texto)) return texto;
    if (translationCache.has(texto)) return translationCache.get(texto);

    const partes = String(texto).split(/(\s+)/);
    const tokens = [];
    const preparado = partes.map(p => {
      if (!p || /^\s+$/.test(p)) return p;
      if (EMOTE_MAP.has(p)) {
        const idx = tokens.length;
        tokens.push(p);
        return `XzQzTk${idx}QzXz`;
      }
      return p;
    }).join('');

    try {
      const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=es&dt=t&q=' +
        encodeURIComponent(preparado);
      const r = await _fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const source = data[2] || '';

      if (source === 'es') {
        translationCache.set(texto, texto);
        return texto;
      }

      let trad = (data[0] || []).map(x => (x && x[0]) ? x[0] : '').join('');
      tokens.forEach((code, i) => {
        trad = trad.split(`XzQzTk${i}QzXz`).join(code);
      });

      if (translationCache.size >= TRANSLATION_CACHE_MAX) {
        const primera = translationCache.keys().next().value;
        translationCache.delete(primera);
      }
      translationCache.set(texto, trad);

      console.log(`[shim-i18n] ${source}→es: "${texto.slice(0, 60)}" → "${trad.slice(0, 60)}"`);
      return trad;
    } catch (e) {
      console.warn('[shim-i18n] Error:', e.message);
      translationCache.set(texto, texto);
      return texto;
    }
  }

  // Top BTTV hardcodeados (los que NO están en /cached/emotes/global)
  const BTTV_TOP_HARDCODED = [
    { code: 'KEKW',       id: '5e9c6c187e090362f8b0b9e8' },
    { code: 'OMEGALUL',   id: '5835d47b7d4daf0a6f3e7e9a' },
    { code: 'monkaS',     id: '56e9f0ec38852c034c0e4e33' },
    { code: 'catJAM',     id: '5f1b0186cf6d754081411379' },
    { code: 'Sadge',      id: '5e9c6c187e090362f8b0b9e9' },
    { code: 'Pog',        id: '5ff827395ef7d10c7912c106' },
    { code: 'PepeHands',  id: '59f27b3f4ebd8047f54dee29' },
    { code: 'peepoHappy', id: '5d3d1a9e9e37d10a7b8d4a4e' },
    { code: 'peepoSad',   id: '5d3d1a9e9e37d10a7b8d4a4f' }
  ];

  function addBttvFromId(id, code) {
    const base = 'https://cdn.betterttv.net/emote/' + id;
    EMOTE_MAP.set(code, {
      type: 'bttv', id,
      urls: { 1: base + '/1x', 2: base + '/2x', 4: base + '/3x' }
    });
  }
  function add7tvFromId(id, code) {
    const base = 'https://cdn.7tv.app/emote/' + id;
    EMOTE_MAP.set(code, {
      type: '7tv', id,
      urls: { 1: base + '/1x.webp', 2: base + '/2x.webp', 4: base + '/4x.webp' }
    });
  }

  async function cargarEmotesGlobales() {
    let bttvGlobal = 0, ffz = 0, tv = 0;

    try {
      const r = await _fetch('https://api.betterttv.net/3/cached/emotes/global');
      const list = await r.json();
      if (Array.isArray(list)) {
        for (const e of list) {
          if (!e.code || !e.id) continue;
          if (EMOTE_MAP.has(e.code)) continue;
          addBttvFromId(e.id, e.code);
          bttvGlobal++;
        }
      }
    } catch (e) { console.warn('[shim] BTTV global error:', e.message); }

    try {
      const r = await _fetch('https://api.frankerfacez.com/v1/set/global');
      const data = await r.json();
      const sets = data.sets || {};
      for (const sid in sets) {
        for (const e of (sets[sid].emoticons || [])) {
          if (!e.name || EMOTE_MAP.has(e.name)) continue;
          EMOTE_MAP.set(e.name, { type: 'ffz', id: String(e.id), urls: e.urls || {} });
          ffz++;
        }
      }
    } catch (e) { console.warn('[shim] FFZ error:', e.message); }

    try {
      const r = await _fetch('https://7tv.io/v3/emote-sets/global');
      const data = await r.json();
      for (const e of (data.emotes || [])) {
        if (!e.name || EMOTE_MAP.has(e.name)) continue;
        add7tvFromId(e.id, e.name);
        tv++;
      }
    } catch (e) { console.warn('[shim] 7TV global error:', e.message); }

    console.log(`[shim] Emotes: BTTV.global=${bttvGlobal} FFZ=${ffz} 7TV.global=${tv} total=${EMOTE_MAP.size}`);
  }

  async function cargarEmotesTwitch() {
    let g = 0, c = 0;
    try {
      const r = await _fetch('/api/twitch/emotes');
      if (!r.ok) { console.warn('[shim-twitch] HTTP', r.status); return; }
      const data = await r.json();
      if (!data.ok) { console.warn('[shim-twitch]', data.error || 'sin ok'); return; }

      const agregar = (lista, esGlobal) => {
        for (const e of (lista || [])) {
          if (!e.name || EMOTE_MAP.has(e.name)) continue;
          EMOTE_MAP.set(e.name, {
            type: 'twitch',
            id: e.id,
            urls: {
              1: e.url_1x || null,
              2: e.url_2x || e.url_1x || null,
              4: e.url_4x || e.url_2x || e.url_1x || null
            }
          });
          if (esGlobal) g++; else c++;
        }
      };
      agregar(data.global, true);
      agregar(data.channelEmotes, false);
      console.log(`[shim-twitch] Emotes nativos: global=${g} canal=${c}`);
    } catch (e) {
      console.warn('[shim-twitch] Error:', e.message);
    }
  }

  function addBttvTopHardcoded() {
    let n = 0;
    for (const { code, id } of BTTV_TOP_HARDCODED) {
      if (EMOTE_MAP.has(code)) continue;
      addBttvFromId(id, code);
      n++;
    }
    console.log(`[shim-bttv-top] Añadidos ${n} emotes top hardcodeados`);
  }

  async function cargarEmotesCanales() {
    let s = 0, f = 0;
    try {
      const r = await _fetch('/api/emotes-canales');
      if (!r.ok) { console.warn('[shim-canales] HTTP', r.status); return; }
      const data = await r.json();
      if (!data.ok) { console.warn('[shim-canales]', data.error || 'sin ok'); return; }

      for (const e of (data.sevenTv || [])) {
        if (!e.name || EMOTE_MAP.has(e.name)) continue;
        EMOTE_MAP.set(e.name, {
          type: '7tv-canal',
          id: e.id,
          urls: {
            1: e.url_1x || null,
            2: e.url_2x || e.url_1x || null,
            4: e.url_4x || e.url_2x || e.url_1x || null
          }
        });
        s++;
      }

      for (const e of (data.ffz || [])) {
        if (!e.name || EMOTE_MAP.has(e.name)) continue;
        EMOTE_MAP.set(e.name, {
          type: 'ffz-canal',
          id: e.id,
          urls: {
            1: e.url_1x || null,
            2: e.url_2x || e.url_1x || null,
            4: e.url_4x || e.url_2x || e.url_1x || null
          }
        });
        f++;
      }

      console.log(`[shim-canales] Emotes del canal: 7TV=${s} FFZ=${f}`);
    } catch (e) {
      console.warn('[shim-canales] Error:', e.message);
    }
  }

  const emotesReady = cargarEmotesGlobales()
    .then(() => cargarEmotesTwitch())
    .then(() => { addBttvTopHardcoded(); return cargarEmotesCanales(); });

  function extraerEmotes(texto) {
    const out = [];
    if (!texto) return out;
    const partes = String(texto).split(/\s+/);
    let pos = 0;
    for (const w of partes) {
      if (!w) continue;
      const idx = String(texto).indexOf(w, pos);
      const em = EMOTE_MAP.get(w);
      if (em) {
        out.push({
          type: em.type, name: w, id: em.id, urls: em.urls,
          gif: /\.gif/i.test(em.urls[1] || ''),
          start: idx, end: idx + w.length
        });
      }
      pos = idx + w.length;
    }
    return out;
  }

  function buildRenderedText(texto) {
    if (!texto) return '';
    const partes = String(texto).split(/(\s+)/);
    let html = '';
    for (const p of partes) {
      if (!p) continue;
      if (/^\s+$/.test(p)) { html += p; continue; }
      const em = EMOTE_MAP.get(p);
      if (em) {
        const src = em.urls[2] || em.urls[1] || em.urls[4];
        html += `<img class="emote" src="${src}" alt="${escapeHtml(p)}" />`;
      } else {
        html += escapeHtml(p);
      }
    }
    return html;
  }

  let fieldData = {};
  const configReady = _fetch('/api/custom-overlay/fields')
    .then(r => r.ok ? r.json() : {})
    .then(j => { fieldData = j || {}; })
    .catch(() => {});

  const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });

  const colaMensajes = [];
  let emotesListos = false;

  let cadenaTraduccion = Promise.resolve();

  function procesarMensajeChat(msg) {
    cadenaTraduccion = cadenaTraduccion
      .then(async () => {
        if (msg.message) {
          msg.message = await traducirAlEspanol(msg.message);
        }
        emitirMensaje(msg);
      })
      .catch(e => console.warn('[shim-i18n] procesar error:', e.message));
  }

  emotesReady.then(() => {
    emotesListos = true;
    while (colaMensajes.length) {
      procesarMensajeChat(colaMensajes.shift());
    }
  });

  // ─── Fase 7: payload completo estilo StreamElements ───
  function buildBadgesArray(role) {
    if (!role || !BADGE_URLS[role]) return [];
    return [{ type: role, version: '1', url: BADGE_URLS[role], description: role }];
  }

  function buildBadgesStr(role) {
    if (!role || !BADGE_URLS[role]) return '';
    return role + '/1';
  }

  function buildTags(msg) {
    const role = msg.role || null;
    const username = msg.username || '';
    const platform = msg.platform || 'twitch';
    const tags = {
      badges: buildBadgesStr(role),
      color: hashColor(username),
      'display-name': username,
      mod: role === 'moderator' ? '1' : '0',
      subscriber: (role === 'subscriber' || role === 'broadcaster') ? '1' : '0',
      vip: role === 'vip' ? '1' : '0',
      'first-msg': '0',
      'user-id': hash(username),
      'room-id': 'togipanel',
      'user-type': role === 'moderator' ? 'mod' : (role === 'broadcaster' ? 'broadcaster' : ''),
      'tmi-sent-ts': String(Date.now()),
      turbo: '0',
      'badge-info': ''
    };
    return tags;
  }

  function buildMessageEvent(msg) {
    const texto = msg.message || '';
    const role = msg.role || null;
    const platform = msg.platform || 'twitch';
    const username = msg.username || '';
    return {
      service: platform,
      type: msg.type || 'chat',
      giftName: msg.giftName || null,
      data: {
        nick: username,
        displayName: username,
        avatar: msg.avatar || null,
        service: platform,
        text: badgePlataforma(platform) + texto,
        userId: hash(username),
        msgId: msg.msgId || uuid(),
        isAction: false,
        displayColor: hashColor(username),
        badges: buildBadgesArray(role),
        emotes: extraerEmotes(texto),
        tags: buildTags(msg),
        channel: 'togipanel'
      },
      renderedText: badgePlataforma(platform) + buildRenderedText(texto)
    };
  }

  function dispatch(listener, event) {
    window.dispatchEvent(new CustomEvent('onEventReceived', {
      detail: { listener, event }
    }));
  }

  // ─── Fase 4b: reescritura con logo por plataforma ───
  function reescribirAlerta(datos, intento) {
    intento = intento || 0;
    const filas = document.querySelectorAll('.main-container .message-row');
    const ultima = filas.length ? filas[filas.length - 1] : null;
    const p = ultima ? ultima.querySelector('.alert-message > p:last-child') : null;

    if (!p) {
      if (intento < 12) {
        setTimeout(() => reescribirAlerta(datos, intento + 1), 80);
      } else {
        console.warn('[shim-tip] No encontré alerta (tipo=' + datos.tipo + ')');
      }
      return;
    }

    const info = infoPlat(datos.platform);
    const prefijo = `<span style="display:inline-flex;align-items:center;gap:6px;vertical-align:middle;margin-right:6px;">${svgPlataforma(datos.platform, 20)}</span>`;
    let html = '';

    if (datos.tipo === 'tip') {
      const rep = datos.repeat > 1 ? ` <b style="color:${info.color};">x${datos.repeat}</b>` : '';
      const imagen = datos.giftImage
        ? `<img src="${datos.giftImage}" style="width:48px;height:48px;vertical-align:middle;margin-right:8px;border-radius:8px;" />`
        : '';
      html = `${prefijo}${imagen}<span><b>${escapeHtml(datos.username)}</b> envió <b>${escapeHtml(datos.giftName)}</b>${rep}</span>`;
      p.style.display = 'flex';
      p.style.alignItems = 'center';
      p.style.justifyContent = 'center';
      p.style.gap = '8px';
    } else if (datos.tipo === 'cheer') {
      html = `${prefijo}<span><b>${escapeHtml(datos.username)}</b> envió <b>${datos.amount}</b> bits</span>`;
    } else if (datos.tipo === 'sub') {
      html = `${prefijo}<span><b>${escapeHtml(datos.username)}</b> se suscribió</span>`;
    } else if (datos.tipo === 'resub') {
      const m = datos.amount > 1 ? ` <b>${datos.amount} meses</b>` : '';
      html = `${prefijo}<span><b>${escapeHtml(datos.username)}</b> renovó su sub${m}</span>`;
    } else if (datos.tipo === 'subgift') {
      html = `${prefijo}<span><b>${escapeHtml(datos.username)}</b> regaló un sub a <b>${escapeHtml(datos.target || 'alguien')}</b></span>`;
    } else if (datos.tipo === 'submysterygift') {
      html = `${prefijo}<span><b>${escapeHtml(datos.username)}</b> regaló <b>${datos.amount}</b> subs a la comunidad</span>`;
    }

    if (html) {
      p.innerHTML = html;
      console.log('[shim-tip] Alerta reescrita:', datos.tipo, datos.username, '→', info.nombre);
    }
  }

  function emitirSub(msg) {
    const esSubgift = msg.type === 'subgift';
    const esMystery = msg.type === 'submysterygift';
    const event = {
      name:     msg.username || '',
      amount:   esMystery ? (msg.amount || 1) : 1,
      count:    esSubgift ? 1 : (msg.months || 1),
      tier:     msg.tier || '1000',
      message:  msg.message || '',
      gifted:   esSubgift || esMystery,
      sender:   esSubgift || esMystery ? (msg.giftSender || null) : null,
      bulk:     esMystery,
      avatar:   msg.avatar || null
    };
    dispatch('subscriber-latest', event);

    setTimeout(() => reescribirAlerta({
      tipo:     msg.type,
      username: msg.username || '',
      amount:   esMystery ? (msg.amount || 1) : (msg.months || 1),
      target:   msg.recipient || null,
      platform: msg.platform || 'twitch'
    }, 0), 30);
  }

  function emitirCheer(msg) {
    dispatch('cheer-latest', {
      name:    msg.username || '',
      amount:  msg.bits || 0,
      message: msg.message || '',
      avatar:  msg.avatar || null
    });

    setTimeout(() => reescribirAlerta({
      tipo:     'cheer',
      username: msg.username || '',
      amount:   msg.bits || 0,
      platform: msg.platform || 'twitch'
    }, 0), 30);
  }

  function emitirTip(msg) {
    const amount = Number(
      msg.giftTotalDiamonds || msg.giftAmount || msg.amount || 0
    );
    const platform = msg.platform || 'tiktok';
    const giftName = msg.giftName || msg.message || 'Regalo';
    const giftImage = msg.giftImage || null;

    dispatch('tip-latest', {
      name:     msg.username || '',
      username: msg.username || '',
      amount,
      message:  giftName,
      currency: 'USD',
      avatar:   msg.avatar || null,
      platform,
      giftName,
      giftImage,
      giftRepeat:   msg.giftRepeat || 1,
      giftDiamonds: msg.giftTotalDiamonds || null
    });

    setTimeout(() => reescribirAlerta({
      tipo:      'tip',
      username:  msg.username || '',
      giftName,
      giftImage,
      repeat:    msg.giftRepeat || 1,
      platform
    }, 0), 30);
  }

  function emitirDelete(msg) {
    if (!msg.targetMsgId) return;
    dispatch('delete-message', {
      msgId:  msg.targetMsgId,
      userId: hash(msg.targetUser || msg.username || '')
    });
  }

  function emitirMensaje(msg) {
    const tipo = msg.type;
    if (tipo === 'delete') {
      return emitirDelete(msg);
    }
    if (tipo === 'sub' || tipo === 'resub' || tipo === 'subgift' || tipo === 'submysterygift') {
      return emitirSub(msg);
    }
    if (tipo === 'cheer') {
      return emitirCheer(msg);
    }
    if (tipo === 'gift') {
      return emitirTip(msg);
    }
    dispatch('message', buildMessageEvent(msg));
  }

  socket.on('chat-message', msg => {
    const tipo = msg.type;
    const esChatSimple = !tipo || tipo === 'chat';
    if (!emotesListos && esChatSimple) {
      colaMensajes.push(msg);
      return;
    }
    if (esChatSimple) {
      return procesarMensajeChat(msg);
    }
    emitirMensaje(msg);
  });

  // ─── Fase 7: payload completo estilo StreamElements ───
  function fireWidgetLoad() {
    Promise.all([configReady, emotesReady]).then(() => {
      window.dispatchEvent(new CustomEvent('onWidgetLoad', {
        detail: {
          fieldData: fieldData,
          currency: SE_CURRENCY,
          channel: {
            id: 'togipanel',
            username: 'togipanel',
            name: 'togipanel',
            provider: 'twitch',
            symbol: SE_SYMBOL,
            displayName: 'TogiPanel'
          },
          overlay: {},
          recents: []
        }
      }));
      console.log('[shim-load] onWidgetLoad disparado con payload completo');
    });
  }

  window.__TOGI_SHIM__ = { socket, fireWidgetLoad, hash, hashColor, uuid, EMOTE_MAP, emotesReady };
})();