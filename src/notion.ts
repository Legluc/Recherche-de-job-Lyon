import type { ScoredOffer } from "./types";

const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": VERSION,
    "Content-Type": "application/json"
  };
}

/**
 * Récupère toutes les "Réf source" déjà présentes dans la base : c'est la source de
 * vérité pour la déduplication (idempotence, pas d'état local à maintenir).
 */
export async function getExistingRefs(env: Record<string, string>): Promise<Set<string>> {
  const refs = new Set<string>();
  let cursor: string | undefined;
  do {
    const res = await fetch(`${API}/databases/${env.NOTION_DATABASE_ID}/query`, {
      method: "POST",
      headers: headers(env.NOTION_TOKEN),
      body: JSON.stringify({ page_size: 100, start_cursor: cursor })
    });
    if (!res.ok) {
      console.warn(`[notion] query -> HTTP ${res.status}: ${await res.text()}`);
      break;
    }
    const data = (await res.json()) as {
      results?: Array<{ properties?: Record<string, any> }>;
      has_more?: boolean;
      next_cursor?: string;
    };
    for (const page of data.results ?? []) {
      const rt = page.properties?.["Réf source"]?.rich_text?.[0]?.plain_text;
      if (rt) refs.add(rt);
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return refs;
}

function toProperties(o: ScoredOffer): Record<string, unknown> {
  const p: Record<string, unknown> = {
    Poste: { title: [{ text: { content: o.title.slice(0, 200) || "(sans titre)" } }] },
    Type: { select: { name: o.type } },
    Secteur: { select: { name: o.sector } },
    Statut: { select: { name: "À traiter" } },
    Score: { number: o.score },
    Source: { select: { name: o.source } },
    "Réf source": { rich_text: [{ text: { content: o.ref } }] }
  };
  if (o.company) p["Entreprise"] = { rich_text: [{ text: { content: o.company.slice(0, 200) } }] };
  if (o.location) p["Lieu"] = { rich_text: [{ text: { content: o.location.slice(0, 200) } }] };
  if (o.contract) p["Contrat"] = { select: { name: o.contract } };
  if (o.url) p["Lien"] = { url: o.url };
  if (o.createdAt) p["Date offre"] = { date: { start: o.createdAt.slice(0, 10) } };
  if (o.salary) p["Salaire"] = { rich_text: [{ text: { content: o.salary.slice(0, 200) } }] };
  if (o.channel) p["Canal"] = { select: { name: o.channel } };
  if (o.contact) p["Contact"] = { rich_text: [{ text: { content: o.contact.slice(0, 200) } }] };
  return p;
}

/** Insère les offres (une page par offre). Renvoie le nombre inséré. */
export async function insertOffers(env: Record<string, string>, offers: ScoredOffer[]): Promise<number> {
  let n = 0;
  for (const o of offers) {
    const res = await fetch(`${API}/pages`, {
      method: "POST",
      headers: headers(env.NOTION_TOKEN),
      body: JSON.stringify({ parent: { database_id: env.NOTION_DATABASE_ID }, properties: toProperties(o) })
    });
    if (res.ok) n++;
    else console.warn(`[notion] insert "${o.title}" -> HTTP ${res.status}: ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 350)); // ~3 req/s (limite Notion)
  }
  return n;
}
