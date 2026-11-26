/**
 * Orquestador del análisis binario. Entrada: Uint8Array (no se modifica). Salida: objeto JSON-serializable.
 * Funciona igual en Node y en navegador (sin APIs de Node).
 */
import { parseHeader } from './header.js';
import { mapRegions, findDataEnd } from './regions.js';
import { scanPointers, topTargets } from './pointers.js';
import { scanLZ77 } from './lz77scan.js';
import { findStridedTables } from './tables.js';
import { scanAscii, detectSaveType } from './strings.js';
import { crc32 } from '../core/crc32.js';
import { hex } from '../core/BinaryReader.js';
import { Evidence, claim } from '../report/evidence.js';

export const REPORT_SCHEMA_VERSION = 1;

/**
 * @param {Uint8Array} bytes
 * @param {object} [meta] { fileName, sha1 } (el SHA-1 lo calcula el llamador si dispone de crypto)
 * @param {(stage:string)=>void} [onProgress]
 */
export function analyzeRom(bytes, meta = {}, onProgress = () => {}) {
  const t0 = Date.now();
  const errors = [];
  const stage = (name, fn) => {
    onProgress(name);
    try { return fn(); } catch (e) { errors.push({ stage: name, message: e.message }); return null; }
  };

  const crcBefore = crc32(bytes);
  const size = bytes.length;
  const pow2 = (size & (size - 1)) === 0;
  const fileClaims = [
    claim(`Tamaño ${size} bytes (${(size / 1048576).toFixed(2)} MiB)${pow2 ? ', potencia de 2' : ''}`, Evidence.CONFIRMED, 'Medición directa'),
    size <= 0x2000000
      ? claim('Cabe en el espacio de ROM de 32 MiB (0x08000000–0x09FFFFFF)', Evidence.CONFIRMED, 'GBATEK: mapa de memoria')
      : claim('Excede 32 MiB: no es una ROM GBA estándar', Evidence.REJECTED, 'GBATEK'),
  ];

  const header = stage('header', () => parseHeader(bytes));
  const dataEnd = stage('dataEnd', () => findDataEnd(bytes));
  const regions = stage('regions', () => mapRegions(bytes, 4096));
  const ptr = stage('pointers', () => scanPointers(bytes, { limit: dataEnd?.dataEnd }));
  const lz = stage('lz77', () => scanLZ77(bytes, ptr?.refs, { limit: dataEnd?.dataEnd }));

  const corroborated = (lz?.candidates ?? []).filter((c) => c.level === Evidence.CORROBORATED);
  const lzByOffset = new Map(corroborated.map((c) => [c.offset, c]));
  const tables = stage('tables', () => findStridedTables(bytes, lzByOffset, ptr.refs));
  const ascii = stage('ascii', () => scanAscii(bytes.subarray(0, dataEnd?.dataEnd ?? size)));
  const save = stage('saveType', () => detectSaveType(bytes.subarray(0, dataEnd?.dataEnd ?? size)));

  // Resumen de formatos posibles entre recursos corroborados
  const formatSummary = {};
  for (const c of corroborated) for (const f of c.possibleFormats) formatSummary[f.format] = (formatSummary[f.format] || 0) + 1;

  const crcAfter = crc32(bytes);
  if (crcAfter !== crcBefore) errors.push({ stage: 'integrity', message: 'El buffer cambió durante el análisis' });

  const fmt = (c) => ({ ...c, offset: hex(c.offset), referenceSites: c.referenceSites.map((s) => hex(s)) });
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    file: { name: meta.fileName ?? null, size, crc32: hex(crcBefore), sha1: meta.sha1 ?? null, unmodified: crcAfter === crcBefore, claims: fileClaims },
    header,
    layout: dataEnd && {
      dataEnd: hex(dataEnd.dataEnd), paddingByte: dataEnd.paddingByte, paddingSize: dataEnd.paddingSize,
      usedPercent: +((dataEnd.dataEnd / size) * 100).toFixed(2),
      claims: [claim(`Datos útiles hasta ${hex(dataEnd.dataEnd)}; el resto es relleno ${dataEnd.paddingByte}`, Evidence.CONFIRMED, 'Recorrido inverso del archivo')],
    },
    regions,
    pointers: ptr && {
      stats: ptr.stats,
      topTargets: topTargets(ptr.refs, 25),
      longestContiguousTables: [...ptr.runs].sort((a, b) => b.count - a.count).slice(0, 40).map((r) => ({ start: hex(r.start), entries: r.count, level: Evidence.HYPOTHESIS })),
      note: 'Puntero candidato = palabra alineada en 0x08000000..0x08000000+tamaño. Señal estadística; puede haber coincidencias casuales.',
    },
    compression: lz && {
      lz77: {
        stats: { ...lz.stats,
          corroborated: corroborated.length,
          hypothesis: lz.candidates.filter((c) => c.level === Evidence.HYPOTHESIS).length,
          rejected: lz.candidates.filter((c) => c.level === Evidence.REJECTED).length,
          corroboratedCompressedBytes: corroborated.reduce((a, c) => a + c.compressedSize, 0),
          corroboratedDecompressedBytes: corroborated.reduce((a, c) => a + c.decompressedSize, 0) },
        possibleFormatCounts: formatSummary,
        corroborated: corroborated.map(fmt),
        hypothesis: lz.candidates.filter((c) => c.level === Evidence.HYPOTHESIS).slice(0, 300).map(fmt),
      },
    },
    structures: { stridedTables: tables },
    strings: ascii,
    saveType: save,
    errors,
  };
}
