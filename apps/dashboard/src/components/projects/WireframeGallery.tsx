'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  Box, Typography, Button, Stack, Chip, IconButton, Card, CardContent,
  CardActionArea, alpha, useTheme, Tooltip, Dialog, DialogTitle,
  DialogContent, DialogActions, ToggleButtonGroup, ToggleButton,
  Menu, MenuItem, ListItemIcon, ListItemText,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import WidgetsIcon from '@mui/icons-material/Widgets';
import WebIcon from '@mui/icons-material/Web';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FilterListIcon from '@mui/icons-material/FilterList';
import type { Wireframe, WireframeElement } from './WireframeEditor';

interface WireframeGalleryProps {
  wireframes: Wireframe[];
  onEdit: (wireframe: Wireframe) => void;
  onCreate: () => void;
  onDelete: (wireframe: Wireframe, force?: boolean) => void;
  onDuplicate: (wireframe: Wireframe) => void;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  page: <WebIcon sx={{ fontSize: 14 }} />,
  component: <WidgetsIcon sx={{ fontSize: 14 }} />,
  modal: <OpenInNewIcon sx={{ fontSize: 14 }} />,
  section: <ViewModuleIcon sx={{ fontSize: 14 }} />,
};

const TYPE_COLORS: Record<string, string> = {
  page: '#38bdf8',
  component: '#818cf8',
  modal: '#f472b6',
  section: '#34d399',
};

function MiniaturePreview({ wireframe }: { wireframe: Wireframe }) {
  const elements = wireframe.elements || [];
  if (elements.length === 0) {
    return (
      <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <DashboardIcon sx={{ fontSize: 32, opacity: 0.15 }} />
      </Box>
    );
  }

  const { canvasWidth: cw, canvasHeight: ch } = wireframe;
  const vw = 260;
  const vh = 140;
  const scale = Math.min(vw / cw, vh / ch) * 0.9;

  return (
    <svg width={vw} height={vh} viewBox={`0 0 ${vw} ${vh}`}>
      <g transform={`translate(${(vw - cw * scale) / 2}, ${(vh - ch * scale) / 2}) scale(${scale})`}>
        {elements.map((el: WireframeElement) => {
          const color = el.type === 'wireframeRef' ? '#818cf8' : 'rgba(148,163,184,0.4)';
          const fill = el.type === 'wireframeRef' ? 'rgba(99,102,241,0.12)' : 'rgba(148,163,184,0.06)';
          const dash = el.type === 'wireframeRef' ? '4 3' : 'none';
          const isBtn = el.type === 'button';
          return (
            <g key={el.id}>
              <rect
                x={el.x} y={el.y} width={el.width} height={el.height}
                rx={isBtn ? 4 : el.type === 'avatar' ? el.width / 2 : 2}
                fill={isBtn ? 'rgba(99,102,241,0.2)' : fill}
                stroke={color}
                strokeWidth={1}
                strokeDasharray={dash}
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export default function WireframeGallery({ wireframes, onEdit, onCreate, onDelete, onDuplicate }: WireframeGalleryProps) {
  const theme = useTheme();
  const [filter, setFilter] = useState<string>('all');
  const [deleteDialog, setDeleteDialog] = useState<{ wireframe: Wireframe; referencedBy?: Array<{ id: string; name: string }> } | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; wireframe: Wireframe } | null>(null);

  const filtered = useMemo(() => {
    if (filter === 'all') return wireframes;
    return wireframes.filter((w) => w.wireframeType === filter);
  }, [wireframes, filter]);

  const handleDeleteClick = useCallback((wf: Wireframe) => {
    const usedIn = wf.usedIn || [];
    if (usedIn.length > 0) {
      setDeleteDialog({
        wireframe: wf,
        referencedBy: usedIn.map((name) => {
          const ref = wireframes.find((w) => w.name === name);
          return { id: ref?.id || '', name };
        }),
      });
    } else {
      onDelete(wf);
    }
  }, [wireframes, onDelete]);

  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>, wf: Wireframe) => {
    e.stopPropagation();
    setMenuAnchor({ el: e.currentTarget, wireframe: wf });
  };

  return (
    <Box sx={{ p: 2 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <ToggleButtonGroup size="small" value={filter} exclusive onChange={(_, v) => v && setFilter(v)}>
            <ToggleButton value="all" sx={{ fontSize: 11, px: 1.5, py: 0.25, textTransform: 'none' }}>All ({wireframes.length})</ToggleButton>
            <ToggleButton value="page" sx={{ fontSize: 11, px: 1.5, py: 0.25, textTransform: 'none' }}>Pages</ToggleButton>
            <ToggleButton value="component" sx={{ fontSize: 11, px: 1.5, py: 0.25, textTransform: 'none' }}>Components</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={onCreate} sx={{ textTransform: 'none', fontSize: 12 }}>
          New Wireframe
        </Button>
      </Stack>

      {/* Grid */}
      {filtered.length > 0 ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1.5 }}>
          {filtered.map((wf) => {
            const typeColor = TYPE_COLORS[wf.wireframeType] || '#818cf8';
            const tags = Array.isArray(wf.featureTags) ? wf.featureTags : [];
            const usedInCount = (wf.usedIn || []).length;
            const elCount = (wf.elements || []).length;

            return (
              <Card
                key={wf.id || wf.name}
                variant="outlined"
                sx={{
                  transition: 'all 0.15s ease',
                  '&:hover': {
                    borderColor: alpha(typeColor, 0.5),
                    bgcolor: alpha(typeColor, 0.03),
                  },
                }}
              >
                {/* Thumbnail area */}
                <CardActionArea onClick={() => onEdit(wf)} sx={{ p: 0 }}>
                  <Box sx={{
                    height: 140, overflow: 'hidden',
                    bgcolor: alpha(theme.palette.background.default, 0.5),
                    borderBottom: '1px solid', borderColor: 'divider',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <MiniaturePreview wireframe={wf} />
                  </Box>
                </CardActionArea>

                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.5 }}>
                        <Typography variant="subtitle2" sx={{ fontSize: 13, lineHeight: 1.3 }} noWrap>
                          {wf.name}
                        </Typography>
                        <Chip
                          icon={TYPE_ICONS[wf.wireframeType]}
                          label={wf.wireframeType}
                          size="small"
                          sx={{
                            fontSize: 9, height: 20, fontWeight: 600,
                            textTransform: 'capitalize',
                            bgcolor: alpha(typeColor, 0.12),
                            color: typeColor,
                            '& .MuiChip-icon': { color: typeColor },
                          }}
                        />
                      </Stack>

                      {/* Stats row */}
                      <Stack direction="row" spacing={1.5} sx={{ mb: tags.length > 0 ? 0.75 : 0 }}>
                        <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>
                          {elCount} element{elCount !== 1 ? 's' : ''}
                        </Typography>
                        {usedInCount > 0 && (
                          <Tooltip title={`Referenced by: ${(wf.usedIn || []).join(', ')}`}>
                            <Typography variant="caption" sx={{ fontSize: 10, color: '#818cf8', fontWeight: 600 }}>
                              Used in {usedInCount} wireframe{usedInCount !== 1 ? 's' : ''}
                            </Typography>
                          </Tooltip>
                        )}
                      </Stack>

                      {/* Feature tags */}
                      {tags.length > 0 && (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {tags.slice(0, 3).map((tag) => (
                            <Chip key={tag} label={tag} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />
                          ))}
                          {tags.length > 3 && (
                            <Chip label={`+${tags.length - 3}`} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />
                          )}
                        </Stack>
                      )}
                    </Box>

                    <IconButton size="small" onClick={(e) => handleMenuOpen(e, wf)} sx={{ ml: 0.5, mt: -0.5 }}>
                      <MoreVertIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Box>
      ) : (
        <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
          <DashboardIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
          <Typography variant="body2" sx={{ mb: 1 }}>
            {filter !== 'all' ? `No ${filter} wireframes yet.` : 'No wireframes yet.'}
          </Typography>
          <Typography variant="caption" color="text.disabled" display="block" sx={{ mb: 2 }}>
            Create wireframes to visually define your UI layouts. Drag and drop buttons, inputs, images, and reusable components.
          </Typography>
          <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={onCreate} sx={{ textTransform: 'none' }}>
            Create First Wireframe
          </Button>
        </Box>
      )}

      {/* Context Menu */}
      <Menu
        anchorEl={menuAnchor?.el}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
        onClick={() => setMenuAnchor(null)}
        slotProps={{ paper: { sx: { minWidth: 160 } } }}
      >
        <MenuItem onClick={() => menuAnchor && onEdit(menuAnchor.wireframe)}>
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: 13 }}>Edit</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => menuAnchor && onDuplicate(menuAnchor.wireframe)}>
          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: 13 }}>Duplicate</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => menuAnchor && handleDeleteClick(menuAnchor.wireframe)} sx={{ color: 'error.main' }}>
          <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: 13 }}>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* Delete Confirmation Dialog (shown when wireframe is referenced by others) */}
      <Dialog open={!!deleteDialog} onClose={() => setDeleteDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16 }}>Delete Wireframe?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            <strong>{deleteDialog?.wireframe.name}</strong> is referenced by other wireframes:
          </Typography>
          <Stack spacing={0.5} sx={{ pl: 1 }}>
            {deleteDialog?.referencedBy?.map((ref) => (
              <Typography key={ref.id} variant="body2" color="text.secondary">
                &bull; {ref.name}
              </Typography>
            ))}
          </Stack>
          <Typography variant="body2" sx={{ mt: 1.5 }} color="text.secondary">
            Deleting will remove all references to this wireframe from those parent wireframes.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog(null)} size="small">Cancel</Button>
          <Button
            color="error"
            variant="contained"
            size="small"
            onClick={() => {
              if (deleteDialog) {
                onDelete(deleteDialog.wireframe, true);
                setDeleteDialog(null);
              }
            }}
          >
            Delete Anyway
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
