// ================================================================
// app.js (Lanzador COMPLETO para Stream Overlay Pro)
// AUTO-ARRANQUE ÚNICO + CONTROL DE PUERTOS EN WINDOWS
// ================================================================
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Definir variables de entorno (solo puertos de Node.js)
process.env.PORT = '3000';
process.env.MODERATION_PORT = '3001';

// 🛠️ VARIABLE GLOBAL PARA GUARDAR LOS LOGS DE TODOS LOS PROCESOS
let globalLogs = [];

// Procesos hijos
let childProcesses = [];

// Bandera para evitar ejecuciones duplicadas de los servidores
let serversStarted = false;

// 🔥 FUNCIÓN PARA MATAR PROCESOS VIEJOS EN LOS PUERTOS 3000 Y 3001 (COMPATIBLE CON WINDOWS CMD)
function killOldProcesses() {
    try {
        ['3000', '3001'].forEach(port => {
            try {
                execSync(`cmd /c "for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port} ^| findstr LISTENING') do taskkill /f /pid %a"`, { stdio: 'ignore' });
            } catch (e) { /* Puerto libre */ }
        });
        console.log("✅ Procesos viejos eliminados.");
    } catch (e) { /* No hay procesos que matar */ }
}

// Función para iniciar procesos (CAPTURANDO LOGS Y ERRORES)
function startProcess(name, command, args, cwd = __dirname) {
    console.log(`⏳ Iniciando ${name}...`);
    
    const proc = spawn(command, args, { 
        cwd: cwd, 
        shell: false,        
        windowsHide: true,   
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
    });
    
    proc.stdout.on('data', (data) => {
        const log = `[${name}] ${data.toString().trim()}`;
        console.log(log);
        globalLogs.push(log);
    });

    proc.stderr.on('data', (data) => {
        const log = `[${name} ERROR] ${data.toString().trim()}`;
        console.error(log);
        globalLogs.push(log);
    });

    proc.on('exit', (code) => {
        const log = `[${name}] Proceso terminado con código ${code}`;
        console.log(log);
        globalLogs.push(log);
        if (code !== 0) {
            console.log(`[${name}] Reintentando en 5 segundos...`);
            setTimeout(() => startProcess(name, command, args, cwd), 5000);
        }
    });
    
    childProcesses.push(proc);
    return proc;
}

// Función para cerrar todos los subprocesos al salir
function closeAllProcesses() {
    console.log('⏳ Cerrando todos los procesos...');
    childProcesses.forEach((proc) => {
        if (proc && !proc.killed) {
            try {
                spawn('taskkill', ['/pid', proc.pid, '/f', '/t'], { windowsHide: true });
            } catch (e) {
                proc.kill();
            }
        }
    });
    
    setTimeout(() => {
        app.exit(0);
    }, 1000);
}

// Ventanas del navegador para páginas externas
function openBrowserWindow(browserUrl) {
    try {
        if (browserUrl.includes('livecenter.tiktok.com')) {
            const win = new BrowserWindow({
                width: 1100,
                height: 800,
                title: 'TikTok Live Center',
                backgroundColor: '#0e0e10',
                autoHideMenuBar: true,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true
                }
            });

            win.webContents.setWindowOpenHandler(({ url }) => {
                shell.openExternal(url);
                return { action: 'deny' };
            });

            win.loadURL(browserUrl);
            return win;
        } 
        else if (browserUrl.startsWith('http://') || browserUrl.startsWith('https://')) {
            shell.openExternal(browserUrl);
            return null;
        }
    } catch (error) {
        console.error("Error abriendo ventana de navegación:", error);
        return null;
    }
}

// Lógica reutilizable para arrancar los servidores Node (Lanza solo una vez)
function launchBackendServers() {
    if (serversStarted) {
        console.log("⏭️ [SISTEMA] Los servidores ya fueron iniciados previamente.");
        return;
    }
    serversStarted = true;

    killOldProcesses();

    const isPackaged = app.isPackaged;
    const basePath = isPackaged 
        ? path.join(process.resourcesPath, 'extras') 
        : (fs.existsSync(path.join(__dirname, 'extras')) ? path.join(__dirname, 'extras') : __dirname);

    const nodeExe = isPackaged 
        ? path.join(basePath, 'node', 'node.exe') 
        : 'node';

    // 1️⃣ Servidor Principal
    const serverPath = path.join(basePath, 'server.js');
    if (fs.existsSync(serverPath)) {
        startProcess('SERVIDOR', nodeExe, [serverPath], basePath);
    } else {
        console.error("⚠️ No se encontró server.js en:", serverPath);
    }

    // 2️⃣ Sistema de Moderación
    const moderationPath = path.join(basePath, 'moderation.js');
    if (fs.existsSync(moderationPath)) {
        startProcess('MODERACIÓN', nodeExe, [moderationPath], basePath);
    } else {
        console.error("⚠️ No se encontró moderation.js en:", moderationPath);
    }
}

// Handlers IPC para la interfaz
ipcMain.handle('start-servers', () => {
    launchBackendServers();
    return true;
});

ipcMain.handle('load-file', (event, filePath) => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
        win.loadFile(filePath);
        return true;
    }
    return false;
});

ipcMain.handle('get-logs', () => {
    return globalLogs;
});

// Crear ventana principal de la app
function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'Stream Overlay Pro',
        backgroundColor: '#0e0e10',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.webContents.on('devtools-opened', () => {
        win.webContents.closeDevTools();
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.includes('livecenter.tiktok.com')) {
            openBrowserWindow(url);
        } 
        else if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    // RESOLUCIÓN DE RUTAS PARA panel.html
    let panelPath;
    if (app.isPackaged) {
        panelPath = path.join(process.resourcesPath, 'extras', 'public', 'panel.html');
    } else {
        panelPath = path.join(__dirname, 'public', 'panel.html');
        if (!fs.existsSync(panelPath)) {
            panelPath = path.join(__dirname, 'extras', 'public', 'panel.html');
        }
    }

    if (fs.existsSync(panelPath)) {
        win.loadFile(panelPath);
    } else {
        console.error("❌ No se encontró panel.html localmente, cargando desde http://localhost:" + process.env.PORT);
        win.loadURL(`http://localhost:${process.env.PORT}`);
    }

    return win;
}

// ================================================================
// 🚀 INICIO DE LA APLICACIÓN (ARRANQUE AUTOMÁTICO)
// ================================================================
app.whenReady().then(() => {
    // 1. Iniciar servidores de backend inmediatamente
    launchBackendServers();

    // 2. Dar un tiempo (2.5s) a Node.js para que escuche en el puerto antes de renderizar la ventana
    setTimeout(() => {
        createWindow();
    }, 2500); 
});

app.on('window-all-closed', () => {
    closeAllProcesses();
});

app.on('before-quit', () => {
    closeAllProcesses();
});

process.on('SIGINT', () => {
    closeAllProcesses();
});

process.on('exit', () => {
    closeAllProcesses();
});