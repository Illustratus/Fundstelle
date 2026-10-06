import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { sidePort } from "./sandbox.mjs";
import { startStudy, twoRounds } from "./evaluation-study.mjs";
import { applySessionOp, placeSections, shapeSession } from "../lib/session.js";
import { parseTranscript } from "../lib/transcript.js";

/**
 * The interview log, and the transcript it turns into.
 *
 * During a live interview the interviewer marks when each block of the guide
 * begins, ticks what has been addressed, marks the read-out list and writes a
 * note now and then. All of it is stored before a transcript exists — in the
 * folder the transcript will later be written into — and when the recording
 * is brought in, the guide's sections are put where the blocks began.
 *
 * The placement is the part worth checking hardest: a section line in the
 * wrong place moves every citation of that block into the neighbouring
 * section, and nothing on the screen would look wrong.
 */

const BLOCKS = [
  {
    id: "warmfrage",
    name: "Warmfrage",
    prompt: "",
    checklist: [],
    mandatory: [{ id: "m-warm", text: "Wie geht es?" }],
  },
  {
    id: "1-ablage",
    name: "1 · Ablage (Wissen festhalten)",
    prompt: "Erzählen Sie.",
    checklist: [{ id: "c-confirm", text: "Bestätigungsschritt", tag: "Erwarteter Aufwand" }],
    mandatory: [],
  },
  {
    id: "5-systeme",
    name: "5 · Systemlandschaft",
    prompt: "",
    checklist: [],
    mandatory: [],
    readout: { label: "Systeme", perDepartment: { Vertrieb: ["Postfach", "Laufwerk", "Chat"] } },
  },
];

/* The rule, on its own -------------------------------------------------------- */

const turns = [
  { speaker: "Anna", at: 2, text: "Wie geht es?" },
  { speaker: "Jonas", at: 6, text: "Gut." },
  { speaker: "Anna", at: 30, text: "Erzählen Sie, wie Sie ablegen." },
  { speaker: "Jonas", at: 41, text: "Ich lege ab." },
  { speaker: "Anna", at: 90, text: "Welche Systeme?" },
  { speaker: "Jonas", at: 97, text: "Das Postfach." },
];

const log = (starts) => shapeSession({ department: "Vertrieb", t0: "2026-10-14T09:00:00.000Z", blockStarts: starts });

test("a block pressed while the prompt is being asked begins with the prompt", () => {
  // At 33 the interviewer is three seconds into the question.
  const { placed } = placeSections(turns, log([{ block: "1-ablage", at: 33 }]), BLOCKS, {
    interviewer: "Anna",
  });
  expect(placed).toEqual([
    { block: "1-ablage", name: BLOCKS[1].name, at: 33, before: 2, turn: 3, turnAt: 30 },
  ]);
});

test("a block pressed before the prompt, or while the last answer runs, begins with the next turn", () => {
  const before = placeSections(turns, log([{ block: "1-ablage", at: 25 }]), BLOCKS, { interviewer: "Anna" });
  expect(before.placed[0].before).toBe(2);
  // At 85 the previous answer is still running; the prompt at 90 opens it.
  const running = placeSections(turns, log([{ block: "5-systeme", at: 85 }]), BLOCKS, { interviewer: "Anna" });
  expect(running.placed[0].before).toBe(4);
  // Before the first turn at all: the first turn.
  const early = placeSections(turns, log([{ block: "warmfrage", at: 0 }]), BLOCKS, { interviewer: "Anna" });
  expect(early.placed[0].before).toBe(0);
});

test("what cannot be placed is said so, with the reason, and never moved nearby", () => {
  const { placed, unplaced } = placeSections(
    turns,
    log([
      { block: "gone", at: 10 },
      { block: "1-ablage", at: null },
      { block: "5-systeme", at: 400 },
      { block: "warmfrage", at: 1 },
    ]),
    BLOCKS,
    { interviewer: "Anna" },
  );
  expect(placed.map((one) => one.block)).toEqual(["warmfrage"]);
  expect(unplaced.map((one) => [one.block, one.reason])).toEqual([
    ["gone", "sectionUnknownBlock"],
    ["1-ablage", "sectionNoOffset"],
    ["5-systeme", "sectionAfterLastTurn"],
  ]);
  const untimed = placeSections(
    turns.map((one) => ({ ...one, at: null })),
    log([{ block: "warmfrage", at: 1 }]),
    BLOCKS,
  );
  expect(untimed.unplaced[0].reason).toBe("sectionNoTimes");
});

test("correcting t0 keeps every event at the moment it happened", () => {
  let session = log([]);
  session = applySessionOp(session, { op: "block", block: "1-ablage", at: 40 }, { blocks: BLOCKS });
  session = applySessionOp(session, { op: "tick", item: "c-confirm", at: 55 }, { blocks: BLOCKS });
  // The recording turned out to have started ten seconds earlier.
  session = applySessionOp(session, { op: "start", t0: "2026-10-14T08:59:50.000Z" }, { blocks: BLOCKS });
  expect(session.blockStarts[0].at).toBe(50);
  expect(session.ticks["c-confirm"]).toBe(65);
  // And measured from t0 when no time is given.
  const now = Date.parse("2026-10-14T09:01:00.000Z");
  session = applySessionOp(session, { op: "block", block: "5-systeme" }, { blocks: BLOCKS, now });
  expect(session.blockStarts[1].at).toBe(70);
  // Without a t0 there is no time, rather than an invented one.
  const bare = applySessionOp(shapeSession({ department: "Vertrieb" }), { op: "block", block: "1-ablage" }, {
    blocks: BLOCKS,
  });
  expect(bare.blockStarts[0].at).toBeNull();
});

/* Over HTTP ------------------------------------------------------------------ */

let study;

test.describe("over HTTP", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    study = await startStudy({ port: sidePort(4177) });
    await twoRounds(study);
    await study.put("/api/rounds/evaluation/guide", { blocks: BLOCKS });
  });

  test.afterAll(() => study?.stop());

  const folder = () => join(study.transcripts, "evaluation-vertrieb");

  test("a log is opened before there is a transcript, and the rest of the tool does not see it", async () => {
    const opened = await study.post("/api/sessions", { department: "Vertrieb", round: "evaluation" });
    expect(opened.status).toBe(201);
    expect(opened.json.id).toBe("evaluation-vertrieb");
    expect(opened.json.transcript).toBe(false);
    expect(opened.json.round).toBe("evaluation");
    expect(opened.json.blocks.map((one) => one.id)).toEqual(BLOCKS.map((one) => one.id));
    expect(opened.json.readoutItems).toEqual({ "5-systeme": ["Postfach", "Laufwerk", "Chat"] });

    expect(readdirSync(folder())).toEqual(["session.json"]);
    // Not an interview: no transcript.
    const interviews = (await study.get("/api/interviews")).json;
    expect(interviews.some((one) => one.id === "evaluation-vertrieb")).toBe(false);
    // But a planned one of its round.
    const rounds = (await study.get("/api/rounds")).json.rounds;
    expect(rounds[1].planned).toEqual(["evaluation-vertrieb"]);

    const listed = (await study.get("/api/sessions")).json.sessions;
    expect(listed).toEqual([
      {
        id: "evaluation-vertrieb",
        round: "evaluation",
        department: "Vertrieb",
        transcript: false,
        t0: null,
        current: null,
        blocks: 0,
        ticks: 0,
        notes: 0,
      },
    ]);

    expect((await study.post("/api/sessions", { department: "Vertrieb", round: "evaluation" })).json.code).toBe(
      "errorSessionExists",
    );
    expect((await study.post("/api/sessions", { department: "Vertrieb" })).json.code).toBe("errorRoundRequired");
    expect((await study.post("/api/sessions", { round: "evaluation" })).json.code).toBe("errorDepartmentRequired");
    expect((await study.post("/api/sessions", { department: "X", round: "nowhere" })).status).toBe(404);
  });

  test("each step of the interview is one operation, and the log answers whole", async () => {
    const step = (op) => study.patch("/api/sessions/evaluation-vertrieb", op);

    let answer = await step({ op: "start", t0: "2026-10-14T09:00:00.000Z" });
    expect(answer.json.t0).toBe("2026-10-14T09:00:00.000Z");
    await step({ op: "block", block: "warmfrage", at: 1 });
    await step({ op: "tick", item: "m-warm", at: 4 });
    await step({ op: "block", block: "1-ablage", at: 33 });
    answer = await step({ op: "tick", item: "c-confirm", at: 50 });
    expect(answer.json.ticks).toEqual({ "m-warm": 4, "c-confirm": 50 });
    // Ticking twice keeps the first time.
    answer = await step({ op: "tick", item: "c-confirm", at: 70 });
    expect(answer.json.ticks["c-confirm"]).toBe(50);

    answer = await step({ op: "note", text: "Zögert beim Bestätigungsschritt.", at: 52 });
    const note = answer.json.notes[0];
    // Filed under the block the conversation is in.
    expect(note).toMatchObject({ block: "1-ablage", at: 52, text: "Zögert beim Bestätigungsschritt." });
    answer = await step({ op: "edit-note", note: note.id, text: "Zögert lange beim Bestätigungsschritt." });
    expect(answer.json.notes[0].text).toBe("Zögert lange beim Bestätigungsschritt.");

    await step({ op: "block", block: "5-systeme", at: 85 });
    await step({ op: "readout", block: "5-systeme", item: "Postfach", state: "still" });
    await step({ op: "readout", block: "5-systeme", item: "Laufwerk", state: "no-longer" });
    answer = await step({ op: "readout", block: "5-systeme", item: "Chat", state: "still" });
    answer = await step({ op: "readout", block: "5-systeme", item: "Chat", state: null });
    expect(answer.json.readout).toEqual({ "5-systeme": { Postfach: "still", Laufwerk: "no-longer" } });
    expect(answer.json.current).toBe("5-systeme");

    // A start pressed by mistake is taken back.
    await step({ op: "block", block: "warmfrage", at: 88 });
    answer = await step({ op: "unblock", block: "warmfrage" });
    expect(answer.json.blockStarts).toEqual([
      { block: "warmfrage", at: 1 },
      { block: "1-ablage", at: 33 },
      { block: "5-systeme", at: 85 },
    ]);

    // And a note can go again.
    const extra = (await step({ op: "note", text: "weg damit" })).json.notes.at(-1);
    answer = await step({ op: "delete-note", note: extra.id });
    expect(answer.json.notes).toHaveLength(1);

    // On disk: the log, in a fixed order, without anything the screen adds.
    const saved = JSON.parse(readFileSync(join(folder(), "session.json"), "utf8"));
    expect(Object.keys(saved)).toEqual(["version", "department", "t0", "blockStarts", "ticks", "readout", "notes"]);
  });

  test("the log reads back with its guide, and a block it started cannot leave the guide", async () => {
    const read = await study.get("/api/sessions/evaluation-vertrieb");
    expect(read.status).toBe(200);
    expect(read.json).toMatchObject({ id: "evaluation-vertrieb", round: "evaluation", department: "Vertrieb" });
    expect(read.json.blocks).toHaveLength(BLOCKS.length);
    expect((await study.get("/api/sessions/nobody")).json.code).toBe("errorUnknownSession");

    const refused = await study.del("/api/rounds/evaluation/guide/blocks/5-systeme");
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe("errorBlockInUse");
    // Nor by rewriting the guide without it, nor by dropping an item it ticked.
    const without = await study.put("/api/rounds/evaluation/guide", { blocks: BLOCKS.slice(0, 2) });
    expect(without.json.code).toBe("errorBlockInUse");
    const unticked = await study.patch("/api/rounds/evaluation/guide/blocks/1-ablage", { checklist: [] });
    expect(unticked.json.code).toBe("errorGuideItemInUse");
  });

  test("an operation that cannot be carried out is refused by name", async () => {
    const step = (op, lang = "de") => study.patch(`/api/sessions/evaluation-vertrieb?lang=${lang}`, op);
    expect((await step({ op: "fly" })).json.code).toBe("errorSessionOp");
    expect((await step({ op: "block", block: "nope" })).json.code).toBe("errorUnknownBlock");
    expect((await step({ op: "tick", item: "nope" })).json.code).toBe("errorUnknownGuideItem");
    expect((await step({ op: "unblock", block: "1-ablage", at: 1 })).status).toBe(200);
    expect((await step({ op: "block", block: "1-ablage", at: 33 })).status).toBe(200);
    expect((await step({ op: "note", text: "  " })).json.code).toBe("errorNoteText");
    expect((await step({ op: "delete-note", note: "nope" })).json.code).toBe("errorUnknownNote");
    expect((await step({ op: "readout", block: "warmfrage", item: "Postfach", state: "still" })).json.code).toBe(
      "errorNoReadout",
    );
    expect((await step({ op: "readout", block: "5-systeme", item: "Fax", state: "still" })).json.code).toBe(
      "errorUnknownReadoutItem",
    );
    expect((await step({ op: "readout", block: "5-systeme", item: "Postfach", state: "maybe" })).json.code).toBe(
      "errorReadoutState",
    );
    expect((await step({ op: "start", t0: "gestern" })).json.code).toBe("errorTimeShape");
    expect((await step({ op: "block", block: "1-ablage", at: "x" })).json.code).toBe("errorTimeShape");
    expect((await step({ op: "fly" }, "en")).json.error).toBe("Unknown operation fly on the interview log.");
    expect((await step({ op: "fly" }, "de")).json.error).toBe("Unbekannte Operation fly am Gesprächsprotokoll.");
    expect((await study.patch("/api/sessions/nobody", { op: "start" })).json.code).toBe("errorUnknownSession");
  });

  test("a page on another site cannot write into the log", async () => {
    const foreign = await study.patch(
      "/api/sessions/evaluation-vertrieb",
      { op: "note", text: "von außen" },
      { origin: "https://example.org" },
    );
    expect(foreign.status).toBe(403);
    expect(foreign.json.code).toBe("errorForeignOrigin");
    const site = await study.post(
      "/api/sessions",
      { department: "Einkauf", round: "evaluation" },
      { "sec-fetch-site": "cross-site" },
    );
    expect(site.status).toBe(403);
  });

  const VTT = `WEBVTT

00:00:02.000 --> 00:00:05.000
<v Anna Berger>Wie geht es Ihnen heute?</v>

00:00:06.000 --> 00:00:20.000
<v Jonas Klein>Gut, danke der Nachfrage.</v>

00:00:30.000 --> 00:00:40.000
<v Anna Berger>Erzählen Sie, wie Sie zuletzt etwas abgelegt haben.</v>

00:00:41.000 --> 00:01:20.000
<v Jonas Klein>Ich habe das Angebot abgelegt, ohne Extrazeit.</v>

00:01:30.000 --> 00:01:36.000
<v Anna Berger>Welche Systeme durchsuchen Sie noch von Hand?</v>

00:01:37.000 --> 00:01:50.000
<v Jonas Klein>Nur noch das Postfach.</v>
`;

  test("reading the recording shows where the sections would go, and writes nothing", async () => {
    const read = await study.post("/api/import/read", {
      text: VTT,
      folder: "evaluation-vertrieb",
      interviewer: "Anna Berger",
    });
    expect(read.status).toBe(200);
    expect(read.json.sections.placed.map((one) => [one.block, one.turn])).toEqual([
      ["warmfrage", 1],
      ["1-ablage", 3],
      ["5-systeme", 5],
    ]);
    expect(existsSync(join(folder(), "final.md"))).toBe(false);
    // Without a log in the folder there is nothing to show.
    const plain = await study.post("/api/import/read", { text: VTT, folder: "elsewhere" });
    expect(plain.json.sections).toBeUndefined();
  });

  test("the import puts the guide's sections where the blocks began", async () => {
    const made = await study.post("/api/import", {
      text: VTT,
      folder: "evaluation-vertrieb",
      interviewer: "Anna Berger",
      lang: "de",
    });
    expect(made.status).toBe(201);
    expect(made.json.interview).toBe("evaluation-vertrieb");
    // The department comes from the log when the import names none.
    expect(made.json.title).toBe("Interview: Vertrieb");
    expect(made.json.sections.unplaced).toEqual([]);

    const text = readFileSync(join(folder(), "final.md"), "utf8");
    const parsed = parseTranscript(text, "evaluation-vertrieb");
    expect(parsed.problems).toEqual([]);
    expect(parsed.department).toBe("Vertrieb");
    expect(parsed.sections.map((one) => one.name)).toEqual(BLOCKS.map((one) => one.name));
    // Each turn sits in the section of the block it was said in.
    expect(parsed.turns.map((turn) => [turn.number, turn.section])).toEqual([
      [1, 0],
      [2, 0],
      [3, 1],
      [4, 1],
      [5, 2],
      [6, 2],
    ]);
    // The log stays beside the transcript, and the interview is now one.
    expect(existsSync(join(folder(), "session.json"))).toBe(true);
    const one = (await study.get("/api/interviews")).json.find((each) => each.id === "evaluation-vertrieb");
    expect(one).toMatchObject({ round: "evaluation", department: "Vertrieb", sections: 3 });
    expect((await study.get("/api/sessions")).json.sessions[0].transcript).toBe(true);
  });

  test("a block that cannot be placed is named, and the rest is placed anyway", async () => {
    await study.post("/api/sessions", { department: "Einkauf", round: "evaluation", folder: "spaet" });
    await study.patch("/api/sessions/spaet", { op: "start", t0: "2026-10-14T10:00:00.000Z" });
    await study.patch("/api/sessions/spaet", { op: "block", block: "warmfrage", at: 0 });
    await study.patch("/api/sessions/spaet", { op: "block", block: "5-systeme", at: 900 });
    const made = await study.post("/api/import?lang=en", {
      text: VTT,
      folder: "spaet",
      interviewer: "Anna Berger",
    });
    expect(made.json.sections.placed.map((one) => one.block)).toEqual(["warmfrage"]);
    expect(made.json.sections.unplaced).toEqual([
      {
        block: "5-systeme",
        name: "5 · Systemlandschaft",
        at: 900,
        reason: "sectionAfterLastTurn",
        why: "The block starts after the recording's last turn.",
      },
    ]);
  });

  test("without a log, or when asked not to, the import is what it always was", async () => {
    const plain = await study.post("/api/import", { text: VTT, folder: "ohne-log", interviewer: "Anna Berger" });
    expect(plain.status).toBe(201);
    expect(plain.json.sections).toBeUndefined();
    expect(readFileSync(join(study.transcripts, "ohne-log", "final.md"), "utf8")).not.toContain("## Section");

    await study.post("/api/sessions", { department: "Marketing", round: "evaluation", folder: "abgewaehlt" });
    await study.patch("/api/sessions/abgewaehlt", { op: "block", block: "warmfrage", at: 0 });
    const off = await study.post("/api/import", {
      text: VTT,
      folder: "abgewaehlt",
      interviewer: "Anna Berger",
      sections: false,
    });
    expect(off.json.sections).toBeUndefined();
    expect(readFileSync(join(study.transcripts, "abgewaehlt", "final.md"), "utf8")).not.toContain("## Section");
  });

  test("a log goes on its own, and takes its folder only when nothing else is in it", async () => {
    await study.post("/api/sessions", { department: "Einkauf", round: "evaluation", folder: "abgesagt" });
    expect((await study.del("/api/sessions/abgesagt")).status).toBe(204);
    expect(existsSync(join(study.transcripts, "abgesagt"))).toBe(false);
    const saved = JSON.parse(readFileSync(join(study.folder, "study.json"), "utf8"));
    expect(saved.assignments.abgesagt).toBeUndefined();

    // Beside a transcript only the log goes.
    expect((await study.del("/api/sessions/spaet")).status).toBe(204);
    expect(readdirSync(join(study.transcripts, "spaet"))).toEqual(["final.md"]);
    expect((await study.del("/api/sessions/spaet")).json.code).toBe("errorUnknownSession");
  });
});
