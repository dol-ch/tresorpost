import assert from "node:assert/strict";
import { test } from "node:test";
import { shareLinkOrigin } from "./api.ts";

test("share links keep the host you created on", () => {
  assert.equal(shareLinkOrigin("https://secret.dol.ch"), "https://secret.dol.ch");
  assert.equal(shareLinkOrigin("https://tresorpost.ch/"), "https://tresorpost.ch");
});
