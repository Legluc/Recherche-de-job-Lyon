import type { NormalizedOffer, ScoredOffer } from "./types";
import { FILTERS, DEV_RELEVANT, DEV_STACK, SECTOR_KEYWORDS, ALTERNANCE_RE, ALTERNANCE_MALUS } from "./config";

function daysAgo(iso?: string): number {
  if (!iso) return 99;
  const t = Date.parse(iso);
  return isNaN(t) ? 99 : (Date.now() - t) / 86_400_000;
}

/** Vérifie que l'offre est dans la zone accessible (whitelist commune OU préfixe postal). */
function inGeo(o: NormalizedOffer): boolean {
  const loc = (o.location || "").toLowerCase();
  if (!loc && !o.postalCode) return true; // pas d'info exploitable : on ne rejette pas
  const byCommune = FILTERS.communesWhitelist.some((c) => loc.includes(c));
  const byPostal = !!o.postalCode && FILTERS.postalPrefixes.some((p) => o.postalCode!.startsWith(p));
  return byCommune || byPostal;
}

function sectorOf(text: string): string {
  for (const { sector, re } of SECTOR_KEYWORDS) if (re.test(text)) return sector;
  return "Autre";
}

/**
 * Score l'offre (0–100) ou renvoie null si elle doit être écartée.
 * Règles alignées sur les critères de Lucas : trajet, contrat, fraîcheur,
 * correspondance sectorielle (alimentaire) ou stack (dev).
 */
export function scoreOffer(o: NormalizedOffer): ScoredOffer | null {
  const title = (o.title || "").toLowerCase();
  const full = `${o.title} ${o.description}`.toLowerCase();

  if (!inGeo(o)) return null;
  if (daysAgo(o.createdAt) > FILTERS.maxDaysOld) return null;

  let score = 50;
  const cd = daysAgo(o.createdAt);
  if (cd <= 3) score += 15;
  else if (cd <= 7) score += 8;

  if (o.contract === "CDI") score += 15;
  else if (o.contract === "CDD") score += 8;

  // Alternance/apprentissage : non souhaité.
  // - Titre ou type de contrat explicite -> rejet ferme (un malus laissait passer
  //   certaines offres pile au seuil : filtrage plus fiable que pondération).
  // - Mention uniquement dans la description -> simple malus, car il peut s'agir
  //   d'un CDI qui évoque l'alternance en passant ("alternance possible").
  if (o.contract === "Alternance" || ALTERNANCE_RE.test(title)) return null;
  if (ALTERNANCE_RE.test(full)) score -= ALTERNANCE_MALUS;

  if (o.salary) score += 5;
  score += /lyon/.test((o.location || "").toLowerCase()) ? 5 : 2;

  let sector: string;
  if (o.type === "Dev") {
    if (!DEV_RELEVANT.test(full)) return null; // écarte le bruit non-dev
    sector = "Dév web";
    if (DEV_STACK.test(full)) score += 15; // correspondance stack
    if (/junior|débutant|premier emploi/.test(full)) score += 8; // sans alternance/apprenti
    if (/senior|lead|confirmé|principal|architecte/.test(title)) score -= 12; // profil junior
  } else {
    if (FILTERS.alimentaireExclude.some((k) => full.includes(k))) return null; // nuit/resto/BTP...
    sector = sectorOf(full);
    if (sector !== "Autre") score += 12;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { ...o, sector, score };
}
