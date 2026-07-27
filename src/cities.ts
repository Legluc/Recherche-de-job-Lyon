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
   */
  contractPoints: { CDI: number; CDD: number };
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
    postalPrefixes: ["69", "01700"],
    notionDbEnv: "NOTION_DATABASE_ID",
    contractPoints: { CDI: 15, CDD: 8 }
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
    contractPoints: { CDI: 5, CDD: 15 }
  }
};

export function getCity(key: string): CityConfig {
  const city = CITIES[key.toLowerCase()];
  if (!city) throw new Error(`Ville inconnue : "${key}". Valeurs possibles : ${Object.keys(CITIES).join(", ")}`);
  return city;
}
