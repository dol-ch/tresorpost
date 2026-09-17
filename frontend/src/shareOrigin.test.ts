import assert from "node:assert/strict";
import { test } from "node:test";
import { shareLinkOrigin } from "./api.ts";

test("share links use PUBLIC_URL, not a short host", () => {
  assert.equal(
    shareLinkOrigin({ public_origin: "https://tresorpost.ch/" }, "https://tpst.ch"),
    "https://tresorpost.ch",
  );
  assert.equal(
    shareLinkOrigin({}, "https://tresorpost.ch"),
    "https://tresorpost.ch",
  );
});
