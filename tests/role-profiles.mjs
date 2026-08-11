/**
 * Three role profiles for the checks, and the file they live in.
 *
 * Not a fixture folder: the profiles are read from `roles.json` beside the
 * category system, which is a file of the study and not a transcript. Written
 * by whoever needs it and removed again afterwards, so the sandbox goes back to
 * what it was — the figures need it as much as the view does, and neither may
 * depend on the order the suite happened to run in.
 */

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SANDBOX = join(process.cwd(), ".sandbox");
const FILE = join(SANDBOX, "roles.json");

const PILLARS = [
  { id: "tasks", name: "Aufgaben" },
  { id: "filing", name: "Ablage" },
  { id: "retrieval", name: "Abruf" },
  { id: "transfer", name: "Transfer" },
  { id: "structure", name: "Struktur" },
];

/**
 * Three profiles that between them hold every case the view has to answer for.
 *
 * Marketing speaks about itself and is spoken about by Vertrieb; Vertrieb only
 * about itself; Einkauf was never interviewed, so its profile is nothing but
 * other people's statements — the shape two of the departments of the real
 * study have. The last entry cites a turn that is not in any transcript.
 */
const ROLES = [
  {
    id: "marketing",
    name: "Marketing",
    interview: "interview-01",
    open: ["structure"],
    entries: [
      {
        id: "marketing.tasks.1",
        pillar: "tasks",
        text: "hält die Unterlagen für die Kampagnen bereit [@interview1{Beitrag 2}]",
        citations: [{ interview: "interview-01", turns: [2] }],
      },
      {
        id: "marketing.transfer.1",
        pillar: "transfer",
        text: "bekommt aus dem Vertrieb die Rückfragen der Kunden [@interview2{Beitrag 4}]",
        citations: [{ interview: "interview-02", turns: [4] }],
      },
      {
        id: "marketing.filing.1",
        pillar: "filing",
        text: "legt zuerst lokal ab [@interview1{Beiträge 4 und 6}]",
        citations: [{ interview: "interview-01", turns: [4, 6] }],
      },
    ],
  },
  {
    id: "vertrieb",
    name: "Vertrieb",
    interview: "interview-02",
    open: ["filing", "retrieval", "structure"],
    entries: [
      {
        id: "vertrieb.tasks.1",
        pillar: "tasks",
        text: "betreut die Kunden [@interview2{Beitrag 2}]",
        citations: [{ interview: "interview-02", turns: [2] }],
      },
    ],
  },
  {
    id: "einkauf",
    name: "Einkauf",
    interview: null,
    open: ["filing", "retrieval", "transfer", "structure"],
    entries: [
      {
        id: "einkauf.tasks.1",
        pillar: "tasks",
        text: "bestellt, was die anderen brauchen [@interview1{Beitrag 8}]",
        citations: [{ interview: "interview-01", turns: [8] }],
      },
      {
        id: "einkauf.tasks.2",
        pillar: "tasks",
        text: "eine Zuschreibung, deren Beleg es nicht gibt [@interview1{Beitrag 9999}]",
        citations: [{ interview: "interview-01", turns: [9999] }],
      },
    ],
  },
];

export function writeProfiles() {
  writeFileSync(FILE, JSON.stringify({ version: 3, pillars: PILLARS, roles: ROLES }, null, 2));
}


export const removeProfiles = () => rmSync(FILE, { force: true });
