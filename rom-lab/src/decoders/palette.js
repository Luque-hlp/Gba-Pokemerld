/**
 * Paletas GBA (BGR555). Fuente: GBATEK, "LCD Color Palettes".
 * Representación interna: Uint32Array de colores RGBA empaquetados en little-endian (0xAABBGGRR),
 * listos para escribirse en un Uint32Array sobre ImageData.data.
 */

/** Escalado 5→8 bits: replica los bits altos en los bajos (convención, no definida por hardware). */
export const c5to8 = (c) => (c << 3) | (c >> 2);

/** @param {number} bgr u16 BGR555 @returns {[number, number, number]} */
export function bgr555ToRgb(bgr) {
  return [c5to8(bgr & 31), c5to8((bgr >> 5) & 31), c5to8((bgr >> 10) & 31)];
}

export const packRGBA = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

/**
 * Decodifica `count` colores BGR555 desde `bytes[offset]`.
 * @returns {{colors: Uint32Array, bit15Set: number}} bit15Set: nº de colores con el bit 15 activo (no usado por el hardware;
 *   valores altos sugieren que los datos no son una paleta)
 */
export function decodePalette(bytes, offset = 0, count = 16) {
  if (offset < 0 || offset + count * 2 > bytes.length) throw new RangeError(`Paleta fuera de límites (0x${offset.toString(16)} + ${count * 2})`);
  const colors = new Uint32Array(count);
  let bit15Set = 0;
  for (let i = 0; i < count; i++) {
    const v = bytes[offset + i * 2] | (bytes[offset + i * 2 + 1] << 8);
    if (v & 0x8000) bit15Set++;
    const [r, g, b] = bgr555ToRgb(v);
    colors[i] = packRGBA(r, g, b);
  }
  return { colors, bit15Set };
}

/** Paleta de grises de n entradas: visualización neutra cuando NO hay evidencia de qué paleta corresponde. */
export function grayscalePalette(n = 16) {
  const c = new Uint32Array(n);
  for (let i = 0; i < n; i++) { const v = Math.round((i * 255) / (n - 1)); c[i] = packRGBA(v, v, v); }
  return c;
}
