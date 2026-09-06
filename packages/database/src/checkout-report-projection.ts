export const CHECKOUT_CORRECTION_REASON = "user_reported_checkout_correction";
export const CHECKOUT_REPORT_REASONS_SQL = "'user_reported_order', 'user_reported_missed_it', 'user_reported_checkout_correction'";

function alias(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(value)) throw new Error("A static SQL alias is required.");
  return value;
}

export function checkoutReportOrderSql(eventAlias: string): string {
  const event = alias(eventAlias);
  return `CASE WHEN ${event}.reason_code = '${CHECKOUT_CORRECTION_REASON}'
    THEN CAST(json_extract(${event}.evidence_json, '$.revision') AS INTEGER) ELSE 0 END DESC,
    ${event}.created_at DESC, ${event}.id DESC`;
}

export function checkoutOutcomeSql(eventAlias: string): string {
  const event = alias(eventAlias);
  return `CASE ${event}.reason_code WHEN 'user_reported_order' THEN 'got_it'
    WHEN 'user_reported_missed_it' THEN 'missed_it'
    WHEN '${CHECKOUT_CORRECTION_REASON}' THEN json_extract(${event}.evidence_json, '$.outcome') ELSE '' END`;
}

export function checkoutReportJoinSql(jobAlias: string, eventAlias: string): string {
  const job = alias(jobAlias); const event = alias(eventAlias);
  return `LEFT JOIN action_events ${event} ON ${event}.id = (
    SELECT current_report.id FROM action_events current_report WHERE current_report.job_id = ${job}.id
      AND current_report.reason_code IN (${CHECKOUT_REPORT_REASONS_SQL})
    ORDER BY ${checkoutReportOrderSql("current_report")} LIMIT 1)`;
}

/** Keep historical outcome/conversion windows anchored to the first report. */
export function checkoutOriginalReportedAtSql(jobAlias: string): string {
  return `(SELECT MIN(original_report.created_at) FROM action_events original_report
    WHERE original_report.job_id = ${alias(jobAlias)}.id
      AND original_report.reason_code IN ('user_reported_order', 'user_reported_missed_it'))`;
}

export function checkoutReportScalarSql(jobAlias: string, field: "outcome" | "total" | "refund" | "net" | "reportedAt" | "id"): string {
  const expression = field === "outcome" ? checkoutOutcomeSql("checkout_report")
    : field === "total" ? "json_extract(checkout_report.evidence_json, '$.actualTotalCents')"
    : field === "refund" ? "COALESCE(json_extract(checkout_report.evidence_json, '$.refundedCents'), 0)"
    : field === "net" ? "COALESCE(json_extract(checkout_report.evidence_json, '$.actualTotalCents'), 0) - COALESCE(json_extract(checkout_report.evidence_json, '$.refundedCents'), 0)"
    : field === "reportedAt" ? "checkout_report.created_at" : "checkout_report.id";
  return `(SELECT ${expression} FROM action_events checkout_report WHERE checkout_report.job_id = ${alias(jobAlias)}.id
    AND checkout_report.reason_code IN (${CHECKOUT_REPORT_REASONS_SQL})
    ORDER BY ${checkoutReportOrderSql("checkout_report")} LIMIT 1)`;
}

/** Corrections are posted now but belong to the original charge's cap period. */
export function spendAccountingTimeSql(engine: "sqlite" | "postgres", entryAlias = ""): string {
  const prefix = entryAlias ? `${alias(entryAlias)}.` : "";
  const metadataTime = engine === "postgres" ? `${prefix}metadata_json::jsonb ->> 'accountingAt'`
    : `json_extract(${prefix}metadata_json, '$.accountingAt')`;
  return `(CASE WHEN ${prefix}entry_type IN ('adjusted', 'refunded')
    AND ${prefix}reason_code = '${CHECKOUT_CORRECTION_REASON}'
    THEN COALESCE(${metadataTime}, ${prefix}created_at) ELSE ${prefix}created_at END)`;
}
