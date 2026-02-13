'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Chip, Stack, CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody, Paper, Switch,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  FormControl, InputLabel, Select, MenuItem, Snackbar, Alert,
  IconButton, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ScheduleIcon from '@mui/icons-material/Schedule';
import DeleteIcon from '@mui/icons-material/Delete';

interface Schedule {
  id: string;
  name: string;
  cronExpr: string;
  scheduleType: string;
  agentId: string | null;
  agentName: string | null;
  isActive: boolean;
  nextRunAt: string;
  lastStatus: string | null;
  lastRunAt: string | null;
}

interface AgentOption {
  id: string;
  name: string;
}

const CRON_PRESETS = [
  { label: 'Every minute', cron: '* * * * *' },
  { label: 'Every 5 minutes', cron: '*/5 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every day at midnight', cron: '0 0 * * *' },
  { label: 'Every day at 9 AM', cron: '0 9 * * *' },
  { label: 'Every weekday at 9 AM', cron: '0 9 * * 1-5' },
  { label: 'Every Monday at 9 AM', cron: '0 9 * * 1' },
  { label: 'Every month on the 1st', cron: '0 0 1 * *' },
];

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [schedName, setSchedName] = useState('');
  const [cronExpr, setCronExpr] = useState('0 9 * * *');
  const [schedAgent, setSchedAgent] = useState('');
  const [creating, setCreating] = useState(false);

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const reload = useCallback(() => {
    Promise.all([
      fetch('/api/schedules').then((r) => r.json()).catch(() => ({ schedules: [] })),
      fetch('/api/agents').then((r) => r.json()).catch(() => ({ agents: [] })),
    ]).then(([schedData, agentData]) => {
      setSchedules(schedData.schedules ?? []);
      setAgents((agentData.agents ?? []).map((a: any) => ({ id: a.id, name: a.name })));
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // ── Toggle active ──
  const handleToggle = useCallback(async (id: string, isActive: boolean) => {
    try {
      await fetch('/api/schedules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive }),
      });
      setSchedules((prev) => prev.map((s) => s.id === id ? { ...s, isActive } : s));
    } catch { /* ignore */ }
  }, []);

  // ── Create schedule ──
  const handleCreate = useCallback(async () => {
    if (!schedName.trim() || !cronExpr.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: schedName.trim(),
          cronExpr: cronExpr.trim(),
          agentId: schedAgent || null,
          nextRunAt: new Date().toISOString(),
        }),
      });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: 'Schedule created', severity: 'success' });
        setCreateOpen(false);
        setSchedName('');
        setCronExpr('0 9 * * *');
        setSchedAgent('');
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setCreating(false);
    }
  }, [schedName, cronExpr, schedAgent, reload]);

  // ── Delete schedule ──
  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/schedules?id=${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: 'Schedule deleted', severity: 'success' });
        setDeleteId(null);
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    }
  }, [reload]);

  const statusColor = (s: string | null) => {
    if (s === 'completed') return 'success';
    if (s === 'failed') return 'error';
    if (s === 'running') return 'info';
    return 'default';
  };

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Scheduled Tasks</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>New Schedule</Button>
      </Box>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}

      {!loading && schedules.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <ScheduleIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">No scheduled tasks</Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>Create a schedule to run tasks automatically on a recurring basis.</Typography>
          <Button variant="outlined" onClick={() => setCreateOpen(true)}>Create Schedule</Button>
        </Box>
      )}

      {schedules.length > 0 && (
        <Paper>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Schedule</TableCell>
                <TableCell>Agent</TableCell>
                <TableCell>Next Run</TableCell>
                <TableCell>Last Status</TableCell>
                <TableCell>Active</TableCell>
                <TableCell width={48}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {schedules.map((s) => (
                <TableRow key={s.id} hover>
                  <TableCell><Typography fontWeight={600}>{s.name}</Typography></TableCell>
                  <TableCell><Chip label={s.cronExpr} size="small" variant="outlined" sx={{ fontFamily: 'monospace' }} /></TableCell>
                  <TableCell>{s.agentName ?? '—'}</TableCell>
                  <TableCell>{new Date(s.nextRunAt).toLocaleString()}</TableCell>
                  <TableCell>
                    {s.lastStatus
                      ? <Chip label={s.lastStatus} size="small" color={statusColor(s.lastStatus) as any} />
                      : '—'
                    }
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={s.isActive}
                      size="small"
                      onChange={(e) => handleToggle(s.id, e.target.checked)}
                    />
                  </TableCell>
                  <TableCell>
                    <Tooltip title="Delete">
                      <IconButton size="small" color="error" onClick={() => setDeleteId(s.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* ── Create Schedule Dialog ── */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Scheduled Task</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" fullWidth value={schedName} onChange={(e) => setSchedName(e.target.value)} autoFocus placeholder="e.g., Daily Portfolio Check" />
            <TextField
              label="Cron Expression"
              fullWidth
              value={cronExpr}
              onChange={(e) => setCronExpr(e.target.value)}
              placeholder="0 9 * * *"
              InputProps={{ sx: { fontFamily: 'monospace' } }}
              helperText="minute hour day month weekday"
            />
            <Box>
              <Typography variant="caption" color="text.secondary" gutterBottom>Presets:</Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
                {CRON_PRESETS.map((p) => (
                  <Chip
                    key={p.cron}
                    label={p.label}
                    size="small"
                    variant={cronExpr === p.cron ? 'filled' : 'outlined'}
                    color={cronExpr === p.cron ? 'primary' : 'default'}
                    onClick={() => setCronExpr(p.cron)}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Stack>
            </Box>
            <FormControl fullWidth size="small">
              <InputLabel>Agent (optional)</InputLabel>
              <Select label="Agent (optional)" value={schedAgent} onChange={(e) => setSchedAgent(e.target.value)}>
                <MenuItem value="">None</MenuItem>
                {agents.map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!schedName.trim() || !cronExpr.trim() || creating} startIcon={creating ? <CircularProgress size={16} /> : undefined}>
            {creating ? 'Creating...' : 'Create Schedule'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteId} onClose={() => setDeleteId(null)}>
        <DialogTitle>Delete Schedule</DialogTitle>
        <DialogContent><Typography>Are you sure you want to delete this scheduled task?</Typography></DialogContent>
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
