# Motor HTML5 y formato `gba-asset-pack`

## Principio
El motor **solo** consume el formato intermedio `gba-asset-pack` v1. **Nunca lee una ROM.** El analizador y los decodificadores (`src/analyzer`, `src/decoders`, `src/structures`) son herramientas de desarrollo separadas. Producen packs mediante `src/export/toPack.js`, y el motor no depende de ellas salvo por las funciones puras de dibujo de tiles.

```
ROM ─► analizador ─► decodificadores ─► export/toPack ─► pack JSON ─► Engine
                                                   (o pack hecho a mano / generado: src/demo)
Engine
 ├─ PaletteManager   paletas RGBA; fundidos (como BLDY) y ciclos de color; versión para invalidar cachés
 ├─ TileManager      tiles 8×8 decodificados una vez a índices
 ├─ TilemapManager   capas con entradas de fondo de texto GBA; composición indexada + color con la paleta vigente
 ├─ SpriteManager    definiciones (mapeo OBJ 1D) e instancias; fotogramas cacheados por versión de paleta
 └─ AnimationManager reproductores con la semántica exacta de src/sprite.c de pokeemerald
```
Bucle de tiempo fijo a 60 Hz (un tick = un fotograma del GBA). El dibujo se hace con `requestAnimationFrame`. Solo `Engine.draw/run` tocan el DOM: el resto se prueba en Node.

## Formato v1
```jsonc
{
  "format": "gba-asset-pack", "version": 1,
  "meta": { "name": "…", "license": "CC0-1.0", "source": "procedencia" },  // sin license → advertencia
  "palettes": { "<id>": { "colors": ["#rrggbb", …] } },        // múltiplo de 16; índice 0 = transparente
  "tilesets": { "<id>": { "bpp": 4, "data": "<base64>" } },     // datos en formato GBA (4bpp: nibble bajo = píxel izq.)
  "tilemaps": { "<id>": {
      "tileset": "<id>", "width": 40, "height": 30,             // en tiles de 8×8
      "palettes": ["<id>", null, …],                            // una paleta por banco (bits 12–15 de la entrada)
      "layers": [ { "entries": [u16, …] } ]                     // tile 0–9, hflip 10, vflip 11, banco 12–15; capa 0 = fondo
  } },
  "sprites": { "<id>": { "tileset": "<id>", "palette": "<id>", "frameWidth": 16, "frameHeight": 16, "mapping": "1d" } },
  "animations": { "<id>": { "sprite": "<id>", "sequences": [
      [ { "frame": 0, "duration": 15, "hflip": false }, { "frame": 1, "duration": 20 }, { "jump": 0 } ]
  ] } }
}
```
`validatePack` comprueba los tipos, las longitudes y **todas las referencias cruzadas**. Devuelve errores (el pack se rechaza) y advertencias (por ejemplo, la licencia ausente).

## Semántica de animación (verificada con pruebas)
Fuente: `src/sprite.c` de la descompilación (`BeginAnim`, `ContinueAnim`, `AnimCmd_*`, `JumpToTopOfAnimLoop`).
| Comando | Comportamiento |
|---|---|
| `frame d` | Visible `max(d,1)` ticks |
| `end` | La animación se detiene en el último fotograma (`ended = true`) |
| `jump t` | Salta al índice `t` y aplica ese fotograma en el mismo tick |
| `loop n` | Vuelve al inicio del bloque n veces: **el bloque se ejecuta n+1 veces** |

## Demo
`dist/engine.html` (o `web/engine.html` servido por HTTP) carga por defecto un pack de **arte original generado por código** (`src/demo/demoPack.js`, CC0): mapa de 40×30 tiles con dos capas, un personaje con 6 secuencias, colisión simple, ciclo de paleta del agua y fundido. También acepta cualquier pack JSON. Con packs genéricos permite elegir la secuencia de animación y desplazar la cámara.

## Exportación desde el inspector
Las pestañas Sprites y Mapas exportan al formato del motor:
- Un sprite se exporta con su paleta y sus secuencias reales.
- Un mapa se aplana de metatiles a 2 capas de tiles, con 13 bancos de paleta y el tileset combinado en el orden de VRAM.

Los packs exportados llevan `license: "UNSPECIFIED"` y su procedencia (SHA-1 de la ROM y offsets), y el motor muestra la advertencia. **Solo deben usarse con recursos sobre los que se tienen derechos.**
