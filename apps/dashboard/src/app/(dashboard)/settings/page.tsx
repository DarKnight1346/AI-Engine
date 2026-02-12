'use client';

import { useState } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Stack, Tabs, Tab,
  List, ListItem, ListItemText, Switch, Chip, Select, MenuItem,
  FormControl, InputLabel, ToggleButtonGroup, ToggleButton,
  LinearProgress,
} from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';

export default function SettingsPage() {
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Typography variant="h2" sx={{ mb: 3 }}>Settings</Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label="API Keys" />
        <Tab label="General" />
        <Tab label="Account" />
        <Tab label="Security" />
        <Tab label="About" />
      </Tabs>

      {tab === 0 && (
        <Stack spacing={2}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h3" sx={{ mb: 2 }}>Claude API Keys</Typography>
            {['Key 1 (Primary)', 'Key 2 (Backup)'].map((key, i) => (
              <Box key={i} sx={{ mb: 2, p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography fontWeight={600}>{key}</Typography>
                  <Chip label="Active" size="small" color="success" />
                </Stack>
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">Usage: 12,450 / 100,000 tokens</Typography>
                  <LinearProgress variant="determinate" value={12.45} sx={{ mt: 0.5 }} />
                </Box>
              </Box>
            ))}
            <Button variant="outlined">Add API Key</Button>
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h3" sx={{ mb: 2 }}>Load Balancing</Typography>
            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>Strategy</InputLabel>
              <Select label="Strategy" defaultValue="round-robin">
                <MenuItem value="round-robin">Round Robin</MenuItem>
                <MenuItem value="least-active">Least Active</MenuItem>
                <MenuItem value="random">Random</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Model Tier Mapping</Typography>
            <Stack spacing={1}>
              <TextField size="small" label="Fast (Haiku)" defaultValue="claude-3-5-haiku-20241022" />
              <TextField size="small" label="Standard (Sonnet)" defaultValue="claude-sonnet-4-20250514" />
              <TextField size="small" label="Heavy (Opus)" defaultValue="claude-opus-4-20250514" />
            </Stack>
          </Paper>
        </Stack>
      )}

      {tab === 1 && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={3}>
            <TextField label="System Name" defaultValue="AI Engine" />
            <FormControl fullWidth>
              <InputLabel>Default Approval Mode</InputLabel>
              <Select label="Default Approval Mode" defaultValue="notify">
                <MenuItem value="auto">Auto-approve</MenuItem>
                <MenuItem value="notify">Notify on creation</MenuItem>
                <MenuItem value="approve">Require approval</MenuItem>
              </Select>
            </FormControl>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Theme</Typography>
              <ToggleButtonGroup exclusive value="system" sx={{ mb: 2 }}>
                <ToggleButton value="system"><SettingsBrightnessIcon sx={{ mr: 1 }} /> System</ToggleButton>
                <ToggleButton value="light"><LightModeIcon sx={{ mr: 1 }} /> Light</ToggleButton>
                <ToggleButton value="dark"><DarkModeIcon sx={{ mr: 1 }} /> Dark</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Stack>
        </Paper>
      )}

      {tab === 2 && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={2}>
            <TextField label="Display Name" defaultValue="Admin" />
            <TextField label="Email" defaultValue="admin@example.com" disabled />
            <Button variant="outlined">Change Password</Button>
          </Stack>
        </Paper>
      )}

      {tab === 3 && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Button variant="outlined" color="warning">Change Vault Passphrase</Button>
            <FormControl fullWidth>
              <InputLabel>Session Timeout</InputLabel>
              <Select label="Session Timeout" defaultValue="7d">
                <MenuItem value="1d">1 day</MenuItem>
                <MenuItem value="7d">7 days</MenuItem>
                <MenuItem value="30d">30 days</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </Paper>
      )}

      {tab === 4 && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={1}>
            <Typography variant="body2"><strong>Version:</strong> 0.1.0</Typography>
            <Typography variant="body2"><strong>Workers:</strong> 5 connected</Typography>
            <Typography variant="body2"><strong>Database:</strong> PostgreSQL 16 + pgvector</Typography>
            <Typography variant="body2"><strong>Scheduler:</strong> Healthy (last tick 0.5s ago)</Typography>
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
