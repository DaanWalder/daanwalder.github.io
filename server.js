#!/usr/bin/env node
/* Memory Archive · local server
   Serves the app and keeps the archive as plain files in a folder:

     archief/
       Notes/<title>.md      your own writing
       Finds/<title>.md      things from outside
       Works/<title>.md      your own pieces
       media/                images and files
       _archief/             collections.json and connections.json
       _prullenbak/          everything you delete ends up here first

   Each entry is a Markdown file with its details as frontmatter, so the folder can be opened
   in Obsidian (or any text editor) and outlives this app. No dependencies: Node 18 or newer.

   Run:   node server.js
   Opt:   PORT=4321  ARCHIVE_DIR=/path/to/archief  */
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 4321;
const HOST = process.env.HOST || '127.0.0.1';
const APP_DIR = __dirname;
const ROOT = path.resolve(process.env.ARCHIVE_DIR || path.join(__dirname, 'archief'));
const KIND_DIR = { note: 'Notes', find: 'Finds', work: 'Works' };
const DIR_KIND = Object.fromEntries(Object.entries(KIND_DIR).map(([k, v]) => [v, k]));
const MEDIA = path.join(ROOT, 'media');
const META = path.join(ROOT, '_archief');
const TRASH = path.join(ROOT, '_prullenbak');
// Frontmatter keys in a fixed order, so files stay tidy and diffs stay small
const FIELDS = ['id', 'kind', 'format', 'title', 'date', 'by', 'url', 'formative', 'collections', 'image', 'file', 'swatch', 'assets', 'original', 'page', 'documents', 'example', 'created', 'updated'];

/* ================= files ================= */
async function ensureDirs() {
  for (const d of [ROOT, MEDIA, META, TRASH, ...Object.values(KIND_DIR).map(k => path.join(ROOT, k))]) await fsp.mkdir(d, { recursive: true });
}
async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}
async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}
// Move instead of delete: the archive never throws anything away by itself
async function toTrash(file) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const dest = path.join(TRASH, `${stamp} ${path.basename(file)}`);
  try { await fsp.rename(file, dest); } catch { /* already gone */ }
}
const safeName = s => (String(s || '').replace(/[\/\\:*?"<>|#^\[\]\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).replace(/[.\s]+$/, '') || 'Untitled');

/* ================= markdown with frontmatter ================= */
// Simple words and dates are written bare, everything else as JSON (which is valid YAML)
const plain = v => typeof v === 'string' && /^[A-Za-z0-9\u00c0-\u024f][\w \u00c0-\u024f.,'()&+-]*$/.test(v) && v.trim() === v
  && !/^(true|false|null|yes|no|on|off)$/i.test(v) && !/^[\d.]+$/.test(v);
// Values are written as JSON, which is valid YAML, so Obsidian shows them as properties
function serialize(e) {
  const lines = ['---'];
  for (const k of FIELDS) {
    let v = e[k];
    if (k === 'collections') v = (v || []).map(id => collectionNames.get(id) || id);
    if (v === undefined || v === null || v === '' || (k === 'assets' && !Object.keys(v || {}).length) || ((k === 'example' || k === 'formative') && !v)) continue;
    if (k === 'collections' && !v.length) continue;
    lines.push(`${k}: ${plain(v) ? v : JSON.stringify(v)}`);
  }
  // Keep fields this app doesn't know about (added in Obsidian, for example)
  for (const [k, v] of Object.entries(e.extra || {})) lines.push(`${k}: ${v}`);
  lines.push('---', '');
  return lines.join('\n') + (e.body || '').replace(/\s+$/, '') + '\n';
}
function parse(text, rel) {
  const e = { body: text, extra: {} };
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (m) {
    e.body = m[2].replace(/^\r?\n/, '');
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
      if (!kv) continue;
      const [, k, raw] = kv;
      if (!FIELDS.includes(k)) { e.extra[k] = raw; continue; }
      let v = raw.trim();
      try { v = JSON.parse(v); } catch {
        if (k === 'collections') v = v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      }
      e[k] = v;
    }
  }
  const dir = rel.split(path.sep)[0];
  e.kind = KIND_DIR[e.kind] ? e.kind : DIR_KIND[dir] || 'note';
  e.title = e.title || path.basename(rel, '.md');
  e.id = e.id ? String(e.id) : 'x' + crypto.createHash('sha1').update(rel).digest('hex').slice(0, 9);
  e.collections = Array.isArray(e.collections) ? e.collections : [];
  e.formative = e.formative === true || e.formative === 'true';
  for (const k of ['url', 'by', 'date']) e[k] = e[k] ? String(e[k]) : '';
  e.image = e.image || null; e.file = e.file || null; e.swatch = e.swatch || null; e.assets = e.assets || {};
  if (!Object.keys(e.extra).length) delete e.extra;
  return e;
}

/* ================= the archive in memory ================= */
let collectionNames = new Map();   // id → name, for readable frontmatter
const known = new Map();           // entry id → { rel, text } as last read or written

async function load() {
  await ensureDirs();
  const collections = await readJson(path.join(META, 'collections.json'), []);
  const links = await readJson(path.join(META, 'connections.json'), []);
  collectionNames = new Map(collections.map(c => [c.id, c.name]));
  const byName = new Map(collections.map(c => [c.name.toLowerCase(), c.id]));
  const entries = [];
  known.clear();
  for (const dir of Object.values(KIND_DIR)) {
    const walk = async sub => {
      for (const d of await fsp.readdir(path.join(ROOT, sub), { withFileTypes: true })) {
        // Skip hidden files, such as the ._ files macOS writes on exFAT drives
        if (d.name.startsWith('.')) continue;
        const rel = path.join(sub, d.name);
        if (d.isDirectory()) { await walk(rel); continue; }
        if (!d.name.endsWith('.md')) continue;
        const text = await fsp.readFile(path.join(ROOT, rel), 'utf8');
        const e = parse(text, rel);
        if (known.has(e.id)) e.id = e.id + '-' + crypto.randomBytes(2).toString('hex'); // a copied file
        // Collections are stored by name; new names (typed in Obsidian) become collections
        e.collections = e.collections.map(n => {
          const key = String(n).toLowerCase();
          if (collectionNames.has(n)) return n;
          if (!byName.has(key)) { const c = { id: 'c' + crypto.randomBytes(4).toString('hex'), name: String(n), description: '', created: new Date().toISOString() }; collections.push(c); byName.set(key, c.id); collectionNames.set(c.id, c.name); }
          return byName.get(key);
        });
        if (!e.created) { const st = await fsp.stat(path.join(ROOT, rel)); e.created = st.birthtime.toISOString(); e.updated = st.mtime.toISOString(); }
        if (!e.date) e.date = e.created.slice(0, 10);
        known.set(e.id, { rel, text });
        entries.push(e);
      }
    };
    await walk(dir);
  }
  return { version: 2, rev: await readRev(), entries, collections, links };
}
// A revision number on disk, so a tab (or a second server) working from an older copy can't overwrite newer changes
const REV = () => path.join(META, 'revision.json');
const readRev = async () => (await readJson(REV(), { rev: 0 })).rev || 0;

let queue = Promise.resolve();
async function save(db) {
  collectionNames = new Map((db.collections || []).map(c => [c.id, c.name]));
  const used = new Set();
  // Entries that keep their file name claim it first, so a rename never steals a file
  const plan = (db.entries || []).map(e => {
    const prev = known.get(e.id);
    const want = path.join(KIND_DIR[e.kind] || 'Notes', safeName(e.title) + '.md');
    return { e, prev, want };
  });
  for (const p of plan) if (p.prev && p.prev.rel === p.want) used.add(p.want.toLowerCase());
  let written = 0;
  for (const p of plan) {
    let rel = p.want;
    if (!(p.prev && p.prev.rel === p.want)) {
      // Taken: claimed in this save, or already on disk (another entry, or a file made elsewhere)
      const own = r => p.prev && p.prev.rel.toLowerCase() === r.toLowerCase(); // a case-only rename on macOS
      const taken = r => used.has(r.toLowerCase()) || (fs.existsSync(path.join(ROOT, r)) && !own(r));
      for (let i = 2; taken(rel); i++) rel = p.want.replace(/\.md$/, ` (${i}).md`);
    }
    used.add(rel.toLowerCase());
    const text = serialize(p.e);
    if (p.prev && p.prev.rel !== rel) { try { await fsp.rename(path.join(ROOT, p.prev.rel), path.join(ROOT, rel)); } catch { /* write below */ } }
    if (!p.prev || p.prev.rel !== rel || p.prev.text !== text) { await writeAtomic(path.join(ROOT, rel), text); written++; }
    known.set(p.e.id, { rel, text });
  }
  const keep = new Set((db.entries || []).map(e => e.id));
  for (const [id, k] of [...known]) if (!keep.has(id)) { await toTrash(path.join(ROOT, k.rel)); known.delete(id); }
  await writeAtomic(path.join(META, 'collections.json'), JSON.stringify(db.collections || [], null, 2));
  await writeAtomic(path.join(META, 'connections.json'), JSON.stringify(db.links || [], null, 2));
  return written;
}

/* ================= media ================= */
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/avif': '.avif', 'application/pdf': '.pdf', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'audio/mpeg': '.mp3', 'audio/wav': '.wav' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  ...Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m])), '.jpeg': 'image/jpeg', '.m4a': 'audio/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska' };
// Same bytes, same file: nothing is stored twice
let mediaIndex = null;
async function storeMedia(buf, name, type) {
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
  let ext = path.extname(name || '').toLowerCase() || EXT[type] || '';
  const base = safeName(path.basename(name || 'file', path.extname(name || ''))).replace(/\s/g, '-').toLowerCase().slice(0, 50);
  if (!mediaIndex) mediaIndex = new Map((await fsp.readdir(MEDIA)).filter(f => !f.startsWith('.')).map(f => [f.split('-')[0], f]));
  if (mediaIndex.has(hash)) return `/media/${encodeURIComponent(mediaIndex.get(hash))}`;
  const file = `${hash}-${base}${ext}`;
  await writeAtomic(path.join(MEDIA, file), buf);
  mediaIndex.set(hash, file);
  return `/media/${encodeURIComponent(file)}`;
}

/* ================= saving web pages ================= */
// Page titles carry their site around: "GitHub - owner/repo: …", "Topic - Wikipedia", "Post | Site"
const SITES = /^(youtube|wikipedia|pinterest|instagram|behance|vimeo|medium|are\.na|tumblr|facebook|twitter|x|linkedin|etsy|aliexpress|amazon|google drive|google search|reddit|hornbach|gamma|e-flux|archined|savee|dezeen|designboom|creative boom|creativeapplications\.net|fast company|yanko design|allerhande|albert heijn)$/i;
function cleanTitle(t, url) {
  let s = String(t || '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  const gh = s.match(/^GitHub - ([^/\s]+)\/([^:\s]+)(?::\s*(.+))?$/);
  if (gh) return `${gh[2]} (${gh[1]})`;
  const g = s.match(/^(.+?) - Google (Search|Zoeken)$/i);
  if (g) return g[1].charAt(0).toUpperCase() + g[1].slice(1);
  s = s.replace(/^\(\d+\)\s*/, '');
  let host = ''; try { host = new URL(url).hostname.replace(/^www\./, '').split('.').slice(-2, -1)[0] || ''; } catch { /* none */ }
  for (let i = 0; i < 3; i++) {
    const m = s.match(/^(.*\S)\s+[|\-–—•·]\s+([^|\-–—•·]{1,40})$/);
    if (!m) break;
    const tail = m[2].trim().toLowerCase();
    if (SITES.test(tail) || (host && tail.replace(/[^a-z0-9]/g, '').includes(host.toLowerCase()))) s = m[1].trim(); else break;
  }
  return s;
}

const meta = (html, ...names) => {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*>`, 'i');
    const tag = html.match(re);
    if (tag) { const c = tag[0].match(/content=["']([^"']*)["']/i); if (c && c[1].trim()) return decode(c[1].trim()); }
  }
  return '';
};
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n));
async function unfurl(url) {
  const ctl = AbortSignal.timeout(12000);
  const res = await fetch(url, { signal: ctl, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) MemoryArchive/1.0', accept: 'text/html,*/*' } });
  const type = res.headers.get('content-type') || '';
  // A link straight to an image or pdf: keep the file itself
  if (/^(image|video|audio)\/|application\/pdf/.test(type)) {
    const buf = Buffer.from(await res.arrayBuffer());
    const name = decodeURIComponent(new URL(res.url).pathname.split('/').pop() || 'download');
    const src = await storeMedia(buf, name, type.split(';')[0]);
    return type.startsWith('image/') ? { title: name, image: src } : { title: name, file: { name, size: buf.length, data: src } };
  }
  const html = (await res.text()).slice(0, 800000);
  const title = meta(html, 'og:title', 'twitter:title') || decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
  const description = meta(html, 'og:description', 'twitter:description', 'description');
  const by = meta(html, 'author', 'article:author', 'og:site_name');
  let image = null;
  const img = meta(html, 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src');
  if (img) {
    try {
      const r = await fetch(new URL(img, res.url), { signal: AbortSignal.timeout(12000) });
      const t = (r.headers.get('content-type') || '').split(';')[0];
      if (r.ok && t.startsWith('image/')) image = await storeMedia(Buffer.from(await r.arrayBuffer()), 'preview' + (EXT[t] || ''), t);
    } catch { /* no preview */ }
  }
  // A copy of the page, so the source survives when the site doesn't
  // <base> keeps its images and styles loading from the original site while it is still online
  const withBase = html.replace(/<head[^>]*>/i, m => `${m}<base href="${res.url.replace(/"/g, '%22')}">`);
  const page = await storeMedia(Buffer.from(`<!-- saved from ${url} on ${new Date().toISOString()} -->\n` + withBase), safeName(title || 'page').slice(0, 40) + '.html', 'text/html');
  return { title: cleanTitle(title, res.url), description, by: by && by !== title ? by : '', image, page };
}

/* ================= http ================= */
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req, limit = 2e9) => new Promise((ok, fail) => {
  const parts = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > limit) { fail(new Error('too large')); req.destroy(); } else parts.push(c); });
  req.on('end', () => ok(Buffer.concat(parts))); req.on('error', fail);
});
async function serveFile(req, res, base, rel) {
  const full = path.join(base, rel);
  if (!full.startsWith(base)) return send(res, 403, 'no', 'text/plain');
  let st; try { st = await fsp.stat(full); } catch { return send(res, 404, 'not found', 'text/plain'); }
  if (st.isDirectory()) return serveFile(req, res, base, path.join(rel, 'index.html'));
  const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range && req.headers.range.match(/bytes=(\d*)-(\d*)/);
  // Ranges let video and audio seek
  if (range) {
    const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
    return fs.createReadStream(full, { start, end }).pipe(res);
  }
  const headers = { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes', 'cache-control': base === MEDIA ? 'max-age=31536000, immutable' : 'no-cache' };
  // Saved web pages and svg files never run scripts next to the archive
  if (base === MEDIA && /html|svg|xml/.test(type)) headers['content-security-policy'] = 'sandbox';
  res.writeHead(200, headers);
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  try {
    if (p === '/api/info') return send(res, 200, { server: true, root: ROOT });
    if (p === '/api/db' && req.method === 'GET') { await queue; return send(res, 200, await load()); }
    if (p === '/api/db' && req.method === 'PUT') {
      const db = JSON.parse((await readBody(req, 5e8)).toString('utf8'));
      if (!db || !Array.isArray(db.entries)) return send(res, 400, { error: 'not an archive' });
      const job = queue.then(async () => {
        const rev = await readRev();
        if (typeof db.rev === 'number' && db.rev !== rev) return { conflict: true, rev };
        const written = await save(db);
        await writeAtomic(REV(), JSON.stringify({ rev: rev + 1, at: new Date().toISOString() }));
        return { written, rev: rev + 1 };
      });
      queue = job.catch(() => {});
      const out = await job;
      return send(res, out.conflict ? 409 : 200, { ok: !out.conflict, ...out });
    }
    if (p === '/api/media' && req.method === 'POST') {
      const name = u.searchParams.get('name') || 'file';
      const url = await storeMedia(await readBody(req), name, (req.headers['content-type'] || '').split(';')[0]);
      return send(res, 200, { url });
    }
    if (p === '/api/unfurl') {
      try { return send(res, 200, await unfurl(u.searchParams.get('url'))); } catch (err) { return send(res, 200, { error: String(err.message || err) }); }
    }
    if (p.startsWith('/media/')) return serveFile(req, res, MEDIA, p.slice(7));
    if (p.startsWith('/api/')) return send(res, 404, { error: 'unknown' });
    if (/(^|\/)(server\.js|archief|\.git)/.test(p)) return send(res, 404, 'not found', 'text/plain');
    return serveFile(req, res, APP_DIR, p === '/' ? 'index.html' : p.slice(1));
  } catch (err) {
    console.error(err);
    send(res, 500, { error: String(err.message || err) });
  }
});

ensureDirs().then(() => server.listen(PORT, HOST, () => {
  console.log(`\n  Memory Archive\n  open      http://localhost:${PORT}\n  archive   ${ROOT}\n\n  Close this window (or Ctrl C) to stop.\n`);
}));
server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.log(`\n  Port ${PORT} is already in use. Is the archive already running? Open http://localhost:${PORT}\n`);
  else console.error(err);
  process.exit(1);
});
