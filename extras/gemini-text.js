// extras/gemini-text.js
// Sesión de texto paralela. NO toca Gemini Live (WebSocket).
// Usa REST API de Gemini para: resúmenes, búsqueda Google, consultas puntuales.

const fs = require('fs');
const path = require('path');

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
const CONFIG_PATH = path.join(USER_DATA_DIR, 'gemini-text-config.json');
const MEMORIA_SESION_PATH = path.join(USER_DATA_DIR, 'memoria-sesion.json');

const DEFAULTS = {
    apiKey: '',
    apiKeys: [],
    modelo: 'gemini-3.6-flash',
    intervaloResumenMs: 5 * 60 * 1000,
    activo: true,
    resumenSilencioso: true
};

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ═══════════════════════════════════════════════════════════════
// 📁 CONFIG
// ═══════════════════════════════════════════════════════════════
function cargarConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULTS };
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        const merged = { ...DEFAULTS, ...parsed };

        if (!Array.isArray(merged.apiKeys)) merged.apiKeys = [];
        if (merged.apiKey && merged.apiKeys.length === 0) merged.apiKeys = [merged.apiKey];
        merged.apiKeys = merged.apiKeys.map(k => String(k || '').trim()).filter(Boolean);
        if (merged.apiKeys.length > 0) merged.apiKey = merged.apiKeys[0];

        if (typeof merged.intervaloResumenMs !== 'number' || merged.intervaloResumenMs < 60000) {
            merged.intervaloResumenMs = DEFAULTS.intervaloResumenMs;
        }
        return merged;
    } catch (e) {
        console.error('❌ [GEMINI-TEXT] No pude leer config:', e.message);
        return { ...DEFAULTS };
    }
}

function guardarConfig(cfg) {
    try {
        fs.mkdirSync(USER_DATA_DIR, { recursive: true });
        const aGuardar = { ...cfg };
        if (Array.isArray(aGuardar.apiKeys) && aGuardar.apiKeys.length > 0) {
            aGuardar.apiKeys = aGuardar.apiKeys.map(k => String(k || '').trim()).filter(Boolean);
            aGuardar.apiKey = aGuardar.apiKeys[0];
        } else {
            delete aGuardar.apiKeys;
        }
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(aGuardar, null, 2));
        return true;
    } catch (e) {
        console.error('❌ [GEMINI-TEXT] No pude guardar config:', e.message);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
// 🧠 MEMORIA DE SESIÓN (resúmenes acumulados)
// ═══════════════════════════════════════════════════════════════
function cargarMemoriaSesion() {
    try {
        if (!fs.existsSync(MEMORIA_SESION_PATH)) {
            return { resumenes: [], ultimoResumen: '', ultimoResumenTs: 0 };
        }
        const raw = fs.readFileSync(MEMORIA_SESION_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            resumenes: Array.isArray(parsed.resumenes) ? parsed.resumenes : [],
            ultimoResumen: String(parsed.ultimoResumen || ''),
            ultimoResumenTs: Number(parsed.ultimoResumenTs || 0)
        };
    } catch (e) {
        console.error('❌ [GEMINI-TEXT] No pude leer memoria-sesion.json:', e.message);
        return { resumenes: [], ultimoResumen: '', ultimoResumenTs: 0 };
    }
}

function guardarMemoriaSesion(mem) {
    try {
        fs.mkdirSync(USER_DATA_DIR, { recursive: true });
        if (mem.resumenes.length > 50) mem.resumenes = mem.resumenes.slice(-50);
        fs.writeFileSync(MEMORIA_SESION_PATH, JSON.stringify(mem, null, 2));
        return true;
    } catch (e) {
        console.error('❌ [GEMINI-TEXT] No pude guardar memoria-sesion.json:', e.message);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
// 🔧 ESTADO RUNTIME
// ═══════════════════════════════════════════════════════════════
let ioRef = null;
let configRef = null;
let cfg = cargarConfig();
let apiKeysPool = [];
let poolIndex = 0;
let memoriaSesion = cargarMemoriaSesion();

let timerResumen = null;
let resumenEnCurso = false;
let estadisticas = {
    resumenesGenerados: 0,
    busquedasRealizadas: 0,
    errores: 0
};

// ═══════════════════════════════════════════════════════════════
// 🔑 POOL DE KEYS
// ═══════════════════════════════════════════════════════════════
function obtenerKeyActual() {
    if (!apiKeysPool.length) return '';
    return apiKeysPool[poolIndex % apiKeysPool.length];
}

function rotarKey() {
    if (apiKeysPool.length <= 1) return false;
    poolIndex = (poolIndex + 1) % apiKeysPool.length;
    console.log(`🔑 [GEMINI-TEXT] Rotando a key ${poolIndex + 1}/${apiKeysPool.length}`);
    return true;
}

// ═══════════════════════════════════════════════════════════════
// 📡 LLAMADA REST A GEMINI
// ═══════════════════════════════════════════════════════════════
async function llamarGemini(prompt, opciones = {}) {
    const {
        useSearch = false,
        systemInstruction = null,
        maxTokens = 1024,
        temperatura = 0.7
    } = opciones;

    cfg = cargarConfig();
    apiKeysPool = Array.isArray(cfg.apiKeys) ? cfg.apiKeys.slice() : [];
    if (apiKeysPool.length === 0 && cfg.apiKey) apiKeysPool = [cfg.apiKey];
    if (apiKeysPool.length === 0) throw new Error('No hay API keys configuradas para texto');

    const modelo = cfg.modelo || 'gemini-2.5-flash';

    let intentos = 0;
    const maxIntentos = Math.max(1, apiKeysPool.length);

    while (intentos < maxIntentos) {
        const key = obtenerKeyActual();
        const url = `${API_BASE}/${modelo}:generateContent?key=${encodeURIComponent(key)}`;

        const body = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: temperatura,
                maxOutputTokens: maxTokens
            }
        };
        if (systemInstruction) {
            body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }
        if (useSearch) {
            body.tools = [{ google_search: {} }];
        }

        try {
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (r.status === 401 || r.status === 403 || r.status === 429) {
                console.warn(`🔑 [GEMINI-TEXT] Key ${poolIndex + 1} falló (${r.status})`);
                if (!rotarKey()) {
                    estadisticas.errores++;
                    throw new Error(`Todas las keys fallaron (último: ${r.status})`);
                }
                intentos++;
                continue;
            }

            if (!r.ok) {
                const errTxt = await r.text();
                estadisticas.errores++;
                throw new Error(`Gemini text ${r.status}: ${errTxt.slice(0, 200)}`);
            }

            const d = await r.json();
            const partes = d?.candidates?.[0]?.content?.parts || [];
            const texto = partes.map(p => p.text || '').join('').trim();
            return texto;
        } catch (e) {
            if (e.message && e.message.includes('Todas las keys')) throw e;
            if (e.name === 'TypeError' || /fetch/i.test(e.message || '')) {
                estadisticas.errores++;
                throw new Error('Error de red: ' + e.message);
            }
            throw e;
        }
    }
    throw new Error('No se pudo completar la llamada');
}

// ═══════════════════════════════════════════════════════════════
// 📝 RESUMEN DE CHAT
// ═══════════════════════════════════════════════════════════════
async function generarResumen(bufferChat, transcripcionVoz) {
    if (resumenEnCurso) {
        console.log('📝 [GEMINI-TEXT] Resumen ya en curso, salto');
        return null;
    }

    const hayChat = Array.isArray(bufferChat) && bufferChat.length > 0;
    const hayVoz = typeof transcripcionVoz === 'string' && transcripcionVoz.trim().length > 0;

    if (!hayChat && !hayVoz) {
        return null;
    }

    resumenEnCurso = true;
    const ts = Date.now();

    try {
        let contexto = '';
        if (hayChat) {
            contexto += `Mensajes del chat (últimos):\n${bufferChat.join('\n')}\n\n`;
        }
        if (hayVoz) {
            contexto += `Transcripción de lo que dijo el streamer por voz:\n${transcripcionVoz}\n\n`;
        }

        const systemInstruction = [
            'Eres un asistente que resume streams en vivo.',
            'Devuelve un resumen breve (máximo 5 líneas) de lo que ha pasado: temas hablados, chistes, preguntas recurrentes, gente participando.',
            'Sin markdown, sin listas, solo texto plano.',
            'Español neutro, sin modismos.'
        ].join(' ');

        const prompt = `Resume lo siguiente:\n\n${contexto}`;

        const resumen = await llamarGemini(prompt, {
            systemInstruction,
            maxTokens: 400,
            temperatura: 0.4
        });

        if (!resumen) {
            console.warn('📝 [GEMINI-TEXT] Resumen vacío');
            return null;
        }

        memoriaSesion.resumenes.push({ ts, texto: resumen });
        memoriaSesion.ultimoResumen = resumen;
        memoriaSesion.ultimoResumenTs = ts;
        guardarMemoriaSesion(memoriaSesion);
        estadisticas.resumenesGenerados++;

        console.log(`📝 [GEMINI-TEXT] Resumen generado (${resumen.length} chars)`);
        if (ioRef) ioRef.emit('gemini-live:resumen-listo', { ts, texto: resumen, fuente: 'auto' });

        return resumen;
    } catch (e) {
        console.error('❌ [GEMINI-TEXT] Error generando resumen:', e.message);
        if (ioRef) ioRef.emit('gemini-live:error', { origen: 'texto', message: e.message });
        return null;
    } finally {
        resumenEnCurso = false;
    }
}

// ═══════════════════════════════════════════════════════════════
// 🔍 BÚSQUEDA EN GOOGLE
// ═══════════════════════════════════════════════════════════════
async function buscar(query, contextoExtra) {
    if (!query || String(query).trim().length < 2) {
        return { ok: false, error: 'Consulta vacía' };
    }

    try {
        const systemInstruction = [
            'Eres un buscador útil para un streamer.',
            'Usa la herramienta de búsqueda de Google para responder.',
            'Responde en 1 o 2 frases cortas, con datos concretos.',
            'Sin markdown, sin listas, solo texto plano.',
            'Español neutro.'
        ].join(' ');

        let prompt = String(query).trim();
        if (contextoExtra) prompt = `${contextoExtra}\n\nPregunta: ${prompt}`;

        const respuesta = await llamarGemini(prompt, {
            useSearch: true,
            systemInstruction,
            maxTokens: 500,
            temperatura: 0.5
        });

        estadisticas.busquedasRealizadas++;
        console.log(`🔍 [GEMINI-TEXT] Búsqueda OK: ${String(query).slice(0, 50)}...`);

        if (ioRef) ioRef.emit('gemini-live:busqueda-lista', { query, respuesta });
        return { ok: true, respuesta };
    } catch (e) {
        console.error('❌ [GEMINI-TEXT] Error búsqueda:', e.message);
        return { ok: false, error: e.message };
    }
}

// ═══════════════════════════════════════════════════════════════
// 📤 CONSULTA GENÉRICA (sin búsqueda)
// ═══════════════════════════════════════════════════════════════
async function consultar(prompt, opciones = {}) {
    try {
        const respuesta = await llamarGemini(prompt, opciones);
        return { ok: true, respuesta };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ═══════════════════════════════════════════════════════════════
// ⏰ RESÚMENES AUTOMÁTICOS
// ═══════════════════════════════════════════════════════════════
let obtenerBufferFn = null;      // inyectado desde gemini-live
let obtenerTransVozFn = null;    // inyectado desde gemini-live

function registrarFuentes({ getBufferChat, getTranscripcionVoz }) {
    if (typeof getBufferChat === 'function') obtenerBufferFn = getBufferChat;
    if (typeof getTranscripcionVoz === 'function') obtenerTransVozFn = getTranscripcionVoz;
}

function arrancarTimerResumen() {
    if (timerResumen) clearInterval(timerResumen);
    cfg = cargarConfig();
    const ms = cfg.intervaloResumenMs || DEFAULTS.intervaloResumenMs;

    timerResumen = setInterval(async () => {
        cfg = cargarConfig();
        if (!cfg.activo) return;
        const buffer = obtenerBufferFn ? obtenerBufferFn() : [];
        const voz = obtenerTransVozFn ? obtenerTransVozFn() : '';
        await generarResumen(buffer, voz);
    }, ms);

    console.log(`⏰ [GEMINI-TEXT] Resumen automático cada ${Math.round(ms/60000)} min`);
}

// ═══════════════════════════════════════════════════════════════
// 🔌 INIT
// ═══════════════════════════════════════════════════════════════
function init(io, configGlobal) {
    ioRef = io;
    configRef = configGlobal;
    cfg = cargarConfig();
    apiKeysPool = Array.isArray(cfg.apiKeys) ? cfg.apiKeys.slice() : [];
    if (apiKeysPool.length === 0 && cfg.apiKey) apiKeysPool = [cfg.apiKey];

    arrancarTimerResumen();

    io.on('connection', (socket) => {
        socket.emit('gemini-text:estado', estado());

        socket.on('gemini-text:get', () => {
            socket.emit('gemini-text:estado', estado());
        });

        socket.on('gemini-text:resumen-manual', async () => {
            const buffer = obtenerBufferFn ? obtenerBufferFn() : [];
            const voz = obtenerTransVozFn ? obtenerTransVozFn() : '';
            const r = await generarResumen(buffer, voz);
            socket.emit('gemini-text:resumen-resultado', { ok: !!r, texto: r || '' });
        });

        socket.on('gemini-text:buscar', async ({ query, contexto } = {}) => {
            const r = await buscar(query, contexto);
            socket.emit('gemini-text:buscar-resultado', r);
        });

        socket.on('gemini-text:olvidar-resumenes', () => {
            memoriaSesion = { resumenes: [], ultimoResumen: '', ultimoResumenTs: 0 };
            guardarMemoriaSesion(memoriaSesion);
            console.log('🧹 [GEMINI-TEXT] Resúmenes olvidados');
            if (ioRef) ioRef.emit('gemini-text:estado', estado());
        });

        socket.on('gemini-text:config-get', () => {
            socket.emit('gemini-text:config', cfg);
        });

        socket.on('gemini-text:config-set', (nuevaCfg = {}) => {
            const merged = { ...cfg, ...nuevaCfg };
            if (Array.isArray(merged.apiKeys)) {
                merged.apiKeys = merged.apiKeys.map(k => String(k || '').trim()).filter(Boolean);
                if (merged.apiKeys.length > 0) merged.apiKey = merged.apiKeys[0];
            }
            guardarConfig(merged);
            cfg = cargarConfig();
            apiKeysPool = Array.isArray(cfg.apiKeys) ? cfg.apiKeys.slice() : [];
            if (apiKeysPool.length === 0 && cfg.apiKey) apiKeysPool = [cfg.apiKey];
            arrancarTimerResumen();
            socket.emit('gemini-text:estado', estado());
        });
    });

    console.log(`📚 [GEMINI-TEXT] Módulo listo. Keys: ${apiKeysPool.length} | Modelo: ${cfg.modelo} | Resumen cada ${Math.round((cfg.intervaloResumenMs||0)/60000)} min`);
}

// ═══════════════════════════════════════════════════════════════
// 📊 ESTADO
// ═══════════════════════════════════════════════════════════════
function estado() {
    return {
        activo: !!cfg.activo,
        modelo: cfg.modelo,
        keysEnPool: apiKeysPool.length,
        keyActual: poolIndex + 1,
        intervaloResumenMs: cfg.intervaloResumenMs,
        resumenesGenerados: estadisticas.resumenesGenerados,
        busquedasRealizadas: estadisticas.busquedasRealizadas,
        errores: estadisticas.errores,
        ultimoResumenTs: memoriaSesion.ultimoResumenTs,
        ultimoResumen: memoriaSesion.ultimoResumen,
        totalResumenes: memoriaSesion.resumenes.length
    };
}

function obtenerUltimoResumen() {
    return memoriaSesion.ultimoResumen || '';
}

module.exports = {
    init,
    generarResumen,
    buscar,
    consultar,
    registrarFuentes,
    obtenerUltimoResumen,
    estado,
    cargarConfig,
    guardarConfig,
    CONFIG_PATH,
    MEMORIA_SESION_PATH
};