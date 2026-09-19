/* ═══════════════════════════════════════════════════════════════
   config-ui.js — UI: sidebar, modales, cuentas, multi-inputs
   Depende de: shared.js (window.Togi)
   ═══════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────
   SUB-PÁGINAS
   ────────────────────────────────────────────── */
function abrirSubpagina(id) {
    const mainConfig = document.getElementById('mainConfig');
    const sub = document.getElementById(id);
    if (!mainConfig || !sub) return;

    document.querySelectorAll('.card > div[id$="Subpage"]').forEach(el => {
        if (el.id !== id) el.classList.remove('open');
    });
    mainConfig.classList.add('hidden');
    sub.classList.add('open');
    window.scrollTo({ top: 0 });
    marcarSidebarActivo(id);
    if (id === 'aiSubpage' && typeof actualizarEstadosProveedores === 'function') {
        actualizarEstadosProveedores();
    }
}

function cerrarSubpagina(id) {
    const mainConfig = document.getElementById('mainConfig');
    const sub = document.getElementById(id);
    if (!mainConfig || !sub) return;
    sub.classList.remove('open');
    mainConfig.classList.remove('hidden');
    window.scrollTo({ top: 0 });
    marcarSidebarActivo(null);
}

/* ──────────────────────────────────────────────
   TOGGLE VISIBILIDAD DE PASSWORD
   ────────────────────────────────────────────── */
function toggleTokenVisibility(btn) {
    const wrapper = btn.closest('.password-wrap');
    if (!wrapper) return;
    const input = wrapper.querySelector('input');
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    const icon = btn.querySelector('i');
    if (icon) icon.className = isPassword ? 'ri-eye-off-line' : 'ri-eye-line';
    btn.title = isPassword ? 'Ocultar' : 'Mostrar';
}

/* ──────────────────────────────────────────────
   MODALES
   ────────────────────────────────────────────── */
function toggleModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
}
function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
}
window.addEventListener('click', function (event) {
    if (event.target.classList && event.target.classList.contains('modal')) {
        event.target.classList.remove('open');
    }
});
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    }
});

/* ──────────────────────────────────────────────
   SIDEBAR
   ────────────────────────────────────────────── */
function marcarSidebarActivo(targetId) {
    document.querySelectorAll('.sidebar-item[data-target]').forEach(item => {
        item.classList.toggle('active', item.dataset.target === targetId);
    });
}

function updateSidebarCounts() {
    if (typeof getCurrentValues !== 'function') return;
    const v = getCurrentValues();

    const setCount = (id, count) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = count;
        el.style.color = count > 0 ? 'var(--accent)' : '';
    };

    setCount('countTwitch', (v.twitchAccounts || []).length);
    setCount('countTikTok', (v.tiktokUsers || []).length);
    setCount('countKick', (v.kickUsers || []).length);
    setCount('countYouTube', (v.youtubeUsers || []).length);
    setCount('countVelora', v.veloraUsername ? 1 : 0);

    const checkAI = document.getElementById('checkAI');
    if (checkAI) {
        checkAI.style.display = (v.aiCohost && v.aiCohost.enabled) ? 'inline-flex' : 'none';
    }

    refrescarCardsLanding();
}

/* ──────────────────────────────────────────────
   LANDING: estado de las cards
   ────────────────────────────────────────────── */
function refrescarCardsLanding() {
    if (typeof getCurrentValues !== 'function') return;
    let v;
    try { v = getCurrentValues(); } catch (e) { return; }

    const set = (id, text, active) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        el.classList.toggle('active', !!active);
    };

    const tw = (v.twitchAccounts || []).length;
    const tk = (v.tiktokUsers || []).length;
    const kk = (v.kickUsers || []).length;
    const yt = (v.youtubeUsers || []).length;

    set('landingSubTwitch',  tw > 0 ? tw + ' cuenta' + (tw === 1 ? '' : 's')  : 'sin configurar', tw > 0);
    set('landingSubTikTok',  tk > 0 ? tk + ' usuario' + (tk === 1 ? '' : 's')  : 'sin configurar', tk > 0);
    set('landingSubKick',    kk > 0 ? kk + ' usuario' + (kk === 1 ? '' : 's')  : 'sin configurar', kk > 0);
    set('landingSubYouTube', yt > 0 ? yt + ' canal' + (yt === 1 ? '' : 'es')   : 'sin configurar', yt > 0);
    set('landingSubVelora',  v.veloraUsername ? '@' + v.veloraUsername         : 'sin configurar', !!v.veloraUsername);
    set('landingSubTTS',     v.tts && v.tts.enabled ? 'activo'                 : 'inactivo',        !!(v.tts && v.tts.enabled));
    set('landingSubOverlay', 'meta ' + (v.crystalMeta || 500), true);
    set('landingSubAI',      v.aiCohost && v.aiCohost.enabled ? 'activo'       : 'inactivo',        !!(v.aiCohost && v.aiCohost.enabled));
}

function initSidebar() {
    document.querySelectorAll('.sidebar-item[data-target]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            if (target && target.endsWith('Subpage')) {
                abrirSubpagina(target);
            }
        });
    });
    updateSidebarCounts();
    if (typeof veloraCargarEstado === 'function') veloraCargarEstado();
}

/* ──────────────────────────────────────────────
   GENERADOR DE IDs
   ────────────────────────────────────────────── */
let _accountCounter = 0;
function uid() {
    _accountCounter++;
    return 'acc_' + Date.now() + '_' + _accountCounter;
}

/* ──────────────────────────────────────────────
   TWITCH: CUENTAS
   ────────────────────────────────────────────── */
function addTwitchAccount(data) {
    const container = document.getElementById('twitchAccountsContainer');
    if (!container) return;
    const id = (data && data.id) || uid();
    const card = document.createElement('div');
    card.className = 'account-card';
    card.dataset.accountId = id;

    const esc = (window.Togi && Togi.escapeHtml) ? Togi.escapeHtml : (s => s || '');
    const clientId = esc((data && data.clientId) || '');
    const oauthToken = esc(((data && data.oauthToken) || '').replace('oauth:', ''));
    const oauthTokenChat = esc(((data && data.oauthTokenChat) || '').replace('oauth:', ''));
    const botUsername = esc((data && data.botUsername) || '');

    card.innerHTML = '' +
        '<div class="account-card-header">' +
        '  <h3><span class="account-num"></span> Cuenta de Twitch</h3>' +
        '  <button class="account-remove-btn" type="button" onclick="removeTwitchAccount(\'' + id + '\')">' +
        '    <i class="ri-delete-bin-line"></i> Quitar cuenta' +
        '  </button>' +
        '</div>' +
        '<div class="input-group">' +
        '  <div class="label-row">' +
        '    <label>Twitch Client ID:</label>' +
        '    <button class="btn-help" type="button" onclick="toggleModal(\'modalClient\')"><i class="ri-question-line"></i> ¿Cómo obtenerlo?</button>' +
        '  </div>' +
        '  <div class="password-wrap">' +
        '    <input type="password" class="acc-client-id" placeholder="Pega aquí el Client ID" value="' + clientId + '" oninput="onFieldChange()" autocomplete="off" spellcheck="false">' +
        '    <button class="toggle-eye-btn" type="button" onclick="toggleTokenVisibility(this)" title="Mostrar"><i class="ri-eye-line"></i></button>' +
        '  </div>' +
        '</div>' +
        '<div class="input-group">' +
        '  <div class="label-row">' +
        '    <label>Twitch Token (API):</label>' +
        '    <button class="btn-help" type="button" onclick="toggleModal(\'modalToken\')"><i class="ri-question-line"></i> ¿Cómo generarlo?</button>' +
        '  </div>' +
        '  <div class="password-wrap">' +
        '    <input type="password" class="acc-oauth-token" placeholder="Pega el token API (sin oauth:)" value="' + oauthToken + '" oninput="onFieldChange()" autocomplete="off" spellcheck="false">' +
        '    <button class="toggle-eye-btn" type="button" onclick="toggleTokenVisibility(this)" title="Mostrar"><i class="ri-eye-line"></i></button>' +
        '  </div>' +
        '  <div class="hint-oauth">' +
        '    <i class="ri-information-line"></i>' +
        '    <span><b>No escribas "oauth:"</b>. El sistema lo agrega solo.</span>' +
        '  </div>' +
        '</div>' +
        '<div class="input-group">' +
        '  <div class="label-row">' +
        '    <label>Twitch Token (Chat):</label>' +
        '    <span style="font-size: 12px; color: #6f6c80;">Opcional</span>' +
        '  </div>' +
        '  <div class="password-wrap">' +
        '    <input type="password" class="acc-oauth-token-chat" placeholder="Pega el token de chat (sin oauth:)" value="' + oauthTokenChat + '" oninput="onFieldChange()" autocomplete="off" spellcheck="false">' +
        '    <button class="toggle-eye-btn" type="button" onclick="toggleTokenVisibility(this)" title="Mostrar"><i class="ri-eye-line"></i></button>' +
        '  </div>' +
        '  <div class="hint-chat">' +
        '    <i class="ri-information-line"></i>' +
        '    <span>Solo necesita <code>chat:read</code> y <code>chat:edit</code>. Si no lo pones, se usa el token API.</span>' +
        '  </div>' +
        '</div>' +
        '<div class="input-group">' +
        '  <div class="label-row">' +
        '    <label>Twitch Bot Username:</label>' +
        '    <span style="font-size: 12px; color: #6f6c80;">El usuario de esta cuenta</span>' +
        '  </div>' +
        '  <input type="text" class="acc-bot-username" placeholder="usuario" value="' + botUsername + '" oninput="onFieldChange()">' +
        '</div>' +
        '<div class="input-group" style="margin-bottom: 0;">' +
        '  <div class="label-row">' +
        '    <label>Canales de esta cuenta:</label>' +
        '    <span style="font-size: 12px; color: #6f6c80;">1 o más</span>' +
        '  </div>' +
        '  <div class="multi-list acc-channels-list"></div>' +
        '  <button class="add-item-btn" type="button" onclick="addChannelToAccount(\'' + id + '\')"><i class="ri-add-line"></i> Añadir otro canal</button>' +
        '</div>';

    container.appendChild(card);

    const channels = (data && Array.isArray(data.channels)) ? data.channels : [];
    if (channels.length === 0) addChannelToAccount(id, '');
    else channels.forEach(c => addChannelToAccount(id, c));

    renumberAccounts();
}

function removeTwitchAccount(id) {
    const container = document.getElementById('twitchAccountsContainer');
    if (!container) return;
    const card = container.querySelector('[data-account-id="' + id + '"]');
    if (!card) return;
    const total = container.querySelectorAll('.account-card').length;
    if (total === 1) {
        alert('Debes tener al menos una cuenta de Twitch (aunque esté vacía).');
        return;
    }
    if (!confirm('¿Quitar esta cuenta de Twitch y todos sus canales?')) return;
    card.remove();
    renumberAccounts();
    if (typeof onFieldChange === 'function') onFieldChange();
}

function renumberAccounts() {
    const cards = document.querySelectorAll('#twitchAccountsContainer .account-card');
    cards.forEach((card, i) => {
        const num = card.querySelector('.account-num');
        if (num) num.textContent = (i + 1);
    });
}

function addChannelToAccount(accountId, value) {
    const card = document.querySelector('[data-account-id="' + accountId + '"]');
    if (!card) return;
    const list = card.querySelector('.acc-channels-list');
    if (!list) return;
    const esc = (window.Togi && Togi.escapeHtml) ? Togi.escapeHtml : (s => s || '');
    const row = document.createElement('div');
    row.className = 'multi-row';
    row.innerHTML = '' +
        '<input type="text" class="twitch-channel-input" placeholder="nombre_del_canal" value="' + esc(value || '') + '" oninput="onFieldChange()">' +
        '<button class="remove-item-btn" type="button" onclick="removeChannelFromAccount(this)" title="Quitar"><i class="ri-close-line"></i></button>';
    list.appendChild(row);
    if (!value) {
        const input = row.querySelector('input');
        if (input) input.focus();
    }
}

function removeChannelFromAccount(btn) {
    const row = btn.closest('.multi-row');
    if (!row) return;
    const list = row.parentElement;
    row.remove();
    if (list.children.length === 0) {
        const accountCard = list.closest('.account-card');
        if (accountCard) addChannelToAccount(accountCard.dataset.accountId, '');
    }
    if (typeof onFieldChange === 'function') onFieldChange();
}

function getAccountsFromDOM() {
    const cards = document.querySelectorAll('#twitchAccountsContainer .account-card');
    const accounts = [];
    cards.forEach(card => {
        const id = card.dataset.accountId;
        const clientId = card.querySelector('.acc-client-id').value.trim();
        const oauthToken = card.querySelector('.acc-oauth-token').value.trim();
        const oauthTokenChat = card.querySelector('.acc-oauth-token-chat').value.trim();
        const botUsername = card.querySelector('.acc-bot-username').value.trim();
        const channels = [];
        card.querySelectorAll('.twitch-channel-input').forEach(inp => {
            const v = inp.value.trim();
            if (v) channels.push(v);
        });
        if (clientId || oauthToken || botUsername || channels.length > 0) {
            accounts.push({ id, clientId, oauthToken, oauthTokenChat, botUsername, channels });
        }
    });
    return accounts;
}

/* ──────────────────────────────────────────────
   MULTI-INPUT
   ────────────────────────────────────────────── */
function addMultiInput(containerId, value, placeholder, inputClass) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const esc = (window.Togi && Togi.escapeHtml) ? Togi.escapeHtml : (s => s || '');
    const row = document.createElement('div');
    row.className = 'multi-row';
    row.innerHTML = '' +
        '<input type="text" class="' + inputClass + '" placeholder="' + esc(placeholder) + '" value="' + esc(value || '') + '" oninput="onFieldChange()">' +
        '<button class="remove-item-btn" type="button" onclick="removeMultiInput(this)" title="Quitar"><i class="ri-close-line"></i></button>';
    container.appendChild(row);
    if (!value) {
        const newInput = row.querySelector('input');
        if (newInput) newInput.focus();
    }
}

function removeMultiInput(btn) {
    const row = btn.closest('.multi-row');
    if (!row) return;
    const container = row.parentElement;
    const containerId = container.id;
    row.remove();
    if (container.children.length === 0) {
        if (containerId === 'tiktokUsersList') addMultiInput(containerId, '', '@usuario', 'tiktok-user-input');
        else if (containerId === 'kickUsersList') addMultiInput(containerId, '', 'usuario_kick', 'kick-user-input');
        else if (containerId === 'youtubeUsersList') addMultiInput(containerId, '', '@canal o UCxxxx', 'youtube-user-input');
    }
    if (typeof onFieldChange === 'function') onFieldChange();
}

function getMultiValues(containerId, inputClass) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    const values = [];
    container.querySelectorAll('input.' + inputClass).forEach(i => {
        const v = i.value.trim();
        if (v) values.push(v);
    });
    return values;
}

function clearMultiInputs(containerId) {
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = '';
}

function addTikTokUser(value)   { addMultiInput('tiktokUsersList',  value || '', '@usuario',        'tiktok-user-input'); }
function addKickUser(value)     { addMultiInput('kickUsersList',    value || '', 'usuario_kick',    'kick-user-input'); }
function addYouTubeUser(value)  { addMultiInput('youtubeUsersList', value || '', '@canal o UCxxxx', 'youtube-user-input'); }

function loadTikTokUsers(users) {
    clearMultiInputs('tiktokUsersList');
    if (Array.isArray(users) && users.length > 0) users.forEach(u => addTikTokUser(u));
    else addTikTokUser('');
}
function loadKickUsers(users) {
    clearMultiInputs('kickUsersList');
    if (Array.isArray(users) && users.length > 0) users.forEach(u => addKickUser(u));
    else addKickUser('');
}
function loadYouTubeUsers(users) {
    clearMultiInputs('youtubeUsersList');
    if (Array.isArray(users) && users.length > 0) users.forEach(u => addYouTubeUser(u));
    else addYouTubeUser('');
}

/* ──────────────────────────────────────────────
   VELORA
   ────────────────────────────────────────────── */
async function veloraConectar() {
    const input = document.getElementById('veloraUsername');
    const statusEl = document.getElementById('veloraStatus');
    const btn = document.getElementById('btnVeloraConnect');
    const username = (input?.value || '').replace(/^@/, '').trim();

    if (!username) {
        statusEl.className = 'test-result fail show';
        statusEl.textContent = '⚠️ Escribe tu usuario de Velora.';
        return;
    }

    if (btn) btn.disabled = true;
    statusEl.className = 'test-result';
    statusEl.textContent = 'Conectando…';

    try {
        const r = await fetch(`${window.SERVER_BASE}/api/velora/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await r.json();
        if (data.ok) {
            statusEl.className = 'test-result ok show';
            statusEl.innerHTML = `✅ Conectado a <b>@${data.channelName || username}</b>.`;
        } else {
            statusEl.className = 'test-result fail show';
            statusEl.textContent = '❌ ' + (data.error || 'No se pudo conectar');
        }
    } catch (e) {
        statusEl.className = 'test-result fail show';
        statusEl.textContent = '❌ Error de conexión: ' + e.message;
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function veloraDesconectar() {
    const statusEl = document.getElementById('veloraStatus');
    try {
        await fetch(`${window.SERVER_BASE}/api/velora/disconnect`, { method: 'POST' });
        statusEl.className = 'test-result show';
        statusEl.textContent = '🔌 Desconectado.';
    } catch (e) {
        statusEl.className = 'test-result fail show';
        statusEl.textContent = '❌ ' + e.message;
    }
}

async function veloraCargarEstado() {
    try {
        const r = await fetch(`${window.SERVER_BASE}/api/velora/status`);
        const data = await r.json();
        const statusEl = document.getElementById('veloraStatus');
        const input = document.getElementById('veloraUsername');
        if (!statusEl) return;
        if (data.connected) {
            statusEl.className = 'test-result ok show';
            statusEl.innerHTML = `🟢 Conectado a <b>@${data.channelName || '?'}</b> · viewers: ${data.viewerCount || 0}`;
            if (input && !input.value && data.channelName) input.value = data.channelName;
        } else if (data.channelName) {
            statusEl.className = 'test-result';
            statusEl.textContent = `⚪ Guardado @${data.channelName} · desconectado`;
            if (input && !input.value) input.value = data.channelName;
        } else {
            statusEl.className = 'test-result';
            statusEl.textContent = 'Configura un usuario y pulsa Conectar.';
        }
    } catch (e) {}
}

console.log('🎨 config-ui.js cargado');