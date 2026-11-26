/**
 * Inspector de ROM GBA — interfaz web (HTML + CSS + JavaScript nativo, sin bibliotecas).
 * Solo capa de presentación: toda la lógica vive en ../src (analizador, decodificadores, estructuras),
 * que es el mismo código que usa la CLI y que cubren las pruebas.
 * El archivo se lee con FileReader en memoria; nunca se envía a ningún sitio ni se modifica.
 */
import { analyzeRom } from '../src/analyzer/analyzeRom.js';
import { decompressLZ77 } from '../src/decoders/lz77.js';
import { decodePalette, grayscalePalette } from '../src/decoders/palette.js';
import { tilesToIndexedImage } from '../src/decoders/tiles.js';
import { indexedToRGBA, cropIndexed } from '../src/decoders/image.js';
import { buildTilesetPair, renderMap } from '../src/decoders/metatile.js';
import { parseAnimCmds } from '../src/decoders/anim.js';
import { pairSpriteTables, readSpriteTable, findMapLayouts, loadTilesetData, SOURCES } from '../src/structures/schemas.js';
import { findAnimTables, summarizeAnimTable, ANIM_SOURCES } from '../src/structures/animations.js';
import { scanPointers } from '../src/analyzer/pointers.js';
import { AnimationPlayer } from '../src/engine/AnimationManager.js';
import { spriteToPack, mapToPack, animCmdToPack } from '../src/export/toPack.js';
import { hex } from '../src/core/BinaryReader.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lvl = (l) => `<span class="lvl ${l}">${{ confirmed: 'confirmado', corroborated: 'corroborado', hypothesis: 'hipótesis', rejected: 'rechazado' }[l] ?? l}</span>`;
/** Offsets siempre en hexadecimal, con o sin prefijo 0x. */
const parseOff = (s) => { const t = String(s).trim().replace(/^0x/i, ''); return /^[0-9a-f]+$/i.test(t) ? parseInt(t, 16) : NaN; };

const state = { bytes: null, report: null, log: [], spritePairs: [], maps: null, animTables: [], lzSel: null, animTimer: null };

// ------------------------------------------------------------------ registro de errores
function log(level, message, context = {}) {
  state.log.push({ time: new Date().toISOString(), level, message, ...context });
  $('logCount').textContent = state.log.filter((l) => l.level === 'error').length;
  $('log').insertAdjacentHTML('afterbegin', `<div class="logitem ${level}">[${level}] ${esc(message)} ${Object.keys(context).length ? esc(JSON.stringify(context)) : ''}</div>`);
}
/** Ejecuta fn y registra la excepción en lugar de romper la interfaz. */
function guard(where, fn) { try { return fn(); } catch (e) { log('error', `${where}: ${e.message}`); return null; } }

// ------------------------------------------------------------------ canvas
function draw(canvas, rgba, zoom = 1) {
  canvas.width = rgba.width; canvas.height = rgba.height;
  canvas.style.width = rgba.width * zoom + 'px'; canvas.style.height = rgba.height * zoom + 'px';
  canvas.getContext('2d').putImageData(new ImageData(rgba.data, rgba.width, rgba.height), 0, 0);
}
function drawSwatches(canvas, colors, perRow = 16, size = 14) {
  const rows = Math.ceil(colors.length / perRow);
  canvas.width = perRow * size; canvas.height = rows * size; canvas.style.width = canvas.width + 'px'; canvas.style.height = canvas.height + 'px';
  const ctx = canvas.getContext('2d');
  colors.forEach((c, i) => { ctx.fillStyle = `rgb(${c & 255},${(c >> 8) & 255},${(c >> 16) & 255})`; ctx.fillRect((i % perRow) * size, Math.floor(i / perRow) * size, size - 1, size - 1); });
}

// ------------------------------------------------------------------ pestañas
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
});
const showTab = (name) => document.querySelector(`.tabs button[data-tab="${name}"]`).click();

// ------------------------------------------------------------------ carga
$('file').addEventListener('change', (e) => e.target.files[0] && load(e.target.files[0]));
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && load(e.dataTransfer.files[0]); });

async function load(file) {
  stopAnim();
  $('status').textContent = `Leyendo ${file.name}…`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > 0x2000000) log('warn', `El archivo mide ${bytes.length} B: más de 32 MiB, no es una ROM GBA estándar`);
  let sha1 = null;
  try { sha1 = [...new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
  catch { log('warn', 'SHA-1 no disponible en este contexto (crypto.subtle); se usa solo CRC32'); }
  $('status').textContent = 'Analizando…';
  await new Promise((r) => setTimeout(r, 30)); // deja pintar el estado
  Object.assign(state, { bytes, log: [], spritePairs: [], maps: null, animTables: [], lzSel: null });
  $('log').innerHTML = '';
  const t0 = performance.now();
  state.report = analyzeRom(bytes, { fileName: file.name, sha1 }, () => {});
  state.report.errors.forEach((e) => log('error', `Analizador (${e.stage}): ${e.message}`));
  const limit = parseInt(state.report.layout?.dataEnd ?? bytes.length, 16) || bytes.length;
  state.spritePairs = guard('Emparejado de tablas de sprites', () => pairSpriteTables(bytes, state.report.structures.stridedTables)) ?? [];
  state.maps = guard('Búsqueda de MapLayout', () => findMapLayouts(bytes, { limit })) ?? { layouts: [], tilesets: [] };
  state.animTables = guard('Búsqueda de tablas de animación', () => findAnimTables(bytes, scanPointers(bytes, { limit }).runs)) ?? [];
  $('status').textContent = `${file.name} — ${(bytes.length / 1048576).toFixed(2)} MiB analizado en ${Math.round(performance.now() - t0)} ms`;
  $('download').disabled = false;
  renderSummary(); renderRegions(); renderLzList(); setupSprites(); setupMaps(); hexView(0);
}

// ------------------------------------------------------------------ resumen
function claimsTable(claims) {
  return `<table>${claims.map((c) => `<tr><td>${lvl(c.level)}</td><td>${esc(c.statement)}<div class="hint">${esc(c.basis.join(' · '))}</div></td></tr>`).join('')}</table>`;
}
function renderSummary() {
  const r = state.report, h = r.header, lz = r.compression?.lz77?.stats;
  const rows = (o) => `<table>${Object.entries(o).map(([k, v]) => `<tr><th>${esc(k)}</th><td class="mono">${esc(v)}</td></tr>`).join('')}</table>`;
  $('summary').innerHTML = `
  <div class="card"><h2>Archivo</h2>${rows({ nombre: r.file.name, tamaño: `${r.file.size} B`, CRC32: r.file.crc32, 'SHA-1': r.file.sha1 ?? '—', 'fin de datos': r.layout?.dataEnd, relleno: `${r.layout?.paddingSize} B de ${r.layout?.paddingByte}`, 'sin modificar': r.file.unmodified ? 'sí' : 'NO' })}${claimsTable([...r.file.claims, ...(r.layout?.claims ?? [])])}</div>
  ${h ? `<div class="card"><h2>Cabecera</h2>${rows({ título: h.title, 'código de juego': h.gameCode, fabricante: h.makerCode, 'punto de entrada': `${h.entryPoint.word} → ${h.entryPoint.target ?? '?'}`, versión: h.softwareVersion, complemento: `${h.complement.stored} (calculado ${h.complement.computed})` })}${claimsTable(h.claims)}</div>` : ''}
  <div class="card"><h2>Guardado</h2>${claimsTable(r.saveType?.claims ?? [])}</div>
  <div class="card"><h2>Punteros y compresión</h2>${rows({ 'palabras puntero ROM': r.pointers?.stats.romPointerWords, 'destinos únicos': r.pointers?.stats.uniqueTargets, 'LZ77 corroborados': lz?.corroborated, 'LZ77 hipótesis': lz?.hypothesis, 'bytes comprimidos → descomprimidos': `${lz?.corroboratedCompressedBytes} → ${lz?.corroboratedDecompressedBytes}` })}</div>
  <div class="card"><h2>Estructuras del juego (validadas en este archivo)</h2>
    <table><tr><th>Estructura</th><th>Resultado</th><th>Nivel</th></tr>
    ${state.spritePairs.map((p) => `<tr><td>Sprites ${p.sheetTable} ↔ paletas ${p.paletteTable}</td><td>${p.entries} entradas, ${esc(p.relation)} (${p.matches})</td><td>${lvl(p.level)}</td></tr>`).join('') || '<tr><td colspan=3>No se encontraron parejas de tablas de sprites.</td></tr>'}
    <tr><td>MapLayout / Tileset</td><td>${state.maps.layouts.length} layouts, ${state.maps.tilesets.length} tilesets</td><td>${lvl(state.maps.level ?? 'hypothesis')}</td></tr>
    ${state.animTables.map((t) => `<tr><td>Tabla de animaciones ${hex(t.start)}</td><td>${t.entries} arrays de secuencias AnimCmd; primera secuencia común ${hex(t.commonFirstSequence.offset)} (${t.commonFirstSequence.sharedBy} entradas)</td><td>${lvl(t.level)}</td></tr>`).join('')}</table>
    <p class="hint">Layouts tomados de la descompilación pokeemerald, localizados en este archivo por su forma, sin direcciones prefijadas: ${esc(SOURCES.CompressedSpriteSheet)} · ${esc(SOURCES.MapLayout)}</p></div>`;
}

// ------------------------------------------------------------------ regiones
const REGION_COLORS = { 'fill-FF': '#d9dde3', 'fill-00': '#9aa3ad', 'low-entropy': '#7bc47f', 'medium-entropy': '#4c86d9', 'high-entropy': '#d9534f' };
function renderRegions() {
  const r = state.report, c = $('regionCanvas');
  const blocks = Math.ceil(r.file.size / r.regions.blockSize);
  c.width = blocks; c.height = 1;
  const ctx = c.getContext('2d');
  for (const g of r.regions.regions) { ctx.fillStyle = REGION_COLORS[g.class]; ctx.fillRect(parseInt(g.start, 16) / r.regions.blockSize, 0, g.size / r.regions.blockSize, 1); }
  ctx.fillStyle = '#000';
  for (const x of r.compression.lz77.corroborated) ctx.fillRect(parseInt(x.offset, 16) / r.regions.blockSize, 0, 0.6, 0.25); // marca de recursos LZ77
  $('regionLegend').innerHTML = Object.entries(REGION_COLORS).map(([k, v]) => `<span><i style="background:${v}"></i>${k} (${r.regions.histogram[k] ?? 0} bloques)</span>`).join('') + '<span><i style="background:#000"></i>recurso LZ77 corroborado (franja superior)</span>';
  const at = (e) => { const b = c.getBoundingClientRect(); return Math.floor(((e.clientX - b.left) / b.width) * blocks) * r.regions.blockSize; };
  c.onmousemove = (e) => { const o = at(e); const g = r.regions.regions.find((g) => o >= parseInt(g.start, 16) && o < parseInt(g.end, 16)); $('regionInfo').textContent = `${hex(o)}  ${g ? `${g.class}  región ${g.start}–${g.end}  entropía media ${g.meanEntropy}` : ''}`; };
  c.onclick = (e) => { hexView(at(e)); showTab('hex'); };
  $('regionTable').innerHTML = `<table><tr><th>inicio</th><th>fin</th><th>clase</th><th>tamaño</th><th>entropía</th></tr>${r.regions.regions.filter((g) => g.size >= 0x10000).map((g) => `<tr><td class="mono">${g.start}</td><td class="mono">${g.end}</td><td>${g.class}</td><td>${g.size}</td><td>${g.meanEntropy}</td></tr>`).join('')}</table><p class="hint">Solo regiones de 64 KiB o más; el informe JSON contiene todas.</p>`;
}

// ------------------------------------------------------------------ recursos LZ77
function lzItems() {
  const lz = state.report.compression.lz77;
  const src = $('lzLevel').value === 'corroborated' ? lz.corroborated : lz.hypothesis;
  const f = $('lzFormat').value, q = $('lzSearch').value.trim().toLowerCase();
  return src.filter((c) => (!f || c.possibleFormats.some((p) => p.format === f)) && (!q || c.offset.toLowerCase().includes(q.replace(/^0x/, '')) || String(c.decompressedSize) === q));
}
function renderLzList() {
  const items = lzItems();
  $('lzCount').textContent = `${items.length} recursos${items.length > 600 ? ' (se muestran 600; filtra para acotar)' : ''}`;
  $('lzList').innerHTML = items.slice(0, 600).map((c) => `<div data-off="${c.offset}">${c.offset} · ${c.decompressedSize} B · refs ${c.references}</div>`).join('');
}
['lzLevel', 'lzFormat', 'lzSearch'].forEach((id) => $(id).addEventListener('input', renderLzList));
$('lzList').addEventListener('click', (e) => {
  const d = e.target.closest('div[data-off]'); if (!d) return;
  document.querySelectorAll('#lzList .sel').forEach((x) => x.classList.remove('sel')); d.classList.add('sel');
  selectLz(parseInt(d.dataset.off, 16));
});
function selectLz(off) {
  const all = [...state.report.compression.lz77.corroborated, ...state.report.compression.lz77.hypothesis];
  const meta = all.find((c) => parseInt(c.offset, 16) === off);
  const res = guard(`LZ77 en ${hex(off)}`, () => decompressLZ77(state.bytes, off));
  if (!res) return;
  state.lzSel = { off, data: res.data, meta };
  $('lzControls').hidden = false;
  $('lzDetail').innerHTML = `<b class="mono">${hex(off)}</b> ${lvl(meta?.level ?? 'hypothesis')} — ${res.compressedSize} B → ${res.decompressedSize} B · referenciado desde ${meta?.referenceSites?.join(', ') || '—'}<br>
    Formatos posibles (por tamaño, no concluyentes): ${meta?.possibleFormats.map((p) => `${p.format}${p.tiles ? ` (${p.tiles} tiles)` : ''}${p.palettes16 ? ` (${p.palettes16} paletas)` : ''}`).join(' · ') || 'ninguno'}`;
  renderLz();
}
function lzPalette() {
  const mode = $('lzPalMode').value, bpp = +$('lzBpp').value;
  if (mode === 'gray') return grayscalePalette(bpp === 4 ? 16 : 256);
  const off = parseOff($('lzPalOffset').value);
  if (!Number.isFinite(off)) { log('warn', 'Offset de paleta no válido; se usan grises'); return grayscalePalette(bpp === 4 ? 16 : 256); }
  return guard(`Paleta en ${hex(off)}`, () => {
    const src = mode === 'lz' ? decompressLZ77(state.bytes, off).data : state.bytes;
    const base = (mode === 'lz' ? 0 : off) + (bpp === 4 ? +$('lzPalBank').value * 32 : 0);
    const p = decodePalette(src, base, bpp === 4 ? 16 : 256);
    if (p.bit15Set > 2) log('warn', `La paleta en ${hex(off)} tiene ${p.bit15Set} colores con el bit 15 activo: probablemente no es una paleta`);
    return p.colors;
  }) ?? grayscalePalette(bpp === 4 ? 16 : 256);
}
function renderLz() {
  const s = state.lzSel; if (!s) return;
  const bpp = +$('lzBpp').value, w = Math.max(1, +$('lzWidth').value | 0);
  const img = guard('Disposición de tiles', () => tilesToIndexedImage(s.data, bpp, w)); if (!img) return;
  const rgba = indexedToRGBA(img, lzPalette());
  if (rgba.outOfPalette) log('warn', `${rgba.outOfPalette} píxeles fuera de paleta (magenta)`, { offset: hex(s.off) });
  draw($('lzCanvas'), rgba, +$('lzZoom').value);
  $('lzNote').textContent = `${img.tiles} tiles de ${bpp}bpp, ${img.width}×${img.height} px. El ancho y la paleta los eliges tú: este bloque no los declara. ${s.data.length % (bpp * 8) ? `Sobran ${s.data.length % (bpp * 8)} bytes (no es múltiplo de un tile).` : ''}`;
}
['lzBpp', 'lzWidth', 'lzPalMode', 'lzPalOffset', 'lzPalBank', 'lzZoom'].forEach((id) => $(id).addEventListener('change', renderLz));
$('lzAsPalette').onclick = () => {
  const s = state.lzSel; if (!s) return;
  const n = Math.min(256, s.data.length >> 1);
  const p = decodePalette(s.data, 0, n);
  drawSwatches($('lzCanvas'), p.colors);
  $('lzNote').textContent = `${n} colores BGR555 · ${p.bit15Set} con el bit 15 activo${p.bit15Set ? ' (indicio contra la hipótesis de paleta)' : ''}.`;
};

// ------------------------------------------------------------------ sprites
/**
 * Tablas de animación candidatas para una pareja de sprites: mismo nº de entradas. Puntuación con
 * evidencia: fracción de entradas cuyas secuencias solo usan fotogramas que existen en su hoja
 * (tamaño descomprimido / 2048 B por fotograma de 64×64); desempate por nº de secuencias distintas.
 */
function animCandidates(p) {
  const sizeOf = new Map(state.report.compression.lz77.corroborated.map((c) => [parseInt(c.offset, 16), c.decompressedSize]));
  const sheets = readSpriteTable(state.bytes, parseInt(p.sheetTable, 16), p.entries, 'sheet');
  return state.animTables.filter((t) => t.entries === p.entries).map((t) => {
    let fits = 0; const distinct = new Set();
    t.arrays.forEach((a, i) => {
      const frames = (sizeOf.get(sheets[i].data) ?? 0) / 2048;
      const used = a.seqs.slice(0, 2).flatMap((q) => q.cmds.filter((c) => c.op === 'frame').map((c) => c.image));
      if (used.length && used.every((f) => f < frames)) fits++;
      a.seqs.forEach((q) => distinct.add(q.offset));
    });
    return { table: t, fits, distinct: distinct.size };
  }).sort((x, y) => y.fits - x.fits || y.distinct - x.distinct);
}
function setupSprites() {
  const sel = $('spPair');
  sel.innerHTML = state.spritePairs.map((p, i) => `<option value="${i}">${p.sheetTable} + ${p.paletteTable} (${p.relation})</option>`).join('') || '<option>sin parejas</option>';
  setupAnimSelect();
}
function setupAnimSelect() {
  const p = state.spritePairs[+$('spPair').value];
  state.animCands = p ? animCandidates(p) : [];
  $('spAnimTable').innerHTML = state.animCands.map((c, k) => `<option value="${k}">${hex(c.table.start)} · ${c.fits}/${c.table.entries} encajan · ${c.distinct} secuencias</option>`).join('') + '<option value="manual">manual (alternar fotogramas)</option>';
  renderSprite();
}
function renderSprite() {
  stopAnim();
  const p = state.spritePairs[+$('spPair').value]; if (!p) { $('spNote').textContent = 'No hay tablas emparejadas en este archivo.'; return; }
  const i = Math.max(0, Math.min(p.entries - 1, +$('spIndex').value | 0)); $('spIndex').value = i; $('spIndex').max = p.entries - 1;
  const sh = readSpriteTable(state.bytes, parseInt(p.sheetTable, 16) + i * 8, 1, 'sheet')[0];
  const pl = readSpriteTable(state.bytes, parseInt(p.paletteTable, 16) + i * 8, 1, 'palette')[0];
  const tiles = guard(`Hoja de sprite ${i}`, () => decompressLZ77(state.bytes, sh.data).data);
  const pal = guard(`Paleta de sprite ${i}`, () => decodePalette(decompressLZ77(state.bytes, pl.data).data, 0, 16).colors);
  if (!tiles || !pal) return;
  // Ancho: 8 tiles = 64 px, por SPRITE_SHAPE(64x64) (src/pokemon.c:2145). Solo aplicable a hojas múltiplo de 64×64.
  const frameBytes = 64 * 64 / 2, fitsFrames = tiles.length % frameBytes === 0;
  const img = tilesToIndexedImage(tiles, 4, 8);
  const z = +$('spZoom').value;
  draw($('spSheet'), indexedToRGBA(img, pal, { transparentZero: true }), z);
  drawSwatches($('spPal'), pal, 8, 16);
  state.spFrames = fitsFrames ? Array.from({ length: tiles.length / frameBytes }, (_, k) => indexedToRGBA(cropIndexed(img, 0, k * 64, 64, 64), pal, { transparentZero: true })) : [];
  if (state.spFrames.length) draw($('spFrame'), state.spFrames[0], z);
  if (sh.size !== tiles.length) log('warn', `Entrada ${i}: el campo size (${sh.size}) no coincide con el tamaño descomprimido (${tiles.length}); en pokeemerald es la constante MON_PIC_SIZE (src/data.c:301)`, { table: p.sheetTable });
  // Secuencias reales de la tabla de animación elegida
  const choice = state.animCands?.[+$('spAnimTable').value];
  const arr = choice?.table.arrays[i];
  state.spSeqs = arr ? arr.seqs.map((q) => q.cmds.map(animCmdToPack)) : null;
  const seqSel = $('spSeq');
  seqSel.innerHTML = state.spSeqs ? state.spSeqs.map((q, k) => `<option value="${k}">${k}: ${q.length} comandos</option>`).join('') : '<option>—</option>';
  if (state.spSeqs?.length > 1) seqSel.value = '1'; // [0] = sAnim_GeneralFrame0 (fotograma fijo), [1] = animación de la especie
  state.spCurrent = { p, i, sh, pl, tiles, pal };
  $('spNote').textContent = `Ancho de 64 px por ${SOURCES.MonPicOam}. ${fitsFrames ? `La hoja contiene ${state.spFrames.length} fotograma(s) de 64×64.` : 'Esta hoja no es múltiplo de 64×64: el ancho de 8 tiles es una suposición.'} Paleta: misma etiqueta (${pl.tag}) en la tabla emparejada.`;
  $('spInfo').textContent = `entrada ${i}\nhoja:    datos ${hex(sh.data)}  size ${sh.size}  tag ${sh.tag}  → ${tiles.length} B (${tiles.length / 32} tiles)\npaleta:  datos ${hex(pl.data)}  tag ${pl.tag}\n` +
    (arr ? `animación: tabla ${hex(choice.table.start)} → array ${hex(arr.offset)}\n${arr.seqs.map((q, k) => `  [${k}] ${hex(q.offset)}  ${q.cmds.map((c) => c.op === 'frame' ? `F${c.image}:${c.duration}${c.hflip ? 'h' : ''}` : c.op === 'end' ? 'END' : c.op === 'jump' ? `JUMP ${c.target}` : `LOOP ${c.count}`).join(' ')}`).join('\n')}\n` +
      `  ${choice.fits}/${choice.table.entries} entradas usan solo fotogramas existentes. Fuente del layout: ${ANIM_SOURCES.layout}` : 'animación: manual (sin tabla de animación seleccionada)');
}
function stopAnim() { cancelAnimationFrame(state.animTimer); clearInterval(state.animTimer); state.animTimer = null; $('spAnim').textContent = 'Reproducir'; }
$('spAnim').onclick = () => {
  if (state.animTimer) return stopAnim();
  if (!state.spFrames?.length) return log('warn', 'La hoja no se divide en fotogramas de 64×64');
  const z = +$('spZoom').value;
  if (state.spSeqs && $('spAnimTable').value !== 'manual') {
    // Reproductor con la semántica exacta de src/sprite.c, a 60 ticks por segundo
    const player = new AnimationPlayer(state.spSeqs); player.start(+$('spSeq').value);
    let last = performance.now(), acc = 0, shown = -1;
    const loop = (now) => {
      acc += now - last; last = now;
      while (acc >= 1000 / 60) { player.tick(); acc -= 1000 / 60; }
      const f = player.image ?? 0;
      if (f !== shown) {
        if (f >= state.spFrames.length) { log('error', `La secuencia pide el fotograma ${f}; la hoja solo tiene ${state.spFrames.length}`); return stopAnim(); }
        draw($('spFrame'), state.spFrames[f], z); shown = f;
      }
      $('spAnimState').textContent = `cmd ${player.cmdIndex} · fotograma ${f} · espera ${player.delay}${player.ended ? ' · END' : ''}`;
      state.animTimer = requestAnimationFrame(loop);
    };
    state.animTimer = requestAnimationFrame(loop);
  } else {
    if (state.spFrames.length < 2) return log('warn', 'La hoja tiene un solo fotograma');
    let k = 0;
    state.animTimer = setInterval(() => { k = (k + 1) % state.spFrames.length; draw($('spFrame'), state.spFrames[k], z); }, Math.max(50, +$('spMs').value));
  }
  $('spAnim').textContent = 'Detener';
};
$('spPair').addEventListener('change', setupAnimSelect);
['spIndex', 'spZoom', 'spAnimTable'].forEach((id) => $(id).addEventListener('change', renderSprite));
$('spSeq').addEventListener('change', () => { stopAnim(); $('spAnim').click(); });
$('spPrev').onclick = () => { $('spIndex').value = +$('spIndex').value - 1; renderSprite(); };
$('spNext').onclick = () => { $('spIndex').value = +$('spIndex').value + 1; renderSprite(); };
$('spExport').onclick = () => {
  const c = state.spCurrent; if (!c) return;
  const pack = spriteToPack({ id: `sprite_${c.i}`, tiles: c.tiles, palette: c.pal, frameWidth: 64, frameHeight: 64,
    sequences: state.spSeqs ? state.spSeqs.map((q) => q.map(packToAnimCmd)) : undefined,
    meta: { name: `Sprite ${c.i}`, source: `${state.report.file.name} (SHA-1 ${state.report.file.sha1 ?? '?'}) · hoja ${hex(c.sh.data)} · paleta ${hex(c.pl.data)}` } });
  downloadJSON(pack, `sprite_${c.i}.pack.json`);
  log('warn', 'Pack exportado con licencia "UNSPECIFIED": úsalo solo si tienes derechos sobre este recurso.');
};
/** Inverso de animCmdToPack para reutilizar spriteToPack con secuencias ya convertidas. */
const packToAnimCmd = (c) => 'frame' in c ? { op: 'frame', image: c.frame, duration: c.duration, hflip: !!c.hflip, vflip: !!c.vflip } : 'end' in c ? { op: 'end' } : 'jump' in c ? { op: 'jump', target: c.jump } : { op: 'loop', count: c.loop };
function downloadJSON(obj, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------------ mapas
function setupMaps() {
  const L = state.maps.layouts;
  $('mapSel').innerHTML = L.map((l, i) => `<option value="${i}">#${i} ${hex(l.offset)} · ${l.width}×${l.height}</option>`).join('') || '<option>sin layouts</option>';
  renderMapView();
}
function currentPair(l) {
  const ts = new Map(state.maps.tilesets.map((t) => [t.offset, t]));
  return buildTilesetPair(loadTilesetData(state.bytes, ts.get(l.primaryTileset), decodePalette), loadTilesetData(state.bytes, ts.get(l.secondaryTileset), decodePalette, { secondary: true }));
}
function renderMapView() {
  const l = state.maps.layouts[+$('mapSel').value]; if (!l) { $('mapNote').textContent = 'No se encontraron MapLayout en este archivo.'; return; }
  const pair = guard('Carga de tilesets', () => currentPair(l)); if (!pair) return;
  const { img, errors } = renderMap(state.bytes.subarray(l.map, l.map + l.width * l.height * 2), l.width, l.height, pair);
  errors.forEach((e) => log('error', `Mapa ${hex(l.offset)}: ${e}`));
  const rgba = indexedToRGBA(img, pair.palette);
  const c = $('mapCanvas'); draw(c, rgba, +$('mapZoom').value);
  if ($('mapGrid').checked) { const ctx = c.getContext('2d'); ctx.strokeStyle = 'rgba(255,0,255,.35)'; for (let x = 0; x <= l.width; x++) ctx.strokeRect(x * 16, 0, 0, l.height * 16); for (let y = 0; y <= l.height; y++) ctx.strokeRect(0, y * 16, l.width * 16, 0); }
  const P = state.maps.tilesets.find((t) => t.offset === l.primaryTileset), S = state.maps.tilesets.find((t) => t.offset === l.secondaryTileset);
  $('mapNote').textContent = `${errors.length ? `${errors.length} errores de interpretación (ver Registro). ` : 'Sin errores de interpretación. '}Reglas de carga: ${SOURCES.TilesetLoading}.`;
  $('mapInfo').textContent = `layout ${hex(l.offset)}  ${l.width}×${l.height} metatiles  mapa ${hex(l.map)}  borde ${hex(l.border)}
primario   ${hex(P.offset)}  comprimido=${P.isCompressed}  tiles ${hex(P.tiles)}  paletas ${hex(P.palettes)}  metatiles ${hex(P.metatiles)} (${pair.primary.metatileCount})  callback ${P.callback ?? 'NULL'}
secundario ${hex(S.offset)}  comprimido=${S.isCompressed}  tiles ${hex(S.tiles)}  paletas ${hex(S.palettes)}  metatiles ${hex(S.metatiles)} (${pair.secondary.metatileCount})  callback ${S.callback ?? 'NULL'}`;
}
['mapSel', 'mapZoom', 'mapGrid'].forEach((id) => $(id).addEventListener('change', renderMapView));
$('mapExport').onclick = () => {
  const l = state.maps.layouts[+$('mapSel').value]; if (!l) return;
  const pair = guard('Carga de tilesets', () => currentPair(l)); if (!pair) return;
  const { pack, missingMetatiles } = mapToPack({ id: `map_${l.offset.toString(16)}`, mapBytes: state.bytes.subarray(l.map, l.map + l.width * l.height * 2), width: l.width, height: l.height, pair,
    meta: { name: `Layout ${hex(l.offset)}`, source: `${state.report.file.name} (SHA-1 ${state.report.file.sha1 ?? '?'}) · MapLayout ${hex(l.offset)}` } });
  missingMetatiles.forEach((m) => log('error', `Exportación ${hex(l.offset)}: metatile ${m} fuera de la tabla (celda vacía)`));
  downloadJSON(pack, `map_${l.offset.toString(16)}.pack.json`);
  log('warn', 'Pack exportado con licencia "UNSPECIFIED": úsalo solo si tienes derechos sobre este recurso.');
};
$('mapTiles').onclick = () => {
  const l = state.maps.layouts[+$('mapSel').value]; if (!l) return;
  const pair = guard('Carga de tilesets', () => currentPair(l)); if (!pair) return;
  const img = tilesToIndexedImage(pair.primary.tiles, 4, 16);
  draw($('mapCanvas'), indexedToRGBA(img, pair.palette.subarray(0, 16)), 2);
  $('mapNote').textContent = `Tiles del tileset primario (${img.tiles}) con la paleta 0. Cada tile usa en el juego la paleta que indica su metatile; aquí se muestran todos con la 0.`;
};

// ------------------------------------------------------------------ hex / AnimCmd
function hexView(off) {
  if (!state.bytes) return;
  off = Math.max(0, Math.min(state.bytes.length - 1, off)) & ~15;
  $('hexOff').value = hex(off);
  let s = '';
  for (let r = 0; r < 32 && off + r * 16 < state.bytes.length; r++) {
    const o = off + r * 16, row = state.bytes.subarray(o, o + 16);
    s += `${hex(o)}  ${[...row].map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47)}  ${[...row].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')}\n`;
  }
  $('hexOut').textContent = s;
}
$('hexGo').onclick = () => { const o = parseOff($('hexOff').value); Number.isFinite(o) ? hexView(o) : log('warn', 'Offset no válido'); };
$('hexAnim').onclick = () => {
  const o = parseOff($('hexOff').value); if (!state.bytes || !Number.isFinite(o)) return;
  const cmds = guard(`AnimCmd en ${hex(o)}`, () => parseAnimCmds(state.bytes, o));
  $('animOut').textContent = cmds ? `Interpretación como union AnimCmd (include/sprite.h). Es una hipótesis del usuario: nada garantiza que haya una animación en este offset.\n` + cmds.map((c, i) => `${i}: ${JSON.stringify(c)}`).join('\n') : '';
};

// ------------------------------------------------------------------ informe JSON
$('download').onclick = () => {
  const out = {
    ...state.report,
    gameStructures: {
      source: 'pret/pokeemerald (vía github.com/marcoscodas/bravely-emerald), localizadas por forma en este archivo',
      spriteTablePairs: state.spritePairs,
      animationTables: state.animTables.map(summarizeAnimTable),
      mapLayouts: { level: state.maps.level, basis: state.maps.basis, count: state.maps.layouts.length, layouts: state.maps.layouts.map((l) => ({ ...l, offset: hex(l.offset), border: hex(l.border), map: hex(l.map), primaryTileset: hex(l.primaryTileset), secondaryTileset: hex(l.secondaryTileset) })) },
      tilesets: state.maps.tilesets.map((t) => ({ ...t, offset: hex(t.offset), tiles: hex(t.tiles), palettes: hex(t.palettes), metatiles: hex(t.metatiles), metatileAttributes: hex(t.metatileAttributes) })),
    },
    interpretationLog: state.log,
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  a.download = (state.report.file.name || 'rom').replace(/\.[^.]+$/, '') + '.report.json';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
