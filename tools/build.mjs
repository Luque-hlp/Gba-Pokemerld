#!/usr/bin/env node
/**
 * Genera dist/index.html: la aplicación completa en un único archivo (CSS y JS en línea) que funciona
 * abriéndolo con doble clic (file://), donde los navegadores bloquean los módulos ES.
 * Empaquetador mínimo propio: cada módulo se envuelve en una función que devuelve sus exportaciones,
 * y cada `import { a, b as c } from './x.js'` se sustituye por una desestructuración del registro.
 * Falla de forma explícita si encuentra una sintaxis de módulos que no admite.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = new Map(), order = [];
const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm;

function visit(file) {
  if (modules.has(file)) return;
  modules.set(file, null);
  const original = readFileSync(file, 'utf8');
  const deps = [];
  let src = original.replace(IMPORT_RE, (_, names, spec) => {
    const dep = resolve(dirname(file), spec); deps.push(dep);
    const binds = names.split(',').map((n) => n.trim()).filter(Boolean).map((n) => n.replace(/\s+as\s+/, ': ')).join(', ');
    return `const { ${binds} } = __mod[${JSON.stringify(relative(root, dep))}];`;
  });
  if (/^\s*import\s/m.test(src)) throw new Error(`Import no admitido en ${relative(root, file)}`);
  const exported = [];
  src = src.replace(/^export\s+(async\s+function|function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm, (_, kw, name) => { exported.push(name); return `${kw} ${name}`; });
  if (/^\s*export\s/m.test(src)) throw new Error(`Export no admitido en ${relative(root, file)}`);
  // Declaraciones múltiples: export const A = 1, B = 2;
  for (const m of original.matchAll(/^export\s+const\s+(.+);\s*$/gm)) {
    for (const part of m[1].split(/,(?![^(]*\))(?![^{]*\})/)) { const n = part.trim().match(/^([A-Za-z_$][\w$]*)\s*=/); if (n && !exported.includes(n[1])) exported.push(n[1]); }
  }
  deps.forEach(visit);
  modules.set(file, { src, exported });
  order.push(file);
}
visit(resolve(root, 'src/main.js'));

const parts = ['"use strict";', 'const __mod = {};'];
for (const f of order) {
  const { src, exported } = modules.get(f), key = relative(root, f);
  parts.push(`// ---- ${key}`, `__mod[${JSON.stringify(key)}] = (() => {`, src, `return { ${exported.join(', ')} };`, '})();');
}
const js = parts.join('\n').replace(/<\/script/gi, '<\\/script');
let html = readFileSync(resolve(root, 'index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${readFileSync(resolve(root, 'styles.css'), 'utf8')}</style>`)
  .replace('<script type="module" src="src/main.js"></script>', () => `<script>\n${js}\n</script>`);
if (html.includes('type="module"') || html.includes('href="styles.css"')) throw new Error('No se pudo incrustar todo en el HTML');
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/index.html'), html);
console.log(`dist/index.html — ${order.length} módulos, ${(html.length / 1024).toFixed(0)} KiB`);
