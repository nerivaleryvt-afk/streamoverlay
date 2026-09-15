// ================================================================
// streamlabs-token.js - Lee tokens de Streamlabs Desktop
// ================================================================
const fs = require('fs');
const path = require('path');

function getLevelDbDir() {
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || '', 'slobs-client', 'Local Storage', 'leveldb');
    }
    if (process.platform === 'darwin') {
        return path.join(require('os').homedir(), 'Library', 'Application Support',
            'slobs-client', 'Local Storage', 'leveldb');
    }
    return null;
}

// Devuelve lista de { apiToken, username } de cuentas TikTok
function readStreamlabsTokens() {
    const dir = getLevelDbDir();
    if (!dir || !fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.log') || f.endsWith('.ldb'))
        .map(f => path.join(dir, f));

    const found = new Map(); // apiToken -> {apiToken, username}

    for (const file of files) {
        let content = '';
        try {
            content = fs.readFileSync(file, 'utf8').replace(/\u0000/g, '');
        } catch (e) { continue; }

        // ✅ Regex más flexible: acepta cualquier alfanumérico (antes solo hex)
        const regex = /"apiToken":"([a-zA-Z0-9_-]{20,60})"/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            const apiToken = match[1];
            const rest = content.substring(
                match.index,
                Math.min(match.index + 2000, content.length) // ✅ Más contexto
            );

            // ✅ Acepta variantes: "primaryPlatform" o "platform", con o sin espacios
            const esTikTok =
                /"primaryPlatform"\s*:\s*"tiktok"/i.test(rest) ||
                /"platform"\s*:\s*"tiktok"/i.test(rest);

            if (!esTikTok) continue;

            const userMatch = rest.match(/"username":"([a-zA-Z0-9_.-]{2,40})"/);
            const username = userMatch ? userMatch[1] : '(desconocido)';

            if (!found.has(apiToken)) {
                found.set(apiToken, { apiToken, username });
            }
        }
    }

    return Array.from(found.values());
}

module.exports = { readStreamlabsTokens, getLevelDbDir };