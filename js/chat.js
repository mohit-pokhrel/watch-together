/**
 * chat.js
 * Handles rendering chat messages, the typing indicator, and form submission.
 * Talks to main.js via a small callback-based API rather than owning the socket.
 */
(function () {
  const messagesEl = document.getElementById("chat-messages");
  const formEl = document.getElementById("chat-form");
  const inputEl = document.getElementById("chat-input");
  const typingEl = document.getElementById("typing-indicator");

  let onSend = null;
  let onTyping = null;
  let myUserId = null;
  let typingTimeout = null;

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatClock(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderMessage(msg) {
    const wrap = document.createElement("div");
    const mine = msg.userId === myUserId;
    wrap.className = `chat-msg ${mine ? "mine" : ""}`;
    wrap.innerHTML = `
      <div class="msg-meta">
        <span>${mine ? "You" : escapeHtml(msg.username)}</span>
        <span>${formatClock(msg.timestamp)}</span>
      </div>
      <div class="msg-bubble">${escapeHtml(msg.text)}</div>
    `;
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function renderSystemMessage(text) {
    const wrap = document.createElement("div");
    wrap.className = "chat-msg system";
    wrap.innerHTML = `<div class="msg-bubble">${escapeHtml(text)}</div>`;
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function renderHistory(history) {
    messagesEl.innerHTML = "";
    history.forEach(renderMessage);
  }

  function setTypingIndicator(username, typing) {
    if (typing) {
      typingEl.hidden = false;
      typingEl.textContent = `${username} is typing…`;
    } else {
      typingEl.hidden = true;
      typingEl.textContent = "";
    }
  }

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    if (typeof onSend === "function") onSend(text);
    inputEl.value = "";
    if (typeof onTyping === "function") onTyping(false);
  });

  inputEl.addEventListener("input", () => {
    if (typeof onTyping !== "function") return;
    onTyping(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => onTyping(false), 1500);
  });

  window.ChatUI = {
    init({ userId }) {
      myUserId = userId;
    },
    renderMessage,
    renderSystemMessage,
    renderHistory,
    setTypingIndicator,
    onSend(cb) { onSend = cb; },
    onTyping(cb) { onTyping = cb; },
  };
})();
