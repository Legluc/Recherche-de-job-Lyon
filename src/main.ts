import { fetchAdzuna } from "./sources/adzuna";
import { fetchFranceTravail } from "./sources/francetravail";
import { getExistingIndex, insertOffers } from "./notion";
import { selectOffers } from "./pipeline";
import { LIMITS } from "./config";
import { getCity } from "./cities";
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

async function main(): Promise<void> {
  // Une exécution = une ville (CITY=lyon|annecy). Logs isolés, et l'échec d'une
  // ville n'empêche pas l'autre de tourner (jobs distincts dans le workflow).
  const city = getCity(process.env.CITY || "lyon");
  const env = requireEnv([
    "FT_CLIENT_ID",
    "FT_CLIENT_SECRET",
    "ADZUNA_APP_ID",
    "ADZUNA_APP_KEY",
    "NOTION_TOKEN",
    city.notionDbEnv
  ]);
  const databaseId = env[city.notionDbEnv];
  console.log(`=== ${city.label} — profils : ${city.types.join(", ")} ===`);

  const raw: NormalizedOffer[] = [];
  for (const type of city.types) {
    // Une source ne doit pas faire tomber l'autre -> allSettled.
    const results = await Promise.allSettled([
      fetchFranceTravail(env, type, city),
      fetchAdzuna(env, type, city)
    ]);
    for (const r of results) {
      if (r.status === "fulfilled") raw.push(...r.value);
      else console.warn(`[collecte] ${city.label} ${type} -> ${String(r.reason)}`);
    }
  }
  console.log(`Collecté ${raw.length} offres brutes (France Travail + Adzuna).`);

  // Dédup contre l'existant Notion. getExistingIndex lève une erreur si la lecture
  // échoue : on préfère abandonner le run plutôt qu'insérer à l'aveugle (anti-flood).
  const existing = await getExistingIndex(env, databaseId);
  const maxInsert = Number(process.env.MAX_INSERT) || LIMITS.maxInsert;
  const { scored, selected, duplicates } = selectOffers(raw, city, existing, maxInsert);

  console.log(`${scored.length} offres retenues après filtrage/scoring.`);
  console.log(`${duplicates} écartées (déjà connues ou doublons), plafond ${maxInsert}.`);

  const inserted = await insertOffers(env, databaseId, selected);
  console.log(`OK : ${inserted} offres insérées dans Notion (${city.label}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
