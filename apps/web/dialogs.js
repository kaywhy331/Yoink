(function installYoinkDialogs(global) {
  "use strict";

  let activeRequest = null;

  function elements() {
    const dialog = document.getElementById("confirmDialog");
    const form = document.getElementById("confirmDialogForm");
    if (!(dialog instanceof HTMLDialogElement) || !(form instanceof HTMLFormElement)) {
      throw new Error("The confirmation dialog is unavailable.");
    }
    return {
      dialog,
      form,
      title: document.getElementById("confirmDialogTitle"),
      summary: document.getElementById("confirmDialogSummary"),
      scope: document.getElementById("confirmDialogScope"),
      noteField: document.getElementById("confirmDialogNoteField"),
      noteLabel: document.getElementById("confirmDialogNoteLabel"),
      note: document.getElementById("confirmDialogNote"),
      noteHelp: document.getElementById("confirmDialogNoteHelp"),
      error: document.getElementById("confirmDialogError"),
      cancel: document.getElementById("confirmDialogCancel"),
      submit: document.getElementById("confirmDialogSubmit")
    };
  }

  function closeNativeDialog(dialog) {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function finish(confirmed) {
    if (!activeRequest) return;
    const current = activeRequest;
    activeRequest = null;
    const ui = elements();
    const note = ui.note.value.trim();
    closeNativeDialog(ui.dialog);
    current.resolve({ confirmed, note: confirmed ? note : "" });
    queueMicrotask(() => {
      if (current.returnFocus instanceof HTMLElement && current.returnFocus.isConnected) {
        current.returnFocus.focus();
      }
    });
  }

  function focusable(dialog) {
    return [...dialog.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")]
      .filter((element) => element instanceof HTMLElement
        && !element.hidden
        && !element.closest("[hidden]")
        && !element.hasAttribute("disabled"));
  }

  function confirmDialog(options = {}) {
    if (activeRequest) finish(false);
    const ui = elements();
    const title = String(options.title || "Confirm action").trim();
    const summary = String(options.summary || "").trim();
    const scope = Array.isArray(options.scope)
      ? options.scope.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const note = options.note && typeof options.note === "object" ? options.note : null;

    ui.form.reset();
    ui.title.textContent = title;
    ui.summary.textContent = summary;
    ui.summary.hidden = !summary;
    ui.scope.replaceChildren(...scope.map((item) => {
      const row = document.createElement("li");
      row.textContent = item;
      return row;
    }));
    ui.scope.hidden = scope.length === 0;
    ui.noteField.hidden = !note;
    ui.note.required = note?.required === true;
    ui.note.value = String(note?.initialValue || "");
    ui.noteLabel.textContent = String(note?.label || "Note");
    ui.noteHelp.textContent = String(note?.helper || "Keep notes concise and non-sensitive.");
    ui.error.hidden = true;
    ui.error.textContent = "";
    ui.cancel.textContent = String(options.cancelLabel || "Cancel");
    ui.submit.textContent = String(options.confirmLabel || "Confirm");
    ui.submit.classList.toggle("danger", options.danger === true);
    ui.submit.classList.toggle("primary", options.danger !== true);

    const returnFocus = document.activeElement;
    return new Promise((resolve) => {
      activeRequest = { resolve, returnFocus };
      if (typeof ui.dialog.showModal === "function") ui.dialog.showModal();
      else ui.dialog.setAttribute("open", "");
      queueMicrotask(() => (note ? ui.note : ui.submit).focus());
    });
  }

  document.addEventListener("submit", (event) => {
    if (!(event.target instanceof HTMLFormElement) || event.target.id !== "confirmDialogForm") return;
    event.preventDefault();
    const ui = elements();
    if (ui.note.required && !ui.note.value.trim()) {
      ui.error.textContent = "Add the required note before continuing.";
      ui.error.hidden = false;
      ui.note.setAttribute("aria-invalid", "true");
      ui.note.focus();
      return;
    }
    ui.note.removeAttribute("aria-invalid");
    finish(true);
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("#confirmDialogCancel") : null;
    if (target) finish(false);
  });

  document.addEventListener("cancel", (event) => {
    if (!(event.target instanceof HTMLDialogElement) || event.target.id !== "confirmDialog") return;
    event.preventDefault();
    finish(false);
  });

  document.addEventListener("keydown", (event) => {
    // Only touch the dialog while a request is active: pages without #confirmDialog load this script too.
    if (!activeRequest) return;
    const ui = elements();
    if (!ui.dialog.hasAttribute("open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
      return;
    }
    if (event.key !== "Tab") return;
    const controls = focusable(ui.dialog);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  global.YoinkDialogs = Object.freeze({ confirmDialog });
})(globalThis);
