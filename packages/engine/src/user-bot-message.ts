import { ADD_LANES } from "../../contracts/src/add-lanes.js";

export const YOINKBOT_MARKER = "YoinkBot checkout update";
export const CHECKOUT_LOGIN_REMINDER = "For faster checkout, stay logged in to the same store account on your phone and computer.";

type MessageFormat = "plain" | "discord" | "telegram";

export function userBotMessage(payload: Record<string, unknown>, format: MessageFormat = "plain"): { text: string; cartUrl: string } {
  const escape = (value: string): string => format === "telegram"
    ? value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    : format === "discord" ? value.replace(/([\\`*_~|<>\[\]()])/g, "\\$1") : value;
  const bold = (value: string): string => format === "telegram" ? `<b>${escape(value)}</b>`
    : format === "discord" ? `**${escape(value)}**` : value;
  const bullet = (value: string): string => `  • ${escape(value)}`;
  const detail = (label: string, value: string): string => `  • ${bold(`${label}:`)} ${escape(value)}`;
  const tip = `${bold("Checkout tip")}\n${escape(CHECKOUT_LOGIN_REMINDER)}`;
  const message = (sections: string[], cartUrl = "") => ({
    cartUrl, text: [bold(YOINKBOT_MARKER), ...sections, tip].filter(Boolean).join("\n\n")
  });

  if (payload.eventType === "test" && payload.purpose === "connection_confirmation") {
    return message([
      [bold("Connected! Your Telegram checkout alerts are on."),
        bullet("YoinkBot will message you here when checkout is ready or needs your attention."),
        bullet("Ready alerts follow a final availability check.")].join("\n"),
      `${bold("Manage alerts")}\nYou can pause or disconnect in Yoink → Setup → Alerts.`
    ]);
  }
  const event = String(payload.eventType || "test");
  if (!["carted", "needs_you", "missed", "notify"].includes(event)) {
    return message([[bold("Test notification"), bullet("Your YoinkBot connection is working."),
      bullet("No checkout action is needed.")].join("\n")]);
  }

  const lane = Object.values(ADD_LANES).find((item) => item.id === payload.retailerId);
  const status = event === "carted" ? "Checkout checked — ready for your review"
    : event === "needs_you" ? "Checkout needs your attention"
      : event === "missed" ? "Checkout unavailable" : "Stock update";
  const title = String(payload.title || "Your item").replace(/\s+/g, " ").trim().slice(0, 250);
  const details = [lane ? detail("Store", lane.name) : "", detail("Item", title),
    Number.isSafeInteger(payload.quantity) && Number(payload.quantity) > 0 ? detail("Quantity", String(payload.quantity)) : "",
    Number.isSafeInteger(payload.unitPriceCents) && Number(payload.unitPriceCents) > 0
      ? detail("Item price", `$${(Number(payload.unitPriceCents) / 100).toFixed(2)}`) : ""].filter(Boolean).join("\n");
  const cartUrl = payload.test === true ? "" : lane?.cartUrl || "";
  const cartLabel = `Open ${lane?.name || "store"} cart →`;
  const cartLink = !cartUrl ? "" : format === "telegram" ? `<a href="${escape(cartUrl)}">${escape(cartLabel)}</a>`
    : format === "discord" ? `[${escape(cartLabel)}](${cartUrl})` : `${cartLabel}\n${cartUrl}`;
  const action = payload.test === true ? "Test alert only. No checkout action is needed."
    : event === "carted" ? "Checkout was checked on your computer. Review availability and place the order yourself."
      : event === "needs_you" ? "Open the store on your computer to finish sign-in or review the checkout issue."
        : "Check the store for current availability.";
  return message([
    `${bold(`${payload.test === true ? "TEST · " : ""}${status}`)}\n${details}`,
    `${bold("Next step")}\n${escape(action)}${cartLink ? `\n${cartLink}` : ""}`
  ], cartUrl);
}
