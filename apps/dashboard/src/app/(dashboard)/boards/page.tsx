'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Card, CardContent, Chip, Avatar,
  Select, MenuItem, FormControl, InputLabel, Button, Stack,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Snackbar, Alert, IconButton, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import LinkIcon from '@mui/icons-material/Link';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import DeleteIcon from '@mui/icons-material/Delete';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

interface WorkItem {
  id: string;
  currentStage: string;
  dataJson: Record<string, unknown>;
  status: string;
  assignedNode: string | null;
}

interface Workflow {
  id: string;
  name: string;
  stages: Array<{ name: string }>;
  workItemCount: number;
}

export default function BoardsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('');
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  // Create workflow dialog
  const [createWfOpen, setCreateWfOpen] = useState(false);
  const [wfName, setWfName] = useState('');
  const [wfStages, setWfStages] = useState<string[]>(['Backlog', 'In Progress', 'Review', 'Done']);
  const [newStageName, setNewStageName] = useState('');
  const [creatingWf, setCreatingWf] = useState(false);

  // Create work item dialog
  const [createItemOpen, setCreateItemOpen] = useState(false);
  const [itemTitle, setItemTitle] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemStage, setItemStage] = useState('');
  const [creatingItem, setCreatingItem] = useState(false);

  const loadWorkflows = useCallback(() => {
    fetch('/api/workflows')
      .then((res) => res.json())
      .then((data) => {
        const wfs = data.workflows ?? [];
        setWorkflows(wfs);
        if (wfs.length > 0 && !selectedWorkflow) setSelectedWorkflow(wfs[0].id);
      })
      .catch(() => setWorkflows([]))
      .finally(() => setLoading(false));
  }, [selectedWorkflow]);

  const loadItems = useCallback((workflowId: string) => {
    if (!workflowId) return;
    setItemsLoading(true);
    fetch(`/api/workflows/items?workflowId=${workflowId}`)
      .then((res) => res.json())
      .then((data) => setWorkItems(data.items ?? []))
      .catch(() => setWorkItems([]))
      .finally(() => setItemsLoading(false));
  }, []);

  useEffect(() => { loadWorkflows(); }, [loadWorkflows]);

  useEffect(() => {
    if (selectedWorkflow) loadItems(selectedWorkflow);
  }, [selectedWorkflow, loadItems]);

  const currentWorkflow = workflows.find((w) => w.id === selectedWorkflow);
  const stages: string[] = currentWorkflow
    ? (currentWorkflow.stages as Array<{ name: string }>).map((s) => s.name)
    : [];

  const tasksByStage = (stage: string) => workItems.filter((item) => item.currentStage === stage);

  const statusDot = (status: string) => {
    if (status === 'in_progress') return 'success.main';
    if (status === 'completed') return 'grey.400';
    if (status === 'failed') return 'error.main';
    return 'warning.main';
  };

  // ── Create workflow ──
  const handleCreateWorkflow = useCallback(async () => {
    if (!wfName.trim() || wfStages.length === 0) return;
    setCreatingWf(true);
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: wfName.trim(),
          stages: wfStages.map((s) => ({ name: s })),
        }),
      });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: 'Workflow created', severity: 'success' });
        setCreateWfOpen(false);
        setWfName('');
        setWfStages(['Backlog', 'In Progress', 'Review', 'Done']);
        setSelectedWorkflow(result.workflow?.id ?? '');
        loadWorkflows();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setCreatingWf(false);
    }
  }, [wfName, wfStages, loadWorkflows]);

  // ── Create work item ──
  const handleCreateItem = useCallback(async () => {
    if (!itemTitle.trim() || !selectedWorkflow) return;
    setCreatingItem(true);
    try {
      const res = await fetch('/api/workflows/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: selectedWorkflow,
          title: itemTitle.trim(),
          description: itemDesc.trim(),
          stage: itemStage || undefined,
        }),
      });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: 'Task added', severity: 'success' });
        setCreateItemOpen(false);
        setItemTitle('');
        setItemDesc('');
        setItemStage('');
        loadItems(selectedWorkflow);
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setCreatingItem(false);
    }
  }, [itemTitle, itemDesc, itemStage, selectedWorkflow, loadItems]);

  // ── Move item to next/prev stage ──
  const moveItem = useCallback(async (itemId: string, direction: 'next' | 'prev') => {
    const item = workItems.find((i) => i.id === itemId);
    if (!item) return;
    const idx = stages.indexOf(item.currentStage);
    const newIdx = direction === 'next' ? idx + 1 : idx - 1;
    if (newIdx < 0 || newIdx >= stages.length) return;

    try {
      await fetch('/api/workflows/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, stage: stages[newIdx] }),
      });
      loadItems(selectedWorkflow);
    } catch { /* ignore */ }
  }, [workItems, stages, selectedWorkflow, loadItems]);

  const addStage = () => {
    if (newStageName.trim() && !wfStages.includes(newStageName.trim())) {
      setWfStages([...wfStages, newStageName.trim()]);
      setNewStageName('');
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Boards</Typography>
        <Stack direction="row" spacing={1}>
          {selectedWorkflow && (
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => { setCreateItemOpen(true); setItemStage(stages[0] ?? ''); }}>
              Add Task
            </Button>
          )}
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateWfOpen(true)}>New Workflow</Button>
        </Stack>
      </Box>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}

      {!loading && workflows.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <ViewKanbanIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">No workflows yet</Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>Create a workflow to manage tasks across swim lanes.</Typography>
          <Button variant="outlined" onClick={() => setCreateWfOpen(true)}>Create Workflow</Button>
        </Box>
      )}

      {workflows.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Workflow</InputLabel>
              <Select label="Workflow" value={selectedWorkflow} onChange={(e) => setSelectedWorkflow(e.target.value)}>
                {workflows.map((w) => <MenuItem key={w.id} value={w.id}>{w.name}</MenuItem>)}
              </Select>
            </FormControl>
            <Stack direction="row" spacing={1}>
              <Chip label={`${workItems.length} total`} size="small" />
              <Chip label={`${workItems.filter((i) => i.status === 'in_progress').length} in progress`} size="small" color="primary" />
            </Stack>
            {itemsLoading && <CircularProgress size={20} />}
          </Box>

          <Box sx={{ display: 'flex', gap: 2, overflow: 'auto', pb: 2 }}>
            {stages.map((stage) => (
              <Paper key={stage} sx={{ minWidth: 280, maxWidth: 320, bgcolor: 'action.hover', p: 1.5 }}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, px: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {stage}
                  <Chip label={tasksByStage(stage).length} size="small" />
                </Typography>
                <Stack spacing={1}>
                  {tasksByStage(stage).map((task) => {
                    const stageIdx = stages.indexOf(task.currentStage);
                    return (
                      <Card key={task.id} sx={{ '&:hover': { boxShadow: 4 } }}>
                        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                          <Typography variant="body2" fontWeight={600}>
                            {(task.dataJson as any).title ?? task.id}
                          </Typography>
                          {(task.dataJson as any).description && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                              {((task.dataJson as any).description as string).slice(0, 80)}
                            </Typography>
                          )}
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: statusDot(task.status) }} />
                              <Typography variant="caption" color="text.secondary">{task.status}</Typography>
                            </Box>
                            <Stack direction="row" spacing={0}>
                              {stageIdx > 0 && (
                                <Tooltip title={`Move to ${stages[stageIdx - 1]}`}>
                                  <IconButton size="small" onClick={() => moveItem(task.id, 'prev')}>
                                    <ArrowBackIcon sx={{ fontSize: 16 }} />
                                  </IconButton>
                                </Tooltip>
                              )}
                              {stageIdx < stages.length - 1 && (
                                <Tooltip title={`Move to ${stages[stageIdx + 1]}`}>
                                  <IconButton size="small" onClick={() => moveItem(task.id, 'next')}>
                                    <ArrowForwardIcon sx={{ fontSize: 16 }} />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Stack>
                          </Box>
                        </CardContent>
                      </Card>
                    );
                  })}
                  {tasksByStage(stage).length === 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>No items</Typography>
                  )}
                </Stack>
              </Paper>
            ))}
          </Box>
        </>
      )}

      {/* ── Create Workflow Dialog ── */}
      <Dialog open={createWfOpen} onClose={() => setCreateWfOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Workflow</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Workflow Name" fullWidth value={wfName} onChange={(e) => setWfName(e.target.value)} autoFocus placeholder="e.g., Software Development, Content Pipeline" />
            <Box>
              <Typography variant="subtitle2" gutterBottom>Stages (swim lanes)</Typography>
              <Stack spacing={0.5} sx={{ mb: 1 }}>
                {wfStages.map((stage, i) => (
                  <Paper key={i} variant="outlined" sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <DragIndicatorIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                      <Typography variant="body2">{stage}</Typography>
                    </Stack>
                    <IconButton size="small" onClick={() => setWfStages(wfStages.filter((_, j) => j !== i))} disabled={wfStages.length <= 1}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Paper>
                ))}
              </Stack>
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  placeholder="Add stage..."
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStage(); } }}
                  sx={{ flex: 1 }}
                />
                <Button variant="outlined" size="small" onClick={addStage} disabled={!newStageName.trim()}>Add</Button>
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateWfOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateWorkflow} disabled={!wfName.trim() || wfStages.length === 0 || creatingWf} startIcon={creatingWf ? <CircularProgress size={16} /> : undefined}>
            {creatingWf ? 'Creating...' : 'Create Workflow'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Create Work Item Dialog ── */}
      <Dialog open={createItemOpen} onClose={() => setCreateItemOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Task</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Title" fullWidth value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} autoFocus />
            <TextField label="Description" fullWidth value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} multiline rows={3} />
            <FormControl fullWidth size="small">
              <InputLabel>Stage</InputLabel>
              <Select label="Stage" value={itemStage} onChange={(e) => setItemStage(e.target.value)}>
                {stages.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateItemOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateItem} disabled={!itemTitle.trim() || creatingItem} startIcon={creatingItem ? <CircularProgress size={16} /> : undefined}>
            {creatingItem ? 'Adding...' : 'Add Task'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack((s) => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))} variant="filled">{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
