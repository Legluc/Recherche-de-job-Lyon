import type { NormalizedOffer, ScoredOffer, WorkRhythm } from "./types";
import {
  FILTERS, SECTOR_KEYWORDS,
  UNWANTED_CONTRACT_RE, UNWANTED_CONTRACT_MALUS, MANAGEMENT_RE,
  FIELD_SALES_RE, FIELD_SALES_MALUS, VEHICLE_REQUIRED_RE, SMIC, SALARY_TIERS, SALARY_DISPLAYED_POINTS, FRESHNESS_POINTS,
  WEEKEND_FREE_RE, WEEKEND_WORK_RE, WEEKEND_FREE_POINTS, PART_TIME_RE
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

/**
 * Rythme déduit du texte. Le travail de week-end affirmé prime sur une éventuelle
 * mention de repos ailleurs dans l'annonce : entre « du lundi au vendredi » en
 * en-tête et « travail 1 samedi sur 2 » dans le détail, c'est le second qui décrit
 * la réalité du poste.
 */
export function detectRhythm(full: string): WorkRhythm {
  if (WEEKEND_WORK_RE.test(full)) return "Week-end travaillé";
  if (WEEKEND_FREE_RE.test(full)) return "Week-ends libres";
  return "Non précisé";
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
 * Score l'offre (0–100) ou renvoie null si elle doit être écartée.
 *
 * Profil unique depuis octobre 2026 : emploi alimentaire lyonnais, week-ends
 * libres, temps plein. Le poste lui-même compte moins que les conditions — on
 * accepte des métiers jamais exercés (le vivier est large, la passe de tri IA
 * arbitre), on refuse les mauvaises conditions.
 *
 * Rejets fermes, par ordre de coût de l'erreur : hors zone, trop ancienne, mots
 * d'exclusion (nuit, postés, BTP, restauration), **travail de week-end annoncé**,
 * **temps partiel annoncé**, contrat non souhaité, encadrement, véhicule personnel
 * exigé.
 */
export function scoreOffer(o: NormalizedOffer, city: CityConfig): ScoredOffer | null {
  const title = (o.title || "").toLowerCase();
  const full = `${o.title} ${o.description}`.toLowerCase();

  // Garde-fou : un ancien lot collecté peut encore contenir des offres marquées
  // "Dev" (profil abandonné). Elles ne doivent pas être scorées avec la grille
  // alimentaire, qui les jugerait sur des critères sans rapport.
  if (o.type !== "Alimentaire") return null;

  if (!inGeo(o, city)) return null;

  // Date absente (Indeed n'en publie pas sur ses cartes) : ni rejet, ni bonus
  // maximal, mais une valeur neutre (cf. FRESHNESS_POINTS.unknown).
  const cd = daysAgo(o.createdAt);
  if (cd !== null && cd > FILTERS.maxDaysOld) return null;

  if (FILTERS.hardExclude.some((k) => full.includes(k))) return null; // nuit/postés/resto/BTP

  // Conditions non négociables : week-ends libres et temps plein.
  const rhythm = detectRhythm(full);
  if (rhythm === "Week-end travaillé") return null;
  if (PART_TIME_RE.test(full)) return null;

  // Contrats non souhaités (alternance, stage, freelance...).
  // - Titre ou type de contrat explicite -> rejet ferme (un malus laissait passer
  //   certaines offres pile au seuil : filtrage plus fiable que pondération).
  // - Mention uniquement dans la description -> simple malus, car il peut s'agir
  //   d'un CDI qui l'évoque en passant ("alternance possible").
  if (o.contract === "Alternance" || UNWANTED_CONTRACT_RE.test(title)) return null;

  // Restrictions de compétence et de mobilité : encadrement (historique sectoriel
  // exigé) et véhicule personnel (Lucas n'en a pas). Rejets fermes : un malus
  // était absorbé par le plafond de 100 sur les offres par ailleurs bien notées.
  if (MANAGEMENT_RE.test(title)) return null;
  if (VEHICLE_REQUIRED_RE.test(full)) return null;

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

  if (UNWANTED_CONTRACT_RE.test(full)) score -= UNWANTED_CONTRACT_MALUS;

  // Commercial terrain / B2B : hors expérience, mais la télévente et le poste
  // sédentaire restent accessibles -> malus, pas rejet.
  if (FIELD_SALES_RE.test(full)) score -= FIELD_SALES_MALUS;

  // Bonus centre-ville : trajet plus court depuis le domicile.
  score += (o.location || "").toLowerCase().includes(city.key) ? 5 : 2;

  const s = sectorOf(title, full);
  score += s.points;

  const sal = salaryScore(o);
  score += sal.points;

  if (rhythm === "Week-ends libres") score += WEEKEND_FREE_POINTS;

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { ...o, sector: s.sector, score, monthlyGross: sal.monthlyGross, rhythm };
}
