/**
 * The study, in the format every other QDA program reads.
 *
 * This tool keeps everything as plain files beside the transcripts, which is
 * the strongest answer to "what happens to my work if the tool goes away" — as
 * long as the answer is not "you retype it into MAXQDA". REFI-QDA is the
 * interchange format MAXQDA, ATLAS.ti, NVivo, QualCoder and Quirkos all read
 * and write, so a study can leave here whole: the category system with its
 * definitions, every transcript as text, and every coding as a character range
 * on that text.
 *
 * A `.qdpx` is a zip holding `project.qde` — the XML — and a `Sources` folder
 * with one plain-text file per interview. Written here without a dependency,
 * the way the rest of this tool is: the zip is a few dozen lines and `zlib` is
 * in the standard library.
 *
 * Two things are worth being precise about, because a wrong one is worse than
 * no export at all.
 *
 * The offsets. A coding here is a range inside one turn; over there it is a
 * range inside the whole document. So the plain text is built first and each
 * turn's start recorded while building it, and the coding's own quoted text is
 * checked against the slice it lands on — an export whose ranges are off by the
 * length of a speaker line would put every citation on the wrong sentence, and
 * nothing downstream would say so.
 *
 * The identifiers. REFI-QDA wants a UUID everywhere this tool has a readable
 * id like `routine` or `ind.ablage`. They are derived rather than invented — a
 * name-based v5 UUID over a fixed namespace — so exporting the same study twice
 * gives the same identifiers, and a program that already holds one import can
 * recognise the second.
 */

import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import { fail } from "./texts.js";

/** A namespace of this tool's own, so the derived UUIDs are stable and ours. */
const NAMESPACE = "1b4e28ba-2fa1-11d2-883f-b9a761bde3fb";

/** RFC 4122 version 5: the same name always gives the same identifier. */
export function uuid(name) {
  const space = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(Buffer.concat([space, Buffer.from(name, "utf8")])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A file name inside the archive that any zip reader can put on a disk.
 *
 * The name in here is opaque — `plainTextPath` is a pointer, and what a person
 * reads is the `name` attribute on the source, which keeps the real title. But
 * an interview folder may be called `interview-müller`, and the zip readers in
 * circulation are not all careful about the flag that says the names are UTF-8:
 * Info-ZIP, which is what `unzip` is on a Mac, decodes them as CP437 and writes
 * a file nobody asked for. Keeping the inside ASCII costs nothing and removes a
 * class of "it did not open in their program" that is very hard to diagnose
 * from here.
 */
export function safeName(id) {
  const folded = String(id)
    .replace(/[äÄ]/g, "ae").replace(/[öÖ]/g, "oe").replace(/[üÜ]/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const kept = folded.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  // A short digest where nothing readable survived, or where two different
  // names would otherwise fold onto one.
  const stamp = createHash("sha1").update(String(id)).digest("hex").slice(0, 8);
  return kept && kept === String(id) ? kept : `${kept || "source"}-${stamp}`;
}

function escapeXML(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character],
  );
}

/**
 * The transcript as one document, and where each turn begins in it.
 *
 * The speaker line comes along: a citation read in another program without who
 * said it and in which turn is a sentence without a source, which is the one
 * thing this tool refuses to produce anywhere else.
 */
export function plainText(transcript) {
  let text = "";
  const startOfTurn = new Map();
  let section = -1;
  for (const turn of transcript.turns) {
    if (turn.section !== section) {
      section = turn.section;
      const head = transcript.sections[section];
      if (head) text += `${head.name}\n\n`;
    }
    text += `${turn.number} · ${turn.speaker}${turn.time ? ` [${turn.time}]` : ""}\n`;
    startOfTurn.set(turn.number, text.length);
    text += `${turn.text}\n\n`;
  }
  return { text, startOfTurn };
}

/**
 * One study as REFI-QDA project XML.
 *
 * `studies` is one entry per interview: the transcript, its codings and its
 * note. Codings whose passage no longer has a place are left out — the same
 * rule every other surface in this tool keeps, and a range that points at
 * nothing would land on whatever text happens to sit there.
 */
export function projectXML({ studies, categories, propositions = {}, name, now = new Date() }) {
  const stamp = now.toISOString().replace(/\.\d+Z$/, "Z");
  const user = uuid("user:fundstelle");
  const colorOf = (category) => propositions[category.proposition]?.color ?? null;

  const codeXML = (category, children) =>
    `<Code guid="${uuid(`code:${category.id}`)}" name="${escapeXML(category.name)}" isCodable="true"` +
    (colorOf(category) ? ` color="${escapeXML(colorOf(category))}"` : "") +
    `>` +
    (category.definition ? `<Description>${escapeXML(definitionOf(category))}</Description>` : "") +
    children.join("") +
    `</Code>`;

  const definitionOf = (category) => {
    // The coding rules travel with the definition: they are the part of a
    // category that says where its boundary runs, and there is nowhere else in
    // the format to put them.
    const rules = (category.codingRules ?? []).filter(Boolean);
    return [category.definition, rules.length ? `\n\n${rules.map((rule) => `– ${rule}`).join("\n")}` : ""]
      .join("")
      .trim();
  };

  const children = (parent) =>
    categories.filter((one) => (one.parent ?? null) === parent).map((one) => codeXML(one, children(one.id)));

  const sources = studies
    .map(({ transcript, codings, memo }) => {
      const { startOfTurn, text } = plainText(transcript);
      const file = `${safeName(transcript.id)}.txt`;
      const placed = (codings ?? []).filter((coding) => coding.state !== "lost");
      const selections = placed
        .map((coding) => {
          const base = startOfTurn.get(coding.turn);
          if (base === undefined) return "";
          const from = base + coding.start;
          const to = base + coding.end;
          // The quoted text has to be what sits there, or the range is a
          // citation of something nobody said.
          if (coding.text && text.slice(from, to) !== coding.text) return "";
          return (
            `<PlainTextSelection guid="${uuid(`sel:${coding.id}`)}" name="${escapeXML(
              `${transcript.id} · ${coding.turn}`,
            )}" startPosition="${from}" endPosition="${to}" creatingUser="${user}" creationDateTime="${escapeXML(
              coding.created ?? stamp,
            )}">` +
            (coding.memo ? `<Description>${escapeXML(coding.memo)}</Description>` : "") +
            `<Coding guid="${uuid(`coding:${coding.id}`)}" creatingUser="${user}" creationDateTime="${escapeXML(
              coding.created ?? stamp,
            )}">` +
            `<CodeRef targetGUID="${uuid(`code:${coding.category}`)}"/>` +
            `</Coding></PlainTextSelection>`
          );
        })
        .join("");
      return {
        file,
        text,
        xml:
          `<TextSource guid="${uuid(`source:${transcript.id}`)}" name="${escapeXML(
            transcript.title || transcript.id,
          )}" plainTextPath="internal://${escapeXML(file)}" creatingUser="${user}" creationDateTime="${stamp}">` +
          (memo ? `<Description>${escapeXML(memo)}</Description>` : "") +
          selections +
          `</TextSource>`,
      };
    })
    .filter(Boolean);

  const xml =
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<Project xmlns="urn:QDA-XML:project:1.0" name="${escapeXML(name)}"` +
    ` origin="Fundstelle" creatingUserGUID="${user}" creationDateTime="${stamp}">` +
    `<Users><User guid="${user}" name="Fundstelle"/></Users>` +
    `<CodeBook><Codes>${children(null).join("")}</Codes></CodeBook>` +
    `<Sources>${sources.map((one) => one.xml).join("")}</Sources>` +
    `</Project>`;

  return { xml, sources: sources.map(({ file, text }) => ({ file, text })) };
}

/* Reading one back ---------------------------------------------------------
   The other direction, and only as far as it can be done honestly. A category
   system travels: names, definitions, and which sits under which. A study does
   not — their plain text is not this format's turns and guide prompts, and
   inventing speakers and sections to hang their character offsets on would
   produce a transcript nobody said. So this reads the codebook and says so. */

/**
 * The codes in a `.qdc` codebook or the `project.qde` of a `.qdpx`.
 *
 * A tiny reader rather than a parser: the shape is known, deeply nested, and
 * the whole point is to be dependency-free. It walks `<Code …>` elements,
 * keeps the nesting, and takes `<Description>` as the definition.
 */
export function readCodebook(xml) {
  const text = String(xml);
  const found = [];
  const stack = [];
  const tag = /<(\/?)(Code|Description)\b([^>]*?)(\/?)>/g;
  let last = 0;
  let describing = null;

  const attribute = (raw, name) => {
    const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(raw) ?? new RegExp(`${name}\\s*=\\s*'([^']*)'`).exec(raw);
    return match ? unescapeXML(match[1]) : null;
  };

  for (let match = tag.exec(text); match; match = tag.exec(text)) {
    const [whole, closing, element, raw, selfClosing] = match;
    if (element === "Description") {
      if (closing) {
        if (describing) {
          describing.definition = unescapeXML(text.slice(last, match.index)).trim();
          describing = null;
        }
      } else if (!selfClosing) {
        // Only the description of the code it sits directly in.
        describing = stack[stack.length - 1] ?? null;
        last = match.index + whole.length;
      }
      continue;
    }
    if (closing) {
      stack.pop();
      continue;
    }
    const one = {
      name: (attribute(raw, "name") ?? "").trim(),
      definition: "",
      parent: stack.length ? stack[stack.length - 1].name : null,
      depth: stack.length,
    };
    if (one.name) found.push(one);
    if (!selfClosing) stack.push(one);
  }
  return found;
}

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/* Numeric references too, and not as an afterthought: a codebook written in
   German by another program is mostly `&#228;` and `&#246;`, and a category
   called `Abl&#228;ufe` is worse than one that failed to import. */
function unescapeXML(text) {
  return String(text).replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/g, (whole, hex, decimal, name) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number(decimal));
    return NAMED[name] ?? whole;
  });
}

/** The `project.qde` out of a `.qdpx`, or the file itself if it is already XML. */
export function codebookFrom(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.subarray(0, 2).toString("latin1") !== "PK") return bytes.toString("utf8");
  for (const entry of unzip(bytes)) {
    if (/(^|\/)(project\.qde|.*\.qdc)$/i.test(entry.name)) return entry.data.toString("utf8");
  }
  throw Object.assign(fail("errorCodebookUnreadable"), { status: 400 });
}

/**
 * The entries of a zip, read from its central directory.
 *
 * Only what is needed to find one file in an archive this tool may not have
 * written: stored and deflated entries, which is everything a `.qdpx` holds.
 */
function unzip(bytes) {
  const end = (() => {
    for (let at = bytes.length - 22; at >= 0; at -= 1) {
      if (bytes.readUInt32LE(at) === 0x06054b50) return at;
    }
    throw Object.assign(fail("errorCodebookUnreadable"), { status: 400 });
  })();
  let at = bytes.readUInt32LE(end + 16);
  const count = bytes.readUInt16LE(end + 8);
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (bytes.readUInt32LE(at) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(at + 10);
    const compressed = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const offset = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    // The local header repeats the name and may carry a different extra field,
    // so the body has to be found through it rather than through this one.
    const localName = bytes.readUInt16LE(offset + 26);
    const localExtra = bytes.readUInt16LE(offset + 28);
    const from = offset + 30 + localName + localExtra;
    const body = bytes.subarray(from, from + compressed);
    entries.push({ name, data: method === 8 ? inflateRawSync(body) : body });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/* The zip, by hand ---------------------------------------------------------
   A `.qdpx` is an ordinary zip and `zlib` deflates; what is left is the
   envelope. Written out rather than depended on, because a tool that installs
   nothing to run should not install something to export. */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** Zip `[{name, data}]` into one buffer, deflated. */
export function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const packed = deflateRawSync(raw);
    const useDeflate = packed.length < raw.length;
    const body = useDeflate ? packed : raw;
    const method = useDeflate ? 8 : 0;
    const nameBytes = Buffer.from(name, "utf8");
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // the version needed, which for deflate is 2.0
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(method, 8);
    // No timestamp: a zip of the same study twice should be the same zip, and
    // the times that matter are in the XML.
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01, the earliest a zip date can say
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBytes, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(sum, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** The whole study as one `.qdpx` buffer. */
export function projectFile(options) {
  const { xml, sources } = projectXML(options);
  return zip([
    { name: "project.qde", data: xml },
    ...sources.map((one) => ({ name: `Sources/${one.file}`, data: one.text })),
  ]);
}
