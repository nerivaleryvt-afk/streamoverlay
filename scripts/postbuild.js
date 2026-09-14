// scripts/postbuild.js — Restaura .js originales + modules → node_modules
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const extrasDir = path.join(ROOT, 'extras');
const backupDir = path.join(ROOT, 'extras-backup');

console.log('🔧 [postbuild] Restaurando extras tras el build...');

// ============================================================
// PASO 1: restaurar .js originales desde extras-backup/
// ============================================================
if (fs.existsSync(backupDir)) {
    const files = fs.readdirSync(backupDir);
    for (const file of files) {
        const srcPath = path.join(backupDir, file);
        const dstPath = path.join(extrasDir, file);
        fs.copyFileSync(srcPath, dstPath);
    }
    fs.rmSync(backupDir, { recursive: true, force: true });
    console.log(`✅ [postbuild] ${files.length} archivos restaurados desde backup.`);
} else {
    console.log('ℹ️  [postbuild] No hay extras-backup/, nada que restaurar.');
}

// ============================================================
// PASO 2: modules → node_modules   (LO QUE YA HACÍAS, NO TOCAR)
// ============================================================
const src = path.join(extrasDir, 'modules');
const dst = path.join(extrasDir, 'node_modules');

if (!fs.existsSync(src)) {
    console.log('ℹ️  [postbuild] No hay "modules/", nada que restaurar.');
    process.exit(0);
}

if (fs.existsSync(dst)) {
    console.log('ℹ️  [postbuild] Ya existe "node_modules/", borrando "modules/" antiguo...');
    try { fs.rmSync(src, { recursive: true, force: true }); } catch (e) {}
    process.exit(0);
}

try {
    fs.renameSync(src, dst);
    console.log('✅ [postbuild] Restaurado: extras/modules → extras/node_modules');
} catch (e) {
    console.error('❌ [postbuild] Error al restaurar:', e.message);
}