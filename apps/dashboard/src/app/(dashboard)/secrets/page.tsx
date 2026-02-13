'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Chip, Stack, CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody, Paper, Badge,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  FormControl, InputLabel, Select, MenuItem, Snackbar, Alert,
  IconButton, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import LockIcon from '@mui/icons-material/Lock';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';

interface VaultCredential {
  id: string;
  name: string;
  type: string;
  createdBy: string;
  approvalStatus: string;
  policyCount: number;
  lastAccessed: string | null;
  createdAt: string;
}

const CREDENTIAL_TYPES = [
  { value: 'api_key', label: 'API Key' },
  { value: 'login', label: 'Website Login' },
  { value: 'oauth', label: 'OAuth Token' },
  { value: 'generic', label: 'Generic Secret' },
];

export default function SecretsPage() {
  const [credentials, setCredentials] = useState<VaultCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  // Add credential dialog
  const [addOpen, setAddOpen] = useState(false);
  const [credName, setCredName] = useState('');
  const [credType, setCredType] = useState('api_key');
  const [credValue, setCredValue] = useState('');
  const [credUrl, setCredUrl] = useState('');
  const [credUsername, setCredUsername] = useState('');
  const [adding, setAdding] = useState(false);

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch('/api/vault')
      .then((res) => res.json())
      .then((data) => setCredentials(data.credentials ?? []))
      .catch(() => setCredentials([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const pendingCount = credentials.filter((c) => c.approvalStatus === 'pending').length;

  // ── Add credential ──
  const handleAdd = useCallback(async () => {
    if (!credName.trim() || !credValue.trim()) return;
    setAdding(true);
    try {
      const data: Record<string, string> = { value: credValue.trim() };
      if (credUrl) data.url = credUrl.trim();
      if (credUsername) data.username = credUsername.trim();

      const res = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: credName.trim(),
          type: credType,
          data,
          urlPattern: credUrl.trim() || undefined,
          createdBy: 'admin',
        }),
      });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: 'Credential added', severity: 'success' });
        setAddOpen(false);
        setCredName('');
        setCredType('api_key');
        setCredValue('');
        setCredUrl('');
        setCredUsername('');
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setAdding(false);
    }
  }, [credName, credType, credValue, credUrl, credUsername, reload]);

  // ── Approve/reject credential ──
  const handleApproval = useCallback(async (id: string, status: 'approved' | 'rejected') => {
    try {
      await fetch('/api/vault', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, approvalStatus: status }),
      });
      setSnack({ open: true, message: `Credential ${status}`, severity: 'success' });
      reload();
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    }
  }, [reload]);

  // ── Delete credential ──
  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/vault?id=${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: 'Credential deleted', severity: 'success' });
        setDeleteId(null);
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    }
  }, [reload]);

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h2">Secrets Vault</Typography>
          {pendingCount > 0 && <Badge badgeContent={pendingCount} color="warning" />}
        </Stack>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>Add Credential</Button>
      </Box>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}

      {!loading && credentials.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <LockIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">Vault is empty</Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>Store API keys, login credentials, and other secrets securely.</Typography>
          <Button variant="outlined" onClick={() => setAddOpen(true)}>Add Credential</Button>
        </Box>
      )}

      {credentials.length > 0 && (
        <Paper>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Created By</TableCell>
                <TableCell>Last Accessed</TableCell>
                <TableCell>Policies</TableCell>
                <TableCell>Status</TableCell>
                <TableCell width={120}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {credentials.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell><Typography fontWeight={600}>{c.name}</Typography></TableCell>
                  <TableCell><Chip label={c.type.replace('_', ' ')} size="small" variant="outlined" /></TableCell>
                  <TableCell>{c.createdBy}</TableCell>
                  <TableCell>{c.lastAccessed ? new Date(c.lastAccessed).toLocaleDateString() : 'Never'}</TableCell>
                  <TableCell>{c.policyCount}</TableCell>
                  <TableCell>
                    <Chip
                      label={c.approvalStatus}
                      size="small"
                      color={c.approvalStatus === 'approved' ? 'success' : c.approvalStatus === 'pending' ? 'warning' : 'error'}
                    />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      {c.approvalStatus === 'pending' && (
                        <>
                          <Tooltip title="Approve">
                            <IconButton size="small" color="success" onClick={() => handleApproval(c.id, 'approved')}><CheckIcon fontSize="small" /></IconButton>
                          </Tooltip>
                          <Tooltip title="Reject">
                            <IconButton size="small" color="error" onClick={() => handleApproval(c.id, 'rejected')}><CloseIcon fontSize="small" /></IconButton>
                          </Tooltip>
                        </>
                      )}
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => setDeleteId(c.id)}><DeleteIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* ── Add Credential Dialog ── */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Credential</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" fullWidth value={credName} onChange={(e) => setCredName(e.target.value)} autoFocus placeholder="e.g., Brave Search API, GitHub Login" />
            <FormControl fullWidth>
              <InputLabel>Type</InputLabel>
              <Select label="Type" value={credType} onChange={(e) => setCredType(e.target.value)}>
                {CREDENTIAL_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
              </Select>
            </FormControl>
            {(credType === 'login' || credType === 'oauth') && (
              <TextField label="URL Pattern" fullWidth value={credUrl} onChange={(e) => setCredUrl(e.target.value)} placeholder="e.g., https://github.com/*" />
            )}
            {credType === 'login' && (
              <TextField label="Username / Email" fullWidth value={credUsername} onChange={(e) => setCredUsername(e.target.value)} />
            )}
            <TextField
              label={credType === 'api_key' ? 'API Key' : credType === 'login' ? 'Password' : credType === 'oauth' ? 'Access Token' : 'Secret Value'}
              fullWidth
              type="password"
              value={credValue}
              onChange={(e) => setCredValue(e.target.value)}
              helperText="Encrypted at rest with AES-256-GCM. Never displayed after saving."
              inputProps={{ spellCheck: false }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAdd} disabled={!credName.trim() || !credValue.trim() || adding} startIcon={adding ? <CircularProgress size={16} /> : undefined}>
            {adding ? 'Adding...' : 'Add Credential'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteId} onClose={() => setDeleteId(null)}>
        <DialogTitle>Delete Credential</DialogTitle>
        <DialogContent><Typography>Are you sure? This will permanently delete this credential.</Typography></DialogContent>
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
