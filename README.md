# job-hunter-lyon

Collecte automatisée d'offres d'emploi (**France Travail** + **Adzuna**, plus une passe navigateur pour Indeed et Welcome to the Jungle) vers une base **Notion**, ciblée sur **Lyon et sa première couronne** (≤ 45 min en transport, sans voiture).

**Profil unique : emploi alimentaire, week-ends libres, temps plein.** Le poste lui-même compte moins que les conditions : on accepte des métiers jamais exercés — une passe de tri IA arbitre en aval — et on refuse les mauvaises conditions.

Tourne tout seul via **GitHub Actions** (cron du soir, en semaine), sans serveur à maintenir.

> **Historique des cibles.** Août 2026 : Lyon + Annecy, dev + alimentaire. Septembre 2026 : Annecy retirée (poste trouvé sur place) ; le secret GitHub `NOTION_DATABASE_ID_ANNECY` et sa base Notion peuvent être supprimés. **Octobre 2026 : le profil Dev est abandonné.** La recherche ne porte plus que sur l'emploi alimentaire lyonnais. Ne pas réintroduire ces pistes sans décision explicite — plusieurs règles (requêtes, quotas, seuils) ont été simplifiées en conséquence.

## Architecture

```
src/
  types.ts            Modèle pivot (NormalizedOffer, ScoredOffer)
  cities.ts           Configuration géographique (zone, département, base Notion, contrats)
  config.ts           Filtres, requêtes, SMIC, barèmes de scoring
  salary.ts           Normalisation des salaires -> brut mensuel équivalent 35 h
  score.ts            Rejets fermes (zone, conditions, compétences) + scoring 0–100
  dedup.ts            Déduplication floue (clés normalisées titre/entreprise/commune)
  pipeline.ts         Traitement commun : scoring -> tri -> dédup -> seuil -> plafond
  sources/
    francetravail.ts  OAuth client_credentials + recherche (dépt 69)
    adzuna.ts         Recherche via clés app_id/app_key
  notion.ts           Dédup (lecture "Réf source") + insertion des pages
  main.ts             Run automatique (APIs) : collecte -> pipeline -> insertion
  ingest-file.ts      Ingestion d'un JSON collecté via navigateur (Indeed, WTTJ)
  select-web.ts       Sélection de la passe navigateur quand Notion n'est joignable que par le connecteur
  cleanup.ts          Archivage des offres "À traiter" (nettoyage)
  selftest.ts         Tests hors-ligne (scoring, salaires, dédup, pipeline)
.github/workflows/collect.yml   Cron GitHub Actions
```

Flux : chaque source renvoie un `NormalizedOffer[]` (format pivot). `score.ts` écarte (hors zone, mots d'exclusion, conditions inacceptables) et note le reste. On déduplique d'abord intra-run (par `ref`), puis contre l'existant Notion (les `Réf source` déjà présentes). Les nouvelles offres sont insérées en statut « À traiter », d'où une passe de tri IA les reprend pour arbitrage final.

### Choix techniques

- **TypeScript / Node 20, zéro dépendance runtime.** On s'appuie sur le `fetch` natif de Node : moins de surface de dépendances, build plus simple, exécution rapide sur le runner. `tsx` (dev) exécute le TS sans étape de compilation.
- **Déduplication côté Notion (pas d'état local).** La source de vérité est la base elle-même : on lit les `Réf source` existantes à chaque run. Avantage : idempotence et pas de dérive d'état (contrairement à un ledger local qu'il faudrait committer). Coût : une requête paginée à chaque exécution — négligeable à l'échelle d'un suivi personnel.
- **`CityConfig` conservé malgré la ville unique.** L'objet isole tout ce qui dépend du territoire (zone, département, base Notion, pondération des contrats). Le démonter toucherait huit fichiers pour zéro gain fonctionnel ; ajouter une ville reste une entrée dans `CITIES`.
- **Profil unique, mais `type` conservé dans le modèle.** Le dev abandonné, `JobType` ne vaut plus que `"Alimentaire"`. Le champ reste dans le pivot parce que la propriété `Type` du tracker existe toujours et que d'anciens lots collectés portent encore `"Dev"` : `score.ts` s'en sert pour **écarter** ces restes plutôt que de les noter avec une grille qui ne leur correspond pas. Le mécanisme de quotas par profil (`INSERT_SHARE`) a disparu avec le second profil : une seule passe par score décroissant suffit.
- **Sources sans API : le navigateur collecte, le repo décide.** Indeed et Welcome to the Jungle n'ont pas d'API exploitable ; ils sont parcourus à vitesse humaine via le navigateur, qui produit un JSON brut. Ce fichier passe ensuite par le **même** `pipeline.ts` que le run automatique. On évite ainsi une seconde implémentation du scoring qui divergerait à la première modification.
- **Deux chemins d'entrée pour la passe navigateur, un seul moteur de sélection.** `ingest-file.ts` suppose le `NOTION_TOKEN` disponible et écrit lui-même dans Notion ; il sert au lancement local. La tâche planifiée, elle, ne dispose que du connecteur Notion (le token ne vit que dans les secrets GitHub Actions) : elle passe donc par `select-web.ts`, qui lit l'existant depuis un fichier, appelle le même `selectOffers` et rend les retenues dans `data/web-selected.json`, à charge pour le connecteur de les insérer. Deux orchestrations, aucune règle de scoring dupliquée.
- **Rejet ferme plutôt que malus quand la contrainte est matérielle.** Travail de week-end annoncé, temps partiel, encadrement dans l'intitulé, véhicule personnel exigé : ces offres ne correspondent pas à la recherche, les pondérer ne ferait que les faire remonter un jour où le vivier est maigre. Le malus de 20 points qui s'appliquait à l'encadrement et au véhicule était d'ailleurs inopérant — absorbé par le plafond de 100 sur une offre par ailleurs bien notée.
- **Information absente ≠ information mauvaise.** Contrat non publié, date non publiée, rythme non précisé : valeur neutre, pas zéro, et surtout pas un rejet. Sans cela, une source entière passe sous le seuil pour une lacune de format, pas pour un défaut d'offre — 45 des 46 annonces alimentaires du dernier lot Indeed ne disent rien de leur rythme.
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
npm run select-web     # sélection de la passe navigateur (sans NOTION_TOKEN) -> data/web-selected.json
npm run selftest       # tests hors-ligne (scoring, salaires, dédup, pipeline)
npm run typecheck      # vérification des types
```

## Volume & nettoyage

Chaque run n'insère que les **`MAX_INSERT` meilleures offres** au-dessus du seuil (défaut 30 sur le workflow, 20 dans `LIMITS`). La passe navigateur a son propre plafond, `WEB_CAP` (défaut 20), et son propre seuil, `WEB_MIN_SCORE` (défaut 84).

**Le budget quotidien du tri IA est la somme des deux collecteurs** : 30 + 20 = 50 offres. Changer l'un de ces nombres sans mettre à jour le plafond du prompt de tri crée un arriéré silencieux d'offres jamais analysées.

La dédup s'appuie sur les `Réf source` : si la lecture Notion échoue, le run **s'arrête** au lieu d'insérer à l'aveugle (anti-doublon). Après une sur-collecte, `npm run cleanup` archive les offres « À traiter » (corbeille Notion, réversible) en préservant celles déjà triées.

## Filtrage et scoring

### Rejets fermes (l'offre n'est pas notée)

| Motif | Détail |
| --- | --- |
| Hors zone | commune absente de `communesWhitelist` et code postal hors `postalPrefixes` |
| Offre trop ancienne | publiée il y a plus de 14 jours (`FILTERS.maxDaysOld`) |
| Mots d'exclusion | nuit, 2x8/3x8, postés, BTP, restauration (`FILTERS.hardExclude`) |
| **Travail de week-end annoncé** | « travail le samedi », « 1 samedi sur 2 », « du lundi au samedi », « 7j/7 » (`WEEKEND_WORK_RE`) |
| **Temps partiel annoncé** | « temps partiel », « mi-temps », « 24h/semaine » (`PART_TIME_RE`) |
| Encadrement dans l'intitulé | responsable, manager, directeur, chef de, superviseur (`MANAGEMENT_RE`) |
| Véhicule personnel exigé | permis B oui, voiture non (`VEHICLE_REQUIRED_RE`) |
| Alternance / stage / freelance | dans l'intitulé ou le type de contrat |
| Profil `Dev` résiduel | reste d'un ancien lot collecté |

### Scoring (base 50)

| Critère | Points |
| --- | --- |
| Publiée ≤ 3 j / ≤ 7 j / date absente | +15 / +8 / +8 |
| CDI / CDD / contrat non publié | +15 / +8 / +8 |
| Commune de Lyon / périphérie | +5 / +2 |
| **Week-ends libres prouvés** (« du lundi au vendredi », « week-ends non travaillés ») | **+15** |
| Salaire ≥ SMIC +30 % / +15 % / +5 % / au SMIC / sous le SMIC | +22 / +16 / +8 / +2 / −12 |
| Salaire affiché mais non chiffré (« selon profil ») | +3 |
| Secteur : support informatique / back-office ou banque / administratif / relation client ou accueil / retail ou logistique / manutention / propreté | +14 / +10 / +8 / +6 / +5 / +4 / +3 |
| Alternance mentionnée en description seule | −25 |
| Commercial terrain ou B2B | −20 |

Seuil de sélection : **80** (`LIMITS.minScore`), relevé à **84** pour la passe navigateur.

Le SMIC de référence est déclaré une seule fois dans `config.ts` (`SMIC`, revalorisation du 1er juin 2026 : 12,31 €/h, 1 867,02 €/mois brut). `salary.ts` ramène tout libellé de source à un **brut mensuel équivalent 35 h** — horaire × 151,67, annuel ÷ nombre de mois de versement, net × 1,27 — en retenant la **borne basse** des fourchettes : on note ce qui est garanti, pas l'affichage. Le montant normalisé, l'écart au SMIC et le rythme détecté sont recopiés dans la propriété `Salaire` du tracker, pour la passe de tri.

### Le critère week-end, en pratique

Trois lignes de défense, parce qu'aucune ne suffit seule :

1. **En amont, les requêtes.** La vente en magasin, la grande distribution, la boulangerie et l'hôtellerie ont été retirées de `QUERIES` : ces métiers travaillent le samedi par construction. Les collecter revenait à remplir le tracker d'offres écartées ensuite une par une.
2. **Au scoring, le texte.** `WEEKEND_WORK_RE` écarte les formulations affirmatives, `WEEKEND_FREE_RE` bonifie les preuves de lundi-vendredi. Les annonces muettes passent sans bonus : sur le dernier lot navigateur, 45 annonces sur 46 ne disent rien de leur rythme — les exiger explicites fermerait la collecte.
3. **En aval, la passe de tri IA.** C'est elle qui ouvre l'annonce complète et vérifie le rythme sur preuve verbatim. Le moteur lui livre un vivier plausible ; elle tranche.

## Limites & pistes

- **Le score sature à 100.** La somme des bonus possibles dépasse 120 : deux offres excellentes se retrouvent à égalité, et un malus (commercial B2B) peut devenir invisible. C'est pourquoi les contraintes matérielles sont des rejets fermes et non des malus. Rééchelonner le barème obligerait à recalibrer les seuils (80, 84) et rendrait les scores historiques du tracker incomparables : pas fait pour l'instant, la passe de tri IA restant l'arbitre final.
- Le seuil de 80 suppose que le salaire soit publié : une offre correcte mais muette sur la rémunération n'obtient aucun bonus et ne passe que si le reste est bon. C'est délibéré (transparence salariale = signal), à surveiller si le volume retenu s'effondre.
- La conversion net → brut (×1,27) est un ordre de grandeur, pas une paie : elle suffit à classer, pas à négocier.
- Indeed applique des protections anti-bot agressives : la passe navigateur est *best-effort* (en cas de CAPTCHA, la source est sautée pour ce run). Indeed fuit aussi beaucoup hors zone — 24 des 46 annonces alimentaires du dernier lot ont été écartées pour cette raison.
- Fuseau : le cron est en UTC ; passer à `0 19 * * 1-5` en heure d'hiver pour rester à 20:00 Paris.
