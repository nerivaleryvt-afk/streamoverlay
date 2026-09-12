const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
    console.log('🔧 [afterpack] Renombrando modules → node_modules dentro del build...');

    const appOutDir = context.appOutDir;
    const resourcesDir = path.join(appOutDir, 'resources');
    const extrasDir = path.join(resourcesDir, 'extras');
    const src = path.join(extrasDir, 'modules');
    const dst = path.join(extrasDir, 'node_modules');

    if (!fs.existsSync(src)) {
        if (fs.existsSync(dst)) {
            console.log('ℹ️  [afterpack] Ya está como node_modules.');
            return;
        }
        console.warn('⚠️  [afterpack] No se encontró modules.');
        return;
    }

    if (fs.existsSync(dst)) {
        try { fs.rmSync(src, { recursive: true, force: true }); } catch (e) {}
        return;
    }

    try {
        fs.renameSync(src, dst);
        console.log('✅ [afterpack] Renombrado a node_modules.');
    } catch (e) {
        console.error('❌ [afterpack] Error:', e.message);
        throw e;
    }
};