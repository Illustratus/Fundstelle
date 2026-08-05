/**
 * Local server of the coding tool.
 *
 * No dependencies and no login: the tool runs on the author's own machine and
 * reads the same files that version the work. It deliberately binds to
 * localhost only, because transcripts remain personal data even after
 * pseudonymization.
 */

import { createServer } from "node:http";
import { access, mkdir, open, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findInterviews, loadTranscript, withProblemText } from "./lib/transcript.js";
import { EXAMPLE_FOLDER, exampleStudy } from "./lib/example.js";
import { occurrences, trimStem } from "./public/search.js";
import { Store } from "./lib/store.js";
import { checkAnchors, withReasons, withoutCheckMarks } from "./lib/anchoring.js";
import { agreement, agreementMarkdown } from "./lib/agreement.js";
import { convert, folderName, readTranscript } from "./lib/import.js";
import { FALLBACK, LANGUAGES, fail, negotiate, translator } from "./lib/texts.js";
import {
  MOSCOW,
  analysis,
  analysisMarkdown,
  catalog,
  catalogMarkdown,
  citationsMarkdown,
  codingGuideMarkdown,
  codingTableMarkdown,
  matrixGridMarkdown,
  notesMarkdown,
  sampleMarkdown,
} from "./lib/analysis.js";

/* The oldest runtime this is known to work on. Nothing here reaches beyond
   what Node 18 offers, and saying so is worth a line: on an older one the tool
   would otherwise fail somewhere in the middle of a file read, with a message
   about a function that does not exist rather than about the version. */
const NEEDS_NODE = 18;
const running = Number(process.versions.node.split(".")[0]);
if (running < NEEDS_NODE) {
  console.error(`Fundstelle needs Node ${NEEDS_NODE} or newer; this is Node ${process.versions.node}.`);
  process.exit(1);
}

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(HERE, "public");

/** The German variable names of earlier versions still work. */
const setting = (...names) => names.map((name) => process.env[name]).find(Boolean);

const TRANSCRIPTS = setting("TRANSCRIPTS", "TRANSKRIPTE")
  ? resolve(setting("TRANSCRIPTS", "TRANSKRIPTE"))
  : resolve(HERE, "data", "transcripts");
const PORT = Number(process.env.PORT ?? 4173);
// The default stays localhost, because transcripts can be personal data even
// after pseudonymization. `HOST=0.0.0.0` is only needed by whoever runs the
// tool in a container and limits the published ports themselves.
const HOST = process.env.HOST ?? "127.0.0.1";

// The paths are overridable so that the test runs work on a copy and never
// touch the real codings. `START_SYSTEM` seeds a deductive category system of
// your own on first start, instead of the bundled example.
const CATEGORIES_FILE = setting("CATEGORIES", "KATEGORIEN");
const START_SYSTEM_FILE = setting("START_SYSTEM", "STARTSYSTEM");
// Pins the language a bilingual start system is seeded in. Without it the first
// request decides, which is right for one person on their own machine and wrong
// for a shared or scripted setup that wants the same seed every time.
const START_LANGUAGE = LANGUAGES.includes(setting("START_LANGUAGE"))
  ? setting("START_LANGUAGE")
  : null;

const store = new Store({
  toolRoot: resolve(HERE, "data"),
  transcriptRoot: TRANSCRIPTS,
  categoriesFile: CATEGORIES_FILE ? resolve(CATEGORIES_FILE) : null,
  startSystemFile: START_SYSTEM_FILE
    ? resolve(START_SYSTEM_FILE)
    : resolve(HERE, "example-start-system.json"),
  seedLanguage: START_LANGUAGE ?? FALLBACK,
});

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const MARKDOWN = "text/markdown; charset=utf-8";

/** A few words around a location, so that it can be placed. */
function excerpt(text, [from, to], margin = 45) {
  const start = Math.max(0, from - margin);
  const end = Math.min(text.length, to + margin);
  return (
    (start > 0 ? "… " : "") + text.slice(start, end).trim() + (end < text.length ? " …" : "")
  );
}

/** Counts the locations of a term across all interviews. */
async function searchEverywhere(word) {
  const found = [];
  for (const { id } of await findInterviews(TRANSCRIPTS)) {
    const transcript = await loadTranscript(TRANSCRIPTS, id);
    let hits = 0;
    let first = null;
    for (const turn of transcript.turns) {
      const places = occurrences(turn.text, word);
      if (!places.length) continue;
      hits += places.length;
      if (!first) first = { turn: turn.number, excerpt: excerpt(turn.text, places[0]) };
    }
    if (hits) {
      found.push({
        id,
        title: transcript.title,
        department: transcript.department,
        hits,
        first,
      });
    }
  }
  return found;
}

function send(response, status, body, type = "application/json; charset=utf-8") {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
  });
  response.end(data);
}

async function body(request) {
  const parts = [];
  for await (const chunk of request) parts.push(chunk);
  if (!parts.length) return {};
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

/** Transcript with checked anchors; unambiguous cases are moved right away. */
async function loadChecked(id) {
  const transcript = await loadTranscript(TRANSCRIPTS, id);
  const { codings, memo } = await store.codings(id);
  const { codings: checked, changed } = checkAnchors(transcript, codings);
  if (changed) await store.setCodings(id, withoutCheckMarks(checked));
  return { transcript, codings: checked, memo: memo ?? "" };
}

/**
 * Coding units belong to the respondents.
 *
 * The interviewer's own words are the instrument, not the material: coded, they
 * would be quoted back as evidence and attributed to the department that was
 * being asked. The interface says so when a selection lands there — but said it
 * and then went ahead anyway, so the rule is checked where it cannot be walked
 * past. The turn also has to exist at all, which nothing checked before.
 */
async function checkCodableTurn(interview, number) {
  const transcript = await loadTranscript(TRANSCRIPTS, interview);
  const turn = transcript.turns.find((one) => one.number === number);
  if (!turn) {
    throw Object.assign(fail("errorUnknownTurn", { turn: number }), { status: 404 });
  }
  if (turn.interviewer) {
    throw Object.assign(fail("errorInterviewerTurn", { turn: number }), { status: 409 });
  }
}

/**
 * Does the study hold any coding at all?
 *
 * The one question that decides whether the deductive start system is still
 * being written. "Fixed before the material is worked" is a statement about a
 * moment, and this is the moment: while nothing has been coded, a deductive
 * category may be added, removed or merged; from the first coding onwards the
 * system that was coded against stands, and everything new is inductive.
 */
async function nothingCoded() {
  for (const { id } of await findInterviews(TRANSCRIPTS)) {
    const { codings } = await store.codings(id);
    if (codings.length) return false;
  }
  return true;
}

async function allInterviews() {
  const found = await findInterviews(TRANSCRIPTS);
  const loaded = [];
  for (const { id } of found) loaded.push(await loadChecked(id));
  return loaded;
}

/**
 * The comparison with every second coding lying beside a first one.
 *
 * Shared by the route the analysis reads and the export the paper carries, so
 * the figure in the appendix cannot come out different from the figure on the
 * screen.
 */
async function allAgreement() {
  const all = await allInterviews();
  const { categories } = await store.categories(START_LANGUAGE ?? FALLBACK);
  const problems = [];
  const withOthers = [];
  for (const one of all) {
    const { found, problems: broken } = await store.otherCodings(one.transcript.id);
    problems.push(...broken);
    /* The second coding is checked against the same transcript as the first,
       so that a passage edited away falls out of both sides. Checked, never
       written: their file stays theirs, which is the whole point of it. */
    const checked = Object.fromEntries(
      Object.entries(found).map(([coder, codings]) => [
        coder,
        checkAnchors(one.transcript, codings).codings,
      ]),
    );
    withOthers.push({ ...one, others: checked });
  }
  return { compared: agreement(withOthers, categories), problems };
}

async function staticFile(response, path) {
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
  const file = join(PUBLIC, safe === "/" || safe === "" ? "index.html" : safe);
  if (!file.startsWith(PUBLIC)) return send(response, 403, { error: "forbidden" });
  try {
    const content = await readFile(file);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(content);
  } catch {
    send(response, 404, { error: "not found" });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  const path = url.pathname;

  // The language of this request: `?lang=` beats the browser preference, which
  // beats the international default. The interface sends its own language along
  // as `accept-language`, so exports come out in the language the tool is being
  // operated in, and a bare `curl` still gets something readable.
  const language = negotiate(url.searchParams.get("lang"), request.headers["accept-language"]);
  const t = translator(language);
  // Only the very first read seeds anything; afterwards the stored system wins
  // and this value is never looked at again.
  const seedLanguage = START_LANGUAGE ?? language;

  try {
    if (!path.startsWith("/api/")) return await staticFile(response, path);

    // The category system is seeded on first touch, and the language of that
    // touch decides its wording. Settling it here means every route below can
    // simply read — including the ones that reach the store from the inside,
    // such as adding a category, which would otherwise seed in whatever the
    // store was constructed with.
    await store.ensureSeeded(seedLanguage);

    // Environment: the first start names the folder transcripts belong in.
    if (path === "/api/environment" && request.method === "GET") {
      return send(response, 200, { transcripts: TRANSCRIPTS });
    }

    /* The empty screen explains the format and then leaves the reader to type
       it out. This writes the example it is already showing — only on a folder
       that holds no interviews, and never over a file that is there. */
    if (path === "/api/example" && request.method === "POST") {
      if ((await findInterviews(TRANSCRIPTS)).length) {
        return send(response, 409, { error: t("errorExampleNotEmpty"), code: "errorExampleNotEmpty" });
      }
      /* Three interviews rather than one: with a single one the analysis has
         a cross table of one column, no saturation curve — it needs three —
         and nothing for the categories to meet in, which is most of what the
         tool is worth choosing for. They arrive uncoded; the tool has never
         invented a coding and should not start on the screen where somebody is
         deciding whether to trust it. */
      for (const one of exampleStudy(language)) {
        const folder = join(TRANSCRIPTS, one.folder);
        await mkdir(folder, { recursive: true });
        try {
          const file = await open(join(folder, "final.md"), "wx");
          await file.writeFile(one.text, "utf8");
          await file.close();
        } catch (error) {
          // Never over a file that is already there.
          if (error.code !== "EEXIST") throw error;
        }
      }
      return send(response, 201, { interview: EXAMPLE_FOLDER });
    }

    /* Bringing a recording's transcript in, in two steps.
       The first only reads: it says which shape the file is, how many turns it
       became and who is speaking in it. Nothing is written until somebody has
       said which of those speakers was asking — the interviewer's turns cannot
       be coded, so guessing would either take half the material out or offer
       the questions up as findings. */
    if (path === "/api/import/read" && request.method === "POST") {
      const { text } = await body(request);
      // Only the field's absence is a bad request. A file of nothing but blank
      // lines did have content — it simply could not be read as a transcript,
      // and saying "field text missing" about a file the reader just dropped is
      // a message about the wrong thing.
      if (typeof text !== "string") {
        return send(response, 400, { error: t("errorFieldMissing", { field: "text" }) });
      }
      const read = readTranscript(text, null);
      if (!read.turns.length) {
        return send(response, 422, {
          error: t("importNothingRead", { file: "" }).trim(),
          code: "importNothingRead",
        });
      }
      return send(response, 200, {
        format: read.format,
        speakers: read.speakers,
        turns: read.turns.length,
        // A few turns to look at, so the reader can see it was read correctly
        // before a folder is made.
        preview: read.turns.slice(0, 4).map((turn) => ({
          speaker: turn.speaker,
          text: turn.text.slice(0, 220),
        })),
      });
    }

    if (path === "/api/import" && request.method === "POST") {
      const wanted = await body(request);
      if (typeof wanted.text !== "string") {
        return send(response, 400, { error: t("errorFieldMissing", { field: "text" }) });
      }
      const department = (wanted.department ?? "").trim() || null;
      const title =
        (wanted.title ?? "").trim() ||
        (department ? `Interview: ${department}` : t("importDefaultTitle"));
      const result = convert(wanted.text, {
        title,
        department,
        interviewer: (wanted.interviewer ?? "").trim() || null,
        respondent: t("importRespondent"),
        meta: (wanted.date ?? "").trim() ? { [t("metaSurvey")]: wanted.date.trim() } : {},
      });
      // A transcript with no turns in it is a folder nobody can code in.
      if (!result.turns.length) {
        return send(response, 422, {
          error: t("importNothingRead", { file: "" }).trim(),
          code: "importNothingRead",
        });
      }
      const folder = folderName((wanted.folder ?? "").trim() || result.folder);
      const file = join(TRANSCRIPTS, folder, "final.md");
      await mkdir(join(TRANSCRIPTS, folder), { recursive: true });
      try {
        // `wx` rather than a check and a write: a transcript already there is
        // one whose turn numbers codings hold on to, and overwriting it would
        // move every citation in that interview.
        const handle = await open(file, "wx");
        await handle.writeFile(result.markdown, "utf8");
        await handle.close();
      } catch (error) {
        if (error.code === "EEXIST") {
          return send(response, 409, {
            error: t("importExistsShort", { folder }),
            code: "importExists",
          });
        }
        throw error;
      }
      return send(response, 201, { interview: folder, turns: result.turns.length, title });
    }

    // Interviews ------------------------------------------------------------
    if (path === "/api/interviews" && request.method === "GET") {
      const all = await allInterviews();
      return send(
        response,
        200,
        all.map(({ transcript, codings }) => ({
          id: transcript.id,
          title: transcript.title,
          department: transcript.department,
          meta: transcript.meta,
          turns: transcript.turns.length,
          sections: transcript.sections.length,
          codings: codings.length,
          // What is still only a suggestion here. The coding view knows its own
          // interview; without this it cannot say whether the study is done.
          unreviewed: codings.filter(
            (coding) => coding.reviewed !== true && coding.state !== "lost",
          ).length,
        })),
      );
    }

    // Search across all interviews. While coding one regularly notices that a
    // phrasing has come up before — often in the other interview.
    if (path === "/api/search" && request.method === "GET") {
      const word = (url.searchParams.get("q") ?? "").trim();
      if (word.length < 2) return send(response, 200, { word, interviews: [] });
      const found = await searchEverywhere(word);
      if (found.length) return send(response, 200, { word, interviews: found });

      // Nothing found: try the same search without the inflecting ending and
      // say what was searched for instead. Which endings inflect depends on the
      // language the study is in, which is the one the request came in.
      const stem = trimStem(word, language);
      if (!stem) return send(response, 200, { word, interviews: [] });
      return send(response, 200, {
        word,
        instead: stem,
        interviews: await searchEverywhere(stem),
      });
    }

    const single = path.match(/^\/api\/interviews\/([^/]+)$/);
    if (single && request.method === "GET") {
      const id = decodeURIComponent(single[1]);
      const { transcript, codings, memo } = await loadChecked(id);
      return send(response, 200, {
        ...transcript,
        // The reason a unit lost its place is named by the checker and worded
        // here, where the language of the request is known. The same goes for
        // whatever could not be read out of the file in the first place.
        codings: withReasons(codings, t),
        problems: withProblemText(transcript.problems ?? [], t),
        memo,
        moved: codings.filter((coding) => coding.state === "moved").length,
        lost: codings.filter((coding) => coding.state === "lost").length,
      });
    }
    if (single && request.method === "PATCH") {
      const id = decodeURIComponent(single[1]);
      const { memo } = await body(request);
      await store.setInterviewMemo(id, memo);
      return send(response, 200, { memo });
    }

    // Categories ------------------------------------------------------------
    if (path === "/api/categories" && request.method === "GET") {
      const { categories, propositions } = await store.categories(seedLanguage);
      return send(response, 200, { categories, propositions });
    }
    if (path === "/api/categories" && request.method === "POST") {
      const data = await body(request);
      if (!data.name?.trim()) {
        return send(response, 400, { error: t("errorCategoryName") });
      }
      return send(response, 201, await store.addCategory(data, { beforeCoding: await nothingCoded() }));
    }
    const categoryMerge = path.match(/^\/api\/categories\/([^/]+)\/merge$/);
    if (categoryMerge && request.method === "POST") {
      const source = decodeURIComponent(categoryMerge[1]);
      const { target } = await body(request);
      // Check first, then re-hang the locations, then dissolve the category —
      // in that order no coding ever points at a category that is already gone.
      const early = { beforeCoding: await nothingCoded() };
      await store.checkMerge(source, target, early);
      let moved = 0;
      for (const { id } of await findInterviews(TRANSCRIPTS)) {
        moved += await store.replaceCategory(id, source, target);
      }
      const { target: merged } = await store.mergeCategories(source, target, early);
      return send(response, 200, { target: merged, moved });
    }

    const category = path.match(/^\/api\/categories\/([^/]+)$/);
    if (category && request.method === "PATCH") {
      return send(
        response,
        200,
        await store.updateCategory(decodeURIComponent(category[1]), await body(request)),
      );
    }
    if (category && request.method === "DELETE") {
      const id = decodeURIComponent(category[1]);
      const all = await allInterviews();
      const used = all.reduce(
        (n, interview) => n + interview.codings.filter((c) => c.category === id).length,
        0,
      );
      await store.removeCategory(id, used, { beforeCoding: !used && (await nothingCoded()) });
      return send(response, 204, "");
    }

    // Codings ---------------------------------------------------------------
    const newCoding = path.match(/^\/api\/interviews\/([^/]+)\/codings$/);
    if (newCoding && request.method === "POST") {
      const id = decodeURIComponent(newCoding[1]);
      const data = await body(request);
      for (const field of ["turn", "start", "end", "category", "text"]) {
        if (data[field] === undefined) {
          return send(response, 400, { error: t("errorFieldMissing", { field }) });
        }
      }
      if (data.end <= data.start) {
        return send(response, 400, { error: t("errorEmptySelection") });
      }
      await checkCodableTurn(id, data.turn);
      return send(response, 201, await store.addCoding(id, data));
    }

    const oneCoding = path.match(/^\/api\/interviews\/([^/]+)\/codings\/([^/]+)$/);
    if (oneCoding && request.method === "PATCH") {
      const id = decodeURIComponent(oneCoding[1]);
      const fields = await body(request);
      // Re-anchoring moves a unit to another turn and obeys the same rule.
      if (fields.turn !== undefined) await checkCodableTurn(id, fields.turn);
      return send(
        response,
        200,
        await store.updateCoding(id, decodeURIComponent(oneCoding[2]), fields),
      );
    }
    if (oneCoding && request.method === "DELETE") {
      await store.removeCoding(decodeURIComponent(oneCoding[1]), decodeURIComponent(oneCoding[2]));
      return send(response, 204, "");
    }

    // Requirements ----------------------------------------------------------
    if (path === "/api/requirements" && request.method === "GET") {
      const all = await allInterviews();
      const { requirements } = await store.requirements();
      const { categories, propositions } = await store.categories(seedLanguage);
      return send(response, 200, {
        requirements: catalog(all, requirements, categories),
        moscow: MOSCOW,
        // The same department order as the analysis, so that a department keeps
        // its series color across both views.
        departments: [...new Set(all.map((interview) => interview.transcript.department))],
        propositions,
      });
    }
    if (path === "/api/requirements" && request.method === "POST") {
      return send(response, 201, await store.addRequirement(await body(request)));
    }
    const requirementMerge = path.match(/^\/api\/requirements\/([^/]+)\/merge$/);
    if (requirementMerge && request.method === "POST") {
      const source = decodeURIComponent(requirementMerge[1]);
      const { target } = await body(request);
      await store.checkRequirementMerge(source, target);
      let moved = 0;
      for (const { id } of await findInterviews(TRANSCRIPTS)) {
        moved += await store.replaceRequirement(id, source, target);
      }
      const { target: merged } = await store.mergeRequirements(source, target);
      return send(response, 200, { target: merged, moved });
    }

    const requirement = path.match(/^\/api\/requirements\/([^/]+)$/);
    if (requirement && request.method === "PATCH") {
      return send(
        response,
        200,
        await store.updateRequirement(decodeURIComponent(requirement[1]), await body(request)),
      );
    }
    if (requirement && request.method === "DELETE") {
      const id = decodeURIComponent(requirement[1]);
      await store.removeRequirement(id);
      for (const { id: interview } of await findInterviews(TRANSCRIPTS)) {
        await store.detachRequirement(interview, id);
      }
      return send(response, 204, "");
    }

    // Analysis --------------------------------------------------------------
    /* Intercoder reliability. Its own route rather than part of the analysis:
       it reads a second file per interview folder, and every view of the
       analysis would pay for that whether or not a second coding exists. */
    if (path === "/api/agreement" && request.method === "GET") {
      const { compared, problems } = await allAgreement();
      return send(response, 200, {
        ...compared,
        problems: problems.map((problem) => ({
          ...problem,
          text: t("agreementFileUnreadable", problem),
        })),
      });
    }

    if (path === "/api/analysis" && request.method === "GET") {
      const all = await allInterviews();
      const { categories, propositions } = await store.categories(seedLanguage);
      return send(response, 200, {
        ...analysis(all, categories),
        categories,
        propositions,
      });
    }

    // Exports ---------------------------------------------------------------
    if (path === "/api/export/coding-guide.md") {
      const all = await allInterviews();
      const { categories } = await store.categories(seedLanguage);
      return send(response, 200, codingGuideMarkdown(all, categories, language), MARKDOWN);
    }
    if (path === "/api/export/citations.md") {
      const all = await allInterviews();
      const { categories } = await store.categories(seedLanguage);
      const slice = {
        department: url.searchParams.get("department") ?? "",
        section: url.searchParams.get("section") ?? "",
        anchor: url.searchParams.get("anchor") === "1",
        memo: url.searchParams.get("memo") === "1",
        withoutRequirement: url.searchParams.get("open") === "1",
        unreviewed: url.searchParams.get("unreviewed") === "1",
        word: url.searchParams.get("word") ?? "",
      };
      return send(response, 200, citationsMarkdown(all, categories, slice, language), MARKDOWN);
    }
    if (path === "/api/export/agreement.md") {
      const { compared } = await allAgreement();
      return send(response, 200, agreementMarkdown(compared, language, t), MARKDOWN);
    }
    if (path === "/api/export/analysis.md") {
      const all = await allInterviews();
      const { categories } = await store.categories(seedLanguage);
      return send(
        response,
        200,
        analysisMarkdown(analysis(all, categories), categories, language),
        MARKDOWN,
      );
    }
    if (path === "/api/export/sample.md") {
      return send(response, 200, sampleMarkdown(await allInterviews(), language), MARKDOWN);
    }
    if (path === "/api/export/notes.md") {
      const all = await allInterviews();
      const { categories } = await store.categories(seedLanguage);
      return send(response, 200, notesMarkdown(all, categories, language), MARKDOWN);
    }
    if (path === "/api/export/matrix.md") {
      const all = await allInterviews();
      const { categories } = await store.categories(seedLanguage);
      return send(
        response,
        200,
        matrixGridMarkdown(analysis(all, categories), categories, language),
        MARKDOWN,
      );
    }
    if (path === "/api/export/requirements-catalog.md") {
      const all = await allInterviews();
      const { requirements } = await store.requirements();
      const { categories } = await store.categories(seedLanguage);
      return send(
        response,
        200,
        catalogMarkdown(catalog(all, requirements, categories), language),
        MARKDOWN,
      );
    }
    const codingTable = path.match(/^\/api\/export\/coding-table\/([^/]+)\.md$/);
    if (codingTable) {
      const id = decodeURIComponent(codingTable[1]);
      const { transcript, codings } = await loadChecked(id);
      const { categories } = await store.categories(seedLanguage);
      return send(response, 200, codingTableMarkdown(transcript, codings, categories, language), MARKDOWN);
    }

    send(response, 404, { error: t("errorUnknownEndpoint") });
  } catch (error) {
    const status = error.status ?? 500;
    // A named case has already been thought through and reads as a sentence;
    // dumping its stack on top only buries the sentence.
    if (status === 500 && !error.key) console.error(error);
    else if (error.key) console.error(`${error.key}: ${t(error.key, error.params)}`);
    // The storage layer throws a key; the request knows the language. Anything
    // without a key is an unforeseen error and keeps its own wording.
    send(response, status, {
      error: error.key ? t(error.key, error.params) : error.message,
      code: error.key,
      conflict: error.conflict,
    });
  }
});

/**
 * Says at startup what would otherwise only show at the first click.
 *
 * A container pointed at a folder it may not write to comes up looking healthy
 * and fails on the first coding. Finding that out while starting costs one
 * check and saves reading a stack trace.
 */
async function checkDataFolder() {
  const folder = dirname(store.categoriesFile);
  try {
    await mkdir(folder, { recursive: true });
    await access(folder, constants.W_OK);
  } catch {
    console.warn(`! ${folder} is not writable — codings cannot be saved.`);
    console.warn("! The folder belongs to another user or is mounted read-only.");
    console.warn("! See the Docker section of the README for the usual causes.");
  }
}

server.listen(PORT, HOST, async () => {
  console.log(`Fundstelle on http://${HOST}:${PORT}`);
  console.log(`Transcripts from ${TRANSCRIPTS}`);
  await checkDataFolder();
});
