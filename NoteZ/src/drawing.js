/** Canvas rendering, pointer input, coordinate mapping, and stroke-aware erasing. */
export function createDrawingSurface({ canvas, paper, surface, hint, getPage, getTool, getInk, getWidth, getSmoothing, getPalmRejection, getPaperSpacing = () => 24, getText = async () => '', history, onChange, onCycleColor = () => {} }) {
  const ctx = canvas.getContext('2d');
  let zoom = 100, activeStroke = null, activePointerId = null, drawing = false, erasing = false, eraseOrigin = null, lastPoint = null;
  const penBarrelHeld = new Map();
  let baseWidth = 1, baseHeight = 1;

  const point = event => {
    const rect = canvas.getBoundingClientRect(), scale = zoom / 100;
    const result = { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
    if (event.pointerType === 'pen') result.pressure = Math.max(.04, Math.min(1, Number(event.pressure) || .04));
    return result;
  };
  const tracePath = points => {
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 1) { ctx.lineTo(points[0].x + .1, points[0].y + .1); return; }
    if (points.length === 2) { ctx.lineTo(points[1].x, points[1].y); return; }
    for (let i = 1; i < points.length - 1; i++) {
      const current = points[i], next = points[i + 1];
      ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
    }
    const last = points[points.length - 1]; ctx.lineTo(last.x, last.y);
  };
  const draw = () => {
    const current = getPage();
    if (!current) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    ctx.clearRect(0, 0, baseWidth, baseHeight);
    for (const stroke of current.strokes || []) {
      if (stroke.tool === 'text') {
        ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.fillStyle = stroke.color;
        ctx.font = `${Math.max(14, stroke.width * 7)}px Georgia, serif`; ctx.textBaseline = 'top'; ctx.fillText(stroke.text, stroke.x, stroke.y); ctx.restore(); continue;
      }
      if (!stroke.points?.length) continue;
      ctx.save(); ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
      const toolAlpha = stroke.tool === 'highlighter' ? .22 : stroke.tool === 'pencil' ? .82 : stroke.tool === 'marker' ? .9 : 1;
      ctx.globalAlpha = toolAlpha;
      ctx.strokeStyle = stroke.color;
      const toolWidth = stroke.width * (stroke.tool === 'eraser' ? 7 : stroke.tool === 'highlighter' ? 4 : stroke.tool === 'marker' ? 2.4 : stroke.tool === 'pencil' ? .72 : 1);
      const hasPressure = stroke.tool !== 'eraser' && stroke.points.some(sample => Number.isFinite(sample.pressure));
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (stroke.tool === 'line' && stroke.points.length > 1) {
        const pressure = stroke.points.reduce((sum, sample) => sum + (Number.isFinite(sample.pressure) ? sample.pressure : 1), 0) / stroke.points.length;
        ctx.lineWidth = toolWidth * (hasPressure ? .2 + pressure * 1.4 : 1);
        ctx.globalAlpha = toolAlpha * (hasPressure ? .72 + pressure * .28 : 1);
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y); ctx.lineTo(stroke.points.at(-1).x, stroke.points.at(-1).y);
        ctx.stroke();
      } else if (hasPressure) {
        const samples = stroke.points;
        if (samples.length === 1) {
          const pressure = samples[0].pressure;
          ctx.globalAlpha = toolAlpha * (.72 + pressure * .28);
          ctx.fillStyle = stroke.color; ctx.beginPath();
          ctx.arc(samples[0].x, samples[0].y, toolWidth * (.2 + pressure * 1.4) / 2, 0, Math.PI * 2); ctx.fill();
        } else {
          const edgeA = [], edgeB = [];
          let totalPressure = 0;
          for (let i = 0; i < samples.length; i++) {
            const before = samples[Math.max(0, i - 1)], after = samples[Math.min(samples.length - 1, i + 1)];
            const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy) || 1;
            const pressure = Number.isFinite(samples[i].pressure) ? samples[i].pressure : 1;
            const radius = toolWidth * (.2 + pressure * 1.4) / 2;
            const nx = -dy / length * radius, ny = dx / length * radius;
            edgeA.push({ x: samples[i].x + nx, y: samples[i].y + ny });
            edgeB.push({ x: samples[i].x - nx, y: samples[i].y - ny });
            totalPressure += pressure;
          }
          const curveSide = (edge, reverse = false) => {
            const points = reverse ? [...edge].reverse() : edge;
            for (let i = 1; i < points.length; i++) {
              const current = points[i], next = points[i + 1];
              if (!next) { ctx.lineTo(current.x, current.y); break; }
              ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
            }
          };
          const averagePressure = totalPressure / samples.length;
          ctx.globalAlpha = toolAlpha * (.72 + averagePressure * .28);
          ctx.fillStyle = stroke.color; ctx.beginPath();
          ctx.moveTo(edgeA[0].x, edgeA[0].y); curveSide(edgeA);
          const last = samples.at(-1); ctx.quadraticCurveTo(last.x, last.y, edgeB.at(-1).x, edgeB.at(-1).y);
          curveSide(edgeB, true);
          const first = samples[0]; ctx.quadraticCurveTo(first.x, first.y, edgeA[0].x, edgeA[0].y);
          ctx.closePath(); ctx.fill();
        }
      } else {
        ctx.lineWidth = toolWidth; ctx.beginPath(); tracePath(stroke.points); ctx.stroke();
      }
      ctx.restore();
    }
  };
  const resize = () => {
    baseWidth = Math.max(1, paper.clientWidth); baseHeight = Math.max(1, paper.clientHeight);
    layoutSurface();
  };
  const layoutSurface = () => {
    const scale = zoom / 100, pixelRatio = Math.min(devicePixelRatio || 1, 2);
    const width = baseWidth * scale, height = baseHeight * scale;
    surface.style.width = `${Math.max(paper.clientWidth, width)}px`;
    surface.style.height = `${Math.max(paper.clientHeight, height)}px`;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
    const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
    // Assigning canvas dimensions clears its backing store and can interrupt
    // an active stylus stream. Only reset the bitmap when its actual size changed.
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    ctx.setTransform(pixelRatio * scale, 0, 0, pixelRatio * scale, 0, 0);
    const grid = surface.dataset.style;
    const spacing = getPaperSpacing() * scale;
    surface.style.backgroundSize = grid === 'dots' ? `${spacing}px ${spacing}px` :
      grid === 'ruled' ? `100% ${spacing}px` : grid === 'squared' ? `${spacing}px ${spacing}px` : '';
    draw();
  };
  const pointSegmentDistance = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  const segmentsTouch = (a, b, c, d, radius) => {
    const orientation = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const o1 = orientation(a, b, c), o2 = orientation(a, b, d), o3 = orientation(c, d, a), o4 = orientation(c, d, b);
    if (o1 * o2 < 0 && o3 * o4 < 0) return true;
    return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b)) <= radius;
  };
  const touchesStroke = (stroke, start, end) => {
    if (stroke.tool === 'text') {
      ctx.save(); ctx.font = `${Math.max(14, stroke.width * 7)}px Georgia, serif`;
      const width = ctx.measureText(stroke.text).width, height = Math.max(14, stroke.width * 7); ctx.restore();
      const l = stroke.x, t = stroke.y, r = l + width, b = t + height;
      return (start.x >= l && start.x <= r && start.y >= t && start.y <= b) ||
        (end.x >= l && end.x <= r && end.y >= t && end.y <= b) ||
        segmentsTouch(start, end, { x: l, y: t }, { x: r, y: t }, 4) ||
        segmentsTouch(start, end, { x: r, y: t }, { x: r, y: b }, 4) ||
        segmentsTouch(start, end, { x: r, y: b }, { x: l, y: b }, 4) ||
        segmentsTouch(start, end, { x: l, y: b }, { x: l, y: t }, 4);
    }
    const points = stroke.points || [];
    if (!points.length) return false;
    const radius = Math.max(7, stroke.width * (stroke.tool === 'highlighter' ? 2 : stroke.tool === 'marker' ? 1.2 : .6) + 4);
    if (points.length === 1) return pointSegmentDistance(points[0], start, end) <= radius;
    for (let i = 1; i < points.length; i++) if (segmentsTouch(start, end, points[i - 1], points[i], radius)) return true;
    return false;
  };
  const eraseBetween = (start, end) => {
    const strokes = getPage().strokes;
    for (let i = strokes.length - 1; i >= 0; i--) if (touchesStroke(strokes[i], start, end)) strokes.splice(i, 1);
    hint.classList.toggle('hide', strokes.length > 0); draw();
  };

  const handlePenBarrelButton = event => {
    // Tablet drivers disagree on whether the stylus side switch is exposed as
    // a pen right click, middle click, or one of the auxiliary mouse buttons.
    // Some Linux drivers also report pointerType="mouse" for the same switch.
    const buttonMask = 2 | 4 | 8 | 16;
    const currentButtons = event.buttons & buttonMask;
    const previousButtons = penBarrelHeld.get(event.pointerId) || 0;
    const sideButtonEvent = event.type === 'pointerdown' && event.button >= 1 && event.button <= 4;
    const buttonBits = [0, 4, 2, 8, 16];
    if (event.pointerType !== 'pen' && !(event.pointerType === 'mouse' && (currentButtons || sideButtonEvent || previousButtons))) return false;
    // PointerEvent.button can keep its last changed button value during moves.
    // Only pointerdown or a newly appearing buttons bit represents a new press.
    const newlyPressed = sideButtonEvent || (currentButtons & ~previousButtons) !== 0;
    if (newlyPressed) {
      event.preventDefault();
      cycleColorFromPen();
    }
    // Preserve a down edge even when the driver reports buttons=0 on pointerdown;
    // otherwise its later pointermove would look like a second press and skip ink.
    let heldButtons = currentButtons || previousButtons;
    if (sideButtonEvent) heldButtons |= buttonBits[event.button];
    if (event.type === 'pointerup' && event.button >= 1 && event.button <= 4) heldButtons &= ~buttonBits[event.button];
    if (event.type === 'pointercancel') heldButtons = 0;
    if (heldButtons) penBarrelHeld.set(event.pointerId, heldButtons);
    else penBarrelHeld.delete(event.pointerId);
    return event.type === 'pointerdown' && sideButtonEvent;
  };
  let lastPenColorCycleAt = Number.NEGATIVE_INFINITY;
  const cycleColorFromPen = () => {
    // A single physical press can arrive as pointerdown plus contextmenu/auxclick.
    const now = performance.now();
    if (now - lastPenColorCycleAt < 180) return;
    lastPenColorCycleAt = now;
    onCycleColor();
  };
  canvas.addEventListener('contextmenu', event => {
    event.preventDefault();
    cycleColorFromPen();
  });
  canvas.addEventListener('auxclick', event => {
    if (event.button === 1 || event.button === 2 || event.button === 3) {
      event.preventDefault();
      cycleColorFromPen();
    }
  });
  canvas.addEventListener('pointerdown', async event => {
    if (handlePenBarrelButton(event)) return;
    if (getPalmRejection() && event.pointerType === 'touch') { event.preventDefault(); return; }
    if (event.pointerType === 'mouse' && event.button !== 0 || drawing) return;
    const tool = getTool();
    if (tool === 'text') {
      event.preventDefault();
      const p = point(event), targetPage = getPage();
      const text = await getText();
      if (text?.trim()) {
        if (!targetPage) return;
        const stroke = { tool: 'text', text: text.trim(), color: getInk(), width: getWidth(), x: p.x, y: p.y };
        const strokes = targetPage.strokes; strokes.push(stroke); history.record({ type: 'add', stroke, index: strokes.length - 1 });
        hint.classList.add('hide'); draw(); onChange();
      }
      return;
    }
    event.preventDefault();
    // Track movement and release at window level below instead of relying on
    // canvas pointer capture. Electron on Linux can retain stale capture while
    // the window enters or leaves fullscreen, which blocks later pen strokes.
    drawing = true; activePointerId = event.pointerId; lastPoint = point(event);
    if (tool === 'eraser') { erasing = true; eraseOrigin = getPage().strokes.slice(); eraseBetween(lastPoint, lastPoint); return; }
    activeStroke = { tool, color: getInk(), width: getWidth(), points: [lastPoint] };
    getPage().strokes.push(activeStroke); hint.classList.add('hide'); draw();
  });
  window.addEventListener('pointermove', event => {
    handlePenBarrelButton(event);
    if (!drawing || event.pointerId !== activePointerId) return;
    const samples = event.getCoalescedEvents?.() || [];
    for (const sample of samples.length ? samples : [event]) {
      const raw = point(sample);
      if (erasing) { eraseBetween(lastPoint, raw); lastPoint = raw; continue; }
      const follow = 1 - (getSmoothing() / 100) * .78;
      lastPoint = {
        x: lastPoint.x + (raw.x - lastPoint.x) * follow,
        y: lastPoint.y + (raw.y - lastPoint.y) * follow,
        ...(raw.pressure !== undefined ? { pressure: lastPoint.pressure + (raw.pressure - lastPoint.pressure) * .35 } : {})
      };
      activeStroke.points.push(lastPoint);
    }
    draw();
  });
  const finish = event => {
    if (event?.pointerType === 'pen') handlePenBarrelButton(event);
    if (event?.type === 'pointerup' && event.pointerType === 'pen' && (event.buttons & 1)) return;
    if (!drawing || event && event.pointerId !== activePointerId) return;
    if (erasing) {
      const removed = eraseOrigin.flatMap((stroke, index) => getPage().strokes.includes(stroke) ? [] : [{ stroke, index }]);
      if (removed.length) history.record({ type: 'erase', removed });
    } else if (activeStroke) history.record({ type: 'add', stroke: activeStroke, index: getPage().strokes.indexOf(activeStroke) });
    drawing = false; erasing = false; eraseOrigin = null; activeStroke = null; activePointerId = null; lastPoint = null; onChange();
  };
  window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish);
  window.addEventListener('blur', () => finish());

  return {
    draw, resize, finishInput: () => finish(),
    setZoom(value) { zoom = Math.max(70, Math.min(150, value)); layoutSurface(); return zoom; }
  };
}
