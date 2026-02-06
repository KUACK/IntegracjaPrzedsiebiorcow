// TIMER ODLICZAJĄCY
function updateTimer() {
  const endDate = new Date("2026-02-28T23:59:59").getTime();
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
