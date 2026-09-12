// extras/ai-key-pool.js
// Pool de proveedores de IA con rotación y cooldowns.
// Proveedores: Groq (principal), Cerebras (respaldo 1), OpenRouter (respaldo 2).

const PROVEEDORES_BASE = {
  groq: {
    id: 'groq',
    nombre: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    modelo: 'openai/gpt-oss-20b',
    prioridad: 1,
    timeoutMs: 15000,
    apiKey: '',
    cooldownHasta: 0,
    estado: 'sin-key', // sin-key | lista | cooldown | invalida
    fallosSeguidos: 0,
    headersExtra: {}
  },
  cerebras: {
    id: 'cerebras',
    nombre: 'Cerebras',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    modelo: 'llama3.1-8b',
    prioridad: 2,
    timeoutMs: 20000,
    apiKey: '',
    cooldownHasta: 0,
    estado: 'sin-key',
    fallosSeguidos: 0,
    headersExtra: {}
  },
  openrouter: {
    id: 'openrouter',
    nombre: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    modelo: 'meta-llama/llama-3.1-8b-instruct:free',
    prioridad: 3,
    timeoutMs: 20000,
    apiKey: '',
    cooldownHasta: 0,
    estado: 'sin-key',
    fallosSeguidos: 0,
    headersExtra: {
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'TogiPanel AI Co-Host'
    }
  }
};

// --- estado interno ---
let proveedores = {};

function clonarBase() {
  const copia = {};
  for (const id in PROVEEDORES_BASE) {
    const base = PROVEEDORES_BASE[id];
    copia[id] = {
      ...base,
      headersExtra: { ...(base.headersExtra || {}) }
    };
  }
  return copia;
}

// --- cargar keys desde config ---
function cargarProveedores(config) {
  proveedores = clonarBase();

  const cfg = (config && config.aiCohost && config.aiCohost.proveedores) || {};

  for (const id in proveedores) {
    const entrada = cfg[id];
    if (entrada && typeof entrada.apiKey === 'string' && entrada.apiKey.trim() !== '') {
      proveedores[id].apiKey = entrada.apiKey.trim();
      proveedores[id].estado = 'lista';
    }
    if (entrada && entrada.modelo) {
      proveedores[id].modelo = entrada.modelo;
    }
  }

  return estadoProveedores();
}

// --- estado para pintar en el panel ---
function estadoProveedores() {
  const salida = {};
  for (const id in proveedores) {
    const p = proveedores[id];
    const enCooldown = p.cooldownHasta > Date.now();
    salida[id] = {
      id: p.id,
      nombre: p.nombre,
      modelo: p.modelo,
      estado: enCooldown ? 'cooldown' : p.estado,
      cooldownRestanteMs: enCooldown ? p.cooldownHasta - Date.now() : 0
    };
  }
  return salida;
}

// --- cooldown exponencial ---
function marcarFallo(id, motivo) {
  const p = proveedores[id];
  if (!p) return;

  if (motivo === 'invalida') {
    p.estado = 'invalida';
    return;
  }

  p.fallosSeguidos += 1;

  const escalones = [60_000, 300_000, 900_000, 3_600_000]; // 1m, 5m, 15m, 1h
  const idx = Math.min(p.fallosSeguidos - 1, escalones.length - 1);
  p.cooldownHasta = Date.now() + escalones[idx];
  p.estado = 'cooldown';
}

function marcarExito(id) {
  const p = proveedores[id];
  if (!p) return;
  p.fallosSeguidos = 0;
  p.cooldownHasta = 0;
  p.estado = 'lista';
}

// --- elegir proveedor disponible ---
function proveedoresDisponibles() {
  const ahora = Date.now();
  return Object.values(proveedores)
    .filter(p => p.apiKey && p.estado !== 'invalida' && p.cooldownHasta <= ahora)
    .sort((a, b) => a.prioridad - b.prioridad);
}

// --- detectar tipo de error ---
function clasificarError(status) {
  if (status === 401 || status === 403) return 'invalida';
  if (status === 429) return 'rate-limit';
  if (status === 404) return 'modelo-invalido';
  if (status >= 500) return 'servidor';
  return 'otro';
}

// --- petición a un proveedor concreto ---
async function pedirAProveedor(p, mensajes) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), p.timeoutMs);

  try {
    const resp = await fetch(p.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${p.apiKey}`,
        ...(p.headersExtra || {})
      },
      body: JSON.stringify({
        model: p.modelo,
        messages: mensajes,
        temperature: 0.8,
        max_tokens: 200
      }),
      signal: controlador.signal
    });

    clearTimeout(timer);

    if (!resp.ok) {
      const cuerpo = await resp.text().catch(() => '');
      const tipo = clasificarError(resp.status);
      return { ok: false, proveedor: p.id, motivo: tipo, status: resp.status, cuerpo };
    }

    const data = await resp.json();
    const texto = data?.choices?.[0]?.message?.content?.trim();

    if (!texto) {
      return { ok: false, proveedor: p.id, motivo: 'vacio' };
    }

    return { ok: true, proveedor: p.id, texto };

  } catch (err) {
    clearTimeout(timer);
    const motivo = err.name === 'AbortError' ? 'timeout' : 'red';
    return { ok: false, proveedor: p.id, motivo, detalle: err.message };
  }
}

// --- función principal: pedir con rotación ---
async function pedir(mensajes) {
  const disponibles = proveedoresDisponibles();

  if (disponibles.length === 0) {
    return { ok: false, motivo: 'sin-proveedores' };
  }

  for (const p of disponibles) {
    const r = await pedirAProveedor(p, mensajes);

    if (r.ok) {
      marcarExito(p.id);
      return r;
    }

    console.log('Fallo proveedor:', r);

    if (r.motivo === 'invalida' || r.motivo === 'modelo-invalido') {
      marcarFallo(p.id, 'invalida');
    } else {
      marcarFallo(p.id, r.motivo);
    }
  }

  return { ok: false, motivo: 'todos-fallaron' };
}

// --- probar una key concreta (para el botón "Probar") ---
async function probarKey(proveedorId, apiKeyManual) {
  const base = PROVEEDORES_BASE[proveedorId];
  if (!base) return { ok: false, error: 'proveedor-desconocido' };

  const temporal = { ...base, apiKey: (apiKeyManual || '').trim() };
  if (!temporal.apiKey) return { ok: false, error: 'sin-key' };

  const r = await pedirAProveedor(temporal, [
    { role: 'user', content: 'Responde solo: ok' }
  ]);

  if (r.ok) {
    return { ok: true, modelo: temporal.modelo, respuesta: r.texto };
  }
  return { ok: false, error: r.motivo, status: r.status, detalle: r.detalle, cuerpo: r.cuerpo };
}

module.exports = {
  cargarProveedores,
  estadoProveedores,
  pedir,
  probarKey
};