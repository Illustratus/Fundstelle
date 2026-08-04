/**
 * Interface texts, one place per language.
 *
 * German is the complete reference; where a key is missing in a language the
 * German wording steps in. The choice: an explicit wish (`?lang=…` for one
 * visit, the switch in the header permanently) beats the browser language;
 * whoever brings neither of the two languages gets English as the
 * international default.
 *
 * The keys are English, the values are not: they are the interface, and the
 * interface speaks the reader's language.
 */

export const LANGUAGES = ["de", "en"];

const STORAGE_KEY = "fundstelle.language";

export function language() {
  const wanted =
    new URLSearchParams(location.search).get("lang") ?? localStorage.getItem(STORAGE_KEY);
  if (LANGUAGES.includes(wanted)) return wanted;
  const browser = (navigator.language ?? "en").slice(0, 2).toLowerCase();
  return LANGUAGES.includes(browser) ? browser : "en";
}

export function setLanguage(value) {
  localStorage.setItem(STORAGE_KEY, value);
}

export function t(key, values) {
  let text = TEXTS[language()]?.[key] ?? TEXTS.de[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}

/** Quotation marks belong to the language, not to the template. */
export function quoted(text) {
  return `${t("quoteOpen")}${text}${t("quoteClose")}`;
}

/** Plural helper: one word for one, another for the rest. */
export function plural(count, oneKey, manyKey) {
  return t(count === 1 ? oneKey : manyKey);
}

export const TEXTS = {
  de: {
    quoteOpen: "„",
    quoteClose: "“",

    headerSubtitle: "Qualitative Inhaltsanalyse",
    tabCode: "Kodieren",
    tabCatalog: "Katalog",
    tabAnalysis: "Auswertung",
    interview: "Interview",
    chooseInterview: "Interview wählen",
    themeTitle: "Hell oder dunkel",
    themeAria: "Darstellung wechseln",
    // The switch shows the target language; title and screen-reader name speak
    // it, so that it is understood by whoever cannot read the current language.
    languageTarget: "EN",
    languageTitle: "Switch the interface to English",
    languageAria: "Switch the interface to English",

    sections: "Blöcke",
    sectionsNote:
      "Je Erzählanstoß: wie viel von dem, was dort gesagt wurde, in " +
      "Kodiereinheiten steckt. Die Zahlen sind Anteile je Block, keine " +
      "Aufteilung der Kodierungen — sie ergeben zusammen keine 100 Prozent.",
    sectionCoverageTitle: "{n} Prozent des Materials in diesem Block kodiert",
    noteSummary: "Notiz zum Interview",
    noteNote: "Was beim Kodieren auffällt und keine Fundstelle hat: Auffälligkeiten des Gesprächs, Zweifel, Nächstes.",
    notePlaceholder: "Frei zu schreiben. Läuft in die Ausgabe „Notizen“ mit ein.",
    noteAria: "Notiz zum Interview",

    searchPlaceholder: "Im Transkript suchen — ab*leg* geht auch",
    searchTitle: "* steht für beliebige Zeichen im Wort. Findet ein Wort nichts, wird die Endung gekürzt.",
    searchAria: "Im Transkript suchen, * steht für beliebige Zeichen im Wort",
    searchPrevious: "Voriger Treffer",
    searchPreviousTitle: "Voriger Treffer (Umschalt+Enter)",
    searchNext: "Nächster Treffer",
    searchNextTitle: "Nächster Treffer (Enter)",
    searchPosition: "{i} von {n}",
    searchNoMatch: "kein Treffer",
    searchedInstead: "stattdessen nach „{word}“ gesucht",
    searchElsewhere: "Auch in anderen Interviews",
    keyHints: "<kbd>/</kbd> suchen · <kbd>j</kbd><kbd>k</kbd> Beitrag · <kbd>s</kbd> Satz · <kbd>?</kbd> alle Tasten",

    categorySystem: "Kategoriensystem",
    categorySystemNote: "Farbe zeigt die verankernde Proposition, nicht die Kategorie.",
    inductiveSummary: "Induktive Kategorie anlegen",
    inductiveNote: "Nur anlegen, wenn das Material eine Unterscheidung verlangt, die das Startsystem nicht trägt.",
    inductiveTag: "induktiv",
    fieldName: "Name",
    fieldDefinition: "Definition",
    fieldParent: "Untergeordnet",
    standalone: "eigenständig",
    add: "Anlegen",
    dragNote: "Induktive Kategorien lassen sich auf eine Startkategorie ziehen.",
    dragAria: "{name} an eine andere Stelle im Kategoriensystem ziehen",
    categoryNowUnder: "„{name}“ steht jetzt unter „{parent}“.",
    categoryNowStandalone: "„{name}“ steht jetzt eigenständig.",

    definitionPlaceholder: "Was fällt unter diese Kategorie?",
    definitionAria: "Definition von {name}",
    sharpenedOnMaterial: "Am Material geschärft.",
    // A deductive definition is fixed before the field work; an inductive one
    // arises while coding. Both may be sharpened afterwards — the wording they
    // started from is what makes the change reportable, so it is named here.
    definitionBefore: "Vor der Erhebung:",
    definitionAtCreation: "Beim Anlegen:",
    definitionReset: "zurücksetzen",
    codingRules: "Kodierregeln",
    rulesEmpty: "Noch keine. Eine Regel entsteht dort, wo die Abgrenzung zu einer anderen Kategorie unklar wird.",
    rulePlaceholder: "Kodierregel bei Abgrenzungsproblem",
    newRuleAria: "Neue Kodierregel",
    ruleAria: "Kodierregel {n}",
    ruleRemoveTitle: "Regel entfernen",
    ruleRemoveAria: "Kodierregel {n} entfernen",
    note: "Notiz",
    categoryNotePlaceholder: "Wie diese Kategorie entstanden ist, was noch offen ist",
    categoryNoteAria: "Notiz zu {name}",
    mergeIntoCategory: "In eine andere Kategorie überführen",
    targetCategoryAria: "Zielkategorie",
    removeCategory: "Kategorie entfernen",

    codingBarRule: "Genau eine Kategorie. Bei mehreren Handlungen entscheidet das Hauptprädikat.",
    codingBarKeys: "Ziffer wählt · Buchstaben tippen filtert · Enter nimmt den einzigen Treffer",
    codingBarWalk: "↓ ↑ nächster Satz · ⇧↓ einen Satz mehr · Esc legt ab",
    codingBarAria: "Kodiereinheit zuordnen",
    noCategoryContains: "Keine Kategorie enthält „{filter}“.",
    cancel: "Abbrechen",

    errorNoServer:
      "Fundstelle antwortet nicht. Nichts von diesem Schritt wurde gespeichert; " +
      "was vorher in den Dateien stand, steht unverändert dort. Läuft das Fenster " +
      "mit „node server.js“ noch? Danach diese Seite neu laden.",
    openUnreviewedOne:
      "Eine Kodiereinheit ist noch nicht geprüft. Die Ausgaben weisen sie als " +
      "solche aus; im Kodieren führt Enter durch die offenen Stellen.",
    openUncodedOne:
      "Ein Interview ist noch gar nicht kodiert: {names}. In Leitfaden und " +
      "Kodiertabellen kommt es deshalb nicht vor.",
    anchorsMissingOne:
      "Eine Kategorie hat noch kein Ankerbeispiel: {names}. Der Kodierleitfaden " +
      "weist die Lücke aus. Eine Fundstelle wird zum Anker, indem man sie " +
      "auswählt und „Ankerbeispiel“ ankreuzt.",
    openUnreviewed:
      "{n} Kodiereinheiten sind noch nicht geprüft. Die Ausgaben weisen sie als " +
      "solche aus; im Kodieren führt Enter durch die offenen Stellen.",
    openUncoded:
      "{n} Interviews sind noch gar nicht kodiert: {names}. In Leitfaden und " +
      "Kodiertabellen kommen sie deshalb nicht vor.",
    anchorsMissing:
      "{n} Kategorien haben noch kein Ankerbeispiel: {names}. Der Kodierleitfaden " +
      "weist die Lücke aus. Eine Fundstelle wird zum Anker, indem man sie " +
      "auswählt und „Ankerbeispiel“ ankreuzt.",
    analysisDisplaced:
      "{n} Kodiereinheiten haben ihren Platz im Transkript verloren und zählen " +
      "in keiner Zahl hier mit. In der Kodieransicht sind sie markiert und lassen " +
      "sich neu verankern.",
    meetTitle: "Kategorien, die zusammen auftreten",
    meetNote:
      "Je Beitrag gezählt: in wie vielen Beiträgen beide Kategorien vergeben " +
      "wurden. Ein schwaches Signal, und als solches gemeint — zwei Kategorien, " +
      "die im Material zusammengehören, sehen hier genauso aus wie zwei, die nie " +
      "auseinandergehalten wurden. Wo der Anteil hoch ist, lohnt eine Kodierregel " +
      "an der Abgrenzung.",
    meetNone:
      "Keine zwei Kategorien wurden bisher im selben Beitrag vergeben. Für die " +
      "Trennschärfe des Systems ist das das gute Ergebnis.",
    meetPair: "Kategorien",
    meetTogether: "Gemeinsame Beiträge",
    meetShare: "Anteil",
    meetOf: "Bezogen auf",
    meetOfWhich: "{name} steht in {n} Beiträgen",
    meetMore: "Weitere {n} Paare treten seltener zusammen auf.",
    chartSaturationTitle: "Wann kam nichts Neues mehr",
    chartSaturationCaption:
      "Senkrecht die Zahl der bis dahin vergebenen Kategorien, waagerecht die " +
      "Interviews in der Reihenfolge, in der sie hier gelistet sind — das ist die " +
      "Reihenfolge der Ordnernamen, nicht zwingend die der Erhebung. Welches " +
      "Interview welche Nummer trägt, steht in der Tabelle darunter. „+2“ heißt: " +
      "zwei Kategorien kamen in diesem Interview zum ersten Mal vor. Ob die Kurve " +
      "flach genug ist, entscheidet niemand außer dir.",
    summarySaturation:
      "Über {interviews} Interviews sind {total} Kategorien im Spiel. Seit " +
      "{since} Interviews kam keine neue mehr dazu.",
    saturationTip: "{title}: +{fresh} neu, {total} insgesamt. {names}",
    saturationFresh: "Zum ersten Mal",
    saturationTotal: "Insgesamt",
    saturationWhich: "Welche zum ersten Mal",
    saturationFiguresCaption:
      "Je Interview, wie viele Kategorien zum ersten Mal vorkamen und wie viele " +
      "insgesamt im Spiel waren.",
    startSystemSummary: "Kategorie für das Startsystem anlegen",
    startSystemNote:
      "Noch ist nichts kodiert, also steht das deduktive Startsystem noch nicht " +
      "fest — was jetzt entsteht, gilt als vor der Erhebung festgelegt und wird " +
      "im Kodierleitfaden so ausgewiesen. Die mitgelieferten Beispielkategorien " +
      "lassen sich hier ebenso entfernen. Ab der ersten Kodiereinheit steht das " +
      "System; alles Weitere ist dann induktiv.",
    startSystemAdd: "Zum Startsystem",
    startSystemAdded: "„{name}“ ins Startsystem aufgenommen.",
    importOpen: "Transkript einlesen",
    importTitle: "Transkript einlesen",
    importNote:
      "Aus einer Aufnahme kommt selten das Format, das hier gelesen wird. Lege die " +
      "Datei ab — WebVTT aus Teams oder Zoom, SRT, Whisper-Ausgabe oder ein Text, " +
      "dessen Zeilen mit einem Namen beginnen.",
    importDrop: "Datei hierher ziehen oder klicken",
    importFound: "Gelesen als {format}: {turns} Beiträge, {speakers} Sprechende.",
    importFoundNoSpeakers:
      "Gelesen als {format}: {turns} Beiträge — aber die Datei nennt keine " +
      "Sprechenden. Ohne Namen lässt sich nicht trennen, wer fragt und wer " +
      "antwortet; alles wird als Material gelesen.",
    importWho: "Wer fragt",
    importNobody: "niemand — alle Beiträge sind Material",
    importWhyWho:
      "Die Beiträge der fragenden Person sind nicht kodierbar. Das wird nicht " +
      "geraten: ein falscher Griff nähme entweder das halbe Material heraus oder " +
      "böte die Fragen als Befunde an.",
    importHeading: "Überschrift",
    importHeadingFor: "Interview: {department}",
    importDate: "Erhebung",
    importNoSections:
      "Erzählanstöße trägt die Aufnahme nicht — sie stehen im Leitfaden. " +
      "„## Erzählanstoß: Name“ als eigene Zeile ergänzt sie später; ohne sie " +
      "funktioniert alles außer der Blockleiste.",
    importWrite: "Transkript anlegen",
    importDone: "{title} angelegt, {turns} Beiträge.",
    importUnreadable:
      "Diese Datei ließ sich nicht als Transkript lesen. Erwartet wird WebVTT, " +
      "SRT, eine Whisper-Ausgabe oder ein Text, dessen Zeilen mit einem Namen und " +
      "einem Doppelpunkt beginnen.",
    importFromFile: "Transkript einlesen",
    keysTitle: "Tastatur",
    keysClose: "Schließen",
    keysOpen: "Tastenkürzel anzeigen",
    keysNote:
      "Das ganze Kodieren geht ohne Maus. Die Tasten gelten in der Kodieransicht; " +
      "in einem Eingabefeld tippen sie normal.",
    keysMove: "Im Material bewegen",
    keysChoose: "Stelle wählen",
    keysAssign: "Zuordnen",
    keysGeneral: "Sonst",
    keyTurnNext: "Ein Wortbeitrag weiter",
    keyTurnBack: "Ein Wortbeitrag zurück",
    keySearch: "Im Transkript suchen",
    keySearchNext: "Zur nächsten Fundstelle — im Suchfeld",
    keySentence: "Satz aufnehmen — und von dort weiter",
    keyWalk: "Satz für Satz weiter oder zurück",
    keyStretch: "Einen Satz mehr oder weniger aufnehmen",
    keyDouble: "Klicken nimmt den Satz darunter",
    keyDigit: "Die n-te gezeigte Kategorie zuordnen",
    keyLetters: "Kategorienliste filtern",
    keyEnterOne: "Zuordnen, wenn nur eine übrig ist",
    keyReview: "Prüfen: bestätigen und zur nächsten offenen Stelle",
    keyEscape: "Auswahl, Filter oder Suche aufgeben",
    keyHelp: "Diese Übersicht",
    keysAfterCode: "Nach dem Zuordnen steht der Satzzeiger auf dem nächsten Satz: kodieren in einem Zug.",

    ariaView: "Ansicht",
    ariaSections: "Leitfadenblöcke",
    ariaTranscript: "Transkript",
    ariaCategories: "Kategorien",

    statusUnits: "<b>{n}</b> Kodiereinheiten",
    statusTouched: "<b>{n}</b> von {m} Beiträgen berührt",
    statusSections: "<b>{n}</b> Blöcke",
    statusUnreviewed: "<b>{n}</b> noch ungeprüft",
    nextUnreviewed: "Nächste ungeprüfte Stelle",
    allReviewed: "alle geprüft",
    openMark: "{n} offen",
    unreviewed: "ungeprüft",
    openElsewhere: "{n} noch ungeprüft in anderen Interviews.",
    toThatInterview: "Dorthin wechseln",
    nextUntouched: "Nächster unberührter Beitrag",

    codingUnit: "Kodiereinheit",
    turn: "Beitrag",
    turnOne: "Beitrag",
    turnMany: "Beiträge",
    unitOne: "Kodiereinheit",
    unitMany: "Kodiereinheiten",
    category: "Kategorie",
    memo: "Memo",
    memoPlaceholder: "Warum diese Zuordnung?",
    anchorExample: "Ankerbeispiel",
    anchorShort: "Anker",
    reviewed: "geprüft",
    delete: "Löschen",
    citesRequirement: "Belegt Anforderung",
    noRequirementYet: "Noch keine Anforderung erhoben.",
    newRequirementPlaceholder: "Neue Anforderung aus dieser Stelle",
    newRequirementAria: "Neue Anforderung",
    codedAs: "Kodiert als {name}.",

    passageNotVisible: "Die Stelle ist derzeit nicht sichtbar — vielleicht ist sie verrutscht.",
    interviewerNote: "Das ist ein Beitrag des Interviewers. Kodiert werden die Aussagen der Befragten.",
    selectionWithinTurn: "Eine Kodiereinheit bleibt innerhalb eines Redebeitrags.",
    overlaps: "Die Auswahl überschneidet die Einheit „{name}“ in diesem Beitrag.",
    view: "ansehen",
    undo: "Rückgängig",
    unitDeleted: "Kodiereinheit gelöscht.",
    unitRestored: "Kodiereinheit wiederhergestellt.",
    restoreFailed: "Wiederherstellen nicht möglich: {error}",
    unitMoved: "1 Kodiereinheit wurde nachgeführt, weil sich der Text verschoben hat.",
    unitsMoved: "{n} Kodiereinheiten wurden nachgeführt, weil sich der Text verschoben hat.",
    driftTitleOne: "1 Kodiereinheit findet ihre Stelle nicht mehr",
    driftTitleMany: "{n} Kodiereinheiten finden ihre Stelle nicht mehr",
    fileProblemOne: "Eine Stelle im Transkript wurde nicht gelesen",
    fileProblemMany: "{n} Stellen im Transkript wurden nicht gelesen",
    fileProblemNote: "Die Datei bleibt unverändert. Solange das so steht, fehlt der genannte Text in jeder Auswertung.",
    driftNote: "Der Text hat sich seit dem Kodieren geändert. Sie werden nicht angezeigt, damit sie nicht die falsche Stelle markieren.",
    reanchor: "Neu verankern",
    requirementCreatedRefine: "Anforderung „{title}“ angelegt und belegt. Titel im Katalog schärfen.",
    requirementCreatedCited: "Anforderung „{title}“ angelegt und belegt.",
    requirementCreated: "Anforderung angelegt.",
    requirementRemoved: "Anforderung entfernt, die Belege bleiben als Kodiereinheiten bestehen.",
    svgSaved: "Diagramm als SVG gesichert.",
    reanchored: "Kodiereinheit neu verankert.",
    reanchorCancelled: "Neu verankern abgebrochen.",
    markPassage: "Markiere die Stelle, an der diese Kodiereinheit jetzt steht.",
    everyUnitReviewed: "Jede Kodiereinheit ist geprüft.",
    interviewReviewedOthersOpen:
      "Dieses Interview ist durchgesehen. In anderen Interviews stehen noch " +
      "{n} Kodiereinheiten offen.",
    oneUnreviewed: "1 Stelle noch ungeprüft.",
    manyUnreviewed: "{n} Stellen noch ungeprüft.",
    interviewNoteSaved: "Notiz zum Interview festgehalten.",
    everyTurnCoded: "Jeder Beitrag der Befragten trägt eine Kodiereinheit.",
    categoryRemoved: "Kategorie entfernt.",
    chooseTargetCategory: "Erst die Zielkategorie wählen.",
    chooseTargetRequirement: "Erst die Zielanforderung wählen.",
    inductiveAdded: "Induktive Kategorie „{name}“ angelegt.",
    categoryMerged: "„{source}“ ist in „{target}“ aufgegangen. {n} {word} übernommen. Prüfe die Definition.",
    requirementMerged: "„{source}“ ist in „{target}“ aufgegangen. {n} {word} übernommen.",
    ruleSaved: "Kodierregel festgehalten.",
    ruleChanged: "Kodierregel geändert.",
    ruleRemoved: "Kodierregel entfernt.",
    emptyRuleRemoved: "Leere Kodierregel entfernt.",
    definitionSaved: "Definition festgehalten.",
    noteSaved: "Notiz festgehalten.",
    categoryRenamed: "Kategorie umbenannt.",
    definitionResetDone: "Definition auf den Ausgangswortlaut zurückgesetzt.",
    errorGeneric: "Fehler",
    locationOne: "Fundstelle",
    locationMany: "Fundstellen",
    citationOne: "Beleg",
    citationMany: "Belege",
    filterIs: "Filter: {filter}",

    calculating: "Wird gerechnet …",
    analysis: "Auswertung",
    analysisLead:
      "Die Kreuztabelle zählt Kodiereinheiten je Bereich. Die letzte Spalte nennt, wie viele Bereiche eine Kategorie überhaupt ansprechen; sie trägt in die Priorisierung des Anforderungskatalogs.",
    metricUnits: "Kodiereinheiten",
    departments: "Bereiche",
    department: "Bereich",
    interviews: "Interviews",
    inductiveCategories: "induktive Kategorien",
    categoriesByDepartment: "Kategorien nach Bereich",
    total: "Summe",
    /* Intercoder reliability ---------------------------------------------- */
    agreementTitle: "Übereinstimmung mit einer Zweitkodierung",
    exportAgreement: "Intercoderreliabilität",
    exportSample: "Stichprobe",
    agreementNone:
      "Für dieses Material liegt keine Zweitkodierung vor. Wer eine hat, legt deren " +
      "coding.json als coding.NAME.json neben die eigene — also etwa " +
      "data/transcripts/interview-01/coding.anna.json. Die Datei wird nur gelesen, " +
      "nie verändert. Die Zweitkodierende arbeitet dafür mit einer eigenen Kopie von " +
      "Fundstelle auf denselben Transkripten.",
    agreementUnit:
      "Verglichen wird je Beitrag und Kategorie: Hat die eine Person diese Kategorie " +
      "irgendwo in diesem Beitrag vergeben, hat es die andere auch? Das überlebt " +
      "unterschiedliche Segmentierung — wo genau geschnitten wurde, zählt nicht als " +
      "inhaltliche Abweichung. Jede Zahl unten steht auf dieser Einheit.",
    agreementWith: "Zweitkodierung „{coder}“",
    agreementReads: "In der üblichen Lesart nach Landis und Koch: {band}. Das ist eine Konvention der Literatur, kein Messwert.",
    agreementKappa: "Cohens κ",
    agreementRaw: "Rohe Übereinstimmung",
    agreementUnits: "Verglichene Einheiten",
    agreementInterviews: "Interviews im Vergleich",
    agreementCovered: "Verglichen wurde: {interviews}.",
    agreementSkipped:
      "Ohne Zweitkodierung und deshalb außen vor: {interviews}. Sie mitzuzählen würde " +
      "jeden unkodierten Beitrag als Abweichung lesen.",
    agreementCell: "Feld",
    agreementCount: "Anzahl",
    agreementBoth: "Beide vergeben",
    agreementNeither: "Beide nicht vergeben",
    agreementOnlyFirst: "Nur diese Kodierung",
    agreementOnlySecond: "Nur „{coder}“",
    agreementOnlyFirstShort: "nur hier",
    agreementOnlySecondShort: "nur bei „{coder}“",
    agreementApart: "Auseinander",
    agreementApartOpen: "{n} Beiträge, in denen die beiden auseinandergehen",
    agreementSideHere: "hier {categories}",
    agreementSideThere: "bei „{coder}“ {categories}",
    agreementNothing: "nichts",
    agreementApartNote:
      "Diese Liste, nicht der Koeffizient, ist die Arbeitsgrundlage der Konsensrunde.",
    agreementApartNone: "In keinem Beitrag gehen die beiden auseinander.",
    agreementApartMore: "Weitere {n} Beiträge stehen in der Ausgabe.",
    agreementBandNone: "keine Übereinstimmung über den Zufall hinaus",
    agreementBandSlight: "geringe Übereinstimmung",
    agreementBandFair: "ausreichende Übereinstimmung",
    agreementBandModerate: "mittlere Übereinstimmung",
    agreementBandSubstantial: "deutliche Übereinstimmung",
    agreementBandAlmost: "nahezu vollständige Übereinstimmung",

    progressPerInterview: "Stand je Interview",
    turnsTouched: "Beiträge berührt",
    materialCoded: "Material kodiert",
    exports: "Ausgaben für die Arbeit",
    exportMatrix: "Tabelle als Markdown",
    exportMatrixTitle: "Grid-Tabelle auf 80 Zeichen Breite, wie sie in den Satz geht",
    exportCodingGuide: "Kodierleitfaden",
    exportNotes: "Notizen",
    exportCodingTable: "Kodiertabelle",
    chartTitle: "Kodiereinheiten je Kategorie",
    saveAsSvg: "Als SVG sichern",
    chartCaption: "Segmentfarbe = Bereich; jede Zahl steht auch in der Kreuztabelle darunter.",
    seriesMore: "Weitere",
    heatmapTitle: "Verteilung über die Erzählanstöße",
    rampLabel: "Kodiereinheiten je Zelle",
    heatmapCaption:
      "Zeilen wie im Kategoriensystem, Spalten wie im Leitfaden; die Blockleiste links im Kodieren zeigt dieselbe Verteilung je Interview.",

    citationsTitle: "Belege",
    guideSection: "Erzählanstoß",
    all: "alle",
    inCitationOrNote: "Im Beleg oder in der Notiz",
    filterPlaceholder: "Wort oder ab*leg*",
    anchorsOnly: "nur Ankerbeispiele",
    withNoteOnly: "nur mit Notiz",
    withoutRequirementOnly: "noch ohne Anforderung",
    unreviewedOnly: "nur ungeprüfte",
    clearSlice: "{shown} von {all} — Schnitt aufheben",
    showAllCitations: "alle {n} Belege zeigen",
    exportSlice: "Diesen Schnitt ausgeben",
    ofCount: "von {n}",
    viewInTranscript: "im Transkript ansehen",
    noCitationMatches: "Kein Beleg passt zu diesem Schnitt.",
    nothingCodedYet: "Noch nichts kodiert.",
    newRequirementFromNote: "＋ neue Anforderung aus der Notiz",
    newRequirementFromPassage: "＋ neue Anforderung aus dieser Stelle",
    citesRequirementChoice: "belegt Anforderung …",
    assignRequirementAria: "Diese Stelle einer Anforderung zuordnen",
    unlinkTitle: "Zuordnung lösen",
    unlinkAria: "Zuordnung zu {title} lösen",

    notesTitle: "Notizen",
    onInterviews: "Zu den Interviews",
    onCategories: "Zu den Kategorien",
    onPassages: "Zu den Fundstellen",
    searchAllNotes: "In allen Notizen suchen",
    attachedTo: "Woran",
    theInterview: "am Interview",
    toCategories: "an Kategorien",
    toPassages: "an Fundstellen",
    exportNotesButton: "Notizen ausgeben",
    noNoteMatches: "Keine Notiz passt dazu.",
    noNoteYet: "Noch keine Notiz festgehalten.",

    catalogTitle: "Anforderungskatalog",
    catalogLead:
      "Eine Anforderung bündelt Kodiereinheiten über Interviews hinweg. Wie viele Bereiche sie nennen, zählt das Werkzeug aus den Belegen; wie stark ihr Fehlen Ablage, Abruf oder Transfer blockiert, trägst du ein. Beides zusammen trägt die MoSCoW-Stufe.",
    requirementSentencePlaceholder: "Anforderung in einem Satz",
    requirementTitleAria: "Titel der Anforderung",
    withoutLevel: "noch ohne Stufe",
    withoutCitation: "noch ohne Beleg",
    restingOnSuggestions: "trägt ungeprüfte Belege",
    requirementOne: "Anforderung",
    requirementMany: "Anforderungen",
    noRequirementInSlice: "Keine Anforderung passt zu diesem Schnitt.",
    catalogEmpty: "Noch keine Anforderung erhoben. Sie entstehen beim Kodieren, aus einer Stelle heraus.",
    open: "offen",
    title: "Titel",
    moscowAria: "MoSCoW-Stufe",
    remove: "Entfernen",
    mergeInto: "Überführen in",
    chooseTarget: "— Ziel wählen —",
    merge: "Überführen",
    targetRequirementAria: "Zielanforderung",
    blocks: "Blockiert",
    operationFiling: "Ablage",
    operationRetrieval: "Abruf",
    operationTransfer: "Transfer",
    descriptionPlaceholder: "Was genau verlangt wird",
    noCitationYet: "Noch ohne Beleg. Ordne beim Kodieren eine Stelle zu.",
    departmentOne: "Bereich",
    departmentMany: "Bereiche",

    metricRequirements: "Anforderungen",
    metricCited: "belegt",
    metricPrioritized: "mit Stufe",
    chartMoscowTitle: "Verteilung der MoSCoW-Stufen",
    chartMoscowCaption:
      "Eine Anforderung ohne Stufe ist noch nicht entschieden; sie steht als „offen“ am Ende.",
    chartCoverageTitle: "Belege je Anforderung und Bereich",
    chartCoverageCaption:
      "Segmentfarbe = Bereich, Reihenfolge wie im Katalog. Eine Anforderung, die nur ein Bereich nennt, trägt einen einfarbigen Balken.",
    matrixCaption: "Kodiereinheiten je Kategorie und Bereich; Zeilen sind Kategorien, Spalten Bereiche.",
    summaryBars:
      "Balkendiagramm: {rows} Kategorien, {total} Kodiereinheiten aus {departments} Bereichen. " +
      "Am häufigsten {top} mit {topValue}. Dieselben Zahlen stehen einzeln in der Kreuztabelle darunter.",
    summaryCoverage:
      "Balkendiagramm: {rows} Anforderungen, {total} Belege aus {departments} Bereichen. " +
      "Am meisten belegt ist {top} mit {topValue}. Die Anforderungen stehen einzeln darunter.",
    summaryHeatmap:
      "Wärmekarte: {rows} Kategorien über {sections} Erzählanstöße. Die stärkste Zelle ist " +
      "{top} im Anstoß {section} mit {value} Kodiereinheiten.",
    summaryMoscow: "Verteilung von {total} Anforderungen auf die Stufen — {levels}.",
    summaryPriority:
      "Streudiagramm: {rows} Anforderungen, waagerecht die nennenden Bereiche (bis {departments}), " +
      "senkrecht die blockierten Operationen. Oben rechts, also von allen genannt und mehrfach " +
      "blockierend: {urgent} — {names}.",
    summaryNone: "keine",
    showFigures: "Zahlen als Tabelle",
    table: "Tabelle",
    columnLevel: "Stufe",
    columnRequirement: "Anforderung",
    columnRequirements: "Anforderungen",
    metricCitations: "Belege",
    heatmapFiguresCaption: "Kodiereinheiten je Kategorie und Erzählanstoß.",
    coverageFiguresCaption: "Belege je Anforderung und Bereich.",
    moscowFiguresCaption: "Anzahl der Anforderungen je MoSCoW-Stufe.",
    priorityFiguresCaption:
      "Je Anforderung: nennende Bereiche, blockierte Operationen, Belege und Stufe.",
    chartPriorityTitle: "Priorisierung: Bereiche und blockierte Operationen",
    chartPriorityCaption:
      "Waagerecht die Zahl der nennenden Bereiche, aus den Belegen gezählt; senkrecht die Zahl der blockierten Operationen, von dir eingetragen. Punktgröße = Belege, Punktfarbe = MoSCoW-Stufe. Rechts oben liegt, was die Stufe „Must have“ trägt.",
    axisDepartmentsNaming: "nennende Bereiche",
    axisBlockedOperations: "blockierte Operationen",
    priorityTip: "{title} · {departments} Bereiche · {blocked} blockiert · {citations} Belege",
    catalogChartsEmpty: "Sobald eine Anforderung belegt ist, zeigt sich hier ihre Lage.",

    onboardingTitle: "Noch kein Transkript",
    onboardingReads:
      "Das Werkzeug liest je Interview eine Datei <code>final.md</code> aus einem eigenen Unterordner des Transkriptordners:",
    onboardingSample:
      "# Interview 1: Vertrieb\n\n- Erhebung: 4. August 2026\n\n---\n\n## Section: 1 · Ablage\n\n**1 · Interviewer [0:05]**\n\nWie hältst du Wissen fest?\n\n**2 · Vertrieb [0:15]**\n\nMeistens in Notizen, die ich nie wiederfinde.",
    onboardingContract:
      "<code>## Section:</code> eröffnet einen Leitfadenblock, <code>**2 · Sprecher [0:15]**</code> einen Redebeitrag; sein Text folgt als eigener Absatz. Beiträge, deren Sprecher nicht <em>Interviewer</em> heißt, sind kodierbar; der Sprechername wird in der Auswertung zum Bereich.",
    reload: "Neu laden",
    writeExample: "Beispiel-Interview anlegen",
    writeExampleNote: "Legt ein erfundenes Interview im Transkriptordner an, damit sofort etwas zum Kodieren da ist. Vorhandene Dateien werden nicht angerührt; der Ordner lässt sich später einfach löschen.",
    onboardingStartSystem:
      "Mehr in der README — ein eigenes deduktives Kategoriensystem sät die Umgebungsvariable <code>START_SYSTEM</code> beim ersten Start.",
  },

  en: {
    quoteOpen: "“",
    quoteClose: "”",

    headerSubtitle: "Qualitative content analysis",
    tabCode: "Code",
    tabCatalog: "Catalog",
    tabAnalysis: "Analysis",
    interview: "Interview",
    chooseInterview: "Choose interview",
    themeTitle: "Light or dark",
    themeAria: "Switch appearance",
    languageTarget: "DE",
    languageTitle: "Oberfläche auf Deutsch umstellen",
    languageAria: "Oberfläche auf Deutsch umstellen",

    sections: "Sections",
    sectionsNote:
      "Per guide section: how much of what was said there is held in coding " +
      "units. These are shares within each block, not a split of the codings — " +
      "they do not add up to 100 percent.",
    sectionCoverageTitle: "{n} percent of the material in this section coded",
    noteSummary: "Interview note",
    noteNote: "What you notice while coding that has no citable place: oddities of the conversation, doubts, next steps.",
    notePlaceholder: "Free-form. Flows into the “Notes” export.",
    noteAria: "Interview note",

    searchPlaceholder: "Search the transcript — wild*cards work",
    searchTitle: "* matches any characters within a word. If a word finds nothing, its ending is trimmed.",
    searchAria: "Search the transcript, * matches any characters within a word",
    searchPrevious: "Previous match",
    searchPreviousTitle: "Previous match (Shift+Enter)",
    searchNext: "Next match",
    searchNextTitle: "Next match (Enter)",
    searchPosition: "{i} of {n}",
    searchNoMatch: "no match",
    searchedInstead: "searched for “{word}” instead",
    searchElsewhere: "Also in other interviews",
    keyHints: "<kbd>/</kbd> search · <kbd>j</kbd><kbd>k</kbd> turn · <kbd>s</kbd> sentence · <kbd>?</kbd> all keys",

    categorySystem: "Category system",
    categorySystemNote: "Color shows the anchoring proposition, not the category.",
    inductiveSummary: "Add an inductive category",
    inductiveNote: "Add one only when the material demands a distinction the start system does not carry.",
    inductiveTag: "inductive",
    fieldName: "Name",
    fieldDefinition: "Definition",
    fieldParent: "Parent",
    standalone: "independent",
    add: "Add",
    dragNote: "Inductive categories can be dragged onto a start category.",
    dragAria: "Move {name} elsewhere in the category system",
    categoryNowUnder: "“{name}” now sits under “{parent}”.",
    categoryNowStandalone: "“{name}” is independent now.",

    definitionPlaceholder: "What falls under this category?",
    definitionAria: "Definition of {name}",
    sharpenedOnMaterial: "Sharpened on the material.",
    definitionBefore: "Before the field work:",
    definitionAtCreation: "As created:",
    definitionReset: "reset",
    codingRules: "Coding rules",
    rulesEmpty: "None yet. A rule emerges where the boundary to another category turns unclear.",
    rulePlaceholder: "Coding rule for a boundary problem",
    newRuleAria: "New coding rule",
    ruleAria: "Coding rule {n}",
    ruleRemoveTitle: "Remove rule",
    ruleRemoveAria: "Remove coding rule {n}",
    note: "Note",
    categoryNotePlaceholder: "How this category came about, what is still open",
    categoryNoteAria: "Note on {name}",
    mergeIntoCategory: "Merge into another category",
    targetCategoryAria: "Target category",
    removeCategory: "Remove category",

    codingBarRule: "Exactly one category. With several actions, the main predicate decides.",
    codingBarKeys: "Digit assigns · typing filters · Enter takes the only match",
    codingBarWalk: "↓ ↑ next sentence · ⇧↓ one sentence more · Esc lets go",
    codingBarAria: "Assign coding unit",
    noCategoryContains: "No category contains “{filter}”.",
    cancel: "Cancel",

    errorNoServer:
      "Fundstelle is not answering. Nothing of this step was saved; what stood " +
      "in the files before stands there unchanged. Is the window running " +
      "“node server.js” still open? Reload this page afterwards.",
    openUnreviewedOne:
      "One coding unit is not reviewed yet. The exports mark it as such; in the " +
      "coding view Enter walks the open ones.",
    openUncodedOne:
      "One interview has not been coded at all: {names}. It therefore does not " +
      "appear in the guide or in the coding tables.",
    anchorsMissingOne:
      "One category has no anchor example yet: {names}. The coding guide shows " +
      "the gap. A citation becomes an anchor by selecting it and ticking " +
      "“anchor example”.",
    openUnreviewed:
      "{n} coding units are not reviewed yet. The exports mark them as such; in " +
      "the coding view Enter walks the open ones.",
    openUncoded:
      "{n} interviews have not been coded at all: {names}. They therefore do not " +
      "appear in the guide or in the coding tables.",
    anchorsMissing:
      "{n} categories have no anchor example yet: {names}. The coding guide " +
      "shows the gap. A citation becomes an anchor by selecting it and ticking " +
      "“anchor example”.",
    analysisDisplaced:
      "{n} coding units have lost their place in the transcript and count in " +
      "none of the figures here. They are marked in the coding view and can be " +
      "anchored again.",
    meetTitle: "Categories that turn up together",
    meetNote:
      "Counted per turn: in how many turns both categories were used. A weak " +
      "signal, and meant as one — two categories that belong together in the " +
      "material look exactly like two that were never told apart. Where the share " +
      "is high, a coding rule at the boundary is worth writing.",
    meetNone:
      "No two categories have been used in the same turn so far. For the " +
      "separateness of the system that is the good result.",
    meetPair: "Categories",
    meetTogether: "Shared turns",
    meetShare: "Share",
    meetOf: "Out of",
    meetOfWhich: "{name} stands in {n} turns",
    meetMore: "A further {n} pairs turn up together less often.",
    chartSaturationTitle: "When nothing new arrived any more",
    chartSaturationCaption:
      "Vertically the number of categories used by then, horizontally the " +
      "interviews in the order they are listed here — the order of their folder " +
      "names, not necessarily the order they were conducted in; which interview " +
      "carries which number is in the table below. “+2” means two " +
      "categories occurred for the first time in that interview. Whether the " +
      "curve is flat enough is nobody's judgement but yours.",
    summarySaturation:
      "Across {interviews} interviews {total} categories are in play. No new one " +
      "has arrived for {since} interviews.",
    saturationTip: "{title}: +{fresh} new, {total} in all. {names}",
    saturationFresh: "For the first time",
    saturationTotal: "In all",
    saturationWhich: "Which for the first time",
    saturationFiguresCaption:
      "Per interview, how many categories occurred for the first time and how " +
      "many were in play in all.",
    startSystemSummary: "Add a category to the start system",
    startSystemNote:
      "Nothing is coded yet, so the deductive start system is not settled — what " +
      "you add now counts as fixed before the survey and is reported that way in " +
      "the coding guide. The bundled example categories can be removed here just " +
      "as well. From the first coding unit onwards the system stands, and " +
      "everything after it is inductive.",
    startSystemAdd: "To the start system",
    startSystemAdded: "“{name}” taken into the start system.",
    importOpen: "Read in a transcript",
    importTitle: "Read in a transcript",
    importNote:
      "A recording rarely produces the format read here. Drop the file — WebVTT " +
      "from Teams or Zoom, SRT, Whisper output, or a text whose lines begin with " +
      "a name.",
    importDrop: "Drop a file here, or click",
    importFound: "Read as {format}: {turns} turns, {speakers} speakers.",
    importFoundNoSpeakers:
      "Read as {format}: {turns} turns — but the file names no speakers. Without " +
      "names there is no telling who is asking from who is answering; all of it " +
      "is read as material.",
    importWho: "Who is asking",
    importNobody: "nobody — every turn is material",
    importWhyWho:
      "The interviewer's turns cannot be coded. This is not guessed: a wrong " +
      "guess would either take half the material out or offer the questions up " +
      "as findings.",
    importHeading: "Heading",
    importHeadingFor: "Interview: {department}",
    importDate: "Survey date",
    importNoSections:
      "The recording carries no guide sections — they belong to the interview " +
      "guide. A line of the form “## Section: Name” adds them later; everything " +
      "except the section bar works without them.",
    importWrite: "Create the transcript",
    importDone: "{title} created, {turns} turns.",
    importUnreadable:
      "This file could not be read as a transcript. What is expected is WebVTT, " +
      "SRT, a Whisper output, or a text whose lines begin with a name and a colon.",
    importFromFile: "Read in a transcript",
    keysTitle: "Keyboard",
    keysClose: "Close",
    keysOpen: "Show keyboard shortcuts",
    keysNote:
      "The whole of coding works without a mouse. The keys apply in the coding view; " +
      "inside an input field they type as usual.",
    keysMove: "Move through the material",
    keysChoose: "Choose a passage",
    keysAssign: "Assign",
    keysGeneral: "Otherwise",
    keyTurnNext: "One speaker turn on",
    keyTurnBack: "One speaker turn back",
    keySearch: "Search the transcript",
    keySearchNext: "To the next hit — in the search field",
    keySentence: "Take up a sentence — and carry on from there",
    keyWalk: "Sentence by sentence, on or back",
    keyStretch: "Take one sentence more or less",
    keyDouble: "Clicking takes the sentence under the pointer",
    keyDigit: "Assign the n-th category shown",
    keyLetters: "Filter the list of categories",
    keyEnterOne: "Assign when only one is left",
    keyReview: "Review: confirm and go to the next open passage",
    keyEscape: "Let go of the selection, the filter or the search",
    keyHelp: "This overview",
    keysAfterCode: "After assigning, the sentence cursor stands on the next sentence: coding in one go.",

    ariaView: "View",
    ariaSections: "Guide sections",
    ariaTranscript: "Transcript",
    ariaCategories: "Categories",

    statusUnits: "<b>{n}</b> coding units",
    statusTouched: "<b>{n}</b> of {m} turns touched",
    statusSections: "<b>{n}</b> sections",
    statusUnreviewed: "<b>{n}</b> still unreviewed",
    nextUnreviewed: "Next unreviewed unit",
    allReviewed: "all reviewed",
    openMark: "{n} open",
    unreviewed: "unreviewed",
    openElsewhere: "{n} still unreviewed in other interviews.",
    toThatInterview: "Go there",
    nextUntouched: "Next untouched turn",

    codingUnit: "Coding unit",
    turn: "Turn",
    turnOne: "turn",
    turnMany: "turns",
    unitOne: "coding unit",
    unitMany: "coding units",
    category: "Category",
    memo: "Memo",
    memoPlaceholder: "Why this assignment?",
    anchorExample: "Anchor example",
    anchorShort: "Anchor",
    reviewed: "reviewed",
    delete: "Delete",
    citesRequirement: "Cites requirement",
    noRequirementYet: "No requirement recorded yet.",
    newRequirementPlaceholder: "New requirement from this passage",
    newRequirementAria: "New requirement",
    codedAs: "Coded as {name}.",

    passageNotVisible: "The passage is not visible right now — it may have shifted.",
    interviewerNote: "This is an interviewer turn. Coding applies to the respondents' statements.",
    selectionWithinTurn: "A coding unit stays within one speaker turn.",
    overlaps: "The selection overlaps the unit “{name}” in this turn.",
    view: "view",
    undo: "Undo",
    unitDeleted: "Coding unit deleted.",
    unitRestored: "Coding unit restored.",
    restoreFailed: "Could not restore: {error}",
    unitMoved: "1 coding unit was moved along, because the text has shifted.",
    unitsMoved: "{n} coding units were moved along, because the text has shifted.",
    driftTitleOne: "1 coding unit no longer finds its place",
    driftTitleMany: "{n} coding units no longer find their place",
    fileProblemOne: "One place in the transcript was not read",
    fileProblemMany: "{n} places in the transcript were not read",
    fileProblemNote: "The file is left untouched. As long as this stands, the text named is missing from every analysis.",
    driftNote: "The text has changed since the coding. They are not displayed, so that they cannot mark the wrong passage.",
    reanchor: "Re-anchor",
    requirementCreatedRefine: "Requirement “{title}” created and cited. Refine the title in the catalog.",
    requirementCreatedCited: "Requirement “{title}” created and cited.",
    requirementCreated: "Requirement created.",
    requirementRemoved: "Requirement removed; its citations remain as coding units.",
    svgSaved: "Chart saved as SVG.",
    reanchored: "Coding unit re-anchored.",
    reanchorCancelled: "Re-anchoring cancelled.",
    markPassage: "Select the passage where this coding unit now belongs.",
    everyUnitReviewed: "Every coding unit is reviewed.",
    interviewReviewedOthersOpen:
      "This interview has been gone through. {n} coding units are still open " +
      "in other interviews.",
    oneUnreviewed: "1 unit still unreviewed.",
    manyUnreviewed: "{n} units still unreviewed.",
    interviewNoteSaved: "Interview note saved.",
    everyTurnCoded: "Every respondent turn already carries a coding unit.",
    categoryRemoved: "Category removed.",
    chooseTargetCategory: "Choose the target category first.",
    chooseTargetRequirement: "Choose the target requirement first.",
    inductiveAdded: "Inductive category “{name}” added.",
    categoryMerged: "“{source}” merged into “{target}”. {n} {word} carried over. Review the definition.",
    requirementMerged: "“{source}” merged into “{target}”. {n} {word} carried over.",
    ruleSaved: "Coding rule saved.",
    ruleChanged: "Coding rule changed.",
    ruleRemoved: "Coding rule removed.",
    emptyRuleRemoved: "Empty coding rule removed.",
    definitionSaved: "Definition saved.",
    noteSaved: "Note saved.",
    categoryRenamed: "Category renamed.",
    definitionResetDone: "Definition reset to the wording it started from.",
    errorGeneric: "Error",
    locationOne: "location",
    locationMany: "locations",
    citationOne: "citation",
    citationMany: "citations",
    filterIs: "Filter: {filter}",

    calculating: "Calculating …",
    analysis: "Analysis",
    analysisLead:
      "The cross table counts coding units per department. The last column names how many departments a category touches at all; it feeds the prioritization of the requirements catalog.",
    metricUnits: "Coding units",
    departments: "Departments",
    department: "Department",
    interviews: "Interviews",
    inductiveCategories: "inductive categories",
    categoriesByDepartment: "Categories by department",
    total: "Total",
    /* Intercoder reliability ---------------------------------------------- */
    agreementTitle: "Agreement with a second coding",
    exportAgreement: "Intercoder reliability",
    exportSample: "Sample",
    agreementNone:
      "There is no second coding for this material. If you have one, put its " +
      "coding.json beside your own as coding.NAME.json — say " +
      "data/transcripts/interview-01/coding.anna.json. The file is only ever read, " +
      "never changed. The second coder works from their own copy of Fundstelle on " +
      "the same transcripts.",
    agreementUnit:
      "The comparison runs per turn and category: did one of you use this category " +
      "anywhere in this turn, and did the other? That survives different " +
      "segmentation — where exactly a passage was cut does not count as a difference " +
      "in reading. Every figure below rests on that unit.",
    agreementWith: "Second coding “{coder}”",
    agreementReads: "In the customary reading after Landis and Koch: {band}. That is a convention of the literature, not a measurement.",
    agreementKappa: "Cohen's κ",
    agreementRaw: "Raw agreement",
    agreementUnits: "Units compared",
    agreementInterviews: "Interviews compared",
    agreementCovered: "Compared: {interviews}.",
    agreementSkipped:
      "Without a second coding and therefore left out: {interviews}. Counting them " +
      "would read every uncoded turn as a difference.",
    agreementCell: "Cell",
    agreementCount: "Count",
    agreementBoth: "Both used it",
    agreementNeither: "Neither used it",
    agreementOnlyFirst: "This coding only",
    agreementOnlySecond: "“{coder}” only",
    agreementOnlyFirstShort: "here only",
    agreementOnlySecondShort: "“{coder}” only",
    agreementApart: "Apart",
    agreementApartOpen: "{n} turns the two read differently",
    agreementSideHere: "here {categories}",
    agreementSideThere: "“{coder}” {categories}",
    agreementNothing: "nothing",
    agreementApartNote:
      "This list, not the coefficient, is what a consensus round works from.",
    agreementApartNone: "There is no turn the two read differently.",
    agreementApartMore: "A further {n} turns are in the export.",
    agreementBandNone: "no agreement beyond chance",
    agreementBandSlight: "slight agreement",
    agreementBandFair: "fair agreement",
    agreementBandModerate: "moderate agreement",
    agreementBandSubstantial: "substantial agreement",
    agreementBandAlmost: "almost perfect agreement",

    progressPerInterview: "Progress per interview",
    turnsTouched: "Turns touched",
    materialCoded: "Material coded",
    exports: "Exports for the paper",
    exportMatrix: "Table as Markdown",
    exportMatrixTitle: "Grid table set to 80 characters, the way it goes into typesetting",
    exportCodingGuide: "Coding guide",
    exportNotes: "Notes",
    exportCodingTable: "Coding table",
    chartTitle: "Coding units per category",
    saveAsSvg: "Save as SVG",
    chartCaption: "Segment color = department; every number also appears in the cross table below.",
    seriesMore: "Others",
    heatmapTitle: "Distribution across guide sections",
    rampLabel: "Coding units per cell",
    heatmapCaption:
      "Rows follow the category system, columns follow the guide; the section bar in the coding view shows the same distribution per interview.",

    citationsTitle: "Citations",
    guideSection: "Guide section",
    all: "all",
    inCitationOrNote: "In citation or note",
    filterPlaceholder: "Word or wild*card",
    anchorsOnly: "anchor examples only",
    withNoteOnly: "with note only",
    withoutRequirementOnly: "without requirement yet",
    unreviewedOnly: "unreviewed only",
    clearSlice: "{shown} of {all} — clear the slice",
    showAllCitations: "show all {n} citations",
    exportSlice: "Export this slice",
    ofCount: "of {n}",
    viewInTranscript: "view in transcript",
    noCitationMatches: "No citation matches this slice.",
    nothingCodedYet: "Nothing coded yet.",
    newRequirementFromNote: "＋ new requirement from the note",
    newRequirementFromPassage: "＋ new requirement from this passage",
    citesRequirementChoice: "cites requirement …",
    assignRequirementAria: "Assign this passage to a requirement",
    unlinkTitle: "Remove assignment",
    unlinkAria: "Remove the assignment to {title}",

    notesTitle: "Notes",
    onInterviews: "On the interviews",
    onCategories: "On the categories",
    onPassages: "On the passages",
    searchAllNotes: "Search all notes",
    attachedTo: "Attached to",
    theInterview: "the interview",
    toCategories: "categories",
    toPassages: "passages",
    exportNotesButton: "Export notes",
    noNoteMatches: "No note matches.",
    noNoteYet: "No note recorded yet.",

    catalogTitle: "Requirements catalog",
    catalogLead:
      "A requirement bundles coding units across interviews. How many departments name it is counted from the citations; how strongly its absence blocks filing, retrieval, or transfer is your judgment. Both together carry the MoSCoW level.",
    requirementSentencePlaceholder: "The requirement in one sentence",
    requirementTitleAria: "Requirement title",
    withoutLevel: "no level yet",
    withoutCitation: "no citation yet",
    restingOnSuggestions: "rests on suggestions",
    requirementOne: "requirement",
    requirementMany: "requirements",
    noRequirementInSlice: "No requirement matches this slice.",
    catalogEmpty: "No requirement recorded yet. They emerge while coding, from a passage.",
    open: "open",
    title: "Title",
    moscowAria: "MoSCoW level",
    remove: "Remove",
    mergeInto: "Merge into",
    chooseTarget: "— choose target —",
    merge: "Merge",
    targetRequirementAria: "Target requirement",
    blocks: "Blocks",
    operationFiling: "Filing",
    operationRetrieval: "Retrieval",
    operationTransfer: "Transfer",
    descriptionPlaceholder: "What exactly is demanded",
    noCitationYet: "No citation yet. Assign a passage while coding.",
    departmentOne: "department",
    departmentMany: "departments",

    metricRequirements: "Requirements",
    metricCited: "cited",
    metricPrioritized: "with a level",
    chartMoscowTitle: "Distribution of MoSCoW levels",
    chartMoscowCaption:
      "A requirement without a level has not been decided yet; it sits at the end as “open”.",
    chartCoverageTitle: "Citations per requirement and department",
    chartCoverageCaption:
      "Segment color = department, order as in the catalog. A requirement named by one department only carries a single-color bar.",
    matrixCaption: "Coding units per category and department; rows are categories, columns departments.",
    summaryBars:
      "Bar chart: {rows} categories, {total} coding units from {departments} departments. " +
      "Most frequent is {top} with {topValue}. The same numbers stand one by one in the cross table below.",
    summaryCoverage:
      "Bar chart: {rows} requirements, {total} citations from {departments} departments. " +
      "Best evidenced is {top} with {topValue}. The requirements are listed one by one below.",
    summaryHeatmap:
      "Heatmap: {rows} categories across {sections} guide sections. The strongest cell is " +
      "{top} in section {section} with {value} coding units.",
    summaryMoscow: "Distribution of {total} requirements across the levels — {levels}.",
    summaryPriority:
      "Scatter plot: {rows} requirements, horizontally the naming departments (up to {departments}), " +
      "vertically the blocked operations. Upper right, named by all and blocking more than one: " +
      "{urgent} — {names}.",
    summaryNone: "none",
    showFigures: "Figures as a table",
    table: "Table",
    columnLevel: "Level",
    columnRequirement: "Requirement",
    columnRequirements: "Requirements",
    metricCitations: "Citations",
    heatmapFiguresCaption: "Coding units per category and guide section.",
    coverageFiguresCaption: "Citations per requirement and department.",
    moscowFiguresCaption: "Number of requirements per MoSCoW level.",
    priorityFiguresCaption:
      "Per requirement: naming departments, blocked operations, citations and level.",
    chartPriorityTitle: "Prioritization: departments and blocked operations",
    chartPriorityCaption:
      "Horizontally the number of naming departments, counted from the citations; vertically the number of blocked operations, entered by you. Dot size = citations, dot color = MoSCoW level. Whatever carries “Must have” sits in the upper right.",
    axisDepartmentsNaming: "naming departments",
    axisBlockedOperations: "blocked operations",
    priorityTip: "{title} · {departments} departments · {blocked} blocked · {citations} citations",
    catalogChartsEmpty: "As soon as a requirement is cited, its position shows up here.",

    onboardingTitle: "No transcript yet",
    onboardingReads:
      "The tool reads one <code>final.md</code> per interview from its own subfolder of the transcript folder:",
    onboardingSample:
      "# Interview 1: Sales\n\n- Conducted: 4 August 2026\n\n---\n\n## Section: 1 · Filing\n\n**1 · Interviewer [0:05]**\n\nHow do you record knowledge?\n\n**2 · Sales [0:15]**\n\nMostly in notes I never find again.",
    onboardingContract:
      "<code>## Section:</code> opens a guide section, <code>**2 · Speaker [0:15]**</code> a turn whose text follows as its own paragraph. Turns by any speaker not named <em>Interviewer</em> are codable; the speaker name becomes the department in the analytics.",
    reload: "Reload",
    writeExample: "Write an example interview",
    writeExampleNote: "Puts an invented interview in the transcript folder, so there is something to code straight away. Nothing already there is touched, and the folder can simply be deleted later.",
    onboardingStartSystem:
      "More in the README — seed your own deductive category system with the <code>START_SYSTEM</code> environment variable on first start.",
  },
};
