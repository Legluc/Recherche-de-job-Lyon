/**
 * Sélection des offres collectées au navigateur (Indeed, HelloWork, Choisir le
 * service public, Jobs That Make Sense).
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
import { rejectReason } from "./score";
import { CITIES } from "./cities";
import { SMIC } from "./config";
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
 * Pourquoi plus haut ici : les cartes Indeed publient rarement de quoi déclencher
 * les bonus de conditions (salaire lisible, mention du rythme), donc les scores
 * s'y tassent sur un palier au lieu de s'étaler. Un seuil légèrement supérieur
 * écarte ce palier bas sans toucher au run automatique, dont le vivier est déjà
 * filtré côté requêtes API.
 *
 * À revoir si la passe remonte régulièrement zéro offre — le filet serait fermé,
 * pas resserré.
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

const city = CITIES.lyon;

/**
 * Rejets fermes appliqués **avant** le scoring, pour pouvoir en afficher le motif.
 *
 * Tous les motifs viennent de `rejectReason` (score.ts), le même point d'entrée
 * que celui de `scoreOffer` : aucune règle n'est réécrite ici, le script ne fait
 * que compter. Sans ce décompte, une collecte qui perd la moitié de ses offres
 * ressemble à une panne d'extracteur.
 *
 * Un seul motif n'existe qu'ici : le salaire affiché sous le SMIC. Le run
 * automatique le note avec un malus (un sous-SMIC y est souvent une erreur de
 * libellé de l'API) ; dans cette passe, il ne vaut plus l'occupation d'un slot.
 */
function rejectUpfront(o: NormalizedOffer): string | null {
  const reason = rejectReason(o, city);
  if (reason) return reason;
  const parsed = parseSalary(o.salary);
  // Tolérance de 2 % : un taux horaire au SMIC exact reconverti en mensuel
  // retombe à quelques centimes sous le seuil (même raison que SALARY_TIERS).
  if (parsed && parsed.monthlyGross < SMIC.monthlyGross35h * 0.98) return "sous le SMIC";
  return null;
}

const raw = JSON.parse(readFileSync(RAW_FILE, "utf-8")) as NormalizedOffer[];
const existing = readExisting(EXISTING_FILE);

console.log(`=== Sélection passe navigateur — ${raw.length} offres brutes depuis ${RAW_FILE} ===`);
console.log(`Existant Notion : ${existing.refs.size} réf. connues, ${existing.offers.length} lignes.`);

const bySource: Record<string, number> = {};
for (const o of raw) bySource[o.source] = (bySource[o.source] ?? 0) + 1;
console.log(`Par source : ${Object.entries(bySource).map(([k, n]) => `${k} ${n}`).join(", ") || "aucune"}.`);

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
const rejectSummary = Object.entries(rejects)
  .sort((a, b) => b[1] - a[1])
  .map(([k, n]) => `${n} ${k}`);
console.log(
  `Rejets fermes : ${kept.length} conservée(s)` +
    (rejectSummary.length ? `, écartées → ${rejectSummary.join(", ")}.` : ".")
);

const { scored, selected, duplicates } = selectOffers(kept, city, existing, MAX_SELECT, MIN_SCORE);
const belowThreshold = scored.filter((o) => o.score < MIN_SCORE).length;

console.log(
  `${kept.length} conservées → ${scored.length} scorées, ${belowThreshold} sous le seuil, ` +
    `${duplicates} doublon(s), ${selected.length} retenue(s) (seuil ${MIN_SCORE}, plafond ${MAX_SELECT}).`
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
