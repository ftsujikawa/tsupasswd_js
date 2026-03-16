const PASSKEY_HOST_NAME = "com.tsupasswd.bridge";
const VAULT_HOST_NAME = "dev.happyfactory.tsupasswd_core";

const ports = new Map();

const NATIVE_DEBUG_DEFAULT = false;

const AUTO_SYNC_ALARM_NAME = "tsupasswd-auto-resync";
const AUTO_SYNC_STORAGE_KEY = "tsupasswdSyncConfig";
const AUTO_SYNC_DEFAULT_PERIOD_MINUTES = 1;

async function getStoredSyncConfig() {
  try {
    const res = await chrome.storage.local.get(AUTO_SYNC_STORAGE_KEY);
    const cfg = res?.[AUTO_SYNC_STORAGE_KEY];
    if (!cfg || typeof cfg !== "object") return null;
    const email = String(cfg?.email ?? "").trim();
    const baseUrl = String(cfg?.baseUrl ?? "").trim();
    const enabled = cfg?.enabled === undefined ? true : Boolean(cfg?.enabled);
    const periodMinutesRaw = Number(cfg?.periodMinutes ?? AUTO_SYNC_DEFAULT_PERIOD_MINUTES);
    const periodMinutes = Number.isFinite(periodMinutesRaw) ? Math.max(1, Math.floor(periodMinutesRaw)) : AUTO_SYNC_DEFAULT_PERIOD_MINUTES;
    if (!email || !baseUrl) return { email, baseUrl, enabled, periodMinutes };
    return { email, baseUrl, enabled, periodMinutes };
  } catch {
    return null;
  }
}

async function ensureAutoResyncAlarm() {
  const cfg = await getStoredSyncConfig();
  if (!cfg || !cfg.enabled) {
    try {
      await chrome.alarms.clear(AUTO_SYNC_ALARM_NAME);
    } catch {}
    return;
  }
  try {
    chrome.alarms.create(AUTO_SYNC_ALARM_NAME, {
      periodInMinutes: cfg.periodMinutes ?? AUTO_SYNC_DEFAULT_PERIOD_MINUTES
    });
  } catch {}
}

async function runAutoResync(reason = "alarm") {
  const cfg = await getStoredSyncConfig();
  if (!cfg || !cfg.enabled) return;
  const email = String(cfg.email ?? "").trim();
  const baseUrl = String(cfg.baseUrl ?? "").trim();
  if (!email || !baseUrl) return;
  try {
    const payload = buildVaultRequest("vault.sync.resync", {
      email,
      baseUrl,
      requestId: `auto-resync-${Date.now()}`,
      reason
    });
    const p = ensurePort("vault");
    debugNativeLog("auto-resync:postMessage", { reason, email, baseUrl, payload });
    p.postMessage(payload);
  } catch (e) {
    debugNativeLog("auto-resync:error", { error: String(e) });
  }
}

function debugNativeLog(event, detail = {}) {
  const enabled =
    Boolean(globalThis?.__TSUPASSWD_NATIVE_DEBUG) ||
    (NATIVE_DEBUG_DEFAULT && globalThis?.__TSUPASSWD_NATIVE_DEBUG !== false);
  if (!enabled) return;
  try {
    console.log("[native-debug]", event, detail);
  } catch {}
}

function safeRuntimeSendMessage(message) {
  try {
    const maybePromise = chrome.runtime.sendMessage(message);
    if (maybePromise && typeof maybePromise.then === "function") {
      maybePromise.catch(() => {});
    }
  } catch {}
}

function getHostName(target) {
  return target === "vault" ? VAULT_HOST_NAME : PASSKEY_HOST_NAME;
}

function ensurePort(target = "passkey") {
  const existing = ports.get(target);
  if (existing) {
    debugNativeLog("reuse-port", { target, hostName: getHostName(target) });
    return existing;
  }

  const hostName = getHostName(target);
  debugNativeLog("connect-native:start", { target, hostName });
  const port = chrome.runtime.connectNative(hostName);

  port.onMessage.addListener((msg) => {
    debugNativeLog("connect-native:message", {
      target,
      hostName,
      type: msg?.type,
      requestId: msg?.requestId ?? msg?.id,
      ok: msg?.ok,
      error: msg?.error,
      detail: msg?.detail
    });
    safeRuntimeSendMessage({ type: "native-response", target, payload: msg });
  });

  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message ?? "Native host disconnected.";
    debugNativeLog("connect-native:disconnect", { target, hostName, error: err });
    safeRuntimeSendMessage({ type: "native-error", target, error: err });
    ports.delete(target);
  });

  ports.set(target, port);
  debugNativeLog("connect-native:ready", { target, hostName });
  return port;
}

function deriveRpId(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl ?? ""));
    return String(parsed.hostname ?? "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function normalizeVaultItemToPasskey(item) {
  return {
    id: item?.itemId ?? "",
    title: item?.title ?? "",
    rpId: deriveRpId(item?.url),
    user: item?.username ?? "",
    password: item?.password ?? "",
    source: "tsupasswd_core",
    backedUp: false,
    removable: true,
    vault: true,
    notes: item?.notes ?? "",
    url: item?.url ?? "",
    updatedAt: item?.updatedAt ?? "",
    createdAt: item?.createdAt ?? ""
  };
}

function buildVaultRequest(command, payload = {}) {
  return {
    id: payload?.requestId ?? `${command}-${Date.now()}`,
    version: 1,
    command,
    payload
  };
}

function isVaultCompatRequest(message) {
  return message?.target === "vault" || ["vault-request", "vault-request-await", "vault-connect"].includes(message?.type);
}

function handleVaultCompat(payload) {
  if (payload?.command) {
    return payload;
  }

  const type = payload?.type;
  if (type === "list_passkeys") {
    return buildVaultRequest("vault.login.list", {
      includeDeleted: false,
      requestId: payload?.requestId
    });
  }
  if (type === "add_passkey") {
    const passkey = payload?.passkey ?? {};
    return buildVaultRequest("vault.login.save", {
      title: passkey?.title ?? "",
      username: passkey?.user ?? "",
      password: passkey?.password ?? "",
      url: passkey?.rpId ? `https://${passkey.rpId}` : "",
      notes: "",
      resync: true,
      requestId: payload?.requestId
    });
  }
  if (type === "remove_passkey") {
    const itemId = String(payload?.id ?? "").trim();
    if (!itemId) {
      return {
        ok: false,
        error: "invalid_argument",
        detail: "itemId is required for remove_passkey.",
        type: "remove_passkey",
        requestId: payload?.requestId
      };
    }
    return buildVaultRequest("vault.login.delete", {
      itemId,
      resync: true,
      requestId: payload?.requestId
    });
  }
  if (type === "clear_passkeys") {
    return buildVaultRequest("vault.login.list", {
      includeDeleted: false,
      requestId: payload?.requestId
    });
  }
  return payload;
}

function normalizeVaultCompatResponse(requestPayload, nativeMessage) {
  const type = requestPayload?.type;
  if (type === "list_passkeys") {
    const items = Array.isArray(nativeMessage?.result?.items) ? nativeMessage.result.items : [];
    const rpId = String(requestPayload?.rpId ?? "").trim().toLowerCase();
    const mapped = items
      .map(normalizeVaultItemToPasskey)
      .filter((item) => !rpId || item.rpId === rpId || item.rpId.endsWith(`.${rpId}`) || rpId.endsWith(`.${item.rpId}`));
    return {
      requestId: requestPayload?.requestId,
      passkeys: mapped
    };
  }
  if (type === "add_passkey") {
    return {
      requestId: requestPayload?.requestId,
      ok: Boolean(nativeMessage?.ok),
      itemId: nativeMessage?.result?.itemId ?? ""
    };
  }
  if (type === "remove_passkey") {
    return {
      requestId: requestPayload?.requestId,
      ok: Boolean(nativeMessage?.ok),
      itemId: nativeMessage?.result?.itemId ?? requestPayload?.id ?? ""
    };
  }
  return nativeMessage;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  debugNativeLog("runtime:onMessage", {
    messageType: message.type,
    target: message?.target,
    payloadType: message?.payload?.type,
    requestId: message?.payload?.requestId ?? message?.payload?.id
  });

  if (message.type === "connect-native") {
    try {
      const target = message?.target === "vault" ? "vault" : "passkey";
      ensurePort(target);
      sendResponse({ ok: true, host: getHostName(target), target });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }

  if (message.type === "sync-config-set") {
    (async () => {
      try {
        const cfg = message?.payload && typeof message.payload === "object" ? message.payload : {};
        const email = String(cfg?.email ?? "").trim();
        const baseUrl = String(cfg?.baseUrl ?? "").trim();
        const enabled = cfg?.enabled === undefined ? true : Boolean(cfg?.enabled);
        const periodMinutesRaw = Number(cfg?.periodMinutes ?? AUTO_SYNC_DEFAULT_PERIOD_MINUTES);
        const periodMinutes = Number.isFinite(periodMinutesRaw)
          ? Math.max(1, Math.floor(periodMinutesRaw))
          : AUTO_SYNC_DEFAULT_PERIOD_MINUTES;
        await chrome.storage.local.set({
          [AUTO_SYNC_STORAGE_KEY]: {
            email,
            baseUrl,
            enabled,
            periodMinutes,
            updatedAt: new Date().toISOString()
          }
        });
        await ensureAutoResyncAlarm();
        sendResponse({ ok: true, email, baseUrl, enabled, periodMinutes });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message ?? e) });
      }
    })();
    return true;
  }

  if (message.type === "sync-resync-now") {
    (async () => {
      try {
        await runAutoResync("manual");
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message ?? e) });
      }
    })();
    return true;
  }

  if (message.type === "vault-connect") {
    try {
      ensurePort("vault");
      sendResponse({ ok: true, host: getHostName("vault"), target: "vault" });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }

  if (message.type === "native-request") {
    try {
      const target = isVaultCompatRequest(message) ? "vault" : "passkey";
      const p = ensurePort(target);
      debugNativeLog("native-request:postMessage", {
        target,
        hostName: getHostName(target),
        payload: message.payload ?? {}
      });
      p.postMessage(message.payload ?? {});
      sendResponse({ ok: true, target });
    } catch (e) {
      debugNativeLog("native-request:error", { error: String(e) });
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }

  if (message.type === "vault-request") {
    try {
      const p = ensurePort("vault");
      const payload = handleVaultCompat(message.payload ?? {});
      debugNativeLog("vault-request:postMessage", {
        target: "vault",
        hostName: getHostName("vault"),
        payload
      });
      p.postMessage(payload);
      sendResponse({ ok: true, target: "vault" });
    } catch (e) {
      debugNativeLog("vault-request:error", { error: String(e) });
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }

  if (message.type === "native-request-await") {
    try {
      const target = isVaultCompatRequest(message) ? "vault" : "passkey";
      const originalPayload = message.payload ?? {};
      const payload = target === "vault" ? handleVaultCompat(originalPayload) : originalPayload;
      const requestId = payload?.requestId ?? payload?.id;
      if (!requestId || typeof requestId !== "string") {
        sendResponse({ ok: false, error: "requestId is required for native-request-await" });
        return true;
      }

      const p = ensurePort(target);
      debugNativeLog("native-request-await:postMessage", {
        target,
        hostName: getHostName(target),
        requestId,
        payload
      });

      let settled = false;
      let timeoutId = null;

      const cleanup = () => {
        p.onMessage.removeListener(onPortMessage);
        p.onDisconnect.removeListener(onPortDisconnect);
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const settle = (response) => {
        if (settled) return;
        settled = true;
        cleanup();
        debugNativeLog("native-request-await:settle", { target, requestId, response });
        sendResponse(response);
      };

      const onPortMessage = (msg) => {
        const msgRequestId = msg?.requestId ?? msg?.id;
        if (msgRequestId !== requestId) {
          return;
        }
        const normalizedPayload = target === "vault" ? normalizeVaultCompatResponse(originalPayload, msg) : msg;
        settle({ ok: true, payload: normalizedPayload, raw: msg, target });
      };

      const onPortDisconnect = () => {
        settle({ ok: false, error: chrome.runtime.lastError?.message ?? "Native host disconnected." });
      };

      p.onMessage.addListener(onPortMessage);
      p.onDisconnect.addListener(onPortDisconnect);

      timeoutId = setTimeout(() => {
        settle({ ok: false, error: "timeout", detail: "native-response timeout" });
      }, 10000);

      p.postMessage(payload);
    } catch (e) {
      debugNativeLog("native-request-await:error", { error: String(e) });
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }

  if (message.type === "vault-request-await") {
    try {
      const originalPayload = message.payload ?? {};
      const payload = handleVaultCompat(originalPayload);
      const requestId = payload?.id ?? payload?.requestId;
      if (!requestId || typeof requestId !== "string") {
        sendResponse({ ok: false, error: "id is required for vault-request-await" });
        return true;
      }

      const p = ensurePort("vault");
      debugNativeLog("vault-request-await:postMessage", {
        target: "vault",
        hostName: getHostName("vault"),
        requestId,
        payload
      });
      let settled = false;
      let timeoutId = null;

      const cleanup = () => {
        p.onMessage.removeListener(onPortMessage);
        p.onDisconnect.removeListener(onPortDisconnect);
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const settle = (response) => {
        if (settled) return;
        settled = true;
        cleanup();
        debugNativeLog("vault-request-await:settle", { requestId, response });
        sendResponse(response);
      };

      const onPortMessage = (msg) => {
        const msgRequestId = msg?.requestId ?? msg?.id;
        if (msgRequestId !== requestId) {
          return;
        }
        settle({ ok: true, payload: normalizeVaultCompatResponse(originalPayload, msg), raw: msg, target: "vault" });
      };

      const onPortDisconnect = () => {
        settle({ ok: false, error: chrome.runtime.lastError?.message ?? "Native host disconnected." });
      };

      p.onMessage.addListener(onPortMessage);
      p.onDisconnect.addListener(onPortDisconnect);

      timeoutId = setTimeout(() => {
        settle({ ok: false, error: "timeout", detail: "native-response timeout" });
      }, 10000);

      p.postMessage(payload);
    } catch (e) {
      debugNativeLog("vault-request-await:error", { error: String(e) });
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }
});

try {
  chrome.runtime.onInstalled.addListener(() => {
    ensureAutoResyncAlarm();
  });
  chrome.runtime.onStartup.addListener(() => {
    ensureAutoResyncAlarm();
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === AUTO_SYNC_ALARM_NAME) {
      runAutoResync("alarm");
    }
  });
} catch {}

ensureAutoResyncAlarm();
