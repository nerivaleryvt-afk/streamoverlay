// ================================================================
// 📈 stream-health.js — Monitor de salud del stream
// ================================================================
// No se conecta a OBS. Recibe un "getObsClient" desde deck.js.
// Hace polling cada 1s, guarda histórico y emite por socket.
// ================================================================

const HISTORY_SIZE = 60;       // 60 muestras = 60 segundos
const POLL_INTERVAL_MS = 1000;

let ioRef = null;
let getObsClientFn = null;

let lastSample = null;         // Última muestra cruda de OBS
let prevSample = null;         // Muestra anterior (para calcular bitrate/fps real)
let history = [];              // Historial de { bitrate, fps, drops, congestion, cpu }
let timer = null;
let ultimoError = null;

// ═══════════════════════════════════════════════════════════════
// 🔧 HELPERS
// ═══════════════════════════════════════════════════════════════

function safeDiv(a, b) {
    if (!b || b === 0) return 0;
    return a / b;
}

function redondear(n, decimales = 2) {
    if (typeof n !== 'number' || !isFinite(n)) return 0;
    const factor = Math.pow(10, decimales);
    return Math.round(n * factor) / factor;
}

// ═══════════════════════════════════════════════════════════════
// 📊 CÁLCULO DE MÉTRICAS
// ═══════════════════════════════════════════════════════════════

async function recolectarMuestra(obs) {
    try {
        const [streamStatus, stats, videoSettings] = await Promise.all([
            obs.call('GetStreamStatus').catch(() => null),
            obs.call('GetStats').catch(() => null),
            obs.call('GetVideoSettings').catch(() => null)
        ]);

        if (!streamStatus) return null;

        const muestra = {
            ts: Date.now(),
            active: !!streamStatus.outputActive,
            duration: streamStatus.outputDuration || 0,   // ms
            bytesTotal: streamStatus.outputBytes || 0,
            framesTotal: streamStatus.outputFrames || 0,
            skippedFrames: streamStatus.outputSkippedFrames || 0,
            congestion: typeof streamStatus.outputCongestion === 'number'
                ? streamStatus.outputCongestion : 0,
            cpu: stats && typeof stats.CPUUsage === 'number' ? stats.CPUUsage : 0,
            memoriaMB: stats && stats.memoryUsage ? redondear(stats.memoryUsage / 1024 / 1024, 1) : 0,
            fpsObjetivo: videoSettings
                ? safeDiv(videoSettings.fpsNumerator, videoSettings.fpsDenominator || 1)
                : 0,
            resolucionBase: videoSettings
                ? `${videoSettings.baseWidth}x${videoSettings.baseHeight}`
                : '—',
            resolucionSalida: videoSettings
                ? `${videoSettings.outputWidth}x${videoSettings.outputHeight}`
                : '—'
        };

        // Cálculo de bitrate y fps real comparando con la muestra anterior
        if (prevSample && prevSample.active && muestra.active) {
            const deltaT = (muestra.ts - prevSample.ts) / 1000; // segundos
            if (deltaT > 0) {
                const deltaBytes = muestra.bytesTotal - prevSample.bytesTotal;
                const deltaFrames = muestra.framesTotal - prevSample.framesTotal;
                muestra.bitrateKbps = redondear(safeDiv(deltaBytes * 8, deltaT * 1000), 1);
                muestra.bitrateMbps = redondear(safeDiv(muestra.bitrateKbps, 1000), 2);
                muestra.fpsReal = redondear(safeDiv(deltaFrames, deltaT), 1);
            }
        } else {
            muestra.bitrateKbps = 0;
            muestra.bitrateMbps = 0;
            muestra.fpsReal = 0;
        }

        // % de frames perdidos
        muestra.dropsPct = muestra.framesTotal > 0
            ? redondear(safeDiv(muestra.skippedFrames, muestra.framesTotal) * 100, 2)
            : 0;

        return muestra;
    } catch (e) {
        ultimoError = e.message;
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// 🧮 SCORE DE SALUD (0–100)
// ═══════════════════════════════════════════════════════════════

function calcularSalud(muestra) {
    if (!muestra || !muestra.active) return 0;

    let score = 100;

    // Penalización por drops
    score -= Math.min(40, muestra.dropsPct * 8);

    // Penalización por congestión
    score -= Math.min(30, muestra.congestion * 100);

    // Penalización si el fps real baja del objetivo
    if (muestra.fpsObjetivo > 0 && muestra.fpsReal > 0) {
        const ratioFps = muestra.fpsReal / muestra.fpsObjetivo;
        if (ratioFps < 0.95) score -= (0.95 - ratioFps) * 100;
    }

    // Penalización por CPU alta
    if (muestra.cpu > 70) score -= (muestra.cpu - 70) * 0.5;

    return Math.max(0, Math.round(score));
}

function colorDeSalud(score) {
    if (score >= 75) return 'lima';
    if (score >= 45) return 'ambar';
    return 'rosa';
}

// ═══════════════════════════════════════════════════════════════
// ⏱️ POLLING
// ═══════════════════════════════════════════════════════════════

async function tick() {
    if (!getObsClientFn) return;
    const obs = getObsClientFn();

    if (!obs) {
        // OBS no conectado → emitir estado "sin OBS"
        if (ioRef) {
            ioRef.emit('stream-health:update', {
                ok: true,
                obsConectado: false,
                activo: false,
                salud: 0,
                color: 'gris',
                error: ultimoError || 'OBS no conectado'
            });
        }
        return;
    }

    const muestra = await recolectarMuestra(obs);
    if (!muestra) return;

    // Guardar histórico solo cuando hay stream activo
    if (muestra.active) {
        history.push({
            ts: muestra.ts,
            bitrateMbps: muestra.bitrateMbps,
            fpsReal: muestra.fpsReal,
            dropsPct: muestra.dropsPct,
            congestion: muestra.congestion,
            cpu: muestra.cpu
        });
        if (history.length > HISTORY_SIZE) history.shift();
    } else {
        // Stream parado → limpiar histórico
        history = [];
    }

    const salud = calcularSalud(muestra);
    const color = colorDeSalud(salud);

    if (ioRef) {
        ioRef.emit('stream-health:update', {
            ok: true,
            obsConectado: true,
            activo: muestra.active,
            salud,
            color,
            bitrateMbps: muestra.bitrateMbps,
            bitrateKbps: muestra.bitrateKbps,
            fpsReal: muestra.fpsReal,
            fpsObjetivo: muestra.fpsObjetivo,
            dropsPct: muestra.dropsPct,
            skippedFrames: muestra.skippedFrames,
            framesTotal: muestra.framesTotal,
            congestion: muestra.congestion,
            cpu: muestra.cpu,
            memoriaMB: muestra.memoriaMB,
            duracionMs: muestra.duration,
            resolucionSalida: muestra.resolucionSalida,
            resolucionBase: muestra.resolucionBase,
            history: history.slice(),
            ts: muestra.ts
        });
    }

    prevSample = lastSample;
    lastSample = muestra;
}

// ═══════════════════════════════════════════════════════════════
// 🔌 INIT / STOP
// ═══════════════════════════════════════════════════════════════

function init(io, getObsClient) {
    ioRef = io;
    getObsClientFn = getObsClient;

    if (timer) clearInterval(timer);
    timer = setInterval(tick, POLL_INTERVAL_MS);

    // Emitir estado inicial cuando un cliente se conecta
    io.on('connection', (socket) => {
        socket.emit('stream-health:update', {
            ok: true,
            obsConectado: !!getObsClientFn(),
            activo: false,
            salud: 0,
            color: 'gris'
        });
    });

    console.log('📈 [STREAM-HEALTH] Módulo listo (polling cada 1s)');
}

function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    console.log('📈 [STREAM-HEALTH] Detenido');
}

module.exports = { init, stop };