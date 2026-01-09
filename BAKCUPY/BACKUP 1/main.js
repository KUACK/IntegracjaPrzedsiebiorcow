// TIMER ODLICZAJĄCY
function updateTimer() {
  const endDate = new Date("2026-01-31T23:59:59").getTime();
  const now = new Date().getTime();
  const distance = endDate - now;

  if (distance < 0) {
    document.getElementById("timer").innerHTML = "⏱️ Promocja wygasła!";
    return;
  }

  const days = Math.floor(distance / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  );
  const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((distance % (1000 * 60)) / 1000);

  document.getElementById(
    "timer"
  ).innerHTML = `⏱️ Pozostało: ${days}d ${hours}h ${minutes}m ${seconds}s`;
}

updateTimer();
setInterval(updateTimer, 1000);

// OBSŁUGA FORMULARZA
document
  .getElementById("registrationForm")
  .addEventListener("submit", function (e) {
    e.preventDefault();

    const formData = {
      firstName: document.getElementById("firstName").value,
      lastName: document.getElementById("lastName").value,
      email: document.getElementById("email").value,
      phone: document.getElementById("phone").value,
      company: document.getElementById("company").value,
      ticket: document.getElementById("ticket").value,
      promo: document.getElementById("promo").value,
    };

    console.log("Formularz wysłany:", formData);
    alert(
      `✅ Dziękujemy ${formData.firstName}! \n\nTwoja rejestracja została przyjęta.\nPotwierdzenie wysłane na: ${formData.email}`
    );

    // Opcjonalnie: wyczyść formularz
    // this.reset();
  });

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
