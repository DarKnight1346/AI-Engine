'use client';

import { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Chip, Stack, CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody, Paper, Switch,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ScheduleIcon from '@mui/icons-material/Schedule';

interface Schedule {
  id: string;
  name: string;
  cronExpr: string;
  agentName: string | null;
  isActive: boolean;
  nextRunAt: string;
  lastStatus: string | null;
  lastRunAt: string | null;
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/schedules')
      .then((res) => res.json())
      .then((data) => setSchedules(data.schedules ?? []))
      .catch(() => setSchedules([]))
      .finally(() => setLoading(false));
  }, []);

  const statusColor = (s: string | null) => {
    if (s === 'completed') return 'success';
    if (s === 'failed') return 'error';
    if (s === 'running') return 'info';
    return 'default';
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Scheduled Tasks</Typography>
        <Button variant="contained" startIcon={<AddIcon />}>New Schedule</Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && schedules.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <ScheduleIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">No scheduled tasks</Typography>
          <Typography variant="body2">Create a schedule to run tasks automatically on a recurring basis.</Typography>
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
              </TableRow>
            </TableHead>
            <TableBody>
              {schedules.map((s) => (
                <TableRow key={s.id} hover sx={{ cursor: 'pointer' }}>
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
                  <TableCell><Switch checked={s.isActive} size="small" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Box>
  );
}
