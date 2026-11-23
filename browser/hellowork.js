/*
 * HelloWork. Onglet ouvert sur https://www.hellowork.com/ (même origine).
 *
 * CFG = { queries: string[], known: string[], maxDetails: number, pauseMs?: number }
 *   known : identifiants HelloWork déjà présents dans Notion, sans préfixe.
 *
 * Recherche filtrée CDI, publiée depuis moins d'une semaine, autour de Lyon. Les
 * cartes donnent titre, employeur, lieu, contrat, salaire et ancienneté ; la page
 * de détail donne l'annonce complète (JSON-LD JobPosting), indispensable au
 * moteur pour lire le dimanche, les horaires coupés et la durée hebdomadaire.
 */
(async (CFG) => {
  const P = CFG.pauseMs ?? 1500;
  const known = new Set(CFG.known || []);
  const stats = { pages: 0, cartes: 0, connues: 0, prefiltre: 0, details: 0, erreurs: [] };
  const cards = new Map();

  for (const k of CFG.queries) {
    const q = new URLSearchParams({ k, l: "Lyon 69000", c: "CDI", d: "w" });
    try {
      const d = await JH.fetchDoc("/fr-fr/emploi/recherche.html?" + q);
      stats.pages++;
      for (const li of d.querySelectorAll("li[data-id-storage-item-id]")) {
        const id = li.getAttribute("data-id-storage-item-id");
        if (!id || cards.has(id)) continue;
        stats.cartes++;
        // Titre et employeur : champs cachés du formulaire « masquer l'offre »,
        // plus stables que le balisage visuel (classes utilitaires changeantes).
        const title = li.querySelector('input[name="title"]')?.value?.trim() || "";
        const company = li.querySelector('input[name="company"]')?.value?.trim() || "";
        const leaves = [...li.querySelectorAll("div")].filter((x) => !x.children.length).map((x) => x.textContent.trim());
        const tags = [...li.querySelectorAll('[data-cy="contractTag"]')].map((x) => x.textContent.trim());
        cards.set(id, {
          id, title, company,
          location: li.querySelector('[data-cy="localisationCard"]')?.textContent.trim() || "",
          contract: li.querySelector('[data-cy="contractCard"]')?.textContent.trim() || "",
          salary: leaves.find((x) => /€/.test(x)),
          ago: leaves.find((x) => /^il y a|aujourd|hier/i.test(x)),
          remote: tags.find((x) => /t[ée]l[ée]travail/i.test(x))
        });
      }
    } catch (e) {
      stats.erreurs.push(`${k} : ${e.message}`);
    }
    await JH.pause(P);
  }

  const offers = [];
  for (const c of cards.values()) {
    if (known.has(c.id)) { stats.connues++; continue; }
    if (JH.SKIP_TITLE.test(c.title)) { stats.prefiltre++; continue; }
    const offer = {
      source: "HelloWork",
      ref: `hellowork:${c.id}`,
      type: "Alimentaire",
      title: c.title,
      company: c.company,
      location: c.location.replace(/\s*-\s*\d{2}$/, ""),
      contract: c.contract === "CDI" ? "CDI" : c.contract === "CDD" ? "CDD" : undefined,
      url: `https://www.hellowork.com/fr-fr/emplois/${c.id}.html`,
      createdAt: JH.fromRelative(c.ago),
      salary: c.salary,
      description: "",
      channel: "Plateforme",
      remote: c.remote
    };
    if (stats.details < CFG.maxDetails) {
      try {
        const jp = JH.jobPosting(await JH.fetchDoc(`/fr-fr/emplois/${c.id}.html`));
        stats.details++;
        if (jp) {
          offer.description = JH.condense(JH.htmlToText(jp.description));
          offer.createdAt = JH.fromFrench(jp.datePosted) || offer.createdAt;
          offer.salary = offer.salary || JH.salaryFromLd(jp.baseSalary);
          const pc = jp.jobLocation?.address?.postalCode;
          if (pc && pc !== "69000") offer.postalCode = pc;
        }
      } catch (e) {
        stats.erreurs.push(`détail ${c.id} : ${e.message}`);
      }
      await JH.pause(P);
    }
    offers.push(offer);
  }
  return JH.done("HelloWork", offers, stats);
})(CFG);
