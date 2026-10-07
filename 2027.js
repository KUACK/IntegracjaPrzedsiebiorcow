"use strict";
(() => {
  const form = document.getElementById("order2027"),
    fields = document.getElementById("fields2027"),
    ticket = document.getElementById("ticket2027"),
    quantity = document.getElementById("quantity2027"),
    message = document.getElementById("message2027");
  const deadline = Date.parse("2026-10-13T00:00:00+02:00");
  let busy = false,
    closed = false;
  function tick() {
    const ms = Math.max(0, deadline - Date.now()),
      s = Math.floor(ms / 1000),
      ended = closed || ms === 0;
    fields.disabled = busy || ended;
    document
      .querySelectorAll(".choose2027")
      .forEach((b) => (b.disabled = busy || ended));
    document.getElementById("countdown").textContent = ended
      ? "Sprzedaż zakończona"
      : `${Math.floor(s / 86400)} dni · ${Math.floor(s / 3600) % 24} godz · ${Math.floor(s / 60) % 60} min · ${s % 60} sek`;
    document.getElementById("sale-status").textContent = ended
      ? "Zakup został wyłączony."
      : "Oferta do końca 12 października 2026 (czas polski).";
  }
  function total() {
    const q = Number(quantity.value);
    document.getElementById("total2027").textContent =
      Number.isInteger(q) && q >= 1 && q <= 20
        ? new Intl.NumberFormat("pl-PL", {
            style: "currency",
            currency: "PLN",
          }).format(q * (ticket.value === "obra2027nocleg" ? 790 : 3))
        : "—";
  }
  document.querySelectorAll(".choose2027").forEach((b) =>
    b.addEventListener("click", () => {
      ticket.value = b.dataset.ticket;
      total();
      document.getElementById("zakup").scrollIntoView({ behavior: "smooth" });
    }),
  );
  ticket.addEventListener("change", total);
  quantity.addEventListener("input", total);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || closed || Date.now() >= deadline) {
      tick();
      return;
    }
    if (!form.reportValidity()) return;
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.quantity = Number(payload.quantity);
    payload.consent = true;
    busy = true;
    tick();
    message.textContent = "Tworzę zamówienie…";
    try {
      const res = await fetch("/api/create-order-2027", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
      if (!res.ok) {
        if (res.status === 410) closed = true;
        throw new Error(data?.error || "Nie udało się utworzyć zamówienia.");
      }
      if (
        !data?.redirectUrl ||
        !data.redirectFields ||
        data.redirectMethod !== "POST"
      )
        throw new Error(
          "Brak danych płatności. Skontaktuj się z organizatorem przed ponownym zakupem.",
        );
      const url = new URL(data.redirectUrl);
      if (url.protocol !== "https:")
        throw new Error("Nieprawidłowy adres płatności.");
      const pf = document.createElement("form");
      pf.method = "POST";
      pf.action = url.href;
      pf.hidden = true;
      for (const [k, v] of Object.entries(data.redirectFields)) {
        const i = document.createElement("input");
        i.type = "hidden";
        i.name = k;
        i.value = String(v);
        pf.appendChild(i);
      }
      document.body.appendChild(pf);
      message.textContent = "Przekierowuję do Autopay…";
      pf.submit();
    } catch (err) {
      message.textContent = err.message || "Błąd połączenia.";
      busy = false;
      tick();
    }
  });
  total();
  tick();
  setInterval(tick, 1000);
})();
