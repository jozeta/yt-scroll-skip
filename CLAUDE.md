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
  Add a test for every behaviour change.
- Still check by hand on real YouTube: normal video, fullscreen, an embed, an ad, a live stream,
  `/shorts/`, the home feed (hover previews) and a trackpad swipe.
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
- `background.js`: clicking the toolbar icon flips `enabled`; the badge shows `OFF`.
- `options.html` / `options.js`: the options page, which saves on change.

## Behaviour to preserve

- Ctrl/Cmd + scroll is never intercepted (zoom).
- `/shorts/` pages are left alone (native next-Short gesture).
- No skipping while the player is inside `.ad-showing`.
- Seek the video inside the player under the cursor, never a global `<video>` lookup. Scrolls over
  player popups (`.ytp-popup`, `.ytp-settings-menu`, `.ytp-panel-menu`) and inline hover previews
  (`#inline-player`, `#video-preview`, `ytd-video-preview`) are passed through.
- The toast goes inside the player when possible; otherwise into `document.fullscreenElement`
  (fullscreen) or `body`.
- One gesture means one action: a gesture ends after `GESTURE_GAP_MS` without wheel events
  (handles trackpad momentum). Events inside a gesture are still `preventDefault()`ed, so the page
  never scrolls under the player.
- Horizontal swipes are passed through while playing (history swipe). While paused they step one
  frame, if `modifierControls` is on.
- Clamp seeks to `video.seekable` (live/DVR), and stop forward skips `END_GUARD_SECONDS` before
  the end (no autoplay).
- Only the `storage` permission (approved by the owner); never add network access or other
  permissions without asking.
