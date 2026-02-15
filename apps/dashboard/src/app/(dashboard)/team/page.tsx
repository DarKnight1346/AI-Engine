'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Avatar, Chip, Stack,
  List, ListItem, ListItemAvatar, ListItemText, Slider, TextField,
  Divider, Paper, CircularProgress, Dialog, DialogTitle, DialogContent,
  DialogActions, Alert, Snackbar,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import GroupIcon from '@mui/icons-material/Group';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';

interface TeamMember {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  teamRole: string;
}

interface TeamInfo {
  id: string;
  name: string;
  description: string | null;
  aiSensitivity: number;
  alwaysRespondKeywords: string[];
  quietHours: { start: string; end: string } | null;
  members: TeamMember[];
}

export default function TeamPage() {
  const [team, setTeam] = useState<TeamInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  // Create team dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [teamDesc, setTeamDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDisplayName, setInviteDisplayName] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviting, setInviting] = useState(false);

  // AI settings editing
  const [sensitivity, setSensitivity] = useState(50);
  const [keywords, setKeywords] = useState('');
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);

  const reload = useCallback(() => {
    fetch('/api/team')
      .then((res) => res.json())
      .then((data) => {
        const t = data.team ?? null;
        setTeam(t);
        if (t) {
          setSensitivity(Math.round((t.aiSensitivity ?? 0.5) * 100));
          setKeywords((t.alwaysRespondKeywords ?? []).join(', '));
          setQuietStart(t.quietHours?.start ?? '');
          setQuietEnd(t.quietHours?.end ?? '');
          setSettingsDirty(false);
        }
      })
      .catch(() => setTeam(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // ── Create team ──
  const handleCreate = useCallback(async () => {
    if (!teamName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: teamName.trim(), description: teamDesc.trim() || undefined }),
      });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: 'Team created!', severity: 'success' });
        setCreateOpen(false);
        setTeamName('');
        setTeamDesc('');
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setCreating(false);
    }
  }, [teamName, teamDesc, reload]);

  // ── Invite member ──
  const handleInvite = useCallback(async () => {
    if (!inviteEmail.trim() || !team) return;
    setInviting(true);
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId: team.id,
          email: inviteEmail.trim(),
          password: invitePassword || undefined,
          displayName: inviteDisplayName.trim() || undefined,
        }),
      });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: result.message, severity: 'success' });
        setInviteOpen(false);
        setInviteEmail('');
        setInviteDisplayName('');
        setInvitePassword('');
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setInviting(false);
    }
  }, [inviteEmail, invitePassword, inviteDisplayName, team, reload]);

  // ── Save AI settings ──
  const handleSaveSettings = useCallback(async () => {
    if (!team) return;
    setSavingSettings(true);
    try {
      const res = await fetch('/api/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId: team.id,
          aiSensitivity: sensitivity / 100,
          alwaysRespondKeywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
          quietHours: quietStart && quietEnd ? { start: quietStart, end: quietEnd } : null,
        }),
      });
      const result = await res.json();
      if (result.success) {
        setSnack({ open: true, message: 'AI settings saved', severity: 'success' });
        setSettingsDirty(false);
      } else {
        setSnack({ open: true, message: result.error ?? 'Failed to save', severity: 'error' });
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSavingSettings(false);
    }
  }, [team, sensitivity, keywords, quietStart, quietEnd]);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}><CircularProgress /></Box>;
  }

  if (!team) {
    return (
      <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" sx={{ mb: 3 }}>Team</Typography>
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <GroupIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">No team configured</Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>Create a team to collaborate with others.</Typography>
          <Button variant="contained" onClick={() => setCreateOpen(true)}>Create Team</Button>
        </Box>

        {/* Create Team Dialog */}
        <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Create Team</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="Team Name" fullWidth value={teamName} onChange={(e) => setTeamName(e.target.value)} autoFocus placeholder="e.g., Engineering, Personal" />
              <TextField label="Description (optional)" fullWidth value={teamDesc} onChange={(e) => setTeamDesc(e.target.value)} multiline rows={2} placeholder="What is this team for?" />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={handleCreate} disabled={!teamName.trim() || creating} startIcon={creating ? <CircularProgress size={16} /> : undefined}>
              {creating ? 'Creating...' : 'Create Team'}
            </Button>
          </DialogActions>
        </Dialog>

        <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack((s) => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))} variant="filled">{snack.message}</Alert>
        </Snackbar>
      </Box>
    );
  }

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
      <Typography variant="h2" sx={{ mb: 3 }}>Team: {team.name}</Typography>

      <Stack spacing={3}>
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h3">Members ({team.members.length})</Typography>
            <Button startIcon={<PersonAddIcon />} variant="outlined" size="small" onClick={() => { setInviteOpen(true); setInviteEmail(''); setInviteDisplayName(''); setInvitePassword(''); }}>
              Invite
            </Button>
          </Box>
          {team.members.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No members yet.</Typography>
          ) : (
            <List>
              {team.members.map((member, i) => (
                <ListItem key={member.id} divider={i < team.members.length - 1}>
                  <ListItemAvatar>
                    <Avatar>{member.displayName?.[0] ?? '?'}</Avatar>
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
              <Slider
                value={sensitivity}
                onChange={(_, v) => { setSensitivity(v as number); setSettingsDirty(true); }}
                sx={{ flex: 1 }}
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => `${v}%`}
              />
              <Typography variant="caption">Eager</Typography>
            </Stack>
          </Box>
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>Always-respond keywords</Typography>
            <TextField
              fullWidth
              size="small"
              value={keywords}
              onChange={(e) => { setKeywords(e.target.value); setSettingsDirty(true); }}
              placeholder="status update, run report, check portfolio"
              helperText="Comma-separated. The AI always responds when these keywords appear."
            />
          </Box>
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>Quiet hours (AI only responds to @mentions)</Typography>
            <Stack direction="row" spacing={2}>
              <TextField
                size="small"
                label="Start"
                type="time"
                value={quietStart}
                onChange={(e) => { setQuietStart(e.target.value); setSettingsDirty(true); }}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                size="small"
                label="End"
                type="time"
                value={quietEnd}
                onChange={(e) => { setQuietEnd(e.target.value); setSettingsDirty(true); }}
                InputLabelProps={{ shrink: true }}
              />
            </Stack>
          </Box>
          {settingsDirty && (
            <Button
              variant="contained"
              startIcon={savingSettings ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={handleSaveSettings}
              disabled={savingSettings}
            >
              Save AI Settings
            </Button>
          )}
        </Paper>
      </Stack>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Team Member</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Email Address" fullWidth value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} autoFocus type="email" placeholder="colleague@company.com" />
            <TextField label="Display Name" fullWidth value={inviteDisplayName} onChange={(e) => setInviteDisplayName(e.target.value)} placeholder="John Doe" helperText="Optional. Defaults to the part before @ in the email." />
            <TextField label="Password" fullWidth value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} type="password" placeholder="Initial login password" helperText="Required for new users (min 8 characters). Not needed if the user already has an account." />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInviteOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleInvite} disabled={!inviteEmail.trim() || inviting} startIcon={inviting ? <CircularProgress size={16} /> : undefined}>
            {inviting ? 'Adding...' : 'Add Member'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack((s) => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))} variant="filled">{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
