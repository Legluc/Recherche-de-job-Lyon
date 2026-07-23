import type { JobType } from "./types";

/**
 * Filtres métier. La zone "≤ 45 min en transport sans voiture" est approximée par une
 * liste de communes bien desservies (TCL/TER) + préfixes de code postal, plutôt qu'un
 * vrai calcul d'isochrone (compromis simplicité / maintenabilité pour la v1).
 */
export interface Filters {
  maxDaysOld: number;
  communesWhitelist: string[]; // en minuscules
  postalPrefixes: string[];
  alimentaireExclude: string[]; // mots-clés éliminatoires pour l'alimentaire
}

export const FILTERS: Filters = {
  maxDaysOld: 14,
  communesWhitelist: [
    "lyon", "villeurbanne", "vénissieux", "venissieux", "bron", "vaulx-en-velin",
    "caluire-et-cuire", "caluire", "oullins", "pierre-bénite", "pierre-benite",
    "saint-fons", "rillieux-la-pape", "rillieux", "décines-charpieu", "décines", "decines",
    "meyzieu", "écully", "ecully", "tassin-la-demi-lune", "tassin",
    "sainte-foy-lès-lyon", "sainte-foy-les-lyon", "saint-priest", "chassieu", "corbas",
    "feyzin", "la mulatière", "la mulatiere", "francheville", "craponne",
    "genas", "saint-genis-laval", "beynost", "neuville-sur-saône", "neuville-sur-saone",
    "jonage", "limonest"
  ],
  postalPrefixes: ["69", "01700"], // Rhône + Beynost (Ain, accessible en TER)
  alimentaireExclude: [
    "nuit", "de nuit", "3x8", "2x8", "posté", "week-end", "weekend", "dimanche",
    "btp", "chantier", "maçon", "macon", "couvreur", "restauration", "cuisinier",
    "commis", "serveur", "serveuse", "plonge", "plongeur"
  ]
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
