import { ADD_LANES } from "../../contracts/src/add-lanes.js";

export const YOINKBOT_MARKER = "YoinkBot checkout update";
export const CHECKOUT_LOGIN_REMINDER = "For faster checkout, stay logged in to the same store account on your phone and computer.";

export function userBotMessage(payload: Record<string, unknown>): { text: string; cartUrl: string } {
  if (payload.eventType === "test" && payload.purpose === "connection_confirmation") {
    return { cartUrl: "", text: [YOINKBOT_MARKER, "Connected! Your Telegram checkout alerts are on.",
      "YoinkBot will message you here when checkout is ready or needs your attention. Ready alerts follow a final availability check.",
      "You can pause or disconnect in Yoink → Setup → Alerts.", CHECKOUT_LOGIN_REMINDER].join("\n") };
  }
  const lane = Object.values(ADD_LANES).find((item) => item.id === payload.retailerId);
  const event = String(payload.eventType || "test");
  const status = event === "carted" ? "Checkout checked — ready for your review"
    : event === "needs_you" ? "Checkout needs your attention"
      : event === "missed" ? "Checkout unavailable"
        : event === "notify" ? "Stock update" : "Test notification";
  const title = String(payload.title || "Your YoinkBot connection is working").replace(/[\r\n]/g, " ").slice(0, 250);
  const price = Number.isSafeInteger(payload.unitPriceCents) && Number(payload.unitPriceCents) > 0
    ? ` · Item price $${(Number(payload.unitPriceCents) / 100).toFixed(2)}` : "";
  const quantity = Number.isSafeInteger(payload.quantity) && Number(payload.quantity) > 0 ? ` · Qty ${payload.quantity}` : "";
  const cartUrl = lane?.cartUrl || "";
  return {
    cartUrl,
    text: [YOINKBOT_MARKER, `${payload.test === true ? "TEST · " : ""}${status}${lane ? ` at ${lane.name}` : ""}`,
      `${title}${quantity}${price}`,
      event === "carted" ? "Checkout was checked on your computer. Review availability and place the order yourself."
        : event === "needs_you" ? "Open the store on your computer to finish sign-in or review the checkout issue." : "",
      cartUrl ? `Open cart: ${cartUrl}` : "",
      CHECKOUT_LOGIN_REMINDER].filter(Boolean).join("\n")
  };
}
