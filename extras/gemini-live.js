// extras/gemini-live.js
// Puente WebSocket entre TogiPanel y Gemini Live API.

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

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
const CONFIG_PATH = path.join(USER_DATA_DIR, 'gemini-config.json');
const MEMORIA_VOZ_PATH = path.join(USER_DATA_DIR, 'memoria-voz.json');

const DEFAULTS = {
    apiKey: '',
    apiKeys: [],
    voz: 'Aoede',
    comandoChat: '!voz',
    palabraClave: 'gemini',
    modelo: 'models/gemini-3.1-flash-live-preview',
    modo: 'normal',
    pronombre: 'ella',
    pronombrePersonalizado: ''
};

const MODOS_VALIDOS = ['normal', 'silencio', 'autonomo'];
const PRONOMBRES_VALIDOS = ['ella', 'el', 'elle', 'personalizado'];

// 📋 Etapa 2 — Buffer de chat
const BUFFER_MAX = 15;
const BUFFER_RESET_MS = 5 * 60 * 1000;

// 🔄 Reset programado de sesión
const RESET_SESION_INTERVALO_MS = 6 * 60 * 1000;

// 🎤 Etapa 2.5 — Memoria de voz
const MEMORIA_VOZ_MAX_ENTRADAS = 500;
const MEMORIA_VOZ_DEBOUNCE_MS = 2000;

// 🛡️ Modo guardia
const GUARDIA_B_CADA = 5;
const GUARDIA_C_VENTANA_CHAT_MS = 3 * 60 * 1000;
const GUARDIA_C_INTERVALO_MS = 150 * 1000;
const GUARDIA_C_TICK_MS = 60 * 1000;

// 🔑 Pool de keys
const CODIGOS_ROTAR_KEY = [401, 403, 429];
const TIMEOUT_APERTURA_WS_MS = 8000;

// 📚 Etapa 3 — Comandos especiales de texto
const COMANDO_BUSCA = '!busca';
const COMANDO_RESUMEN = '!resumen';

function cargarConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULTS };
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        const merged = { ...DEFAULTS, ...parsed };

        if (!Array.isArray(merged.apiKeys)) merged.apiKeys = [];
        if (merged.apiKey && merged.apiKeys.length === 0) {
            merged.apiKeys = [merged.apiKey];
        }
        merged.apiKeys = merged.apiKeys.map(k => String(k || '').trim()).filter(Boolean);
        if (merged.apiKeys.length > 0) merged.apiKey = merged.apiKeys[0];

        if (!MODOS_VALIDOS.includes(merged.modo)) merged.modo = 'normal';
        if (merged.modo === 'autonomo') merged.modo = 'normal';
        if (!PRONOMBRES_VALIDOS.includes(merged.pronombre)) merged.pronombre = 'ella';
        merged.pronombrePersonalizado = String(merged.pronombrePersonalizado || '').trim();

        return merged;
    } catch (e) {
        console.error('❌ [GEMINI] No pude leer gemini-config.json:', e.message);
        return { ...DEFAULTS };
    }
}

function guardarConfig(cfg) {
    try {
        fs.mkdirSync(USER_DATA_DIR, { recursive: true });
        const aGuardar = { ...cfg };
        if (aGuardar.modo === 'autonomo') aGuardar.modo = 'normal';
        if (Array.isArray(aGuardar.apiKeys) && aGuardar.apiKeys.length > 0) {
            aGuardar.apiKeys = aGuardar.apiKeys.map(k => String(k || '').trim()).filter(Boolean);
            aGuardar.apiKey = aGuardar.apiKeys[0];
        } else {
            delete aGuardar.apiKeys;
        }
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(aGuardar, null, 2));
        return true;
    } catch (e) {
        console.error('❌ [GEMINI] No pude guardar gemini-config.json:', e.message);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
// 🏳️ PRONOMBRES
// ═══════════════════════════════════════════════════════════════
function construirInstruccionPronombre() {
    const p = String(geminiCfg.pronombre || 'ella').toLowerCase();
    if (p === 'el') return 'Refiérete a él en masculino siempre.';
    if (p === 'elle') return 'Refiérete a elle con lenguaje neutro (elle, su, les, terminaciones en -e).';
    if (p === 'personalizado') {
        const custom = String(geminiCfg.pronombrePersonalizado || '').trim();
        if (custom) return `Refiérete a la streamer así: ${custom}.`;
    }
    return 'Refiérete a ella en femenino siempre.';
}

// ═══════════════════════════════════════════════════════════════
// 🎤 ETAPA 2.5 — MEMORIA DE VOZ
// ═══════════════════════════════════════════════════════════════
function cargarMemoriaVoz() {
    try {
        if (!fs.existsSync(MEMORIA_VOZ_PATH)) {
            return { activa: false, entradas: [] };
        }
        const raw = fs.readFileSync(MEMORIA_VOZ_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            activa: !!parsed.activa,
            entradas: Array.isArray(parsed.entradas) ? parsed.entradas : []
        };
    } catch (e) {
        console.error('❌ [GEMINI] No pude leer memoria-voz.json:', e.message);
        return { activa: false, entradas: [] };
    }
}

function guardarMemoriaVozAhora(mem) {
    try {
        fs.mkdirSync(USER_DATA_DIR, { recursive: true });
        if (mem.entradas.length > MEMORIA_VOZ_MAX_ENTRADAS) {
            mem.entradas = mem.entradas.slice(-MEMORIA_VOZ_MAX_ENTRADAS);
        }
        fs.writeFileSync(MEMORIA_VOZ_PATH, JSON.stringify(mem, null, 2));
        return true;
    } catch (e) {
        console.error('❌ [GEMINI] No pude guardar memoria-voz.json:', e.message);
        return false;
    }
}

let ioRef = null;
let ws = null;
let activo = false;
let configRef = null;
let geminiCfg = cargarConfig();

let resumptionHandle = null;
let reconectando = false;
let setupCompleto = false;
let ultimoAudioOut = null;

let modoActual = geminiCfg.modo || 'normal';

// 📋 Etapa 2 — Buffer de chat
let bufferChat = [];
let timerResetBuffer = null;

// 🎤 Etapa 2.5 — Memoria de voz
let memoriaVoz = cargarMemoriaVoz();
let bufTransUser = '';
let bufTransModel = '';
let timerGuardarMemoria = null;

// 🛡️ Modo guardia
let modoGuardia = false;
let contadorChatB = 0;
let ultimoMensajeChatTs = 0;
let ultimoAutonomoTs = 0;
let timerGuardiaC = null;

// 🔄 Reset programado de sesión
let timerResetSesion = null;

// 🔁 Anti-duplicado
const DEDUP_MS = 1500;
let ultimoMensajeChat = { clave: '', ts: 0 };

// 🔑 Pool de keys (runtime)
let apiKeysPool = [];
let poolIndex = 0;
let fallosEnCiclo = 0;

// 🎤 Audio OBS — cuántas páginas de audio conectadas
let clientesAudio = 0;

function obtenerKeyActual() {
    if (!apiKeysPool.length) return '';
    return apiKeysPool[poolIndex % apiKeysPool.length];
}

function rotarKey() {
    if (apiKeysPool.length <= 1) return false;
    fallosEnCiclo++;
    if (fallosEnCiclo >= apiKeysPool.length) {
        console.log('🔑 [GEMINI] Todas las keys fallaron. Deteniendo.');
        return false;
    }
    poolIndex = (poolIndex + 1) % apiKeysPool.length;
    console.log(`🔑 [GEMINI] Rotando a key ${poolIndex + 1}/${apiKeysPool.length}`);
    return true;
}

function resetearPool() {
    fallosEnCiclo = 0;
}

function esCodigoRotarKey(err) {
    if (!err) return false;
    const codigo = typeof err.code === 'number' ? err.code : null;
    if (codigo && CODIGOS_ROTAR_KEY.includes(codigo)) return true;
    const msg = String(err.message || '').toUpperCase();
    if (msg.includes('RESOURCE_EXHAUSTED')) return true;
    if (msg.includes('UNAUTHENTICATED')) return true;
    if (msg.includes('PERMISSION_DENIED')) return true;
    if (msg.includes('API_KEY_INVALID')) return true;
    if (msg.includes('QUOTA')) return true;
    return false;
}

function agendarGuardarMemoria() {
    if (timerGuardarMemoria) clearTimeout(timerGuardarMemoria);
    timerGuardarMemoria = setTimeout(() => {
        timerGuardarMemoria = null;
        guardarMemoriaVozAhora(memoriaVoz);
    }, MEMORIA_VOZ_DEBOUNCE_MS);
}

// ═══════════════════════════════════════════════════════════════
// 📤 EXPORTS PARA ETAPA 3 (consumidos por gemini-text)
// ═══════════════════════════════════════════════════════════════
function obtenerBufferChat() {
    return bufferChat.slice();
}

function obtenerTranscripcionVoz() {
    if (!memoriaVoz || !Array.isArray(memoriaVoz.entradas)) return '';
    const ultimas = memoriaVoz.entradas
        .filter(e => e && e.rol === 'user' && e.texto)
        .slice(-10)
        .map(e => e.texto)
        .join('\n');
    return ultimas;
}

// ═══════════════════════════════════════════════════════════════
// 🔄 RESET PROGRAMADO DE SESIÓN
// ═══════════════════════════════════════════════════════════════
function cancelarResetSesion() {
    if (timerResetSesion) {
        clearTimeout(timerResetSesion);
        timerResetSesion = null;
    }
}

function programarResetSesion() {
    cancelarResetSesion();
    if (!activo) return;

    timerResetSesion = setTimeout(() => {
        timerResetSesion = null;
        if (!activo) return;
        console.log(`🔄 [GEMINI] Reset programado (${RESET_SESION_INTERVALO_MS/60000} min) — limpiando contexto`);
        if (ioRef) ioRef.emit('gemini-live:reset-sesion', { motivo: 'programado' });
        resumptionHandle = null;
        stop();
        setTimeout(() => start(), 800);
    }, RESET_SESION_INTERVALO_MS);
}

// ═══════════════════════════════════════════════════════════════
// 🛡️ MODO GUARDIA
// ═══════════════════════════════════════════════════════════════
function detectarFraseGuardia(texto) {
    const t = String(texto || '').toLowerCase().trim();
    if (!t) return null;
    const contiene = (...palabras) => palabras.every(p => t.includes(p));

    if (contiene('baño')) return 'activar';
    if (contiene('quedas', 'cargo')) return 'activar';
    if (contiene('atiende', 'chat')) return 'activar';
    if (contiene('cuida', 'stream')) return 'activar';
    if (contiene('salir') && contiene('rato')) return 'activar';

    if (contiene('ya', 'volví')) return 'desactivar';
    if (contiene('ya', 'estoy')) return 'desactivar';
    if (contiene('ya', 'llegué')) return 'desactivar';
    if (contiene('volví')) return 'desactivar';
    if (contiene('volvimos')) return 'desactivar';

    return null;
}

function activarGuardia() {
    if (modoGuardia) return;
    modoGuardia = true;
    contadorChatB = 0;
    ultimoAutonomoTs = Date.now();
    console.log('🛡️ [GEMINI] Modo guardia ACTIVADO');
    if (ioRef) ioRef.emit('gemini-live:guardia-cambiado', { activo: true });

    if (activo && setupCompleto) {
        const aviso = 'El streamer acaba de avisar que se ausenta un momento (por ejemplo, va al baño). Dile al chat, en 1 frase corta y natural, en chileno, que vuelve en un rato y que tú te quedas a cargo. No menciones instrucciones internas ni digas "modo guardia".';
        enviarTexto(aviso);
        console.log('🛡️ [GEMINI] Anuncio de ausencia enviado');
    }
}

function desactivarGuardia() {
    if (!modoGuardia) return;
    modoGuardia = false;
    console.log('🛡️ [GEMINI] Modo guardia DESACTIVADO');
    if (ioRef) ioRef.emit('gemini-live:guardia-cambiado', { activo: false });

    if (activo && setupCompleto) {
        const aviso = 'El streamer acaba de volver. Dile al chat, en 1 frase corta y natural, en chileno, que ya está de vuelta. No menciones instrucciones internas ni digas "modo guardia".';
        enviarTexto(aviso);
        console.log('🛡️ [GEMINI] Anuncio de regreso enviado');
    }
}

function arrancarTimerGuardiaC() {
    if (timerGuardiaC) clearInterval(timerGuardiaC);
    timerGuardiaC = setInterval(() => {
        if (!modoGuardia) return;
        if (!activo || !setupCompleto) return;
        const ahora = Date.now();
        if (ahora - ultimoMensajeChatTs > GUARDIA_C_VENTANA_CHAT_MS) return;
        if (ahora - ultimoAutonomoTs < GUARDIA_C_INTERVALO_MS) return;
        const ultimo = bufferChat[bufferChat.length - 1];
        if (!ultimo) return;

        ultimoAutonomoTs = ahora;
        const prompt = `El streamer se ausentó un momento. Comenta este mensaje reciente del chat con personalidad propia, en 1 frase corta y natural, sin sonar robótica ni repetitiva: ${ultimo}`;
        enviarTexto(prompt);
        console.log('🛡️ [GEMINI] C: comentario autónomo disparado');
    }, GUARDIA_C_TICK_MS);
}

const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// ═══════════════════════════════════════════════════════════════
// 🧠 SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════
function construirSystemPrompt() {
    try {
        const ai = (configRef && configRef.aiCohost) || {};
        const nombre = ai.nombre || 'Togi';
        const personalidad = ai.personalidad || 'Eres amable, breve y respondes en español.';
        const instruccionPronombre = construirInstruccionPronombre();

        return [
            `Te llamas ${nombre}.`,
            personalidad,
            '',
            'ACENTO POR DEFECTO (muy importante):',
            '- Hablas SIEMPRE con acento y modismos CHILENOS.',
            '- Usa expresiones chilenas naturales: "bacán", "al tiro", "harto", "fome", "la raja", "cuático", "piola", "carrete", "pololo", "cabro", "guagua", "luca".',
            '- Usa entonación chilena natural, pero SIN repetir muletillas.',
            '- PROHIBIDO usar "cachai", "¿cachai?", "¿me entendís?", "po" ni "weón" más de UNA VEZ cada 5 respuestas. La mayoría de las respuestas NO deben llevar ninguna de esas palabras.',
            '- NUNCA uses modismos mexicanos, argentinos, españoles ni de otro país (salvo que te lo pidan explícitamente).',
            '',
            'CAMBIO DE ACENTO A PETICIÓN:',
            '- Si alguien te pide hablar con otro acento, CÁMBIALO al instante y mantén ese cambio hasta que te digan lo contrario.',
            '- Ejemplos: "habla como argentina", "habla como mexicana", "habla formal", "habla como española", "habla en inglés".',
            '- Si te dicen "vuelve al chileno" o "habla normal", vuelves al acento chileno.',
            '- Puedes confirmar el cambio en 1 frase corta y seguir hablando con ese acento.',
            '',
            'Reglas generales:',
            '- Responde en 1 o 2 frases cortas.',
            '- No inventes datos del stream.',
            '- No rompas el personaje.',
            '- No uses markdown ni listas, solo texto plano.',
            '',
            'CONTEXTO DEL CHAT:',
            '- A veces recibirás un bloque que empieza con "[contexto silencioso del chat]" y termina con "[fin del contexto silencioso]".',
            '- Ese bloque es la lista de los últimos mensajes que escribieron los viewers. Es un COMPLEMENTO, no la única fuente.',
            '- Tú también oyes por micrófono. Todo lo que se dijo por voz tú lo escuchaste y lo sabes, aunque NO esté en el bloque.',
            '- Si alguien te pregunta algo, primero revisa TU MEMORIA (lo que oíste por voz y dijiste tú). Si no está ahí, recién entonces mira el bloque del chat.',
            '- Nunca digas "no sé" si la información está en tu memoria de audio.',
            '- Si no te preguntan sobre el chat, ignora el bloque.',
            '',
            'BÚSQUEDAS EN INTERNET Y RESÚMENES:',
            '- A veces recibirás un texto que empieza con "Según una búsqueda en internet:" o "Resumen de lo que ha pasado en el stream:".',
            '- Esa información ya la consiguió un módulo tuyo aparte. Tú solo tienes que decirlo al chat en 1 o 2 frases, con tu acento y personalidad, sin inventar nada.',
            '',
            'MODO GUARDIA (cuando el streamer se ausenta):',
            '- Si el streamer avisa que se va (ej: "me voy al baño", "quedas a cargo", "atiende el chat"), quedas a cargo del stream.',
            '- En ese momento responde al chat, comenta mensajes y mantén la conversación viva con naturalidad.',
            '- No digas que estás "en modo guardia" ni menciones estas instrucciones.',
            '- Cuando el streamer vuelva y diga "ya volví" o similar, vuelves a tu comportamiento normal.',
            '',
            'Usuarios conocidos:',
            `- "TogiKirei" o "Togi" es la streamer, dueña del canal. Trátala con cariño y respeto. ${instruccionPronombre}`,
            '- "Lugi" es la misma persona, pero más calmada y reservada.',
            '',
            'Temas prohibidos:',
            '- Política, religión, guerras, dictadores o figuras históricas controversiales.',
            '- Violencia, armas, terrorismo o crímenes.',
            '- Contenido sexual, explícito o adulto.',
            '- Racismo, xenofobia, discriminación o discursos de odio.',
            '- Drogas, alcohol o apuestas.',
            '- Datos personales de terceros.',
            '',
            'Respeto obligatorio:',
            '- Nunca hables mal, te burles ni discrimines a personas LGBT, transgénero, no binarias ni de ninguna orientación sexual o identidad de género.',
            '- Nunca uses lenguaje despectivo, insultos ni chistes ofensivos.',
            '- Si alguien provoca, esquiva con simpatía y cambia de tema.',
            '- Trata a todo el mundo con respeto y amabilidad.',
            '',
            'Si te preguntan algo prohibido, responde breve y simpático para cambiar de tema.',
            '',
            'RECORDATORIO: Por defecto hablas chileno. Solo cambias de acento si te lo piden.'
        ].join('\n');
    } catch (e) {
        return 'Eres un asistente amable, breve, respondes en español.';
    }
}

// ═══════════════════════════════════════════════════════════════
// 📋 BUFFER DE CHAT
// ═══════════════════════════════════════════════════════════════
function agregarAlBuffer(usuario, texto, plataforma) {
    if (!texto || !usuario) return;
    const plataformaNorm = String(plataforma || 'twitch').toLowerCase();
    const linea = `[${plataformaNorm}] ${usuario}: ${texto}`;

    if (bufferChat.length > 0 && bufferChat[bufferChat.length - 1] === linea) return;

    bufferChat.push(linea);
    if (bufferChat.length > BUFFER_MAX) bufferChat.shift();
}

function resetearBuffer() {
    if (bufferChat.length > 0) {
        console.log(`📋 [GEMINI] Buffer de chat reseteado (tenía ${bufferChat.length} mensajes)`);
    }
    bufferChat = [];
}

function arrancarTimerResetBuffer() {
    if (timerResetBuffer) clearInterval(timerResetBuffer);
    timerResetBuffer = setInterval(() => resetearBuffer(), BUFFER_RESET_MS);
}

function construirContextoChat() {
    if (bufferChat.length === 0) return '';
    return `[contexto silencioso del chat]\n${bufferChat.join('\n')}\n[fin del contexto silencioso]`;
}

// ═══════════════════════════════════════════════════════════════
// 🔌 INIT
// ═══════════════════════════════════════════════════════════════
function init(io, configGlobal) {
    ioRef = io;
    configRef = configGlobal;

    arrancarTimerResetBuffer();
    arrancarTimerGuardiaC();

    io.on('connection', (socket) => {
        socket.emit('gemini-live:status', {
            activo, reconectando,
            modo: modoActual,
            memoriaVoz: memoriaVoz.activa,
            guardia: modoGuardia,
            keysEnPool: apiKeysPool.length || (geminiCfg.apiKeys ? geminiCfg.apiKeys.length : 0),
            keyActual: poolIndex + 1,
            pronombre: geminiCfg.pronombre,
            clientesAudio
        });

        socket.on('gemini-live:start', async () => {
            const r = await start();
            socket.emit('gemini-live:start-result', r);
            if (r.ok && ioRef) ioRef.emit('gemini-live:audio-estado', { activo: true });
        });

        socket.on('gemini-live:stop', () => {
            stop();
            socket.emit('gemini-live:stop-result', { ok: true });
            if (ioRef) ioRef.emit('gemini-live:audio-estado', { activo: false });
        });

        // 🎤 Puente panel → página de audio (OBS)
        socket.on('gemini-audio:request-start', () => {
            console.log('🎤 [GEMINI] Panel pidió activar captura de audio');
            if (ioRef) ioRef.emit('gemini-audio:start-captura');
        });

        socket.on('gemini-audio:request-stop', () => {
            console.log('🎤 [GEMINI] Panel pidió detener captura de audio');
            if (ioRef) ioRef.emit('gemini-audio:stop-captura');
        });

        // 🎤 Página de audio avisa que arrancó/paró captura
        socket.on('gemini-audio:captura-activa', ({ activo: on } = {}) => {
            if (ioRef) ioRef.emit('gemini-live:audio-estado', { activo: !!on });
        });

        // 🎤 Página de audio se identifica al conectar
        socket.on('gemini-audio:hello', () => {
            clientesAudio++;
            console.log(`🎤 [GEMINI] Página de audio conectada (total: ${clientesAudio})`);
            if (ioRef) ioRef.emit('gemini-live:clientes-audio', { total: clientesAudio });
        });

        socket.on('disconnect', () => {
            if (clientesAudio > 0) clientesAudio = Math.max(0, clientesAudio - 1);
            if (ioRef) ioRef.emit('gemini-live:clientes-audio', { total: clientesAudio });
        });

        socket.on('gemini-live:audio-input', (payload) => enviarAudio(payload && payload.data));

        socket.on('gemini-live:keyword-detected', () => {
            if (ioRef) ioRef.emit('gemini-live:listening', { ts: Date.now() });
        });

        socket.on('gemini-live:set-modo', async ({ modo } = {}) => await cambiarModo(modo, socket));

        socket.on('gemini-live:resumen', () => console.log('📋 [GEMINI] Resumen solicitado (usar panel gemini-text)'));

        socket.on('gemini-live:olvidar-stream', () => {
            console.log('🧹 [GEMINI] Olvidar stream solicitado');
            resetearBuffer();
            memoriaVoz.entradas = [];
            guardarMemoriaVozAhora(memoriaVoz);
            if (ioRef) ioRef.emit('gemini-live:memoria-voz-limpiada', { alcance: 'stream' });
        });

        socket.on('gemini-live:olvidar-todo', () => {
            console.log('💣 [GEMINI] Olvidar todo solicitado');
            resetearBuffer();
            memoriaVoz = { activa: memoriaVoz.activa, entradas: [] };
            guardarMemoriaVozAhora(memoriaVoz);
            if (ioRef) ioRef.emit('gemini-live:memoria-voz-limpiada', { alcance: 'todo' });
        });

        socket.on('gemini-live:guardia-set', ({ activo: on } = {}) => {
            if (on) activarGuardia();
            else desactivarGuardia();
            socket.emit('gemini-live:guardia-cambiado', { activo: modoGuardia });
        });

        socket.on('gemini-live:keys-get', () => {
            socket.emit('gemini-live:keys-estado', {
                total: apiKeysPool.length,
                actual: poolIndex + 1,
                fallos: fallosEnCiclo
            });
        });

        socket.on('gemini-live:keys-rotar-manual', () => {
            const ok = rotarKey();
            if (ok && activo) {
                const v = ws; ws = null; activo = false;
                if (v) { try { v.close(); } catch (e) {} }
                setTimeout(() => start(), 300);
            }
            socket.emit('gemini-live:keys-estado', {
                total: apiKeysPool.length,
                actual: poolIndex + 1,
                fallos: fallosEnCiclo
            });
        });

        socket.on('gemini-live:reset-sesion-manual', () => {
            if (!activo) return;
            console.log('🔄 [GEMINI] Reset manual solicitado');
            resumptionHandle = null;
            stop();
            setTimeout(() => start(), 300);
        });

        socket.on('gemini-live:memoria-voz-get', () => {
            socket.emit('gemini-live:memoria-voz-estado', {
                activa: memoriaVoz.activa,
                total: memoriaVoz.entradas.length,
                entradas: memoriaVoz.entradas.slice(-50)
            });
        });

        socket.on('gemini-live:memoria-voz-toggle', async ({ activa } = {}) => {
            const nuevo = (typeof activa === 'boolean') ? activa : !memoriaVoz.activa;
            memoriaVoz.activa = nuevo;
            guardarMemoriaVozAhora(memoriaVoz);
            console.log(`🎤 [GEMINI] Memoria de voz: ${nuevo ? 'ON' : 'OFF'}`);

            if (ioRef) ioRef.emit('gemini-live:memoria-voz-estado', {
                activa: memoriaVoz.activa,
                total: memoriaVoz.entradas.length,
                entradas: memoriaVoz.entradas.slice(-50)
            });

            if (activo) {
                console.log('🎤 [GEMINI] Reconectando para aplicar cambio de transcripción…');
                stop();
                setTimeout(() => start(), 800);
            }
        });

        socket.on('gemini-live:memoria-voz-limpiar', () => {
            console.log('🎤 [GEMINI] Memoria de voz limpiada');
            memoriaVoz.entradas = [];
            guardarMemoriaVozAhora(memoriaVoz);
            if (ioRef) ioRef.emit('gemini-live:memoria-voz-estado', {
                activa: memoriaVoz.activa,
                total: 0,
                entradas: []
            });
        });
    });

    console.log(`🤖 [GEMINI] Módulo listo. Keys: ${geminiCfg.apiKeys ? geminiCfg.apiKeys.length : 0} | Voz: ${geminiCfg.voz} | Modelo: ${geminiCfg.modelo} | Modo: ${modoActual} | Pronombre: ${geminiCfg.pronombre}`);
    console.log(`📋 [GEMINI] Buffer: max ${BUFFER_MAX} | reset cada ${BUFFER_RESET_MS/60000} min`);
    console.log(`🔄 [GEMINI] Reset de sesión programado cada ${RESET_SESION_INTERVALO_MS/60000} min (limpia contexto acumulado)`);
    console.log(`🎤 [GEMINI] Memoria de voz: ${memoriaVoz.activa ? 'ON' : 'OFF'} | entradas guardadas: ${memoriaVoz.entradas.length}`);
    console.log(`🛡️ [GEMINI] Modo guardia listo`);
    console.log(`🔑 [GEMINI] Pool de keys: ${geminiCfg.apiKeys ? geminiCfg.apiKeys.length : 0} disponibles`);
    console.log(`📚 [GEMINI] Comandos: ${COMANDO_BUSCA} <query> | ${COMANDO_RESUMEN}`);
    console.log(`🎙️ [GEMINI] Página de audio OBS: http://localhost:3000/gemini-audio.html`);
}

// ═══════════════════════════════════════════════════════════════
// 🎛️ MODOS
// ═══════════════════════════════════════════════════════════════
async function cambiarModo(nuevoModo, socket) {
    if (!MODOS_VALIDOS.includes(nuevoModo)) {
        if (socket) socket.emit('gemini-live:modo-cambiado', { modo: modoActual, error: 'Modo inválido' });
        return;
    }

    const modoAnterior = modoActual;
    modoActual = nuevoModo;
    geminiCfg.modo = nuevoModo;
    guardarConfig(geminiCfg);
    console.log(`🎛️ [GEMINI] Modo: ${modoAnterior} → ${nuevoModo}`);

    if (ioRef) ioRef.emit('gemini-live:modo-cambiado', { modo: nuevoModo });

    if (nuevoModo === 'autonomo' && !activo) {
        if (!geminiCfg.apiKeys || geminiCfg.apiKeys.length === 0) {
            if (socket) socket.emit('gemini-live:aviso', { texto: 'Modo guardado. Falta API key.' });
            return;
        }
        await start();
    }

    if (activo && setupCompleto) {
        const frases = {
            normal:   'Listo, modo normal.',
            silencio: 'Listo, modo silencio.',
            autonomo: 'Modo autónomo activado. Respondo al chat.'
        };
        const frase = frases[nuevoModo];
        if (frase) enviarTexto(`Responde SOLO con esta frase exacta, sin agregar nada más: "${frase}"`);
    }
}

// ═══════════════════════════════════════════════════════════════
// 🔌 START / STOP / RECONNECT
// ═══════════════════════════════════════════════════════════════
async function start() {
    if (activo) return { ok: true, msg: 'Ya activo' };
    geminiCfg = cargarConfig();

    apiKeysPool = Array.isArray(geminiCfg.apiKeys) ? geminiCfg.apiKeys.slice() : [];
    if (apiKeysPool.length === 0 && geminiCfg.apiKey) apiKeysPool = [geminiCfg.apiKey];
    if (apiKeysPool.length === 0) {
        return { ok: false, error: 'No hay API keys configuradas' };
    }
    if (poolIndex >= apiKeysPool.length) poolIndex = 0;

    const key = obtenerKeyActual();
    const url = `${WS_BASE}?key=${encodeURIComponent(key)}`;
    console.log(`🔌 [GEMINI] Conectando con key ${poolIndex + 1}/${apiKeysPool.length}...`);

    let miWs;
    try {
        miWs = new WebSocket(url);
    } catch (e) {
        return { ok: false, error: 'No pude crear WebSocket: ' + e.message };
    }
    ws = miWs;

    const timeoutApertura = setTimeout(() => {
        if (ws !== miWs) return;
        if (setupCompleto) return;
        console.log('🔑 [GEMINI] Timeout abriendo WS — rotando key');
        const puedeRotar = rotarKey();
        activo = false;
        ws = null;
        try { miWs.terminate(); } catch (e) {}
        if (puedeRotar) {
            setTimeout(() => start(), 300);
        } else {
            if (ioRef) ioRef.emit('gemini-live:error', { message: 'Todas las keys fallaron' });
        }
    }, TIMEOUT_APERTURA_WS_MS);

    miWs.on('open', () => {
        if (ws !== miWs) return;
        clearTimeout(timeoutApertura);
        console.log('✅ [GEMINI] WebSocket abierto. Enviando setup...');
        enviarSetup();
    });

    miWs.on('message', (raw) => {
        if (ws !== miWs) return;
        try {
            const msg = JSON.parse(raw.toString());
            manejarMensaje(msg, miWs, timeoutApertura);
        } catch (e) {
            console.error('❌ [GEMINI] Mensaje inválido:', e.message);
        }
    });

    miWs.on('close', (code) => {
        clearTimeout(timeoutApertura);
        if (ws !== miWs) {
            console.log(`🔌 [GEMINI] Cerrado socket viejo (código ${code}) — ignorado`);
            return;
        }
        console.log(`🔌 [GEMINI] Cerrado (código ${code})`);
        setupCompleto = false;
        if (activo && !reconectando) reconectar();
    });

    miWs.on('error', (err) => {
        if (ws !== miWs) return;
        console.error('❌ [GEMINI] Error WS:', err.message);
    });

    activo = true;
    if (ioRef) ioRef.emit('gemini-live:status', {
        activo, reconectando: false, modo: modoActual,
        memoriaVoz: memoriaVoz.activa, guardia: modoGuardia,
        keysEnPool: apiKeysPool.length, keyActual: poolIndex + 1,
        pronombre: geminiCfg.pronombre, clientesAudio
    });

    programarResetSesion();

    return { ok: true, key: poolIndex + 1, totalKeys: apiKeysPool.length };
}

function enviarSetup() {
    const setup = {
        setup: {
            model: geminiCfg.modelo || DEFAULTS.modelo,
            generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: geminiCfg.voz || 'Aoede' }
                    }
                },
                thinkingConfig: { thinkingLevel: 'minimal' }
            },
            realtimeInputConfig: {
                automaticActivityDetection: {
                    startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
                    endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
                    prefixPaddingMs: 50,
                    silenceDurationMs: 250
                },
                activityHandling: 'NO_INTERRUPTION'
            },
            systemInstruction: {
                parts: [{ text: construirSystemPrompt() }]
            },
            inputAudioTranscription: {}
        }
    };

    if (memoriaVoz.activa) setup.setup.outputAudioTranscription = {};

    if (resumptionHandle && typeof resumptionHandle === 'string' && resumptionHandle.length > 0) {
        setup.setup.sessionResumption = { handle: resumptionHandle };
        console.log('🔌 [GEMINI] Reanudando sesión con handle previo');
    }

    ws.send(JSON.stringify(setup));
    console.log('📤 [GEMINI] Setup enviado. Voz:', geminiCfg.voz, '| Modelo:', geminiCfg.modelo, '| Modo:', modoActual, '| MemVoz:', memoriaVoz.activa ? 'ON' : 'OFF', '| Pronombre:', geminiCfg.pronombre);
}

function manejarMensaje(msg, miWs, timeoutApertura) {
    if (msg.setupComplete) {
        clearTimeout(timeoutApertura);
        setupCompleto = true;
        resetearPool();
        console.log(`✅ [GEMINI] Setup completo. Sesión lista con key ${poolIndex + 1}/${apiKeysPool.length}.`);
        if (ioRef) ioRef.emit('gemini-live:ready', { voz: geminiCfg.voz, modo: modoActual });
        return;
    }

    if (msg.sessionResumptionUpdate && msg.sessionResumptionUpdate.newHandle) {
        resumptionHandle = msg.sessionResumptionUpdate.newHandle;
        return;
    }

    if (msg.goAway) {
        const ms = parseInt(msg.goAway.timeLeft || '0', 10) || 0;
        console.log(`⏳ [GEMINI] GoAway. Reconectando en ~${Math.round(ms/1000)}s`);
        return;
    }

    if (msg.serverContent) {
        const sc = msg.serverContent;

        if (sc.inputTranscription && sc.inputTranscription.text) {
            bufTransUser += sc.inputTranscription.text;
            if (ioRef) ioRef.emit('gemini-live:transcripcion', { rol: 'user', texto: bufTransUser, final: false });
        }

        if (memoriaVoz.activa && sc.outputTranscription && sc.outputTranscription.text) {
            bufTransModel += sc.outputTranscription.text;
            if (ioRef) ioRef.emit('gemini-live:transcripcion', { rol: 'model', texto: bufTransModel, final: false });
        }

        if (sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
            for (const part of sc.modelTurn.parts) {
                if (part.inlineData && part.inlineData.data) {
                    ultimoAudioOut = Date.now();
                    if (ioRef) {
                        ioRef.emit('gemini-live:audio-output', {
                            data: part.inlineData.data,
                            mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000'
                        });
                    }
                }
                if (part.text) console.log('💬 [GEMINI texto]:', part.text);
            }
        }

        if (sc.turnComplete) {
            const textoUsuario = bufTransUser.trim();
            if (textoUsuario) {
                const accion = detectarFraseGuardia(textoUsuario);
                if (accion === 'activar') {
                    console.log(`🛡️ [GEMINI] Frase detectada: "${textoUsuario}"`);
                    activarGuardia();
                } else if (accion === 'desactivar') {
                    console.log(`🛡️ [GEMINI] Frase detectada: "${textoUsuario}"`);
                    desactivarGuardia();
                }
            }

            if (memoriaVoz.activa) {
                const ts = Date.now();
                let guardado = false;
                if (bufTransUser.trim()) {
                    memoriaVoz.entradas.push({ ts, rol: 'user', texto: bufTransUser.trim() });
                    guardado = true;
                }
                if (bufTransModel.trim()) {
                    memoriaVoz.entradas.push({ ts, rol: 'model', texto: bufTransModel.trim() });
                    guardado = true;
                }
                if (guardado) {
                    agendarGuardarMemoria();
                    if (ioRef) ioRef.emit('gemini-live:transcripcion', { rol: 'turno', texto: '', final: true });
                    console.log(`🎤 [GEMINI] Turno guardado. Total entradas: ${memoriaVoz.entradas.length}`);
                }
            }
            bufTransUser = '';
            bufTransModel = '';
            if (ioRef) ioRef.emit('gemini-live:turn-complete', { ts: Date.now() });
        }
        return;
    }

    if (msg.error) {
        console.error('❌ [GEMINI API]', JSON.stringify(msg.error));

        if (esCodigoRotarKey(msg.error)) {
            const puedeRotar = rotarKey();
            if (puedeRotar) {
                console.log(`🔑 [GEMINI] Error de key — rotando y reconectando`);
                activo = false;
                const v = ws; ws = null;
                if (v) { try { v.close(); } catch (e) {} }
                setTimeout(() => start(), 500);
                return;
            } else {
                console.log('🔑 [GEMINI] Todas las keys fallaron');
            }
        }

        if (ioRef) ioRef.emit('gemini-live:error', msg.error);
    }
}

function stop() {
    cancelarResetSesion();
    activo = false;
    reconectando = false;
    setupCompleto = false;
    resumptionHandle = null;
    bufTransUser = '';
    bufTransModel = '';
    const viejo = ws;
    ws = null;
    if (viejo) { try { viejo.close(); } catch (e) {} }
    if (ioRef) ioRef.emit('gemini-live:status', {
        activo: false, reconectando: false, modo: modoActual,
        memoriaVoz: memoriaVoz.activa, guardia: modoGuardia,
        keysEnPool: apiKeysPool.length, keyActual: poolIndex + 1,
        pronombre: geminiCfg.pronombre, clientesAudio
    });
    console.log('⏹️ [GEMINI] Sesión detenida');
}

function reconectar() {
    if (reconectando) return;
    reconectando = true;
    if (ioRef) ioRef.emit('gemini-live:status', {
        activo, reconectando: true, modo: modoActual,
        memoriaVoz: memoriaVoz.activa, guardia: modoGuardia,
        keysEnPool: apiKeysPool.length, keyActual: poolIndex + 1,
        pronombre: geminiCfg.pronombre, clientesAudio
    });

    setTimeout(async () => {
        reconectando = false;
        if (!activo) return;
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log('🔌 [GEMINI] Ya hay WS abierto, salto reconexión');
            return;
        }
        if (ws) { try { ws.terminate(); } catch (e) {} ws = null; }
        await start();
    }, 1500);
}

// ═══════════════════════════════════════════════════════════════
// 🎤 ENVÍO DE AUDIO Y TEXTO
// ═══════════════════════════════════════════════════════════════
function enviarAudio(base64Data) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !setupCompleto) return;
    if (!base64Data) return;
    if (modoActual === 'silencio') return;
    const payload = {
        realtimeInput: {
            audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        }
    };
    try { ws.send(JSON.stringify(payload)); } catch (e) {}
}

function enviarTexto(texto) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !setupCompleto) return false;
    if (!texto) return false;
    const payload = { realtimeInput: { text: String(texto) } };
    try { ws.send(JSON.stringify(payload)); return true; } catch (e) { return false; }
}

function enviarTextoConContexto(texto) {
    const contexto = construirContextoChat();
    if (!contexto) return enviarTexto(texto);
    return enviarTexto(`${contexto}\n\n${texto}`);
}

// ═══════════════════════════════════════════════════════════════
// 📚 ETAPA 3 — COMANDOS !busca y !resumen
// ═══════════════════════════════════════════════════════════════
async function manejarComandoBusca(usuario, pregunta) {
    console.log(`🔍 [GEMINI] !busca de ${usuario}: ${pregunta}`);
    try {
        const geminiText = require('./gemini-text');
        const r = await geminiText.buscar(pregunta);
        if (!r || !r.ok) {
            console.warn(`🔍 [GEMINI] Búsqueda falló: ${r ? r.error : '(sin respuesta)'}`);
            return;
        }
        const respuesta = String(r.respuesta || '').trim();
        if (!respuesta) return;

        if (!activo) {
            const sr = await start();
            if (!sr.ok) {
                console.warn('🔍 [GEMINI] No pude arrancar Live para responder búsqueda');
                return;
            }
        }

        const intento = setInterval(() => {
            if (setupCompleto) {
                clearInterval(intento);
                enviarTexto(
                    `El usuario ${usuario} pidió una búsqueda sobre: "${pregunta}". ` +
                    `Según una búsqueda en internet: ${respuesta}. ` +
                    `Dilo al chat en 1 o 2 frases cortas, en chileno, con naturalidad.`
                );
                console.log('🔍 [GEMINI] Respuesta de búsqueda enviada a Live');
            }
        }, 200);
        setTimeout(() => clearInterval(intento), 8000);
    } catch (e) {
        console.error('❌ [GEMINI] Error en !busca:', e.message);
    }
}

async function manejarComandoResumen(usuario) {
    console.log(`📝 [GEMINI] !resumen de ${usuario}`);
    try {
        const geminiText = require('./gemini-text');
        const buffer = bufferChat.slice();
        const voz = obtenerTranscripcionVoz();
        const r = await geminiText.generarResumen(buffer, voz);
        if (!r) {
            console.warn('📝 [GEMINI] Resumen vacío');
            return;
        }

        if (!activo) {
            const sr = await start();
            if (!sr.ok) return;
        }

        const intento = setInterval(() => {
            if (setupCompleto) {
                clearInterval(intento);
                enviarTexto(
                    `Resumen de lo que ha pasado en el stream: ${r}. ` +
                    `Dilo al chat en 2 frases cortas, en chileno, con naturalidad.`
                );
                console.log('📝 [GEMINI] Resumen enviado a Live');
            }
        }, 200);
        setTimeout(() => clearInterval(intento), 8000);
    } catch (e) {
        console.error('❌ [GEMINI] Error en !resumen:', e.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// 💬 PROCESAMIENTO DE CHAT
// ═══════════════════════════════════════════════════════════════
function procesarComandoChat(usuario, texto, plataforma, canal) {
    const claveDedup = `${String(plataforma || '').toLowerCase()}|${String(usuario || '').toLowerCase()}|${String(texto || '').trim()}`;
    const ahora = Date.now();
    if (claveDedup === ultimoMensajeChat.clave && (ahora - ultimoMensajeChat.ts) < DEDUP_MS) {
        console.log(`🔁 [GEMINI] Duplicado ignorado: ${usuario}: ${texto}`);
        return false;
    }
    ultimoMensajeChat = { clave: claveDedup, ts: ahora };
    ultimoMensajeChatTs = ahora;
    agregarAlBuffer(usuario, texto, plataforma);

    const tRaw = String(texto || '').trim();
    const tLow = tRaw.toLowerCase();

    if (tLow.startsWith(COMANDO_BUSCA + ' ') || tLow === COMANDO_BUSCA) {
        const query = tRaw.slice(COMANDO_BUSCA.length).trim();
        if (query) {
            manejarComandoBusca(usuario, query);
        } else {
            console.log('🔍 [GEMINI] !busca sin query');
        }
        return true;
    }

    if (tLow === COMANDO_RESUMEN || tLow.startsWith(COMANDO_RESUMEN + ' ')) {
        manejarComandoResumen(usuario);
        return true;
    }

    if (modoActual === 'silencio') return true;

    if (modoGuardia) {
        const comandoG = (geminiCfg.comandoChat || '!voz').toLowerCase();
        const t0 = tLow;
        if (!t0.startsWith(comandoG)) {
            contadorChatB++;
            if (contadorChatB >= GUARDIA_B_CADA) {
                contadorChatB = 0;
                const prompt = `Estás a cargo del stream. Responde brevemente y con personalidad a este mensaje del chat, en 1 frase: ${usuario} dice: ${texto}`;
                if (activo && setupCompleto) {
                    enviarTextoConContexto(prompt);
                    console.log(`🛡️ [GEMINI] B: respondiendo a ${usuario}`);
                } else if (!activo) {
                    start().then((r) => {
                        if (r.ok) {
                            const intento = setInterval(() => {
                                if (setupCompleto) {
                                    clearInterval(intento);
                                    enviarTextoConContexto(prompt);
                                }
                            }, 200);
                            setTimeout(() => clearInterval(intento), 8000);
                        }
                    });
                }
            }
        }
    }

    if (modoActual === 'autonomo') {
        if (!texto || String(texto).trim().length === 0) return false;
        const textoEnvio = `${usuario} dice: ${texto}`;
        if (!activo) {
            start().then((r) => {
                if (r.ok) {
                    const intento = setInterval(() => {
                        if (setupCompleto) {
                            clearInterval(intento);
                            enviarTextoConContexto(textoEnvio);
                        }
                    }, 200);
                    setTimeout(() => clearInterval(intento), 8000);
                }
            });
        } else {
            enviarTextoConContexto(textoEnvio);
        }
        console.log(`🤖 [GEMINI autónomo] ${usuario}: ${texto}`);
        return true;
    }

    geminiCfg = cargarConfig();
    const comando = (geminiCfg.comandoChat || '!voz').toLowerCase();
    const t = tLow;
    if (!t.startsWith(comando)) return false;

    const pregunta = String(texto).slice(comando.length).trim();
    if (!pregunta) return true;

    const textoEnvio = `${usuario} pregunta: ${pregunta}`;
    if (!activo) {
        start().then((r) => {
            if (r.ok) {
                const intento = setInterval(() => {
                    if (setupCompleto) {
                        clearInterval(intento);
                        enviarTextoConContexto(textoEnvio);
                    }
                }, 200);
                setTimeout(() => clearInterval(intento), 8000);
            }
        });
    } else {
        enviarTextoConContexto(textoEnvio);
    }
    console.log(`💬 [GEMINI normal] Chat → ${usuario}: ${pregunta}`);
    return true;
}

// ═══════════════════════════════════════════════════════════════
// 📊 ESTADO
// ═══════════════════════════════════════════════════════════════
function estado() {
    return {
        activo, reconectando, setupCompleto,
        modo: modoActual,
        voz: geminiCfg.voz,
        comandoChat: geminiCfg.comandoChat,
        palabraClave: geminiCfg.palabraClave,
        modelo: geminiCfg.modelo,
        pronombre: geminiCfg.pronombre,
        pronombrePersonalizado: geminiCfg.pronombrePersonalizado,
        tieneKey: !!(geminiCfg.apiKeys && geminiCfg.apiKeys.length),
        keysEnPool: apiKeysPool.length,
        keyActual: poolIndex + 1,
        fallosEnCiclo,
        ultimoAudioOut,
        bufferChat: bufferChat.length,
        memoriaVoz: memoriaVoz.activa,
        memoriaVozEntradas: memoriaVoz.entradas.length,
        guardia: modoGuardia,
        resetSesionIntervaloMs: RESET_SESION_INTERVALO_MS,
        clientesAudio
    };
}

module.exports = {
    init, start, stop, estado,
    enviarAudio, enviarTexto, procesarComandoChat,
    cargarConfig, guardarConfig, CONFIG_PATH, MEMORIA_VOZ_PATH,
    obtenerBufferChat,
    obtenerTranscripcionVoz
};