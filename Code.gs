/**
 * Confirmação de presença — João & Taise
 *
 * Antes de publicar:
 * 1. Informe o ID da planilha em SPREADSHEET_ID.
 * 2. A planilha precisa ter as abas ListaConvidados e Logs-Site.
 * 3. Os cabeçalhos requeridos são validados pelo nome exato na primeira linha.
 * 4. Configure MP_ACCESS_TOKEN nas propriedades do script; nunca o inclua no código.
 */
const SPREADSHEET_ID = "18fidFBXi2vK99DnuN8ci3A_RUpujnF4PqdgIJk-NHVM";
const GUEST_SHEET_NAME = "ListaConvidados";
const LOG_SHEET_NAME = "Logs-Site";
const TIME_ZONE = "America/Sao_Paulo";
const RESPONSE_CHANNEL = "joao-taise-rsvp";
const MERCADO_PAGO_TOKEN_PROPERTY = "MP_ACCESS_TOKEN";
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
  "gift-13": { title: "O empurrãozinho para realizarmos nosso sonho", price: 2500 }
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
  let result;
  try {
    if (!e || !e.parameter) {
      throw new Error("Solicitação inválida.");
    }
    if (e.parameter.action === "submit") {
      const answers = JSON.parse(e.parameter.answers || "[]");
      result = submitAnswers_(e.parameter.phone || "", answers);
    } else if (e.parameter.action === "createPixOrder") {
      result = createPixOrder_(e.parameter.giftId || "", e.parameter.email || "");
    } else if (e.parameter.action === "createCardOrder") {
      result = createCardOrder_(e.parameter.giftId || "", e.parameter.cardData || "");
    } else if (e.parameter.action === "paymentStatus") {
      result = getMercadoPagoOrderStatus_(e.parameter.orderId || "");
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

function createPixOrder_(giftId, email) {
  const gift = GIFT_CATALOG[giftId];
  if (!gift) throw new Error("Esse presente não está disponível. Atualize a página e tente novamente.");
  const payerEmail = validatePayerEmail_(email);
  const amount = gift.price.toFixed(2);
  const order = createMercadoPagoOrder_({
    type: "online",
    processing_mode: "automatic",
    capture_mode: "automatic",
    external_reference: giftId + "-" + Utilities.getUuid(),
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
  return paymentOrderSummary_(order);
}

function createCardOrder_(giftId, rawCardData) {
  const gift = GIFT_CATALOG[giftId];
  if (!gift) throw new Error("Esse presente não está disponível. Atualize a página e tente novamente.");
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
    || installments > 36
    || !["credit_card", "debit_card"].includes(paymentType)) {
    throw new Error("Os dados do cartão estão incompletos ou inválidos. Confira o formulário.");
  }
  const amount = gift.price.toFixed(2);
  const paymentMethod = {
    id: paymentMethodId,
    type: paymentType,
    token: token,
    installments: installments
  };
  if (formData.issuer_id) paymentMethod.issuer_id = String(formData.issuer_id);
  const orderPayload = {
    type: "online",
    processing_mode: "automatic",
    capture_mode: "automatic",
    external_reference: giftId + "-" + Utilities.getUuid(),
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
  return paymentOrderSummary_(createMercadoPagoOrder_(orderPayload));
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
  return paymentOrderSummary_(JSON.parse(response.getContentText()));
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
    qrCode: String(method.qr_code || ""),
    qrCodeBase64: String(method.qr_code_base64 || ""),
    ticketUrl: String(method.ticket_url || ""),
    challengeUrl: String(transactionSecurity.url || "")
  };
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
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
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
