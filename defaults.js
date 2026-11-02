// Shared by content.js and options.js (loaded before them). Stored in chrome.storage.sync.
// eslint-disable-next-line no-unused-vars
const YSS_DEFAULTS = Object.freeze({
  enabled: true, // toggled by clicking the toolbar icon, or on the options page
  skipForward: 10, // seconds per forward scroll gesture
  skipBack: 10, // seconds per backward scroll gesture
  invert: false, // true: scroll down = forward (for people who find the default backwards)
  // Sideways (trackpad) swipes over the player: 'timeline' = scrub (a full swipe = timelineSpan of
  // the video), 'skip' = skip like scrolling, 'off' = the browser's back/forward swipe.
  horizontalSwipe: 'timeline',
  timelineSpan: '25', // percent of the video one full trackpad swipe covers: '100' | '75' | '50' | '25' | '10'
  modifierControls: true, // Alt+scroll = volume, Shift+scroll = speed, sideways swipe while paused = frame step
  toastPosition: 'bottom', // 'bottom' | 'center' | 'top'
  toastSize: 'medium', // 'x-small' | 'small' | 'medium' | 'large' | 'x-large'
});
