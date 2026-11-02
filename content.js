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
  // A gesture only acts once it has moved this far (in pixels), so a resting finger on a Magic
  // Mouse or a brushed trackpad doesn't skip. One mouse-wheel notch is ~100 px.
  const MIN_GESTURE_PX = 15;
  // Trackpads send a steady stream of wheel events (every ~8 ms, measured on a MacBook). When a
  // steady stream pauses for STREAM_GAP_MS, new fingers have landed, even though macOS momentum
  // from the last swipe hadn't finished (quick swipes in a row are only ~75–90 ms apart).
  const STREAM_INTERVAL_MS = 20;
  const STREAM_GAP_MS = 50;
  // Timeline mode: a slow swipe across a whole MacBook trackpad scrolls ~700 px sideways.
  const FULL_SWIPE_PX = 700;
  const TIMELINE_SPANS = { whole: 1, half: 0.5, quarter: 0.25, tenth: 0.1 };
  // macOS momentum (after the fingers lift) has deltaY exactly 0, while touching fingers wobble a
  // little vertically. Two such flat events in a row of at least this size mean momentum.
  const MOMENTUM_MIN_PX = 10;
  const SEEK_INTERVAL_MS = 50; // at most one real seek per this while scrubbing
  const LINE_PX = 16; // deltaMode 1 (lines, e.g. Firefox mouse wheels)
  const PAGE_PX = 800; // deltaMode 2 (pages)
  // Overlay placement and scale, chosen on the options page.
  const TOAST_POSITIONS = {
    bottom: { top: 'auto', bottom: '14%', translateY: '0', origin: 'bottom center' },
    center: { top: '50%', bottom: 'auto', translateY: '-50%', origin: 'center' },
    top: { top: '12%', bottom: 'auto', translateY: '0', origin: 'top center' },
  };
  const TOAST_SCALES = { 'x-small': 0.65, small: 0.8, medium: 1, large: 1.3, 'x-large': 1.6 };

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
  let lastInterval = Infinity; // time between the last two wheel events we handled
  // The current gesture: what kind it is ('move', 'volume', 'speed'), how far it has moved, what it
  // decided to do once it moved far enough (skip, frame, scrub), and whether it's finished.
  let gesture = { kind: null, done: true };
  let seekTimer = null;
  let pendingSeek = null;
  let lastSeekAt = 0;
  // Recent skips in one direction on one video, added up for the toast.
  let accumulated = { total: 0, direction: 0, at: 0, video: null, src: '' };
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

  // The overlay: a large value (e.g. "+20 s") over a quieter detail line (e.g. "0:52 / 2:00").
  // System fonts only, so nothing is fetched over the network.
  const TOAST_FONT =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Roboto, Arial, sans-serif';

  function getToast() {
    if (toast) return toast;
    toast = document.createElement('div');
    toast.id = 'yt-scroll-skip-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = `
      left: 50%;
      box-sizing: border-box;
      min-width: 240px;
      padding: 22px 44px 20px;
      background: rgba(48, 50, 54, 0.62);
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(225, 228, 232, 0.45);
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      color: #f5f6f7;
      font-family: ${TOAST_FONT};
      font-variant-numeric: tabular-nums;
      text-align: center;
      white-space: nowrap;
      z-index: 2147483647;
      pointer-events: none;
      transition: opacity 0.25s ease;
      will-change: opacity;
      opacity: 0;
    `;
    const title = document.createElement('div');
    title.className = 'yss-title';
    title.style.cssText = 'font-size: 26px; font-weight: 500; line-height: 1.15; letter-spacing: -0.01em;';
    const detail = document.createElement('div');
    detail.className = 'yss-detail';
    detail.style.cssText =
      'margin-top: 6px; font-size: 13px; font-weight: 400; line-height: 1.3; letter-spacing: 0.04em; color: rgba(245, 246, 247, 0.72);';
    const track = document.createElement('div');
    track.className = 'yss-progress';
    track.style.cssText =
      'margin-top: 14px; height: 3px; border-radius: 2px; overflow: hidden; background: rgba(245, 246, 247, 0.2);';
    const fill = document.createElement('div');
    fill.style.cssText = 'height: 100%; width: 0; border-radius: 2px; background: rgba(245, 246, 247, 0.9);';
    track.append(fill);
    toast.append(title, detail, track);
    return toast;
  }

  function placeToast(el) {
    const pos = TOAST_POSITIONS[settings.toastPosition] || TOAST_POSITIONS.bottom;
    const scale = TOAST_SCALES[settings.toastSize] || 1;
    el.style.top = pos.top;
    el.style.bottom = pos.bottom;
    el.style.transformOrigin = pos.origin;
    el.style.transform = `translate(-50%, ${pos.translateY}) scale(${scale})`;
  }

  // progress: 0–1 for the bar (position in the video, volume level), or null for no bar.
  function showToast(player, title, detail = '', progress = null) {
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

    placeToast(el);
    const [titleEl, detailEl, track] = el.children;
    titleEl.textContent = title;
    detailEl.textContent = detail;
    detailEl.style.display = detail ? '' : 'none';
    const hasBar = Number.isFinite(progress);
    track.style.display = hasBar ? '' : 'none';
    if (hasBar) track.firstChild.style.width = `${Math.min(Math.max(progress, 0), 1) * 100}%`;
    el.style.opacity = '1';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      el.style.opacity = '0';
    }, 900);
  }

  // Clamp a seek target to the seekable range: [0, duration] for normal videos, the DVR window
  // for live. Moving forward stops END_GUARD_SECONDS before the end (no autoplay), but the guard
  // never moves the video backwards from where it was (`from`).
  function clampTarget(video, from, target) {
    const { seekable } = video;
    let start = 0;
    let end = Number.isFinite(video.duration) ? video.duration : Infinity;
    if (seekable && seekable.length) {
      start = seekable.start(0);
      end = seekable.end(seekable.length - 1);
    }
    if (target > from && Number.isFinite(video.duration)) {
      target = Math.max(Math.min(target, video.duration - END_GUARD_SECONDS), from);
    }
    return Math.min(Math.max(target, start), end);
  }

  // Used by skips and frame steps alike.
  function seek(video, deltaSeconds) {
    video.currentTime = clampTarget(video, video.currentTime, video.currentTime + deltaSeconds);
  }

  // While scrubbing, wheel events arrive every ~8 ms; seeking that often makes YouTube fetch and
  // decode constantly. Seek at most every SEEK_INTERVAL_MS, always ending on the latest target.
  function scheduleSeek(video, target) {
    pendingSeek = { video, target };
    if (seekTimer) return;
    const run = () => {
      seekTimer = null;
      lastSeekAt = Date.now();
      pendingSeek.video.currentTime = pendingSeek.target;
    };
    const wait = SEEK_INTERVAL_MS - (Date.now() - lastSeekAt);
    if (wait <= 0) run();
    else seekTimer = setTimeout(run, wait);
  }

  function position(video) {
    return Number.isFinite(video.duration)
      ? `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`
      : formatTime(video.currentTime);
  }

  // Where the playhead is in the video (0–1), or null for live streams.
  function progressOf(video) {
    return Number.isFinite(video.duration) && video.duration > 0 ? video.currentTime / video.duration : null;
  }

  // The length the timeline maps onto: the video, or the DVR window of a live stream.
  function timelineLength(video) {
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    const { seekable } = video;
    if (seekable && seekable.length) return seekable.end(seekable.length - 1) - seekable.start(0);
    return 0;
  }

  // Timeline mode: sideways movement maps onto the whole video (FULL_SWIPE_PX = timelineSpan of it).
  function scrub(player, video, px) {
    gesture.offsetPx += px;
    const length = timelineLength(video);
    if (!length) return;
    const span = TIMELINE_SPANS[settings.timelineSpan] || 1;
    const seconds = ((settings.invert ? -1 : 1) * gesture.offsetPx * length * span) / FULL_SWIPE_PX;
    const target = clampTarget(video, gesture.base, gesture.base + seconds);
    scheduleSeek(video, target);

    const moved = target - gesture.base;
    const at = Number.isFinite(video.duration)
      ? `${formatTime(target)} / ${formatTime(video.duration)}`
      : formatTime(target);
    const progress = Number.isFinite(video.duration) && video.duration > 0 ? target / video.duration : null;
    showToast(player, `${moved < 0 ? '−' : '+'}${formatTime(Math.abs(moved))}`, at, progress);
  }

  function formatSeconds(seconds) {
    return String(Math.round(Math.abs(seconds) * 10) / 10);
  }

  function skip(player, video, direction, now) {
    const delta = direction * (direction > 0 ? settings.skipForward : settings.skipBack);
    const before = video.currentTime;
    seek(video, delta);
    // The toast reports what actually happened: the end guard, the start of the video or the
    // live edge can make the move shorter than asked for.
    const moved = video.currentTime - before;

    const src = video.currentSrc || video.src;
    const sameRun =
      now - accumulated.at < ACCUMULATE_MS &&
      accumulated.direction === direction &&
      accumulated.video === video &&
      accumulated.src === src; // YouTube reuses the <video> for the next video; its src changes
    accumulated = { total: (sameRun ? accumulated.total : 0) + moved, direction, at: now, video, src };

    let title;
    if (Math.abs(accumulated.total) >= 0.05) {
      title = `${direction > 0 ? '+' : '−'}${formatSeconds(accumulated.total)} s`;
    } else {
      title = direction > 0 ? (Number.isFinite(video.duration) ? 'End' : 'Live') : 'Start';
    }
    showToast(player, title, position(video), progressOf(video));
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
    const silent = result.volume === 0 || result.muted;
    showToast(player, silent ? 'Muted' : `${result.volume} %`, 'Volume', silent ? 0 : result.volume / 100);
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
    showToast(player, `${result.rate}×`, 'Speed');
  }

  function stepFrame(player, video, direction) {
    seek(video, direction * FRAME_SECONDS);
    showToast(player, direction > 0 ? 'Next frame' : 'Previous frame', position(video), progressOf(video));
  }

  // Skip direction from a movement: up or fingers left→right = forward, unless inverted.
  // The larger axis wins, so a whole (wobbly) gesture decides, not a single event.
  function skipDirection(dx, dy) {
    const forward = Math.abs(dx) > Math.abs(dy) ? dx > 0 : dy < 0;
    return forward !== settings.invert ? 1 : -1;
  }

  // What a sideways gesture does here, or null to leave it to the browser (back/forward swipe).
  function sidewaysAction(video) {
    if (settings.horizontalSwipe === 'timeline') return 'scrub';
    if (video.paused && settings.modifierControls) return 'frame';
    if (settings.horizontalSwipe === 'skip') return 'skip';
    return null;
  }

  // What kind of gesture this wheel event belongs to, or null to let the page handle it.
  // 'move' (no modifier) becomes a skip, frame step or scrub once its direction is clear.
  function classify(e) {
    // Shift+wheel turns into a horizontal scroll on most platforms, so read whichever axis moved.
    if (e.shiftKey) {
      if (!settings.modifierControls) return null;
      const d = e.deltaY || e.deltaX;
      return d ? { kind: 'speed', direction: d < 0 ? 1 : -1, delta: d } : null;
    }
    if (e.altKey) {
      if (!settings.modifierControls || Math.abs(e.deltaX) > Math.abs(e.deltaY) || !e.deltaY) return null;
      return { kind: 'volume', direction: e.deltaY < 0 ? 1 : -1, delta: e.deltaY };
    }
    if (!e.deltaX && !e.deltaY) return null;
    return { kind: 'move' };
  }

  function handleWheel(e) {
    if (!settings.enabled) return;
    if (e.ctrlKey || e.metaKey) return; // don't hijack pinch-to-zoom / browser zoom
    if (location.pathname.startsWith('/shorts/')) return; // don't hijack Shorts scroll navigation

    const found = findTarget(e.target, e.clientX, e.clientY);
    if (!found) return;
    const { player, video } = found;
    if (isAdShowing(player)) return;

    const intent = classify(e);
    if (!intent) return;

    // A new gesture starts after a quiet gap, when a steady (trackpad) stream pauses briefly (new
    // fingers), or when the kind changes (e.g. Alt pressed mid-scroll).
    const now = Date.now();
    const gap = now - lastWheel;
    const fresh =
      gap > GESTURE_GAP_MS ||
      (lastInterval <= STREAM_INTERVAL_MS && gap > STREAM_GAP_MS) ||
      intent.kind !== gesture.kind;
    const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    // A sideways start we don't handle stays the browser's (back/forward swipe while playing).
    if (fresh && intent.kind === 'move' && sideways && !sidewaysAction(video)) return;

    // Every event we've claimed is consumed, including the ones inside a gesture that don't
    // act, so the page never scrolls underneath.
    e.preventDefault();
    e.stopPropagation();
    lastInterval = gap;
    lastWheel = now;
    if (fresh) {
      gesture = { kind: intent.kind, distance: 0, sumX: 0, sumY: 0, action: null, done: false };
      gesture.wobbled = false; // touching fingers wobble vertically; momentum doesn't
      gesture.held = 0; // a flat event held back until we know it isn't momentum
    }
    if (gesture.done) return;

    const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;

    if (intent.kind !== 'move') {
      // Volume and speed: one step per gesture, once it has moved far enough.
      gesture.distance += Math.abs(intent.delta) * unit;
      if (gesture.distance < MIN_GESTURE_PX) return;
      gesture.done = true;
      if (intent.kind === 'volume') changeVolume(player, video, intent.direction);
      else changeSpeed(player, video, intent.direction);
      return;
    }

    if (gesture.action === 'scrub') {
      // Stop when the fingers lift: hold back a flat (dy = 0) event; a second one in a row is
      // momentum, so drop both and end the gesture. Otherwise apply what was held.
      if (dy !== 0) gesture.wobbled = true;
      const flat = gesture.wobbled && dy === 0 && Math.abs(dx) >= MOMENTUM_MIN_PX;
      if (flat && gesture.held) {
        gesture.done = true;
        return;
      }
      if (flat) {
        gesture.held = dx;
        return;
      }
      const px = gesture.held + dx;
      gesture.held = 0;
      scrub(player, video, px);
      return;
    }

    // Not decided yet: wait until the gesture has moved far enough (tiny accidental touches never
    // do), then let its overall direction decide. A trackpad swipe wobbles between axes event by
    // event, so no single event decides.
    gesture.sumX += dx;
    gesture.sumY += dy;
    if (dy !== 0) gesture.wobbled = true;
    if (Math.max(Math.abs(gesture.sumX), Math.abs(gesture.sumY)) < MIN_GESTURE_PX) return;
    const horizontal = Math.abs(gesture.sumX) > Math.abs(gesture.sumY);
    gesture.action = horizontal ? sidewaysAction(video) : 'skip';

    if (gesture.action === 'scrub') {
      gesture.base = video.currentTime;
      gesture.offsetPx = 0;
      scrub(player, video, gesture.sumX);
      return;
    }
    gesture.done = true;
    if (gesture.action === 'skip') skip(player, video, skipDirection(gesture.sumX, gesture.sumY), now);
    else if (gesture.action === 'frame') stepFrame(player, video, gesture.sumX > 0 ? 1 : -1);
  }

  // Use capture phase so we intercept before YouTube's own handlers
  window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
})();
