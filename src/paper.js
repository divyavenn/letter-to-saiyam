// Styles shared by the postcard stack and the /write composer, so a letter
// looks the same while it's being written as when it's read.
import { css } from "styled-components";

const stampFiles = import.meta.glob("./stamps/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

export const STAMP_LIBRARY = Object.entries(stampFiles)
  .map(([path, src]) => ({
    name: path.split("/").pop(),
    src,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const POSTCARD_IMPRINT =
  "GENUINE POST CARD ISSUED BY D. VENN, FROWNED UPON BY UNCLE SAM, NO POSTAGE REQ.";

export const fontFaces = css`
  @font-face {
    font-family: "Biro Script";
    src:
      url("/fonts/biro_script.woff2") format("woff2"),
      url("/fonts/biro_script.ttf") format("truetype");
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }

  @font-face {
    font-family: "Oceanside Typewriter";
    src:
      url("/fonts/oceanside_typewriter.woff2") format("woff2"),
      url("/fonts/oceanside_typewriter.ttf") format("truetype");
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }

  @font-face {
    font-family: "Mom Typewriter";
    src:
      url("/fonts/mom_typewriter.woff2") format("woff2"),
      url("/fonts/mom_typewriter.ttf") format("truetype");
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }

  @font-face {
    font-family: "DIY";
    src:
      url("/fonts/diy.woff2") format("woff2"),
      url("/fonts/diy.ttf") format("truetype");
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }
`;

// The back of a postcard: cream paper with a faint grunge overlay (::before).
export const paperBack = css`
  background:
    url("/textures/cream-paper.png"),
    url("/textures/textured-paper.png"),
    #faf7f0;
  background-size: auto, 500px 500px, auto;
  background-blend-mode: multiply, soft-light, normal;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background:
      url("/textures/subtle-grunge.png"),
      linear-gradient(90deg, rgba(94, 57, 36, 0.1), transparent 18% 82%, rgba(94, 57, 36, 0.12));
    background-blend-mode: multiply;
    opacity: 0.32;
  }
`;

export const mobilePaperShadow = css`
  box-shadow:
    0 8px 18px rgba(20, 12, 8, 0.24),
    0 2px 4px rgba(20, 12, 8, 0.16),
    inset 0 1.5px 0 rgba(255, 255, 255, 0.85),
    inset 0 -1.5px 0 rgba(60, 38, 22, 0.2);
`;

// Where the mobile letter text starts inside the paper.
export const mobileLetterInsets = css`
  --mobile-letter-inset-y: clamp(28px, 7vw, 40px);
  --mobile-letter-inset-x: clamp(32px, 9vw, 48px);
`;

// The blue rubber-stamp ink used for the date, location and imprints.
export const postmarkInk = css`
  color: rgba(46, 58, 107, 0.9);
  font-family: "DIY", "Courier New", monospace;
`;

export const imprintText = css`
  ${postmarkInk}
  font-size: clamp(0.4rem, 0.78vw, 0.52rem);
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

export const mobilePostdate = css`
  ${postmarkInk}
  margin: 2px 0 18px;
  text-align: left;
  font-size: 0.64rem;
  line-height: 1.4;
  letter-spacing: 0.02em;
`;

// Ink sits in the paper rather than on top of it.
export const letterInk = css`
  opacity: 0.85;
  mix-blend-mode: multiply;
`;

// letterText without the ink, for layouts that apply it piece by piece.
export const letterType = css`
  color: #3c281f;
  font-family: "Oceanside Typewriter", "Courier New", ui-monospace, monospace;
  font-size: clamp(0.82rem, 1.7vw, 1rem);
  line-height: 1.45;

  p,
  ul,
  ol,
  blockquote {
    margin: 0 0 0.9em;
  }

  strong {
    color: #2d1d17;
  }

  blockquote {
    padding-left: 16px;
    color: rgba(60, 40, 31, 0.72);
    font-style: italic;
  }

  a {
    color: #7b4229;
    text-decoration-thickness: 1px;
    text-underline-offset: 0.18em;
  }
`;

export const letterText = css`
  ${letterType}
  ${letterInk}
`;

export const mobileLetterText = css`
  font-size: clamp(0.82rem, 3.4vw, 1rem);
  line-height: 1.5;
`;

export const mediaImage = css`
  display: block;
  width: min(100%, 420px);
  max-height: 360px;
  margin: 1.2rem auto;
  object-fit: contain;
  background: rgba(239, 231, 214, 0.7);
  border-radius: 6px;
  filter: sepia(0.08) saturate(0.9);
  box-shadow:
    0 10px 18px rgba(72, 43, 29, 0.16),
    inset 0 0 0 1px rgba(72, 43, 29, 0.08);
`;

export const mobileLetterBody = css`
  position: relative;
  z-index: 2;
  /* Include the upper/right paper margin in the scroller so postage isn't clipped. */
  margin: calc(8px - var(--mobile-letter-inset-y))
    calc(8px - var(--mobile-letter-inset-x)) 0 0;
  padding: calc(var(--mobile-letter-inset-y) - 6px)
    calc(var(--mobile-letter-inset-x) - 6px) 14px 0;
  overflow-wrap: anywhere;

  /* Keep Markdown in this flow so paragraphs widen as they pass the address. */
  img,
  video,
  hr {
    clear: both;
  }
`;

// The stamp and address float top-right so the letter wraps around them.
export const mobileAddressFloat = css`
  --postage-outset: calc(var(--mobile-letter-inset-x) - 6px);
  float: right;
  width: calc(58% + var(--postage-outset));
  max-width: calc(228px + var(--postage-outset));
  margin: calc(6px - var(--mobile-letter-inset-y))
    calc(0px - var(--postage-outset)) 8px 6px;
`;
