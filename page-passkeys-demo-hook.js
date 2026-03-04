(() => {
  const HOOK_FLAG = "__tsupasswdPasskeysDemoHookInstalled";
  const HOOK_EVENT = "tsupasswd:set-preferred-passkey";

  if (window[HOOK_FLAG]) return;
  window[HOOK_FLAG] = true;

  const toBytes = (base64) => {
    try {
      const normalized = String(base64 || "").trim().replace(/-/g, "+").replace(/_/g, "/");
      if (!normalized) return null;
      const padLen = normalized.length % 4;
      const padded = padLen === 0 ? normalized : normalized + "=".repeat(4 - padLen);
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch {
      return null;
    }
  };

  let preferredId = "";
  let preferredRpId = "";

  window.addEventListener(HOOK_EVENT, (ev) => {
    const detail = ev && ev.detail ? ev.detail : {};
    preferredId = String(detail.id || "").trim();
    preferredRpId = String(detail.rpId || "").trim().toLowerCase();
  });

  if (!navigator.credentials || typeof navigator.credentials.get !== "function") {
    return;
  }

  const originalGet = navigator.credentials.get.bind(navigator.credentials);
  navigator.credentials.get = (options) => {
    try {
      if (preferredId && options && options.publicKey) {
        const bytes = toBytes(preferredId);
        if (bytes) {
          options.publicKey.allowCredentials = [{ type: "public-key", id: bytes }];
          if (preferredRpId && !options.publicKey.rpId) {
            options.publicKey.rpId = preferredRpId;
          }
        }
      }
    } catch {}
    return originalGet(options);
  };
})();
