// Real production UI, two SDK-encrypted accounts and a temporary SQLite database.
// Reviews run the local analyzers. No provider/infrastructure credentials or mocks are needed.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {webkit,chromium} from 'playwright';
const root=process.cwd(),temp=mkdtempSync(path.join(tmpdir(),'specialist-browser-'));
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
const base=`http://127.0.0.1:${port}`,secret=randomBytes(32).toString('hex');
const {encrypt}=await import(pathToFileURL(path.join(root,'node_modules/@auth0/nextjs-auth0/dist/server/cookies.js')));
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'],{stdio:['ignore','pipe','pipe'],env:{...process.env,APP_BASE_URL:base,AUTH0_DOMAIN:'fixture.invalid',AUTH0_CLIENT_ID:'fixture',AUTH0_CLIENT_SECRET:'fixture',AUTH0_SECRET:secret,WORKPLACE_DB_PATH:path.join(temp,'private.db'),WORKPLACE_DEMO_OWNER_EMAIL:'',PROCUREMENT_MODE:'sample',GEMINI_API_KEY:'',TINYFISH_API_KEY:'',TWILIO_ACCOUNT_SID:'',TWILIO_AUTH_TOKEN:''}});
let log='',browser,checks=0;server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
const check=(condition,name)=>{assert.ok(condition,name);checks++;console.log('PASS',name);};
const shots=process.env.SPECIALIST_SCREENSHOT_DIR;if(shots)mkdirSync(shots,{recursive:true});
async function account(browser,sub,width){const ctx=await browser.newContext({viewport:{width,height:1100}});const now=Math.floor(Date.now()/1000);const value=await encrypt({user:{sub,name:sub},tokenSet:{accessToken:'fixture',expiresAt:now+3600},internal:{sid:sub,createdAt:now}},secret,now+3600);await ctx.addCookies([{name:'__session',value,url:base,httpOnly:true,sameSite:'Lax'}]);return ctx;}
try{
 for(let i=0;;i++){try{if((await fetch(base+'/api/workspaces')).status===401)break;}catch{}if(i>100||server.exitCode!==null)throw new Error('Server failed: '+log);await delay(100);}
 for(const [engine,type,width] of [['WebKit',webkit,1440],['WebKit',webkit,390],['Chromium',chromium,1440]]){
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';browser=await type.launch(engine==='Chromium'&&existsSync(chrome)?{executablePath:chrome}:{});
  const ctx=await account(browser,`auth0|specialist-${engine}-${width}`,width),other=await account(browser,`auth0|other-${engine}-${width}`,width);
  const page=await ctx.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>{errors.push(e.message);console.log('BROWSER ERROR',page.url(),e.stack);});
  await page.goto(base+'/',{waitUntil:'networkidle'});await page.locator('.workspaces-card').first().waitFor();
  const ws=new URL(await page.locator('.workspaces-card').first().getAttribute('href'),base).searchParams.get('workspace');
  const saved=[];
  for(const [id,name,role,title,button,reportLabel,evidence] of [
   ['software_engineer','Nia','Software Engineer','Pull request diff review','Review diff','Pull request review report','src/api/preview.ts:2'],
   ['cloud_infrastructure_engineer','Ash','Cloud Infrastructure Engineer','Deployment evidence review','Review deployment evidence','Deployment review report','SQLITE_CANTOPEN'],
  ]){
   const label=`${engine} ${width}px ${role}`;
   await page.goto(base+'/',{waitUntil:'networkidle'});await page.getByRole('navigation',{name:'Main'}).getByRole('link',{name:'Marketplace',exact:true}).click();
   const card=page.locator(`[data-listing-id="${id}"]`);await card.waitFor();
   check((await card.innerText()).includes('Inputs needed:'),label+' listing explains required inputs');
   await card.getByText('Sample work and permissions',{exact:true}).click();
   check((await card.innerText()).includes('Example report:'),label+' listing shows an example report and read-only permissions');
   await card.getByRole('button',{name:`Hire ${name}`,exact:true}).click();
   const dialog=page.getByRole('dialog');await dialog.waitFor();
   check(await dialog.getByRole('radio',{name:/Keep on team/}).isChecked(),label+' uses the existing retained hire flow');
   await dialog.getByRole('button',{name:/^Hire into/}).click();await page.waitForURL(/\/office\?workspace=.*&arrived=/);
   assert.equal(new URL(page.url()).searchParams.get('workspace'),ws);
   const state=(await (await ctx.request.get(base+`/api/workspaces/${ws}`)).json()).state;
   const hire=state.team.find(h=>h.profileId===id);assert.ok(hire);
   await page.locator(`[data-worker-id="${hire.id}"]`).click();
   const form=page.getByRole('form',{name:title,exact:true});await form.waitFor();
   await form.getByRole('button',{name:'Use demo input',exact:true}).click();
   check((await form.innerText()).includes('DEMO INPUT'),label+' demo input is explicit');
   await form.getByRole('button',{name:button,exact:true}).click();
   await page.locator('#office-panel').getByRole('link',{name:'View report',exact:true}).click();
   const officeReport=page.getByRole('region',{name:reportLabel,exact:true});await officeReport.waitFor();
   const reportText=await officeReport.innerText();
   check(reportText.includes(evidence)&&reportText.includes('DEMO INPUT')&&reportText.includes('READ-ONLY'),label+' executes a real local review with cited evidence');
   check(reportText.includes('Uncertainty and review limits')&&reportText.includes('No changes were made'),label+' states uncertainty and makes no changes');
   await page.locator('#office-panel').getByRole('link',{name:/^View latest job’s workflow/}).click();await page.waitForURL(/\/workflow\?workspace=.*&job=/);
   const workflowUrl=page.url(),jobId=new URL(workflowUrl).searchParams.get('job');
   await page.getByRole('region',{name:reportLabel,exact:true}).waitFor();
   check((await page.locator('.workflow-decisions').innerText()).includes(role),label+' saved history records Dispatcher assignment');
   await page.reload();await page.getByRole('region',{name:reportLabel,exact:true}).waitFor();
   assert.equal(await page.getByRole('region',{name:reportLabel,exact:true}).innerText(),reportText);
   check(true,label+' report reopens unchanged after reload');
   check((await other.request.get(base+`/api/workspaces/${ws}`)).status()===404,label+' office is hidden from another account');
   check((await other.request.get(base+`/api/workflow?workspace=${ws}&job=${jobId}`)).status()===404,label+' saved history is private');
   const forbidden=await other.request.post(base+`/api/workspaces/${ws}/agents/${hire.id}/jobs`,{data:{type:id==='software_engineer'?'pull_request_review':'deployment_review',clientRequestId:'forbidden-request-001'}});
   check(forbidden.status()===404,label+' another account cannot assign this worker');
   saved.push(workflowUrl);
   if(shots)await page.screenshot({path:path.join(shots,`${engine}-${width}-${id}.png`),fullPage:true});
  }
  // Reopen the first report after the second review, through the office's history link.
  await page.goto(base+`/office?workspace=${ws}`,{waitUntil:'networkidle'});await page.getByRole('link',{name:/^View workflow history/}).click();await page.waitForURL(/\/workflow\?workspace=/);
  await page.getByRole('navigation',{name:'Saved jobs'}).getByRole('button').nth(1).waitFor();
  check(await page.getByRole('navigation',{name:'Saved jobs'}).getByRole('button').count()===2,`${engine} ${width}px both reports retained in this workspace`);
  await page.goto(saved[0],{waitUntil:'networkidle'});await page.getByRole('region',{name:'Pull request review report',exact:true}).waitFor();
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${engine} ${width}px no horizontal overflow`);
  check(errors.length===0,`${engine} ${width}px no browser exceptions: ${errors.join('; ')}`);
  await ctx.close();await other.close();await browser.close();browser=null;
 }
 console.log(`ALL ${checks} SPECIALIST CHECKS PASSED`);
}catch(e){console.error(log);throw e;}finally{await browser?.close();server.kill('SIGTERM');await once(server,'exit');rmSync(temp,{recursive:true,force:true});}
