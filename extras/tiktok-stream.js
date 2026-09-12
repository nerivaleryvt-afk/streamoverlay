// ================================================================
// tiktok-stream.js - Pedir Stream Key vía Streamlabs (Fase 2)
// ================================================================
const { readStreamlabsTokens } = require('./streamlabs-token');

const STREAMLABS_API = 'https://streamlabs.com/api/v5/slobs/tiktok';
const STREAMLABS_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) StreamlabsDesktop/1.17.0 Chrome/122.0.6261.156 ' +
    'Electron/29.3.1 Safari/537.36';

function headers(apiToken) {
    return {
        'user-agent': STREAMLABS_USER_AGENT,
        'authorization': 'Bearer ' + apiToken
    };
}

async function getAccountInfo(apiToken) {
    try {
        const res = await fetch(`${STREAMLABS_API}/info`, { headers: headers(apiToken) });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        console.error('❌ [Streamlabs] info error:', e.message);
        return null;
    }
}

async function startLive(apiToken, title) {
    try {
        const formData = new FormData();
        formData.append('title', title || 'TogiPanel Stream');
        formData.append('device_platform', 'win32');
        formData.append('category', '');
        formData.append('audience_type', '0');

        const res = await fetch(`${STREAMLABS_API}/stream/start`, {
            method: 'POST',
            headers: headers(apiToken),
            body: formData
        });

        const data = await res.json().catch(() => null);
        if (!data || !data.rtmp || !data.key) {
            return { ok: false, error: 'Streamlabs no devolvió rtmp/key', raw: data };
        }
        return { ok: true, server: data.rtmp, key: data.key, id: data.id };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function endLive(apiToken, streamId) {
    try {
        const res = await fetch(`${STREAMLABS_API}/stream/${streamId}/end`, {
            method: 'POST',
            headers: headers(apiToken)
        });
        const data = await res.json().catch(() => null);
        return !!(data && data.success);
    } catch (e) {
        return false;
    }
}

module.exports = {
    readStreamlabsTokens,
    getAccountInfo,
    startLive,
    endLive
};