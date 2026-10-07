(() => {
  "use strict";
  const PIXEL_ID = "1811951373280330";
  // Ustaw prawdziwy adres polityki prywatnosci przed publikacja.
  const PRIVACY_URL =
    "https://integracjaprzedsiebiorcow.eu/polityka-prywatnosci";
  const KEY = "meta-cookie-choice-v1";
  const TTL = 180 * 24 * 60 * 60 * 1000;
  let choice = null;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (
      saved &&
      ["accepted", "rejected"].includes(saved.value) &&
      Number.isFinite(saved.at) &&
      Date.now() - saved.at >= 0 &&
      Date.now() - saved.at < TTL
    )
      choice = saved.value;
  } catch (_) {}

  const box = document.createElement("section");
  box.id = "cookie-note";
  box.hidden = true;
  box.setAttribute("role", "region");
  box.setAttribute("aria-labelledby", "cookie-note-title");
  box.innerHTML = `
    <h2 id="cookie-note-title">Twoja prywatność</h2>
    <p>
  Za Twoją zgodą użyjemy cookies reklamowych i Meta Pixela do pomiaru skuteczności i dopasowywania reklam. <a id="cookie-privacy">Polityka prywatności</a>
</p>
    
    <div class="cookie-actions">
      <button type="button" data-choice="rejected">Odrzucam</button>
      <button type="button" data-choice="accepted">Akceptuję</button>
    </div>`;
  document.body.appendChild(box);
  const link = box.querySelector("#cookie-privacy");
  if (!PRIVACY_URL.startsWith("UZUPELNIJ")) link.href = PRIVACY_URL;
  else link.hidden = true;

  let started = false;
  function startPixel() {
    if (started || choice !== "accepted") return;
    started = true;
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod
          ? n.callMethod.apply(n, arguments)
          : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(
      window,
      document,
      "script",
      "https://connect.facebook.net/en_US/fbevents.js",
    );
    fbq("consent", "grant");
    fbq("init", PIXEL_ID);
    fbq("track", "PageView");
  }
  function stopPixel() {
    if (window.fbq) window.fbq("consent", "revoke");
    const host = location.hostname;
    const domains = [null, host];
    const parts = host.split(".");
    for (let i = 0; i < parts.length - 1; i++)
      domains.push("." + parts.slice(i).join("."));
    for (const name of ["_fbp", "_fbc"]) {
      for (const domain of domains) {
        document.cookie =
          name +
          "=; Max-Age=0; Path=/; SameSite=Lax" +
          (domain ? "; Domain=" + domain : "");
      }
    }
  }
  let opener = null;
  box.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-choice]");
    if (!button) return;
    choice = button.dataset.choice;
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ value: choice, at: Date.now() }),
      );
    } catch (_) {}
    box.hidden = true;
    if (opener) opener.focus();
    if (choice === "accepted") startPixel();
    else {
      stopPixel();
      if (started) location.reload();
    }
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cookie-settings]");
    if (!button) return;
    opener = button;
    box.hidden = false;
    box.querySelector("button").focus();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === KEY || event.key === null) {
      stopPixel();
      location.reload();
    }
  });
  if (choice === "accepted") startPixel();
  else if (choice === null) box.hidden = false;
})();
