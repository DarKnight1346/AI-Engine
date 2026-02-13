'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Chip, Avatar, Stack,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Snackbar, Alert, IconButton, FormControl, InputLabel,
  Select, MenuItem, Paper, Divider, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';

interface Agent {
  id: string;
  name: string;
  rolePrompt: string;
  toolConfig: Record<string, unknown>;
  requiredCapabilities: string[] | null;
  workflowStageIds: string[];
  status: string;
  taskCount: number;
  scheduledTaskCount: number;
  createdAt: string;
}

const statusColor: Record<string, 'default' | 'success' | 'error'> = {
  idle: 'default',
  executing: 'success',
  error: 'error',
};

const AVAILABLE_TOOLS = [
  'webSearch', 'webSearchNews', 'webGetPage', 'webGetPageStructured',
  'searchSkills', 'loadSkill', 'searchMemory', 'storeMemory',
  'getCredential', 'createCredential', 'readFile', 'writeFile',
  'listFiles', 'execShell', 'navigate', 'click', 'type',
  'screenshot', 'getAccessibilityTree', 'sendNotification',
  'getDateTime', 'getSystemInfo', 'getTaskContext', 'wait',
];

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [rolePrompt, setRolePrompt] = useState('');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState('');

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch('/api/agents')
      .then((res) => res.json())
      .then((data) => setAgents(data.agents ?? []))
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const openCreate = () => {
    setEditingAgent(null);
    setName('');
    setRolePrompt('');
    setSelectedTools(['getDateTime', 'getSystemInfo', 'getTaskContext', 'wait', 'searchSkills', 'loadSkill', 'searchMemory', 'storeMemory']);
    setCapabilities('');
    setDialogOpen(true);
  };

  const openEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setName(agent.name);
    setRolePrompt(agent.rolePrompt);
    setSelectedTools(Object.keys(agent.toolConfig ?? {}));
    setCapabilities((agent.requiredCapabilities ?? []).join(', '));
    setDialogOpen(true);
  };

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const toolConfig: Record<string, boolean> = {};
      selectedTools.forEach((t) => { toolConfig[t] = true; });

      const payload = {
        name: name.trim(),
        rolePrompt: rolePrompt.trim(),
        toolConfig,
        requiredCapabilities: capabilities.split(',').map((c) => c.trim()).filter(Boolean),
      };

      const url = editingAgent ? `/api/agents?id=${editingAgent.id}` : '/api/agents';
      const method = editingAgent ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: editingAgent ? 'Agent updated' : 'Agent created', severity: 'success' });
        setDialogOpen(false);
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [name, rolePrompt, selectedTools, capabilities, editingAgent, reload]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/agents?id=${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: 'Agent deleted', severity: 'success' });
        setDeleteId(null);
        if (detailAgent?.id === id) setDetailAgent(null);
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    }
  }, [detailAgent, reload]);

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Agents</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Agent</Button>
      </Box>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}

      {!loading && agents.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <SmartToyIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">No agents configured yet</Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>Create your first agent to start automating tasks.</Typography>
          <Button variant="outlined" onClick={openCreate}>Create Agent</Button>
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
        {agents.map((agent) => (
          <Card key={agent.id} sx={{ cursor: 'pointer', '&:hover': { boxShadow: 4 }, position: 'relative' }} onClick={() => setDetailAgent(agent)}>
            <Box sx={{ position: 'absolute', top: 12, right: 12, width: 10, height: 10, borderRadius: '50%', bgcolor: `${statusColor[agent.status] ?? 'default'}.main` }} />
            <CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center" mb={1}>
                <Avatar sx={{ bgcolor: 'primary.main' }}><SmartToyIcon /></Avatar>
                <Box>
                  <Typography variant="subtitle1" fontWeight={600}>{agent.name}</Typography>
                  <Chip label={agent.status} size="small" color={statusColor[agent.status] ?? 'default'} />
                </Box>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                {agent.rolePrompt || 'No role description'}
              </Typography>
              {agent.taskCount > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {agent.taskCount} execution{agent.taskCount > 1 ? 's' : ''}
                </Typography>
              )}
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* ── Agent Detail Panel ── */}
      <Dialog open={!!detailAgent} onClose={() => setDetailAgent(null)} maxWidth="md" fullWidth>
        {detailAgent && (
          <>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <SmartToyIcon color="primary" />
                <Typography variant="h6">{detailAgent.name}</Typography>
                <Chip label={detailAgent.status} size="small" color={statusColor[detailAgent.status] ?? 'default'} />
              </Stack>
              <Stack direction="row" spacing={0.5}>
                <Tooltip title="Edit"><IconButton onClick={() => { setDetailAgent(null); openEdit(detailAgent); }}><EditIcon /></IconButton></Tooltip>
                <Tooltip title="Delete"><IconButton color="error" onClick={() => setDeleteId(detailAgent.id)}><DeleteIcon /></IconButton></Tooltip>
                <IconButton onClick={() => setDetailAgent(null)}><CloseIcon /></IconButton>
              </Stack>
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">Role Prompt</Typography>
                  <Paper variant="outlined" sx={{ p: 2, mt: 0.5, bgcolor: 'action.hover' }}>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{detailAgent.rolePrompt || 'No role prompt defined'}</Typography>
                  </Paper>
                </Box>
                <Divider />
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>Tools</Typography>
                  <Stack direction="row" flexWrap="wrap" gap={0.5}>
                    {Object.keys(detailAgent.toolConfig ?? {}).map((tool) => (
                      <Chip key={tool} label={tool} size="small" variant="outlined" />
                    ))}
                    {Object.keys(detailAgent.toolConfig ?? {}).length === 0 && <Typography variant="caption" color="text.secondary">No tools configured</Typography>}
                  </Stack>
                </Box>
                {detailAgent.requiredCapabilities && detailAgent.requiredCapabilities.length > 0 && (
                  <>
                    <Divider />
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>Required Capabilities</Typography>
                      <Stack direction="row" gap={0.5}>
                        {(detailAgent.requiredCapabilities as string[]).map((cap) => (
                          <Chip key={cap} label={cap} size="small" color="info" variant="outlined" />
                        ))}
                      </Stack>
                    </Box>
                  </>
                )}
                <Divider />
                <Stack direction="row" spacing={3}>
                  <Typography variant="body2"><strong>Executions:</strong> {detailAgent.taskCount}</Typography>
                  <Typography variant="body2"><strong>Scheduled tasks:</strong> {detailAgent.scheduledTaskCount}</Typography>
                  <Typography variant="body2"><strong>Created:</strong> {new Date(detailAgent.createdAt).toLocaleDateString()}</Typography>
                </Stack>
              </Stack>
            </DialogContent>
          </>
        )}
      </Dialog>

      {/* ── Create/Edit Dialog ── */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingAgent ? 'Edit Agent' : 'Create Agent'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <TextField label="Agent Name" fullWidth value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g., Code Reviewer, Web Researcher" />
            <TextField
              label="Role Prompt"
              fullWidth
              value={rolePrompt}
              onChange={(e) => setRolePrompt(e.target.value)}
              multiline
              rows={4}
              placeholder="Describe what this agent does, its expertise, and how it should behave..."
              helperText="This is the system prompt that defines the agent's personality and capabilities."
            />
            <Box>
              <Typography variant="subtitle2" gutterBottom>Tools</Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.5}>
                {AVAILABLE_TOOLS.map((tool) => (
                  <Chip
                    key={tool}
                    label={tool}
                    size="small"
                    color={selectedTools.includes(tool) ? 'primary' : 'default'}
                    variant={selectedTools.includes(tool) ? 'filled' : 'outlined'}
                    onClick={() => {
                      setSelectedTools((prev) =>
                        prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
                      );
                    }}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Stack>
            </Box>
            <TextField
              label="Required Capabilities (optional)"
              fullWidth
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              placeholder="e.g., browser-capable, has-display"
              helperText="Comma-separated. Only workers with these capabilities will run this agent's tasks."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!name.trim() || saving} startIcon={saving ? <CircularProgress size={16} /> : undefined}>
            {saving ? 'Saving...' : editingAgent ? 'Update Agent' : 'Create Agent'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteId} onClose={() => setDeleteId(null)}>
        <DialogTitle>Delete Agent</DialogTitle>
        <DialogContent><Typography>Are you sure? This will remove the agent and all its configuration.</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={() => deleteId && handleDelete(deleteId)}>Delete</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack((s) => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))} variant="filled">{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
