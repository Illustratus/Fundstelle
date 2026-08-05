import { expect, test } from "@playwright/test";

/**
 * A page on another site must not be able to change somebody's study.
 *
 * Binding to 127.0.0.1 keeps the tool off the network. It does nothing at all
 * about the browser already on the machine: any tab, on any website, can send a
 * request to 127.0.0.1, and that address is precisely the one such a page would
 * use. What it cannot do is read the answer — the browser sees to that — so this
 * was never a way to read a study. It was a way to write into one.
 *
 * The gap is that a POST whose content type is `text/plain` or a form encoding
 * counts as simple, and a browser sends it without asking permission first. All
 * three shapes went straight through: coding units appeared in an interview, a
 * category called "Eingeschleust" appeared in the system, and an inductive
 * category could have been dissolved into another one. Months of work, from a
 * page the reader had no reason to distrust. DELETE and PATCH were never
 * reachable this way — those are asked about first.
 *
 * What decides it is what the browser says about where a request came from,
 * which the page cannot forge: `Sec-Fetch-Site`, and `Origin` where that is
 * missing. Neither present means no browser sent it — a script, `curl`, the
 * container's own health check — somebody who ran it themselves.
 */

const ELSEWHERE = "https://evil.example";
const UNIT = { turn: 2, start: 0, end: 30, category: "routine", text: "irgendwas" };
const CATEGORY = {
  name: "Eingeschleust",
  definition: "Von einer fremden Seite angelegt, um zu zeigen, dass es ginge.",
};

test("a write from another site is refused, whatever it dresses up as", async ({ request }) => {
  /* The three that a browser sends without asking first. The fourth shape,
     application/json, was always asked about — it is here so that the check
     does not quietly become a check about content types. */
  const shapes = [
    { "content-type": "text/plain;charset=UTF-8", origin: ELSEWHERE },
    { "content-type": "application/x-www-form-urlencoded", origin: ELSEWHERE },
    { "content-type": "multipart/form-data", origin: ELSEWHERE },
    { "content-type": "application/json", origin: ELSEWHERE },
    { "content-type": "application/json", "sec-fetch-site": "cross-site" },
    { "content-type": "application/json", "sec-fetch-site": "same-site" },
  ];
  for (const headers of shapes) {
    const answer = await request.post("/api/interviews/interview-01/codings", {
      headers,
      data: UNIT,
    });
    expect(answer.status(), JSON.stringify(headers)).toBe(403);
    expect((await answer.json()).code).toBe("errorForeignOrigin");
  }
});

test("nothing a foreign page sends reaches any of the routes that change things", async ({ request }) => {
  const headers = { "content-type": "text/plain", origin: ELSEWHERE };
  const tries = [
    ["post", "/api/categories", CATEGORY],
    ["post", "/api/example", {}],
    ["post", "/api/categories/ind.something/merge", { target: "agreement" }],
    ["post", "/api/requirements", { title: "Eine Anforderung" }],
    ["delete", "/api/interviews/interview-01/codings/whatever", undefined],
    ["patch", "/api/categories/routine", { memo: "x" }],
  ];
  for (const [method, path, data] of tries) {
    const answer = await request[method](path, data ? { headers, data } : { headers });
    expect(answer.status(), `${method} ${path}`).toBe(403);
  }
  // And the study is as it was: no category arrived from anywhere.
  const { categories } = await (await request.get("/api/categories")).json();
  expect(categories.some((one) => one.name === "Eingeschleust")).toBe(false);
});

test("the tool's own page is not affected", async ({ page, request }) => {
  await page.goto("/?lang=de");
  const base = new URL(page.url()).origin;
  for (const headers of [
    { origin: base },
    { origin: base, "sec-fetch-site": "same-origin" },
    { "sec-fetch-site": "none" },
  ]) {
    const answer = await request.post("/api/interviews/interview-01/codings", {
      headers: { ...headers, "content-type": "application/json" },
      data: UNIT,
    });
    expect([201, 409], JSON.stringify(headers)).toContain(answer.status());
    if (answer.status() === 201) {
      const made = await answer.json();
      await request.delete(`/api/interviews/interview-01/codings/${made.id}`);
    }
  }
});

test("an origin of null is not this tool's own page", async ({ request }) => {
  /* What a sandboxed frame and a page opened from a file send. It is a browser
     saying "somewhere", and somewhere is not here. Found by writing this file
     wrong: the check read the page's address before navigating to it, sent
     `Origin: null`, and was refused — correctly. */
  const answer = await request.post("/api/interviews/interview-01/codings", {
    headers: { "content-type": "application/json", origin: "null" },
    data: UNIT,
  });
  expect(answer.status()).toBe(403);
  expect((await answer.json()).code).toBe("errorForeignOrigin");
});

test("a script somebody ran themselves still works", async ({ request }) => {
  /* No Origin and no Sec-Fetch-Site is not a browser. `curl`, a small script,
     the container's health check — all of them are the reader acting on their
     own machine, and this tool is meant to be scriptable. */
  const answer = await request.post("/api/interviews/interview-01/codings", {
    headers: { "content-type": "application/json" },
    data: UNIT,
  });
  expect([201, 409]).toContain(answer.status());
  if (answer.status() === 201) {
    await request.delete(`/api/interviews/interview-01/codings/${(await answer.json()).id}`);
  }
});

test("reading is left alone", async ({ request }) => {
  // A foreign page cannot see these answers anyway, and refusing them would
  // break nothing for an attacker and everything for a link somebody follows.
  for (const path of ["/api/interviews", "/api/categories", "/api/version", "/api/analysis"]) {
    const answer = await request.get(path, { headers: { origin: ELSEWHERE } });
    expect(answer.status(), path).toBe(200);
  }
});

test("coding in the browser still works end to end", async ({ page, request }) => {
  /* The check that matters most: the interface sends its own Origin, and if the
     guard were a shade too strict the whole tool would stop saving and every
     other check here would still pass. */
  // On a clean interview, or the first passage may already be coded and the
  // save be refused for a reason that has nothing to do with origins.
  const existing = await (await request.get("/api/interviews/interview-01")).json();
  for (const coding of existing.codings) {
    await request.delete(`/api/interviews/interview-01/codings/${coding.id}`);
  }
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator("#interview-choice").selectOption("interview-01");
  await expect(page.locator(".turn").first()).toBeVisible();
  const before = await page.locator(".segment").count();
  await page.locator("#transcript").focus();
  await page.keyboard.press("j");
  await page.keyboard.press("s");
  await page.keyboard.press("1");
  await expect(page.locator(".segment")).toHaveCount(before + 1);
  await expect(page.locator("#message")).not.toContainText("anderen Seite");
});
