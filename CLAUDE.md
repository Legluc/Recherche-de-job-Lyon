# CLAUDE.md — job-hunter-lyon

Contexte à charger avant toute intervention sur ce dépôt.

## Objet

Moteur de collecte d'offres d'emploi (France Travail + Adzuna, plus une passe navigateur pour Indeed/WTTJ) vers une base Notion. Une passe de tri IA reprend ensuite les offres insérées en statut « À traiter ».

**Cible unique : un emploi alimentaire à Lyon, week-ends libres, temps plein.** Le moteur privilégie le rappel sur les intitulés (secteurs jamais exercés inclus — l'IA trie en aval) et la sévérité sur les **conditions**.

Historique des cibles, à ne pas réintroduire sans décision explicite :

- Août 2026 : Lyon + Annecy, profils Dev et Alimentaire.
- Septembre 2026 : Annecy retirée (poste trouvé sur place).
- **Octobre 2026 : profil Dev abandonné.** Requêtes dev, regex `DEV_*`, branche de scoring dev et quotas par profil (`INSERT_SHARE`) supprimés. `JobType` ne vaut plus que `"Alimentaire"` ; le champ `type` subsiste dans le pivot pour **écarter** les offres `"Dev"` que portent encore d'anciens lots collectés.

## Stack et contraintes

- TypeScript strict, Node ≥ 20, ESM, **zéro dépendance runtime** (`fetch` natif). `tsx` en dev uniquement. Toute proposition de dépendance runtime doit être justifiée.
- Exécution sur GitHub Actions (cron du soir en semaine) : pas de serveur, pas d'état local. La source de vérité de la déduplication est la base Notion elle-même.
- Commentaires et messages de log **en français**.

## Invariants à ne pas casser

- `pipeline.ts` est le **seul** chemin de sélection : le run automatique (`main.ts`), l'ingestion navigateur (`ingest-file.ts`) et la sélection de la tâche planifiée (`select-web.ts`) l'utilisent tous les trois. Ne jamais dupliquer la logique de scoring dans un script ad hoc destiné à durer. Un script de sélection vit dans `src/` pour être couvert par `npm run typecheck` (`tsconfig.json` n'inclut que ce dossier) ; à la racine, il échapperait à la vérification.
- Les valeurs écrites dans une propriété `select` de Notion (`Source`, `Secteur`, `Contrat`, `Type`, `Canal`, `Télétravail`) doivent exister dans le schéma de la base. `NormalizedOffer["source"]` et `SECTOR_KEYWORDS[].sector` sont donc alignés sur les options du tracker : ajouter un secteur au moteur suppose d'ajouter l'option correspondante dans Notion.
- `getExistingIndex` **lève** si la lecture Notion échoue : on abandonne le run plutôt que d'insérer à l'aveugle. Ne pas transformer cette erreur en avertissement.
- Aucune propriété nouvelle ne doit être écrite dans Notion sans l'avoir créée d'abord dans le schéma de la base : l'API rejette la page entière sinon. Enrichir une propriété existante (`Salaire`) est le contournement retenu.
- Une information **absente** (contrat, date de publication, rythme) reçoit une valeur neutre, jamais zéro et jamais un rejet : sinon une source entière (WTTJ, cartes Indeed) passe sous le seuil pour un défaut de format. Les cartes Indeed ne disent presque jamais si le week-end est travaillé : exiger la preuve fermerait la collecte.
- **Une contrainte matérielle est un rejet ferme, pas un malus.** Week-end travaillé, temps partiel, encadrement dans l'intitulé, véhicule personnel exigé. Raison technique en plus de la raison métier : le score sature à 100, donc un malus est absorbé dès que l'offre est par ailleurs bien notée.
- **Le budget quotidien du tri IA est la somme des deux collecteurs** : `MAX_INSERT` du workflow (30) plus `WEB_CAP` de la passe navigateur (20), soit 50. Modifier l'un de ces nombres sans mettre à jour le plafond du prompt de tri crée un arriéré silencieux d'offres jamais analysées.
- Les deux tâches planifiées (passe navigateur, tri IA) portent leurs prompts côté Claude, pas dans le dépôt. Un changement de critère ici doit être répercuté là-bas, sinon la collecte et le tri appliquent deux grilles différentes.

## Où modifier quoi

| Besoin | Fichier |
| --- | --- |
| Barèmes, seuils, requêtes, secteurs, SMIC, conditions | `src/config.ts` |
| Zone géographique, base Notion, poids des contrats | `src/cities.ts` |
| Lecture des libellés de salaire | `src/salary.ts` |
| Rejets fermes et calcul du score | `src/score.ts` |
| Sélection, dédup, seuil, plafond | `src/pipeline.ts` |
| Plafond et seuil propres à la passe navigateur | `src/select-web.ts` |

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

Dernier rejeu de référence (lot du 10/09/2026, 104 offres brutes dont 58 marquées `Dev`) : 39 conservées après conditions, 19 notées, 11 au-dessus de 84, 10 retenues après dédup. Un rejeu qui s'écarte beaucoup de ces ordres de grandeur signale une régression, pas un hasard.

## Style attendu

Commentaires qui expliquent le **compromis** (pourquoi ce choix plutôt qu'un autre), pas la paraphrase du code. Les décisions structurantes sont documentées dans la section « Choix techniques » du README : la mettre à jour quand l'une d'elles change.
