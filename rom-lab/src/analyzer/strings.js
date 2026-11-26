/**
 * Cadenas ASCII y firmas de bibliotecas.
 * Firmas de tipo de guardado: GBATEK, "GBA Cart Backup IDs" (cadenas que la biblioteca de Nintendo
 * incrusta en la ROM: EEPROM_Vnnn, SRAM_Vnnn, SRAM_F_Vnnn, FLASH_Vnnn, FLASH512_Vnnn, FLASH1M_Vnnn).
 * Nota: los textos del juego de Pokémon NO usan ASCII (tabla de caracteres propia); esta búsqueda
 * solo encuentra identificadores técnicos.
 */
import { hex } from '../core/BinaryReader.js';
import { Evidence, claim } from '../report/evidence.js';

const SAVE_RE = /^(EEPROM_V|SRAM_F_V|SRAM_V|FLASH_V|FLASH512_V|FLASH1M_V)(\d{3})/;

export function scanAscii(bytes, opts = {}) {
  const minLen = opts.minLen ?? 8;
  const maxReport = opts.maxReport ?? 200;
  const out = [];
  let count = 0, start = -1;
  for (let i = 0; i <= bytes.length; i++) {
    const b = i < bytes.length ? bytes[i] : 0;
    const printable = b >= 0x20 && b < 0x7f;
    if (printable) { if (start < 0) start = i; continue; }
    if (start >= 0 && i - start >= minLen) {
      count++;
      if (out.length < maxReport) out.push({ offset: hex(start), text: String.fromCharCode(...bytes.subarray(start, Math.min(i, start + 80))) });
    }
    start = -1;
  }
  return { totalStrings: count, minLen, sample: out };
}

export function detectSaveType(bytes) {
  const hits = [];
  for (let i = 0; i < bytes.length - 12; i++) {
    const b = bytes[i];
    if (b !== 0x45 && b !== 0x53 && b !== 0x46) continue; // E, S, F
    const s = String.fromCharCode(...bytes.subarray(i, i + 13));
    const m = SAVE_RE.exec(s);
    if (m) hits.push({ offset: hex(i), id: m[0] });
  }
  const claims = hits.map((h) => claim(`Firma de biblioteca de guardado ${h.id} en ${h.offset}`, Evidence.CONFIRMED, 'GBATEK: Backup IDs'));
  if (hits.length === 0) claims.push(claim('No se encontró firma de tipo de guardado', Evidence.HYPOTHESIS, 'Búsqueda ASCII completa'));
  return { hits, claims };
}
