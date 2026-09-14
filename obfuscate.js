// obfuscate.js
// Ofusca los .js de primer nivel de extras/ IN-PLACE.
// Guarda copia de los originales en extras-backup/ para restaurar luego.

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT = __dirname;
const SOURCE_DIR = path.join(ROOT, 'extras');
const BACKUP_DIR = path.join(ROOT, 'extras-backup');

const SKIP_FILES = new Set([
    // Añade aquí los que den problemas
]);

const OBF_CONFIG = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    selfDefending: false,
    debugProtection: false,
    disableConsoleOutput: false
};

function ofuscar() {
    // Backup de los .js originales
    if (fs.existsSync(BACKUP_DIR)) fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const entries = fs.readdirSync(SOURCE_DIR, { withFileTypes: true });
    let obfCount = 0;

    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.js')) continue;
        if (SKIP_FILES.has(entry.name)) {
            console.log(`⏭️  Sin ofuscar: ${entry.name}`);
            continue;
        }

        const filePath = path.join(SOURCE_DIR, entry.name);
        const backupPath = path.join(BACKUP_DIR, entry.name);

        // 1. Backup del original
        fs.copyFileSync(filePath, backupPath);

        // 2. Ofuscar y sobrescribir in-place
        const code = fs.readFileSync(filePath, 'utf8');
        try {
            const result = JavaScriptObfuscator.obfuscate(code, OBF_CONFIG);
            fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8');
            obfCount++;
            console.log(`✅ Ofuscado in-place: ${entry.name}`);
        } catch (e) {
            console.error(`❌ Error ofuscando ${entry.name}: ${e.message}`);
            fs.copyFileSync(backupPath, filePath); // restaurar
        }
    }

    console.log(`\n🎉 ${obfCount} archivos ofuscados. Backup en extras-backup/`);
}

ofuscar();