/**
 * LZ77 de la BIOS de GBA (SWI 0x11 LZ77UnCompWram / SWI 0x12 LZ77UnCompVram).
 *
 * Formato (fuente: GBATEK, "BIOS Decompression Functions"):
 *   Cabecera u32 LE:
 *     bits 0-3  reservado (0)
 *     bits 4-7  tipo de compresión = 1 (LZ77)  -> el primer byte vale 0x10
 *     bits 8-31 tamaño descomprimido en bytes
 *   La fuente debe estar alineada a 4 bytes (la BIOS la lee como palabra).
 *   Cuerpo: bloques de 1 byte de flags + 8 elementos, del bit 7 al bit 0:
 *     flag 0 -> 1 byte literal
 *     flag 1 -> 2 bytes de referencia:
 *        longitud     = (b0 >> 4) + 3                 (3..18)
 *        desplazamiento = (((b0 & 0x0F) << 8) | b1) + 1 (1..4096)
 *        copia byte a byte desde salida[pos - desplazamiento] (se permite solapamiento)
 *   La descompresión termina al alcanzar el tamaño declarado.
 *
 * Nota VRAM: SWI 0x12 escribe en unidades de 16 bits; un desplazamiento de 1 produce
 * datos incorrectos en VRAM. El decodificador lo informa con `vramUnsafe`, no lo rechaza.
 */

export class LZ77Error extends Error {
  constructor(message, offset) { super(message); this.name = 'LZ77Error'; this.offset = offset; }
}

export const LZ77_TYPE = 0x10;

/**
 * Lee la cabecera sin descomprimir.
 * @param {Uint8Array} src @param {number} [offset=0]
 * @returns {{type:number, decompressedSize:number}|null} null si el byte de tipo no es 0x10
 */
export function readLZ77Header(src, offset = 0) {
  if (offset + 4 > src.length) return null;
  if (src[offset] !== LZ77_TYPE) return null;
  const size = src[offset + 1] | (src[offset + 2] << 8) | (src[offset + 3] << 16);
  return { type: LZ77_TYPE, decompressedSize: size };
}

/**
 * Descomprime un flujo LZ77.
 * @param {Uint8Array} src
 * @param {number} [offset=0]  posición de la cabecera
 * @param {object} [opts]
 * @param {number} [opts.maxSize=0x1000000] tamaño máximo aceptado (protección ante datos corruptos)
 * @returns {{data:Uint8Array, compressedSize:number, decompressedSize:number, vramUnsafe:boolean, tokens:{literals:number, refs:number}}}
 * @throws {LZ77Error} si el flujo es inválido
 */
export function decompressLZ77(src, offset = 0, opts = {}) {
  const { maxSize = 0x1000000 } = opts;
  // Una referencia en pos 0 se rechaza por 'disp > op': el primer elemento siempre debe ser literal.
  const header = readLZ77Header(src, offset);
  if (!header) throw new LZ77Error('Cabecera LZ77 ausente (el byte de tipo debe ser 0x10)', offset);
  const size = header.decompressedSize;
  if (size === 0) throw new LZ77Error('Tamaño descomprimido 0', offset);
  if (size > maxSize) throw new LZ77Error(`Tamaño descomprimido ${size} > máximo ${maxSize}`, offset);

  const out = new Uint8Array(size);
  let ip = offset + 4, op = 0, literals = 0, refs = 0, vramUnsafe = false;

  while (op < size) {
    if (ip >= src.length) throw new LZ77Error('Fin de datos al leer byte de flags', ip);
    const flags = src[ip++];
    for (let bit = 7; bit >= 0 && op < size; bit--) {
      if ((flags >> bit) & 1) {
        if (ip + 1 >= src.length) throw new LZ77Error('Fin de datos en referencia', ip);
        const b0 = src[ip++], b1 = src[ip++];
        const len = (b0 >> 4) + 3;
        const disp = (((b0 & 0x0f) << 8) | b1) + 1;
        if (disp > op) throw new LZ77Error(`Referencia anterior al inicio (disp=${disp}, pos=${op})`, ip - 2);
        if (disp === 1) vramUnsafe = true;
        if (op + len > size) {
          // La BIOS se detiene al alcanzar el tamaño; los encoders correctos no generan esto.
          throw new LZ77Error(`Referencia excede el tamaño declarado (${op}+${len} > ${size})`, ip - 2);
        }
        for (let k = 0; k < len; k++, op++) out[op] = out[op - disp];
        refs++;
      } else {
        if (ip >= src.length) throw new LZ77Error('Fin de datos en literal', ip);
        out[op++] = src[ip++];
        literals++;
      }
    }
  }
  return { data: out, compressedSize: ip - offset, decompressedSize: size, vramUnsafe, tokens: { literals, refs } };
}

/**
 * Compresor LZ77 compatible con la BIOS. Se usa para GENERAR DATOS DE PRUEBA
 * independientes de cualquier ROM. Búsqueda voraz, ventana 4096, longitud 3..18.
 * @param {Uint8Array} input
 * @param {object} [opts]
 * @param {boolean} [opts.vramSafe=true] evita desplazamiento 1 (compatible con SWI 0x12)
 * @returns {Uint8Array} flujo con cabecera, rellenado a múltiplo de 4
 */
export function compressLZ77(input, opts = {}) {
  const { vramSafe = true } = opts;
  if (input.length === 0 || input.length > 0xffffff) throw new RangeError('Tamaño de entrada fuera de rango (1..0xFFFFFF)');
  const minDisp = vramSafe ? 2 : 1;
  const out = [LZ77_TYPE, input.length & 0xff, (input.length >> 8) & 0xff, (input.length >> 16) & 0xff];
  let pos = 0;
  while (pos < input.length) {
    const flagIndex = out.length;
    out.push(0);
    let flags = 0;
    for (let bit = 7; bit >= 0 && pos < input.length; bit--) {
      let bestLen = 0, bestDisp = 0;
      const maxDisp = Math.min(4096, pos);
      const maxLen = Math.min(18, input.length - pos);
      for (let disp = minDisp; disp <= maxDisp; disp++) {
        let l = 0;
        while (l < maxLen && input[pos + l] === input[pos + l - disp]) l++;
        if (l > bestLen) { bestLen = l; bestDisp = disp; if (l === maxLen) break; }
      }
      if (bestLen >= 3) {
        flags |= 1 << bit;
        const d = bestDisp - 1;
        out.push(((bestLen - 3) << 4) | (d >> 8), d & 0xff);
        pos += bestLen;
      } else {
        out.push(input[pos++]);
      }
    }
    out[flagIndex] = flags;
  }
  while (out.length % 4) out.push(0);
  return Uint8Array.from(out);
}
