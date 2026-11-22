import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { reviewDiff, reviewDeployment } from "../src/lib/specialists/reviews.server.ts";
import { DEMO_DIFF, DEMO_LOGS, DEMO_HEALTH, parseReviewInput, REVIEW_MAX_LENGTH } from "../src/lib/specialists/reviews.ts";
import { openDb } from "../src/lib/workplace/db.server.ts";
import { ensurePersonalWorkspace, approveHire, submitAgentJob, submitJob, runJob, getState, listMarketplace, type ServiceDeps } from "../src/lib/workplace/service.server.ts";
import { readSavedJobs } from "../src/lib/workflow/read-jobs.server.ts";

test("diff review executes locally with precise added-line evidence, impact and tests", () => {
 const r = reviewDiff(DEMO_DIFF);
 assert.equal(r.demoInput,true); assert.equal(r.method,"local-rules-v1");
 assert.equal(r.findings.length,1);
 assert.deepEqual(r.findings[0].evidence,[{source:"src/api/preview.ts",line:2,side:"new",text:"  const result = eval(input);"}]);
 assert.match(r.findings[0].impact,/untrusted/); assert.ok(r.findings[0].suggestedTests.length);
 assert.match(r.uncertainties.join(" "),/not a complete/);
});
test("diff files, hunk offsets and deletion-only changes do not invent findings", () => {
 const diff = `--- a/a.ts\n+++ b/a.ts\n@@ -10 +20 @@\n-old\n+safe()\n@@ -30 +40 @@\n-old\n+eval(input)\ndiff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-eval(old)\n`;
 const r=reviewDiff(diff);assert.equal(r.findings.length,1); assert.equal(r.findings[0].evidence[0].line,40);assert.equal(r.findings[0].evidence[0].source,"a.ts");assert.match(r.summary,/2 changed files/);
});
test("no detected diff pattern is explicitly not an approval", () => {
 const r=reviewDiff(DEMO_DIFF.replace("eval(input)","JSON.parse(input)"));assert.equal(r.demoInput,false);assert.equal(r.findings.length,0);assert.match(r.uncertainties.join(" "),/does not establish/);
});
test("text is never executed, even when it includes executable expressions", () => {
 const r=reviewDiff(DEMO_DIFF.replace("eval(input)","eval('throw new Error(\"never run\")')"));assert.equal(r.findings.length,1);
});
test("invalid, oversized and incomplete diffs fail rather than produce a clean report", () => {
 assert.throws(()=>reviewDiff("not a diff"),/unified/);
 assert.throws(()=>parseReviewInput("pull_request_review",{diff:"x".repeat(REVIEW_MAX_LENGTH+1)}),/characters/);
 assert.throws(()=>reviewDiff(DEMO_DIFF.replace("+1,4","+1,5")),/incomplete/);
 assert.throws(()=>reviewDiff(DEMO_DIFF.replace("+1,4","+1,5")+DEMO_DIFF),/incomplete/);
});
test("deployment review ties the hypothesis to submitted logs and health evidence", () => {
 const r=reviewDeployment(DEMO_LOGS,DEMO_HEALTH);assert.equal(r.demoInput,true);
 assert.match(r.summary,/Database path unavailable/);assert.match(r.summary,/unconfirmed/);
 assert.ok(r.findings[0].evidence.some(e=>e.source==="deployment.log" && e.line===2 && /SQLITE_CANTOPEN/.test(e.text)));
 assert.ok(r.findings[0].evidence.some(e=>e.source==="health-check.txt" && e.line===1 && /503/.test(e.text)));
 assert.match(r.nextSteps[0],/permissions/);
});
test("incomplete deployment evidence flags uncertainty and avoids guessing root cause", () => {
 const r=reviewDeployment("","GET /health -> 503");assert.equal(r.findings.length,0);assert.match(r.summary,/undetermined/);assert.match(r.uncertainties.join(" "),/logs were not supplied/);assert.equal(r.observations[0].source,"health-check.txt");
 const logsOnly=reviewDeployment("EADDRINUSE 0.0.0.0:3000","");assert.match(logsOnly.uncertainties.join(" "),/results were not supplied/);assert.match(logsOnly.nextSteps[0],/before stopping/);
 assert.throws(()=>reviewDeployment("",""),/Submit deployment/);
});
test("multiple diagnostic signals remain hypotheses, not a single invented root cause", () => {
 const r=reviewDeployment("EADDRINUSE\nECONNREFUSED","GET /health -> 200");assert.equal(r.findings.length,2);assert.match(r.summary,/relationship is unconfirmed/);
});

for(const [profile,type,input] of [
 ["software_engineer","pull_request_review",{diff:DEMO_DIFF}],
 ["cloud_infrastructure_engineer","deployment_review",{logs:DEMO_LOGS,healthChecks:DEMO_HEALTH}],
] as const) test(`${profile}: listing → hire → action → one durable private report`,async()=>{
 const temp=mkdtempSync(path.join(tmpdir(),"specialist-unit-")),file=path.join(temp,"db.sqlite");let db=openDb(file);let id=0,now=1000;
 const deps:ServiceDeps={now:()=>now++,newId:k=>`${k}-${++id}`,lookup:async()=>{throw new Error("Provider access is forbidden for specialist reviews");}};
 try {
  const ws=ensurePersonalWorkspace(db,deps,{sub:"auth0|specialist-a",name:"Alice"});
  const listing=listMarketplace(db).find(l=>l.id===profile)!;assert.ok(listing.verified && listing.sampleWork && listing.permissions.length);
  const hire=approveHire(db,deps,ws,{profileId:profile,retention:"team"});assert.ok(hire.ok);
  const req={clientRequestId:"specialist-private-001",type,...input};
  const job=submitAgentJob(db,deps,ws,hire.hireId,req);assert.ok(job.ok);
  const retry=submitAgentJob(db,deps,ws,hire.hireId,req);assert.ok(retry.ok);assert.equal(retry.jobId,job.jobId);assert.equal(retry.runJobIds.length,0);
  const crossSkill=submitAgentJob(db,deps,ws,hire.hireId,{clientRequestId:"invalid-skill-001",type:type==="pull_request_review"?"deployment_review":"pull_request_review",...input});assert.ok(!crossSkill.ok && crossSkill.error.code==="UNSUPPORTED_ACTION");
  await Promise.all([runJob(db,deps,job.jobId),runJob(db,deps,job.jobId)]);
  const saved=getState(db,ws,"sample",now)!.jobs[0];assert.equal(saved.status,"completed");assert.equal(saved.report!.mode,"local");assert.equal(saved.report!.body.type,"specialist_review");
  assert.equal(db.prepare("select count(*) as n from reports where job_id=?").get(job.jobId)!.n,1);
  assert.ok(saved.events.some(e=>e.actor==="Dispatcher" && e.text.includes(type)));
  db.close();db=openDb(file);
  const history=readSavedJobs(file,ws,"auth0|specialist-a")!;assert.deepEqual(history[0].report,saved.report);
  assert.equal(readSavedJobs(file,ws,"auth0|specialist-b"),null);
 }finally{db.close();rmSync(temp,{recursive:true,force:true});}
});
test("generic job routing recommends each specialist and resumes after approval",async()=>{
 const temp=mkdtempSync(path.join(tmpdir(),"specialist-route-"));const db=openDb(path.join(temp,"db.sqlite"));let id=0;
 const deps:ServiceDeps={now:()=>1000,newId:k=>`${k}-${++id}`,lookup:async()=>{throw new Error("No provider");}};
 try{
  const ws=ensurePersonalWorkspace(db,deps,{sub:"route-owner"});
  for(const [type,input,profile] of [["pull_request_review",{diff:DEMO_DIFF},"software_engineer"],["deployment_review",{logs:DEMO_LOGS,healthChecks:DEMO_HEALTH},"cloud_infrastructure_engineer"]] as const){
   const job=submitJob(db,deps,ws,{clientRequestId:`route-${type}`,type,input});assert.ok(job.ok);
   assert.equal(getState(db,ws,"sample",1000)!.jobs.find(j=>j.id===job.jobId)!.recommendedProfileId,profile);
   const hired=approveHire(db,deps,ws,{profileId:profile,jobId:job.jobId});assert.ok(hired.ok);assert.deepEqual(hired.runJobIds,[job.jobId]);
   await runJob(db,deps,job.jobId);assert.equal(getState(db,ws,"sample",1000)!.jobs.find(j=>j.id===job.jobId)!.status,"completed");
  }
 }finally{db.close();rmSync(temp,{recursive:true,force:true});}
});
