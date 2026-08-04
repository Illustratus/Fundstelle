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
    errorExampleNotEmpty: "Es liegen schon Interviews im Transkriptordner. Das Beispiel wird nur auf einem leeren Ordner angelegt.",
    errorRulesList: "Kodierregeln müssen eine Liste sein",
    errorDeductiveStaysPut:
      "Deduktive Kategorien stehen vor der Erhebung fest und bleiben, wo sie sind",
    errorSelfParent: "Eine Kategorie lässt sich nicht sich selbst unterordnen",
    errorUnknownCategory: "Unbekannte Kategorie",
    errorTwoLevels:
      "Das Kategoriensystem bleibt zweistufig: unter einer Unterkategorie ist kein Platz",
    errorHasChildren:
      "Diese Kategorie hat selbst Unterkategorien und kann nicht untergeordnet werden",
    errorStartSystemUnreadable: "Startsystem {file} ist nicht lesbar: {reason}",
    errorStartSystemEmpty: "Das Startsystem braucht eine nicht leere Liste „categories“",
    errorStartSystemFields:
      "Jede Startkategorie braucht id, name und definition (fehlt bei „{name}“)",
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
    errorExampleNotEmpty: "There are already interviews in the transcript folder. The example is only written into an empty one.",
    errorRulesList: "Coding rules have to be a list",
    errorDeductiveStaysPut:
      "Deductive categories are fixed before the survey and stay where they are",
    errorSelfParent: "A category cannot be subordinated to itself",
    errorUnknownCategory: "Unknown category",
    errorTwoLevels:
      "The category system stays two-level: there is no room below a subcategory",
    errorHasChildren: "This category has subcategories of its own and cannot be subordinated",
    errorStartSystemUnreadable: "Start system {file} cannot be read: {reason}",
    errorStartSystemEmpty: "The start system needs a non-empty “categories” list",
    errorStartSystemFields:
      "Every start category needs id, name and definition (missing on “{name}”)",
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
