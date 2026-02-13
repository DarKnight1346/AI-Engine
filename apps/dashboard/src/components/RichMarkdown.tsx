'use client';

import { useState, useRef, useEffect, useMemo, Fragment } from 'react';
import {
  Box, Typography, IconButton, Tooltip, alpha, useTheme,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';

// ---------------------------------------------------------------------------
// Chart color palette
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  '#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088FE',
  '#00C49F', '#FFBB28', '#FF8042', '#a4de6c', '#d0ed57',
  '#8dd1e1', '#83a6ed', '#8e4585', '#ff6b6b', '#4ecdc4',
];

// ---------------------------------------------------------------------------
// Mermaid renderer (lazy-loaded)
// ---------------------------------------------------------------------------

function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            darkMode: true,
            background: '#1e1e2e',
            primaryColor: '#7c3aed',
            primaryTextColor: '#e2e8f0',
            primaryBorderColor: '#6366f1',
            lineColor: '#6366f1',
            secondaryColor: '#1e293b',
            tertiaryColor: '#0f172a',
          },
        });
        const { svg: rendered } = await mermaid.render(idRef.current, code.trim());
        if (!cancelled) setSvg(rendered);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to render diagram');
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <Box sx={{ p: 2, my: 1.5, borderRadius: 2, bgcolor: 'rgba(239,83,80,0.08)', border: '1px solid rgba(239,83,80,0.2)' }}>
        <Typography variant="caption" color="error">Diagram error: {error}</Typography>
        <Box component="pre" sx={{ mt: 1, fontSize: 12, color: 'text.secondary', whiteSpace: 'pre-wrap' }}>{code}</Box>
      </Box>
    );
  }

  if (!svg) {
    return (
      <Box sx={{ p: 3, my: 1.5, textAlign: 'center', color: 'text.disabled' }}>
        <Typography variant="caption">Rendering diagram...</Typography>
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        my: 1.5, p: 2, borderRadius: 2,
        bgcolor: 'rgba(255,255,255,0.02)',
        border: '1px solid',
        borderColor: 'divider',
        overflow: 'auto',
        '& svg': { maxWidth: '100%', height: 'auto' },
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ---------------------------------------------------------------------------
// Chart renderer
// ---------------------------------------------------------------------------

interface ChartSpec {
  type: 'bar' | 'line' | 'pie' | 'area' | 'radar';
  title?: string;
  data: Array<Record<string, unknown>>;
  xKey?: string;
  yKeys?: string[];
  nameKey?: string;
  valueKey?: string;
}

function ChartRenderer({ spec }: { spec: ChartSpec }) {
  const theme = useTheme();

  if (!spec.data || spec.data.length === 0) {
    return (
      <Box sx={{ p: 2, color: 'text.secondary' }}>
        <Typography variant="caption">No data available for chart</Typography>
      </Box>
    );
  }

  const xKey = spec.xKey || Object.keys(spec.data[0])[0];
  const allKeys = Object.keys(spec.data[0]).filter(k => k !== xKey);
  const yKeys = spec.yKeys || allKeys;
  const nameKey = spec.nameKey || xKey;
  const valueKey = spec.valueKey || (allKeys[0] ?? 'value');

  const chartStyle = {
    fontSize: 11,
    fontFamily: '"Inter", sans-serif',
  };

  const commonAxisProps = {
    stroke: alpha(theme.palette.common.white, 0.2),
    tick: { fill: alpha(theme.palette.common.white, 0.5), fontSize: 11 },
  };

  return (
    <Box sx={{
      my: 2, p: 2, borderRadius: 2,
      bgcolor: 'rgba(255,255,255,0.02)',
      border: '1px solid',
      borderColor: 'divider',
    }}>
      {spec.title && (
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.primary' }}>
          {spec.title}
        </Typography>
      )}
      <ResponsiveContainer width="100%" height={300}>
        {spec.type === 'bar' ? (
          <BarChart data={spec.data} style={chartStyle}>
            <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.common.white, 0.06)} />
            <XAxis dataKey={xKey} {...commonAxisProps} />
            <YAxis {...commonAxisProps} />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {yKeys.map((key, i) => (
              <Bar key={key} dataKey={key} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        ) : spec.type === 'line' ? (
          <LineChart data={spec.data} style={chartStyle}>
            <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.common.white, 0.06)} />
            <XAxis dataKey={xKey} {...commonAxisProps} />
            <YAxis {...commonAxisProps} />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {yKeys.map((key, i) => (
              <Line key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
            ))}
          </LineChart>
        ) : spec.type === 'area' ? (
          <AreaChart data={spec.data} style={chartStyle}>
            <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.common.white, 0.06)} />
            <XAxis dataKey={xKey} {...commonAxisProps} />
            <YAxis {...commonAxisProps} />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {yKeys.map((key, i) => (
              <Area
                key={key} type="monotone" dataKey={key}
                fill={alpha(CHART_COLORS[i % CHART_COLORS.length], 0.3)}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        ) : spec.type === 'radar' ? (
          <RadarChart data={spec.data} style={chartStyle} cx="50%" cy="50%" outerRadius="80%">
            <PolarGrid stroke={alpha(theme.palette.common.white, 0.1)} />
            <PolarAngleAxis dataKey={xKey} tick={{ fill: alpha(theme.palette.common.white, 0.5), fontSize: 11 }} />
            <PolarRadiusAxis tick={{ fill: alpha(theme.palette.common.white, 0.3), fontSize: 10 }} />
            {yKeys.map((key, i) => (
              <Radar key={key} dataKey={key} stroke={CHART_COLORS[i % CHART_COLORS.length]} fill={alpha(CHART_COLORS[i % CHART_COLORS.length], 0.3)} />
            ))}
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </RadarChart>
        ) : (
          /* Pie chart */
          <PieChart style={chartStyle}>
            <Pie
              data={spec.data}
              cx="50%" cy="50%"
              labelLine={false}
              label={({ name, percent }: { name: string; percent: number }) => `${name} ${(percent * 100).toFixed(0)}%`}
              outerRadius={100}
              dataKey={valueKey}
              nameKey={nameKey}
            >
              {spec.data.map((_, i) => (
                <Cell key={`cell-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <RechartsTooltip
              contentStyle={{
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        )}
      </ResponsiveContainer>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Code block (with copy button)
// ---------------------------------------------------------------------------

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box sx={{ position: 'relative', my: 1.5 }}>
      {lang && (
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: 2, py: 0.75,
          bgcolor: alpha(theme.palette.common.black, 0.3),
          borderTopLeftRadius: 8, borderTopRightRadius: 8,
          borderBottom: '1px solid', borderColor: 'divider',
        }}>
          <Typography variant="caption" sx={{ color: 'text.disabled', fontFamily: 'monospace', fontSize: 11 }}>
            {lang}
          </Typography>
          <Tooltip title={copied ? 'Copied!' : 'Copy'}>
            <IconButton size="small" onClick={handleCopy} sx={{ color: 'text.disabled', p: 0.25 }}>
              <ContentCopyIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}
      <Box
        component="pre"
        sx={{
          m: 0, p: 2,
          bgcolor: alpha(theme.palette.common.black, 0.25),
          borderRadius: lang ? '0 0 8px 8px' : 2,
          overflow: 'auto',
          fontSize: 13,
          lineHeight: 1.6,
          fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
          '& code': { fontFamily: 'inherit' },
        }}
      >
        <code>{code}</code>
      </Box>
      {!lang && (
        <Tooltip title={copied ? 'Copied!' : 'Copy'}>
          <IconButton
            size="small"
            onClick={handleCopy}
            sx={{ position: 'absolute', top: 6, right: 6, color: 'text.disabled', opacity: 0.5, '&:hover': { opacity: 1 } }}
          >
            <ContentCopyIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Markdown table renderer
// ---------------------------------------------------------------------------

function MarkdownTable({ rows }: { rows: string[][] }) {
  const theme = useTheme();
  if (rows.length < 2) return null;

  const headers = rows[0];
  // Skip the separator row (row 1 with dashes)
  const dataRows = rows.slice(2).filter(r => r.some(c => c.trim()));

  return (
    <Box sx={{
      my: 1.5, overflow: 'auto',
      borderRadius: 2,
      border: '1px solid',
      borderColor: 'divider',
    }}>
      <Box component="table" sx={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '0.85rem',
        '& th, & td': {
          px: 1.5, py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          textAlign: 'left',
          whiteSpace: 'nowrap',
        },
        '& th': {
          fontWeight: 600,
          bgcolor: alpha(theme.palette.common.white, 0.04),
          color: 'text.primary',
          fontSize: '0.8rem',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        },
        '& tr:last-child td': { borderBottom: 'none' },
        '& tr:hover td': { bgcolor: alpha(theme.palette.common.white, 0.02) },
      }}>
        <thead>
          <tr>
            {headers.map((h, i) => <th key={i}><InlineFormatted text={h.trim()} /></th>)}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ whiteSpace: 'normal' }}>
                  <InlineFormatted text={cell.trim()} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Inline formatting (bold, italic, code, links)
// ---------------------------------------------------------------------------

function InlineFormatted({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)<>\]]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          const inner = part.slice(2, -2);
          if (/^https?:\/\//.test(inner)) {
            return <a key={i} href={inner.replace(/[.,;:!?'")\]]+$/, '')} target="_blank" rel="noopener noreferrer" style={{ color: '#90caf9', fontWeight: 700, wordBreak: 'break-all' }}>{inner}</a>;
          }
          return <strong key={i}><InlineFormatted text={inner} /></strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <Box key={i} component="code" sx={{
              bgcolor: 'rgba(255,255,255,0.06)', px: 0.6, py: 0.2,
              borderRadius: 0.5, fontSize: '0.87em',
              fontFamily: '"JetBrains Mono", monospace',
            }}>
              {part.slice(1, -1)}
            </Box>
          );
        }
        if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
          const inner = part.slice(1, -1);
          if (/^https?:\/\//.test(inner)) {
            return <a key={i} href={inner.replace(/[.,;:!?'")\]]+$/, '')} target="_blank" rel="noopener noreferrer" style={{ color: '#90caf9', fontStyle: 'italic', wordBreak: 'break-all' }}>{inner}</a>;
          }
          return <em key={i}><InlineFormatted text={inner} /></em>;
        }
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return <a key={i} href={linkMatch[2].replace(/[.,;:!?'")\]]+$/, '')} target="_blank" rel="noopener noreferrer" style={{ color: '#90caf9' }}>{linkMatch[1]}</a>;
        }
        if (/^https?:\/\//.test(part)) {
          const cleaned = part.replace(/[.,;:!?'")\]]+$/, '');
          return <a key={i} href={cleaned} target="_blank" rel="noopener noreferrer" style={{ color: '#90caf9', wordBreak: 'break-all' }}>{cleaned}</a>;
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Block-level markdown parser
// ---------------------------------------------------------------------------

interface MarkdownBlock {
  type: 'paragraph' | 'heading' | 'code' | 'chart' | 'mermaid' | 'table' | 'list' | 'blockquote' | 'hr';
  content: string;
  level?: number;          // heading level (1-6)
  lang?: string;           // code block language
  ordered?: boolean;       // list type
  items?: string[];        // list items
  rows?: string[][];       // table rows
  chartSpec?: ChartSpec;   // parsed chart spec
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Code block (```) ──
    if (line.trimStart().startsWith('```')) {
      const indent = line.indexOf('```');
      const langLine = line.slice(indent + 3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const code = codeLines.join('\n');

      if (langLine === 'chart' || langLine === 'json chart') {
        try {
          const spec = JSON.parse(code) as ChartSpec;
          blocks.push({ type: 'chart', content: code, chartSpec: spec });
        } catch {
          blocks.push({ type: 'code', content: code, lang: langLine || 'json' });
        }
      } else if (langLine === 'mermaid') {
        blocks.push({ type: 'mermaid', content: code });
      } else {
        blocks.push({ type: 'code', content: code, lang: langLine });
      }
      continue;
    }

    // ── Heading (# ... ######) ──
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        content: headingMatch[2].replace(/\s+#+\s*$/, ''), // strip trailing #s
        level: headingMatch[1].length,
      });
      i++;
      continue;
    }

    // ── Horizontal rule (---, ***, ___) ──
    if (/^\s*([-*_]){3,}\s*$/.test(line)) {
      blocks.push({ type: 'hr', content: '' });
      i++;
      continue;
    }

    // ── Table (| ... | ... |) ──
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*[-:]+[-|:\s]+\s*\|?\s*$/.test(lines[i + 1])) {
      const tableRows: string[][] = [];
      while (i < lines.length && lines[i].includes('|')) {
        const cells = lines[i].split('|').map(c => c.trim()).filter((_, ci, arr) => {
          // Filter out empty first/last cells from leading/trailing pipes
          if (ci === 0 && arr[ci] === '') return false;
          if (ci === arr.length - 1 && arr[ci] === '') return false;
          return true;
        });
        tableRows.push(cells);
        i++;
      }
      blocks.push({ type: 'table', content: '', rows: tableRows });
      continue;
    }

    // ── Blockquote (> ...) ──
    if (line.trimStart().startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].trimStart().startsWith('> ') || lines[i].trimStart().startsWith('>'))) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', content: quoteLines.join('\n') });
      continue;
    }

    // ── Unordered list (- or *) ──
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', content: '', ordered: false, items });
      continue;
    }

    // ── Ordered list (1. 2. etc.) ──
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', content: '', ordered: true, items });
      continue;
    }

    // ── Empty line (skip) ──
    if (!line.trim()) {
      i++;
      continue;
    }

    // ── Paragraph (collect consecutive non-empty lines) ──
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trimStart().startsWith('```') &&
      !lines[i].match(/^#{1,6}\s+/) &&
      !/^\s*([-*_]){3,}\s*$/.test(lines[i]) &&
      !lines[i].trimStart().startsWith('> ') &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      // Don't consume table lines
      !(lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?\s*[-:]+[-|:\s]+/.test(lines[i + 1] ?? ''))
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', content: paraLines.join('\n') });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Main RichMarkdown component
// ---------------------------------------------------------------------------

export default function RichMarkdown({ content }: { content: string }) {
  const theme = useTheme();
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  return (
    <Box sx={{ '& > *:first-of-type': { mt: 0 }, '& > *:last-child': { mb: 0 } }}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading': {
            const variant = block.level === 1 ? 'h5'
              : block.level === 2 ? 'h6'
              : 'subtitle1';
            const sx = block.level === 1
              ? { fontWeight: 800, mt: 3, mb: 1.5, color: 'text.primary', borderBottom: '1px solid', borderColor: 'divider', pb: 0.75 }
              : block.level === 2
                ? { fontWeight: 700, mt: 2.5, mb: 1, color: 'text.primary' }
                : { fontWeight: 600, mt: 2, mb: 0.75, color: 'text.secondary' };
            return (
              <Typography key={i} variant={variant} sx={sx}>
                <InlineFormatted text={block.content} />
              </Typography>
            );
          }

          case 'paragraph':
            return (
              <Typography key={i} variant="body2" sx={{ mb: 1.5, lineHeight: 1.75, color: 'text.primary' }}>
                <InlineFormatted text={block.content} />
              </Typography>
            );

          case 'code':
            return <CodeBlock key={i} lang={block.lang ?? ''} code={block.content} />;

          case 'chart':
            return block.chartSpec ? <ChartRenderer key={i} spec={block.chartSpec} /> : null;

          case 'mermaid':
            return <MermaidDiagram key={i} code={block.content} />;

          case 'table':
            return block.rows ? <MarkdownTable key={i} rows={block.rows} /> : null;

          case 'list':
            return (
              <Box
                key={i}
                component={block.ordered ? 'ol' : 'ul'}
                sx={{
                  my: 1, pl: 3,
                  '& li': { mb: 0.5, lineHeight: 1.7, fontSize: '0.875rem', color: 'text.primary' },
                  '& li::marker': { color: 'text.secondary' },
                }}
              >
                {block.items?.map((item, j) => (
                  <li key={j}><InlineFormatted text={item} /></li>
                ))}
              </Box>
            );

          case 'blockquote':
            return (
              <Box key={i} sx={{
                my: 1.5, pl: 2, py: 0.5,
                borderLeft: '3px solid',
                borderColor: 'primary.main',
                bgcolor: alpha(theme.palette.primary.main, 0.04),
                borderRadius: '0 8px 8px 0',
              }}>
                <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic', lineHeight: 1.7 }}>
                  <InlineFormatted text={block.content} />
                </Typography>
              </Box>
            );

          case 'hr':
            return (
              <Box key={i} sx={{
                my: 2, height: '1px',
                background: `linear-gradient(90deg, transparent, ${alpha(theme.palette.common.white, 0.15)}, transparent)`,
              }} />
            );

          default:
            return null;
        }
      })}
    </Box>
  );
}

/**
 * Export the InlineFormatted component for use by other components
 * that only need inline markdown formatting without block-level parsing.
 */
export { InlineFormatted };
