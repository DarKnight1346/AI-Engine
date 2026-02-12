'use client';

import { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Avatar, Chip, Stack,
  List, ListItem, ListItemAvatar, ListItemText, Slider, TextField,
  Divider, Paper, CircularProgress,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import GroupIcon from '@mui/icons-material/Group';

interface TeamMember {
  id: string;
  displayName: string;
  email: string;
  teamRole: string;
}

interface TeamInfo {
  id: string;
  name: string;
  aiSensitivity: number;
  alwaysRespondKeywords: string[];
  quietHours: { start: string; end: string } | null;
  members: TeamMember[];
}

export default function TeamPage() {
  const [team, setTeam] = useState<TeamInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/team')
      .then((res) => res.json())
      .then((data) => setTeam(data.team ?? null))
      .catch(() => setTeam(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
    );
  }

  if (!team) {
    return (
      <Box>
        <Typography variant="h2" sx={{ mb: 3 }}>Team</Typography>
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <GroupIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">No team configured</Typography>
          <Typography variant="body2">Create a team to collaborate with others.</Typography>
          <Button variant="contained" sx={{ mt: 2 }}>Create Team</Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h2" sx={{ mb: 3 }}>Team: {team.name}</Typography>

      <Stack spacing={3}>
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h3">Members ({team.members.length})</Typography>
            <Button startIcon={<PersonAddIcon />} variant="outlined" size="small">Invite</Button>
          </Box>
          {team.members.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No members yet.</Typography>
          ) : (
            <List>
              {team.members.map((member, i) => (
                <ListItem key={member.id} divider={i < team.members.length - 1}>
                  <ListItemAvatar>
                    <Avatar>{member.displayName[0]}</Avatar>
                  </ListItemAvatar>
                  <ListItemText primary={member.displayName} secondary={member.email} />
                  <Chip label={member.teamRole} size="small" variant="outlined" />
                </ListItem>
              ))}
            </List>
          )}
        </Paper>

        <Paper sx={{ p: 3 }}>
          <Typography variant="h3" sx={{ mb: 2 }}>AI Response Settings</Typography>
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>Response Sensitivity</Typography>
            <Stack direction="row" spacing={2} alignItems="center">
              <Typography variant="caption">Reserved</Typography>
              <Slider value={team.aiSensitivity * 100} sx={{ flex: 1 }} />
              <Typography variant="caption">Eager</Typography>
            </Stack>
          </Box>
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>Always-respond keywords</Typography>
            <TextField
              fullWidth
              size="small"
              value={(team.alwaysRespondKeywords ?? []).join(', ')}
              placeholder="Comma-separated keywords"
            />
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>Quiet hours</Typography>
            <Stack direction="row" spacing={2}>
              <TextField
                size="small"
                label="Start"
                type="time"
                value={team.quietHours?.start ?? ''}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                size="small"
                label="End"
                type="time"
                value={team.quietHours?.end ?? ''}
                InputLabelProps={{ shrink: true }}
              />
            </Stack>
          </Box>
        </Paper>
      </Stack>
    </Box>
  );
}
