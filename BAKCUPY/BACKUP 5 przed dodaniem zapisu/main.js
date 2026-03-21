// TIMER ODLICZAJĄCY — kod KWIECIEN ważny do końca kwietnia 2026
function updateTimer() {
  // 30.04.2026 23:59:59 CEST (UTC+2)
  const endDate = new Date("2026-04-30T23:59:59+02:00").getTime();
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
    '#prelegenci',
    '#program',
    '.banquet',          // bankiet / miejsce wydarzenia
    '.tickets-grid',     // bilety
    '.site-footer',
  ];

  function getSections() {
    const seen = new Set();
    return SECTION_SELECTORS
      .flatMap(sel => Array.from(document.querySelectorAll(sel)))
      .filter(el => {
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
      const dist = Math.abs(el.getBoundingClientRect().top + window.scrollY - scrollY);
      if (dist < minDist) { minDist = dist; closest = i; }
    });
    return closest;
  }

  function scrollToSection(el) {
    // Uwzględniamy przyklejony promo-bar
    const bar = document.querySelector('.promo-bar');
    const offset = bar ? bar.offsetHeight : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - offset - 12;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  // Wskaźnik sekcji (małe kropki po prawej stronie)
  function buildDots(sections) {
    const nav = document.createElement('nav');
    nav.id = 'section-dots';
    nav.setAttribute('aria-label', 'Nawigacja sekcji');
    nav.style.cssText = [
      'position:fixed', 'right:18px', 'top:50%', 'transform:translateY(-50%)',
      'z-index:999', 'display:flex', 'flex-direction:column', 'gap:10px',
      'pointer-events:auto',
    ].join(';');

    sections.forEach((el, i) => {
      const dot = document.createElement('button');
      dot.setAttribute('aria-label', 'Sekcja ' + (i + 1));
      dot.dataset.index = i;
      dot.style.cssText = [
        'width:10px', 'height:10px', 'border-radius:50%',
        'border:2px solid rgba(48,82,117,0.55)',
        'background:transparent', 'cursor:pointer',
        'transition:background 0.25s,transform 0.25s,border-color 0.25s',
        'padding:0',
      ].join(';');
      dot.addEventListener('click', () => scrollToSection(el));
      nav.appendChild(dot);
    });

    document.body.appendChild(nav);
    return nav;
  }

  function updateDots(nav, index) {
    nav.querySelectorAll('button').forEach((dot, i) => {
      const active = i === index;
      dot.style.background = active ? 'var(--secondary,#305275)' : 'transparent';
      dot.style.transform = active ? 'scale(1.4)' : 'scale(1)';
      dot.style.borderColor = active
        ? 'var(--secondary,#305275)'
        : 'rgba(48,82,117,0.45)';
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const sections = getSections();
    if (!sections.length) return;

    const dotsNav = buildDots(sections);
    let current = getCurrentIndex(sections);
    updateDots(dotsNav, current);

    // Aktualizacja kropek przy scrollowaniu
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          current = getCurrentIndex(sections);
          updateDots(dotsNav, current);
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });

    // Strzałki na klawiaturze
    document.addEventListener('keydown', (e) => {
      // Ignoruj gdy użytkownik pisze w polu formularza
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        current = Math.min(current + 1, sections.length - 1);
        scrollToSection(sections[current]);
        updateDots(dotsNav, current);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        current = Math.max(current - 1, 0);
        scrollToSection(sections[current]);
        updateDots(dotsNav, current);
      }
    });
  });
})();

// OBSŁUGA PRZYCISKÓW "KUP TERAZ"
document.querySelectorAll(".btn-buy").forEach((button) => {
  button.addEventListener("click", function () {
    const card = this.closest(".ticket-card");
    const ticketName = card.querySelector(".ticket-name").textContent;
    const price = card.querySelector(".new-price").textContent;

    document.getElementById("ticket").value = ticketName
      .toLowerCase()
      .replace(/\s+/g, "-");
    document
      .querySelector(".form-section")
      .scrollIntoView({ behavior: "smooth" });
  });
});
