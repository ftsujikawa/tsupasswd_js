const connectBtn = document.getElementById("connect");
const connectVaultBtn = document.getElementById("connectVault");
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
const vaultStatusBtn = document.getElementById("vaultStatus");
const vaultListBtn = document.getElementById("vaultList");
const vaultResyncBtn = document.getElementById("vaultResync");
const vaultRowsEl = document.getElementById("vaultRows");
const vaultTitleEl = document.getElementById("vaultTitle");
const vaultUsernameEl = document.getElementById("vaultUsername");
const vaultUrlEl = document.getElementById("vaultUrl");
const vaultItemIdEl = document.getElementById("vaultItemId");
const vaultPasswordEl = document.getElementById("vaultPassword");
const vaultNotesEl = document.getElementById("vaultNotes");
const vaultSaveBtn = document.getElementById("vaultSave");
const vaultUpdateBtn = document.getElementById("vaultUpdate");
const vaultDeleteBtn = document.getElementById("vaultDelete");

let lastPasskeys = [];
let lastVaultItems = [];

function selectVaultItem(item) {
  vaultItemIdEl.value = escapeText(item?.itemId);
  vaultTitleEl.value = escapeText(item?.title);
  vaultUsernameEl.value = escapeText(item?.username);
  vaultUrlEl.value = escapeText(item?.url);
  vaultNotesEl.value = escapeText(item?.notes);
  vaultPasswordEl.value = "";
}

function setResult(value) {
  resultEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function escapeText(v) {
  return String(v ?? "");
}

function tryDeriveRpIdFromUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "";
    }
    return (url.hostname ?? "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res ?? { ok: false, error: "No response" });
    });
  });
}

function sendNative(payload, target = "passkey") {
  return sendMessage({ type: target === "vault" ? "vault-request" : "native-request", payload, target });
}

function sendNativeAwait(payload, target = "passkey") {
  return sendMessage({ type: target === "vault" ? "vault-request-await" : "native-request-await", payload, target });
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

function renderVaultItems() {
  vaultRowsEl.textContent = "";
  for (const item of lastVaultItems) {
    const tr = document.createElement("tr");

    const tdTitle = document.createElement("td");
    tdTitle.textContent = escapeText(item?.title);
    tr.appendChild(tdTitle);

    const tdUsername = document.createElement("td");
    tdUsername.textContent = escapeText(item?.username);
    tr.appendChild(tdUsername);

    const tdUrl = document.createElement("td");
    tdUrl.textContent = escapeText(item?.url);
    tr.appendChild(tdUrl);

    const tdId = document.createElement("td");
    tdId.textContent = escapeText(item?.itemId);
    tr.appendChild(tdId);

    tr.addEventListener("click", () => {
      selectVaultItem(item);
    });

    vaultRowsEl.appendChild(tr);
  }
}

function buildVaultPayload(command, payload = {}) {
  return {
    id: payload?.requestId ?? `${command}-${Date.now()}`,
    version: 1,
    command,
    payload
  };
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
  const res = await sendNativeAwait(payload, "passkey");
  if (res?.ok && res?.payload && Array.isArray(res.payload.passkeys)) {
    lastPasskeys = res.payload.passkeys;
    renderPasskeys();
    setResult({ ok: true, native: res.payload });
    return;
  }
  setResult(res ?? { ok: false, error: "No response" });
}

async function refreshVaultList() {
  const payload = buildVaultPayload("vault.login.list", {
    includeDeleted: false,
    requestId: `vault-list-${Date.now()}`
  });
  payloadEl.value = JSON.stringify(payload, null, 2);
  const res = await sendNativeAwait(payload, "vault");
  if (res?.ok && res?.payload && Array.isArray(res.payload.result?.items)) {
    lastVaultItems = res.payload.result.items;
    renderVaultItems();
    if (!(vaultItemIdEl.value ?? "").trim() && lastVaultItems.length === 1) {
      selectVaultItem(lastVaultItems[0]);
    }
    setResult({ ok: true, native: res.payload });
    return;
  }
  if (res?.ok && Array.isArray(res?.raw?.result?.items)) {
    lastVaultItems = res.raw.result.items;
    renderVaultItems();
    if (!(vaultItemIdEl.value ?? "").trim() && lastVaultItems.length === 1) {
      selectVaultItem(lastVaultItems[0]);
    }
    setResult({ ok: true, native: res.raw });
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
      vaultUrlEl.value = `https://${rpId}`;
      pkRpIdEl.value = rpId;
    }
    await refreshList();
    await refreshVaultList();
  } catch (e) {
    setResult({ ok: false, error: `Failed to read active tab URL: ${String(e)}` });
  }
}

connectBtn.addEventListener("click", async () => {
  setResult(await sendMessage({ type: "connect-native", target: "passkey" }));
});

connectVaultBtn.addEventListener("click", async () => {
  setResult(await sendMessage({ type: "vault-connect" }));
});

sendBtn.addEventListener("click", async () => {
  let parsed;
  try {
    parsed = JSON.parse(payloadEl.value);
  } catch (e) {
    setResult({ ok: false, error: `Invalid JSON: ${String(e)}` });
    return;
  }

  const target = parsed?.command?.startsWith("vault.") ? "vault" : "passkey";
  setResult(await sendNative(parsed, target));
});

listBtn.addEventListener("click", async () => {
  await refreshList();
});

clearBtn.addEventListener("click", async () => {
  const requestId = `clear-${Date.now()}`;
  const payload = { type: "clear_passkeys", requestId };
  payloadEl.value = JSON.stringify(payload);
  setResult(await sendNative(payload, "passkey"));
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
  setResult(await sendNative(payload, "passkey"));
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
  setResult(await sendNative(payload, "passkey"));
});

vaultStatusBtn.addEventListener("click", async () => {
  const payload = buildVaultPayload("vault.status.get", { requestId: `vault-status-${Date.now()}` });
  payloadEl.value = JSON.stringify(payload, null, 2);
  const res = await sendNativeAwait(payload, "vault");
  setResult(res?.raw ?? res);
});

vaultListBtn.addEventListener("click", async () => {
  await refreshVaultList();
});

vaultResyncBtn.addEventListener("click", async () => {
  const payload = buildVaultPayload("vault.sync.resync", { requestId: `vault-resync-${Date.now()}` });
  payloadEl.value = JSON.stringify(payload, null, 2);
  const res = await sendNativeAwait(payload, "vault");
  setResult(res?.raw ?? res);
  if (res?.ok) {
    await refreshVaultList();
  }
});

vaultSaveBtn.addEventListener("click", async () => {
  const payload = buildVaultPayload("vault.login.save", {
    title: (vaultTitleEl.value ?? "").trim(),
    username: (vaultUsernameEl.value ?? "").trim(),
    password: (vaultPasswordEl.value ?? "").trim(),
    url: (vaultUrlEl.value ?? "").trim(),
    notes: (vaultNotesEl.value ?? "").trim(),
    resync: true,
    requestId: `vault-save-${Date.now()}`
  });
  payloadEl.value = JSON.stringify(payload, null, 2);
  const res = await sendNativeAwait(payload, "vault");
  setResult(res?.raw ?? res);
  if (res?.ok) {
    vaultPasswordEl.value = "";
    await refreshVaultList();
  }
});

vaultUpdateBtn.addEventListener("click", async () => {
  const itemId = (vaultItemIdEl.value ?? "").trim();
  if (!itemId) {
    setResult({ ok: false, error: "itemId is required." });
    return;
  }
  const payload = buildVaultPayload("vault.login.update", {
    itemId,
    title: (vaultTitleEl.value ?? "").trim(),
    username: (vaultUsernameEl.value ?? "").trim(),
    password: (vaultPasswordEl.value ?? "").trim(),
    url: (vaultUrlEl.value ?? "").trim(),
    notes: (vaultNotesEl.value ?? "").trim(),
    resync: true,
    requestId: `vault-update-${Date.now()}`
  });
  payloadEl.value = JSON.stringify(payload, null, 2);
  const res = await sendNativeAwait(payload, "vault");
  setResult(res?.raw ?? res);
  if (res?.ok) {
    vaultPasswordEl.value = "";
    await refreshVaultList();
  }
});

vaultDeleteBtn.addEventListener("click", async () => {
  const itemId = (vaultItemIdEl.value ?? "").trim();
  if (!itemId) {
    setResult({ ok: false, error: "itemId is required." });
    return;
  }
  const payload = buildVaultPayload("vault.login.delete", {
    itemId,
    resync: true,
    requestId: `vault-delete-${Date.now()}`
  });
  payloadEl.value = JSON.stringify(payload, null, 2);
  const res = await sendNativeAwait(payload, "vault");
  setResult(res?.raw ?? res);
  if (res?.ok) {
    await refreshVaultList();
  }
});

searchEl.addEventListener("input", () => {
  renderPasskeys();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "native-response") {
    const payload = msg.payload;
    if (msg?.target === "passkey" && payload && typeof payload === "object" && Array.isArray(payload.passkeys)) {
      lastPasskeys = payload.passkeys;
      renderPasskeys();
    }
    setResult({ ok: true, target: msg?.target, native: payload });
  }
  if (msg?.type === "native-error") {
    setResult({ ok: false, target: msg?.target, error: msg.error });
  }
});

initListByActiveTabUrl();
