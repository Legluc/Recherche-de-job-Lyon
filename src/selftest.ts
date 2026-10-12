/**
 * Tests hors-ligne du scoring, du filtrage, de la déduplication et de la lecture
 * des salaires (aucun réseau requis).
 * Lancer avec : npm run selftest
 */
import { scoreOffer } from "./score";
import { LIMITS, SMIC } from "./config";
import { CITIES } from "./cities";
import { DedupIndex, type OfferLike } from "./dedup";
import { parseSalary } from "./salary";
import { selectOffers } from "./pipeline";
import type { NormalizedOffer, ScoredOffer } from "./types";

const now = new Date().toISOString();
const base = { source: "Adzuna", type: "Alimentaire", url: "u", createdAt: now, description: "" } as const;

let pass = 0;
let fail = 0;
function check(ok: boolean, note: string, detail = ""): void {
  if (ok) pass++;
  else {
    fail++;
    console.error(`FAIL: ${note}${detail ? ` (${detail})` : ""}`);
  }
}

// --- 1. Scoring / filtrage -------------------------------------------------

/**
 * "keep"  : retenue par le scoring et au-dessus du seuil de sélection.
 * "below" : retenue par le scoring mais sous le seuil -> jamais insérée (le seuil
 *           est appliqué par le pipeline, pas par scoreOffer).
 * "drop"  : rejet ferme du scoring (zone, exclusions, conditions, contrat).
 */
const cases: Array<{
  o: NormalizedOffer;
  expect: "keep" | "below" | "drop";
  note: string;
  test?: (s: ScoredOffer) => boolean;
}> = [
  // --- Rejets fermes ---
  {
    o: { ...base, ref: "a:1", title: "Serveur en restauration", company: "Z", location: "Lyon", description: "service du soir" },
    expect: "drop", note: "restauration/serveur -> exclusion"
  },
  {
    o: { ...base, ref: "a:2", title: "Préparateur de commandes", company: "V", location: "Marseille", description: "entrepôt" },
    expect: "drop", note: "hors zone (Marseille) -> écarté"
  },
  {
    o: { ...base, ref: "a:3", title: "Agent de production de nuit", company: "U", location: "Bron", description: "équipe de nuit 3x8" },
    expect: "drop", note: "travail de nuit -> exclusion"
  },
  {
    o: { ...base, ref: "a:4", title: "Alternance – Assistant administratif", company: "T", location: "Lyon", description: "contrat d'apprentissage" },
    expect: "drop", note: "alternance dans le titre -> rejet ferme"
  },
  {
    o: { ...base, ref: "a:5", title: "Hôte de caisse", company: "W", location: "Lyon", contract: "CDI", description: "travail le samedi et le dimanche par roulement", salary: "Mensuel de 2200.0 Euros sur 12 mois" },
    expect: "drop", note: "travail de week-end annoncé -> rejet ferme, même avec un bon salaire"
  },
  {
    o: { ...base, ref: "a:6", title: "Employé administratif", company: "W", location: "Lyon", contract: "CDI", description: "amplitude du lundi au samedi", salary: "Mensuel de 2400.0 Euros sur 12 mois" },
    expect: "drop", note: "« du lundi au samedi » -> rejet ferme"
  },
  {
    o: { ...base, ref: "a:7", title: "Assistant administratif", company: "W", location: "Bron", contract: "CDI", description: "poste à temps partiel, 24h/semaine", salary: "Mensuel de 1200.0 Euros sur 12 mois" },
    expect: "drop", note: "temps partiel annoncé -> rejet ferme"
  },
  {
    // Un ancien lot collecté peut encore porter des offres marquées "Dev".
    o: { ...base, ref: "a:8", type: "Dev", title: "Développeur web junior", company: "S", location: "Lyon", contract: "CDI", description: "Vue.js, WordPress, PHP" } as unknown as NormalizedOffer,
    expect: "drop", note: "profil Dev résiduel -> écarté (profil abandonné)"
  },

  // --- Conditions et conservation des offres muettes ---
  {
    o: { ...base, ref: "b:1", title: "Conseiller clientèle", company: "W", location: "Villeurbanne", contract: "CDD", description: "relation client, du lundi au vendredi", salary: "Mensuel de 2300.0 Euros sur 12 mois" },
    expect: "keep", note: "week-ends libres prouvés + salaire > SMIC +15 %",
    test: (s) => s.sector === "Call center" && s.rhythm === "Week-ends libres" && s.monthlyGross === 2300
  },
  {
    o: { ...base, ref: "b:2", title: "Gestionnaire back office", company: "W", location: "Lyon", contract: "CDI", description: "week-ends non travaillés, gestion de dossiers", salary: "Mensuel de 2000.0 Euros sur 12 mois" },
    expect: "keep", note: "« week-ends non travaillés » n'est pas pris pour du travail de week-end",
    test: (s) => s.rhythm === "Week-ends libres" && s.sector === "Back-office / ADV"
  },
  {
    o: { ...base, ref: "b:3", title: "Assistant administratif", company: "W", location: "Lyon", contract: "CDI", description: "saisie et suivi de dossiers", salary: "Mensuel de 2100.0 Euros sur 12 mois" },
    expect: "keep", note: "offre muette sur le rythme -> conservée, sans bonus",
    test: (s) => s.rhythm === "Non précisé"
  },
  {
    o: { ...base, ref: "b:4", title: "Technicien support informatique N1", company: "W", location: "Lyon", contract: "CDI", description: "helpdesk, du lundi au vendredi", salary: "Annuel de 27000.0 Euros sur 12 mois" },
    expect: "keep", note: "support informatique = secteur le mieux noté",
    test: (s) => s.sector === "Support informatique" && s.score >= 95
  },
  {
    o: { ...base, ref: "b:5", title: "Conseiller clientèle", company: "W", location: "Lyon", contract: "CDI", description: "relation client, horaires de bureau", salary: "selon profil" },
    expect: "keep", note: "salaire non chiffré -> neutre, l'offre reste jugeable",
    test: (s) => s.monthlyGross === undefined
  },
  {
    o: { ...base, ref: "b:6", title: "Préparateur de commandes", company: "W", location: "Corbas", contract: "CDD", description: "entrepôt logistique", salary: "Horaire de 11.90 Euros sur 12 mois" },
    expect: "below", note: "sous le SMIC + aucun autre atout -> sous le seuil"
  },
  {
    o: { ...base, ref: "b:7", title: "Agent de tri", company: "W", location: "Saint-Priest", contract: "CDD", createdAt: new Date(Date.now() - 9 * 86400000).toISOString(), description: "tri de colis" },
    expect: "below", note: "offre tiède, sans salaire ni rythme -> filtrée par le seuil"
  },
  {
    // Salaire volontairement proche du SMIC : au-dessus, les deux variantes
    // saturent à 100 et le malus devient invisible (cf. « Limites » du README).
    o: { ...base, ref: "b:8", title: "Conseiller commercial sédentaire", company: "W", location: "Lyon", contract: "CDI", description: "télévente au siège, b2b, du lundi au vendredi", salary: "Mensuel de 1900.0 Euros sur 12 mois" },
    expect: "keep", note: "commercial B2B sédentaire -> malus appliqué mais offre conservée",
    test: (s) => {
      const sansB2B = scoreOffer(
        { ...base, ref: "cmp-b2b", title: "Conseiller commercial sédentaire", company: "W", location: "Lyon", contract: "CDI", description: "télévente au siège, du lundi au vendredi", salary: "Mensuel de 1900.0 Euros sur 12 mois" },
        CITIES.lyon
      );
      return sansB2B !== null && s.score < sansB2B.score;
    }
  }
];

// Rejets fermes de compétence et de mobilité : testés à part, car ils doivent
// écarter l'offre même lorsque tout le reste est excellent (un malus était absorbé
// par le plafond de 100).
const hardRejects: Array<{ o: NormalizedOffer; note: string }> = [
  {
    o: { ...base, ref: "c:1", title: "Responsable administratif", company: "W", location: "Lyon", contract: "CDI", description: "encadrement d'une équipe de 5 personnes, du lundi au vendredi", salary: "Mensuel de 2600.0 Euros sur 12 mois" },
    note: "encadrement dans l'intitulé -> rejet ferme malgré d'excellentes conditions"
  },
  {
    o: { ...base, ref: "c:2", title: "Chargé de clientèle", company: "W", location: "Lyon", contract: "CDI", description: "tournée clients, véhicule personnel obligatoire, du lundi au vendredi", salary: "Mensuel de 2400.0 Euros sur 12 mois" },
    note: "véhicule personnel exigé -> rejet ferme (pas de voiture)"
  },
  {
    o: { ...base, ref: "c:3", title: "Assistant administratif", company: "W", location: "Lyon", contract: "CDI", description: "en lien avec le responsable de service, du lundi au vendredi", salary: "Mensuel de 2200.0 Euros sur 12 mois" },
    note: "CONTRE-EXEMPLE : « responsable » en description seule ne doit PAS écarter"
  }
]
;

for (const c of cases) {
  const s = scoreOffer(c.o, CITIES.lyon);
  const got: "keep" | "below" | "drop" = !s ? "drop" : s.score >= LIMITS.minScore ? "keep" : "below";
  const ok = got === c.expect && (!c.test || (s !== null && c.test(s)));
  check(ok, c.note, `attendu ${c.expect}, obtenu ${got}${s ? ` score=${s.score} secteur=${s.sector}` : ""}`);
}

check(scoreOffer(hardRejects[0].o, CITIES.lyon) === null, hardRejects[0].note);
check(scoreOffer(hardRejects[1].o, CITIES.lyon) === null, hardRejects[1].note);
check(scoreOffer(hardRejects[2].o, CITIES.lyon) !== null, hardRejects[2].note);

// --- 2. Lecture des salaires ----------------------------------------------

const salaryCases: Array<{ raw: string; monthly: number | null; note: string }> = [
  { raw: "Mensuel de 1900.0 Euros à 2100.0 Euros sur 12 mois", monthly: 1900, note: "FT mensuel, fourchette -> borne basse" },
  { raw: "Horaire de 12.85 Euros sur 12 mois", monthly: Math.round(12.85 * 151.67), note: "FT horaire -> mensualisé 151,67 h" },
  { raw: "Annuel de 26000.0 Euros sur 13 mois", monthly: 2000, note: "FT annuel sur 13 mois -> mensuel réel" },
  { raw: "1900–2200 €/an", monthly: null, note: "montant annuel implausible -> non exploité" },
  { raw: "30000–34000 €/an", monthly: 2500, note: "Adzuna annuel -> borne basse mensualisée" },
  { raw: "entre 2 000 et 2 300 € brut mensuel", monthly: 2000, note: "texte libre avec espace des milliers" },
  { raw: "32k€ annuel", monthly: Math.round(32000 / 12), note: "notation k€" },
  { raw: "1 600 € net par mois", monthly: Math.round(1600 * 1.27), note: "net converti en brut approximatif" },
  { raw: "Salaire selon profil", monthly: null, note: "aucun montant -> null" },
  { raw: "Horaire de 12.31 Euros sur 12 mois, 35h hebdomadaires", monthly: Math.round(12.31 * 151.67), note: "les 35 h ne sont pas prises pour un montant" }
];

for (const c of salaryCases) {
  const p = parseSalary(c.raw);
  const got = p ? p.monthlyGross : null;
  check(got === c.monthly, `salaire : ${c.note}`, `attendu ${c.monthly}, obtenu ${got} pour "${c.raw}"`);
}

// Le SMIC horaire converti doit retomber sur le SMIC mensuel (tolérance d'arrondi).
const smicParsed = parseSalary(`Horaire de ${SMIC.hourlyGross} Euros`);
check(
  smicParsed !== null && Math.abs(smicParsed.monthlyGross - SMIC.monthlyGross35h) < 5,
  "salaire : SMIC horaire -> SMIC mensuel (cohérence des constantes)",
  `obtenu ${smicParsed?.monthlyGross} vs ${SMIC.monthlyGross35h}`
);

// --- 3. Déduplication floue (cas réels observés lors des collectes) --------

const dedupCases: Array<{ note: string; a: OfferLike; b: OfferLike; expectDup: boolean }> = [
  {
    note: "même annonce, deux IDs, libellés de lieu différents",
    a: { title: "Gestionnaire de dossiers H/F", company: "Groupe Martin Belaysoud", location: "Lyon, Rhône" },
    b: { title: "Gestionnaire de dossiers (F/H)", company: "Groupe Martin Belaysoud", location: "1er-Arrondissement, Lyon" },
    expectDup: true
  },
  {
    note: "même annonce republiée par deux intermédiaires",
    a: { title: "ASSISTANT ADMINISTRATIF (F/H)", company: "Direct Emploi", location: "Jonage, Lyon" },
    b: { title: "Assistant administratif F/H", company: "Randstad professional", location: "Jonage" },
    expectDup: true
  },
  {
    note: "titre générique, employeurs directs distincts -> pas un doublon",
    a: { title: "Préparateur de commandes", company: "Carrefour", location: "Vénissieux" },
    b: { title: "Préparateur de commandes", company: "Intermarché", location: "Vénissieux" },
    expectDup: false
  },
  {
    note: "même enseigne, communes différentes -> pas un doublon",
    a: { title: "Agent administratif", company: "Enedis", location: "Meyzieu, Lyon" },
    b: { title: "Agent administratif", company: "Enedis", location: "Beynost (Ain)" },
    expectDup: false
  }
];

for (const c of dedupCases) {
  const idx = new DedupIndex(CITIES.lyon);
  idx.add(c.a);
  check(idx.isDuplicate(c.b) === c.expectDup, `dédup : ${c.note}`);
}

// --- 4. Pipeline : seuil, plafond, tri ------------------------------------

const flood: NormalizedOffer[] = [];
for (let i = 0; i < 12; i++) {
  flood.push({
    ...base, ref: `flood:${i}`,
    title: `Conseiller clientèle ${i}`, company: `Entreprise ${i}`, location: "Lyon",
    contract: "CDI", description: "relation client, du lundi au vendredi",
    salary: "Mensuel de 2400.0 Euros sur 12 mois"
  });
}
// Une offre sous le seuil ne doit pas consommer un slot du plafond.
flood.push({
  ...base, ref: "flood:faible", title: "Agent de tri", company: "Tri Express", location: "Saint-Priest",
  createdAt: new Date(Date.now() - 9 * 86400000).toISOString(), description: "tri de colis"
});

const emptyIndex = { refs: new Set<string>(), offers: [] };
const run = selectOffers(flood, CITIES.lyon, emptyIndex, 5);
check(run.selected.length === 5, "pipeline : plafond d'insertion respecté", `obtenu ${run.selected.length}`);
check(
  run.selected.every((o) => o.score >= LIMITS.minScore),
  "pipeline : aucune offre sous le seuil n'est retenue"
);
check(
  run.selected.every((o, i, arr) => i === 0 || arr[i - 1].score >= o.score),
  "pipeline : sélection triée par score décroissant"
);
// Seuil surchargeable par la passe navigateur (cf. select-web.ts).
const strict = selectOffers(flood, CITIES.lyon, emptyIndex, 5, 101);
check(strict.selected.length === 0, "pipeline : seuil surchargé pris en compte");

console.log(`selftest: ${pass} OK, ${fail} KO`);
process.exit(fail ? 1 : 0);
