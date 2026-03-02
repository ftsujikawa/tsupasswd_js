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
});
