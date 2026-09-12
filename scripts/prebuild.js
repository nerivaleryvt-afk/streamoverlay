// scripts/prebuild.js — Renombra node_modules → modules antes de build
const fs = require('fs');
const path = require('path');

const extrasDir = path.join(__dirname, '..', 'extras');
const src = path.join(extrasDir, 'node_modules');
const dst = path.join(extrasDir, 'modules');

console.log('🔧 [prebuild] Preparando extras para empaquetado...');

// Si ya está renombrado, no hacer nada
if (fs.existsSync(dst) && !fs.existsSync(src)) {
    console.log('ℹ️  [prebuild] Ya está en "modules/", nada que hacer.');
    process.exit(0);
}

if (!fs.existsSync(src)) {
    console.error('❌ [prebuild] No existe extras/node_modules. Ejecuta "npm install" en extras/ primero.');
    process.exit(1);
}

try {
    fs.renameSync(src, dst);
    console.log('✅ [prebuild] Renombrado: extras/node_modules → extras/modules');
} catch (e) {
    console.error('❌ [prebuild] Error al renombrar:', e.message);
    process.exit(1);
}