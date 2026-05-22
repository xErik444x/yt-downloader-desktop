# YTDlDesktop

Aplicacion de escritorio para descargar videos y audio de YouTube y otros sitios usando [yt-dlp](https://github.com/yt-dlp/yt-dlp).

## Requisitos

- [Node.js](https://nodejs.org/) (v18 o superior)
- [pnpm](https://pnpm.io/)

## Instalacion

```bash
pnpm install
```

## Desarrollo

```bash
pnpm start
```

## Build (Windows .exe)

```bash
pnpm run build
```

El instalador se genera en la carpeta `dist/` como `YTDlDesktop Setup 1.0.0.exe`.

## Uso

1. Ejuta la aplicacion
2. Pega una URL de YouTube (video o playlist)
3. Analiza para ver opciones de formato
4. Selecciona video o solo audio (MP3)
5. Descarga y espera a que termine

## Estructura

```
yt-dl-desktop/
├── src/
│   ├── main.js          # Proceso principal de Electron
│   ├── preload.cjs      # Bridge seguro entre main y renderer
│   └── ui/              # Interfaz de usuario (HTML/CSS/JS)
├── bin/                 # Dependencias externas (yt-dlp, ffmpeg)
├── dist/                # Build output (generado)
└── package.json
```
