# Memory Archive: design exploration

A personal archive for everything that has stayed with me: thoughts, notes, images, sources and
my own work. It also works as a tool for finding out what has shaped me as an artist.

This document collects the thinking behind the prototype in this repo (`index.html`). The
prototype is something to react to. It is not a final decision.

---

## 1. The archive has two jobs

| Keeping | Uncovering |
|---|---|
| Fast capture of anything: a thought, a photo, a link, a file | Seeing patterns I wasn't aware of |
| Nothing gets lost | Tracing a piece of my work back to its roots |
| Low friction, so I actually use it | Being surprised by my own past |

Most tools (Notion, Pinterest, Google Drive) only do the first job well. What makes this archive
mine is the second job, and that depends on **connections and reasons** more than on folders.

## 2. Information architecture

### Why the first structure didn't work
The first versions mixed three different questions into one menu: *what format is it* (image,
file), *where does it come from* (source, my work) and *how does it feel* (inspires, informs,
triggers). That made every capture a small exam. The three resonance labels in particular
overlapped too much to be useful: most things inspire *and* inform, and the label said little
once it was given.

### The new structure: four questions, each answered once

| Question | Answer in the archive | How it is set |
|---|---|---|
| **Where does it come from?** | **Kind**: Note (my writing), Find (from outside), Work (made by me) | Chosen when creating, one click |
| **What is it?** | **Format**: image, link, quote, file, text | Detected from what you add |
| **What is it about?** | **Collections**, made by me, an entry can be in several | Added any time, never required |
| **Who is behind it?** | **People**, from the “by” field on finds | Typed, with suggestions |

On top of that there is **one** judgement instead of three: **Formative**. It is a single switch
for the few things that truly shaped me. It is rare on purpose, so the Formative list stays meaningful.

Things that are **not** in a collection yet show up under **Unsorted**. That gives a natural
review moment without a separate inbox.

### Connections
There are two ways entries connect:
- **Connections with a reason**: made from an entry's side panel. The reason (*“after that critique,
  she showed me less could be enough”*) is the most valuable data in the archive.
- **Mentions**: writing `[[Title]]` in any Markdown text links to that entry. This is fast while
  writing, and shown as a dotted line in the graph and lineage. Writing `[[Something new]]`
  creates a link that can be clicked to start that note.

### Menu
The sidebar answers “where am I?” with four groups, from broad to specific:
- **Library**: Everything · Unsorted · Formative · Drift (a random older entry)
- **Kinds**: Works · Notes · Finds
- **Collections**: each one, with counts, and `+` to make a new one
- **People**: the most present names, and the full list

Every list page uses the same two controls in the top bar:
**Display** (List / Grid / Graph) and **Group by** (Year / Kind / Collection / Person / Nothing).
So “all finds, grouped by person, as a grid” or “the collection *The sea*, as a graph” are
combinations, not separate features.

Entries open as their own **page**, with the text on the left and everything *about* the entry on
the right: Formative, collections, connections, “mentioned in” and details. Works get a second
tab, **Lineage**, which follows the connections outward over three generations.

## 3. Principles

1. **One pool, many views.** Every entry lives in one place. Structure comes from how I *look* at
   the pool, not from where I filed it.
2. **The “why” is the most valuable data.** Every connection can carry a reason, and the
   writing itself links entries together.
3. **Record when it entered my life, not when I uploaded it.** The date is labelled per kind:
   *Found*, *Written* or *Made*. A childhood memory captured today belongs in 1998.
4. **My own work is the anchor.** Works get more space in grids, a ring in the graph and a
   Lineage tab.
5. **Few labels, chosen once.** Kind is one click, format is automatic, collections are optional,
   Formative is rare.
6. **Capture is quick, reflection comes later.** Paste or drop anything and it becomes a draft
   find. Unsorted and Drift bring it back for a second look.

## 4. Metaphors to explore

Each metaphor suggests a structure and a look. They can be combined, and the prototype already does.

- **The Studio Wall**: everything pinned up side by side. *In the prototype:* Grid display.
  *Could grow into:* a free canvas where you place and cluster entries by hand.
- **The Constellation**: nothing has a fixed place, clusters appear by themselves. *In the
  prototype:* Graph display, ordered from older to newer. *Watch out:* graphs become a hairball
  without a filter, so it works best on one collection or one kind.
- **The Strata**: layers of time. *In the prototype:* List grouped by Year.
  *Could grow into:* named life chapters (art school, a move) as layers.
- **The Family Tree**: my work has ancestors. *In the prototype:* the Lineage tab on works.
  *Could grow into:* directed connections (“A influenced B”) and a printable lineage sheet per work.
- **The Cabinet of Curiosities**: drawers of small curated groups. *In the prototype:* Collections,
  with a mosaic cover and a written introduction.
- **The Garden**: ideas that sprout, need tending or go dormant. *Could grow into:* states
  (seed → growing → evergreen) on notes.

## 5. Data model

```
Entry
  kind         note | find | work
  title
  body         Markdown, with [[wiki links]] and embedded images
  by           who made it (finds)
  url          link (finds, works)
  image, file  attached media; the format (image, link, quote, file, text) follows from these
  date         when it entered my life: found / written / made
  collections  [collection ids]
  formative    true | false

Collection
  name, description (Markdown)

Connection
  a, b         two entries
  note         WHY they are connected  ← the most important field
```

Mentions are not stored separately. They are read from the `[[links]]` in each body, so they
can't go out of sync. When an entry is renamed, the links pointing to it are updated.

Ideas to consider adding:
- **Direction** on connections (influenced / responded to / contradicts).
- **Places** with a map view: where was I when this struck me?
- **Revisits**: a log of each time I came back to an entry and what I thought then.
- **Ordering inside a collection**, so a collection can be read like an exhibition.

## 6. Rituals (how the archive gets used)

- **Daily capture**: paste a link or drop an image. It takes under 10 seconds.
- **Weekly sort**: empty Unsorted by giving each entry a collection, a reason or a line of writing.
- **Drift**: one random older entry at a time, to look at again.
- **Per work**: when finishing a piece, connect it to what fed it and read its Lineage.
- **Yearly**: list by year, and write a note about what defined that year.

## 7. Questions for me to reflect on

1. Which collections do I already know I have? (Write down five without looking.)
2. What would I mark as formative, and is that list shorter than ten?
3. Do I want to write long notes here, or mostly collect and connect?
4. Is this strictly private, or could collections or lineages become public pages?
5. Where do I capture most: phone, laptop, sketchbook? Scanning analogue material matters for an artist.

## 8. Visual system

The archive borrows the language of daanwalder.com so it feels like part of the same practice:

- **Paper and ink, one signal.** Almost everything is black on warm paper. Signal Blue marks what
  is alive or chosen: the current page, links between entries, the active thread and *Formative*.
- **Type does the work.** Familjen Grotesk for titles and reading; IBM Plex Mono in uppercase for
  labels, dates and counts, and as the writing font in the Markdown editor. No shadows; hairlines
  and ink rules separate things.
- **App shell, editorial pages.** A fixed sidebar for orientation, and large editorial headings
  per page, like the portfolio.
- **Placeholders are generative.** Example images are drawn as line fields rather than fake
  photos, so it is always clear what is real.

## 9. Technical paths forward

The prototype is a static page with no build step and no server. Data is stored in the browser's
IndexedDB, which has much more room than the earlier localStorage. Use **Export** for backups.
Markdown is rendered with [marked](https://github.com/markedjs/marked) and cleaned with
[DOMPurify](https://github.com/cure53/DOMPurify), both included in `vendor/`.

Possible next steps, roughly from small to big:

1. ~~**Store entries as Markdown files** in a folder (readable in Obsidian), so the archive outlives any app.~~ Done: `server.js`.
2. **A small back-end** (e.g. Supabase or PocketBase) for sync, phone access and full-size photos.
3. **Phone capture**: a share-sheet target / PWA so links and photos go in with one tap.
4. **Suggestions**: propose collections and connections, describe images, fetch link titles.
   Always to be confirmed by me.
5. **Publishing**: turn a lineage or collection into a public page.

Existing tools that partly do this, worth trying for comparison: **Are.na** (closest in spirit,
channels of blocks), **Obsidian** (Markdown notes + graph, local files), **Kosmik / Milanote**
(visual canvas), **Tana / Capacities** (typed objects). None of them puts *the lineage of my own
work* at the centre, which is the reason to build something of my own.
