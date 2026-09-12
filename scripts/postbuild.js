// scripts/postbuild.js — Restaura modules → node_modules después del build
const fs = require('fs');
const path = require('path');

const extrasDir = path.join(__dirname, '..', 'extras');
const src = path.join(extrasDir, 'modules');
const dst = path.join(extrasDir, 'node_modules');

console.log('🔧 [postbuild] Restaurando extras tras el build...');

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