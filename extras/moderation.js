// moderation.js - Sistema de moderación central (BACKEND - Puerto 3001)
require('dotenv').config();
const socketIO = require('socket.io');
const http = require('http');
const express = require('express');
const socketIOClient = require('socket.io-client');
const fs = require('fs');

class ModerationSystem {
  constructor() {
    this.bannedUsers = new Map();
    this.warnings = new Map();
    this.moderators = new Set(process.env.MODERATORS?.split(',') || ['admin']);
    this.modActions = [];
    this.filterWords = new Set(['spam', 'insulto', 'ofensa', 'odio']);
    
    // 🔥 Obtener configuración del usuario desde config.json
    let userConfig = {};
    try {
      if (fs.existsSync('./config.json')) {
        userConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
      }
    } catch (e) {
      console.log("⚠️ No se pudo leer config.json, usando variables de entorno.");
    }

    // Canal principal
    this.mainChannel = userConfig.TWITCH_CHANNEL || process.env.TWITCH_CHANNEL || 'togikirei';

    // 🔥 Conectar al servidor principal
    this.mainSocket = socketIOClient(`http://localhost:${process.env.PORT || 3000}`);
    
    this.mainSocket.on('connect', () => {
      console.log(`✅ Conectado al servidor principal (canal: ${this.mainChannel})`);
      this.mainSocket.emit('connect-twitch', { channel: this.mainChannel });
    });

    this.mainSocket.on('disconnect', () => {
      console.log('🔌 Desconectado del servidor principal');
    });

    this.initServer();
  }

  initServer() {
    const app = express();
    this.server = http.createServer(app);
    this.io = socketIO(this.server, {
      cors: { origin: "*" }
    });

    const PORT = process.env.MODERATION_PORT || 3001;
    
    // Ruta para que el overlay obtenga la configuración
    app.get('/get-config', (req, res) => {
      res.json({
        bannedUsers: Array.from(this.bannedUsers.keys()),
        warnings: Array.from(this.warnings.entries()),
        filterWords: Array.from(this.filterWords),
        modActions: this.modActions.slice(-10),
        moderators: Array.from(this.moderators)
      });
    });

    // Ruta de salud (para detectar instancia duplicada)
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', service: 'moderation' });
    });

    // ================================================================
    // 🚀 ARRANQUE ANTI-BUCLE
    // ================================================================
    this.server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Puerto ${PORT} ocupado. Ya hay una moderación corriendo. Saliendo.`);
        process.exit(0); // 🔥 código 0 = NO reiniciar
      } else {
        console.error('❌ Error del servidor de moderación:', err);
        process.exit(1);
      }
    });

    this.server.listen(PORT, () => {
      console.log(`🛡️ Sistema de moderación en http://localhost:${PORT}`);
    });

    this.io.on('connection', (socket) => {
      console.log(`🟢 Moderador conectado: ${socket.id}`);
      
      // Autenticación de moderador
      socket.on('auth-mod', (data) => {
        try {
          const { username, password } = data;
          if (!username || !password) {
            socket.emit('auth-error', { success: false, message: 'Usuario o contraseña faltantes' });
            return;
          }

          if (password === process.env.MOD_PASSWORD) {
            this.moderators.add(username);
            socket.emit('auth-success', { success: true, username });
            socket.join('moderators');
          } else {
            socket.emit('auth-error', { success: false, message: 'Credenciales inválidas' });
          }
        } catch (error) {
          socket.emit('auth-error', { success: false, message: 'Error interno al autenticar' });
        }
      });
      
      // Comandos de moderación
      socket.on('mod-command', (command) => {
        this.handleModCommand(command, socket);
      });
      
      // Obtener lista de baneados
      socket.on('get-banned-list', () => {
        socket.emit('banned-list', Array.from(this.bannedUsers.keys()));
      });

      socket.on('disconnect', () => {
        // Silencioso para no llenar la consola
      });
    });
  }

  handleModCommand(command, socket) {
    try {
      const { action, username, reason, seconds, modName } = command;

      // Reenviar al servidor principal para ejecutar en Twitch
      this.mainSocket.emit('mod-command', command);
      
      switch (action) {
        case 'ban': {
          const banResult = this.banUser(username, reason, modName);
          socket.emit('command-result', banResult);
          break;
        }
        case 'unban': {
          const unbanResult = this.unbanUser(username);
          socket.emit('command-result', unbanResult);
          break;
        }
        case 'timeout': {
          const timeoutResult = this.timeoutUser(username, seconds || 600, reason);
          socket.emit('command-result', timeoutResult);
          break;
        }
        case 'warn': {
          const warnResult = this.warnUser(username, reason);
          socket.emit('command-result', warnResult);
          break;
        }
        case 'add_filter': {
          this.filterWords.add(username.toLowerCase());
          socket.emit('command-result', { success: true, message: `Palabra filtrada: ${username}` });
          break;
        }
        default:
          socket.emit('command-result', { success: false, message: `Acción no reconocida: ${action}` });
      }
    } catch (error) {
      console.error('Error en handleModCommand:', error);
      socket.emit('command-result', { success: false, message: 'Error interno al ejecutar comando' });
    }
  }

  banUser(username, reason, modName) {
    this.bannedUsers.set(username.toLowerCase(), {
      reason: reason || 'Violación de reglas',
      bannedBy: modName || 'Sistema',
      timestamp: Date.now()
    });
    
    this.logAction('ban', username, modName, reason);
    return { success: true, message: `${username} baneado` };
  }

  unbanUser(username) {
    this.bannedUsers.delete(username.toLowerCase());
    this.logAction('unban', username, 'Sistema');
    return { success: true, message: `${username} desbaneado` };
  }

  timeoutUser(username, seconds, reason) {
    this.bannedUsers.set(username.toLowerCase(), {
      reason: `Timeout ${seconds}s`,
      timestamp: Date.now() + (seconds * 1000)
    });
    
    setTimeout(() => {
      this.bannedUsers.delete(username.toLowerCase());
    }, seconds * 1000);
    
    this.logAction('timeout', username, 'Sistema', `${seconds}s`);
    return { success: true, message: `${username} timeout ${seconds}s` };
  }

  warnUser(username, reason) {
    const warnings = (this.warnings.get(username.toLowerCase()) || 0) + 1;
    this.warnings.set(username.toLowerCase(), warnings);
    
    this.logAction('warn', username, 'Sistema', reason);
    
    if (warnings >= 3) {
      return this.banUser(username, 'Demasiadas advertencias', 'AutoMod');
    }
    
    return { success: true, message: `${username} advertido (${warnings}/3)` };
  }

  logAction(action, target, mod, reason) {
    this.modActions.push({
      action,
      target,
      moderator: mod || 'Sistema',
      reason: reason || '',
      timestamp: Date.now()
    });
    
    console.log(`📝 [MOD] ${mod || 'Sistema'} ${action} a ${target}: ${reason || ''}`);
  }
}

// ================================================================
// 🔍 DETECCIÓN DE INSTANCIA DUPLICADA
// ================================================================
function checkExistingInstance(port, callback) {
  const req = http.get(`http://localhost:${port}/health`, (res) => {
    res.resume();
    callback(res.statusCode === 200);
  });
  req.on('error', () => callback(false));
  req.setTimeout(1500, () => { req.destroy(); callback(false); });
}

// ================================================================
// 🚀 ARRANQUE
// ================================================================
const MOD_PORT = process.env.MODERATION_PORT || 3001;

checkExistingInstance(MOD_PORT, (exists) => {
  if (exists) {
    console.log(`✅ Ya hay una moderación corriendo en el puerto ${MOD_PORT}. Saliendo limpiamente.`);
    process.exit(0); // 🔥 código 0 = NO reiniciar
  }
  // Solo instanciar si no hay otra instancia
  const moderation = new ModerationSystem();

  // ================================================================
  // 🛑 CIERRE LIMPIO (Graceful Shutdown)
  // ================================================================
  let shuttingDown = false;

  function shutdown(reason = 'unknown') {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n🛑 Cerrando moderación (${reason})...`);

    try { moderation.mainSocket.disconnect(); } catch (e) {}
    try { moderation.mainSocket.close(); } catch (e) {}
    try { moderation.io.close(); } catch (e) {}

    try {
      moderation.server.close(() => {
        console.log('✅ Moderación cerrada correctamente.');
        process.exit(0);
      });
    } catch (e) {
      process.exit(0);
    }

    setTimeout(() => {
      console.log('⚠️ Forzando salida de moderación...');
      process.exit(0);
    }, 2000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT (Ctrl+C)'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGBREAK', () => shutdown('SIGBREAK (Ctrl+Break)'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception en moderación:', err);
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Unhandled Rejection (ignorado):', reason);
  });

  process.on('exit', () => {
    try { moderation.mainSocket.disconnect(); } catch (e) {}
  });
});