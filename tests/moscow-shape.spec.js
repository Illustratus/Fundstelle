import { expect, test } from "@playwright/test";

import { cityPlot, moscowBand, priorityField, reachChart, standalone, stylesheet } from "../public/charts.js";

/**
 * A MoSCoW level is a shape, and the shape counts.
 *
 * It was four shades of one green, and four shades of one green is four things
 * nobody can tell apart at the size a mark is drawn: across a field of dots
 * „Should have" and „Could have" are the same colour, and a reader who has to
 * go back to the key for every mark is reading a key rather than a figure.
 *
 * So the level is a form, and the form says which level it is without being
 * looked up: a level has as many edges as it has steps to go — „Must have"
 * four, „Should have" three, „Could have" two, „Won't have" one. A square, a
 * triangle, an ellipse, a circle. In the city, where a mark is a body and not a
 * shape, the same count is the ground plan it stands on.
 *
 * What has no level yet is not a fifth level: it stays a circle in the pale
 * grey it always had, because it is the absence of a decision.
 *
 * These are the rules of the encoding, and they are checked here rather than in
 * the spec of any one figure: three figures say the same thing, and a change
 * that quietly stops one of them from saying it is exactly what a reader would
 * take a long time to notice.
 */

const LEVELS = ["must", "should", "could", "wont"];
const t = (key, values) => `${key}${values?.n ? `:${values.n}` : ""}`;
const moscow = LEVELS.map((id) => ({ id, name: id }));

const categories = ["c0", "c1"].map((category, index) => ({
  id: category,
  category,
  name: `Kategorie ${index + 1}`,
  sum: 6,
}));

/** One requirement per level, plus one nobody has decided about. */
const rows = [...LEVELS, undefined].map((level, index) => ({
  id: `r${index}`,
  title: `Anforderung ${index + 1}`,
  moscow: level,
  departments: ["Marketing", "Vertrieb"].slice(0, (index % 2) + 1),
  blockedOperations: ["filing"].slice(0, index % 2),
  citations: [{ category: "c0" }, { category: "c1" }, { category: "c1" }],
}));

/** Every mark of a figure, by the level it carries. */
function marksOf(body, className) {
  const found = new Map();
  for (const one of body.matchAll(
    new RegExp(`<(\\w+) class="${className} moscow-(\\w+)"([^>]*)>`, "g"),
  )) {
    found.set(one[2], { element: one[1], attributes: one[3] });
  }
  return found;
}

const SHAPES = {
  must: "rect",
  should: "polygon",
  could: "ellipse",
  wont: "circle",
  open: "circle",
};

test("the field draws every level in the shape its level has", () => {
  const field = priorityField(rows, t, { departmentCount: 2, operationCount: 1, moscow });
  const marks = marksOf(field.body, "point");
  expect([...marks.keys()].sort()).toEqual(["could", "must", "open", "should", "wont"]);
  for (const [level, mark] of marks) {
    expect(mark.element, `${level} is a ${SHAPES[level]}`).toBe(SHAPES[level]);
  }
  // Three edges is three corners, and not a rounded thing with a point on it.
  const triangle = field.body.match(/<polygon class="point moscow-should"[^>]*points="([^"]+)"/);
  expect(triangle[1].trim().split(" ")).toHaveLength(3);
});

test("the reach figure draws the same shapes for the same levels", () => {
  const reach = reachChart(rows, categories, t, { moscow });
  const marks = marksOf(reach.body, "reach");
  for (const [level, mark] of marks) {
    expect(mark.element, `${level} is a ${SHAPES[level]}`).toBe(SHAPES[level]);
  }
  // Whatever shape it turned out to be, a mark says where it stands and how
  // much room it takes: a reader of the picture may not have to know which of
  // the four elements this one is.
  for (const [level, mark] of marks) {
    for (const named of ["data-cx", "data-cy", "data-r", "data-reach"]) {
      expect(mark.attributes, `${level} carries ${named}`).toContain(named);
    }
  }
});

test("an ellipse is not a circle with a dent in it", () => {
  /* Two levels apart by a shape nobody can see apart is the failure this
     change was made to end, and „Could have" against „Won't have" is the pair
     it could happen to: both are round. So the ellipse is drawn wide and flat
     enough to be read as one at the size of a dot. */
  const field = priorityField(rows, t, { departmentCount: 2, operationCount: 1, moscow });
  const [, rx, ry] = field.body.match(
    /<ellipse class="point moscow-could"[^>]*rx="([\d.]+)" ry="([\d.]+)"/,
  );
  expect(Number(rx) / Number(ry), "wide against tall").toBeGreaterThan(2);
});

test("the city stands every level on a ground plan with its own number of edges", () => {
  const city = cityPlot(rows, categories, t, { moscow });
  const roofs = new Map();
  for (const tower of city.body.matchAll(/<g class="tower[^]*?<\/g>/g)) {
    const level = tower[0].match(/class="face top ([\w-]+)"/)[1];
    const points = tower[0].match(/class="face top [^"]*" points="([^"]+)"/)[1];
    const corners = points.trim().split(" ").length / 2;
    roofs.set(level, {
      corners,
      width: extent(points, 0),
      depth: extent(points, 1),
    });
  }

  expect(roofs.get("moscow-must").corners, "a block stands on four corners").toBe(4);
  expect(roofs.get("moscow-should").corners, "a wedge on three").toBe(3);
  /* Two edges and one are drawn round, and a ring of chords is how a curve is
     drawn out of straight lines — so what tells those two apart is not the
     count of points but the plan: one is as wide as it is deep, the other is
     the flat oval that says „Could have". */
  const oval = roofs.get("moscow-could");
  const round = roofs.get("moscow-wont");
  expect(oval.corners, "a curve, not a polygon anybody counts").toBeGreaterThan(12);
  expect(round.corners).toBe(oval.corners);
  expect(oval.width / oval.depth, "the oval is the flat one").toBeGreaterThan(
    (round.width / round.depth) * 1.5,
  );

  function extent(points, axis) {
    const values = points
      .trim()
      .split(" ")
      .filter((unused, index) => index % 2 === axis)
      .map(Number);
    return Math.max(...values) - Math.min(...values);
  }
});

test("nothing that carries a level is told apart by colour any more", () => {
  const sheet = stylesheet("light");
  for (const level of LEVELS) {
    for (const mark of ["point", "reach", "face", "key-mark"]) {
      expect(sheet, `no ${mark} of its own colour for ${level}`).not.toContain(
        `.${mark}.moscow-${level}{fill:`,
      );
    }
  }
  // One paint for all of them, and the one exception is what is not a level.
  expect(sheet).toMatch(/\.point,\.reach,\.face,\.key-mark\{fill:#[0-9a-f]{6}\}/);
  expect(sheet).toContain(".point.moscow-open,.reach.moscow-open,.face.moscow-open");
});

test("the band keeps its colours, because a segment has no room for a shape", () => {
  /* The one figure that still divides the levels by colour: it is a single bar
     of segments side by side, where the width is the quantity and a shape has
     nowhere to be. Its key stays a key of colours with it. */
  const band = moscowBand(rows, t, { moscow });
  expect(band.body).toMatch(/<rect class="moscow-band moscow-must"/);
  expect(band.legend.entries.every((entry) => !entry.shape), "swatches, not shapes").toBe(true);
  const sheet = stylesheet("light");
  for (const level of LEVELS) {
    expect(sheet).toContain(`.moscow-band.moscow-${level}{fill:`);
    expect(sheet).toContain(`.key-moscow-${level}{fill:`);
  }
});

test("the key of a saved figure shows the shape, not a swatch", () => {
  const field = priorityField(rows, t, { departmentCount: 2, operationCount: 1, moscow });
  const file = standalone(field, { theme: "light" });
  const key = file.slice(0, file.indexOf("<g transform"));
  for (const level of LEVELS) {
    expect(key, `${level} stands in the key as its shape`).toContain(`key-mark moscow-${level}`);
    expect(key, "and not as a coloured square").not.toContain(`class="key-moscow-${level}"`);
  }
});
