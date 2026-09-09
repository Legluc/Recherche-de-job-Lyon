import type { NormalizedOffer, ScoredOffer, WorkRhythm } from "./types";
import {
  FILTERS, DEV_RELEVANT, DEV_STACK, DEV_SENIOR_RE, SECTOR_KEYWORDS,
  UNWANTED_CONTRACT_RE, UNWANTED_CONTRACT_MALUS, MANAGEMENT_RE, MANAGEMENT_MALUS,
  FIELD_SALES_RE, FIELD_SALES_MALUS, SMIC, SALARY_TIERS, SALARY_DISPLAYED_POINTS, FRESHNESS_POINTS,
  WEEKEND_FREE_RE, WEEKEND_WORK_RE, WEEKEND_FREE_POINTS, WEEKEND_WORK_MALUS,
  PART_TIME_RE, PART_TIME_MALUS
} from "./config";
import { parseSalary, smicRatio } from "./salary";
import type { CityConfig } from "./cities";

/** Âge de l'offre en jours, ou null si la source ne publie pas de date. */
function daysAgo(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return isNaN(t) ? null : (Date.now() - t) / 86_400_000;
}

/** Vérifie que l'offre est dans la zone accessible de la ville (commune OU code postal). */
function inGeo(o: NormalizedOffer, city: CityConfig): boolean {
  const loc = (o.location || "").toLowerCase();
  if (!loc && !o.postalCode) return true; // pas d'info exploitable : on ne rejette pas
  const byCommune = city.communesWhitelist.some((c) => loc.includes(c));
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
 * Secteur de l'offre. On teste d'abord l'intitulé, bien plus fiable que la
 * description : un poste d'entrepôt dont l'annonce vante le « sens du service
 * client » ne doit pas être classé en relation client.
 */
export function sectorOf(title: string, full: string): { sector: string; points: number } {
  const t = stripInlineParens(title);
  const f = stripInlineParens(full);
  for (const { sector, re, points } of SECTOR_KEYWORDS) if (re.test(t)) return { sector, points };
  for (const { sector, re, points } of SECTOR_KEYWORDS) if (re.test(f)) return { sector, points };
  return { sector: "Autre", points: 0 };
}

/** Rythme déduit du texte : les mentions explicites priment sur le silence. */
export function detectRhythm(full: string): WorkRhythm {
  if (WEEKEND_WORK_RE.test(full)) return "Week-end travaillé";
  if (WEEKEND_FREE_RE.test(full)) return "Week-ends libres";
  return "Non précisé";
}

/**
 * Points liés à la rémunération, pour l'alimentaire.
 * Renvoie aussi le brut mensuel déduit, reporté dans le tracker.
 */
function salaryScore(o: NormalizedOffer, partTime: boolean): { points: number; monthlyGross?: number } {
  const parsed = parseSalary(o.salary);
  if (!parsed) {
    // Salaire affiché mais non interprétable ("selon profil") : la transparence
    // partielle vaut un point symbolique ; l'absence totale vaut zéro (neutre),
    // pour ne pas pénaliser une offre correcte publiée par une source avare.
    return { points: o.salary ? SALARY_DISPLAYED_POINTS : 0 };
  }
  const ratio = smicRatio(parsed.monthlyGross, SMIC.monthlyGross35h);
  const tier = SALARY_TIERS.find((t) => ratio >= t.minRatio) ?? SALARY_TIERS[SALARY_TIERS.length - 1];
  // Temps partiel : le montant mensuel est mécaniquement bas. On applique le
  // malus de temps partiel (plus haut), pas celui du sous-SMIC, pour ne pas
  // sanctionner deux fois le même fait.
  const points = partTime && tier.points < 0 ? 0 : tier.points;
  return { points, monthlyGross: parsed.monthlyGross };
}

/**
 * Score l'offre (0–100) ou renvoie null si elle doit être écartée.
 *
 * Deux régimes distincts :
 * - **Dev** : pertinence de la stack et séniorité (l'objectif du projet).
 * - **Alimentaire** : le poste importe moins que les conditions. Depuis
 *   l'élargissement des requêtes, le bonus sectoriel a été abaissé (14 max au
 *   lieu de 12 forfaitaires) au profit du salaire (jusqu'à +22, −12 sous le SMIC)
 *   et du rythme (+12 week-ends libres, −15 si week-end travaillé) : on accepte
 *   des métiers jamais exercés, on refuse les mauvaises conditions.
 */
export function scoreOffer(o: NormalizedOffer, city: CityConfig): ScoredOffer | null {
  const title = (o.title || "").toLowerCase();
  const full = `${o.title} ${o.description}`.toLowerCase();

  if (!inGeo(o, city)) return null;

  // Date absente (Indeed n'en publie pas sur ses cartes) : ni rejet, ni bonus
  // maximal, mais une valeur neutre (cf. FRESHNESS_POINTS.unknown).
  const cd = daysAgo(o.createdAt);
  if (cd !== null && cd > FILTERS.maxDaysOld) return null;

  let score = 50;
  if (cd === null) score += FRESHNESS_POINTS.unknown;
  else if (cd <= 3) score += FRESHNESS_POINTS.recent;
  else if (cd <= 7) score += FRESHNESS_POINTS.week;
  else score += FRESHNESS_POINTS.older;

  if (o.contract === "CDI") score += city.contractPoints.CDI;
  else if (o.contract === "CDD") score += city.contractPoints.CDD;
  // Contrat non publié par la source : valeur neutre plutôt que zéro, sinon
  // l'offre est pénalisée pour une absence d'information (cf. WTTJ).
  else if (!o.contract) score += city.contractPoints.unknown;

  // Contrats non souhaités (alternance, stage, freelance...).
  // - Titre ou type de contrat explicite -> rejet ferme (un malus laissait passer
  //   certaines offres pile au seuil : filtrage plus fiable que pondération).
  // - Mention uniquement dans la description -> simple malus, car il peut s'agir
  //   d'un CDI qui l'évoque en passant ("alternance possible").
  if (o.contract === "Alternance" || UNWANTED_CONTRACT_RE.test(title)) return null;
  if (UNWANTED_CONTRACT_RE.test(full)) score -= UNWANTED_CONTRACT_MALUS;

  // Encadrement : hors cible (profil junior, sans expérience managériale).
  if (MANAGEMENT_RE.test(title)) score -= MANAGEMENT_MALUS;

  // Commercial terrain / B2B : hors expérience, et souvent véhicule requis.
  if (FIELD_SALES_RE.test(full)) score -= FIELD_SALES_MALUS;

  // Bonus centre-ville : trajet plus court depuis le domicile.
  score += (o.location || "").toLowerCase().includes(city.key) ? 5 : 2;

  let sector: string;
  let monthlyGross: number | undefined;
  let rhythm: WorkRhythm | undefined;
  let partTime: boolean | undefined;

  if (o.type === "Dev") {
    if (!DEV_RELEVANT.test(full)) return null; // écarte le bruit non-dev
    sector = "Dév web";
    if (o.salary) score += 5; // pour le dev, l'affichage du salaire suffit comme signal
    if (DEV_STACK.test(full)) score += 15; // correspondance stack
    if (/junior|débutant|premier emploi/.test(full)) score += 8; // sans alternance/apprenti
    if (DEV_SENIOR_RE.test(title)) score -= 12; // profil junior
  } else {
    if (FILTERS.alimentaireExclude.some((k) => full.includes(k))) return null; // nuit/postés/resto/BTP

    const s = sectorOf(title, full);
    sector = s.sector;
    score += s.points;

    partTime = PART_TIME_RE.test(full);
    if (partTime) score -= PART_TIME_MALUS;

    const sal = salaryScore(o, partTime);
    score += sal.points;
    monthlyGross = sal.monthlyGross;

    rhythm = detectRhythm(full);
    if (rhythm === "Week-ends libres") score += WEEKEND_FREE_POINTS;
    else if (rhythm === "Week-end travaillé") score -= WEEKEND_WORK_MALUS;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { ...o, sector, score, monthlyGross, rhythm, partTime };
}
