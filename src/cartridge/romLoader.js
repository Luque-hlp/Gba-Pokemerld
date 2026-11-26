/**
 * Cargador y validación de ROM (GBATEK, "GBA Cartridge Header"). Todo se procesa en local.
 * Devuelve metadatos y la lista de errores/advertencias legibles para la interfaz.
 */
export class RomError extends Error {}

const SAVE_IDS = [['EEPROM_V', 'eeprom'], ['SRAM_F_V', 'sram'], ['SRAM_V', 'sram'], ['FLASH1M_V', 'flash128'], ['FLASH512_V', 'flash64'], ['FLASH_V', 'flash64']];

function findAscii(bytes, text, limit = bytes.length) {
  const first = text.charCodeAt(0);
  outer: for (let i = 0; i + text.length <= limit; i++) {
    if (bytes[i] !== first) continue;
    for (let k = 1; k < text.length; k++) if (bytes[i + k] !== text.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

export function headerComplement(b) { let c = 0; for (let i = 0xa0; i <= 0xbc; i++) c -= b[i]; return (c - 0x19) & 0xff; }

/** @param {Uint8Array} bytes @param {string} [fileName] */
export function inspectRom(bytes, fileName = '') {
  const warnings = [];
  if (bytes.length < 0xc0) throw new RomError(`El archivo es demasiado pequeño para ser una ROM de GBA (${bytes.length} bytes).`);
  if (bytes.length > 0x2000000) throw new RomError(`El archivo mide ${(bytes.length / 1048576).toFixed(1)} MiB: una ROM de GBA no supera 32 MiB.`);
  if (/\.zip$/i.test(fileName) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new RomError('Es un archivo comprimido (.zip). Descomprímelo y selecciona el .gba que contiene.');
  const ascii = (o, n) => String.fromCharCode(...bytes.subarray(o, o + n)).replace(/\0+$/, '');
  const title = ascii(0xa0, 12), gameCode = ascii(0xac, 4), maker = ascii(0xb0, 2);
  const checksumOk = headerComplement(bytes) === bytes[0xbd];
  if (bytes[0xb2] !== 0x96) warnings.push('El byte fijo de la cabecera (0xB2) no es 0x96: la cabecera puede estar dañada.');
  if (!checksumOk) warnings.push('El checksum de la cabecera no coincide: la ROM puede estar dañada o modificada.');
  const limit = bytes.length;
  let saveType = 'none', saveId = null;
  for (const [id, type] of SAVE_IDS) {
    const at = findAscii(bytes, id, limit);
    if (at >= 0) { saveType = type; saveId = String.fromCharCode(...bytes.subarray(at, at + id.length + 3)); break; }
  }
  const rtc = findAscii(bytes, 'SIIRTC_V', limit) >= 0;
  const isEmerald = title === 'POKEMON EMER' && /^BPE.$/.test(gameCode);
  if (!isEmerald) warnings.push(`El juego es "${title}" (${gameCode}). El emulador se ha validado con Pokémon Esmeralda; otros juegos pueden fallar.`);
  return { title, gameCode, maker, version: bytes[0xbc], size: bytes.length, checksumOk, saveType, saveId, rtc, isEmerald, warnings };
}

/** CRC32 (para identificar la partida guardada asociada a cada ROM sin almacenar la ROM). */
export function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) { c ^= bytes[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (~c) >>> 0;
}
