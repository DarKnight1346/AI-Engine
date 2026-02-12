'use client';

import { useState } from 'react';
import {
  Box, Typography, Tabs, Tab, Paper, List, ListItem, ListItemText,
  Chip, TextField, Stack, Card, CardContent,
} from '@mui/material';

export default function MemoryPage() {
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Typography variant="h2" sx={{ mb: 3 }}>Memory</Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label="Goals" />
        <Tab label="Knowledge" />
        <Tab label="Profile" />
      </Tabs>

      {tab === 0 && (
        <Stack spacing={2}>
          {[
            { desc: 'Optimize retirement portfolio with focus on index funds', priority: 'high', status: 'active' },
            { desc: 'Ship v2.0 of the mobile app by end of Q1', priority: 'high', status: 'active' },
            { desc: 'Learn Rust for systems programming', priority: 'low', status: 'paused' },
          ].map((goal, i) => (
            <Paper key={i} sx={{ p: 2, borderLeft: 4, borderColor: goal.priority === 'high' ? 'error.main' : goal.priority === 'medium' ? 'warning.main' : 'success.main' }}>
              <Typography fontWeight={600}>{goal.desc}</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Chip label={goal.priority} size="small" color={goal.priority === 'high' ? 'error' : goal.priority === 'medium' ? 'warning' : 'success'} />
                <Chip label={goal.status} size="small" variant="outlined" />
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {tab === 1 && (
        <Box>
          <TextField fullWidth placeholder="Search knowledge base..." size="small" sx={{ mb: 2 }} />
          <List>
            <ListItem divider><ListItemText primary="User prefers TypeScript over JavaScript" secondary="Learned from 15 interactions" /></ListItem>
            <ListItem divider><ListItemText primary="Retirement portfolio target allocation: 70% stocks, 30% bonds" secondary="Set by user on Jan 15" /></ListItem>
            <ListItem><ListItemText primary="Preferred deployment platform is AWS" secondary="Inferred from 8 conversations" /></ListItem>
          </List>
        </Box>
      )}

      {tab === 2 && (
        <Stack spacing={2}>
          {[
            { key: 'Communication style', value: 'Concise and technical' },
            { key: 'Risk tolerance', value: 'Moderate' },
            { key: 'Work hours', value: '9 AM - 6 PM EST' },
            { key: 'Primary language', value: 'TypeScript' },
          ].map((item, i) => (
            <Card key={i}>
              <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="body2" color="text.secondary">{item.key}</Typography>
                <Typography variant="body1" fontWeight={600}>{item.value}</Typography>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
}
