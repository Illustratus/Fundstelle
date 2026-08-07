import { expect, test } from "@playwright/test";

/**
 * Cutting a coding unit differently, without losing what was recorded on it.
 *
 * A citation that begins one sentence too early is the most ordinary correction
 * there is, and the only way to make it was to delete the unit and code the
 * passage again — which threw away the note on it, the anchor-example mark and
 * every requirement it was evidence for. The passage most likely to need
 * cutting again is exactly the one that has just been worked on, so what was
 * lost was always the work that had been done.
 *
 * The move already existed. A unit that loses its place after a transcript edit
 * is handed back and put down again by hand, and that path patches turn, range
 * and text on the unit that is already there. It was simply never offered for a
 * unit that still had a place.
 *
 * What must hold: everything except the place stays, the overlap rule still
 * applies — exactly one category per passage — and the unit does not collide
 * with itself when it is cut down to a shorter version of where it already is.
 */

const FIRST = "interview-01";

async function clear(request) {
  for (const one of await (await request.get("/api/interviews")).json()) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
  }
}

/** Select characters of a speaker turn without bothering the mouse. */
async function selectText(page, turn, from, to) {
  await page.locator(`#turn-${turn}`).scrollIntoViewIfNeeded();
  await page.evaluate(
    ({ turn, from, to }) => {
      const field = document.querySelector(`.text[data-turn="${turn}"]`);
      const range = document.createRange();
      let counted = 0;
      let start = null;
      let end = null;
      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const length = node.nodeValue.length;
          if (start === null && counted + length >= from) start = [node, from - counted];
          if (end === null && counted + length >= to) end = [node, to - counted];
          counted += length;
          return;
        }
        if (node.classList?.contains("mark-sup")) return;
        for (const child of node.childNodes) walk(child);
      };
      walk(field);
      range.setStart(...start);
      range.setEnd(...end);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      field.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    },
    { turn, from, to },
  );
}

/** A coded turn with a note, an anchor mark and a requirement on it. */
async function unitWithEverything(request) {
  const data = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const turn = data.turns.find((one) => !one.interviewer && one.text.length > 90);
  const unit = await (
    await request.post(`/api/interviews/${FIRST}/codings`, {
      data: {
        turn: turn.number,
        start: 0,
        end: 40,
        category: "routine",
        text: turn.text.slice(0, 40),
        reviewed: true,
      },
    })
  ).json();
  const requirement = await (
    await request.post("/api/requirements", { data: { title: "Eine Suche über alle Interviews" } })
  ).json();
  await request.patch(`/api/interviews/${FIRST}/codings/${unit.id}`, {
    data: { memo: "Kandidat für die Ablage.", anchor: true, requirements: [requirement.id] },
  });
  return { unit, turn, requirement };
}

test.beforeEach(async ({ request }) => {
  await clear(request);
  for (const requirement of (await (await request.get("/api/requirements")).json()).requirements) {
    await request.delete(`/api/requirements/${requirement.id}`);
  }
});

test("the passage moves and everything recorded on the unit stays", async ({ page, request }) => {
  const { unit, turn, requirement } = await unitWithEverything(request);

  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator(`#turn-${turn.number} .segment`).click();
  await expect(page.locator("#detail")).toBeVisible();

  await page.locator("#detail-recut").click();
  await expect(page.locator("body")).toHaveClass(/anchoring/);
  await expect(page.locator("#detail")).toContainText("Wartet auf die neue Stelle");

  await selectText(page, turn.number, 10, 60);
  // The category is settled — this is the same unit — so the coding bar with
  // its list of categories stays shut.
  await expect(page.locator("#coding-bar")).toBeHidden();
  await expect(page.locator("#message")).toContainText("neuen Stelle");

  const after = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const same = after.codings.find((one) => one.id === unit.id);
  /* The passage moved. Not to exactly 10 and 60: dragging snaps to word
     boundaries, here as everywhere, so a citation never begins mid-word — which
     is why the check is that the text and the range still say the same thing. */
  expect(same.start).toBeGreaterThan(0);
  expect(same.end).toBeGreaterThan(50);
  expect(same.text).toBe(turn.text.slice(same.start, same.end));
  expect(same.state).toBe("ok");
  // The whole reason for not deleting and re-coding.
  expect(same.memo).toBe("Kandidat für die Ablage.");
  expect(same.anchor).toBe(true);
  expect(same.reviewed).toBe(true);
  expect(same.requirements).toEqual([requirement.id]);
});

test("it can be cut down to a part of where it already is", async ({ page, request }) => {
  const { unit, turn } = await unitWithEverything(request);

  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator(`#turn-${turn.number} .segment`).click();
  await page.locator("#detail-recut").click();
  /* The overlap rule is "exactly one category per passage", and a unit cannot
     be in the way of itself — shortening one is the most likely correction of
     all, and it would be refused by a check that counted the unit twice. */
  await selectText(page, turn.number, 0, 20);
  await expect(page.locator("#message")).toContainText("neuen Stelle");

  const after = await (await request.get(`/api/interviews/${FIRST}`)).json();
  expect(after.codings.find((one) => one.id === unit.id).end).toBe(20);
});

test("it still cannot be pushed onto a neighbour", async ({ page, request }) => {
  const { turn } = await unitWithEverything(request);
  await request.post(`/api/interviews/${FIRST}/codings`, {
    data: {
      turn: turn.number,
      start: 60,
      end: 90,
      category: "agreement",
      text: turn.text.slice(60, 90),
      reviewed: true,
    },
  });

  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator(`#turn-${turn.number} .segment`).first().click();
  await page.locator("#detail-recut").click();
  await selectText(page, turn.number, 50, 80);

  await expect(page.locator("#message")).toContainText("überschneidet");
  const after = await (await request.get(`/api/interviews/${FIRST}`)).json();
  expect(after.codings.map((one) => one.start).sort((a, b) => a - b)).toEqual([0, 60]);
});

test("waiting for a passage can be taken back", async ({ page, request }) => {
  const { turn } = await unitWithEverything(request);

  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator(`#turn-${turn.number} .segment`).click();
  await page.locator("#detail-recut").click();
  await page.locator("#detail-recut-cancel").click();

  await expect(page.locator("body")).not.toHaveClass(/anchoring/);
  await expect(page.locator("#detail-recut")).toBeVisible();
  // And the next selection is a new coding unit again, not a move of this one.
  await selectText(page, turn.number, 60, 90);
  await expect(page.locator("#coding-bar")).toBeVisible();
});
