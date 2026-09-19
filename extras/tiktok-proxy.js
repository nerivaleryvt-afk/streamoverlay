// ================================================================
// tiktok-proxy.js - Proxy RTMP local OBS → TikTok (Fase 3 + 4)
// ================================================================
const NodeMediaServer = require('node-media-server');
const { spawn } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const tiktokStream = require('./tiktok-stream');

const RTMP_PORT = 1935;
const OBS_STREAM_PATH_FALLBACK = '/live/togipanel';

// Reconexión ante caída (no por timer)
const RECONNECT_DELAY_MS = 3000;
const RECONNECT_BACKOFF = 1.6;      // multiplicador por intento
const MAX_RECONNECT_ATTEMPTS = 5;

let nms = null;
let ffmpegProc = null;
let obsStreamPath = null;
let onObsRunning = false;
let reconnecting = false;
let reconnectAttempts = 0;

let state = {
    status: 'idle',           // idle | waiting | streaming | error
    username: null,
    streamId: null,
    error: null,
    startedAt: null,
    apiToken: null,
    title: null,
    lastReconnect: null
};

function getState() {
    return { ...state };
}

// ----------------------------------------------------------------
// ARRANCAR el servidor RTMP local
// ----------------------------------------------------------------
async function start(apiToken, title) {
    if (nms) return { ok: false, error: 'El proxy ya está arrancado' };
    if (!apiToken) return { ok: false, error: 'Falta apiToken' };

    state = {
        status: 'waiting',
        username: null,
        streamId: null,
        error: null,
        startedAt: Date.now(),
        apiToken,
        title: title || 'TogiPanel Stream',
        lastReconnect: null
    };
    reconnectAttempts = 0;

    const config = {
        rtmp: {
            port: RTMP_PORT,
            chunk_size: 60000,
            gop_cache: true,
            ping: 30,
            ping_timeout: 60
        }
    };

    try {
        nms = new NodeMediaServer(config);
        nms.run();
    } catch (e) {
        state.status = 'error';
        state.error = 'No se pudo arrancar RTMP: ' + e.message;
        nms = null;
        return { ok: false, error: state.error };
    }

    nms.on('prePublish', async (id, streamPath, args) => {
        console.log(`🎥 [PROXY] prePublish id=${id} streamPath=${streamPath || '(undefined)'}`);
        obsStreamPath = streamPath || OBS_STREAM_PATH_FALLBACK;
        await onObsConnected();
    });

    nms.on('donePublish', (id, streamPath) => {
        console.log(`🛑 [PROXY] OBS desconectado: ${streamPath || '(undefined)'}`);
        stopRelay();
    });

    console.log(`✅ [PROXY] Servidor RTMP escuchando en localhost:${RTMP_PORT}`);
    console.log(`   Configura OBS así: rtmp://localhost:${RTMP_PORT}/live  →  clave: togipanel`);
    return { ok: true, state: getState() };
}

// ----------------------------------------------------------------
// OBS conectado → pedir clave + arrancar FFmpeg
// ----------------------------------------------------------------
async function onObsConnected() {
    if (state.status === 'streaming') return;
    if (onObsRunning) return;
    onObsRunning = true;

    try {
        const info = await tiktokStream.getAccountInfo(state.apiToken);
        if (!info) {
            state.status = 'error';
            state.error = 'Token inválido o expirado';
            return;
        }

        const username = (info.user && info.user.username) || 'desconocido';

        if (!info.can_be_live) {
            state.status = 'error';
            state.error = 'La cuenta no puede emitir en TikTok';
            state.username = username;
            return;
        }

        const result = await tiktokStream.startLive(state.apiToken, state.title);
        if (!result.ok) {
            state.status = 'error';
            state.error = result.error;
            state.username = username;
            return;
        }

        state.username = username;
        state.streamId = result.id;
        state.status = 'streaming';
        state.error = null;
        reconnectAttempts = 0;

        spawnFfmpeg(result, false);

    } catch (e) {
        state.status = 'error';
        state.error = e.message;
    } finally {
        onObsRunning = false;
    }
}

// ----------------------------------------------------------------
// Crear FFmpeg (usado en arranque y reconexión)
// ----------------------------------------------------------------
function spawnFfmpeg(result, isReconnect) {
    const tag = isReconnect ? '[FFMPEG-RECON]' : '[FFMPEG]';
    const inputUrl = `rtmp://localhost:${RTMP_PORT}${obsStreamPath}`;
    const outputUrl = `${result.server}/${result.key}`;

    console.log(`🚀 ${tag} Reenviando a TikTok (cuenta: ${state.username})...`);
    console.log(`   Input:  ${inputUrl}`);
    console.log(`   Output: ${result.server}/...`);

    const proc = spawn(ffmpegPath, [
        '-loglevel', 'warning',
        '-i', inputUrl,
        '-c', 'copy',
        '-f', 'flv',
        outputUrl
    ], { windowsHide: true });

    ffmpegProc = proc;

    proc.stderr.on('data', (d) => {
        const txt = d.toString().trim();
        if (txt) console.log(tag, txt);
    });

    proc.on('exit', (code) => {
        console.log(`${tag} Terminado (código ${code})`);

        // Ignorar si ya no somos el activo (parada manual, reconexión en curso)
        if (ffmpegProc !== proc) return;
        ffmpegProc = null;

        // Si fue parada manual o ya estamos reconectando, no hacer nada
        if (state.status !== 'streaming') return;
        if (reconnecting) return;

        // Caída inesperada → reconectar
        console.warn(`⚠️ ${tag} Caída inesperada. Iniciando reconexión...`);
        attemptReconnect();
    });

    proc.on('error', (err) => {
        console.error(`❌ ${tag} Error:`, err.message);
    });
}

// ----------------------------------------------------------------
// Reconexión con backoff
// ----------------------------------------------------------------
async function attemptReconnect() {
    if (reconnecting) return;
    reconnecting = true;

    try {
        reconnectAttempts++;
        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
            state.status = 'error';
            state.error = `Reconexión fallida tras ${MAX_RECONNECT_ATTEMPTS} intentos`;
            console.error(`❌ [RECON] ${state.error}`);
            return;
        }

        const delay = Math.round(RECONNECT_DELAY_MS * Math.pow(RECONNECT_BACKOFF, reconnectAttempts - 1));
        console.log(`🔄 [RECON] Intento ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} en ${delay/1000}s...`);
        await new Promise(r => setTimeout(r, delay));

        // Cerrar el stream viejo en Streamlabs (best-effort)
        if (state.streamId && state.apiToken) {
            try { await tiktokStream.endLive(state.apiToken, state.streamId); } catch (e) {}
        }

        const result = await tiktokStream.startLive(state.apiToken, state.title);
        if (!result.ok) {
            console.error('❌ [RECON] startLive falló:', result.error);
            state.error = result.error;
            reconnecting = false;
            attemptReconnect();  // siguiente intento
            return;
        }

        state.streamId = result.id;
        state.lastReconnect = Date.now();
        state.status = 'streaming';
        state.error = null;
        reconnectAttempts = 0;

        console.log('✅ [RECON] Reconectado a TikTok');
        spawnFfmpeg(result, true);

    } catch (e) {
        console.error('❌ [RECON] Error:', e.message);
        state.error = e.message;
    } finally {
        reconnecting = false;
    }
}

// ----------------------------------------------------------------
// Parar el relay (FFmpeg + stream de TikTok)
// ----------------------------------------------------------------
async function stopRelay() {
    if (ffmpegProc) {
        try { ffmpegProc.kill(); } catch (e) {}
        ffmpegProc = null;
    }

    if (state.streamId && state.apiToken) {
        try {
            await tiktokStream.endLive(state.apiToken, state.streamId);
            console.log('✅ [STREAMLABS] Stream cerrado');
        } catch (e) {}
    }

    state.streamId = null;
    if (state.status === 'streaming') state.status = 'waiting';
}

// ----------------------------------------------------------------
// PARAR todo
// ----------------------------------------------------------------
async function stop() {
    await stopRelay();

    if (nms) {
        try { nms.stop(); } catch (e) {}
        nms = null;
    }

    state = {
        status: 'idle',
        username: null,
        streamId: null,
        error: null,
        startedAt: null,
        apiToken: null,
        title: null,
        lastReconnect: null
    };
    obsStreamPath = null;
    onObsRunning = false;
    reconnecting = false;
    reconnectAttempts = 0;

    console.log('🛑 [PROXY] Detenido por completo');
    return { ok: true };
}

module.exports = { start, stop, getState };