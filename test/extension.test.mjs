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
const DEFAULTS = {
  enabled: true,
  skipForward: 10,
  skipBack: 10,
  invert: false,
  modifierControls: true,
  toastPosition: 'center',
  toastSize: 'medium',
  showControls: true,
  horizontalSwipe: 'timeline',
  timelineSpan: '25',
};
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
  await worker.evaluate(async (d) => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(d);
  }, DEFAULTS);
  await open();
});

const time = (id = 'main') => page.evaluate((id) => document.getElementById(id).currentTime, id);
const setTime = (t, id = 'main') => page.evaluate(([t, id]) => (document.getElementById(id).currentTime = t), [t, id]);
// The toast's two lines (value, detail) joined as "value · detail", or just the value.
const toastText = () =>
  page.evaluate(() => {
    const t = document.getElementById('ext-yt-scroll-skip-toast');
    if (!t) return null;
    const detail = t.querySelector('.yss-detail');
    const title = t.querySelector('.yss-title').textContent;
    return detail.style.display === 'none' ? title : `${title} · ${detail.textContent}`;
  });

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

// A real recording of a MacBook trackpad in Edge: [ms, deltaX, deltaY, deltaMode] per wheel event.
// 0–3.5 s: one slow left→right swipe across the whole trackpad (713 px in total).
// 4.7–7.7 s: three quick left→right swipes in a row, 75 ms and 92 ms apart, each followed by
// macOS momentum (dy exactly 0, smoothly decaying) until the next swipe's fingers land.
const recording = JSON.parse(readFileSync(path.join(root, 'test/trackpad-recording.json'), 'utf8'));
const SLOW_SWIPE = recording.filter(([t]) => t < 4000);
const QUICK_SWIPES = recording.filter(([t]) => t >= 4000);
const FIRST_QUICK_SWIPE = recording.filter(([t]) => t >= 4000 && t < 5550);

// Replays wheel events into the page at their recorded timing. transform maps [dx, dy], e.g. to
// turn the sideways recording into an up/down swipe.
async function replay(events, transform = (dx, dy) => [dx, dy], at = MAIN) {
  const mapped = events.map(([t, dx, dy, mode]) => [t, ...transform(dx, dy), mode]);
  await page.evaluate(
    async ([events, at]) => {
      const target = document.elementFromPoint(at.x, at.y);
      const start = performance.now() - events[0][0];
      for (const [t, deltaX, deltaY, deltaMode] of events) {
        const wait = start + t - performance.now();
        if (wait > 1) await new Promise((r) => setTimeout(r, wait));
        target.dispatchEvent(
          new WheelEvent('wheel', { deltaX, deltaY, deltaMode, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }),
        );
      }
    },
    [mapped, at],
  );
  await sleep(GAP);
}

test('scroll up skips forward, scroll down skips back, toast shows position', async () => {
  await setTime(30);
  await gesture(MAIN, -100);
  assert.equal(await time(), 40);
  assert.equal(await toastText(), '+10 s · 0:40 / 2:00');
  await sleep(1100); // let the accumulation window lapse
  await gesture(MAIN, 100);
  assert.equal(await time(), 30);
  assert.equal(await toastText(), '−10 s · 0:30 / 2:00');
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
  assert.match(await toastText(), /^\+30 s · /);
});

test('forward skips stop short of the end so autoplay is not triggered', async () => {
  await setTime(115);
  await gesture(MAIN, -100);
  assert.equal(await time(), 119.5);
});

test('the toast shows how far the video actually moved, not the setting', async () => {
  await setTime(115);
  await gesture(MAIN, -100);
  assert.equal(await toastText(), '+4.5 s · 1:59 / 2:00', 'shortened by the end guard');
  await gesture(MAIN, -100);
  assert.equal(await toastText(), '+4.5 s · 1:59 / 2:00', 'nothing more to add at the end');
  await sleep(1100);
  await gesture(MAIN, -100);
  assert.equal(await toastText(), 'End · 1:59 / 2:00');
  await setTime(3);
  await sleep(1100);
  await gesture(MAIN, 100);
  assert.equal(await toastText(), '−3 s · 0:00 / 2:00', 'shortened by the start');
  await gesture(MAIN, 100);
  assert.equal(await toastText(), '−3 s · 0:00 / 2:00');
});

test('the running total starts over when the video changes', async () => {
  await setTime(30);
  await gesture(MAIN, -100);
  assert.match(await toastText(), /^\+10 s/);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const v = document.getElementById('main');
        v.addEventListener('loadedmetadata', resolve, { once: true });
        v.src = silentWav(120); // what YouTube does on navigation: same <video>, new src
      }),
  );
  await setTime(30);
  await gesture(MAIN, -100);
  assert.match(await toastText(), /^\+10 s/, 'not +20 s');
});

test('tiny accidental wheel movements do not skip, but add up within a gesture', async () => {
  await setTime(30);
  await gesture(MAIN, -2); // a resting finger on a Magic Mouse
  assert.equal(await time(), 30);
  assert.equal(await toastText(), null);
  for (let i = 0; i < 6; i++) await wheel(MAIN, 0, -3); // a slow, deliberate trackpad swipe
  await sleep(GAP);
  assert.equal(await time(), 40, 'one skip once it moved far enough');
});

test('forward and back have separate lengths', async () => {
  await setSettings({ skipForward: 15, skipBack: 5 });
  await setTime(30);
  await gesture(MAIN, -100);
  assert.equal(await time(), 45);
  await sleep(1100);
  await gesture(MAIN, 100);
  assert.equal(await time(), 40);
  assert.match(await toastText(), /^−5 s/);
});

test('settings from 1.2.x (one skipSeconds) carry over to both directions on update', async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({ skipSeconds: 20, invert: true });
    await migrateSettings();
  });
  const after = await worker.evaluate(() => chrome.storage.sync.get(null));
  assert.deepEqual(after, { skipForward: 20, skipBack: 20, invert: true });
});

const play = () => page.evaluate(() => document.getElementById('main').play());
// The video keeps playing during a gesture, so measure how far one gesture moved it.
async function movedBy(fn) {
  const before = await time();
  const started = Date.now();
  await fn();
  return (await time()) - before - (Date.now() - started) / 1000; // minus normal playback
}
const approx = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 0.75, `${label}: moved ${actual.toFixed(2)} s, expected ${expected}`);

test('sideways swipe in "skip" mode skips (left→right forward, right→left back)', async () => {
  await setSettings({ horizontalSwipe: 'skip' });
  await setTime(30);
  await play();
  const swipe = (dx) => async () => {
    for (let i = 0; i < 8; i++) await wheel(MAIN, dx, 0); // with momentum
    await sleep(GAP);
  };
  approx(await movedBy(swipe(12)), 10, 'left→right');
  assert.ok((await page.evaluate(() => wheelLog)).every(Boolean), 'all cancelled: no rubber-band or history swipe');
  assert.match(await toastText(), /^\+10 s/);
  await sleep(1100);
  approx(await movedBy(swipe(-12)), -10, 'right→left');
});

test('a wobbly, mostly sideways swipe is one skip in its overall direction', async () => {
  await setSettings({ horizontalSwipe: 'skip' });
  await setTime(30);
  await play();
  const moved = await movedBy(async () => {
    // The second event is mostly vertical (down = back) and crosses the threshold.
    for (const [dx, dy] of [[10, 3], [4, 9], [12, 2], [8, 8], [9, 1]]) await wheel(MAIN, dx, dy);
    await sleep(GAP);
  });
  approx(moved, 10, 'forward, once');
});

test('invert direction also flips sideways swipes', async () => {
  await setSettings({ invert: true, horizontalSwipe: 'skip' });
  await setTime(30);
  await play();
  approx(await movedBy(() => gesture(MAIN, 0, 100)), -10, 'inverted: left→right goes back');
});

// --- Real trackpad recording ---

test('trackpad: three quick swipes in a row are three skips, not one (momentum gap)', async () => {
  // Up/down version of the recording: the same timing and momentum, as a vertical swipe up.
  await setTime(30);
  await replay(QUICK_SWIPES, (dx, dy) => [dy, -dx]);
  assert.equal(await time(), 60);
  assert.match(await toastText(), /^\+30 s/);
});

test('trackpad: quick sideways swipes in "skip" mode are three skips', async () => {
  await setSettings({ horizontalSwipe: 'skip' });
  await setTime(30);
  await play(); // paused, sideways swipes would step frames instead
  approx(await movedBy(() => replay(QUICK_SWIPES)), 30, 'three skips');
});

test('scrolling wakes YouTube\'s own control bar (throttled), unless turned off', async () => {
  const wakes = () => page.evaluate(() => controlWakes);
  await setTime(30);
  await gesture(MAIN, -100);
  assert.equal(await wakes(), 1, 'a skip shows YouTube\'s controls');
  for (let i = 0; i < 12; i++) await wheel(MAIN, 30, 0); // ~0.6 s of scrubbing
  await sleep(GAP);
  const during = (await wakes()) - 1;
  assert.ok(during >= 2 && during <= 4, `kept awake while scrubbing, but throttled: ${during}`);

  await setSettings({ showControls: false });
  await sleep(300);
  const before = await wakes();
  await gesture(MAIN, -100);
  assert.equal(await wakes(), before, 'off: no synthetic mouse moves');
});

test('defaults on a fresh install: sideways swipes are a timeline at 25 % per full swipe', async () => {
  await worker.evaluate(() => chrome.storage.sync.clear()); // nothing stored: defaults.js applies
  await open();
  await setTime(30);
  for (let i = 0; i < 5; i++) await wheel(MAIN, 70, 0); // 350 px = half the trackpad
  await sleep(GAP);
  assert.ok(Math.abs((await time()) - 45) < 0.5, `half a swipe = 12.5 % of 2:00 = 15 s, at ${await time()}`);
  assert.ok((await page.evaluate(() => controlWakes)) > 0, 'YouTube\'s controls are shown by default');
  const gap = await page.evaluate(() => {
    const t = document.getElementById('ext-yt-scroll-skip-toast').getBoundingClientRect();
    const p = document.getElementById('movie_player').getBoundingClientRect();
    return t.top - p.top - (p.bottom - t.bottom);
  });
  assert.ok(Math.abs(gap) < 2, 'the overlay is centred by default, clear of YouTube\'s control bar');
});

test('timeline: at 100 %, a full slow swipe across the trackpad covers the whole video', async () => {
  await setSettings({ timelineSpan: '100' });
  await setTime(0);
  await replay(SLOW_SWIPE);
  assert.equal(await time(), 119.5, 'to the end (minus the end guard)');
  assert.match(await toastText(), /^\+1:59 · 1:59 \/ 2:00$/);
});

test('timeline: sensitivity sets how much of the video a full swipe covers (100–10 %)', async () => {
  for (const percent of [75, 50, 25, 10]) {
    await setSettings({ timelineSpan: String(percent) });
    await setTime(10);
    await replay(SLOW_SWIPE);
    const expected = 10 + 120 * (percent / 100) * (713 / 700); // the slow swipe was 713 px
    const t = await time();
    assert.ok(Math.abs(t - expected) < 2, `${percent} %: at ${t.toFixed(1)} s, expected ${expected.toFixed(1)}`);
    await sleep(1100);
  }
});

test('timeline: scrubbing stops when the fingers lift (momentum is ignored)', async () => {
  await setSettings({ timelineSpan: '10' }); // 12 s per full swipe on this 2-minute video
  await setTime(30);
  await replay(FIRST_QUICK_SWIPE);
  const moved = (await time()) - 30;
  // Fingers: ~550 px ≈ 9.4 s. With momentum (2368 px) it would be ~40 s.
  assert.ok(moved > 8 && moved < 12, `moved ${moved.toFixed(1)} s`);
});

test('timeline: swipes scrub both ways, paused or playing, and invert flips it', async () => {
  await setSettings({ timelineSpan: '100' });
  await setTime(30);
  for (let i = 0; i < 5; i++) await wheel(MAIN, 70, 0); // 350 px = half the trackpad
  await sleep(GAP);
  assert.ok(Math.abs((await time()) - 90) < 0.5, 'half the trackpad = half the video forward');
  assert.equal(await toastText(), '+1:00 · 1:30 / 2:00');
  for (let i = 0; i < 5; i++) await wheel(MAIN, -35, 0);
  await sleep(GAP);
  assert.ok(Math.abs((await time()) - 60) < 0.5, 'back a quarter');

  await setSettings({ invert: true });
  for (let i = 0; i < 5; i++) await wheel(MAIN, 35, 0);
  await sleep(GAP);
  assert.ok(Math.abs((await time()) - 30) < 0.5, 'inverted: left→right goes back');
  assert.ok(await page.evaluate(() => document.getElementById('main').paused), 'still paused');
});

test('timeline: up/down swipes and mouse wheels still skip', async () => {
  await setTime(30);
  await gesture(MAIN, -100);
  assert.equal(await time(), 40);
});

test('with sideways swipes off, they are passed through while playing (browser back/forward)', async () => {
  await setSettings({ horizontalSwipe: 'off' });
  await setTime(30);
  await play();
  await gesture(MAIN, 0, 100);
  assert.deepEqual(await page.evaluate(() => wheelLog), [false]);
  assert.ok((await time()) < 39, 'no skip');
});

test('horizontal swipe while paused steps one frame (outside timeline mode)', async () => {
  await setSettings({ horizontalSwipe: 'skip' });
  await setTime(30);
  await gesture(MAIN, 0, 100);
  assert.ok(Math.abs((await time()) - (30 + 1 / 30)) < 0.01);
  assert.match(await toastText(), /^Next frame · 0:30 \/ 2:00$/);
});

test('frame steps stay inside the video and stop short of the end', async () => {
  await setSettings({ horizontalSwipe: 'skip' });
  await setTime(119.6);
  await gesture(MAIN, 0, 100);
  assert.equal(await time(), 119.6, 'no step into the end (autoplay)');
  await setTime(0.01);
  await gesture(MAIN, 0, -100);
  assert.equal(await time(), 0);
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
  assert.equal(await toastText(), '55 % · Volume');
  await withKey('Alt', () => gesture(MAIN, 100));
  assert.deepEqual((await apiCalls()).at(-1), ['setVolume', 50]);
  assert.equal(await page.evaluate(() => 'yssResult' in document.getElementById('movie_player').dataset), false);
});

test('pressing a modifier mid-gesture starts a new gesture instead of being swallowed', async () => {
  await setTime(30);
  await wheel(MAIN, 0, -40); // skip
  await withKey('Alt', async () => {
    await wheel(MAIN, 0, -40); // still inside the gap, but a different action
    await wheel(MAIN, 0, -40); // same action again: same gesture, no second step
  });
  await sleep(GAP);
  assert.equal(await time(), 40);
  assert.deepEqual(await apiCalls(), [['setVolume', 55]]);
});

test('raising the volume while muted unmutes through the API', async () => {
  await page.evaluate(() => document.getElementById('movie_player').mute());
  await withKey('Alt', () => gesture(MAIN, -100));
  assert.deepEqual(await apiCalls(), [['setVolume', 55], ['unMute']]);
});

test('Shift+scroll changes speed through the API within YouTube\'s range', async () => {
  await withKey('Shift', () => gesture(MAIN, -100));
  assert.deepEqual(await apiCalls(), [['setPlaybackRate', 1.25]]);
  assert.equal(await toastText(), '1.25× · Speed');
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
  assert.equal(await toastText(), '1.25× · Speed');
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
  await setSettings({ skipForward: 5, invert: true });
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
  await page.waitForFunction(() => document.getElementById('skipForward').value !== '');
}

test('options page shows the stored settings', async () => {
  await worker.evaluate(() => chrome.storage.sync.set({ skipForward: 15, invert: true, modifierControls: false }));
  await openOptions();
  const values = await page.evaluate(() => ({
    enabled: document.getElementById('enabled').checked,
    skipForward: document.getElementById('skipForward').value,
    invert: document.getElementById('invert').checked,
    modifierControls: document.getElementById('modifierControls').checked,
  }));
  assert.deepEqual(values, { enabled: true, skipForward: '15', invert: true, modifierControls: false });
});

test('options page saves checkbox, number and select changes', async () => {
  await openOptions();
  await page.selectOption('#toastPosition', 'top');
  await page.selectOption('#toastSize', 'x-large');
  await page.fill('#skipBack', '5');
  await page.press('#skipBack', 'Tab');
  await page.click('#invert');
  await page.selectOption('#horizontalSwipe', 'skip');
  await page.selectOption('#timelineSpan', '75');
  await page.click('#showControls');
  await page.fill('#skipForward', '25');
  await page.press('#skipForward', 'Tab'); // fires "change"
  await page.waitForTimeout(150);
  assert.equal((await stored()).invert, true);
  const saved = await stored();
  assert.equal(saved.skipForward, 25);
  assert.equal(saved.skipBack, 5);
  assert.equal(saved.toastPosition, 'top');
  assert.equal(saved.toastSize, 'x-large');
  assert.equal(saved.horizontalSwipe, 'skip');
  assert.equal(saved.timelineSpan, '75');
  assert.equal(saved.showControls, false);
  assert.equal(await page.textContent('#status'), 'Saved');
});

test('options page rejects out-of-range skip lengths and keeps the previous value', async () => {
  await worker.evaluate(() => chrome.storage.sync.set({ skipForward: 15 }));
  await openOptions();
  for (const bad of ['0', '9999', '-5', '']) {
    await page.fill('#skipForward', bad);
    await page.press('#skipForward', 'Tab');
    await page.waitForTimeout(100);
    assert.equal((await stored()).skipForward, 15, `"${bad}" keeps the previous value`);
    assert.equal(await page.inputValue('#skipForward'), '15');
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
    const t = document.getElementById('ext-yt-scroll-skip-toast');
    return { parent: t.parentElement.id, role: t.getAttribute('role'), live: t.getAttribute('aria-live') };
  });
  assert.deepEqual(info, { parent: 'movie_player', role: 'status', live: 'polite' });
});

test('the toast has a progress bar: position for skips, level for volume, none for speed', async () => {
  const bar = () =>
    page.evaluate(() => {
      const track = document.querySelector('#ext-yt-scroll-skip-toast .yss-progress');
      if (track.style.display === 'none') return null;
      return Math.round((track.firstChild.getBoundingClientRect().width / track.getBoundingClientRect().width) * 100);
    });
  await setTime(50);
  await gesture(MAIN, -100);
  assert.equal(await bar(), 50, '60 s of 120 s');
  await withKey('Alt', () => gesture(MAIN, -100));
  assert.equal(await bar(), 55, 'volume 55 %');
  await withKey('Shift', () => gesture(MAIN, -100));
  assert.equal(await bar(), null);
});

test('overlay position and size settings', async () => {
  const box = () =>
    page.evaluate(() => {
      const t = document.getElementById('ext-yt-scroll-skip-toast').getBoundingClientRect();
      const p = document.getElementById('movie_player').getBoundingClientRect();
      return { top: t.top - p.top, bottom: p.bottom - t.bottom, width: t.width };
    });
  await gesture(MAIN, -100);
  const medium = await box();
  assert.ok(Math.abs(medium.top - medium.bottom) < 2, 'centred by default (clear of YouTube\'s control bar)');

  await setSettings({ toastPosition: 'bottom' });
  await gesture(MAIN, -100);
  const bottom = await box();
  assert.ok(bottom.bottom < bottom.top, 'bottom');

  await setSettings({ toastPosition: 'top', toastSize: 'large' });
  await gesture(MAIN, -100);
  const large = await box();
  assert.ok(large.top < large.bottom, 'top');
  assert.ok(Math.abs(large.width / medium.width - 1.3) < 0.02, 'large is 1.3×');

  await setSettings({ toastPosition: 'center', toastSize: 'small' });
  await gesture(MAIN, -100);
  const small = await box();
  assert.ok(Math.abs(small.top - small.bottom) < 2, 'centred');
  assert.ok(Math.abs(small.width / medium.width - 0.8) < 0.02, 'small is 0.8×');

  for (const [size, scale] of [['x-small', 0.65], ['x-large', 1.6]]) {
    await setSettings({ toastSize: size });
    await gesture(MAIN, -100);
    assert.ok(Math.abs((await box()).width / medium.width - scale) < 0.02, `${size} is ${scale}×`);
  }
});

test('toast design: no icons, grey translucent panel with a thin light border', async () => {
  await gesture(MAIN, -100);
  const look = await page.evaluate(() => {
    const t = document.getElementById('ext-yt-scroll-skip-toast');
    const cs = getComputedStyle(t);
    return {
      text: t.textContent,
      background: cs.backgroundColor,
      border: `${cs.borderTopWidth} ${cs.borderTopStyle}`,
      borderColor: cs.borderTopColor,
    };
  });
  assert.doesNotMatch(look.text, /\p{Extended_Pictographic}/u, 'no emoji icons');
  const [r, g, b, a] = look.background.match(/[\d.]+/g).map(Number);
  assert.ok(Math.abs(r - g) < 10 && Math.abs(g - b) < 10, `grey background (${look.background})`);
  assert.ok(a > 0 && a < 1, 'semi-transparent');
  assert.equal(look.border, '1px solid');
  assert.ok(look.borderColor.match(/[\d.]+/g).slice(0, 3).every((c) => Number(c) > 200), 'light border');
});

test('in fullscreen the toast renders inside the fullscreen element', async () => {
  await page.mouse.click(MAIN.x, MAIN.y); // user activation for requestFullscreen
  await page.evaluate(() => document.getElementById('movie_player').requestFullscreen());
  await page.waitForTimeout(300);
  await gesture(MAIN, -100);
  assert.ok(await page.evaluate(() => document.fullscreenElement.contains(document.getElementById('ext-yt-scroll-skip-toast'))));
  await page.evaluate(() => document.exitFullscreen());
});
