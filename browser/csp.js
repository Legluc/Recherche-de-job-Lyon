/*
 * Choisir le service public (fonctions publiques d'État, territoriale et
 * hospitalière ; les offres de la Métropole et de la Ville de Lyon y figurent).
 * Onglet ouvert sur https://choisirleservicepublic.gouv.fr/ (même origine).
 *
 * CFG = { keywords: string[], known: string[], maxDetails: number, pauseMs?: number }
 *   known : références déjà présentes dans Notion, sans le préfixe "csp:".
 *
 * Les cartes ne donnent que le département (« Rhône (69) ») : la commune, la
 * nature de l'emploi (titulaires / contractuels), la catégorie et la
 * rémunération ne sont que sur la page de détail. Une offre non détaillée serait
 * rejetée « hors zone » par le moteur : elle n'est donc pas renvoyée.
 */
(async (CFG) => {
  const P = CFG.pauseMs ?? 1500;
  const known = new Set(CFG.known || []);
  const stats = { pages: 0, cartes: 0, connues: 0, prefiltre: 0, details: 0, nonDetaillees: 0, erreurs: [] };
  const cards = new Map();

  for (const kw of CFG.keywords) {
    try {
      const d = await JH.fetchDoc(`/nos-offres/filtres/mot-cles/${encodeURIComponent(kw)}/localisation/336/`);
      stats.pages++;
      for (const card of d.querySelectorAll(".fr-card")) {
        const a = card.querySelector('a[href*="/offre-emploi/"]');
        if (!a) continue;
        const href = a.getAttribute("href");
        const ref = (href.match(/reference-([^/?#]+)\/?$/) || [])[1];
        if (!ref || cards.has(ref)) continue;
        stats.cartes++;
        const lis = [...card.querySelectorAll("li")].map((l) => l.textContent.replace(/\s+/g, " ").trim());
        const get = (label) => (lis.find((x) => x.startsWith(label)) || "").slice(label.length).trim();
        cards.set(ref, {
          ref, href,
          title: a.textContent.replace(/\s+/g, " ").trim(),
          employer: get("Employeur :"),
          date: JH.fromFrench(lis.find((x) => /en ligne depuis/i.test(x)))
        });
      }
    } catch (e) {
      stats.erreurs.push(`${kw} : ${e.message}`);
    }
    await JH.pause(P);
  }

  const offers = [];
  for (const c of cards.values()) {
    if (known.has(c.ref)) { stats.connues++; continue; }
    if (JH.SKIP_TITLE.test(c.title)) { stats.prefiltre++; continue; }
    if (stats.details >= CFG.maxDetails) { stats.nonDetaillees++; continue; }
    try {
      const doc = await JH.fetchDoc(c.href);
      stats.details++;
      const txt = doc.querySelector("main")?.textContent || "";
      const lines = txt.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
      // Champ « Libellé » suivi de sa valeur sur la ligne non vide suivante.
      const field = (re) => {
        const i = lines.findIndex((l) => re.test(l));
        return i >= 0 ? (lines[i].replace(re, "").replace(/^\s*:\s*/, "").trim() || lines[i + 1] || "") : "";
      };
      const nature = field(/^Nature de l.emploi/i);
      const category = field(/^Cat[ée]gorie$/i);
      const remu = field(/^Fourchette indicative pour les contractuels/i);
      const start = lines.findIndex((l) => /^Vos missions/i.test(l));
      const end = lines.findIndex((l) => /^Des offres d.emplois recommand/i.test(l));
      const body = start >= 0 ? lines.slice(start, end > start ? end : undefined).join(". ") : "";
      const contract = /contractuel/i.test(nature) ? (/\bcdi\b/i.test(body) ? "CDI" : "CDD") : undefined;
      offers.push({
        source: "Choisir le service public",
        ref: `csp:${c.ref}`,
        type: "Alimentaire",
        title: c.title,
        company: c.employer || field(/^Employeur :?$/i),
        location: field(/^Localisation :?$/i),
        contract,
        url: new URL(c.href, location.origin).href,
        createdAt: c.date,
        salary: /€/.test(remu) ? remu : undefined,
        description: JH.condense(`Nature de l'emploi : ${nature}. Catégorie : ${category}. ${body}`),
        channel: "Formulaire"
      });
    } catch (e) {
      stats.erreurs.push(`détail ${c.ref} : ${e.message}`);
    }
    await JH.pause(P);
  }
  return JH.done("Choisir le service public", offers, stats);
})(CFG);
