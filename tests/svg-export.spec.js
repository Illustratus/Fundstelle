import { expect, test } from "@playwright/test";
import { readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A saved chart, opened somewhere else.
 *
 * "Every chart saves as an SVG that stands on its own — colours resolved, fonts
 * carried, its key drawn in, nothing fetched from anywhere" is a promise about
 * a file after it has left the application. The suite checked the parts of it
 * that can be read out of the page: that the key is drawn, that a background is
 * laid down. It never opened one of the files.
 *
 * That is the same gap the exports had. A chart whose colours live in CSS
 * custom properties renders in the page and renders black, or not at all,
 * anywhere else — and nothing about the file looks wrong. The saving copies a
 * fixed list of computed properties onto every element, and a list is exactly
 * the kind of thing that falls behind the stylesheet it was written for.
 *
 * So the file is opened as a document of its own and every element compared
 * against the same element in the page. Any visual property that differs is a
 * difference between what the author saw and what the file shows.
 */

/** What has to look the same in the page and in the file. */
const VISUAL = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "text-transform",
];

/** Every drawn element, keyed by what it is and where it comes in its kind. */
const readChart = (root, properties) => {
  const seen = new Map();
  const found = [];
  for (const element of root.querySelectorAll("svg *")) {
    const kind = `${element.tagName}.${element.getAttribute("class") ?? ""}`;
    const at = seen.get(kind) ?? 0;
    seen.set(kind, at + 1);
    const style = getComputedStyle(element);
    const values = {};
    for (const property of properties) values[property] = style.getPropertyValue(property);
    found.push({ key: `${kind}#${at}`, values });
  }
  return found;
};

const CHARTS = [
  ["the category chart", "chart"],
  ["the heatmap", "heatmap"],
  ["the saturation curve", "saturation"],
];

let work;

test.beforeAll(async ({ playwright, baseURL }) => {
  work = mkdtempSync(join(tmpdir(), "fundstelle-svg-"));
  const request = await playwright.request.newContext({ baseURL });
  const { categories } = await (await request.get("/api/categories")).json();
  // A third interview, so the saturation curve is drawn at all.
  await request.post("/api/import", {
    data: {
      text:
        "Anna: Wie läuft das bei euch?\nProduktion: Die Unterlagen liegen im Laufwerk.\n" +
        "Anna: Und was stört?\nProduktion: Dass niemand sie pflegt und ich jedes Mal frage.\n",
      interviewer: "Anna",
      department: "Produktion",
      title: "Interview 3: Produktion",
    },
  });
  for (const one of await (await request.get("/api/interviews")).json()) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
    const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 70);
    for (const [index, turn] of codable.slice(0, 5).entries()) {
      await request.post(`/api/interviews/${one.id}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end: 60,
          category: categories[index % categories.length].id,
          text: turn.text.slice(0, 60),
          reviewed: true,
        },
      });
    }
  }
  await request.dispose();
});

test.afterAll(() => {
  rmSync(work, { recursive: true, force: true });
  rmSync(join(process.cwd(), ".sandbox", "transcripts", "interview-3-produktion"), {
    recursive: true,
    force: true,
  });
});

/** Click the save button and read back the file that came out. */
async function saved(page, id) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(`[data-svg="${id}"]`).click(),
  ]);
  const file = join(work, `${id}.svg`);
  await download.saveAs(file);
  return readFileSync(file, "utf8");
}

for (const [what, id] of CHARTS) {
  test(`${what} looks the same in the file as in the page`, async ({ page }) => {
    await page.goto("/?lang=de");
    await page.locator('.tab[data-view="analysis"]').click();
    await expect(page.locator(`#${id} svg`)).toBeVisible();

    const inPage = await page.evaluate(
      ([chart, properties]) => {
        const read = (root, wanted) => {
          const seen = new Map();
          const found = [];
          for (const element of root.querySelectorAll("svg *")) {
            const kind = `${element.tagName}.${element.getAttribute("class") ?? ""}`;
            const at = seen.get(kind) ?? 0;
            seen.set(kind, at + 1);
            const style = getComputedStyle(element);
            const values = {};
            for (const property of wanted) values[property] = style.getPropertyValue(property);
            found.push({ key: `${kind}#${at}`, values });
          }
          return found;
        };
        return read(document.getElementById(chart), properties);
      },
      [id, VISUAL],
    );

    const file = await saved(page, id);
    /* Nothing may be left pointing at a stylesheet that is not there. A custom
       property in a saved file resolves to nothing at all outside the page. */
    expect(file, "no custom property survives into the file").not.toContain("var(--");
    expect(file).toContain('xmlns="http://www.w3.org/2000/svg"');

    // Opened as a document of its own, with no stylesheet of the tool in sight.
    const alone = await page.context().newPage();
    await alone.setContent(file, { waitUntil: "load" });
    const inFile = await alone.evaluate(
      ([properties]) => {
        const seen = new Map();
        const found = [];
        for (const element of document.querySelectorAll("svg *")) {
          const kind = `${element.tagName}.${element.getAttribute("class") ?? ""}`;
          const at = seen.get(kind) ?? 0;
          seen.set(kind, at + 1);
          const style = getComputedStyle(element);
          const values = {};
          for (const property of properties) values[property] = style.getPropertyValue(property);
          found.push({ key: `${kind}#${at}`, values });
        }
        return found;
      },
      [VISUAL],
    );

    const byKey = new Map(inFile.map((one) => [one.key, one.values]));
    const differences = [];
    for (const one of inPage) {
      const there = byKey.get(one.key);
      if (!there) {
        differences.push(`${one.key} is missing from the file`);
        continue;
      }
      for (const property of VISUAL) {
        if (one.values[property] !== there[property]) {
          differences.push(
            `${one.key} ${property}: page ${one.values[property]} · file ${there[property]}`,
          );
        }
      }
    }
    await alone.close();

    expect(inPage.length, `${what} draws something`).toBeGreaterThan(3);
    expect([...new Set(differences)], `${what} differs between page and file`).toEqual([]);
  });
}

test("a saved chart carries its key and its ground", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#chart svg")).toBeVisible();

  const file = await saved(page, "chart");
  const alone = await page.context().newPage();
  await alone.setContent(file, { waitUntil: "load" });

  /* The key is HTML beside the picture in the page, so a file without it is a
     chart of unnamed colours. */
  const legend = await alone.locator("svg text").allTextContents();
  const departments = await page.evaluate(async () => {
    const data = await (await fetch("/api/analysis")).json();
    return data.departments;
  });
  for (const department of departments) {
    expect(legend.join(" "), `the key names ${department}`).toContain(department);
  }

  // And something to read it against, rather than whatever the viewer's page is.
  const ground = await alone.evaluate(() => {
    const rect = document.querySelector("svg > rect");
    return rect ? getComputedStyle(rect).fill : null;
  });
  expect(ground).toMatch(/^rgb/);
  await alone.close();
});

test("the dark theme is saved dark, and stays readable", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#chart svg")).toBeVisible();

  const file = await saved(page, "chart");
  const alone = await page.context().newPage();
  await alone.setContent(file, { waitUntil: "load" });

  const measured = await alone.evaluate(() => {
    const luminance = (value) => {
      const [r, g, b] = value.match(/\d+/g).map(Number);
      const channel = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ground = getComputedStyle(document.querySelector("svg > rect")).fill;
    /* Against what it is actually read on. A number written into a bar is read
       against the bar — black on a mid-blue segment, which is right — and
       measuring it against the sheet behind it asks a question nobody has: on a
       dark ground that number is near-invisible and also nowhere near it. Such a
       label always follows the shape it belongs to, so the shape is one step
       back. */
    const behind = (text) => {
      const shape = text.previousElementSibling;
      const painted = /segment|cell |cell$|moscow-band/.test(
        shape?.getAttribute("class") ?? "",
      );
      return painted ? getComputedStyle(shape).fill : ground;
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
  // Saved from the dark theme it is dark, and its writing still stands off it.
  expect(measured.ground).toBeLessThan(0.2);
  expect(measured.worst).toBeGreaterThan(4.5);
  await alone.close();
});
