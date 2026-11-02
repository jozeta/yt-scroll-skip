// End-to-end tests: load the unpacked extension into Playwright's Chromium and drive real wheel
// events over test/fixture.html, served at www.youtube.com URLs so the content script injects.
// Run with `npm test`.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = readFileSync(path.join(root, 'test/fixture.html'), 'utf8');
const DEFAULTS = { enabled: true, skipSeconds: 10, invert: false, modifierControls: true };
const GAP = 300; // > GESTURE_GAP_MS, so the next wheel starts a new gesture
const MAIN = { x: 200, y: 200 }; // over #movie_player's video
const MENU = { x: 560, y: 50 }; // over the settings menu inside the player
const PREVIEW = { x: 100, y: 450 }; // over the inline hover preview

let context, worker, page;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', // the new headless mode, which supports extensions
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--autoplay-policy=no-user-gesture-required'],
    viewport: { width: 1000, height: 700 },
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await context.route(/^https?:\/\/www\.youtube\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: fixture }),
  );
});

after(() => context?.close());

async function open(url = 'https://www.youtube.com/watch?v=test') {
  await page?.close();
  page = await context.newPage();
  await page.goto(url);
  await page.evaluate(() => window.ready);
  await page.waitForTimeout(150); // content script (document_idle) + storage read
}

beforeEach(async () => {
  await worker.evaluate((d) => chrome.storage.sync.set(d), DEFAULTS);
  await open();
});

const time = (id = 'main') => page.evaluate((id) => document.getElementById(id).currentTime, id);
const setTime = (t, id = 'main') => page.evaluate(([t, id]) => (document.getElementById(id).currentTime = t), [t, id]);
const toastText = () => page.evaluate(() => document.getElementById('yt-scroll-skip-toast')?.textContent ?? null);

async function wheel(at, dx, dy) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(dx, dy);
  await page.waitForTimeout(50);
}
// One gesture, then wait long enough for it to end.
async function gesture(at, dy, dx = 0) {
  await wheel(at, dx, dy);
  await sleep(GAP);
}
async function setSettings(values) {
  await worker.evaluate((v) => chrome.storage.sync.set(v), values);
  await page.waitForTimeout(100);
}

test('scroll up skips forward, scroll down skips back, toast shows position', async () => {
  await setTime(30);
  await gesture(MAIN, -100);
  assert.equal(await time(), 40);
  assert.equal(await toastText(), '⏩ +10s · 0:40 / 2:00');
  await sleep(1100); // let the accumulation window lapse
  await gesture(MAIN, 100);
  assert.equal(await time(), 30);
  assert.equal(await toastText(), '⏪ −10s · 0:30 / 2:00');
});

test('a burst of wheel events (trackpad momentum) is one skip and never scrolls the page', async () => {
  await setTime(30);
  for (let i = 0; i < 12; i++) await wheel(MAIN, 0, -40);
  await sleep(GAP);
  assert.equal(await time(), 40);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  assert.ok((await page.evaluate(() => wheelLog)).every(Boolean), 'every event over the player is cancelled');
});

test('quick repeated skips add up in the toast', async () => {
  await setTime(30);
  await gesture(MAIN, -100);
  await gesture(MAIN, -100);
  await gesture(MAIN, -100);
  assert.equal(await time(), 60);
  assert.match(await toastText(), /^⏩ \+30s/);
});

test('forward skips stop short of the end so autoplay is not triggered', async () => {
  await setTime(115);
  await gesture(MAIN, -100);
  assert.equal(await time(), 119.5);
});

test('horizontal swipe while playing is passed through', async () => {
  await setTime(30);
  await page.evaluate(() => document.getElementById('main').play());
  await gesture(MAIN, 0, 100);
  assert.deepEqual(await page.evaluate(() => wheelLog), [false]);
  assert.ok((await time()) < 39, 'no skip');
});

test('horizontal swipe while paused steps one frame', async () => {
  await setTime(30);
  await gesture(MAIN, 0, 100);
  assert.ok(Math.abs((await time()) - (30 + 1 / 30)) < 0.01);
  assert.match(await toastText(), /1 frame/);
});

test('Ctrl+scroll is never intercepted', async () => {
  await setTime(30);
  await page.keyboard.down('Control');
  await gesture(MAIN, -100);
  await page.keyboard.up('Control');
  assert.equal(await time(), 30);
});

async function withKey(key, fn) {
  await page.keyboard.down(key);
  try {
    await fn();
  } finally {
    await page.keyboard.up(key);
  }
}
const video = (prop) => page.evaluate((p) => document.getElementById('main')[p], prop);
const apiCalls = () => page.evaluate(() => apiCalls);

test('Alt+scroll changes volume through YouTube\'s player API (so its slider updates)', async () => {
  await withKey('Alt', () => gesture(MAIN, -100));
  assert.deepEqual(await apiCalls(), [['setVolume', 55]]);
  assert.equal(await toastText(), '🔊 55%');
  await withKey('Alt', () => gesture(MAIN, 100));
  assert.deepEqual((await apiCalls()).at(-1), ['setVolume', 50]);
  assert.equal(await page.evaluate(() => 'yssResult' in document.getElementById('movie_player').dataset), false);
});

test('raising the volume while muted unmutes through the API', async () => {
  await page.evaluate(() => document.getElementById('movie_player').mute());
  await withKey('Alt', () => gesture(MAIN, -100));
  assert.deepEqual(await apiCalls(), [['setVolume', 55], ['unMute']]);
});

test('Shift+scroll changes speed through the API within YouTube\'s range', async () => {
  await withKey('Shift', () => gesture(MAIN, -100));
  assert.deepEqual(await apiCalls(), [['setPlaybackRate', 1.25]]);
  assert.equal(await toastText(), '⏱ 1.25×');
});

test('speeds beyond YouTube\'s range fall back to the <video> element', async () => {
  await page.evaluate(() => (document.getElementById('main').playbackRate = 2));
  await withKey('Shift', () => gesture(MAIN, -100));
  assert.deepEqual(await apiCalls(), []);
  assert.equal(await video('playbackRate'), 2.25);
  await withKey('Shift', () => gesture(MAIN, 100)); // back inside the range: API again
  assert.deepEqual(await apiCalls(), [['setPlaybackRate', 2]]);
});

test('without the player API, volume and speed change the <video> directly', async () => {
  await page.evaluate(() => {
    removePlayerApi();
    document.getElementById('main').volume = 0.5;
  });
  await withKey('Alt', () => gesture(MAIN, -100));
  assert.equal(await video('volume'), 0.55);
  await withKey('Shift', () => gesture(MAIN, -100));
  assert.equal(await video('playbackRate'), 1.25);
  assert.equal(await toastText(), '⏱ 1.25×');
});

test('scrolling the settings menu scrolls the menu, not the video', async () => {
  await setTime(30);
  await gesture(MENU, 100);
  assert.equal(await time(), 30);
  assert.ok((await page.evaluate(() => document.querySelector('.ytp-settings-menu').scrollTop)) > 0);
});

test('hover previews are ignored and the page still scrolls', async () => {
  await setTime(30);
  await setTime(30, 'preview');
  await gesture(PREVIEW, 100);
  assert.equal(await time(), 30);
  assert.equal(await time('preview'), 30);
  assert.deepEqual(await page.evaluate(() => wheelLog), [false]);
});

// Covers the player at MAIN with a body-level layer, like YouTube's current embed controls.
const addOverlay = (attrs) =>
  page.evaluate((attrs) => {
    const r = document.getElementById('movie_player').getBoundingClientRect();
    const el = document.createElement('div');
    Object.assign(el, attrs);
    el.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:10`;
    document.body.appendChild(el);
  }, attrs);

test('embeds: scrolling over the separate #player-controls layer still skips', async () => {
  await addOverlay({ id: 'player-controls' });
  await setTime(30);
  await gesture(MAIN, -100);
  assert.equal(await time(), 40);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
});

test('other layers over the player (e.g. dialogs) are left alone', async () => {
  await addOverlay({ id: 'some-dialog' });
  await setTime(30);
  await gesture(MAIN, -100);
  assert.equal(await time(), 30);
  assert.deepEqual(await page.evaluate(() => wheelLog), [false]);
});

test('no skipping while an ad is showing', async () => {
  await setTime(30);
  await page.evaluate(() => document.getElementById('movie_player').classList.add('ad-showing'));
  await gesture(MAIN, -100);
  assert.equal(await time(), 30);
});

test('/shorts/ pages are left alone', async () => {
  await open('https://www.youtube.com/shorts/test');
  await setTime(30);
  await gesture(MAIN, -100);
  assert.equal(await time(), 30);
});

test('settings: skip length, invert and the on/off switch apply live', async () => {
  await setTime(30);
  await setSettings({ skipSeconds: 5, invert: true });
  await gesture(MAIN, 100); // inverted: down = forward
  assert.equal(await time(), 35);

  await setSettings({ enabled: false });
  await gesture(MAIN, 100);
  assert.equal(await time(), 35);
});

test('clicking the toolbar icon toggles enabled and the badge', async () => {
  // Playwright can't click the browser toolbar, so check the click listener is wired up and run
  // the exact function it calls.
  assert.equal(await worker.evaluate(() => chrome.action.onClicked.hasListeners()), true);
  assert.equal(await worker.evaluate(() => toggleEnabled()), false);
  await sleep(100);
  assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), 'OFF');
  await setTime(30);
  await gesture(MAIN, -100);
  assert.equal(await time(), 30, 'disabled: no skip');

  assert.equal(await worker.evaluate(() => toggleEnabled()), true);
  await sleep(100);
  assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), '');
  await gesture(MAIN, -100);
  assert.equal(await time(), 40, 'enabled again: skips');
});

// --- Options page ---

const stored = () => worker.evaluate(() => chrome.storage.sync.get(null));

async function openOptions() {
  const id = new URL(worker.url()).host;
  await page.close();
  page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.waitForFunction(() => document.getElementById('skipSeconds').value !== '');
}

test('options page shows the stored settings', async () => {
  await worker.evaluate(() => chrome.storage.sync.set({ skipSeconds: 15, invert: true, modifierControls: false }));
  await openOptions();
  const values = await page.evaluate(() => ({
    enabled: document.getElementById('enabled').checked,
    skipSeconds: document.getElementById('skipSeconds').value,
    invert: document.getElementById('invert').checked,
    modifierControls: document.getElementById('modifierControls').checked,
  }));
  assert.deepEqual(values, { enabled: true, skipSeconds: '15', invert: true, modifierControls: false });
});

test('options page saves checkbox and number changes', async () => {
  await openOptions();
  await page.click('#invert');
  await page.fill('#skipSeconds', '25');
  await page.press('#skipSeconds', 'Tab'); // fires "change"
  await page.waitForTimeout(150);
  assert.equal((await stored()).invert, true);
  assert.equal((await stored()).skipSeconds, 25);
  assert.equal(await page.textContent('#status'), 'Saved');
});

test('options page rejects out-of-range skip lengths', async () => {
  await openOptions();
  for (const bad of ['0', '9999', '-5']) {
    await page.fill('#skipSeconds', bad);
    await page.press('#skipSeconds', 'Tab');
    await page.waitForTimeout(100);
    assert.equal((await stored()).skipSeconds, 10, `${bad} falls back to the default`);
    assert.equal(await page.inputValue('#skipSeconds'), '10');
  }
});

test('options page follows changes made elsewhere (toolbar toggle)', async () => {
  await openOptions();
  await worker.evaluate(() => toggleEnabled());
  await page.waitForFunction(() => !document.getElementById('enabled').checked);
});

test('toast sits inside the player and is announced to screen readers', async () => {
  await gesture(MAIN, -100);
  const info = await page.evaluate(() => {
    const t = document.getElementById('yt-scroll-skip-toast');
    return { parent: t.parentElement.id, role: t.getAttribute('role'), live: t.getAttribute('aria-live') };
  });
  assert.deepEqual(info, { parent: 'movie_player', role: 'status', live: 'polite' });
});

test('in fullscreen the toast renders inside the fullscreen element', async () => {
  await page.mouse.click(MAIN.x, MAIN.y); // user activation for requestFullscreen
  await page.evaluate(() => document.getElementById('movie_player').requestFullscreen());
  await page.waitForTimeout(300);
  await gesture(MAIN, -100);
  assert.ok(await page.evaluate(() => document.fullscreenElement.contains(document.getElementById('yt-scroll-skip-toast'))));
  await page.evaluate(() => document.exitFullscreen());
});
