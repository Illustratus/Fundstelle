# Changelog

Dates are the day the version was tagged. Versions follow [semantic
versioning](https://semver.org): the file format and the HTTP API are the public
surface, so a change that would make an existing study unreadable is a major
one. Nothing here has needed that yet — every earlier file shape is still read
where it lies.

## Unreleased

### Added

- **A citation goes onto the clipboard with its source attached.** The citations
  screen is where a results chapter gets written, and the most repeated act
  there is putting a passage into the text — which meant selecting the words by
  hand and reassembling the source from the line above, once per quotation, each
  one a chance to attribute a sentence to the wrong interview. The string is the
  one the exports write, so a quotation taken from the screen and one lifted
  from the appendix are the same string.

## 0.3.0 — 2026-08-05

### Upgrading

Figures can change on first run, and it is worth knowing why. A coding unit
whose passage was edited out of the transcript used to be counted as evidence
everywhere; it no longer is, so a study that holds such units will show smaller
totals than it did under 0.2.0. Both the analysis and the appendix say how many
are waiting to be given a place again, and the coding view can still re-anchor
or discard each one. Nothing is deleted, and no file has to be migrated.


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

### Added

- **The analysis leaves the tool as a document.** The cross table has had its
  own export from the beginning; the saturation curve and the pairs of
  categories that keep meeting were readable only on screen, and both are things
  a methods chapter argues from. A figure that cannot be quoted is a figure that
  gets retyped, and a retyped figure is one that can be wrong. The counts come
  from the same computation the screen draws, so there is no second arithmetic
  to drift.
- **The exports are sorted by where each of them goes.** Eight buttons in a row
  said nothing about which belong in the methods chapter and which in the
  appendix — and the two that describe how the study was done are exactly the
  ones a first-time author would not know to look for.
- **Which categories keep turning up in the same breath.** A category system is
  meant to separate things, and two categories almost never used apart are a
  question about that system — either the material does not make the
  distinction, or the coding rule that should keep them apart has not been
  written. Mayring asks for such a rule exactly where a boundary is unclear, and
  nothing in the tool said where that was. The analysis now ranks the pairs by
  how often the rarer of the two is never used without the other, counted per
  speaker turn, and says plainly that it is a weak signal. A system whose
  categories never meet is told that this is the good result rather than left
  with an absence.
- **The sample table a thesis has to contain, written from the transcripts.**
  A transcript may carry `- Key: Value` lines under its heading and the format
  has parsed them from the beginning — a role, a tenure, a site. Exactly one of
  them was ever used, for the subtitle; the rest was read and dropped, while the
  same description was being typed out by hand for the methods chapter. The
  columns are now whatever the transcripts record, with codable turns and coding
  units counted on the end, and the header is shown beside the transcript rather
  than only parsed.
- **What is still open, said where somebody thinks they are finished.** The
  export block now carries a short list: how many suggestions are still
  unreviewed, which categories have no anchor example, and which interviews have
  not been coded at all — each with what follows from it for the documents about
  to be written. Every one of those signals existed already, in three different
  views; the question they answer is asked once, with a hand on the button that
  writes the appendix. The list is silent when there is nothing to say, and does
  not repeat what is already named at the top of the same page.

### Fixed

- **The end of a review pass says which end it is.** Confirming the last
  suggestion in an interview announced "Every coding unit is reviewed" while the
  study still carried suggestions in another one — the sentence somebody reads
  just before they start writing up. The status bar had said the honest thing
  for a while; the message did not, and a pass is walked with the keyboard, so
  the message is what is in the reader's eye. It now names how many are open
  elsewhere, and says the plain thing only when the study really is done.
- **The interview picker no longer offers a count that has stopped being true.**
  Its "n open" came from the server when the list was loaded and was never
  touched again, so an interview whose sixth and last suggestion had just been
  confirmed went on offering "6 open". The interview on screen is counted from
  what is in hand.
- **A server that is not answering says so in the tool's own words.** This is a
  program people leave open: the laptop sleeps, the terminal running
  `node server.js` gets closed. The next thing anybody did produced "Failed to
  fetch" — the browser's own words, in the browser's own language, in a tool
  that is otherwise bilingual to the last file — and it faded after six seconds.
  It now says that nothing of that step was saved, that what stood in the files
  before stands there unchanged, and where to look; and it stays, because a
  server that is down is a state rather than an event. Nothing is retried
  automatically: a request that never arrived is safe to send again and one that
  timed out on the way back is not, and writing a coding unit twice would be a
  worse failure than the one being recovered from.
- **A change in the codings is one change in the diff.** The tool's reason for
  existing is that the codings live in the same folder — and the same git
  history — as the transcripts, and a history is only worth having if a change
  in it can be read. The fields of a coding unit were written in whatever order
  the object happened to be built in: one order when a unit was created,
  another after it had been read back and migrated. A file therefore held the
  same kind of record in two orders at once, and adding a single unit rewrote
  the lines of a unit nobody had touched — +17/−4 for one coding. There is one
  shape now, settled at the single place every write passes through, so adding
  a unit is +14/−1 and writing one memo touches two lines: the memo and the
  moment it was written.
- **A saved chart is the picture that was on the screen.** The saving copied a
  hand-picked six computed properties onto every element, and a hand-picked list
  falls behind the stylesheet it was written for. It had: `stroke-linejoin` was
  not on it, so the saturation curve was saved with mitred joins where the
  screen drew round ones, and nothing about the file looked wrong. It now copies
  the closed set from the SVG specification, so a rule added tomorrow is carried
  without anyone remembering. Each saved file is opened as a document of its own
  by the suite and every drawn element compared against the same element in the
  page — the check that found this.
- **Every figure in the cross-table export was typeset as code.** Pandoc parses
  the content of a grid-table cell as blocks, with the cell's own left edge as
  column zero — so four or more leading spaces are an indented code block.
  Right-aligning the numbers in the source did exactly that to every one of
  them: the appendix came out with each figure in monospace inside a verbatim
  environment, 24 of them in one table, and Pandoc reported nothing because
  there was nothing to report. The alignment belongs to the colon in the header
  rule, which is what typesets it; the source only has to keep the borders
  straight. Every export is now run through Pandoc as part of the suite — to
  HTML and to LaTeX, with warnings counted as failures — and Pandoc is
  installed in CI so the check never silently skips.
- **A missing anchor example is written into the coding guide, not left out of
  it.** Mayring asks every category for a definition, an anchor example and,
  where a boundary is unclear, a coding rule. A missing definition had always
  been marked in the guide; a missing anchor example produced no field at all,
  so the appendix read as though that category needed none and the first person
  to notice was whoever reviews the submission. The gap is now named, in the
  language the export was asked in, and the analysis says which categories it
  affects beside the export button — where it is far cheaper to close. A
  category nothing has been coded with yet stays silent: there is nothing it
  could have been anchored in.
- **The section bar said "distribution" and showed a coverage.** The percentages
  beside the transcript are how much of what was said in each guide section is
  held in coding units — a share within the block. The note above them said the
  codings were distributed across the sections, so "42 %" read as "42 % of my
  codings are here". On a real screen the five numbers added up to 245, which is
  the giveaway nobody should have to notice. The note now says what they are and
  that they do not add up to a hundred. The word saturation went with it: in
  this method it means that no new categories are arriving, which is what the
  curve above shows, so the bar calls its figure coverage.
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
