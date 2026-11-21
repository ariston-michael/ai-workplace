// Exercises the standalone deployment artifact with owner-scoped simulated SMS.
// No real user database, Auth0 tenant, carrier message or provider credits.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { createServer as httpServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
const root = process.cwd(), artifact = path.join(root, ".next/standalone");
assert.ok(existsSync(path.join(artifact, "server.js")), "Run npm run build first.");
cpSync(path.join(root, ".next/static"), path.join(artifact, ".next/static"), { recursive: true });
cpSync(path.join(root, "public"), path.join(artifact, "public"), { recursive: true });
const { encrypt } = await import(pathToFileURL(path.join(root, "node_modules/@auth0/nextjs-auth0/dist/server/cookies.js")));
async function port() { const s=createServer();s.listen(0,"127.0.0.1");await once(s,"listening");const p=s.address().port;await new Promise(r=>s.close(r));return p; }
const temp=mkdtempSync(path.join(tmpdir(),"public-demo-check-")), secret=randomBytes(32).toString("hex"), appPort=await port();
const base=`http://127.0.0.1:${appPort}`;
let calls=0;const trap=httpServer((req,res)=>{calls++;res.writeHead(500);res.end();});
const trapPort=await port();trap.listen(trapPort,"127.0.0.1");await once(trap,"listening");
const env={...process.env,PORT:String(appPort),HOSTNAME:"127.0.0.1",AUTH0_DOMAIN:"fixture.invalid",AUTH0_CLIENT_ID:"fixture",AUTH0_CLIENT_SECRET:"fixture",AUTH0_SECRET:secret,APP_BASE_URL:base,WORKPLACE_DB_PATH:path.join(temp,"persistent.db"),WORKPLACE_DEMO_OWNER_EMAIL:"",SMS_MODE:"simulated",PROCUREMENT_MODE:"sample",PROCUREMENT_FIXTURE_DELAY_MS:"200",GEMINI_API_KEY:"",TINYFISH_API_KEY:"trap",TINYFISH_BASE_URL:`http://127.0.0.1:${trapPort}`,TWILIO_ACCOUNT_SID:"AC"+"a".repeat(32),TWILIO_AUTH_TOKEN:"trap",TWILIO_PHONE_NUMBER:"+15555550100",TWILIO_WEBHOOK_URL:base+"/api/sms/twilio",TWILIO_API_BASE:`http://127.0.0.1:${trapPort}`};
let server,browser,logs="";
async function start() {
 server=spawn(process.execPath,[path.join(artifact,"server.js")],{cwd:artifact,env,stdio:["ignore","pipe","pipe"]});server.stdout.on("data",d=>{logs+=d});server.stderr.on("data",d=>{logs+=d});
 for(let i=0;i<150;i++){try { if((await fetch(base+"/api/health")).ok)return; }catch{}if(server.exitCode!==null)throw Error(logs);await delay(100);}
 throw Error("Standalone server not ready: "+logs);
}
async function stop(){if(server&&server.exitCode===null&&server.signalCode===null){server.kill();await once(server,"exit");}}
try {
 await start();
 const chrome=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??(existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")?"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":undefined);
 browser=await chromium.launch({executablePath:chrome,headless:true});
 async function account(name){const c=await browser.newContext();const now=Math.floor(Date.now()/1000);const value=await encrypt({user:{sub:"auth0|demo-"+name,name},tokenSet:{accessToken:"fixture",expiresAt:now+3600},internal:{sid:name,createdAt:now}},secret,now+3600);await c.addCookies([{name:"__session",value,url:base,httpOnly:true,sameSite:"Lax"}]);return c;}
 const alice=await account("Alice"),bob=await account("Bob"),anon=await browser.newContext();
 const ws=(await(await alice.request.get(base+"/api/workspaces")).json()).primaryWorkspaceId;
 const endpoint=base+`/api/workspaces/${ws}/sms/simulate`;
 assert.equal((await anon.request.post(endpoint,{data:{text:"hello",clientRequestId:"anonymous-123456"}})).status(),401);
 assert.equal((await bob.request.post(endpoint,{data:{text:"hello",clientRequestId:"other-user-123456"}})).status(),404);
 assert.equal((await alice.request.post(base+"/api/sms/twilio",{form:{Body:"hello"}})).status(),503,"live webhook is disabled even when Twilio credentials exist");
 const page=await alice.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(base+`/office?workspace=${ws}`);await page.getByLabel("Simulated text",{exact:true}).waitFor();
 await page.getByLabel("Simulated text",{exact:true}).fill("Find a Raspberry Pi 5 4GB on Adafruit");
 await page.getByRole("button",{name:"Send simulated text",exact:true}).click();
 await page.waitForFunction(()=>/Job [A-Z0-9]{4}/.test(document.querySelector(".office-smsTranscript")?.textContent??""));
 const code=/Job ([A-Z0-9]{4})/.exec(await page.locator(".office-smsTranscript").innerText())[1];
 await page.getByLabel("Simulated text",{exact:true}).fill("APPROVE "+code);
 await page.getByRole("button",{name:"Send simulated text",exact:true}).click();
 await page.waitForFunction(()=>/SAMPLE result/.test(document.querySelector(".office-smsTranscript")?.textContent??""));
 let history=await(await alice.request.get(base+`/api/workflow?workspace=${ws}`)).json();
 const job=history.jobs[0];assert.equal(job.sms.simulated,true);assert.equal(job.report.mode,"sample");assert.equal(job.status,"completed");
 assert.match(job.events.map(e=>e.text).join(" "),/No carrier message was sent/);
 assert.equal((await bob.request.get(base+`/api/workflow?workspace=${ws}`)).status(),404);
 assert.equal((await bob.request.get(base+`/api/workspaces/${ws}/sms`)).status(),404);
 assert.deepEqual(errors,[]);assert.equal(calls,0,"carrier and live procurement APIs must not be called");
 await stop();await start();
 history=await(await alice.request.get(base+`/api/workflow?workspace=${ws}`)).json();
 assert.equal(history.jobs[0].report.id,job.report.id,"SQLite reports survive process restart");
 const health=await(await fetch(base+"/api/health")).json();assert.equal(health.procurement,"sample");assert.equal(health.sms,"simulated");
 console.log("PASS: standalone artifact, simulated SMS request → approval → hire → saved SAMPLE report, account isolation, zero carrier/provider calls, and SQLite persistence after restart.");
} catch(error){console.error(logs);throw error;}
finally{await browser?.close();await stop();trap.close();rmSync(temp,{recursive:true,force:true});}
