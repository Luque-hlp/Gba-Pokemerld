/**
 * Conversión de imágenes indexadas a RGBA (compatible con Canvas ImageData).
 * Sin dependencias del DOM: devuelve { width, height, data: Uint8ClampedArray }.
 */

/**
 * @param {{width:number,height:number,pixels:Uint8Array,paletteBank?:Uint8Array}} img
 * @param {Uint32Array} palette colores RGBA empaquetados; con paletteBank, 16 colores por banco
 * @param {object} [o] transparentZero: índice 0 de cada banco transparente (regla de hardware para OBJ/BG)
 * @returns {{width:number,height:number,data:Uint8ClampedArray, outOfPalette:number}}
 */
export function indexedToRGBA(img, palette, { transparentZero = false } = {}) {
  const data = new Uint8ClampedArray(img.width * img.height * 4);
  const out = new Uint32Array(data.buffer);
  let outOfPalette = 0;
  for (let i = 0; i < img.pixels.length; i++) {
    const v = img.pixels[i];
    if (transparentZero && v === 0) continue;
    const idx = img.paletteBank ? img.paletteBank[i] * 16 + v : v;
    if (idx >= palette.length) { outOfPalette++; out[i] = 0xffff00ff; continue; } // magenta = error visible
    out[i] = palette[idx];
  }
  return { width: img.width, height: img.height, data, outOfPalette };
}

/** Recorta una imagen indexada (para separar fotogramas de una hoja de sprites). */
export function cropIndexed(img, x, y, w, h) {
  const r = { width: w, height: h, pixels: new Uint8Array(w * h) };
  if (img.paletteBank) r.paletteBank = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const s = (y + j) * img.width + x;
    r.pixels.set(img.pixels.subarray(s, s + w), j * w);
    if (img.paletteBank) r.paletteBank.set(img.paletteBank.subarray(s, s + w), j * w);
  }
  return r;
}
