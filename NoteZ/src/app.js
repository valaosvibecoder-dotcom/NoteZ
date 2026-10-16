import { createDrawingSurface } from './drawing.js';
import { EditHistory } from './history.js';
import { normalizeNotes } from './notebook-data.js';

// App-level state and coordination. Canvas input/rendering, edit history, and
// notebook data rules live in their own modules.
(() => {
  const $ = selector => document.querySelector(selector);
  const paper = $('#paper'), surface = $('#pageSurface'), hint = $('#hint'), savedStatus = $('#savedStatus');
  document.body.style.pointerEvents = 'none';

  let data, book, pageIndex = 0, tool = 'pen', color = '#293b34', width = 2.8, lastRenderedPage = null;
  let smoothing = 40, palmRejection = true, saveTimer;
  const history = new EditHistory();
  const pages = () => data.notebooks[book];
  const page = () => pages()?.[pageIndex];
  const askName = (promptText, initial = '') => {
    const dialog = $('#nameDialog'), input = $('#nameInput');
    $('#namePrompt').textContent = promptText; input.value = initial;
    const cancel = dialog.querySelector('[value="cancel"]'); cancel.type = 'button'; cancel.onclick = () => dialog.close('cancel');
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'save' ? input.value.trim() : ''), { once: true });
      dialog.showModal(); input.focus(); input.select();
    });
  };
  const confirmAction = (title, message) => {
    const dialog = $('#confirmDialog'); $('#confirmTitle').textContent = title; $('#confirmMessage').textContent = message;
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
      dialog.showModal();
    });
  };
  const showNotice = (title, message) => {
    const dialog = $('#noticeDialog'); $('#noticeTitle').textContent = title; $('#noticeMessage').textContent = message; dialog.showModal();
  };
  const askText = () => {
    const dialog = $('#textDialog'), input = $('#textInput'); input.value = '';
    const cancel = dialog.querySelector('[value="cancel"]'); cancel.type = 'button'; cancel.onclick = () => dialog.close('cancel');
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'save' ? input.value.trim() : ''), { once: true });
      dialog.showModal(); input.focus();
    });
  };
  const save = (immediate = false) => {
    if (!data?.notebooks) return;
    savedStatus.textContent = 'Saving…'; clearTimeout(saveTimer);
    const persist = async () => {
      try { await window.notez.save(data); savedStatus.textContent = 'Saved'; }
      catch (error) { console.error('Could not save notes:', error); savedStatus.textContent = 'Save failed'; }
    };
    if (immediate) void persist();
    else saveTimer = setTimeout(persist, 250);
  };
  window.addEventListener('beforeunload', () => {
    clearTimeout(saveTimer);
    if (data?.notebooks) void window.notez.save(data);
  });
  const drawing = createDrawingSurface({
    canvas: $('#canvas'), paper, surface, hint, getPage: () => data && page(), getTool: () => tool,
    getInk: () => color, getWidth: () => width, getSmoothing: () => smoothing,
    getPaperSpacing: () => Number(data?.settings.paperSpacing) || 24,
    getPalmRejection: () => palmRejection, getText: askText, history, onChange: () => save(true),
    onCycleColor: () => cycleInkPreset()
  });
  const renderPage = () => {
    const current = page();
    if (current && lastRenderedPage && current !== lastRenderedPage && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      paper.animate([{ opacity: .76 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    }
    lastRenderedPage = current || null;
    const empty = !current;
    $('#emptyState').hidden = !empty;
    $('.page-head').hidden = empty; paper.hidden = empty; $('.footer').hidden = empty;
    if (empty) {
      paper.style.removeProperty('--page-paper-color');
      $('#bookCrumb').textContent = book || 'No notebook'; $('#pageCrumb').textContent = 'No page';
      $('#pageNumber').textContent = '00'; $('#pageCount').textContent = '0 / 0';
      $('#emptyTitle').textContent = book ? 'This notebook has no pages' : 'Your library is empty';
      $('#emptyCopy').textContent = book ? 'Add a page to start writing in this notebook.' : 'Create a notebook to start organizing your notes.';
      $('#emptyAction').textContent = book ? 'Add a page' : 'Create notebook';
      return;
    }
    $('#bookCrumb').textContent = book;
    $('#title').value = current.title || 'Untitled page';
    $('#pageCrumb').textContent = current.title || 'Untitled page';
    $('#pageNumber').textContent = String(pageIndex + 1).padStart(2, '0');
    $('#pageCount').textContent = `${pageIndex + 1} / ${pages().length}`;
    const favorite = Boolean(current.favorite);
    $('#favoritePage').textContent = favorite ? '★' : '☆';
    $('#favoritePage').setAttribute('aria-pressed', String(favorite));
    $('#favoritePage').setAttribute('aria-label', favorite ? 'Remove page from Favorites' : 'Add page to Favorites');
    $('#favoritePage').title = favorite ? 'Remove from Favorites' : 'Add to Favorites';
    const style = current.paper || data.settings.paper || 'dots';
    paper.dataset.style = style; surface.dataset.style = style;
    const pageColor = current.paperColor || data.settings.paperColor || themeColor('--paper');
    paper.style.setProperty('--page-paper-color', pageColor);
    $('#pageColorPicker').value = current.paperColor || data.settings.paperColor || themeColor('--paper');
    $('#paperLabel').textContent = ({ dots: 'Dots', ruled: 'Ruled', squared: 'Squares', plain: 'Plain' })[style];
    hint.classList.toggle('hide', current.strokes.length > 0); drawing.resize();
  };
  const renamePage = async (notebook, index) => {
    const item = data.notebooks[notebook]?.[index]; if (!item) return;
    const title = await askName('Page name', item.title || 'Untitled page');
    if (!title || title === item.title) return;
    item.title = title;
    if (notebook === book && index === pageIndex) { $('#title').value = title; $('#pageCrumb').textContent = title; }
    renderBooks(); save();
  };
  const deletePage = async (notebook, index) => {
    const targetPages = data.notebooks[notebook];
    const item = targetPages?.[index]; if (!item) return;
    if (!await confirmAction('Delete page?', `Delete “${item.title || 'Untitled page'}”? This cannot be undone.`)) return;
    targetPages.splice(index, 1);
    if (notebook === book) {
      if (index <= pageIndex) pageIndex = Math.max(0, pageIndex - (index < pageIndex ? 1 : 0));
      pageIndex = Math.max(0, Math.min(pageIndex, targetPages.length - 1));
      history.reset(); renderPage();
    }
    renderBooks(); save();
  };
  let contextPageIndex = -1, contextPageBook = null;
  const expandedBooks = new Set();
  const renderBooks = () => {
    const root = $('#notebooks'); root.replaceChildren();
    Object.keys(data.notebooks).forEach((name, index) => {
      const entry = document.createElement('section'); entry.className = 'notebook-entry';
      const row = document.createElement('div'); row.className = 'notebook-row';
      const button = document.createElement('button'); button.className = `notebook${name === book ? ' active' : ''}${expandedBooks.has(name) ? ' expanded' : ''}`;
      button.setAttribute('aria-expanded', String(expandedBooks.has(name)));
      const icon = document.createElement('span'); icon.className = 'emoji'; icon.textContent = index === 0 ? '✳' : '▤';
      const label = document.createElement('span'); label.className = 'notebook-name'; label.textContent = name;
      const count = document.createElement('span'); count.className = 'count'; count.textContent = String(data.notebooks[name].length);
      button.append(icon, label, count);
      button.addEventListener('click', () => {
        const expanding = !expandedBooks.has(name), group = entry.querySelector('.notebook-pages');
        if (expanding) expandedBooks.add(name); else expandedBooks.delete(name);
        button.classList.toggle('expanded', expanding); button.setAttribute('aria-expanded', String(expanding));
        group.classList.toggle('expanded', expanding); group.inert = !expanding;
      });
      const more = document.createElement('button'); more.type = 'button'; more.className = 'notebook-more'; more.textContent = '···'; more.title = `Actions for ${name}`; more.setAttribute('aria-label', `Actions for ${name}`); more.setAttribute('aria-expanded', 'false');
      const menu = document.createElement('div'); menu.className = 'notebook-menu'; menu.hidden = true;
      const rename = document.createElement('button'); rename.type = 'button'; rename.textContent = 'Rename notebook';
      rename.addEventListener('click', async () => {
        menu.hidden = true; more.setAttribute('aria-expanded', 'false');
        const next = await askName('Notebook name', name);
        if (!next || next === name) return;
        if (data.notebooks[next]) { showNotice('Name already used', 'A notebook with that name already exists.'); return; }
        data.notebooks[next] = data.notebooks[name]; delete data.notebooks[name];
        if (expandedBooks.delete(name)) expandedBooks.add(next);
        if (book === name) { book = next; data.active = next; }
        renderBooks(); renderPage(); save();
      });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-notebook'; remove.textContent = 'Delete notebook';
      remove.addEventListener('click', async () => {
        menu.hidden = true; more.setAttribute('aria-expanded', 'false');
        if (!await confirmAction('Delete notebook?', `Delete “${name}” and all its pages? This cannot be undone.`)) return;
        delete data.notebooks[name];
        expandedBooks.delete(name);
        if (book === name) { book = data.active = Object.keys(data.notebooks)[0] || null; pageIndex = 0; history.reset(); renderPage(); }
        renderBooks(); save();
      });
      menu.append(rename, remove);
      more.addEventListener('click', event => { event.stopPropagation(); const open = menu.hidden; document.querySelectorAll('.notebook-menu').forEach(item => { item.hidden = true; }); document.querySelectorAll('.notebook-more').forEach(item => item.setAttribute('aria-expanded', 'false')); menu.hidden = !open; more.setAttribute('aria-expanded', String(open)); });
      row.append(button, more, menu); entry.append(row);
      const group = document.createElement('div'); group.className = `notebook-pages${expandedBooks.has(name) ? ' expanded' : ''}`; group.setAttribute('aria-label', `${name} pages`); group.inert = !expandedBooks.has(name);
      const heading = document.createElement('div'); heading.className = 'files-heading';
      const folder = document.createElement('span'); folder.textContent = 'PAGES';
      const add = document.createElement('button'); add.type = 'button'; add.textContent = '+'; add.title = `New page in ${name}`; add.setAttribute('aria-label', `New page in ${name}`);
      add.addEventListener('click', () => addPage(name)); heading.append(folder, add); group.append(heading);
      const notebookPages = data.notebooks[name];
      notebookPages.forEach((item, index) => {
        const line = document.createElement('div'); line.className = `page-file${name === book && index === pageIndex ? ' active' : ''}`;
        const select = document.createElement('button'); select.type = 'button'; select.className = 'page-file-name';
        const glyph = document.createElement('span'); glyph.textContent = '▤';
        const title = document.createElement('span'); title.textContent = item.title || 'Untitled page';
        const number = document.createElement('small'); number.textContent = String(index + 1).padStart(2, '0');
        select.append(glyph, title, number); select.title = `${name} · ${item.title || 'Untitled page'}`;
        select.addEventListener('click', () => activatePage(name, index));
        line.addEventListener('contextmenu', event => {
          event.preventDefault(); contextPageBook = name; contextPageIndex = index;
          const menu = $('#pageContextMenu'); menu.hidden = false;
          menu.style.left = `${Math.max(6, Math.min(event.clientX, innerWidth - 174))}px`;
          menu.style.top = `${Math.max(6, Math.min(event.clientY, innerHeight - 120))}px`;
        });
        const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.className = 'page-export'; exportButton.textContent = '↓'; exportButton.title = 'Export page as PDF'; exportButton.setAttribute('aria-label', `Export ${item.title || 'Untitled page'} as PDF`);
        exportButton.addEventListener('click', () => exportPage(name, index));
        line.append(select, exportButton); group.append(line);
      });
      if (!notebookPages.length) { const empty = document.createElement('div'); empty.className = 'no-page-files'; empty.textContent = 'No pages yet'; group.append(empty); }
      entry.append(group); root.append(entry);
    });
  };
  const exportPage = async (notebook, index) => {
    const item = data.notebooks[notebook]?.[index]; if (!item) return;
    try {
      const previousBook = book, previousIndex = pageIndex;
      book = notebook; pageIndex = index; renderPage();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const image = $('#canvas').toDataURL('image/png');
      book = previousBook; pageIndex = previousIndex; renderPage(); renderBooks();
      const result = await window.notez.exportPdf({ title: item.title || 'Untitled page', style: item.paper || data.settings.paper || 'dots', paperColor: item.paperColor || data.settings.paperColor || themeColor('--paper'), gridColor: themeColor('--paper-grid-color'), spacing: data.settings.paperSpacing || 24, image });
      if (result) savedStatus.textContent = 'PDF exported';
    } catch (error) { console.error('Could not export PDF:', error); showNotice('PDF export failed', 'The page could not be exported as a PDF.'); }
  };
  const addPage = (targetBook = book) => {
    if (!targetBook || !data.notebooks[targetBook]) return;
    book = data.active = targetBook;
    expandedBooks.add(targetBook);
    pages().push({ title: 'Untitled page', strokes: [], paper: data.settings.paper || 'dots', lastOpenedAt: Date.now() });
    pageIndex = pages().length - 1; history.reset(); renderPage(); renderBooks(); save();
  };
  const pageContextMenu = $('#pageContextMenu');
  pageContextMenu.querySelectorAll('[data-page-action]').forEach(button => button.addEventListener('click', () => {
    const notebook = contextPageBook, index = contextPageIndex, action = button.dataset.pageAction;
    pageContextMenu.hidden = true;
    if (action === 'rename') renamePage(notebook, index);
    if (action === 'delete') deletePage(notebook, index);
    if (action === 'export') exportPage(notebook, index);
  }));
  document.addEventListener('pointerdown', event => {
    if (!pageContextMenu.hidden && !pageContextMenu.contains(event.target)) pageContextMenu.hidden = true;
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') pageContextMenu.hidden = true; });
  const activatePage = (targetBook, index) => {
    if (!data.notebooks[targetBook]?.[index]) return;
    expandedBooks.add(targetBook);
    book = data.active = targetBook; pageIndex = index;
    page().lastOpenedAt = Date.now(); history.reset(); renderBooks(); renderPage(); save();
  };
  const showLibraryPages = favoritesOnly => {
    const items = Object.entries(data.notebooks).flatMap(([notebook, notebookPages]) => notebookPages.map((item, index) => ({ notebook, item, index })))
      .filter(({ item }) => favoritesOnly ? item.favorite === true : Number.isFinite(Number(item.lastOpenedAt)))
      .sort((a, b) => favoritesOnly ? (a.item.title || '').localeCompare(b.item.title || '') : Number(b.item.lastOpenedAt) - Number(a.item.lastOpenedAt));
    $('#libraryTitle').textContent = favoritesOnly ? 'Favorite pages' : 'Recent pages';
    $('#libraryDescription').textContent = favoritesOnly ? 'Pages you have marked as favorites.' : 'Pages you have opened recently.';
    const root = $('#libraryPages'); root.replaceChildren();
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'library-empty'; empty.textContent = favoritesOnly ? 'No favorite pages yet. Use the star beside a page title to save one here.' : 'Pages you open will appear here.'; root.append(empty); }
    items.slice(0, 40).forEach(({ notebook, item, index }) => {
      const entry = document.createElement('button'); entry.type = 'button'; entry.className = 'library-entry';
      const title = document.createElement('b'); title.textContent = item.title || 'Untitled page';
      const detail = document.createElement('small'); detail.textContent = `${notebook} · ${Number.isFinite(Number(item.lastOpenedAt)) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(Number(item.lastOpenedAt))) : 'Favorite'}`;
      entry.append(title, detail); entry.addEventListener('click', () => { $('#libraryDialog').close(); activatePage(notebook, index); }); root.append(entry);
    });
    $('#libraryDialog').showModal();
  };
  $('#recentButton').addEventListener('click', () => showLibraryPages(false));
  $('#favoritesButton').addEventListener('click', () => showLibraryPages(true));
  $('#favoritePage').addEventListener('click', () => {
    const current = page(); if (!current) return;
    current.favorite = !current.favorite; renderPage(); renderBooks(); save();
  });

  // Drawing tools and ink palette
  const penKinds = ['pencil', 'pen', 'highlighter'];
  let penStyle = 'pen';
  const penStyleToggle = $('#penStyleToggle'), penStyleMenu = $('#penStyleMenu');
  document.body.append(penStyleMenu);
  const renderPenStyle = () => {
    const label = penStyle === 'highlighter' ? 'Highlighter' : penStyle[0].toUpperCase() + penStyle.slice(1);
    $('#penStyleLabel').textContent = label;
    penStyleToggle.title = `Pen style: ${label}`; penStyleToggle.setAttribute('aria-label', `Pen style: ${label}`);
    penStyleToggle.querySelectorAll('[data-pen-style-icon]').forEach(icon => { icon.hidden = icon.dataset.penStyleIcon !== penStyle; });
    penStyleMenu.querySelectorAll('[data-pen-style]').forEach(option => option.setAttribute('aria-checked', String(option.dataset.penStyle === penStyle)));
  };
  const selectTool = (selected, { persist = true } = {}) => {
    // Commit any live stroke before changing modes; some tablet drivers omit
    // pointerup when a toolbar control takes focus.
    drawing.finishInput();
    tool = selected;
    if (penKinds.includes(selected)) penStyle = selected;
    document.querySelectorAll('[data-tool]').forEach(item => item.classList.toggle('active', item.dataset.tool === selected));
    penStyleToggle.classList.toggle('active', penKinds.includes(selected));
    $('#canvas').style.cursor = selected === 'eraser' ? 'cell' : 'crosshair';
    renderPenStyle();
    if (persist && data) {
      data.settings.activeTool = tool; data.settings.penStyle = penStyle; save(true);
    }
  };
  document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => selectTool(button.dataset.tool)));
  penStyleToggle.addEventListener('click', () => {
    penStyleMenu.hidden = !penStyleMenu.hidden;
    penStyleToggle.setAttribute('aria-expanded', String(!penStyleMenu.hidden));
  });
  penStyleMenu.querySelectorAll('[data-pen-style]').forEach(option => option.addEventListener('click', () => {
    selectTool(option.dataset.penStyle);
    penStyleMenu.hidden = true; penStyleToggle.setAttribute('aria-expanded', 'false');
  }));
  renderPenStyle();
  const inkToggle = $('#inkToggle'), inkMenu = $('#inkMenu');
  const inkPresets = $('#inkPresets'), inkColorPicker = $('#inkColorPicker');
  // The focus toolbar has a transformed, scrollable ancestor. Keep this fixed
  // popover directly under body so that ancestor cannot clip it in fullscreen.
  document.body.append(inkMenu);
  let editingInkPreset = null;
  const renderInkPresets = () => {
    inkPresets.replaceChildren();
    for (const [index, preset] of (data?.settings.inkPresets || []).entries()) {
      const row = document.createElement('div'); row.className = 'ink-preset';
      const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'ink-choice';
      choose.classList.toggle('selected', preset === color); choose.setAttribute('aria-label', `Use ink ${preset}`);
      const dot = document.createElement('span'); dot.className = 'ink-choice-dot'; dot.style.setProperty('--ink', preset);
      const value = document.createElement('code'); value.textContent = preset.toUpperCase();
      choose.append(dot, value); choose.addEventListener('click', () => applyColor(preset));
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'ink-preset-action';
      edit.textContent = '✎'; edit.title = `Change ${preset}`; edit.setAttribute('aria-label', `Change ink ${preset}`);
      edit.addEventListener('click', () => openInkColorPicker(index));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'ink-preset-action ink-preset-delete';
      remove.textContent = '×'; remove.title = `Delete ${preset}`; remove.setAttribute('aria-label', `Delete ink ${preset}`);
      remove.addEventListener('click', () => {
        data.settings.inkPresets.splice(index, 1);
        if (color === preset) {
          color = data.settings.inkPresets[0] || '#293b34'; data.settings.color = color;
          $('#activeInk').style.backgroundColor = color; $('#settingsInk').value = color;
        }
        renderInkPresets(); save();
      });
      row.append(choose, edit, remove); inkPresets.append(row);
    }
  };
  function openInkColorPicker(index = null) {
    editingInkPreset = index;
    inkColorPicker.value = index === null ? (color || '#293b34') : data.settings.inkPresets[index];
    try { inkColorPicker.showPicker(); } catch { inkColorPicker.click(); }
  }
  const applyColor = (nextColor, selectPen = true) => {
    color = nextColor.toLowerCase(); data.settings.color = color; $('#activeInk').style.backgroundColor = color;
    if ($('#settingsInk')) $('#settingsInk').value = color;
    renderInkPresets(); if (selectPen) selectTool('pen'); save();
  };
  function cycleInkPreset() {
    const presets = data?.settings.inkPresets || [];
    if (!presets.length) return;
    const currentIndex = presets.indexOf(color);
    applyColor(presets[(currentIndex + 1) % presets.length], false);
  }
  inkColorPicker.addEventListener('change', event => {
    const nextColor = event.target.value.toLowerCase();
    if (editingInkPreset === null) {
      if (!data.settings.inkPresets.includes(nextColor)) data.settings.inkPresets.push(nextColor);
      editingInkPreset = null; renderInkPresets(); applyColor(nextColor); return;
    }
    const index = editingInkPreset, previous = data.settings.inkPresets[index]; editingInkPreset = null;
    if (data.settings.inkPresets.some((preset, presetIndex) => presetIndex !== index && preset === nextColor)) {
      showNotice('Colour already saved', 'That colour is already in your saved ink presets.'); return;
    }
    data.settings.inkPresets[index] = nextColor;
    if (color === previous) applyColor(nextColor);
    else { renderInkPresets(); save(); }
  });
  $('#addInkPreset').addEventListener('click', () => openInkColorPicker());
  inkToggle.addEventListener('click', () => { inkMenu.hidden = !inkMenu.hidden; inkToggle.setAttribute('aria-expanded', String(!inkMenu.hidden)); });

  // Persistent application preferences
  const settingsDialog = $('#settingsDialog');
  const paperColorInput = $('#settingsPaperColor'), gridColorInput = $('#settingsGridColor');
  const themeColor = variable => getComputedStyle(document.body).getPropertyValue(variable).trim();
  const refreshPaperAppearance = () => {
    document.body.style.setProperty('--paper-color', data.settings.paperColor || themeColor('--paper'));
    document.body.style.setProperty('--paper-grid-color', data.settings.paperGridColor || themeColor('--paper-grid'));
    paperColorInput.value = data.settings.paperColor || themeColor('--paper');
    gridColorInput.value = data.settings.paperGridColor || themeColor('--paper-grid');
    $('#settingsPaperSpacing').value = data.settings.paperSpacing || 24;
    $('#settingsPaperSpacingValue').textContent = `${data.settings.paperSpacing || 24} px`;
  };
  const applyTheme = (theme, persist = true) => {
    data.settings.theme = theme;
    document.body.dataset.theme = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
    document.querySelectorAll('[data-theme-option]').forEach(button => {
      button.classList.toggle('selected', button.dataset.themeOption === theme);
      button.setAttribute('aria-pressed', String(button.dataset.themeOption === theme));
    });
    if (data?.settings) { refreshPaperAppearance(); renderPage(); }
    if (persist) save();
  };
  const openSettings = () => settingsDialog.showModal();
  $('#settingsButton').addEventListener('click', openSettings);
  $('#settingsToolbar').addEventListener('click', openSettings);
  $('#settingsClose').addEventListener('click', () => settingsDialog.close());
  $('#settingsDone').addEventListener('click', () => settingsDialog.close());
  settingsDialog.addEventListener('click', event => { if (event.target === settingsDialog) settingsDialog.close(); });
  document.querySelectorAll('[data-theme-option]').forEach(button => button.addEventListener('click', () => applyTheme(button.dataset.themeOption)));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (data?.settings.theme === 'system') applyTheme('system', false);
  });
  $('#settingsPaper').addEventListener('change', event => { data.settings.paper = event.target.value; save(); });
  $('#settingsInk').addEventListener('input', event => applyColor(event.target.value));
  paperColorInput.addEventListener('input', event => { data.settings.paperColor = event.target.value; refreshPaperAppearance(); renderPage(); save(); });
  gridColorInput.addEventListener('input', event => { data.settings.paperGridColor = event.target.value; refreshPaperAppearance(); save(); });
  $('#settingsPaperSpacing').addEventListener('input', event => { data.settings.paperSpacing = Number(event.target.value); refreshPaperAppearance(); drawing.resize(); save(); });
  $('#resetPaperAppearance').addEventListener('click', () => { delete data.settings.paperColor; delete data.settings.paperGridColor; delete data.settings.paperSpacing; document.body.style.removeProperty('--paper-color'); document.body.style.removeProperty('--paper-grid-color'); refreshPaperAppearance(); renderPage(); drawing.resize(); save(); });

  // Page templates and notebook navigation
  const paperToggle = $('#paperToggle'), paperMenu = $('#paperMenu');
  paperToggle.addEventListener('click', () => { paperMenu.hidden = !paperMenu.hidden; paperToggle.setAttribute('aria-expanded', String(!paperMenu.hidden)); });
  document.querySelectorAll('[data-paper]').forEach(button => button.addEventListener('click', () => {
    page().paper = button.dataset.paper; data.settings.paper = button.dataset.paper;
    paperMenu.hidden = true; paperToggle.setAttribute('aria-expanded', 'false'); renderPage(); save();
  }));
  $('#pageColorPicker').addEventListener('input', event => {
    const current = page(); if (!current) return;
    current.paperColor = event.target.value.toLowerCase();
    paper.style.setProperty('--page-paper-color', current.paperColor);
    save();
  });
  $('#resetPageColor').addEventListener('click', () => {
    const current = page(); if (!current) return;
    delete current.paperColor; renderPage(); save();
  });
  const renderStrokeWidth = () => {
    $('#widthLabel').value = width.toFixed(1);
    $('#widthPreview').style.width = `${Math.max(2, Math.min(14, width * 1.15))}px`;
    $('#widthPreview').style.height = `${Math.max(2, Math.min(14, width * 1.15))}px`;
  };
  const adjustStrokeWidth = delta => {
    width = Math.max(.5, Math.min(12, Math.round((width + delta) * 2) / 2));
    renderStrokeWidth();
    if (data) { data.settings.strokeWidth = width; save(true); }
  };
  $('#widthDown').addEventListener('click', () => adjustStrokeWidth(-.5));
  $('#widthUp').addEventListener('click', () => adjustStrokeWidth(.5));
  $('#undo').addEventListener('click', () => {
    if (history.undo(page())) { drawing.draw(); hint.classList.toggle('hide', page().strokes.length > 0); save(); }
  });
  $('#redo').addEventListener('click', () => {
    if (history.redo(page())) { drawing.draw(); hint.classList.toggle('hide', page().strokes.length > 0); save(); }
  });
  $('#clear').addEventListener('click', () => {
    if (!page().strokes.length) return;
    history.record({ type: 'clear', before: page().strokes.slice() }); page().strokes = [];
    drawing.draw(); hint.classList.remove('hide'); save();
  });
  $('#title').addEventListener('input', event => { page().title = event.target.value; $('#pageCrumb').textContent = event.target.value; renderBooks(); save(); });
  $('#prev').addEventListener('click', () => { if (pageIndex) activatePage(book, pageIndex - 1); });
  $('#next').addEventListener('click', () => {
    if (!pages()?.length) { addPage(); return; }
    if (pageIndex + 1 === pages().length) { addPage(); return; }
    activatePage(book, pageIndex + 1);
  });
  const changeZoom = delta => {
    const zoom = drawing.setZoom(Number($('#zoomValue').textContent.replace('%', '')) + delta);
    $('#zoomValue').textContent = `${zoom}%`;
    document.body.classList.toggle('toolbar-compact', zoom <= 100);
  };
  $('#zoomIn').addEventListener('click', () => changeZoom(10));
  $('#zoomOut').addEventListener('click', () => changeZoom(-10));

  // Palm rejection and handwriting stabilization
  const palmToggle = $('#palmToggle');
  const renderPalmPreference = () => {
    palmToggle.classList.toggle('active', palmRejection); palmToggle.setAttribute('aria-pressed', String(palmRejection));
    palmToggle.title = palmRejection ? 'Palm rejection is on: touch contacts cannot draw' : 'Palm rejection is off: finger drawing is enabled';
    $('#palmLabel').textContent = palmRejection ? 'Palm on' : 'Palm off';
    if ($('#settingsPalm')) $('#settingsPalm').checked = palmRejection;
    // With palm rejection enabled, let finger gestures reach the paper's
    // native scroll container while stylus pointer events continue to draw.
    $('#canvas').style.touchAction = palmRejection ? 'pan-x pan-y' : 'none';
  };
  palmToggle.addEventListener('click', () => { palmRejection = !palmRejection; data.settings.palmRejection = palmRejection; renderPalmPreference(); save(); });
  $('#settingsPalm').addEventListener('change', event => {
    palmRejection = event.target.checked; data.settings.palmRejection = palmRejection; renderPalmPreference(); save();
  });
  const smoothToggle = $('#smoothToggle'), smoothPanel = $('#smoothPanel');
  smoothToggle.addEventListener('click', () => {
    const open = smoothPanel.hidden; smoothPanel.hidden = !open; smoothToggle.setAttribute('aria-expanded', String(open));
  });
  $('#smoothSlider').addEventListener('input', event => {
    smoothing = Number(event.target.value); data.settings.smoothing = smoothing;
    $('#smoothValue').textContent = smoothing; $('#smoothOutput').value = smoothing;
    $('#settingsSmoothing').value = smoothing; $('#settingsSmoothingValue').value = smoothing; save();
  });
  $('#settingsSmoothing').addEventListener('input', event => {
    smoothing = Number(event.target.value); data.settings.smoothing = smoothing;
    $('#smoothSlider').value = smoothing; $('#smoothValue').textContent = smoothing;
    $('#smoothOutput').value = smoothing; $('#settingsSmoothingValue').value = smoothing; save();
  });
  document.addEventListener('pointerdown', event => {
    if (matchMedia('(max-width: 660px)').matches && document.body.classList.contains('sidebar-open') &&
        !event.target.closest('.sidebar') && !event.target.closest('#sidebarToggle')) {
      document.body.classList.remove('sidebar-open');
      $('#sidebarToggle').setAttribute('aria-expanded', 'false');
    }
    if (!event.target.closest('.notebook-row')) document.querySelectorAll('.notebook-menu').forEach(menu => { menu.hidden = true; menu.parentElement?.querySelector('.notebook-more')?.setAttribute('aria-expanded', 'false'); });
    for (const [menu, button] of [[smoothPanel, smoothToggle], [inkMenu, inkToggle], [paperMenu, paperToggle], [penStyleMenu, penStyleToggle]]) {
      if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) {
        menu.hidden = true; button.setAttribute('aria-expanded', 'false');
      }
    }
  });

  $('#sidebarToggle').addEventListener('click', () => {
    const open = document.body.classList.toggle('sidebar-open');
    $('#sidebarToggle').setAttribute('aria-expanded', String(open));
  });

  // Fullscreen notebook focus view
  const focusButton = $('#focusPage');
  const leaveFocus = () => { document.body.classList.remove('page-focus'); focusButton.setAttribute('aria-pressed', 'false'); };
  const syncFullscreen = enabled => {
    // Fullscreen transitions can swallow the pen's pointerup on some Linux
    // tablet stacks. Commit the in-progress stroke so the input state cannot
    // remain stuck until fullscreen is toggled again.
    drawing.finishInput();
    if (enabled) { document.body.classList.add('page-focus'); focusButton.setAttribute('aria-pressed', 'true'); }
    else leaveFocus();
    requestAnimationFrame(() => requestAnimationFrame(drawing.resize));
  };
  focusButton.addEventListener('click', async () => {
    const enabled = !document.body.classList.contains('page-focus');
    syncFullscreen(enabled);
    try { await window.notez.setFullscreen(enabled); }
    catch (error) { console.error('Could not change fullscreen mode:', error); syncFullscreen(false); }
  });
  window.notez.onFullscreenChange(syncFullscreen);

  const makeBook = async () => {
    const name = await askName('Notebook name');
    if (!name) return;
    if (data.notebooks[name]) { showNotice('Name already used', 'A notebook with that name already exists.'); return; }
    data.notebooks[name] = [{ title: 'Untitled page', strokes: [], lastOpenedAt: Date.now() }];
    book = name; data.active = book; pageIndex = 0; history.reset(); renderBooks(); renderPage(); save();
  };
  $('#newNotebook').addEventListener('click', makeBook);
  $('#addNotebook').addEventListener('click', makeBook);
  $('#sidebarNewPage').addEventListener('click', () => book ? addPage() : makeBook());
  $('#emptyAction').addEventListener('click', () => book ? addPage() : makeBook());
  renderStrokeWidth();
  document.addEventListener('keydown', event => {
    if (event.key === 'F11') { event.preventDefault(); focusButton.click(); }
    if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); openSettings(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); $(event.shiftKey ? '#redo' : '#undo').click(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); $('#redo').click(); return; }
    if (event.target.matches('input,textarea')) return;
    const shortcuts = { p: 'pen', k: 'pencil', m: 'marker', h: 'highlighter', e: 'eraser', l: 'line', t: 'text' };
    const selected = shortcuts[event.key.toLowerCase()];
    if (selected && penKinds.includes(selected)) selectTool(selected);
    else if (selected) $(`[data-tool="${selected}"]`).click();
  });

  (async () => {
    try { data = normalizeNotes(await window.notez.load()); }
    catch (error) { console.error('Could not load notes:', error); data = normalizeNotes(null); }
    color = data.settings.color || color;
    width = Math.max(.5, Math.min(12, Number(data.settings.strokeWidth) || width));
    tool = ['pen', 'pencil', 'highlighter', 'marker', 'eraser', 'line', 'text'].includes(data.settings.activeTool) ? data.settings.activeTool : 'pen';
    penStyle = ['pen', 'pencil', 'highlighter'].includes(data.settings.penStyle) ? data.settings.penStyle : (penKinds.includes(tool) ? tool : 'pen');
    selectTool(tool, { persist: false }); renderStrokeWidth();
    renderInkPresets();
    smoothing = Math.max(0, Math.min(100, Number(data.settings.smoothing ?? 40)));
    palmRejection = data.settings.palmRejection !== false; renderPalmPreference();
    applyTheme(data.settings.theme || 'dark', false);
    refreshPaperAppearance();
    $('#settingsPaper').value = data.settings.paper || 'dots';
    $('#settingsInk').value = color;
    $('#smoothSlider').value = smoothing; $('#smoothValue').textContent = smoothing; $('#smoothOutput').value = smoothing;
    $('#settingsSmoothing').value = smoothing; $('#settingsSmoothingValue').value = smoothing;
    $('#activeInk').style.backgroundColor = color;
    book = data.notebooks[data.active] ? data.active : Object.keys(data.notebooks)[0] || null; data.active = book;
    if (page()) page().lastOpenedAt = Date.now();
    $('#today').textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();
    renderBooks(); renderPage();
    if (page()) save();
    let lastPaperSize = '';
    const paperObserver = new ResizeObserver(() => {
      const rect = paper.getBoundingClientRect(), size = `${rect.width}x${rect.height}`;
      if (size === lastPaperSize) return;
      lastPaperSize = size;
      requestAnimationFrame(drawing.resize);
    });
    paperObserver.observe(paper, { box: 'border-box' });
    document.body.style.pointerEvents = '';
  })().catch(error => {
    console.error('NoteZ could not start:', error); savedStatus.textContent = 'Open failed'; document.body.style.pointerEvents = '';
  });
})();
