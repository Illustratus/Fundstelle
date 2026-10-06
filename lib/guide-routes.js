/**
 * The guide of a round, out of the tool and into the appendix.
 *
 * A route of its own file for the same reason the second round's routes have
 * theirs: one feature, read together. Written in the one-line shape
 * `tests/openapi.spec.js` reads routes from.
 */

import { fail } from "./texts.js";
import { Study } from "./rounds.js";
import { readSession } from "./session.js";
import { guideMarkdown } from "./guide-export.js";

const MARKDOWN = "text/markdown; charset=utf-8";

const bad = (key, params, status = 400) => Object.assign(fail(key, params), { status });

/**
 * The departments a round has reached so far: those of its transcripts, and
 * those of the logs of interviews not yet transcribed. Empty while the round is
 * still being planned.
 */
async function departmentsIn(round, { store, study, data, allInterviews }) {
  const found = new Set();
  for (const { transcript } of await allInterviews(round)) {
    if (transcript.department) found.add(transcript.department);
  }
  for (const folder of await study.folders()) {
    if (folder.transcript || !folder.session) continue;
    if (Study.roundOf(data, folder.id) !== round) continue;
    const session = await readSession(store, folder.id);
    if (session?.department) found.add(session.department);
  }
  return found;
}

export async function guideRoutes({ request, response, path, url, store, study, send, allInterviews, language }) {
  if (path === "/api/export/guide.md" && request.method === "GET") {
    const data = await study.read();
    const wanted = url.searchParams.get("round") || data.rounds.at(-1)?.id;
    if (!wanted) throw bad("errorRoundRequired");
    const round = Study.round(data, wanted);
    const reached = await departmentsIn(round.id, { store, study, data, allInterviews });
    send(
      response,
      200,
      guideMarkdown(round, { departments: reached.size ? reached : null, language }),
      MARKDOWN,
    );
    return true;
  }
  return false;
}
