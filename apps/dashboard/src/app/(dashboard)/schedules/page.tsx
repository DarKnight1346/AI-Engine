'use client';

import {
  Box, Typography, List, ListItem, ListItemText, Switch, Chip, Button,
  Paper, Stack,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

const DEMO_SCHEDULES = [
  { id: '1', name: 'Portfolio Check', schedule: 'Every weekday at 3:30 PM', nextRun: '2h 15m', lastStatus: 'success' as const, active: true },
  { id: '2', name: 'Email Summary', schedule: 'Every day at 8:00 AM', nextRun: '18h 30m', lastStatus: 'success' as const, active: true },
  { id: '3', name: 'Health Check', schedule: 'Every 5 minutes', nextRun: '2m 30s', lastStatus: 'failed' as const, active: true },
  { id: '4', name: 'Weekly Report', schedule: 'Every Monday at 9:00 AM', nextRun: '5d 4h', lastStatus: 'success' as const, active: false },
];

export default function SchedulesPage() {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Schedules</Typography>
        <Button variant="contained" startIcon={<AddIcon />}>New Schedule</Button>
      </Box>
      <Paper>
        <List>
          {DEMO_SCHEDULES.map((s, i) => (
            <ListItem
              key={s.id}
              divider={i < DEMO_SCHEDULES.length - 1}
              sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, py: 2 }}
              secondaryAction={<Switch checked={s.active} />}
            >
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography fontWeight={600}>{s.name}</Typography>
                    <Chip
                      size="small"
                      label={s.lastStatus === 'success' ? '✓' : '✗'}
                      color={s.lastStatus === 'success' ? 'success' : 'error'}
                      sx={{ minWidth: 28 }}
                    />
                  </Stack>
                }
                secondary={
                  <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
                    <Typography variant="caption">{s.schedule}</Typography>
                    <Typography variant="caption" color="primary">Next: {s.nextRun}</Typography>
                  </Stack>
                }
              />
            </ListItem>
          ))}
        </List>
      </Paper>
    </Box>
  );
}
