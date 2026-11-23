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
  /** Profils recherchés (un seul depuis l'abandon du dev). */
  types: JobType[];
  /** Paramètres de recherche Adzuna. */
  adzunaWhere: string;
  adzunaDistance: number;
  /** Département pour l'API France Travail. */
  ftDepartement: string;
  /** Zone retenue (noms de communes ; la comparaison ignore casse, accents et tirets). */
  communesWhitelist: string[];
  /**
   * Communes proches mais NON retenues, testées avant la liste blanche. Elles
   * protègent de deux fuites : un libellé qui contient « Lyon » sans être à Lyon
   * (« Sainte-Foy-lès-Lyon », « Tassin-la-Demi-Lune, Lyon » chez Adzuna) et un code
   * postal partagé (69330 = Meyzieu ET Jonage). Elles servent aussi à la dédup
   * floue, pour reconnaître la commune d'un libellé hors zone.
   */
  communesExcluded: string[];
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
    // Profil unique depuis octobre 2026 : le dev a été abandonné.
    types: ["Alimentaire"],
    adzunaWhere: "Lyon",
    adzunaDistance: 15,
    ftDepartement: "69",
    /*
     * Zone resserrée en novembre 2026 sur le réseau lourd TCL (métro et tramway),
     * état du réseau au 23/11/2026. Règle : une commune n'est retenue que si une
     * ligne de métro ou de tramway dessert son centre ou ses zones d'emploi de
     * bureau, avec un trajet direct vers Part-Dieu, Bellecour ou Perrache en
     * 40 min environ. Une commune desservie seulement par des bus, même proche,
     * est écartée : une ou deux lignes de bus, c'est une correspondance ratée ou
     * un bus plein qui fait perdre la journée, sans voiture pour se rattraper.
     *
     * Retenues, et la ligne qui les justifie :
     * - Lyon (9 arrondissements), Villeurbanne : métro A, B, tram T1, T3, T4, T6.
     * - Caluire-et-Cuire : métro C (Cuire), commune limitrophe de Lyon 4e.
     * - Vénissieux : métro D (Gare de Vénissieux, Parilly), tram T4 au centre.
     * - Bron : tram T2, T5, T6 (Hôpitaux Est, Europe-Université).
     * - Vaulx-en-Velin : métro A et tram T3 (La Soie).
     * - Oullins-Pierre-Bénite : métro B (Gare d'Oullins, Oullins Centre).
     * - Saint-Genis-Laval : métro B (Hôpital Sud, depuis 2023) ; centre-ville en
     *   bus, mais le pôle hospitalier et administratif est au pied du métro.
     * - Décines-Charpieu, Meyzieu : tram T3 (Décines Centre, Meyzieu Gare, ZI).
     * - Saint-Priest : tram T2 (Hôtel de Ville, Parc Technologique, Porte des
     *   Alpes), pôle de centres d'appels et de back-offices.
     *
     * Écartées (`communesExcluded`) : bus seulement, ou station en lisière qui ne
     * dessert pas la commune (Chassieu : T5 à Eurexpo ; Feyzin : T4 à l'hôpital).
     *
     * À réexaminer : Saint-Fons à la mise en service du tram T10 (été 2027 selon
     * Sytral Mobilités) ; le tram T9 (Vaulx-en-Velin nord, prévu juin 2027) ne
     * change rien à la liste, Vaulx étant déjà retenue.
     */
    communesWhitelist: [
      "lyon", "villeurbanne", "caluire-et-cuire", "caluire", "vénissieux", "bron",
      "vaulx-en-velin", "oullins-pierre-bénite", "oullins", "pierre-bénite",
      "saint-genis-laval", "décines-charpieu", "décines", "meyzieu", "saint-priest"
    ],
    communesExcluded: [
      // Métropole de Lyon, communes non retenues (bus seulement ou trop loin)
      "saint-fons", "rillieux-la-pape", "rillieux", "écully", "tassin-la-demi-lune", "tassin",
      "sainte-foy-lès-lyon", "sainte-foy", "chassieu", "corbas", "feyzin", "la mulatière",
      "francheville", "craponne", "jonage", "limonest", "neuville-sur-saône", "mions",
      "irigny", "saint-genis-les-ollières", "charbonnières-les-bains", "dardilly",
      "champagne-au-mont-d'or", "saint-didier-au-mont-d'or", "saint-cyr-au-mont-d'or",
      "collonges-au-mont-d'or", "la tour-de-salvagny", "marcy-l'étoile", "sathonay-camp",
      "sathonay-village", "fontaines-sur-saône", "fontaines-saint-martin", "solaize",
      "vernaison", "charly", "givors", "grigny", "genay", "lissieu",
      // Hors Métropole, vus en fuite dans les lots Indeed et HelloWork
      "genas", "beynost", "miribel", "la boisse", "brignais", "chaponost", "chaponnay",
      "saint-bonnet-de-mure", "saint-laurent-de-mure", "colombier-saugnieu",
      "saint-quentin-fallavier", "villefranche-sur-saône", "thurins"
      // Pas de « Vienne » ni d'« Anse » : la route de Vienne traverse Lyon 7e et
      // 8e, un libellé d'adresse lyonnais serait écarté à tort.
    ],
    // Codes postaux explicites : le préfixe "69" laissait passer tout le Rhône.
    // 69330 couvre aussi Jonage : le nom de commune, testé d'abord, l'écarte.
    postalPrefixes: [
      "69001", "69002", "69003", "69004", "69005", "69006", "69007", "69008", "69009",
      "69100", "69300", "69200", "69500", "69120", "69600", "69310", "69230",
      "69150", "69330", "69800"
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
