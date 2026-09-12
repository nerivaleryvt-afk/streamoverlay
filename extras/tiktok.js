/**
 * tiktok.js - Módulo de integración con TikTok Live
 * Usa tiktok-live-connector. Compatible con múltiples versiones.
 *
 * FIX v5:
 *   - Diamantes: busca en data.gift.diamondCount (camelCase)
 *   - repeatEnd: normaliza 0/1/true/false/'0'/'1'
 *   - member: mensaje "se unió al directo"
 *   - Histórico de últimos follows, shares, gifts, subs y miembros
 *   - Extrae avatar cuando TikTok lo incluye
 *   - Buffer de regalos con timeout de 2s para final=false
 *
 * FIX v6:
 *   - DEDUP de regalos: evita doble emisión cuando el timeout dispara
 *     y luego llega el final=true del mismo streak.
 *   - Payload de onGift enriquecido con aliases.
 *
 * FIX v7:
 *   - 👁️ VIEWERS robusto: busca el conteo en TODAS las variantes conocidas.
 *   - Log de diagnóstico para identificar qué campo usa tu versión.
 *
 * FIX v8 (este):
 *   - 🖼️ AVATARES EN LOS TOPS: los maps gifters, likers y sharers ahora
 *     guardan la URL del avatar del usuario. Así los overlays de top
 *     muestran la foto de perfil en vez del avatar por defecto.
 *   - En likes, se extrae el avatar del evento cuando TikTok lo manda.
 */

let writeLog;
try {
  ({ writeLog } = require('./logging'));
} catch {
  writeLog = (msg) => console.log('[tiktok]', msg);
}

// ─────────────────────────────────────────────────────────────
// Carga robusta del módulo tiktok-live-connector
// ─────────────────────────────────────────────────────────────

let tiktokModulePromise = null;
let TikTokLiveConnection = null;
let WebcastEvent = {};

async function cargarModuloTikTok() {
  if (TikTokLiveConnection) return true;
  if (tiktokModulePromise) return tiktokModulePromise;

  tiktokModulePromise = (async () => {
    try {
      const mod = await import('tiktok-live-connector');

      TikTokLiveConnection =
        mod.TikTokLiveConnection ||
        mod.WebcastPushConnection ||
        (mod.default && (mod.default.TikTokLiveConnection || mod.default.WebcastPushConnection)) ||
        mod.default ||
        null;

      WebcastEvent = mod.WebcastEvent || (mod.default && mod.default.WebcastEvent) || {};

      if (!TikTokLiveConnection) {
        writeLog('tiktok: ❌ No se encontró el constructor en tiktok-live-connector');
        return false;
      }

      writeLog('tiktok: ✅ Módulo cargado correctamente');
      writeLog('tiktok: WebcastEvent disponible = ' + (Object.keys(WebcastEvent).length > 0 ? 'SÍ' : 'NO (usando strings)'));
      return true;
    } catch (err) {
      writeLog('tiktok: ❌ Error al cargar el módulo: ' + (err && err.message ? err.message : String(err)));
      return false;
    }
  })();

  return tiktokModulePromise;
}

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────

const VENTANA_DEDUP_MS = 8000;
const VENTANA_DEDUP_GIFT_MS = 3000;
const TOP_LIMITE = 10;
const HISTORICO_LIMITE = 10;
const GIFT_TIMEOUT_MS = 2000;

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function claveDedupChat(usuario, mensaje) {
  const u = normalizar(usuario);
  const m = normalizar(mensaje);
  if (!u || !m) return '';
  return u + '|' + m;
}

function claveDedupGift(fuenteClave, usuario, giftName, repeatCount) {
  return `${fuenteClave}|${normalizar(usuario)}|${normalizar(giftName)}|${repeatCount}`;
}

function limpiarDedupViejo(mapa) {
  const ahora = Date.now();
  for (const [clave, ts] of mapa.entries()) {
    if (ahora - ts > VENTANA_DEDUP_MS) mapa.delete(clave);
  }
}

function nombreEvento(logico, porDefecto) {
  const mapa = {
    chat: ['CHAT', 'WebcastChatMessage', 'chat'],
    like: ['LIKE', 'WebcastLikeMessage', 'like'],
    gift: ['GIFT', 'WebcastGiftMessage', 'gift'],
    member: ['MEMBER', 'WebcastMemberMessage', 'member'],
    follow: ['FOLLOW', 'WebcastSocialMessage', 'follow'],
    share: ['SHARE', 'WebcastSocialMessage', 'share'],
    subscribe: ['SUBSCRIBE', 'WebcastSubNotifyMessage', 'subscribe'],
    roomUser: ['ROOM_USER', 'WebcastRoomUserSeqMessage', 'roomUser'],
    social: ['SOCIAL', 'WebcastSocialMessage', 'social']
  };
  const opciones = mapa[logico] || [];
  for (const op of opciones) {
    if (WebcastEvent && WebcastEvent[op]) return WebcastEvent[op];
  }
  return porDefecto;
}

function extraerUsuario(data) {
  if (!data) return '';
  if (data.user) {
    return String(
      data.user.uniqueId ||
      data.user.unique_id ||
      data.user.nickname ||
      data.user.nickName ||
      data.user.userId ||
      ''
    );
  }
  if (data.userUniqueId) return String(data.userUniqueId);
  if (data.user_unique_id) return String(data.user_unique_id);
  if (data.username) return String(data.username);
  return '';
}

function extraerMensaje(data) {
  if (!data) return '';
  if (typeof data.comment === 'string') return data.comment;
  if (data.comment && typeof data.comment.text === 'string') return data.comment.text;
  if (typeof data.text === 'string') return data.text;
  if (typeof data.message === 'string') return data.message;
  if (typeof data.content === 'string') return data.content;
  if (data.content && typeof data.content.text === 'string') return data.content.text;
  return '';
}

function extraerAvatar(data) {
  if (!data || !data.user) return null;
  const u = data.user;

  const candidatos = [
    u.avatarThumb && u.avatarThumb.urlList && u.avatarThumb.urlList[0],
    u.avatarThumb && u.avatarThumb.url_list && u.avatarThumb.url_list[0],
    u.avatarMedium && u.avatarMedium.urlList && u.avatarMedium.urlList[0],
    u.avatarMedium && u.avatarMedium.url_list && u.avatarMedium.url_list[0],
    u.avatarLarger && u.avatarLarger.urlList && u.avatarLarger.urlList[0],
    u.avatarLarger && u.avatarLarger.url_list && u.avatarLarger.url_list[0],
    u.avatar_url,
    u.avatarUrl,
    u.profilePictureUrl,
    u.profile_picture_url
  ];

  for (const c of candidatos) {
    if (c && typeof c === 'string' && c.startsWith('http')) return c;
  }
  return null;
}

function extraerDiamanteUnitario(data) {
  if (!data) return 0;

  const candidatos = [
    data.diamondCount,
    data.diamond_count,
    data.gift && data.gift.diamondCount,
    data.gift && data.gift.diamond_count,
    data.giftDetails && data.giftDetails.diamondCount,
    data.giftDetails && data.giftDetails.diamond_count,
    data.gift && data.gift.giftStruct && data.gift.giftStruct.diamondCount
  ];

  for (const c of candidatos) {
    if (c === undefined || c === null || c === '') continue;
    const n = typeof c === 'number' ? c : parseInt(c, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return 0;
}

function extraerNombreRegalo(data) {
  if (!data) return 'Regalo';
  return String(
    (data.giftName) ||
    (data.gift && data.gift.name) ||
    (data.gift && data.gift.describe) ||
    (data.giftDetails && data.giftDetails.giftName) ||
    (data.giftDetails && data.giftDetails.name) ||
    'Regalo'
  );
}

function extraerGiftId(data) {
  if (!data) return null;
  return (
    (data.giftId) ||
    (data.gift_id) ||
    (data.gift && data.gift.giftId) ||
    (data.gift && data.gift.id) ||
    (data.giftDetails && data.giftDetails.giftId) ||
    null
  );
}

function esRepeatEnd(data) {
  if (!data) return true;
  const r = data.repeatEnd;
  if (r === undefined || r === null) return true;
  if (r === true || r === 1 || r === '1') return true;
  if (r === false || r === 0 || r === '0') return false;
  return true;
}

function pushHistorico(array, item) {
  array.unshift(item);
  if (array.length > HISTORICO_LIMITE) array.length = HISTORICO_LIMITE;
}

// 🔥 FIX v7: Extractor robusto de viewers
function extraerViewers(data) {
  if (!data) return 0;

  const candidatos = [
    data.viewerCount,
    data.viewer_count,
    data.total,
    data.totalUser,
    data.totalUserCount,
    data.total_user,
    data.total_user_count,
    data.onlineUserCount,
    data.online_user_count,
    data.roomUserSeq && data.roomUserSeq.total,
    data.roomUserSeq && data.roomUserSeq.totalUser,
    data.roomUserSeq && data.roomUserSeq.totalUserCount,
    data.stats && data.stats.totalUser,
    data.stats && data.stats.viewerCount,
    data.roomData && data.roomData.viewerCount,
    data.roomData && data.roomData.total
  ];

  for (const c of candidatos) {
    if (c === undefined || c === null || c === '') continue;
    const n = typeof c === 'number' ? c : parseInt(c, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────
// Estado agregado por fuente
// ─────────────────────────────────────────────────────────────

function crearEstadoAgregado() {
  return {
    diamantes: 0,
    likes: 0,
    espectadores: 0,
    follows: 0,
    shares: 0,
    subs: 0,
    miembros: 0,
    regalosRecibidos: 0,

    gifters: new Map(),
    likers: new Map(),
    sharers: new Map(),

    ultimosFollows: [],
    ultimosShares: [],
    ultimosGifts: [],
    ultimosSubs: [],
    ultimosMiembros: [],

    ultimaActualizacion: Date.now()
  };
}

function resumenEstadoAgregado(estado) {
  const topGifters = Array.from(estado.gifters.values())
    .sort((a, b) => b.diamantes - a.diamantes)
    .slice(0, TOP_LIMITE);

  const topLikers = Array.from(estado.likers.values())
    .sort((a, b) => b.likes - a.likes)
    .slice(0, TOP_LIMITE);

  const topSharers = Array.from(estado.sharers.values())
    .sort((a, b) => b.veces - a.veces)
    .slice(0, TOP_LIMITE);

  return {
    diamantes: estado.diamantes,
    likes: estado.likes,
    espectadores: estado.espectadores,
    follows: estado.follows,
    shares: estado.shares,
    subs: estado.subs,
    miembros: estado.miembros,
    regalosRecibidos: estado.regalosRecibidos,
    topGifters,
    topLikers,
    topSharers,
    ultimosFollows: estado.ultimosFollows,
    ultimosShares: estado.ultimosShares,
    ultimosGifts: estado.ultimosGifts,
    ultimosSubs: estado.ultimosSubs,
    ultimosMiembros: estado.ultimosMiembros,
    ultimaActualizacion: estado.ultimaActualizacion
  };
}

// ─────────────────────────────────────────────────────────────
// Clase principal
// ─────────────────────────────────────────────────────────────

class TikTokChat {
  constructor(opciones = {}) {
    this.onChat      = opciones.onChat      || (() => {});
    this.onLike      = opciones.onLike      || (() => {});
    this.onGift      = opciones.onGift      || (() => {});
    this.onFollow    = opciones.onFollow    || (() => {});
    this.onShare     = opciones.onShare     || (() => {});
    this.onSubscribe = opciones.onSubscribe || (() => {});
    this.onMember    = opciones.onMember    || (() => {});
    this.onRoomUser  = opciones.onRoomUser  || (() => {});
    this.onSocial    = opciones.onSocial    || (() => {});
    this.onStatus    = opciones.onStatus    || (() => {});
    this.onStats     = opciones.onStats     || (() => {});

    this.fuentes = new Map();
    this.iniciado = false;

    this.giftsPendientes = new Map();
    this.giftsEmitidos = new Map();
  }

  async iniciar() {
    if (this.iniciado) return true;
    const ok = await cargarModuloTikTok();
    this.iniciado = ok;
    return ok;
  }

  async setUsuarios(usuarios) {
    await this.iniciar();
    if (!TikTokLiveConnection) {
      writeLog('tiktok: ⚠️ No se puede setUsuarios sin el módulo cargado');
      return false;
    }

    const lista = Array.isArray(usuarios) ? usuarios : [];
    const deseados = new Set();

    for (const u of lista) {
      const limpio = typeof u === 'string' ? u.trim().replace(/^@/, '') : '';
      if (!limpio) continue;
      const clave = limpio.toLowerCase();
      deseados.add(clave);
      this._asegurarFuente(clave, limpio);
    }

    for (const [clave, fuente] of this.fuentes.entries()) {
      if (!deseados.has(clave)) {
        this._detenerFuente(fuente);
        this.fuentes.delete(clave);
        this.onStatus({ usuario: clave, estado: 'detenido' });
      }
    }

    return true;
  }

  detenerTodo() {
    for (const fuente of this.fuentes.values()) this._detenerFuente(fuente);
    this.fuentes.clear();

    for (const p of this.giftsPendientes.values()) {
      try { clearTimeout(p.timer); } catch {}
    }
    this.giftsPendientes.clear();
    this.giftsEmitidos.clear();
  }

  getStats(usuario) {
    const clave = String(usuario || '').trim().toLowerCase().replace(/^@/, '');
    const fuente = this.fuentes.get(clave);
    if (!fuente) return null;
    return resumenEstadoAgregado(fuente.stats);
  }

  getAllStats() {
    const salida = {};
    for (const [clave, fuente] of this.fuentes.entries()) {
      salida[clave] = resumenEstadoAgregado(fuente.stats);
    }
    return salida;
  }

  resetStats(usuario) {
    if (usuario) {
      const clave = String(usuario).trim().toLowerCase().replace(/^@/, '');
      const fuente = this.fuentes.get(clave);
      if (fuente) {
        fuente.stats = crearEstadoAgregado();
        this._emitirStats(fuente);
      }
    } else {
      for (const fuente of this.fuentes.values()) {
        fuente.stats = crearEstadoAgregado();
        this._emitirStats(fuente);
      }
    }
  }

  // ───────────────────────────────────────────────────────────
  // Internos
  // ───────────────────────────────────────────────────────────

  _asegurarFuente(clave, usernameMostrar) {
    let fuente = this.fuentes.get(clave);
    if (!fuente) {
      fuente = {
        clave,
        username: usernameMostrar,
        conexion: null,
        conectando: false,
        conectado: false,
        detenida: false,
        reintentoTimer: null,
        recent: new Map(),
        stats: crearEstadoAgregado()
      };
      this.fuentes.set(clave, fuente);
      this._conectarFuente(fuente);
    } else {
      fuente.detenida = false;
    }
  }

  _detenerFuente(fuente) {
    fuente.detenida = true;
    fuente.conectando = false;
    fuente.conectado = false;

    if (fuente.reintentoTimer) {
      clearTimeout(fuente.reintentoTimer);
      fuente.reintentoTimer = null;
    }

    for (const [clave, p] of this.giftsPendientes.entries()) {
      if (p.fuenteClave === fuente.clave) {
        try { clearTimeout(p.timer); } catch {}
        this.giftsPendientes.delete(clave);
      }
    }

    const conn = fuente.conexion;
    fuente.conexion = null;

    if (conn) {
      try { if (typeof conn.removeAllListeners === 'function') conn.removeAllListeners(); } catch {}
      try { if (typeof conn.disconnect === 'function') conn.disconnect(); } catch {}
    }
  }

  async _conectarFuente(fuente) {
    if (!fuente || fuente.detenida || fuente.conectado || fuente.conectando) return;

    fuente.conectando = true;
    try {
      const conn = new TikTokLiveConnection(fuente.username, {
        processInitialData: false
      });
      fuente.conexion = conn;

      this._registrarEventos(fuente, conn);

      await conn.connect();
      fuente.conectado = true;
      fuente.conectando = false;
      writeLog('tiktok: ✅ Conectado a ' + fuente.username);
      this.onStatus({ usuario: fuente.clave, estado: 'conectado' });
    } catch (err) {
      fuente.conectado = false;
      fuente.conectando = false;
      writeLog('tiktok: ❌ Fallo al conectar [' + fuente.clave + ']: ' + (err && err.message ? err.message : String(err)));
      this.onStatus({ usuario: fuente.clave, estado: 'error' });
      if (!fuente.detenida) this._programarReintento(fuente);
    }
  }

  _procesarGift(fuente, datos) {
    const { usuario, avatar, giftName, repeatCount, diamondUnit, diamantesTotales, giftId } = datos;

    const claveDedup = claveDedupGift(fuente.clave, usuario, giftName, repeatCount);
    const ahora = Date.now();
    const ultimo = this.giftsEmitidos.get(claveDedup) || 0;
    if (ahora - ultimo < VENTANA_DEDUP_GIFT_MS) {
      writeLog('tiktok: 🔁 [DEDUP] Regalo duplicado ignorado: ' + usuario + ' ' +
               giftName + ' x' + repeatCount + ' (hace ' + (ahora - ultimo) + 'ms)');
      return;
    }
    this.giftsEmitidos.set(claveDedup, ahora);

    if (this.giftsEmitidos.size > 500) {
      for (const [k, t] of this.giftsEmitidos) {
        if (ahora - t > VENTANA_DEDUP_GIFT_MS * 4) this.giftsEmitidos.delete(k);
      }
    }

    if (diamantesTotales > 0) {
      fuente.stats.diamantes += diamantesTotales;
      fuente.stats.regalosRecibidos += 1;
    }

    // 🔥 FIX v8: guardar avatar en gifters
    if (usuario && diamantesTotales > 0) {
      const actual = fuente.stats.gifters.get(usuario) || {
        username: usuario,
        diamantes: 0,
        regalos: 0,
        avatar: null
      };
      actual.diamantes += diamantesTotales;
      actual.regalos += 1;
      if (!actual.avatar && avatar) actual.avatar = avatar;
      fuente.stats.gifters.set(usuario, actual);
    }

    if (diamantesTotales > 0) {
      pushHistorico(fuente.stats.ultimosGifts, {
        username: usuario,
        avatar,
        giftName,
        repeatCount,
        diamantes: diamantesTotales,
        timestamp: Date.now()
      });
    }

    fuente.stats.ultimaActualizacion = Date.now();

    writeLog('tiktok: 🎁 [' + usuario + '] ' + giftName + ' x' + repeatCount +
             ' = ' + diamantesTotales + '💎');

    this.onGift({
      platform: 'tiktok',
      type: 'gift',
      username: usuario,
      user: usuario,
      avatar,
      giftId: giftId || null,
      giftName,
      repeatCount,
      giftRepeat: repeatCount,
      diamondUnit,
      giftDiamonds: diamondUnit,
      diamantesTotales,
      giftTotalDiamonds: diamantesTotales,
      esStreak: repeatCount > 1,
      esFinal: true,
      totalDiamantes: fuente.stats.diamantes,
      channel: fuente.username,
      timestamp: Date.now()
    });

    this._emitirStats(fuente);
  }

  _registrarEventos(fuente, conn) {
    // ─── CHAT ─────────────────────────────────────────────
    conn.on(nombreEvento('chat', 'chat'), (data) => {
      try {
        const usuario = extraerUsuario(data);
        const mensaje = extraerMensaje(data);
        if (!usuario || !mensaje) return;

        const clave = claveDedupChat(usuario, mensaje);
        if (clave) {
          limpiarDedupViejo(fuente.recent);
          const ultimo = fuente.recent.get(clave) || 0;
          if (Date.now() - ultimo < VENTANA_DEDUP_MS) return;
          fuente.recent.set(clave, Date.now());
        }

        writeLog('tiktok: 💬 [' + usuario + '] ' + mensaje);
        this.onChat({
          platform: 'tiktok', type: 'chat', username: usuario,
          avatar: extraerAvatar(data),
          message: mensaje, channel: fuente.username, timestamp: Date.now()
        });
      } catch (err) {
        writeLog('tiktok: ❌ Error chat: ' + (err && err.message ? err.message : String(err)));
      }
    });

    // ─── LIKES ────────────────────────────────────────────
    conn.on(nombreEvento('like', 'like'), (data) => {
      try {
        const usuario = extraerUsuario(data);
        const avatar = extraerAvatar(data);   // 🔥 FIX v8: extraer avatar
        const count = Number(data && (data.likeCount || data.count || 0)) || 0;
        const total = Number(data && data.totalLikeCount) || 0;

        if (total > 0) fuente.stats.likes = total;
        else fuente.stats.likes += count;
        fuente.stats.ultimaActualizacion = Date.now();

        // 🔥 FIX v8: guardar avatar en likers
        if (usuario && count > 0) {
          const actual = fuente.stats.likers.get(usuario) || {
            username: usuario,
            likes: 0,
            avatar: null
          };
          actual.likes += count;
          if (!actual.avatar && avatar) actual.avatar = avatar;
          fuente.stats.likers.set(usuario, actual);
        }

        this.onLike({
          platform: 'tiktok', type: 'like', username: usuario, avatar, count,
          total: fuente.stats.likes, channel: fuente.username, timestamp: Date.now()
        });
        this._emitirStats(fuente);
      } catch (err) {
        writeLog('tiktok: ❌ Error like: ' + (err && err.message ? err.message : String(err)));
      }
    });

    // ─── REGALOS ──────────────────────────────────────────
    conn.on(nombreEvento('gift', 'gift'), (data) => {
      try {
        const usuario = extraerUsuario(data);
        const avatar = extraerAvatar(data);
        const giftName = extraerNombreRegalo(data);
        const giftId = extraerGiftId(data);

        const repeatCount = Number(
          (data && data.repeatCount) ||
          (data && data.repeat_count) ||
          1
        ) || 1;

        const diamondUnit = extraerDiamanteUnitario(data);
        const diamantesTotales = diamondUnit * repeatCount;
        const final = esRepeatEnd(data);

        const clavePendiente = `${fuente.clave}|${usuario}|${giftName}`;
        const pendiente = this.giftsPendientes.get(clavePendiente);

        if (pendiente) {
          try { clearTimeout(pendiente.timer); } catch {}
          this.giftsPendientes.delete(clavePendiente);
        }

        if (final) {
          this._procesarGift(fuente, {
            usuario, avatar, giftName, giftId, repeatCount, diamondUnit, diamantesTotales
          });
        } else {
          writeLog('tiktok: 🎁 [' + usuario + '] ' + giftName + ' x' + repeatCount +
                   ' = ' + diamantesTotales + '💎 (pendiente, esperando final...)');

          const timer = setTimeout(() => {
            const p = this.giftsPendientes.get(clavePendiente);
            if (p) {
              this.giftsPendientes.delete(clavePendiente);
              writeLog('tiktok: ⏰ Timeout para [' + usuario + '] ' + giftName + ', emitiendo pendiente');
              this._procesarGift(fuente, p.datos);
            }
          }, GIFT_TIMEOUT_MS);

          this.giftsPendientes.set(clavePendiente, {
            timer,
            fuenteClave: fuente.clave,
            datos: { usuario, avatar, giftName, giftId, repeatCount, diamondUnit, diamantesTotales }
          });
        }
      } catch (err) {
        writeLog('tiktok: ❌ Error gift: ' + (err && err.message ? err.message : String(err)));
      }
    });

    // ─── FOLLOW ───────────────────────────────────────────
    conn.on(nombreEvento('follow', 'follow'), (data) => {
      try {
        const usuario = extraerUsuario(data);
        const avatar = extraerAvatar(data);
        fuente.stats.follows += 1;
        fuente.stats.ultimaActualizacion = Date.now();

        if (usuario) {
          pushHistorico(fuente.stats.ultimosFollows, {
            username: usuario,
            avatar,
            timestamp: Date.now()
          });
        }

        writeLog('tiktok: ❤️ NUEVO SEGUIDOR: ' + usuario);
        this.onFollow({
          platform: 'tiktok', type: 'follow', username: usuario, avatar,
          channel: fuente.username, timestamp: Date.now()
        });
        this._emitirStats(fuente);
      } catch (err) {
        writeLog('tiktok: ❌ Error follow: ' + (err && err.message ? err.message : String(err)));
      }
    });

    // ─── SHARE ────────────────────────────────────────────
    conn.on(nombreEvento('share', 'share'), (data) => {
      try {
        const usuario = extraerUsuario(data);
        const avatar = extraerAvatar(data);
        fuente.stats.shares += 1;
        fuente.stats.ultimaActualizacion = Date.now();

        // 🔥 FIX v8: guardar avatar en sharers
        if (usuario) {
          const actual = fuente.stats.sharers.get(usuario) || {
            username: usuario,
            veces: 0,
            avatar: null
          };
          actual.veces += 1;
          if (!actual.avatar && avatar) actual.avatar = avatar;
          fuente.stats.sharers.set(usuario, actual);

          pushHistorico(fuente.stats.ultimosShares, {
            username: usuario,
            avatar,
            timestamp: Date.now()
          });
        }

        writeLog('tiktok: 🔗 SHARE: ' + usuario);
        this.onShare({
          platform: 'tiktok', type: 'share', username: usuario, avatar,
          channel: fuente.username, timestamp: Date.now()
        });
        this._emitirStats(fuente);
      } catch (err) {
        writeLog('tiktok: ❌ Error share: ' + (err && err.message ? err.message : String(err)));
      }
    });

    // ─── SUBSCRIBE ────────────────────────────────────────
    conn.on(nombreEvento('subscribe', 'subscribe'), (data) => {
      try {
        const usuario = extraerUsuario(data);
        const avatar = extraerAvatar(data);
        fuente.stats.subs += 1;
        fuente.stats.ultimaActualizacion = Date.now();

        if (usuario) {
          pushHistorico(fuente.stats.ultimosSubs, {
            username: usuario,
            avatar,
            timestamp: Date.now()
          });
        }

        writeLog('tiktok: ⭐ SUBSCRIBE: ' + usuario);
        this.onSubscribe({
          platform: 'tiktok', type: 'subscribe', username: usuario, avatar,
          channel: fuente.username, timestamp: Date.now()
        });
        this._emitirStats(fuente);
      } catch (err) {
        writeLog('tiktok: ❌ Error subscribe: ' + (err && err.message ? err.message : String(err)));
      }
    });

    // ─── MEMBER (🌹 SE UNIÓ AL DIRECTO) ───────────────────
    conn.on(nombreEvento('member', 'member'), (data) => {
      try {
        const usuario = extraerUsuario(data);
        const avatar = extraerAvatar(data);
        fuente.stats.miembros += 1;
        fuente.stats.ultimaActualizacion = Date.now();

        if (usuario) {
          pushHistorico(fuente.stats.ultimosMiembros, {
            username: usuario,
            avatar,
            timestamp: Date.now()
          });
        }

        writeLog('tiktok: 🌹 SE UNIÓ AL DIRECTO: ' + usuario);

        this.onMember({
          platform: 'tiktok', type: 'member', username: usuario || 'Alguien', avatar,
          message: '🌹 ' + (usuario || 'Alguien') + ' se unió al directo',
          channel: fuente.username, timestamp: Date.now()
        });
        this._emitirStats(fuente);
      } catch (err) {
        writeLog('tiktok: ❌ Error member: ' + (err && err.message ? err.message : String(err)));
      }
    });

    // ─── ROOM USER (espectadores) ─────────────────────────
    conn.on(nombreEvento('roomUser', 'roomUser'), (data) => {
      try {
        const count = extraerViewers(data);

        if (data && typeof data === 'object') {
          const keys = Object.keys(data).slice(0, 15);
          writeLog('tiktok: 🔍 roomUser keys: ' + keys.join(', '));
          writeLog('tiktok: 🔍 roomUser valores: ' + JSON.stringify({
            viewerCount: data.viewerCount,
            viewer_count: data.viewer_count,
            total: data.total,
            totalUser: data.totalUser,
            totalUserCount: data.totalUserCount
          }));
        }

        if (count > 0) {
          fuente.stats.espectadores = count;
          fuente.stats.ultimaActualizacion = Date.now();

          writeLog('tiktok: 👁️ Viewers: ' + count);

          this.onRoomUser({
            platform: 'tiktok', type: 'roomUser', espectadores: count,
            channel: fuente.username, timestamp: Date.now()
          });
          this._emitirStats(fuente);
        } else {
          writeLog('tiktok: ⚠️ roomUser recibido pero sin conteo válido');
        }
      } catch (err) {
        writeLog('tiktok: ❌ Error roomUser: ' + (err && err.message ? err.message : String(err)));
      }
    });

    // ─── SOCIAL ───────────────────────────────────────────
    conn.on(nombreEvento('social', 'social'), (data) => {
      try {
        const usuario = extraerUsuario(data);
        const avatar = extraerAvatar(data);
        const tipo = (data && data.label) || (data && data.displayType) || 'social';
        writeLog('tiktok: 💫 SOCIAL [' + tipo + ']: ' + usuario);
        this.onSocial({
          platform: 'tiktok', type: 'social', subtipo: tipo,
          username: usuario, avatar, message: '💫 ' + (usuario || 'Alguien') + ' ' + tipo,
          channel: fuente.username, timestamp: Date.now()
        });
      } catch (err) {
        writeLog('tiktok: ❌ Error social: ' + (err && err.message ? err.message : String(err)));
      }
    });

    // ─── CICLO DE VIDA ────────────────────────────────────
    conn.on('disconnected', () => {
      fuente.conectado = false;
      fuente.conectando = false;
      writeLog('tiktok: 🔌 Desconectado de ' + fuente.username);
      this.onStatus({ usuario: fuente.clave, estado: 'desconectado' });
      if (!fuente.detenida) this._programarReintento(fuente);
    });

    conn.on('streamEnd', () => {
      fuente.conectado = false;
      fuente.conectando = false;
      writeLog('tiktok: 🔴 Stream terminado: ' + fuente.username);
      this.onStatus({ usuario: fuente.clave, estado: 'streamEnd' });
      if (!fuente.detenida) this._programarReintento(fuente);
    });

    conn.on('error', (err) => {
      fuente.conectado = false;
      fuente.conectando = false;
      writeLog('tiktok: ⚠️ Error de conexión [' + fuente.clave + ']: ' + (err && err.message ? err.message : String(err)));
      this.onStatus({ usuario: fuente.clave, estado: 'error' });
      if (!fuente.detenida) this._programarReintento(fuente);
    });
  }

  _emitirStats(fuente) {
    try {
      this.onStats({
        usuario: fuente.clave,
        stats: resumenEstadoAgregado(fuente.stats)
      });
    } catch {}
  }

  _programarReintento(fuente) {
    if (fuente.reintentoTimer || fuente.detenida) return;
    fuente.reintentoTimer = setTimeout(() => {
      fuente.reintentoTimer = null;
      if (fuente.detenida) return;
      writeLog('tiktok: 🔄 Reintentando conexión a ' + fuente.username + '...');
      this._conectarFuente(fuente);
    }, 5000);
  }
}

module.exports = { TikTokChat };