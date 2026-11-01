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

chrome.action.onClicked.addListener(() => {
  chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
    chrome.storage.sync.set({ enabled: !enabled }); // onChanged below updates the badge
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'enabled' in changes) updateBadge(changes.enabled.newValue !== false);
});

chrome.runtime.onInstalled.addListener(refreshBadge);
chrome.runtime.onStartup.addListener(refreshBadge);
