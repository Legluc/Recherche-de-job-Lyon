/**
 * Normalisation des libellés de salaire vers un **brut mensuel équivalent
 * temps plein (35 h)**, seule base comparable au SMIC.
 *
 * Le besoin : les sources publient du texte libre, pas un montant structuré.
 *   France Travail : "Mensuel de 1900.0 Euros à 2100.0 Euros sur 12 mois",
 *                    "Horaire de 12.50 Euros", "Annuel de 26000.0 Euros sur 13 mois"
 *   Adzuna         : "1800–2000 €/an" (reformaté par sources/adzuna.ts)
 *   Navigateur     : "entre 2 000 et 2 300 € brut mensuel", "30k€", "12,50 €/h net"
 *
 * Choix de conception :
 * - **Borne basse retenue** sur une fourchette. Un "1 800 à 2 400 €" ne doit pas
 *   décrocher le bonus des offres qui garantissent 2 400 € : on note ce qui est
 *   promis à coup sûr, pas l'affichage marketing.
 * - **Base déduite du mot-clé, sinon de l'ordre de grandeur.** Les bandes
 *   plausibles (horaire 5–60, mensuel 500–15 000, annuel 10 000–300 000) servent
 *   aussi de filtre anti-bruit : "sur 12 mois", "35h", "13ème mois" produisent des
 *   nombres qui tombent hors bande et disparaissent sans heuristique dédiée.
 * - **Net converti en brut** par un coefficient fixe (≈ 1,27, cotisations
 *   salariales du privé non-cadre). Approximation assumée et signalée par
 *   `estimated` : mieux vaut un ordre de grandeur exploitable qu'un `null` qui
 *   ferait passer l'offre pour "salaire non communiqué".
 * - Aucune tentative de requalifier un temps partiel en équivalent temps plein :
 *   la détection du temps partiel est traitée comme une **condition de travail**
 *   dans score.ts, pas comme un problème de conversion.
 */

/** Base légale mensuelle pour 35 h hebdomadaires (35 × 52 / 12). */
export const HOURS_PER_MONTH = 151.67;

/** Coefficient net -> brut (privé, non-cadre). Ordre de grandeur, pas une paie. */
const NET_TO_GROSS = 1.27;

export type SalaryBasis = "horaire" | "mensuel" | "annuel";

export interface ParsedSalary {
  /** Brut mensuel équivalent 35 h, borne basse de la fourchette annoncée. */
  monthlyGross: number;
  basis: SalaryBasis;
  /** true si une conversion approximative est intervenue (net -> brut, base déduite). */
  estimated: boolean;
}

/** Bandes de plausibilité par base : filtre les nombres parasites du libellé. */
const BANDS: Record<SalaryBasis, [number, number]> = {
  horaire: [5, 60],
  mensuel: [500, 15_000],
  annuel: [10_000, 300_000]
};

/**
 * Uniformise le texte : minuscules, espaces insécables, séparateurs de milliers
 * ("1 850" -> "1850"), virgule décimale ("12,50" -> "12.50").
 */
function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[   ]/g, " ") // espaces insécables / fines
    .replace(/[–—]/g, "-")
    .replace(/(\d)[  ](\d{3})\b/g, "$1$2") // 1 850 -> 1850
    .replace(/(\d)[.,](\d{3})\b/g, "$1$2") // 1.850 -> 1850 (3 chiffres = milliers, pas des décimales)
    .replace(/(\d),(\d{1,2})\b/g, "$1.$2") // 12,50 -> 12.50
    .replace(/\s+/g, " ")
    .trim();
}

/** Montant exprimé en milliers : "30k€", "entre 28 et 32 k€". */
const THOUSANDS_RE = /\d\s*k(?:\s*€|\b)/;

/** Base annoncée explicitement, sinon null (l'ordre de grandeur tranchera). */
function detectBasis(t: string): SalaryBasis | null {
  if (/horaire|\/ ?h\b|par heure|de l'heure|€ ?\/ ?h/.test(t)) return "horaire";
  if (/mensuel|par mois|\/ ?mois|au mois/.test(t)) return "mensuel";
  if (/annuel|par an|\/ ?an\b|annee|année/.test(t) || THOUSANDS_RE.test(t)) return "annuel";
  return null;
}

/** Nombre de mois de versement ("sur 13 mois" = 13ème mois inclus). */
function detectMonths(t: string): number {
  const m = /sur (\d{1,2}) mois/.exec(t);
  const n = m ? Number(m[1]) : 12;
  return n >= 12 && n <= 16 ? n : 12;
}

/**
 * Nombres candidats à être un montant. On retire d'abord les nombres qui n'en
 * sont jamais un (durée de versement, 13ème mois, heures hebdomadaires,
 * pourcentages, primes en %) : sans ce nettoyage, le "12" de "sur 12 mois"
 * passerait pour un taux horaire de 12 €.
 */
function extractNumbers(t: string): number[] {
  const cleaned = t
    .replace(/sur \d{1,2} mois/g, " ")
    .replace(/\d{1,2} ?(?:eme|ème|e|er) ?mois/g, " ")
    .replace(/\d+(?:\.\d+)? ?%/g, " ")
    .replace(/\d{1,2} ?h(?:eures?)?\b/g, " ") // 35h, 24 heures (temps de travail)
    .replace(/\d{1,2} ?jours?\b/g, " ")
    .replace(/caces? ?\d+/g, " ");
  const out: number[] = [];
  for (const m of cleaned.matchAll(/\d+(?:\.\d+)?/g)) {
    const v = Number(m[0]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Convertit un libellé de salaire en brut mensuel équivalent 35 h.
 * Renvoie null si aucun montant exploitable n'est identifiable ("selon profil",
 * "à négocier", ou texte sans chiffre plausible).
 */
export function parseSalary(raw?: string): ParsedSalary | null {
  if (!raw) return null;
  const t = normalizeText(raw);
  const numbers = extractNumbers(t);
  if (!numbers.length) return null;

  // "k€" : les montants sont exprimés en milliers ("30k€", "entre 28 et 32 k€").
  const values = THOUSANDS_RE.test(t) ? numbers.map((n) => (n < 500 ? n * 1000 : n)) : numbers;

  let basis = detectBasis(t);
  if (!basis) {
    // Pas de mot-clé : l'ordre de grandeur du plus gros montant tranche.
    const max = Math.max(...values);
    basis = max <= BANDS.horaire[1] ? "horaire" : max < BANDS.annuel[0] ? "mensuel" : "annuel";
  }

  const [lo, hi] = BANDS[basis];
  const candidates = values.filter((v) => v >= lo && v <= hi);
  if (!candidates.length) return null;

  const amount = Math.min(...candidates); // borne basse de la fourchette
  const months = detectMonths(t);

  let monthly: number;
  if (basis === "horaire") monthly = amount * HOURS_PER_MONTH;
  else if (basis === "annuel") monthly = amount / months;
  else monthly = (amount * months) / 12; // "mensuel sur 13 mois" -> lissé sur 12

  const isNet = /\bnets?\b/.test(t) && !/\bbruts?\b/.test(t);
  if (isNet) monthly *= NET_TO_GROSS;

  return {
    monthlyGross: Math.round(monthly),
    basis,
    estimated: isNet || detectBasis(t) === null
  };
}

/** Rapport au SMIC mensuel brut (1.0 = exactement au SMIC). */
export function smicRatio(monthlyGross: number, smicMonthlyGross: number): number {
  return monthlyGross / smicMonthlyGross;
}

/** Libellé compact pour le tracker : "≈ 2 050 €/mois brut (SMIC +10 %)". */
export function formatMonthly(monthlyGross: number, smicMonthlyGross: number): string {
  const pct = Math.round((smicRatio(monthlyGross, smicMonthlyGross) - 1) * 100);
  const amount = monthlyGross.toLocaleString("fr-FR");
  const rel = pct === 0 ? "= SMIC" : `SMIC ${pct > 0 ? "+" : "−"}${Math.abs(pct)} %`;
  return `≈ ${amount} €/mois brut (${rel})`;
}
