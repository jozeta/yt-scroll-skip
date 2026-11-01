# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

YouTube Scroll to Skip: a tiny Chrome (Manifest V3) extension. Scrolling up over a YouTube player
skips forward 10 s, scrolling down skips back 10 s, with a toast (`⏩ +10s`). One content script,
no permissions, no network, no build.

## Running

`chrome://extensions` → Developer mode → **Load unpacked** → this folder. After editing, click the
reload icon on the extension card and refresh YouTube tabs. No automated tests. Check a normal
video, fullscreen, an embedded player, an ad, a `/shorts/` page and Ctrl/Cmd+scroll.

## Code

- `manifest.json`: content script on `*://www.youtube.com/*`, `all_frames: true`,
  `document_idle`. No `permissions` key.
- `content.js`: everything. Constants at the top: `SKIP_SECONDS` (10), `THROTTLE_MS` (300).
  A capture-phase `wheel` listener acts only when the cursor is over `#movie_player`,
  `#shorts-player`, `.html5-video-player` or the `<video>`; it calls `preventDefault()` and
  adjusts `video.currentTime`.

## Behaviour to preserve

- Ctrl/Cmd + scroll is never intercepted (zoom).
- `/shorts/` pages are left alone (native next-Short gesture).
- No skipping while `#movie_player.ad-showing`.
- In fullscreen the toast goes into `document.fullscreenElement`.
- Look up the video as `#movie_player video` / `#shorts-player video` before falling back to the
  first `<video>`, so autoplaying preview videos aren't grabbed.
- Throttle so one gesture means one skip.
- Keep it permission-free and network-free.
