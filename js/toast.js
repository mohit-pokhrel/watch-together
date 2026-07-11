/**
 * toast.js
 * Small helper for showing dismissable toast notifications.
 */
(function () {
  const container = document.getElementById("toast-container");

  function showToast(message, type = "info", durationMs = 4200) {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="dot"></span><span class="toast-text"></span>`;
    el.querySelector(".toast-text").textContent = message;
    container.appendChild(el);

    const remove = () => {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 220);
    };

    const timer = setTimeout(remove, durationMs);
    el.addEventListener("click", () => {
      clearTimeout(timer);
      remove();
    });
  }

  window.showToast = showToast;
})();
