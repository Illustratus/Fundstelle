/**
 * The figures, fetchable.
 *
 * Every number behind a chart could always be had over the API — the analysis,
 * the catalog, the agreement all answer in JSON — but the picture could not.
 * It was assembled by the browser out of geometry in `app.js` and colours in
 * `app.css`, so a script that puts a report together had to run a browser to
 * get one, and a figure in a thesis was a screenshot or nothing.
 *
 * The drawing now lives in `public/charts.js`, where it is arithmetic over the
 * same data this file fetches, and this is the join: it collects what a figure
 * needs, draws it, and hands back a file that carries its own colours and its
 * own fonts. The interface draws from the same module, so what a reader saves
 * from the screen and what a script fetches from the endpoint are the same
 * picture, not two that happen to agree.
 *
 * The one thing the browser still does better is measure text: how far an
 * angled heading reaches, where a key has to wrap. Here there is nobody to ask,
 * so `charts.js` estimates — deliberately wide, because a few pixels of unused
 * white space is invisible and a few missing cut a word in half.
 */

import { FIGURES, THEME_NAMES, standalone } from "../public/charts.js";
import { TEXTS } from "../public/texts.js";
import { FALLBACK, LANGUAGES, fail } from "./texts.js";

export const FIGURE_NAMES = Object.keys(FIGURES);

export const SVG = "image/svg+xml; charset=utf-8";

/**
 * A `t(key, values)` over the *interface* texts.
 *
 * Not the server's own dictionary: a chart's title, its caption and the
 * sentence a screen reader hears are interface wording, and they are written
 * once, in `public/texts.js`. Reaching into it from here is the alternative to
 * a second copy that drifts — and a title that reads differently in the file
 * than on the screen is exactly the kind of drift nobody notices.
 */
export function interfaceTranslator(language) {
  const chosen = LANGUAGES.includes(language) ? language : FALLBACK;
  return (key, values) => {
    let text = TEXTS[chosen]?.[key] ?? TEXTS.de[key] ?? key;
    for (const [name, value] of Object.entries(values ?? {})) {
      text = text.replaceAll(`{${name}}`, value);
    }
    return text;
  };
}

/** Which of the two bodies of data a figure is drawn from. */
export const viewOf = (name) => FIGURES[name]?.view ?? null;

export const knows = (name) => Object.hasOwn(FIGURES, name);

export const themeOf = (wanted) => (THEME_NAMES.includes(wanted) ? wanted : "light");

/**
 * One figure as a standalone SVG.
 *
 * Two ways of not getting a picture, and they are different answers. A name
 * nobody offers is a wrong address — 404, with the names that do exist, because
 * a list of six is cheaper to read than the documentation. A name that exists
 * but has nothing to draw yet is a 409: the endpoint is right, the study is not
 * there yet, and saying which condition is missing is the whole difference
 * between a broken tool and a tool waiting for work.
 */
export function drawFigure(name, { analysis, catalog, language, theme }) {
  if (!knows(name)) {
    throw Object.assign(fail("errorUnknownFigure", { figures: FIGURE_NAMES.join(", ") }), {
      status: 404,
    });
  }
  const t = interfaceTranslator(language);
  const spec = FIGURES[name].draw({ analysis, catalog, t });
  // Its own condition, not a shared "nothing to draw": which of the six is
  // missing is the answer somebody asking actually needs.
  if (!spec) throw Object.assign(fail(FIGURES[name].emptyKey), { status: 409 });
  return { spec, svg: standalone(spec, { theme: themeOf(theme) }) };
}

/**
 * What the six figures are, for whoever has not read the documentation.
 *
 * Titles and captions in the language asked for, so the list is usable as the
 * index of a report rather than only as a set of addresses.
 */
export function figureIndex(language) {
  const t = interfaceTranslator(language);
  return FIGURE_NAMES.map((name) => ({
    name,
    view: FIGURES[name].view,
    file: `${name}.svg`,
    url: `/api/figures/${name}.svg`,
    title: t(FIGURES[name].titleKey),
  }));
}
