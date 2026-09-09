# Passe web — 7 août 2026 (WTTJ + Indeed)

## Chiffres

| Source | Collectées | Retenues après filtres | Insérées Notion |
|---|---|---|---|
| Welcome to the Jungle | 108 (6 pages SEO) | 45 | 4 |
| Indeed | 87 (7 requêtes) | 30 | 19 |
| **Total** | **195** | **71 → 50 scorées** | **23** |

Pipeline : `run-select-web.ts` (scoring `src/score.ts` + dédup floue `src/dedup.ts`, `CITIES.lyon`, seuil 70).
18 doublons écartés contre l'existant Notion (576 lignes), 9 sous le seuil ou hors critères.

## Top 5

1. **94** — Conseiller de vente Bâti (F/H) — Castorama France, Bron, CDI (WTTJ)
2. **94** — Conseiller de vente Aménagement (F/H) — Castorama France, Bron, CDI (WTTJ)
3. **94** — Vendeur Service / Découpe bois & verre (F/H) — Castorama France, Bron, CDI (WTTJ)
4. **82** — Employé commercial secteur liquides (H/F) — Groupement Mousquetaires, Chassieu, CDI (WTTJ)
5. **80** — Téléconseiller Vacances H/F — PRO BTP Groupe, Lyon, CDD (Indeed) — *call center, correspond à l'expérience de Lucas*

## Problèmes et points d'attention

**Aucune offre dev retenue aujourd'hui.** Deux causes distinctes :

- Côté WTTJ, les 11 offres dev collectées ont toutes une date de publication antérieure au 24/07 et sautent sur `FILTERS.maxDaysOld = 14` (PRIMX, Steamulo, Diot Siaci, HelloCSE, Indy, NEXTON). Les récentes (Dougs ×3, OVHcloud, Galadrim) étaient déjà en base.
- Côté Indeed, les 4 offres dev de la semaine (Lowit, Réseau Services Sociaux, EXO-DEV, DATASOLUTION) étaient déjà insérées lors d'un run précédent.

**Extracteur WTTJ corrigé.** Le parsing basé sur `innerText` ne fonctionne que sur le document vivant : sur les documents issus de `DOMParser`, `innerText` renvoie vide, et 88 des 108 offres sortaient sans lieu ni contrat. Réécrit sur les nœuds feuilles (`textContent`, exclusion des `<p>` d'accroche). L'extracteur Indeed (`.job_seen_beacon`) fonctionne sans modification.

**Quota Notion atteint.** L'outil `query_data_sources` a coupé au 5ᵉ appel (limite d'usage du plan). Le rafraîchissement de `data/notion-existing.json` couvre donc les intitulés commençant par A–U (472 lignes sur 576) ; la tranche V+ (≈104 lignes, majoritairement « Vendeur… ») repose sur l'instantané du 4 août. Risque résiduel de doublon sur un poste « Vendeur » publié entre le 5 et le 7 août.

**Aucun CAPTCHA ni blocage Indeed** sur les 7 requêtes (rythme ~1,8 s).

**Écarts manuels appliqués** (non couverts par le pipeline) :

- 4 offres Adidas « Villefontaine » affichées sous le lieu « Lyon » sur WTTJ, en réalité en Isère → hors zone.
- Septeo ×2, EDF, Galis : postes commerciaux B2B / chef de projet, hors critères §3.
- Konecranes et « Développeur d'affaires EnR » : intitulés trompeurs (affaires ≠ développement web / manutention).

**Artefact de scoring contourné.** `FILTERS.alimentaireExclude` contient « btp », ce qui rejetait à tort le poste de téléconseiller chez *PRO BTP Groupe*. La `description` transmise au scorer a été construite à partir du titre + lieu + attributs, sans le nom d'entreprise, pour éviter ce type de faux positif.

## Fichiers

- `data/web-raw.json` — 71 offres brutes normalisées
- `data/web-selected.json` — 23 offres retenues
- `data/notion-existing.json` — 389 lignes (rafraîchi partiellement, cf. ci-dessus)
