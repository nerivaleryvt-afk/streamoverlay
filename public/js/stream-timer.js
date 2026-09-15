/* ============================================
   STREAM TIMER — Vista real (Paso 3B)
   Se conecta al server por socket.io y escucha
   el evento 'timer-update' que llega cada 1s.
   ============================================ */

(function () {
  'use strict';

  // --- Referencias al DOM ---
  const pill      = document.getElementById('timerPill');
  const display   = document.getElementById('timerDisplay');
  const statusEl  = document.getElementById('timerStatus');
  const addedEl   = document.getElementById('timerAdded');

  // --- Color por defecto (el server lo pisa después) ---
  aplicarColor('#e8825a');

  // --- Formatear ms a "HH:MM:SS" ---
  function formatear(ms) {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return (
      String(h).padStart(2, '0') + ':' +
      String(m).padStart(2, '0') + ':' +
      String(s).padStart(2, '0')
    );
  }

  // --- Formatear segundos a "+Xh Ym" ---
  function formatearSumado(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return '+ ' + h + 'h ' + m + 'm';
    return '+ ' + m + 'm';
  }

  // --- Aplicar color de acento al CSS ---
  function aplicarColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    const root = document.documentElement;
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-soft', `rgba(${r},${g},${b},0.20)`);
    root.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.40)`);
  }

  // --- Pintar el estado en pantalla ---
  // Recibe un objeto con: restanteMs, modo, sumadoSec
  function render(data) {
    const restanteMs = data.restanteMs || 0;
    const sumadoSec  = data.sumadoSec  || 0;
    const modo       = data.modo       || 'paused';

    display.textContent = formatear(restanteMs);
    addedEl.textContent = 'EL CHAT SUMÓ ' + formatearSumado(sumadoSec);

    // Limpiar clases de estado
    pill.classList.remove('is-live', 'is-paused', 'is-done');

    // Aplicar la correcta
    if (modo === 'done') {
      pill.classList.add('is-done');
      statusEl.textContent = 'META CUMPLIDA';
    } else if (modo === 'paused') {
      pill.classList.add('is-paused');
      statusEl.textContent = 'EN PAUSA';
    } else {
      pill.classList.add('is-live');
      statusEl.textContent = 'EN VIVO';
    }
  }

  // --- Pintado inicial (todo en cero / pausado) ---
  render({ restanteMs: 0, sumadoSec: 0, modo: 'paused' });

  // --- Conectar al server ---
  const socket = io();

  // Cuando llega un update del timer, repintamos
  socket.on('timer-update', function (data) {
    render(data);
  });

  // Cuando el server confirma la conexión, pedimos color
  socket.on('connect', function () {
    console.log('⏱️ Timer conectado al server');
    fetch('/get-config')
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (cfg && cfg.TIMER_COLOR) {
          aplicarColor(cfg.TIMER_COLOR);
        }
      })
      .catch(function (e) {
        console.warn('⚠️ No pude leer /get-config:', e.message);
      });
  });

})();