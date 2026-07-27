import { scoreOffer } from "./score";
import { LIMITS } from "./config";
import { DedupIndex } from "./dedup";
import type { CityConfig } from "./cities";
import type { NormalizedOffer, ScoredOffer } from "./types";
import type { ExistingIndex } from "./notion";

export interface SelectionResult {
  scored: ScoredOffer[]; // retenues après filtrage/scoring
  selected: ScoredOffer[]; // nouvelles, dédupliquées, plafonnées
  duplicates: number; // écartées comme doublons (ID ou dédup floue)
}

/**
 * Traitement commun à toutes les sources (run automatique ou ingestion d'un
 * fichier collecté via le navigateur) : scoring, tri, déduplication, plafond.
 *
 * Le tri par score précède la déduplication : entre deux variantes d'une même
 * annonce, on conserve celle qui est la mieux notée (souvent l'employeur direct
 * plutôt que l'intermédiaire, car mieux renseignée).
 */
export function selectOffers(
  raw: NormalizedOffer[],
  city: CityConfig,
  existing: ExistingIndex,
  maxInsert: number
): SelectionResult {
  const scored: ScoredOffer[] = [];
  const seenRef = new Set<string>();
  for (const o of raw) {
    if (seenRef.has(o.ref)) continue; // même annonce vue deux fois dans le run
    seenRef.add(o.ref);
    const s = scoreOffer(o, city);
    if (s) scored.push(s);
  }

  scored.sort((a, b) => b.score - a.score);

  // L'index est amorcé avec l'existant Notion, puis enrichi au fil des retenues.
  const index = new DedupIndex(city);
  for (const o of existing.offers) index.add(o);

  const selected: ScoredOffer[] = [];
  let duplicates = 0;
  for (const o of scored) {
    if (o.score < LIMITS.minScore) continue;
    if (existing.refs.has(o.ref) || index.isDuplicate(o)) {
      duplicates++;
      continue;
    }
    index.add(o);
    selected.push(o);
    if (selected.length >= maxInsert) break;
  }

  return { scored, selected, duplicates };
}
