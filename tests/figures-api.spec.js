import { expect, test } from "@playwright/test";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { THEMES } from "../public/charts.js";

/**
 * The figures, fetched rather than drawn.
 *
 * Every number behind a chart was always available over the API. The picture
 * was not: it was assembled by the browser out of geometry in one file and
 * colours in another, so a script that puts a report together had to drive a
 * browser to get one, and a figure in a thesis was a screenshot or nothing.
 *
 * `/api/figures/…` answers with the picture. The claim being checked here is
 * not that something comes back — it is that what comes back is the *same*
 * picture the reader sees, and that it stands on its own once it has left:
 * colours resolved, fonts carried, key drawn in, nothing pointing at a
 * stylesheet that is not there.
 *
 * And the two ways of getting nothing are checked apart from each other. A name
 * nobody offers is a wrong address. A name that exists but has nothing to draw
 * yet is a study that has not got there — those are different answers, and a
 * tool that gives the same one for both sends people looking in the wrong place.
 */

const CATEGORIES = ["routine", "routine.disruption", "agreement"];

const THIRD = "interview-3-produktion";

const NAMES = [
  "coding-units-per-category",
  "distribution-across-sections",
  "saturation",
  "moscow-distribution",
  "prioritization",
  "citations-per-requirement",
];

const TITLES = [
  "Eine Suche, die über alle Interviews geht",
  "Ein Ort, an dem die aktuelle Fassung steht",
  "Übergaben schriftlich festhalten",
];

/**
 * Everything drawn, as a list of what it is and what it says.
 *
 * Sent into both documents as source, because the page and the saved file are
 * two different worlds and the comparison has to be made with one ruler.
 */
const DRAWING = String(function readDrawing(root) {
  return [...root.querySelectorAll("*")]
    .filter((element) => !["title", "desc", "style"].includes(element.tagName.toLowerCase()))
    .map((element) =>
      [
        element.tagName,
        element.getAttribute("class") ?? "",
        element.getAttribute("d") ?? "",
        element.getAttribute("x") ?? "",
        element.getAttribute("y") ?? "",
        element.getAttribute("width") ?? "",
        element.getAttribute("height") ?? "",
        element.textContent,
      ].join("|"),
    );
});

const drawingIn = (target, selector) =>
  target.evaluate(
    ([source, wanted]) => eval(`(${source})`)(document.querySelector(wanted)),
    [DRAWING, selector],
  );

/** A third interview, so the saturation curve is drawn at all. */
async function addThirdInterview(request) {
  await request.post("/api/import", {
    data: {
      text:
        "Anna: Wie läuft das bei euch?\nProduktion: Die Unterlagen liegen im Laufwerk, aber niemand pflegt sie.\n" +
        "Anna: Und was stört daran?\nProduktion: Dass ich jedes Mal nachfragen muss, wo die aktuelle Fassung liegt.\n",
      interviewer: "Anna",
      department: "Produktion",
      title: "Interview 3: Produktion",
    },
  });
}

/** Coded interviews and a catalog carried by them: all six figures drawable. */
async function buildStudy(request) {
  const { requirements } = await (await request.get("/api/requirements")).json();
  for (const one of requirements) await request.delete(`/api/requirements/${one.id}`);
  const made = [];
  for (const title of TITLES) {
    const answer = await request.post("/api/requirements", { data: { title } });
    const body = await answer.json();
    made.push(body.id ?? body.requirement?.id);
  }
  /* A judgment on each axis, because two of the six figures are deliberately
     not drawn before somebody has made one — and a check that only ever sees
     them undrawn would be checking the wrong thing. */
  await request.patch(`/api/requirements/${made[0]}`, { data: { moscow: "must" } });
  await request.patch(`/api/requirements/${made[1]}`, {
    data: { moscow: "should", blockedOperations: ["filing", "retrieval"] },
  });

  const interviews = await (await request.get("/api/interviews")).json();
  for (const [index, one] of interviews.entries()) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
    const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 60);
    for (const [k, turn] of codable.slice(0, 3).entries()) {
      const end = Math.min(60, turn.text.length);
      const answer = await request.post(`/api/interviews/${one.id}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end,
          category: CATEGORIES[(k + index) % CATEGORIES.length],
          text: turn.text.slice(0, end),
          reviewed: true,
          requirements: [made[(k + index) % made.length]],
        },
      });
      expect(answer.ok(), `${one.id} turn ${turn.number}`).toBe(true);
    }
  }
  return made;
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  await addThirdInterview(request);
  await buildStudy(request);
  await request.dispose();
});

test.afterAll(() => {
  rmSync(join(process.cwd(), ".sandbox", "transcripts", THIRD), {
    recursive: true,
    force: true,
  });
});

test("the endpoint says which figures there are, in the language asked for", async ({ request }) => {
  const german = await (await request.get("/api/figures?lang=de")).json();
  expect(german.figures.map((one) => one.name)).toEqual(NAMES);
  expect(german.themes).toEqual(["light", "dark"]);
  // Named, not only addressed: six titles are the index of a report.
  for (const one of german.figures) {
    expect(one.title, `${one.name} carries a title`).toBeTruthy();
    expect(one.url).toBe(`/api/figures/${one.name}.svg`);
    expect(["analysis", "catalog"]).toContain(one.view);
  }
  const english = await (await request.get("/api/figures?lang=en")).json();
  const changed = english.figures.filter(
    (one, index) => one.title !== german.figures[index].title,
  );
  expect(changed.length, "the titles are translated, not the same in both").toBe(NAMES.length);
});

for (const name of NAMES) {
  test(`${name} comes back as a picture that stands on its own`, async ({ page, request }) => {
    const answer = await request.get(`/api/figures/${name}.svg`);
    expect(answer.status(), await answer.text()).toBe(200);
    expect(answer.headers()["content-type"]).toContain("image/svg+xml");
    const file = await answer.text();

    /* Nothing may be left pointing at a stylesheet that is not there: a custom
       property in a file that has left the application resolves to nothing,
       which is how a saved chart comes out black. */
    expect(file, "no custom property survives into the file").not.toContain("var(--");
    expect(file).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(file).toContain('<title id="title"');

    const alone = await page.context().newPage();
    await alone.setContent(file, { waitUntil: "load" });
    const seen = await alone.evaluate(() => ({
      elements: document.querySelectorAll("svg *").length,
      ground: getComputedStyle(document.querySelector("svg > rect.ground")).fill,
      box: document.querySelector("svg").getAttribute("viewBox"),
      // Anything a viewer would have to fetch is a figure that is not standalone.
      external: [...document.querySelectorAll("[href], [src], image, use")].length,
    }));
    await alone.close();

    expect(seen.elements, "something is drawn").toBeGreaterThan(3);
    expect(seen.ground, "a ground to read it against").toMatch(/^rgb/);
    expect(seen.external, "nothing is fetched from anywhere").toBe(0);
    const [, , width, height] = seen.box.split(/\s+/).map(Number);
    expect(width).toBe(720);
    expect(height).toBeGreaterThan(20);
  });
}

test("the fetched figure is the figure on the screen", async ({ page, request }) => {
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#chart svg")).toBeVisible();
  const onScreen = await drawingIn(page, "#chart svg");

  const file = await (await request.get("/api/figures/coding-units-per-category.svg")).text();
  const alone = await page.context().newPage();
  await alone.setContent(file, { waitUntil: "load" });
  // The drawing sits under the group the key pushed down; the key itself is the
  // part of the file that stays HTML beside the picture on the page.
  const inFile = await drawingIn(alone, "svg > g");
  await alone.close();

  /* Not "both are charts of the same data" — the same picture. Two drawings of
     one study that agree only because nobody looked closely is exactly what
     having a single drawing routine is meant to rule out. */
  expect(inFile).toEqual(onScreen);
});

test("a name nobody offers is a wrong address, and says which are right", async ({ request }) => {
  const answer = await request.get("/api/figures/there-is-no-such-chart.svg");
  expect(answer.status()).toBe(404);
  const body = await answer.json();
  expect(body.code).toBe("errorUnknownFigure");
  // Six names are cheaper to read than the documentation is to find.
  for (const name of NAMES) expect(body.error).toContain(name);
});

test("the dark figure is dark, and its writing still stands off it", async ({ page, request }) => {
  const file = await (
    await request.get("/api/figures/coding-units-per-category.svg?theme=dark")
  ).text();
  const alone = await page.context().newPage();
  await alone.setContent(file, { waitUntil: "load" });
  const measured = await alone.evaluate(() => {
    const luminance = (value) => {
      const [r, g, b] = value.match(/\d+/g).map(Number);
      const channel = (c) =>
        c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4;
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ground = getComputedStyle(document.querySelector("svg > rect.ground")).fill;
    /* Against what it is actually read on. A number written into a bar is read
       against the bar — black on a mid-blue segment, which is right — and
       measuring it against the sheet behind it asks a question nobody has: on a
       dark ground that number is near-invisible and also nowhere near it. Such a
       label always follows the shape it belongs to, so the shape is one step
       back. */
    const ON_A_SHAPE = new Set(["bar-value", "cell-value", "band-value"]);
    const behind = (text) => {
      // Keyed off the writing, not off what happens to precede it: a row total
      // follows the last part of its bar and sits beside the bar, not on it.
      const kind = (text.getAttribute("class") ?? "").split(/\s+/)[0];
      const shape = text.previousElementSibling;
      return ON_A_SHAPE.has(kind) && shape ? getComputedStyle(shape).fill : ground;
    };
    const pairs = [...document.querySelectorAll("text")].map((one) => [
      getComputedStyle(one).fill,
      behind(one),
    ]);
    return {
      ground: luminance(ground),
      worst: Math.min(
        ...pairs.map(([colour, under]) => {
          const [bright, dark] = [luminance(colour), luminance(under)].sort((a, b) => b - a);
          return (bright + 0.05) / (dark + 0.05);
        }),
      ),
    };
  });
  await alone.close();
  expect(measured.ground).toBeLessThan(0.2);
  expect(measured.worst).toBeGreaterThan(4.5);
});

test("an unknown theme is answered in the one everybody can read", async ({ request }) => {
  const asked = await (
    await request.get("/api/figures/coding-units-per-category.svg?theme=neon")
  ).text();
  const light = await (
    await request.get("/api/figures/coding-units-per-category.svg?theme=light")
  ).text();
  // A wrong parameter is not worth a refusal; it is worth the sane default.
  expect(asked).toBe(light);
});

test("the palette the file declares is the palette the page uses", async ({ page }) => {
  await page.goto("/?lang=de");

  /* The colours live twice: as custom properties for the page, as literal
     values for the file — because a file that has left the application has no
     `:root` to ask. Twice is only safe while something compares the two. */
  for (const theme of ["light", "dark"]) {
    const wanted = THEMES[theme];
    const properties = {
      "--sheet": wanted.sheet,
      "--ink": wanted.ink,
      "--ink-soft": wanted.inkSoft,
      "--ink-faint": wanted.inkFaint,
      "--line": wanted.line,
      "--line-strong": wanted.lineStrong,
      "--accent": wanted.accent,
      ...Object.fromEntries(wanted.series.map((colour, i) => [`--series-${i + 1}`, colour])),
      ...Object.fromEntries(wanted.level.map((colour, i) => [`--level-${i + 1}`, colour])),
      ...Object.fromEntries(
        Object.entries(wanted.moscow).map(([id, colour]) => [`--moscow-${id}`, colour]),
      ),
    };
    const inPage = await page.evaluate(
      ([mode, names]) => {
        document.documentElement.dataset.theme = mode;
        const style = getComputedStyle(document.documentElement);
        return Object.fromEntries(
          names.map((name) => [name, style.getPropertyValue(name).trim().toLowerCase()]),
        );
      },
      [theme, Object.keys(properties)],
    );
    for (const [name, value] of Object.entries(properties)) {
      expect(inPage[name], `${theme} ${name}`).toBe(value.toLowerCase());
    }
  }
});

/* Last on purpose: it empties the catalog, and the checks above want one. */
test("a figure with nothing to draw yet says what is missing", async ({ request }) => {
  const { requirements } = await (await request.get("/api/requirements")).json();
  for (const one of requirements) await request.delete(`/api/requirements/${one.id}`);

  const answer = await request.get("/api/figures/moscow-distribution.svg?lang=de");
  /* Not a 404: the address is right and the endpoint is there. The study has
     not got to this figure yet, which is a different thing to be told, and the
     answer names the condition rather than shrugging. */
  expect(answer.status()).toBe(409);
  const body = await answer.json();
  expect(body.code).toBe("figureNeedsRequirements");
  expect(body.error.toLowerCase()).toContain("anforderung");

  const english = await (await request.get("/api/figures/moscow-distribution.svg?lang=en")).json();
  expect(english.error.toLowerCase()).toContain("requirement");
});
