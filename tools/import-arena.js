#!/usr/bin/env node
/* Import an Are.na account into the Memory Archive.

   node tools/import-arena.js <are.na username>            run all steps (can be run again safely)
   node tools/import-arena.js <username> fetch|media|write  run one step

   fetch  reads your blocks and channels from the Are.na API into archief/_archief/arena/
   media  downloads images (large size) and attachments (original) into archief/media/
   write  adds every block as an entry and every channel as a collection

   Blocks become entries with id "arena-<block id>", so running it again only adds what is new.
   Channels by other people that you connected become Source entries that link to them.
   Stops by itself after BUDGET seconds (default 150); run again to continue the downloads. */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const USER = process.argv[2];
const STEP = process.argv[3] || 'all';
if (!USER) { console.log('Usage: node tools/import-arena.js <are.na username> [fetch|media|write]'); process.exit(1); }
const APP = path.resolve(__dirname, '..');
const ROOT = path.resolve(process.env.ARCHIVE_DIR || path.join(APP, 'archief'));
const CACHE = path.join(ROOT, '_archief', 'arena');
const MEDIA = path.join(ROOT, 'media');
const API = 'https://api.are.na/v3';
const BUDGET = (+process.env.BUDGET || 150) * 1000;
const started = Date.now();
const outOfTime = () => Date.now() - started > BUDGET;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(40000) });
      if (r.status === 429 && i < tries) { await sleep(3000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (err) { if (i >= tries) throw err; await sleep(1500 * (i + 1)); }
  }
}
async function pages(url) {
  const out = [];
  for (let page = 1; ; page++) {
    const d = await getJson(`${url}${url.includes('?') ? '&' : '?'}per=100&page=${page}`);
    out.push(...d.data);
    if (!d.meta || !d.meta.has_more_pages) return out;
  }
}
const readJson = async (f, fb) => { try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch { return fb; } };
// The public API cannot see private channels. Their contents can be added as arena-private.json
// (same shape: channels, blocks, membership, nested), exported with your Are.na login.
async function loadData() {
  const data = await readJson(path.join(CACHE, 'arena.json'));
  if (!data) return null;
  const extra = await readJson(path.join(CACHE, 'arena-private.json'));
  if (extra) {
    const ids = new Set(data.blocks.map(b => b.id)), slugs = new Set(data.channels.map(c => c.slug));
    data.channels.push(...extra.channels.filter(c => !slugs.has(c.slug)));
    data.blocks.push(...extra.blocks.filter(b => !ids.has(b.id)));
    for (const [id, list] of Object.entries(extra.membership)) {
      const have = data.membership[id] ||= [];
      for (const m of list) if (!have.some(h => h.slug === m.slug)) have.push(m);
    }
    data.nested.push(...extra.nested);
  }
  return data;
}
const writeJson = (f, v) => fsp.writeFile(f, JSON.stringify(v, null, 1));

/* ================= 1. fetch ================= */
async function fetchAll() {
  await fsp.mkdir(CACHE, { recursive: true });
  console.log(`Reading ${USER} from Are.na…`);
  const contents = await pages(`${API}/users/${USER}/contents`);
  const channels = contents.filter(x => x.type === 'Channel');
  const blocks = new Map(contents.filter(x => x.base_type === 'Block').map(b => [b.id, b]));
  const membership = {}, nested = [];
  for (const c of channels) {
    let list = [];
    try { list = await pages(`${API}/channels/${c.slug}/contents`); } catch (err) { console.log(`  could not read ${c.slug}: ${err.message}`); }
    for (const b of list) {
      if (b.type === 'Channel') { nested.push({ parent: c.slug, channel: b }); continue; }
      if (!blocks.has(b.id)) blocks.set(b.id, b);
      (membership[b.id] ||= []).push({ slug: c.slug, at: b.connection && b.connection.connected_at, position: b.connection && b.connection.position });
    }
    console.log(`  ${c.title.slice(0, 60)}: ${list.length}`);
  }
  // Comments are often the "why" behind a block
  const comments = {};
  for (const b of blocks.values()) if (b.comment_count) {
    try { comments[b.id] = (await pages(`${API}/blocks/${b.id}/comments`)).map(c => ({ by: c.user && c.user.name, at: c.created_at, text: md(c.body) })); } catch { /* skip */ }
  }
  await writeJson(path.join(CACHE, 'arena.json'), { user: USER, fetched: new Date().toISOString(), channels, blocks: [...blocks.values()], membership, nested, comments });
  console.log(`${blocks.size} blocks in ${channels.length} channels.`);
}

/* ================= 2. media ================= */
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'application/pdf': '.pdf', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'audio/mpeg': '.mp3' };
const slug = s => String(s || 'file').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50) || 'file';
// Same naming as server.js: <content hash>-<name>, so nothing is stored twice
let index = null;
async function store(buf, name, ext) {
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
  if (!index) index = new Map((await fsp.readdir(MEDIA)).filter(f => !f.startsWith('.')).map(f => [f.split('-')[0], f]));
  if (index.has(hash)) return `/media/${encodeURIComponent(index.get(hash))}`;
  const file = `${hash}-${slug(name)}${ext}`;
  await fsp.writeFile(path.join(MEDIA, file + '.tmp'), buf);
  await fsp.rename(path.join(MEDIA, file + '.tmp'), path.join(MEDIA, file));
  index.set(hash, file);
  return `/media/${encodeURIComponent(file)}`;
}
async function download(url, name, fallbackExt) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`${r.status}`);
  const type = (r.headers.get('content-type') || '').split(';')[0];
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error('empty');
  return { src: await store(buf, name, EXT[type] || fallbackExt || ''), size: buf.length, type };
}
// The largest resized image Are.na serves; originals sit behind a bot check
const imageUrl = img => img && ((img.large && (img.large.src_2x || img.large.src)) || (img.medium && img.medium.src) || img.src);

async function media() {
  const data = await loadData();
  if (!data) throw new Error('run fetch first');
  const doneFile = path.join(CACHE, 'media.json');
  const done = await readJson(doneFile, {});
  const jobs = [];
  for (const b of data.blocks) {
    const name = b.title || b.type;
    if (b.image && !done[`i${b.id}`]) jobs.push({ key: `i${b.id}`, url: imageUrl(b.image), name, ext: '.jpg' });
    if (b.attachment && !done[`a${b.id}`]) jobs.push({ key: `a${b.id}`, url: b.attachment.url, name: (b.title || b.attachment.filename).replace(/\.[a-z0-9]{2,4}$/i, ''), ext: '.' + (b.attachment.file_extension || 'bin') });
  }
  for (const n of data.nested) {
    const img = n.channel && n.channel.image;
    if (img && !done[`c${n.channel.id}`]) jobs.push({ key: `c${n.channel.id}`, url: imageUrl(img), name: n.channel.title, ext: '.jpg' });
  }
  console.log(`${jobs.length} files to download.`);
  let n = 0, failed = 0, i = 0;
  const worker = async () => {
    while (i < jobs.length && !outOfTime()) {
      const j = jobs[i++];
      try { done[j.key] = await download(j.url, j.name, j.ext); n++; }
      catch (err) { failed++; done[j.key + ':error'] = String(err.message || err); }
      if (n % 20 === 0) await writeJson(doneFile, done);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  await writeJson(doneFile, done);
  const left = jobs.length - i;
  console.log(`Downloaded ${n}, failed ${failed}, ${left ? `${left} left: run again to continue` : 'all done'}.`);
  return left;
}

/* ================= 3. write ================= */
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

// Titles that say nothing: file names, page chrome, bot checks
const isFileName = t => !t || !t.trim() || [/\.(png|jpe?g|gif|webp|heic|avif|pdf|mp4|mov|mp3|wav)\b/i, /^\(\d+\)\s*pinterest/i, /^(pinterest|instagram|image|untitled|img[_ -]?\d+|screenshot[\s\d_-]*)$/i,
  /^just a moment/i, /^\S{32,}$/, /^[\w-]{20,}$/, /^attention required/i, /security service to protect/i, /^pin page$/i, /^\d{6,}_/].some(re => re.test(t.trim()));
const titleCase = s => s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(\/-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s;
// "GENERATIVE NOISE | DIGITAL DISTURBANCE" → "Generative Noise · Digital Disturbance"
const channelName = t => t.split('|').map(s => s.trim()).filter(Boolean).map(titleCase).join(' · ');
const md = d => (d && (d.markdown || d.plain)) || (typeof d === 'string' ? d : '');
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

async function write() {
  const data = await loadData();
  const done = await readJson(path.join(CACHE, 'media.json'), {});
  const PORT = +process.env.PORT || 4321;
  const base = `http://127.0.0.1:${PORT}`;
  let db;
  try { db = await getJson(`${base}/api/db`, 0); }
  catch { throw new Error(`The archive server is not running on port ${PORT}. Start it first (node server.js).`); }

  // Collections: one per channel of yours, matched by name if it already exists
  const colFor = new Map();
  for (const c of data.channels) {
    const name = channelName(c.title);
    let col = db.collections.find(x => x.arena === c.slug) || db.collections.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!col) {
      col = { id: 'arena-' + c.id, name, description: md(c.description), created: c.created_at, arena: c.slug };
      db.collections.push(col);
    }
    colFor.set(c.slug, col.id);
  }
  const have = new Set(db.entries.map(e => e.id));
  const commentText = id => (data.comments && data.comments[id] || []).map(c => `> ${c.text.replace(/\n/g, '\n> ')}\n\n${c.by || ''}, ${String(c.at || '').slice(0, 10)}`).join('\n\n');
  const COMMENTS = '### Comments on Are.na';
  // Comments for entries imported earlier
  for (const e of db.entries) {
    const id = String(e.id).replace(/^arena-/, ''), t = commentText(id);
    if (t && !(e.body || '').includes(COMMENTS)) e.body = `${(e.body || '').trim()}\n\n${COMMENTS}\n\n${t}`.trim();
  }
  let added = 0;
  const mine = b => b.user && b.user.slug === USER;
  for (const b of data.blocks) {
    const id = 'arena-' + b.id;
    const mem = data.membership[b.id] || [];
    if (have.has(id)) {
      // Already imported: only add channels it was not in yet
      const ex = db.entries.find(e => e.id === id);
      for (const m of mem) { const c = colFor.get(m.slug); if (c && !ex.collections.includes(c)) ex.collections.push(c); }
      continue;
    }
    const found = [b.created_at, ...mem.map(m => m.at)].filter(Boolean).sort()[0] || b.created_at;
    const src = b.source || {};
    const desc = md(b.description).trim();
    let title = cleanTitle((b.title || '').trim(), src.url);
    if (isFileName(title)) title = !isFileName(src.title) ? src.title : '';
    if (!title && b.type === 'Text') title = md(b.content).split('\n')[0].replace(/^[#>*\s-]+/, '').slice(0, 90);
    if (!title && desc) { const first = desc.replace(/[#>*_\[\]]/g, '').split(/(?<=[.!?])\s|\n/)[0].trim(); if (first.length > 3) title = first.length > 90 ? first.slice(0, 88).replace(/\s\S*$/, '') + '…' : first; }
    if (!title) title = `${({ Image: 'Image', Attachment: 'File', Link: 'Link', Embed: 'Video' })[b.type] || 'Block'}${host(src.url) ? ' from ' + host(src.url) : ''}`;
    let by = (b.embed && b.embed.author_name) || '';
    const ig = (src.title || '').match(/^Instagram (?:post|reel|photo|video) (?:from|by) @?(.+)$/i);
    if (!by && ig) by = ig[1];
    // Handles read like names: "draaimolen_" → "Draaimolen", emoji and decoration dropped
    by = by.replace(/[\u{1F000}-\u{1FFFF}\u2600-\u27BF\u2B00-\u2BFF]/gu, '').replace(/^[@\s]+|[\s_.,!]+$/g, '').trim();
    if (by && by === by.toLowerCase() && /^[a-z][a-z0-9_.]*$/.test(by)) by = by.replace(/[_.]+/g, ' ').trim().replace(/^./, c => c.toUpperCase());
    let body = '';
    if (b.type === 'Text') body = md(b.content);
    else if (desc) body = (b.type === 'Link' || b.type === 'Embed' || !mine(b)) ? desc.split('\n').map(l => '> ' + l).join('\n') : desc;
    const img = done[`i${b.id}`], att = done[`a${b.id}`];
    const e = {
      id, kind: b.type === 'Text' && mine(b) ? 'note' : 'find', title: title.slice(0, 200), body, url: src.url || '', by,
      image: img ? img.src : null, file: null, swatch: null, date: found.slice(0, 10), formative: false,
      collections: [...new Set(mem.map(m => colFor.get(m.slug)).filter(Boolean))], assets: {},
      created: found, updated: b.updated_at || found,
      extra: { arena: `https://www.are.na/block/${b.id}` },
    };
    if (b.type === 'Link' || b.type === 'Embed') e.format = 'link';
    if (b.attachment) {
      e.format = 'file';
      const ext = b.attachment.file_extension ? '.' + b.attachment.file_extension : '';
      e.file = { name: (isFileName(b.title) ? title : b.title || title).replace(/\.[a-z0-9]{2,4}$/i, '') + ext, size: b.attachment.file_size || (att && att.size) || 0, type: b.attachment.content_type || '', data: att ? att.src : null };
      if (!att) e.file.data = null;
    }
    if (!mine(b) && b.user) e.extra.arena_by = JSON.stringify(b.user.name);
    const t = commentText(b.id);
    if (t) e.body = `${e.body.trim()}\n\n${COMMENTS}\n\n${t}`.trim();
    db.entries.push(e); added++;
  }
  // Channels by others that you connected: a Source pointing to them
  for (const n of data.nested) {
    const c = n.channel;
    if (data.channels.some(x => x.slug === c.slug)) continue;
    const id = 'arena-ch-' + c.id;
    const parent = colFor.get(n.parent);
    const ex = db.entries.find(e => e.id === id);
    if (ex) { if (parent && !ex.collections.includes(parent)) ex.collections.push(parent); continue; }
    const owner = c.owner || c.user || {};
    const img = done[`c${c.id}`];
    db.entries.push({
      id, kind: 'find', format: 'link', title: channelName(c.title || c.slug), body: md(c.description) ? md(c.description).split('\n').map(l => '> ' + l).join('\n') : '',
      url: `https://www.are.na/${owner.slug || 'channel'}/${c.slug}`, by: owner.name || '', image: img ? img.src : null, file: null, swatch: null,
      date: (c.created_at || new Date().toISOString()).slice(0, 10), formative: false, collections: parent ? [parent] : [], assets: {},
      created: c.created_at || new Date().toISOString(), updated: c.updated_at || new Date().toISOString(),
      extra: { arena: `https://www.are.na/${owner.slug || 'channel'}/${c.slug}`, arena_channel: `${(c.counts && c.counts.contents) || 0}` },
    });
    added++;
  }
  const r = await fetch(`${base}/api/db`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(db) });
  if (!r.ok) throw new Error('saving failed: ' + r.status);
  console.log(`Added ${added} entries and ${data.channels.length} collections. Archive now holds ${db.entries.length} entries.`);
}

(async () => {
  await fsp.mkdir(MEDIA, { recursive: true });
  if (STEP === 'fetch' || STEP === 'all') await fetchAll();
  let left = 0;
  if (STEP === 'media' || STEP === 'all') left = await media();
  if (STEP === 'write' || (STEP === 'all' && !left)) await write();
  else if (STEP === 'all') console.log('Downloads are not finished yet, so nothing was written. Run: node tools/import-arena.js ' + USER + ' media, then write.');
})().catch(err => { console.error('\n  ' + (err.message || err) + '\n'); process.exit(1); });
