# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

YouTube Scroll to Skip: a small Chrome/Firefox (Manifest V3) extension. Scrolling up over a YouTube
player skips forward (10 s by default) and scrolling down skips back, with a toast over the player
(`⏩ +10s · 0:40 / 2:00`). It has settings, a toolbar on/off toggle and modifier controls. Its only
permission is `storage`. No network, no build step for the extension itself.

## Running and testing

- Load: `chrome://extensions` → Developer mode → **Load unpacked** → this folder. After editing,
  click the reload icon on the extension card and refresh YouTube tabs.
- Tests: `npm install` once, then `npm test`. These are Playwright end-to-end tests
  (`test/extension.test.mjs`): they load the real unpacked extension into headless Chromium and
  serve `test/fixture.html` (a fake `#movie_player` with a generated silent WAV) at
  `www.youtube.com` URLs, so the content script injects as it does on YouTube.
  It also covers the options page and the toolbar toggle (via the global `toggleEnabled()`).
  Add a test for every behaviour change. CI (`.github/workflows/test.yml`) runs the suite on
  pushes to `main` and on PRs.
- Still check by hand on real YouTube: normal video, fullscreen, an embed, an ad, a live stream,
  `/shorts/`, the home feed (hover previews) and a trackpad swipe.
- Screenshots: `npm run screenshots` regenerates `docs/toast.png` and `docs/options.png` from
  the fixture. Rerun it when the toast or the options page changes.
- Release: `npm run package` → `dist/yt-scroll-skip-<version>.zip` (runtime files only). Bump
  `version` in `manifest.json` first.

## Code

- `manifest.json`: content scripts `defaults.js` + `content.js` on `www.youtube.com`,
  `m.youtube.com`, `music.youtube.com` and `www.youtube-nocookie.com`, `all_frames: true`,
  `document_idle`. The background has both `service_worker` (Chrome) and `scripts` (Firefox),
  which is deliberate. `browser_specific_settings.gecko` is for Firefox.
- `defaults.js`: `YSS_DEFAULTS` (`enabled`, `skipSeconds`, `invert`, `modifierControls`), shared
  by `content.js` and `options.js`. Settings live in `chrome.storage.sync`.
- `content.js`: tuning constants at the top (`GESTURE_GAP_MS`, `ACCUMULATE_MS`,
  `END_GUARD_SECONDS`, steps). A capture-phase `wheel` listener:
  `findTarget` (player and video under the cursor) → `classify` (skip, volume, speed or frame, or
  null to pass the event through) → `preventDefault()` → act on the first event of a gesture.
  Settings update live through `storage.onChanged`.
- `page-bridge.js`: a MAIN-world content script. `content.js` dispatches a cancelable
  `yss-command` CustomEvent (detail = JSON string) on the player. The bridge calls YouTube's
  player API, writes `data-yss-result` (JSON), and cancels the event to mean "handled". If the
  event isn't cancelled, `content.js` falls back to setting the `<video>` directly. Only strings
  and DOM state cross between worlds.
- `background.js`: `toggleEnabled()` (the toolbar click handler) flips `enabled`; the badge
  shows `OFF`.
- `options.html` / `options.js`: the options page, which saves on change.

## Behaviour to preserve

- Ctrl/Cmd + scroll is never intercepted (zoom).
- `/shorts/` pages are left alone (native next-Short gesture).
- No skipping while the player is inside `.ad-showing`.
- Volume and speed go through YouTube's API when possible (keeps its UI in sync). Skips still
  set `video.currentTime` (the owner chose this; don't switch to `seekTo`).
- Seek the video inside the player under the cursor, never a global `<video>` lookup. Scrolls over
  player popups (`.ytp-popup`, `.ytp-settings-menu`, `.ytp-panel-menu`) and inline hover previews
  (`#inline-player`, `#video-preview`, `ytd-video-preview`) are passed through.
- Embeds draw their controls in a body-level `#player-controls` layer over `#movie_player`. Only
  over that layer, find the player beneath via `elementsFromPoint`. Never do this for arbitrary
  overlays, because dialogs covering the player must keep their scroll.
- The toast goes inside the player when possible; otherwise into `document.fullscreenElement`
  (fullscreen) or `body`.
- One gesture means one action: a gesture ends after `GESTURE_GAP_MS` without wheel events
  (handles trackpad momentum), or when the classified action changes (a modifier pressed
  mid-scroll). Events inside a gesture are still `preventDefault()`ed, so the page
  never scrolls under the player.
- Horizontal swipes are passed through while playing (history swipe). While paused they step one
  frame, if `modifierControls` is on.
- Clamp seeks and frame steps (both go through `seek()`) to `video.seekable` (live/DVR), and
  stop forward moves `END_GUARD_SECONDS` before the end (no autoplay).
- Only the `storage` permission (approved by the owner); never add network access or other
  permissions without asking.
