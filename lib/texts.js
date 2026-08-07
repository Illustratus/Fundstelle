/**
 * Texts the server writes, one place per language.
 *
 * Two kinds of text leave the server: the prose of the Markdown exports and the
 * error messages the interface shows verbatim. Both used to be German only,
 * which made the bilingual interface a half-truth — an English reader got
 * German errors and German exports.
 *
 * The language is negotiated per request, by the same rule the interface
 * follows: an explicit wish (`?lang=…`) beats the browser's preference
 * (`Accept-Language`), and whoever brings neither gets English as the
 * international default. The interface sends its own language along, so the
 * exports come out in the language the tool was operated in.
 *
 * German is the complete reference; where a key is missing in a language the
 * German wording steps in. The keys are English, the values are not.
 */

export const LANGUAGES = ["de", "en"];

export const FALLBACK = "en";

/**
 * The language of one request: the explicit wish first, then the browser's
 * preference, then the international default.
 *
 * `Accept-Language` is read as a plain preference order; the quality values are
 * honoured, because a browser set to `de` with `en;q=0.9` in tow means the
 * first one.
 */
export function negotiate(wanted, acceptLanguage = "") {
  if (LANGUAGES.includes(wanted)) return wanted;
  const offered = String(acceptLanguage)
    .split(",")
    .map((part) => {
      const [tag, ...parameters] = part.trim().split(";");
      const quality = parameters
        .map((parameter) => parameter.trim().match(/^q=([\d.]+)$/)?.[1])
        .find(Boolean);
      return { tag: tag.trim().slice(0, 2).toLowerCase(), quality: Number(quality ?? 1) };
    })
    .filter((entry) => LANGUAGES.includes(entry.tag) && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);
  return offered[0]?.tag ?? FALLBACK;
}

/** A `t(key, values)` bound to one language. */
export function translator(language) {
  const chosen = LANGUAGES.includes(language) ? language : FALLBACK;
  return (key, values) => {
    let text = TEXTS[chosen]?.[key] ?? TEXTS.de[key] ?? key;
    for (const [name, value] of Object.entries(values ?? {})) {
      text = text.replaceAll(`{${name}}`, value);
    }
    return text;
  };
}

/**
 * An error that names its message instead of carrying it.
 *
 * The storage layer does not know which language the request came in, and it
 * should not have to: it throws the key, and the request that catches it
 * translates. `message` stays the key, so a stack trace in the log still says
 * what went wrong without depending on a language.
 */
export function fail(key, params) {
  return Object.assign(new Error(key), { key, params });
}

/** Quotation marks belong to the language, not to the template. */
export function quoted(t, text) {
  return `${t("quoteOpen")}${text}${t("quoteClose")}`;
}

export const TEXTS = {
  de: {
    quoteOpen: "„",
    quoteClose: "“",

    /* Errors --------------------------------------------------------------- */
    errorCategoryName: "Die Kategorie braucht einen Namen",
    errorFieldMissing: "Feld {field} fehlt",
    errorEmptySelection: "Leere Auswahl",
    errorUnknownEndpoint: "Unbekannter Endpunkt",
    errorUnknownFigure: "Diese Abbildung gibt es nicht. Vorhanden sind: {figures}",
    /* Eine Abbildung, die es gibt, aber noch nichts zu zeichnen hat, ist kein
       Fehler der Adresse, sondern ein Stand der Arbeit — und die Antwort sagt,
       welche Bedingung noch fehlt. */
    figureNeedsCodings:
      "Noch keine Kodiereinheiten. Die Abbildung entsteht, sobald in mindestens einem Interview kodiert wurde.",
    figureNeedsSections:
      "Dafür braucht es einen Leitfaden mit mindestens zwei Abschnitten und Kodiereinheiten darin.",
    figureNeedsInterviews:
      "Die Sättigungskurve braucht mindestens drei kodierte Interviews; auf zweien wäre sie eine Behauptung.",
    figureNeedsRequirements:
      "Noch keine Anforderungen im Katalog. Anforderungen entstehen aus Zitaten in der Kodieransicht.",
    figureNeedsCitations:
      "Noch keine Anforderung, die von einem Zitat getragen wird.",
    errorForeignOrigin:
      "Diese Anfrage kam von einer anderen Seite. Änderungen nimmt Fundstelle nur von der eigenen Oberfläche an.",
    errorUnexpected:
      "Unerwarteter Fehler. Was genau passiert ist, steht im Terminal, in dem die Anwendung läuft.",
    errorExampleNotEmpty: "Es liegen schon Interviews im Transkriptordner. Das Beispiel wird nur auf einem leeren Ordner angelegt.",
    errorRulesList: "Kodierregeln müssen eine Liste sein",
    errorDeductiveStaysPut:
      "Deduktive Kategorien stehen vor der Erhebung fest und bleiben, wo sie sind",
    errorSelfParent: "Eine Kategorie lässt sich nicht sich selbst unterordnen",
    errorUnknownCategory: "Unbekannte Kategorie",
    errorCodebookUnreadable:
      "Diese Datei ließ sich nicht als REFI-QDA-Codesystem lesen. Erwartet wird eine .qdc oder eine .qdpx.",
    errorCodebookEmpty: "In dieser Datei steht kein einziger Code.",
    errorCoderName: "Für die Zweitkodierung fehlt ein Name, aus dem ein Dateiname werden kann.",
    errorBundleUnreadable:
      "Diese Datei ist keine übergebene Kodierung aus Fundstelle.",
    errorUnknownInterview: "Dieses Interview gibt es nicht.",
    errorTwoLevels:
      "Das Kategoriensystem bleibt zweistufig: unter einer Unterkategorie ist kein Platz",
    errorHasChildren:
      "Diese Kategorie hat selbst Unterkategorien und kann nicht untergeordnet werden",
    errorStartSystemUnreadable: "Startsystem {file} ist nicht lesbar: {reason}",
    errorStartSystemEmpty: "Das Startsystem braucht eine nicht leere Liste „categories“",
    errorStartSystemFields:
      "Jede Startkategorie braucht id, name und definition (fehlt bei „{name}“)",
    errorStartSystemUnknownParent:
      "„{name}“ ist „{parent}“ untergeordnet, aber eine Kategorie mit dieser id " +
      "gibt es im Startsystem nicht.",
    errorStartSystemThreeLevels:
      "„{name}“ ist „{parent}“ untergeordnet, das selbst schon untergeordnet ist. " +
      "Das Kategoriensystem bleibt zweistufig.",
    errorStartSystemSelfParent: "„{name}“ ist sich selbst untergeordnet.",
    errorCategoryExists: "Kategorie existiert bereits",
    errorDefinitionRequired: "Eine Kategorie ohne Definition ist nicht kodierbar",
    errorSelfMergeCategory: "Eine Kategorie lässt sich nicht mit sich selbst verschmelzen",
    errorDeductiveStays:
      "Deduktive Kategorien sind vor der Erhebung festgelegt und bleiben bestehen",
    errorCategoryInUse: "Kategorie trägt {used} Kodierungen und kann nicht entfallen",
    errorUnknownCoding: "Unbekannte Kodierung",
    errorOverlap: "Die Auswahl überschneidet eine bestehende Kodiereinheit",
    errorInterviewerTurn:
      "Beitrag {turn} stammt vom Interviewer. Kodiert werden die Aussagen der Befragten.",
    errorUnknownTurn: "Beitrag {turn} gibt es in diesem Transkript nicht.",
    errorRequirementTitle: "Die Anforderung braucht einen Titel",
    errorUnknownRequirement: "Unbekannte Anforderung",
    errorSelfMergeRequirement: "Eine Anforderung lässt sich nicht mit sich selbst verschmelzen",
    errorPropositionName: "Die Proposition braucht einen Wortlaut",
    errorPropositionExists: "Eine Proposition mit diesem Wortlaut gibt es bereits",
    errorUnknownProposition: "Unbekannte Proposition",
    errorPropositionStays:
      "„Aus dem Erkenntnisinteresse abgeleitet“ ist die Proposition, auf die " +
      "Kategorien ohne eigene fallen, und bleibt deshalb bestehen. Wortlaut und " +
      "Farbe lassen sich ändern.",
    errorPropositionFollowsParent:
      "Eine Unterkategorie trägt die Proposition ihrer Oberkategorie: Die " +
      "Unterscheidung wird unter der Proposition gezogen, die darüber steht.",
    errorColorShape: "„{color}“ ist keine Farbe. Erwartet wird #1a2b3c oder #abc.",
    errorOperationName: "Die Operation braucht einen Namen",
    errorOperationExists: "Eine Operation mit diesem Namen gibt es bereits",
    errorUnknownOperation: "Unbekannte Operation",
    errorOperationsList: "Blockierte Operationen werden als Liste erwartet",
    errorInterviewExists: "Den Ordner {folder} gibt es bereits",
    errorMetaObject: "Die Kopfzeilen werden als Objekt aus Feld und Wert erwartet",
    errorDataNotWritable:
      "In den Ordner {path} lässt sich nicht schreiben. Nichts ist verloren, aber " +
      "auch nichts gespeichert: Der Ordner gehört einem anderen Benutzer oder ist " +
      "schreibgeschützt eingebunden.",
    errorDataFull: "Auf dem Laufwerk von {path} ist kein Platz mehr. Nichts wurde gespeichert.",
    errorBusy: "Ein anderer Zugriff auf {path} hält gerade an. Bitte noch einmal versuchen.",

    /* Re-anchoring after the transcript was corrected -------------------- */
    anchorTurnGone: "Beitrag {turn} steht nicht mehr im Transkript.",

    /* What the transcript could not be read as ---------------------------- */
    transcriptDuplicateTurn:
      "Beitrag {turn} kommt mehrfach vor (Zeile {line}). Kodierungen halten sich " +
      "an der Beitragsnummer fest; doppelte Nummern machen jede Fundstelle darauf " +
      "mehrdeutig.",
    transcriptUnreadTurn:
      "Zeile {line} sieht aus wie ein Beitrag, wurde aber nicht als einer gelesen: " +
      "{text} — erwartet wird **7 · Name [3:18]**. Der Text darunter fehlt deshalb.",
    transcriptNoTurns:
      "In dieser Datei wurde kein einziger Beitrag gefunden. Erwartet wird " +
      "**7 · Name [3:18]** als eigene Zeile, der Text als Absatz darunter.",
    /* Bringing a recording's transcript in ---------------------------------- */
    importUsage:
      "Transkript einlesen und in das Format bringen, das Fundstelle liest.\n\n" +
      "  node tools/import-transcript.mjs <datei> [optionen]\n\n" +
      "  --interviewer <name>   Wer fragt. Ohne diese Angabe wird nichts geschrieben,\n" +
      "                         sondern nur gesagt, welche Sprechenden in der Datei stehen.\n" +
      "  --department <name>    Bereich, dem die Aussagen zugerechnet werden\n" +
      "  --title <text>         Überschrift, z. B. „Interview 3: Vertrieb“\n" +
      "  --folder <name>        Ordnername; sonst aus der Überschrift gebildet\n" +
      "  --into <pfad>          Transkriptordner (Vorgabe: $TRANSCRIPTS)\n" +
      "  --date <text>          Erhebungsdatum für den Kopf der Datei\n" +
      "  --note <text>          Ein Satz unter die Überschrift\n" +
      "  --format vtt|srt|speakers   Sonst wird am Inhalt erkannt\n" +
      "  --dry                  Nur zeigen, was geschrieben würde\n",
    importNoFile: "Die Datei {file} gibt es nicht.",
    importNothingRead:
      "Aus {file} ließ sich kein einziger Beitrag lesen. Erwartet wird eine " +
      "WebVTT- oder SRT-Datei oder ein Text, dessen Zeilen mit einem Namen und " +
      "einem Doppelpunkt beginnen.",
    importRead: "Gelesen als {format}: {turns} Beiträge.",
    importSpeakers: "Sprechende in der Datei: {speakers}.",
    importNoSpeakers:
      "Die Datei nennt keine Sprechenden. Ohne Namen lässt sich nicht trennen, " +
      "wer fragt und wer antwortet.",
    importWhoAsks:
      "Wer von ihnen fragt? Das wird nicht geraten: Die Beiträge der fragenden " +
      "Person sind nicht kodierbar, ein falscher Griff nähme also entweder das " +
      "halbe Material heraus oder böte die Fragen als Befunde an.\n\n" +
      "  … --interviewer \"{first}\" --department \"Vertrieb\"",
    importWouldWrite: "Geschrieben würde {file}:",
    importExists:
      "{file} gibt es schon. Kodierungen halten sich an den Beitragsnummern " +
      "dieser Datei fest; sie zu überschreiben würde jede Fundstelle darin " +
      "verschieben. Erst umbenennen oder --folder angeben.",
    importWrote: "{file} geschrieben, {turns} Beiträge.",
    importNextSection:
      "Erzählanstöße trägt die Datei noch keine — sie stehen im Leitfaden, nicht " +
      "in der Aufnahme. „## Erzählanstoß: Name“ als eigene Zeile ergänzt sie; " +
      "ohne sie funktioniert alles außer der Blockleiste.",
    codingTableDisplaced:
      "{n} Kodiereinheiten stehen hier nicht: Ihre Textstelle wurde geändert und " +
      "ließ sich nicht eindeutig wiederfinden. Sie sind im Werkzeug markiert und " +
      "warten auf eine neue Verankerung; bis dahin zählen sie nirgends mit.",
    metaSurvey: "Erhebung",
    importRespondent: "Befragte",
    importDefaultTitle: "Interview",
    importExistsShort:
      "Den Ordner {folder} gibt es schon. Kodierungen halten sich an den " +
      "Beitragsnummern der Datei darin fest; sie zu überschreiben würde jede " +
      "Fundstelle darin verschieben. Bitte einen anderen Ordnernamen wählen.",

    /* The analysis as a document ------------------------------------------ */
    analysisDocTitle: "Auswertung",
    analysisDocLead:
      "Erzeugt vom Kodierwerkzeug aus dem Stand der Kodierung. Die Zahlen sind " +
      "dieselben, die die Auswertung auf dem Bildschirm zeichnet.",
    analysisDocFigures:
      "{units} Kodiereinheiten, davon {reviewed} geprüft, in {categories} " +
      "Kategorien über {interviews} Interviews und {departments} Bereiche.",
    analysisDocDisplaced:
      "{n} Kodiereinheiten haben ihren Platz im Transkript verloren und zählen " +
      "in keiner dieser Zahlen mit.",
    analysisDocSaturation:
      "Je Interview, in der Reihenfolge der Ordnernamen — nicht zwingend der der " +
      "Erhebung: wie viele Kategorien zum ersten Mal vorkamen und wie viele bis " +
      "dahin im Spiel waren. Ob die Kurve flach genug ist, entscheidet niemand " +
      "außer dir.",
    progressPerInterview: "Stand je Interview",
    turnsTouched: "Beiträge berührt",
    chartSaturationTitle: "Wann kam nichts Neues mehr",
    saturationFresh: "Zum ersten Mal",
    saturationTotal: "Insgesamt",
    saturationWhich: "Welche zum ersten Mal",
    meetTitle: "Kategorien, die zusammen auftreten",
    meetNote:
      "Je Beitrag gezählt: in wie vielen Beiträgen beide Kategorien vergeben " +
      "wurden. Ein schwaches Signal, und als solches gemeint — zwei Kategorien, " +
      "die im Material zusammengehören, sehen hier genauso aus wie zwei, die nie " +
      "auseinandergehalten wurden. Wo der Anteil hoch ist, lohnt eine Kodierregel " +
      "an der Abgrenzung.",
    meetNone:
      "Keine zwei Kategorien wurden im selben Beitrag vergeben. Für die " +
      "Trennschärfe des Systems ist das das gute Ergebnis.",
    meetPair: "Kategorien",
    meetTogether: "Gemeinsame Beiträge",
    meetShare: "Anteil",
    meetOf: "Bezogen auf",
    meetOfWhich: "{name} steht in {n} Beiträgen",

    /* The sample, as a thesis has to describe it ------------------------- */
    sampleTitle: "Stichprobe",
    projectName: "Fundstelle-Studie",
    sampleLead:
      "Erzeugt vom Kodierwerkzeug aus den Kopfzeilen der Transkripte. Die Spalten " +
      "sind das, was die Transkripte an Angaben tragen; ein Feld, das ein " +
      "Interview führt und ein anderes nicht, bleibt leer. Die letzten beiden " +
      "Spalten zählt das Werkzeug: kodierbare Beiträge und Kodiereinheiten.",
    sampleNoFields:
      "Die Transkripte tragen bisher keine Angaben. Zeilen der Form " +
      "„- Rolle: Führungskraft“ unter der Überschrift werden als Spalten " +
      "übernommen.",
    interview: "Interview",
    department: "Bereich",
    columnTurns: "Beiträge",
    metricUnits: "Kodiereinheiten",

    /* Intercoder reliability ---------------------------------------------- */
    agreementDocTitle: "Intercoderreliabilität",
    agreementDocLead:
      "Erzeugt vom Kodierwerkzeug aus dem Stand der Kodierung und einer daneben " +
      "abgelegten Zweitkodierung.",
    agreementDocNone:
      "Für dieses Material liegt keine Zweitkodierung vor. Die coding.json der " +
      "zweitkodierenden Person gehört als coding.NAME.json neben die eigene.",
    agreementDocUnit:
      "Verglichen wird je Beitrag und Kategorie: Hat die eine Person diese Kategorie " +
      "irgendwo in diesem Beitrag vergeben, hat es die andere auch? Diese Einheit " +
      "überlebt unterschiedliche Segmentierung; wo genau geschnitten wurde, zählt " +
      "nicht als inhaltliche Abweichung. Cohens κ steht neben der rohen " +
      "Übereinstimmung und den vier Feldern, aus denen es gerechnet ist: Bei stark " +
      "ungleicher Randverteilung fällt κ, obwohl die beiden fast überall gleich " +
      "urteilen — eine Eigenschaft des Maßes, keine der Kodierung.",
    agreementDocWith: "Zweitkodierung „{coder}“",
    agreementDocFigures:
      "Cohens κ = {kappa} ({band}), rohe Übereinstimmung {agreement} über {units} " +
      "verglichene Einheiten. Verglichen wurde: {interviews}.",
    agreementDocSkipped:
      "Ohne Zweitkodierung und deshalb außen vor: {interviews}.",
    agreementDocApart: "Beiträge, in denen die beiden auseinandergehen",
    category: "Kategorie",
    turn: "Beitrag",
    agreementCell: "Feld",
    agreementCount: "Anzahl",
    agreementBoth: "Beide vergeben",
    agreementNeither: "Beide nicht vergeben",
    agreementOnlyFirst: "Nur diese Kodierung",
    agreementOnlySecond: "Nur „{coder}“",
    agreementApart: "Auseinander",
    agreementKappa: "Cohens κ",
    agreementApartNone: "In keinem Beitrag gehen die beiden auseinander.",
    agreementSideHere: "hier {categories}",
    agreementSideThere: "bei „{coder}“ {categories}",
    agreementNothing: "nichts",
    agreementBandNone: "keine Übereinstimmung über den Zufall hinaus",
    agreementBandSlight: "geringe Übereinstimmung",
    agreementBandFair: "ausreichende Übereinstimmung",
    agreementBandModerate: "mittlere Übereinstimmung",
    agreementBandSubstantial: "deutliche Übereinstimmung",
    agreementBandAlmost: "nahezu vollständige Übereinstimmung",
    agreementFileUnreadable:
      "{file} in {interview} konnte nicht gelesen werden und bleibt aus dem Vergleich "
      + "heraus. Erwartet wird dieselbe Datei, die Fundstelle als coding.json schreibt.",
    anchorAmbiguous: "Der Beleg steht mehrfach im Beitrag, die Stelle ist nicht mehr eindeutig.",
    anchorNotFound: "Der Beleg steht so nicht mehr im Beitrag.",
    anchorWouldOverlap:
      "Der Beleg stünde jetzt über einer anderen Kodiereinheit. Eine Stelle trägt " +
      "genau eine Kategorie, deshalb bleibt die Zuordnung offen.",

    /* Coding guide --------------------------------------------------------- */
    guideTitle: "Kodierleitfaden",
    guideLead:
      "Erzeugt vom Kodierwerkzeug aus dem Stand der Kodierung. Die deduktiven " +
      "Definitionen stammen aus dem Kategoriensystem vor der Erhebung; " +
      "Ankerbeispiele und Kodierregeln sind am Material entstanden. Wo eine " +
      "Definition in der Rücküberprüfung geschärft wurde, steht der Wortlaut vor " +
      "der Schärfung mit dabei.",
    originDeductive: "deduktiv",
    originInductive: "induktiv",
    fieldDefinition: "Definition",
    placeholderDefinition: "[PLATZHALTER: Definition]",
    placeholderAnchor: "[FEHLT: Ankerbeispiel — im Werkzeug eine Fundstelle als Anker markieren]",
    fieldBeforeSurvey: "Vor der Erhebung",
    fieldOnCreation: "Beim Anlegen",
    sharpenedOnMaterial: "{definition} — am Material geschärft.",
    fieldAnchor: "Ankerbeispiel",
    fieldAnchorNumbered: "Ankerbeispiel {n}",
    fieldRule: "Kodierregel",
    fieldRuleNumbered: "Kodierregel {n}",
    anchorSource: "{department}, Beitrag {turn}",
    unreviewedSuffix: ", ungeprüft",

    /* Citations ------------------------------------------------------------ */
    citationsTitle: "Belege",
    sliceDepartment: "Bereich {name}",
    sliceSection: "Erzählanstoß {name}",
    sliceAnchor: "nur Ankerbeispiele",
    sliceMemo: "nur mit Notiz",
    sliceOpen: "noch ohne Anforderung",
    sliceUnreviewed: "nur ungeprüfte",
    sliceWord: "Wortlaut {word}",
    sliceLead: "Schnitt: {named}.",
    sliceAll: "Alle Kodiereinheiten, ohne Einschränkung.",
    citationSource: "{department}, Beitrag {turn}",
    citationAnchor: ", Ankerbeispiel",
    citationUnreviewed: " **[ungeprüft]**",
    citationNote: "Notiz: {note}",
    citationsNone: "Kein Beleg passt zu diesem Schnitt.",

    /* Notes ---------------------------------------------------------------- */
    notesTitle: "Notizen zum Kodiervorgang",
    notesLead: "Erzeugt vom Kodierwerkzeug. Arbeitsnotizen, keine Ergebnisdarstellung.",
    notesOnInterviews: "Zu den Interviews",
    notesOnCategories: "Zu den Kategorien",
    notesOnPassages: "Zu einzelnen Fundstellen",
    notesDefinitionBefore: "Definition vor der Erhebung",
    notesDefinitionOnCreation: "Definition beim Anlegen",
    notesNone: "Noch keine Notizen festgehalten.",

    /* Coding table --------------------------------------------------------- */
    codingTableTitle: "Kodiertabelle {title}",
    codingTableLead: "Bereich: {department}. Kodierungen: {total}, davon {reviewed} geprüft.",
    codingTableWarning: "Eine ungeprüfte Zuordnung ist ein Vorschlag und belegt nichts.",
    stateReviewed: "geprüft",
    stateUnreviewed: "**ungeprüft**",

    /* Cross table ---------------------------------------------------------- */
    matrixTitle: "Kategorien nach Bereich",
    matrixLead:
      "Kodiereinheiten je Kategorie und Bereich. Die Spalte „Bereiche“ zählt, wie " +
      "viele der befragten Bereiche eine Kategorie überhaupt ansprechen; sie trägt " +
      "in die Priorisierung des Anforderungskatalogs.",

    /* Requirements catalog ------------------------------------------------- */
    catalogTitle: "Priorisierter Anforderungskatalog",
    catalogLead:
      "Erzeugt aus den Kodierungen. Die Spalte „Bereiche“ zählt, wie viele der " +
      "befragten Bereiche die Anforderung ansprechen; „blockiert“ nennt die " +
      "Operationen, deren Ausbleiben die Anforderung nach Einschätzung des " +
      "Verfassers verhindert. Beide zusammen tragen die MoSCoW-Stufe.",
    catalogNamedBy: "Genannt von: {departments}.",
    catalogNamedByNobody: "noch keinem Bereich",
    catalogCitations: "**Belege.**",
    catalogUnreviewed: "Davon sind {n} von {total} Belegen noch ungeprüft und belegen nichts.",
    moscowOpen: "offen",
    operationFiling: "Ablage",
    operationRetrieval: "Abruf",
    operationTransfer: "Transfer",

    /* Column headings ------------------------------------------------------ */
    columnPassage: "Fundstelle",
    columnSection: "Block",
    columnCategory: "Kategorie",
    columnState: "Stand",
    columnCitation: "Beleg",
    columnNote: "Notiz",
    columnRequirement: "Anforderung",
    columnMoscow: "MoSCoW",
    columnDepartments: "Bereiche",
    columnCitations: "Belege",
    columnBlocks: "blockiert",
    columnTotal: "Summe",
  },

  en: {
    quoteOpen: "“",
    quoteClose: "”",

    /* Errors --------------------------------------------------------------- */
    errorCategoryName: "The category needs a name",
    errorFieldMissing: "Field {field} is missing",
    errorEmptySelection: "Empty selection",
    errorUnknownEndpoint: "Unknown endpoint",
    errorUnknownFigure: "There is no such figure. Available: {figures}",
    figureNeedsCodings:
      "No coding units yet. The figure appears as soon as something has been coded in at least one interview.",
    figureNeedsSections:
      "This needs an interview guide with at least two sections, and coding units inside them.",
    figureNeedsInterviews:
      "The saturation curve needs at least three coded interviews; on two it would be a claim, not a finding.",
    figureNeedsRequirements:
      "No requirements in the catalog yet. Requirements are made from citations in the coding view.",
    figureNeedsCitations: "No requirement is carried by a citation yet.",
    errorForeignOrigin:
      "This request came from another site. Fundstelle only accepts changes from its own interface.",
    errorUnexpected:
      "Unexpected error. What exactly went wrong is in the terminal running the tool.",
    errorExampleNotEmpty: "There are already interviews in the transcript folder. The example is only written into an empty one.",
    errorRulesList: "Coding rules have to be a list",
    errorDeductiveStaysPut:
      "Deductive categories are fixed before the survey and stay where they are",
    errorSelfParent: "A category cannot be subordinated to itself",
    errorUnknownCategory: "Unknown category",
    errorCodebookUnreadable:
      "This file could not be read as a REFI-QDA code system. A .qdc or a .qdpx is expected.",
    errorCodebookEmpty: "There is not a single code in this file.",
    errorCoderName: "The second coding needs a name that can become a file name.",
    errorBundleUnreadable:
      "This file is not a coding handed over from Fundstelle.",
    errorUnknownInterview: "There is no such interview.",
    errorTwoLevels:
      "The category system stays two-level: there is no room below a subcategory",
    errorHasChildren: "This category has subcategories of its own and cannot be subordinated",
    errorStartSystemUnreadable: "Start system {file} cannot be read: {reason}",
    errorStartSystemEmpty: "The start system needs a non-empty “categories” list",
    errorStartSystemFields:
      "Every start category needs id, name and definition (missing on “{name}”)",
    errorStartSystemUnknownParent:
      "“{name}” is placed under “{parent}”, but no category with that id exists " +
      "in the start system.",
    errorStartSystemThreeLevels:
      "“{name}” is placed under “{parent}”, which is itself already a " +
      "sub-category. The category system stays two levels deep.",
    errorStartSystemSelfParent: "“{name}” is placed under itself.",
    errorCategoryExists: "Category already exists",
    errorDefinitionRequired: "A category without a definition cannot be coded with",
    errorSelfMergeCategory: "A category cannot be merged with itself",
    errorDeductiveStays: "Deductive categories are fixed before the survey and remain",
    errorCategoryInUse: "Category carries {used} codings and cannot be dropped",
    errorUnknownCoding: "Unknown coding",
    errorOverlap: "The selection overlaps an existing coding unit",
    errorInterviewerTurn:
      "Turn {turn} is the interviewer's. Coding applies to the respondents' statements.",
    errorUnknownTurn: "There is no turn {turn} in this transcript.",
    errorRequirementTitle: "The requirement needs a title",
    errorUnknownRequirement: "Unknown requirement",
    errorSelfMergeRequirement: "A requirement cannot be merged with itself",
    errorPropositionName: "The proposition needs a wording",
    errorPropositionExists: "A proposition with this wording already exists",
    errorUnknownProposition: "Unknown proposition",
    errorPropositionStays:
      "“Derived from the research interest” is the proposition categories " +
      "without one of their own fall back to, and therefore stays. Its wording " +
      "and colour can be changed.",
    errorPropositionFollowsParent:
      "A subcategory carries its parent's proposition: the distinction is drawn " +
      "under the proposition that stands above it.",
    errorColorShape: "“{color}” is not a colour. Expected #1a2b3c or #abc.",
    errorOperationName: "The operation needs a name",
    errorOperationExists: "An operation with this name already exists",
    errorUnknownOperation: "Unknown operation",
    errorOperationsList: "Blocked operations are expected as a list",
    errorInterviewExists: "The folder {folder} already exists",
    errorMetaObject: "The header lines are expected as an object of field and value",
    errorDataNotWritable:
      "The folder {path} cannot be written to. Nothing is lost, but nothing is " +
      "saved either: the folder belongs to another user or is mounted read-only.",
    errorDataFull: "The drive holding {path} is full. Nothing was saved.",
    errorBusy: "Something else is holding {path} just now. Please try again.",

    /* Re-anchoring after the transcript was corrected -------------------- */
    anchorTurnGone: "Turn {turn} is no longer in the transcript.",

    /* What the transcript could not be read as ---------------------------- */
    transcriptDuplicateTurn:
      "Turn {turn} occurs more than once (line {line}). Codings hold on to the turn " +
      "number; a number used twice makes every citation on it ambiguous.",
    transcriptUnreadTurn:
      "Line {line} looks like a turn but was not read as one: {text} — the form " +
      "expected is **7 · Name [3:18]**. The text below it is missing as a result.",
    transcriptNoTurns:
      "Not a single turn was found in this file. The form expected is " +
      "**7 · Name [3:18]** on a line of its own, with the text as a paragraph below.",
    /* Bringing a recording's transcript in ---------------------------------- */
    importUsage:
      "Read a transcript and put it into the shape Fundstelle reads.\n\n" +
      "  node tools/import-transcript.mjs <file> [options]\n\n" +
      "  --interviewer <name>   Who is asking. Without it nothing is written; the\n" +
      "                         speakers found in the file are listed instead.\n" +
      "  --department <name>    What the answers are attributed to\n" +
      "  --title <text>         Heading, e.g. \"Interview 3: Sales\"\n" +
      "  --folder <name>        Folder name; otherwise made from the heading\n" +
      "  --into <path>          Transcript folder (default: $TRANSCRIPTS)\n" +
      "  --date <text>          Date of the interview, for the file header\n" +
      "  --note <text>          One sentence under the heading\n" +
      "  --format vtt|srt|speakers   Otherwise decided on the content\n" +
      "  --dry                  Only show what would be written\n",
    importNoFile: "There is no file {file}.",
    importNothingRead:
      "Not a single turn could be read out of {file}. What is expected is a " +
      "WebVTT or SRT file, or a text whose lines begin with a name and a colon.",
    importRead: "Read as {format}: {turns} turns.",
    importSpeakers: "Speakers in the file: {speakers}.",
    importNoSpeakers:
      "The file names no speakers. Without names there is no way to tell who is " +
      "asking from who is answering.",
    importWhoAsks:
      "Which of them is asking? This is not guessed: the interviewer's turns " +
      "cannot be coded, so a wrong guess would either take half the material out " +
      "or offer the questions up as findings.\n\n" +
      "  … --interviewer \"{first}\" --department \"Sales\"",
    importWouldWrite: "This would be written to {file}:",
    importExists:
      "{file} already exists. Codings hold on to the turn numbers in that file, " +
      "so overwriting it would move every citation in the interview. Rename it " +
      "first, or pass --folder.",
    importWrote: "Wrote {file}, {turns} turns.",
    importNextSection:
      "The file carries no guide sections yet — they belong to the interview " +
      "guide, not to the recording. A line of the form \"## Section: Name\" adds " +
      "them; everything except the section bar works without them.",
    codingTableDisplaced:
      "{n} coding units are missing here: their passage was changed and could " +
      "not be found again unambiguously. They are marked in the tool and are " +
      "waiting to be anchored again; until then they count nowhere.",
    metaSurvey: "Survey",
    importRespondent: "Respondent",
    importDefaultTitle: "Interview",
    importExistsShort:
      "The folder {folder} already exists. Codings hold on to the turn numbers " +
      "in the file inside it, so overwriting it would move every citation in " +
      "that interview. Please pick another folder name.",

    /* The analysis as a document ------------------------------------------ */
    analysisDocTitle: "Analysis",
    analysisDocLead:
      "Generated by the coding tool from the state of the coding. The figures are " +
      "the ones the analysis draws on the screen.",
    analysisDocFigures:
      "{units} coding units, {reviewed} of them reviewed, in {categories} " +
      "categories across {interviews} interviews and {departments} departments.",
    analysisDocDisplaced:
      "{n} coding units have lost their place in the transcript and count in none " +
      "of these figures.",
    analysisDocSaturation:
      "Per interview, in the order of the folder names — not necessarily the " +
      "order they were conducted in: how many categories occurred for the first " +
      "time and how many were in play by then. Whether the curve is flat enough " +
      "is nobody's judgement but yours.",
    progressPerInterview: "Progress per interview",
    turnsTouched: "Turns touched",
    chartSaturationTitle: "When nothing new arrived any more",
    saturationFresh: "For the first time",
    saturationTotal: "In all",
    saturationWhich: "Which for the first time",
    meetTitle: "Categories that turn up together",
    meetNote:
      "Counted per turn: in how many turns both categories were used. A weak " +
      "signal, and meant as one — two categories that belong together in the " +
      "material look exactly like two that were never told apart. Where the share " +
      "is high, a coding rule at the boundary is worth writing.",
    meetNone:
      "No two categories have been used in the same turn. For the separateness " +
      "of the system that is the good result.",
    meetPair: "Categories",
    meetTogether: "Shared turns",
    meetShare: "Share",
    meetOf: "Out of",
    meetOfWhich: "{name} stands in {n} turns",

    /* The sample, as a thesis has to describe it ------------------------- */
    sampleTitle: "Sample",
    projectName: "Fundstelle study",
    sampleLead:
      "Generated by the coding tool from the headers of the transcripts. The " +
      "columns are whatever the transcripts record; a field one interview " +
      "carries and another does not is left blank. The last two columns are " +
      "counted by the tool: codable turns and coding units.",
    sampleNoFields:
      "The transcripts record nothing so far. Lines of the form " +
      "“- Role: Team lead” under the heading are taken as columns.",
    interview: "Interview",
    department: "Department",
    columnTurns: "Turns",
    metricUnits: "Coding units",

    /* Intercoder reliability ---------------------------------------------- */
    agreementDocTitle: "Intercoder reliability",
    agreementDocLead:
      "Generated by the coding tool from the state of the coding and a second " +
      "coding filed beside it.",
    agreementDocNone:
      "There is no second coding for this material. The second coder's coding.json " +
      "belongs beside your own as coding.NAME.json.",
    agreementDocUnit:
      "The comparison runs per turn and category: did one coder use this category " +
      "anywhere in this turn, and did the other? That unit survives different " +
      "segmentation; where exactly a passage was cut does not count as a difference " +
      "in reading. Cohen's kappa stands beside the raw agreement and the four cells " +
      "it was computed from: with strongly skewed margins kappa falls even though " +
      "the two judge alike almost everywhere — a property of the measure, not of " +
      "the coding.",
    agreementDocWith: "Second coding “{coder}”",
    agreementDocFigures:
      "Cohen's kappa = {kappa} ({band}), raw agreement {agreement} over {units} " +
      "units compared. Compared: {interviews}.",
    agreementDocSkipped:
      "Without a second coding and therefore left out: {interviews}.",
    agreementDocApart: "Turns the two read differently",
    category: "Category",
    turn: "Turn",
    agreementCell: "Cell",
    agreementCount: "Count",
    agreementBoth: "Both used it",
    agreementNeither: "Neither used it",
    agreementOnlyFirst: "This coding only",
    agreementOnlySecond: "“{coder}” only",
    agreementApart: "Apart",
    agreementKappa: "Cohen's kappa",
    agreementApartNone: "There is no turn the two read differently.",
    agreementSideHere: "here {categories}",
    agreementSideThere: "“{coder}” {categories}",
    agreementNothing: "nothing",
    agreementBandNone: "no agreement beyond chance",
    agreementBandSlight: "slight agreement",
    agreementBandFair: "fair agreement",
    agreementBandModerate: "moderate agreement",
    agreementBandSubstantial: "substantial agreement",
    agreementBandAlmost: "almost perfect agreement",
    agreementFileUnreadable:
      "{file} in {interview} could not be read and stays out of the comparison. "
      + "What is expected is the same file Fundstelle writes as coding.json.",
    anchorAmbiguous: "The citation occurs more than once in the turn; the place is no longer unambiguous.",
    anchorNotFound: "The citation no longer reads that way in the turn.",
    anchorWouldOverlap:
      "The citation would now sit on top of another coding unit. One place carries " +
      "exactly one category, so the assignment is left open.",

    /* Coding guide --------------------------------------------------------- */
    guideTitle: "Coding guide",
    guideLead:
      "Generated by the coding tool from the current state of the coding. The " +
      "deductive definitions come from the category system as it stood before the " +
      "survey; anchor examples and coding rules emerged on the material. Where a " +
      "definition was sharpened during the review pass, the wording it started " +
      "from is reported alongside.",
    originDeductive: "deductive",
    originInductive: "inductive",
    fieldDefinition: "Definition",
    placeholderDefinition: "[PLACEHOLDER: definition]",
    placeholderAnchor: "[MISSING: anchor example — mark a citation as an anchor in the tool]",
    fieldBeforeSurvey: "Before the survey",
    fieldOnCreation: "On creation",
    sharpenedOnMaterial: "{definition} — sharpened on the material.",
    fieldAnchor: "Anchor example",
    fieldAnchorNumbered: "Anchor example {n}",
    fieldRule: "Coding rule",
    fieldRuleNumbered: "Coding rule {n}",
    anchorSource: "{department}, turn {turn}",
    unreviewedSuffix: ", unreviewed",

    /* Citations ------------------------------------------------------------ */
    citationsTitle: "Citations",
    sliceDepartment: "department {name}",
    sliceSection: "section {name}",
    sliceAnchor: "anchor examples only",
    sliceMemo: "with a note only",
    sliceOpen: "not yet in a requirement",
    sliceUnreviewed: "unreviewed only",
    sliceWord: "wording {word}",
    sliceLead: "Slice: {named}.",
    sliceAll: "All coding units, without restriction.",
    citationSource: "{department}, turn {turn}",
    citationAnchor: ", anchor example",
    citationUnreviewed: " **[unreviewed]**",
    citationNote: "Note: {note}",
    citationsNone: "No citation matches this slice.",

    /* Notes ---------------------------------------------------------------- */
    notesTitle: "Notes on the coding process",
    notesLead: "Generated by the coding tool. Working notes, not a presentation of results.",
    notesOnInterviews: "On the interviews",
    notesOnCategories: "On the categories",
    notesOnPassages: "On individual passages",
    notesDefinitionBefore: "Definition before the survey",
    notesDefinitionOnCreation: "Definition on creation",
    notesNone: "No notes recorded yet.",

    /* Coding table --------------------------------------------------------- */
    codingTableTitle: "Coding table {title}",
    codingTableLead:
      "Department: {department}. Codings: {total}, {reviewed} of them reviewed.",
    codingTableWarning: "An unreviewed assignment is a suggestion and proves nothing.",
    stateReviewed: "reviewed",
    stateUnreviewed: "**unreviewed**",

    /* Cross table ---------------------------------------------------------- */
    matrixTitle: "Categories by department",
    matrixLead:
      "Coding units per category and department. The “Departments” column counts " +
      "how many of the surveyed departments raise a category at all; it feeds the " +
      "prioritization of the requirements catalog.",

    /* Requirements catalog ------------------------------------------------- */
    catalogTitle: "Prioritized requirements catalog",
    catalogLead:
      "Generated from the codings. The “Departments” column counts how many of the " +
      "surveyed departments raise the requirement; “blocks” names the operations " +
      "whose absence the requirement prevents in the author's estimation. Together " +
      "the two carry the MoSCoW level.",
    catalogNamedBy: "Named by: {departments}.",
    catalogNamedByNobody: "no department yet",
    catalogCitations: "**Citations.**",
    catalogUnreviewed: "Of these, {n} of {total} citations are still unreviewed and prove nothing.",
    moscowOpen: "open",
    operationFiling: "Filing",
    operationRetrieval: "Retrieval",
    operationTransfer: "Transfer",

    /* Column headings ------------------------------------------------------ */
    columnPassage: "Passage",
    columnSection: "Section",
    columnCategory: "Category",
    columnState: "State",
    columnCitation: "Citation",
    columnNote: "Note",
    columnRequirement: "Requirement",
    columnMoscow: "MoSCoW",
    columnDepartments: "Departments",
    columnCitations: "Citations",
    columnBlocks: "blocks",
    columnTotal: "Total",
  },
};
