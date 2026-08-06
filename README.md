# YouTube Scroll to Skip

A tiny Chrome extension that lets you skip forward or backward in a YouTube video by scrolling your mouse wheel over the player — no clicking, no arrow keys, no reaching for the seek bar.

- Scroll **up** over the video → skip **forward** 10 seconds
- Scroll **down** over the video → skip **backward** 10 seconds

A small on-screen toast (e.g. `⏩ +10s`) confirms each skip.

## Features

- Works directly on `youtube.com` video pages, including embedded players in iframes
- Skips are throttled (300ms) so a single scroll gesture doesn't fire multiple skips
- Only activates when the cursor is over the video player, so page scrolling elsewhere is untouched
- Leaves Ctrl/Cmd + scroll alone so pinch-to-zoom and browser zoom still work
- Ignores YouTube Shorts pages so the native scroll-to-next-Short gesture isn't hijacked
- Skips are suppressed while an ad is playing
- Toast confirmation still shows correctly in fullscreen
- No permissions, no tracking, no external requests — it's a single content script

## Installation

This extension isn't published on the Chrome Web Store, so it's installed manually as an "unpacked" extension.

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the folder containing this project (the one with `manifest.json` in it).
6. The extension should now appear in your extensions list as "YouTube Scroll to Skip".

## Usage

1. Open any video on `youtube.com`.
2. Hover your mouse over the video player.
3. Scroll up to jump forward 10 seconds, or scroll down to jump back 10 seconds.
4. A toast will briefly appear showing how much time was skipped.

Scrolling anywhere outside the player (e.g. over the comments or sidebar) behaves normally and is not intercepted.

## How it works

The extension injects a single content script (`content.js`) into YouTube pages and their frames (`all_frames: true`, so embedded players work too). It listens for `wheel` events in the capture phase so it can intercept scrolling before YouTube's own handlers run.

When a scroll happens over the player (`#movie_player`, `#shorts-player`, `.html5-video-player`, or the `<video>` element itself), it prevents the default scroll behavior and instead adjusts `video.currentTime`. The handler backs off in a few cases so it doesn't fight with the browser or YouTube:

- **Ctrl/Cmd is held** — treated as a zoom gesture, not a skip
- **On a `/shorts/` page** — scroll is left alone for Shorts' native next-video navigation
- **An ad is showing** (`#movie_player.ad-showing`) — skipping is suppressed
- **In fullscreen** — the toast is appended into `document.fullscreenElement` instead of `document.body`, since only the fullscreen element's subtree is rendered while active

The video element itself is looked up as `#movie_player video` / `#shorts-player video` first (falling back to the first `<video>` on the page) so it doesn't accidentally grab an unrelated `<video>`, such as an autoplaying preview thumbnail elsewhere on the page.

## Configuration

There's currently no UI for settings — tweak the constants at the top of `content.js` directly:

| Constant       | Default | Description                                   |
|----------------|---------|------------------------------------------------|
| `SKIP_SECONDS` | `10`    | How many seconds to skip per scroll tick       |
| `THROTTLE_MS`  | `300`   | Minimum time between skips, in milliseconds    |

After editing, reload the extension from `chrome://extensions` (click the refresh icon on the card) and refresh any open YouTube tabs.

## Project structure

```
.
├── manifest.json   # Chrome extension manifest (Manifest V3)
├── content.js      # Core logic: wheel-event handling, seeking, toast UI
├── icon.png        # Extension icon
├── LICENSE         # MIT license
└── README.md
```

## Compatibility

Built for Chromium-based browsers (Chrome, Edge, Brave, etc.) using Manifest V3. It should also load in Firefox via `about:debugging` → "Load Temporary Add-on", though this hasn't been tested.

## Contributing

Issues and pull requests are welcome. Since this is a single-file extension, most changes will happen in `content.js`.

## License

MIT — see [LICENSE](LICENSE) for details.
