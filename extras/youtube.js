// youtube.js - Módulo YouTube Chat (Innertube, sin API Key / sin OAuth)
// Compatible con server.js de TogiPanel

let innertubePromise = null;
const innertubeClients = new Map();
const CLIENT_ORDER = ['WEB_EMBEDDED', 'ANDROID', 'MWEB', 'WEB'];
const POLL_MS = 30000; // cada cuánto busca si empezó el live

// ================================================================
// 🔧 Innertube (carga diferida, ESM)
// ================================================================
async function getInnertube(clientType) {
    if (innertubeClients.has(clientType)) return innertubeClients.get(clientType);

    if (!innertubePromise) {
        innertubePromise = (async () => {
            const mod = await import('youtubei.js');

            // Silenciar el spam de logs del parser de youtubei.js.
            // Los "InnertubeError: X not found" son inofensivos: la librería
            // encuentra elementos nuevos de YouTube que no conoce y los loguea.
            try {
                const Log = mod.Log || (mod.default && mod.default.Log);
                if (Log && Log.setLevel && Log.Level) {
                    Log.setLevel(Log.Level.NONE);
                }
            } catch (e) { /* si falla, no rompemos nada */ }

            const Innertube = mod.Innertube || (mod.default && mod.default.Innertube) || mod.default;
            if (!Innertube) throw new Error('No se pudo cargar Innertube de youtubei.js');
            return Innertube;
        })();
    }
    const Innertube = await innertubePromise;

    const client = await Innertube.create({
        client_type: clientType,
        retrieve_player: false,
        generate_session_locally: true,
        enable_session_cache: true
    });
    innertubeClients.set(clientType, client);
    return client;
}

// ================================================================
// 🔍 Parseo de input (@handle, URL, videoId, UC...)
// ================================================================
function parseVideoIdFromInput(input) {
    const s = String(input || '').trim();
    if (!s) return null;
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
    try {
        const u = new URL(s);
        if (u.hostname.includes('youtu.be')) {
            const id = u.pathname.replace(/^\/+/, '').split('/')[0];
            if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
        }
        if (u.pathname.includes('/watch')) {
            const v = u.searchParams.get('v');
            if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
        }
    } catch {}
    return null;
}

function buildLiveUrlFromInput(input) {
    const s = String(input || '').trim();
    if (!s) return null;
    if (s.startsWith('@')) return `https://www.youtube.com/${s}/live`;
    if (/^https?:\/\//i.test(s)) {
        try {
            const u = new URL(s);
            let p = u.pathname || '';
            if (p.endsWith('/')) p = p.slice(0, -1);
            if (p.endsWith('/live')) p = p.slice(0, -5);
            if (p.startsWith('/@') || p.startsWith('/channel/') ||
                p.startsWith('/c/') || p.startsWith('/user/')) {
                return `https://www.youtube.com${p}/live`;
            }
        } catch {}
    }
    // Si empieza por UC... es channelId
    if (/^UC[\w-]{20,}$/.test(s)) return `https://www.youtube.com/channel/${s}/live`;
    return `https://www.youtube.com/@${s}/live`;
}

function normalizeKey(input) {
    const s = String(input || '').trim();
    if (!s) return '';
    const vid = parseVideoIdFromInput(s);
    if (vid) return vid;
    if (s.startsWith('@')) return s.slice(1).toLowerCase();
    if (/^UC[\w-]{20,}$/.test(s)) return s.toLowerCase();
    if (/^https?:\/\//i.test(s)) return s.toLowerCase();
    return s.toLowerCase();
}

// ================================================================
// 🌐 Scraping del videoId desde /live
// ================================================================
async function fetchText(url) {
    if (typeof fetch === 'function') {
        const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
        return await r.text();
    }
    const https = require('https');
    return await new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'user-agent': 'Mozilla/5.0' } }, res => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', c => (data += c));
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
    });
}

async function getLiveVideoId(liveUrl) {
    if (!liveUrl) return null;
    try {
        const html = await fetchText(liveUrl);
        const m = html.match(/"videoId":"(.*?)"/);
        return m ? m[1] : null;
    } catch (e) {
        return null;
    }
}

// ================================================================
// 📦 Extraer evento del item de chat
// ================================================================
function extractEvent(item, channelKey) {
    if (!item) return null;
    const author = item.author && item.author.name ? String(item.author.name) : '';
    if (!author) return null;

    const avatar = (item.author && item.author.thumbnails && item.author.thumbnails[0] &&
                    item.author.thumbnails[0].url) || null;
    const base = { username: author, channel: channelKey, avatar, timestamp: Date.now() };

    // 1) Super Chat
    if (item.superchat) {
        const msg = item.superchat.message;
        const text = msg ? (typeof msg === 'string' ? msg : (msg.toString ? msg.toString() : '')) : '';
        return {
            ...base,
            type: 'gift',
            message: text,
            amount: item.superchat.amount || '',
            tier: item.superchat.color || null,
            giftName: 'Super Chat'
        };
    }

    // 2) Super Sticker
    if (item.supersticker) {
        return {
            ...base,
            type: 'gift',
            message: '',
            amount: item.supersticker.amount || '',
            sticker: true,
            giftName: 'Super Sticker'
        };
    }

    // 3) Membership / miembro nuevo
    if (item.membership) {
        const msg = item.membership.message;
        const text = msg ? (typeof msg === 'string' ? msg : (msg.toString ? msg.toString() : '')) : '';
        return {
            ...base,
            type: 'member',
            message: text || `${author} se unió como miembro`
        };
    }

    // 4) Chat normal
    if (item.message) {
        const msg = item.message;
        const text = typeof msg === 'string' ? msg : (msg.toString ? msg.toString() : '');
        if (!text) return null;
        return {
            ...base,
            type: 'chat',
            message: text
        };
    }

    return null;
}

// ================================================================
// 🎬 Clase YouTubeChat (mismo estilo que TikTokChat)
// ================================================================
class YouTubeChat {
    constructor(handlers = {}) {
        this.handlers = handlers;
        this.sources = new Map();
        this.connected = false;
    }

    log(msg) {
        console.log(`📺 [YOUTUBE] ${msg}`);
    }

    logError(msg) {
        console.error(`❌ [YOUTUBE] ${msg}`);
    }

    // ---------- Fuentes ----------
    ensureSource(input) {
        const key = normalizeKey(input);
        if (!key) return null;

        let src = this.sources.get(key);
        if (!src) {
            src = {
                key,
                input,
                liveUrl: buildLiveUrlFromInput(input),
                videoId: parseVideoIdFromInput(input),
                activeVideoId: null,
                chat: null,
                chatRunning: false,
                monitor: null,
                polling: false
            };
            this.sources.set(key, src);
        } else {
            src.input = input;
            src.liveUrl = buildLiveUrlFromInput(input);
            const v = parseVideoIdFromInput(input);
            if (v) src.videoId = v;
        }

        if (!src.monitor) {
            src.monitor = setInterval(() => this.checkLive(src), POLL_MS);
            this.checkLive(src);
        }
        return src;
    }

    stopSource(src) {
        try { if (src.monitor) clearInterval(src.monitor); } catch {}
        src.monitor = null;
        try { if (src.chat && typeof src.chat.stop === 'function') src.chat.stop(); } catch {}
        src.chat = null;
        src.activeVideoId = null;
        src.chatRunning = false;
    }

    // ---------- Buscar y conectar chat ----------
    async checkLive(src) {
        if (src.polling) return;
        src.polling = true;
        try {
            if (!src.videoId) src.videoId = parseVideoIdFromInput(src.input);
            let vid = src.videoId;
            if (!vid) {
                const liveUrl = src.liveUrl || buildLiveUrlFromInput(src.input);
                src.liveUrl = liveUrl;
                vid = await getLiveVideoId(liveUrl);
            }
            if (vid) {
                src.videoId = vid;
                await this.startChatForVideo(src, vid);
            }
        } catch (err) {
            this.logError(`monitor: ${err && err.message ? err.message : err}`);
        } finally {
            src.polling = false;
        }
    }

    async startChatForVideo(src, videoId) {
        if (!videoId) return;
        if (src.chat && src.activeVideoId === videoId && src.chatRunning) return;

        try { if (src.chat && typeof src.chat.stop === 'function') src.chat.stop(); } catch {}
        src.chat = null;
        src.chatRunning = false;
        src.activeVideoId = videoId;

        let liveChat = null;
        let lastErr = null;

        for (const clientType of CLIENT_ORDER) {
            try {
                const yt = await getInnertube(clientType);
                let info;
                try { info = await yt.getInfo(videoId); }
                catch { info = await yt.getBasicInfo(videoId); }

                liveChat = info && typeof info.getLiveChat === 'function'
                    ? await info.getLiveChat()
                    : null;
                if (liveChat) {
                    this.log(`Conectado (${clientType}) → ${src.key}`);
                    break;
                }
            } catch (err) {
                lastErr = err;
                continue;
            }
        }

        if (!liveChat) {
            if (lastErr) this.logError(`conectar "${src.key}": ${lastErr.message || lastErr}`);
            src.chatRunning = false;
            src.activeVideoId = null;
            return;
        }

        src.chat = liveChat;

        liveChat.on('chat-update', (data) => {
            try {
                const event = extractEvent(data && data.item, src.key);
                if (!event) return;
                this.dispatch(event);
            } catch (e) {
                this.logError(`chat-update: ${e && e.message ? e.message : e}`);
            }
        });

        liveChat.on('end', () => {
            this.log(`Live terminado: ${src.key}`);
            src.chatRunning = false;
            src.activeVideoId = null;
        });

        liveChat.on('error', (err) => {
            this.logError(`chat error "${src.key}": ${err && err.message ? err.message : err}`);
            src.chatRunning = false;
            src.activeVideoId = null;
        });

        if (typeof liveChat.start === 'function') {
            const p = liveChat.start();
            if (p && typeof p.catch === 'function') {
                p.catch(e => this.logError(`start: ${e && e.message ? e.message : e}`));
            }
        }
        src.chatRunning = true;
    }

    // ---------- Despacho a handlers ----------
    dispatch(event) {
        const h = this.handlers || {};
        try {
            if (event.type === 'chat' && typeof h.onChat === 'function') {
                h.onChat(event);
            } else if (event.type === 'gift' && typeof h.onGift === 'function') {
                h.onGift(event);
            } else if (event.type === 'member' && typeof h.onMember === 'function') {
                h.onMember(event);
            }
        } catch (e) {
            this.logError(`handler: ${e && e.message ? e.message : e}`);
        }
    }

    // ---------- API pública ----------
    async setChannels(channels) {
        const arr = Array.isArray(channels) ? channels : [];
        const keep = new Set();

        for (const raw of arr) {
            const s = typeof raw === 'string' ? raw.trim() : '';
            if (!s) continue;
            const key = normalizeKey(s);
            if (!key) continue;
            keep.add(key);
            this.ensureSource(s);
        }

        for (const [key, src] of this.sources.entries()) {
            if (!keep.has(key)) {
                this.stopSource(src);
                this.sources.delete(key);
            }
        }

        this.connected = this.sources.size > 0;
        this.log(`Canales activos: ${Array.from(this.sources.keys()).join(', ') || '(ninguno)'}`);
        return true;
    }

    stopAll() {
        for (const src of this.sources.values()) this.stopSource(src);
        this.sources.clear();
        this.connected = false;
    }

    getStatus() {
        const out = {};
        for (const [key, src] of this.sources.entries()) {
            out[key] = {
                live: !!src.chatRunning,
                videoId: src.activeVideoId || src.videoId || null,
                input: src.input
            };
        }
        return out;
    }
}

module.exports = { YouTubeChat };