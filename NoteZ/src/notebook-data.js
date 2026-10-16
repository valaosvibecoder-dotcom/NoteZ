/** Shape checking and defaults for locally stored notebooks. */
export const createDefaultNotes = () => ({
  active: 'Ideas',
  notebooks: { Ideas: [{ title: 'Untitled page', strokes: [] }] },
  settings: {}
});

const DEFAULT_INK_PRESETS = ['#293b34', '#455f78', '#934f43', '#b36d48', '#9b793c', '#665876', '#68806c', '#2c2b29', '#bd8a78', '#7895a7', '#ceb16e'];

export function normalizeNotes(notes) {
  if (!notes || typeof notes !== 'object' || Array.isArray(notes) || !notes.notebooks || typeof notes.notebooks !== 'object' || Array.isArray(notes.notebooks)) {
    notes = createDefaultNotes();
  }
  if (!notes.settings || typeof notes.settings !== 'object' || Array.isArray(notes.settings)) notes.settings = {};
  if (typeof notes.settings.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(notes.settings.color)) delete notes.settings.color;
  if (!Array.isArray(notes.settings.inkPresets)) notes.settings.inkPresets = [...DEFAULT_INK_PRESETS];
  else notes.settings.inkPresets = [...new Set(notes.settings.inkPresets
    .filter(value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
    .map(value => value.toLowerCase()))].slice(0, 48);
  if (!['dots', 'ruled', 'squared', 'plain'].includes(notes.settings.paper)) delete notes.settings.paper;
  for (const key of ['paperColor', 'paperGridColor']) {
    if (typeof notes.settings[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(notes.settings[key])) delete notes.settings[key];
  }
  const paperSpacing = Number(notes.settings.paperSpacing);
  if (Number.isFinite(paperSpacing)) notes.settings.paperSpacing = Math.max(12, Math.min(40, paperSpacing));
  else delete notes.settings.paperSpacing;
  if (!['system', 'light', 'sepia', 'dark'].includes(notes.settings.theme)) delete notes.settings.theme;
  const smoothing = Number(notes.settings.smoothing);
  if (Number.isFinite(smoothing)) notes.settings.smoothing = Math.max(0, Math.min(100, smoothing));
  else delete notes.settings.smoothing;
  if (typeof notes.settings.palmRejection !== 'boolean') delete notes.settings.palmRejection;
  for (const [name, notebookPages] of Object.entries(notes.notebooks)) {
    if (!Array.isArray(notebookPages)) notes.notebooks[name] = [];
    notes.notebooks[name] = notes.notebooks[name].map(page => {
      if (!page || typeof page !== 'object' || Array.isArray(page)) return { title: 'Untitled page', strokes: [] };
      if (typeof page.favorite !== 'boolean') delete page.favorite;
      const lastOpenedAt = Number(page.lastOpenedAt);
      if (Number.isFinite(lastOpenedAt) && lastOpenedAt > 0) page.lastOpenedAt = lastOpenedAt;
      else delete page.lastOpenedAt;
      if (!['dots', 'ruled', 'squared', 'plain'].includes(page.paper)) delete page.paper;
      if (typeof page.paperColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(page.paperColor)) delete page.paperColor;
      if (!Array.isArray(page.strokes)) page.strokes = [];
      page.strokes = page.strokes.filter(stroke => stroke && typeof stroke === 'object' && !Array.isArray(stroke) && typeof stroke.tool === 'string');
      for (const stroke of page.strokes) {
        stroke.width = Number.isFinite(Number(stroke.width)) && Number(stroke.width) > 0 ? Number(stroke.width) : 2.8;
        if (stroke.tool === 'text') {
          stroke.text = typeof stroke.text === 'string' ? stroke.text : '';
          stroke.x = Number.isFinite(Number(stroke.x)) ? Number(stroke.x) : 0;
          stroke.y = Number.isFinite(Number(stroke.y)) ? Number(stroke.y) : 0;
        } else {
          if (!Array.isArray(stroke.points)) stroke.points = [];
          stroke.points = stroke.points.filter(point => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
            .map(point => {
              const saved = { x: Number(point.x), y: Number(point.y) };
              if (point.pressure !== undefined && point.pressure !== null && Number.isFinite(Number(point.pressure))) {
                saved.pressure = Math.max(0, Math.min(1, Number(point.pressure)));
              }
              return saved;
            });
        }
        if (typeof stroke.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(stroke.color)) stroke.color = '#293b34';
      }
      return page;
    });
  }
  return notes;
}
