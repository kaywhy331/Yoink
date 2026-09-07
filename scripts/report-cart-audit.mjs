#!/usr/bin/env node
// Merge retained observations without converting identity checks or fixture
// tests into claims about a retailer's live cart.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
const output=resolve(process.argv[2]||"docs/evidence/cart-audit-2026-09-06");
const read=name=>JSON.parse(readFileSync(join(output,name),"utf8"));
const inventory=read("inventory.json"), replay=read("replay-results.json"), browser=read("browser-results.json");
const live=read("live-results.json"), amazon=read("live-amazon-results.json");
const liveV11=read("live-amazon-v11-results.json");
const stops={bestbuy:"network_blocked",target:"store_security_blocked",walmart:"store_security_blocked",amazon:amazon.status};
const attempts=[...live.attempts.map(a=>({...a,source:"live-results.json"})),...amazon.results.map(a=>({
  ...a,source:"live-amazon-results.json",status:a.status==="offer_not_eligible"&&a.observation?.availability==="unknown"?"loading_or_unknown":a.status
})),...liveV11.attempts.map(a=>({...a,source:"live-amazon-v11-results.json"}))];
const same=(a,b)=>a.retailerId===b.retailerId&&a.retailerSku===b.retailerSku;
const products=inventory.products.map(p=>{
  const liveAttempts=attempts.filter(a=>same(a,p));
  const fixtures=browser.cases.filter(c=>same(c,p));
  const capsules=replay.cases.filter(c=>same(c,p));
  const cart=browser.cartCases.filter(c=>same(c,p));
  const proof=liveAttempts.find(a=>a.status==="cart_verified_and_cleaned");
  return {...p,
    liveStatus:liveAttempts.at(-1)?.status||"not_tested",
    cartStatus:proof?"live_verified_and_cleaned":liveAttempts.some(a=>a.mutationArmed||a.clicked)?"unverified_add":"not_verified",
    unattemptedReason:liveAttempts.length?null:p.kinds.every(k=>k==="fixture")?"fixture_only_identity":stops[p.retailerId],
    liveCartVerified:Boolean(proof),
    liveProof:proof?{source:proof.source,adapterVersion:proof.commit?.job?.adapterVersion||amazon.adapterVersion,
      observedAt:proof.verification?.proof?.observedAt,quantity:proof.verification?.proof?.quantity,cleanupVerified:true}:null,
    liveAttempts:liveAttempts.map(a=>({source:a.source,status:a.status,reason:a.reason||a.diagnostic?.reasonCode||a.verification?.reason,
      clicked:a.clicked||a.commit?.clicked||false,cleanupVerified:a.cleanupVerified||a.cleanup?.baseline?.ok||false})),
    fixtureCases:fixtures.map(c=>({source:c.file,fulfillment:c.fulfillment,passed:c.passed,rehearsal:c.rehearsal?.reason,
      addClicked:c.commit?.commit?.clicked||false,expectedRejection:!c.expectedRehearsal})),
    capsuleCases:capsules.map(c=>({source:c.path,parity:c.parity,outcome:c.source?.actual?.outcome,reason:c.source?.actual?.reasonCode,rehearsalPassed:c.source?.rehearsal?.ok||false})),
    fixtureCartVerified:cart.some(c=>c.passed)
  };
});
const unmappedEvidence=[...attempts,...browser.cases,...replay.cases].filter(c=>!products.some(p=>same(c,p)))
  .map(c=>({retailerId:c.retailerId,retailerSku:c.retailerSku,source:c.source||c.path||c.file}));
const counts=Object.fromEntries(Object.keys(stops).map(store=>{
  const all=products.filter(p=>p.retailerId===store);
  return [store,{identities:all.length,catalog:all.filter(p=>p.kinds.includes("catalog")).length,
    liveInspected:all.filter(p=>p.liveAttempts.length).length,liveVerifiedAndCleaned:all.filter(p=>p.liveCartVerified).length,
    unverifiedAdds:all.filter(p=>p.cartStatus==="unverified_add").length,
    unattempted:all.filter(p=>!p.liveAttempts.length).length,
    withFixtureOrCapsuleResults:all.filter(p=>p.fixtureCases.length||p.capsuleCases.length).length,
    fixtureCartVerified:all.filter(p=>p.fixtureCartVerified).length,stopReason:stops[store]}];
}));
const report={schemaVersion:1,generatedAt:new Date().toISOString(),scope:"Every known inventory identity is accounted for; live Adds remain incomplete. Fixtures and URL validation do not establish live availability or Add success.",
  counts,unmappedEvidence,unresolvedSources:inventory.unresolvedSources,products};
writeFileSync(join(output,"product-results.json"),JSON.stringify(report,null,2)+"\n");
const csv=v=>`"${String(v??"").replaceAll('"','""')}"`;
const columns=["retailerId","retailerSku","canonicalUrl","liveStatus","cartStatus","liveCartVerified","fixtureCartVerified","unattemptedReason","kinds","sources"];
writeFileSync(join(output,"product-results.csv"),columns.join(",")+"\n"+products.map(p=>columns.map(k=>csv(Array.isArray(p[k])?p[k].join("; "):p[k])).join(",")).join("\n")+"\n");
console.log(JSON.stringify({counts,unmappedEvidence,unresolvedSources:inventory.unresolvedSources.length}));
process.exitCode=unmappedEvidence.length||products.some(p=>p.identityCheck!=="passed")?1:0;
