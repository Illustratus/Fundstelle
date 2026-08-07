import { expect, test } from "@playwright/test";

/**
 * The operations a requirement is judged to block.
 *
 * The prioritisation of the catalog rests on two numbers. How many departments
 * name a requirement is counted from the material and cannot be typed in — that
 * is what keeps it tied to what people said. The other is the judgment of what
 * the requirement's absence blocks, and what there was to block was three words
 * compiled into the tool: Ablage, Abruf, Transfer. One study's vocabulary,
 * handed to every other one, on every card, in the export and on the axis of
 * the prioritisation field.
 *
 * They are seeded from those three now and belong to the study afterwards. What
 * matters beyond the wording: an identifier a requirement points at is fixed,
 * an operation that goes leaves no requirement pointing at a ghost — the field
 * counts blocked operations, and a count including something nobody can see is
 * a count nobody can check — and a requirement cannot name one that does not
 * exist, because a checkbox that saves and is gone next time is the worst way
 * to find out that something went wrong.
 */

const operations = async (request) =>
  (await (await request.get("/api/requirements")).json()).operations;

async function clear(request) {
  const catalog = await (await request.get("/api/requirements")).json();
  for (const requirement of catalog.requirements) {
    await request.delete(`/api/requirements/${requirement.id}`);
  }
  for (const operation of catalog.operations) {
    if (!["filing", "retrieval", "transfer"].includes(operation.id)) {
      await request.delete(`/api/operations/${operation.id}`);
    }
  }
}

test.beforeEach(async ({ request }) => {
  await clear(request);
});

test("the three the tool seeds are there, in the language the study was set up in", async ({
  request,
}) => {
  expect(await operations(request)).toEqual([
    { id: "filing", name: "Ablage" },
    { id: "retrieval", name: "Abruf" },
    { id: "transfer", name: "Transfer" },
  ]);
});

test("a study names its own, and renames the ones it was given", async ({ request }) => {
  const made = await request.post("/api/operations", { data: { name: "Wiederauffinden" } });
  expect(made.status()).toBe(201);
  expect(await made.json()).toEqual({ id: "wiederauffinden", name: "Wiederauffinden" });

  const renamed = await (
    await request.patch("/api/operations/filing", { data: { name: "Ablegen" } })
  ).json();
  // The name is the study's; the identifier is what the requirements point at.
  expect(renamed).toEqual({ id: "filing", name: "Ablegen" });

  await request.patch("/api/operations/filing", { data: { name: "Ablage" } });
  await request.delete("/api/operations/wiederauffinden");
});

test("a requirement cannot name an operation the study does not have", async ({ request }) => {
  const requirement = await (
    await request.post("/api/requirements", { data: { title: "Eine Suche über alle Interviews" } })
  ).json();
  const refused = await request.patch(`/api/requirements/${requirement.id}`, {
    data: { blockedOperations: ["telepathie"] },
  });
  expect(refused.status()).toBe(404);
  expect((await refused.json()).code).toBe("errorUnknownOperation");
});

test("dissolving one takes it off every requirement that named it", async ({ request }) => {
  const own = await (
    await request.post("/api/operations", { data: { name: "Wiederauffinden" } })
  ).json();
  const requirement = await (
    await request.post("/api/requirements", { data: { title: "Eine Suche über alle Interviews" } })
  ).json();
  await request.patch(`/api/requirements/${requirement.id}`, {
    data: { blockedOperations: [own.id, "filing"] },
  });

  const gone = await request.delete(`/api/operations/${own.id}`);
  expect(gone.status()).toBe(200);
  // How many gave it up is the size of the change, and the reason the interface
  // can ask before it happens.
  expect((await gone.json()).dropped).toBe(1);

  const after = await (await request.get("/api/requirements")).json();
  expect(after.operations.some((one) => one.id === own.id)).toBe(false);
  expect(after.requirements[0].blockedOperations).toEqual(["filing"]);
});

test("the catalog export names them as the study calls them", async ({ request }) => {
  await request.patch("/api/operations/filing", { data: { name: "Ablegen und Wiederfinden" } });
  const requirement = await (
    await request.post("/api/requirements", { data: { title: "Eine Suche über alle Interviews" } })
  ).json();
  await request.patch(`/api/requirements/${requirement.id}`, {
    data: { blockedOperations: ["filing"] },
  });

  const document = await (
    await request.get("/api/export/requirements-catalog.md?lang=de")
  ).text();
  expect(document).toContain("Ablegen und Wiederfinden");
  await request.patch("/api/operations/filing", { data: { name: "Ablage" } });
});

test("the catalog works on them where the checkboxes are", async ({ page, request }) => {
  await request.post("/api/requirements", { data: { title: "Eine Suche über alle Interviews" } });

  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="catalog"]').click();
  await expect(page.locator(".requirement")).toBeVisible();

  await page.locator("#operations-shell > summary").click();
  await page.locator("#operation-name").fill("Wiederauffinden");
  await page.locator("#operation-new button").click();
  await expect(page.locator("#message")).toContainText("angelegt");

  // A new operation is a checkbox on every card at once — that is the whole
  // point of it being the study's vocabulary rather than one card's field.
  const box = page.locator('.requirement [data-blocked="wiederauffinden"]');
  await expect(box).toBeVisible();
  await box.check();
  await expect(page.locator("#message")).toContainText("Blockiert: Wiederauffinden");

  // And renaming it renames it on the card.
  const field = page.locator('.operation[data-operation="wiederauffinden"] input[type="text"]');
  await field.fill("Wiederfinden");
  await field.blur();
  await expect(page.locator("#message")).toContainText("heißt jetzt");
  await expect(page.locator(".requirement .blocked")).toContainText("Wiederfinden");

  page.on("dialog", (dialog) => dialog.accept());
  await page.locator('.operation[data-operation="wiederauffinden"] [data-operation-remove]').click();
  await expect(page.locator("#message")).toContainText("aufgelöst");
  await expect(page.locator('.requirement [data-blocked="wiederauffinden"]')).toHaveCount(0);
});
