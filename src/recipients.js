// Who a letter is for, as the slug of their page (/saiyam, /sidd, …).
// Shared by the server, the stack and the composer so they agree.

// Paths the site itself uses, which can't double as someone's page.
const RESERVED = new Set([
  "api", "assets", "favicon.svg", "fonts", "healthz", "images", "index.html", "sounds", "textures", "write",
]);

// "Ranju P." → "ranju-p"
export function recipientSlug(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // drop accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function isRecipientSlug(slug) {
  return (
    typeof slug === "string" &&
    slug.length <= 40 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) &&
    !RESERVED.has(slug)
  );
}
