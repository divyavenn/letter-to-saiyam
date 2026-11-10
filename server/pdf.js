// A recipient's letters as one PDF that looks like the postcards: cream pages,
// the date and place in postmark ink, to/from in handwriting, the letter in
// typewriter type, with its photos.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { CODE_ROOT } from "./paths.js";

const FONTS = {
  type: path.join(CODE_ROOT, "public/fonts/oceanside_typewriter.ttf"),
  hand: path.join(CODE_ROOT, "public/fonts/biro_script.ttf"),
  stamp: path.join(CODE_ROOT, "public/fonts/diy.ttf"),
};
const INK = "#3c281f";
const RUST = "#7b4229";
const POSTMARK = "#2e3a6b";
const PAPER = "#faf7f0";
const MARGIN = 54;
const BODY_SIZE = 10.5;
const IMAGE_LINK = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
// Photos are re-encoded for print size, so the PDF stays a few MB rather than
// carrying every full-resolution original (those are in the zip anyway).
const PHOTO_PIXELS = 1400;

export function photoFile(root, src) {
  if (!src || /^(https?:)?\/\//.test(src) || src.startsWith("data:")) return null;
  const name = src.replace(/^\/?images\//, "").replace(/^\//, "");
  if (name.includes("..") || name.includes("/")) return null;
  return path.join(root, "public/images", name);
}

function formatDate(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return value || "";
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Flattens inline markdown into runs of text that share a style.
function inlineRuns(nodes, style = {}) {
  const runs = [];
  for (const node of nodes || []) {
    switch (node.type) {
      case "text":
        runs.push({ text: node.value, ...style });
        break;
      case "inlineCode":
        runs.push({ text: node.value, ...style });
        break;
      case "break":
        runs.push({ text: "\n", ...style });
        break;
      case "strong":
        runs.push(...inlineRuns(node.children, { ...style, bold: true }));
        break;
      case "emphasis":
        runs.push(...inlineRuns(node.children, { ...style, italic: true }));
        break;
      case "delete":
        runs.push(...inlineRuns(node.children, { ...style, strike: true }));
        break;
      case "link":
        runs.push(...inlineRuns(node.children, { ...style, link: node.url }));
        break;
      default:
        if (node.children) runs.push(...inlineRuns(node.children, style));
    }
  }
  return runs;
}

// A paragraph that's only photos (how the composer writes them) is drawn as photos.
function photosOnly(paragraph) {
  const parts = paragraph.children.filter((child) => !(child.type === "text" && !child.value.trim()));
  if (!parts.length) return null;
  const sources = parts.map((child) =>
    child.type === "image" ? child.url : child.type === "link" && IMAGE_LINK.test(child.url) ? child.url : null,
  );
  return sources.every(Boolean) ? sources : null;
}

class LetterPdf {
  constructor(root) {
    this.root = root;
    this.doc = new PDFDocument({ size: "A5", margin: MARGIN, autoFirstPage: false, info: { Creator: "Love Letters" } });
    this.doc.registerFont("type", FONTS.type);
    this.doc.registerFont("hand", FONTS.hand);
    this.doc.registerFont("stamp", FONTS.stamp);
    // Every page, including ones a long letter spills onto, is paper-coloured.
    this.doc.on("pageAdded", () => {
      const { width, height } = this.doc.page;
      this.doc.save().rect(0, 0, width, height).fill(PAPER).restore();
      this.doc.x = MARGIN;
      this.doc.y = MARGIN;
    });
  }

  get width() {
    return this.doc.page.width - MARGIN * 2;
  }

  ensureRoom(height) {
    if (this.doc.y + height > this.doc.page.height - MARGIN) this.doc.addPage();
  }

  async photo(src, maxHeight = 240) {
    const file = photoFile(this.root, src);
    if (!file) return;
    let image;
    try {
      const data = await sharp(await readFile(file), { animated: false })
        .rotate()
        .flatten({ background: PAPER })
        .resize(PHOTO_PIXELS, PHOTO_PIXELS, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      image = this.doc.openImage(data);
    } catch {
      return; // Missing or unreadable: the letter still prints without it.
    }
    const scale = Math.min(this.width / image.width, maxHeight / image.height, 1.5);
    const width = image.width * scale;
    const height = image.height * scale;
    this.ensureRoom(height + 12);
    this.doc.image(image, MARGIN + (this.width - width) / 2, this.doc.y + 4, { width, height });
    this.doc.y += height + 16;
    this.doc.x = MARGIN;
  }

  // Lays out styled text line by line. PDFKit's own wrapping goes astray when
  // the style changes mid-paragraph, so words are measured and placed here.
  runs(runs, { indent = 0, color = INK, italic = false } = {}) {
    const { doc } = this;
    const width = this.width - indent;
    const lineHeight = BODY_SIZE * 1.45;
    doc.font("type").fontSize(BODY_SIZE);
    const measure = (text) => doc.widthOfString(text);

    // Words and the spaces after them, each keeping its run's style.
    const lines = [[]];
    let used = 0;
    const place = (piece, style) => {
      const line = lines.at(-1);
      const last = line.at(-1);
      if (last && last.style === style) last.text += piece;
      else line.push({ text: piece, style });
      used += measure(piece);
    };
    for (const run of runs) {
      for (const part of run.text.split(/(\n)/)) {
        if (part === "\n") {
          lines.push([]);
          used = 0;
          continue;
        }
        for (const word of part.match(/\S+\s*|\s+/g) || []) {
          const visible = word.trimEnd();
          if (used > 0 && used + measure(visible) > width) {
            lines.push([]);
            used = 0;
            if (!visible) continue; // a space that ended a line
          }
          // A single word wider than the line is broken across lines.
          let rest = used === 0 ? word.trimStart() : word;
          while (measure(rest.trimEnd()) > width - used && rest.length > 1) {
            let cut = rest.length - 1;
            while (cut > 1 && measure(rest.slice(0, cut)) > width - used) cut -= 1;
            place(rest.slice(0, cut), run);
            lines.push([]);
            used = 0;
            rest = rest.slice(cut);
          }
          if (rest) place(rest, run);
        }
      }
    }

    for (const line of lines) {
      if (doc.y + lineHeight > doc.page.height - MARGIN) doc.addPage();
      let x = MARGIN + indent;
      const y = doc.y;
      line.forEach((segment, index) => {
        // Trailing spaces on a line are left off so underlines don't overhang.
        const text = index === line.length - 1 ? segment.text.trimEnd() : segment.text;
        if (!text) return;
        const { style } = segment;
        const linked = Boolean(style.link);
        const ink = linked ? RUST : color;
        doc.font("type").fontSize(BODY_SIZE).fillColor(ink).strokeColor(ink).lineWidth(0.35);
        const textWidth = measure(text);
        doc.text(text, x, y, {
          lineBreak: false,
          width: textWidth + 1,
          // The typewriter face has no bold or italic cuts, so they're drawn.
          stroke: Boolean(style.bold),
          fill: true,
          oblique: style.italic || italic ? 12 : false,
          strike: Boolean(style.strike),
          underline: linked,
        });
        if (linked) doc.link(x, y, textWidth, lineHeight, style.link);
        x += textWidth;
      });
      doc.y = y + lineHeight;
    }
    doc.y += BODY_SIZE * 0.85;
    doc.x = MARGIN;
  }


  async blocks(nodes, context = {}) {
    for (const node of nodes) {
      if (node.type === "paragraph" || node.type === "heading") {
        const photos = photosOnly(node);
        if (photos) {
          for (const src of photos) await this.photo(src);
          continue;
        }
        const runs = inlineRuns(node.children, node.type === "heading" ? { bold: true } : {});
        if (runs.some((run) => run.text.trim())) this.runs(runs, context);
      } else if (node.type === "blockquote") {
        await this.blocks(node.children, {
          indent: (context.indent || 0) + 16,
          color: "#6b5a50",
          italic: true,
        });
      } else if (node.type === "list") {
        let number = node.start || 1;
        for (const item of node.children) {
          const marker = node.ordered ? `${number++}. ` : "• ";
          const [first, ...rest] = item.children;
          if (first?.type === "paragraph") {
            this.runs([{ text: marker }, ...inlineRuns(first.children)], { ...context, indent: (context.indent || 0) + 8 });
          }
          await this.blocks(rest, { ...context, indent: (context.indent || 0) + 20 });
        }
      } else if (node.type === "code") {
        this.runs([{ text: node.value }], context);
      } else if (node.type === "thematicBreak") {
        this.doc.moveDown(0.5);
      }
    }
  }

  titlePage(name, letters) {
    const { doc } = this;
    doc.addPage();
    const dates = letters.map((letter) => letter.fields.date).filter(Boolean).sort();
    doc.y = doc.page.height * 0.36;
    doc.font("hand").fontSize(26).fillColor(INK).text(`Letters for ${name}`, MARGIN, undefined, { width: this.width, align: "center" });
    doc.moveDown(0.6);
    const span = dates.length
      ? dates[0] === dates.at(-1)
        ? formatDate(dates[0])
        : `${formatDate(dates[0])} – ${formatDate(dates.at(-1))}`
      : "";
    doc
      .font("stamp")
      .fontSize(8.5)
      .fillColor(POSTMARK)
      .text(`${letters.length} ${letters.length === 1 ? "LETTER" : "LETTERS"}${span ? `   ·   ${span.toUpperCase()}` : ""}`, {
        width: this.width,
        align: "center",
        characterSpacing: 0.6,
      });
  }

  async letter({ fields, body }) {
    const { doc } = this;
    doc.addPage();
    if (fields.image) await this.photo(fields.image, 210);

    // Postmark details on the left, the address on the right, as on the card.
    const top = doc.y;
    doc.font("stamp").fontSize(8).fillColor(POSTMARK).text(formatDate(fields.date), MARGIN, top, { width: this.width * 0.5 });
    if (fields.location) {
      doc.font("stamp").fontSize(7).text(fields.location.toUpperCase(), { width: this.width * 0.5, characterSpacing: 0.4 });
    }
    const leftBottom = doc.y;
    doc.y = top;
    const address = [fields.to && `to ${fields.to}`, fields.from && `from ${fields.from}`].filter(Boolean);
    address.forEach((line, index) => {
      doc
        .font("hand")
        .fontSize(index === 0 ? 14 : 12)
        .fillColor("#2f2620")
        .text(line, MARGIN + this.width * 0.5, index === 0 ? top - 2 : undefined, { width: this.width * 0.5, align: "right" });
    });
    doc.y = Math.max(leftBottom, doc.y) + 18;
    doc.x = MARGIN;

    const tree = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
    await this.blocks(tree.children);
  }
}

// letters: [{ fields, body }], oldest first. Resolves with the PDF's bytes.
export async function lettersPdf(root, name, letters) {
  const pdf = new LetterPdf(root);
  const chunks = [];
  pdf.doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    pdf.doc.on("end", resolve);
    pdf.doc.on("error", reject);
  });
  pdf.titlePage(name, letters);
  for (const letter of letters) await pdf.letter(letter);
  pdf.doc.end();
  await done;
  return Buffer.concat(chunks);
}
