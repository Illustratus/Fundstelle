# Fundstelle — a local-first tool for qualitative content analysis

[![tests](https://github.com/Illustratus/Fundstelle/actions/workflows/tests.yml/badge.svg)](https://github.com/Illustratus/Fundstelle/actions/workflows/tests.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

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
the transcripts they refer to — written so that a change reads as one change:
adding a coding unit adds a coding unit, and writing a memo touches the memo
and the moment it was written, nothing else. Findings, codings, and the paper
you write stay in one provenance chain.

## Quick start

```sh
node server.js          # http://127.0.0.1:4173
```

No login, no build step, no runtime dependencies. Node 18 or newer; the tool
says so and stops rather than failing somewhere in the middle of a file read.
`@playwright/test` is only needed for the test suite.

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

A `coding.<name>.json` beside a `coding.json` is read as a second coder's work
and appears in the intercoder-reliability panel under that name — so
`coding.anna.json` becomes "anna". Several are allowed and are compared one by
one. These files are only ever read.

While a change is being written there is briefly a `.lock` file beside the one
being changed, and a `.tmp` file for the moment the write takes. Both are gone
again immediately; a lock left behind by a process that was killed is broken by
the next change rather than waited on. They are what lets two servers share one
folder — a container and a local start, or a mounted drive — without either
quietly dropping the other's work.

## Features

- **Methodical coding, kept by the server** — exactly one category per place, a
  unit belongs to a single speaker turn, and the interviewer's own words cannot
  be coded at all: they are the instrument, not the material. Dragging snaps a
  selection to word and sentence boundaries so a citation never begins mid-word,
  but snapping is the interface being helpful — the server takes the ranges it is
  given, so a machine pre-coding is not turned away over a boundary.
- **Deductive start system plus inductive categories** — build the start system
  in the interface while nothing is coded yet, or bring your own as a file. Until
  the first coding unit exists a category can be added, renamed, dissolved or
  removed as part of the start system; from that unit onwards the system stands
  and everything new is inductive, because "fixed before the survey" is a
  statement about a moment and the tool can tell which side of it you are on.
  Definitions can be refined on the material, and the wording you started with is
  kept and reported.
- **Anchor examples and coding rules, with the gaps named** — both are recorded
  as they emerge. A category that has citations but no anchor example is named in
  the analysis, and its gap is written into the coding guide rather than left out
  of it: an omission that looks like a decision is the worst kind of gap in an
  appendix.
- **Review workflow** — units created programmatically are marked unreviewed and
  rendered as suggestions until you confirm each one; every export flags them.
  `Enter` walks the pass, and "all reviewed" says which it means — this
  interview, or the study.
- **Anchoring survives transcript edits** — codings hold their position by turn
  number and character range, are silently re-anchored when the text shifts, and
  are handed back when they can't be: a citation that now reads twice, or one
  that would come to rest on a neighbour, is never guessed at. Until it has a
  place again it counts in no figure and appears in no export, and both the
  analysis and the appendix say how many are waiting.
- **Your transcript, not a reformatted one** — drop what the recording produced
  (WebVTT from Teams or Zoom, SRT, Whisper output, a text file whose lines begin
  with a name) on the header; the tool reads it, shows you how it read it, and
  writes the format it codes in. Cues by the same speaker are joined into turns,
  because a cue is shorter than a thought. Which speaker is the interviewer is
  asked, never guessed. The same conversion runs from the command line for a
  batch.
- **Requirements catalog, graphically worked up** — bundle codings across
  interviews into requirements, prioritized MoSCoW-style; how many departments
  name a requirement is counted from the material, never typed in. A MoSCoW band,
  a prioritization field (naming departments × blocked operations) and a coverage
  chart make the prioritization checkable at a glance, and at twenty requirements
  the list cuts down to what is still unfinished.
- **Production-grade analytics** — a stacked bar chart per category and
  department, a category × guide-section heatmap, cross tables, per-interview
  progress, and a saturation curve: how many categories turned up for the first
  time in each interview, and how many were in play by then. It shows and stops —
  whether the curve has flattened far enough is a judgement about the material,
  not one any arithmetic makes. Twenty interviews and a thousand codings draw in
  a quarter of a second.
- **Where the category system rubs** — which two categories keep being used in
  the same speaker turn, ranked by how often the rarer of them is never used
  without the other. That is the one place Mayring asks for a coding rule, and
  nothing else in the tool could say where it was. Reported as the weak signal
  it is: two categories that belong together in the material look exactly like
  two that were never told apart.
- **Figures that survive leaving the tool** — every chart saves as an SVG that
  stands on its own: colours resolved, fonts carried, its key drawn in, nothing
  fetched from anywhere. Every figure on the analysis screen can be quoted as
  Markdown, because a figure that cannot be is a figure that gets retyped. Cross
  tables come out as Pandoc grid tables set to 80 characters, and every export
  is written to be typeset rather than looked at — sorted by where it goes: what
  describes the study for the methods chapter, what quotes the material for the
  appendix.
- **Intercoder reliability, without a second workflow** — the second coder runs
  their own copy on the same transcripts and hands you their `coding.json`; put
  it beside your own as `coding.<name>.json` and the analysis compares them.
  Cohen's κ per category and overall, the raw agreement, the four cell counts it
  came from, and the list of turns the two read differently — which is what a
  consensus round actually works from. The unit is stated wherever the figure is:
  per turn and category, so cutting a passage differently is agreement rather
  than a difference. Their file is only ever read, because a second coding this
  tool could edit would no longer be independent of it.
- **Search that understands inflection** — `*` stands for any characters inside a
  word, never across a space. A word that finds nothing is tried again without
  its inflecting ending, and the search says which term it ran with; the same
  semantics in the transcript search, the citation filter and the note search,
  and the citation export runs the slice the screen ran.
- **Keyboard-first, including the act of coding** — `s` takes up a sentence and
  the arrows walk on from there, across the turn boundary and past the
  interviewer; `⇧↓` takes one sentence more. Number keys assign categories,
  typing filters, `j`/`k` walk the transcript, `/` jumps to search, `Enter`
  drives the review pass. After assigning, the cursor already stands on the next
  sentence. Press `?` for the whole list.
- **Bilingual to the last file** — every export and every error message is
  written in the language you work in, down to the quotation marks. `?lang=de` or
  `?lang=en` on any export URL asks directly; a bare request follows
  `Accept-Language`.
- **Considered design** — an editorial, manuscript-like reading surface with
  light and dark themes, visible focus states and reduced-motion support, held to
  the WCAG contrast thresholds in both themes. Printing gives a document rather
  than a screenshot: the controls drop away, what is folded shut is printed open,
  and a page printed from the dark theme comes out on white paper.
- **Nothing that needs a mouse, nothing that needs sight** — every chart carries
  a summary in numbers and folds open into the figures it draws; the cross table
  names the category and department of each figure, and an empty cell still says
  nought.
- **Quotations come away whole** — a citation copies with its source attached,
  in the same wording the exports use, so a passage quoted from the screen and
  one lifted from the appendix are the same string.
- **It says what is still open where you are standing** — with a hand on the
  export button: suggestions not yet reviewed, categories without an anchor
  example, interviews nobody has coded, and what each of those means for the
  documents about to be written. Silent when there is nothing to say.
- **A history you can read** — codings live in the same folder, and the same git
  history, as the transcripts. Adding a coding unit adds a coding unit; writing a
  memo touches the memo and the moment it was written, and nothing else.

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

Lines of the form `- Key: Value` under the heading are read as what the study
records about that interview — a role, a tenure, a site, the date. They are
shown beside the transcript and become the columns of the sample table the tool
writes for the methods chapter, so a field one interview carries and another
does not is left blank rather than filled in.

`## Section:` opens a guide section, `**2 · Speaker [0:15]**` a turn whose text
follows below it. A turn runs until something else begins — the next turn, a
heading, or a rule across the page — so an answer written in several paragraphs
arrives whole. Turns by any speaker not named `Interviewer` are codable; the
speaker name becomes the department in the analytics. Gaps in the
numbering are allowed — the same number must mean the same place across
revisions. `## Erzählanstoß:` is accepted as an equivalent of `## Section:`, so
German transcripts written for earlier versions keep working.

### Bringing a recording's transcript in

Nobody's transcript arrives in that shape. What comes out of a recording is a
WebVTT from Teams or Zoom, an SRT, a Whisper output, or a text file whose lines
begin with a name — so the tool reads those.

Drop the file on the `＋` in the header, or on the first screen when there are no
interviews yet. It reads the file without writing anything, shows how it was
read and the first turns as they will stand, and asks which of the speakers was
asking. Then it writes the transcript and opens it.

For a batch, the same conversion runs from the command line:

```sh
node tools/import-transcript.mjs recording.vtt
```

Run like that it reads the file, says which speakers are in it and stops without
writing anything — the same discipline the dialog keeps. Which of them is the
interviewer cannot be guessed reliably, and getting it wrong is not cosmetic:
the interviewer's turns cannot be coded at all, so a wrong guess either removes
half the material or offers the questions up as findings. Tell it, and it
writes:

```sh
node tools/import-transcript.mjs recording.vtt \
  --interviewer "Anna Berger" --department Sales \
  --title "Interview 3: Sales" --date "4 August 2026"
```

`--dry` shows what would be written without writing it, `--into` picks the
transcript folder, `--folder` the folder name, `--format` overrides the shape if
the guess is wrong. It never writes over a `final.md` that is already there:
codings hold on to the turn numbers in that file, so an overwrite would move
every citation in the interview.

Subtitle files are cut for reading along, not for reading — Teams emits a cue
every few seconds and a third of them end mid-sentence — so consecutive cues by
the same speaker are joined into one turn and the timestamp kept is the one the
speaker began at. Guide sections are not invented: they belong to the interview
guide, not to the recording, and can be written in afterwards as `## Section:`
lines. Everything except the section bar works without them.

Files arrive in the shape the editor that wrote them left behind: Windows line
endings and a byte order mark are read without complaint. Where the format is
not kept, the tool says so rather than showing a short interview — a line that
looks like a turn but was not read as one is named with its line number and the
form expected, and a turn number used twice is reported, because a coding holds
its place by that number and a number used twice makes every citation on it
ambiguous. The file itself is never corrected; it is yours.

## Your own category system

On first start (no `categories.json` yet) the tool seeds a deductive start
system, which can be edited away in the interface as long as nothing is coded.
Point `START_SYSTEM` at a JSON file to seed your own instead — see
[example-start-system.json](example-start-system.json) for the format:
propositions are optional color groups, missing abbreviations are derived from
the name. A configured but unreadable file fails loudly instead of silently
coding with the wrong system.

Subcategories can be written either way: nested under `children`, or as a flat
list where each one names its `parent`. The second is the shape the tool itself
writes, so a `categories.json` from one study can be handed straight to the next
as its start system. The system stays two levels deep — a third level, a parent
that does not exist, or a category placed under itself abort at startup with a
message naming the category.

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

If the folder is a git repository whose `.gitignore` names the old files to keep
them in the history — a study that versions its codings next to its transcripts
does exactly that — add the new names alongside. Nothing fails without it: the
codings simply stop being versioned from the first change onwards.

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
real data. It also reads the numbers back and compares them with what is stored
— on the screen (status bar, category counts, metrics, cross table, citation
headings, progress) and in the exports (the cross table cell by cell, the
citations per category, each coding table against its own count) — because a
count that quietly drifts is this tool's worst defect: nothing looks wrong, and
the figure walks into the paper. The synthetic transcripts under
`tests/fixtures/` are generated by `npm run fixtures` and committed, because the
suite needs stable anchors.

```sh
npm run test:contrast             # measures the charts in both themes
npm run test:docker               # needs Docker, builds the image
npm run test:minimum              # the tool on Node 18, nothing installed
```

Some of what the suite checks is worth naming, because it is what the feature
list above rests on rather than asserts. Every saved SVG is opened as a document
of its own and each drawn element compared against the page it came from, so a
figure that leaves the tool is the picture that was on the screen. Every export
is run through Pandoc, to HTML and to LaTeX, with warnings counted as failures —
a table that parses is not yet a table that typesets. Every word of the
interface is measured against the surface it really sits on in both themes, and
the charts against the WCAG thresholds. The numbers on the screen are read back
and compared with what is stored, and so are the numbers in the exports. A
change to the codings is measured as a git diff, because a history is only worth
having if a change in it can be read.

`test:minimum` is the one that checks the two claims made about a machine with
nothing on it: that the tool runs on the oldest Node it declares, and that it
needs no runtime dependencies. Playwright itself needs Node 20 or newer, so the
suite cannot say anything about 18 — running it there would test the test runner
and call that a result.

Every push and pull request runs all three on GitHub Actions: the suite on Node
20 and 22, the minimum check on 18, and the Docker image built and started.

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
