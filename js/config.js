/**
 * config.js
 * Single place to point the frontend at your backend deployment.
 * When running locally with the default backend port, this needs no changes.
 * When you deploy (e.g. frontend on GitHub Pages, backend on Render), set
 * SERVER_URL to your backend's public URL.
 */
window.APP_CONFIG = {
  // Change this to your deployed backend URL, e.g. "https://watch-together-api.onrender.com"
  SERVER_URL: window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:4000"
    : "https://YOUR-BACKEND-URL-HERE.onrender.com",
};
