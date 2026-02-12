'use client';

import {
  Box, Typography, Paper, Card, CardContent, Chip, Avatar,
  Select, MenuItem, FormControl, InputLabel, Button, Stack,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import LinkIcon from '@mui/icons-material/Link';

const DEMO_STAGES = ['Backlog', 'In Development', 'Ready for QA', 'QA Pass', 'Done'];

interface DemoTask {
  id: string;
  title: string;
  agent: string;
  status: 'idle' | 'running' | 'done';
  hasBlocker: boolean;
}

const DEMO_TASKS: Record<string, DemoTask[]> = {
  'Backlog': [{ id: '1', title: 'Research authentication patterns', agent: 'Researcher', status: 'idle', hasBlocker: false }],
  'In Development': [{ id: '2', title: 'Implement login page', agent: 'Developer', status: 'running', hasBlocker: false }],
  'Ready for QA': [],
  'QA Pass': [{ id: '3', title: 'Test payment flow', agent: 'QA Agent', status: 'done', hasBlocker: false }],
  'Done': [{ id: '4', title: 'Setup CI/CD pipeline', agent: 'DevOps', status: 'done', hasBlocker: false }],
};

export default function BoardsPage() {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Boards</Typography>
        <Button variant="contained" startIcon={<AddIcon />}>New Workflow</Button>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Workflow</InputLabel>
          <Select label="Workflow" defaultValue="dev">
            <MenuItem value="dev">Software Development</MenuItem>
            <MenuItem value="marketing">Marketing Campaign</MenuItem>
          </Select>
        </FormControl>
        <Stack direction="row" spacing={1}>
          <Chip label="5 total" size="small" />
          <Chip label="1 in progress" size="small" color="primary" />
          <Chip label="0 blocked" size="small" color="warning" />
        </Stack>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, overflow: 'auto', pb: 2 }}>
        {DEMO_STAGES.map((stage) => (
          <Paper key={stage} sx={{ minWidth: 280, maxWidth: 320, bgcolor: 'action.hover', p: 1.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5, px: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {stage}
              <Chip label={DEMO_TASKS[stage]?.length ?? 0} size="small" />
            </Typography>
            <Stack spacing={1}>
              {(DEMO_TASKS[stage] ?? []).map((task) => (
                <Card key={task.id} sx={{ cursor: 'pointer', '&:hover': { boxShadow: 4 } }}>
                  <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="body2" fontWeight={600}>{task.title}</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                      <Avatar sx={{ width: 20, height: 20, fontSize: 10 }}>{task.agent[0]}</Avatar>
                      <Typography variant="caption" color="text.secondary">{task.agent}</Typography>
                      {task.hasBlocker && <LinkIcon sx={{ fontSize: 14, color: 'warning.main' }} />}
                      <Box sx={{ flex: 1 }} />
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: task.status === 'running' ? 'success.main' : task.status === 'done' ? 'grey.400' : 'warning.main' }} />
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          </Paper>
        ))}
      </Box>
    </Box>
  );
}
