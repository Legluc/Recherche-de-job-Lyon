# Passe navigateur — 10 septembre 2026

## Incident : sandbox indisponible, moteur exécuté hors `npm run select-web`

Le sandbox Linux n'a pas démarré de tout le run (5 tentatives, échec identique :
`failed to mount … Plan9 share "c" which is not mounted`). `npm run select-web`
n'a donc pas pu être lancé.

Repli appliqué, conformément à la consigne « applique les mêmes règles à la main
plutôt que de tout abandonner » : `config.ts`, `cities.ts`, `salary.ts`,
`score.ts`, `dedup.ts`, `pipeline.ts` et `select-web.ts` ont été lus et
translittérés en JavaScript, puis exécutés dans le moteur JS du navigateur —
barèmes, seuils, regex, quotas et dédup identiques au dépôt. Ce port est un
artefact jetable de ce run : il ne vit pas dans `src/`, rien n'a été dupliqué
dans le dépôt.

**Limite à connaître** : le résultat n'a pas été validé par `npm run selftest`.
Les 12 offres insérées le sont sur la foi de cette translittération.
`data/web-raw.json` n'a pas pu être écrit (le navigateur n'écrit pas sur disque,
le sandbox était mort), donc ce lot précis n'est pas rejouable a posteriori.
`data/notion-existing.json` est à jour et inclut les 12 insertions du run.

## Welcome to the Jungle : 4 pages SEO sur 8 en 404

Ces URL renvoient désormais un soft-404 (HTTP 200, `<title>Erreur 404</title>`) :

- `/fr/pages/emploi-developpeur-web-lyon-69001`
- `/fr/pages/emploi-integrateur-web-lyon-69001`
- `/fr/pages/emploi-developpeur-javascript-lyon-69001`
- `/fr/pages/emploi-charge-de-clientele-lyon-69001`

L'index `/fr/pages/offres-emploi-par-metiers-villes` ne les liste plus. Côté dev,
il ne reste que `developpeur-front-end`, `developpeur-php` et `software-engineer`
— **le vivier dev WTTJ a été amputé de moitié**. Remplacements alimentaires pris
dans l'index : `office-manager`, `assistant-comptable`, `assistant-rh`.

À arbitrer pour la prochaine passe : figer cette liste réduite dans
`prompt-passe-navigateur.md`, ou relire l'index à chaque run (plus robuste, une
requête de plus).

## Défauts d'extraction WTTJ corrigés pendant le run

1. **`innerText` inutilisable sur un document `DOMParser`.** Un document non
   rendu n'a pas de retours ligne : la découpe par lignes rendait 0 contrat et
   0 salaire sur les 7 pages récupérées en `fetch`. Seule la page réellement
   chargée dans l'onglet fonctionnait — d'où un biais silencieux qui sous-notait
   toute la source.
2. **Les feuilles du DOM ne suffisent pas.** `CDI` et le montant du salaire sont
   des nœuds texte imbriqués dans des éléments qui ont eux-mêmes des enfants :
   ils échappent à un filtre `children.length === 0`. La lecture fiable passe par
   un `TreeWalker` sur `SHOW_TEXT`. Après correction : 81/81 contrats, 81/81
   dates, 34/81 salaires.
3. **Libellés de contrat hors énum.** WTTJ produit `CDD / Temporaire`, mais aussi
   des valeurs polluées par le titre (`CDI - Senior Software Engineer`). Une
   valeur hors `Contract` (types.ts) ferait rejeter la page par l'API Notion et
   fausserait `contractPoints`. Normalisation par préfixe appliquée.
4. **Badge « Déjà vu » / « Nouveau ».** Quand la carte porte un badge, tous les
   segments décalent d'un cran et `entreprise` reçoit le titre de l'offre
   (3 cas sur 81 ce run). Aucune des 12 offres insérées n'est touchée, mais la
   dédup floue perd ces lignes. **Non corrigé** — à traiter au prochain run en
   prenant le segment qui suit le `h2` plutôt que l'indice 1.

## Anomalie Indeed

6 cartes portent un `data-jk` visiblement synthétique (`789abcdef0123456`,
`a1b2c3d4e5f67890`, `123456789abcdef0`…) et dupliquent une offre réelle. La dédup
par titre + entreprise + commune les a toutes écartées ; aucune n'a été insérée.
À surveiller : si le motif se répète, filtrer ces `jk` à la collecte.
