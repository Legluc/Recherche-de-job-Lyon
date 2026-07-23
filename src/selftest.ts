/**
 * Test hors-ligne du scoring/filtrage (aucun réseau requis).
 * Lancer avec : npm run selftest
 */
import { scoreOffer } from "./score";
import type { NormalizedOffer } from "./types";

const now = new Date().toISOString();
const base = { source: "Adzuna", url: "u", createdAt: now, description: "" } as const;

const cases: Array<{ o: NormalizedOffer; expect: "keep" | "drop"; note: string; check?: (s: any) => boolean }> = [
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
  }
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const s = scoreOffer(c.o);
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
