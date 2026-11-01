// Runs in the page's own JavaScript world ("world": "MAIN"), where YouTube's player API lives on
// the #movie_player element (setVolume, setPlaybackRate…). content.js runs in an isolated world
// and can't call it, so it asks this bridge through a DOM event:
//
//   content.js  ── dispatch 'yss-command' on the player (detail: JSON string) ──▶  page-bridge.js
//   content.js  ◀── event cancelled = handled; result in data-yss-result (JSON) ──  page-bridge.js
//
// Only strings and DOM state cross between the worlds, which is why detail and the result are JSON.
// If the API isn't there (or can't do the request), the event isn't cancelled and content.js falls
// back to changing the <video> directly.
(() => {
  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
  const round2 = (n) => Math.round(n * 100) / 100;

  const handlers = {
    // Volume in YouTube's 0–100 scale. Using the API (not video.volume) keeps YouTube's slider in
    // sync and respects its loudness normalisation, where video.volume ≠ the slider value.
    volume(api, { direction, step }) {
      if (typeof api.getVolume !== 'function' || typeof api.setVolume !== 'function') return null;
      const muted = typeof api.isMuted === 'function' && api.isMuted();
      const volume = clamp(Math.round(api.getVolume() + direction * step * 100), 0, 100);
      api.setVolume(volume);
      if (direction > 0 && muted && typeof api.unMute === 'function') api.unMute();
      return { volume, muted: direction > 0 ? false : muted };
    },

    // Only rates YouTube itself offers; anything outside its range goes to the fallback.
    // `current` is the <video>'s real rate, which may be outside YouTube's range after a fallback.
    speed(api, { direction, step, min, max, current }) {
      if (typeof api.setPlaybackRate !== 'function') return null;
      const rate = round2(clamp(current + direction * step, min, max));
      const rates = typeof api.getAvailablePlaybackRates === 'function' ? api.getAvailablePlaybackRates() : [];
      if (!rates.length || rate < Math.min(...rates) || rate > Math.max(...rates)) return null;
      api.setPlaybackRate(rate);
      return { rate };
    },
  };

  document.addEventListener(
    'yss-command',
    (e) => {
      const player = e.target;
      if (!(player instanceof Element)) return;
      let command;
      try {
        command = JSON.parse(e.detail);
      } catch {
        return;
      }
      const handler = handlers[command && command.action];
      if (!handler) return;
      try {
        const result = handler(player, command);
        if (!result) return;
        player.dataset.yssResult = JSON.stringify(result);
        e.preventDefault();
      } catch {
        // API changed or threw: leave the event uncancelled so content.js falls back.
      }
    },
    true,
  );
})();
