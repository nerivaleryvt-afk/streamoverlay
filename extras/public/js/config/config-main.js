/* ═══════════════════════════════════════════════════════════════
   config-main.js — Estado, persistencia, guardado y arranque
   Depende de: shared.js, config-ui.js, config-ai.js
   ═══════════════════════════════════════════════════════════════ */

const STORAGE_KEY = 'togi_config_backup_v2';
let hasUnsavedChanges = false;
let originalValues = {};
let currentServerConfig = {};

function getAiCohostValues() {
    return {
        enabled: document.getElementById('aiEnabled').checked,
        nombre: document.getElementById('aiNombre').value.trim(),
        personalidad: document.getElementById('aiPersonalidad').value.trim(),
        comando: document.getElementById('aiComando').value.trim() || '!guia',
        proveedores: {
            groq:       { apiKey: document.getElementById('aiKeyGroq').value.trim(),       modelo: currentServerConfig?.aiCohost?.proveedores?.groq?.modelo       || 'openai/gpt-oss-20b' },
            cerebras:   { apiKey: document.getElementById('aiKeyCerebras').value.trim(),   modelo: currentServerConfig?.aiCohost?.proveedores?.cerebras?.modelo   || 'gpt-oss-120b' },
            openrouter: { apiKey: document.getElementById('aiKeyOpenRouter').value.trim(), modelo: currentServerConfig?.aiCohost?.proveedores?.openrouter?.modelo || 'meta-llama/llama-3.1-8b-instruct:free' },
            agnes:      { apiKey: document.getElementById('aiKeyAgnes').value.trim(),      modelo: currentServerConfig?.aiCohost?.proveedores?.agnes?.modelo      || 'agnes-2.5-flash' }
        }
    };
}

function getCurrentValues() {
    return {
        twitchAccounts: getAccountsFromDOM(),
        tiktokUsers: getMultiValues('tiktokUsersList', 'tiktok-user-input').map(s => s.replace(/^@/, '')),
        kickUsers: getMultiValues('kickUsersList', 'kick-user-input').map(s => s.replace(/^@/, '')),
        youtubeUsers: getMultiValues('youtubeUsersList', 'youtube-user-input'),
        enableCensorship: document.getElementById('enableCensorship').checked,
        platformsEnabled: {
            twitch:  document.getElementById('platformTwitch').checked,
            tiktok:  document.getElementById('platformTikTok').checked,
            kick:    document.getElementById('platformKick').checked,
            youtube: document.getElementById('platformYouTube').checked,
            velora:  document.getElementById('platformVelora').checked
        },
        veloraUsername: (document.getElementById('veloraUsername')?.value || '').replace(/^@/, '').trim(),
        tts: {
            enabled: document.getElementById('ttsEnabled').checked,
            voice:   document.getElementById('ttsVoice').value,
            rate:    (document.getElementById('ttsRate').value >= 0 ? '+' : '') + document.getElementById('ttsRate').value + '%',
            pitch:   (document.getElementById('ttsPitch').value >= 0 ? '+' : '') + document.getElementById('ttsPitch').value + 'Hz',
            volume:  parseInt(document.getElementById('ttsVolume').value, 10) / 100,
            readFrom: {
                twitch:  document.getElementById('ttsFromTwitch').checked,
                tiktok:  document.getElementById('ttsFromTikTok').checked,
                kick:    document.getElementById('ttsFromKick').checked,
                youtube: document.getElementById('ttsFromYouTube').checked
            },
            readEvents: {
                chat:    document.getElementById('ttsEventChat').checked,
                gifts:   document.getElementById('ttsEventGifts').checked,
                follows: document.getElementById('ttsEventFollows').checked,
                subs:    document.getElementById('ttsEventSubs').checked,
                donations: false
            }
        },
        aiCohost: getAiCohostValues(),
        crystalStyle: document.getElementById('crystalStyle').value || 'jar',
        crystalMeta: parseInt(document.getElementById('crystalMeta').value, 10) || 500,
                kick: {
            connected: !!(currentServerConfig?.kick?.connected),
            username: currentServerConfig?.kick?.username || (currentServerConfig?.KICK_USERS?.[0] || ''),
            lastCheck: currentServerConfig?.kick?.lastCheck || 0
        }
    };
}

function applyValues(v) {
    const container = document.getElementById('twitchAccountsContainer');
    container.innerHTML = '';
    const accounts = Array.isArray(v.twitchAccounts) && v.twitchAccounts.length > 0
        ? v.twitchAccounts
        : [{ id: uid(), clientId: '', oauthToken: '', oauthTokenChat: '', botUsername: '', channels: [] }];
    accounts.forEach(acc => addTwitchAccount(acc));
    document.getElementById('enableCensorship').checked = v.enableCensorship || false;

    const pe = v.platformsEnabled || { twitch: true, tiktok: true, kick: true, youtube: true, velora: true };
    document.getElementById('platformTwitch').checked  = pe.twitch  !== false;
    document.getElementById('platformTikTok').checked  = pe.tiktok  !== false;
    document.getElementById('platformKick').checked    = pe.kick    !== false;
    document.getElementById('platformYouTube').checked = pe.youtube !== false;
    document.getElementById('platformVelora').checked  = pe.velora  !== false;

    const veloraUserEl = document.getElementById('veloraUsername');
    if (veloraUserEl) veloraUserEl.value = v.veloraUsername || '';

    loadTikTokUsers(v.tiktokUsers || []);
    loadKickUsers(v.kickUsers || []);
    loadYouTubeUsers(v.youtubeUsers || []);

    const tts = v.tts || {};
    document.getElementById('ttsEnabled').checked = tts.enabled !== false;
    document.getElementById('ttsVoice').value = tts.voice || 'es-ES-AlvaroNeural';

    const rate = parseInt(String(tts.rate || '+0%').replace(/[^\-0-9]/g, ''), 10) || 0;
    document.getElementById('ttsRate').value = rate;
    document.getElementById('ttsRateVal').textContent = (rate > 0 ? '+' : '') + rate + '%';

    const pitch = parseInt(String(tts.pitch || '+0Hz').replace(/[^\-0-9]/g, ''), 10) || 0;
    document.getElementById('ttsPitch').value = pitch;
    document.getElementById('ttsPitchVal').textContent = (pitch > 0 ? '+' : '') + pitch + 'Hz';

    const vol = Math.round((tts.volume != null ? tts.volume : 0.8) * 100);
    document.getElementById('ttsVolume').value = vol;
    document.getElementById('ttsVolumeVal').textContent = vol + '%';

    const rf = tts.readFrom || {};
    document.getElementById('ttsFromTwitch').checked  = rf.twitch  !== false;
    document.getElementById('ttsFromTikTok').checked  = rf.tiktok  !== false;
    document.getElementById('ttsFromKick').checked    = rf.kick    !== false;
    document.getElementById('ttsFromYouTube').checked = rf.youtube !== false;

    const re = tts.readEvents || {};
    document.getElementById('ttsEventChat').checked    = re.chat    !== false;
    document.getElementById('ttsEventGifts').checked   = re.gifts   === true;
    document.getElementById('ttsEventFollows').checked = re.follows === true;
    document.getElementById('ttsEventSubs').checked    = re.subs    === true;

    const ai = v.aiCohost || {};
    document.getElementById('aiEnabled').checked = ai.enabled === true;
    document.getElementById('aiNombre').value = ai.nombre || '';
    document.getElementById('aiPersonalidad').value = ai.personalidad || '';
    document.getElementById('aiComando').value = ai.comando || '!guia';
    const provs = ai.proveedores || {};
    document.getElementById('aiKeyGroq').value = (provs.groq && provs.groq.apiKey) ? provs.groq.apiKey : '';
    document.getElementById('aiKeyCerebras').value = (provs.cerebras && provs.cerebras.apiKey) ? provs.cerebras.apiKey : '';
    document.getElementById('aiKeyOpenRouter').value = (provs.openrouter && provs.openrouter.apiKey) ? provs.openrouter.apiKey : '';
    document.getElementById('aiKeyAgnes').value = (provs.agnes && provs.agnes.apiKey) ? provs.agnes.apiKey : '';

    document.getElementById('crystalStyle').value = v.crystalStyle || 'jar';
    document.getElementById('crystalMeta').value = v.crystalMeta || 500;

        // 🟢 Kick — no necesita campos especiales en el form (login embebido)
}

function saveToLocalStorage(values) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch (e) {}
}

function loadFromLocalStorage() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) return JSON.parse(data);
    } catch (e) {}
    return null;
}

function updateUnsavedBadge() {
    const current = getCurrentValues();
    const hasChanges = JSON.stringify(current) !== JSON.stringify(originalValues);
    const badge = document.getElementById('unsavedBadge');
    if (badge) {
        if (hasChanges) badge.classList.add('show');
        else badge.classList.remove('show');
    }
    hasUnsavedChanges = hasChanges;
}

function onFieldChange() {
    updateUnsavedBadge();
    saveToLocalStorage(getCurrentValues());
    updateSidebarCounts();
}

function extractFromServerConfig(config) {
    let twitchAccounts = [];
    if (Array.isArray(config.TWITCH_ACCOUNTS) && config.TWITCH_ACCOUNTS.length > 0) {
        twitchAccounts = config.TWITCH_ACCOUNTS.map((acc, i) => ({
            id: acc.id || ('acc_migrated_' + i),
            clientId: acc.clientId || '',
            oauthToken: acc.oauthToken || '',
            oauthTokenChat: acc.oauthTokenChat || '',
            botUsername: acc.botUsername || '',
            channels: Array.isArray(acc.channels) ? acc.channels : []
        }));
    } else {
        const clientId = config.TWITCH_CLIENT_ID || '';
        const oauthToken = config.TWITCH_OAUTH_TOKEN || '';
        const oauthTokenChat = config.TWITCH_OAUTH_TOKEN_CHAT || '';
        const botUsername = config.TWITCH_BOT_USERNAME || '';
        const channels = Array.isArray(config.channels) && config.channels.length > 0
            ? config.channels
            : (config.TWITCH_CHANNEL ? [config.TWITCH_CHANNEL] : []);
        if (clientId || oauthToken || botUsername || channels.length > 0) {
            twitchAccounts.push({ id: 'acc_legacy', clientId, oauthToken, oauthTokenChat, botUsername, channels });
        }
    }

    let aiCohost = { enabled: false, nombre: '', personalidad: '', comando: '!guia', proveedores: { groq: { apiKey: '' }, cerebras: { apiKey: '' }, openrouter: { apiKey: '' }, agnes: { apiKey: '' } } };
    if (config.aiCohost && typeof config.aiCohost === 'object') {
        const enmascarar = (v) => {
            if (!v) return '';
            if (v === '***') return '••••••••';
            return v;
        };
        aiCohost = {
            enabled: config.aiCohost.enabled === true,
            nombre: config.aiCohost.nombre || '',
            personalidad: config.aiCohost.personalidad || '',
            comando: config.aiCohost.comando || '!guia',
            proveedores: {
                groq:       { apiKey: enmascarar(config.aiCohost.proveedores?.groq?.apiKey) },
                cerebras:   { apiKey: enmascarar(config.aiCohost.proveedores?.cerebras?.apiKey) },
                openrouter: { apiKey: enmascarar(config.aiCohost.proveedores?.openrouter?.apiKey) },
                agnes:      { apiKey: enmascarar(config.aiCohost.proveedores?.agnes?.apiKey) }
            }
        };
    }

    return {
        twitchAccounts,
        tiktokUsers: Array.isArray(config.TIKTOK_USERS) && config.TIKTOK_USERS.length > 0
            ? config.TIKTOK_USERS
            : (config.TIKTOK_USER_ID ? String(config.TIKTOK_USER_ID).split(',').map(s => s.trim()).filter(Boolean) : []),
        kickUsers: Array.isArray(config.KICK_USERS) && config.KICK_USERS.length > 0
            ? config.KICK_USERS
            : (config.KICK_USERNAME ? [config.KICK_USERNAME] : []),
        youtubeUsers: Array.isArray(config.YOUTUBE_USERS) && config.YOUTUBE_USERS.length > 0
            ? config.YOUTUBE_USERS
            : (config.YOUTUBE_USER_ID ? String(config.YOUTUBE_USER_ID).split(',').map(s => s.trim()).filter(Boolean) : []),
        enableCensorship: config.ENABLE_CENSORSHIP || false,
        platformsEnabled: config.PLATFORMS_ENABLED || { twitch: true, tiktok: true, kick: true, youtube: true, velora: true },
        veloraUsername: config.VELORA_USERNAME || '',
        tts: config.TTS || {},
        aiCohost,
        crystalStyle: config.CRYSTAL_STYLE || 'jar',
        crystalMeta: typeof config.JAR_META === 'number' ? config.JAR_META : 500,
                kick: {
            connected: !!(config.kick && config.kick.connected),
            username: (config.kick && config.kick.username) || (config.KICK_USERS?.[0] || config.KICK_USERNAME || ''),
            lastCheck: (config.kick && config.kick.lastCheck) || 0
        }
    };
}

async function restoreFromServer() {
    try {
        const response = await fetch(`${window.SERVER_BASE}/get-config`);
        if (response.ok) {
            const config = await response.json();
            currentServerConfig = config;
            applyValues(extractFromServerConfig(config));
            originalValues = getCurrentValues();
            saveToLocalStorage(originalValues);
            updateUnsavedBadge();
            updateSidebarCounts();
            alert('Datos restaurados desde el servidor.');
        } else {
            alert('Error al restaurar desde el servidor.');
        }
    } catch (e) {
        alert('Error de conexión al restaurar.');
    }
}

async function loadConfigData() {
    applyValues({ twitchAccounts: [] });
    const localData = loadFromLocalStorage();
    if (localData) {
        applyValues(localData);
        originalValues = getCurrentValues();
        updateUnsavedBadge();
    }
    try {
        const response = await fetch(`${window.SERVER_BASE}/get-config`);
        if (response.ok) {
            const config = await response.json();
            currentServerConfig = config;
            applyValues(extractFromServerConfig(config));
            originalValues = getCurrentValues();
            saveToLocalStorage(originalValues);
            updateUnsavedBadge();
            updateSidebarCounts();
            actualizarEstadosProveedores();
        }
    } catch (e) {
        console.log('Servidor no disponible, usando datos locales');
    }
}

async function saveConfig() {
    const v = getCurrentValues();
    const accounts = v.twitchAccounts;

    const tieneTwitch = accounts.length > 0;
    const tieneTikTok = v.tiktokUsers.length > 0;
    const tieneKick = v.kickUsers.length > 0;
    const tieneYouTube = v.youtubeUsers.length > 0;
    const tieneVelora = !!v.veloraUsername;
    const tieneAI = v.aiCohost && v.aiCohost.enabled;

    if (!tieneTwitch && !tieneTikTok && !tieneKick && !tieneYouTube && !tieneVelora && !tieneAI) {
        alert('No has configurado nada.\nRellena al menos una plataforma o activa el AI Co-Host.');
        return;
    }

    if (tieneTwitch && v.platformsEnabled.twitch) {
        const incompletas = accounts.filter(acc =>
            !acc.clientId || !acc.oauthToken || !acc.botUsername || acc.channels.length === 0
        );
        if (incompletas.length > 0) {
            const continuar = confirm(
                'Hay ' + incompletas.length + ' cuenta(s) de Twitch incompleta(s).\n' +
                'Se guardarán igual, pero esas cuentas no se conectarán.\n\n¿Continuar?'
            );
            if (!continuar) return;
        }
    }

    const twitchAccounts = accounts.map(acc => {
        let oauthToken = acc.oauthToken;
        if (oauthToken && !oauthToken.startsWith('oauth:')) oauthToken = 'oauth:' + oauthToken;
        let oauthTokenChat = acc.oauthTokenChat;
        if (oauthTokenChat && !oauthTokenChat.startsWith('oauth:')) oauthTokenChat = 'oauth:' + oauthTokenChat;
        if (!oauthTokenChat) oauthTokenChat = oauthToken;
        return {
            id: acc.id,
            clientId: acc.clientId,
            oauthToken,
            oauthTokenChat,
            botUsername: acc.botUsername,
            channels: acc.channels
        };
    });

    const firstAcc = twitchAccounts[0] || {};
    const allChannels = twitchAccounts.flatMap(a => a.channels);

    const proveedoresPrevios = currentServerConfig?.aiCohost?.proveedores || {};
    const proveedoresFinales = {};
    for (const pid of ['groq', 'cerebras', 'openrouter', 'agnes']) {
        const actual = v.aiCohost.proveedores[pid] || {};
        const previo = proveedoresPrevios[pid] || {};
        proveedoresFinales[pid] = {
            apiKey: actual.apiKey || '',
            modelo: actual.modelo || previo.modelo || ''
        };
    }

    const data = Object.assign({}, currentServerConfig, {
        TWITCH_ACCOUNTS: twitchAccounts,
        TWITCH_CLIENT_ID: firstAcc.clientId || '',
        TWITCH_OAUTH_TOKEN: firstAcc.oauthToken || '',
        TWITCH_OAUTH_TOKEN_CHAT: firstAcc.oauthTokenChat || '',
        TWITCH_BOT_USERNAME: firstAcc.botUsername || '',
        TWITCH_CHANNEL: allChannels[0] || '',
        channels: allChannels,
        TIKTOK_USER_ID: v.tiktokUsers.join(', '),
        TIKTOK_USERS: v.tiktokUsers,
        KICK_USERNAME: v.kickUsers[0] || '',
        KICK_USERS: v.kickUsers,
        YOUTUBE_USER_ID: v.youtubeUsers.join(', '),
        YOUTUBE_USERS: v.youtubeUsers,
        VELORA_USERNAME: v.veloraUsername || '',
        ENABLE_CENSORSHIP: v.enableCensorship,
        PLATFORMS_ENABLED: v.platformsEnabled,
        TTS: v.tts,
        CRYSTAL_STYLE: v.crystalStyle,
        JAR_META: v.crystalMeta,
        aiCohost: {
            enabled: v.aiCohost.enabled,
            nombre: v.aiCohost.nombre,
            personalidad: v.aiCohost.personalidad,
            comando: v.aiCohost.comando,
            proveedores: proveedoresFinales
        }
    });

        // 🟢 Kick — no sobrescribir las cookies guardadas por el login embebido

    try {
        const response = await fetch(`${window.SERVER_BASE}/save-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        alert(result.message);
        if (result.success) {
            originalValues = getCurrentValues();
            saveToLocalStorage(originalValues);
            updateUnsavedBadge();
            window.location.href = window.SERVER_BASE + '/';
        }
    } catch (error) {
        alert('Error al conectar con el servidor. Asegúrate de que esté iniciado.');
    }
}

async function probarVozTTS(btn) {
    if (btn) btn.disabled = true;

    const payload = {
        text: 'Hola, esta es una prueba de la voz seleccionada en el panel.',
        voice: document.getElementById('ttsVoice').value,
        rate:  (document.getElementById('ttsRate').value >= 0 ? '+' : '') + document.getElementById('ttsRate').value + '%',
        pitch: (document.getElementById('ttsPitch').value >= 0 ? '+' : '') + document.getElementById('ttsPitch').value + 'Hz'
    };

    try {
        const socket = io(window.SERVER_BASE, { transports: ['websocket', 'polling'] });

        const cleanup = () => {
            try { socket.disconnect(); } catch(e) {}
            if (btn) btn.disabled = false;
        };

        socket.on('connect', () => {
            socket.emit('tts:preview', payload);
        });

        socket.on('tts:preview-ready', ({ url }) => {
            const audio = new Audio(url);
            audio.volume = parseInt(document.getElementById('ttsVolume').value, 10) / 100;
            audio.play().catch(err => {
                console.error('Error reproduciendo:', err);
                alert('El navegador bloqueó la reproducción. Haz clic primero en la página.');
            });
            cleanup();
        });

        socket.on('tts:preview-error', ({ error }) => {
            alert('Error al generar voz: ' + error);
            cleanup();
        });

        socket.on('connect_error', (err) => {
            alert('No se pudo conectar al servidor: ' + err.message);
            cleanup();
        });

        setTimeout(() => { if (btn && btn.disabled) cleanup(); }, 15000);
    } catch (e) {
        alert('Error: ' + e.message);
        if (btn) btn.disabled = false;
    }
}

window.addEventListener('load', function() {
    loadConfigData();
    updateUnsavedBadge();
    initSidebar();
});

console.log('⚙️ config-main.js cargado');