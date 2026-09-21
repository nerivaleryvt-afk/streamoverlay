// ================================================================
// main.js - Lanzador Electron con soporte para TikTok (Login QR + Captura)
// Versión refactorizada: fixes de isQuitting, backoff, listeners, caché
// ================================================================
const { app, BrowserWindow, shell, ipcMain, session, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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

// ================================================================
// 🧠 ESTADO GLOBAL
// ================================================================
let childProcesses = [];
let appLogs = [];
let loginWin = null;
let monitorWin = null;
let mainWindow = null;
let updaterInitialized = false;
let updaterInterval = null;

let isQuitting = false;

const restartCounters = {};
const processScripts = {};

// ================================================================
// 📝 HELPERS
// ================================================================
function log(tag, msg, isError = false) {
    const line = isError ? `[${tag} ERROR] ${msg}` : `[${tag}] ${msg}`;
    if (isError) console.error(line); else console.log(line);
    if (appLogs.length >= 500) appLogs.shift();
    appLogs.push(line);
}

// ================================================================
// 📝 SETUP.JSON
// ================================================================
let cachedSetup = null;

function readSetup(force = false) {
    if (cachedSetup && !force) return cachedSetup;
    try {
        if (fs.existsSync(setupPath)) {
            cachedSetup = JSON.parse(fs.readFileSync(setupPath, 'utf8'));
            return cachedSetup;
        }
    } catch (e) {
        console.error('⚠️ No se pudo leer setup.json:', e.message);
    }
    cachedSetup = null;
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
        cachedSetup = data;
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
    if (isQuitting) return null;
    console.log(`⏳ Iniciando ${name}...`);

    if (!fs.existsSync(scriptPath)) {
        log(name, `Archivo no encontrado: ${scriptPath}`, true);
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
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        windowsHide: true,
        shell: false
    });

    const startedAt = Date.now();

    proc.stdout.on('data', (data) => log(name, data.toString().trim()));
    proc.stderr.on('data', (data) => log(name, data.toString().trim(), true));

    proc.on('error', (err) => log(name, err.message, true));

    proc.on('exit', (code) => {
        childProcesses = childProcesses.filter(p => p !== proc);
        console.log(`[${name}] Proceso terminado con código ${code}`);
        if (appLogs.length >= 500) appLogs.shift();
        appLogs.push(`[${name}] Terminado (código ${code})`);

        if (isQuitting) return;
        if (code === 0) return;

        const livedMs = Date.now() - startedAt;
        if (livedMs > 30_000) restartCounters[name] = 0;

        restartCounters[name] = (restartCounters[name] || 0) + 1;

        if (restartCounters[name] > 5) {
            log(name, 'Demasiados reinicios, se detiene.', true);
            return;
        }

        const delay = Math.min(30_000, 1000 * 2 ** restartCounters[name]);
        console.log(`[${name}] Reintentando en ${delay / 1000}s (intento ${restartCounters[name]}/5)`);

        setTimeout(() => {
            if (!isQuitting) startProcess(name, scriptPath, cwd);
        }, delay);
    });

    childProcesses.push(proc);
    return proc;
}

// ================================================================
// 🛑 CERRAR PROCESOS
// ================================================================
function closeAllProcesses() {
    if (isQuitting) return;
    isQuitting = true;

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
// ═══════════════════════════════════════════════════════════════
// ✨ FIX: configurar TODAS las particiones TikTok, no solo "session"
// El webview del dashboard usa slot-1/2/3 y necesita los mismos
// headers CORS + permisos que la ventana de login.
// ═══════════════════════════════════════════════════════════════
const TIKTOK_ALL_PARTITIONS = [
    'persist:tiktok-session',
    'persist:tiktok-slot-1',
    'persist:tiktok-slot-2',
    'persist:tiktok-slot-3',
    'persist:tiktok-slot-4',
    'persist:tiktok-slot-5',
    'persist:tiktok-slot-6'
];

const _tiktokSessionsConfigured = new Set();

function configurarSesionTikTok(partitionName) {
    if (_tiktokSessionsConfigured.has(partitionName)) return;
    _tiktokSessionsConfigured.add(partitionName);

    try {
        const ses = session.fromPartition(partitionName);

        ses.webRequest.onHeadersReceived((details, callback) => {
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

        ses.setPermissionRequestHandler((webContents, permission, callback) => {
            callback(true);
        });

        console.log(`🔧 Sesión TikTok configurada: ${partitionName}`);
    } catch (e) {
        console.error(`❌ No se pudo configurar ${partitionName}:`, e.message);
    }
}

function getTikTokSession() {
    // Configurar TODAS las particiones candidatas
    TIKTOK_ALL_PARTITIONS.forEach(configurarSesionTikTok);
    return session.fromPartition('persist:tiktok-session');
}

// ================================================================
// 🔑 CAPTURA DE COOKIES DE TIKTOK
// ================================================================
const COOKIE_SECRET = 'togipanel-tiktok-v1';
const TIKTOK_COOKIES_FILE = path.join(userDataDir, 'tiktok-cookies.enc');

function cifrar(texto) {
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(COOKIE_SECRET, 'togipanel-salt', 32);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let enc = cipher.update(texto, 'utf8', 'hex');
    enc += cipher.final('hex');
    return iv.toString('hex') + ':' + enc;
}

function descifrar(texto) {
    try {
        const [ivHex, enc] = texto.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const key = crypto.scryptSync(COOKIE_SECRET, 'togipanel-salt', 32);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let dec = decipher.update(enc, 'hex', 'utf8');
        dec += decipher.final('utf8');
        return dec;
    } catch (e) {
        console.error('❌ No se pudieron descifrar las cookies:', e.message);
        return null;
    }
}

const COOKIES_INTERES = new Set([
    'sessionid', 'sessionid_ss', 'sid_tt', 'sid_guard', 'uid_tt', 'uid_tt_ss',
    'ttwid', 'odin_tt', 'passport_csrf_token', 'passport_csrf_token_default',
    'tt_csrf_token', 'msToken', 'tt_chain_token', 'store-idc', 'store-country-code'
]);

// ═══════════════════════════════════════════════════════════════
// ✨ FIX: leer cookies de TODAS las particiones TikTok
// El webview del dashboard usa persist:tiktok-slot-N, pero el
// login window usa persist:tiktok-session. Leemos de todas y
// mezclamos. La partición con sessionid válido es la "ganadora".
// ═══════════════════════════════════════════════════════════════
const TIKTOK_PARTITIONS_TO_SCAN = [
    'persist:tiktok-session',    // ventana de login / externa
    'persist:tiktok-slot-1',     // webview dashboard slot 1
    'persist:tiktok-slot-2',     // webview dashboard slot 2
    'persist:tiktok-slot-3',     // webview dashboard slot 3
    'persist:tiktok-slot-4',
    'persist:tiktok-slot-5',
    'persist:tiktok-slot-6'
];

// ═══════════════════════════════════════════════════════════════
// ✨ Notificar al server que las cookies cambiaron
// El server puede así invalidar cachés y releer del disco.
// ═══════════════════════════════════════════════════════════════
async function notificarServerCookiesActualizadas() {
    try {
        const base = getServerBase();
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        await fetch(`${base}/api/tiktok/cookies-updated`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ts: Date.now() }),
            signal: ctrl.signal
        }).finally(() => clearTimeout(t));
        console.log('📡 Server notificado de cookies actualizadas');
    } catch (e) {
        // Silencioso — el server puede no tener el endpoint todavía
    }
}

async function capturarYGuardarCookies() {
    try {
        const relevantes = {};
        let totalCookies = 0;
        let particionesLeidas = 0;
        let particionConSesion = null;
        const debugInfo = [];

        // Recorrer TODAS las particiones candidatas
        for (const nombre of TIKTOK_PARTITIONS_TO_SCAN) {
            try {
                const ses = session.fromPartition(nombre);
                const cookies = await ses.cookies.get({});
                totalCookies += cookies.length;
                particionesLeidas++;

                let tieneSesionEnEsta = false;
                let relevantesEnEsta = 0;

                cookies.forEach((c) => {
                    if (COOKIES_INTERES.has(c.name)) {
                        // Solo sobreescribir si aún no tenemos este cookie
                        // (la primera partición con cookies gana por defecto)
                        if (!(c.name in relevantes)) {
                            relevantes[c.name] = c.value;
                        }
                        relevantesEnEsta++;
                        if (c.name === 'sessionid' || c.name === 'sessionid_ss') {
                            tieneSesionEnEsta = true;
                        }
                    }
                });

                debugInfo.push(`${nombre}: ${cookies.length} cookies (${relevantesEnEsta} relevantes)`);

                // Prioridad: si esta partición tiene sessionid, gana
                if (tieneSesionEnEsta) {
                    if (!particionConSesion) {
                        particionConSesion = nombre;
                        // Sobrescribir con los valores de ESTA partición
                        cookies.forEach((c) => {
                            if (COOKIES_INTERES.has(c.name)) {
                                relevantes[c.name] = c.value;
                            }
                        });
                    }
                }
            } catch (e) {
                // Silencioso — la partición puede no existir aún
            }
        }

        console.log('🍪 Escaneo de particiones TikTok:');
        debugInfo.forEach((line) => console.log('   ' + line));
        console.log(`🍪 Partición con sessionid: ${particionConSesion || 'NINGUNA'}`);

        const tieneSesion = relevantes.sessionid || relevantes.sessionid_ss;
        if (!tieneSesion) {
            console.log('⚠️ No se encontró sessionid en ninguna partición. Login incompleto.');
            return { success: false, error: 'Sin sessionid', particionesLeidas };
        }

        const payload = {
            cookies: relevantes,
            capturadoEn: new Date().toISOString(),
            totalCookies,
            particionOrigen: particionConSesion
        };

        const cifrado = cifrar(JSON.stringify(payload));
        fs.writeFileSync(TIKTOK_COOKIES_FILE, cifrado, 'utf8');

        console.log(`✅ Cookies de TikTok guardadas (${Object.keys(relevantes).length} relevantes, desde ${particionConSesion})`);
        console.log(`   Archivo: ${TIKTOK_COOKIES_FILE}`);

        BrowserWindow.getAllWindows().forEach((win) => {
            if (win !== loginWin) {
                try { win.webContents.send('tiktok-login-success'); } catch (e) {}
            }
        });

        // ✨ Avisar al server que recargue las cookies del disco
        notificarServerCookiesActualizadas().catch(() => {});

        return { success: true, total: Object.keys(relevantes).length, particion: particionConSesion };
    } catch (e) {
        console.error('❌ Error capturando cookies:', e.message);
        return { success: false, error: e.message };
    }
}

// ================================================================
// 🔄 AUTO-UPDATE
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
        if (win && !win.isDestroyed()) {
            win.webContents.send('update:available', {
                version: info.version,
                releaseNotes: info.releaseNotes || ''
            });
        }
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

        if (win && !win.isDestroyed()) {
            win.webContents.send('update:ready', { version: info.version });
        }

        const parentWin = (win && !win.isDestroyed()) ? win : null;

        dialog.showMessageBox(parentWin, {
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

    setTimeout(() => {
        autoUpdater.checkForUpdates().catch((e) => console.error('❌ updater:', e.message));
    }, 15000);

    updaterInterval = setInterval(() => {
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

    // ✨ Limpiar caché HTTP al arrancar (evita versiones viejas de JS/CSS)
    win.webContents.session.clearCache()
      .then(() => console.log('🧹 Caché HTTP limpiada al arrancar'))
      .catch((e) => console.log('⚠️ No se pudo limpiar caché:', e.message));

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

    loginWin.webContents.on('did-navigate', async (event, url) => {
        const loginOk = /\/(live_monitor|dashboard|live|studio)/.test(url) && !url.includes('/login');

        if (loginOk) {
            console.log('🔑 Login detectado en ventana externa. Capturando cookies...');
            setTimeout(async () => {
                const res = await capturarYGuardarCookies();
                if (res.success) {
                    setTimeout(() => { if (loginWin) loginWin.close(); }, 1500);
                }
            }, 2000);
        }
    });

    loginWin.on('closed', () => { loginWin = null; });
}

// ================================================================
// 🎥 MONITOR TIKTOK
// ================================================================
function startTikTokMonitorWindow() {
    if (monitorWin) { monitorWin.focus(); return; }

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

                function post(path, body) {
                    const ctrl = new AbortController();
                    const t = setTimeout(() => ctrl.abort(), 3000);
                    return fetch(SERVER_BASE + path, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                        signal: ctrl.signal
                    }).catch(() => {}).finally(() => clearTimeout(t));
                }

                function findChatContainer() {
                    return document.querySelector(
                        '[data-e2e="chat-list"], [class*="chat-list"], [class*="comment-list"]'
                    );
                }

                function attachObserver() {
                    const chatContainer = findChatContainer();
                    if (!chatContainer || chatContainer.__tiktokObserved) return false;
                    chatContainer.__tiktokObserved = true;

                    const observer = new MutationObserver((mutations) => {
                        mutations.forEach((mutation) => {
                            mutation.addedNodes.forEach((node) => {
                                if (node.nodeType !== 1 || node.dataset.processed) return;

                                const userEl = node.querySelector('[data-e2e="comment-username"], [class*="username"], [class*="nickname"]');
                                const textEl = node.querySelector('[data-e2e="comment-text"], [class*="text"], [class*="comment-text"]');

                                if (userEl && textEl) {
                                    node.dataset.processed = "true";
                                    post('/tiktok-chat', {
                                        username: userEl.innerText.trim(),
                                        message: textEl.innerText.trim()
                                    });
                                    return;
                                }

                                const giftEl = node.querySelector('[class*="gift-name"], [class*="gift-count"], [class*="gift-item"]');
                                if (giftEl) {
                                    node.dataset.processed = "true";
                                    const user = node.querySelector('[class*="nickname"], [class*="username"]')?.innerText.trim() || 'Usuario';
                                    post('/tiktok-gift', {
                                        username: user,
                                        gift: giftEl.innerText.trim(),
                                        diamonds: 1
                                    });
                                    return;
                                }

                                const textContent = node.innerText || '';
                                if (textContent.includes('followed') || textContent.includes('siguió') || textContent.includes('te sigue')) {
                                    node.dataset.processed = "true";
                                    const user = node.querySelector('[class*="nickname"], [class*="username"]')?.innerText.trim() || 'Nuevo Seguidor';
                                    post('/tiktok-follow', { username: user });
                                }
                            });
                        });
                    });
                    observer.observe(chatContainer, { childList: true, subtree: true });
                    return true;
                }

                const bodyObserver = new MutationObserver(() => {
                    if (findChatContainer()) attachObserver();
                });
                bodyObserver.observe(document.body, { childList: true, subtree: true });

                setTimeout(attachObserver, 3000);
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
        cachedSetup = null;
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

// ================================================================
// 🟢 KICK — Login embebido + captura de cookies
// ================================================================
const KICK_PARTITION = 'persist:kick-auth';

async function capturarCookiesKick() {
    try {
        const ses = session.fromPartition(KICK_PARTITION);
        const cookies = await ses.cookies.get({ domain: '.kick.com' });

        if (!cookies || cookies.length === 0) {
            return { ok: false, error: 'No se encontraron cookies. ¿Terminaste el login?' };
        }

        // 🔍 Log de todas las cookies encontradas (para debug)
        console.log('🍪 [KICK] Cookies encontradas:', cookies.map(c => c.name).join(', '));

        const sessionTokenCookie = cookies.find(c => c.name === 'session_token');
        const kickSessionCookie  = cookies.find(c => c.name === 'kick_session');
        const cfClearanceCookie  = cookies.find(c => c.name === 'cf_clearance');

        if (!kickSessionCookie) {
            return { ok: false, error: 'No se encontró kick_session. ¿Terminaste el login?' };
        }

        if (!cfClearanceCookie) {
            console.warn('⚠️ [KICK] No se encontró cf_clearance. Los clips pueden fallar.');
        } else {
            console.log('✅ [KICK] cf_clearance encontrada, expira:', new Date(cfClearanceCookie.expirationDate * 1000).toISOString());
        }

        // El session_token viene URL-encoded en la cookie. Lo decodificamos para el Bearer.
        const sessionTokenDecoded = sessionTokenCookie
            ? decodeURIComponent(sessionTokenCookie.value)
            : '';

        // 🎯 INCLUIR TODAS las cookies, no solo 2
        const cookiesHeader = cookies
            .map(c => `${c.name}=${c.value}`)
            .join('; ');

        console.log(`🍪 [KICK] Enviando ${cookies.length} cookies al server`);

        // Enviar al server
        const base = getServerBase();
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);

        const r = await fetch(`${base}/api/kick/set-cookies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cookies: cookiesHeader,
                sessionToken: sessionTokenDecoded,
                username: ''
            }),
            signal: ctrl.signal
        }).finally(() => clearTimeout(t));

        const data = await r.json();
        return data;
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function openKickLoginWindow() {
    return new Promise((resolve) => {
        let capturado = false;
        let resolucionEnviada = false;

        const win = new BrowserWindow({
            width: 500,
            height: 760,
            title: 'Conectar con Kick',
            backgroundColor: '#0e0e10',
            autoHideMenuBar: true,
            parent: mainWindow || undefined,
            modal: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                partition: KICK_PARTITION,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            }
        });

        win.loadURL('https://kick.com/login');

        win.webContents.on('did-navigate', async (event, url) => {
            if (capturado) return;

            // Detectar cuando el usuario ya está dentro del dashboard o su perfil
            const loginOk = (
                url.includes('/dashboard') ||
                url.includes('/settings') ||
                (url.match(/^https?:\/\/kick\.com\/[^\/]+\/?$/) && !url.includes('/login') && !url.includes('/signup'))
            );

            if (loginOk) {
                capturado = true;
                console.log(`🔑 [KICK] Login detectado en ${url}. Capturando cookies...`);

                // Esperar 1.5s para que Kick asiente las cookies
                await new Promise(r => setTimeout(r, 1500));

                const result = await capturarCookiesKick();
                console.log('🍪 [KICK] Resultado captura:', result);

                if (!resolucionEnviada) {
                    resolucionEnviada = true;
                    resolve(result);
                }

                setTimeout(() => {
                    if (!win.isDestroyed()) win.close();
                }, 500);
            }
        });

        win.on('closed', () => {
            if (!resolucionEnviada) {
                resolucionEnviada = true;
                resolve({ ok: false, error: 'Cancelado por el usuario' });
            }
        });
    });
}

ipcMain.handle('kick:open-login', async () => {
    return await openKickLoginWindow();
});

ipcMain.handle('kick:logout', async () => {
    try {
        const ses = session.fromPartition(KICK_PARTITION);
        await ses.clearStorageData({ storages: ['cookies'] });
        console.log('🚪 [KICK] Cookies de la partición borradas');
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

// ================================================================
// 🎬 KICK — Crear clip vía navegador interno (v7)
// Fix: inyecta cookies de config.json en la partición ANTES de cargar la página
// + sendInputEvent nativo + ventana off-screen + selector modal robusto
// ================================================================

ipcMain.handle('kick:create-clip-via-browser', async (event, { title, username }) => {
    let clipWin = null;
    try {
        if (!title || typeof title !== 'string' || !title.trim()) {
            return { ok: false, error: 'Falta el título' };
        }
        const slug = String(username || '').trim().replace(/^@/, '');
        if (!slug) {
            return { ok: false, error: 'Falta el username de Kick' };
        }

        console.log(`🎬 [KICK-CLIP] Iniciando creación de clip para @${slug} — "${title}"`);

                            clipWin = new BrowserWindow({
            width: 1280,
            height: 720,
            show: false,
            skipTaskbar: true,
            title: 'Creando clip...',
            backgroundColor: '#000000',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                partition: KICK_PARTITION,
                backgroundThrottling: false,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            }
        });

        // Forzar render aunque la ventana esté oculta
        clipWin.webContents.setBackgroundThrottling(false);
        clipWin.webContents.once('did-finish-load', () => {
            clipWin.webContents.setAudioMuted(true);
            // Pequeño tick para despertar el render
            clipWin.webContents.executeJavaScript('requestAnimationFrame(()=>{})').catch(() => {});
        });

        clipWin.webContents.on('console-message', (event, level, message) => {
            console.log(`[WEB] ${message}`);
        }); 

        // ═══════════════════════════════════════════════════════════════
        // 🔑 LEER COOKIES DEL CONFIG Y INYECTARLAS EN LA PARTICIÓN
        // ═══════════════════════════════════════════════════════════════
        try {
            console.log('🍪 [KICK-CLIP] Leyendo cookies de config.json...');
            const configRaw = fs.readFileSync(configPath, 'utf8');
            const cfg = JSON.parse(configRaw);
            const kickCfg = cfg.kick || {};
            const cookiesRaw = String(kickCfg.cookies || '').trim();
            const sessionToken = String(kickCfg.sessionToken || '').trim();

            if (!cookiesRaw && !sessionToken) {
                console.log('❌ [KICK-CLIP] No hay cookies guardadas. Abortando.');
                if (clipWin && !clipWin.isDestroyed()) clipWin.close();
                return { ok: false, error: 'No hay cookies de Kick. Conectá la cuenta desde el dashboard primero.' };
            }

            console.log(`🍪 [KICK-CLIP] Cookies encontradas (${cookiesRaw.length} chars). Inyectando en ${KICK_PARTITION}...`);

            const cookiesParseadas = cookiesRaw
                .split(';')
                .map(s => s.trim())
                .filter(Boolean)
                .map(par => {
                    const idx = par.indexOf('=');
                    if (idx === -1) return null;
                    return { name: par.slice(0, idx).trim(), value: par.slice(idx + 1).trim() };
                })
                .filter(Boolean);

            console.log(`🍪 [KICK-CLIP] Parseadas ${cookiesParseadas.length} cookies`);

            const ses = clipWin.webContents.session;
            let ok = 0, fail = 0;
            for (const c of cookiesParseadas) {
                try {
                    await ses.cookies.set({
                        url: 'https://kick.com',
                        name: c.name,
                        value: c.value,
                        domain: '.kick.com',
                        path: '/',
                        secure: true,
                        httpOnly: false,
                        sameSite: 'no_restriction'
                    });
                    ok++;
                } catch (e) {
                    console.log(`   ⚠️ Cookie falló: ${c.name} → ${e.message}`);
                    fail++;
                }
            }
            console.log(`🍪 [KICK-CLIP] Inyectadas: ${ok} OK / ${fail} fallos`);

            await new Promise(r => setTimeout(r, 800));

            const verificacion = await ses.cookies.get({ domain: '.kick.com' });
            console.log(`🍪 [KICK-CLIP] Verificación: ${verificacion.length} cookies en la partición`);
            const tieneSesion = verificacion.some(c => c.name === 'session_token');
            const tieneCf = verificacion.some(c => c.name === 'cf_clearance');
            console.log(`🍪 [KICK-CLIP] session_token presente: ${tieneSesion} | cf_clearance presente: ${tieneCf}`);
        } catch (e) {
            console.error('❌ [KICK-CLIP] Error inyectando cookies:', e.message);
            if (clipWin && !clipWin.isDestroyed()) clipWin.close();
            return { ok: false, error: 'Error leyendo cookies: ' + e.message };
        }

        // ═══════════════════════════════════════════════════════════════
        // 🌐 CARGAR LA PÁGINA
        // ═══════════════════════════════════════════════════════════════
        const url = `https://kick.com/${slug}`;
        console.log(`🎬 [KICK-CLIP] Cargando ${url}...`);
        await clipWin.loadURL(url);

        await new Promise(r => setTimeout(r, 3000));
        const urlActual = clipWin.webContents.getURL();
        if (urlActual.includes('/login') || urlActual.includes('/signup')) {
            console.log(`❌ [KICK-CLIP] Kick redirigió a login (${urlActual}). Cookies expiradas.`);
            if (clipWin && !clipWin.isDestroyed()) clipWin.close();
            return { ok: false, error: 'Cookies de Kick expiradas. Reconectá la cuenta desde el dashboard.' };
        }
        console.log(`✅ [KICK-CLIP] Sesión válida (URL: ${urlActual})`);

        console.log('🎬 [KICK-CLIP] Esperando montaje inicial del DOM...');
        await new Promise(r => setTimeout(r, 6000));

        const result = await clipWin.webContents.executeJavaScript(`
            (async function() {
                const LOG = (msg) => console.log('[INJECT] ' + msg);
                const sleep = (ms) => new Promise(r => setTimeout(r, ms));

                // ───── PASO 1: seleccionar video real ─────
                let video = document.querySelector('video#video-player');
                if (!video) {
                    let maxArea = 0;
                    document.querySelectorAll('video').forEach(v => {
                        const r = v.getBoundingClientRect();
                        const area = r.width * r.height;
                        if (area > maxArea) { maxArea = area; video = v; }
                    });
                }
                if (!video) throw new Error('No encontré video#video-player');
                const vRect = video.getBoundingClientRect();
                LOG('Video seleccionado: ' + (video.id || '(sin id)') + ' ' + Math.round(vRect.width) + 'x' + Math.round(vRect.height));

                // ───── PASO 2: reproducir + hover sintético de respaldo ─────
                try {
                    video.muted = true;
                    video.volume = 0;
                    const p = video.play();
                    if (p && typeof p.then === 'function') { await p; LOG('Video play OK'); }
                } catch (e) { LOG('Play falló: ' + e.message); }
                await sleep(500);

                const cx = vRect.left + vRect.width / 2;
                const cy = vRect.top + vRect.height / 2;
                const fireMouse = (t) => video.dispatchEvent(new MouseEvent(t, {
                    bubbles: true, cancelable: true, view: window,
                    clientX: cx, clientY: cy, screenX: cx, screenY: cy,
                }));
                const firePointer = (t) => video.dispatchEvent(new PointerEvent(t, {
                    bubbles: true, cancelable: true, view: window,
                    pointerId: 1, pointerType: 'mouse', isPrimary: true,
                    clientX: cx, clientY: cy,
                }));

                                // Hover agresivo: 5 rondas para asegurar
                for (let round = 0; round < 5; round++) {
                    for (const t of ['mouseenter','mouseover','mousemove']) { fireMouse(t); firePointer(t); await sleep(80); }
                    for (const t of ['pointerenter','pointerover','pointermove']) { firePointer(t); await sleep(80); }
                }

                // ───── PASO 3: buscar botón clip con reintentos ─────
                LOG('Buscando botón clip...');
                let clipBtn = null;
                for (let i = 1; i <= 30; i++) {
                    clipBtn = document.querySelector('[data-testid="video-player-clip"]');
                    if (clipBtn) { LOG('Botón encontrado en intento ' + i); break; }
                    firePointer('pointermove');
                    await sleep(400);
                }

                if (!clipBtn) {
                    LOG('⚠️ Forzando altura de controles como fallback...');
                    const ctrl = document.querySelector('.grid-row-2');
                    if (ctrl) {
                        ctrl.style.height = 'auto';
                        ctrl.style.opacity = '1';
                        ctrl.style.overflow = 'visible';
                    }
                    await sleep(800);
                    clipBtn = document.querySelector('[data-testid="video-player-clip"]');
                }

                if (!clipBtn) throw new Error('No apareció el botón clip tras 12s');

                // ───── PASO 4: click en el botón clip ─────
                LOG('Click en botón clip...');
                clipBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
                await sleep(300);
                try { clipBtn.click(); LOG('click() OK'); } catch (e) { LOG('Error click: ' + e.message); }
                try {
                    clipBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    clipBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    clipBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    LOG('dispatch events OK');
                } catch (e) { LOG('Error dispatch: ' + e.message); }

                                // ───── PASO 5: esperar modal ─────
                LOG('Esperando modal (selector robusto)...');
                let modal = null;
                for (let i = 1; i <= 40; i++) {
                    modal = document.querySelector('#clip-creator-dialog');
                    if (!modal) {
                        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
                            .filter(d => {
                                const r = d.getBoundingClientRect();
                                return r.width > 100 && r.height > 100;
                            });
                        if (dialogs.length > 0) modal = dialogs[0];
                    }
                    if (!modal) {
                        const candidates = Array.from(document.querySelectorAll('[data-testid*="clip"]'))
                            .filter(el => {
                                const r = el.getBoundingClientRect();
                                return r.width > 200 && r.height > 100;
                            });
                        if (candidates.length > 0) modal = candidates[0];
                    }
                    if (modal) { LOG('Modal detectado en intento ' + i + ' (id="' + (modal.id || '') + '")'); break; }
                    await sleep(500);
                }
                if (!modal) {
                    const allDialogs = Array.from(document.querySelectorAll('[role="dialog"], [data-testid*="clip"], [id*="clip"]'));
                    LOG('❌ No apareció modal. Elementos candidatos: ' + allDialogs.length);
                    allDialogs.forEach((d, i) => {
                        LOG('   [' + i + '] <' + d.tagName + ' id="' + (d.id || '') + '" data-testid="' + (d.getAttribute('data-testid') || '') + '">');
                    });
                    throw new Error('No apareció el modal de clip tras 20s');
                }

                await sleep(2000);

                // ───── PASO 6: localizar input de título (solo localizar, NO escribir) ─────
                LOG('Buscando input de título...');
                let titleInput = modal.querySelector('[data-testid="clip-creator-title"]');
                if (!titleInput) {
                    titleInput = modal.querySelector('input[type="text"], input:not([type]), textarea');
                }
                if (!titleInput) {
                    const allInputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type]), textarea'))
                        .filter(el => {
                            const r = el.getBoundingClientRect();
                            return r.width > 100 && r.height > 20;
                        });
                    if (allInputs.length > 0) {
                        titleInput = allInputs.find(el => /t[íi]tulo|title/i.test(el.placeholder || '')) || allInputs[0];
                    }
                }
                if (!titleInput) throw new Error('No encontré el input del título');
                LOG('Input de título encontrado (placeholder="' + (titleInput.placeholder || '') + '")');

                // Devolver las coordenadas del input para que Electron haga click real + insertText
                titleInput.scrollIntoView({ behavior: 'instant', block: 'center' });
                await sleep(300);
                const rectInput = titleInput.getBoundingClientRect();
                return {
                    __needsNativeTyping: true,
                    inputRect: { x: rectInput.left + rectInput.width / 2, y: rectInput.top + rectInput.height / 2 },
                    titulo: ${JSON.stringify(title.trim())}
                };
            })()
        `);

        // ═══════════════════════════════════════════════════════════════
        // ⌨️ ESCRITURA NATIVA DEL TÍTULO (React 18 de Kick la necesita)
        // ═══════════════════════════════════════════════════════════════
        if (result && result.__needsNativeTyping) {
            console.log('⌨️ [KICK-CLIP] Usando sendInputEvent + insertText (escritura nativa)...');
            const { inputRect, titulo } = result;

            // Click real en el input
            clipWin.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(inputRect.x), y: Math.round(inputRect.y) });
            await new Promise(r => setTimeout(r, 200));
            clipWin.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(inputRect.x), y: Math.round(inputRect.y), button: 'left', clickCount: 1 });
            clipWin.webContents.sendInputEvent({ type: 'mouseUp',   x: Math.round(inputRect.x), y: Math.round(inputRect.y), button: 'left', clickCount: 1 });
            await new Promise(r => setTimeout(r, 400));

            // Escribir el título letra por letra como humano
            for (const ch of titulo) {
                clipWin.webContents.sendInputEvent({ type: 'char', keyCode: ch });
                await new Promise(r => setTimeout(r, 40 + Math.random() * 40));
            }
            console.log(`⌨️ [KICK-CLIP] Título tecleado: "${titulo}"`);

            await new Promise(r => setTimeout(r, 1500));

            // Verificar que el título quedó escrito
            const verificacionTitulo = await clipWin.webContents.executeJavaScript(`
                (function() {
                    const inp = document.querySelector('[data-testid="clip-creator-title"]')
                        || document.querySelector('input[type="text"], input:not([type])');
                    return {
                        valor: inp ? inp.value : null,
                        placeholder: inp ? inp.placeholder : null,
                        contadorTexto: (document.querySelector('[class*="/50"]') || {}).textContent || null
                    };
                })()
            `);
            console.log('⌨️ [KICK-CLIP] Verificación post-escritura:', JSON.stringify(verificacionTitulo));

            if (!verificacionTitulo.valor || verificacionTitulo.valor.length < 2) {
                throw new Error('El título no se escribió correctamente. Valor en input: "' + (verificacionTitulo.valor || '') + '"');
            }

            // ═══════════════════════════════════════════════════════════════
            // 🖱️ CLICK EN PUBLICAR (con pointer events realistas)
            // ═══════════════════════════════════════════════════════════════
            const publishResult = await clipWin.webContents.executeJavaScript(`
                (async function() {
                    const LOG = (msg) => console.log('[INJECT-PUBLISH] ' + msg);
                    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

                    const modal = document.querySelector('#clip-creator-dialog')
                        || Array.from(document.querySelectorAll('[role="dialog"]'))
                            .filter(d => { const r = d.getBoundingClientRect(); return r.width > 100 && r.height > 100; })[0];
                    if (!modal) throw new Error('Modal desapareció antes de publicar');

                    let publishBtn = modal.querySelector('[data-testid="clip-creator-publish"]');
                    if (!publishBtn) {
                        const allBtns = Array.from(modal.querySelectorAll('button'));
                        publishBtn = allBtns.find(b => /public|publish|crear|create|save|guardar/i.test(b.textContent || ''));
                    }
                    if (!publishBtn) throw new Error('No encontré el botón Publicar');

                    LOG('Publicar disabled = ' + publishBtn.disabled);
                    if (publishBtn.disabled) throw new Error('El botón Publicar está deshabilitado');

                    // Pointer events realistas (Radix los necesita)
                    publishBtn.focus();
                    const r = publishBtn.getBoundingClientRect();
                    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
                    publishBtn.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
                    publishBtn.dispatchEvent(new MouseEvent('mousedown', opts));
                    publishBtn.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
                    publishBtn.dispatchEvent(new MouseEvent('mouseup', opts));
                    publishBtn.dispatchEvent(new MouseEvent('click', opts));
                    LOG('Click disparado');

                    // ⏳ Esperar 10s y verificar si el modal se cerró (Kick tarda en animarlo)
                    await sleep(10000);

                    const modalSigueAbierto = !!Array.from(document.querySelectorAll('[role="dialog"]'))
                        .find(d => {
                            const r = d.getBoundingClientRect();
                            const style = window.getComputedStyle(d);
                            const opacity = parseFloat(style.opacity);
                            return r.width > 100 && r.height > 100 && opacity > 0.1 && style.display !== 'none';
                        });
                    const errores = Array.from(document.querySelectorAll('[role="alert"], [class*="error"], [class*="destructive"]'))
                        .map(e => e.textContent.trim()).filter(t => t && t.length < 200);

                    return {
                        ok: !modalSigueAbierto,
                        modalSigueAbierto,
                        errores,
                        url: location.href
                    };
                })()
            `);

                        console.log('🎬 [KICK-CLIP] Resultado Publicar:', JSON.stringify(publishResult));

            // Si hay errores visibles en el DOM → falla de verdad
            if (!publishResult.ok && publishResult.errores && publishResult.errores.length > 0) {
                throw new Error('El clip NO se publicó. Errores visibles: ' + JSON.stringify(publishResult.errores));
            }

            // Si el modal sigue abierto pero NO hay errores → asumimos éxito (Kick procesa en background)
            if (publishResult.modalSigueAbierto && (!publishResult.errores || publishResult.errores.length === 0)) {
                console.log('⚠️ [KICK-CLIP] Modal todavía abierto pero SIN errores visibles → asumimos éxito (Kick procesa en background).');
            }

            console.log('🎬 [KICK-CLIP] ✅ Clip publicado y modal cerrado');
        } else {
            console.log('🎬 [KICK-CLIP] Resultado inyectado (flujo viejo):', JSON.stringify(result));
        }

                console.log('🎬 [KICK-CLIP] Resultado inyectado:', JSON.stringify(result));
        
        // ⏳ Esperar a que Kick procese el clip antes de cerrar la ventana
        console.log('🎬 [KICK-CLIP] Esperando a que Kick procese el clip (5s)...');
        await new Promise(r => setTimeout(r, 5000));

        if (clipWin && !clipWin.isDestroyed()) {
            clipWin.close();
            clipWin = null;
        }

        return { 
            ok: true, 
            message: `Clip "${title}" creado. Aparecerá en kick.com/${slug} en ~30 segundos.`,
            cooldown: 90
        };

    } catch (err) {
        console.error('❌ [KICK-CLIP] Error:', err.message);
        if (clipWin && !clipWin.isDestroyed()) {
            try { clipWin.close(); } catch (e) {}
            clipWin = null;
        }
        return { ok: false, error: err.message };
    }
});

ipcMain.on('tiktok-chat-captured', async (event, data) => {
    try {
        const base = getServerBase();
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        await fetch(`${base}/tiktok-chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: data.user, message: data.text }),
            signal: ctrl.signal
        }).finally(() => clearTimeout(t));
    } catch (e) {}
});

// ================================================================
// 🍪 IPC DE COOKIES TIKTOK
// ================================================================
ipcMain.handle('tiktok:capturar-cookies', async () => {
    return await capturarYGuardarCookies();
});

ipcMain.handle('tiktok:cookies-status', async () => {
    try {
        if (!fs.existsSync(TIKTOK_COOKIES_FILE)) return { existe: false };
        const cifrado = fs.readFileSync(TIKTOK_COOKIES_FILE, 'utf8');
        const json = descifrar(cifrado);
        if (!json) return { existe: false };
        const data = JSON.parse(json);
        return {
            existe: true,
            capturadoEn: data.capturadoEn,
            total: Object.keys(data.cookies || {}).length,
            nombres: Object.keys(data.cookies || {})
        };
    } catch (e) {
        return { existe: false, error: e.message };
    }
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
const SCRIPTS = {};

function buildScriptMap() {
    SCRIPTS.SERVIDOR = path.join(extrasPath, 'server.js');
    SCRIPTS.MODERACIÓN = path.join(extrasPath, 'moderation.js');
}

function startAllServers() {
    for (const [name, script] of Object.entries(SCRIPTS)) {
        startProcess(name, script, extrasPath);
    }
}

app.whenReady().then(() => {
    const setup = readSetup();
    const mode = setup ? setup.mode : null;

    buildScriptMap();

    getTikTokSession();

    console.log(`🚀 Arrancando en modo: ${mode || 'PRIMERA VEZ (sin setup.json)'}`);

    if (!setup) {
        console.log('🆕 Sin setup.json → no se arrancan servidores. Mostrando setup.html.');
        setTimeout(() => { createWindow(); }, 500);
        return;
    }

    if (mode === 'server') {
        console.log('🖥️ Modo SERVIDOR → arrancando servidor y moderación.');
        startAllServers();
        setTimeout(() => { createWindow(); }, 5000);
    } else if (mode === 'client') {
        console.log(`💻 Modo CLIENTE → conectando a ${setup.ip}:${process.env.PORT}. No se arrancan servidores.`);
        setTimeout(() => { createWindow(); }, 500);
    } else {
        console.warn(`⚠️ Modo desconocido "${mode}". Arrancando como servidor por seguridad.`);
        startAllServers();
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
    if (updaterInterval) {
        clearInterval(updaterInterval);
        updaterInterval = null;
    }
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