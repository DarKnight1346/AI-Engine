'use client';

import { useState, useEffect } from 'react';
import {
  Box, Typography, Tabs, Tab, Paper, List, ListItem, ListItemText,
  Chip, TextField, Stack, Card, CardContent, CircularProgress,
} from '@mui/material';
import PsychologyIcon from '@mui/icons-material/Psychology';

interface Goal {
  id: string;
  description: string;
  priority: string;
  status: string;
}

interface MemoryEntry {
  id: string;
  type: string;
  content: string;
  importance: number;
  createdAt: string;
}

interface ProfileItem {
  id: string;
  key: string;
  value: string;
  confidence: number;
}

export default function MemoryPage() {
  const [tab, setTab] = useState(0);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [profile, setProfile] = useState<ProfileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    // Fetch goals, memories, and profile from the database
    Promise.all([
      fetch('/api/memory/goals').then((r) => r.json()).catch(() => ({ goals: [] })),
      fetch('/api/memory/entries').then((r) => r.json()).catch(() => ({ entries: [] })),
      fetch('/api/memory/profile').then((r) => r.json()).catch(() => ({ profile: [] })),
    ]).then(([goalsData, memoriesData, profileData]) => {
      setGoals(goalsData.goals ?? []);
      setMemories(memoriesData.entries ?? []);
      setProfile(profileData.profile ?? []);
    }).finally(() => setLoading(false));
  }, []);

  const priorityColor = (p: string) => {
    if (p === 'high') return 'error';
    if (p === 'medium') return 'warning';
    return 'success';
  };

  const filteredMemories = search
    ? memories.filter((m) => m.content.toLowerCase().includes(search.toLowerCase()))
    : memories;

  return (
    <Box>
      <Typography variant="h2" sx={{ mb: 3 }}>Memory</Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label={`Goals (${goals.length})`} />
        <Tab label={`Knowledge (${memories.length})`} />
        <Tab label={`Profile (${profile.length})`} />
      </Tabs>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      )}

      {!loading && tab === 0 && (
        <Stack spacing={2}>
          {goals.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
              <PsychologyIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
              <Typography variant="h6">No goals set</Typography>
              <Typography variant="body2">Goals are learned from your conversations and help agents understand priorities.</Typography>
            </Box>
          )}
          {goals.map((goal) => (
            <Paper key={goal.id} sx={{ p: 2, borderLeft: 4, borderColor: `${priorityColor(goal.priority)}.main` }}>
              <Typography fontWeight={600}>{goal.description}</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Chip label={goal.priority} size="small" color={priorityColor(goal.priority) as any} />
                <Chip label={goal.status} size="small" variant="outlined" />
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {!loading && tab === 1 && (
        <Box>
          <TextField
            fullWidth
            placeholder="Search knowledge base..."
            size="small"
            sx={{ mb: 2 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {filteredMemories.length === 0 && (
            <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ py: 4 }}>
              {search ? 'No matching entries' : 'No knowledge entries yet. The system learns as you interact with it.'}
            </Typography>
          )}
          <List>
            {filteredMemories.map((entry, i) => (
              <ListItem key={entry.id} divider={i < filteredMemories.length - 1}>
                <ListItemText
                  primary={entry.content}
                  secondary={`${entry.type} · importance ${Math.round(entry.importance * 100)}% · ${new Date(entry.createdAt).toLocaleDateString()}`}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      {!loading && tab === 2 && (
        <Stack spacing={2}>
          {profile.length === 0 && (
            <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ py: 4 }}>
              No profile data yet. The system builds a profile as it learns about you.
            </Typography>
          )}
          {profile.map((item) => (
            <Card key={item.id}>
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
