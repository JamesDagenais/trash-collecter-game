/*
 * Browser smoke test. Run with:  node tests/e2e.js
 * Needs Playwright + Chromium (pre-installed in this environment; no npm install).
 *
 * Opens index.html from file:// in a phone-sized viewport and plays a short game.
 * Only relies on the stable hooks: the ids in index.html (#money, #trash, #perTap,
 * #perSecond, #tapButton, #shop, #zones, #resetButton) and the Shop's documented
 * data-id / data-zone attributes, so restyling the page should not break it.
 * Upgrade data is read from TrashGame.UPGRADES in the page, never hard-coded.
 *
 * Steps run in order and stop at the first failure. Exit code 1 on failure.
 * Set HEADED=1 to watch it, E2E_SCREENSHOT=path.png to save a screenshot on failure.
 */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

let chromium;
try {
  ({ chromium } = require('playwright'));

// A buy button is 'disabled' via the disabled attribute or aria-disabled="true" (keeps focus reachable).
} catch (e) {
  console.error('Playwright is not available: ' + e.message);
  process.exit(1);
}

const URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const VIEWPORT = { width: 390, height: 844 };
const TIMEOUT = 5000;

/** "€1,234" / "1.5" / "2.50K" -> number */
function parseNum(text) {
  const t = String(text).replace(/[€,\s]/g, '');
  const m = t.match(/^(-?\d+(?:\.\d+)?)([A-Za-z]*)$/);
  if (!m) return NaN;
  const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  const tier = SUFFIXES.indexOf(m[2]);
  return tier < 0 ? NaN : parseFloat(m[1]) * Math.pow(1000, tier);
}

async function main() {
  const browser = await chromium.launch(process.env.HEADED ? { headless: false } : undefined);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();

  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
  });
  page.on('pageerror', (err) => errors.push('page error: ' + (err.stack || err.message)));

  const read = async (sel) => parseNum(await page.locator(sel).first().textContent());
  const waitFor = (fn, arg, what) =>
    page.waitForFunction(fn, arg, { timeout: TIMEOUT, polling: 'raf' }).catch(() => {
      throw new Error('timed out waiting for: ' + what);
    });
  const tap = () => page.locator('#tapButton').click();

  let passed = 0;
  async function step(name, fn) {
    try {
      await fn();
      if (errors.length) throw new Error('errors in the page:\n      ' + errors.join('\n      '));
      passed++;
      console.log('  ✓ ' + name);
    } catch (e) {
      console.log('  ✗ ' + name + '\n      ' + String(e.message).split('\n').join('\n      '));
      if (process.env.E2E_SCREENSHOT) await page.screenshot({ path: process.env.E2E_SCREENSHOT, fullPage: true }).catch(() => {});
      throw e;
    }
  }

  console.log('Browser smoke test: ' + URL + ` @ ${VIEWPORT.width}x${VIEWPORT.height}\n`);
  let first;
  let perTapBefore;
  let perTapAfter;

  try {
    await step('page loads without errors and shows all stable hooks', async () => {
      await page.goto(URL);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      for (const id of ['money', 'trash', 'perTap', 'perSecond', 'tapButton', 'shop', 'zones', 'resetButton']) {
        if ((await page.locator('#' + id).count()) !== 1) throw new Error(`#${id} missing`);
      }
      await page.locator('#tapButton').waitFor({ state: 'visible', timeout: TIMEOUT });
      first = await page.evaluate(() => {
        const u = window.TrashGame.UPGRADES[0];
        return { id: u.id, cost: Math.ceil(u.baseCost), trashPerTap: u.trashPerTap };
      });
      await waitFor((id) => !!document.querySelector(`#shop [data-id="${id}"]`), first.id, `#shop [data-id="${first.id}"]`);
      await waitFor(() => !!document.querySelector('#zones [data-zone]'), null, '#zones [data-zone]');
      if ((await read('#money')) !== 0) throw new Error('a fresh game should start with €0');
    });

    await step('page fits the phone width (no horizontal scroll)', async () => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) throw new Error(`page is ${overflow}px wider than the viewport`);
    });

    const btn = () => page.locator(`[data-id="${first.id}"]`).first();

    await step('first upgrade is disabled while broke', async () => {
      if ((await read('#money')) >= first.cost) throw new Error(`already have ${await read('#money')} >= ${first.cost}; cannot test "broke"`);
      await page.waitForTimeout(100); // let a few render frames run
      if (!(await btn().evaluate((el) => el.disabled || el.getAttribute('aria-disabled') === 'true'))) throw new Error(`[data-id="${first.id}"] should be disabled`);
    });

    await step('tapping increases money and trash', async () => {
      const m0 = await read('#money');
      const t0 = await read('#trash');
      for (let i = 0; i < 3; i++) await tap();
      await waitFor((m) => parseFloat(document.getElementById('money').textContent.replace(/[^\d.]/g, '')) > m, m0, '#money to increase');
      if (!((await read('#trash')) > t0)) throw new Error('#trash did not increase');
    });

    await step('first upgrade becomes enabled after enough taps', async () => {
      for (let i = 0; i < 5000 && (await read('#money')) < first.cost; i++) await tap();
      if ((await read('#money')) < first.cost) throw new Error(`could not tap up to ${first.cost}`);
      await waitFor((id) => { const el = document.querySelector(`[data-id="${id}"]`); return !(el.disabled || el.getAttribute('aria-disabled') === 'true'); }, first.id, `[data-id="${first.id}"] to be enabled`);
    });

    await step('buying it spends money and raises per-tap', async () => {
      perTapBefore = await read('#perTap');
      const m0 = await read('#money');
      await btn().click();
      if (first.trashPerTap > 0) {
        await waitFor((v) => parseFloat(document.getElementById('perTap').textContent.replace(/[^\d.]/g, '')) > v, perTapBefore, '#perTap to increase');
      } else {
        await waitFor(() => parseFloat(document.getElementById('perSecond').textContent.replace(/[^\d.]/g, '')) > 0, null, '#perSecond to increase');
      }
      perTapAfter = await read('#perTap');
      const m1 = await read('#money');
      if (!(m1 < m0)) throw new Error(`money did not go down (${m0} -> ${m1})`);
    });

    await step('progress survives a reload', async () => {
      const m0 = await read('#money');
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await page.reload();
      await waitFor((id) => !!document.querySelector(`[data-id="${id}"]`), first.id, 'shop after reload');
      await waitFor((v) => parseFloat(document.getElementById('perTap').textContent.replace(/[^\d.]/g, '')) === v, perTapAfter, `#perTap back to ${perTapAfter}`);
      const m1 = await read('#money');
      if (!(m1 >= m0)) throw new Error(`money went from ${m0} to ${m1} across the reload`);
    });

    await step('Reset (confirm accepted) clears progress, also after reload', async () => {
      page.once('dialog', (d) => d.accept());
      await page.locator('#resetButton').click();
      await waitFor(
        (v) => parseFloat(document.getElementById('perTap').textContent.replace(/[^\d.]/g, '')) === v && document.getElementById('money').textContent.replace(/[^\d.]/g, '') === '0',
        perTapBefore,
        'per-tap and money back to a fresh game',
      );
      if ((await read('#trash')) !== 0) throw new Error('#trash not reset');
      await page.reload();
      await waitFor((v) => parseFloat(document.getElementById('perTap').textContent.replace(/[^\d.]/g, '')) === v, perTapBefore, 'per-tap still fresh after reload');
      if ((await read('#money')) !== 0) throw new Error('money came back after reload');
      await waitFor((id) => { const el = document.querySelector(`[data-id="${id}"]`); return el.disabled || el.getAttribute('aria-disabled') === 'true'; }, first.id, 'first upgrade disabled again');
    });

    await step('Reset with confirm dismissed keeps progress', async () => {
      await tap();
      await waitFor(() => document.getElementById('money').textContent.replace(/[^\d.]/g, '') !== '0', null, 'money > 0');
      const m0 = await read('#money');
      page.once('dialog', (d) => d.dismiss());
      await page.locator('#resetButton').click();
      await page.waitForTimeout(100);
      if ((await read('#money')) < m0) throw new Error('dismissing the confirm still reset the game');
    });
  } catch (e) {
    await browser.close();
    console.log(`\n${passed} passed, 1 failed`);
    process.exit(1);
  }

  await browser.close();
  console.log(`\n${passed} passed, 0 failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

