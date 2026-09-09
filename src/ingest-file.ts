/**
 * Ingestion d'offres collectées hors API (Indeed, Welcome to the Jungle...) via
 * une passe navigateur. Le navigateur ne fait que **collecter** ; tout le
 * traitement (filtres, scoring, déduplication, plafond) réutilise le même code
 * que le run automatique — aucune logique dupliquée entre les deux chemins.
 *
 * Usage :
 *   npm run ingest -- chemin/vers/offres.json
 *   DRY_RUN=1 npm run ingest -- offres.json   (aperçu, sans écriture)
 *
 * Format attendu : un tableau JSON d'objets
 *   { source, ref, type, title, company, location, contract?, url, createdAt?,
 *     salary?, description?, contact?, channel? }
 */
import { readFileSync } from "node:fs";
import { getExistingIndex, insertOffers } from "./notion";
import { selectOffers } from "./pipeline";
import { LIMITS } from "./config";
import { getCity, DEFAULT_CITY } from "./cities";
import type { NormalizedOffer } from "./types";

function requireEnv(keys: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  const missing: string[] = [];
  for (const k of keys) {
    const v = process.env[k];
    if (!v) missing.push(k);
    else env[k] = v;
  }
  if (missing.length) throw new Error(`Variables d'environnement manquantes : ${missing.join(", ")}`);
  return env;
}

const file = process.argv[2];
if (!file) throw new Error("Chemin du fichier JSON manquant. Exemple : npm run ingest -- offres.json");

const parsed = JSON.parse(readFileSync(file, "utf-8"));
const raw: NormalizedOffer[] = Array.isArray(parsed) ? parsed : parsed.offers;
if (!Array.isArray(raw)) throw new Error("Le fichier doit contenir un tableau d'offres (ou une clé \"offers\").");

const city = getCity(process.env.CITY || DEFAULT_CITY);
const dryRun = process.env.DRY_RUN === "1";
const env = requireEnv(dryRun ? [] : ["NOTION_TOKEN", city.notionDbEnv]);

console.log(`=== Ingestion ${city.label} — ${raw.length} offres brutes depuis ${file} ===`);

// En mode aperçu, on ne contacte pas Notion : index existant vide.
const existing = dryRun
  ? { refs: new Set<string>(), offers: [] }
  : await getExistingIndex(env, env[city.notionDbEnv]);

const maxInsert = Number(process.env.MAX_INSERT) || LIMITS.maxInsert;
const { scored, selected, duplicates, byType } = selectOffers(raw, city, existing, maxInsert);

console.log(`${scored.length} retenues après filtrage/scoring, ${duplicates} écartées (doublons).`);
console.log(`Répartition retenue : ${byType.Dev} dev / ${byType.Alimentaire} alimentaire.`);
for (const o of selected) {
  console.log(`  ${String(o.score).padStart(3)}  ${o.title} — ${o.company || "?"} (${o.location})`);
}

if (dryRun) {
  console.log("DRY_RUN : aucune écriture dans Notion.");
} else {
  const inserted = await insertOffers(env, env[city.notionDbEnv], selected);
  console.log(`OK : ${inserted} offres insérées dans Notion (${city.label}).`);
}
