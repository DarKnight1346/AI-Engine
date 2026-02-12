'use client';

import {
  Box, Typography, Button, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, Chip, IconButton, Badge,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';

const DEMO_SECRETS = [
  { name: 'claude-api-key-1', type: 'API Key', createdBy: 'admin', lastAccessed: '2 hours ago', policies: 3 },
  { name: 'github-login', type: 'Login', createdBy: 'admin', lastAccessed: '1 day ago', policies: 2 },
  { name: 'aws-oauth', type: 'OAuth', createdBy: 'agent:developer', lastAccessed: '5 mins ago', policies: 1 },
  { name: 'brave-search-key', type: 'API Key', createdBy: 'admin', lastAccessed: '12 hours ago', policies: 5 },
];

export default function SecretsPage() {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Secrets</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Badge badgeContent={1} color="warning">
            <Button variant="outlined" size="small">Pending Approval</Button>
          </Badge>
          <Button variant="contained" startIcon={<AddIcon />}>New Secret</Button>
        </Box>
      </Box>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Created By</TableCell>
              <TableCell>Last Accessed</TableCell>
              <TableCell>Policies</TableCell>
              <TableCell>Value</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {DEMO_SECRETS.map((secret) => (
              <TableRow key={secret.name} hover sx={{ cursor: 'pointer' }}>
                <TableCell><Typography fontWeight={600}>{secret.name}</Typography></TableCell>
                <TableCell><Chip label={secret.type} size="small" variant="outlined" /></TableCell>
                <TableCell>{secret.createdBy}</TableCell>
                <TableCell>{secret.lastAccessed}</TableCell>
                <TableCell>{secret.policies}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" sx={{ letterSpacing: 2 }}>••••••••</Typography>
                    <VisibilityOffIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
