/**
 * Cabecera de cartucho GBA (0x000–0x0BF). Fuente: GBATEK, "GBA Cartridge Header".
 * Todo lo que aquí se marca como CONFIRMED se verifica por campo fijo o checksum.
 */
import { BinaryReader, hex } from '../core/BinaryReader.js';
import { crc32 } from '../core/crc32.js';
import { Evidence, claim } from '../report/evidence.js';

export const ROM_BASE = 0x08000000;
export const HEADER_SIZE = 0xc0;

// GBATEK: 4.º carácter del código de juego = idioma/destino
const DESTINATION = { J: 'Japón', E: 'EE. UU./Inglés', P: 'Europa/Elsewhere', D: 'Alemán', F: 'Francés', I: 'Italiano', S: 'Español' };

/** Checksum de complemento: -(suma de 0xA0..0xBC) - 0x19, 8 bits. */
export function headerComplement(bytes) {
  let c = 0;
  for (let i = 0xa0; i <= 0xbc; i++) c -= bytes[i];
  return (c - 0x19) & 0xff;
}

/** Decodifica una instrucción ARM B/BL de 32 bits situada en `address`. */
export function decodeArmBranch(word, address) {
  const isBranch = ((word >>> 25) & 0b111) === 0b101;
  if (!isBranch) return null;
  let off = word & 0xffffff;
  if (off & 0x800000) off -= 0x1000000;
  return { cond: word >>> 28, link: !!((word >>> 24) & 1), target: (address + 8 + off * 4) >>> 0 };
}

/** @param {Uint8Array} bytes */
export function parseHeader(bytes) {
  if (bytes.length < HEADER_SIZE) throw new RangeError(`Archivo demasiado pequeño para cabecera GBA (${bytes.length} < 192)`);
  const r = new BinaryReader(bytes);
  const claims = [];

  const entryWord = r.u32(0);
  const branch = decodeArmBranch(entryWord, ROM_BASE);
  claims.push(branch && branch.cond === 0xe
    ? claim(`Punto de entrada: ARM B incondicional a ${hex(branch.target)}`, Evidence.CONFIRMED, 'Decodificación de la instrucción en 0x000')
    : claim('0x000 no contiene un salto ARM incondicional', Evidence.REJECTED, `Palabra ${hex(entryWord)}`));

  const logo = r.slice(0x04, 156);
  const logoCrc = crc32(logo);

  const title = r.ascii(0xa0, 12).replace(/\.+$/, '');
  const gameCode = r.ascii(0xac, 4);
  const makerCode = r.ascii(0xb0, 2);
  const fixed96 = r.u8(0xb2);
  const unitCode = r.u8(0xb3);
  const deviceType = r.u8(0xb4);
  const reserved1 = Array.from(r.slice(0xb5, 7));
  const version = r.u8(0xbc);
  const complement = r.u8(0xbd);
  const computed = headerComplement(bytes);

  claims.push(fixed96 === 0x96
    ? claim('Byte fijo 0xB2 = 0x96', Evidence.CONFIRMED, 'GBATEK: valor obligatorio')
    : claim(`Byte fijo 0xB2 = ${hex(fixed96, 2)} (esperado 0x96)`, Evidence.REJECTED, 'GBATEK'));
  claims.push(complement === computed
    ? claim(`Checksum de cabecera válido (${hex(complement, 2)})`, Evidence.CONFIRMED, 'Recalculado sobre 0xA0–0xBC')
    : claim(`Checksum de cabecera inválido: almacenado ${hex(complement, 2)}, calculado ${hex(computed, 2)}`, Evidence.REJECTED, 'Recalculado sobre 0xA0–0xBC'));
  claims.push(claim(`CRC32 del logo (0x004–0x09F): ${hex(logoCrc)}`, Evidence.HYPOTHESIS,
    'Calculado pero NO comparado con un logo de referencia: el logo es idéntico en todo cartucho licenciado; verificar contra otra ROM legítima'));

  const dest = DESTINATION[gameCode[3]];
  if (dest) claims.push(claim(`Destino/idioma por código de juego: ${dest}`, Evidence.CONFIRMED, `GBATEK: 4.º carácter '${gameCode[3]}'`));

  return {
    entryPoint: { word: hex(entryWord), ...(branch ? { target: hex(branch.target), targetFileOffset: hex(branch.target - ROM_BASE) } : {}) },
    logoCrc32: hex(logoCrc),
    title, gameCode, makerCode,
    fixedByte: hex(fixed96, 2), unitCode, deviceType,
    reservedB5_BB_allZero: reserved1.every((b) => b === 0),
    softwareVersion: version,
    complement: { stored: hex(complement, 2), computed: hex(computed, 2), valid: complement === computed },
    claims,
  };
}
