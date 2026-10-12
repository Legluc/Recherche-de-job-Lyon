import type { JobType } from "./types";

/**
 * Filtres métier. La zone géographique, elle, est définie dans cities.ts
 * (approximation par whitelist de communes + préfixes postaux, plutôt qu'un vrai
 * calcul d'isochrone : compromis simplicité / maintenabilité).
 */
export interface Filters {
  maxDaysOld: number;
  hardExclude: string[]; // mots-clés éliminatoires
}

export const FILTERS: Filters = {
  maxDaysOld: 14,
  /**
   * Rejet ferme : rythmes incompatibles avec une vie de week-end (nuit, équipes
   * postées) et métiers physiques ou qualifiés hors cible.
   *
   * "week-end" / "dimanche" ne figurent PAS dans cette liste : la recherche par
   * sous-chaîne rejetterait aussi les annonces qui promettent « week-ends non
   * travaillés » — exactement celles qu'on cherche. Le travail de week-end est
   * écarté par WEEKEND_WORK_RE, qui ne matche que les formulations affirmatives.
   */
  hardExclude: [
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
 * annoncée, cf. salary.ts).
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
 * Rythme de travail — critère n°1 depuis octobre 2026 : seuls les postes qui
 * laissent les week-ends libres sont recherchés.
 *
 * Deux régimes volontairement asymétriques :
 * - `WEEKEND_WORK_RE` : **rejet ferme**. L'offre affirme travailler le samedi, le
 *   dimanche ou en roulement de week-end ; elle ne correspond pas à la recherche,
 *   la pondérer ne ferait que la faire remonter un jour où le vivier est maigre.
 *   La regex ne matche que des formulations affirmatives ("travail le samedi",
 *   "1 samedi sur 2") et jamais une promesse de repos.
 * - `WEEKEND_FREE_RE` : **bonus**. L'offre prouve le lundi-vendredi. Les annonces
 *   muettes sur le rythme (la grande majorité) ne sont ni rejetées ni bonifiées :
 *   les écarter viderait la collecte, et la passe de tri IA vérifie ensuite sur le
 *   texte complet de l'annonce.
 */
export const WEEKEND_FREE_RE =
  /du lundi au vendredi|lundi (?:au|à) vendredi|week[- ]?ends? (?:libres?|non travaill|de repos|off)|repos (?:le |les )?week[- ]?end|samedi et dimanche (?:non travaill|de repos|libres)|2 jours de repos cons[ée]cutifs|horaires? de bureau/i;
export const WEEKEND_WORK_RE =
  /travail (?:le |les )?(?:samedi|dimanche|week[- ]?end)|samedis? travaill|dimanches? travaill|week[- ]?ends? travaill|travaill[ée] le samedi|1 samedi sur|un samedi sur|samedi (?:matin )?(?:oblig|requis|impos)|disponible le samedi|du lundi au samedi|lundi (?:au|à) samedi|(?:ouvert|amplitude) 7 ?j|7j\/7|6 ?j(?:ours)? ?\/ ?7|roulement week[- ]?end/i;
export const WEEKEND_FREE_POINTS = 15;

/**
 * Temps partiel : **rejet ferme**. Le poste doit financer une installation à Lyon,
 * un mi-temps ne le permet pas. Le silence de l'annonce sur la durée vaut temps
 * plein : c'est la norme des offres, et exiger la mention explicite écarterait
 * l'essentiel du vivier.
 */
export const PART_TIME_RE =
  /temps partiel|mi[- ]temps|(?:1[0-9]|2[0-9]|3[0-4]) ?h(?:eures)? ?(?:\/| par | hebdo)? ?(?:semaine|hebdomadaire)|20h\/semaine|24h\/semaine/i;

/**
 * Garde-fous de volume et seuil de sélection.
 *
 * `minScore` à 80 : plus exigeant que l'ancien seuil commun (70), parce qu'une
 * offre alimentaire ne vaut une candidature que si les conditions suivent
 * (salaire au-dessus du SMIC, rythme, contrat). La passe navigateur relève encore
 * ce seuil pour son propre vivier (cf. select-web.ts).
 */
export const LIMITS = {
  minScore: 80,
  maxInsert: 20 // plafond d'insertions par run (surchargeable via MAX_INSERT)
};

/**
 * Fraîcheur de l'offre. `unknown` s'applique aux sources qui ne publient pas de
 * date (cartes Indeed collectées au navigateur) : même raisonnement que pour le
 * contrat inconnu, une information absente ne doit pas coûter 15 points, sans quoi
 * toute une source passe sous le seuil pour une lacune de format. La fraîcheur est
 * alors garantie en amont par le filtre de la requête de collecte.
 */
export const FRESHNESS_POINTS = { recent: 15, week: 8, older: 0, unknown: 8 };

/**
 * Requêtes de collecte.
 *
 * Deux principes, issus de l'abandon du dev (octobre 2026) :
 * - **Large sur les intitulés.** Une passe de tri IA intervient en aval : le coût
 *   d'un faux positif est faible face à celui d'une offre jamais collectée. On
 *   ratisse donc des secteurs jamais exercés (support informatique, back-office,
 *   ADV, banque/assurance, administratif, tri, propreté).
 * - **Strict sur les conditions.** La vente en magasin, la grande distribution,
 *   la boulangerie et l'hôtellerie ont été **retirées** de cette liste : ces
 *   métiers travaillent le samedi par construction, et les collecter revenait à
 *   remplir le tracker d'offres que le filtre de rythme écarte ensuite une par
 *   une. Ne pas les réintroduire sans changer le critère de week-end.
 */
export const QUERIES: Record<JobType, string[]> = {
  Alimentaire: [
    // Relation client à distance (expérience Phone Design / téléphonie)
    "conseiller clientèle", "téléconseiller", "chargé de clientèle", "service client",
    "chargé de recouvrement", "enquêteur téléphonique",
    // Support informatique : secteur de bureau, horaires ouvrés
    "support technique", "technicien support informatique", "helpdesk", "technicien informatique",
    // Back-office, ADV, e-commerce, administratif : lundi-vendredi par nature
    "assistant administratif", "agent administratif", "gestionnaire de dossiers",
    "administration des ventes", "assistant commercial", "assistant e-commerce",
    "opérateur de saisie", "gestionnaire back office", "gestionnaire de contrats",
    "agent de facturation", "conseiller commercial sédentaire",
    // Accueil d'entreprise (l'hôtellerie est exclue : week-ends)
    "hôte d'accueil", "chargé d'accueil",
    // Logistique et production en journée (expérience Sudcosmetics)
    "préparateur de commandes", "manutentionnaire", "magasinier", "agent de production",
    "agent logistique", "agent de tri", "opérateur de conditionnement",
    // Services
    "agent d'entretien"
  ]
};

/**
 * Contrats non recherchés (alternance, apprentissage, stage, freelance, VIE).
 * Détectés aussi dans le texte, car les sources ne typent pas toujours le contrat
 * (Adzuna renvoie souvent un type vide alors que le titre annonce "Alternance – ...").
 * `intern`/`internship` couvre les annonces rédigées en anglais.
 */
export const UNWANTED_CONTRACT_RE =
  /alternan|apprentissage|apprenti\b|contrat pro|professionnalisation|\bstages?\b|stagiaire|\bintern(?:ship)?\b|freelance|ind[ée]pendant|\bv\.?i\.?e\.?\b/i;
export const UNWANTED_CONTRACT_MALUS = 25;

/**
 * Postes d'encadrement : **rejet ferme**. Ils exigent un historique sectoriel et
 * une expérience managériale que Lucas n'a pas, et c'est aussi un motif
 * d'élimination de la passe de tri IA — autant ne pas les collecter.
 *
 * Le malus de 20 points qui s'appliquait auparavant était inopérant : sur une
 * offre par ailleurs bien notée, il était absorbé par le plafond de 100, et un
 * poste de responsable ressortait au même score qu'un poste accessible.
 * La règle ne porte que sur l'intitulé : une description qui mentionne « en lien
 * avec le responsable de service » ne décrit pas un poste d'encadrement.
 */
export const MANAGEMENT_RE = /\b(responsable|manager|directeur|directrice|chef de|superviseur|encadrant)\b/i;

/**
 * Véhicule personnel exigé : **rejet ferme**. Lucas a le permis B mais pas de
 * voiture ; c'est un blocage matériel, pas une préférence. Le permis seul, ou un
 * véhicule de service fourni, ne bloquent rien et ne sont donc pas matchés.
 */
export const VEHICLE_REQUIRED_RE =
  /v[ée]hicule (?:personnel|obligatoire)|v[ée]hicule (?:est )?(?:exig|indispensable|requis)|permis et v[ée]hicule|voiture (?:personnelle )?(?:exig|obligatoire|indispensable)/i;

/**
 * Commercial terrain / B2B : hors expérience (call center, retail, usine).
 * Malus et non rejet : la télévente et le commercial sédentaire sont accessibles,
 * et la frontière passe par le texte de l'annonce, que la passe de tri IA lit
 * mieux qu'une regex.
 */
export const FIELD_SALES_RE =
  /itin[ée]rant|b2b|business developer|technico-commercial|n[ée]gociateur|porte[- ]?[àa][- ]?porte|prospection terrain/i;
export const FIELD_SALES_MALUS = 20;

/**
 * Classification sectorielle (ordre = priorité, premier match retenu). Les points
 * varient par secteur : à conditions égales, un poste de bureau ou de support vaut
 * mieux qu'un poste d'entrepôt, plus exposé aux horaires décalés et au samedi. Le
 * bonus reste modeste face aux conditions (salaire jusqu'à +22, rythme +15) : le
 * secteur oriente, il ne décide pas.
 *
 * Les libellés doivent exister dans les options de la propriété `Secteur` du
 * tracker Notion, sinon l'API rejette la page entière.
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
    re: /administration des ventes|\badv\b|back[- ]?office|gestionnaire de commandes|e[- ]?commerce|saisie|gestionnaire de dossiers|assistant commercial|facturation/i
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
    // Le retail n'est plus recherché activement (requêtes retirées), mais une
    // offre peut encore remonter par un autre intitulé : on la classe correctement.
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
