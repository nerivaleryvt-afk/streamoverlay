/* ================================================================
 * server-url.js
 * Calcula la URL del servidor (SERVER_BASE) para los overlays.
 *
 * Reglas (en orden de prioridad):
 *   1. Si la URL trae ?server=X&port=Y → se usa eso. (override manual)
 *   2. Si no, se usa el host desde el que se cargó el overlay.
 *      Ej: si abres http://192.168.1.42:3000/overlay → usa 192.168.1.42:3000
 *      Ej: si abres http://localhost:3000/overlay    → usa localhost:3000
 *   3. Si nada de lo anterior funciona → localhost:3000.
 *
 * Uso en cada overlay:
 *   <script src="/js/server-url.js"></script>
 *   ... y luego usar window.SERVER_BASE
 * ================================================================ */

(function () {
  const params = new URLSearchParams(window.location.search);

  // 1) Override manual por URL
  const paramServer = params.get('server');
  const paramPort = params.get('port');

  // 2) Host desde el que se cargó la página
  let originHost = 'localhost';
  let originPort = 3000;
  try {
    const o = new URL(window.location.origin);
    originHost = o.hostname || 'localhost';
    originPort = o.port || 3000;
  } catch (e) {
    // Fallback silencioso
  }

  const SERVER_IP   = paramServer || originHost;
  const SERVER_PORT = paramPort   || originPort;
  const SERVER_BASE = `http://${SERVER_IP}:${SERVER_PORT}`;

  // Exponer globalmente
  window.SERVER_IP   = SERVER_IP;
  window.SERVER_PORT = SERVER_PORT;
  window.SERVER_BASE = SERVER_BASE;

  // Log para depurar
  console.log(`🌐 server-url.js → ${SERVER_BASE}` +
    (paramServer ? ' (override por ?server=)' : ' (autodetectado)'));
})();