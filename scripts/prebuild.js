// scripts/prebuild.js — Renombra node_modules → modules + ofusca in-place
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const extrasDir = path.join(ROOT, 'extras');

console.log('🔧 [prebuild] Preparando extras para empaquetado...');

// ============================================================
// PASO 1: node_modules → modules   (LO QUE YA HACÍAS, NO TOCAR)
// ============================================================
const src = path.join(extrasDir, 'node_modules');
const dst = path.join(extrasDir, 'modules');

if (fs.existsSync(dst) && !fs.existsSync(src)) {
    console.log('ℹ️  [prebuild] Ya está en "modules/", nada que hacer.');
} else if (!fs.existsSync(src)) {
    console.error('❌ [prebuild] No existe extras/node_modules. Ejecuta "npm install" en extras/ primero.');
    process.exit(1);
} else {
    if (fs.existsSync(dst)) {
        console.log('🧹 [prebuild] Borrando modules/ antiguo del repo...');
        try { fs.rmSync(dst, { recursive: true, force: true }); }
        catch (e) { console.error('❌ No se pudo borrar modules/:', e.message); process.exit(1); }
    }
    try {
        fs.renameSync(src, dst);
        console.log('✅ [prebuild] Renombrado: extras/node_modules → extras/modules');
    } catch (e) {
        console.error('❌ [prebuild] Error al renombrar:', e.message);
        process.exit(1);
    }
}

// ============================================================
// PASO 2: ofuscar extras/*.js IN-PLACE (backup en extras-backup/)
// ============================================================
console.log('🎭 [prebuild] Ofuscando extras/ in-place...');
execSync('node obfuscate.js', { cwd: ROOT, stdio: 'inherit' });

console.log('🔀 [prebuild] Listo para empaquetar (extras/ ya está ofuscado).');