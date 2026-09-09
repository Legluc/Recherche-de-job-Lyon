# Passe web — 3 août 2026 (WTTJ + Indeed)

## Volumes

| Source | Cartes collectées | Retenues zone/critères | Envoyées au pipeline | Insérées |
|---|---|---|---|---|
| Welcome to the Jungle | 107 (6 pages SEO) | 46 | 39 | 9 |
| Indeed | 101 (7 requêtes) | 35 | 28 | 8 |
| **Total** | **208** | **81** | **67** | **17 → 14 nettes** |

Pipeline (`run-select-web.ts`, `CITIES.lyon`) : 67 brutes → 55 scorées → 17 retenues (seuil `minScore = 70`).

## Top 5 (hors doublons)

1. **97** — Conseiller de Vente 17h H/F, Sessùn, Lyon (CDI, publiée aujourd'hui)
2. **82** — Conseiller(ère) de Vente Clients Pros, Brico Dépôt, Saint-Priest (CDI)
3. **82** — Conseiller(e) vente & service client CDI étudiant, Brico Dépôt, Saint-Priest
4. **78** — Conseiller-ère Vente randonnée 20H, Decathlon, Lyon (CDI) — *rayon randonnée, à mettre en avant*
5. **75** — Conseiller-ère Vente Omnicanal ±15h, Decathlon, Limonest (CDI)

Le score maximal du run (**100**, Développeur Fullstack JavaScript Junior chez PulseLife) portait sur une offre **déjà présente en base**.

## Problèmes rencontrés

### 1. Extracteur WTTJ cassé (corrigé)
Deux régressions cumulées :
- `innerText` renvoie une chaîne vide sur un document issu de `DOMParser` (pas de rendu) → 87 des 107 cartes sortaient sans lieu ;
- le type de contrat n'est plus un nœud feuille : c'est un `div` contenant une icône **et** un nœud texte, donc invisible à une extraction « feuilles uniquement ».

Correctif appliqué : extraction par **nœuds texte propres** (`childNodes` de type 3) de chaque élément, au lieu de `innerText` ou des feuilles. À reporter dans la skill.

### 2. Insertion de 3 doublons (corrigé)
Le cache `data/notion-existing.json` avait été reconstruit à partir d'une requête filtrée par entreprise ; les lignes dont le libellé « Entreprise » diffère dans Notion (ex. *PulseLife* vs *PulseLife (ex 360 medics)*) n'y figuraient pas. Trois lignes ont donc été créées en double :

- `wttj:developpeur-fullstack-javascript-junior-h-f_lyon`
- `wttj:modele-intermarche-hote-sse-de-caisse-h-f_villeurbanne`
- `indeed:2f876e4fb5c3638f`

Elles sont passées en **Statut = Écarté** avec une Note « DOUBLON … à supprimer » (le connecteur ne permet pas la suppression). Le cache contient désormais les **122 réf. web** présentes en base ; une ré-exécution du pipeline renvoie bien `retenues=0`.

À noter : la base contenait **déjà** des doublons de réf. antérieurs à ce run (ex. `indeed:11ae6577c04fc21c` en 3 exemplaires) — un passage de nettoyage serait utile.

### 3. Cartes Indeed à identifiant fabriqué
Deux cartes portaient un `data-jk` manifestement factice (`f1e2d3c4b5a67890`, `abcdef0123456789`) et dupliquaient une offre réelle. Écartées.

### 4. Rendement dev très faible
Une seule offre dev retenue, et c'était un doublon. Causes : `maxDaysOld = 14` élimine la majorité des annonces dev WTTJ (souvent 3-8 semaines d'ancienneté), le reste étant hors stack (Java, .NET, Go, Kotlin, COBOL, NiFi) ou senior/lead. Pistes : assouplir `maxDaysOld` pour le type `Dev` uniquement, ou élargir les pages SEO interrogées (`emploi-developpeur-web`, `emploi-integrateur-web`, `emploi-developpeur-wordpress`).

### 5. Contrainte technique de collecte
La sortie de `javascript_tool` est tronquée au-delà d'environ 1 050 caractères : l'export navigateur → sandbox doit se faire par tranches de 6 à 9 lignes. À documenter dans la skill pour éviter les allers-retours.

## Rien à signaler
Aucun CAPTCHA ni page de blocage sur Indeed. Les 6 pages SEO WTTJ et les 7 requêtes Indeed ont toutes répondu en HTTP 200. La récupération `fetch` same-origin sur Indeed renvoie même 16 cartes par requête, contre 10 sur la page rendue.
