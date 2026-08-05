# Changelog

Dates are the day the version was tagged. Versions follow [semantic
versioning](https://semver.org): the file format and the HTTP API are the public
surface, so a change that would make an existing study unreadable is a major
one. Nothing here has needed that yet — every earlier file shape is still read
where it lies.

## Unreleased

### Added

- **A second coding can be handed over as one file.** Intercoder reliability has
  worked from the beginning, and getting the other person's work onto this
  machine was one copy per interview folder with an exact name: eighteen careful
  copies for a study of eighteen, and a name typed wrong is not an error but
  silence — the comparison just reports that they did not do that interview. The
  second coder exports their coding as one file now, and this side reads it in
  and puts `coding.NAME.json` where the comparison has always looked. Nothing
  about the format or the read-only rule changes, and an interview this study
  does not hold is named rather than written somewhere it does not belong.
- **A category system can come in from another program.** The REFI-QDA export
  had no counterpart, so the category panel now reads a `.qdc` or a `.qdpx` from
  MAXQDA, ATLAS.ti, NVivo or QualCoder: names, definitions and what sits under
  what. Anything nested deeper than this tool's two levels hangs on the top of
  its own branch rather than being dropped, entities written by another program
  arrive as letters, and a code already here is skipped and said to be skipped.
  The material stays where it is — another program's plain text is not this
  format's turns and guide prompts, and inventing speakers to hang their
  character offsets on would produce a transcript nobody said.

### Changed

- **A search that finds nothing says where the word does turn up.** The search
  covers what people said, which is right — a guide prompt is the question, not
  the answer — but the method makes prompts and category names share their
  vocabulary with the material. Searching a study whose first guide prompt is
  called "Ablage" for the word Ablage gave "kein Treffer" while the word stood on
  the screen three times. It now names the prompt or the category it is, and
  stays quiet when the word really is nowhere.
- **The catalog opens on the requirements, not on figures about them.** It is a
  whole view that only exists once somebody has built requirements, which is why
  it had never been looked at with anything in it. Built out, it opened on three
  figures and put the first requirement card at 1438px on a 1000px screen — so
  the answer to "I have just made six requirements, where are they" was: below
  three figures about work you have not done. Two of the three need a judgment
  made on the single requirement, and drawn without one they were not empty but
  misleading: six requirements with no level came out as a single grey bar
  labelled 6. Those two now wait for the first judgment and say what would fill
  them; the counts stay at the top, and the figures sit under the list they are
  about.
- **A whole study is walked end to end by the tests.** Every part had its own
  checks and the first five minutes had been walked once; the rest never had. The
  new walk starts on an empty folder and runs a recording in, codes it from the
  keyboard, lets an inductive category emerge, takes a second coder's work in,
  opens the analysis, downloads every document it offers, exports the project,
  and then corrects the transcript underneath it all — checking the things that
  have to agree *between* those steps rather than within them.
- **The example study says why its third interview skips a guide prompt.** It
  covers prompts 1 and 3, which is what happens when a prompt comes up on its
  own — but with nothing saying so it read as a gap in the bundled example.

## 0.5.0 — 2026-08-05

### Upgrading

Nothing to do, and one thing worth knowing. Anything that changes a study is now
accepted only from this tool's own page — a browser tab on some other website
could previously write into it. Requests that no browser sent are unaffected, so
`curl`, your own scripts and the container health check work as before. If you
drive the tool from a page you wrote yourself on a different address, that page
now needs to be served from the same origin.

### Added

- **The whole study exports as REFI-QDA (`.qdpx`).** The claim has been that
  the work is not locked in here because everything is plain files — which is
  half an answer while the other half is "and to continue in MAXQDA you retype
  it". The analysis screen now offers the study in the interchange format that
  MAXQDA, ATLAS.ti, NVivo, QualCoder and Quirkos read: the category system with
  its definitions, its hierarchy, its coding rules and its colours; every
  transcript as text with its speakers, times and guide sections; and every
  coding as a character range on that text. A unit that has lost its place is
  left out, as everywhere else. Written without a dependency — the zip is a few
  dozen lines and `zlib` is in the standard library — and the same study
  exported twice is the same file, so two exports can be diffed.
- **The tool says which version it is.** It was nowhere: not in the interface,
  not on an endpoint, and in the image only as an OCI label. Somebody filing an
  issue against a public tool had to guess. `GET /api/version` answers it, the
  foot of the key sheet behind <kbd>?</kbd> shows it beside the Node version and
  the licence, and the image — which ships no `package.json` — carries the same
  string in its environment, so the label and the running tool cannot disagree.

### Fixed

- **The search field keeps its width in both languages.** The key legend beside
  it is longer in English than in German, and the field yielded to it: the same
  input was 344px in one language and 228px in the other, which cut its own
  placeholder off mid-word. The control keeps its room now and the legend wraps.
- **A page on another site can no longer change your study.** Binding to
  127.0.0.1 keeps the tool off the network and does nothing about the browser
  already on the machine — that address is exactly the one a hostile page would
  use. It could never read an answer, but a POST with `text/plain` or a form
  encoding is sent without asking permission first, and all three shapes went
  straight through: coding units appeared in an interview, a category appeared in
  the system, and an inductive category could have been dissolved into another.
  What the browser says about where a request came from now decides it —
  `Sec-Fetch-Site`, or `Origin` where that is missing. Neither present means no
  browser sent it, so `curl`, a script and the container health check are
  unaffected, and reading is left alone.
- **An interview name from a URL can no longer decide where the files are.**
  `/api/interviews/<id>` joins that name onto the transcript folder to build
  every path for that interview, and a URL can say `..%2f..%2fetc`: reading
  resolved two levels above the root, a longer chain walked further up, and the
  write path was the same join. The read was always of a file called `final.md`
  and the tool binds to 127.0.0.1, which makes it smaller than it looks and no
  smaller than it is. Static files were already guarded; this was the other door.
  The rule is kept where the paths are built — the transcript loader and the
  store — so no route can forget it, and again at the boundary, so a crafted name
  now gets a 404 that reads as a sentence.
- **No answer carries a path from the machine the tool runs on.** An unknown
  interview came back as a 500 whose message was the absolute path it had tried
  to open. Named cases still read as sentences; anything unforeseen now says that
  it happened and where to look, and the detail goes to the terminal.

### Changed

- **The figures are drawn at the size they were drawn for.** The charts are
  authored 720 units wide with 10–11.5px type, against a page whose body text is
  14px — and the stylesheet stretched them to the full column, 1.64× on a wide
  screen, so labels came out at 18.9px and bars at 23px. Nothing was functionally
  wrong, which is why nothing caught it: the figures simply read as a louder
  document than the one they sit in, and a study of twenty units filled a screen
  with three-unit bars. Each figure is now a block of its own at its own size,
  with its Save-as-SVG button over the chart it saves. Narrower columns still
  scale them down.

## 0.4.0 — 2026-08-05

### Upgrading

Nothing to do. No file changes shape, no setting changes meaning, and every
study written by 0.1.0 onwards is read where it lies. If you seed your own
deductive system with `START_SYSTEM`, a file the tool cannot read now stops it
with an explanation instead of a half-drawn screen — the same files that worked
before still work.

### Added

- **A citation goes onto the clipboard with its source attached.** The citations
  screen is where a results chapter gets written, and the most repeated act
  there is putting a passage into the text — which meant selecting the words by
  hand and reassembling the source from the line above, once per quotation, each
  one a chance to attribute a sentence to the wrong interview. The string is the
  one the exports write, so a quotation taken from the screen and one lifted
  from the appendix are the same string.

- **A start system the tool cannot read now says so, and says what to do.**
  Pointing `START_SYSTEM` at a file with a stray comma is the likeliest first-run
  failure once anybody brings a category system of their own — which is the whole
  point of it being configurable. It used to draw the whole application around
  nothing (an empty picker, a search over no transcript, a button offering to
  create a category in a system that could not be read) with the reason in a
  message that faded after six seconds. Now it takes the screen, it stays, it
  quotes the parser verbatim, and it names the variable and the example file.
- **Merging two categories can be taken back.** It is the largest thing one
  click does here — a category dissolved, every unit it held re-hung, its rules
  and note pulled across, everything under it re-parented — and it was the only
  move with no way back, while deleting a single unit had one. The message that
  reports the merge now offers "Rückgängig", and what comes back is the system
  that stood there: same identifier, same place in the order, both sides' rules
  and notes, the subcategories where they hung, and exactly the units that moved.
- **The analysis screen holds up at the size of a real study.** Built out to
  eighteen interviews, eight departments, twenty categories and 324 coded units,
  the numbers and the charts held; the page did not. The citation list drew 240
  cards — 30,808 pixels, five sixths of the screen — and put the notes below all
  of it. Categories now fold: they open from the top until a budget of citations
  is on the page, and a folded heading still carries its true count. 4,338 pixels
  instead of 30,808. On paper everything opens again, past the per-category cap
  as well, because a document cannot be clicked.
- **Each coding table in the appendix names its interview.** With three
  interviews from marketing the row read "Kodiertabelle Marketing" three times:
  three links to three different documents with nothing to tell them apart.
- **The example is a study, not one interview.** Somebody trying the tool wrote
  the example, coded four passages, opened the analysis and saw a bar chart of a
  single department: no cross table worth the name, no saturation curve — it
  needs three interviews — and nothing for the categories to meet in, which is
  most of what the tool is worth choosing for. It writes three interviews from
  three departments now, which say overlapping things in different words. None
  of it is coded for you.
- **The first screen leads with what to do.** It opened with a folder path,
  fourteen lines of Markdown and a paragraph about asterisks and middle dots,
  and put the buttons under all of it — a lesson about a format the tool will
  write for you, standing between you and the thing that does it. The action
  comes first now; the format is one click away, for whoever writes files by
  hand.
- **Nothing on that screen is a control over nothing.** A dropdown with no
  interviews in it, a search over a transcript that is not there, and a column
  explaining percentages per guide section: furniture around nothing teaches the
  reader that parts of the screen mean nothing, which is a poor first lesson.
- **The screen a transcript lands on says how to code.** Every key was in the
  sheet behind `?`, which is no use to somebody who does not yet know there is a
  sheet, and the mouse gesture was written nowhere at all — so the one act the
  screen exists for was undiscoverable. It is said once, above the transcript,
  and goes as soon as anything is coded.
- **A transcript without guide sections says why.** Sections belong to the
  interview guide rather than to the recording, so a file that was read in never
  carries any. The column beside the transcript explained percentages per
  section for a study that had none and reported "0 blocks" as though something
  were missing.

### Changed

- **Dissolving one requirement into another is folded away.** It stood open on
  every card in the catalog — a select, a button and a label, two lines apiece —
  between the title and the evidence, so at twenty requirements it was forty
  lines of a control nobody reaches for except when two requirements turn out to
  be one. It is a disclosure now, and it sits after what the requirement is
  rather than in the middle of it: an action reads as an action there.

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
