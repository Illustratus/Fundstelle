/**
 * The exports of the second round: panel, criteria, guide questions, read-out.
 *
 * Each route asks `evaluation-routes.js` for the very answer the Auswertung tab
 * draws and writes it as Markdown (`evaluation-export.js`), so the document and
 * the screen cannot disagree. Written in the one-line route shape the OpenAPI
 * check reads, like every other `lib/*-routes.js`.
 */

import { Study } from "./rounds.js";
import { panelView, propositionsView, tagsView } from "./evaluation-routes.js";
import {
  evaluationPanelMarkdown,
  evaluationPropositionsMarkdown,
  evaluationReadoutMarkdown,
  evaluationTagsMarkdown,
} from "./evaluation-export.js";

const MARKDOWN = "text/markdown; charset=utf-8";

export async function evaluationExportRoutes({
  request,
  path,
  url,
  response,
  store,
  study,
  send,
  allInterviews,
  seedLanguage,
  language,
}) {
  const context = { url, store, study, allInterviews, seedLanguage };

  if (path === "/api/export/evaluation-panel.md" && request.method === "GET") {
    const panel = await panelView(context);
    const { rounds } = await study.read();
    const only = url.searchParams.get("category") || null;
    send(response, 200, evaluationPanelMarkdown(panel, { rounds, language, only }), MARKDOWN);
    return true;
  }

  if (path === "/api/export/evaluation-readout.md" && request.method === "GET") {
    const panel = await panelView({ ...context, withoutCategories: true });
    const { rounds } = await study.read();
    send(response, 200, evaluationReadoutMarkdown(panel, { rounds, language }), MARKDOWN);
    return true;
  }

  if (path === "/api/export/evaluation-propositions.md" && request.method === "GET") {
    const view = await propositionsView(context);
    const { rounds } = await study.read();
    const { categories } = await store.categories(seedLanguage);
    send(response, 200, evaluationPropositionsMarkdown(view, { rounds, categories, language }), MARKDOWN);
    return true;
  }

  if (path === "/api/export/evaluation-tags.md" && request.method === "GET") {
    const report = await tagsView(context);
    const data = await study.read();
    const blocks = Study.round(data, report.round).guide?.blocks ?? [];
    send(response, 200, evaluationTagsMarkdown(report, { rounds: data.rounds, blocks, language }), MARKDOWN);
    return true;
  }

  return false;
}
