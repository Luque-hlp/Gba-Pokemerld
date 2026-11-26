/**
 * BinaryReader — lectura little-endian con control de límites sobre un Uint8Array.
 * No copia el buffer y nunca escribe en él (la ROM original es de solo lectura).
 */
export class BinaryReader {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('BinaryReader espera un Uint8Array');
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.length = bytes.length;
  }
  #check(offset, size) {
    if (!Number.isInteger(offset) || offset < 0 || offset + size > this.length) {
      throw new RangeError(`Lectura fuera de límites: 0x${offset.toString(16)} (+${size}) / 0x${this.length.toString(16)}`);
    }
  }
  u8(o) { this.#check(o, 1); return this.bytes[o]; }
  u16(o) { this.#check(o, 2); return this.view.getUint16(o, true); }
  u32(o) { this.#check(o, 4); return this.view.getUint32(o, true); }
  i32(o) { this.#check(o, 4); return this.view.getInt32(o, true); }
  slice(o, n) { this.#check(o, n); return this.bytes.subarray(o, o + n); }
  /** ASCII imprimible; los bytes no imprimibles se sustituyen por '.' */
  ascii(o, n) {
    let s = '';
    for (const b of this.slice(o, n)) s += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
    return s;
  }
}

export const hex = (n, pad = 8) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(pad, '0');
