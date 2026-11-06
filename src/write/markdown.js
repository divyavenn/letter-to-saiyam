// The composer's document model (Tiptap/ProseMirror) and its markdown output.
// The ProseMirror JSON document is the source of truth; letter markdown is
// derived from it only when the letter is sent.

import { getSchema } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import StarterKit from "@tiptap/starter-kit";
import { MarkdownSerializer, defaultMarkdownSerializer } from "prosemirror-markdown";

export function safeHref(value) {
  if (/^[\s\u0000-\u001f]/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) return null;
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (/^(\/(?!\/)|#)/.test(value)) return value;
  return null;
}

// What someone types into the link field: trimmed, https:// when there's no
// scheme, and only kept if it parses as a safe URL.
export function linkUrl(value) {
  const raw = value.trim();
  if (!raw || /[\s\u0000-\u001f\u007f]/.test(raw)) return null;
  if (/^(\/(?!\/)|#)/.test(raw)) return raw;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  if (!safeHref(candidate)) return null;
  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname && !parsed.pathname) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

// Clipboard text only prefills the link field when it looks like a URL, so a
// copied sentence is left alone.
export function clipboardUrl(value) {
  const raw = value.trim();
  if (
    !/^(https?:\/\/|mailto:|tel:)/i.test(raw) &&
    !/^(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(raw)
  ) {
    return null;
  }
  return linkUrl(raw);
}

// Photos carry an id pointing at their blob in the composer; `unresolved`
// marks a pasted remote image that couldn't be copied in.
const LetterImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      imageId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-image-id"),
        renderHTML: (attrs) => (attrs.imageId ? { "data-image-id": attrs.imageId } : {}),
      },
      unresolved: {
        default: false,
        parseHTML: () => false,
        renderHTML: (attrs) => (attrs.unresolved ? { "data-unresolved": "true" } : {}),
      },
    };
  },
});

// Only what the postcard renderer can show. Underline is left out because
// the site's markdown has no syntax for it.
export const letterExtensions = () => [
  StarterKit.configure({
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    underline: false,
    gapcursor: false,
    trailingNode: false,
    link: {
      openOnClick: false,
      autolink: false,
      linkOnPaste: true,
      defaultProtocol: "https",
      isAllowedUri: (value) => safeHref(value) !== null,
      HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
    },
  }),
  LetterImage.configure({ allowBase64: true }),
];

export const letterSchema = getSchema(letterExtensions());

const base = defaultMarkdownSerializer;
const serializer = new MarkdownSerializer(
  {
    paragraph: base.nodes.paragraph,
    text: base.nodes.text,
    hardBreak: base.nodes.hard_break,
    blockquote: base.nodes.blockquote,
    listItem: base.nodes.list_item,
    bulletList(state, node) {
      state.renderList(node, "  ", () => "- ");
    },
    orderedList(state, node) {
      const start = node.attrs.start ?? 1;
      const width = String(start + node.childCount - 1).length;
      state.renderList(node, " ".repeat(width + 2), (index) => {
        const number = String(start + index);
        return `${" ".repeat(width - number.length)}${number}. `;
      });
    },
    image(state, node) {
      if (!node.attrs.src) return;
      base.nodes.image(state, node);
      state.closeBlock(node);
    },
  },
  {
    bold: base.marks.strong,
    italic: base.marks.em,
    link: base.marks.link,
    strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
  },
  {
    hardBreakNodeName: "hardBreak",
    tightLists: true,
    // The site's renderer drops raw HTML and decodes entities, and remark-gfm
    // reads a single ~ as strikethrough, so these stay literal in prose.
    escapeExtraCharacters: /(?<!\\)(?:\\\\)*[<&~]/g,
  },
);

// `imagePaths` maps each photo's imageId to its published /images/ path.
export function letterMarkdown(document, imagePaths = {}) {
  const withPaths = (node) => ({
    ...node,
    ...(node.type === "image"
      ? { attrs: { ...node.attrs, src: imagePaths[node.attrs?.imageId] ?? node.attrs?.src } }
      : {}),
    ...(node.content ? { content: node.content.map(withPaths) } : {}),
  });
  return serializer.serialize(letterSchema.nodeFromJSON(withPaths(document))).trim();
}

// The same rule as importing a letter from a Google Doc: a photo above the
// salutation is the cover on its own; otherwise the topmost photo doubles as it.
export function takeCover(document) {
  const blocks = document.content || [];
  const textOf = (node) => node.text || (node.content || []).map(textOf).join("");
  const salutation = blocks.findIndex((block) => block.type !== "image" && textOf(block).trim());
  const front = blocks.findIndex(
    (block, index) => block.type === "image" && (salutation === -1 || index < salutation),
  );
  if (front !== -1) {
    return {
      cover: blocks[front].attrs,
      inline: false,
      document: { ...document, content: blocks.filter((_, index) => index !== front) },
    };
  }

  const findImage = (node) =>
    node.type === "image" ? node : (node.content || []).map(findImage).find(Boolean);
  const first = findImage(document);
  return { cover: first?.attrs || null, inline: true, document };
}

export function buildLetter({ date, to, from, location, image, stamp }, body) {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const fields = [
    ["date", date],
    ["to", to],
    ["from", from],
    ["location", location],
    ["image", image],
    ["stamp", stamp],
  ].filter(([, value]) => clean(value));

  return [
    "---",
    ...fields.map(([key, value]) => `${key}: ${clean(value)}`),
    "---",
    "",
    body.trim(),
    "",
  ].join("\n");
}

// Plain-text paste: blank lines start paragraphs, single newlines are breaks.
export function plainTextContent(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((block) => {
      const content = [];
      block.split("\n").forEach((line, index) => {
        if (index) content.push({ type: "hardBreak" });
        if (line) content.push({ type: "text", text: line });
      });
      return { type: "paragraph", content };
    });
}

export function defaultDocument({ to, from }) {
  const paragraph = (...content) => ({ type: "paragraph", content });
  const text = (value) => ({ type: "text", text: value });
  return {
    type: "doc",
    content: [
      paragraph(text(`Dear ${to},`)),
      paragraph(),
      paragraph(text("Love,"), { type: "hardBreak" }, text(from)),
    ],
  };
}
