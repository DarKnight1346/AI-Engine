'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Tabs, Tab, Paper, List, ListItem, ListItemText,
  Chip, TextField, Stack, Card, CardContent, CircularProgress,
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  Snackbar, Alert, FormControl, InputLabel, Select, MenuItem,
  IconButton, Tooltip, Slider,
} from '@mui/material';
import PsychologyIcon from '@mui/icons-material/Psychology';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';

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
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  // Goal dialog
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [goalDesc, setGoalDesc] = useState('');
  const [goalPriority, setGoalPriority] = useState('medium');
  const [goalStatus, setGoalStatus] = useState('active');
  const [savingGoal, setSavingGoal] = useState(false);

  // Knowledge dialog
  const [knowledgeDialogOpen, setKnowledgeDialogOpen] = useState(false);
  const [knowledgeContent, setKnowledgeContent] = useState('');
  const [knowledgeType, setKnowledgeType] = useState('knowledge');
  const [knowledgeImportance, setKnowledgeImportance] = useState(50);
  const [savingKnowledge, setSavingKnowledge] = useState(false);

  // Profile dialog
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [profileKey, setProfileKey] = useState('');
  const [profileValue, setProfileValue] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const reload = useCallback(() => {
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

  useEffect(() => { reload(); }, [reload]);

  const priorityColor = (p: string) => {
    if (p === 'high') return 'error';
    if (p === 'medium') return 'warning';
    return 'success';
  };

  const filteredMemories = search
    ? memories.filter((m) => m.content.toLowerCase().includes(search.toLowerCase()))
    : memories;

  // ── Goal CRUD ──
  const openGoalCreate = () => { setEditingGoal(null); setGoalDesc(''); setGoalPriority('medium'); setGoalStatus('active'); setGoalDialogOpen(true); };
  const openGoalEdit = (g: Goal) => { setEditingGoal(g); setGoalDesc(g.description); setGoalPriority(g.priority); setGoalStatus(g.status); setGoalDialogOpen(true); };

  const handleSaveGoal = useCallback(async () => {
    if (!goalDesc.trim()) return;
    setSavingGoal(true);
    try {
      const method = editingGoal ? 'PATCH' : 'POST';
      const res = await fetch('/api/memory/goals', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingGoal?.id,
          description: goalDesc.trim(),
          priority: goalPriority,
          status: goalStatus,
        }),
      });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: editingGoal ? 'Goal updated' : 'Goal created', severity: 'success' });
        setGoalDialogOpen(false);
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSavingGoal(false);
    }
  }, [goalDesc, goalPriority, goalStatus, editingGoal, reload]);

  const handleDeleteGoal = useCallback(async (id: string) => {
    try {
      await fetch(`/api/memory/goals?id=${id}`, { method: 'DELETE' });
      setSnack({ open: true, message: 'Goal deleted', severity: 'success' });
      reload();
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    }
  }, [reload]);

  // ── Knowledge CRUD ──
  const handleSaveKnowledge = useCallback(async () => {
    if (!knowledgeContent.trim()) return;
    setSavingKnowledge(true);
    try {
      const res = await fetch('/api/memory/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: knowledgeContent.trim(),
          type: knowledgeType,
          importance: knowledgeImportance / 100,
        }),
      });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: 'Knowledge entry added', severity: 'success' });
        setKnowledgeDialogOpen(false);
        setKnowledgeContent('');
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSavingKnowledge(false);
    }
  }, [knowledgeContent, knowledgeType, knowledgeImportance, reload]);

  const handleDeleteEntry = useCallback(async (id: string) => {
    try {
      await fetch(`/api/memory/entries?id=${id}`, { method: 'DELETE' });
      setSnack({ open: true, message: 'Entry deleted', severity: 'success' });
      reload();
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    }
  }, [reload]);

  // ── Profile CRUD ──
  const handleSaveProfile = useCallback(async () => {
    if (!profileKey.trim() || !profileValue.trim()) return;
    setSavingProfile(true);
    try {
      const res = await fetch('/api/memory/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: profileKey.trim(), value: profileValue.trim() }),
      });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: 'Profile updated', severity: 'success' });
        setProfileDialogOpen(false);
        setProfileKey('');
        setProfileValue('');
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSavingProfile(false);
    }
  }, [profileKey, profileValue, reload]);

  const handleDeleteProfile = useCallback(async (id: string) => {
    try {
      await fetch(`/api/memory/profile?id=${id}`, { method: 'DELETE' });
      setSnack({ open: true, message: 'Profile item deleted', severity: 'success' });
      reload();
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    }
  }, [reload]);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Memory</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => {
          if (tab === 0) openGoalCreate();
          else if (tab === 1) { setKnowledgeDialogOpen(true); setKnowledgeContent(''); }
          else { setProfileDialogOpen(true); setProfileKey(''); setProfileValue(''); }
        }}>
          {tab === 0 ? 'Add Goal' : tab === 1 ? 'Add Knowledge' : 'Add Profile'}
        </Button>
      </Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label={`Goals (${goals.length})`} />
        <Tab label={`Knowledge (${memories.length})`} />
        <Tab label={`Profile (${profile.length})`} />
      </Tabs>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}

      {/* ── Goals Tab ── */}
      {!loading && tab === 0 && (
        <Stack spacing={2}>
          {goals.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
              <PsychologyIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
              <Typography variant="h6">No goals set</Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>Goals help agents understand your priorities.</Typography>
              <Button variant="outlined" onClick={openGoalCreate}>Add Goal</Button>
            </Box>
          )}
          {goals.map((goal) => (
            <Paper key={goal.id} sx={{ p: 2, borderLeft: 4, borderColor: `${priorityColor(goal.priority)}.main`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ flex: 1 }}>
                <Typography fontWeight={600}>{goal.description}</Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Chip label={goal.priority} size="small" color={priorityColor(goal.priority) as any} />
                  <Chip label={goal.status} size="small" variant="outlined" />
                </Stack>
              </Box>
              <Stack direction="row" spacing={0.5}>
                <Tooltip title="Edit"><IconButton size="small" onClick={() => openGoalEdit(goal)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => handleDeleteGoal(goal.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {/* ── Knowledge Tab ── */}
      {!loading && tab === 1 && (
        <Box>
          <TextField fullWidth placeholder="Search knowledge base..." size="small" sx={{ mb: 2 }} value={search} onChange={(e) => setSearch(e.target.value)} />
          {filteredMemories.length === 0 && (
            <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ py: 4 }}>
              {search ? 'No matching entries' : 'No knowledge entries yet.'}
            </Typography>
          )}
          <List>
            {filteredMemories.map((entry, i) => (
              <ListItem key={entry.id} divider={i < filteredMemories.length - 1}
                secondaryAction={
                  <Tooltip title="Delete"><IconButton edge="end" size="small" color="error" onClick={() => handleDeleteEntry(entry.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                }
              >
                <ListItemText
                  primary={entry.content}
                  secondary={`${entry.type} · importance ${Math.round(entry.importance * 100)}% · ${new Date(entry.createdAt).toLocaleDateString()}`}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      {/* ── Profile Tab ── */}
      {!loading && tab === 2 && (
        <Stack spacing={2}>
          {profile.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>No profile data yet.</Typography>
              <Button variant="outlined" onClick={() => setProfileDialogOpen(true)}>Add Profile Item</Button>
            </Box>
          )}
          {profile.map((item) => (
            <Card key={item.id}>
              <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Box>
                  <Typography variant="body2" color="text.secondary">{item.key}</Typography>
                  <Typography variant="body1" fontWeight={600}>{item.value}</Typography>
                </Box>
                <Stack direction="row" spacing={0.5}>
                  <Tooltip title="Edit"><IconButton size="small" onClick={() => { setProfileKey(item.key); setProfileValue(item.value); setProfileDialogOpen(true); }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => handleDeleteProfile(item.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* ── Goal Dialog ── */}
      <Dialog open={goalDialogOpen} onClose={() => setGoalDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingGoal ? 'Edit Goal' : 'Add Goal'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Goal Description" fullWidth value={goalDesc} onChange={(e) => setGoalDesc(e.target.value)} autoFocus multiline rows={2} placeholder="e.g., Build a profitable SaaS product by Q3" />
            <FormControl fullWidth size="small">
              <InputLabel>Priority</InputLabel>
              <Select label="Priority" value={goalPriority} onChange={(e) => setGoalPriority(e.target.value)}>
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="low">Low</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select label="Status" value={goalStatus} onChange={(e) => setGoalStatus(e.target.value)}>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="paused">Paused</MenuItem>
                <MenuItem value="completed">Completed</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGoalDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveGoal} disabled={!goalDesc.trim() || savingGoal} startIcon={savingGoal ? <CircularProgress size={16} /> : undefined}>
            {savingGoal ? 'Saving...' : editingGoal ? 'Update' : 'Add Goal'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Knowledge Dialog ── */}
      <Dialog open={knowledgeDialogOpen} onClose={() => setKnowledgeDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Knowledge Entry</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Content" fullWidth value={knowledgeContent} onChange={(e) => setKnowledgeContent(e.target.value)} autoFocus multiline rows={4} placeholder="Enter a fact, decision, pattern, or piece of knowledge..." />
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select label="Type" value={knowledgeType} onChange={(e) => setKnowledgeType(e.target.value)}>
                <MenuItem value="knowledge">Knowledge</MenuItem>
                <MenuItem value="decision">Decision</MenuItem>
                <MenuItem value="fact">Fact</MenuItem>
                <MenuItem value="pattern">Pattern</MenuItem>
              </Select>
            </FormControl>
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>Importance: {knowledgeImportance}%</Typography>
              <Slider value={knowledgeImportance} onChange={(_, v) => setKnowledgeImportance(v as number)} />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setKnowledgeDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveKnowledge} disabled={!knowledgeContent.trim() || savingKnowledge} startIcon={savingKnowledge ? <CircularProgress size={16} /> : undefined}>
            {savingKnowledge ? 'Saving...' : 'Add Entry'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Profile Dialog ── */}
      <Dialog open={profileDialogOpen} onClose={() => setProfileDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add/Edit Profile Item</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Key" fullWidth value={profileKey} onChange={(e) => setProfileKey(e.target.value)} autoFocus placeholder="e.g., Communication style, Risk tolerance" />
            <TextField label="Value" fullWidth value={profileValue} onChange={(e) => setProfileValue(e.target.value)} placeholder="e.g., Concise and direct" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProfileDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveProfile} disabled={!profileKey.trim() || !profileValue.trim() || savingProfile} startIcon={savingProfile ? <CircularProgress size={16} /> : undefined}>
            {savingProfile ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack((s) => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))} variant="filled">{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
