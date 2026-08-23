/**
 * The figures, drawn once — for the screen, for the saved file, and for the API.
 *
 * A chart used to exist only as a side effect of the interface: the geometry
 * lived in `app.js`, the colours lived in `app.css`, and a file could only be
 * produced by a browser that had already laid the picture out and could be
 * asked what colour everything had come out. That made the figures the one part
 * of the study nobody could fetch. Every number behind them was available over
 * the API — `/api/analysis`, `/api/requirements` — but the picture was not, so
 * a script that assembles a report had to run a browser to get one.
 *
 * So the drawing moved here, where it is plain arithmetic over the same data
 * the API already serves: no document, no stylesheet, no measuring. Each
 * builder returns a *specification* rather than markup for one destination —
 * the body of the picture, its size, its key, its caption and the figures
 * behind it. The interface wraps that in the HTML it needs and lets the page
 * stylesheet paint it; `standalone()` wraps the very same body in a file that
 * carries its own colours and can be opened anywhere.
 *
 * Two rules hold this together:
 *
 * The body is identical in both worlds. It is painted through class names, and
 * the class names are the ones the page stylesheet already uses — so the file
 * and the page cannot drift apart in geometry, only in paint.
 *
 * The paint is declared, not scraped. `THEMES` below carries the same values as
 * the custom properties in `app.css`, and `tests/svg-export.spec.js` reads both
 * and fails if they differ. A palette in two places is only safe when something
 * checks; this is the check.
 *
 * What a browser can still do better is measure text. The foot an angled
 * heading needs, and where a key wraps, depend on the width of real glyphs in
 * real fonts — so both take a `measure` function, and the estimate used when
 * there is none deliberately runs wide. Reserving a few pixels too many is
 * invisible; reserving too few cuts a word in half.
 */

import { layoutBucket } from "./scatter.js";

/** Every chart is authored at this width; heights follow from the content. */
export const WIDTH = 720;

/**
 * The colours, per theme, as the page stylesheet has them.
 *
 * Literal values rather than custom properties: `var(--series-1)` in a file
 * that has left the application resolves to nothing at all, which is how a
 * saved chart comes out black. Nothing in a standalone figure may point at a
 * stylesheet that is not there.
 */
export const THEMES = {
  light: {
    sheet: "#ffffff",
    ink: "#16191a",
    inkSoft: "#5c6466",
    inkFaint: "#6b7274",
    line: "#dcdfda",
    lineStrong: "#c3c8c1",
    accent: "#1f4f4a",
    series: ["#2a78d6", "#ea632d", "#19a06f", "#bd8000", "#e35f91", "#008300", "#4a3aa7", "#e34948"],
    level: ["#dcebe7", "#b0d4cb", "#7bb5a8", "#407f72", "#1f4f4a"],
    moscow: {
      must: "#1f4f4a",
      should: "#45897b",
      could: "#a3c6bd",
      wont: "#9aa3a5",
      open: "#c3c8c1",
    },
    // One paint for every mark that carries a level: the level is a shape now.
    moscowMark: "#1f4f4a",
  },
  dark: {
    sheet: "#1a1e20",
    ink: "#e3e8e5",
    inkSoft: "#98a1a3",
    inkFaint: "#7d8689",
    line: "#2a3033",
    lineStrong: "#3b4348",
    accent: "#7fd0c2",
    series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
    level: ["#17332f", "#1e4a43", "#2c6a5f", "#499384", "#79c4b4"],
    moscow: {
      must: "#79c4b4",
      should: "#459181",
      could: "#2c6a5f",
      wont: "#6b7477",
      open: "#3b4348",
    },
    moscowMark: "#79c4b4",
  },
};

export const THEME_NAMES = Object.keys(THEMES);

/* The same stacks the page uses. They travel into the file, because a figure
   set in whatever the viewer's default happens to be is a different figure. */
export const FONTS = {
  sans: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
};

const MOSCOW_ORDER = ["must", "should", "could", "wont"];

export const moscowClass = (level) =>
  `moscow-${MOSCOW_ORDER.includes(level) ? level : "open"}`;

/* The level as a shape rather than as a colour.
   Four shades of one hue are four things nobody can tell apart at the size a
   dot is drawn: across a field of them „Should have" and „Could have" are the
   same green, and a reader who has to go back to the key for every dot is
   reading a key, not a figure. So the level is a form here, and the form
   counts — a level has as many edges as it has steps: „Must have" four, „Should
   have" three, „Could have" two, „Won't have" one. A square, a triangle, an
   ellipse, a circle. Every mark takes the same paint; only what carries no
   level yet keeps its own pale one, because that is the absence of a decision
   and not a fifth level. */
const MOSCOW_EDGES = { must: 4, should: 3, could: 2, wont: 1, open: 1 };

/** How many edges this level is drawn with; anything undecided counts as one. */
const edgesOf = (level) => MOSCOW_EDGES[MOSCOW_ORDER.includes(level) ? level : "open"];

/* The shapes, sized against the circle they replace. A form is read by how much
   ink it puts on the page, so the four are drawn to roughly one area — the
   triangle a little under, because a point aimed upwards carries further than
   its area says. */
const TRIANGLE = 1.4;
/* Wide and flat rather than a circle with a dent in it: at the size a mark is
   drawn, an ellipse of nearly equal axes is a circle, and two levels that look
   the same are the thing this whole change is about. */
const ELLIPSE_WIDE = 1.5;
const ELLIPSE_TALL = 0.62;
const SQUARE = 0.95;

/**
 * How far a mark of this size reaches from its middle.
 *
 * The furthest any of the four shapes stands out — the ellipse at its rim, the
 * triangle at its apex — and one figure for all of them, because a layout that
 * gave each shape its own room would space a row of marks by which levels
 * happened to be in it. Every layout is done with this rather than with the
 * radius: the packing of a pile, the margin that has to hold the last gridline,
 * the ring drawn around a mark. Two marks that would not overlap as circles do
 * not overlap as shapes either.
 */
export const markReach = (r) => r * Math.max(TRIANGLE, ELLIPSE_WIDE);

/**
 * One mark, in the shape its MoSCoW level has.
 *
 * Whatever the shape, the mark carries where it sits and how much room it takes
 * as data attributes: a reader — the tooltip, a test, anything measuring the
 * picture — can ask a mark for its place without first having to work out which
 * of four elements it turned out to be.
 */
export function moscowMark(level, { cx, cy, r, className = "", attrs = "" }) {
  const n = (value) => Number(value.toFixed(2));
  /* Two sizes, and they are different questions. `data-r` is the size scale the
     figure is drawing to — what the key of a size means and what a reader
     compares — and `data-reach` is how far the shape actually stands out from
     its middle, which is what a layout has to keep clear. */
  const common =
    `class="${className} ${moscowClass(level)}" data-cx="${n(cx)}" data-cy="${n(cy)}"` +
    ` data-r="${n(r)}" data-reach="${n(markReach(r))}"${attrs ? ` ${attrs}` : ""}`;
  const edges = edgesOf(level);
  if (edges === 4) {
    const s = r * SQUARE;
    return (
      `<rect ${common} x="${n(cx - s)}" y="${n(cy - s)}" width="${n(s * 2)}"` +
      ` height="${n(s * 2)}" rx="1"></rect>`
    );
  }
  if (edges === 3) {
    const R = r * TRIANGLE;
    const points = [
      [cx, cy - R],
      [cx + R * 0.866, cy + R * 0.5],
      [cx - R * 0.866, cy + R * 0.5],
    ]
      .map(([px, py]) => `${n(px)},${n(py)}`)
      .join(" ");
    return `<polygon ${common} points="${points}"></polygon>`;
  }
  if (edges === 2) {
    return (
      `<ellipse ${common} cx="${n(cx)}" cy="${n(cy)}" rx="${n(r * ELLIPSE_WIDE)}"` +
      ` ry="${n(r * ELLIPSE_TALL)}"></ellipse>`
    );
  }
  return `<circle ${common} cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"></circle>`;
}

export function escape(text) {
  return String(text).replace(
    /[&<>"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  );
}

/**
 * A column of row labels: one type size for all of them, each wrapped to fit.
 *
 * Shared, because three charts have a column of names down their left side and
 * a name is what a category or a requirement *is*. Cut at thirty characters,
 * two names that begin alike are two rows told apart only by hovering — and not
 * at all on paper.
 *
 * The largest size at which every name fits in `wanted` lines, tried in order.
 * All of them together and not each on its own: labels of a chart are a column,
 * and a column set in four sizes is not read as a column. So the longest name
 * decides and the rest are set to match, which is also why a chart whose names
 * are all short still gets the size it was drawn for.
 *
 * `wanted` and not `max`, because the size and the height are one decision seen
 * twice: a long name kept at full size takes three lines, and three lines make
 * every row of the chart taller, including the ones whose name is one word. A
 * step smaller costs a little legibility in the label and buys back the shape
 * of the whole figure. `max` is the floor under that, at the smallest size,
 * before anything is given up to an ellipsis.
 */
export function labelColumn(names, { room, sizes = [11.5, 10.5, 9.5, 8.5, 7.5], wanted = 2, max = 3 } = {}) {
  // One room for the column, or one per label where the rows are not all set
  // against the same edge — a subcategory is indented and has that much less to
  // fit its name into, and the size that fits every name has to know it.
  const roomOf = (index) => (typeof room === "function" ? room(index) : room);
  let size = sizes.at(-1);
  let labels = names.map((name, index) =>
    wrapLabel(name, { room: roomOf(index), size, maxLines: max }),
  );
  for (const candidate of sizes) {
    const tried = names.map((name, index) =>
      wrapLabel(name, { room: roomOf(index), size: candidate, maxLines: wanted }),
    );
    if (!tried.some((one) => one.truncated)) {
      size = candidate;
      labels = tried;
      break;
    }
  }
  const line = Math.round(size * 1.2 * 10) / 10;
  return { size, line, labels, tallest: Math.max(1, ...labels.map((one) => one.lines.length)) };
}

/**
 * That column drawn: the lines of one label, centred on what they name.
 *
 * Centred rather than sitting on a baseline — one line looks the same either
 * way, and three lines hung from a baseline have the name climbing away from
 * the row it belongs to.
 */
export function labelText(label, { x, middle, size, line, className = "row-label" }) {
  const first = middle - ((label.lines.length - 1) * line) / 2 + size * 0.35;
  return (
    `<text class="${className}" x="${x}" y="${first}" text-anchor="end"` +
    ` style="font-size:${size}px">` +
    label.lines
      .map((one, k) => `<tspan x="${x}"${k ? ` dy="${line}"` : ""}>${escape(one)}</tspan>`)
      .join("") +
    `</text>`
  );
}

/* Geometry helpers --------------------------------------------------------- */

const SERIES_COUNT = 8;

/**
 * Map departments onto the eight series colors. From the ninth department on,
 * the rest collapses into „others": a ninth color could no longer be told apart
 * from the first eight reliably.
 */
export function seriesFrom(departments, t) {
  if (departments.length <= SERIES_COUNT) {
    return departments.map((name, index) => ({
      name,
      className: `series-s${index + 1}`,
      sources: [name],
    }));
  }
  const series = departments.slice(0, SERIES_COUNT - 1).map((name, index) => ({
    name,
    className: `series-s${index + 1}`,
    sources: [name],
  }));
  series.push({
    name: t("seriesMore"),
    className: `series-s${SERIES_COUNT}`,
    sources: departments.slice(SERIES_COUNT - 1),
  });
  return series;
}

/** A round axis step (1, 2, 5, 10, …) that leads to at most five ticks. */
export function axisStep(max) {
  if (max <= 5) return 1;
  const raw = max / 5;
  const decade = 10 ** Math.floor(Math.log10(raw));
  for (const factor of [1, 2, 5, 10]) if (raw <= factor * decade) return factor * decade;
  return 10 * decade;
}

/** Rectangle path; the right end is rounded when `round` is set. */
function segmentPath(x, y, width, height, round) {
  const r = round ? Math.min(3, width / 2) : 0;
  return (
    `M ${x} ${y} h ${width - r} ` +
    (r
      ? `a ${r} ${r} 0 0 1 ${r} ${r} v ${height - 2 * r} a ${r} ${r} 0 0 1 ${-r} ${r} `
      : `v ${height} `) +
    `h ${-(width - r)} z`
  );
}

export function shorten(text, limit = 30) {
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text;
}

/**
 * A label broken over as many lines as it needs, inside the room it has.
 *
 * The row labels of a bar chart used to be cut at thirty characters with an
 * ellipsis, which is fine for "Zusammenarbeit über Bereic…" until the row below
 * it is "Zusammenarbeit über Bereic…" as well — two categories the analysis is
 * about, told apart on screen only by hovering. A name is what a category *is*;
 * a figure that will not print it is a figure somebody has to annotate by hand.
 *
 * Greedy wrapping on estimated widths rather than measured ones, for the same
 * reason everything here estimates: the browser and the endpoint have to lay
 * the same figure out, and only one of them can ask a font anything. The
 * estimate runs wide, so a line breaks a word early rather than late.
 *
 * Returns the lines and whether anything had to be given up, which is what lets
 * the caller try a smaller size before it settles for an ellipsis.
 */
export function wrapLabel(text, { room, size, maxLines = 3 }) {
  /* Nothing always fits. Without that, a caller who works out a room from a
     layout and gets a negative one — which a crowded figure can — sends this
     into a loop that breaks a word into empty pieces for ever, and the failure
     surfaces as an out-of-memory in a chart rather than as a squeezed label.
     The caller should not hand over a negative room; this is what happens when
     it does anyway. */
  const fits = (one) => !one || estimateWidth(one, { size }) <= room;
  const perLine = Math.max(4, Math.floor(room / (size * 0.58)));
  const lines = [];
  let line = "";

  for (const word of String(text).trim().split(/\s+/)) {
    let rest = word;
    // A word wider than the column is broken rather than left hanging over it.
    while (!fits(rest)) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(rest.slice(0, perLine));
      rest = rest.slice(perLine);
    }
    if (!rest) continue;
    const together = line ? `${line} ${rest}` : rest;
    if (fits(together)) {
      line = together;
    } else {
      lines.push(line);
      line = rest;
    }
  }
  if (line) lines.push(line);
  if (!lines.length) return { lines: [""], truncated: false };
  if (lines.length <= maxLines) return { lines, truncated: false };

  // More than it may have: the last line it can keep says so with an ellipsis.
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = shorten(kept[maxLines - 1], Math.max(2, perLine - 1));
  if (!kept[maxLines - 1].endsWith("…")) kept[maxLines - 1] += "…";
  return { lines: kept, truncated: true };
}

/**
 * How wide a piece of text is, when nobody can be asked.
 *
 * A deliberate over-estimate. Every use of this reserves room — the foot below
 * an angled heading, the point at which a key wraps to the next line — and the
 * two directions of being wrong are not symmetrical: a few pixels too many are
 * invisible, a few too few cut a word off. The factors are the widest the
 * stacks in `FONTS` get for ordinary prose, not their average.
 */
export function estimateWidth(text, { size = 10, mono = false, tight = false } = {}) {
  return String(text).length * size * (mono ? 0.62 : tight ? TIGHT : 0.58);
}

/**
 * The other estimate, for deciding whether something fits rather than how much
 * room to keep for it.
 *
 * The two fail in opposite directions and were the same number, which is the
 * mistake. Reserving space, too wide is a little unused white and too narrow is
 * a word cut in half — so the reserve runs wide. Deciding a wrap, too wide is
 * the damage: a key that fits on one line is broken onto two because the
 * arithmetic thinks it is fuller than it is. The key of the reach figure came
 * out at 722 reckoned pixels of a 720-pixel line and wrapped, while the same
 * words measure 640.
 *
 * Measured across the wordings that actually appear in a key — German and
 * English, at ten pixels, in the font stack the figures carry — the widest ran
 * at .562 of the size per character and most at half. This sits just above the
 * widest of them: still an over-estimate, and no longer one by a fifth.
 */
const TIGHT = 0.57;

/** As much of a name as fits in the room it has, the ellipsis counted in. */
export function shortenToWidth(text, room, { size = 10 } = {}) {
  const name = String(text);
  if (estimateWidth(name, { size }) <= room) return name;
  const fits = Math.floor(room / (size * 0.58)) - 1;
  return fits < 2 ? "…" : shorten(name, fits);
}

/**
 * The categories of a figure's axis, in the order the written work has them.
 *
 * Which is: the deductive system in the order of the interview guide, and
 * behind it what the material added. Both come out of the file as the author
 * built it — the start system is written in guide order, and the tool only ever
 * adds to the end — with one exception this puts right: a category that came
 * from the material and was then subordinated to a start category is spliced
 * directly behind its parent in `categories.json`, because that is where a
 * two-level system wants it.
 *
 * What is appended is therefore what stands on its own. A category *under* a
 * start category is a distinction inside that branch and belongs where the
 * branch is — moving it to the end would separate it from the thing it
 * subdivides, which says something about the system that is not true. One that
 * stands on its own is a heading the start system does not have, and putting it
 * among them says the study went in with it.
 *
 * Its own subcategories travel with it: they are judged by the branch they sit
 * in, not by themselves.
 *
 * Only for the flat axes — the two catalog figures. Where categories are drawn
 * with their parents, the file order is the right order and stays.
 */
export function categoryAxis(categories) {
  const idOf = (one) => one.category ?? one.id;
  const byId = new Map(categories.map((one) => [idOf(one), one]));
  const branch = (one) => (one.parent ? (byId.get(one.parent) ?? one) : one);
  const added = (one) => (branch(one).origin === "inductive" ? 1 : 0);
  return [...categories].sort((a, b) => added(a) - added(b));
}

/**
 * The MoSCoW key, holding the levels the figure actually draws and no others.
 *
 * A key entry for something not drawn is worse than none: it sends the reader
 * hunting for a shape that is not there and, in a catalog where nothing has
 * been postponed, quietly suggests that something has. The band of the
 * distribution has dropped its empty levels from the beginning — it is built
 * from counts, so it could hardly do otherwise — while the three figures that
 * draw one mark per requirement listed all five whatever they held.
 *
 * The entries carry the level itself, not only a class: the key of these three
 * figures shows the shape a level is drawn in, and a swatch cannot be worked
 * out from a colour name.
 */
export function moscowKey(rows, t, nameOf) {
  const level = (row) => (MOSCOW_ORDER.includes(row.moscow) ? row.moscow : "open");
  const present = new Set(rows.map(level));
  return [...MOSCOW_ORDER, "open"]
    .filter((id) => present.has(id))
    .map((id) => ({
      paint: moscowClass(id),
      shape: "level",
      level: id,
      label: id === "open" ? t("open") : nameOf(id),
    }));
}

/** The largest row, named — the one thing a reader takes from a bar chart. */
function largestRow(rows) {
  return rows.reduce((best, row) => (row.sum > (best?.sum ?? -1) ? row : best), null);
}

/* The charts --------------------------------------------------------------- */

/**
 * A horizontal stacked bar chart: one row per entry, segments per department.
 *
 * Shared by the analysis (categories) and the catalog (requirements), because
 * both answer the same question — how much of this comes from where — and a
 * second visual idiom for the same question would only cost the reader.
 */
export function stackedBars({
  id,
  file,
  title,
  caption,
  rows,
  departments,
  summaryKey,
  figuresCaption,
  figuresRef,
  t,
}) {
  if (!rows.length || !departments.length) return null;
  const series = seriesFrom(departments, t);

  const values = rows.map((row) =>
    series.map((one) =>
      one.sources.reduce((n, name) => n + (row.values[departments.indexOf(name)] ?? 0), 0),
    ),
  );

  const max = Math.max(1, ...rows.map((row) => row.sum));
  const step = axisStep(max);
  const end = Math.ceil(max / step) * step;

  const LABEL = 200;
  /* Taller than it was. The bar carried nothing but its own colour at 14 units
     and the row was already 26, so the height was free — and it buys the room
     the badge below needs to sit *on* the bar with the colour still showing
     above and below it. */
  const BAR = 20;
  const TOP = 6;

  /**
   * A number on a bar, as a badge.
   *
   * Set straight onto the colour it was hard to read: black on the blue of the
   * first series clears the threshold by a hair and looks it. On its own small
   * ground it is ordinary reading colour on ordinary paper, and the eye stops
   * having to work at all.
   *
   * The badge also answers the part that is too narrow for its number. It is a
   * shape of its own, so it may be *wider* than the part it belongs to and
   * still be shorter than the bar — it lies across its neighbour without
   * hiding the bar, and stays centred on the part it names. Which is the whole
   * trick: a part of one against a scale of forty is four units wide, and no
   * arrangement of type fits a digit into four units.
   */
  const DIGIT = 6.2;
  const numberWidth = (value) => String(value).length * DIGIT;
  const BADGE_PAD = 5;
  const BADGE_HEIGHT = 13;
  const BADGE_GAP = 2;
  const badgeWidth = (value) => numberWidth(value) + 2 * BADGE_PAD;

  /**
   * What is left when even the badges will not fit.
   *
   * A badge may overflow its part but not the bar, and two narrow parts beside
   * each other cannot both have one. Those numbers go after the row's total, as
   * a swatch in the part's colour and the number beside it — the same pairing
   * as the key above the chart, which is where a reader has already learnt
   * which colour is which department.
   *
   * The swatch carries the colour and the number does not. Written in the
   * series colour it would be the colour doing two jobs: the palette is built
   * to stand 3:1 off the page, which is the threshold for a shape, and text
   * needs 4.5 — five of the eight do not reach it. A square and a number in the
   * ordinary reading colour is the same information without that argument.
   */
  const SWATCH = 6;
  const AFTER_TOTAL = 8;
  const ENTRY_GAP = 7;
  const entryWidth = (value) => SWATCH + 3 + numberWidth(value) + ENTRY_GAP;
  /* A row of eight crowded parts would take a quarter of the chart for its
     tail. Past this it stops, and the cross table underneath carries the rest —
     which the caption already sends the reader to. */
  const TAIL_LIMIT = 150;

  /**
   * Where every number of one row goes: on the bar, or after it.
   *
   * Left to right, each badge centred on its part and pushed right only as far
   * as the badge before it makes necessary — so the order on the bar is the
   * order of the parts, always. A badge that would then reach past the end of
   * the bar is not drawn there; its number joins the tail instead. A badge
   * wider than the whole bar never happens on the bar at all: a row of one is
   * a row whose total already stands beside it.
   */
  function layoutRow(line, room) {
    const scale = (value) => (value / end) * room;
    const sum = line.reduce((n, value) => n + value, 0);
    const barEnd = LABEL + scale(sum);
    const parts = line.filter(Boolean).length;
    let last = -1;
    line.forEach((value, k) => {
      if (value > 0) last = k;
    });

    const badges = [];
    const tail = [];
    let x = LABEL;
    let cursor = LABEL;
    line.forEach((value, k) => {
      if (!value) return;
      /* A row made of one part has already said its number: the total beside
         the bar is that part. A badge would be the same figure twice. */
      if (parts < 2) return;
      const full = scale(value);
      const width = Math.max(1, full - (k === last ? 0 : 2));
      const badge = badgeWidth(value);
      const centre = x + width / 2;
      x += full;

      // Wider than the whole bar: it cannot lie on it at all.
      if (badge > barEnd - LABEL) {
        tail.push({ value, at: k });
        return;
      }
      const left = Math.max(cursor, Math.min(centre - badge / 2, barEnd - badge));
      if (left + badge > barEnd + 0.5) {
        tail.push({ value, at: k });
        return;
      }
      badges.push({ left, width: badge, value, at: k });
      cursor = left + badge + BADGE_GAP;
    });
    return { badges, tail, barEnd, scale, sum };
  }

  /**
   * How wide the right-hand gutter has to be, which depends on the scale, which
   * depends on the gutter. Settled by running it twice, as the prioritisation
   * field settles its own margin: a narrower track can only crowd more parts
   * out of the bar, so the second answer is the stable one.
   */
  const BASE = 34;
  function tailFor(gutter) {
    const room = WIDTH - LABEL - gutter - 8;
    let widest = 0;
    for (const line of values) {
      const need = layoutRow(line, room).tail.reduce(
        (n, one) => n + entryWidth(one.value),
        0,
      );
      widest = Math.max(widest, Math.min(need, TAIL_LIMIT));
    }
    return widest ? widest + AFTER_TOTAL : 0;
  }
  const VALUE = BASE + Math.max(tailFor(BASE), tailFor(BASE + tailFor(BASE)));

  const track = WIDTH - LABEL - VALUE - 8;
  const scale = (value) => (value / end) * track;

  /* A subcategory used to be marked by setting „… " in front of its name — the
     same three dots this very column puts *after* a name it had to cut short.
     One glyph, two meanings, in one label column: a long subcategory came out
     as „… Zusammenarbeit über Bereic…", indented at one end and truncated at
     the other in the same mark, and the honest reading of the leading one is
     that something was cut off there too.

     It is indented instead — from the right, because that is the edge these
     labels are set against — and it keeps the quieter ink it always had. */
  const CHILD_INDENT = 10;
  const roomFor = (index) => LABEL - 12 - (rows[index].child ? CHILD_INDENT : 0);
  const names = rows.map((row) => row.name);
  const { size, line: LINE, labels, tallest } = labelColumn(names, { room: roomFor });
  // The row grows to hold the tallest label; a bar is still a bar, centred in it.
  const ROW = Math.max(26, Math.ceil(tallest * LINE) + 10);
  const height = TOP + rows.length * ROW + 22;

  let grid = "";
  for (let tick = 0; tick <= end; tick += step) {
    const x = LABEL + scale(tick);
    if (tick > 0) {
      grid += `<line class="grid" x1="${x}" y1="${TOP}" x2="${x}" y2="${height - 20}"></line>`;
    }
    grid += `<text class="axis" x="${x}" y="${height - 7}" text-anchor="middle">${tick}</text>`;
  }

  const bars = rows
    .map((row, index) => {
      const y = TOP + index * ROW + (ROW - BAR) / 2;
      const { badges, tail, barEnd } = layoutRow(values[index], track);
      let x = LABEL;
      let last = -1;
      values[index].forEach((value, k) => {
        if (value > 0) last = k;
      });

      const segments = values[index]
        .map((value, k) => {
          if (!value) return "";
          const full = scale(value);
          // 2px of air between the segments; the last one ends rounded.
          const width = Math.max(1, full - (k === last ? 0 : 2));
          x += full;
          return (
            `<path class="segment ${series[k].className}" d="${segmentPath(x - full, y, width, BAR, k === last)}"` +
            ` data-department="${escape(series[k].name)}" data-row="${escape(row.name)}"` +
            ` data-value="${value}" data-tip="${escape(`${row.name} — ${series[k].name}: ${value}`)}"></path>`
          );
        })
        .join("");

      /* The badges after every part, not each one after its own: a badge that
         overflows a narrow part lies across the part beside it, and drawn in
         turn it would end up under the colour it was supposed to sit on. */
      const written = badges
        .map(
          (badge) =>
            `<rect class="bar-badge ${series[badge.at].className}" x="${badge.left}"` +
            ` y="${y + (BAR - BADGE_HEIGHT) / 2}"` +
            ` width="${badge.width}" height="${BADGE_HEIGHT}" rx="3.5"` +
            ` data-department="${escape(series[badge.at].name)}" data-row="${escape(row.name)}"` +
            ` data-value="${badge.value}"` +
            ` data-tip="${escape(`${row.name} — ${series[badge.at].name}: ${badge.value}`)}"></rect>` +
            `<text class="bar-value" x="${badge.left + badge.width / 2}"` +
            ` y="${y + BAR / 2 + 3.5}" text-anchor="middle">${badge.value}</text>`,
        )
        .join("");

      const label = labelText(labels[index], {
        x: LABEL - 8 - (row.child ? CHILD_INDENT : 0),
        middle: y + BAR / 2,
        size,
        line: LINE,
        className: `row-label${row.child ? " child" : ""}`,
      });

      const baseline = y + BAR / 2 + 3.5;
      let after = barEnd + 6 + numberWidth(row.sum) + AFTER_TOTAL;
      let tailed = "";
      for (const one of tail) {
        if (after + entryWidth(one.value) - ENTRY_GAP > WIDTH - 4) break;
        tailed +=
          `<rect class="part-swatch ${series[one.at].className}" x="${after}"` +
          ` y="${baseline - SWATCH + 0.5}" width="${SWATCH}" height="${SWATCH}" rx="1.5"` +
          ` data-department="${escape(series[one.at].name)}" data-row="${escape(row.name)}"` +
          ` data-value="${one.value}"` +
          ` data-tip="${escape(`${row.name} — ${series[one.at].name}: ${one.value}`)}"></rect>` +
          `<text class="value" x="${after + SWATCH + 3}" y="${baseline}">${one.value}</text>`;
        after += entryWidth(one.value);
      }

      return (
        label +
        segments +
        written +
        `<text class="value${row.sum ? "" : " empty"}" x="${barEnd + 6}" y="${baseline}">${row.sum}</text>` +
        tailed
      );
    })
    .join("");

  const largest = largestRow(rows);

  return {
    id,
    file,
    title,
    caption,
    width: WIDTH,
    height,
    body:
      `<line class="baseline" x1="${LABEL}" y1="${TOP}" x2="${LABEL}" y2="${height - 20}"></line>` +
      grid +
      bars,
    legend:
      series.length > 1
        ? { kind: "series", entries: series.map((one) => ({ paint: one.className, label: one.name })) }
        : null,
    summary: t(summaryKey ?? "summaryBars", {
      rows: rows.length,
      total: rows.reduce((n, row) => n + row.sum, 0),
      departments: departments.length,
      top: largest?.name ?? "—",
      topValue: largest?.sum ?? 0,
    }),
    figuresRef,
    // A chart either carries its own figures or names the table that already
    // holds them; the category chart is followed by the cross table anyway.
    figures: figuresCaption
      ? {
          caption: figuresCaption,
          columns: [title, ...departments, t("total")],
          rows: rows.map((row) => [row.name, ...row.values, row.sum]),
        }
      : null,
  };
}

/** Coding units per category, split by department. */
export function categoryChart(data, t) {
  return stackedBars({
    id: "chart",
    file: "coding-units-per-category.svg",
    figuresRef: "matrix-table",
    title: t("chartTitle"),
    caption: t("chartCaption"),
    departments: data.departments,
    rows: data.rows.map((row) => ({
      name: row.name,
      child: Boolean(row.parent),
      values: row.values,
      sum: row.sum,
    })),
    t,
  });
}

/**
 * Where the material stopped producing anything new.
 *
 * Every qualitative study is asked how it knows it had enough interviews, and
 * the answer expected is that the categories stopped arriving. That is a claim
 * about the coding, and the coding is right here — so it is drawn rather than
 * asserted: how many categories turn up for the first time in each interview,
 * and how many are in play by then.
 *
 * It stops at showing. Where a curve has flattened far enough is a judgement
 * about the material, and no arithmetic makes it — a tool that printed
 * "saturated" would be putting words in a supervisor's mouth.
 */
export function saturationChart(data, t) {
  const points = data.saturation ?? [];
  /* Two interviews cannot show a curve flattening, and a chart that suggests
     one on two points invites a claim the material does not carry. */
  if (points.length < 3 || !points.some((one) => one.total)) return null;

  const LEFT = 42;
  const RIGHT = 16;
  const TOP = 12;
  const PLOT = 150;
  const LABELS = 30;
  const height = TOP + PLOT + LABELS;

  const end = Math.max(1, Math.ceil(Math.max(...points.map((one) => one.total))));
  const step = axisStep(end);
  // One step of headroom, always: the last point carries a "+2" above it, and a
  // curve drawn against the ceiling reads as clipped even when it is not.
  const top = Math.ceil(end / step) * step + (Math.ceil(end / step) * step === end ? step : 0);
  const track = WIDTH - LEFT - RIGHT;
  const gap = points.length > 1 ? track / (points.length - 1) : 0;
  const x = (index) => LEFT + index * gap;
  const y = (value) => TOP + PLOT - (value / top) * PLOT;

  let grid = "";
  for (let tick = 0; tick <= top; tick += step) {
    grid +=
      `<line class="grid" x1="${LEFT}" y1="${y(tick)}" x2="${WIDTH - RIGHT}" y2="${y(tick)}"></line>` +
      `<text class="axis" x="${LEFT - 8}" y="${y(tick) + 4}" text-anchor="end">${tick}</text>`;
  }

  /* A step rather than a straight line between the points: the count changes at
     an interview, not gradually across the space between two of them. */
  let path = `M ${x(0)} ${y(points[0].total)}`;
  points.forEach((one, index) => {
    if (!index) return;
    path += ` L ${x(index)} ${y(points[index - 1].total)} L ${x(index)} ${y(one.total)}`;
  });

  const dots = points
    .map((one, index) => {
      const tip = t("saturationTip", {
        title: one.title,
        fresh: one.fresh,
        total: one.total,
        names: one.names.join(", ") || t("summaryNone"),
      });
      return (
        `<circle class="point saturation-point" cx="${x(index)}" cy="${y(one.total)}" r="${one.fresh ? 5 : 3.5}"` +
        ` data-tip="${escape(tip)}"></circle>` +
        (one.fresh
          ? `<text class="value" x="${x(index)}" y="${y(one.total) - 10}" text-anchor="middle">+${one.fresh}</text>`
          : "")
      );
    })
    .join("");

  /* Numbered, not named. Two interviews in the same department are ordinary,
     and a department name on the axis twice says nothing about which of them
     stopped adding categories. The position is unambiguous, always fits, and
     the title travels with the dot and stands in the figures below. */
  const marks = points
    .map(
      (one, index) =>
        `<text class="axis" x="${x(index)}" y="${TOP + PLOT + 18}" text-anchor="middle">${index + 1}</text>`,
    )
    .join("");

  const last = points[points.length - 1];
  const quiet = [...points].reverse().findIndex((one) => one.fresh);

  return {
    id: "saturation",
    file: "saturation.svg",
    title: t("chartSaturationTitle"),
    caption: t("chartSaturationCaption"),
    width: WIDTH,
    height,
    body: grid + `<path class="saturation-line" d="${path}" fill="none"></path>` + dots + marks,
    legend: null,
    summary: t("summarySaturation", {
      interviews: points.length,
      total: last.total,
      since: quiet > 0 ? quiet : 0,
    }),
    figures: {
      caption: t("saturationFiguresCaption"),
      columns: [t("interview"), t("saturationFresh"), t("saturationTotal"), t("saturationWhich")],
      rows: points.map((one) => [one.title, one.fresh, one.total, one.names.join(", ") || "·"]),
    },
  };
}

/**
 * Distribution across the guide sections: category by section as a heatmap. It
 * answers the question whether a category sticks to its section or spreads
 * across the conversation — magnitude, so a sequential ramp from one hue, not
 * category colors.
 */
export function heatmapChart(data, t, { measure } = {}) {
  const sections = data.sections ?? [];
  if (!data.rows.length || sections.length < 2) return null;

  const counts = new Map();
  for (const [categoryId, citations] of Object.entries(data.citations ?? {})) {
    for (const citation of citations) {
      if (!citation.sectionName) continue;
      const key = `${categoryId}|${citation.sectionName}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const max = Math.max(0, ...counts.values());
  if (!max) return null;
  const levelOf = (n) => Math.max(1, Math.ceil((n / max) * 5));

  const LABEL = 200;
  const track = WIDTH - LABEL - 8;
  const width = track / sections.length;

  /* The same column of names the bar chart above it has. It cut them at thirty
     characters while the chart directly above wrapped them — the same category
     names, in the same view, treated two ways. */
  const names = data.rows.map((row) => (row.parent ? "… " : "") + row.name);
  const { size, line: LINE, labels, tallest } = labelColumn(names, { room: LABEL - 12 });
  const CELL = Math.max(22, Math.ceil(tallest * LINE) + 8);

  /* Guide sections are named, not numbered, and the names are sentences: a
     column barely wider than a thumbnail cannot hold "Zusammenarbeit über
     Bereiche" horizontally. Set upright they were cut to eight characters and
     eight of nine columns read as an ellipsis — legible only on hover, which is
     no help at all in the exported SVG or on paper.

     So the headings are set at an angle, ascending to the left into the space
     above the row labels, which is empty anyway. That space is what bounds
     them: a heading may reach as far left as the row labels start. */
  const ANGLE = 45;
  const RADIANS = (ANGLE * Math.PI) / 180;
  const CHARACTER = 5.1; // 10px sans, measured across the section names
  const TOP = 2;

  /* An angled heading ends at its column and trails away behind it. Rising to
     the right it would trail down-left; set below the grid that is exactly the
     free space — under the row labels, where nothing else is. Rising labels
     placed above would instead trail off the right edge of the widest ones. */
  const room = LABEL + width / 2 - 6; // how far the first column may trail left
  const maxCharacters = Math.max(8, Math.min(30, Math.floor(room / Math.cos(RADIANS) / CHARACTER)));
  const headings = sections.map((section) => shorten(section.short, maxCharacters));
  /* How far the longest heading reaches down. Measured where somebody can
     measure, estimated where nobody can — and where nobody can, with a margin
     on top, because the estimate is not the safe side it was taken for: a
     heading of umlauts and wide letters came out four pixels past what it
     reserved, and in the browser `fitAngledHeadings` grew the drawing to catch
     it while the endpoint had no such net and cut the tail off. A foot a
     little too deep is white space; a foot too shallow is a figure with a word
     sliced through. */
  const SAFETY = 1.08;
  const reach = Math.max(
    ...headings.map((heading) =>
      measure ? measure(heading, { size: 10 }) : estimateWidth(heading, { size: 10 }) * SAFETY,
    ),
  );
  const FOOT = Math.ceil(reach * Math.sin(RADIANS)) + 12;

  const grid = TOP + data.rows.length * CELL;
  const height = grid + FOOT;

  const heads = sections
    .map((section, k) => {
      const x = LABEL + k * width + width / 2;
      const y = grid + 10;
      return (
        `<text class="axis heading" x="${x}" y="${y}" text-anchor="end"` +
        ` transform="rotate(-${ANGLE} ${x} ${y})">` +
        `<title>${escape(section.short)}</title>${escape(headings[k])}</text>`
      );
    })
    .join("");

  const cells = data.rows
    .map((row, index) => {
      const y = TOP + index * CELL;
      const line = sections
        .map((section, k) => {
          const x = LABEL + k * width;
          const n = counts.get(`${row.category}|${section.name}`) ?? 0;
          if (!n) {
            return `<rect class="cell-empty" x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${CELL - 2}"></rect>`;
          }
          const level = levelOf(n);
          return (
            `<rect class="cell level-${level}" x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${CELL - 2}" rx="3"` +
            ` data-row="${escape(row.name)}" data-section="${escape(section.short)}" data-value="${n}"` +
            ` data-tip="${escape(`${row.name} — ${section.short}: ${n}`)}"></rect>` +
            `<text class="cell-value${level >= 4 ? " inverse" : ""}" x="${x + width / 2}" y="${y + CELL / 2 + 3.5}" text-anchor="middle">${n}</text>`
          );
        })
        .join("");
      return (
        labelText(labels[index], {
          x: LABEL - 8,
          middle: y + CELL / 2,
          size,
          line: LINE,
          className: `row-label${row.parent ? " child" : ""}`,
        }) + line
      );
    })
    .join("");

  // The strongest cell is the one finding of the heatmap: this category is
  // concentrated in that section rather than spread across the conversation.
  let strongest = { value: 0, row: "—", section: "—" };
  for (const row of data.rows) {
    for (const section of sections) {
      const n = counts.get(`${row.category}|${section.name}`) ?? 0;
      if (n > strongest.value) strongest = { value: n, row: row.name, section: section.short };
    }
  }

  return {
    id: "heatmap",
    file: "distribution-across-sections.svg",
    title: t("heatmapTitle"),
    caption: t("heatmapCaption"),
    width: WIDTH,
    height,
    body: heads + cells,
    angle: ANGLE,
    baseline: grid + 10,
    legend: {
      kind: "ramp",
      from: 1,
      to: max,
      note: t("rampLabel"),
      entries: [1, 2, 3, 4, 5].map((level) => ({ paint: `level-${level}`, label: "" })),
    },
    summary: t("summaryHeatmap", {
      rows: data.rows.length,
      sections: sections.length,
      top: strongest.row,
      section: strongest.section,
      value: strongest.value,
    }),
    figures: {
      caption: t("heatmapFiguresCaption"),
      columns: [t("category"), ...sections.map((section) => section.short)],
      rows: data.rows.map((row) => [
        (row.parent ? "… " : "") + row.name,
        ...sections.map((section) => counts.get(`${row.category}|${section.name}`) ?? 0),
      ]),
    },
  };
}

/**
 * The MoSCoW distribution as a single band.
 *
 * Not a pie and not five bars: the question is how the catalog divides up, and
 * a hundred percent split into four steps reads fastest as one bar. Whatever
 * carries no level yet sits at the end in the unfilled step — a catalog is only
 * decided when that step has disappeared.
 */
export function moscowBand(rows, t, { moscow = [] } = {}) {
  const nameOf = (level) => moscow.find((one) => one.id === level)?.name ?? t("open");
  const levels = [
    ...MOSCOW_ORDER.map((id) => ({ id, name: nameOf(id) })),
    { id: "open", name: t("open") },
  ]
    .map((level) => ({
      ...level,
      count: rows.filter(
        (row) => (MOSCOW_ORDER.includes(row.moscow) ? row.moscow : "open") === level.id,
      ).length,
    }))
    .filter((level) => level.count > 0);
  if (!levels.length) return null;

  const HEIGHT = 34;
  const total = rows.length;
  let x = 0;
  const bands = levels
    .map((level) => {
      const width = (level.count / total) * WIDTH;
      const band =
        `<rect class="moscow-band ${moscowClass(level.id)}" x="${x}" y="0" width="${Math.max(1, width - 2)}"` +
        ` height="${HEIGHT}" rx="3" data-tip="${escape(`${level.name}: ${level.count}`)}"></rect>` +
        (width > 26
          ? `<text class="band-value${level.id === "open" ? " dim" : ""}" x="${x + width / 2 - 1}" y="${HEIGHT / 2 + 3.5}"` +
            ` text-anchor="middle">${level.count}</text>`
          : "");
      x += width;
      return band;
    })
    .join("");

  return {
    id: "moscow",
    file: "moscow-distribution.svg",
    title: t("chartMoscowTitle"),
    caption: t("chartMoscowCaption"),
    width: WIDTH,
    height: HEIGHT,
    body: bands,
    legend: {
      kind: "moscow",
      entries: levels.map((level) => ({ paint: moscowClass(level.id), label: level.name })),
    },
    summary: t("summaryMoscow", {
      total,
      levels: levels.map((level) => `${level.name}: ${level.count}`).join(", "),
    }),
    figures: {
      caption: t("moscowFiguresCaption"),
      columns: [t("columnLevel"), t("columnRequirements")],
      rows: levels.map((level) => [level.name, level.count]),
    },
  };
}

/**
 * The prioritization as a field.
 *
 * Both halves of the MoSCoW decision are quantities: how many departments name
 * a requirement, counted from the citations, and how many operations its
 * absence blocks, entered by the author. Plotted against each other they make
 * the decision checkable — a „Must have" in the lower left corner is one that
 * wants explaining, and a requirement in the upper right without a level is one
 * that has been overlooked.
 *
 * Requirements that share a coordinate are laid out side by side instead of on
 * top of each other, because a hidden dot is a lost requirement.
 */
export function priorityField(rows, t, { departmentCount, operationCount = 3, moscow = [] } = {}) {
  if (!rows.length) return null;
  const nameOf = (level) => moscow.find((one) => one.id === level)?.name ?? t("open");

  const LEFT = 150;
  const BOTTOM = 42;
  const maxX = Math.max(1, departmentCount);
  // At least one line to stand on. The operations are the study's own now, so a
  // catalog may hold none at all — and an axis of height nought is not a
  // smaller figure, it is a picture with nothing to read in it.
  const maxY = Math.max(1, operationCount);

  // Group by coordinate. Both axes count whole things, so several requirements
  // sharing one point is the normal case rather than the exception.
  const buckets = new Map();
  for (const row of rows) {
    const cx = Math.min(maxX, row.departments.length);
    const cy = Math.min(maxY, (row.blockedOperations ?? []).length);
    const key = `${cx}|${cy}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ row, cx, cy });
  }

  const maxCitations = Math.max(1, ...rows.map((row) => row.citations.length));
  const radius = (count) => 5 + Math.round((count / maxCitations) * 5);
  // One slot for the widest mark in the chart plus a gap, so the packing is the
  // same everywhere and two piles can be compared by eye. Measured at the reach
  // of a shape and not at its radius: a triangle is the same size as the circle
  // it replaces and still stands further out than one.
  const slot = markReach(radius(maxCitations)) * 2 + 3;

  /* The right-hand margin has to hold whatever sits on the last gridline, and
     that is the common case rather than the exception: a requirement every
     department named lands exactly there. The margin and the step depend on
     each other — a pile may be no wider than its own cell — so they are settled
     by running the layout twice, which is enough to converge. */
  let RIGHT = Math.ceil(10 + markReach(radius(maxCitations)));
  let stepX = (WIDTH - LEFT - RIGHT) / maxX;
  let placed = new Map();
  for (let pass = 0; pass < 2; pass += 1) {
    stepX = (WIDTH - LEFT - RIGHT) / maxX;
    placed = new Map(
      [...buckets].map(([key, bucket]) => [key, layoutBucket(bucket.length, { slot, stepX })]),
    );
    const onLastLine = [...buckets.keys()].filter((key) => Number(key.split("|")[0]) === maxX);
    const reach = Math.max(0, ...onLastLine.map((key) => placed.get(key).width / 2));
    RIGHT = Math.ceil(10 + markReach(radius(maxCitations)) + reach);
  }

  // A pile that wrapped into rows needs the room to do it in; the cell grows
  // rather than the marks being drawn on top of each other.
  const tallest = Math.max(0, ...[...placed.values()].map((one) => one.height));
  const CELL = Math.max(46, Math.ceil(tallest + 8));
  /* And the pile on the top line has half of itself above that line. Asked of
     the piles rather than kept as a fixed sixteen: a requirement blocking every
     operation there is sits on the highest line of the figure, which is the
     ordinary case for anything that matters, and half a pile drawn off the top
     edge is a requirement that has left the picture. */
  const TOP = Math.max(16, Math.ceil(tallest / 2) + 2);
  const height = TOP + maxY * CELL + BOTTOM;

  const track = WIDTH - LEFT - RIGHT;
  const x = (value) => LEFT + value * stepX;
  const y = (value) => TOP + (maxY - value) * CELL;

  let grid = "";
  for (let value = 0; value <= maxX; value++) {
    grid +=
      `<line class="grid" x1="${x(value)}" y1="${TOP}" x2="${x(value)}" y2="${y(0)}"></line>` +
      // A requirement blocking nothing sits on the baseline, so the labels keep
      // a dot's distance from it instead of being drawn through.
      `<text class="axis" x="${x(value)}" y="${y(0) + 22}" text-anchor="middle">${value}</text>`;
  }
  for (let value = 0; value <= maxY; value++) {
    grid +=
      `<line class="grid" x1="${LEFT}" y1="${y(value)}" x2="${WIDTH - RIGHT}" y2="${y(value)}"></line>` +
      `<text class="axis" x="${LEFT - 8}" y="${y(value) + 4}" text-anchor="end">${value}</text>`;
  }

  const points = [...buckets.entries()]
    .flatMap(([key, bucket]) =>
      bucket.map((entry, index) => {
        const place = placed.get(key).places[index];
        const cx = x(entry.cx) + place.dx;
        const cy = y(entry.cy) + place.dy;
        const tip = t("priorityTip", {
          title: entry.row.title,
          departments: entry.row.departments.length,
          blocked: (entry.row.blockedOperations ?? []).length,
          citations: entry.row.citations.length,
        });
        return moscowMark(entry.row.moscow, {
          cx,
          cy,
          r: radius(entry.row.citations.length),
          className: "point",
          attrs: `data-tip="${escape(tip)}"`,
        });
      }),
    )
    .join("");

  const axisTitles =
    `<text class="axis-title" x="${LEFT + track / 2}" y="${height - 8}" text-anchor="middle">${escape(t("axisDepartmentsNaming"))}</text>` +
    `<text class="axis-title" x="${-(TOP + (maxY * CELL) / 2)}" y="14" text-anchor="middle" transform="rotate(-90)">` +
    `${escape(t("axisBlockedOperations"))}</text>`;

  // Upper right is the point of the field: named by many, blocking much.
  const urgent = rows.filter(
    (row) => row.departments.length >= Math.max(2, maxX) && (row.blockedOperations ?? []).length >= 2,
  );

  return {
    id: "priority",
    file: "prioritization.svg",
    title: t("chartPriorityTitle"),
    caption: t("chartPriorityCaption"),
    width: WIDTH,
    height,
    body: grid + axisTitles + points,
    legend: { kind: "moscow", entries: moscowKey(rows, t, nameOf) },
    summary: t("summaryPriority", {
      rows: rows.length,
      departments: maxX,
      urgent: urgent.length,
      names: urgent.map((row) => row.title).join(", ") || t("summaryNone"),
    }),
    figures: {
      caption: t("priorityFiguresCaption"),
      columns: [
        t("columnRequirement"),
        t("axisDepartmentsNaming"),
        t("axisBlockedOperations"),
        t("metricCitations"),
        t("columnLevel"),
      ],
      rows: rows.map((row) => [
        row.title,
        row.departments.length,
        (row.blockedOperations ?? []).length,
        row.citations.length,
        MOSCOW_ORDER.includes(row.moscow) ? nameOf(row.moscow) : t("open"),
      ]),
    },
  };
}

/** Citations per requirement, split by department. */
/**
 * Which categories a requirement reaches.
 *
 * The catalog could say how *many* categories a requirement rests on and never
 * which ones, and the number is the less useful half: „touches four categories"
 * does not tell anybody what changes if the requirement is met. That is the
 * question a catalog is written to answer — build this one thing, and which
 * parts of what people said does it speak to?
 *
 * Drawn as a grid of dots rather than a grid of cells. A requirement rests on a
 * handful of a study's categories, so the honest picture is mostly empty, and a
 * heatmap of mostly-empty boxes reads as a wall with something wrong in it. Dots
 * on white make the emptiness quiet and the links loud — the same figure, told
 * the way round the data actually is.
 *
 * It reads in both directions, which is why the axes are this way round rather
 * than either being "the" answer:
 *
 *   across a row — meet this requirement, and these categories are what it
 *   speaks to;
 *   down a column — this is what people said, and these are the requirements
 *   that would answer it. A column with nothing in it is a category the catalog
 *   has not turned into anything yet, and that is the finding worth having. The
 *   count under each column says so in a number, and its name is set quietly so
 *   the eye finds the empty ones without hunting.
 *
 * A dot carries the MoSCoW level of its requirement, so the two questions fold
 * together: a category answered only by pale dots is one the catalog has
 * noticed and postponed.
 */
export function reachChart(rows, categories, t, { moscow = [] } = {}) {
  // Ordered before it is filtered: a category with no coding of its own is
  // still the branch its subcategories belong to.
  const columns = categoryAxis(categories).filter((one) => one.sum > 0);
  const withCitations = rows.filter((row) => row.citations.length);
  if (!withCitations.length || !columns.length) return null;

  const nameOf = (level) => moscow.find((one) => one.id === level)?.name ?? t("open");
  const counts = new Map();
  for (const row of withCitations) {
    for (const citation of row.citations) {
      const key = `${row.id}|${citation.category}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const max = Math.max(1, ...counts.values());

  const links = (row) => columns.filter((one) => counts.has(`${row.id}|${one.category}`)).length;
  const answers = (column) =>
    withCitations.filter((row) => counts.has(`${row.id}|${column.category}`)).length;

  /**
   * The order: the one the catalog already has, on both axes.
   *
   * This figure used to sort itself. Rows by how many categories they reach,
   * widest first, and then columns by where their topmost dot sat — a cheap
   * seriation that made the picture read as a staircase, with a break in the
   * staircase for a group. It was a real reading, and it cost more than it was
   * worth: the same twenty requirements stood in one order in the catalog list,
   * in another in this figure, and in a third in the export. A reader who finds
   * a requirement in the list and then looks for it in the picture has to hunt
   * for it, and a figure whose axis nobody can predict is one nobody trusts to
   * be about the same study as the list above it.
   *
   * So the rows are the catalog's own order — grouped by MoSCoW level, and
   * inside a level the requirement more departments name first — which is what
   * `/api/requirements` answers, what the cards show, and what the export
   * writes. And the columns are the order of the category system, which every
   * cross table and every bar chart in the tool already uses.
   *
   * What is given up: the staircase. Which requirements keep turning up in the
   * same company is no longer legible from the shape — it is still in the
   * figure, dot by dot, and the numbers under the columns still say which
   * categories the catalog has not answered.
   */

  /* A category only one requirement reaches. Worth marking, because it turns
     breadth into an argument: drop that requirement and nothing in the catalog
     answers what people said here any more. A row with several of them is
     load-bearing however few categories it touches. */
  const sole = new Set(
    columns.filter((one) => answers(one) === 1).map((one) => one.category),
  );

  const LABEL = 200;
  const REACH = 30;
  const TOP = 4;
  const TALLY = 14;
  const track = WIDTH - LABEL - REACH - 8;
  const width = track / columns.length;

  const names = withCitations.map((row) => row.title);
  const { size, line: LINE, labels, tallest } = labelColumn(names, { room: LABEL - 12 });
  const CELL = Math.max(24, Math.ceil(tallest * LINE) + 8);

  /* A mark says how many citations tie the two together, by area rather than by
     width: area is what the eye compares. A shade under what it was, because a
     mark now reaches further than its radius — the widest of them plus the ring
     that may be drawn around it has to stand inside its own row, and a row is
     the height of a line of writing. */
  const radius = (n) => 2.9 + Math.sqrt(n / max) * 3.7;

  /* The headings run at an angle into the space under the row labels, as the
     heatmap's do — a column the width of a thumbnail holds no category name
     upright, and a name cut to eight characters is legible only on hover, which
     is no help on paper or in the saved file. */
  const ANGLE = 45;
  const RADIANS = (ANGLE * Math.PI) / 180;
  const grid = TOP + withCitations.length * CELL;
  /* How much name a column may show, column by column.
     A heading is anchored under its column and runs down and to the left at
     45°, so what limits it is the distance from its own anchor to the left edge
     of the drawing — which the first column has little of and the last one has
     nearly the whole width. Measured once for the first column and applied to
     all, as it was, every heading was cut to what the narrowest place allowed,
     and a thirty-four character ceiling on top of that cut the rest: „Erwartung
     & Vertrauen in KI-Inhal…" in a column with room for the whole name.
     A name is what a category *is*, and a figure that will not print it is a
     figure somebody annotates by hand afterwards. */
  const roomFor = (k) => (LABEL + k * width + width / 2 - 6) / Math.cos(RADIANS);

  /* And broken over two lines rather than run out to its full length.
     A heading at forty-five degrees costs height by its width: „Erwartung und
     Vertrauen in KI-Inhalte" written on one line reaches two hundred pixels
     down the page, and the foot of the drawing has to hold all of it — so the
     longest category name in a study decides how much white space every other
     column stands in. Wrapped, the same name costs a good deal less, and
     nothing is given up: what is shortened is a line, not the name.

     Two lines, and the line is widened until they are enough. A fixed line
     width broke that name into three — „Erwartung und / Vertrauen in /
     KI-Inhalte" — which is a stack, not a label: three short lines are harder
     to read than two long ones, and they buy only a few pixels of height,
     because every line after the first is offset down the slope again. So each
     heading is given the room its own name needs to come out in two, as far as
     its column has any. A third line is the last resort before anything is
     shortened, and shortening is the last resort of all. */
  const HEAD_SIZE = 10;
  const HEAD_LINE = 11;
  const TARGET = 120;
  const headingLines = (name, k) => {
    const whole = estimateWidth(name, { size: HEAD_SIZE });
    /* Half the name, then more of it. Wrapping is greedy, so a line of exactly
       half often leaves a word over; widening in a few steps finds the width
       two lines actually need without measuring every break. */
    for (const share of [0.5, 0.6, 0.72]) {
      const room = Math.min(roomFor(k), Math.max(TARGET, Math.ceil(whole * share) + 2));
      const tried = wrapLabel(name, { room, size: HEAD_SIZE, maxLines: 2 });
      if (!tried.truncated) return tried.lines;
    }
    return wrapLabel(name, { room: roomFor(k), size: HEAD_SIZE, maxLines: 3 }).lines;
  };
  const wrapped = columns.map((one, k) => headingLines(one.name, k));

  /* How deep the block of headings goes. A line reaches its own width down the
     slope, and every line after the first is offset perpendicular to it — down
     and to the right — so the deepest point is not necessarily the longest
     line. Taken over all of them rather than guessed at. */
  const reach = Math.max(
    ...wrapped.flatMap((lines) =>
      lines.map(
        (line, index) =>
          // With the same margin the heatmap keeps, and for the same reason:
          // nobody measures here at all, and a tail cut off is not a rounding.
          estimateWidth(line, { size: HEAD_SIZE }) * 1.08 * Math.sin(RADIANS) +
          index * HEAD_LINE * Math.cos(RADIANS),
      ),
    ),
  );
  const FOOT = Math.ceil(reach) + 12;
  const height = grid + TALLY + FOOT;

  const perCategory = columns.map(answers);

  const heads = columns
    .map((one, k) => {
      const x = LABEL + k * width + width / 2;
      const y = grid + TALLY + 8;
      // Every line carries the anchor again: without it the second one would
      // start where the first ended rather than under the same column.
      const lines = wrapped[k]
        .map(
          (line, index) =>
            `<tspan x="${x}"${index ? ` dy="${HEAD_LINE}"` : ""}>${escape(line)}</tspan>`,
        )
        .join("");
      return (
        `<text class="axis heading${perCategory[k] ? "" : " unmet"}" x="${x}" y="${y}"` +
        ` text-anchor="end" transform="rotate(-${ANGLE} ${x} ${y})">` +
        `<title>${escape(one.name)}</title>${lines}</text>`
      );
    })
    .join("");

  /* How many requirements answer this category. A zero is the point of the
     figure and is written rather than left to be noticed as an absence. */
  const tally = columns
    .map(
      (one, k) =>
        `<text class="value${perCategory[k] ? "" : " empty"}" x="${LABEL + k * width + width / 2}"` +
        ` y="${grid + 10}" text-anchor="middle">${perCategory[k]}</text>`,
    )
    .join("");

  const dots = withCitations
    .map((row, index) => {
      const y = TOP + index * CELL;
      const middle = y + CELL / 2;
      const marks = columns
        .map((one, k) => {
          const n = counts.get(`${row.id}|${one.category}`) ?? 0;
          if (!n) return "";
          const only = sole.has(one.category);
          const cx = LABEL + k * width + width / 2;
          const r = radius(n);
          const tip = only
            ? t("reachTipSole", { title: row.title, category: one.name, n })
            : t("reachTip", { title: row.title, category: one.name, n });
          return (
            // The ring first, so the mark sits on top of it rather than inside
            // it. It carries the same tip: it is drawn wider than the mark, and
            // the band standing out beyond it is a place the mouse lands. Wide
            // enough for the shape it goes around, not for a dot — a triangle
            // inside a ring cut for a circle would stand on it.
            (only
              ? `<circle class="reach-sole" cx="${cx}" cy="${middle}"` +
                ` r="${(markReach(r) + 2.6).toFixed(2)}" data-tip="${escape(tip)}"></circle>`
              : "") +
            moscowMark(row.moscow, {
              cx,
              cy: middle,
              r,
              className: "reach",
              attrs:
                `data-row="${escape(row.title)}" data-category="${escape(one.name)}"` +
                ` data-value="${n}" data-sole="${only}" data-tip="${escape(tip)}"`,
            })
          );
        })
        .join("");
      const touched = links(row);
      return (
        labelText(labels[index], { x: LABEL - 8, middle, size, line: LINE }) +
        marks +
        `<text class="value" x="${WIDTH - 6}" y="${middle + 3.5}" text-anchor="end">${touched}</text>`
      );
    })
    .join("");

  const unmet = perCategory.filter((n) => !n).length;
  /* Which requirement carries the most of the study. It used to be the first
     row, because the figure sorted itself; the rows follow the catalog now, so
     it is found rather than read off the top. */
  const widest = withCitations.reduce(
    (best, row) => (links(row) > best.touched ? { title: row.title, touched: links(row) } : best),
    { title: withCitations[0].title, touched: links(withCitations[0]) },
  );
  const onlyOne = withCitations.filter((row) =>
    columns.some((one) => sole.has(one.category) && counts.has(`${row.id}|${one.category}`)),
  ).length;

  return {
    id: "reach",
    file: "requirement-reach.svg",
    title: t("chartReachTitle"),
    caption: t("chartReachCaption"),
    width: WIDTH,
    height,
    body: tally + heads + dots,
    legend: {
      kind: "moscow",
      entries: [
        ...moscowKey(withCitations, t, nameOf),
        /* The ring belongs in the key, not in a sentence at the end of a long
           caption. A mark that has to be explained and is explained only in
           prose is a mark nobody reads — it was there, said what it meant, and
           read as decoration anyway. It is only offered when there is one on
           the figure: a key entry for something not drawn is worse than none. */
        ...(sole.size ? [{ paint: "sole", shape: "ring", label: t("reachSoleKey") }] : []),
        /* And the size, drawn at the size it means. It was named in the caption
           as „Punktgröße = Belege", which is three words for something that had
           to be asked about to be understood: *which* citations, counted how,
           against what largest. A scale nobody can read off the picture is not
           a scale, it is a claim that the picture is quantitative.
           So the two ends of it stand in the key as two dots — this figure's
           own, since the scale is relative to the largest cell in it and says
           nothing across two figures. Left out when the largest cell is one:
           every dot is then the same size and a scale from one to one is
           furniture. */
        ...(max > 1
          ? [
              { label: t("reachSizeKey") },
              // One statement, so it is never broken across two lines: a small
              // dot at the right edge and a large one alone on the next reads
              // as two scales rather than as the two ends of one.
              { shape: "dot", radius: radius(1), label: t("reachSizeOne"), keepWith: true },
              {
                shape: "dot",
                radius: radius(max),
                label: t("reachSizeMany", { n: max }),
                keepWith: true,
              },
            ]
          : []),
      ],
    },
    summary: t("summaryReach", {
      rows: withCitations.length,
      categories: columns.length,
      top: widest.title,
      touched: widest.touched,
      narrow: withCitations.filter((row) => links(row) === 1).length,
      only: onlyOne,
      unmet,
      // The one thing the size says at a glance, for whoever cannot see it.
      most: max,
    }),
    figures: {
      caption: t("reachFiguresCaption"),
      columns: [t("columnRequirement"), ...columns.map((one) => one.name), t("columnReaches")],
      rows: withCitations.map((row) => [
        row.title,
        ...columns.map((one) => counts.get(`${row.id}|${one.category}`) ?? 0),
        links(row),
      ]),
    },
  };
}

/**
 * The matrix as a city.
 *
 * X is the categories, Y is the requirements, and Z is whatever the caller says
 * a tower is worth. Isometric columns on a lattice, drawn from the back forward
 * so the near ones cover the far ones, each in the MoSCoW colour of its
 * requirement.
 *
 * Two things this took to become readable.
 *
 * The towers stand apart. Filling their whole cell they met at the edges and
 * three neighbours read as one long building; inset by a fifth of a cell each
 * keeps its own footprint, the floor shows between them, and a gap in the city
 * is visibly a gap rather than something hidden behind a wall.
 *
 * And the names run horizontally along the two near edges rather than with
 * their own axis. Set along its axis, one label lies on the line the next one
 * starts on — which is how the first attempt turned both edges into a smear.
 * Written flat, consecutive labels are a whole cell apart in the vertical, and
 * the two edges read as two staircases of ordinary text.
 *
 * What the projection costs is still real and still visible: a tall tower in
 * front hides what stands behind it. Nothing in the drawing can fix that; it is
 * the price of the third dimension, and worth knowing before reading a hole as
 * an absence.
 */
export function cityPlot(rows, categories, t, { moscow = [] } = {}) {
  // Ordered before it is filtered: a category with no coding of its own is
  // still the branch its subcategories belong to.
  const columns = categoryAxis(categories).filter((one) => one.sum > 0);
  const withCitations = rows.filter((row) => row.citations.length);
  if (!withCitations.length || !columns.length) return null;

  const counts = new Map();
  for (const row of withCitations) {
    for (const citation of row.citations) {
      const key = `${row.id}|${citation.category}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const nameOf = (level) => moscow.find((one) => one.id === level)?.name ?? t("open");

  const max = Math.max(1, ...counts.values());

  /* The same two readings the flat figure prints beside its rows and columns.
     This is the same matrix; a number that is worth saying there is worth
     saying here. */
  const links = (row) => columns.filter((one) => counts.has(`${row.id}|${one.category}`)).length;
  const answers = (column) =>
    withCitations.filter((row) => counts.has(`${row.id}|${column.category}`)).length;
  const sole = new Set(
    columns.filter((one) => answers(one) === 1).map((one) => one.category),
  );
  const widest = withCitations.reduce(
    (best, row) => (links(row) > best.touched ? { title: row.title, touched: links(row) } : best),
    { title: withCitations[0].title, touched: links(withCitations[0]) },
  );

  const INSET = 0.2;

  /* What a building stands on, and what says which level it carries.
     The walls were four shades of one green, which is four things nobody can
     tell apart across a city of them. So the level is the ground plan now, and
     the plan counts its edges: „Must have" four, „Should have" three, „Could
     have" two, „Won't have" one — a block, a wedge, an oval tower, a round one.
     A flat figure can say that with a shape; here it is a body, which is the
     one thing this figure has that the flat one does not.

     All four are drawn to about the room the block always had, so a city of
     mixed plans still stands as far apart as a city of blocks — the height is
     the quantity, and a footprint that grew with the level would be a second
     scale nobody asked for. */
  const ROUND = 0.36;
  const OVAL_WIDE = 0.48;
  const OVAL_DEEP = 0.17;
  const WEDGE = 0.42;
  // Enough segments that an outline reads as a curve and not as a polygon.
  const SEGMENTS = 28;

  /* A point of a ground plan, said in what a reader sees rather than in the
     lattice: how far it lies toward the viewer, and how far to the right. The
     two lattice axes run away from the near corner at equal angles, so the one
     is turned into the other by half a right angle. */
  const planPoint = (i, j, toward, right) => ({
    i: i + 0.5 + (toward - right) / Math.SQRT2,
    j: j + 0.5 + (toward + right) / Math.SQRT2,
  });
  const ring = (i, j, deep, wide, count) =>
    Array.from({ length: count }, (unused, k) => {
      const angle = (k / count) * Math.PI * 2;
      return planPoint(i, j, Math.cos(angle) * deep, Math.sin(angle) * wide);
    });
  /* The wedge points at the reader. Its one near vertex and its two far ones
     are what tells it from the block at a glance, and a wedge turned the other
     way shows the reader its flat back. */
  const groundPlan = (level, i, j) => {
    const edges = edgesOf(level);
    if (edges === 4) {
      return [
        { i: i + INSET, j: j + INSET },
        { i: i + INSET, j: j + 1 - INSET },
        { i: i + 1 - INSET, j: j + 1 - INSET },
        { i: i + 1 - INSET, j: j + INSET },
      ];
    }
    if (edges === 3) return ring(i, j, WEDGE, WEDGE, 3);
    if (edges === 2) return ring(i, j, OVAL_DEEP, OVAL_WIDE, SEGMENTS);
    return ring(i, j, ROUND, ROUND, SEGMENTS);
  };

  /* What stands between the lattice and a name: the gap and the number. The
     counts stand against the city — against the cell at the edge whose row or
     column they count — and the name hangs off the number. Put behind the name
     instead, as the right-hand side once had them, a count sits a whole name's
     width from the thing it counts and the reader has to measure across the
     white to see which one it belongs to. */
  const GAP = 9;
  const NUMBER = 20;
  const EDGE = 4;
  const CLEAR = 5;
  /* The angle the floor is drawn at, and the one number the names are read at.

     A name is written along its own row, so the room it has is the distance
     between two *parallel* lines of writing, and on this lattice at this tilt
     that distance is twice the sine of the angle, times the step across. The
     floor stood at thirty degrees, where twice the sine is exactly one: a name
     had the bare step to live in, and with five and twenty rows on a sheet this
     wide the step is fifteen units, which came out as eight-pixel type. Printed
     in a thesis at the width of its text block that is five point, against six
     for the flat figure of the same matrix and ten for the prose around it —
     the smallest type in the document, and the picture was praised on a screen
     where nobody had to read it that small.

     Forty gives a quarter more room between the lines and the type goes up to
     nine and a half, which is the size the flat figure is set in. What it costs
     is height, and height is what a figure on a page has spare: it is drawn to
     one width and scaled to the column it stands in, so growing downward is
     free and growing sideways is not. This one grows from a hundred to a
     hundred and thirty-five millimetres and still stands on its page with its
     key and its caption.

     What it must not do is *follow* the names — that was the old failure, where
     a floor stretched to fit two lines of type tipped up into something nobody
     would call a view. Forty is set here and the names are fitted to it, not
     the other way round. */
  const FLOOR = 40;
  const ISO = Math.tan((FLOOR * Math.PI) / 180);

  /* And they no longer need to. A name set flat has the step down to live in,
     which is half the step across and never enough; set at an angle, what it
     has is the distance between two *parallel* lines of writing, which is a
     good deal more.

     The lattice's own angle, and taken from it rather than written down twice,
     because the name has to run along the row it names and not merely start on
     it. A row of this figure is a line of cells, and that line leaves the
     lattice at exactly the point the count stands at and carries on outward:
     written along it, a name lies on its own row from its first letter to its
     last. Written at any other angle it crosses out of its row as it goes, and
     a reader who follows the writing inward — which is what a reader does —
     arrives at the wrong one. Two constants that have to agree are two
     constants that one day will not. */
  const SLANT = FLOOR;
  const RUN = Math.cos((SLANT * Math.PI) / 180);
  const RISE = Math.sin((SLANT * Math.PI) / 180);
  // How much room one step across leaves between two names, at this tilt on
  // this lattice: what a step contributes across the writing rather than along
  // it. Written along its own row it comes to twice the sine of the floor's
  // angle — one whole step at thirty degrees, a little over a quarter more at
  // forty, which is what the names are set from.
  const LANE = RISE + ISO * RUN;

  const categoryText = columns.map((one) => one.name);
  const requirementText = withCitations.map((row) => row.title);
  const lattices = columns.length + withCitations.length;

  /* The narrowest a name can be set in and still come out in the lines it is
     allowed. Found by trying, because the wrapping is greedy: half of a name is
     not where it breaks in two — that puts three words on the first line and
     the rest on a second and a third — and the answer is the first width at
     which it does come out whole.

     Two things are asked of it. What a side has to keep, before anything is
     drawn: a title set on one line takes a third of the sheet on its own, and
     broken it takes a sixth. And where a name that has to break should break:
     the same width, which is the most even break there is. */
  const asksFor = (name, size, lines) => {
    const whole = estimateWidth(name, { size });
    const word = Math.max(...String(name).split(/\s+/).map((one) => estimateWidth(one, { size })));
    for (let room = Math.max(word, whole / lines); room < whole; room += 3) {
      if (!wrapLabel(name, { room, size, maxLines: lines }).truncated) return room + 1;
    }
    return whole + 1;
  };

  /* What a side has to keep outside the lattice, worked out from the names in
     the order they are written along their edge: the first of each is the one
     at the corner, and each after it begins a step further in. So what a side
     keeps is the widest *overhang* rather than the widest name — „Erwartung an
     das Ablagesystem" three steps in costs nothing if the drawing is three
     steps wide there. Tilted, a name reaches across by its own width less the
     tilt, which is where the run comes in.

     The reserve and the step turn on each other — a wider step carries more of
     the names — so the two are walked onto from the widest step down, each pass
     only ever shrinking. */
  const settle = (size, lines) => {
    const needs = [categoryText, requirementText].map((names) =>
      names.map((name) => asksFor(name, size, lines)),
    );
    /* A tilted block of lines is wider than its longest line: the second line
       hangs half a line's height off the baseline, and half a line's height on
       the diagonal is that much further out. */
    const stack = (RISE * (lines - 1) * Math.round(size * 1.2 * 10)) / 20;
    const reserve = (need, step) =>
      (GAP + NUMBER) * RUN +
      EDGE +
      1 +
      stack +
      Math.max(0, ...need.map((one, k) => RUN * one - (k + 0.5) * step));
    let across = 38;
    for (let pass = 0; pass < 12; pass += 1) {
      const asks = needs.map((need) => reserve(need, across));
      across = Math.max(12, Math.min(38, (WIDTH - asks[0] - asks[1]) / lattices));
    }
    return {
      size,
      lines,
      line: Math.round(size * 1.2 * 10) / 10,
      across,
      asks: needs.map((need) => reserve(need, across)),
    };
  };

  /* The largest type at which every name is written whole — and at each size,
     broken over two lines before it is left on one. Not because two lines read
     better, but because a name is set on the diagonal here: left on one line it
     reaches as far down the sheet as it does across, and a study of six
     requirements came out as a small city over a great fan of writing. Broken,
     it asks for half of both. Short names are unaffected either way; there is
     nowhere to break them.

     Room *between* the lines of writing is the other half of it, and on this
     lattice at this tilt that room is exactly one step across — so the type has
     to come down until a name fits between two neighbours as well as beside
     them. Where even the smallest fails, the step has hit the floor under it,
     the study has more names than a sheet this wide can carry, and what does
     not fit is shortened with its whole self kept in the element's title. */
  const plan =
    [9.5, 9, 8.5, 8, 7.5, 7, 6.5]
      .flatMap((size) => [
        [size, 2],
        [size, 1],
      ])
      .map(([size, lines]) => settle(size, lines))
      // `across` off its floor is the width test: the reserve and the step are
      // settled against each other until they exactly fill the sheet, so asking
      // whether they fit is asking a coin toss in the last decimal. What the
      // floor means is that they no longer do.
      .find(
        (one) => one.lines * one.line + CLEAR <= LANE * one.across && one.across > 12.01,
      ) ??
    settle(6.5, 1);
  /* Both sides keep a minimum whatever the plan says. Thirty categories and
     thirty requirements are sixty steps to lay down, and sixty of the smallest
     step is the whole sheet with nothing left beside it for a single letter —
     the layout came out with a *negative* margin for the first name. There the
     lattice gives way rather than the names: a floor nobody can read the edges
     of is not a figure, and the names shorten and say so with an ellipsis. */
  const LEAST = GAP + NUMBER + EDGE + 26;
  const LINES = plan.lines;
  const ACROSS = Math.min(plan.across, (WIDTH - 2 * LEAST) / lattices);
  /* And the type with it, so the tilted lines keep clear of each other at the
     narrower step too. Above the pinch this is `plan.size` exactly: the plan
     was chosen against that very condition. */
  const SIZE =
    Math.round(Math.max(5.5, Math.min(plan.size, (LANE * ACROSS - CLEAR) / (1.2 * LINES))) * 2) /
    2;
  const LINE = Math.round(SIZE * 1.2 * 10) / 10;
  const DOWN = ISO * ACROSS;
  /* How tall the tallest tower stands, in proportion to the ground it stands
     on. Ninety-six over a cell of thirty is a building; over a cell of twelve —
     which is what a study of thirty categories and requirements comes down to —
     it is a splinter, and a field of splinters is not a skyline. */
  const TALL = Math.min(96, Math.max(48, 3.4 * ACROSS));

  /* And the least a tower may be, as a share of that.

     Straight proportion is right until the counts are lopsided, and they are:
     one cell of a real catalog carried 39 citations and most carried one or
     two. At 1/39 of the height a tower is a plate on the floor — the cell is
     still there and still coloured, but the height, which is the whole reason
     this figure exists beside the flat one, says nothing for all but a handful
     of cells. So every tower stands, and the rest of the height is shared out
     in proportion above that.

     A floor and not a squeeze: every height above it stays exactly
     proportional, so no difference a reader can see is a difference that is not
     there. What is under it is lifted to the same minimum and is therefore
     *not* told apart — which is the honest thing to say about one citation and
     two against a maximum of thirty-nine, and the table underneath still
     carries each of them. Where nothing is lifted, nothing is said; where something is,
     the key says so, because a height read as a quantity that silently is not
     one is the one thing a figure must not do. */
  const STAND = 0.15;
  const rise = (n) => TALL * Math.max(n / max, STAND);
  // Asked of the smallest tower there actually is, not of the largest one:
  // where the counts sit close together nothing is lifted, and a key that
  // explains a compression the figure did not make sends the reader looking
  // for one.
  const stands = Math.min(...counts.values()) / max < STAND;

  const spread = lattices * DOWN;
  /* Where the left corner of the lattice falls. What the two sides asked for if
     it fits, with whatever is over shared evenly so the picture stays centred;
     and if it does not — more names than the sheet can carry — split in the
     proportion they asked in, and what still does not fit is shortened below. */
  const asked = plan.asks[0] + plan.asks[1];
  const spare = WIDTH - lattices * ACROSS;
  const leftEdge =
    asked <= spare
      ? plan.asks[0] + (spare - asked) / 2
      : Math.max(EDGE, (spare * plan.asks[0]) / asked);
  const placed = leftEdge + withCitations.length * ACROSS;

  // Back to front: the far corner is where i and j are both small.
  const cells = [];
  for (let i = 0; i < withCitations.length; i += 1) {
    for (let j = 0; j < columns.length; j += 1) {
      const n = counts.get(`${withCitations[i].id}|${columns[j].category}`) ?? 0;
      if (n) cells.push({ i, j, n, plan: groundPlan(withCitations[i].moscow, i, j) });
    }
  }
  cells.sort((a, b) => a.i + a.j - (b.i + b.j));

  /* What the towers need above the lattice, asked of the towers rather than
     reserved for the tallest one that could have stood in the far corner. Every
     row forward lowers the roof by a step down, so a full-height tower at the
     front reaches nowhere near as high on the sheet as one at the back — and a
     figure that keeps the room for it anyway opens with a hand's width of
     white it never uses. */
  const headroom =
    26 +
    Math.max(
      0,
      // The far corner of the roof, which is the highest point on the sheet —
      // asked of the ground plan, because not every plan has its corner where
      // the block has one.
      ...cells.map(({ n, plan }) => rise(n) - Math.min(...plan.map((one) => one.i + one.j)) * DOWN),
    );

  /* Both sets of names, set before the sheet is measured, because how far they
     hang below their own edge is what the sheet has to be tall enough for.

     Each is given the room its own place on the edge leaves: a name further
     along begins further out and has that much more of the sheet in front of
     it. Divided by the run, because a tilted name reaches across by less than
     its length. */
  // Where a name begins, which is out along its own row rather than out to the
  // side: the gap and the count, reckoned along the line and not across it.
  const OUT = (GAP + NUMBER) * RUN;
  const anchorX = {
    left: (j) => placed + (j + 0.5 - withCitations.length) * ACROSS - OUT,
    right: (i) => placed + (columns.length - i - 0.5) * ACROSS + OUT,
  };
  const STACK = (RISE * (LINES - 1) * LINE) / 2;
  /* Set into the room it has, but broken *evenly* when it has to break at all.
     Wrapping is greedy — hand it the whole of a wide margin and it fills the
     first line to the last word it can take and leaves „geht" alone on the
     second. So a name that fits on one line is given the margin, and a name
     that does not is given the narrowest width it still comes out of in two,
     which is the most even break there is. */
  const setIn = (name, given) => {
    // Never less than a few letters, however crowded: what a name is cut to is
    // still a name, and its whole self is in the title either way.
    const room = Math.max(given, 4 * SIZE);
    const whole = estimateWidth(name, { size: SIZE });
    const even = whole <= room ? room : Math.min(room, asksFor(name, SIZE, LINES));
    return wrapLabel(name, { room: even, size: SIZE, maxLines: LINES });
  };
  const categoryLabels = categoryText.map((name, j) =>
    setIn(name, (anchorX.left(j) - EDGE - STACK) / RUN),
  );
  const requirementLabels = requirementText.map((name, i) =>
    setIn(name, (WIDTH - EDGE - STACK - anchorX.right(i)) / RUN),
  );

  /* How far the drawing reaches below its own lattice: a name runs downward as
     it runs outward, and the longest of them decides. Measured off the name as
     it came out rather than off the room it was given — most names are shorter
     than their room, and a foot kept for the longest one that could have been
     there is white nobody asked for. */
  const drop = (labels, rowOf) =>
    Math.max(
      0,
      ...labels.map((label, k) => {
        const run = Math.max(...label.lines.map((line) => estimateWidth(line, { size: SIZE })));
        // The name starts a gap and a count out along its own row, which is
        // already downward, and runs on from there.
        return rowOf(k) + RISE * (GAP + NUMBER + run) + (label.lines.length * LINE) / 2 - spread;
      }),
    );
  const below = Math.max(
    drop(categoryLabels, (j) => (withCitations.length + j + 0.5) * DOWN),
    drop(requirementLabels, (i) => (columns.length + i + 0.5) * DOWN),
  );
  const top = headroom;
  const canvas = top + spread + Math.max(20, below + EDGE + SIZE);

  /* And the whole of it centred on what is drawn rather than on what was
     reserved. Each side keeps room for its own names, and a study whose
     categories are one word and whose requirements are a sentence keeps twice
     as much on one side as on the other — which is right for the reserve and
     wrong for the eye: the city ends up hard against one edge of the sheet with
     the white all on the other. Measured off the names as they came out, and
     never far enough to push the far side off the sheet. */
  const outer = (labels, anchor, sign) =>
    labels.map((label, k) => {
      const run = Math.max(...label.lines.map((line) => estimateWidth(line, { size: SIZE })));
      return anchor(k) + sign * (RUN * run + STACK);
    });
  const reaches = [
    Math.min(...outer(categoryLabels, anchorX.left, -1), placed - withCitations.length * ACROSS),
    Math.max(...outer(requirementLabels, anchorX.right, 1), placed + columns.length * ACROSS),
  ];
  const midX =
    placed +
    Math.min(
      Math.max((WIDTH - reaches[1] - reaches[0]) / 2, EDGE - reaches[0]),
      WIDTH - EDGE - reaches[1],
    );
  const foot = (i, j) => ({
    x: midX + (j - i) * ACROSS,
    y: top + (j + i) * DOWN,
  });

  /* The lattice first, so a tower stands on a visible square and an empty cell
     is a hole in a floor rather than nothing at all. */
  let lattice = "";
  for (let i = 0; i <= withCitations.length; i += 1) {
    const a = foot(i, 0);
    const b = foot(i, columns.length);
    lattice += `<line class="floor" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"></line>`;
  }
  for (let j = 0; j <= columns.length; j += 1) {
    const a = foot(0, j);
    const b = foot(withCitations.length, j);
    lattice += `<line class="floor" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"></line>`;
  }

  const towers = cells
    .map(({ i, j, n, plan }) => {
      const row = withCitations[i];
      const ground = plan.map((one) => foot(one.i, one.j));
      const up = (point) => `${point.x.toFixed(1)} ${(point.y - rise(n)).toFixed(1)}`;
      const down = (point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
      const only = sole.has(columns[j].category);
      const tip = only
        ? t("reachTipSole", { title: row.title, category: columns[j].name, n })
        : t("reachTip", { title: row.title, category: columns[j].name, n });
      const level = moscowClass(row.moscow);
      /* The one building that answers a category nothing else answers, roofed
         in a colour that is in no scale of this figure.
         It was a ring, drawn beside the name out where the counts stand — a
         mark about a *block* set down in the column of figures, where it read
         as belonging to the number it happened to land next to. What the mark
         is about is the block, so it is on the block. And on the roof of it:
         the roof is the face a reader looks straight down at from up here, so
         it can take a colour of its own — and the level is not lost with it,
         because the level is the shape the whole body stands in and the walls
         under the roof are still standing in it. */
      /* A body seen from above and in front: the roof, and the walls that hang
         from the edges of the ground plan facing the reader.

         Which edges those are is worked out rather than named. A block has two
         of them and they used to be written down — and one of the two written
         down was a *far* edge, so that wall stood behind the block and was
         drawn over the front of it, which put a second colour across half of
         every roof at the opacity of a wall. A plan with twenty-eight edges
         cannot be written down at all, so each edge is asked which way it
         faces: outward and toward the reader, and it is a wall.

         The walls come out as one shape per side rather than one per edge. Each
         face is drawn with a hairline in the sheet colour so that two buildings
         standing behind each other stay two buildings — a round tower cut into
         twenty-eight strips would wear every one of those hairlines and read as
         a fluted column. */
      const middle = ground.reduce(
        (sum, point) => ({ x: sum.x + point.x / ground.length, y: sum.y + point.y / ground.length }),
        { x: 0, y: 0 },
      );
      const walls = [];
      for (let k = 0; k < ground.length; k += 1) {
        const from = ground[k];
        const to = ground[(k + 1) % ground.length];
        let nx = to.y - from.y;
        let ny = from.x - to.x;
        const outward =
          nx * ((from.x + to.x) / 2 - middle.x) + ny * ((from.y + to.y) / 2 - middle.y);
        if (outward < 0) {
          nx = -nx;
          ny = -ny;
        }
        // Down the sheet is toward the reader: an edge whose outside faces the
        // other way is behind the body, and its wall is inside it.
        if (ny <= 0) continue;
        const side = nx < 0 ? "left" : "right";
        const last = walls[walls.length - 1];
        if (last && last.side === side && last.points[last.points.length - 1] === from) {
          last.points.push(to);
        } else {
          walls.push({ side, points: [from, to] });
        }
      }
      /* A run that wrapped past the last edge is one wall in two pieces: the
         list starts wherever the plan happens to start, and a seam there would
         be a hairline down a wall that has none. */
      if (
        walls.length > 1 &&
        walls[0].side === walls[walls.length - 1].side &&
        walls[walls.length - 1].points[walls[walls.length - 1].points.length - 1] ===
          walls[0].points[0]
      ) {
        walls[0].points = [...walls.pop().points.slice(0, -1), ...walls[0].points];
      }
      const roof = ground.map(up).join(" ");
      return (
        `<g class="tower${only ? " sole" : ""}" data-row="${escape(row.title)}"` +
        ` data-category="${escape(columns[j].name)}"` +
        ` data-value="${n}" data-sole="${only}" data-tip="${escape(tip)}">` +
        walls
          .map(
            (wall) =>
              `<polygon class="face ${wall.side} ${level}" points="${
                wall.points.map(up).join(" ")
              } ${[...wall.points].reverse().map(down).join(" ")}"></polygon>`,
          )
          .join("") +
        // The roof last, so a wall that meets it along a chord of a curve stops
        // at the roof rather than a hair over it.
        `<polygon class="face top ${only ? "sole-roof" : level}" points="${roof}"></polygon>` +
        `</g>`
      );
    })
    .join("");

  /* Names on the two *near* edges, each hung off its own count and running
     outward from the city. Which two edges those are is the whole of it: put on
     a far edge, a label sits exactly where the towers of its own row rise
     through, and no amount of nudging saves it. The near-left edge belongs to
     the categories and its outside is down and to the left; the near-right edge
     belongs to the requirements and its outside is down and to the right. The
     two run away from the near corner like the shadow of the city.

     Each carries the same count the flat figure prints at the same place: how
     many categories a requirement reaches, how many requirements answer a
     category. They are the reading of a row and of a column, and this is the
     same matrix — a reader who takes the two figures for the same thing and
     finds a number in one of them and not in the other is right to wonder which
     one is holding something back. */
  /* Everything an edge carries stands *on the line of its own row*, and that is
     the whole of it.

     The line of a row is the one through the middles of its cells: for a
     category, the middles of every tower in its column; for a requirement, the
     middles of every tower in its row. It leaves the lattice at the point the
     count is set against, and it runs on outward at the lattice's own angle.
     So the count is set a gap out along *that line*, and the name a number's
     width further out along it, and the name is written along it.

     Set out horizontally instead — which is what they were — they walk off
     their own line as they go: a gap of nine units to the side is five units
     off a line that climbs at thirty degrees, and a name set a number's width
     beyond that is seventeen. A row of this lattice is eight units tall. The
     count therefore sat most of a row above the row it counted, and the name
     two rows above the row it named, both of them drifting further out the
     further they went. That is the kink, and it is why every name looked like
     it belonged to its neighbour. */
  const away = { x: RUN, y: RISE };
  const along = (spot, out, back) => ({
    x: spot.x + (back ? -out * away.x : out * away.x),
    y: spot.y + out * away.y,
  });

  const named = (label, text, { at, back, quiet = false }) => {
    /* The block of lines centred across the baseline, and the whole thing
       pivoted about the point it hangs from — so the lines stack square to the
       writing rather than square to the sheet. */
    const first = at.y - ((label.lines.length - 1) * LINE) / 2 + SIZE * 0.35;
    const tilt = back ? -SLANT : SLANT;
    return (
      `<text class="axis city${quiet ? " unmet" : ""}" x="${at.x.toFixed(1)}"` +
      ` y="${first.toFixed(1)}" text-anchor="${back ? "end" : "start"}"` +
      ` transform="rotate(${tilt} ${at.x.toFixed(1)} ${at.y.toFixed(1)})"` +
      ` style="font-size:${SIZE}px">` +
      `<title>${escape(text)}</title>` +
      label.lines
        .map(
          (line, k) =>
            `<tspan x="${at.x.toFixed(1)}"${k ? ` dy="${LINE}"` : ""}>${escape(line)}</tspan>`,
        )
        .join("") +
      `</text>`
    );
  };

  /* The count on the same line, and turned with it. Left upright it would sit
     square to the sheet in a run of writing that is not, and — over the two
     digits a count can run to — walk off the line it belongs to at the far end
     of itself. */
  const counted = (at, value, back, quiet) =>
    `<text class="value${quiet ? " empty" : ""}" x="${at.x.toFixed(1)}"` +
    ` y="${(at.y + 3.5).toFixed(1)}" text-anchor="${back ? "end" : "start"}"` +
    ` transform="rotate(${back ? -SLANT : SLANT} ${at.x.toFixed(1)} ${at.y.toFixed(1)})">` +
    `${value}</text>`;

  const categoryNames = columns
    .map((one, j) => {
      const spot = foot(withCitations.length, j + 0.5);
      const answered = answers(one);
      // A category no requirement answers is the finding, here as there: the
      // count says nought and the name is set quietly rather than hidden.
      return (
        counted(along(spot, GAP, true), answered, true, !answered) +
        named(categoryLabels[j], one.name, {
          at: along(spot, GAP + NUMBER, true),
          back: true,
          quiet: !answered,
        })
      );
    })
    .join("");

  const requirementNames = withCitations
    .map((row, i) => {
      const spot = foot(i + 0.5, columns.length);
      return (
        counted(along(spot, GAP, false), links(row), false, false) +
        named(requirementLabels[i], row.title, { at: along(spot, GAP + NUMBER, false) })
      );
    })
    .join("");

  return {
    id: "city",
    file: "catalog-city.svg",
    title: t("chartCityTitle"),
    caption: t("chartCityCaption"),
    width: WIDTH,
    height: canvas,
    body: lattice + towers + categoryNames + requirementNames,
    legend: {
      kind: "moscow",
      entries: [
        ...moscowKey(withCitations, t, nameOf),
        /* The same statement the flat figure makes with a ring, in the mark
           this figure makes it with: the key shows what is drawn, and a ring
           beside a picture that has no rings in it sends the reader looking. */
        ...(sole.size ? [{ paint: "sole-roof", label: t("reachSoleKey") }] : []),
        /* The height, named. The flat figure can draw the two ends of its scale
           as two dots and let the reader hold them against the picture; two
           towers in a key would be a second little drawing, and a tower is read
           against the lattice it stands on rather than against a swatch. So it
           is said in words — but said, which it was not. */
        ...(max > 1
          ? [{ label: t(stands ? "cityHeightStandKey" : "cityHeightKey", { n: max }) }]
          : []),
      ],
    },
    /* Every chart carries its numbers as a table as well. Here it matters more
       than usual: a tower hidden behind a taller one is unreadable in the
       picture by construction, and the table is where it is still readable.

       The same table the flat figure carries, to the column: the two are one
       matrix drawn twice, and two tables that differ would make a reader ask
       which of the two figures is about something else. */
    figures: {
      caption: t("cityFiguresCaption"),
      columns: [t("columnRequirement"), ...columns.map((one) => one.name), t("columnReaches")],
      rows: withCitations.map((row) => [
        row.title,
        ...columns.map((one) => counts.get(`${row.id}|${one.category}`) ?? 0),
        links(row),
      ]),
    },
    summary: t("summaryCity", {
      rows: withCitations.length,
      categories: columns.length,
      top: widest.title,
      touched: widest.touched,
      narrow: withCitations.filter((row) => links(row) === 1).length,
      only: withCitations.filter((row) =>
        columns.some((one) => sole.has(one.category) && counts.has(`${row.id}|${one.category}`)),
      ).length,
      unmet: columns.filter((one) => !answers(one)).length,
      max,
    }),
  };
}

/**
 * Which operations a requirement holds up, drawn twice: as a Venn diagram and
 * as an Euler diagram of the same three sets.
 *
 * The relation is a membership and not a quantity: a requirement blocks an
 * operation or it does not. That rules out the two forms this figure is most
 * often drawn in. A Sankey would put its widest channel — the ribbon — on a
 * value that is always the same, and a stacked bar would answer „how many"
 * where the question is „which ones together".
 *
 * The two diagrams differ in one thing, and it is the thing worth showing:
 *
 * **The Venn keeps a place for every combination**, all seven of them, whether
 * the material produced one or not. Its three circles never move, so the reader
 * can point at a region and say „this combination does not occur" — and read a
 * nought there. That is a statement the picture can only make if the region is
 * on the page to begin with.
 *
 * **The Euler shows only the combinations that occur.** Where no requirement
 * blocks two operations at once, those two circles are drawn apart, and the
 * region simply is not there. What the reader gets instead of a nought is the
 * shape of the study: three separate circles say something a row of noughts
 * says only if you read it.
 *
 * Circles rather than the rectangles this began as. A rectangle holds a
 * requirement title and a circle's lens does not — but a lens has never had to,
 * because both figures carry counts and the titles are listed under the Euler
 * where there is room to set them whole. What the circles buy is that the
 * overlaps look like overlaps: three rectangles laid over a grid read as a
 * table with coloured borders no matter how they are spaced, and a reader who
 * has seen one Venn diagram in their life already knows how to read these.
 *
 * Where the circles cannot be honest, they say so by staying quiet. If all
 * three operations are blocked together by something, the three circles must
 * meet — and then every pair of them overlaps as well, whether that pair occurs
 * or not. Circles cannot avoid it. So a region that carries nothing carries no
 * label either in the Euler, and the Venn beside it is where the nought is
 * read.
 */

/* Which of the three columns and rows each zone is a cell of. The first
   operation holds the upper left two columns, the third the upper right two,
   and the second the whole lower band — so every one of the seven zones is a
   rectangle, which is the whole reason for rectangles. A circle spends its
   corners on nothing and its lenses are the one place on a page a sentence
   cannot go; a rectangle a reader can be given as much room as the titles in it
   need, because the figure is drawn to one width and grows downward, and
   downward is what a figure on a page has spare. */
const SET_GRID = [
  ["0", "02", "2"],
  ["01", "012", "12"],
];
const SET_FLOOR = "1";
const SET_ZONES = [...SET_GRID.flat(), SET_FLOOR];

/* How far each set's frame stands out from the cells it holds. Three different
   distances on purpose: given the same one, the first and second sets would
   begin at the same pixel on the left and the second and third would end at the
   same one on the right, which is how three sets come out as one bordered
   table. The widest set takes the smallest, so that the one spanning the whole
   band is drawn inside the other two rather than around them. */
const SET_BLEED = [14, 4, 9];

export function blockedVenn(rows, operations, departments, t) {
  /* The study's own three, in the study's own words and its own order — not the
     tool's. They were three names out of the interface dictionary here, which a
     catalog is free to rename and to add a fourth to: a study that had renamed
     „Ablage" saw the old word in this one figure and nowhere else, and a fourth
     operation was counted, silently and in print, among the requirements that
     hold up nothing. A wrong sentence about the material is worse than a
     missing figure, so a vocabulary this shape cannot hold is declined rather
     than approximated. Three rectangles are three sets; there is no fourth. */
  if (!rows.length || operations?.length !== 3) return null;
  const OPS = operations;

  const setOf = (row) => new Set(row.blockedOperations ?? []);
  // A zone is named by which of the three it holds, by position rather than by
  // word, so a renamed operation is still the same zone.
  const key = (set) => OPS.map((one, at) => (set.has(one.id) ? at : "")).join("");
  const bucket = new Map();
  for (const row of rows) {
    const k = key(setOf(row));
    if (!bucket.has(k)) bucket.set(k, []);
    /* How many departments name it travels with the title. It is not entered
       but counted from the coding units, which is what keeps it tied to the
       material — and it is the one thing about a requirement this figure could
       not say, because where a requirement stands says what it holds up and
       nothing about how widely it was asked for. */
    bucket.get(k).push({ title: row.title, named: row.departments ?? [] });
  }
  // Nothing is held up anywhere: the figure would be three empty frames, and
  // the sentence „no requirement holds up an operation" says it better.
  if ([...bucket.keys()].every((k) => !k)) return null;
  /* Numeric, so that a catalog which numbers its requirements does not read
     „Anforderung 13, 14, 2, 3" down a column. */
  for (const list of bucket.values()) {
    list.sort((a, b) => a.title.localeCompare(b.title, "de", { numeric: true }));
  }
  const held = (mask) => bucket.get(mask) ?? [];

  const EDGE = 10;
  const PAD = 18; // between a cell's writing and the cell's own bounds
  const SIZE = 9.5;
  const LINE = Math.round(SIZE * 1.32 * 10) / 10;
  const CARD = 5; // between a card's edge and the title written on it
  const GAP = 5; // between two cards
  const NAME = 11;
  const PLATE = 16; // the sheet a set's name is written on
  /* How far the pie beside a requirement reaches. Eleven, because this figure
     is printed across a hundred and sixty-two millimetres of text and eight came
     out as three and a half of them for five pieces — under what a printer can
     be relied on to hold. */
  const SLICE = 11;

  /* ── The cards ─────────────────────────────────────────────────────────────
     One frame per requirement rather than a stack of lines. Set as running
     text, four titles in a zone were four sentences with nothing between them
     but a gap, and where one of them wrapped there was no telling the wrap from
     the next title. A card also gives the writing the sheet to stand on, which
     is the one ground in this figure that is the same everywhere — the washes
     under it are one, two or three deep. */
  const MIN = 190;
  /* And what a card may grow to. One title in the band across the foot took the
     whole width of the sheet, which put its pie a hand's breadth from the words
     it belongs to. A card is a line of reading, not a measure of the room. */
  const MOST = 340;
  /* ── Who asked for it ─────────────────────────────────────────────────────
     A pie beside each requirement, cut into as many pieces as the study has
     departments and each piece in that department's own colour, filled where
     that department names the requirement. It says two things a number could
     only say one of: how many asked for it, and *which*. And the colours are
     not this figure's — they come from the same place every other figure takes
     them, so a piece here and a band in the citation figure below are the same
     department without anybody having to check.

     How many departments name a requirement is counted from the coding units
     and never entered, which is what keeps it tied to the material. It is also
     the one thing about a requirement this figure could not otherwise say:
     where a card stands says what the requirement holds up, and nothing at all
     about how widely it was asked for. */
  const series = seriesFrom(departments ?? [], t);
  const pie = (named, cx, cy) => {
    const wanted = new Set(named);
    const paints = (one) => one.sources.some((name) => wanted.has(name));
    if (!series.length) return "";
    if (series.length === 1) {
      return (
        `<circle class="op-slice ${paints(series[0]) ? series[0].className : "none"}"` +
        ` cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${SLICE}"></circle>`
      );
    }
    const step = (Math.PI * 2) / series.length;
    return series
      .map((one, index) => {
        // From twelve o'clock, the way a reader's eye already goes round.
        const from = -Math.PI / 2 + index * step;
        const to = from + step;
        const edge = (angle) =>
          `${(cx + SLICE * Math.cos(angle)).toFixed(1)} ${(cy + SLICE * Math.sin(angle)).toFixed(1)}`;
        return (
          `<path class="op-slice ${paints(one) ? one.className : "none"}"` +
          ` d="M${cx.toFixed(1)} ${cy.toFixed(1)}L${edge(from)}` +
          `A${SLICE} ${SLICE} 0 ${step > Math.PI ? 1 : 0} 1 ${edge(to)}Z"></path>`
        );
      })
      .join("");
  };
  const PIE = departments?.length ? 2 * SLICE + 5 : 0;
  // How deep a card of so many lines is: never less than the pie standing in it.
  const deep = (lines) => Math.max(lines * LINE, PIE ? 2 * SLICE : 0) + 2 * CARD;

  const laid = (titles, room) => {
    /* As many columns of cards as the room takes, and then as few as the cards
       fill: four columns for five titles leaves the fourth empty and a hand's
       width of white beside a list that looked like it needed the space. */
    const wanted = Math.max(1, Math.min(titles.length || 1, Math.floor(room / MIN)));
    const columns = titles.length
      ? Math.max(1, Math.ceil(titles.length / Math.ceil(titles.length / wanted)))
      : 1;
    const width = Math.min(MOST, (room - (columns - 1) * PAD) / columns);
    const pill = PIE;
    /* Twelve lines is not a limit, it is a backstop: the column is sized to the
       writing rather than the writing cut to the column, so a title is set
       whole and the row it stands in grows. A requirement standing half-written
       in an appendix is the one outcome this figure may not have. */
    const wrapped = titles.map((one) =>
      wrapLabel(one.title, { room: width - 2 * CARD - pill - 6, size: SIZE, maxLines: 12 }),
    );
    const perColumn = Math.ceil(titles.length / columns) || 1;
    let tallest = 0;
    for (let c = 0; c < columns; c += 1) {
      const mine = wrapped.slice(c * perColumn, (c + 1) * perColumn);
      tallest = Math.max(
        tallest,
        mine.reduce((sum, one) => sum + deep(one.lines.length) + GAP, 0) - GAP,
      );
    }
    return { columns, width, pill, wrapped, perColumn, titles, height: Math.max(0, tallest) };
  };

  const draw = (plan, x, y) => {
    let out = "";
    for (let c = 0; c < plan.columns; c += 1) {
      let top = y;
      for (const [k, label] of plan.wrapped
        .slice(c * plan.perColumn, (c + 1) * plan.perColumn)
        .entries()) {
        const tall = deep(label.lines.length);
        const at = x + c * (plan.width + PAD);
        const named = plan.titles[c * plan.perColumn + k].named;
        out +=
          `<rect class="op-card" x="${at.toFixed(1)}" y="${top.toFixed(1)}"` +
          ` width="${plan.width.toFixed(1)}" height="${tall.toFixed(1)}" rx="4"></rect>` +
          pie(named, at + plan.width - CARD - SLICE - 1, top + CARD + SLICE) +
          label.lines
            .map(
              (line, k) =>
                `<text class="op-item" x="${(at + CARD + 2).toFixed(1)}"` +
                ` y="${(top + CARD + SIZE * 0.86 + k * LINE).toFixed(1)}">${escape(line)}</text>`,
            )
            .join("");
        top += tall + GAP;
      }
    }
    return out;
  };

  /* ── The grid ──────────────────────────────────────────────────────────────
     Columns take room in proportion to the writing they hold. Equal thirds is
     what a grid does and it is wrong here: nine requirements in one zone and
     one apiece in the others would give the crowded column room for a single
     stack of cards and pad every other zone out to match.

     A column no drawn zone stands in is not merely empty — it is taken away,
     and the first and third sets stop overlapping. That is how this figure
     draws an Euler diagram: not by moving shapes around until the picture
     looks right, but by giving a combination that does not occur no room to
     occur in. The same for the middle row and the second set. */
  const grew = (titles) =>
    titles.reduce((sum, one) => sum + estimateWidth(one.title, { size: SIZE }) + MIN, 0);
  const x0 = EDGE + SET_BLEED[0];
  const x3 = WIDTH - EDGE - SET_BLEED[2];
  /* What the middle column costs when it is taken away: enough for the first
     set's frame to end and the third set's to begin with air between them. */
  const room = x3 - x0;
  const asked = [0, 1, 2].map((c) =>
    Math.max(1, grew(SET_GRID.flatMap((row) => held(row[c])))),
  );
  const total = asked.reduce((a, b) => a + b, 0) || 1;
  const NARROW = 0.29;
  const WIDE = 0.5;
  const share = asked.map((one) => (one ? Math.min(WIDE, Math.max(NARROW, one / total)) : 0));
  const spare = share.reduce((a, b) => a + b, 0) || 1;
  const colW = share.map((one) => (one / spare) * room);
  const colX = (i) => x0 + colW.slice(0, i).reduce((a, b) => a + b, 0);

  /* Where a zone's writing stands, across: its own cell, inset. The frames only
     ever reach *past* their cells, never short of them, so a card measured
     against the column it stands in cannot leave the frame it belongs to. */
  const acrossOf = (col, span) => ({
    x: colX(col) + PAD,
    room: (span ? colX(3) - colX(0) : colW[col]) - 2 * PAD,
  });

  const across = new Map();
  const plans = new Map();
  for (const [r, row] of SET_GRID.entries()) {
    for (const [c, mask] of row.entries()) {
      across.set(mask, acrossOf(c, false));
      plans.set(mask, laid(held(mask), across.get(mask).room));
    }
  }
  across.set(SET_FLOOR, acrossOf(0, true));
  plans.set(SET_FLOOR, laid(held(SET_FLOOR), across.get(SET_FLOOR).room));

  const rowH = [0, 1, 2].map((r) => {
    const masks = r === 2 ? [SET_FLOOR] : SET_GRID[r];
    const tall = Math.max(...masks.map((mask) => plans.get(mask).height));
    return Math.round(Math.max(tall, LINE + 2 * CARD) + 2 * PAD);
  });
  const y0 = EDGE + NAME + 10 + PLATE / 2 + 2 + SET_BLEED[0];
  const rowY = (r) => y0 + rowH.slice(0, r).reduce((a, b) => a + b, 0);

  const frames = [
    { at: 0, cols: [0, 2], rows: [0, 2] },
    { at: 1, cols: [0, 3], rows: [1, 3] },
    { at: 2, cols: [1, 3], rows: [0, 2] },
  ].map((one) => ({
    ...one,
    left: colX(one.cols[0]) - SET_BLEED[one.at],
    right: colX(one.cols[1]) + SET_BLEED[one.at],
    top: rowY(one.rows[0]) - SET_BLEED[one.at],
    bottom: rowY(one.rows[1]) + SET_BLEED[one.at],
  }));

  const boxOf = (one) =>
    `x="${one.left.toFixed(1)}" y="${one.top.toFixed(1)}"` +
    ` width="${(one.right - one.left).toFixed(1)}"` +
    ` height="${(one.bottom - one.top).toFixed(1)}" rx="16"`;

  /* ── The ground ────────────────────────────────────────────────────────────
     One wash per set, over its whole frame. Two and three of them lying over
     one another make the tone two and three make, so nothing has to be declared
     for the blends and the deepest area — the requirement that stops all three
     — comes out the darkest thing on the page on its own.

     This was painted zone by zone while there was an Euler diagram beside this
     one, because leaving a zone out is that figure's whole business and a wash
     belonging to a frame cannot be told to stop being a colour in one place.
     Zone by zone it had to be swept into axis-aligned patches, and a rounded
     corner is not axis-aligned: where a frame's corner curved away, a sliver
     was inside one set and outside the patch of every zone, and the page showed
     through as a black notch. A frame washing its own rounded rectangle has the
     corner exactly right because it is the same rectangle. */
  const ground = frames
    .map((one) => `<rect class="op-wash op-set-${one.at + 1}" ${boxOf(one)}></rect>`)
    .join("");

  const edges = frames
    .map((one) => `<rect class="op-edge op-set-${one.at + 1}" ${boxOf(one)}></rect>`)
    .join("");

  /* A set's name on its own frame, on a sheet the frame is interrupted by, at
     the end of the edge that belongs to that set alone. Written beside a frame
     it would be a caption that could belong to either of the two lines nearest
     it; written *on* one, with the stroke running into the word from both
     sides, it can belong to nothing else. */
  const named = frames
    .map((one) => {
      const right = one.at === 2;
      const foot = one.at === 1;
      const edge = foot ? one.bottom : one.top;
      const x = right ? one.right - 20 : one.left + 20;
      const wide = estimateWidth(OPS[one.at].name, { size: NAME }) + 16;
      return (
        `<rect class="op-plate op-set-${one.at + 1}" x="${(right ? x - wide + 8 : x - 8).toFixed(1)}"` +
        ` y="${(edge - PLATE / 2).toFixed(1)}" width="${wide.toFixed(1)}" height="${PLATE}" rx="3"></rect>` +
        `<text class="op-name" x="${x.toFixed(1)}" y="${(edge + NAME / 2 - 1).toFixed(1)}"` +
        ` text-anchor="${right ? "end" : "start"}">${escape(OPS[one.at].name)}</text>`
      );
    })
    .join("");

  // What a zone says: its count, and then the requirements themselves.
  const writing = SET_ZONES.map((mask) => {
      const floor = mask === SET_FLOOR;
      const r = floor ? 2 : SET_GRID.findIndex((row) => row.includes(mask));
      /* An area with nothing in it has to say so. Left blank it is the finding
         this figure exists for — that this combination does not occur in the
         material — and it reads as a slip of the pen instead. One word settles
         it. Set in the reading ink rather than a quiet one: an area may lie
         under three washes at once, where a grey does not reach the threshold,
         and the italic is what keeps it from looking like a requirement. */
      const room = across.get(mask);
      if (!held(mask).length) {
        return (
          `<text class="op-empty" x="${room.x.toFixed(1)}"` +
          ` y="${(rowY(r) + PAD + SIZE * 0.86).toFixed(1)}">${escape(t("blockedNone"))}</text>`
        );
      }
      return draw(plans.get(mask), room.x, rowY(r) + PAD);
    })
    .join("");

  /* ── The eighth zone ───────────────────────────────────────────────────────
     What lies in none of the three, which a diagram of three sets forgets. The
     frame the sets have always implicitly stood in is drawn, and the band
     inside it below them belongs to that zone as much as any overlap belongs to
     its two sets. It is also the one zone a reader can act on: a requirement
     whose absence stops nothing is either mis-judged or a candidate for the
     lowest level. */
  const free = held("");
  const seat = rowY(3) + SET_BLEED[1];
  const outsideTop = seat + PAD + 6;
  const plan = laid(free, WIDTH - 2 * (EDGE + PAD));
  const outside =
    `<text class="op-outside" x="${(EDGE + PAD).toFixed(1)}"` +
    ` y="${(outsideTop + NAME * 0.82).toFixed(1)}">${escape(t("blockedOutside"))}</text>` +
    (free.length ? draw(plan, EDGE + PAD, outsideTop + NAME + 9) : "");
  const floor = Math.round(outsideTop + NAME + 9 + plan.height + PAD);
  /* The frame the three sets have always implicitly stood in, and now the word
     for what it is. Drawn and unnamed it was a visible difference carrying no
     information — and it encloses the band of requirements that hold nothing up
     as well, so a reader is owed the sentence that it means the whole catalog
     rather than a fourth set. */
  const universe =
    `<rect class="op-universe" x="${EDGE}" y="${EDGE}"` +
    ` width="${(WIDTH - 2 * EDGE).toFixed(1)}" height="${(floor - EDGE).toFixed(1)}" rx="6"></rect>` +
    `<text class="op-whole" x="${(EDGE + PAD).toFixed(1)}"` +
    ` y="${(EDGE + NAME + 2).toFixed(1)}">${escape(t("blockedUniverse"))}</text>`;

  const counted = (one) => rows.filter((row) => setOf(row).has(one.id)).length;
  const naming = (mask) =>
    mask === "" ? t("blockedOutside") : [...mask].map((one) => OPS[Number(one)].name).join(" + ");
  return {
    id: "blocked",
    file: "blocked-operations.svg",
    title: t("chartVennTitle"),
    caption: t("chartVennCaption"),
    /* The departments in their own colours, because the pie beside each
       requirement is drawn in them — and the same colours the citation figure
       below uses, so the key is the same key twice rather than two keys. */
    legend: {
      inset: EDGE,
      grid: true,
      entries: [
        { label: t("blockedNamedBy") },
        ...series.map((one) => ({ paint: one.className, label: one.name })),
        /* Grey is the sixth thing in the pie and the only one a reader had to
           guess at: five colours were named and the piece that means „did not
           name it" was not. It runs onto a second line at this length, which is
           where it was going the moment a study had six departments. */
        { paint: "unnamed", label: t("blockedNotNaming") },
      ],
    },
    width: WIDTH,
    height: floor + EDGE,
    // The frame first, so the sets lie inside it rather than over it.
    body: universe + ground + edges + named + writing + outside,
    summary: t("summaryVenn", {
      total: rows.length,
      free: free.length,
      shown: SET_ZONES.filter((mask) => held(mask).length).length,
      operations: OPS.map((one) => `${one.name}: ${counted(one)}`).join(", "),
    }),
    figures: {
      caption: t("blockedFiguresCaption"),
      columns: [t("columnCombination"), t("columnRequirements")],
      rows: [...SET_ZONES, ""].map((mask) => [naming(mask), held(mask).length]),
    },
  };
}


export function coverageChart(rows, departments, t) {
  const withCitations = rows.filter((row) => row.citations.length);
  if (!withCitations.length || !departments.length) return null;
  return stackedBars({
    id: "coverage",
    file: "citations-per-requirement.svg",
    summaryKey: "summaryCoverage",
    figuresCaption: t("coverageFiguresCaption"),
    title: t("chartCoverageTitle"),
    caption: t("chartCoverageCaption"),
    departments,
    rows: withCitations.map((row) => ({
      name: row.title,
      child: false,
      values: departments.map(
        (department) =>
          row.citations.filter((citation) => citation.department === department).length,
      ),
      sum: row.citations.length,
    })),
    t,
  });
}

/* The role profiles -------------------------------------------------------- */

/**
 * Who speaks about whom.
 *
 * One bar per profile, split by the department whose interview the evidence
 * comes from. The question it answers is the one a role profile has to survive
 * before it may be used: is this a self-portrait, or did somebody else say it
 * too? A bar in a single colour is a department describing itself, and the two
 * departments that were never interviewed have bars in which their own colour
 * does not appear at all — which is the honest picture of what they are, and
 * exactly what the prose of the chapter cannot show.
 *
 * The same idiom as the coverage chart of the catalog, deliberately: both ask
 * how much of this comes from where, and a reader who has learnt the colours in
 * one figure keeps them in the other.
 */
export function voicesChart(rows, departments, t) {
  const spoken = rows.filter((row) => row.sum);
  if (!spoken.length || !departments.length) return null;
  return stackedBars({
    id: "voices",
    file: "role-voices.svg",
    summaryKey: "summaryVoices",
    figuresCaption: t("voicesFiguresCaption"),
    title: t("chartVoicesTitle"),
    caption: t("chartVoicesCaption"),
    departments,
    rows: spoken.map((row) => ({ name: row.name, child: false, values: row.values, sum: row.sum })),
    t,
  });
}

/**
 * What each pillar rests on.
 *
 * One bar per pillar, over all six profiles, split the same way. A profile is
 * five statements about a department, and read as prose all five carry the same
 * weight; here it comes out that they do not. The pillar with the shortest bar
 * is the one the design should lean on last — and if it is the pillar the
 * design leans on most, that is the finding this figure exists to force.
 */
export function pillarChart(rows, departments, t) {
  const filled = rows.filter((row) => row.sum);
  if (!filled.length || !departments.length) return null;
  return stackedBars({
    id: "pillars",
    file: "evidence-per-pillar.svg",
    summaryKey: "summaryPillars",
    figuresCaption: t("pillarFiguresCaption"),
    title: t("chartPillarTitle"),
    caption: t("chartPillarCaption"),
    departments,
    rows: filled.map((row) => ({ name: row.name, child: false, values: row.values, sum: row.sum })),
    t,
  });
}

/* Every figure by the name it is fetched under ----------------------------- */

/**
 * The figures the API offers, keyed by the file name they have always been
 * saved under. The name is part of the interface — `saturation.svg` is what
 * came out of the button long before there was an endpoint — so it stays the
 * name the endpoint answers to, and a report that fetches one gets the file it
 * would have got by hand.
 */
export const FIGURES = {
  "coding-units-per-category": {
    view: "analysis",
    titleKey: "chartTitle",
    emptyKey: "figureNeedsCodings",
    draw: ({ analysis, t }) => categoryChart(analysis, t),
  },
  "distribution-across-sections": {
    view: "analysis",
    titleKey: "heatmapTitle",
    emptyKey: "figureNeedsSections",
    draw: ({ analysis, t, measure }) => heatmapChart(analysis, t, { measure }),
  },
  saturation: {
    view: "analysis",
    titleKey: "chartSaturationTitle",
    emptyKey: "figureNeedsInterviews",
    draw: ({ analysis, t }) => saturationChart(analysis, t),
  },
  "moscow-distribution": {
    view: "catalog",
    titleKey: "chartMoscowTitle",
    emptyKey: "figureNeedsRequirements",
    draw: ({ catalog, t }) => moscowBand(catalog.requirements, t, { moscow: catalog.moscow }),
  },
  prioritization: {
    view: "catalog",
    titleKey: "chartPriorityTitle",
    emptyKey: "figureNeedsRequirements",
    draw: ({ catalog, t }) =>
      priorityField(catalog.requirements, t, {
        departmentCount: catalog.departments.length,
        operationCount: catalog.operationCount,
        moscow: catalog.moscow,
      }),
  },
  "citations-per-requirement": {
    view: "catalog",
    titleKey: "chartCoverageTitle",
    emptyKey: "figureNeedsCitations",
    draw: ({ catalog, t }) => coverageChart(catalog.requirements, catalog.departments, t),
  },
  "requirement-reach": {
    view: "catalog",
    /* The one figure drawn from both. It is a catalog figure — it belongs in
       that view and is about requirements — but its columns are the categories
       of the study, and it needs *all* the coded ones rather than only those
       some requirement already touches: a category no requirement reaches is
       the finding, and a column list built from the requirements alone could
       never contain it. */
    needs: ["catalog", "analysis"],
    titleKey: "chartReachTitle",
    emptyKey: "figureNeedsCitations",
    draw: ({ analysis, catalog, t }) =>
      reachChart(catalog.requirements, analysis.rows, t, { moscow: catalog.moscow }),
  },
  "blocked-operations": {
    view: "catalog",
    titleKey: "chartVennTitle",
    /* Its own condition rather than the shared one: „no requirements yet" is
       what a reader is told when there are thirteen of them and none blocks
       anything, or when the study weighs its requirements against four
       operations instead of three. Which condition is missing is the whole
       difference between a broken tool and a tool waiting for work. */
    emptyKey: "figureNeedsBlockade",
    draw: ({ catalog, t }) =>
      blockedVenn(catalog.requirements, catalog.operations, catalog.departments, t),
  },
  "catalog-city": {
    view: "catalog",
    /* The same matrix as the reach figure and drawn from the same two bodies of
       data, so it needs both for the same reason. It was on the screen and
       nowhere else: the one figure a script could not fetch, which made it the
       one figure a report had to screenshot. */
    needs: ["catalog", "analysis"],
    titleKey: "chartCityTitle",
    emptyKey: "figureNeedsCitations",
    draw: ({ analysis, catalog, t }) =>
      cityPlot(catalog.requirements, analysis.rows, t, { moscow: catalog.moscow }),
  },
  "role-voices": {
    view: "roles",
    titleKey: "chartVoicesTitle",
    emptyKey: "figureNeedsProfiles",
    draw: ({ roles, t }) => voicesChart(roles.voices, roles.departments, t),
  },
  "evidence-per-pillar": {
    view: "roles",
    titleKey: "chartPillarTitle",
    emptyKey: "figureNeedsProfiles",
    draw: ({ roles, t }) => pillarChart(roles.pillars, roles.departments, t),
  },
};

export const FIGURE_NAMES = Object.keys(FIGURES);

/* The standalone file ------------------------------------------------------ */

/**
 * The stylesheet a figure carries with it.
 *
 * The same rules as the chart section of `app.css`, with the custom properties
 * already resolved: a file that has left the application has no `:root` to ask.
 * Written out rather than derived from the page, because deriving means reading
 * a stylesheet through a parser, and a rule missed there comes out as a chart
 * drawn in black with nothing about the file looking wrong.
 *
 * The order matters in one place: a saturation point carries `point` and
 * `saturation-point` at equal specificity, so the accent has to come last, as
 * it does in `app.css`.
 */
export function stylesheet(theme = "light") {
  const c = THEMES[theme] ?? THEMES.light;
  const series = c.series
    .map(
      (colour, index) =>
        `.segment.series-s${index + 1}{fill:${colour}}` +
        `.part-swatch.series-s${index + 1}{fill:${colour}}` +
        `.bar-badge.series-s${index + 1}{stroke:${colour}}`,
    )
    .join("");
  const level = c.level.map((colour, index) => `.cell.level-${index + 1}{fill:${colour}}`).join("");
  /* Only the band still divides the levels by colour: it is one bar of five
     segments side by side, where a shape has no room to say anything. The marks
     that carry a level — the field, the reach dots, the walls of the city — are
     one paint and four shapes now, and the one exception is what has no level
     yet, which keeps its pale grey because it is not a level. */
  const bands =
    Object.entries(c.moscow)
      .map(([id, colour]) => `.moscow-band.moscow-${id}{fill:${colour}}`)
      .join("") +
    `.point,.reach,.face,.key-mark{fill:${c.moscowMark}}` +
    `.point.moscow-open,.reach.moscow-open,.face.moscow-open,.key-mark.moscow-open` +
    `{fill:${c.moscow.open}}`;
  const swatches = [
    ...c.series.map((colour, index) => `.key-series-s${index + 1}{fill:${colour}}`),
    ...c.level.map((colour, index) => `.key-level-${index + 1}{fill:${colour}}`),
    // The band's key, which is a key of colours and the only one left.
    ...Object.entries(c.moscow).map(([id, colour]) => `.key-moscow-${id}{fill:${colour}}`),
  ].join("");
  return (
    /* What the picture inherits. Every piece of writing in a chart carries its
       own size and face, so this changes nothing anybody can see — but a page
       and a file that agree element for element are checkable, and one that is
       15px because the page is and one that is 16px because a viewer's default
       is are not. `tests/svg-export.spec.js` compares the two, and this is the
       line that keeps the comparison about paint rather than about defaults. */
    `svg{font-family:${FONTS.sans};font-size:15px}` +
    `.grid{stroke:${c.line}}` +
    `.baseline{stroke:${c.lineStrong}}` +
    `.axis{fill:${c.inkSoft};font-size:10px;font-family:${FONTS.sans}}` +
    `.axis.unmet{fill:${c.inkFaint}}` +
    `.reach{stroke:${c.sheet};stroke-width:1}` +
    `.reach-sole{fill:none;stroke:${c.inkSoft};stroke-width:1}` +
    `.floor{stroke:${c.line}}` +
    /* The two set diagrams of the blocked operations. One circle per operation,
       each washed in its own hue at a weight that lets two and three of them lie
       over one another and still be written on: the overlaps darken by
       themselves, which is what makes a Venn diagram legible without a key, and
       the deepest of them — the requirement that stops all three — comes out
       the darkest thing on the page, which is the reading this catalog most
       needs. Blue, green and amber, the three of the series that stay apart
       from one another when they are laid over each other. */
    `.op-wash{fill-opacity:${theme === "dark" ? ".3" : ".22"};stroke:none}` +
    `.op-edge{fill:none;stroke-width:1.4}` +
    /* Named on both classes rather than on the set alone. A set's colour is a
       fill on its wash and a stroke on its rim, and written as one rule for the
       set it also filled the rim: the same weight as `.op-edge{fill:none}` and
       later in the sheet, so three hairline circles came out as three solid
       discs, each hiding the one drawn before it. */
    [0, 2, 3]
      .flatMap((series, at) => [
        `.op-wash.op-set-${at + 1}{fill:${c.series[series]}}`,
        `.op-edge.op-set-${at + 1}{stroke:${c.series[series]}}`,
      ])
      .join("") +
    `.op-name{fill:${c.ink};font-size:11px;font-weight:600;font-family:${FONTS.sans};` +
      `letter-spacing:.02em}` +
    /* The count of a region, in figures, because it is a number and the reader
       is about to write it down. Full ink: it stands on three washes laid over
       one another as well, where a quiet grey does not reach the threshold. */
    /* The badge on a card: how many departments name that requirement. Counted
       from the coding units and not entered, which is what keeps it tied to the
       material — and the one thing about a requirement this figure could not
       otherwise say, because where a card stands says what it holds up and
       nothing about how widely it was asked for. A nought is a requirement no
       citation carries yet, so it is drawn as the absence it is rather than as
       a value: the pill steps back to a hairline and the figure to the quiet
       ink this tool keeps for „nothing is here". */
    `.op-slice{stroke:${c.sheet};stroke-width:.6}` +
    /* A piece nobody filled still has to be counted, because the pieces
       together are how many departments the study has. A hairline alone came to
       a tenth of a millimetre where this figure is printed, which no press
       holds, so it is a fill with an outline over it: the grey carries the
       piece at any size and the line only sharpens its edge. The ink kept for „nothing is here“ rather than in a rule colour,
       which came to 1.7 against the card and could not be made out. */
    `.op-slice.none{fill:${c.line};stroke:${c.inkFaint};stroke-width:.6}` +
    `.op-empty{fill:${c.ink};font-size:9.5px;font-style:italic;font-family:${FONTS.sans}}` +
    `.op-whole{fill:${c.inkSoft};font-size:10px;font-family:${FONTS.sans};letter-spacing:.04em}` +
    c.series.map((colour, index) => `.op-slice.series-s${index + 1}{fill:${colour}}`).join("") +
    /* One card per requirement. Set as running text, four titles in a zone were
       four sentences with nothing between them but a gap, and a title that
       wrapped could not be told from the next one. The card also gives the
       writing the one ground in this figure that is the same everywhere — the
       washes under it are one, two or three deep. */
    `.op-card{fill:${c.sheet};stroke:${c.line};stroke-width:1}` +
    /* The sheet a set's name is written on, so its frame breaks for the word
       rather than running under it. */
    `.op-plate{fill:${c.sheet};stroke-width:1.4}` +
    /* The frame every Venn diagram implicitly stands in, drawn because what
       lies in none of the three has to lie somewhere. Dashed and quiet: it is
       the edge of what was looked at, not a set of its own. */
    `.op-universe{fill:none;stroke:${c.line};stroke-width:1;stroke-dasharray:3 4}` +
    `.op-item{fill:${c.ink};font-size:9.5px;font-family:${FONTS.sans}}` +
    `.op-outside{fill:${c.inkSoft};font-size:10.5px;font-weight:600;font-family:${FONTS.sans}}` +
    `.face{stroke:${c.sheet};stroke-width:.6}` +
    `.face.left{opacity:.88}.face.right{opacity:.74}` +
    /* The roof of the one building that answers its category alone. Out of the
       warm end of the series palette, which nothing else in this figure uses:
       any of the greens would be read as a MoSCoW level, and the level is what
       the walls under the roof are still saying. */
    `.face.sole-roof{fill:${c.series[1]}}` +
    `.key-sole-roof{fill:${c.series[1]}}` +
    `.key-unnamed{fill:${c.line}}` +
    `.axis-title{fill:${c.inkSoft};font-size:10px;font-family:${FONTS.sans};letter-spacing:.04em}` +
    `.row-label{fill:${c.ink};font-size:11.5px;font-family:${FONTS.sans}}` +
    `.row-label.child{fill:${c.inkSoft}}` +
    `.value{fill:${c.inkSoft};font-size:10.5px;font-family:${FONTS.mono}}` +
    `.value.empty{fill:${c.inkFaint}}` +
    `.bar-badge{fill:${c.sheet};stroke-width:1.5}` +
    `.bar-value{fill:${c.ink};font-size:10px;font-family:${FONTS.mono}}` +
    series +
    level +
    `.cell-empty{fill:none;stroke:${c.line}}` +
    `.cell-value{fill:${c.ink};font-size:10px;font-family:${FONTS.mono}}` +
    `.cell-value.inverse{fill:${c.sheet}}` +
    bands +
    `.band-value{fill:${c.sheet};font-size:10px;font-family:${FONTS.mono}}` +
    `.band-value.dim{fill:${c.ink}}` +
    `.point{stroke:${c.sheet};stroke-width:1.5}` +
    `.saturation-line{stroke:${c.accent};stroke-width:2;stroke-linejoin:round;fill:none}` +
    `.saturation-point{fill:${c.accent}}` +
    `.key-label{fill:${c.ink};font-size:10px;font-family:${FONTS.sans}}` +
    `.key-ring{fill:none;stroke:${c.inkSoft};stroke-width:1.4}` +
    // Neutral: the size says one thing and the colour says another, and a
    // coloured scale dot would be read as a level.
    `.key-dot{fill:${c.inkSoft}}` +
    swatches
  );
}

/**
 * The key, drawn into the picture, and how much room it took.
 *
 * On screen the key is HTML above the figure — so a file without it is a chart
 * of unnamed colours, which is not a figure anybody can put in a paper. It is
 * laid out here in the order it stands on screen and set above the drawing,
 * which moves down to make room.
 */
function drawKey(legend, width, measure) {
  if (!legend?.entries?.length) return { markup: "", height: 0 };
  const SIZE = 9;
  const GAP = 14;
  const LINE = 18;
  /* Fitting, not reserving: the key is laid out into a line of known width, so
     an estimate that runs wide breaks a line that had room left. */
  const widthOf = (text) =>
    text
      ? Math.ceil(
          measure ? measure(text, { size: 10 }) : estimateWidth(text, { size: 10, tight: true }),
        )
      : 0;

  /* A ramp is one continuous scale, so it reads as its two ends with the steps
     between them, rather than as five things with five names. */
  const entries =
    legend.kind === "ramp"
      ? [
          { label: String(legend.from) },
          ...legend.entries.map((entry) => ({ paint: entry.paint, label: "" })),
          { label: String(legend.to) },
          { label: legend.note ?? "" },
        ]
      : legend.entries;

  // A dot is drawn at the size it stands for, so it takes the room that size
  // needs rather than a swatch's.
  const markOf = (entry) =>
    entry.shape === "dot"
      ? Math.ceil(entry.radius * 2) + 5
      : entry.paint || entry.shape
        ? SIZE + 5
        : 0;
  const boxOf = (entry) => markOf(entry) + widthOf(entry.label ?? "");

  /* What must not be broken across two lines.
     „Punktgröße in Belegen:" and the two dots after it are one statement, and
     the line broke between them: the small dot sat at the right edge of the
     first line and the large one alone at the left of the second, which reads
     as two scales rather than as one — and reads as a mistake, which it was.
     An entry can say it belongs with the one before it, and the run is measured
     and wrapped whole. */
  const runs = [];
  for (const entry of entries) {
    if (entry.keepWith && runs.length) runs[runs.length - 1].push(entry);
    else runs.push([entry]);
  }

  /* Where the key's own left edge is. Nought for a figure whose picture also
     begins at nought — the band of MoSCoW levels does — and the picture's own
     margin for one that has one. Flush at nought under a picture inset by ten,
     the key hung out past the text block of the page it was printed on and read
     as a bleed rather than as a key. */
  const inset = legend.inset ?? 0;
  let markup = "";
  let x = inset;
  let y = 12;

  /* Two ways of setting the entries out.
     Flowed, which is what a key of two or three things wants: each stands where
     the one before it ended, and the line breaks when the next will not fit.
     Ruled, which is what a key of six wants: six ran to two lines and the
     swatches in the second line stood wherever the words in the first happened
     to end, so the eye had no column to come down. Ruled, every entry gets the
     width of the widest and the swatches stand under one another — and a study
     that gains a department gains a cell rather than a new arrangement.

     A word on its own keeps its own line either way. It is a sentence about the
     key rather than one of its entries, and set into a cell it would either be
     cut to the width of a swatch and a name or make every cell as wide as
     itself. */
  if (legend.grid) {
    /* Reckoned rather than measured, even where a measurer was handed in: the
       page works the same arithmetic out for itself and the two have to land on
       the same number of columns, or a study sees one arrangement on the screen
       and another one in print. */
    const reckon = (text) => (text ? Math.ceil(estimateWidth(text, { size: 10, tight: true })) : 0);
    const spans = (run) => run.reduce((sum, entry) => sum + markOf(entry) + reckon(entry.label), 0);
    const marked = runs.filter((run) => run.some((entry) => markOf(entry)));
    const notes = runs.filter((run) => !run.some((entry) => markOf(entry)));
    const cell = Math.max(1, ...marked.map(spans));
    // The word about the key stands to the left of the columns, not above them.
    const head = notes.length ? Math.max(...notes.map(spans)) + 2 * GAP : 0;
    const left = inset + head;
    /* Four at the most, however many would fit. A key is read across, and past
       four the names stand shoulder to shoulder with no air between them; four
       is also what leaves room for the longest a department is called. Fewer
       when fewer fit, so a narrow figure still breaks sensibly. */
    const across = Math.max(
      1,
      Math.min(4, Math.floor((width - inset - left + GAP) / (cell + GAP))),
    );
    for (const run of notes) {
      x = inset;
      for (const entry of run) draw(entry);
    }
    let at = 0;
    for (const run of marked) {
      x = left + (at % across) * (cell + GAP);
      y = 12 + Math.floor(at / across) * LINE;
      for (const entry of run) draw(entry);
      at += 1;
    }
    y = 12 + Math.max(0, Math.ceil(at / across) - 1) * LINE;
  } else {
    for (const run of runs) {
      const total = run.reduce((sum, entry) => sum + boxOf(entry) + GAP, 0) - GAP;
      if (x > inset && x + total > width - inset) {
        x = inset;
        y += LINE;
      }
      for (const entry of run) draw(entry);
    }
  }

  function draw(entry) {
    const label = entry.label ?? "";
    const mark = markOf(entry);
    const box = mark + widthOf(label);
    if (!box) return;
    if (entry.shape === "dot") {
      markup +=
        `<circle class="key-dot" cx="${(x + entry.radius).toFixed(2)}"` +
        ` cy="${y - SIZE / 2 + 1}" r="${entry.radius.toFixed(2)}"></circle>`;
      x += mark;
    } else if (entry.shape === "level") {
      // The level's own shape, at the size a swatch has. A key of squares beside
      // four names would be a key of colours again, and there are none left.
      markup += moscowMark(entry.level, {
        cx: x + SIZE / 2,
        cy: y - SIZE / 2 + 1,
        r: SIZE / 2,
        className: "key-mark",
      });
      x += SIZE + 5;
    } else if (entry.shape === "ring") {
      markup +=
        `<circle class="key-ring" cx="${x + SIZE / 2}" cy="${y - SIZE / 2 + 1}"` +
        ` r="${SIZE / 2}"></circle>`;
      x += SIZE + 5;

    } else if (entry.paint) {
      markup +=
        `<rect class="key-${entry.paint}" x="${x}" y="${y - SIZE + 1}" width="${SIZE}"` +
        ` height="${SIZE}" rx="2"></rect>`;
      x += SIZE + 5;
    }
    if (label) {
      markup += `<text class="key-label" x="${x}" y="${y}">${escape(label)}</text>`;
      x += widthOf(label);
    }
    x += GAP;
  }
  return { markup, height: y + 8 };
}

/**
 * One figure as a file that stands on its own.
 *
 * Colours resolved, fonts carried, key drawn in, a ground laid down so it is
 * readable against whatever it is dropped onto, and nothing fetched from
 * anywhere. The body is the very same markup the page shows; only the paint
 * around it is different, and that is the whole point of the arrangement.
 */
export function standalone(spec, { theme = "light", measure, height } = {}) {
  const colours = THEMES[theme] ?? THEMES.light;
  const tall = height ?? spec.height;
  const key = drawKey(spec.legend, spec.width, measure);
  /* Classed, and not only identified. The heatmap sets a `title` inside every
     angled heading, so a bare `title` at the top of the file is a second thing
     of the same name in the same document — and the check that compares the
     file against the page element by element would be comparing the document's
     title against a column heading. The same goes for the ground. */
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${tall + key.height}"` +
    ` width="${spec.width}" height="${tall + key.height}" role="img" aria-labelledby="title desc">` +
    `<title id="title" class="figure-title">${escape(spec.title)}</title>` +
    `<desc id="desc" class="figure-summary">${escape(spec.summary)}</desc>` +
    `<style>${stylesheet(theme)}</style>` +
    `<rect class="ground" width="100%" height="100%" fill="${colours.sheet}"></rect>` +
    key.markup +
    `<g transform="translate(0 ${key.height})">${spec.body}</g>` +
    `</svg>`
  );
}
