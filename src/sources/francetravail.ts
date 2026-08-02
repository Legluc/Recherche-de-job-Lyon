import type { JobType, NormalizedOffer, Contract } from "../types";
import { QUERIES } from "../config";
import type { CityConfig } from "../cities";

const TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const SEARCH_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";

interface FtOffer {
  id: string;
  intitule?: string;
  description?: string;
  dateCreation?: string;
  typeContrat?: string; // "CDI" | "CDD" | "MIS" (intérim) ...
  entreprise?: { nom?: string };
  lieuTravail?: { libelle?: string; commune?: string; codePostal?: string };
  salaire?: { libelle?: string };
  origineOffre?: { urlOrigine?: string };
  contact?: { courriel?: string; urlPostulation?: string };
}

function mapContract(t?: string): Contract | undefined {
  if (!t) return undefined;
  if (t === "MIS") return "Intérim";
  if (t.startsWith("CDI")) return "CDI";
  if (t.startsWith("CDD")) return "CDD";
  return "Autre";
}

/** OAuth client_credentials France Travail. */
async function getToken(env: Record<string, string>): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.FT_CLIENT_ID,
    client_secret: env.FT_CLIENT_SECRET,
    scope: "api_offresdemploiv2 o2dsoffre"
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { access_token: string };
  return j.access_token;
}

/** Récupère et normalise les offres France Travail pour un type et une ville donnés. */
export async function fetchFranceTravail(
  env: Record<string, string>,
  type: JobType,
  city: CityConfig
): Promise<NormalizedOffer[]> {
  let token: string;
  try {
    token = await getToken(env);
  } catch (e) {
    console.warn(`[france travail] token -> ${String(e)}`);
    return [];
  }

  const out: NormalizedOffer[] = [];
  const seen = new Set<string>();

  for (const q of QUERIES[type]) {
    const params = new URLSearchParams({
      motsCles: q,
      departement: city.ftDepartement,
      typeContrat: "CDI,CDD",
      sort: "1", // tri par date décroissante
      range: "0-49"
    });
    try {
      const res = await fetch(`${SEARCH_URL}?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
      });
      if (res.status === 204) continue; // aucun résultat
      if (!res.ok && res.status !== 206) {
        console.warn(`[france travail] "${q}" -> HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { resultats?: FtOffer[] };
      for (const o of data.resultats ?? []) {
        if (!o.id || seen.has(o.id)) continue;
        seen.add(o.id);
        const courriel = o.contact?.courriel;
        out.push({
          source: "France Travail",
          ref: `ft:${o.id}`,
          type,
          title: o.intitule ?? "",
          company: o.entreprise?.nom ?? "",
          location: o.lieuTravail?.libelle ?? o.lieuTravail?.commune ?? "",
          postalCode: o.lieuTravail?.codePostal,
          contract: mapContract(o.typeContrat),
          url: o.origineOffre?.urlOrigine ?? `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
          createdAt: o.dateCreation,
          salary: o.salaire?.libelle,
          description: (o.description ?? "").slice(0, 1900),
          contact: courriel,
          channel: courriel ? "Email" : o.contact?.urlPostulation ? "Formulaire" : "Plateforme"
        });
      }
    } catch (e) {
      console.warn(`[france travail] "${q}" -> ${String(e)}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}
