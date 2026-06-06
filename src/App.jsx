import React, { useState, useEffect, useRef } from 'react';
import { Api } from "./api";

// ─── Build Tree from nested structure ────────────────────────────────────────
function buildTree(cats) {
  function processNode(cat) {
    const node = {
      ...cat,
      _children: (cat.nested || []).map(processNode),
    };
    node._totalCards  = node.cards_count  + node._children.reduce((s, c) => s + c._totalCards,  0);
    node._totalRepeat = node.repeat_cards_count + node._children.reduce((s, c) => s + c._totalRepeat, 0);
    return node;
  }

  const roots = cats.map(processNode);
  return {
    id: '__root__',
    name: 'Все',
    short_name: 'Все',
    cards_count: 0,
    repeat_cards_count: 0,
    _children: roots,
    _isRoot: true,
    _totalCards:  roots.reduce((s, r) => s + r._totalCards,  0),
    _totalRepeat: roots.reduce((s, r) => s + r._totalRepeat, 0),
  };
}

// ─── Layout ──────────────────────────────────────────────────────────────────
function layoutTree(root) {
  function leafCount(node) {
    if (!node._children.length) return 1;
    return node._children.reduce((s, c) => s + leafCount(c), 0);
  }
  function setLeaves(node) {
    node._leaves = leafCount(node);
    node._children.forEach(setLeaves);
  }
  setLeaves(root);

  let maxTotal = 1;
  function findMax(node) {
    maxTotal = Math.max(maxTotal, node._totalCards);
    node._children.forEach(findMax);
  }
  findMax(root);

  function nodeRadius(node) {
    if (node._isRoot) return 48;
    return 22 + (node._totalCards / maxTotal) * 18;
  }

  const levelRings = [0, 160, 310, 450, 580];
  const getLevelRing = (d) => levelRings[Math.min(d, levelRings.length - 1)];

  function assignAngles(node, depth, startAngle, endAngle) {
    node._depth = depth;
    node._angle = (startAngle + endAngle) / 2;
    node._ringR = getLevelRing(depth);
    if (!node._children.length) return;

    const totalLeaves = node._children.reduce((s, c) => s + c._leaves, 0);
    const span = endAngle - startAngle;
    let cursor = startAngle;

    node._children.forEach(child => {
      let childSpan = (child._leaves / totalLeaves) * span;
      const childR   = nodeRadius(child);
      const minArc   = (2 * childR + 18) / Math.max(getLevelRing(depth + 1), 1);
      childSpan = Math.max(childSpan, minArc);
      assignAngles(child, depth + 1, cursor, cursor + childSpan);
      cursor += childSpan;
    });
  }

  assignAngles(root, 0, 0, 2 * Math.PI);

  function polarToXY(node) {
    if (node._depth === 0) {
      node._x = 0; node._y = 0;
    } else {
      const dr = node._ringR - node._parent._ringR;
      node._x = node._parent._x + dr * Math.cos(node._angle);
      node._y = node._parent._y + dr * Math.sin(node._angle);
    }
    node._r = nodeRadius(node);
    node._children.forEach(c => { c._parent = node; polarToXY(c); });
  }
  root._parent = root;
  polarToXY(root);

  return { root, maxTotal };
}

// ─── SVG helper ──────────────────────────────────────────────────────────────
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

const COLORS = {
  root: { fill: '#534AB7', stroke: '#3C3489', text: '#fff',    count: 'rgba(255,255,255,0.88)', repeat: '#a5f3d8' },
  node: { fill: '#e8f2fc', stroke: '#2a7dc0', text: '#0c4278', count: '#1b62a4',                repeat: '#0a7a5a' },
};

// ─── Canvas ──────────────────────────────────────────────────────────────────
const Canvas = React.forwardRef(({ treeData }, ref) => {
  const containerRef = useRef(null);
  const svgRef       = useRef(null);
  const viewState    = useRef({ x: 0, y: 0, k: 1 });
  const initView     = useRef({ x: 0, y: 0, k: 1 });
  const [tooltip, setTooltip] = useState(null);

  const applyTransform = () => {
    const g = svgRef.current?.querySelector('g.root-g');
    if (g) {
      const { x, y, k } = viewState.current;
      g.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
    }
  };

  React.useImperativeHandle(ref, () => ({
    resetView: () => {
      viewState.current = { ...initView.current };
      applyTransform();
    },
  }));

  // ── Draw ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !svgRef.current || !treeData) return;
    const W = containerRef.current.clientWidth;
    const H = containerRef.current.clientHeight;
    const { root } = treeData;

    const allNodes = [];
    const collect = (n) => { allNodes.push(n); n._children.forEach(collect); };
    collect(root);

    // Bounding box
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    allNodes.forEach(n => {
      x0 = Math.min(x0, n._x - n._r - 4);
      x1 = Math.max(x1, n._x + n._r + 4);
      y0 = Math.min(y0, n._y - n._r - 4);
      y1 = Math.max(y1, n._y + n._r + 4);
    });

    const pad  = 50;
    const kFit = Math.min(W / (x1 - x0 + pad * 2), H / (y1 - y0 + pad * 2), 1.4);
    const ix   = W / 2 - kFit * ((x0 + x1) / 2);
    const iy   = H / 2 - kFit * ((y0 + y1) / 2);
    viewState.current = { x: ix, y: iy, k: kFit };
    initView.current  = { ...viewState.current };

    svgRef.current.innerHTML = '';

    // Defs
    const defs = svgEl('defs');
    defs.innerHTML = `
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="3" flood-color="rgba(0,0,0,0.10)"/>
      </filter>
      <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
        <path d="M2 2L8 5L2 8" fill="none" stroke="#9db8d6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </marker>`;
    svgRef.current.appendChild(defs);

    const g = svgEl('g', { class: 'root-g', transform: `translate(${ix},${iy}) scale(${kFit})` });
    svgRef.current.appendChild(g);

    // Links
    const linkG = svgEl('g', { fill: 'none' });
    g.appendChild(linkG);

    allNodes.forEach(node => {
      if (node._isRoot) return;
      const par  = node._parent;
      const dx   = node._x - par._x, dy = node._y - par._y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) return;
      const ux = dx / dist, uy = dy / dist;
      const x1 = par._x + ux * (par._r + 1),  y1 = par._y + uy * (par._r + 1);
      const x2 = node._x - ux * (node._r + 5), y2 = node._y - uy * (node._r + 5);
      const cx1 = x1 + ux * dist * 0.35, cy1 = y1 + uy * dist * 0.35;
      const cx2 = x2 - ux * dist * 0.35, cy2 = y2 - uy * dist * 0.35;
      const path = svgEl('path', {
        d: `M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`,
        stroke: '#c0d4e8', 'stroke-width': '1', 'marker-end': 'url(#arr)',
      });
      linkG.appendChild(path);
    });

    // Nodes
    const nodeG = svgEl('g');
    g.appendChild(nodeG);

    allNodes.forEach(node => {
      const col = node._isRoot ? COLORS.root : COLORS.node;
      const r   = node._r;

      const ng = svgEl('g', { class: 'node-group', transform: `translate(${node._x},${node._y})` });
      ng.style.cursor = 'pointer';

      if (node._isRoot) {
        const halo = svgEl('circle', { r: r + 8, fill: '#534AB7', opacity: '0.15' });
        ng.appendChild(halo);
      }

      const circle = svgEl('circle', {
        r, fill: col.fill, stroke: col.stroke,
        'stroke-width': node._isRoot ? '2' : '1.2',
        ...(node._isRoot ? { filter: 'url(#shadow)' } : {}),
      });
      ng.appendChild(circle);

      // ── Text layout: repeat (top) · name · count (bottom) ──────────────────
      // Row height = fontSize only (no multiplier) so virtual boxes match real
      // glyph height. dominant-baseline:middle centres each glyph at its y.

      const countFontSize  = node._isRoot ? 22 : Math.max(10, Math.min(15, r * 0.38));
      const nameFontSize   = Math.max(8,  Math.min(11.5, r * 0.26));
      const repeatFontSize = node._isRoot ? 14 : Math.max(8, Math.min(10, r * 0.22));
      const GAP = 3;

      const rowDefs = [];
      // Always reserve space for repeat row (empty if zero) to keep text centring consistent
      // rowDefs.push({ text: node._totalRepeat > 0 ? String(node._totalRepeat) : '', fs: repeatFontSize, fw: '500', fill: col.repeat });
      if (node._totalRepeat > 0) {
        rowDefs.push({ text: String(node._totalRepeat), fs: repeatFontSize, fw: '500', fill: col.repeat });
      }
      if (!node._isRoot) {
        const label = node.short_name || node.name || '';
        label.split(' ').forEach(line => {
          rowDefs.push({ text: line, fs: nameFontSize, fw: '500', fill: col.text });
        });
      }
      // if (node._totalCards > 0) {
        rowDefs.push({ text: String(node._totalCards), fs: countFontSize, fw: '700', fill: col.count });
      // }

      // Total height = sum of font sizes + gaps
      const totalH = rowDefs.reduce((s, row) => s + row.fs, 0) + GAP * (rowDefs.length - 1);
      let y = -totalH / 2;

      rowDefs.forEach((row, idx) => {
        const text = svgEl('text', {
          x: 0,
          y: 0,
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
          'pointer-events': 'none',
        });

        const totalH =
          rowDefs.reduce((s, r) => s + r.fs, 0) +
          GAP * (rowDefs.length - 1);

        let offset = -totalH / 2;

        rowDefs.forEach((row, i) => {
          const tspan = svgEl('tspan', {
            x: 0,
            dy: i === 0
              ? offset + row.fs / 2
              : GAP + row.fs,
            'font-size': row.fs,
            'font-weight': row.fw,
            fill: row.fill,
          });

          tspan.textContent = row.text;
          text.appendChild(tspan);
        });

        ng.appendChild(text);
        y += row.fs + GAP;
      });

      // Hover
      ng.addEventListener('mouseenter', () => {
        setTooltip(node);
        circle.setAttribute('stroke-width', node._isRoot ? '3' : '2');
      });
      ng.addEventListener('mouseleave', () => {
        setTooltip(null);
        circle.setAttribute('stroke-width', node._isRoot ? '2' : '1.2');
      });

      nodeG.appendChild(ng);
    });
  }, [treeData]);

  // ── Pan & Zoom ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let dragging = false, dragPt = { x: 0, y: 0 };

    const onWheel = (e) => {
      e.preventDefault();
      const f    = e.deltaY < 0 ? 1.1 : 0.91;
      const rect = container.getBoundingClientRect();
      const mx   = e.clientX - rect.left, my = e.clientY - rect.top;
      viewState.current.x = mx - (mx - viewState.current.x) * f;
      viewState.current.y = my - (my - viewState.current.y) * f;
      viewState.current.k *= f;
      applyTransform();
    };
    const onDown = (e) => {
      if (e.button !== 0) return;
      dragging = true; dragPt = { x: e.clientX, y: e.clientY };
      container.style.cursor = 'grabbing';
    };
    const onMove = (e) => {
      if (!dragging) return;
      viewState.current.x += e.clientX - dragPt.x;
      viewState.current.y += e.clientY - dragPt.y;
      dragPt = { x: e.clientX, y: e.clientY };
      applyTransform();
    };
    const onUp = () => { dragging = false; container.style.cursor = 'grab'; };

    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor: 'grab', background: '#f5f4f0' }}>
      <svg ref={svgRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {tooltip && <Tooltip node={tooltip} container={containerRef.current} />}
    </div>
  );
});

// ─── Tooltip ─────────────────────────────────────────────────────────────────
function Tooltip({ node, container }) {
  const [pos, setPos] = useState({ x: -999, y: -999 });

  useEffect(() => {
    const onMove = (e) => {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const W = container.clientWidth, H = container.clientHeight;
      const TW = 200, TH = 100, PAD = 14;
      let tx = mx + PAD, ty = my - 10;
      if (tx + TW > W) tx = mx - TW - PAD;
      if (ty + TH > H) ty = my - TH;
      setPos({ x: tx, y: ty });
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [container]);

  return (
    <div style={{
      position: 'absolute', left: pos.x, top: pos.y,
      pointerEvents: 'none', background: '#fff',
      border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: '8px',
      padding: '9px 13px', fontSize: '12px',
      boxShadow: '0 6px 20px rgba(0,0,0,0.09)', maxWidth: '200px', zIndex: 1000,
    }}>
      <div style={{ fontWeight: 500, fontSize: '13px', marginBottom: '4px', color: '#111' }}>{node.name}</div>
      <div style={{ color: '#555', lineHeight: 1.6 }}>Всего карточек: <b>{node._totalCards}</b></div>
      {node._totalRepeat > 0 && (
        <div style={{ color: '#0a7a5a', fontWeight: 500, lineHeight: 1.6 }}>К повторению: {node._totalRepeat}</div>
      )}
      {node._children.length > 0 && (
        <div style={{ color: '#888', lineHeight: 1.6, fontSize: '11px' }}>Подкатегорий: {node._children.length}</div>
      )}
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef(null);

  useEffect(() => {
    (async () => {
      const api  = new Api();
      const cats = await api.getCategories();
      const root = buildTree(cats);
      const treeData = layoutTree(root);
      const allNodes = [];
      const collect  = (n) => { allNodes.push(n); n._children.forEach(collect); };
      collect(root);
      setData({ treeData, root, nodeCount: allNodes.length });
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontSize: '16px', color: '#666' }}>
        Загрузка графа…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', userSelect: 'none' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '8px 14px', background: '#fff',
        borderBottom: '0.5px solid rgba(0,0,0,0.12)', flexShrink: 0,
      }}>
        <span style={{ flex: 1, fontSize: '11px', color: '#666' }}>
          {data?.nodeCount} категорий · {data?.root._totalCards} карточек · {data?.root._totalRepeat} готовых к повторению
        </span>
        <button
          onClick={() => canvasRef.current?.resetView()}
          style={{
            fontSize: '11px', padding: '4px 10px', borderRadius: '6px',
            border: '0.5px solid rgba(0,0,0,0.2)', background: '#f5f5f5',
            color: '#444', cursor: 'pointer',
          }}
        >
          Сбросить вид
        </button>
      </div>

      {/* Graph */}
      <Canvas ref={canvasRef} treeData={data?.treeData} />
    </div>
  );
}