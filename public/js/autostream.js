// ============================================================
// autostream.js — Panel de Auto-Stream TikTok (Fase 5 · v2)
// Rediseño visual: glassmorphism, gradientes, micro-animaciones
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
    } catch (e) { /* no es Electron */ }

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(String(texto));
        return true;
      }
    } catch (e) { /* fallback */ }

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
    } catch (e) {
      return false;
    }
  }

  // ============================================================
  // INYECTAR CSS (rediseñado)
  // ============================================================
  function injectStyles() {
    if (document.getElementById('autostream-styles')) return;
    const style = document.createElement('style');
    style.id = 'autostream-styles';
    style.textContent = `
      /* =========================================================
         AUTO-STREAM PANEL · v2
         ========================================================= */
      #autostream-panel {
        position: relative;
        background:
          radial-gradient(1200px 400px at 0% 0%, rgba(214,123,168,0.06), transparent 60%),
          radial-gradient(1200px 400px at 100% 100%, rgba(77,124,199,0.06), transparent 60%),
          var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 22px 24px 24px;
        margin-bottom: 22px;
        display: none;
        overflow: hidden;
        animation: asFadeIn 0.25s ease;
      }
      #autostream-panel::before {
        content: '';
        position: absolute;
        inset: 0 0 auto 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(214,123,168,0.45), rgba(77,124,199,0.45), transparent);
        opacity: 0.7;
      }
      #autostream-panel.open { display: block; }

      @keyframes asFadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      /* Header del panel */
      #autostream-panel .as-head {
        display: flex; align-items: center; gap: 12px;
        margin-bottom: 20px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--border);
      }
      #autostream-panel .as-head-icon {
        width: 38px; height: 38px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, rgba(214,123,168,0.18), rgba(77,124,199,0.18));
        border: 1px solid rgba(214,123,168,0.25);
        color: var(--secondary); font-size: 19px;
        box-shadow: 0 4px 14px rgba(214,123,168,0.12);
        flex-shrink: 0;
      }
      #autostream-panel .as-head-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      #autostream-panel .as-head-title {
        font-size: 15px; font-weight: 600; color: #f1f2f4;
        letter-spacing: -0.01em;
        display: flex; align-items: center; gap: 8px;
      }
      #autostream-panel .as-head-sub {
        font-size: 11.5px; color: var(--text-muted);
      }
      #autostream-panel .as-head-badge {
        margin-left: auto;
        font-size: 10.5px; font-weight: 600;
        padding: 3px 10px; border-radius: 100px;
        background: rgba(79,168,122,0.1);
        color: var(--success);
        border: 1px solid rgba(79,168,122,0.25);
        display: inline-flex; align-items: center; gap: 5px;
        text-transform: uppercase; letter-spacing: 0.06em;
      }
      #autostream-panel .as-head-badge.idle {
        background: rgba(145,152,164,0.08);
        color: var(--text-dim);
        border-color: rgba(145,152,164,0.2);
      }
      #autostream-panel .as-head-badge.waiting {
        background: rgba(214,168,74,0.1);
        color: var(--warning);
        border-color: rgba(214,168,74,0.25);
      }
      #autostream-panel .as-head-badge.error {
        background: rgba(194,106,106,0.1);
        color: var(--danger);
        border-color: rgba(194,106,106,0.25);
      }

      /* Grid principal */
      .as-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 22px;
      }
      @media (max-width: 900px) { .as-grid { grid-template-columns: 1fr; } }

      .as-col { display: flex; flex-direction: column; gap: 14px; }

      /* Etiquetas de sección */
      .as-label {
        font-size: 10.5px; color: var(--text-muted);
        text-transform: uppercase; letter-spacing: 0.08em;
        font-weight: 700; margin-bottom: 6px;
        display: flex; align-items: center; gap: 6px;
      }
      .as-label i { font-size: 13px; color: var(--text-dim); }

      /* Tarjetas internas */
      .as-card {
        background: rgba(15,17,21,0.6);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px 14px;
        transition: border-color 0.15s;
      }
      .as-card:hover { border-color: var(--border-strong); }

      /* Estado */
      .as-status {
        display: flex; align-items: center; gap: 12px;
        padding: 13px 15px; border-radius: 10px;
        background: rgba(15,17,21,0.6);
        border: 1px solid var(--border);
        font-size: 13px;
        position: relative;
        overflow: hidden;
      }
      .as-status::before {
        content: '';
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 3px;
        background: var(--border-strong);
        transition: background 0.2s;
      }
      .as-status[data-state="waiting"]::before   { background: var(--warning); }
      .as-status[data-state="streaming"]::before { background: var(--success); }
      .as-status[data-state="error"]::before     { background: var(--danger); }

      .as-status-dot {
        width: 10px; height: 10px; border-radius: 50%;
        background: #6b7280; flex-shrink: 0;
        transition: background 0.2s;
      }
      .as-status-dot.waiting   { background: var(--warning); animation: asPulse 1.6s infinite; }
      .as-status-dot.streaming { background: var(--success); animation: asPulse 1.6s infinite; }
      .as-status-dot.error     { background: var(--danger); }
      @keyframes asPulse {
        0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(79,168,122,0.4); }
        50%      { opacity: 0.6; box-shadow: 0 0 0 6px rgba(79,168,122,0); }
      }
      .as-status-label { color: var(--text-dim); font-size: 12px; }
      .as-status-value {
        color: var(--text); font-weight: 600; margin-left: auto;
        font-size: 12.5px;
      }

      /* Botones */
      .as-btn {
        display: inline-flex; align-items: center; justify-content: center;
        gap: 7px; padding: 11px 16px; border-radius: 8px;
        font-weight: 600; font-size: 12.5px; cursor: pointer;
        font-family: inherit; transition: all 0.18s cubic-bezier(0.4,0,0.2,1);
        border: 1px solid transparent;
        position: relative; overflow: hidden;
        letter-spacing: 0.01em;
      }
      .as-btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .as-btn i { font-size: 14px; }

      .as-btn-primary {
        background: linear-gradient(135deg, rgba(214,123,168,0.18), rgba(214,123,168,0.08));
        color: #f0c8dc;
        border-color: rgba(214,123,168,0.35);
        box-shadow: 0 2px 10px rgba(214,123,168,0.08);
      }
      .as-btn-primary:hover:not(:disabled) {
        background: linear-gradient(135deg, rgba(214,123,168,0.28), rgba(214,123,168,0.14));
        border-color: rgba(214,123,168,0.55);
        box-shadow: 0 4px 18px rgba(214,123,168,0.18);
        transform: translateY(-1px);
      }
      .as-btn-primary:active:not(:disabled) { transform: translateY(0); }

      .as-btn-danger {
        background: linear-gradient(135deg, rgba(194,106,106,0.14), rgba(194,106,106,0.06));
        color: #e8b0b0;
        border-color: rgba(194,106,106,0.3);
      }
      .as-btn-danger:hover:not(:disabled) {
        background: linear-gradient(135deg, rgba(194,106,106,0.24), rgba(194,106,106,0.12));
        border-color: rgba(194,106,106,0.5);
        box-shadow: 0 4px 18px rgba(194,106,106,0.15);
        transform: translateY(-1px);
      }

      .as-btn-warning {
        background: linear-gradient(135deg, rgba(214,168,74,0.12), rgba(214,168,74,0.05));
        color: #e6cc8a;
        border-color: rgba(214,168,74,0.28);
      }
      .as-btn-warning:hover:not(:disabled) {
        background: linear-gradient(135deg, rgba(214,168,74,0.22), rgba(214,168,74,0.1));
        border-color: rgba(214,168,74,0.45);
        box-shadow: 0 4px 18px rgba(214,168,74,0.12);
        transform: translateY(-1px);
      }

      .as-row-actions {
        display: grid; grid-template-columns: 2fr 1fr; gap: 8px;
      }

      /* Inputs / selects */
      #autostream-panel input[type="text"],
      #autostream-panel select {
        width: 100%;
        background: rgba(15,17,21,0.8);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 10px 12px;
        color: var(--text);
        font-size: 12.5px;
        font-family: inherit;
        outline: none;
        transition: all 0.15s;
      }
      #autostream-panel input[type="text"]:focus,
      #autostream-panel select:focus {
        border-color: var(--secondary);
        box-shadow: 0 0 0 3px rgba(214,123,168,0.12);
        background: rgba(20,22,27,0.9);
      }
      #autostream-panel input::placeholder { color: var(--text-muted); }

      /* Caja OBS */
      .as-obs-box {
        background: rgba(15,17,21,0.6);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 14px 15px;
        display: flex; flex-direction: column; gap: 12px;
      }
      .as-obs-row { display: flex; flex-direction: column; gap: 5px; }
      .as-obs-key {
        font-size: 10.5px; color: var(--text-muted);
        text-transform: uppercase; letter-spacing: 0.07em; font-weight: 700;
        display: flex; align-items: center; gap: 5px;
      }
      .as-obs-val {
        font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 12px; color: var(--text);
        background: rgba(10,11,14,0.85);
        border: 1px solid var(--border);
        padding: 7px 10px; border-radius: 6px;
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px;
        transition: border-color 0.15s;
      }
      .as-obs-val:hover { border-color: var(--border-strong); }
      .as-obs-val span {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        flex: 1;
      }
      .as-copy-btn {
        background: rgba(77,124,199,0.08);
        border: 1px solid rgba(77,124,199,0.2);
        color: var(--primary-soft);
        border-radius: 5px; padding: 3px 9px;
        font-size: 10.5px; cursor: pointer; flex-shrink: 0;
        font-family: inherit; font-weight: 600;
        transition: all 0.15s;
        display: inline-flex; align-items: center; gap: 4px;
      }
      .as-copy-btn:hover {
        background: rgba(77,124,199,0.16);
        border-color: rgba(77,124,199,0.4);
        color: #b8cdf0;
      }
      .as-copy-btn:active { transform: scale(0.95); }

      /* QR */
      .as-qr-wrap {
        display: flex; align-items: center; gap: 14px;
        margin-top: 6px;
        padding: 12px;
        background: rgba(10,11,14,0.5);
        border: 1px dashed var(--border-strong);
        border-radius: 10px;
      }
      .as-qr-frame {
        position: relative;
        background: #fff;
        border-radius: 8px;
        padding: 8px;
        flex-shrink: 0;
        box-shadow: 0 4px 14px rgba(0,0,0,0.4);
      }
      .as-qr-frame::after {
        content: '';
        position: absolute;
        inset: -3px;
        border-radius: 10px;
        background: linear-gradient(135deg, rgba(214,123,168,0.4), rgba(77,124,199,0.4));
        z-index: -1;
        opacity: 0.7;
      }
      .as-qr-wrap canvas { display: block; }
      .as-qr-hint {
        font-size: 11.5px; color: var(--text-muted); line-height: 1.6;
      }
      .as-qr-hint b { color: var(--text-dim); font-weight: 600; }

      /* Hint informativo */
      .as-hint {
        background: linear-gradient(135deg, rgba(90,138,214,0.08), rgba(90,138,214,0.03));
        border: 1px solid rgba(90,138,214,0.2);
        border-radius: 10px; padding: 12px 14px;
        font-size: 12px; color: var(--text-dim); line-height: 1.55;
        display: flex; gap: 10px; align-items: flex-start;
      }
      .as-hint i {
        color: var(--info); font-size: 16px; flex-shrink: 0; margin-top: 1px;
      }
      .as-hint b { color: var(--text); font-weight: 600; }

      /* Error */
      .as-error {
        background: linear-gradient(135deg, rgba(194,106,106,0.1), rgba(194,106,106,0.04));
        border: 1px solid rgba(194,106,106,0.28);
        border-radius: 10px; padding: 11px 13px;
        font-size: 12px; color: #e8b0b0;
        display: none; gap: 10px; align-items: flex-start;
        animation: asFadeIn 0.2s ease;
      }
      .as-error.show { display: flex; }
      .as-error i { font-size: 16px; flex-shrink: 0; margin-top: 1px; color: var(--danger); }

      /* Meta info */
      .as-meta {
        font-size: 11px; color: var(--text-muted);
        display: flex; gap: 14px; flex-wrap: wrap;
        padding: 8px 2px;
      }
      .as-meta b { color: var(--text-dim); font-weight: 600; }

      /* Botón refrescar */
      .as-refresh-btn {
        background: transparent; border: 1px solid var(--border);
        color: var(--text-dim); padding: 4px 9px; border-radius: 6px;
        font-size: 11px; cursor: pointer; font-family: inherit;
        display: inline-flex; align-items: center; gap: 5px;
        transition: all 0.15s;
      }
      .as-refresh-btn:hover {
        color: var(--primary-soft);
        border-color: rgba(77,124,199,0.4);
        background: rgba(77,124,199,0.06);
      }
      .as-refresh-btn i { font-size: 12px; }
      .as-refresh-btn.spinning i { animation: asSpin 0.8s linear infinite; }
      @keyframes asSpin { to { transform: rotate(360deg); } }

      #autostream-panel select option { background: #14161b; color: var(--text); }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // CONSTRUIR HTML DEL PANEL
  // ============================================================
  function buildPanel() {
    if (document.getElementById('autostream-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'autostream-panel';
    panel.innerHTML = `
      <div class="as-head">
        <div class="as-head-icon"><i class="ri-live-fill"></i></div>
        <div class="as-head-text">
          <div class="as-head-title">Auto-Stream TikTok</div>
          <div class="as-head-sub">Retransmisión automática vía Streamlabs + proxy RTMP</div>
        </div>
        <div class="as-head-badge idle" id="as-head-badge">
          <i class="ri-circle-fill" style="font-size:8px;"></i> <span>Detenido</span>
        </div>
      </div>

      <div class="as-grid">
        <div class="as-col">
          <div class="as-card">
            <div class="as-label">
              <i class="ri-user-3-line"></i> Cuenta de TikTok
              <button class="as-refresh-btn" id="as-refresh" style="margin-left:auto;">
                <i class="ri-refresh-line"></i> Refrescar
              </button>
            </div>
            <select id="as-account"></select>
          </div>

          <div class="as-card">
            <div class="as-label"><i class="ri-edit-line"></i> Título del directo</div>
            <input type="text" id="as-title" placeholder="Mi stream de hoy..." value="TogiPanel Stream">
          </div>

          <div class="as-row-actions">
            <button class="as-btn as-btn-primary" id="as-start">
              <i class="ri-play-fill"></i> Iniciar Auto-Stream
            </button>
            <button class="as-btn as-btn-danger" id="as-stop" disabled>
              <i class="ri-stop-fill"></i> Detener
            </button>
          </div>

          <button class="as-btn as-btn-warning" id="as-renew" disabled>
            <i class="ri-refresh-line"></i> Forzar renovación de clave
          </button>

          <div class="as-status" id="as-status-box" data-state="idle">
            <div class="as-status-dot" id="as-dot"></div>
            <span class="as-status-label">Estado</span>
            <span class="as-status-value" id="as-status">Detenido</span>
          </div>

          <div class="as-meta" id="as-meta" style="display:none;">
            <span><i class="ri-user-line"></i> <b id="as-username">—</b></span>
            <span><i class="ri-time-line"></i> Última: <b id="as-last-renew">—</b></span>
            <span><i class="ri-timer-line"></i> Próxima: <b id="as-next-renew">—</b></span>
          </div>

          <div class="as-error" id="as-error">
            <i class="ri-error-warning-line"></i>
            <span id="as-error-text"></span>
          </div>
        </div>

        <div class="as-col">
          <div class="as-card">
            <div class="as-label"><i class="ri-settings-3-line"></i> Configuración de OBS (esta PC)</div>
            <div class="as-obs-box" style="margin-top:6px;">
              <div class="as-obs-row">
                <span class="as-obs-key"><i class="ri-server-line"></i> Servidor</span>
                <div class="as-obs-val">
                  <span id="as-obs-server">rtmp://localhost:1935/live</span>
                  <button class="as-copy-btn" data-copy="rtmp://localhost:1935/live">
                    <i class="ri-file-copy-line"></i> Copiar
                  </button>
                </div>
              </div>
              <div class="as-obs-row">
                <span class="as-obs-key"><i class="ri-key-2-line"></i> Clave de retransmisión</span>
                <div class="as-obs-val">
                  <span id="as-obs-key-local">togipanel</span>
                  <button class="as-copy-btn" data-copy="togipanel">
                    <i class="ri-file-copy-line"></i> Copiar
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="as-card">
            <div class="as-label"><i class="ri-computer-line"></i> Otra PC en tu red (streaming)</div>
            <div class="as-obs-box" style="margin-top:6px;">
              <div class="as-obs-row">
                <span class="as-obs-key"><i class="ri-server-line"></i> Servidor (RTMP)</span>
                <div class="as-obs-val">
                  <span id="as-lan-url">rtmp://…:1935/live</span>
                  <button class="as-copy-btn" id="as-copy-lan-url" data-copy="">
                    <i class="ri-file-copy-line"></i> Copiar
                  </button>
                </div>
              </div>
              <div class="as-obs-row">
                <span class="as-obs-key"><i class="ri-key-2-line"></i> Clave de retransmisión</span>
                <div class="as-obs-val">
                  <span id="as-lan-key">togipanel</span>
                  <button class="as-copy-btn" id="as-copy-lan-key" data-copy="togipanel">
                    <i class="ri-file-copy-line"></i> Copiar
                  </button>
                </div>
              </div>

              <div class="as-qr-wrap">
                <div class="as-qr-frame">
                  <canvas id="as-qr" width="120" height="120"></canvas>
                </div>
                <div class="as-qr-hint">
                  <b>Escanea desde el móvil</b><br>
                  o copia la URL a OBS en la PC 2.
                </div>
              </div>

              <div class="as-meta">
                <span><i class="ri-signal-tower-line"></i> Estado del proxy: <b id="as-proxy-status">—</b></span>
              </div>
            </div>
          </div>

          <div class="as-hint">
            <i class="ri-information-line"></i>
            <div>
              <b>Importante:</b> para que Auto-Stream funcione necesitas tener
              <b>Streamlabs Desktop instalado</b> y haber iniciado sesión al menos
              una vez con tus cuentas de TikTok. <b>No hace falta tenerlo abierto
              mientras emites.</b> Si una cuenta aparece como "inválida", abre
              Streamlabs Desktop y vuelve a loguearte.
            </div>
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

    panel.addEventListener('click', async (e) => {
      const btn = e.target.closest('.as-copy-btn');
      if (!btn) return;
      const txt = btn.getAttribute('data-copy') || '';
      if (!txt) return;
      const ok = await copiarAlPortapapeles(txt);
      const originalHTML = btn.innerHTML;
      btn.innerHTML = ok
        ? '<i class="ri-check-line"></i> ¡Copiado!'
        : '<i class="ri-close-line"></i> Error';
      btn.style.color = ok ? 'var(--success)' : 'var(--danger)';
      btn.style.borderColor = ok ? 'rgba(79,168,122,0.4)' : 'rgba(194,106,106,0.4)';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.style.color = '';
        btn.style.borderColor = '';
      }, 1400);
    });
  }

  // ============================================================
  // CARGAR CUENTAS (con nombre real de usuario)
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

      const valid = data.accounts.filter(a => a.canBeLive && !a.invalid);
      accounts = valid;

      if (valid.length === 0) {
        select.innerHTML = '<option value="">Sin cuentas válidas</option>';
        showError('No hay cuentas válidas. Abre Streamlabs Desktop y loguéate con al menos una cuenta de TikTok.');
        return;
      }

      hideError();
      select.innerHTML = '';

      valid.forEach((a, i) => {
        const opt = document.createElement('option');
        opt.value = a.apiToken;

        // 🎯 NOMBRE REAL DEL USUARIO
        // Prioridad: nickname > username > displayName > fallback
        const realName = a.nickname || a.username || a.displayName || a.name || `Cuenta ${i + 1}`;
        const handle = a.username && a.username !== realName ? ` (@${a.username})` : '';

        opt.textContent = `${realName}${handle}`;
        select.appendChild(opt);
      });

      selectedToken = valid[0].apiToken;

      select.addEventListener('change', () => {
        selectedToken = select.value;
      });

    } catch (e) {
      select.innerHTML = '<option value="">Error de red</option>';
      showError('No se pudo conectar al servidor: ' + e.message);
    }
  }

  // ============================================================
  // INICIAR / DETENER / RENOVAR
  // ============================================================
  async function startStream() {
    const title = document.getElementById('as-title').value.trim() || 'TogiPanel Stream';
    if (!selectedToken) return showError('Selecciona una cuenta');

    setBusy(true);
    hideError();

    try {
      const r = await fetch(window.SERVER_BASE + '/api/tiktok/proxy/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: selectedToken, title })
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
  // POLLING
  // ============================================================
  function startPolling() {
    stopPolling();
    actualizarEstado();
    statusInterval = setInterval(actualizarEstado, 3000);
  }

  function stopPolling() {
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = null;
    }
  }

  async function actualizarEstado() {
    try {
      const r = await fetch(window.SERVER_BASE + '/api/tiktok/proxy/status');
      const data = await r.json();
      if (data.ok && data.state) updateUI(data.state);
    } catch (e) {}
  }

  // ============================================================
  // ACTUALIZAR UI
  // ============================================================
  function updateUI(state) {
    const status = state.status || 'idle';
    lastState = status;

    const dot = document.getElementById('as-dot');
    const statusEl = document.getElementById('as-status');
    const statusBox = document.getElementById('as-status-box');
    const headBadge = document.getElementById('as-head-badge');
    const btnStart = document.getElementById('as-start');
    const btnStop = document.getElementById('as-stop');
    const btnRenew = document.getElementById('as-renew');
    const meta = document.getElementById('as-meta');

    dot.className = 'as-status-dot ' + (status === 'idle' ? '' : status);
    if (statusBox) statusBox.setAttribute('data-state', status);

    const textos = {
      idle: 'Detenido',
      waiting: 'Esperando a OBS...',
      streaming: 'Emitiendo',
      error: 'Error'
    };
    statusEl.textContent = textos[status] || status;

    if (headBadge) {
      headBadge.className = 'as-head-badge ' + (status === 'idle' ? 'idle' : status);
      const icon = status === 'idle' ? 'ri-circle-fill'
                 : status === 'waiting' ? 'ri-time-line'
                 : status === 'streaming' ? 'ri-live-fill'
                 : 'ri-error-warning-fill';
      headBadge.innerHTML = `<i class="${icon}" style="font-size:${status === 'idle' ? '8px' : '11px'};"></i> <span>${textos[status] || status}</span>`;
    }

    btnStart.disabled = (status !== 'idle' && status !== 'error');
    btnStop.disabled = (status === 'idle');
    btnRenew.disabled = (status !== 'streaming');

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

    if (status === 'error' && state.error) {
      showError(state.error);
    } else if (status !== 'error') {
      hideError();
    }

    if (status === 'streaming' && !statusInterval) {
      startPolling();
    }
    if (status === 'idle' && statusInterval) {
      stopPolling();
    }
  }

  function setBusy(busy) {
    ['as-start', 'as-stop', 'as-renew', 'as-refresh'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = busy;
    });
    if (!busy) {
      actualizarEstado();
    }
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
  // 🎥 INFO DE OBS (IP LAN + URL + QR)
  // ============================================================
  async function loadObsInfo() {
    try {
      const r = await fetch(window.SERVER_BASE + '/api/obs-info');
      const data = await r.json();
      if (!data.ok) return;

      const urlEl   = document.getElementById('as-lan-url');
      const keyEl   = document.getElementById('as-lan-key');
      const stEl    = document.getElementById('as-proxy-status');
      const copyUrl = document.getElementById('as-copy-lan-url');
      const copyKey = document.getElementById('as-copy-lan-key');

      if (urlEl)   urlEl.textContent = data.lanUrl;
      if (keyEl)   keyEl.textContent = data.key;
      if (stEl)    stEl.textContent  = data.statusLabel || data.status || '—';
      if (copyUrl) copyUrl.setAttribute('data-copy', data.lanUrl);
      if (copyKey) copyKey.setAttribute('data-copy', data.key);

      const canvas = document.getElementById('as-qr');
      if (canvas && window.QRCode && typeof window.QRCode.toCanvas === 'function') {
        try {
          await window.QRCode.toCanvas(canvas, data.lanUrl, { width: 120, margin: 1 });
        } catch (e) { /* QR falló, silencioso */ }
      }
    } catch (e) { /* silencioso */ }
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
  // TOGGLE DEL PANEL
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
  // INICIALIZAR
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

  // Esperar a que el DOM tenga las piezas clave
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