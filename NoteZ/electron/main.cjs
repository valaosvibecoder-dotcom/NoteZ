const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const legacyFile = path.join(__dirname, '..', 'data', 'notebooks.json');
const notesFile = () => path.join(app.getPath('userData'), 'notebooks.json');
const waylandFocusState = new WeakMap();
const usesWayland = process.platform === 'linux' && Boolean(process.env.WAYLAND_DISPLAY);

function validNotes(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    value.notebooks && typeof value.notebooks === 'object' && !Array.isArray(value.notebooks);
}

function readNotes() {
  for (const file of [notesFile(), legacyFile]) {
    try {
      const candidate = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (validNotes(candidate)) return candidate;
    } catch {}
  }
  return {
    active: 'Ideas',
    notebooks: {
      Ideas: [{ title: 'Untitled page', strokes: [] }],
      'Daily notes': [{ title: 'Today', strokes: [] }],
      'Reading list': [{ title: 'Books to read', strokes: [] }]
    }
  };
}

ipcMain.handle('notez:load', () => readNotes());
ipcMain.handle('notez:fullscreen', (event, enabled) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (usesWayland) {
    const state = waylandFocusState.get(win) || { active: false, wasMaximized: false };
    if (enabled) {
      if (!state.active) state.wasMaximized = win.isMaximized();
      state.active = true;
      waylandFocusState.set(win, state);
      if (!win.isMaximized()) win.maximize();
    } else {
      state.active = false;
      waylandFocusState.set(win, state);
      if (!state.wasMaximized && win.isMaximized()) win.unmaximize();
    }
    return Boolean(enabled);
  }
  win.setFullScreen(Boolean(enabled));
  return win.isFullScreen();
});
ipcMain.handle('notez:save', (_event, notes) => {
  if (!validNotes(notes)) throw new TypeError('Refusing to save invalid notebook data');
  const file = notesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(notes, null, 2));
  fs.renameSync(temporaryFile, file);
  return true;
});
ipcMain.handle('notez:export-pdf', async (event, options = {}) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const title = String(options.title || 'NoteZ page').replace(/[\\/:*?"<>|]/g, '-').slice(0, 100) || 'NoteZ page';
  const { canceled, filePath } = await dialog.showSaveDialog(senderWindow, {
    title: 'Export page as PDF', defaultPath: `${title}.pdf`, filters: [{ name: 'PDF document', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return false;
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const styles = ['dots', 'ruled', 'squared', 'plain'].includes(options.style) ? options.style : 'dots';
  const spacing = Math.max(12, Math.min(40, Number(options.spacing) || 24));
  const paper = /^#[0-9a-f]{6}$/i.test(options.paperColor) ? options.paperColor : '#fffefa';
  const grid = /^#[0-9a-f]{6}$/i.test(options.gridColor) ? options.gridColor : '#cbd1ce';
  const image = typeof options.image === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(options.image) ? options.image : '';
  const background = styles === 'dots' ? `radial-gradient(${grid} .65px, transparent .65px)` : styles === 'squared' ? `linear-gradient(${grid} 1px,transparent 1px),linear-gradient(90deg,${grid} 1px,transparent 1px)` : styles === 'ruled' ? `linear-gradient(transparent calc(100% - 2px),${grid} calc(100% - 1px),transparent 100%)` : 'none';
  const backgroundSize = styles === 'ruled' ? `100% ${spacing}px` : `${spacing}px ${spacing}px`;
  const exportWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:0}*{box-sizing:border-box}html,body{margin:0;width:297mm;height:210mm;background:${paper};font-family:Georgia,serif}.sheet{width:297mm;height:210mm;position:relative;overflow:hidden;background-color:${paper};background-image:${background};background-size:${backgroundSize}}.title{position:absolute;z-index:2;top:4mm;left:18mm;margin:0;padding:0 3mm;color:#34413d;background:${paper};font-size:13pt;font-weight:normal}.ink{position:absolute;inset:12mm 0 0;width:100%;height:calc(100% - 12mm);object-fit:contain}</style></head><body><main class="sheet"><h1 class="title">${escapeHtml(options.title || 'Untitled page')}</h1>${image ? `<img class="ink" src="${image}">` : ''}</main></body></html>`;
  try {
    await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await exportWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    fs.writeFileSync(filePath, pdf);
    return true;
  } finally { if (!exportWindow.isDestroyed()) exportWindow.destroy(); }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 780,
    minHeight: 560,
    title: 'NoteZ',
    backgroundColor: '#f7f7f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const reportFullscreen = () => {
    const focusMode = usesWayland ? Boolean(waylandFocusState.get(win)?.active) : win.isFullScreen();
    win.webContents.send('notez:fullscreen-change', focusMode);
  };
  win.on('enter-full-screen', reportFullscreen);
  win.on('leave-full-screen', reportFullscreen);
  if (usesWayland) {
    win.on('maximize', reportFullscreen);
    win.on('unmaximize', reportFullscreen);
  }
  win.webContents.on('console-message', event => console.log(`[NoteZ renderer] ${event.message}`));
  win.webContents.on('render-process-gone', (_event, details) => console.error('[NoteZ renderer exited]', details));
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
