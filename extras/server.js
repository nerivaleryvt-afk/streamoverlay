// server.js - VERSIÓN MULTI-CUENTA TWITCH + TikTok + Kick + YouTube + IMÁGENES DE REGALOS + TEMAS + PLATFORM TOGGLES + TTS + CRISTAL PERSISTENTE + AI CO-HOST
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const tmi = require('tmi.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const { TikTokChat } = require('./tiktok');
const { YouTubeChat } = require('./youtube');
const tiktokStream = require('./tiktok-stream');
const tiktokProxy = require('./tiktok-proxy');
// 🤖 AI CO-HOST
const aiKeyPool = require('./ai-key-pool');
const aiCohost = require('./ai-cohost');

// 🔊 PATCH 1 — Requires del sistema TTS
const { TTSQueue } = require('./tts-queue');
const ttsEngine = require('./tts-engine');

// ================================================================
// 📦 NUEVO — DETECCIÓN DE EMPAQUETADO (Electron)
// ================================================================
function detectUserDataDir() {
    if (process.env.APP_USER_DATA) {
        return process.env.APP_USER_DATA;
    }
    try {
        const electron = require('electron');
        if (electron && electron.app && typeof electron.app.getPath === 'function') {
            return electron.app.getPath('userData');
        }
    } catch (e) { }
    if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
        const parentDir = path.dirname(process.resourcesPath);
        return path.join(parentDir, 'user-data');
    }
    return null;
}

const USER_DATA_DIR = detectUserDataDir();
const IS_PACKAGED = !!USER_DATA_DIR;

if (IS_PACKAGED) {
    console.log(`📦 Modo empaquetado → userData: ${USER_DATA_DIR}`);
    try { fs.mkdirSync(USER_DATA_DIR, { recursive: true }); } catch (e) {}
} else {
    console.log('💻 Modo desarrollo (rutas del proyecto)');
}

const app = express();
const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

// ================================================================
// 🔥 RUTA ABSOLUTA AL CONFIG
// ================================================================
const CONFIG_PATH = IS_PACKAGED
    ? path.join(USER_DATA_DIR, 'config.json')
    : path.join(__dirname, 'config.json');
console.log(`📁 Config path: ${CONFIG_PATH}`);

if (IS_PACKAGED && !fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = path.join(__dirname, 'config.json');
    if (fs.existsSync(defaultConfig)) {
        try {
            fs.copyFileSync(defaultConfig, CONFIG_PATH);
            console.log('📋 Config inicial copiada desde el paquete');
        } catch (e) {
            console.error('❌ No se pudo copiar config.json:', e.message);
        }
    }
}

// ================================================================
// 🔥 PUBLIC DIR (multi-ubicación)
// ================================================================
const publicCandidates = [
    path.join(__dirname, '..', 'public'),
    path.join(__dirname, 'public'),
    path.join(__dirname, 'extras', 'public'),
];
const publicDir = publicCandidates.find(p => fs.existsSync(p)) || publicCandidates[1];
console.log(`📁 Sirviendo archivos estáticos desde: ${publicDir}`);

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

// 🔊 PATCH 2 — Servir MP3 generados por TTS
app.use('/tts-audio', express.static(ttsEngine.TTS_DIR, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store')
}));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ================================================================
// 🎬 TIKTOK STREAM KEY vía STREAMLABS
// ================================================================
app.get('/api/tiktok/streamlabs-accounts', async (req, res) => {
    try {
        const accounts = tiktokStream.readStreamlabsTokens();
        const detailed = [];

        for (const acc of accounts) {
            try {
                const info = await tiktokStream.getAccountInfo(acc.apiToken);
                if (info && info.user) {
                    detailed.push({
                        apiToken: acc.apiToken,
                        username: info.user.username || acc.username || '(desconocido)',
                        nickname: info.user.nickname || info.user.username || '',
                        avatar: info.user.avatar || info.user.avatar_thumb || null,
                        canBeLive: !!info.can_be_live
                    });
                } else {
                    detailed.push({
                        apiToken: acc.apiToken,
                        username: acc.username || '(sin acceso)',
                        canBeLive: false,
                        invalid: true
                    });
                }
            } catch (e) {
                detailed.push({
                    apiToken: acc.apiToken,
                    username: acc.username || '(error)',
                    canBeLive: false,
                    error: e.message
                });
            }
        }

        // Quitamos duplicados por apiToken
        const unique = [];
        const seen = new Set();
        for (const d of detailed) {
            if (!seen.has(d.apiToken)) {
                seen.add(d.apiToken);
                unique.push(d);
            }
        }

        res.json({ ok: true, total: unique.length, accounts: unique });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
app.get('/api/tiktok/stream-key', async (req, res) => {
    try {
        const apiToken = String(req.query.token || '').trim();
        if (!apiToken) return res.status(400).json({ ok: false, error: 'Falta ?token=' });

        const info = await tiktokStream.getAccountInfo(apiToken);
        if (!info) return res.json({ ok: false, error: 'Token inválido o expirado' });

        const canBeLive = !!info.can_be_live;
        const username = (info.user && info.user.username) || '(desconocido)';

        if (!canBeLive) {
            return res.json({ ok: false, error: 'La cuenta no puede emitir en TikTok', username });
        }

        const title = String(req.query.title || 'TogiPanel Stream');
        const result = await tiktokStream.startLive(apiToken, title);

        if (!result.ok) {
            return res.json({ ok: false, error: result.error, raw: result.raw, username });
        }

        res.json({
            ok: true,
            username,
            server: result.server,
            key: result.key,
            id: result.id
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/tiktok/stream-stop', async (req, res) => {
    try {
        const apiToken = String(req.query.token || '').trim();
        const streamId = String(req.query.id || '').trim();
        if (!apiToken || !streamId) return res.status(400).json({ ok: false, error: 'Faltan token o id' });
        const ok = await tiktokStream.endLive(apiToken, streamId);
        res.json({ ok });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ================================================================
// 🎥 PROXY RTMP (OBS → TogiPanel → TikTok)
// ================================================================
app.post('/api/tiktok/proxy/start', async (req, res) => {
    try {
        const { token, title } = req.body || {};
        if (!token) return res.status(400).json({ ok: false, error: 'Falta token' });
        const result = await tiktokProxy.start(token, title);
        res.json(result);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/tiktok/proxy/stop', async (req, res) => {
    try {
        const result = await tiktokProxy.stop();
        res.json(result);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/tiktok/proxy/status', (req, res) => {
    res.json({ ok: true, state: tiktokProxy.getState() });
});

app.post('/api/tiktok/proxy/renew', async (req, res) => {
    try {
        const result = await tiktokProxy.renewManual();
        res.json(result);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
// ================================================================
// 🌐 IP LOCAL (para el modo dos PC)
// ================================================================
app.get('/api/local-ip', (req, res) => {
    const nets = os.networkInterfaces();
    const candidates = [];

    const isPrivate = (ip) =>
        /^192\.168\./.test(ip) ||
        /^10\./.test(ip) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

    const isTailscale = (ip) =>
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);

    for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
            if (net.family !== 'IPv4' || net.internal) continue;
            if (net.address.startsWith('169.254.')) continue;
            if (isTailscale(net.address)) continue;
            candidates.push({
                iface: name,
                ip: net.address,
                private: isPrivate(net.address)
            });
        }
    }

    const preferida = candidates.find(c => c.private) || candidates[0] || null;

    res.json({
        ip: preferida ? preferida.ip : null,
        all: candidates.map(c => c.ip),
        detailed: candidates
    });
});

// ================================================================
// 🎁 MAPA DE IMÁGENES DE REGALOS
// ================================================================
const giftImagesMap = new Map();

function normalizarNombreRegalo(nombre) {
    return String(nombre || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-_]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function escanearCarpetaGifts(dir, baseUrl) {
    if (!fs.existsSync(dir)) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            escanearCarpetaGifts(fullPath, baseUrl + '/' + encodeURIComponent(entry.name));
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (!['.png', '.gif', '.webp', '.jpg', '.jpeg'].includes(ext)) continue;
            const nombreSinExt = path.basename(entry.name, ext);
            const clave = normalizarNombreRegalo(nombreSinExt);
            if (!clave) continue;
            if (!giftImagesMap.has(clave)) {
                giftImagesMap.set(clave, baseUrl + '/' + encodeURIComponent(entry.name));
            }
        }
    }
}

function cargarMapaGifts() {
    giftImagesMap.clear();
    const giftsDir = path.join(publicDir, 'img', 'gifts');
    if (!fs.existsSync(giftsDir)) {
        console.log('⚠️ No existe la carpeta img/gifts/');
        return;
    }
    escanearCarpetaGifts(giftsDir, '/img/gifts');
    console.log(`🎁 Mapa de regalos cargado: ${giftImagesMap.size} imágenes indexadas`);

    const ejemplos = Array.from(giftImagesMap.entries()).slice(0, 3);
    for (const [k, v] of ejemplos) {
        console.log(`   Ej: "${k}" → "${v}"`);
    }
    const testHeart = giftImagesMap.get('heart-me');
    if (testHeart) console.log(`   ✅ heart-me encontrado en: ${testHeart}`);
    else console.log(`   ⚠️ "heart-me" NO está en el mapa. Revisa el nombre de archivo/carpeta.`);
}
cargarMapaGifts();

function getGiftImageUrl(nombreRegalo) {
    if (!nombreRegalo) return null;
    const clave = normalizarNombreRegalo(nombreRegalo);
    if (!clave) return null;
    const relativa = giftImagesMap.get(clave);
    if (!relativa) return null;
    return relativa;
}

function buildAbsUrl(req, relativa) {
    if (!relativa) return null;
    if (/^https?:\/\//i.test(relativa)) return relativa;
    const base = `${req.protocol}://${req.get('host')}`;
    return base + (relativa.startsWith('/') ? relativa : '/' + relativa);
}

app.get('/api/gift-image/:nombre', (req, res) => {
    const clave = normalizarNombreRegalo(req.params.nombre);
    const relativa = giftImagesMap.get(clave) || null;
    res.json({
        ok: !!relativa,
        claveNormalizada: clave,
        url: buildAbsUrl(req, relativa)
    });
});

app.get('/api/gift-lookup/:nombre', (req, res) => {
    const clave = normalizarNombreRegalo(req.params.nombre);
    const relativa = giftImagesMap.get(clave) || null;
    res.json({
        buscado: req.params.nombre,
        claveNormalizada: clave,
        encontrado: !!relativa,
        url: buildAbsUrl(req, relativa),
        totalEnMapa: giftImagesMap.size
    });
});

app.get('/api/gift-search/:query', (req, res) => {
    const q = normalizarNombreRegalo(req.params.query);
    if (!q) return res.json({ ok: false, coincidencias: [] });

    const coincidencias = [];
    for (const [clave, url] of giftImagesMap.entries()) {
        if (clave.includes(q) || q.includes(clave) || clave.includes(q.slice(0, 4))) {
            coincidencias.push({
                clave,
                url: buildAbsUrl(req, url)
            });
        }
    }
    res.json({
        buscado: req.params.query,
        claveNormalizada: q,
        total: coincidencias.length,
        coincidencias: coincidencias.slice(0, 20)
    });
});

app.get('/api/gift-images-map', (req, res) => {
    const obj = {};
    for (const [k, v] of giftImagesMap.entries()) obj[k] = v;
    res.json(obj);
});

// ================================================================
// 🔍 TWITCH: BUSCADOR DE CATEGORÍAS + INFO DEL STREAM
// ================================================================
app.get('/api/twitch/search-category', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const channel = String(req.query.channel || '').trim();
    if (!q) return res.json({ ok: true, results: [] });

    const account = channel ? getAccountForChannel(channel) : getTwitchAccounts()[0];
    if (!account) return res.json({ ok: false, error: 'Sin cuentas configuradas', results: [] });

    try {
        const response = await axios.get(
            `https://api.twitch.tv/helix/search/categories?query=${encodeURIComponent(q)}&first=20`,
            { headers: { 'Client-ID': account.clientId, 'Authorization': `Bearer ${account.oauthToken.replace('oauth:', '')}` } }
        );
        const results = (response.data.data || []).map(g => ({
            id: g.id,
            name: g.name,
            boxArt: g.box_art_url ? g.box_art_url.replace('{width}', '52').replace('{height}', '72') : null
        }));
        res.json({ ok: true, results });
    } catch (error) {
        console.error('❌ Error buscando categoría:', error.response?.data || error.message);
        res.json({ ok: false, error: error.response?.data?.message || error.message, results: [] });
    }
});

app.get('/api/twitch/stream-info', async (req, res) => {
    const channel = String(req.query.channel || '').trim();
    if (!channel) return res.json({ ok: false, error: 'Falta channel' });

    const account = getAccountForChannel(channel);
    if (!account) return res.json({ ok: false, error: 'Canal sin cuenta' });

    const bId = await getUserId(channel, channel);
    if (!bId) return res.json({ ok: false, error: 'Canal no encontrado' });

    try {
        const response = await axios.get(
            `https://api.twitch.tv/helix/channels?broadcaster_id=${bId}`,
            { headers: { 'Client-ID': account.clientId, 'Authorization': `Bearer ${account.oauthToken.replace('oauth:', '')}` } }
        );
        const data = response.data.data?.[0];
        if (!data) return res.json({ ok: false, error: 'Sin datos' });
        res.json({
            ok: true,
            title: data.title || '',
            gameId: data.game_id || '',
            gameName: data.game_name || ''
        });
    } catch (error) {
        res.json({ ok: false, error: error.response?.data?.message || error.message });
    }
});

// ================================================================
// 🎨 TEMAS DE OVERLAYS
// ================================================================
const THEMES_PATH = IS_PACKAGED
    ? path.join(USER_DATA_DIR, 'themes.json')
    : path.join(__dirname, 'themes.json');
let themes = {};

if (IS_PACKAGED && !fs.existsSync(THEMES_PATH)) {
    const defaultThemes = path.join(__dirname, 'themes.json');
    if (fs.existsSync(defaultThemes)) {
        try {
            fs.copyFileSync(defaultThemes, THEMES_PATH);
            console.log('📋 Temas iniciales copiados desde el paquete');
        } catch (e) {}
    }
}

function cargarTemas() {
    try {
        if (fs.existsSync(THEMES_PATH)) {
            const data = fs.readFileSync(THEMES_PATH, 'utf8');
            themes = JSON.parse(data);
            console.log(`🎨 Temas cargados: ${Object.keys(themes).length} overlays configurados`);
        } else {
            themes = {};
            console.log('🎨 themes.json no existe, se creará al guardar el primer tema');
        }
    } catch (e) {
        console.error('❌ Error cargando themes.json:', e.message);
        themes = {};
    }
}

function guardarTemas() {
    try {
        fs.writeFileSync(THEMES_PATH, JSON.stringify(themes, null, 2));
        return true;
    } catch (e) {
        console.error('❌ Error guardando themes.json:', e.message);
        return false;
    }
}

// ================================================================
// 🏺 ESTADO PERSISTENTE DEL CRISTAL
// ================================================================
const JAR_STATE_PATH = IS_PACKAGED
    ? path.join(USER_DATA_DIR, 'jar-state.json')
    : path.join(__dirname, 'jar-state.json');

let jarState = {
    totalDiamonds: 0,
    userTotals: {},
    userAvatars: {},
    lastGift: null,
    updatedAt: null
};

function cargarJarState() {
    try {
        if (fs.existsSync(JAR_STATE_PATH)) {
            const raw = fs.readFileSync(JAR_STATE_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            jarState = {
                totalDiamonds: parsed.totalDiamonds || 0,
                userTotals: parsed.userTotals || {},
                userAvatars: parsed.userAvatars || {},
                lastGift: parsed.lastGift || null,
                updatedAt: parsed.updatedAt || null
            };
            console.log(`🏺 Estado del cristal cargado: ${jarState.totalDiamonds} 💎`);
        } else {
            console.log('🏺 No hay estado previo del cristal, empezando de 0');
        }
    } catch (e) {
        console.error('❌ Error cargando jar-state.json:', e.message);
        jarState = { totalDiamonds: 0, userTotals: {}, userAvatars: {}, lastGift: null, updatedAt: null };
    }
}

function guardarJarState() {
    try {
        jarState.updatedAt = new Date().toISOString();
        fs.writeFileSync(JAR_STATE_PATH, JSON.stringify(jarState, null, 2));
    } catch (e) {
        console.error('❌ Error guardando jar-state.json:', e.message);
    }
}

cargarJarState();

let jarDirty = false;
setInterval(() => {
    if (jarDirty) {
        guardarJarState();
        jarDirty = false;
    }
}, 10000);

app.get('/api/jar-state', (req, res) => {
    res.json(jarState);
});

app.post('/api/jar-state/reset', (req, res) => {
    jarState = {
        totalDiamonds: 0,
        userTotals: {},
        userAvatars: {},
        lastGift: null,
        updatedAt: new Date().toISOString()
    };
    guardarJarState();
    io.emit('jar-reset');
    console.log('🏺 Cristal reseteado');
    res.json({ success: true });
});

// ================================================================
// 🎨 TEMAS — Rutas
// ================================================================
cargarTemas();

app.get('/api/themes', (req, res) => {
    res.json(themes);
});

app.get('/api/themes/:overlay', (req, res) => {
    const key = req.params.overlay;
    res.json(themes[key] || {});
});

app.post('/api/themes/:overlay', (req, res) => {
    const key = req.params.overlay;
    const vars = req.body;

    if (!vars || typeof vars !== 'object') {
        return res.status(400).json({ success: false, error: 'Body inválido' });
    }

    const limpio = {};
    for (const [k, v] of Object.entries(vars)) {
        if (typeof k === 'string' && k.startsWith('--') && typeof v === 'string') {
            limpio[k] = v;
        }
    }

    themes[key] = limpio;

    if (guardarTemas()) {
        io.emit('theme-updated', { overlay: key, vars: limpio });
        console.log(`🎨 Tema actualizado: ${key} (${Object.keys(limpio).length} variables)`);
        res.json({ success: true });
    } else {
        res.status(500).json({ success: false, error: 'Error guardando' });
    }
});

app.delete('/api/themes/:overlay', (req, res) => {
    const key = req.params.overlay;
    delete themes[key];
    guardarTemas();
    io.emit('theme-updated', { overlay: key, vars: {} });
    console.log(`🎨 Tema reseteado: ${key}`);
    res.json({ success: true });
});

// ================================================================
// 📁 CONFIGURACIÓN
// ================================================================
function normalizarOauth(t) {
    if (!t) return '';
    return t.startsWith('oauth:') ? t : 'oauth:' + t;
}

function loadConfig() {
    try {
        const data = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(data);

        if (parsed.TWITCH_OAUTH_TOKEN) parsed.TWITCH_OAUTH_TOKEN = normalizarOauth(parsed.TWITCH_OAUTH_TOKEN);
        if (parsed.TWITCH_OAUTH_TOKEN_CHAT) parsed.TWITCH_OAUTH_TOKEN_CHAT = normalizarOauth(parsed.TWITCH_OAUTH_TOKEN_CHAT);
        if (!parsed.TWITCH_OAUTH_TOKEN_CHAT) parsed.TWITCH_OAUTH_TOKEN_CHAT = parsed.TWITCH_OAUTH_TOKEN;

        if (Array.isArray(parsed.TWITCH_ACCOUNTS)) {
            parsed.TWITCH_ACCOUNTS = parsed.TWITCH_ACCOUNTS.map(acc => ({
                id: acc.id || ('acc_' + Math.random().toString(36).slice(2, 10)),
                clientId: acc.clientId || '',
                oauthToken: normalizarOauth(acc.oauthToken || ''),
                oauthTokenChat: normalizarOauth(acc.oauthTokenChat || acc.oauthToken || ''),
                botUsername: acc.botUsername || '',
                channels: Array.isArray(acc.channels) ? acc.channels : []
            }));
        }

        if (!parsed.PLATFORMS_ENABLED || typeof parsed.PLATFORMS_ENABLED !== 'object') {
            parsed.PLATFORMS_ENABLED = {};
        }
        for (const k of ['tiktok', 'twitch', 'kick', 'youtube']) {
            if (typeof parsed.PLATFORMS_ENABLED[k] !== 'boolean') {
                parsed.PLATFORMS_ENABLED[k] = true;
            }
        }

        if (!parsed.TTS || typeof parsed.TTS !== 'object') parsed.TTS = {};
        const ttsDefaults = {
            enabled: true,
            voice: 'es-ES-AlvaroNeural',
            rate: '+0%',
            pitch: '+0Hz',
            volume: 0.8,
            readFrom: { twitch: true, tiktok: true, kick: true, youtube: true },
            readEvents: { chat: true, gifts: false, follows: false, donations: false, subs: false }
        };
        for (const [k, v] of Object.entries(ttsDefaults)) {
            if (parsed.TTS[k] === undefined) parsed.TTS[k] = v;
            else if (v && typeof v === 'object' && !Array.isArray(v)) {
                parsed.TTS[k] = { ...v, ...(parsed.TTS[k] || {}) };
            }
        }
        // 🤖 AI Co-Host — defaults
        if (!parsed.aiCohost || typeof parsed.aiCohost !== 'object') parsed.aiCohost = {};
        const aiDefaults = {
            enabled: false,
            nombre: '',
            personalidad: '',
            comando: '!guia',
            proveedores: {
                groq:       { apiKey: '', modelo: 'openai/gpt-oss-20b' },
                cerebras:   { apiKey: '', modelo: 'gpt-oss-120b' },
                openrouter: { apiKey: '', modelo: 'meta-llama/llama-3.1-8b-instruct:free' },
                agnes:      { apiKey: '', modelo: 'agnes-2.5-flash' }
            }
        };
        for (const [k, v] of Object.entries(aiDefaults)) {
            if (parsed.aiCohost[k] === undefined) parsed.aiCohost[k] = v;
            else if (v && typeof v === 'object' && !Array.isArray(v) && !k.startsWith('proveedores')) {
                parsed.aiCohost[k] = { ...v, ...(parsed.aiCohost[k] || {}) };
            }
        }
        if (!parsed.aiCohost.proveedores || typeof parsed.aiCohost.proveedores !== 'object') {
            parsed.aiCohost.proveedores = aiDefaults.proveedores;
        } else {
            for (const [pid, pdef] of Object.entries(aiDefaults.proveedores)) {
                if (!parsed.aiCohost.proveedores[pid]) {
                    parsed.aiCohost.proveedores[pid] = { ...pdef };
                } else {
                    parsed.aiCohost.proveedores[pid] = { ...pdef, ...parsed.aiCohost.proveedores[pid] };
                }
            }
        }

        if (typeof parsed.JAR_META !== 'number' || parsed.JAR_META < 1) {
            parsed.JAR_META = 500;
        }

        console.log(`✅ Config cargado desde ${CONFIG_PATH}`);
        return parsed;
    } catch (e) {
        console.log(`⚠️ No se pudo leer config.json (${e.message}). Usando defaults.`);
        const defaults = {
            PLATFORMS_ENABLED: { tiktok: true, twitch: true, kick: true, youtube: true },
            TWITCH_ACCOUNTS: [],
            TIKTOK_USER_ID: "", TIKTOK_USERS: [],
            ENABLE_CENSORSHIP: false,
            KICK_USERNAME: "", KICK_USERS: [],
            YOUTUBE_USERS: [],
            CONTROL_URL: "https://livecenter.tiktok.com/live_monitor",
            TTS: {},
            aiCohost: {
                enabled: false, nombre: '', personalidad: '', comando: '!guia',
                proveedores: {
                    groq:       { apiKey: '', modelo: 'openai/gpt-oss-20b' },
                    cerebras:   { apiKey: '', modelo: 'llama3.1-8b' },
                    openrouter: { apiKey: '', modelo: 'meta-llama/llama-3.1-8b-instruct:free' }
                }
            },
            JAR_META: 500
        };
        if (!fs.existsSync(CONFIG_PATH)) {
            try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2)); } catch (e) {}
        }
        return defaults;
    }
}

let config = loadConfig();

// 🤖 Cargar proveedores de IA con la config actual
aiKeyPool.cargarProveedores(config);
console.log(`🤖 AI Co-Host: ${config.aiCohost?.enabled ? 'ACTIVADO' : 'desactivado'}`);
// ================================================================
// 📺 VISTAS DE TIKTOK LIVE CENTER (multi-cuenta genérico)
// ================================================================
const DEFAULT_TIKTOK_VIEWS = [
    { id: 'slot1', name: 'Cuenta 1', url: 'https://livecenter.tiktok.com/live_monitor', partition: 'persist:tiktok-slot-1' },
    { id: 'slot2', name: 'Cuenta 2', url: 'https://livecenter.tiktok.com/live_monitor', partition: 'persist:tiktok-slot-2' },
    { id: 'slot3', name: 'Cuenta 3', url: 'https://livecenter.tiktok.com/live_monitor', partition: 'persist:tiktok-slot-3' }
];

app.get('/api/tiktok/views', (req, res) => {
    try {
        const views = Array.isArray(config.TIKTOK_VIEWS) && config.TIKTOK_VIEWS.length > 0
            ? config.TIKTOK_VIEWS
            : DEFAULT_TIKTOK_VIEWS;
        const active = config.TIKTOK_ACTIVE_VIEW && views.some(v => v.id === config.TIKTOK_ACTIVE_VIEW)
            ? config.TIKTOK_ACTIVE_VIEW
            : views[0].id;

        res.json({ ok: true, views, active });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/tiktok/active-view', (req, res) => {
    try {
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ ok: false, error: 'Falta id' });

        const views = Array.isArray(config.TIKTOK_VIEWS) && config.TIKTOK_VIEWS.length > 0
            ? config.TIKTOK_VIEWS
            : DEFAULT_TIKTOK_VIEWS;
        if (!views.some(v => v.id === id)) {
            return res.status(400).json({ ok: false, error: 'Vista desconocida: ' + id });
        }

        config.TIKTOK_ACTIVE_VIEW = id;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`📺 [TIKTOK VIEW] Vista activa: ${id}`);
        res.json({ ok: true, active: id });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/tiktok/views', (req, res) => {
    try {
        const { views } = req.body || {};
        if (!Array.isArray(views)) return res.status(400).json({ ok: false, error: 'views debe ser un array' });

        for (const v of views) {
            if (!v.id || !v.name || !v.url || !v.partition) {
                return res.status(400).json({ ok: false, error: 'Cada vista necesita id, name, url y partition' });
            }
        }

        config.TIKTOK_VIEWS = views;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`📺 [TIKTOK VIEW] Lista actualizada (${views.length} vistas)`);
        res.json({ ok: true, views });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
// ================================================================
// 🏺 RUTA POST — Cambiar meta del cristal
// ================================================================
app.post('/api/jar-state/meta', (req, res) => {
    try {
        const { meta } = req.body;
        console.log(`📥 [META] Recibida petición con meta = ${meta}`);

        if (typeof meta !== 'number' || meta < 1) {
            console.log(`❌ [META] Meta inválida: ${meta}`);
            return res.status(400).json({ error: 'Meta inválida' });
        }

        config.JAR_META = meta;
        console.log(`🏺 [META] Asignada a config.JAR_META = ${config.JAR_META}`);

        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`✅ [META] Guardado en ${CONFIG_PATH}`);

        io.emit('jar-meta-updated', { meta });
        console.log(`📡 [META] Emitido jar-meta-updated = ${meta}`);

        res.json({ success: true });
    } catch (e) {
        console.error(`❌ [META] Error:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

// ================================================================
// 🤖 RUTAS API — AI CO-HOST
// ================================================================
app.get('/api/ai/status', (req, res) => {
    try {
        const estado = aiKeyPool.estadoProveedores();
        const ai = config.aiCohost || {};
        res.json({
            ok: true,
            enabled: !!ai.enabled,
            nombre: ai.nombre || '',
            comando: ai.comando || '!guia',
            proveedores: estado
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/ai/test-key', async (req, res) => {
    try {
        const { proveedor, apiKey } = req.body || {};
        if (!proveedor) return res.status(400).json({ ok: false, error: 'Falta proveedor' });
        const r = await aiKeyPool.probarKey(proveedor, apiKey);
        res.json(r);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/ai/reload', (req, res) => {
    try {
        const nuevo = loadConfig();
        config = nuevo;
        aiKeyPool.cargarProveedores(config);
        io.emit('ai-status', aiKeyPool.estadoProveedores());
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ================================================================
// 🔥 HELPERS DE TOGGLES DE PLATAFORMAS
// ================================================================
function isPlatformEnabled(name) {
    const e = config.PLATFORMS_ENABLED || {};
    return e[name] !== false;
}
function getPlatformsEnabled() {
    const e = config.PLATFORMS_ENABLED || {};
    return {
        tiktok:  e.tiktok  !== false,
        twitch:  e.twitch  !== false,
        kick:    e.kick    !== false,
        youtube: e.youtube !== false
    };
}

// ================================================================
// 🔥 HELPERS MULTI-CUENTA
// ================================================================
function getTwitchAccounts() {
    if (Array.isArray(config.TWITCH_ACCOUNTS) && config.TWITCH_ACCOUNTS.length > 0) {
        return config.TWITCH_ACCOUNTS;
    }
    if (config.TWITCH_CLIENT_ID || config.TWITCH_OAUTH_TOKEN || config.TWITCH_BOT_USERNAME) {
        const channels = Array.isArray(config.channels) && config.channels.length > 0
            ? config.channels
            : (config.TWITCH_CHANNEL ? [config.TWITCH_CHANNEL] : []);
        return [{
            id: 'legacy',
            clientId: config.TWITCH_CLIENT_ID || '',
            oauthToken: normalizarOauth(config.TWITCH_OAUTH_TOKEN || ''),
            oauthTokenChat: normalizarOauth(config.TWITCH_OAUTH_TOKEN_CHAT || config.TWITCH_OAUTH_TOKEN || ''),
            botUsername: config.TWITCH_BOT_USERNAME || '',
            channels
        }];
    }
    return [];
}

function getAccountForChannel(channelName) {
    if (!channelName) return null;
    const key = String(channelName).toLowerCase();
    const accounts = getTwitchAccounts();
    for (const acc of accounts) {
        if (Array.isArray(acc.channels) && acc.channels.some(c => String(c).toLowerCase() === key)) {
            return acc;
        }
    }
    return null;
}

function getClientIdForChannel(channelName) {
    const acc = getAccountForChannel(channelName);
    return acc ? acc.clientId : '';
}
function getApiTokenForChannel(channelName) {
    const acc = getAccountForChannel(channelName);
    if (!acc) return '';
    return (acc.oauthToken || '').replace('oauth:', '');
}
function getChatTokenForChannel(channelName) {
    const acc = getAccountForChannel(channelName);
    if (!acc) return '';
    return acc.oauthTokenChat || acc.oauthToken || '';
}
function getBotUsernameForChannel(channelName) {
    const acc = getAccountForChannel(channelName);
    return acc ? acc.botUsername : '';
}
function getAllTwitchChannels() {
    const set = new Set();
    for (const acc of getTwitchAccounts()) {
        if (Array.isArray(acc.channels)) acc.channels.forEach(c => set.add(c));
    }
    return Array.from(set);
}

function getTikTokUsers() {
    if (Array.isArray(config.TIKTOK_USERS) && config.TIKTOK_USERS.length > 0) {
        return config.TIKTOK_USERS.map(s => String(s).trim().replace(/^@/, '')).filter(Boolean);
    }
    if (config.TIKTOK_USER_ID) {
        return String(config.TIKTOK_USER_ID).split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean);
    }
    return [];
}
function getKickUsers() {
    if (Array.isArray(config.KICK_USERS) && config.KICK_USERS.length > 0) {
        return config.KICK_USERS.map(s => String(s).trim().replace(/^@/, '')).filter(Boolean);
    }
    if (config.KICK_USERNAME) {
        return [String(config.KICK_USERNAME).trim().replace(/^@/, '')].filter(Boolean);
    }
    return [];
}
function getYouTubeUsers() {
    if (Array.isArray(config.YOUTUBE_USERS) && config.YOUTUBE_USERS.length > 0) {
        return config.YOUTUBE_USERS.map(s => String(s).trim()).filter(Boolean);
    }
    if (config.YOUTUBE_USER_ID) {
        return String(config.YOUTUBE_USER_ID).split(',').map(s => s.trim()).filter(Boolean);
    }
    if (config.youtube && Array.isArray(config.youtube.channels)) {
        return config.youtube.channels.map(s => String(s).trim()).filter(Boolean);
    }
    return [];
}

console.log('📌 Configuración cargada:');
console.log(`   Cuentas de Twitch: ${getTwitchAccounts().length}`);
getTwitchAccounts().forEach((acc, i) => {
    console.log(`     [${i + 1}] Bot: ${acc.botUsername || '(sin bot)'} | Canales: ${(acc.channels || []).join(', ') || '(ninguno)'}`);
});
console.log(`   TikTok Users: ${getTikTokUsers().join(', ') || '(ninguno)'}`);
console.log(`   Kick Users: ${getKickUsers().join(', ') || '(ninguno)'}`);
console.log(`   YouTube Users: ${getYouTubeUsers().join(', ') || '(ninguno)'}`);
console.log(`   🔊 TTS: ${config.TTS?.enabled ? 'ACTIVADO' : 'desactivado'} | Voz: ${config.TTS?.voice || 'N/A'}`);
console.log(`   🤖 AI Co-Host: ${config.aiCohost?.enabled ? 'ACTIVADO' : 'desactivado'} | Nombre: ${config.aiCohost?.nombre || '(sin nombre)'}`);
console.log(`   🏺 Meta cristal: ${config.JAR_META} 💎`);

// ================================================================
// 🛠️ VARIABLES
// ================================================================
const twitchChannels = new Map();
const bannedUsers = new Map();

// 🚫 Lista de palabras bloqueadas (para TTS y overlay si se usa)
const filteredWords = new Set([
    'puta', 'puto', 'putas', 'putos',
    'mierda', 'mierdas',
    'cabron', 'cabrón', 'cabrona', 'cabronas',
    'pendejo', 'pendeja', 'pendejos', 'pendejas',
    'idiota', 'idiotas',
    'imbecil', 'imbécil', 'imbeciles', 'imbéciles',
    'estupido', 'estúpido', 'estupida', 'estúpida',
    'gilipollas', 'capullo', 'capulla',
    'joder', 'jodete', 'jódete',
    'coño', 'cono',
    'hostia', 'hostias',
    'marica', 'maricon', 'maricón', 'maricona',
    'zorra', 'zorras',
    'perra', 'perras',
    'chupa', 'chupala', 'chúpala',
    'verga', 'vergas',
    'chinga', 'chingada', 'chingado', 'chingas',
    'pinche',
    'negro', 'negra', 'negros', 'negras',
    'nigga', 'nigger', 'niggas', 'niggers',
    'sudaca', 'sudacas',
    'gitano', 'gitana', 'gitanos', 'gitanas',
    'moro', 'mora', 'moros', 'moras',
    'panchito', 'panchita',
    'indio', 'india',
    'chino', 'china',
    'travelo', 'travesti',
    'torta', 'tortillera',
    'plumifero', 'plumífero',
    'retrasado', 'retrasada', 'retrasados', 'retrasadas',
    'subnormal', 'subnormales',
    'mongolo', 'mongola', 'mongolos',
    'polla', 'pollas',
    'pito',
    'nalga', 'nalgas',
    'tetas',
    'culos',
    'porno', 'pornografia', 'pornografía',
    'xxx',
    'matate', 'mátate',
    'suicidate', 'suicídate',
    'muere',
    'violacion', 'violación',
    'violar',
    'nazi', 'nazis',
    'hitler',
    'spam',
    'scam',
    'estafa',
    'phishing'
]);

let totalDiamonds = 0;
let totalBits = 0;
const TIKTOK_DEFAULT_AVATAR = 'https://i.imgur.com/OmnpuQH.png';
const KICK_DEFAULT_AVATAR = 'https://i.imgur.com/OmnpuQH.png';
const YOUTUBE_DEFAULT_AVATAR = 'https://i.imgur.com/OmnpuQH.png';
const recentMessages = new Map();

function isDuplicateMessage(msg) {
    if (!msg || !msg.username || !msg.message) return false;
    const key = `${msg.platform || 'twitch'}|${msg.channel || ''}|${msg.username}|${msg.message}`.toLowerCase();
    const now = Date.now();
    const last = recentMessages.get(key);
    if (last && (now - last) < 8000) return true;
    recentMessages.set(key, now);
    return false;
}

function broadcastMessage(msgData) {
    if (isDuplicateMessage(msgData)) return;
    io.emit('chat-message', msgData);
    if (msgData && msgData.username && msgData.message && msgData.type !== 'ai') {
        try { aiCohost.agregarAlaMemoria(msgData.username, msgData.message, config); } catch (e) {}
    }
}

// ================================================================
// 🤖 AI CO-HOST — Helper de invocación
// ================================================================
async function procesarCoHost(usuario, texto, plataforma, canal) {
    try {
        if (!config.aiCohost || !config.aiCohost.enabled) return;

        const mensaje = { usuario, texto, plataforma, canal };

        if (!aiCohost.debeResponder(mensaje, config)) return;

        console.log(`🤖 [AI] ${plataforma} → ${usuario}: ${texto}`);

        const r = await aiCohost.responder(mensaje, config);

        if (!r.ok) {
            console.log(`⚠️ [AI] No respondió: ${r.motivo}`);
            return;
        }

        console.log(`🤖 [AI] Respuesta (${r.proveedor}): ${r.texto}`);

        io.emit('chat-message', {
            platform: plataforma,
            channel: canal,
            username: config.aiCohost.nombre || 'Guía',
            message: r.texto,
            avatar: null,
            color: '#a970ff',
            type: 'ai',
            timestamp: Date.now()
        });

        tryEnqueueTTS({
            text: r.texto,
            type: 'chat',
            platform: plataforma,
            user: config.aiCohost.nombre || 'Guía'
        });

    } catch (e) {
        console.error('❌ [AI] Error en cohost:', e.message);
    }
}

// ================================================================
// 🔊 TTS — Cola + helper central
// ================================================================
const ttsQueue = new TTSQueue(io);

const BOTS_CONOCIDOS = new Set([
    'nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot',
    'sery_bot', 'kofistreambot', 'soundalerts', 'creatisbot', 'commanderroot',
    'own3d', 'stay_hydrated_bot', 'pokemoncommunitygame', 'tangiabot', 'togikirei'
]);

function esBot(nombre) {
    if (!nombre) return false;
    const n = String(nombre).toLowerCase().trim();
    if (BOTS_CONOCIDOS.has(n)) return true;
    if (n.endsWith('bot')) return true;
    if (n.endsWith('_bot')) return true;
    if (n.endsWith('bot_')) return true;
    return false;
}

function contienePalabraProhibida(texto) {
    if (!texto) return false;
    const t = String(texto).toLowerCase();
    for (const palabra of filteredWords) {
        if (t.includes(palabra)) return true;
    }
    return false;
}

function tryEnqueueTTS({ text, type = 'chat', platform, user }) {
    try {
        const tts = config.TTS || {};
        if (!tts.enabled) return;
        if (!tts.readFrom || tts.readFrom[platform] === false) return;
        if (!tts.readEvents || tts.readEvents[type] === false) return;
        if (type === 'chat' && typeof text === 'string' && /(^|\s)!/.test(text)) return;

        if (user && esBot(user)) return;
        if (contienePalabraProhibida(text)) return;

        ttsQueue.enqueue({
            text, type, platform, user,
            options: { voice: tts.voice, rate: tts.rate, pitch: tts.pitch }
        });
    } catch (e) {
        console.error('❌ [TTS] Error encolando:', e.message);
    }
}

// ================================================================
// 🎵 INSTANCIA TIKTOK
// ================================================================
const tiktokChat = new TikTokChat({
    onChat: (msg) => {
        const msgData = {
            platform: 'tiktok', username: msg.username, message: msg.message,
            channel: msg.channel, avatar: msg.avatar || TIKTOK_DEFAULT_AVATAR,
            color: '#fe2c55', timestamp: msg.timestamp
        };
        if (isDuplicateMessage(msgData)) return;
        io.emit('chat-message', msgData);
        try { aiCohost.agregarAlaMemoria(msg.username, msg.message, config); } catch (e) {}
        tryEnqueueTTS({
            text: `${msg.username} dice: ${msg.message}`,
            type: 'chat', platform: 'tiktok', user: msg.username
        });
        procesarCoHost(msg.username, msg.message, 'tiktok', msg.channel);
    },
    onLike: (data) => { io.emit('tiktok-like', data); },
    onGift: (data) => {
        io.emit('tiktok-gift', data);
        if (data.esFinal && data.diamantesTotales > 0) {
            const giftImageLocal = getGiftImageUrl(data.giftName);
            const giftImageFinal = giftImageLocal || data.giftIcon || null;
            const giftImageSource = giftImageLocal ? 'local' : (data.giftIcon ? 'remote' : 'none');

            const diamonds = data.diamantesTotales || 0;
            jarState.totalDiamonds += diamonds;
            jarState.userTotals[data.username] = (jarState.userTotals[data.username] || 0) + diamonds;
            if (data.avatar) jarState.userAvatars[data.username] = data.avatar;
            jarState.lastGift = {
                username: data.username,
                avatar: data.avatar || null,
                giftName: data.giftName,
                giftImage: giftImageFinal,
                repeatCount: data.repeatCount || 1,
                diamonds: diamonds,
                timestamp: Date.now()
            };
            jarDirty = true;

            io.emit('jar-update', {
                totalDiamonds: jarState.totalDiamonds,
                lastGift: jarState.lastGift,
                userTotals: jarState.userTotals
            });

            io.emit('chat-message', {
                platform: 'tiktok',
                username: data.username,
                message: `🎁 ${data.username} envió ${data.repeatCount > 1 ? data.repeatCount + '× ' : ''}${data.giftName} (${data.diamantesTotales} 💎)`,
                channel: data.channel,
                avatar: data.avatar || TIKTOK_DEFAULT_AVATAR,
                color: '#fe2c55',
                type: 'gift',
                timestamp: data.timestamp,
                giftName: data.giftName,
                giftRepeat: data.repeatCount,
                giftDiamonds: data.diamondUnit || data.diamantesTotales,
                giftTotalDiamonds: data.diamantesTotales,
                giftImage: giftImageFinal,
                giftImageSource: giftImageSource,
                giftIcon: data.giftIcon || null,
                extendedGiftInfo: data.extendedGiftInfo || null
            });
        }
    },
    onFollow: (data) => {
        io.emit('tiktok-follow', data);
        io.emit('chat-message', {
            platform: 'tiktok', username: data.username,
            message: `👤 ${data.username} te empezó a seguir`,
            channel: data.channel, avatar: data.avatar || TIKTOK_DEFAULT_AVATAR,
            color: '#fe2c55', type: 'follow', timestamp: data.timestamp
        });
    },
    onShare: (data) => {
        io.emit('tiktok-share', data);
        io.emit('chat-message', {
            platform: 'tiktok', username: data.username,
            message: `🔗 ${data.username} compartió tu directo`,
            channel: data.channel, avatar: data.avatar || TIKTOK_DEFAULT_AVATAR,
            color: '#fe2c55', type: 'share', timestamp: data.timestamp
        });
    },
    onSubscribe: (data) => {
        io.emit('tiktok-sub', data);
        io.emit('chat-message', {
            platform: 'tiktok', username: data.username,
            message: `⭐ ${data.username} se suscribió`,
            channel: data.channel, avatar: data.avatar || TIKTOK_DEFAULT_AVATAR,
            color: '#fe2c55', type: 'sub', timestamp: data.timestamp
        });
    },
    onMember: (data) => {
        io.emit('tiktok-member', data);
        io.emit('chat-message', {
            platform: 'tiktok', username: data.username,
            message: data.message || `🌹 ${data.username} se unió al directo`,
            channel: data.channel, avatar: data.avatar || TIKTOK_DEFAULT_AVATAR,
            color: '#fe2c55', type: 'member', timestamp: data.timestamp
        });
    },
    onRoomUser: (data) => { io.emit('tiktok-viewers', data); },
    onSocial: (data) => { io.emit('tiktok-social', data); },
    onStatus: (info) => { io.emit('tiktok-status', info); },
    onStats: ({ usuario, stats }) => {
        io.emit('tiktok-stats', { usuario, stats });
        const todos = tiktokChat.getAllStats();
        io.emit('tiktok-stats-all', todos);
        totalDiamonds = Object.values(todos).reduce((sum, s) => sum + (Number(s.diamantes) || 0), 0);
        io.emit('stats-update', { totalDiamonds, totalBits });
    }
});

async function startTikTok() {
    if (!isPlatformEnabled('tiktok')) {
        try { tiktokChat.detenerTodo(); } catch {}
        console.log('⏭️ [TIKTOK] Deshabilitado por config.');
        return;
    }
    const usuarios = getTikTokUsers();
    if (usuarios.length === 0) {
        console.log('⚠️ [TIKTOK] No hay usuarios configurados, saltando conexión.');
        return;
    }
    console.log(`🎵 [TIKTOK] Iniciando conexión a: ${usuarios.join(', ')}`);
    try {
        await tiktokChat.setUsuarios(usuarios);
        console.log('✅ [TIKTOK] Módulo iniciado.');
    } catch (err) {
        console.error('❌ [TIKTOK] Error al iniciar:', err.message);
    }
}

// ================================================================
// 📺 INSTANCIA YOUTUBE
// ================================================================
const youtubeChat = new YouTubeChat({
    onChat: (msg) => {
        const msgData = {
            platform: 'youtube', username: msg.username, message: msg.message,
            channel: msg.channel, avatar: msg.avatar || YOUTUBE_DEFAULT_AVATAR,
            color: '#ff0000', timestamp: msg.timestamp
        };
        if (isDuplicateMessage(msgData)) return;
        io.emit('chat-message', msgData);
        try { aiCohost.agregarAlaMemoria(msg.username, msg.message, config); } catch (e) {}
        tryEnqueueTTS({
            text: `${msg.username} dice: ${msg.message}`,
            type: 'chat', platform: 'youtube', user: msg.username
        });
        procesarCoHost(msg.username, msg.message, 'youtube', msg.channel);
    },
    onGift: (data) => {
        io.emit('youtube-superchat', data);
        io.emit('chat-message', {
            platform: 'youtube',
            username: data.username,
            message: `💎 ${data.username} envió ${data.giftName || 'Super Chat'} ${data.amount ? '(' + data.amount + ')' : ''}${data.message ? ': ' + data.message : ''}`,
            channel: data.channel,
            avatar: data.avatar || YOUTUBE_DEFAULT_AVATAR,
            color: '#ff0000',
            type: 'gift',
            timestamp: data.timestamp,
            giftName: data.giftName,
            giftAmount: data.amount,
            giftTier: data.tier,
            extendedGiftInfo: data
        });
    },
    onMember: (data) => {
        io.emit('youtube-member', data);
        io.emit('chat-message', {
            platform: 'youtube',
            username: data.username,
            message: `⭐ ${data.message || data.username + ' se unió como miembro'}`,
            channel: data.channel,
            avatar: data.avatar || YOUTUBE_DEFAULT_AVATAR,
            color: '#ff0000',
            type: 'member',
            timestamp: data.timestamp
        });
    }
});

async function startYouTube() {
    if (!isPlatformEnabled('youtube')) {
        try { youtubeChat.stopAll(); } catch {}
        console.log('⏭️ [YOUTUBE] Deshabilitado por config.');
        return;
    }
    const usuarios = getYouTubeUsers();
    if (usuarios.length === 0) {
        console.log('⚠️ [YOUTUBE] No hay canales configurados, saltando conexión.');
        return;
    }
    console.log(`📺 [YOUTUBE] Iniciando conexión a: ${usuarios.join(', ')}`);
    try {
        await youtubeChat.setChannels(usuarios);
        console.log('✅ [YOUTUBE] Módulo iniciado.');
    } catch (err) {
        console.error('❌ [YOUTUBE] Error al iniciar:', err.message);
    }
}

// ================================================================
// 📡 RUTAS FRONTEND
// ================================================================
app.get('/get-config', (req, res) => {
    res.json({
        PLATFORMS_ENABLED: getPlatformsEnabled(),
        TWITCH_ACCOUNTS: getTwitchAccounts(),
        TWITCH_CLIENT_ID: config.TWITCH_CLIENT_ID || '',
        TWITCH_OAUTH_TOKEN: config.TWITCH_OAUTH_TOKEN || '',
        TWITCH_OAUTH_TOKEN_CHAT: config.TWITCH_OAUTH_TOKEN_CHAT || '',
        TWITCH_BOT_USERNAME: config.TWITCH_BOT_USERNAME || '',
        TWITCH_CHANNEL: config.TWITCH_CHANNEL || '',
        TIKTOK_USER_ID: config.TIKTOK_USER_ID || '',
        TIKTOK_USERS: Array.isArray(config.TIKTOK_USERS) && config.TIKTOK_USERS.length > 0
            ? config.TIKTOK_USERS
            : (config.TIKTOK_USER_ID ? String(config.TIKTOK_USER_ID).split(',').map(s => s.trim()).filter(Boolean) : []),
        KICK_USERNAME: config.KICK_USERNAME || '',
        KICK_USERS: Array.isArray(config.KICK_USERS) && config.KICK_USERS.length > 0
            ? config.KICK_USERS
            : (config.KICK_USERNAME ? [config.KICK_USERNAME] : []),
        YOUTUBE_USERS: getYouTubeUsers(),
        YOUTUBE_USER_ID: config.YOUTUBE_USER_ID || '',
        ENABLE_CENSORSHIP: config.ENABLE_CENSORSHIP || false,
        channels: getAllTwitchChannels(),
        CONTROL_URL: config.CONTROL_URL || 'https://livecenter.tiktok.com/live_monitor',
        TTS: config.TTS || {},
        JAR_META: config.JAR_META || 500,
        aiCohost: {
            enabled: !!(config.aiCohost && config.aiCohost.enabled),
            nombre: config.aiCohost?.nombre || '',
            personalidad: config.aiCohost?.personalidad || '',
            comando: config.aiCohost?.comando || '!guia',
            proveedores: {
                groq:       { modelo: config.aiCohost?.proveedores?.groq?.modelo || 'openai/gpt-oss-20b', apiKey: config.aiCohost?.proveedores?.groq?.apiKey ? '***' : '' },
                cerebras:   { modelo: config.aiCohost?.proveedores?.cerebras?.modelo || 'gpt-oss-120b', apiKey: config.aiCohost?.proveedores?.cerebras?.apiKey ? '***' : '' },
                openrouter: { modelo: config.aiCohost?.proveedores?.openrouter?.modelo || 'meta-llama/llama-3.1-8b-instruct:free', apiKey: config.aiCohost?.proveedores?.openrouter?.apiKey ? '***' : '' },
                agnes:      { modelo: config.aiCohost?.proveedores?.agnes?.modelo || 'agnes-2.5-flash', apiKey: config.aiCohost?.proveedores?.agnes?.apiKey ? '***' : '' }
            }
        }
    });
});

app.post('/save-config', (req, res) => {
    try {
        const newConfig = req.body;

        if (Array.isArray(newConfig.TWITCH_ACCOUNTS)) {
            newConfig.TWITCH_ACCOUNTS = newConfig.TWITCH_ACCOUNTS.map(acc => ({
                id: acc.id || ('acc_' + Math.random().toString(36).slice(2, 10)),
                clientId: acc.clientId || '',
                oauthToken: normalizarOauth(acc.oauthToken || ''),
                oauthTokenChat: normalizarOauth(acc.oauthTokenChat || acc.oauthToken || ''),
                botUsername: acc.botUsername || '',
                channels: Array.isArray(acc.channels) ? acc.channels : []
            }));
        }

        if (newConfig.TWITCH_OAUTH_TOKEN) newConfig.TWITCH_OAUTH_TOKEN = normalizarOauth(newConfig.TWITCH_OAUTH_TOKEN);
        if (newConfig.TWITCH_OAUTH_TOKEN_CHAT) newConfig.TWITCH_OAUTH_TOKEN_CHAT = normalizarOauth(newConfig.TWITCH_OAUTH_TOKEN_CHAT);

        if (!Array.isArray(newConfig.TIKTOK_USERS)) newConfig.TIKTOK_USERS = [];
        if (!Array.isArray(newConfig.KICK_USERS)) newConfig.KICK_USERS = [];
        if (!Array.isArray(newConfig.YOUTUBE_USERS)) newConfig.YOUTUBE_USERS = [];
        if (newConfig.TIKTOK_USERS.length > 0) newConfig.TIKTOK_USER_ID = newConfig.TIKTOK_USERS.join(', ');
        if (newConfig.KICK_USERS.length > 0) newConfig.KICK_USERNAME = newConfig.KICK_USERS[0];
        if (newConfig.YOUTUBE_USERS.length > 0) newConfig.YOUTUBE_USER_ID = newConfig.YOUTUBE_USERS.join(', ');
        if (!newConfig.CONTROL_URL) newConfig.CONTROL_URL = 'https://livecenter.tiktok.com/live_monitor';

        if (!newConfig.PLATFORMS_ENABLED || typeof newConfig.PLATFORMS_ENABLED !== 'object') {
            newConfig.PLATFORMS_ENABLED = {};
        }
        for (const k of ['tiktok', 'twitch', 'kick', 'youtube']) {
            newConfig.PLATFORMS_ENABLED[k] = newConfig.PLATFORMS_ENABLED[k] !== false;
        }

        if (!newConfig.TTS || typeof newConfig.TTS !== 'object') {
            newConfig.TTS = config.TTS || {};
        }

        if (newConfig.aiCohost && typeof newConfig.aiCohost === 'object') {
            const provs = newConfig.aiCohost.proveedores || {};
            for (const pid of ['groq', 'cerebras', 'openrouter', 'agnes']) {
                const actual = provs[pid] || {};
                const previo = (config.aiCohost?.proveedores?.[pid] || {});
                if (!actual.apiKey || actual.apiKey === '***' || actual.apiKey === '••••••••') {
                    actual.apiKey = previo.apiKey || '';
                }
                if (!actual.modelo) {
                    actual.modelo = previo.modelo || '';
                }
                provs[pid] = actual;
            }
            newConfig.aiCohost.proveedores = provs;
        } else {
            newConfig.aiCohost = config.aiCohost || {};
        }

        if (typeof newConfig.JAR_META !== 'number' || newConfig.JAR_META < 1) {
            newConfig.JAR_META = config.JAR_META || 500;
        }

        const canalesPlanos = newConfig.TWITCH_ACCOUNTS
            ? newConfig.TWITCH_ACCOUNTS.flatMap(a => a.channels)
            : (newConfig.channels || []);
        if (canalesPlanos.length > 0) {
            newConfig.channels = canalesPlanos;
            newConfig.TWITCH_CHANNEL = canalesPlanos[0];
        }

        fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2));
        config = newConfig;
        console.log(`✅ Config guardado en ${CONFIG_PATH}`);

        try {
            aiKeyPool.cargarProveedores(config);
            io.emit('ai-status', aiKeyPool.estadoProveedores());
            console.log(`🤖 AI Co-Host: ${config.aiCohost?.enabled ? 'ACTIVADO' : 'desactivado'}`);
        } catch (e) {
            console.error('❌ Error recargando pool IA:', e.message);
        }

        cargarMapaGifts();

        const en = getPlatformsEnabled();

        (async () => {
            try { await reconectarTwitch(); }
            catch (err) { console.error('❌ Error reconectando Twitch:', err.message); }

            if (en.kick) {
                if (kickWs) { try { kickWs.close(); } catch (e) {} }
                connectKick();
            } else {
                if (kickReconnectTimer) { clearTimeout(kickReconnectTimer); kickReconnectTimer = null; }
                if (kickWs) { try { kickWs.close(); } catch {} try { kickWs.terminate(); } catch {} kickWs = null; }
                console.log('🔌 [KICK] Desconectado (plataforma deshabilitada)');
            }

            try {
                if (en.tiktok) {
                    const usuarios = getTikTokUsers();
                    await tiktokChat.setUsuarios(usuarios);
                    console.log(`🎵 [TIKTOK] Usuarios actualizados: ${usuarios.join(', ') || '(ninguno)'}`);
                } else {
                    try { tiktokChat.detenerTodo(); } catch {}
                    console.log('🔌 [TIKTOK] Desconectado (plataforma deshabilitada)');
                }
            } catch (err) {
                console.error('❌ [TIKTOK] Error al actualizar usuarios:', err.message);
            }

            try {
                if (en.youtube) {
                    const ytUsuarios = getYouTubeUsers();
                    await youtubeChat.setChannels(ytUsuarios);
                    console.log(`📺 [YOUTUBE] Canales actualizados: ${ytUsuarios.join(', ') || '(ninguno)'}`);
                } else {
                    try { youtubeChat.stopAll(); } catch {}
                    console.log('🔌 [YOUTUBE] Desconectado (plataforma deshabilitada)');
                }
            } catch (err) {
                console.error('❌ [YOUTUBE] Error al actualizar canales:', err.message);
            }
        })();

        res.json({ success: true, message: "✅ Configuración guardada correctamente" });
    } catch (error) {
        console.error('❌ Error guardando config:', error);
        res.status(500).json({ success: false, message: "❌ Error al guardar: " + error.message });
    }
});

app.get('/avatar/:username', async (req, res) => {
    const accounts = getTwitchAccounts().filter(a => a.clientId && a.oauthToken);
    if (accounts.length === 0) return res.json({ avatar: null });
    const acc = accounts[0];
    const id = await getUserId(req.params.username, acc.channels[0]);
    if (!id) return res.json({ avatar: null });
    try {
        const response = await axios.get(`https://api.twitch.tv/helix/users?id=${id}`, {
            headers: { 'Client-ID': acc.clientId, 'Authorization': `Bearer ${acc.oauthToken.replace('oauth:', '')}` }
        });
        res.json({ avatar: response.data.data?.[0]?.profile_image_url || null });
    } catch (error) {
        res.json({ avatar: null });
    }
});

app.get('/tiktok-stats', (req, res) => {
    try { res.json({ ok: true, stats: tiktokChat.getAllStats() }); }
    catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/youtube-status', (req, res) => {
    try { res.json({ ok: true, status: youtubeChat.getStatus() }); }
    catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ================================================================
// 🖼️ RUTAS DE PÁGINAS
// ================================================================
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'panel.html')));
app.get('/overlay', (req, res) => res.sendFile(path.join(publicDir, 'overlay.html')));
app.get('/overlays', (req, res) => res.sendFile(path.join(publicDir, 'overlays.html')));
app.get('/moderation', (req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));
app.get('/config', (req, res) => res.sendFile(path.join(publicDir, 'config.html')));
app.get('/crystal', (req, res) => res.sendFile(path.join(publicDir, 'crystal.html')));

app.get('/setup.html', (req, res) => res.sendFile(path.join(publicDir, 'setup.html')));

app.get('/top-donadores',   (req, res) => res.sendFile(path.join(publicDir, 'top-donadores.html')));
app.get('/top-likes',       (req, res) => res.sendFile(path.join(publicDir, 'top-likes.html')));
app.get('/top-shares',      (req, res) => res.sendFile(path.join(publicDir, 'top-shares.html')));
app.get('/follows',         (req, res) => res.sendFile(path.join(publicDir, 'follows.html')));
app.get('/last-follower',   (req, res) => res.sendFile(path.join(publicDir, 'last-follower.html')));
app.get('/stats',           (req, res) => res.sendFile(path.join(publicDir, 'stats.html')));

// ================================================================
// 📡 FUNCIONES TWITCH
// ================================================================
async function getUserId(username, channelName) {
    if (!username) return null;
    let clientId = '', token = '';
    if (channelName) {
        clientId = getClientIdForChannel(channelName);
        token = getApiTokenForChannel(channelName);
    }
    if (!clientId || !token) {
        const acc = getTwitchAccounts().find(a => a.clientId && a.oauthToken);
        if (!acc) return null;
        clientId = acc.clientId;
        token = acc.oauthToken.replace('oauth:', '');
    }
    try {
        const response = await axios.get(`https://api.twitch.tv/helix/users?login=${username}`, {
            headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` }
        });
        return response.data.data?.[0]?.id || null;
    } catch (error) {
        console.error(`❌ [API ERROR] getUserId(${username}):`, error.response?.status, error.response?.data?.message || error.message);
        return null;
    }
}

async function getUserAvatar(userId, channelName) {
    if (!userId) return null;
    let clientId = '', token = '';
    if (channelName) {
        clientId = getClientIdForChannel(channelName);
        token = getApiTokenForChannel(channelName);
    }
    if (!clientId || !token) {
        const acc = getTwitchAccounts().find(a => a.clientId && a.oauthToken);
        if (!acc) return null;
        clientId = acc.clientId;
        token = acc.oauthToken.replace('oauth:', '');
    }
    try {
        const response = await axios.get(`https://api.twitch.tv/helix/users?id=${userId}`, {
            headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` }
        });
        return response.data.data?.[0]?.profile_image_url || null;
    } catch (error) { return null; }
}

async function getCategoryId(categoryName, channelName) {
    if (!categoryName) return null;
    if (/^\d+$/.test(categoryName)) return categoryName;
    let clientId = '', token = '';
    if (channelName) {
        clientId = getClientIdForChannel(channelName);
        token = getApiTokenForChannel(channelName);
    }
    if (!clientId || !token) {
        const acc = getTwitchAccounts().find(a => a.clientId && a.oauthToken);
        if (!acc) return null;
        clientId = acc.clientId;
        token = acc.oauthToken.replace('oauth:', '');
    }
    try {
        const response = await axios.get(`https://api.twitch.tv/helix/games/search?query=${encodeURIComponent(categoryName)}`, {
            headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` }
        });
        return response.data.data?.[0]?.id || null;
    } catch (error) {
        console.error(`❌ Error buscando categoría ${categoryName}:`, error.message);
        return null;
    }
}

// ================================================================
// 🛡️ MODERACIÓN
// ================================================================
async function banWithAPI(channelName, username, reason) {
    const account = getAccountForChannel(channelName);
    if (!account) return io.emit('mod-command-result', { success: false, message: `❌ Canal ${channelName} sin cuenta configurada` });

    const broadcasterId = await getUserId(channelName, channelName);
    const userId = await getUserId(username, channelName);
    if (!broadcasterId || !userId) {
        io.emit('mod-command-result', { success: false, message: `❌ No encontré usuario o canal` });
        return;
    }
    const clientId = account.clientId;
    const token = account.oauthToken.replace('oauth:', '');

    let moderatorId = broadcasterId;
    if (account.botUsername && account.botUsername.toLowerCase() !== channelName.toLowerCase()) {
        const botId = await getUserId(account.botUsername, channelName);
        if (botId) moderatorId = botId;
    }

    try {
        await axios.post(
            `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`,
            { data: { user_id: userId, reason: reason || 'Baneado' } },
            { headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` } }
        );
        io.emit('mod-command-result', { success: true, message: `✅ Baneado: ${username}` });
    } catch (error) {
        io.emit('mod-command-result', { success: false, message: `❌ Error al banear: ${error.response?.data?.message || error.message}` });
    }
}

async function timeoutWithAPI(channelName, username, seconds, reason) {
    const account = getAccountForChannel(channelName);
    if (!account) return io.emit('mod-command-result', { success: false, message: `❌ Canal ${channelName} sin cuenta` });

    const broadcasterId = await getUserId(channelName, channelName);
    const userId = await getUserId(username, channelName);
    if (!broadcasterId || !userId) return;
    const clientId = account.clientId;
    const token = account.oauthToken.replace('oauth:', '');
    let moderatorId = broadcasterId;
    if (account.botUsername && account.botUsername.toLowerCase() !== channelName.toLowerCase()) {
        const botId = await getUserId(account.botUsername, channelName);
        if (botId) moderatorId = botId;
    }
    try {
        await axios.post(
            `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`,
            { data: { user_id: userId, reason: reason || 'Timeout', duration: seconds || 600 } },
            { headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` } }
        );
        io.emit('mod-command-result', { success: true, message: `✅ Timeout: ${username} (${seconds || 600}s)` });
    } catch (error) {
        io.emit('mod-command-result', { success: false, message: `❌ Error al timeout: ${error.response?.data?.message || error.message}` });
    }
}

async function unbanWithAPI(channelName, username) {
    const account = getAccountForChannel(channelName);
    if (!account) return;
    const broadcasterId = await getUserId(channelName, channelName);
    const userId = await getUserId(username, channelName);
    if (!broadcasterId || !userId) return;
    const clientId = account.clientId;
    const token = account.oauthToken.replace('oauth:', '');
    try {
        await axios.delete(
            `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}&user_id=${userId}`,
            { headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` } }
        );
        io.emit('mod-command-result', { success: true, message: `✅ Desbaneado: ${username}` });
    } catch (error) {
        io.emit('mod-command-result', { success: false, message: `❌ Error al desbanear: ${error.response?.data?.message || error.message}` });
    }
}

async function warnInTwitch(channelName, username, reason) {
    const entry = twitchChannels.get(channelName.toLowerCase());
    if (!entry || !entry.client) {
        io.emit('mod-command-result', { success: false, message: '❌ Cliente no conectado' });
        return;
    }
    try {
        await entry.client.say(channelName, `@${username} ⚠️ Advertencia: ${reason || 'Comportamiento inapropiado'}`);
        io.emit('mod-command-result', { success: true, message: `✅ Advertencia enviada a ${username}` });
    } catch (error) {
        io.emit('mod-command-result', { success: false, message: `❌ Error al advertir: ${error.message}` });
    }
}

async function executeModCommand(command) {
    const { action, username, reason, seconds, channel } = command;
    const targetChannel = channel || getAllTwitchChannels()[0] || '';
    switch (action) {
        case 'ban': await banWithAPI(targetChannel, username, reason); break;
        case 'unban': await unbanWithAPI(targetChannel, username); break;
        case 'timeout': await timeoutWithAPI(targetChannel, username, seconds, reason); break;
        case 'warn': await warnInTwitch(targetChannel, username, reason); break;
        default: console.log('Acción desconocida:', action);
    }
}

// ================================================================
// 📊 ENCUESTAS Y PREDICCIONES
// ================================================================
async function createTwitchPoll(data) {
    const channel = data.channel;
    const account = getAccountForChannel(channel);
    if (!account) return { error: `Canal ${channel} sin cuenta` };
    const bId = await getUserId(channel, channel);
    if (!bId) return { error: 'ID no encontrado' };
    try {
        const response = await axios.post(
            `https://api.twitch.tv/helix/polls?broadcaster_id=${bId}`,
            {
                broadcaster_id: bId, title: data.question,
                choices: data.options.map(o => ({ title: o })),
                duration: data.duration || 300, channel_points_voting_enabled: false
            },
            { headers: { 'Client-ID': account.clientId, 'Authorization': `Bearer ${account.oauthToken.replace('oauth:', '')}` } }
        );
        const poll = response.data.data[0];
        return { id: poll.id, channel, question: poll.title, options: poll.choices.map(c => c.title), votes: poll.choices.map(c => c.votes), active: true };
    } catch (error) {
        console.error('❌ Error encuesta:', error.response?.data || error.message);
        return { error: 'Error al crear encuesta: ' + (error.response?.data?.message || error.message) };
    }
}

async function endTwitchPoll(pollId) {
    for (const canal of getAllTwitchChannels()) {
        const account = getAccountForChannel(canal);
        if (!account) continue;
        const bId = await getUserId(canal, canal);
        if (!bId) continue;
        try {
            await axios.patch(
                `https://api.twitch.tv/helix/polls?broadcaster_id=${bId}`,
                { broadcaster_id: bId, id: pollId, status: 'TERMINATED' },
                { headers: { 'Client-ID': account.clientId, 'Authorization': `Bearer ${account.oauthToken.replace('oauth:', '')}` } }
            );
            return { success: true };
        } catch (e) { }
    }
    return { error: 'Error al finalizar encuesta' };
}

async function createTwitchPrediction(data) {
    const channel = data.channel;
    const account = getAccountForChannel(channel);
    if (!account) return { error: `Canal ${channel} sin cuenta` };
    const bId = await getUserId(channel, channel);
    if (!bId) return { error: 'ID no encontrado' };
    try {
        const response = await axios.post(
            `https://api.twitch.tv/helix/predictions?broadcaster_id=${bId}`,
            {
                broadcaster_id: bId, title: data.question,
                outcomes: data.options.map(o => ({ title: o })),
                prediction_window: data.duration || 300
            },
            { headers: { 'Client-ID': account.clientId, 'Authorization': `Bearer ${account.oauthToken.replace('oauth:', '')}` } }
        );
        const pred = response.data.data[0];
        return { id: pred.id, channel, question: pred.title, outcomes: pred.outcomes.map(o => ({ title: o.title, id: o.id })), active: true };
    } catch (error) {
        console.error('❌ Error predicción:', error.response?.data || error.message);
        return { error: 'Error al crear predicción: ' + (error.response?.data?.message || error.message) };
    }
}

async function resolveTwitchPrediction(predictionId, winningOutcomeId) {
    for (const canal of getAllTwitchChannels()) {
        const account = getAccountForChannel(canal);
        if (!account) continue;
        const bId = await getUserId(canal, canal);
        if (!bId) continue;
        try {
            await axios.patch(
                `https://api.twitch.tv/helix/predictions?broadcaster_id=${bId}`,
                { broadcaster_id: bId, id: predictionId, status: 'RESOLVED', winning_outcome_id: winningOutcomeId },
                { headers: { 'Client-ID': account.clientId, 'Authorization': `Bearer ${account.oauthToken.replace('oauth:', '')}` } }
            );
            return { success: true };
        } catch (e) { }
    }
    return { error: 'Error al resolver predicción' };
}

// ================================================================
// 🎮 CATEGORÍA Y TÍTULO
// ================================================================
async function changeCategory(channelName, categoryName) {
    const account = getAccountForChannel(channelName);
    if (!account) return { error: `Canal ${channelName} sin cuenta configurada` };
    const bId = await getUserId(channelName, channelName);
    if (!bId) return { error: `Canal ${channelName} no encontrado` };
    const catId = await getCategoryId(categoryName, channelName);
    if (!catId) return { error: `Categoría "${categoryName}" no encontrada` };
    try {
        await axios.patch(
            `https://api.twitch.tv/helix/channels?broadcaster_id=${bId}`,
            { game_id: catId },
            { headers: { 'Client-ID': account.clientId, 'Authorization': `Bearer ${account.oauthToken.replace('oauth:', '')}`, 'Content-Type': 'application/json' } }
        );
        io.emit('category-changed', { channel: channelName, category: categoryName });
        return { success: true, message: `Categoría cambiada a: ${categoryName} (ID: ${catId})` };
    } catch (error) {
        console.error('❌ Error cambiando categoría:', error.response?.data || error.message);
        return { error: 'Error al cambiar categoría: ' + (error.response?.data?.message || error.message) };
    }
}

async function changeStreamTitle(channelName, title) {
    const account = getAccountForChannel(channelName);
    if (!account) return { error: `Canal ${channelName} sin cuenta` };
    const bId = await getUserId(channelName, channelName);
    if (!bId) return { error: `Canal ${channelName} no encontrado` };
    try {
        await axios.patch(
            `https://api.twitch.tv/helix/channels?broadcaster_id=${bId}`,
            { title },
            { headers: { 'Client-ID': account.clientId, 'Authorization': `Bearer ${account.oauthToken.replace('oauth:', '')}`, 'Content-Type': 'application/json' } }
        );
        io.emit('title-changed', { channel: channelName, title });
        return { success: true, message: `Título cambiado a: ${title}` };
    } catch (error) {
        console.error('❌ Error cambiando título:', error.response?.data || error.message);
        return { error: 'Error al cambiar título: ' + (error.response?.data?.message || error.message) };
    }
}

// ================================================================
// 🔌 TWITCH CHAT
// ================================================================
async function connectTwitchChannel(channelName, account) {
    const key = channelName.toLowerCase();
    if (twitchChannels.has(key)) {
        console.log(`⏭️ [TWITCH] ${channelName} ya está conectado.`);
        return;
    }
    if (!account || !account.botUsername || !account.oauthTokenChat) {
        console.log(`⏭️ [TWITCH] ${channelName}: sin bot o sin token de chat, no se conecta.`);
        return;
    }

    console.log(`🔌 [TWITCH] Conectando ${channelName} con bot ${account.botUsername}...`);
    try {
        const client = new tmi.Client({
            options: { debug: false },
            connection: { reconnect: true, secure: true },
            identity: { username: account.botUsername, password: account.oauthTokenChat },
            channels: [channelName]
        });

        client.on('message', async (channel, tags, message, self) => {
            if (self) return;
            const username = tags['display-name'] || tags.username;
            const canal = channel.replace('#', '');
            console.log(`📩 [TWITCH ${canal}] ${username}: ${message}`);
            const avatar = tags['user-id'] ? await getUserAvatar(tags['user-id'], canal) : null;
            const msgData = {
                platform: 'twitch', channel: canal, username, message,
                avatar: avatar || null, color: tags.color || '#bf94ff', timestamp: Date.now()
            };
            if (isDuplicateMessage(msgData)) return;
            io.emit('chat-message', msgData);
            try { aiCohost.agregarAlaMemoria(username, message, config); } catch (e) {}
            tryEnqueueTTS({
                text: `${username} dice: ${message}`,
                type: 'chat',
                platform: 'twitch',
                user: username
            });

            procesarCoHost(username, message, 'twitch', canal);
        });

        client.on('cheer', async (channel, tags, message, self) => {
            if (self) return;
            const username = tags['display-name'] || tags.username;
            const bits = parseInt(tags.bits) || 0;
            totalBits += bits;
            io.emit('stats-update', { totalDiamonds, totalBits });
            const canal = channel.replace('#', '');
            const avatar = tags['user-id'] ? await getUserAvatar(tags['user-id'], canal) : null;
            const msgData = {
                platform: 'twitch', channel: canal, username,
                message: `🎉 Cheer de ${bits} bits: ${message || '¡Gracias!'}`,
                avatar: avatar || null, type: 'cheer', bits, color: '#ffcc00', timestamp: Date.now()
            };
            if (isDuplicateMessage(msgData)) return;
            io.emit('chat-message', msgData);
        });

        client.on('subscription', async (channel, username, method, message, userstate) => {
            const canal = channel.replace('#', '');
            const avatar = userstate['user-id'] ? await getUserAvatar(userstate['user-id'], canal) : null;
            const msgData = {
                platform: 'twitch', channel: canal, username,
                message: '🌟 ¡Gracias por suscribirte! 🌟',
                avatar: avatar || null, type: 'sub', timestamp: Date.now()
            };
            if (isDuplicateMessage(msgData)) return;
            io.emit('chat-message', msgData);
        });

        client.on('resub', async (channel, username, months, message, userstate) => {
            const canal = channel.replace('#', '');
            const avatar = userstate['user-id'] ? await getUserAvatar(userstate['user-id'], canal) : null;
            const msgData = {
                platform: 'twitch', channel: canal, username,
                message: `🌟 ¡Gracias por resuscribirte (${months} meses)! 🌟`,
                avatar: avatar || null, type: 'sub', months, timestamp: Date.now()
            };
            if (isDuplicateMessage(msgData)) return;
            io.emit('chat-message', msgData);
        });

        client.on('raided', async (channel, username, viewers) => {
            const canal = channel.replace('#', '');
            const msgData = {
                platform: 'twitch', channel: canal, username,
                message: `🎮 ¡${viewers} personas se unieron al raid! 🎮`,
                type: 'raid', viewers, timestamp: Date.now()
            };
            if (isDuplicateMessage(msgData)) return;
            io.emit('chat-message', msgData);
        });

        await client.connect();
        console.log(`✅ [TWITCH] Conectado ${channelName} (bot: ${account.botUsername})`);
        twitchChannels.set(key, { client, accountId: account.id, account });
    } catch (err) {
        console.error(`❌ [TWITCH] Error conectando ${channelName}: ${err.message}`);
    }
}

async function reconectarTwitch() {
    if (!isPlatformEnabled('twitch')) {
        for (const [canalKey, entry] of twitchChannels.entries()) {
            try { await entry.client.disconnect(); } catch {}
            twitchChannels.delete(canalKey);
            console.log(`🔌 [TWITCH] Desconectado ${canalKey} (plataforma deshabilitada)`);
        }
        console.log('⏭️ [TWITCH] Deshabilitado por config.');
        return;
    }

    const accounts = getTwitchAccounts();
    const deseados = new Set();
    for (const acc of accounts) {
        if (Array.isArray(acc.channels)) acc.channels.forEach(c => deseados.add(c.toLowerCase()));
    }

    for (const [canalKey, entry] of twitchChannels.entries()) {
        if (!deseados.has(canalKey)) {
            try { await entry.client.disconnect(); } catch {}
            twitchChannels.delete(canalKey);
            console.log(`🔌 [TWITCH] Desconectado ${canalKey}`);
        }
    }

    for (const acc of accounts) {
        if (!Array.isArray(acc.channels)) continue;
        for (const canal of acc.channels) {
            const key = canal.toLowerCase();
            const existente = twitchChannels.get(key);
            if (existente && existente.accountId === acc.id) continue;
            if (existente) {
                try { await existente.client.disconnect(); } catch {}
                twitchChannels.delete(key);
            }
            await connectTwitchChannel(canal, acc);
        }
    }
}

// ================================================================
// 🔥 KICK
// ================================================================
let kickWs = null;
let kickReconnectTimer = null;

async function connectKick() {
    if (!isPlatformEnabled('kick')) {
        if (kickReconnectTimer) { clearTimeout(kickReconnectTimer); kickReconnectTimer = null; }
        if (kickWs) { try { kickWs.close(); } catch {} try { kickWs.terminate(); } catch {} kickWs = null; }
        console.log('⏭️ [KICK] Deshabilitado por config.');
        return;
    }

    const kickUser = getKickUsers()[0] || '';

    if (!kickUser) {
        console.log('⚠️ [KICK] No hay usuario configurado');
        return;
    }

    if (kickReconnectTimer) { clearTimeout(kickReconnectTimer); kickReconnectTimer = null; }

    console.log(`🔌 [KICK] Buscando chat de: ${kickUser}...`);

    let chatroomId = null;
    try {
        const response = await axios.get(`https://kick.com/api/v2/channels/${kickUser}`, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            }
        });
        if (!response.data || !response.data.chatroom) {
            console.log(`❌ [KICK] Canal "${kickUser}" no encontrado o sin chatroom.`);
            kickReconnectTimer = setTimeout(connectKick, 30000);
            return;
        }
        chatroomId = response.data.chatroom.id;
        console.log(`✅ [KICK] Chatroom encontrado: ID ${chatroomId}`);
    } catch (e) {
        console.error(`❌ [KICK] Error obteniendo info:`, e.response?.status || e.message);
        kickReconnectTimer = setTimeout(connectKick, 30000);
        return;
    }

    const pusherUrl = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=7.6.0&flash=false';

    try {
        kickWs = new WebSocket(pusherUrl);
    } catch (e) {
        console.error('❌ [KICK] Error creando WebSocket:', e.message);
        kickReconnectTimer = setTimeout(connectKick, 15000);
        return;
    }

    kickWs.on('open', () => {
        console.log('✅ [KICK] Conectado a Pusher. Suscribiendo...');
        kickWs.send(JSON.stringify({
            event: 'pusher:subscribe',
            data: { channel: `chatrooms.${chatroomId}.v2` }
        }));
    });

    kickWs.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());

            if (msg.event === 'pusher_internal:subscription_succeeded') {
                console.log('✅ [KICK] Suscripción activa.');
                return;
            }

            if (msg.event === 'App\\Events\\ChatMessageEvent') {
                const payload = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
                if (payload && payload.sender && payload.content) {
                    const kickUsername = payload.sender.username || 'Usuario';
                    broadcastMessage({
                        platform: 'kick', channel: kickUser,
                        username: kickUsername,
                        message: payload.content,
                        avatar: payload.sender.profile_pic || KICK_DEFAULT_AVATAR
                    });

                    tryEnqueueTTS({
                        text: `${kickUsername} dice: ${payload.content}`,
                        type: 'chat',
                        platform: 'kick',
                        user: kickUsername
                    });

                    procesarCoHost(kickUsername, payload.content, 'kick', kickUser);
                }
            }

            if (msg.event === 'App\\Events\\KicksGifted') {
                const payload = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
                if (payload && payload.sender) {
                    broadcastMessage({
                        platform: 'kick', channel: kickUser,
                        username: payload.sender.username,
                        message: `🎁 Envió ${payload.gift?.name || 'un regalo'}`,
                        avatar: payload.sender.profile_pic || KICK_DEFAULT_AVATAR
                    });
                }
            }
        } catch (e) {}
    });

    kickWs.on('close', () => {
        console.log('🔌 [KICK] Desconectado. Reintentando en 10s...');
        kickReconnectTimer = setTimeout(connectKick, 10000);
    });

    kickWs.on('error', (err) => {
        console.error('❌ [KICK] Error WebSocket:', err.message);
    });
}

// ================================================================
// 🔌 SOCKET.IO
// ================================================================
io.on('connection', (socket) => {
    console.log(`💻 Navegador conectado: ${socket.id}`);

    socket.on('connect-twitch', async (data) => {
        const channel = data.channel || getAllTwitchChannels()[0];
        const acc = getAccountForChannel(channel);
        if (acc) await connectTwitchChannel(channel, acc);
    });
    socket.on('mod-command', (cmd) => executeModCommand(cmd));
    socket.on('create-twitch-poll', async (data) => { const poll = await createTwitchPoll(data); io.emit('twitch-poll-created', poll); });
    socket.on('end-twitch-poll', async (data) => { const result = await endTwitchPoll(data.pollId); io.emit('twitch-poll-ended', result); });
    socket.on('create-twitch-prediction', async (data) => { const prediction = await createTwitchPrediction(data); io.emit('twitch-prediction-created', prediction); });
    socket.on('resolve-twitch-prediction', async (data) => { const result = await resolveTwitchPrediction(data.predictionId, data.winningOutcomeId); io.emit('twitch-prediction-resolved', result); });
    socket.on('change-category', async (data) => { const result = await changeCategory(data.channel, data.category); io.emit('category-change-result', result); });
    socket.on('change-title', async (data) => { const result = await changeStreamTitle(data.channel, data.title); io.emit('title-change-result', result); });

    socket.on('tiktok-set-usuarios', async (usuarios) => {
        try { await tiktokChat.setUsuarios(usuarios); socket.emit('tiktok-usuarios-ok', { ok: true }); }
        catch (err) { socket.emit('tiktok-usuarios-ok', { ok: false, error: err.message }); }
    });

    socket.on('youtube-set-canales', async (canales) => {
        try {
            await youtubeChat.setChannels(canales);
            socket.emit('youtube-canales-ok', { ok: true, canales: getYouTubeUsers() });
        } catch (err) {
            socket.emit('youtube-canales-ok', { ok: false, error: err.message });
        }
    });

    socket.on('tiktok-get-stats', () => { socket.emit('tiktok-stats-all', tiktokChat.getAllStats()); });
    socket.on('tiktok-reset-stats', (usuario) => { tiktokChat.resetStats(usuario || undefined); });

    socket.emit('jar-state', jarState);

    socket.on('jar-reset', () => {
        jarState = {
            totalDiamonds: 0,
            userTotals: {},
            userAvatars: {},
            lastGift: null,
            updatedAt: new Date().toISOString()
        };
        guardarJarState();
        io.emit('jar-reset');
        console.log('🏺 Cristal reseteado vía socket');
    });

    socket.on('tts:done', ({ filename } = {}) => {
        ttsQueue.done(filename);
        if (filename) ttsEngine.cleanupOlderThan(filename);
    });

    socket.on('tts:preview', async ({ text, voice, rate, pitch } = {}) => {
        try {
            const { url, filename } = await ttsEngine.synthesize(
                text || 'Hola, esta es una prueba de voz de TogiPanel.',
                {
                    voice: voice || config.TTS?.voice || 'es-ES-AlvaroNeural',
                    rate:  rate  || config.TTS?.rate  || '+0%',
                    pitch: pitch || config.TTS?.pitch || '+0Hz'
                }
            );
            socket.emit('tts:preview-ready', { url, filename });
        } catch (e) {
            console.error('❌ [TTS] Error en preview:', e.message);
            socket.emit('tts:preview-error', { error: e.message });
        }
    });

    socket.emit('ai-status', aiKeyPool.estadoProveedores());

    socket.on('disconnect', () => { console.log(`💻 Navegador desconectado: ${socket.id}`); });
});

// ================================================================
// 🛑 CIERRE LIMPIO
// ================================================================
let shuttingDown = false;
async function shutdown(reason = 'unknown') {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n🛑 Cerrando servidor (${reason})...`);

    try { guardarJarState(); } catch (e) {}

    if (kickWs) { try { kickWs.close(); } catch {} try { kickWs.terminate(); } catch {} }
    if (kickReconnectTimer) clearTimeout(kickReconnectTimer);
    try { tiktokChat.detenerTodo(); } catch {}
    try { youtubeChat.stopAll(); } catch {}
    try { await tiktokProxy.stop(); } catch (e) {}

    for (const [key, entry] of twitchChannels.entries()) {
        try { await entry.client.disconnect(); } catch {}
    }
    twitchChannels.clear();

    try { io.close(); } catch {}

    server.close(() => {
        console.log('✅ Servidor cerrado correctamente.');
        process.exit(0);
    });

    setTimeout(() => { process.exit(0); }, 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGBREAK', () => shutdown('SIGBREAK'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
process.on('uncaughtException', (err) => { console.error('❌ Uncaught:', err); shutdown('uncaught'); });
process.on('unhandledRejection', (reason) => { console.error('⚠️ Unhandled:', reason); });
process.on('exit', () => {
    if (kickWs) { try { kickWs.terminate(); } catch {} }
    try { guardarJarState(); } catch (e) {}
});

// ================================================================
// 🚀 ARRANQUE
// ================================================================
function checkExistingInstance(port, callback) {
    const req = http.get(`http://localhost:${port}/health`, (res) => {
        res.resume();
        callback(res.statusCode === 200);
    });
    req.on('error', () => callback(false));
    req.setTimeout(1500, () => { req.destroy(); callback(false); });
}

function startServer(port) {
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ Puerto ${port} ocupado. Saliendo.`);
            process.exit(0);
        } else {
            console.error('❌ Error del servidor:', err);
            process.exit(1);
        }
    });

    server.listen(port, async () => {
        console.log(`🚀 Servidor Maestro en http://localhost:${port}`);
        console.log(`📊 Estadísticas: Diamantes=${totalDiamonds}, Bits=${totalBits}`);

        const en = getPlatformsEnabled();
        console.log('📋 Plataformas activas:',
            Object.entries(en).filter(([, v]) => v).map(([k]) => k).join(', ') || 'ninguna');

        if (en.twitch)  await reconectarTwitch();
        else            console.log('⏭️ [TWITCH] Deshabilitado por config.');

        if (en.kick)    connectKick();
        else            console.log('⏭️ [KICK] Deshabilitado por config.');

        if (en.tiktok)  await startTikTok();
        else            console.log('⏭️ [TIKTOK] Deshabilitado por config.');

        if (en.youtube) await startYouTube();
        else            console.log('⏭️ [YOUTUBE] Deshabilitado por config.');
    });
}

checkExistingInstance(PORT, (exists) => {
    if (exists) {
        console.log(`✅ Ya hay servidor corriendo en ${PORT}. Saliendo.`);
        process.exit(0);
    }
    startServer(PORT);
});