/**
 * Test hors-ligne du scoring/filtrage (aucun réseau requis).
 * Lancer avec : npm run selftest
 */
import { scoreOffer } from "./score";
import { LIMITS } from "./config";
import { CITIES } from "./cities";
import { DedupIndex, type OfferLike } from "./dedup";
import type { NormalizedOffer } from "./types";

const now = new Date().toISOString();
const base = { source: "Adzuna", url: "u", createdAt: now, description: "" } as const;

const cases: Array<{ o: NormalizedOffer; expect: "keep" | "drop"; note: string; check?: (s: any) => boolean; city?: typeof CITIES[string] }> = [
  {
    o: { ...base, ref: "adzuna:1", type: "Dev", title: "Intégrateur web H/F", company: "X", location: "Lyon", contract: "CDI", description: "Vue.js Tailwind WordPress" },
    expect: "keep", note: "intégrateur web Lyon + stack -> score élevé", check: (s) => s.score >= 80 && s.sector === "Dév web"
  },
  {
    o: { ...base, ref: "adzuna:2", type: "Dev", title: "Responsable Communication", company: "Y", location: "Lyon", description: "communication institutionnelle" },
    expect: "drop", note: "hors dev -> écarté"
  },
  {
    o: { ...base, ref: "adzuna:3", type: "Alimentaire", title: "Serveur en restauration", company: "Z", location: "Lyon", description: "service du soir" },
    expect: "drop", note: "restauration/serveur -> exclusion"
  },
  {
    o: { ...base, ref: "adzuna:4", type: "Alimentaire", title: "Conseiller clientèle", company: "W", location: "Villeurbanne", contract: "CDD", description: "relation client" },
    expect: "keep", note: "conseiller clientèle -> Call center", check: (s) => s.sector === "Call center"
  },
  {
    o: { ...base, ref: "adzuna:5", type: "Alimentaire", title: "Préparateur de commandes", company: "V", location: "Marseille", description: "entrepôt" },
    expect: "drop", note: "hors zone (Marseille) -> écarté"
  },
  {
    o: { ...base, ref: "adzuna:6", type: "Alimentaire", title: "Agent de production de nuit", company: "U", location: "Bron", description: "équipe de nuit 3x8" },
    expect: "drop", note: "travail de nuit -> exclusion"
  },
  {
    // Cas réel : Adzuna ne type pas le contrat, seul le titre annonce l'alternance.
    o: { ...base, ref: "adzuna:7", type: "Dev", title: "Alternance – Développeur Web & Mobile", company: "T", location: "Lyon", description: "contrat d'apprentissage, React" },
    expect: "drop", note: "alternance dans le titre -> rejet ferme"
  },
  {
    // Le mot n'apparaît que dans la description : on garde, avec malus.
    o: { ...base, ref: "adzuna:9", type: "Dev", title: "Développeur Web H/F", company: "R", location: "Lyon", contract: "CDI", description: "Vue.js ; alternance possible" },
    expect: "keep", note: "alternance en description seule -> conservé avec malus",
    check: (s) => s.score >= LIMITS.minScore
  },
  {
    o: { ...base, ref: "adzuna:8", type: "Dev", title: "Développeur web junior", company: "S", location: "Lyon", contract: "CDI", description: "Vue.js, WordPress, PHP" },
    expect: "keep", note: "CDI junior avec stack -> au-dessus du seuil",
    check: (s) => s.score >= LIMITS.minScore
  },

  // --- Annecy (alimentaire seulement, CDD privilégié sur CDI) ---
  {
    o: { ...base, ref: "adzuna:10", type: "Alimentaire", title: "Préparateur de commandes", company: "Q", location: "Annecy", contract: "CDD", description: "entrepôt" },
    city: CITIES.annecy, expect: "keep", note: "Annecy : CDD alimentaire retenu",
    check: (s) => s.score >= LIMITS.minScore
  },
  {
    o: { ...base, ref: "adzuna:11", type: "Alimentaire", title: "Préparateur de commandes", company: "P", location: "Annecy", contract: "CDI", description: "entrepôt" },
    city: CITIES.annecy, expect: "keep", note: "Annecy : CDD mieux noté que CDI",
    // Comparaison directe avec le CDD équivalent : le test reste valable si les
    // pondérations changent.
    check: (s) => {
      const cdd = scoreOffer(
        { ...base, ref: "cmp", type: "Alimentaire", title: "Préparateur de commandes", company: "P", location: "Annecy", contract: "CDD", description: "entrepôt" },
        CITIES.annecy
      );
      return cdd !== null && s.score < cdd.score;
    }
  },
  {
    o: { ...base, ref: "adzuna:12", type: "Alimentaire", title: "Vendeur en boulangerie", company: "O", location: "Chambéry", contract: "CDD", description: "vente" },
    city: CITIES.annecy, expect: "drop", note: "Annecy : hors zone (Chambéry) -> écarté"
  },
  {
    o: { ...base, ref: "adzuna:13", type: "Alimentaire", title: "Employé libre service", company: "N", location: "Poisy", contract: "CDD", description: "rayon" },
    city: CITIES.annecy, expect: "keep", note: "Annecy : couronne bus (Poisy) -> retenu"
  }
];

// --- Tests de déduplication floue (cas réels observés lors des collectes) ---
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

let dedupPass = 0;
let dedupFail = 0;
for (const c of dedupCases) {
  const idx = new DedupIndex(CITIES.lyon);
  idx.add(c.a);
  const got = idx.isDuplicate(c.b);
  if (got === c.expectDup) dedupPass++;
  else {
    dedupFail++;
    console.error(`FAIL (dédup): ${c.note} (attendu ${c.expectDup}, obtenu ${got})`);
  }
}

let pass = dedupPass;
let fail = dedupFail;
for (const c of cases) {
  const s = scoreOffer(c.o, c.city ?? CITIES.lyon);
  const got: "keep" | "drop" = s ? "keep" : "drop";
  const ok = got === c.expect && (!c.check || (s !== null && c.check(s)));
  if (ok) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${c.note} (attendu ${c.expect}, obtenu ${got}${s ? ` score=${s.score} secteur=${s.sector}` : ""})`);
  }
}
console.log(`selftest: ${pass} OK, ${fail} KO`);
process.exit(fail ? 1 : 0);
