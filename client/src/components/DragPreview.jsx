import React, { useRef, useEffect, useCallback, useImperativeHandle, forwardRef, useState } from 'react';

const SKIP_TAGS = new Set(['TABLE', 'TBODY', 'THEAD', 'TR', 'TFOOT']);

const DragPreview = forwardRef(function DragPreview({ html, onDirty, scale = 1, style = {}, active = false }, ref) {
  const containerRef = useRef(null);
  const isDragging = useRef(false);
  const internalEdit = useRef(false);

  useImperativeHandle(ref, () => ({
    getHtml: () => {
      if (!containerRef.current) return html || '';
      const clone = containerRef.current.cloneNode(true);
      clone.querySelectorAll('[data-hl]').forEach(el => {
        el.style.outline = '';
        el.style.outlineOffset = '';
        el.style.cursor = '';
        el.removeAttribute('data-hl');
      });
      return clone.innerHTML;
    }
  }));

  // ALWAYS set innerHTML from prop — unless we just made an internal edit
  useEffect(() => {
    if (!containerRef.current) return;
    if (internalEdit.current) {
      internalEdit.current = false;
      return;
    }
    containerRef.current.innerHTML = html || '';
  }, [html]);

  function notifyDirty() {
    internalEdit.current = true;
    if (onDirty) onDirty();
  }

  function getTarget(evt) {
    let el = evt;
    const c = containerRef.current;
    if (!el || !c || el === c || !c.contains(el)) return null;
    if (SKIP_TAGS.has(el.tagName)) {
      return el.querySelector('td, div, p, span') || null;
    }
    return el;
  }

  const handleMouseDown = useCallback((e) => {
    if (!active) return;
    const target = getTarget(e.target);
    if (!target || target.isContentEditable) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;

    const cs = window.getComputedStyle(target);
    if (cs.position === 'static') target.style.position = 'relative';

    const sx = e.clientX, sy = e.clientY;
    const ol = parseFloat(target.style.left) || 0;
    const ot = parseFloat(target.style.top) || 0;

    target.style.outline = '2px solid #6366f1';
    target.style.outlineOffset = '1px';
    target.style.zIndex = '999';

    function onMove(ev) {
      ev.preventDefault();
      target.style.left = Math.round(ol + (ev.clientX - sx) / scale) + 'px';
      target.style.top = Math.round(ot + (ev.clientY - sy) / scale) + 'px';
    }
    function onUp() {
      target.style.outline = '';
      target.style.outlineOffset = '';
      target.style.zIndex = '';
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      notifyDirty();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [active, scale]);

  const handleDblClick = useCallback((e) => {
    if (!active) return;
    e.stopPropagation();
    const target = getTarget(e.target);
    if (!target) return;

    target.contentEditable = 'true';
    target.style.outline = '2px solid #2e7d32';
    target.style.outlineOffset = '2px';
    target.style.cursor = 'text';
    target.focus();
    try {
      const r = document.createRange(); r.selectNodeContents(target);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    } catch {}

    function finish() {
      target.contentEditable = 'false';
      target.style.outline = '';
      target.style.outlineOffset = '';
      target.style.cursor = '';
      target.removeEventListener('blur', finish);
      target.removeEventListener('keydown', onKey);
      notifyDirty();
    }
    function onKey(ev) {
      if (ev.key === 'Escape') target.blur();
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); target.blur(); }
    }
    target.addEventListener('blur', finish);
    target.addEventListener('keydown', onKey);
  }, [active]);

  const handleOver = useCallback((e) => {
    if (!active || isDragging.current) return;
    const t = getTarget(e.target);
    if (t && !t.isContentEditable && !t.getAttribute('data-hl')) {
      t.style.outline = '1px dashed rgba(99,102,241,0.5)';
      t.style.outlineOffset = '1px';
      t.style.cursor = 'grab';
      t.setAttribute('data-hl', '1');
    }
  }, [active]);

  const handleOut = useCallback((e) => {
    if (!active || isDragging.current) return;
    const t = getTarget(e.target);
    if (t && t.getAttribute('data-hl') && !t.isContentEditable) {
      t.style.outline = '';
      t.style.outlineOffset = '';
      t.style.cursor = '';
      t.removeAttribute('data-hl');
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDblClick}
      onMouseOver={handleOver}
      onMouseOut={handleOut}
      style={style}
    />
  );
});

export default DragPreview;
