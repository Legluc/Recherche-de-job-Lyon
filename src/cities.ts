import type { JobType } from "./types";

/**
 * Configuration géographique de la recherche.
 *
 * Le projet ne cible plus qu'une ville (Lyon) : la piste Annecy a été abandonnée,
 * un poste y ayant été trouvé. On conserve néanmoins la structure `CityConfig`
 * plutôt que d'inliner les constantes dans score.ts et dedup.ts : elle isole en un
 * seul objet tout ce qui dépend du territoire (zone, département, base Notion,
 * pondération des contrats), et le démontage de cette indirection toucherait huit
 * fichiers pour aucun gain fonctionnel. Ajouter une ville reste une entrée ici.
 */
export interface CityConfig {
  key: string;
  label: string;
  /** Profils recherchés dans cette ville. */
  types: JobType[];
  /** Paramètres de recherche Adzuna. */
  adzunaWhere: string;
  adzunaDistance: number;
  /** Département pour l'API France Travail. */
  ftDepartement: string;
  /** Zone accessible sans voiture (communes en minuscules). */
  communesWhitelist: string[];
  postalPrefixes: string[];
  /** Nom de la variable d'environnement contenant l'ID de base Notion. */
  notionDbEnv: string;
  /**
   * Points par type de contrat. Lyon étant l'objectif d'installation, le CDI prime.
   *
   * `unknown` est appliqué quand la source ne publie pas le type de contrat
   * (cas courant sur Welcome to the Jungle). Sans cette valeur neutre, ces
   * offres perdraient 15 points pour une simple absence d'information et
   * seraient artificiellement classées derrière celles de France Travail.
   */
  contractPoints: { CDI: number; CDD: number; unknown: number };
}

export const CITIES: Record<string, CityConfig> = {
  lyon: {
    key: "lyon",
    label: "Lyon",
    types: ["Alimentaire", "Dev"],
    adzunaWhere: "Lyon",
    adzunaDistance: 15,
    ftDepartement: "69",
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
    // Codes postaux explicites : le préfixe "69" laissait passer tout le Rhône
    // (Villefranche, Anse...), bien au-delà des 45 min en transport.
    postalPrefixes: [
      "69001", "69002", "69003", "69004", "69005", "69006", "69007", "69008", "69009",
      "69100", "69200", "69500", "69120", "69300", "69600", "69310", "69190", "69140",
      "69150", "69330", "69130", "69160", "69110", "69800", "69680", "69960", "69320",
      "69350", "69340", "69290", "69740", "69230", "69760", "69250", "01700"
    ],
    notionDbEnv: "NOTION_DATABASE_ID",
    contractPoints: { CDI: 15, CDD: 8, unknown: 8 }
  }
};

/** Ville par défaut : le moteur n'en cible qu'une, la variable CITY reste une commodité. */
export const DEFAULT_CITY = "lyon";

export function getCity(key: string): CityConfig {
  const city = CITIES[key.toLowerCase()];
  if (!city) throw new Error(`Ville inconnue : "${key}". Valeurs possibles : ${Object.keys(CITIES).join(", ")}`);
  return city;
}
