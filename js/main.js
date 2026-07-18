/**
 * main.js
 * Ties together the socket connection, login flow, player, chat, sync
 * requests, presence, and toasts.
 */
(function () {
  const SERVER_URL = window.APP_CONFIG.SERVER_URL;
  const STORAGE_KEY = "watch-together:session";

  // --- DOM refs ------------------------------------------------------------
  const loginScreen = document.getElementById("login-screen");
  const fullScreen = document.getElementById("full-screen");
  const appScreen = document.getElementById("app-screen");

  const loginForm = document.getElementById("login-form");
  const usernameInput = document.getElementById("username-input");
  const loginError = document.getElementById("login-error");
  const loginSubmit = document.getElementById("login-submit");
  const retryBtn = document.getElementById("retry-btn");

  const headerUsers = document.getElementById("header-users");
  const pingBadge = document.getElementById("ping-badge");
  const connBadge = document.getElementById("conn-badge");
  const chatConnBadge = document.getElementById("chat-conn-badge");

  const meTimeEl = document.getElementById("me-time");
  const meStateEl = document.getElementById("me-state");
  const peerNameEl = document.getElementById("peer-name");
  const peerTimeEl = document.getElementById("peer-time");
  const peerStateEl = document.getElementById("peer-state");
  const legendPeerName = document.getElementById("legend-peer-name");
  const progressMe = document.getElementById("progress-me");
  const progressPeer = document.getElementById("progress-peer");
  const watchDurationEl = document.getElementById("watch-duration");
  const movieDurationEl = document.getElementById("movie-duration");
  const syncBtn = document.getElementById("sync-btn");

  const syncModal = document.getElementById("sync-modal");
  const syncModalText = document.getElementById("sync-modal-text");
  const syncAcceptBtn = document.getElementById("sync-accept");
  const syncDeclineBtn = document.getElementById("sync-decline");

  const videoErrorOverlay = document.getElementById("video-error");
  const videoErrorText = document.getElementById("video-error-text");
  const videoLoadingOverlay = document.getElementById("video-loading");

  // --- state -----------------------------------------------------------
  let socket = null;
  let me = { userId: null, username: null };
  let peer = null; // public user object from users:update, excluding me
  let joinedAt = null;
  let watchTimer = null;
  let pendingSyncFromUserId = null;
  let lastPlaybackSentAt = 0;

  function saveSession(userId, username) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, username }));
    } catch (e) { /* ignore storage errors (private browsing etc.) */ }
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearSession() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  function showScreen(screen) {
    [loginScreen, fullScreen, appScreen].forEach((s) => (s.hidden = s !== screen));
  }

  function setLoginLoading(loading) {
    loginSubmit.disabled = loading;
    loginSubmit.querySelector(".btn-label").hidden = loading;
    loginSubmit.querySelector(".spinner").hidden = !loading;
  }

  function setLoginError(msg) {
    if (!msg) {
      loginError.hidden = true;
      loginError.textContent = "";
    } else {
      loginError.hidden = false;
      loginError.textContent = msg;
    }
  }

  // --- header user chips --------------------------------------------------
  function renderUserChips(users) {
    headerUsers.innerHTML = "";
    users.forEach((u) => {
      const chip = document.createElement("div");
      const isMe = u.userId === me.userId;
      const stateClass = u.connected ? (u.playback.playing ? "playing" : "online") : "";
      chip.className = `user-chip ${stateClass} ${isMe ? "me" : ""}`;
      chip.innerHTML = `
        <span class="status-dot"></span>
        <span>${isMe ? "You" : escapeHtml(u.username)}</span>
        <span class="chip-sub">${u.connected ? (u.playback.playing ? "watching" : "paused") : "offline"}</span>
      `;
      headerUsers.appendChild(chip);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // --- peer / progress rendering ------------------------------------------
  function renderProgress() {
    const duration = window.VideoPlayer.duration;
    const myPct = duration ? (window.VideoPlayer.currentTime / duration) * 100 : 0;
    progressMe.style.width = `${Math.min(100, Math.max(0, myPct))}%`;

    meTimeEl.textContent = window.VideoPlayer.formatTime(window.VideoPlayer.currentTime);
    meStateEl.textContent = window.VideoPlayer.playing ? "Playing" : "Paused";

    if (peer && peer.connected) {
      const peerDuration = peer.playback.duration || duration;
      const peerPct = peerDuration ? (peer.playback.currentTime / peerDuration) * 100 : 0;
      progressPeer.style.width = `${Math.min(100, Math.max(0, peerPct))}%`;
      peerTimeEl.textContent = window.VideoPlayer.formatTime(peer.playback.currentTime);
      peerStateEl.textContent = peer.playback.buffering
        ? "Buffering…"
        : peer.playback.playing
        ? `Playing (${peer.playback.speed}x)`
        : "Paused";
    } else {
      progressPeer.style.width = "0%";
      peerTimeEl.textContent = "--:--:--";
      peerStateEl.textContent = "Offline";
    }
  }

  function updatePeerNameLabels() {
    const name = peer ? peer.username : "Friend";
    peerNameEl.textContent = name;
    legendPeerName.textContent = name;
  }

  function startWatchTimer() {
    joinedAt = Date.now();
    clearInterval(watchTimer);
    watchTimer = setInterval(() => {
      const mins = Math.floor((Date.now() - joinedAt) / 60000);
      watchDurationEl.textContent = mins < 1 ? "just started" : `${mins}m`;
    }, 15000);
  }

  // --- connection status ---------------------------------------------------
  function setConnected(connected) {
    [connBadge, chatConnBadge].forEach((el) => {
      el.classList.toggle("offline", !connected);
      el.querySelector(".dot") && (el.querySelector(".dot").style.background = connected ? "" : "");
    });
    connBadge.innerHTML = connected
      ? '<span class="dot"></span> Connected'
      : '<span class="dot"></span> Reconnecting…';
    chatConnBadge.innerHTML = connected
      ? '<span class="dot"></span> Live'
      : '<span class="dot"></span> Offline';
  }

  // --- socket setup --------------------------------------------------------
  function connectSocket() {
    socket = io(SERVER_URL, {
      transports: ["websocket", "polling"],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on("connect", () => {
      setConnected(true);
      // Ping loop for latency display
      startPingLoop();
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("reconnect", () => {
      window.showToast("Reconnected to the server.", "success");
    });

    socket.on("connect_error", () => {
      setConnected(false);
    });

    socket.on("pong:server", (sentAt) => {
      const rtt = Date.now() - sentAt;
      pingBadge.textContent = `${rtt} ms`;
    });

    socket.on("users:update", ({ users }) => {
      peer = users.find((u) => u.userId !== me.userId) || null;
      renderUserChips(users);
      updatePeerNameLabels();
      renderProgress();
    });

    socket.on("playback:peer", ({ userId, username, playback, watchTimeMs }) => {
      if (!peer || peer.userId !== userId) {
        peer = { userId, username, connected: true, playback, watchTimeMs };
      } else {
        peer.playback = playback;
        peer.watchTimeMs = watchTimeMs;
      }
      renderProgress();
    });

    socket.on("notify", ({ type, message }) => {
      const toneMap = {
        "user-joined": "success",
        "user-left": "warn",
        reconnected: "success",
        "sync-accepted": "success",
      };
      window.showToast(message, toneMap[type] || "info");
    });

    socket.on("sync:incoming", ({ fromUserId, fromUsername }) => {
      pendingSyncFromUserId = fromUserId;
      syncModalText.textContent = `${fromUsername} wants to sync with your current position.`;
      syncModal.hidden = false;
    });

    socket.on("sync:accepted", ({ byUsername, toTimestamp, peerPlaying }) => {
      window.VideoPlayer.seekTo(toTimestamp);
      if (peerPlaying && window.VideoPlayer.el.paused) {
        window.VideoPlayer.el.play().catch(() => {});
      }
      window.showToast(`Jumped to ${byUsername}'s position.`, "success");
    });

    socket.on("sync:declined", ({ byUsername }) => {
      window.showToast(`${byUsername} declined the sync request.`, "warn");
    });

    socket.on("chat:message", (msg) => {
      window.ChatUI.renderMessage(msg);
    });

    socket.on("chat:typing", ({ username, typing }) => {
      window.ChatUI.setTypingIndicator(username, typing);
    });
  }

  function startPingLoop() {
    const tick = () => {
      if (socket && socket.connected) socket.emit("ping:client", Date.now());
    };
    tick();
    setInterval(tick, 5000);
  }

  // --- join flow -------------------------------------------------------
  function attemptJoin(username, rejoinUserId) {
    setLoginLoading(true);
    setLoginError(null);

    if (!socket) connectSocket();

    const doJoin = () => {
      socket.emit("join", { username, userId: rejoinUserId }, (res) => {
        setLoginLoading(false);
        if (!res.ok) {
          if (res.reason && res.reason.toLowerCase().includes("full")) {
            showScreen(fullScreen);
          } else {
            setLoginError(res.reason || "Couldn't join. Try a different username.");
          }
          return;
        }

        me = { userId: res.userId, username: res.username };
        saveSession(res.userId, res.username);
        window.ChatUI.init({ userId: res.userId });

        loadMovie();

        window.ChatUI.renderHistory(res.chatHistory || []);
        renderUserChips(res.users || []);
        peer = (res.users || []).find((u) => u.userId !== me.userId) || null;
        updatePeerNameLabels();

        startWatchTimer();
        showScreen(appScreen);

        if (res.reconnected) {
          window.showToast("Welcome back — you're reconnected.", "success");
        }
      });
    };

    if (socket.connected) doJoin();
    else socket.once("connect", doJoin);
  }

  function loadMovie() {
    const movieUrl = window.APP_CONFIG.MOVIE_URL;
    if (!movieUrl || movieUrl.includes("YOUR-")) {
      videoLoadingOverlay.hidden = true;
      videoErrorOverlay.hidden = false;
      videoErrorText.textContent = "No movie URL configured yet. Set MOVIE_URL in config.js.";
      return;
    }
    window.VideoPlayer.setSource(movieUrl);
    videoErrorOverlay.hidden = true;
  }

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    if (!username) return;
    attemptJoin(username, null);
  });

  retryBtn.addEventListener("click", () => {
    showScreen(loginScreen);
  });

  // --- playback -> server (throttled to ~1/sec) ---------------------------
  window.VideoPlayer.onStateChange((patch) => {
    const now = Date.now();
    if (now - lastPlaybackSentAt < 900) return;
    lastPlaybackSentAt = now;
    if (!socket || !socket.connected) return;
    socket.emit("playback:update", {
      currentTime: window.VideoPlayer.currentTime,
      duration: window.VideoPlayer.duration,
      playing: window.VideoPlayer.playing,
      speed: window.VideoPlayer.el.playbackRate,
      buffering: false,
      ...patch,
    });
    renderProgress();
  });

  window.VideoPlayer.el.addEventListener("loadedmetadata", () => {
    movieDurationEl.textContent = window.VideoPlayer.formatTime(window.VideoPlayer.duration);
  });

  // --- sync request/response ----------------------------------------------
  syncBtn.addEventListener("click", () => {
    if (!peer || !peer.connected) {
      window.showToast("Your friend isn't connected right now.", "warn");
      return;
    }
    socket.emit("sync:request");
    window.showToast("Sync request sent.", "info");
  });

  syncAcceptBtn.addEventListener("click", () => {
    socket.emit("sync:response", { accept: true, toUserId: pendingSyncFromUserId });
    syncModal.hidden = true;
  });

  syncDeclineBtn.addEventListener("click", () => {
    socket.emit("sync:response", { accept: false, toUserId: pendingSyncFromUserId });
    syncModal.hidden = true;
  });

  // --- chat wiring ----------------------------------------------------
  window.ChatUI.onSend((text) => {
    if (socket && socket.connected) socket.emit("chat:message", { text });
  });
  window.ChatUI.onTyping((typing) => {
    if (socket && socket.connected) socket.emit("chat:typing", typing);
  });

  // --- boot: try to resume a previous session (handles page refresh) ------
  (function boot() {
    connectSocket();
    const saved = loadSession();
    if (saved && saved.userId && saved.username) {
      usernameInput.value = saved.username;
      attemptJoin(saved.username, saved.userId);
    }
  })();

  // periodic UI refresh for progress bars / peer state even without new events
  setInterval(renderProgress, 1000);
})();
