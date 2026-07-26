#!/usr/bin/env node
"use strict";
// check-state-resolution — static per-function cross-module call resolution
// for the state module family (facade + 5 submodules). The complement to the
// K326 runtime sweep: an unresolved cross-module call sitting inside a bare
// catch never surfaces at runtime, but is visible statically. A call of a
// name owned by another submodule (or a facade-internal helper) must be
// resolvable in the calling function's scope: module-level import, own-module
// top-level, or a function-local lazy require. Called by scripts/smoke-test.sh
// (gate K327); runnable standalone: node scripts/check-state-resolution.cjs
const fs=require("fs");
const ROOT=process.argv[2]||require("path").resolve(__dirname,"..");
const SUBS=["state-contract.cjs","state-io.cjs","state-gates.cjs","state-lanes.cjs","state-graphify.cjs"];
const owner={};
const modImports={};
const bodies={};
const strip=(s)=>s.replace(/\/\/[^\n]*/g,"").replace(/\/\*[\s\S]*?\*\//g,"");
for(const f of SUBS.concat(["state.cjs"])){
  const src=fs.readFileSync(ROOT+"/bin/modules/"+f,"utf8");
  bodies[f]=src;
  const m=src.match(/module\.exports = \{([\s\S]*?)\};/);
  if(m&&f!=="state.cjs") for(const n of m[1].split(",").map(x=>x.trim()).filter(Boolean)) owner[n]=f;
  const imp=new Set();
  for(const im of src.matchAll(/^const \{([\s\S]*?)\} = require\("\.\/[^"]+"\);/gm))
    im[1].split(",").map(x=>x.trim().split(":").pop().trim()).filter(Boolean).forEach(n=>imp.add(n));
  modImports[f]=imp;
}
// facade internals (declared, not imported) count as facade-owned
for(const m of bodies["state.cjs"].matchAll(/^(?:function|const) (\w+)/gm)){
  const n=m[1];
  if(!modImports["state.cjs"].has(n)&&!owner[n]&&n!=="fs"&&n!=="path") owner[n]="state.cjs";
}
const viol=[];
for(const f of SUBS.concat(["state.cjs"])){
  const src=bodies[f];
  const lines=src.split("\n");
  const fns=[];
  lines.forEach((l,i)=>{const m=l.match(/^function (\w+)\s*\(/);if(m)fns.push({name:m[1],start:i});});
  for(let i=0;i<fns.length;i++)fns[i].end=fns[i+1]?fns[i+1].start:lines.length;
  const ownTop=new Set();
  for(const m of src.matchAll(/^(?:function|const) (\w+)/gm)) ownTop.add(m[1]);
  for(const fn of fns){
    const body=strip(lines.slice(fn.start,fn.end).join("\n"));
    const localLazy=new Set();
    for(const lz of body.matchAll(/const \{ ?([^}]+?) ?\} = require\(/g))
      lz[1].split(",").map(x=>x.trim().split(":").pop().trim()).forEach(n=>localLazy.add(n));
    for(const [name,own] of Object.entries(owner)){
      if(own===f)continue;
      if(modImports[f].has(name)||ownTop.has(name)||localLazy.has(name))continue;
      if(new RegExp("(?<![.\\w'\"`])"+name+"\\s*\\(").test(body))
        viol.push(f+"::"+fn.name+" calls "+name+" (owned by "+own+", not visible in-function)");
    }
  }
}
if(viol.length===0){process.stdout.write("OK");}
else{process.stdout.write("FAIL "+viol.join(" | "));process.exitCode=1;}
