import { readFileSync } from "node:fs";
import { scoreOffer } from "./src/score";
import { DedupIndex } from "./src/dedup";
import { CITIES } from "./src/cities";
import { LIMITS } from "./src/config";

const city = CITIES.lyon;
let raw = JSON.parse(readFileSync("data/web-raw.json","utf-8"));
const ex  = JSON.parse(readFileSync("data/notion-existing.json","utf-8"));

// Correctif 1 : "intern"/"internship" non couverts par UNWANTED_CONTRACT_RE (anglicismes) -> rejet ferme (stage).
const INTERN = /\bintern(ship)?\b/i;
const before = raw.length;
raw = raw.filter((o:any)=>!INTERN.test(o.title));
console.log(`correctif stage EN : ${before-raw.length} ecartee(s)`);

const scored:any[] = [];
const seen = new Set<string>();
for (const o of raw){
  if (seen.has(o.ref)) continue; seen.add(o.ref);
  const s:any = scoreOffer(o, city);
  if (!s) continue;
  // Correctif 2 : score.ts teste /senior/ sans accent -> "Sénior" echappe au malus junior.
  if (/s[ée]nior|confirm[ée]/i.test(s.title) && !/senior|confirmé/.test(s.title.toLowerCase())) {
    s.score = Math.max(0, s.score - 12);
    s.seniorFix = true;
  }
  scored.push(s);
}
scored.sort((a,b)=>b.score-a.score);

const index = new DedupIndex(city);
for (const o of ex) index.add({title:o.title,company:o.company||"",location:o.location||""});
const refs = new Set<string>(ex.map((o:any)=>o.ref));
const selected:any[] = []; let dup=0;
for (const o of scored){
  if (o.score < LIMITS.minScore) continue;
  if (refs.has(o.ref) || index.isDuplicate(o)) { dup++; continue; }
  index.add(o); selected.push(o);
  if (selected.length>=25) break;
}
console.log(`brutes=${raw.length} scorees=${scored.length} doublons=${dup} retenues=${selected.length}`);
for (const o of selected) console.log([o.score,o.type,o.sector,o.title,o.company,o.location,o.contract||"-",o.source,o.ref,o.seniorFix?"[malus senior]":""].join(" ~ "));
