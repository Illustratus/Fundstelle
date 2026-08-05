import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Getting a second coding from one machine to another.
 *
 * Intercoder reliability is the thing that separates a coding from an opinion,
 * and this tool has computed it from the beginning: a second coder runs their
 * own copy on the same transcripts, and their `coding.json` goes beside the
 * first as `coding.<name>.json`. Read only, deliberately — a second coding this
 * tool could edit would not be independent of it, and independence is the whole
 * exercise.
 *
 * What was never looked at is how that file gets there. It is one copy per
 * interview folder, with an exact name: eighteen careful copies for a study of
 * eighteen, and a name typed wrong is not an error but silence — the comparison
 * simply reports that the second coder did not do that interview.
 *
 * So the copying is the tool's job now. One file out of the second coder's copy,
 * one file in on this side, and it lands where it always had to land. Nothing
 * about the format or the read-only rule changes; the manual route still works
 * and is still what the README describes.
 */

const SANDBOX = join(fileURLToPath(new URL("..", import.meta.url)), ".sandbox", "transcripts");
const CATEGORIES = ["routine", "routine.disruption", "agreement"];

/** Code the study, so there is something to hand over. */
async function code(request) {
  const all = await (await request.get("/api/interviews")).json();
  for (const one of all) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
    const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 90);
    for (const [index, turn] of codable.slice(0, 4).entries()) {
      await request.post(`/api/interviews/${one.id}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end: 60,
          category: CATEGORIES[index % CATEGORIES.length],
          text: turn.text.slice(0, 60),
          reviewed: true,
        },
      });
    }
  }
  return all.map((one) => one.id);
}

function forget(ids, coder) {
  for (const id of ids) rmSync(join(SANDBOX, id, `coding.${coder}.json`), { force: true });
}

test.afterEach(async ({ request }) => {
  const all = await (await request.get("/api/interviews")).json();
  for (const coder of ["anna", "coder-2", "bea"]) forget(all.map((one) => one.id), coder);
});

test("a coding is handed over as one file, for the whole study", async ({ request }) => {
  const ids = await code(request);
  const bundle = await (await request.get("/api/export/coding.json?name=Anna")).json();

  // It says what it is, so the other side can refuse anything else.
  expect(bundle.fundstelle).toBe("coding");
  expect(bundle.coder).toBe("Anna");
  expect(Object.keys(bundle.interviews).sort()).toEqual([...ids].sort());
  for (const id of ids) {
    expect(bundle.interviews[id].codings.length, id).toBeGreaterThan(0);
    // The marks the anchor check hangs on a unit while it works are not part of
    // anybody's coding and must not travel.
    for (const unit of bundle.interviews[id].codings) {
      expect(unit.state, `${id} ${unit.id}`).toBeUndefined();
    }
  }
});

test("taking one in puts it where the comparison has always looked", async ({ request }) => {
  const ids = await code(request);
  const bundle = await (await request.get("/api/export/coding.json?name=anna")).json();

  const answer = await request.post("/api/codings/second", { data: { bundle } });
  expect(answer.status()).toBe(201);
  const { written, missing } = await answer.json();
  expect(written).toHaveLength(ids.length);
  expect(missing).toEqual([]);

  /* Named as a fact about the disk. The comparison reads this path and nothing
     else, and the whole point of the feature is that a person no longer has to
     produce it by hand. */
  for (const id of ids) {
    const file = join(SANDBOX, id, "coding.anna.json");
    expect(existsSync(file), file).toBe(true);
    const written = JSON.parse(readFileSync(file, "utf8"));
    expect(written.interview).toBe(id);
    expect(written.codings.length).toBeGreaterThan(0);
  }

  // And it is a second coding as far as the comparison is concerned.
  const agreement = await (await request.get("/api/agreement")).json();
  expect(agreement.coders).toContain("anna");
});

test("a name becomes a file name and cannot become a path", async ({ request }) => {
  const ids = await code(request);
  const bundle = await (await request.get("/api/export/coding.json")).json();

  await request.post("/api/codings/second", { data: { bundle, name: "Coder 2" } });
  expect(existsSync(join(SANDBOX, ids[0], "coding.coder-2.json"))).toBe(true);

  /* A name that could steer a path is not refused but flattened, the same way
     "Coder 2" becomes "coder-2" — every character that is not a letter or a
     digit becomes a dash. A name with nothing left in it is refused, because
     `coding..json` names nobody and `coding.json` is somebody else's file. */
  for (const bad of ["", "   ", "/", ".", "..", "../.."]) {
    const answer = await request.post("/api/codings/second", { data: { bundle, name: bad } });
    expect(answer.status(), JSON.stringify(bad)).toBe(400);
  }
  const flattened = await request.post("/api/codings/second", { data: { bundle, name: "../../escaped" } });
  expect(flattened.status()).toBe(201);
  expect(existsSync(join(SANDBOX, ids[0], "coding.escaped.json"))).toBe(true);
  forget(ids, "escaped");

  // Nothing anywhere but inside an interview folder, and the first coder's own
  // file — the one thing here that must never be written over — untouched.
  expect(existsSync(join(SANDBOX, "..", "coding.json"))).toBe(false);
  expect(existsSync(join(SANDBOX, "coding.json"))).toBe(false);
  for (const id of ids) {
    for (const entry of readdirSync(join(SANDBOX, id))) {
      expect(entry, `${id}/${entry}`).toMatch(/^(final\.md|coding\.json|coding\.[a-z0-9-]+\.json)$/);
    }
  }
  const own = JSON.parse(readFileSync(join(SANDBOX, ids[0], "coding.json"), "utf8"));
  expect(own.codings.length).toBeGreaterThan(0);
});

test("an interview the other person coded and this study does not hold is named", async ({ request }) => {
  const ids = await code(request);
  const bundle = await (await request.get("/api/export/coding.json?name=bea")).json();
  bundle.interviews["interview-99"] = { codings: [], memo: "" };

  const answer = await request.post("/api/codings/second", { data: { bundle } });
  const { written, missing } = await answer.json();
  expect(written).toHaveLength(ids.length);
  // Not written somewhere it does not belong, and not passed over in silence.
  expect(missing).toEqual(["interview-99"]);
  expect(existsSync(join(SANDBOX, "interview-99"))).toBe(false);
});

test("a file that is not a handed-over coding is refused", async ({ request }) => {
  for (const bundle of [{}, { fundstelle: "something-else" }, { fundstelle: "coding" }, null]) {
    const answer = await request.post("/api/codings/second", { data: { bundle } });
    expect(answer.status(), JSON.stringify(bundle)).toBe(422);
    expect((await answer.json()).code).toBe("errorBundleUnreadable");
  }
});

test("the analysis offers both halves where the topic is explained", async ({ page, request }) => {
  await code(request);
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();

  const handover = page.locator(".handover");
  await expect(handover).toBeVisible();
  await expect(handover.locator("#handover-out")).toBeVisible();
  await expect(handover.locator("#handover-choose")).toBeVisible();
  // It says where the file ends up, because that is what somebody was doing by
  // hand and will want to recognise.
  await expect(handover).toContainText("coding.NAME.json");

  const bundle = await (await request.get("/api/export/coding.json?name=anna")).json();
  await page.locator("#handover-file").setInputFiles({
    name: "coding.anna.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bundle), "utf8"),
  });
  await expect(page.locator("#message")).toContainText("übernommen");
  // The comparison is on the screen without anybody reloading anything.
  await expect(page.locator("#agreement-part")).toContainText("anna");
});

test("the name can come from the file it arrived as", async ({ page, request }) => {
  const ids = await code(request);
  const bundle = await (await request.get("/api/export/coding.json")).json();
  expect(bundle.coder).toBe("");

  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator(".handover")).toBeVisible();
  /* An attachment called `coding.bea.json` still says who it was, which is what
     somebody forwarding one from a mail actually has in their hands. */
  await page.locator("#handover-file").setInputFiles({
    name: "coding.bea.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bundle), "utf8"),
  });
  await expect(page.locator("#message")).toContainText("übernommen");
  expect(existsSync(join(SANDBOX, ids[0], "coding.bea.json"))).toBe(true);
});
