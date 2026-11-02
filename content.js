(() => {
  // A gesture ends once wheel events stop for this long. Trackpad momentum
  // keeps emitting events after the fingers lift, so a fixed throttle would
  // fire several skips per swipe; waiting for a quiet gap gives one.
  const GESTURE_GAP_MS = 200;
  // Skips in the same direction within this window add up in the toast (+10s, +20s, +30s…).
  const ACCUMULATE_MS = 1000;
  // Forward skips stop this far before the end, so they don't trigger autoplay of the next video.
  const END_GUARD_SECONDS = 0.5;
  const VOLUME_STEP = 0.05;
  const SPEED_STEP = 0.25;
  const SPEED_MIN = 0.25;
  const SPEED_MAX = 4;
  const FRAME_SECONDS = 1 / 30; // YouTube doesn't expose the frame rate; 30 fps is the common case

  const PLAYER_SELECTOR = '#movie_player, #shorts-player, .html5-video-player';
  // Scrollable menus inside the player (quality list, speed list…): their scroll is theirs.
  const PLAYER_POPUP_SELECTOR = '.ytp-popup, .ytp-settings-menu, .ytp-panel-menu';
  // Hover-to-play previews in feeds also use .html5-video-player; never treat them as the player.
  const INLINE_PREVIEW_SELECTOR = '#inline-player, #video-preview, ytd-video-preview';
  // YouTube's current embed player draws its controls in this body-level layer *on top of*
  // #movie_player rather than inside it. Over it, look underneath for the player. Only this
  // layer: doing it for any overlay would steal scrolling from dialogs that cover the player.
  const PLAYER_CONTROLS_LAYER_SELECTOR = '#player-controls';

  const settings = { ...YSS_DEFAULTS };
  chrome.storage.sync.get(YSS_DEFAULTS, (stored) => Object.assign(settings, stored));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in YSS_DEFAULTS) settings[key] = newValue ?? YSS_DEFAULTS[key];
    }
  });

  let lastWheel = 0;
  let accumulated = { total: 0, at: 0 };
  let hideTimer = null;
  let toast = null;

  // Resolve the player and video under the cursor, so the video we seek is always the one
  // being scrolled over (not some other <video> on the page).
  function findTarget(target, x, y) {
    if (!target || typeof target.closest !== 'function') return null;
    if (target.closest(PLAYER_POPUP_SELECTOR) || target.closest(INLINE_PREVIEW_SELECTOR)) return null;

    let player = target.closest(PLAYER_SELECTOR);
    if (!player && target.closest(PLAYER_CONTROLS_LAYER_SELECTOR)) {
      const below = document.elementsFromPoint(x, y).find((el) => el.closest(PLAYER_SELECTOR));
      player = below ? below.closest(PLAYER_SELECTOR) : null;
    }
    if (player) {
      const video = player.querySelector('video');
      return video ? { player, video } : null;
    }
    if (target instanceof HTMLVideoElement) return { player: target.parentElement, video: target };
    return null;
  }

  function isAdShowing(player) {
    return !!(player && player.closest('.ad-showing'));
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }

  function getToast() {
    if (toast) return toast;
    toast = document.createElement('div');
    toast.id = 'yt-scroll-skip-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = `
      left: 50%;
      bottom: 15%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.75);
      color: white;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 15px;
      font-family: Roboto, Arial, sans-serif;
      white-space: nowrap;
      z-index: 2147483647;
      pointer-events: none;
      transition: opacity 0.3s ease;
      opacity: 0;
    `;
    return toast;
  }

  function showToast(player, message) {
    const el = getToast();
    // Prefer showing it over the player itself (right place in theater mode, mini-player,
    // small embeds). In fullscreen only the fullscreen element's subtree renders, so fall
    // back to it if the player isn't inside.
    const fs = document.fullscreenElement;
    const inPlayer =
      player && (!fs || fs.contains(player)) && getComputedStyle(player).position !== 'static';
    const container = inPlayer ? player : fs || document.body;

    el.style.position = inPlayer ? 'absolute' : 'fixed';
    if (el.parentNode !== container) container.appendChild(el);

    el.textContent = message;
    el.style.opacity = '1';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      el.style.opacity = '0';
    }, 800);
  }

  // Clamp to the seekable range: [0, duration] for normal videos, the DVR window for live.
  function seek(video, deltaSeconds) {
    const { seekable } = video;
    let start = 0;
    let end = Number.isFinite(video.duration) ? video.duration : Infinity;
    if (seekable && seekable.length) {
      start = seekable.start(0);
      end = seekable.end(seekable.length - 1);
    }
    let target = video.currentTime + deltaSeconds;
    if (deltaSeconds > 0 && Number.isFinite(video.duration)) {
      // Don't run into the end (and autoplay); never move backwards because of the guard.
      target = Math.max(Math.min(target, video.duration - END_GUARD_SECONDS), video.currentTime);
    }
    video.currentTime = Math.min(Math.max(target, start), end);
  }

  function skip(player, video, direction, now) {
    const delta = direction * settings.skipSeconds;
    const sameRun = now - accumulated.at < ACCUMULATE_MS && Math.sign(accumulated.total) === direction;
    accumulated = { total: sameRun ? accumulated.total + delta : delta, at: now };

    seek(video, delta);

    const icon = direction > 0 ? '⏩' : '⏪';
    const sign = direction > 0 ? '+' : '−';
    const position = Number.isFinite(video.duration)
      ? `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`
      : formatTime(video.currentTime);
    showToast(player, `${icon} ${sign}${Math.abs(accumulated.total)}s · ${position}`);
  }

  // Ask page-bridge.js (MAIN world) to do this through YouTube's player API, so YouTube's own UI
  // updates. Returns its result, or null if the API isn't available and we must do it ourselves.
  function viaPlayerApi(player, command) {
    if (!player) return null;
    const event = new CustomEvent('yss-command', {
      detail: JSON.stringify(command),
      bubbles: true,
      cancelable: true,
    });
    const handled = !player.dispatchEvent(event); // listeners run synchronously
    const raw = player.dataset.yssResult;
    delete player.dataset.yssResult;
    if (!handled || !raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function changeVolume(player, video, direction) {
    let result = viaPlayerApi(player, { action: 'volume', direction, step: VOLUME_STEP });
    if (!result) {
      const volume = Math.min(Math.max(video.volume + direction * VOLUME_STEP, 0), 1);
      video.volume = Math.round(volume * 100) / 100;
      if (direction > 0) video.muted = false;
      result = { volume: Math.round(video.volume * 100), muted: video.muted };
    }
    showToast(player, `${result.volume === 0 || result.muted ? '🔇' : '🔊'} ${result.volume}%`);
  }

  function changeSpeed(player, video, direction) {
    const command = {
      action: 'speed',
      direction,
      step: SPEED_STEP,
      min: SPEED_MIN,
      max: SPEED_MAX,
      current: video.playbackRate,
    };
    let result = viaPlayerApi(player, command);
    if (!result) {
      // Outside YouTube's own range (or no API): set the element directly.
      const rate = Math.min(Math.max(video.playbackRate + direction * SPEED_STEP, SPEED_MIN), SPEED_MAX);
      video.playbackRate = rate;
      result = { rate };
    }
    showToast(player, `⏱ ${result.rate}×`);
  }

  function stepFrame(player, video, direction) {
    video.currentTime = Math.max(video.currentTime + direction * FRAME_SECONDS, 0);
    showToast(player, `${direction > 0 ? '▶' : '◀'} 1 frame · ${formatTime(video.currentTime)}`);
  }

  // Decide what this wheel event means, or null to let the page handle it.
  function classify(e, video) {
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    // Shift+wheel turns into a horizontal scroll on most platforms, so read whichever axis moved.
    if (e.shiftKey) {
      if (!settings.modifierControls) return null;
      const d = e.deltaY || e.deltaX;
      return d ? { action: 'speed', direction: d < 0 ? 1 : -1 } : null;
    }
    if (e.altKey) {
      if (!settings.modifierControls || horizontal || !e.deltaY) return null;
      return { action: 'volume', direction: e.deltaY < 0 ? 1 : -1 };
    }
    if (horizontal) {
      // While playing, sideways swipes stay the browser's (history back/forward).
      if (!settings.modifierControls || !video.paused) return null;
      return { action: 'frame', direction: e.deltaX > 0 ? 1 : -1 };
    }
    if (!e.deltaY) return null;
    const up = e.deltaY < 0;
    return { action: 'skip', direction: up !== settings.invert ? 1 : -1 };
  }

  function handleWheel(e) {
    if (!settings.enabled) return;
    if (e.ctrlKey || e.metaKey) return; // don't hijack pinch-to-zoom / browser zoom
    if (location.pathname.startsWith('/shorts/')) return; // don't hijack Shorts scroll navigation

    const found = findTarget(e.target, e.clientX, e.clientY);
    if (!found) return;
    const { player, video } = found;
    if (isAdShowing(player)) return;

    const intent = classify(e, video);
    if (!intent) return;

    // Every event we've claimed is consumed, including the ones inside a gesture that don't
    // act, so the page never scrolls underneath.
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    const isNewGesture = now - lastWheel > GESTURE_GAP_MS;
    lastWheel = now;
    if (!isNewGesture) return;

    if (intent.action === 'skip') skip(player, video, intent.direction, now);
    else if (intent.action === 'volume') changeVolume(player, video, intent.direction);
    else if (intent.action === 'speed') changeSpeed(player, video, intent.direction);
    else stepFrame(player, video, intent.direction);
  }

  // Use capture phase so we intercept before YouTube's own handlers
  window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
})();
