#!/usr/bin/env node
/**
 * Uso: node cli/analyze.js <rom.gba> [salida.json]
 * Abre el archivo en solo lectura, analiza y escribe un informe JSON. Nunca escribe en la ROM.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { analyzeRom } from '../src/analyzer/analyzeRom.js';

const [, , input, output] = process.argv;
if (!input) { console.error('Uso: node cli/analyze.js <rom.gba> [salida.json]'); process.exit(2); }

const buf = readFileSync(input, { flag: 'r' });
const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
const sha1 = createHash('sha1').update(bytes).digest('hex');
const report = analyzeRom(bytes, { fileName: basename(input), sha1 }, (s) => process.stderr.write(`· ${s}\n`));

const json = JSON.stringify(report, null, 2);
if (output) { writeFileSync(output, json); console.error(`Informe: ${output} (${(json.length / 1024).toFixed(0)} KiB)`); }
else process.stdout.write(json);
if (report.errors.length) { console.error('Errores de interpretación:', report.errors); process.exitCode = 1; }
