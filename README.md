# NoteZ

[![Latest Linux release](https://img.shields.io/github/v/release/valaosvibecoder-dotcom/NoteZ?label=Download%20for%20Linux)](https://github.com/valaosvibecoder-dotcom/NoteZ/releases/latest)

NoteZ is a local-first Linux desktop notebook for handwritten notes and sketches. Organize work into notebooks and pages, write with a stylus or mouse, customize the page and ink, and export individual pages as PDFs. Notes are saved on your computer; NoteZ does not currently provide cloud sync or account-based storage.

## Features

- **Notebooks and pages:** Create, rename, and delete notebooks. Each notebook can contain any number of pages, and its page list expands when you open it. Pages can be renamed, deleted, favorited, and opened from Recent or Favorites.
- **Handwriting and drawing:** Use the pen, pencil, highlighter, marker, eraser, straight-line, and text tools. Adjust stroke thickness and handwriting smoothing. Pen pressure is used when the input device provides pressure data.
- **Tablet input:** Palm rejection helps prevent accidental marks while writing. With palm rejection enabled, use fingers to scroll the page.
- **Paper and appearance:** Choose dotted, ruled, squared, or plain paper. Set the paper color and grid spacing, and choose an application theme. Paper color is independent of the app theme.
- **Ink colors:** Choose and save ink color presets, add new colors, and remove presets. A supported stylus button can cycle through the saved colors.
- **Editing and navigation:** Undo and redo page edits, zoom, move between pages, and use the focused full-page writing view.
- **PDF export:** Export an individual page from its page menu or the page context menu. NoteZ opens a save dialog for the PDF.
- **Local persistence:** Notes and settings are saved automatically in the operating system's per-user application-data directory.

## Install the Linux app

The download link at the top of this page opens the latest release. Download the x86-64 Linux AppImage named `NoteZ-<version>-x86_64.AppImage`. Then run:

```bash
chmod +x NoteZ-1.0.0-x86_64.AppImage
./NoteZ-1.0.0-x86_64.AppImage
```

AppImages require a compatible Linux system and FUSE support. If your distribution cannot run AppImages, use the source build instructions below or follow your distribution's AppImage/FUSE setup instructions.

## Publish a release

Releases are built and published automatically by GitHub Actions. Update the version in `NoteZ/package.json` and `NoteZ/package-lock.json` to the same version, commit those changes, then push a matching version tag. For example, for version `1.0.1`:

```bash
git tag v1.0.1
git push origin v1.0.1
```

The workflow builds the AppImage and attaches it to a GitHub Release. The download link above will then point to that release.

## Run from source

### Requirements

- Linux x86-64
- Node.js and npm (use a current Node.js LTS release)

Clone the repository, enter the application directory, install the locked dependencies, and start NoteZ:

```bash
git clone https://github.com/valaosvibecoder-dotcom/NoteZ.git
cd NoteZ/NoteZ
npm ci
npm start
```

`npm start` runs NoteZ from source with Electron. The `./Note-Z` helper in the application directory launches the unpacked Linux build after it has been created.

## Build a distributable

From `NoteZ/NoteZ` on Linux x86-64:

```bash
npm ci
npm run dist
```

The AppImage is written to `NoteZ/NoteZ/dist/NoteZ-<version>-x86_64.AppImage`. To create an unpacked build for local inspection instead, run:

```bash
npm run pack
```

The unpacked app is written to `NoteZ/NoteZ/dist/linux-unpacked/`. Launch it with `./dist/linux-unpacked/NoteZ` from the application directory, or run `./Note-Z` there after packaging.

The current release configuration targets Linux x86-64 only. macOS and Windows builds are not configured.

## Where notes are stored

NoteZ stores notebooks and settings in `notebooks.json` inside Electron's per-user `userData` directory. The exact directory depends on the Linux desktop environment and Electron's application name. The application does not sync this file to a server. Back up this file if you want to preserve notes when moving to another computer. Exported PDFs are saved to the location you choose in the save dialog.

## Linux launch note

On Linux, NoteZ currently starts Electron with Chromium's `--no-sandbox` switch to work around systems where Electron's setuid `chrome-sandbox` helper is not installed with root ownership and mode `4755`. The renderer still uses Electron's context isolation and sandbox settings, but Chromium's process sandbox is disabled by this switch. Only run builds you trust. The app also avoids `/dev/shm` for Chromium shared-memory files, which helps on systems where that location is unavailable.

## Project layout

```text
NoteZ/
  electron/
    main.cjs          Electron main process, persistence, PDF export, window setup
    preload.cjs       Narrow, isolated API exposed to the renderer
  src/
    index.html        Application interface
    app.js            UI state, notebooks, pages, settings, and event handling
    drawing.js        Canvas input, rendering, stylus pressure, and drawing tools
    history.js        Undo and redo history
    notebook-data.js  Notebook data validation and normalization
    styles.css        Application and page styling
  build/
    icon.png          Linux application icon
    icon.svg          Source icon artwork
```

## License

No license has been added yet. Until a license is chosen and included, the source is public to view but standard copyright restrictions still apply; publishing the repository does not by itself grant permission to reuse or redistribute it.
