import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { prepareWithSegments } from "@chenglou/pretext";
import styled, { css, keyframes } from "styled-components";
import { layoutAddress } from "./address-layout.js";
import InlineField from "./InlineField.jsx";

const FONT_FAMILY = '"Biro Script", "Segoe Print", cursive';
const stampCache = new Map();
const clamp = (min, value, max) => Math.max(min, Math.min(max, value));
const rectangleContour = Array.from({ length: 128 }, (_, row) => ({
  y: row / 127, left: 0, right: 1,
}));

function readStamp(image) {
  const key = image.currentSrc || image.src;
  if (stampCache.has(key)) return stampCache.get(key);
  const ratio = image.naturalWidth / image.naturalHeight || 1;
  let contour = rectangleContour;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = clamp(32, Math.round(128 / ratio), 256);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const rows = [];
    for (let y = 0; y < canvas.height; y += 1) {
      let left = canvas.width;
      let right = -1;
      for (let x = 0; x < canvas.width; x += 1) {
        const pixel = (y * canvas.width + x) * 4;
        // White disappears into the paper under multiply blending, just like transparency.
        const ink = (data[pixel + 3] / 255) * (255 - Math.min(data[pixel], data[pixel + 1], data[pixel + 2]));
        if (ink > 24) {
          left = Math.min(left, x);
          right = x;
        }
      }
      if (right >= left) rows.push({ y: (y + 0.5) / canvas.height, left: left / 128, right: (right + 1) / 128 });
    }
    if (rows.length) contour = rows;
  } catch {
    // Cross-origin images may render without allowing pixel reads. Their box is a safe obstacle.
  }
  const asset = { ratio, contour };
  stampCache.set(key, asset);
  return asset;
}

// With onEdit, each address line can be clicked and retyped where it's printed.
// postmark: an image URL that cancels the first stamp (shown once a letter is sent).
export default function PostageAddress({ postcard, isMobile, className, onClick, onStampClick, onEdit, postmark }) {
  const host = useRef(null);
  const [metrics, setMetrics] = useState(null);
  const [assets, setAssets] = useState({});
  const [prepared, setPrepared] = useState(null);
  const [editing, setEditing] = useState(null);
  const editable = Boolean(onEdit);

  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const viewport = window.innerWidth;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const next = {
        width: host.current.clientWidth,
        toSize: Math.round(isMobile ? clamp(0.9 * rem, viewport * 0.04, 1.05 * rem) : clamp(1.3 * rem, viewport * 0.032, 1.9 * rem)),
        fromSize: Math.round(isMobile ? clamp(0.78 * rem, viewport * 0.035, 0.92 * rem) : clamp(1.05 * rem, viewport * 0.026, 1.5 * rem)),
        stampWidth: isMobile ? clamp(64, viewport * 0.18, 96) : clamp(96, viewport * 0.18, 148),
      };
      setMetrics((current) => current && Object.keys(next).every((key) => current[key] === next[key]) ? current : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(host.current);
    window.addEventListener("resize", schedule, { passive: true });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [isMobile]);

  const toSize = metrics?.toSize;
  const fromSize = metrics?.fromSize;
  useEffect(() => {
    if (!toSize || !fromSize) return;
    let cancelled = false;
    const paragraphs = [
      // An editable line stays put while empty, so it can be filled back in.
      { kind: "to", text: (postcard.recipient || editable) && `to${postcard.recipient ? ` ${postcard.recipient}` : ""}`, fontSize: toSize, lineHeight: Math.ceil(toSize * (isMobile ? 1.1 : 1.18)) },
      { kind: "from", text: (postcard.from || editable) && `from${postcard.from ? ` ${postcard.from}` : ""}`, fontSize: fromSize, lineHeight: Math.ceil(fromSize * (isMobile ? 1.16 : 1.2)) },
    ].filter((paragraph) => paragraph.text);
    const prepare = async () => {
      await Promise.allSettled(paragraphs.map((paragraph) => document.fonts.load(`${paragraph.fontSize}px ${FONT_FAMILY}`, paragraph.text)));
      if (cancelled) return;
      setPrepared(paragraphs.map((paragraph) => ({
        ...paragraph,
        prepared: prepareWithSegments(paragraph.text, `${paragraph.fontSize}px ${FONT_FAMILY}`),
      })));
    };
    prepare().catch((error) => console.warn("Unable to lay out postcard address", error));
    return () => { cancelled = true; };
  }, [postcard.recipient, postcard.from, toSize, fromSize, isMobile, editable]);

  const shapes = useMemo(() => postcard.stamps.map((stamp, index) => {
    const asset = assets[stamp.src] || { ratio: 1, contour: rectangleContour };
    const width = Math.max(1, Math.min(metrics?.stampWidth || 64, (metrics?.width || 160) - 8));
    const height = Math.min(isMobile ? 84 : 132, width / asset.ratio);
    const actualWidth = height * asset.ratio;
    return {
      ...stamp,
      contour: asset.contour,
      width: actualWidth,
      height,
      left: Math.max(0, (metrics?.width || 160) - actualWidth - index * 8 - 3),
      top: 3,
      angle: index % 2 ? -3 : 2,
    };
  }), [postcard.stamps, assets, metrics, isMobile]);

  const ready = prepared && metrics?.width && postcard.stamps.every((stamp) => assets[stamp.src]);
  const layout = useMemo(() => ready ? layoutAddress(prepared, metrics.width, shapes) : null, [ready, prepared, metrics, shapes]);
  const fallbackTop = Math.max(0, ...shapes.map((stamp) => stamp.top + stamp.height + 4));
  const fullAddress = [postcard.recipient && `to ${postcard.recipient}`, postcard.from && `from ${postcard.from}`].filter(Boolean).join(". ");

  return (
    <Postage ref={host} className={className} onClick={onClick} style={{ height: layout?.height }}>
      {shapes.map((stamp, index) => (
        <PostageStamp
          key={`${stamp.name}-${index}`}
          src={stamp.src}
          alt={stamp.name}
          onLoad={(event) => {
            const asset = readStamp(event.currentTarget);
            setAssets((current) => current[stamp.src] === asset ? current : { ...current, [stamp.src]: asset });
          }}
          onError={() => setAssets((current) => ({ ...current, [stamp.src]: { ratio: 1, contour: rectangleContour } }))}
          style={{
            left: stamp.left, top: stamp.top, width: stamp.width, height: stamp.height, transform: `rotate(${stamp.angle}deg)`,
            ...(onStampClick && { pointerEvents: "auto", cursor: "pointer" }),
          }}
          $pressable={Boolean(onStampClick)}
          {...(onStampClick && {
            role: "button",
            tabIndex: 0,
            "aria-label": `Stamp: ${stamp.name.replace(/\.svg$/, "").replace(/-/g, " ")}. Change stamp`,
            onClick: (event) => { event.stopPropagation(); onStampClick(); },
            onKeyDown: (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onStampClick();
            },
          })}
        />
      ))}
      {postmark && shapes[0] && (() => {
        // Struck across the stamp's left edge, as a post office would.
        const stamp = shapes[0];
        const size = Math.min(72, Math.max(48, stamp.height * 1.05));
        return (
          <Postmark
            src={postmark}
            alt="Postmarked"
            style={{ left: stamp.left - size * 0.45, top: stamp.top + stamp.height / 2 - size / 2, width: size, height: size }}
          />
        );
      })()}
      {layout ? (
        <AddressInk role="group" aria-label={fullAddress}>
          {layout.lines.map((line, index) => {
            const style = { left: line.left, top: line.top, fontSize: line.fontSize, lineHeight: `${line.lineHeight}px` };
            const first = layout.lines.findIndex((other) => other.kind === line.kind) === index;
            const value = line.kind === "to" ? postcard.recipient : postcard.from;
            if (editable && editing === line.kind) {
              // While retyping, the whole line sits where its first line was printed.
              return first ? (
                <AddressTextLine key={index} style={style}>
                  {line.kind}{" "}
                  <InlineField
                    display={value || ""}
                    label={line.kind === "to" ? "To" : "From"}
                    autoFocus
                    onCommit={(text) => onEdit(line.kind, text)}
                    onDone={() => setEditing(null)}
                  />
                </AddressTextLine>
              ) : null;
            }
            return (
              <AddressTextLine
                key={index}
                aria-hidden={editable && first ? undefined : "true"}
                style={{ ...style, ...(editable && { cursor: "text" }) }}
                {...(editable && {
                  onClick: (event) => {
                    event.stopPropagation();
                    setEditing(line.kind);
                  },
                  ...(first && {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": `${line.kind} ${value || "nobody yet"}. Edit`,
                    onFocus: () => setEditing(line.kind),
                  }),
                })}
              >{line.text}{" "}</AddressTextLine>
            );
          })}
        </AddressInk>
      ) : (
        <AddressInk style={{ paddingTop: fallbackTop }}>
          {postcard.recipient && <div style={{ fontSize: toSize }}>{`to ${postcard.recipient}`}</div>}
          {postcard.from && <div style={{ fontSize: fromSize }}>{`from ${postcard.from}`}</div>}
        </AddressInk>
      )}
    </Postage>
  );
}

const Postage = styled.div`
  position: relative;
  flex: none;
  width: 100%;
  min-width: 0;
  cursor: pointer;
`;

// A newly chosen stamp is pressed down onto the paper.
const stampSettle = keyframes`
  from {
    opacity: 0;
    scale: 1.06;
  }
`;

const stampFadeIn = keyframes`
  from {
    opacity: 0;
  }
`;

// Sending cancels the stamp: the postmark comes down onto it and settles.
const postmarkStrike = keyframes`
  from {
    opacity: 0;
    transform: rotate(-4deg) scale(1.15);
  }
`;

const Postmark = styled.img`
  position: absolute;
  z-index: 3;
  max-width: none;
  margin: 0;
  object-fit: contain;
  pointer-events: none;
  opacity: 0.8;
  mix-blend-mode: multiply;
  filter: sepia(0.25) saturate(0.7);
  transform: rotate(-12deg);
  animation: ${postmarkStrike} 260ms cubic-bezier(0.23, 1, 0.32, 1) 120ms backwards;

  @media (prefers-reduced-motion: reduce) {
    animation-name: ${stampFadeIn};
  }
`;

const PostageStamp = styled.img`
  position: absolute;
  z-index: 2;
  display: block;
  max-width: none;
  margin: 0;
  object-fit: contain;
  pointer-events: none;
  opacity: 0.85;
  mix-blend-mode: multiply;
  filter: sepia(0.18) saturate(0.82) contrast(0.9);

  /* The stamp keeps its tilt in transform, so press and settle use scale. */
  ${(props) =>
    props.$pressable &&
    css`
      transition: scale 160ms cubic-bezier(0.23, 1, 0.32, 1);
      animation: ${stampSettle} 180ms cubic-bezier(0.23, 1, 0.32, 1) backwards;

      &:active {
        scale: 0.95;
      }

      @media (prefers-reduced-motion: reduce) {
        animation-name: ${stampFadeIn};
      }
    `}
`;

const AddressInk = styled.div`
  color: #2f2620;
  font-family: ${FONT_FAMILY};
  text-align: left;
  text-rendering: auto;
  -webkit-text-size-adjust: 100%;
  opacity: 0.85;
  mix-blend-mode: multiply;
  overflow-wrap: break-word;
`;

const AddressTextLine = styled.span`
  position: absolute;
  display: block;
  white-space: pre;
`;
