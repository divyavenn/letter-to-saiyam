import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { prepareWithSegments } from "@chenglou/pretext";
import { addressRowRight, layoutAddress } from "./address-layout.js";

// Exercise Pretext's real line breaker with deterministic font measurements.
// Browser rendering still needs verification with the loaded Biro Script font.
globalThis.OffscreenCanvas = class {
  getContext() {
    return {
      font: "16px serif",
      measureText(text) {
        const size = Number(this.font.match(/([\d.]+)px/)[1]);
        return { width: [...text].reduce((sum, char) => sum + size * (char === " " ? 0.28 : char === "W" ? 0.9 : 0.52), 0) };
      },
    };
  }
};

function paragraphs(to, from, fontSize = 16) {
  return [to && `to ${to}`, from && `from ${from}`].filter(Boolean).map((text, index) => ({
    text,
    kind: index ? "from" : "to",
    fontSize,
    lineHeight: Math.ceil(fontSize * 1.2),
    prepared: prepareWithSegments(text, `${fontSize}px "Biro Script"`),
  }));
}

function stamp(width, round = false, angle = 2) {
  return {
    left: width - 76, top: 3, width: 72, height: 82, angle,
    contour: Array.from({ length: 128 }, (_, row) => {
      const y = row / 127;
      const half = round ? Math.sqrt(Math.max(0, 0.25 - (y - 0.5) ** 2)) : 0.5;
      return { y, left: 0.5 - half, right: 0.5 + half };
    }),
  };
}

function assertLayout(source, width, stamps) {
  const layout = layoutAddress(source, width, stamps);
  const stripSpaces = (text) => text.replace(/\s/g, "");
  assert.equal(stripSpaces(layout.lines.map((line) => line.text).join("")), stripSpaces(source.map((p) => p.text).join("")));
  assert.equal(new Set(layout.lines.map((line) => line.left)).size, source.length ? 1 : 0);
  for (const line of layout.lines) {
    assert.ok(line.width <= line.available + 0.01, `line too wide: ${line.text}`);
    assert.ok(line.left >= 0);
    assert.ok(line.left + line.width <= width + 0.01);
    assert.ok(line.top + line.lineHeight <= layout.height);
    assert.ok(line.left + line.width <= addressRowRight(width, stamps, line.top, line.lineHeight) + 0.01);
  }
  return layout;
}

test("every letter's address fits mobile and desktop widths without losing text", () => {
  for (const file of readdirSync(new URL("./letters/", import.meta.url))) {
    const source = readFileSync(new URL(`./letters/${file}`, import.meta.url), "utf8");
    const to = source.match(/^to:\s*(.*)$/m)?.[1];
    const from = source.match(/^from:\s*(.*)$/m)?.[1];
    for (const width of [132, 160, 178, 220, 270]) {
      for (const fontSize of [15, 30]) {
        assertLayout(paragraphs(to, from, fontSize), width, [stamp(width)]);
      }
    }
  }
});

test("rows follow the round stamp contour and regain the full width below it", () => {
  const width = 200;
  const shape = stamp(width, true, 0);
  assert.ok(addressRowRight(width, [shape], 68, 10) > addressRowRight(width, [shape], 36, 10));
  assert.equal(addressRowRight(width, [shape], 100, 20), width);
  const layout = assertLayout(paragraphs("Saiyam", "a very long address that needs several lines around the stamp"), width, [shape]);
  assert.ok(layout.lines.some((line) => line.top < shape.top + shape.height));
  assert.ok(layout.lines.some((line) => line.top > shape.top + shape.height));
  assert.ok(new Set(layout.lines.map((line) => line.available)).size > 1);
});

test("long unbroken names and Unicode text wrap rather than overflow", () => {
  const source = paragraphs("WWWWWWWWWWWWWWWWWWWW", "Saiyam’s 世界 👋🏽 family and friends");
  assertLayout(source, 120, [stamp(120)]);
});

test("multiple overlapping stamps all constrain the address", () => {
  const width = 180;
  const shapes = [stamp(width, true, 2), { ...stamp(width, false, -3), left: 75, top: 8 }];
  assertLayout(paragraphs("a long-suffering man", "a weasel in bogota"), width, shapes);
});

test("missing stamps or either address field still produce a complete address", () => {
  assertLayout(paragraphs("Saiyam", ""), 160, []);
  assertLayout(paragraphs("", "Divya"), 160, []);
  assert.deepEqual(layoutAddress([], 160, []), { lines: [], height: 0 });
  assert.ok(layoutAddress([], 160, [stamp(160)]).height > 82);
});
