/**
 * The API reference, rendered from the description the server serves.
 *
 * Not Swagger UI. That would be a megabyte and a half of somebody else's
 * JavaScript vendored into a tool whose whole point is that it has no
 * dependencies and works with the network unplugged — and it would look like
 * every other API page rather than like this one. The document at
 * `/api/openapi.json` is the standard artefact and stays exactly that: point
 * Swagger UI, Redoc or a code generator at it if you would rather. This page is
 * the same document read in the tool's own hand.
 *
 * It renders from the description rather than from a copy of it, so there is
 * nothing here to keep in step with the interface.
 */

import { language, t } from "./texts.js";

const $ = (selector) => document.querySelector(selector);

const escape = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  );

/** Code, emphasis and links inside one line. Escaped first, always. */
const inline = (text) =>
  escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

/**
 * One sentence, formatted but not wrapped in anything.
 *
 * A field's explanation is a phrase belonging to the field, and putting it in a
 * paragraph of its own made it read as though it belonged to the field below —
 * the page's paragraph spacing is larger than the gap between two entries, so
 * the eye grouped them the wrong way round. Here the markup is the grouping.
 */
const line = (text) => inline(String(text ?? "").replace(/\s+/g, " ").trim());

/**
 * The small part of Markdown the descriptions are written in.
 *
 * Headings, lists, paragraphs, code, emphasis and links — nothing else is used
 * and nothing else is understood.
 */
function prose(text) {
  const out = [];
  let list = null;
  /* A paragraph ends at a blank line, not at the end of a line. The
     descriptions are written wrapped in the source, and treating each of those
     lines as a paragraph of its own put the author's line breaks into the
     reader's window — where they are wrong at every width but one. */
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`<ul>${list.join("")}</ul>`);
    list = null;
  };

  for (const source of String(text ?? "").split("\n")) {
    const bullet = source.match(/^\s*-\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      list = list ?? [];
      list.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const heading = source.match(/^#{2,4}\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      out.push(`<h2>${inline(heading[1])}</h2>`);
      continue;
    }
    if (!source.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    // A line continuing a list item belongs to it, not to a new paragraph.
    if (list) {
      list[list.length - 1] = list[list.length - 1].replace(
        /<\/li>$/,
        ` ${inline(source.trim())}</li>`,
      );
    } else paragraph.push(source.trim());
  }
  flushParagraph();
  flushList();
  return out.join("");
}

/* Schemas ------------------------------------------------------------------ */

let document_ = null;

const resolve = (schema) => {
  if (!schema?.$ref) return schema;
  const name = schema.$ref.split("/").pop();
  return { ...document_.components.schemas[name], "x-name": name };
};

/** A type as one short line: `string`, `array of Citation`, `must | should`. */
function typeOf(raw) {
  const schema = raw ?? {};
  if (schema.$ref) return schema.$ref.split("/").pop();
  if (schema.allOf) return schema.allOf.map(typeOf).join(" + ");
  if (schema.enum) return schema.enum.map((one) => (one === null ? "null" : String(one))).join(" | ");
  if (schema.const) return `"${schema.const}"`;
  const kind = Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type;
  if (kind === "array") return `${typeOf(schema.items)}[]`;
  if (kind === "object" && schema.additionalProperties) {
    return `{ … : ${typeOf(schema.additionalProperties)} }`;
  }
  return kind ?? "any";
}

/**
 * The fields of a schema, one level at a time.
 *
 * Nested objects open on demand rather than all at once: a reference that
 * unfolds every branch of the analysis in front of somebody looking for one
 * field is a wall, and a wall is not documentation.
 */
function fields(raw, depth = 0) {
  const schema = resolve(raw);
  if (!schema) return "";
  if (schema.allOf) return schema.allOf.map((one) => fields(one, depth)).join("");

  const properties = schema.properties ?? resolve(schema.items ?? {})?.properties;
  if (!properties) return "";
  const required = new Set(schema.required ?? []);

  return (
    `<ul class="api-fields">` +
    Object.entries(properties)
      .map(([name, property]) => {
        const nested = resolve(property.$ref ? property : (property.items ?? property));
        const deeper =
          depth < 1 && nested?.properties && !property.$ref
            ? fields(property.items ?? property, depth + 1)
            : "";
        const named = property.$ref || property.items?.$ref;
        return (
          `<li><span class="api-name">${escape(name)}</span>` +
          (required.has(name)
            ? ` <span class="api-required" title="${escape(t("docsRequired"))}">*</span>`
            : "") +
          `<span class="api-type">${escape(typeOf(property))}</span>` +
          (property.description ? `<span class="api-about">${line(property.description)}</span>` : "") +
          (named
            ? `<details class="api-schema"><summary>${escape(typeOf(property))}</summary>${fields(
                property.$ref ? property : property.items,
                depth,
              )}</details>`
            : deeper) +
          `</li>`
        );
      })
      .join("") +
    `</ul>`
  );
}

/* Operations --------------------------------------------------------------- */

const METHODS = ["get", "post", "patch", "put", "delete"];

/** A line somebody can paste into a terminal, with the path parameters filled. */
function curlFor(method, path, operation) {
  let route = path;
  for (const parameter of operation.parameters ?? []) {
    if (parameter.in !== "path") continue;
    route = route.replace(`{${parameter.name}}`, parameter.example ?? `<${parameter.name}>`);
  }
  const body = operation.requestBody?.content?.["application/json"]?.example;
  return (
    `curl${method === "get" ? "" : ` -X ${method.toUpperCase()}`} ` +
    `http://127.0.0.1:4173${route}` +
    (body
      ? ` \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify(body)}'`
      : "")
  );
}

function parametersTable(parameters) {
  if (!parameters?.length) return "";
  return (
    `<h4>${t("docsParameters")}</h4><table><thead><tr><th>${t("docsColumnName")}</th>` +
    `<th>${t("docsColumnWhere")}</th><th>${t("docsColumnType")}</th>` +
    `<th>${t("docsColumnMeaning")}</th></tr></thead><tbody>` +
    parameters
      .map(
        (one) =>
          `<tr><td class="api-name">${escape(one.name)}${one.required ? '<span class="api-required">*</span>' : ""}</td>` +
          `<td class="api-type">${escape(one.in)}</td>` +
          `<td class="api-type">${escape(typeOf(one.schema))}</td>` +
          `<td>${prose(one.description ?? "")}</td></tr>`,
      )
      .join("") +
    `</tbody></table>`
  );
}

function bodySection(requestBody) {
  if (!requestBody) return "";
  const media = requestBody.content?.["application/json"];
  if (!media) return "";
  return (
    `<h4>${t("docsRequest")}</h4>` +
    fields(media.schema) +
    (media.example
      ? `<pre class="api-sample">${escape(JSON.stringify(media.example, null, 2))}</pre>`
      : "")
  );
}

function responsesSection(responses) {
  return (
    `<h4>${t("docsResponse")}</h4>` +
    Object.entries(responses ?? {})
      .map(([status, answer]) => {
        const media =
          answer.content?.["application/json"] ??
          answer.content?.["text/markdown"] ??
          answer.content?.["image/svg+xml"] ??
          answer.content?.["application/zip"];
        const type = Object.keys(answer.content ?? {})[0];
        const good = Number(status) < 400;
        return (
          `<div class="api-answer">` +
          `<p><span class="api-status ${good ? "ok" : "bad"}">${escape(status)}</span> ` +
          `${escape(answer.description ?? "")}` +
          (type && type !== "application/json" ? ` <code>${escape(type)}</code>` : "") +
          `</p>` +
          (media?.schema ? fields(media.schema) : "") +
          (media?.example
            ? `<pre class="api-sample">${escape(JSON.stringify(media.example, null, 2))}</pre>`
            : "") +
          `</div>`
        );
      })
      .join("")
  );
}

function operationHTML(method, path, operation) {
  const id = operation.operationId ?? `${method}-${path}`;
  return (
    `<article class="api-operation" id="${escape(id)}">` +
    `<header>` +
    `<span class="api-method ${method}">${method}</span>` +
    `<span class="api-route">${escape(path)}</span>` +
    `<span class="api-summary">${escape(operation.summary ?? "")}</span>` +
    `</header>` +
    (operation.description ? `<div class="api-prose">${prose(operation.description)}</div>` : "") +
    parametersTable(operation.parameters) +
    bodySection(operation.requestBody) +
    responsesSection(operation.responses) +
    `<div class="api-curl"><pre class="api-sample">${escape(curlFor(method, path, operation))}</pre>` +
    `<button type="button" class="button-quiet" data-copy="${escape(id)}">${t("docsCopy")}</button></div>` +
    `</article>`
  );
}

/* The page ----------------------------------------------------------------- */

function translateChrome() {
  document.documentElement.lang = language();
  $("#to-application").textContent = t("docsToApplication");
  $("#contents").setAttribute("aria-label", t("docsContents"));
}

function render(spec) {
  document_ = spec;
  document.title = `${spec.info.title} — API`;
  $("#lead").textContent = spec.info.summary ?? "";
  $("#version").textContent = `v${spec.info.version}`;
  $("#intro").innerHTML = prose(spec.info.description);

  /* Grouped by tag and in the order the tags are declared, because that order
     is the order somebody works in: point the tool at material, bring it in,
     build the instrument, code, count, draw, hand out. */
  const byTag = new Map((spec.tags ?? []).map((tag) => [tag.name, []]));
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      if (!item[method]) continue;
      const tag = item[method].tags?.[0] ?? t("docsOther");
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push({ method, path, operation: item[method] });
    }
  }

  const about = new Map((spec.tags ?? []).map((tag) => [tag.name, tag.description]));
  let operations = "";
  let toc = "";
  for (const [tag, entries] of byTag) {
    if (!entries.length) continue;
    const anchor = `tag-${tag.toLowerCase().replace(/[^a-z]+/g, "-")}`;
    operations +=
      `<section class="api-tag" id="${anchor}"><h2>${escape(tag)}</h2>` +
      `<p>${escape(about.get(tag) ?? "")}</p></section>` +
      entries.map((one) => operationHTML(one.method, one.path, one.operation)).join("");
    toc +=
      `<h2><a href="#${anchor}">${escape(tag)}</a></h2>` +
      entries
        .map(
          (one) =>
            `<a href="#${escape(one.operation.operationId)}">` +
            `<span class="api-method ${one.method}">${one.method}</span>` +
            `<span class="api-path">${escape(one.path)}</span></a>`,
        )
        .join("");
  }
  $("#operations").innerHTML = operations;
  $("#toc").innerHTML = toc;

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    await navigator.clipboard.writeText(button.previousElementSibling.textContent);
    button.textContent = t("docsCopied");
    setTimeout(() => (button.textContent = t("docsCopy")), 1200);
  });
}

translateChrome();

const answer = await fetch("/api/openapi.json");
if (answer.ok) {
  render(await answer.json());
} else {
  $("#intro").innerHTML = prose(t("docsUnavailable"));
}
