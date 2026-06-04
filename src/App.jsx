import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import { Api } from "./api";

/* ════════════════════════════════════════════════
   COLORS
════════════════════════════════════════════════ */

const COLORS = {
  service: { fill: '#f0ecff', stroke: '#7c5cdb', text: '#5a4a9e' },
  branch:  { fill: '#e0f5f0', stroke: '#0d8c6e', text: '#0a5d4a' },
  leaf:    { fill: '#e8f3ff', stroke: '#1b72dc', text: '#0d4ba0' },
};

function getColor(node) {
  if (node.isService) return COLORS.service;
  if (node.hasNested) return COLORS.branch;
  return COLORS.leaf;
}

function getRadius(nodeData, maxTotal) {
  return 28 + (nodeData.total / maxTotal) * 20;
}

/* ════════════════════════════════════════════════
   TREE DATA BUILDER
════════════════════════════════════════════════ */

function buildTreeData(categories, cards) {
  const catMap = {};
  categories.forEach(c => { catMap[c.id] = c; });

  const cardsByCat = {};
  cards.forEach(card => {
    const cid = card.category?.id;
    if (cid) cardsByCat[cid] = (cardsByCat[cid] || 0) + 1;
  });

  function countCards(id) {
    const cat = catMap[id];
    if (!cat) return 0;
    let total = cardsByCat[id] || 0;
    (cat.nested || []).forEach(n => { total += countCards(n.id); });
    return total;
  }

  function buildNode(id) {
    const cat       = catMap[id];
    const direct    = cardsByCat[id] || 0;
    const total     = countCards(id);
    const hasNested = !!(cat && cat.nested && cat.nested.length > 0);

    const node = { id, name: cat.short || cat.name, isService: false, direct, total, hasNested, children: [] };

    if (hasNested && direct > 0) {
      node.children.push({
        id: `misc_${id}`, name: 'Прочее', isService: true,
        direct, total: direct, hasNested: false, children: [],
      });
    }
    (cat.nested || []).forEach(n => node.children.push(buildNode(n.id)));
    return node;
  }

  const roots = categories.filter(c => !c.parent);
  return {
    id: 'v_all', name: 'Все', isService: true, isRoot: true,
    direct: cards.length, total: cards.length, hasNested: true,
    children: roots.map(r => buildNode(r.id)),
  };
}

function countNodes(node) {
  return 1 + (node.children || []).reduce((s, c) => s + countNodes(c), 0);
}

/* ════════════════════════════════════════════════
   TEXT WRAP
════════════════════════════════════════════════ */

function wrapText(text = '', maxWidth, fontSize) {
  const charW    = fontSize * 0.58;
  const maxChars = Math.max(1, Math.floor(maxWidth / charW));
  if (text.length <= maxChars) return [text];

  const words = text.split(/\s+/);
  const lines  = [];
  let current  = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word.length > maxChars ? word.slice(0, maxChars) : word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text.slice(0, maxChars)];
}

/* ════════════════════════════════════════════════
   SVG HELPERS
════════════════════════════════════════════════ */

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

/* ════════════════════════════════════════════════
   CANVAS COMPONENT  (proper React component)
════════════════════════════════════════════════ */

const GraphCanvas = React.forwardRef(function GraphCanvas(
  { treeRoot, onReady },
  fwdRef
) {
  const containerRef = useRef(null);
  const svgRef       = useRef(null);
  const panZoom      = useRef({ x: 0, y: 0, k: 1 });
  const initPZ       = useRef({ x: 0, y: 0, k: 1 }); // saved initial fit
  const dragging     = useRef(false);
  const dragPt       = useRef({ x: 0, y: 0 });
  const [tooltip, setTooltip] = useState(null);

  // expose resetView to parent via ref
  React.useImperativeHandle(fwdRef, () => ({
    resetView() {
      panZoom.current = { ...initPZ.current };
      applyT();
    },
  }));

  const applyT = useCallback(() => {
    const g = svgRef.current?.querySelector('g.root-g');
    if (!g) return;
    const { x, y, k } = panZoom.current;
    g.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
  }, []);

  /* ── Draw ──────────────────────────────────────────────────── */
  useEffect(() => {
    const container = containerRef.current;
    const svg       = svgRef.current;
    if (!container || !svg || !treeRoot) return;

    const W = container.clientWidth;
    const H = container.clientHeight;

    const hierarchy = d3.hierarchy(treeRoot);
    const maxTotal  = d3.max(hierarchy.descendants(), d => d.data.total) || 1;

    /* ── Radial tree layout ──────────────────────────────────── */
    // Step between depth levels: 2 * maxRadius + gap
    const maxR     = getRadius({ total: maxTotal }, maxTotal);
    const depthStep = maxR * 2 + 55; // ring spacing — compact but non-overlapping

    // d3.tree in radial mode: x = angle [0, 2π], y = radius from root
    d3.tree()
      .size([2 * Math.PI, hierarchy.height * depthStep])
      // give siblings more room than cousins to avoid sector crowding
      .separation((a, b) => (a.parent === b.parent ? 1.2 : 2.0) / a.depth)(hierarchy);

    // Convert polar → Cartesian (root sits at centre = 0,0)
    hierarchy.each(d => {
      const r     = d.y;                // d3.tree already scales by depthStep
      const angle = d.x - Math.PI / 2; // start from top
      d.cx = r * Math.cos(angle);
      d.cy = r * Math.sin(angle);
    });

    /* ── Fit & centre ────────────────────────────────────────── */
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    hierarchy.each(d => {
      const r = getRadius(d.data, maxTotal);
      x0 = Math.min(x0, d.cx - r);
      x1 = Math.max(x1, d.cx + r);
      y0 = Math.min(y0, d.cy - r);
      y1 = Math.max(y1, d.cy + r);
    });

    const pad    = 60;
    const cW     = x1 - x0 + pad * 2;
    const cH     = y1 - y0 + pad * 2;
    const kFit   = Math.min(W / cW, H / cH, 1.6);
    const initX  = W / 2 - kFit * ((x0 + x1) / 2);
    const initY  = H / 2 - kFit * ((y0 + y1) / 2);

    panZoom.current  = { x: initX, y: initY, k: kFit };
    initPZ.current   = { x: initX, y: initY, k: kFit };

    /* ── Build SVG ───────────────────────────────────────────── */
    svg.setAttribute('width',  W);
    svg.setAttribute('height', H);
    svg.innerHTML = '';

    const defs = el('defs');
    defs.innerHTML = `
      <marker id="kg-arr" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M2 1L8 5L2 9" fill="none" stroke="#b0a8cc"
              stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </marker>`;
    svg.appendChild(defs);

    const rootG = el('g', { class: 'root-g',
      transform: `translate(${initX},${initY}) scale(${kFit})` });
    svg.appendChild(rootG);

    /* ── Links ───────────────────────────────────────────────── */
    const linkG = el('g', { fill: 'none' });
    rootG.appendChild(linkG);

    hierarchy.links().forEach(({ source: s, target: t }) => {
      const sr  = getRadius(s.data, maxTotal);
      const tr  = getRadius(t.data, maxTotal);
      const dx  = t.cx - s.cx, dy = t.cy - s.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist === 0) return;

      const ux = dx / dist, uy = dy / dist;
      const x1 = s.cx + ux * (sr + 1);
      const y1 = s.cy + uy * (sr + 1);
      const x2 = t.cx - ux * (tr + 4);
      const y2 = t.cy - uy * (tr + 4);

      // Smooth cubic bezier for radial edges
      const path = el('path', {
        d:             `M${x1},${y1} C${x1 + ux * 40},${y1 + uy * 40} ${x2 - ux * 40},${y2 - uy * 40} ${x2},${y2}`,
        stroke:        '#c5bfe0',
        'stroke-width': '1.2',
        'marker-end':  'url(#kg-arr)',
      });
      linkG.appendChild(path);
    });

    /* ── Nodes ───────────────────────────────────────────────── */
    const nodeG = el('g');
    rootG.appendChild(nodeG);

    hierarchy.descendants().forEach(d => {
      const r   = getRadius(d.data, maxTotal);
      const col = getColor(d.data);

      const g = el('g', { transform: `translate(${d.cx},${d.cy})` });
      g.style.cursor = 'pointer';

      // Subtle halo
      const halo = el('circle', { r: r + 3, fill: col.stroke, opacity: '0.08' });
      g.appendChild(halo);

      // Main circle
      const circle = el('circle', {
        r, fill: col.fill, stroke: col.stroke, 'stroke-width': '1.5',
      });
      g.appendChild(circle);

      // ── Label (name) ─────────────────────────────────────────
      // Reserve bottom portion for count number
      const countFontSize = Math.max(11, r * 0.42);
      const nameFontSize  = Math.max(9,  Math.min(12, r * 0.32));
      const countH        = d.data.total > 0 ? countFontSize * 1.3 : 0;
      const nameAreaH     = r * 2 - countH - 10; // vertical space for name
      const nameAreaW     = r * 1.3;             // chord width at 65% radius

      const lines  = wrapText(d.data.name, nameAreaW, nameFontSize);
      const lineH  = nameFontSize * 1.28;
      const totalH = lines.length * lineH + countH;
      // Centre the whole block (name + count) vertically
      const blockTop = -totalH / 2 + lineH * 0.5;

      lines.forEach((line, i) => {
        const txt = el('text', {
          x: '0', y: blockTop + i * lineH,
          'text-anchor': 'middle', 'dominant-baseline': 'central',
          'font-size': nameFontSize, 'font-weight': '500',
          fill: col.text, 'pointer-events': 'none',
        });
        txt.textContent = line;
        g.appendChild(txt);
      });

      // ── Count number (large, below name) ─────────────────────
      if (d.data.total > 0) {
        const countY = blockTop + lines.length * lineH;
        const countTxt = el('text', {
          x: '0', y: countY,
          'text-anchor': 'middle', 'dominant-baseline': 'central',
          'font-size': countFontSize, 'font-weight': '700',
          fill: col.stroke, 'pointer-events': 'none',
        });
        countTxt.textContent = d.data.total;
        g.appendChild(countTxt);
      }

      /* ── Tooltip ─────────────────────────────────────────────── */
      g.addEventListener('mouseenter', ev => {
        const rect = container.getBoundingClientRect();
        setTooltip({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, node: d.data });
        circle.setAttribute('stroke-width', '2.5');
      });
      g.addEventListener('mouseleave', () => {
        setTooltip(null);
        circle.setAttribute('stroke-width', '1.5');
      });

      nodeG.appendChild(g);
    });

    onReady?.();
  }, [treeRoot, applyT, onReady]);

  /* ── Pan & Zoom (attached once, container always present) ───── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const rect   = container.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const my     = e.clientY - rect.top;
      const pz     = panZoom.current;
      pz.x  = mx - (mx - pz.x) * factor;
      pz.y  = my - (my - pz.y) * factor;
      pz.k *= factor;
      applyT();
    };

    const onDown = e => {
      if (e.button !== 0) return;
      dragging.current = true;
      dragPt.current   = { x: e.clientX, y: e.clientY };
      container.style.cursor = 'grabbing';
    };

    const onMove = e => {
      if (!dragging.current) return;
      const pz = panZoom.current;
      pz.x += e.clientX - dragPt.current.x;
      pz.y += e.clientY - dragPt.current.y;
      dragPt.current = { x: e.clientX, y: e.clientY };
      applyT();
    };

    const onUp = () => {
      dragging.current = false;
      container.style.cursor = 'grab';
    };

    // wheel: passive:false so we can preventDefault (needed in Chrome)
    container.addEventListener('wheel',     onWheel, { passive: false });
    container.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove',    onMove);
    window.addEventListener('mouseup',      onUp);

    return () => {
      container.removeEventListener('wheel',     onWheel);
      container.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove',    onMove);
      window.removeEventListener('mouseup',      onUp);
    };
  }, [applyT]); // applyT is stable (useCallback with [])

  return (
    <div ref={containerRef} style={styles.canvas}>
      <svg ref={svgRef} style={{ display: 'block' }} />
      {tooltip && <Tooltip tooltip={tooltip} container={containerRef.current} />}
    </div>
  );
});

/* ════════════════════════════════════════════════
   APP
════════════════════════════════════════════════ */

export default function App() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef(null);

  useEffect(() => {
    (async () => {
      const api = new Api();
      const [cats, cards] = await Promise.all([api.getCategories(), api.getCards()]);
      setData({ treeRoot: buildTreeData(cats, cards), catCount: cats.length, cardCount: cards.length });
      setLoading(false);
    })();
  }, []);

  if (loading) return <div style={styles.loader}>Загрузка графа…</div>;

  return (
    <div style={styles.app}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <span style={styles.stats}>
          {countNodes(data.treeRoot)} узлов · {data.cardCount} карточек · {data.catCount} категорий
        </span>
        <button style={styles.btn} onClick={() => canvasRef.current?.resetView()}>
          Сбросить вид
        </button>
      </div>

      {/* Graph */}
      <GraphCanvas ref={canvasRef} treeRoot={data.treeRoot} />

      {/* Legend */}
      <div style={styles.legend}>
        <LegendItem color={COLORS.service} label="Служебный узел" />
        <LegendItem color={COLORS.branch}  label="С подкатегориями" />
        <LegendItem color={COLORS.leaf}    label="Конечная категория" />
        <span style={{ marginLeft: 'auto', color: '#999', fontSize: 11 }}>
          Колёсико — масштаб · Перетаскивание — сдвиг
        </span>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════
   TOOLTIP
════════════════════════════════════════════════ */

function Tooltip({ tooltip, container }) {
  const PAD = 14, TW = 190;
  const cW  = container?.clientWidth  || 800;
  const cH  = container?.clientHeight || 500;
  let tx = tooltip.x + PAD;
  let ty = tooltip.y - 10;
  if (tx + TW > cW) tx = tooltip.x - TW - PAD;
  if (ty + 115 > cH) ty = tooltip.y - 115;

  const { node } = tooltip;
  return (
    <div style={{ ...styles.tooltip, left: tx, top: ty }}>
      <div style={styles.ttTitle}>{node.name}</div>
      <div style={styles.ttRow}>Карточек: <b>{node.total}</b></div>
      {!node.isService && <div style={styles.ttRow}>Напрямую: <b>{node.direct}</b></div>}
      {node.hasNested    && <div style={styles.ttRow}>Содержит подкатегории</div>}
    </div>
  );
}

function LegendItem({ color, label }) {
  return (
    <div style={styles.legendItem}>
      <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: color.fill, border: `1px solid ${color.stroke}` }} />
      <span>{label}</span>
    </div>
  );
}

/* ════════════════════════════════════════════════
   STYLES
════════════════════════════════════════════════ */

const styles = {
  app: {
    display: 'flex', flexDirection: 'column', height: '100vh',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    userSelect: 'none',
  },
  loader: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100vh', fontSize: 16, color: '#666',
  },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 14px', background: '#fff',
    borderBottom: '1px solid #ebebeb',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)', flexShrink: 0,
  },
  stats: { flex: 1, fontSize: 12, color: '#777' },
  btn: {
    padding: '5px 11px', fontSize: 12, background: '#f5f5f5',
    border: '1px solid #e0e0e0', borderRadius: 6,
    cursor: 'pointer', color: '#333',
  },
  canvas: {
    flex: 1, overflow: 'hidden', position: 'relative',
    background: '#f8f9fb', cursor: 'grab',
  },
  tooltip: {
    position: 'absolute', pointerEvents: 'none', background: '#fff',
    border: '1px solid #e5e5e5', borderRadius: 8, padding: '8px 12px',
    fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', maxWidth: 190, zIndex: 1000,
  },
  ttTitle: { fontWeight: 600, fontSize: 13, marginBottom: 4, color: '#111' },
  ttRow:   { color: '#555', lineHeight: 1.6 },
  legend: {
    display: 'flex', alignItems: 'center', gap: 18,
    padding: '8px 14px', background: '#fff',
    borderTop: '1px solid #ebebeb', fontSize: 11, color: '#666',
    flexShrink: 0, flexWrap: 'wrap',
  },
  legendItem: { display: 'flex', alignItems: 'center', gap: 5 },
};