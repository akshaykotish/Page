import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError } from '../utils/api';

let fabric = null;

export default function TemplateBuilder() {
  const { isSuperadmin, isAdmin } = useAuth();
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  const fileInputRef = useRef(null);
  const historyRef = useRef({ states: [], index: -1, ignoreChange: false });
  const wrapperRef = useRef(null);
  const abortControllerRef = useRef(null);

  const [templates, setTemplates] = useState([]);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [templateName, setTemplateName] = useState('Untitled Template');
  const [templateType, setTemplateType] = useState('letterhead');
  const [companyProfile, setCompanyProfile] = useState(null);
  const [selectedObj, setSelectedObj] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fabricLoaded, setFabricLoaded] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [canvasHeight, setCanvasHeight] = useState(250);
  const [tab, setTab] = useState('elements'); // 'elements' | 'templates' | 'ai'
  const [filterType, setFilterType] = useState('all');

  // AI Generate state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiStyle, setAiStyle] = useState('professional');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiHistory, setAiHistory] = useState([]);

  // Canvas operation error state
  const [canvasError, setCanvasError] = useState('');

  const CANVAS_W = 794;
  const GRID_SIZE = 20;
  const SNAP_THRESHOLD = 8;

  const defaultHeights = { letterhead: 250, bill_header: 200, bill_footer: 200, letterhead_footer: 100 };

  // ===== LOAD FABRIC =====
  useEffect(() => {
    import('fabric').then(mod => {
      fabric = mod;
      setFabricLoaded(true);
    });
  }, []);

  // ===== INIT CANVAS =====
  useEffect(() => {
    if (!fabricLoaded || !canvasRef.current) return;

    if (fabricRef.current) {
      fabricRef.current.dispose();
    }

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: CANVAS_W,
      height: canvasHeight,
      backgroundColor: '#ffffff',
      selection: true,
      preserveObjectStacking: true,
    });

    canvas.on('selection:created', (e) => syncSelected(canvas));
    canvas.on('selection:updated', (e) => syncSelected(canvas));
    canvas.on('selection:cleared', () => setSelectedObj(null));
    canvas.on('object:modified', () => { syncSelected(canvas); saveHistory(); });
    canvas.on('object:added', () => saveHistory());
    canvas.on('object:removed', () => saveHistory());

    // Snap to grid on move
    canvas.on('object:moving', (e) => {
      if (!snapToGrid) return;
      const obj = e.target;
      obj.set({
        left: Math.round(obj.left / SNAP_THRESHOLD) * SNAP_THRESHOLD,
        top: Math.round(obj.top / SNAP_THRESHOLD) * SNAP_THRESHOLD,
      });
    });

    fabricRef.current = canvas;
    historyRef.current = { states: [], index: -1, ignoreChange: false };
    saveHistory();
    loadTemplates();

    // Load default company header elements after a short delay
    setTimeout(() => loadDefaultHeader(), 300);

    return () => {
      canvas.dispose();
      abortControllerRef.current?.abort();
    };
  }, [fabricLoaded]);

  // Redraw grid when toggled or canvas size changes
  useEffect(() => {
    drawGrid();
  }, [showGrid, canvasHeight, zoom]);

  // Update canvas height when type changes
  useEffect(() => {
    setCanvasHeight(defaultHeights[templateType] || 250);
  }, [templateType]);

  // Resize canvas when canvasHeight changes
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.setDimensions({ height: canvasHeight });
    canvas.renderAll();
    drawGrid();
  }, [canvasHeight]);

  // ===== KEYBOARD SHORTCUTS =====
  useEffect(() => {
    function handleKey(e) {
      const canvas = fabricRef.current;
      if (!canvas) return;

      // Don't capture if typing in inputs
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) || (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
      if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        duplicateSelected();
      }
      // Arrow keys for nudging
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const obj = canvas.getActiveObject();
        if (!obj) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowUp') obj.set('top', obj.top - step);
        if (e.key === 'ArrowDown') obj.set('top', obj.top + step);
        if (e.key === 'ArrowLeft') obj.set('left', obj.left - step);
        if (e.key === 'ArrowRight') obj.set('left', obj.left + step);
        canvas.renderAll();
        syncSelected(canvas);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [snapToGrid]);

  // ===== HISTORY (UNDO/REDO) =====
  function saveHistory() {
    const canvas = fabricRef.current;
    const h = historyRef.current;
    if (!canvas || h.ignoreChange) return;

    const json = JSON.stringify(canvas.toJSON());
    // Trim future states if we're not at the end
    h.states = h.states.slice(0, h.index + 1);
    h.states.push(json);
    if (h.states.length > 50) h.states.shift();
    h.index = h.states.length - 1;
  }

  function restoreHistory(index) {
    const canvas = fabricRef.current;
    const h = historyRef.current;
    if (!canvas || index < 0 || index >= h.states.length) return;

    h.ignoreChange = true;
    h.index = index;
    canvas.loadFromJSON(JSON.parse(h.states[index]), () => {
      canvas.renderAll();
      drawGrid();
      h.ignoreChange = false;
    });
    setSelectedObj(null);
  }

  function undo() { restoreHistory(historyRef.current.index - 1); }
  function redo() { restoreHistory(historyRef.current.index + 1); }

  // ===== GRID =====
  function drawGrid() {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // Remove old grid lines
    const objs = canvas.getObjects().filter(o => o._isGridLine);
    objs.forEach(o => {
      historyRef.current.ignoreChange = true;
      canvas.remove(o);
      historyRef.current.ignoreChange = false;
    });

    if (!showGrid) { canvas.renderAll(); return; }

    historyRef.current.ignoreChange = true;
    for (let x = GRID_SIZE; x < CANVAS_W; x += GRID_SIZE) {
      const line = new fabric.Line([x, 0, x, canvasHeight], {
        stroke: '#e0e0e0', strokeWidth: 0.5, selectable: false, evented: false, excludeFromExport: true,
      });
      line._isGridLine = true;
      canvas.add(line);
      canvas.sendObjectToBack(line);
    }
    for (let y = GRID_SIZE; y < canvasHeight; y += GRID_SIZE) {
      const line = new fabric.Line([0, y, CANVAS_W, y], {
        stroke: '#e0e0e0', strokeWidth: 0.5, selectable: false, evented: false, excludeFromExport: true,
      });
      line._isGridLine = true;
      canvas.add(line);
      canvas.sendObjectToBack(line);
    }
    historyRef.current.ignoreChange = false;
    canvas.renderAll();
  }

  // ===== SELECTED OBJECT SYNC =====
  function syncSelected(canvas) {
    const obj = canvas?.getActiveObject();
    if (!obj) return setSelectedObj(null);
    setSelectedObj({
      type: obj.type,
      left: Math.round(obj.left),
      top: Math.round(obj.top),
      width: Math.round(obj.getScaledWidth()),
      height: Math.round(obj.getScaledHeight()),
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      angle: Math.round(obj.angle),
      fill: obj.fill || '',
      stroke: obj.stroke || '',
      strokeWidth: obj.strokeWidth || 0,
      fontSize: obj.fontSize || 0,
      fontFamily: obj.fontFamily || '',
      fontWeight: obj.fontWeight || 'normal',
      fontStyle: obj.fontStyle || 'normal',
      underline: obj.underline || false,
      textAlign: obj.textAlign || 'left',
      text: obj.text || '',
      opacity: obj.opacity ?? 1,
      rx: obj.rx || 0,
      ry: obj.ry || 0,
    });
  }

  async function loadTemplates() {
    setLoading(true);
    setCanvasError('');
    abortControllerRef.current = new AbortController();
    try {
      const data = await api.get('/templates', { signal: abortControllerRef.current.signal });
      setTemplates(data);
    } catch (err) {
      if (err?.code !== 'ABORT_ERR') {
        console.error('Error loading templates:', err);
        // Don't show error for templates, just log it
      }
    }
    setLoading(false);
  }

  // Load company profile from Firestore
  useEffect(() => {
    (async () => {
      try {
        const { doc, getDoc } = await import('firebase/firestore');
        const { db: clientDb } = await import('../firebase');
        const snap = await getDoc(doc(clientDb, 'settings', 'company'));
        if (snap.exists()) setCompanyProfile(snap.data());
      } catch {}
    })();
  }, []);

  // ===== ELEMENT ADDERS =====
  const cp = companyProfile || {};

  function addText(preset) {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const defaults = {
      heading: { text: cp.name || 'Company Name', fontSize: 28, fontWeight: 'bold', fontFamily: 'Playfair Display' },
      subheading: { text: 'Chartered Accountants & Business Consultants', fontSize: 14, fontWeight: 'normal', fontFamily: 'Inter' },
      body: { text: 'Body text here', fontSize: 12, fontWeight: 'normal', fontFamily: 'Inter' },
      label: { text: 'LABEL', fontSize: 10, fontWeight: 'bold', fontFamily: 'Inter', charSpacing: 200 },
      // Company profile fields
      phone: { text: cp.phone || '+91 98765 43210', fontSize: 11, fontWeight: 'normal', fontFamily: 'Inter' },
      email: { text: cp.email || 'connect@akshaykotish.com', fontSize: 11, fontWeight: 'normal', fontFamily: 'Inter' },
      address: { text: cp.address || '123 Business Street, City', fontSize: 10, fontWeight: 'normal', fontFamily: 'Inter' },
      website: { text: cp.website || 'www.akshaykotish.com', fontSize: 10, fontWeight: 'normal', fontFamily: 'Inter' },
      gstin: { text: `GSTIN: ${cp.gstin || '06AAWCA4919K1Z3'}`, fontSize: 10, fontWeight: 'bold', fontFamily: 'JetBrains Mono' },
      pan: { text: `PAN: ${cp.pan || 'AAWCA4919K'}`, fontSize: 10, fontWeight: 'bold', fontFamily: 'JetBrains Mono' },
      state: { text: `State: ${cp.state || 'Haryana'} (${cp.stateCode || '06'})`, fontSize: 10, fontWeight: 'normal', fontFamily: 'Inter' },
      companyFull: { text: `${cp.name || 'Akshay Kotish & Co.'}\n${cp.address || 'Address'}\nGSTIN: ${cp.gstin || ''} | PAN: ${cp.pan || ''}\n${cp.phone || ''} | ${cp.email || ''}`, fontSize: 9, fontWeight: 'normal', fontFamily: 'Inter' },
      // Invoice fields
      invoice: { text: 'INVOICE', fontSize: 24, fontWeight: 'bold', fontFamily: 'Playfair Display', charSpacing: 400 },
      invoiceNo: { text: 'Invoice No: INV-2026-0001', fontSize: 10, fontWeight: 'bold', fontFamily: 'JetBrains Mono' },
      invoiceDate: { text: `Date: ${new Date().toLocaleDateString('en-IN')}`, fontSize: 10, fontWeight: 'normal', fontFamily: 'Inter' },
      // Bank details
      bankDetails: { text: `Bank Details:\nBank Name: ___________\nA/c No: ___________\nIFSC: ___________\nBranch: ___________`, fontSize: 9, fontWeight: 'normal', fontFamily: 'Inter' },
      // Terms & Conditions
      terms: { text: `Terms & Conditions:\n1. Payment is due within 30 days of invoice date.\n2. Late payments attract interest at 18% per annum.\n3. All disputes are subject to jurisdiction of local courts.\n4. E & O.E.`, fontSize: 8, fontWeight: 'normal', fontFamily: 'Inter' },
      // Footer texts
      computerGenerated: { text: 'This is a computer-generated document and does not require a physical signature.', fontSize: 7, fontWeight: 'normal', fontFamily: 'Inter', fill: '#888' },
      signatureLine: { text: '________________________\nAuthorized Signatory', fontSize: 9, fontWeight: 'normal', fontFamily: 'Inter', textAlign: 'center' },
      thankYou: { text: 'Thank you for your business!', fontSize: 11, fontWeight: 'bold', fontFamily: 'Inter', fill: '#2e7d32' },
    };
    const cfg = defaults[preset] || defaults.body;

    const TextClass = cfg.text.includes('\n') ? fabric.Textbox : fabric.IText;
    const text = new TextClass(cfg.text, {
      left: 50,
      top: 50,
      fontSize: cfg.fontSize,
      fontWeight: cfg.fontWeight,
      fontFamily: cfg.fontFamily,
      fill: cfg.fill || '#1a1a1a',
      charSpacing: cfg.charSpacing || 0,
      textAlign: cfg.textAlign || 'left',
      ...(cfg.text.includes('\n') ? { width: 300 } : {}),
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
  }

  function addShape(type) {
    const canvas = fabricRef.current;
    if (!canvas) return;

    let shape;
    if (type === 'rect') {
      shape = new fabric.Rect({ left: 50, top: 50, width: 200, height: 40, fill: '#2e7d32', rx: 4, ry: 4 });
    } else if (type === 'rect-outline') {
      shape = new fabric.Rect({ left: 50, top: 50, width: 200, height: 40, fill: 'transparent', stroke: '#1a1a1a', strokeWidth: 2, rx: 4, ry: 4 });
    } else if (type === 'line') {
      shape = new fabric.Line([0, 0, 700, 0], { left: 47, top: 100, stroke: '#1a1a1a', strokeWidth: 2 });
    } else if (type === 'line-thick') {
      shape = new fabric.Line([0, 0, 700, 0], { left: 47, top: 100, stroke: '#2e7d32', strokeWidth: 4 });
    } else if (type === 'line-dotted') {
      shape = new fabric.Line([0, 0, 700, 0], { left: 47, top: 100, stroke: '#888', strokeWidth: 2, strokeDashArray: [8, 4] });
    } else if (type === 'circle') {
      shape = new fabric.Circle({ left: 50, top: 50, radius: 30, fill: '#c0e040' });
    } else if (type === 'divider') {
      // Full-width thin green line
      shape = new fabric.Rect({ left: 0, top: canvasHeight - 4, width: CANVAS_W, height: 4, fill: '#2e7d32', selectable: true });
    }
    if (shape) {
      canvas.add(shape);
      canvas.setActiveObject(shape);
      canvas.renderAll();
    }
  }

  function addImage() {
    fileInputRef.current?.click();
  }

  function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const imgEl = new Image();
      imgEl.onload = () => {
        const img = new fabric.FabricImage(imgEl, {
          left: 50,
          top: 20,
          scaleX: Math.min(150 / imgEl.width, 1),
          scaleY: Math.min(150 / imgEl.height, 1),
        });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.renderAll();
      };
      imgEl.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function addCompanyLogo() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const imgEl = new Image();
    imgEl.crossOrigin = 'anonymous';
    imgEl.onload = () => {
      const img = new fabric.FabricImage(imgEl, {
        left: 30,
        top: 20,
        scaleX: 80 / imgEl.width,
        scaleY: 80 / imgEl.height,
      });
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
    };
    imgEl.onerror = () => {
      alert('Company logo not found at /images/akshaykotishandcologo2x.png');
    };
    imgEl.src = '/images/akshaykotishandcologo2x.png';
  }

  function addStamp(type) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const imgEl = new Image();
    imgEl.crossOrigin = 'anonymous';
    imgEl.onload = () => {
      const img = new fabric.FabricImage(imgEl, {
        left: CANVAS_W - 150,
        top: canvasHeight - 120,
        scaleX: 100 / imgEl.width,
        scaleY: 100 / imgEl.height,
      });
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
    };
    imgEl.onerror = () => alert('Stamp image not found');
    imgEl.src = type === 'border' ? '/images/stamp1x_withborder.png' : '/images/stamp_nobroder_1x.png';
  }

  // ===== PROPERTY UPDATES =====
  function updateProperty(prop, value) {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;

    switch (prop) {
      case 'text':
        obj.set('text', value);
        break;
      case 'fontSize':
        obj.set('fontSize', parseInt(value) || 12);
        break;
      case 'fontFamily':
        obj.set('fontFamily', value);
        break;
      case 'fontWeight':
        obj.set('fontWeight', value);
        break;
      case 'fontStyle':
        obj.set('fontStyle', value);
        break;
      case 'underline':
        obj.set('underline', value);
        break;
      case 'textAlign':
        obj.set('textAlign', value);
        break;
      case 'fill':
        obj.set('fill', value);
        break;
      case 'stroke':
        obj.set('stroke', value || null);
        break;
      case 'strokeWidth':
        obj.set('strokeWidth', parseFloat(value) || 0);
        break;
      case 'opacity':
        obj.set('opacity', parseFloat(value));
        break;
      case 'left':
        obj.set('left', parseInt(value) || 0);
        break;
      case 'top':
        obj.set('top', parseInt(value) || 0);
        break;
      case 'angle':
        obj.set('angle', parseInt(value) || 0);
        break;
      case 'width': {
        const newW = parseInt(value) || 1;
        const currentW = obj.getScaledWidth();
        if (currentW > 0) obj.set('scaleX', (obj.scaleX * newW) / currentW);
        break;
      }
      case 'height': {
        const newH = parseInt(value) || 1;
        const currentH = obj.getScaledHeight();
        if (currentH > 0) obj.set('scaleY', (obj.scaleY * newH) / currentH);
        break;
      }
      case 'rx':
        obj.set('rx', parseInt(value) || 0);
        obj.set('ry', parseInt(value) || 0);
        break;
    }

    obj.setCoords();
    canvas.renderAll();
    syncSelected(canvas);
  }

  function deleteSelected() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    if (obj.type === 'activeSelection') {
      obj.forEachObject(o => canvas.remove(o));
      canvas.discardActiveObject();
    } else {
      canvas.remove(obj);
    }
    setSelectedObj(null);
    canvas.renderAll();
  }

  async function duplicateSelected() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    try {
      const cloned = await obj.clone();
      cloned.set({ left: obj.left + 20, top: obj.top + 20 });
      canvas.add(cloned);
      canvas.setActiveObject(cloned);
      canvas.renderAll();
    } catch (err) {
      console.error('Clone failed:', err);
    }
  }

  function bringForward() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (obj) { canvas.bringObjectForward(obj); canvas.renderAll(); }
  }

  function sendBackward() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (obj) { canvas.sendObjectBackwards(obj); canvas.renderAll(); }
  }

  // ===== ALIGNMENT =====
  function alignObject(alignment) {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;

    const w = obj.getScaledWidth();
    const h = obj.getScaledHeight();

    switch (alignment) {
      case 'left': obj.set('left', 0); break;
      case 'center-h': obj.set('left', (CANVAS_W - w) / 2); break;
      case 'right': obj.set('left', CANVAS_W - w); break;
      case 'top': obj.set('top', 0); break;
      case 'center-v': obj.set('top', (canvasHeight - h) / 2); break;
      case 'bottom': obj.set('top', canvasHeight - h); break;
    }
    obj.setCoords();
    canvas.renderAll();
    syncSelected(canvas);
    saveHistory();
  }

  // ===== ZOOM =====
  function setCanvasZoom(newZoom) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const z = Math.max(0.5, Math.min(2, newZoom));
    // Only use CSS transform for zoom — keep canvas internally at full size
    setZoom(z);
    canvas.renderAll();
  }

  // ===== SAVE / LOAD =====
  async function saveTemplate() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    setSaving(true);
    setCanvasError('');

    // Temporarily remove grid for export
    const gridObjs = canvas.getObjects().filter(o => o._isGridLine);
    gridObjs.forEach(o => canvas.remove(o));

    abortControllerRef.current = new AbortController();

    try {
      const canvasJSON = JSON.stringify(canvas.toJSON());
      const thumbnail = canvas.toDataURL({ format: 'png', quality: 0.3, multiplier: 0.3 });

      if (activeTemplate) {
        await api.put(`/templates/${activeTemplate.id}`, {
          name: templateName, canvasJSON, width: CANVAS_W, height: canvasHeight, thumbnail
        }, { signal: abortControllerRef.current.signal });
      } else {
        const created = await api.post('/templates', {
          name: templateName, type: templateType, canvasJSON, width: CANVAS_W, height: canvasHeight, thumbnail
        }, { signal: abortControllerRef.current.signal });
        setActiveTemplate(created);
      }
      await loadTemplates();
    } catch (err) {
      if (err?.code === 'TIMEOUT') {
        setCanvasError('Save request timed out. Please try again.');
      } else if (err?.code !== 'ABORT_ERR') {
        const message = err?.message || 'Failed to save template';
        setCanvasError(message);
        console.error('Save error:', err);
      }
    }

    // Restore grid
    drawGrid();
    setSaving(false);
  }

  function loadTemplate(tmpl) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    setActiveTemplate(tmpl);
    setTemplateName(tmpl.name);
    setTemplateType(tmpl.type);
    setCanvasHeight(tmpl.height || defaultHeights[tmpl.type] || 250);

    if (tmpl.canvasJSON) {
      historyRef.current.ignoreChange = true;
      canvas.loadFromJSON(JSON.parse(tmpl.canvasJSON), () => {
        canvas.renderAll();
        historyRef.current.ignoreChange = false;
        historyRef.current = { states: [tmpl.canvasJSON], index: 0, ignoreChange: false };
        drawGrid();
      });
    }
  }

  function loadDefaultHeader() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    // Don't load if canvas already has objects (template loaded)
    const nonGridObjs = canvas.getObjects().filter(o => !o._isGridLine);
    if (nonGridObjs.length > 0) return;

    const c = companyProfile || {};
    const name = c.name || 'Akshay Kotish & Co.';
    const legalName = c.legalName || 'Akshay Lakshay Kotish Private Limited';
    const gstin = c.gstin || '06AAWCA4919K1Z3';
    const cin = c.cin || 'U72900HR2022PTC101170';
    const pan = c.pan || 'AAWCA4919K';
    const addr = c.address || 'H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027';
    const phone = c.phone || '+91 98967 70369';
    const email = c.email || 'akshaykotish@gmail.com';
    const website = c.website || 'www.akshaykotish.com';

    historyRef.current.ignoreChange = true;

    // Use percentages of canvas dimensions so elements always fit
    // Canvas: W=794, H=250 (or whatever canvasHeight is)
    const W = CANVAS_W;
    const H = canvasHeight;
    // Percentage helpers — x% of width, y% of height
    const px = (pct) => Math.round(W * pct / 100);
    const py = (pct) => Math.round(H * pct / 100);

    // ── TOP BAR (0%, full width, 2% height) ──
    canvas.add(new fabric.Rect({ left: 0, top: 0, width: W, height: py(2.5), fill: '#2e7d32' }));

    // ── LEFT COLUMN (4% to 58% of width) ──
    const LX = px(4);        // ~32
    const LW = px(54);       // ~428 (left column width)

    // Company brand name — 8% from top
    canvas.add(new fabric.Textbox(name, {
      left: LX, top: py(8), width: LW, fontSize: 22, fontFamily: 'Playfair Display', fontWeight: 'bold', fill: '#1a1a1a',
    }));
    // Legal name — 20% from top
    canvas.add(new fabric.Textbox(legalName, {
      left: LX, top: py(20), width: LW, fontSize: 8, fontFamily: 'Inter', fontWeight: 'normal', fill: '#aaaaaa', fontStyle: 'italic',
    }));
    // Tagline — 26% from top
    canvas.add(new fabric.Textbox('Chartered Accountants & Business Consultants', {
      left: LX, top: py(26), width: LW, fontSize: 9, fontFamily: 'Inter', fontWeight: 'normal', fill: '#2e7d32',
    }));
    // GSTIN — 36%
    canvas.add(new fabric.Textbox(`GSTIN: ${gstin}`, {
      left: LX, top: py(36), width: px(26), fontSize: 8, fontFamily: 'JetBrains Mono', fontWeight: 'bold', fill: '#333333',
    }));
    // CIN — 36%, offset right
    canvas.add(new fabric.Textbox(`CIN: ${cin}`, {
      left: px(30), top: py(36), width: px(28), fontSize: 8, fontFamily: 'JetBrains Mono', fontWeight: 'normal', fill: '#666666',
    }));
    // PAN + State — 44%
    canvas.add(new fabric.Textbox(`PAN: ${pan}  |  State: Haryana (06)`, {
      left: LX, top: py(44), width: LW, fontSize: 8, fontFamily: 'JetBrains Mono', fontWeight: 'normal', fill: '#777777',
    }));
    // Address — 54%
    canvas.add(new fabric.Textbox(addr, {
      left: LX, top: py(54), width: LW, fontSize: 8, fontFamily: 'Inter', fontWeight: 'normal', fill: '#888888', lineHeight: 1.4,
    }));

    // ── DIVIDER at 62% of width ──
    canvas.add(new fabric.Rect({ left: px(62), top: py(6), width: 2, height: py(88), fill: '#2e7d32' }));

    // ── RIGHT COLUMN (65% to 96% of width) ──
    const RX = px(65);       // ~516
    const RW = px(31);       // ~246

    // Email — 10% from top
    canvas.add(new fabric.Textbox(email, {
      left: RX, top: py(10), width: RW, fontSize: 10, fontFamily: 'Inter', fontWeight: 'normal', fill: '#444444',
    }));
    // Phone — 22%
    canvas.add(new fabric.Textbox(phone, {
      left: RX, top: py(22), width: RW, fontSize: 10, fontFamily: 'Inter', fontWeight: 'normal', fill: '#444444',
    }));
    // Website — 34%
    canvas.add(new fabric.Textbox(website, {
      left: RX, top: py(34), width: RW, fontSize: 11, fontFamily: 'Inter', fontWeight: 'bold', fill: '#2e7d32',
    }));
    // Short address — 50%
    canvas.add(new fabric.Textbox('Kaithal, Haryana\nIndia - 136027', {
      left: RX, top: py(50), width: RW, fontSize: 9, fontFamily: 'Inter', fontWeight: 'normal', fill: '#888888', lineHeight: 1.5,
    }));

    // ── BOTTOM BAR (98%, full width) ──
    canvas.add(new fabric.Rect({ left: 0, top: py(98), width: W, height: py(2.5), fill: '#2e7d32' }));

    historyRef.current.ignoreChange = false;
    canvas.renderAll();
    saveHistory();

    // DEBUG: Log all element positions
    console.log('=== CANVAS DEBUG ===');
    console.log('Canvas DOM element size:', canvasRef.current?.width, 'x', canvasRef.current?.height);
    console.log('Canvas fabric size:', canvas.width, 'x', canvas.height);
    console.log('Wrapper clientWidth:', wrapperRef.current?.clientWidth);
    console.log('Canvas parent offsetWidth:', canvasRef.current?.parentElement?.offsetWidth);
    console.log('Canvas zoom:', canvas.getZoom?.() || 'N/A');
    console.log('Viewport transform:', canvas.viewportTransform);
    const allObjs = canvas.getObjects().filter(o => !o._isGridLine);
    allObjs.forEach((obj, i) => {
      const w = obj.width ? Math.round(obj.width * (obj.scaleX || 1)) : 0;
      const h = obj.height ? Math.round(obj.height * (obj.scaleY || 1)) : 0;
      const rightEdge = Math.round(obj.left + w);
      const bottomEdge = Math.round(obj.top + h);
      const text = obj.text ? obj.text.substring(0, 30) : '';
      console.log(`[${i}] type=${obj.type} left=${Math.round(obj.left)} top=${Math.round(obj.top)} w=${w} h=${h} right=${rightEdge} bottom=${bottomEdge} text="${text}"`);
    });
    console.log('=== END DEBUG ===');
  }

  function newTemplate() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    historyRef.current.ignoreChange = true;
    canvas.clear();
    canvas.backgroundColor = '#ffffff';
    canvas.renderAll();
    historyRef.current.ignoreChange = false;
    historyRef.current = { states: [], index: -1, ignoreChange: false };
    saveHistory();
    setActiveTemplate(null);
    setTemplateName('Untitled Template');
    setSelectedObj(null);
    drawGrid();
    // Auto-load company header elements
    setTimeout(() => loadDefaultHeader(), 100);
  }

  async function setAsDefault() {
    if (!activeTemplate) return;
    setCanvasError('');
    abortControllerRef.current = new AbortController();
    try {
      await api.put(`/templates/${activeTemplate.id}`, { isDefault: true }, { signal: abortControllerRef.current.signal });
      await loadTemplates();
    } catch (err) {
      if (err?.code !== 'ABORT_ERR') {
        const message = err?.message || 'Failed to set as default';
        setCanvasError(message);
        console.error('Set default error:', err);
      }
    }
  }

  async function deleteTemplate(id) {
    if (!confirm('Delete this template?')) return;
    setCanvasError('');
    abortControllerRef.current = new AbortController();
    try {
      await api.delete(`/templates/${id}`, { signal: abortControllerRef.current.signal });
      if (activeTemplate?.id === id) newTemplate();
      await loadTemplates();
    } catch (err) {
      if (err?.code !== 'ABORT_ERR') {
        const message = err?.message || 'Failed to delete template';
        setCanvasError(message);
        console.error('Delete error:', err);
      }
    }
  }

  // ===== AI TEMPLATE GENERATION =====
  // Load a preset professional template (instant, no AI)
  async function loadPresetTemplate(presetStyle) {
    const canvas = fabricRef.current;
    if (!canvas) return;

    setAiGenerating(true);
    setAiError('');
    abortControllerRef.current = new AbortController();

    try {
      const result = await api.post('/ai/preset-template', {
        templateType,
        style: presetStyle || aiStyle,
        canvasWidth: CANVAS_W,
        canvasHeight,
        companyProfile: companyProfile || {},
      }, { signal: abortControllerRef.current.signal });

      if (!result.elements || result.elements.length === 0) {
        setAiError('No elements generated. Please try again.');
        setAiGenerating(false);
        return;
      }

      // Clear canvas first
      historyRef.current.ignoreChange = true;
      canvas.clear();
      canvas.backgroundColor = '#ffffff';
      historyRef.current.ignoreChange = false;

      // Add elements
      addElementsToCanvas(result.elements);
      setAiHistory(prev => [{ prompt: `Preset: ${presetStyle}`, style: presetStyle, count: result.count, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 9)]);
    } catch (err) {
      if (err?.code === 'TIMEOUT') {
        setAiError('Request timed out. Please try again.');
      } else if (err?.code !== 'ABORT_ERR') {
        setAiError(err?.message || 'Failed to load preset template');
      }
    }
    setAiGenerating(false);
  }

  // Shared function to add elements array to canvas
  function addElementsToCanvas(elements) {
    const canvas = fabricRef.current;
    if (!canvas) return 0;
    let count = 0;

    for (const el of elements) {
      try {
        if (el.type === 'i-text') {
          canvas.add(new fabric.IText(el.text || 'Text', {
            left: el.left || 50, top: el.top || 50, fontSize: el.fontSize || 12,
            fontFamily: el.fontFamily || 'Inter', fontWeight: el.fontWeight || 'normal',
            fontStyle: el.fontStyle || 'normal', fill: el.fill || '#1a1a1a',
            charSpacing: el.charSpacing || 0, textAlign: el.textAlign || 'left',
            underline: el.underline || false, opacity: el.opacity ?? 1,
          }));
          count++;
        } else if (el.type === 'textbox') {
          canvas.add(new fabric.Textbox(el.text || 'Text', {
            left: el.left || 50, top: el.top || 50, width: el.width || 300,
            fontSize: el.fontSize || 12, fontFamily: el.fontFamily || 'Inter',
            fontWeight: el.fontWeight || 'normal', fontStyle: el.fontStyle || 'normal',
            fill: el.fill || '#1a1a1a', textAlign: el.textAlign || 'left',
            lineHeight: el.lineHeight || 1.4, opacity: el.opacity ?? 1,
          }));
          count++;
        } else if (el.type === 'rect') {
          canvas.add(new fabric.Rect({
            left: el.left || 0, top: el.top || 0, width: el.width || 100, height: el.height || 40,
            fill: el.fill || '#2e7d32', stroke: el.stroke || null, strokeWidth: el.strokeWidth || 0,
            rx: el.rx || 0, ry: el.ry || 0, opacity: el.opacity ?? 1,
          }));
          count++;
        } else if (el.type === 'line') {
          canvas.add(new fabric.Line([el.x1 || 0, el.y1 || 0, el.x2 || 700, el.y2 || 0], {
            left: el.left || 47, top: el.top || 100, stroke: el.stroke || '#1a1a1a',
            strokeWidth: el.strokeWidth || 2, opacity: el.opacity ?? 1,
          }));
          count++;
        } else if (el.type === 'circle') {
          canvas.add(new fabric.Circle({
            left: el.left || 50, top: el.top || 50, radius: el.radius || 20,
            fill: el.fill || '#c0e040', stroke: el.stroke || null,
            strokeWidth: el.strokeWidth || 0, opacity: el.opacity ?? 1,
          }));
          count++;
        }
      } catch (err) { console.warn('Skipped element:', el.type, err); }
    }

    canvas.renderAll();
    saveHistory();
    return count;
  }

  async function generateWithAI() {
    if (!aiPrompt.trim()) return;
    const canvas = fabricRef.current;
    if (!canvas) return;

    setAiGenerating(true);
    setAiError('');

    try {
      const result = await api.post('/ai/generate-template', {
        prompt: aiPrompt.trim(),
        templateType,
        canvasWidth: CANVAS_W,
        canvasHeight,
        companyProfile: companyProfile || {},
        style: aiStyle,
      });

      if (!result.elements || result.elements.length === 0) {
        setAiError('No elements generated. Try a different prompt.');
        setAiGenerating(false);
        return;
      }

      // Add each element to the canvas
      let addedCount = 0;
      for (const el of result.elements) {
        try {
          if (el.type === 'i-text') {
            const text = new fabric.IText(el.text || 'Text', {
              left: el.left || 50,
              top: el.top || 50,
              fontSize: el.fontSize || 12,
              fontFamily: el.fontFamily || 'Inter',
              fontWeight: el.fontWeight || 'normal',
              fontStyle: el.fontStyle || 'normal',
              fill: el.fill || '#1a1a1a',
              charSpacing: el.charSpacing || 0,
              textAlign: el.textAlign || 'left',
              underline: el.underline || false,
              opacity: el.opacity ?? 1,
            });
            canvas.add(text);
            addedCount++;
          } else if (el.type === 'textbox') {
            const textbox = new fabric.Textbox(el.text || 'Text', {
              left: el.left || 50,
              top: el.top || 50,
              width: el.width || 300,
              fontSize: el.fontSize || 12,
              fontFamily: el.fontFamily || 'Inter',
              fontWeight: el.fontWeight || 'normal',
              fontStyle: el.fontStyle || 'normal',
              fill: el.fill || '#1a1a1a',
              textAlign: el.textAlign || 'left',
              lineHeight: el.lineHeight || 1.4,
              opacity: el.opacity ?? 1,
            });
            canvas.add(textbox);
            addedCount++;
          } else if (el.type === 'rect') {
            const rect = new fabric.Rect({
              left: el.left || 0,
              top: el.top || 0,
              width: el.width || 100,
              height: el.height || 40,
              fill: el.fill || '#2e7d32',
              stroke: el.stroke || null,
              strokeWidth: el.strokeWidth || 0,
              rx: el.rx || 0,
              ry: el.ry || 0,
              opacity: el.opacity ?? 1,
            });
            canvas.add(rect);
            addedCount++;
          } else if (el.type === 'line') {
            const line = new fabric.Line(
              [el.x1 || 0, el.y1 || 0, el.x2 || 700, el.y2 || 0],
              {
                left: el.left || 47,
                top: el.top || 100,
                stroke: el.stroke || '#1a1a1a',
                strokeWidth: el.strokeWidth || 2,
                opacity: el.opacity ?? 1,
              }
            );
            canvas.add(line);
            addedCount++;
          } else if (el.type === 'circle') {
            const circle = new fabric.Circle({
              left: el.left || 50,
              top: el.top || 50,
              radius: el.radius || 20,
              fill: el.fill || '#c0e040',
              stroke: el.stroke || null,
              strokeWidth: el.strokeWidth || 0,
              opacity: el.opacity ?? 1,
            });
            canvas.add(circle);
            addedCount++;
          }
        } catch (err) {
          console.warn('Skipped element:', el.type, err);
        }
      }

      canvas.renderAll();
      saveHistory();

      // Save to AI history
      setAiHistory(prev => [{
        prompt: aiPrompt,
        style: aiStyle,
        count: addedCount,
        time: new Date().toLocaleTimeString(),
      }, ...prev.slice(0, 9)]);

      setAiPrompt('');
    } catch (err) {
      console.error('AI generation error:', err);
      setAiError(err.message || 'Failed to generate template. Try again.');
    }
    setAiGenerating(false);
  }

  function clearCanvasForAI() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (!confirm('Clear canvas before generating? This will remove all current elements.')) return;
    historyRef.current.ignoreChange = true;
    canvas.clear();
    canvas.backgroundColor = '#ffffff';
    canvas.renderAll();
    historyRef.current.ignoreChange = false;
    saveHistory();
    setSelectedObj(null);
    drawGrid();
  }

  // ===== FILTERED TEMPLATES =====
  const filteredTemplates = filterType === 'all'
    ? templates
    : templates.filter(t => t.type === filterType);

  // ===== STYLES =====
  const s = {
    page: { display: 'flex', flexDirection: 'column', gap: 0, height: 'calc(100vh - 130px)', margin: '-1.5rem', overflow: 'hidden' },
    toolbar: {
      display: 'flex', gap: 6, alignItems: 'center', padding: '8px 12px', flexWrap: 'wrap',
      background: '#fff', borderBottom: '2px solid #e0e0e0', marginBottom: 0,
      flexShrink: 0,
    },
    wrap: { display: 'flex', gap: 0, flex: 1, minHeight: 0, overflow: 'hidden' },
    leftPanel: {
      width: 220, minWidth: 220, flexShrink: 0, display: 'flex', flexDirection: 'column',
      borderRight: '2px solid #e0e0e0', background: '#fafafa', overflowY: 'auto',
    },
    centerPanel: {
      flex: 1, display: 'flex', flexDirection: 'column', background: '#e8e8e8',
      overflow: 'auto', alignItems: 'flex-start', padding: '16px 12px', minWidth: 0,
    },
    rightPanel: {
      width: 240, minWidth: 240, flexShrink: 0, display: 'flex', flexDirection: 'column',
      borderLeft: '2px solid #e0e0e0', background: '#fafafa', overflowY: 'auto',
    },
    section: { padding: '12px', borderBottom: '1px solid #eee' },
    sectionTitle: {
      fontFamily: 'Playfair Display, serif', fontSize: 11, fontWeight: 900,
      marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1.5, color: '#555',
    },
    btn: {
      padding: '6px 8px', border: '1.5px solid #ccc', borderRadius: 5,
      background: '#fff', fontWeight: 700, fontSize: 11, cursor: 'pointer',
      textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6,
      transition: 'all 0.15s', lineHeight: 1.3,
    },
    btnHover: { transform: 'translateY(-1px)', boxShadow: '2px 2px 0 #1a1a1a' },
    btnSm: {
      padding: '4px 8px', border: '1.5px solid #ccc', borderRadius: 4,
      background: '#fff', fontWeight: 700, fontSize: 10, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
      transition: 'all 0.1s', minWidth: 28,
    },
    btnPrimary: {
      padding: '6px 14px', border: '2px solid #1a1a1a', borderRadius: 6,
      background: '#2e7d32', color: '#fff', fontWeight: 900, fontSize: 11,
      cursor: 'pointer', boxShadow: '2px 2px 0 #1a1a1a', textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    btnDanger: {
      padding: '4px 8px', border: '1.5px solid #c62828', borderRadius: 4,
      background: '#ffebee', color: '#c62828', fontWeight: 700, fontSize: 10, cursor: 'pointer',
    },
    canvasWrap: {
      border: '1px solid #bbb', boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
      background: '#fff', position: 'relative',
    },
    input: {
      width: '100%', padding: '4px 6px', border: '1.5px solid #ddd', borderRadius: 4,
      fontSize: 11, fontWeight: 600, outline: 'none', transition: 'border-color 0.15s',
      fontFamily: 'Inter, sans-serif',
    },
    inputFocus: { borderColor: '#2e7d32' },
    label: {
      fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8,
      color: '#999', marginBottom: 2, display: 'block',
    },
    propRow: { marginBottom: 6 },
    templateCard: {
      padding: '10px 12px', border: '2px solid #eee', borderRadius: 8,
      cursor: 'pointer', transition: 'all 0.15s', display: 'flex',
      justifyContent: 'space-between', alignItems: 'center', gap: 8, background: '#fff',
    },
    badge: {
      display: 'inline-block', padding: '2px 6px', fontSize: 9, fontWeight: 900,
      textTransform: 'uppercase', letterSpacing: 0.5, borderRadius: 3,
    },
    tabBtn: (active) => ({
      flex: 1, padding: '6px 0', border: 'none', borderBottom: active ? '2px solid #2e7d32' : '2px solid transparent',
      background: 'none', fontWeight: 800, fontSize: 10, cursor: 'pointer',
      textTransform: 'uppercase', letterSpacing: 1, color: active ? '#2e7d32' : '#888',
      transition: 'all 0.15s',
    }),
    iconBtn: {
      width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '1.5px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer',
      fontSize: 12, fontWeight: 700, transition: 'all 0.1s', flexShrink: 0,
    },
  };

  if (!fabricLoaded) return <div className="loading-screen"><div className="loader"></div></div>;

  return (
    <div style={s.page}>
      {/* ===== TOP TOOLBAR ===== */}
      <div style={s.toolbar}>
        <select value={templateType} onChange={e => { setTemplateType(e.target.value); newTemplate(); }}
          style={{ ...s.input, width: 'auto', fontWeight: 800, fontSize: 11 }}>
          <option value="letterhead">Letterhead Header</option>
          <option value="bill_header">Bill Header</option>
          <option value="bill_footer">Bill Footer</option>
          <option value="letterhead_footer">Letterhead Footer</option>
        </select>

        <input value={templateName} onChange={e => setTemplateName(e.target.value)}
          placeholder="Template name" style={{ ...s.input, width: 140, fontSize: 11 }} />

        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          <span style={{ fontSize: 8, fontWeight: 800, color: '#aaa' }}>H:</span>
          <input type="number" value={canvasHeight} min={100} max={600}
            onChange={e => setCanvasHeight(parseInt(e.target.value) || 200)}
            style={{ ...s.input, width: 48, fontSize: 11 }} />
        </div>

        <div style={{ width: 1, height: 20, background: '#e0e0e0' }} />

        {/* Undo/Redo */}
        <button onClick={undo} style={s.iconBtn} title="Undo (Ctrl+Z)">↶</button>
        <button onClick={redo} style={s.iconBtn} title="Redo (Ctrl+Y)">↷</button>

        <div style={{ width: 1, height: 20, background: '#e0e0e0' }} />

        {/* Grid/Snap */}
        <button onClick={() => setShowGrid(!showGrid)}
          style={{ ...s.iconBtn, background: showGrid ? '#e8f5e9' : '#fff', borderColor: showGrid ? '#2e7d32' : '#ddd' }}
          title="Toggle Grid">
          ▦
        </button>
        <button onClick={() => setSnapToGrid(!snapToGrid)}
          style={{ ...s.iconBtn, background: snapToGrid ? '#e8f5e9' : '#fff', borderColor: snapToGrid ? '#2e7d32' : '#ddd', fontSize: 9 }}
          title="Snap to Grid">
          ⊞
        </button>

        <div style={{ width: 1, height: 20, background: '#e0e0e0' }} />

        {/* Zoom */}
        <button onClick={() => setCanvasZoom(zoom - 0.1)} style={s.iconBtn} title="Zoom Out">−</button>
        <span style={{ fontSize: 10, fontWeight: 800, minWidth: 32, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setCanvasZoom(zoom + 0.1)} style={s.iconBtn} title="Zoom In">+</button>

        <div style={{ flex: 1 }} />

        <button onClick={newTemplate} style={s.btnSm}>New</button>
        {activeTemplate && (
          <button onClick={setAsDefault} style={{ ...s.btnSm, background: '#c0e040', borderColor: '#999' }}>
            Default
          </button>
        )}
        <button onClick={saveTemplate} disabled={saving} style={s.btnPrimary}>
          {saving ? 'Saving...' : (activeTemplate ? 'Update' : 'Save')}
        </button>
      </div>

      {/* ===== MAIN CONTENT ===== */}
      <div style={s.wrap}>
        {/* ===== LEFT PANEL ===== */}
        <div style={s.leftPanel}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '2px solid #eee' }}>
            <button style={s.tabBtn(tab === 'elements')} onClick={() => setTab('elements')}>Elements</button>
            <button style={s.tabBtn(tab === 'ai')} onClick={() => setTab('ai')}>AI</button>
            <button style={s.tabBtn(tab === 'templates')} onClick={() => setTab('templates')}>Saved</button>
          </div>

          {tab === 'ai' ? (
            /* AI GENERATE TAB */
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* PRESET TEMPLATES - Instant, no AI */}
              <div style={{ ...s.section, background: '#f0fdf4', borderBottom: '2px solid #2e7d32' }}>
                <div style={s.sectionTitle}>Preset Templates</div>
                <p style={{ fontSize: 10, color: '#666', marginBottom: 8, lineHeight: 1.4 }}>
                  Load a professional template instantly with your company details. Drag elements to adjust.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {[
                    { id: 'professional', label: 'Professional', color: '#2e7d32' },
                    { id: 'modern', label: 'Modern', color: '#1565c0' },
                    { id: 'minimal', label: 'Minimal', color: '#555' },
                    { id: 'bold', label: 'Bold', color: '#c62828' },
                    { id: 'classic', label: 'Classic', color: '#4a148c' },
                    { id: 'elegant', label: 'Elegant', color: '#1b5e20' },
                  ].map(preset => (
                    <button key={preset.id} onClick={() => loadPresetTemplate(preset.id)}
                      disabled={aiGenerating}
                      style={{
                        ...s.btn, fontSize: 10, justifyContent: 'center', padding: '8px 4px',
                        background: '#fff', borderColor: preset.color, color: preset.color,
                        opacity: aiGenerating ? 0.5 : 1,
                      }}>
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* AI CUSTOM GENERATION */}
              <div style={s.section}>
                <div style={s.sectionTitle}>AI Custom Design</div>
                <p style={{ fontSize: 10, color: '#888', marginBottom: 10, lineHeight: 1.5 }}>
                  Describe what you want and AI will generate custom elements.
                </p>

                {/* Style selector */}
                <div style={{ marginBottom: 10 }}>
                  <span style={s.label}>Design Style</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
                    {[
                      { id: 'professional', label: 'Professional', color: '#1a1a1a' },
                      { id: 'modern', label: 'Modern', color: '#1565c0' },
                      { id: 'minimal', label: 'Minimal', color: '#888' },
                      { id: 'bold', label: 'Bold', color: '#c62828' },
                      { id: 'classic', label: 'Classic', color: '#6a1b9a' },
                      { id: 'elegant', label: 'Elegant', color: '#2e7d32' },
                    ].map(st => (
                      <button key={st.id} onClick={() => setAiStyle(st.id)}
                        style={{
                          ...s.btn, fontSize: 10, justifyContent: 'center', padding: '5px 4px',
                          background: aiStyle === st.id ? '#e8f5e9' : '#fff',
                          borderColor: aiStyle === st.id ? '#2e7d32' : '#ddd',
                          color: aiStyle === st.id ? '#2e7d32' : st.color,
                        }}>
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Prompt input */}
                <div style={{ marginBottom: 8 }}>
                  <span style={s.label}>Describe Your Template</span>
                  <textarea
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                    placeholder="e.g., Create a professional letterhead with company name prominently on top, green accent bar, contact details on the right side, GSTIN below the company name"
                    style={{
                      ...s.input, minHeight: 80, resize: 'vertical', fontSize: 11,
                      fontFamily: 'Inter, sans-serif', lineHeight: 1.5,
                    }}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generateWithAI(); }}
                  />
                  <span style={{ fontSize: 9, color: '#bbb' }}>Ctrl+Enter to generate</span>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={generateWithAI}
                    disabled={aiGenerating || !aiPrompt.trim()}
                    style={{
                      ...s.btnPrimary, flex: 1, textAlign: 'center', justifyContent: 'center',
                      opacity: (aiGenerating || !aiPrompt.trim()) ? 0.5 : 1,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {aiGenerating ? (
                      <>
                        <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                        Generating...
                      </>
                    ) : 'Generate'}
                  </button>
                  <button onClick={clearCanvasForAI} style={s.btnSm} title="Clear canvas first">
                    Clear
                  </button>
                </div>

                {/* Error */}
                {aiError && (
                  <div style={{ marginTop: 8, padding: '6px 10px', background: '#ffebee', border: '1.5px solid #c62828', borderRadius: 4, fontSize: 10, color: '#c62828', fontWeight: 600 }}>
                    {aiError}
                  </div>
                )}
              </div>

              {/* Quick prompts */}
              <div style={s.section}>
                <div style={s.sectionTitle}>Quick Prompts</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[
                    { label: 'Professional Letterhead', prompt: 'Create a clean professional letterhead header with company name large on top-left, a green accent bar at the bottom, contact info (email, phone, website) aligned to the right, and GSTIN below the company name' },
                    { label: 'Bold Invoice Header', prompt: 'Design a bold invoice header with a dark background bar at top, white company name, large "TAX INVOICE" text on the right, GSTIN and address below, with a green bottom border' },
                    { label: 'Minimal Letterhead', prompt: 'Create a minimal letterhead with just the company name centered at top in an elegant serif font, a thin line underneath, and small contact details centered below the line' },
                    { label: 'Bill Footer with Bank', prompt: 'Design a bill footer with bank account details on the left, terms and conditions in the center, and an authorized signatory area on the right with a signature line' },
                    { label: 'Modern Header', prompt: 'Create a modern template header with a colored sidebar strip on the left edge, company name in a bold sans-serif font, tagline below it, and contact details stacked on the right with small icons' },
                    { label: 'Classic Formal', prompt: 'Design a classic formal letterhead with an ornate top border, centered company name in serif font, "Chartered Accountants" subtitle, and full address centered below a decorative line' },
                  ].map((qp, i) => (
                    <button key={i} onClick={() => { setAiPrompt(qp.prompt); }}
                      style={{ ...s.btn, fontSize: 10, lineHeight: 1.3 }}>
                      <span style={{ fontSize: 10, color: '#2e7d32', fontWeight: 900, flexShrink: 0 }}>+</span>
                      <span>{qp.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Generation history */}
              {aiHistory.length > 0 && (
                <div style={s.section}>
                  <div style={s.sectionTitle}>Recent Generations</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {aiHistory.map((h, i) => (
                      <div key={i} onClick={() => setAiPrompt(h.prompt)}
                        style={{
                          padding: '6px 8px', background: '#f5f5f5', borderRadius: 4,
                          cursor: 'pointer', fontSize: 10, lineHeight: 1.4, transition: 'background 0.1s',
                        }}>
                        <div style={{ fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {h.prompt.substring(0, 50)}...
                        </div>
                        <div style={{ color: '#999', fontSize: 9, marginTop: 2 }}>
                          {h.count} elements · {h.style} · {h.time}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : tab === 'elements' ? (
            <>
              {/* Images, Logos & Stamps */}
              <div style={s.section}>
                <div style={s.sectionTitle}>Images & Stamps</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button onClick={addCompanyLogo} style={{ ...s.btn, background: '#e8f5e9', borderColor: '#2e7d32' }}>
                    <span style={{ fontSize: 12, fontWeight: 900, color: '#2e7d32' }}>AK</span>
                    <span>Company Logo</span>
                  </button>
                  <button onClick={addImage} style={s.btn}>
                    <span style={{ fontSize: 11 }}>+</span><span>Upload Image</span>
                  </button>
                  <button onClick={() => addStamp('border')} style={{ ...s.btn, background: '#fce4ec' }}>
                    <span style={{ fontSize: 10 }}>&#9632;</span><span>Official Stamp</span>
                  </button>
                  <button onClick={() => addStamp('noborder')} style={s.btn}>
                    <span style={{ fontSize: 10 }}>&#9633;</span><span>Stamp (No Border)</span>
                  </button>
                </div>
              </div>

              {/* Company Profile Fields */}
              <div style={s.section}>
                <div style={s.sectionTitle}>Company Profile</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button onClick={() => addText('heading')} style={s.btn}>
                    <span style={{ fontSize: 13, fontWeight: 900 }}>H</span><span>Company Name</span>
                  </button>
                  <button onClick={() => addText('subheading')} style={s.btn}>
                    <span style={{ fontSize: 11 }}>S</span><span>Tagline</span>
                  </button>
                  <button onClick={() => addText('phone')} style={s.btn}>
                    <span style={{ fontSize: 10 }}>Ph</span><span>{cp.phone || 'Phone'}</span>
                  </button>
                  <button onClick={() => addText('email')} style={s.btn}>
                    <span style={{ fontSize: 10 }}>@</span><span>{cp.email || 'Email'}</span>
                  </button>
                  <button onClick={() => addText('address')} style={s.btn}>
                    <span style={{ fontSize: 10 }}>A</span><span>Address</span>
                  </button>
                  <button onClick={() => addText('website')} style={s.btn}>
                    <span style={{ fontSize: 10 }}>W</span><span>{cp.website || 'Website'}</span>
                  </button>
                  <button onClick={() => addText('gstin')} style={s.btn}>
                    <span style={{ fontSize: 9, fontWeight: 900 }}>GST</span><span>GSTIN</span>
                  </button>
                  <button onClick={() => addText('pan')} style={s.btn}>
                    <span style={{ fontSize: 9, fontWeight: 900 }}>PAN</span><span>PAN Number</span>
                  </button>
                  <button onClick={() => addText('state')} style={s.btn}>
                    <span style={{ fontSize: 10 }}>St</span><span>State & Code</span>
                  </button>
                  <button onClick={() => addText('companyFull')} style={{ ...s.btn, background: '#e8f5e9' }}>
                    <span style={{ fontSize: 9, fontWeight: 900 }}>All</span><span>Full Company Block</span>
                  </button>
                </div>
              </div>

              {/* Text & Invoice */}
              <div style={s.section}>
                <div style={s.sectionTitle}>Text Elements</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button onClick={() => addText('body')} style={s.btn}>
                    <span style={{ fontSize: 11 }}>T</span><span>Body Text</span>
                  </button>
                  <button onClick={() => addText('label')} style={s.btn}>
                    <span style={{ fontSize: 9, letterSpacing: 2, fontWeight: 900 }}>LB</span><span>Label</span>
                  </button>
                  <button onClick={() => addText('invoice')} style={{ ...s.btn, background: '#fff3e0' }}>
                    <span style={{ fontSize: 9, fontWeight: 900 }}>INV</span><span>Invoice Title</span>
                  </button>
                  <button onClick={() => addText('invoiceNo')} style={s.btn}>
                    <span style={{ fontSize: 9 }}>#</span><span>Invoice Number</span>
                  </button>
                  <button onClick={() => addText('invoiceDate')} style={s.btn}>
                    <span style={{ fontSize: 9 }}>D</span><span>Date</span>
                  </button>
                </div>
              </div>

              {/* Bill Footer Elements */}
              <div style={s.section}>
                <div style={s.sectionTitle}>Footer / Bill Elements</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button onClick={() => addText('bankDetails')} style={{ ...s.btn, background: '#e3f2fd' }}>
                    <span style={{ fontSize: 9, fontWeight: 900 }}>BK</span><span>Bank Details</span>
                  </button>
                  <button onClick={() => addText('terms')} style={{ ...s.btn, background: '#fff3e0' }}>
                    <span style={{ fontSize: 9, fontWeight: 900 }}>T&C</span><span>Terms & Conditions</span>
                  </button>
                  <button onClick={() => addText('signatureLine')} style={s.btn}>
                    <span style={{ fontSize: 9 }}>__</span><span>Signature Line</span>
                  </button>
                  <button onClick={() => addText('computerGenerated')} style={s.btn}>
                    <span style={{ fontSize: 9, color: '#888' }}>CG</span><span>Computer Generated</span>
                  </button>
                  <button onClick={() => addText('thankYou')} style={{ ...s.btn, borderColor: '#2e7d32' }}>
                    <span style={{ fontSize: 9, color: '#2e7d32' }}>TY</span><span>Thank You</span>
                  </button>
                </div>
              </div>

              {/* Shapes & Lines */}
              <div style={s.section}>
                <div style={s.sectionTitle}>Shapes & Lines</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button onClick={() => addShape('line')} style={s.btn}>
                    <span style={{ fontSize: 12 }}>—</span><span>Line</span>
                  </button>
                  <button onClick={() => addShape('line-thick')} style={s.btn}>
                    <span style={{ fontSize: 12, color: '#2e7d32' }}>━</span><span>Thick Line</span>
                  </button>
                  <button onClick={() => addShape('line-dotted')} style={s.btn}>
                    <span style={{ fontSize: 12, color: '#888' }}>┈</span><span>Dotted</span>
                  </button>
                  <button onClick={() => addShape('rect')} style={s.btn}>
                    <span style={{ fontSize: 12, color: '#2e7d32' }}>▮</span><span>Rectangle</span>
                  </button>
                  <button onClick={() => addShape('rect-outline')} style={s.btn}>
                    <span style={{ fontSize: 12 }}>▯</span><span>Outline Rect</span>
                  </button>
                  <button onClick={() => addShape('circle')} style={s.btn}>
                    <span style={{ fontSize: 12 }}>●</span><span>Circle</span>
                  </button>
                  <button onClick={() => addShape('divider')} style={s.btn}>
                    <span style={{ fontSize: 12, color: '#2e7d32' }}>▬</span><span>Bottom Bar</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* TEMPLATES TAB */
            <div style={s.section}>
              <div style={{ display: 'flex', gap: 3, marginBottom: 10, flexWrap: 'wrap' }}>
                {['all', 'letterhead', 'bill_header', 'bill_footer', 'letterhead_footer'].map(f => (
                  <button key={f} onClick={() => setFilterType(f)}
                    style={{ ...s.btnSm, flex: f === 'all' ? 'none' : 1, background: filterType === f ? '#e8f5e9' : '#fff', borderColor: filterType === f ? '#2e7d32' : '#ddd', fontSize: 9 }}>
                    {f === 'all' ? 'All' : f === 'letterhead' ? 'LH' : f === 'bill_header' ? 'BH' : f === 'bill_footer' ? 'BF' : 'LF'}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filteredTemplates.length === 0 && (
                  <p style={{ fontSize: 12, color: '#888', textAlign: 'center', padding: 16 }}>No templates yet</p>
                )}
                {filteredTemplates.map(t => (
                  <div key={t.id}
                    style={{
                      ...s.templateCard,
                      borderColor: activeTemplate?.id === t.id ? '#2e7d32' : '#eee',
                      background: activeTemplate?.id === t.id ? '#e8f5e9' : '#fff',
                    }}
                    onClick={() => loadTemplate(t)}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.name}
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <span style={{
                          ...s.badge,
                          background: t.type?.includes('letterhead') ? '#e8f5e9' : '#fff3e0',
                          color: t.type?.includes('letterhead') ? '#2e7d32' : '#e65100',
                        }}>
                          {(t.type || '').replace('_', ' ')}
                        </span>
                        {t.isDefault && <span style={{ ...s.badge, background: '#c0e040', color: '#1a1a1a' }}>Default</span>}
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id); }}
                      style={{ background: 'none', border: 'none', color: '#c62828', cursor: 'pointer', fontSize: 18, fontWeight: 900, padding: '4px 8px' }}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
        </div>

        {/* ===== CENTER — CANVAS ===== */}
        <div style={s.centerPanel} ref={wrapperRef}>
          <div style={{ marginBottom: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 9, color: '#999', fontWeight: 700, letterSpacing: 0.5 }}>
              {CANVAS_W}×{canvasHeight}px · {templateType.replace('_', ' ')}
              {activeTemplate && <> · <strong>{activeTemplate.name}</strong></>}
            </span>
          </div>
          <div style={{ ...s.canvasWrap, transformOrigin: 'top left', transform: `scale(${zoom})`, width: CANVAS_W, height: canvasHeight }}>
            <canvas ref={canvasRef} />
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, fontSize: 9, color: '#bbb', fontWeight: 600, flexWrap: 'wrap', justifyContent: 'center', flexShrink: 0 }}>
            <span>Del</span><span>Ctrl+Z/Y</span><span>Ctrl+D</span><span>Arrows</span>
          </div>
        </div>

        {/* ===== RIGHT — PROPERTIES ===== */}
        <div style={s.rightPanel}>
          {!selectedObj ? (
            <div style={{ ...s.section, textAlign: 'center', padding: '40px 16px' }}>
              <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>⬚</div>
              <p style={{ fontSize: 12, color: '#888', fontWeight: 600 }}>Select an element on the canvas to edit its properties</p>
            </div>
          ) : (
            <>
              {/* Object Type Badge */}
              <div style={{ ...s.section, paddingBottom: 12 }}>
                <span style={{
                  ...s.badge, fontSize: 10, padding: '3px 10px',
                  background: '#e8f5e9', color: '#2e7d32', border: '2px solid #2e7d32',
                }}>
                  {selectedObj.type === 'i-text' ? 'Text' : selectedObj.type === 'image' ? 'Image' : selectedObj.type}
                </span>
              </div>

              {/* Position & Size */}
              <div style={s.section}>
                <div style={s.sectionTitle}>Position & Size</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <span style={s.label}>X</span>
                    <input type="number" value={selectedObj.left}
                      onChange={e => updateProperty('left', e.target.value)} style={s.input} />
                  </div>
                  <div>
                    <span style={s.label}>Y</span>
                    <input type="number" value={selectedObj.top}
                      onChange={e => updateProperty('top', e.target.value)} style={s.input} />
                  </div>
                  <div>
                    <span style={s.label}>Width</span>
                    <input type="number" value={selectedObj.width}
                      onChange={e => updateProperty('width', e.target.value)} style={s.input} />
                  </div>
                  <div>
                    <span style={s.label}>Height</span>
                    <input type="number" value={selectedObj.height}
                      onChange={e => updateProperty('height', e.target.value)} style={s.input} />
                  </div>
                  <div>
                    <span style={s.label}>Rotation</span>
                    <input type="number" value={selectedObj.angle}
                      onChange={e => updateProperty('angle', e.target.value)} style={s.input} />
                  </div>
                  <div>
                    <span style={s.label}>Opacity</span>
                    <input type="number" value={selectedObj.opacity} min={0} max={1} step={0.1}
                      onChange={e => updateProperty('opacity', e.target.value)} style={s.input} />
                  </div>
                </div>
              </div>

              {/* Alignment */}
              <div style={s.section}>
                <div style={s.sectionTitle}>Align on Canvas</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
                  {[
                    { key: 'left', icon: '⫷', title: 'Align Left' },
                    { key: 'center-h', icon: '⫿', title: 'Center Horizontal' },
                    { key: 'right', icon: '⫸', title: 'Align Right' },
                    { key: 'top', icon: '⫠', title: 'Align Top' },
                    { key: 'center-v', icon: '⫟', title: 'Center Vertical' },
                    { key: 'bottom', icon: '⫡', title: 'Align Bottom' },
                  ].map(a => (
                    <button key={a.key} onClick={() => alignObject(a.key)}
                      style={s.iconBtn} title={a.title}>
                      {a.icon}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Properties */}
              {selectedObj.type === 'i-text' && (
                <div style={s.section}>
                  <div style={s.sectionTitle}>Text</div>
                  <div style={s.propRow}>
                    <span style={s.label}>Content</span>
                    <input value={selectedObj.text} onChange={e => updateProperty('text', e.target.value)} style={s.input} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div style={s.propRow}>
                      <span style={s.label}>Font Size</span>
                      <input type="number" value={selectedObj.fontSize}
                        onChange={e => updateProperty('fontSize', e.target.value)} style={s.input} />
                    </div>
                    <div style={s.propRow}>
                      <span style={s.label}>Weight</span>
                      <select value={selectedObj.fontWeight}
                        onChange={e => updateProperty('fontWeight', e.target.value)} style={s.input}>
                        <option value="normal">Normal</option>
                        <option value="bold">Bold</option>
                        <option value="900">Extra Bold</option>
                      </select>
                    </div>
                  </div>
                  <div style={s.propRow}>
                    <span style={s.label}>Font Family</span>
                    <select value={selectedObj.fontFamily}
                      onChange={e => updateProperty('fontFamily', e.target.value)} style={s.input}>
                      <option value="Playfair Display">Playfair Display</option>
                      <option value="Inter">Inter</option>
                      <option value="JetBrains Mono">JetBrains Mono</option>
                      <option value="Arial">Arial</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Helvetica">Helvetica</option>
                      <option value="Verdana">Verdana</option>
                      <option value="Courier New">Courier New</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => updateProperty('fontStyle', selectedObj.fontStyle === 'italic' ? 'normal' : 'italic')}
                      style={{ ...s.iconBtn, background: selectedObj.fontStyle === 'italic' ? '#e8f5e9' : '#fff', fontStyle: 'italic' }}>
                      I
                    </button>
                    <button onClick={() => updateProperty('underline', !selectedObj.underline)}
                      style={{ ...s.iconBtn, background: selectedObj.underline ? '#e8f5e9' : '#fff', textDecoration: 'underline' }}>
                      U
                    </button>
                    {['left', 'center', 'right'].map(a => (
                      <button key={a} onClick={() => updateProperty('textAlign', a)}
                        style={{ ...s.iconBtn, background: selectedObj.textAlign === a ? '#c0e040' : '#fff', fontSize: 11 }}>
                        {a === 'left' ? '⫷' : a === 'center' ? '⫿' : '⫸'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Appearance */}
              <div style={s.section}>
                <div style={s.sectionTitle}>Appearance</div>
                <div style={s.propRow}>
                  <span style={s.label}>Fill Color</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="color" value={selectedObj.fill || '#000000'}
                      onChange={e => updateProperty('fill', e.target.value)}
                      style={{ width: 32, height: 28, border: '2px solid #ddd', borderRadius: 4, cursor: 'pointer', padding: 0 }} />
                    <input value={selectedObj.fill || ''} onChange={e => updateProperty('fill', e.target.value)}
                      style={{ ...s.input, flex: 1 }} placeholder="#000000" />
                  </div>
                </div>
                <div style={s.propRow}>
                  <span style={s.label}>Stroke</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="color" value={selectedObj.stroke || '#000000'}
                      onChange={e => updateProperty('stroke', e.target.value)}
                      style={{ width: 32, height: 28, border: '2px solid #ddd', borderRadius: 4, cursor: 'pointer', padding: 0 }} />
                    <input type="number" value={selectedObj.strokeWidth} min={0} max={20}
                      onChange={e => updateProperty('strokeWidth', e.target.value)}
                      style={{ ...s.input, width: 50 }} placeholder="0" />
                  </div>
                </div>
                {(selectedObj.type === 'rect') && (
                  <div style={s.propRow}>
                    <span style={s.label}>Corner Radius</span>
                    <input type="number" value={selectedObj.rx || 0} min={0} max={100}
                      onChange={e => updateProperty('rx', e.target.value)} style={s.input} />
                  </div>
                )}
              </div>

              {/* Brand Colors */}
              <div style={s.section}>
                <div style={s.sectionTitle}>Quick Colors</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {['#1a1a1a', '#2e7d32', '#1b5e20', '#4caf50', '#c0e040', '#ffffff', '#f5f5f5', '#888888',
                    '#1565c0', '#e65100', '#c62828', '#6a1b9a', '#00838f', '#f9a825'].map(c => (
                    <button key={c} onClick={() => updateProperty('fill', c)}
                      style={{
                        width: 24, height: 24, background: c, border: '2px solid',
                        borderColor: c === '#ffffff' || c === '#f5f5f5' ? '#ddd' : c,
                        borderRadius: 4, cursor: 'pointer',
                      }} />
                  ))}
                </div>
              </div>

              {/* Layer & Actions */}
              <div style={s.section}>
                <div style={s.sectionTitle}>Actions</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                  <button onClick={duplicateSelected} style={s.btnSm}>Duplicate</button>
                  <button onClick={deleteSelected} style={s.btnDanger}>Delete</button>
                  <button onClick={bringForward} style={s.btnSm}>↑ Forward</button>
                  <button onClick={sendBackward} style={s.btnSm}>↓ Backward</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
