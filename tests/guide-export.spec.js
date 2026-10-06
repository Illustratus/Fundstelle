import { expect, test } from "@playwright/test";

import { sidePort } from "./sandbox.mjs";
import { SECOND_ROUND, startStudy, twoRounds } from "./evaluation-study.mjs";

/**
 * The guide of a round, written out for the appendix.
 *
 * The appendix used to be kept by hand beside the guide the tool holds, and two
 * copies of an instrument drift. The export prints the tool's copy in the shape
 * a thesis sets it — and it must not say who is missing: the read-out lists of
 * a later round name only the departments that are in it, once there are any.
 */

let study;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  study = await startStudy({ port: sidePort(4161) });
});

test.afterAll(() => study?.stop());

const GUIDE = {
  blocks: [
    { name: "Warmfrage", prompt: "Erzähl kurz, wofür du das Werkzeug genutzt hast." },
    {
      name: "1 · Ablage (Wissen festhalten)",
      prompt: "Erzähl vom letzten Mal, dass du etwas festgehalten hast.",
      checklist: [
        "Was das Festhalten leicht oder schwer macht",
        "Wie der Bestätigungsschritt erlebt wurde",
        { text: "Was bringt dir das Werkzeug?", tag: "erwarteter Leistungsgewinn" },
      ],
      mandatory: [
        { text: "Stand im Dokument etwas, das du so nicht gesagt hast?", condition: "wenn festgehalten" },
        { text: "Wie wirkt sich das aus?", tag: "Gegenprobe" },
      ],
    },
    {
      name: "5 · Systemlandschaft",
      prompt: "Das hast du im ersten Gespräch genannt. Wie sieht das heute aus?",
      checklist: ["Welche davon noch selbst durchsucht werden"],
      readout: {
        label: "Vorzulesende Systeme je Bereich",
        perDepartment: {
          Marketing: ["Chat", "Ordner"],
          Vertrieb: ["Postfach", "Laufwerk"],
          Einkauf: ["Laufwerk", "Mail"],
          Lager: ["Zettel"],
        },
      },
    },
  ],
};

const guide = (lang, round = "evaluation") =>
  study.get(`/api/export/guide.md?round=${round}&lang=${lang}`);

test("without a round there is no guide to print, and it says why", async () => {
  const answer = await study.get("/api/export/guide.md?lang=de");
  expect(answer.status).toBe(400);
  expect(answer.json.code).toBe("errorRoundRequired");
});

test("a guide written before its interviews is printed whole, in the thesis's shape", async () => {
  await twoRounds(study);
  // Back to the first round for the moment: the second has no interview yet.
  await study.post("/api/rounds/requirements/assign", { interviews: Object.keys(SECOND_ROUND) });
  expect((await study.put("/api/rounds/evaluation/guide", GUIDE)).status).toBe(200);

  const answer = await guide("de");
  expect(answer.status).toBe(200);
  expect(answer.text).toBe(
    [
      "**Warmfrage.** Erzähl kurz, wofür du das Werkzeug genutzt hast.",
      "",
      "**1 · Ablage (Wissen festhalten).** Erzähl vom letzten Mal, dass du etwas festgehalten hast.",
      "",
      "- *Check-Liste.* Was das Festhalten leicht oder schwer macht · Wie der Bestätigungsschritt erlebt wurde",
      "- *Check-Liste, erwarteter Leistungsgewinn.* Was bringt dir das Werkzeug?",
      "- *Pflichtfrage, wenn festgehalten.* Stand im Dokument etwas, das du so nicht gesagt hast?",
      "- *Pflichtfrage, Gegenprobe.* Wie wirkt sich das aus?",
      "",
      "**5 · Systemlandschaft.** Das hast du im ersten Gespräch genannt. Wie sieht das heute aus?",
      "",
      "- *Check-Liste.* Welche davon noch selbst durchsucht werden",
      "- *Vorzulesende Systeme je Bereich.*",
      "  - *Marketing.* Chat, Ordner",
      "  - *Vertrieb.* Postfach, Laufwerk",
      "  - *Einkauf.* Laufwerk, Mail",
      "  - *Lager.* Zettel",
      "",
    ].join("\n"),
  );
});

test("the labels follow the language; the guide's own words do not", async () => {
  const answer = await guide("en");
  expect(answer.text).toContain("- *Checklist.* Was das Festhalten leicht");
  expect(answer.text).toContain("- *Checklist, erwarteter Leistungsgewinn.* Was bringt");
  expect(answer.text).toContain("- *Mandatory question, wenn festgehalten.* Stand im Dokument");
  expect(answer.text).toContain("- *Mandatory question, Gegenprobe.* Wie wirkt");
  expect(answer.text).not.toMatch(/Check-Liste|Pflichtfrage/);
});

test("once the round has interviews, a department that is not in it is not named", async () => {
  await study.post("/api/rounds/evaluation/assign", { interviews: Object.keys(SECOND_ROUND) });
  for (const lang of ["de", "en"]) {
    const text = (await guide(lang)).text;
    expect(text).toContain("  - *Marketing.* Chat, Ordner");
    expect(text).toContain("  - *Vertrieb.* Postfach, Laufwerk");
    expect(text).toContain("  - *Einkauf.* Laufwerk, Mail");
    expect(text, "the department the second round did not reach").not.toContain("Lager");
    expect(text).not.toContain("Zettel");
  }
  // The first round's guide is not touched by any of this.
  expect((await guide("de", "requirements")).text).toBe(
    "Der Leitfaden der Runde „Anforderungserhebung“ hat noch keinen Block.\n",
  );
  expect((await guide("en", "requirements")).text).toBe(
    "The guide of the round “Anforderungserhebung” has no block yet.\n",
  );
});

test("an interview under way counts as reached before it is transcribed", async () => {
  await study.post("/api/rounds", { name: "Nachfrage", id: "follow-up" });
  await study.put("/api/rounds/follow-up/guide", GUIDE);
  // Planned, nobody yet: the whole guide.
  expect((await guide("de", "follow-up")).text).toContain("  - *Lager.* Zettel");

  const log = await study.post("/api/sessions", { department: "Lager", round: "follow-up" });
  expect(log.status).toBe(201);
  const text = (await guide("de", "follow-up")).text;
  expect(text).toContain("  - *Lager.* Zettel");
  expect(text).not.toContain("Vertrieb");
  expect(text).not.toContain("Marketing");
  await study.del(`/api/sessions/${log.json.id}`);
});

test("the last round is the default, and an unknown one is named", async () => {
  // follow-up is the last round now, and has its guide.
  expect((await study.get("/api/export/guide.md?lang=de")).text).toBe((await guide("de", "follow-up")).text);
  const unknown = await study.get("/api/export/guide.md?round=nope&lang=de");
  expect(unknown.status).toBe(404);
  expect(unknown.json.code).toBe("errorUnknownRound");
});

test("a guide nobody numbered is numbered in order", async () => {
  await study.put("/api/rounds/follow-up/guide", {
    blocks: [
      { name: "Ablage", prompt: "Erzähl.", mandatory: ["Wie lief das?"] },
      { name: "Abruf", prompt: "Wo suchst du zuerst?" },
      { name: "Wie geht es weiter?" },
    ],
  });
  expect((await guide("de", "follow-up")).text).toBe(
    [
      "**1 · Ablage.** Erzähl.",
      "",
      "- *Pflichtfrage.* Wie lief das?",
      "",
      "**2 · Abruf.** Wo suchst du zuerst?",
      "",
      "**3 · Wie geht es weiter?**",
      "",
    ].join("\n"),
  );
});
