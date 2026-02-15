'use client';

import { useState, useMemo, useCallback } from 'react';
import { Box, Typography, Chip, IconButton, alpha, useTheme } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphTask {
  title: string;
  description: string;
  taskType: string;
  priority: number;
  dependencies: string[];
}

interface DependencyGraphProps {
  tasks: GraphTask[];
  taskTypeColors: Record<string, string>;
}

interface LayoutNode {
  idx: number;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
}

interface LayoutEdge {
  fromIdx: number;
  toIdx: number;
  path: string;
}

interface ChainResult {
  upNodes: Set<number>;
  downNodes: Set<number>;
  upEdges: Set<string>;
  downEdges: Set<string>;
  allNodes: Set<number>;
  allEdges: Set<string>;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const NODE_W = 210;
const NODE_H = 56;
const H_GAP = 48;
const V_GAP = 88;
const PAD = 44;

// ---------------------------------------------------------------------------
// DAG layout — assign layers via longest-path, barycenter ordering
// ---------------------------------------------------------------------------

function layoutGraph(tasks: GraphTask[]) {
  const n = tasks.length;
  if (n === 0) return { nodes: [] as LayoutNode[], edges: [] as LayoutEdge[], w: 0, h: 0 };

  const titleMap = new Map<string, number>();
  tasks.forEach((t, i) => titleMap.set(t.title, i));

  const deps: number[][] = tasks.map((t) =>
    t.dependencies
      .map((d) => titleMap.get(d))
      .filter((x): x is number => x !== undefined),
  );

  const layer = new Array<number>(n).fill(-1);
  const assignLayer = (i: number, visited: Set<number>): number => {
    if (layer[i] >= 0) return layer[i];
    if (visited.has(i)) return 0;
    visited.add(i);
    layer[i] =
      deps[i].length === 0
        ? 0
        : 1 + Math.max(...deps[i].map((d) => assignLayer(d, visited)));
    return layer[i];
  };
  for (let i = 0; i < n; i++) assignLayer(i, new Set());

  const maxL = Math.max(...layer);
  const groups: number[][] = Array.from({ length: maxL + 1 }, () => []);
  layer.forEach((l, i) => groups[l].push(i));

  for (let l = 1; l <= maxL; l++) {
    groups[l].sort((a, b) => {
      const posOf = (idx: number) => groups[layer[idx]].indexOf(idx);
      const avg = (arr: number[]) =>
        arr.length > 0 ? arr.reduce((s, d) => s + posOf(d), 0) / arr.length : 0;
      return avg(deps[a]) - avg(deps[b]);
    });
  }

  const maxInLayer = Math.max(...groups.map((g) => g.length));
  const totalW = Math.max(maxInLayer * (NODE_W + H_GAP) - H_GAP + PAD * 2, NODE_W + PAD * 2);

  const nodes: LayoutNode[] = new Array(n);
  groups.forEach((group, l) => {
    const gw = group.length * (NODE_W + H_GAP) - H_GAP;
    const sx = (totalW - gw) / 2;
    group.forEach((idx, pos) => {
      nodes[idx] = {
        idx,
        x: sx + pos * (NODE_W + H_GAP),
        y: PAD + l * (NODE_H + V_GAP),
        width: NODE_W,
        height: NODE_H,
        layer: l,
      };
    });
  });

  const edges: LayoutEdge[] = [];
  tasks.forEach((task, i) => {
    for (const dep of task.dependencies) {
      const di = titleMap.get(dep);
      if (di !== undefined) {
        const f = nodes[di];
        const t = nodes[i];
        const x1 = f.x + f.width / 2;
        const y1 = f.y + f.height;
        const x2 = t.x + t.width / 2;
        const y2 = t.y;
        const dy = y2 - y1;
        edges.push({
          fromIdx: di,
          toIdx: i,
          path: `M${x1},${y1} C${x1},${y1 + dy * 0.45} ${x2},${y2 - dy * 0.45} ${x2},${y2}`,
        });
      }
    }
  });

  const totalH = PAD * 2 + (maxL + 1) * NODE_H + maxL * V_GAP;
  return { nodes, edges, w: totalW, h: totalH };
}

// ---------------------------------------------------------------------------
// BFS chain tracer — finds upstream (dependencies) & downstream (dependents)
// ---------------------------------------------------------------------------

function traceChains(tasks: GraphTask[], target: number): ChainResult {
  const titleMap = new Map<string, number>();
  tasks.forEach((t, i) => titleMap.set(t.title, i));

  const depsOf: number[][] = tasks.map((t) =>
    t.dependencies
      .map((d) => titleMap.get(d))
      .filter((x): x is number => x !== undefined),
  );

  const revDeps = new Map<number, number[]>();
  depsOf.forEach((d, i) =>
    d.forEach((dep) => {
      if (!revDeps.has(dep)) revDeps.set(dep, []);
      revDeps.get(dep)!.push(i);
    }),
  );

  const upNodes = new Set<number>([target]);
  const upEdges = new Set<string>();
  let queue = [target];
  while (queue.length > 0) {
    const c = queue.shift()!;
    for (const d of depsOf[c]) {
      upEdges.add(`${d}->${c}`);
      if (!upNodes.has(d)) {
        upNodes.add(d);
        queue.push(d);
      }
    }
  }

  const downNodes = new Set<number>([target]);
  const downEdges = new Set<string>();
  queue = [target];
  while (queue.length > 0) {
    const c = queue.shift()!;
    for (const d of revDeps.get(c) || []) {
      downEdges.add(`${c}->${d}`);
      if (!downNodes.has(d)) {
        downNodes.add(d);
        queue.push(d);
      }
    }
  }

  return {
    upNodes,
    downNodes,
    upEdges,
    downEdges,
    allNodes: new Set([...upNodes, ...downNodes]),
    allEdges: new Set([...upEdges, ...downEdges]),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DependencyGraph({ tasks, taskTypeColors }: DependencyGraphProps) {
  const theme = useTheme();
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);

  // ── Full-mode layout (always computed) ──
  const fullLayout = useMemo(() => layoutGraph(tasks), [tasks]);

  // ── Hover chains for full mode ──
  const hoverChains = useMemo<ChainResult | null>(
    () => (hovered !== null && focused === null ? traceChains(tasks, hovered) : null),
    [tasks, hovered, focused],
  );

  // ── Focus data: sub-graph layout + ordered chain lists ──
  const focusData = useMemo(() => {
    if (focused === null) return null;

    const chains = traceChains(tasks, focused);
    const indices = Array.from(chains.allNodes).sort((a, b) => a - b);
    const chainTitles = new Set(indices.map((i) => tasks[i].title));

    const subTasks: GraphTask[] = indices.map((i) => ({
      ...tasks[i],
      dependencies: tasks[i].dependencies.filter((d) => chainTitles.has(d)),
    }));

    const subToOrig = indices;
    const origToSub = new Map(indices.map((orig, sub) => [orig, sub]));
    const subLayout = layoutGraph(subTasks);
    const focusedSubIdx = origToSub.get(focused)!;

    // Chains within the sub-graph (for coloring edges)
    const subChains = traceChains(subTasks, focusedSubIdx);

    // Ordered upstream list (roots first → closest dep)
    const upList = Array.from(chains.upNodes)
      .filter((i) => i !== focused)
      .sort((a, b) => {
        const aL = subLayout.nodes[origToSub.get(a)!]?.layer ?? 0;
        const bL = subLayout.nodes[origToSub.get(b)!]?.layer ?? 0;
        return aL - bL;
      });

    // Ordered downstream list (closest dependent → leaves)
    const downList = Array.from(chains.downNodes)
      .filter((i) => i !== focused)
      .sort((a, b) => {
        const aL = subLayout.nodes[origToSub.get(a)!]?.layer ?? 0;
        const bL = subLayout.nodes[origToSub.get(b)!]?.layer ?? 0;
        return aL - bL;
      });

    return { chains, subTasks, subLayout, subToOrig, origToSub, focusedSubIdx, subChains, upList, downList };
  }, [tasks, focused]);

  // ── Hover chains for focused mode (within sub-graph) ──
  const focusHoverChains = useMemo<ChainResult | null>(() => {
    if (hovered === null || !focusData) return null;
    const subIdx = focusData.origToSub.get(hovered);
    if (subIdx === undefined) return null;
    return traceChains(focusData.subTasks, subIdx);
  }, [focusData, hovered]);

  // ── Handlers ──
  const handleHoverEnter = useCallback((origIdx: number) => setHovered(origIdx), []);
  const handleHoverLeave = useCallback(() => setHovered(null), []);

  const handleNodeClick = useCallback(
    (origIdx: number) => {
      if (origIdx === focused) {
        setFocused(null);
      } else {
        setFocused(origIdx);
      }
      setHovered(null);
    },
    [focused],
  );

  const handleBack = useCallback(() => {
    setFocused(null);
    setHovered(null);
  }, []);

  if (fullLayout.nodes.length === 0) return null;

  // Helper: get the original task for a hovered node
  const hoveredTask = hovered !== null ? tasks[hovered] : null;
  const hoveredColor = hoveredTask ? taskTypeColors[hoveredTask.taskType] || '#818cf8' : '#818cf8';

  // =====================================================================
  // FOCUSED MODE
  // =====================================================================
  if (focused !== null && focusData) {
    const { subTasks, subLayout, subToOrig, origToSub, focusedSubIdx, subChains, upList, downList } = focusData;
    const focusedTask = tasks[focused];
    const focusedColor = taskTypeColors[focusedTask.taskType] || '#818cf8';

    return (
      <Box sx={{ position: 'relative', '@keyframes fadeIn': { from: { opacity: 0 }, to: { opacity: 1 } }, animation: 'fadeIn 0.25s ease' }}>
        <Box sx={{ display: 'flex', minHeight: 320 }}>

          {/* ── Left sidebar ── */}
          <Box
            sx={{
              width: 280,
              flexShrink: 0,
              overflow: 'auto',
              borderRight: '1px solid',
              borderColor: 'divider',
              bgcolor: alpha(theme.palette.background.paper, 0.35),
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Back button */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.5,
                py: 1.25,
                borderBottom: '1px solid',
                borderColor: 'divider',
                cursor: 'pointer',
                transition: 'background 0.15s ease',
                '&:hover': { bgcolor: alpha(theme.palette.common.white, 0.04) },
              }}
              onClick={handleBack}
            >
              <ArrowBackIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                Back to full graph
              </Typography>
            </Box>

            {/* Scrollable chain content */}
            <Box sx={{ flex: 1, overflow: 'auto', px: 1.5, py: 1.5 }}>

              {/* ── Upstream section ── */}
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#38bdf8', display: 'block', mb: 1, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                Dependencies ({upList.length})
              </Typography>

              {upList.length > 0 ? (
                <Box sx={{ mb: 0.5 }}>
                  {upList.map((origIdx, i) => {
                    const t = tasks[origIdx];
                    const c = taskTypeColors[t.taskType] || '#818cf8';
                    return (
                      <Box
                        key={origIdx}
                        sx={{
                          display: 'flex',
                          gap: 1,
                          cursor: 'pointer',
                          '&:hover .chain-card': { bgcolor: alpha('#38bdf8', 0.08), borderColor: alpha('#38bdf8', 0.3) },
                        }}
                        onClick={() => handleNodeClick(origIdx)}
                      >
                        {/* Timeline connector */}
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 14, pt: '7px' }}>
                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#38bdf8', flexShrink: 0, boxShadow: `0 0 6px ${alpha('#38bdf8', 0.4)}` }} />
                          <Box sx={{ width: 1.5, flex: 1, bgcolor: alpha('#38bdf8', 0.2), mt: 0.5, minHeight: 8 }} />
                        </Box>
                        {/* Card */}
                        <Box
                          className="chain-card"
                          sx={{
                            flex: 1, mb: 1, p: 1, borderRadius: 1.5, minWidth: 0,
                            border: '1px solid', borderColor: 'divider',
                            bgcolor: alpha(theme.palette.background.paper, 0.3),
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                            <Typography variant="subtitle2" sx={{ fontSize: 11.5, lineHeight: 1.3, flex: 1 }} noWrap>
                              {t.title}
                            </Typography>
                            <Chip
                              label={t.taskType}
                              size="small"
                              sx={{ fontSize: 8, height: 16, fontWeight: 600, textTransform: 'capitalize', bgcolor: alpha(c, 0.15), color: c }}
                            />
                          </Box>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, lineHeight: 1.3, display: 'block' }} noWrap>
                            P{t.priority} &middot; {t.description}
                          </Typography>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              ) : (
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 1.5, pl: 0.5 }}>
                  No dependencies
                </Typography>
              )}

              {/* Connecting line into focused node */}
              {upList.length > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'center', width: 14 }}>
                  <Box sx={{ width: 1.5, height: 8, bgcolor: alpha('#38bdf8', 0.2) }} />
                </Box>
              )}

              {/* ── Focused node card ── */}
              <Box
                sx={{
                  my: 1,
                  p: 1.5,
                  borderRadius: 2,
                  border: '2px solid',
                  borderColor: focusedColor,
                  bgcolor: alpha(focusedColor, 0.1),
                  boxShadow: `0 0 20px ${alpha(focusedColor, 0.15)}, inset 0 0 20px ${alpha(focusedColor, 0.05)}`,
                  position: 'relative',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: focusedColor, boxShadow: `0 0 8px ${focusedColor}` }} />
                  <Typography variant="caption" sx={{ fontWeight: 700, color: focusedColor, textTransform: 'uppercase', fontSize: 9, letterSpacing: 0.8 }}>
                    Focused
                  </Typography>
                </Box>
                <Typography variant="subtitle2" sx={{ fontSize: 13, lineHeight: 1.3, mb: 0.25 }}>
                  {focusedTask.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.4, mb: 0.5 }}>
                  {focusedTask.description}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                  <Chip
                    label={focusedTask.taskType}
                    size="small"
                    sx={{ fontSize: 9, height: 18, fontWeight: 600, textTransform: 'capitalize', bgcolor: alpha(focusedColor, 0.2), color: focusedColor }}
                  />
                  <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                    P{focusedTask.priority}
                  </Typography>
                </Box>
              </Box>

              {/* Connecting line out of focused node */}
              {downList.length > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'center', width: 14 }}>
                  <Box sx={{ width: 1.5, height: 8, bgcolor: alpha('#a78bfa', 0.2) }} />
                </Box>
              )}

              {/* ── Downstream section ── */}
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#a78bfa', display: 'block', mb: 1, mt: 1.5, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                Dependents ({downList.length})
              </Typography>

              {downList.length > 0 ? (
                <Box>
                  {downList.map((origIdx, i) => {
                    const t = tasks[origIdx];
                    const c = taskTypeColors[t.taskType] || '#818cf8';
                    const isLast = i === downList.length - 1;
                    return (
                      <Box
                        key={origIdx}
                        sx={{
                          display: 'flex',
                          gap: 1,
                          cursor: 'pointer',
                          '&:hover .chain-card': { bgcolor: alpha('#a78bfa', 0.08), borderColor: alpha('#a78bfa', 0.3) },
                        }}
                        onClick={() => handleNodeClick(origIdx)}
                      >
                        {/* Timeline connector */}
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 14, pt: '7px' }}>
                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#a78bfa', flexShrink: 0, boxShadow: `0 0 6px ${alpha('#a78bfa', 0.4)}` }} />
                          {!isLast && <Box sx={{ width: 1.5, flex: 1, bgcolor: alpha('#a78bfa', 0.2), mt: 0.5, minHeight: 8 }} />}
                        </Box>
                        {/* Card */}
                        <Box
                          className="chain-card"
                          sx={{
                            flex: 1, mb: 1, p: 1, borderRadius: 1.5, minWidth: 0,
                            border: '1px solid', borderColor: 'divider',
                            bgcolor: alpha(theme.palette.background.paper, 0.3),
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                            <Typography variant="subtitle2" sx={{ fontSize: 11.5, lineHeight: 1.3, flex: 1 }} noWrap>
                              {t.title}
                            </Typography>
                            <Chip
                              label={t.taskType}
                              size="small"
                              sx={{ fontSize: 8, height: 16, fontWeight: 600, textTransform: 'capitalize', bgcolor: alpha(c, 0.15), color: c }}
                            />
                          </Box>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, lineHeight: 1.3, display: 'block' }} noWrap>
                            P{t.priority} &middot; {t.description}
                          </Typography>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              ) : (
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', pl: 0.5 }}>
                  No dependents
                </Typography>
              )}

              {/* Stats summary */}
              <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider', display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 }}>In chain</Typography>
                  <Typography variant="subtitle2" sx={{ fontSize: 13 }}>{upList.length + downList.length + 1}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ fontSize: 9, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 0.5 }}>Deps</Typography>
                  <Typography variant="subtitle2" sx={{ fontSize: 13 }}>{upList.length}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ fontSize: 9, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 0.5 }}>Dependents</Typography>
                  <Typography variant="subtitle2" sx={{ fontSize: 13 }}>{downList.length}</Typography>
                </Box>
              </Box>
            </Box>
          </Box>

          {/* ── Focused sub-graph ── */}
          <Box
            sx={{
              flex: 1,
              overflow: 'auto',
              borderRadius: '0 8px 8px 0',
              bgcolor: alpha(theme.palette.background.default, 0.3),
              position: 'relative',
            }}
          >
            {/* Chain color legend */}
            <Box
              sx={{
                position: 'absolute',
                top: 10,
                right: 12,
                zIndex: 2,
                display: 'flex',
                gap: 2,
                px: 1.5,
                py: 0.75,
                borderRadius: 1.5,
                bgcolor: alpha(theme.palette.background.paper, 0.8),
                backdropFilter: 'blur(8px)',
                border: '1px solid',
                borderColor: 'divider',
                fontSize: 11,
                color: 'text.secondary',
                pointerEvents: 'none',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 18, height: 2, bgcolor: '#38bdf8', borderRadius: 1 }} />
                <span>Dependencies</span>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 18, height: 2, bgcolor: '#a78bfa', borderRadius: 1 }} />
                <span>Dependents</span>
              </Box>
            </Box>

            <svg
              viewBox={`0 0 ${subLayout.w} ${subLayout.h}`}
              width={subLayout.w}
              height={subLayout.h}
              style={{ display: 'block', minWidth: subLayout.w }}
            >
              <defs>
                <pattern id="dep-grid-f" width="20" height="20" patternUnits="userSpaceOnUse">
                  <circle cx="10" cy="10" r="0.6" fill="rgba(255,255,255,0.035)" />
                </pattern>
                <marker id="arr-def-f" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="7" markerHeight="5" orient="auto">
                  <path d="M0,0 L10,4 L0,8z" fill={alpha('#94a3b8', 0.3)} />
                </marker>
                <marker id="arr-up-f" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="7" markerHeight="5" orient="auto">
                  <path d="M0,0 L10,4 L0,8z" fill="#38bdf8" />
                </marker>
                <marker id="arr-dn-f" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="7" markerHeight="5" orient="auto">
                  <path d="M0,0 L10,4 L0,8z" fill="#a78bfa" />
                </marker>
                <filter id="node-glow-f" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <style>{`
                @keyframes dash-upstream-f { to { stroke-dashoffset: 16; } }
                @keyframes dash-downstream-f { to { stroke-dashoffset: -16; } }
                .fedge-up { animation: dash-upstream-f 0.5s linear infinite; }
                .fedge-down { animation: dash-downstream-f 0.5s linear infinite; }
              `}</style>

              <rect width={subLayout.w} height={subLayout.h} fill="url(#dep-grid-f)" />

              {/* Edges — all persistently animated */}
              {subLayout.edges.map((e, i) => {
                const eKey = `${e.fromIdx}->${e.toIdx}`;
                const isUp = subChains.upEdges.has(eKey);
                const isDown = subChains.downEdges.has(eKey);

                // Dim slightly when hovering a different node
                const hoverLit = focusHoverChains?.allEdges.has(eKey) ?? true;
                const dim = hovered !== null && !hoverLit;

                return (
                  <path
                    key={i}
                    d={e.path}
                    fill="none"
                    stroke={isUp ? '#38bdf8' : isDown ? '#a78bfa' : alpha('#94a3b8', 0.3)}
                    strokeWidth={2.5}
                    strokeDasharray="8 8"
                    className={isUp ? 'fedge-up' : isDown ? 'fedge-down' : undefined}
                    opacity={dim ? 0.2 : 1}
                    markerEnd={isUp ? 'url(#arr-up-f)' : isDown ? 'url(#arr-dn-f)' : 'url(#arr-def-f)'}
                    style={{ transition: 'opacity 0.25s ease' }}
                  />
                );
              })}

              {/* Nodes */}
              {subLayout.nodes.filter(Boolean).map((node) => {
                const origIdx = subToOrig[node.idx];
                const task = tasks[origIdx];
                const color = taskTypeColors[task.taskType] || '#818cf8';
                const isFocusedNode = node.idx === focusedSubIdx;
                const isUpNode = subChains.upNodes.has(node.idx) && !isFocusedNode;
                const isDownNode = subChains.downNodes.has(node.idx) && !isFocusedNode;
                const isHov = hovered === origIdx;

                // Dim when hovering a different node and this one isn't in the sub-chain
                const hoverLit = focusHoverChains?.allNodes.has(node.idx) ?? true;
                const dim = hovered !== null && !isHov && !hoverLit;

                const stroke = isFocusedNode
                  ? color
                  : isHov
                    ? color
                    : isUpNode
                      ? '#38bdf8'
                      : isDownNode
                        ? '#a78bfa'
                        : alpha(color, 0.4);
                const fill = isFocusedNode
                  ? alpha(color, 0.22)
                  : isHov
                    ? alpha(color, 0.18)
                    : isUpNode
                      ? alpha('#38bdf8', 0.1)
                      : isDownNode
                        ? alpha('#a78bfa', 0.1)
                        : alpha(color, 0.06);

                const label = task.title.length > 26 ? task.title.slice(0, 24) + '\u2026' : task.title;

                return (
                  <g
                    key={node.idx}
                    onMouseEnter={() => handleHoverEnter(origIdx)}
                    onMouseLeave={handleHoverLeave}
                    onClick={() => handleNodeClick(origIdx)}
                    style={{ cursor: 'pointer' }}
                    opacity={dim ? 0.2 : 1}
                    filter={isFocusedNode || isHov ? 'url(#node-glow-f)' : undefined}
                  >
                    <title>{`${task.title}\nP${task.priority} \u00b7 ${task.taskType.toUpperCase()}\n${task.description}`}</title>
                    <rect
                      x={node.x} y={node.y} width={node.width} height={node.height}
                      rx={10} ry={10} fill={fill} stroke={stroke}
                      strokeWidth={isFocusedNode ? 2.5 : isHov ? 2 : 1.5}
                      style={{ transition: 'opacity 0.25s ease' }}
                    />
                    <line
                      x1={node.x + 14} y1={node.y} x2={node.x + node.width - 14} y2={node.y}
                      stroke={color} strokeWidth={2} strokeLinecap="round"
                      opacity={isFocusedNode || isHov ? 0.9 : 0.35}
                    />
                    <text
                      x={node.x + node.width / 2} y={node.y + 23} textAnchor="middle"
                      fill="#e2e8f0" fontSize={12} fontWeight={isFocusedNode ? 700 : 600}
                      fontFamily='"Inter", -apple-system, sans-serif'
                    >
                      {label}
                    </text>
                    <text
                      x={node.x + node.width / 2} y={node.y + 41} textAnchor="middle"
                      fill={alpha('#94a3b8', 0.65)} fontSize={10}
                      fontFamily='"Inter", -apple-system, sans-serif'
                    >
                      P{task.priority} &middot; {task.taskType.toUpperCase()}
                    </text>
                  </g>
                );
              })}
            </svg>
          </Box>
        </Box>

        {/* ── Hover detail panel (focused mode) ── */}
        {hoveredTask && (
          <Box
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.5,
              px: 2, py: 1.25,
              borderTop: '1px solid', borderColor: 'divider',
              bgcolor: alpha(theme.palette.background.paper, 0.5),
              backdropFilter: 'blur(6px)',
            }}
          >
            <Chip
              label={hoveredTask.taskType} size="small"
              sx={{ fontSize: 10, height: 20, fontWeight: 600, textTransform: 'capitalize', bgcolor: alpha(hoveredColor, 0.15), color: hoveredColor }}
            />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="subtitle2" sx={{ fontSize: 12, lineHeight: 1.3 }} noWrap>{hoveredTask.title}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.4, mt: 0.15 }} noWrap>
                {hoveredTask.description}
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', flexShrink: 0 }}>
              P{hoveredTask.priority}
            </Typography>
          </Box>
        )}
      </Box>
    );
  }

  // =====================================================================
  // FULL MODE
  // =====================================================================
  return (
    <Box sx={{ position: 'relative' }}>
      {/* Hover chain legend */}
      <Box
        sx={{
          position: 'absolute',
          top: 10,
          right: 12,
          zIndex: 2,
          display: 'flex',
          gap: 2,
          px: 1.5,
          py: 0.75,
          borderRadius: 1.5,
          bgcolor: alpha(theme.palette.background.paper, 0.8),
          backdropFilter: 'blur(8px)',
          border: '1px solid',
          borderColor: 'divider',
          fontSize: 11,
          color: 'text.secondary',
          opacity: hovered !== null ? 1 : 0,
          transition: 'opacity 0.25s ease',
          pointerEvents: 'none',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 18, height: 2, bgcolor: '#38bdf8', borderRadius: 1 }} />
          <span>Dependencies</span>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 18, height: 2, bgcolor: '#a78bfa', borderRadius: 1 }} />
          <span>Dependents</span>
        </Box>
      </Box>

      {/* Click hint */}
      <Box
        sx={{
          position: 'absolute',
          top: 10,
          left: 12,
          zIndex: 2,
          px: 1.5,
          py: 0.75,
          borderRadius: 1.5,
          bgcolor: alpha(theme.palette.background.paper, 0.8),
          backdropFilter: 'blur(8px)',
          border: '1px solid',
          borderColor: 'divider',
          fontSize: 11,
          color: 'text.disabled',
          opacity: hovered !== null ? 1 : 0,
          transition: 'opacity 0.25s ease',
          pointerEvents: 'none',
        }}
      >
        Click to focus
      </Box>

      {/* Scrollable SVG canvas */}
      <Box
        sx={{
          overflow: 'auto',
          borderRadius: 2,
          bgcolor: alpha(theme.palette.background.default, 0.3),
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <svg
          viewBox={`0 0 ${fullLayout.w} ${fullLayout.h}`}
          width={fullLayout.w}
          height={fullLayout.h}
          style={{ display: 'block', minWidth: fullLayout.w }}
        >
          <defs>
            <pattern id="dep-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="10" cy="10" r="0.6" fill="rgba(255,255,255,0.035)" />
            </pattern>
            <marker id="arr-def" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="7" markerHeight="5" orient="auto">
              <path d="M0,0 L10,4 L0,8z" fill={alpha('#94a3b8', 0.3)} />
            </marker>
            <marker id="arr-up" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="7" markerHeight="5" orient="auto">
              <path d="M0,0 L10,4 L0,8z" fill="#38bdf8" />
            </marker>
            <marker id="arr-dn" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="7" markerHeight="5" orient="auto">
              <path d="M0,0 L10,4 L0,8z" fill="#a78bfa" />
            </marker>
            <filter id="node-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <style>{`
            @keyframes dash-upstream { to { stroke-dashoffset: 16; } }
            @keyframes dash-downstream { to { stroke-dashoffset: -16; } }
            .edge-upstream { animation: dash-upstream 0.5s linear infinite; }
            .edge-downstream { animation: dash-downstream 0.5s linear infinite; }
          `}</style>

          <rect width={fullLayout.w} height={fullLayout.h} fill="url(#dep-grid)" />

          {/* Edges */}
          {fullLayout.edges.map((e, i) => {
            const key = `${e.fromIdx}->${e.toIdx}`;
            const isUp = hoverChains?.upEdges.has(key) ?? false;
            const isDown = hoverChains?.downEdges.has(key) ?? false;
            const lit = isUp || isDown;
            const dim = hovered !== null && !lit;

            return (
              <path
                key={i}
                d={e.path}
                fill="none"
                stroke={isUp ? '#38bdf8' : isDown ? '#a78bfa' : alpha('#94a3b8', 0.22)}
                strokeWidth={lit ? 2.5 : 1.5}
                strokeDasharray={lit ? '8 8' : 'none'}
                className={isUp ? 'edge-upstream' : isDown ? 'edge-downstream' : undefined}
                opacity={dim ? 0.07 : 1}
                markerEnd={isUp ? 'url(#arr-up)' : isDown ? 'url(#arr-dn)' : 'url(#arr-def)'}
                style={{ transition: 'opacity 0.3s ease' }}
              />
            );
          })}

          {/* Nodes */}
          {fullLayout.nodes.filter(Boolean).map((node) => {
            const color = taskTypeColors[tasks[node.idx].taskType] || '#818cf8';
            const task = tasks[node.idx];
            const isH = hovered === node.idx;
            const inChain = hoverChains?.allNodes.has(node.idx) ?? false;
            const dim = hovered !== null && !inChain;
            const isUp = !isH && (hoverChains?.upNodes.has(node.idx) ?? false);
            const isDown = !isH && (hoverChains?.downNodes.has(node.idx) ?? false);

            const stroke = isH
              ? color
              : isUp ? '#38bdf8' : isDown ? '#a78bfa' : alpha(color, 0.4);
            const fill = isH
              ? alpha(color, 0.22)
              : isUp ? alpha('#38bdf8', 0.1) : isDown ? alpha('#a78bfa', 0.1) : alpha(color, 0.06);

            const label = task.title.length > 26 ? task.title.slice(0, 24) + '\u2026' : task.title;

            return (
              <g
                key={node.idx}
                onMouseEnter={() => handleHoverEnter(node.idx)}
                onMouseLeave={handleHoverLeave}
                onClick={() => handleNodeClick(node.idx)}
                style={{ cursor: 'pointer' }}
                opacity={dim ? 0.1 : 1}
                filter={isH ? 'url(#node-glow)' : undefined}
              >
                <title>{`${task.title}\nP${task.priority} \u00b7 ${task.taskType.toUpperCase()}\n${task.description}`}</title>
                <rect
                  x={node.x} y={node.y} width={node.width} height={node.height}
                  rx={10} ry={10} fill={fill} stroke={stroke}
                  strokeWidth={isH ? 2 : inChain ? 1.5 : 1}
                  style={{ transition: 'opacity 0.3s ease' }}
                />
                <line
                  x1={node.x + 14} y1={node.y} x2={node.x + node.width - 14} y2={node.y}
                  stroke={color} strokeWidth={2} strokeLinecap="round"
                  opacity={isH ? 0.9 : 0.35}
                />
                <text
                  x={node.x + node.width / 2} y={node.y + 23} textAnchor="middle"
                  fill="#e2e8f0" fontSize={12} fontWeight={600}
                  fontFamily='"Inter", -apple-system, sans-serif'
                >
                  {label}
                </text>
                <text
                  x={node.x + node.width / 2} y={node.y + 41} textAnchor="middle"
                  fill={alpha('#94a3b8', 0.65)} fontSize={10}
                  fontFamily='"Inter", -apple-system, sans-serif'
                >
                  P{task.priority} &middot; {task.taskType.toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
      </Box>

      {/* Hover detail panel */}
      {hoveredTask && (
        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: 1.5,
            px: 2, py: 1.25,
            borderTop: '1px solid', borderColor: 'divider',
            bgcolor: alpha(theme.palette.background.paper, 0.5),
            backdropFilter: 'blur(6px)',
          }}
        >
          <Chip
            label={hoveredTask.taskType} size="small"
            sx={{ fontSize: 10, height: 20, fontWeight: 600, textTransform: 'capitalize', bgcolor: alpha(hoveredColor, 0.15), color: hoveredColor }}
          />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" sx={{ fontSize: 12, lineHeight: 1.3 }} noWrap>{hoveredTask.title}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.4, mt: 0.15 }} noWrap>
              {hoveredTask.description}
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', flexShrink: 0 }}>
            P{hoveredTask.priority}
          </Typography>
          {hoverChains && (
            <Box sx={{ display: 'flex', gap: 1.5, flexShrink: 0, ml: 1 }}>
              <Typography variant="caption" sx={{ color: '#38bdf8' }}>
                {hoverChains.upNodes.size - 1} dep{hoverChains.upNodes.size - 1 !== 1 ? 's' : ''}
              </Typography>
              <Typography variant="caption" sx={{ color: '#a78bfa' }}>
                {hoverChains.downNodes.size - 1} dependent{hoverChains.downNodes.size - 1 !== 1 ? 's' : ''}
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
