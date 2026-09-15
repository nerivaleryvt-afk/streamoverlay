// ============================================================
// autostream.js — Panel Auto-Stream TikTok (v3 · "Broadcast Console")
// Rediseño: menos efectos, más claridad, flujo guiado 1-2-3
// ============================================================

(function () {
  'use strict';

  let accounts = [];
  let selectedToken = null;
  let statusInterval = null;
  let lastState = 'idle';
  let obsInterval = null;

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
  // 🎨 CSS — Diseño "Broadcast Console"
  // Acento: ámbar quemado (#e8825a). Superficies sólidas.
  // Sin gradientes decorativos, sin glassmorphism.
  // ============================================================
  function injectStyles() {
    if (document.getElementById('autostream-styles')) return;
    const style = document.createElement('style');
    style.id = 'autostream-styles';
    style.textContent = `
      /* Tokens locales del panel (no tocan los globales) */
      #autostream-panel {
        --as-accent: #e8825a;
        --as-accent-dim: #b8603c;
        --as-accent-soft: rgba(232, 130, 90, 0.12);
        --as-accent-border: rgba(232, 130, 90, 0.4);
        --as-surface: #16151c;
        --as-surface-2: #1c1b23;
        --as-surface-3: #22212b;
        --as-line: #2a2933;
        --as-line-strong: #3a3846;
        --as-text: #e8e6f0;
        --as-text-2: #a8a5b5;
        --as-text-3: #6f6c80;
        --as-ok: #6dd58c;
        --as-warn: #e8b54d;
        --as-err: #e56969;

        position: relative;
        background: var(--as-surface);
        border: 1px solid var(--as-line);
        border-radius: 12px;
        padding: 20px 22px 22px;
        margin-bottom: 22px;
        display: none;
        overflow: hidden;
        font-family: 'Satoshi', system-ui, sans-serif;
      }
      #autostream-panel.open { display: block; }

      /* Borde superior como "tira de estado" del panel */
      #autostream-panel::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 2px;
        background: var(--as-line);
        transition: background 0.3s;
      }
      #autostream-panel[data-status="streaming"]::before { background: var(--as-accent); }
      #autostream-panel[data-status="waiting"]::before   { background: var(--as-warn); }
      #autostream-panel[data-status="error"]::before     { background: var(--as-err); }

      /* ─── HEADER ─── */
      #autostream-panel .as-head {
        display: flex; align-items: center; gap: 14px;
        margin-bottom: 22px;
        padding-bottom: 18px;
        border-bottom: 1px solid var(--as-line);
      }
      #autostream-panel .as-head-icon {
        width: 40px; height: 40px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        background: var(--as-surface-3);
        border: 1px solid var(--as-line-strong);
        color: var(--as-accent); font-size: 20px;
        flex-shrink: 0;
        transition: all 0.3s;
      }
      #autostream-panel[data-status="streaming"] .as-head-icon {
        background: var(--as-accent-soft);
        border-color: var(--as-accent-border);
        box-shadow: 0 0 0 4px rgba(232, 130, 90, 0.06);
      }
      #autostream-panel .as-head-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
      #autostream-panel .as-head-title {
        font-size: 15px; font-weight: 700; color: var(--as-text);
        letter-spacing: -0.015em;
      }
      #autostream-panel .as-head-sub {
        font-size: 11.5px; color: var(--as-text-3);
        font-family: 'JetBrains Mono', monospace;
      }
      #autostream-panel .as-head-badge {
        font-size: 10.5px; font-weight: 700;
        padding: 5px 11px; border-radius: 6px;
        background: var(--as-surface-3);
        color: var(--as-text-2);
        border: 1px solid var(--as-line-strong);
        display: inline-flex; align-items: center; gap: 6px;
        text-transform: uppercase; letter-spacing: 0.08em;
        font-family: 'JetBrains Mono', monospace;
        transition: all 0.25s;
        flex-shrink: 0;
      }
      #autostream-panel .as-head-badge .badge-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: currentColor;
      }
      #autostream-panel .as-head-badge.waiting {
        color: var(--as-warn);
        border-color: rgba(232, 181, 77, 0.35);
      }
      #autostream-panel .as-head-badge.streaming {
        color: var(--as-accent);
        border-color: var(--as-accent-border);
        background: var(--as-accent-soft);
      }
      #autostream-panel .as-head-badge.streaming .badge-dot {
        animation: asDotPulse 1.8s ease-in-out infinite;
      }
      #autostream-panel .as-head-badge.error {
        color: var(--as-err);
        border-color: rgba(229, 105, 105, 0.35);
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

      /* ─── PASOS GUIADOS (1-2-3) ─── */
      .as-step {
        background: var(--as-surface-2);
        border: 1px solid var(--as-line);
        border-radius: 10px;
        padding: 14px 16px 16px;
        transition: all 0.2s;
        position: relative;
      }
      .as-step.done {
        border-color: var(--as-line-strong);
      }
      .as-step.done .as-step-num {
        background: var(--as-accent);
        color: #0f0e13;
        border-color: var(--as-accent);
      }
      .as-step.done .as-step-num::before {
        content: '✓';
        font-size: 12px;
        font-weight: 900;
      }
      .as-step.done .as-step-num > span { display: none; }

      .as-step-head {
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 12px;
      }
      .as-step-num {
        width: 22px; height: 22px; border-radius: 50%;
        background: var(--as-surface-3);
        border: 1px solid var(--as-line-strong);
        color: var(--as-text-3);
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 800;
        font-family: 'JetBrains Mono', monospace;
        flex-shrink: 0;
        transition: all 0.25s;
      }
      .as-step-title {
        font-size: 12px; font-weight: 700;
        color: var(--as-text);
        text-transform: uppercase; letter-spacing: 0.06em;
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
        border-radius: 7px;
        padding: 10px 12px;
        color: var(--as-text);
        font-size: 12.5px;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      #autostream-panel input[type="text"]:focus,
      #autostream-panel select:focus {
        border-color: var(--as-accent);
        box-shadow: 0 0 0 3px rgba(232, 130, 90, 0.1);
      }
      #autostream-panel input::placeholder { color: var(--as-text-3); }
      #autostream-panel select option { background: var(--as-surface-2); color: var(--as-text); }

      /* ─── BOTONES ─── */
      .as-btn {
        display: inline-flex; align-items: center; justify-content: center;
        gap: 8px; padding: 12px 16px;
        border-radius: 8px;
        font-weight: 600; font-size: 12.5px; cursor: pointer;
        font-family: inherit;
        transition: all 0.15s;
        border: 1px solid transparent;
        letter-spacing: -0.005em;
      }
      .as-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .as-btn i { font-size: 15px; }

      /* Primario: acento sólido (no gradiente) */
      .as-btn-primary {
        background: var(--as-accent);
        color: #0f0e13;
        border-color: var(--as-accent);
        font-weight: 700;
      }
      .as-btn-primary:hover:not(:disabled) {
        background: #f0926a;
        border-color: #f0926a;
      }
      .as-btn-primary:active:not(:disabled) {
        transform: translateY(1px);
      }

      /* Peligro: outline, no relleno (más sobrio) */
      .as-btn-danger {
        background: transparent;
        color: var(--as-err);
        border-color: rgba(229, 105, 105, 0.3);
      }
      .as-btn-danger:hover:not(:disabled) {
        background: rgba(229, 105, 105, 0.08);
        border-color: rgba(229, 105, 105, 0.55);
      }

      /* Warning: outline */
      .as-btn-warning {
        background: transparent;
        color: var(--as-warn);
        border-color: rgba(232, 181, 77, 0.3);
      }
      .as-btn-warning:hover:not(:disabled) {
        background: rgba(232, 181, 77, 0.08);
        border-color: rgba(232, 181, 77, 0.55);
      }

      .as-row-actions {
        display: grid; grid-template-columns: 2fr 1fr; gap: 8px;
      }

      /* ─── PANEL OBS (colapsable) ─── */
      .as-obs-panel {
        background: var(--as-surface-2);
        border: 1px solid var(--as-line);
        border-radius: 10px;
        overflow: hidden;
        transition: all 0.2s;
      }
      .as-obs-panel summary {
        list-style: none;
        padding: 12px 16px;
        cursor: pointer;
        display: flex; align-items: center; gap: 10px;
        font-size: 12px; font-weight: 700;
        color: var(--as-text);
        text-transform: uppercase; letter-spacing: 0.06em;
        user-select: none;
        transition: background 0.15s;
      }
      .as-obs-panel summary::-webkit-details-marker { display: none; }
      .as-obs-panel summary:hover { background: var(--as-surface-3); }
      .as-obs-panel summary > i:first-child {
        color: var(--as-accent); font-size: 15px;
      }
      .as-obs-panel summary .caret {
        margin-left: auto; font-size: 14px;
        transition: transform 0.2s;
        color: var(--as-text-3);
      }
      .as-obs-panel[open] summary .caret { transform: rotate(180deg); }
      .as-obs-body {
        padding: 4px 16px 16px;
        display: flex; flex-direction: column; gap: 12px;
      }

      /* ─── FILAS OBS ─── */
      .as-obs-row { display: flex; flex-direction: column; gap: 5px; }
      .as-obs-key {
        font-size: 10px; color: var(--as-text-3);
        text-transform: uppercase; letter-spacing: 0.08em;
        font-weight: 700;
        font-family: 'JetBrains Mono', monospace;
      }
      .as-obs-val {
        font-family: 'JetBrains Mono', monospace;
        font-size: 11.5px; color: var(--as-text);
        background: var(--as-surface);
        border: 1px solid var(--as-line);
        padding: 9px 11px;
        border-radius: 6px;
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px;
      }
      .as-obs-val > span {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        flex: 1;
        color: var(--as-text-2);
      }
      .as-copy-btn {
        background: transparent;
        border: 1px solid var(--as-line-strong);
        color: var(--as-text-3);
        border-radius: 5px;
        padding: 3px 8px;
        font-size: 10px; cursor: pointer;
        flex-shrink: 0;
        font-family: 'JetBrains Mono', monospace;
        font-weight: 700;
        transition: all 0.15s;
        display: inline-flex; align-items: center; gap: 4px;
        letter-spacing: 0.03em;
      }
      .as-copy-btn:hover {
        color: var(--as-accent);
        border-color: var(--as-accent-border);
      }
      .as-copy-btn:active { transform: scale(0.96); }

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
        border-radius: 6px;
        padding: 6px;
        flex-shrink: 0;
        line-height: 0;
      }
      .as-qr-frame canvas { display: block; }
      .as-qr-hint {
        font-size: 11.5px; color: var(--as-text-2);
        line-height: 1.6;
      }
      .as-qr-hint b {
        color: var(--as-text);
        font-weight: 700;
        display: block;
        margin-bottom: 4px;
      }
      .as-qr-hint code {
        font-family: 'JetBrains Mono', monospace;
        font-size: 10.5px;
        color: var(--as-accent);
        background: var(--as-accent-soft);
        padding: 1px 5px;
        border-radius: 3px;
      }

      /* ─── STATUS BOX ─── */
      .as-status-box {
        display: flex; align-items: center; gap: 12px;
        padding: 12px 14px;
        border-radius: 9px;
        background: var(--as-surface-2);
        border: 1px solid var(--as-line);
        font-size: 12.5px;
      }
      .as-status-box .status-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--as-text-3);
        flex-shrink: 0;
        transition: background 0.2s;
      }
      .as-status-box[data-state="waiting"] .status-dot  { background: var(--as-warn); animation: asDotPulse 1.4s infinite; }
      .as-status-box[data-state="streaming"] .status-dot { background: var(--as-accent); animation: asDotPulse 1.4s infinite; }
      .as-status-box[data-state="error"] .status-dot     { background: var(--as-err); }
      .as-status-box .status-label {
        color: var(--as-text-3); font-size: 11px;
        text-transform: uppercase; letter-spacing: 0.08em;
        font-weight: 700;
        font-family: 'JetBrains Mono', monospace;
      }
      .as-status-box .status-value {
        margin-left: auto;
        color: var(--as-text); font-weight: 700;
        font-size: 12px;
      }
      .as-status-box[data-state="streaming"] .status-value { color: var(--as-accent); }

      /* ─── ERROR ─── */
      .as-error {
        background: rgba(229, 105, 105, 0.06);
        border: 1px solid rgba(229, 105, 105, 0.3);
        border-radius: 9px;
        padding: 11px 13px;
        font-size: 12px; color: #f0b8b8;
        display: none; gap: 10px; align-items: flex-start;
      }
      .as-error.show { display: flex; }
      .as-error i { font-size: 15px; flex-shrink: 0; margin-top: 1px; color: var(--as-err); }

      /* ─── META ─── */
      .as-meta {
        font-size: 11px; color: var(--as-text-3);
        display: flex; gap: 16px; flex-wrap: wrap;
        padding: 6px 2px;
        font-family: 'JetBrains Mono', monospace;
      }
      .as-meta b { color: var(--as-text-2); font-weight: 600; }

      /* ─── HINT (info card) ─── */
      .as-hint {
        background: var(--as-surface-2);
        border: 1px solid var(--as-line);
        border-left: 3px solid var(--as-accent);
        border-radius: 8px;
        padding: 12px 14px;
        font-size: 11.5px;
        color: var(--as-text-2);
        line-height: 1.6;
      }
      .as-hint b { color: var(--as-text); font-weight: 700; }

      /* ─── REFRESH BTN ─── */
      .as-refresh-btn {
        background: transparent;
        border: 1px solid var(--as-line);
        color: var(--as-text-3);
        padding: 4px 9px; border-radius: 5px;
        font-size: 10.5px; cursor: pointer;
        font-family: 'JetBrains Mono', monospace;
        font-weight: 700;
        display: inline-flex; align-items: center; gap: 5px;
        transition: all 0.15s;
        letter-spacing: 0.03em;
      }
      .as-refresh-btn:hover {
        color: var(--as-accent);
        border-color: var(--as-accent-border);
      }
      .as-refresh-btn.spinning i { animation: asSpin 0.8s linear infinite; }
      @keyframes asSpin { to { transform: rotate(360deg); } }

      /* Proxy status pill */
      .as-proxy-pill {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 10.5px;
        font-family: 'JetBrains Mono', monospace;
        font-weight: 700;
        color: var(--as-text-2);
        padding: 2px 8px;
        border-radius: 4px;
        background: var(--as-surface);
        border: 1px solid var(--as-line);
      }
      .as-proxy-pill::before {
        content: '';
        width: 5px; height: 5px; border-radius: 50%;
        background: var(--as-text-3);
      }
      .as-proxy-pill.ok::before { background: var(--as-ok); }
      .as-proxy-pill.err::before { background: var(--as-err); }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // 🏗️ CONSTRUIR HTML DEL PANEL (nueva estructura 1-2-3)
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

          <button class="as-btn as-btn-warning" id="as-renew" disabled>
            <i class="ri-refresh-line"></i> Renovar clave ahora
          </button>

          <div class="as-status-box" id="as-status-box" data-state="idle">
            <span class="status-dot"></span>
            <span class="status-label">estado</span>
            <span class="status-value" id="as-status">Detenido</span>
          </div>

          <div class="as-meta" id="as-meta" style="display:none;">
            <span><i class="ri-user-line"></i> <b id="as-username">—</b></span>
            <span>renov. <b id="as-last-renew">—</b></span>
            <span>próx. <b id="as-next-renew">—</b></span>
          </div>

          <div class="as-error" id="as-error">
            <i class="ri-error-warning-line"></i>
            <span id="as-error-text"></span>
          </div>
        </div>

        <!-- ══════════ COLUMNA DERECHA: CONFIG OBS ══════════ -->
        <div class="as-col">

          <!-- OBS panel colapsable: esta PC -->
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

          <!-- OBS panel colapsable: otra PC -->
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
    document.getElementById('as-renew').addEventListener('click', renewStream);

    // ── CAMBIO CLAVE: al cambiar de cuenta en el desplegable,
    //    actualizamos `selectedToken` con el valor elegido.
    document.getElementById('as-account').addEventListener('change', (e) => {
      selectedToken = e.target.value;
      updateSteps();
    });

    document.getElementById('as-title').addEventListener('input', updateSteps);

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
      btn.style.borderColor = ok ? 'rgba(109,213,140,0.4)' : 'rgba(229,105,105,0.4)';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.style.color = '';
        btn.style.borderColor = '';
      }, 1400);
    });

    // Actualizar pasos al inicio
    updateSteps();
  }

  // ============================================================
  // ✅ ACTUALIZAR ESTADO VISUAL DE LOS PASOS 1-2-3
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

    // El paso 3 solo se marca como "done" cuando está emitiendo
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

      // Mostrar TODAS las cuentas detectadas, marcando las inválidas
      const todas = Array.isArray(data.accounts) ? data.accounts : [];
      const validas = todas.filter(a => a.canBeLive && !a.invalid);
      const invalidas = todas.filter(a => !a.canBeLive || a.invalid);

      accounts = todas;   // guardamos todas

      if (todas.length === 0) {
        select.innerHTML = '<option value="">Sin cuentas detectadas</option>';
        showError('No hay cuentas. Abre Streamlabs Desktop y loguéate con al menos una cuenta de TikTok.');
        updateSteps();
        return;
      }

      hideError();
      select.innerHTML = '';

      // 1) Las que pueden emitir (elegibles)
      validas.forEach((a, i) => {
        const opt = document.createElement('option');
        opt.value = a.apiToken;
        const realName = a.nickname || a.username || a.displayName || a.name || `Cuenta ${i + 1}`;
        const handle = a.username && a.username !== realName ? ` (@${a.username})` : '';
        opt.textContent = `${realName}${handle}`;
        select.appendChild(opt);
      });

      // 2) Las que NO pueden emitir (marcadas, deshabilitadas)
      invalidas.forEach((a, i) => {
        const opt = document.createElement('option');
        opt.value = '';   // ← vacío para inválidas
        opt.disabled = true;
        const realName = a.nickname || a.username || a.displayName || a.name || `Cuenta ${i + 1}`;
        const motivo = a.error
          ? ` — ${a.error}`
          : (a.invalid ? ' — token inválido' : ' — no puede emitir');
        opt.textContent = `⚠️ ${realName}${motivo}`;
        select.appendChild(opt);
      });

      // 3) Seleccionar la primera VÁLIDA automáticamente
      if (validas.length > 0) {
        selectedToken = validas[0].apiToken;
        select.value = selectedToken;
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
  // ▶️ INICIAR / DETENER / RENOVAR
  // ============================================================
  async function startStream() {
    const title = document.getElementById('as-title').value.trim() || 'TogiPanel Stream';

    // 🔥 FIX: leer el token DIRECTAMENTE del <select> al pulsar INICIAR
    const sel = document.getElementById('as-account');
    const tokenDelSelect = sel ? sel.value : '';

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

  async function renewStream() {
    try {
      await fetch(window.SERVER_BASE + '/api/tiktok/proxy/renew', { method: 'POST' });
    } catch (e) {
      showError('Error al renovar: ' + e.message);
    }
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
    const btnRenew = document.getElementById('as-renew');
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
    if (btnRenew) btnRenew.disabled = (status !== 'streaming');

    if (meta) {
      if (status === 'streaming' && state.username) {
        meta.style.display = 'flex';
        document.getElementById('as-username').textContent = state.username;
        document.getElementById('as-last-renew').textContent = state.lastRenewal
          ? new Date(state.lastRenewal).toLocaleTimeString('es-ES')
          : '—';
        document.getElementById('as-next-renew').textContent = state.nextRenewal
          ? new Date(state.nextRenewal).toLocaleTimeString('es-ES')
          : '—';
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
    ['as-start', 'as-stop', 'as-renew', 'as-refresh'].forEach(id => {
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
  function togglePanel() {
    const panel = document.getElementById('autostream-panel');
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      loadAccounts();
      actualizarEstado();
      startObsPolling();
    } else {
      stopObsPolling();
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
      btn.style.cssText = 'color: var(--secondary); border-color: rgba(214,123,168,0.3);';
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
      link.innerHTML = '<i class="ri-live-fill"></i><span>Auto-Stream</span>';
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