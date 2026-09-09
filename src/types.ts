/** Type de recherche : emploi alimentaire (financement de l'installation) ou poste de dev. */
export type JobType = "Dev" | "Alimentaire";

export type Contract = "CDI" | "CDD" | "Alternance" | "Intérim" | "Autre";

/** Rythme de travail déduit du texte de l'offre. */
export type WorkRhythm = "Week-ends libres" | "Week-end travaillé" | "Non précisé";

/** Offre normalisée, format pivot commun à toutes les sources. */
export interface NormalizedOffer {
  /**
   * Origine de l'offre. Les deux premières valeurs viennent des API, les autres
   * de la passe navigateur, qui alimente le même pipeline via `ingest-file.ts` /
   * `select-web.ts`. La liste reproduit exactement les options de la propriété
   * `Source` du tracker : une valeur hors liste ferait rejeter la page entière
   * par l'API Notion.
   */
  source: "France Travail" | "Adzuna" | "Indeed" | "WTTJ" | "HelloWork" | "Agence web";
  ref: string; // identifiant unique stable : "ft:<id>", "adzuna:<id>", "indeed:<id>", "wttj:<slug>"
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
  rhythm?: WorkRhythm;
  partTime?: boolean;
}
