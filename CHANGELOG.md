# Changelog

Dates are the day the version was tagged. Versions follow [semantic
versioning](https://semver.org): the file format and the HTTP API are the public
surface, so a change that would make an existing study unreadable is a major
one. Nothing here has needed that yet — every earlier file shape is still read
where it lies.

## Unreleased

### Added

- **A converter for real transcripts.** `node tools/import-transcript.mjs
  recording.vtt` reads WebVTT (Teams, Zoom), SRT, Whisper output and plain
  speaker-labelled text, and writes the format the tool reads. Consecutive cues
  by the same speaker are joined into turns, because a subtitle cue is shorter
  than a thought. Which speaker is the interviewer is asked rather than guessed,
  and an existing `final.md` is never written over.

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
