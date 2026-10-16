/** Undo/redo for page edits. Actions keep the original stroke objects so erase can be reversed exactly. */
export class EditHistory {
  #undo = [];
  #redo = [];

  record(action) { this.#undo.push(action); this.#redo.length = 0; }
  reset() { this.#undo.length = 0; this.#redo.length = 0; }

  undo(page) {
    const action = this.#undo.pop();
    if (!action) return false;
    if (action.type === 'add') {
      const index = page.strokes.indexOf(action.stroke);
      if (index >= 0) page.strokes.splice(index, 1);
    } else if (action.type === 'erase') {
      for (const item of [...action.removed].sort((a, b) => a.index - b.index)) {
        page.strokes.splice(Math.min(item.index, page.strokes.length), 0, item.stroke);
      }
    } else if (action.type === 'clear') page.strokes = action.before.slice();
    this.#redo.push(action);
    return true;
  }

  redo(page) {
    const action = this.#redo.pop();
    if (!action) return false;
    if (action.type === 'add') page.strokes.splice(Math.min(action.index ?? page.strokes.length, page.strokes.length), 0, action.stroke);
    else if (action.type === 'erase') {
      for (const item of action.removed) {
        const index = page.strokes.indexOf(item.stroke);
        if (index >= 0) page.strokes.splice(index, 1);
      }
    } else if (action.type === 'clear') page.strokes = [];
    this.#undo.push(action);
    return true;
  }
}
