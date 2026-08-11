# Changelog

Dates are the day the version was tagged. Versions follow [semantic
versioning](https://semver.org): the file format and the HTTP API are the public
surface, so a change that would make an existing study unreadable is a major
one. Nothing here has needed that yet — every earlier file shape is still read
where it lies.

## 0.9.1 — 2026-08-11

### Fixed

- **A placeholder that fit on one machine and not on the next.** „The
  proposition in one sentence" needed 220 of its 225 pixels in the fonts of the
  machine it was written on and 241 of them in the fonts of the build server, so
  the English interface cut it off mid-word wherever the system fonts run a
  little wider — Linux above all. The wording is shortened to the length the
  German one already had.

  The check that let it through had measured it correctly on both: it asked
  whether the placeholder fits, and five pixels is a fit. It now asks for a
  tenth of the field as spare, which is the spread between the two font stacks
  this has been measured on. Text width is not something a layout may depend on,
  and it is not something a check may measure to the pixel either.

## 0.9.0 — 2026-08-11

### Upgrading

Nothing to do. A study gains a `roles.json` beside its `requirements.json` the
first time the role profiles are opened — empty until profiles are written into
it, and read where it lies from then on. Every route that answered before
answers the same, and every address that was bookmarked still leads somewhere:
the tool had none to bookmark.

### Added

- **Role profiles, and what each one stands on.** A requirement is built in
  the tool; a role profile is not. It is written while reading a department's
  citations — what its work is, what it files, what it retrieves, what it hands
  over, in which shape it wants what it receives — and it stays prose, in a file
  of the study's own (`roles.json`, beside the requirements).

  Prose like that can be wrong in two ways nobody reading it would catch. It can
  cite a turn nobody spoke. And it can be a self-portrait — everything a
  department says about itself, nothing anybody else says about it — while
  reading exactly like a profile carried by four interviews.

  The new view makes both visible. Every locator is resolved against the
  transcripts, so each paraphrase carries its evidence as buttons that land on
  the passage; a locator no transcript has a turn for is marked rather than
  quietly dropped. Two figures say what the prose leaves unsaid: „Wer über wen
  spricht" splits each profile by the interview its evidence comes from — a
  single-colour bar is a self-description, and a department that was never
  interviewed has none of its own colour in it — and „Belege je Säule" counts,
  over all profiles, what the five pillars of a role profile actually rest on.
  A pillar the material says nothing about stands there as open instead of being
  left out, because a pillar left out and a pillar shown to be empty read the
  same and are not the same finding.

  Read-only on purpose: writing a profile means weighing several passages
  against each other and finding one sentence for them, which is reading work
  and belongs where the study is written. `GET /api/roles` answers with the
  join, `GET /api/export/role-profiles.md` writes the section back out — the
  paraphrases verbatim, citation markers and all, so the document and the file
  cannot drift apart.

- **Every view has an address.** The tool held its place only in memory. A
  reload — because a transcript changed on disk, because the browser
  restarted, because anything — landed back in the coding view of whichever
  interview that browser happened to remember, however far one had read into
  the evaluation. The back button led out of the tool rather than to the view
  before it. And a colleague could not be pointed at a screen, because every
  screen had the same address.

  The view now stands in the address, and where a view is about one interview,
  so does the interview: `#/analysis`, `#/catalog`, `#/code/interview-02`. A
  reload lands where it left. Back and forward walk the views, including the
  jump from a citation in the evaluation back into the transcript it was cut
  from — which is the movement one makes constantly while comparing two
  places. A pasted address opens the interview it names rather than the one
  the recipient last had open, and an address naming something that is not
  there falls back and corrects itself rather than quietly opening a different
  interview under the name that was sent.

### Changed

- **The header offers what the view in front of it can use.** The interview
  picker, reading in a transcript and the line naming department and date sat
  above all three views. The catalog and the evaluation read the whole study.
  A picker above a study-wide cross table does not merely do nothing: it reads
  as the scope of the table below it, which is the one misreading that turns a
  correct figure into a wrong sentence in a thesis. The three now appear where
  they are about something; the keys, the interface reference, the language and
  the brightness stay, because those are about the tool and not the material.

  The subtitle also no longer starts with a stray separator when a transcript
  carries no department: the parts are joined, not glued to a dot.

- **One right edge in the evaluation instead of three.** The metric row and the
  figures ran to 78rem, the tables stopped at 64rem, and the prose at 46rem.
  Two of those are a decision — a line of text 78rem wide cannot be read — and
  one was a stray number nobody could have named a reason for, so the cross
  table ended 92 pixels short of the heading printed above it and the legend
  printed below it. Everything carrying data now ends on one line; running text
  keeps its own, visibly narrower measure, which does not read as a block that
  failed to line up.

- **What is beside a thing lines up with it.** Four places in the left and
  right columns where a pair came apart as soon as the longer half wrapped:

  The number of a guide block sat centred against its name, so the number of a
  block whose name ran to two lines floated between them, lining up with
  neither its own name nor the numbers above and below. It sits on the first
  line now.

  The interview's own header sized its two columns per row rather than once for
  the block, so the labels ended at different places and the values began at
  different places — four edges where there should be two — and a value too
  long for its column set its second line adrift under nothing. Labels share a
  column, values share a column, and a value that wraps wraps under itself.

  A disclosure heading in the right-hand column set its second line under the
  plus that says whether it is open, so the marker and the text shared one
  column. The marker hangs outside now.

- **A subcategory no longer looks like a name that was cut off.** In the bar
  chart a subcategory was marked by setting „… " in front of its name — the same
  three dots that column puts *after* a name too long to fit. One glyph, two
  meanings, in one label column: a long subcategory came out as
  „… Zusammenarbeit über Bereic…", indented at one end and truncated at the
  other in the same mark. The honest reading of a leading ellipsis is that
  something was cut off there too, which is what gets reported as an interface
  showing half a word. It is indented instead — from the right, the edge these
  labels are set against — and keeps the quieter ink it always had. The
  appendix table is unchanged: a Markdown cell cannot be indented, and nothing
  is ever cut short there, so the mark is unambiguous where it stands.

  „Nächster unberührter Beitrag" inherited the 1.7-line spacing of the status
  count it stands under, which is right for a running count and turned a
  three-line button label into a 75-pixel slab in a 159-pixel column. It keeps
  its own leading and breaks its lines evenly.

## 0.8.0 — 2026-08-07

### Upgrading

Nothing to do, and nothing that changes what a study says. `requirements.json`
gains an `operations` list on the first start after this — the three the tool
has always used, written down where they can now be changed. `categories.json`
gains the proposition every category without one of its own has always pointed
at, `none`, the next time anything in that file is written; it is read as
present either way. A study written by an earlier version is read where it
lies, as every earlier shape still is.

### Added

- **What the study is made of can be changed, not only what is coded into it.**
  Coding units, categories and requirements could be made, read and unmade from
  the start; changing them was where the tool thinned out, and it thinned out at
  exactly the places one is most likely to be wrong at the beginning.

  **A coding unit can be cut differently.** A citation that begins one sentence
  too early was a delete and a fresh coding — which threw away the note on it,
  the anchor-example mark and every requirement it was evidence for. The move
  itself already existed: a unit that loses its place after a transcript edit is
  handed back and put down again by hand. It was simply never offered for a unit
  that still had a place, although the passage most likely to need cutting again
  is the one just worked on. „Stelle ändern" on the unit, and everything except
  the place stays.

  **Propositions are the author's.** They are what a branch of the category
  system argues and the colour every figure of the study is drawn in — and they
  arrived with the seed, worded for the bundled example, editable only by
  opening `categories.json` in an editor. A study about something else carried
  two claims it never made into its own coding guide and its own appendix. They
  can now be worded, coloured, added and dissolved, and a top-level category is
  put on one where the category is worked on; a subcategory keeps following its
  parent, because the distinction is drawn under the proposition above it. One
  cannot be dissolved: „aus dem Erkenntnisinteresse abgeleitet" is what a
  category falls back to when its heading goes, and something has to be there to
  fall to.

  **So are the operations a requirement blocks.** Ablage, Abruf and Transfer
  were three constants compiled into the tool: one study's vocabulary, handed to
  every other one, on every card, in the export and on the axis of the
  prioritisation field. A fresh catalog is seeded with them and owns them from
  then on. An operation that is dissolved comes off every requirement that named
  it — the field counts blocked operations, and a count including something
  nobody can see is a count nobody can check — and the interface says how many
  that will be before it happens.

  **An interview can say something else about itself.** The transcript format
  has parsed a title and a block of `- Feld: Wert` lines since the first
  version; they carry the department every cross table is cut by and build the
  sample table of the paper, and all of it was readable and none of it writable.
  A department spelled two ways across eighteen folders meant editing the files
  every citation hangs on. „Kopfdaten des Interviews" writes them back, renames
  the folder — the codings live in it and travel along — and deletes the
  interview outright, which is the one place the tool asks first: transcript and
  codings go together and there is no copy anywhere, which is what the version
  history beside them is for. Only the header is rewritten. The turns are handed
  back exactly as they were, so no citation moves.

- **Every saved change says so.** The category panel has confirmed each one
  since it existed; the requirement card and the coding-unit panel saved in
  silence. A field that answers nothing looks exactly like a field that did not
  save, which is very likely why "update is missing" was the impression even
  where it was not.

- **Two new figures in the catalog, and they are one matrix drawn twice.** The
  catalog could say how *many* categories a requirement rests on and never which
  ones, and the number is the less useful half — "touches four categories" does
  not tell anybody what changes if the requirement is met.

  **Which categories a requirement reaches** draws that as a grid of dots rather
  than of cells: a requirement rests on a handful of a study's categories, so
  the honest picture is mostly empty, and a heatmap of mostly-empty boxes reads
  as a wall with something wrong in it. It is meant to be read both ways. Across
  a row: meet this requirement, and these are the categories it speaks to. Down
  a column: this is what people said, and these are the requirements that would
  answer it — and **a column with nothing in it is a category the catalog has
  not turned into anything yet**, which is the finding worth having. The count
  under each column says so as a number, and the name of an unreached category
  is set quietly so the eye finds it.

  **The city plot** is the same matrix in three dimensions: the towers stand on
  a lattice of categories and requirements and rise with the citations in their
  cell. It carries what the flat figure carries, mark for mark — the same cells
  with the same numbers, the same counts at both edges, the same table
  underneath — and pays for the third dimension in the one way that cannot be
  drawn away: a tall tower in front hides what stands behind it, which its
  caption says.

  **Its names are written out, and set on the diagonal.** A name used to be
  laid flat at its own row of the lattice and cut where the row ran out. A row
  of a thirty-degree lattice is half a step tall, which is not enough for one
  line of type at a size worth reading, let alone two — so either the names
  were cut, or the lattice had to be stretched to fit them and stopped looking
  like a view of anything.

  Tilted thirty degrees across the run of its edge, a name has the distance
  between two parallel lines of writing instead, which on this lattice comes to
  a whole step across — twice the room, for nothing. So every name stands at
  its own row, written out, in the largest type it fits in, broken evenly over
  two lines when one will not do. The lattice keeps its thirty degrees and the
  sheet grows downward instead, which costs nothing: a figure is drawn to one
  width and scaled to the column it stands in.

  **On the line of its own row**, and that is the point of the angle rather
  than the angle itself. The line of a row is the one through the middles of its
  cells; it leaves the lattice exactly where the count is set and carries on
  outward at the lattice's own thirty degrees. The count is set a gap out along
  that line and the name a count's width further along it, so a row and its name
  are one straight run and the name is the row, written out.

  Set out *horizontally* from that point instead — which is how it was first
  built — and both walk off the line as they go: a gap of nine units to the side
  is five units off a line that climbs at thirty degrees, and a name a count's
  width beyond that is seventeen. A row is eight units tall. So the count sat
  most of a row above the row it counted, the name two rows above the row it
  named, and every name read as its neighbour's. That the anchor was on the line
  was true and no comfort — what a reader follows is the writing.

  **A tower is one block.** Two of its three faces were wrong from the start.
  A block seen from above and in front shows its roof and the two walls hanging
  from the roof's *near* edges; one wall was hung from a far edge instead —
  from a line behind the block — and, drawn after the roof and downward from
  there, it covered the roof's near half in the paint of a wall. Every tower
  was two shapes with a seam down the middle that meant nothing, and, since the
  wall on the other near edge was never drawn at all, half as wide as the
  footprint it stood on. Both walls now hang where they belong, the roof is
  whole, and the two of them are painted closer to it: at the old strengths one
  wall read as missing rather than as turned away.

  **And every tower stands.** The height was straight proportion, which is
  right until the counts are lopsided — and they are: one cell of a real
  catalog carried 39 citations where most carried one or two, and at a fortieth
  of the height a tower is a plate on the floor. The third dimension, which is
  the whole reason this figure stands beside the flat one, then says nothing
  for all but a handful of cells. Every tower now has a minimum height, with
  the rest of the scale exactly proportional above it, so no difference anybody
  can see is a difference that is not there. Where nothing had to be lifted the
  scale is untouched and the key says the plain thing; where something was, the
  key says so.

  The counts stand against the lattice at both edges, at the cell whose row or
  column they count, rather than out behind the names. And the one requirement
  that answers a category alone is roofed in a colour no scale of the figure
  uses: the mark is on the building it is about, and the two walls under the
  roof still carry the MoSCoW level. The tallest tower is now drawn in
  proportion to the ground it stands on, so a study of thirty categories and
  requirements is a skyline rather than a field of splinters.

  **A dot counts the coding units that cite this requirement and sit in this
  category.** One unit, one category — but a citation can carry several
  requirements and then stands in several rows, which is the thing about the
  figure most easily misread, so the caption says it and the key carries the two
  ends of the size scale drawn at the size they mean.

  **A circled dot is the only requirement carrying that category** — drop it and
  nothing in the catalog answers what people said there any more. That is what
  keeps reach from being read as importance on its own: a requirement touching
  one category can be the single thing holding it.

  **Both axes take an order that already exists elsewhere in the tool.** The
  rows are the catalog's own: grouped by MoSCoW level, and inside a level the
  requirement more departments name first — what `/api/requirements` answers,
  what the cards show, what the export writes. The columns are the interview
  guide's: the deductive system as its author built it, and behind it what the
  material added. What is appended is what stands on its own; a category *under*
  a start category is a distinction inside that branch and stays where the
  branch is. A figure that sorted itself would have put the same requirement in
  one place in the list and another in the picture.

  Both are fetchable like every other figure, at
  `GET /api/figures/requirement-reach.svg` and `/api/figures/catalog-city.svg`.

### Fixed

- **A key that fits on one line is no longer broken onto two.** A saved figure
  lays its own key out by arithmetic, and the estimate it measures with runs
  wide on purpose — which is right for *reserving* room, where too wide is a
  little unused white and too narrow is a word cut in half, and exactly wrong
  for *deciding a wrap*, where too wide breaks a line that had room left. One
  key came to 722 reckoned pixels of a 720-pixel line and went onto two, while
  the same words measure 640: the interface showed them on one line and the
  saved file on two, from the same figure at the same moment. The two estimates
  are now two numbers, and the one that decides whether something fits is held
  to what the font really does.

  And where a key does have to wrap, it no longer breaks a scale in two. The
  entries that are one statement — a label and the ends of the scale it belongs
  to — wrap as one, in the file and in the browser alike.

- **What the save button writes and what the endpoint answers are one file
  again.** They call the same drawing code — that is the whole point of the
  arrangement — but the button handed the layout the browser's real measurement
  of the text and the endpoint an estimate. Only the key is laid out that way,
  and only its wrapping depends on it, so a key near the width of the figure
  wrapped in one file and not in the other, from the same study at the same
  moment. Both estimate now. A few pixels of unused white space in a key is the
  cheapest thing in the tool to give up for a figure that is one figure.

  The heatmap stays the exception, and says so: it is the one figure whose own
  layout depends on how wide its headings really are, so in the browser it
  measures them and grows its foot to fit. Which turned up the second half of
  this — the estimate it falls back to was taken for the safe side and is not: a
  heading of umlauts and wide letters came out four pixels past what it
  reserved, and the browser grew the drawing to catch it while the endpoint cut
  the tail off. The estimate now reserves a margin.

- **A MoSCoW key holds the levels the figure actually draws.** The prioritised
  field listed all five whatever it held, so a catalog in which nothing had been
  postponed still carried „Won't have" in its key — a colour to hunt for that is
  not on the picture, and a quiet suggestion that something had been postponed.
  The band of the distribution has dropped its empty levels from the beginning;
  it is built from counts and could hardly do otherwise. Every figure now says
  the same thing: a key entry for something not drawn is worse than none.

### Changed

- **The heatmap wraps its row labels** instead of cutting them at thirty
  characters. It was the last chart doing that, directly under one that wraps
  the same category names in the same view. The column of labels is now one
  shared piece of drawing, so a fourth chart gets it for free.

## 0.7.0 — 2026-08-05

### Upgrading

Nothing to do. No file changes shape, no setting changes meaning, no route that
answered before answers differently — this release only adds routes and changes
how the figures are drawn. Every study written by 0.1.0 onwards is read where it
lies.

The figures look different: the parts of a bar carry their numbers, the labels
wrap instead of being cut, and both views draw their charts to the width of the
column. An SVG saved from an earlier version is a file on your disk and is not
touched; saving it again gives you the new drawing.

### Added

- **Every figure can be fetched.** All six charts of the analysis and the catalog
  are now files at `GET /api/figures/<name>.svg`, with `?theme=light|dark` and
  `?lang=de|en`. Everything behind them was already available as numbers; the
  picture was not, so a script assembling a report had to drive a browser to get
  one and a figure in a thesis was a screenshot or nothing. `GET /api/figures`
  lists the six with their titles.

  A figure that has nothing to draw yet answers `409` and names the missing
  condition — the address is right, the study has not got there — rather than a
  `404` that sends people looking for a typo, or an empty picture that says
  nothing at all.
- **The interface is described.** `GET /api/openapi.json` is an OpenAPI 3.1
  document covering every route: what it does, why it exists, what goes in, what
  comes back, and which error codes it can name. `GET /api/docs` renders it as a
  reference page in the tool's own hand, with a `curl` line per operation.

  Parts of the document are bound to the code rather than written out — the
  figure names, the themes, the languages, the MoSCoW levels, the version — and
  the suite compares the routes `server.js` answers against the paths the
  document claims, in both directions. A route added without a paragraph fails
  the tests rather than quietly becoming folklore.

### Changed

- **Every part of a stacked bar carries its own number**, as a badge lying on
  the bar. How much of a category came from which department was only readable
  by hovering — and a hover answers one person with a mouse, not a printed
  figure, not the saved SVG, not a screen reader.

  The badge is what makes it work for a part of one against a scale of forty,
  which is four units wide and holds no digit: a badge is a shape of its own, so
  it may be wider than its part while staying shorter than the bar. It lies
  across its neighbour without hiding the bar, and is rimmed in the colour of
  the part it names so that whose number it is stays plain. Where two crowded
  parts cannot both have one, the numbers left over stand after the row total,
  each with a swatch in its colour.

  The bar is taller for it — it carried nothing but its own colour before, so
  the height was free.
- **A row label that is too long wraps instead of being cut**, and the whole
  column of labels steps down a size when the longest of them needs it. Cut at
  thirty characters, two categories whose names begin alike were two rows told
  apart only by hovering — and not at all on paper. The labels are centred
  against the bar they name.
- **The figures take the width of the column again**, in both views, and the
  catalog puts them above its requirements as the analysis does. Held to 720
  units the labels were the same size on a 27-inch screen as on a laptop with
  the rest of the column left white; drawn to the column the same names and
  cells are read at a glance. The cost is that a label inside a figure is larger
  than the prose beside it on a wide screen.

  This reverses the placement 0.6.0 chose and keeps the rule it introduced: a
  figure needing a judgment nobody has made is still not drawn. That rule, not
  the position, is what keeps the catalog from becoming the wall it was — a
  catalog somebody has just started shows one row of counts and its
  requirements. Once every judgment has been made there are three figures above
  the list, and they are meant to be scrolled past.
- **A chart tooltip wraps instead of running off the screen.** It was set not to
  break, which is right for two words and wrong for a saturation point, whose
  tip names every category that first turned up there. With the figures at
  column width, hovering the last cell of a heatmap means hovering a few pixels
  from the right edge — so the part that fell outside was the end of the
  sentence, which is what somebody hovered to read. It is now placed on
  whichever side of the pointer it fits, and never wider than the window.
- **A link to the API reference sits in the header**, opening in a new tab so
  that reading it does not cost the passage that was open.
- The row of controls in the header wraps on a narrow screen. It never did, so
  every control added to it was a few more pixels the page had to scroll
  sideways on a phone.
- **The drawing moved out of the interface.** The geometry lived in `app.js` and
  the colours in `app.css`, so a figure only existed where a browser had already
  laid it out — and the saved file was made by asking that browser what colour
  everything had come out. Both now come from `public/charts.js`, which declares
  its own palette and returns markup, so the page, the save button and the
  endpoint are one drawing rather than three that agree by inspection.

  Nothing about a saved file changes for the reader except that it is now the
  same bytes the endpoint serves. The existing check that opens every saved SVG
  as a document of its own and compares it element by element against the page
  still passes, which is what made the change safe to make.
- The service worker now caches every module the interface imports. Three of
  them had been missing since they were added, which meant the offline shell was
  a page that failed at its first import.

## 0.6.0 — 2026-08-05

### Upgrading

**Node 24 or newer is now required.** It was 18. Node 20 is out of support and 22
is on its way there, and the Docker image ships 24 — so `docker compose up` needs
nothing from you. Running from a checkout on an older Node, the tool says so at
startup instead of failing somewhere later.

Nothing else changes: no file changes shape, no setting changes meaning, and
every study written by 0.1.0 onwards is read where it lies.

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

- **Node 24 is the floor, and the tests run there.** It was 18, the image ran 22
  and the tests ran on 20 and 22 — all out of support or on the way there. The
  floor moves everywhere at once: the startup check, `engines`, the image and the
  suite, which runs on the active LTS.
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

- **Two checks no longer depend on the machine they run on.** The REFI checks
  shelled out to `unzip` to get an outside opinion on the archive, and fell over
  where `unzip` is not installed; they now take `python3` instead where they must,
  which also verifies every entry's checksum. And the import checks set `LANG` to
  ask for German while the tool reads `LC_ALL` first, exactly as a locale is meant
  to be read — so a build machine setting `LC_ALL=C.UTF-8` handed them English.
  They pass `--lang de` now: a check should not inherit the thing it checks.
- **A field no longer depends on how wide a font happens to be.** The box for a
  new requirement took whatever the button beside it left: 227 pixels for a
  placeholder needing 213 in one machine's fonts and 235 in another's. The same
  build read correctly here and was cut off mid-word on the build server. The
  field claims its row now and the button steps below when that is what fitting
  requires.
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
