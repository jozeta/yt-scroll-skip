(() => {
  const SKIP_SECONDS = 10;
  const THROTTLE_MS = 300;
  const PLAYER_SELECTOR = '#movie_player, #shorts-player, .html5-video-player, video';

  let lastScroll = 0;
  let hideTimer = null;
  let toast = null;

  function getVideo() {
    return (
      document.querySelector('#movie_player video, #shorts-player video') ||
      document.querySelector('video')
    );
  }

  function isOverPlayer(target) {
    return !!(target && typeof target.closest === 'function' && target.closest(PLAYER_SELECTOR));
  }

  function isAdShowing() {
    const player = document.getElementById('movie_player');
    return !!(player && player.classList.contains('ad-showing'));
  }

  function getToastContainer() {
    // In fullscreen, only the fullscreen element (and its descendants) render,
    // so the toast must live inside it or it silently disappears.
    return document.fullscreenElement || document.body;
  }

  function showToast(message) {
    const container = getToastContainer();

    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'yt-scroll-skip-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.75);
        color: white;
        padding: 10px 20px;
        border-radius: 6px;
        font-size: 15px;
        font-family: sans-serif;
        z-index: 2147483647;
        pointer-events: none;
        transition: opacity 0.3s ease;
        opacity: 0;
      `;
    }

    if (toast.parentNode !== container) {
      container.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = '1';

    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      toast.style.opacity = '0';
    }, 800);
  }

  function seek(video, deltaSeconds) {
    const duration = video.duration;
    const max = Number.isFinite(duration) ? duration : Infinity;
    video.currentTime = Math.min(Math.max(video.currentTime + deltaSeconds, 0), max);
  }

  function handleWheel(e) {
    if (e.ctrlKey || e.metaKey) return; // don't hijack pinch-to-zoom / browser zoom
    if (location.pathname.startsWith('/shorts/')) return; // don't hijack Shorts scroll navigation

    const video = getVideo();
    if (!video) return;
    if (!isOverPlayer(e.target)) return;
    if (isAdShowing()) return;

    const now = Date.now();
    if (now - lastScroll < THROTTLE_MS) return;
    lastScroll = now;

    e.preventDefault();
    e.stopPropagation();

    if (e.deltaY < 0) {
      // Scroll up → skip forward
      seek(video, SKIP_SECONDS);
      showToast(`⏩ +${SKIP_SECONDS}s`);
    } else {
      // Scroll down → skip backward
      seek(video, -SKIP_SECONDS);
      showToast(`⏪ -${SKIP_SECONDS}s`);
    }
  }

  // Use capture phase so we intercept before YouTube's own handlers
  window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
})();
