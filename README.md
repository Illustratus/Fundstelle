# Fundstelle — a local-first tool for qualitative content analysis

Fundstelle — German for the exact place in a text where evidence is found — is
a coding tool for qualitative interview studies. It runs entirely on your
machine, stores everything as plain files next to your transcripts, and has
**zero runtime dependencies**, because a single Node.js process serves the
whole application. Your data never leaves your disk.

> The tool speaks **German and English**, all the way through: the interface
> follows your browser language and the DE/EN toggle in the header switches it
> permanently — and the Markdown exports and error messages follow the same
> choice, down to the quotation marks. File formats and configuration are
> language-neutral. The code, including its comments, is English throughout.

## Why another QDA tool

Interview transcripts are personal data even after pseudonymization. Web-based
QDA services add a processor you may not be allowed to use — this tool binds to
`127.0.0.1` and keeps codings in the same folder (and the same git history) as
the transcripts they refer to. Findings, codings, and the paper you write stay
in one provenance chain.

## Features

- **Methodical coding, enforced in the workflow** — dragging a selection snaps
  it to word and sentence boundaries, so a citation never begins mid-word. The
  rules of the method are kept by the server rather than by the interface:
  exactly one category per place, a unit belongs to a single speaker turn, and
  the interviewer's own words cannot be coded at all — they are the instrument,
  not the material. Snapping is the interface being helpful; the server takes
  the ranges it is given, so a machine pre-coding is not turned away over a
  boundary.
- **Deductive start system plus inductive categories** — bring your own
  category system (see below), refine definitions on the material (the wording
  you started with is preserved and reported — for categories fixed beforehand
  as well as for ones formed on the material), add coding rules and anchor
  examples as they emerge, merge categories that turn out to be one.
- **Review workflow** — units created programmatically (e.g. from a machine
  pre-coding) are marked unreviewed and rendered as suggestions until you
  confirm each one; every export flags unconfirmed codings. `Enter` walks the
  pass and keeps up with the keyboard, and "all reviewed" says which it means:
  the interview on screen, or the study — the interviews that still hold
  suggestions are marked in the list and are one click away.
- **Anchoring survives transcript edits** — codings hold their position by
  turn number and character range, are silently re-anchored when the text
  shifts, and are loudly reported when they can't be. Only what is unambiguous
  moves: a citation that now reads twice, or one that would come to rest on top
  of a neighbour, is handed over for re-anchoring rather than guessed at.
- **Requirements catalog, graphically worked up** — bundle codings across
  interviews into requirements, prioritized MoSCoW-style; how many departments
  name a requirement is counted from the material, never typed in. A MoSCoW
  band, a prioritization field (naming departments × blocked operations) and a
  coverage chart make the prioritization checkable at a glance. At twenty
  requirements the list runs to several screens, so it cuts down to what is
  still unfinished: without a level, without a citation, or resting on evidence
  nobody has confirmed.
- **Production-grade analytics** — stacked bar chart per category and
  department, a category × guide-section heatmap, cross tables, per-interview
  progress; every chart exports as a standalone SVG with computed colors, and
  the cross table as a Pandoc grid table set to 80 characters. Twenty interviews
  and a thousand codings draw in a quarter of a second; a category holding
  hundreds of citations shows its first few and offers the rest, while its count
  and every export stay the whole number.
- **Search that understands inflection** — `*` stands for any characters inside
  a word, never across a space. A word that finds nothing at all is tried again
  without its inflecting ending, and the search then says which term it actually
  ran with; reinterpreting your input in silence would be worse than no hit.
  Both work the same way in the transcript search, the citation filter and the
  note search, and the citation export runs the slice the screen ran. Which
  endings inflect follows the language you work in — a short list for German and
  one for English, not a stemmer pretending to be complete.
- **Keyboard-first** — number keys assign categories, typing filters, `j`/`k`
  walk the transcript, `/` jumps to search, `Enter` drives the review pass.
- **Bilingual to the last file** — every export and every error message is
  written in the language you work in. The interface sends its choice along, so
  a coding guide exported from the English interface reads as English prose with
  English column headings; `?lang=de` or `?lang=en` on any export URL asks
  directly, and a bare request follows `Accept-Language`.
- **Considered design** — an editorial, manuscript-like reading surface with
  light and dark themes, visible focus states, and reduced-motion support. The
  chart palettes are held to the WCAG contrast thresholds in both themes by a
  test that measures them, not by eye.
- **The analysis reads aloud** — every chart carries a summary in numbers, not
  just a title, so what it shows arrives without seeing it; the cross table
  names the category and the department of each figure, and a cell that stands
  empty still says nought.
- **Nothing that needs a mouse** — every chart folds open into the figures it
  draws, so the numbers behind a hover are one keystroke away; a table wider
  than its frame can be scrolled from the keyboard.

## Quick start

```sh
node server.js          # http://127.0.0.1:4173
```

No login, no build step, no runtime dependencies. `@playwright/test` is only
needed for the test suite.

With no transcripts yet, the first screen names the folder it reads from, shows
the format, and offers to write an example interview into it so there is
something to code straight away. It only does that on a folder that holds no
interviews, and never over a file that is already there; the example folder can
simply be deleted afterwards.

### Docker

```sh
docker compose up       # http://127.0.0.1:4173
```

That pulls [`illustratus/fundstelle`](https://hub.docker.com/r/illustratus/fundstelle)
from Docker Hub; swap `image:` for `build: .` in `docker-compose.yml` to run
your own working copy instead.

All data lives on the `./data` volume; transcripts are expected at
`data/transcripts/<interview>/final.md`. The container publishes the port to
`127.0.0.1` only, so remove that prefix deliberately if you want to expose it.

You do not have to create `./data` first. When Docker creates it, the folder
belongs to root while the tool runs as the unprivileged `node` user — so the
container starts as root just long enough to hand the folder over, then drops to
`node` before the tool itself runs. Give the service a `user:` of its own and it
skips that entirely; the folder is then yours to make writable, and the tool
says at startup and in the interface if it is not.

`docker compose down` stops the tool immediately rather than waiting out the
kill timer, and the image reports a health status once it actually answers.

### Pointing it at a folder you already have

The tool does not insist on its own layout. Mount the folder that already
holds your interviews and tell the tool where things are, as in
[docker-compose.example.yml](docker-compose.example.yml):

```yaml
services:
  fundstelle:
    image: illustratus/fundstelle:latest
    ports:
      - "127.0.0.1:4173:4173"
    volumes:
      - /path/to/your/interviews:/data
    environment:
      TRANSCRIPTS: /data
      CATEGORIES: /data/categories.json
```

Every immediate subfolder that contains a `final.md` counts as an interview,
whatever else lives next to it. The tool only ever adds files, namely
`coding.json` beside each `final.md` and the two JSON files at the configured
location. Nothing that was already there is touched.

While a change is being written there is briefly a `.lock` file beside the one
being changed, and a `.tmp` file for the moment the write takes. Both are gone
again immediately; a lock left behind by a process that was killed is broken by
the next change rather than waited on. They are what lets two servers share one
folder — a container and a local start, or a mounted drive — without either
quietly dropping the other's work.

## Configuration

| Variable | Meaning | Default |
| --- | --- | --- |
| `TRANSCRIPTS` | root folder of the interview directories | `data/transcripts` |
| `CATEGORIES` | path to `categories.json` (its sibling `requirements.json` is derived) | `data/categories.json` |
| `START_SYSTEM` | your own deductive start system, seeded on first start | built-in example |
| `START_LANGUAGE` | `de` or `en`; pins the language the start system is seeded in | whoever opens it first |
| `PORT` | server port | `4173` |
| `HOST` | bind address; `0.0.0.0` only inside a container | `127.0.0.1` |

The German variable names of earlier versions (`TRANSKRIPTE`, `KATEGORIEN`,
`STARTSYSTEM`) still work.

## Transcript format

One folder per interview, containing a `final.md`:

```markdown
# Interview 1: Sales

- Conducted: 4 August 2026

---

## Section: 1 · Filing

**1 · Interviewer [0:05]**

How do you record knowledge?

**2 · Sales [0:15]**

Mostly in notes I never find again.
```

`## Section:` opens a guide section, `**2 · Speaker [0:15]**` a turn whose text
follows below it. A turn runs until something else begins — the next turn, a
heading, or a rule across the page — so an answer written in several paragraphs
arrives whole. Turns by any speaker not named `Interviewer` are codable; the
speaker name becomes the department in the analytics. Gaps in the
numbering are allowed — the same number must mean the same place across
revisions. `## Erzählanstoß:` is accepted as an equivalent of `## Section:`, so
German transcripts written for earlier versions keep working.

Files arrive in the shape the editor that wrote them left behind: Windows line
endings and a byte order mark are read without complaint. Where the format is
not kept, the tool says so rather than showing a short interview — a line that
looks like a turn but was not read as one is named with its line number and the
form expected, and a turn number used twice is reported, because a coding holds
its place by that number and a number used twice makes every citation on it
ambiguous. The file itself is never corrected; it is yours.

## Your own category system

On first start (no `categories.json` yet) the tool seeds a deductive start
system. Point `START_SYSTEM` at a JSON file to seed your own — see
[example-start-system.json](example-start-system.json) for the format:
propositions are optional color groups, `children` nests subcategories, missing
abbreviations are derived from the name. A configured but unreadable file
fails loudly instead of silently coding with the wrong system.

Any text in a start system may be a plain string or an object keyed by
language, which is how the bundled example is written:

```json
{ "id": "routine",
  "name": { "de": "Arbeitsalltag", "en": "Everyday work" },
  "definition": { "de": "Aussagen über …", "en": "Statements about …" } }
```

Seeding resolves one language and writes plain strings, so from the first edit
onwards the categories are yours to rename. Which language that is follows
whoever opens the tool first; `START_LANGUAGE=de` pins it, which is what a
shared or scripted setup wants. A text that exists in only one language is used
as it stands rather than coming out blank — you can always hand the tool a
single-language file.

## Upgrading from an earlier version

Version 0.1 renamed the files and the keys inside them from German to English.
Nothing has to be migrated by hand: `kategoriensystem.json`,
`anforderungen.json` and `kodierung.json` are read where they lie, in their old
shape, and written back as `categories.json`, `requirements.json` and
`coding.json` on the next change. Keep a copy of the folder before the first
run, as you would with any format change.

The data directory moved from `daten/` to `data/` and the transcript folder
from `daten/transkripte/` to `data/transcripts/`. If you used the defaults,
rename the folders — or point `TRANSCRIPTS` and `CATEGORIES` at the old ones.

The coding guide now opens its Pandoc block as `::: {.coding-guide .leitfaden}`
instead of `::: {.leitfaden}`. Both class names are applied, so a LaTeX template
that selects on the old one keeps working; write new templates against
`coding-guide`.

## Tests

```sh
npx playwright install chromium   # once
npx playwright test               # runs against a copy in .sandbox/
```

The suite covers the coding workflow, anchoring, review, catalog, charts,
exports, migration from the old format, and the seeding logic; it never touches
real data. It also reads the exports back and compares them with the analysis —
the cross table cell by cell, the citations per category, each coding table
against its own count — because once a number is in a manuscript nobody
re-derives it. The synthetic transcripts under `tests/fixtures/` are generated by
`npm run fixtures` and committed, because the suite needs stable anchors.

```sh
npm run test:contrast             # measures the charts in both themes
npm run test:docker               # needs Docker, builds the image
```

The contrast run is part of `npx playwright test` as well. It measures the
charts in the running application against the WCAG thresholds — 4.5:1 for
anything read as text, 3:1 for a shape that has to be told apart from its
surface — because a palette is easy to admire and hard to check by eye.

That one checks the two ways the container meets a data folder it did not
create: one it has to take ownership of, and one it may not write to at all.
Both are invisible on macOS, where Docker Desktop papers over ownership, and
both are what a Linux reader meets first.

## License

MIT — see [LICENSE](LICENSE).
