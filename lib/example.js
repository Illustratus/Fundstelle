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

/**
 * Two more voices, so that the example is a study and not an interview.
 *
 * One interview showed the coding surface and almost nothing else: a cross
 * table with a single column, no saturation curve — it needs three — and a
 * co-occurrence with nothing to compare. Somebody trying the tool coded four
 * passages, opened the analysis and saw a bar chart of one department, which
 * undersells the half of the tool that is worth choosing it for.
 *
 * Three departments that say overlapping things in different words: filing and
 * retrieval come up in all three, handing over only in two, so the cross table
 * has a shape, the categories have somewhere to meet, and the saturation curve
 * has three points to make.
 *
 * They arrive uncoded. The tool has never invented a coding and should not
 * start on the screen where somebody is deciding whether to trust it.
 */
const MORE = {
  de: [
    {
      folder: "beispiel-marketing",
      text: `# Interview 2: Marketing

- Erhebung: 4. August 2026
- Quelle: Beispiel, kein echtes Interview

---

## Erzählanstoß: 1 · Ablage (wo etwas landet)

**1 · Interviewer [0:06]**

Wo legen Sie ab, was bei Ihnen entsteht?

**2 · Marketing [0:19]**

Bilder und Vorlagen in einem Ordner, den ehrlich gesagt nur ich kenne. Texte
gehen per Mail raus und liegen danach nirgendwo mehr richtig.

**3 · Interviewer [0:51]**

Und wenn eine Kollegin etwas davon braucht?

**4 · Marketing [1:04]**

Dann fragt sie mich. Das ist bequem, solange ich da bin, und ein Problem an
jedem Tag, an dem ich es nicht bin.

## Erzählanstoß: 2 · Übergabe (was weitergegeben wird)

**5 · Interviewer [2:11]**

Was geben Sie weiter, wenn eine Kampagne abgeschlossen ist?

**6 · Marketing [2:24]**

Die Ergebnisse im Meeting. Danach verschwindet die Folie in einem Ordner, und
im Zweifel baut jemand das nächste Mal alles noch einmal auf.
`,
    },
    {
      folder: "beispiel-kundenservice",
      text: `# Interview 3: Kundenservice

- Erhebung: 5. August 2026
- Quelle: Beispiel, kein echtes Interview
- Leitfaden: Anstöße 1 und 3; Anstoß 2 kam von selbst zur Sprache

---

## Erzählanstoß: 1 · Ablage (wo etwas landet)

**1 · Interviewer [0:04]**

Wie finden Sie wieder, was Sie einmal beantwortet haben?

**2 · Kundenservice [0:17]**

Über die Suche, wenn sie mitspielt. Meistens kommen Protokolle von vor zwei
Jahren, aber nicht die Fassung, die gerade gilt.

**3 · Interviewer [0:46]**

Woran merken Sie, dass eine Fassung veraltet ist?

**4 · Kundenservice [0:58]**

Daran, dass die Kundin widerspricht. Vorher merkt man es nicht, weil nirgends
steht, wann etwas zuletzt geprüft wurde.

## Erzählanstoß: 3 · Wünsche an ein Werkzeug

**5 · Interviewer [1:52]**

Was müsste ein Werkzeug können, damit es Ihnen hilft?

**6 · Kundenservice [2:05]**

Mir sagen, was aktuell ist, und mir die Fassung zeigen, ohne dass ich jemanden
fragen muss. Der Rest ergibt sich.
`,
    },
  ],
  en: [
    {
      folder: "example-marketing",
      text: `# Interview 2: Marketing

- Conducted: 4 August 2026
- Source: Example, not a real interview

---

## Section: 1 · Filing (where things land)

**1 · Interviewer [0:06]**

Where do you file what you produce?

**2 · Marketing [0:19]**

Images and templates in a folder that honestly only I know about. Copy goes out
by mail and afterwards it is nowhere in particular.

**3 · Interviewer [0:51]**

And when a colleague needs some of it?

**4 · Marketing [1:04]**

Then she asks me. Which is convenient as long as I am here, and a problem on
every day that I am not.

## Section: 2 · Handing over (what gets passed on)

**5 · Interviewer [2:11]**

What do you pass on when a campaign is finished?

**6 · Marketing [2:24]**

The results, in the meeting. After that the slide disappears into a folder, and
next time somebody probably builds the whole thing again.
`,
    },
    {
      folder: "example-support",
      text: `# Interview 3: Customer service

- Conducted: 5 August 2026
- Source: Example, not a real interview
- Guide: prompts 1 and 3; prompt 2 came up on its own

---

## Section: 1 · Filing (where things land)

**1 · Interviewer [0:04]**

How do you find what you have answered before?

**2 · Customer service [0:17]**

Through the search, when it cooperates. Mostly it brings up minutes from two
years ago rather than the version that holds now.

**3 · Interviewer [0:46]**

How do you notice that a version is out of date?

**4 · Customer service [0:58]**

Because the customer contradicts it. You cannot tell beforehand, since nowhere
does it say when something was last checked.

## Section: 3 · What a tool would have to do

**5 · Interviewer [1:52]**

What would a tool have to do to help you?

**6 · Customer service [2:05]**

Tell me what is current, and show me that version without my having to ask
anybody. The rest follows from that.
`,
    },
  ],
};

export function exampleTranscript(language) {
  return TRANSCRIPTS[language] ?? TRANSCRIPTS.en;
}

/**
 * Every interview the example writes, folder and text.
 *
 * The first keeps the folder name it has always had, so a study that already
 * holds one is not given a second copy of it under another name.
 */
export function exampleStudy(language) {
  const wanted = MORE[language] ? language : "en";
  return [
    { folder: EXAMPLE_FOLDER, text: exampleTranscript(language) },
    ...MORE[wanted],
  ];
}
