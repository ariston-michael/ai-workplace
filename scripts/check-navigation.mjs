// Production browser regression: stable navigation, history and office hiring context.
// Uses a disposable database and SDK-encrypted fixture sessions; no real account/provider calls.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, webkit } from 'playwright';

const root = process.cwd();
const temp = mkdtempSync(path.join(tmpdir(), 'workplace-navigation-'));
const socket = createServer().listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const secret = randomBytes(32).toString('hex');
const { encrypt } = await import(pathToFileURL(path.join(root, 'node_modules/@auth0/nextjs-auth0/dist/server/cookies.js')));
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port), '--hostname', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    AUTH0_DOMAIN: 'fixture.invalid', AUTH0_CLIENT_ID: 'fixture', AUTH0_CLIENT_SECRET: 'fixture', AUTH0_SECRET: secret,
    APP_BASE_URL: base, WORKPLACE_DB_PATH: path.join(temp, 'navigation.db'), WORKPLACE_DEMO_OWNER_EMAIL: '',
    PROCUREMENT_MODE: 'sample', GEMINI_API_KEY: '', TINYFISH_API_KEY: '', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '',
  },
});
let logs = '', checks = 0;
server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
const check = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`); };
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(base + '/api/workspaces')).status === 401) break; } catch {}
    if (i > 100 || server.exitCode !== null) throw new Error(`Server failed: ${logs}`);
    await delay(100);
  }
  for (const [engine, type] of [['WebKit', webkit], ['Chromium', chromium]]) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await type.launch(engine === 'Chromium' && existsSync(chrome) ? { executablePath: chrome } : {});
    for (const width of [1440, 768, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const now = Math.floor(Date.now() / 1000);
      const value = await encrypt({ user: { sub: `auth0|nav-${engine}-${width}`, name: 'Navigation tester' }, tokenSet: { accessToken: 'fixture', expiresAt: now + 3600 }, internal: { sid: 'nav', createdAt: now } }, secret, now + 3600);
      await context.addCookies([{ name: '__session', value, url: base, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage(); page.setDefaultTimeout(10000); const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const label = `${engine} ${width}px`;
      const nav = page.getByRole('navigation', { name: 'Main' });
      async function snapshot(active) {
        await page.waitForFunction(() => document.querySelector('.app-headerIdentity'));
        assert.deepEqual(await nav.getByRole('link').allTextContents(), ['Workspaces', 'Marketplace']);
        assert.equal(await nav.locator('[aria-current="page"]').innerText(), active);
        const boxes = await nav.getByRole('link').evaluateAll(links => links.map(link => { const r = link.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        return boxes;
      }
      function stable(actual, expected) {
        actual.forEach((box, i) => box.forEach((n, j) => assert.ok(Math.abs(n - expected[i][j]) <= 1, `${label} link ${i} dimension ${j} shifted: ${n} vs ${expected[i][j]}`)));
      }
      await page.goto(base + '/');
      const original = await snapshot('Workspaces');
      check(await page.getByRole('link', { name: /Browse the marketplace/ }).count() === 0, `${label}: duplicate general CTA removed`);
      await nav.getByRole('link', { name: 'Marketplace', exact: true }).click();
      await page.waitForURL(base + '/marketplace');
      stable(await snapshot('Marketplace'), original);
      check(true, `${label}: labels and link geometry stay fixed on navigation`);
      await page.goBack(); await page.waitForURL(base + '/'); stable(await snapshot('Workspaces'), original);
      await page.goForward(); await page.waitForURL(base + '/marketplace'); stable(await snapshot('Marketplace'), original);
      await nav.getByRole('link', { name: 'Workspaces', exact: true }).click();
      await page.waitForURL(base + '/'); stable(await snapshot('Workspaces'), original);
      check(true, `${label}: Back, Forward and return link restore active state`);
      await page.locator('.workspaces-card').first().click();
      await page.waitForURL(/\/office\?workspace=/);
      const ws = new URL(page.url()).searchParams.get('workspace');
      await page.getByRole('button', { name: /Cubicle 02, empty desk/ }).click();
      const contextual = page.locator(`a[href*="/marketplace?"][href*="workspace=${ws}"]`).first();
      await contextual.waitFor();
      await contextual.click(); await page.waitForURL(/\/marketplace\?workspace=/);
      assert.equal(new URL(page.url()).searchParams.get('workspace'), ws);
      await page.getByRole('region', { name: 'Hiring context' }).waitFor();
      await page.locator('.market-card').filter({ has: page.locator('.market-role', { hasText: 'Procurement Researcher' }) }).getByRole('button', { name: /^Hire / }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      assert.equal(await dialog.locator('input[name="workspace"]:checked').inputValue(), ws);
      check(true, `${label}: empty desk keeps office context and preselects hiring destination`);
      check(errors.length === 0, `${label}: no browser page errors`);
      await context.close();
    }
    await browser.close(); browser = null;
  }
  console.log(`ALL ${checks} NAVIGATION CHECKS PASSED`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await once(server, 'exit');
  rmSync(temp, { recursive: true, force: true });
}
