// Generates the synthetic test transcripts under tests/fixtures/.
//
// Run once, the result is committed — the suite needs stable anchors (turn
// numbers, vocabulary, character offsets), not randomness. The material is
// invented office talk about everyday work, disruptions and agreements: enough
// to exercise every feature, tied to no real study and to no real company.
//
//   node tests/fixtures/generator.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const SECTIONS = [
  { name: "Vorspann (zur Begrüßung)", until: 2 },
  { name: "Warmfrage", until: 6 },
  { name: "1 · Arbeitsalltag (ein typischer Tag)", until: 16 },
  { name: "2 · Störungen (was den Fluss bricht)", until: 24 },
  { name: "3 · Absprachen (wer mit wem)", until: 32 },
  { name: "4 · Werkzeuge und Ablage", until: 44 },
  { name: "5 · Zusammenarbeit über Bereiche", until: 58 },
  { name: "6 · Wünsche an ein Werkzeug", until: 80 },
  { name: "7 · Abschluss", until: 125 },
];

// Turns whose wording the tests rely on: search terms, inflected forms, a
// timestamp inside a turn, and enough length for the character offsets used.
const FIXED = {
  2: "Sehr gerne, ich habe mir die Stunde freigehalten und bin gespannt, was aus dem Gespräch wird.",
  4: "Klar, ich bin seit dem Frühjahr im Team dabei. Ich betreue unsere Kampagnen und kümmere mich um die Inhalte auf der Webseite.",
  6: "Mein Alltag ist eine Mischung aus Texten, Abstimmungen und kleinen Recherchen, die nirgendwo richtig festgehalten werden.",
  8: "Wichtige Unterlagen werden bei uns in SharePoint abgelegt, aber die Absprachen dazu stehen verstreut im Chat und in Mails. Für Verträge gibt es zusätzlich einen Ordner der Geschäftsführung, den kaum jemand im Team überhaupt kennt.",
  10: "Eigentlich will ich alles sofort ablegen, aber im Stress bleibt die Hälfte in meinem Kopf und taucht nie wieder auf.",
  14: "Was ich einmal abgelegt habe, finde ich selten wieder, weil jeder Ordner nach einem anderen Muster benannt ist.",
  16: "Für Bilder und Vorlagen gibt es einen Ablageort, den nur ich kenne, und genau das ist vermutlich das Problem.",
  18: "Wenn mich etwas unterbricht, frage ich zuerst eine Kollegin, bevor ich mich durch die Ordner und alten Nachrichten grabe.",
  20: "Die Suche im Intranet liefert mir meistens Protokolle von vor zwei Jahren, aber nicht die aktuelle Fassung, die ich brauche.",
  22: "Bei Fragen zu Terminen schaue ich zuerst in SharePoint nach und frage dann im Vertrieb nach, ob der Stand noch stimmt.",
  24: "Manchmal gebe ich nach zehn Minuten auf und baue mir die Information aus alten Mails selbst wieder zusammen.",
  26: "An andere Teams gebe ich Ergebnisse meistens im Meeting weiter, danach verschwindet die Folie in irgendeinem Ordner.",
  28: "Neue Kolleginnen bekommen von mir eine Führung durch unsere Ablage, weil es keine Beschreibung gibt, die man nachlesen könnte.",
  34: "Unser Wiki ist ordentlich strukturiert, aber die Struktur passt zu der Abteilung, die es angelegt hat, nicht zu meiner Arbeit.",
  36: "Im Mitschnitt steht bei [12:30] die Stelle, an der wir das Durcheinander in der Ablage zum ersten Mal besprochen haben, und genau dort merkt man es deutlich.",
  46: "Auf dem Laufwerk darf ich vieles gar nicht sehen, und dann bitte ich jemanden, mir die Datei einfach per Mail zu schicken.",
};

const QUESTIONS = [
  "Magst du das an einem Beispiel aus der letzten Woche beschreiben?",
  "Woran merkst du, dass das gut funktioniert, und woran, dass es hakt?",
  "Wie gehst du vor, wenn es schnell gehen muss und niemand erreichbar ist?",
  "Was würdest du dir an dieser Stelle von einem Werkzeug wünschen?",
  "Wer außer dir arbeitet noch mit diesen Informationen und auf welchem Weg?",
];

const ANSWERS = [
  "Das läuft bei uns sehr unterschiedlich, je nachdem wie viel gerade ansteht und wer im Projekt die Verantwortung trägt.",
  "Im Zweifel entscheide ich nach Gefühl und hoffe, dass sich später niemand über den Stand der Unterlagen wundert.",
  "Meistens hilft mir dann die Erinnerung an das letzte Projekt, auch wenn ich die Einzelheiten nachschlagen müsste.",
  "Ich hätte gern eine Stelle, an der ich nachlesen kann, warum wir uns damals so entschieden haben und wer dabei war.",
  "Ehrlich gesagt verlasse ich mich stark darauf, dass die Kolleginnen ihre Themen im Kopf haben und erreichbar sind.",
  "Solche Vorgänge dauern bei uns oft länger als die eigentliche Arbeit, und genau das frustriert mich im Alltag am meisten.",
];

// Gaps in the numbering are allowed and have to stay: the turn number is the
// citable location and survives turns being merged during editing.
const GAPS = new Set([11, 12]);

function longInterview() {
  const lines = [
    "# Interview 1: Marketing",
    "",
    "Synthetisches Prüftranskript. Grundlage der Prüfläufe, kein echtes Interview.",
    "",
    "- Erhebung: 28. Juli 2026, Dauer 52:41",
    "- Quelle: Prüftranskript",
    "",
    "---",
  ];

  let section = 0;
  let question = 0;
  let answer = 0;
  let second = 5;
  let opening = true; // the next header line opens a section, if any

  for (let n = 1; n <= 125; n++) {
    if (GAPS.has(n)) continue;
    if (opening) {
      lines.push("", `## Section: ${SECTIONS[section].name}`);
      opening = false;
    }
    const interviewer = n % 2 === 1;
    const time = `${Math.floor(second / 60)}:${String(second % 60).padStart(2, "0")}`;
    second += 23;
    const speaker = interviewer ? "Interviewer" : "Marketing";
    const text = interviewer
      ? n === 1
        ? "Vielen Dank, dass du dir die Zeit nimmst. Erzähl doch zum Einstieg kurz, wie lange du schon dabei bist und was du machst."
        : QUESTIONS[question++ % QUESTIONS.length]
      : (FIXED[n] ?? ANSWERS[answer++ % ANSWERS.length]);
    lines.push("", `**${n} · ${speaker} [${time}]**`, "", text);
    if (n >= SECTIONS[section].until && section < SECTIONS.length - 1) {
      section++;
      opening = true;
    }
  }
  lines.push("");
  return lines.join("\n");
}

function shortInterview() {
  return [
    "# Interview 2: Vertrieb",
    "",
    "Synthetisches Prüftranskript. Zweiter Bereich, damit Kreuztabelle und",
    "Bereichszahl etwas zu zählen haben.",
    "",
    "- Erhebung: 30. Juli 2026, Dauer 12:00",
    "- Quelle: Prüftranskript",
    "",
    "---",
    "",
    `## Section: ${SECTIONS[2].name}`,
    "",
    "**1 · Interviewer [0:10]**",
    "",
    "Wie sieht ein gewöhnlicher Arbeitstag bei dir aus?",
    "",
    "**2 · Vertrieb [0:20]**",
    "",
    "Ich lege Angebote in SharePoint ab und schreibe die Absprachen in den Chat. Das ist nicht immer sauber getrennt, aber es geht schnell genug für den Alltag.",
    "",
    `## Section: ${SECTIONS[4].name}`,
    "",
    "**3 · Interviewer [4:00]**",
    "",
    "Und wenn du etwas aus einem anderen Bereich brauchst?",
    "",
    "**4 · Vertrieb [4:10]**",
    "",
    "Dann frage ich jemanden, weil ich die Benennung im Marketing nicht kenne und über die Suche selten das Richtige finde. Das kostet jedes Mal eine Rückfrage.",
    "",
  ].join("\n");
}

for (const [directory, content] of [
  ["interview-01", longInterview()],
  ["interview-02", shortInterview()],
]) {
  const target = new URL(`./${directory}/`, import.meta.url).pathname;
  mkdirSync(target, { recursive: true });
  writeFileSync(target + "final.md", content, "utf8");
  console.log("written:", directory);
}
