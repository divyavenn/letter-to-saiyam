import React from "react";

// Small line icons shared by the stack and the composer.

export function DownloadIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2v8m0 0 3.2-3.2M8 10 4.8 6.8M3 13h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// A folded paper plane in two reds: the near wing catches the light in rust,
// the far wing and the fold underneath sit in shadow.
export function PaperPlaneIcon({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M29 3 3.5 13.2l8.6 3.6L29 3Z" fill="#b5532f" />
      <path d="M29 3 12.1 16.8l5.2 11.9L29 3Z" fill="#7a1422" />
      <path d="m12.1 16.8.9 7.6 4.3.3-5.2-7.9Z" fill="#561019" />
      <path d="M29 3 12.1 16.8" stroke="#f3d9c6" strokeOpacity=".55" strokeWidth=".7" strokeLinecap="round" />
    </svg>
  );
}
