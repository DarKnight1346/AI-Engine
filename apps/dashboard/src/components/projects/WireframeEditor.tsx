'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  Box, Typography, Button, Stack, TextField, IconButton, Chip,
  Dialog, DialogContent, Divider, Select, MenuItem, Tooltip,
  alpha, useTheme, InputLabel, FormControl, Autocomplete,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import GridOnIcon from '@mui/icons-material/GridOn';
import SmartButtonIcon from '@mui/icons-material/SmartButton';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import InputIcon from '@mui/icons-material/Input';
import ImageIcon from '@mui/icons-material/Image';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import MenuIcon from '@mui/icons-material/Menu';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import ArrowDropDownCircleIcon from '@mui/icons-material/ArrowDropDownCircle';
import ToggleOnIcon from '@mui/icons-material/ToggleOn';
import SearchIcon from '@mui/icons-material/Search';
import TabIcon from '@mui/icons-material/Tab';
import TableChartIcon from '@mui/icons-material/TableChart';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import TitleIcon from '@mui/icons-material/Title';
import WidgetsIcon from '@mui/icons-material/Widgets';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';
import DynamicFeedIcon from '@mui/icons-material/DynamicFeed';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import ListAltIcon from '@mui/icons-material/ListAlt';
import StarBorderIcon from '@mui/icons-material/StarBorder';

// ── Types ──

export interface WireframeElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  wireframeRefId?: string;
  props?: Record<string, unknown>;
}

export interface Wireframe {
  id?: string;
  projectId: string;
  name: string;
  description?: string;
  wireframeType: string;
  elements: WireframeElement[];
  featureTags: string[];
  canvasWidth: number;
  canvasHeight: number;
  sortOrder?: number;
  contains?: string[];
  usedIn?: string[];
}

interface WireframeEditorProps {
  open: boolean;
  onClose: () => void;
  onSave: (wireframe: Wireframe) => Promise<void>;
  wireframe: Wireframe | null;
  allWireframes: Wireframe[];
  existingFeatureTags: string[];
}

// ── Primitive Palette Definition ──

interface PrimitiveDef {
  type: string;
  label: string;
  icon: React.ReactNode;
  defaultWidth: number;
  defaultHeight: number;
  category: string;
}

const PRIMITIVES: PrimitiveDef[] = [
  { type: 'container', label: 'Container', icon: <CropSquareIcon fontSize="small" />, defaultWidth: 300, defaultHeight: 200, category: 'Layout' },
  { type: 'card', label: 'Card', icon: <ViewModuleIcon fontSize="small" />, defaultWidth: 280, defaultHeight: 180, category: 'Layout' },
  { type: 'divider', label: 'Divider', icon: <HorizontalRuleIcon fontSize="small" />, defaultWidth: 300, defaultHeight: 4, category: 'Layout' },
  { type: 'tabs', label: 'Tabs', icon: <TabIcon fontSize="small" />, defaultWidth: 300, defaultHeight: 40, category: 'Layout' },
  { type: 'button', label: 'Button', icon: <SmartButtonIcon fontSize="small" />, defaultWidth: 120, defaultHeight: 40, category: 'Input' },
  { type: 'textInput', label: 'Text Input', icon: <InputIcon fontSize="small" />, defaultWidth: 220, defaultHeight: 40, category: 'Input' },
  { type: 'textarea', label: 'Textarea', icon: <InputIcon fontSize="small" />, defaultWidth: 280, defaultHeight: 100, category: 'Input' },
  { type: 'dropdown', label: 'Dropdown', icon: <ArrowDropDownCircleIcon fontSize="small" />, defaultWidth: 180, defaultHeight: 40, category: 'Input' },
  { type: 'checkbox', label: 'Checkbox', icon: <CheckBoxIcon fontSize="small" />, defaultWidth: 140, defaultHeight: 30, category: 'Input' },
  { type: 'toggle', label: 'Toggle', icon: <ToggleOnIcon fontSize="small" />, defaultWidth: 60, defaultHeight: 30, category: 'Input' },
  { type: 'searchBar', label: 'Search Bar', icon: <SearchIcon fontSize="small" />, defaultWidth: 280, defaultHeight: 40, category: 'Input' },
  { type: 'text', label: 'Text', icon: <TextFieldsIcon fontSize="small" />, defaultWidth: 200, defaultHeight: 24, category: 'Display' },
  { type: 'heading', label: 'Heading', icon: <TitleIcon fontSize="small" />, defaultWidth: 280, defaultHeight: 36, category: 'Display' },
  { type: 'image', label: 'Image', icon: <ImageIcon fontSize="small" />, defaultWidth: 200, defaultHeight: 150, category: 'Display' },
  { type: 'avatar', label: 'Avatar', icon: <AccountCircleIcon fontSize="small" />, defaultWidth: 48, defaultHeight: 48, category: 'Display' },
  { type: 'icon', label: 'Icon', icon: <StarBorderIcon fontSize="small" />, defaultWidth: 32, defaultHeight: 32, category: 'Display' },
  { type: 'list', label: 'List', icon: <ListAltIcon fontSize="small" />, defaultWidth: 260, defaultHeight: 180, category: 'Display' },
  { type: 'table', label: 'Table', icon: <TableChartIcon fontSize="small" />, defaultWidth: 400, defaultHeight: 200, category: 'Display' },
  { type: 'navbar', label: 'Nav Bar', icon: <MenuIcon fontSize="small" />, defaultWidth: 800, defaultHeight: 56, category: 'Navigation' },
  { type: 'sidebar', label: 'Sidebar', icon: <ViewSidebarIcon fontSize="small" />, defaultWidth: 240, defaultHeight: 500, category: 'Navigation' },
  { type: 'form', label: 'Form', icon: <DynamicFeedIcon fontSize="small" />, defaultWidth: 320, defaultHeight: 280, category: 'Layout' },
];

const CATEGORIES = ['Layout', 'Input', 'Display', 'Navigation'];

const GRID_SIZE = 16;
const snap = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE;

let _nextId = 1;
function genId() {
  return `el_${Date.now()}_${_nextId++}`;
}

// ── SVG element renderers ──

function renderPrimitiveElement(
  el: WireframeElement,
  isSelected: boolean,
  accentColor: string,
) {
  const { x, y, width: w, height: h, type, label } = el;

  const baseStroke = isSelected ? accentColor : 'rgba(148,163,184,0.45)';
  const baseFill = isSelected ? `${accentColor}15` : 'rgba(255,255,255,0.04)';
  const sw = isSelected ? 2 : 1;

  switch (type) {
    case 'button':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={6} fill={isSelected ? `${accentColor}25` : 'rgba(99,102,241,0.18)'} stroke={baseStroke} strokeWidth={sw} />
          <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fill="#c7d2fe" fontSize={12} fontWeight={600} fontFamily='"Inter", sans-serif'>{label || 'Button'}</text>
        </g>
      );
    case 'textInput':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={4} fill={baseFill} stroke={baseStroke} strokeWidth={sw} />
          <text x={x + 10} y={y + h / 2 + 4} fill="rgba(148,163,184,0.6)" fontSize={12} fontFamily='"Inter", sans-serif'>{label || 'Text input...'}</text>
          <line x1={x + 10} y1={y + h - 8} x2={x + w - 10} y2={y + h - 8} stroke="rgba(148,163,184,0.2)" strokeWidth={1} />
        </g>
      );
    case 'textarea':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={4} fill={baseFill} stroke={baseStroke} strokeWidth={sw} />
          <text x={x + 10} y={y + 20} fill="rgba(148,163,184,0.6)" fontSize={12} fontFamily='"Inter", sans-serif'>{label || 'Textarea...'}</text>
          {[1, 2, 3].map((i) => <line key={i} x1={x + 10} y1={y + 14 + i * 18} x2={x + w - 10} y2={y + 14 + i * 18} stroke="rgba(148,163,184,0.1)" strokeWidth={1} />)}
        </g>
      );
    case 'heading':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={2} fill="transparent" stroke={isSelected ? baseStroke : 'transparent'} strokeWidth={sw} strokeDasharray={isSelected ? 'none' : '4 2'} />
          <text x={x + 4} y={y + h / 2 + 6} fill="#e2e8f0" fontSize={18} fontWeight={700} fontFamily='"Inter", sans-serif'>{label || 'Heading'}</text>
        </g>
      );
    case 'text':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={2} fill="transparent" stroke={isSelected ? baseStroke : 'transparent'} strokeWidth={sw} strokeDasharray={isSelected ? 'none' : '4 2'} />
          <text x={x + 4} y={y + h / 2 + 4} fill="rgba(148,163,184,0.8)" fontSize={13} fontFamily='"Inter", sans-serif'>{label || 'Text label'}</text>
        </g>
      );
    case 'image':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={4} fill={baseFill} stroke={baseStroke} strokeWidth={sw} />
          <line x1={x} y1={y} x2={x + w} y2={y + h} stroke="rgba(148,163,184,0.15)" strokeWidth={1} />
          <line x1={x + w} y1={y} x2={x} y2={y + h} stroke="rgba(148,163,184,0.15)" strokeWidth={1} />
          <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fill="rgba(148,163,184,0.5)" fontSize={11} fontFamily='"Inter", sans-serif'>{label || 'Image'}</text>
        </g>
      );
    case 'avatar':
      return (
        <g>
          <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2} fill="rgba(99,102,241,0.15)" stroke={baseStroke} strokeWidth={sw} />
          <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fill="rgba(148,163,184,0.6)" fontSize={9} fontFamily='"Inter", sans-serif'>{label?.[0] || 'A'}</text>
        </g>
      );
    case 'icon':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={4} fill={baseFill} stroke={baseStroke} strokeWidth={sw} />
          <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fill="rgba(148,163,184,0.6)" fontSize={14}>&#9733;</text>
        </g>
      );
    case 'card':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={8} fill="rgba(255,255,255,0.03)" stroke={baseStroke} strokeWidth={sw} />
          <line x1={x + 12} y1={y + 30} x2={x + w - 12} y2={y + 30} stroke="rgba(148,163,184,0.15)" strokeWidth={1} />
          <text x={x + 12} y={y + 20} fill="#cbd5e1" fontSize={12} fontWeight={600} fontFamily='"Inter", sans-serif'>{label || 'Card'}</text>
        </g>
      );
    case 'container':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={4} fill="transparent" stroke={baseStroke} strokeWidth={sw} strokeDasharray="6 3" />
          <text x={x + 8} y={y + 16} fill="rgba(148,163,184,0.4)" fontSize={10} fontFamily='"Inter", sans-serif'>{label || 'Container'}</text>
        </g>
      );
    case 'navbar':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={0} fill="rgba(15,23,42,0.6)" stroke={baseStroke} strokeWidth={sw} />
          <text x={x + 16} y={y + h / 2 + 5} fill="#e2e8f0" fontSize={14} fontWeight={700} fontFamily='"Inter", sans-serif'>{label || 'Logo'}</text>
          {[1, 2, 3].map((i) => <rect key={i} x={x + w - 40 * i} y={y + h / 2 - 6} width={30} height={12} rx={2} fill="rgba(148,163,184,0.12)" />)}
        </g>
      );
    case 'sidebar':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={0} fill="rgba(15,23,42,0.4)" stroke={baseStroke} strokeWidth={sw} />
          <text x={x + 12} y={y + 24} fill="#cbd5e1" fontSize={11} fontWeight={600} fontFamily='"Inter", sans-serif'>{label || 'Sidebar'}</text>
          {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={x + 12} y={y + 40 + i * 32} width={w - 24} height={24} rx={4} fill="rgba(148,163,184,0.06)" />)}
        </g>
      );
    case 'list':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={4} fill={baseFill} stroke={baseStroke} strokeWidth={sw} />
          {Array.from({ length: Math.min(5, Math.floor(h / 32)) }).map((_, i) => (
            <g key={i}>
              <rect x={x + 8} y={y + 8 + i * 32} width={w - 16} height={24} rx={3} fill="rgba(148,163,184,0.06)" />
            </g>
          ))}
          <text x={x + 16} y={y + 24} fill="rgba(148,163,184,0.5)" fontSize={10} fontFamily='"Inter", sans-serif'>{label || 'List'}</text>
        </g>
      );
    case 'table':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={4} fill={baseFill} stroke={baseStroke} strokeWidth={sw} />
          <rect x={x} y={y} width={w} height={28} rx={4} fill="rgba(148,163,184,0.08)" />
          {[0, 1, 2].map((i) => <line key={`v${i}`} x1={x + (w / 3) * (i + 1)} y1={y} x2={x + (w / 3) * (i + 1)} y2={y + h} stroke="rgba(148,163,184,0.1)" strokeWidth={1} />)}
          {Array.from({ length: Math.min(5, Math.floor(h / 28)) }).map((_, i) => (
            <line key={`h${i}`} x1={x} y1={y + 28 + i * 28} x2={x + w} y2={y + 28 + i * 28} stroke="rgba(148,163,184,0.1)" strokeWidth={1} />
          ))}
          <text x={x + 12} y={y + 18} fill="#cbd5e1" fontSize={10} fontWeight={600} fontFamily='"Inter", sans-serif'>{label || 'Table'}</text>
        </g>
      );
    case 'divider':
      return (
        <g>
          <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke={baseStroke} strokeWidth={sw} />
        </g>
      );
    case 'tabs':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={0} fill={baseFill} stroke={baseStroke} strokeWidth={sw} />
          {(label || 'Tab 1,Tab 2,Tab 3').split(',').slice(0, 4).map((tab, i) => (
            <g key={i}>
              <text x={x + 16 + i * 80} y={y + h / 2 + 4} fill={i === 0 ? '#818cf8' : 'rgba(148,163,184,0.5)'} fontSize={11} fontWeight={i === 0 ? 600 : 400} fontFamily='"Inter", sans-serif'>{tab.trim()}</text>
              {i === 0 && <line x1={x + 12 + i * 80} y1={y + h - 2} x2={x + 12 + i * 80 + 50} y2={y + h - 2} stroke="#818cf8" strokeWidth={2} />}
            </g>
          ))}
        </g>
      );
    case 'dropdown':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={4} fill={baseFill} stroke={baseStroke} strokeWidth={sw} />
          <text x={x + 10} y={y + h / 2 + 4} fill="rgba(148,163,184,0.6)" fontSize={12} fontFamily='"Inter", sans-serif'>{label || 'Select...'}</text>
          <text x={x + w - 20} y={y + h / 2 + 4} fill="rgba(148,163,184,0.4)" fontSize={12}>&#9662;</text>
        </g>
      );
    case 'checkbox':
      return (
        <g>
          <rect x={x} y={y + (h - 16) / 2} width={16} height={16} rx={3} fill="transparent" stroke={baseStroke} strokeWidth={sw} />
          <text x={x + 24} y={y + h / 2 + 4} fill="rgba(148,163,184,0.8)" fontSize={12} fontFamily='"Inter", sans-serif'>{label || 'Checkbox'}</text>
        </g>
      );
    case 'toggle':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={h / 2} fill="rgba(99,102,241,0.2)" stroke={baseStroke} strokeWidth={sw} />
          <circle cx={x + w - h / 2} cy={y + h / 2} r={h / 2 - 4} fill="#818cf8" />
        </g>
      );
    case 'searchBar':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={baseFill} stroke={baseStroke} strokeWidth={sw} />
          <text x={x + 36} y={y + h / 2 + 4} fill="rgba(148,163,184,0.5)" fontSize={12} fontFamily='"Inter", sans-serif'>{label || 'Search...'}</text>
          <text x={x + 14} y={y + h / 2 + 5} fill="rgba(148,163,184,0.4)" fontSize={14}>&#128269;</text>
        </g>
      );
    case 'form':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={8} fill="rgba(255,255,255,0.02)" stroke={baseStroke} strokeWidth={sw} strokeDasharray="6 3" />
          <text x={x + 12} y={y + 20} fill="rgba(148,163,184,0.5)" fontSize={10} fontWeight={600} fontFamily='"Inter", sans-serif'>{label || 'Form'}</text>
        </g>
      );
    default:
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={4} fill={baseFill} stroke={baseStroke} strokeWidth={sw} />
          <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fill="rgba(148,163,184,0.6)" fontSize={11} fontFamily='"Inter", sans-serif'>{label || type}</text>
        </g>
      );
  }
}

function renderWireframeRefElement(
  el: WireframeElement,
  isSelected: boolean,
  accentColor: string,
  refWireframe: Wireframe | undefined,
) {
  const { x, y, width: w, height: h, label } = el;
  const refName = refWireframe?.name || label || 'Component';

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill="rgba(99,102,241,0.06)" stroke={isSelected ? accentColor : '#818cf8'} strokeWidth={isSelected ? 2 : 1.5} strokeDasharray="6 4" />
      {/* Render miniature preview of referenced wireframe elements */}
      {refWireframe && refWireframe.elements.length > 0 && (() => {
        const scaleX = w / refWireframe.canvasWidth;
        const scaleY = h / refWireframe.canvasHeight;
        const s = Math.min(scaleX, scaleY) * 0.85;
        const ox = x + (w - refWireframe.canvasWidth * s) / 2;
        const oy = y + 18 + (h - 18 - refWireframe.canvasHeight * s) / 2;
        return (
          <g opacity={0.5} transform={`translate(${ox},${oy}) scale(${s})`}>
            {refWireframe.elements.map((child) => (
              <g key={child.id}>
                {renderPrimitiveElement(child, false, '#818cf8')}
              </g>
            ))}
          </g>
        );
      })()}
      {/* Label bar */}
      <rect x={x} y={y} width={w} height={18} rx={6} fill="rgba(99,102,241,0.18)" />
      <text x={x + 6} y={y + 13} fill="#a5b4fc" fontSize={10} fontWeight={600} fontFamily='"Inter", sans-serif'>
        {refName.length > 30 ? refName.slice(0, 28) + '\u2026' : refName}
      </text>
      <text x={x + w - 6} y={y + 13} textAnchor="end" fill="rgba(165,180,252,0.5)" fontSize={8} fontFamily='"Inter", sans-serif'>REF</text>
    </g>
  );
}

// ── Main Component ──

export default function WireframeEditor({
  open, onClose, onSave, wireframe, allWireframes, existingFeatureTags,
}: WireframeEditorProps) {
  const theme = useTheme();

  // Wireframe metadata
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [wireframeType, setWireframeType] = useState('component');
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [canvasHeight, setCanvasHeight] = useState(600);
  const [featureTags, setFeatureTags] = useState<string[]>([]);

  // Elements
  const [elements, setElements] = useState<WireframeElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<WireframeElement[][]>([]);
  const [redoStack, setRedoStack] = useState<WireframeElement[][]>([]);

  // Canvas interaction
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; elStartX: number; elStartY: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; handle: string; startMx: number; startMy: number; startX: number; startY: number; startW: number; startH: number } | null>(null);
  const [panning, setPanning] = useState<{ startMx: number; startMy: number; startPanX: number; startPanY: number } | null>(null);
  const [paletteDrag, setPaletteDrag] = useState<{ type: string; wireframeRefId?: string; defaultWidth: number; defaultHeight: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);

  // Initialize from prop
  useEffect(() => {
    if (open && wireframe) {
      setName(wireframe.name);
      setDescription(wireframe.description || '');
      setWireframeType(wireframe.wireframeType);
      setCanvasWidth(wireframe.canvasWidth);
      setCanvasHeight(wireframe.canvasHeight);
      setFeatureTags(Array.isArray(wireframe.featureTags) ? wireframe.featureTags : []);
      setElements(wireframe.elements || []);
      setSelectedIds(new Set());
      setUndoStack([]);
      setRedoStack([]);
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
    } else if (open && !wireframe) {
      setName('');
      setDescription('');
      setWireframeType('component');
      setCanvasWidth(800);
      setCanvasHeight(600);
      setFeatureTags([]);
      setElements([]);
      setSelectedIds(new Set());
      setUndoStack([]);
      setRedoStack([]);
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
    }
  }, [open, wireframe]);

  // Undo/redo helpers
  const pushUndo = useCallback((prev: WireframeElement[]) => {
    setUndoStack((s) => [...s.slice(-30), prev]);
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1];
      setRedoStack((r) => [...r, elements]);
      setElements(prev);
      return stack.slice(0, -1);
    });
  }, [elements]);

  const handleRedo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      setUndoStack((u) => [...u, elements]);
      setElements(next);
      return stack.slice(0, -1);
    });
  }, [elements]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        pushUndo(elements);
        setElements((els) => els.filter((el) => !selectedIds.has(el.id)));
        setSelectedIds(new Set());
      }
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); handleUndo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); handleRedo(); }
      // Arrow nudge
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedIds.size > 0) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -GRID_SIZE : e.key === 'ArrowRight' ? GRID_SIZE : 0;
        const dy = e.key === 'ArrowUp' ? -GRID_SIZE : e.key === 'ArrowDown' ? GRID_SIZE : 0;
        pushUndo(elements);
        setElements((els) => els.map((el) => selectedIds.has(el.id) ? { ...el, x: el.x + dx, y: el.y + dy } : el));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, selectedIds, elements, pushUndo, handleUndo, handleRedo]);

  // SVG coordinate helper
  const svgPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoom - panOffset.x,
      y: (clientY - rect.top) / zoom - panOffset.y,
    };
  }, [zoom, panOffset]);

  // Wireframe ref map for rendering
  const wireframeMap = useMemo(() => {
    const m = new Map<string, Wireframe>();
    for (const wf of allWireframes) {
      if (wf.id) m.set(wf.id, wf);
    }
    return m;
  }, [allWireframes]);

  // Available wireframes to nest (exclude self)
  const nestableWireframes = useMemo(
    () => allWireframes.filter((wf) => wf.id && wf.id !== wireframe?.id),
    [allWireframes, wireframe],
  );

  // Selected element (for properties panel)
  const selectedElement = useMemo(() => {
    if (selectedIds.size !== 1) return null;
    const id = [...selectedIds][0];
    return elements.find((el) => el.id === id) || null;
  }, [selectedIds, elements]);

  // Mouse handlers for canvas
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const pt = svgPoint(e.clientX, e.clientY);

    // Check if clicking on a resize handle (8x8 corners on selected elements)
    if (selectedIds.size === 1) {
      const sel = elements.find((el) => selectedIds.has(el.id));
      if (sel) {
        const handles = [
          { name: 'se', hx: sel.x + sel.width, hy: sel.y + sel.height },
          { name: 'sw', hx: sel.x, hy: sel.y + sel.height },
          { name: 'ne', hx: sel.x + sel.width, hy: sel.y },
          { name: 'nw', hx: sel.x, hy: sel.y },
        ];
        for (const h of handles) {
          if (Math.abs(pt.x - h.hx) < 8 && Math.abs(pt.y - h.hy) < 8) {
            setResizing({
              id: sel.id, handle: h.name,
              startMx: pt.x, startMy: pt.y,
              startX: sel.x, startY: sel.y, startW: sel.width, startH: sel.height,
            });
            pushUndo(elements);
            return;
          }
        }
      }
    }

    // Check if clicking on an element
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (pt.x >= el.x && pt.x <= el.x + el.width && pt.y >= el.y && pt.y <= el.y + el.height) {
        if (e.shiftKey) {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(el.id)) next.delete(el.id); else next.add(el.id);
            return next;
          });
        } else {
          if (!selectedIds.has(el.id)) setSelectedIds(new Set([el.id]));
        }
        setDragging({ id: el.id, startX: pt.x, startY: pt.y, elStartX: el.x, elStartY: el.y });
        pushUndo(elements);
        return;
      }
    }

    // Click empty space → deselect or start pan
    setSelectedIds(new Set());
    setPanning({ startMx: e.clientX, startMy: e.clientY, startPanX: panOffset.x, startPanY: panOffset.y });
  }, [elements, selectedIds, svgPoint, panOffset, pushUndo]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (dragging) {
      const pt = svgPoint(e.clientX, e.clientY);
      const dx = snap(pt.x - dragging.startX);
      const dy = snap(pt.y - dragging.startY);
      setElements((els) =>
        els.map((el) => {
          if (selectedIds.has(el.id) || el.id === dragging.id) {
            const base = el.id === dragging.id
              ? { x: dragging.elStartX, y: dragging.elStartY }
              : { x: el.x, y: el.y };
            return { ...el, x: base.x + dx, y: base.y + dy };
          }
          return el;
        }),
      );
    } else if (resizing) {
      const pt = svgPoint(e.clientX, e.clientY);
      const dx = pt.x - resizing.startMx;
      const dy = pt.y - resizing.startMy;
      setElements((els) =>
        els.map((el) => {
          if (el.id !== resizing.id) return el;
          let { startX: nx, startY: ny, startW: nw, startH: nh } = resizing;
          if (resizing.handle.includes('e')) nw = snap(Math.max(24, nw + dx));
          if (resizing.handle.includes('w')) { const d = snap(dx); nx += d; nw -= d; if (nw < 24) { nx -= 24 - nw; nw = 24; } }
          if (resizing.handle.includes('s')) nh = snap(Math.max(16, nh + dy));
          if (resizing.handle.includes('n')) { const d = snap(dy); ny += d; nh -= d; if (nh < 16) { ny -= 16 - nh; nh = 16; } }
          return { ...el, x: nx, y: ny, width: nw, height: nh };
        }),
      );
    } else if (panning) {
      const dx = (e.clientX - panning.startMx) / zoom;
      const dy = (e.clientY - panning.startMy) / zoom;
      setPanOffset({ x: panning.startPanX + dx, y: panning.startPanY + dy });
    }
  }, [dragging, resizing, panning, selectedIds, svgPoint, zoom]);

  const handleCanvasMouseUp = useCallback(() => {
    setDragging(null);
    setResizing(null);
    setPanning(null);
  }, []);

  // Zoom via scroll
  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.max(0.25, Math.min(3, z + delta)));
  }, []);

  // Drop from palette
  const handleCanvasDrop = useCallback((e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (!paletteDrag) return;
    const pt = svgPoint(e.clientX, e.clientY);
    const newEl: WireframeElement = {
      id: genId(),
      type: paletteDrag.wireframeRefId ? 'wireframeRef' : paletteDrag.type,
      x: snap(pt.x - paletteDrag.defaultWidth / 2),
      y: snap(pt.y - paletteDrag.defaultHeight / 2),
      width: paletteDrag.defaultWidth,
      height: paletteDrag.defaultHeight,
      label: paletteDrag.wireframeRefId
        ? (nestableWireframes.find((w) => w.id === paletteDrag.wireframeRefId)?.name || 'Component')
        : paletteDrag.type.charAt(0).toUpperCase() + paletteDrag.type.slice(1),
      wireframeRefId: paletteDrag.wireframeRefId,
    };
    pushUndo(elements);
    setElements((els) => [...els, newEl]);
    setSelectedIds(new Set([newEl.id]));
    setPaletteDrag(null);
  }, [paletteDrag, svgPoint, elements, pushUndo, nestableWireframes]);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);

  // Update selected element property
  const updateSelectedProp = useCallback((key: keyof WireframeElement, value: unknown) => {
    if (selectedIds.size !== 1) return;
    const id = [...selectedIds][0];
    pushUndo(elements);
    setElements((els) => els.map((el) => el.id === id ? { ...el, [key]: value } : el));
  }, [selectedIds, elements, pushUndo]);

  // Save handler
  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        id: wireframe?.id,
        projectId: wireframe?.projectId || '',
        name: name.trim(),
        description: description.trim() || undefined,
        wireframeType,
        elements,
        featureTags,
        canvasWidth,
        canvasHeight,
      });
      onClose();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth={false} fullScreen PaperProps={{ sx: { bgcolor: theme.palette.background.default } }}>
      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', height: '100vh' }}>
        {/* ── Toolbar ── */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, borderBottom: 1, borderColor: 'divider', bgcolor: alpha(theme.palette.background.paper, 0.5) }}>
          <IconButton onClick={onClose} size="small"><CloseIcon fontSize="small" /></IconButton>
          <Divider orientation="vertical" flexItem />

          <TextField size="small" value={name} onChange={(e) => setName(e.target.value)} placeholder="Wireframe name..." variant="standard" sx={{ width: 200, '& .MuiInput-input': { fontSize: 14, fontWeight: 600 } }} />

          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select value={wireframeType} onChange={(e) => setWireframeType(e.target.value)} variant="standard" sx={{ fontSize: 13 }}>
              <MenuItem value="page">Page</MenuItem>
              <MenuItem value="component">Component</MenuItem>
              <MenuItem value="modal">Modal</MenuItem>
              <MenuItem value="section">Section</MenuItem>
            </Select>
          </FormControl>

          <Divider orientation="vertical" flexItem />

          <Tooltip title="Undo (Ctrl+Z)"><span><IconButton size="small" onClick={handleUndo} disabled={undoStack.length === 0}><UndoIcon fontSize="small" /></IconButton></span></Tooltip>
          <Tooltip title="Redo (Ctrl+Y)"><span><IconButton size="small" onClick={handleRedo} disabled={redoStack.length === 0}><RedoIcon fontSize="small" /></IconButton></span></Tooltip>

          <Divider orientation="vertical" flexItem />

          <Tooltip title="Zoom Out"><IconButton size="small" onClick={() => setZoom((z) => Math.max(0.25, z - 0.15))}><ZoomOutIcon fontSize="small" /></IconButton></Tooltip>
          <Typography variant="caption" sx={{ minWidth: 40, textAlign: 'center', color: 'text.secondary' }}>{Math.round(zoom * 100)}%</Typography>
          <Tooltip title="Zoom In"><IconButton size="small" onClick={() => setZoom((z) => Math.min(3, z + 0.15))}><ZoomInIcon fontSize="small" /></IconButton></Tooltip>

          <Box sx={{ flex: 1 }} />

          <Typography variant="caption" color="text.secondary">{elements.length} elements</Typography>

          <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={handleSave} disabled={!name.trim() || saving} sx={{ ml: 1 }}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </Box>

        {/* ── Main Area ── */}
        <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* ── Left: Palette ── */}
          <Box sx={{ width: 220, flexShrink: 0, overflow: 'auto', borderRight: 1, borderColor: 'divider', bgcolor: alpha(theme.palette.background.paper, 0.3) }}>
            <Typography variant="caption" sx={{ px: 1.5, pt: 1.5, pb: 0.5, display: 'block', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.6 }}>
              Primitives
            </Typography>

            {CATEGORIES.map((cat) => (
              <Box key={cat} sx={{ mb: 1 }}>
                <Typography variant="caption" sx={{ px: 1.5, py: 0.5, display: 'block', color: 'text.disabled', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {cat}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, px: 1 }}>
                  {PRIMITIVES.filter((p) => p.category === cat).map((prim) => (
                    <Box
                      key={prim.type}
                      draggable
                      onDragStart={() => setPaletteDrag({ type: prim.type, defaultWidth: prim.defaultWidth, defaultHeight: prim.defaultHeight })}
                      onDragEnd={() => setPaletteDrag(null)}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 0.5,
                        px: 1, py: 0.5, borderRadius: 1,
                        border: '1px solid', borderColor: 'divider',
                        cursor: 'grab', fontSize: 11, color: 'text.secondary',
                        transition: 'all 0.12s ease',
                        '&:hover': { borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.06), color: 'text.primary' },
                        userSelect: 'none',
                      }}
                    >
                      {prim.icon}
                      <span>{prim.label}</span>
                    </Box>
                  ))}
                </Box>
              </Box>
            ))}

            {/* ── Project Components (for nesting) ── */}
            {nestableWireframes.length > 0 && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography variant="caption" sx={{ px: 1.5, pb: 0.5, display: 'block', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.6 }}>
                  Project Components
                </Typography>
                <Box sx={{ px: 1 }}>
                  {nestableWireframes.map((wf) => (
                    <Box
                      key={wf.id}
                      draggable
                      onDragStart={() => setPaletteDrag({ type: 'wireframeRef', wireframeRefId: wf.id!, defaultWidth: Math.min(wf.canvasWidth * 0.4, 300), defaultHeight: Math.min(wf.canvasHeight * 0.4, 200) })}
                      onDragEnd={() => setPaletteDrag(null)}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 0.75,
                        px: 1, py: 0.75, mb: 0.5, borderRadius: 1,
                        border: '1px dashed', borderColor: alpha('#818cf8', 0.3),
                        cursor: 'grab', fontSize: 11, color: '#a5b4fc',
                        transition: 'all 0.12s ease',
                        '&:hover': { borderColor: '#818cf8', bgcolor: alpha('#818cf8', 0.08) },
                        userSelect: 'none',
                      }}
                    >
                      <WidgetsIcon sx={{ fontSize: 14 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, lineHeight: 1.2 }} noWrap>{wf.name}</Typography>
                        <Typography variant="caption" sx={{ fontSize: 9, color: 'text.disabled' }}>{wf.wireframeType}</Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </>
            )}
          </Box>

          {/* ── Center: SVG Canvas ── */}
          <Box
            sx={{ flex: 1, overflow: 'hidden', position: 'relative', bgcolor: alpha(theme.palette.background.default, 0.8) }}
          >
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              viewBox={`${-panOffset.x} ${-panOffset.y} ${canvasWidth / zoom} ${canvasHeight / zoom}`}
              style={{ display: 'block', cursor: panning ? 'grabbing' : dragging ? 'move' : resizing ? (resizing.handle === 'se' || resizing.handle === 'nw' ? 'nwse-resize' : 'nesw-resize') : 'default' }}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
              onWheel={handleWheel}
              onDrop={handleCanvasDrop}
              onDragOver={handleDragOver}
            >
              <defs>
                <pattern id="wf-grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                  <circle cx={GRID_SIZE / 2} cy={GRID_SIZE / 2} r={0.5} fill="rgba(148,163,184,0.12)" />
                </pattern>
              </defs>

              {/* Canvas background */}
              <rect x={0} y={0} width={canvasWidth} height={canvasHeight} fill="rgba(15,23,42,0.3)" rx={4} />
              <rect x={0} y={0} width={canvasWidth} height={canvasHeight} fill="url(#wf-grid)" rx={4} />

              {/* Elements */}
              {elements.map((el) => {
                const isSelected = selectedIds.has(el.id);
                return (
                  <g key={el.id}>
                    {el.type === 'wireframeRef'
                      ? renderWireframeRefElement(el, isSelected, theme.palette.primary.main, el.wireframeRefId ? wireframeMap.get(el.wireframeRefId) : undefined)
                      : renderPrimitiveElement(el, isSelected, theme.palette.primary.main)
                    }
                    {/* Resize handles */}
                    {isSelected && selectedIds.size === 1 && (
                      <>
                        {[
                          { cx: el.x, cy: el.y },
                          { cx: el.x + el.width, cy: el.y },
                          { cx: el.x, cy: el.y + el.height },
                          { cx: el.x + el.width, cy: el.y + el.height },
                        ].map((h, i) => (
                          <rect
                            key={i}
                            x={h.cx - 4} y={h.cy - 4} width={8} height={8} rx={2}
                            fill={theme.palette.primary.main} stroke="#fff" strokeWidth={1}
                            style={{ cursor: i === 0 || i === 3 ? 'nwse-resize' : 'nesw-resize' }}
                          />
                        ))}
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          </Box>

          {/* ── Right: Properties ── */}
          <Box sx={{ width: 260, flexShrink: 0, overflow: 'auto', borderLeft: 1, borderColor: 'divider', bgcolor: alpha(theme.palette.background.paper, 0.3), p: 2 }}>
            {/* Wireframe properties */}
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.6, mb: 1, display: 'block' }}>
              Wireframe
            </Typography>

            <TextField size="small" fullWidth label="Description" value={description} onChange={(e) => setDescription(e.target.value)} multiline rows={2} sx={{ mb: 1.5, '& .MuiInputBase-input': { fontSize: 12 } }} />

            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              <TextField size="small" label="W" type="number" value={canvasWidth} onChange={(e) => setCanvasWidth(Number(e.target.value) || 800)} sx={{ '& .MuiInputBase-input': { fontSize: 12 } }} />
              <TextField size="small" label="H" type="number" value={canvasHeight} onChange={(e) => setCanvasHeight(Number(e.target.value) || 600)} sx={{ '& .MuiInputBase-input': { fontSize: 12 } }} />
            </Stack>

            <Divider sx={{ my: 1.5 }} />

            {/* Selected element properties */}
            {selectedElement ? (
              <>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.6, mb: 1, display: 'block' }}>
                  Element Properties
                </Typography>

                <TextField size="small" fullWidth label="Label" value={selectedElement.label} onChange={(e) => updateSelectedProp('label', e.target.value)} sx={{ mb: 1, '& .MuiInputBase-input': { fontSize: 12 } }} />

                {selectedElement.type !== 'wireframeRef' && (
                  <FormControl size="small" fullWidth sx={{ mb: 1 }}>
                    <InputLabel sx={{ fontSize: 12 }}>Type</InputLabel>
                    <Select value={selectedElement.type} label="Type" onChange={(e) => updateSelectedProp('type', e.target.value)} sx={{ fontSize: 12 }}>
                      {PRIMITIVES.map((p) => <MenuItem key={p.type} value={p.type} sx={{ fontSize: 12 }}>{p.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                )}

                {selectedElement.type === 'wireframeRef' && selectedElement.wireframeRefId && (
                  <Box sx={{ mb: 1, p: 1, borderRadius: 1, bgcolor: alpha('#818cf8', 0.08), border: '1px solid', borderColor: alpha('#818cf8', 0.2) }}>
                    <Typography variant="caption" sx={{ color: '#a5b4fc', fontWeight: 600 }}>
                      References: {wireframeMap.get(selectedElement.wireframeRefId)?.name || 'Unknown'}
                    </Typography>
                  </Box>
                )}

                <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                  <TextField size="small" label="X" type="number" value={selectedElement.x} onChange={(e) => updateSelectedProp('x', Number(e.target.value))} sx={{ '& .MuiInputBase-input': { fontSize: 12 } }} />
                  <TextField size="small" label="Y" type="number" value={selectedElement.y} onChange={(e) => updateSelectedProp('y', Number(e.target.value))} sx={{ '& .MuiInputBase-input': { fontSize: 12 } }} />
                </Stack>
                <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
                  <TextField size="small" label="W" type="number" value={selectedElement.width} onChange={(e) => updateSelectedProp('width', Math.max(16, Number(e.target.value)))} sx={{ '& .MuiInputBase-input': { fontSize: 12 } }} />
                  <TextField size="small" label="H" type="number" value={selectedElement.height} onChange={(e) => updateSelectedProp('height', Math.max(16, Number(e.target.value)))} sx={{ '& .MuiInputBase-input': { fontSize: 12 } }} />
                </Stack>

                <Button size="small" color="error" variant="outlined" startIcon={<DeleteIcon />} fullWidth onClick={() => {
                  pushUndo(elements);
                  setElements((els) => els.filter((el) => !selectedIds.has(el.id)));
                  setSelectedIds(new Set());
                }}>
                  Delete Element
                </Button>
              </>
            ) : (
              <Box sx={{ textAlign: 'center', py: 3, color: 'text.disabled' }}>
                <Typography variant="caption" display="block">Click an element to edit properties</Typography>
                <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>Drag from palette to add elements</Typography>
              </Box>
            )}

            <Divider sx={{ my: 2 }} />

            {/* Feature Tags */}
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.6, mb: 1, display: 'block' }}>
              Feature Tags
            </Typography>
            <Autocomplete
              multiple
              freeSolo
              size="small"
              value={featureTags}
              options={existingFeatureTags}
              onChange={(_, val) => setFeatureTags(val as string[])}
              renderTags={(value, getTagProps) =>
                value.map((tag, index) => (
                  <Chip {...getTagProps({ index })} key={tag} label={tag} size="small" sx={{ fontSize: 10, height: 22 }} />
                ))
              }
              renderInput={(params) => <TextField {...params} placeholder="Add feature tags..." sx={{ '& .MuiInputBase-input': { fontSize: 12 } }} />}
            />
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
