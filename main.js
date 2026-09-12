// ================================================================
// main.js - Lanzador Electron con soporte para TikTok (Login QR + Captura)
// ================================================================
const { app, BrowserWindow, shell, ipcMain, session, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ← Auto-update
const { autoUpdater } = require('electron-updater');
const updaterLog = require('electron-log');

// ================================================================
// 🔥 DETECCIÓN DE RUTAS (Dev vs Producción)
// ================================================================
const isPackaged = app.isPackaged;

const extrasPath = isPackaged
    ? path.join(process.resourcesPath, 'extras')
    : path.join(__dirname, 'extras');

const publicPath = isPackaged
    ? path.join(process.resourcesPath, 'public')
    : path.join(__dirname, 'public');

const userDataDir = app.getPath('userData');
const configPath = isPackaged
    ? path.join(userDataDir, 'config.json')
    : path.join(__dirname, 'config.json');

const setupPath = isPackaged
    ? path.join(userDataDir, 'setup.json')
    : path.join(__dirname, 'setup.json');

console.log(`📂 Modo: ${isPackaged ? 'PRODUCCIÓN' : 'DESARROLLO'}`);
console.log(`📂 Extras: ${extrasPath}`);
console.log(`📂 Public: ${publicPath}`);
console.log(`📂 Config: ${configPath}`);
console.log(`📂 UserData: ${userDataDir}`);
console.log(`📂 Setup: ${setupPath}`);

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

process.env.PORT = process.env.PORT || '3000';
process.env.MODERATION_PORT = process.env.MODERATION_PORT || '3001';
process.env.TWITCH_BOT_USERNAME = config.TWITCH_BOT_USERNAME || 'togikirei';
process.env.TWITCH_OAUTH_TOKEN = config.TWITCH_OAUTH_TOKEN || '';
process.env.TWITCH_CLIENT_ID = config.TWITCH_CLIENT_ID || '';
process.env.MOD_PASSWORD = config.MOD_PASSWORD || 'camiones';
process.env.OVERLAY_TOKEN = config.OVERLAY_TOKEN || 'camiones';

let childProcesses = [];
let appLogs = [];
let loginWin = null;
let monitorWin = null;

let mainWindow = null;
let updaterInitialized = false;

const restartCounters = {};
const processScripts = {};

// ================================================================
// 📝 SETUP.JSON
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
            mode: payload.mode,
            ip: payload.mode === 'client' ? payload.ip : null,
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
// 🔥 CALCULAR BASE DEL SERVER SEGÚN MODO
// ================================================================
function getServerBase() {
    const setup = readSetup();
    if (setup && setup.mode === 'client' && setup.ip) {
        return `http://${setup.ip}:${process.env.PORT}`;
    }
    return `http://localhost:${process.env.PORT}`;
}

// ================================================================
// 🔍 RESOLVER CARPETA DE MÓDULOS
// ================================================================
function resolveNodeModulesPath() {
    const candidates = [
        path.join(extrasPath, 'node_modules'),
        path.join(extrasPath, 'modules'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

// ================================================================
// 🚀 ARRANQUE DE PROCESOS
// ================================================================
function startProcess(name, scriptPath, cwd) {
    console.log(`⏳ Iniciando ${name}...`);

    if (!fs.existsSync(scriptPath)) {
        console.error(`❌ [${name}] NO EXISTE: ${scriptPath}`);
        appLogs.push(`❌ [${name}] Archivo no encontrado: ${scriptPath}`);
        return null;
    }

    processScripts[name] = { scriptPath, cwd };

    const extrasNodeModules = resolveNodeModulesPath();

    const envVars = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        APP_USER_DATA: userDataDir,
        NODE_ENV: isPackaged ? 'production' : 'development'
    };

    if (extrasNodeModules) {
        envVars.NODE_PATH = extrasNodeModules + path.delimiter + (process.env.NODE_PATH || '');
    }

    const proc = spawn(process.execPath, [scriptPath], {
        cwd: cwd || path.dirname(scriptPath),
        env: envVars,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false
    });

    proc.stdout.on('data', (data) => {
        const logLine = `[${name}] ${data.toString().trim()}`;
        console.log(logLine);
        appLogs.push(logLine);
        if (appLogs.length > 500) appLogs = appLogs.slice(-500);
    });

    proc.stderr.on('data', (data) => {
        const logLine = `[${name} ERROR] ${data.toString().trim()}`;
        console.log(logLine);
        appLogs.push(logLine);
        if (appLogs.length > 500) appLogs = appLogs.slice(-500);
    });

    proc.on('error', (err) => {
        console.error(`❌ [${name}] Error al arrancar:`, err.message);
        appLogs.push(`❌ [${name}] ${err.message}`);
    });

    proc.on('exit', (code) => {
        console.log(`[${name}] Proceso terminado con código ${code}`);
        appLogs.push(`[${name}] Terminado (código ${code})`);

        if (code === 0) return;
        if (app.isQuitting) return;

        restartCounters[name] = (restartCounters[name] || 0) + 1;

        if (restartCounters[name] > 5) {
            console.error(`❌ [${name}] Demasiados reinicios.`);
            return;
        }

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
    app.isQuitting = true;
    childProcesses.forEach((proc) => {
        if (proc && !proc.killed) {
            try { proc.kill(); } catch (e) {}
        }
    });
    childProcesses = [];
}

// ================================================================
// 🌐 SESIÓN TIKTOK
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
// 🔄 AUTO-UPDATE (con diálogo nativo + descarga automática)
// ================================================================
function initAutoUpdater(win) {
    if (updaterInitialized) return;
    updaterInitialized = true;

    if (!isPackaged) {
        console.log('🔄 Auto-updater: en desarrollo, no se comprueba.');
        return;
    }

    autoUpdater.logger = updaterLog;
    autoUpdater.logger.transports.file.level = 'info';
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
        console.log('🔄 Buscando actualizaciones...');
    });

    autoUpdater.on('update-available', (info) => {
        console.log(`🔄 Nueva versión disponible: ${info.version}`);

        // Avisar al panel (por si quiere mostrar banner)
        if (win && !win.isDestroyed()) {
            win.webContents.send('update:available', {
                version: info.version,
                releaseNotes: info.releaseNotes || ''
            });
        }

        // 🔽 Descargar automáticamente
        console.log('🔄 Descargando actualización...');
        autoUpdater.downloadUpdate().catch(e => console.error('❌ updater download:', e.message));
    });

    autoUpdater.on('update-not-available', () => {
        console.log('🔄 No hay actualizaciones disponibles.');
    });

    autoUpdater.on('download-progress', (p) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('update:progress', {
                percent: Math.round(p.percent),
                mbps: (p.bytesPerSecond / 1024 / 1024).toFixed(2)
            });
        }
    });

    autoUpdater.on('update-downloaded', (info) => {
        console.log(`🔄 Actualización descargada: ${info.version}`);

        // Avisar al panel
        if (win && !win.isDestroyed()) {
            win.webContents.send('update:ready', { version: info.version });
        }

        // 🔔 Diálogo nativo preguntando si reiniciar
        dialog.showMessageBox(win, {
            type: 'info',
            buttons: ['Reiniciar ahora', 'Más tarde'],
            defaultId: 0,
            cancelId: 1,
            title: 'Actualización lista',
            message: `La versión ${info.version} está lista para instalarse.`,
            detail: '¿Quieres reiniciar la aplicación ahora para aplicar la actualización?\n\nSi eliges "Más tarde", se instalará la próxima vez que abras la app.'
        }).then(({ response }) => {
            if (response === 0) {
                console.log('🔄 Reiniciando para instalar update...');
                closeAllProcesses();
                setImmediate(() => autoUpdater.quitAndInstall());
            } else {
                console.log('⏭️ Usuario eligió "Más tarde". Se instalará al cerrar la app.');
            }
        }).catch(err => console.error('❌ Error mostrando diálogo:', err.message));
    });

    autoUpdater.on('error', (err) => {
        console.error('❌ [updater]', err.message);
        if (win && !win.isDestroyed()) {
            win.webContents.send('update:error', err.message);
        }
    });

    // Comprobar al arrancar (15 s) y cada 4 horas
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch((e) => console.error('❌ updater:', e.message));
    }, 15000);

    setInterval(() => {
        autoUpdater.checkForUpdates().catch((e) => console.error('❌ updater:', e.message));
    }, 4 * 60 * 60 * 1000);
}

// ================================================================
// 🏠 VENTANA PRINCIPAL
// ================================================================
function createWindow() {
    const setup = readSetup();
    const isClient = setup && setup.mode === 'client' && setup.ip;

    const win = new BrowserWindow({
        width: 1200, height: 800,
        title: 'Stream Overlay',
        backgroundColor: '#0e0e10',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: true,
            nodeIntegrationInSubFrames: true
        }
    });

    mainWindow = win;

    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    if (!setup) {
        console.log('🆕 No hay setup.json → mostrando setup.html');
        const setupFile = path.join(publicPath, 'setup.html');
        win.loadFile(setupFile);
    } else if (isClient) {
        const base = `http://${setup.ip}:${process.env.PORT}`;
        console.log(`💻 Modo CLIENTE → abriendo panel en ${base}`);
        win.loadURL(`${base}/`);
    } else {
        console.log('🖥️ Modo SERVIDOR → abriendo panel local');
        win.loadURL(`http://localhost:${process.env.PORT}`);
    }

    win.webContents.once('did-finish-load', () => {
        initAutoUpdater(win);
    });

    win.on('closed', () => {
        if (mainWindow === win) mainWindow = null;
    });
}

// ================================================================
// 🔑 LOGIN TIKTOK
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
        if (url.includes('/live_monitor') || url.includes('/dashboard') || !url.includes('/login')) {
            BrowserWindow.getAllWindows().forEach(win => {
                if (win !== loginWin) win.webContents.send('tiktok-login-success');
            });
            setTimeout(() => { if (loginWin) loginWin.close(); }, 1500);
        }
    });
    loginWin.on('closed', () => { loginWin = null; });
}

// ================================================================
// 🎥 MONITOR TIKTOK
// ================================================================
function startTikTokMonitorWindow() {
    if (monitorWin) { monitorWin.focus(); return; }

    // 🔥 Base del server según el modo (server vs client)
    const serverBase = getServerBase();
    console.log(`🎥 Monitor TikTok → enviará eventos a ${serverBase}`);

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
        const captureScript = `
            (function() {
                const SERVER_BASE = ${JSON.stringify(serverBase)};

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
                                    fetch(SERVER_BASE + '/tiktok-chat', {
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
                                    fetch(SERVER_BASE + '/tiktok-gift', {
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
                                    fetch(SERVER_BASE + '/tiktok-follow', {
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
    });
}

// ================================================================
// 🎥 IPC
// ================================================================
ipcMain.handle('start-servers', async () => {
    return { success: true };
});

ipcMain.handle('setup:save', async (event, payload) => {
    return writeSetup(payload);
});

ipcMain.handle('setup:load', async () => {
    return readSetup();
});

ipcMain.handle('setup:get-info', async () => {
    const setup = readSetup();
    if (!setup) return { mode: null };
    return {
        mode: setup.mode,
        ip: setup.ip || null,
        configuredAt: setup.configuredAt || null
    };
});

ipcMain.handle('setup:reset', async () => {
    try {
        if (fs.existsSync(setupPath)) {
            fs.unlinkSync(setupPath);
            console.log('🗑️ setup.json borrado');
        }
        setTimeout(() => {
            try { app.relaunch(); } catch (e) {}
            app.quit();
        }, 500);
        return { success: true };
    } catch (e) {
        console.error('❌ Error reseteando setup:', e.message);
        return { success: false, error: e.message };
    }
});

ipcMain.on('setup:done', () => {
    console.log('🔄 Setup completado. Reiniciando la aplicación...');

    childProcesses.forEach((proc) => {
        if (proc && !proc.killed) {
            try { proc.kill(); } catch (e) {}
        }
    });
    childProcesses = [];

    setTimeout(() => {
        try {
            app.relaunch();
            console.log('🚀 Relanzando app...');
        } catch (e) {
            console.error('❌ Error al relanzar:', e.message);
        }
        app.quit();
    }, 500);
});

ipcMain.handle('get-logs', () => {
    return appLogs;
});

ipcMain.handle('restart-servers', async () => {
    try {
        childProcesses.forEach((proc) => {
            if (proc && !proc.killed) {
                try { proc.kill(); } catch (e) {}
            }
        });
        childProcesses = [];

        restartCounters['SERVIDOR'] = 0;
        restartCounters['MODERACIÓN'] = 0;

        await new Promise(resolve => setTimeout(resolve, 1000));

        for (const [name, info] of Object.entries(processScripts)) {
            startProcess(name, info.scriptPath, info.cwd);
        }

        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.on('open-tiktok-login', () => { openTikTokLoginWindow(); });
ipcMain.on('open-tiktok-window', () => { startTikTokMonitorWindow(); });
ipcMain.on('start-tiktok-stream-monitor', () => { startTikTokMonitorWindow(); });

ipcMain.on('tiktok-chat-captured', async (event, data) => {
    try {
        const base = getServerBase();
        await fetch(`${base}/tiktok-chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: data.user, message: data.text })
        });
    } catch (e) {}
});

// ================================================================
// 🔄 IPC DEL AUTO-UPDATE
// ================================================================
ipcMain.handle('update:check', async () => {
    if (!isPackaged) return { success: false, error: 'No disponible en desarrollo' };
    try {
        const result = await autoUpdater.checkForUpdates();
        return { success: true, version: result?.updateInfo?.version };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('update:download', async () => {
    try {
        await autoUpdater.downloadUpdate();
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('update:install', () => {
    setImmediate(() => {
        closeAllProcesses();
        autoUpdater.quitAndInstall();
    });
    return { success: true };
});

// ================================================================
// 🚀 INICIO DE LA APLICACIÓN
// ================================================================
app.whenReady().then(() => {
    const setup = readSetup();
    const mode = setup ? setup.mode : null;

    console.log(`🚀 Arrancando en modo: ${mode || 'PRIMERA VEZ (sin setup.json)'}`);

    if (!setup) {
        console.log('🆕 Sin setup.json → no se arrancan servidores. Mostrando setup.html.');
        setTimeout(() => { createWindow(); }, 500);
        return;
    }

    if (mode === 'server') {
        console.log('🖥️ Modo SERVIDOR → arrancando servidor y moderación.');
        const serverScript = path.join(extrasPath, 'server.js');
        const moderationScript = path.join(extrasPath, 'moderation.js');

        startProcess('SERVIDOR', serverScript, extrasPath);
        startProcess('MODERACIÓN', moderationScript, extrasPath);

        setTimeout(() => { createWindow(); }, 5000);
    } else if (mode === 'client') {
        console.log(`💻 Modo CLIENTE → conectando a ${setup.ip}:${process.env.PORT}. No se arrancan servidores.`);
        setTimeout(() => { createWindow(); }, 500);
    } else {
        console.warn(`⚠️ Modo desconocido "${mode}". Arrancando como servidor por seguridad.`);
        const serverScript = path.join(extrasPath, 'server.js');
        const moderationScript = path.join(extrasPath, 'moderation.js');

        startProcess('SERVIDOR', serverScript, extrasPath);
        startProcess('MODERACIÓN', moderationScript, extrasPath);

        setTimeout(() => { createWindow(); }, 5000);
    }
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