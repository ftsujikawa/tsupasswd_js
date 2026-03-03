const HOST_NAME = "com.tsupasswd.bridge";

let port = null;

function ensurePort() {
  if (port) return port;

  port = chrome.runtime.connectNative(HOST_NAME);

  port.onMessage.addListener((msg) => {
    chrome.runtime.sendMessage({ type: "native-response", payload: msg });
  });

  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message ?? "Native host disconnected.";
    chrome.runtime.sendMessage({ type: "native-error", error: err });
    port = null;
  });

  return port;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "connect-native") {
    try {
      ensurePort();
      sendResponse({ ok: true, host: HOST_NAME });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }

  if (message.type === "native-request") {
    try {
      const p = ensurePort();
      p.postMessage(message.payload ?? {});
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }

  if (message.type === "native-request-await") {
    try {
      const payload = message.payload ?? {};
      const requestId = payload?.requestId;
      if (!requestId || typeof requestId !== "string") {
        sendResponse({ ok: false, error: "requestId is required for native-request-await" });
        return true;
      }

      const p = ensurePort();

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
        sendResponse(response);
      };

      const onPortMessage = (msg) => {
        const msgRequestId = msg?.requestId;
        if (msgRequestId !== requestId) {
          return;
        }
        settle({ ok: true, payload: msg });
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
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }
});
