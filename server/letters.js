// Turns a letter sent from the composer into the files that get committed:
// one markdown file per letter and its photos. Pure, so it's easy to test.
import { randomBytes } from "node:crypto";
import { isRecipientSlug, recipientSlug } from "../src/recipients.js";
import { buildLetter, letterMarkdown, takeCover } from "../src/write/markdown.js";

export { isRecipientSlug, recipientSlug };

const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export class LetterError extends Error {
  status = 400;
}

export function isLetterDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function imageIds(node, found = []) {
  if (node?.type === "image") found.push(node.attrs?.imageId);
  for (const child of node?.content || []) imageIds(child, found);
  return found;
}

const text = (value, max = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// Checks what the composer sent; anything off becomes a LetterError (400).
export function readLetterRequest(body, stampNames) {
  const recipient = recipientSlug(body?.recipient);
  if (!isRecipientSlug(recipient)) throw new LetterError("Choose who the letter is for.");
  const fields = body?.fields || {};
  if (!isLetterDate(fields.date)) throw new LetterError("That date doesn't look right.");
  const stamp = stampNames.includes(fields.stamp) ? fields.stamp : "";
  const document = body?.document;
  if (document?.type !== "doc" || !Array.isArray(document.content)) throw new LetterError("The letter is empty.");
  const images = body?.images && typeof body.images === "object" ? body.images : {};
  return {
    recipient,
    fields: { date: fields.date, to: text(fields.to), from: text(fields.from), location: text(fields.location), stamp },
    document,
    images,
  };
}

// `slug` is the letter's file name (its date, or date-2 for a second that day).
// `nonce` keeps photo names from being guessed from the recipient and date.
export function letterFiles({ recipient, slug, fields, document, images }, nonce = randomBytes(3).toString("hex")) {
  const { cover, inline, document: body } = takeCover(document);
  if (!cover?.imageId) throw new LetterError("Paste in a photo. The topmost one goes on the front of the postcard.");

  const files = [];
  const base = `letter-${recipient}-${slug}-${nonce}`;
  const add = (imageId, suffix) => {
    const image = images[imageId];
    const extension = IMAGE_TYPES[image?.type];
    if (!image || !extension || typeof image.data !== "string") {
      throw new LetterError("One of the photos didn't come through. Try pasting it again.");
    }
    const content = Buffer.from(image.data, "base64");
    if (!content.length || content.length > MAX_IMAGE_BYTES) throw new LetterError("One of the photos is too large.");
    const name = `${base}-${suffix}.${extension}`;
    files.push({ path: `public/images/${name}`, content });
    return name;
  };

  if (!inline) add(cover.imageId, "cover");
  const imagePaths = {};
  let count = 0;
  for (const imageId of imageIds(body)) {
    if (!imageId) throw new LetterError("One of the photos didn't come through. Try pasting it again.");
    if (imagePaths[imageId]) continue;
    count += 1;
    imagePaths[imageId] = `/images/${add(imageId, count)}`;
  }
  const image = inline ? imagePaths[cover.imageId].replace(/^\/images\//, "") : files[0].path.split("/").pop();

  let markdownBody;
  try {
    markdownBody = letterMarkdown(body, imagePaths);
  } catch {
    throw new LetterError("The letter couldn't be read. Try copying it into a fresh page.");
  }
  if (!markdownBody.trim()) throw new LetterError("The letter is empty.");
  const markdown = buildLetter({ ...fields, image }, markdownBody);
  files.push({ path: `src/letters/${recipient}/${slug}.md`, content: Buffer.from(markdown) });
  return { files, markdown };
}

export function letterMessage(recipient, date) {
  const [year, month, day] = date.split("-").map(Number);
  const when = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Add ${when} letter for ${recipient}`;
}
