import type { JobType } from "./types";

/**
 * Filtres métier communs. La zone géographique, elle, est définie par ville dans
 * cities.ts (approximation par whitelist de communes + préfixes postaux, plutôt
 * qu'un vrai calcul d'isochrone : compromis simplicité / maintenabilité).
 */
export interface Filters {
  maxDaysOld: number;
  alimentaireExclude: string[]; // mots-clés éliminatoires pour l'alimentaire
}

export const FILTERS: Filters = {
  maxDaysOld: 14,
  /**
   * Rejet ferme : rythmes incompatibles avec une recherche d'emploi dev en
   * parallèle (nuit, équipes postées) et métiers physiques hors cible.
   *
   * "week-end" / "dimanche" ont été **retirés** de cette liste : la recherche par
   * sous-chaîne rejetait aussi les offres qui annoncent « week-ends non
   * travaillés » — exactement celles qu'on veut remonter. Le rythme est désormais
   * traité en pondération (WEEKEND_FREE_RE / WEEKEND_WORK_RE), pas en exclusion.
   */
  alimentaireExclude: [
    "nuit", "de nuit", "3x8", "2x8", "posté",
    "btp", "chantier", "maçon", "macon", "couvreur", "échafaudage",
    "restauration", "cuisinier", "commis", "serveur", "serveuse", "plonge", "plongeur"
  ]
};

/**
 * SMIC en vigueur (revalorisation du 1er juin 2026, source info.gouv.fr).
 * Référence unique pour tout le scoring salaire : une seule ligne à mettre à jour
 * à la prochaine revalorisation.
 */
export const SMIC = {
  hourlyGross: 12.31,
  monthlyGross35h: 1867.02,
  since: "2026-06-01"
};

/**
 * Bonus salaire, en rapport au SMIC mensuel brut (borne basse de la fourchette
 * annoncée, cf. salary.ts). Un emploi alimentaire ne se juge pas seulement sur
 * l'existence d'un salaire affiché mais sur son niveau réel : c'est le premier
 * critère de tri après la zone géographique.
 *
 * Le palier « au SMIC » démarre à 0,98 et non 1,00 : un taux horaire au SMIC
 * exact (12,31 €) reconverti en mensuel retombe à quelques centimes près sous
 * 1 867,02 € et ne doit pas être traité comme un salaire sous-SMIC.
 */
export const SALARY_TIERS: Array<{ minRatio: number; points: number; label: string }> = [
  { minRatio: 1.30, points: 22, label: "SMIC +30 % et plus" },
  { minRatio: 1.15, points: 16, label: "SMIC +15 %" },
  { minRatio: 1.05, points: 8, label: "SMIC +5 %" },
  { minRatio: 0.98, points: 2, label: "au SMIC" },
  { minRatio: 0, points: -12, label: "sous le SMIC" }
];

/** Salaire affiché mais illisible ("selon profil") : transparence saluée, sans plus. */
export const SALARY_DISPLAYED_POINTS = 3;

/**
 * Rythme de travail. Les week-ends libres conditionnent la disponibilité pour les
 * entretiens, les tests techniques et les projets perso : critère de conditions,
 * au même titre que le salaire.
 *
 * Le travail le week-end n'est pas éliminatoire mais fortement pénalisé — la
 * passe de tri IA en aval peut repêcher une offre par ailleurs excellente.
 */
export const WEEKEND_FREE_RE =
  /du lundi au vendredi|lundi (?:au|à) vendredi|week[- ]?ends? (?:libres?|non travaill|de repos|off)|repos (?:le |les )?week[- ]?end|samedi et dimanche (?:non travaill|de repos|libres)|2 jours de repos cons[ée]cutifs|horaires? de bureau/i;
export const WEEKEND_WORK_RE =
  /travail (?:le |les )?(?:samedi|dimanche|week[- ]?end)|samedis? travaill|dimanches? travaill|week[- ]?ends? travaill|1 samedi sur|un samedi sur|(?:ouvert|amplitude) 7 ?j|7j\/7|roulement week[- ]?end/i;
export const WEEKEND_FREE_POINTS = 12;
export const WEEKEND_WORK_MALUS = 15;

/**
 * Temps partiel : rémunération mensuelle mécaniquement sous le SMIC et revenu
 * insuffisant pour financer l'installation. Malus, et neutralisation du malus
 * « sous le SMIC » (sinon la même offre est pénalisée deux fois pour un seul fait).
 */
export const PART_TIME_RE =
  /temps partiel|mi[- ]temps|(?:1[0-9]|2[0-9]|3[0-4]) ?h(?:eures)? ?(?:\/| par | hebdo)? ?(?:semaine|hebdomadaire)|20h\/semaine|24h\/semaine/i;
export const PART_TIME_MALUS = 10;

/**
 * Fraîcheur de l'offre. `unknown` s'applique aux sources qui ne publient pas de
 * date (cartes Indeed collectées au navigateur) : même raisonnement que pour le
 * contrat inconnu, une information absente ne doit pas coûter 15 points, sans quoi
 * toute une source passe sous le seuil pour une lacune de format. La fraîcheur est
 * alors garantie en amont par le filtre de la requête de collecte.
 */
export const FRESHNESS_POINTS = { recent: 15, week: 8, older: 0, unknown: 8 };

/**
 * Garde-fous de volume. Sans plafond, une recherche large insère des centaines
 * d'offres par run et sature le tracker.
 */
export const LIMITS = {
  minScore: 70, // seuil par défaut
  maxInsert: 20 // plafond d'insertions par run (surchargeable via MAX_INSERT)
};

/**
 * Seuil minimal par type. L'alimentaire est plus exigeant que le dev : le vivier
 * est large (beaucoup d'offres génériques), et une offre alimentaire ne mérite
 * une candidature que si les conditions (salaire, rythme, contrat) sont bonnes.
 */
export const MIN_SCORE_BY_TYPE: Record<JobType, number> = {
  Dev: 70,
  Alimentaire: 80
};

/**
 * Répartition du plafond d'insertion entre profils. L'élargissement des requêtes
 * alimentaires produit beaucoup plus de candidats qu'auparavant : sans quota, ce
 * flux noierait les offres dev, qui restent l'objectif. La part non consommée par
 * un type est réattribuée à l'autre (aucun slot perdu).
 */
export const INSERT_SHARE: Record<JobType, number> = {
  Dev: 0.5,
  Alimentaire: 0.5
};

/**
 * Requêtes (mots-clés) par type.
 *
 * L'alimentaire ne se limite plus aux secteurs déjà pratiqués (call center,
 * retail, usine) : une passe de tri IA intervient en aval, le coût d'un
 * faux positif est donc faible face au coût d'une offre jamais collectée. On
 * ratisse large sur les intitulés, quitte à filtrer sévèrement sur les conditions.
 */
export const QUERIES: Record<JobType, string[]> = {
  Dev: [
    "développeur web", "intégrateur web", "développeur wordpress",
    "développeur front-end", "développeur vue.js", "développeur javascript junior"
  ],
  Alimentaire: [
    // Relation client (expérience acquise)
    "conseiller clientèle", "téléconseiller", "chargé de clientèle", "service client",
    "chargé de recouvrement", "enquêteur téléphonique",
    // Support informatique : passerelle directe vers le CV dev
    "support technique", "technicien support informatique", "helpdesk", "technicien informatique",
    // Back-office, ADV, e-commerce : postes de bureau, souvent au-dessus du SMIC
    "assistant administratif", "agent administratif", "gestionnaire de dossiers",
    "administration des ventes", "assistant e-commerce", "opérateur de saisie",
    "gestionnaire back office", "gestionnaire de contrats", "conseiller commercial sédentaire",
    // Accueil
    "hôte d'accueil", "chargé d'accueil", "réceptionniste",
    // Retail
    "vendeur", "employé libre service", "hôte de caisse", "employé polyvalent",
    // Logistique / production
    "préparateur de commandes", "manutentionnaire", "magasinier", "agent de production",
    "agent logistique", "agent de tri", "opérateur de conditionnement",
    // Services
    "agent d'entretien", "livreur"
  ]
};

/**
 * Contrats non recherchés (alternance, apprentissage, stage, freelance, VIE).
 * Détectés aussi dans le texte, car les sources ne typent pas toujours le contrat
 * (Adzuna renvoie souvent un type vide alors que le titre annonce "Alternance – ...").
 * `intern`/`internship` couvre les annonces rédigées en anglais, que les jobboards
 * tech publient telles quelles.
 */
export const UNWANTED_CONTRACT_RE =
  /alternan|apprentissage|apprenti\b|contrat pro|professionnalisation|\bstages?\b|stagiaire|\bintern(?:ship)?\b|freelance|ind[ée]pendant|\bv\.?i\.?e\.?\b/i;
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
/** Séniorité : accents inclus ("Sénior" échappait au malus quand la regex était sans accent). */
export const DEV_SENIOR_RE = /s[ée]nior|lead|confirm[ée]|principal|architecte|expert/i;

/**
 * Classification sectorielle pour l'alimentaire (ordre = priorité, premier match
 * retenu). Les points varient par secteur : à conditions égales, un poste qui
 * nourrit le CV dev (support informatique, back-office e-commerce) ou qui se
 * déroule en bureau vaut mieux qu'un poste d'entrepôt. Le bonus reste modeste
 * face aux conditions (salaire jusqu'à +22, rythme +12) : le secteur oriente,
 * il ne décide pas.
 */
export interface SectorRule {
  sector: string;
  re: RegExp;
  points: number;
}

export const SECTOR_KEYWORDS: SectorRule[] = [
  {
    sector: "Support informatique",
    points: 14,
    re: /support (technique|informatique|utilisateur|n1|niveau 1)|helpdesk|hot ?line|technicien (informatique|support|de proximité)|assistance informatique|service desk/i
  },
  {
    sector: "Back-office / ADV",
    points: 10,
    re: /administration des ventes|\badv\b|back[- ]?office|gestionnaire de commandes|e[- ]?commerce|saisie|gestionnaire de dossiers|assistant commercial/i
  },
  {
    sector: "Banque / Assurance",
    points: 10,
    re: /banc?aire|banque|assurance|mutuelle|gestionnaire de contrats|sinistres|recouvrement|courtage/i
  },
  {
    sector: "Administratif",
    points: 8,
    re: /administratif|secr[ée]taire|assistant(e)? de gestion|employ[ée] de bureau|gestion administrative/i
  },
  {
    sector: "Call center",
    points: 6,
    re: /t[ée]l[ée]conseil|conseiller client|centre d.appel|relation client|t[ée]l[ée]vente|charg[ée] de client[èe]le|service client|enqu[êe]teur/i
  },
  {
    sector: "Accueil",
    points: 6,
    // "hôte" seul n'est pas retenu : "hôte de caisse" relève du retail, pas de
    // l'accueil. Toute vraie offre d'accueil contient "accueil" ou "réceptionniste".
    re: /accueil|standardiste|r[ée]ceptionniste/i
  },
  {
    sector: "Retail",
    points: 5,
    re: /vendeu|libre[- ]?service|de rayon|caisse|caissi[èe]r|conseiller de vente|magasin|employ[ée] (?:polyvalent|commercial|drive)|\bdrive\b/i
  },
  {
    sector: "Usine/Logistique",
    points: 5,
    re: /pr[ée]parat(?:eur|ion) de commandes|cariste|op[ée]rateur|production|conditionnement|logistique|entrep[ôo]t|fabrication|agent de tri/i
  },
  {
    sector: "Manutention",
    points: 4,
    re: /manuten|magasinier|livreur|chauffeur[- ]livreur/i
  },
  {
    sector: "Propreté / Services",
    points: 3,
    re: /agent d.entretien|nettoyage|propret[ée]|agent de service/i
  }
];
