'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Stack, Alert, Chip,
  IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions,
  LinearProgress, CircularProgress, Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProxyStatus {
  id: string;
  label: string;
  port: number;
  status: 'running' | 'stopped' | 'error';
  pid: number | null;
  error: string | null;
  apiKeyId: string | null;
}

interface Props {
  authToken: string | null;
  onError: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClaudeMaxSetup({ authToken, onError }: Props) {
  const [accounts, setAccounts] = useState<ProxyStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addAuthJson, setAddAuthJson] = useState('');
  const [adding, setAdding] = useState(false);

  // ── Fetch accounts ──────────────────────────────────────────────────
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/claude-max', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    } catch (err: any) {
      console.error('Failed to fetch Claude Max accounts:', err);
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // Poll every 10s to keep status fresh
  useEffect(() => {
    const iv = setInterval(fetchAccounts, 10000);
    return () => clearInterval(iv);
  }, [fetchAccounts]);

  // ── Add account ─────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!addLabel.trim() || !addAuthJson.trim()) {
      onError('Both label and auth.json contents are required');
      return;
    }

    setAdding(true);
    try {
      const res = await fetch('/api/settings/claude-max', {
        method: 'POST',
        headers,
        body: JSON.stringify({ label: addLabel.trim(), authJson: addAuthJson.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add account');

      setAddDialogOpen(false);
      setAddLabel('');
      setAddAuthJson('');
      await fetchAccounts();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setAdding(false);
    }
  };

  // ── Remove account ──────────────────────────────────────────────────
  const handleRemove = async (id: string) => {
    try {
      const res = await fetch(`/api/settings/claude-max?id=${id}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error('Failed to remove account');
      await fetchAccounts();
    } catch (err: any) {
      onError(err.message);
    }
  };

  // ── Restart proxy ───────────────────────────────────────────────────
  const handleRestart = async (id: string) => {
    try {
      const res = await fetch('/api/settings/claude-max', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id, action: 'restart' }),
      });
      if (!res.ok) throw new Error('Failed to restart proxy');
      await fetchAccounts();
    } catch (err: any) {
      onError(err.message);
    }
  };

  // ── Status icon ─────────────────────────────────────────────────────
  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case 'running': return <CheckCircleIcon color="success" fontSize="small" />;
      case 'error': return <ErrorIcon color="error" fontSize="small" />;
      default: return <PauseCircleIcon color="disabled" fontSize="small" />;
    }
  };

  if (loading) {
    return (
      <Stack alignItems="center" spacing={1} py={3}>
        <CircularProgress size={24} />
        <Typography variant="body2" color="text.secondary">Loading accounts...</Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Use multiple Claude Max/Pro subscriptions for load balancing.
        Each subscription runs its own proxy instance and requests are round-robined across them.
      </Alert>

      <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
        <Typography variant="body2" fontWeight={600} gutterBottom>How it works:</Typography>
        <Typography variant="body2" component="div" sx={{ fontSize: 13 }}>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>On a machine with a browser, run <code>claude auth login</code> for each Max account</li>
            <li>Copy the contents of <code>~/.claude/.credentials.json</code></li>
            <li>Paste it below for each account — the dashboard will manage the proxy instances</li>
          </ol>
        </Typography>
        <Divider sx={{ my: 1.5 }} />
        <Typography variant="caption" color="text.secondary">
          Requires <code>claude-max-api-proxy</code> installed: <code>npm i -g claude-max-api-proxy</code><br />
          Also requires <code>claude</code> CLI installed: <code>npm i -g @anthropic-ai/claude-code</code>
        </Typography>
      </Paper>

      {/* ── Account list ────────────────────────────────────────────── */}
      {accounts.length === 0 ? (
        <Alert severity="warning" variant="outlined">
          No Claude Max accounts configured. Add at least one account to continue.
        </Alert>
      ) : (
        <Stack spacing={1}>
          {accounts.map((acc) => (
            <Paper key={acc.id} variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <StatusIcon status={acc.status} />
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="body2" fontWeight={600}>{acc.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Port {acc.port} &bull; {acc.status}
                  {acc.error ? ` — ${acc.error}` : ''}
                </Typography>
              </Box>
              <Tooltip title="Restart proxy">
                <IconButton size="small" onClick={() => handleRestart(acc.id)}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Remove account">
                <IconButton size="small" color="error" onClick={() => handleRemove(acc.id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Paper>
          ))}
        </Stack>
      )}

      <Button
        variant="outlined"
        startIcon={<AddIcon />}
        onClick={() => setAddDialogOpen(true)}
      >
        Add Claude Max Account
      </Button>

      {accounts.length > 0 && (
        <Chip
          label={`${accounts.filter(a => a.status === 'running').length} / ${accounts.length} proxies running`}
          color={accounts.every(a => a.status === 'running') ? 'success' : 'warning'}
          variant="outlined"
          size="small"
        />
      )}

      {/* ── Add Account Dialog ──────────────────────────────────────── */}
      <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Claude Max Account</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Account Label"
              fullWidth
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              placeholder="e.g. Account 1, Team Shared"
              autoFocus
            />
            <TextField
              label="auth.json Contents"
              fullWidth
              multiline
              minRows={4}
              maxRows={10}
              value={addAuthJson}
              onChange={(e) => setAddAuthJson(e.target.value)}
              placeholder='Paste the contents of ~/.claude/.credentials.json'
              helperText="Run 'claude auth login' on your local machine, then copy ~/.claude/.credentials.json"
              inputProps={{ spellCheck: false, style: { fontFamily: 'monospace', fontSize: 12 } }}
            />
            <Alert severity="warning" variant="outlined" sx={{ fontSize: 12 }}>
              Each account should be a different Claude Max subscription.
              Make sure to log out before logging into the next account:
              <Box component="code" display="block" sx={{ mt: 0.5, fontFamily: 'monospace', fontSize: 11 }}>
                Windows: del %USERPROFILE%\.claude\.credentials.json<br />
                Linux/Mac: rm ~/.claude/.credentials.json<br />
                Then: claude auth login
              </Box>
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAdd} disabled={adding || !addLabel.trim() || !addAuthJson.trim()}>
            {adding ? <CircularProgress size={18} /> : 'Add Account & Start Proxy'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
