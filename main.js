// TIMER ODLICZAJĄCY — kod KWIECIEN ważny do końca kwietnia 2026
function updateTimer() {
  // 30.04.2026 23:59:59 CEST (UTC+2)
  const endDate = new Date("2026-05-31T23:59:59+02:00").getTime();
  const now = Date.now();
  const distance = endDate - now;

  const el = document.getElementById("timer");
  if (!el) return;

  if (distance < 0) {
    el.innerHTML = "⏱️ Promocja wygasła!";
    return;
  }

  const days = Math.floor(distance / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
  );
  const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((distance % (1000 * 60)) / 1000);

  el.innerHTML = `⏱️ Pozostało: ${days}d ${hours}h ${minutes}m ${seconds}s`;
}

updateTimer();
setInterval(updateTimer, 1000);

// NAWIGACJA STRZAŁKAMI — skakanie po sekcjach
(function () {
  // Definiujemy sekcje w kolejności na stronie
  const SECTION_SELECTORS = [
    "#prelegenci",
    "#program",
    ".banquet", // bankiet / miejsce wydarzenia
    ".tickets-grid", // bilety
    ".site-footer",
  ];

  function getSections() {
    const seen = new Set();
    return SECTION_SELECTORS.flatMap((sel) =>
      Array.from(document.querySelectorAll(sel)),
    ).filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });
  }

  function getCurrentIndex(sections) {
    const scrollY = window.scrollY + window.innerHeight * 0.3;
    let closest = 0;
    let minDist = Infinity;
    sections.forEach((el, i) => {
      const dist = Math.abs(
        el.getBoundingClientRect().top + window.scrollY - scrollY,
      );
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    });
    return closest;
  }

  function scrollToSection(el) {
    // Uwzględniamy przyklejony promo-bar
    const bar = document.querySelector(".promo-bar");
    const offset = bar ? bar.offsetHeight : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - offset - 12;
    window.scrollTo({ top, behavior: "smooth" });
  }

  // Wskaźnik sekcji (małe kropki po prawej stronie)
  function buildDots(sections) {
    const nav = document.createElement("nav");
    nav.id = "section-dots";
    nav.setAttribute("aria-label", "Nawigacja sekcji");
    nav.style.cssText = [
      "position:fixed",
      "right:18px",
      "top:50%",
      "transform:translateY(-50%)",
      "z-index:999",
      "display:flex",
      "flex-direction:column",
      "gap:10px",
      "pointer-events:auto",
    ].join(";");

    sections.forEach((el, i) => {
      const dot = document.createElement("button");
      dot.setAttribute("aria-label", "Sekcja " + (i + 1));
      dot.dataset.index = i;
      dot.style.cssText = [
        "width:10px",
        "height:10px",
        "border-radius:50%",
        "border:2px solid rgba(48,82,117,0.55)",
        "background:transparent",
        "cursor:pointer",
        "transition:background 0.25s,transform 0.25s,border-color 0.25s",
        "padding:0",
      ].join(";");
      dot.addEventListener("click", () => scrollToSection(el));
      nav.appendChild(dot);
    });

    document.body.appendChild(nav);
    return nav;
  }

  function updateDots(nav, index) {
    nav.querySelectorAll("button").forEach((dot, i) => {
      const active = i === index;
      dot.style.background = active
        ? "var(--secondary,#305275)"
        : "transparent";
      dot.style.transform = active ? "scale(1.4)" : "scale(1)";
      dot.style.borderColor = active
        ? "var(--secondary,#305275)"
        : "rgba(48,82,117,0.45)";
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const sections = getSections();
    if (!sections.length) return;

    const dotsNav = buildDots(sections);
    let current = getCurrentIndex(sections);
    updateDots(dotsNav, current);

    // Aktualizacja kropek przy scrollowaniu
    let ticking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          requestAnimationFrame(() => {
            current = getCurrentIndex(sections);
            updateDots(dotsNav, current);
            ticking = false;
          });
          ticking = true;
        }
      },
      { passive: true },
    );

    // Strzałki na klawiaturze
    document.addEventListener("keydown", (e) => {
      // Ignoruj gdy użytkownik pisze w polu formularza
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        current = Math.min(current + 1, sections.length - 1);
        scrollToSection(sections[current]);
        updateDots(dotsNav, current);
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        current = Math.max(current - 1, 0);
        scrollToSection(sections[current]);
        updateDots(dotsNav, current);
      }
    });
  });
})();

document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("welcome-modal");
  const closeBtn = document.getElementById("close-modal");

  // Wyświetlenie okna przy każdym wejściu na stronę
  modal.showModal();

  // Zamknięcie okna po kliknięciu przycisku
  closeBtn.addEventListener("click", () => {
    modal.close();
  });
});

(function () {
  const dayRadios = document.querySelectorAll('input[name="t1-day"]');
  const day1Radio = document.querySelector('input[name="t1-day"][value="9x"]');
  const banquetLine = document.getElementById("t1-banquet-line");
  const banquetCheckbox = document.getElementById("t1-banquet-checkbox");
  const buyBtn = document.getElementById("t1-buy-btn");
  const addonLine = document.getElementById("t1-addon-line");
  const banquetModal = document.getElementById("t1-banquet-modal");
  const banquetYesBtn = document.getElementById("t1-banquet-yes");
  const banquetNoBtn = document.getElementById("t1-banquet-no");

  if (!dayRadios.length || !buyBtn) return;

  function getSelectedDay() {
    const checked = document.querySelector('input[name="t1-day"]:checked');
    return checked ? checked.value : null;
  }

  function updateSelection() {
    const day = getSelectedDay();
    const isDay1 = day === "9x";

    banquetLine.style.display = isDay1 ? "block" : "none";
    if (!isDay1) banquetCheckbox.checked = false;

    const wantsBanquet = isDay1 && banquetCheckbox.checked;
    const effectiveDay = day || "9x";

    let ticketType;
    if (effectiveDay === "9x" && wantsBanquet) {
      ticketType = "jednodniowy9xbankiet";
    } else if (effectiveDay === "9x") {
      ticketType = "jednodniowy9x";
    } else {
      ticketType = "jednodniowy10x";
    }

    buyBtn.setAttribute("href", "buy_form.html?ticket=" + ticketType);
    addonLine.style.display = wantsBanquet ? "block" : "none";
  }

  // Otwarcie okna dialogowego przy KAŻDYM kliknięciu opcji "9x"
  if (day1Radio && banquetModal) {
    day1Radio.addEventListener("click", () => {
      banquetModal.showModal();
    });
  }

  if (banquetYesBtn && banquetModal) {
    banquetYesBtn.addEventListener("click", () => {
      banquetCheckbox.checked = true;
      banquetModal.close();
      updateSelection();
    });
  }

  if (banquetNoBtn && banquetModal) {
    banquetNoBtn.addEventListener("click", () => {
      banquetCheckbox.checked = false;
      banquetModal.close();
      updateSelection();
    });
  }

  // Zamknięcie dialogu np. klawiszem Esc traktujemy jak brak decyzji — checkbox zostaje bez zmian
  if (banquetModal) {
    banquetModal.addEventListener("close", updateSelection);
  }

  dayRadios.forEach(function (radio) {
    radio.addEventListener("change", updateSelection);
  });
  banquetCheckbox.addEventListener("change", updateSelection);

  updateSelection();
})();
// =========================================================
// PRELEGENT — inteligentne pozycjonowanie okienka po najechaniu
// Wstaw ten kod na końcu main.js albo w nowym <script> przed </body>
// (razem z prelegent-popup.css z tego samego zestawu)
// =========================================================

function initPrelegentTooltips() {
  const wrappers = document.querySelectorAll(".prelegent-tooltip");

  wrappers.forEach(function (wrap) {
    const popup = wrap.querySelector(".prelegent-popup");
    if (!popup) return;

    // desktop: mysz - liczymy miejsce tuż przed pokazaniem okna
    wrap.addEventListener("mouseenter", function () {
      positionPopup(wrap, popup);
    });

    // telefon/tablet: dotyk (na wypadek gdyby ktoś odpalał hover przez tap)
    wrap.addEventListener(
      "touchstart",
      function () {
        positionPopup(wrap, popup);
      },
      { passive: true },
    );
  });

  // przelicz przy zmianie rozmiaru okna (np. obrót telefonu)
  window.addEventListener("resize", function () {
    wrappers.forEach(function (wrap) {
      const popup = wrap.querySelector(".prelegent-popup");
      if (
        (popup && popup.classList.contains("pos-left")) ||
        (popup && popup.classList.contains("pos-right")) ||
        (popup && popup.classList.contains("pos-top")) ||
        (popup && popup.classList.contains("pos-bottom"))
      ) {
        positionPopup(wrap, popup);
      }
    });
  });
}

function positionPopup(wrap, popup) {
  popup.classList.remove("pos-left", "pos-right", "pos-top", "pos-bottom");

  const isMobile = window.innerWidth <= 900;
  const rect = wrap.getBoundingClientRect();

  if (isMobile) {
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    popup.classList.add(spaceBelow >= spaceAbove ? "pos-bottom" : "pos-top");
  } else {
    const spaceLeft = rect.left;
    const spaceRight = window.innerWidth - rect.right;
    popup.classList.add(spaceRight >= spaceLeft ? "pos-right" : "pos-left");
  }
}

document.addEventListener("DOMContentLoaded", initPrelegentTooltips);
