import assert from "node:assert/strict";
import test from "node:test";

import { hashPin, verifyPin } from "../server/operator-api/crypto.ts";
import {
  mapSupabaseLoginError,
  resolveOperatorAccess,
} from "../server/operator-api/auth-policy.ts";
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

test("validateLoginInput normalizes email but preserves password exactly", () => {
  assert.deepEqual(
    validateLoginInput({
      email: "  OPERATOR@example.com  ",
      password: " secret password ",
    }),
    {
      success: true,
      data: {
        email: "operator@example.com",
        password: " secret password ",
      },
    },
  );
});

test("validateLoginInput rejects malformed email and short password", () => {
  const result = validateLoginInput({
    email: "not-an-email",
    password: "123",
  });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.success ? [] : result.issues.map((issue) => issue.field),
    ["email", "password"],
  );
});

test("Supabase login errors are mapped to safe API errors", () => {
  assert.deepEqual(mapSupabaseLoginError({ code: "invalid_credentials" }), {
    status: 401,
    code: "INVALID_CREDENTIALS",
    message: "The email address or password is incorrect.",
  });
  assert.equal(
    mapSupabaseLoginError({ code: "over_request_rate_limit" }).status,
    429,
  );
  assert.equal(mapSupabaseLoginError({ status: 503 }).status, 500);
});

test("Supabase Auth users must map to an active local operator", () => {
  const unauthenticated = resolveOperatorAccess(null, null);
  const unlinked = resolveOperatorAccess(
    "62e01318-1043-48a1-93de-d3f0469545c6",
    null,
  );

  assert.equal(unauthenticated.allowed, false);
  assert.equal(unauthenticated.allowed ? null : unauthenticated.status, 401);
  assert.equal(unlinked.allowed, false);
  assert.equal(unlinked.allowed ? null : unlinked.status, 403);
  assert.deepEqual(
    resolveOperatorAccess("62e01318-1043-48a1-93de-d3f0469545c6", {
      id: 7,
      name: "Operator",
      active: false,
    }),
    {
      allowed: false,
      status: 403,
      code: "OPERATOR_INACTIVE",
      message: "This operator account is inactive.",
    },
  );
  assert.deepEqual(
    resolveOperatorAccess("62e01318-1043-48a1-93de-d3f0469545c6", {
      id: 7,
      name: "Operator",
      active: true,
    }),
    {
      allowed: true,
      operator: {
        id: 7,
        name: "Operator",
        active: true,
      },
    },
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
