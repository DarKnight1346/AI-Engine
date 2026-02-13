'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Chip, Stack, Tabs, Tab,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Snackbar, Alert, Switch, IconButton, Tooltip, Paper,
  Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';

interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  instructions: string;
  usageCount: number;
  createdBy: string;
  isActive: boolean;
  version: number;
  createdAt: string;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  // Create/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [instructions, setInstructions] = useState('');
  const [codeSnippet, setCodeSnippet] = useState('');

  // Detail view
  const [detailSkill, setDetailSkill] = useState<Skill | null>(null);

  const reload = useCallback(() => {
    fetch('/api/skills')
      .then((res) => res.json())
      .then((data) => setSkills(data.skills ?? []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const drafts = skills.filter((s) => !s.isActive);
  const active = skills.filter((s) => s.isActive);
  const filtered = tab === 0 ? skills : drafts;

  const openCreate = () => {
    setEditingSkill(null);
    setName('');
    setDescription('');
    setCategory('General');
    setInstructions('');
    setCodeSnippet('');
    setDialogOpen(true);
  };

  const openEdit = (skill: Skill) => {
    setEditingSkill(skill);
    setName(skill.name);
    setDescription(skill.description);
    setCategory(skill.category);
    setInstructions(skill.instructions);
    setCodeSnippet('');
    setDialogOpen(true);
  };

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        category: category.trim() || 'General',
        instructions: instructions.trim(),
        codeSnippet: codeSnippet.trim() || undefined,
        id: editingSkill?.id,
      };

      const url = editingSkill ? '/api/skills' : '/api/skills';
      const method = editingSkill ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: editingSkill ? 'Skill updated' : 'Skill created', severity: 'success' });
        setDialogOpen(false);
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [name, description, category, instructions, codeSnippet, editingSkill, reload]);

  const handleToggle = useCallback(async (id: string, isActive: boolean) => {
    try {
      await fetch('/api/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive }),
      });
      reload();
    } catch { /* ignore */ }
  }, [reload]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/skills?id=${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: 'Skill deleted', severity: 'success' });
        if (detailSkill?.id === id) setDetailSkill(null);
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    }
  }, [detailSkill, reload]);

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Skills</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Skill</Button>
      </Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label={`All Skills (${skills.length})`} />
        <Tab label={`Drafts (${drafts.length})`} />
      </Tabs>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}

      {!loading && filtered.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <AutoFixHighIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">{tab === 0 ? 'No skills yet' : 'No draft skills'}</Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>Skills are reusable patterns that agents can discover and execute.</Typography>
          {tab === 0 && <Button variant="outlined" onClick={openCreate}>Create Skill</Button>}
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr', lg: '1fr 1fr 1fr 1fr' }, gap: 2 }}>
        {filtered.map((skill) => (
          <Card key={skill.id} sx={{ cursor: 'pointer', '&:hover': { boxShadow: 4 }, opacity: skill.isActive ? 1 : 0.7 }} onClick={() => setDetailSkill(skill)}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Typography variant="subtitle1" fontWeight={600}>{skill.name}</Typography>
                {!skill.isActive && <Chip label="Draft" size="small" color="warning" />}
              </Stack>
              {skill.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {skill.description}
                </Typography>
              )}
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Chip label={skill.category} size="small" variant="outlined" />
                <Chip label={`${skill.usageCount} uses`} size="small" />
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Created by {skill.createdBy}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* ── Skill Detail Dialog ── */}
      <Dialog open={!!detailSkill} onClose={() => setDetailSkill(null)} maxWidth="md" fullWidth>
        {detailSkill && (
          <>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <AutoFixHighIcon color="primary" />
                <Typography variant="h6">{detailSkill.name}</Typography>
                <Chip label={detailSkill.category} size="small" variant="outlined" />
                {!detailSkill.isActive && <Chip label="Draft" size="small" color="warning" />}
              </Stack>
              <Stack direction="row" spacing={0.5}>
                {!detailSkill.isActive && (
                  <Tooltip title="Approve (activate)">
                    <IconButton color="success" onClick={() => { handleToggle(detailSkill.id, true); setDetailSkill(null); }}><CheckIcon /></IconButton>
                  </Tooltip>
                )}
                <Tooltip title="Edit"><IconButton onClick={() => { setDetailSkill(null); openEdit(detailSkill); }}><EditIcon /></IconButton></Tooltip>
                <Tooltip title="Delete"><IconButton color="error" onClick={() => { handleDelete(detailSkill.id); }}><DeleteIcon /></IconButton></Tooltip>
                <IconButton onClick={() => setDetailSkill(null)}><CloseIcon /></IconButton>
              </Stack>
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                {detailSkill.description && (
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">Description</Typography>
                    <Typography variant="body2">{detailSkill.description}</Typography>
                  </Box>
                )}
                <Divider />
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">Instructions</Typography>
                  <Paper variant="outlined" sx={{ p: 2, mt: 0.5, bgcolor: 'action.hover' }}>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: detailSkill.instructions.includes('```') ? 'monospace' : undefined }}>
                      {detailSkill.instructions || 'No instructions provided'}
                    </Typography>
                  </Paper>
                </Box>
                <Divider />
                <Stack direction="row" spacing={3}>
                  <Typography variant="body2"><strong>Version:</strong> {detailSkill.version}</Typography>
                  <Typography variant="body2"><strong>Usage:</strong> {detailSkill.usageCount} times</Typography>
                  <Typography variant="body2"><strong>Created:</strong> {new Date(detailSkill.createdAt).toLocaleDateString()}</Typography>
                  <Typography variant="body2"><strong>By:</strong> {detailSkill.createdBy}</Typography>
                </Stack>
              </Stack>
            </DialogContent>
          </>
        )}
      </Dialog>

      {/* ── Create/Edit Dialog ── */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingSkill ? 'Edit Skill' : 'Create Skill'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Skill Name" fullWidth value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g., Docker Deployment, API Rate Limiting" />
            <TextField label="Description" fullWidth value={description} onChange={(e) => setDescription(e.target.value)} multiline rows={2} placeholder="What does this skill do and when should agents use it?" />
            <TextField label="Category" fullWidth value={category} onChange={(e) => setCategory(e.target.value)} placeholder="General" helperText="e.g., DevOps, Research, Communication, Coding" />
            <TextField
              label="Instructions"
              fullWidth
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              multiline
              rows={8}
              placeholder="Step-by-step instructions for the agent to follow when using this skill..."
              helperText="Markdown supported. Be specific — this is what the agent reads."
            />
            <TextField
              label="Code Snippet (optional)"
              fullWidth
              value={codeSnippet}
              onChange={(e) => setCodeSnippet(e.target.value)}
              multiline
              rows={4}
              placeholder="Optional shell commands, API call templates, etc."
              InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!name.trim() || saving} startIcon={saving ? <CircularProgress size={16} /> : undefined}>
            {saving ? 'Saving...' : editingSkill ? 'Update Skill' : 'Create Skill'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack((s) => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))} variant="filled">{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
