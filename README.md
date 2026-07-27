# job-hunter-lyon

Collecte automatisée d'offres d'emploi (**France Travail** + **Adzuna**) vers des bases **Notion**, pour deux villes :

| Ville | Profils | Zone | Contrat privilégié | Base Notion |
| --- | --- | --- | --- | --- |
| **Lyon** (objectif) | alimentaire + dev | Lyon + première couronne (≤ 45 min en transport) | CDI | `NOTION_DATABASE_ID` |
| **Annecy** (repli) | alimentaire | Annecy + couronne bus SIBRA | CDD (ne bloque pas le départ) | `NOTION_DATABASE_ID_ANNECY` |

Tourne tout seul via **GitHub Actions** (cron du soir, en semaine), sans serveur à maintenir.

## Architecture

```
src/
  types.ts            Modèle pivot (NormalizedOffer, ScoredOffer)
  cities.ts           Configuration par ville (zone, département, base Notion, contrats)
  config.ts           Filtres communs, requêtes, règles de scoring
  score.ts            Filtrage (zone, exclusions, pertinence) + scoring 0–100
  sources/
    francetravail.ts  OAuth client_credentials + recherche (dépt 69)
    adzuna.ts         Recherche via clés app_id/app_key
  notion.ts           Dédup (lecture "Réf source") + insertion des pages
  main.ts             Orchestration : collecte -> score -> dédup -> insertion
  cleanup.ts          Archivage des offres "À traiter" (nettoyage)
  selftest.ts         Tests hors-ligne du scoring
.github/workflows/collect.yml   Cron GitHub Actions
```

Flux : chaque source renvoie un `NormalizedOffer[]` (format pivot). `score.ts` filtre (hors zone, mots-clés éliminatoires, offres non pertinentes) et attribue un score. On déduplique d'abord intra-run (par `ref`), puis contre l'existant Notion (les `Réf source` déjà présentes). Les nouvelles offres sont insérées en statut « À traiter ».

### Choix techniques

- **TypeScript / Node 20, zéro dépendance runtime.** On s'appuie sur le `fetch` natif de Node : moins de surface de dépendances, build plus simple, exécution rapide sur le runner. `tsx` (dev) exécute le TS sans étape de compilation.
- **Déduplication côté Notion (pas d'état local).** La source de vérité est la base elle-même : on lit les `Réf source` existantes à chaque run. Avantage : idempotence et pas de dérive d'état (contrairement à un ledger local qu'il faudrait committer). Coût : une requête paginée à chaque exécution — négligeable à l'échelle d'un suivi personnel.
- **Une ville par exécution (`CITY=lyon|annecy`).** Le workflow lance une matrice de jobs, un par ville, avec `fail-fast: false` : logs séparés et l'échec d'une ville n'empêche pas l'autre. Le scoring, la dédup et les filtres restent mutualisés — un seul endroit à corriger.
- **`Promise.allSettled` sur les sources.** Une panne de France Travail ne doit pas empêcher Adzuna d'alimenter la base (et inversement). Résilience > atomicité ici.
- **Zone approximée par whitelist de communes + préfixes postaux.** Compromis assumé : pas d'isochrone réel (qui demanderait une API de calcul d'itinéraire et de la maintenance) ; une liste de communes bien desservies TCL/TER couvre le « ≤ 45 min sans voiture » pour la v1.

## Installation

### 1. Prérequis
- Node.js ≥ 20 (pour un lancement local ; sur GitHub Actions c'est géré).

### 2. Créer les accès
- **France Travail** : sur https://francetravail.io, créer une application et souscrire à l'API **Offres d'emploi v2**. Récupérer `client_id` et `client_secret`.
- **Adzuna** : sur https://developer.adzuna.com, récupérer `app_id` et `app_key`.
- **Notion** :
  1. Créer une intégration interne sur https://www.notion.so/my-integrations → copier le **token** (`ntn_...`).
  2. Ouvrir la base **Offres** dans Notion → menu `•••` → **Connexions** → ajouter l'intégration. Sans ce partage, l'API renverra 404.

### 3. Configurer les secrets GitHub
Dans le repo → **Settings → Secrets and variables → Actions → New repository secret**, créer :

| Secret | Valeur |
| --- | --- |
| `FT_CLIENT_ID` | identifiant client France Travail |
| `FT_CLIENT_SECRET` | clé secrète France Travail |
| `ADZUNA_APP_ID` | app_id Adzuna |
| `ADZUNA_APP_KEY` | app_key Adzuna |
| `NOTION_TOKEN` | token d'intégration Notion |
| `NOTION_DATABASE_ID` | `00d27d0a42ac4121b51571a7e1d706b0` (base Lyon) |
| `NOTION_DATABASE_ID_ANNECY` | `07402a38d91e4e2989c1623ca87f0230` (base Annecy) |

### 4. Activer le workflow
Onglet **Actions** → activer les workflows. Le job tourne automatiquement en semaine (voir la note fuseau horaire dans `collect.yml`) et peut être lancé à la main via **Run workflow** (`workflow_dispatch`).

## Lancement local

```bash
cp .env.example .env   # renseigner les valeurs
npm install
CITY=lyon npm start    # collecte réelle -> Notion (ou CITY=annecy)
CITY=lyon npm run cleanup   # archive les offres "À traiter" (corbeille) après une sur-collecte
npm run selftest       # tests de scoring (hors-ligne)
npm run typecheck      # vérification des types
```

## Volume & nettoyage

Chaque run n'insère que les **`MAX_INSERT` meilleures offres** (défaut 40) au-dessus de `LIMITS.minScore` — sans ce plafond, une recherche large sature vite le tracker. La dédup s'appuie sur les `Réf source` : si la lecture Notion échoue, le run **s'arrête** au lieu d'insérer à l'aveugle (anti-doublon).

Après une sur-collecte, `npm run cleanup` archive les offres « À traiter » (corbeille Notion, réversible) en préservant celles déjà triées ; relancer ensuite `npm start`.

## Scoring (résumé)

Base 50, puis : fraîcheur (+15 si ≤ 3 j, +8 si ≤ 7 j), contrat selon la ville (Lyon : CDI +15 / CDD +8 — Annecy : CDD +15 / CDI +5), salaire affiché (+5), ville centre (+5) sinon périphérie (+2). Pour le **dev** : correspondance stack (+15), mention junior/débutant (+8), malus senior/lead/architecte (−12), et rejet si l'offre n'est pas réellement dev. Pour l'**alimentaire** : correspondance secteur connu (+12) et rejet sur mots-clés éliminatoires (nuit, postés, restauration, BTP…).

**Alternance/apprentissage** : non recherché. Rejet ferme si le titre ou le type de contrat l'indique ; simple malus si le mot n'apparaît que dans la description (cas d'un CDI qui mentionne « alternance possible »).

Ajuster les poids dans `config.ts` (communs) et `cities.ts` (par ville).

## Limites & pistes

- Les endpoints France Travail (OAuth + recherche) n'ont pas pu être testés depuis l'environnement de développement initial (réseau restreint) : **surveiller les logs du premier run** dans l'onglet Actions. En cas d'erreur de scope, essayer `application_<FT_CLIENT_ID> api_offresdemploiv2 o2dsoffre`.
- Sources sans API (Indeed, Welcome to the Jungle) : hors périmètre de ce moteur, gérées séparément via une passe navigateur.
- Fuseau : le cron est en UTC ; passer à `0 19 * * 1-5` en heure d'hiver pour rester à 20:00 Paris.
