import assert from "node:assert/strict";
import { test } from "node:test";
import { mintDeleteUrl, mintShareUrl, shareLinkOrigin } from "./api.ts";

test("share and delete links stay on the current origin", () => {
  assert.equal(shareLinkOrigin("https://secret.dol.ch"), "https://secret.dol.ch");
  assert.equal(shareLinkOrigin("https://tresorpost.ch/"), "https://tresorpost.ch");
  assert.equal(
    mintShareUrl("https://secret.dol.ch", "abcdefghijkl", "KEYKEYKEYKEYKEYK"),
    "https://secret.dol.ch/#/v/abcdefghijkl/KEYKEYKEYKEYKEYK",
  );
  assert.equal(
    mintShareUrl(
      "https://secret.dol.ch/",
      "abcdefghijkl",
      "KEYKEYKEYKEYKEYK",
      "recvTokrecvTok",
    ),
    "https://secret.dol.ch/#/v/abcdefghijkl/KEYKEYKEYKEYKEYK/recvTokrecvTok",
  );
  assert.equal(
    mintDeleteUrl("https://secret.dol.ch", "abcdefghijkl", "delTokendelToken"),
    "https://secret.dol.ch/#/d/abcdefghijkl/delTokendelToken",
  );
});

test("mint helpers take only the page origin, not config origins", () => {
  assert.equal(shareLinkOrigin.length, 1);
  assert.equal(mintDeleteUrl.length, 3);
  assert.equal(mintShareUrl.length, 3);
});
