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
  const currentHost = (window.location.hostname || "").toLowerCase();
  const defaultShowAllPasskeys =
    currentHost === "passkeys-demo.appspot.com" || currentHost.endsWith(".passkeys-demo.appspot.com");
  let showAllPasskeys = defaultShowAllPasskeys;
  let modeToggleBtn = null;
  const PASSKEYS_DEMO_HOOK_FLAG = "__tsupasswdPasskeysDemoHookInstalled";
  const PASSKEYS_DEMO_HOOK_EVENT = "tsupasswd:set-preferred-passkey";
  const PASSKEYS_DEMO_HOOK_SCRIPT_ID = "tsupasswd-passkeys-demo-hook-script";

  function shouldKeepMenuVisible() {
    return isMenuPinned || isAuthInProgress || Boolean(lastAuthErrorMessage);
  }

  function clickElementSimple(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el instanceof HTMLButtonElement && el.disabled) return false;
    if (el instanceof HTMLInputElement && el.disabled) return false;
    try {
      el.click();
      return true;
    } catch {
      return false;
    }
  }

  function updateModeToggleLabel() {
    if (!(modeToggleBtn instanceof HTMLButtonElement)) return;
    modeToggleBtn.textContent = showAllPasskeys ? "全件: ON" : "全件: OFF";
    modeToggleBtn.title = showAllPasskeys
      ? "全件表示中（クリックでrpId限定に戻す）"
      : "rpId限定表示中（クリックで全件表示）";
  }

  function isPasskeysDemoHost(host = currentHost) {
    return host === "passkeys-demo.appspot.com" || host.endsWith(".passkeys-demo.appspot.com");
  }

  function isPasskeyOrgHost(host = currentHost) {
    return host === "passkey.org" || host.endsWith(".passkey.org");
  }

  function isWebauthnHookTargetHost(host = currentHost) {
    return (
      isPasskeysDemoHost(host) ||
      host === "webauthn.io" ||
      host.endsWith(".webauthn.io") ||
      host === "passkeys.io" ||
      host.endsWith(".passkeys.io") ||
      isPasskeyOrgHost(host)
    );
  }

  function normalizeSource(source) {
    const normalized = String(source || "").trim().toLowerCase();
    if (normalized === "core") return "tsupasswd_core";
    return normalized || "unknown";
  }

  function sourceDisplayName(source) {
    const normalized = normalizeSource(source);
    if (normalized === "windows_hello") return "windows_hello";
    if (normalized === "tsupasswd_core") return "tsupasswd_core";
    return normalized;
  }

  function ensurePasskeysDemoWebAuthnHook() {
    if (!isWebauthnHookTargetHost()) return false;
    if ((window)[PASSKEYS_DEMO_HOOK_FLAG]) return true;

    if (document.getElementById(PASSKEYS_DEMO_HOOK_SCRIPT_ID)) {
      return true;
    }

    const script = document.createElement("script");
    script.id = PASSKEYS_DEMO_HOOK_SCRIPT_ID;
    script.src = chrome.runtime.getURL("page-passkeys-demo-hook.js");
    script.async = false;
    script.addEventListener("load", () => {
      (window)[PASSKEYS_DEMO_HOOK_FLAG] = true;
    });
    document.documentElement.appendChild(script);
    return true;
  }

  function getSearchRoots() {
    const roots = [document];
    const stack = [document.documentElement];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!(node instanceof Element)) continue;
      if (node.shadowRoot) {
        roots.push(node.shadowRoot);
        stack.push(node.shadowRoot);
      }
      const children = node.children;
      for (let i = 0; i < children.length; i += 1) {
        stack.push(children[i]);
      }
    }
    return roots;
  }

  function querySelectorDeep(selector) {
    const roots = getSearchRoots();
    for (const root of roots) {
      const found = root.querySelector(selector);
      if (found instanceof HTMLElement) {
        return found;
      }
    }
    return null;
  }

  function queryAllDeep(selector) {
    const roots = getSearchRoots();
    const results = [];
    for (const root of roots) {
      const list = root.querySelectorAll(selector);
      for (const el of list) {
        if (el instanceof HTMLElement) {
          results.push(el);
        }
      }
    }
    return results;
  }

  function clickElementRobust(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el instanceof HTMLButtonElement && el.disabled) return false;
    if (el instanceof HTMLInputElement && el.disabled) return false;

    const innerButton = el.shadowRoot?.querySelector("button, [role='button']");
    const target = innerButton instanceof HTMLElement ? innerButton : el;
    if (target instanceof HTMLButtonElement && target.disabled) return false;

    try {
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
      target.click();
      return true;
    } catch {
      return false;
    }
  }

  function setPreferredPasskeyForPage(passkey) {
    if (!isWebauthnHookTargetHost()) return false;
    const installed = ensurePasskeysDemoWebAuthnHook();
    if (!installed) return false;

    const id = String(passkey?.id || "").trim();
    if (!id) return false;
    const rpId = String(passkey?.rpId || "").trim().toLowerCase();
    const emit = () => {
      window.dispatchEvent(new CustomEvent(PASSKEYS_DEMO_HOOK_EVENT, { detail: { id, rpId } }));
    };
    emit();
    setTimeout(emit, 100);
    setTimeout(emit, 300);
    return true;
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
      const anchor = getMenuRefreshAnchor();
      if (anchor) {
        openMenuForInput(anchor);
      }
    });

    const reloadBtn = document.createElement("button");
    reloadBtn.type = "button";
    reloadBtn.className = "mode-toggle";
    reloadBtn.textContent = "再読込";
    reloadBtn.title = "一覧を再読込";
    reloadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const anchor = getMenuRefreshAnchor();
      if (anchor) {
        openMenuForInput(anchor);
      }
    });

    hdr.appendChild(hdrTitle);
    hdr.appendChild(modeToggleBtn);
    hdr.appendChild(reloadBtn);

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

  function findEligibleInputFromNode(node) {
    if (!(node instanceof HTMLElement)) return null;
    if (isEligibleInput(node)) return node;
    if (node.shadowRoot) {
      const inShadow = node.shadowRoot.querySelector(
        "input, textarea, [contenteditable='true'], [role='textbox']"
      );
      if (isEligibleInput(inShadow)) {
        return inShadow;
      }
    }
    return null;
  }

  function findEligibleInputTarget(target, eventObj) {
    const direct = findEligibleInputFromNode(target);
    if (direct) {
      return direct;
    }

    if (eventObj && typeof eventObj.composedPath === "function") {
      const path = eventObj.composedPath();
      for (const node of path) {
        const found = findEligibleInputFromNode(node);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  function getFocusedEligibleInput() {
    const focused = document.activeElement;
    if (isEligibleInput(focused)) {
      return focused;
    }

    const fromActiveHost = findEligibleInputFromNode(focused);
    if (fromActiveHost) {
      return fromActiveHost;
    }

    return null;
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
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        resolve(payload);
      };
      const timeoutId = setTimeout(() => {
        finish({ ok: false, error: "native_request_timeout", detail: "Native host response timed out" });
      }, 8000);

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
          clearTimeout(timeoutId);
          if (chrome.runtime.lastError) {
            finish({
              ok: false,
              error: chrome.runtime.lastError.message
            });
            return;
          }

          if (!res?.ok) {
            finish({ ok: false, error: res?.error || "native-request-failed", detail: res?.detail });
            return;
          }

          finish(res.payload ?? { ok: false, error: "empty_payload" });
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
    if (!result?.ok) {
      return result;
    }
    if (result?.ok && Array.isArray(result.passkeys) && result.passkeys.length > 0) {
      return result;
    }

    if (host.startsWith("www.")) {
      const noWww = host.slice(4);
      const noWwwResult = await requestNativeList(noWww);
      if (!noWwwResult?.ok) {
        return noWwwResult;
      }
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

    const rootNode = typeof activeInput.getRootNode === "function" ? activeInput.getRootNode() : null;
    const shadowHost = rootNode instanceof ShadowRoot && rootNode.host instanceof HTMLElement ? rootNode.host : null;

    setInputValue(activeInput, value);
    activeInput.setAttribute("value", value);
    if (shadowHost) {
      try {
        if ("value" in shadowHost) {
          shadowHost.value = value;
        }
      } catch {}
      shadowHost.setAttribute("value", value);
    }

    const dispatchInputEvents = (targetEl) => {
      if (!(targetEl instanceof HTMLElement)) return;
      targetEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      if (emitChange) {
        targetEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      }
    };

    dispatchInputEvents(activeInput);
    if (shadowHost && shadowHost !== activeInput) {
      dispatchInputEvents(shadowHost);
    }

    if (emitChange) {
      activeInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true, key: "Enter" }));
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
    const isPasskeysDemo = host === "passkeys-demo.appspot.com" || host.endsWith(".passkeys-demo.appspot.com");
    const isPasskeyOrg = isPasskeyOrgHost(host);
    if (!isWebauthnIo && !isPasskeysIo && !isPasskeysDemo && !isPasskeyOrg) {
      return false;
    }

    const clickForAuth = isPasskeysDemo ? clickElementRobust : clickElementSimple;

    const candidates = isPasskeysIo
      ? [
          "#continue",
          "#continue-button",
          "button[name='continue']",
          "button[data-action='continue']",
          "button[type='submit']",
          "button[id*='continue']"
        ]
      : isPasskeysDemo
      ? [
          "#signin",
          "#sign-in",
          "#login",
          "#authenticate",
          "button[name='signin']",
          "button[name='login']",
          "button[data-action='signin']",
          "button[data-action='login']",
          "button[id*='sign-in']",
          "button[id*='signin']",
          "button[id*='login']",
          "mdui-button#signin",
          "mdui-button#sign-in",
          "mdui-button[id*='signin']",
          "mdui-button[id*='login']"
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
      const el = querySelectorDeep(selector);
      if (clickForAuth(el)) {
        return true;
      }
    }

    const allButtons = queryAllDeep("button, [role='button'], mdui-button, input[type='submit'], input[type='button']");
    if (isPasskeysDemo) {
      const normalizedText = (el) => String(el.textContent || "").trim().toLowerCase();
      const oneButtonSignIn = allButtons.find((el) => normalizedText(el).includes("use one button sign-in instead"));
      if (oneButtonSignIn && clickElementRobust(oneButtonSignIn)) {
        setTimeout(() => {
          const refreshed = queryAllDeep("button, [role='button'], mdui-button, input[type='submit'], input[type='button']");
          const nextBtn = refreshed.find((el) => normalizedText(el) === "next" || normalizedText(el).includes(" next"));
          if (nextBtn) {
            clickElementRobust(nextBtn);
          }
        }, 120);
        return true;
      }

      const nextDirect = allButtons.find((el) => normalizedText(el) === "next" || normalizedText(el).includes(" next"));
      if (clickForAuth(nextDirect)) {
        return true;
      }
    }

    const fallback = allButtons.find((btn) => {
      const text = (btn.textContent || "").trim().toLowerCase();
      if (btn instanceof HTMLButtonElement && btn.disabled) return false;
      if (isPasskeysIo) {
        return text.includes("continue");
      }
      return (
        text.includes("authenticate") ||
        text.includes("login") ||
        text.includes("sign in") ||
        text.includes("sign-in") ||
        text.includes("signin")
      );
    });
    if (fallback) {
      return clickForAuth(fallback);
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

  function getMenuRefreshAnchor() {
    if (activeInput instanceof HTMLElement) {
      return activeInput;
    }

    const focused = getFocusedEligibleInput();
    if (focused instanceof HTMLElement) {
      return focused;
    }

    const resolved = resolveTargetInput();
    if (resolved instanceof HTMLElement) {
      return resolved;
    }

    return null;
  }

  function renderMenu(result) {
    if (!listEl) return;
    listEl.textContent = "";

    const coreMeta = result?.sources?.core;
    const windowsMeta = result?.sources?.windows_hello;
    if (coreMeta || windowsMeta) {
      const meta = document.createElement("div");
      meta.className = "empty";
      const coreCount = Number(coreMeta?.count ?? 0);
      const windowsCount = Number(windowsMeta?.count ?? 0);
      const coreError = coreMeta?.error ? ` (err:${coreMeta.error})` : "";
      const windowsError = windowsMeta?.error ? ` (err:${windowsMeta.error})` : "";
      meta.textContent = `core=${coreCount}${coreError} / windows_hello=${windowsCount}${windowsError}`;
      listEl.appendChild(meta);
    }

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

      if (windowsMeta && typeof windowsMeta === "object") {
        const meta = document.createElement("div");
        meta.className = "empty";
        const count = Number(windowsMeta.count ?? 0);
        const error = windowsMeta.error ? `, error: ${windowsMeta.error}` : "";
        meta.textContent = `Windows Hello: count=${count}${error}`;
        listEl.appendChild(meta);
      }
      return;
    }

    const sortedPasskeys = [...passkeys].sort((a, b) => {
      const aSource = String(a?.source || "").toLowerCase();
      const bSource = String(b?.source || "").toLowerCase();
      const rank = (source) => (source === "windows_hello" ? 0 : source === "tsupasswd_core" ? 1 : 2);
      const bySource = rank(aSource) - rank(bSource);
      if (bySource !== 0) return bySource;
      return String(a?.user || a?.displayName || a?.title || "").localeCompare(
        String(b?.user || b?.displayName || b?.title || "")
      );
    });

    const baseUsers = sortedPasskeys.map((p) => String(p?.user || p?.displayName || "(no user)").trim() || "(no user)");
    const totalByUser = new Map();
    for (const u of baseUsers) {
      totalByUser.set(u, (totalByUser.get(u) || 0) + 1);
    }
    const seenByUser = new Map();
    let lastSource = "";

    for (let i = 0; i < sortedPasskeys.length; i += 1) {
      const p = sortedPasskeys[i];
      const sourceKey = normalizeSource(p?.source);
      const sourceText = sourceDisplayName(sourceKey);
      if (sourceKey !== lastSource) {
        const sourceHeader = document.createElement("div");
        sourceHeader.className = "empty";
        sourceHeader.textContent = `source: ${sourceText}`;
        listEl.appendChild(sourceHeader);
        lastSource = sourceKey;
      }
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

      const t = document.createElement("div");
      t.className = "t";
      t.textContent = `[${sourceText}] ${userLabel}`;

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
        const selectedSource = sourceKey || "unknown";
        const selectedSourceLabel = sourceDisplayName(selectedSource);
        const selectedRpId = rpIdText || "(none)";
        lastAuthInfoMessage = `選択: ${userLabel}${idSuffix ? ` / id末尾: ${idSuffix}` : ""} / source: ${selectedSourceLabel} / rpId: ${selectedRpId}`;
        lastAuthErrorMessage = "";
        isMenuPinned = false;
        isPointerInMenu = false;
        const isPasskeysDemo = isPasskeysDemoHost();
        const isPasskeyOrg = isPasskeyOrgHost();
        if (isPasskeysDemo) {
          const normalizeUser = (v) => String(v ?? "").trim().toLowerCase();
          const targetInput = resolveTargetInput(activeInput);
          const enteredUser = normalizeUser(targetInput?.value);
          const selectedUser = normalizeUser(p?.userName || p?.userDisplayName);
          if (enteredUser && selectedUser && enteredUser !== selectedUser) {
            lastAuthErrorMessage = `入力ユーザー(${enteredUser})と選択パスキー(${selectedUser})が一致しません。`; 
            if (targetInput instanceof HTMLElement) {
              openMenuForInput(targetInput);
            }
            setTimeout(() => {
              isActivated = false;
            }, 0);
            return;
          }
        }
        const canInjectPreferredId = selectedSource !== "tsupasswd_core";
        const hookSet = canInjectPreferredId ? setPreferredPasskeyForPage(p) : false;
        const applied = isPasskeysDemo
          ? false
          : fillActiveInput(p, { closeMenu: true, focusInput: true, emitChange: true });
        if (hookSet) {
          lastAuthInfoMessage = `${lastAuthInfoMessage} / 選択パスキーをWebAuthnに反映`;
        } else if (!canInjectPreferredId) {
          lastAuthInfoMessage = `${lastAuthInfoMessage} / tsupasswd_coreはWebAuthn ID強制対象外`;
        }
        if (isPasskeyOrg && selectedSource === "tsupasswd_core") {
          lastAuthInfoMessage = `${lastAuthInfoMessage} / 注意: Windowsセキュリティ画面にはtsupasswd_core名は表示されない場合があります`;
        }
        if (applied || hookSet) {
          const host = (window.location.hostname || "").toLowerCase();
          const shouldPreferSiteFlow =
            host === "webauthn.io" ||
            host.endsWith(".webauthn.io") ||
            host === "passkeys.io" ||
            host.endsWith(".passkeys.io") ||
            host === "passkey.org" ||
            host.endsWith(".passkey.org") ||
            isPasskeysDemo;

          let authStarted = false;
          if (shouldPreferSiteFlow) {
            authStarted = triggerAuthenticateActionIfSupported();
            if (authStarted) {
              lastAuthInfoMessage = `${lastAuthInfoMessage} / サイト認証フローを起動`;
            } else {
              lastAuthErrorMessage = "サイト認証フローを開始できませんでした。対象入力欄を再フォーカスして再試行してください。";
            }
          }

          if (!shouldPreferSiteFlow && !authStarted) {
            const authResult = await authenticateWithPasskey(p);
            if (authResult?.ok) {
              lastAuthInfoMessage = `${lastAuthInfoMessage} / WebAuthn get() を実行`;
            } else {
              const detail = authResult?.detail ? ` (${authResult.detail})` : "";
              lastAuthErrorMessage = `WebAuthn get() 失敗: ${authResult?.error || "auth_failed"}${detail}`;
            }
          }
        }
        setTimeout(() => {
          isActivated = false;
        }, 0);
      };

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        activateItem();
      });
      listEl.appendChild(item);
    }
  }

  function hasPasskeys(result) {
    return Boolean(result?.ok && Array.isArray(result.passkeys) && result.passkeys.length > 0);
  }

  function shouldShowMenuEvenIfEmpty() {
    const host = (window.location.hostname || "").toLowerCase();
    return (
      host === "webauthn.io" ||
      host.endsWith(".webauthn.io") ||
      host === "passkeys.io" ||
      host.endsWith(".passkeys.io") ||
      host === "passkey.org" ||
      host.endsWith(".passkey.org") ||
      host === "passkeys-demo.appspot.com" ||
      host.endsWith(".passkeys-demo.appspot.com")
    );
  }

  function findButtonTrigger(target, eventObj) {
    if (target instanceof Element) {
      const direct = target.closest("button, [role='button']");
      if (direct instanceof HTMLElement) {
        return direct;
      }
    }

    if (eventObj && typeof eventObj.composedPath === "function") {
      const path = eventObj.composedPath();
      for (const node of path) {
        if (node instanceof HTMLElement && node.matches("button, [role='button']")) {
          return node;
        }
      }
    }

    return null;
  }

  async function openMenuForInput(inputEl) {
    const forceShow = shouldShowMenuEvenIfEmpty();
    const eligibleInput = isEligibleInput(inputEl) ? inputEl : null;
    if (!eligibleInput && !(forceShow && inputEl instanceof HTMLElement)) return;
    const resolvedInput = resolveTargetInput(eligibleInput || activeInput);
    activeInput = resolvedInput;
    const menuAnchor =
      (activeInput instanceof HTMLElement && isEligibleInput(activeInput) ? activeInput : null) ||
      (inputEl instanceof HTMLElement ? inputEl : null);
    if (!(menuAnchor instanceof HTMLElement)) return;

    ensureMenu();
    if (forceShow) {
      showMenuNear(menuAnchor);
      if (listEl) {
        listEl.textContent = "";
        const loading = document.createElement("div");
        loading.className = "empty";
        loading.textContent = "読み込み中...";
        listEl.appendChild(loading);
      }
    }

    let result;
    try {
      const rpId = deriveRpIdFromPage();
      result = await requestNativeListWithFallback(rpId);
    } catch (e) {
      result = { ok: false, error: "list_fetch_failed", detail: String(e?.message || e) };
    }

    if (!hasPasskeys(result) && !forceShow) {
      hideMenu({ force: true });
      return;
    }

    showMenuNear(menuAnchor);
    renderMenu(result);
  }

  function tryOpenMenuFromFocusTarget(target, eventObj) {
    const eligibleTarget = findEligibleInputTarget(target, eventObj);
    if (!eligibleTarget) {
      return false;
    }
    if (suppressNextInputFocusOpen) {
      suppressNextInputFocusOpen = false;
      return true;
    }
    if (eligibleTarget === activeInput && menuEl && menuEl.dataset.hidden === "false") {
      return true;
    }
    openMenuForInput(eligibleTarget);
    return true;
  }

  document.addEventListener("focusin", (e) => {
    const target = e.target;
    if (tryOpenMenuFromFocusTarget(target, e)) {
      return;
    }
    if (isPointerInMenu) {
      return;
    }
    if (menuEl && target instanceof Node && !menuEl.contains(target)) {
      hideMenu();
    }
  });

  document.addEventListener(
    "focus",
    (e) => {
      tryOpenMenuFromFocusTarget(e.target, e);
    },
    true
  );

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
    const eligibleTarget = findEligibleInputTarget(target, e);
    if (eligibleTarget) {
      openMenuForInput(eligibleTarget);
      return;
    }
    if (getFocusedEligibleInput()) return;
    if (isPointerInMenu) return;
    if (menuEl && target instanceof Node && menuEl.contains(target)) return;
    hideMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "F5" && menuEl && menuEl.dataset.hidden === "false") {
      e.preventDefault();
      const anchor = getMenuRefreshAnchor();
      if (anchor) {
        openMenuForInput(anchor);
      }
      return;
    }

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

  if (shouldShowMenuEvenIfEmpty()) {
    ensureMenu();
    ensurePasskeysDemoWebAuthnHook();
  }
})();
