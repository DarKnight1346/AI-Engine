'use client';

import { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Card, CardContent, Chip, Avatar,
  Select, MenuItem, FormControl, InputLabel, Button, Stack,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import LinkIcon from '@mui/icons-material/Link';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';

interface WorkItem {
  id: string;
  currentStage: string;
  dataJson: Record<string, unknown>;
  status: string;
  assignedNode: string | null;
}

interface Workflow {
  id: string;
  name: string;
  stages: Array<{ name: string }>;
  workItemCount: number;
}

export default function BoardsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('');
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/workflows')
      .then((res) => res.json())
      .then((data) => {
        const wfs = data.workflows ?? [];
        setWorkflows(wfs);
        if (wfs.length > 0) setSelectedWorkflow(wfs[0].id);
      })
      .catch(() => setWorkflows([]))
      .finally(() => setLoading(false));
  }, []);

  const currentWorkflow = workflows.find((w) => w.id === selectedWorkflow);
  const stages: string[] = currentWorkflow
    ? (currentWorkflow.stages as Array<{ name: string }>).map((s) => s.name)
    : [];

  const tasksByStage = (stage: string) =>
    workItems.filter((item) => item.currentStage === stage);

  const statusDot = (status: string) => {
    if (status === 'in_progress') return 'success.main';
    if (status === 'completed') return 'grey.400';
    if (status === 'failed') return 'error.main';
    return 'warning.main';
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Boards</Typography>
        <Button variant="contained" startIcon={<AddIcon />}>New Workflow</Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      )}

      {!loading && workflows.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <ViewKanbanIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">No workflows yet</Typography>
          <Typography variant="body2">Create a workflow to manage tasks across swim lanes.</Typography>
        </Box>
      )}

      {workflows.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Workflow</InputLabel>
              <Select
                label="Workflow"
                value={selectedWorkflow}
                onChange={(e) => setSelectedWorkflow(e.target.value)}
              >
                {workflows.map((w) => (
                  <MenuItem key={w.id} value={w.id}>{w.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction="row" spacing={1}>
              <Chip label={`${workItems.length} total`} size="small" />
              <Chip label={`${workItems.filter((i) => i.status === 'in_progress').length} in progress`} size="small" color="primary" />
            </Stack>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, overflow: 'auto', pb: 2 }}>
            {stages.map((stage) => (
              <Paper key={stage} sx={{ minWidth: 280, maxWidth: 320, bgcolor: 'action.hover', p: 1.5 }}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, px: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {stage}
                  <Chip label={tasksByStage(stage).length} size="small" />
                </Typography>
                <Stack spacing={1}>
                  {tasksByStage(stage).map((task) => (
                    <Card key={task.id} sx={{ cursor: 'pointer', '&:hover': { boxShadow: 4 } }}>
                      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Typography variant="body2" fontWeight={600}>
                          {(task.dataJson as any).title ?? task.id}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: statusDot(task.status) }} />
                          <Typography variant="caption" color="text.secondary">{task.status}</Typography>
                        </Box>
                      </CardContent>
                    </Card>
                  ))}
                  {tasksByStage(stage).length === 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>No items</Typography>
                  )}
                </Stack>
              </Paper>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}
