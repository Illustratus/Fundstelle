/**
 * A small invented study asked twice, on a server of its own.
 *
 * Four departments in the first round; three of them again in the second,
 * because the second round of the study this was built for could not reach one
 * department, and the checks have to show that nothing gives away which. All
 * of it synthetic: invented departments, invented sentences.
 *
 * Every spec of the second round runs against its own copy in a temporary
 * folder and its own port. Rounds, logs and criteria write files beside the
 * transcripts, and the shared sandbox is what the rest of the suite stands on.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** A transcript in the tool's own format, two answers long. */
export function transcript(department, number, answers, section = "1 · Arbeitsalltag (ein typischer Tag)") {
  const turns = [];
  let n = 1;
  let clock = 5;
  const stamp = () => `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, "0")}`;
  for (const answer of answers) {
    turns.push(`**${n} · Interviewer [${stamp()}]**\n\nWie läuft das bei euch?\n`);
    n += 1;
    clock += 20;
    turns.push(`**${n} · ${department} [${stamp()}]**\n\n${answer}\n`);
    n += 1;
    clock += 40;
  }
  return (
    `# Interview ${number}: ${department}\n\n` +
    `Synthetisches Prüftranskript.\n\n` +
    `---\n\n` +
    `## Section: ${section}\n\n` +
    turns.join("\n")
  );
}

export const FIRST_ROUND = {
  "r1-marketing": transcript("Marketing", 1, [
    "Wir legen alles in drei verschiedenen Ordnern ab und suchen danach lange.",
    "Absprachen laufen bei uns nur im Chat und gehen dort verloren.",
  ]),
  "r1-vertrieb": transcript("Vertrieb", 2, [
    "Angebote liegen im Postfach, niemand sonst findet sie wieder.",
    "Mit dem Lager stimmen wir uns am Telefon ab.",
  ]),
  "r1-einkauf": transcript("Einkauf", 3, [
    "Verträge stehen im Laufwerk, aber die Version ist nie klar.",
    "Freigaben holen wir uns per Mail.",
  ]),
  "r1-lager": transcript("Lager", 4, [
    "Wir schreiben vieles auf Zettel an der Wand.",
    "Wer Schicht hat, sagt es der nächsten Schicht mündlich.",
  ]),
};

export const SECOND_ROUND = {
  "r2-marketing": transcript("Marketing", 5, [
    "Jetzt lege ich es einmal ab und finde es auf Anhieb wieder.",
    "Der Bestätigungsschritt stört mich nicht, er geht schnell.",
  ]),
  "r2-vertrieb": transcript("Vertrieb", 6, [
    "Das Ablegen kostet keine Extrazeit mehr, das läuft nebenbei.",
    "Der Bestätigungsschritt reißt mich aus der Arbeit.",
  ]),
  "r2-einkauf": transcript("Einkauf", 7, [
    "Ich lege Verträge jetzt dort ab und es fühlt sich nicht nach mehr Arbeit an.",
    "Für Freigaben schreibe ich weiterhin Mails.",
  ]),
};

/**
 * A study folder with the given interviews, and a server on it.
 *
 * Returns helpers that speak to it the way a script would: no browser, so no
 * `Origin` header unless one is passed on purpose.
 */
export async function startStudy({ port, interviews = { ...FIRST_ROUND, ...SECOND_ROUND } }) {
  const folder = mkdtempSync(join(tmpdir(), "fundstelle-rounds-"));
  const transcripts = join(folder, "transcripts");
  for (const [id, text] of Object.entries(interviews)) {
    mkdirSync(join(transcripts, id), { recursive: true });
    writeFileSync(join(transcripts, id, "final.md"), text);
  }
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [join(ROOT, "server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      TRANSCRIPTS: transcripts,
      CATEGORIES: join(folder, "categories.json"),
      START_LANGUAGE: "de",
    },
    stdio: "ignore",
  });
  for (let tries = 0; tries < 60; tries += 1) {
    const up = await fetch(`${base}/api/interviews`).then((answer) => answer.ok, () => false);
    if (up) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const call = async (method, path, body, headers = {}) => {
    const answer = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await answer.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: answer.status, json, text };
  };

  return {
    base,
    folder,
    transcripts,
    get: (path, headers) => call("GET", path, undefined, headers),
    post: (path, body, headers) => call("POST", path, body, headers),
    put: (path, body, headers) => call("PUT", path, body, headers),
    patch: (path, body, headers) => call("PATCH", path, body, headers),
    del: (path, headers) => call("DELETE", path, undefined, headers),
    stop() {
      server.kill();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

/** Code a whole answer turn with one category, the way a script would. */
export async function code(study, interview, turn, category, extra = {}) {
  const one = await study.get(`/api/interviews/${interview}`);
  const text = one.json.turns.find((each) => each.number === turn).text;
  const made = await study.post(`/api/interviews/${interview}/codings`, {
    turn,
    start: 0,
    end: text.length,
    category,
    text,
    reviewed: true,
    ...extra,
  });
  if (made.status !== 201) throw new Error(`coding failed: ${made.status} ${made.text}`);
  return made.json;
}

/** The two rounds, made and filled. */
export async function twoRounds(study) {
  await study.post("/api/rounds", { name: "Anforderungserhebung", id: "requirements" });
  await study.post("/api/rounds", { name: "Evaluation", id: "evaluation" });
  await study.post("/api/rounds/evaluation/assign", { interviews: Object.keys(SECOND_ROUND) });
}
