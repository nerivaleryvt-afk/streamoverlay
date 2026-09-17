/* ═══════════════════════════════════════════════════════════════
   gemini-live-client.js — Cliente de CONTROL (sin audio)
   El audio se captura y reproduce en gemini-audio.html (OBS)
   ═══════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    const SERVER = (window.SERVER_BASE || window.location.origin);
    const socket = io(SERVER, { transports: ['websocket', 'polling'] });

    let estado = 'idle';
    let modoActual = 'normal';

    let armadoOlvidarTodo = false;
    let timerArmadoOlvidarTodo = null;
    let memVozActiva = false;

    function actualizarUI() {
        const btn = document.getElementById('geminiLiveBtn');
        const lbl = document.getElementById('geminiLiveLabel');
        if (btn && lbl) {
            btn.classList.remove('active');
            if (estado === 'active') {
                btn.classList.add('active');
                lbl.textContent = 'IA escuchando… (clic para parar)';
            } else {
                lbl.textContent = 'Activar IA';
            }
        }
    }

    function pintarModo(modo) {
        modoActual = modo;
        const textos = { normal: 'Normal', silencio: 'Silencio', autonomo: 'Autónomo' };
        const indicador = document.getElementById('modoActual');
        if (indicador) indicador.textContent = textos[modo] || modo;

        const botones = {
            normal:   document.getElementById('btnModoNormal'),
            silencio: document.getElementById('btnModoSilencio'),
            autonomo: document.getElementById('btnModoAuto')
        };
        for (const [k, el] of Object.entries(botones)) {
            if (!el) continue;
            el.classList.toggle('activo', k === modo);
        }
    }

    function toast(msg, tipo) {
        if (typeof window.geminiToast === 'function') window.geminiToast(msg, tipo);
        else console.log('[toast]', msg);
    }

    function cambiarModo(nuevoModo) {
        if (!['normal', 'silencio', 'autonomo'].includes(nuevoModo)) return;
        pintarModo(nuevoModo);
        socket.emit('gemini-live:set-modo', { modo: nuevoModo });
    }

    function pedirResumen() {
        socket.emit('gemini-live:resumen');
        toast('Pidiendo resumen…', 'ok');
    }

    function olvidarStream() {
        socket.emit('gemini-live:olvidar-stream');
        toast('Stream actual olvidado', 'ok');
    }

    function olvidarTodo() {
        if (!armadoOlvidarTodo) {
            armadoOlvidarTodo = true;
            const btn = document.getElementById('btnOlvidarTodo');
            if (btn) btn.classList.add('armado');
            toast('Pulsa otra vez en 3 s para confirmar', 'err');
            timerArmadoOlvidarTodo = setTimeout(() => {
                armadoOlvidarTodo = false;
                if (btn) btn.classList.remove('armado');
            }, 3000);
            return;
        }
        if (timerArmadoOlvidarTodo) {
            clearTimeout(timerArmadoOlvidarTodo);
            timerArmadoOlvidarTodo = null;
        }
        armadoOlvidarTodo = false;
        const btn = document.getElementById('btnOlvidarTodo');
        if (btn) btn.classList.remove('armado');
        socket.emit('gemini-live:olvidar-todo');
        toast('Olvidando todo…', 'err');
    }

    function toggle() {
        if (estado === 'idle') {
            socket.emit('gemini-live:start');
            socket.emit('gemini-audio:request-start');
        } else {
            socket.emit('gemini-audio:request-stop');
            socket.emit('gemini-live:stop');
        }
    }

    function setMemoriaVoz(activa) {
        socket.emit('gemini-live:memoria-voz-toggle', { activa: !!activa });
        memVozActiva = !!activa;
    }

    function pedirMemoriaVoz() {
        socket.emit('gemini-live:memoria-voz-get');
    }

    function limpiarMemoriaVoz() {
        socket.emit('gemini-live:memoria-voz-limpiar');
    }

    function pintarMemVozUI(activa) {
        if (window.geminiLiveMemVoz && typeof window.geminiLiveMemVoz.pintarToggle === 'function') {
            window.geminiLiveMemVoz.pintarToggle(activa);
        }
    }

    socket.on('gemini-live:ready', () => console.log('🔊 Gemini listo'));

    socket.on('gemini-live:error', (err) => console.error('❌ Error Gemini:', err));

    socket.on('gemini-live:modo-cambiado', ({ modo }) => pintarModo(modo));

    socket.on('gemini-live:audio-estado', ({ activo: on }) => {
        estado = on ? 'active' : 'idle';
        actualizarUI();
    });

    socket.on('gemini-live:memoria-voz-estado', (payload) => {
        if (!payload) return;
        memVozActiva = !!payload.activa;
        pintarMemVozUI(memVozActiva);
        if (window.geminiLiveMemVoz && typeof window.geminiLiveMemVoz.render === 'function') {
            window.geminiLiveMemVoz.render(payload.entradas || []);
        }
    });

    socket.on('gemini-live:transcripcion', (payload) => {
        if (!payload) return;
        if (payload.final) pedirMemoriaVoz();
    });

    socket.on('gemini-live:memoria-voz-limpiada', () => pedirMemoriaVoz());

    socket.on('gemini-live:status', (payload) => {
        if (!payload) return;
        if (typeof payload.activo === 'boolean') {
            estado = payload.activo ? 'active' : 'idle';
            actualizarUI();
        }
        if (typeof payload.memoriaVoz === 'boolean') {
            memVozActiva = payload.memoriaVoz;
            pintarMemVozUI(memVozActiva);
        }
        if (typeof payload.modo === 'string') pintarModo(payload.modo);
    });

    function conectarBoton() {
        const btn = document.getElementById('geminiLiveBtn');
        if (btn) btn.addEventListener('click', toggle);

        const bNormal = document.getElementById('btnModoNormal');
        const bSilen = document.getElementById('btnModoSilencio');
        const bAuto  = document.getElementById('btnModoAuto');
        if (bNormal) bNormal.addEventListener('click', () => cambiarModo('normal'));
        if (bSilen)  bSilen.addEventListener('click',  () => cambiarModo('silencio'));
        if (bAuto)   bAuto.addEventListener('click',   () => cambiarModo('autonomo'));

        const bRes   = document.getElementById('btnResumen');
        const bOls   = document.getElementById('btnOlvidarStream');
        const bOlt   = document.getElementById('btnOlvidarTodo');
        if (bRes) bRes.addEventListener('click', pedirResumen);
        if (bOls) bOls.addEventListener('click', olvidarStream);
        if (bOlt) bOlt.addEventListener('click', olvidarTodo);

        actualizarUI();
        pintarModo(modoActual);
    }

    window.geminiLiveClient = {
        toggle,
        cambiarModo,
        getEstado: () => estado,
        getModo:   () => modoActual,
        setMemoriaVoz,
        pedirMemoriaVoz,
        limpiarMemoriaVoz
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', conectarBoton);
    } else {
        conectarBoton();
    }

    console.log('🎤 [gemini-live-client] Cargado (modo control)');
})();