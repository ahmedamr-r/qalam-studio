/**
 * Measuring screenshots in the browser, so extraction doesn't rest on the model's estimates:
 * the capture's scale (px per logical px) from its dimensions, and the true box, height and corner
 * radius of an element the model points at (a flood fill of its flat fill colour).
 */

/** What the studio knows about one screenshot sent for extraction. */
export interface Capture {
  /** Original pixel size of the file. */
  width: number;
  height: number;
  /** Size of the image as sent to the model (after downscaling). */
  sentWidth: number;
  sentHeight: number;
  /** Capture pixels per logical (1x) pixel. */
  scale: number;
  /** width / scale. */
  logicalWidth: number;
  /** false when several scales fit the dimensions equally well (the model is asked to judge). */
  confident: boolean;
  kind: "phone" | "desktop";
  /** Another scale that fits as well, when not confident. */
  alternative?: number;
}

// (scale, logical width) pairs that real devices and windows use.
type Pair = { s: number; w: number };
const pairs = (widths: number[], scales: number[]): Pair[] => widths.flatMap((w) => scales.map((s) => ({ s, w })));
const IOS: Pair[] = [...pairs([320, 375, 390, 393, 402, 414, 428, 430, 440], [2, 3]), ...pairs([744, 768, 810, 820, 834, 1024], [2])];
const ANDROID: Pair[] = pairs([360, 384, 392, 393, 411, 412, 432], [2, 2.625, 2.75, 3, 3.5, 4]);
const DESKTOP: Pair[] = pairs([1024, 1280, 1366, 1440, 1470, 1512, 1536, 1600, 1680, 1728, 1920, 2560], [1, 2]);
const DESKTOP_FRACTIONAL: Pair[] = pairs([1280, 1366, 1440, 1536, 1600, 1920], [1.25, 1.5]);
const PHONE_PREFERENCE = [3, 2, 2.625, 2.75, 3.5, 4];

const matches = (width: number, list: Pair[]) => [...new Set(list.filter((p) => Math.abs(width / p.s - p.w) / p.w < 0.004).map((p) => p.s))];

/**
 * The scale of a capture from its pixel size: a scale at which its width is a real device or
 * window width. When two scales fit (a 1080-wide Android capture is 360@3x or 411@2.625x), the
 * likelier one is picked and the result is marked not confident, with the other as alternative.
 */
export function captureScale(width: number, height: number): Omit<Capture, "sentWidth" | "sentHeight"> {
  const portrait = height > width * 1.15;
  const out = (scale: number, confident: boolean, alternative?: number) => ({
    width,
    height,
    scale,
    logicalWidth: Math.round(width / scale),
    confident,
    kind: portrait ? ("phone" as const) : ("desktop" as const),
    ...(alternative ? { alternative } : {}),
  });
  if (portrait) {
    if (width <= 480) return out(1, true);
    const fits = matches(width, [...IOS, ...ANDROID]).sort((a, b) => PHONE_PREFERENCE.indexOf(a) - PHONE_PREFERENCE.indexOf(b));
    if (fits.length) return out(fits[0], fits.length === 1, fits[1]);
    // A crop or an unusual device: the integer scale that gives a phone-like width, else 1x.
    const guess = [3, 2].find((s) => width / s >= 320 && width / s <= 460) ?? 1;
    return out(guess, false);
  }
  const fits = matches(width, DESKTOP);
  if (fits.length) {
    // Wide Retina captures: 2560 is far more often 1280@2x than a 2560 monitor at 1x.
    const pick = fits.length > 1 ? (width >= 2400 ? 2 : 1) : fits[0];
    return out(pick, fits.length === 1, fits.find((s) => s !== pick));
  }
  const frac = matches(width, DESKTOP_FRACTIONAL);
  if (frac.length) return out(frac[0], false, 1);
  return out(width >= 2400 ? 2 : 1, false);
}

/** Logical (1x) px per pixel of the image as sent. */
export const toLogical = (c: Pick<Capture, "width" | "sentWidth" | "scale">) => c.width / Math.max(1, c.sentWidth) / c.scale;

// ---------------------------------------------------------------------------

export interface Measured {
  /** Box in logical px from the image's top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius in logical px (median of the corners that could be read). */
  radius: number;
  /** The corners are fully round (a pill or a circle). */
  pill: boolean;
  fill: string;
}

const hex2 = (v: number) => Math.round(v).toString(16).padStart(2, "0");

/**
 * Measure the element inside `box` (0–1 image coordinates): take its dominant flat colour, flood
 * fill it from inside the box (text and icons are holes the fill goes around), and read the filled
 * region's bounds and corner radii. Returns null when the element isn't a flat fill, when the fill
 * leaks out into a same-coloured background, or when the result doesn't match the box.
 */
export function measureElement(img: ImageData, box: number[], logicalPerPx: number): Measured | null {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const W = img.width,
    H = img.height,
    d = img.data;
  const [bx0, by0, bx1, by1] = box.map((v) => Math.min(1, Math.max(0, Number(v) || 0)));
  const L = Math.floor(Math.min(bx0, bx1) * W),
    R = Math.ceil(Math.max(bx0, bx1) * W) - 1,
    T = Math.floor(Math.min(by0, by1) * H),
    B = Math.ceil(Math.max(by0, by1) * H) - 1;
  if (R - L < 4 || B - T < 4) return null;

  // Dominant colour of the box (4-bit buckets, so anti-aliased text doesn't pull the average).
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let total = 0;
  const step = Math.max(1, Math.floor(((R - L) * (B - T)) / 20000));
  for (let y = T; y <= B; y += step)
    for (let x = L; x <= R; x += step) {
      const o = (y * W + x) * 4;
      const k = ((d[o] >> 4) << 8) | ((d[o + 1] >> 4) << 4) | (d[o + 2] >> 4);
      const e = buckets.get(k) ?? { r: 0, g: 0, b: 0, n: 0 };
      e.r += d[o];
      e.g += d[o + 1];
      e.b += d[o + 2];
      e.n++;
      total++;
      buckets.set(k, e);
    }
  let best: { r: number; g: number; b: number; n: number } | null = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  if (!best || best.n / total < 0.3) return null;
  const seed = [best.r / best.n, best.g / best.n, best.b / best.n];

  // The fill may leave the model's box (boxes are approximate), but not by much.
  const padX = Math.max(8, Math.round((R - L) * 0.3)),
    padY = Math.max(8, Math.round((B - T) * 0.3));
  const wx0 = Math.max(0, L - padX),
    wy0 = Math.max(0, T - padY),
    wx1 = Math.min(W - 1, R + padX),
    wy1 = Math.min(H - 1, B + padY);

  // Tolerance from the contrast with what surrounds the element: a white card on #F4F4F5 needs a
  // tight one; an outlined field on its own background relies on its border (tightest).
  const ring = new Map<number, number>();
  const sampleRing = (x: number, y: number) => {
    const o = (y * W + x) * 4;
    const k = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2];
    ring.set(k, (ring.get(k) ?? 0) + 1);
  };
  for (let x = wx0; x <= wx1; x += 2) {
    sampleRing(x, wy0);
    sampleRing(x, wy1);
  }
  for (let y = wy0; y <= wy1; y += 2) {
    sampleRing(wx0, y);
    sampleRing(wx1, y);
  }
  let around = -1,
    aroundN = 0;
  for (const [k, n] of ring) if (n > aroundN) [around, aroundN] = [k, n];
  const contrast = Math.max(Math.abs(((around >> 16) & 255) - seed[0]), Math.abs(((around >> 8) & 255) - seed[1]), Math.abs((around & 255) - seed[2]));
  const tolerance = Math.max(2, Math.min(12, Math.floor(contrast / 2)));
  const near = (o: number) => Math.abs(d[o] - seed[0]) <= tolerance && Math.abs(d[o + 1] - seed[1]) <= tolerance && Math.abs(d[o + 2] - seed[2]) <= tolerance;
  const ww = wx1 - wx0 + 1;
  const mask = new Uint8Array(ww * (wy1 - wy0 + 1));

  // Seed: the matching pixel nearest the box centre. A centre inside a line icon's outline (a
  // clock, a circle) would trap the fill in the icon, so other points of the box are tried next.
  const cx = Math.round((L + R) / 2),
    cy = Math.round((T + B) / 2);
  const seeds: [number, number][] = [];
  for (let r = 0; r <= Math.max(R - L, B - T) / 2 && !seeds.length; r++)
    for (let dy = -r; dy <= r && !seeds.length; dy++)
      for (const dx of [-r, r]) {
        const x = cx + dx,
          y = cy + dy;
        if (x >= L && x <= R && y >= T && y <= B && near((y * W + x) * 4)) {
          seeds.push([x, y]);
          break;
        }
      }
  if (!seeds.length) return null;
  for (const fy of [0.5, 0.2, 0.8])
    for (const fx of [0.12, 0.88, 0.3, 0.7])
      seeds.push([Math.round(L + (R - L) * fx), Math.round(T + (B - T) * fy)]);

  const attempt = (sx: number, sy: number) => {
    mask.fill(0);
    let minX = sx,
      maxX = sx,
      minY = sy,
      maxY = sy;
    const stack = [sx, sy];
    mask[(sy - wy0) * ww + (sx - wx0)] = 1;
    while (stack.length) {
      const y = stack.pop()!,
        x = stack.pop()!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nx < wx0 || nx > wx1 || ny < wy0 || ny > wy1) continue;
        const m = (ny - wy0) * ww + (nx - wx0);
        if (mask[m] || !near((ny * W + nx) * 4)) continue;
        mask[m] = 1;
        stack.push(nx, ny);
      }
    }
    // Leaked into the background: the region reaches the edge of the search window (unless that
    // edge is the edge of the image, as for full-bleed bars and banners).
    if ((minX === wx0 && wx0 > 0) || (maxX === wx1 && wx1 < W - 1) || (minY === wy0 && wy0 > 0) || (maxY === wy1 && wy1 < H - 1)) return null;

    // The region must be the element the model meant.
    const ix = Math.max(0, Math.min(maxX, R) - Math.max(minX, L) + 1),
      iy = Math.max(0, Math.min(maxY, B) - Math.max(minY, T) + 1);
    const inter = ix * iy;
    const union = (maxX - minX + 1) * (maxY - minY + 1) + (R - L + 1) * (B - T + 1) - inter;
    if (inter / union < 0.4) return null;
    return { minX, maxX, minY, maxY };
  };
  let region: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
  const tried = new Set<string>();
  for (const [sx, sy] of seeds) {
    if (region) break;
    if (tried.size >= 8 || !near((sy * W + sx) * 4) || tried.has(`${sx},${sy}`)) continue;
    tried.add(`${sx},${sy}`);
    region = attempt(sx, sy);
  }
  if (!region) return null;
  const { minX, maxX, minY, maxY } = region;

  // Corner radius: along each corner's diagonal, a circle of radius r starts r·(1 − 1/√2) in.
  const at = (x: number, y: number) => mask[(y - wy0) * ww + (x - wx0)] === 1;
  const w = maxX - minX + 1,
    h = maxY - minY + 1;
  const half = Math.floor(Math.min(w, h) / 2);
  const radii: number[] = [];
  const corners: [number, number, number, number, boolean][] = [
    [minX, minY, 1, 1, minX === 0 || minY === 0],
    [maxX, minY, -1, 1, maxX === W - 1 || minY === 0],
    [minX, maxY, 1, -1, minX === 0 || maxY === H - 1],
    [maxX, maxY, -1, -1, maxX === W - 1 || maxY === H - 1],
  ];
  for (const [x0, y0, dx, dy, clipped] of corners) {
    if (clipped) continue;
    let k = 0;
    while (k < half && !at(x0 + dx * k, y0 + dy * k)) k++;
    // The arc crosses pixel k's diagonal somewhere inside it; a quarter pixel in allows for the
    // anti-aliased edge pixel the tolerance leaves out.
    if (k < half) radii.push(k === 0 ? 0 : Math.max(0, (k - 0.25) / (1 - Math.SQRT1_2)));
  }
  if (!radii.length) return null;
  radii.sort((a, b) => a - b);
  const r = radii[Math.floor(radii.length / 2)];
  const f = logicalPerPx;
  return {
    x: minX * f,
    y: minY * f,
    w: w * f,
    h: h * f,
    radius: Math.min(r, Math.min(w, h) / 2) * f,
    pill: r >= (Math.min(w, h) / 2) * 0.85,
    fill: `#${hex2(seed[0])}${hex2(seed[1])}${hex2(seed[2])}`.toUpperCase(),
  };
}
