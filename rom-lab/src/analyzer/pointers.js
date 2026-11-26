/**
 * Escáner de punteros. En GBA la ROM se mapea en 0x08000000 (espejos en 0x0A/0x0C, GBATEK).
 * Un "puntero candidato" es una palabra alineada a 4 cuyo valor cae dentro de la ROM.
 * Esto es una señal estadística: cualquier dato puede parecer un puntero por azar.
 */
import { hex } from '../core/BinaryReader.js';
import { ROM_BASE } from './header.js';

/**
 * @param {Uint8Array} bytes
 * @param {object} [opts]
 * @param {number} [opts.limit] tamaño de datos a escanear (por defecto, todo)
 * @param {number} [opts.minRun=8] longitud mínima para informar una tabla contigua
 * @returns {{refs: Map<number, number[]>, stats: object, runs: Array<{start:number,count:number}>}}
 *   refs: offset destino (en archivo) -> lista de offsets donde aparece el puntero
 */
export function scanPointers(bytes, opts = {}) {
  const limit = Math.min(opts.limit ?? bytes.length, bytes.length) & ~3;
  const minRun = opts.minRun ?? 8;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const refs = new Map();
  let total = 0, thumbLike = 0, ewram = 0, iwram = 0, io = 0;
  const runs = [];
  let runStart = -1, runCount = 0;

  for (let off = 0; off < limit; off += 4) {
    const w = dv.getUint32(off, true);
    const region = w >>> 24;
    let isRom = false;
    if (region === 0x08 || region === 0x09) {
      const target = w - ROM_BASE;
      if (target < bytes.length) {
        isRom = true; total++;
        if (w & 1) thumbLike++;
        let list = refs.get(target);
        if (!list) refs.set(target, (list = []));
        list.push(off);
      }
    } else if (region === 0x02 && (w & 0xffffff) < 0x40000) ewram++;
    else if (region === 0x03 && (w & 0xffffff) < 0x8000) iwram++;
    else if (region === 0x04 && (w & 0xffffff) < 0x400) io++;

    if (isRom) { if (runStart < 0) runStart = off; runCount++; }
    else { if (runCount >= minRun) runs.push({ start: runStart, count: runCount }); runStart = -1; runCount = 0; }
  }
  if (runCount >= minRun) runs.push({ start: runStart, count: runCount });

  return {
    refs,
    runs,
    stats: {
      romPointerWords: total,
      uniqueTargets: refs.size,
      oddTargets_possibleThumbCode: thumbLike,
      ewramPointerWords: ewram, iwramPointerWords: iwram, ioRegisterWords: io,
      contiguousTablesMinRun: minRun, contiguousTables: runs.length,
    },
  };
}

/** Destinos más referenciados (útil para localizar funciones/tablas centrales). */
export function topTargets(refs, n = 25) {
  return [...refs.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, n)
    .map(([t, l]) => ({ target: hex(t), references: l.length, thumbBitSet: (t & 1) === 1 }));
}
