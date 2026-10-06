import React, { useState } from 'react';

interface RocPoint {
  fpr: number;
  tprBaseline: number;
  tprAgent: number;
}

interface RocChartProps {
  data: RocPoint[];
  baselineAuroc: number;
  agentAuroc: number;
}

export const DualRocCurveChart: React.FC<RocChartProps> = ({
  data,
  baselineAuroc,
  agentAuroc,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(3);

  const width = 520;
  const height = 280;
  const padLeft = 48;
  const padRight = 24;
  const padTop = 24;
  const padBottom = 38;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const toX = (fpr: number) => padLeft + fpr * plotW;
  const toY = (tpr: number) => padTop + (1 - tpr) * plotH;

  const agentPoints = data.map((d) => `${toX(d.fpr)},${toY(d.tprAgent)}`).join(' ');
  const baselinePoints = data.map((d) => `${toX(d.fpr)},${toY(d.tprBaseline)}`).join(' ');
  const agentAreaPoints = `${toX(0)},${toY(0)} ${agentPoints} ${toX(1)},${toY(0)}`;

  const activePoint = hoveredIdx !== null ? data[hoveredIdx] : data[3];

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between mb-3 border-b border-slate-200 pb-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">
            Held-Out Link Prediction ROC Curve (GNN / RGCN Evaluation)
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">
            Agent-Enriched Contextual KG vs. Static Public Pharos KG Baseline
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
          <span className="text-cyan-700 font-semibold">
            ― Agent KG AUROC: {agentAuroc.toFixed(3)}
          </span>
          <span className="text-slate-500">
            --- Pharos Baseline: {baselineAuroc.toFixed(3)}
          </span>
        </div>
      </div>

      <div className="relative bg-white border border-slate-200 p-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto cursor-crosshair select-none"
        >
          {/* Subtle grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const y = toY(tick);
            const x = toX(tick);
            return (
              <g key={tick}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#E2E8F0"
                  strokeWidth="1"
                />
                <line
                  x1={x}
                  y1={padTop}
                  x2={x}
                  y2={height - padBottom}
                  stroke="#E2E8F0"
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-400 font-mono text-[10px]"
                >
                  {tick.toFixed(2)}
                </text>
                <text
                  x={x}
                  y={height - padBottom + 16}
                  textAnchor="middle"
                  className="fill-slate-400 font-mono text-[10px]"
                >
                  {tick.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* Random guess diagonal */}
          <line
            x1={toX(0)}
            y1={toY(0)}
            x2={toX(1)}
            y2={toY(1)}
            stroke="#CBD5E1"
            strokeWidth="1"
            strokeDasharray="2 4"
          />

          {/* Area under Agent curve */}
          <polygon points={agentAreaPoints} fill="rgba(6, 182, 212, 0.10)" />

          {/* Baseline Pharos dashed curve */}
          <polyline
            fill="none"
            stroke="#64748B"
            strokeWidth="2"
            strokeDasharray="5 4"
            points={baselinePoints}
          />

          {/* Agent-Enriched solid cyan curve */}
          <polyline
            fill="none"
            stroke="#0891B2"
            strokeWidth="2.5"
            points={agentPoints}
          />

          {/* Crosshair guide for active point */}
          {activePoint && (
            <g>
              <line
                x1={toX(activePoint.fpr)}
                y1={padTop}
                x2={toX(activePoint.fpr)}
                y2={height - padBottom}
                stroke="#0891B2"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <line
                x1={padLeft}
                y1={toY(activePoint.tprAgent)}
                x2={width - padRight}
                y2={toY(activePoint.tprAgent)}
                stroke="#0891B2"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
            </g>
          )}

          {/* Interactive vertices */}
          {data.map((pt, idx) => (
            <g
              key={idx}
              onMouseEnter={() => setHoveredIdx(idx)}
              onClick={() => setHoveredIdx(idx)}
              className="cursor-pointer"
            >
              <circle
                cx={toX(pt.fpr)}
                cy={toY(pt.tprBaseline)}
                r={hoveredIdx === idx ? 4.5 : 3}
                fill="#FFFFFF"
                stroke="#64748B"
                strokeWidth="1.5"
              />
              <circle
                cx={toX(pt.fpr)}
                cy={toY(pt.tprAgent)}
                r={hoveredIdx === idx ? 5.5 : 3.5}
                fill={hoveredIdx === idx ? '#06B6D4' : '#FFFFFF'}
                stroke="#0891B2"
                strokeWidth="2"
              />
              {/* Larger hit area */}
              <rect
                x={toX(pt.fpr) - 12}
                y={padTop}
                width={24}
                height={plotH}
                fill="transparent"
              />
            </g>
          ))}

          {/* Axis labels */}
          <text
            x={padLeft + plotW / 2}
            y={height - 4}
            textAnchor="middle"
            className="fill-slate-500 font-mono text-[10px]"
          >
            False Positive Rate (1 - Specificity)
          </text>
          <text
            x={12}
            y={padTop + plotH / 2}
            textAnchor="middle"
            transform={`rotate(-90 12 ${padTop + plotH / 2})`}
            className="fill-slate-500 font-mono text-[10px]"
          >
            True Positive Rate (Recall)
          </text>
        </svg>

        {/* Monospace HUD coordinate readout */}
        {activePoint && (
          <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs font-mono tabular-nums text-slate-600">
            <span>
              PROBE FPR: <strong className="text-slate-900">{activePoint.fpr.toFixed(2)}</strong>
            </span>
            <span>·</span>
            <span>
              AGENT TPR: <strong className="text-cyan-700">{activePoint.tprAgent.toFixed(3)}</strong>
            </span>
            <span>·</span>
            <span>
              PHAROS TPR: <strong className="text-slate-700">{activePoint.tprBaseline.toFixed(3)}</strong>
            </span>
            <span>·</span>
            <span className="text-emerald-700">
              GAIN: +{(activePoint.tprAgent - activePoint.tprBaseline).toFixed(3)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

interface RadarMetric {
  axis: string;
  weightLabel: string;
  agentScore: number; // 0 to 100
  baselineScore: number; // 0 to 100
}

interface RadarChartProps {
  metrics: RadarMetric[];
}

export const JudgingRadarChart: React.FC<RadarChartProps> = ({ metrics }) => {
  const size = 300;
  const center = size / 2;
  const radius = 98;
  const levels = [0.25, 0.5, 0.75, 1.0];

  const angleForIndex = (i: number) => (Math.PI * 2 * i) / metrics.length - Math.PI / 2;

  const pointFor = (val: number, i: number) => {
    const r = (val / 100) * radius;
    const angle = angleForIndex(i);
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  };

  const agentPolygon = metrics
    .map((m, i) => {
      const pt = pointFor(m.agentScore, i);
      return `${pt.x},${pt.y}`;
    })
    .join(' ');

  const baselinePolygon = metrics
    .map((m, i) => {
      const pt = pointFor(m.baselineScore, i);
      return `${pt.x},${pt.y}`;
    })
    .join(' ');

  return (
    <div className="bg-white border border-slate-200 p-4">
      <div className="flex items-baseline justify-between border-b border-slate-200 pb-2 mb-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">
            Judging Rubric Calibration Spider
          </h4>
          <p className="text-xs text-slate-500">
            Weighted Competition Parameters (Usability 40% · Pruning 30% · Lineage 20% · OBO 10%)
          </p>
        </div>
      </div>

      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[300px] mx-auto h-auto">
        {/* Polygonal grid levels */}
        {levels.map((lvl) => {
          const pts = metrics
            .map((_, i) => {
              const pt = pointFor(lvl * 100, i);
              return `${pt.x},${pt.y}`;
            })
            .join(' ');
          return (
            <polygon
              key={lvl}
              points={pts}
              fill="none"
              stroke="#E2E8F0"
              strokeWidth="1"
            />
          );
        })}

        {/* Radial axes */}
        {metrics.map((m, i) => {
          const outer = pointFor(100, i);
          const labelPt = pointFor(122, i);
          return (
            <g key={m.axis}>
              <line
                x1={center}
                y1={center}
                x2={outer.x}
                y2={outer.y}
                stroke="#CBD5E1"
                strokeWidth="1"
              />
              <text
                x={labelPt.x}
                y={labelPt.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-slate-700 font-mono text-[9.5px] font-medium"
              >
                {m.axis} ({m.weightLabel})
              </text>
            </g>
          );
        })}

        {/* Baseline polygon */}
        <polygon
          points={baselinePolygon}
          fill="rgba(100, 116, 139, 0.12)"
          stroke="#64748B"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />

        {/* Agent polygon */}
        <polygon
          points={agentPolygon}
          fill="rgba(6, 182, 212, 0.20)"
          stroke="#06B6D4"
          strokeWidth="2"
        />

        {/* Agent vertices */}
        {metrics.map((m, i) => {
          const pt = pointFor(m.agentScore, i);
          return (
            <circle
              key={i}
              cx={pt.x}
              cy={pt.y}
              r="3.5"
              fill="#0891B2"
              stroke="#FFFFFF"
              strokeWidth="1.5"
            />
          );
        })}
      </svg>

      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-mono tabular-nums text-slate-600">
        <span className="text-cyan-700 font-medium">― Bio-Agent Active Pipeline</span>
        <span className="text-slate-500">--- Unpruned Raw Table Import</span>
      </div>
    </div>
  );
};
