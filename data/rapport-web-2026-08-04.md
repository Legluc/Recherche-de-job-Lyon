# Passe web Lyon — 4 août 2026 (WTTJ + Indeed)

## Chiffres

| Source | Brutes | Après filtres zone/rejets | Scorées | Insérées |
|---|---|---|---|---|
| Welcome to the Jungle | 107 | 52 | 24 | 4 |
| Indeed | 81 (68 après dédup jk) | 27 | 31 | 9 |
| **Total** | **188** | **79** | **55** | **13** |

Doublons écartés par le pipeline : **34** (réf source déjà en base ou dédup floue).
Base Notion : 503 → 516 lignes. Aucune réf source insérée en double (vérifié après coup).

## Top 5

1. **87** — Téléconseillers H/F — Groupe VYV — Villeurbanne — WTTJ
2. **92** — Préparateur de commandes H/F (CDI, 1900-2100 €) — 1PACT — Saint-Priest — Indeed
3. **88** — Vendeur en boulangerie H/F (dès 1950 €) — Les Co'Pains d'Antan — Lyon 6e — Indeed
4. **88** — Vendeur en boulangerie-pâtisserie H/F — Boulangerie GASC — Sainte-Foy-lès-Lyon — Indeed
5. **85** — Préparateur de commandes / livreur H/F — Union des Droguistes Lyonnais — Beynost — Indeed

Répartition : 9 alimentaire, 4 dev.

## Problèmes et décisions

### Biais de scoring sur Indeed (corrigé)
`scoreOffer` accorde +8 à une offre de moins de 7 jours, mais Indeed ne publie pas de date
sur ses cartes : toutes ses offres partaient donc avec 8 points de retard, alors que le
paramètre `fromage=7` garantit déjà cette fraîcheur. Le +8 a été restitué pour cette source.
Sans ce correctif, les 4 offres dev retenues tombaient toutes sous le seuil de 70.
**À porter dans `src/score.ts` pour le run automatique.**

### Rejets manuels (12), non couverts par les regex
- **4 offres Adidas « Villefontaine »** : WTTJ les étiquette « Lyon » dans ses métadonnées
  alors que le poste est à Villefontaine (Isère, hors réseau TCL). Piège récurrent, à surveiller.
- **Intégrateur Essais F/H (NUWARD)** : « intégrateur » ici = essais nucléaires, pas web.
  Faux positif du classement Dev.
- **Préparateur Travaux (Ortec)** : préparation de chantier, donc BTP.
- Sales Executive, Animateur des Partenariats, Chef(fe) de projets stand : commercial B2B / itinérant.
- Préparateur en pharmacie, préparateur-réparateur VL : métiers réglementés hors profil.
- Vendeur maroquinerie « jeudi uniquement » : hors temps plein.

### Rendement dev faible — cause identifiée
Les pages SEO de WTTJ remontent des annonces anciennes : PRIMX (57 j), Indy (37 j),
Steamulo (28 j), Diot Siaci PHP (20 j), OVHcloud (18 j) dépassent toutes le plafond de
14 jours. Les offres dev récentes de WTTJ (Dougs, Galadrim, TheCodingMachine) étaient
déjà en base. La quasi-totalité du dev retenu vient donc d'Indeed.

### Limite d'extraction
Les descriptions collectées se limitent au contenu des cartes de résultats ; le bonus
`DEV_STACK` (+15) ne peut donc quasiment jamais se déclencher. Les offres dev sont
mécaniquement sous-notées face aux alimentaires. Enrichir en visitant chaque annonce
coûterait ~10 chargements de page par run — arbitrage à trancher.

## Santé des sources
- **WTTJ** : les 6 pages SEO répondent, extraction OK (107 offres). Le contrat n'est plus
  un nœud feuille (icône + texte), l'extracteur lit désormais `innerText`.
- **Indeed** : 7 requêtes, aucun CAPTCHA ni page de blocage. Sélecteurs `.job_seen_beacon`
  inchangés. Fuite géographique confirmée : 41 des 68 offres étaient hors zone.
