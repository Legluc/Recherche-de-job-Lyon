/**
 * OBSOLÈTE — conservé le temps que les anciens runs cessent de l'appeler.
 *
 * Ce script réimplémentait le scoring, la dédup et le plafond hors de
 * `pipeline.ts`, en violation de l'invariant du dépôt (cf. CLAUDE.md), et portait
 * deux correctifs devenus inutiles : le rejet des annonces « intern/internship »
 * (désormais dans UNWANTED_CONTRACT_RE) et le malus « Sénior » accentué
 * (désormais dans DEV_SENIOR_RE).
 *
 * Il est remplacé par `src/select-web.ts` (`npm run select-web`), qui passe par
 * `selectOffers` et qui, vivant dans `src/`, est couvert par `npm run typecheck`.
 * Ce fichier peut être supprimé.
 */
import "./src/select-web";
