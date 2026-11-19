/**
 * Confirmação de presença — João & Taise
 *
 * Antes de publicar:
 * 1. Informe o ID da planilha em SPREADSHEET_ID.
 * 2. A planilha precisa ter as abas ListaConvidados, Logs-Site e Logs-Compras-Site.
 * 3. Logs-Compras-Site deve conter Carimbo, Nome, Telefone, Status, Número do pedido, Nome do presente e Valor.
 * 4. Configure MP_ACCESS_TOKEN nas propriedades do script; nunca o inclua no código.
 * 5. Autorize o envio de e-mails ao publicar o Web App e configure o webhook de pedidos do Mercado Pago.
 */
const SPREADSHEET_ID = "18fidFBXi2vK99DnuN8ci3A_RUpujnF4PqdgIJk-NHVM";
const GUEST_SHEET_NAME = "ListaConvidados";
const LOG_SHEET_NAME = "Logs-Site";
const PURCHASE_LOG_SHEET_NAME = "Logs-Compras-Site";
const PURCHASE_LOG_HEADERS = ["Carimbo", "Nome", "Telefone", "Status", "Número do pedido", "Nome do presente", "Valor"];
const TIME_ZONE = "America/Sao_Paulo";
const RESPONSE_CHANNEL = "joao-taise-rsvp";
const MERCADO_PAGO_TOKEN_PROPERTY = "MP_ACCESS_TOKEN";
const NOTIFICATION_RECIPIENTS = ["jvnogueira2010@gmail.com", "taise_lf92@hotmail.com"];
const PAYMENT_FEE_RATES_BPS = {
  pix: 99,
  cardSingle: 498,
  cardTwoToSix: 299,
  cardSevenToEighteen: 309
};
const GIFT_CATALOG = {
  "gift-01": { title: "Ajuda para nosso café da manhã romântico", price: 250 },
  "gift-02": { title: "Um brinde ao nosso amor 🥂", price: 300 },
  "gift-03": { title: "Um sorvete para adoçar nossa lua de mel", price: 50 },
  "gift-04": { title: "Um almoço com vista para o mar", price: 500 },
  "gift-05": { title: "Um jantar romântico a dois", price: 700 },
  "gift-06": { title: "Uma experiência gastronômica especial", price: 400 },
  "gift-07": { title: "Contribuição para nosso passeio de barco", price: 300 },
  "gift-08": { title: "Um dia de aventuras em Arraial do Cabo", price: 1000 },
  "gift-09": { title: "Uma experiência inesquecível para o casal", price: 600 },
  "gift-10": { title: "Uma diária de passeios e descobertas", price: 400 },
  "gift-11": { title: "Um presente para eternizar nossa viagem", price: 750 },
  "gift-12": { title: "Uma contribuição especial para nossa lua de mel", price: 1500 },
  "gift-13": { title: "O empurrãozinho para realizarmos nosso sonho", price: 2500 },
  "gift-custom": { title: "Ajude com o valor que seu coração desejar", price: 1, customAmount: true }
};

function doGet(e) {
  const requestId = validRequestId_(e && e.parameter ? e.parameter.requestId : "");
  let result;
  try {
    if (!e || !e.parameter || e.parameter.action !== "access") {
      throw new Error("Solicitação inválida.");
    }
    result = accessGuest_(e.parameter.phone || "");
  } catch (error) {
    console.error(error);
    result = { ok: false, message: "Não foi possível consultar a lista. Tente novamente ou fale com os noivos." };
  }
  return responsePage_(requestId, result);
}

function doPost(e) {
  const requestId = validRequestId_(e && e.parameter ? e.parameter.requestId : "");
  const parameters = e && e.parameter ? e.parameter : {};
  let result;
  try {
    if (!e) {
      throw new Error("Solicitação inválida.");
    }
    if (parameters.action === "submit") {
      const answers = JSON.parse(parameters.answers || "[]");
      result = submitAnswers_(parameters.phone || "", answers);
    } else if (parameters.action === "createPixOrder") {
      result = createPixOrder_(
        parameters.giftId || "",
        parameters.email || "",
        parameters.amount || "",
        parameters.phone || ""
      );
    } else if (parameters.action === "createCardOrder") {
      result = createCardOrder_(
        parameters.giftId || "",
        parameters.cardData || "",
        parameters.amount || "",
        parameters.phone || ""
      );
    } else if (parameters.action === "paymentStatus") {
      result = getMercadoPagoOrderStatus_(parameters.orderId || "");
    } else if (e.postData && e.postData.contents) {
      result = getMercadoPagoOrderStatus_(mercadoPagoWebhookOrderId_(e));
    } else {
      throw new Error("Solicitação inválida.");
    }
  } catch (error) {
    console.error(error);
    result = {
      ok: false,
      message: error && error.message
        ? error.message
        : "Não foi possível concluir a solicitação. Tente novamente."
    };
  }
  return responsePage_(requestId, result);
}

function mercadoPagoWebhookOrderId_(event) {
  let notification;
  try {
    notification = JSON.parse(event.postData.contents);
  } catch (error) {
    throw new Error("A notificação do Mercado Pago não contém JSON válido.");
  }
  const parameters = event.parameter || {};
  const orderId = String(
    notification && notification.data && notification.data.id
      || parameters["data.id"]
      || parameters.id
      || ""
  );
  if (!/^ORD[A-Z0-9]{8,48}$/i.test(orderId)) {
    throw new Error("A notificação do Mercado Pago não contém um pedido válido.");
  }
  return orderId;
}

function createPixOrder_(giftId, email, rawAmount, rawPhone) {
  const guest = purchaseGuest_(rawPhone);
  const purchaseDetails = purchaseForGift_(giftId, rawAmount, guest);
  const gift = purchaseDetails.gift;
  const purchase = purchaseDetails.purchase;
  try {
    const payerEmail = validatePayerEmail_(email);
    const pricing = paymentPricing_(gift.price, PAYMENT_FEE_RATES_BPS.pix);
    const amount = pricing.totalAmount;
const order = createMercadoPagoOrder_({
  type: "online",
  processing_mode: "automatic",
  external_reference: giftReference_(giftId),
  total_amount: amount,
  description: gift.title,
  payer: { email: payerEmail },
  transactions: {
    payments: [{
      amount: amount,
      payment_method: { id: "pix", type: "bank_transfer" }
    }]
  }
});
    const summary = paymentOrderSummary_(order);
    summary.pricing = pricing;
    purchase.orderId = summary.orderId;
    purchase.status = purchaseStatus_(summary);
    try {
      recordPurchase_(purchase);
    } catch (error) {
      console.error("Mercado Pago order was created but could not be logged.", error);
      summary.logWarning = "O pedido foi criado, mas não conseguimos registrá-lo na planilha.";
    }
    return summary;
  } catch (error) {
    recordPurchaseError_(purchase, error);
    throw error;
  }
}

function createCardOrder_(giftId, rawCardData, rawAmount, rawPhone) {
  const guest = purchaseGuest_(rawPhone);
  const purchaseDetails = purchaseForGift_(giftId, rawAmount, guest);
  const gift = purchaseDetails.gift;
  const purchase = purchaseDetails.purchase;
  try {
    let cardData;
    try {
      cardData = JSON.parse(rawCardData);
    } catch (error) {
      throw new Error("Não foi possível validar os dados do cartão. Tente novamente.");
    }

    const formData = cardData.formData || {};
    const payer = formData.payer || {};
    const paymentType = String(cardData.paymentType || "");
    const paymentMethodId = String(formData.payment_method_id || "");
    const token = String(formData.token || "");
    const installments = Number(formData.installments);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(paymentMethodId)
      || !/^[A-Za-z0-9]{32,33}$/.test(token)
      || !Number.isInteger(installments)
      || installments < 1
      || installments > 18
      || paymentType !== "credit_card") {
      throw new Error("Os dados do cartão estão incompletos ou inválidos. Confira o formulário.");
    }
    const feeRate = installments === 1
      ? PAYMENT_FEE_RATES_BPS.cardSingle
      : installments <= 6
        ? PAYMENT_FEE_RATES_BPS.cardTwoToSix
        : PAYMENT_FEE_RATES_BPS.cardSevenToEighteen;
    const pricing = paymentPricing_(gift.price, feeRate);
    const amount = pricing.totalAmount;
    const paymentMethod = {
      id: paymentMethodId,
      type: paymentType,
      token: token,
      installments: installments
    };
    const orderPayload = {
      type: "online",
      processing_mode: "automatic",
      external_reference: giftReference_(giftId),
      total_amount: amount,
      description: gift.title,
      config: {
        online: {
          transaction_security: {
            validation: "on_fraud_risk",
            liability_shift: "required"
          }
        }
      },
      payer: {
        email: validatePayerEmail_(payer.email),
        identification: payer.identification || undefined
      },
      transactions: {
        payments: [{ amount: amount, payment_method: paymentMethod }]
      }
    };
    const summary = paymentOrderSummary_(createMercadoPagoOrder_(orderPayload));
    summary.pricing = pricing;
    purchase.orderId = summary.orderId;
    purchase.status = purchaseStatus_(summary);
    try {
      recordPurchase_(purchase);
    } catch (error) {
      console.error("Mercado Pago order was created but could not be logged.", error);
      summary.logWarning = "O pedido foi criado, mas não conseguimos registrá-lo na planilha.";
    }
    return summary;
  } catch (error) {
    recordPurchaseError_(purchase, error);
    throw error;
  }
}

function giftForOrder_(giftId, rawAmount) {
  const catalogGift = GIFT_CATALOG[giftId];
  if (!catalogGift) throw new Error("Esse presente não está disponível. Atualize a página e tente novamente.");
  const gift = { title: catalogGift.title, price: catalogGift.price };
  if (!catalogGift.customAmount) return gift;

  const amount = Number(rawAmount);
  const amountCents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(amountCents) || amountCents < 100
    || Math.abs(amount * 100 - amountCents) > 0.00001) {
    throw new Error("Informe um valor válido a partir de R$ 1,00.");
  }
  gift.price = amountCents / 100;
  return gift;
}

function giftReference_(giftId) {
  return giftId + "-" + Utilities.getUuid();
}

function purchaseForGift_(giftId, rawAmount, guest) {
  const catalogGift = GIFT_CATALOG[giftId];
  const purchase = {
    name: guest.name,
    phone: guest.phone,
    status: "",
    orderId: "",
    giftTitle: catalogGift ? catalogGift.title : String(giftId || "").slice(0, 100),
    amount: catalogGift ? catalogGift.price : ""
  };
  try {
    const gift = giftForOrder_(giftId, rawAmount);
    purchase.giftTitle = gift.title;
    purchase.amount = gift.price;
    return { gift: gift, purchase: purchase };
  } catch (error) {
    recordPurchaseError_(purchase, error);
    throw error;
  }
}

function purchaseGuest_(rawPhone) {
  const phone = normalizePhone_(rawPhone);
  if (!isValidBrazilianPhone_(phone)) throw new Error("O celular da sessão não é válido.");
  const book = spreadsheet_();
  const guestsSheet = book.getSheetByName(GUEST_SHEET_NAME);
  if (!guestsSheet) throw new Error("A aba ListaConvidados não foi encontrada.");
  const guestTable = readTable_(guestsSheet, ["Convidados", "Motivo", "Numero"], { Numero: ["Telefone"] });
  const matches = guestTable.rows.filter((guest) => guestPhones_(guest.Numero).includes(phone));
  if (!matches.length) throw new Error("Este celular não foi encontrado na lista de convidados.");
  return {
    name: guestLogName_(matches[0], guestTable.rows),
    phone: phone
  };
}

function purchaseLogSheet_() {
  const sheet = spreadsheet_().getSheetByName(PURCHASE_LOG_SHEET_NAME);
  if (!sheet) throw new Error("A aba " + PURCHASE_LOG_SHEET_NAME + " não foi encontrada.");
  return sheet;
}

function recordPurchase_(purchase) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = purchaseLogSheet_();
    const table = readTable_(sheet, PURCHASE_LOG_HEADERS);
    const cells = new Array(table.headers.length).fill("");
    const values = {
      "Carimbo": Utilities.formatDate(new Date(), TIME_ZONE, "dd/MM/yyyy HH:mm:ss"),
      "Nome": purchase.name,
      "Telefone": purchase.phone,
      "Status": purchase.status,
      "Número do pedido": purchase.orderId,
      "Nome do presente": purchase.giftTitle,
      "Valor": purchase.amount
    };
    Object.keys(values).forEach((header) => { cells[table.indexes[header]] = values[header]; });
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, table.headers.length).setValues([cells]);
  } finally {
    lock.releaseLock();
  }
}

function recordPurchaseError_(purchase, error) {
  purchase.status = "Erro: " + String(error && error.message || "Não foi possível iniciar o pagamento.").replace(/[\r\n]+/g, " ").slice(0, 300);
  try {
    recordPurchase_(purchase);
  } catch (logError) {
    console.error("Could not write the failed purchase to the purchase log.", logError);
  }
}

function updatePurchaseStatus_(orderId, status) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = purchaseLogSheet_();
    const table = readTable_(sheet, PURCHASE_LOG_HEADERS);
    const orderColumn = table.indexes["Número do pedido"];
    if (sheet.getLastRow() < 2) throw new Error("O pedido não foi encontrado na planilha de compras.");
    const orderIds = sheet.getRange(2, orderColumn + 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    const rowIndex = orderIds.findIndex((row) => String(row[0]).trim() === orderId);
    if (rowIndex < 0) throw new Error("O pedido não foi encontrado na planilha de compras.");
    const statusCell = sheet.getRange(rowIndex + 2, table.indexes.Status + 1);
    if (statusCell.getDisplayValue() !== status) statusCell.setValue(status);
  } finally {
    lock.releaseLock();
  }
}

function findPurchase_(orderId) {
  const sheet = purchaseLogSheet_();
  const table = readTable_(sheet, PURCHASE_LOG_HEADERS);
  const rowValues = sheet.getDataRange().getValues();
  const orderColumn = table.indexes["Número do pedido"];
  for (let rowIndex = 1; rowIndex < rowValues.length; rowIndex += 1) {
    if (String(rowValues[rowIndex][orderColumn]).trim() !== orderId) continue;
    const purchase = {};
    PURCHASE_LOG_HEADERS.forEach((header) => {
      purchase[header] = rowValues[rowIndex][table.indexes[header]];
    });
    return purchase;
  }
  return null;
}

function purchaseStatus_(order) {
  const status = String(order.status || "").toLowerCase();
  const detail = String(order.statusDetail || "").toLowerCase();
  if (status === "processed" && detail === "accredited") return "Confirmado";
  if (status === "action_required" && detail === "pending_challenge") return "Aguardando verificação do banco";
  if (["failed", "canceled", "cancelled", "expired", "closed"].includes(status)) {
    return "Não aprovado: " + [order.status, order.statusDetail].filter(Boolean).join(" — ");
  }
  return "Aguardando pagamento: " + (order.status || "status pendente");
}

function paymentPricing_(baseAmount, feeRateBps) {
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
        feeRateBps: feeRateBps
      };
    }
  }
  throw new Error("Não foi possível calcular um total que cubra exatamente a tarifa.");
}

function createMercadoPagoOrder_(orderPayload) {
  const accessToken = mercadoPagoAccessToken_();
  const apiResponse = UrlFetchApp.fetch("https://api.mercadopago.com/v1/orders", {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + accessToken,
      "X-Idempotency-Key": Utilities.getUuid()
    },
    payload: JSON.stringify(orderPayload),
    muteHttpExceptions: true
  });
  const statusCode = apiResponse.getResponseCode();
  let order;
  try {
    order = JSON.parse(apiResponse.getContentText());
  } catch (error) {
    console.error("Mercado Pago order returned a non-JSON response (" + statusCode + ").");
    throw new Error("O Mercado Pago não respondeu corretamente. Tente novamente.");
  }
  if (statusCode === 402 && order.id) return order;
  if (statusCode < 200 || statusCode >= 300) {
    console.error("Mercado Pago order failed (" + statusCode + "): " + JSON.stringify(order.errors || order.cause || []));
    throw new Error("Não foi possível processar o pagamento. Confira os dados e tente novamente.");
  }
  if (!order.id) {
    console.error("Mercado Pago order response is missing its id.");
    throw new Error("O Mercado Pago não retornou a identificação do pagamento. Tente novamente.");
  }
  return order;
}

function getMercadoPagoOrderStatus_(orderId) {
  if (!/^ORD[A-Z0-9]{8,48}$/i.test(orderId)) throw new Error("Não foi possível consultar este pagamento.");
  let summary;
  try {
    const response = UrlFetchApp.fetch("https://api.mercadopago.com/v1/orders/" + encodeURIComponent(orderId), {
      method: "get",
      headers: { Authorization: "Bearer " + mercadoPagoAccessToken_() },
      muteHttpExceptions: true
    });
    const statusCode = response.getResponseCode();
    if (statusCode < 200 || statusCode >= 300) {
      console.error("Mercado Pago order status failed (" + statusCode + ").");
      throw new Error("Não foi possível consultar o status do pagamento. Tente novamente.");
    }
    summary = paymentOrderSummary_(JSON.parse(response.getContentText()));
  } catch (error) {
    try {
      updatePurchaseStatus_(orderId, "Erro ao consultar pagamento: " + String(error.message || "erro desconhecido").slice(0, 250));
    } catch (logError) {
      console.error("Could not write the payment-status error to the purchase log.", logError);
    }
    throw error;
  }

  try {
    updatePurchaseStatus_(orderId, purchaseStatus_(summary));
  } catch (error) {
    console.error("Payment status was retrieved but could not be written to the purchase log.", error);
    summary.logWarning = "O status foi consultado, mas não conseguimos atualizá-lo na planilha.";
  }

  if (summary.status.toLowerCase() === "processed" && summary.statusDetail.toLowerCase() === "accredited") {
    try {
      if (summary.logWarning) throw new Error(summary.logWarning);
      notifyGiftPurchase_(summary);
    } catch (error) {
      console.error("Payment was confirmed but the gift notification email could not be sent.", error);
      summary.notificationWarning = "O pagamento foi confirmado, mas não conseguimos enviar o aviso por e-mail aos noivos.";
      try {
        updatePurchaseStatus_(orderId, "Confirmado — falha ao enviar o e-mail");
      } catch (logError) {
        console.error("Could not write the email-delivery error to the purchase log.", logError);
      }
    }
  }
  return summary;
}

function paymentOrderSummary_(order) {
  const payments = order.transactions && Array.isArray(order.transactions.payments)
    ? order.transactions.payments
    : [];
  const payment = payments.length ? payments[0] : {};
  const method = payment.payment_method || {};
  const transactionSecurity = method.transaction_security || {};
  return {
    ok: true,
    orderId: String(order.id || ""),
    status: String(order.status || payment.status || ""),
    statusDetail: String(order.status_detail || payment.status_detail || ""),
    externalReference: String(order.external_reference || ""),
    paymentMethod: String(method.id || ""),
    qrCode: String(method.qr_code || ""),
    qrCodeBase64: String(method.qr_code_base64 || ""),
    ticketUrl: String(method.ticket_url || ""),
    challengeUrl: String(transactionSecurity.url || "")
  };
}

function notifyGiftPurchase_(order) {
  const reference = /^([a-z0-9-]+)-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.exec(
    String(order.externalReference || "")
  );
  const giftId = reference && reference[1].toLowerCase();
  if (!giftId || !GIFT_CATALOG[giftId] || !/^[A-Z0-9]{8,48}$/i.test(order.orderId)) return;

  const properties = PropertiesService.getScriptProperties();
  const propertyKey = "NOTIFIED_GIFT_ORDER_" + order.orderId;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (properties.getProperty(propertyKey)) return;
    const purchase = findPurchase_(order.orderId);
    if (!purchase) throw new Error("O pedido confirmado não foi encontrado na planilha de compras.");
    const body = PURCHASE_LOG_HEADERS.map((header) => {
      const value = header === "Valor"
        ? Number(purchase[header]).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        : purchase[header];
      return header + ": " + value;
    }).join("\n");
    MailApp.sendEmail(
      NOTIFICATION_RECIPIENTS.join(","),
      "Presente confirmado — Casamento de João & Taise",
      body
    );
    properties.setProperty(propertyKey, new Date().toISOString());
  } finally {
    lock.releaseLock();
  }
}

function validatePayerEmail_(email) {
  const value = String(email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
    throw new Error("Informe um e-mail válido para gerar o pagamento.");
  }
  return value;
}

function mercadoPagoAccessToken_() {
  const accessToken = PropertiesService.getScriptProperties().getProperty(MERCADO_PAGO_TOKEN_PROPERTY);
  if (!accessToken) {
    throw new Error("O pagamento ainda está sendo configurado. Tente novamente mais tarde.");
  }
  return accessToken;
}

function testMercadoPagoConnection() {
  const accessToken = mercadoPagoAccessToken_();
  const response = UrlFetchApp.fetch("https://api.mercadopago.com/users/me", {
    method: "get",
    headers: { Authorization: "Bearer " + accessToken },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error("O Mercado Pago recusou a credencial. Confira se o token de produção está correto.");
  }
  return "Conexão com Mercado Pago validada.";
}

function accessGuest_(rawPhone) {
  const phone = normalizePhone_(rawPhone);
  if (!isValidBrazilianPhone_(phone)) return { ok: false, message: "Informe um celular brasileiro válido com DDD." };

  const book = spreadsheet_();
  const guestsSheet = book.getSheetByName(GUEST_SHEET_NAME);
  const logsSheet = book.getSheetByName(LOG_SHEET_NAME);
  if (!guestsSheet || !logsSheet) throw new Error("Confira se as abas ListaConvidados e Logs-Site existem.");

  const guestTable = readTable_(guestsSheet, ["Convidados", "Motivo", "Numero", "Genero"], { Numero: ["Telefone"] });
  const logTable = readTable_(logsSheet, ["Carimbo", "Nome", "Numero", "Tipo"], { Numero: ["Telefone"] });
  const matches = guestTable.rows.filter((row) => guestPhones_(row.Numero).includes(phone));
  const principal = matches.length ? String(matches[0].Convidados || "").trim() : "Desconhecido";
  appendLog_(logsSheet, logTable, principal || "Desconhecido", phone, "Acesso");

  if (!matches.length) return { ok: true, found: false };

  const responses = [];
  const pending = [];
  matches.forEach((guest, index) => {
    const status = guestStatus_(guest, guestTable.rows, logTable.rows);
    if (status) {
      responses.push({ name: guestLogName_(guest, guestTable.rows), status: status });
    } else if (!isDependentDeclinedByThisPhone_(guest, phone, guestTable.rows, logTable.rows)) {
      pending.push({ guest: guest, index: index });
    }
  });
  if (!pending.length) {
    return { ok: true, found: true, alreadyResponded: true, responses: responses };
  }

  return {
    ok: true,
    found: true,
    alreadyResponded: false,
    responses: responses,
    guests: pending.map((item) => ({
      index: item.index,
      name: String(item.guest.Convidados || "").trim(),
      reason: String(item.guest.Motivo || "").trim(),
      gender: String(item.guest.Genero || "").trim().toUpperCase()
    }))
  };
}

function submitAnswers_(rawPhone, answers) {
  const phone = normalizePhone_(rawPhone);
  if (!isValidBrazilianPhone_(phone)) throw new Error("O número de celular informado é inválido.");
  if (!Array.isArray(answers) || !answers.length) throw new Error("Nenhuma resposta foi enviada.");

  let notificationAnswers = [];
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const book = spreadsheet_();
    const guestsSheet = book.getSheetByName(GUEST_SHEET_NAME);
    const logsSheet = book.getSheetByName(LOG_SHEET_NAME);
    if (!guestsSheet || !logsSheet) throw new Error("Confira se as abas ListaConvidados e Logs-Site existem.");

    const guestTable = readTable_(guestsSheet, ["Convidados", "Motivo", "Numero", "Genero"], { Numero: ["Telefone"] });
    const logTable = readTable_(logsSheet, ["Carimbo", "Nome", "Numero", "Tipo"], { Numero: ["Telefone"] });
    const matches = guestTable.rows.filter((row) => guestPhones_(row.Numero).includes(phone));
    if (!matches.length) throw new Error("Este celular não foi encontrado na lista de convidados.");

    const pending = matches
      .map((guest, index) => ({ guest: guest, index: index }))
      .filter((item) => !guestStatus_(item.guest, guestTable.rows, logTable.rows)
        && !isDependentDeclinedByThisPhone_(item.guest, phone, guestTable.rows, logTable.rows));
    if (!pending.length) throw new Error("Essa resposta já foi registrada.");

    const normalizedAnswers = answers.map((answer) => ({
      index: Number(answer.index),
      answer: String(answer.answer || "")
    })).sort((a, b) => a.index - b.index);
    const answerByIndex = {};
    normalizedAnswers.forEach((answer) => {
      if (!Number.isInteger(answer.index) || answerByIndex[answer.index] || !["Sim", "Não"].includes(answer.answer)) {
        throw new Error("Uma ou mais respostas são inválidas.");
      }
      answerByIndex[answer.index] = answer.answer;
    });

    const primaryDeclined = answerByIndex[pending[0].index] === "Não";
    const decliningAdultGroup = primaryDeclined && guestPhones_(pending[0].guest.Numero).length === 1;
    const selected = decliningAdultGroup
      ? pending.filter((item) => guestPhones_(item.guest.Numero).length === 1)
      : primaryDeclined ? [pending[0]] : pending;
    if (primaryDeclined) {
      if (normalizedAnswers.length !== 1 || !answerByIndex[pending[0].index]) {
        throw new Error("Ao recusar o convite, envie somente a resposta do titular.");
      }
    } else if (normalizedAnswers.length !== pending.length
      || pending.some((item) => !answerByIndex[item.index])) {
      throw new Error("Confira se todos os convidados selecionaram uma resposta.");
    }

    const timestamp = Utilities.formatDate(new Date(), TIME_ZONE, "dd/MM/yyyy HH:mm:ss");
    const entries = [];
    selected.forEach((item) => {
      const answer = decliningAdultGroup ? "Não" : answerByIndex[item.index];
      const responsePhones = guestPhones_(item.guest.Numero).length > 1
        ? guestPhones_(item.guest.Numero)
        : [phone];
      responsePhones.forEach((responsePhone) => {
        entries.push(makeLogEntry_(item.guest, guestTable.rows, responsePhone, answer, timestamp));
      });
    });
    appendLogs_(logsSheet, logTable, entries);
    logTable.rows = logTable.rows.concat(entries);

    appendChildrenDeclinedByAllGuardians_(guestTable.rows, logTable, logsSheet, timestamp);
    notificationAnswers = selected.map((item) => ({
      name: guestLogName_(item.guest, guestTable.rows),
      answer: decliningAdultGroup ? "Não" : answerByIndex[item.index]
    }));
  } finally {
    lock.releaseLock();
  }

  if (!notificationAnswers.some((answer) => answer.answer === "Sim")) return { ok: true };
  try {
    notifyRsvp_(notificationAnswers);
    return { ok: true };
  } catch (error) {
    console.error("RSVP was saved but the notification email could not be sent.", error);
    return {
      ok: true,
      notificationWarning: "A presença foi registrada, mas não conseguimos enviar o aviso por e-mail aos noivos."
    };
  }
}

function notifyRsvp_(answers) {
  const timestamp = Utilities.formatDate(new Date(), TIME_ZONE, "dd/MM/yyyy HH:mm:ss");
  const body = [
    "Uma nova resposta de presença foi registrada para o casamento de João e Taise.",
    "",
    answers.map((answer) => answer.name + ": " + (answer.answer === "Sim" ? "presença confirmada" : "não poderá comparecer")).join("\n"),
    "",
    "Registrada em: " + timestamp
  ].join("\n");
  MailApp.sendEmail(
    NOTIFICATION_RECIPIENTS.join(","),
    "Nova confirmação de presença — Casamento de João & Taise",
    body
  );
}

function guestPhones_(value) {
  return String(value == null ? "" : value)
    .split(/[,;\/\n]+/)
    .map((part) => normalizePhone_(part))
    .filter((phone, index, phones) => isValidBrazilianPhone_(phone) && phones.indexOf(phone) === index);
}

function guestLogName_(guest, guests) {
  const name = String(guest.Convidados || "").trim();
  const phones = guestPhones_(guest.Numero);
  const hasDuplicate = guests.some((other) => other !== guest
    && String(other.Convidados || "").trim() === name
    && guestPhones_(other.Numero).some((phone) => phones.includes(phone)));
  return hasDuplicate ? String(guest.Motivo || "").trim() || name : name;
}

function guestStatusForPhone_(guest, phone, guests, logRows) {
  const logName = guestLogName_(guest, guests);
  let status = "";
  logRows.forEach((log) => {
    if (normalizePhone_(log.Numero) === phone
      && String(log.Nome || "").trim() === logName
      && ["Confirmado", "Negado"].includes(String(log.Tipo || "").trim())) {
      status = String(log.Tipo).trim();
    }
  });
  return status;
}

function guestStatus_(guest, guests, logRows) {
  let status = "";
  guestPhones_(guest.Numero).forEach((phone) => {
    status = guestStatusForPhone_(guest, phone, guests, logRows) || status;
  });
  return status;
}

function isDependentDeclinedByThisPhone_(guest, phone, guests, logRows) {
  const guestPhones = guestPhones_(guest.Numero);
  if (guestPhones.length < 2 || !guestPhones.includes(phone)) return false;
  return guests.some((adult) => {
    const adultPhones = guestPhones_(adult.Numero);
    return adult !== guest
      && adultPhones.length === 1
      && adultPhones[0] === phone
      && guestStatusForPhone_(adult, phone, guests, logRows) === "Negado";
  });
}

function makeLogEntry_(guest, guests, phone, answer, timestamp) {
  return {
    Carimbo: timestamp,
    Nome: guestLogName_(guest, guests),
    Numero: phone,
    Tipo: answer === "Sim" ? "Confirmado" : "Negado"
  };
}

function appendChildrenDeclinedByAllGuardians_(guests, logTable, logsSheet, timestamp) {
  const entries = [];
  guests.forEach((child) => {
    const phones = guestPhones_(child.Numero);
    if (phones.length < 2 || guestStatus_(child, guests, logTable.rows)) return;
    const everyGuardianDeclined = phones.every((phone) => {
      const adults = guests.filter((guest) => guest !== child
        && guestPhones_(guest.Numero).length === 1
        && guestPhones_(guest.Numero)[0] === phone);
      return adults.length > 0 && adults.every((adult) => guestStatusForPhone_(adult, phone, guests, logTable.rows) === "Negado");
    });
    if (!everyGuardianDeclined) return;
    phones.forEach((phone) => {
      entries.push(makeLogEntry_(child, guests, phone, "Não", timestamp));
    });
  });
  if (entries.length) {
    appendLogs_(logsSheet, logTable, entries);
    logTable.rows = logTable.rows.concat(entries);
  }
}

function spreadsheet_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === "COLE_AQUI_O_ID_DA_PLANILHA") {
    throw new Error("Configure o ID da planilha na constante SPREADSHEET_ID.");
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function readTable_(sheet, requiredHeaders, aliases) {
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) throw new Error("A aba " + sheet.getName() + " precisa ter uma linha de cabeçalho.");
  const headers = values[0].map((header) => String(header).trim());
  const indexes = {};
  requiredHeaders.forEach((name) => {
    const candidates = [name].concat(aliases && aliases[name] ? aliases[name] : []);
    const index = candidates.map((candidate) => headers.indexOf(candidate)).find((candidateIndex) => candidateIndex >= 0);
    if (index === undefined) throw new Error('Cabeçalho obrigatório "' + name + '" não encontrado em ' + sheet.getName() + ".");
    indexes[name] = index;
  });
  const rows = values.slice(1).map((cells) => {
    const record = {};
    requiredHeaders.forEach((name) => { record[name] = cells[indexes[name]]; });
    return record;
  });
  return { headers: headers, rows: rows, indexes: indexes };
}

function appendLog_(sheet, table, name, phone, type) {
  appendLogs_(sheet, table, [{ Carimbo: Utilities.formatDate(new Date(), TIME_ZONE, "dd/MM/yyyy HH:mm:ss"), Nome: name, Numero: phone, Tipo: type }]);
}

function appendLogs_(sheet, table, records) {
  const width = table.headers.length;
  const rows = records.map((record) => {
    const cells = new Array(width).fill("");
    Object.keys(record).forEach((header) => { cells[table.indexes[header]] = record[header]; });
    return cells;
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
}

function normalizePhone_(value) {
  return String(value == null ? "" : value).replace(/\D/g, "");
}

function isValidBrazilianPhone_(phone) {
  return /^\d{10,11}$/.test(phone);
}

function validRequestId_(value) {
  const requestId = String(value || "");
  return /^[a-zA-Z0-9-]{1,80}$/.test(requestId) ? requestId : "";
}

function responsePage_(requestId, payload) {
  const safePayload = JSON.stringify(payload).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const safeRequestId = JSON.stringify(requestId);
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
    'window.top.postMessage({channel:' + JSON.stringify(RESPONSE_CHANNEL) +
    ',requestId:' + safeRequestId + ',payload:' + safePayload + '},"*");' +
    '</script></body></html>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}