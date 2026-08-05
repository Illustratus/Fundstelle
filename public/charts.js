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

/**
 * What a number written on a colour has to be, to be readable on it.
 *
 * Derived from the palette rather than written down beside it, because a table
 * of eight colours next to a table of eight colours is a table that goes wrong
 * the first time one of them is adjusted. Black or white and nothing between:
 * the tool's own ink and paper are near-black and white but not quite, and on
 * the blue of the first series that near-miss costs 4.00 against a threshold of
 * 4.5 — the whole difference between passing and failing. On the eight series
 * colours, in both themes, the better of the two always clears 4.5.
 *
 * The same values are written into `app.css` as `--on-1 … --on-8`, and
 * `tests/svg-export.spec.js` compares the page against the saved file element
 * by element, so the two cannot part company quietly.
 */
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const channel = (value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

export const readableOn = (colour) => (luminance(colour) > 0.179 ? "#000000" : "#ffffff");

const MOSCOW_ORDER = ["must", "should", "could", "wont"];

export const moscowClass = (level) =>
  `moscow-${MOSCOW_ORDER.includes(level) ? level : "open"}`;

export function escape(text) {
  return String(text).replace(
    /[&<>"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
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
  const VALUE = 34;
  const BAR = 14;
  const TOP = 6;
  const track = WIDTH - LABEL - VALUE - 8;
  const scale = (value) => (value / end) * track;

  /**
   * One type size for every row label, chosen from the longest of them.
   *
   * The largest size at which every name fits in two lines, tried in order. All
   * of them together and not each on its own: labels of a chart are a column,
   * and a column set in four sizes is not read as a column. So the longest name
   * decides, and the rest are set to match — which is also why a study whose
   * categories are all short still gets the size the chart was drawn for.
   *
   * Two lines and not three, because the size and the height are the same
   * decision seen twice: a long name kept at full size takes three lines, and
   * three lines make a row twice as tall in every row of the chart, including
   * the ones whose name is one word. A step smaller costs a little legibility
   * in the label and buys it back in the shape of the whole figure. The third
   * line is the floor under that, at the smallest size, before an ellipsis.
   */
  const SIZES = [11.5, 10.5, 9.5, 8.5, 7.5];
  const WANTED_LINES = 2;
  const MAX_LINES = 3;
  const room = LABEL - 12;
  const names = rows.map((row) => (row.child ? "… " : "") + row.name);
  let size = SIZES.at(-1);
  let labels = names.map((name) => wrapLabel(name, { room, size, maxLines: MAX_LINES }));
  for (const candidate of SIZES) {
    const tried = names.map((name) =>
      wrapLabel(name, { room, size: candidate, maxLines: WANTED_LINES }),
    );
    if (!tried.some((one) => one.truncated)) {
      size = candidate;
      labels = tried;
      break;
    }
  }
  const LINE = Math.round(size * 1.2 * 10) / 10;
  const tallest = Math.max(1, ...labels.map((one) => one.lines.length));
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
          const part =
            `<path class="segment ${series[k].className}" d="${segmentPath(x, y, width, BAR, k === last)}"` +
            ` data-department="${escape(series[k].name)}" data-row="${escape(row.name)}"` +
            ` data-value="${value}" data-tip="${escape(`${row.name} — ${series[k].name}: ${value}`)}"></path>` +
            /* The part's own number, in the part. Which department contributed
               how much was only readable by hovering, and a hover answers one
               person with a mouse — not the reader of a printed figure, not a
               screen reader, not the saved file.

               Only where it fits. A segment narrower than its own number would
               either have the digits hang over the neighbouring colour or be
               cut in half, and both are worse than the tooltip that is still
               there. The room is reckoned in the units the drawing counts in,
               against the mono face the number is set in — no measuring, so
               the same figure comes out of the browser and out of the API. */
            (width >= String(value).length * 6.2 + 8
              ? `<text class="bar-value ${series[k].className}" x="${x + width / 2}"` +
                ` y="${y + BAR / 2 + 3.5}" text-anchor="middle">${value}</text>`
              : "");
          x += full;
          return part;
        })
        .join("");
      /* Centred on the bar, not sitting on its baseline: one line looks the
         same either way, and three lines hung from the baseline would have the
         name climbing away from the row it belongs to. */
      const { lines } = labels[index];
      const first = y + BAR / 2 - ((lines.length - 1) * LINE) / 2 + size * 0.35;
      const label =
        `<text class="row-label${row.child ? " child" : ""}" x="${LABEL - 8}" y="${first}"` +
        ` text-anchor="end" style="font-size:${size}px">` +
        lines
          .map(
            (line, k) =>
              `<tspan x="${LABEL - 8}"${k ? ` dy="${LINE}"` : ""}>${escape(line)}</tspan>`,
          )
          .join("") +
        `</text>`;

      return (
        label +
        segments +
        `<text class="value${row.sum ? "" : " empty"}" x="${x + 6}" y="${y + BAR - 3}">${row.sum}</text>`
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
  const CELL = 22;
  const track = WIDTH - LABEL - 8;
  const width = track / sections.length;

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
      const label = (row.parent ? "… " : "") + row.name;
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
        `<text class="row-label${row.parent ? " child" : ""}" x="${LABEL - 8}" y="${y + CELL / 2 + 4}" text-anchor="end">${escape(shorten(label))}</text>` +
        line
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
        `.bar-value.series-s${index + 1}{fill:${readableOn(colour)}}`,
    )
    .join("");
  const level = c.level.map((colour, index) => `.cell.level-${index + 1}{fill:${colour}}`).join("");
  const bands = Object.entries(c.moscow)
    .map(([id, colour]) => `.moscow-band.moscow-${id}{fill:${colour}}.point.moscow-${id}{fill:${colour}}`)
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
    `.axis-title{fill:${c.inkSoft};font-size:10px;font-family:${FONTS.sans};letter-spacing:.04em}` +
    `.row-label{fill:${c.ink};font-size:11.5px;font-family:${FONTS.sans}}` +
    `.row-label.child{fill:${c.inkSoft}}` +
    `.value{fill:${c.inkSoft};font-size:10.5px;font-family:${FONTS.mono}}` +
    `.value.empty{fill:${c.inkFaint}}` +
    `.bar-value{font-size:10px;font-family:${FONTS.mono}}` +
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
