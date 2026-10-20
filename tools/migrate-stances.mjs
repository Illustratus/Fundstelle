/**
 * Move stances out of memos into the field made for them.
 *
 * A study that coded its evaluation round before Fundstelle had a stance per
 * proposition wrote them into the memos ("Stufe je Proposition:
 * Konversationsprinzip stützt."). This reads those sentences through the HTTP
 * interface of a running Fundstelle — the same one its own screen uses — and
 * writes them into `stances`, unit by unit:
 *
 *   node tools/migrate-stances.mjs --base http://127.0.0.1:4173 --round evaluation --dry-run
 *   node tools/migrate-stances.mjs --base http://127.0.0.1:4173 --interview evaluation-content-marketing
 *
 * It writes nothing but `stances`: the memo stays word for word, and whether a
 * unit is reviewed is not touched — a PATCH leaves every field it does not
 * name as it was. It never guesses either: a sentence it cannot read, a name
 * that is no proposition or more than one (`--map "Name=id"` settles it), or
 * a unit that already carries another stance stops the whole run before the
 * first write. Run it with `--dry-run` first; a second run writes nothing,
 * because what is already set is left alone.
 */

import { migrationPlan } from "../lib/memo-stances.js";
import { negotiate, translator } from "../lib/texts.js";

function options(argv) {
  const found = { interview: [], map: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const name = arg.replace(/^--/, "");
    if (["dry-run", "help"].includes(name)) found[name] = true;
    else if (name === "interview" || name === "map") found[name].push(argv[++i]);
    else found[name] = argv[++i];
  }
  return found;
}

const argv = options(process.argv.slice(2));
const language = negotiate(argv.lang ?? null, process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG ?? "");
const t = translator(language);

if (argv.help || !argv.base || (!argv.interview.length && !argv.round)) {
  console.log(t("migrateUsage"));
  process.exit(argv.help ? 0 : 1);
}

const base = argv.base.replace(/\/$/, "");
const dry = Boolean(argv["dry-run"]);

async function call(method, path, body) {
  const answer = await fetch(`${base}${path}${path.includes("?") ? "&" : "?"}lang=${language}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await answer.text();
  const json = text ? JSON.parse(text) : null;
  if (!answer.ok) {
    throw new Error(t("migrateHttp", { method, path, status: answer.status, error: json?.error ?? text }));
  }
  return json;
}

const aliases = Object.fromEntries(
  argv.map.map((one) => {
    const at = one.lastIndexOf("=");
    return [one.slice(0, at).trim(), one.slice(at + 1).trim()];
  }),
);

try {
  console.log(t("migrateReading", { base }));
  const { propositions, categories } = await call("GET", "/api/categories");
  let folders = argv.interview;
  if (argv.round) {
    const round = (await call("GET", "/api/rounds")).rounds.find((one) => one.id === argv.round);
    if (!round) throw new Error(t("migrateNoRound", { round: argv.round }));
    folders = [...new Set([...folders, ...round.interviews])];
  }
  const interviews = [];
  for (const id of folders) {
    const interview = await call("GET", `/api/interviews/${encodeURIComponent(id)}`);
    interviews.push({ id, codings: interview.codings });
  }

  // What a unit already carries counts as the evaluation counts it: an older
  // single stance means its category's proposition.
  const ownProposition = new Map(categories.map((one) => [one.id, one.proposition ?? "none"]));
  const current = (coding) => {
    const have = { ...(coding.stances ?? {}) };
    const own = ownProposition.get(coding.category);
    if (coding.stance && own && own !== "none" && propositions[own]?.claim !== false && !(own in have)) {
      have[own] = coding.stance;
    }
    return have;
  };
  const { units, problems } = migrationPlan({ interviews, propositions, aliases, current });

  const stanceWord = (stance) => t(stance === "supports" ? "evxStanceSupports" : "evxStanceContradicts");
  const nameOf = (id) => propositions[id]?.name ?? id;
  for (const unit of units.filter((one) => one.state !== "conflict")) {
    const said = Object.entries(unit.set)
      .map(([id, stance]) => `${nameOf(id)} ${stanceWord(stance)}${unit.borderline.includes(id) ? t("migrateBorderline") : ""}`)
      .join(", ");
    console.log(
      t(unit.state === "write" ? "migrateUnit" : "migrateUnchanged", {
        interview: unit.interview,
        turn: unit.turn,
        category: unit.category,
        stances: said,
      }),
    );
  }
  for (const problem of problems) {
    const what = {
      unreadable: () => t("migrateUnreadable", { text: problem.text }),
      unknown: () => t("migrateUnknownName", { name: problem.name }),
      ambiguous: () => t("migrateAmbiguousName", { name: problem.name, ids: problem.ids.join(", ") }),
      twice: () => t("migrateTwice", { name: problem.name }),
      conflict: () =>
        t("migrateConflict", { name: problem.name, have: stanceWord(problem.have), want: stanceWord(problem.want) }),
    }[problem.kind]();
    console.error(t("migrateProblem", { interview: problem.interview, turn: problem.turn, problem: what }));
  }

  if (!units.length && !problems.length) {
    console.log(t("migrateNothing"));
    process.exit(0);
  }

  // The count per proposition and stance, borderline cases included.
  console.log("");
  console.log(t("migrateSummary", { units: units.length }));
  const tally = new Map();
  for (const unit of units) {
    for (const [id, stance] of Object.entries(unit.set)) {
      const key = `${id}\u0000${stance}`;
      const entry = tally.get(key) ?? { id, stance, n: 0, borderline: 0 };
      entry.n += 1;
      if (unit.borderline.includes(id)) entry.borderline += 1;
      tally.set(key, entry);
    }
  }
  const order = Object.keys(propositions);
  const stances = ["supports", "contradicts"];
  const sorted = [...tally.values()].sort(
    (a, b) => order.indexOf(a.id) - order.indexOf(b.id) || stances.indexOf(a.stance) - stances.indexOf(b.stance),
  );
  for (const entry of sorted) {
    console.log(t("migrateSummaryLine", { name: nameOf(entry.id), stance: stanceWord(entry.stance), n: entry.n, borderline: entry.borderline }));
  }
  const pending = units.filter((one) => one.state === "write");
  console.log(t("migrateToWrite", { n: pending.length, unchanged: units.length - pending.length }));

  if (problems.length) {
    console.error(t("migrateRefused", { n: problems.length }));
    process.exit(1);
  }
  if (dry) {
    console.log(t("migrateDry"));
    process.exit(0);
  }
  for (const unit of pending) {
    await call("PATCH", `/api/interviews/${encodeURIComponent(unit.interview)}/codings/${encodeURIComponent(unit.id)}`, {
      stances: unit.write,
    });
  }
  console.log(t("migrateWritten", { n: pending.length }));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
