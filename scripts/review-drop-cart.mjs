#!/usr/bin/env node
// Operator evidence review only: no networking, app writes, browser or cart actions.
import { readFile } from "node:fs/promises";
import { reviewDropCart } from "../packages/domain/src/drop-cart-review.ts";

const [path, ...extra] = process.argv.slice(2);
if (!path || extra.length) {
  console.error("Usage: node --import tsx scripts/review-drop-cart.mjs <review.json>");
  process.exitCode = 2;
} else {
  try {
    const bytes = await readFile(path);
    if (bytes.length > 64 * 1024) throw new Error("Review file exceeds 64 KiB.");
    const review = reviewDropCart(JSON.parse(bytes.toString("utf8")));
    console.log(JSON.stringify(review, null, 2));
    process.exitCode = review.status === "needs_review" ? 2 : 0;
  } catch {
    console.error("Review could not be read. Supply a valid bounded JSON evidence file.");
    process.exitCode = 2;
  }
}
