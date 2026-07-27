/**
 * Nettoyage ponctuel : archive toutes les offres au statut "À traiter" (corbeille
 * Notion, réversible), en préservant celles déjà triées (Postulé, Entretien…).
 * À lancer après une sur-collecte, puis relancer `npm start` (moteur plafonné).
 * Usage : npm run cleanup
 */
import { archivePending } from "./notion";

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

const env = requireEnv(["NOTION_TOKEN", "NOTION_DATABASE_ID"]);
const n = await archivePending(env);
console.log(`Archivé ${n} offres "À traiter" (récupérables dans la corbeille Notion).`);
