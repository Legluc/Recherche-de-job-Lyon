# CLAUDE.md — job-hunter-lyon

Contexte à charger avant toute intervention sur ce dépôt.

## Objet

Moteur de collecte d'offres d'emploi (France Travail + Adzuna, plus une passe navigateur pour Indeed/WTTJ) vers une base Notion. Deux profils : **Dev** (l'objectif) et **Alimentaire** (financer l'installation à Lyon). Une passe de tri IA reprend ensuite les offres insérées en statut « À traiter » : le moteur privilégie donc le rappel sur la précision côté intitulés, et la sévérité sur les **conditions** (salaire, rythme, contrat).

Ville unique : **Lyon**. La piste Annecy a été retirée du moteur (poste trouvé sur place) ; ne pas la réintroduire.

## Stack et contraintes

- TypeScript strict, Node ≥ 20, ESM, **zéro dépendance runtime** (`fetch` natif). `tsx` en dev uniquement. Toute proposition de dépendance runtime doit être justifiée.
- Exécution sur GitHub Actions (cron du soir en semaine) : pas de serveur, pas d'état local. La source de vérité de la déduplication est la base Notion elle-même.
- Commentaires et messages de log **en français**.

## Invariants à ne pas casser

- `pipeline.ts` est le **seul** chemin de sélection : le run automatique (`main.ts`) et l'ingestion navigateur (`ingest-file.ts`) l'utilisent tous les deux. Ne jamais dupliquer la logique de scoring dans un script ad hoc destiné à durer.
- `getExistingIndex` **lève** si la lecture Notion échoue : on abandonne le run plutôt que d'insérer à l'aveugle. Ne pas transformer cette erreur en avertissement.
- Aucune propriété nouvelle ne doit être écrite dans Notion sans l'avoir créée d'abord dans le schéma de la base : l'API rejette la page entière sinon. Enrichir une propriété existante (`Salaire`) est le contournement retenu.
- Une information **absente** (contrat, date de publication) reçoit une valeur neutre, jamais zéro : sinon une source entière (WTTJ, cartes Indeed) passe sous le seuil pour un défaut de format.
- Le plafond d'insertion est réparti par profil (`INSERT_SHARE`) : le vivier alimentaire ne doit pas noyer les offres dev.

## Où modifier quoi

| Besoin | Fichier |
| --- | --- |
| Barèmes, seuils, requêtes, secteurs, SMIC | `src/config.ts` |
| Zone géographique, base Notion, poids des contrats | `src/cities.ts` |
| Lecture des libellés de salaire | `src/salary.ts` |
| Règles de filtrage et de score | `src/score.ts` |
| Sélection, quotas, dédup | `src/pipeline.ts` |

## Vérification obligatoire

```bash
npm run typecheck   # tsc --noEmit
npm run selftest    # scoring, salaires, dédup, quotas — hors ligne
```

`selftest.ts` distingue trois attendus : `drop` (rejet ferme du scoring), `below` (scorée mais sous le seuil du profil, donc jamais insérée) et `keep`. Toute modification de barème doit être accompagnée du cas de test correspondant, avec un commentaire disant **pourquoi** ce comportement est voulu.

Pour juger l'effet réel d'un changement de scoring, rejouer un lot déjà collecté (`data/web-raw.json`) plutôt que raisonner sur les seuls tests synthétiques.

## Style attendu

Commentaires qui expliquent le **compromis** (pourquoi ce choix plutôt qu'un autre), pas la paraphrase du code. Les décisions structurantes sont documentées dans la section « Choix techniques » du README : la mettre à jour quand l'une d'elles change.
