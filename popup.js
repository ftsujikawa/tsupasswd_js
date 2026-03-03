const connectBtn = document.getElementById("connect");
const sendBtn = document.getElementById("send");
const listBtn = document.getElementById("list");
const clearBtn = document.getElementById("clear");
const addBtn = document.getElementById("add");
const removeBtn = document.getElementById("remove");
const payloadEl = document.getElementById("payload");
const resultEl = document.getElementById("result");
const rpIdFilterEl = document.getElementById("rpIdFilter");
const searchEl = document.getElementById("search");
const rowsEl = document.getElementById("passkeyRows");
const pkTitleEl = document.getElementById("pkTitle");
const pkRpIdEl = document.getElementById("pkRpId");
const pkUserEl = document.getElementById("pkUser");
const pkIdEl = document.getElementById("pkId");

let lastPasskeys = [];

function setResult(value) {
  resultEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function escapeText(v) {
  return String(v ?? "");
}

function renderPasskeys() {
  const q = (searchEl.value ?? "").trim().toLowerCase();

  const filtered = q
    ? lastPasskeys.filter((p) => {
        const hay = [p?.title, p?.rpId, p?.user, p?.id].map((x) => String(x ?? "").toLowerCase()).join(" ");
        return hay.includes(q);
      })
    : lastPasskeys;

  rowsEl.textContent = "";
  for (const p of filtered) {
    const tr = document.createElement("tr");

    const tdTitle = document.createElement("td");
    tdTitle.textContent = escapeText(p?.title);
    tr.appendChild(tdTitle);

    const tdRpId = document.createElement("td");
    tdRpId.textContent = escapeText(p?.rpId);
    tr.appendChild(tdRpId);

    const tdUser = document.createElement("td");
    tdUser.textContent = escapeText(p?.user);
    tr.appendChild(tdUser);

    const tdId = document.createElement("td");
    tdId.textContent = escapeText(p?.id);
    tr.appendChild(tdId);

    const tdBackedUp = document.createElement("td");
    tdBackedUp.textContent = p?.backedUp ? "true" : "false";
    tr.appendChild(tdBackedUp);

    const tdRemovable = document.createElement("td");
    tdRemovable.textContent = p?.removable ? "true" : "false";
    tr.appendChild(tdRemovable);

    tr.addEventListener("click", () => {
      pkIdEl.value = escapeText(p?.id);
      pkTitleEl.value = escapeText(p?.title);
      pkRpIdEl.value = escapeText(p?.rpId);
      pkUserEl.value = escapeText(p?.user);
    });
    rowsEl.appendChild(tr);
  }
}

function sendNative(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "native-request", payload }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res ?? { ok: false, error: "No response" });
    });
  });
}

function sendNativeAwait(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "native-request-await", payload }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res ?? { ok: false, error: "No response" });
    });
  });
}

function tryDeriveRpIdFromUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "";
    }
    const host = (url.hostname ?? "").trim().toLowerCase();
    return host;
  } catch {
    return "";
  }
}

async function refreshList() {
  const requestId = `list-${Date.now()}`;
  const rpId = (rpIdFilterEl.value ?? "").trim();
  const payload = {
    type: "list_passkeys",
    requestId,
    ...(rpId ? { rpId } : {})
  };
  payloadEl.value = JSON.stringify(payload);
  const res = await sendNativeAwait(payload);
  if (res?.ok && res?.payload && Array.isArray(res.payload.passkeys)) {
    lastPasskeys = res.payload.passkeys;
    renderPasskeys();
    setResult({ ok: true, native: res.payload });
    return;
  }
  setResult(res ?? { ok: false, error: "No response" });
}

async function initListByActiveTabUrl() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentUrl = tabs?.[0]?.url ?? "";
    const rpId = tryDeriveRpIdFromUrl(currentUrl);
    if (rpId) {
      rpIdFilterEl.value = rpId;
    }
    await refreshList();
  } catch (e) {
    setResult({ ok: false, error: `Failed to read active tab URL: ${String(e)}` });
  }
}

connectBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "connect-native" }, (res) => {
    if (chrome.runtime.lastError) {
      setResult({ ok: false, error: chrome.runtime.lastError.message });
      return;
    }
    setResult(res ?? { ok: false, error: "No response" });
  });
});

sendBtn.addEventListener("click", () => {
  let parsed;
  try {
    parsed = JSON.parse(payloadEl.value);
  } catch (e) {
    setResult({ ok: false, error: `Invalid JSON: ${String(e)}` });
    return;
  }

  chrome.runtime.sendMessage({ type: "native-request", payload: parsed }, (res) => {
    if (chrome.runtime.lastError) {
      setResult({ ok: false, error: chrome.runtime.lastError.message });
      return;
    }
    setResult(res ?? { ok: false, error: "No response" });
  });
});

listBtn.addEventListener("click", async () => {
  await refreshList();
});

clearBtn.addEventListener("click", async () => {
  const requestId = `clear-${Date.now()}`;
  const payload = { type: "clear_passkeys", requestId };
  payloadEl.value = JSON.stringify(payload);
  const res = await sendNative(payload);
  setResult(res);
});

addBtn.addEventListener("click", async () => {
  const requestId = `add-${Date.now()}`;
  const payload = {
    type: "add_passkey",
    requestId,
    passkey: {
      id: (pkIdEl.value ?? "").trim() || undefined,
      title: (pkTitleEl.value ?? "").trim() || undefined,
      rpId: (pkRpIdEl.value ?? "").trim() || undefined,
      user: (pkUserEl.value ?? "").trim() || undefined
    }
  };
  payloadEl.value = JSON.stringify(payload);
  const res = await sendNative(payload);
  setResult(res);
});

removeBtn.addEventListener("click", async () => {
  const id = (pkIdEl.value ?? "").trim();
  if (!id) {
    setResult({ ok: false, error: "id is required." });
    return;
  }
  const requestId = `remove-${Date.now()}`;
  const payload = { type: "remove_passkey", requestId, id };
  payloadEl.value = JSON.stringify(payload);
  const res = await sendNative(payload);
  setResult(res);
});

searchEl.addEventListener("input", () => {
  renderPasskeys();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "native-response") {
    const payload = msg.payload;
    if (payload && typeof payload === "object" && Array.isArray(payload.passkeys)) {
      lastPasskeys = payload.passkeys;
      renderPasskeys();
    }
    setResult({ ok: true, native: payload });
  }
  if (msg?.type === "native-error") {
    setResult({ ok: false, error: msg.error });
  }
});

initListByActiveTabUrl();
