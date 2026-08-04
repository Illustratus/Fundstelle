# Changelog

Dates are the day the version was tagged. Versions follow [semantic
versioning](https://semver.org): the file format and the HTTP API are the public
surface, so a change that would make an existing study unreadable is a major
one. Nothing here has needed that yet — every earlier file shape is still read
where it lies.

## Unreleased

### Added

- **Read in the transcript your recording produced.** Drop a WebVTT (Teams,
  Zoom), an SRT, a Whisper output or a plain speaker-labelled text on the header
  — or on the first screen when there are no interviews yet — and the tool reads
  it, shows how it read it and the first turns as they will stand, asks which
  speaker was asking, then writes the transcript and opens it. Consecutive cues
  by the same speaker are joined into turns, because a subtitle cue is shorter
  than a thought. The same conversion runs from the command line for a batch:
  `node tools/import-transcript.mjs recording.vtt`. An existing `final.md` is
  never written over — codings hold on to the turn numbers in it.

- **A saturation curve.** Every qualitative study is asked how it knows it had
  enough interviews, and the answer expected is that the material stopped
  producing anything new — a claim about the coding, which sits right there. The
  analysis now draws how many categories turn up for the first time in each
  interview and how many are in play by then. It shows and stops: where a curve
  has flattened far enough is a judgement about the material, and a tool that
  printed "saturated" would be putting words in a supervisor's mouth. It states
  its own caveat too — the order plotted is the order of the folder names, not
  necessarily the order the interviews were conducted in — and it draws nothing
  at all on two interviews, where a flattening curve cannot be shown.
- **The start system can be written in the interface.** Until the first coding
  unit exists, a category can be added to it, renamed, dissolved or removed —
  including the three categories of the bundled example, which a fresh
  installation was otherwise stuck with, since a deductive category cannot be
  removed. From the first coding onwards the system stands and everything new is
  inductive. The panel says which of the two acts it is doing.

### Fixed

- **The intercoder comparison drops a unit with no place, on both sides.** The
  same hole as below, one layer over: the comparison rests on "did this coder
  use this category in this turn", and a unit whose passage was edited away
  answers that about a place that is gone. The second coder's file is now
  anchor-checked against the same transcript before comparing — read, never
  written — because dropping only the first coder's unit would turn a passage
  nobody can point to into a disagreement between two people who never
  disagreed.
- **A coding unit that lost its place no longer counts as evidence.** When a
  transcript is edited so a coded passage can no longer be found unambiguously,
  the tool hands the unit over for re-anchoring rather than guessing — and then
  went on counting it: it stood in the cross table, appeared among the citations
  and was quoted in the coding table, which meant the appendix quoted a sentence
  the transcript no longer contained. That is precisely the failure the whole
  anchoring machinery exists to prevent. Such units are now left out of every
  figure and every export, and the analysis and the appendix say how many were
  left out; nothing disappears silently, and they can still be anchored again in
  the coding view.
- **The prioritization field no longer puts a requirement at the wrong
  coordinate.** Both its axes count whole things, so requirements sharing a
  point are the normal case; they were fanned sideways by a constant fifteen
  pixels. Dots of radius ten overlapped by a third of their width, and a pile of
  ten reached 67.5 pixels from its gridline — with eight departments the
  gridlines stand 65 apart, so a requirement named by three departments was
  drawn nearer the line for four. A pile is now packed into rows inside its own
  cell, and the cell grows rather than the dots being drawn on top of each
  other.

## 0.2.0 — 2026-08-04

### Added

- **Intercoder reliability.** Put a second coder's `coding.json` beside your own
  as `coding.<name>.json` and the analysis compares them: Cohen's κ overall and
  per category, the raw agreement, the four cell counts it was computed from,
  and the turns the two read differently — which is what a consensus round works
  from. The unit is stated wherever the figure is (per turn and category), so
  cutting a passage differently counts as agreement rather than as a difference.
  The second coder's file is only ever read, never written. Exports as Markdown
  for the methods chapter.
- **Coding from the keyboard, including the act of coding itself.** `s` takes up
  a sentence, the arrows walk on across the turn boundary and past the
  interviewer, `⇧↓` takes one sentence more. After assigning, the cursor already
  stands on the next sentence. Before this, choosing a passage needed a mouse —
  the one thing the tool exists for was out of reach without one.
- **The shortcuts are written down inside the tool.** `?` opens the full list in
  the language of the interface.
- **Printing gives a document rather than the application.** Controls drop away,
  disclosures print open, and a page printed from the dark theme comes out on
  white paper with its heatmap reading the right way round.
- **Saved charts carry their own key.** An SVG saved from a chart now includes
  the legend, so the file stands on its own in a manuscript.
- **An example interview on the first screen.** With no transcripts yet, the
  tool offers to write one into the folder it reads from.

### Fixed

- **A start system of your own keeps its hierarchy.** A flat `categories.json`
  declaring `parent` — the shape the tool itself writes, and the obvious thing
  to carry from one study into the next — had its sub-categories silently
  promoted to top level. Both shapes now work, and a parent that does not exist,
  a third level, or a category under itself abort with a message naming the
  category rather than being quietly repaired.
- **Every word of the interface meets the contrast threshold.** The quiet grey
  used for field labels, counts and hints stood at 2.91:1 on paper — below the
  4.5:1 the standard asks of text — in three dozen places. A test now walks each
  view in both themes and measures every label against the surface it sits on.
- **The German environment variable names work in the container again.** The
  image set `TRANSCRIPTS` and `CATEGORIES` for itself, which beat anything the
  caller passed: a compose file naming `TRANSKRIPTE` read an empty folder and
  showed a study without a single interview, and nothing failed.
- **Sentence boundaries survive abbreviations.** „z. B.", „am 1. Januar" and
  „ca." no longer end a sentence in either language.
- The tool says which Node version it needs and stops, instead of failing later
  with a message about a missing function.

## 0.1.0 — 2026-07

The first public shape: bilingual throughout, coding with anchoring that
survives transcript edits, a review pass, requirements catalog, the analytics,
the Markdown exports, and the Docker image.
