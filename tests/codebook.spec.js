import { expect, test } from "@playwright/test";

import { codebookFrom, projectFile, projectXML, readCodebook } from "../lib/refi.js";

/**
 * A category system coming in from another program.
 *
 * The other direction of the REFI-QDA export, and only as far as it can be done
 * honestly. A category system travels: names, definitions, and what sits under
 * what. A study does not — another program's plain text is not this format's
 * turns and guide prompts, and inventing speakers and sections to hang their
 * character offsets on would produce a transcript nobody said. So the codes come
 * and the material stays where it is, and the answer says so by only ever
 * mentioning categories.
 *
 * The awkward parts are what somebody else's file actually contains: numeric
 * character references, because a codebook written in German is mostly `&#228;`
 * and a category called `Abl&#228;ufe` is worse than one that failed to arrive;
 * nesting deeper than this tool's two levels; and codes with no description at
 * all.
 */

const QDC =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<CodeBook xmlns="urn:QDA-XML:codebook:1:0"><Codes>` +
  `<Code guid="a" name="Wissensweitergabe" isCodable="true" color="#6C8EBF">` +
  `<Description>Wie Wissen von einer Person zur n&#228;chsten kommt.</Description>` +
  `<Code guid="b" name="M&#252;ndlich"><Description>Weitergabe im Gespr&#228;ch, ohne Notiz.</Description></Code>` +
  `<Code guid="c" name="Schriftlich"><Description>Weitergabe &#xFC;ber ein Dokument.</Description>` +
  `<Code guid="c2" name="Protokoll"><Description>Drei Ebenen tief.</Description></Code></Code></Code>` +
  `<Code guid="d" name="Werkzeugbruch"/>` +
  `</Codes></CodeBook>`;

const send = (request, xml) =>
  request.post("/api/categories/codebook", {
    data: { file: Buffer.from(xml, "utf8").toString("base64") },
  });

async function clean(request) {
  // Whatever an earlier check left behind, so the counts here are this one's.
  const { categories } = await (await request.get("/api/categories")).json();
  for (const one of categories.filter((each) => each.origin !== "deductive").reverse()) {
    await request.delete(`/api/categories/${encodeURIComponent(one.id)}`);
  }
}

test("the codes are read with their nesting and their descriptions", () => {
  const codes = readCodebook(QDC);
  expect(codes.map((one) => one.name)).toEqual([
    "Wissensweitergabe",
    "Mündlich",
    "Schriftlich",
    "Protokoll",
    "Werkzeugbruch",
  ]);
  expect(codes[0].parent).toBe(null);
  expect(codes[1].parent).toBe("Wissensweitergabe");
  expect(codes[3].parent).toBe("Schriftlich");
  expect(codes[3].depth).toBe(2);
  // A code with no description of its own is a code, not a failure.
  expect(codes[4].definition).toBe("");
});

test("what another program wrote in entities arrives as letters", () => {
  const codes = readCodebook(QDC);
  expect(codes[1].name).toBe("Mündlich");
  expect(codes[0].definition).toBe("Wie Wissen von einer Person zur nächsten kommt.");
  // Decimal above, hexadecimal here: both are what a file in the wild holds.
  expect(codes[2].definition).toBe("Weitergabe über ein Dokument.");
  expect(readCodebook(`<Codes><Code name="A &amp; B"/></Codes>`)[0].name).toBe("A & B");
});

test("this tool's own export reads back as the system it came from", () => {
  const { xml } = projectXML({
    studies: [],
    categories: [
      { id: "a", name: "Arbeitsalltag", definition: "Wiederkehrende Abläufe.", parent: null, codingRules: ["Nur wenn es wiederkehrt"] },
      { id: "b", name: "Störungen", definition: "Unterbrechungen.", parent: "a", codingRules: [] },
    ],
    name: "T",
  });
  const back = readCodebook(xml);
  expect(back.map((one) => one.name)).toEqual(["Arbeitsalltag", "Störungen"]);
  expect(back[1].parent).toBe("Arbeitsalltag");
  // The coding rules travel inside the definition, which is where they were put.
  expect(back[0].definition).toContain("Nur wenn es wiederkehrt");
});

test("a whole .qdpx is unpacked to find the codes in it", () => {
  const file = projectFile({
    studies: [],
    categories: [{ id: "a", name: "Ablage", definition: "Wo etwas landet.", parent: null, codingRules: [] }],
    name: "T",
  });
  /* Written by this tool here, but the reader is the general one: it finds the
     central directory, inflates what it needs and ignores the rest. */
  expect(codebookFrom(file)).toContain("urn:QDA-XML:project:1.0");
  expect(readCodebook(codebookFrom(file))[0].name).toBe("Ablage");
});

test("a file that is not a code system says so rather than half-working", () => {
  expect(() => codebookFrom(Buffer.from("PK not really a zip"))).toThrow();
  expect(readCodebook("<html><body>Kein Codesystem</body></html>")).toEqual([]);
});

/* And through the interface, where somebody's own file arrives. */

test("importing a codebook adds the categories with their shape", async ({ request }) => {
  await clean(request);
  const answer = await send(request, QDC);
  expect(answer.status()).toBe(201);
  const { added, skipped, categories } = await answer.json();
  expect(added).toEqual(["Wissensweitergabe", "Mündlich", "Schriftlich", "Protokoll", "Werkzeugbruch"]);
  expect(skipped).toEqual([]);

  const by = (name) => categories.find((one) => one.name === name);
  expect(by("Mündlich").parent).toBe(by("Wissensweitergabe").id);
  expect(by("Wissensweitergabe").parent).toBe(null);
  /* Two levels, as everywhere here. A code three deep hangs on the top of its
     own branch rather than being dropped or making a third level. */
  expect(by("Protokoll").parent).toBe(by("Wissensweitergabe").id);
  expect(by("Werkzeugbruch").definition).toBe("");
  await clean(request);
});

test("running it twice adds nothing and says why", async ({ request }) => {
  await clean(request);
  await send(request, QDC);
  const again = await send(request, QDC);
  const { added, skipped } = await again.json();
  expect(added).toEqual([]);
  expect(skipped).toHaveLength(5);
  expect(skipped[0].why).toBeTruthy();
  await clean(request);
});

test("a file with no codes in it is refused, not counted as success", async ({ request }) => {
  const answer = await send(request, `<CodeBook><Codes></Codes></CodeBook>`);
  expect(answer.status()).toBe(422);
  expect((await answer.json()).code).toBe("errorCodebookEmpty");

  const nonsense = await request.post("/api/categories/codebook", { data: { file: "" } });
  expect(nonsense.status()).toBe(400);
});

test("the panel offers it and says what it does and does not bring", async ({ page, request }) => {
  await clean(request);
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");

  const shell = page.locator("#codebook-shell");
  await expect(shell).toBeVisible();
  await shell.locator("summary").click();
  // The programs by name, because "interchange format" answers nobody's question.
  await expect(shell).toContainText("MAXQDA");
  await expect(shell).toContainText(".qdc");
  // And the honest half: the codes come, the material does not.
  await expect(shell).toContainText("Material bleibt");

  await page.locator("#codebook-file").setInputFiles({
    name: "codesystem.qdc",
    mimeType: "application/xml",
    buffer: Buffer.from(QDC, "utf8"),
  });
  await expect(page.locator("#message")).toContainText("5");
  // It is in the panel straight away, with the umlaut it was written with.
  await expect(page.locator("#categories")).toContainText("Mündlich");
  await clean(request);
});
