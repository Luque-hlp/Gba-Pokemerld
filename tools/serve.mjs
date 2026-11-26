#!/usr/bin/env node
/** Servidor estático local mínimo (solo desarrollo): node tools/serve.mjs [puerto] */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
const root = resolve(new URL('..', import.meta.url).pathname);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const port = +(process.argv[2] ?? 8080);
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, path.endsWith('/') ? path + 'index.html' : path);
  if (!file.startsWith(root) || /\.(gba|sav|zip)$/i.test(file)) { res.writeHead(403).end(); return; } // nunca servir ROMs
  try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(data); }
  catch { res.writeHead(404).end('No encontrado'); }
}).listen(port, () => console.log(`http://localhost:${port}/`));
