/**
 * Outillage de la passe navigateur : prépare le code à coller dans le navigateur
 * et rassemble les lots collectés.
 *
 * Pourquoi dans le dépôt plutôt que dans le prompt de la tâche planifiée : les
 * sélecteurs des sites changent, et un extracteur versionné se corrige, se relit
 * et se teste comme le reste du moteur. Le prompt n'a plus qu'à exécuter.
 *
 * Usage :
 *   npx tsx src/browser-script.ts hellowork   # code complet pour l'onglet HelloWork
 *   npx tsx src/browser-script.ts csp         # Choisir le service public
 *   npx tsx src/browser-script.ts jtms        # Jobs That Make Sense
 *   npx tsx src/browser-script.ts indeed      # URLs à visiter + extracteur de page
 *   npx tsx src/browser-script.ts merge       # data/web-raw-*.json -> data/web-raw.json
 *
 * Le code émis commence par `var CFG = {...}` : réglages de browser/sources.json
 * plus les identifiants déjà présents dans Notion (data/notion-existing.json),
 * pour que l'extracteur n'ouvre pas le détail d'une offre déjà connue. Le fichier
 * de l'existant doit donc être écrit AVANT d'appeler ce script.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";

/**
 * Âge maximal d'un lot fusionné. La tâche planifiée ne peut pas supprimer de
 * fichier sur le poste (droit de suppression désactivé par défaut) : les lots
 * d'un run précédent restent dans data/. On ne fusionne donc que ceux écrits
 * dans les dernières heures, sinon une page Indeed d'hier, non réécrite parce
 * qu'un CAPTCHA a interrompu la source aujourd'hui, serait réinjectée.
 */
const MAX_BATCH_AGE_MS = 6 * 3_600_000;

const EXISTING_FILE = process.env.WEB_EXISTING || "data/notion-existing.json";
const RAW_FILE = process.env.WEB_RAW || "data/web-raw.json";
const PREFIX: Record<string, string> = { hellowork: "hellowork:", csp: "csp:", jtms: "jtms:", indeed: "indeed:" };

function knownIds(prefix: string): string[] {
  if (!existsSync(EXISTING_FILE)) return [];
  const parsed = JSON.parse(readFileSync(EXISTING_FILE, "utf-8")) as Array<{ ref?: string }> | { refs?: string[] };
  const refs = Array.isArray(parsed) ? parsed.map((r) => r.ref ?? "") : parsed.refs ?? [];
  return refs.filter((r) => r.startsWith(prefix)).map((r) => r.slice(prefix.length));
}

const name = process.argv[2] ?? "";
const sources = JSON.parse(readFileSync("browser/sources.json", "utf-8")) as Record<string, Record<string, unknown>>;

if (name === "merge") {
  // Un fichier par source (ou par page Indeed) : une écriture interrompue ne
  // corrompt que son propre lot, et l'on voit d'où vient chaque offre.
  const batches = readdirSync("data").filter((f) => /^web-raw-.+\.json$/.test(f)).sort();
  const files = batches.filter((f) => Date.now() - statSync(`data/${f}`).mtimeMs < MAX_BATCH_AGE_MS);
  const stale = batches.length - files.length;
  const all: Array<{ ref?: string }> = [];
  const seen = new Set<string>();
  const counts: string[] = [];
  for (const f of files) {
    const rows = JSON.parse(readFileSync(`data/${f}`, "utf-8")) as Array<{ ref?: string }>;
    let n = 0;
    for (const r of rows) {
      if (!r.ref || seen.has(r.ref)) continue;
      seen.add(r.ref);
      all.push(r);
      n++;
    }
    counts.push(`${f} ${n}`);
  }
  writeFileSync(RAW_FILE, JSON.stringify(all, null, 2), "utf-8");
  console.log(
    `${all.length} offres -> ${RAW_FILE} (${counts.join(", ") || "aucun lot"})` +
      (stale ? ` ; ${stale} lot(s) de plus de 6 h ignoré(s)` : "")
  );
} else if (name === "indeed") {
  const cfg = sources.indeed as { url: string; queries: string[] };
  console.log("// URLs à visiter, une par une, ~2 s d'intervalle :");
  for (const q of cfg.queries) console.log(`// ${cfg.url.replace("{q}", encodeURIComponent(q).replace(/%20/g, "+"))}`);
  console.log(readFileSync("browser/indeed.js", "utf-8"));
} else if (PREFIX[name]) {
  const { origin, ...cfg } = sources[name] ?? {};
  const config = { ...cfg, known: knownIds(PREFIX[name]) };
  console.log(`// Onglet à ouvrir avant exécution : ${String(origin)}`);
  console.log(`var CFG = ${JSON.stringify(config)};`);
  console.log(readFileSync("browser/common.js", "utf-8"));
  console.log(readFileSync(`browser/${name}.js`, "utf-8"));
} else {
  console.error("Usage : npx tsx src/browser-script.ts <hellowork|csp|jtms|indeed|merge>");
  process.exit(1);
}
