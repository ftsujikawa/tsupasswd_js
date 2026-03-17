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
const syncStatusBtn = document.getElementById("syncStatus");
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
const vaultUndeleteBtn = document.getElementById("vaultUndelete");
const vaultIncludeDeletedEl = document.getElementById("vaultIncludeDeleted");
const vaultAutoFetchSecretEl = document.getElementById("vaultAutoFetchSecret");
const sendPayloadBtn = document.getElementById("sendPayload");
const vaultPushBtn = document.getElementById("vaultPush");

const UI_PREFS_STORAGE_KEY = "tsupasswdPopupPrefs";

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

function tryParseJson(text) {
  try {
    return JSON.parse(String(text ?? ""));
  } catch {
    return null;
  }
}

function extractSyncConfigFromPayloadJson() {
  const edited = tryParseJson(payloadEl?.value ?? "");
  const src = edited && typeof edited === "object" ? edited : {};
  const p = src?.payload && typeof src.payload === "object" ? src.payload : {};
  const email = String(p?.email ?? src?.email ?? "").trim();
  const baseUrl = String(p?.baseUrl ?? src?.baseUrl ?? "").trim();
  return { email, baseUrl };
}

async function persistSyncConfigToBackground({ email, baseUrl, enabled = true, periodMinutes = 1 } = {}) {
  const e = String(email ?? "").trim();
  const b = String(baseUrl ?? "").trim();
  if (!e || !b) return;
  try {
    await chrome.runtime.sendMessage({
      type: "sync-config-set",
      payload: {
        email: e,
        baseUrl: b,
        enabled: Boolean(enabled),
        periodMinutes: Number(periodMinutes)
      }
    });
  } catch {}
}

function escapeText(v) {
  return String(v ?? "");
}

function getCachedVaultPassword(item) {
  const itemId = String(item?.itemId ?? "");
  if (!itemId) return "";
  return String(vaultPasswordCache?.[itemId] ?? "");
}

async function fetchVaultPasswordIntoCache(itemId) {
  const id = String(itemId ?? "").trim();
  if (!id) return { ok: false, error: "itemId is required" };
  const payload = buildVaultPayload("vault.login.get", {
    itemId: id,
    includeSecret: true,
    requestId: `vault-get-${Date.now()}`,
  });
  const res = await sendNativeAwait(payload, "vault");
  const password = String(res?.payload?.result?.password ?? res?.raw?.result?.password ?? "");
  if (!password.trim()) {
    return { ok: false, error: "empty_password", res: res?.raw ?? res };
  }
  const saved = await setCachedVaultPassword(id, password);
  return { ok: Boolean(saved), itemId: id };
}

async function prefetchVaultSecrets(items) {
  if (!vaultAutoFetchSecretEl?.checked) return;
  if (!Array.isArray(items) || items.length === 0) return;
  const limit = 20;
  let count = 0;
  for (const item of items) {
    if (count >= limit) break;
    const itemId = String(item?.itemId ?? "").trim();
    if (!itemId) continue;
    const cached = String(getCachedVaultPassword(item) || "").trim();
    const embedded = String(item?.password ?? "").trim();
    if (cached || embedded) continue;
    const fetched = await fetchVaultPasswordIntoCache(itemId);
    if (fetched?.ok) {
      count += 1;
    }
  }
  if (count > 0) {
    vaultPasswordCache = await loadVaultPasswordCache();
    renderVaultItems();
  }
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

async function loadUiPrefs() {
  try {
    const res = await chrome.storage.local.get([UI_PREFS_STORAGE_KEY]);
    const prefs = res?.[UI_PREFS_STORAGE_KEY];
    return prefs && typeof prefs === "object" ? prefs : {};
  } catch {
    return {};
  }
}

async function saveUiPrefs(patch) {
  try {
    const current = await loadUiPrefs();
    const next = {
      ...(current && typeof current === "object" ? current : {}),
      ...(patch && typeof patch === "object" ? patch : {})
    };
    await chrome.storage.local.set({ [UI_PREFS_STORAGE_KEY]: next });
  } catch {}
}

async function initUiPrefs() {
  const prefs = await loadUiPrefs();
  try {
    if (vaultIncludeDeletedEl) {
      vaultIncludeDeletedEl.checked = Boolean(prefs?.vaultIncludeDeleted);
      vaultIncludeDeletedEl.addEventListener("change", () => {
        saveUiPrefs({ vaultIncludeDeleted: Boolean(vaultIncludeDeletedEl.checked) });
      });
    }
    if (vaultAutoFetchSecretEl) {
      vaultAutoFetchSecretEl.checked = Boolean(prefs?.vaultAutoFetchSecret);
      vaultAutoFetchSecretEl.addEventListener("change", () => {
        saveUiPrefs({ vaultAutoFetchSecret: Boolean(vaultAutoFetchSecretEl.checked) });
      });
    }
  } catch {}
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
    copyBtn.textContent = password ? "Copy" : "Get";
    copyBtn.disabled = false;
    copyBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      let current = String(getCachedVaultPassword(item) || item?.password || "");
      if (!current.trim()) {
        try {
          setResult({ ok: true, state: "running", action: "vault.login.get", itemId: item?.itemId ?? "" });
          const fetched = await fetchVaultPasswordIntoCache(item?.itemId ?? "");
          if (!fetched?.ok) {
            setResult({ ok: false, action: "vault.login.get", itemId: item?.itemId ?? "", fetched });
            return;
          }
          vaultPasswordCache = await loadVaultPasswordCache();
          current = String(getCachedVaultPassword(item) || "");
          await refreshVaultList({ suppressResult: true });
        } catch (err) {
          setResult({ ok: false, action: "vault.login.get", error: String(err?.message ?? err) });
          return;
        }
      }
      if (!current.trim()) return;
      try {
        await navigator.clipboard.writeText(current);
        setResult({ ok: true, action: "vault.password.copy", itemId: item?.itemId ?? "" });
      } catch (err) {
        setResult({ ok: false, action: "vault.password.copy", error: String(err?.message ?? err) });
      }
    });
    tdPassword.textContent = masked;
    tdPassword.appendChild(document.createTextNode(masked ? " " : ""));
    tdPassword.appendChild(copyBtn);
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
  const includeDeleted = Boolean(vaultIncludeDeletedEl?.checked);
  const payload = buildVaultPayload("vault.login.list", {
    includeDeleted,
    requestId: `vault-list-${Date.now()}`
  });
  payloadEl.value = JSON.stringify(payload, null, 2);
  const res = await sendNativeAwait(payload, "vault");
  vaultPasswordCache = await loadVaultPasswordCache();
  if (res?.ok && res?.payload && Array.isArray(res.payload.result?.items)) {
    lastVaultItems = res.payload.result.items;
    renderVaultItems();
    await prefetchVaultSecrets(lastVaultItems);
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
    await prefetchVaultSecrets(lastVaultItems);
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

  if (vaultStatusBtn) {
    vaultStatusBtn.addEventListener("click", async () => {
      setResult({ ok: true, state: "running", command: "vault.status.get" });
      try {
        const res = await readVaultStatus();
        setResult(res?.raw ?? res ?? { ok: false, error: "No response" });
      } catch (e) {
        setResult({ ok: false, command: "vault.status.get", error: String(e?.message ?? e) });
      }
    });
  }

  if (vaultListBtn) {
    vaultListBtn.addEventListener("click", async () => {
      setResult({ ok: true, state: "running", command: "vault.login.list" });
      try {
        await refreshVaultList();
      } catch (e) {
        setResult({ ok: false, command: "vault.login.list", error: String(e?.message ?? e) });
      }
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
              const editedPayload = edited?.payload && typeof edited.payload === "object" ? edited.payload : null;
              if (edited.command === "vault.sync.resync") {
                payload = {
                  ...payload,
                  ...edited,
                  payload: {
                    ...(payload.payload ?? {}),
                    ...(editedPayload ?? {})
                  }
                };
              } else if (editedPayload) {
                payload = {
                  ...payload,
                  payload: {
                    ...(payload.payload ?? {}),
                    ...editedPayload
                  }
                };
              }
            }
          } catch {}
        }
      }

      try {
        await persistSyncConfigToBackground({ email: payload?.payload?.email, baseUrl: payload?.payload?.baseUrl });
      } catch {}

      if (payloadEl) {
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
        setResult({ ok: false, command: payload.command, error: String(e?.message ?? e) });
      }
    });
  }

  if (syncStatusBtn) {
    syncStatusBtn.addEventListener("click", async () => {
      setResult({ ok: true, state: "running", command: "sync-status-get" });
      try {
        const res = await sendMessage({ type: "sync-status-get" });
        setResult(res ?? { ok: false, error: "No response" });
      } catch (e) {
        setResult({ ok: false, error: String(e?.message ?? e) });
      }
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

  if (sendPayloadBtn) {
    sendPayloadBtn.addEventListener("click", async () => {
      const parsed = tryParseJson(payloadEl?.value ?? "");
      if (!parsed || typeof parsed !== "object") {
        setResult({ ok: false, error: "Invalid JSON" });
        return;
      }
      const target = parsed?.command?.startsWith("vault.") ? "vault" : "passkey";
      setResult({ ok: true, state: "running", command: parsed?.command ?? parsed?.type ?? "" });
      try {
        if (target === "vault" && (parsed?.command === "vault.sync.push" || parsed?.command === "vault.sync.resync")) {
          const p = parsed?.payload && typeof parsed.payload === "object" ? parsed.payload : {};
          await persistSyncConfigToBackground({ email: p?.email, baseUrl: p?.baseUrl });
        }
        const res = await sendNativeAwait(parsed, target);
        setResult(res?.raw ?? res ?? { ok: false, error: "No response" });
        if (target === "vault" && (parsed?.command === "vault.sync.push" || parsed?.command === "vault.sync.resync")) {
          await refreshVaultList({ suppressResult: true });
        }
      } catch (e) {
        setResult({ ok: false, error: String(e?.message ?? e) });
      }
    });
  }

  if (vaultPushBtn) {
    vaultPushBtn.addEventListener("click", async () => {
      const { email, baseUrl } = extractSyncConfigFromPayloadJson();
      await persistSyncConfigToBackground({ email, baseUrl });
      const payload = buildVaultPayload("vault.sync.push", {
        ...(email ? { email } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        requestId: `vault-push-${Date.now()}`
      });
      if (payloadEl) {
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
        resync: true,
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
        resync: true,
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

  if (vaultUndeleteBtn) {
    vaultUndeleteBtn.addEventListener("click", async () => {
      const itemId = (vaultItemIdEl?.value ?? "").trim();
      if (!itemId) {
        setResult({ ok: false, error: "itemId is required." });
        return;
      }
      const payload = buildVaultPayload("vault.login.undelete", {
        itemId,
        resync: true,
        requestId: `vault-undelete-${Date.now()}`
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

  initUiPrefs();
  initListByActiveTabUrl();
} catch (e) {
  setResult({ ok: false, error: String(e?.message ?? e) });
}
