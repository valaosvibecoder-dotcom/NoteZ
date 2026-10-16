# NoteZ

NoteZ is a Linux desktop notebook for handwritten notes. It includes pen, pencil, highlighter and eraser tools, pressure-aware ink, notebook folders, multi-page notebooks, paper styles, themes, and PDF export.

## Run from source

Requirements: Node.js and npm.

```bash
npm install
npm start
```

## Build Linux releases

```bash
npm install
npm run dist
```

The `dist` directory contains an x64 Linux AppImage. It can be run directly or shared as a single executable file.

For the unpacked development build, run `npm run pack`, then start it with `./Note-Z` from the project directory.

## Data and exports

Notes are stored locally in the operating system's NoteZ application-data directory. Exported pages are written to the location selected in the save dialog.
