(function initializeYoinkStatus(global) {
  "use strict";

  const MAX_TOASTS = 2;
  const MAX_SUCCESS_TOAST_LENGTH = 60;
  const toastTimers = new WeakMap();
  const inlineStatuses = new WeakMap();
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
    existing.remove();
    inlineStatuses.delete(anchor);
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

    if (state === "error") {
      const dismiss = global.document.createElement("button");
      dismiss.className = "inline-status-dismiss";
      dismiss.type = "button";
      dismiss.setAttribute("aria-label", "Dismiss error");
      dismiss.textContent = "Dismiss";
      dismiss.addEventListener("click", () => removeInlineStatus(anchor));
      status.append(dismiss);
    }

    if (anchor.matches?.(interactiveSelector)) anchor.insertAdjacentElement("afterend", status);
    else anchor.prepend(status);
    inlineStatuses.set(anchor, status);
    return status;
  }

  function removeToast(root, item) {
    const timer = toastTimers.get(item);
    if (timer) global.clearTimeout(timer);
    toastTimers.delete(item);
    item.remove();
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
      return setInlineStatus(anchor, { state, message: parsed.message });
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
    while (root.childElementCount > MAX_TOASTS) removeToast(root, root.firstElementChild);
    root.classList.add("show");
    const durationMs = Math.max(1_000, Math.min(10_000, Number(options.durationMs) || (options.action ? 10_000 : 4_500)));
    toastTimers.set(item, global.setTimeout(() => removeToast(root, item), durationMs));
    return item;
  }

  global.YoinkStatus = Object.freeze({
    MAX_SUCCESS_TOAST_LENGTH,
    currentTrigger: trigger,
    pushToast,
    setInlineStatus
  });
})(globalThis);
