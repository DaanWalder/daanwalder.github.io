/* Memory Archive · application
   Entries come in three kinds (Notes, Finds, Works), live in Collections, can be marked Formative,
   and connect through explicit links (with a reason) and [[wiki links]] written in Markdown.
   Entries open in a side view over the list; the full page and editor are one click further.
   Data is kept on disk when the app runs through server.js (Markdown files and media in a folder),
   and otherwise in this browser (IndexedDB, with localStorage as a fallback). */
(() => {
  'use strict';

  /* ================= vocabulary ================= */
  const KINDS = {
    work: { label: 'Work', plural: 'Works', glyph: '◆', help: 'A piece you made', date: 'Made',
      desc: 'Your own pieces. Open one and use Lineage to see what shaped it.',
      placeholder: 'What is it, how was it made, what was it about?' },
    note: { label: 'Note', plural: 'Notes', glyph: '¶', help: 'Your own writing', date: 'Written',
      desc: 'Your own writing, from a one-line thought to a long reflection. Link to any entry with [[double brackets]].',
      placeholder: 'Start writing. # heading, **bold**, - list, > quote, and [[ to link another entry.' },
    find: { label: 'Find', plural: 'Finds', glyph: '↘', help: 'Something from outside', date: 'Found',
      desc: 'Things from outside that stayed with you: images, sources, quotes and files.',
      placeholder: 'Why did this stay with you? Where did you come across it?' },
  };
  const KIND_ORDER = ['work', 'note', 'find'];
  const FORMATS = { image: { label: 'Image', glyph: '◐' }, link: { label: 'Source', glyph: '↗' }, quote: { label: 'Quote', glyph: '“' }, file: { label: 'File', glyph: '▤' }, text: { label: 'Text', glyph: '¶' } };
  const formatOf = e => FORMATS[e.format] ? e.format : e.page ? 'link' : e.image || e.swatch ? 'image' : e.file ? 'file' : e.url ? 'link' : e.kind === 'find' ? 'quote' : 'text';
  // A short note without structure reads as a thought
  const isThought = e => e.kind === 'note' && !e.image && !e.file && (e.body || '').length <= 280 && !/^\s*(#|[-*+] |\d+\. |>)/m.test(e.body || '');
  const GROUPS = { none: 'Nothing', year: 'Year', kind: 'Kind', collection: 'Collection', person: 'Person' };
  const DISPLAYS = { list: 'List', grid: 'Grid', graph: 'Graph' };

  /* ================= helpers ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const today = () => new Date().toISOString().slice(0, 10);
  const now = () => new Date().toISOString();
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const isTyping = el => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDay = d => d ? `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}` : '—';
  const fmtDate = d => d ? `${fmtDay(d)} ${d.slice(0, 4)}` : 'Undated';
  const year = d => d ? d.slice(0, 4) : '—';
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const norm = s => String(s || '').trim().toLowerCase();
  const narrow = () => innerWidth <= 1000;

  /* ================= storage ================= */
  const LEGACY_KEY = 'memory-archive-v1';
  const FALLBACK_KEY = 'memory-archive-v2';
  const PREFS_KEY = 'memory-archive-prefs';
  // Set at boot when the app is served by server.js; then the archive lives in a folder on disk
  let SERVER = null;
  const store = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        if (!('indexedDB' in window)) return rej(new Error('no idb'));
        const r = indexedDB.open('memory-archive', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(this.db = r.result);
        r.onerror = () => rej(r.error);
      });
    },
    async get(key) {
      if (SERVER) { const r = await fetch('/api/db', { cache: 'no-store' }); if (!r.ok) throw new Error('read failed'); return r.json(); }
      try {
        const d = await this.open();
        return await new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      } catch { try { return JSON.parse(localStorage.getItem(FALLBACK_KEY)); } catch { return null; } }
    },
    async set(key, val) {
      if (SERVER) {
        const r = await fetch('/api/db', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(val) });
        if (r.status === 409) throw Object.assign(new Error('conflict'), { conflict: true });
        if (!r.ok) throw new Error('save failed');
        db.rev = (await r.json()).rev;
        return;
      }
      try {
        const d = await this.open();
        await new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); });
      } catch { localStorage.setItem(FALLBACK_KEY, JSON.stringify(val)); }
    },
  };
  const prefs = { display: 'list', group: 'year', mode: 'split' };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY)) || {}); } catch { /* defaults */ }
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };

  let db = { version: 2, entries: [], collections: [], links: [] };
  let saving = Promise.resolve();
  function persist() {
    if (!SERVER) {
      const snapshot = JSON.parse(JSON.stringify(db));
      saving = saving.then(() => store.set('db', snapshot)).catch(() => toast('Could not save · export a backup'));
      return saving;
    }
    // On disk: embedded images and files become files in media/ first, then the entries are written
    saving = saving.then(async () => { await externalize(); await store.set('db', JSON.parse(JSON.stringify(db))); })
      .catch(async err => {
        if (!err.conflict) return toast('Could not save · is the archive server still running?');
        // Someone else saved first: take their version, so nothing newer is overwritten
        db = migrate(await store.get('db')); db.entries.forEach(e => { e.collections ||= []; e.assets ||= {}; });
        refresh(); toast('The archive changed elsewhere · reloaded, your last change was not saved');
      });
    return saving;
  }
  const isData = v => typeof v === 'string' && v.startsWith('data:');
  async function upload(src, name) {
    const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
    const r = await fetch(`/api/media?name=${encodeURIComponent(name || 'file')}`, { method: 'POST', headers: { 'content-type': blob.type || 'application/octet-stream' }, body: blob });
    if (!r.ok) throw new Error('upload failed');
    return (await r.json()).url;
  }
  async function externalize() {
    for (const e of db.entries) {
      if (isData(e.image)) e.image = await upload(e.image, (e.title || 'image') + '.jpg');
      if (e.file && isData(e.file.data)) e.file.data = await upload(e.file.data, e.file.name);
      for (const [k, v] of Object.entries(e.assets || {})) if (isData(v)) e.assets[k] = await upload(v, 'image.jpg');
    }
  }

  /* v1 (types, resonance, tags) → v2 (kinds, collections, formative) */
  function migrate(old) {
    if (old && old.version === 2) return old;
    const kindOf = { thought: 'note', note: 'note', work: 'work', image: 'find', source: 'find', quote: 'find', file: 'find' };
    const cols = new Map();
    const colFor = tag => {
      if (!cols.has(tag)) cols.set(tag, { id: uid(), name: tag.charAt(0).toUpperCase() + tag.slice(1), description: '', created: now() });
      return cols.get(tag).id;
    };
    const entries = (old.items || []).map(i => ({
      id: i.id, kind: kindOf[i.type] || 'note', title: i.title || 'Untitled', body: i.body || '', url: i.url || '', by: '',
      image: i.image || null, file: i.file || null, swatch: i.swatch || null, date: i.date || '', formative: false,
      collections: (i.tags || []).map(colFor), created: i.created || now(), updated: now(), example: !!i.example, assets: {},
    }));
    return { version: 2, entries, collections: [...cols.values()], links: (old.links || []).map(l => ({ id: l.id || uid(), a: l.a, b: l.b, note: l.note || '' })) };
  }

  /* ================= model ================= */
  const byId = id => db.entries.find(e => e.id === id);
  const colById = id => db.collections.find(c => c.id === id);
  const byTitle = t => { const n = norm(t); return db.entries.find(e => norm(e.title) === n); };
  const byNewest = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.created || '').localeCompare(a.created || '');
  const WIKI = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;

  function mentionsOf(e) {
    const out = new Set();
    for (const m of (e.body || '').matchAll(WIKI)) { const t = byTitle(m[1]); if (t && t.id !== e.id) out.add(t.id); }
    return [...out];
  }
  // Every relation between two entries: explicit links (with a reason) and mentions in text
  function relations() {
    const rel = [], seen = new Set();
    db.links.forEach(l => { if (byId(l.a) && byId(l.b)) { rel.push({ a: l.a, b: l.b, note: l.note, link: l }); seen.add([l.a, l.b].sort().join()); } });
    db.entries.forEach(e => mentionsOf(e).forEach(t => {
      const k = [e.id, t].sort().join();
      if (!seen.has(k)) { seen.add(k); rel.push({ a: e.id, b: t, note: '', mention: true }); }
    }));
    return rel;
  }
  // Entries that document a Work (photos of the piece, the exhibition), rather than feed it
  const docsOf = id => db.entries.filter(d => d.documents === id).sort(byNewest);
  const neighbours = (id, rel = relations()) => rel.filter(r => r.a === id || r.b === id).map(r => ({ ...r, other: byId(r.a === id ? r.b : r.a) }));
  const backlinks = id => db.entries.filter(e => e.id !== id && mentionsOf(e).includes(id));
  const people = () => {
    const m = new Map();
    db.entries.forEach(e => { if (e.by && e.by.trim()) { const k = e.by.trim(); m.has(k) || m.set(k, []); m.get(k).push(e); } });
    return [...m].map(([name, list]) => ({ name, list })).sort((a, b) => b.list.length - a.list.length || a.name.localeCompare(b.name));
  };
  const inCollection = cid => db.entries.filter(e => e.collections.includes(cid));
  const ctxCollections = () => (ui.route && ui.route.scope === 'collection' && colById(ui.route.id)) ? [ui.route.id] : [];

  function newEntry(fields) {
    return { id: uid(), kind: 'find', title: '', body: '', url: '', by: '', image: null, file: null, swatch: null, date: today(), formative: false,
      collections: ctxCollections(), assets: {}, created: now(), updated: now(), ...fields };
  }
  function ensureCollection(name) {
    const n = name.trim(); if (!n) return null;
    let c = db.collections.find(x => norm(x.name) === norm(n));
    if (!c) { c = { id: uid(), name: n, description: '', created: now() }; db.collections.push(c); }
    return c;
  }
  // Rename an entry and keep [[links]] that point to it working
  function renameEntry(e, title) {
    title = title.trim();
    if (!title || title === e.title) return 0;
    let n = 0;
    if (norm(e.title) !== norm(title)) {
      const re = new RegExp(`\\[\\[${e.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\|[^\\]]+)?\\]\\]`, 'gi');
      db.entries.forEach(x => { if (x.id !== e.id) x.body = (x.body || '').replace(re, (m, alias) => { n++; return `[[${title}${alias || ''}]]`; }); });
    }
    e.title = title; e.updated = now();
    return n;
  }

  /* ================= markdown ================= */
  if (window.marked) marked.use({ gfm: true, breaks: true });
  function renderMd(text, entry) {
    if (!text || !text.trim()) return '';
    const src = text.replace(WIKI, (m, t, alias) => {
      const target = byTitle(t), label = esc((alias || t).trim());
      return target ? `<a class="wikilink" href="#/e/${target.id}" data-entry-link="${target.id}">${label}</a>` : `<a class="wikilink is-new" href="#/new/note?title=${encodeURIComponent(t.trim())}" title="Create a note called “${esc(t.trim())}”">${label}</a>`;
    });
    let html = window.marked ? marked.parse(src) : `<p>${esc(text).replace(/\n/g, '<br>')}</p>`;
    html = html.replace(/asset:([a-z0-9]+)/g, (m, id) => (entry && entry.assets && entry.assets[id]) || '');
    return window.DOMPurify ? DOMPurify.sanitize(html, { ADD_ATTR: ['data-entry-link'] }) : html;
  }
  const plain = text => String(text || '').replace(WIKI, (m, t, a) => a || t).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^\s*[-*+] \[[ x]\]/gm, '').replace(/[*_`~]+/g, '').replace(/[#>]+/g, ' ').replace(/(^|\s)-(\s)/g, '$1$2').replace(/\s+/g, ' ').trim();
  const excerpt = text => {
    const paras = String(text || '').split(/\n\s*\n/).map(s => s.trim()).filter(s => s && !/^(#|[-*+] |\d+\. |!\[|---)/.test(s));
    return plain(paras[0] || text);
  };

  /* ================= plates: image, generated placeholder, or typographic tile ================= */
  function linesSvg(e) {
    const [bg, fg] = e.swatch;
    let s = hash(e.id);
    const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0) / 4294967296);
    const n = 22 + Math.floor(rnd() * 14), amp = 4 + rnd() * 14, freq = .008 + rnd() * .02;
    let paths = '';
    for (let i = 0; i < n; i++) {
      const y0 = 30 + i * (440 / n), ph = rnd() * 6.28, a = amp * (.4 + rnd());
      let d = '';
      for (let x = 0; x <= 400; x += 10) d += `${x ? ' L' : 'M'}${x} ${(y0 + Math.sin(x * freq + ph + i * .18) * a).toFixed(1)}`;
      paths += `<path d="${d}"/>`;
    }
    return `<svg viewBox="0 0 400 500" preserveAspectRatio="none" aria-hidden="true"><rect width="400" height="500" fill="${bg}"/><g fill="none" stroke="${fg}" stroke-width="1" vector-effect="non-scaling-stroke" opacity=".8">${paths}</g></svg>`;
  }
  const isDark = hex => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * .3 + ((n >> 8) & 255) * .59 + (n & 255) * .11) < 110; };
  function plate(e, { big = false } = {}) {
    const f = formatOf(e), k = KINDS[e.kind];
    if (e.image) return `<div class="plate"><img src="${e.image}" alt="" loading="lazy"></div>`;
    if (e.swatch) return `<div class="plate${isDark(e.swatch[0]) ? ' plate--dark' : ''}">${linesSvg(e)}<span class="label ph">${big ? 'Placeholder · add your own image' : 'Placeholder'}</span></div>`;
    let q = excerpt(e.body) || e.title, cls = 'note';
    if (f === 'quote') { q = e.title; cls = 'quote'; }
    else if (f === 'link') { q = host(e.url) || e.title; cls = 'link'; }
    else if (f === 'file') { q = e.file.name; cls = 'file'; }
    else if (e.kind === 'work') { q = e.title; cls = 'work'; }
    else if (isThought(e)) { q = e.body ? excerpt(e.body) : e.title; cls = 'quote'; }
    const glyph = e.kind === 'find' ? FORMATS[f].glyph : k.glyph;
    const label = e.kind === 'find' ? FORMATS[f].label : isThought(e) ? 'Thought' : k.label;
    return `<div class="plate plate--text plate--${cls}" data-glyph="${glyph}"><span class="label">${glyph} ${label}</span><p class="q">${esc(q.length > 420 ? q.slice(0, 420) + '…' : q)}</p></div>`;
  }
  const kindLabel = e => e.kind === 'find' ? `Find · ${FORMATS[formatOf(e)].label}` : isThought(e) ? 'Note · Thought' : KINDS[e.kind].label;
  const titleHtml = e => formatOf(e) === 'quote' ? `<q>${esc(e.title)}</q>` : esc(e.title);
  const fMark = e => e.formative ? '<span class="f-mark" title="Formative" aria-label="Formative"></span>' : '';

  /* ================= state & routing ================= */
  const ui = { query: '', route: null, lastList: [], lastScope: { hash: '#/all', label: 'Everything' }, lastBase: null,
    draft: null, dirty: false, preset: null, animate: true, skipGuard: false, select: null };
  const LISTISH = ['list', 'collections', 'people'];

  // The current hash without the side-view parameter (?e=…)
  const baseHash = (h = location.hash) => h.replace(/([?&])e=[^&]*(&|$)/, (m, a, b) => b ? a : '').replace(/[?&]$/, '') || '#/all';
  function entryHref(id) {
    if (ui.route && LISTISH.includes(ui.route.page)) { const b = baseHash(); return `${b}${b.includes('?') ? '&' : '?'}e=${id}`; }
    return `#/e/${id}`;
  }

  function parseRoute() {
    const raw = location.hash.replace(/^#/, '') || '/all';
    const [path, qs] = raw.split('?');
    const p = path.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
    const q = new URLSearchParams(qs || '');
    const panel = byId(q.get('e')) ? q.get('e') : null;
    const L = extra => ({ page: 'list', panel, ...extra });
    switch (p[0]) {
      case 'all': case 'unsorted': case 'formative': return L({ scope: p[0] });
      case 'kind': return KINDS[p[1]] ? L({ scope: 'kind', kind: p[1] }) : L({ scope: 'all' });
      case 'c': return colById(p[1]) ? L({ scope: 'collection', id: p[1], edit: q.has('edit') }) : { page: 'collections', panel };
      case 'collections': return { page: 'collections', panel };
      case 'people': return { page: 'people', panel };
      case 'p': return L({ scope: 'person', name: p[1] || '' });
      case 'e': return byId(p[1]) ? { page: p[2] === 'edit' ? 'edit' : 'entry', id: p[1], tab: p[2] === 'lineage' ? 'lineage' : 'entry' } : L({ scope: 'all' });
      case 'new': return { page: 'edit', kind: KINDS[p[1]] ? p[1] : 'note', title: q.get('title') || '' };
      case 'sort': return { page: 'sort', mode: SORT_MODES[p[1]] ? p[1] : 'all', work: p[1] === 'reasons' && byId(p[2]) ? p[2] : null };
      default: return L({ scope: 'all' });
    }
  }
  const go = h => { if (location.hash === h) render(); else location.hash = h; };
  const openEntry = id => go(entryHref(id));

  /* ================= sidebar ================= */
  const side = $('#side');
  function renderSide() {
    const r = ui.route || {};
    const cur = cond => cond ? ' aria-current="page"' : '';
    const item = (href, label, n, cond, glyph = '', del = '') => `<li><a class="nav-item" href="${href}"${cur(cond)}>${glyph ? `<span class="g">${glyph}</span>` : ''}<span>${label}</span><span class="n">${n}</span></a>${del}</li>`;
    const L = r.page === 'list' && !ui.query;
    const unsorted = db.entries.filter(e => !e.collections.length).length;
    const cols = [...db.collections].sort((a, b) => a.name.localeCompare(b.name));
    const ppl = people();
    $('#side-nav').innerHTML = `
      <section class="nav-sec"><div class="nav-head"><span class="label">Library</span></div><ul class="nav-list">
        ${item('#/all', 'Everything', db.entries.length, L && r.scope === 'all', '∗')}
        ${item('#/unsorted', 'Unsorted', unsorted, L && r.scope === 'unsorted', '○')}
        ${item('#/formative', 'Formative', db.entries.filter(e => e.formative).length, L && r.scope === 'formative', '<span class="f-mark"></span>')}
        <li><button class="nav-item" type="button" id="drift" style="width:100%" title="Open a random entry, older ones more likely"><span class="g">~</span><span>Drift</span><span class="n">↻</span></button></li>
        ${item('#/sort', 'Sorting table', sortQueue('all').length, r.page === 'sort', '≡')}
      </ul></section>
      <section class="nav-sec"><div class="nav-head"><span class="label">Kinds</span></div><ul class="nav-list">
        ${KIND_ORDER.map(k => item(`#/kind/${k}`, KINDS[k].plural, db.entries.filter(e => e.kind === k).length, L && r.scope === 'kind' && r.kind === k, KINDS[k].glyph)).join('')}
      </ul></section>
      <section class="nav-sec"><div class="nav-head"><a class="label" href="#/collections"${cur(r.page === 'collections')}>Collections</a><button class="add" type="button" data-new-collection title="New collection" aria-label="New collection">+</button></div><ul class="nav-list">
        ${cols.map(c => item(`#/c/${c.id}`, esc(c.name), inCollection(c.id).length, L && r.scope === 'collection' && r.id === c.id, '', `<button class="x-btn" type="button" data-del-collection="${c.id}" aria-label="Delete collection ${esc(c.name)}" title="Delete collection">×</button>`)).join('') || '<li class="label" style="padding:5px 0">None yet</li>'}
      </ul></section>
      <section class="nav-sec"><div class="nav-head"><a class="label" href="#/people"${cur(r.page === 'people')}>People</a></div><ul class="nav-list">
        ${ppl.slice(0, 6).map(p => item(`#/p/${encodeURIComponent(p.name)}`, esc(p.name), p.list.length, L && r.scope === 'person' && r.name === p.name)).join('') || '<li class="label" style="padding:5px 0">Add “by” to a find</li>'}
      </ul>${ppl.length > 6 ? `<a class="label nav-more" href="#/people">All ${ppl.length} people →</a>` : ''}</section>`;
  }
  side.addEventListener('click', e => {
    if (e.target.closest('#drift')) { if (narrow()) closeSide(); return drift(); }
    if (e.target.closest('[data-new-collection]')) return newCollection();
    const dc = e.target.closest('[data-del-collection]'); if (dc) { e.preventDefault(); return deleteCollection(dc.dataset.delCollection); }
    if (e.target.closest('a[href]') && narrow()) closeSide();
  });
  const openSide = () => { side.classList.add('is-open'); $('[data-side-close]', side).focus(); };
  const closeSide = () => side.classList.remove('is-open');
  $('#menu-btn').addEventListener('click', openSide);
  $$('[data-side-close]').forEach(b => b.addEventListener('click', closeSide));

  // New entry menu
  const newBtn = $('#new-btn'), newMenu = $('#new-menu');
  const toggleNew = (open = newMenu.hidden) => { newMenu.hidden = !open; newBtn.setAttribute('aria-expanded', String(open)); if (open) $('a', newMenu).focus(); };
  newBtn.addEventListener('click', () => toggleNew());
  newMenu.addEventListener('click', () => { toggleNew(false); if (narrow()) closeSide(); });
  document.addEventListener('click', e => { if (!newMenu.hidden && !e.target.closest('.side-new')) toggleNew(false); });

  async function newCollection() {
    const name = await ask({ title: 'New collection', body: 'A theme, an obsession, or research for a project.', ok: 'Create', input: { placeholder: 'Name' } });
    if (!name) return;
    const c = ensureCollection(name);
    persist(); if (narrow()) closeSide();
    toast(`Collection · ${c.name}`);
    go(`#/c/${c.id}`);
  }
  function drift() {
    if (!db.entries.length) return;
    const t = Date.now(), w = db.entries.map(e => 1 + (t - (Date.parse(e.date) || t)) / 3.15e10);
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    const pick = db.entries.find((_, k) => (r -= w[k]) <= 0) || db.entries[0];
    openEntry(pick.id);
  }

  /* ================= bar ================= */
  function setBar(crumbs, tools = '') {
    $('#crumbs').innerHTML = crumbs.map((c, i) => i === crumbs.length - 1 ? `<span class="here">${c[0]}</span>` : `<a href="${c[1]}">${c[0]}</a><span class="sep">/</span>`).join('');
    $('#bar-tools').innerHTML = tools;
  }
  const uploadTool = '<button type="button" class="tool-btn" data-upload title="Upload images or files (U)"><span class="up" aria-hidden="true">↑</span>Upload</button>';
  const listTools = () => `
    <button type="button" class="tool-btn" data-select aria-pressed="${!!ui.select}" title="Select entries to delete, collect or mark">${ui.select ? 'Done' : 'Select'}</button>
    ${uploadTool}<span class="seg-sep" aria-hidden="true"></span>
    <div class="seg" role="group" aria-label="Display">${Object.entries(DISPLAYS).map(([k, v]) => `<button type="button" data-display="${k}" aria-pressed="${prefs.display === k}">${v}</button>`).join('')}</div>
    ${prefs.display === 'graph' ? '' : `<label class="select-mini"><span class="label grp-label">Group by</span><select id="group-by" aria-label="Group by">${Object.entries(GROUPS).map(([k, v]) => `<option value="${k}"${prefs.group === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`}`;
  $('#bar-tools').addEventListener('click', e => {
    const d = e.target.closest('[data-display]'); if (d) { prefs.display = d.dataset.display; savePrefs(); if (prefs.display === 'graph') ui.select = null; ui.animate = true; renderMain(); }
    const s = e.target.closest('[data-step]'); if (s) step(+s.dataset.step);
    if (e.target.closest('[data-select]')) toggleSelect();
  });
  $('#bar-tools').addEventListener('change', e => { if (e.target.id === 'group-by') { prefs.group = e.target.value; savePrefs(); ui.animate = true; renderMain(); } });

  /* ================= render ================= */
  const main = $('#main');
  function render() { ui.route = parseRoute(); renderSide(); renderMain(); renderPanel(); }
  function refresh() { ui.route = parseRoute(); renderSide(); if (ui.route.page !== 'edit') renderMain(); renderPanel(); }
  function renderMain() {
    hidePreview();
    if (sim) { cancelAnimationFrame(sim.raf); sim = null; }
    const r = ui.route;
    if (ui.query && r.page !== 'edit') listPage({ page: 'list', scope: 'search' });
    else ({ list: listPage, collections: collectionsPage, people: peoplePage, entry: entryPage, edit: editPage, sort: sortPage })[r.page](r);
    renderSelbar();
    markOpen();
    ui.animate = false;
  }
  const rise = k => ui.animate ? ` rise" style="--d:${Math.min(k * 30, 600)}ms` : '';

  /* ---------- list pages ---------- */
  function scopeOf(r) {
    const q = norm(ui.query);
    switch (r.scope) {
      case 'search': return { title: `“${esc(ui.query)}”`, kick: 'Search', crumbs: [['Search', '#/all'], [esc(ui.query)]],
        entries: db.entries.filter(e => [e.title, e.body, e.url, e.by, e.file?.name, ...e.collections.map(c => colById(c)?.name)].join(' ').toLowerCase().includes(q)),
        desc: 'Searching titles, writing, people, sources and collections.', emptyText: 'No matches.' };
      case 'unsorted': return { title: 'Unsorted', crumbs: [['Library', '#/all'], ['Unsorted']], entries: db.entries.filter(e => !e.collections.length),
        desc: 'Entries that aren’t in a collection yet. Open one and give it a place, or select several at once.', emptyText: 'Everything has a place.', hint: true };
      case 'formative': return { title: 'Formative', crumbs: [['Library', '#/all'], ['Formative']], entries: db.entries.filter(e => e.formative),
        desc: 'The few things that truly shaped you. Mark an entry as formative from its side view.', emptyText: 'Nothing marked as formative yet.' };
      case 'kind': return { title: KINDS[r.kind].plural, crumbs: [['Kinds', '#/all'], [KINDS[r.kind].plural]], entries: db.entries.filter(e => e.kind === r.kind),
        desc: esc(KINDS[r.kind].desc), newHref: `#/new/${r.kind}`, newLabel: `New ${KINDS[r.kind].label.toLowerCase()}` };
      case 'collection': { const c = colById(r.id); return { title: esc(c.name), kick: 'Collection', crumbs: [['Collections', '#/collections'], [esc(c.name)]], entries: inCollection(c.id),
        desc: renderMd(c.description) || '<p class="muted">No description yet.</p>', descMd: true, collection: c, emptyText: 'Nothing in this collection yet.',
        emptyHint: 'Upload, paste or drop something while you’re here and it lands in this collection.' }; }
      case 'person': { const list = db.entries.filter(e => (e.by || '').trim() === r.name); const ys = list.map(e => e.date).filter(Boolean).sort();
        return { title: esc(r.name), kick: 'Person', crumbs: [['People', '#/people'], [esc(r.name)]], entries: list, person: r.name,
          desc: list.length ? `${plural(list.length, 'entry', 'entries')}${ys.length ? `, ${year(ys[0])}${year(ys[0]) !== year(ys.at(-1)) ? '–' + year(ys.at(-1)) : ''}` : ''}.` : 'No entries.' }; }
      default: return { title: 'Everything', crumbs: [['Library', '#/all'], ['Everything']], entries: db.entries, desc: 'Every note, find and work in the archive, newest first.', hint: true };
    }
  }

  function groupEntries(list, by) {
    const groups = new Map();
    const add = (key, label, e, extra = {}) => { if (!groups.has(key)) groups.set(key, { key, label, items: [], ...extra }); groups.get(key).items.push(e); };
    list.forEach(e => {
      if (by === 'year') add(year(e.date), year(e.date) === '—' ? 'Undated' : year(e.date), e);
      else if (by === 'kind') add(e.kind, KINDS[e.kind].plural, e, { glyph: KINDS[e.kind].glyph, href: `#/kind/${e.kind}`, order: KIND_ORDER.indexOf(e.kind) });
      else if (by === 'collection') {
        const cs = e.collections.map(colById).filter(Boolean);
        if (!cs.length) add('~', 'Unsorted', e, { href: '#/unsorted', order: 1e9 });
        cs.forEach(c => add(c.id, esc(c.name), e, { href: `#/c/${c.id}` }));
      } else if (by === 'person') {
        const p = (e.by || '').trim();
        if (p) add('p:' + p, esc(p), e, { href: `#/p/${encodeURIComponent(p)}` });
        else add(e.kind === 'find' ? '~u' : '~me', e.kind === 'find' ? 'Unattributed' : 'Me', e, { order: e.kind === 'find' ? 1e9 : -1 });
      } else add('all', '', e);
    });
    const out = [...groups.values()];
    if (by === 'year') out.sort((a, b) => (b.key === '—' ? '' : b.key).localeCompare(a.key === '—' ? '' : a.key));
    else if (by === 'kind') out.sort((a, b) => a.order - b.order);
    else out.sort((a, b) => (a.order || 0) - (b.order || 0) || b.items.length - a.items.length || a.label.localeCompare(b.label));
    return out;
  }

  const captureHint = () => `<p class="capture-hint label"><span>Quick capture:</span><span>paste a link, text or image anywhere</span><span class="k-only">drop files on the page</span><span><button type="button" data-upload>Upload</button><kbd>U</kbd></span><span class="k-only">new entry <kbd>N</kbd></span></p>`;

  function listPage(r) {
    const sc = scopeOf(r);
    const entries = [...sc.entries].sort(byNewest);
    ui.lastList = entries.map(e => e.id);
    if (r.scope !== 'search' && !/^#\/(e|new)\//.test(baseHash())) ui.lastScope = { hash: baseHash(), label: sc.crumbs.at(-1)[0] };
    setBar(sc.crumbs, listTools());
    const c = sc.collection;
    const head = r.edit && c ? `
      <form class="head" id="col-edit"><div class="head-edit">
        <span class="label">Collection</span>
        <label class="visually-hidden" for="col-name">Name</label><input id="col-name" name="name" value="${esc(c.name)}" autocomplete="off" placeholder="Name">
        <label class="label" for="col-desc">Description · Markdown</label><textarea id="col-desc" name="description" rows="3" placeholder="What ties these together?">${esc(c.description)}</textarea>
        <div class="row-actions"><button class="action action--primary" type="submit"><span class="dot"></span><span>Save</span></button><a class="action" href="#/c/${c.id}"><span>Cancel</span></a></div>
      </div></form>` : `
      <header class="head${rise(0)}">
        ${sc.kick ? `<span class="label kick">${sc.kick}</span>` : ''}
        <h1>${sc.title}<sup>${entries.length}</sup></h1>
        <div class="desc${sc.descMd ? ' md' : ''}">${sc.descMd ? sc.desc : `<p>${sc.desc}</p>`}</div>
        ${c ? `<div class="head-actions"><a class="action" href="#/c/${c.id}?edit"><span>Rename or describe</span></a><button class="action action--danger" type="button" data-del-collection="${c.id}"><span>Delete collection</span></button></div>` : ''}
        ${sc.person ? `<div class="head-actions"><button class="action" type="button" data-rename-person><span>Rename</span></button><button class="action action--danger" type="button" data-remove-person><span>Remove from entries</span></button></div>` : ''}
        ${sc.newHref ? `<div class="head-actions"><a class="action action--primary" href="${sc.newHref}"><span class="dot"></span><span>${sc.newLabel}</span></a></div>` : ''}
        ${sc.hint || c ? captureHint() : ''}
      </header>`;
    let body;
    if (!entries.length) {
      body = `<div class="empty"><p>${sc.emptyText || (db.entries.length ? 'Nothing here.' : 'The archive is empty.')}</p>${sc.emptyHint ? `<p class="hint">${sc.emptyHint}</p>` : ''}${!db.entries.length ? '<p class="hint">Start with a note, upload a file, or paste a link anywhere on the page.</p>' : ''}</div>`;
    } else if (prefs.display === 'graph') {
      body = graphHtml();
    } else {
      let k = 0;
      const next = () => k++;
      body = groupEntries(entries, prefs.group).map(g => `<section class="group">
        ${g.label ? `<header class="group-head${rise(next())}"><h2>${g.glyph ? `<span class="g">${g.glyph}</span>` : ''}${g.href ? `<a href="${g.href}">${g.label}</a>` : g.label}</h2><span class="label">${plural(g.items.length, 'entry', 'entries')}</span></header>` : ''}
        ${prefs.display === 'grid' ? gridHtml(g.items, next) : rowsHtml(g.items, prefs.group === 'year', next)}
      </section>`).join('');
    }
    main.innerHTML = head + body;
    if (prefs.display === 'graph' && entries.length) constellation($('.field-wrap', main), entries);
    wireRows();
    const form = $('#col-edit', main);
    if (form) {
      const name = $('#col-name', form); name.focus(); name.select();
      form.addEventListener('submit', e => {
        e.preventDefault();
        c.name = name.value.trim() || c.name; c.description = $('#col-desc', form).value.trim();
        persist(); toast('Collection saved'); go(`#/c/${c.id}`);
      });
    }
  }
  const sel = id => ui.select && ui.select.has(id);
  function rowsHtml(items, inYear, next) {
    const rel = relations();
    return `<ol class="rows${ui.select ? ' is-selecting' : ''}">${items.map(e => {
      const n = rel.filter(r => r.a === e.id || r.b === e.id).length;
      const cols = e.collections.map(cid => colById(cid)?.name).filter(Boolean);
      return `<li class="row${e.kind === 'work' ? ' is-work' : ''}${sel(e.id) ? ' is-checked' : ''}${rise(next())}" data-id="${e.id}"><a href="${entryHref(e.id)}">
        <span class="check" aria-hidden="true"></span>
        <span class="d label">${inYear ? fmtDay(e.date) : year(e.date)}</span>
        <span class="t">${titleHtml(e)}${fMark(e)}</span>
        <span class="k label">${kindLabel(e)}</span>
        <span class="c label" title="${esc(cols.join(', '))}">${esc(cols.join(' · ')) || '<span style="opacity:.5">Unsorted</span>'}</span>
        <span class="x label" title="${plural(n, 'connection')}">${n ? `↔ ${n}` : '—'}</span>
      </a><button class="x-btn" type="button" data-del-entry="${e.id}" aria-label="Delete ${esc(e.title)}" title="Delete">×</button></li>`;
    }).join('')}</ol>`;
  }
  function gridHtml(items, next) {
    return `<div class="grid${ui.select ? ' is-selecting' : ''}">${items.map(e => `<div class="tile${e.kind === 'work' ? ' is-work' : ''}${sel(e.id) ? ' is-checked' : ''}${rise(next())}" data-id="${e.id}">
      <a class="tile-link" href="${entryHref(e.id)}">
        <span class="check" aria-hidden="true"></span>
        ${plate(e)}
        <span class="meta"><span class="label">${kindLabel(e)} · ${year(e.date)}</span>${fMark(e)}</span>
        <h3>${titleHtml(e)}</h3>
        ${e.by ? `<p class="s">${esc(e.by)}</p>` : ''}
      </a><button class="x-btn" type="button" data-del-entry="${e.id}" aria-label="Delete ${esc(e.title)}" title="Delete">×</button></div>`).join('')}</div>`;
  }
  function wireRows() {
    if (!finePointer) return;
    $$('.rows', main).forEach(list => $$('.row[data-id]', list).forEach(row => {
      row.addEventListener('mouseenter', () => { if (ui.select || panelOpen()) return; list.classList.add('is-hovering'); row.classList.add('is-hover'); showPreview(byId(row.dataset.id)); });
      row.addEventListener('mouseleave', () => { row.classList.remove('is-hover'); list.classList.remove('is-hovering'); hidePreview(); });
    }));
  }
  function markOpen() {
    const id = ui.route && ui.route.panel;
    $$('[data-id]', main).forEach(el => el.classList.toggle('is-open', el.dataset.id === id));
  }

  /* ---------- collections overview ---------- */
  function collectionsPage() {
    setBar([['Collections', '#/collections'], ['All collections']], uploadTool);
    ui.lastScope = { hash: '#/collections', label: 'Collections' };
    const cols = [...db.collections].sort((a, b) => inCollection(b.id).length - inCollection(a.id).length || a.name.localeCompare(b.name));
    main.innerHTML = `<header class="head${rise(0)}"><h1>Collections<sup>${cols.length}</sup></h1>
        <div class="desc"><p>Groups you make yourself: themes, obsessions, research for a project. An entry can live in several.</p></div></header>
      <div class="cards">${cols.map((c, k) => {
        const list = inCollection(c.id).sort((a, b) => (!!b.image || !!b.swatch) - (!!a.image || !!a.swatch) || byNewest(a, b));
        const four = list.slice(0, 4);
        return `<div class="card${rise(k + 1)}"><a class="card-link" href="#/c/${c.id}">
          <div class="mosaic">${four.map(e => plate(e)).join('')}${'<div class="blank"></div>'.repeat(4 - four.length)}</div>
          <span class="meta"><span class="label">${plural(list.length, 'entry', 'entries')}</span></span>
          <h3>${esc(c.name)}</h3>
          ${c.description ? `<p class="s">${esc(plain(c.description))}</p>` : ''}
        </a><button class="x-btn" type="button" data-del-collection="${c.id}" aria-label="Delete collection ${esc(c.name)}" title="Delete collection">×</button></div>`;
      }).join('')}
        <button type="button" class="card card--new${rise(cols.length + 1)}" data-new-collection><div class="mosaic">+ New collection</div></button>
      </div>`;
  }

  /* ---------- people overview ---------- */
  function peoplePage() {
    setBar([['People', '#/people'], ['All people']], uploadTool);
    ui.lastScope = { hash: '#/people', label: 'People' };
    const ppl = people();
    main.innerHTML = `<header class="head${rise(0)}"><h1>People<sup>${ppl.length}</sup></h1>
        <div class="desc"><p>The artists, writers and voices behind your finds. Fill in “by” on a find to add someone.</p></div></header>
      ${ppl.length ? `<div class="people"><ol class="rows">${ppl.map((p, k) => {
        const ys = p.list.map(e => e.date).filter(Boolean).sort();
        const span = ys.length ? (year(ys[0]) === year(ys.at(-1)) ? year(ys[0]) : `${year(ys[0])}–${year(ys.at(-1))}`) : '';
        return `<li class="row${rise(k + 1)}"><a href="#/p/${encodeURIComponent(p.name)}">
          <span class="t">${esc(p.name)}${p.list.some(e => e.formative) ? '<span class="f-mark" title="Has formative entries"></span>' : ''}</span>
          <span class="k label">${plural(p.list.length, 'entry', 'entries')}</span>
          <span class="x label">${span}</span></a></li>`;
      }).join('')}</ol></div>` : '<div class="empty"><p>No people yet.</p><p class="hint">When you add a find, fill in who made it.</p></div>'}`;
  }

  /* ---------- entry: shared blocks ---------- */
  function aboutBlocks(e, { compact = false } = {}) {
    const k = KINDS[e.kind];
    const conns = db.links.filter(l => l.a === e.id || l.b === e.id).map(l => ({ l, o: byId(l.a === e.id ? l.b : l.a) })).filter(x => x.o).sort((a, b) => byNewest(a.o, b.o));
    const back = backlinks(e.id);
    const others = db.entries.filter(o => o.id !== e.id && !conns.some(c => c.o.id === o.id)).sort((a, b) => a.title.localeCompare(b.title));
    const link = id => compact ? entryHref(id) : `#/e/${id}`;
    return `
      <div class="meta-block${compact ? ' wide' : ''}">
        <button class="toggle" type="button" data-act="formative" aria-pressed="${!!e.formative}"><span class="box"></span>Formative</button>
        <p class="toggle-hint">${e.formative ? 'Marked as something that truly shaped you.' : 'Mark it if this truly shaped you.'}</p>
      </div>
      <div class="meta-block${compact ? ' wide' : ''}"><span class="label">Collections</span>
        ${e.collections.length ? `<div class="pills">${e.collections.map(colById).filter(Boolean).map(c => `<span class="pill"><a href="#/c/${c.id}">${esc(c.name)}</a><button type="button" class="rm" data-act="uncollect" data-id="${c.id}" aria-label="Remove from ${esc(c.name)}" title="Remove from collection">×</button></span>`).join('')}</div>` : ''}
        <form class="inline-add" data-form="collect"><input name="name" list="col-names-${e.id}" placeholder="${e.collections.length ? 'Add to another…' : 'Add to a collection…'}" autocomplete="off" aria-label="Add to collection"><button class="action" type="submit"><span>Add</span></button></form>
        <datalist id="col-names-${e.id}">${db.collections.filter(c => !e.collections.includes(c.id)).map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
      </div>
      <div class="meta-block${compact ? ' wide' : ''}"><span class="label">Connections · ${conns.length}</span>
        ${conns.length ? `<ul class="conns">${conns.map(({ l, o }) => `<li class="conn"><div><a class="go" href="${link(o.id)}">${titleHtml(o)}</a>${l.note ? `<p class="why">${esc(l.note)}</p>` : ''}</div><button type="button" class="rm" data-act="unlink" data-id="${l.id}" aria-label="Remove connection to ${esc(o.title)}" title="Remove connection">×</button></li>`).join('')}</ul>` : ''}
        <form class="connect" data-form="connect">
          <span class="sel"><select name="to" aria-label="Connect to"><option value="">Connect to…</option>${others.map(o => `<option value="${o.id}">${esc(o.title)}</option>`).join('')}</select></span>
          <input name="note" placeholder="Why? (the part that matters)" aria-label="Why are they connected">
          <button class="action" type="submit"><span>Connect</span></button>
        </form>
      </div>
      ${back.length ? `<div class="meta-block${compact ? ' wide' : ''}"><span class="label">Mentioned in · ${back.length}</span><ul class="conns">${back.map(o => `<li class="conn"><a class="go" href="${link(o.id)}">${titleHtml(o)}</a></li>`).join('')}</ul></div>` : ''}
      ${compact ? `
        <div class="meta-block"><label class="label" for="f-date-${e.id}">${k.date}</label><input class="inline-field" id="f-date-${e.id}" type="date" data-field="date" value="${esc(e.date)}"></div>
        <div class="meta-block"><label class="label" for="f-by-${e.id}">By</label><input class="inline-field" id="f-by-${e.id}" data-field="by" list="people-${e.id}" value="${esc(e.by)}" placeholder="${e.kind === 'find' ? 'Who made it?' : 'Me'}"><datalist id="people-${e.id}">${people().map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
        ${e.kind !== 'note' ? `<div class="meta-block wide"><label class="label" for="f-url-${e.id}">Source link</label><input class="inline-field" id="f-url-${e.id}" type="url" data-field="url" value="${esc(e.url)}" placeholder="https://"></div>` : ''}`
      : `<div class="meta-block"><span class="label">Details</span><p class="v">${kindLabel(e)}<br>${k.date} ${fmtDate(e.date)}${e.by ? `<br>by ${esc(e.by)}` : ''}<br><span class="muted">Added ${fmtDate((e.created || '').slice(0, 10))}</span></p></div>`}`;
  }
  function mediaAndText(e, { compact = false } = {}) {
    const docs = e.kind === 'work' ? docsOf(e.id) : [], of = e.documents && byId(e.documents);
    return `${of ? `<p class="doc-of label"><span class="g">◆</span> Documentation of <a href="#/e/${of.id}">${esc(of.title)}</a></p>` : ''}
      ${e.image || e.swatch ? `<div class="hero-media">${plate(e, { big: true })}</div>` : ''}
      ${docs.length ? `<section class="docs"><span class="label">Documentation · ${docs.length}</span><div class="docs-grid">${docs.map(d => `<a class="doc" href="${compact ? entryHref(d.id) : '#/e/' + d.id}" title="${esc(d.title)}">${plate(d)}</a>`).join('')}</div></section>` : ''}
      ${e.body ? `<div class="md">${renderMd(e.body, e)}</div>`
        : compact ? `<div class="body-wrap"><label class="visually-hidden" for="q-${e.id}">Note</label><textarea class="quick-note" id="q-${e.id}" data-field="body" placeholder="${esc(KINDS[e.kind].placeholder)}"></textarea></div>`
        : `<p class="muted">Nothing written yet. <a href="#/e/${e.id}/edit" style="text-decoration:underline">Write something</a>.</p>`}
      ${e.url ? `<a class="link" href="${esc(e.url)}" target="_blank" rel="noopener"><span>${esc(host(e.url) || e.url)} ↗</span></a>` : ''}
      ${e.original ? `<a class="link" href="${esc(e.original)}" target="_blank" rel="noopener"><span>Original image ↗</span></a>` : ''}
      ${e.page ? `<a class="link" href="${esc(e.page)}" target="_blank" rel="noopener"><span>Saved copy of the page ↗</span></a>` : ''}
      ${e.extra && e.extra.arena ? `<a class="link" href="${esc(e.extra.arena)}" target="_blank" rel="noopener"><span>On Are.na ↗</span></a>` : ''}
      ${e.file ? fileView(e.file) : ''}`;
  }
  // Video, audio and pdf play inside the entry; everything else can be downloaded
  function fileView(f) {
    if (!f.data) return `<p class="label">▤ ${esc(f.name)} · only the name is stored</p>`;
    const ext = (f.name.split('.').pop() || '').toLowerCase(), t = f.type || '', src = esc(f.data);
    let embed = '';
    if (!isData(f.data)) {
      if (/^video\//.test(t) || /^(mp4|m4v|mov|webm)$/.test(ext)) embed = `<video class="media-embed" src="${src}" controls preload="metadata"></video>`;
      else if (/^audio\//.test(t) || /^(mp3|wav|m4a|aac|ogg|flac)$/.test(ext)) embed = `<audio class="media-embed media-embed--audio" src="${src}" controls preload="metadata"></audio>`;
      else if (t === 'application/pdf' || ext === 'pdf') embed = `<iframe class="media-embed media-embed--pdf" src="${src}" title="${esc(f.name)}"></iframe>`;
    }
    return `${embed}<a class="link" href="${src}" download="${esc(f.name)}"><span>Download ${esc(f.name)}</span></a>`;
  }
  const kicker = e => `<div class="kicker"><span class="label label--ink">${e.kind === 'find' ? FORMATS[formatOf(e)].glyph : KINDS[e.kind].glyph} ${kindLabel(e)}</span><span class="label">${KINDS[e.kind].date} ${fmtDate(e.date)}</span>${e.formative ? '<span class="label" style="color:var(--signal);display:inline-flex;gap:8px;align-items:center"><span class="f-mark"></span>Formative</span>' : ''}</div>`;

  /* ---------- sorting table: one entry at a time ---------- */
  // Titles that only say what kind of thing it is, or where it was found
  const needsName = e => {
    const t = (e.title || '').trim();
    if (e.extra && e.extra.needs_name) return true;
    return !t || /^(image|file|link|video|block|untitled( image| file| link)?)( from \S+)?$/i.test(t) || /^https?:\/\//i.test(t)
      || /\.(png|jpe?g|gif|webp|heic|pdf|mp4|mov)\b/i.test(t) || /^\S{20,}$/.test(t) || /^[\w-]{1,12}$/.test(t) && /\d/.test(t) && /[a-z]/.test(t) && /[A-Z]/.test(t);
  };
  const openLinks = e => db.links.filter(l => (l.a === e.id || l.b === e.id) && !(l.note || '').trim() && byId(l.a) && byId(l.b));
  // Ids of entries with at least one connection that has no reason yet
  const openSet = () => { const s = new Set(); db.links.forEach(l => { if (!(l.note || '').trim()) { s.add(l.a); s.add(l.b); } }); return s; };
  let openCache = null;
  const hasOpen = e => (openCache || openSet()).has(e.id);
  const SORT_MODES = {
    all: { label: 'Everything', test: e => needsName(e) || hasOpen(e) || !e.collections.length },
    reasons: { label: 'Reasons', test: hasOpen, hint: 'Connections without a why' },
    names: { label: 'Names', test: needsName, hint: 'Entries with a placeholder title' },
    unsorted: { label: 'Unsorted', test: e => !e.collections.length, hint: 'Entries without a collection' },
  };
  // In Reasons, one Work at a time keeps the question the same from entry to entry
  const openFor = (e, work) => openLinks(e).filter(l => !work || l.a === work || l.b === work);
  const sortQueue = (mode, work) => {
    openCache = openSet();
    let out = db.entries.filter(e => e.kind !== 'work' && SORT_MODES[mode].test(e));
    if (work) out = out.filter(e => openFor(e, work).length);
    openCache = null; return out.sort(byNewest);
  };
  const worksWithOpen = () => db.entries.filter(w => w.kind === 'work').map(w => ({ w, n: db.links.filter(l => (l.a === w.id || l.b === w.id) && !(l.note || '').trim()).length })).filter(x => x.n).sort((a, b) => b.n - a.n);
  function sortPage(r) {
    const S = ui.sort && ui.sort.mode === r.mode && ui.sort.work === r.work ? ui.sort : (ui.sort = { mode: r.mode, work: r.work, list: sortQueue(r.mode, r.work).map(e => e.id), i: 0 });
    // Move past entries that were sorted elsewhere in the meantime
    const still = e => SORT_MODES[S.mode].test(e) && (!S.work || openFor(e, S.work).length);
    while (S.i < S.list.length && (!byId(S.list[S.i]) || !still(byId(S.list[S.i])))) S.i++;
    const tabs = Object.entries(SORT_MODES).map(([k, m]) => `<a href="#/sort/${k}"${k === r.mode ? ' aria-current="page"' : ''}>${m.label} · ${sortQueue(k).length}</a>`).join('')
      + (r.mode === 'reasons' ? `<label class="sort-work label">Work <select data-sort-work><option value="">All works</option>${worksWithOpen().map(({ w, n }) => `<option value="${w.id}"${w.id === r.work ? ' selected' : ''}>${esc(w.title)} · ${n}</option>`).join('')}</select></label>` : '');
    setBar([['Library', '#/all'], ['Sorting table']], S.i > 0 ? `<button class="action" type="button" data-sort-act="back"><span>← Back</span></button>` : '');
    const e = byId(S.list[S.i]);
    const left = S.list.length - S.i;
    if (!e) {
      main.innerHTML = `<section class="head"><h1>Sorting table</h1><p class="desc">One entry at a time: a name, a reason, a place.</p></section>
        <nav class="tabs sort-tabs">${tabs}</nav><div class="empty"><p>Nothing left to sort here.</p><p class="hint">Everything in this list has a name, a reason and a place. Choose another list above, or come back after a few new finds.</p></div>`;
      return;
    }
    const open = openLinks(e), done = neighbours(e.id).filter(n => n.link && (n.note || '').trim());
    const media = e.image ? `<div class="sorter-img"><img src="${esc(e.image)}" alt=""></div>` : `<div class="sorter-plate">${plate(e, { big: true })}</div>`;
    const cols = [...db.collections].sort((a, b) => a.name.localeCompare(b.name));
    const placeholder = needsName(e), guess = !!(e.extra && e.extra.needs_name);
    let was = ''; try { was = e.extra && e.extra.original_title ? JSON.parse(e.extra.original_title) : ''; } catch { was = e.extra.original_title; }
    if (S.work) open.sort((x, y) => ((y.a === S.work || y.b === S.work) - (x.a === S.work || x.b === S.work)));
    main.innerHTML = `<section class="head head--sort"><h1>Sorting table<sup>${left} left</sup></h1><p class="desc">${esc(SORT_MODES[r.mode].hint || 'One entry at a time: a name, a reason, a place.')}. Save with <kbd>⌘</kbd><kbd>↵</kbd>, skip with <kbd>⌥</kbd><kbd>→</kbd>.</p></section>
      <nav class="tabs sort-tabs">${tabs}</nav>
      <article class="sorter" data-sort="${e.id}">
        <div class="sorter-left">
          ${media}
          ${e.file ? fileView(e.file) : ''}
          <p class="label sorter-src">${[kindLabel(e), `${KINDS[e.kind].date} ${fmtDate(e.date)}`, e.by ? `by ${esc(e.by)}` : ''].filter(Boolean).join(' · ')}</p>
          <div class="sorter-links">
            ${e.url ? `<a class="link" href="${esc(e.url)}" target="_blank" rel="noopener"><span>${esc(host(e.url) || 'Source')} ↗</span></a>` : ''}
            ${e.page ? `<a class="link" href="${esc(e.page)}" target="_blank" rel="noopener"><span>Saved copy ↗</span></a>` : ''}
            ${e.extra && e.extra.arena ? `<a class="link" href="${esc(e.extra.arena)}" target="_blank" rel="noopener"><span>On Are.na ↗</span></a>` : ''}
            <a class="link" href="#/e/${e.id}"><span>Open page</span></a>
          </div>
        </div>
        <form class="sorter-form" data-sort-form autocomplete="off">
          <label class="label" for="s-title">Name${guess ? ' · a guess, check it' : placeholder ? ' · now “' + esc(e.title) + '”' : ''}${was ? ` · was “${esc(was.length > 60 ? was.slice(0, 58) + '…' : was)}”` : ''}</label>
          <input id="s-title" class="sorter-title" value="${placeholder && !guess ? '' : esc(e.title)}" placeholder="${placeholder ? 'What is it?' : esc(e.title)}">
          <label class="label" for="s-why">Why it stayed with you</label>
          <textarea id="s-why" rows="5" placeholder="${esc(KINDS[e.kind].placeholder)}">${esc(e.body || '')}</textarea>
          ${open.length || done.length ? `<div class="sorter-conns"><span class="label">Connections · ${open.length ? `${open.length} without a reason` : 'all explained'}</span>
            ${[...open.map(l => ({ l, other: byId(l.a === e.id ? l.b : l.a) })), ...done.map(n => ({ l: n.link, other: n.other }))].map(({ l, other }) => `
              <label class="sorter-conn"><span>${other.kind === 'work' ? 'What did this give' : 'How does this relate to'} <a href="#/e/${other.id}">${esc(other.title)}</a>?</span>
              <span class="conn-row"><input data-link="${l.id}" value="${esc(l.note || '')}" placeholder="${other.kind === 'work' ? 'The part that fed the work' : 'The part that matters'}"><button type="button" class="label link-quiet" data-unlink="${l.id}" title="This is not really connected">Not part of it ×</button></span></label>`).join('')}
          </div>` : ''}
          <div class="sorter-cols"><span class="label">Collections</span><div class="chips">
            ${cols.map(c => `<button type="button" class="chip-t" data-col="${c.id}" aria-pressed="${e.collections.includes(c.id)}">${esc(c.name)}</button>`).join('')}
          </div></div>
          <div class="sorter-row"><button class="toggle" type="button" data-sort-formative aria-pressed="${!!e.formative}"><span class="box"></span>Formative</button></div>
          <div class="sorter-actions">
            <button class="action" type="submit"><span>Save &amp; next</span></button>
            <button class="action" type="button" data-sort-act="skip"><span>Skip</span></button>
            <span class="label">${S.i + 1} of ${S.list.length}</span>
          </div>
        </form>
      </article>`;
    const t = $('#s-title'); (placeholder ? t : (open.length ? $('[data-link]', main) : $('#s-why')) || t).focus({ preventScroll: true });
  }
  function sortSave() {
    const S = ui.sort, f = $('[data-sort-form]', main); if (!S || !f) return;
    const e = byId(S.list[S.i]); if (!e) return;
    const title = $('#s-title').value.trim();
    if (title && title !== e.title) renameEntry(e, title);
    if (title && e.extra) delete e.extra.needs_name;
    e.body = $('#s-why').value.trim();
    $$('[data-link]', f).forEach(i => { const l = db.links.find(x => x.id === i.dataset.link); if (l) l.note = i.value.trim(); });
    e.collections = $$('[data-col][aria-pressed="true"]', f).map(b => b.dataset.col);
    e.formative = $('[data-sort-formative]', f).getAttribute('aria-pressed') === 'true';
    e.updated = now(); persist();
    S.i++; renderSide(); renderMain(); scrollTo({ top: 0 });
  }
  main.addEventListener('submit', ev => { if (ev.target.closest('[data-sort-form]')) { ev.preventDefault(); sortSave(); } });
  main.addEventListener('change', ev => { const s = ev.target.closest('[data-sort-work]'); if (s) go(s.value ? `#/sort/reasons/${s.value}` : '#/sort/reasons'); });
  document.addEventListener('click', ev => {
    if (!ui.route || ui.route.page !== 'sort') return;
    const c = ev.target.closest('[data-col]'); if (c && c.closest('.sorter')) { c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') !== 'true'); return; }
    const fm = ev.target.closest('[data-sort-formative]'); if (fm) { fm.setAttribute('aria-pressed', fm.getAttribute('aria-pressed') !== 'true'); return; }
    const u = ev.target.closest('[data-unlink]');
    if (u) { db.links = db.links.filter(l => l.id !== u.dataset.unlink); persist(); const row = u.closest('.sorter-conn'); if (row) row.remove(); toast('Connection removed'); renderSide(); return; }
    const a = ev.target.closest('[data-sort-act]'); if (!a) return;
    if (a.dataset.sortAct === 'skip') ui.sort.i++;
    if (a.dataset.sortAct === 'back') ui.sort.i = Math.max(0, ui.sort.i - 1);
    renderMain(); scrollTo({ top: 0 });
  });
  main.addEventListener('keydown', ev => {
    if (!ui.route || ui.route.page !== 'sort') return;
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); return sortSave(); }
    if (ev.altKey && ev.key === 'ArrowRight') { ev.preventDefault(); ui.sort.i++; return renderMain(); }
    if (ev.altKey && ev.key === 'ArrowLeft') { ev.preventDefault(); ui.sort.i = Math.max(0, ui.sort.i - 1); return renderMain(); }
    // Enter in a one-line field moves on to the next field
    if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') {
      ev.preventDefault();
      const fields = $$('.sorter-form input, .sorter-form textarea', main), k = fields.indexOf(ev.target);
      if (fields[k + 1]) fields[k + 1].focus(); else sortSave();
    }
  });

  /* ---------- entry: full page ---------- */
  function entryPage(r) {
    const e = byId(r.id);
    const rel = relations();
    const pos = ui.lastList.indexOf(e.id);
    setBar([[esc(ui.lastScope.label), ui.lastScope.hash], [esc(e.title)]], `
      <button class="action" type="button" data-step="-1" ${pos < 1 ? 'disabled' : ''} aria-label="Previous entry"><span>←</span></button>
      <button class="action" type="button" data-step="1" ${pos < 0 || pos >= ui.lastList.length - 1 ? 'disabled' : ''} aria-label="Next entry"><span>→</span></button>
      <a class="action" href="#/e/${e.id}/edit"><span>Edit</span></a>`);
    const isWork = e.kind === 'work';
    const lineage = isWork && r.tab === 'lineage';
    main.innerHTML = `<article class="entry" data-entry="${e.id}">
      <div class="entry-main${rise(0)}">
        ${kicker(e)}
        <h1>${titleHtml(e)}</h1>
        ${e.by ? `<p class="by">by <a href="#/p/${encodeURIComponent(e.by.trim())}">${esc(e.by)}</a></p>` : ''}
        ${isWork ? `<nav class="tabs" aria-label="Views of this work"><a href="#/e/${e.id}"${lineage ? '' : ' aria-current="page"'}>Entry</a><a href="#/e/${e.id}/lineage"${lineage ? ' aria-current="page"' : ''}>Lineage · ${neighbours(e.id, rel).length}</a></nav>` : ''}
        ${lineage ? lineageHtml(e, rel) : mediaAndText(e)}
      </div>
      <aside class="entry-side${rise(1)}" aria-label="About this entry">
        ${aboutBlocks(e)}
        <div class="entry-actions"><a class="action" href="#/e/${e.id}/edit"><span>Edit</span></a><button class="action action--danger" type="button" data-act="delete"><span>Delete</span></button></div>
      </aside>
    </article>`;
    if (lineage) { const box = $('.gens', main); if (box) { requestAnimationFrame(() => drawThreads(box)); wireThreads(box); } }
  }

  /* ---------- entry: side view ---------- */
  const panel = $('#panel'), scrim = $('#scrim');
  const panelOpen = () => panel.classList.contains('is-open');
  let panelReturn = null;
  function renderPanel() {
    const r = ui.route;
    const id = r && LISTISH.includes(r.page) ? r.panel : null;
    const e = id && byId(id);
    if (!e) {
      if (/[?&]e=/.test(location.hash) && r && LISTISH.includes(r.page)) history.replaceState(null, '', baseHash());
      if (panelOpen()) {
        panel.classList.remove('is-open'); panel.setAttribute('inert', '');
        scrim.classList.remove('is-on'); setTimeout(() => { if (!panelOpen()) scrim.hidden = true; }, 300);
        if (panelReturn && document.contains(panelReturn)) panelReturn.focus({ preventScroll: true });
      }
      return;
    }
    const wasOpen = panelOpen();
    if (!wasOpen) panelReturn = document.activeElement;
    const keepScroll = wasOpen && panel.dataset.id === e.id ? panel.scrollTop : 0;
    const pos = ui.lastList.indexOf(e.id);
    panel.dataset.id = e.id;
    panel.innerHTML = `
      <div class="panel-top">
        <span class="label count">${pos > -1 ? `${pos + 1} / ${ui.lastList.length}` : kindLabel(e)}</span>
        <button class="action" type="button" data-pstep="-1" ${pos < 1 ? 'disabled' : ''} aria-label="Previous entry" title="Previous (←)"><span>←</span></button>
        <button class="action" type="button" data-pstep="1" ${pos < 0 || pos >= ui.lastList.length - 1 ? 'disabled' : ''} aria-label="Next entry" title="Next (→)"><span>→</span></button>
        <a class="action open-page" href="#/e/${e.id}" title="Open as a full page"><span>Open page</span></a>
        <button class="action" type="button" data-pclose aria-label="Close side view"><span>Close</span></button>
      </div>
      <div class="panel-body" data-entry="${e.id}">
        ${kicker(e)}
        <label class="visually-hidden" for="pt-${e.id}">Title</label>
        <textarea class="panel-title" id="pt-${e.id}" data-field="title" rows="1" spellcheck="false">${esc(e.title)}</textarea>
        ${e.by ? `<p class="by-line">by <a href="#/p/${encodeURIComponent(e.by.trim())}">${esc(e.by)}</a></p>` : ''}
        ${mediaAndText(e, { compact: true })}
        ${e.kind === 'work' ? `<a class="link" href="#/e/${e.id}/lineage"><span>See the lineage of this work →</span></a>` : ''}
        <div class="panel-meta">${aboutBlocks(e, { compact: true })}</div>
        <div class="panel-actions"><a class="action action--primary" href="#/e/${e.id}/edit"><span class="dot"></span><span>${e.body ? 'Edit text & media' : 'Write in the editor'}</span></a><button class="action action--danger" type="button" data-act="delete"><span>Delete entry</span></button></div>
      </div>`;
    growTitle($('.panel-title', panel));
    panel.removeAttribute('inert');
    if (!wasOpen) {
      panel.classList.add('is-open'); scrim.hidden = false; requestAnimationFrame(() => scrim.classList.add('is-on'));
      $('[data-pclose]', panel).focus({ preventScroll: true });
    }
    panel.scrollTop = keepScroll;
  }
  const growTitle = t => { if (!t) return; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
  const closePanel = () => { if (panelOpen()) go(baseHash()); };
  scrim.addEventListener('click', closePanel);
  panel.addEventListener('click', e => {
    if (e.target.closest('[data-pclose]')) return closePanel();
    const s = e.target.closest('[data-pstep]'); if (s) return step(+s.dataset.pstep);
    const wl = e.target.closest('a[data-entry-link]'); if (wl) { e.preventDefault(); openEntry(wl.dataset.entryLink); }
  });
  panel.addEventListener('input', e => { if (e.target.classList.contains('panel-title')) growTitle(e.target); });
  panel.addEventListener('keydown', e => { if (e.target.classList.contains('panel-title') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

  /* ---------- entry actions (page and side view) ---------- */
  document.addEventListener('click', e => {
    const host = e.target.closest('[data-entry]'); if (!host) return;
    const b = e.target.closest('[data-act]'); if (!b) return;
    const entry = byId(host.dataset.entry); if (!entry) return;
    switch (b.dataset.act) {
      case 'formative': entry.formative = !entry.formative; toast(entry.formative ? 'Marked as formative' : 'No longer formative'); break;
      case 'uncollect': entry.collections = entry.collections.filter(id => id !== b.dataset.id); break;
      case 'unlink': return withUndo('Connection removed', () => { db.links = db.links.filter(l => l.id !== b.dataset.id); });
      case 'delete': return deleteEntries([entry.id]);
      default: return;
    }
    entry.updated = now(); persist(); refresh();
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('[data-form]'); const host = f && f.closest('[data-entry]'); if (!host) return;
    e.preventDefault();
    const entry = byId(host.dataset.entry), data = new FormData(f);
    if (f.dataset.form === 'collect') {
      const c = ensureCollection(data.get('name') || ''); if (!c) return $('input', f).focus();
      if (!entry.collections.includes(c.id)) entry.collections.push(c.id);
    } else if (f.dataset.form === 'connect') {
      if (!data.get('to')) return $('select', f).focus();
      db.links.push({ id: uid(), a: entry.id, b: data.get('to'), note: data.get('note').trim() });
      toast('Connected');
    }
    entry.updated = now(); persist(); refresh();
    const again = $(`[data-entry="${entry.id}"] [data-form="${f.dataset.form}"] input`); if (again) again.focus();
  });
  // Inline fields in the side view save when you leave them
  document.addEventListener('change', e => {
    const f = e.target.closest('[data-field]'); const host = f && f.closest('[data-entry]'); if (!host) return;
    const entry = byId(host.dataset.entry); if (!entry) return;
    const v = f.value;
    if (f.dataset.field === 'title') { if (!v.trim()) { f.value = entry.title; return; } const n = renameEntry(entry, v); if (n) toast(`Renamed · updated ${plural(n, 'link')}`); }
    else if (f.dataset.field === 'body') { if (!v.trim()) return; entry.body = v.trim(); }
    else { entry[f.dataset.field] = v.trim(); }
    entry.updated = now(); persist();
    renderSide(); renderMain();
    if (f.dataset.field === 'body' || f.dataset.field === 'url') renderPanel();
  });

  /* ---------- deleting, with undo ---------- */
  function withUndo(msg, fn) {
    const snap = JSON.stringify(db);
    fn(); persist(); refresh();
    toast(msg, 'Undo', () => { db = JSON.parse(snap); persist(); refresh(); toast('Restored'); });
  }
  async function deleteEntries(ids) {
    const list = ids.map(byId).filter(Boolean); if (!list.length) return;
    const one = list.length === 1;
    const n = db.links.filter(l => ids.includes(l.a) || ids.includes(l.b)).length;
    const ok = await ask({ title: one ? `Delete “${list[0].title}”?` : `Delete ${list.length} entries?`,
      body: `${n ? `This also removes ${plural(n, 'connection')}. ` : ''}You can undo this right after.`, ok: 'Delete', danger: true });
    if (!ok) return;
    // Leave a full page or editor of a deleted entry before it disappears
    if (['entry', 'edit'].includes(ui.route.page) && ids.includes(ui.route.id)) { ui.dirty = false; ui.skipGuard = true; location.hash = ui.lastScope.hash; }
    withUndo(one ? 'Entry deleted' : `${list.length} entries deleted`, () => {
      db.entries = db.entries.filter(x => !ids.includes(x.id));
      db.links = db.links.filter(l => !ids.includes(l.a) && !ids.includes(l.b));
      if (ui.select) ids.forEach(id => ui.select.delete(id));
    });
  }
  async function deleteCollection(cid) {
    const c = colById(cid); if (!c) return;
    const n = inCollection(cid).length;
    const ok = await ask({ title: `Delete the collection “${c.name}”?`, body: n ? `The ${plural(n, 'entry', 'entries')} in it stay in the archive; they just leave this collection.` : 'It is empty.', ok: 'Delete collection', danger: true });
    if (!ok) return;
    const here = ui.route.scope === 'collection' && ui.route.id === cid;
    withUndo('Collection deleted', () => {
      db.collections = db.collections.filter(x => x.id !== cid);
      db.entries.forEach(x => { x.collections = x.collections.filter(id => id !== cid); });
    });
    if (here) go('#/collections');
  }

  main.addEventListener('click', e => {
    if (e.target.closest('[data-new-collection]')) return newCollection();
    const dc = e.target.closest('[data-del-collection]'); if (dc) { e.preventDefault(); return deleteCollection(dc.dataset.delCollection); }
    const de = e.target.closest('[data-del-entry]'); if (de) { e.preventDefault(); return deleteEntries([de.dataset.delEntry]); }
    if (e.target.closest('[data-rename-person]')) return renamePerson();
    if (e.target.closest('[data-remove-person]')) return removePerson();
    if (ui.select) { const item = e.target.closest('[data-id]'); if (item && e.target.closest('a')) { e.preventDefault(); toggleItem(item.dataset.id); } }
  });

  async function renamePerson() {
    const old = ui.route.name;
    const name = await ask({ title: `Rename “${old}”`, body: 'Changes the name on every entry by this person.', ok: 'Rename', input: { value: old } });
    if (!name || name === old) return;
    db.entries.forEach(e => { if ((e.by || '').trim() === old) e.by = name; });
    persist(); toast('Renamed'); go(`#/p/${encodeURIComponent(name)}`);
  }
  async function removePerson() {
    const old = ui.route.name, list = db.entries.filter(e => (e.by || '').trim() === old);
    const ok = await ask({ title: `Remove “${old}”?`, body: `The name is cleared from ${plural(list.length, 'entry', 'entries')}. The entries themselves stay.`, ok: 'Remove', danger: true });
    if (!ok) return;
    withUndo('Person removed', () => list.forEach(e => { e.by = ''; }));
    go('#/people');
  }

  /* ---------- selecting several entries ---------- */
  function toggleSelect(on = !ui.select) {
    ui.select = on ? new Set() : null;
    if (on && prefs.display === 'graph') { prefs.display = 'list'; savePrefs(); }
    if (on) closePanel();
    renderMain();
  }
  function toggleItem(id) {
    ui.select.has(id) ? ui.select.delete(id) : ui.select.add(id);
    $$(`[data-id="${id}"]`, main).forEach(el => el.classList.toggle('is-checked', ui.select.has(id)));
    renderSelbar();
  }
  const selbar = $('#selbar');
  function renderSelbar() {
    const on = !!ui.select && ui.route.page === 'list';
    document.body.classList.toggle('has-selbar', on);
    if (!on) { selbar.hidden = true; return; }
    const n = ui.select.size, inCol = ui.route.scope === 'collection';
    selbar.hidden = false;
    selbar.innerHTML = `<span class="n">${n ? `${n} selected` : 'Click entries to select them'}</span>
      <button class="action" type="button" data-sel="all"><span>${n === ui.lastList.length && n ? 'Select none' : 'Select all'}</span></button>
      <button class="action" type="button" data-sel="collect" ${n ? '' : 'disabled'}><span>Add to collection</span></button>
      ${inCol ? `<button class="action" type="button" data-sel="uncollect" ${n ? '' : 'disabled'}><span>Remove from collection</span></button>` : ''}
      <button class="action" type="button" data-sel="formative" ${n ? '' : 'disabled'}><span>Formative</span></button>
      <button class="action action--danger" type="button" data-sel="delete" ${n ? '' : 'disabled'}><span>Delete</span></button>
      <button class="action" type="button" data-sel="done"><span>Done</span></button>`;
  }
  selbar.addEventListener('click', async e => {
    const b = e.target.closest('[data-sel]'); if (!b) return;
    const ids = [...ui.select];
    const list = ids.map(byId).filter(Boolean);
    switch (b.dataset.sel) {
      case 'all': ui.select = ids.length === ui.lastList.length ? new Set() : new Set(ui.lastList); renderMain(); break;
      case 'done': toggleSelect(false); break;
      case 'delete': await deleteEntries(ids); break;
      case 'collect': {
        const name = await ask({ title: `Add ${plural(list.length, 'entry', 'entries')} to a collection`, ok: 'Add', input: { placeholder: 'Collection name (new or existing)', list: db.collections.map(c => c.name) } });
        if (!name) return;
        withUndo(`Added to ${name}`, () => { const c = ensureCollection(name); list.forEach(x => { if (!x.collections.includes(c.id)) x.collections.push(c.id); }); });
        break;
      }
      case 'uncollect': withUndo('Removed from collection', () => list.forEach(x => { x.collections = x.collections.filter(id => id !== ui.route.id); })); ui.select = new Set(); renderMain(); break;
      case 'formative': { const all = list.every(x => x.formative); withUndo(all ? 'No longer formative' : 'Marked as formative', () => list.forEach(x => { x.formative = !all; })); break; }
    }
  });

  function step(d) {
    const cur = panelOpen() ? ui.route.panel : ui.route.id;
    const pos = ui.lastList.indexOf(cur), next = ui.lastList[pos + d];
    if (pos < 0 || !next) return;
    if (panelOpen()) openEntry(next); else go(`#/e/${next}`);
  }

  /* ---------- lineage ---------- */
  function trace(root, rel, depth = 3) {
    const seen = new Set([root.id]);
    const gens = [[{ entry: root }]];
    for (let d = 1; d <= depth; d++) {
      const next = [];
      gens[d - 1].forEach(({ entry }) => neighbours(entry.id, rel).forEach(n => {
        if (!n.other || seen.has(n.other.id)) return;
        seen.add(n.other.id);
        next.push({ entry: n.other, via: entry, note: n.note, mention: n.mention });
      }));
      if (!next.length) break;
      gens.push(next);
    }
    return gens;
  }
  function lineageHtml(root, rel) {
    const gens = trace(root, rel);
    if (gens.length < 2) return `<div class="empty"><p>Nothing is connected to this work yet.</p><p class="hint">Connect it to what shaped it from the panel on the right, or mention entries in its text with [[double brackets]].</p></div>`;
    const names = ['This work', 'Shaped by', 'Behind those', 'Further back'];
    return `<p class="lineage-intro">Everything connected to this work, then what is connected to those. Hover an entry to see the path back.</p>
      <div class="gens" style="--n:${gens.length - 1}"><svg aria-hidden="true"></svg>
      ${gens.slice(1).map((g, i) => { const d = i + 1; return `<div class="gen">
        <div class="gen-head"><span class="label label--ink">0${d} · ${names[d]}</span><span class="label">${g.length}</span></div>
        ${g.map(({ entry, via, note, mention }, k) => `<a class="kin${rise(d * 3 + k)}" href="#/e/${entry.id}" data-kin="${entry.id}" data-parent="${via.id}"${mention ? ' data-mention' : ''}>
          ${plate(entry)}
          <span><span class="label">${kindLabel(entry)} · ${year(entry.date)}</span>
          <h3>${titleHtml(entry)}</h3>
          ${note ? `<p class="because">${esc(note)}</p>` : mention ? '<p class="because">mentioned in the text</p>' : ''}
          ${d > 1 ? `<p class="via label">via ${esc(via.title)}</p>` : ''}</span>
        </a>`).join('')}</div>`; }).join('')}</div>`;
  }
  function drawThreads(box) {
    const svg = $('svg', box);
    if (getComputedStyle(svg).display === 'none') return;
    const o = box.getBoundingClientRect();
    svg.innerHTML = $$('[data-parent]', box).map(k => {
      const p = $(`[data-kin="${k.dataset.parent}"]`, box); if (!p) return '';
      const a = p.getBoundingClientRect(), b = k.getBoundingClientRect();
      const x1 = a.right - o.left, y1 = a.top + a.height / 2 - o.top, x2 = b.left - o.left, y2 = b.top + b.height / 2 - o.top, m = (x2 - x1) / 2;
      return `<path class="${'mention' in k.dataset ? 'is-mention' : ''}" data-from="${k.dataset.parent}" data-to="${k.dataset.kin}" d="M${x1} ${y1} C${x1 + m} ${y1} ${x2 - m} ${y2} ${x2} ${y2}"/>`;
    }).join('');
  }
  function wireThreads(box) {
    const chain = id => { const out = [id]; let k = $(`[data-kin="${id}"]`, box); while (k && k.dataset.parent) { out.push(k.dataset.parent); k = $(`[data-kin="${k.dataset.parent}"]`, box); } return out; };
    $$('.kin', box).forEach(k => {
      k.addEventListener('mouseenter', () => {
        const ids = new Set(chain(k.dataset.kin));
        box.classList.add('is-focus');
        $$('.kin', box).forEach(x => x.classList.toggle('is-hot', ids.has(x.dataset.kin)));
        $$('path', box).forEach(p => p.classList.toggle('is-hot', ids.has(p.dataset.to) && ids.has(p.dataset.from)));
      });
      k.addEventListener('mouseleave', () => { box.classList.remove('is-focus'); $$('.is-hot', box).forEach(x => x.classList.remove('is-hot')); });
    });
  }

  /* ---------- graph ---------- */
  function graphHtml() {
    return `<div class="field-wrap${ui.animate ? ' rise' : ''}">
      <svg role="img" aria-label="Graph of entries and their connections"></svg>
      <div class="field-hud top">
        <div class="legend label"><span><i style="background:var(--paper)"></i>Find</span><span><i style="background:var(--on-dark-muted)"></i>Note</span><span><i class="ring"></i>Work</span><span><i style="background:var(--signal-light)"></i>Formative</span><span><i class="ls"></i>Connection</span><span><i class="ln"></i>Mention</span></div>
        <span class="label" id="field-count"></span>
      </div>
      <div class="field-hud bottom">
        <div class="readout" id="readout"><span class="label">Hover a point · drag to rearrange · click to open</span></div>
        <span class="label">Older ← → newer</span>
      </div></div>`;
  }
  let sim = null;
  function constellation(wrap, entries) {
    const svg = $('svg', wrap);
    const W = wrap.clientWidth, H = wrap.clientHeight, pad = 70;
    const ids = new Set(entries.map(e => e.id));
    const rel = relations().filter(r => ids.has(r.a) && ids.has(r.b));
    const order = [...entries].sort((a, b) => -byNewest(a, b)).map(e => e.id);
    const tx = e => entries.length < 2 ? W / 2 : pad + order.indexOf(e.id) / (entries.length - 1) * (W - pad * 2);
    const nodes = entries.map(e => {
      const deg = rel.filter(r => r.a === e.id || r.b === e.id).length;
      return { e, deg, home: tx(e), x: tx(e), y: H / 2 + (Math.random() - .5) * H * .5, vx: 0, vy: 0, r: e.kind === 'work' ? 9 : 3 + Math.sqrt(deg) * 1.6 };
    });
    const at = Object.fromEntries(nodes.map(n => [n.e.id, n]));
    const edges = rel.map(r => ({ s: at[r.a], t: at[r.b], r }));
    $('#field-count', wrap).textContent = `${plural(nodes.length, 'point')} · ${plural(edges.length, 'thread')}`;
    const NS = 'http://www.w3.org/2000/svg';
    const make = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; };
    const gE = make('g'), gN = make('g'); svg.append(gE, gN);
    edges.forEach(ed => { ed.el = make('line', { class: `e${ed.r.mention ? ' is-mention' : ''}` }); gE.append(ed.el); });
    nodes.forEach(n => {
      n.el = make('g', { class: `n k-${n.e.kind}${n.e.formative ? ' is-formative' : ''}${n.e.kind === 'work' || n.deg >= 3 || n.e.formative ? ' is-labelled' : ''}`, tabindex: 0, role: 'link', 'aria-label': n.e.title });
      n.el.append(make('circle', { class: 'halo', r: n.r + 9 }));
      if (n.e.kind === 'work') { n.el.append(make('circle', { class: 'ring', r: n.r })); n.el.append(make('circle', { class: 'core', r: 3 })); }
      else n.el.append(make('circle', { class: 'core', r: n.r }));
      const label = make('text', { y: n.r + 16, 'text-anchor': 'middle' });
      label.textContent = n.e.title.length > 30 ? n.e.title.slice(0, 29) + '…' : n.e.title;
      n.el.append(label); gN.append(n.el);
    });
    let alpha = 1, drag = null, moved = false;
    function tick() {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]; let dx = b.x - a.x, dy = b.y - a.y; const d2 = dx * dx + dy * dy || 1, d = Math.sqrt(d2), f = 5200 / d2 * alpha;
          dx /= d; dy /= d; a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
        }
        a.vx += (a.home - a.x) * .006 * alpha; a.vy += (H / 2 - a.y) * .0025 * alpha;
      }
      edges.forEach(({ s, t }) => { const dx = t.x - s.x, dy = t.y - s.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 130) * .012 * alpha; s.vx += dx / d * f; s.vy += dy / d * f; t.vx -= dx / d * f; t.vy -= dy / d * f; });
      nodes.forEach(n => { if (n === drag) return; n.vx *= .62; n.vy *= .62; n.x = Math.max(pad / 2, Math.min(W - pad / 2, n.x + n.vx)); n.y = Math.max(60, Math.min(H - 90, n.y + n.vy)); });
      draw();
      alpha = Math.max(alpha * .986, drag ? .25 : 0);
      if (alpha > .008 && sim) sim.raf = requestAnimationFrame(tick);
    }
    function draw() {
      edges.forEach(ed => { ed.el.setAttribute('x1', ed.s.x); ed.el.setAttribute('y1', ed.s.y); ed.el.setAttribute('x2', ed.t.x); ed.el.setAttribute('y2', ed.t.y); });
      nodes.forEach(n => n.el.setAttribute('transform', `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`));
    }
    const readout = $('#readout', wrap), idle = readout.innerHTML;
    function focus(n) {
      wrap.classList.toggle('is-focus', !!n);
      const near = n ? new Set([n, ...edges.filter(ed => ed.s === n || ed.t === n).flatMap(ed => [ed.s, ed.t])]) : new Set();
      nodes.forEach(m => m.el.classList.toggle('is-hot', near.has(m)));
      edges.forEach(ed => ed.el.classList.toggle('is-hot', !!n && (ed.s === n || ed.t === n)));
      const txt = n && excerpt(n.e.body);
      readout.innerHTML = n ? `<span class="label">${kindLabel(n.e)} · ${fmtDate(n.e.date)} · ${plural(n.deg, 'thread')}</span><span class="t">${titleHtml(n.e)}</span>${txt ? `<span class="b">${esc(txt.length > 140 ? txt.slice(0, 139) + '…' : txt)}</span>` : ''}` : idle;
    }
    const point = ev => { const b = svg.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top]; };
    nodes.forEach(n => {
      n.el.addEventListener('pointerdown', ev => { drag = n; moved = false; svg.setPointerCapture(ev.pointerId); svg.classList.add('is-dragging'); alpha = Math.max(alpha, .25); if (sim) { cancelAnimationFrame(sim.raf); tick(); } });
      n.el.addEventListener('pointerenter', () => !drag && focus(n));
      n.el.addEventListener('pointerleave', () => !drag && focus(null));
      n.el.addEventListener('focus', () => focus(n));
      n.el.addEventListener('blur', () => focus(null));
      n.el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEntry(n.e.id); } });
    });
    svg.addEventListener('pointermove', ev => { if (!drag) return; const [x, y] = point(ev); if (Math.abs(x - drag.x) + Math.abs(y - drag.y) > 2) moved = true; drag.x = x; drag.y = y; drag.home = x; });
    svg.addEventListener('pointerup', () => { svg.classList.remove('is-dragging'); if (drag && !moved) openEntry(drag.e.id); drag = null; });
    sim = { raf: requestAnimationFrame(tick) };
  }

  /* ---------- hover preview ---------- */
  const preview = $('#preview'), pdot = $('#preview-dot');
  let mx = 0, my = 0;
  const place = () => {
    const w = preview.offsetWidth, h = preview.offsetHeight;
    const x = mx + 28 + w > innerWidth ? mx - 28 - w : mx + 28;
    const y = Math.max(76, Math.min(innerHeight - h - 12, my - h / 2));
    preview.style.transform = `translate(${x}px, ${y}px)`; pdot.style.left = mx + 'px'; pdot.style.top = my + 'px';
  };
  addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; if (preview.classList.contains('is-visible')) place(); }, { passive: true });
  function showPreview(e) { if (!e) return; preview.innerHTML = plate(e); preview.classList.add('is-visible'); pdot.classList.add('is-visible'); place(); }
  function hidePreview() { preview.classList.remove('is-visible'); pdot.classList.remove('is-visible'); }

  /* ================= editor ================= */
  function editPage(r) {
    const existing = r.id ? byId(r.id) : null;
    if (!ui.draft || ui.draft._route !== location.hash) {
      const preset = ui.preset || {}; ui.preset = null;
      const ctx = (ui.lastScope.hash.match(/^#\/c\/([^?&]+)/) || [])[1];
      ui.draft = existing ? JSON.parse(JSON.stringify(existing)) : newEntry({
        kind: preset.kind || r.kind, title: preset.title || r.title || '', body: preset.body || '', url: preset.url || '',
        image: preset.image || null, file: preset.file || null, collections: ctx && colById(ctx) ? [ctx] : [],
      });
      ui.draft._route = location.hash; ui.draftUrl = existing ? existing.url : '';
      ui.dirty = !!(preset.url || preset.image || preset.file || preset.body);
    }
    const d = ui.draft;
    setBar(existing ? [[esc(ui.lastScope.label), ui.lastScope.hash], [esc(existing.title), `#/e/${existing.id}`], ['Edit']] : [[esc(ui.lastScope.label), ui.lastScope.hash], [`New ${KINDS[d.kind].label.toLowerCase()}`]],
      `<span class="label">${existing ? 'Editing' : 'Not saved yet'}</span>`);
    main.innerHTML = `<form class="edit-page" id="edit-form" autocomplete="off" novalidate>
      <div class="kind-pick" role="radiogroup" aria-label="Kind"><span class="label">Kind</span>
        ${KIND_ORDER.map(k => `<label><input type="radio" name="kind" value="${k}"${d.kind === k ? ' checked' : ''}><span class="p"><span class="g">${KINDS[k].glyph}</span>${KINDS[k].label}</span></label>`).join('')}
        <span class="help" id="kind-help">${KINDS[d.kind].help}</span>
      </div>
      <label class="visually-hidden" for="e-title">Title</label>
      <input class="title-input" id="e-title" name="title" value="${esc(d.title)}" placeholder="Title">
      <div class="edit-grid">
        <div class="edit-body">
          <div class="editor" data-mode="${prefs.mode}">
            <div class="editor-bar" role="toolbar" aria-label="Formatting">
              <button type="button" data-md="h2" title="Heading">H2</button><button type="button" data-md="h3" title="Subheading">H3</button>
              <span class="sep"></span>
              <button type="button" data-md="bold" title="Bold (⌘B)"><b>B</b></button><button type="button" data-md="italic" title="Italic (⌘I)"><i>I</i></button>
              <button type="button" data-md="quote" title="Quote">“</button>
              <span class="sep"></span>
              <button type="button" data-md="ul" title="List">•</button><button type="button" data-md="ol" title="Numbered list" class="tool-extra">1.</button><button type="button" data-md="task" title="Checklist" class="tool-extra">☐</button>
              <span class="sep"></span>
              <button type="button" data-md="link" title="Web link (⌘K)">↗</button><button type="button" data-md="wiki" title="Link to an entry">[[ ]]</button><button type="button" data-md="image" title="Insert image">◐</button>
              <button type="button" data-md="code" title="Code" class="tool-extra">&lt;/&gt;</button><button type="button" data-md="hr" title="Divider" class="tool-extra">—</button>
              <div class="modes" role="group" aria-label="Editor layout">${['write', 'split', 'preview'].map(m => `<button type="button" data-mode="${m}" aria-pressed="${prefs.mode === m}">${m}</button>`).join('')}</div>
            </div>
            <div class="editor-panes">
              <div class="pane-write"><label class="visually-hidden" for="e-body">Text, in Markdown</label><textarea id="e-body" name="body" spellcheck="true" placeholder="${esc(KINDS[d.kind].placeholder)}">${esc(d.body)}</textarea><div class="suggest" id="suggest" role="listbox" hidden></div></div>
              <div class="pane-preview" aria-label="Preview"><div class="md" id="e-preview"></div></div>
            </div>
            <input type="file" id="md-image" accept="image/*" hidden>
          </div>
        </div>
        <div class="edit-meta">
          <div class="fieldset" data-for="find work"><label class="label" for="e-by">By</label><input id="e-by" name="by" list="people-names" value="${esc(d.by)}" placeholder="Artist, writer, source"><datalist id="people-names">${people().map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
          <div class="fieldset" data-for="find work"><label class="label" for="e-url">Source link</label><input id="e-url" name="url" type="url" value="${esc(d.url)}" placeholder="https://"></div>
          <div class="fieldset"><label class="label" for="e-date" id="date-label">${KINDS[d.kind].date}</label><input id="e-date" name="date" type="date" value="${esc(d.date)}"></div>
          <div class="fieldset"><span class="label">Image or file</span>
            <label class="dropbox" id="dropbox"><input type="file" id="e-media" hidden><span id="dropbox-inner" style="display:contents"></span></label></div>
          <div class="fieldset"><span class="label">Collections</span>
            <div class="pills" id="e-cols"></div>
            <div class="inline-add"><input id="e-col" list="col-names-e" placeholder="Add to a collection…" aria-label="Add to collection"><datalist id="col-names-e">${db.collections.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist></div></div>
          <div class="fieldset"><button class="toggle" type="button" id="e-formative" aria-pressed="${!!d.formative}"><span class="box"></span>Formative</button><p class="toggle-hint">Something that truly shaped you.</p></div>
        </div>
      </div>
      <div class="edit-actions">
        <button class="action action--primary" type="submit"><span class="dot"></span><span>${existing ? 'Save changes' : 'Save entry'}</span></button>
        <button class="action" type="button" id="e-cancel"><span>Cancel</span></button>
        ${existing ? '<button class="action action--danger" type="button" id="e-delete"><span>Delete</span></button>' : ''}
        <span class="label hint">⌘S save · Esc cancel · [[ link an entry</span>
      </div>
    </form>`;
    wireEditor(existing);
  }

  function wireEditor(existing) {
    const form = $('#edit-form'), d = ui.draft;
    const ta = $('#e-body'), pv = $('#e-preview'), editor = $('.editor', form);
    const dirty = () => { ui.dirty = true; };
    const syncKind = () => {
      $$('[data-for]', form).forEach(f => { f.hidden = !f.dataset.for.split(' ').includes(d.kind); });
      $('#kind-help').textContent = KINDS[d.kind].help;
      $('#date-label').textContent = KINDS[d.kind].date;
      ta.placeholder = KINDS[d.kind].placeholder;
    };
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight, innerHeight * .6) + 'px'; };
    let pt;
    const updatePreview = () => { clearTimeout(pt); pt = setTimeout(() => { const html = renderMd(ta.value, d); pv.innerHTML = html || 'The preview appears here'; pv.classList.toggle('is-empty', !html); }, 90); };
    const drawMedia = () => {
      $('#dropbox-inner').innerHTML = d.image ? `<img src="${d.image}" alt=""><button type="button" class="label clear" data-clear>Remove</button>`
        : d.file ? `<span class="file"><span class="label">File · ${Math.max(1, Math.round((d.file.size || 0) / 1024))} KB</span><span>${esc(d.file.name)}</span></span><button type="button" class="label clear" data-clear>Remove</button>`
        : '<span class="empty-drop"><span class="label">Optional</span><b>Drop, paste or choose</b></span>';
    };
    const drawCols = () => {
      $('#e-cols').innerHTML = d.collections.map(colById).filter(Boolean).map(c => `<span class="pill">${esc(c.name)}<button type="button" class="rm" data-uncol="${c.id}" aria-label="Remove from ${esc(c.name)}">×</button></span>`).join('');
    };
    syncKind(); drawMedia(); drawCols(); updatePreview(); requestAnimationFrame(grow);
    (d.title ? ta : $('#e-title')).focus({ preventScroll: true });

    form.addEventListener('input', e => {
      if (e.target.name === 'title') d.title = e.target.value;
      if (e.target.name === 'by') d.by = e.target.value;
      if (e.target.name === 'url') d.url = e.target.value;
      if (e.target.name === 'date') d.date = e.target.value;
      if (e.target === ta) { d.body = ta.value; grow(); updatePreview(); suggest(); }
      if (e.target.id !== 'e-col') dirty();
    });
    form.addEventListener('change', e => { if (e.target.name === 'kind') { d.kind = e.target.value; syncKind(); dirty(); } });
    $('#e-formative').addEventListener('click', e => { d.formative = !d.formative; e.currentTarget.setAttribute('aria-pressed', String(d.formative)); dirty(); });
    const colInput = $('#e-col');
    const addCol = () => { const c = ensureCollection(colInput.value); if (c && !d.collections.includes(c.id)) d.collections.push(c.id); colInput.value = ''; drawCols(); dirty(); };
    colInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCol(); } });
    colInput.addEventListener('change', () => { if (db.collections.some(c => norm(c.name) === norm(colInput.value))) addCol(); });
    $('#e-cols').addEventListener('click', e => { const b = e.target.closest('[data-uncol]'); if (b) { d.collections = d.collections.filter(id => id !== b.dataset.uncol); drawCols(); dirty(); } });
    $('#dropbox').addEventListener('click', e => { if (e.target.closest('[data-clear]')) { e.preventDefault(); d.image = null; d.original = null; d.file = null; d.swatch = null; drawMedia(); dirty(); } });
    $('#e-media').addEventListener('change', async e => { const f = e.target.files[0]; if (f) { Object.assign(d, { image: null, original: null, file: null, swatch: null }, await readMedia(f)); drawMedia(); dirty(); } e.target.value = ''; });
    $('#e-cancel').addEventListener('click', cancelEdit);
    const del = $('#e-delete'); if (del) del.addEventListener('click', () => deleteEntries([existing.id]));
    form.addEventListener('submit', e => { e.preventDefault(); saveDraft(existing); });
    form.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveDraft(existing); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.id !== 'e-col') e.preventDefault();
    });
    ui.setMedia = media => { Object.assign(d, { image: null, original: null, file: null, swatch: null }, media); drawMedia(); dirty(); };

    $('.modes', form).addEventListener('click', e => {
      const b = e.target.closest('[data-mode]'); if (!b) return;
      prefs.mode = b.dataset.mode; savePrefs(); editor.dataset.mode = prefs.mode;
      $$('.modes button', form).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      requestAnimationFrame(grow);
    });

    const sel = () => [ta.selectionStart, ta.selectionEnd];
    const insert = (text, a = ta.selectionStart, b = ta.selectionEnd, selectFrom, selectTo) => {
      ta.focus(); ta.setSelectionRange(a, b);
      if (!document.execCommand('insertText', false, text)) { ta.setRangeText(text, a, b, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
      if (selectFrom != null) ta.setSelectionRange(a + selectFrom, a + (selectTo ?? selectFrom));
    };
    const wrap = (pre, post = pre, ph = 'text') => { const [a, b] = sel(); const t = ta.value.slice(a, b) || ph; insert(pre + t + post, a, b, pre.length, pre.length + t.length); };
    const linePrefix = (prefix, numbered) => {
      const [a, b] = sel(); const start = ta.value.lastIndexOf('\n', a - 1) + 1;
      const lines = ta.value.slice(start, b).split('\n');
      const out = lines.map((l, i) => (numbered ? `${i + 1}. ` : prefix) + l.replace(/^(#{1,6} |> |[-*+] (\[[ x]\] )?|\d+\. )/, '')).join('\n');
      insert(out, start, b, out.length);
    };
    $('.editor-bar', form).addEventListener('click', e => {
      const b = e.target.closest('[data-md]'); if (!b) return;
      ({
        h2: () => linePrefix('## '), h3: () => linePrefix('### '),
        bold: () => wrap('**'), italic: () => wrap('_'), code: () => wrap('`', '`', 'code'),
        quote: () => linePrefix('> '), ul: () => linePrefix('- '), ol: () => linePrefix('', true), task: () => linePrefix('- [ ] '),
        link: () => { const [a, bb] = sel(); const t = ta.value.slice(a, bb) || 'text'; insert(`[${t}](https://)`, a, bb, t.length + 3, t.length + 11); },
        wiki: () => { const [a, bb] = sel(); const t = ta.value.slice(a, bb); insert(`[[${t}`, a, bb); suggest(); },
        hr: () => insert('\n\n---\n\n'),
        image: () => $('#md-image').click(),
      })[b.dataset.md]();
    });
    const insertImage = async file => {
      const data = await downscale(file, 1600), id = uid();
      d.assets = d.assets || {}; d.assets[id] = data;
      insert(`\n![${file.name.replace(/\.[^.]+$/, '')}](asset:${id})\n`);
    };
    $('#md-image').addEventListener('change', async e => { const f = e.target.files[0]; if (f) await insertImage(f); e.target.value = ''; });
    ta.addEventListener('paste', async e => {
      const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); e.stopPropagation(); await insertImage(f); }
    });

    const sug = $('#suggest');
    let sugItems = [], sugIndex = 0, sugStart = -1;
    ta.addEventListener('keydown', e => {
      if (!sug.hidden) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sugIndex = (sugIndex + (e.key === 'ArrowDown' ? 1 : -1) + sugItems.length) % sugItems.length; drawSug(); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(sugItems[sugIndex]); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideSug(); return; }
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**'); }
      if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('_'); }
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('[data-md="link"]', form).click(); }
      if (e.key === 'Enter' && !e.shiftKey && !mod) {
        const s = ta.selectionStart, start = ta.value.lastIndexOf('\n', s - 1) + 1, line = ta.value.slice(start, s);
        const m = line.match(/^(\s*)([-*+] \[[ x]\] |[-*+] |(\d+)\. |> )/);
        if (m) {
          e.preventDefault();
          if (line.trim() === m[2].trim()) insert('', start, s);
          else insert('\n' + m[1] + (m[3] ? `${+m[3] + 1}. ` : m[2].replace('[x]', '[ ]')));
        }
      }
    });
    function suggest() {
      const s = ta.selectionStart, m = ta.value.slice(0, s).match(/\[\[([^\]\n|]*)$/);
      if (!m) return hideSug();
      sugStart = s - m[1].length;
      const q = norm(m[1]);
      sugItems = db.entries.filter(x => x.id !== d.id && (!q || norm(x.title).includes(q)))
        .sort((a, b) => norm(a.title).indexOf(q) - norm(b.title).indexOf(q) || a.title.localeCompare(b.title)).slice(0, 7);
      if (m[1].trim() && !byTitle(m[1])) sugItems.push({ id: null, title: m[1].trim(), isNew: true });
      if (!sugItems.length) return hideSug();
      sugIndex = 0; drawSug();
      const c = caret(ta);
      sug.style.top = `${ta.offsetTop + c.top + c.lh + 2}px`;
      sug.style.left = `${Math.max(12, Math.min(c.left, ta.clientWidth - 300))}px`;
      sug.hidden = false;
    }
    function drawSug() {
      sug.innerHTML = sugItems.map((x, i) => `<button type="button" role="option" aria-selected="${i === sugIndex}" data-i="${i}">${x.isNew ? `Link to a new note “${esc(x.title)}”` : esc(x.title)}<span class="label">${x.isNew ? '+' : kindLabel(x)}</span></button>`).join('');
    }
    function hideSug() { sug.hidden = true; sugItems = []; }
    function pick(x) {
      if (!x) return;
      const s = ta.selectionStart, close = ta.value.slice(s).startsWith(']]') ? 2 : 0;
      insert(`${x.title}]]`, sugStart, s + close);
      hideSug();
    }
    sug.addEventListener('mousedown', e => { e.preventDefault(); const b = e.target.closest('[data-i]'); if (b) pick(sugItems[+b.dataset.i]); });
    ta.addEventListener('blur', () => setTimeout(hideSug, 120));
    ta.addEventListener('click', suggest);
  }

  function caret(ta) {
    const div = document.createElement('div'), cs = getComputedStyle(ta);
    ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'width', 'boxSizing', 'tabSize'].forEach(p => { div.style[p] = cs[p]; });
    Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '-9999px' });
    div.textContent = ta.value.slice(0, ta.selectionStart);
    const span = document.createElement('span'); span.textContent = '​'; div.append(span);
    document.body.append(div);
    const out = { top: span.offsetTop, left: span.offsetLeft + ta.offsetLeft, lh: parseFloat(cs.lineHeight) || 24 };
    div.remove();
    return out;
  }

  function saveDraft(existing) {
    const d = ui.draft;
    let title = (d.title || '').trim();
    if (!title && d.file) title = d.file.name.replace(/\.[^.]+$/, '');
    if (!title && d.url) title = host(d.url);
    if (!title && d.body.trim()) title = plain(d.body).split(/[.!?\n]/)[0].slice(0, 80).trim();
    if (!title) { const t = $('#e-title'); t.focus(); t.placeholder = 'Give it a title first'; return; }
    let n = 0;
    if (existing) n = renameEntry(existing, title);
    if (d.assets) Object.keys(d.assets).forEach(id => { if (!d.body.includes(`asset:${id}`)) delete d.assets[id]; });
    const clean = { ...d, title, updated: now() };
    delete clean._route;
    if (existing) Object.assign(existing, clean); else db.entries.push(clean);
    persist();
    if (clean.url && !clean.page && clean.url !== ui.draftUrl) enrich(clean);
    ui.dirty = false; ui.draft = null; ui.skipGuard = true;
    toast(existing ? (n ? `Saved · updated ${plural(n, 'link')}` : 'Saved') : 'Added to the archive');
    go(`#/e/${clean.id}`);
  }
  function cancelEdit() {
    if (ui.dirty && !confirmLeave()) return;
    const r = ui.route; ui.dirty = false; ui.skipGuard = true;
    go(r.id ? `#/e/${r.id}` : ui.lastScope.hash);
  }
  // Leaving unsaved writing uses the browser's own confirm: it is synchronous, which hash navigation needs
  const confirmLeave = () => confirm('Leave without saving? Your changes will be lost.');

  /* ================= media ================= */
  async function readMedia(file) {
    if (SERVER) {
      if (file.type.startsWith('image/')) {
        // Keep the original; large photos also get a lighter copy to show in the archive
        const original = await upload(file, file.name);
        if (file.size < 1.5e6 || /svg|gif/.test(file.type)) return { image: original, original: null };
        try { return { image: await upload(await downscale(file, 1600), file.name.replace(/\.[^.]+$/, '') + '-1600.jpg'), original }; }
        catch { return { image: original, original: null }; }
      }
      return { file: { name: file.name, size: file.size, type: file.type, data: await upload(file, file.name) } };
    }
    if (file.type.startsWith('image/')) return { image: await downscale(file, 1600) };
    return { file: { name: file.name, size: file.size, data: file.size < 4e6 ? await asDataUrl(file) : null } };
  }
  const asDataUrl = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  async function downscale(file, max) {
    const img = new Image(); img.src = await asDataUrl(file); await img.decode();
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', .85);
  }

  /* ================= capturing: upload, drop and paste ================= */
  const cleanName = name => name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
  // Add entries straight into the archive; one opens in the side view, several get a summary
  function capture(entries, what) {
    if (!entries.length) return;
    const snap = JSON.stringify(db);
    db.entries.push(...entries); persist();
    if (ui.route.page === 'list') refresh();
    const target = ui.route.page === 'list' ? baseHash() : '#/all';
    const undo = () => { db = JSON.parse(snap); persist(); go(baseHash()); refresh(); toast('Removed again'); };
    if (entries.length === 1) {
      const h = `${target}${target.includes('?') ? '&' : '?'}e=${entries[0].id}`;
      if (location.hash === h) refresh(); else location.hash = h;
      toast(`${what} added`, 'Undo', undo);
    } else {
      if (location.hash !== target) location.hash = target; else refresh();
      toast(`${entries.length} entries added`, 'Undo', undo);
    }
  }
  async function captureFiles(files) {
    if (!files.length) return;
    const out = [];
    for (const f of files) {
      const media = await readMedia(f);
      out.push(newEntry({ kind: 'find', title: cleanName(f.name), ...media }));
    }
    capture(out, out[0].image ? 'Image' : 'File');
  }
  function captureText(text) {
    if (/^https?:\/\/\S+$/.test(text)) {
      const e = newEntry({ kind: 'find', url: text, title: host(text) || text });
      capture([e], 'Source');
      return enrich(e);
    }
    const first = text.split('\n')[0].trim();
    const title = first.length > 90 ? first.slice(0, 88).replace(/\s\S*$/, '') + '…' : first;
    const body = text.trim() === first ? '' : text.trim();
    capture([newEntry({ kind: 'note', title, body: body || (first.length > 90 ? first : '') })], 'Thought');
  }

  // With the server running, a saved link gets its title, preview image and a copy of the page
  async function enrich(e) {
    if (!SERVER || !e.url) return;
    let r;
    try { r = await (await fetch(`/api/unfurl?url=${encodeURIComponent(e.url)}`)).json(); } catch { return; }
    const live = byId(e.id);
    if (!live) return;
    if (r.error) return toast('Could not reach that page · the link is saved');
    if (r.title && (!live.title || live.title === host(live.url) || live.title === live.url)) live.title = r.title;
    if (r.image && !live.image) live.image = r.image;
    if (r.file && !live.file) live.file = r.file;
    if (r.by && !live.by) live.by = r.by;
    if (r.description && !live.body) live.body = `> ${r.description}`;
    if (r.page) live.page = r.page;
    live.updated = now(); persist();
    if (!isTyping(document.activeElement)) refresh();
    toast('Page saved');
  }

  const uploadInput = $('#upload-input');
  const pickUpload = () => { uploadInput.value = ''; uploadInput.click(); };
  document.addEventListener('click', e => { if (e.target.closest('[data-upload]')) { e.preventDefault(); if (narrow()) closeSide(); pickUpload(); } });
  uploadInput.addEventListener('change', () => captureFiles([...uploadInput.files]));

  let depth = 0;
  const dz = $('#dropzone');
  addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { depth++; dz.classList.add('is-on'); } });
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; dz.classList.remove('is-on'); } });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; dz.classList.remove('is-on');
    const files = [...e.dataTransfer.files]; if (!files.length) return;
    if (ui.route.page === 'edit') return ui.setMedia(await readMedia(files[0]));
    captureFiles(files);
  });
  addEventListener('paste', async e => {
    if (ui.route.page === 'edit' || isTyping(document.activeElement) || $('#ask').open) return;
    const file = [...(e.clipboardData?.files || [])][0], text = e.clipboardData?.getData('text/plain')?.trim();
    if (file) { e.preventDefault(); return captureFiles([file]); }
    if (text) { e.preventDefault(); captureText(text); }
  });

  /* ================= search, keys, routing ================= */
  const search = $('#search');
  search.addEventListener('input', () => {
    ui.query = search.value.trim();
    if (ui.route.page === 'edit') return;
    renderSide(); renderMain();
  });
  search.addEventListener('keydown', e => {
    if (e.key === 'Escape') { search.value = ''; ui.query = ''; renderSide(); renderMain(); search.blur(); }
    if (e.key === 'Enter') { const first = $('.row a, .tile-link', main); if (first) { first.click(); if (narrow()) closeSide(); } }
  });

  addEventListener('keydown', e => {
    if ($('#ask').open) return;
    if (e.key === 'Escape') {
      if (!newMenu.hidden) return toggleNew(false);
      if (side.classList.contains('is-open')) return closeSide();
      if (panelOpen() && !(isTyping(e.target) && e.target.closest('#panel'))) return closePanel();
      if (panelOpen()) return e.target.blur();
      if (ui.select) return toggleSelect(false);
      if (ui.route.page === 'edit' && e.target.id !== 'e-body') return cancelEdit();
      return;
    }
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!newMenu.hidden && 'nfw'.includes(e.key)) { e.preventDefault(); toggleNew(false); if (narrow()) closeSide(); return go(`#/new/${{ n: 'note', f: 'find', w: 'work' }[e.key]}`); }
    if (ui.route.page === 'edit') return;
    if (e.key === 'n') { e.preventDefault(); if (narrow()) openSide(); toggleNew(true); }
    else if (e.key === 'u') { e.preventDefault(); pickUpload(); }
    else if (e.key === '/') { e.preventDefault(); if (narrow()) openSide(); search.focus(); }
    else if (panelOpen() || ui.route.page === 'entry') {
      if (e.key === 'ArrowRight' || e.key === 'j') step(1);
      if (e.key === 'ArrowLeft' || e.key === 'k') step(-1);
      if (e.key === 'e') go(`#/e/${panelOpen() ? ui.route.panel : ui.route.id}/edit`);
    } else if (ui.route.page === 'list' && '123'.includes(e.key)) { prefs.display = Object.keys(DISPLAYS)[+e.key - 1]; savePrefs(); ui.animate = true; renderMain(); }
  });

  addEventListener('hashchange', () => {
    const prev = ui.route;
    const leaving = prev && prev.page === 'edit' && ui.draft && ui.draft._route !== location.hash;
    if (leaving && ui.dirty && !ui.skipGuard && !confirmLeave()) { history.replaceState(null, '', ui.draft._route); return; }
    if (leaving) { ui.draft = null; ui.dirty = false; }
    ui.skipGuard = false;
    closeSide(); if (!newMenu.hidden) toggleNew(false);
    // Only the side view changed: keep the page as it is
    const base = baseHash();
    if (prev && LISTISH.includes(prev.page) && ui.lastBase === base && !ui.query) {
      ui.route = parseRoute(); renderPanel(); markOpen(); renderSide(); return;
    }
    ui.lastBase = base;
    if (ui.query) { ui.query = ''; search.value = ''; }
    if (ui.select && !(prev && prev.page === 'list' && baseHash() === ui.lastScope.hash)) ui.select = null;
    ui.animate = true;
    render();
    scrollTo({ top: 0 });
    if (ui.route.page !== 'edit' && !panelOpen()) main.focus({ preventScroll: true });
  });
  addEventListener('beforeunload', e => { if (ui.dirty) { e.preventDefault(); e.returnValue = ''; } });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (ui.route && ui.route.page !== 'edit' && (prefs.display === 'graph' || ui.route.tab === 'lineage')) renderMain(); }, 150); });

  /* ================= footer: export, import, examples, reset ================= */
  $('#export').addEventListener('click', () => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' })), download: `memory-archive-${today()}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast('Exported');
  });
  $('#import').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const next = data.version === 2 ? data : Array.isArray(data.items) ? migrate(data) : null;
      if (!next || !Array.isArray(next.entries)) throw new Error('not an archive');
      const ok = await ask({ title: `Import ${plural(next.entries.length, 'entry', 'entries')}?`, body: `This replaces everything currently in the archive with the contents of ${esc(file.name)}.`, ok: 'Replace archive', danger: true });
      if (!ok) return;
      withUndo('Imported', () => { db = next; });
      go('#/all');
    } catch { toast('That file is not a Memory Archive export'); }
  });
  $('#clear-examples').addEventListener('click', async () => {
    const n = db.entries.filter(x => x.example).length;
    if (!n) return toast('No examples left');
    const ok = await ask({ title: `Remove the ${n} example entries?`, body: 'Example collections that become empty go too. Your own entries stay.', ok: 'Remove examples', danger: true });
    if (!ok) return;
    withUndo('Examples removed', () => {
      const ex = new Set(db.entries.filter(x => x.example).map(x => x.id));
      db.entries = db.entries.filter(x => !ex.has(x.id));
      db.links = db.links.filter(l => !ex.has(l.a) && !ex.has(l.b));
      db.collections = db.collections.filter(c => !c.example || inCollection(c.id).length);
    });
    go('#/all');
  });
  $('#reset').addEventListener('click', async () => {
    const ok = await ask({ title: 'Delete everything?', body: `All ${plural(db.entries.length, 'entry', 'entries')}, ${plural(db.collections.length, 'collection')} and connections are removed from this browser. Export a backup first if you might want them back later.`, ok: 'Delete everything', danger: true });
    if (!ok) return;
    withUndo('Archive emptied', () => { db = { version: 2, entries: [], collections: [], links: [] }; });
    go('#/all');
  });

  /* ================= dialog & toast ================= */
  const askDlg = $('#ask');
  function ask({ title, body = '', ok = 'OK', danger = false, input = null }) {
    return new Promise(res => {
      askDlg.innerHTML = `<form method="dialog">
        <span class="label">${danger ? 'Are you sure?' : 'Memory Archive'}</span>
        <h2>${esc(title)}</h2>${body ? `<p class="ask-body">${body}</p>` : ''}
        ${input ? `<input name="v" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" autocomplete="off"${input.list ? ' list="ask-list"' : ''}><datalist id="ask-list">${(input.list || []).map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : ''}
        <div class="ask-actions"><button class="action ${danger ? 'is-danger' : 'action--primary'}" value="ok">${danger ? '' : '<span class="dot"></span>'}<span>${esc(ok)}</span></button><button class="action" value="cancel" formnovalidate><span>Cancel</span></button></div>
      </form>`;
      askDlg.returnValue = '';
      askDlg.showModal();
      const inp = $('input', askDlg);
      (inp || $('[value=ok]', askDlg)).focus();
      if (inp) inp.select();
      askDlg.addEventListener('close', () => {
        const v = askDlg.returnValue === 'ok' ? (inp ? inp.value.trim() || null : true) : null;
        res(v);
      }, { once: true });
    });
  }
  askDlg.addEventListener('click', e => { if (e.target === askDlg) askDlg.close('cancel'); });

  let tt;
  function toast(msg, actionLabel, action) {
    const t = $('#toast');
    t.innerHTML = `<span class="dot"></span>${esc(msg)}${actionLabel ? `<button type="button" class="label" style="color:var(--signal-light);margin-left:6px">${esc(actionLabel)}</button>` : ''}`;
    if (action) $('button', t).addEventListener('click', () => { t.classList.remove('is-on'); action(); });
    t.classList.add('is-on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('is-on'), actionLabel ? 7000 : 2400);
  }

  /* ================= example content ================= */
  function seed() {
    const C = (id, name, description) => ({ id, name, description, created: now(), example: true });
    const collections = [
      C('c-rep', 'Repetition', 'Doing the same thing again until it changes. Drawing one line, stitching one stitch, photographing one horizon.'),
      C('c-sea', 'The sea', 'Tides, horizons and what water leaves behind.'),
      C('c-line', 'Line & thread', 'Lines as drawing, walking, weaving and writing. After **Tim Ingold**.'),
      C('c-fam', 'Family', 'Where I come from, and what was in the drawers.'),
      C('c-quiet', 'Quiet', 'Work that lowers the volume, and what happens when it doesn’t.'),
    ];
    const E = (id, kind, title, date, cols, body, more = {}) => ({ id, kind, title, date, collections: cols, body, url: '', by: '', image: null, file: null, swatch: null, formative: false, assets: {}, created: date + 'T12:00:00.000Z', updated: date + 'T12:00:00.000Z', example: true, ...more });
    const entries = [
      E('w1', 'work', 'Tidelines', '2025-03-14', ['c-rep', 'c-sea'],
`Twelve drawings of the line the sea leaves behind. Pencil on paper, 50 × 70 cm each.

## Process
Every morning at low tide I walked the same stretch of beach and drew the highest line of debris, from memory, once I was home.

- It started with a photo: [[Low tide, early morning]]
- The idea behind it: [[Repetition is a way of paying attention]]
- The title came from something [[You only notice the sea when it leaves|overheard on a train]]

> The drawings are not of the sea. They are of where it was.`, { swatch: ['#d9d4c7', '#2e2d29'] }),
      E('w2', 'work', 'Thread study', '2023-09-02', ['c-line', 'c-fam', 'c-quiet'],
`One red thread across a white room, at hip height. People walked around it as if it were a wall.

The thread came from [[Grandmother’s embroidery drawer]].`, { swatch: ['#ece9e1', '#ff3b1f'] }),
      E('n1', 'note', 'Repetition is a way of paying attention', '2020-01-08', ['c-rep'],
`Not boredom. The tenth time you draw a line you finally **see** it.

## Where this comes from
- [[Agnes Martin]]: grids that feel like breathing
- [[4′33″]]: framing what is already there
- The samples in [[Grandmother’s embroidery drawer]], the same stitch hundreds of times

## Questions
1. When does repetition become a ritual instead of a method?
2. Is there a number of times after which a gesture belongs to you?

- [x] Try one drawing a day for a month
- [ ] Write down what changes each week`, { formative: true }),
      E('n2', 'note', 'What if the archive itself is the work?', '2026-09-30', [],
`Keeping, sorting, connecting. Maybe that is already the practice.

Her drawer was an archive too: [[Grandmother’s embroidery drawer]]. Next step: a piece about [[An archive of gestures]].`),
      E('n3', 'note', 'A crowded museum where I couldn’t see anything', '2022-05-21', ['c-quiet'],
'Too many works shouting at once. Left after twenty minutes, irritated.\n\nI want work that **lowers the volume**.'),
      E('n4', 'note', 'Art school critique: “too decorative”', '2014-03-18', ['c-quiet'],
'Still stings. Probably why I stripped everything back afterwards, and why [[Agnes Martin]] landed the way she did.', { formative: true }),
      E('n5', 'note', 'Sketchbook, spring', '2024-04-12', ['c-line', 'c-rep'], 'First pages where the lines start repeating.', { file: { name: 'sketchbook-spring.pdf', size: 0, data: null } }),
      E('f1', 'find', 'Agnes Martin', '2016-11-20', ['c-rep', 'c-quiet'], 'Grids that feel like breathing. Return to this whenever the work gets loud.', { url: 'https://en.wikipedia.org/wiki/Agnes_Martin', by: 'Agnes Martin', formative: true }),
      E('f2', 'find', 'Seascapes', '2018-06-11', ['c-sea', 'c-rep'], 'Every photograph the same horizon, and still each one a different day.', { url: 'https://en.wikipedia.org/wiki/Hiroshi_Sugimoto', by: 'Hiroshi Sugimoto' }),
      E('f3', 'find', 'Lines: A Brief History', '2021-02-03', ['c-line'], 'Walking, weaving, writing and drawing as the same activity: making a line.', { url: 'https://en.wikipedia.org/wiki/Tim_Ingold', by: 'Tim Ingold' }),
      E('f4', 'find', '4′33″', '2012-04-09', ['c-quiet'], 'Framing what is already there instead of adding something.', { url: 'https://en.wikipedia.org/wiki/4%E2%80%B233%E2%80%B3', by: 'John Cage', formative: true }),
      E('f5', 'find', 'Low tide, early morning', '2019-10-27', ['c-sea'], 'Ridges in the sand that look exactly like the drawings I didn’t know I would make.', { swatch: ['#c9c3b3', '#254fff'] }),
      E('f6', 'find', 'Grandmother’s embroidery drawer', '1998-07-15', ['c-fam', 'c-rep'], 'Hundreds of half-finished samples. Nobody was meant to see them.', { swatch: ['#0b0b0c', '#b8b6ae'], formative: true }),
      E('f7', 'find', 'You only notice the sea when it leaves', '2024-11-02', [], 'Wrote it on my hand.', { by: 'Overheard on a train' }),
    ];
    const L = (a, b, note) => ({ id: uid(), a, b, note });
    const links = [
      L('w1', 'f5', 'The sand ridges were the first drawing. I just copied them for a year.'),
      L('w1', 'f1', 'Permission to repeat without apologising.'),
      L('w1', 'f2', 'Same subject again and again, until it becomes about time.'),
      L('w1', 'n5', 'Where it started on paper.'),
      L('w2', 'f3', 'A line can be a thread, a walk, a wall.'),
      L('w2', 'n3', 'Wanted one quiet gesture in a whole room.'),
      L('f1', 'n4', 'After that critique, she showed me that less could be enough.'),
      L('f1', 'f2', 'Both make the same image over and over.'),
      L('n5', 'f3', ''),
    ];
    return { version: 2, entries, collections, links };
  }

  /* ================= boot ================= */
  (async () => {
    try { const r = await fetch('/api/info', { cache: 'no-store' }); if (r.ok) { const info = await r.json(); if (info.server) SERVER = info; } } catch { /* static: browser storage */ }
    if (SERVER) {
      const foot = $('.side-foot > .label');
      foot.textContent = 'Saved on disk'; foot.title = SERVER.root;
    }
    let data = await store.get('db');
    if (!data) {
      let legacy = null;
      try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY)); } catch { /* none */ }
      data = legacy && Array.isArray(legacy.items) && legacy.items.some(i => !i.example) ? migrate(legacy) : seed();
      db = data; await persist();
    }
    db = migrate(data);
    db.entries.forEach(e => { e.collections ||= []; e.assets ||= {}; });
    if (!location.hash) history.replaceState(null, '', '#/all');
    ui.lastBase = baseHash();
    render();
  })();
})();
