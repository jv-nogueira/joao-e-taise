"use strict";

(() => {
  // Cole aqui a URL do Web App publicado no Google Apps Script.
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzBpMSMETjv0Cv9hZTYMmC6c38IuRIZzQAQ8E3hARu7TUiQzQEJapsc5IhBMBli5suK/exec";
  const API_CHANNEL = "joao-taise-rsvp";
  const BR_PHONE_LENGTHS = [10, 11];

  const onlyDigits = (value) => String(value || "").replace(/\D/g, "");
  const formatPhone = (value) => {
    const digits = onlyDigits(value).slice(0, 11);
    if (digits.length <= 2) return digits.length ? `(${digits}` : "";
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  function sendToAppsScript(method, fields) {
    return new Promise((resolve, reject) => {
      if (!APPS_SCRIPT_URL.startsWith("https://script.google.com/macros/s/")) {
        reject(new Error("A integração ainda não foi configurada. Informe a URL do Web App em script.js."));
        return;
      }

      const frame = document.getElementById("api-frame");
      if (!frame) {
        reject(new Error("Não foi possível iniciar a conexão com o formulário."));
        return;
      }
      const requestId = `${Date.now()}-${Array.from(crypto.getRandomValues(new Uint32Array(2)), (value) => value.toString(36)).join("")}`;
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("O servidor demorou para responder. Tente novamente."));
      }, 20000);

      function onMessage(event) {
        const trustedOrigin = /^https:\/\/([a-z0-9-]+\.)*(script\.google\.com|googleusercontent\.com)$/i.test(event.origin);
        if (!trustedOrigin || !event.data || event.data.channel !== API_CHANNEL || event.data.requestId !== requestId) return;
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        if (event.data.payload && event.data.payload.ok) resolve(event.data.payload);
        else reject(new Error((event.data.payload && event.data.payload.message) || "Não foi possível concluir sua solicitação."));
      }

      window.addEventListener("message", onMessage);
      const form = document.createElement("form");
      form.method = method;
      form.action = APPS_SCRIPT_URL;
      form.target = frame.name;
      form.acceptCharset = "UTF-8";
      form.hidden = true;
      const params = { ...fields, requestId };
      Object.keys(params).forEach((key) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = String(params[key]);
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
      form.remove();
    });
  }

  function showConfetti() {
    if (typeof window.confetti !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const end = Date.now() + 3000;
    const colors = ["#5c5337", "#d4af7a", "#eee2cf"];
    (function frame() {
      window.confetti({ particleCount: 3, angle: 60, spread: 50, origin: { x: 0 }, colors });
      window.confetti({ particleCount: 3, angle: 120, spread: 50, origin: { x: 1 }, colors });
      if (Date.now() < end) window.requestAnimationFrame(frame);
    })();
  }

  function initRsvp() {
    const accessForm = document.getElementById("access-form");
    if (!accessForm) return;

    const phoneInput = document.getElementById("phone");
    const accessMessage = document.getElementById("access-message");
    const accessButton = document.getElementById("access-button");
    const rsvpView = document.getElementById("rsvp-view");
    const alreadyView = document.getElementById("already-view");
    const guestOptions = document.getElementById("guest-options");
    const confirmButton = document.getElementById("confirm-button");
    const rsvpMessage = document.getElementById("rsvp-message");
    const rsvpForm = document.getElementById("rsvp-form");
    const modal = document.getElementById("thank-you-modal");
    let activeGuests = [];
    let activePhone = "";

    phoneInput.addEventListener("input", () => {
      const cursorAtEnd = phoneInput.selectionStart === phoneInput.value.length;
      phoneInput.value = formatPhone(phoneInput.value);
      if (cursorAtEnd) phoneInput.setSelectionRange(phoneInput.value.length, phoneInput.value.length);
    });

    accessForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      accessMessage.textContent = "";
      const phone = onlyDigits(phoneInput.value);
      if (!BR_PHONE_LENGTHS.includes(phone.length)) {
        accessMessage.textContent = "Confira o celular: informe o DDD e o número completo.";
        phoneInput.focus();
        return;
      }
      activePhone = phone;
      accessButton.disabled = true;
      accessButton.textContent = "Consultando...";
      try {
        const result = await sendToAppsScript("GET", { action: "access", phone });
        if (!result.found) {
          accessMessage.textContent = "Não encontramos esse celular na lista. Confira o número ou fale com os noivos.";
          return;
        }
        document.getElementById("login-view").hidden = true;
        if (result.alreadyResponded) {
          const names = result.responses.map((response) => `${response.name}: ${response.status === "Confirmado" ? "presença confirmada" : "não poderá comparecer"}`).join(" · ");
          document.getElementById("already-message").textContent = names || "Sua resposta foi registrada anteriormente.";
          alreadyView.hidden = false;
          return;
        }
        activeGuests = result.guests;
        document.getElementById("welcome-message").textContent = `Olá, ${result.guests[0].name}, que bom te ver aqui!`;
        document.getElementById("guest-question").textContent = `${result.guests[0].name}, você estará presente no grande dia de João e Taise?`;
        const statusMessage = (result.responses || []).map((response) =>
          `${response.name}: ${response.status === "Confirmado" ? "presença confirmada" : "não poderá comparecer"}`
        ).join(" · ");
        const statusElement = document.getElementById("rsvp-status");
        statusElement.textContent = statusMessage;
        statusElement.hidden = !statusMessage;
        renderGuestQuestions();
        rsvpView.hidden = false;
        showConfetti();
      } catch (error) {
        accessMessage.textContent = error.message;
      } finally {
        accessButton.disabled = false;
        accessButton.textContent = "Acessar convite";
      }
    });

    function renderGuestQuestions() {
      guestOptions.replaceChildren();
      activeGuests.forEach((guest, index) => {
        const group = document.createElement("fieldset");
        group.className = "guest-group";
        group.hidden = index > 0;
        group.style.border = "0";
        group.style.margin = "0";
        group.style.paddingLeft = "0";
        group.style.paddingRight = "0";
        const legend = document.createElement("legend");
        legend.className = "guest-question";
        legend.textContent = index === 0 ? "Sua resposta" : makeCompanionQuestion(guest);
        group.appendChild(legend);
        const subject = index === 0 ? "você" : guest.gender === "M" ? "ele" : "ela";
        const options = index === 0
          ? [{ value: "Sim", label: "Sim, não perco por nada!" }, { value: "Não", label: "Não, infelizmente não poderei comparecer." }]
          : [{ value: "Sim", label: `Sim, ${subject} também vai` }, { value: "Não", label: `${subject[0].toUpperCase()}${subject.slice(1)} não vai poder comparecer` }];
        options.forEach((option) => {
          const label = document.createElement("label");
          label.className = "radio-option";
          const input = document.createElement("input");
          input.type = "radio";
          input.name = `guest-${index}`;
          input.value = option.value;
          input.required = index === 0;
          input.disabled = index > 0;
          input.addEventListener("change", updateConfirmState);
          label.append(input, document.createTextNode(option.label));
          group.appendChild(label);
        });
        guestOptions.appendChild(group);
      });
    }

    function makeCompanionQuestion(guest) {
      const reason = String(guest.reason || "").trim();
      if (!reason) return `Confirma a presença de ${guest.name}?`;
      if (/^(a|o|as|os|sua|seu|suas|seus|esposa|esposo|filha|filho|mãe|pai|irmã|irmão)\b/i.test(reason)) {
        return `Confirmar presença de ${reason}?`;
      }
      return `E ${guest.gender === "M" ? "o seu" : "a sua"} ${reason}?`;
    }

    function updateConfirmState() {
      const mainAnswer = rsvpForm.querySelector('input[name="guest-0"]:checked');
      if (mainAnswer && mainAnswer.value === "Não") {
        setCompanionQuestionsVisible(false);
        confirmButton.disabled = false;
        return;
      }
      setCompanionQuestionsVisible(Boolean(mainAnswer && mainAnswer.value === "Sim"));
      confirmButton.disabled = !activeGuests.every((_, index) => rsvpForm.querySelector(`input[name="guest-${index}"]:checked`));
    }

    function setCompanionQuestionsVisible(visible) {
      activeGuests.slice(1).forEach((_, index) => {
        const group = guestOptions.querySelectorAll(".guest-group")[index + 1];
        group.hidden = !visible;
        group.querySelectorAll("input").forEach((input) => {
          input.disabled = !visible;
          input.required = visible;
        });
      });
    }

    rsvpForm.addEventListener("change", (event) => {
      if (event.target.name === "guest-0") {
        setCompanionQuestionsVisible(event.target.value === "Sim");
      }
      if (event.target.name === "guest-0" && event.target.value === "Não") {
        activeGuests.slice(1).forEach((_, index) => {
          rsvpForm.querySelectorAll(`input[name="guest-${index + 1}"]`).forEach((input) => { input.checked = false; });
        });
      }
      updateConfirmState();
    });

    rsvpForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (confirmButton.disabled) return;
      rsvpMessage.textContent = "";
      confirmButton.disabled = true;
      confirmButton.textContent = "Salvando...";
      const answers = activeGuests.map((_, index) => {
        const selected = rsvpForm.querySelector(`input[name="guest-${index}"]:checked`);
        return selected ? { index: activeGuests[index].index, answer: selected.value } : null;
      }).filter(Boolean);
      try {
        await sendToAppsScript("POST", { action: "submit", phone: activePhone, answers: JSON.stringify(answers) });
        const mainDeclined = answers.some((answer) => answer.index === activeGuests[0].index && answer.answer === "Não");
        if (mainDeclined) {
          document.getElementById("modal-title").textContent = "Sentiremos sua falta";
          document.getElementById("modal-description").textContent =
            "Sentiremos sua falta, mas agradecemos por nos avisar. Estaremos com você em pensamento nesse dia tão especial.";
          document.getElementById("modal-gifts-link").textContent = "Ver lista de presentes";
        }
        modal.hidden = false;
        document.getElementById("modal-gifts-link").focus();
      } catch (error) {
        rsvpMessage.textContent = error.message;
        confirmButton.disabled = false;
      } finally {
        confirmButton.textContent = "Confirmar presença";
        updateConfirmState();
      }
    });

  }

  const gifts = [
    { title: "Ajuda para nosso café da manhã romântico", price: 250, image: "photo-1504754524776-8f4f37790ca0", alt: "Mesa farta de café da manhã com frutas, waffles, ovos e café" },
    { title: "Um brinde ao nosso amor 🥂", price: 300, image: "photo-1510812431401-41d2bd2722f3", alt: "Taças para um brinde especial" },
    { title: "Um sorvete para adoçar nossa lua de mel", price: 50, image: "photo-1563805042-7684c019e1cb", alt: "Sorvete artesanal" },
    { title: "Um almoço com vista para o mar", price: 500, image: "photo-1766547325390-44833aa5675b", alt: "Buffet servido em restaurante à beira-mar, com o oceano ao fundo" },
    { title: "Um jantar romântico a dois", price: 700, image: "photo-1517248135467-4c7edcad34c4", alt: "Mesa preparada para jantar" },
    { title: "Uma experiência gastronômica especial", price: 400, image: "photo-1414235077428-338989a2e8c0", alt: "Prato de gastronomia especial" },
    { title: "Contribuição para nosso passeio de barco", price: 300, image: "photo-1500375592092-40eb2168fd21", alt: "Barco navegando no mar" },
    { title: "Um dia de aventuras em Arraial do Cabo", price: 1000, image: "photo-1507525428034-b723cf961d3e", alt: "Praia de águas claras" },
    { title: "Uma experiência inesquecível para o casal", price: 600, image: "photo-1476514525535-07fb3b4ae5f1", alt: "Viagem por uma paisagem à beira d'água" },
    { title: "Uma diária de passeios e descobertas", price: 400, image: "photo-1464822759023-fed622ff2c3b", alt: "Paisagem de montanhas para explorar" },
    { title: "Um presente para eternizar nossa viagem", price: 750, image: "photo-1488646953014-85cb44e25828", alt: "Itens de viagem sobre um mapa" },
    { title: "Uma contribuição especial para nossa lua de mel", price: 1500, image: "photo-1530789253388-582c481c54b0", alt: "Paisagem de viagem ao pôr do sol" },
    { title: "O empurrãozinho para realizarmos nosso sonho", price: 2500, image: "photo-1470252649378-9c29740c9fa8", alt: "Nascer do sol sobre uma paisagem" }
  ];

  function initGiftList() {
    const list = document.getElementById("gift-list");
    if (!list) return;
    const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
    gifts.forEach((gift) => {
      const card = document.createElement("article");
      card.className = "gift-card";
      const image = document.createElement("img");
      image.className = "gift-image";
      image.src = `https://images.unsplash.com/${gift.image}?auto=format&fit=crop&w=800&q=80`;
      image.alt = gift.alt;
      image.loading = "lazy";
      const content = document.createElement("div");
      content.className = "gift-content";
      const title = document.createElement("h2");
      title.className = "gift-title";
      title.textContent = gift.title;
      const price = document.createElement("p");
      price.className = "gift-price";
      price.textContent = currency.format(gift.price);
      const link = document.createElement("a");
      link.className = "button gift-button";
      // Substitua o valor de data-link pelo link de pagamento correspondente.
      link.href = "#";
      link.dataset.link = "#";
      link.textContent = "Selecionar";
      link.addEventListener("click", (event) => {
        if (link.dataset.link === "#") {
          event.preventDefault();
          notice.hidden = false;
        } else {
          link.href = link.dataset.link;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
      });
      const notice = document.createElement("p");
      notice.className = "gift-notice";
      notice.textContent = "Link de pagamento em breve.";
      notice.hidden = true;
      content.append(title, price, link, notice);
      card.append(image, content);
      list.appendChild(card);
    });
  }

  initRsvp();
  initGiftList();
})();
