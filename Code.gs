/**
 * Confirmação de presença — João & Taise
 *
 * Antes de publicar:
 * 1. Informe o ID da planilha em SPREADSHEET_ID.
 * 2. A planilha precisa ter as abas ListaConvidados e Logs-Site.
 * 3. Os cabeçalhos requeridos são validados pelo nome exato na primeira linha.
 */
const SPREADSHEET_ID = "18fidFBXi2vK99DnuN8ci3A_RUpujnF4PqdgIJk-NHVM";
const GUEST_SHEET_NAME = "ListaConvidados";
const LOG_SHEET_NAME = "Logs-Site";
const TIME_ZONE = "America/Sao_Paulo";
const RESPONSE_CHANNEL = "joao-taise-rsvp";

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
    if (!e || !e.parameter || e.parameter.action !== "submit") {
      throw new Error("Solicitação inválida.");
    }
    const answers = JSON.parse(e.parameter.answers || "[]");
    result = submitAnswers_(e.parameter.phone || "", answers);
  } catch (error) {
    console.error(error);
    result = {
      ok: false,
      message: error && error.message === "Essa resposta já foi registrada."
        ? error.message
        : "Não foi possível salvar sua resposta. Confira os dados e tente novamente."
    };
  }
  return responsePage_(requestId, result);
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
