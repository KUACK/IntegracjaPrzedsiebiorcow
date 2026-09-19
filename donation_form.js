// donation-form.js (v2) — lista rozwijana + przycisk payu-btn

(function () {
  const form = document.getElementById("donation-form");
  if (!form) return;

  const errorBox = document.getElementById("donation-error");
  const donationBtn = document.getElementById("donationAutopayBtn");
  const donorTypeSelect = document.getElementById("donorType");

  function showFieldsFor(donorType) {
    document.querySelectorAll("[data-donor-fields]").forEach((el) => {
      el.hidden = el.getAttribute("data-donor-fields") !== donorType;
    });
  }

  donorTypeSelect.addEventListener("change", (e) => {
    showFieldsFor(e.target.value);
  });

  // Domyślnie "firma" jest zaznaczona w <select>, więc od razu pokazujemy jej pola.
  showFieldsFor(donorTypeSelect.value);

  function setError(msg) {
    if (!errorBox) return;
    if (!msg) {
      errorBox.hidden = true;
      errorBox.textContent = "";
    } else {
      errorBox.hidden = false;
      errorBox.textContent = msg;
    }
  }

  function redirectToAutopay(redirectUrl, redirectFields) {
    const f = document.createElement("form");
    f.method = "POST";
    f.action = redirectUrl;
    f.style.display = "none";

    Object.entries(redirectFields).forEach(([key, value]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = value;
      f.appendChild(input);
    });

    document.body.appendChild(f);
    f.submit();
  }

  // Przycisk jest type="button" (tak jak #autopayBtn w formularzu zakupu),
  // więc dopiero jego kliknięcie realnie wysyła formularz.
  donationBtn.addEventListener("click", () => {
    form.requestSubmit();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setError("");

    const donorType = donorTypeSelect.value;
    const contactEmail = form.contactEmail.value.trim();
    const amount = form.amount.value;
    const message = form.message.value.trim();
    const consent = document.getElementById("donationConsent").checked;

    if (!consent) {
      setError(
        "Proszę zaakceptować regulamin i zgodę na przetwarzanie danych.",
      );
      return;
    }
    if (!contactEmail) {
      setError("Proszę podać adres e-mail.");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError("Proszę podać kwotę darowizny.");
      return;
    }

    const payload = { donorType, contactEmail, amount, message };

    if (donorType === "private") {
      payload.fullName = form.fullName.value.trim();
      payload.address = form.address.value.trim();
      payload.pesel = form.pesel.value.trim();

      if (!payload.fullName || !payload.address || !payload.pesel) {
        setError("Proszę wypełnić imię i nazwisko, adres oraz PESEL.");
        return;
      }
    }

    if (donorType === "company") {
      payload.companyName = form.companyName.value.trim();
      payload.nip = form.nip.value.trim();
      payload.companyAddress = form.companyAddress.value.trim();

      if (!payload.companyName || !payload.nip || !payload.companyAddress) {
        setError("Proszę wypełnić nazwę firmy, NIP oraz adres firmy.");
        return;
      }
    }

    donationBtn.disabled = true;

    try {
      const res = await fetch("/create-donation-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Nie udało się utworzyć darowizny.");
      }

      const data = await res.json();
      if (!data.ok || !data.redirectUrl || !data.redirectFields) {
        throw new Error("Niepoprawna odpowiedź serwera.");
      }

      redirectToAutopay(data.redirectUrl, data.redirectFields);
    } catch (err) {
      setError(String(err.message || err));
      donationBtn.disabled = false;
    }
  });
})();
