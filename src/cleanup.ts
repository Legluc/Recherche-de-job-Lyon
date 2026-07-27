/**
 * Nettoyage ponctuel : archive toutes les offres au statut "À traiter" (corbeille
 * Notion, réversible), en préservant celles déjà triées (Postulé, Entretien…).
 * À lancer après une sur-collecte, puis relancer `npm start` (moteur plafonné).
 * Usage : CITY=lyon npm run cleanup   (ou CITY=annecy)
 */
import { archivePending } from "./notion";
import { getCity } from "./cities";

function requireEnv(keys: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  const missing: string[] = [];
  for (const k of keys) {
    const v = process.env[k];
    if (!v) missing.push(k);
    else env[k] = v;
  }
  if (missing.length) throw new Error(`Variables d'environnement manquantes : ${missing.join(", ")}`);
  return env;
}

const city = getCity(process.env.CITY || "lyon");
const env = requireEnv(["NOTION_TOKEN", city.notionDbEnv]);
const n = await archivePending(env, env[city.notionDbEnv]);
console.log(`${city.label} : archivé ${n} offres "À traiter" (récupérables dans la corbeille Notion).`);
