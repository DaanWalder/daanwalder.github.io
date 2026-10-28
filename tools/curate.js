#!/usr/bin/env node
/* Apply a curation file to the archive (with the archive server running):

   node tools/curate.js curate.json [--dry]

   curate.json can hold:
   renames  { id: { title, check?, set? } }   new names; the old title is kept as original_title,
                                               check marks a name as a guess for the sorting table
   works    [ { id, title, thread, channels, intro } ]   new Works, fed by the Are.na channels named
   docs     { workId: [entryId, …] }           entries that document a Work rather than feed it

   A backup of the whole archive is written to archief/_archief/backup-voor-curate-<time>.json first. */
'use strict';
const fs = require('fs');
const path = require('path');
const PORT = +process.env.PORT || 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(process.env.ARCHIVE_DIR || path.join(__dirname, '..', 'archief'));
const file = process.argv[2];
const DRY = process.argv.includes('--dry');
if (!file) { console.log('Usage: node tools/curate.js curate.json [--dry]'); process.exit(1); }

(async () => {
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  const db = await (await fetch(`${BASE}/api/db`)).json().catch(() => null);
  if (!db) throw new Error(`The archive server is not running on port ${PORT}.`);
  const byId = new Map(db.entries.map(e => [e.id, e]));
  const now = new Date().toISOString();
  const channelsOf = e => { try { return JSON.parse((e.extra && e.extra.arena_channels) || '[]'); } catch { return []; } };
  const report = [];

  // 1. names
  let renamed = 0, checks = 0;
  for (const [id, r] of Object.entries(plan.renames || {})) {
    const e = byId.get(id); if (!e) continue;
    e.extra = e.extra || {};
    if (r.title && r.title !== e.title) {
      if (!e.extra.original_title) e.extra.original_title = JSON.stringify(e.title);
      e.title = r.title; renamed++;
    }
    if (r.check) { e.extra.needs_name = 'yes'; checks++; }
    if (r.set) Object.assign(e, r.set);
    e.updated = now;
  }
  report.push(`${renamed} entries renamed, ${checks} marked to check in the sorting table`);

  // 2. new Works, fed by channels
  let links = 0;
  for (const w of plan.works || []) {
    const id = 'work-' + w.id;
    if (!byId.has(id)) {
      const members0 = db.entries.filter(e => w.channels.some(c => channelsOf(e).includes(c)));
      const created = members0.map(m => m.created).filter(Boolean).sort()[0] || now;
      const e = { id, kind: 'work', title: w.title, body: w.intro || '', url: '', by: '', image: null, file: null, swatch: null,
        date: created.slice(0, 10), formative: false, collections: w.thread ? ['thread-' + w.thread] : [], assets: {}, created, updated: now,
        extra: w.channels.length ? { arena_channels: JSON.stringify(w.channels) } : {} };
      db.entries.push(e); byId.set(id, e);
    }
    const members = db.entries.filter(e => e.id !== id && w.channels.some(c => channelsOf(e).includes(c)));
    for (const m of members) {
      if (db.links.some(l => (l.a === id && l.b === m.id) || (l.b === id && l.a === m.id))) continue;
      db.links.push({ id: 'lin-' + w.id + '-' + m.id, a: id, b: m.id, note: '' }); links++;
    }
    const work = byId.get(id);
    if (!work.image) { const cover = members.find(m => m.image && m.kind !== 'note'); if (cover) work.image = cover.image; }
    report.push(`Work ${w.title}: ${members.length} entries in its lineage`);
  }

  // 3. documentation belongs to a Work instead of feeding it
  for (const [workId, ids] of Object.entries(plan.docs || {})) {
    const work = byId.get(workId); if (!work) { report.push(`skipped docs for ${workId}: no such Work`); continue; }
    const docs = ids.map(i => byId.get(i)).filter(Boolean);
    for (const d of docs) {
      d.documents = workId; d.updated = now;
      db.links = db.links.filter(l => !((l.a === workId && l.b === d.id) || (l.b === workId && l.a === d.id)));
    }
    const first = docs.find(d => d.image);
    if (first) work.image = first.image;
    report.push(`${work.title}: ${docs.length} documentation entries`);
  }
  report.push(`${links} lineage links added`);
  console.log(report.join('\n'));
  if (DRY) return console.log('(dry run, nothing saved)');

  fs.writeFileSync(path.join(ROOT, '_archief', `backup-voor-curate-${now.slice(0, 16).replace(/[:T]/g, '-')}.json`), JSON.stringify(await (await fetch(`${BASE}/api/db`)).json()));
  const r = await fetch(`${BASE}/api/db`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(db) });
  if (!r.ok) throw new Error(r.status === 409 ? 'The archive changed while this ran. Run it again.' : 'saving failed: ' + r.status);
  console.log('Saved.');
})().catch(err => { console.error('\n  ' + (err.message || err) + '\n'); process.exit(1); });
