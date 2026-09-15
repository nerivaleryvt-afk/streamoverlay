/* ═══════════════════════════════════════════════════════════════
   config-ai.js — Sub-página del AI Co-Host + proveedores
   Depende de: shared.js (window.Togi), config-ui.js (modales)
   No contiene: lógica de guardado (eso vive en config-main.js)
   ═══════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────
   SUB-PÁGINA: ABRIR / CERRAR
   ────────────────────────────────────────────── */
function abrirAsistente() {
    const mainConfig = document.getElementById('mainConfig');
    const aiSubpage = document.getElementById('aiSubpage');
    if (!mainConfig || !aiSubpage) return;
    mainConfig.classList.add('hidden');
    aiSubpage.classList.add('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    actualizarEstadosProveedores();
}

function cerrarAsistente() {
    const mainConfig = document.getElementById('mainConfig');
    const aiSubpage = document.getElementById('aiSubpage');
    if (!mainConfig || !aiSubpage) return;
    aiSubpage.classList.remove('open');
    mainConfig.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function guardarAsistenteYVolver() {
    cerrarAsistente();
    // saveConfig vive en config-main.js
    if (typeof saveConfig === 'function') {
        saveConfig();
    }
}

/* ──────────────────────────────────────────────
   PROBAR API KEY
   ────────────────────────────────────────────── */
async function probarKey(proveedor, btn) {
    const mapInput = {
        groq: 'aiKeyGroq',
        cerebras: 'aiKeyCerebras',
        openrouter: 'aiKeyOpenRouter',
        agnes: 'aiKeyAgnes'
    };
    const mapResult = {
        groq: 'testResultGroq',
        cerebras: 'testResultCerebras',
        openrouter: 'testResultOpenRouter',
        agnes: 'testResultAgnes'
    };

    const input = document.getElementById(mapInput[proveedor]);
    const resultEl = document.getElementById(mapResult[proveedor]);
    if (!input || !resultEl) return;

    const apiKey = input.value.trim();

    if (!apiKey || apiKey === '••••••••') {
        resultEl.className = 'test-result fail show';
        resultEl.textContent = '⚠️ Pega primero la API Key.';
        return;
    }

    if (btn) btn.disabled = true;
    resultEl.className = 'test-result';
    resultEl.textContent = '';

    try {
        const resp = await fetch(`${window.SERVER_BASE}/api/ai/test-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proveedor, apiKey })
        });
        const data = await resp.json();

        const esc = (window.Togi && Togi.escapeHtml) ? Togi.escapeHtml : (s => s || '');

        if (data.ok) {
            resultEl.className = 'test-result ok show';
            resultEl.innerHTML = '✅ Key válida. Modelo: <b>' + esc(data.modelo) + '</b>. Respuesta: "' + esc(data.respuesta) + '"';
        } else {
            const motivo = data.error || data.motivo || 'desconocido';
            let extra = '';
            if (motivo === 'invalida') extra = ' → La key no es válida o fue revocada.';
            else if (motivo === 'modelo-invalido') extra = ' → El modelo por defecto no está disponible para esta cuenta.';
            else if (motivo === 'timeout') extra = ' → El proveedor tardó demasiado.';
            else if (motivo === 'red') extra = ' → No se pudo conectar (revisa tu internet).';
            resultEl.className = 'test-result fail show';
            resultEl.textContent = '❌ Error: ' + motivo + extra;
        }
    } catch (e) {
        resultEl.className = 'test-result fail show';
        resultEl.textContent = '❌ Error de conexión con el servidor local: ' + e.message;
    } finally {
        if (btn) btn.disabled = false;
    }
}

/* ──────────────────────────────────────────────
   ESTADO DE PROVEEDORES (badge de cada uno)
   ────────────────────────────────────────────── */
async function actualizarEstadosProveedores() {
    try {
        const resp = await fetch(`${window.SERVER_BASE}/api/ai/status`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.ok || !data.proveedores) return;

        const mapStatus = {
            groq: 'statusGroq',
            cerebras: 'statusCerebras',
            openrouter: 'statusOpenRouter',
            agnes: 'statusAgnes'
        };
        const labels = {
            'sin-key': 'sin key',
            'lista': 'lista',
            'cooldown': 'cooldown',
            'invalida': 'inválida'
        };
        const icons = {
            'sin-key': 'ri-circle-fill',
            'lista': 'ri-checkbox-circle-fill',
            'cooldown': 'ri-time-fill',
            'invalida': 'ri-close-circle-fill'
        };

        for (const [id, elId] of Object.entries(mapStatus)) {
            const el = document.getElementById(elId);
            if (!el) continue;
            const info = data.proveedores[id];
            if (!info) continue;
            const estado = info.estado || 'sin-key';
            el.className = 'provider-status ' + estado;
            el.innerHTML = '<i class="' + (icons[estado] || 'ri-circle-fill') + '" style="font-size:10px"></i> ' + (labels[estado] || estado);
        }
    } catch (e) {
        // silencioso
    }
}

console.log('🤖 config-ai.js cargado');