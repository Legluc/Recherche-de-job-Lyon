/*
 * Jobs That Make Sense (emploi associatif et ESS). Onglet ouvert sur
 * https://jobs.makesense.org/ (même origine).
 *
 * CFG = { pages: string[], known: string[], maxDetails: number, pauseMs?: number }
 *   pages : chemins de listes Lyon, par exemple
 *     /fr/s/jobs/Lyon--France/all/cdi?locations=Lyon,%20France&sortBy=relevance
 *     (même chemin + &items_page=1, &items_page=2 ; puis /all/cdd?...)
 *   known : slugs déjà présents dans Notion, sans le préfixe "jtms:".
 *
 * Le tri par date renvoie une erreur 500 côté site : on parcourt donc toutes les
 * pages de la liste Lyon (une soixantaine d'offres en CDI, une vingtaine en CDD)
 * et l'on ne détaille que les offres inconnues. Le rayon par défaut du site est
 * de 50 km : la zone est filtrée ensuite par le moteur.
 */
(async (CFG) => {
  const P = CFG.pauseMs ?? 1500;
  const known = new Set(CFG.known || []);
  const stats = { pages: 0, cartes: 0, connues: 0, prefiltre: 0, details: 0, nonDetaillees: 0, erreurs: [] };
  const cards = new Map();
  const CONTRACTS = /^(CDI|CDD|Stage|Alternance|Freelance|B[ée]n[ée]volat|Service civique|VIE|Int[ée]rim)$/i;

  for (const path of CFG.pages) {
    try {
      const d = await JH.fetchDoc(path);
      stats.pages++;
      for (const a of d.querySelectorAll('a[href*="/fr/jobs/"]')) {
        const slug = a.getAttribute("href").split("?")[0].split("/").filter(Boolean).pop();
        if (!slug || cards.has(slug)) continue;
        stats.cartes++;
        const leaves = [...a.querySelectorAll("*")]
          .filter((e) => !e.children.length && e.textContent.trim())
          .map((e) => e.textContent.trim())
          .filter((x) => !/^à la une$/i.test(x));
        cards.set(slug, {
          slug,
          company: leaves[0] || "",
          title: leaves[1] || "",
          contract: leaves.find((x) => CONTRACTS.test(x))
        });
      }
    } catch (e) {
      stats.erreurs.push(`${path.split("?")[0]} : ${e.message}`);
    }
    await JH.pause(P);
  }

  const offers = [];
  for (const c of cards.values()) {
    if (known.has(c.slug)) { stats.connues++; continue; }
    if (JH.SKIP_TITLE.test(c.title) || (c.contract && !/^CD[ID]$/i.test(c.contract))) { stats.prefiltre++; continue; }
    if (stats.details >= CFG.maxDetails) { stats.nonDetaillees++; continue; }
    try {
      const jp = JH.jobPosting(await JH.fetchDoc(`/fr/jobs/${c.slug}`));
      stats.details++;
      const addr = [jp?.jobLocation].flat()[0]?.address || {};
      offers.push({
        source: "Jobs That Make Sense",
        ref: `jtms:${c.slug}`,
        type: "Alimentaire",
        title: jp?.title || c.title,
        company: jp?.hiringOrganization?.name || c.company,
        location: addr.addressLocality || addr.streetAddress || "",
        postalCode: addr.postalCode,
        contract: c.contract && /^CD[ID]$/i.test(c.contract) ? c.contract.toUpperCase() : undefined,
        url: `https://jobs.makesense.org/fr/jobs/${c.slug}`,
        createdAt: JH.fromFrench(jp?.datePosted),
        salary: JH.salaryFromLd(jp?.baseSalary),
        description: JH.condense(JH.htmlToText(jp?.description)),
        channel: "Plateforme"
      });
    } catch (e) {
      stats.erreurs.push(`détail ${c.slug} : ${e.message}`);
    }
    await JH.pause(P);
  }
  return JH.done("Jobs That Make Sense", offers, stats);
})(CFG);
