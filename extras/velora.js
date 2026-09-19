// extras/velora.js
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const WS_URL = 'wss://api.velora.tv/socket.io/?EIO=4&transport=websocket';
const API_URL = 'https://api.velora.tv/api';
const WEB_URL = 'https://velora.tv';
const NS = '/chat';
const RECONNECT_MS = 5000;

// 🔧 Poné true si querés ver TODO el tráfico (debug)
const DEBUG = false;

let ioRef = null;
let ws = null;
let reconnectTimer = null;
let currentChannelId = null;
let currentChannelName = null;
let connected = false;
let viewerCount = 0;
let shouldReconnect = true;
let pingTimer = null;
const closedManually = new WeakSet();
const emotesMap = new Map();

function getConfigPath() {
    const appData = process.env.APPDATA || path.join(process.env.HOME || '', '.config');
    return path.join(appData, 'togi-panel', 'velora-config.json');
}
function loadConfig() {
    try {
        const p = getConfigPath();
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {}
    return {};
}
function saveConfig(cfg) {
    try {
        const p = getConfigPath();
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
    } catch (e) {}
}
function log(...args) { console.log('[Velora]', ...args); }
function logRaw(...args) { if (DEBUG) console.log('[Velora:RAW]', ...args); }

function sendRaw(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        logRaw('↑', JSON.stringify(data).slice(0, 200));
        ws.send(data);
    }
}
function joinChannel() {
    if (!currentChannelId) return;
    sendRaw(`42${NS},["joinChannel",{"channelId":"${currentChannelId}"}]`);
    log('joinChannel →', currentChannelId);
}

async function lookupUsername(username) {
    const clean = String(username || '').replace(/^@/, '').trim();
    if (!clean) throw new Error('username vacío');
    const r = await axios.get(`${API_URL}/users/${encodeURIComponent(clean)}`, {
        timeout: 10000,
        headers: { 'Accept': 'application/json' }
    });
    if (!r.data || !r.data.id) throw new Error('respuesta sin id');
    return {
        id: r.data.id,
        username: r.data.username || clean,
        displayName: r.data.displayName || clean,
        avatarUrl: r.data.avatarUrl || null,
        isLive: !!r.data.isLive,
        followerCount: r.data.followerCount || 0
    };
}

async function fetchEmotes(channelName) {
    emotesMap.clear();
    if (!channelName) return;
    const urls = [
        `${API_URL}/emotes?channel=${encodeURIComponent(channelName)}`,
        `${WEB_URL}/api/emotes?channel=${encodeURIComponent(channelName)}`
    ];
    for (const url of urls) {
        try {
            const r = await axios.get(url, {
                timeout: 10000,
                headers: { 'Accept': 'application/json' }
            });
            const data = r.data;
            if (!data || !Array.isArray(data.collections)) continue;
            for (const col of data.collections) {
                if (!Array.isArray(col.emotes)) continue;
                for (const e of col.emotes) {
                    if (!e.code || !e.assetVariants) continue;
                    const av = e.assetVariants;
                    const url2x = av.animated2x || av.static2x || av.animated1x || av.static1x;
                    if (url2x) emotesMap.set(e.code, { url: url2x, animated: !!e.isAnimated });
                }
            }
            if (emotesMap.size > 0) {
                log(`🎨 emotes cargados: ${emotesMap.size}`);
                return;
            }
        } catch (e) {
            log('⚠️ fallo emotes:', e.response?.status || e.message);
        }
    }
    log('⚠️ sin emotes');
}

function parseMessageParts(text) {
    if (!text || emotesMap.size === 0) return null;
    const tokens = String(text).split(/(\s+)/);
    let hasEmote = false;
    const parts = [];
    for (const tok of tokens) {
        if (!tok) continue;
        if (/^\s+$/.test(tok)) {
            parts.push({ type: 'text', value: tok });
            continue;
        }
        if (emotesMap.has(tok)) {
            const e = emotesMap.get(tok);
            parts.push({ type: 'emote', code: tok, url: e.url });
            hasEmote = true;
            continue;
        }
        const m = tok.match(/^(.+?)([.,!?;:…]+)$/);
        if (m && emotesMap.has(m[1])) {
            const e = emotesMap.get(m[1]);
            parts.push({ type: 'emote', code: m[1], url: e.url });
            parts.push({ type: 'text', value: m[2] });
            hasEmote = true;
            continue;
        }
        parts.push({ type: 'text', value: tok });
    }
    return hasEmote ? parts : null;
}

function handleEvent(eventName, data) {
    if (!ioRef) return;

    if (eventName === 'newMessage') {
        const parts = parseMessageParts(data.message);
        const emoteCount = parts ? parts.filter(p => p.type === 'emote').length : 0;
        log('📨', data.username, '→', data.message + (emoteCount ? ` [${emoteCount} emote${emoteCount > 1 ? 's' : ''}]` : ''));

        ioRef.emit('chat-message', {
            platform: 'velora',
            id: data.id,
            user: data.username,
            username: data.username,
            displayName: data.displayName || data.username,
            message: data.message,
            parts: parts || undefined,
            channel: currentChannelName || data.channelId,
            role: data.role || null,
            isSub: !!data.isSubscriber,
            isMod: !!data.isModerator,
            isVip: !!data.isVip,
            badges: data.badges || [],
            avatar: data.avatarUrl || null,
            color: data.accentColor || '#00d9ff',
            timestamp: data.timestamp || new Date().toISOString()
        });
    } else if (eventName === 'userJoined') {
        logRaw('userJoined:', data.username);
        ioRef.emit('velora-user-joined', {
            user: data.username,
            displayName: data.displayName,
            isGuest: !!data.isGuest,
            role: data.role || null,
            avatar: data.avatarUrl || null
        });
    } else if (eventName === 'viewer_count_update') {
        viewerCount = data.count || 0;
        logRaw('viewers:', data.count);
        ioRef.emit('velora-viewers', {
            count: data.count || 0,
            anonymous: data.anonymousCount || 0
        });
    } else if (eventName === 'channelRole') {
        logRaw('channelRole:', data.role);
    } else {
        logRaw('evento desconocido:', eventName);
    }
}

function parseAndDispatch(raw) {
    if (typeof raw !== 'string') return;
    logRaw('↓', JSON.stringify(raw).slice(0, 300));

    if (raw[0] === '0') { sendRaw(`40${NS},`); return; }
    if (raw === '2') { sendRaw('3'); return; }
    if (raw === '3') return;

    if (raw.startsWith(`40${NS},`)) {
        connected = true;
        log('namespace conectado');
        if (ioRef) ioRef.emit('velora-status', { connected: true, channelId: currentChannelId });
        joinChannel();
        return;
    }
    if (raw.startsWith(`42${NS},`)) {
        const payload = raw.slice(`42${NS},`.length);
        const jsonStart = payload.indexOf('[');
        if (jsonStart === -1) return;
        let arr;
        try { arr = JSON.parse(payload.slice(jsonStart)); } catch (e) { return; }
        if (!Array.isArray(arr) || arr.length < 1) return;
        handleEvent(arr[0], arr[1] || {});
        return;
    }
    if (raw.startsWith(`41${NS},`)) {
        connected = false;
        log('namespace desconectado');
        if (ioRef) ioRef.emit('velora-status', { connected: false });
        return;
    }
}

function scheduleReconnect() {
    if (reconnectTimer || !shouldReconnect || !currentChannelId) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!ws || ws.readyState === WebSocket.CLOSED) {
            connect(currentChannelId, currentChannelName);
        }
    }, RECONNECT_MS);
}

function connect(channelId, channelName) {
    if (ws) {
        closedManually.add(ws);
        try { ws.close(); } catch (e) {}
        ws = null;
    }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }

    currentChannelId = channelId;
    currentChannelName = channelName;
    shouldReconnect = true;

    fetchEmotes(channelName).catch(() => {});

    log('conectando a', WS_URL);
    const myWs = new WebSocket(WS_URL, { origin: 'https://velora.tv' });
    ws = myWs;

    myWs.on('open', () => log('WS abierto'));

    myWs.on('message', (buf) => {
        const raw = buf.toString();
        if (raw.includes('\x1e')) {
            raw.split('\x1e').forEach(parseAndDispatch);
        } else {
            parseAndDispatch(raw);
        }
    });

    myWs.on('close', (code) => {
        if (closedManually.has(myWs)) {
            closedManually.delete(myWs);
            return;
        }
        if (ws !== myWs) return;
        connected = false;
        log('WS cerrado', code);
        if (ioRef) ioRef.emit('velora-status', { connected: false });
        scheduleReconnect();
    });

    myWs.on('error', (err) => log('WS error:', err.message));
}

function disconnect(manual = true) {
    if (manual) shouldReconnect = false;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (ws) {
        closedManually.add(ws);
        try { ws.close(); } catch (e) {}
        ws = null;
    }
    connected = false;
}

module.exports = (app, io) => {
    ioRef = io;

    app.get('/api/velora/status', (req, res) => {
        res.json({
            connected,
            channelId: currentChannelId,
            channelName: currentChannelName,
            viewerCount,
            emotesCount: emotesMap.size
        });
    });

    app.get('/api/velora/emotes', (req, res) => {
        const out = {};
        for (const [code, v] of emotesMap.entries()) out[code] = v.url;
        res.json({ ok: true, count: emotesMap.size, emotes: out });
    });

    app.get('/api/velora/lookup', async (req, res) => {
        try {
            const username = String(req.query.username || '').trim();
            if (!username) return res.status(400).json({ ok: false, error: 'Falta ?username=' });
            const info = await lookupUsername(username);
            res.json({ ok: true, ...info });
        } catch (e) {
            const status = e.response?.status || 500;
            res.status(status).json({ ok: false, error: e.response?.status === 404 ? 'Canal no encontrado en Velora' : e.message });
        }
    });

    app.post('/api/velora/connect', async (req, res) => {
        try {
            let { channelId, channelName, username } = req.body || {};
            channelName = String(channelName || username || '').replace(/^@/, '').trim();
            if (!channelId) {
                if (!channelName) return res.status(400).json({ ok: false, error: 'Falta username o channelId' });
                try {
                    const info = await lookupUsername(channelName);
                    channelId = info.id;
                    channelName = info.username;
                } catch (e) {
                    const status = e.response?.status || 500;
                    return res.status(status).json({ ok: false, error: e.response?.status === 404 ? 'Canal no encontrado en Velora' : e.message });
                }
            }
            currentChannelId = channelId;
            currentChannelName = channelName || null;
            saveConfig({ channelId, channelName: currentChannelName, autoConnect: true });
            connect(channelId, currentChannelName);
            res.json({ ok: true, channelId, channelName: currentChannelName });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/velora/disconnect', (req, res) => {
        const cfg = loadConfig();
        saveConfig({ ...cfg, autoConnect: false });
        disconnect(true);
        res.json({ ok: true });
    });

    const cfg = loadConfig();
    if (cfg.autoConnect && cfg.channelId) {
        setTimeout(() => connect(cfg.channelId, cfg.channelName), 1500);
    }

    log('módulo cargado');
};