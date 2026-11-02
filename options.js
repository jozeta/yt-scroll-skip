/* global YSS_DEFAULTS */
const fields = Object.keys(YSS_DEFAULTS).map((key) => document.getElementById(key));
const status = document.getElementById('status');
let statusTimer = null;
// The values currently shown, so an invalid entry can go back to what was there before.
const current = { ...YSS_DEFAULTS };

function render(values) {
  Object.assign(current, values);
  for (const el of fields) {
    if (el.type === 'checkbox') el.checked = values[el.id];
    else el.value = values[el.id];
  }
}

function readField(el) {
  if (el.type === 'checkbox') return el.checked;
  const n = Math.round(Number(el.value));
  const valid = Number.isFinite(n) && n >= Number(el.min) && n <= Number(el.max);
  return valid ? n : current[el.id];
}

chrome.storage.sync.get(YSS_DEFAULTS, render);

// Keep the page current if the toolbar icon toggles "enabled" while it's open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  chrome.storage.sync.get(YSS_DEFAULTS, render);
});

for (const el of fields) {
  el.addEventListener('change', () => {
    const value = readField(el);
    if (el.type !== 'checkbox') el.value = value;
    current[el.id] = value;
    chrome.storage.sync.set({ [el.id]: value }, () => {
      status.textContent = 'Saved';
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => (status.textContent = ''), 1200);
    });
  });
}
