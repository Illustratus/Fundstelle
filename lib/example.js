/**
 * A transcript to start on, written out on request.
 *
 * The empty screen explains the format exactly and then leaves the reader to
 * type it: make a folder, make a file, get the asterisks and the middle dot
 * right, reload. That is the moment a tool is put aside — and everything needed
 * to spare it is already on the screen, since the tool knows the folder, knows
 * the format and is showing an example of it.
 *
 * So the example can simply be written. It is invented office talk in the same
 * shape as the synthetic material the tests use: two guide sections, both
 * speakers, enough substance that a first coding, a search and the analysis all
 * have something to work on. Nothing about it pretends to be research.
 */

export const EXAMPLE_FOLDER = "example-interview";

const TRANSCRIPTS = {
  de: `# Interview 1: Vertrieb

- Erhebung: 4. August 2026
- Quelle: Beispiel, kein echtes Interview

---

## Erzählanstoß: 1 · Ablage (wo etwas landet)

**1 · Interviewer [0:05]**

Wie legt ihr fest, wo eine Information hingehört?

**2 · Vertrieb [0:22]**

Ehrlich gesagt gar nicht. Angebote landen im Laufwerk, Absprachen im Chat, und
was dringend war, steht in irgendeiner Mail. Wer es sucht, muss wissen, wer
damals dabei war.

**3 · Interviewer [0:58]**

Und wenn die Person nicht da ist?

**4 · Vertrieb [1:10]**

Dann baue ich mir den Stand aus alten Nachrichten neu zusammen. Das kostet
einen halben Vormittag und am Ende bin ich mir trotzdem nicht sicher, ob ich
die aktuelle Fassung habe.

## Erzählanstoß: 2 · Übergabe (was weitergegeben wird)

**5 · Interviewer [2:03]**

Wie übergeben Sie einen Vorgang an jemand anderen?

**6 · Vertrieb [2:15]**

Im Gespräch. Ich erzähle, was wichtig ist, und hoffe, dass es hängen bleibt.
Aufgeschrieben wird das nirgends, dafür fehlt im Tagesgeschäft die Zeit.

**7 · Interviewer [2:52]**

Was würden Sie sich an dieser Stelle wünschen?

**8 · Vertrieb [3:04]**

Eine Suche, die über alles geht, und einen Ort, an dem der aktuelle Stand
steht. Nicht mehr. Alles andere haben wir schon dreimal versucht.
`,
  en: `# Interview 1: Sales

- Conducted: 4 August 2026
- Source: example, not a real interview

---

## Section: 1 · Filing (where things end up)

**1 · Interviewer [0:05]**

How do you decide where a piece of information belongs?

**2 · Sales [0:22]**

Honestly, we do not. Quotes go on the drive, agreements go in the chat, and
whatever was urgent sits in somebody's mail. To find it you have to know who
was in the room at the time.

**3 · Interviewer [0:58]**

And when that person is away?

**4 · Sales [1:10]**

Then I put the state of it back together out of old messages. That costs me
half a morning, and at the end I am still not certain I have the current
version.

## Section: 2 · Handover (what gets passed on)

**5 · Interviewer [2:03]**

How do you hand a case over to someone else?

**6 · Sales [2:15]**

By talking. I tell them what matters and hope it sticks. None of it gets
written down; there is no time for that alongside the day's work.

**7 · Interviewer [2:52]**

What would you want at that point?

**8 · Sales [3:04]**

A search that covers everything, and one place where the current state lives.
Nothing more than that. We have tried everything else three times over.
`,
};

export function exampleTranscript(language) {
  return TRANSCRIPTS[language] ?? TRANSCRIPTS.en;
}
