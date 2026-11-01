# YouTube Scroll to Skip

A small browser extension that lets you skip forward or backward in a YouTube video by scrolling over the player. No clicking, no arrow keys, no reaching for the seek bar.

- Scroll **up** over the video → skip **forward** 10 seconds
- Scroll **down** over the video → skip **backward** 10 seconds

A toast over the player confirms each skip and shows where you landed, e.g. `⏩ +10s · 4:32 / 12:05`. Quick repeated skips add up (`⏩ +30s`).

## Features

- **One gesture = one skip**, even with trackpad momentum scrolling. The page never scrolls underneath the player while you skip.
- **Settings**: seconds per skip, invert direction, extra controls, and on/off.
- **On/off from the toolbar**: click the extension icon. An `OFF` badge shows when it's disabled.
- **Extra controls** (can be turned off):
  - Alt/Option + scroll: volume
  - Shift + scroll: playback speed (0.25×–4×)
  - Sideways swipe while paused: step one frame
- **Works on** `www.youtube.com`, `m.youtube.com` and `music.youtube.com`, plus embedded players, including privacy-mode `youtube-nocookie.com` embeds.
- **Live streams**: skips stay within the stream's seekable (DVR) window.
- **Gets out of the way**:
  - Ctrl/Cmd + scroll (zoom) is never intercepted.
  - `/shorts/` pages keep their native scroll-to-next gesture.
  - Ads can't be skipped through.
  - Scrolling the player's quality/speed menus scrolls the menu.
  - Hover previews in the feed are ignored.
  - Sideways swipes while playing still go back/forward in history.
  - Forward skips stop just before the end, so they don't trigger autoplay of the next video.
- **Accessible**: the toast is announced to screen readers (`role="status"`).
- **Private**: the only permission is `storage` (to save your settings). No tracking and no network requests.

## Installation

The extension isn't on the Chrome Web Store yet, so you install it manually as an "unpacked" extension.

### Chrome, Edge, Brave and other Chromium browsers

1. Download or clone this repository.
2. Go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the folder that contains `manifest.json`.

### Firefox (121+)

Go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick `manifest.json`. Firefox support is untested.

## Usage

Hover over a video and scroll. Scrolling anywhere outside the player behaves normally.

## Settings

Right-click the toolbar icon → **Options** (or use the **Details → Extension options** link in `chrome://extensions`). Changes apply immediately, including in open tabs, and sync across your signed-in browsers.

| Setting          | Default | What it does                                                         |
|------------------|---------|----------------------------------------------------------------------|
| Enabled          | on      | Same as clicking the toolbar icon                                    |
| Seconds per skip | 10      | How far one scroll gesture jumps (1–600)                             |
| Invert direction | off     | Scroll down = forward. Try it if the default feels backwards, e.g. with macOS natural scrolling |
| Extra controls   | on      | Alt+scroll volume, Shift+scroll speed, sideways swipe while paused for one frame |

Finer tuning (the gesture gap, how long skips keep adding up, the end guard, volume and speed steps) is in the constants at the top of `content.js`.

## How it works

The content script (`content.js`, with the shared defaults from `defaults.js`) runs in YouTube pages and their frames. It listens for `wheel` events in the capture phase, so it sees them before YouTube's own handlers do. For each event it:

1. Backs off if the extension is disabled, Ctrl/Cmd is held, or you're on `/shorts/`.
2. Finds the player under the cursor (`#movie_player`, `#shorts-player` or `.html5-video-player`) and the `<video>` inside it. It skips player popups and feed hover previews.
3. Backs off if that player is showing an ad.
4. Decides what the event means: skip, volume, speed, frame step, or nothing (the event is then left for the page).
5. Calls `preventDefault()`. It only acts on the first event of a gesture; a gesture ends after 200 ms without wheel events.

Seeks are clamped to `video.seekable`. The toast is placed inside the player, or inside `document.fullscreenElement` when needed, because only the fullscreen element's subtree is drawn in fullscreen.

`background.js` handles the toolbar toggle and badge, and `options.html`/`options.js` are the settings page.

## Development

```sh
npm install      # dev tooling only (Playwright)
npm test         # end-to-end tests in headless Chromium
npm run package  # dist/yt-scroll-skip-<version>.zip for store upload
```

The tests load the real extension into Playwright's Chromium and serve `test/fixture.html` (a fake YouTube player with a generated silent audio track) at `www.youtube.com` URLs. Real wheel events are then fired at it. After editing, also reload the extension in `chrome://extensions` and try it on real YouTube.

### Publishing to the Chrome Web Store

1. Bump `version` in `manifest.json` and run `npm run package`.
2. Upload the zip in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole).
3. Add at least one 1280×800 screenshot and a 128×128 icon.
4. Privacy: the extension collects no user data. Justify `storage` as "saves the user's settings".

## Project structure

```
.
├── manifest.json      # Manifest V3 (Chrome service worker + Firefox background scripts)
├── defaults.js        # Default settings, shared by content and options scripts
├── content.js         # Wheel handling, seeking, modifier controls, toast
├── background.js      # Toolbar on/off toggle and badge
├── options.html/.js   # Settings page
├── icon.png
├── test/              # Playwright end-to-end tests + fake YouTube fixture
├── scripts/package.sh # Builds the store zip
└── LICENSE            # MIT
```

## License

MIT. See [LICENSE](LICENSE) for details.
