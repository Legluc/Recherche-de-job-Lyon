/**
 * Sélection des offres collectées au navigateur (Indeed, Welcome to the Jungle).
 *
 * Le navigateur ne fait que collecter ; la sélection passe intégralement par
 * `selectOffers` (pipeline.ts), comme le run automatique et `ingest-file.ts` —
 * aucune règle de scoring n'est réécrite ici. Ce script existe parce que la
 * passe navigateur ne dispose pas du `NOTION_TOKEN` (il ne vit que dans les
 * secrets GitHub Actions) : elle ne peut donc pas utiliser `ingest-file.ts`, qui
 * lit et écrit Notion directement. Elle lit l'existant via le connecteur Notion,
 * le dépose dans un fichier, et insère ensuite les retenues par le même
 * connecteur. Ce script est la charnière entre les deux.
 *
 * Usage :
 *   npm run select-web
 *   WEB_CAP=12 WEB_MIN_SCORE=86 npm run select-web
 *
 * Entrées  : data/web-raw.json (NormalizedOffer[]), data/notion-existing.json
 * Sortie   : data/web-selected.json (ScoredOffer[], triées par score décroissant)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { selectOffers } from "./pipeline";
import { CITIES } from "./cities";
import { PART_TIME_RE, WEEKEND_WORK_RE, SMIC } from "./config";
import { parseSalary } from "./salary";
import type { ExistingIndex } from "./notion";
import type { NormalizedOffer } from "./types";

const RAW_FILE = process.env.WEB_RAW || "data/web-raw.json";
const EXISTING_FILE = process.env.WEB_EXISTING || "data/notion-existing.json";
const OUT_FILE = process.env.WEB_OUT || "data/web-selected.json";

/**
 * Plafond d'insertion de la passe. Il valait 14 (dev) + 6 (alimentaire) du temps
 * où les deux profils se partageaient la place ; l'abandon du dev (octobre 2026)
 * rend les 20 slots à l'unique profil restant, ce qui garde intact le budget
 * quotidien du tri IA en aval (30 côté GitHub Actions + 20 ici).
 */
const MAX_SELECT = Number(process.env.WEB_CAP) || 20;

/**
 * Seuil relevé au-dessus de `LIMITS.minScore` (80), propre à cette passe.
 *
 * Pourquoi plus haut ici : les cartes Indeed et WTTJ publient rarement de quoi
 * déclencher les bonus de conditions (salaire lisible, mention du rythme), donc
 * les scores s'y tassent sur un palier au lieu de s'étaler. Un seuil légèrement
 * supérieur écarte ce palier bas sans toucher au run automatique, dont le vivier
 * est déjà filtré côté requêtes API.
 *
 * Valeur calibrée par rejeu de data/web-raw.json : voir le README. À revoir si la
 * passe remonte régulièrement zéro offre — le filet serait fermé, pas resserré.
 */
const MIN_SCORE = Number(process.env.WEB_MIN_SCORE) || 84;

interface ExistingRow {
  ref?: string;
  title?: string;
  company?: string;
  location?: string;
}

/**
 * Lit l'existant Notion. Deux formes acceptées : le tableau plat produit par la
 * passe navigateur (`[{ ref, title, company, location }]`) et la forme
 * `ExistingIndex` sérialisée. Tolérer les deux évite qu'un run entier échoue sur
 * une divergence de format entre le prompt de collecte et ce script.
 */
function readExisting(file: string): ExistingIndex {
  const parsed = JSON.parse(readFileSync(file, "utf-8")) as
    | ExistingRow[]
    | { refs?: string[]; offers?: ExistingRow[] };
  const rows: ExistingRow[] = Array.isArray(parsed) ? parsed : parsed.offers ?? [];
  const refs = new Set<string>(Array.isArray(parsed) ? [] : parsed.refs ?? []);
  for (const r of rows) if (r.ref) refs.add(r.ref);
  return {
    refs,
    offers: rows.map((r) => ({
      title: r.title ?? "",
      company: r.company ?? "",
      location: r.location ?? ""
    }))
  };
}

/**
 * Rejets fermes appliqués **avant** le scoring, pour pouvoir en afficher le motif.
 *
 * `score.ts` écarte déjà le temps partiel et le travail de week-end ; les retester
 * ici n'ajoute aucune règle (les regex viennent du même `config.ts`) mais produit
 * un décompte par motif dans le rapport de la tâche planifiée. Sans lui, une
 * collecte qui perd la moitié de ses offres ressemble à une panne d'extracteur.
 *
 * Deux motifs n'existent qu'ici, propres au vivier navigateur : l'intérim et le
 * salaire sous le SMIC. Le run automatique les score (l'API publie un contrat
 * fiable, et un sous-SMIC y est souvent une erreur de libellé) ; dans cette passe,
 * ils ne valent plus l'occupation d'un slot.
 *
 * Renvoie le motif de rejet, ou null si l'offre est conservée.
 */
function rejectUpfront(o: NormalizedOffer): string | null {
  const full = `${o.title} ${o.description ?? ""}`;
  if (o.type !== "Alimentaire") return "profil abandonné (dev)";
  if (o.contract === "Intérim") return "intérim";
  if (WEEKEND_WORK_RE.test(full)) return "week-end travaillé";
  if (PART_TIME_RE.test(full)) return "temps partiel";
  const parsed = parseSalary(o.salary);
  // Tolérance de 2 % : un taux horaire au SMIC exact reconverti en mensuel
  // retombe à quelques centimes sous le seuil (même raison que SALARY_TIERS).
  if (parsed && parsed.monthlyGross < SMIC.monthlyGross35h * 0.98) return "sous le SMIC";
  return null;
}

const city = CITIES.lyon;
const raw = JSON.parse(readFileSync(RAW_FILE, "utf-8")) as NormalizedOffer[];
const existing = readExisting(EXISTING_FILE);

console.log(`=== Sélection passe navigateur — ${raw.length} offres brutes depuis ${RAW_FILE} ===`);
console.log(`Existant Notion : ${existing.refs.size} réf. connues, ${existing.offers.length} lignes.`);

const kept: NormalizedOffer[] = [];
const rejects: Record<string, number> = {};
for (const o of raw) {
  const reason = rejectUpfront(o);
  if (reason) {
    rejects[reason] = (rejects[reason] ?? 0) + 1;
    continue;
  }
  kept.push(o);
}
const rejectSummary = Object.entries(rejects).map(([k, n]) => `${n} ${k}`);
console.log(
  `Conditions : ${kept.length} conservée(s)` +
    (rejectSummary.length ? `, écartées → ${rejectSummary.join(", ")}.` : ".")
);

const { scored, selected, duplicates } = selectOffers(kept, city, existing, MAX_SELECT, MIN_SCORE);

console.log(
  `${kept.length} brutes → ${scored.length} scorées, ${duplicates} doublon(s), ` +
    `${selected.length} retenue(s) (seuil ${MIN_SCORE}, plafond ${MAX_SELECT}).`
);
for (const o of selected) {
  console.log(
    `  ${String(o.score).padStart(3)}  ${o.sector} — ${o.title} — ` +
      `${o.company || "?"} (${o.location}) ${o.contract ?? "contrat n.c."} ` +
      `${o.rhythm ?? "rythme n.c."} ${o.source} ${o.ref}`
  );
}

writeFileSync(OUT_FILE, JSON.stringify(selected, null, 2), "utf-8");
console.log(`Écrit : ${OUT_FILE}`);
