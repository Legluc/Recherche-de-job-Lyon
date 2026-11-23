/*
 * Indeed. À exécuter sur une page de résultats déjà chargée par navigation
 * (jamais par fetch : Indeed protège ses recherches par Cloudflare, et un fetch
 * en rafale déclenche la page « Security Check »).
 *
 * URL attendue : https://fr.indeed.com/jobs?q=<requête>&l=Lyon+(69)&fromage=7&sort=date&jt=permanent
 *
 * Pas de CFG. Renvoie { bloque, offers } directement : une page compte au plus
 * une quinzaine de cartes sans description, la sortie tient dans un appel.
 *
 * Indeed ne publie ni date ni annonce complète sur ses cartes : `createdAt` est
 * omis (le moteur applique une valeur neutre, fromage=7 garantit la fraîcheur)
 * et la description se limite aux attributs de la carte (« Temps plein », « Du
 * lundi au vendredi »), que le moteur sait lire.
 */
(() => {
  const head = `${document.title} ${(document.body?.innerText || "").slice(0, 600)}`;
  if (/security check|captcha|v[ée]rification (?:de s[ée]curit[ée]|humaine)|êtes-vous un robot/i.test(head)) {
    return { bloque: true, offers: [] };
  }
  // Filtre « CDI » de la recherche : le type de contrat est souvent masqué
  // derrière « +1 » sur la carte, la requête elle-même fait foi.
  const cdiFilter = /[?&]jt=permanent\b/.test(location.search);
  const offers = [];
  for (const c of document.querySelectorAll(".job_seen_beacon")) {
    const link = c.querySelector("a.jcs-JobTitle");
    const jk = link?.getAttribute("data-jk") || c.querySelector("a[data-jk]")?.getAttribute("data-jk");
    if (!jk) continue;
    const loc = c.querySelector('[data-testid="text-location"]')?.textContent.trim() || "";
    const attrs = [...c.querySelectorAll('[data-testid*="attribute_snippet"]')].map((e) => e.textContent.trim());
    const salary = attrs.find((x) => /€/.test(x));
    const contract = attrs.some((x) => /int[ée]rim/i.test(x)) ? "Intérim"
      : attrs.some((x) => /\bCDD\b/.test(x)) ? "CDD"
      : attrs.some((x) => /\bCDI\b/.test(x)) || cdiFilter ? "CDI"
      : undefined;
    offers.push({
      source: "Indeed",
      ref: `indeed:${jk}`,
      type: "Alimentaire",
      title: link?.textContent.trim() || "",
      company: c.querySelector('[data-testid="company-name"]')?.textContent.trim() || "",
      location: loc,
      postalCode: (loc.match(/\b\d{5}\b/) || [])[0],
      contract,
      url: `https://fr.indeed.com/viewjob?jk=${jk}`,
      salary,
      description: attrs.filter((x) => x !== salary).join(". "),
      channel: "Plateforme"
    });
  }
  return { bloque: false, offers };
})();
