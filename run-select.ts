import { readFileSync } from "node:fs";
import { selectOffers } from "./src/pipeline";
import { CITIES } from "./src/cities";

const raw = JSON.parse(readFileSync("data/web-raw.json", "utf-8"));
const ex = JSON.parse(readFileSync("data/notion-existing.json", "utf-8"));
const existing = {
  refs: new Set<string>(ex.map((o: any) => o.ref).filter(Boolean)),
  offers: ex.map((o: any) => ({ title: o.title, company: o.company || "", location: o.location || "" }))
};
const { scored, selected, duplicates } = selectOffers(raw, CITIES.lyon, existing as any, 25);
console.log(`brutes=${raw.length} scorees=${scored.length} doublons=${duplicates} retenues=${selected.length}`);
console.log("--- REJETEES AU SCORING (filtre/date) ---");
const keptRefs = new Set(scored.map((o: any) => o.ref));
for (const o of raw) if (!keptRefs.has(o.ref)) console.log(`  X ${o.ref} — ${o.title}`);
console.log("--- SELECTIONNEES ---");
for (const o of selected) console.log(JSON.stringify({score:o.score,sector:o.sector,type:o.type,title:o.title,company:o.company,location:o.location,contract:o.contract||"",source:o.source,ref:o.ref,url:o.url,createdAt:o.createdAt||"",channel:o.channel}));
