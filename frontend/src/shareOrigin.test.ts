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
  assert.equal(
    mintShareUrl("https://tresorpost.ch", "abcdefghijkl", "KEYKEYKEYKEYKEYK"),
    "https://tresorpost.ch/#/v/abcdefghijkl/KEYKEYKEYKEYKEYK",
  );
});
