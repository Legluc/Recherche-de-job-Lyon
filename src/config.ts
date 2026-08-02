import type { JobType } from "./types";

/**
 * Filtres métier communs à toutes les villes. La zone géographique, elle, est
 * définie par ville dans cities.ts (approximation par whitelist de communes +
 * préfixes postaux, plutôt qu'un vrai calcul d'isochrone : compromis simplicité /
 * maintenabilité).
 */
export interface Filters {
  maxDaysOld: number;
  alimentaireExclude: string[]; // mots-clés éliminatoires pour l'alimentaire
}

export const FILTERS: Filters = {
  maxDaysOld: 14,
  alimentaireExclude: [
    "nuit", "de nuit", "3x8", "2x8", "posté", "week-end", "weekend", "dimanche",
    "btp", "chantier", "maçon", "macon", "couvreur", "restauration", "cuisinier",
    "commis", "serveur", "serveuse", "plonge", "plongeur"
  ]
};

/**
 * Garde-fous de volume. Sans plafond, une recherche large (vendeur, préparateur…)
 * insère des centaines d'offres par run et sature le tracker. On ne garde que les
 * meilleures par score, au-dessus d'un seuil minimal.
 */
export const LIMITS = {
  minScore: 70, // en-dessous : écarté (offres peu pertinentes / trop anciennes)
  maxInsert: 20 // plafond d'insertions par run et par ville (surchargeable via MAX_INSERT)
};

/** Requêtes (mots-clés) par type. Dérivées du profil de Lucas (stack + expériences). */
export const QUERIES: Record<JobType, string[]> = {
  Dev: [
    "développeur web", "intégrateur web", "développeur wordpress",
    "développeur front-end", "développeur vue.js", "développeur javascript junior"
  ],
  Alimentaire: [
    "conseiller clientèle", "téléconseiller", "vendeur", "employé libre service",
    "préparateur de commandes", "manutentionnaire", "hôte d'accueil", "agent de production"
  ]
};

/**
 * Contrats non recherchés (alternance, apprentissage, stage, freelance, VIE).
 * Détectés aussi dans le texte, car les sources ne typent pas toujours le contrat
 * (Adzuna renvoie souvent un type vide alors que le titre annonce "Alternance – ...").
 */
export const UNWANTED_CONTRACT_RE =
  /alternan|apprentissage|apprenti\b|contrat pro|professionnalisation|\bstages?\b|stagiaire|freelance|ind[ée]pendant|\bv\.?i\.?e\.?\b/i;
export const UNWANTED_CONTRACT_MALUS = 25;

/**
 * Postes d'encadrement : hors cible pour un emploi alimentaire (exigent de
 * l'expérience managériale) comme pour un profil dev junior.
 */
export const MANAGEMENT_RE = /\b(responsable|manager|directeur|directrice|chef de|superviseur|encadrant)\b/i;
export const MANAGEMENT_MALUS = 20;

/**
 * Postes commerciaux terrain / B2B : hors expérience de Lucas (call center,
 * retail, usine). Note : Lucas a le permis B mais pas de véhicule — on ne
 * pénalise donc que l'exigence d'un véhicule personnel, pas celle du permis.
 */
export const FIELD_SALES_RE =
  /itin[ée]rant|b2b|business developer|technico-commercial|n[ée]gociateur|porte[- ]?[àa][- ]?porte|prospection terrain|v[ée]hicule (personnel|obligatoire|de fonction exig)/i;
export const FIELD_SALES_MALUS = 20;

/** Détection de pertinence dev et de correspondance avec la stack de Lucas. */
export const DEV_RELEVANT = /développ|integrat|intégrat|front|full[- ]?stack|back[- ]?end|web|logiciel|software|react|vue|angular|php|wordpress|javascript|typescript|node/i;
export const DEV_STACK = /vue|astro|wordpress|php|javascript|typescript|tailwind|react|front|intégrat|integrat|symfony|laravel|node|nuxt/i;

/** Classification sectorielle pour l'alimentaire (ordre = priorité). */
export const SECTOR_KEYWORDS: Array<{ sector: string; re: RegExp }> = [
  { sector: "Call center", re: /téléconseil|conseiller client|centre d.appel|relation client|télévente|hotline|chargé de clientèle/i },
  { sector: "Retail", re: /vendeu|libre[- ]?service|employé de rayon|caisse|conseiller de vente|magasin/i },
  { sector: "Usine/Logistique", re: /préparateur|cariste|opérateur|production|conditionnement|logistique|entrepôt|fabrication/i },
  { sector: "Accueil", re: /accueil|standard|hôte|hôtesse/i },
  { sector: "Manutention", re: /manuten|magasinier/i }
];
