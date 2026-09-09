import { readFileSync, writeFileSync } from "node:fs";
import { scoreOffer } from "./src/score";
import { DedupIndex } from "./src/dedup";
import { CITIES } from "./src/cities";
import { LIMITS } from "./src/config";
const city = CITIES.lyon;
const raw = JSON.parse(readFileSync("data/web-raw.json","utf-8"));
const ex  = JSON.parse(readFileSync("data/notion-existing.json","utf-8"));
const scored:any[] = []; const seen = new Set<string>();
for (const o of raw){ if(seen.has(o.ref))continue; seen.add(o.ref);
  const s:any = scoreOffer(o, city); if(!s)continue;
  if (/s[ée]nior|confirm[ée]/i.test(s.title) && !/senior|confirmé/.test(s.title.toLowerCase())) s.score=Math.max(0,s.score-12);
  scored.push(s); }
scored.sort((a,b)=>b.score-a.score);
const index = new DedupIndex(city);
for (const o of ex) index.add({title:o.title,company:o.company||"",location:o.location||""});
const refs = new Set<string>(ex.map((o:any)=>o.ref).filter(Boolean));
const sel:any[]=[];
for (const o of scored){ if(o.score<LIMITS.minScore)continue;
  if(refs.has(o.ref)||index.isDuplicate(o))continue; index.add(o); sel.push(o); if(sel.length>=25)break; }
writeFileSync("data/web-selected.json", JSON.stringify(sel,null,1));
console.log(sel.length);
