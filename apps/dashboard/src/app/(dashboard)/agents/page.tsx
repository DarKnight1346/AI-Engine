'use client';

import { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Chip, Avatar, Stack,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SmartToyIcon from '@mui/icons-material/SmartToy';

interface Agent {
  id: string;
  name: string;
  rolePrompt: string;
  status: string;
  taskCount: number;
}

const statusColor: Record<string, 'default' | 'success' | 'error'> = {
  idle: 'default',
  executing: 'success',
  error: 'error',
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/agents')
      .then((res) => res.json())
      .then((data) => setAgents(data.agents ?? []))
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Agents</Typography>
        <Button variant="contained" startIcon={<AddIcon />}>New Agent</Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && agents.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <SmartToyIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">No agents configured yet</Typography>
          <Typography variant="body2">Create your first agent to start automating tasks.</Typography>
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
        {agents.map((agent) => (
          <Card key={agent.id} sx={{ cursor: 'pointer', '&:hover': { boxShadow: 4 }, position: 'relative' }}>
            <Box sx={{ position: 'absolute', top: 12, right: 12, width: 10, height: 10, borderRadius: '50%', bgcolor: `${statusColor[agent.status] ?? 'default'}.main` }} />
            <CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center" mb={1}>
                <Avatar sx={{ bgcolor: 'primary.main' }}><SmartToyIcon /></Avatar>
                <Box>
                  <Typography variant="subtitle1" fontWeight={600}>{agent.name}</Typography>
                  <Chip label={agent.status} size="small" color={statusColor[agent.status] ?? 'default'} />
                </Box>
              </Stack>
              <Typography variant="body2" color="text.secondary">{agent.rolePrompt}</Typography>
              {agent.taskCount > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {agent.taskCount} execution{agent.taskCount > 1 ? 's' : ''}
                </Typography>
              )}
            </CardContent>
          </Card>
        ))}
      </Box>
    </Box>
  );
}
