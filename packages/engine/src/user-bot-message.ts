import { ADD_LANES } from "../../contracts/src/add-lanes.js";

export const YOINKBOT_MARKER = "YoinkBot";
export const CHECKOUT_LOGIN_REMINDER = "Stay logged in to the same store account on phone and computer.";

type MessageFormat = "plain" | "discord" | "telegram";

export function userBotMessage(payload: Record<string, unknown>, format: MessageFormat = "plain"): { text: string; cartUrl: string } {
  const escape = (value: string): string => format === "telegram"
    ? value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    : format === "discord" ? value.replace(/([\\`*_~|<>\[\]()])/g, "\\$1") : value;
  const bold = (value: string): string => format === "telegram" ? `<b>${escape(value)}</b>`
    : format === "discord" ? `**${escape(value)}**` : value;
  const message = (heading: string, sections: string[], cartUrl = "") => ({
    cartUrl, text: [bold(`${YOINKBOT_MARKER} · ${heading}`), ...sections, escape(CHECKOUT_LOGIN_REMINDER)].filter(Boolean).join("\n\n")
  });

  if (payload.eventType === "test" && payload.purpose === "connection_confirmation") {
    return message("Connected", ["Telegram checkout alerts are on."]);
  }
  const event = String(payload.eventType || "test");
  if (!["carted", "needs_you", "missed", "notify"].includes(event)) {
    return message("Test received", ["Your connection is working. No action needed."]);
  }

  const lane = Object.values(ADD_LANES).find((item) => item.id === payload.retailerId);
  const status = event === "carted" ? "Checkout ready"
    : event === "needs_you" ? "Action needed"
      : event === "missed" ? "Checkout unavailable" : "Stock update";
  const title = String(payload.title || "Your item").replace(/\s+/g, " ").trim().slice(0, 250);
  const details = [Number.isSafeInteger(payload.quantity) && Number(payload.quantity) > 0 ? `Qty ${payload.quantity}` : "",
    Number.isSafeInteger(payload.unitPriceCents) && Number(payload.unitPriceCents) > 0
      ? `$${(Number(payload.unitPriceCents) / 100).toFixed(2)} each` : ""].filter(Boolean).join(" · ");
  const cartUrl = payload.test === true ? "" : lane?.cartUrl || "";
  const cartLabel = "Open cart →";
  const cartLink = !cartUrl ? "" : format === "telegram" ? `<a href="${escape(cartUrl)}">${escape(cartLabel)}</a>`
    : format === "discord" ? `[${escape(cartLabel)}](${cartUrl})` : `${cartLabel}\n${cartUrl}`;
  const action = payload.test === true ? "Test only. No action needed."
    : event === "needs_you" ? "Open the store on your computer to finish sign-in or review checkout." : "";
  return message(`${payload.test === true ? "TEST · " : ""}${status}${lane ? ` — ${lane.name}` : ""}`, [
    [escape(title), escape(details)].filter(Boolean).join("\n"),
    [escape(action), cartLink].filter(Boolean).join("\n")
  ], cartUrl);
}
