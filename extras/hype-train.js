// ================================================================
// 🚂 hype-train.js — Backend del Hype Train v2.1
// Estado, fórmula de niveles, gifts, timer, hitos, salvación,
// activación automática y emisión de sockets.
// ================================================================

// ================================================================
// 🎯 CONFIG POR DEFECTO (idéntica al DEFAULT_CONFIG del frontend)
// ================================================================
const HYPE_TRAIN_DEFAULTS = {
    theme: 'cyberpunk',
    duration: 300,              // segundos
    base: 100,
    factor: 1.4,
    themeChangeEvery: 5,
    maxVisibleWagons: 8,
    milestones: [5, 10, 15, 20, 30, 50],
    titles: [
        { min: 1,  name: 'Pasajero' },
        { min: 5,  name: 'Maquinista' },
        { min: 10, name: 'Capitán' },
        { min: 15, name: 'Comandante' },
        { min: 20, name: 'Leyenda' }
    ],
    gifts: { '🌹': 1, '🍩': 10, '🦁': 50, '🚀': 200, '👑': 500 },
    sounds: {
        enabled: true, volume: 0.4,
        activation: true, gift: true, levelUp: true,
        milestone: true, sprint: true, end: true, saved: true
    },
    display: {
        showTop3: true, showUniqueGifters: true,
        showRate: true, showTitles: true
    },
    timerRules: {
        resetOnLevelUp: true,
        bonusOnMilestone: 60,
        maxBonus: 300,
        savedThreshold: 15,
        showBonusText: true
    },
    activation: {
        giftsRequired: 3,
        windowMs: 5 * 60 * 1000,   // 3 gifts en 5 min
        enabled: true
    },
    platformPoints: {
        tiktok: 1,
        twitch: 1,
        kick: 1,
        youtube: 1
    }
};

// 🧹 NUEVO — Límite de contributors para podar el objeto.
// El overlay solo muestra el Top 3, así que guardar más de 100 no aporta nada.
// Esto evita que en trenes virales (miles de viewers) el objeto crezca sin control.
const MAX_CONTRIBUTORS = 100;

// ================================================================
// 🚂 CLASE HYPE TRAIN
// ================================================================
class HypeTrain {
    /**
     * @param {import('socket.io').Server} io
     * @param {() => object} getConfig
     */
    constructor(io, getConfig) {
        this.io = io;
        this.getConfig = typeof getConfig === 'function' ? getConfig : () => HYPE_TRAIN_DEFAULTS;

        this.state = this._estadoInicial();
        this._tickInterval = null;
        this._recentGifts = [];
        this._destroyed = false;

        console.log('🚂 [HYPE] Módulo inicializado');
    }

    // ------------------------------------------------------------
    _estadoInicial() {
        return {
            active: false,
            points: 0,
            level: 0,
            gifts: 0,
            uniqueGifters: new Set(),
            contributors: {},
            endsAt: 0,
            startedAt: 0,
            theme: null,
            bonusTime: 0,
            _lastSprintTick: 0,
            _wasUrgent: false,
            _saved: false,
            _finalized: false
        };
    }

    // ------------------------------------------------------------
    // Fórmula IDÉNTICA al frontend
    // pointsForLevel(n) = base * (factor^n - 1) / (factor - 1)
    // ------------------------------------------------------------
    pointsForLevel(n) {
        const cfg = this.getConfig();
        const base = Number(cfg.base) || 100;
        const factor = Number(cfg.factor) || 1.4;
        if (n <= 0) return 0;
        if (factor === 1) return base * n;
        return Math.floor(base * (Math.pow(factor, n) - 1) / (factor - 1));
    }

    levelForPoints(points) {
        let level = 0;
        while (level < 1000 && points >= this.pointsForLevel(level + 1)) {
            level++;
        }
        return level;
    }

    // ------------------------------------------------------------
    titleForLevel(level) {
        const cfg = this.getConfig();
        const titles = Array.isArray(cfg.titles) && cfg.titles.length
            ? cfg.titles
            : HYPE_TRAIN_DEFAULTS.titles;
        let titulo = titles[0]?.name || 'Pasajero';
        for (const t of titles) {
            if (level >= (t.min || 1)) titulo = t.name;
        }
        return titulo;
    }

    // ------------------------------------------------------------
    themeForLevel(level) {
        const cfg = this.getConfig();
        const temas = ['cyberpunk', 'cristal', 'minimal', 'tiktok'];
        const base = cfg.theme || 'cyberpunk';
        const each = Math.max(1, Number(cfg.themeChangeEvery) || 5);
        const idxBase = temas.indexOf(base);
        if (idxBase === -1) return base;
        const saltos = Math.floor((level - 1) / each);
        if (saltos <= 0) return base;
        return temas[(idxBase + saltos) % temas.length];
    }

    // ------------------------------------------------------------
    getState() {
        const s = this.state;
        return {
            active: s.active,
            points: s.points,
            level: s.level,
            gifts: s.gifts,
            uniqueGifters: s.uniqueGifters.size,
            contributors: s.contributors,
            endsAt: s.endsAt,
            startedAt: s.startedAt,
            theme: s.theme,
            bonusTime: s.bonusTime,
            title: this.titleForLevel(s.level),
            timeLeft: s.active ? Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000)) : 0
        };
    }

    top3() {
        const entries = Object.entries(this.state.contributors || {});
        entries.sort((a, b) => b[1] - a[1]);
        return entries.slice(0, 3).map(([username, points]) => ({ username, points }));
    }

    // ------------------------------------------------------------
    _registrarGiftParaActivacion() {
        const now = Date.now();
        this._recentGifts.push(now);
        const cfg = this.getConfig();
        const win = Number(cfg.activation?.windowMs) || HYPE_TRAIN_DEFAULTS.activation.windowMs;
        this._recentGifts = this._recentGifts.filter(t => now - t <= win);
        return this._recentGifts.length;
    }

    _debeActivar() {
        const cfg = this.getConfig();
        if (!cfg.activation || cfg.activation.enabled === false) return false;
        const req = Number(cfg.activation.giftsRequired) || 3;
        return this._registrarGiftParaActivacion() >= req;
    }

    // ------------------------------------------------------------
    start(extra = {}) {
        const cfg = this.getConfig();
        const duration = Number(cfg.duration) || 300;

        this.state = this._estadoInicial();
        this.state.active = true;
        this.state.startedAt = Date.now();
        this.state.endsAt = Date.now() + duration * 1000;
        this.state.theme = cfg.theme || 'cyberpunk';
        this.state._finalized = false;

        console.log(`🚂 [HYPE] Tren arrancado (duración ${duration}s, tema ${this.state.theme})`);

        this.io.emit('hype-train:start', {
            config: cfg,
            state: this.getState()
        });
        this.io.emit('hype-train:update', this.getState());

        this._arrancarTick();

        if (extra.reason) console.log(`   Motivo: ${extra.reason}`);
        return this.getState();
    }

    _arrancarTick() {
        if (this._tickInterval) return;
        this._tickInterval = setInterval(() => this._tick(), 1000);
    }

    _pararTick() {
        if (this._tickInterval) {
            clearInterval(this._tickInterval);
            this._tickInterval = null;
        }
    }

    // ------------------------------------------------------------
    _tick() {
        if (!this.state.active) return;
        const cfg = this.getConfig();
        const now = Date.now();
        const left = Math.max(0, Math.ceil((this.state.endsAt - now) / 1000));

        // Urgencia para detección de salvación
        const savedThreshold = Number(cfg.timerRules?.savedThreshold) || 15;
        this.state._wasUrgent = left > 0 && left <= savedThreshold;

        // Sprint tick en últimos 10s
        if (left <= 10 && left > 0 && cfg.sounds?.sprint) {
            if (this.state._lastSprintTick !== left) {
                this.state._lastSprintTick = left;
                this.io.emit('hype-train:sprint-tick', { left });
            }
        }

        if (left <= 0) this.end();
    }

    // ------------------------------------------------------------
    addGift({ giftName, points, username, platform = 'tiktok' } = {}) {
        if (this._destroyed) return;
        const cfg = this.getConfig();

        // Activación automática si no está activo
        if (!this.state.active) {
            const recientes = this._registrarGiftParaActivacion();
            const req = Number(cfg.activation?.giftsRequired) || 3;
            console.log(`🎁 [HYPE] Gift inactivo (${recientes}/${req}) — ${username} → ${giftName}`);
            if (this._debeActivar()) {
                this.start({ reason: `Auto: ${req} gifts en ventana` });
            } else {
                return;
            }
        }

        // Normalizar puntos
        const ptsBase = Number(points) || 0;
        const mult = Number(cfg.platformPoints?.[platform]) || 1;
        const pts = Math.max(0, Math.floor(ptsBase * mult));

        // Acumular
        this.state.points += pts;
        this.state.gifts += 1;
        if (username) {
            this.state.uniqueGifters.add(username);
            this.state.contributors[username] = (this.state.contributors[username] || 0) + pts;

            // 🧹 NUEVO — Poda del Top 100 si el objeto crece demasiado.
            // El overlay solo muestra el Top 3, así que guardar más de 100 no aporta.
            // Esto evita que en trenes virales el objeto crezca sin control.
            const totalContributors = Object.keys(this.state.contributors).length;
            if (totalContributors > MAX_CONTRIBUTORS) {
                const entradas = Object.entries(this.state.contributors)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, MAX_CONTRIBUTORS);
                this.state.contributors = Object.fromEntries(entradas);
                console.log(`🧹 [HYPE] Poda de contributors: ${totalContributors} → ${MAX_CONTRIBUTORS}`);
            }
        }

        // Level-up
        const nuevoNivel = this.levelForPoints(this.state.points);
        if (nuevoNivel > this.state.level) {
            this._procesarLevelUp(nuevoNivel);
        }

        // Emitir gift
        this.io.emit('hype-train:gift', {
            giftName: giftName || '🎁',
            points: pts,
            username: username || 'Anónimo',
            platform,
            level: this.state.level,
            totalPoints: this.state.points,
            state: this.getState()
        });

        this.io.emit('hype-train:update', this.getState());

        console.log(`🎁 [HYPE] +${pts} pts (${giftName}) de ${username} [nivel ${this.state.level}, total ${this.state.points}]`);
    }

    // ------------------------------------------------------------
    _procesarLevelUp(nuevoNivel) {
        const cfg = this.getConfig();
        const nivelAnterior = this.state.level;

        // ⚠️ Salvación: comprobar ANTES de resetear el timer
        const savedThreshold = Number(cfg.timerRules?.savedThreshold) || 15;
        const leftAntes = Math.max(0, Math.ceil((this.state.endsAt - Date.now()) / 1000));
        const fueSalvado = this.state._wasUrgent && leftAntes <= savedThreshold && leftAntes >= 0;

        this.state.level = nuevoNivel;
        this.state.theme = this.themeForLevel(nuevoNivel);

        // Reset del timer
        if (cfg.timerRules?.resetOnLevelUp !== false) {
            const duration = Number(cfg.duration) || 300;
            this.state.endsAt = Date.now() + duration * 1000;
            this.state.bonusTime = 0;
            this.state._lastSprintTick = 0;
            this.state._wasUrgent = false;
            console.log(`🚂 [HYPE] Level-up → reset de timer a ${duration}s`);
        }

        // Emitir SALVADO
        if (fueSalvado) {
            this.state._saved = true;
            this.io.emit('hype-train:saved', {
                level: nuevoNivel,
                points: this.state.points,
                savedAt: Date.now()
            });
            console.log(`✨ [HYPE] ¡SALVADO! (nivel ${nuevoNivel}, quedaban ${leftAntes}s)`);
        }

        // Hito
        this._checkMilestone(nuevoNivel);

        // Level-up
        this.io.emit('hype-train:level-up', {
            level: nuevoNivel,
            previousLevel: nivelAnterior,
            theme: this.state.theme,
            title: this.titleForLevel(nuevoNivel),
            points: this.state.points,
            state: this.getState()
        });

        console.log(`🚂 [HYPE] Level-up: ${nivelAnterior} → ${nuevoNivel} (tema: ${this.state.theme})`);
    }

    // ------------------------------------------------------------
    _checkMilestone(nivel) {
        const cfg = this.getConfig();
        const hitos = Array.isArray(cfg.milestones) ? cfg.milestones : HYPE_TRAIN_DEFAULTS.milestones;
        if (!hitos.includes(nivel)) return;

        const bonus = Number(cfg.timerRules?.bonusOnMilestone) || 60;
        const maxBonus = Number(cfg.timerRules?.maxBonus) || Number(cfg.duration) || 300;
        const actual = Number(this.state.bonusTime) || 0;
        const nuevoBonus = Math.min(maxBonus, actual + bonus);

        if (nuevoBonus > actual) {
            const delta = nuevoBonus - actual;
            this.state.bonusTime = nuevoBonus;
            this.state.endsAt += delta * 1000;
            console.log(`🎉 [HYPE] Hito nivel ${nivel}: +${delta}s (bonus total ${nuevoBonus}s)`);
        }

        this.io.emit('hype-train:milestone', {
            level: nivel,
            bonus,
            totalBonus: this.state.bonusTime,
            points: this.state.points,
            state: this.getState()
        });
    }

    // ------------------------------------------------------------
    end() {
        if (!this.state.active || this.state._finalized) return null;
        this.state._finalized = true;
        this.state.active = false;
        this._pararTick();

        const payload = {
            finalLevel: this.state.level,
            finalPoints: this.state.points,
            finalGifts: this.state.gifts,
            uniqueGifters: this.state.uniqueGifters.size,
            top3: this.top3(),
            duration: Date.now() - this.state.startedAt
        };

        this.io.emit('hype-train:end', payload);
        console.log(`🏁 [HYPE] Tren terminado. Nivel ${payload.finalLevel}, ${payload.finalPoints} pts, ${payload.finalGifts} gifts`);

        // Reset tras animación
        setTimeout(() => {
            if (this._destroyed) return;
            this.state = this._estadoInicial();
            this.io.emit('hype-train:update', this.getState());
        }, 8000);

        return payload;
    }

    // ------------------------------------------------------------
    reset() {
        this._pararTick();
        this._recentGifts = [];
        this.state = this._estadoInicial();
        this.io.emit('hype-train:update', this.getState());
        this.io.emit('hype-train:end', {
            finalLevel: 0, finalPoints: 0, finalGifts: 0,
            uniqueGifters: 0, top3: [], duration: 0, manual: true
        });
        console.log('🔄 [HYPE] Reset manual');
        return this.getState();
    }

    // ------------------------------------------------------------
    onConfigUpdated(nuevaConfig) {
        this.io.emit('hype-train:config-updated', nuevaConfig);
        console.log('🔧 [HYPE] Config actualizada y emitida');
    }

    // ------------------------------------------------------------
    destroy() {
        this._destroyed = true;
        this._pararTick();
        console.log('🛑 [HYPE] Módulo destruido');
    }
}

module.exports = { HypeTrain, HYPE_TRAIN_DEFAULTS };