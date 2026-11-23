/**
 * Profil recherché. Le dev a été abandonné (octobre 2026) : la recherche ne porte
 * plus que sur l'emploi alimentaire lyonnais. Le champ `type` est conservé dans le
 * modèle pivot parce que la propriété `Type` du tracker existe toujours et que
 * d'anciens lots collectés (data/web-raw.json) portent encore `"Dev"` : le
 * pipeline s'en sert pour écarter ces restes au lieu de les scorer par erreur.
 */
export type JobType = "Alimentaire";

export type Contract = "CDI" | "CDD" | "Alternance" | "Intérim" | "Autre";

/**
 * Rythme de travail déduit du texte de l'offre (critère revu en novembre 2026 :
 * le samedi est accepté, le dimanche doit rester libre).
 *
 * - "Week-ends libres" : lundi-vendredi prouvé, le meilleur cas.
 * - "Dimanche libre"   : repos dominical prouvé, samedi possiblement travaillé.
 * - "Dimanche travaillé" ne survit pas au scoring (rejet ferme, cf. score.ts) :
 *   la valeur existe pour nommer le motif dans les logs et les rapports.
 */
export type WorkRhythm = "Week-ends libres" | "Dimanche libre" | "Dimanche travaillé" | "Non précisé";

/**
 * Nature de l'employeur, déduite de la source, du nom et du texte de l'offre.
 * Sert à deux choses : le secteur affiché (Administration publique, Associatif)
 * et l'exception au rejet des CDD (contractuels publics, postes associatifs).
 */
export type EmployerKind = "Public" | "Associatif" | "Privé";

/** Offre normalisée, format pivot commun à toutes les sources. */
export interface NormalizedOffer {
  /**
   * Origine de l'offre. Les deux premières valeurs viennent des API, les autres
   * de la passe navigateur, qui alimente le même pipeline via `ingest-file.ts` /
   * `select-web.ts`. La liste reproduit exactement les options de la propriété
   * `Source` du tracker : une valeur hors liste ferait rejeter la page entière
   * par l'API Notion. "WTTJ" et "Agence web" ne sont plus collectées (novembre
   * 2026) mais restent valides pour les lignes historiques du tracker.
   */
  source:
    | "France Travail"
    | "Adzuna"
    | "Indeed"
    | "HelloWork"
    | "Choisir le service public"
    | "Jobs That Make Sense"
    | "WTTJ"
    | "Agence web";
  // Identifiant unique stable : "ft:<id>", "adzuna:<id>", "indeed:<jk>",
  // "hellowork:<id>", "csp:<référence>", "jtms:<slug>".
  ref: string;
  type: JobType;
  title: string;
  company: string;
  location: string; // libellé de la commune / lieu de travail
  postalCode?: string;
  contract?: Contract;
  url: string;
  createdAt?: string; // date de publication (ISO 8601)
  salary?: string;
  description: string;
  contact?: string; // e-mail de contact si fourni par la source
  channel?: "Email" | "Formulaire" | "Plateforme"; // canal de candidature détecté
}

/** Offre normalisée enrichie du secteur, des conditions détectées et du score. */
export interface ScoredOffer extends NormalizedOffer {
  sector: string;
  score: number;
  /**
   * Salaire ramené en brut mensuel équivalent 35 h (borne basse de la fourchette),
   * quand le libellé de la source a pu être interprété. Sert au scoring et est
   * reporté dans le tracker pour la passe de tri.
   */
  monthlyGross?: number;
  /** Jamais "Dimanche travaillé" : ce cas est rejeté avant le scoring. */
  rhythm?: WorkRhythm;
  employer?: EmployerKind;
}
