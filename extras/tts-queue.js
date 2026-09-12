// tts-queue.js — Cola de mensajes para TTS
const engine = require('./tts-engine');

const PRIORITY = { donation: 10, gift: 10, sub: 8, follow: 5, cheer: 7, chat: 1 };

class TTSQueue {
    constructor(io) {
        this.io = io;
        this.items = [];
        this.processing = false;
        this.current = null;
    }

    enqueue(item) {
        if (!item || !item.text) return;
        item.priority = PRIORITY[item.type] || 1;
        this.items.push(item);
        this.items.sort((a, b) => b.priority - a.priority);
        this._next();
    }

    async _next() {
        if (this.processing) return;
        if (this.items.length === 0) return;

        this.processing = true;
        const item = this.items.shift();
        this.current = item;

        try {
            const { url, filename } = await engine.synthesize(item.text, item.options || {});
            this.io.emit('tts:speak', { url, filename, text: item.text });
            console.log(`🔊 [TTS] "${item.text.slice(0, 60)}${item.text.length > 60 ? '…' : ''}"`);
        } catch (e) {
            console.error('❌ [TTS] Error sintetizando:', e.message);
        } finally {
            this.current = null;
            this.processing = false;
            setImmediate(() => this._next());
        }
    }

    // El overlay avisa cuando terminó de reproducir
    done(filename) {
        if (filename) engine.cleanup(filename);
    }

    clear() {
        this.items = [];
    }
}

module.exports = { TTSQueue };