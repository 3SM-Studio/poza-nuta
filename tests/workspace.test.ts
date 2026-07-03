import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WORKSPACE_HANDLE,
  DEFAULT_WORKSPACE_NAME,
  isDefaultWorkspaceHandle,
} from "../src/lib/workspace.ts";

test("default workspace identity uses the public Poza Nuta handle", () => {
  assert.equal(DEFAULT_WORKSPACE_NAME, "Poza Nutą");
  assert.equal(DEFAULT_WORKSPACE_HANDLE, "pozanuta");
  assert.equal(isDefaultWorkspaceHandle("pozanuta"), true);
  assert.equal(isDefaultWorkspaceHandle("other-workspace"), false);
});
