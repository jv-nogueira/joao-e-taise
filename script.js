"use strict";

(() => {
  // Cole aqui a URL do Web App publicado no Google Apps Script.
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx3gnrj31dmaTadB0Ki0aMs72UeGZ58gQ31Vmm6KI6rN87lNKBvKmtrOi71HeI9BEUd/exec";
  // Chave pública do Mercado Pago: pode ficar no front-end; nunca coloque o Access Token aqui.
  const MP_PUBLIC_KEY = "APP_USR-86b29075-f49a-4d12-b894-4f2024bd1c89";
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

  function sendToAppsScript(method, fields, timeoutMs = 20000) {
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
      }, timeoutMs);

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

    const accessSessionKey = "joao-taise-rsvp-session";
    const loginView = document.getElementById("login-view");
    const phoneInput = document.getElementById("phone");
    const accessMessage = document.getElementById("access-message");
    const accessButton = document.getElementById("access-button");
    const rsvpView = document.getElementById("rsvp-view");
    const alreadyView = document.getElementById("already-view");
    const logoutButton = document.getElementById("logout-button");
    const guestOptions = document.getElementById("guest-options");
    const confirmButton = document.getElementById("confirm-button");
    const rsvpMessage = document.getElementById("rsvp-message");
    const rsvpForm = document.getElementById("rsvp-form");
    const modal = document.getElementById("thank-you-modal");
    const invitationHero = document.querySelector(".invitation-hero");
    const giftsNavLink = document.getElementById("gifts-nav-link");
    const siteFooter = document.querySelector(".site-footer");
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
        saveAccessSession(phone, result);
        showAccessResult(phone, result, true);
      } catch (error) {
        accessMessage.textContent = error.message;
      } finally {
        accessButton.disabled = false;
        accessButton.textContent = "Consultar convite";
      }
    });

    logoutButton.addEventListener("click", () => {
      clearAccessSession();
      activeGuests = [];
      activePhone = "";
      invitationHero.hidden = true;
      giftsNavLink.hidden = true;
      siteFooter.hidden = true;
      loginView.hidden = false;
      rsvpView.hidden = true;
      alreadyView.hidden = true;
      logoutButton.hidden = true;
      phoneInput.value = "";
      accessMessage.textContent = "";
      rsvpMessage.textContent = "";
      phoneInput.focus();
    });

    function saveAccessSession(phone, result) {
      try {
        window.sessionStorage.setItem(accessSessionKey, JSON.stringify({ phone, result }));
      } catch (error) {
        console.error("Não foi possível guardar a sessão do convite nesta aba.", error);
      }
    }

    function clearAccessSession() {
      try {
        window.sessionStorage.removeItem(accessSessionKey);
      } catch (error) {
        console.error("Não foi possível encerrar a sessão do convite nesta aba.", error);
      }
    }

    function restoreAccessSession() {
      let savedSession;
      try {
        const serializedSession = window.sessionStorage.getItem(accessSessionKey);
        if (!serializedSession) return;
        savedSession = JSON.parse(serializedSession);
        const validPhone = savedSession
          && typeof savedSession.phone === "string"
          && BR_PHONE_LENGTHS.includes(onlyDigits(savedSession.phone).length);
        const result = savedSession && savedSession.result;
        const validResult = result
          && result.found === true
          && typeof result.alreadyResponded === "boolean"
          && Array.isArray(result.responses)
          && (result.alreadyResponded || (Array.isArray(result.guests) && result.guests.length > 0));
        if (!validPhone || !validResult) {
          clearAccessSession();
          return;
        }
      } catch (error) {
        console.error("Não foi possível restaurar a sessão do convite.", error);
        clearAccessSession();
        return;
      }
      showAccessResult(savedSession.phone, savedSession.result, false);
    }

    function showAccessResult(phone, result, celebrate) {
      activePhone = onlyDigits(phone);
      invitationHero.hidden = false;
      giftsNavLink.hidden = false;
      siteFooter.hidden = false;
      loginView.hidden = true;
      logoutButton.hidden = false;
      if (result.alreadyResponded) {
        const names = (result.responses || []).map((response) =>
          `${response.name}: ${response.status === "Confirmado" ? "presença confirmada" : "não poderá comparecer"}`
        ).join(" · ");
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
      if (celebrate) showConfetti();
    }

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
        saveAccessSession(activePhone, {
          found: true,
          alreadyResponded: true,
          responses: []
        });
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

    restoreAccessSession();
  }

  const gifts = [
    { id: "gift-01", title: "Ajuda para nosso café da manhã romântico", price: 1, image: "photo-1504754524776-8f4f37790ca0", alt: "Mesa farta de café da manhã com frutas, waffles, ovos e café" },
    { id: "gift-02", title: "Um brinde ao nosso amor 🥂", price: 300, image: "photo-1510812431401-41d2bd2722f3", alt: "Taças para um brinde especial" },
    { id: "gift-03", title: "Um sorvete para adoçar nossa lua de mel", price: 50, image: "photo-1563805042-7684c019e1cb", alt: "Sorvete artesanal" },
    { id: "gift-04", title: "Um almoço com vista para o mar", price: 500, image: "photo-1766547325390-44833aa5675b", alt: "Buffet servido em restaurante à beira-mar, com o oceano ao fundo" },
    { id: "gift-05", title: "Um jantar romântico a dois", price: 700, image: "photo-1517248135467-4c7edcad34c4", alt: "Mesa preparada para jantar" },
    { id: "gift-06", title: "Uma experiência gastronômica especial", price: 400, image: "photo-1414235077428-338989a2e8c0", alt: "Prato de gastronomia especial" },
    { id: "gift-07", title: "Contribuição para nosso passeio de barco", price: 300, image: "photo-1500375592092-40eb2168fd21", alt: "Barco navegando no mar" },
    { id: "gift-08", title: "Um dia de aventuras em Arraial do Cabo", price: 1000, image: "photo-1507525428034-b723cf961d3e", alt: "Praia de águas claras" },
    { id: "gift-09", title: "Uma experiência inesquecível para o casal", price: 600, image: "photo-1476514525535-07fb3b4ae5f1", alt: "Viagem por uma paisagem à beira d'água" },
    { id: "gift-10", title: "Uma diária de passeios e descobertas", price: 400, image: "photo-1464822759023-fed622ff2c3b", alt: "Paisagem de montanhas para explorar" },
    { id: "gift-11", title: "Um presente para eternizar nossa viagem", price: 750, image: "photo-1488646953014-85cb44e25828", alt: "Itens de viagem sobre um mapa" },
    { id: "gift-12", title: "Uma contribuição especial para nossa lua de mel", price: 1500, image: "photo-1530789253388-582c481c54b0", alt: "Paisagem de viagem ao pôr do sol" },
    { id: "gift-13", title: "O empurrãozinho para realizarmos nosso sonho", price: 2500, image: "photo-1470252649378-9c29740c9fa8", alt: "Nascer do sol sobre uma paisagem" }
  ];

  function initGiftList() {
    const list = document.getElementById("gift-list");
    if (!list) return;
    const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
    const modal = document.getElementById("payment-modal");
    const closeButton = document.getElementById("close-payment-modal");
    const giftName = document.getElementById("payment-gift-name");
    const giftPrice = document.getElementById("payment-gift-price");
    const methodButtons = Array.from(document.querySelectorAll("[data-payment-method]"));
    const pixForm = document.getElementById("pix-form");
    const pixEmail = document.getElementById("pix-email");
    const pixSubmit = document.getElementById("pix-submit");
    const pixResult = document.getElementById("pix-result");
    const pixQrCode = document.getElementById("pix-qr-code");
    const pixCopyContainer = document.getElementById("pix-copy-container");
    const pixCopyCode = document.getElementById("pix-copy-code");
    const copyPixButton = document.getElementById("copy-pix-code");
    const pixTicketLink = document.getElementById("pix-ticket-link");
    const cardCheckout = document.getElementById("card-checkout");
    const challengeFrame = document.getElementById("card-challenge-frame");
    const challengeInstructions = document.getElementById("card-challenge-instructions");
    const paymentMessage = document.getElementById("payment-message");
    const paymentComplete = document.getElementById("payment-complete");
    const paymentDone = document.getElementById("payment-done");
    const checkPaymentButton = document.getElementById("check-payment-button");
    let activeGift = null;
    let activeOrderId = "";
    let paymentFlow = 0;
    let cardBrickController = null;
    let cardBrickPromise = null;
    let mercadoPago = null;
    let pollingFlow = 0;

    function setPaymentMessage(message, isError = false) {
      paymentMessage.textContent = message;
      paymentMessage.classList.toggle("is-error", isError);
    }

    function unmountCardBrick() {
      if (!cardBrickController) return;
      try {
        const unmountResult = cardBrickController.unmount();
        if (unmountResult && typeof unmountResult.catch === "function") {
          unmountResult.catch((error) => console.error("Não foi possível desmontar o formulário do cartão.", error));
        }
      } catch (error) {
        console.error("Não foi possível desmontar o formulário do cartão.", error);
      }
      cardBrickController = null;
    }

    function isPaid(result) {
      return result.status.toLowerCase() === "processed"
        && result.statusDetail.toLowerCase() === "accredited";
    }

    function isFinalFailure(result) {
      return ["failed", "canceled", "cancelled", "expired", "closed"].includes(result.status.toLowerCase());
    }

    function isChallenge(result) {
      return result.status.toLowerCase() === "action_required"
        && result.statusDetail.toLowerCase() === "pending_challenge";
    }

    function isMercadoPagoUrl(value) {
      try {
        const url = new URL(value);
        return url.protocol === "https:"
          && /(^|\.)mercadopago\.com(\.[a-z]{2})?$/i.test(url.hostname);
      } catch (error) {
        return false;
      }
    }

    function showCardChallenge(result) {
      if (!isMercadoPagoUrl(result.challengeUrl)) {
        setPaymentMessage("O banco solicitou uma verificação, mas não foi possível abrir o desafio com segurança. Consulte o pagamento novamente ou tente outro cartão.", true);
        checkPaymentButton.hidden = false;
        return;
      }
      challengeFrame.src = result.challengeUrl;
      challengeFrame.hidden = false;
      challengeInstructions.hidden = false;
      cardCheckout.hidden = true;
      pixForm.hidden = true;
      pixResult.hidden = true;
      methodButtons.forEach((button) => { button.hidden = true; });
      setPaymentMessage("Aguardando a verificação do banco. Não feche esta janela até concluir.");
    }

    function showPaid() {
      paymentFlow += 1;
      paymentComplete.hidden = false;
      pixForm.hidden = true;
      pixResult.hidden = true;
      cardCheckout.hidden = true;
      challengeFrame.hidden = true;
      challengeInstructions.hidden = true;
      challengeFrame.src = "about:blank";
      checkPaymentButton.hidden = true;
      methodButtons.forEach((button) => { button.hidden = true; });
      setPaymentMessage("");
      paymentDone.focus();
    }

    function applyOrderStatus(result, flow, isPolling = false) {
      if (flow !== paymentFlow) return;
      if (isPaid(result)) {
        showPaid();
      } else if (isFinalFailure(result)) {
        setPaymentMessage("O pagamento não foi aprovado. Você pode tentar novamente ou escolher outra forma de pagamento.", true);
        activeOrderId = "";
        checkPaymentButton.hidden = true;
        challengeFrame.hidden = true;
        challengeInstructions.hidden = true;
        challengeFrame.src = "about:blank";
        methodButtons.forEach((button) => { button.hidden = false; });
        if (pixResult.hidden === false) {
          pixResult.hidden = true;
          pixForm.hidden = false;
        }
      } else if (isChallenge(result)) {
        setPaymentMessage("Aguardando a verificação do banco. Não feche esta janela até concluir.");
      } else {
        if (!isPolling) {
          setPaymentMessage("Aguardando a confirmação do Mercado Pago. O Pix pode levar alguns instantes para ser reconhecido.");
        }
      }
    }

    async function checkOrderStatus(orderId, flow, isPolling = false) {
      const result = await sendToAppsScript("POST", { action: "paymentStatus", orderId });
      if (flow === paymentFlow) applyOrderStatus(result, flow, isPolling);
      return result;
    }

    async function pollOrderStatus(orderId, flow) {
      if (pollingFlow === flow) return;
      pollingFlow = flow;
      try {
        const endTime = Date.now() + 15 * 60000;
        let lastPollTime = 0;

        while (flow === paymentFlow && Date.now() < endTime) {
          const now = Date.now();
          const remaining = Math.max(0, endTime - now);
          const minutes = Math.floor(remaining / 60000);
          const seconds = Math.floor((remaining % 60000) / 1000);
          const timeString = `${minutes}:${seconds.toString().padStart(2, "0")}`;

          if (pixResult.hidden === false) {
            setPaymentMessage(`Aguardando confirmação... O Pix expira em ${timeString}.`);
          }

          if (now - lastPollTime >= 5000) {
            lastPollTime = now;
            try {
              const result = await checkOrderStatus(orderId, flow, true);
              if (isPaid(result) || isFinalFailure(result)) return;
            } catch (error) {
              // Ignora erros de rede temporários durante a verificação automática
            }
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }

        if (flow === paymentFlow && activeOrderId) {
          setPaymentMessage("O tempo expirou. Se você já pagou, aguarde ou consulte o pagamento manualmente.");
          checkPaymentButton.hidden = false;
        }
      } finally {
        if (pollingFlow === flow) pollingFlow = 0;
      }
    }

    function showOrderResult(result, flow) {
      activeOrderId = result.orderId || "";
      if (isChallenge(result)) showCardChallenge(result);
      else applyOrderStatus(result, flow);
      if (!isPaid(result) && !isFinalFailure(result) && activeOrderId) {
        pollOrderStatus(activeOrderId, flow);
      }
    }

    function closePaymentModal() {
      paymentFlow += 1;
      activeOrderId = "";
      modal.hidden = true;
      unmountCardBrick();
      pixForm.reset();
      pixForm.hidden = true;
      pixResult.hidden = true;
      cardCheckout.hidden = true;
      paymentComplete.hidden = true;
      checkPaymentButton.hidden = true;
      challengeFrame.hidden = true;
      challengeInstructions.hidden = true;
      challengeFrame.src = "about:blank";
      methodButtons.forEach((button) => {
        button.hidden = false;
        button.classList.remove("is-selected");
        button.setAttribute("aria-pressed", "false");
      });
      pixQrCode.removeAttribute("src");
      pixQrCode.hidden = false;
      pixCopyContainer.hidden = false;
      pixCopyCode.value = "";
      pixTicketLink.removeAttribute("href");
      pixTicketLink.hidden = true;
      setPaymentMessage("");
    }

    function openPaymentModal(gift) {
      activeGift = gift;
      activeOrderId = "";
      paymentFlow += 1;
      giftName.textContent = gift.title;
      giftPrice.textContent = currency.format(gift.price);
      modal.hidden = false;
      closeButton.focus();
    }

    async function mountCardBrick() {
      if (cardBrickController) return;
      if (cardBrickPromise) return cardBrickPromise;
      if (!MP_PUBLIC_KEY || MP_PUBLIC_KEY.indexOf("APP_USR-") !== 0 || !window.MercadoPago) {
        setPaymentMessage("O formulário do cartão ainda não está disponível. Tente novamente mais tarde.", true);
        return;
      }
      const gift = activeGift;
      const flow = paymentFlow;
      cardBrickPromise = (async () => {
        try {
          mercadoPago = mercadoPago || new window.MercadoPago(MP_PUBLIC_KEY, { locale: "pt-BR" });
          const bricksBuilder = mercadoPago.bricks();
          cardBrickController = await bricksBuilder.create("cardPayment", "card-payment-brick", {
            initialization: { amount: gift.price },
            customization: {
              paymentMethods: { 
                minInstallments: 1,
                maxInstallments: 36 }
            },
            callbacks: {
              onReady: () => {
                if (flow === paymentFlow) setPaymentMessage("");
              },
              onSubmit: async (formData, additionalData) => {
                if (flow !== paymentFlow) throw new Error("Esta sessão de pagamento foi encerrada.");
                try {
                  setPaymentMessage("Processando o pagamento com segurança...");
                  const result = await sendToAppsScript("POST", {
                    action: "createCardOrder",
                    giftId: gift.id,
                    cardData: JSON.stringify({
                      formData,
                      paymentType: additionalData && additionalData.paymentTypeId
                    })
                  }, 45000);
                  if (flow === paymentFlow) showOrderResult(result, flow);
                } catch (error) {
                  if (flow === paymentFlow) setPaymentMessage(error.message, true);
                  throw error;
                }
              },
              onError: (error) => {
                console.error("Erro no formulário do Mercado Pago.", error);
                if (flow === paymentFlow) {
                  setPaymentMessage("Não foi possível carregar ou validar o formulário do cartão. Tente novamente.", true);
                }
              }
            }
          });
          if (flow !== paymentFlow) unmountCardBrick();
        } catch (error) {
          console.error("Não foi possível carregar o formulário do cartão.", error);
          if (flow === paymentFlow) {
            setPaymentMessage("Não foi possível carregar o formulário do cartão. Tente novamente mais tarde.", true);
          }
        }
      })();
      try {
        await cardBrickPromise;
      } finally {
        cardBrickPromise = null;
        if (flow !== paymentFlow && !modal.hidden && !cardCheckout.hidden && !cardBrickController) {
          window.setTimeout(() => mountCardBrick(), 0);
        }
      }
    }

    async function selectPaymentMethod(method) {
      if (activeOrderId) return;
      methodButtons.forEach((button) => {
        const selected = button.dataset.paymentMethod === method;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      setPaymentMessage("");
      pixResult.hidden = true;
      pixForm.hidden = method !== "pix";
      cardCheckout.hidden = method !== "card";
      if (method === "card") await mountCardBrick();
      if (method === "pix") pixEmail.focus();
    }

    methodButtons.forEach((button) => {
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => selectPaymentMethod(button.dataset.paymentMethod));
    });

    pixForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!pixForm.reportValidity() || !activeGift) return;
      const flow = paymentFlow;
      pixSubmit.disabled = true;
      pixSubmit.textContent = "Gerando Pix...";
      setPaymentMessage("Conectando com o Mercado Pago...");
      try {
        const result = await sendToAppsScript("POST", {
          action: "createPixOrder",
          giftId: activeGift.id,
          email: pixEmail.value.trim()
        }, 45000);
        if (flow !== paymentFlow) return;
        if (isFinalFailure(result)) {
          showOrderResult(result, flow);
          return;
        }
        if (result.qrCodeBase64) {
          const imageData = result.qrCodeBase64;
          pixQrCode.src = imageData.indexOf("data:image/") === 0 ? imageData : `data:image/png;base64,${imageData}`;
          pixQrCode.hidden = false;
        } else {
          pixQrCode.removeAttribute("src");
          pixQrCode.hidden = true;
        }
        const hasTicketUrl = isMercadoPagoUrl(result.ticketUrl);
        if (hasTicketUrl) {
          pixTicketLink.href = result.ticketUrl;
          pixTicketLink.hidden = false;
        }
        if (!result.qrCode && !result.qrCodeBase64 && !hasTicketUrl) {
          throw new Error("O Mercado Pago não retornou os dados do Pix. Tente novamente.");
        }
        pixCopyCode.value = result.qrCode || "";
        pixCopyContainer.hidden = !result.qrCode;
        pixResult.hidden = false;
        pixForm.hidden = true;
        methodButtons.forEach((button) => { button.hidden = true; });
        showOrderResult(result, flow);
      } catch (error) {
        if (flow === paymentFlow) setPaymentMessage(error.message, true);
      } finally {
        pixSubmit.disabled = false;
        pixSubmit.textContent = "Gerar Pix";
      }
    });

    copyPixButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(pixCopyCode.value);
        setPaymentMessage("Código Pix copiado.");
      } catch (error) {
        pixCopyCode.focus();
        pixCopyCode.select();
        const copied = document.execCommand("copy");
        setPaymentMessage(copied ? "Código Pix copiado." : "Selecione e copie o código Pix.");
      }
    });

    checkPaymentButton.addEventListener("click", async () => {
      if (!activeOrderId) return;
      checkPaymentButton.disabled = true;
      setPaymentMessage("Consultando o Mercado Pago...");
      try {
        const result = await checkOrderStatus(activeOrderId, paymentFlow);
        if (!isPaid(result) && !isFinalFailure(result)) {
          setPaymentMessage("O Mercado Pago ainda não confirmou o pagamento. Tente consultar novamente em instantes.");
        }
      } catch (error) {
        setPaymentMessage(error.message, true);
      } finally {
        checkPaymentButton.disabled = false;
      }
    });

    window.addEventListener("message", (event) => {
      if (event.source !== challengeFrame.contentWindow
        || !isMercadoPagoUrl(event.origin)
        || !event.data
        || event.data.status !== "COMPLETE"
        || !activeOrderId) return;
      setPaymentMessage("Verificação concluída. Confirmando o pagamento...");
      checkOrderStatus(activeOrderId, paymentFlow).catch((error) => {
        setPaymentMessage(error.message, true);
      });
    });

    closeButton.addEventListener("click", closePaymentModal);
    paymentDone.addEventListener("click", closePaymentModal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closePaymentModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) closePaymentModal();
    });

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
      const button = document.createElement("button");
      button.className = "button gift-button";
      button.type = "button";
      button.textContent = "Selecionar";
      button.addEventListener("click", () => openPaymentModal(gift));
      content.append(title, price, button);
      card.append(image, content);
      list.appendChild(card);
    });
  }

  initRsvp();
  initGiftList();
})();