import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLetter,
  clipboardUrl,
  defaultDocument,
  letterMarkdown,
  linkUrl,
  plainTextContent,
  safeHref,
  takeCover,
} from "./markdown.js";

const text = (value, ...marks) => ({
  type: "text",
  text: value,
  ...(marks.length ? { marks: marks.map((mark) => (typeof mark === "string" ? { type: mark } : mark)) } : {}),
});
const p = (...content) => ({ type: "paragraph", content });
const doc = (...content) => ({ type: "doc", content });
const md = (...content) => letterMarkdown(doc(...content));

test("the default letter keeps its sign-off on two lines", () => {
  assert.equal(letterMarkdown(defaultDocument({ to: "Saiyam", from: "Divya" })), "Dear Saiyam,\n\nLove,\\\nDivya");
});

test("bold, italic, strike and links", () => {
  assert.equal(
    md(p(
      text("I "), text("really", "bold"), text(" "), text("do", "italic"), text(" "),
      text("not", "strike"), text(" love "),
      text("this song", { type: "link", attrs: { href: "https://example.com/a(b)" } }),
    )),
    "I **really** *do* ~~not~~ love [this song](https://example.com/a\\(b\\))",
  );
});

test("whitespace is pushed outside of marks", () => {
  assert.equal(md(p(text("a"), text(" bold ", "bold"), text("b"))), "a **bold** b");
  assert.equal(md(p(text("a"), text(" gone ", "strike"), text("b"))), "a ~~gone~~ b");
});

test("literal markdown, HTML and entities in prose survive", () => {
  assert.equal(
    md(p(text("**stars** <b>tag</b> &amp; ~tilde~ [x] _y_"))),
    "\\*\\*stars\\*\\* \\<b>tag\\</b> \\&amp; \\~tilde\\~ \\[x\\] \\_y\\_",
  );
  assert.equal(md(p(text("- not a list")), p(text("1. nor this")), p(text("# nor this"))), "\\- not a list\n\n1\\. nor this\n\n\\# nor this");
});

test("photos use their published paths", () => {
  const document = doc(p(text("Look:")), { type: "image", attrs: { src: "blob:x", alt: "Us", imageId: "a" } });
  assert.equal(letterMarkdown(document, { a: "/images/letter-1.jpg" }), "Look:\n\n![Us](/images/letter-1.jpg)");
});

test("quotes and lists", () => {
  const li = (value) => ({ type: "listItem", content: [p(text(value))] });
  assert.equal(
    md(
      { type: "blockquote", content: [p(text("one"), { type: "hardBreak" }, text("two"))] },
      { type: "bulletList", content: [li("tea"), li("roses")] },
      { type: "orderedList", attrs: { start: 1 }, content: [li("first")] },
    ),
    "> one\\\n> two\n\n- tea\n- roses\n\n1. first",
  );
});

test("empty paragraphs disappear", () => {
  assert.equal(md(p(text("a")), p(), p(text("b"))), "a\n\nb");
});

test("plain-text paste: blank lines are paragraphs, newlines are breaks", () => {
  assert.deepEqual(plainTextContent("one\ntwo\n\nthree"), [
    p(text("one"), { type: "hardBreak" }, text("two")),
    p(text("three")),
  ]);
});

test("only safe links are allowed", () => {
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,x"), null);
  assert.equal(safeHref(" https://x.com"), null);
  assert.equal(safeHref("//evil.com"), null);
  assert.equal(safeHref("/images/a.png"), "/images/a.png");
  assert.equal(linkUrl("youtube.com/watch?v=x"), "https://youtube.com/watch?v=x");
  assert.equal(linkUrl("two words"), null);
  assert.equal(linkUrl("javascript:alert(1)"), null);
  assert.equal(clipboardUrl("Remember to call me"), null);
  assert.equal(clipboardUrl("glenkeane.com/films"), "https://glenkeane.com/films");
});

test("letter frontmatter skips blank fields", () => {
  assert.equal(
    buildLetter({ date: "2026-11-05", to: "Saiyam", from: "Divya", location: " ", image: "c.png", stamp: "japan-mark.svg" }, "Hi\n"),
    "---\ndate: 2026-11-05\nto: Saiyam\nfrom: Divya\nimage: c.png\nstamp: japan-mark.svg\n---\n\nHi\n",
  );
});

test("a photo above the salutation is the cover alone", () => {
  const photo = (id) => ({ type: "image", attrs: { imageId: id } });
  const letter = doc(photo("front"), p(text("Dear Saiyam,")), photo("inside"));
  const { cover, inline, document } = takeCover(letter);
  assert.equal(cover.imageId, "front");
  assert.equal(inline, false);
  assert.deepEqual(document.content.map((node) => node.attrs?.imageId ?? node.type), ["paragraph", "inside"]);
});

test("otherwise the topmost photo doubles as the cover", () => {
  const photo = (id) => ({ type: "image", attrs: { imageId: id } });
  const letter = doc(p(), p(text("Dear Saiyam,")), { type: "blockquote", content: [photo("quoted")] }, photo("later"));
  const { cover, inline, document } = takeCover(letter);
  assert.equal(cover.imageId, "quoted");
  assert.equal(inline, true);
  assert.equal(document, letter);
  assert.equal(takeCover(doc(p(text("no photos")))).cover, null);
});
