import React, { useState, useRef } from 'react';
import { KGNode, KGEdge } from '../data/pharosPresets';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

export type GraphLayerMode = 'all_active' | 'obo_translation' | 'gnn_predicted' | 'audit_pruned';

interface KnowledgeGraphCanvasProps {
  nodes: KGNode[];
  edges: KGEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onUpdateNodePosition: (nodeId: string, x: number, y: number) => void;
  onResetLayout: () => void;
  showPrunedOverlay: boolean;
  onTogglePrunedOverlay: (val: boolean) => void;
  pruningThreshold: number;
  maxNodes: number;
}

export const KnowledgeGraphCanvas: React.FC<KnowledgeGraphCanvasProps> = ({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  onUpdateNodePosition,
  onResetLayout,
  showPrunedOverlay,
  onTogglePrunedOverlay,
  pruningThreshold,
  maxNodes,
}) => {
  const [layerMode, setLayerMode] = useState<GraphLayerMode>('all_active');
  const [zoom, setZoom] = useState<number>(1);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [cursorCoords, setCursorCoords] = useState<{ x: number; y: number }>({ x: 420, y: 240 });
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Filter nodes based on relevance/pruned visibility & maxNodes limit
  const visibleNodes = nodes
    .filter((n) => {
      if (layerMode === 'audit_pruned' || showPrunedOverlay) return true;
      return !n.isFilteredOut;
    })
    .slice(0, maxNodes);

  const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

  // Filter edges based on layer mode, pruning threshold, and visible endpoints
  const visibleEdges = edges.filter((e) => {
    if (!visibleNodeIds.has(e.source) || !visibleNodeIds.has(e.target)) return false;

    const isPruned =
      e.status === 'pruned_hallucination' ||
      e.status === 'pruned_context' ||
      (e.status !== 'predicted_heldout' && e.gnnReweightedConfidence < pruningThreshold);

    if (layerMode === 'obo_translation') {
      return e.predicateUri === 'http://purl.obolibrary.org/obo/so#translates_to';
    }
    if (layerMode === 'gnn_predicted') {
      return (
        e.status === 'predicted_heldout' ||
        e.predicateUri === 'http://purl.obolibrary.org/obo/so#translates_to'
      );
    }
    if (layerMode === 'audit_pruned' || showPrunedOverlay) {
      return true;
    }
    return !isPruned;
  });

  const getSvgCoordinates = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const viewBoxW = 940;
    const viewBoxH = 540;
    const rawX = ((e.clientX - rect.left) / rect.width) * viewBoxW;
    const rawY = ((e.clientY - rect.top) / rect.height) * viewBoxH;
    // Account for center zoom transform
    const cx = viewBoxW / 2;
    const cy = viewBoxH / 2;
    const x = Math.round(cx + (rawX - cx) / zoom);
    const y = Math.round(cy + (rawY - cy) / zoom);
    return { x, y };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const coords = getSvgCoordinates(e);
    setCursorCoords(coords);
    if (draggingNodeId) {
      const clampedX = Math.max(70, Math.min(870, coords.x));
      const clampedY = Math.max(50, Math.min(490, coords.y));
      onUpdateNodePosition(draggingNodeId, clampedX, clampedY);
    }
  };

  const handleMouseUp = () => {
    setDraggingNodeId(null);
  };

  const getNodeGlyphConfig = (ontologyClass: string, isFilteredOut?: boolean) => {
    if (isFilteredOut) {
      return {
        prefix: '✖ NOISE',
        stroke: '#E11D48',
        fill: '#FFF1F2',
        text: '#9F1239',
      };
    }
    switch (ontologyClass) {
      case 'http://purl.obolibrary.org/obo/SO_0001217':
        return {
          prefix: '[SO:1217 GENE]',
          stroke: '#0284C7',
          fill: '#F0F9FF',
          text: '#0C4A6E',
        };
      case 'http://purl.obolibrary.org/obo/PR_000000001':
        return {
          prefix: '⟨PR:0001 PROT⟩',
          stroke: '#0891B2',
          fill: '#ECFEFF',
          text: '#164E63',
        };
      case 'http://purl.obolibrary.org/obo/CHEBI_23888':
        return {
          prefix: '◆ CHEBI DRUG',
          stroke: '#D97706',
          fill: '#FFFBEB',
          text: '#78350F',
        };
      case 'http://purl.obolibrary.org/obo/MONDO_0000001':
        return {
          prefix: '◎ MONDO DIS',
          stroke: '#0F172A',
          fill: '#F1F5F9',
          text: '#0F172A',
        };
      default:
        return {
          prefix: '{GO PATHWAY}',
          stroke: '#059669',
          fill: '#ECFDF5',
          text: '#065F46',
        };
    }
  };

  return (
    <div className="flex flex-col bg-white border border-slate-200">
      {/* Top Canvas HUD Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-[#F1F5F9] border-b border-slate-200">
        {/* Segmented Layer Controls (functional interactive buttons) */}
        <div className="flex items-center gap-1 bg-slate-200/80 p-1 rounded-md">
          <button
            type="button"
            onClick={() => {
              setLayerMode('all_active');
              onTogglePrunedOverlay(false);
            }}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              layerMode === 'all_active' && !showPrunedOverlay
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Active Contextual KG
          </button>
          <button
            type="button"
            onClick={() => {
              setLayerMode('obo_translation');
              onTogglePrunedOverlay(false);
            }}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              layerMode === 'obo_translation'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            so#translates_to Spine
          </button>
          <button
            type="button"
            onClick={() => {
              setLayerMode('gnn_predicted');
              onTogglePrunedOverlay(false);
            }}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              layerMode === 'gnn_predicted'
                ? 'bg-white text-cyan-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ★ GNN Held-Out Links
          </button>
          <button
            type="button"
            onClick={() => {
              const next = layerMode !== 'audit_pruned';
              setLayerMode(next ? 'audit_pruned' : 'all_active');
              onTogglePrunedOverlay(next);
            }}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              layerMode === 'audit_pruned' || showPrunedOverlay
                ? 'bg-white text-rose-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ✖ Inspect Pruned Artifacts
          </button>
        </div>

        {/* Right HUD Readout & Zoom Controls */}
        <div className="flex items-center gap-3 text-xs font-mono tabular-nums text-slate-600">
          <span className="hidden sm:inline">
            POS: ({cursorCoords.x.toString().padStart(3, '0')},{' '}
            {cursorCoords.y.toString().padStart(3, '0')})
          </span>
          <span className="hidden sm:inline text-slate-300">|</span>
          <span>
            NODES: {visibleNodes.length} · EDGES: {visibleEdges.length}
          </span>
          <div className="flex items-center border border-slate-300 bg-white rounded">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.75, +(z - 0.12).toFixed(2)))}
              title="Zoom Out"
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-50 border-r border-slate-200"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.45, +(z + 0.12).toFixed(2)))}
              title="Zoom In"
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-50 border-r border-slate-200"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                onResetLayout();
              }}
              title="Reset Graph Calibration"
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Interactive SVG Graph Stage */}
      <div className="relative w-full overflow-hidden bg-[#FFFFFF]">
        <svg
          ref={svgRef}
          viewBox="0 0 940 540"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="w-full h-[460px] cursor-crosshair select-none"
        >
          <defs>
            {/* Calibration Grid Pattern */}
            <pattern id="kg-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="#F1F5F9"
                strokeWidth="1"
              />
            </pattern>
            {/* Arrowheads for directed ontology predicates */}
            <marker
              id="arrow-verified"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#475569" />
            </marker>
            <marker
              id="arrow-translate"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#0284C7" />
            </marker>
            <marker
              id="arrow-predicted"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#0891B2" />
            </marker>
            <marker
              id="arrow-pruned"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#E11D48" />
            </marker>
          </defs>

          {/* Background Coordinate Grid */}
          <rect width="940" height="540" fill="url(#kg-grid)" />

          {/* Column Zone Annotations (Gene Locus -> Protein Product -> Pathway/Drug -> Disease) */}
          <g className="font-mono text-[10px] fill-slate-400">
            <text x="145" y="24" textAnchor="middle">
              ZONE I: GENOMIC LOCI (SO_0001217)
            </text>
            <text x="385" y="24" textAnchor="middle">
              ZONE II: TRANSLATED PROTEOME (PR_000000001)
            </text>
            <text x="620" y="24" textAnchor="middle">
              ZONE III: LIGANDS & GO PATHWAYS
            </text>
            <text x="805" y="24" textAnchor="middle">
              ZONE IV: MONDO PHENOTYPES
            </text>
            <line x1="265" y1="12" x2="265" y2="528" stroke="#F1F5F9" strokeDasharray="4 4" />
            <line x1="505" y1="12" x2="505" y2="528" stroke="#F1F5F9" strokeDasharray="4 4" />
            <line x1="715" y1="12" x2="715" y2="528" stroke="#F1F5F9" strokeDasharray="4 4" />
          </g>

          <g
            transform={`translate(470, 270) scale(${zoom}) translate(-470, -270)`}
          >
            {/* Render Edges */}
            {visibleEdges.map((edge) => {
              const src = visibleNodes.find((n) => n.id === edge.source);
              const tgt = visibleNodes.find((n) => n.id === edge.target);
              if (!src || !tgt) return null;

              const isSelected = selectedEdgeId === edge.id;
              const isPredicted = edge.status === 'predicted_heldout';
              const isPruned =
                edge.status === 'pruned_hallucination' ||
                edge.status === 'pruned_context' ||
                (!isPredicted && edge.gnnReweightedConfidence < pruningThreshold);
              const isTranslate =
                edge.predicateUri === 'http://purl.obolibrary.org/obo/so#translates_to';

              const dx = tgt.x - src.x;
              const dy = tgt.y - src.y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              const padStart = 52;
              const padEnd = 56;
              const x1 = src.x + (dx / dist) * padStart;
              const y1 = src.y + (dy / dist) * (padStart * 0.55);
              const x2 = tgt.x - (dx / dist) * padEnd;
              const y2 = tgt.y - (dy / dist) * (padEnd * 0.55);

              const midX = (x1 + x2) / 2;
              const midY = (y1 + y2) / 2;

              let strokeColor = '#64748B';
              let dashArray = 'none';
              let marker = 'url(#arrow-verified)';
              let statusPrefix = '●';

              if (isPruned) {
                strokeColor = '#E11D48';
                dashArray = '3 4';
                marker = 'url(#arrow-pruned)';
                statusPrefix = '✖ PRUNED';
              } else if (isPredicted) {
                strokeColor = '#0891B2';
                dashArray = '6 4';
                marker = 'url(#arrow-predicted)';
                statusPrefix = '★ GNN LINK';
              } else if (isTranslate) {
                strokeColor = '#0284C7';
                dashArray = 'none';
                marker = 'url(#arrow-translate)';
                statusPrefix = '→ OBO';
              }

              return (
                <g
                  key={edge.id}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onSelectEdge(edge.id);
                  }}
                  className="cursor-pointer group"
                >
                  {/* Selection Halo */}
                  {isSelected && (
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="#06B6D4"
                      strokeWidth="7"
                      strokeOpacity="0.22"
                    />
                  )}

                  {/* Edge Line */}
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={strokeColor}
                    strokeWidth={isSelected ? 2.6 : isPredicted ? 2.2 : 1.6}
                    strokeDasharray={dashArray}
                    markerEnd={marker}
                  />

                  {/* Transparent wide click target */}
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="transparent"
                    strokeWidth="14"
                  />

                  {/* Edge Predicate & GNN Score Label */}
                  <g transform={`translate(${midX}, ${midY})`}>
                    <rect
                      x="-64"
                      y="-10"
                      width="128"
                      height="19"
                      rx="2"
                      fill={isSelected ? '#0F172A' : '#FFFFFF'}
                      stroke={isSelected ? '#06B6D4' : strokeColor}
                      strokeWidth={isSelected ? '1.5' : '0.8'}
                    />
                    <text
                      x="0"
                      y="3"
                      textAnchor="middle"
                      className={`font-mono text-[9.5px] ${
                        isSelected
                          ? 'fill-white font-semibold'
                          : isPruned
                          ? 'fill-rose-700'
                          : isPredicted
                          ? 'fill-cyan-800 font-semibold'
                          : 'fill-slate-700'
                      }`}
                    >
                      {statusPrefix} {edge.predicateLabel.split(' ')[0]} ({edge.gnnReweightedConfidence.toFixed(2)})
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Render Nodes */}
            {visibleNodes.map((node) => {
              const isSelected = selectedNodeId === node.id;
              const style = getNodeGlyphConfig(node.ontologyClass, node.isFilteredOut);

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onMouseDown={(ev) => {
                    ev.stopPropagation();
                    setDraggingNodeId(node.id);
                    onSelectNode(node.id);
                  }}
                  className="cursor-grab active:cursor-grabbing"
                >
                  {/* Selection Focus Ring */}
                  {isSelected && (
                    <rect
                      x="-68"
                      y="-30"
                      width="136"
                      height="60"
                      rx="4"
                      fill="none"
                      stroke="#06B6D4"
                      strokeWidth="2"
                      strokeDasharray="3 2"
                    />
                  )}

                  {/* Node Surface Card */}
                  <rect
                    x="-62"
                    y="-25"
                    width="124"
                    height="50"
                    rx="3"
                    fill={style.fill}
                    stroke={isSelected ? '#0F172A' : style.stroke}
                    strokeWidth={isSelected ? '2' : '1.2'}
                  />

                  {/* Top Ontology Class & Pharos TDL Line (unboxed text metadata) */}
                  <text
                    x="0"
                    y="-10"
                    textAnchor="middle"
                    fill={style.text}
                    className="font-mono text-[8.5px] font-medium"
                  >
                    {style.prefix} {node.tdl !== 'N/A' ? `· ${node.tdl}` : ''}
                  </text>

                  {/* Primary Symbol */}
                  <text
                    x="0"
                    y="5"
                    textAnchor="middle"
                    fill="#0F172A"
                    className="font-mono text-[11.5px] font-semibold"
                  >
                    {node.symbol}
                  </text>

                  {/* Bottom Relevance / Specificity Indicator */}
                  <text
                    x="0"
                    y="18"
                    textAnchor="middle"
                    fill="#475569"
                    className="font-mono text-[8.5px]"
                  >
                    {node.upgradedFromGenericGene
                      ? '↑ SO_0001217 SPEC'
                      : `REL: ${node.relevanceScore.toFixed(2)}`}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Bottom Legend Bar (Unboxed Metadata with Typographic Separators) */}
      <div className="px-4 py-2 bg-[#F8FAFC] border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-600">
        <div className="flex flex-wrap items-center gap-2">
          <span>[SO:1217] protein_coding_gene</span>
          <span aria-hidden="true">·</span>
          <span>⟨PR:0001⟩ protein</span>
          <span aria-hidden="true">·</span>
          <span>→ so#translates_to</span>
          <span aria-hidden="true">·</span>
          <span className="text-cyan-800 font-medium">★ GNN Held-Out Prediction</span>
          <span aria-hidden="true">·</span>
          <span className="text-rose-700">✖ Pruned Artifact</span>
        </div>
        <span className="text-slate-500">
          Drag nodes to inspect multi-hop topology · Click any edge for lineage audit
        </span>
      </div>
    </div>
  );
};
