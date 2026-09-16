import assert from "node:assert/strict";
import { test } from "node:test";
import { de } from "./de.ts";
import { en } from "./en.ts";
import { uk } from "./uk.ts";
import { detectLocale, interpolate } from "./detect.ts";

test("detectLocale prefers the first de/en/uk tag and otherwise German", () => {
  assert.equal(detectLocale(["fr-FR", "de-CH"]), "de");
  assert.equal(detectLocale(["en-US", "de"]), "en");
  assert.equal(detectLocale(["uk-UA"]), "uk");
  assert.equal(detectLocale(["uk", "en"]), "uk");
  assert.equal(detectLocale(["fr-CH", "it-CH"]), "de");
  assert.equal(detectLocale([]), "de");
});

test("English and Ukrainian catalogs cover every German key", () => {
  const keys = Object.keys(de);
  for (const key of keys) {
    assert.equal(typeof en[key as keyof typeof de], "string", key);
    assert.equal(typeof uk[key as keyof typeof de], "string", key);
  }
  assert.equal(Object.keys(en).length, keys.length);
  assert.equal(Object.keys(uk).length, keys.length);
});

test("interpolate fills placeholders", () => {
  assert.equal(interpolate("bis {cap}", { cap: "5 GB" }), "bis 5 GB");
});
