'use client';

import { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Chip, Stack, CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody, Paper, Badge,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import LockIcon from '@mui/icons-material/Lock';

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

export default function SecretsPage() {
  const [credentials, setCredentials] = useState<VaultCredential[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/vault')
      .then((res) => res.json())
      .then((data) => setCredentials(data.credentials ?? []))
      .catch(() => setCredentials([]))
      .finally(() => setLoading(false));
  }, []);

  const pendingCount = credentials.filter((c) => c.approvalStatus === 'pending').length;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h2">Secrets Vault</Typography>
          {pendingCount > 0 && (
            <Badge badgeContent={pendingCount} color="warning" />
          )}
        </Stack>
        <Button variant="contained" startIcon={<AddIcon />}>Add Credential</Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      )}

      {!loading && credentials.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <LockIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">Vault is empty</Typography>
          <Typography variant="body2">Store API keys, login credentials, and other secrets securely.</Typography>
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
              </TableRow>
            </TableHead>
            <TableBody>
              {credentials.map((c) => (
                <TableRow key={c.id} hover sx={{ cursor: 'pointer' }}>
                  <TableCell><Typography fontWeight={600}>{c.name}</Typography></TableCell>
                  <TableCell><Chip label={c.type} size="small" variant="outlined" /></TableCell>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Box>
  );
}
