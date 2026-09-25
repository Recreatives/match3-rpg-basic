// Headless runner for tests/index.html (used by .github/workflows/ci.yml).
// Needs `npm install playwright@1` + a served repo root on :8080. Exits 1 if
// any test fails, the suite never finishes, or the runner page itself throws.
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:8080';
const browser = await chromium.launch();
const page = await browser.newPage();
let runnerErrors = 0;
page.on('pageerror', err => { runnerErrors++; console.error('[runner page error]', err.message); });

await page.goto(`${base}/tests/index.html`);
await page.waitForFunction(() => window.__TEST_PASS__ !== undefined, null, { timeout: 180000 });

const results = await page.evaluate(() => window.__TEST_RESULTS__);
let suite = null;
for (const r of results) {
  if (r.suite !== suite) { suite = r.suite; console.log(`\n${suite}`); }
  console.log(`  ${r.pass ? '✓' : '✗'} ${r.name} (${r.ms}ms)${r.pass ? '' : '\n      ' + r.detail.replace(/\n/g, '\n      ')}`);
}
const passed = results.filter(r => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);

const slow = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5);
console.log('Slowest: ' + slow.map(r => `${r.name} ${r.ms}ms`).join(', '));

await browser.close();
if (passed !== results.length || results.length === 0 || runnerErrors) {
  console.error('\nTEST SUITE FAILED');
  process.exit(1);
}
