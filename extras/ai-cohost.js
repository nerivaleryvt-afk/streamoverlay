// extras/ai-cohost.js
// Lógica del AI Co-Host: personalidad, invocación desde chat, memoria corta, filtros.

const pool = require('./ai-key-pool');

// --- memoria a corto plazo (últimos N mensajes del chat) ---
const MAX_MEMORIA = 60;   // ← Subido de 25 a 60
let memoria = []; // [{ usuario, texto }]

// --- contador de actividad por usuario ---
const actividadUsuarios = new Map(); // usuario -> { conteo, ultimaVez }
const UMBRAL_FRECUENTE = 3;
const TIEMPO_OLVIDO_MS = 30 * 60 * 1000;

function agregarAlaMemoria(usuario, texto, config) {
  memoria.push({ usuario, texto });
  if (memoria.length > MAX_MEMORIA) {
    memoria.shift();
  }

  // El nombre del bot se lee de config (en vez de estar hardcodeado)
  const nombreBot = (config && config.aiCohost && config.aiCohost.nombre) || 'Guía';

  if (usuario && usuario !== nombreBot) {
    const ahora = Date.now();
    const prev = actividadUsuarios.get(usuario);
    if (prev && (ahora - prev.ultimaVez) < TIEMPO_OLVIDO_MS) {
      prev.conteo += 1;
      prev.ultimaVez = ahora;
    } else {
      actividadUsuarios.set(usuario, { conteo: 1, ultimaVez: ahora });
    }
  }
}

function limpiarMemoria() {
  memoria = [];
  actividadUsuarios.clear();
}

function limpiarUsuariosViejos() {
  const ahora = Date.now();
  for (const [usuario, info] of actividadUsuarios.entries()) {
    if ((ahora - info.ultimaVez) > TIEMPO_OLVIDO_MS) {
      actividadUsuarios.delete(usuario);
    }
  }
}

function esUsuarioFrecuente(usuario) {
  const info = actividadUsuarios.get(usuario);
  if (!info) return false;
  return info.conteo >= UMBRAL_FRECUENTE;
}

function getConteoUsuario(usuario) {
  const info = actividadUsuarios.get(usuario);
  return info ? info.conteo : 0;
}

// --- construir el system prompt con la personalidad ---
function construirSystemPrompt(config) {
  const ai = (config && config.aiCohost) || {};
  const nombre = ai.nombre || 'Guía';
  const personalidad = ai.personalidad || 'Eres amable, breve y respondes en español.';

  return [
    `Te llamas ${nombre}.`,
    personalidad,
    'Reglas:',
    '- Responde en 1 o 2 frases cortas.',
    '- No inventes datos del stream (viewers, donaciones, etc.).',
    '- No rompas el personaje.',
    '- No uses markdown ni listas, solo texto plano.',
    '- Si no sabes algo, dilo con naturalidad.',
    '',
    'Usuarios conocidos:',
    '- "TogiKirei" o "Togi" es la streamer, dueña del canal. Es una chica trans. Trátala con cariño y respeto, refiérete a ella en femenino siempre. Es tu amiga y creadora. Togi es más proactiva, enérgica y hacia el público.',
    '- "Lugi" es la misma persona que Togi, pero con otra vibra: más calmada y reservada. Cuando uses el nombre Lugi, trátala también en femenino y con cariño, pero adapta tu tono a esa versión más tranquila.',
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
    '- Nunca uses lenguaje despectivo, insultos ni chistes ofensivos hacia ningún colectivo, etnia, religión, género o condición.',
    '- Si alguien intenta provocarte para que hables mal de un colectivo, esquiva el tema con simpatía y cambia de conversación.',
    '- Trata a todo el mundo con respeto y amabilidad, sin excepciones.',
    '',
    'Si alguien pregunta sobre alguno de estos temas prohibidos, responde algo breve y simpático para cambiar de tema, sin entrar en detalles. Por ejemplo: "Mejor hablemos de cosas más alegres 😊" o "Eso es muy serio para este chat, ¿y si hablamos de algo divertido?".'
  ].join('\n');
}

// --- construir contexto a partir de la memoria ---
function construirContexto(usuarioActual) {
  const partes = [];

  if (memoria.length > 0) {
    const lineas = memoria.map(m => `${m.usuario}: ${m.texto}`).join('\n');
    partes.push(`Contexto del chat (mensajes recientes, el último es el más nuevo):\n${lineas}`);
  }

  if (usuarioActual) {
    const conteo = getConteoUsuario(usuarioActual);
    if (conteo >= UMBRAL_FRECUENTE) {
      partes.push(`Nota: ${usuarioActual} es un usuario frecuente del chat (ha hablado ${conteo} veces en los últimos 30 minutos). Puedes saludarlo con familiaridad si viene al caso, pero no lo fuerces.`);
    } else if (conteo > 0) {
      partes.push(`Nota: ${usuarioActual} ha hablado ${conteo} vez/veces recientemente.`);
    }
  }

  if (partes.length === 0) return null;

  return {
    role: 'system',
    content: partes.join('\n\n')
  };
}

// --- detectar si debe responder ---
function debeResponder(mensaje, config) {
  const ai = (config && config.aiCohost) || {};
  if (!ai.enabled) return false;

  const texto = (mensaje.texto || '').toLowerCase();
  const nombre = (ai.nombre || '').toLowerCase();
  const comando = (ai.comando || '!guia').toLowerCase();

  if (comando && texto.includes(comando)) return true;
  if (nombre && texto.includes('@' + nombre)) return true;

  return false;
}

// --- extraer la pregunta limpia ---
function extraerPregunta(mensaje, config) {
  const ai = (config && config.aiCohost) || {};
  let texto = mensaje.texto || '';

  const comando = ai.comando || '!guia';
  const nombre = ai.nombre || '';

  const reComando = new RegExp(comando.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  texto = texto.replace(reComando, '');

  if (nombre) {
    const reNombre = new RegExp('@' + nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    texto = texto.replace(reNombre, '');
  }

  return texto.trim();
}

// --- función principal ---
async function responder(mensaje, config) {
  const pregunta = extraerPregunta(mensaje, config);

  if (!pregunta) {
    return { ok: false, motivo: 'sin-pregunta' };
  }

  agregarAlaMemoria(mensaje.usuario || 'alguien', pregunta, config);

  const mensajes = [
    { role: 'system', content: construirSystemPrompt(config) }
  ];

  const contexto = construirContexto(mensaje.usuario);
  if (contexto) mensajes.push(contexto);

  mensajes.push({ role: 'user', content: pregunta });

  const r = await pool.pedir(mensajes);

  if (r.ok) {
    agregarAlaMemoria(config?.aiCohost?.nombre || 'Guía', r.texto, config);
    return { ok: true, texto: r.texto, proveedor: r.proveedor };
  }

  return { ok: false, motivo: r.motivo };
}

module.exports = {
  debeResponder,
  extraerPregunta,
  responder,
  agregarAlaMemoria,
  limpiarMemoria,
  limpiarUsuariosViejos,
  esUsuarioFrecuente,
  getConteoUsuario
};