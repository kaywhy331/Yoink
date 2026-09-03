export function presentShopperPurchaseIntent(plan: Record<string, unknown>): Record<string, unknown> {
  const rawTargets = Array.isArray(plan.targets) ? plan.targets : null;
  const targets = rawTargets?.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const target = value as Record<string, unknown>;
    const rawFulfillment = String(target.fulfillment ?? "");
    return {
      ...target,
      fulfillment: rawFulfillment === "pickup" ? "pickup" : "shipping",
      ...(rawFulfillment === "manual" ? { legacyFulfillmentMapped: true } : {})
    };
  });
  const primaryFulfillment = String(plan.primaryFulfillment ?? "");
  const legacyFulfillmentMapped = primaryFulfillment === "manual"
    || targets?.some((value) => Boolean(value && typeof value === "object"
      && !Array.isArray(value) && (value as Record<string, unknown>).legacyFulfillmentMapped === true)) === true;
  return {
    ...plan,
    ...(targets ? { targets } : {}),
    ...(primaryFulfillment
      ? { primaryFulfillment: primaryFulfillment === "pickup" ? "pickup" : "shipping" }
      : {}),
    ...(legacyFulfillmentMapped ? { legacyFulfillmentMapped: true } : {})
  };
}
