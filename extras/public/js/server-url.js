/* ================================================================
 * server-url.js — Versión mejorada para OBS + Chrome
 *
 * Calcula window.SERVER_BASE de forma robusta:
 *   1. Si la URL trae ?server=X&port=Y → usa eso (override manual).
 *   2. Si no, usa el host desde el que se cargó el overlay.
 *      - Convierte "localhost" a "127.0.0.1" (OBS tiene problemas con ::1)
 *      - Detecta si la página se cargó por file:// y cae a localhost:3000
 *   3. Si nada funciona → http://127.0.0.1:3000
 *
 * Uso en overlays:
 *   <script src="/js/server-url.js"></script>
 *   → window.SERVER_BASE, window.SERVER_IP, window.SERVER_PORT
 * ================================================================ */

(function () {
  'use strict';

  var logPrefix = '🌐 [server-url]';

  function safeLog(msg) {
    try { console.log(logPrefix, msg); } catch (e) {}
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
  var originHost = '';
  var originPort = '';
  var originProto = 'http:';

  try {
    var loc = window.location;
    originProto = loc.protocol || 'http:';

    // file:// → no sirve el origin, forzamos localhost
    if (loc.protocol === 'file:') {
      originHost = '127.0.0.1';
      originPort = '3000';
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
    originHost = '127.0.0.1';
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

  // ─── 5) Exponer globalmente ───
  window.SERVER_IP   = SERVER_IP;
  window.SERVER_PORT = SERVER_PORT;
  window.SERVER_BASE = SERVER_BASE;

  // ─── 6) Log ───
  safeLog('SERVER_BASE =', SERVER_BASE);
  safeLog('  origen original:', originProto + '//' + originHost + ':' + originPort);
  safeLog('  override manual:', paramServer ? 'SÍ (' + paramServer + ':' + paramPort + ')' : 'no');
})();