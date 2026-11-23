# CLAUDE.md — job-hunter-lyon

Contexte à charger avant toute intervention sur ce dépôt.

## Objet

Moteur de collecte d'offres d'emploi (France Travail + Adzuna, plus une passe navigateur pour Indeed, HelloWork, Choisir le service public et Jobs That Make Sense) vers une base Notion. Une passe de tri IA reprend ensuite les offres insérées en statut « À traiter ».

**Cible unique : un emploi alimentaire à Lyon, temps plein, dimanche libre, en CDI** (CDD d'au moins 12 mois accepté dans le public et l'associatif). Domaines visés, par ordre de valeur : bureau et relation client, administration publique, associatif, puis commerce alimentaire et retail. Le moteur privilégie le rappel sur les intitulés dans ces domaines (l'IA trie en aval) et la sévérité sur les **conditions**.

Historique des cibles, à ne pas réintroduire sans décision explicite :

- Août 2026 : Lyon + Annecy, profils Dev et Alimentaire.
- Septembre 2026 : Annecy retirée (poste trouvé sur place).
- **Octobre 2026 : profil Dev abandonné.** Requêtes dev, regex `DEV_*`, branche de scoring dev et quotas par profil (`INSERT_SHARE`) supprimés. `JobType` ne vaut plus que `"Alimentaire"` ; le champ `type` subsiste dans le pivot pour **écarter** les offres `"Dev"` que portent encore d'anciens lots collectés.
- **Novembre 2026 : critères revus en entretien.** Samedi accepté, dimanche libre exigé (`SUNDAY_WORK_RE` remplace `WEEKEND_WORK_RE`). CDD rejeté sauf public / associatif ≥ 12 mois. Horaires coupés rejetés. Informatique (support compris), logistique / production et propreté exclues sur l'intitulé (`EXCLUDED_DOMAINS`). Commerce alimentaire et retail réintégrés, encadrement de petite équipe accepté dans ces deux secteurs. Nouveaux secteurs `Commerce alimentaire`, `Administration publique`, `Associatif`. WTTJ abandonné (rendement nul hors tech). Zone resserrée sur les communes desservies par le métro ou le tramway (11 communes au lieu de 28) ; Saint-Fons à réexaminer à l'ouverture du tram T10 (été 2027).

## Stack et contraintes

- TypeScript strict, Node ≥ 20, ESM, **zéro dépendance runtime** (`fetch` natif). `tsx` en dev uniquement. Toute proposition de dépendance runtime doit être justifiée.
- Exécution sur GitHub Actions (cron du soir en semaine) : pas de serveur, pas d'état local. La source de vérité de la déduplication est la base Notion elle-même.
- Commentaires et messages de log **en français**.

## Invariants à ne pas casser

- `pipeline.ts` est le **seul** chemin de sélection : le run automatique (`main.ts`), l'ingestion navigateur (`ingest-file.ts`) et la sélection de la tâche planifiée (`select-web.ts`) l'utilisent tous les trois. Ne jamais dupliquer la logique de scoring dans un script ad hoc destiné à durer. Un script de sélection vit dans `src/` pour être couvert par `npm run typecheck` (`tsconfig.json` n'inclut que ce dossier) ; à la racine, il échapperait à la vérification.
- Les valeurs écrites dans une propriété `select` de Notion (`Source`, `Secteur`, `Contrat`, `Type`, `Canal`, `Télétravail`) doivent exister dans le schéma de la base. `NormalizedOffer["source"]` et `SECTOR_KEYWORDS[].sector` sont donc alignés sur les options du tracker : ajouter un secteur au moteur suppose d'ajouter l'option correspondante dans Notion.
- `getExistingIndex` **lève** si la lecture Notion échoue : on abandonne le run plutôt que d'insérer à l'aveugle. Ne pas transformer cette erreur en avertissement.
- Aucune propriété nouvelle ne doit être écrite dans Notion sans l'avoir créée d'abord dans le schéma de la base : l'API rejette la page entière sinon. Enrichir une propriété existante (`Salaire`) est le contournement retenu.
- Une information **absente** (contrat, date de publication, rythme, durée d'un CDD public) reçoit une valeur neutre, jamais zéro et jamais un rejet : sinon une source entière (cartes Indeed) passe sous le seuil pour un défaut de format. Les cartes Indeed ne disent presque jamais si le dimanche est travaillé : exiger la preuve fermerait la collecte.
- **Une contrainte matérielle est un rejet ferme, pas un malus.** Dimanche travaillé, temps partiel, horaires coupés, CDD hors exception, encadrement hors commerce, véhicule personnel exigé. Raison technique en plus de la raison métier : le score sature à 100, donc un malus est absorbé dès que l'offre est par ailleurs bien notée.
- **`rejectReason` (score.ts) est le point d'entrée unique des rejets fermes.** `scoreOffer` l'appelle, `select-web.ts` s'en sert pour compter les motifs. Un nouveau rejet s'ajoute là, avec un libellé lisible : il apparaît tel quel dans le rapport de la tâche planifiée.
- Les regex qui isolent un mot accentué utilisent le helper `words()` de `config.ts`, pas `\b` : en JavaScript, `\b` est ASCII (« café » a une fin de mot après « caf », « université » n'en a pas après « é »).
- **Le budget quotidien du tri IA est la somme des deux collecteurs** : `MAX_INSERT` du workflow (30) plus `WEB_CAP` de la passe navigateur (20), soit 50. Modifier l'un de ces nombres sans mettre à jour le plafond du prompt de tri crée un arriéré silencieux d'offres jamais analysées.
- Les deux tâches planifiées (passe navigateur, tri IA) portent leurs prompts côté Claude, pas dans le dépôt. Un changement de critère ici doit être répercuté là-bas, sinon la collecte et le tri appliquent deux grilles différentes.

## Où modifier quoi

| Besoin | Fichier |
| --- | --- |
| Barèmes, seuils, requêtes, secteurs, SMIC, conditions | `src/config.ts` |
| Zone géographique (communes retenues / écartées, codes postaux), base Notion, poids des contrats | `src/cities.ts` |
| Lecture des libellés de salaire | `src/salary.ts` |
| Rejets fermes (`rejectReason`), nature d'employeur, calcul du score | `src/score.ts` |
| Sélection, dédup, seuil, plafond | `src/pipeline.ts` |
| Plafond et seuil propres à la passe navigateur | `src/select-web.ts` |
| Requêtes et plafonds de détail par site (passe navigateur) | `browser/sources.json` |
| Sélecteurs d'un site qui a changé | `browser/<source>.js` (tester en collant `npm run browser-script -- <source>` dans l'onglet) |

## Vérification obligatoire

```bash
npm run typecheck   # tsc --noEmit
npm run selftest    # scoring, salaires, dédup, pipeline — hors ligne
```

`selftest.ts` distingue trois attendus : `drop` (rejet ferme du scoring), `below` (scorée mais sous le seuil, donc jamais insérée) et `keep`. Les rejets fermes de compétence et de mobilité sont testés à part, avec leur contre-exemple (« responsable » en description seule ne doit pas écarter). Toute modification de barème doit être accompagnée du cas de test correspondant, avec un commentaire disant **pourquoi** ce comportement est voulu.

Pour juger l'effet réel d'un changement de scoring ou de seuil, rejouer un lot déjà collecté plutôt que raisonner sur les seuls tests synthétiques :

```bash
npm run select-web   # rejoue data/web-raw.json contre data/notion-existing.json
```

Dernier rejeu de référence (lot du 21/11/2026, 36 offres brutes : 25 Indeed, 11 WTTJ, collectées avec les critères d'octobre), rejoué avec les critères de novembre : 19 conservées après rejets fermes (7 CDD privés, 6 trop anciennes, 4 domaines exclus), 8 sous le seuil, 11 retenues. Un rejeu qui s'écarte beaucoup de ces ordres de grandeur signale une régression, pas un hasard. Ce lot ne contient ni commerce ni public : le premier lot collecté avec les nouvelles requêtes deviendra la référence.

## Style attendu

Commentaires qui expliquent le **compromis** (pourquoi ce choix plutôt qu'un autre), pas la paraphrase du code. Les décisions structurantes sont documentées dans la section « Choix techniques » du README : la mettre à jour quand l'une d'elles change.
