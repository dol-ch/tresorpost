// Set the theme before first paint to avoid a flash of the wrong colors.
// Kept as an external, same-origin file (not inline) so it runs under a
// strict `script-src 'self'` CSP without needing 'unsafe-inline' or a hash.
(function () {
  try {
    var t = localStorage.getItem("et_theme");
    if (t !== "light" && t !== "dark") {
      t = window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    }
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
