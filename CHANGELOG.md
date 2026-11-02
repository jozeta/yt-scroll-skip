# Changelog

All notable changes to yt-scroll-skip are listed here, newest first.

Releases follow the project's git tags. Entries were reconstructed from the commit history.

## [Unreleased]

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
