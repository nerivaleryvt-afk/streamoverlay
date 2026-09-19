// ================================================================
// valconfig.js - Gestión de perfiles de configuración de Valorant
// ================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const VALORANT_CONFIG_ROOT = path.join(
    process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'),
    'VALORANT', 'Saved', 'Config'
);

const USER_DATA_ROOT = process.env.APP_USER_DATA || process.cwd();
const PROFILES_ROOT = path.join(USER_DATA_ROOT, 'valorant-profiles');

const FILES_TO_MANAGE = [
    'RiotUserSettings.ini',
    'BackupKeybinds.json',
    'GameUserSettings.ini'
];

const VALORANT_PROCESSES = ['VALORANT', 'RiotClientServices', 'RiotClientCrashHandler'];
const MAX_PROFILES = 20;

const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const CARPETAS_NO_CUENTA = new Set(['WindowsClient', 'Windows', 'Config', 'Data']);

const INI_DEFAULTS = {
    'EAresStringSettingName::PushToTalkKey': 'V'
};

const KEYBIND_DEFAULTS = {
    'VOICE_TeamPTTAction':  'V',
    'VOICE_PartyPTTAction': 'U'
};

// ✨ Mapeo de acción → nombre en español (Valorant)
const KEYBIND_LABELS = {
    // Habilidades
    Activate_Ability1: 'Habilidad 1',
    Activate_Ability2: 'Habilidad 2',
    Activate_Ability3: 'Habilidad 3',
    Activate_Ultimate: 'Definitiva',
    Activate_Melee: 'Cuchillo',
    // Movimiento
    MoveForward: 'Avanzar',
    MoveBackward: 'Retroceder',
    MoveLeft: 'Moverse a la izquierda',
    MoveRight: 'Moverse a la derecha',
    Walk: 'Caminar',
    ToggleWalk: 'Alternar caminar',
    Jump: 'Saltar',
    Crouch: 'Agacharse',
    ToggleCrouch: 'Alternar agacharse',
    FlyUp: 'Volar hacia arriba',
    FlyDown: 'Volar hacia abajo',
    Ghost: 'Alternar Truco: Ghost',
    // Armas
    Fire: 'Disparo',
    AltFire: 'Disparo secundario',
    ToggleZoomLevel: 'Alternar nivel de zoom',
    Reload: 'Recargar',
    InspectWeapon: 'Inspeccionar',
    // Equipamiento
    EquipPrimary: 'Equipar arma principal',
    EquipSecondary: 'Equipar secundaria',
    EquipMelee: 'Equipar melee',
    EquipSpike: 'Equipar Spike',
    NextWeapon: 'Cambiar a arma siguiente',
    PrevWeapon: 'Cambiar a arma anterior',
    DropWeapon: 'Soltar arma',
    EquipLastWeaponUsed: 'Equipar última arma usada',
    // Interacción
    UseObject: 'Interactuar (Mantener)',
    UseAlternateObject: 'Plantar/Desactivar Spike',
    ShowExtendedInfo: 'Mostrar equipamiento compañeros',
    // Interfaz
    CombatReport: 'Reporte de combate',
    ShowAbilities: 'Descripción de habilidades',
    OpenShop: 'Abrir arsenal',
    OpenMegamap: 'Abrir mapa',
    ShowScoreboard: 'Mostrar marcador',
    ToggleCursor: 'Alternar cursor',
    Ping: 'Alerta',
    VoteOption1: 'Opción de voto 1',
    VoteOption2: 'Opción de voto 2',
    VoteOption3: 'Opción de voto 3',
    VoteOption4: 'Opción de voto 4',
    // Comunicación
    VOICE_TeamPTTAction: 'Presionar para hablar',
    VOICE_PartyPTTAction: 'Chat de voz de grupo',
    // Radio
    RadioMenuOpen: 'Menú de comandos de radio',
    RadioWheelOpen: 'Rueda de comandos de radio'
};

// Categorías (orden de aparición)
const KEYBIND_CATEGORIES = [
    { label: 'Habilidades', keys: ['Activate_Ability1','Activate_Ability2','Activate_Ability3','Activate_Ultimate','Activate_Melee'] },
    { label: 'Movimiento',  keys: ['MoveForward','MoveBackward','MoveLeft','MoveRight','Walk','ToggleWalk','Jump','Crouch','ToggleCrouch','FlyUp','FlyDown','Ghost'] },
    { label: 'Armas',       keys: ['Fire','AltFire','ToggleZoomLevel','Reload','InspectWeapon'] },
    { label: 'Equipamiento',keys: ['EquipPrimary','EquipSecondary','EquipMelee','EquipSpike','NextWeapon','PrevWeapon','DropWeapon','EquipLastWeaponUsed'] },
    { label: 'Interacción', keys: ['UseObject','UseAlternateObject','ShowExtendedInfo'] },
    { label: 'Interfaz',    keys: ['CombatReport','ShowAbilities','OpenShop','OpenMegamap','ShowScoreboard','ToggleCursor','Ping','VoteOption1','VoteOption2','VoteOption3','VoteOption4'] },
    { label: 'Comunicación',keys: ['VOICE_TeamPTTAction','VOICE_PartyPTTAction'] },
    { label: 'Radio',       keys: ['RadioMenuOpen','RadioWheelOpen'] }
];

// Teclas cloud (no aplicables automáticamente)
// TODAS las teclas de Valorant son cloud (Riot las sincroniza)
const CLOUD_KEYS = new Set(Object.keys(KEYBIND_LABELS));

try {
    fs.mkdirSync(PROFILES_ROOT, { recursive: true });
} catch (e) {}

// ─────────────────────────────────────────────────────────────
// DETECCIÓN DE LA CUENTA RIOT ACTIVA
// ─────────────────────────────────────────────────────────────
function getCurrentRiotAccount() {
    const localAppData = process.env.LOCALAPPDATA || '';
    if (!localAppData) return null;

    const candidates = [
        path.join(localAppData, 'Riot Games', 'Riot Client', 'Data', 'RiotGamesPrivateSettings.yaml'),
        path.join(localAppData, 'Riot Games', 'Riot Client', 'Data', 'RiotClientSettings.yaml'),
        path.join(localAppData, 'Riot Games', 'Riot Client', 'Config', 'RiotClientSettings.yaml'),
    ];

    for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        try {
            const content = fs.readFileSync(file, 'utf8');

            const idTokenMatch = content.match(/id_token:\s*"([^"]+)"/);
            if (idTokenMatch) {
                const jwt = idTokenMatch[1];
                const parts = jwt.split('.');
                if (parts.length === 3) {
                    try {
                        let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                        while (b64.length % 4) b64 += '=';
                        const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
                        if (payload && payload.acct) {
                            const name = payload.acct.game_name || payload.acct.gameName;
                            const tag  = payload.acct.tag_line  || payload.acct.tagLine || '';
                            const puuid = payload.sub || '';
                            if (name) return { name, tag, puuid };
                        }
                    } catch (e) {}
                }
            }

            const nameMatch = content.match(/game_name:\s*"?([^"\n\r]+)"?/i);
            const tagMatch  = content.match(/(?:game_tag|tag_line):\s*"?([^"\n\r]+)"?/i);
            const puuidMatch = content.match(/puuid:\s*"?([^"\n\r]+)"?/i);
            const displayMatch = content.match(/display_name:\s*"?([^"\n\r]+)"?/i);

            let name = null, tag = '', puuid = '';

            if (nameMatch) {
                name = nameMatch[1].trim();
                tag = tagMatch ? tagMatch[1].trim() : '';
            } else if (displayMatch) {
                const full = displayMatch[1].trim();
                const parts = full.split('#');
                name = parts[0];
                tag = parts[1] || '';
            }

            if (puuidMatch) puuid = puuidMatch[1].trim();
            if (name) return { name, tag, puuid };
        } catch (e) {
            console.error('[valconfig] Error leyendo cuenta Riot:', e.message);
        }
    }
    return null;
}

function getActiveAccountGuid(accounts) {
    const riot = getCurrentRiotAccount();
    if (!riot || !riot.puuid) return null;
    const puuid = riot.puuid.toLowerCase();
    const match = accounts.find(a => a.guid.toLowerCase().startsWith(puuid));
    return match ? match.guid : null;
}

function hashToHue(str) {
    let h = 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h) % 360;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function isValorantRunning() {
    try {
        const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', windowsHide: true, timeout: 3000 });
        const running = [];
        for (const name of VALORANT_PROCESSES) {
            const re = new RegExp(`"${name}\\.exe"`, 'i');
            if (re.test(out)) running.push(name);
        }
        return { running: running.length > 0, processes: running };
    } catch (e) {
        return { running: false, processes: [], error: e.message };
    }
}

function findValorantAccounts() {
    if (!fs.existsSync(VALORANT_CONFIG_ROOT)) return [];
    const accounts = [];
    try {
        const entries = fs.readdirSync(VALORANT_CONFIG_ROOT, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (CARPETAS_NO_CUENTA.has(entry.name)) continue;
            if (!GUID_REGEX.test(entry.name)) continue;

            const guidFolder = path.join(VALORANT_CONFIG_ROOT, entry.name);
            const account = { guid: entry.name, folderPath: guidFolder, files: {}, allFiles: {}, lastModified: 0 };

            for (const fileName of FILES_TO_MANAGE) {
                const found = findAllFilesRecursive(guidFolder, fileName);
                if (found.length > 0) {
                    account.files[fileName] = found[0].path;
                    account.allFiles[fileName] = found.map(f => f.path);
                    if (found[0].mtime > account.lastModified) account.lastModified = found[0].mtime;
                }
            }
            if (Object.keys(account.files).length > 0) accounts.push(account);
        }
    } catch (e) {
        console.error('[valconfig] Error listando cuentas:', e.message);
    }
    accounts.sort((a, b) => b.lastModified - a.lastModified);
    return accounts;
}

function findAllFilesRecursive(rootDir, fileName) {
    const stack = [rootDir];
    const target = fileName.toLowerCase();
    const matches = [];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch (e) { continue; }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.name.toLowerCase() === target) {
                try {
                    const stat = fs.statSync(fullPath);
                    matches.push({ path: fullPath, mtime: stat.mtimeMs });
                } catch (e) {}
            }
        }
    }
    matches.sort((a, b) => b.mtime - a.mtime);
    return matches;
}

function hashFile(filePath) {
    try {
        const data = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(data).digest('hex');
    } catch (e) { return null; }
}

function readKeySettings(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        const content = fs.readFileSync(filePath, 'utf8');
        const get = (key) => {
            const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const m = content.match(new RegExp(`^${safe}=(.+)$`, 'm'));
            return m ? m[1].trim() : null;
        };
        return {
            sensitivity:        get('EAresFloatSettingName::MouseSensitivity'),
            sensitivityADS:     get('EAresFloatSettingName::MouseSensitivityADS'),
            crosshairColor:     get('EAresStringSettingName::CrosshairColor'),
            crosshairProfile:   get('EAresStringSettingName::CrosshairProfileName'),
            colorBlindMode:     get('EAresIntSettingName::ColorBlindMode'),
            voiceVolume:        get('EAresIntSettingName::VoiceVolume'),
            micVolume:          get('EAresIntSettingName::MicVolume'),
            resolutionX:        get('ResolutionSizeX'),
            resolutionY:        get('ResolutionSizeY'),
            fullscreenMode:     get('FullscreenMode'),
            pushToTalkKey:      get('EAresStringSettingName::PushToTalkKey')
        };
    } catch (e) { return null; }
}

function sanitizeProfileName(name) {
    if (typeof name !== 'string') return null;
    const clean = name.trim();
    if (clean.length === 0 || clean.length > 40) return null;
    if (!/^[a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ ]+$/.test(clean)) return null;
    if (clean.includes('..') || clean.includes('/') || clean.includes('\\')) return null;
    return clean;
}

function readProfileMeta(profilePath) {
    try {
        const metaPath = path.join(profilePath, 'meta.json');
        if (fs.existsSync(metaPath)) return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (e) {}
    return null;
}

function countProfileFiles(profilePath) {
    let count = 0;
    for (const f of FILES_TO_MANAGE) {
        if (fs.existsSync(path.join(profilePath, f))) count++;
    }
    return count;
}

// ─────────────────────────────────────────────────────────────
// APPLY CON DEFAULTS
// ─────────────────────────────────────────────────────────────
function applyIniWithDefaults(srcPath, dstPath) {
    let content = fs.readFileSync(srcPath, 'utf8');
    const added = [];
    for (const [key, def] of Object.entries(INI_DEFAULTS)) {
        const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`^${safe}=`, 'm');
        if (!re.test(content)) {
            content = content.trimEnd() + `\n${key}=${def}\n`;
            added.push(key);
        }
    }
    fs.writeFileSync(dstPath, content, 'utf8');
    return added;
}

function applyKeybindsWithDefaults(srcPath, dstPath) {
    const raw = fs.readFileSync(srcPath, 'utf8');
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { fs.copyFileSync(srcPath, dstPath); return []; }

    if (!Array.isArray(data.actionMappings)) data.actionMappings = [];
    const existing = new Set(data.actionMappings.map(m => m && m.name).filter(Boolean));
    const added = [];

    for (const [name, defaultKey] of Object.entries(KEYBIND_DEFAULTS)) {
        if (!existing.has(name)) {
            data.actionMappings.push({
                name, characterName: 'None', bindIndex: 0, key: defaultKey,
                shift: false, ctrl: false, alt: false, cmd: false, tapHoldType: 'None'
            });
            added.push(name);
        }
    }
    fs.writeFileSync(dstPath, JSON.stringify(data, null, '\t'), 'utf8');
    return added;
}

// ─────────────────────────────────────────────────────────────
// RUTAS EXPRESS
// ─────────────────────────────────────────────────────────────
module.exports = function registerValConfig(app) {

    app.get('/api/valconfig/status', (req, res) => {
        try {
            const game = isValorantRunning();
            const accounts = findValorantAccounts();
            const riotAccount = getCurrentRiotAccount();
            const activeGuid = getActiveAccountGuid(accounts);
            const active = activeGuid ? accounts.find(a => a.guid === activeGuid) : accounts[0];

            res.json({
                ok: true,
                valorantRunning: game.running,
                processes: game.processes,
                accountsFound: accounts.length,
                activeAccount: active ? {
                    guid: active.guid,
                    filesFound: Object.keys(active.files).length,
                    files: Object.keys(active.files),
                    paths: active.files,
                    allPaths: active.allFiles
                } : null,
                riotAccount,
                configRoot: VALORANT_CONFIG_ROOT,
                profilesRoot: PROFILES_ROOT
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/api/valconfig/current-account', (req, res) => {
        try {
            res.json({ ok: true, account: getCurrentRiotAccount() });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/api/valconfig/profiles', (req, res) => {
        try {
            if (!fs.existsSync(PROFILES_ROOT)) return res.json({ ok: true, profiles: [] });
            const entries = fs.readdirSync(PROFILES_ROOT, { withFileTypes: true });
            const profiles = [];

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const profilePath = path.join(PROFILES_ROOT, entry.name);
                const meta = readProfileMeta(profilePath);
                const fileCount = countProfileFiles(profilePath);
                let totalSize = 0;
                for (const f of FILES_TO_MANAGE) {
                    try {
                        const p = path.join(profilePath, f);
                        if (fs.existsSync(p)) totalSize += fs.statSync(p).size;
                    } catch (e) {}
                }
                const riotName = meta?.originRiotName || null;
                const riotTag = meta?.originRiotTag || null;
                const hue = riotName ? hashToHue(riotName) : 140;

                profiles.push({
                    name: entry.name, fileCount, totalFiles: FILES_TO_MANAGE.length, totalSize,
                    createdAt: meta?.createdAt || null, originGuid: meta?.originGuid || null,
                    originLabel: meta?.originLabel || null, originRiotName: riotName,
                    originRiotTag: riotTag, hue
                });
            }

            profiles.sort((a, b) => {
                const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return tb - ta;
            });
            res.json({ ok: true, profiles });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ✨ NUEVO: leer keybinds de un perfil
    app.get('/api/valconfig/profiles/:name/keybinds', (req, res) => {
        try {
            const name = sanitizeProfileName(req.params.name);
            if (!name) return res.status(400).json({ ok: false, error: 'Nombre inválido.' });

            const kbPath = path.join(PROFILES_ROOT, name, 'BackupKeybinds.json');
            if (!fs.existsSync(kbPath)) {
                return res.json({ ok: true, keybinds: [], categories: [] });
            }

            const data = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
            const mappings = Array.isArray(data.actionMappings) ? data.actionMappings : [];

            const byName = new Map();
            for (const m of mappings) {
                if (!m || !m.name) continue;
                byName.set(m.name, m.key);
            }

            const keybinds = [];
            const categories = [];
            const seen = new Set();

            for (const cat of KEYBIND_CATEGORIES) {
                const items = [];
                for (const key of cat.keys) {
                    const mappedKey = byName.get(key) || null;
                    const item = {
                        name: key,
                        label: KEYBIND_LABELS[key] || key,
                        key: mappedKey,
                        defined: mappedKey !== null,
                        cloud: CLOUD_KEYS.has(key)
                    };
                    items.push(item);
                    keybinds.push(item);
                    seen.add(key);
                }
                if (items.length > 0) {
                    categories.push({ label: cat.label, items });
                }
            }

            // Añadir las que no estén en ninguna categoría
            for (const [name, k] of byName.entries()) {
                if (seen.has(name)) continue;
                const item = {
                    name,
                    label: KEYBIND_LABELS[name] || name,
                    key: k,
                    defined: true,
                    cloud: CLOUD_KEYS.has(name)
                };
                keybinds.push(item);
                categories.push({ label: 'Otras', items: [item] });
            }

            res.json({ ok: true, keybinds, categories });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/valconfig/profiles', (req, res) => {
        try {
            const rawName = (req.body && req.body.name) || '';
            const name = sanitizeProfileName(rawName);
            if (!name) return res.status(400).json({ ok: false, error: 'Nombre inválido. Usa solo letras, números, espacios, - o _. Máx 40 caracteres.' });

            const game = isValorantRunning();
            if (game.running && !req.body.force) {
                return res.status(409).json({ ok: false, error: `Valorant está abierto (${game.processes.join(', ')}). Cerralo antes de guardar.`, running: true });
            }

            const accounts = findValorantAccounts();
            if (accounts.length === 0) return res.status(404).json({ ok: false, error: 'No se encontró ninguna cuenta de Valorant en disco.' });

            const activeGuid = getActiveAccountGuid(accounts) || accounts[0].guid;
            const active = accounts.find(a => a.guid === activeGuid) || accounts[0];

            const filesFound = Object.keys(active.files);
            if (filesFound.length === 0) return res.status(404).json({ ok: false, error: 'No se encontró ningún archivo de configuración para guardar.' });

            const profilePath = path.join(PROFILES_ROOT, name);
            if (fs.existsSync(profilePath)) return res.status(409).json({ ok: false, error: `Ya existe un perfil llamado "${name}". Elegí otro nombre o borralo primero.` });

            const existing = fs.readdirSync(PROFILES_ROOT, { withFileTypes: true }).filter(e => e.isDirectory()).length;
            if (existing >= MAX_PROFILES) return res.status(429).json({ ok: false, error: `Ya tenés ${MAX_PROFILES} perfiles guardados. Borrá alguno antes de crear otro.` });

            fs.mkdirSync(profilePath, { recursive: true });
            const copied = [], failed = [];
            for (const fileName of FILES_TO_MANAGE) {
                const srcPath = active.files[fileName];
                if (!srcPath) { failed.push({ file: fileName, reason: 'no encontrado' }); continue; }
                try {
                    fs.copyFileSync(srcPath, path.join(profilePath, fileName));
                    copied.push(fileName);
                } catch (e) {
                    failed.push({ file: fileName, reason: e.message });
                }
            }

            if (copied.length === 0) {
                try { fs.rmdirSync(profilePath); } catch (e) {}
                return res.status(500).json({ ok: false, error: 'No se pudo copiar ningún archivo.', failed });
            }

            const riotAccount = getCurrentRiotAccount();
            const meta = {
                name, createdAt: new Date().toISOString(), originGuid: active.guid,
                originLabel: riotAccount ? `${riotAccount.name}${riotAccount.tag ? '#' + riotAccount.tag : ''}` : `Cuenta ${active.guid.substring(0, 8)}`,
                originRiotName: riotAccount ? riotAccount.name : null,
                originRiotTag: riotAccount ? riotAccount.tag : null,
                originRiotPuuid: riotAccount ? riotAccount.puuid : null,
                files: copied
            };
            fs.writeFileSync(path.join(profilePath, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

            res.json({
                ok: true,
                profile: { name, fileCount: copied.length, totalFiles: FILES_TO_MANAGE.length, originRiotName: meta.originRiotName, originRiotTag: meta.originRiotTag },
                copied, failed
            });
        } catch (e) {
            console.error('[valconfig] Error guardando perfil:', e.message);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/valconfig/profiles/:name/apply', (req, res) => {
        try {
            const name = sanitizeProfileName(req.params.name);
            if (!name) return res.status(400).json({ ok: false, error: 'Nombre inválido.' });

            const profilePath = path.join(PROFILES_ROOT, name);
            if (!fs.existsSync(profilePath)) return res.status(404).json({ ok: false, error: `No existe el perfil "${name}".` });

            const game = isValorantRunning();
            if (game.running && !req.body.force) {
                return res.status(409).json({ ok: false, error: `Valorant está abierto (${game.processes.join(', ')}). Cerralo antes de aplicar.`, running: true });
            }

            const accounts = findValorantAccounts();
            if (accounts.length === 0) return res.status(404).json({ ok: false, error: 'No se encontró ninguna cuenta de Valorant en disco.' });

            const targetGuid = req.body && req.body.guid;
            const riotGuid = getActiveAccountGuid(accounts);
            const activeGuid = targetGuid || riotGuid || accounts[0].guid;
            const active = accounts.find(a => a.guid === activeGuid) || accounts[0];

            const riotAcc = getCurrentRiotAccount();
            const origen = targetGuid ? 'forzada' : (riotAcc && riotAcc.name ? `Riot: ${riotAcc.name}${riotAcc.tag ? '#' + riotAcc.tag : ''}` : 'fallback');
            console.log(`[valconfig] 🎯 Aplicando a cuenta: ${active.guid} (${origen})`);

            const applied = [], failed = [], replacedDefaults = [];

            for (const fileName of FILES_TO_MANAGE) {
                const srcPath = path.join(profilePath, fileName);
                if (!fs.existsSync(srcPath)) { failed.push({ file: fileName, reason: 'no está en el perfil' }); continue; }

                const targets = (active.allFiles && active.allFiles[fileName]) || (active.files[fileName] ? [active.files[fileName]] : []);
                if (targets.length === 0) { failed.push({ file: fileName, reason: 'no está en la cuenta activa' }); continue; }

                let anyOk = false;
                for (const dstPath of targets) {
                    try {
                        const preBackup = dstPath + '.togibak';
                        try { fs.copyFileSync(dstPath, preBackup); } catch (e) {}

                        if (fileName === 'RiotUserSettings.ini') {
                            const added = applyIniWithDefaults(srcPath, dstPath);
                            for (const k of added) replacedDefaults.push(k.split('::').pop());
                        } else if (fileName === 'BackupKeybinds.json') {
                            const added = applyKeybindsWithDefaults(srcPath, dstPath);
                            for (const k of added) replacedDefaults.push(k);
                        } else {
                            fs.copyFileSync(srcPath, dstPath);
                        }

                        anyOk = true;
                        console.log(`[valconfig] ✅ Aplicado: ${fileName} → ${dstPath}`);
                    } catch (e) {
                        console.log(`[valconfig] ❌ Error aplicando ${fileName} → ${dstPath}:`, e.message);
                        failed.push({ file: fileName, path: dstPath, reason: e.message });
                    }
                }
                if (anyOk) applied.push(fileName);
            }

            if (applied.length === 0) return res.status(500).json({ ok: false, error: 'No se pudo aplicar ningún archivo.', failed });

            const uniqueDefaults = [...new Set(replacedDefaults)];
            if (uniqueDefaults.length > 0) console.log(`[valconfig] 🔧 Defaults agregados: ${uniqueDefaults.join(', ')}`);

            res.json({ ok: true, profile: name, applied, failed, targetGuid: active.guid, replacedDefaults: uniqueDefaults });
        } catch (e) {
            console.error('[valconfig] Error aplicando perfil:', e.message);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/valconfig/profiles/:name/rename', (req, res) => {
        try {
            const oldName = sanitizeProfileName(req.params.name);
            const newName = sanitizeProfileName((req.body && req.body.newName) || '');
            if (!oldName || !newName) return res.status(400).json({ ok: false, error: 'Nombres inválidos.' });

            const oldPath = path.join(PROFILES_ROOT, oldName);
            const newPath = path.join(PROFILES_ROOT, newName);
            if (!fs.existsSync(oldPath)) return res.status(404).json({ ok: false, error: 'No existe el perfil original.' });
            if (fs.existsSync(newPath)) return res.status(409).json({ ok: false, error: 'Ya existe un perfil con ese nombre.' });

            fs.renameSync(oldPath, newPath);
            const meta = readProfileMeta(newPath);
            if (meta) {
                meta.name = newName;
                meta.renamedAt = new Date().toISOString();
                fs.writeFileSync(path.join(newPath, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
            }
            res.json({ ok: true, oldName, newName });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.delete('/api/valconfig/profiles/:name', (req, res) => {
        try {
            const name = sanitizeProfileName(req.params.name);
            if (!name) return res.status(400).json({ ok: false, error: 'Nombre inválido.' });
            const profilePath = path.join(PROFILES_ROOT, name);
            if (!fs.existsSync(profilePath)) return res.status(404).json({ ok: false, error: 'No existe ese perfil.' });
            fs.rmSync(profilePath, { recursive: true, force: true });
            res.json({ ok: true, deleted: name });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/valconfig/profiles/sync-accounts', (req, res) => {
        try {
            const riotAccount = getCurrentRiotAccount();
            if (!riotAccount) return res.status(404).json({ ok: false, error: 'No se pudo detectar la cuenta Riot activa.' });
            if (!fs.existsSync(PROFILES_ROOT)) return res.json({ ok: true, updated: 0 });

            const entries = fs.readdirSync(PROFILES_ROOT, { withFileTypes: true });
            let updated = 0;
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const profilePath = path.join(PROFILES_ROOT, entry.name);
                const meta = readProfileMeta(profilePath);
                if (!meta) continue;
                if (!meta.originRiotName) {
                    meta.originRiotName = riotAccount.name;
                    meta.originRiotTag = riotAccount.tag;
                    meta.originRiotPuuid = riotAccount.puuid;
                    meta.originLabel = `${riotAccount.name}${riotAccount.tag ? '#' + riotAccount.tag : ''}`;
                    meta.syncedAt = new Date().toISOString();
                    fs.writeFileSync(path.join(profilePath, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
                    updated++;
                }
            }
            res.json({ ok: true, updated, account: riotAccount });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/api/valconfig/active-match', (req, res) => {
        try {
            const accounts = findValorantAccounts();
            if (accounts.length === 0) return res.json({ ok: true, hasAccount: false });

            const activeGuid = getActiveAccountGuid(accounts) || accounts[0].guid;
            const active = accounts.find(a => a.guid === activeGuid) || accounts[0];

            const activeHashes = {};
            for (const fileName of FILES_TO_MANAGE) {
                const p = active.files[fileName];
                if (!p) continue;
                activeHashes[fileName] = hashFile(p);
            }

            const results = [];
            if (fs.existsSync(PROFILES_ROOT)) {
                const entries = fs.readdirSync(PROFILES_ROOT, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    const profilePath = path.join(PROFILES_ROOT, entry.name);
                    let matches = 0, total = 0;
                    const details = {};
                    for (const fileName of FILES_TO_MANAGE) {
                        const src = path.join(profilePath, fileName);
                        if (!fs.existsSync(src)) { details[fileName] = 'missing'; continue; }
                        total++;
                        const h = hashFile(src);
                        if (h && h === activeHashes[fileName]) { matches++; details[fileName] = 'match'; }
                        else { details[fileName] = 'diff'; }
                    }
                    if (total > 0) results.push({ name: entry.name, matches, total, details });
                }
            }

            results.sort((a, b) => b.matches - a.matches);
            const perfect = results.find(r => r.matches === r.total && r.total === FILES_TO_MANAGE.length) || null;

            const keySettings = active.files['RiotUserSettings.ini'] ? readKeySettings(active.files['RiotUserSettings.ini']) : null;

            res.json({
                ok: true,
                hasAccount: true,
                activeGuid: active.guid,
                filesFound: Object.keys(active.files).length,
                matchedProfile: perfect ? perfect.name : null,
                partials: results.filter(r => r.matches > 0 && r.matches < r.total),
                keySettings
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/api/valconfig/debug', (req, res) => {
        try {
            const accounts = findValorantAccounts();
            const riotAccount = getCurrentRiotAccount();
            const activeGuid = getActiveAccountGuid(accounts);
            const result = accounts.map(acc => ({
                guid: acc.guid, isActive: acc.guid === activeGuid,
                filesFound: Object.keys(acc.files).length, files: acc.files, allFiles: acc.allFiles,
                copiesPerFile: Object.fromEntries(Object.entries(acc.allFiles || {}).map(([k, v]) => [k, v.length])),
                lastModified: new Date(acc.lastModified).toISOString()
            }));
            res.json({ ok: true, configRoot: VALORANT_CONFIG_ROOT, expected: FILES_TO_MANAGE, riotAccount, activeGuid, accountsDetected: result });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    console.log(`🎮 [VALCONFIG] Perfiles de Valorant listos en: ${PROFILES_ROOT}`);
    console.log(`🔧 Defaults automáticos: ${Object.keys(INI_DEFAULTS).length} INI, ${Object.keys(KEYBIND_DEFAULTS).length} keybinds`);
    console.log(`⌨️  Mapeo de keybinds: ${Object.keys(KEYBIND_LABELS).length} acciones`);
};