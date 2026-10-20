/**
 * The description of the second round's routes: rounds and guides, the
 * interview log, and the comparisons across rounds.
 *
 * Its own file for the same reason the routes have one (`evaluation-routes.js`):
 * one feature, read together. `openapi.js` merges these paths and schemas into
 * the one document and hands over its helpers, so the shapes of errors, JSON
 * bodies and the language parameter are the same everywhere.
 */

import { READOUT_STATES, SESSION_OPS } from "./session.js";
import { STANCES } from "./store.js";
import { BASES, KINDS, VERDICTS } from "./panel.js";

export const EVALUATION_TAGS = [
  {
    name: "Rounds",
    description:
      "A study asked twice: which rounds there are, which interview belongs to which, and " +
      "the interview guide of each.",
  },
  {
    name: "Interview log",
    description:
      "What happened during one conversation, kept as it happened — before a transcript exists.",
  },
  {
    name: "Evaluation",
    description:
      "The panel across rounds, the pre-registered criteria counted in persons, and the report " +
      "by guide question.",
  },
];

export function evaluationPaths({ ref, json, problem, LANG, INTERVIEW_ID }) {
  const ROUND_ID = {
    name: "id",
    in: "path",
    required: true,
    description: "The round's id, derived from its name (or given) when it was made.",
    schema: { type: "string" },
    example: "evaluation",
  };
  const BLOCK_ID = {
    name: "block",
    in: "path",
    required: true,
    description: "The block's id, derived from its name when it was made; fixed afterwards.",
    schema: { type: "string" },
    example: "1-ablage",
  };
  const SESSION_ID = {
    ...INTERVIEW_ID,
    description:
      "The interview folder the log lives in. It need not hold a transcript yet — a folder " +
      "with only `session.json` is a planned or running interview.",
    example: "evaluation-vertrieb",
  };

  return {
    /* Rounds ------------------------------------------------------------- */
    "/api/rounds": {
      get: {
        tags: ["Rounds"],
        operationId: "listRounds",
        summary: "The rounds, and which interview belongs to which",
        description:
          "Rounds in the order they were made, which is the order they happened in. " +
          "`interviews` are folders with a transcript; `planned` are folders that so far " +
          "hold only an interview log.\n\n" +
          "An interview nobody assigned belongs to the first round. Without `study.json` " +
          "there are no rounds and the list is empty — the feature is simply not in use.",
        parameters: [LANG],
        responses: {
          200: {
            description: "The rounds.",
            ...json({ type: "object", properties: { rounds: { type: "array", items: ref("Round") } } }),
          },
        },
      },
      post: {
        tags: ["Rounds"],
        operationId: "addRound",
        summary: "Add a round",
        description:
          "Appended after the existing ones. The id is `id` if given, otherwise derived from " +
          "the name; it never changes afterwards, because assignments, criteria and interview " +
          "logs point at it. The first round made is where every existing interview falls.",
        parameters: [LANG],
        requestBody: {
          required: true,
          ...json(
            {
              type: "object",
              required: ["name"],
              properties: { name: { type: "string" }, id: { type: "string" } },
            },
            { name: "Evaluation", id: "evaluation" },
          ),
        },
        responses: {
          201: {
            description: "Added.",
            ...json({ type: "object", properties: { id: { type: "string" }, name: { type: "string" } } }),
          },
          400: problem("No name.", "errorRoundName"),
          409: problem("A round with that id exists.", "errorRoundExists"),
        },
      },
    },

    "/api/rounds/{id}": {
      patch: {
        tags: ["Rounds"],
        operationId: "updateRound",
        summary: "Rename a round",
        description: "The name is the author's word for it; the id stays, since everything points at it.",
        parameters: [ROUND_ID, LANG],
        requestBody: { required: true, ...json({ type: "object", properties: { name: { type: "string" } } }) },
        responses: {
          200: {
            description: "Renamed.",
            ...json({ type: "object", properties: { id: { type: "string" }, name: { type: "string" } } }),
          },
          400: problem("Empty name.", "errorRoundName"),
          404: problem("No such round.", "errorUnknownRound"),
        },
      },
      delete: {
        tags: ["Rounds"],
        operationId: "removeRound",
        summary: "Remove a round nobody belongs to",
        description:
          "Refused while any interview or interview log resolves to it — explicitly, or by " +
          "falling to the first round. Otherwise those interviews would change rounds without " +
          "anybody having said so, and with them the numbers they are counted in.",
        parameters: [ROUND_ID, LANG],
        responses: {
          204: { description: "Removed." },
          404: problem("No such round.", "errorUnknownRound"),
          409: problem("Interviews still belong to it.", "errorRoundInUse"),
        },
      },
    },

    "/api/rounds/{id}/untestable": {
      patch: {
        tags: ["Rounds"],
        operationId: "markUntestable",
        summary: "Mark a person as not checkable for a proposition, or take it back",
        description:
          "A person can be outside what a proposition is about — somebody who never used the " +
          "system in the usage phase cannot say whether documenting through it was a burden. " +
          "Counting them as not supporting would count an absence as a finding. The mark is " +
          "per round, proposition and person (department), with a reason the researcher " +
          "writes; a criterion with `base: \"testable\"` leaves the person out of its base, and " +
          "the evaluation lists them with the reason.\n\n" +
          "An empty or missing `reason` takes the mark away — also for a department that is no " +
          "longer a person of the round. Stored in `study.json` under the round.",
        parameters: [ROUND_ID, LANG],
        requestBody: {
          required: true,
          ...json(
            {
              type: "object",
              required: ["proposition", "department"],
              properties: {
                proposition: { type: "string", description: "A proposition with a claim of its own." },
                department: { type: "string", description: "A department of the round, as its transcript or log names it." },
                reason: { type: ["string", "null"], description: "Why; empty takes the mark away." },
              },
            },
            { proposition: "konversation", department: "Sales", reason: "Hat in der Nutzungsphase nichts abgelegt." },
          ),
        },
        responses: {
          200: {
            description: "The round's marks after the change.",
            ...json({
              type: "object",
              properties: {
                round: { type: "string" },
                untestable: { type: "object", description: "proposition → department → reason" },
              },
            }),
          },
          400: problem("No proposition or department, or a heading without a claim of its own.", "errorUntestableShape"),
          404: problem("No such round, proposition, or department in the round.", "errorUnknownDepartment"),
        },
      },
    },

    "/api/rounds/{id}/assign": {
      post: {
        tags: ["Rounds"],
        operationId: "assignToRound",
        summary: "Put interviews into a round",
        description:
          "Each folder — with a transcript or with only an interview log — is written into " +
          "`study.json` as belonging to this round, also when it is the first. Renaming an " +
          "interview carries its round along; removing it takes the line away.",
        parameters: [ROUND_ID, LANG],
        requestBody: {
          required: true,
          ...json(
            {
              type: "object",
              required: ["interviews"],
              properties: { interviews: { type: "array", items: { type: "string" } } },
            },
            { interviews: ["evaluation-vertrieb"] },
          ),
        },
        responses: {
          200: {
            description: "Assigned.",
            ...json({
              type: "object",
              properties: { round: { type: "string" }, interviews: { type: "array", items: { type: "string" } } },
            }),
          },
          400: problem("Not a list of folders.", "errorInterviewList"),
          404: problem("No such round, or no such folder.", "errorUnknownRound"),
        },
      },
    },

    /* The guide ---------------------------------------------------------- */
    "/api/rounds/{id}/guide": {
      get: {
        tags: ["Rounds"],
        operationId: "getGuide",
        summary: "The interview guide of a round",
        description:
          "Helfferich's form, one block per narrative prompt: the prompt, a checklist of keywords " +
          "asked only if they did not come up, mandatory questions asked of everybody (possibly " +
          "under a condition), and where a block reads something out, a list per department. " +
          "Empty until one is written.",
        parameters: [ROUND_ID, LANG],
        responses: {
          200: { description: "The guide.", ...json(ref("Guide")) },
          404: problem("No such round.", "errorUnknownRound"),
        },
      },
      put: {
        tags: ["Rounds"],
        operationId: "setGuide",
        summary: "Write the whole guide at once",
        description:
          "For bringing a guide in from a file or writing it back after working on it " +
          "elsewhere. Ids that come along are kept and must be unique across the guide; " +
          "missing ones are made.\n\n" +
          "What the material already refers to cannot be dropped this way: an item ticked in " +
          "an interview log or named by a coding unit (`errorGuideItemInUse`), or a block " +
          "some log has started (`errorBlockInUse`). Rewording them is fine.",
        parameters: [ROUND_ID, LANG],
        requestBody: {
          required: true,
          ...json(ref("Guide"), {
            blocks: [
              {
                name: "1 · Ablage (Wissen festhalten)",
                prompt: "Erzählen Sie, wie Sie zuletzt etwas festgehalten haben.",
                checklist: [{ text: "Bestätigungsschritt", tag: "Erwarteter Aufwand" }],
                mandatory: [{ text: "Wie lief die Ablage über das neue Werkzeug?", condition: "falls genutzt" }],
              },
            ],
          }),
        },
        responses: {
          200: { description: "Written, with every id filled in.", ...json(ref("Guide")) },
          400: problem("Not a guide, a block without a name, an item without text.", "errorGuideShape"),
          404: problem("No such round.", "errorUnknownRound"),
          409: problem("Something the material refers to would be dropped.", "errorGuideItemInUse"),
        },
      },
    },

    "/api/rounds/{id}/guide/blocks": {
      post: {
        tags: ["Rounds"],
        operationId: "addGuideBlock",
        summary: "Add a block to the guide",
        description:
          "Appended, or put at `position` (0-based). Its id is derived from the name and stays " +
          "when the block is renamed. Name blocks the way the transcripts of an earlier round " +
          "name their sections when the topic is the same — blocks are matched across rounds " +
          "by name.",
        parameters: [ROUND_ID, LANG],
        requestBody: {
          required: true,
          ...json({ allOf: [ref("GuideBlock"), { type: "object", properties: { position: { type: "integer" } } }] }),
        },
        responses: {
          201: { description: "Added.", ...json(ref("GuideBlock")) },
          400: problem("No name.", "errorBlockName"),
          404: problem("No such round.", "errorUnknownRound"),
        },
      },
    },

    "/api/rounds/{id}/guide/blocks/{block}": {
      patch: {
        tags: ["Rounds"],
        operationId: "updateGuideBlock",
        summary: "Change one block",
        description:
          "Any of `name`, `prompt`, `checklist`, `mandatory`, `readout`, `position`. A list is " +
          "replaced whole: an item sent with its id is the same item reworded, one without an " +
          "id is new, one left out is dropped — unless the material refers to it. " +
          "`readout: null` removes the read-out list.",
        parameters: [ROUND_ID, BLOCK_ID, LANG],
        requestBody: {
          required: true,
          ...json({ allOf: [ref("GuideBlock"), { type: "object", properties: { position: { type: "integer" } } }] }),
        },
        responses: {
          200: { description: "Changed.", ...json(ref("GuideBlock")) },
          400: problem("Empty name or an item without text.", "errorBlockName"),
          404: problem("No such round or block.", "errorUnknownBlock"),
          409: problem("A dropped item is ticked or cited.", "errorGuideItemInUse"),
        },
      },
      delete: {
        tags: ["Rounds"],
        operationId: "removeGuideBlock",
        summary: "Remove a block",
        description:
          "Refused once an interview log has started it, or while any of its items is ticked or " +
          "named by a coding unit: the import places sections by block, and a block that is gone " +
          "has no name to place.",
        parameters: [ROUND_ID, BLOCK_ID, LANG],
        responses: {
          204: { description: "Removed." },
          404: problem("No such round or block.", "errorUnknownBlock"),
          409: problem("It is in use.", "errorBlockInUse"),
        },
      },
    },

    /* Interview logs ----------------------------------------------------- */
    "/api/sessions": {
      get: {
        tags: ["Interview log"],
        operationId: "listSessions",
        summary: "Every interview log, with or without a transcript",
        description:
          "One line per folder holding a `session.json`: its round, department, when the " +
          "recording started, how many blocks were started and items ticked. `transcript` says " +
          "whether the recording has been brought in yet.",
        parameters: [LANG],
        responses: {
          200: {
            description: "The logs.",
            ...json({
              type: "object",
              properties: {
                sessions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      round: { type: ["string", "null"] },
                      department: { type: "string" },
                      transcript: { type: "boolean" },
                      t0: { type: ["string", "null"], format: "date-time" },
                      current: { type: ["string", "null"], description: "The block started last." },
                      blocks: { type: "integer" },
                      ticks: { type: "integer" },
                      notes: { type: "integer" },
                    },
                  },
                },
              },
            }),
          },
        },
      },
      post: {
        tags: ["Interview log"],
        operationId: "openSession",
        summary: "Open a log for an interview about to happen",
        description:
          "Makes the folder the transcript will later be written into, puts `session.json` in " +
          "it and assigns the folder to `round`. The round is required: which guide a " +
          "conversation follows is not something to default. `folder` defaults to " +
          "`<round>-<department>`, slugged.\n\n" +
          "Nothing else in the tool sees the folder until it holds a `final.md`.",
        parameters: [LANG],
        requestBody: {
          required: true,
          ...json(
            {
              type: "object",
              required: ["department", "round"],
              properties: {
                department: { type: "string" },
                round: { type: "string" },
                folder: { type: "string" },
              },
            },
            { department: "Vertrieb", round: "evaluation" },
          ),
        },
        responses: {
          201: { description: "Opened.", ...json(ref("Session")) },
          400: problem("No department or no round.", "errorDepartmentRequired"),
          404: problem("No such round.", "errorUnknownRound"),
          409: problem("That folder has a log already.", "errorSessionExists"),
        },
      },
    },

    "/api/sessions/{id}": {
      get: {
        tags: ["Interview log"],
        operationId: "getSession",
        summary: "One interview log, with its guide",
        description:
          "The log as stored, plus what a screen needs beside it: the round's guide blocks, the " +
          "block started last, and this department's read-out entries per block. The department " +
          "is the transcript's once there is one, the log's until then.",
        parameters: [SESSION_ID, LANG],
        responses: {
          200: { description: "The log.", ...json(ref("Session")) },
          404: problem("No log in that folder.", "errorUnknownSession"),
        },
      },
      patch: {
        tags: ["Interview log"],
        operationId: "changeSession",
        summary: "One step of the log",
        description:
          "One operation per request, named by `op`; the answer is the whole log afterwards.\n\n" +
          "- `start` — the recording starts now (or at `t0`). Setting it again re-bases every " +
          "time so each event keeps its wall-clock moment.\n" +
          "- `block` — `block` starts now (or at `at`). `unblock` takes the latest start of " +
          "`block` back.\n" +
          "- `tick` / `untick` — guide item `item` was addressed now (or at `at`). Ticking twice " +
          "keeps the first time.\n" +
          "- `note` — `text`, filed under `block` (default: the block started last). " +
          "`edit-note` changes `text`, `block` or `at` of `note`; `delete-note` removes it.\n" +
          "- `readout` — entry `item` of the read-out list in `block` is `still` searched by " +
          "hand, `no-longer`, or `null` (not marked).\n" +
          "- `department` — correct the department before the transcript exists.\n\n" +
          "`at` is seconds after `t0`, the clock the recording runs on. Without a `t0` it is " +
          "null, not invented.",
        parameters: [SESSION_ID, LANG],
        requestBody: {
          required: true,
          ...json(ref("SessionOp"), { op: "block", block: "1-ablage" }),
        },
        responses: {
          200: { description: "Changed.", ...json(ref("Session")) },
          400: problem("Unknown op, empty note, a time that is not one.", "errorSessionOp"),
          404: problem("No log, or no such block, item or note.", "errorUnknownSession"),
          409: problem("The block has no read-out list for this department.", "errorNoReadout"),
        },
      },
      delete: {
        tags: ["Interview log"],
        operationId: "removeSession",
        summary: "Remove an interview log",
        description:
          "Deletes `session.json`. A folder that then holds nothing goes too, with its round " +
          "assignment; a transcript beside the log is never touched.",
        parameters: [SESSION_ID, LANG],
        responses: {
          204: { description: "Removed." },
          404: problem("No log in that folder.", "errorUnknownSession"),
        },
      },
    },

    /* Comparisons -------------------------------------------------------- */
    "/api/evaluation/panel": {
      get: {
        tags: ["Evaluation"],
        operationId: "getPanel",
        summary: "Before and after, per category and department",
        description:
          "The same persons in two rounds, text beside text: for each category and department " +
          "the units of `from` and of `to`, with their counts. The panel is the departments " +
          "present in **both** rounds; one that took part in only one is not listed at all, so " +
          "nothing here says who is missing.\n\n" +
          "`readout` counts, per department, the entries read out from the guide of `to`: how " +
          "many were listed, how many are `still` searched by hand, `noLonger`, and `open` (not " +
          "marked) — open is never counted as either.",
        parameters: [
          { name: "from", in: "query", schema: { type: "string" }, description: "Earlier round; default the first." },
          { name: "to", in: "query", schema: { type: "string" }, description: "Later round; default the last." },
          { name: "category", in: "query", schema: { type: "string" }, description: "Only this category." },
          LANG,
        ],
        responses: {
          200: { description: "The comparison.", ...json(ref("PanelComparison")) },
          404: problem("No such round or category.", "errorUnknownRound"),
          409: problem("Fewer than two rounds to compare.", "errorPanelNeedsTwoRounds"),
        },
      },
    },

    "/api/evaluation/propositions": {
      get: {
        tags: ["Evaluation"],
        operationId: "evaluatePropositions",
        summary: "Stances and pre-registered criteria, counted in persons",
        description:
          "Every proposition that makes a claim of its own, in every round after the first " +
          "and in any round it has criteria, stances or exclusions in. Per round, `tally` says " +
          "who supports, who contradicts and who neither — persons, not statements: a person " +
          "counts for a stance with at least one placed unit of that stance towards the " +
          "proposition, from any category. A person with both counts for both and is listed " +
          "under `split`, because a contradiction weighs more and is reported, not settled. " +
          "`untestable` lists who the proposition cannot be checked with, and why.\n\n" +
          "Each criterion is evaluated in its round. A counted one compares the persons meeting " +
          "it against its threshold among its base (`all`, or only the `testable`); `none` is met " +
          "while nobody meets the condition. One decided by hand (`kind: \"manual\"`) shows its " +
          "evidence and has `met: null`. A verdict holds when all its criteria are met, or one " +
          "of them under `combine: any`; one that hangs on a criterion by hand is listed in " +
          "`pending`. `status` is `supported`, `falsified`, `both` or `open`. Persons in the " +
          "base not meeting a criterion are its `deviant` cases, with what they said that bears " +
          "on it. `unreviewed` counts suggestions among the evidence.",
        parameters: [
          { name: "round", in: "query", schema: { type: "string" }, description: "Only this round." },
          LANG,
        ],
        responses: {
          200: {
            description: "The evaluation.",
            ...json({
              type: "object",
              properties: { propositions: { type: "array", items: ref("PropositionEvaluation") } },
            }),
          },
          404: problem("No such round.", "errorUnknownRound"),
        },
      },
    },

    "/api/evaluation/tags": {
      get: {
        tags: ["Evaluation"],
        operationId: "getTagReport",
        summary: "Coding units by the tag of their guide question",
        description:
          "How acceptance is reported without inventing categories for it: units the researcher " +
          "assigned to a guide question (`question` on the unit) grouped by that question's " +
          "tag, in the order the guide first uses each tag. `unassigned` counts the round's " +
          "units without a question, so the report says how much it covers.",
        parameters: [
          { name: "round", in: "query", schema: { type: "string" }, description: "Default: the last round." },
          LANG,
        ],
        responses: {
          200: { description: "The report.", ...json(ref("TagReport")) },
          400: problem("There are no rounds.", "errorRoundRequired"),
          404: problem("No such round.", "errorUnknownRound"),
        },
      },
    },

    /* Evaluation exports ------------------------------------------------- */
    "/api/export/evaluation-panel.md": {
      get: {
        tags: ["Exports"],
        operationId: "exportEvaluationPanel",
        summary: "Before and after, as a document",
        description:
          "`GET /api/evaluation/panel` written out: per category a grid table of the compared " +
          "departments, the units of `from` beside those of `to`, each cell opened by its count. " +
          "Without `category`, categories with no unit in either round are left out. Only " +
          "departments present in both rounds appear, and nothing in the prose says whether " +
          "any were left out.",
        parameters: [
          { name: "from", in: "query", schema: { type: "string" }, description: "Earlier round; default the first." },
          { name: "to", in: "query", schema: { type: "string" }, description: "Later round; default the last." },
          { name: "category", in: "query", schema: { type: "string" }, description: "Only this category." },
          LANG,
        ],
        responses: {
          200: { description: "The comparison as Markdown.", content: { "text/markdown": { schema: { type: "string" } } } },
          404: problem("No such round or category.", "errorUnknownRound"),
          409: problem("Fewer than two rounds to compare.", "errorPanelNeedsTwoRounds"),
        },
      },
    },
    "/api/export/evaluation-readout.md": {
      get: {
        tags: ["Exports"],
        operationId: "exportEvaluationReadout",
        summary: "The read-out list, counted before and after",
        description:
          "The `readout` of `GET /api/evaluation/panel`: per compared department how many entries " +
          "were listed, how many are still searched by hand, no longer, and open (not asked or " +
          "not marked — never counted as either), then each entry with its state.",
        parameters: [
          { name: "from", in: "query", schema: { type: "string" }, description: "Earlier round; default the first." },
          { name: "to", in: "query", schema: { type: "string" }, description: "Later round; default the last." },
          LANG,
        ],
        responses: {
          200: { description: "The counts as Markdown.", content: { "text/markdown": { schema: { type: "string" } } } },
          404: problem("No such round.", "errorUnknownRound"),
          409: problem("Fewer than two rounds to compare.", "errorPanelNeedsTwoRounds"),
        },
      },
    },
    "/api/export/evaluation-propositions.md": {
      get: {
        tags: ["Exports"],
        operationId: "exportEvaluationPropositions",
        summary: "Stances and pre-registered criteria, counted in persons",
        description:
          "`GET /api/evaluation/propositions` written out: per proposition the status of each " +
          "round as computed (`both` is printed as such, never settled; what hangs on a " +
          "criterion by hand is said), the stances counted in persons as a table, who said both " +
          "and who is not checkable with the reason, a table of the criteria with persons " +
          "counted against the threshold, then per criterion the evidence of the persons " +
          "meeting it and the deviant cases with what they said that bears on it, and per round " +
          "the persons who support and contradict at once. Unreviewed evidence is counted.",
        parameters: [
          { name: "round", in: "query", schema: { type: "string" }, description: "Only this round." },
          LANG,
        ],
        responses: {
          200: { description: "The criteria as Markdown.", content: { "text/markdown": { schema: { type: "string" } } } },
          404: problem("No such round.", "errorUnknownRound"),
        },
      },
    },
    "/api/export/evaluation-tags.md": {
      get: {
        tags: ["Exports"],
        operationId: "exportEvaluationTags",
        summary: "Coding units by guide-question tag, as a document",
        description:
          "`GET /api/evaluation/tags` written out: per tag the questions carrying it, then the " +
          "assigned units grouped by department, each with the question it answers. Says how " +
          "many units of the round are assigned to no question.",
        parameters: [
          { name: "round", in: "query", schema: { type: "string" }, description: "Default: the last round." },
          LANG,
        ],
        responses: {
          200: { description: "The report as Markdown.", content: { "text/markdown": { schema: { type: "string" } } } },
          400: problem("There are no rounds.", "errorRoundRequired"),
          404: problem("No such round.", "errorUnknownRound"),
        },
      },
    },
  };
}

export function evaluationSchemas({ ref }) {
  const unitList = { type: "array", items: ref("UnitRef") };
  return {
    Round: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        interviews: { type: "array", items: { type: "string" }, description: "Folders with a transcript." },
        planned: { type: "array", items: { type: "string" }, description: "Folders with only a log." },
        blocks: { type: "integer", description: "How many blocks its guide has." },
        untestable: {
          type: "object",
          description: "Who a proposition cannot be checked with: proposition → department → reason.",
        },
      },
    },

    GuideItem: {
      type: "object",
      required: ["text"],
      properties: {
        id: { type: "string", description: "Made when missing; fixed afterwards. Unique across the guide." },
        text: { type: "string" },
        condition: { type: "string", description: "Mandatory questions only: when it is asked." },
        tag: { type: "string", description: "The construct it operationalises; what the tag report groups by." },
      },
    },

    GuideBlock: {
      type: "object",
      required: ["name"],
      properties: {
        id: { type: "string" },
        name: {
          type: "string",
          description: "Written as the `## Section:` line the import places; matched across rounds.",
        },
        prompt: { type: "string", description: "The narrative prompt." },
        checklist: { type: "array", items: ref("GuideItem"), description: "Asked only if not raised." },
        mandatory: { type: "array", items: ref("GuideItem"), description: "Asked of everybody." },
        readout: {
          type: "object",
          description: "A list read out per department, each entry marked in the log.",
          properties: {
            label: { type: "string" },
            perDepartment: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
          },
        },
      },
    },

    Guide: {
      type: "object",
      required: ["blocks"],
      properties: {
        round: { type: "string" },
        name: { type: "string" },
        blocks: { type: "array", items: ref("GuideBlock") },
      },
    },

    Session: {
      type: "object",
      description:
        "`session.json` in the interview folder, plus — on reads — what the round's guide adds " +
        "to it (`round`, `transcript`, `current`, `blocks`, `readoutItems`).",
      properties: {
        id: { type: "string" },
        round: { type: ["string", "null"] },
        transcript: { type: "boolean" },
        department: { type: "string" },
        t0: { type: ["string", "null"], format: "date-time", description: "When the recording started." },
        blockStarts: {
          type: "array",
          items: {
            type: "object",
            properties: { block: { type: "string" }, at: { type: ["number", "null"] } },
          },
        },
        ticks: {
          type: "object",
          description: "Guide item id → seconds after `t0` it was first ticked (null without `t0`).",
          additionalProperties: { type: ["number", "null"] },
        },
        readout: {
          type: "object",
          description: "Block id → read-out entry → state. Unmarked entries are absent.",
          additionalProperties: {
            type: "object",
            additionalProperties: { type: "string", enum: READOUT_STATES },
          },
        },
        notes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              block: { type: ["string", "null"] },
              at: { type: ["number", "null"] },
              text: { type: "string" },
            },
          },
        },
        current: { type: ["string", "null"] },
        blocks: { type: "array", items: ref("GuideBlock") },
        readoutItems: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
      },
    },

    SessionOp: {
      type: "object",
      required: ["op"],
      properties: {
        op: { type: "string", enum: SESSION_OPS },
        t0: { type: "string", format: "date-time", description: "`start`: when, if not now." },
        block: { type: ["string", "null"], description: "`block`, `unblock`, `note`, `edit-note`, `readout`." },
        item: { type: "string", description: "`tick`, `untick` (guide item id), `readout` (entry)." },
        at: { type: ["number", "null"], description: "Seconds after `t0`, if not now." },
        text: { type: "string", description: "`note`, `edit-note`." },
        note: { type: "string", description: "`edit-note`, `delete-note`: the note's id." },
        state: { type: ["string", "null"], enum: [...READOUT_STATES, null], description: "`readout`." },
        department: { type: "string", description: "`department`." },
      },
    },

    SectionPlacement: {
      type: "object",
      description:
        "Where the import put — or would put — the guide's sections. A block started at second " +
        "s begins with the turn under way at s if that turn is the interviewer's, else with the " +
        "next turn. What cannot be placed is listed with the reason, never moved nearby.",
      properties: {
        placed: {
          type: "array",
          items: {
            type: "object",
            properties: {
              block: { type: "string" },
              name: { type: "string" },
              at: { type: "number" },
              before: { type: "integer", description: "Index of the turn the section opens." },
              turn: { type: "integer", description: "That turn's number in the written transcript." },
              turnAt: { type: ["number", "null"] },
            },
          },
        },
        unplaced: {
          type: "array",
          items: {
            type: "object",
            properties: {
              block: { type: "string" },
              name: { type: ["string", "null"] },
              at: { type: ["number", "null"] },
              reason: {
                type: "string",
                enum: ["sectionUnknownBlock", "sectionNoOffset", "sectionNoTimes", "sectionAfterLastTurn"],
              },
              why: { type: "string" },
            },
          },
        },
      },
    },

    UnitRef: {
      type: "object",
      description: "A coding unit as the evaluation surfaces cite it.",
      properties: {
        id: { type: "string" },
        interview: { type: "string" },
        turn: { type: "integer" },
        time: { type: ["string", "null"] },
        section: { type: ["string", "null"] },
        category: { type: "string" },
        text: { type: "string" },
        stance: {
          type: ["string", "null"],
          enum: [...STANCES, null],
          description: "The single stance of version 0.12, as stored; already counted in `stances`.",
        },
        stances: {
          type: "object",
          additionalProperties: { type: "string", enum: STANCES },
          description: "Stance per proposition id, as counted: `stances`, with an older `stance` read into it.",
        },
        question: { type: ["string", "null"] },
        reviewed: { type: "boolean" },
        anchor: { type: "boolean" },
        memo: { type: "string" },
        department: { type: "string", description: "In the tag report." },
      },
    },

    PanelComparison: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        departments: { type: "array", items: { type: "string" }, description: "Present in both rounds." },
        persons: { type: "object", description: "Per round, each department's interviews." },
        categories: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string" },
              name: { type: "string" },
              parent: { type: ["string", "null"] },
              proposition: { type: "string" },
              cells: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    department: { type: "string" },
                    from: { type: "object", properties: { count: { type: "integer" }, units: unitList } },
                    to: { type: "object", properties: { count: { type: "integer" }, units: unitList } },
                  },
                },
              },
            },
          },
        },
        readout: {
          type: "array",
          items: {
            type: "object",
            properties: {
              department: { type: "string" },
              interview: { type: ["string", "null"] },
              block: { type: "string" },
              label: { type: "string" },
              listed: { type: "integer" },
              still: { type: "integer" },
              noLonger: { type: "integer" },
              open: { type: "integer" },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: { item: { type: "string" }, state: { type: ["string", "null"] } },
                },
              },
            },
          },
        },
      },
    },

    Criterion: {
      type: "object",
      description:
        "A pre-registered criterion of a proposition, stored on it in `categories.json`. It " +
        "counts persons by their stance towards *this* proposition, from any category unless " +
        "`categories` narrows it.",
      required: ["verdict", "round"],
      properties: {
        id: { type: "string", description: "Made when missing." },
        text: { type: "string", description: "The registered wording." },
        verdict: { type: "string", enum: VERDICTS },
        round: { type: "string" },
        kind: {
          type: "string",
          enum: KINDS,
          description:
            "`count` (the default, not written) or `manual`: a condition the tool cannot " +
            "decide — a count from the commit history, \"the cause named most often\". A manual " +
            "criterion carries no threshold, shows the evidence its stance and categories select, " +
            "and is never met or unmet by the tool.",
        },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "Optional: only units of these categories count, each as listed. Absent: any category.",
        },
        stance: {
          type: "string",
          enum: STANCES,
          description: "The stance towards the proposition a unit must carry. Absent: any unit in `categories`.",
        },
        base: {
          type: "string",
          enum: BASES,
          description:
            "Whom it counts among: `all` persons of the round (the default, not written), or " +
            "only those the proposition can be checked with (`testable`).",
        },
        threshold: {
          type: "object",
          description:
            "Counted criteria only. `{ atLeast: 4 }` persons, `{ fraction: \"2/3\" }` of the " +
            "base, rounded up, or `{ none: true }`: met while nobody meets the condition.",
          properties: {
            atLeast: { type: "integer", minimum: 1 },
            fraction: { type: ["string", "number"] },
            none: { type: "boolean", enum: [true] },
          },
        },
      },
    },

    PropositionEvaluation: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        color: { type: "string" },
        combine: {
          type: "object",
          description: "Per verdict, `all` or `any` of its criteria.",
          properties: { supported: { enum: ["all", "any"] }, falsified: { enum: ["all", "any"] } },
        },
        rounds: {
          type: "array",
          items: {
            type: "object",
            properties: {
              round: { type: "string" },
              status: { type: "string", enum: ["supported", "falsified", "both", "open"] },
              verdicts: {
                type: "object",
                description: "Per verdict `true`, `false`, or `null` while it hangs on a criterion by hand.",
              },
              pending: { type: "array", items: { type: "string", enum: VERDICTS } },
              persons: { type: "integer" },
              testable: { type: "integer", description: "Persons not marked as not checkable." },
              tally: {
                type: "object",
                description: "Departments per stance: `supports`, `contradicts`, `neither`.",
                properties: {
                  supports: { type: "array", items: { type: "string" } },
                  contradicts: { type: "array", items: { type: "string" } },
                  neither: { type: "array", items: { type: "string" } },
                },
              },
              split: {
                type: "array",
                description: "Persons who support and contradict: counted for both, listed as deviant cases.",
                items: {
                  type: "object",
                  properties: {
                    department: { type: "string" },
                    interviews: { type: "array", items: { type: "string" } },
                    supports: unitList,
                    contradicts: unitList,
                  },
                },
              },
              untestable: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    department: { type: "string" },
                    reason: { type: "string" },
                    present: { type: "boolean", description: "False when the department is no person of the round." },
                  },
                },
              },
              uncoded: { type: "array", items: { type: "string" }, description: "Persons with no unit at all." },
              deviant: { type: "array", items: ref("PersonEvidence") },
            },
          },
        },
        criteria: {
          type: "array",
          items: {
            allOf: [
              ref("Criterion"),
              {
                type: "object",
                properties: {
                  persons: { type: "integer", description: "The base." },
                  required: { type: ["integer", "null"], description: "`null` for a criterion by hand; `0` for `none`." },
                  count: { type: ["integer", "null"], description: "Persons with evidence; `null` when it selects none." },
                  met: { type: ["boolean", "null"], description: "`null` for a criterion by hand." },
                  unreviewed: { type: "integer" },
                  meeting: {
                    type: "array",
                    items: ref("PersonEvidence"),
                    description: "Persons with evidence; `opposite` holds their units of the other stance.",
                  },
                  deviant: { type: "array", items: ref("PersonEvidence") },
                  untestable: {
                    type: "array",
                    description: "Left out of a `testable` base, with the reason.",
                    items: { type: "object" },
                  },
                },
              },
            ],
          },
        },
      },
    },

    PersonEvidence: {
      type: "object",
      properties: {
        department: { type: "string" },
        interviews: { type: "array", items: { type: "string" } },
        units: unitList,
      },
    },

    TagReport: {
      type: "object",
      properties: {
        round: { type: "string" },
        persons: { type: "integer" },
        tags: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tag: { type: "string" },
              items: { type: "array", items: ref("GuideItem") },
              departments: { type: "integer" },
              units: unitList,
            },
          },
        },
        untagged: { type: "object" },
        unknownQuestion: { ...unitList, description: "Units naming an item the guide no longer has." },
        unassigned: { type: "integer" },
      },
    },
  };
}
