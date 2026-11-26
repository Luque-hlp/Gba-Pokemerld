/**
 * Conversión BGR555 → RGBA de 32 bits (formato de ImageData en little-endian: 0xAABBGGRR).
 * Escalado 5→8 bits replicando los bits altos. Tabla de 32768 entradas precalculada.
 */
export const COLOR_LUT = new Uint32Array(0x8000);
for (let c = 0; c < 0x8000; c++) {
  const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
  COLOR_LUT[c] = (0xff000000 | (((b << 3) | (b >> 2)) << 16) | (((g << 3) | (g >> 2)) << 8) | ((r << 3) | (r >> 2))) >>> 0;
}
