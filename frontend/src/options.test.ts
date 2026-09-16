import assert from "node:assert/strict";
import { test } from "node:test";
import { humanSize, uploadMaxBytes, MAX_FILE_BYTES } from "./options.ts";

test("humanSize trims trailing zeros so 5 GB reads as 5 GB", () => {
  assert.equal(humanSize(5 * 1024 * 1024), "5 MB");
  assert.equal(humanSize(5120 * 1024 * 1024), "5 GB");
  assert.equal(humanSize(1536), "1.5 KB");
});

test("uploadMaxBytes prefers S3 when the operator enabled it", () => {
  assert.equal(uploadMaxBytes(true, 5120 * 1024 * 1024, MAX_FILE_BYTES), 5120 * 1024 * 1024);
  assert.equal(uploadMaxBytes(false, 5120 * 1024 * 1024, MAX_FILE_BYTES), MAX_FILE_BYTES);
  assert.equal(uploadMaxBytes(true, 0, MAX_FILE_BYTES), MAX_FILE_BYTES);
});
