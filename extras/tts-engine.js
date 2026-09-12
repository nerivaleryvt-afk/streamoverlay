// tts-engine.js — Motor de síntesis de voz (Edge TTS)
const { EdgeTTS } = require('node-edge-tts');
const fs = require('fs');
const path = require('path');

// ================================================================
// 📦 NUEVO — DETECCIÓN DE EMPAQUETADO (Electron)
// ================================================================
// Misma lógica que en server.js: en prod los MP3 van a userData,
// en dev van al proyecto (public/tts-audio).

function detectUserDataDir() {
    // 1) Variable de entorno seteada por main.js
    if (process.env.APP_USER_DATA) {
        return process.env.APP_USER_DATA;
    }

    // 2) Proceso principal de Electron
    try {
        const electron = require('electron');
        if (electron && electron.app && typeof electron.app.getPath === 'function') {
            return electron.app.getPath('userData');
        }
    } catch (e) { /* no estamos en el proceso principal */ }

    // 3) Heurística: process.resourcesPath solo existe en Electron empaquetado
    if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
        return path.join(path.dirname(process.resourcesPath), 'user-data');
    }

    return null;
}

const USER_DATA_DIR = detectUserDataDir();
const IS_PACKAGED = !!USER_DATA_DIR;

// 📦 En prod: userData/tts-audio. En dev: public/tts-audio
const TTS_DIR = IS_PACKAGED
    ? path.join(USER_DATA_DIR, 'tts-audio')
    : path.join(__dirname, '..', 'public', 'tts-audio');

if (!fs.existsSync(TTS_DIR)) {
    try {
        fs.mkdirSync(TTS_DIR, { recursive: true });
    } catch (e) {
        console.error('❌ No se pudo crear TTS_DIR:', e.message);
    }
}

console.log(`🔊 TTS dir: ${TTS_DIR}${IS_PACKAGED ? ' (empaquetado)' : ' (dev)'}`);

// 🔊 Cuánto tiempo puede vivir un MP3 sin reproducirse antes de borrarse
const MAX_AGE_MS = 60 * 1000; // 60 segundos

async function synthesize(text, options = {}) {
    const voice = options.voice || 'es-ES-AlvaroNeural';
    const rate  = options.rate  || '+0%';
    const pitch = options.pitch || '+0Hz';

    const filename = `tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`;
    const filepath = path.join(TTS_DIR, filename);

    const tts = new EdgeTTS({
        voice,
        lang: voice.split('-').slice(0, 2).join('-'),
        outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        rate,
        pitch,
    });

    await tts.ttsPromise(text, filepath);
    return { filename, filepath, url: `/tts-audio/${filename}` };
}

async function listVoices(langPrefix) {
    const tts = new EdgeTTS({ voice: 'en-US-AriaNeural', lang: 'en-US' });
    const voices = await tts.getVoices();
    if (!langPrefix) return voices;
    return voices.filter(v => String(v.Locale || v.locale || '').startsWith(langPrefix));
}

// 🔊 Borra un MP3 concreto
function cleanup(filename) {
    if (!filename) return;
    const p = path.join(TTS_DIR, filename);
    fs.unlink(p, () => {});
}

// 🔊 Borra TODOS los MP3 anteriores a "filename" (por orden de timestamp en el nombre)
//    Se llama tras reproducir uno con éxito → los anteriores ya se reprodujeron o fallaron.
function cleanupOlderThan(filename) {
    if (!filename) return;
    const m = filename.match(/^tts_(\d+)_/);
    if (!m) return;
    const limitTs = parseInt(m[1], 10);

    try {
        const files = fs.readdirSync(TTS_DIR);
        for (const f of files) {
            if (f === filename) continue;
            const fm = f.match(/^tts_(\d+)_/);
            if (!fm) continue;
            const ts = parseInt(fm[1], 10);
            if (ts < limitTs) {
                fs.unlink(path.join(TTS_DIR, f), () => {});
            }
        }
    } catch (e) {}
}

// 🔊 Borra TODA la carpeta (para llamar al arrancar el server)
function cleanupAll() {
    try {
        if (!fs.existsSync(TTS_DIR)) return 0;
        const files = fs.readdirSync(TTS_DIR);
        let count = 0;
        for (const f of files) {
            if (f.endsWith('.mp3')) {
                try { fs.unlinkSync(path.join(TTS_DIR, f)); count++; } catch (e) {}
            }
        }
        return count;
    } catch (e) { return 0; }
}

// 🔊 Cleanup periódico: borra cualquier MP3 con más de MAX_AGE_MS
function cleanupOld() {
    try {
        const now = Date.now();
        const files = fs.readdirSync(TTS_DIR);
        for (const f of files) {
            if (!f.endsWith('.mp3')) continue;
            const p = path.join(TTS_DIR, f);
            try {
                const st = fs.statSync(p);
                if (now - st.mtimeMs > MAX_AGE_MS) {
                    fs.unlinkSync(p);
                }
            } catch (e) {}
        }
    } catch (e) {}
}

// Cada 15 segundos revisa si hay algo viejo que borrar
setInterval(cleanupOld, 15 * 1000).unref();

module.exports = { synthesize, listVoices, cleanup, cleanupAll, cleanupOlderThan, TTS_DIR };