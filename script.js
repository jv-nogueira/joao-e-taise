"use strict";

(() => {
  // Cole aqui a URL do Web App publicado no Google Apps Script.
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyYHeFudrCdPcodFEgpN4Vq9bIGUkuzRAPlJOr1FWn6aoiduiOIcsaboVuOPpoms5ei/exec";
  // Chave pública do Mercado Pago: pode ficar no front-end; nunca coloque o Access Token aqui.
  const MP_PUBLIC_KEY = "APP_USR-86b29075-f49a-4d12-b894-4f2024bd1c89";
  const API_CHANNEL = "joao-taise-rsvp";
  const BR_PHONE_LENGTHS = [10, 11];
  const ACCESS_SESSION_KEY = "joao-taise-rsvp-session";
  let giftAccessPhone = "";

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

    const returningForGifts = new URLSearchParams(window.location.search).get("redirect") === "presentes.html";
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
    if (returningForGifts) document.getElementById("rsvp-title").textContent = "Acesse a lista de presentes";

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
        if (!saveAccessSession(phone, result)) {
          accessMessage.textContent = "Não foi possível manter a sessão nesta aba. Habilite o armazenamento do navegador e tente novamente.";
          return;
        }
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
        window.sessionStorage.setItem(ACCESS_SESSION_KEY, JSON.stringify({ phone, result }));
        return true;
      } catch (error) {
        console.error("Não foi possível guardar a sessão do convite nesta aba.", error);
        return false;
      }
    }

    function clearAccessSession() {
      try {
        window.sessionStorage.removeItem(ACCESS_SESSION_KEY);
      } catch (error) {
        console.error("Não foi possível encerrar a sessão do convite nesta aba.", error);
      }
    }

    function restoreAccessSession() {
      let savedSession;
      try {
        const serializedSession = window.sessionStorage.getItem(ACCESS_SESSION_KEY);
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
      if (returningForGifts) {
        window.location.replace("presentes.html");
        return;
      }
      invitationHero.hidden = false;
      giftsNavLink.hidden = false;
      siteFooter.hidden = false;
      loginView.hidden = true;
      logoutButton.hidden = false;
      if (result.alreadyResponded) {
        const names = (result.responses || []).map((response) =>
          `${response.name}: ${response.status === "Confirmado" ? "presença confirmada" : "não poderá comparecer"}`
        ).join(" · ");
        document.getElementById("already-message").textContent = names || "Obrigado por nos avisar!";
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
        const result = await sendToAppsScript("POST", { action: "submit", phone: activePhone, answers: JSON.stringify(answers) });
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
        if (result.notificationWarning) {
          document.getElementById("modal-description").textContent += ` ${result.notificationWarning}`;
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
    { id: "gift-01", title: "Ajuda para nosso café da manhã romântico", price: 250, image: "photo-1504754524776-8f4f37790ca0", alt: "Mesa farta de café da manhã com frutas, waffles, ovos e café" },
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
  const donationGift = {
    id: "gift-custom",
    title: "Ajude com o valor que seu coração desejar",
    price: 1,
    image: "photo-1513201099705-a9746e1e201f",
    alt: "Presente embrulhado com uma fita rosa",
    customAmount: true
  };

  function initGiftAccessGate() {
    if (!document.getElementById("gift-list")) return true;

    try {
      const serializedSession = window.sessionStorage.getItem(ACCESS_SESSION_KEY);
      if (serializedSession) {
        const savedSession = JSON.parse(serializedSession);
        const phone = savedSession && onlyDigits(savedSession.phone);
        const result = savedSession && savedSession.result;
        const validResult = result
          && result.found === true
          && typeof result.alreadyResponded === "boolean"
          && Array.isArray(result.responses)
          && (result.alreadyResponded || (Array.isArray(result.guests) && result.guests.length > 0));
        if (typeof phone === "string" && BR_PHONE_LENGTHS.includes(phone.length) && validResult) {
          giftAccessPhone = phone;
          return true;
        }
      }
    } catch (error) {
      console.error("Não foi possível validar a sessão para abrir a lista de presentes.", error);
    }

    window.location.replace("index.html?redirect=presentes.html");
    return false;
  }

  function initGiftList() {
    const list = document.getElementById("gift-list");
    if (!list) return;
    const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
    const sortOrder = document.getElementById("gift-sort-order");
    const modal = document.getElementById("payment-modal");
    const closeButton = document.getElementById("close-payment-modal");
    const giftName = document.getElementById("payment-gift-name");
    const giftPrice = document.getElementById("payment-gift-price");
    const customGiftAmount = document.getElementById("custom-gift-amount");
    const customGiftPrice = document.getElementById("custom-gift-price");
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
    const paymentBreakdown = document.getElementById("payment-breakdown");
    const paymentFeeRate = document.getElementById("payment-fee-rate");
    const paymentFeeAmount = document.getElementById("payment-fee-amount");
    const paymentTotalAmount = document.getElementById("payment-total-amount");
    const cardFeeNote = document.getElementById("card-fee-note");
    const cardPaymentReview = document.getElementById("card-payment-review");
    const cardInstallmentSummary = document.getElementById("card-installment-summary");
    const confirmCardPaymentButton = document.getElementById("confirm-card-payment");
    const cancelCardReviewButton = document.getElementById("cancel-card-review");
    const paymentFeeRatesBps = { pix: 99, cardSingle: 498, cardTwoToSix: 299, cardSevenToEighteen: 309 };
    const percentage = new Intl.NumberFormat("pt-BR", {
      style: "percent",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    let activeGift = null;
    let activeOrderId = "";
    let paymentFlow = 0;
    let cardBrickController = null;
    let cardBrickPromise = null;
    let mercadoPago = null;
    let pollingFlow = 0;
    let pendingCardPayment = null;

    function setPaymentMessage(message, isError = false) {
      paymentMessage.textContent = message;
      paymentMessage.classList.toggle("is-error", isError);
    }

    function calculatePaymentPricing(baseAmount, feeRateBps) {
      const baseCents = Math.round(Number(baseAmount) * 100);
      if (!Number.isSafeInteger(baseCents) || baseCents < 1
        || !Number.isInteger(feeRateBps) || feeRateBps < 1 || feeRateBps >= 10000) {
        throw new Error("Não foi possível calcular o valor do pagamento.");
      }

      const estimatedTotalCents = baseCents * 10000 / (10000 - feeRateBps);
      const firstTotalCents = Math.max(baseCents, Math.floor(estimatedTotalCents) - 3);
      const lastTotalCents = Math.ceil(estimatedTotalCents) + 3;
      for (let totalCents = firstTotalCents; totalCents <= lastTotalCents; totalCents += 1) {
        const feeCents = Math.round(totalCents * feeRateBps / 10000);
        if (totalCents - feeCents === baseCents) {
          return {
            itemAmount: (baseCents / 100).toFixed(2),
            processingFee: ((totalCents - baseCents) / 100).toFixed(2),
            totalAmount: (totalCents / 100).toFixed(2),
            feeRateBps
          };
        }
      }
      throw new Error("Não foi possível calcular um total que cubra exatamente a tarifa.");
    }

    function showPaymentPricing(pricing) {
      paymentFeeRate.textContent = percentage.format(pricing.feeRateBps / 10000);
      paymentFeeAmount.textContent = currency.format(Number(pricing.processingFee));
      paymentTotalAmount.textContent = currency.format(Number(pricing.totalAmount));
      paymentBreakdown.hidden = false;
    }

    function cardFeeRateForInstallments(installments) {
      if (!Number.isInteger(installments) || installments < 1 || installments > 18) {
        throw new Error("O cartão pode ser parcelado em até 18 vezes.");
      }
      if (installments === 1) return paymentFeeRatesBps.cardSingle;
      if (installments <= 6) return paymentFeeRatesBps.cardTwoToSix;
      return paymentFeeRatesBps.cardSevenToEighteen;
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
      checkPaymentButton.textContent = "Consultar pagamento";
      methodButtons.forEach((button) => { button.hidden = true; });
      setPaymentMessage("");
      paymentDone.focus();
    }

    function applyOrderStatus(result, flow, isPolling = false) {
      if (flow !== paymentFlow) return;
      if (isPaid(result)) {
        showPaid();
        if (result.notificationWarning || result.logWarning) {
          checkPaymentButton.textContent = "Tentar reenviar aviso";
          checkPaymentButton.hidden = false;
        }
      } else if (isFinalFailure(result)) {
        setPaymentMessage("O pagamento não foi aprovado. Você pode tentar novamente ou escolher outra forma de pagamento.", true);
        activeOrderId = "";
        unmountCardBrick();
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
      const warnings = [result.logWarning, result.notificationWarning].filter(Boolean).join(" ");
      if (warnings) setPaymentMessage(warnings, true);
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
      const immediatePaidFlow = paymentFlow + 1;
      if (isPaid(result) && activeOrderId) {
        sendToAppsScript("POST", { action: "paymentStatus", orderId: activeOrderId }).then((status) => {
          if (paymentFlow !== immediatePaidFlow || !status.notificationWarning) return;
          setPaymentMessage(status.notificationWarning, true);
          checkPaymentButton.textContent = "Tentar reenviar aviso";
          checkPaymentButton.hidden = false;
        }).catch((error) => {
          if (paymentFlow !== immediatePaidFlow) return;
          setPaymentMessage(`Pagamento confirmado, mas não foi possível verificar o aviso por e-mail: ${error.message}`, true);
          checkPaymentButton.textContent = "Tentar reenviar aviso";
          checkPaymentButton.hidden = false;
        });
      }
      if (isChallenge(result)) showCardChallenge(result);
      else applyOrderStatus(result, flow);
      if (result.logWarning) setPaymentMessage(result.logWarning, true);
      if (!isPaid(result) && !isFinalFailure(result) && activeOrderId) {
        pollOrderStatus(activeOrderId, flow);
      }
    }

    function closePaymentModal() {
      paymentFlow += 1;
      activeOrderId = "";
      if (pendingCardPayment) {
        const pendingPayment = pendingCardPayment;
        pendingCardPayment = null;
        pendingPayment.reject(new Error("CARD_PAYMENT_REVIEW_CANCELLED"));
      }
      modal.hidden = true;
      unmountCardBrick();
      pixForm.reset();
      pixForm.hidden = true;
      pixResult.hidden = true;
      cardCheckout.hidden = true;
      cardPaymentReview.hidden = true;
      cardFeeNote.hidden = true;
      paymentBreakdown.hidden = true;
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
      activeGift = { ...gift };
      if (gift.customAmount) activeGift.price = 0;
      activeOrderId = "";
      paymentFlow += 1;
      giftName.textContent = gift.title;
      giftPrice.textContent = currency.format(activeGift.price);
      customGiftAmount.hidden = !gift.customAmount;
      customGiftPrice.value = gift.customAmount ? currency.format(0) : "";
      methodButtons.forEach((button) => { button.hidden = false; });
      if (gift.customAmount) updateCustomGiftAmount();
      paymentBreakdown.hidden = true;
      cardFeeNote.hidden = true;
      cardPaymentReview.hidden = true;
      setPaymentMessage("");
      modal.hidden = false;
      if (gift.customAmount) customGiftPrice.focus();
      else closeButton.focus();
    }

    function updateCustomGiftAmount() {
      const centsText = customGiftPrice.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
      const amountCents = Number(centsText || "0");
      if (!Number.isSafeInteger(amountCents)) {
        giftPrice.textContent = "Valor muito alto";
        methodButtons.forEach((button) => { button.hidden = true; });
        return;
      }

      const amount = amountCents / 100;
      customGiftPrice.value = currency.format(amount);
      customGiftPrice.setSelectionRange(customGiftPrice.value.length, customGiftPrice.value.length);
      activeGift.price = amount;
      giftPrice.textContent = currency.format(amount);
      methodButtons.forEach((button) => { button.hidden = amountCents < 100; });
    }

    function moveCustomAmountCaretToEnd() {
      const end = customGiftPrice.value.length;
      customGiftPrice.setSelectionRange(end, end);
    }

    function prepareCardPaymentReview(formData, additionalData, flow) {
      return new Promise((resolve, reject) => {
        if (flow !== paymentFlow) {
          reject(new Error("Esta sessão de pagamento foi encerrada."));
          return;
        }
        if (String(additionalData && additionalData.paymentTypeId || "") !== "credit_card") {
          const error = new Error("Selecione um cartão de crédito para continuar.");
          setPaymentMessage(error.message, true);
          reject(error);
          return;
        }

        let installments;
        let pricing;
        try {
          installments = Number(formData.installments);
          pricing = calculatePaymentPricing(activeGift.price, cardFeeRateForInstallments(installments));
        } catch (error) {
          setPaymentMessage(error.message, true);
          reject(error);
          return;
        }

        pendingCardPayment = {
          formData,
          paymentType: "credit_card",
          flow,
          pricing,
          resolve,
          reject
        };
        cardInstallmentSummary.textContent = installments === 1
          ? "Pagamento em 1x no cartão de crédito."
          : `Pagamento em ${installments}x no cartão de crédito.`;
        showPaymentPricing(pricing);
        cardCheckout.hidden = true;
        cardFeeNote.hidden = true;
        cardPaymentReview.hidden = false;
        methodButtons.forEach((button) => { button.hidden = true; });
        setPaymentMessage("");
      });
    }

    async function confirmCardPayment() {
      const pendingPayment = pendingCardPayment;
      if (!pendingPayment || pendingPayment.flow !== paymentFlow) return;

      confirmCardPaymentButton.disabled = true;
      cancelCardReviewButton.disabled = true;
      confirmCardPaymentButton.textContent = "Processando...";
      setPaymentMessage("Processando o pagamento com segurança...");
      try {
        const result = await sendToAppsScript("POST", {
          action: "createCardOrder",
          giftId: activeGift.id,
          amount: activeGift.price,
          phone: giftAccessPhone,
          cardData: JSON.stringify({
            formData: pendingPayment.formData,
            paymentType: pendingPayment.paymentType
          })
        }, 45000);
        if (pendingPayment.flow !== paymentFlow) return;
        if (result.pricing) showPaymentPricing(result.pricing);
        pendingCardPayment = null;
        cardPaymentReview.hidden = true;
        pendingPayment.resolve();
        showOrderResult(result, pendingPayment.flow);
      } catch (error) {
        if (pendingPayment.flow === paymentFlow) setPaymentMessage(error.message, true);
      } finally {
        confirmCardPaymentButton.disabled = false;
        cancelCardReviewButton.disabled = false;
        confirmCardPaymentButton.textContent = "Confirmar e pagar";
      }
    }

    function cancelCardPaymentReview() {
      const pendingPayment = pendingCardPayment;
      if (!pendingPayment) return;
      pendingCardPayment = null;
      cardPaymentReview.hidden = true;
      paymentBreakdown.hidden = true;
      cardCheckout.hidden = false;
      cardFeeNote.hidden = false;
      methodButtons.forEach((button) => { button.hidden = false; });
      setPaymentMessage("Pagamento não enviado. Confira os dados do cartão e tente novamente.");
      pendingPayment.reject(new Error("CARD_PAYMENT_REVIEW_CANCELLED"));
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
              visual: { texts: { formSubmit: "Revisar valores" } },
              paymentMethods: { 
                minInstallments: 1,
                maxInstallments: 18,
                types: { included: ["credit_card"] }
              }
            },
            callbacks: {
              onReady: () => {
                if (flow === paymentFlow) setPaymentMessage("");
              },
              onSubmit: (formData, additionalData) => prepareCardPaymentReview(formData, additionalData, flow),
              onError: (error) => {
                if (error && error.message === "CARD_PAYMENT_REVIEW_CANCELLED") return;
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
      if (!activeGift || !Number.isFinite(activeGift.price)) return;
      customGiftAmount.hidden = true;
      methodButtons.forEach((button) => {
        const selected = button.dataset.paymentMethod === method;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      setPaymentMessage("");
      pixResult.hidden = true;
      pixForm.hidden = method !== "pix";
      cardCheckout.hidden = method !== "card";
      paymentBreakdown.hidden = true;
      cardPaymentReview.hidden = true;
      cardFeeNote.hidden = method !== "card";
      if (method === "card") {
        await mountCardBrick();
      } else if (method === "pix") {
        try {
          showPaymentPricing(calculatePaymentPricing(activeGift.price, paymentFeeRatesBps.pix));
          pixEmail.focus();
        } catch (error) {
          setPaymentMessage(error.message, true);
        }
      }
    }

    methodButtons.forEach((button) => {
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => selectPaymentMethod(button.dataset.paymentMethod));
    });
    confirmCardPaymentButton.addEventListener("click", confirmCardPayment);
    cancelCardReviewButton.addEventListener("click", cancelCardPaymentReview);

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
          amount: activeGift.price,
          phone: giftAccessPhone,
          email: pixEmail.value.trim()
        }, 45000);
        if (flow !== paymentFlow) return;
        if (result.pricing) showPaymentPricing(result.pricing);
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

    function renderGiftCards(order) {
      list.replaceChildren();
      const orderedGifts = gifts.concat(donationGift);
      if (order === "ascending") orderedGifts.sort((a, b) => a.price - b.price);
      if (order === "descending") orderedGifts.sort((a, b) => b.price - a.price);

      orderedGifts.forEach((gift) => {
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
      price.textContent = gift.customAmount
        ? `A partir de ${currency.format(gift.price)} · valor livre`
        : currency.format(gift.price);
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

    sortOrder.addEventListener("change", () => renderGiftCards(sortOrder.value));
    customGiftPrice.addEventListener("input", updateCustomGiftAmount);
    customGiftPrice.addEventListener("focus", moveCustomAmountCaretToEnd);
    customGiftPrice.addEventListener("click", moveCustomAmountCaretToEnd);
    customGiftPrice.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        moveCustomAmountCaretToEnd();
      }
    });
    renderGiftCards(sortOrder.value);
  }

  initRsvp();
  if (initGiftAccessGate()) initGiftList();
})();