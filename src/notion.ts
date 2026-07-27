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

/** fetch avec retry sur 429 (rate limit) et 5xx : évite les faux échecs transitoires. */
async function fetchWithRetry(url: string, init: RequestInit, tries = 4): Promise<Response> {
  let res!: Response;
  for (let i = 0; i < tries; i++) {
    res = await fetch(url, init);
    if (res.status !== 429 && res.status < 500) return res;
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  return res;
}

/**
 * Récupère toutes les "Réf source" déjà présentes : source de vérité pour la dédup.
 * Lève une erreur si une page de résultats échoue — indispensable, car une lecture
 * partielle ferait ré-insérer des doublons (le tracker se noierait).
 */
export async function getExistingRefs(env: Record<string, string>, databaseId: string): Promise<Set<string>> {
  const refs = new Set<string>();
  let cursor: string | undefined;
  do {
    const res = await fetchWithRetry(`${API}/databases/${databaseId}/query`, {
      method: "POST",
      headers: headers(env.NOTION_TOKEN),
      body: JSON.stringify({ page_size: 100, start_cursor: cursor })
    });
    if (!res.ok) throw new Error(`[notion] query -> HTTP ${res.status}: ${await res.text()}`);
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
export async function insertOffers(env: Record<string, string>, databaseId: string, offers: ScoredOffer[]): Promise<number> {
  let n = 0;
  for (const o of offers) {
    const res = await fetchWithRetry(`${API}/pages`, {
      method: "POST",
      headers: headers(env.NOTION_TOKEN),
      body: JSON.stringify({ parent: { database_id: databaseId }, properties: toProperties(o) })
    });
    if (res.ok) n++;
    else console.warn(`[notion] insert "${o.title}" -> HTTP ${res.status}: ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 350)); // ~3 req/s (limite Notion)
  }
  return n;
}

/**
 * Archive (corbeille Notion, réversible) toutes les offres au statut "À traiter".
 * Sert au nettoyage ponctuel après une sur-collecte. Préserve les offres déjà
 * triées (Postulé, Entretien…). Renvoie le nombre archivé.
 */
export async function archivePending(env: Record<string, string>, databaseId: string): Promise<number> {
  let n = 0;
  // On re-interroge depuis le début à chaque tour : les pages archivées sortent du
  // filtre "À traiter", donc les 100 suivantes remontent naturellement. On s'arrête
  // quand il n'y a plus rien à archiver (pas de pagination par curseur sur un
  // ensemble qui change sous nos pieds).
  for (;;) {
    const res = await fetchWithRetry(`${API}/databases/${databaseId}/query`, {
      method: "POST",
      headers: headers(env.NOTION_TOKEN),
      body: JSON.stringify({ page_size: 100, filter: { property: "Statut", select: { equals: "À traiter" } } })
    });
    if (!res.ok) throw new Error(`[notion] query -> HTTP ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { results?: Array<{ id: string }> };
    const pages = data.results ?? [];
    if (pages.length === 0) break;
    for (const page of pages) {
      const del = await fetchWithRetry(`${API}/pages/${page.id}`, {
        method: "PATCH",
        headers: headers(env.NOTION_TOKEN),
        body: JSON.stringify({ archived: true })
      });
      if (del.ok) n++;
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  return n;
}
