const connectBtn = document.getElementById("connect");
const sendBtn = document.getElementById("send");
const payloadEl = document.getElementById("payload");
const resultEl = document.getElementById("result");

function setResult(value) {
  resultEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "native-response") {
    setResult({ ok: true, native: msg.payload });
  }
  if (msg?.type === "native-error") {
    setResult({ ok: false, error: msg.error });
  }
});
