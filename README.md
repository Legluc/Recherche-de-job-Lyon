# job-hunter-lyon

Collecte automatisée d'offres d'emploi (**France Travail** + **Adzuna**) vers une base **Notion**, ciblée sur **Lyon et sa première couronne** (≤ 45 min en transport, sans voiture).

| Profil | Objectif | Contrat privilégié | Seuil de sélection |
| --- | --- | --- | --- |
| **Dev** | l'objectif du projet | CDI | 70 |
| **Alimentaire** | financer l'installation, sans bloquer la recherche dev | CDI puis CDD | 80 (conditions exigeantes) |

Tourne tout seul via **GitHub Actions** (cron du soir, en semaine), sans serveur à maintenir.

> La piste **Annecy** a été retirée du moteur (poste trouvé sur place). Le secret GitHub `NOTION_DATABASE_ID_ANNECY` et la base Notion associée peuvent être supprimés : plus rien ne les lit.

## Architecture

```
src/
  types.ts            Modèle pivot (NormalizedOffer, ScoredOffer)
  cities.ts           Configuration géographique (zone, département, base Notion, contrats)
  config.ts           Filtres, requêtes, SMIC, barèmes de scoring
  salary.ts           Normalisation des salaires -> brut mensuel équivalent 35 h
  score.ts            Filtrage (zone, exclusions, pertinence) + scoring 0–100
  dedup.ts            Déduplication floue (clés normalisées titre/entreprise/commune)
  pipeline.ts         Traitement commun : scoring -> tri -> dédup -> quotas -> plafond
  sources/
    francetravail.ts  OAuth client_credentials + recherche (dépt 69)
    adzuna.ts         Recherche via clés app_id/app_key
  notion.ts           Dédup (lecture "Réf source") + insertion des pages
  main.ts             Run automatique (APIs) : collecte -> pipeline -> insertion
  ingest-file.ts      Ingestion d'un JSON collecté via navigateur (Indeed, WTTJ)
  cleanup.ts          Archivage des offres "À traiter" (nettoyage)
  selftest.ts         Tests hors-ligne (scoring, salaires, dédup, quotas)
.github/workflows/collect.yml   Cron GitHub Actions
```

Flux : chaque source renvoie un `NormalizedOffer[]` (format pivot). `score.ts` filtre (hors zone, mots-clés éliminatoires, offres non pertinentes) et attribue un score. On déduplique d'abord intra-run (par `ref`), puis contre l'existant Notion (les `Réf source` déjà présentes). Les nouvelles offres sont insérées en statut « À traiter », d'où une passe de tri IA les reprend pour arbitrage final.

### Choix techniques

- **TypeScript / Node 20, zéro dépendance runtime.** On s'appuie sur le `fetch` natif de Node : moins de surface de dépendances, build plus simple, exécution rapide sur le runner. `tsx` (dev) exécute le TS sans étape de compilation.
- **Déduplication côté Notion (pas d'état local).** La source de vérité est la base elle-même : on lit les `Réf source` existantes à chaque run. Avantage : idempotence et pas de dérive d'état (contrairement à un ledger local qu'il faudrait committer). Coût : une requête paginée à chaque exécution — négligeable à l'échelle d'un suivi personnel.
- **`CityConfig` conservé malgré la ville unique.** L'objet isole tout ce qui dépend du territoire (zone, département, base Notion, pondération des contrats). Le démonter toucherait huit fichiers pour zéro gain fonctionnel ; ajouter une ville reste une entrée dans `CITIES`.
- **Sources sans API : le navigateur collecte, le repo décide.** Indeed et Welcome to the Jungle n'ont pas d'API exploitable ; ils sont parcourus à vitesse humaine via le navigateur, qui produit un JSON brut. Ce fichier passe ensuite par `ingest-file.ts`, qui réutilise **le même** `pipeline.ts` que le run automatique. On évite ainsi une seconde implémentation du scoring qui divergerait à la première modification.
- **Information absente ≠ information mauvaise.** Contrat non publié, date non publiée : ces sources (WTTJ, cartes Indeed) reçoivent une valeur neutre, pas zéro. Sans cela, une source entière passe sous le seuil pour une lacune de format, pas pour un défaut d'offre.
- **Déduplication floue à deux niveaux.** L'ID de source ne détecte pas une annonce republiée ailleurs. On compare donc des clés normalisées (accents, ponctuation et mentions H/F retirés) : `titre+entreprise+commune` toujours, et `titre+commune` uniquement quand l'un des deux côtés est un intermédiaire (intérim, jobboard). Le tri par score précède la dédup : on conserve la variante la mieux notée.
- **`Promise.allSettled` sur les sources.** Une panne de France Travail ne doit pas empêcher Adzuna d'alimenter la base (et inversement). Résilience > atomicité ici.
- **Zone approximée par whitelist de communes + préfixes postaux.** Compromis assumé : pas d'isochrone réel (qui demanderait une API de calcul d'itinéraire et de la maintenance) ; une liste de communes bien desservies TCL/TER couvre le « ≤ 45 min sans voiture ».

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

| Secret | Valeur |
| --- | --- |
| `FT_CLIENT_ID` | identifiant client France Travail |
| `FT_CLIENT_SECRET` | clé secrète France Travail |
| `ADZUNA_APP_ID` | app_id Adzuna |
| `ADZUNA_APP_KEY` | app_key Adzuna |
| `NOTION_TOKEN` | token d'intégration Notion |
| `NOTION_DATABASE_ID` | `00d27d0a42ac4121b51571a7e1d706b0` (base Lyon) |

### 4. Activer le workflow
Onglet **Actions** → activer les workflows. Le job tourne automatiquement en semaine (voir la note fuseau horaire dans `collect.yml`) et peut être lancé à la main via **Run workflow** (`workflow_dispatch`).

## Lancement local

```bash
cp .env.example .env   # renseigner les valeurs
npm install
npm start              # collecte réelle -> Notion
npm run cleanup        # archive les offres "À traiter" (corbeille) après une sur-collecte
DRY_RUN=1 npm run ingest -- offres.json   # aperçu d'un lot collecté au navigateur
npm run ingest -- offres.json             # puis insertion réelle
npm run selftest       # tests hors-ligne (scoring, salaires, dédup, quotas)
npm run typecheck      # vérification des types
```

## Volume & nettoyage

Chaque run n'insère que les **`MAX_INSERT` meilleures offres** (défaut 30 sur le workflow) au-dessus du seuil de leur profil. Le plafond est **réparti entre dev et alimentaire** (`INSERT_SHARE`, 50/50) : le vivier alimentaire, très large depuis l'élargissement des requêtes, ne peut plus noyer les offres dev. Les slots non consommés par un profil sont réattribués à l'autre.

La dédup s'appuie sur les `Réf source` : si la lecture Notion échoue, le run **s'arrête** au lieu d'insérer à l'aveugle (anti-doublon). Après une sur-collecte, `npm run cleanup` archive les offres « À traiter » (corbeille Notion, réversible) en préservant celles déjà triées.

## Scoring

Base 50, puis, pour tous les profils :

| Critère | Points |
| --- | --- |
| Publiée ≤ 3 j / ≤ 7 j / date absente | +15 / +8 / +8 |
| CDI / CDD / contrat non publié | +15 / +8 / +8 |
| Commune de Lyon / périphérie | +5 / +2 |
| Alternance, stage, freelance (titre ou type de contrat) | rejet ferme |
| Alternance mentionnée en description seule | −25 |
| Encadrement dans le titre / commercial terrain | −20 / −20 |

**Dev** : correspondance stack +15, mention junior/débutant +8, salaire affiché +5, malus séniorité −12 (`Sénior` accentué inclus), rejet si l'offre n'est pas réellement dev.

**Alimentaire** — le poste compte moins que les conditions :

| Critère | Points |
| --- | --- |
| Salaire ≥ SMIC +30 % / +15 % / +5 % / au SMIC / sous le SMIC | +22 / +16 / +8 / +2 / −12 |
| Salaire affiché mais non chiffré ("selon profil") | +3 |
| Week-ends libres (« du lundi au vendredi », « week-ends non travaillés ») | +12 |
| Travail le week-end / le dimanche / 1 samedi sur 2 | −15 |
| Temps partiel | −10 |
| Secteur : support informatique / back-office, banque / administratif / relation client, accueil / retail, logistique / manutention / propreté | +14 / +10 / +8 / +6 / +5 / +4 / +3 |
| Nuit, équipes postées, BTP, restauration | rejet ferme |

Le SMIC de référence est déclaré une seule fois dans `config.ts` (`SMIC`, revalorisation du 1er juin 2026 : 12,31 €/h, 1 867,02 €/mois brut). `salary.ts` ramène tout libellé de source à un **brut mensuel équivalent 35 h** — horaire × 151,67, annuel ÷ nombre de mois de versement, net × 1,27 — en retenant la **borne basse** des fourchettes : on note ce qui est garanti, pas l'affichage. Le montant normalisé et l'écart au SMIC sont recopiés dans la propriété `Salaire` du tracker, pour la passe de tri.

Deux règles ont été assouplies au profit d'une exigence sur les conditions :

- « week-end » et « dimanche » ne sont plus **éliminatoires**. La recherche par sous-chaîne rejetait aussi les annonces qui promettent « week-ends non travaillés » — exactement celles qu'on veut. Le rythme est désormais une pondération.
- Les requêtes alimentaires couvrent des secteurs jamais exercés (support informatique, back-office, ADV, banque/assurance, administratif, tri, propreté…). Une passe de tri IA intervient en aval : le coût d'un faux positif est faible face à celui d'une offre jamais collectée.

Ajuster les barèmes dans `config.ts`, la zone dans `cities.ts`.

## Limites & pistes

- Le seuil alimentaire (80) suppose que le salaire soit publié : une offre correcte mais muette sur la rémunération n'obtient aucun bonus et ne passe que si le reste est excellent. C'est délibéré (transparence salariale = signal), à surveiller si le volume retenu s'effondre.
- Le plafond du score est fixé à 100 : les meilleures offres saturent et leur ordre relatif se resserre. La passe de tri IA reste l'arbitre final.
- La conversion net → brut (×1,27) est un ordre de grandeur, pas une paie : elle suffit à classer, pas à négocier.
- Indeed applique des protections anti-bot agressives : la passe navigateur est *best-effort* (en cas de CAPTCHA, la source est sautée pour ce run). Welcome to the Jungle est généralement accessible.
- Fuseau : le cron est en UTC ; passer à `0 19 * * 1-5` en heure d'hiver pour rester à 20:00 Paris.
