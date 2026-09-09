import { scoreOffer } from "./score";
import { LIMITS, MIN_SCORE_BY_TYPE, INSERT_SHARE } from "./config";
import { DedupIndex } from "./dedup";
import type { CityConfig } from "./cities";
import type { JobType, NormalizedOffer, ScoredOffer } from "./types";
import type { ExistingIndex } from "./notion";

export interface SelectionResult {
  scored: ScoredOffer[]; // retenues après filtrage/scoring
  selected: ScoredOffer[]; // nouvelles, dédupliquées, plafonnées
  duplicates: number; // écartées comme doublons (ID ou dédup floue)
  /** Nombre d'offres retenues par profil, pour les logs. */
  byType: Record<JobType, number>;
}

function minScoreFor(type: JobType): number {
  return MIN_SCORE_BY_TYPE[type] ?? LIMITS.minScore;
}

/**
 * Traitement commun à toutes les sources (run automatique ou ingestion d'un
 * fichier collecté via le navigateur) : scoring, tri, déduplication, plafond.
 *
 * Le tri par score précède la déduplication : entre deux variantes d'une même
 * annonce, on conserve celle qui est la mieux notée (souvent l'employeur direct
 * plutôt que l'intermédiaire, car mieux renseignée).
 *
 * La sélection se fait en **deux passes** : la première respecte le quota par
 * profil (INSERT_SHARE), la seconde redistribue les slots non consommés. Sans
 * cela, le vivier alimentaire — bien plus large depuis l'élargissement des
 * requêtes — remplirait à lui seul le plafond et masquerait les offres dev.
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
  const byType: Record<JobType, number> = { Dev: 0, Alimentaire: 0 };
  const quota: Record<JobType, number> = {
    Dev: Math.round(maxInsert * INSERT_SHARE.Dev),
    Alimentaire: Math.round(maxInsert * INSERT_SHARE.Alimentaire)
  };
  let duplicates = 0;

  // Les candidates éligibles sont calculées une fois : la seconde passe repart de
  // cette liste sans re-tester ce qui a déjà été écarté (doublon ou hors seuil).
  const eligible = scored.filter((o) => o.score >= minScoreFor(o.type));
  const taken = new Set<ScoredOffer>();

  const consider = (o: ScoredOffer, respectQuota: boolean): void => {
    if (taken.has(o) || selected.length >= maxInsert) return;
    if (respectQuota && byType[o.type] >= quota[o.type]) return;
    if (existing.refs.has(o.ref) || index.isDuplicate(o)) {
      duplicates++;
      taken.add(o); // écartée définitivement : ne pas la recompter en seconde passe
      return;
    }
    index.add(o);
    taken.add(o);
    selected.push(o);
    byType[o.type]++;
  };

  for (const o of eligible) consider(o, true); // passe 1 : quotas respectés
  for (const o of eligible) consider(o, false); // passe 2 : slots restants

  // La seconde passe rompt l'ordre du tri : on le rétablit pour que le tracker
  // reçoive les offres de la mieux notée à la moins bien notée.
  selected.sort((a, b) => b.score - a.score);

  return { scored, selected, duplicates, byType };
}
