// ============================================================
// autostream.js — Panel Auto-Stream TikTok (v5 · Toki)
// Proxy con reconexión automática (sin renovación por timer)
// ============================================================

(function () {
  'use strict';

  let accounts = [];
  let selectedToken = null;
  let statusInterval = null;
  let lastState = 'idle';
  let obsInterval = null;
    // ✨ Claves de localStorage para persistir la elección del usuario
  const AS_LS_KEY = 'autostream:selectedToken';
  const AS_LS_KEY_TITLE = 'autostream:title';

  // ============================================================
  // 📋 COPIAR AL PORTAPAPELES (3 métodos en cascada)
  // ============================================================
  async function copiarAlPortapapeles(texto) {
    if (!texto) return false;
    try {
      const electron = require('electron');
      if (electron && electron.clipboard && typeof electron.clipboard.writeText === 'function') {
        electron.clipboard.writeText(String(texto));
        return true;
      }
    } catch (e) {}
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(String(texto));
        return true;
      }
    } catch (e) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = String(texto);
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
    } catch (e) { return false; }
  }

  // ============================================================
  // 🎨 CSS — Toki Broadcast Console
  // Acento: lima (#b8ff00). Secundario: rosa. Info: cian.
  // ============================================================
  function injectStyles() {
    if (document.getElementById('autostream-styles')) return;
    const style = document.createElement('style');
    style.id = 'autostream-styles';
    style.textContent = `
      /* Tokens locales del panel */
      #autostream-panel {
        --as-accent:        #b8ff00;
        --as-accent-hover:  #a3e600;
        --as-accent-soft:   rgba(184, 255, 0, 0.12);
        --as-accent-border: rgba(184, 255, 0, 0.35);

        --as-pink:        #ff0080;
        --as-pink-soft:   rgba(255, 0, 128, 0.12);
        --as-pink-border: rgba(255, 0, 128, 0.35);

        --as-cyan:        #00d9ff;
        --as-cyan-soft:   rgba(0, 217, 255, 0.10);
        --as-cyan-border: rgba(0, 217, 255, 0.35);

        --as-surface:   #0e0e15;
        --as-surface-2: #12121b;
        --as-surface-3: #181824;
        --as-line:      rgba(255, 255, 255, 0.06);
        --as-line-strong: rgba(255, 255, 255, 0.12);

        --as-text:   #f0edf9;
        --as-text-2: #a8a4b8;
        --as-text-3: #6f6c80;

        --as-ok:   #b8ff00;
        --as-warn: #fbbf24;
        --as-err:  #f87171;

        position: relative;
        background:
          radial-gradient(ellipse at top left, rgba(184,255,0,0.04), transparent 45%),
          radial-gradient(ellipse at bottom right, rgba(255,0,128,0.03), transparent 50%),
          var(--as-surface);
        border: 1px solid var(--as-line);
        border-radius: 16px;
        padding: 22px 24px 24px;
        margin-bottom: 22px;
        display: none;
        overflow: hidden;
        font-family: 'Satoshi', system-ui, sans-serif;
        color: var(--as-text);
      }
      #autostream-panel.open { display: block; animation: asPanelIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
      @keyframes asPanelIn {
        from { opacity: 0; transform: translateY(-6px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      /* Borde superior = barra de estado */
      #autostream-panel::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 3px;
        background: linear-gradient(90deg, transparent, var(--as-line-strong), transparent);
        transition: background 0.3s ease;
      }
      #autostream-panel[data-status="streaming"]::before {
        background: linear-gradient(90deg, transparent, var(--as-accent), var(--as-pink), transparent);
        opacity: 0.9;
      }
      #autostream-panel[data-status="waiting"]::before {
        background: linear-gradient(90deg, transparent, var(--as-warn), transparent);
      }
      #autostream-panel[data-status="error"]::before {
        background: linear-gradient(90deg, transparent, var(--as-err), transparent);
      }

      /* ─── HEADER ─── */
      #autostream-panel .as-head {
        display: flex; align-items: center; gap: 14px;
        margin-bottom: 22px;
        padding-bottom: 18px;
        border-bottom: 1px solid var(--as-line);
      }
      #autostream-panel .as-head-icon {
        width: 44px; height: 44px; border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        background: var(--as-surface-3);
        border: 1px solid var(--as-line-strong);
        color: var(--as-accent);
        font-size: 22px;
        flex-shrink: 0;
        transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      #autostream-panel[data-status="streaming"] .as-head-icon {
        background: linear-gradient(135deg, var(--as-accent) 0%, #8ce600 100%);
        color: #07070c;
        border-color: transparent;
        box-shadow: 0 0 0 4px var(--as-accent-soft), 0 4px 16px rgba(184, 255, 0, 0.35);
        transform: rotate(-3deg);
      }
      #autostream-panel .as-head-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
      #autostream-panel .as-head-title {
        font-size: 16px; font-weight: 800; color: var(--as-text);
        letter-spacing: -0.02em;
      }
      #autostream-panel .as-head-sub {
        font-size: 11px; color: var(--as-text-3);
        font-family: 'JetBrains Mono', monospace;
        letter-spacing: -0.01em;
      }
      #autostream-panel .as-head-badge {
        font-size: 10.5px; font-weight: 700;
        padding: 6px 12px; border-radius: 999px;
        background: var(--as-surface-3);
        color: var(--as-text-2);
        border: 1px solid var(--as-line-strong);
        display: inline-flex; align-items: center; gap: 7px;
        text-transform: uppercase; letter-spacing: 0.1em;
        font-family: 'JetBrains Mono', monospace;
        transition: all 0.3s ease;
        flex-shrink: 0;
      }
      #autostream-panel .as-head-badge .badge-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: currentColor;
      }
      #autostream-panel .as-head-badge.waiting {
        color: var(--as-warn);
        border-color: rgba(251, 191, 36, 0.35);
        background: rgba(251, 191, 36, 0.08);
      }
      #autostream-panel .as-head-badge.streaming {
        color: var(--as-accent);
        border-color: var(--as-accent-border);
        background: var(--as-accent-soft);
      }
      #autostream-panel .as-head-badge.streaming .badge-dot {
        animation: asDotPulse 1.6s ease-in-out infinite;
        box-shadow: 0 0 8px currentColor;
      }
      #autostream-panel .as-head-badge.error {
        color: var(--as-err);
        border-color: rgba(248, 113, 113, 0.35);
        background: rgba(248, 113, 113, 0.08);
      }
      @keyframes asDotPulse {
        0%, 100% { opacity: 1; }
        50%      { opacity: 0.35; }
      }

      /* ─── GRID ─── */
      .as-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 20px;
      }
      @media (max-width: 900px) { .as-grid { grid-template-columns: 1fr; } }
      .as-col { display: flex; flex-direction: column; gap: 14px; }

      /* ─── PASOS GUIADOS ─── */
      .as-step {
        background: linear-gradient(180deg, var(--as-surface-2) 0%, #0a0a10 100%);
        border: 1px solid var(--as-line);
        border-radius: 12px;
        padding: 16px 18px 18px;
        transition: all 0.25s ease;
        position: relative;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
      }
      .as-step:hover {
        border-color: var(--as-line-strong);
        transform: translateY(-1px);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 16px rgba(0,0,0,0.2);
      }
      .as-step.done {
        border-color: var(--as-accent-border);
        background: linear-gradient(180deg, rgba(184,255,0,0.03) 0%, #0a0a10 100%);
      }

      .as-step-head {
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 12px;
      }
      .as-step-num {
        width: 24px; height: 24px; border-radius: 50%;
        background: var(--as-surface-3);
        border: 1px solid var(--as-line-strong);
        color: var(--as-text-3);
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 800;
        font-family: 'JetBrains Mono', monospace;
        flex-shrink: 0;
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .as-step.done .as-step-num {
        background: linear-gradient(135deg, var(--as-accent) 0%, #8ce600 100%);
        color: #07070c;
        border-color: transparent;
        box-shadow: 0 0 12px rgba(184, 255, 0, 0.35);
        transform: scale(1.05);
      }
      .as-step.done .as-step-num::before {
        content: '✓';
        font-size: 13px;
        font-weight: 900;
      }
      .as-step.done .as-step-num > span { display: none; }

      .as-step-title {
        font-size: 11.5px; font-weight: 800;
        color: var(--as-text);
        text-transform: uppercase; letter-spacing: 0.08em;
      }
      .as-step-hint {
        font-size: 11px; color: var(--as-text-3);
        margin-left: auto;
        font-family: 'JetBrains Mono', monospace;
      }

      /* ─── INPUTS ─── */
      #autostream-panel input[type="text"],
      #autostream-panel select {
        width: 100%;
        background: var(--as-surface);
        border: 1px solid var(--as-line);
        border-radius: 9px;
        padding: 11px 13px;
        color: var(--as-text);
        font-size: 12.5px;
        font-family: inherit;
        outline: none;
        transition: all 0.18s ease;
      }
      #autostream-panel input[type="text"]:hover,
      #autostream-panel select:hover {
        border-color: var(--as-line-strong);
      }
      #autostream-panel input[type="text"]:focus,
      #autostream-panel select:focus {
        border-color: var(--as-accent);
        background: var(--as-surface-2);
        box-shadow: 0 0 0 3px var(--as-accent-soft);
      }
      #autostream-panel input::placeholder { color: var(--as-text-3); }
      #autostream-panel select option { background: var(--as-surface-2); color: var(--as-text); }
      #autostream-panel select option:disabled {
        color: var(--as-text-3);
        opacity: 0.7;
        font-style: italic;
      }

      /* ─── BOTONES ─── */
      .as-btn {
        display: inline-flex; align-items: center; justify-content: center;
        gap: 8px; padding: 12px 16px;
        border-radius: 10px;
        font-weight: 700; font-size: 12.5px; cursor: pointer;
        font-family: inherit;
        transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
        border: 1px solid transparent;
        letter-spacing: -0.005em;
        position: relative;
        overflow: hidden;
      }
      .as-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .as-btn i { font-size: 15px; }

      /* Primario: gradiente lima */
      .as-btn-primary {
        background: linear-gradient(135deg, var(--as-accent) 0%, #8ce600 100%);
        color: #07070c;
        border-color: transparent;
        box-shadow: 0 2px 12px rgba(184, 255, 0, 0.25);
      }
      .as-btn-primary:hover:not(:disabled) {
        box-shadow: 0 4px 20px rgba(184, 255, 0, 0.4);
        transform: translateY(-1px);
      }
      .as-btn-primary:active:not(:disabled) {
        transform: translateY(1px);
        box-shadow: 0 1px 6px rgba(184, 255, 0, 0.3);
      }

      /* Peligro: outline rojo */
      .as-btn-danger {
        background: transparent;
        color: var(--as-err);
        border-color: rgba(248, 113, 113, 0.3);
      }
      .as-btn-danger:hover:not(:disabled) {
        background: rgba(248, 113, 113, 0.08);
        border-color: rgba(248, 113, 113, 0.55);
        transform: translateY(-1px);
      }

      /* Warning: outline ámbar */
      .as-btn-warning {
        background: transparent;
        color: var(--as-warn);
        border-color: rgba(251, 191, 36, 0.3);
      }
      .as-btn-warning:hover:not(:disabled) {
        background: rgba(251, 191, 36, 0.08);
        border-color: rgba(251, 191, 36, 0.55);
        transform: translateY(-1px);
      }

      .as-row-actions {
        display: grid; grid-template-columns: 2fr 1fr; gap: 8px;
      }

      /* ─── PANEL OBS ─── */
      .as-obs-panel {
        background: linear-gradient(180deg, var(--as-surface-2) 0%, #0a0a10 100%);
        border: 1px solid var(--as-line);
        border-radius: 12px;
        overflow: hidden;
        transition: all 0.2s ease;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
      }
      .as-obs-panel[open] {
        border-color: var(--as-line-strong);
      }
      .as-obs-panel summary {
        list-style: none;
        padding: 14px 16px;
        cursor: pointer;
        display: flex; align-items: center; gap: 10px;
        font-size: 11.5px; font-weight: 800;
        color: var(--as-text);
        text-transform: uppercase; letter-spacing: 0.08em;
        user-select: none;
        transition: background 0.15s ease;
      }
      .as-obs-panel summary::-webkit-details-marker { display: none; }
      .as-obs-panel summary:hover { background: rgba(255,255,255,0.02); }
      .as-obs-panel summary > i:first-child {
        color: var(--as-accent);
        font-size: 16px;
      }
      .as-obs-panel summary .caret {
        margin-left: auto; font-size: 15px;
        transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        color: var(--as-text-3);
      }
      .as-obs-panel[open] summary .caret { transform: rotate(180deg); color: var(--as-accent); }
      .as-obs-body {
        padding: 4px 16px 16px;
        display: flex; flex-direction: column; gap: 12px;
        animation: asSlideIn 0.25s ease;
      }
      @keyframes asSlideIn {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      /* ─── FILAS OBS ─── */
      .as-obs-row { display: flex; flex-direction: column; gap: 6px; }
      .as-obs-key {
        font-size: 10px; color: var(--as-text-3);
        text-transform: uppercase; letter-spacing: 0.1em;
        font-weight: 800;
        font-family: 'JetBrains Mono', monospace;
      }
      .as-obs-val {
        font-family: 'JetBrains Mono', monospace;
        font-size: 11.5px; color: var(--as-text);
        background: var(--as-surface);
        border: 1px solid var(--as-line);
        padding: 10px 12px;
        border-radius: 8px;
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px;
        transition: border-color 0.15s ease;
      }
      .as-obs-val:hover { border-color: var(--as-line-strong); }
      .as-obs-val > span {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        flex: 1;
        color: var(--as-text-2);
      }
      .as-copy-btn {
        background: transparent;
        border: 1px solid var(--as-line-strong);
        color: var(--as-text-3);
        border-radius: 6px;
        padding: 4px 9px;
        font-size: 10px; cursor: pointer;
        flex-shrink: 0;
        font-family: 'JetBrains Mono', monospace;
        font-weight: 700;
        transition: all 0.15s ease;
        display: inline-flex; align-items: center; gap: 4px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .as-copy-btn:hover {
        color: var(--as-accent);
        border-color: var(--as-accent-border);
        background: var(--as-accent-soft);
      }
      .as-copy-btn:active { transform: scale(0.95); }

      /* ─── QR ─── */
      .as-qr-row {
        display: flex; align-items: center; gap: 14px;
        padding: 14px;
        background: var(--as-surface);
        border: 1px solid var(--as-line);
        border-radius: 10px;
      }
      .as-qr-frame {
        background: #ffffff;
        border-radius: 8px;
        padding: 8px;
        flex-shrink: 0;
        line-height: 0;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: transform 0.2s ease;
      }
      .as-qr-frame:hover { transform: scale(1.03); }
      .as-qr-frame canvas { display: block; }
      .as-qr-hint {
        font-size: 11.5px; color: var(--as-text-2);
        line-height: 1.6;
      }
      .as-qr-hint b {
        color: var(--as-text);
        font-weight: 800;
        display: block;
        margin-bottom: 4px;
      }
      .as-qr-hint code {
        font-family: 'JetBrains Mono', monospace;
        font-size: 10.5px;
        color: var(--as-accent);
        background: var(--as-accent-soft);
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid var(--as-accent-border);
      }

      /* ─── STATUS BOX ─── */
      .as-status-box {
        display: flex; align-items: center; gap: 12px;
        padding: 13px 16px;
        border-radius: 11px;
        background: linear-gradient(180deg, var(--as-surface-2) 0%, #0a0a10 100%);
        border: 1px solid var(--as-line);
        font-size: 12.5px;
        transition: all 0.25s ease;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
      }
      .as-status-box .status-dot {
        width: 9px; height: 9px; border-radius: 50%;
        background: var(--as-text-3);
        flex-shrink: 0;
        transition: all 0.25s ease;
      }
      .as-status-box[data-state="waiting"] .status-dot {
        background: var(--as-warn);
        animation: asDotPulse 1.4s ease-in-out infinite;
        box-shadow: 0 0 8px var(--as-warn);
      }
      .as-status-box[data-state="streaming"] .status-dot {
        background: var(--as-accent);
        animation: asDotPulse 1.4s ease-in-out infinite;
        box-shadow: 0 0 10px var(--as-accent);
      }
      .as-status-box[data-state="error"] .status-dot {
        background: var(--as-err);
        box-shadow: 0 0 8px var(--as-err);
      }
      .as-status-box .status-label {
        color: var(--as-text-3); font-size: 10.5px;
        text-transform: uppercase; letter-spacing: 0.1em;
        font-weight: 800;
        font-family: 'JetBrains Mono', monospace;
      }
      .as-status-box .status-value {
        margin-left: auto;
        color: var(--as-text); font-weight: 800;
        font-size: 12.5px;
      }
      .as-status-box[data-state="streaming"] {
        border-color: var(--as-accent-border);
        background: linear-gradient(180deg, rgba(184,255,0,0.04) 0%, #0a0a10 100%);
      }
      .as-status-box[data-state="streaming"] .status-value { color: var(--as-accent); }
      .as-status-box[data-state="error"] {
        border-color: rgba(248,113,113,0.35);
      }
      .as-status-box[data-state="error"] .status-value { color: var(--as-err); }

      /* ─── ERROR ─── */
      .as-error {
        background: rgba(248, 113, 113, 0.06);
        border: 1px solid rgba(248, 113, 113, 0.3);
        border-left: 3px solid var(--as-err);
        border-radius: 10px;
        padding: 12px 14px;
        font-size: 12px; color: #f0b8b8;
        display: none; gap: 10px; align-items: flex-start;
        line-height: 1.55;
        animation: asSlideIn 0.25s ease;
      }
      .as-error.show { display: flex; }
      .as-error i {
        font-size: 16px; flex-shrink: 0; margin-top: 1px;
        color: var(--as-err);
      }

      /* ─── META ─── */
      .as-meta {
        font-size: 11px; color: var(--as-text-3);
        display: flex; gap: 16px; flex-wrap: wrap;
        padding: 8px 4px;
        font-family: 'JetBrains Mono', monospace;
      }
      .as-meta b { color: var(--as-text-2); font-weight: 700; }

      /* ─── HINT ─── */
      .as-hint {
        background: linear-gradient(180deg, var(--as-surface-2) 0%, #0a0a10 100%);
        border: 1px solid var(--as-line);
        border-left: 3px solid var(--as-cyan);
        border-radius: 10px;
        padding: 14px 16px;
        font-size: 11.5px;
        color: var(--as-text-2);
        line-height: 1.65;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
      }
      .as-hint b {
        color: var(--as-cyan);
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-size: 10.5px;
        font-family: 'JetBrains Mono', monospace;
      }

      /* ─── REFRESH BTN ─── */
      .as-refresh-btn {
        background: transparent;
        border: 1px solid var(--as-line);
        color: var(--as-text-3);
        padding: 5px 10px; border-radius: 6px;
        font-size: 10.5px; cursor: pointer;
        font-family: 'JetBrains Mono', monospace;
        font-weight: 800;
        display: inline-flex; align-items: center; gap: 5px;
        transition: all 0.15s ease;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .as-refresh-btn:hover {
        color: var(--as-accent);
        border-color: var(--as-accent-border);
        background: var(--as-accent-soft);
      }
      .as-refresh-btn.spinning i { animation: asSpin 0.8s linear infinite; }
      @keyframes asSpin { to { transform: rotate(360deg); } }

      /* ─── PROXY PILL ─── */
      .as-proxy-pill {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 10.5px;
        font-family: 'JetBrains Mono', monospace;
        font-weight: 800;
        color: var(--as-text-2);
        padding: 3px 9px;
        border-radius: 5px;
        background: var(--as-surface);
        border: 1px solid var(--as-line);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .as-proxy-pill::before {
        content: '';
        width: 5px; height: 5px; border-radius: 50%;
        background: var(--as-text-3);
      }
      .as-proxy-pill.ok::before {
        background: var(--as-accent);
        box-shadow: 0 0 6px var(--as-accent);
      }
      .as-proxy-pill.err::before {
        background: var(--as-err);
        box-shadow: 0 0 6px var(--as-err);
      }

      /* ─── ACCESIBILIDAD ─── */
      @media (prefers-reduced-motion: reduce) {
        #autostream-panel *,
        #autostream-panel *::before,
        #autostream-panel *::after {
          animation-duration: 0.01ms !important;
          transition-duration: 0.01ms !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // 🏗️ CONSTRUIR HTML DEL PANEL
  // ============================================================
  function buildPanel() {
    if (document.getElementById('autostream-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'autostream-panel';
    panel.setAttribute('data-status', 'idle');
    panel.innerHTML = `
      <div class="as-head">
        <div class="as-head-icon"><i class="ri-live-fill"></i></div>
        <div class="as-head-text">
          <div class="as-head-title">Auto-Stream TikTok</div>
          <div class="as-head-sub">streamlabs → proxy rtmp local</div>
        </div>
        <div class="as-head-badge idle" id="as-head-badge">
          <span class="badge-dot"></span>
          <span>detenido</span>
        </div>
      </div>

      <div class="as-grid">
        <!-- ══════════ COLUMNA IZQUIERDA: FLUJO ══════════ -->
        <div class="as-col">

          <!-- PASO 1 -->
          <div class="as-step" id="as-step-1">
            <div class="as-step-head">
              <div class="as-step-num"><span>1</span></div>
              <div class="as-step-title">Elegir cuenta</div>
              <button class="as-refresh-btn" id="as-refresh">
                <i class="ri-refresh-line"></i> REFRESCAR
              </button>
            </div>
            <select id="as-account"></select>
          </div>

          <!-- PASO 2 -->
          <div class="as-step" id="as-step-2">
            <div class="as-step-head">
              <div class="as-step-num"><span>2</span></div>
              <div class="as-step-title">Título del directo</div>
            </div>
            <input type="text" id="as-title" placeholder="Ej: Charlando con la comunidad" value="TogiPanel Stream">
          </div>

          <!-- PASO 3 -->
          <div class="as-step" id="as-step-3">
            <div class="as-step-head">
              <div class="as-step-num"><span>3</span></div>
              <div class="as-step-title">Iniciar transmisión</div>
            </div>
            <div class="as-row-actions">
              <button class="as-btn as-btn-primary" id="as-start">
                <i class="ri-play-fill"></i> INICIAR
              </button>
              <button class="as-btn as-btn-danger" id="as-stop" disabled>
                <i class="ri-stop-fill"></i> Detener
              </button>
            </div>
          </div>

          <div class="as-status-box" id="as-status-box" data-state="idle">
            <span class="status-dot"></span>
            <span class="status-label">estado</span>
            <span class="status-value" id="as-status">Detenido</span>
          </div>

          <div class="as-meta" id="as-meta" style="display:none;">
            <span><i class="ri-user-line"></i> <b id="as-username">—</b></span>
            <span id="as-reconnect-info" style="display:none;">recon. <b id="as-last-reconnect">—</b></span>
          </div>

          <div class="as-error" id="as-error">
            <i class="ri-error-warning-line"></i>
            <span id="as-error-text"></span>
          </div>
        </div>

        <!-- ══════════ COLUMNA DERECHA: CONFIG OBS ══════════ -->
        <div class="as-col">

          <!-- OBS panel: esta PC -->
          <details class="as-obs-panel" open>
            <summary>
              <i class="ri-computer-line"></i>
              <span>Configurar OBS · esta PC</span>
              <i class="ri-arrow-down-s-line caret"></i>
            </summary>
            <div class="as-obs-body">
              <div class="as-obs-row">
                <span class="as-obs-key">Servidor RTMP</span>
                <div class="as-obs-val">
                  <span>rtmp://localhost:1935/live</span>
                  <button class="as-copy-btn" data-copy="rtmp://localhost:1935/live">
                    <i class="ri-file-copy-line"></i> copiar
                  </button>
                </div>
              </div>
              <div class="as-obs-row">
                <span class="as-obs-key">Clave de retransmisión</span>
                <div class="as-obs-val">
                  <span>togipanel</span>
                  <button class="as-copy-btn" data-copy="togipanel">
                    <i class="ri-file-copy-line"></i> copiar
                  </button>
                </div>
              </div>
            </div>
          </details>

          <!-- OBS panel: otra PC -->
          <details class="as-obs-panel">
            <summary>
              <i class="ri-router-line"></i>
              <span>Configurar OBS · otra PC</span>
              <i class="ri-arrow-down-s-line caret"></i>
            </summary>
            <div class="as-obs-body">
              <div class="as-obs-row">
                <span class="as-obs-key">Servidor RTMP (LAN)</span>
                <div class="as-obs-val">
                  <span id="as-lan-url">rtmp://…:1935/live</span>
                  <button class="as-copy-btn" id="as-copy-lan-url" data-copy="">
                    <i class="ri-file-copy-line"></i> copiar
                  </button>
                </div>
              </div>
              <div class="as-obs-row">
                <span class="as-obs-key">Clave de retransmisión</span>
                <div class="as-obs-val">
                  <span id="as-lan-key">togipanel</span>
                  <button class="as-copy-btn" id="as-copy-lan-key" data-copy="togipanel">
                    <i class="ri-file-copy-line"></i> copiar
                  </button>
                </div>
              </div>

              <div class="as-qr-row">
                <div class="as-qr-frame">
                  <canvas id="as-qr" width="110" height="110"></canvas>
                </div>
                <div class="as-qr-hint">
                  <b>Escanea desde el móvil</b>
                  o copia la URL a OBS en la PC 2.
                </div>
              </div>

              <div class="as-meta">
                <span>proxy <span class="as-proxy-pill" id="as-proxy-pill">—</span></span>
              </div>
            </div>
          </details>

          <!-- Info importante -->
          <div class="as-hint">
            <b>Requisito:</b> Streamlabs Desktop instalado y al menos una cuenta
            de TikTok logueada. No hace falta tenerlo abierto mientras emites.
            Si una cuenta aparece inválida, vuelve a loguearte en Streamlabs.
          </div>
        </div>
      </div>
    `;

    document.querySelector('main.main-content').insertBefore(
      panel,
      document.getElementById('section-overview')
    );

    document.getElementById('as-refresh').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      btn.classList.add('spinning');
      loadAccounts().finally(() => {
        setTimeout(() => btn.classList.remove('spinning'), 400);
      });
    });
    document.getElementById('as-start').addEventListener('click', startStream);
    document.getElementById('as-stop').addEventListener('click', stopStream);

        // ✨ Al cambiar de cuenta, guardar en localStorage
    document.getElementById('as-account').addEventListener('change', (e) => {
      selectedToken = e.target.value;
      try {
        if (selectedToken) {
          localStorage.setItem(AS_LS_KEY, selectedToken);
          console.log('💾 Cuenta guardada:', selectedToken.slice(0, 20) + '...');
        }
      } catch (err) {}
      updateSteps();
    });

    // ✨ Al escribir título, guardar en localStorage
    document.getElementById('as-title').addEventListener('input', (e) => {
      try { localStorage.setItem(AS_LS_KEY_TITLE, e.target.value); } catch (err) {}
      updateSteps();
    });

    // Copy buttons
    panel.addEventListener('click', async (e) => {
      const btn = e.target.closest('.as-copy-btn');
      if (!btn) return;
      const txt = btn.getAttribute('data-copy') || '';
      if (!txt) return;
      const ok = await copiarAlPortapapeles(txt);
      const originalHTML = btn.innerHTML;
      btn.innerHTML = ok
        ? '<i class="ri-check-line"></i> ok'
        : '<i class="ri-close-line"></i> error';
      btn.style.color = ok ? 'var(--as-ok)' : 'var(--as-err)';
      btn.style.borderColor = ok ? 'rgba(184,255,0,0.4)' : 'rgba(248,113,113,0.4)';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.style.color = '';
        btn.style.borderColor = '';
      }, 1400);
    });

    // ✨ Restaurar título guardado al construir el panel
    try {
      const tGuardado = localStorage.getItem(AS_LS_KEY_TITLE);
      const inputTitle = document.getElementById('as-title');
      if (tGuardado && inputTitle) {
        inputTitle.value = tGuardado;
      }
    } catch (err) {}

    // ✨ Arrancar auto-guardado desde el inicio
    iniciarAutoGuardado();

    updateSteps();
  }

  // ============================================================
  // ✅ ACTUALIZAR ESTADO VISUAL DE LOS PASOS
  // ============================================================
  function updateSteps() {
    const acc = document.getElementById('as-account');
    const title = document.getElementById('as-title');
    const step1 = document.getElementById('as-step-1');
    const step2 = document.getElementById('as-step-2');
    const step3 = document.getElementById('as-step-3');
    if (!acc || !title || !step1 || !step2 || !step3) return;

    const hasAccount = !!selectedToken && acc.value !== '';
    const hasTitle = title.value.trim().length > 0;

    step1.classList.toggle('done', hasAccount);
    step2.classList.toggle('done', hasTitle);

    const status = document.getElementById('as-status-box')?.getAttribute('data-state');
    step3.classList.toggle('done', status === 'streaming');
  }

  // ============================================================
  // 📥 CARGAR CUENTAS
  // ============================================================
  async function loadAccounts() {
    const select = document.getElementById('as-account');
    if (!select) return;
    select.innerHTML = '<option value="">Cargando cuentas...</option>';

    try {
      const r = await fetch(window.SERVER_BASE + '/api/tiktok/streamlabs-accounts');
      const data = await r.json();

      if (!data.ok || !Array.isArray(data.accounts)) {
        select.innerHTML = '<option value="">Error al cargar cuentas</option>';
        return;
      }

      const todas = Array.isArray(data.accounts) ? data.accounts : [];
      const validas = todas.filter(a => a.canBeLive && !a.invalid);
      const invalidas = todas.filter(a => !a.canBeLive || a.invalid);

      accounts = todas;

      if (todas.length === 0) {
        select.innerHTML = '<option value="">Sin cuentas detectadas</option>';
        showError('No hay cuentas. Abre Streamlabs Desktop y loguéate con al menos una cuenta de TikTok.');
        updateSteps();
        return;
      }

      hideError();
      select.innerHTML = '';

      validas.forEach((a, i) => {
        const opt = document.createElement('option');
        opt.value = a.apiToken;
        const realName = a.nickname || a.username || a.displayName || a.name || `Cuenta ${i + 1}`;
        const handle = a.username && a.username !== realName ? ` (@${a.username})` : '';
        opt.textContent = `${realName}${handle}`;
        select.appendChild(opt);
      });

      invalidas.forEach((a, i) => {
        const opt = document.createElement('option');
        opt.value = '';
        opt.disabled = true;
        const realName = a.nickname || a.username || a.displayName || a.name || `Cuenta ${i + 1}`;
        const motivo = a.error
          ? ` — ${a.error}`
          : (a.invalid ? ' — token inválido' : ' — no puede emitir');
        opt.textContent = `⚠️ ${realName}${motivo}`;
        select.appendChild(opt);
      });

            // ✨ Restaurar la cuenta guardada (si existe y es válida)
      if (validas.length > 0) {
        let tokenRestaurar = null;
        try { tokenRestaurar = localStorage.getItem(AS_LS_KEY); } catch (e) {}

        const existeEnLista = tokenRestaurar && validas.some(a => a.apiToken === tokenRestaurar);

        selectedToken = existeEnLista ? tokenRestaurar : validas[0].apiToken;
        select.value = selectedToken;

        console.log('🔄 Cuenta seleccionada:', existeEnLista ? 'restaurada' : 'por defecto (primera)');
      } else {
        selectedToken = null;
        showError('Ninguna cuenta puede emitir. Revisa Streamlabs Desktop.');
      }

      updateSteps();

    } catch (e) {
      select.innerHTML = '<option value="">Error de red</option>';
      showError('No se pudo conectar al servidor: ' + e.message);
      updateSteps();
    }
  }

  // ============================================================
  // ▶️ INICIAR / DETENER
  // ============================================================
    async function startStream() {
    const title = document.getElementById('as-title').value.trim() || 'TogiPanel Stream';

    const sel = document.getElementById('as-account');
    const tokenDelSelect = sel ? sel.value : '';

    // ✨ Guardar antes de iniciar (redundancia)
    try {
      if (tokenDelSelect) localStorage.setItem(AS_LS_KEY, tokenDelSelect);
      if (title) localStorage.setItem(AS_LS_KEY_TITLE, title);
      console.log('💾 Guardado antes de iniciar:', tokenDelSelect.slice(0, 20) + '...');
    } catch (e) {}

    console.log('=== INICIAR STREAM ===');
    console.log('tokenDelSelect:', tokenDelSelect ? tokenDelSelect.slice(0, 20) + '...' : '(vacío)');
    console.log('Opción elegida:', sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '(ninguna)');

    if (!tokenDelSelect) {
      return showError('Selecciona una cuenta en el desplegable');
    }

    setBusy(true);
    hideError();

    try {
      const r = await fetch(window.SERVER_BASE + '/api/tiktok/proxy/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenDelSelect, title })
      });
      const data = await r.json();
      if (!data.ok) {
        showError(data.error || 'Error al iniciar el proxy');
        setBusy(false);
        return;
      }
      startPolling();
    } catch (e) {
      showError('Error de red: ' + e.message);
      setBusy(false);
    }
  }

  async function stopStream() {
    setBusy(true);
    try {
      await fetch(window.SERVER_BASE + '/api/tiktok/proxy/stop', { method: 'POST' });
      stopPolling();
      updateUI({ status: 'idle' });
    } catch (e) {
      showError('Error al detener: ' + e.message);
    }
    setBusy(false);
  }

  // ============================================================
  // 🔄 POLLING
  // ============================================================
  function startPolling() {
    stopPolling();
    actualizarEstado();
    statusInterval = setInterval(actualizarEstado, 3000);
  }
  function stopPolling() {
    if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
  }
  async function actualizarEstado() {
    try {
      const r = await fetch(window.SERVER_BASE + '/api/tiktok/proxy/status');
      const data = await r.json();
      if (data.ok && data.state) updateUI(data.state);
    } catch (e) {}
  }

  // ============================================================
  // 🎨 ACTUALIZAR UI SEGÚN ESTADO
  // ============================================================
  function updateUI(state) {
    const status = state.status || 'idle';
    lastState = status;

    const statusBox = document.getElementById('as-status-box');
    const statusEl = document.getElementById('as-status');
    const headBadge = document.getElementById('as-head-badge');
    const btnStart = document.getElementById('as-start');
    const btnStop = document.getElementById('as-stop');
    const meta = document.getElementById('as-meta');
    const panel = document.getElementById('autostream-panel');

    if (statusBox) statusBox.setAttribute('data-state', status);
    if (panel) panel.setAttribute('data-status', status);

    const textos = {
      idle: 'Detenido',
      waiting: 'Esperando OBS...',
      streaming: 'Emitiendo',
      error: 'Error'
    };
    if (statusEl) statusEl.textContent = textos[status] || status;

    if (headBadge) {
      headBadge.className = 'as-head-badge ' + status;
      headBadge.innerHTML = `<span class="badge-dot"></span><span>${(textos[status] || status).toLowerCase()}</span>`;
    }

    if (btnStart) btnStart.disabled = (status !== 'idle' && status !== 'error');
    if (btnStop) btnStop.disabled = (status === 'idle');

    if (meta) {
      if (status === 'streaming' && state.username) {
        meta.style.display = 'flex';
        const userEl = document.getElementById('as-username');
        if (userEl) userEl.textContent = state.username;

        const reconnEl = document.getElementById('as-reconnect-info');
        const reconnVal = document.getElementById('as-last-reconnect');
        if (reconnEl && reconnVal) {
          if (state.lastReconnect) {
            reconnEl.style.display = '';
            reconnVal.textContent = new Date(state.lastReconnect).toLocaleTimeString('es-ES');
          } else {
            reconnEl.style.display = 'none';
          }
        }
      } else {
        meta.style.display = 'none';
      }
    }

    if (status === 'error' && state.error) {
      showError(state.error);
    } else if (status !== 'error') {
      hideError();
    }

    if (status === 'streaming' && !statusInterval) startPolling();
    if (status === 'idle' && statusInterval) stopPolling();

    updateSteps();
  }

  function setBusy(busy) {
    ['as-start', 'as-stop', 'as-refresh'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = busy;
    });
    if (!busy) actualizarEstado();
  }

  function showError(msg) {
    const box = document.getElementById('as-error');
    const txt = document.getElementById('as-error-text');
    if (box && txt) {
      txt.textContent = msg;
      box.classList.add('show');
    }
  }
  function hideError() {
    const box = document.getElementById('as-error');
    if (box) box.classList.remove('show');
  }

  // ============================================================
  // 🎥 INFO OBS (LAN URL + KEY + QR)
  // ============================================================
  async function loadObsInfo() {
    try {
      const r = await fetch(window.SERVER_BASE + '/api/obs-info');
      const data = await r.json();
      if (!data.ok) return;

      const urlEl   = document.getElementById('as-lan-url');
      const keyEl   = document.getElementById('as-lan-key');
      const pill    = document.getElementById('as-proxy-pill');
      const copyUrl = document.getElementById('as-copy-lan-url');
      const copyKey = document.getElementById('as-copy-lan-key');

      if (urlEl) urlEl.textContent = data.lanUrl;
      if (keyEl) keyEl.textContent = data.key;
      if (pill) {
        pill.textContent = data.statusLabel || data.status || '—';
        pill.className = 'as-proxy-pill' + (
          data.status === 'online'  ? ' ok'  :
          data.status === 'offline' ? ' err' : ''
        );
      }
      if (copyUrl) copyUrl.setAttribute('data-copy', data.lanUrl);
      if (copyKey) copyKey.setAttribute('data-copy', data.key);

      const canvas = document.getElementById('as-qr');
      if (canvas && window.QRCode && typeof window.QRCode.toCanvas === 'function') {
        try {
          await window.QRCode.toCanvas(canvas, data.lanUrl, { width: 110, margin: 1 });
        } catch (e) {}
      }
    } catch (e) {}
  }

  function startObsPolling() {
    stopObsPolling();
    loadObsInfo();
    obsInterval = setInterval(loadObsInfo, 10000);
  }
  function stopObsPolling() {
    if (obsInterval) { clearInterval(obsInterval); obsInterval = null; }
  }

  // ============================================================
  // 🎛️ TOGGLE DEL PANEL
  // ============================================================
    // ✨ Auto-guardado periódico (por si el listener change falla)
  let __autoGuardadoTimer = null;
  let __ultimoTokenGuardado = null;

  function iniciarAutoGuardado() {
    detenerAutoGuardado();
    __autoGuardadoTimer = setInterval(() => {
      try {
        const sel = document.getElementById('as-account');
        const input = document.getElementById('as-title');
        if (!sel) return;

        const tokenActual = sel.value || '';
        if (tokenActual && tokenActual !== __ultimoTokenGuardado) {
          localStorage.setItem(AS_LS_KEY, tokenActual);
          __ultimoTokenGuardado = tokenActual;
          console.log('💾 Auto-guardado cuenta:', tokenActual.slice(0, 20) + '...');
        }

        if (input) {
          const tituloActual = input.value || '';
          if (tituloActual) {
            localStorage.setItem(AS_LS_KEY_TITLE, tituloActual);
          }
        }
      } catch (e) {
        console.warn('⚠️ Auto-guardado falló:', e.message);
      }
    }, 2000);
  }

  function detenerAutoGuardado() {
    if (__autoGuardadoTimer) {
      clearInterval(__autoGuardadoTimer);
      __autoGuardadoTimer = null;
    }
  }

  function togglePanel() {
    const panel = document.getElementById('autostream-panel');
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      loadAccounts();
      actualizarEstado();
      startObsPolling();
      iniciarAutoGuardado();
    } else {
      stopObsPolling();
      detenerAutoGuardado();
    }
  }

  // ============================================================
  // 🚀 INIT
  // ============================================================
  function init() {
    injectStyles();
    buildPanel();

    const headerRight = document.querySelector('.header-right');
    if (headerRight && !document.getElementById('toggle-autostream-btn')) {
      const btn = document.createElement('button');
      btn.className = 'toggle-right-btn';
      btn.id = 'toggle-autostream-btn';
      btn.style.cssText = 'color: #ff0080; border-color: rgba(255,0,128,0.35);';
      btn.innerHTML = '<i class="ri-live-fill"></i> <span>Auto-Stream</span>';
      btn.addEventListener('click', togglePanel);
      headerRight.insertBefore(btn, headerRight.firstChild);
    }

    const sidebarBottom = document.querySelector('.sidebar-bottom');
    if (sidebarBottom && !document.querySelector('.sidebar-item[data-autostream]')) {
      const link = document.createElement('a');
      link.className = 'sidebar-item';
      link.href = '#';
      link.setAttribute('data-autostream', '1');
      link.innerHTML = '<i class="ri-live-fill" style="color:#ff0080"></i><span>Auto-Stream</span>';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const panel = document.getElementById('autostream-panel');
        if (panel && !panel.classList.contains('open')) togglePanel();
        if (panel) {
          const y = panel.getBoundingClientRect().top + window.scrollY - 20;
          window.scrollTo({ top: y, behavior: 'smooth' });
        }
      });
      sidebarBottom.insertBefore(link, sidebarBottom.firstChild);
    }
  }

  function waitForDom() {
    const headerRight = document.querySelector('.header-right');
    const mainContent = document.querySelector('main.main-content');
    const sectionOverview = document.getElementById('section-overview');
    if (headerRight && mainContent && sectionOverview) {
      init();
    } else {
      setTimeout(waitForDom, 200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForDom);
  } else {
    waitForDom();
  }

})();