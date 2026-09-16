/* custom-overlay.js — Rutas overlay chat personalizado (StreamElements) · Fase 1 + proxies emotes */
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const https = require('https');
const express = require('express');

const CUSTOM_DIR = path.join(process.env.APPDATA || os.homedir(),
  'togi-panel', 'custom-overlays', 'chat');
const PUBLIC_DIR = path.join(__dirname, 'public');

function ensureDir() { fs.mkdirSync(CUSTOM_DIR, { recursive: true }); }

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP: EOCD no encontrado');
  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const files = {};
  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP: CD firma');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP: LH firma');
    const lhNameLen = buf.readUInt16LE(localOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    const data = buf.slice(dataStart, dataStart + compSize);

    let out;
    if (method === 0) out = data;
    else if (method === 8) out = zlib.inflateRawSync(data);
    else throw new Error('ZIP: método ' + method + ' no soportado');

    files[name] = out;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function proxyGet(url, res, label) {
  const u = new URL(url);
  const options = {
    hostname: u.hostname,
    path: u.pathname + u.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      'Accept': 'application/json'
    }
  };
  https.get(options, (r) => {
    let body = '';
    r.on('data', c => body += c);
    r.on('end', () => {
      console.log(`[proxy:${label}] status=${r.statusCode} len=${body.length}`);
      res.status(r.statusCode || 200).type('application/json').send(body);
    });
  }).on('error', (e) => {
    console.error(`[proxy:${label}] error`, e.message);
    res.status(500).json({ error: e.message });
  });
}

module.exports = function registerCustomOverlay(app) {
  ensureDir();

  app.get('/api/custom-overlay/info', (req, res) => {
    const files = fs.existsSync(CUSTOM_DIR) ? fs.readdirSync(CUSTOM_DIR) : [];
    const st = fs.existsSync(CUSTOM_DIR) ? fs.statSync(CUSTOM_DIR) : null;
    res.json({ exists: files.length > 0, date: st ? st.mtime : null, files });
  });

  // Proxy: BTTV top vía StreamElements (evita auth y CORS)
  app.get('/api/custom-overlay/emotes-bttv-top', (req, res) => {
    proxyGet('https://api.streamelements.com/kappa/v2/emotes/bttv', res, 'se-bttv');
  });

  // Proxy: BTTV global vía StreamElements
  app.get('/api/custom-overlay/emotes-bttv-global', (req, res) => {
    proxyGet('https://api.streamelements.com/kappa/v2/emotes/bttv', res, 'se-bttv-global');
  });

  app.post('/api/custom-overlay/upload',
    express.raw({ type: ['application/zip', 'application/octet-stream'], limit: '50mb' }),
    (req, res) => {
      try {
        const buf = req.body;
        if (!buf || !buf.length) return res.status(400).json({ error: 'Body vacío' });
        const entries = readZip(buf);
        fs.rmSync(CUSTOM_DIR, { recursive: true, force: true });
        ensureDir();
        const wanted = ['widget.ini', 'html.txt', 'css.txt', 'js.txt', 'fields.txt', 'data.txt'];
        const written = [];
        for (const name in entries) {
          const base = path.basename(name.replace(/\\/g, '/'));
          if (wanted.includes(base)) {
            fs.writeFileSync(path.join(CUSTOM_DIR, base), entries[name]);
            written.push(base);
          }
        }
        if (!written.includes('html.txt') || !written.includes('js.txt')) {
          return res.status(400).json({ error: 'Falta html.txt o js.txt', written });
        }
        res.json({ ok: true, written });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

  app.delete('/api/custom-overlay', (req, res) => {
    try {
      fs.rmSync(CUSTOM_DIR, { recursive: true, force: true });
      ensureDir();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/custom-overlay/fields', (req, res) => {
    const f = path.join(CUSTOM_DIR, 'data.txt');
    if (!fs.existsSync(f)) return res.json({});
    const raw = fs.readFileSync(f, 'utf8').trim();
    if (!raw) return res.json({});
    try { return res.json(JSON.parse(raw)); } catch (_) {}
    const out = {};
    raw.split(/\r?\n/).forEach(line => {
      const m = line.match(/^([^=]+)=(.*)$/);
      if (m) out[m[1].trim()] = m[2].trim();
    });
    res.json(out);
  });

  app.get('/overlay-custom/css', (req, res) => {
    const f = path.join(CUSTOM_DIR, 'css.txt');
    res.type('text/css').send(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  });
  app.get('/overlay-custom/html', (req, res) => {
    const f = path.join(CUSTOM_DIR, 'html.txt');
    res.type('text/html').send(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  });
  app.get('/overlay-custom/js', (req, res) => {
    const f = path.join(CUSTOM_DIR, 'js.txt');
    res.type('application/javascript').send(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '// sin js');
  });
  app.get('/overlay-custom', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'overlay-custom.html'));
  });
};