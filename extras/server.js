// server.js - VERSIÓN MULTI-CUENTA TWITCH + TikTok + Kick + YouTube + IMÁGENES DE REGALOS + TEMAS + PLATFORM TOGGLES + TTS + CRISTAL PERSISTENTE + AI CO-HOST + KICK API OFICIAL
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
// 💎 CRISTAL — Config del estilo (jar / bar)
// ================================================================
app.get('/api/crystal/config', (req, res) => {
    res.json({
        ok: true,
        style: config.CRYSTAL_STYLE || 'jar',
        meta: config.JAR_META || 500
    });
});

app.post('/api/crystal/style', (req, res) => {
    try {
        const { style } = req.body || {};
        if (!['jar', 'bar'].includes(style)) {
            return res.status(400).json({ ok: false, error: 'style debe ser "jar" o "bar"' });
        }
        config.CRYSTAL_STYLE = style;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        io.emit('crystal-style-updated', { style });
        console.log(`💎 [CRISTAL] Estilo actualizado: ${style}`);
        res.json({ ok: true, style });
    } catch (e) {
        console.error('❌ [CRISTAL] Error cambiando estilo:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
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
                cerebras:   { apiKey: '', modelo: 'llama3.1-70b' },
                openrouter: { apiKey: '', modelo: 'meta-llama/llama-3.1-70b-instruct:free' }
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

        if (typeof parsed.CRYSTAL_STYLE !== 'string' || !['jar', 'bar'].includes(parsed.CRYSTAL_STYLE)) {
            parsed.CRYSTAL_STYLE = 'jar';
        }

                        // 🟢 KICK — defaults con cookies (NUEVO)
        if (!parsed.kick || typeof parsed.kick !== 'object') {
            parsed.kick = {
                cookies: '',
                sessionToken: '',
                username: '',
                connected: false,
                lastCheck: 0
            };
        } else {
            parsed.kick.cookies = parsed.kick.cookies || '';
            parsed.kick.sessionToken = parsed.kick.sessionToken || '';
            parsed.kick.username = parsed.kick.username || '';
            parsed.kick.connected = !!parsed.kick.connected;
            parsed.kick.lastCheck = Number(parsed.kick.lastCheck) || 0;
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
                    cerebras:   { apiKey: '', modelo: 'llama3.1-70b' },
                    openrouter: { apiKey: '', modelo: 'meta-llama/llama-3.1-70b-instruct:free' }
                }
            },
                        JAR_META: 500,
                        kick: {
                cookies: '',
                sessionToken: '',
                username: '',
                connected: false,
                lastCheck: 0
            }
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
const filteredWords = new Set(['spam', 'odio']);
let totalDiamonds = 0;
let totalBits = 0;
const TIKTOK_DEFAULT_AVATAR = 'https://i.imgur.com/OmnpuQH.png';
const KICK_DEFAULT_AVATAR = 'https://i.imgur.com/OmnpuQH.png';
const YOUTUBE_DEFAULT_AVATAR = 'https://i.imgur.com/OmnpuQH.png';
const recentMessages = new Map();

// 🔧 Módulos externos montados más abajo
let geminiLive = null;
let geminiText = null;

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
        try { aiCohost.agregarAlaMemoria(msgData.username, msgData.message); } catch (e) {}
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

function tryEnqueueTTS({ text, type = 'chat', platform, user }) {
    try {
        const tts = config.TTS || {};
        if (!tts.enabled) return;
        if (!tts.readFrom || tts.readFrom[platform] === false) return;
        if (!tts.readEvents || tts.readEvents[type] === false) return;
        if (type === 'chat' && typeof text === 'string' && /(^|\s)!/.test(text)) return;

        ttsQueue.enqueue({
            text,
            type,
            platform,
            user,
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
        try { aiCohost.agregarAlaMemoria(msg.username, msg.message); } catch (e) {}
        tryEnqueueTTS({
            text: `${msg.username} dice: ${msg.message}`,
            type: 'chat',
            platform: 'tiktok',
            user: msg.username
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

            if (giftImageSource === 'none') {
                console.log(`⚠️ [GIFT] Sin imagen (ni local ni remota) para "${data.giftName}" ` +
                            `(clave: ${normalizarNombreRegalo(data.giftName)})`);
            } else {
                console.log(`🎁 [GIFT] "${data.giftName}" → imagen ${giftImageSource}`);
            }
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
        try { aiCohost.agregarAlaMemoria(msg.username, msg.message); } catch (e) {}
        tryEnqueueTTS({
            text: `${msg.username} dice: ${msg.message}`,
            type: 'chat',
            platform: 'youtube',
            user: msg.username
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
        CRYSTAL_STYLE: config.CRYSTAL_STYLE || 'jar',
                kick: {
            connected: !!(kickCookies && kickCookies.connected),
            username: (kickCookies && kickCookies.username) || config.KICK_USERNAME || '',
            lastCheck: (kickCookies && kickCookies.lastCheck) || 0
        },
        aiCohost: {
            enabled: !!(config.aiCohost && config.aiCohost.enabled),
            nombre: config.aiCohost?.nombre || '',
            personalidad: config.aiCohost?.personalidad || '',
            comando: config.aiCohost?.comando || '!guia',
            proveedores: {
                groq:       { modelo: config.aiCohost?.proveedores?.groq?.modelo || 'openai/gpt-oss-20b', apiKey: config.aiCohost?.proveedores?.groq?.apiKey ? '***' : '' },
                cerebras:   { modelo: config.aiCohost?.proveedores?.cerebras?.modelo || 'llama3.1-70b', apiKey: config.aiCohost?.proveedores?.cerebras?.apiKey ? '***' : '' },
                openrouter: { modelo: config.aiCohost?.proveedores?.openrouter?.modelo || 'meta-llama/llama-3.1-70b-instruct:free', apiKey: config.aiCohost?.proveedores?.openrouter?.apiKey ? '***' : '' }
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

        // 🤖 AI Co-Host — preservar keys si llegan enmascaradas
        if (newConfig.aiCohost && typeof newConfig.aiCohost === 'object') {
            const provs = newConfig.aiCohost.proveedores || {};
            for (const pid of ['groq', 'cerebras', 'openrouter']) {
                const actual = provs[pid] || {};
                const previo = (config.aiCohost?.proveedores?.[pid] || {});
                if (!actual.apiKey || actual.apiKey === '***') {
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

        if (typeof newConfig.CRYSTAL_STYLE !== 'string' || !['jar', 'bar'].includes(newConfig.CRYSTAL_STYLE)) {
            newConfig.CRYSTAL_STYLE = config.CRYSTAL_STYLE || 'jar';
        }

                // 🟢 KICK — preservar cookies al guardar config
        if (newConfig.kick && typeof newConfig.kick === 'object') {
            const prev = config.kick || {};
            if (!newConfig.kick.cookies) {
                newConfig.kick.cookies = prev.cookies || '';
            }
            if (!newConfig.kick.sessionToken) {
                newConfig.kick.sessionToken = prev.sessionToken || '';
            }
            if (!newConfig.kick.username) {
                newConfig.kick.username = prev.username || '';
            }
            if (typeof newConfig.kick.connected !== 'boolean') {
                newConfig.kick.connected = !!prev.connected;
            }
            if (typeof newConfig.kick.lastCheck !== 'number') {
                newConfig.kick.lastCheck = Number(prev.lastCheck) || 0;
            }
        } else {
            newConfig.kick = config.kick || {
                cookies: '',
                sessionToken: '',
                username: '',
                connected: false,
                lastCheck: 0
            };
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

        // 🤖 Recargar pool de IA con la nueva config
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
// ─── Páginas nuevas (faltaban) ───
app.get('/valconfig',          (req, res) => res.sendFile(path.join(publicDir, 'valconfig.html')));
app.get('/deck',               (req, res) => res.sendFile(path.join(publicDir, 'deck.html')));
app.get('/gemini-live.html',   (req, res) => res.sendFile(path.join(publicDir, 'gemini-live.html')));
app.get('/gemini-audio.html',  (req, res) => res.sendFile(path.join(publicDir, 'gemini-audio.html')));
app.get('/gemini-overlay.html',(req, res) => res.sendFile(path.join(publicDir, 'gemini-overlay.html')));
app.get('/hype-train',         (req, res) => res.sendFile(path.join(publicDir, 'hype-train.html')));
app.get('/pride',              (req, res) => res.sendFile(path.join(publicDir, 'pride.html')));
app.get('/stream-timer.html',  (req, res) => res.sendFile(path.join(publicDir, 'stream-timer.html')));
app.get('/overlay-custom',     (req, res) => res.sendFile(path.join(publicDir, 'overlay-custom.html')));

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
    const { action, username, reason, seconds, channel, platform } = command;

    // 🟢 Si es Kick → usar endpoints internos de Kick
    if (platform === 'kick') {
        return executeModCommandKick(command);
    }

    // 🔴 Si no → flujo Twitch (como antes)
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
// 🛡️ KICK — Ejecutor de comandos de moderación
// ================================================================
async function executeModCommandKick(command) {
    const { action, username, reason, seconds } = command;

    const user = kickCookies.username || config.KICK_USERNAME || getKickUsers()[0] || '';
    if (!user) {
        io.emit('mod-command-result', { success: false, message: '❌ Kick: sin username configurado' });
        return;
    }

    if (!username) {
        io.emit('mod-command-result', { success: false, message: '❌ Kick: falta username' });
        return;
    }

    try {
        if (action === 'ban') {
            console.log(`🛡️ [KICK-MOD] BAN permanente → @${username}`);
            const r = await kickRequest(`https://kick.com/api/v2/channels/${user}/bans`, {
                method: 'POST',
                body: { banned_username: username, permanent: true, reason: reason || 'Baneado' }
            });
            if (r.status >= 200 && r.status < 300) {
                io.emit('mod-command-result', { success: true, message: `✅ Kick: Baneado ${username}` });
                io.emit('kick-mod-success', { action: 'ban', username });
            } else {
                io.emit('mod-command-result', { success: false, message: `❌ Kick: ${r.status} ${r.data?.message || ''}` });
            }
            return;
        }

        if (action === 'timeout') {
            const minutos = Math.max(1, Math.round((seconds || 600) / 60));
            console.log(`🛡️ [KICK-MOD] TIMEOUT ${minutos}min → @${username}`);
            const r = await kickRequest(`https://kick.com/api/v2/channels/${user}/bans`, {
                method: 'POST',
                body: { banned_username: username, permanent: false, duration: minutos, reason: reason || 'Timeout' }
            });
            if (r.status >= 200 && r.status < 300) {
                io.emit('mod-command-result', { success: true, message: `✅ Kick: Timeout ${username} (${minutos}min)` });
                io.emit('kick-mod-success', { action: 'timeout', username, duration: minutos });
            } else {
                io.emit('mod-command-result', { success: false, message: `❌ Kick: ${r.status} ${r.data?.message || ''}` });
            }
            return;
        }

        if (action === 'unban') {
            console.log(`🛡️ [KICK-MOD] UNBAN → @${username}`);
            const r = await kickRequest(`https://kick.com/api/v2/channels/${user}/bans/${encodeURIComponent(username)}`, {
                method: 'DELETE'
            });
            if (r.status >= 200 && r.status < 300) {
                io.emit('mod-command-result', { success: true, message: `✅ Kick: Desbaneado ${username}` });
                io.emit('kick-mod-success', { action: 'unban', username });
            } else {
                io.emit('mod-command-result', { success: false, message: `❌ Kick: ${r.status} ${r.data?.message || ''}` });
            }
            return;
        }

        if (action === 'warn') {
            // Kick no tiene warn nativo → lo simulamos con log
            console.log(`⚠️ [KICK-MOD] WARN no soportado en Kick (simulado) → @${username}`);
            io.emit('mod-command-result', { success: false, message: `⚠️ Kick no tiene "warn". Usá timeout o ban.` });
            return;
        }

        if (action === 'delete') {
            const chatroomId = command.chatroomId;
            const messageId = command.messageId;
            if (!chatroomId || !messageId) {
                io.emit('mod-command-result', { success: false, message: '❌ Kick: faltan chatroomId o messageId' });
                return;
            }
            console.log(`🗑️ [KICK-MOD] DELETE ${messageId}`);
            const r = await kickRequest(`https://kick.com/api/v2/chatrooms/${chatroomId}/messages/${messageId}`, {
                method: 'DELETE'
            });
            if (r.status >= 200 && r.status < 300) {
                io.emit('mod-command-result', { success: true, message: `✅ Kick: Mensaje borrado` });
                io.emit('kick-mod-success', { action: 'delete', messageId });
            } else {
                io.emit('mod-command-result', { success: false, message: `❌ Kick: ${r.status}` });
            }
            return;
        }

        io.emit('mod-command-result', { success: false, message: `❌ Kick: acción desconocida "${action}"` });
    } catch (e) {
        console.error('❌ [KICK-MOD] Error:', e.message);
        io.emit('mod-command-result', { success: false, message: `❌ Kick: ${e.message}` });
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
            try { aiCohost.agregarAlaMemoria(username, message); } catch (e) {}
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
// 🟢 KICK API INTERNA — Cookies + Bearer (NO OAuth)
// ================================================================

// --- Estado en memoria ---
let kickCookies = {
    raw: '',
    sessionToken: '',
    username: '',
    connected: false,
    lastCheck: 0
};

function cargarKickCookies() {
    try {
        const k = config.kick || {};
        kickCookies.raw = String(k.cookies || '');
        kickCookies.sessionToken = String(k.sessionToken || '');
        kickCookies.username = String(k.username || config.KICK_USERNAME || '');
        kickCookies.connected = !!k.connected;
        kickCookies.lastCheck = Number(k.lastCheck) || 0;
        if (kickCookies.raw || kickCookies.sessionToken) {
            console.log(`🍪 [KICK] Cookies cargadas para: ${kickCookies.username || '(sin user)'}`);
        } else {
            console.log('🍪 [KICK] Sin cookies configuradas todavía');
        }
    } catch (e) {
        console.error('❌ [KICK] Error cargando cookies:', e.message);
    }
}

function guardarKickCookies() {
    try {
        if (!config.kick || typeof config.kick !== 'object') config.kick = {};
        config.kick.cookies = kickCookies.raw;
        config.kick.sessionToken = kickCookies.sessionToken;
        config.kick.username = kickCookies.username;
        config.kick.connected = kickCookies.connected;
        config.kick.lastCheck = kickCookies.lastCheck;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log('💾 [KICK] Cookies guardadas en config.json');
    } catch (e) {
        console.error('❌ [KICK] Error guardando cookies:', e.message);
    }
}

function extraerSessionToken(cookieString) {
    if (!cookieString) return '';
    const match = String(cookieString).match(/(?:^|;\s*)session_token=([^;]+)/);
    if (!match) return '';
    return decodeURIComponent(match[1]);
}

function construirCookieHeader() {
    if (kickCookies.raw) return kickCookies.raw;
    if (kickCookies.sessionToken) {
        return `session_token=${encodeURIComponent(kickCookies.sessionToken)}`;
    }
    return '';
}

function actualizarCookiesDesdeRespuesta(setCookieHeaders) {
    if (!setCookieHeaders || !Array.isArray(setCookieHeaders)) return;
    let cambio = false;
    const mapa = new Map();

    if (kickCookies.raw) {
        for (const parte of kickCookies.raw.split(';')) {
            const [k, ...v] = parte.trim().split('=');
            if (k) mapa.set(k, v.join('='));
        }
    }

    for (const sc of setCookieHeaders) {
        const primera = sc.split(';')[0];
        const [k, ...v] = primera.trim().split('=');
        if (k && v.length) {
            mapa.set(k, v.join('='));
            cambio = true;
            if (k === 'session_token') {
                kickCookies.sessionToken = decodeURIComponent(v.join('='));
            }
        }
    }

    if (cambio) {
        kickCookies.raw = Array.from(mapa.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
        console.log('🔄 [KICK] Cookies renovadas desde Set-Cookie');
        guardarKickCookies();
    }
}

async function kickRequest(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();

    const headers = {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'x-app-platform': 'web',
        'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        ...(options.headers || {})
    };

    const cookieHeader = construirCookieHeader();
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    if (kickCookies.sessionToken) {
        headers['Authorization'] = `Bearer ${kickCookies.sessionToken}`;
    }

    // 🌐 Origin/Referer según el host del endpoint
    if (url.includes('dashboard.kick.com')) {
        headers['Origin'] = 'https://dashboard.kick.com';
        headers['Referer'] = 'https://dashboard.kick.com/';
    } else if (url.includes('web.kick.com')) {
        headers['Origin'] = 'https://kick.com';
        headers['Referer'] = 'https://kick.com/';
    } else {
        headers['Origin'] = 'https://kick.com';
        headers['Referer'] = 'https://kick.com/';
    }

    // 📦 Content-Type si mandamos body
    if (options.body !== undefined && options.body !== null) {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const response = await axios({
        url,
        method,
        headers,
        data: options.body || undefined,
        validateStatus: () => true,
        maxRedirects: 5,
        timeout: 20000
    });

    const setCookie = response.headers['set-cookie'];
    if (setCookie) actualizarCookiesDesdeRespuesta(setCookie);

    return response;
}

// ================================================================
// 🟢 CACHÉ DE AVATARES DE KICK (con fallback a la API)
// ================================================================
const kickAvatarCache = new Map();

async function getKickUserAvatar(slugOrUsername) {
    if (!slugOrUsername) return null;
    const key = String(slugOrUsername).toLowerCase().trim();
    if (kickAvatarCache.has(key)) {
        return kickAvatarCache.get(key);
    }

    // Intento 1: canal de Kick (funciona para streamers registrados)
    try {
        const r = await kickRequest(`https://kick.com/api/v2/channels/${encodeURIComponent(key)}`);
        if (r.status === 200) {
            const pic = r.data?.user?.profile_pic
                || r.data?.user?.profile_picture
                || r.data?.profile_pic
                || null;
            if (pic) {
                kickAvatarCache.set(key, pic);
                return pic;
            }
        }
    } catch (e) {}

    // Fallback: DiceBear (dibujito único por username, consistente)
    const dicebear = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(key)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
    kickAvatarCache.set(key, dicebear);
    return dicebear;
}

// ================================================================
// 🟢 BÚSQUEDA DE CATEGORÍAS KICK (subcategories + cache local)
// ================================================================
let kickSubcatCache = {
    lista: [],
    cargadaEn: 0,
    cargando: false
};

const KICK_SUBCAT_TTL = 12 * 60 * 60 * 1000; // 12 horas
const KICK_SUBCAT_MAX_PAGES = 50;            // ~500 categorías top

async function cargarSubcategoriasKick() {
    if (kickSubcatCache.cargando) return;
    if (kickSubcatCache.lista.length > 0 && (Date.now() - kickSubcatCache.cargadaEn) < KICK_SUBCAT_TTL) {
        return;
    }

    kickSubcatCache.cargando = true;
    console.log('🔄 [KICK] Cargando subcategorías top...');

    const todas = new Map();

    try {
        for (let page = 1; page <= KICK_SUBCAT_MAX_PAGES; page++) {
            const r = await kickRequest(`https://kick.com/api/v1/subcategories?page=${page}`);
            if (r.status !== 200) {
                console.warn(`⚠️ [KICK] Subcat pág ${page} respondió ${r.status}`);
                break;
            }

            const items = r.data?.data || [];
            if (!Array.isArray(items) || items.length === 0) {
                console.log(`✅ [KICK] Fin de subcategorías en página ${page}`);
                break;
            }

            for (const cat of items) {
                if (cat && cat.id && cat.name) {
                    todas.set(cat.id, {
                        id: cat.id,
                        name: cat.name,
                        slug: cat.slug || '',
                        viewers: cat.viewers || 0
                    });
                }
            }

            await new Promise(res => setTimeout(res, 150));
        }

        kickSubcatCache.lista = Array.from(todas.values());
        kickSubcatCache.cargadaEn = Date.now();
        console.log(`✅ [KICK] Subcategorías cargadas: ${kickSubcatCache.lista.length}`);

    } catch (e) {
        console.error('❌ [KICK] Error cargando subcategorías:', e.message);
    } finally {
        kickSubcatCache.cargando = false;
    }
}

app.get('/api/kick/categories', async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();

        if (kickSubcatCache.lista.length === 0) {
            await cargarSubcategoriasKick();
        }

        // Sin query → primeras 30 (ya vienen ordenadas por viewers)
        if (!q) {
            return res.json({
                ok: true,
                results: kickSubcatCache.lista.slice(0, 30)
            });
        }

        // Filtrar localmente
        const qNorm = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const filtradas = kickSubcatCache.lista.filter(cat => {
            const nombre = String(cat.name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
            return nombre.includes(qNorm);
        });

        // Ordenar: primero las que empiezan con la query, y entre esas, por viewers
        filtradas.sort((a, b) => {
            const aName = a.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
            const bName = b.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
            const aStart = aName.startsWith(qNorm) ? 0 : 1;
            const bStart = bName.startsWith(qNorm) ? 0 : 1;
            if (aStart !== bStart) return aStart - bStart;
            return (b.viewers || 0) - (a.viewers || 0);
        });

        res.json({ ok: true, results: filtradas.slice(0, 30) });

    } catch (e) {
        console.error('❌ [KICK] Error categorías:', e.message);
        res.json({ ok: false, error: e.message, results: [] });
    }
});


// ================================================================
// 🟢 ENDPOINTS KICK
// ================================================================

app.post('/api/kick/set-cookies', (req, res) => {
    try {
        const { cookies, sessionToken, username } = req.body || {};
        if (!cookies && !sessionToken) {
            return res.status(400).json({ ok: false, error: 'Falta cookies o sessionToken' });
        }

        kickCookies.raw = String(cookies || '');
        kickCookies.sessionToken = String(sessionToken || extraerSessionToken(kickCookies.raw) || '');
        kickCookies.username = String(username || kickCookies.username || config.KICK_USERNAME || '').replace(/^@/, '');
        kickCookies.connected = true;
        kickCookies.lastCheck = Date.now();

        guardarKickCookies();
        console.log(`✅ [KICK] Cookies guardadas para: ${kickCookies.username || '(sin user)'}`);
        res.json({ ok: true, username: kickCookies.username });
    } catch (e) {
        console.error('❌ [KICK] Error set-cookies:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/kick/status', async (req, res) => {
    try {
        if (!kickCookies.sessionToken && !kickCookies.raw) {
            return res.json({ ok: true, connected: false, reason: 'Sin cookies configuradas' });
        }
        const user = kickCookies.username || config.KICK_USERNAME || getKickUsers()[0] || '';
        if (!user) {
            return res.json({ ok: true, connected: false, reason: 'Sin username de Kick' });
        }

        const r = await kickRequest(`https://kick.com/api/v2/channels/${user}/stream-info`);

        if (r.status === 200) {
            kickCookies.connected = true;
            kickCookies.lastCheck = Date.now();
            guardarKickCookies();
            return res.json({
                ok: true,
                connected: true,
                username: user,
                lastCheck: kickCookies.lastCheck,
                preview: {
                    title: r.data?.stream_title || '',
                    category: r.data?.category?.name || ''
                }
            });
        }

        if (r.status === 401 || r.status === 403) {
            kickCookies.connected = false;
            guardarKickCookies();
            return res.json({ ok: true, connected: false, status: r.status, reason: 'Cookies expiradas o inválidas' });
        }

        res.json({ ok: true, connected: false, status: r.status, reason: 'Respuesta inesperada de Kick' });
    } catch (e) {
        console.error('❌ [KICK] Error status:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/kick/stream-info', async (req, res) => {
    try {
        const user = kickCookies.username || config.KICK_USERNAME || getKickUsers()[0] || '';
        if (!user) return res.status(400).json({ ok: false, error: 'Sin username de Kick' });

        const r = await kickRequest(`https://kick.com/api/v2/channels/${user}/stream-info`);
        if (r.status !== 200) {
            return res.status(r.status).json({ ok: false, error: 'Kick respondió ' + r.status, data: r.data });
        }

        res.json({
            ok: true,
            title: r.data?.stream_title || '',
            categoryId: r.data?.category?.id || null,
            categoryName: r.data?.category?.name || '',
            categorySlug: r.data?.category?.slug || '',
            isLive: r.data?.is_live,
            viewerCount: r.data?.viewer_count
        });
    } catch (e) {
        console.error('❌ [KICK] Error stream-info GET:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/kick/stream-info', async (req, res) => {
    try {
        const user = kickCookies.username || config.KICK_USERNAME || getKickUsers()[0] || '';
        if (!user) return res.status(400).json({ ok: false, error: 'Sin username de Kick' });

        const { title, categoryId } = req.body || {};
        const payload = {};
        if (typeof title === 'string' && title.trim()) payload.stream_title = title.trim();
        if (categoryId !== undefined && categoryId !== null && categoryId !== '') {
            payload.category_id = Number(categoryId);
        }
        if (Object.keys(payload).length === 0) {
            return res.status(400).json({ ok: false, error: 'Nada que actualizar' });
        }

        const r = await kickRequest(`https://kick.com/api/v2/channels/${user}/stream-info`, {
            method: 'PATCH',
            body: payload
        });

        if (r.status >= 200 && r.status < 300) {
            console.log('✅ [KICK] Stream info actualizado:', payload);
            io.emit('kick-stream-updated', payload);
            return res.json({ ok: true, data: r.data });
        }

        console.error('❌ [KICK] PATCH falló:', r.status, r.data);
        res.status(r.status).json({ ok: false, error: 'Kick respondió ' + r.status, data: r.data });
    } catch (e) {
        console.error('❌ [KICK] Error stream-info POST:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ================================================================
// 🎬 KICK CLIPS — Crear + Listar
// ================================================================

// POST /api/kick/create-clip
// Body: { title, trim_start (seg), trim_duration (seg) }
app.post('/api/kick/create-clip', async (req, res) => {
    try {
        const { title, trim_start, trim_duration } = req.body || {};

        if (!title || typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({ ok: false, error: 'Falta title' });
        }
        const start = Number(trim_start);
        const dur = Number(trim_duration);
        if (!Number.isFinite(start) || start < 0) {
            return res.status(400).json({ ok: false, error: 'trim_start inválido' });
        }
        if (!Number.isFinite(dur) || dur < 1 || dur > 180) {
            return res.status(400).json({ ok: false, error: 'trim_duration debe estar entre 1 y 180' });
        }

        console.log(`🎬 [KICK CLIP] Creando: "${title}" start=${start}s dur=${dur}s`);

        const createRes = await kickRequest('https://web.kick.com/api/v1/clips', {
            method: 'POST',
            body: JSON.stringify({
                title: title.trim(),
                trim_duration: dur,
                trim_start: start
            })
        });

        console.log(`🎬 [KICK CLIP] Crear → ${createRes.status}`);
        if (createRes.status !== 201 && createRes.status !== 200) {
            console.error('❌ [KICK CLIP] Fallo al crear:', JSON.stringify(createRes.data));
            return res.status(createRes.status).json({
                ok: false,
                step: 'create',
                status: createRes.status,
                kick: createRes.data
            });
        }

        const clip = createRes.data?.data;
        if (!clip || !clip.id || !clip.video?.id) {
            return res.status(500).json({
                ok: false,
                step: 'create-missing-fields',
                kick: createRes.data
            });
        }

        const clipId = clip.id;
        const videoId = clip.video.id;
        console.log(`🎬 [KICK CLIP] Clip creado: ${clipId} | video=${videoId}`);

        const finalRes = await kickRequest(
            `https://web.kick.com/api/v1/clips/${clipId}/finalize`,
            {
                method: 'POST',
                body: JSON.stringify({ video_id: videoId })
            }
        );

        console.log(`🎬 [KICK CLIP] Finalizar → ${finalRes.status}`);
        if (finalRes.status !== 200 && finalRes.status !== 201) {
            console.error('❌ [KICK CLIP] Fallo al finalizar:', JSON.stringify(finalRes.data));
            return res.json({
                ok: true,
                warning: 'Clip creado pero finalize falló',
                clip: {
                    id: clipId,
                    title: clip.title,
                    duration: clip.duration,
                    thumbnail: clip.thumbnail_url,
                    playback: clip.playback_url,
                    preview: null
                }
            });
        }

        const finalData = finalRes.data?.data || {};
        const user = kickCookies.username || config.KICK_USERNAME || getKickUsers()[0] || '';

        const result = {
            ok: true,
            clip: {
                id: clipId,
                title: clip.title,
                duration: clip.duration,
                thumbnail: clip.thumbnail_url,
                playback: clip.playback_url,
                preview: finalData.preview_url || null,
                source_duration: finalData.source_duration || null,
                url: user ? `https://kick.com/${user}?clip=${clipId}` : null,
                createdAt: Date.now()
            }
        };

        console.log(`✅ [KICK CLIP] OK → ${result.clip.url}`);
        io.emit('kick-clip-created', result.clip);
        res.json(result);

    } catch (e) {
        console.error('❌ [KICK CLIP] Error:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /api/kick/clips — lista de clips del canal
app.get('/api/kick/clips', async (req, res) => {
    try {
        const user = kickCookies.username || config.KICK_USERNAME || getKickUsers()[0] || '';
        if (!user) return res.status(400).json({ ok: false, error: 'Sin username de Kick' });

        const r = await kickRequest(`https://kick.com/api/v2/channels/${user}/clips`);

        if (r.status !== 200) {
            return res.status(r.status).json({
                ok: false,
                status: r.status,
                kick: r.data
            });
        }

        const clips = Array.isArray(r.data?.clips) ? r.data.clips : (Array.isArray(r.data) ? r.data : []);

        res.json({
            ok: true,
            clips: clips.map(c => ({
                id: c.id,
                title: c.title,
                duration: c.duration,
                views: c.views_count || c.views || 0,
                thumbnail: c.thumbnail_url || c.thumbnail || null,
                playback: c.playback_url || null,
                createdAt: c.created_at || c.createdAt || null,
                creator: c.creator?.username || c.creator?.slug || null
            }))
        });

    } catch (e) {
        console.error('❌ [KICK CLIPS] Error listando:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});


// ================================================================
// 🛡️ KICK — MODERACIÓN (Ban, Timeout, Unban, Delete Message)
// Endpoints verificados empíricamente el 2026-09-21
// ================================================================

// POST /api/kick/mod/ban
// Body: { username, permanent, duration, reason }
app.post('/api/kick/mod/ban', async (req, res) => {
    try {
        const user = kickCookies.username || config.KICK_USERNAME || getKickUsers()[0] || '';
        if (!user) return res.status(400).json({ ok: false, error: 'Sin username de Kick' });

        const {
            username,
            permanent = false,
            duration = 5,
            reason = ''
        } = req.body || {};

        if (!username) {
            return res.status(400).json({ ok: false, error: 'Falta username' });
        }

        const body = {
            banned_username: String(username).replace(/^@/, '').trim(),
            permanent: !!permanent
        };

        if (!permanent) {
            body.duration = Number(duration);
            if (!Number.isFinite(body.duration) || body.duration <= 0) {
                return res.status(400).json({ ok: false, error: 'duration inválida (en minutos)' });
            }
        }

        if (reason && String(reason).trim()) {
            body.reason = String(reason).trim();
        }

        console.log(`🛡️ [KICK-MOD] ${permanent ? 'BAN PERM' : `TIMEOUT ${body.duration}min`} → @${body.banned_username}`);

        const r = await kickRequest(`https://kick.com/api/v2/channels/${user}/bans`, {
            method: 'POST',
            body
        });

        if (r.status >= 200 && r.status < 300) {
            console.log('✅ [KICK-MOD] Ban/timeout OK:', r.data);
            io.emit('kick-mod-success', { action: 'ban', data: r.data });
            return res.json({ ok: true, data: r.data?.data || r.data });
        }

        console.error('❌ [KICK-MOD] Error ban:', r.status, r.data);
        res.status(r.status).json({ ok: false, error: 'Kick respondió ' + r.status, kick: r.data });
    } catch (e) {
        console.error('❌ [KICK-MOD] Error en ban:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// DELETE /api/kick/mod/unban/:username
app.delete('/api/kick/mod/unban/:username', async (req, res) => {
    try {
        const user = kickCookies.username || config.KICK_USERNAME || getKickUsers()[0] || '';
        if (!user) return res.status(400).json({ ok: false, error: 'Sin username de Kick' });

        const target = String(req.params.username || '').replace(/^@/, '').trim();
        if (!target) return res.status(400).json({ ok: false, error: 'Falta username' });

        console.log(`🛡️ [KICK-MOD] UNBAN → @${target}`);

        const r = await kickRequest(`https://kick.com/api/v2/channels/${user}/bans/${encodeURIComponent(target)}`, {
            method: 'DELETE'
        });

        if (r.status >= 200 && r.status < 300) {
            console.log('✅ [KICK-MOD] Unban OK:', r.data);
            io.emit('kick-mod-success', { action: 'unban', username: target, data: r.data });
            return res.json({ ok: true, data: r.data });
        }

        console.error('❌ [KICK-MOD] Error unban:', r.status, r.data);
        res.status(r.status).json({ ok: false, error: 'Kick respondió ' + r.status, kick: r.data });
    } catch (e) {
        console.error('❌ [KICK-MOD] Error en unban:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /api/kick/mod/bans
app.get('/api/kick/mod/bans', async (req, res) => {
    try {
        const user = kickCookies.username || config.KICK_USERNAME || getKickUsers()[0] || '';
        if (!user) return res.status(400).json({ ok: false, error: 'Sin username de Kick' });

        const r = await kickRequest(`https://kick.com/api/v2/channels/${user}/bans`);

        if (r.status !== 200) {
            return res.status(r.status).json({ ok: false, error: 'Kick respondió ' + r.status, kick: r.data });
        }

        const bans = Array.isArray(r.data) ? r.data : [];
        res.json({
            ok: true,
            bans: bans.map(b => ({
                userId: b.banned_user?.id || null,
                username: b.banned_user?.username || null,
                bannedBy: b.banned_by?.username || null,
                reason: b.ban?.reason || '',
                permanent: !!b.ban?.permanent,
                bannedAt: b.ban?.banned_at || null,
                expiresAt: b.ban?.expires_at || null
            }))
        });
    } catch (e) {
        console.error('❌ [KICK-MOD] Error listando bans:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// DELETE /api/kick/mod/message/:messageId
// Body opcional: { chatroomId }
app.delete('/api/kick/mod/message/:messageId', async (req, res) => {
    try {
        const messageId = String(req.params.messageId || '').trim();
        if (!messageId) return res.status(400).json({ ok: false, error: 'Falta messageId' });

        const chatroomId = req.body?.chatroomId || req.query.chatroomId || null;
        if (!chatroomId) {
            return res.status(400).json({ ok: false, error: 'Falta chatroomId' });
        }

        console.log(`🛡️ [KICK-MOD] DELETE message ${messageId} en chatroom ${chatroomId}`);

        const r = await kickRequest(`https://kick.com/api/v2/chatrooms/${chatroomId}/messages/${messageId}`, {
            method: 'DELETE'
        });

        if (r.status >= 200 && r.status < 300) {
            console.log('✅ [KICK-MOD] Mensaje borrado');
            io.emit('kick-mod-success', { action: 'delete-message', messageId });
            return res.json({ ok: true, data: r.data });
        }

        console.error('❌ [KICK-MOD] Error delete:', r.status, r.data);
        res.status(r.status).json({ ok: false, error: 'Kick respondió ' + r.status, kick: r.data });
    } catch (e) {
        console.error('❌ [KICK-MOD] Error en delete message:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});


// --- Cargar cookies al arrancar ---
cargarKickCookies();

// --- Precargar subcategorías (async, no bloquea) ---
setTimeout(async () => {
    try {
        await cargarSubcategoriasKick();
    } catch (e) {
        console.error('❌ [KICK] Error precargando subcategorías:', e.message);
    }
}, 2000);


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

                kickWs.on('message', async (raw) => {
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
                    const avatarKick = payload.sender.profile_pic
                        || await getKickUserAvatar(payload.sender.slug || payload.sender.username)
                        || KICK_DEFAULT_AVATAR;

                    broadcastMessage({
                        platform: 'kick',
                        channel: kickUser,
                        username: kickUsername,
                        message: payload.content,
                        avatar: avatarKick,
                        messageId: payload.id || null,
                        userId: payload.sender.id || null,
                        senderSlug: payload.sender.slug || null,
                        chatroomId: chatroomId || null
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
// 🔧 RUTAS AutoStream + TikTok Views + OBS Info
// ================================================================
// 🔍 DIAGNÓSTICO — variables de entorno críticas
console.log('=== DIAGNÓSTICO AUTOSTREAM ===');
console.log('APPDATA:', process.env.APPDATA);
console.log('USERPROFILE:', process.env.USERPROFILE);
console.log('__dirname:', __dirname);
console.log('node version:', process.version);
console.log('===============================');

let streamlabsToken = null;
let tiktokStream = null;
let tiktokProxy = null;

try {
    streamlabsToken = require('./streamlabs-token');
    console.log('✅ [AutoStream] streamlabs-token.js cargado OK');
} catch (e) {
    console.error('❌ [AutoStream] streamlabs-token.js FALLÓ:', e.message);
    console.error(e.stack);
}

try {
    tiktokStream = require('./tiktok-stream');
    console.log('✅ [AutoStream] tiktok-stream.js cargado OK');
} catch (e) {
    console.error('❌ [AutoStream] tiktok-stream.js FALLÓ:', e.message);
    console.error(e.stack);
}

try {
    tiktokProxy = require('./tiktok-proxy');
    console.log('✅ [AutoStream] tiktok-proxy.js cargado OK');
} catch (e) {
    console.error('❌ [AutoStream] tiktok-proxy.js FALLÓ:', e.message);
    console.error(e.stack);
}
console.log('===============================');

// ─── AutoStream: cuentas de Streamlabs Desktop ───
app.get('/api/tiktok/streamlabs-accounts', async (req, res) => {
    try {
        if (!streamlabsToken) {
            return res.status(500).json({
                ok: false,
                error: 'streamlabs-token.js no cargó. Revisá la consola del server.',
                accounts: []
            });
        }

        console.log('📺 [AutoStream] Leyendo tokens de Streamlabs...');
        console.log('   APPDATA actual:', process.env.APPDATA);

        let tokens = [];
        try {
            tokens = streamlabsToken.readStreamlabsTokens();
        } catch (e) {
            console.error('❌ [AutoStream] readStreamlabsTokens() tiró excepción:', e.message);
            return res.json({ ok: false, error: 'Error leyendo tokens: ' + e.message, accounts: [] });
        }

        console.log(`📺 [AutoStream] Tokens encontrados: ${tokens.length}`);

        if (tokens.length === 0) {
            return res.json({ ok: true, accounts: [] });
        }

        const cuentas = [];
        for (const t of tokens) {
            let info = null;
            try {
                if (tiktokStream) {
                    info = await tiktokStream.getAccountInfo(t.apiToken);
                }
            } catch (e) {
                console.warn(`⚠️ [AutoStream] info falló para ${t.username}:`, e.message);
            }

            const username = (info && info.user && info.user.username) || t.username;
            const nickname = (info && info.user && info.user.nickname) || username;
            const canBeLive = !!(info && info.can_be_live);
            const invalid = !info;

            cuentas.push({
                apiToken: t.apiToken,
                username,
                nickname,
                canBeLive,
                invalid,
                error: invalid ? 'Token inválido o expirado' : (canBeLive ? null : 'La cuenta no puede emitir')
            });
        }

        console.log(`📺 [AutoStream] Cuentas válidas: ${cuentas.filter(c => c.canBeLive && !c.invalid).length}`);
        res.json({ ok: true, accounts: cuentas });
    } catch (e) {
        console.error('❌ [/api/tiktok/streamlabs-accounts]', e.message);
        res.json({ ok: false, error: e.message, accounts: [] });
    }
});

// ─── AutoStream: estado del proxy RTMP ───
app.get('/api/tiktok/proxy/status', (req, res) => {
    try {
        if (!tiktokProxy) {
            return res.json({ ok: true, state: { status: 'idle', username: null, lastReconnect: null, error: 'tiktok-proxy no cargado' } });
        }
        const state = tiktokProxy.getState();
        res.json({ ok: true, state });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── AutoStream: iniciar proxy ───
app.post('/api/tiktok/proxy/start', async (req, res) => {
    try {
        if (!tiktokProxy) {
            return res.status(500).json({ ok: false, error: 'tiktok-proxy.js no cargó' });
        }
        const { token, title } = req.body || {};
        if (!token) return res.status(400).json({ ok: false, error: 'Falta token' });

        console.log(`▶️ [AutoStream] START solicitado: title="${title || ''}"`);
        const r = await tiktokProxy.start(token, title || 'TogiPanel Stream');
        res.json(r);
    } catch (e) {
        console.error('❌ [/api/tiktok/proxy/start]', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── AutoStream: detener proxy ───
app.post('/api/tiktok/proxy/stop', async (req, res) => {
    try {
        if (!tiktokProxy) {
            return res.json({ ok: true });
        }
        console.log('⏹️ [AutoStream] STOP solicitado');
        const r = await tiktokProxy.stop();
        res.json(r);
    } catch (e) {
        console.error('❌ [/api/tiktok/proxy/stop]', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── OBS Info (RTMP LAN + key + QR) ───
app.get('/api/obs-info', (req, res) => {
    try {
        const nets = os.networkInterfaces();
        let lanIp = '127.0.0.1';
        for (const name of Object.keys(nets)) {
            for (const net of nets[name] || []) {
                if (net.family === 'IPv4' && !net.internal) {
                    if (/^192\.168\./.test(net.address) ||
                        /^10\./.test(net.address) ||
                        /^172\.(1[6-9]|2\d|3[01])\./.test(net.address)) {
                        lanIp = net.address;
                        break;
                    }
                }
            }
        }

        const proxyState = tiktokProxy ? tiktokProxy.getState() : { status: 'idle' };

        res.json({
            ok: true,
            lanIp,
            lanUrl: `rtmp://${lanIp}:1935/live`,
            localUrl: 'rtmp://localhost:1935/live',
            key: 'togipanel',
            status: proxyState.status === 'streaming' ? 'online' : 'offline',
            statusLabel: proxyState.status === 'streaming' ? 'Emitiendo' : 'RTMP listo'
        });
    } catch (e) {
        console.error('❌ [/api/obs-info]', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── TikTok Views (multi-cuenta) ───
const TIKTOK_VIEWS_DEFAULT = [
    { id: 'slot1', name: 'Cuenta 1', username: '', url: 'https://livecenter.tiktok.com/live_monitor', partition: 'persist:tiktok-slot-1' },
    { id: 'slot2', name: 'Cuenta 2', username: '', url: 'https://livecenter.tiktok.com/live_monitor', partition: 'persist:tiktok-slot-2' },
    { id: 'slot3', name: 'Cuenta 3', username: '', url: 'https://livecenter.tiktok.com/live_monitor', partition: 'persist:tiktok-slot-3' }
];

app.get('/api/tiktok/views', (req, res) => {
    try {
        const views = (Array.isArray(config.TIKTOK_VIEWS) && config.TIKTOK_VIEWS.length > 0)
            ? config.TIKTOK_VIEWS
            : TIKTOK_VIEWS_DEFAULT;
        const active = config.TIKTOK_ACTIVE_VIEW || views[0].id;
        res.json({ ok: true, views, active });
    } catch (e) {
        res.json({ ok: false, error: e.message, views: TIKTOK_VIEWS_DEFAULT, active: 'slot1' });
    }
});

app.post('/api/tiktok/rename-view', (req, res) => {
    try {
        const { id, name } = req.body || {};
        if (!id || !name) return res.status(400).json({ ok: false, error: 'Faltan id o name' });
        if (!Array.isArray(config.TIKTOK_VIEWS)) config.TIKTOK_VIEWS = [...TIKTOK_VIEWS_DEFAULT];
        const v = config.TIKTOK_VIEWS.find(x => x.id === id);
        if (v) {
            v.name = String(name).slice(0, 40);
            try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); } catch (e) {}
            io.emit('tiktok:view-renamed', { id, name: v.name });
        }
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/tiktok/set-username', (req, res) => {
    try {
        const { id, username } = req.body || {};
        if (!id) return res.status(400).json({ ok: false, error: 'Falta id' });
        if (!Array.isArray(config.TIKTOK_VIEWS)) config.TIKTOK_VIEWS = [...TIKTOK_VIEWS_DEFAULT];
        const v = config.TIKTOK_VIEWS.find(x => x.id === id);
        if (v) {
            v.username = String(username || '').replace(/^@/, '').slice(0, 60);
            try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); } catch (e) {}
            io.emit('tiktok:username-changed', { id, username: v.username });
        }
        res.json({ ok: true, username: v?.username || '' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/tiktok/active-view', (req, res) => {
    try {
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ ok: false, error: 'Falta id' });
        config.TIKTOK_ACTIVE_VIEW = id;
        try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); } catch (e) {}
        io.emit('tiktok:active-view-changed', { id });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Stubs para overlays sin implementar ───
app.get('/api/hype-train/state', (req, res) => {
    res.json({
        ok: true,
        active: false,
        level: 0,
        progress: 0,
        goal: 0,
        expiresAt: null
    });
});

app.get('/api/custom-overlay/info', (req, res) => {
    res.json({
        ok: true,
        overlay: null
    });
});

// ================================================================
// 🏳️ PRIDE — Config de banderas
// ================================================================
const PRIDE_CONFIG_PATH = IS_PACKAGED
    ? path.join(USER_DATA_DIR, 'pride-config.json')
    : path.join(__dirname, 'pride-config.json');

const PRIDE_DEFAULTS = {
    mode: 'rotate',              // 'rotate' | 'fixed' | 'chat'
    fixedId: 'pride',
    rotateMs: 6000,
    folder: 'HD 1080p',
    showName: true,
    showMeaning: true,
    showColors: true,
    soloBandera: false,
    enabled: null
};

function cargarPrideConfig() {
    try {
        if (fs.existsSync(PRIDE_CONFIG_PATH)) {
            const raw = fs.readFileSync(PRIDE_CONFIG_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            return { ...PRIDE_DEFAULTS, ...(parsed || {}) };
        }
    } catch (e) {
        console.error('❌ [PRIDE] Error cargando config:', e.message);
    }
    return { ...PRIDE_DEFAULTS };
}

function guardarPrideConfig(cfg) {
    try {
        fs.writeFileSync(PRIDE_CONFIG_PATH, JSON.stringify(cfg, null, 2));
        return true;
    } catch (e) {
        console.error('❌ [PRIDE] Error guardando config:', e.message);
        return false;
    }
}

// GET → devuelve { ok: true, config: {...} }  (así lo espera overlays.js)
app.get('/api/pride/config', (req, res) => {
    try {
        const cfg = cargarPrideConfig();
        res.json({ ok: true, config: cfg });
    } catch (e) {
        console.error('❌ [PRIDE] Error GET config:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// POST → recibe el objeto plano, guarda y emite pride:config-updated
app.post('/api/pride/config', (req, res) => {
    try {
        const actual = cargarPrideConfig();
        const body = req.body || {};
        const nuevo = { ...actual, ...body };

        // Sanitizar tipos
        if (!['rotate', 'fixed', 'chat'].includes(nuevo.mode)) nuevo.mode = 'rotate';
        if (typeof nuevo.fixedId !== 'string' || !nuevo.fixedId) nuevo.fixedId = 'pride';
        if (typeof nuevo.rotateMs !== 'number' || nuevo.rotateMs < 1000) nuevo.rotateMs = 6000;
        if (typeof nuevo.folder !== 'string' || !nuevo.folder) nuevo.folder = 'HD 1080p';
        nuevo.showName    = nuevo.showName    !== false;
        nuevo.showMeaning = nuevo.showMeaning !== false;
        nuevo.showColors  = nuevo.showColors  !== false;
        nuevo.soloBandera = nuevo.soloBandera === true;
        if (!Array.isArray(nuevo.enabled)) nuevo.enabled = null;

        if (guardarPrideConfig(nuevo)) {
            // ⚠️ DOS PUNTOS → coincide con pride.html
            io.emit('pride:config-updated', nuevo);
            console.log(`🏳️ [PRIDE] Config actualizada → mode=${nuevo.mode} fixedId=${nuevo.fixedId} rotateMs=${nuevo.rotateMs}`);
            res.json({ ok: true, config: nuevo });
        } else {
            res.status(500).json({ ok: false, error: 'No se pudo guardar' });
        }
    } catch (e) {
        console.error('❌ [PRIDE] Error POST config:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// DELETE → resetea a defaults (así lo llama resetearConfigPride en overlays.js)
app.delete('/api/pride/config', (req, res) => {
    try {
        guardarPrideConfig(PRIDE_DEFAULTS);
        io.emit('pride:config-updated', PRIDE_DEFAULTS);
        console.log(`🏳️ [PRIDE] Config reseteada a defaults`);
        res.json({ ok: true, config: PRIDE_DEFAULTS });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ================================================================
// 🔧 PÁGINAS HTML QUE FALTABAN
// ================================================================
app.get('/valconfig',           (req, res) => res.sendFile(path.join(publicDir, 'valconfig.html')));
app.get('/deck',                (req, res) => res.sendFile(path.join(publicDir, 'deck.html')));
app.get('/gemini-live.html',    (req, res) => res.sendFile(path.join(publicDir, 'gemini-live.html')));
app.get('/gemini-audio.html',   (req, res) => res.sendFile(path.join(publicDir, 'gemini-audio.html')));
app.get('/gemini-overlay.html', (req, res) => res.sendFile(path.join(publicDir, 'gemini-overlay.html')));
app.get('/hype-train',          (req, res) => res.sendFile(path.join(publicDir, 'hype-train.html')));
app.get('/pride',               (req, res) => res.sendFile(path.join(publicDir, 'pride.html')));
app.get('/stream-timer.html',   (req, res) => res.sendFile(path.join(publicDir, 'stream-timer.html')));
app.get('/overlay-custom',      (req, res) => res.sendFile(path.join(publicDir, 'overlay-custom.html')));
app.get('/stream-health',       (req, res) => res.sendFile(path.join(publicDir, 'stream-health.html')));

// ================================================================
// 🔧 APIs QUE FALTABAN
// ================================================================

// ─── Stubs de timer-state y last-stream ───
app.get('/api/timer-state', (req, res) => {
    res.json({
        ok: true,
        active: false,
        startedAt: null,
        endsAt: null,
        elapsed: 0,
        remaining: 0,
        running: false
    });
});

app.get('/api/last-stream', (req, res) => {
    res.json({
        ok: true,
        lastStream: null
    });
});

// ─── Valorant Config API ───
try {
    const registerValConfig = require('./valconfig');
    registerValConfig(app);
    console.log('🎮 [VALCONFIG] Rutas montadas OK');
} catch (e) {
    console.error('❌ [VALCONFIG] No se pudo montar:', e.message);
}

// ─── Custom Overlay API ───
try {
    const registerCustomOverlay = require('./custom-overlay');
    registerCustomOverlay(app);
    console.log('🎨 [CUSTOM-OVERLAY] Rutas montadas OK');
} catch (e) {
    console.error('❌ [CUSTOM-OVERLAY] No se pudo montar:', e.message);
}

// ─── Velora API ───
try {
    const registerVelora = require('./velora');
    if (typeof registerVelora === 'function') {
        registerVelora(app, io);
        console.log('📡 [VELORA] Rutas montadas OK');
    } else {
        console.error('❌ [VELORA] velora.js no exporta una función');
    }
} catch (e) {
    console.error('❌ [VELORA] No se pudo montar:', e.message);
}

// ─── Gemini Live API ───
try {
    geminiLive = require('./gemini-live');
    if (geminiLive && typeof geminiLive.init === 'function') {
        geminiLive.init(io, config);
        console.log('🤖 [GEMINI-LIVE] Módulo montado OK');
    } else {
        console.error('❌ [GEMINI-LIVE] gemini-live.js no exporta init()');
    }
} catch (e) {
    console.error('❌ [GEMINI-LIVE] No se pudo montar:', e.message);
}

// ─── Gemini Text API ───
try {
    geminiText = require('./gemini-text');
    if (geminiText && typeof geminiText.init === 'function') {
        geminiText.init(io, config);
        console.log('📚 [GEMINI-TEXT] Módulo montado OK');
    } else {
        console.error('❌ [GEMINI-TEXT] gemini-text.js no exporta init()');
    }
} catch (e) {
    console.error('❌ [GEMINI-TEXT] No se pudo montar:', e.message);
}

// ─── Rutas HTTP de Gemini (las que pide el HTML) ───
app.get('/api/gemini-live/config', (req, res) => {
    try {
        const cfg = geminiLive.cargarConfig();
        const safe = { ...cfg };
        if (Array.isArray(safe.apiKeys) && safe.apiKeys.length > 0) {
            safe.apiKeys = safe.apiKeys.map(() => '***');
        }
        if (safe.apiKey) safe.apiKey = '***';
        res.json({ ok: true, config: safe });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/gemini-live/config', (req, res) => {
    try {
        const cfg = geminiLive.cargarConfig();
        const body = req.body || {};
        if (body.apiKeys && Array.isArray(body.apiKeys)) {
            cfg.apiKeys = body.apiKeys.map(k => String(k || '').trim()).filter(Boolean);
            if (cfg.apiKeys.length > 0) cfg.apiKey = cfg.apiKeys[0];
        } else if (body.apiKey) {
            cfg.apiKey = String(body.apiKey).trim();
            cfg.apiKeys = [cfg.apiKey];
        }
        if (typeof body.voz === 'string') cfg.voz = body.voz;
        if (typeof body.comandoChat === 'string') cfg.comandoChat = body.comandoChat;
        if (typeof body.palabraClave === 'string') cfg.palabraClave = body.palabraClave;
        if (typeof body.pronombre === 'string') cfg.pronombre = body.pronombre;
        if (typeof body.pronombrePersonalizado === 'string') cfg.pronombrePersonalizado = body.pronombrePersonalizado;
        geminiLive.guardarConfig(cfg);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/gemini-live/status', (req, res) => {
    try {
        const est = geminiLive.estado();
        res.json({ ok: true, ...est });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/gemini-text/config', (req, res) => {
    try {
        if (!geminiText) return res.status(500).json({ ok: false, error: 'gemini-text no cargado' });
        const cfg = geminiText.cargarConfig();
        const safe = { ...cfg };
        if (Array.isArray(safe.apiKeys) && safe.apiKeys.length > 0) {
            safe.apiKeys = safe.apiKeys.map(() => '***');
        }
        if (safe.apiKey) safe.apiKey = '***';
        res.json({ ok: true, config: safe });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/gemini-text/config', (req, res) => {
    try {
        if (!geminiText) return res.status(500).json({ ok: false, error: 'gemini-text no cargado' });
        const cfg = geminiText.cargarConfig();
        const body = req.body || {};
        if (body.apiKeys && Array.isArray(body.apiKeys)) {
            cfg.apiKeys = body.apiKeys.map(k => String(k || '').trim()).filter(Boolean);
            if (cfg.apiKeys.length > 0) cfg.apiKey = cfg.apiKeys[0];
        } else if (body.apiKey) {
            cfg.apiKey = String(body.apiKey).trim();
            cfg.apiKeys = [cfg.apiKey];
        }
        if (typeof body.modelo === 'string' && body.modelo.trim()) cfg.modelo = body.modelo.trim();
        if (typeof body.intervaloResumenMs === 'number' && body.intervaloResumenMs >= 60000) {
            cfg.intervaloResumenMs = body.intervaloResumenMs;
        }
        if (typeof body.activo === 'boolean') cfg.activo = body.activo;
        geminiText.guardarConfig(cfg);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/gemini-text/status', (req, res) => {
    try {
        if (!geminiText) return res.status(500).json({ ok: false, error: 'gemini-text no cargado' });
        const est = geminiText.estado();
        res.json({ ok: true, ...est });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/gemini-text/buscar', async (req, res) => {
    try {
        if (!geminiText) return res.status(500).json({ ok: false, error: 'gemini-text no cargado' });
        const { query, contexto } = req.body || {};
        if (!query) return res.status(400).json({ ok: false, error: 'Falta query' });
        const r = await geminiText.buscar(query, contexto);
        res.json(r);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/gemini-text/resumen', async (req, res) => {
    try {
        if (!geminiText) return res.status(500).json({ ok: false, error: 'gemini-text no cargado' });
        const r = await geminiText.generarResumen([], '');
        res.json({ ok: !!r, texto: r || '' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/gemini-text/olvidar-resumenes', (req, res) => {
    try {
        if (!geminiText) return res.status(500).json({ ok: false, error: 'gemini-text no cargado' });
        if (io) io.emit('gemini-text:olvidar-resumenes');
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Deck (StreamDeck web) ───
let deckModule = null;
try {
    deckModule = require('./deck');
    if (deckModule && typeof deckModule.init === 'function') {
        deckModule.init(app, io);
        console.log('🎛️ [DECK] Rutas montadas OK');
    } else {
        console.error('❌ [DECK] deck.js no exporta init()');
        deckModule = null;
    }
} catch (e) {
    console.error('❌ [DECK] No se pudo montar:', e.message);
}

// ─── Stream Health (monitor de salud del stream) ───
try {
    const streamHealth = require('./stream-health');
    if (streamHealth && typeof streamHealth.init === 'function') {
        // Le pasamos a stream-health una función que devuelve el cliente OBS de deck.js
        const getObsClient = (deckModule && typeof deckModule.getObsClient === 'function')
            ? deckModule.getObsClient
            : () => null;
        streamHealth.init(io, getObsClient);
        console.log('📈 [STREAM-HEALTH] Módulo montado OK');
    } else {
        console.error('❌ [STREAM-HEALTH] stream-health.js no exporta init()');
    }
} catch (e) {
    console.error('❌ [STREAM-HEALTH] No se pudo montar:', e.message);
}

// ─── Stream Keys (gestor de claves de transmisión) ───
try {
    const streamKeys = require('./stream-keys');
    if (streamKeys && typeof streamKeys.init === 'function') {
        // Le pasamos el deckModule para que pueda usar sus funciones
        streamKeys.init(app, io, deckModule);
        console.log('🔑 [STREAM-KEYS] Módulo montado OK');
    } else {
        console.error('❌ [STREAM-KEYS] stream-keys.js no exporta init()');
    }
} catch (e) {
    console.error('❌ [STREAM-KEYS] No se pudo montar:', e.message);
}

// ─── Stream Control (iniciar/detener stream en OBS o Aitum) ───
try {
    // Helper: consultar el estado real del stream en OBS (horizontal)
    async function getObsStreamStatus() {
        try {
            if (!deckModule || typeof deckModule.getObsStreamStatus !== 'function') {
                return { ok: false, active: false, error: 'deck.js no disponible' };
            }
            return await deckModule.getObsStreamStatus();
        } catch (e) {
            return { ok: false, active: false, error: e.message };
        }
    }

    // Helper: consultar el estado real del stream en Aitum (vertical)
    async function getAitumStreamStatus() {
        try {
            if (!deckModule || typeof deckModule.aitumGetStatus !== 'function') {
                return { ok: false, active: false, error: 'deck.js no expone aitumGetStatus' };
            }
            const status = await deckModule.aitumGetStatus();
            return {
                ok: true,
                active: !!(status && status.streaming),
                raw: status || null
            };
        } catch (e) {
            return { ok: false, active: false, error: e.message };
        }
    }

    // ─── POST /api/stream-control/start ───
    // Body: { target: 'obs' | 'aitum' }
    app.post('/api/stream-control/start', async (req, res) => {
        try {
            const { target } = req.body || {};

            if (!target || !['obs', 'aitum'].includes(target)) {
                return res.status(400).json({ ok: false, error: 'target inválido (obs|aitum)' });
            }
            if (!deckModule) {
                return res.status(500).json({ ok: false, error: 'deck.js no disponible' });
            }

            // ⚠️ NO COMBINAR: cada target usa SU propia API
            if (target === 'obs') {
                if (typeof deckModule.startObsStream !== 'function') {
                    return res.status(500).json({ ok: false, error: 'deck.js no expone startObsStream()' });
                }
                const r = await deckModule.startObsStream();
                if (!r || !r.ok) {
                    return res.status(500).json({ ok: false, error: r?.error || 'Error iniciando en OBS' });
                }
                console.log('▶️ [STREAM-CONTROL] Stream iniciado en OBS');
                io.emit('obs:stream-state', { active: true });
                return res.json({ ok: true, target: 'obs', active: true });
            }

            if (target === 'aitum') {
                if (typeof deckModule.aitumStartStreaming !== 'function') {
                    return res.status(500).json({ ok: false, error: 'deck.js no expone aitumStartStreaming()' });
                }
                await deckModule.aitumStartStreaming();
                console.log('▶️ [STREAM-CONTROL] Stream iniciado en Aitum');
                io.emit('aitum:stream-state', { active: true });
                return res.json({ ok: true, target: 'aitum', active: true });
            }
        } catch (e) {
            console.error('❌ [STREAM-CONTROL] Error start:', e.message);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── POST /api/stream-control/stop ───
    // Body: { target: 'obs' | 'aitum' }
    app.post('/api/stream-control/stop', async (req, res) => {
        try {
            const { target } = req.body || {};

            if (!target || !['obs', 'aitum'].includes(target)) {
                return res.status(400).json({ ok: false, error: 'target inválido (obs|aitum)' });
            }
            if (!deckModule) {
                return res.status(500).json({ ok: false, error: 'deck.js no disponible' });
            }

            if (target === 'obs') {
                if (typeof deckModule.stopObsStream !== 'function') {
                    return res.status(500).json({ ok: false, error: 'deck.js no expone stopObsStream()' });
                }
                const r = await deckModule.stopObsStream();
                if (!r || !r.ok) {
                    return res.status(500).json({ ok: false, error: r?.error || 'Error deteniendo en OBS' });
                }
                console.log('⏹️ [STREAM-CONTROL] Stream detenido en OBS');
                io.emit('obs:stream-state', { active: false });
                return res.json({ ok: true, target: 'obs', active: false });
            }

            if (target === 'aitum') {
                if (typeof deckModule.aitumStopStreaming !== 'function') {
                    return res.status(500).json({ ok: false, error: 'deck.js no expone aitumStopStreaming()' });
                }
                await deckModule.aitumStopStreaming();
                console.log('⏹️ [STREAM-CONTROL] Stream detenido en Aitum');
                io.emit('aitum:stream-state', { active: false });
                return res.json({ ok: true, target: 'aitum', active: false });
            }
        } catch (e) {
            console.error('❌ [STREAM-CONTROL] Error stop:', e.message);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── GET /api/stream-control/status ───
    app.get('/api/stream-control/status', async (req, res) => {
        try {
            const [obsStatus, aitumStatus] = await Promise.all([
                getObsStreamStatus(),
                getAitumStreamStatus()
            ]);

            res.json({
                ok: true,
                obs: {
                    active: !!obsStatus.active,
                    durationMs: obsStatus.duration || 0,
                    error: obsStatus.error || null
                },
                aitum: {
                    active: !!aitumStatus.active,
                    error: aitumStatus.error || null
                }
            });
        } catch (e) {
            console.error('❌ [STREAM-CONTROL] Error status:', e.message);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    console.log('🚀 [STREAM-CONTROL] Rutas montadas OK');
} catch (e) {
    console.error('❌ [STREAM-CONTROL] No se pudo montar:', e.message);
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