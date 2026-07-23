/** Type de recherche : emploi alimentaire (priorité) ou poste de dev. */
export type JobType = "Dev" | "Alimentaire";

export type Contract = "CDI" | "CDD" | "Alternance" | "Intérim" | "Autre";

/** Offre normalisée, format pivot commun à toutes les sources. */
export interface NormalizedOffer {
  source: "France Travail" | "Adzuna";
  ref: string; // identifiant unique stable : "ft:<id>" ou "adzuna:<id>"
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

/** Offre normalisée enrichie du secteur et du score. */
export interface ScoredOffer extends NormalizedOffer {
  sector: string;
  score: number;
}
