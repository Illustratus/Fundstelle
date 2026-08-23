import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { standalone, stylesheet } from "../public/charts.js";

/**
 * The Euler diagram of the blocked operations, and the two ways it went wrong.
 *
 * A figure in this tool is drawn once and painted twice: the geometry is one
 * body of arithmetic in `charts.js`, and the class names it hangs on that
 * geometry are painted by `app.css` on the screen and by `stylesheet()` inside
 * the saved file. Both, always. This figure arrived painted only in the second
 * of them, and the failure is the quiet kind — no error anywhere, the saved SVG
 * perfect, and on the screen and in the printed appendix three rectangles of
 * default black laid over every requirement title in the catalog. Nothing in
 * the suite could see it, because everything that opens a saved file was
 * looking at the half that worked.
 *
 * So the check is on the *pair* rather than on this figure: whatever the file's
 * stylesheet paints, the page's stylesheet paints too. The file's own key is
 * left out of it — `drawKey` draws that inside the SVG and the page builds the
 * same key out of HTML, so those class names exist in one document by design.
 *
 * The second way is not about paint at all. Which operations there are to block
 * is the study's vocabulary — renameable, and extensible past three — and this
 * figure had three names of its own out of the interface dictionary. A study
 * that had renamed one saw the old word here and nowhere else; a study with a
 * fourth had it counted, silently and in print, among the requirements that
 * block nothing. A wrong sentence about the material is worse than a missing
 * figure, so a vocabulary the three rectangles cannot hold is declined.
 */

const CSS = fileURLToPath(new URL("../public/app.css", import.meta.url));

/* This figure is a statement about the whole catalog — „no requirement blocks
   anything" is only true if none of them does — so the two tests that read it
   own the catalog rather than adding to whatever the run left behind. The extra
   operations go as well: a fourth is what one of them is about. */
const clear = async (request) => {
  const catalog = await (await request.get("/api/requirements")).json();
  for (const requirement of catalog.requirements) {
    await request.delete(`/api/requirements/${requirement.id}`);
  }
  for (const operation of catalog.operations) {
    if (!["filing", "retrieval", "transfer"].includes(operation.id)) {
      await request.delete(`/api/operations/${operation.id}`);
    }
  }
  return catalog.operations.filter((one) =>
    ["filing", "retrieval", "transfer"].includes(one.id),
  );
};

test("what the saved file paints, the page paints too", () => {
  const named = (text) => new Set([...text.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((one) => one[1]));
  const page = named(readFileSync(CSS, "utf8"));

  for (const theme of ["light", "dark"]) {
    const missing = [...named(stylesheet(theme))]
      // The key of a saved file is drawn as SVG inside it; the page builds its
      // own out of HTML. These two are the one place the documents differ.
      .filter((one) => !one.startsWith("key-"))
      .filter((one) => !page.has(one))
      .sort();
    expect(missing, `classes the ${theme} file paints and app.css does not`).toEqual([]);
  }
});

test("the key of six stands in columns rather than running on", () => {
  /* A key of two or three things wants to flow; a key of six wants columns. Run
     on, the swatches of the second line stood wherever the words of the first
     happened to end, and the eye had no column to come down. This is the
     arrangement itself rather than any one study's, so it is built rather than
     fetched — a study gains a department every so often and the arrangement has
     to hold when it does. */
  const names = ["Marketing", "Vertrieb", "Produktion", "Einkauf", "Geschäftsführung", "Sales"];
  const file = standalone({
    id: "key", file: "key.svg", title: "T", caption: "C", summary: "S",
    width: 720, height: 40, body: "",
    legend: {
      inset: 10,
      grid: true,
      entries: [
        { label: "Kreis je Anforderung: welche Bereiche sie nennen" },
        ...names.map((name, at) => ({ paint: `series-s${at + 1}`, label: name })),
        { paint: "unnamed", label: "nennt nicht" },
      ],
    },
  });
  const marks = [
    ...file.matchAll(/<rect class="key-(?:series-s\d|unnamed)" x="([\d.]+)" y="([\d.]+)"/g),
  ].map((one) => ({ x: Number(one[1]), y: Number(one[2]) }));
  expect(marks, "a swatch for every department and one for the grey").toHaveLength(7);

  const rows = new Map();
  for (const mark of marks) rows.set(mark.y, [...(rows.get(mark.y) ?? []), mark.x]);
  expect(rows.size, "seven entries do not fit on one line").toBeGreaterThan(1);

  const lines = [...rows.values()];
  // Every line starts in the same column, and the columns are evenly stepped.
  const left = lines[0][0];
  const pitch = lines[0][1] - lines[0][0];
  for (const line of lines) {
    line.forEach((x, at) =>
      expect(x, "a swatch stands under the one above it").toBe(left + at * pitch),
    );
  }
  /* And the sentence about the key stands to the left of the columns rather
     than above them: it begins at the figure's own edge and the first column
     begins clear of where it ends. */
  const note = file.match(/<text class="key-label" x="([\d.]+)" y="([\d.]+)"/);
  expect(Number(note[1])).toBe(10);
  expect(left).toBeGreaterThan(Number(note[1]) + 200);
  // Nothing runs off the sheet on the right.
  expect(left + (pitch * (lines[0].length - 1))).toBeLessThan(720 - 10);
});

test("the figure is painted on the page as well", async ({ page }) => {
  const operations = await clear(page.request);
  const [filing, retrieval, transfer] = operations.map((one) => one.id);
  const made = [];
  for (const [title, blocked] of [
    ["Einheitliche Signaturvergabe", [filing]],
    ["Zugriffsrechte je Schutzstufe", [filing, retrieval, transfer]],
    ["Suche mit Unschärfe", [retrieval]],
    ["Beeinträchtigt gar nichts", []],
  ]) {
    const answer = await page.request.post("/api/requirements", {
      data: { title, blockedOperations: blocked },
    });
    made.push((await answer.json()).id);
  }
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="catalog"]').click();
  await expect(page.locator("#blocked svg")).toBeVisible();

  /* Not „a frame is there" but „a frame is not filled black". The whole defect
     was that every drawn element fell back to the browser's own paint, which is
     exactly what a test that counts elements cannot see. */
  const paint = await page.evaluate(() => {
    const of = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        fill: style.fill,
        stroke: style.stroke,
        alpha: style.fillOpacity,
        size: style.fontSize,
      };
    };
    return {
      wash: of("#blocked .op-wash"),
      edge: of("#blocked .op-edge"),
      card: of("#blocked .op-card"),
      item: of("#blocked .op-item"),
      slice: of("#blocked .op-slice"),
      name: of("#blocked .op-name"),
    };
  });

  // A set is a wash, so it carries a colour of its own and lets the ones under
  // it through; two and three of them lying over one another is what tells the
  // areas apart without a key.
  expect(paint.wash).not.toBeNull();
  expect(paint.wash.fill).not.toBe("rgb(0, 0, 0)");
  expect(Number(paint.wash.alpha)).toBeGreaterThan(0);
  expect(Number(paint.wash.alpha)).toBeLessThan(1);

  /* And a rim is a line and nothing else. Its colour and the wash's used to be
     one rule for the set, which also filled the rim — the same weight as
     `.op-edge { fill: none }` and later in the sheet, so the three frames came
     out as three solid slabs, each hiding the one drawn before it and every
     wash under them. Nothing about the markup was wrong, which is why this is
     measured rather than read. */
  expect(paint.edge.fill).toBe("none");
  expect(paint.edge.stroke).not.toBe("none");
  // A card is the one ground in this figure that is the same everywhere.
  expect(paint.card.fill).not.toBe("none");
  expect(paint.card.stroke).not.toBe("none");
  // And a title is set at the figure's size rather than at the document's.
  expect(paint.item.size).toBe("9.5px");
  expect(paint.name.size).toBe("11px");
  /* A piece nobody filled is still a piece: it carries the total, so it has to
     be drawn even when it holds nothing. These requirements rest on no citation
     yet, so every piece here is a hollow one — which is exactly the state that
     must not come out as an empty corner of the card. It is a fill and not only
     an outline: a hairline came to a tenth of a millimetre where this figure is
     printed, which no press holds. */
  expect(paint.slice.fill).not.toBe("none");
  expect(paint.slice.fill).not.toBe("rgb(0, 0, 0)");
  expect(paint.slice.stroke).not.toBe("none");

  /* One wash per set, over that set's whole frame — not one per area. Painted
     area by area, the rounded corners left slivers that lay inside a set and
     inside no area's patch, and the page showed through them as black notches.
     Three is the number that says the corner of a wash is the corner of the
     frame it belongs to. */
  await expect(page.locator("#blocked .op-wash"), "one wash per set").toHaveCount(3);
  await expect(page.locator("#blocked .op-edge")).toHaveCount(3);

  /* A pie beside every requirement, cut into as many pieces as the study has
     departments and filled where one of them names it. It says the two things a
     number could only say one of — how many asked for it and *which* — and it
     is the one thing about a requirement this figure cannot say by where the
     card stands, because position says what it holds up and nothing about how
     widely it was asked for. How many requirements are in an area is not
     counted anywhere in the picture: at these numbers a reader sees it, and the
     table under the figure has it exactly. */
  const departments = (await (await page.request.get("/api/analysis")).json()).departments ?? [];
  const pieces = Math.max(1, departments.length);
  await expect(page.locator("#blocked .op-slice"), "one piece per department per card").toHaveCount(
    4 * pieces,
  );
  await expect(page.locator("#blocked .op-count"), "no count per area any more").toHaveCount(0);

  /* An area with nothing in it says so. Left blank it is the finding this figure
     exists for — that this combination does not occur in the material — and it
     reads as a slip of the pen instead. Four of the seven are empty here. */
  await expect(page.locator("#blocked .op-empty")).toHaveCount(4);
  await expect(page.locator("#blocked .op-empty").first()).toHaveText("keine");

  /* And the frame around all of it says what it is. Drawn and unnamed it was a
     visible difference carrying no information, and it encloses the band of
     requirements that hold nothing up as well — so it has to say that it means
     the whole catalog rather than a fourth set. */
  await expect(page.locator("#blocked .op-universe")).toHaveCount(1);
  await expect(page.locator("#blocked .op-whole")).toHaveText("Alle Anforderungen des Katalogs");
  /* And the key names the departments in the colours the pieces are drawn in —
     the same colours the citation figure below uses, so it is the same key
     twice rather than two keys. */
  const key = page.locator(".chart-legend", { hasText: "Kreis je Anforderung" });
  await expect(key).toHaveCount(1);
  for (const name of departments) await expect(key).toContainText(name);
  /* Grey is the sixth thing in the pie and the only one a reader had to guess
     at: five colours were named and the piece that means „did not name it" was
     not. */
  await expect(key).toContainText("nennt nicht");
  await expect(key.locator("i.unnamed")).toHaveCount(1);
  /* And the key begins where the figure begins. Flush at nought under a picture
     inset by ten, it hung out past the text block of the printed page. */
  await expect(key).toHaveClass(/\binset\b/);

  /* Every requirement is named inside the area it belongs to, and each one has
     a card of its own: set as running text, four titles in one area were four
     sentences with nothing between them but a gap, and a title that wrapped
     could not be told from the next one. */
  const inside = (await page.locator("#blocked .op-item").allTextContents()).join(" ");
  for (const title of ["Einheitliche Signaturvergabe", "Zugriffsrechte je Schutzstufe"]) {
    expect(inside).toContain(title);
  }
  await expect(page.locator("#blocked .op-card"), "one card per requirement").toHaveCount(4);

  for (const id of made) await page.request.delete(`/api/requirements/${id}`);
});

test("the three sets keep their places whatever the material does", async ({ request }) => {
  const operations = await clear(request);
  const [filing, retrieval] = operations.map((one) => one.id);
  const made = [];
  for (const [title, blocked] of [
    ["Einheitliche Signaturvergabe", [filing]],
    ["Suche mit Unschärfe", [retrieval]],
  ]) {
    const answer = await request.post("/api/requirements", {
      data: { title, blockedOperations: blocked },
    });
    made.push((await answer.json()).id);
  }

  /* Nothing here holds up two operations at once, and the three frames still
     overlap. That is the whole claim of a Venn diagram rather than an Euler
     one — a combination keeps its place whether it occurs or not, because that
     is the only way the picture can say that one of them does not — and it is a
     claim about geometry, so it is read off the geometry rather than off a
     class name. */
  const framed = (svg) =>
    [
      ...svg.matchAll(
        /<rect class="op-edge[^"]*" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g,
      ),
    ].map((one) => ({
      left: Number(one[1]),
      top: Number(one[2]),
      right: Number(one[1]) + Number(one[3]),
      bottom: Number(one[2]) + Number(one[4]),
    }));
  const meet = (a, b) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  const sets = framed(await (await request.get("/api/figures/blocked-operations.svg?lang=de")).text());
  expect(sets).toHaveLength(3);
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    expect(meet(sets[i], sets[j]), "the three frames overlap however thin the material is").toBe(
      true,
    );
  }
  /* And no two of them share an edge. Given the same distance out from their
     own cells, the first and second would begin at the same pixel on the left
     and the second and third would end at the same one on the right, which is
     how three sets come out as one bordered table. */
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    for (const side of ["left", "right", "top", "bottom"]) {
      expect(sets[i][side], `${side} edges of two sets stand apart`).not.toBe(sets[j][side]);
    }
  }

  for (const id of made) await request.delete(`/api/requirements/${id}`);
});

test("the figure speaks the study's own words, and declines a vocabulary it cannot hold", async ({
  request,
}) => {
  const operations = await clear(request);
  const [filing, retrieval] = operations.map((one) => one.id);
  const made = await (
    await request.post("/api/requirements", {
      data: { title: "Volltextindex über den Bestand", blockedOperations: [filing, retrieval] },
    })
  ).json();

  const drawn = async () => await request.get("/api/figures/blocked-operations.svg?lang=de");

  // Renamed: the catalog's word, not the one the tool was seeded with.
  await request.patch(`/api/operations/${filing}`, { data: { name: "Dokumentation der Vorgänge" } });
  const renamed = await (await drawn()).text();
  expect(renamed).toContain("Dokumentation der Vorg");
  expect(renamed).not.toContain(">Ablage<");

  /* A fourth operation. Three rectangles have three corners to be outside of
     and there is no fourth, so the figure says which condition is missing
     rather than drawing a picture that leaves an operation out of the count. */
  const fourth = await (await request.post("/api/operations", { data: { name: "Abstimmung" } })).json();
  const refused = await drawn();
  expect(refused.status()).toBe(409);
  expect((await refused.json()).code).toBe("figureNeedsBlockade");

  await request.delete(`/api/operations/${fourth.id ?? "abstimmung"}`);
  await request.patch(`/api/operations/${filing}`, { data: { name: "Ablage" } });
  expect((await drawn()).status()).toBe(200);

  // And nothing blocking anything is that same answer, not „no requirements".
  await request.patch(`/api/requirements/${made.id ?? made.requirement?.id}`, {
    data: { blockedOperations: [] },
  });
  const empty = await drawn();
  expect(empty.status()).toBe(409);
  expect((await empty.json()).code).toBe("figureNeedsBlockade");

  await request.delete(`/api/requirements/${made.id ?? made.requirement?.id}`);
});
