import { fetchAdzuna } from "./sources/adzuna";
import { fetchFranceTravail } from "./sources/francetravail";
import { scoreOffer } from "./score";
import { getExistingRefs, insertOffers } from "./notion";
import type { JobType, NormalizedOffer, ScoredOffer } from "./types";

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
  const env = requireEnv([
    "FT_CLIENT_ID",
    "FT_CLIENT_SECRET",
    "ADZUNA_APP_ID",
    "ADZUNA_APP_KEY",
    "NOTION_TOKEN",
    "NOTION_DATABASE_ID"
  ]);

  // Alimentaire d'abord (priorité n°1), puis dev.
  const types: JobType[] = ["Alimentaire", "Dev"];
  const raw: NormalizedOffer[] = [];
  for (const type of types) {
    // Une source ne doit pas faire tomber l'autre -> allSettled.
    const results = await Promise.allSettled([fetchFranceTravail(env, type), fetchAdzuna(env, type)]);
    for (const r of results) {
      if (r.status === "fulfilled") raw.push(...r.value);
      else console.warn(`[collecte] ${type} -> ${String(r.reason)}`);
    }
  }
  console.log(`Collecté ${raw.length} offres brutes (France Travail + Adzuna).`);

  // Scoring + filtrage + dédup intra-run.
  const scored: ScoredOffer[] = [];
  const seenRef = new Set<string>();
  for (const o of raw) {
    if (seenRef.has(o.ref)) continue;
    seenRef.add(o.ref);
    const s = scoreOffer(o);
    if (s) scored.push(s);
  }
  console.log(`${scored.length} offres retenues après filtrage/scoring.`);

  // Dédup contre l'existant Notion.
  const existing = await getExistingRefs(env);
  const fresh = scored
    .filter((o) => !existing.has(o.ref))
    .sort((a, b) => b.score - a.score);
  console.log(`${fresh.length} nouvelles offres à insérer (après dédup Notion).`);

  const inserted = await insertOffers(env, fresh);
  console.log(`OK : ${inserted} offres insérées dans Notion.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
