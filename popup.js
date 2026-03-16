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
let vaultPasswordCache = {};
let lastVaultPasswordCacheError = "";

globalThis.__TSUPASSWD_POPUP_JS_VERSION = "2026-03-14T21:50+09:00";
try {
  console.log("[tsupasswd] popup.js loaded", globalThis.__TSUPASSWD_POPUP_JS_VERSION);
} catch {}

function selectVaultItem(item) {
  vaultItemIdEl.value = escapeText(item?.itemId);
  vaultTitleEl.value = escapeText(item?.title);
  vaultUsernameEl.value = escapeText(item?.username);
  vaultUrlEl.value = escapeText(item?.url);
  vaultNotesEl.value = escapeText(item?.notes);
  vaultPasswordEl.value = "";
  try {
    const hasPassword = Boolean(String(getCachedVaultPassword(item) || item?.password || "").trim());
    vaultPasswordEl.placeholder = hasPassword ? "(保存済み)" : "";
  } catch {}
}

function setResult(value) {
  if (!resultEl) {
    try {
      console.error("Result element not found", value);
    } catch {}
    return;
  }
  resultEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function escapeText(v) {
  return String(v ?? "");
}

function getCachedVaultPassword(item) {
  const itemId = String(item?.itemId ?? "");
  if (!itemId) return "";
  return String(vaultPasswordCache?.[itemId] ?? "");
}

async function loadVaultPasswordCache() {
  return await new Promise((resolve) => {
    try {
      chrome.storage.local.get(["vaultPasswordCache"], (res) => {
        if (chrome.runtime.lastError) {
          lastVaultPasswordCacheError = String(chrome.runtime.lastError.message ?? chrome.runtime.lastError);
          resolve({});
          return;
        }
        lastVaultPasswordCacheError = "";
        resolve(res?.vaultPasswordCache && typeof res.vaultPasswordCache === "object" ? res.vaultPasswordCache : {});
      });
    } catch {
      lastVaultPasswordCacheError = "exception";
      resolve({});
    }
  });
}

async function setCachedVaultPassword(itemId, password) {
  const id = String(itemId ?? "").trim();
  if (!id) return false;
  const pwd = String(password ?? "");
  if (!pwd) return false;
  vaultPasswordCache = {
    ...(vaultPasswordCache && typeof vaultPasswordCache === "object" ? vaultPasswordCache : {}),
    [id]: pwd
  };
  try {
    return await new Promise((resolve) => {
      chrome.storage.local.set({ vaultPasswordCache }, () => {
        if (chrome.runtime.lastError) {
          lastVaultPasswordCacheError = String(chrome.runtime.lastError.message ?? chrome.runtime.lastError);
          resolve(false);
          return;
        }
        lastVaultPasswordCacheError = "";
        chrome.storage.local.get(["vaultPasswordCache"], (res) => {
          if (chrome.runtime.lastError) {
            lastVaultPasswordCacheError = String(chrome.runtime.lastError.message ?? chrome.runtime.lastError);
            resolve(false);
            return;
          }
          const cache = res?.vaultPasswordCache && typeof res.vaultPasswordCache === "object" ? res.vaultPasswordCache : {};
          const stored = String(cache?.[id] ?? "");
          resolve(Boolean(stored) && stored === pwd);
        });
      });
    });
  } catch {}
  return false;
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

    const tdPassword = document.createElement("td");
    const password = String(getCachedVaultPassword(item) || item?.password || "");
    const masked = password ? "••••••" : "";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = password ? "Copy" : "";
    copyBtn.disabled = !password;
    copyBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!password) return;
      try {
        await navigator.clipboard.writeText(password);
        setResult({ ok: true, action: "vault.password.copy", itemId: item?.itemId ?? "" });
      } catch (err) {
        setResult({ ok: false, action: "vault.password.copy", error: String(err?.message ?? err) });
      }
    });
    tdPassword.textContent = masked;
    if (password) {
      tdPassword.appendChild(document.createTextNode(" "));
      tdPassword.appendChild(copyBtn);
    }
    tr.appendChild(tdPassword);

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

async function readVaultStatus() {
  const payload = buildVaultPayload("vault.status.get", { requestId: `vault-status-${Date.now()}` });
  return await sendNativeAwait(payload, "vault");
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

async function refreshVaultList(options = {}) {
  const suppressResult = options?.suppressResult === true;
  const payload = buildVaultPayload("vault.login.list", {
    includeDeleted: false,
    requestId: `vault-list-${Date.now()}`
  });
  payloadEl.value = JSON.stringify(payload, null, 2);
  const res = await sendNativeAwait(payload, "vault");
  vaultPasswordCache = await loadVaultPasswordCache();
  if (res?.ok && res?.payload && Array.isArray(res.payload.result?.items)) {
    lastVaultItems = res.payload.result.items;
    renderVaultItems();
    if (!(vaultItemIdEl.value ?? "").trim() && lastVaultItems.length === 1) {
      selectVaultItem(lastVaultItems[0]);
    }
    if (!suppressResult) {
      setResult({ ok: true, native: res.payload, cacheKeysCount: Object.keys(vaultPasswordCache ?? {}).length, cacheError: lastVaultPasswordCacheError });
    }
    return;
  }
  if (res?.ok && Array.isArray(res?.raw?.result?.items)) {
    lastVaultItems = res.raw.result.items;
    renderVaultItems();
    if (!(vaultItemIdEl.value ?? "").trim() && lastVaultItems.length === 1) {
      selectVaultItem(lastVaultItems[0]);
    }
    if (!suppressResult) {
      setResult({ ok: true, native: res.raw, cacheKeysCount: Object.keys(vaultPasswordCache ?? {}).length, cacheError: lastVaultPasswordCacheError });
    }
    return;
  }
  if (!suppressResult) {
    setResult(res ?? { ok: false, error: "No response" });
  }
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

try {
  if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
      setResult(await sendMessage({ type: "connect-native", target: "passkey" }));
    });
  }

  if (connectVaultBtn) {
    connectVaultBtn.addEventListener("click", async () => {
      setResult(await sendMessage({ type: "vault-connect" }));
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", async () => {
      let parsed;
      try {
        parsed = JSON.parse(payloadEl?.value ?? "");
      } catch (e) {
        setResult({ ok: false, error: `Invalid JSON: ${String(e)}` });
        return;
      }

      const target = parsed?.command?.startsWith("vault.") ? "vault" : "passkey";
      setResult(await sendNative(parsed, target));
    });
  }

  if (listBtn) {
    listBtn.addEventListener("click", async () => {
      await refreshList();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      const requestId = `clear-${Date.now()}`;
      const payload = { type: "clear_passkeys", requestId };
      if (payloadEl) {
        payloadEl.value = JSON.stringify(payload);
      }
      setResult(await sendNative(payload, "passkey"));
    });
  }

  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      const requestId = `add-${Date.now()}`;
      const payload = {
        type: "add_passkey",
        requestId,
        passkey: {
          id: (pkIdEl?.value ?? "").trim() || undefined,
          title: (pkTitleEl?.value ?? "").trim() || undefined,
          rpId: (pkRpIdEl?.value ?? "").trim() || undefined,
          user: (pkUserEl?.value ?? "").trim() || undefined
        }
      };
      if (payloadEl) {
        payloadEl.value = JSON.stringify(payload);
      }
      setResult(await sendNative(payload, "passkey"));
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener("click", async () => {
      const id = (pkIdEl?.value ?? "").trim();
      if (!id) {
        setResult({ ok: false, error: "id is required." });
        return;
      }
      const requestId = `remove-${Date.now()}`;
      const payload = { type: "remove_passkey", requestId, id };
      if (payloadEl) {
        payloadEl.value = JSON.stringify(payload);
      }
      setResult(await sendNative(payload, "passkey"));
    });
  }

  if (vaultStatusBtn) {
    vaultStatusBtn.addEventListener("click", async () => {
      const payload = buildVaultPayload("vault.status.get", { requestId: `vault-status-${Date.now()}` });
      if (payloadEl) {
        payloadEl.value = JSON.stringify(payload, null, 2);
      }
      const res = await sendNativeAwait(payload, "vault");
      setResult(res?.raw ?? res);
    });
  }

  if (vaultListBtn) {
    vaultListBtn.addEventListener("click", async () => {
      await refreshVaultList();
    });
  }

  if (vaultResyncBtn) {
    vaultResyncBtn.addEventListener("click", async () => {
      let payload = buildVaultPayload("vault.sync.resync", { requestId: `vault-resync-${Date.now()}` });
      if (payloadEl) {
        const text = (payloadEl.value ?? "").trim();
        if (text) {
          try {
            const edited = JSON.parse(text);
            if (edited && typeof edited === "object") {
              if (edited.command === "vault.sync.resync") {
                payload = {
                  ...payload,
                  ...edited,
                  payload: {
                    ...(payload.payload ?? {}),
                    ...(edited.payload ?? {})
                  }
                };
              } else {
                payload = {
                  ...payload,
                  payload: {
                    ...(payload.payload ?? {}),
                    ...(edited.payload ?? {}),
                    ...edited
                  }
                };
              }
            }
          } catch {
          }
        }
        payloadEl.value = JSON.stringify(payload, null, 2);
      }
      setResult({ ok: true, state: "running", command: payload.command, id: payload.id });
      try {
        const res = await sendNativeAwait(payload, "vault");
        setResult(res?.raw ?? res ?? { ok: false, error: "No response" });
        if (res?.ok) {
          await refreshVaultList({ suppressResult: true });
        }
      } catch (e) {
        setResult({ ok: false, error: String(e?.message ?? e) });
      }
    });
  }

  if (vaultSaveBtn) {
    vaultSaveBtn.addEventListener("click", async () => {
      const password = (vaultPasswordEl?.value ?? "").trim();
      if (!password) {
        setResult({ ok: false, error: "password is required." });
        return;
      }
      const inputTitle = (vaultTitleEl?.value ?? "").trim();
      const inputUsername = (vaultUsernameEl?.value ?? "").trim();
      const inputUrl = (vaultUrlEl?.value ?? "").trim();
      const payload = buildVaultPayload("vault.login.save", {
        title: inputTitle,
        username: inputUsername,
        password,
        url: inputUrl,
        notes: (vaultNotesEl?.value ?? "").trim(),
        resync: false,
        requestId: `vault-save-${Date.now()}`
      });
      if (payloadEl) {
        payloadEl.value = JSON.stringify(payload, null, 2);
      }
      const res = await sendNativeAwait(payload, "vault");
      const status = await readVaultStatus();
      const nativeOk = Boolean(res?.raw?.ok ?? res?.payload?.ok);
      if (res?.ok && nativeOk && vaultPasswordEl) {
        let savedId = "";
        try {
          savedId =
            res?.raw?.result?.itemId ??
            res?.payload?.result?.itemId ??
            res?.raw?.itemId ??
            res?.payload?.itemId ??
            "";
        } catch {}
        if (!String(savedId).trim()) {
          setResult({ ok: false, action: "vault.login.save", error: "missing_itemId", native: res?.raw ?? res });
          return;
        }
        const cacheSaved = await setCachedVaultPassword(savedId, password);
        if (!cacheSaved) {
          setResult({ ok: false, action: "vault.password.cache", error: "Failed to persist cache", itemId: savedId });
          return;
        }
        vaultPasswordEl.value = "";
        await refreshVaultList({ suppressResult: true });
        const match = lastVaultItems.find((item) => {
          const t = String(item?.title ?? "").trim();
          const u = String(item?.username ?? "").trim();
          const url = String(item?.url ?? "").trim();
          return (inputTitle ? t === inputTitle : true) && (inputUsername ? u === inputUsername : true) && (inputUrl ? url === inputUrl : true);
        });
        const hasPassword = Boolean(String(getCachedVaultPassword(match) || match?.password || "").trim());
        setResult({
          ok: Boolean(res?.ok && nativeOk),
          action: "vault.login.save",
          savedId,
          cacheSaved: true,
          storedItemId: match?.itemId ?? "",
          savedPassword: hasPassword,
          cachedItemId: match?.itemId ?? "",
          storePath: status?.payload?.result?.storePath ?? status?.raw?.result?.storePath ?? "",
          status: status?.raw ?? status?.payload ?? status,
          native: res?.raw ?? res
        });
      } else {
        setResult({
          ok: Boolean(res?.ok && nativeOk),
          action: "vault.login.save",
          error: !nativeOk ? "native_error" : undefined,
          storePath: status?.payload?.result?.storePath ?? status?.raw?.result?.storePath ?? "",
          status: status?.raw ?? status?.payload ?? status,
          native: res?.raw ?? res
        });
      }
    });
  }

  if (vaultUpdateBtn) {
    vaultUpdateBtn.addEventListener("click", async () => {
      const itemId = (vaultItemIdEl?.value ?? "").trim();
      if (!itemId) {
        setResult({ ok: false, error: "itemId is required." });
        return;
      }
      const password = (vaultPasswordEl?.value ?? "").trim();
      if (!password) {
        setResult({ ok: false, error: "password is required." });
        return;
      }
      const inputTitle = (vaultTitleEl?.value ?? "").trim();
      const inputUsername = (vaultUsernameEl?.value ?? "").trim();
      const inputUrl = (vaultUrlEl?.value ?? "").trim();
      const payload = buildVaultPayload("vault.login.update", {
        itemId,
        title: inputTitle,
        username: inputUsername,
        password,
        url: inputUrl,
        notes: (vaultNotesEl?.value ?? "").trim(),
        resync: false,
        requestId: `vault-update-${Date.now()}`
      });
      if (payloadEl) {
        payloadEl.value = JSON.stringify(payload, null, 2);
      }
      const res = await sendNativeAwait(payload, "vault");
      const status = await readVaultStatus();
      const nativeOk = Boolean(res?.raw?.ok ?? res?.payload?.ok);
      if (res?.ok && nativeOk && vaultPasswordEl) {
        let savedId = itemId;
        try {
          savedId =
            res?.raw?.result?.itemId ??
            res?.payload?.result?.itemId ??
            res?.raw?.itemId ??
            res?.payload?.itemId ??
            itemId;
        } catch {}
        if (!String(savedId).trim()) {
          setResult({ ok: false, action: "vault.login.update", error: "missing_itemId", native: res?.raw ?? res });
          return;
        }
        const cacheSaved = await setCachedVaultPassword(savedId, password);
        if (!cacheSaved) {
          setResult({ ok: false, action: "vault.password.cache", error: "Failed to persist cache", itemId: savedId });
          return;
        }
        vaultPasswordEl.value = "";
        await refreshVaultList({ suppressResult: true });
        const match = lastVaultItems.find((item) => String(item?.itemId ?? "") === itemId);
        const hasPassword = Boolean(String(getCachedVaultPassword(match) || match?.password || "").trim());
        setResult({
          ok: Boolean(res?.ok && nativeOk),
          action: "vault.login.update",
          savedId,
          cacheSaved: true,
          itemId,
          savedPassword: hasPassword,
          cachedItemId: itemId,
          storePath: status?.payload?.result?.storePath ?? status?.raw?.result?.storePath ?? "",
          status: status?.raw ?? status?.payload ?? status,
          native: res?.raw ?? res
        });
      } else {
        setResult({
          ok: Boolean(res?.ok && nativeOk),
          action: "vault.login.update",
          itemId,
          error: !nativeOk ? "native_error" : undefined,
          storePath: status?.payload?.result?.storePath ?? status?.raw?.result?.storePath ?? "",
          status: status?.raw ?? status?.payload ?? status,
          native: res?.raw ?? res
        });
      }
    });
  }

  if (vaultDeleteBtn) {
    vaultDeleteBtn.addEventListener("click", async () => {
      const itemId = (vaultItemIdEl?.value ?? "").trim();
      if (!itemId) {
        setResult({ ok: false, error: "itemId is required." });
        return;
      }
      const payload = buildVaultPayload("vault.login.delete", {
        itemId,
        resync: true,
        requestId: `vault-delete-${Date.now()}`
      });
      if (payloadEl) {
        payloadEl.value = JSON.stringify(payload, null, 2);
      }
      const res = await sendNativeAwait(payload, "vault");
      setResult(res?.raw ?? res);
      if (res?.ok) {
        await refreshVaultList();
      }
    });
  }

  if (searchEl) {
    searchEl.addEventListener("input", () => {
      renderPasskeys();
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "native-response") {
      const payload = msg.payload;
      if (msg?.target === "passkey" && payload && typeof payload === "object" && Array.isArray(payload.passkeys)) {
        lastPasskeys = payload.passkeys;
        renderPasskeys();
      }
      if (msg?.target === "vault" && payload && typeof payload === "object" && Array.isArray(payload.result?.items)) {
        lastVaultItems = payload.result.items;
        renderVaultItems();
      }
    }
    if (msg?.type === "native-error") {
      setResult({ ok: false, target: msg?.target, error: msg.error });
    }
  });

  initListByActiveTabUrl();
} catch (e) {
  setResult({ ok: false, error: String(e?.message ?? e) });
}
