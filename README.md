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

- **Methodical coding, enforced in the workflow** — coding units snap to word
  and sentence boundaries, exactly one category per unit, units never cross a
  speaker turn; the server rejects overlaps, not just the UI.
- **Deductive start system plus inductive categories** — bring your own
  category system (see below), refine definitions on the material (the wording
  you started with is preserved and reported — for categories fixed beforehand
  as well as for ones formed on the material), add coding rules and anchor
  examples as they emerge, merge categories that turn out to be one.
- **Review workflow** — units created programmatically (e.g. from a machine
  pre-coding) are marked unreviewed and rendered as suggestions until you
  confirm each one; every export flags unconfirmed codings.
- **Anchoring survives transcript edits** — codings hold their position by
  turn number and character range, are silently re-anchored when the text
  shifts, and are loudly reported when they can't be.
- **Requirements catalog, graphically worked up** — bundle codings across
  interviews into requirements, prioritized MoSCoW-style; how many departments
  name a requirement is counted from the material, never typed in. A MoSCoW
  band, a prioritization field (naming departments × blocked operations) and a
  coverage chart make the prioritization checkable at a glance.
- **Production-grade analytics** — stacked bar chart per category and
  department, a category × guide-section heatmap, cross tables, per-interview
  progress; every chart exports as a standalone SVG with computed colors, and
  the cross table as a Pandoc grid table set to 80 characters.
- **Search that understands inflection** — `*` wildcards inside words and
  automatic suffix trimming, with the same semantics in transcript search,
  citation filters, and note search.
- **Keyboard-first** — number keys assign categories, typing filters, `j`/`k`
  walk the transcript, `/` jumps to search, `Enter` drives the review pass.
- **Bilingual to the last file** — every export and every error message is
  written in the language you work in. The interface sends its choice along, so
  a coding guide exported from the English interface reads as English prose with
  English column headings; `?lang=de` or `?lang=en` on any export URL asks
  directly, and a bare request follows `Accept-Language`.
- **Considered design** — an editorial, manuscript-like reading surface with
  light and dark themes, visible focus states, and reduced-motion support.

## Quick start

```sh
node server.js          # http://127.0.0.1:4173
```

No login, no build step, no runtime dependencies. `@playwright/test` is only
needed for the test suite.

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

## Configuration

| Variable | Meaning | Default |
| --- | --- | --- |
| `TRANSCRIPTS` | root folder of the interview directories | `data/transcripts` |
| `CATEGORIES` | path to `categories.json` (its sibling `requirements.json` is derived) | `data/categories.json` |
| `START_SYSTEM` | your own deductive start system, seeded on first start | built-in example |
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
follows as its own paragraph. Turns by any speaker not named `Interviewer` are
codable; the speaker name becomes the department in the analytics. Gaps in the
numbering are allowed — the same number must mean the same place across
revisions. `## Erzählanstoß:` is accepted as an equivalent of `## Section:`, so
German transcripts written for earlier versions keep working.

## Your own category system

On first start (no `categories.json` yet) the tool seeds a deductive start
system. Point `START_SYSTEM` at a JSON file to seed your own — see
[example-start-system.json](example-start-system.json) for the format:
propositions are optional color groups, `children` nests subcategories, missing
abbreviations are derived from the name. A configured but unreadable file
fails loudly instead of silently coding with the wrong system.

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

## Tests

```sh
npx playwright install chromium   # once
npx playwright test               # runs against a copy in .sandbox/
```

The suite covers the coding workflow, anchoring, review, catalog, charts,
exports, migration from the old format, and the seeding logic; it never touches
real data. The synthetic transcripts under `tests/fixtures/` are generated by
`npm run fixtures` and committed, because the suite needs stable anchors.

## License

MIT — see [LICENSE](LICENSE).
