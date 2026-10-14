import { layoutNextLine, measureNaturalWidth } from "@chenglou/pretext";

// Each contour row is the occupied horizontal span of a stamp, normalized to 0–1.
// Rotate those spans with the artwork, then find their left edge in a text row.
export function addressRowRight(width, stamps, top, height, gap = 3) {
  let right = width;
  const bottom = top + height + gap;
  top -= gap;

  for (const stamp of stamps) {
    const angle = (stamp.angle * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const point = (x, y) => ({
      x: stamp.left + stamp.width / 2 + x * cos - y * sin,
      y: stamp.top + stamp.height / 2 + x * sin + y * cos,
    });
    for (const row of stamp.contour) {
      const a = point((row.left - 0.5) * stamp.width, (row.y - 0.5) * stamp.height);
      const b = point((row.right - 0.5) * stamp.width, (row.y - 0.5) * stamp.height);
      if (Math.max(a.y, b.y) < top - 1 || Math.min(a.y, b.y) > bottom + 1) continue;
      const dy = b.y - a.y;
      let start = 0;
      let end = 1;
      if (Math.abs(dy) > 0.001) {
        const t1 = (top - 1 - a.y) / dy;
        const t2 = (bottom + 1 - a.y) / dy;
        start = Math.max(0, Math.min(t1, t2));
        end = Math.min(1, Math.max(t1, t2));
      }
      const edge = Math.min(a.x + (b.x - a.x) * start, a.x + (b.x - a.x) * end);
      right = Math.min(right, edge - gap);
    }
  }
  return Math.max(0, Math.floor(right));
}

export function layoutAddress(paragraphs, width, stamps) {
  if (width <= 0) return { lines: [], height: 0 };
  const stampBottom = Math.ceil(Math.max(0, ...stamps.map((stamp) => {
    const angle = (stamp.angle * Math.PI) / 180;
    const halfHeight = (Math.abs(stamp.width * Math.sin(angle)) + Math.abs(stamp.height * Math.cos(angle))) / 2;
    return stamp.top + stamp.height / 2 + halfHeight + 4;
  })));
  if (paragraphs.length === 0) return { lines: [], height: stampBottom };
  const first = paragraphs[0];
  let y = Math.floor(stampBottom * 0.45);
  const minimumWidth = Math.min(width, Math.max(48, first.fontSize * 2.5));
  while (y < stampBottom && addressRowRight(width, stamps, y, first.lineHeight) < minimumWidth) {
    y += first.lineHeight;
  }

  const naturalWidth = Math.max(...paragraphs.map((paragraph) => measureNaturalWidth(paragraph.prepared)));
  const firstWidth = Math.min(measureNaturalWidth(first.prepared), width * 0.7);
  // Keep to/from left-aligned together, as far right as the first usable row permits.
  const left = Math.max(0, Math.floor(Math.min(
    width - naturalWidth,
    addressRowRight(width, stamps, y, first.lineHeight) - firstWidth,
  )));
  const lines = [];

  for (const paragraph of paragraphs) {
    let cursor = { segmentIndex: 0, graphemeIndex: 0 };
    while (cursor.segmentIndex < paragraph.prepared.segments.length) {
      const available = Math.max(0, addressRowRight(width, stamps, y, paragraph.lineHeight) - left);
      if (y < stampBottom && available < Math.min(minimumWidth, width - left)) {
        y += paragraph.lineHeight;
        continue;
      }
      // The installed Pretext API takes (prepared, cursor, width).
      const line = layoutNextLine(paragraph.prepared, cursor, Math.max(1, available));
      if (!line) break;
      if (line.end.segmentIndex === cursor.segmentIndex && line.end.graphemeIndex === cursor.graphemeIndex) {
        throw new Error("Pretext did not advance the address cursor");
      }
      lines.push({
        text: line.text,
        width: line.width,
        available,
        left,
        top: y,
        kind: paragraph.kind,
        fontSize: paragraph.fontSize,
        lineHeight: paragraph.lineHeight,
      });
      cursor = line.end;
      y += paragraph.lineHeight;
    }
    y += 3;
  }
  return { lines, height: Math.ceil(Math.max(stampBottom, y)) };
}
