// ============================================================
// autostream.js — Panel de Auto-Stream TikTok (Fase 5)
// Se inyecta en el dashboard al pulsar el botón del header.
// ============================================================

(function () {
  'use strict';

  let accounts = [];
  let selectedToken = null;
  let statusInterval = null;
  let lastState = 'idle';

  // ============================================================
  // INYECTAR CSS
  // ============================================================
  function injectStyles() {
    if (document.getElementById('autostream-styles')) return;
    const style = document.createElement('style');
    style.id = 'autostream-styles';
    style.textContent = `
      #autostream-panel {
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--r-lg);
        padding: 18px 20px;
        margin-bottom: 22px;
        display: none;
      }
      #autostream-panel.open { display: block; }

      #autostream-panel h2 {
        font-size: 14px; margin-bottom: 16px; font-weight: 600;
        display: flex; align-items: center; gap: 9px;
        color: #e4e6eb;
      }
      #autostream-panel h2 i { color: var(--secondary); font-size: 16px; }

      .as-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 20px;
      }
      @media (max-width: 900px) { .as-grid { grid-template-columns: 1fr; } }

      .as-col { display: flex; flex-direction: column; gap: 10px; }

      .as-label {
        font-size: 10.5px; color: var(--text-muted);
        text-transform: uppercase; letter-spacing: 0.06em;
        font-weight: 600; margin-bottom: 4px;
        display: flex; align-items: center; gap: 6px;
      }

      .as-status {
        display: flex; align-items: center; gap: 10px;
        padding: 12px 14px; border-radius: var(--r-md);
        background: var(--bg-input); border: 1px solid var(--border);
        font-size: 13px;
      }
      .as-status-dot {
        width: 10px; height: 10px; border-radius: 50%;
        background: #6b7280; flex-shrink: 0;
      }
      .as-status-dot.waiting   { background: var(--warning); }
      .as-status-dot.streaming { background: var(--success); animation: pulse 1.6s infinite; }
      .as-status-dot.error     { background: var(--danger); }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50%      { opacity: 0.35; }
      }
      .as-status-label { color: var(--text-dim); font-size: 12px; }
      .as-status-value { color: var(--text); font-weight: 600; margin-left: auto; }

      .as-btn {
        display: inline-flex; align-items: center; justify-content: center;
        gap: 6px; padding: 10px 14px; border-radius: var(--r-sm);
        font-weight: 600; font-size: 12.5px; cursor: pointer;
        font-family: inherit; transition: all 0.15s;
        border: 1px solid transparent;
      }
      .as-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .as-btn-primary {
        background: rgba(214,123,168,0.12); color: var(--secondary);
        border-color: rgba(214,123,168,0.3);
      }
      .as-btn-primary:hover:not(:disabled) { background: rgba(214,123,168,0.2); }
      .as-btn-danger {
        background: rgba(194,106,106,0.08); color: var(--danger);
        border-color: rgba(194,106,106,0.2);
      }
      .as-btn-danger:hover:not(:disabled) { background: rgba(194,106,106,0.15); }
      .as-btn-warning {
        background: rgba(214,168,74,0.08); color: var(--warning);
        border-color: rgba(214,168,74,0.2);
      }
      .as-btn-warning:hover:not(:disabled) { background: rgba(214,168,74,0.15); }

      .as-row-actions {
        display: grid; grid-template-columns: 2fr 1fr; gap: 8px;
      }

      .as-obs-box {
        background: var(--bg-input); border: 1px solid var(--border);
        border-radius: var(--r-sm); padding: 12px 14px;
        display: flex; flex-direction: column; gap: 10px;
      }
      .as-obs-row { display: flex; flex-direction: column; gap: 4px; }
      .as-obs-key {
        font-size: 10.5px; color: var(--text-muted);
        text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
      }
      .as-obs-val {
        font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 12px; color: var(--text);
        background: var(--bg-panel); border: 1px solid var(--border);
        padding: 6px 9px; border-radius: 4px;
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px;
      }
      .as-obs-val span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .as-copy-btn {
        background: transparent; border: 1px solid var(--border);
        color: var(--text-dim); border-radius: 4px; padding: 3px 8px;
        font-size: 11px; cursor: pointer; flex-shrink: 0;
        font-family: inherit;
      }
      .as-copy-btn:hover { color: var(--primary-soft); border-color: var(--primary); }

      .as-hint {
        background: rgba(90,138,214,0.06); border: 1px solid rgba(90,138,214,0.2);
        border-radius: var(--r-sm); padding: 10px 12px;
        font-size: 12px; color: var(--text-dim); line-height: 1.5;
        display: flex; gap: 9px; align-items: flex-start;
      }
      .as-hint i { color: var(--info); font-size: 15px; flex-shrink: 0; margin-top: 1px; }
      .as-hint b { color: var(--text); }

      .as-error {
        background: rgba(194,106,106,0.08); border: 1px solid rgba(194,106,106,0.25);
        border-radius: var(--r-sm); padding: 10px 12px;
        font-size: 12px; color: var(--danger);
        display: none; gap: 9px; align-items: flex-start;
      }
      .as-error.show { display: flex; }
      .as-error i { font-size: 15px; flex-shrink: 0; margin-top: 1px; }

      .as-meta {
        font-size: 11px; color: var(--text-muted);
        display: flex; gap: 14px; flex-wrap: wrap;
      }
      .as-meta b { color: var(--text-dim); font-weight: 600; }

      .as-refresh-btn {
        background: transparent; border: 1px solid var(--border);
        color: var(--text-dim); padding: 5px 10px; border-radius: 5px;
        font-size: 11.5px; cursor: pointer; font-family: inherit;
        display: inline-flex; align-items: center; gap: 5px;
      }
      .as-refresh-btn:hover { color: var(--primary-soft); border-color: var(--primary); }
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
      <h2><i class="ri-live-fill"></i> Auto-Stream TikTok</h2>

      <div class="as-grid">
        <div class="as-col">
          <div>
            <div class="as-label">
              <i class="ri-user-3-line"></i> Cuenta de TikTok
              <button class="as-refresh-btn" id="as-refresh" style="margin-left:auto;">
                <i class="ri-refresh-line"></i> Refrescar
              </button>
            </div>
            <select id="as-account"></select>
          </div>

          <div>
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

          <div class="as-status">
            <div class="as-status-dot" id="as-dot"></div>
            <span class="as-status-label">Estado</span>
            <span class="as-status-value" id="as-status">Detenido</span>
          </div>

          <div class="as-meta" id="as-meta" style="display:none;">
            <span>Cuenta: <b id="as-username">—</b></span>
            <span>Última renovación: <b id="as-last-renew">—</b></span>
            <span>Próxima: <b id="as-next-renew">—</b></span>
          </div>

          <div class="as-error" id="as-error">
            <i class="ri-error-warning-line"></i>
            <span id="as-error-text"></span>
          </div>
        </div>

        <div class="as-col">
          <div>
            <div class="as-label"><i class="ri-settings-3-line"></i> Configuración de OBS (una sola vez)</div>
            <div class="as-obs-box">
              <div class="as-obs-row">
                <span class="as-obs-key">Servidor</span>
                <div class="as-obs-val">
                  <span id="as-obs-server">rtmp://localhost:1935/live</span>
                  <button class="as-copy-btn" data-copy="rtmp://localhost:1935/live">Copiar</button>
                </div>
              </div>
              <div class="as-obs-row">
                <span class="as-obs-key">Clave de retransmisión</span>
                <div class="as-obs-val">
                  <span>togipanel</span>
                  <button class="as-copy-btn" data-copy="togipanel">Copiar</button>
                </div>
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

    document.getElementById('as-refresh').addEventListener('click', loadAccounts);
    document.getElementById('as-start').addEventListener('click', startStream);
    document.getElementById('as-stop').addEventListener('click', stopStream);
    document.getElementById('as-renew').addEventListener('click', renewStream);
    panel.querySelectorAll('.as-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const txt = btn.getAttribute('data-copy');
        navigator.clipboard.writeText(txt).then(() => {
          const old = btn.textContent;
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = old; }, 1200);
        }).catch(() => {});
      });
    });
  }

  // ============================================================
  // CARGAR CUENTAS
  // ============================================================
  async function loadAccounts() {
    const select = document.getElementById('as-account');
    if (!select) return;
    select.innerHTML = '<option value="">Cargando...</option>';

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
      valid.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.apiToken;
        opt.textContent = a.username + (a.nickname && a.nickname !== a.username ? ' (' + a.nickname + ')' : '');
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
  // INICIAR STREAM
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

  // ============================================================
  // DETENER STREAM
  // ============================================================
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
  // RENOVAR CLAVE
  // ============================================================
  async function renewStream() {
    try {
      await fetch(window.SERVER_BASE + '/api/tiktok/proxy/renew', { method: 'POST' });
    } catch (e) {
      showError('Error al renovar: ' + e.message);
    }
  }

  // ============================================================
  // POLLING DE ESTADO
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
  // ACTUALIZAR UI SEGÚN ESTADO
  // ============================================================
  function updateUI(state) {
    const status = state.status || 'idle';
    lastState = status;

    const dot = document.getElementById('as-dot');
    const statusEl = document.getElementById('as-status');
    const btnStart = document.getElementById('as-start');
    const btnStop = document.getElementById('as-stop');
    const btnRenew = document.getElementById('as-renew');
    const meta = document.getElementById('as-meta');

    dot.className = 'as-status-dot ' + (status === 'idle' ? '' : status);

    const textos = {
      idle: 'Detenido',
      waiting: 'Esperando a OBS...',
      streaming: 'Emitiendo',
      error: 'Error'
    };
    statusEl.textContent = textos[status] || status;

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
      // Re-aplicar estado real
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
  // TOGGLE DEL PANEL
  // ============================================================
  function togglePanel() {
    const panel = document.getElementById('autostream-panel');
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      loadAccounts();
      actualizarEstado();
    }
  }

  // ============================================================
  // INICIALIZAR AL CARGAR EL DASHBOARD
  // ============================================================
  function init() {
    injectStyles();
    buildPanel();

    // Añadir botón en el header
    const headerRight = document.querySelector('.header-right');
    if (headerRight) {
      const btn = document.createElement('button');
      btn.className = 'toggle-right-btn';
      btn.id = 'toggle-autostream-btn';
      btn.style.cssText = 'color: var(--secondary); border-color: rgba(214,123,168,0.3);';
      btn.innerHTML = '<i class="ri-live-fill"></i> <span>Auto-Stream</span>';
      btn.addEventListener('click', togglePanel);
      headerRight.insertBefore(btn, headerRight.firstChild);
    }

    // Añadir enlace en el sidebar
    const sidebarBottom = document.querySelector('.sidebar-bottom');
    if (sidebarBottom) {
      const link = document.createElement('a');
      link.className = 'sidebar-item';
      link.href = '#';
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 400));
  } else {
    setTimeout(init, 400);
  }

})();