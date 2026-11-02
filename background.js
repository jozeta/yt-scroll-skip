// Toolbar icon = on/off switch. The state lives in chrome.storage.sync ("enabled"), which the
// content script and options page also read, so all three stay in sync.

function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: '#666' });
  chrome.action.setTitle({
    title: `YouTube Scroll to Skip: ${enabled ? 'on' : 'off'} (click to turn ${enabled ? 'off' : 'on'})`,
  });
}

function refreshBadge() {
  chrome.storage.sync.get({ enabled: true }, ({ enabled }) => updateBadge(enabled));
}

// Named (and global) so the tests can run exactly what a toolbar click runs.
async function toggleEnabled() {
  const { enabled } = await chrome.storage.sync.get({ enabled: true });
  await chrome.storage.sync.set({ enabled: !enabled }); // onChanged below updates the badge
  return !enabled;
}

chrome.action.onClicked.addListener(toggleEnabled);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'enabled' in changes) updateBadge(changes.enabled.newValue !== false);
});

// 1.2.x had one "skipSeconds" for both directions; carry it over to the separate forward and
// back lengths so an update keeps the user's choice. Named (and global) for the tests.
async function migrateSettings() {
  const { skipSeconds } = await chrome.storage.sync.get('skipSeconds');
  if (skipSeconds === undefined) return;
  const { skipForward, skipBack } = await chrome.storage.sync.get(['skipForward', 'skipBack']);
  await chrome.storage.sync.set({ skipForward: skipForward ?? skipSeconds, skipBack: skipBack ?? skipSeconds });
  await chrome.storage.sync.remove('skipSeconds');
}

chrome.runtime.onInstalled.addListener(() => {
  migrateSettings();
  refreshBadge();
});
chrome.runtime.onStartup.addListener(refreshBadge);
