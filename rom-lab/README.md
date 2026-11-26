# gba-rom-lab

Investigación de la estructura de ROMs de GBA y decodificación de formatos gráficos. Está escrito en **JavaScript nativo (ESM), sin dependencias**. El núcleo (`src/`) no usa APIs de Node, de modo que el mismo código servirá para la CLI, la herramienta de inspección en navegador y el motor.

## Uso

### Herramienta web (HTML + CSS + JavaScript, sin bibliotecas)
Abre **`dist/inspector.html`** con doble clic en cualquier navegador moderno y selecciona o arrastra el archivo `.gba`. La ROM se lee en memoria: no se sube a ningún sitio ni se modifica. Pestañas:
- **Resumen:** metadatos, cabecera, guardado y estructuras validadas, con su nivel de evidencia.
- **Regiones:** mapa de entropía por bloques de 4 KiB.
- **Recursos LZ77:** descompresión y vista como tiles 4/8bpp o como paleta. El ancho y la paleta los eliges tú.
- **Sprites:** tablas de sprites emparejadas con sus paletas por etiqueta, con animación manual de fotogramas.
- **Mapas:** reconstrucción completa de `MapLayout` (tilesets, paletas, metatiles), con rejilla opcional.
- **Hex / AnimCmd:** volcado hexadecimal e interpretación de secuencias de animación.
- **Registro:** errores de interpretación, y descarga del informe JSON con todo lo anterior.

Para desarrollar, `web/` usa módulos ES y necesita servirse por HTTP (`python3 -m http.server`). Tras cambiar `src/` o `web/`, se regenera el archivo único:
```bash
node tools/build-standalone.mjs
```

### Motor HTML5
Abre **`dist/engine.html`**: carga un pack de demostración original o cualquier pack `gba-asset-pack` (por ejemplo, uno exportado desde el inspector). Formato y arquitectura: [docs/ENGINE.md](docs/ENGINE.md).

### CLI y pruebas
```bash
npm test                                      # pruebas con datos sintéticos (node:test)
node cli/analyze.js ruta/a/rom.gba reports/x.json
```
La ROM se abre en solo lectura y el informe comprueba que el buffer no cambia (`file.unmodified`).

## Estructura y separación de responsabilidades
```
src/core/        BinaryReader (lectura LE con límites), crc32
src/analyzer/    FASE 1 · analizador binario (no sabe nada de Canvas ni del motor)
  header.js        cabecera GBA + checksum + salto de entrada
  regions.js       entropía, relleno, fin de datos
  pointers.js      punteros ROM/EWRAM/IWRAM, tablas contiguas
  lz77scan.js      detección por descompresión de prueba + corroboración por puntero
  tables.js        descubrimiento de tablas con paso fijo y campos de tamaño
  strings.js       ASCII y firmas de guardado
  analyzeRom.js    orquestador → informe JSON
src/decoders/    FASE 2–3 · decodificadores puros (bytes → índices → RGBA), sin DOM
  lz77.js          SWI 0x11/0x12: descompresor + compresor para generar datos de prueba
  palette.js       BGR555 → RGBA
  tiles.js         tiles 4bpp/8bpp, disposición 1D, volteos
  tilemap.js       fondos de texto (screenblocks) y afines
  image.js         indexado → RGBA (ImageData), recortes
  metatile.js      metatiles y mapas de pokeemerald (específico del juego)
  anim.js          union AnimCmd de pokeemerald (específico del juego)
src/structures/  estructuras del juego (definiciones de la descompilación), localizadas por forma y validadas
web/             interfaz (index.html, styles.css, app.js): solo presentación
src/engine/      FASE 5 · motor: AssetPack (formato + validación), Palette/Tile/Tilemap/Sprite/AnimationManager, Engine
src/export/      decodificado → gba-asset-pack
src/demo/        pack de demostración con arte original generado por código (CC0)
tools/           build-standalone.mjs → dist/inspector.html y dist/engine.html (archivos únicos, funcionan en file://)
src/report/      niveles de evidencia (confirmed / corroborated / hypothesis / rejected)
cli/             adaptadores Node
tests/           datos sintéticos generados en las pruebas; ninguna depende de una ROM
docs/FORMATS.md  referencia de formatos (con fuente y nivel de evidencia)
docs/ANALISIS_BPES.md  hallazgos de la ROM analizada
```

## Hoja de ruta (cada fase se cierra con pruebas antes de pasar a la siguiente)
| Fase | Contenido | Estado |
|---|---|---|
| 1 | Analizador binario, sistema de evidencia, documentación de formatos | ✅ |
| 1b | Descompresor LZ77 (lo necesita la detección) | ✅ 7 pruebas |
| 2 | Decodificadores: BGR555, tiles 4bpp/8bpp, tilemaps, metatiles, AnimCmd → `ImageData` | ✅ 13 pruebas |
| 3 | Verificación de H3 y de las estructuras de mapas con definiciones de la descompilación | ✅ H3 confirmada; H1 y animaciones pendientes |
| 4 | Herramienta de inspección web (`dist/inspector.html`) | ✅ prueba E2E en Chromium |
| 3b | Tablas de animación por forma; 0x30FD10 confirmada (440/440) frente a la descompilación | ✅ |
| 5 | Motor con 5 gestores, formato `gba-asset-pack` v1, demo original y exportación desde el inspector | ✅ 14 pruebas + E2E en Chromium |

El motor solo depende del formato intermedio. Funciona con recursos propios o con licencia sin cambiar código, y el analizador sigue siendo una herramienta de desarrollo separada.
