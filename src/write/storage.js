// Image prep and draft persistence for the composer.

const MAX_IMAGE_SIDE = 2000;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

// Pasted screenshots and phone photos are often several MB; shrink them so the
// site stays quick. GIFs pass through; photos that are too big, or in a format
// the site won't serve (SVG, HEIC…), become JPEGs.
export async function prepareImage(blob) {
  if (!blob.type.startsWith("image/") || blob.type === "image/gif") {
    return blob;
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blob;
  }

  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && blob.size <= MAX_IMAGE_BYTES && SUPPORTED_TYPES.has(blob.type)) {
    bitmap.close();
    return blob;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise((resolve) => {
    canvas.toBlob((result) => resolve(result || blob), "image/jpeg", 0.86);
  });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const DB_NAME = "letter-composer";
const STORE = "drafts";
const DRAFT_KEY = "current";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export function loadDraft() {
  return withStore("readonly", (store) => store.get(DRAFT_KEY)).catch(() => null);
}

export function saveDraft(draft) {
  return withStore("readwrite", (store) => store.put(draft, DRAFT_KEY)).catch(() => {});
}

export function clearDraft() {
  return withStore("readwrite", (store) => store.delete(DRAFT_KEY)).catch(() => {});
}
