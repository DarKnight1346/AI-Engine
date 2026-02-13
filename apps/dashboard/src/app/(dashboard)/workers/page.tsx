'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Chip, Stack, Avatar,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  Snackbar, Alert, IconButton, Tooltip, Paper,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AppleIcon from '@mui/icons-material/Apple';
import TerminalIcon from '@mui/icons-material/Terminal';
import ComputerIcon from '@mui/icons-material/Computer';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';

interface Worker {
  id: string;
  hostname: string;
  ip: string;
  os: string;
  environment: string;
  capabilities: Record<string, unknown>;
  online: boolean;
  isLeader: boolean;
  lastHeartbeat: string;
  load?: number;
  activeTasks?: number;
  wsConnected?: boolean;
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  // Add worker dialog
  const [addOpen, setAddOpen] = useState(false);
  const [installCommand, setInstallCommand] = useState('');
  const [commandLoading, setCommandLoading] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // Delete worker dialog
  const [deleteTarget, setDeleteTarget] = useState<Worker | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [dbRes, hubRes] = await Promise.all([
        fetch('/api/workers').then((r) => r.json()).catch(() => ({ workers: [] })),
        fetch('/api/hub/workers').then((r) => r.json()).catch(() => ({ workers: [] })),
      ]);

      const dbWorkers: Worker[] = (dbRes.workers ?? []).map((w: any) => ({ ...w, wsConnected: false }));
      const liveWorkers: any[] = hubRes.workers ?? [];
      const liveMap = new Map(liveWorkers.map((w: any) => [w.workerId, w]));

      for (const w of dbWorkers) {
        const live = liveMap.get(w.id);
        if (live) {
          w.online = true;
          w.wsConnected = true;
          w.load = live.load;
          w.activeTasks = live.activeTasks;
          w.lastHeartbeat = live.lastHeartbeat;
          liveMap.delete(w.id);
        }
      }

      for (const [id, live] of liveMap) {
        dbWorkers.push({
          id,
          hostname: live.hostname ?? 'unknown',
          ip: '—',
          os: live.capabilities?.os ?? 'linux',
          environment: live.capabilities?.environment ?? 'local',
          capabilities: live.capabilities ?? {},
          online: true,
          isLeader: false,
          lastHeartbeat: live.lastHeartbeat,
          load: live.load,
          activeTasks: live.activeTasks,
          wsConnected: true,
        });
      }

      setWorkers(dbWorkers);
    } catch {
      setWorkers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/workers/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete worker');
      }
      setSnack({ open: true, message: `Worker "${deleteTarget.hostname}" removed`, severity: 'success' });
      setDeleteTarget(null);
      load();
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, load]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  // ── Generate install command ──
  const generateCommand = useCallback(async () => {
    setCommandLoading(true);
    try {
      // Get tunnel URL
      const tunnelRes = await fetch('/api/tunnel/status');
      const tunnelData = await tunnelRes.json();
      const baseUrl = tunnelData.url || window.location.origin;
      setTunnelUrl(baseUrl);

      // Generate a real join token
      const tokenRes = await fetch('/api/cluster/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generateToken: true }),
      });
      const tokenData = await tokenRes.json();
      const token = tokenData.token ?? 'ERROR_GENERATING_TOKEN';

      const scriptUrl = `${baseUrl}/api/worker/install-script?token=${token}`;
      setInstallCommand(`curl -sSL "${scriptUrl}" | bash`);
    } catch (err: any) {
      setSnack({ open: true, message: 'Failed to generate command: ' + err.message, severity: 'error' });
    } finally {
      setCommandLoading(false);
    }
  }, []);

  const handleOpenAdd = () => {
    setAddOpen(true);
    generateCommand();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setSnack({ open: true, message: 'Copied to clipboard', severity: 'success' });
  };

  const OsIcon = ({ os }: { os: string }) => {
    if (os === 'darwin') return <AppleIcon sx={{ fontSize: 20 }} />;
    if (os === 'win32') return <ComputerIcon sx={{ fontSize: 20 }} />;
    return <TerminalIcon sx={{ fontSize: 20 }} />;
  };

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Workers</Typography>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Refresh"><IconButton onClick={load}><RefreshIcon /></IconButton></Tooltip>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenAdd}>Add Worker</Button>
        </Stack>
      </Box>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}

      {!loading && workers.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <TerminalIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">No workers connected</Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>Add a worker node to start processing tasks.</Typography>
          <Button variant="outlined" onClick={handleOpenAdd}>Add Worker</Button>
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
        {workers.map((worker) => (
          <Card key={worker.id} sx={{ opacity: worker.online ? 1 : 0.5, '&:hover': { boxShadow: 4 }, position: 'relative' }}>
            <CardContent>
              <Tooltip title="Remove worker">
                <IconButton
                  size="small"
                  sx={{ position: 'absolute', top: 8, right: 8, opacity: 0.5, '&:hover': { opacity: 1, color: 'error.main' } }}
                  onClick={() => setDeleteTarget(worker)}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Stack direction="row" spacing={1.5} alignItems="center" mb={1.5}>
                <Avatar sx={{ bgcolor: worker.os === 'darwin' ? 'grey.800' : 'primary.dark', width: 36, height: 36 }}>
                  <OsIcon os={worker.os} />
                </Avatar>
                <Box sx={{ flex: 1, pr: 3 }}>
                  <Typography fontWeight={600}>{worker.hostname}</Typography>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Chip label={worker.environment} size="small" color={worker.environment === 'cloud' ? 'info' : 'success'} sx={{ height: 20, fontSize: 11 }} />
                    {worker.isLeader && <Chip label="leader" size="small" color="warning" sx={{ height: 20, fontSize: 11 }} />}
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: worker.online ? 'success.main' : 'grey.400' }} />
                  </Stack>
                </Box>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {worker.ip} &middot; {worker.os}
              </Typography>
              {worker.wsConnected && (
                <Stack direction="row" spacing={1} mt={0.5}>
                  <Chip label="WebSocket" size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                  {typeof worker.activeTasks === 'number' && (
                    <Chip label={`${worker.activeTasks} task${worker.activeTasks === 1 ? '' : 's'}`} size="small" sx={{ height: 20, fontSize: 11 }} />
                  )}
                  {typeof worker.load === 'number' && (
                    <Chip label={`load: ${worker.load.toFixed(1)}`} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                  )}
                </Stack>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Last seen: {new Date(worker.lastHeartbeat).toLocaleString()}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* ── Add Worker Dialog ── */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Worker Node</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Run this command on any machine (cloud VM, local Mac, Linux server) to join it to the cluster.
              The worker will automatically detect its capabilities, connect to the dashboard, and start processing tasks.
            </Typography>

            {commandLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box>
            ) : installCommand ? (
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', borderRadius: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', flex: 1 }}>
                    {installCommand}
                  </Typography>
                  <Tooltip title={copied ? 'Copied!' : 'Copy command'}>
                    <IconButton size="small" sx={{ color: 'grey.300', ml: 1 }} onClick={() => copyToClipboard(installCommand)}>
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Paper>
            ) : (
              <Alert severity="warning">Could not generate install command. Make sure the tunnel is running.</Alert>
            )}

            <Typography variant="caption" color="text.secondary">
              The command installs Node.js and dependencies if needed, downloads the worker bundle from the dashboard,
              registers with the cluster, and starts the worker as a system service. Works on Linux and macOS.
            </Typography>

            {tunnelUrl && (
              <Alert severity="info" variant="outlined" sx={{ fontSize: 12 }}>
                Workers will connect to: <strong>{tunnelUrl}</strong>
              </Alert>
            )}

            <Typography variant="subtitle2" sx={{ mt: 1 }}>Alternative (if repo is cloned on the worker):</Typography>
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.900', color: 'grey.100' }}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                npx @ai-engine/join-worker --server {tunnelUrl || '<dashboard-url>'} --token &lt;token&gt;
              </Typography>
            </Paper>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Close</Button>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={generateCommand} disabled={commandLoading}>
            Regenerate
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Worker Confirmation ── */}
      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove Worker</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Are you sure you want to remove <strong>{deleteTarget?.hostname}</strong>?
            {deleteTarget?.online && ' This worker is currently online and will be disconnected.'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Removing...' : 'Remove'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={3000} onClose={() => setSnack((s) => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))} variant="filled">{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
