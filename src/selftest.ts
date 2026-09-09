/**
 * Tests hors-ligne du scoring, du filtrage, de la déduplication, de la lecture
 * des salaires et des quotas d'insertion (aucun réseau requis).
 * Lancer avec : npm run selftest
 */
import { scoreOffer } from "./score";
import { LIMITS, MIN_SCORE_BY_TYPE, SMIC } from "./config";
import { CITIES } from "./cities";
import { DedupIndex, type OfferLike } from "./dedup";
import { parseSalary } from "./salary";
import { selectOffers } from "./pipeline";
import type { NormalizedOffer, ScoredOffer } from "./types";

const now = new Date().toISOString();
const base = { source: "Adzuna", url: "u", createdAt: now, description: "" } as const;

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
 * "keep"  : retenue par le scoring et au-dessus du seuil de son profil.
 * "below" : retenue par le scoring mais sous le seuil -> jamais insérée (le seuil
 *           est appliqué par le pipeline, pas par scoreOffer).
 * "drop"  : rejet ferme du scoring (zone, exclusions, contrat non souhaité).
 */
const cases: Array<{
  o: NormalizedOffer;
  expect: "keep" | "below" | "drop";
  note: string;
  test?: (s: ScoredOffer) => boolean;
}> = [
  {
    o: { ...base, ref: "a:1", type: "Dev", title: "Intégrateur web H/F", company: "X", location: "Lyon", contract: "CDI", description: "Vue.js Tailwind WordPress" },
    expect: "keep", note: "intégrateur web Lyon + stack -> score élevé",
    test: (s) => s.score >= 80 && s.sector === "Dév web"
  },
  {
    o: { ...base, ref: "a:2", type: "Dev", title: "Responsable Communication", company: "Y", location: "Lyon", description: "communication institutionnelle" },
    expect: "drop", note: "hors dev -> écarté"
  },
  {
    o: { ...base, ref: "a:3", type: "Alimentaire", title: "Serveur en restauration", company: "Z", location: "Lyon", description: "service du soir" },
    expect: "drop", note: "restauration/serveur -> exclusion"
  },
  {
    o: { ...base, ref: "a:5", type: "Alimentaire", title: "Préparateur de commandes", company: "V", location: "Marseille", description: "entrepôt" },
    expect: "drop", note: "hors zone (Marseille) -> écarté"
  },
  {
    o: { ...base, ref: "a:6", type: "Alimentaire", title: "Agent de production de nuit", company: "U", location: "Bron", description: "équipe de nuit 3x8" },
    expect: "drop", note: "travail de nuit -> exclusion"
  },
  {
    o: { ...base, ref: "a:7", type: "Dev", title: "Alternance – Développeur Web & Mobile", company: "T", location: "Lyon", description: "contrat d'apprentissage, React" },
    expect: "drop", note: "alternance dans le titre -> rejet ferme"
  },
  {
    o: { ...base, ref: "a:7b", type: "Dev", title: "Web Developer Internship", company: "T", location: "Lyon", description: "React, 6 months" },
    expect: "drop", note: "internship (anglais) -> rejet ferme"
  },
  {
    o: { ...base, ref: "a:7c", type: "Dev", title: "Développeur web", company: "T", location: "Lyon", contract: "CDI", description: "équipe internationale, React, Vue" },
    expect: "keep", note: "\"internationale\" ne déclenche pas le filtre stage"
  },
  {
    o: { ...base, ref: "a:9", type: "Dev", title: "Développeur Web H/F", company: "R", location: "Lyon", contract: "CDI", description: "Vue.js ; alternance possible" },
    expect: "keep", note: "alternance en description seule -> conservé avec malus",
    test: (s) => s.score >= MIN_SCORE_BY_TYPE.Dev
  },
  {
    o: { ...base, ref: "a:8", type: "Dev", title: "Développeur web junior", company: "S", location: "Lyon", contract: "CDI", description: "Vue.js, WordPress, PHP" },
    expect: "keep", note: "CDI junior avec stack -> au-dessus du seuil",
    test: (s) => s.score >= MIN_SCORE_BY_TYPE.Dev
  },
  {
    o: { ...base, ref: "a:8b", type: "Dev", title: "Développeur Web Sénior (F/H)", company: "S", location: "Lyon", contract: "CDI", description: "Vue.js, PHP" },
    expect: "keep", note: "\"Sénior\" accentué -> malus séniorité appliqué",
    test: (s) => {
      const junior = scoreOffer(
        { ...base, ref: "cmp-jr", type: "Dev", title: "Développeur Web (F/H)", company: "S", location: "Lyon", contract: "CDI", description: "Vue.js, PHP" },
        CITIES.lyon
      );
      return junior !== null && s.score < junior.score;
    }
  },

  // --- Conditions alimentaires (salaire, rythme, temps partiel) ---
  {
    o: { ...base, ref: "a:20", type: "Alimentaire", title: "Conseiller clientèle", company: "W", location: "Villeurbanne", contract: "CDD", description: "relation client, du lundi au vendredi", salary: "Mensuel de 2300.0 Euros sur 12 mois" },
    expect: "keep", note: "salaire > SMIC +15 % + week-ends libres -> secteur et rythme détectés",
    test: (s) => s.sector === "Call center" && s.rhythm === "Week-ends libres" && s.monthlyGross === 2300
  },
  {
    o: { ...base, ref: "a:21", type: "Alimentaire", title: "Hôte de caisse", company: "W", location: "Lyon", contract: "CDI", description: "travail le samedi et le dimanche par roulement", salary: "Horaire de 12.31 Euros sur 12 mois" },
    expect: "below", note: "SMIC + week-end travaillé -> repasse sous le seuil alimentaire",
    test: (s) => {
      const better = scoreOffer(
        { ...base, ref: "cmp-we", type: "Alimentaire", title: "Hôte de caisse", company: "W", location: "Lyon", contract: "CDI", description: "du lundi au vendredi", salary: "Mensuel de 2200.0 Euros sur 12 mois" },
        CITIES.lyon
      );
      // L'écart réel est écrasé par le plafond à 100 : on vérifie qu'il reste net.
      return s.rhythm === "Week-end travaillé" && better !== null && better.score - s.score >= 20;
    }
  },
  {
    o: { ...base, ref: "a:22", type: "Alimentaire", title: "Employé polyvalent", company: "W", location: "Bron", contract: "CDI", description: "poste à temps partiel, 24h/semaine", salary: "Mensuel de 1200.0 Euros sur 12 mois" },
    expect: "below", note: "temps partiel sous le SMIC -> sous le seuil alimentaire",
    test: (s) => s.partTime === true
  },
  {
    o: { ...base, ref: "a:23", type: "Alimentaire", title: "Technicien support informatique N1", company: "W", location: "Lyon", contract: "CDI", description: "helpdesk, du lundi au vendredi", salary: "Annuel de 27000.0 Euros sur 12 mois" },
    expect: "keep", note: "support informatique = passerelle dev -> secteur dédié",
    test: (s) => s.sector === "Support informatique" && s.score >= 95
  },
  {
    o: { ...base, ref: "a:24", type: "Alimentaire", title: "Préparateur de commandes", company: "W", location: "Corbas", contract: "CDD", description: "entrepôt logistique", salary: "Horaire de 11.90 Euros sur 12 mois" },
    expect: "below", note: "sous le SMIC + aucun autre atout -> sous le seuil alimentaire"
  },
  {
    o: { ...base, ref: "a:25", type: "Alimentaire", title: "Gestionnaire back office", company: "W", location: "Lyon", contract: "CDI", description: "week-ends non travaillés, gestion de dossiers", salary: "Mensuel de 2000.0 Euros sur 12 mois" },
    expect: "keep", note: "« week-ends non travaillés » n'est plus éliminatoire (bug corrigé)",
    test: (s) => s.rhythm === "Week-ends libres"
  },
  {
    o: { ...base, ref: "a:26", type: "Alimentaire", title: "Assistant administratif", company: "W", location: "Lyon", contract: "CDI", description: "saisie et suivi de dossiers", salary: "selon profil" },
    expect: "keep", note: "salaire non chiffré -> neutre, l'offre reste jugeable",
    test: (s) => s.monthlyGross === undefined
  },
  {
    o: { ...base, ref: "a:27", type: "Alimentaire", title: "Agent de tri", company: "W", location: "Saint-Priest", contract: "CDD", createdAt: new Date(Date.now() - 9 * 86400000).toISOString(), description: "tri de colis" },
    expect: "below", note: "offre tiède, sans salaire ni rythme -> filtrée par le seuil relevé"
  }
];

for (const c of cases) {
  const s = scoreOffer(c.o, CITIES.lyon);
  const got: "keep" | "below" | "drop" = !s ? "drop" : s.score >= MIN_SCORE_BY_TYPE[c.o.type] ? "keep" : "below";
  const ok = got === c.expect && (!c.test || (s !== null && c.test(s)));
  check(ok, c.note, `attendu ${c.expect}, obtenu ${got}${s ? ` score=${s.score} secteur=${s.sector}` : ""}`);
}

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
    a: { title: "Développeur Web senior H/F", company: "Groupe Martin Belaysoud", location: "Lyon, Rhône" },
    b: { title: "Développeur WEB senior (F/H)", company: "Groupe Martin Belaysoud", location: "1er-Arrondissement, Lyon" },
    expectDup: true
  },
  {
    note: "même annonce republiée par deux intermédiaires",
    a: { title: "LEAD DÉVELOPPEUR WEB (F/H)", company: "Direct Emploi", location: "Jonage, Lyon" },
    b: { title: "Lead développeur web F/H", company: "Randstad professional", location: "Jonage" },
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
    a: { title: "Employé libre service", company: "E.Leclerc", location: "Meyzieu, Lyon" },
    b: { title: "Employé libre service", company: "E.Leclerc", location: "Beynost (Ain)" },
    expectDup: false
  }
];

for (const c of dedupCases) {
  const idx = new DedupIndex(CITIES.lyon);
  idx.add(c.a);
  check(idx.isDuplicate(c.b) === c.expectDup, `dédup : ${c.note}`);
}

// --- 4. Quotas d'insertion par profil -------------------------------------

const flood: NormalizedOffer[] = [];
for (let i = 0; i < 30; i++) {
  flood.push({
    ...base, ref: `flood-ali:${i}`, type: "Alimentaire",
    title: `Conseiller clientèle ${i}`, company: `Entreprise ${i}`, location: "Lyon",
    contract: "CDI", description: "relation client, du lundi au vendredi",
    salary: "Mensuel de 2400.0 Euros sur 12 mois"
  });
}
for (let i = 0; i < 4; i++) {
  flood.push({
    ...base, ref: `flood-dev:${i}`, type: "Dev",
    title: `Développeur web ${i}`, company: `Agence ${i}`, location: "Lyon",
    contract: "CDI", description: "Vue.js WordPress PHP"
  });
}
const emptyIndex = { refs: new Set<string>(), offers: [] };
const quotaRun = selectOffers(flood, CITIES.lyon, emptyIndex, 10);
check(
  quotaRun.byType.Dev === 4 && quotaRun.selected.length === 10,
  "quota : l'alimentaire ne noie pas les offres dev, et les slots libres sont réattribués",
  `dev=${quotaRun.byType.Dev} alimentaire=${quotaRun.byType.Alimentaire} total=${quotaRun.selected.length}`
);
check(
  quotaRun.selected.every((o, i, arr) => i === 0 || arr[i - 1].score >= o.score),
  "quota : la sélection finale reste triée par score décroissant"
);
check(LIMITS.minScore <= MIN_SCORE_BY_TYPE.Alimentaire, "seuil alimentaire au moins égal au seuil par défaut");

console.log(`selftest: ${pass} OK, ${fail} KO`);
process.exit(fail ? 1 : 0);
