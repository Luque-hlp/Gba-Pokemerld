#!/usr/bin/env node
/**
 * Genera dist/inspector.html: un único archivo HTML autocontenido (CSS + JS en línea) que funciona
 * abriéndolo con doble clic (file://), donde los navegadores bloquean los módulos ES.
 * Empaquetador mínimo propio, sin dependencias: cada módulo se envuelve en una función, sus `export`
 * se devuelven como objeto y cada `import { a, b as c } from './x.js'` se sustituye por una
 * desestructuración del registro. Solo admite la sintaxis usada en este proyecto (y falla si encuentra otra).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = [
  { html: 'web/index.html', js: 'web/app.js', out: 'dist/inspector.html' },
  { html: 'web/engine.html', js: 'web/engine-demo.js', out: 'dist/engine.html' },
];
let modules, order;

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm;
function visit(file) {
  if (modules.has(file)) return;
  modules.set(file, null);
  let src = readFileSync(file, 'utf8');
  const deps = [];
  src = src.replace(IMPORT_RE, (_, names, spec) => {
    const dep = resolve(dirname(file), spec); deps.push(dep);
    const binds = names.split(',').map((n) => n.trim()).filter(Boolean).map((n) => n.replace(/\s+as\s+/, ': ')).join(', ');
    return `const { ${binds} } = __mod[${JSON.stringify(relative(root, dep))}];`;
  });
  if (/^\s*import\s/m.test(src)) throw new Error(`Import no soportado en ${relative(root, file)}`);
  const exported = [];
  src = src.replace(/^export\s+(async\s+function|function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm, (_, kw, name) => { exported.push(name); return `${kw} ${name}`; });
  if (/^\s*export\s/m.test(src)) throw new Error(`Export no soportado en ${relative(root, file)}: ${src.match(/^\s*export\s.*$/m)[0]}`);
  deps.forEach(visit);
  modules.set(file, { src, exported });
  order.push(file);
}
for (const page of PAGES) {
modules = new Map(); order = [];
visit(resolve(root, page.js));

// Declaraciones múltiples exportadas (p. ej. `export const ANIM_END = -1, ANIM_JUMP = -2, ...`)
for (const [file, m] of modules) {
  const orig = readFileSync(file, 'utf8');
  for (const line of orig.matchAll(/^export\s+const\s+(.+);\s*$/gm)) {
    for (const part of line[1].split(/,(?![^(]*\))/)) { const n = part.trim().match(/^([A-Za-z_$][\w$]*)\s*=/); if (n && !m.exported.includes(n[1])) m.exported.push(n[1]); }
  }
}

const bundle = ['"use strict";', 'const __mod = {};'];
for (const file of order) {
  const { src, exported } = modules.get(file);
  const key = relative(root, file);
  bundle.push(`// ---- ${key}`, `__mod[${JSON.stringify(key)}] = (() => {`, src, `return { ${exported.join(', ')} };`, '})();');
}
const js = bundle.join('\n').replace(/<\/script/gi, '<\\/script');
const html = readFileSync(resolve(root, page.html), 'utf8')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${readFileSync(resolve(root, 'web/styles.css'), 'utf8')}</style>`)
  .replace(/<script type="module" src="[^"]+"><\/script>/, () => `<script>\n${js}\n</script>`);
if (html.includes('type="module"')) throw new Error(`No se pudo incrustar el script en ${page.html}`);
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, page.out), html);
console.log(`${page.out} — ${order.length} módulos, ${(html.length / 1024).toFixed(1)} KiB`);
}
