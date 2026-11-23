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
   * Rejet ferme : rythmes incompatibles (nuit, équipes postées) et métiers
   * physiques ou qualifiés hors cible (BTP, restauration).
   *
   * "dimanche" ne figure PAS dans cette liste : la recherche par sous-chaîne
   * rejetterait aussi les annonces qui promettent « fermé le dimanche » —
   * exactement celles qu'on cherche. Le travail du dimanche est écarté par
   * SUNDAY_WORK_RE, qui ne matche que les formulations affirmatives.
   */
  hardExclude: [
    "nuit", "de nuit", "3x8", "2x8", "posté",
    "btp", "chantier", "maçon", "macon", "couvreur", "échafaudage",
    // "commis" seul matchait « commissions » (fixe + commissions), courant dans
    // les offres de vente revenues dans la cible en novembre 2026.
    "restauration", "cuisinier", "commis de", "commis cuisine", "serveur", "serveuse", "plonge", "plongeur"
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
 * Rythme de travail. Critère revu en novembre 2026 : le samedi est accepté (le
 * commerce alimentaire et le retail redeviennent des cibles), **le dimanche doit
 * rester libre**.
 *
 * Régimes volontairement asymétriques :
 * - `SUNDAY_WORK_RE` : **rejet ferme**. L'offre affirme un travail le dimanche,
 *   le week-end ou en roulement de week-end. « Week-end » est traité comme un
 *   dimanche travaillé : en commerce, il désigne samedi ET dimanche, et le doute
 *   profiterait à des offres que la recherche exclut. Les lookbehinds protègent
 *   les négations courantes (« pas de travail le dimanche », « jamais de
 *   dimanches travaillés »).
 * - `WEEKDAYS_ONLY_RE` : **bonus fort**. Lundi-vendredi prouvé, sauf si l'annonce
 *   affirme aussi un samedi travaillé (`SATURDAY_WORK_RE`), auquel cas seul le
 *   repos dominical est acquis.
 * - `SUNDAY_FREE_RE` : **bonus réduit**. Repos dominical prouvé (« du lundi au
 *   samedi », « fermé le dimanche »), samedi possiblement travaillé.
 *
 * Les annonces muettes sur le rythme (la grande majorité) ne sont ni rejetées ni
 * bonifiées : les écarter viderait la collecte, et la passe de tri IA vérifie
 * ensuite sur le texte complet de l'annonce.
 */
export const SUNDAY_WORK_RE =
  /(?<!pas de |jamais de |sans |aucun )travail (?:le |les )?(?:dimanches?|week[- ]?ends?)|(?<!pas de |jamais de |sans |aucun )(?:dimanches?|week[- ]?ends?) travaill|(?:1|un|2|deux) (?:dimanche|week[- ]?end)s? sur|dimanches? (?:par roulement|en roulement|oblig|requis|impos)|roulement (?:le |les |de |du |des )?(?:dimanches?|week[- ]?ends?)|disponibi?l(?:e|it[ée]) (?:le |les )?(?:dimanches?|week[- ]?ends?)|ouvert(?:ure)? (?:le |les )?dimanches?|(?:lundi|mardi|mercredi|jeudi|vendredi|samedi) (?:au|à) dimanche|7 ?j(?:ours)? ?(?:\/|sur) ?7|(?:ouvert|amplitude) 7 ?j/i;
export const SATURDAY_WORK_RE =
  /(?<!pas de |jamais de |sans |aucun )travail (?:le |les )?samedis?|(?<!pas de |jamais de |sans |aucun )samedis? travaill|(?:1|un|2|deux) samedis? sur|samedis? (?:matin )?(?:oblig|requis|impos|par roulement)|disponibi?l(?:e|it[ée]) (?:le |les )?samedis?/i;
export const WEEKDAYS_ONLY_RE =
  /du lundi au vendredi|lundi (?:au|à) vendredi|week[- ]?ends? (?:libres?|non travaill|de repos|off)|repos (?:le |les )?week[- ]?end|samedi et dimanche (?:non travaill|de repos|libres)|horaires? de bureau/i;
export const SUNDAY_FREE_RE =
  /du (?:lundi|mardi) au samedi|(?:lundi|mardi) (?:au|à) samedi|ferm[ée]e? (?:le |les )?dimanches?|repos (?:le |les )?dimanches?|dimanches? (?:libres?|de repos|non travaill|off)|jamais (?:le |les )?dimanches?|pas de travail (?:le |les )?dimanches?/i;
export const WEEKDAYS_ONLY_POINTS = 15;
export const SUNDAY_FREE_POINTS = 8;

/**
 * Horaires coupés : **rejet ferme** (décision de novembre 2026). Fréquents en
 * commerce alimentaire (matin + fin de journée), ils allongent l'amplitude sans
 * voiture au-delà du supportable. Seules les formulations explicites matchent :
 * une « pause déjeuner » n'est pas une coupure.
 */
export const SPLIT_SHIFT_RE =
  /horaires? (?:en )?coup[ée]s|journ[ée]es? coup[ée]es|en coupure|avec coupure|coupure (?:en |de |dans la )?(?:milieu de )?(?:la )?journ[ée]e|coupure (?:de )?\d+ ?h/i;

/**
 * Temps partiel : **rejet ferme**. Le poste doit financer une installation à Lyon,
 * un mi-temps ne le permet pas. Le silence de l'annonce sur la durée vaut temps
 * plein : c'est la norme des offres, et exiger la mention explicite écarterait
 * l'essentiel du vivier.
 */
export const PART_TIME_RE =
  // « Temps non complet » : formule de la fonction publique (« secrétaire à temps
  // non complet de 50 % »), entrée dans le vivier avec Choisir le service public.
  /temps partiel|mi[- ]temps|temps (?:non complet|incomplet)|(?:1[0-9]|2[0-9]|3[0-4]) ?h(?:eures)? ?(?:\/| par | hebdo)? ?(?:semaine|hebdomadaire)|20h\/semaine|24h\/semaine/i;

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
 * Requêtes de collecte des API (France Travail, Adzuna).
 *
 * Domaines retenus en novembre 2026, par ordre de priorité de score :
 * bureau et relation client (dont administration publique et associatif), puis
 * commerce alimentaire et retail. **Exclus** : informatique sous toutes ses formes
 * (dev, support, helpdesk, service informatique), logistique / production,
 * propreté. Ces exclusions sont aussi des rejets fermes sur l'intitulé
 * (`EXCLUDED_DOMAINS`) : une offre qui remonte par une autre requête ne passe pas.
 *
 * Le commerce alimentaire et le retail reviennent parce que le samedi est de
 * nouveau accepté ; le filtre de rythme ne porte plus que sur le dimanche.
 * Pas de requête dédiée au public ni à l'associatif : ce sont des natures
 * d'employeur, pas des intitulés. Les requêtes de bureau les ramènent, et
 * `employerKindOf` (score.ts) les reconnaît.
 */
export const QUERIES: Record<JobType, string[]> = {
  Alimentaire: [
    // Administratif et back-office : lundi-vendredi par nature
    "assistant administratif", "agent administratif", "gestionnaire administratif",
    "secrétaire", "assistant de gestion", "employé de bureau", "gestionnaire de dossiers",
    "gestionnaire back office", "administration des ventes", "assistant commercial",
    "gestionnaire de contrats", "agent de facturation", "opérateur de saisie",
    "adjoint administratif",
    // Relation client et accueil (expérience Phone Design / téléphonie)
    "conseiller clientèle", "téléconseiller", "chargé de clientèle", "service client",
    "hôte d'accueil", "agent d'accueil", "chargé d'accueil", "standardiste",
    // Commerce alimentaire (expérience directe : vente en boulangerie)
    "vendeur boulangerie", "employé de boulangerie", "vendeur traiteur",
    "vendeur fromagerie", "vendeur primeur", "vendeur épicerie fine",
    // Retail et grande distribution
    "employé libre service", "employé commercial", "hôte de caisse",
    "conseiller de vente", "adjoint responsable magasin"
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
 * CDD : **rejet ferme**, sauf exception (décision de novembre 2026). Le CDI
 * conditionne l'installation à Lyon (dossier de location). L'exception couvre
 * l'administration publique et l'associatif, où les postes ouverts sans concours
 * sont presque toujours des CDD de contractuel : sans elle, ces deux domaines
 * cochés à l'entretien ne remonteraient jamais.
 *
 * Exception accordée si l'employeur est public ou associatif ET que la durée
 * annoncée atteint `CDD_MIN_MONTHS`. Durée non précisée : l'offre est conservée
 * (information absente ≠ mauvaise), la passe de tri IA vérifiera. Intérim : rejet
 * ferme partout, l'API France Travail ne le remonte de toute façon pas.
 */
export const CDD_MIN_MONTHS = 12;
/**
 * Durée d'un contrat : « CDD de 12 mois », « contrat d'un an », « durée : 3 ans ».
 * Le segment intermédiaire refuse le mot « essai » : sans cette garde, « CDD,
 * période d'essai de 1 mois » se lisait comme un CDD d'un mois.
 */
export const CONTRACT_DURATION_RE =
  /(?:cdd|contrat|dur[ée]e|engagement|mission)(?:(?!essai)[^.\n]){0,40}?\b(\d{1,2}|un|une|deux|trois)\s*(mois|ans?)\b/i;
/** CDD annoncé dans l'intitulé quand la source ne type pas le contrat. */
export const CDD_TITLE_RE = /\bcdd\b|dur[ée]e d[ée]termin[ée]e/i;
/** Intérim annoncé dans l'intitulé (le type de contrat n'est pas toujours publié). */
export const INTERIM_TITLE_RE = /int[ée]rim|travail temporaire/i;

/*
 * Bornes de mot. `\b` ne connaît que l'ASCII en JavaScript, même avec le drapeau
 * `u` : « université » n'a pas de fin de mot après le « é », et « café » en a une
 * entre « caf » et « é ». Les regex qui doivent isoler un mot accentué utilisent
 * donc ces lookarounds explicites.
 */
const WB = "(?<![a-z0-9à-ÿœæ])";
const WE = "(?![a-z0-9à-ÿœæ])";
const words = (alternatives: string): RegExp => new RegExp(`${WB}(?:${alternatives})${WE}`, "i");

/**
 * Fonction publique : un poste **réservé aux titulaires** exige un concours que
 * Lucas n'a pas : rejet ferme. « Ouvert aux titulaires et aux contractuels »
 * passe, c'est précisément le cas visé par l'exception CDD.
 */
/**
 * Fonction publique, catégorie A (cadre) : rejet ferme. Elle suppose un niveau
 * bac+3 et des fonctions d'encadrement ou d'expertise hors de portée ; les
 * catégories C (employé) et B (technicien) restent ouvertes. Choisir le service
 * public l'affiche sous la forme « Catégorie A (cadre) ».
 */
export const PUBLIC_CATEGORY_A_RE = /cat[ée]gorie\s*:?\s*a\s*\(/i;

export const TITULAIRE_ONLY_RE =
  /ouvert (?:uniquement |exclusivement )?aux (?:seuls )?(?:titulaires|fonctionnaires)(?! et aux contractuels)|r[ée]serv[ée] aux (?:fonctionnaires|titulaires)|titulaires? uniquement|par voie de mutation uniquement/i;

/**
 * Nature de l'employeur. Trois indices, du plus fiable au moins fiable : la source
 * (Choisir le service public ne publie que du public), le nom de l'employeur, puis
 * le texte de l'annonce. Le texte n'est consulté que pour des marqueurs non
 * ambigus (« fonction publique », « association loi 1901 ») : une entreprise
 * privée qui « travaille avec les collectivités » ne doit pas devenir publique.
 *
 * CAF, CPAM, URSSAF sont des organismes privés chargés d'un service public : ils
 * sont rangés en public, parce que c'est ainsi que Lucas les cherche et que leurs
 * contrats (CDI ou CDD long) relèvent de la même logique.
 */
export const PUBLIC_SOURCES = ["Choisir le service public"];
export const PUBLIC_EMPLOYER_RE = words(
  "mairie|ville de|commune de?|m[ée]tropole|grand lyon|d[ée]partement d[ue]|conseil (?:d[ée]partemental|r[ée]gional)|r[ée]gion auvergne|pr[ée]fecture|minist[èe]re|centre hospitalier|chu|hospices civils|h[ôo]pital|ccas|centre communal d.action sociale|universit[ée]|rectorat|acad[ée]mie de|sdmis|sytral|caf (?:du|de?)|caisse d.allocations|cpam|caisse primaire|urssaf|carsat|france travail|douanes?|finances publiques|dgfip|insee|syndicat intercommunal|communaut[ée] de communes|crous|epide|ars|agence r[ée]gionale de sant[ée]|lyon m[ée]tropole habitat|grand lyon habitat|est m[ée]tropole habitat|alliade"
);
export const PUBLIC_TEXT_RE =
  /fonction publique|cat[ée]gorie [abc] \(|cadre d.emplois|adjoint administratif territorial|ouvert aux titulaires et aux contractuels|par voie contractuelle|r[ée]mun[ée]ration statutaire|\brifseep\b/i;
export const ASSO_EMPLOYER_RE = words(
  "association|asso|fondation|f[ée]d[ée]ration|emma[üu]s|secours (?:populaire|catholique)|croix[- ]rouge|restos? du c(?:œ|oe)ur|adapei|sauvegarde [0-9]+|habitat et humanisme|banque alimentaire|mission locale|r[ée]gie de quartier|unis[- ]?cit[ée]|apprentis d.auteuil"
);
export const ASSO_TEXT_RE =
  /association (?:loi )?(?:de )?1901|loi (?:de )?1901|structure associative|notre association|l.association recrute/i;

/**
 * Postes d'encadrement. Décision de novembre 2026 : **accepté pour une petite
 * équipe dans les secteurs où Lucas a de l'expérience** (commerce alimentaire,
 * retail : il est responsable de fermeture en boulangerie). Ailleurs, rejet
 * ferme : l'historique sectoriel manque, et c'est un motif d'élimination de la
 * passe de tri IA. Le grand encadrement (direction, multi-sites, secteur) reste
 * rejeté partout.
 *
 * La règle ne porte que sur l'intitulé : une description qui mentionne « en lien
 * avec le responsable de service » ne décrit pas un poste d'encadrement. Rejet
 * plutôt que malus : un malus était absorbé par le plafond de 100.
 */
export const MANAGEMENT_RE = words(
  "responsable|manager|directeur|directrice|chef de|superviseur|superviseuse|encadrant|encadrante|adjoint de magasin|g[ée]rant|g[ée]rante"
);
export const SENIOR_MANAGEMENT_RE = words(
  "directeur|directrice|director|r[ée]gional|r[ée]gionale|multi[- ]?sites?|de secteur|de zone|d.exploitation|de r[ée]seau"
);
export const MANAGEMENT_OK_SECTORS = ["Commerce alimentaire", "Retail"];

/**
 * Métiers qualifiés : **rejet ferme sur l'intitulé**. Diplôme, titre ou geste qui
 * s'acquiert en années. Attention aux faux positifs : « boulanger » (métier
 * qualifié) est rejeté, « vendeur en boulangerie » (son expérience) ne l'est pas ;
 * le `\b` final empêche « boulanger » de matcher « boulangerie ».
 */
export const QUALIFIED_TRADE_RE = words(
  "boulang(?:er|[èe]re)|p[âa]tissi(?:er|[èe]re)|boucher|bouch[èe]re|charcuti(?:er|[èe]re)|poissonni(?:er|[èe]re)|chocolati(?:er|[èe]re)|cuisini(?:er|[èe]re)|coiffeu(?:r|se)|esth[ée]ticien(?:ne)?|[ée]lectricien(?:ne)?|plombier|soudeu(?:r|se)|m[ée]canicien(?:ne)?|aide[- ]soignant(?:e)?|infirmi(?:er|[èe]re)|auxiliaire de pu[ée]riculture|atsem|[ée]ducat(?:eur|rice)|moniteur[- ][ée]ducateur|agent de s[ée]curit[ée]|pharmacien(?:ne)?|pr[ée]parat(?:eur|rice) en pharmacie"
);

/**
 * Domaines exclus à l'entretien de novembre 2026 : **rejet ferme sur l'intitulé**
 * uniquement. Tester la description écarterait à tort un poste de vente dont
 * l'annonce évoque « la logistique du magasin » ou « l'outil informatique ».
 *
 * - Informatique : la recherche dev est abandonnée depuis octobre, et Lucas ne
 *   veut pas non plus de support, de helpdesk ni de poste en service informatique.
 * - Logistique / production et propreté : non retenus parmi les domaines visés.
 *   « Assistant logistique » (poste de bureau) n'est pas visé : seuls les postes
 *   d'exécution (agent, opérateur, préparateur) le sont.
 */
export const EXCLUDED_DOMAINS: Array<{ label: string; re: RegExp }> = [
  {
    label: "informatique",
    // « Technicien service clients » d'un éditeur de logiciel est du support
    // applicatif : vu au rejeu du lot du 21/11 (Sogelink).
    re: /informati|d[ée]veloppeu|developer|helpdesk|hot ?line|service desk|support (?:technique|it\b|n[12]\b|niveau [12]|utilisateurs?|logiciel|applicatif|fonctionnel)|assistance (?:technique|informatique)|technicien(?:ne)? (?:support|service clients?|hotline|r[ée]seaux?|syst[èe]mes?|de proximit[ée])|administrat(?:eur|rice) (?:syst[èe]mes?|r[ée]seaux?)|devops|webmaster|int[ée]grat(?:eur|rice) web|wordpress/i
  },
  {
    label: "logistique / production",
    re: /pr[ée]parat(?:eur|rice|ion) de commandes?|cariste|magasinier|manutention|manutentionnaire|(?:agent|op[ée]rat(?:eur|rice)|employ[ée]e?) (?:de |d.)?(?:logistique|production|fabrication|conditionnement|tri|quai|ligne)|ouvri(?:er|[èe]re) de production|logisticien|livreu(?:r|se)|chauffeur|d[ée]m[ée]nage/i
  },
  {
    label: "propreté",
    re: /agent d.entretien|agent de propret[ée]|nettoyage|agent de services?(?! client| apr[èe]s)|(?:femme|homme|aide) (?:de )?m[ée]nage/i
  }
];

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
 * Classification sectorielle (ordre = priorité, premier match retenu). Ordre de
 * valeur décidé en novembre 2026 : **bureau, administration publique et
 * associatif d'abord** (horaires de bureau, dimanche libre par construction),
 * puis commerce alimentaire et retail. Le bonus reste modeste face aux conditions
 * (salaire jusqu'à +22, rythme +15) : le secteur oriente, il ne décide pas.
 *
 * La nature de l'employeur prime sur la fonction : un poste d'accueil en mairie
 * est classé « Administration publique » (`EMPLOYER_SECTORS`), parce que c'est la
 * dimension que Lucas filtre dans le tracker et celle qui ouvre l'exception CDD.
 *
 * « Commerce alimentaire » est placé avant « Retail » : « vendeur en
 * boulangerie » matcherait sinon `vendeu` et perdrait son classement propre.
 * Les trois derniers secteurs valent 0 : leurs intitulés sont rejetés
 * (`EXCLUDED_DOMAINS`), ils ne servent plus qu'à classer une offre dont seule la
 * description les évoque.
 *
 * Les libellés doivent exister dans les options de la propriété `Secteur` du
 * tracker Notion, sinon l'API rejette la page entière.
 */
export interface SectorRule {
  sector: string;
  re: RegExp;
  points: number;
}

export const EMPLOYER_SECTORS: Record<"Public" | "Associatif", { sector: string; points: number }> = {
  Public: { sector: "Administration publique", points: 14 },
  Associatif: { sector: "Associatif", points: 12 }
};

export const SECTOR_KEYWORDS: SectorRule[] = [
  {
    sector: "Back-office / ADV",
    points: 12,
    re: /administration des ventes|\badv\b|back[- ]?office|gestionnaire de commandes|e[- ]?commerce|saisie|gestionnaire de dossiers|assistant commercial|facturation/i
  },
  {
    sector: "Banque / Assurance",
    points: 12,
    re: /banc?aire|banque|assurance|mutuelle|gestionnaire de contrats|sinistres|recouvrement|courtage/i
  },
  {
    sector: "Administratif",
    points: 12,
    re: /administratif|secr[ée]taire|secr[ée]tariat|assistant(e)? de gestion|employ[ée] de bureau|gestion administrative|assistant(e)? (?:polyvalent|de direction|d.agence)/i
  },
  {
    sector: "Call center",
    points: 10,
    re: /t[ée]l[ée]conseil|conseiller client|centre d.appel|relation client|t[ée]l[ée]vente|charg[ée] de client[èe]le|service client|enqu[êe]teur/i
  },
  {
    sector: "Accueil",
    points: 10,
    // "hôte" seul n'est pas retenu : "hôte de caisse" relève du retail, pas de
    // l'accueil. Toute vraie offre d'accueil contient "accueil" ou "réceptionniste".
    re: /accueil|standardiste|r[ée]ceptionniste/i
  },
  {
    sector: "Commerce alimentaire",
    points: 6,
    re: /boulang|p[âa]tisserie|viennoiserie|traiteur|fromag|cr[èe]merie|primeur|[ée]picerie|chocolat|confiserie|caviste|cave [àa] vins?|boucherie|charcuterie|poissonnerie|torr[ée]fact|m[ée]tiers de bouche/i
  },
  {
    sector: "Retail",
    points: 5,
    re: /vendeu|libre[- ]?service|de rayon|caisse|caissi[èe]r|conseiller de vente|magasin|boutique|point de vente|employ[ée] (?:polyvalent|commercial|drive)|\bdrive\b/i
  },
  {
    sector: "Usine/Logistique",
    points: 0,
    re: /pr[ée]parat(?:eur|ion) de commandes|cariste|op[ée]rateur|production|conditionnement|logistique|entrep[ôo]t|fabrication|agent de tri/i
  },
  {
    sector: "Manutention",
    points: 0,
    re: /manuten|magasinier|livreur|chauffeur[- ]livreur/i
  },
  {
    sector: "Propreté / Services",
    points: 0,
    re: /agent d.entretien|nettoyage|propret[ée]|agent de service/i
  }
];
