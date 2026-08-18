import assert from "node:assert/strict";
import { test } from "node:test";
import { routes } from "@/lib/routes";

test("route helpers build canonical training paths", () => {
  assert.equal(routes.week(11), "/weeks/11");
  assert.equal(routes.day(11, 21), "/weeks/11/days/21");
  assert.equal(routes.session(11, 21, 31), "/weeks/11/days/21/sessions/31");
  assert.equal(routes.sessionComplete(11, 21, 31), "/weeks/11/days/21/sessions/31/complete");
  assert.equal(routes.historySession(31), "/history/sessions/31");
  assert.equal(routes.recovery(21), "/recovery?planDayId=21");
  assert.equal(routes.weekNext(), "/week/next");
});
