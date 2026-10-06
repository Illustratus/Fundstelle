/**
 * The routes of the second round: rounds and guides, the interview log, and
 * the comparisons that need both rounds.
 *
 * Kept out of `server.js` because they are one feature and read best together,
 * and because `server.js` is where everything else is added; the request
 * boundary — origin check, language, error wording — is still the server's,
 * which calls `evaluationRoutes` before it gives up on a path. A route here is
 * written in the same shape as one there, `path === "…" && request.method ===
 * "…"` on one line, because `tests/openapi.spec.js` reads both files for routes
 * and compares them with the description.
 *
 * Every write goes through the store's turn-taking and atomic write, like
 * everything else; nothing here touches a transcript.
 */

import { mkdir, readdir, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { fail } from "./texts.js";
import { folderName } from "./import.js";
import { Study, guideItems } from "./rounds.js";
import {
  applySessionOp,
  changeSession,
  currentBlock,
  readSession,
  sessionFile,
  writeSession,
} from "./session.js";
import { checkedCriteria, evaluatePropositions, panelComparison, tagReport } from "./panel.js";
import { loadTranscript } from "./transcript.js";

const bad = (key, params, status = 400) => Object.assign(fail(key, params), { status });

const exists = (path) => stat(path).then(() => true, () => false);

/**
 * What the material in a round already refers to in its guide: the items
 * ticked in an interview log or named by a coding unit, and how many logs
 * started each block. A guide may be reworded freely; these may not be dropped.
 */
async function referencesIn(round, { store, study, data }) {
  const used = new Set();
  const startedBlocks = new Map();
  for (const folder of await study.folders()) {
    if (Study.roundOf(data, folder.id) !== round) continue;
    if (folder.session) {
      const session = await readSession(store, folder.id);
      for (const item of Object.keys(session?.ticks ?? {})) used.add(item);
      for (const block of new Set((session?.blockStarts ?? []).map((one) => one.block))) {
        startedBlocks.set(block, (startedBlocks.get(block) ?? 0) + 1);
      }
    }
    if (folder.transcript) {
      for (const coding of (await store.codings(folder.id)).codings) {
        if (coding.question) used.add(coding.question);
      }
    }
  }
  return { used, startedBlocks };
}

/** The department an interview is filed under: its transcript's, else its log's. */
async function departmentOf(store, folder, session) {
  try {
    return (await loadTranscript(store.transcriptRoot, folder)).department;
  } catch {
    return session?.department ?? null;
  }
}

/** An interview log with what a screen needs beside it. */
async function sessionView(id, { store, study }) {
  const session = await readSession(store, id);
  if (!session) throw bad("errorUnknownSession", undefined, 404);
  const data = await study.read();
  const round = Study.roundOf(data, id);
  const blocks = data.rounds.find((one) => one.id === round)?.guide?.blocks ?? [];
  const transcript = await exists(join(store.interviewFolder(id), "final.md"));
  const department = transcript ? await departmentOf(store, id, session) : session.department;
  return {
    id,
    round,
    transcript,
    ...session,
    department,
    current: currentBlock(session),
    blocks,
    // The read-out entries of this department, per block, so a screen does not
    // have to know which department name the log resolved to.
    readoutItems: Object.fromEntries(
      blocks
        .filter((block) => block.readout?.perDepartment?.[department])
        .map((block) => [block.id, block.readout.perDepartment[department]]),
    ),
  };
}

export async function evaluationRoutes({
  request,
  response,
  path,
  url,
  store,
  study,
  body,
  send,
  allInterviews,
  seedLanguage,
}) {
  const context = { store, study };

  /* Rounds ---------------------------------------------------------------- */
  if (path === "/api/rounds" && request.method === "GET") {
    const data = await study.read();
    const folders = await study.folders();
    send(response, 200, {
      rounds: data.rounds.map((round) => ({
        id: round.id,
        name: round.name,
        interviews: folders
          .filter((one) => one.transcript && Study.roundOf(data, one.id) === round.id)
          .map((one) => one.id),
        planned: folders
          .filter((one) => !one.transcript && Study.roundOf(data, one.id) === round.id)
          .map((one) => one.id),
        blocks: round.guide?.blocks.length ?? 0,
      })),
    });
    return true;
  }
  if (path === "/api/rounds" && request.method === "POST") {
    send(response, 201, await study.addRound(await body(request)));
    return true;
  }

  const roundOne = path.match(/^\/api\/rounds\/([^/]+)$/);
  if (roundOne && request.method === "PATCH") {
    send(response, 200, await study.updateRound(decodeURIComponent(roundOne[1]), await body(request)));
    return true;
  }
  if (roundOne && request.method === "DELETE") {
    await study.removeRound(decodeURIComponent(roundOne[1]));
    send(response, 204, "");
    return true;
  }

  const roundAssign = path.match(/^\/api\/rounds\/([^/]+)\/assign$/);
  if (roundAssign && request.method === "POST") {
    const { interviews } = await body(request);
    send(response, 200, await study.assign(decodeURIComponent(roundAssign[1]), interviews));
    return true;
  }

  /* The guide ------------------------------------------------------------- */
  const roundGuide = path.match(/^\/api\/rounds\/([^/]+)\/guide$/);
  if (roundGuide && request.method === "GET") {
    send(response, 200, await study.guide(decodeURIComponent(roundGuide[1])));
    return true;
  }
  if (roundGuide && request.method === "PUT") {
    const round = decodeURIComponent(roundGuide[1]);
    const data = await study.read();
    Study.round(data, round);
    const references = await referencesIn(round, { ...context, data });
    send(response, 200, await study.setGuide(round, await body(request), references));
    return true;
  }

  const guideBlocks = path.match(/^\/api\/rounds\/([^/]+)\/guide\/blocks$/);
  if (guideBlocks && request.method === "POST") {
    const wanted = await body(request);
    send(
      response,
      201,
      await study.addBlock(decodeURIComponent(guideBlocks[1]), wanted, { position: wanted.position }),
    );
    return true;
  }

  const guideBlock = path.match(/^\/api\/rounds\/([^/]+)\/guide\/blocks\/([^/]+)$/);
  if (guideBlock && request.method === "PATCH") {
    const round = decodeURIComponent(guideBlock[1]);
    const data = await study.read();
    Study.round(data, round);
    const { used } = await referencesIn(round, { ...context, data });
    send(
      response,
      200,
      await study.updateBlock(round, decodeURIComponent(guideBlock[2]), await body(request), { used }),
    );
    return true;
  }
  if (guideBlock && request.method === "DELETE") {
    const round = decodeURIComponent(guideBlock[1]);
    const block = decodeURIComponent(guideBlock[2]);
    const data = await study.read();
    Study.round(data, round);
    const { used, startedBlocks } = await referencesIn(round, { ...context, data });
    await study.removeBlock(round, block, { started: startedBlocks.get(block) ?? 0, used });
    send(response, 204, "");
    return true;
  }

  /* Interview logs --------------------------------------------------------- */
  if (path === "/api/sessions" && request.method === "GET") {
    const data = await study.read();
    const sessions = [];
    for (const folder of await study.folders()) {
      if (!folder.session) continue;
      const session = await readSession(store, folder.id);
      sessions.push({
        id: folder.id,
        round: Study.roundOf(data, folder.id),
        department: folder.transcript
          ? await departmentOf(store, folder.id, session)
          : session.department,
        transcript: folder.transcript,
        t0: session.t0,
        current: currentBlock(session),
        blocks: new Set(session.blockStarts.map((one) => one.block)).size,
        ticks: Object.keys(session.ticks).length,
        notes: session.notes.length,
      });
    }
    send(response, 200, { sessions });
    return true;
  }

  /* A log is opened for an interview that is about to happen, in the folder
     its transcript will later be written into. The round is required: which
     guide the conversation follows is not something to default. */
  if (path === "/api/sessions" && request.method === "POST") {
    const wanted = await body(request);
    const department = String(wanted.department ?? "").trim();
    if (!department) throw bad("errorDepartmentRequired");
    const round = String(wanted.round ?? "").trim();
    if (!round) throw bad("errorRoundRequired");
    Study.round(await study.read(), round);
    const folder = folderName(String(wanted.folder ?? "").trim() || `${round}-${department}`);
    if (await readSession(store, folder)) {
      throw bad("errorSessionExists", { folder }, 409);
    }
    await mkdir(store.interviewFolder(folder), { recursive: true });
    await writeSession(store, folder, { department });
    await study.assign(round, [folder]);
    send(response, 201, await sessionView(folder, context));
    return true;
  }

  const sessionOne = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionOne && request.method === "GET") {
    send(response, 200, await sessionView(decodeURIComponent(sessionOne[1]), context));
    return true;
  }
  if (sessionOne && request.method === "PATCH") {
    const id = decodeURIComponent(sessionOne[1]);
    const op = await body(request);
    const view = await sessionView(id, context);
    await changeSession(store, id, (session) =>
      applySessionOp(session, op, {
        now: Date.now(),
        blocks: view.blocks,
        department: view.transcript ? view.department : null,
      }),
    );
    send(response, 200, await sessionView(id, context));
    return true;
  }
  /* The log goes; the folder goes with it only if nothing else is in it, and
     a transcript beside it is never touched. */
  if (sessionOne && request.method === "DELETE") {
    const id = decodeURIComponent(sessionOne[1]);
    if (!(await readSession(store, id))) throw bad("errorUnknownSession", undefined, 404);
    await rm(sessionFile(store, id), { force: true });
    const folder = store.interviewFolder(id);
    if (!(await exists(join(folder, "final.md")))) {
      if (!(await readdir(folder)).length) await rmdir(folder).catch(() => {});
      await study.forget(id);
    }
    send(response, 204, "");
    return true;
  }

  /* Comparisons ------------------------------------------------------------ */
  if (path === "/api/evaluation/panel" && request.method === "GET") {
    const data = await study.read();
    const from = url.searchParams.get("from") || data.rounds[0]?.id;
    const to = url.searchParams.get("to") || data.rounds.at(-1)?.id;
    if (!from || !to || from === to) throw bad("errorPanelNeedsTwoRounds", undefined, 409);
    Study.round(data, from);
    const later = Study.round(data, to);
    const { categories } = await store.categories(seedLanguage);
    const only = url.searchParams.get("category") || null;
    if (only && !categories.some((one) => one.id === only)) {
      throw bad("errorUnknownCategory", undefined, 404);
    }
    const all = await allInterviews();
    const roundOf = (id) => Study.roundOf(data, id);
    const sessions = new Map();
    for (const { transcript } of all) {
      if (roundOf(transcript.id) !== to) continue;
      const session = await readSession(store, transcript.id);
      if (session) sessions.set(transcript.id, session);
    }
    send(
      response,
      200,
      panelComparison({
        interviews: all,
        roundOf,
        from,
        to,
        categories,
        only,
        blocks: later.guide?.blocks ?? [],
        sessions,
      }),
    );
    return true;
  }

  if (path === "/api/evaluation/propositions" && request.method === "GET") {
    const data = await study.read();
    const only = url.searchParams.get("round") || null;
    if (only) Study.round(data, only);
    const { propositions } = await store.categories(seedLanguage);
    const all = await allInterviews();
    send(response, 200, {
      propositions: evaluatePropositions({
        interviews: all,
        roundOf: (id) => Study.roundOf(data, id),
        propositions,
        onlyRound: only,
      }),
    });
    return true;
  }

  if (path === "/api/evaluation/tags" && request.method === "GET") {
    const data = await study.read();
    const round = url.searchParams.get("round") || data.rounds.at(-1)?.id;
    if (!round) throw bad("errorRoundRequired");
    const chosen = Study.round(data, round);
    send(
      response,
      200,
      tagReport({
        interviews: await allInterviews(),
        roundOf: (id) => Study.roundOf(data, id),
        round,
        blocks: chosen.guide?.blocks ?? [],
      }),
    );
    return true;
  }

  return false;
}

/**
 * The criteria of a proposition, checked against the rounds and categories the
 * study has. Used by the proposition route in `server.js`, which owns it.
 */
export async function checkCriteriaFor(list, { study, store, seedLanguage }) {
  const data = await study.read();
  const { categories } = await store.categories(seedLanguage);
  return checkedCriteria(list, {
    rounds: data.rounds,
    categories,
    fail: (key, status) => Object.assign(fail(key), { status }),
  });
}

/**
 * Which guide item a coding unit may name: one in the guide of its interview's
 * round. Nothing else would ever be reported under a tag.
 */
export async function checkQuestionFor(interview, question, { study }) {
  if (!question) return;
  const data = await study.read();
  const round = data.rounds.find((one) => one.id === Study.roundOf(data, interview));
  const items = guideItems(round?.guide?.blocks ?? []);
  if (!items.some((item) => item.id === question)) {
    throw bad("errorUnknownGuideItem", undefined, 404);
  }
}
