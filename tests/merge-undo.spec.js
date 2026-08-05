import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Store } from "../lib/store.js";

/**
 * Taking back the largest thing one click does.
 *
 * Deleting a single coding unit offered an undo. Merging two categories — which
 * dissolves one of them, re-hangs every unit it held, pulls its coding rules and
 * its note across and re-parents everything that sat under it — offered none.
 * The tool was careful about the small loss and careless about the large one,
 * and merging is a move Mayring's reduction step asks for by name: at the fourth
 * citation it regularly turns out that two categories name the same thing, and
 * the whole point is that you may be wrong about that.
 *
 * So the merge now hands back everything needed to reverse it, and the offer
 * sits on the message the way it does for a deleted unit. What comes back has to
 * be the system that was there — same identifier, same place in the order, same
 * rules and note on both sides, the same subcategories hanging where they hung,
 * and exactly the units that moved and not the ones that were already there.
 */

function freshStore() {
  const root = mkdtempSync(join(tmpdir(), "fundstelle-merge-"));
  return new Store({ toolRoot: root, transcriptRoot: root, seedLanguage: "de" });
}

/** A system with a rule, a note and a subcategory on each side of the merge. */
async function withSides(store) {
  await store.addCategory({ name: "Suche", definition: "Aussagen über das Suchen von Information." });
  await store.addCategory({ name: "Tiefensuche", definition: "Aussagen über besonders lange Suchen." });
  await store.addCategory({ name: "Ablage", definition: "Aussagen über den Ort, an dem etwas liegt." });
  await store.updateCategory("ind.tiefensuche", { parent: "ind.suche" });
  await store.updateCategory("ind.suche", {
    codingRules: ["Nur wenn wirklich gesucht wird"],
    memo: "Kam im dritten Interview auf.",
  });
  await store.updateCategory("ind.ablage", {
    codingRules: ["Nur wenn ein Ort genannt wird"],
    memo: "Aus Interview 1.",
  });
  return store;
}

test("the merge hands back everything it changed", async () => {
  const store = await withSides(freshStore());
  const { undo } = await store.mergeCategories("ind.suche", "ind.ablage");

  // The dissolved category whole, and where in the order it stood.
  expect(undo.source.category.id).toBe("ind.suche");
  expect(undo.source.category.codingRules).toEqual(["Nur wenn wirklich gesucht wird"]);
  expect(undo.source.at).toBeGreaterThanOrEqual(0);
  // The target as it was, before it inherited anything.
  expect(undo.target.codingRules).toEqual(["Nur wenn ein Ort genannt wird"]);
  expect(undo.target.memo).toBe("Aus Interview 1.");
  // And every subcategory that was re-hung, with the parent it had.
  expect(undo.reparented).toEqual([{ id: "ind.tiefensuche", parent: "ind.suche" }]);
});

test("undoing a merge puts the system back as it stood", async () => {
  const store = await withSides(freshStore());
  const before = (await store.categories()).categories;

  const { undo } = await store.mergeCategories("ind.suche", "ind.ablage");
  const merged = (await store.categories()).categories;
  expect(merged.some((one) => one.id === "ind.suche"), "gone while merged").toBe(false);
  expect(merged.find((one) => one.id === "ind.ablage").codingRules).toHaveLength(2);

  await store.undoCategoryMerge(undo);
  const after = (await store.categories()).categories;
  /* Not "a category called Suche exists again" — the same system, in the same
     order, with nothing left over on either side. */
  expect(after).toEqual(before);
});

test("the units that move back are the ones that moved", async () => {
  const store = await withSides(freshStore());
  const unit = (id, category) => ({
    id,
    turn: Number(id.slice(1)),
    start: 0,
    end: 20,
    category,
    text: "Ein Satz aus dem Transkript.",
  });
  // Two on each side, so that moving everything back would be visibly wrong.
  await store.writeCodings("interview-01", [
    unit("u1", "ind.suche"),
    unit("u2", "ind.ablage"),
    unit("u3", "ind.suche"),
    unit("u4", "ind.ablage"),
  ]);

  const moved = await store.replaceCategory("interview-01", "ind.suche", "ind.ablage");
  expect(moved.sort()).toEqual(["u1", "u3"]);
  const { undo } = await store.mergeCategories("ind.suche", "ind.ablage");
  await store.undoCategoryMerge(undo);
  await store.recategorise("interview-01", moved, "ind.suche");

  const back = (await store.codings("interview-01")).codings;
  expect(back.map((one) => [one.id, one.category])).toEqual([
    ["u1", "ind.suche"],
    ["u2", "ind.ablage"],
    ["u3", "ind.suche"],
    ["u4", "ind.ablage"],
  ]);
});

test("a category cannot be restored on top of one that is there", async () => {
  const store = await withSides(freshStore());
  const { undo } = await store.mergeCategories("ind.suche", "ind.ablage");
  await store.undoCategoryMerge(undo);
  // Twice would be two categories with one identifier, which the coded units
  // could not tell apart.
  await expect(store.undoCategoryMerge(undo)).rejects.toThrow("errorCategoryExists");
});

/* And the same round trip through the interface, where the offer lives. */

const PORT = 4188;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
let server;
let folder;

test.beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "fundstelle-merge-ui-"));
  const transcripts = join(folder, "transcripts");
  mkdirSync(join(transcripts, "interview-01"), { recursive: true });
  writeFileSync(
    join(transcripts, "interview-01", "final.md"),
    "# Interview 1: Vertrieb\n\n- Quelle: erfunden\n\n---\n\n" +
      "## Erzählanstoß: 1 · Ablage\n\n" +
      [1, 2, 3, 4].
        map((n) =>
          `**${n * 2 - 1} · Interviewer [0:0${n}]**\n\nFrage ${n}?\n\n` +
          `**${n * 2} · Vertrieb [0:1${n}]**\n\nWir legen das im Laufwerk ab, aber jeder macht es ` +
          `anders und am Ende sucht man doppelt so lange wie man eigentlich müsste.\n\n`,
        )
        .join(""),
  );
  server = spawn(process.execPath, [join(ROOT, "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      TRANSCRIPTS: transcripts,
      CATEGORIES: join(folder, "categories.json"),
      START_LANGUAGE: "de",
    },
    stdio: "ignore",
  });
  for (let tries = 0; tries < 60; tries += 1) {
    const up = await fetch(`${BASE}/api/interviews`).then((answer) => answer.ok, () => false);
    if (up) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});

test.afterAll(() => {
  server?.kill();
  rmSync(folder, { recursive: true, force: true });
});

test("the merge offers the way back on the message that reports it", async ({ page }) => {
  const send = (path, body, method = "POST") =>
    fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await send("/api/categories", { name: "Suche", definition: "Aussagen über das Suchen von Information." });
  await send("/api/categories", { name: "Ablage", definition: "Aussagen über den Ort, an dem etwas liegt." });

  const turns = (await (await fetch(`${BASE}/api/interviews/interview-01`)).json()).turns
    .filter((turn) => !turn.interviewer);
  for (const [index, turn] of turns.entries()) {
    await send(`/api/interviews/interview-01/codings`, {
      turn: turn.number,
      start: 0,
      end: 40,
      category: index % 2 ? "ind.ablage" : "ind.suche",
      text: turn.text.slice(0, 40),
      reviewed: true,
    });
  }
  const held = async (id) => {
    const data = await (await fetch(`${BASE}/api/interviews/interview-01`)).json();
    return data.codings.filter((one) => one.category === id).length;
  };
  const wasSuche = await held("ind.suche");
  const wasAblage = await held("ind.ablage");
  expect(wasSuche, "both sides hold something").toBeGreaterThan(0);
  expect(wasAblage).toBeGreaterThan(0);

  await page.goto(`${BASE}/?lang=de`);
  await page.waitForSelector(".turn");
  // The category system stands beside the transcript; a category opens on click.
  await page.locator('.category[data-category="ind.suche"]').click();
  const target = page.locator('[data-merge-target="ind.suche"]');
  await target.scrollIntoViewIfNeeded();
  await target.selectOption("ind.ablage");
  await page.locator('[data-merge="ind.suche"]').click();

  // It says what it did, in units rather than in the abstract.
  const message = page.locator("#message");
  await expect(message).toContainText(String(wasSuche));
  await expect(message.locator("#message-action")).toHaveText("Rückgängig");
  expect(await held("ind.suche"), "moved across").toBe(0);

  await message.locator("#message-action").click();
  await expect(message).toContainText("steht wieder");
  // Exactly back: what was on each side is on each side again.
  expect(await held("ind.suche")).toBe(wasSuche);
  expect(await held("ind.ablage")).toBe(wasAblage);
  await expect(page.locator('[data-merge-target="ind.suche"]')).toBeVisible();
});
