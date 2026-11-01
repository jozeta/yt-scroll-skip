// Shared by content.js and options.js (loaded before them). Stored in chrome.storage.sync.
// eslint-disable-next-line no-unused-vars
const YSS_DEFAULTS = Object.freeze({
  enabled: true, // toggled by clicking the toolbar icon, or on the options page
  skipSeconds: 10, // seconds per scroll gesture
  invert: false, // true: scroll down = forward (for people who find the default backwards)
  modifierControls: true, // Alt+scroll = volume, Shift+scroll = speed, sideways swipe while paused = frame step
});
