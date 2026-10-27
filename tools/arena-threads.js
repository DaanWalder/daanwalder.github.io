#!/usr/bin/env node
/* One-off restructure after the Are.na import (run with the archive server running):

   1. Projects become Works. Every Are.na channel that was really a project gets a Work entry,
      and everything in that channel is connected to it, so the Work's Lineage shows what fed it.
      The reason on each connection is left empty, for you to fill in.
   2. Channels become threads. The 62 channel collections are replaced by a handful of thread
      collections. The original channel names stay on every entry (arena_channels), so nothing
      is lost and it can be redone differently.

   A full backup of the archive is written to archief/_archief/backup-voor-threads.json first.
   node tools/arena-threads.js            apply
   node tools/arena-threads.js --dry      only report what would change */
'use strict';
const fs = require('fs');
const path = require('path');
const PORT = +process.env.PORT || 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(process.env.ARCHIVE_DIR || path.join(__dirname, '..', 'archief'));
const DRY = process.argv.includes('--dry');

const THREADS = {
  signals: ['Signals & Infrastructure', 'Antennas, noise, frequencies, hacking and the invisible infrastructure of communication. The line from Stoorzenders to the electromagnetic spectrum.'],
  queer: ['Queer Space, Memory & Archive', 'Queer nightlife, spaces, histories and archives, and how memory is kept, lost and rebuilt.'],
  control: ['Control, Identity & the Self', 'Identification, biometrics, access and surveillance, and the technologies through which a self is formed.'],
  synthetic: ['Synthetic Nature', 'Simulated ecologies, biomimicry, pollution and the meeting of the organic and the artificial.'],
  newmedia: ['New Media, Generative Art & AI', 'Generative systems, AI, moving image, installation and the digital spiritual.'],
  public: ['Public Space & Participation', 'Urban space, temporality, bodies and sensors in public, and designing with others.'],
  print: ['Toolbox · Print & Graphic', 'Layout, grids, print, riso, type, identity, diagrams and graphic references.'],
  screen: ['Toolbox · Screen & Space', 'Websites, interfaces, web components, tools, exhibition design and scenography.'],
  press: ['Press & Mentions', 'Articles and mentions of my work.'],
  chances: ['Opportunities', 'Residencies, open calls and other opportunities.'],
  everyday: ['Everyday', 'Recipes, clothing, making and other things outside the practice.'],
  words: ['Words & Etymology', 'Quotes, words and where they come from.'],
  research: ['DAE Research Archive', 'The index of my research portfolio at Design Academy Eindhoven.'],
};
// Are.na channel slug → threads
const CHANNEL_THREADS = {
  'press-articles-mentions': ['press'],
  'exhition-design-construction-modular-presentation': ['screen'],
  'consiousness-ems-spacetime': ['signals'],
  'verborgen-verhalen': ['queer'],
  'web-components-animations': ['screen'],
  'azoth-references-videography': ['screen'],
  'azoth-references-av-tech': ['screen'],
  'azoth-visual-style': ['screen'],
  'digital-spiritual-cyber-spirituality': ['newmedia'],
  'scopium-digital-spiritual-cyber-sanctuary': ['newmedia'],
  'generative-art-digital-ai': ['newmedia'],
  'dist-urbran-ce-soundscapes-noise': ['signals'],
  'sonic-explorations-lksbltvetsm': ['signals'],
  'hacking-micro-controllers-tech': ['signals'],
  'print-riso-silkscreen': ['print'],
  'generative-noise-digital-disturbance': ['signals', 'newmedia'],
  'queer-archives-bszzscauwr0': ['queer'],
  'fine-art-photography-paintings': ['print'],
  'stoorzenders-design-process-scenography': ['signals'],
  'design-publishers-sources': ['print'],
  'studio-project-01-the-design-behind-identification-identity-access-control-surveillance-and-technology': ['control'],
  'studio-project-03-technology-sensors-bodies-and-public-space': ['public'],
  'quotes-words-etymology-semantics': ['words'],
  'essay-drug-the-system-transformative-power-of-psychoactive-substances-within-queer-nightlife': ['queer'],
  'thesis-sources-archiving-the-in-between-queer-spaces-collective-memory-and-urban-futures': ['queer'],
  'thesis-archiving-the-in-between-queer-spaces-collective-memory-and-urban-futures': ['queer'],
  'sources-references-books-pdfs': [],
  'dae-social-design-symposium-around-these-tables': ['control'],
  'technologies-of-the-self-idenity-transformation-understanding': ['control'],
  'research-archive-portfolio': ['research'],
  'websites-portfolios-sites-online-archives': ['screen'],
  'urban-spaces-temporality-public-participation': ['public'],
  'solum-venenum-research-design-process': ['synthetic'],
  'synthetic-organic-drug-waste-polution-simulation': ['synthetic'],
  'synthetic-organic-similulations-cyber-biomimicry': ['synthetic'],
  'print-layout-grid-erlghf0b-e0': ['print'],
  'diagrams-schematics-flows-systems-schemes': ['print'],
  'new-media-art-tech-art-installation-exhibition': ['newmedia'],
  'identification-authentication-biometrics': ['control'],
  'mesh-lb1wiq8cldq': ['print'],
  'morning-mesh': ['print'],
  'balans-bnuqqgrfmqo': ['print'],
  'graphics-digital-content-digital-art-marketing': ['print'],
  'identity-branding-graphics': ['print'],
  'mockups-overlays-textures': ['print'],
  'design-resources-templates-mockups': ['print'],
  'tools-software-ai': ['screen'],
  'digital-interactions-gestures-interfaces': ['screen'],
  'design-courses-tutorials-courses': ['screen'],
  'website-nachtburgemeester-nijmegen': ['screen'],
  'scenography-spatial-design': ['screen'],
  'designers-studios-artists': ['screen'],
  'animations-moving-visuals': ['newmedia'],
  'video-essays-documentary': ['queer'],
  'educational-workshop-makey-makey-ai-art': ['newmedia'],
  'portfolio-nqxgdywn3e8': ['research'],
  'mee-residency': ['queer'],
  'fashion-clothing-makeup': ['everyday'],
  'clothing-fabric-textile-print': ['everyday'],
  'recipes-food-cooking': ['everyday'],
  'construction-diy-extrusion': ['everyday'],
  'residencies-open_calls-opportunities': ['chances'],
};
// Projects: a Work fed by one or more channels
const WORKS = [
  { id: 'stoorzenders', title: 'Stoorzenders', thread: 'signals', channels: ['stoorzenders-design-process-scenography'] },
  { id: 'archiving-the-in-between', title: 'Archiving the In-Between', thread: 'queer', channels: ['thesis-archiving-the-in-between-queer-spaces-collective-memory-and-urban-futures', 'thesis-sources-archiving-the-in-between-queer-spaces-collective-memory-and-urban-futures'], intro: 'Thesis: Queer Spaces, Collective Memory and Urban Futures.' },
  { id: 'solum-venenum', title: 'Solum Venenum', thread: 'synthetic', channels: ['solum-venenum-research-design-process', 'synthetic-organic-drug-waste-polution-simulation'] },
  { id: 'design-behind-identification', title: 'The Design Behind Identification', thread: 'control', channels: ['studio-project-01-the-design-behind-identification-identity-access-control-surveillance-and-technology', 'identification-authentication-biometrics'], intro: 'Studio Project 01: identity, access control, surveillance and technology.' },
  { id: 'sensors-bodies-public-space', title: 'Technology, Sensors, Bodies and Public Space', thread: 'public', channels: ['studio-project-03-technology-sensors-bodies-and-public-space'], intro: 'Studio Project 03.' },
  { id: 'drug-the-system', title: 'Drug the System', thread: 'queer', channels: ['essay-drug-the-system-transformative-power-of-psychoactive-substances-within-queer-nightlife'], intro: 'Essay: the transformative power of psychoactive substances within queer nightlife.' },
  { id: 'around-these-tables', title: 'Around These Tables…', thread: 'control', channels: ['dae-social-design-symposium-around-these-tables', 'technologies-of-the-self-idenity-transformation-understanding'], intro: 'DAE Social Design Symposium.' },
  { id: 'synthetic-memories', title: 'Synthetic Memories', thread: 'queer', channels: ['mee-residency'], intro: 'MEE residency at Erfgoed Gelderland.' },
  { id: 'azoth', title: 'AZOTH', thread: 'screen', channels: ['azoth-references-videography', 'azoth-references-av-tech', 'azoth-visual-style'], intro: 'References for AZOTH: videography, AV tech and visual style.' },
  { id: 'website-nachtburgemeester', title: 'Website Nachtburgemeester Nijmegen', thread: 'screen', channels: ['website-nachtburgemeester-nijmegen'] },
  { id: 'makey-makey-workshop', title: 'Makey Makey & AI Art Workshop', thread: 'newmedia', channels: ['educational-workshop-makey-makey-ai-art'] },
];

(async () => {
  const db = await (await fetch(`${BASE}/api/db`)).json().catch(() => null);
  if (!db) throw new Error(`The archive server is not running on port ${PORT}.`);
  if (db.collections.some(c => String(c.id).startsWith('thread-'))) { console.log('Already restructured, nothing to do.'); return; }
  if (!DRY) fs.writeFileSync(path.join(ROOT, '_archief', 'backup-voor-threads.json'), JSON.stringify(db));

  const slugOf = new Map(db.collections.map(c => [c.id, c.arena]));
  const nameOf = new Map(db.collections.map(c => [c.id, c.name]));
  const chanCol = new Map(db.collections.filter(c => c.arena).map(c => [c.arena, c]));
  const now = new Date().toISOString();
  const threads = Object.entries(THREADS).map(([k, [name, description]]) => ({ id: 'thread-' + k, name, description, created: now }));

  // Thread descriptions list the channels they grew from
  const from = {};
  for (const [slug, ts] of Object.entries(CHANNEL_THREADS)) for (const t of ts) (from[t] ||= []).push(chanCol.get(slug) ? chanCol.get(slug).name : null);
  for (const t of threads) {
    const list = (from[t.id.slice(7)] || []).filter(Boolean);
    if (list.length) t.description += `\n\nGrew from the Are.na channels: ${list.join(', ')}.`;
  }

  // 2. channels → threads, keeping the channel names on each entry
  const unknown = new Set();
  for (const e of db.entries) {
    const slugs = e.collections.map(id => slugOf.get(id)).filter(Boolean);
    const names = e.collections.map(id => nameOf.get(id)).filter(Boolean);
    const keep = e.collections.filter(id => !slugOf.get(id) && !String(id).startsWith('arena-'));
    const ts = new Set();
    for (const s of slugs) { if (!(s in CHANNEL_THREADS)) unknown.add(s); for (const t of CHANNEL_THREADS[s] || []) ts.add('thread-' + t); }
    e.collections = [...new Set([...keep, ...ts])];
    if (names.length) { e.extra = e.extra || {}; e.extra.arena_channels = JSON.stringify(names); }
  }

  // 1. projects → Works with lineage
  const ids = new Set(db.entries.map(e => e.id));
  let links = 0;
  for (const w of WORKS) {
    const cols = w.channels.map(s => chanCol.get(s)).filter(Boolean);
    if (!cols.length) { console.log(`  skipped ${w.title}: channel not found`); continue; }
    const id = 'work-' + w.id;
    const desc = cols.map(c => c.description).filter(Boolean).join('\n\n');
    const created = cols.map(c => c.created).filter(Boolean).sort()[0] || now;
    if (!ids.has(id)) {
      db.entries.push({
        id, kind: 'work', title: w.title, body: [w.intro, desc].filter(Boolean).join('\n\n'), url: '', by: '', image: null, file: null, swatch: null,
        date: created.slice(0, 10), formative: false, collections: ['thread-' + w.thread], assets: {}, created, updated: now,
        extra: { arena: cols.map(c => `https://www.are.na/channel/${c.arena}`)[0], arena_channels: JSON.stringify(cols.map(c => c.name)) },
      });
      ids.add(id);
    }
    const members = db.entries.filter(e => e.id !== id && e.extra && e.extra.arena_channels && cols.some(c => JSON.parse(e.extra.arena_channels).includes(c.name)));
    // A Work borrows the first image of its own channel as its cover
    const work = db.entries.find(e => e.id === id);
    if (!work.image) { const cover = members.find(m => m.image && m.kind !== 'note'); if (cover) work.image = cover.image; }
    for (const m of members) {
      if (db.links.some(l => (l.a === id && l.b === m.id) || (l.b === id && l.a === m.id))) continue;
      db.links.push({ id: 'lin-' + w.id + '-' + m.id, a: id, b: m.id, note: '' });
      links++;
    }
    console.log(`  ${w.title}: ${members.length} entries in its lineage`);
  }
  db.collections = [...db.collections.filter(c => !c.arena && !String(c.id).startsWith('arena-')), ...threads];

  const per = threads.map(t => `${t.name}: ${db.entries.filter(e => e.collections.includes(t.id)).length}`);
  console.log(per.join('\n'));
  console.log(`Unthreaded: ${db.entries.filter(e => !e.collections.length).length} · lineage links added: ${links}`);
  if (unknown.size) console.log('Channels without a thread:', [...unknown].join(', '));
  if (DRY) return console.log('(dry run, nothing saved)');
  const r = await fetch(`${BASE}/api/db`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(db) });
  if (!r.ok) throw new Error('saving failed');
  console.log('Saved. Backup: archief/_archief/backup-voor-threads.json');
})().catch(err => { console.error('\n  ' + (err.message || err) + '\n'); process.exit(1); });
