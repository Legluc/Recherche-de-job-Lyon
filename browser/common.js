/*
 * Outils communs aux extracteurs de la passe navigateur (job-hunter-lyon).
 *
 * Ces fichiers ne sont pas des modules : la tâche planifiée concatène
 * `common.js` puis l'extracteur de la source, précédés d'une ligne
 * `var CFG = {...};`, et exécute le tout dans l'onglet du site via
 * javascript_tool. `var` et non `const` : une seconde exécution dans le même
 * onglet redéclarerait la constante et échouerait. Le résultat complet est rangé dans `window.__jh`, pour être
 * relu par tranches (`JSON.stringify(window.__jh.offers.slice(0, 8))`) quand
 * il dépasse ce qu'une sortie d'outil peut porter.
 *
 * Aucune règle de sélection ici : le pré-filtre ne sert qu'à économiser les
 * requêtes de détail. La sélection reste celle de `npm run select-web`.
 */
var JH = {
  pause: (ms) => new Promise((r) => setTimeout(r, ms)),

  /** Intitulés qu'il est inutile d'ouvrir (le moteur les rejetterait de toute façon). */
  SKIP_TITLE: /stage|stagiaire|alternan|apprenti|int[ée]rim|d[ée]veloppeu|informati|ing[ée]nieur|directeur|directrice|m[ée]decin|infirmi|enseignant|professeur|chercheur|post[- ]?doc/i,

  async fetchDoc(path) {
    const r = await fetch(path, { credentials: "same-origin" });
    if (!r.ok) throw new Error(`HTTP ${r.status} sur ${path.split("?")[0]}`);
    return new DOMParser().parseFromString(await r.text(), "text/html");
  },

  /** Premier JobPosting JSON-LD de la page, ou null. */
  jobPosting(doc) {
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const items = [JSON.parse(s.textContent)].flat();
        const jp = items.find((x) => x && x["@type"] === "JobPosting");
        if (jp) return jp;
      } catch (e) {
        /* bloc JSON-LD invalide : on passe au suivant */
      }
    }
    return null;
  },

  /**
   * HTML d'une description JSON-LD -> texte brut. Les fins de blocs deviennent
   * des fins de phrase : sans cela, « Les missions du poste</h2><p>Intermarché »
   * donnait « posteIntermarché » et `condense` ne savait plus découper.
   */
  htmlToText(html) {
    const spaced = (html || "").replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/ul|\/tr)\b[^>]*>/gi, "$&\n");
    const d = new DOMParser().parseFromString(`<div>${spaced}</div>`, "text/html");
    return (d.body.textContent || "")
      .replace(/([^.!?:;\s])\s*\n\s*/g, "$1. ")
      .replace(/\s+/g, " ")
      .trim();
  },

  /**
   * Description de 1 900 caractères au plus, phrases utiles en tête.
   *
   * Le moteur ne voit que ce texte : une mention du dimanche, d'horaires coupés
   * ou d'une durée de CDD placée au-delà des 1 900 premiers caractères (après la
   * présentation de l'entreprise) serait perdue. On remonte donc d'abord les
   * phrases qui parlent de rythme, de durée, de contrat ou de salaire.
   */
  condense(text, max = 1900) {
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const KEY = /dimanche|samedi|week[- ]?end|lundi|horaire|coupure|heures|\bh\/|temps (?:plein|partiel)|cdd|cdi|dur[ée]e|mois|salaire|r[ée]mun[ée]ration|brut|titulaire|contractuel|cat[ée]gorie|v[ée]hicule|permis/i;
    const sentences = t.split(/(?<=[.!?;])\s+/);
    const key = sentences.filter((s) => KEY.test(s)).join(" ");
    const head = key.length > max * 0.6 ? key.slice(0, Math.floor(max * 0.6)) : key;
    return `${head} … ${t}`.slice(0, max);
  },

  /** Date ISO (AAAA-MM-JJ) depuis « il y a 3 jours », « il y a 16 heures », « hier ». */
  fromRelative(s) {
    if (!s) return undefined;
    let days = null;
    const m = s.match(/(\d+)\s*(minute|heure|jour|semaine|mois)/i);
    if (/aujourd|minute|heure/i.test(s)) days = 0;
    else if (/hier/i.test(s)) days = 1;
    else if (m) days = Number(m[1]) * ({ jour: 1, semaine: 7, mois: 30 }[m[2].toLowerCase()] || 1);
    return days === null ? undefined : new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  },

  MONTHS: { janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12 },

  /** Date ISO depuis « 20 novembre 2026 » ou « 20/11/2026 ». */
  fromFrench(s) {
    if (!s) return undefined;
    let m = s.match(/(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i);
    if (m && JH.MONTHS[m[2].toLowerCase()]) {
      return `${m[3]}-${String(JH.MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[0] : undefined;
  },

  /** Salaire JSON-LD -> libellé lisible par salary.ts. */
  salaryFromLd(bs) {
    const v = bs && bs.value;
    if (!v) return undefined;
    const unit = { MONTH: "par mois", YEAR: "par an", HOUR: "de l'heure" }[v.unitText] || "";
    const lo = v.minValue ?? v.value;
    const hi = v.maxValue;
    if (lo === undefined || lo === null || lo === "") return undefined;
    const fmt = (x) => String(x).replace(/,00$/, "").replace(/\.0+$/, "");
    return `${fmt(lo)}${hi && hi !== lo ? ` - ${fmt(hi)}` : ""} € ${unit}`.trim();
  },

  /** Range le résultat pour lecture par tranches et renvoie un résumé compact. */
  done(source, offers, stats) {
    window.__jh = { source, offers, stats };
    return {
      source,
      stats,
      offers: offers.length,
      apercu: offers.slice(0, 5).map((o) => `${o.ref} | ${o.title} | ${o.company} | ${o.location}`)
    };
  }
};
