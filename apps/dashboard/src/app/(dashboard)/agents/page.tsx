'use client';

import {
  Box, Typography, Grid, Card, CardContent, Button, Chip, Avatar, Stack,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SmartToyIcon from '@mui/icons-material/SmartToy';

const DEMO_AGENTS = [
  { id: '1', name: 'Orchestrator', role: 'Master coordinator that breaks goals into tasks', status: 'idle' as const, taskCount: 0 },
  { id: '2', name: 'Developer', role: 'Writes and reviews code', status: 'executing' as const, taskCount: 2 },
  { id: '3', name: 'Researcher', role: 'Searches the web and gathers information', status: 'idle' as const, taskCount: 0 },
  { id: '4', name: 'QA Tester', role: 'Tests code quality and finds bugs', status: 'idle' as const, taskCount: 0 },
  { id: '5', name: 'DevOps', role: 'Manages deployments and infrastructure', status: 'error' as const, taskCount: 1 },
];

const statusColor = { idle: 'default', executing: 'success', error: 'error' } as const;

export default function AgentsPage() {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Agents</Typography>
        <Button variant="contained" startIcon={<AddIcon />}>New Agent</Button>
      </Box>
      <Grid container spacing={2}>
        {DEMO_AGENTS.map((agent) => (
          <Grid item xs={12} sm={6} md={4} key={agent.id}>
            <Card sx={{ cursor: 'pointer', '&:hover': { boxShadow: 4 }, position: 'relative' }}>
              <Box sx={{ position: 'absolute', top: 12, right: 12, width: 10, height: 10, borderRadius: '50%', bgcolor: `${statusColor[agent.status]}.main` }} />
              <CardContent>
                <Stack direction="row" spacing={1.5} alignItems="center" mb={1}>
                  <Avatar sx={{ bgcolor: 'primary.main' }}><SmartToyIcon /></Avatar>
                  <Box>
                    <Typography variant="subtitle1" fontWeight={600}>{agent.name}</Typography>
                    <Chip label={agent.status} size="small" color={statusColor[agent.status]} />
                  </Box>
                </Stack>
                <Typography variant="body2" color="text.secondary">{agent.role}</Typography>
                {agent.taskCount > 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    {agent.taskCount} active task{agent.taskCount > 1 ? 's' : ''}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
