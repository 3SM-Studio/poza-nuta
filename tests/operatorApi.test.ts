import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionToken,
  hashPin,
  hashSessionToken,
  verifyPin,
} from "../server/operator-api/crypto.ts";
import {
  canApplyQueueAction,
  getTargetStatus,
} from "../server/operator-api/transitions.ts";
import {
  validateLoginInput,
  validateRequestId,
} from "../server/operator-api/validation.ts";

test("hashPin and verifyPin accept only the original PIN", async () => {
  const encodedHash = await hashPin("4826");

  assert.notEqual(encodedHash, "4826");
  assert.equal(await verifyPin("4826", encodedHash), true);
  assert.equal(await verifyPin("4827", encodedHash), false);
  assert.equal(await verifyPin("4826", "not-a-valid-hash"), false);
});

test("session tokens are random and stored through a one-way hash", () => {
  const firstToken = createSessionToken();
  const secondToken = createSessionToken();
  const firstHash = hashSessionToken(firstToken);

  assert.notEqual(firstToken, secondToken);
  assert.notEqual(firstHash, firstToken);
  assert.equal(firstHash, hashSessionToken(firstToken));
});

test("validateLoginInput trims a name but preserves the PIN exactly", () => {
  assert.deepEqual(
    validateLoginInput({
      name: "  Operator  ",
      pin: " 1234 ",
    }),
    {
      success: true,
      data: {
        name: "Operator",
        pin: " 1234 ",
      },
    },
  );
});

test("validateLoginInput rejects malformed and short credentials", () => {
  const result = validateLoginInput({
    name: "",
    pin: "123",
  });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.success ? [] : result.issues.map((issue) => issue.field),
    ["name", "pin"],
  );
});

test("validateRequestId accepts only safe positive integer path values", () => {
  assert.deepEqual(validateRequestId("42"), {
    success: true,
    data: 42,
  });
  assert.equal(validateRequestId("0").success, false);
  assert.equal(validateRequestId("1.5").success, false);
  assert.equal(validateRequestId("abc").success, false);
});

test("operator queue transition policy matches the API contract", () => {
  assert.equal(canApplyQueueAction("approve", "pending"), true);
  assert.equal(canApplyQueueAction("approve", "approved"), false);
  assert.equal(canApplyQueueAction("reject", "pending"), true);
  assert.equal(canApplyQueueAction("reject", "approved"), true);
  assert.equal(canApplyQueueAction("start", "approved"), true);
  assert.equal(canApplyQueueAction("done", "now"), true);
  assert.equal(canApplyQueueAction("skip", "approved"), true);
  assert.equal(canApplyQueueAction("skip", "now"), true);
  assert.equal(canApplyQueueAction("skip", "pending"), false);

  assert.equal(getTargetStatus("approve"), "approved");
  assert.equal(getTargetStatus("reject"), "rejected");
  assert.equal(getTargetStatus("start"), "now");
  assert.equal(getTargetStatus("done"), "done");
  assert.equal(getTargetStatus("skip"), "skipped");
});
