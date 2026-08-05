import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { TEXTS } from "../lib/texts.js";

/**
 * The description, checked against the thing it describes.
 *
 * Documentation is worth exactly as much as its worst sentence, and the worst
 * sentence in an API reference is always the one about a route that changed six
 * months ago. Nobody writes it wrong on purpose; it goes wrong because a route
 * is added in one file and described in another, and only one of the two is in
 * front of you while you work.
 *
 * So the two are compared. Every route `server.js` answers must appear in the
 * document, and every path the document claims must be a route — which turns
 * "somebody should update the docs" from a good intention into a failing test.
 *
 * The error codes are checked the same way. A `code` is a promise to whoever
 * matches on it, and a promise to a program has to name a key that exists.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SERVER = readFileSync(join(ROOT, "server.js"), "utf8");

/**
 * The routes matched by a pattern rather than by a literal, named.
 *
 * Deliberately a list to keep by hand: a regular expression cannot be turned
 * into an OpenAPI path template without guessing what the capture means, and a
 * guess is what this check exists to rule out. A new pattern in `server.js`
 * fails the first assertion below until somebody says what it is called.
 */
const PATTERNS = {
  single: "/api/interviews/{id}",
  categoryMerge: "/api/categories/{id}/merge",
  category: "/api/categories/{id}",
  newCoding: "/api/interviews/{id}/codings",
  oneCoding: "/api/interviews/{id}/codings/{coding}",
  requirementMerge: "/api/requirements/{id}/merge",
  requirement: "/api/requirements/{id}",
  oneFigure: "/api/figures/{name}.svg",
  codingTable: "/api/export/coding-table/{id}.md",
};

/** Every `{path, method}` the server answers, read out of the source. */
function routesInServer() {
  const found = new Set();

  for (const line of SERVER.split("\n")) {
    const literal = line.match(/path === "(\/api\/[^"]+)"/);
    if (literal) {
      const method = line.match(/request\.method === "([A-Z]+)"/)?.[1] ?? "GET";
      found.add(`${method} ${literal[1]}`);
      continue;
    }
    /* `if (single && request.method === "PATCH")` — the pattern's name says
       which route, the condition says which method. A pattern used without a
       method is a route that answers whatever it is asked, and the exports do
       exactly that; those are documented as GET, which is what anybody uses. */
    const guarded = line.match(/if \((\w+) && request\.method === "([A-Z]+)"\)/);
    if (guarded && PATTERNS[guarded[1]]) {
      found.add(`${guarded[2]} ${PATTERNS[guarded[1]]}`);
      continue;
    }
    const bare = line.match(/^\s*if \((\w+)\) \{$/);
    if (bare && PATTERNS[bare[1]]) found.add(`GET ${PATTERNS[bare[1]]}`);
  }
  return found;
}

let spec;

test.beforeAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  const answer = await request.get("/api/openapi.json");
  expect(answer.status()).toBe(200);
  expect(answer.headers()["content-type"]).toContain("application/json");
  spec = await answer.json();
  await request.dispose();
});

test("every pattern route in the server has been given a name", () => {
  const named = [...SERVER.matchAll(/const (\w+) = path\.match\(/g)].map((one) => one[1]);
  const strangers = named.filter((name) => !PATTERNS[name]);
  expect(
    strangers,
    "a route matched by a pattern was added; say what it is called in PATTERNS above " +
      "and describe it in lib/openapi.js",
  ).toEqual([]);
});

test("every route the server answers is described", () => {
  const documented = new Set();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of Object.keys(item)) documented.add(`${method.toUpperCase()} ${path}`);
  }
  const undocumented = [...routesInServer()].filter((route) => !documented.has(route)).sort();
  expect(undocumented, "these routes exist but are not in lib/openapi.js").toEqual([]);
});

test("every described route exists in the server", () => {
  const real = routesInServer();
  const invented = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of Object.keys(item)) {
      if (!real.has(`${method.toUpperCase()} ${path}`)) invented.push(`${method.toUpperCase()} ${path}`);
    }
  }
  expect(invented.sort(), "these are described but the server does not answer them").toEqual([]);
});

test("the document is well formed where a reader or a generator will look", () => {
  expect(spec.openapi).toMatch(/^3\.1\./);
  expect(spec.info.title).toBe("Fundstelle");
  expect(spec.info.license.identifier).toBe("MIT");

  const seen = new Set();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      const where = `${method.toUpperCase()} ${path}`;
      // A generator names its client methods from these; two the same is a
      // client with one of the two calls missing.
      expect(operation.operationId, `${where} has an operationId`).toBeTruthy();
      expect(seen.has(operation.operationId), `${operation.operationId} is used twice`).toBe(false);
      seen.add(operation.operationId);

      expect(operation.summary, `${where} has a summary`).toBeTruthy();
      // Not a formality: every route here does something that has a reason, and
      // the reason is the part that cannot be read off the signature.
      expect(operation.description?.length ?? 0, `${where} is explained`).toBeGreaterThan(60);
      expect(operation.tags?.length, `${where} is filed under a tag`).toBeTruthy();
      expect(Object.keys(operation.responses ?? {}).length, `${where} says what comes back`)
        .toBeGreaterThan(0);

      // A path parameter that is not declared is a hole a generator falls into.
      for (const name of path.matchAll(/\{(\w+)\}/g)) {
        const declared = (operation.parameters ?? []).some(
          (one) => one.in === "path" && one.name === name[1],
        );
        expect(declared, `${where} declares {${name[1]}}`).toBe(true);
      }
    }
  }

  const tags = new Set(spec.tags.map((one) => one.name));
  for (const item of Object.values(spec.paths)) {
    for (const operation of Object.values(item)) {
      for (const tag of operation.tags) expect(tags.has(tag), `${tag} is declared`).toBe(true);
    }
  }
});

test("every reference resolves", () => {
  const missing = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (typeof node.$ref === "string") {
      const name = node.$ref.split("/").pop();
      if (!spec.components.schemas[name]) missing.add(node.$ref);
    }
    Object.values(node).forEach(walk);
  };
  walk(spec.paths);
  walk(spec.components);
  expect([...missing]).toEqual([]);

  // And nothing described that nothing points at: a schema nobody references is
  // either a forgotten route or a leftover, and both are worth noticing.
  const used = new Set();
  const collect = (node) => {
    if (Array.isArray(node)) return node.forEach(collect);
    if (!node || typeof node !== "object") return;
    if (typeof node.$ref === "string") used.add(node.$ref.split("/").pop());
    Object.values(node).forEach(collect);
  };
  collect(spec);
  expect([...Object.keys(spec.components.schemas)].filter((name) => !used.has(name))).toEqual([]);
});

test("every error code named in the document is a real message key", () => {
  const codes = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (typeof node.code === "string") codes.add(node.code);
    // The prose names them too, and a code in a sentence is a promise as much
    // as a code in an example is.
    if (typeof node.description === "string") {
      for (const found of node.description.matchAll(/`(error[A-Z]\w+|figureNeeds\w+)`/g)) {
        codes.add(found[1]);
      }
    }
    Object.values(node).forEach(walk);
  };
  walk(spec);

  const unknown = [...codes].filter((code) => !TEXTS.de[code] && !TEXTS.en[code]).sort();
  expect(unknown, "these codes are documented but no message exists for them").toEqual([]);
  expect(codes.size, "some error codes are documented").toBeGreaterThan(5);
});

test("the reference page renders the whole document", async ({ page }) => {
  const complaints = [];
  page.on("pageerror", (error) => complaints.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") complaints.push(message.text());
  });

  await page.goto("/api/docs?lang=de");
  await expect(page.locator(".api-operation").first()).toBeVisible();

  const operations = Object.values(spec.paths).reduce(
    (n, item) => n + Object.keys(item).length,
    0,
  );
  await expect(page.locator(".api-operation")).toHaveCount(operations);
  // Every operation is reachable from the contents, or the list is decoration.
  await expect(page.locator(".api-nav a[href^='#'] .api-path")).toHaveCount(operations);

  await expect(page.locator("#version")).toContainText("v");
  await expect(page.locator("#intro")).toContainText("Sec-Fetch-Site");
  expect(complaints, "the page renders without complaining").toEqual([]);
});

test("the reference speaks the language it was asked for", async ({ page }) => {
  await page.goto("/api/docs?lang=en");
  await expect(page.locator("#to-application")).toHaveText("Back to the application");
  await page.goto("/api/docs?lang=de");
  await expect(page.locator("#to-application")).toHaveText("Zur Anwendung");
});
