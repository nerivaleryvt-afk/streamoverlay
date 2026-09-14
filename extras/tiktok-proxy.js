// ================================================================
// tiktok-proxy.js - Proxy RTMP local OBS → TikTok (Fase 3 + 4)
// ================================================================
const NodeMediaServer = require('node-media-server');
const { spawn } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const tiktokStream = require('./tiktok-stream');

const RTMP_PORT = 1935;
const OBS_STREAM_PATH_FALLBACK = '/live/togipanel';

// Renovación cada 90 min (TikTok caduca a las ~2h)
const RENEW_INTERVAL_MS = 90 * 60 * 1000;

let nms = null;
let ffmpegProc = null;
let obsStreamPath = null;
let onObsRunning = false;
let renewalTimer = null;
let renewing = false;

// 🧹 NUEVO — Timer del "kill diferido" del FFmpeg antiguo durante renovaciones.
// Se guarda aquí para poder cancelarlo si el proxy se para antes de que dispare.
let pendingKillTimer = null;

let state = {
    status: 'idle',           // idle | waiting | streaming | error
    username: null,
    streamId: null,
    error: null,
    startedAt: null,
    apiToken: null,
    title: null,
    lastRenewal: null,
    nextRenewal: null
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
        lastRenewal: null,
        nextRenewal: null
    };

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

        const inputUrl = `rtmp://localhost:${RTMP_PORT}${obsStreamPath}`;
        const outputUrl = `${result.server}/${result.key}`;

        console.log(`🚀 [FFMPEG] Reenviando a TikTok (cuenta: ${username})...`);
        console.log(`   Input:  ${inputUrl}`);
        console.log(`   Output: ${result.server}/...`);

        ffmpegProc = spawn(ffmpegPath, [
            '-loglevel', 'warning',
            '-i', inputUrl,
            '-c', 'copy',
            '-f', 'flv',
            outputUrl
        ], { windowsHide: true });

        ffmpegProc.stderr.on('data', (d) => {
            const txt = d.toString().trim();
            if (txt) console.log('[FFMPEG]', txt);
        });

        ffmpegProc.on('exit', (code) => {
            console.log(`[FFMPEG] Terminado (código ${code})`);
            ffmpegProc = null;
            if (state.status === 'streaming' && !renewing) state.status = 'waiting';
        });

        ffmpegProc.on('error', (err) => {
            console.error('❌ [FFMPEG] Error:', err.message);
            state.status = 'error';
            state.error = 'FFmpeg falló: ' + err.message;
        });

        scheduleRenewal();

    } catch (e) {
        state.status = 'error';
        state.error = e.message;
    } finally {
        onObsRunning = false;
    }
}

// ----------------------------------------------------------------
// RENOVACIÓN AUTOMÁTICA
// ----------------------------------------------------------------
function scheduleRenewal() {
    stopRenewal();

    state.nextRenewal = Date.now() + RENEW_INTERVAL_MS;

    renewalTimer = setTimeout(() => {
        renewNow();
    }, RENEW_INTERVAL_MS);

    console.log(`⏰ [RENEW] Próxima renovación en ${Math.round(RENEW_INTERVAL_MS / 60000)} min`);
}

function stopRenewal() {
    if (renewalTimer) {
        clearTimeout(renewalTimer);
        renewalTimer = null;
    }
    state.nextRenewal = null;
}

async function renewNow() {
    if (renewing) return;
    if (state.status !== 'streaming') return;

    renewing = true;
    console.log('🔄 [RENEW] Renovando stream key...');

    try {
        // Guardamos el FFmpeg viejo SIN matarlo todavía
        const oldFfmpeg = ffmpegProc;

        // 1) Pedimos clave nueva
        const result = await tiktokStream.startLive(state.apiToken, state.title);
        if (!result.ok) {
            console.error('❌ [RENEW] Error al pedir clave nueva:', result.error);
            state.status = 'error';
            state.error = 'Renovación falló: ' + result.error;
            renewing = false;
            return;
        }

        state.streamId = result.id;
        state.lastRenewal = Date.now();

        // 2) Arrancamos FFmpeg nuevo SIN matar el viejo (en paralelo)
        const inputUrl = `rtmp://localhost:${RTMP_PORT}${obsStreamPath}`;
        const outputUrl = `${result.server}/${result.key}`;

        console.log(`🚀 [RENEW] Nueva clave obtenida. Arrancando FFmpeg nuevo en paralelo...`);

        const newFfmpeg = spawn(ffmpegPath, [
            '-loglevel', 'warning',
            '-i', inputUrl,
            '-c', 'copy',
            '-f', 'flv',
            outputUrl
        ], { windowsHide: true });

        newFfmpeg.stderr.on('data', (d) => {
            const txt = d.toString().trim();
            if (txt) console.log('[FFMPEG-NEW]', txt);
        });

        newFfmpeg.on('error', (err) => {
            console.error('❌ [FFMPEG-NEW] Error:', err.message);
        });

        // El nuevo pasa a ser el "oficial"
        ffmpegProc = newFfmpeg;

        newFfmpeg.on('exit', (code) => {
            console.log(`[FFMPEG-NEW] Terminado (código ${code})`);
            if (ffmpegProc === newFfmpeg) {
                ffmpegProc = null;
                if (state.status === 'streaming' && !renewing) state.status = 'waiting';
            }
        });

        // 3) Esperamos 4 segundos y matamos el viejo
        // 🧹 Guardamos el ID para poder cancelarlo si el proxy se para antes.
        pendingKillTimer = setTimeout(() => {
            pendingKillTimer = null;
            if (oldFfmpeg && !oldFfmpeg.killed) {
                console.log('🛑 [RENEW] Cerrando FFmpeg antiguo');
                try { oldFfmpeg.kill(); } catch (e) {}
            }
        }, 4000);

        console.log('✅ [RENEW] Stream renovado correctamente');

        renewing = false;
        scheduleRenewal();

    } catch (e) {
        console.error('❌ [RENEW] Error:', e.message);
        state.status = 'error';
        state.error = 'Renovación falló: ' + e.message;
        renewing = false;
    }
}

// ----------------------------------------------------------------
// Parar el relay (FFmpeg + stream de TikTok)
// ----------------------------------------------------------------
async function stopRelay() {
    stopRenewal();

    // 🧹 Cancelar el "kill diferido" si estaba pendiente
    if (pendingKillTimer) {
        clearTimeout(pendingKillTimer);
        pendingKillTimer = null;
    }

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
// PARAR todo (servidor RTMP incluido)
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
        lastRenewal: null,
        nextRenewal: null
    };
    obsStreamPath = null;
    onObsRunning = false;
    renewing = false;

    console.log('🛑 [PROXY] Detenido por completo');
    return { ok: true };
}

// ----------------------------------------------------------------
// RENOVAR manualmente (para pruebas)
// ----------------------------------------------------------------
async function renewManual() {
    if (state.status !== 'streaming') {
        return { ok: false, error: 'No hay stream activo' };
    }
    await renewNow();
    return { ok: true, state: getState() };
}

module.exports = { start, stop, getState, renewManual };