import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The analysis screen at the size of a real study.
 *
 * Everything in this tool had only ever been looked at with two interviews and
 * three categories. Built out to eighteen interviews, eight departments, twenty
 * categories and three hundred and twenty-four coded units — the size of an
 * ordinary bachelor's study — the numbers held and the charts held. The page
 * did not.
 *
 * The citation list showed each category's first twelve units. That cap was
 * written against one long list, but the page is the sum of the categories, and
 * twenty of them drew two hundred and forty cards: thirty thousand pixels, five
 * sixths of the analysis screen, with the notes section below all of it where
 * nobody was ever going to scroll.
 *
 * So the categories fold. They open from the top until a budget of citations is
 * on the page and the rest wait behind their headings, which still carry their
 * true counts. Four thousand pixels instead of thirty thousand, and the list of
 * headings is something you can read at once and take in the order you want.
 *
 * On paper it all opens again, past the per-category cap as well: a document
 * cannot be clicked, and twelve of forty printed without saying so is worse
 * than a long appendix.
 */

const CATEGORIES = ["routine", "routine.disruption", "agreement"];

/* The shared fixture is two interviews and three categories, which is the size
   this problem is invisible at. So the height of the thing gets a study of its
   own — six interviews and sixteen categories, on its own server over its own
   folder, the shape the first-run checks already use. */
const BIG_PORT = 4186;
const BIG = `http://127.0.0.1:${BIG_PORT}`;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
let bigServer;
let bigFolder;

const SAYS = [
  "Wir legen das alles im Laufwerk ab, aber jeder macht es ein bisschen anders und am Ende sucht man doppelt so lange wie nötig.",
  "Die Absprachen laufen über den Chat, und wer nicht dabei war, für den ist die Information schlicht weg gewesen.",
  "Ich baue mir den aktuellen Stand jedes Mal neu zusammen, aus Mails, aus Notizen und aus dem, was ich noch im Kopf habe.",
  "Übergaben passieren mündlich, aufgeschrieben wird nichts, dafür fehlt im Tagesgeschäft die Zeit und später fehlt sie doppelt.",
];

test.beforeAll(async () => {
  bigFolder = mkdtempSync(join(tmpdir(), "fundstelle-scale-"));
  const transcripts = join(bigFolder, "transcripts");
  const departments = ["Vertrieb", "Marketing", "Kundenservice", "Produktion", "Einkauf", "IT"];
  for (const [n, department] of departments.entries()) {
    let text = `# Interview ${n + 1}: ${department}

- Quelle: erfunden

---

`;
    let turn = 1;
    for (const block of [1, 2]) {
      text += `## Erzählanstoß: ${block} · Block ${block}

`;
      for (let q = 0; q < 3; q += 1) {
        text += `**${turn++} · Interviewer [0:0${q}]**

Frage ${q}?

`;
        text += `**${turn++} · ${department} [0:1${q}]**

${SAYS[(n + q) % SAYS.length]} ${SAYS[(n + q + 1) % SAYS.length]}

`;
      }
    }
    mkdirSync(join(transcripts, `interview-${String(n + 1).padStart(2, "0")}`), { recursive: true });
    writeFileSync(join(transcripts, `interview-${String(n + 1).padStart(2, "0")}`, "final.md"), text);
  }
  bigServer = spawn(process.execPath, [join(ROOT, "server.js")], {
    env: {
      ...process.env,
      PORT: String(BIG_PORT),
      TRANSCRIPTS: transcripts,
      CATEGORIES: join(bigFolder, "categories.json"),
      START_LANGUAGE: "de",
    },
    stdio: "ignore",
  });
  for (let tries = 0; tries < 60; tries += 1) {
    const up = await fetch(`${BIG}/api/interviews`).then((answer) => answer.ok, () => false);
    if (up) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // A category system of the size a coded study actually reaches.
  for (let n = 1; n <= 13; n += 1) {
    await fetch(`${BIG}/api/categories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: `extra-${n}`,
        name: `Kategorie ${n}`,
        abbreviation: `K${n}`,
        definition: `Aussagen, die sich auf den ${n}. erfassten Gesichtspunkt beziehen und zeigen, wie er im Alltag gehandhabt wird.`,
        proposition: "practice",
        origin: "inductive",
        parent: null,
        codingRules: [],
      }),
    });
  }
  const categories = (await (await fetch(`${BIG}/api/categories`)).json()).categories;
  let made = 0;
  for (const one of await (await fetch(`${BIG}/api/interviews`)).json()) {
    const data = await (await fetch(`${BIG}/api/interviews/${one.id}`)).json();
    for (const turn of data.turns.filter((each) => !each.interviewer)) {
      for (const k of [0, 1]) {
        const start = k * 60;
        const end = Math.min(start + 55, turn.text.length);
        if (end - start < 20) continue;
        await fetch(`${BIG}/api/interviews/${one.id}/codings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            turn: turn.number,
            start,
            end,
            category: categories[made % categories.length].id,
            text: turn.text.slice(start, end),
            reviewed: true,
          }),
        });
        made += 1;
      }
    }
  }
});

test.afterAll(() => {
  bigServer?.kill();
  rmSync(bigFolder, { recursive: true, force: true });
});

/**
 * A study crowded enough that both caps bite: one category holding more than a
 * page will draw, and one that the budget cannot reach at all. Weighted rather
 * than spread evenly, because an even spread hits neither.
 */
async function crowd(request) {
  const interviews = await (await request.get("/api/interviews")).json();
  for (const one of interviews) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
  }
  const counts = {};
  let made = 0;
  for (const one of interviews) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 120);
    for (const turn of codable) {
      for (const k of [0, 1]) {
        const start = k * 55;
        const end = Math.min(start + 50, turn.text.length);
        if (end - start < 20) continue;
        const category = made < 18 ? CATEGORIES[0] : made < 31 ? CATEGORIES[1] : CATEGORIES[2];
        const saved = await request.post(`/api/interviews/${one.id}/codings`, {
          data: { turn: turn.number, start, end, category, text: turn.text.slice(start, end), reviewed: true },
        });
        if (saved.ok()) {
          counts[category] = (counts[category] ?? 0) + 1;
          made += 1;
        }
      }
    }
  }
  /* Said out loud, so that a fixture that grows or shrinks fails here with the
     reason rather than three assertions later with a number. */
  expect(Object.keys(counts).length, "every category has units").toBe(CATEGORIES.length);
  expect(Math.max(...Object.values(counts)), "one holds more than a page draws").toBeGreaterThan(12);
  expect(made, "enough that the budget runs out before the last category").toBeGreaterThan(24);
  return counts;
}

async function analysis(page) {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();
  await expect(page.locator(".citation-group").first()).toBeVisible();
}

test("the citation list folds instead of running for thirty thousand pixels", async ({ page }) => {
  const study = await page.context().newPage();
  await study.setViewportSize({ width: 1440, height: 900 });
  await study.goto(`${BIG}/?lang=de`);
  await study.waitForSelector(".turn");
  await study.locator('.tab[data-view="analysis"]').click();
  await expect(study.locator(".citation-group").first()).toBeVisible();

  const groups = study.locator(".citation-group");
  expect(await groups.count(), "a system of the size a study reaches").toBeGreaterThan(10);
  // Some open, some not: that is the whole point of a budget.
  const open = study.locator(".citation-group[open]");
  expect(await open.count()).toBeGreaterThan(0);
  expect(await open.count()).toBeLessThan(await groups.count());
  expect(await study.locator(".citation-group:not([open]) .citation").count(),
    "the folded ones hold cards of their own").toBeGreaterThan(0);

  /* And the section is a fraction of the same list flat — measured by opening
     it flat and looking, not against a number somebody typed. */
  const folded = (await study.locator("#citations-part").boundingBox()).height;
  /* Always the first still-folded one: the set shrinks with every click, so a
     list of them taken up front goes stale halfway through. */
  const closed = study.locator(".citation-group:not([open]) > summary");
  for (let left = await closed.count(); left > 0; left = await closed.count()) {
    await closed.first().click();
  }
  await expect(study.locator(".citation-group:not([open])")).toHaveCount(0);
  const flat = (await study.locator("#citations-part").boundingBox()).height;
  /* Comfortably under two thirds here, where each category holds a handful.
     The study that prompted this — twenty categories, 324 units — went from
     30,808px to 4,338px, and the more each category holds the wider the gap.

     The threshold is loose on purpose. This measures rendered pixels, so it
     moves with the font the machine has, and a check that fails on a different
     platform for a reason nobody can read is worse than a looser one: what it
     is here to catch is folding that stops happening, which reads as 1.0. */
  expect(folded, `${Math.round(folded)}px folded against ${Math.round(flat)}px flat`)
    .toBeLessThan(flat * 0.65);
  await study.close();
});

test("a folded category still says how much it is holding", async ({ page, request }) => {
  const counts = await crowd(request);
  await analysis(page);

  const folded = page.locator(".citation-group:not([open])").first();
  const id = await folded.locator("summary").getAttribute("data-group");
  // The count in the heading is the category's own, not the number drawn.
  await expect(folded.locator("summary")).toContainText(String(counts[id]));
  // Nothing is claimed to be missing; it is folded, and the note says so.
  await expect(page.locator("#citations-part .column-note")).toContainText("per Klick");
});

test("a heading opens on click and stays as the reader left it", async ({ page, request }) => {
  await crowd(request);
  await analysis(page);

  const folded = page.locator(".citation-group:not([open])").first();
  const id = await folded.locator("summary").getAttribute("data-group");
  await folded.locator("summary").click();
  await expect(page.locator(`.citation-group[open] summary[data-group="${id}"]`)).toBeVisible();

  /* Closing one the budget would have opened is the harder half: a redraw
     recomputes the budget, and without a memory it would spring back open. */
  const opened = page.locator(".citation-group[open]").first();
  const first = await opened.locator("summary").getAttribute("data-group");
  await opened.locator("summary").click();
  // Any change that redraws the list.
  await page.locator('[data-filter="unreviewed"]').check();
  await page.locator('[data-filter="unreviewed"]').uncheck();
  await expect(page.locator(`summary[data-group="${first}"]`)).toBeVisible();
  await expect(page.locator(`.citation-group[open] summary[data-group="${first}"]`)).toHaveCount(0);
  await expect(page.locator(`.citation-group[open] summary[data-group="${id}"]`)).toBeVisible();
});

test("on paper every category is open and nothing is capped away", async ({ page, request }) => {
  const counts = await crowd(request);
  const all = Object.values(counts).reduce((sum, n) => sum + n, 0);
  await analysis(page);
  expect(await page.locator(".citation").count(), "on screen it is capped").toBeLessThan(all);

  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => dispatchEvent(new Event("beforeprint")));
  await expect(page.locator(".citation-group:not([open])")).toHaveCount(0);
  // Past the per-category cap too: a printed twelve of forty says nothing.
  await expect(page.locator(".citation")).toHaveCount(all);
  // And the control that cannot be pressed on paper is not printed.
  await expect(page.locator(".show-rest")).toHaveCount(0);

  await page.evaluate(() => dispatchEvent(new Event("afterprint")));
  await expect(page.locator(".citation-group:not([open])").first()).toBeVisible();
});

test("each coding table in the appendix names the interview it holds", async ({ page, request }) => {
  await crowd(request);
  await analysis(page);

  /* Named by department, this row read "Kodiertabelle Marketing" three times in
     a study with three interviews from marketing — three links to three
     documents with nothing to tell them apart. */
  const links = page.locator(".exports").nth(1).locator("a");
  const labels = await links.allInnerTexts();
  const tables = labels.filter((one) => one.includes("Kodiertabelle"));
  expect(tables.length).toBeGreaterThan(1);
  expect(new Set(tables).size, "no two links read the same").toBe(tables.length);

  // And the name each one carries is the one the interview goes by elsewhere.
  const interviews = await (await request.get("/api/interviews")).json();
  for (const one of interviews) {
    expect(tables.some((label) => label.includes(one.title)), one.title).toBe(true);
  }
});
