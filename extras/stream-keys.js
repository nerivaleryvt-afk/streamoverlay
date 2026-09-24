// ================================================================
// 🔑 stream-keys.js — Gestor de claves de transmisión
// ================================================================
// Guarda, cifra y aplica claves de stream (Twitch, Kick, YouTube...)
// para OBS normal (horizontal) y Aitum Vertical.
//
// ⚠️ NO combina OBS normal con Aitum. Cada target tiene sus propias
// claves y su propio server. El usuario elige cuál usar.
// ================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════
// 🔧 DETECCIÓN DE RUTA Y CIFRADO
// ═══════════════════════════════════════════════════════════════

function detectUserDataDir() {
    if (process.env.APP_USER_DATA) return process.env.APP_USER_DATA;
    try {
        const electron = require('electron');
        if (electron && electron.app && typeof electron.app.getPath === 'function') {
            return electron.app.getPath('userData');
        }
    } catch (e) {}
    if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
        return path.join(path.dirname(process.resourcesPath), 'user-data');
    }
    return path.join(__dirname, '..', 'user-data-dev');
}

const USER_DATA_DIR = detectUserDataDir();
const KEYS_PATH = path.join(USER_DATA_DIR, 'stream-keys.enc');

// Clave de cifrado derivada de un secreto local (mejor que nada)
const CIPHER_SECRET = 'togipanel-stream-keys-v1';
const CIPHER_SALT = 'togi-stream-salt-v1';

function getCipherKey() {
    return crypto.scryptSync(CIPHER_SECRET, CIPHER_SALT, 32);
}

function cifrar(texto) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', getCipherKey(), iv);
    let enc = cipher.update(texto, 'utf8', 'hex');
    enc += cipher.final('hex');
    return iv.toString('hex') + ':' + enc;
}

function descifrar(texto) {
    try {
        const [ivHex, enc] = String(texto).split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', getCipherKey(), iv);
        let dec = decipher.update(enc, 'hex', 'utf8');
        dec += decipher.final('utf8');
        return dec;
    } catch (e) {
        console.error('❌ [STREAM-KEYS] No se pudo descifrar:', e.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// 📡 SERVERS CONOCIDOS (lista curada — Twitch usa IVS desde 2024)
// ═══════════════════════════════════════════════════════════════

const KNOWN_SERVERS = {
    twitch: [
        { value: 'rtmp://ingest.global-contribute.live-video.net/app', label: '🌎 Global (default)' },
        { value: 'rtmp://use10.contribute.live-video.net/app',         label: '🇺🇸 US East (N. Virginia)' },
        { value: 'rtmp://use20.contribute.live-video.net/app',         label: '🇺🇸 US East (Ohio)' },
        { value: 'rtmp://usw20.contribute.live-video.net/app',         label: '🇺🇸 US West (Oregon)' },
        { value: 'rtmp://sae10.contribute.live-video.net/app',         label: '🇧🇷 Sudamérica (São Paulo)' },
        { value: 'rtmp://euw10.contribute.live-video.net/app',         label: '🇮🇪 Europa (Irlanda)' },
        { value: 'rtmp://euw30.contribute.live-video.net/app',         label: '🇫🇷 Europa (París)' },
        { value: 'rtmp://euc10.contribute.live-video.net/app',         label: '🇩🇪 Europa (Frankfurt)' },
        { value: 'rtmp://eun10.contribute.live-video.net/app',         label: '🇸🇪 Europa (Estocolmo)' },
        { value: 'rtmp://apn10.contribute.live-video.net/app',         label: '🇯🇵 Asia Pacífico (Tokio)' },
        { value: 'rtmp://apn20.contribute.live-video.net/app',         label: '🇰🇷 Asia Pacífico (Seúl)' },
        { value: 'rtmp://aps20.contribute.live-video.net/app',         label: '🇦🇺 Asia Pacífico (Sídney)' },
        { value: 'rtmp://aps30.contribute.live-video.net/app',         label: '🇮🇳 Asia Pacífico (Mumbai)' },
        { value: 'rtmp://aps10.contribute.live-video.net/app',         label: '🇸🇬 Asia Pacífico (Singapur)' }
    ],
    kick: [
        { value: 'rtmps://fa723fc1b171.global-contribute.live-video.net/app', label: 'Global (IVS)' }
    ],
    youtube: [
        { value: 'rtmp://a.rtmp.youtube.com/live2',           label: 'Principal' },
        { value: 'rtmp://b.rtmp.youtube.com/live2?backup=1',  label: 'Backup' }
    ],
    velora: [
        // El usuario puede agregar servers custom desde la UI
    ],
    tiktok: [
        // TikTok va por Aitum, pero dejamos la lista por si acaso
    ]
};

const PLATFORM_LABELS = {
    twitch: 'Twitch',
    kick: 'Kick',
    youtube: 'YouTube',
    velora: 'Velora',
    tiktok: 'TikTok'
};

// ═══════════════════════════════════════════════════════════════
// 💾 PERSISTENCIA
// ═══════════════════════════════════════════════════════════════

let keysStore = {
    obs: {},      // { platform: { server, keyEnc, label, updatedAt } }
    aitum: {}     // { platform: { server, keyEnc, label, updatedAt } }
};

function cargarKeys() {
    try {
        if (!fs.existsSync(KEYS_PATH)) {
            console.log('🔑 [STREAM-KEYS] No hay archivo previo, empezando vacío');
            return;
        }

        const raw = fs.readFileSync(KEYS_PATH, 'utf8');
        const decrypted = descifrar(raw);
        if (!decrypted) {
            console.warn('⚠️ [STREAM-KEYS] No se pudo descifrar el archivo');
            return;
        }

        const parsed = JSON.parse(decrypted);
        keysStore = {
            obs: parsed.obs && typeof parsed.obs === 'object' ? parsed.obs : {},
            aitum: parsed.aitum && typeof parsed.aitum === 'object' ? parsed.aitum : {}
        };

        const totalObs = Object.keys(keysStore.obs).length;
        const totalAitum = Object.keys(keysStore.aitum).length;
        console.log(`🔑 [STREAM-KEYS] Cargadas: ${totalObs} OBS, ${totalAitum} Aitum`);
    } catch (e) {
        console.error('❌ [STREAM-KEYS] Error cargando:', e.message);
        keysStore = { obs: {}, aitum: {} };
    }
}

function guardarKeys() {
    try {
        fs.mkdirSync(USER_DATA_DIR, { recursive: true });
        const json = JSON.stringify(keysStore, null, 2);
        const cifrado = cifrar(json);
        fs.writeFileSync(KEYS_PATH, cifrado, 'utf8');
        return true;
    } catch (e) {
        console.error('❌ [STREAM-KEYS] Error guardando:', e.message);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
// 🎭 PREVIEW SEGURA DE LA KEY
// ═══════════════════════════════════════════════════════════════

function previewKey(key) {
    if (!key || key.length < 8) return '****';
    const inicio = key.slice(0, 4);
    const fin = key.slice(-4);
    return `${inicio}****${fin}`;
}

// ═══════════════════════════════════════════════════════════════
// 🌎 DETECCIÓN AUTOMÁTICA DE SERVER (Twitch)
// ═══════════════════════════════════════════════════════════════

async function detectarServerTwitch() {
    try {
        console.log('🌎 [STREAM-KEYS] Consultando ingests de Twitch...');

        const res = await fetch('https://ingest.twitch.tv/ingests', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        });

        if (!res.ok) throw new Error('HTTP ' + res.status);

        const data = await res.json();
        const ingests = Array.isArray(data.ingests) ? data.ingests : [];

        // Twitch puede devolver el id recomendado en distintos campos
        const recommendedId =
            data.recommended_ingest_id ||
            data.recommendedIngestId ||
            data.recommended_id ||
            data.recommendedId ||
            null;

        const lista = ingests.map(i => {
            const id = i._id || i.id || null;
            return {
                id,
                name: i.name || i.display_name || '',
                urlTemplate: i.url_template || i.urlTemplate || '',
                priority: i.priority || 0,
                recommended: (id && recommendedId && id === recommendedId)
            };
        });

        // Buscar recomendado por id
        let recomendado = lista.find(l => l.recommended) || null;

        // Fallback: si Twitch no marcó ninguno, tomamos el "Default" (menor priority)
        if (!recomendado && lista.length > 0) {
            const ordenados = [...lista].sort((a, b) => (a.priority || 0) - (b.priority || 0));
            recomendado = ordenados[0];
            recomendado.recommended = true;
            console.log(`🌎 [STREAM-KEYS] Twitch no marcó recomendado, usando: ${recomendado.name}`);
        }

        console.log(`🌎 [STREAM-KEYS] Twitch: ${lista.length} servers, recomendado = ${recomendado ? recomendado.name : 'ninguno'}`);

        return {
            ok: true,
            recommended: recomendado,
            servers: lista
        };
    } catch (e) {
        console.error('❌ [STREAM-KEYS] Error detectando Twitch:', e.message);
        return { ok: false, error: e.message };
    }
}

// ═══════════════════════════════════════════════════════════════
// 🚀 INIT — Monta rutas en Express
// ═══════════════════════════════════════════════════════════════

function init(app, io, deckModule) {
    cargarKeys();

    // ─── GET /api/stream-keys ───
    app.get('/api/stream-keys', (req, res) => {
        try {
            const salida = { obs: {}, aitum: {} };

            for (const target of ['obs', 'aitum']) {
                for (const [platform, entry] of Object.entries(keysStore[target] || {})) {
                    const keyDescifrada = descifrar(entry.keyEnc) || '';
                    salida[target][platform] = {
                        platform,
                        label: entry.label || PLATFORM_LABELS[platform] || platform,
                        server: entry.server || '',
                        keyPreview: previewKey(keyDescifrada),
                        hasKey: !!keyDescifrada,
                        updatedAt: entry.updatedAt || null
                    };
                }
            }

            res.json({ ok: true, keys: salida });
        } catch (e) {
            console.error('❌ [STREAM-KEYS] Error GET:', e.message);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── GET /api/stream-keys/servers ───
    app.get('/api/stream-keys/servers', (req, res) => {
        res.json({ ok: true, servers: KNOWN_SERVERS });
    });

    // ─── GET /api/stream-keys/detect/twitch ───
    app.get('/api/stream-keys/detect/twitch', async (req, res) => {
        const resultado = await detectarServerTwitch();
        res.json(resultado);
    });

    // ─── POST /api/stream-keys ───
    app.post('/api/stream-keys', (req, res) => {
        try {
            const { target, platform, server, key, label } = req.body || {};

            if (!target || !['obs', 'aitum'].includes(target)) {
                return res.status(400).json({ ok: false, error: 'target inválido (obs|aitum)' });
            }
            if (!platform || typeof platform !== 'string') {
                return res.status(400).json({ ok: false, error: 'Falta platform' });
            }
            if (!key || typeof key !== 'string' || key.trim().length < 4) {
                return res.status(400).json({ ok: false, error: 'Falta key (o es muy corta)' });
            }
            if (!server || typeof server !== 'string') {
                return res.status(400).json({ ok: false, error: 'Falta server' });
            }

            if (!keysStore[target]) keysStore[target] = {};

            keysStore[target][platform] = {
                label: label || PLATFORM_LABELS[platform] || platform,
                server: server.trim(),
                keyEnc: cifrar(key.trim()),
                updatedAt: new Date().toISOString()
            };

            if (guardarKeys()) {
                console.log(`🔑 [STREAM-KEYS] Guardada key: ${target}/${platform}`);
                io.emit('stream-keys:updated', {
                    target, platform,
                    preview: previewKey(key.trim())
                });
                res.json({ ok: true });
            } else {
                res.status(500).json({ ok: false, error: 'No se pudo guardar' });
            }
        } catch (e) {
            console.error('❌ [STREAM-KEYS] Error POST:', e.message);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── DELETE /api/stream-keys/:target/:platform ───
    app.delete('/api/stream-keys/:target/:platform', (req, res) => {
        try {
            const { target, platform } = req.params;

            if (!target || !['obs', 'aitum'].includes(target)) {
                return res.status(400).json({ ok: false, error: 'target inválido' });
            }
            if (!platform) {
                return res.status(400).json({ ok: false, error: 'Falta platform' });
            }

            if (keysStore[target] && keysStore[target][platform]) {
                delete keysStore[target][platform];
                if (guardarKeys()) {
                    console.log(`🔑 [STREAM-KEYS] Eliminada: ${target}/${platform}`);
                    io.emit('stream-keys:deleted', { target, platform });
                    return res.json({ ok: true });
                }
            }

            res.json({ ok: true, noop: true });
        } catch (e) {
            console.error('❌ [STREAM-KEYS] Error DELETE:', e.message);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── POST /api/stream-keys/apply ───
    app.post('/api/stream-keys/apply', async (req, res) => {
        try {
            const { target, platform } = req.body || {};

            if (!target || !['obs', 'aitum'].includes(target)) {
                return res.status(400).json({ ok: false, error: 'target inválido' });
            }
            if (!platform) {
                return res.status(400).json({ ok: false, error: 'Falta platform' });
            }
            if (!deckModule) {
                return res.status(500).json({ ok: false, error: 'deck.js no disponible' });
            }

            const entry = keysStore[target] && keysStore[target][platform];
            if (!entry) {
                return res.status(404).json({ ok: false, error: `No hay key guardada para ${target}/${platform}` });
            }

            const key = descifrar(entry.keyEnc);
            if (!key) {
                return res.status(500).json({ ok: false, error: 'No se pudo descifrar la key' });
            }

            // ⚠️ NO COMBINAR: 'obs' → OBS normal, 'aitum' → Aitum Vertical

            if (target === 'obs') {
                if (typeof deckModule.setStreamSettings !== 'function') {
                    return res.status(500).json({ ok: false, error: 'deck.js no expone setStreamSettings()' });
                }
                const r = await deckModule.setStreamSettings(entry.server, key);
                if (!r || !r.ok) {
                    return res.status(500).json({ ok: false, error: r?.error || 'Error aplicando en OBS' });
                }
                console.log(`✅ [STREAM-KEYS] Aplicada a OBS: ${platform}`);
                io.emit('stream-keys:applied', { target, platform });
                return res.json({ ok: true, target, platform });
            }

            if (target === 'aitum') {
                if (typeof deckModule.aitumUpdateStreamKey !== 'function' ||
                    typeof deckModule.aitumUpdateStreamServer !== 'function') {
                    return res.status(500).json({ ok: false, error: 'deck.js no expone funciones de Aitum' });
                }
                // Primero server, después key
                await deckModule.aitumUpdateStreamServer(entry.server, 0);
                await deckModule.aitumUpdateStreamKey(key, 0);
                console.log(`✅ [STREAM-KEYS] Aplicada a Aitum: ${platform}`);
                io.emit('stream-keys:applied', { target, platform });
                return res.json({ ok: true, target, platform });
            }

            res.status(400).json({ ok: false, error: 'target desconocido' });
        } catch (e) {
            console.error('❌ [STREAM-KEYS] Error apply:', e.message);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    console.log('🔑 [STREAM-KEYS] Módulo listo');
}

module.exports = { init };