/* ================================================================
 * server-url.js — Versión mejorada para OBS + Chrome + Electron
 * v1.4.7 — Fix: file:// ahora fuerza http:// (antes generaba
 *          "file://127.0.0.1:3000" → 404 en TODO)
 *
 * Calcula window.SERVER_BASE de forma robusta:
 *   1. Si la URL trae ?server=X&port=Y → usa eso (override manual).
 *   2. Si no, usa el host desde el que se cargó el overlay.
 *      - Convierte "localhost" a "127.0.0.1" (OBS tiene problemas con ::1)
 *      - Detecta si la página se cargó por file:// y cae a http://127.0.0.1:3000
 *   3. Si nada funciona → http://127.0.0.1:3000
 *
 * Uso en overlays:
 *   <script src="/js/server-url.js"></script>
 *   → window.SERVER_BASE, window.SERVER_IP, window.SERVER_PORT
 * ================================================================ */

(function () {
  'use strict';

  var logPrefix = '🌐 [server-url]';

  function safeLog() {
    try { console.log.apply(console, [logPrefix].concat(Array.prototype.slice.call(arguments))); } catch (e) {}
  }

  // ─── 1) Override por querystring ───
  var params;
  try {
    params = new URLSearchParams(window.location.search || '');
  } catch (e) {
    params = { get: function () { return null; } };
  }

  var paramServer = params.get('server');
  var paramPort   = params.get('port');

  // ─── 2) Detectar host de origen ───
  var originHost  = '';
  var originPort  = '';
  var originProto = 'http:';

  try {
    var loc = window.location || {};
    originProto = loc.protocol || 'http:';

    // 🟢 file:// → no sirve el origin, forzamos http://127.0.0.1:3000
    if (loc.protocol === 'file:' || loc.protocol === 'chrome-extension:' || loc.protocol === 'about:') {
      originProto = 'http:';
      originHost  = '127.0.0.1';
      originPort  = '3000';
    } else {
      originHost = loc.hostname || '';
      originPort = loc.port || '';

      // Si no hay hostname (raro), forzamos localhost
      if (!originHost || originHost === 'null') {
        originHost = '127.0.0.1';
      }

      // Si no hay puerto, asumimos 3000 por defecto
      if (!originPort) {
        originPort = '3000';
      }
    }
  } catch (e) {
    originProto = 'http:';
    originHost  = '127.0.0.1';
    originPort  = '3000';
  }

  // 🛡️ Salvaguarda: si originProto no es http/https, forzar http
  if (originProto !== 'http:' && originProto !== 'https:') {
    originProto = 'http:';
  }

  // 🛡️ Salvaguarda: si el puerto no es numérico, forzar 3000
  if (!/^\d+$/.test(String(originPort))) {
    originPort = '3000';
  }

  // ─── 3) Normalizar "localhost" → "127.0.0.1" ───
  // OBS a veces resuelve "localhost" como ::1 (IPv6) y Node escucha en IPv4.
  // PERO en la página /config NO convertimos, porque Kick OAuth necesita
  // que redirect_uri use localhost tal cual.
  var hostNormalizado = originHost;
  var esPaginaConfig = (window.location.pathname === '/config');
  if (hostNormalizado === 'localhost' && !esPaginaConfig) {
    hostNormalizado = '127.0.0.1';
  }

  // ─── 4) Decidir valores finales ───
  var SERVER_IP   = paramServer || hostNormalizado;
  var SERVER_PORT = paramPort   || originPort;
  var SERVER_BASE = originProto + '//' + SERVER_IP + ':' + SERVER_PORT;

  // 🛡️ Salvaguarda final: si por algún motivo SERVER_BASE no arranca con
  // http:// o https://, forzamos el default absoluto.
  if (!/^https?:\/\//i.test(SERVER_BASE)) {
    SERVER_IP   = '127.0.0.1';
    SERVER_PORT = '3000';
    SERVER_BASE = 'http://127.0.0.1:3000';
  }

  // ─── 5) Exponer globalmente ───
  window.SERVER_IP   = SERVER_IP;
  window.SERVER_PORT = SERVER_PORT;
  window.SERVER_BASE = SERVER_BASE;

  // ─── 6) Log ───
  safeLog('SERVER_BASE =', SERVER_BASE);
  safeLog('  origen original:', originProto + '//' + originHost + ':' + originPort);
  safeLog('  override manual:', paramServer ? ('SÍ (' + paramServer + ':' + paramPort + ')') : 'no');
})();