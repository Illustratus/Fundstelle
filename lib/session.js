/**
 * The interview log: what happened during one conversation, kept as it happens.
 *
 * During a live interview the interviewer has the guide in front of them and
 * three things to keep track of besides listening: where in the guide the
 * conversation is, which keywords and mandatory questions have come up, and
 * whatever is worth a note in the moment. Afterwards all three are lost unless
 * they were written down, and the transcript — which arrives days later — knows
 * none of them.
 *
 * So the log is kept in the interview's own folder, as `session.json`, before a
 * transcript exists. A folder without `final.md` is not an interview to the rest
 * of the tool and stays invisible to every count until the recording has been
 * brought in; the log simply waits there for it.
 *
 * ## Time
 *
 * `t0` is the wall-clock moment the recording started. Everything else carries
 * `at`: seconds after `t0`, which is the clock the recording's own timestamps
 * run on — the same seconds a WebVTT cue starts at. That is what lets the import
 * put the guide's sections into the transcript by itself: a block that began at
 * 312 seconds begins at the turn the recording has at 312 seconds.
 *
 * Without a `t0` nothing has a time, and `at` is null rather than invented. If
 * `t0` is corrected afterwards — the recording turned out to have started a few
 * seconds before the button was pressed — every `at` is moved with it, so each
 * event keeps the wall-clock moment it happened at.
 *
 * ## What the log does not hold
 *
 * The round: that is the study's (`study.json`), and one fact in two places is
 * two facts that can disagree. The department is held here only until the
 * transcript exists; from then on the transcript's header says it.
 */

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { fail } from "./texts.js";
import { inTurn, write } from "./store.js";
import { guideItems } from "./rounds.js";

export const SESSION_FILE = "session.json";
const VERSION = 1;

/** What a read-out item can be marked as. Unmarked means: not asked yet. */
export const READOUT_STATES = ["still", "no-longer"];

export const SESSION_OPS = [
  "start",
  "block",
  "unblock",
  "tick",
  "untick",
  "note",
  "edit-note",
  "delete-note",
  "readout",
  "department",
];

const bad = (key, params, status = 400) => Object.assign(fail(key, params), { status });

/** Seconds to one decimal: finer than a click can mean, coarse enough to read. */
const tenth = (value) => Math.round(value * 10) / 10;

export function shapeSession(raw = {}) {
  return {
    version: VERSION,
    department: String(raw.department ?? "").trim(),
    t0: raw.t0 ?? null,
    blockStarts: (raw.blockStarts ?? []).map((one) => ({
      block: String(one.block),
      at: one.at ?? null,
    })),
    ticks: { ...(raw.ticks ?? {}) },
    readout: Object.fromEntries(
      Object.entries(raw.readout ?? {}).map(([block, states]) => [block, { ...states }]),
    ),
    notes: (raw.notes ?? []).map((one) => ({
      id: String(one.id),
      block: one.block ?? null,
      at: one.at ?? null,
      text: String(one.text ?? ""),
    })),
  };
}

/* Reading and writing ------------------------------------------------------ */

export function sessionFile(store, folder) {
  return join(store.interviewFolder(folder), SESSION_FILE);
}

/** The log of a folder, or null when there is none. */
export async function readSession(store, folder) {
  try {
    return shapeSession(JSON.parse(await readFile(sessionFile(store, folder), "utf8")));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

export async function writeSession(store, folder, session) {
  return inTurn(
    sessionFile(store, folder),
    () => write(sessionFile(store, folder), shapeSession(session)),
    store.locking,
  );
}

/** Read, change, write, in the file's turn. */
export async function changeSession(store, folder, work) {
  const file = sessionFile(store, folder);
  return inTurn(
    file,
    async () => {
      const session = await readSession(store, folder);
      if (!session) throw bad("errorUnknownSession", undefined, 404);
      const next = shapeSession(await work(session));
      await write(file, next);
      return next;
    },
    store.locking,
  );
}

/* Operations --------------------------------------------------------------- */

function parsedTime(value) {
  const time = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(time)) {
    throw bad("errorTimeShape", { value: String(value) });
  }
  return time;
}

/** `at` as given, or now measured from `t0`, or null without a `t0`. */
function offset(session, op, now) {
  if (op.at !== undefined && op.at !== null) {
    if (typeof op.at !== "number" || !Number.isFinite(op.at)) {
      throw bad("errorTimeShape", { value: String(op.at) });
    }
    return tenth(op.at);
  }
  if (!session.t0) return null;
  return tenth((now - Date.parse(session.t0)) / 1000);
}

/** The block the conversation is in: the one started last. */
export function currentBlock(session) {
  return session.blockStarts.at(-1)?.block ?? null;
}

function blockOf(blocks, id) {
  const block = blocks.find((one) => one.id === id);
  if (!block) throw bad("errorUnknownBlock", undefined, 404);
  return block;
}

/**
 * One change to a log, as a pure function of the log, the operation, the
 * moment and the guide. The server reads, applies this and writes; nothing
 * else here knows about files.
 */
export function applySessionOp(session, op, { now = Date.now(), blocks = [], department = null } = {}) {
  const next = shapeSession(session);
  switch (op?.op) {
    case "start": {
      const at = op.t0 === undefined || op.t0 === null ? now : parsedTime(op.t0);
      if (next.t0) {
        // Each event keeps the moment it happened at; only the reference moves.
        const shift = (Date.parse(next.t0) - at) / 1000;
        const moved = (value) => (value === null ? null : tenth(value + shift));
        next.blockStarts = next.blockStarts.map((one) => ({ ...one, at: moved(one.at) }));
        next.ticks = Object.fromEntries(
          Object.entries(next.ticks).map(([item, value]) => [item, moved(value)]),
        );
        next.notes = next.notes.map((one) => ({ ...one, at: moved(one.at) }));
      }
      next.t0 = new Date(at).toISOString();
      return next;
    }
    case "block": {
      blockOf(blocks, op.block);
      next.blockStarts.push({ block: op.block, at: offset(next, op, now) });
      return next;
    }
    case "unblock": {
      // A start pressed by mistake; the latest of that block goes.
      const last = next.blockStarts.findLastIndex((one) => one.block === op.block);
      if (last < 0) throw bad("errorBlockNotStarted", undefined, 404);
      next.blockStarts.splice(last, 1);
      return next;
    }
    case "tick": {
      if (!guideItems(blocks).some((item) => item.id === op.item)) {
        throw bad("errorUnknownGuideItem", undefined, 404);
      }
      // Addressed is addressed from the first time on; ticking again keeps it.
      if (!(op.item in next.ticks)) next.ticks[op.item] = offset(next, op, now);
      return next;
    }
    case "untick": {
      delete next.ticks[op.item];
      return next;
    }
    case "note": {
      const said = String(op.text ?? "").trim();
      if (!said) throw bad("errorNoteText");
      const block = op.block === undefined ? currentBlock(next) : op.block;
      if (block !== null) blockOf(blocks, block);
      next.notes.push({
        id: randomUUID().slice(0, 8),
        block,
        at: offset(next, op, now),
        text: said,
      });
      return next;
    }
    case "edit-note": {
      const note = next.notes.find((one) => one.id === op.note);
      if (!note) throw bad("errorUnknownNote", undefined, 404);
      if ("text" in op) {
        const said = String(op.text ?? "").trim();
        if (!said) throw bad("errorNoteText");
        note.text = said;
      }
      if ("block" in op) {
        if (op.block !== null) blockOf(blocks, op.block);
        note.block = op.block;
      }
      if ("at" in op) note.at = op.at === null ? null : offset(next, op, now);
      return next;
    }
    case "delete-note": {
      const before = next.notes.length;
      next.notes = next.notes.filter((one) => one.id !== op.note);
      if (next.notes.length === before) throw bad("errorUnknownNote", undefined, 404);
      return next;
    }
    case "readout": {
      const block = blockOf(blocks, op.block);
      // The transcript's header, once there is one, says which department this
      // is; until then the log does.
      const who = department ?? next.department;
      const items = block.readout?.perDepartment?.[who];
      if (!items) throw bad("errorNoReadout", { department: who }, 409);
      if (!items.includes(op.item)) {
        throw bad("errorUnknownReadoutItem", { item: String(op.item), department: who }, 404);
      }
      const states = next.readout[op.block] ?? {};
      if (op.state === null || op.state === undefined || op.state === "") delete states[op.item];
      else if (!READOUT_STATES.includes(op.state)) throw bad("errorReadoutState");
      else states[op.item] = op.state;
      if (Object.keys(states).length) next.readout[op.block] = states;
      else delete next.readout[op.block];
      return next;
    }
    case "department": {
      const department = String(op.department ?? "").trim();
      if (!department) throw bad("errorDepartmentRequired");
      next.department = department;
      return next;
    }
    default:
      throw bad("errorSessionOp", { op: String(op?.op) });
  }
}

/* Placing the guide's sections in a transcript ----------------------------- */

/**
 * Where each started block begins among the turns of a recording.
 *
 * `turns` are the turns as the import reads them, each with `at` (seconds into
 * the recording, null when the file carries no times) and `speaker`.
 * `interviewer` is the speaker name that was asking.
 *
 * The rule, for a block started at second s:
 *
 * - the turn under way at s is the last one that began at or before s;
 * - if that turn is the interviewer's, the block begins with it — the button was
 *   pressed while the prompt was being asked;
 * - otherwise it begins with the next turn — the button was pressed while the
 *   previous answer was still running, or before the prompt was asked.
 *
 * A start that has no time, names a block the guide no longer has, or lies
 * after the last turn is not placed and is said so, with the reason. Nothing
 * is moved to a "nearby" turn: the researcher reviews the placement, and an
 * unplaced block is a line they can write in by hand.
 */
export function placeSections(turns, session, blocks, { interviewer = null } = {}) {
  const names = new Map(blocks.map((block) => [block.id, block.name]));
  const placed = [];
  const unplaced = [];
  const timed = turns.some((turn) => turn.at !== null && turn.at !== undefined);

  session.blockStarts.forEach((start, order) => {
    const name = names.get(start.block) ?? null;
    const miss = (reason) => unplaced.push({ block: start.block, name, at: start.at, reason });
    if (!name) return miss("sectionUnknownBlock");
    if (start.at === null || start.at === undefined) return miss("sectionNoOffset");
    if (!timed) return miss("sectionNoTimes");

    let running = -1;
    turns.forEach((turn, index) => {
      if (turn.at !== null && turn.at !== undefined && turn.at <= start.at) running = index;
    });
    const asking =
      running >= 0 && interviewer !== null && turns[running].speaker === interviewer;
    const before = asking ? running : running + 1;
    if (before >= turns.length) return miss("sectionAfterLastTurn");
    placed.push({
      block: start.block,
      name,
      at: start.at,
      before,
      turn: before + 1,
      turnAt: turns[before].at ?? null,
      order,
    });
  });

  placed.sort((a, b) => a.before - b.before || a.order - b.order);
  return {
    placed: placed.map(({ order, ...rest }) => rest),
    unplaced,
  };
}

/** The placement worded for the request it answers. */
export function withSectionReasons(placement, t) {
  return {
    placed: placement.placed,
    unplaced: placement.unplaced.map((one) => ({ ...one, why: t(one.reason) })),
  };
}
