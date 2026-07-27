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
  minScore: 60, // en-dessous : écarté (offres peu pertinentes / trop anciennes)
  maxInsert: 60 // plafond d'insertions par run et par ville (surchargeable via MAX_INSERT)
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
 * Alternance / apprentissage : non recherché. Détecté aussi dans le texte, car les
 * sources ne typent pas toujours le contrat (Adzuna renvoie souvent un type vide
 * alors que le titre annonce "Alternance – ..."). Malus volontairement fort : il
 * fait passer ces offres sous LIMITS.minScore, donc elles sortent du tracker.
 */
export const ALTERNANCE_RE = /alternan|apprentissage|apprenti\b|contrat pro|professionnalisation/i;
export const ALTERNANCE_MALUS = 25;

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
