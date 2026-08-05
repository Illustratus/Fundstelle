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
  let size = sizes.at(-1);
  let labels = names.map((name) => wrapLabel(name, { room, size, maxLines: max }));
  for (const candidate of sizes) {
    const tried = names.map((name) => wrapLabel(name, { room, size: candidate, maxLines: wanted }));
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
  const fits = (one) => estimateWidth(one, { size }) <= room;
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
export function estimateWidth(text, { size = 10, mono = false } = {}) {
  return String(text).length * size * (mono ? 0.62 : 0.58);
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

  const names = rows.map((row) => (row.child ? "… " : "") + row.name);
  const { size, line: LINE, labels, tallest } = labelColumn(names, { room: LABEL - 12 });
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
        x: LABEL - 8,
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
     measure, estimated where nobody can — and the estimate runs wide, because
     a foot a little too deep is white space and a foot too shallow is a
     heading with its tail cut off. */
  const reach = Math.max(
    ...headings.map((heading) =>
      measure ? measure(heading, { size: 10 }) : estimateWidth(heading, { size: 10 }),
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
  const TOP = 16;
  const BOTTOM = 42;
  const maxX = Math.max(1, departmentCount);
  const maxY = operationCount;

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
  // One slot for the widest dot in the chart plus a gap, so the packing is the
  // same everywhere and two piles can be compared by eye.
  const slot = radius(maxCitations) * 2 + 3;

  /* The right-hand margin has to hold whatever sits on the last gridline, and
     that is the common case rather than the exception: a requirement every
     department named lands exactly there. The margin and the step depend on
     each other — a pile may be no wider than its own cell — so they are settled
     by running the layout twice, which is enough to converge. */
  let RIGHT = Math.ceil(10 + radius(maxCitations));
  let stepX = (WIDTH - LEFT - RIGHT) / maxX;
  let placed = new Map();
  for (let pass = 0; pass < 2; pass += 1) {
    stepX = (WIDTH - LEFT - RIGHT) / maxX;
    placed = new Map(
      [...buckets].map(([key, bucket]) => [key, layoutBucket(bucket.length, { slot, stepX })]),
    );
    const onLastLine = [...buckets.keys()].filter((key) => Number(key.split("|")[0]) === maxX);
    const reach = Math.max(0, ...onLastLine.map((key) => placed.get(key).width / 2));
    RIGHT = Math.ceil(10 + radius(maxCitations) + reach);
  }

  // A pile that wrapped into rows needs the room to do it in; the cell grows
  // rather than the dots being drawn on top of each other.
  const tallest = Math.max(0, ...[...placed.values()].map((one) => one.height));
  const CELL = Math.max(46, Math.ceil(tallest + 8));
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
        return (
          `<circle class="point ${moscowClass(entry.row.moscow)}" cx="${cx}" cy="${cy}"` +
          ` r="${radius(entry.row.citations.length)}" data-tip="${escape(tip)}"></circle>`
        );
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
    legend: {
      kind: "moscow",
      entries: [...MOSCOW_ORDER, "open"].map((level) => ({
        paint: moscowClass(level),
        label: level === "open" ? t("open") : nameOf(level),
      })),
    },
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
  let columns = categories.filter((one) => one.sum > 0);
  let withCitations = rows.filter((row) => row.citations.length);
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
   * The order, which is the whole difference between a picture of the links and
   * a picture of the structure.
   *
   * A matrix says what it has in it whatever order its rows and columns are in,
   * and shows *shape* only in one of them. Left in catalog order the figure was
   * a scatter of correct dots in which nothing was legible at a glance: which
   * requirements carry a lot of the study and which touch one corner of it, and
   * which of them keep turning up in the same company.
   *
   * Two sorts, and they have to be done in this order.
   *
   * Rows by how many categories they reach, widest first. That alone is the
   * reading somebody wants from this figure — the top of it is what a study
   * turns on, the bottom is what is local — and it is the input to how much a
   * requirement is worth, which is a judgement the tool must not make but should
   * put the material for in front of whoever does.
   *
   * Then columns by where their topmost dot is, and by how many they hold. Now
   * that the rows are ordered, that is the cheapest seriation there is, and it
   * is enough: categories a broad requirement carries move left, the ones only
   * one narrow requirement speaks to fall to the right, and requirements sharing
   * categories end up in the same block instead of scattered across the width.
   * The result reads as a staircase, and a break in the staircase is a group.
   *
   * The cost is that the columns are no longer in the order of the category
   * system. That order is meaningful elsewhere and is not what this figure is
   * about; the caption says so, and every name is written out.
   */
  withCitations = [...withCitations].sort(
    (a, b) =>
      links(b) - links(a) ||
      b.citations.length - a.citations.length ||
      a.title.localeCompare(b.title, "de"),
  );
  const topmost = (column) =>
    withCitations.findIndex((row) => counts.has(`${row.id}|${column.category}`));
  columns = [...columns].sort((a, b) => {
    const first = topmost(a) < 0 ? withCitations.length : topmost(a);
    const other = topmost(b) < 0 ? withCitations.length : topmost(b);
    return first - other || answers(b) - answers(a) || a.name.localeCompare(b.name, "de");
  });

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

  // A dot says how many citations tie the two together, by area rather than by
  // width: area is what the eye compares when it compares circles.
  const radius = (n) => 3.2 + Math.sqrt(n / max) * 4.3;

  /* The headings run at an angle into the space under the row labels, as the
     heatmap's do — a column the width of a thumbnail holds no category name
     upright, and a name cut to eight characters is legible only on hover, which
     is no help on paper or in the saved file. */
  const ANGLE = 45;
  const RADIANS = (ANGLE * Math.PI) / 180;
  const grid = TOP + withCitations.length * CELL;
  const room = LABEL + width / 2 - 6;
  const maxCharacters = Math.max(8, Math.min(34, Math.floor(room / Math.cos(RADIANS) / 5.1)));
  const headings = columns.map((one) => shorten(one.name, maxCharacters));
  const reach = Math.max(...headings.map((one) => estimateWidth(one, { size: 10 })));
  const FOOT = Math.ceil(reach * Math.sin(RADIANS)) + 12;
  const height = grid + TALLY + FOOT;

  const perCategory = columns.map(answers);

  const heads = columns
    .map((one, k) => {
      const x = LABEL + k * width + width / 2;
      const y = grid + TALLY + 8;
      return (
        `<text class="axis heading${perCategory[k] ? "" : " unmet"}" x="${x}" y="${y}"` +
        ` text-anchor="end" transform="rotate(-${ANGLE} ${x} ${y})">` +
        `<title>${escape(one.name)}</title>${escape(headings[k])}</text>`
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
      const level = moscowClass(row.moscow);
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
            // The ring first, so the dot sits on top of it rather than inside it.
            (only
              ? `<circle class="reach-sole" cx="${cx}" cy="${middle}" r="${(r + 2.6).toFixed(2)}"></circle>`
              : "") +
            `<circle class="reach ${level}" cx="${cx}" cy="${middle}"` +
            ` r="${r.toFixed(2)}" data-row="${escape(row.title)}"` +
            ` data-category="${escape(one.name)}" data-value="${n}"` +
            ` data-sole="${only}" data-tip="${escape(tip)}"></circle>`
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
  // Sorted widest first, so the first row is the answer to "which requirement
  // carries the most of this study".
  const widest = { title: withCitations[0].title, touched: links(withCitations[0]) };
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
      entries: [...MOSCOW_ORDER, "open"].map((id) => ({
        paint: moscowClass(id),
        label: id === "open" ? t("open") : nameOf(id),
      })),
    },
    summary: t("summaryReach", {
      rows: withCitations.length,
      categories: columns.length,
      top: widest.title,
      touched: widest.touched,
      narrow: withCitations.filter((row) => links(row) === 1).length,
      only: onlyOne,
      unmet,
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
  const bands = Object.entries(c.moscow)
    .map(
      ([id, colour]) =>
        `.moscow-band.moscow-${id}{fill:${colour}}` +
        `.point.moscow-${id}{fill:${colour}}` +
        `.reach.moscow-${id}{fill:${colour}}`,
    )
    .join("");
  const swatches = [
    ...c.series.map((colour, index) => `.key-series-s${index + 1}{fill:${colour}}`),
    ...c.level.map((colour, index) => `.key-level-${index + 1}{fill:${colour}}`),
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
  const widthOf = (text) =>
    text ? Math.ceil(measure ? measure(text, { size: 10 }) : estimateWidth(text, { size: 10 })) : 0;

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

  let markup = "";
  let x = 0;
  let y = 12;
  for (const entry of entries) {
    const label = entry.label ?? "";
    const box = (entry.paint ? SIZE + 5 : 0) + widthOf(label);
    if (!box) continue;
    if (x && x + box > width) {
      x = 0;
      y += LINE;
    }
    if (entry.paint) {
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
