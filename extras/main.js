// ================================================================
// main.js - Lanzador Electron con soporte para TikTok (Login QR + Captura)
// ================================================================
const { app, BrowserWindow, shell, ipcMain, session } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ================================================================
// 🔥 DETECCIÓN DE RUTAS (Dev vs Producción)
// ================================================================
const isPackaged = app.isPackaged;

const extrasPath = isPackaged
    ? path.join(process.resourcesPath, 'extras')
    : path.join(__dirname, 'extras');

// 📦 En prod, la config vive en userData (con permisos de escritura)
const userDataDir = app.getPath('userData');
const configPath = isPackaged
    ? path.join(userDataDir, 'config.json')
    : path.join(__dirname, 'config.json');

// 📦 setup.json (respuesta del usuario: modo servidor o modo cliente)
const setupPath = isPackaged
    ? path.join(userDataDir, 'setup.json')
    : path.join(__dirname, 'setup.json');

console.log(`📂 Modo: ${isPackaged ? 'PRODUCCIÓN' : 'DESARROLLO'}`);
console.log(`📂 Extras: ${extrasPath}`);
console.log(`📂 Config: ${configPath}`);
console.log(`📂 UserData: ${userDataDir}`);
console.log(`📂 Setup: ${setupPath}`);

// 📦 Si es prod y no existe la config en userData, la copiamos del paquete
if (isPackaged && !fs.existsSync(configPath)) {
    const defaultConfig = path.join(extrasPath, 'config.json');
    if (fs.existsSync(defaultConfig)) {
        try {
            fs.copyFileSync(defaultConfig, configPath);
            console.log('📋 Config inicial copiada a userData');
        } catch (e) {
            console.error('❌ No se pudo copiar config.json:', e.message);
        }
    }
}

// 🛑 LEER CONFIGURACIÓN
let config = {};
try {
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } else if (fs.existsSync(path.join(extrasPath, 'config.json'))) {
        config = JSON.parse(fs.readFileSync(path.join(extrasPath, 'config.json'), 'utf8'));
    }
    console.log('✅ Config cargado');
} catch (e) {
    console.log("⚠️ No se encontró config.json, usando valores por defecto.");
    config = {};
}

// 🛑 DEFINIR VARIABLES DE ENTORNO
process.env.PORT = process.env.PORT || '3000';
process.env.MODERATION_PORT = process.env.MODERATION_PORT || '3001';
process.env.TWITCH_BOT_USERNAME = config.TWITCH_BOT_USERNAME || 'togikirei';
process.env.TWITCH_OAUTH_TOKEN = config.TWITCH_OAUTH_TOKEN || '';
process.env.TWITCH_CLIENT_ID = config.TWITCH_CLIENT_ID || '';
process.env.MOD_PASSWORD = config.MOD_PASSWORD || 'camiones';
process.env.OVERLAY_TOKEN = config.OVERLAY_TOKEN || 'camiones';

// Procesos hijos y Logs
let childProcesses = [];
let appLogs = [];
let loginWin = null;
let monitorWin = null;

// 🔥 Contador de reinicios por proceso (evita bucle infinito)
const restartCounters = {};

// 📦 NUEVO — Guardamos las rutas de los scripts para poder reiniciarlos
const processScripts = {};

// ================================================================
// 📝 SETUP.JSON — LEER / ESCRIBIR LA ELECCIÓN DEL USUARIO
// ================================================================
function readSetup() {
    try {
        if (fs.existsSync(setupPath)) {
            return JSON.parse(fs.readFileSync(setupPath, 'utf8'));
        }
    } catch (e) {
        console.error('⚠️ No se pudo leer setup.json:', e.message);
    }
    return null;
}

function writeSetup(payload) {
    try {
        const data = {
            mode: payload.mode,                                  // 'server' | 'client'
            ip: payload.mode === 'client' ? payload.ip : null,   // solo si es cliente
            configuredAt: new Date().toISOString()
        };
        fs.writeFileSync(setupPath, JSON.stringify(data, null, 2), 'utf8');
        console.log('✅ setup.json guardado:', data);
        return { success: true, data };
    } catch (e) {
        console.error('❌ No se pudo escribir setup.json:', e.message);
        return { success: false, error: e.message };
    }
}

// ================================================================
// 🔍 RESOLVER CARPETA DE MÓDULOS (dev vs prod, node_modules vs modules)
// ================================================================
function resolveNodeModulesPath() {
    const candidates = [
        path.join(extrasPath, 'node_modules'),   // dev
        path.join(extrasPath, 'modules'),        // prod (renombrado por prebuild)
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

// ================================================================
// 🚀 ARRANQUE DE PROCESOS (SIN shell: true → SIN cmd.exe)
// ================================================================
function startProcess(name, scriptPath, cwd) {
    console.log(`⏳ Iniciando ${name}...`);
    console.log(`   Script: ${scriptPath}`);
    console.log(`   CWD: ${cwd}`);

    if (!fs.existsSync(scriptPath)) {
        console.error(`❌ [${name}] NO EXISTE el archivo: ${scriptPath}`);
        appLogs.push(`❌ [${name}] Archivo no encontrado: ${scriptPath}`);
        return null;
    }

    // 📦 Guardamos la info del proceso para poder reiniciarlo
    processScripts[name] = { scriptPath, cwd };

    // 📦 Resolver dónde están los módulos
    const extrasNodeModules = resolveNodeModulesPath();

    if (extrasNodeModules) {
        console.log(`   📦 node_modules: ${extrasNodeModules}`);
    } else {
        console.warn(`   ⚠️ No se encontró carpeta de módulos en ${extrasPath}`);
        console.warn(`      Esperado: extras/node_modules o extras/modules`);
    }

    // 📦 Construir env vars
    const envVars = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        APP_USER_DATA: userDataDir,
        NODE_ENV: isPackaged ? 'production' : 'development'
    };

    // Solo añadir NODE_PATH si encontramos la carpeta
    if (extrasNodeModules) {
        envVars.NODE_PATH = extrasNodeModules + path.delimiter + (process.env.NODE_PATH || '');
    }

    // 🔥 Usar el Node embebido en Electron con ELECTRON_RUN_AS_NODE
    const proc = spawn(process.execPath, [scriptPath], {
        cwd: cwd || path.dirname(scriptPath),
        env: envVars,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false
    });

    proc.stdout.on('data', (data) => {
        const log = `[${name}] ${data.toString().trim()}`;
        console.log(log);
        appLogs.push(log);
        if (appLogs.length > 500) appLogs = appLogs.slice(-500);
    });

    proc.stderr.on('data', (data) => {
        const log = `[${name} ERROR] ${data.toString().trim()}`;
        console.log(log);
        appLogs.push(log);
        if (appLogs.length > 500) appLogs = appLogs.slice(-500);
    });

    proc.on('error', (err) => {
        console.error(`❌ [${name}] Error al arrancar:`, err.message);
        appLogs.push(`❌ [${name}] ${err.message}`);
    });

    proc.on('exit', (code) => {
        console.log(`[${name}] Proceso terminado con código ${code}`);
        appLogs.push(`[${name}] Terminado (código ${code})`);

        // 🔥 Si salió con código 0 → cierre limpio intencional, NO reiniciar
        if (code === 0) {
            console.log(`[${name}] Cierre limpio. No se reinicia.`);
            return;
        }

        // 🔥 Si estamos cerrando la app, no reiniciar
        if (app.isQuitting) return;

        // 🔥 Contador de reinicios (máx 5 para evitar bucle infinito)
        restartCounters[name] = (restartCounters[name] || 0) + 1;

        if (restartCounters[name] > 5) {
            console.error(`❌ [${name}] Demasiados reinicios (5). Deteniendo para evitar bucle.`);
            appLogs.push(`❌ [${name}] Bucle de reinicios detenido.`);
            return;
        }

        console.log(`🔄 Reiniciando ${name} en 5 segundos... (intento ${restartCounters[name]}/5)`);
        setTimeout(() => {
            if (!app.isQuitting) startProcess(name, scriptPath, cwd);
        }, 5000);
    });

    childProcesses.push(proc);
    return proc;
}

// ================================================================
// 🛑 CERRAR PROCESOS
// ================================================================
function closeAllProcesses() {
    console.log('⏳ Cerrando todos los procesos...');
    app.isQuitting = true;

    childProcesses.forEach((proc) => {
        if (proc && !proc.killed) {
            try {
                proc.kill();
            } catch (e) {
                console.error('Error matando proceso:', e.message);
            }
        }
    });
    childProcesses = [];
}

// ================================================================
// 🌐 CONFIGURACIÓN DE SESIÓN PERSISTENTE DE TIKTOK
// ================================================================
function getTikTokSession() {
    const tiktokSession = session.fromPartition('persist:tiktok-session');

    tiktokSession.webRequest.onHeadersReceived((details, callback) => {
        const responseHeaders = {};
        Object.keys(details.responseHeaders).forEach((key) => {
            const lowerKey = key.toLowerCase();
            if (
                lowerKey !== 'content-security-policy' &&
                lowerKey !== 'content-security-policy-report-only' &&
                !lowerKey.startsWith('access-control-')
            ) {
                responseHeaders[key] = details.responseHeaders[key];
            }
        });

        const requestOrigin = details.requestHeaders?.Origin || details.requestHeaders?.origin || 'https://livecenter.tiktok.com';
        responseHeaders['Access-Control-Allow-Origin'] = [requestOrigin];
        responseHeaders['Access-Control-Allow-Credentials'] = ['true'];
        responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
        responseHeaders['Access-Control-Allow-Headers'] = ['*'];

        callback({ cancel: false, responseHeaders });
    });

    tiktokSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(true);
    });

    return tiktokSession;
}

// ================================================================
// 🏠 VENTANA PRINCIPAL (DASHBOARD)
// ================================================================
function createWindow() {
    const win = new BrowserWindow({
        width: 1200, height: 800,
        title: 'Stream Overlay',
        backgroundColor: '#0e0e10',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: true,
            nodeIntegrationInSubFrames: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
    win.loadURL(`http://localhost:${process.env.PORT}`);
}

// ================================================================
// 🔑 VENTANA DE LOGIN DE TIKTOK
// ================================================================
function openTikTokLoginWindow() {
    if (loginWin) { loginWin.focus(); return; }
    getTikTokSession();

    loginWin = new BrowserWindow({
        width: 800, height: 700,
        title: 'Inicia Sesión en TikTok',
        backgroundColor: '#0e0e10',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
            partition: 'persist:tiktok-session'
        }
    });
    loginWin.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    loginWin.loadURL('https://livecenter.tiktok.com/login');

    loginWin.webContents.on('did-navigate', (event, url) => {
        console.log('[TikTok Login] Navegando a:', url);
        if (url.includes('/live_monitor') || url.includes('/dashboard') || !url.includes('/login')) {
            console.log('✅ ¡Login detectado con éxito!');
            BrowserWindow.getAllWindows().forEach(win => {
                if (win !== loginWin) win.webContents.send('tiktok-login-success');
            });
            setTimeout(() => { if (loginWin) loginWin.close(); }, 1500);
        }
    });
    loginWin.on('closed', () => { loginWin = null; });
}

// ================================================================
// 🎥 VENTANA DE MONITOREO Y CAPTURA
// ================================================================
function startTikTokMonitorWindow() {
    if (monitorWin) { monitorWin.focus(); return; }

    let url = 'https://livecenter.tiktok.com/live_monitor';
    try {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (cfg.CONTROL_URL) url = cfg.CONTROL_URL;
    } catch (e) {}

    getTikTokSession();

    monitorWin = new BrowserWindow({
        width: 1000, height: 700,
        title: 'TikTok Live Monitor',
        backgroundColor: '#0e0e10',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
            partition: 'persist:tiktok-session'
        }
    });

    monitorWin.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    monitorWin.loadURL(url);

    monitorWin.webContents.on('did-finish-load', () => {
        console.log('🚀 Monitor cargado. Iniciando captura...');
        const captureScript = `
            (function() {
                function captureTikTokEvents() {
                    const chatContainer = document.querySelector('[data-e2e="chat-list"], [class*="chat-list"], [class*="comment-list"]') || document.body;
                    if (!chatContainer || window.__tiktokObserverLoaded) return;
                    window.__tiktokObserverLoaded = true;

                    const observer = new MutationObserver((mutations) => {
                        mutations.forEach((mutation) => {
                            mutation.addedNodes.forEach((node) => {
                                if (node.nodeType !== 1 || node.dataset.processed) return;

                                const userEl = node.querySelector('[data-e2e="comment-username"], [class*="username"], [class*="nickname"]');
                                const textEl = node.querySelector('[data-e2e="comment-text"], [class*="text"], [class*="comment-text"]');

                                if (userEl && textEl) {
                                    node.dataset.processed = "true";
                                    fetch('http://localhost:3000/tiktok-chat', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ username: userEl.innerText.trim(), message: textEl.innerText.trim() })
                                    }).catch(() => {});
                                    return;
                                }

                                const giftEl = node.querySelector('[class*="gift-name"], [class*="gift-count"], [class*="gift-item"]');
                                if (giftEl) {
                                    node.dataset.processed = "true";
                                    const user = node.querySelector('[class*="nickname"], [class*="username"]')?.innerText.trim() || 'Usuario';
                                    fetch('http://localhost:3000/tiktok-gift', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ username: user, gift: giftEl.innerText.trim(), diamonds: 1 })
                                    }).catch(() => {});
                                    return;
                                }

                                const textContent = node.innerText || '';
                                if (textContent.includes('followed') || textContent.includes('siguió') || textContent.includes('te sigue')) {
                                    node.dataset.processed = "true";
                                    const user = node.querySelector('[class*="nickname"], [class*="username"]')?.innerText.trim() || 'Nuevo Seguidor';
                                    fetch('http://localhost:3000/tiktok-follow', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ username: user })
                                    }).catch(() => {});
                                }
                            });
                        });
                    });
                    observer.observe(chatContainer, { childList: true, subtree: true });
                }
                setTimeout(captureTikTokEvents, 3000);
                setInterval(captureTikTokEvents, 5000);
            })();
        `;
        monitorWin.webContents.executeJavaScript(captureScript).catch(console.error);
    });

    monitorWin.on('closed', () => {
        monitorWin = null;
        console.log('[TikTok] Monitor cerrado');
    });
}

// ================================================================
// 🎥 MANEJADORES IPC
// ================================================================
ipcMain.handle('start-servers', async () => {
    return { success: true };
});

// 📝 Setup — guardar la elección del usuario (servidor / cliente)
ipcMain.handle('setup:save', async (event, payload) => {
    return writeSetup(payload);
});

// 📝 Setup — leer la elección actual (por si hay que reconfigurar)
ipcMain.handle('setup:load', async () => {
    return readSetup();
});

ipcMain.handle('get-logs', () => {
    return appLogs;
});

// 📦 NUEVO — Handler de reinicio de servidores
ipcMain.handle('restart-servers', async () => {
    console.log('🔄 Solicitud de reinicio de servidores recibida');
    appLogs.push(`🔄 Reinicio manual solicitado (${new Date().toLocaleTimeString()})`);

    try {
        // 1) Matar los procesos actuales (sin marcar isQuitting para que no se cierre la app)
        childProcesses.forEach((proc) => {
            if (proc && !proc.killed) {
                try { proc.kill(); } catch (e) {}
            }
        });
        childProcesses = [];

        // 2) Resetear contadores para que no cuenten el reinicio manual
        restartCounters['SERVIDOR'] = 0;
        restartCounters['MODERACIÓN'] = 0;

        // 3) Esperar 1 segundo antes de re-lanzarlos
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 4) Re-lanzar cada proceso registrado
        for (const [name, info] of Object.entries(processScripts)) {
            startProcess(name, info.scriptPath, info.cwd);
        }

        appLogs.push(`✅ Servidores reiniciados correctamente`);
        return { success: true };
    } catch (e) {
        console.error('❌ Error al reiniciar servidores:', e.message);
        appLogs.push(`❌ Error al reiniciar: ${e.message}`);
        return { success: false, error: e.message };
    }
});

ipcMain.on('open-tiktok-login', () => { openTikTokLoginWindow(); });
ipcMain.on('open-tiktok-window', () => { startTikTokMonitorWindow(); });
ipcMain.on('start-tiktok-stream-monitor', () => { startTikTokMonitorWindow(); });

ipcMain.on('tiktok-chat-captured', async (event, data) => {
    console.log(`[TikTok Chat] ${data.user}: ${data.text}`);
    try {
        await fetch(`http://localhost:${process.env.PORT}/tiktok-chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: data.user, message: data.text })
        });
    } catch (e) {
        console.log('Error enviando mensaje al servidor:', e);
    }
});

// ================================================================
// 🚀 INICIO DE LA APLICACIÓN
// ================================================================
app.whenReady().then(() => {
    const serverScript = path.join(extrasPath, 'server.js');
    const moderationScript = path.join(extrasPath, 'moderation.js');

    // 🔥 Arrancar los servidores con el Node embebido
    startProcess('SERVIDOR', serverScript, extrasPath);
    startProcess('MODERACIÓN', moderationScript, extrasPath);

    setTimeout(() => {
        createWindow();
    }, 5000);
});

// ================================================================
// 🛑 CIERRE LIMPIO
// ================================================================
app.on('window-all-closed', () => {
    closeAllProcesses();
    app.quit();
});

app.on('before-quit', () => {
    closeAllProcesses();
});

process.on('SIGINT', () => {
    closeAllProcesses();
    app.quit();
});

process.on('exit', () => {
    childProcesses.forEach((proc) => {
        if (proc && !proc.killed) {
            try { proc.kill(); } catch (e) {}
        }
    });
});