/* ═══════════════════════════════════════════════════════════════
   shared.js — Helpers compartidos entre todas las páginas
   Expone: window.Togi
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // Evita doble carga
  if (window.Togi) return;

  const Togi = {};

  /* ──────────────────────────────────────────────
     escapeHtml(str)
     Escapa caracteres peligrosos para HTML.
     ────────────────────────────────────────────── */
  Togi.escapeHtml = function (s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[c]);
  };

  /* ──────────────────────────────────────────────
     copiarAlPortapapeles(texto)
     Prueba 3 métodos en cascada:
       1. Electron clipboard (si está disponible)
       2. navigator.clipboard (si el navegador lo permite)
       3. textarea + execCommand (fallback universal)
     Devuelve Promise<boolean>
     ────────────────────────────────────────────── */
  Togi.copiarAlPortapapeles = async function (texto) {
    if (texto === undefined || texto === null || texto === '') return false;
    const str = String(texto);

    // 1) Electron nativo
    try {
      const electron = require('electron');
      if (electron && electron.clipboard && typeof electron.clipboard.writeText === 'function') {
        electron.clipboard.writeText(str);
        return true;
      }
    } catch (e) { /* no estamos en electron o no expone clipboard */ }

    // 2) navigator.clipboard
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(str);
        return true;
      }
    } catch (e) { /* permisos o contexto no seguro */ }

    // 3) Fallback clásico
    try {
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  };

  /* ──────────────────────────────────────────────
     showToast(msg, opts)
     Notificación flotante arriba a la derecha.
     opts: { type: 'ok'|'error'|'warn'|'info', duration: ms }
     Requiere que exista (o crea) el contenedor #togi-toast-host.
     ────────────────────────────────────────────── */
  Togi.showToast = function (msg, opts) {
    opts = opts || {};
    const type = opts.type || 'ok';
    const duration = opts.duration || 2600;

    let host = document.getElementById('togi-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'togi-toast-host';
      host.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
      `;
      document.body.appendChild(host);
    }

    const colors = {
      ok:    { border: '#6dd58c', icon: 'ri-checkbox-circle-fill' },
      error: { border: '#e56969', icon: 'ri-close-circle-fill' },
      warn:  { border: '#e8b54d', icon: 'ri-error-warning-fill' },
      info:  { border: '#6da4e5', icon: 'ri-information-fill' }
    };
    const c = colors[type] || colors.ok;

    const toast = document.createElement('div');
    toast.style.cssText = `
      pointer-events: auto;
      background: var(--surface-2, #1c1b23);
      border: 1px solid var(--line, #26242e);
      border-left: 3px solid ${c.border};
      color: var(--text, #e8e6f0);
      padding: 12px 16px;
      border-radius: 7px;
      font-family: 'Satoshi', -apple-system, sans-serif;
      font-size: 12.5px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
      transform: translateX(120%);
      transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.28s;
      opacity: 0;
      max-width: 340px;
    `;

    const icon = document.createElement('i');
    icon.className = c.icon;
    icon.style.cssText = `color: ${c.border}; font-size: 16px; flex-shrink: 0;`;

    const text = document.createElement('span');
    text.textContent = String(msg || '');

    toast.appendChild(icon);
    toast.appendChild(text);
    host.appendChild(toast);

    // Forzar layout + animar entrada
    void toast.offsetHeight;
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(0)';
      toast.style.opacity = '1';
    });

    // Auto-cierre
    const close = () => {
      toast.style.transform = 'translateX(120%)';
      toast.style.opacity = '0';
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    };

    setTimeout(close, duration);
    toast.addEventListener('click', close);
  };

  /* ──────────────────────────────────────────────
     formatNumber(n)
     1234 → '1.2k', 1500000 → '1.5M'
     ────────────────────────────────────────────── */
  Togi.formatNumber = function (n) {
    const num = Number(n) || 0;
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (num >= 1000)    return (num / 1000).toFixed(1).replace('.0', '') + 'k';
    return String(num);
  };

  /* ──────────────────────────────────────────────
     formatTime(date)
     Devuelve HH:MM
     ────────────────────────────────────────────── */
  Togi.formatTime = function (date) {
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  };

  /* ──────────────────────────────────────────────
     debounce(fn, wait)
     ────────────────────────────────────────────── */
  Togi.debounce = function (fn, wait) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait || 200);
    };
  };

  /* ──────────────────────────────────────────────
     throttle(fn, wait)
     ────────────────────────────────────────────── */
  Togi.throttle = function (fn, wait) {
    let last = 0;
    return function (...args) {
      const now = Date.now();
      if (now - last < wait) return;
      last = now;
      fn.apply(this, args);
    };
  };

  /* ──────────────────────────────────────────────
     copyAndFeedback(btn, texto)
     Copia y muestra feedback visual en un botón.
     El botón debe tener un <i> dentro.
     ────────────────────────────────────────────── */
  Togi.copyAndFeedback = async function (btn, texto) {
    if (!btn) return false;
    const ok = await Togi.copiarAlPortapapeles(texto);
    const original = btn.innerHTML;
    btn.innerHTML = ok
      ? '<i class="ri-check-line"></i> ok'
      : '<i class="ri-close-line"></i> error';
    btn.style.color = ok ? 'var(--ok, #6dd58c)' : 'var(--err, #e56969)';
    setTimeout(() => {
      btn.innerHTML = original;
      btn.style.color = '';
    }, 1400);
    return ok;
  };

  // Exponer global
  window.Togi = Togi;

  console.log('🔗 shared.js cargado · window.Togi disponible');
})();