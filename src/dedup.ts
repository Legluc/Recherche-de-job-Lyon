import type { CityConfig } from "./cities";

/**
 * Déduplication floue.
 *
 * La dédup par identifiant de source ne voit pas la même annonce republiée
 * ailleurs (constaté : "Développeur Web senior H/F" sous deux IDs Adzuna, et
 * "LEAD DÉVELOPPEUR WEB" publié à la fois par Direct Emploi et Randstad).
 * On compare donc des clés normalisées, à deux niveaux :
 *
 * - clé stricte  : titre + entreprise + commune  -> toujours appliquée ;
 * - clé souple   : titre + commune               -> appliquée seulement si l'un
 *   des deux côtés est un intermédiaire (intérim, jobboard, recruteur anonyme),
 *   qui sont le vecteur des republications. Sans cette restriction, deux vraies
 *   offres distinctes ("Préparateur de commandes" chez deux entrepôts de la même
 *   commune) seraient fusionnées à tort.
 */

/** Cabinets de recrutement, agences d'intérim et jobboards qui republient les annonces. */
const INTERMEDIARY_RE =
  /direct emploi|randstad|manpower|adecco|domino|expectra|synergie|proman|crit\b|supplay|actual|gi group|page personnel|michael page|fed |free-?work|hellowork|recruteur anonyme|int[eé]rim|talent|apec|jobandtalent|lynx rh|aquila|temporis|start people|leader interim/i;

/** Minuscules, sans accents, sans ponctuation ni mentions H/F, espaces normalisés. */
export function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .replace(/\(?\s*[hfm]\s*[\/-]\s*[hfm]\s*\)?/g, " ") // (h/f), f/h, m/f...
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Ramène un libellé de lieu à une commune canonique : "Lyon 1er",
 * "1er-Arrondissement, Lyon" et "Lyon, Rhône" donnent tous "lyon".
 * On retient la commune connue la plus longue trouvée dans le libellé, pour que
 * "Meyzieu, Lyon" donne bien "meyzieu" et non "lyon".
 */
export function canonicalCommune(location: string, city: CityConfig): string {
  const n = normalize(location);
  let best = "";
  for (const c of city.communesWhitelist) {
    const cn = normalize(c);
    if (cn && n.includes(cn) && cn.length > best.length) best = cn;
  }
  if (best) return best;
  // Pas de commune connue : on retire les mentions d'arrondissement et les chiffres.
  return n.replace(/\b(arrondissement|er|eme|e)\b/g, " ").replace(/\d+/g, " ").trim().replace(/\s+/g, " ");
}

export function isIntermediary(company: string): boolean {
  return !company.trim() || INTERMEDIARY_RE.test(company);
}

export interface OfferLike {
  title: string;
  company: string;
  location: string;
}

export function strictKey(o: OfferLike, city: CityConfig): string {
  return `${normalize(o.title)}|${normalize(o.company)}|${canonicalCommune(o.location, city)}`;
}

export function looseKey(o: OfferLike, city: CityConfig): string {
  return `${normalize(o.title)}|${canonicalCommune(o.location, city)}`;
}

/**
 * Index de déduplication : on y enregistre les offres déjà connues (existant
 * Notion + offres retenues pendant le run) et on interroge avant insertion.
 */
export class DedupIndex {
  private strict = new Set<string>();
  private loose = new Set<string>();
  private looseFromIntermediary = new Set<string>();

  constructor(private city: CityConfig) {}

  isDuplicate(o: OfferLike): boolean {
    if (this.strict.has(strictKey(o, this.city))) return true;
    const lk = looseKey(o, this.city);
    // Le doublon est probable si l'un des deux côtés est un intermédiaire.
    if (this.looseFromIntermediary.has(lk)) return true;
    if (isIntermediary(o.company) && this.loose.has(lk)) return true;
    return false;
  }

  add(o: OfferLike): void {
    this.strict.add(strictKey(o, this.city));
    const lk = looseKey(o, this.city);
    this.loose.add(lk);
    if (isIntermediary(o.company)) this.looseFromIntermediary.add(lk);
  }
}
