/**
 * player.js
 * Wraps the native <video> element with fully custom controls. Each user's
 * player is entirely independent - nothing here ever reacts to the other
 * user except through an explicit, opt-in "sync" jump triggered by main.js.
 */
(function () {
  const video = document.getElementById("video");
  const seekBar = document.getElementById("seek-bar");
  const btnPlay = document.getElementById("btn-play");
  const btnBack10 = document.getElementById("btn-back10");
  const btnFwd10 = document.getElementById("btn-fwd10");
  const btnMute = document.getElementById("btn-mute");
  const btnPip = document.getElementById("btn-pip");
  const btnFullscreen = document.getElementById("btn-fullscreen");
  const volumeBar = document.getElementById("volume-bar");
  const speedSelect = document.getElementById("speed-select");
  const timeCurrent = document.getElementById("time-current");
  const timeDuration = document.getElementById("time-duration");
  const loadingOverlay = document.getElementById("video-loading");
  const errorOverlay = document.getElementById("video-error");
  const errorText = document.getElementById("video-error-text");
  const videoWrap = document.getElementById("video-wrap");

  let isSeeking = false;
  let onStateChange = null; // callback(patch) invoked on meaningful playback changes
  let hls = null; // active Hls.js instance, if any

  function formatTime(totalSeconds) {
    if (!isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function setSource(url) {
    // Tear down any previous Hls.js instance before attaching a new source.
    if (hls) {
      hls.destroy();
      hls = null;
    }

    const isHls = url.endsWith(".m3u8");

    if (isHls && window.Hls && window.Hls.isSupported()) {
      // Chrome / Firefox / Edge: hls.js does the MediaSource work.
      hls = new window.Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (!data.fatal) return;
        console.error("HLS fatal error:", data.type, data.details);
        loadingOverlay.hidden = true;
        errorOverlay.hidden = false;
        errorText.textContent = "Couldn't load the movie stream. Try refreshing the page.";
      });
    } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari has native HLS support - no library needed.
      video.src = url;
      video.load();
    } else {
      // Plain file (mp4/webm/etc).
      video.src = url;
      video.load();
    }
  }

  function notify(patch) {
    if (typeof onStateChange === "function") onStateChange(patch);
  }

  // --- basic transport ------------------------------------------------
  function togglePlay() {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function skip(deltaSeconds) {
    video.currentTime = Math.min(Math.max(0, video.currentTime + deltaSeconds), video.duration || Infinity);
  }

  function seekTo(seconds) {
    video.currentTime = Math.max(0, seconds);
  }

  function setSpeed(rate) {
    video.playbackRate = rate;
    notify({ speed: rate });
  }

  // --- UI wiring --------------------------------------------------------
  btnPlay.addEventListener("click", togglePlay);
  btnBack10.addEventListener("click", () => skip(-10));
  btnFwd10.addEventListener("click", () => skip(10));

  btnMute.addEventListener("click", () => {
    video.muted = !video.muted;
    btnMute.textContent = video.muted || video.volume === 0 ? "🔇" : "🔊";
  });

  volumeBar.addEventListener("input", () => {
    video.volume = parseFloat(volumeBar.value);
    video.muted = video.volume === 0;
    btnMute.textContent = video.muted ? "🔇" : "🔊";
  });

  speedSelect.addEventListener("change", () => setSpeed(parseFloat(speedSelect.value)));

  btnPip.addEventListener("click", async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      } else {
        window.showToast("Picture-in-picture isn't supported in this browser.", "warn");
      }
    } catch (err) {
      window.showToast("Couldn't enter picture-in-picture.", "error");
    }
  });

  btnFullscreen.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      videoWrap.requestFullscreen().catch(() => {
        window.showToast("Fullscreen isn't available right now.", "warn");
      });
    }
  });

  seekBar.addEventListener("mousedown", () => (isSeeking = true));
  seekBar.addEventListener("touchstart", () => (isSeeking = true), { passive: true });
  seekBar.addEventListener("input", () => {
    if (!video.duration) return;
    const pct = parseFloat(seekBar.value) / 100;
    timeCurrent.textContent = formatTime(pct * video.duration);
  });
  const commitSeek = () => {
    if (!video.duration) return;
    const pct = parseFloat(seekBar.value) / 100;
    seekTo(pct * video.duration);
    isSeeking = false;
  };
  seekBar.addEventListener("change", commitSeek);
  seekBar.addEventListener("mouseup", () => setTimeout(() => (isSeeking = false), 50));
  seekBar.addEventListener("touchend", () => setTimeout(() => (isSeeking = false), 50));

  // --- native video events ----------------------------------------------
  video.addEventListener("loadedmetadata", () => {
    loadingOverlay.hidden = true;
    timeDuration.textContent = formatTime(video.duration);
    notify({ duration: video.duration });
  });

  video.addEventListener("waiting", () => {
    loadingOverlay.hidden = false;
    notify({ buffering: true });
  });
  video.addEventListener("playing", () => {
    loadingOverlay.hidden = true;
    notify({ buffering: false, playing: true });
  });
  video.addEventListener("canplay", () => {
    loadingOverlay.hidden = true;
  });

  video.addEventListener("play", () => {
    btnPlay.textContent = "❚❚";
    notify({ playing: true });
  });
  video.addEventListener("pause", () => {
    btnPlay.textContent = "▶";
    notify({ playing: false });
  });

  video.addEventListener("timeupdate", () => {
    if (!video.duration || isSeeking) return;
    const pct = (video.currentTime / video.duration) * 100;
    seekBar.value = pct;
    timeCurrent.textContent = formatTime(video.currentTime);
    notify({ currentTime: video.currentTime });
  });

  video.addEventListener("error", () => {
    loadingOverlay.hidden = true;
    errorOverlay.hidden = false;
    const codeMap = {
      1: "Loading was aborted.",
      2: "A network error occurred while loading the movie.",
      3: "The movie could not be decoded.",
      4: "The movie format isn't supported or the file wasn't found.",
    };
    const code = video.error ? video.error.code : 0;
    errorText.textContent = codeMap[code] || "Couldn't load the movie.";
  });

  document.addEventListener("fullscreenchange", () => {
    btnFullscreen.textContent = document.fullscreenElement ? "⤢" : "⛶";
  });

  // --- keyboard shortcuts -------------------------------------------------
  document.addEventListener("keydown", (e) => {
    // Ignore shortcuts while typing in an input/textarea
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    switch (e.code) {
      case "Space":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowLeft":
        skip(-10);
        break;
      case "ArrowRight":
        skip(10);
        break;
      case "KeyF":
        btnFullscreen.click();
        break;
      case "KeyM":
        btnMute.click();
        break;
      default:
        break;
    }
  });

  window.VideoPlayer = {
    el: video,
    setSource,
    togglePlay,
    skip,
    seekTo,
    setSpeed,
    formatTime,
    get currentTime() { return video.currentTime; },
    get duration() { return video.duration || 0; },
    get playing() { return !video.paused; },
    onStateChange(cb) { onStateChange = cb; },
  };
})();
