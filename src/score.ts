import type { Contract, EmployerKind, NormalizedOffer, ScoredOffer, WorkRhythm } from "./types";
import {
  FILTERS, SECTOR_KEYWORDS, EMPLOYER_SECTORS, EXCLUDED_DOMAINS,
  UNWANTED_CONTRACT_RE, UNWANTED_CONTRACT_MALUS,
  MANAGEMENT_RE, SENIOR_MANAGEMENT_RE, MANAGEMENT_OK_SECTORS, QUALIFIED_TRADE_RE,
  FIELD_SALES_RE, FIELD_SALES_MALUS, VEHICLE_REQUIRED_RE,
  SMIC, SALARY_TIERS, SALARY_DISPLAYED_POINTS, FRESHNESS_POINTS,
  SUNDAY_WORK_RE, SATURDAY_WORK_RE, WEEKDAYS_ONLY_RE, SUNDAY_FREE_RE,
  WEEKDAYS_ONLY_POINTS, SUNDAY_FREE_POINTS, PART_TIME_RE, SPLIT_SHIFT_RE,
  CDD_MIN_MONTHS, CONTRACT_DURATION_RE, CDD_TITLE_RE, INTERIM_TITLE_RE, TITULAIRE_ONLY_RE, PUBLIC_CATEGORY_A_RE,
  PUBLIC_SOURCES, PUBLIC_EMPLOYER_RE, PUBLIC_TEXT_RE, ASSO_EMPLOYER_RE, ASSO_TEXT_RE
} from "./config";
import { parseSalary, smicRatio } from "./salary";
import { normalize } from "./dedup";
import type { CityConfig } from "./cities";

/** Âge de l'offre en jours, ou null si la source ne publie pas de date. */
function daysAgo(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return isNaN(t) ? null : (Date.now() - t) / 86_400_000;
}

/** Le libellé normalisé contient-il ce nom de commune, en mots entiers ? */
function mentions(locN: string, commune: string): boolean {
  const c = normalize(commune);
  return !!c && ` ${locN} `.includes(` ${c} `);
}

/**
 * Vérifie que l'offre est dans la zone retenue (cf. cities.ts).
 *
 * Les communes écartées sont testées EN PREMIER : « Sainte-Foy-lès-Lyon » ou
 * « Tassin-la-Demi-Lune, Lyon » contiennent « Lyon », et 69330 est aussi le code
 * postal de Jonage. Comparaison en mots entiers sur un libellé normalisé
 * (casse, accents, tirets) : « Décines » et « decines-charpieu » se valent, et
 * « Bron » ne matche pas l'intérieur d'un autre mot.
 */
function inGeo(o: NormalizedOffer, city: CityConfig): boolean {
  const loc = normalize(o.location || "");
  if (!loc && !o.postalCode) return true; // pas d'info exploitable : on ne rejette pas
  if (city.communesExcluded.some((c) => mentions(loc, c))) return false;
  const byCommune = city.communesWhitelist.some((c) => mentions(loc, c));
  const byPostal = !!o.postalCode && city.postalPrefixes.some((p) => o.postalCode!.startsWith(p));
  return byCommune || byPostal;
}

/**
 * Retire les marques de féminisation et les mentions H/F entre parenthèses :
 * "employé(e) de rayon" doit être reconnu comme "employé de rayon". Sans ce
 * nettoyage, la moitié des intitulés France Travail échappent à la classification.
 */
function stripInlineParens(s: string): string {
  return s.replace(/\([a-zàâäéèêëîïôöùûüç/.]{1,6}\)/g, "").replace(/\s+/g, " ");
}

/**
 * Nature de l'employeur. Ordre des indices : source, puis nom de l'employeur,
 * puis marqueurs non ambigus du texte (cf. config.ts). Le nom passe avant le
 * texte pour qu'une association qui « travaille avec la Métropole » reste une
 * association.
 */
export function employerKindOf(o: NormalizedOffer): EmployerKind {
  const company = o.company || "";
  const full = `${o.title} ${o.description ?? ""}`;
  if (PUBLIC_SOURCES.includes(o.source) || PUBLIC_EMPLOYER_RE.test(company)) return "Public";
  if (ASSO_EMPLOYER_RE.test(company)) return "Associatif";
  if (PUBLIC_TEXT_RE.test(full)) return "Public";
  if (ASSO_TEXT_RE.test(full)) return "Associatif";
  return "Privé";
}

/**
 * Secteur de l'offre. La nature de l'employeur prime (Administration publique,
 * Associatif) ; sinon on teste d'abord l'intitulé, bien plus fiable que la
 * description : un poste d'entrepôt dont l'annonce vante le « sens du service
 * client » ne doit pas être classé en relation client.
 */
export function sectorOf(
  title: string,
  full: string,
  employer: EmployerKind = "Privé"
): { sector: string; points: number } {
  if (employer !== "Privé") return EMPLOYER_SECTORS[employer];
  const t = stripInlineParens(title);
  const f = stripInlineParens(full);
  for (const { sector, re, points } of SECTOR_KEYWORDS) if (re.test(t)) return { sector, points };
  for (const { sector, re, points } of SECTOR_KEYWORDS) if (re.test(f)) return { sector, points };
  return { sector: "Autre", points: 0 };
}

/**
 * Rythme déduit du texte. Le travail du dimanche affirmé prime sur une éventuelle
 * mention de repos ailleurs dans l'annonce : entre « du lundi au vendredi » en
 * en-tête et « 1 dimanche sur 2 » dans le détail, c'est le second qui décrit la
 * réalité du poste. Même logique pour le samedi : un lundi-vendredi assorti d'un
 * samedi travaillé ne garantit plus que le repos dominical.
 */
export function detectRhythm(full: string): WorkRhythm {
  if (SUNDAY_WORK_RE.test(full)) return "Dimanche travaillé";
  const weekdays = WEEKDAYS_ONLY_RE.test(full);
  if (weekdays && !SATURDAY_WORK_RE.test(full)) return "Week-ends libres";
  if (weekdays || SUNDAY_FREE_RE.test(full)) return "Dimanche libre";
  return "Non précisé";
}

const NUMBER_WORDS: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3 };

/** Durée annoncée du contrat, en mois, ou null si l'annonce ne la donne pas. */
export function contractMonths(full: string): number | null {
  const m = full.match(CONTRACT_DURATION_RE);
  if (!m) return null;
  const n = NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
  if (!n) return null;
  return /^an/i.test(m[2]) ? n * 12 : n;
}

/**
 * Contrat effectif : celui publié par la source, à défaut celui qu'annonce
 * l'intitulé (« CDD 6 mois – Assistant… », « Intérim – … »). La description seule
 * n'est pas consultée : « CDD ou CDI selon profil » y est courant.
 */
function effectiveContract(o: NormalizedOffer, title: string): Contract | undefined {
  if (o.contract) return o.contract;
  if (INTERIM_TITLE_RE.test(title)) return "Intérim";
  if (CDD_TITLE_RE.test(title)) return "CDD";
  return undefined;
}

/**
 * Points liés à la rémunération. Renvoie aussi le brut mensuel déduit, reporté
 * dans le tracker pour la passe de tri.
 *
 * Le temps partiel étant écarté en amont (rejet ferme), un montant mensuel sous le
 * SMIC ne peut plus s'expliquer par une durée réduite : le malus s'applique sans
 * neutralisation.
 */
function salaryScore(o: NormalizedOffer): { points: number; monthlyGross?: number } {
  const parsed = parseSalary(o.salary);
  if (!parsed) {
    // Salaire affiché mais non interprétable ("selon profil") : la transparence
    // partielle vaut un point symbolique ; l'absence totale vaut zéro (neutre),
    // pour ne pas pénaliser une offre correcte publiée par une source avare.
    return { points: o.salary ? SALARY_DISPLAYED_POINTS : 0 };
  }
  const ratio = smicRatio(parsed.monthlyGross, SMIC.monthlyGross35h);
  const tier = SALARY_TIERS.find((t) => ratio >= t.minRatio) ?? SALARY_TIERS[SALARY_TIERS.length - 1];
  return { points: tier.points, monthlyGross: parsed.monthlyGross };
}

/**
 * Motif de rejet ferme, ou null si l'offre peut être notée.
 *
 * Point d'entrée unique des rejets : `scoreOffer` l'appelle, et `select-web.ts`
 * s'en sert pour afficher un décompte par motif sans retester aucune regex. Les
 * libellés renvoyés apparaissent tels quels dans le rapport de la tâche planifiée.
 *
 * Ordre : du plus factuel (profil, zone, date) au plus interprétatif (domaine,
 * encadrement), pour que le motif affiché soit le moins contestable.
 */
export function rejectReason(o: NormalizedOffer, city: CityConfig): string | null {
  const title = (o.title || "").toLowerCase();
  const full = `${o.title} ${o.description ?? ""}`.toLowerCase();

  // Garde-fou : un ancien lot collecté peut encore contenir des offres marquées
  // "Dev" (profil abandonné). Elles ne doivent pas être scorées avec la grille
  // alimentaire, qui les jugerait sur des critères sans rapport.
  if (o.type !== "Alimentaire") return "profil abandonné (dev)";
  if (!inGeo(o, city)) return "hors zone";

  // Date absente (Indeed n'en publie pas sur ses cartes) : ni rejet, ni bonus
  // maximal, mais une valeur neutre (cf. FRESHNESS_POINTS.unknown).
  const cd = daysAgo(o.createdAt);
  if (cd !== null && cd > FILTERS.maxDaysOld) return "offre trop ancienne";

  if (FILTERS.hardExclude.some((k) => full.includes(k))) return "nuit, postés, BTP ou restauration";

  // Conditions non négociables : dimanche libre, temps plein, pas de coupure.
  if (detectRhythm(full) === "Dimanche travaillé") return "dimanche travaillé";
  if (PART_TIME_RE.test(full)) return "temps partiel";
  if (SPLIT_SHIFT_RE.test(full)) return "horaires coupés";

  // Contrats. Alternance, stage, freelance dans l'intitulé ou le type : rejet.
  // Mention en description seule : malus au scoring (« alternance possible »).
  if (o.contract === "Alternance" || UNWANTED_CONTRACT_RE.test(title)) return "alternance, stage ou freelance";
  const contract = effectiveContract(o, title);
  if (contract === "Intérim") return "intérim";
  const employer = employerKindOf(o);
  if (contract === "CDD") {
    // Exception public / associatif, à durée suffisante ou non précisée.
    if (employer === "Privé") return "CDD (CDI exigé)";
    const months = contractMonths(full);
    if (months !== null && months < CDD_MIN_MONTHS) return `CDD de moins de ${CDD_MIN_MONTHS} mois`;
  }
  if (TITULAIRE_ONLY_RE.test(full)) return "réservé aux titulaires";
  if (PUBLIC_CATEGORY_A_RE.test(full)) return "catégorie A (cadre)";

  // Domaines exclus et métiers qualifiés : sur l'intitulé seulement.
  for (const d of EXCLUDED_DOMAINS) if (d.re.test(stripInlineParens(title))) return `domaine exclu (${d.label})`;
  if (QUALIFIED_TRADE_RE.test(stripInlineParens(title))) return "métier qualifié";

  // Encadrement : accepté pour une petite équipe en commerce alimentaire et en
  // retail (son expérience), rejeté ailleurs et pour tout grand encadrement.
  if (MANAGEMENT_RE.test(title)) {
    const { sector } = sectorOf(title, full, employer);
    const allowed = MANAGEMENT_OK_SECTORS.includes(sector) && !SENIOR_MANAGEMENT_RE.test(title);
    if (!allowed) return "encadrement";
  }
  if (VEHICLE_REQUIRED_RE.test(full)) return "véhicule personnel exigé";
  return null;
}

/**
 * Score l'offre (0–100) ou renvoie null si elle doit être écartée.
 *
 * Profil unique : emploi alimentaire lyonnais, dimanche libre, temps plein, CDI
 * (ou CDD long dans le public et l'associatif). Le poste lui-même compte moins
 * que les conditions : on accepte des métiers jamais exercés dans les domaines
 * visés (la passe de tri IA arbitre), on refuse les mauvaises conditions.
 */
export function scoreOffer(o: NormalizedOffer, city: CityConfig): ScoredOffer | null {
  if (rejectReason(o, city)) return null;

  const title = (o.title || "").toLowerCase();
  const full = `${o.title} ${o.description ?? ""}`.toLowerCase();
  const employer = employerKindOf(o);
  const rhythm = detectRhythm(full);

  let score = 50;
  const cd = daysAgo(o.createdAt);
  if (cd === null) score += FRESHNESS_POINTS.unknown;
  else if (cd <= 3) score += FRESHNESS_POINTS.recent;
  else if (cd <= 7) score += FRESHNESS_POINTS.week;
  else score += FRESHNESS_POINTS.older;

  // Un CDD arrivé ici relève de l'exception public / associatif.
  const contract = effectiveContract(o, title);
  if (contract === "CDI") score += city.contractPoints.CDI;
  else if (contract === "CDD") score += city.contractPoints.CDD;
  // Contrat non publié par la source : valeur neutre plutôt que zéro, sinon
  // l'offre est pénalisée pour une absence d'information.
  else if (!contract) score += city.contractPoints.unknown;

  if (UNWANTED_CONTRACT_RE.test(full)) score -= UNWANTED_CONTRACT_MALUS;

  // Commercial terrain / B2B : hors expérience, mais la télévente et le poste
  // sédentaire restent accessibles -> malus, pas rejet.
  if (FIELD_SALES_RE.test(full)) score -= FIELD_SALES_MALUS;

  // Bonus centre-ville : trajet plus court depuis le domicile.
  score += (o.location || "").toLowerCase().includes(city.key) ? 5 : 2;

  const s = sectorOf(title, full, employer);
  score += s.points;

  const sal = salaryScore(o);
  score += sal.points;

  if (rhythm === "Week-ends libres") score += WEEKDAYS_ONLY_POINTS;
  else if (rhythm === "Dimanche libre") score += SUNDAY_FREE_POINTS;

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { ...o, sector: s.sector, score, monthlyGross: sal.monthlyGross, rhythm, employer };
}
