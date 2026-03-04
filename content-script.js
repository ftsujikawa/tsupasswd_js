(() => {
  const MENU_ID = "tsupasswd-passkey-menu";
  const STYLE_ID = "tsupasswd-passkey-menu-style";

  let menuEl = null;
  let listEl = null;
  let activeInput = null;
  let isPointerInMenu = false;
  let isAuthInProgress = false;
  let authInFlightPromise = null;
  let authAbortController = null;
  let suppressNextInputFocusOpen = false;
  let lastAuthErrorMessage = "";
  let lastAuthInfoMessage = "";
  let isMenuPinned = false;
  let showAllPasskeys = false;
  let modeToggleBtn = null;

  function shouldKeepMenuVisible() {
    return isMenuPinned || isAuthInProgress || Boolean(lastAuthErrorMessage);
  }

  function updateModeToggleLabel() {
    if (!(modeToggleBtn instanceof HTMLButtonElement)) return;
    modeToggleBtn.textContent = showAllPasskeys ? "全件: ON" : "全件: OFF";
    modeToggleBtn.title = showAllPasskeys
      ? "全件表示中（クリックでrpId限定に戻す）"
      : "rpId限定表示中（クリックで全件表示）";
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${MENU_ID} {
        position: fixed;
        z-index: 2147483647;
        width: 360px;
        max-width: calc(100vw - 16px);
        max-height: min(300px, calc(100vh - 16px));
        overflow: auto;
        border: 1px solid #cfd8dc;
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 12px 30px rgba(0,0,0,.2);
        font-family: Segoe UI, system-ui, sans-serif;
        font-size: 12px;
        color: #1f2937;
      }
      #${MENU_ID}[data-hidden="true"] { display: none; }
      #${MENU_ID} .hdr {
        position: sticky;
        top: 0;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
        padding: 8px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      #${MENU_ID} .mode-toggle {
        font: inherit;
        font-size: 11px;
        padding: 2px 8px;
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        background: #ffffff;
        color: #334155;
        cursor: pointer;
      }
      #${MENU_ID} .mode-toggle:hover { background: #f1f5f9; }
      #${MENU_ID} .empty { padding: 10px; color: #6b7280; }
      #${MENU_ID} .item {
        padding: 8px;
        border-bottom: 1px solid #f1f5f9;
        cursor: pointer;
      }
      #${MENU_ID} .item:hover { background: #eef6ff; }
      #${MENU_ID} .item .t { font-weight: 600; }
      #${MENU_ID} .item .m { color: #4b5563; margin-top: 2px; }
    `;
    document.documentElement.appendChild(style);
  }

  function decodeBase64ToBytes(base64) {
    try {
      const normalized = String(base64 ?? "")
        .trim()
        .replace(/-/g, "+")
        .replace(/_/g, "/");
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
  }

  function isRpIdUsableForCurrentOrigin(rpId) {
    const host = (window.location.hostname || "").trim().toLowerCase();
    const normalizedRpId = String(rpId ?? "").trim().toLowerCase();
    if (!host || !normalizedRpId) return false;
    return host === normalizedRpId || host.endsWith(`.${normalizedRpId}`);
  }

  async function authenticateWithPasskey(passkey) {
    if (isAuthInProgress && authInFlightPromise) {
      return authInFlightPromise;
    }

    if (authAbortController) {
      try {
        authAbortController.abort();
      } catch {}
      authAbortController = null;
    }

    if (!window.isSecureContext) {
      return { ok: false, error: "secure_context_required" };
    }

    if (!("credentials" in navigator) || !("PublicKeyCredential" in window)) {
      return { ok: false, error: "webauthn_not_supported" };
    }

    const credentialId = decodeBase64ToBytes(passkey?.id);
    if (!credentialId || credentialId.length === 0) {
      return { ok: false, error: "invalid_credential_id" };
    }

    const selectedRpId = (passkey?.rpId || deriveRpIdFromPage() || "").trim().toLowerCase();
    if (!selectedRpId) {
      return { ok: false, error: "missing_rp_id" };
    }
    if (!isRpIdUsableForCurrentOrigin(selectedRpId)) {
      return { ok: false, error: "rp_id_mismatch", detail: `rpId=${selectedRpId}, origin=${window.location.hostname}` };
    }

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    isAuthInProgress = true;
    authAbortController = new AbortController();
    authInFlightPromise = (async () => {
      try {
        const credential = await navigator.credentials.get({
          publicKey: {
            challenge,
            rpId: selectedRpId,
            timeout: 60000,
            userVerification: "preferred",
            allowCredentials: [
              {
                id: credentialId,
                type: "public-key"
              }
            ]
          },
          signal: authAbortController.signal
        });

        if (!credential) {
          return { ok: false, error: "credential_not_returned" };
        }

        return { ok: true };
      } catch (e) {
        if (e?.name === "AbortError") {
          return { ok: false, error: "auth_aborted", detail: "認証をキャンセルしました。" };
        }
        if (e?.name === "OperationError" && String(e?.message || "").includes("already pending")) {
          return { ok: false, error: "auth_pending", detail: "認証処理が進行中です。完了まで待ってください。" };
        }
        return { ok: false, error: e?.name || "auth_failed", detail: String(e?.message || e) };
      } finally {
        isAuthInProgress = false;
        authAbortController = null;
        authInFlightPromise = null;
      }
    })();

    return authInFlightPromise;
  }

  function ensureMenu() {
    if (menuEl) return;
    ensureStyle();

    menuEl = document.createElement("div");
    menuEl.id = MENU_ID;
    menuEl.dataset.hidden = "true";

    const hdr = document.createElement("div");
    hdr.className = "hdr";

    const hdrTitle = document.createElement("span");
    hdrTitle.textContent = "Passkeys";

    modeToggleBtn = document.createElement("button");
    modeToggleBtn.type = "button";
    modeToggleBtn.className = "mode-toggle";
    updateModeToggleLabel();
    modeToggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showAllPasskeys = !showAllPasskeys;
      updateModeToggleLabel();
      if (activeInput) {
        openMenuForInput(activeInput);
      }
    });

    hdr.appendChild(hdrTitle);
    hdr.appendChild(modeToggleBtn);

    listEl = document.createElement("div");

    menuEl.appendChild(hdr);
    menuEl.appendChild(listEl);
    document.documentElement.appendChild(menuEl);

    menuEl.addEventListener("mouseenter", () => {
      isPointerInMenu = true;
    });

    menuEl.addEventListener("mouseleave", () => {
      isPointerInMenu = false;
    });

    menuEl.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
  }

  function isEligibleInput(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el instanceof HTMLTextAreaElement) return true;
    if (el instanceof HTMLInputElement) {
      const t = (el.type || "text").toLowerCase();
      return !["hidden", "password", "checkbox", "radio", "file", "submit", "button"].includes(t);
    }
    if (el.isContentEditable) return true;
    if ((el.getAttribute("role") || "").toLowerCase() === "textbox") return true;
    return false;
  }

  function getFocusedEligibleInput() {
    const focused = document.activeElement;
    return isEligibleInput(focused) ? focused : null;
  }

  function hideMenu(options = {}) {
    const { force = false } = options;
    if (!menuEl) return;
    if (!force && shouldKeepMenuVisible()) return;
    menuEl.dataset.hidden = "true";
  }

  function showMenuNear(anchor) {
    if (!menuEl || !(anchor instanceof HTMLElement)) return;

    const r = anchor.getBoundingClientRect();
    const gap = 6;
    const menuWidth = Math.min(360, window.innerWidth - 16);

    let left = Math.max(8, Math.min(r.left, window.innerWidth - menuWidth - 8));
    let top = r.bottom + gap;

    if (top + 260 > window.innerHeight) {
      top = Math.max(8, r.top - 260 - gap);
    }

    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
    menuEl.style.width = `${menuWidth}px`;
    menuEl.dataset.hidden = "false";
  }

  function getHostFromUrl(urlLike) {
    try {
      if (!urlLike) return "";
      const parsed = new URL(String(urlLike), window.location.href);
      return (parsed.hostname || "").trim().toLowerCase();
    } catch {
      return "";
    }
  }

  function deriveRpIdFromPage() {
    const currentHost = (window.location.hostname || "").trim().toLowerCase();

    try {
      if (window.top && window.top !== window) {
        const topHost = (window.top.location?.hostname || "").trim().toLowerCase();
        if (topHost) return topHost;
      }
    } catch {
      // cross-origin frame: fall back to referrer.
    }

    const referrerHost = getHostFromUrl(document.referrer || "");
    if (referrerHost) {
      return referrerHost;
    }

    return currentHost;
  }

  function requestNativeList(rpId) {
    return new Promise((resolve) => {
      const requestId = `cs-list-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      chrome.runtime.sendMessage(
        {
          type: "native-request-await",
          payload: {
            type: "list_passkeys",
            requestId,
            ...(rpId ? { rpId } : {})
          }
        },
        (res) => {
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              error: chrome.runtime.lastError.message
            });
            return;
          }

          if (!res?.ok) {
            resolve({ ok: false, error: res?.error || "native-request-failed", detail: res?.detail });
            return;
          }

          resolve(res.payload ?? { ok: false, error: "empty_payload" });
        }
      );
    });
  }

  function isRpIdRelatedToHost(passkeyRpId, host) {
    const rp = String(passkeyRpId || "").trim().toLowerCase();
    const h = String(host || "").trim().toLowerCase();
    if (!rp || !h) return false;
    return h === rp || h.endsWith(`.${rp}`) || rp.endsWith(`.${h}`);
  }

  function getCredentialIdSuffix(id) {
    const raw = String(id || "").trim();
    if (!raw) return "";
    return raw.length <= 8 ? raw : raw.slice(-8);
  }

  async function requestNativeListWithFallback(pageRpId) {
    const host = String(pageRpId || "").trim().toLowerCase();

    if (showAllPasskeys) {
      return await requestNativeList("");
    }

    let result = await requestNativeList(host);
    if (result?.ok && Array.isArray(result.passkeys) && result.passkeys.length > 0) {
      return result;
    }

    if (host.startsWith("www.")) {
      const noWww = host.slice(4);
      const noWwwResult = await requestNativeList(noWww);
      if (noWwwResult?.ok && Array.isArray(noWwwResult.passkeys) && noWwwResult.passkeys.length > 0) {
        return noWwwResult;
      }
    }

    const unfiltered = await requestNativeList("");
    if (!unfiltered?.ok || !Array.isArray(unfiltered.passkeys)) {
      return unfiltered;
    }

    const filtered = host
      ? unfiltered.passkeys.filter((p) => isRpIdRelatedToHost(p?.rpId, host))
      : unfiltered.passkeys;

    return {
      ...unfiltered,
      passkeys: filtered
    };
  }

  function fillActiveInput(passkey, options = {}) {
    const { closeMenu = true, focusInput = true, emitChange = true } = options;
    activeInput = resolveTargetInput(activeInput);
    if (!activeInput) return false;
    const value = passkey?.user || passkey?.id || passkey?.title || "";
    if (!value) {
      lastAuthInfoMessage = "この項目は入力可能なuser値がありません。";
      renderMenu({ ok: true, passkeys: [] });
      return false;
    }

    if (focusInput) {
      if (closeMenu) {
        suppressNextInputFocusOpen = true;
      }
      activeInput.focus();
    }
    setInputValue(activeInput, value);
    activeInput.setAttribute("value", value);
    activeInput.dispatchEvent(new Event("input", { bubbles: true }));
    if (emitChange) {
      activeInput.dispatchEvent(new Event("change", { bubbles: true }));
      activeInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
      activeInput.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    if (String(activeInput.value ?? "") !== String(value)) {
      lastAuthErrorMessage = "入力欄へ値を反映できませんでした。対象入力欄をクリックして再試行してください。";
      renderMenu({ ok: true, passkeys: [] });
      return false;
    }

    if (closeMenu) {
      hideMenu();
    }

    return true;
  }

  function triggerAuthenticateActionIfSupported() {
    const host = (window.location.hostname || "").toLowerCase();
    const isWebauthnIo = host === "webauthn.io" || host.endsWith(".webauthn.io");
    const isPasskeysIo = host === "passkeys.io" || host.endsWith(".passkeys.io");
    if (!isWebauthnIo && !isPasskeysIo) {
      return false;
    }

    const candidates = isPasskeysIo
      ? [
          "#continue",
          "#continue-button",
          "button[name='continue']",
          "button[data-action='continue']",
          "button[type='submit']",
          "button[id*='continue']"
        ]
      : [
          "#authenticate",
          "#authenticate-button",
          "#login",
          "#login-button",
          "button[name='authenticate']",
          "button[data-action='authenticate']",
          "button[id*='auth']",
          "button[id*='login']"
        ];

    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (el instanceof HTMLButtonElement && !el.disabled) {
        el.click();
        return true;
      }
    }

    const allButtons = Array.from(document.querySelectorAll("button"));
    const fallback = allButtons.find((btn) => {
      const text = (btn.textContent || "").trim().toLowerCase();
      if (btn.disabled) return false;
      if (isPasskeysIo) {
        return text.includes("continue");
      }
      return text.includes("authenticate") || text.includes("login") || text.includes("sign in");
    });
    if (fallback) {
      fallback.click();
      return true;
    }

    return false;
  }

  function setInputValue(el, value) {
    if (el instanceof HTMLElement && (el.isContentEditable || (el.getAttribute("role") || "").toLowerCase() === "textbox")) {
      el.textContent = value;
      return;
    }

    if (el instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) {
        setter.call(el, value);
        return;
      }
    }

    if (el instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) {
        setter.call(el, value);
        return;
      }
    }

    el.value = value;
  }

  function resolveTargetInput(preferredInput = null) {
    const focused = getFocusedEligibleInput();
    if (focused) return focused;

    if (isEligibleInput(preferredInput)) {
      return preferredInput;
    }

    const host = (window.location.hostname || "").toLowerCase();
    if (host === "webauthn.io" || host.endsWith(".webauthn.io")) {
      const webauthnIoInput = document.querySelector("#input-email, input[type='email'], input[name='email'], input[name='username']");
      if (isEligibleInput(webauthnIoInput)) {
        return webauthnIoInput;
      }
    }

    const firstTextInput = document.querySelector(
      "input[type='text'], input[type='email'], textarea, [contenteditable='true'], [role='textbox']"
    );
    return isEligibleInput(firstTextInput) ? firstTextInput : null;
  }

  function renderMenu(result) {
    if (!listEl) return;
    listEl.textContent = "";

    if (lastAuthInfoMessage) {
      const info = document.createElement("div");
      info.className = "empty";
      info.textContent = lastAuthInfoMessage;
      listEl.appendChild(info);
    }

    if (lastAuthErrorMessage) {
      const err = document.createElement("div");
      err.className = "empty";
      err.textContent = lastAuthErrorMessage;
      listEl.appendChild(err);
    }

    if (!result?.ok) {
      const div = document.createElement("div");
      div.className = "empty";
      div.textContent = `取得失敗: ${result?.error || "unknown"}`;
      listEl.appendChild(div);
      return;
    }

    const passkeys = Array.isArray(result.passkeys) ? result.passkeys : [];
    if (passkeys.length === 0) {
      const div = document.createElement("div");
      div.className = "empty";
      div.textContent = "該当するパスキーがありません";
      listEl.appendChild(div);
      return;
    }

    const baseUsers = passkeys.map((p) => String(p?.user || p?.displayName || "(no user)").trim() || "(no user)");
    const totalByUser = new Map();
    for (const u of baseUsers) {
      totalByUser.set(u, (totalByUser.get(u) || 0) + 1);
    }
    const seenByUser = new Map();

    for (let i = 0; i < passkeys.length; i += 1) {
      const p = passkeys[i];
      const item = document.createElement("div");
      item.className = "item";

      const userText = baseUsers[i];
      const currentIndex = (seenByUser.get(userText) || 0) + 1;
      seenByUser.set(userText, currentIndex);
      const totalCount = totalByUser.get(userText) || 1;
      const userLabel = totalCount > 1 ? `${userText} (${currentIndex}/${totalCount})` : userText;
      const titleText = p?.title || "";
      const rpIdText = p?.rpId || "";
      const idSuffix = getCredentialIdSuffix(p?.id);
      const sourceText = p?.source || "unknown";

      const t = document.createElement("div");
      t.className = "t";
      t.textContent = userLabel;

      const m = document.createElement("div");
      m.className = "m";
      m.textContent = [
        titleText,
        rpIdText ? `rpId: ${rpIdText}` : "",
        idSuffix ? `id: ...${idSuffix}` : "",
        `source: ${sourceText}`
      ]
        .filter(Boolean)
        .join("  ");

      item.appendChild(t);
      item.appendChild(m);
      item.addEventListener("mouseenter", () =>
        fillActiveInput(p, { closeMenu: false, focusInput: false, emitChange: false })
      );

      let isActivated = false;
      const activateItem = async () => {
        if (isActivated) return;
        isActivated = true;
        lastAuthInfoMessage = `選択: ${userLabel}${idSuffix ? ` / id末尾: ${idSuffix}` : ""}`;
        lastAuthErrorMessage = "";
        isMenuPinned = false;
        isPointerInMenu = false;
        const applied = fillActiveInput(p, { closeMenu: true, focusInput: true, emitChange: true });
        if (applied) {
          triggerAuthenticateActionIfSupported();
        }
        setTimeout(() => {
          isActivated = false;
        }, 0);
      };

      item.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        activateItem();
      });
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        activateItem();
      });
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        activateItem();
      });
      listEl.appendChild(item);
    }
  }

  function hasPasskeys(result) {
    return Boolean(result?.ok && Array.isArray(result.passkeys) && result.passkeys.length > 0);
  }

  async function openMenuForInput(inputEl) {
    if (!isEligibleInput(inputEl)) return;
    activeInput = inputEl;

    ensureMenu();

    const rpId = deriveRpIdFromPage();
    const result = await requestNativeListWithFallback(rpId);

    if (!hasPasskeys(result)) {
      hideMenu({ force: true });
      return;
    }

    showMenuNear(inputEl);
    renderMenu(result);
  }

  document.addEventListener("focusin", (e) => {
    const target = e.target;
    if (isEligibleInput(target)) {
      if (suppressNextInputFocusOpen) {
        suppressNextInputFocusOpen = false;
        return;
      }
      if (target === activeInput && menuEl && menuEl.dataset.hidden === "false") {
        return;
      }
      openMenuForInput(target);
      return;
    }
    if (isPointerInMenu) {
      return;
    }
    if (menuEl && target instanceof Node && !menuEl.contains(target)) {
      hideMenu();
    }
  });

  document.addEventListener("focusout", () => {
    setTimeout(() => {
      const focusedInput = getFocusedEligibleInput();
      if (focusedInput) {
        if (focusedInput === activeInput && menuEl && menuEl.dataset.hidden === "false") {
          return;
        }
        openMenuForInput(focusedInput);
        return;
      }
      if (!isPointerInMenu) {
        hideMenu();
      }
    }, 0);
  });

  document.addEventListener("mousedown", (e) => {
    const target = e.target;
    if (!menuEl) return;
    if (isEligibleInput(target)) {
      openMenuForInput(target);
      return;
    }
    if (getFocusedEligibleInput()) return;
    if (isPointerInMenu) return;
    if (target instanceof Node && menuEl.contains(target)) return;
    hideMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (authAbortController) {
        try {
          authAbortController.abort();
        } catch {}
      }
      isMenuPinned = false;
      lastAuthInfoMessage = "";
      lastAuthErrorMessage = "";
      hideMenu({ force: true });
    }
  });
})();
