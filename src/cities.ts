import type { JobType } from "./types";

/**
 * Configuration par ville. Le moteur est mono-ville par exécution (variable CITY) :
 * logs isolés, et l'échec d'une ville n'affecte pas l'autre.
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
   * Points par type de contrat. Volontairement différent selon la ville :
   * à Lyon (objectif d'installation) le CDI prime ; à Annecy (solution de repli)
   * le CDD est préférable car il ne bloque pas le départ.
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
  },

  annecy: {
    key: "annecy",
    label: "Annecy",
    // Plan B : uniquement l'alimentaire (le dev reste concentré sur Lyon).
    types: ["Alimentaire"],
    adzunaWhere: "Annecy",
    adzunaDistance: 12,
    ftDepartement: "74",
    // Annecy (communes fusionnées) + couronne desservie par le réseau SIBRA.
    communesWhitelist: [
      "annecy", "annecy-le-vieux", "cran-gevrier", "seynod", "meythet", "pringy",
      "épagny", "epagny", "metz-tessy", "épagny metz-tessy", "epagny metz-tessy",
      "poisy", "argonay", "chavanod"
    ],
    postalPrefixes: ["74000", "74940", "74960", "74600", "74370", "74330", "74650"],
    notionDbEnv: "NOTION_DATABASE_ID_ANNECY",
    // CDD privilégié : un contrat court n'enferme pas à Annecy.
    contractPoints: { CDI: 5, CDD: 15, unknown: 8 }
  }
};

export function getCity(key: string): CityConfig {
  const city = CITIES[key.toLowerCase()];
  if (!city) throw new Error(`Ville inconnue : "${key}". Valeurs possibles : ${Object.keys(CITIES).join(", ")}`);
  return city;
}
