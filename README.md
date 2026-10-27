# Memory-Archive

A personal archive for thoughts, notes, images, files and online sources: everything that has
stayed with me, and a way to uncover what has shaped me as an artist.

This is an **exploratory prototype**. See [DESIGN.md](DESIGN.md) for the structure, the reasoning
behind it and the open questions.

## Run it on your own computer (recommended)

Double click **Start Memory Archive.command** (macOS), or run `node server.js` in this folder.
The archive opens at http://localhost:4321. Needs [Node.js](https://nodejs.org) 18 or newer, nothing else.

Everything is stored as ordinary files in the `archief/` folder next to the app:

```
archief/
  Notes/<title>.md     your own writing
  Finds/<title>.md     things from outside
  Works/<title>.md     your own pieces
  media/               images, video, pdfs and other files, at full size
  _archief/            collections.json and connections.json
  _prullenbak/         everything you delete or replace is moved here first, never thrown away
```

Each entry is a Markdown file with its details as frontmatter, so the folder can be opened in
Obsidian or any text editor. Notes you add there (in `Notes/`, `Finds/` or `Works/`) show up in
the archive after a reload; collections typed in their frontmatter become collections.

With the server running, the archive can also do more than in the browser:

- **Links are saved, not only bookmarked**: pasting a link fetches its title, description and
  preview image, and keeps a copy of the page in `media/`.
- **Full size media**: photos keep their original (large ones also get a lighter copy for display),
  files of any size are kept, and video, audio and pdf play inside the entry.

Options: `PORT=5000 node server.js` for another port, `ARCHIVE_DIR=/path/to/folder node server.js`
to keep the archive somewhere else. Moving to another machine (a home server, for example) means
copying this folder and running the same command there.

### Moving over from the browser version

Open the old version, click **Export** at the bottom of the sidebar, then **Import** that file in
the local version. Embedded images become files in `media/`.

## Try it without installing

Open `index.html` in a browser, or visit the published page. Data is then kept in that browser only.

## How it's organised

- **Three kinds of entry**, by where something comes from:
  - **Notes**: your own writing, in full Markdown
  - **Finds**: things from outside (images, links, quotes, files), with who made them
  - **Works**: your own pieces
- **Collections** you make yourself (themes, obsessions, project research). An entry can be in several.
  Entries without one appear under **Unsorted**.
- **Formative**: one switch for the few things that truly shaped you.
- **People**: everyone named in the “by” field of a find, with their own page.
- **Connections**: link two entries and write *why*, or mention one in your writing with `[[Title]]`.

Every list can be shown as **List**, **Grid** or **Graph**, and grouped by **Year**, **Kind**,
**Collection** or **Person**. Works have a **Lineage** tab that traces what shaped them.

## Writing

The editor writes Markdown with a live preview (Write / Split / Preview). It supports headings,
lists, checklists, quotes, links, code, tables and images (pasted or dropped images are stored
with the entry). Type `[[` to link another entry; pick a title that doesn't exist yet to create a
link to a new note. Renaming an entry updates the links that point to it.

## Quick capture

- **Upload**: the Upload button (or `U`) adds images and files straight into the archive.
- **Paste anywhere**: a link becomes a **Source**, text becomes a **Thought**, an image becomes an **Image**.
- **Drop** files anywhere on the page.

New entries open in the side view right away, so you can name them, add a line about why they
matter, put them in a collection or mark them as formative. Captures made on a collection page
land in that collection.

## Opening, editing and deleting

- Entries open in a **side view** next to the list (`←` `→` to browse, `Esc` to close). Use
  **Open page** for the full page with Lineage, or **Edit** for the Markdown editor.
- Delete an entry with the `×` on its row or tile, from its side view, page or editor.
  Collections have a `×` in the sidebar and on their card. People can be renamed or removed from
  their page. Connections have a `×` too.
- **Select** in the top bar lets you pick several entries to delete, add to a collection or mark as
  formative at once.
- Every delete asks first and can be undone from the message that follows.

## Keys

`N` new entry (then `N` note, `F` find, `W` work) · `U` upload · `/` search · `1` `2` `3` list / grid / graph ·
`←` `→` previous / next entry · `E` edit · `Esc` close · in the editor `⌘/Ctrl S` save, `⌘/Ctrl B` `I` `K`

## Look and feel

The interface uses the design system of [daanwalder.com](https://daanwalder.com): paper `#f1f0eb`
and ink `#0e0e0e`, Signal Blue `#254fff` as the only accent, Familjen Grotesk and IBM Plex Mono,
hairline rules on a 12 column grid and `[ BRACKETED ]` actions.

## Storage and files

Through `server.js` the archive lives in a folder on disk (see above). Opened directly, data is
stored in this browser (IndexedDB), so each browser and device has its own archive. Use
**Export** in the sidebar for a JSON backup and **Import** to restore it. **Delete everything** empties
the archive (with undo).

- `server.js`: the local server (no dependencies)
- `fonts/`: Familjen Grotesk and IBM Plex Mono (SIL Open Font License)
- `vendor/`: [marked](https://github.com/markedjs/marked) (MIT) for Markdown and
  [DOMPurify](https://github.com/cure53/DOMPurify) (Apache 2.0 / MPL 2.0) to keep rendered HTML safe
