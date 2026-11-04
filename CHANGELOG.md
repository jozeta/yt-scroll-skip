# Changelog

All notable changes to ext-yt-scroll-skip are listed here, newest first.

Releases follow the project's git tags. Entries were reconstructed from the commit history.

## [Unreleased]

- The toast appears without a fade when "Reduce motion" is on
- Renamed the project to **ext-yt-scroll-skip** (GitHub repo, package name, release zip, toast
  element id). The Firefox add-on ID stays `yt-scroll-skip@zetterstrom`, so existing installs keep
  getting updates

- ESLint (flat config, with the no-unsanitized rule) as a dev-only tool; CI runs `npm run lint`

## [1.3.0] - 2026-11-02

- Scrolling or swiping over the video shows YouTube's own control bar (red timeline and time) as
  well, as if the mouse had moved ("Show YouTube's controls while scrolling", on by default). The
  overlay now sits in the centre by default so it doesn't cover it.
- Trackpad timeline: sideways swipes over the video scrub through it. A swipe across the whole
  trackpad covers 25 % of the video by default ("Timeline sensitivity": 100, 75, 50, 25 or 10 %), with the
  time and progress shown live. Scrubbing stops when the fingers lift (macOS momentum is
  ignored). "Sideways swipe" can also be set to Skip (10-s skips) or Off (the browser's
  back/forward swipe). Before, sideways swipes were passed to the browser, which rubber-banded
  the page or went back a page.
- Quick trackpad swipes in a row each count. Before, only the first one acted until the pointer
  was moved, because macOS momentum filled the gaps between swipes.
- A wobbly trackpad swipe skips in its overall direction; before, one mostly-vertical event in a
  sideways swipe could make it skip the wrong way.
- Separate forward and back skip lengths (settings from 1.2.x carry over to both).
- Overlay position (bottom, centre, top) and size (extra small, small, medium, large, extra
  large) settings.
- A thin progress bar in the overlay: position in the video for skips and frame steps, level for
  volume.
- The overlay shows how far the video actually moved (e.g. `+4.5 s` near the end), and `End`,
  `Start` or `Live` when it couldn't move.
- The running total in the overlay starts over on a new video instead of carrying over.
- Tiny accidental wheel movements (a resting finger, a brushed trackpad) no longer skip.
- New overlay design: a larger translucent grey panel (about three times the old area) with a thin
  light-grey border, the value in large type over a quieter detail line, system fonts and no
  icons. Volume, speed and frame steps say what changed ("55 %" / "Volume", "Next frame").
- Pressing a modifier mid-scroll (e.g. Alt for volume) now starts a new gesture instead of being
  silently ignored until the scroll stops.
- Frame steps are clamped like skips: they stay inside the seekable range and stop short of the
  end, so stepping forward on a paused video can't run into autoplay.
- The options page keeps the previous "seconds per skip" when an invalid value is entered,
  instead of resetting it to 10.
- README: screenshots of the toast and the options page (`npm run screenshots` regenerates them),
  plus small fixes.
- Changelog: added the missing 1.2.1 entry.

## [1.2.1] - 2026-11-02

First release since 1.0. (1.2.0 was the version number during development and was never tagged.)

- Settings page: seconds per skip, invert direction, extra controls, on/off. Settings sync via
  `chrome.storage.sync`, which adds the `storage` permission.
- Toolbar icon toggles the extension on and off, with an `OFF` badge.
- One action per gesture, also with trackpad momentum; the page never scrolls under the player.
- Extra controls: Alt+scroll volume, Shift+scroll speed, sideways swipe while paused for one frame.
  Volume and speed go through YouTube's player API so its own UI stays in sync.
- Works on `m.youtube.com`, `music.youtube.com` and `youtube-nocookie.com` embeds too.
- Skipping works in YouTube embeds, where the controls layer sits on top of the player.
- Left alone: Ctrl/Cmd+scroll (zoom), `/shorts/`, ads, player menus, feed hover previews and
  horizontal swipes while playing.
- Seeks are clamped to the live/DVR window and stop short of the end (no autoplay).
- Playwright end-to-end tests and GitHub Actions CI.

## [1.0] - 2026-11-02

- Initial commit: YouTube Scroll to Skip extension
- Ignore macOS, Claude Code and secret files
- Add CLAUDE.md with project guidance for Claude Code
- Add security policy
