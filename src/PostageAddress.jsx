import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { prepareWithSegments } from "@chenglou/pretext";
import styled from "styled-components";
import { layoutAddress } from "./address-layout.js";

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

export default function PostageAddress({ postcard, isMobile, className, onClick }) {
  const host = useRef(null);
  const [metrics, setMetrics] = useState(null);
  const [assets, setAssets] = useState({});
  const [prepared, setPrepared] = useState(null);

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
      { kind: "to", text: postcard.recipient && `to ${postcard.recipient}`, fontSize: toSize, lineHeight: Math.ceil(toSize * (isMobile ? 1.1 : 1.18)) },
      { kind: "from", text: postcard.from && `from ${postcard.from}`, fontSize: fromSize, lineHeight: Math.ceil(fromSize * (isMobile ? 1.16 : 1.2)) },
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
  }, [postcard.recipient, postcard.from, toSize, fromSize, isMobile]);

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
          style={{ left: stamp.left, top: stamp.top, width: stamp.width, height: stamp.height, transform: `rotate(${stamp.angle}deg)` }}
        />
      ))}
      {layout ? (
        <AddressInk role="group" aria-label={fullAddress}>
          {layout.lines.map((line, index) => (
            <AddressTextLine
              key={index}
              aria-hidden="true"
              style={{ left: line.left, top: line.top, fontSize: line.fontSize, lineHeight: `${line.lineHeight}px` }}
            >{line.text}{" "}</AddressTextLine>
          ))}
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
