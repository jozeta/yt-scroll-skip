// Regenerates the README screenshots in docs/ from the test fixture (a stand-in player, so no
// network and no real YouTube content) and the options page. Run with `npm run screenshots`.
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = readFileSync(path.join(root, 'test/fixture.html'), 'utf8');
const out = path.join(root, 'docs');
mkdirSync(out, { recursive: true });

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  viewport: { width: 640, height: 360 },
  deviceScaleFactor: 2,
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await context.route(/^https?:\/\/www\.youtube\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: fixture }),
  );

  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=demo');
  await page.evaluate(() => window.ready);
  // Dress the fake player up a little: hide the test-only menu, give the video a backdrop.
  await page.addStyleTag({
    content: `.ytp-settings-menu { display: none; }
      #movie_player { background: radial-gradient(circle at 30% 40%, #3a4a6b, #0d1117 70%); }`,
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => (document.getElementById('main').currentTime = 32));
  await page.mouse.move(320, 180);
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(350); // > GESTURE_GAP_MS: two skips that add up to +20s
  }
  await page.locator('#movie_player').screenshot({ path: path.join(out, 'toast.png') });

  const id = new URL(worker.url()).host;
  await page.setViewportSize({ width: 440, height: 200 });
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.waitForFunction(() => document.getElementById('skipForward').value !== '');
  await page.screenshot({ path: path.join(out, 'options.png'), fullPage: true });
  console.log('wrote docs/toast.png and docs/options.png');
} finally {
  await context.close();
}
