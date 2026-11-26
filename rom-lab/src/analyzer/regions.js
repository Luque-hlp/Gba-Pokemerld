/**
 * Mapa de regiones por bloques: relleno, entropía de Shannon y fin real de datos.
 * La clasificación por entropía es HEURÍSTICA: indica densidad de información, no tipo de dato.
 */
import { hex } from '../core/BinaryReader.js';

export function shannonEntropy(bytes) {
  const counts = new Uint32Array(256);
  for (let i = 0; i < bytes.length; i++) counts[bytes[i]]++;
  let h = 0;
  for (let i = 0; i < 256; i++) if (counts[i]) { const p = counts[i] / bytes.length; h -= p * Math.log2(p); }
  return h;
}

/** Umbrales documentados en docs/FORMATS.md §1.3 */
export function classifyBlock(block) {
  let ff = 0, zz = 0;
  for (let i = 0; i < block.length; i++) { if (block[i] === 0xff) ff++; else if (block[i] === 0) zz++; }
  if (ff === block.length) return { cls: 'fill-FF', entropy: 0 };
  if (zz === block.length) return { cls: 'fill-00', entropy: 0 };
  const e = shannonEntropy(block);
  let cls = 'medium-entropy';
  if (e < 3.0) cls = 'low-entropy';
  else if (e > 7.2) cls = 'high-entropy';
  return { cls, entropy: +e.toFixed(3) };
}

/** Último byte que no es relleno 0xFF/0x00 al final del archivo. */
export function findDataEnd(bytes) {
  let i = bytes.length - 1;
  const pad = bytes[i];
  if (pad !== 0xff && pad !== 0x00) return { dataEnd: bytes.length, paddingByte: null, paddingSize: 0 };
  while (i >= 0 && bytes[i] === pad) i--;
  return { dataEnd: i + 1, paddingByte: hex(pad, 2), paddingSize: bytes.length - (i + 1) };
}

/**
 * Agrupa bloques consecutivos de la misma clase en regiones.
 * @param {Uint8Array} bytes @param {number} [blockSize=4096]
 */
export function mapRegions(bytes, blockSize = 4096) {
  const regions = [];
  const histogram = {};
  for (let off = 0; off < bytes.length; off += blockSize) {
    const { cls, entropy } = classifyBlock(bytes.subarray(off, Math.min(off + blockSize, bytes.length)));
    histogram[cls] = (histogram[cls] || 0) + 1;
    const last = regions[regions.length - 1];
    if (last && last.cls === cls) { last.end = Math.min(off + blockSize, bytes.length); last.blocks++; last.entropySum += entropy; }
    else regions.push({ cls, start: off, end: Math.min(off + blockSize, bytes.length), blocks: 1, entropySum: entropy });
  }
  return {
    blockSize,
    histogram,
    regions: regions.map((r) => ({
      class: r.cls, start: hex(r.start), end: hex(r.end), size: r.end - r.start,
      meanEntropy: +(r.entropySum / r.blocks).toFixed(3),
    })),
  };
}
