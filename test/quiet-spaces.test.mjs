// Tests for the quiet-spaces avatar letter color: `node --test test/`.

import test from "node:test";
import assert from "node:assert/strict";
import { letterColor, contrast } from "../mods/quiet-spaces/contrast.js";

const MARK = ["#22a99a", "#e3814f", "#5b8def", "#8b7cf6", "#3fae6a", "#d9649a"];

test("every mark color keeps the dark letter", () => {
  for (const c of MARK) assert.equal(letterColor(c), "#18181b", c);
});

test("a dark custom color gets the white letter", () => {
  assert.equal(letterColor("#1e3a8a"), "#ffffff");
  assert.equal(letterColor("#18181b"), "#ffffff");
});

test("a light custom color gets the dark letter", () => {
  assert.equal(letterColor("#fde68a"), "#18181b");
  assert.equal(letterColor("#ffffff"), "#18181b");
});

test("an alpha suffix is ignored and a value that is not hex falls back to dark", () => {
  assert.equal(letterColor("#1e3a8aff"), "#ffffff");
  assert.equal(letterColor(undefined), "#18181b");
  assert.equal(letterColor("red"), "#18181b");
});

test("contrast follows WCAG", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrast("#696973", "#ececef").toFixed(2), "4.60");
});
