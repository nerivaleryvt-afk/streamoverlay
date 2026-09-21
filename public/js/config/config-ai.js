/* ═══════════════════════════════════════════════════════════════
   config-ai.js — AI Co-Host + Kick (OAuth + Editor de stream)
   Depende de: shared.js (window.Togi), config-ui.js (modales)
   ═══════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────
   SUB-PÁGINA AI: ABRIR / CERRAR
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
    if (typeof saveConfig === 'function') saveConfig();
}

/* ──────────────────────────────────────────────
   PROBAR API KEY (AI)
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

/* ═══════════════════════════════════════════════════════════════
   🟢 KICK — Login embebido + Editor de stream
   ═══════════════════════════════════════════════════════════════ */

function escapeHtmlKick(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

async function kickCargarEstado() {
    const badge = document.getElementById('kickStatusBadge');
    const info = document.getElementById('kickStatusInfo');
    const editorDisabled = document.getElementById('kickEditorDisabled');
    const editor = document.getElementById('kickEditor');
    const btnConnect = document.getElementById('btnKickConnect');
    const btnDisconnect = document.getElementById('btnKickDisconnect');

    if (!badge || !info) return;

    try {
        const r = await fetch(`${window.SERVER_BASE}/api/kick/status`);
        const data = await r.json();

        if (data.connected) {
            badge.className = 'provider-priority';
            badge.style.background = 'rgba(83, 252, 24, 0.12)';
            badge.style.color = '#53fc18';
            badge.style.borderColor = 'rgba(83, 252, 24, 0.4)';
            badge.textContent = 'conectado';

            const titlePreview = data.preview?.title ? ` — <i>"${escapeHtmlKick(data.preview.title)}"</i>` : '';
            info.className = 'test-result ok show';
            info.innerHTML = `✅ Conectado como <b>${escapeHtmlKick(data.username || '?')}</b>${titlePreview}`;
            if (btnConnect) btnConnect.disabled = true;
            if (btnDisconnect) btnDisconnect.disabled = false;

            if (editorDisabled) editorDisabled.style.display = 'none';
            if (editor) editor.style.display = 'block';
            kickRecargarStreamInfo();
        } else {
            badge.className = 'provider-priority';
            badge.style.background = '';
            badge.style.color = '';
            badge.style.borderColor = '';
            badge.textContent = 'no conectado';

            info.className = 'test-result fail show';
            info.textContent = data.reason || 'Sin cuenta conectada. Pulsa "Conectar con Kick".';
            if (btnConnect) btnConnect.disabled = false;
            if (btnDisconnect) btnDisconnect.disabled = true;

            if (editorDisabled) editorDisabled.style.display = 'block';
            if (editor) editor.style.display = 'none';
        }
    } catch (e) {
        badge.textContent = 'error';
        info.className = 'test-result fail show';
        info.textContent = 'No se pudo consultar el estado: ' + e.message;
    }
}

async function kickConectarEmbedded() {
    const info = document.getElementById('kickStatusInfo');
    const btn = document.getElementById('btnKickConnect');

    if (typeof require === 'undefined') {
        info.className = 'test-result fail show';
        info.textContent = '❌ Esta función solo funciona dentro de la app de escritorio.';
        return;
    }

    if (btn) btn.disabled = true;
    info.className = 'test-result';
    info.textContent = '🪟 Abriendo ventana de Kick… Inicia sesión y espera unos segundos.';

    try {
        const { ipcRenderer } = require('electron');
        const result = await ipcRenderer.invoke('kick:open-login');

        if (result && result.ok) {
            info.className = 'test-result ok show';
            info.innerHTML = `✅ Conectado como <b>${escapeHtmlKick(result.username || 'togikirei')}</b>. Ya puedes editar tu stream.`;
            setTimeout(() => kickCargarEstado(), 500);
        } else {
            info.className = 'test-result fail show';
            info.textContent = '❌ ' + (result?.error || 'No se pudo capturar la sesión.');
            if (btn) btn.disabled = false;
        }
    } catch (e) {
        info.className = 'test-result fail show';
        info.textContent = '❌ Error abriendo la ventana de Kick: ' + e.message;
        if (btn) btn.disabled = false;
    }
}

async function kickDesconectar() {
    if (!confirm('¿Desconectar la cuenta de Kick? Tendrás que volver a iniciar sesión.')) return;

    const info = document.getElementById('kickStatusInfo');

    try {
        // 1. Borrar cookies del server
        await fetch(`${window.SERVER_BASE}/api/kick/set-cookies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cookies: '', sessionToken: '', username: '' })
        });

        // 2. Borrar cookies de la partición de Electron
        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            await ipcRenderer.invoke('kick:logout');
        }

        info.className = 'test-result';
        info.textContent = '🔌 Desconectado.';
        setTimeout(() => kickCargarEstado(), 300);
    } catch (e) {
        info.className = 'test-result fail show';
        info.textContent = '❌ Error desconectando: ' + e.message;
    }
}

let _kickSelectedCategoryId = null;

async function kickRecargarStreamInfo() {
    try {
        const r = await fetch(`${window.SERVER_BASE}/api/kick/stream-info`);
        const data = await r.json();
        if (!data.ok) return;

        const titleEl = document.getElementById('kickTitle');
        if (titleEl) {
            titleEl.value = data.title || '';
            kickActualizarContador();
        }

        const catNameEl = document.getElementById('kickCategoryName');
        const catSelectedEl = document.getElementById('kickCategorySelected');
        if (data.categoryId && catNameEl) {
            _kickSelectedCategoryId = data.categoryId;
            catNameEl.textContent = data.categoryName || ('ID ' + data.categoryId);
            if (catSelectedEl) catSelectedEl.style.display = 'flex';
        }
    } catch (e) {
        console.error('Error recargando stream info:', e);
    }
}

function kickActualizarContador() {
    const input = document.getElementById('kickTitle');
    const counter = document.getElementById('kickTitleCounter');
    if (!input || !counter) return;
    counter.textContent = `${input.value.length} / 100`;
}

async function kickBuscarCategoria(q) {
    const box = document.getElementById('kickCategoryResults');
    if (!box) return;

    q = (q || '').trim();
    if (q.length < 2) {
        box.innerHTML = '';
        return;
    }

    try {
        const r = await fetch(`${window.SERVER_BASE}/api/kick/categories?q=${encodeURIComponent(q)}`);
        const data = await r.json();

        if (!data.ok || !Array.isArray(data.results) || data.results.length === 0) {
            box.innerHTML = '<div class="field-help"><i class="ri-information-line"></i> Sin resultados. Prueba otro término.</div>';
            return;
        }

        box.innerHTML = data.results.map(c => {
            const name = escapeHtmlKick(c.name || c.id);
            const thumb = c.thumbnail || c.box_art_url || '';
            return `<div class="multi-row" style="cursor:pointer;" onclick="kickElegirCategoria(${c.id}, '${name.replace(/'/g, "\\'")}')">
                ${thumb ? `<img src="${thumb}" style="width:32px;height:32px;border-radius:6px;object-fit:cover;">` : ''}
                <input type="text" value="${name}" readonly style="cursor:pointer; pointer-events:none;">
                <button class="remove-item-btn" type="button" tabindex="-1" style="pointer-events:none;"><i class="ri-arrow-right-line"></i></button>
            </div>`;
        }).join('');
    } catch (e) {
        box.innerHTML = '<div class="test-result fail show">Error: ' + escapeHtmlKick(e.message) + '</div>';
    }
}

function kickElegirCategoria(id, name) {
    _kickSelectedCategoryId = id;
    document.getElementById('kickCategoryResults').innerHTML = '';
    document.getElementById('kickCategorySearch').value = name;
    const catNameEl = document.getElementById('kickCategoryName');
    const catSelectedEl = document.getElementById('kickCategorySelected');
    if (catNameEl) catNameEl.textContent = name;
    if (catSelectedEl) catSelectedEl.style.display = 'flex';
}

async function kickAplicarCambios() {
    const result = document.getElementById('kickApplyResult');
    const btn = document.getElementById('btnKickApply');
    const title = (document.getElementById('kickTitle')?.value || '').trim();
    const categoryId = _kickSelectedCategoryId;

    if (!title && !categoryId) {
        result.className = 'test-result fail show';
        result.textContent = '⚠️ Nada que actualizar. Rellena el título o elige una categoría.';
        return;
    }

    if (btn) btn.disabled = true;
    result.className = 'test-result';
    result.textContent = '';

    try {
        const r = await fetch(`${window.SERVER_BASE}/api/kick/stream-info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: title || undefined,
                categoryId: categoryId || undefined
            })
        });
        const data = await r.json();

        if (data.ok) {
            result.className = 'test-result ok show';
            result.innerHTML = '✅ Actualizado correctamente en Kick.';
        } else {
            result.className = 'test-result fail show';
            result.textContent = '❌ ' + (data.error || 'Error desconocido');
        }
    } catch (e) {
        result.className = 'test-result fail show';
        result.textContent = '❌ Error de conexión: ' + e.message;
    } finally {
        if (btn) btn.disabled = false;
    }
}

window.kickCargarEstado = kickCargarEstado;

console.log('🤖 config-ai.js cargado (Kick: login embebido)');