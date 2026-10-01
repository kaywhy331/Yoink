import type { YoinkDatabase } from "../../packages/database/src/database.js";

/**
 * Calls no longer create plans unless the shopper opted in (plans_from_calls,
 * off by default since migration 71). Tests that exercise a call creating its
 * own plan opt every existing user in explicitly with this helper.
 */
export function enablePlansFromCalls(db: YoinkDatabase): void {
  db.run("UPDATE app_settings SET plans_from_calls = 1");
}
