import type { JobType, NormalizedOffer, Contract } from "../types";
import { QUERIES } from "../config";
import type { CityConfig } from "../cities";

const BASE = "https://api.adzuna.com/v1/api/jobs/fr/search/1";

interface AdzunaJob {
  id: string;
  title?: string;
  description?: string;
  created?: string;
  redirect_url?: string;
  contract_type?: string; // "permanent" | "contract"
  salary_min?: number;
  salary_max?: number;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
}

function mapContract(t?: string): Contract | undefined {
  if (t === "permanent") return "CDI";
  if (t === "contract") return "CDD";
  return undefined;
}

function formatSalary(min?: number, max?: number): string | undefined {
  if (!min) return undefined;
  // Adzuna renvoie parfois un taux horaire (petites valeurs) au lieu d'un annuel.
  if (min < 100) return `≈ ${min}${max && max !== min ? "–" + max : ""} €/h`;
  return `${min}${max && max !== min ? "–" + max : ""} €/an`;
}

/** Récupère et normalise les offres Adzuna pour un type et une ville donnés. */
export async function fetchAdzuna(
  env: Record<string, string>,
  type: JobType,
  city: CityConfig
): Promise<NormalizedOffer[]> {
  const { ADZUNA_APP_ID, ADZUNA_APP_KEY } = env;
  const out: NormalizedOffer[] = [];
  const seen = new Set<string>();

  for (const q of QUERIES[type]) {
    const url =
      `${BASE}?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}` +
      `&results_per_page=50&what=${encodeURIComponent(q)}&where=${encodeURIComponent(city.adzunaWhere)}` +
      `&distance=${city.adzunaDistance}&max_days_old=14&sort_by=date`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        console.warn(`[adzuna] ${city.label} ${type} "${q}" -> HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { results?: AdzunaJob[] };
      for (const j of data.results ?? []) {
        if (!j.id || seen.has(j.id)) continue;
        seen.add(j.id);
        const area = j.location?.area ?? [];
        out.push({
          source: "Adzuna",
          ref: `adzuna:${j.id}`,
          type,
          title: j.title ?? "",
          company: j.company?.display_name ?? "",
          location: j.location?.display_name ?? area[area.length - 1] ?? "",
          contract: mapContract(j.contract_type),
          url: `https://www.adzuna.fr/details/${j.id}`,
          createdAt: j.created,
          salary: formatSalary(j.salary_min, j.salary_max),
          description: (j.description ?? "").slice(0, 1900),
          channel: "Plateforme"
        });
      }
    } catch (e) {
      console.warn(`[adzuna] ${city.label} ${type} "${q}" -> ${String(e)}`);
    }
    await new Promise((r) => setTimeout(r, 250)); // politesse / rate limit
  }
  return out;
}
