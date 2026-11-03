(function initializeYoinkStatus(global) {
  "use strict";

  const MAX_TOASTS = 2;
  const STATUS_OPTIONS = Object.freeze({ maxSuccessToastLength: 60, undoDurationMs: 10_000 });
  const MAX_SUCCESS_TOAST_LENGTH = STATUS_OPTIONS.maxSuccessToastLength;
  const toastTimers = new WeakMap();
  const inlineStatuses = new WeakMap();
  const keyedStatuses = new Map();
  let lastTrigger = null;

  const interactiveSelector = "button, a[href], input, select, textarea, summary, [role='button'], [tabindex]";

  function usableElement(value) {
    return value instanceof global.Element && value.isConnected && !value.closest("[hidden]");
  }

  function rememberTrigger(event) {
    const candidate = event.submitter || event.target?.closest?.(interactiveSelector) || event.target?.closest?.("form");
    if (usableElement(candidate)) lastTrigger = candidate;
  }

  global.document.addEventListener("pointerdown", rememberTrigger, true);
  global.document.addEventListener("submit", rememberTrigger, true);
  global.document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") rememberTrigger(event);
  }, true);

  function trigger(element) {
    if (usableElement(element)) return element;
    if (usableElement(lastTrigger)) return lastTrigger;
    const focused = global.document.activeElement;
    if (usableElement(focused) && focused !== global.document.body) return focused;
    return global.document.querySelector("main") || global.document.body;
  }

  function parseReference(message, suppliedReference) {
    const text = String(message || "").trim();
    if (suppliedReference) return { message: text, reference: String(suppliedReference) };
    const match = text.match(/\s+Reference\s+([A-Za-z0-9._:-]+)\.?$/i);
    if (!match) return { message: text, reference: "" };
    return { message: text.slice(0, match.index).trim(), reference: match[1].replace(/\.+$/, "") };
  }

  async function copyText(value) {
    if (global.navigator.clipboard?.writeText) return global.navigator.clipboard.writeText(value);
    const input = global.document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.className = "status-copy-fallback";
    global.document.body.append(input);
    input.select();
    global.document.execCommand?.("copy");
    input.remove();
  }

  function removeInlineStatus(anchor) {
    const existing = inlineStatuses.get(anchor);
    if (!existing) return;
    removeStatus(existing);
    inlineStatuses.delete(anchor);
  }

  function removeStatus(status) {
    global.clearTimeout(toastTimers.get(status));
    toastTimers.delete(status);
    if (keyedStatuses.get(status.dataset.statusKey) === status) keyedStatuses.delete(status.dataset.statusKey);
    const root = status.parentElement;
    status.remove();
    if (root?.classList.contains("toast")) root.classList.toggle("show", root.childElementCount > 0);
  }

  function replaceKeyedStatus(status, key) {
    if (!key) return;
    const previous = keyedStatuses.get(key);
    if (previous) removeStatus(previous);
    status.dataset.statusKey = key;
    keyedStatuses.set(key, status);
  }

  function clearStatuses() {
    for (const status of keyedStatuses.values()) removeStatus(status);
  }

  function setInlineStatus(element, options = {}) {
    const anchor = trigger(element);
    removeInlineStatus(anchor);
    const parsed = parseReference(options.message, options.reference);
    const state = ["success", "error", "info"].includes(options.state) ? options.state : "info";
    const status = global.document.createElement("div");
    status.className = `inline-status ${state}`;
    status.dataset.inlineStatus = state;
    status.setAttribute("role", state === "error" ? "alert" : "status");

    const message = global.document.createElement("span");
    message.className = "inline-status-message";
    message.textContent = parsed.message;
    status.append(message);

    if (options.action?.label && typeof options.action.onClick === "function") {
      const action = global.document.createElement("button");
      action.className = "inline-status-action";
      action.type = "button";
      action.textContent = options.action.label;
      action.addEventListener("click", async () => {
        action.disabled = true;
        try {
          await options.action.onClick();
          removeStatus(status);
        } catch (error) {
          setInlineStatus(anchor, { ...options, state: "error", message: error?.message || "That action could not be completed.", reference: error?.reference });
        }
      });
      status.append(action);
      if (options.durationMs) toastTimers.set(status, global.setTimeout(() => action.remove(), options.durationMs));
    }

    if (parsed.reference) {
      const copy = global.document.createElement("button");
      copy.className = "inline-status-action";
      copy.type = "button";
      copy.textContent = "Copy reference";
      copy.addEventListener("click", async () => {
        await copyText(parsed.reference);
        copy.textContent = "Copied";
      });
      status.append(copy);
    }

    if (state === "error" || state === "success") {
      const dismiss = global.document.createElement("button");
      dismiss.className = "inline-status-dismiss";
      dismiss.type = "button";
      dismiss.setAttribute("aria-label", state === "error" ? "Dismiss error" : "Dismiss confirmation");
      dismiss.textContent = "Dismiss";
      dismiss.addEventListener("click", () => removeInlineStatus(anchor));
      status.append(dismiss);
    }

    if (anchor.matches?.(interactiveSelector)) anchor.insertAdjacentElement("afterend", status);
    else anchor.prepend(status);
    inlineStatuses.set(anchor, status);
    replaceKeyedStatus(status, options.key);
    return status;
  }

  function removeToast(root, item) {
    const timer = toastTimers.get(item);
    if (timer) global.clearTimeout(timer);
    toastTimers.delete(item);
    removeStatus(item);
    root.classList.toggle("show", root.childElementCount > 0);
  }

  function pushToast(root, options = {}) {
    if (!(root instanceof global.Element)) return null;
    const state = options.state === "error" ? "error" : "success";
    const parsed = parseReference(options.message, options.reference);
    const anchor = trigger(options.element);

    if (state === "error") {
      setInlineStatus(anchor, { state, message: parsed.message, reference: parsed.reference });
    } else if (parsed.message.length > MAX_SUCCESS_TOAST_LENGTH) {
      return setInlineStatus(anchor, { ...options, state, message: parsed.message });
    }

    const item = global.document.createElement("div");
    item.className = `toast-item ${state}${options.action ? " actionable" : ""}`;
    item.setAttribute("role", state === "error" ? "alert" : "status");
    const message = global.document.createElement("span");
    message.className = "toast-message";
    message.textContent = state === "error" && parsed.message.length > MAX_SUCCESS_TOAST_LENGTH
      ? "Action needs attention."
      : parsed.message;
    item.append(message);

    if (options.action?.label && typeof options.action.onClick === "function") {
      const action = global.document.createElement("button");
      action.className = "toast-action";
      action.type = "button";
      action.textContent = options.action.label;
      action.addEventListener("click", async () => {
        action.disabled = true;
        try {
          await options.action.onClick();
          removeToast(root, item);
        } catch (error) {
          setInlineStatus(anchor, {
            state: "error",
            message: error?.message || "That action could not be completed.",
            reference: error?.reference
          });
          action.disabled = false;
        }
      });
      item.append(action);
    }

    root.append(item);
    replaceKeyedStatus(item, options.key);
    while (root.childElementCount > MAX_TOASTS) removeToast(root, root.firstElementChild);
    root.classList.add("show");
    const durationMs = Math.max(1_000, Math.min(STATUS_OPTIONS.undoDurationMs, Number(options.durationMs) || (options.action ? STATUS_OPTIONS.undoDurationMs : 4_500)));
    toastTimers.set(item, global.setTimeout(() => removeToast(root, item), durationMs));
    return item;
  }

  global.YoinkStatus = Object.freeze({
    MAX_SUCCESS_TOAST_LENGTH,
    options: STATUS_OPTIONS,
    clearStatuses,
    currentTrigger: trigger,
    pushToast,
    setInlineStatus
  });
})(globalThis);
