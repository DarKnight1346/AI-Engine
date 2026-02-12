'use client';

import {
  Box, Typography, Grid, Card, CardContent, Button, Chip, Stack, LinearProgress, Avatar,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AppleIcon from '@mui/icons-material/Apple';
import TerminalIcon from '@mui/icons-material/Terminal';

const DEMO_WORKERS = [
  { id: '1', name: 'cloud-worker-1', env: 'cloud', os: 'linux', capabilities: ['headless'], load: 45, tasks: 2, online: true },
  { id: '2', name: 'cloud-worker-2', env: 'cloud', os: 'linux', capabilities: ['headless'], load: 30, tasks: 1, online: true },
  { id: '3', name: 'mac-mini-1', env: 'local', os: 'darwin', capabilities: ['browser', 'display'], load: 72, tasks: 3, online: true },
  { id: '4', name: 'mac-mini-2', env: 'local', os: 'darwin', capabilities: ['browser', 'display'], load: 15, tasks: 0, online: true },
  { id: '5', name: 'linux-server', env: 'local', os: 'linux', capabilities: ['headless', 'gpu'], load: 0, tasks: 0, online: false },
];

export default function WorkersPage() {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Workers</Typography>
        <Button variant="contained" startIcon={<AddIcon />}>Add Worker</Button>
      </Box>
      <Grid container spacing={2}>
        {DEMO_WORKERS.map((worker) => (
          <Grid item xs={12} sm={6} md={4} key={worker.id}>
            <Card sx={{ opacity: worker.online ? 1 : 0.5, cursor: 'pointer', '&:hover': { boxShadow: 4 } }}>
              <CardContent>
                <Stack direction="row" spacing={1.5} alignItems="center" mb={1.5}>
                  <Avatar sx={{ bgcolor: worker.os === 'darwin' ? 'grey.800' : 'primary.dark', width: 36, height: 36 }}>
                    {worker.os === 'darwin' ? <AppleIcon sx={{ fontSize: 20 }} /> : <TerminalIcon sx={{ fontSize: 20 }} />}
                  </Avatar>
                  <Box sx={{ flex: 1 }}>
                    <Typography fontWeight={600}>{worker.name}</Typography>
                    <Stack direction="row" spacing={0.5}>
                      <Chip label={worker.env} size="small" color={worker.env === 'cloud' ? 'info' : 'success'} sx={{ height: 20, fontSize: 11 }} />
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: worker.online ? 'success.main' : 'grey.400', alignSelf: 'center' }} />
                    </Stack>
                  </Box>
                </Stack>

                <Stack direction="row" spacing={0.5} mb={1.5} flexWrap="wrap">
                  {worker.capabilities.map((cap) => (
                    <Chip key={cap} label={cap} size="small" variant="outlined" sx={{ height: 22, fontSize: 11 }} />
                  ))}
                </Stack>

                <Box>
                  <Typography variant="caption" color="text.secondary">CPU Load: {worker.load}%</Typography>
                  <LinearProgress variant="determinate" value={worker.load} sx={{ mt: 0.5, borderRadius: 1 }} color={worker.load > 80 ? 'error' : worker.load > 50 ? 'warning' : 'primary'} />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {worker.tasks} active task{worker.tasks !== 1 ? 's' : ''}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
