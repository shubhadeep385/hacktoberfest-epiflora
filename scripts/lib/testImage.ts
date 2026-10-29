/**
 * Generates a synthetic diseased-leaf image, encoded as PNG with zero dependencies.
 *
 * Why synthetic rather than a downloaded photo: the pre-flight check has to work
 * on the venue wifi that ate the last three demos, and a Wikimedia search for
 * "tomato leaf blight" cheerfully returned scanned 1902 seed catalogues. A
 * deterministic fixture makes the check reproducible.
 *
 * What this proves: the vision path accepts an image, the model returns schema-
 * valid JSON, and the plumbing works end to end.
 * What it does NOT prove: real-world diagnostic accuracy. Only real field photos
 * can show that, so judge quality separately with actual crop images.
 */

import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] as number);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour RGB
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    rgb.subarray(y * width * 3, (y + 1) * width * 3).forEach((value, index) => {
      raw[rowStart + 1 + index] = value;
    });
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Deterministic pseudo-random so the fixture is byte-identical every run. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export interface SyntheticLeaf {
  dataUrl: string;
  bytes: number;
}

/**
 * Draws a green leaf with concentric dark lesions and yellow haloes — the visual
 * signature of an Alternaria-type early blight.
 */
export function syntheticDiseasedLeaf(size = 512): SyntheticLeaf {
  const rgb = new Uint8Array(size * size * 3);
  const random = makeRandom(20260817);
  const centre = size / 2;

  // Lesion centres, spread over the lower half where blight starts.
  const lesions = Array.from({ length: 7 }, () => ({
    x: centre + (random() - 0.5) * size * 0.55,
    y: centre + (random() * 0.45) * size * 0.5,
    r: size * (0.035 + random() * 0.045),
  }));

  const set = (index: number, r: number, g: number, b: number) => {
    rgb[index] = r;
    rgb[index + 1] = g;
    rgb[index + 2] = b;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 3;

      // Leaf body: ellipse, slightly taller than wide.
      const nx = (x - centre) / (size * 0.40);
      const ny = (y - centre) / (size * 0.46);
      const insideLeaf = nx * nx + ny * ny <= 1;

      if (!insideLeaf) {
        // Blurred soil background so the leaf is clearly the subject.
        const n = random() * 18;
        set(index, 78 + n, 62 + n, 48 + n);
        continue;
      }

      // Base green, darker toward the edges for a little modelling.
      const depth = 1 - (nx * nx + ny * ny);
      let r = 74 + depth * 26 + random() * 10;
      let g = 128 + depth * 46 + random() * 12;
      let b = 52 + depth * 18 + random() * 8;

      // Midrib and veins.
      const veinDistance = Math.abs(x - centre);
      if (veinDistance < size * 0.012) {
        r += 46;
        g += 40;
        b += 30;
      }
      const veinPhase = Math.abs(Math.sin((y - centre) * 0.07) * size * 0.28);
      if (Math.abs(veinDistance - veinPhase) < size * 0.006) {
        r += 26;
        g += 24;
        b += 16;
      }

      // Lesions: necrotic brown core, concentric rings, chlorotic yellow halo.
      for (const lesion of lesions) {
        const distance = Math.hypot(x - lesion.x, y - lesion.y);
        if (distance > lesion.r * 1.9) continue;

        if (distance < lesion.r) {
          const ring = Math.sin((distance / lesion.r) * Math.PI * 3.4);
          const dark = 58 + ring * 22;
          r = dark + 24;
          g = dark * 0.62;
          b = dark * 0.36;
        } else {
          // Yellow halo fading outward.
          const fade = 1 - (distance - lesion.r) / (lesion.r * 0.9);
          r = r * (1 - fade) + 208 * fade;
          g = g * (1 - fade) + 194 * fade;
          b = b * (1 - fade) + 74 * fade;
        }
      }

      set(index, Math.min(255, r), Math.min(255, g), Math.min(255, b));
    }
  }

  const png = encodePng(size, size, rgb);
  return {
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    bytes: png.length,
  };
}
