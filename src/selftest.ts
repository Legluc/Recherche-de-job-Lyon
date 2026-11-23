/**
 * Tests hors-ligne du scoring, du filtrage, de la déduplication et de la lecture
 * des salaires (aucun réseau requis).
 * Lancer avec : npm run selftest
 */
import { scoreOffer, rejectReason, employerKindOf, contractMonths } from "./score";
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
    expect: "drop", note: "dimanche par roulement -> rejet ferme, même avec un bon salaire"
  },
  {
    // Novembre 2026 : le samedi est accepté, seul le dimanche bloque.
    o: { ...base, ref: "a:6", title: "Employé administratif", company: "W", location: "Lyon", contract: "CDI", description: "amplitude du lundi au samedi", salary: "Mensuel de 2400.0 Euros sur 12 mois" },
    expect: "keep", note: "« du lundi au samedi » -> conservée, repos dominical prouvé",
    test: (s) => s.rhythm === "Dimanche libre"
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
    o: { ...base, ref: "b:1", title: "Conseiller clientèle", company: "W", location: "Villeurbanne", contract: "CDI", description: "relation client, du lundi au vendredi", salary: "Mensuel de 2300.0 Euros sur 12 mois" },
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
    // Novembre 2026 : l'informatique est exclue sous toutes ses formes, support compris.
    o: { ...base, ref: "b:4", title: "Technicien support informatique N1", company: "W", location: "Lyon", contract: "CDI", description: "helpdesk, du lundi au vendredi", salary: "Annuel de 27000.0 Euros sur 12 mois" },
    expect: "drop", note: "support informatique -> domaine exclu, malgré d'excellentes conditions"
  },
  {
    o: { ...base, ref: "b:5", title: "Conseiller clientèle", company: "W", location: "Lyon", contract: "CDI", description: "relation client, horaires de bureau", salary: "selon profil" },
    expect: "keep", note: "salaire non chiffré -> neutre, l'offre reste jugeable",
    test: (s) => s.monthlyGross === undefined
  },
  {
    o: { ...base, ref: "b:6", title: "Employé libre service", company: "W", location: "Bron", description: "mise en rayon", salary: "Horaire de 11.90 Euros sur 12 mois" },
    expect: "below", note: "sous le SMIC + aucun autre atout -> sous le seuil"
  },
  {
    o: { ...base, ref: "b:7", title: "Employé commercial", company: "W", location: "Saint-Priest", createdAt: new Date(Date.now() - 9 * 86400000).toISOString(), description: "rayon épicerie" },
    expect: "below", note: "offre tiède, sans contrat, salaire ni rythme -> filtrée par le seuil"
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

// --- 1 bis. Critères de novembre 2026 --------------------------------------
//
// Entretien du 23/11/2026 : domaines bureau / public / associatif / commerce
// alimentaire / retail ; samedi accepté, dimanche libre exigé ; CDI exigé sauf
// CDD d'au moins 12 mois dans le public et l'associatif ; horaires coupés
// rejetés ; encadrement accepté pour une petite équipe en commerce ; informatique,
// logistique et propreté exclues. Chaque cas porte le motif attendu, pour qu'une
// régression dise QUELLE règle a bougé, pas seulement qu'un score a changé.

const ok = { ...base, location: "Lyon 3e", contract: "CDI" as const, salary: "Mensuel de 1950.0 Euros sur 12 mois" };
const nov: Array<{ o: NormalizedOffer; reason: string | null; note: string; test?: (s: ScoredOffer) => boolean }> = [
  // Rythme
  {
    o: { ...ok, ref: "n:1", title: "Vendeur en boulangerie", company: "Maison Pozzoli", description: "du mardi au samedi, fermé le dimanche" },
    reason: null, note: "vendeur en boulangerie, samedi travaillé, dimanche fermé -> conservée",
    test: (s) => s.sector === "Commerce alimentaire" && s.rhythm === "Dimanche libre"
  },
  {
    o: { ...ok, ref: "n:2", title: "Vendeuse boulangerie", company: "W", description: "travail 1 dimanche sur 2" },
    reason: "dimanche travaillé", note: "« 1 dimanche sur 2 » -> rejet ferme"
  },
  {
    o: { ...ok, ref: "n:3", title: "Conseiller de vente", company: "W", description: "pas de travail le dimanche, fixe + commissions" },
    reason: null, note: "CONTRE-EXEMPLE : « pas de travail le dimanche » et « commissions » ne doivent PAS écarter",
    test: (s) => s.rhythm === "Dimanche libre"
  },
  {
    o: { ...ok, ref: "n:4", title: "Employé de rayon", company: "W", description: "du lundi au vendredi mais 1 samedi sur 2" },
    reason: null, note: "lundi-vendredi + samedi travaillé -> seul le repos dominical est acquis",
    test: (s) => s.rhythm === "Dimanche libre"
  },
  {
    o: { ...ok, ref: "n:5", title: "Employé de rayon", company: "W", description: "horaires coupés 6h-12h / 16h-19h" },
    reason: "horaires coupés", note: "horaires coupés -> rejet ferme"
  },
  {
    o: { ...ok, ref: "n:6", title: "Employé polyvalent", company: "W", description: "magasin ouvert du lundi au dimanche" },
    reason: "dimanche travaillé", note: "« du lundi au dimanche » -> rejet ferme"
  },
  // Contrats
  {
    o: { ...ok, ref: "n:10", title: "Conseiller clientèle", company: "Assur SA", contract: "CDD", description: "CDD de 18 mois" },
    reason: "CDD (CDI exigé)", note: "CDD dans le privé -> rejet ferme, même long"
  },
  {
    o: { ...ok, ref: "n:11", title: "Assistant administratif", company: "Métropole de Lyon", contract: "CDD", description: "CDD de 12 mois renouvelable" },
    reason: null, note: "CDD de 12 mois à la Métropole -> exception publique",
    test: (s) => s.employer === "Public" && s.sector === "Administration publique"
  },
  {
    o: { ...ok, ref: "n:12", title: "Agent d'accueil", company: "Commune d'Oullins", contract: "CDD", description: "contrat de 6 mois" },
    reason: "CDD de moins de 12 mois", note: "CDD public de 6 mois -> sous la durée minimale"
  },
  {
    o: { ...ok, ref: "n:13", title: "Gestionnaire administratif", company: "Association Le Mat", contract: "CDD", description: "poste en CDD, période d'essai de 1 mois" },
    reason: null, note: "CDD associatif sans durée -> conservé ; la période d'essai n'est pas une durée de contrat",
    test: (s) => s.employer === "Associatif" && s.sector === "Associatif"
  },
  {
    o: { ...ok, ref: "n:14", title: "Intérim - Hôte de caisse", company: "Adecco", contract: undefined, description: "mission" },
    reason: "intérim", note: "intérim annoncé dans l'intitulé -> rejet ferme"
  },
  {
    o: { ...ok, ref: "n:15", source: "Choisir le service public", title: "Secrétaire de mairie", company: "Communes", contract: undefined, description: "Nature de l'emploi : Emploi ouvert uniquement aux titulaires" },
    reason: "réservé aux titulaires", note: "poste réservé aux titulaires -> concours requis, rejet"
  },
  {
    o: { ...ok, ref: "n:16", source: "Choisir le service public", title: "Assistant administratif", company: "EPIDE", contract: "CDD", description: "Emploi ouvert aux titulaires et aux contractuels. Catégorie C (employé). CDD de 3 ans" },
    reason: null, note: "CONTRE-EXEMPLE : ouvert aux contractuels, CDD de 3 ans -> conservé",
    test: (s) => s.employer === "Public"
  },
  {
    o: { ...ok, ref: "n:17", source: "Choisir le service public", title: "Chargé de mission budget", company: "Région", contract: "CDD", description: "Nature de l'emploi : Emploi ouvert aux titulaires et aux contractuels. Catégorie : Catégorie A (cadre). CDD de 3 ans" },
    reason: "catégorie A (cadre)", note: "fonction publique catégorie A -> rejet (niveau cadre)"
  },
  {
    o: { ...ok, ref: "n:18", source: "Choisir le service public", title: "Secrétaire administratif(ve) et technique à temps non complet de 50 %", company: "EPCI", contract: "CDD", description: "Emploi ouvert aux titulaires et aux contractuels" },
    reason: "temps partiel", note: "« temps non complet » (fonction publique) -> temps partiel"
  },
  // Domaines, métiers qualifiés, encadrement
  {
    o: { ...ok, ref: "n:20", title: "Boulanger H/F", company: "W", description: "fabrication du pain" },
    reason: "métier qualifié", note: "boulanger (métier qualifié) -> rejet, à ne pas confondre avec la vente"
  },
  {
    o: { ...ok, ref: "n:21", title: "Préparateur de commandes", company: "W", description: "entrepôt" },
    reason: "domaine exclu (logistique / production)", note: "logistique -> domaine exclu"
  },
  {
    o: { ...ok, ref: "n:22", title: "Assistant logistique", company: "W", description: "suivi des expéditions, bureau" },
    reason: null, note: "CONTRE-EXEMPLE : assistant logistique (poste de bureau) n'est pas un poste d'exécution"
  },
  {
    o: { ...ok, ref: "n:23", title: "Agent d'entretien", company: "W", description: "nettoyage des locaux" },
    reason: "domaine exclu (propreté)", note: "propreté -> domaine exclu"
  },
  {
    o: { ...ok, ref: "n:24", title: "Assistant administratif service informatique", company: "W", description: "" },
    reason: "domaine exclu (informatique)", note: "poste en service informatique -> domaine exclu"
  },
  {
    // Cas réels du rejeu du lot du 21/11/2026, passés entre les mailles.
    o: { ...ok, ref: "n:24b", title: "Technicien Service Clients H/F", company: "Sogelink", description: "assistance aux utilisateurs du logiciel" },
    reason: "domaine exclu (informatique)", note: "technicien service clients d'un éditeur -> support applicatif, exclu"
  },
  {
    o: { ...ok, ref: "n:24c", title: "Déménagement H/F", company: "BH Déménagement", description: "port de charges" },
    reason: "domaine exclu (logistique / production)", note: "déménagement -> manutention, exclu"
  },
  {
    o: { ...ok, ref: "n:25", title: "Responsable de boutique", company: "Boulangerie Ange", description: "boulangerie, équipe de 4 vendeurs" },
    reason: null, note: "encadrement d'une petite équipe en commerce -> accepté (son expérience)"
  },
  {
    o: { ...ok, ref: "n:26", title: "Directeur de magasin", company: "W", description: "supermarché" },
    reason: "encadrement", note: "direction de magasin -> grand encadrement, rejet"
  }
];

for (const c of nov) {
  const got = rejectReason(c.o, CITIES.lyon);
  const s = scoreOffer(c.o, CITIES.lyon);
  const ok2 = got === c.reason && (!c.test || (s !== null && c.test(s)));
  check(ok2, c.note, `motif attendu « ${c.reason} », obtenu « ${got} »${s ? ` score=${s.score} secteur=${s.sector} rythme=${s.rhythm}` : ""}`);
}

// Zone resserrée sur le métro et le tramway (novembre 2026, cf. cities.ts). Les
// pièges visés : un libellé qui contient « Lyon » sans être à Lyon, un code
// postal partagé (69330 Meyzieu / Jonage), une rue lyonnaise qui porte le nom
// d'une commune écartée.
const geo: Array<{ location: string; postalCode?: string; inZone: boolean; note: string }> = [
  { location: "LYON 03", inZone: true, note: "libellé France Travail d'arrondissement" },
  { location: "Lyon Meyzieu", inZone: true, note: "Meyzieu, tram T3" },
  { location: "Oullins-Pierre-Bénite", inZone: true, note: "commune fusionnée, métro B" },
  { location: "DECINES CHARPIEU", inZone: true, note: "Décines sans accent, tram T3" },
  { location: "Saint-Priest", postalCode: "69800", inZone: true, note: "Saint-Priest, tram T2" },
  { location: "Route de Vienne, Lyon 8e", inZone: true, note: "rue lyonnaise, pas la ville de Vienne" },
  { location: "", postalCode: "69330", inZone: true, note: "code postal seul, 69330 ambigu : conservé" },
  { location: "Sainte-Foy-lès-Lyon", inZone: false, note: "contient « Lyon » mais bus seulement" },
  { location: "Tassin-la-Demi-Lune, Lyon", inZone: false, note: "format Adzuna « commune, Lyon »" },
  { location: "Jonage", postalCode: "69330", inZone: false, note: "Jonage partage le 69330 avec Meyzieu" },
  { location: "Saint-Fons", inZone: false, note: "bus seulement jusqu'au tram T10" },
  { location: "69290 Craponne", inZone: false, note: "Craponne, bus seulement" },
  { location: "Rillieux-la-Pape", postalCode: "69140", inZone: false, note: "Rillieux, bus seulement" }
];
for (const g of geo) {
  const got = rejectReason({ ...ok, ref: "g", title: "Assistant administratif", company: "W", location: g.location, postalCode: g.postalCode, description: "" }, CITIES.lyon);
  check((got !== "hors zone") === g.inZone, `zone : ${g.note}`, `« ${g.location} » -> ${got ?? "conservée"}`);
}

// Nature de l'employeur : bornes de mot accentuées (cf. `words` dans config.ts).
const kinds: Array<[string, string]> = [
  ["Café Joyeux", "Privé"],
  ["Université Lyon 1", "Public"],
  ["Commune d'Oullins", "Public"],
  ["Agence Régionale de Santé", "Public"],
  ["Fondation Apprentis d'Auteuil", "Associatif"],
  ["Cabinet Durand & Associés", "Privé"]
];
for (const [company, expected] of kinds) {
  const got = employerKindOf({ ...base, ref: "k", title: "Assistant", company, location: "Lyon" });
  check(got === expected, `employeur : « ${company} » -> ${expected}`, `obtenu ${got}`);
}

check(contractMonths("cdd de 3 ans") === 36, "durée : « CDD de 3 ans » -> 36 mois");
check(contractMonths("contrat d'un an renouvelable") === 12, "durée : « contrat d'un an » -> 12 mois");
check(contractMonths("cdd, période d'essai de 1 mois") === null, "durée : la période d'essai n'est pas lue comme une durée");

// Priorité des secteurs : à conditions strictement égales, le bureau public passe
// devant le commerce alimentaire (ordre décidé à l'entretien).
const same = { ...base, location: "Lyon", contract: "CDI" as const, description: "" };
const pub = scoreOffer({ ...same, ref: "p:1", title: "Agent administratif", company: "Ville de Lyon" }, CITIES.lyon);
const com = scoreOffer({ ...same, ref: "p:2", title: "Vendeur traiteur", company: "Maison X" }, CITIES.lyon);
check(pub !== null && com !== null && pub.score > com.score, "priorité : public > commerce alimentaire", `${pub?.score} vs ${com?.score}`);

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
  ...base, ref: "flood:faible", title: "Employé commercial", company: "Super U", location: "Saint-Priest",
  createdAt: new Date(Date.now() - 9 * 86400000).toISOString(), description: "rayon épicerie"
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
