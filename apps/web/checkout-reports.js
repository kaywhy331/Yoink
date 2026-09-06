function installCheckoutReports({ api, money, escapeHtml, requestConfirmation, toast, onSaved }) {
  const dialog = document.getElementById("checkoutReportDialog");
  const form = document.getElementById("checkoutReportForm");
  const fields = document.getElementById("checkoutReportFields");
  const status = document.getElementById("checkoutReportStatus");
  const reviewPanel = document.getElementById("checkoutReportReview");
  const save = document.getElementById("saveCheckoutReport");
  const reload = document.getElementById("reloadCheckoutReport");
  let current = null;
  let pending = false;
  let preview = null;
  let command = null;
  let returnFocus = null;
  let jobId = "";
  let kind = "correction";
  let sequence = 0;
  const endpoint = () => `/api/v1/user/checkout-reports/${encodeURIComponent(jobId)}`;
  const message = (text, error = false) => { status.textContent = text; status.classList.toggle("warn", error); };
  const format = value => money(value || 0);
  const label = value => value.outcome === "got_it" ? "Got it" : "Missed it";
  const date = value => new Date(value).toLocaleString();
  function busy(value) {
    pending = value;
    dialog.setAttribute("aria-busy", String(value));
    for (const button of dialog.querySelectorAll("button")) button.disabled = value;
    fields.disabled = value || Boolean(preview) || !current;
    save.disabled = value || !current;
    form.elements.reviewed.disabled = value;
  }
  function history(data) {
    document.getElementById("checkoutReportHistory").innerHTML = data.items.map(item => `<li>
      <strong>${escapeHtml(item.kind === "original" ? "Original report" : item.kind === "refund" ? "Refund recorded" : "Report corrected")}</strong>
      <small>${escapeHtml(date(item.createdAt))}</small>
      <p>${escapeHtml(label(item.after))} · Charged ${escapeHtml(format(item.after.actualTotalCents))} · Refunded ${escapeHtml(format(item.after.refundedCents))} · Net ${escapeHtml(format(item.after.netCents))}</p>
      ${item.before ? `<p>Previously: ${escapeHtml(label(item.before))} · Charged ${escapeHtml(format(item.before.actualTotalCents))} · Refunded ${escapeHtml(format(item.before.refundedCents))}</p>` : ""}
      <p>${escapeHtml(item.reason)}</p>
      ${item.planChange ? `<p>Plan: ${item.planChange.before.fulfilledQuantity} → ${item.planChange.after.fulfilledQuantity} of ${item.planChange.after.targetQuantity} received · ${escapeHtml(item.planChange.after.status)}</p>` : ""}
    </li>`).join("");
    document.getElementById("checkoutHistoryPage").textContent = `${data.offset + 1}–${Math.min(data.offset + data.items.length, data.total)} of ${data.total}`;
    const previous = document.getElementById("checkoutHistoryPrevious");
    const next = document.getElementById("checkoutHistoryNext");
    previous.hidden = data.offset === 0; next.hidden = data.offset + data.items.length >= data.total;
    previous.dataset.offset = String(Math.max(0, data.offset - 25)); next.dataset.offset = String(data.offset + 25);
  }
  function syncFields(suggest = false) {
    const refund = kind === "refund";
    const purchased = form.elements.outcome.value === "got_it";
    document.getElementById("checkoutOutcomeField").hidden = refund;
    document.getElementById("checkoutChargeFields").hidden = refund || !purchased;
    document.getElementById("checkoutRefundField").hidden = !refund;
    form.elements.refundAmount.required = refund;
    form.elements.actualTotal.required = !refund && purchased;
    const progress = !refund && current && form.elements.outcome.value !== current.report.outcome && current.plan.status !== "deleted";
    document.getElementById("checkoutProgressField").hidden = !progress;
    form.elements.fulfilledQuantity.required = progress;
    if (progress && suggest) {
      form.elements.fulfilledQuantity.value = String(Math.min(current.plan.targetQuantity, Math.max(0,
        current.plan.fulfilledQuantity + (purchased ? 1 : -1) * current.job.quantity)));
    }
    if (current) {
      form.elements.fulfilledQuantity.max = String(current.plan.targetQuantity);
      document.getElementById("checkoutProgressHelp").textContent = `Currently ${current.plan.fulfilledQuantity} of ${current.plan.targetQuantity} received. Review the total to keep, including any other purchases. An active plan will pause unless this completes it.`;
    }
  }
  function edit() {
    preview = null; command = null;
    reviewPanel.hidden = true; fields.hidden = false; fields.disabled = !current;
    save.textContent = "Review change"; form.elements.reviewed.checked = false;
  }
  function render(data) {
    current = data; edit();
    form.reset();
    if (kind === "refund" && (data.report.outcome !== "got_it" || data.report.netCents === 0)) kind = "correction";
    document.getElementById("checkoutReportTitle").textContent = kind === "refund" ? "Record refund" : "Correct checkout report";
    document.getElementById("checkoutReportSummary").textContent = `${data.job.title} · ${data.job.retailerSku}`;
    document.getElementById("checkoutReportCurrent").textContent = `${label(data.report)} · Charged ${format(data.report.actualTotalCents)} · Refunded ${format(data.report.refundedCents)} · Net ${format(data.report.netCents)}`;
    document.getElementById("checkoutReportAccounting").textContent = `Spending date: ${date(data.accountingAt)}. Changes apply to that spending period. Original reports stay in History.`;
    form.elements.outcome.value = data.report.outcome;
    form.elements.actualTotal.value = data.report.actualTotalCents === null ? "" : (data.report.actualTotalCents / 100).toFixed(2);
    form.elements.refundedTotal.value = (data.report.refundedCents / 100).toFixed(2);
    form.elements.refundAmount.max = (data.report.netCents / 100).toFixed(2);
    syncFields(); history(data.history);
    dialog.dataset.dirty = "false";
    reload.hidden = true;
  }
  async function load() {
    const request = ++sequence;
    busy(true); message("Loading checkout report…");
    try {
      const data = await api(endpoint());
      if (request !== sequence || !dialog.open) return;
      render(data); message("");
    } catch (error) {
      if (request !== sequence || !dialog.open) return;
      message(error.message || "The report could not be loaded.", true); reload.hidden = false;
    } finally { if (request === sequence) busy(false); }
  }
  async function open(id, selectedKind = "correction", trigger = null) {
    if (pending) return;
    jobId = id; kind = selectedKind; returnFocus = trigger; current = null;
    form.reset(); edit();
    document.getElementById("checkoutReportTitle").textContent = selectedKind === "refund" ? "Record refund" : "Correct checkout report";
    for (const id of ["checkoutReportSummary", "checkoutReportCurrent", "checkoutReportAccounting", "checkoutReportHistory", "checkoutHistoryPage"]) document.getElementById(id).textContent = "";
    document.getElementById("checkoutHistoryPrevious").hidden = true;
    document.getElementById("checkoutHistoryNext").hidden = true;
    reload.hidden = true; dialog.dataset.dirty = "false";
    dialog.showModal(); await load();
  }
  async function discard() {
    if (dialog.dataset.dirty !== "true") return true;
    return (await requestConfirmation({ title: "Discard this report draft?", summary: "Your unsaved report edits will be lost.", confirmLabel: "Discard draft" })).confirmed;
  }
  async function close() { if (!pending && await discard()) dialog.close(); }
  dialog.addEventListener("cancel", event => { event.preventDefault(); void close(); });
  dialog.addEventListener("close", () => {
    sequence += 1; busy(false); dialog.dataset.dirty = "false";
    const fallback = document.querySelector(`[data-checkout-report="${CSS.escape(jobId)}"]`);
    (returnFocus?.isConnected ? returnFocus : fallback)?.focus();
  });
  for (const type of ["input", "change"]) form.addEventListener(type, event => {
    if (!current || pending || event.target.name === "reviewed") return;
    dialog.dataset.dirty = "true";
    if (event.target.name === "outcome") syncFields(true);
  });
  dialog.addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button || pending) return;
    if (button.hasAttribute("data-close-checkout-report")) await close();
    if (button.id === "editCheckoutReport") { edit(); syncFields(); }
    if (button.id === "reloadCheckoutReport" && await discard()) { current = null; edit(); await load(); }
    if (button.id === "checkoutHistoryPrevious" || button.id === "checkoutHistoryNext") {
      busy(true);
      try { const data = await api(`${endpoint()}?offset=${button.dataset.offset}`); history(data.history); message(""); }
      catch (error) { message(error.message || "History could not be loaded. Try again.", true); }
      finally { busy(false); }
    }
  });
  function cents(value, name, optional = false) {
    if (value === "" && optional) return 0;
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error(`${name} must be an amount with up to two decimal places.`);
    return Math.round(Number(value) * 100);
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (pending || !current) return;
    if (preview && !form.elements.reviewed.checked) { message("Confirm that you reviewed the change before saving.", true); return; }
    busy(true); message(preview ? "Saving report…" : "Reviewing change…");
    dialog.dataset.dirty = "true";
    try {
      if (!preview) {
        const draft = { kind, outcome: form.elements.outcome.value, reason: form.elements.reason.value,
          expectedReportId: current.report.id,
          actualTotalCents: kind !== "refund" && form.elements.outcome.value === "got_it" ? cents(form.elements.actualTotal.value, "Charge") : null,
          refundedCents: kind !== "refund" && form.elements.outcome.value === "got_it" ? cents(form.elements.refundedTotal.value, "Total refunds", true) : 0,
          refundAmountCents: kind === "refund" ? cents(form.elements.refundAmount.value, "Refund") : null,
          fulfilledQuantity: document.getElementById("checkoutProgressField").hidden ? null : Number(form.elements.fulfilledQuantity.value) };
        const result = await api(`${endpoint()}/preview`, { method: "POST", body: JSON.stringify(draft) });
        preview = result.preview;
        command = { ...preview.draft, fingerprint: preview.fingerprint, requestId: crypto.randomUUID(), confirmation: "CORRECT_CHECKOUT_REPORT" };
        document.getElementById("checkoutReportComparison").innerHTML = `<thead><tr><th>Report</th><th>Before</th><th>After</th></tr></thead><tbody>${[
          ["Outcome", label(preview.before), label(preview.after)], ["Charged", format(preview.before.actualTotalCents), format(preview.after.actualTotalCents)],
          ["Refunded", format(preview.before.refundedCents), format(preview.after.refundedCents)], ["Net spend", format(preview.before.netCents), format(preview.after.netCents)]
        ].map(row => `<tr>${row.map((cell, i) => `<${i ? "td" : "th"}>${escapeHtml(cell)}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</tbody>`;
        document.getElementById("checkoutReportPlanEffect").textContent = preview.planChange
          ? `Plan progress: ${preview.planChange.before.fulfilledQuantity} → ${preview.planChange.after.fulfilledQuantity} of ${preview.planChange.after.targetQuantity} received. Plan will be ${preview.planChange.after.status}. ${preview.planChange.pendingActionCount} pending actions will be cancelled.`
          : "Plan progress stays the same.";
        document.getElementById("checkoutReportReviewReason").textContent = preview.draft.reason;
        document.getElementById("checkoutReportOverCap").textContent = preview.overCapAmountCents > 0 ? `Charge exceeds the reviewed maximum by ${format(preview.overCapAmountCents)}. Refunds do not change this charge comparison.` : "";
        fields.hidden = true; reviewPanel.hidden = false; save.textContent = "Save report change"; message("Review the amounts and plan progress, then confirm.");
        requestAnimationFrame(() => form.elements.reviewed.focus());
      } else {
        const result = await api(`${endpoint()}/corrections`, { method: "POST", body: JSON.stringify(command) });
        render(result.report); message("Report saved. Activity, spending and Insights now use this report.");
        toast("Checkout report updated.");
        try { await onSaved(); } catch { message("Report saved. Refresh Activity to see the updated row."); }
      }
    } catch (error) {
      message(error.message || "The report could not be saved. Try again.", true);
      if (error.status === 409) reload.hidden = false;
    } finally { busy(false); }
  });
  return { open };
}

globalThis.YoinkCheckoutReports = Object.freeze({ install: installCheckoutReports });
