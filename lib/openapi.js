/**
 * The interface, described.
 *
 * Fundstelle is a tool somebody operates, and it is also a study sitting behind
 * an HTTP interface: every number, every document and — since the figures moved
 * out of the browser — every picture can be fetched by something that is not
 * the interface. That is worth having written down properly. A methods chapter
 * assembled by a script, a lab pipeline that codes with one tool and reports
 * with another, a supervisor's dashboard: none of those should have to be read
 * out of `server.js`.
 *
 * Written as a module rather than as a `openapi.yaml` for one reason: it can
 * *bind* to what it describes. The list of figures, the two themes, the two
 * languages, the MoSCoW levels and the version all come from the code that
 * implements them, so those parts of the description cannot fall behind. What
 * cannot be bound — the wording, the shapes, the reasons — is written out, and
 * `tests/openapi.spec.js` compares the documented paths against the routes the
 * server actually answers, so a route added without a paragraph fails the
 * suite rather than quietly becoming folklore.
 *
 * Served at `/api/openapi.json`. Point Swagger UI, Redoc, Bruno, Insomnia or a
 * code generator at it; `/api/docs` renders it without any of them.
 */

import { FIGURE_NAMES, THEME_NAMES } from "../public/charts.js";
import { LANGUAGES } from "./texts.js";
import { MOSCOW } from "./analysis.js";

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const json = (schema, example) => ({
  content: { "application/json": { schema, ...(example ? { example } : {}) } },
});

const markdown = (description) => ({
  description,
  content: { "text/markdown": { schema: { type: "string" } } },
});

/** A named error, as the request boundary sends it. */
const problem = (description, code) => ({
  description,
  content: {
    "application/json": {
      schema: ref("Error"),
      ...(code ? { example: { error: "…", code } } : {}),
    },
  },
});

const LANG = {
  name: "lang",
  in: "query",
  required: false,
  description:
    "The language of everything worded in the answer — error messages, export prose, figure " +
    "titles. Beats the `Accept-Language` header, which beats English as the international " +
    "default. It does not translate the study: category names are the author's words and stay.",
  schema: { type: "string", enum: LANGUAGES },
};

const PROPOSITION_ID = {
  name: "id",
  in: "path",
  required: true,
  description: "The proposition's id, derived from its wording when it was added.",
  schema: { type: "string" },
  example: "practice",
};

const OPERATION_ID = {
  name: "id",
  in: "path",
  required: true,
  description: "The operation's id, derived from its name when it was added.",
  schema: { type: "string" },
  example: "filing",
};

const INTERVIEW_ID = {
  name: "id",
  in: "path",
  required: true,
  description:
    "The interview's folder name under the transcript root. One path segment; anything with a " +
    "slash or a `..` in it is refused before it reaches the file system.",
  schema: { type: "string" },
  example: "interview-01",
};

export function openapiDocument({ version = "unknown" } = {}) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Fundstelle",
      version,
      summary: "Qualitative content analysis over HTTP: transcripts, codings, analysis, figures.",
      description: [
        "Fundstelle codes interview transcripts by Mayring's qualitative content analysis and",
        "keeps everything it knows in plain files beside the transcripts. This interface is the",
        "same one the browser talks to — there is no second, private one — so anything the tool",
        "can show, a script can fetch.",
        "",
        "### Where the data is",
        "",
        "Codings live in `coding.json` inside each interview folder, the category system in one",
        "`categories.json`, the requirements in one `requirements.json`. They are readable,",
        "diffable files: putting them under version control alongside the transcripts is the",
        "intended way to work, and the reason the field order in them is fixed.",
        "",
        "### What holds a coding in place",
        "",
        "A coding unit is a character range inside a numbered speaker turn — not an offset into",
        "the file. When a transcript is corrected the ranges are re-checked on the next read:",
        "unambiguous moves are made silently, and a unit whose passage can no longer be found",
        "gets `state: \"lost\"` and is counted on no surface until somebody puts it back. A unit",
        "with no place counts nowhere is the rule the whole tool is built on.",
        "",
        "### Authentication",
        "",
        "None, deliberately. The server binds `127.0.0.1` unless told otherwise, because",
        "transcripts remain personal data after pseudonymisation, and a login on a single-user",
        "local tool would be a password to lose rather than a defence.",
        "",
        "What is defended is the browser: any request that changes something must come from",
        "this tool's own interface. The check reads `Sec-Fetch-Site`, falling back to `Origin`,",
        "and answers `403 errorForeignOrigin` otherwise — so a page on the internet cannot make",
        "your browser delete your codings. A request with neither header, which is what `curl`",
        "and every script send, is allowed: they are not a browser being aimed at you.",
        "",
        "### Errors",
        "",
        "Every failure that has been thought about carries a `code` — a stable key — next to a",
        "sentence in the language of the request. Match on `code`; show `error`.",
      ].join("\n"),
      license: { name: "MIT", identifier: "MIT" },
      contact: { name: "Fundstelle", url: "https://github.com/Illustratus/Fundstelle" },
    },
    servers: [
      { url: "http://127.0.0.1:4173", description: "The default of a local start" },
      { url: "/", description: "Wherever this document was fetched from" },
    ],
    tags: [
      { name: "Study", description: "What the tool is pointed at, and what it is." },
      { name: "Transcripts", description: "Bringing material in and reading it back." },
      { name: "Categories", description: "The category system: the instrument of the analysis." },
      { name: "Codings", description: "Coding units: a category on a passage." },
      { name: "Requirements", description: "The catalog built out of cited passages." },
      { name: "Roles", description: "The role profiles, and the evidence each one stands on." },
      { name: "Analysis", description: "Counted, compared and drawn." },
      { name: "Figures", description: "The pictures, as files that stand on their own." },
      { name: "Exports", description: "Documents for the thesis, the appendix, and other tools." },
    ],

    paths: {
      /* Study --------------------------------------------------------------- */
      "/api/version": {
        get: {
          tags: ["Study"],
          operationId: "getVersion",
          summary: "Which version this is",
          description:
            "Answerable from inside the tool, because somebody filing an issue should not have " +
            "to guess and a machine watching the container should not have to parse a label.",
          responses: {
            200: {
              description: "The tool's version and the Node it is running on.",
              ...json(
                {
                  type: "object",
                  required: ["version", "node"],
                  properties: {
                    version: { type: "string", description: "`unknown` outside a checkout or image." },
                    node: { type: "string" },
                  },
                },
                { version, node: "24.19.0" },
              ),
            },
          },
        },
      },

      "/api/environment": {
        get: {
          tags: ["Study"],
          operationId: "getEnvironment",
          summary: "Where the transcripts are read from",
          description:
            "The absolute path the tool is pointed at. The empty screen shows it, because " +
            "\"put your interviews here\" is only useful if it says where here is.",
          responses: {
            200: {
              description: "The transcript root.",
              ...json(
                { type: "object", properties: { transcripts: { type: "string" } } },
                { transcripts: "/Users/you/study/transcripts" },
              ),
            },
          },
        },
      },

      "/api/example": {
        post: {
          tags: ["Study"],
          operationId: "writeExampleStudy",
          summary: "Write the bundled example study",
          description:
            "Three interviews from three departments, in the language of the request, written " +
            "into the transcript folder. Three and not one: a single interview has a cross " +
            "table of one column, no saturation curve — that needs three — and nothing for the " +
            "categories to meet in, which is most of what the tool is worth choosing for.\n\n" +
            "They arrive **uncoded**. The tool has never invented a coding and does not start " +
            "on the screen where somebody is deciding whether to trust it.\n\n" +
            "Only onto a folder that holds no interviews, and never over a file that is there.",
          parameters: [LANG],
          responses: {
            201: {
              description: "Written. The name of the first interview folder comes back.",
              ...json({ type: "object", properties: { interview: { type: "string" } } }),
            },
            409: problem("There are already interviews in the folder.", "errorExampleNotEmpty"),
          },
        },
      },

      /* Transcripts --------------------------------------------------------- */
      "/api/import/read": {
        post: {
          tags: ["Transcripts"],
          operationId: "readTranscript",
          summary: "Read a transcript without writing anything",
          description:
            "The first of two steps, and it only reads: which shape the file is, how many turns " +
            "it became, and who is speaking in it.\n\n" +
            "Nothing is written until somebody has said which of those speakers was asking. The " +
            "interviewer's turns cannot be coded, so guessing would either take half the " +
            "material out of the study or offer the questions up as findings.",
          parameters: [LANG],
          requestBody: {
            required: true,
            ...json(
              {
                type: "object",
                required: ["text"],
                properties: {
                  text: {
                    type: "string",
                    description:
                      "The raw transcript. Speaker-prefixed lines, Word-style dialogue and " +
                      "timestamped formats are all recognised.",
                  },
                },
              },
              { text: "Anna: Wie läuft das bei euch?\nB: Die Unterlagen liegen im Laufwerk.\n" },
            ),
          },
          responses: {
            200: {
              description: "What was read, with the first few turns to look at.",
              ...json({
                type: "object",
                properties: {
                  format: { type: "string", description: "The shape it was recognised as." },
                  speakers: { type: "array", items: { type: "string" } },
                  turns: { type: "integer" },
                  preview: {
                    type: "array",
                    description: "Up to four turns, truncated, so the reading can be checked by eye.",
                    items: {
                      type: "object",
                      properties: { speaker: { type: "string" }, text: { type: "string" } },
                    },
                  },
                },
              }),
            },
            400: problem("The `text` field is missing altogether."),
            422: problem(
              "There was content, but nothing in it could be read as a speaker turn. A different " +
                "answer from 400 on purpose: telling somebody who just dropped a file that a " +
                "field is missing is a message about the wrong thing.",
              "importNothingRead",
            ),
          },
        },
      },

      "/api/import": {
        post: {
          tags: ["Transcripts"],
          operationId: "importTranscript",
          summary: "Bring a transcript in as an interview",
          description:
            "The second step: converts the raw text into this tool's Markdown and writes it as " +
            "`final.md` in a new folder.\n\n" +
            "Never over an existing transcript. Turn numbers are what codings hold on to, so " +
            "overwriting one would move every citation in that interview.",
          parameters: [LANG],
          requestBody: {
            required: true,
            ...json(
              {
                type: "object",
                required: ["text"],
                properties: {
                  text: { type: "string" },
                  interviewer: {
                    type: "string",
                    description:
                      "Which speaker was asking. Their turns become uncodable — the questions " +
                      "are the instrument, not the material.",
                  },
                  department: {
                    type: "string",
                    description:
                      "The unit this interview stands for. Carries the series colour across " +
                      "every figure, and is what the cross table is split by.",
                  },
                  title: { type: "string", description: "Defaults to `Interview: <department>`." },
                  date: { type: "string", description: "Free text; lands in the transcript's metadata." },
                  folder: { type: "string", description: "Overrides the folder name derived from the title." },
                },
              },
              {
                text: "Anna: Wie läuft das bei euch?\nB: Die Unterlagen liegen im Laufwerk.\n",
                interviewer: "Anna",
                department: "Vertrieb",
                title: "Interview 2: Vertrieb",
              },
            ),
          },
          responses: {
            201: {
              description: "Written.",
              ...json({
                type: "object",
                properties: {
                  interview: { type: "string" },
                  turns: { type: "integer" },
                  title: { type: "string" },
                },
              }),
            },
            400: problem("The `text` field is missing."),
            409: problem("That folder already holds a transcript.", "importExists"),
            422: problem("Nothing in the text could be read as a speaker turn.", "importNothingRead"),
          },
        },
      },

      "/api/interviews": {
        get: {
          tags: ["Transcripts"],
          operationId: "listInterviews",
          summary: "Every interview, with its counts",
          description:
            "One line per interview: how long it is, how much is coded, and how much of that is " +
            "still only a suggestion. `unreviewed` is what the study has left to confirm; a unit " +
            "that has lost its place is not counted there, because it is a different job.",
          responses: {
            200: {
              description: "All interviews in reading order.",
              ...json({ type: "array", items: ref("InterviewSummary") }),
            },
          },
        },
      },

      "/api/interviews/{id}": {
        get: {
          tags: ["Transcripts"],
          operationId: "getInterview",
          summary: "One interview whole: turns, sections, codings, memo",
          description:
            "The transcript with its speaker turns and guide sections, and every coding unit in " +
            "it with its anchor checked. `moved` counts units this read put back by itself; " +
            "`lost` counts the ones that need a person.\n\n" +
            "Anything that could not be read out of the file arrives under `problems`, worded " +
            "in the language of the request rather than as a stack trace.",
          parameters: [INTERVIEW_ID, LANG],
          responses: {
            200: { description: "The interview.", ...json(ref("Interview")) },
            404: problem("No interview by that name.", "errorUnknownInterview"),
          },
        },
        patch: {
          tags: ["Transcripts"],
          operationId: "updateInterview",
          summary: "Set the memo, or what the transcript says about itself",
          description:
            "`memo` is the note about the interview as a whole — the conditions, what was " +
            "noticed while coding it. It travels into the analysis document and the appendix.\n\n" +
            "`title`, `department` and `meta` rewrite the header of the transcript file: the " +
            "`# Title` line and the `- Field: value` lines under it, which are what the sample " +
            "table of a paper is built from. The department is not a line of its own in the " +
            "format — it is read off the title behind the colon — so setting it writes the " +
            "title.\n\n" +
            "The turns are not touched. A coding unit holds its place by turn number and " +
            "character range inside that turn, so nothing here moves a citation.",
          parameters: [INTERVIEW_ID, LANG],
          requestBody: {
            required: true,
            ...json({
              type: "object",
              properties: {
                memo: { type: "string" },
                title: { type: "string" },
                department: { type: "string" },
                meta: {
                  type: "object",
                  description: "Header lines, as field and value. Replaces the block whole.",
                  additionalProperties: { type: "string" },
                },
              },
            }),
          },
          responses: {
            200: {
              description: "Set. The header fields come back as the file now reads them.",
              ...json({
                type: "object",
                properties: {
                  memo: { type: "string" },
                  title: { type: "string" },
                  department: { type: "string" },
                  meta: { type: "object", additionalProperties: { type: "string" } },
                },
              }),
            },
            400: problem("`meta` was not an object.", "errorMetaObject"),
            404: problem("No interview by that name.", "errorUnknownInterview"),
          },
        },
        delete: {
          tags: ["Transcripts"],
          operationId: "removeInterview",
          summary: "Take an interview out of the study",
          description:
            "Deletes the interview's folder: the transcript and the codings beside it, " +
            "together. There is no copy anywhere and nothing to undo it with — these files are " +
            "meant to be version-controlled beside each other, which is what the folder layout " +
            "is for and where they can be got back from.\n\n" +
            "A second coder's `coding.<name>.json` in that folder goes with it.",
          parameters: [INTERVIEW_ID, LANG],
          responses: {
            204: { description: "Gone." },
            404: problem("No interview by that name.", "errorUnknownInterview"),
          },
        },
      },

      "/api/interviews/{id}/rename": {
        post: {
          tags: ["Transcripts"],
          operationId: "renameInterview",
          summary: "Give an interview another folder name",
          description:
            "The folder name is the interview's identifier: it stands in every export, in the " +
            "version history, and in the path of every route here. It is made from a working " +
            "title at import time, which is the moment one knows least about the study.\n\n" +
            "`to` is slugged the way the import slugs a title, so “Marketing & PR” becomes " +
            "`marketing-pr`; the answer says which name it actually became. The codings live " +
            "inside the folder and move with it, and nothing inside either file names the " +
            "folder, so nothing else has to be rewritten.",
          parameters: [INTERVIEW_ID, LANG],
          requestBody: {
            required: true,
            ...json({ type: "object", required: ["to"], properties: { to: { type: "string" } } }),
          },
          responses: {
            200: {
              description: "Moved.",
              ...json({ type: "object", properties: { id: { type: "string" } } }),
            },
            400: problem("No `to` given."),
            404: problem("No interview by that name.", "errorUnknownInterview"),
            409: problem("A folder of that name already exists.", "errorInterviewExists"),
          },
        },
      },

      "/api/search": {
        get: {
          tags: ["Transcripts"],
          operationId: "search",
          summary: "A word across every interview",
          description:
            "Searches what people **said** — the transcripts. Not the category names and not " +
            "the guide prompts: a prompt is the question rather than the answer, and a category " +
            "name is the tool's word rather than the respondent's.\n\n" +
            "If nothing is found the same search is run again without the inflecting ending, " +
            "and `instead` says which word that was. Fewer than two characters returns nothing " +
            "rather than everything.",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              description: "The word. Under two characters the answer is empty.",
              schema: { type: "string" },
            },
            LANG,
          ],
          responses: {
            200: {
              description: "Where the word occurs, per interview, with the first passage.",
              ...json({
                type: "object",
                properties: {
                  word: { type: "string" },
                  instead: {
                    type: "string",
                    description: "Present only when the search fell back to the stem.",
                  },
                  interviews: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        title: { type: "string" },
                        department: { type: "string" },
                        hits: { type: "integer" },
                        first: {
                          type: "object",
                          properties: {
                            turn: { type: "integer" },
                            excerpt: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              }),
            },
          },
        },
      },

      /* Propositions --------------------------------------------------------- */
      "/api/propositions": {
        post: {
          tags: ["Categories"],
          operationId: "addProposition",
          summary: "Add a proposition",
          description:
            "A proposition is what a branch of the category system argues, and the colour every " +
            "figure of the study draws that branch in. They are seeded with the category " +
            "system and are the author's from then on — a study about something other than the " +
            "bundled example should not carry the example's claims into its own appendix.\n\n" +
            "The id is derived from the wording and never changes afterwards, because every " +
            "category points at it. `color` is a hex colour: it is written into the SVG of " +
            "every figure, so anything that is not plainly one is refused.",
          parameters: [LANG],
          requestBody: {
            required: true,
            ...json({
              type: "object",
              required: ["name", "color"],
              properties: { name: { type: "string" }, color: { type: "string", example: "#6C8EBF" } },
            }),
          },
          responses: {
            201: { description: "Added.", ...json(ref("Proposition")) },
            400: problem("No wording, or `color` is not a colour.", "errorColorShape"),
            409: problem("One with that wording already exists.", "errorPropositionExists"),
          },
        },
      },

      "/api/propositions/{id}": {
        patch: {
          tags: ["Categories"],
          operationId: "updateProposition",
          summary: "Change a proposition's wording or colour",
          description:
            "The wording as it appears in the key of every figure, and the colour it is drawn " +
            "in. The id stays what it was: the categories point at it, and renaming a heading " +
            "is not re-anchoring the categories under it.",
          parameters: [PROPOSITION_ID, LANG],
          requestBody: {
            required: true,
            ...json({
              type: "object",
              properties: { name: { type: "string" }, color: { type: "string" } },
            }),
          },
          responses: {
            200: { description: "Changed.", ...json(ref("Proposition")) },
            400: problem("Empty wording, or `color` is not a colour.", "errorColorShape"),
            404: problem("No proposition by that id.", "errorUnknownProposition"),
          },
        },
        delete: {
          tags: ["Categories"],
          operationId: "removeProposition",
          summary: "Dissolve a proposition",
          description:
            "The categories that argued it stay and fall back to `none` — “derived from the " +
            "research interest” — which is why `none` itself cannot be dissolved: it is what " +
            "everything lands on. Its wording and colour can be changed like any other's.\n\n" +
            "The categories are not asked about first. A proposition is a heading over them, " +
            "not a thing they are made of.",
          parameters: [PROPOSITION_ID, LANG],
          responses: {
            204: { description: "Dissolved." },
            404: problem("No proposition by that id.", "errorUnknownProposition"),
            409: problem("It is the fallback and stays.", "errorPropositionStays"),
          },
        },
      },

      /* Categories ---------------------------------------------------------- */
      "/api/categories": {
        get: {
          tags: ["Categories"],
          operationId: "getCategories",
          summary: "The category system and the propositions it hangs on",
          description:
            "Every category with its definition, its coding rules and where it came from. On " +
            "the very first read the system is seeded — from `START_SYSTEM` if one is " +
            "configured, otherwise from the bundled example — in the language of that request.",
          parameters: [LANG],
          responses: {
            200: {
              description: "The system.",
              ...json({
                type: "object",
                properties: {
                  categories: { type: "array", items: ref("Category") },
                  propositions: ref("Propositions"),
                },
              }),
            },
          },
        },
        post: {
          tags: ["Categories"],
          operationId: "addCategory",
          summary: "Add a category",
          description:
            "`origin` is a claim about method, and the tool will not let it be made falsely: a " +
            "category is only recorded as **deductive** if it is created before anything has " +
            "been coded, because that is what \"fixed before the material was worked\" means. " +
            "Everything after the first coding unit is **inductive**, whatever was asked for.\n\n" +
            "The id is derived from the name, and an inductive one carries an `ind.` prefix so " +
            "the file says where it came from at a glance.",
          parameters: [LANG],
          requestBody: {
            required: true,
            ...json(
              {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  definition: { type: "string" },
                  parent: {
                    type: ["string", "null"],
                    description: "Two levels only; anything deeper hangs on the top of its branch.",
                  },
                  origin: { type: "string", enum: ["deductive", "inductive"] },
                },
              },
              { name: "Übergaben", definition: "Wenn eine Aufgabe den Bereich wechselt.", parent: null },
            ),
          },
          responses: {
            201: { description: "Added.", ...json(ref("Category")) },
            400: problem("No name."),
            409: problem("A category with that id already exists.", "errorCategoryExists"),
          },
        },
      },

      "/api/categories/{id}": {
        patch: {
          tags: ["Categories"],
          operationId: "updateCategory",
          summary: "Change a category",
          description:
            "Name, definition, coding rules, parent. Subordinating an inductive category is " +
            "ordinary work — where it belongs only shows in the material — and the proposition " +
            "follows the new parent.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, LANG],
          requestBody: {
            required: true,
            ...json({
              type: "object",
              properties: {
                name: { type: "string" },
                definition: { type: "string" },
                codingRules: { type: "array", items: { type: "string" } },
                parent: { type: ["string", "null"] },
                proposition: { type: "string" },
              },
            }),
          },
          responses: {
            200: { description: "Changed.", ...json(ref("Category")) },
            404: problem("No category by that id.", "errorUnknownCategory"),
          },
        },
        delete: {
          tags: ["Categories"],
          operationId: "removeCategory",
          summary: "Delete a category",
          description:
            "A category still carrying coding units is refused, and so is a deductive one once " +
            "coding has begun: the instrument of a content analysis is not edited halfway " +
            "through the material without saying so.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, LANG],
          responses: {
            204: { description: "Gone." },
            404: problem("No category by that id.", "errorUnknownCategory"),
            409: problem("It is in use, or it is deductive and coding has begun."),
          },
        },
      },

      "/api/categories/{id}/merge": {
        post: {
          tags: ["Categories"],
          operationId: "mergeCategories",
          summary: "Merge one category into another",
          description:
            "Re-hangs every coding unit of the source onto the target and then dissolves the " +
            "source. In that order, so no unit ever points at a category that is already gone.\n\n" +
            "Everything needed to take it back travels in the answer under `undo`. The tool " +
            "keeps no server-side history: the message that offers the undo holds it, and when " +
            "the message goes so does the offer. Hand it back to " +
            "`POST /api/categories/merge/undo` unchanged.",
          parameters: [
            { name: "id", in: "path", required: true, description: "The category being dissolved.", schema: { type: "string" } },
            LANG,
          ],
          requestBody: {
            required: true,
            ...json({ type: "object", required: ["target"], properties: { target: { type: "string" } } }),
          },
          responses: {
            200: {
              description: "Merged. `moved` is how many units changed hands.",
              ...json({
                type: "object",
                properties: {
                  target: ref("Category"),
                  moved: { type: "integer" },
                  undo: { type: "object", description: "Opaque; hand it back as-is to undo." },
                },
              }),
            },
            409: problem("The merge is not allowed — the same category, or a deductive one after coding began."),
          },
        },
      },

      "/api/categories/merge/undo": {
        post: {
          tags: ["Categories"],
          operationId: "undoCategoryMerge",
          summary: "Take a merge back",
          description:
            "Restores the dissolved category and returns every unit that was moved. Takes the " +
            "`undo` object from the merge answer verbatim.",
          parameters: [LANG],
          requestBody: { required: true, ...json({ type: "object", description: "The `undo` from the merge." }) },
          responses: {
            200: {
              description: "Restored.",
              ...json({
                type: "object",
                properties: { restored: ref("Category"), moved: { type: "integer" } },
              }),
            },
          },
        },
      },

      "/api/categories/codebook": {
        post: {
          tags: ["Categories"],
          operationId: "importCodebook",
          summary: "Read a category system out of another program",
          description:
            "Takes a REFI-QDA codebook (`.qdc`, or the codebook inside a `.qdpx`) as base64 and " +
            "adds its codes.\n\n" +
            "Only the codes. Their plain text is not this format's turns and guide prompts, and " +
            "inventing speakers to hang their character offsets on would produce a transcript " +
            "nobody said — so the material stays where it is, and the answer only ever mentions " +
            "categories.\n\n" +
            "A name already in the system lands in `skipped` with a reason rather than failing " +
            "the import: running it twice is the normal reason to run it at all.",
          parameters: [LANG],
          requestBody: {
            required: true,
            ...json({
              type: "object",
              required: ["file"],
              properties: {
                file: { type: "string", format: "byte", description: "The `.qdc` or `.qdpx`, base64." },
              },
            }),
          },
          responses: {
            201: {
              description: "What was added and what was already there.",
              ...json({
                type: "object",
                properties: {
                  added: { type: "array", items: { type: "string" } },
                  skipped: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { name: { type: "string" }, why: { type: "string" } },
                    },
                  },
                  categories: { type: "array", items: ref("Category") },
                  propositions: ref("Propositions"),
                },
              }),
            },
            400: problem("The `file` field is missing."),
            422: problem("The file could not be read, or holds no codes.", "errorCodebookEmpty"),
          },
        },
      },

      /* Codings ------------------------------------------------------------- */
      "/api/interviews/{id}/codings": {
        post: {
          tags: ["Codings"],
          operationId: "addCoding",
          summary: "Code a passage",
          description:
            "A category on a character range inside one speaker turn. Exactly one category per " +
            "place: two units overlapping in the same turn are refused, not merely discouraged.\n\n" +
            "An interviewer's turn cannot be coded — the questions are the instrument.\n\n" +
            "`reviewed` defaults to **false** on purpose. What is created programmatically — a " +
            "machine pre-coding, an import — is a suggestion until a person confirms it. The " +
            "interface sets it explicitly, because there the act of coding is the review.",
          parameters: [INTERVIEW_ID, LANG],
          requestBody: { required: true, ...json(ref("CodingInput")) },
          responses: {
            201: { description: "Coded.", ...json(ref("Coding")) },
            400: problem("A field is missing, or the selection is empty (`end` ≤ `start`)."),
            404: problem("No such interview, or no such turn.", "errorUnknownTurn"),
            409: problem(
              "It overlaps a unit already there, or the turn is the interviewer's. The unit in " +
                "the way comes back under `conflict`.",
              "errorOverlap",
            ),
          },
        },
      },

      "/api/interviews/{id}/codings/{coding}": {
        patch: {
          tags: ["Codings"],
          operationId: "updateCoding",
          summary: "Change or re-anchor a coding unit",
          description:
            "Category, memo, review mark, attached requirements — and the place itself. Sending " +
            "`turn`, `start` and `end` moves the unit, which is how a lost one is put back, and " +
            "the new place obeys the same no-overlap rule as a new coding.",
          parameters: [
            INTERVIEW_ID,
            { name: "coding", in: "path", required: true, description: "The unit's id.", schema: { type: "string", format: "uuid" } },
            LANG,
          ],
          requestBody: { required: true, ...json(ref("CodingInput")) },
          responses: {
            200: { description: "Changed.", ...json(ref("Coding")) },
            404: problem("No such coding unit.", "errorUnknownCoding"),
            409: problem("The new place overlaps another unit.", "errorOverlap"),
          },
        },
        delete: {
          tags: ["Codings"],
          operationId: "removeCoding",
          summary: "Delete a coding unit",
          description:
            "Gone from the file, and from every count it was in. A unit attached to a " +
            "requirement takes its citation with it — the requirement stays, it is simply " +
            "carried by one passage fewer, which is the honest thing for it to say.",
          parameters: [
            INTERVIEW_ID,
            { name: "coding", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            204: { description: "Gone." },
            404: problem("No such coding unit.", "errorUnknownCoding"),
          },
        },
      },

      "/api/export/coding.json": {
        get: {
          tags: ["Codings"],
          operationId: "exportCodingBundle",
          summary: "The whole coding as one file, for a second coder",
          description:
            "Intercoder reliability needs somebody else to code the same material. This is the " +
            "study's coding as a single bundle to hand over; the other person codes in their " +
            "own copy and sends their bundle back through `POST /api/codings/second`.\n\n" +
            "The review marks are stripped: whether *you* confirmed a unit is not something the " +
            "other coder should see, let alone inherit.",
          parameters: [
            {
              name: "name",
              in: "query",
              description: "Who is coding. Travels with the file and names the comparison later.",
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "The bundle.",
              ...json({
                type: "object",
                properties: {
                  fundstelle: { type: "string", const: "coding" },
                  version: { type: "integer" },
                  coder: { type: "string" },
                  interviews: {
                    type: "object",
                    additionalProperties: {
                      type: "object",
                      properties: {
                        codings: { type: "array", items: ref("Coding") },
                        memo: { type: "string" },
                      },
                    },
                  },
                },
              }),
            },
          },
        },
      },

      "/api/codings/second": {
        post: {
          tags: ["Codings"],
          operationId: "putSecondCoding",
          summary: "Take a second coder's bundle in",
          description:
            "Writes the other person's coding beside your own, one file per interview folder, " +
            "where the comparison reads it. It never touches your codings.\n\n" +
            "An interview they coded that this study does not hold is **named** rather than " +
            "written somewhere it does not belong — `missing` is the answer to the typo, not a " +
            "silent half-import.",
          parameters: [LANG],
          requestBody: {
            required: true,
            ...json({
              type: "object",
              required: ["bundle"],
              properties: {
                bundle: { type: "object", description: "A file from `GET /api/export/coding.json`." },
                name: { type: "string", description: "Overrides the coder name in the bundle." },
              },
            }),
          },
          responses: {
            201: {
              description: "Written.",
              ...json({
                type: "object",
                properties: {
                  written: { type: "array", items: { type: "string" } },
                  missing: {
                    type: "array",
                    items: { type: "string" },
                    description: "Interviews in the bundle that this study does not hold.",
                  },
                },
              }),
            },
            422: problem("Not a coding bundle, or nothing in it belongs here.", "errorBundleUnreadable"),
          },
        },
      },

      /* Requirements -------------------------------------------------------- */
      "/api/operations": {
        post: {
          tags: ["Requirements"],
          operationId: "addOperation",
          summary: "Add an operation a requirement can block",
          description:
            "Half of the prioritisation is counted from the material — how many departments " +
            "name a requirement — and the other half is the judgment of what its absence " +
            "blocks. What there is to block used to be three words compiled into the tool, so " +
            "a study about something else weighed its requirements against a triple it never " +
            "chose. They are seeded with those three and belong to the study from then on.\n\n" +
            "Read them from `GET /api/requirements`, which is where the catalog gets them.",
          parameters: [LANG],
          requestBody: {
            required: true,
            ...json({ type: "object", required: ["name"], properties: { name: { type: "string" } } }),
          },
          responses: {
            201: { description: "Added.", ...json(ref("Operation")) },
            400: problem("No name.", "errorOperationName"),
            409: problem("One with that name already exists.", "errorOperationExists"),
          },
        },
      },

      "/api/operations/{id}": {
        patch: {
          tags: ["Requirements"],
          operationId: "updateOperation",
          summary: "Rename an operation",
          description:
            "The name as it stands on every requirement card and in the catalog export. The id " +
            "stays what it was, because the requirements point at it — renaming is not " +
            "re-judging what they block.",
          parameters: [OPERATION_ID, LANG],
          requestBody: {
            required: true,
            ...json({ type: "object", properties: { name: { type: "string" } } }),
          },
          responses: {
            200: { description: "Renamed.", ...json(ref("Operation")) },
            400: problem("Empty name.", "errorOperationName"),
            404: problem("No operation by that id.", "errorUnknownOperation"),
          },
        },
        delete: {
          tags: ["Requirements"],
          operationId: "removeOperation",
          summary: "Dissolve an operation",
          description:
            "It goes off every requirement that named it, and `dropped` says how many those " +
            "were. A requirement still naming it would be weighed against something the study " +
            "no longer knows: the prioritisation field counts blocked operations, and a count " +
            "including a ghost is a count nobody can check.",
          parameters: [OPERATION_ID, LANG],
          responses: {
            200: {
              description: "Dissolved.",
              ...json({
                type: "object",
                properties: {
                  dropped: {
                    type: "integer",
                    description: "How many requirements gave it up.",
                  },
                },
              }),
            },
            404: problem("No operation by that id.", "errorUnknownOperation"),
          },
        },
      },

      "/api/requirements": {
        get: {
          tags: ["Requirements"],
          operationId: "getRequirements",
          summary: "The catalog, with the citations carrying each requirement",
          description:
            "Each requirement arrives with the coding units attached to it, which departments " +
            "those come from, and which categories they sit in. The department count is not " +
            "entered but counted from the material — that is what keeps the prioritisation " +
            "tied to what people said, and what makes it change when another interview arrives.",
          parameters: [LANG],
          responses: {
            200: {
              description: "The catalog.",
              ...json({
                type: "object",
                properties: {
                  requirements: { type: "array", items: ref("Requirement") },
                  moscow: {
                    type: "array",
                    description: "The four levels, in order.",
                    items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
                  },
                  operations: {
                    type: "array",
                    items: ref("Operation"),
                    description:
                      "The operations a requirement can be judged to block. The study's own " +
                      "vocabulary, and what `blockedOperations` may name.",
                  },
                  departments: {
                    type: "array",
                    items: { type: "string" },
                    description: "In the same order as the analysis, so a department keeps its colour.",
                  },
                  propositions: ref("Propositions"),
                },
              }),
            },
          },
        },
        post: {
          tags: ["Requirements"],
          operationId: "addRequirement",
          summary: "Add a requirement",
          description:
            "A requirement arrives with nothing but a title, which is the honest starting " +
            "point: what it is worth and what its absence blocks are judgments, and they are " +
            "made later, on the card, once passages have been attached to it.\n\n" +
            "Attaching a passage is not done here but on the coding unit — " +
            "`PATCH /api/interviews/{id}/codings/{coding}` with `requirements`. The catalog is " +
            "built out of the material rather than beside it.",
          parameters: [LANG],
          requestBody: {
            required: true,
            ...json(
              {
                type: "object",
                required: ["title"],
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                },
              },
              { title: "Eine Suche, die über alle Interviews geht" },
            ),
          },
          responses: { 201: { description: "Added.", ...json(ref("Requirement")) } },
        },
      },

      "/api/requirements/{id}": {
        patch: {
          tags: ["Requirements"],
          operationId: "updateRequirement",
          summary: "Change a requirement, including its judgment",
          description:
            "The MoSCoW level and the operations its absence blocks are the two judgments the " +
            "prioritisation field is drawn from. Until at least one of them has been made on at " +
            "least one requirement, that field and the level distribution are deliberately not " +
            "drawn: six requirements with no level came out as one grey bar labelled 6, which " +
            "reads as a finding.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, LANG],
          requestBody: {
            required: true,
            ...json({
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                moscow: { type: ["string", "null"], enum: [...MOSCOW.map((one) => one.id), null] },
                blockedOperations: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Ids of the study's own operations; anything else is refused. " +
                    "Read them from `GET /api/requirements`.",
                },
              },
            }),
          },
          responses: {
            200: { description: "Changed.", ...json(ref("Requirement")) },
            404: problem("No requirement by that id."),
          },
        },
        delete: {
          tags: ["Requirements"],
          operationId: "removeRequirement",
          summary: "Delete a requirement",
          description:
            "Also detaches it from every coding unit that cited it. The units themselves stay: " +
            "the passage was still said.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 204: { description: "Gone." } },
        },
      },

      "/api/requirements/{id}/merge": {
        post: {
          tags: ["Requirements"],
          operationId: "mergeRequirements",
          summary: "Merge one requirement into another",
          description:
            "When requirements emerge one at a time out of citations, two names for one thing " +
            "is the rule rather than the exception. Every citation moves to the target first, " +
            "then the source goes.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, LANG],
          requestBody: {
            required: true,
            ...json({ type: "object", required: ["target"], properties: { target: { type: "string" } } }),
          },
          responses: {
            200: {
              description: "Merged.",
              ...json({ type: "object", properties: { target: ref("Requirement"), moved: { type: "integer" } } }),
            },
            409: problem("The merge is not allowed."),
          },
        },
      },

      /* Role profiles -------------------------------------------------------- */
      "/api/roles": {
        get: {
          tags: ["Roles"],
          operationId: "getRoles",
          summary: "The role profiles, joined to the transcripts they cite",
          description:
            "A requirement is built in this tool; a role profile is not. It is written while " +
            "reading a department's citations — what its work is, what it files, what it " +
            "retrieves, what it hands over and in which shape it wants what it receives — and " +
            "it lives as prose in `roles.json`, beside the requirements.\n\n" +
            "What this route adds is the join the file cannot make. Every locator becomes the " +
            "speaker turn it names, with the department that spoke it and its text, and from " +
            "that follow the two counts the prose leaves unsaid: `own` and `others` say whose " +
            "voice a profile is written from — a profile made only of `own` is a self-portrait, " +
            "and two of the departments were never interviewed, so theirs is nothing but " +
            "`others` — and `pillars` says how much evidence each of the five pillars rests on.\n\n" +
            "`missing` counts locators pointing at a turn no transcript has. Those are kept and " +
            "marked rather than dropped: a citation that is not there is the finding.\n\n" +
            "Read-only. Writing a profile means weighing several passages against each other " +
            "and finding one sentence for them, which is reading work and belongs where the " +
            "study is written.",
          parameters: [LANG],
          responses: {
            200: {
              description: "The profiles, the pillars and what they are counted over.",
              ...json({
                type: "object",
                properties: {
                  pillars: {
                    type: "array",
                    items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
                    description: "The five pillars a profile stands on, in the order it is written in.",
                  },
                  roles: { type: "array", items: ref("RoleProfile") },
                  departments: {
                    type: "array",
                    items: { type: "string" },
                    description: "In the same order as the analysis, so a department keeps its colour.",
                  },
                  voices: {
                    type: "array",
                    description:
                      "Who speaks about whom: one row per profile, one value per department.",
                    items: ref("RoleTally"),
                  },
                  evidencePerPillar: {
                    type: "array",
                    description: "One row per pillar over all profiles, split the same way.",
                    items: ref("RoleTally"),
                  },
                },
              }),
            },
          },
        },
      },

      /* Analysis ------------------------------------------------------------ */
      "/api/analysis": {
        get: {
          tags: ["Analysis"],
          operationId: "getAnalysis",
          summary: "Everything counted: cross table, progress, saturation, co-occurrence",
          description:
            "One answer holding what the analysis view is built from.\n\n" +
            "- `rows` is the cross table: one row per category, one value per department.\n" +
            "- `progress` is how far each interview has been worked.\n" +
            "- `saturation` is how many categories turned up for the first time in each " +
            "interview — the drawn answer to \"how do you know you had enough interviews\".\n" +
            "- `cooccurrence` ranks the category pairs that keep turning up in the same breath, " +
            "by share rather than count: seven turns means one thing for a category used eight " +
            "times and another for one used ninety.\n" +
            "- `citations` holds every coding unit, keyed by category.\n" +
            "- `displaced` counts units that have lost their place. They are in no other total " +
            "here — a unit with no place counts on no surface.",
          parameters: [LANG],
          responses: { 200: { description: "The analysis.", ...json(ref("Analysis")) } },
        },
      },

      "/api/agreement": {
        get: {
          tags: ["Analysis"],
          operationId: "getAgreement",
          summary: "Intercoder reliability, per second coder",
          description:
            "Cohen's κ over turn × category units: for every speaker turn and every category, " +
            "did the two coders both assign it, one of them, or neither. That unit is what " +
            "makes the coefficient comparable between studies.\n\n" +
            "Its own route rather than part of the analysis, because it reads a second file per " +
            "interview folder and every view of the analysis would pay for that whether or not " +
            "a second coding exists.\n\n" +
            "`disagreements` is the working list for a consensus round: the turns the two read " +
            "differently, with what each of them said.",
          parameters: [LANG],
          responses: { 200: { description: "One comparison per coder found.", ...json(ref("Agreement")) } },
        },
      },

      /* Figures -------------------------------------------------------------- */
      "/api/figures": {
        get: {
          tags: ["Figures"],
          operationId: "listFigures",
          summary: "Which figures there are",
          description:
            "Six, named by the file they have always been saved under. Titles come in the " +
            "language asked for, so the list is usable as the index of a report rather than " +
            "only as a set of addresses.",
          parameters: [LANG],
          responses: {
            200: {
              description: "The figures, the themes and the languages on offer.",
              ...json(
                {
                  type: "object",
                  properties: {
                    figures: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string", enum: FIGURE_NAMES },
                          view: { type: "string", enum: ["analysis", "catalog"] },
                          file: { type: "string" },
                          url: { type: "string" },
                          title: { type: "string" },
                        },
                      },
                    },
                    themes: { type: "array", items: { type: "string", enum: THEME_NAMES } },
                    languages: { type: "array", items: { type: "string", enum: LANGUAGES } },
                  },
                },
                {
                  figures: [
                    {
                      name: "saturation",
                      view: "analysis",
                      file: "saturation.svg",
                      url: "/api/figures/saturation.svg",
                      title: "Wann kam nichts Neues mehr",
                    },
                  ],
                  themes: THEME_NAMES,
                  languages: LANGUAGES,
                },
              ),
            },
          },
        },
      },

      "/api/figures/{name}.svg": {
        get: {
          tags: ["Figures"],
          operationId: "getFigure",
          summary: "One figure as an SVG that stands on its own",
          description:
            "Colours resolved, fonts carried, key drawn in, a ground laid down, and nothing " +
            "fetched from anywhere — a file that can go into a thesis, a slide or a static site " +
            "without the tool being there.\n\n" +
            "It is drawn by the same module the interface draws with, so this is not a second " +
            "rendering that happens to agree: it is the picture on the screen. The one " +
            "difference is that a browser can measure real glyphs and a server cannot, so the " +
            "room reserved under the heatmap's angled headings is estimated here — deliberately " +
            "wide, because a few unused pixels are invisible and a few missing cut a word off.\n\n" +
            "A name that exists but has nothing to draw yet is a **409**, not a 404: the address " +
            "is right, the study has not got there, and the answer names the condition.",
          parameters: [
            {
              name: "name",
              in: "path",
              required: true,
              description: "Without the `.svg`, which stays in the path.",
              schema: { type: "string", enum: FIGURE_NAMES },
              example: "saturation",
            },
            {
              name: "theme",
              in: "query",
              description:
                "Which palette the file carries. Anything else falls back to `light` rather " +
                "than being refused — a wrong parameter is worth the sane default.",
              schema: { type: "string", enum: THEME_NAMES, default: "light" },
            },
            LANG,
          ],
          responses: {
            200: {
              description: "The figure.",
              content: { "image/svg+xml": { schema: { type: "string", format: "binary" } } },
            },
            404: problem("No figure by that name. The answer lists the ones there are.", "errorUnknownFigure"),
            409: problem(
              "Nothing to draw yet. `code` says which condition is missing — `figureNeedsCodings`, " +
                "`figureNeedsSections`, `figureNeedsInterviews`, `figureNeedsRequirements` or " +
                "`figureNeedsCitations`.",
              "figureNeedsInterviews",
            ),
          },
        },
      },

      /* Exports -------------------------------------------------------------- */
      "/api/export/coding-guide.md": {
        get: {
          tags: ["Exports"],
          operationId: "exportCodingGuide",
          summary: "The coding guide",
          description:
            "The instrument as Mayring asks for it to be reported: every category with its " +
            "definition, its coding rules and an anchor example out of the material. This is " +
            "the appendix a method chapter points at.",
          parameters: [LANG],
          responses: { 200: markdown("The coding guide as Markdown.") },
        },
      },
      "/api/export/citations.md": {
        get: {
          tags: ["Exports"],
          operationId: "exportCitations",
          summary: "The citations, optionally sliced",
          description:
            "Every coded passage with where it comes from. The parameters cut the same slices " +
            "the citation list on screen offers, so what a reader is looking at is what they " +
            "get out.",
          parameters: [
            { name: "department", in: "query", schema: { type: "string" }, description: "Only this department." },
            { name: "section", in: "query", schema: { type: "string" }, description: "Only this guide section." },
            { name: "word", in: "query", schema: { type: "string" }, description: "Only passages containing this word." },
            { name: "anchor", in: "query", schema: { type: "string", enum: ["1"] }, description: "Only anchor examples." },
            { name: "memo", in: "query", schema: { type: "string", enum: ["1"] }, description: "Only passages carrying a memo." },
            { name: "open", in: "query", schema: { type: "string", enum: ["1"] }, description: "Only passages not yet carrying a requirement." },
            { name: "unreviewed", in: "query", schema: { type: "string", enum: ["1"] }, description: "Only what is still a suggestion." },
            LANG,
          ],
          responses: { 200: markdown("The citations as Markdown.") },
        },
      },
      "/api/export/analysis.md": {
        get: {
          tags: ["Exports"],
          operationId: "exportAnalysis",
          summary: "The analysis as prose and tables",
          description:
            "The figures of the study written out — units, categories, departments, progress, " +
            "saturation — in the shape a results chapter uses them.",
          parameters: [LANG],
          responses: { 200: markdown("The analysis as Markdown.") },
        },
      },
      "/api/export/matrix.md": {
        get: {
          tags: ["Exports"],
          operationId: "exportMatrix",
          summary: "The cross table on its own",
          description: "Category against department, as the citable number behind the bar chart.",
          parameters: [LANG],
          responses: { 200: markdown("The cross table as Markdown.") },
        },
      },
      "/api/export/agreement.md": {
        get: {
          tags: ["Exports"],
          operationId: "exportAgreement",
          summary: "The reliability report",
          description:
            "The unit, the coefficient, the table it was computed from, and the passages the " +
            "two coders read differently. A reliability figure that only exists on a screen " +
            "does not get reported, and an unreported one might as well not have been computed.",
          parameters: [LANG],
          responses: { 200: markdown("The comparison as Markdown.") },
        },
      },
      "/api/export/sample.md": {
        get: {
          tags: ["Exports"],
          operationId: "exportSample",
          summary: "The sample description",
          description: "Who was interviewed, from where, how long each conversation ran.",
          parameters: [LANG],
          responses: { 200: markdown("The sample as Markdown.") },
        },
      },
      "/api/export/notes.md": {
        get: {
          tags: ["Exports"],
          operationId: "exportNotes",
          summary: "Every memo, gathered",
          description:
            "The notes made while coding — on units, on categories, on whole interviews. The " +
            "research diary that otherwise stays scattered across the material.",
          parameters: [LANG],
          responses: { 200: markdown("The memos as Markdown.") },
        },
      },
      "/api/export/requirements-catalog.md": {
        get: {
          tags: ["Exports"],
          operationId: "exportCatalog",
          summary: "The requirements catalog",
          description:
            "Every requirement with its level, the operations it blocks, and the passages that " +
            "carry it — so a reader can follow each one back to something somebody said.",
          parameters: [LANG],
          responses: { 200: markdown("The catalog as Markdown.") },
        },
      },
      "/api/export/role-profiles.md": {
        get: {
          tags: ["Exports"],
          operationId: "exportRoleProfiles",
          summary: "The role profiles as the chapter writes them",
          description:
            "The way back: the section in the study's document was the source of `roles.json`, " +
            "and once the file is what gets maintained the section has to come out of it again " +
            "— verbatim, citation markers and all, which is why the paraphrase is stored the " +
            "way it was written.",
          parameters: [LANG],
          responses: { 200: markdown("The profiles as Markdown.") },
        },
      },
      "/api/export/coding-table/{id}.md": {
        get: {
          tags: ["Exports"],
          operationId: "exportCodingTable",
          summary: "One interview as a coding table",
          description:
            "Turn, passage, category, memo — the per-interview table that goes in the appendix.",
          parameters: [INTERVIEW_ID, LANG],
          responses: {
            200: markdown("The coding table as Markdown."),
            404: problem("No interview by that name.", "errorUnknownInterview"),
          },
        },
      },
      "/api/export/project.qdpx": {
        get: {
          tags: ["Exports"],
          operationId: "exportProject",
          summary: "The whole study as a REFI-QDA project",
          description:
            "Everything else here leaves as a document for a reader; this leaves as a project " +
            "for a program — the format MAXQDA, ATLAS.ti, NVivo and QualCoder read.\n\n" +
            "It is the check on the promise that the work is not locked in this tool, and a " +
            "promise nobody can test is not one.",
          parameters: [LANG],
          responses: {
            200: {
              description: "A `.qdpx` archive.",
              content: { "application/zip": { schema: { type: "string", format: "binary" } } },
            },
          },
        },
      },

      "/api/openapi.json": {
        get: {
          tags: ["Study"],
          operationId: "getOpenapi",
          summary: "This document",
          description:
            "Point Swagger UI, Redoc, Bruno, Insomnia or a code generator at it. `/api/docs` " +
            "renders it in the browser without any of them.\n\n" +
            "Parts of it are bound to the code rather than written out — the figure names, the " +
            "themes, the languages, the MoSCoW levels, the version — so they cannot fall behind " +
            "what the server does.",
          responses: {
            200: {
              description: "The OpenAPI description of this interface.",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },

      "/api/docs": {
        get: {
          tags: ["Study"],
          operationId: "getDocs",
          summary: "This document, read in the browser",
          description:
            "The reference page: every route grouped by what it is for, with its parameters, " +
            "its shapes and a `curl` line to paste.\n\n" +
            "It renders `/api/openapi.json` rather than restating it, and it is written in this " +
            "tool's own hand rather than vendored from elsewhere — a megabyte and a half of " +
            "somebody else's JavaScript would undo both the no-dependency rule and the promise " +
            "that everything here works with the network unplugged.",
          responses: {
            200: {
              description: "The reference page.",
              content: { "text/html": { schema: { type: "string" } } },
            },
          },
        },
      },
    },

    components: {
      schemas: {
        Error: {
          type: "object",
          description:
            "Every failure that has been thought about carries a stable `code` beside a " +
            "sentence in the language of the request. Match on the code; show the sentence.",
          required: ["error"],
          properties: {
            error: { type: "string", description: "For a person to read." },
            code: { type: "string", description: "For a program to match on. Absent on unforeseen errors." },
            conflict: { type: "object", description: "On an overlap, the unit that was in the way." },
          },
        },

        Propositions: {
          type: "object",
          description:
            "The theoretical propositions categories are anchored in, keyed by id. Colour in " +
            "this tool encodes the proposition and nothing else — never the rank of a number. " +
            "`none` is always among them: it is what a category argues when it argues none of " +
            "the study's own claims, and what everything falls back to when one is dissolved.",
          additionalProperties: {
            type: "object",
            properties: { name: { type: "string" }, color: { type: "string" } },
          },
        },

        Proposition: {
          type: "object",
          description: "One proposition, as it comes back from a write.",
          properties: {
            id: { type: "string", description: "Derived from the wording; fixed afterwards." },
            name: { type: "string" },
            color: { type: "string", example: "#6C8EBF" },
          },
        },

        Operation: {
          type: "object",
          description:
            "One operation whose blocking a requirement can be judged by. The study's own " +
            "vocabulary: seeded with three — filing, retrieval, transfer — and the author's " +
            "from then on.",
          properties: {
            id: { type: "string", description: "Derived from the name; fixed afterwards." },
            name: { type: "string" },
          },
        },

        Category: {
          type: "object",
          properties: {
            id: { type: "string", description: "Derived from the name; `ind.` prefix if inductive." },
            name: { type: "string" },
            abbreviation: { type: "string" },
            definition: { type: "string" },
            proposition: { type: "string", description: "Which proposition it hangs on; follows the parent." },
            origin: {
              type: "string",
              enum: ["deductive", "inductive"],
              description:
                "Deductive means fixed before the material was worked. The tool only records it " +
                "when that is true.",
            },
            parent: { type: ["string", "null"], description: "Two levels only." },
            codingRules: {
              type: "array",
              items: { type: "string" },
              description: "Where this category ends and the neighbouring one begins.",
            },
            created: { type: "string", format: "date-time" },
          },
        },

        CodingInput: {
          type: "object",
          required: ["turn", "start", "end", "category", "text"],
          properties: {
            turn: { type: "integer", description: "The speaker turn's number, not its index." },
            start: { type: "integer", description: "Character offset inside that turn's text." },
            end: { type: "integer", description: "Exclusive. Must be greater than `start`." },
            category: { type: "string" },
            text: {
              type: "string",
              description:
                "The passage itself. Stored beside the offsets on purpose: it is what lets a " +
                "unit be found again after the transcript has been corrected.",
            },
            memo: { type: "string" },
            anchor: { type: "boolean", description: "Mark as the anchor example for its category." },
            reviewed: { type: "boolean", description: "Defaults to false: created is not confirmed." },
            requirements: { type: "array", items: { type: "string" } },
          },
          example: {
            turn: 12,
            start: 0,
            end: 84,
            category: "routine",
            text: "Die Unterlagen liegen im Laufwerk, aber niemand pflegt sie.",
            reviewed: true,
          },
        },

        Coding: {
          allOf: [
            ref("CodingInput"),
            {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                created: { type: "string", format: "date-time" },
                state: {
                  type: ["string", "null"],
                  enum: ["moved", "lost", null],
                  description:
                    "Set by the anchor check on read. `moved`: the passage was found again " +
                    "elsewhere and the unit followed it. `lost`: it could not be found, and the " +
                    "unit counts on no surface until somebody puts it back.",
                },
                reason: {
                  type: "string",
                  description: "Why it moved or was lost, worded in the language of the request.",
                },
              },
            },
          ],
        },

        InterviewSummary: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            department: { type: "string" },
            meta: { type: "object", additionalProperties: { type: "string" } },
            turns: { type: "integer" },
            sections: { type: "integer" },
            codings: { type: "integer" },
            unreviewed: {
              type: "integer",
              description: "Units still only suggested. Lost ones are not counted here.",
            },
          },
        },

        Interview: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            department: { type: "string" },
            meta: { type: "object", additionalProperties: { type: "string" } },
            characters: { type: "integer" },
            sections: {
              type: "array",
              description: "The guide sections: what the conversation was steered through.",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer" },
                  name: { type: "string" },
                  short: { type: "string" },
                  number: { type: ["string", "null"] },
                },
              },
            },
            turns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  number: { type: "integer" },
                  speaker: { type: "string" },
                  interviewer: { type: "boolean", description: "Interviewer turns cannot be coded." },
                  time: { type: ["string", "null"] },
                  section: { type: ["integer", "null"] },
                  text: { type: "string" },
                },
              },
            },
            codings: { type: "array", items: ref("Coding") },
            problems: {
              type: "array",
              description: "What could not be read out of the file, worded for a person.",
              items: { type: "object" },
            },
            memo: { type: "string" },
            moved: { type: "integer" },
            lost: { type: "integer" },
          },
        },

        Citation: {
          type: "object",
          description: "A coding unit seen from the analysis: the passage with where it came from.",
          properties: {
            id: { type: "string", format: "uuid" },
            interview: { type: "string" },
            interviewTitle: { type: "string" },
            department: { type: "string" },
            turn: { type: "integer" },
            time: { type: ["string", "null"] },
            section: { type: ["integer", "null"] },
            sectionName: { type: ["string", "null"] },
            text: { type: "string" },
            memo: { type: "string" },
            anchor: { type: "boolean" },
            reviewed: { type: "boolean" },
            requirements: { type: "array", items: { type: "string" } },
          },
        },

        Requirement: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            title: { type: "string" },
            description: { type: "string" },
            moscow: { type: ["string", "null"], enum: [...MOSCOW.map((one) => one.id), null] },
            blockedOperations: {
              type: "array",
              items: { type: "string" },
              description:
                "Ids of the operations its absence blocks — the second axis of the field. " +
                "Which ones there are is the study's own vocabulary and arrives beside the " +
                "catalog rather than being fixed here.",
            },
            created: { type: "string", format: "date-time" },
            citations: {
              type: "array",
              items: ref("Citation"),
              description: "The passages carrying it. Counted, not entered.",
            },
            departments: {
              type: "array",
              items: { type: "string" },
              description: "Derived from the citations: who named it.",
            },
            categories: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  proposition: { type: "string" },
                },
              },
            },
          },
        },

        RoleProfile: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string", description: "The department the profile is about." },
            interview: {
              type: ["string", "null"],
              description:
                "The interview held with this department, or null where there was none — which " +
                "is what makes every piece of its evidence somebody else's statement.",
            },
            entries: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  pillar: { type: "string" },
                  text: {
                    type: "string",
                    description:
                      "The paraphrase as written, citation markers included, so the chapter " +
                      "can be written back from this file without loss.",
                  },
                  reading: { type: "string", description: "The same sentence without the markers." },
                  citations: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        interview: { type: "string" },
                        department: { type: "string" },
                        turn: { type: "integer" },
                        time: { type: ["string", "null"] },
                        text: { type: "string" },
                        self: {
                          type: "boolean",
                          description: "Whether the department is speaking about itself.",
                        },
                        missing: {
                          type: "boolean",
                          description: "A locator no transcript has a turn for.",
                        },
                      },
                    },
                  },
                },
              },
            },
            open: {
              type: "array",
              items: { type: "string" },
              description: "Pillars the material says nothing about. Stated, not left away.",
            },
            evidence: { type: "integer" },
            own: { type: "integer" },
            others: { type: "integer" },
            missing: { type: "integer" },
            departments: { type: "array", items: { type: "string" } },
            pillars: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  entries: { type: "integer" },
                  evidence: { type: "integer" },
                  open: { type: "boolean" },
                },
              },
            },
          },
        },

        RoleTally: {
          type: "object",
          properties: {
            name: { type: "string" },
            values: {
              type: "array",
              items: { type: "integer" },
              description: "One count per department, in `departments` order.",
            },
            sum: { type: "integer" },
            open: {
              type: "integer",
              description: "Pillar rows only: how many profiles say nothing under it.",
            },
          },
        },

        Analysis: {
          type: "object",
          properties: {
            total: { type: "integer", description: "Coding units that still have a place." },
            displaced: {
              type: "integer",
              description: "Units that have lost theirs. In none of the other totals here.",
            },
            departments: { type: "array", items: { type: "string" } },
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  short: { type: "string" },
                  number: { type: ["string", "null"] },
                },
              },
            },
            rows: {
              type: "array",
              description: "The cross table: one row per category, `values` in department order.",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  name: { type: "string" },
                  parent: { type: ["string", "null"] },
                  origin: { type: "string", enum: ["deductive", "inductive"] },
                  proposition: { type: "string" },
                  values: { type: "array", items: { type: "integer" } },
                  sum: { type: "integer" },
                  anchors: { type: "integer" },
                  departmentsNaming: { type: "integer" },
                },
              },
            },
            progress: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  interview: { type: "string" },
                  title: { type: "string" },
                  department: { type: "string" },
                  memo: { type: "string" },
                  turns: { type: "integer" },
                  turnsCoded: { type: "integer" },
                  codings: { type: "integer" },
                  characterShare: { type: "number" },
                },
              },
            },
            saturation: {
              type: "array",
              description:
                "In interview order: how many categories turned up for the first time here " +
                "(`fresh`, with `names`) and how many were in play by then (`total`).",
              items: {
                type: "object",
                properties: {
                  interview: { type: "string" },
                  title: { type: "string" },
                  department: { type: "string" },
                  fresh: { type: "integer" },
                  names: { type: "array", items: { type: "string" } },
                  total: { type: "integer" },
                },
              },
            },
            cooccurrence: {
              type: "object",
              description:
                "Category pairs that keep turning up in the same speaker turn, ranked by share.",
              properties: {
                pairs: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      aName: { type: "string" },
                      bName: { type: "string" },
                      together: { type: "integer" },
                      share: { type: "number" },
                      aTurns: { type: "integer" },
                      bTurns: { type: "integer" },
                    },
                  },
                },
                turns: { type: "object", additionalProperties: { type: "integer" } },
              },
            },
            citations: {
              type: "object",
              description: "Every coding unit, keyed by category id.",
              additionalProperties: { type: "array", items: ref("Citation") },
            },
            categories: { type: "array", items: ref("Category") },
            propositions: ref("Propositions"),
          },
        },

        Agreement: {
          type: "object",
          properties: {
            coders: {
              type: "array",
              items: { type: "string" },
              description: "Every second coder found beside the first coding.",
            },
            comparisons: { type: "array", items: ref("Comparison") },
            problems: {
              type: "array",
              description: "Second-coding files that could not be read, named rather than skipped.",
              items: { type: "object", properties: { text: { type: "string" } } },
            },
          },
        },

        Comparison: {
          type: "object",
          properties: {
            coder: { type: "string" },
            covered: {
              type: "array",
              items: { type: "string" },
              description: "Interviews both people coded — the only ones κ is computed over.",
            },
            skipped: { type: "array", items: { type: "string" } },
            units: { type: "integer", description: "Turn × category judgements compared." },
            categories: { type: "integer" },
            cells: {
              type: "object",
              description: "The four-field table κ comes from.",
              properties: {
                both: { type: "integer" },
                onlyFirst: { type: "integer" },
                onlySecond: { type: "integer" },
                neither: { type: "integer" },
              },
            },
            agreement: { type: ["number", "null"], description: "Raw agreement, before chance." },
            kappa: { type: ["number", "null"] },
            band: {
              type: "string",
              description: "The conventional reading of that value — not a verdict on the study.",
            },
            byCategory: {
              type: "array",
              description: "Where the two parted company, worst first.",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  both: { type: "integer" },
                  onlyFirst: { type: "integer" },
                  onlySecond: { type: "integer" },
                  neither: { type: "integer" },
                  disagreed: { type: "integer" },
                  kappa: { type: ["number", "null"] },
                  band: { type: "string" },
                },
              },
            },
            apartCells: { type: "integer" },
            disagreements: {
              type: "array",
              description: "The working list for a consensus round: the turns, and what each said.",
              items: {
                type: "object",
                properties: {
                  interview: { type: "string" },
                  interviewTitle: { type: "string" },
                  turn: { type: "integer" },
                  text: { type: "string" },
                  first: { type: "array", items: { type: "string" } },
                  second: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
  };
}
