import { test } from "node:test";
import assert from "node:assert/strict";
import { kindFromFile } from "./payloadKind.ts";

function fakeFile(name: string, type: string): File {
  return new File([new Uint8Array([1])], name, { type });
}

test("kindFromFile prefers MIME over the filename", () => {
  assert.equal(kindFromFile(fakeFile("clip.bin", "video/mp4")), "video");
  assert.equal(kindFromFile(fakeFile("photo.bin", "image/png")), "image");
  assert.equal(kindFromFile(fakeFile("notes.png", "application/pdf")), "file");
});

test("kindFromFile falls back to the filename when MIME is empty", () => {
  assert.equal(kindFromFile(fakeFile("holiday.mov", "")), "video");
  assert.equal(kindFromFile(fakeFile("shot.heic", "")), "image");
  assert.equal(kindFromFile(fakeFile("secret.zip", "")), "file");
  assert.equal(kindFromFile(fakeFile("clip.mp4", "application/octet-stream")), "video");
});
