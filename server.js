/**
 * Local server of the coding tool.
 *
 * No dependencies and no login: the tool runs on the author's own machine and
 * reads the same files that version the work. It deliberately binds to
 * localhost only, because transcripts remain personal data even after
 * pseudonymization.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findInterviews, loadTranscript } from "./lib/transcript.js";
import { occurrences, trimStem } from "./public/search.js";
import { Store } from "./lib/store.js";
import { checkAnchors, withoutCheckMarks } from "./lib/anchoring.js";
import { LANGUAGES, negotiate, translator } from "./lib/texts.js";
import {
  MOSCOW,
  analysis,
  catalog,
  catalogMarkdown,
  citationsMarkdown,
  codingGuideMarkdown,
  codingTableMarkdown,
  matrixGridMarkdown,
  notesMarkdown,
} from "./lib/analysis.js";

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

async function allInterviews() {
  const found = await findInterviews(TRANSCRIPTS);
  const loaded = [];
  for (const { id } of found) loaded.push(await loadChecked(id));
  return loaded;
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

    // Environment: the first start names the folder transcripts belong in.
    if (path === "/api/environment" && request.method === "GET") {
      return send(response, 200, { transcripts: TRANSCRIPTS });
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
      // say what was searched for instead.
      const stem = trimStem(word);
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
        codings,
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
      return send(response, 201, await store.addCategory(data));
    }
    const categoryMerge = path.match(/^\/api\/categories\/([^/]+)\/merge$/);
    if (categoryMerge && request.method === "POST") {
      const source = decodeURIComponent(categoryMerge[1]);
      const { target } = await body(request);
      // Check first, then re-hang the locations, then dissolve the category —
      // in that order no coding ever points at a category that is already gone.
      await store.checkMerge(source, target);
      let moved = 0;
      for (const { id } of await findInterviews(TRANSCRIPTS)) {
        moved += await store.replaceCategory(id, source, target);
      }
      const { target: merged } = await store.mergeCategories(source, target);
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
      await store.removeCategory(id, used);
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
      return send(response, 201, await store.addCoding(id, data));
    }

    const oneCoding = path.match(/^\/api\/interviews\/([^/]+)\/codings\/([^/]+)$/);
    if (oneCoding && request.method === "PATCH") {
      return send(
        response,
        200,
        await store.updateCoding(
          decodeURIComponent(oneCoding[1]),
          decodeURIComponent(oneCoding[2]),
          await body(request),
        ),
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
    if (status === 500) console.error(error);
    // The storage layer throws a key; the request knows the language. Anything
    // without a key is an unforeseen error and keeps its own wording.
    send(response, status, {
      error: error.key ? t(error.key, error.params) : error.message,
      code: error.key,
      conflict: error.conflict,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Fundstelle on http://${HOST}:${PORT}`);
  console.log(`Transcripts from ${TRANSCRIPTS}`);
});
