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
 *   DEV_CAP=10 ALIM_CAP=4 npm run select-web
 *
 * Entrées  : data/web-raw.json (NormalizedOffer[]), data/notion-existing.json
 * Sortie   : data/web-selected.json (ScoredOffer[], triées par score décroissant)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { selectOffers } from "./pipeline";
import { CITIES } from "./cities";
import { PART_TIME_RE, SMIC } from "./config";
import { parseSalary } from "./salary";
import type { ExistingIndex } from "./notion";
import type { NormalizedOffer, ScoredOffer } from "./types";

const RAW_FILE = process.env.WEB_RAW || "data/web-raw.json";
const EXISTING_FILE = process.env.WEB_EXISTING || "data/notion-existing.json";
const OUT_FILE = process.env.WEB_OUT || "data/web-selected.json";

/**
 * Plafonds par profil. Le poste alimentaire d'Annecy étant décroché, le dev
 * redevient l'objectif : il prend la plus grosse part du plafond, et
 * l'alimentaire lyonnais n'est plus qu'un filet pour sécuriser l'installation.
 *
 * D'où deux appels successifs à `selectOffers` plutôt qu'un seul : la
 * redistribution des slots non consommés (INSERT_SHARE, cf. pipeline.ts) rendrait
 * au vivier alimentaire — beaucoup plus large — les places que le dev n'a pas
 * remplies, exactement l'inverse de l'arbitrage voulu ici. Les quotas sont donc
 * étanches, quitte à insérer moins que le plafond global.
 */
const DEV_CAP = Number(process.env.DEV_CAP) || 14;
const ALIM_CAP = Number(process.env.ALIM_CAP) || 6;

/**
 * Seuil alimentaire relevé au-dessus de MIN_SCORE_BY_TYPE.Alimentaire (80).
 * Un revenu étant déjà assuré, une offre alimentaire ne vaut une candidature que
 * si elle justifie à elle seule le déménagement. Le durcissement est appliqué ici
 * et non dans config.ts : il vise cette passe (recall large, sources sans API) et
 * ne doit pas resserrer le run automatique, dont le vivier est déjà filtré côté
 * requêtes API.
 *
 * Calibré à 84 et non plus haut sur rejeu de data/web-raw.json (71 offres) : les
 * scores alimentaires y plafonnent à 90 puis retombent sur un palier 80-84, parce
 * qu'une carte Indeed ou WTTJ publie rarement de quoi déclencher les bonus de
 * conditions (salaire lisible, week-ends libres). À 88, la passe n'aurait remonté
 * qu'une offre sur ce lot — le filet serait fermé, pas resserré.
 */
const ALIM_MIN_SCORE = Number(process.env.ALIM_MIN_SCORE) || 84;

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
 * Rejets fermes propres à l'alimentaire, appliqués **avant** le scoring.
 *
 * Ce sont des règles de collecte (ce qu'on refuse de considérer), pas de
 * pondération : score.ts pénalise le temps partiel et le sous-SMIC pour laisser
 * la passe de tri IA repêcher une offre par ailleurs excellente. Ici, ces cas ne
 * méritent plus d'être présentés du tout, et les écarter en amont évite qu'ils
 * consomment des places du quota alimentaire.
 *
 * Renvoie le motif de rejet, ou null si l'offre est conservée.
 */
function rejectAlimentaire(o: NormalizedOffer): string | null {
  if (o.contract === "Intérim") return "intérim";
  if (PART_TIME_RE.test(`${o.title} ${o.description ?? ""}`)) return "temps partiel";
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

const devRaw = raw.filter((o) => o.type === "Dev");
const alimRaw: NormalizedOffer[] = [];
const rejects: Record<string, number> = {};
for (const o of raw) {
  if (o.type !== "Alimentaire") continue;
  const reason = rejectAlimentaire(o);
  if (reason) {
    rejects[reason] = (rejects[reason] ?? 0) + 1;
    continue;
  }
  alimRaw.push(o);
}
const rejectSummary = Object.entries(rejects).map(([k, n]) => `${n} ${k}`);
console.log(
  `Conditions alimentaires : ${alimRaw.length} conservée(s)` +
    (rejectSummary.length ? `, écartées → ${rejectSummary.join(", ")}.` : ".")
);

// Passe 1 : dev, prioritaire.
const dev = selectOffers(devRaw, city, existing, DEV_CAP);

// Passe 2 : alimentaire, sur un index de dédup enrichi des retenues dev — sans
// quoi une même annonce classée dans les deux profils entrerait deux fois.
const afterDev: ExistingIndex = {
  refs: new Set([...existing.refs, ...dev.selected.map((o) => o.ref)]),
  offers: [
    ...existing.offers,
    ...dev.selected.map((o) => ({ title: o.title, company: o.company, location: o.location }))
  ]
};
const alim = selectOffers(alimRaw, city, afterDev, ALIM_CAP);
const alimSelected = alim.selected.filter((o) => o.score >= ALIM_MIN_SCORE);

const selected: ScoredOffer[] = [...dev.selected, ...alimSelected].sort((a, b) => b.score - a.score);

console.log(
  `Dev          : ${devRaw.length} brutes → ${dev.scored.length} scorées, ` +
    `${dev.duplicates} doublon(s), ${dev.selected.length} retenue(s) (plafond ${DEV_CAP}).`
);
console.log(
  `Alimentaire  : ${alimRaw.length} brutes → ${alim.scored.length} scorées, ` +
    `${alim.duplicates} doublon(s), ${alim.selected.length} retenue(s) puis ` +
    `${alimSelected.length} au-dessus de ${ALIM_MIN_SCORE} (plafond ${ALIM_CAP}).`
);
console.log(`Total à insérer : ${selected.length}`);
for (const o of selected) {
  console.log(
    `  ${String(o.score).padStart(3)}  [${o.type}] ${o.sector} — ${o.title} — ` +
      `${o.company || "?"} (${o.location}) ${o.contract ?? "contrat n.c."} ${o.source} ${o.ref}`
  );
}

writeFileSync(OUT_FILE, JSON.stringify(selected, null, 2), "utf-8");
console.log(`Écrit : ${OUT_FILE}`);
