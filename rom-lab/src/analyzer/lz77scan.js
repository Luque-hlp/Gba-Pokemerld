/**
 * Detección de recursos comprimidos LZ77 por descompresión de prueba.
 * Criterios (todos documentados en docs/FORMATS.md §2.7):
 *   C1  offset alineado a 4 (requisito de la BIOS)
 *   C2  byte de tipo 0x10
 *   C3  tamaño descomprimido en [minSize, maxSize]
 *   C4  el flujo se decodifica sin error (sin referencias fuera de rango, sin truncamiento)
 *   C5  existe al menos un puntero ROM al offset (evidencia independiente)
 * C1–C4 -> HYPOTHESIS. C1–C5 -> CORROBORATED.
 * Un candidato no referenciado contenido dentro de otro corroborado se marca REJECTED (solapamiento).
 */
import { decompressLZ77, LZ77_TYPE } from '../decoders/lz77.js';
import { Evidence } from '../report/evidence.js';
import { hex } from '../core/BinaryReader.js';

/**
 * Formatos POSIBLES según el tamaño y contenido descomprimido. Nunca concluyentes.
 * @param {Uint8Array} data
 */
export function possibleFormats(data) {
  const n = data.length, f = [];
  if (n % 32 === 0) f.push({ format: 'tiles-4bpp', tiles: n / 32 });
  if (n % 64 === 0) f.push({ format: 'tiles-8bpp', tiles: n / 64 });
  if (n % 32 === 0 && n <= 512) {
    let bit15Clear = true;
    for (let i = 1; i < n; i += 2) if (data[i] & 0x80) { bit15Clear = false; break; }
    if (bit15Clear) f.push({ format: 'palette-bgr555', palettes16: n / 32 });
  }
  if (n % 2 === 0 && [0x800, 0x1000, 0x2000].includes(n)) f.push({ format: 'tilemap-text-bg', entries: n / 2, note: 'tamaño coincide con un screenblock de 32x32, 64x32/32x64 o 64x64' });
  return f;
}

export function scanLZ77(bytes, refs, opts = {}) {
  const minSize = opts.minSize ?? 32;
  const maxSize = opts.maxSize ?? 0x40000; // 256 KiB = EWRAM: destino máximo razonable de SWI 0x11
  const limit = opts.limit ?? bytes.length;
  const found = [];
  let tried = 0, failed = 0;
  const failReasons = {};

  for (let off = 0; off + 4 <= limit; off += 4) {
    if (bytes[off] !== LZ77_TYPE) continue;
    const size = bytes[off + 1] | (bytes[off + 2] << 8) | (bytes[off + 3] << 16);
    if (size < minSize || size > maxSize) continue;
    tried++;
    try {
      const r = decompressLZ77(bytes, off, { maxSize });
      const referencedBy = refs?.get(off) ?? [];
      found.push({
        offset: off, compressedSize: r.compressedSize, decompressedSize: r.decompressedSize,
        ratio: +(r.compressedSize / r.decompressedSize).toFixed(3),
        vramUnsafe: r.vramUnsafe, tokens: r.tokens,
        references: referencedBy.length, referenceSites: referencedBy.slice(0, 8),
        level: referencedBy.length > 0 ? Evidence.CORROBORATED : Evidence.HYPOTHESIS,
        possibleFormats: possibleFormats(r.data),
      });
    } catch (e) {
      failed++;
      const key = e.message.replace(/\(.*\)/, '').replace(/\d+/g, 'N').trim();
      failReasons[key] = (failReasons[key] || 0) + 1;
    }
  }

  // Rechazo por solapamiento: un candidato sin referencias dentro de los bytes de otro corroborado.
  const corroborated = found.filter((c) => c.level === Evidence.CORROBORATED).sort((a, b) => a.offset - b.offset);
  let j = 0;
  for (const c of found) {
    if (c.level !== Evidence.HYPOTHESIS) continue;
    while (j < corroborated.length && corroborated[j].offset + corroborated[j].compressedSize <= c.offset) j++;
    // búsqueda lineal acotada (los corroborados no se solapan entre sí en datos sanos)
    for (let k = Math.max(0, j - 2); k < Math.min(corroborated.length, j + 2); k++) {
      const p = corroborated[k];
      if (c.offset > p.offset && c.offset < p.offset + p.compressedSize) { c.level = Evidence.REJECTED; c.rejectedBecause = `dentro de ${hex(p.offset)}`; break; }
    }
  }
  return { candidates: found, stats: { headersTried: tried, decodeFailures: failed, failReasons, valid: found.length } };
}
