'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Chip, Stack,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Snackbar, Alert, IconButton, LinearProgress, Grid,
  Tooltip, Divider, Paper,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PendingIcon from '@mui/icons-material/Pending';
import CloseIcon from '@mui/icons-material/Close';
import GitHubIcon from '@mui/icons-material/GitHub';
import dynamic from 'next/dynamic';

// Lazy load heavy components
const PlanningMode = dynamic(() => import('@/components/projects/PlanningMode'), { ssr: false });
const ExecutionView = dynamic(() => import('@/components/projects/ExecutionView'), { ssr: false });

interface Project {
  id: string;
  name: string;
  description: string | null;
  repoUrl: string | null;
  status: 'planning' | 'building' | 'qa' | 'completed' | 'failed' | 'paused';
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  taskCount: number;
  agentCount: number;
}

const statusColors: Record<string, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  planning: 'info',
  building: 'primary',
  qa: 'warning',
  completed: 'success',
  failed: 'error',
  paused: 'default',
};

const statusIcons: Record<string, JSX.Element> = {
  planning: <PendingIcon />,
  building: <CircularProgress size={16} />,
  qa: <PendingIcon />,
  completed: <CheckCircleIcon />,
  failed: <ErrorIcon />,
  paused: <PauseIcon />,
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailProject, setDetailProject] = useState<Project | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repoUrl, setRepoUrl] = useState('');

  const reload = useCallback(() => {
    fetch('/api/projects')
      .then((res) => res.json())
      .then((data) => setProjects(data.projects ?? []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const openCreate = () => {
    setName('');
    setDescription('');
    setRepoUrl('');
    setCreateDialogOpen(true);
  };

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          repoUrl: repoUrl.trim() || null,
          status: 'planning',
        }),
      });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: 'Project created', severity: 'success' });
        setCreateDialogOpen(false);
        reload();
        // Open the project detail to start planning
        if (result.project) {
          setDetailProject(result.project);
        }
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [name, description, repoUrl, reload]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('Are you sure you want to delete this project?')) return;
      try {
        const res = await fetch(`/api/projects?id=${id}`, { method: 'DELETE' });
        const result = await res.json();
        if (result.error) {
          setSnack({ open: true, message: result.error, severity: 'error' });
        } else {
          setSnack({ open: true, message: 'Project deleted', severity: 'success' });
          if (detailProject?.id === id) setDetailProject(null);
          reload();
        }
      } catch (err: any) {
        setSnack({ open: true, message: err.message, severity: 'error' });
      }
    },
    [detailProject, reload]
  );

  const handleStartBuild = useCallback(
    async (projectId: string) => {
      if (!confirm('Start building this project? This will launch the agent swarm.')) return;
      try {
        const res = await fetch('/api/projects/build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, agentCount: 4 }),
        });
        const result = await res.json();
        if (result.error) {
          setSnack({ open: true, message: result.error, severity: 'error' });
        } else {
          setSnack({ open: true, message: 'Project build started!', severity: 'success' });
          reload();
        }
      } catch (err: any) {
        setSnack({ open: true, message: err.message, severity: 'error' });
      }
    },
    [reload]
  );

  const handlePauseBuild = useCallback(
    async (projectId: string) => {
      if (!confirm('Pause this project?')) return;
      try {
        const res = await fetch('/api/projects/build', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
        });
        const result = await res.json();
        if (result.error) {
          setSnack({ open: true, message: result.error, severity: 'error' });
        } else {
          setSnack({ open: true, message: 'Project paused', severity: 'success' });
          reload();
        }
      } catch (err: any) {
        setSnack({ open: true, message: err.message, severity: 'error' });
      }
    },
    [reload]
  );

  const handleResumeBuild = useCallback(
    async (projectId: string) => {
      if (!confirm('Resume this project? Stuck tasks will be reset and agents will be re-launched.')) return;
      try {
        const res = await fetch('/api/projects/build', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, agentCount: 4 }),
        });
        const result = await res.json();
        if (result.error) {
          setSnack({ open: true, message: result.error, severity: 'error' });
        } else {
          setSnack({ open: true, message: 'Project resumed!', severity: 'success' });
          reload();
        }
      } catch (err: any) {
        setSnack({ open: true, message: err.message, severity: 'error' });
      }
    },
    [reload]
  );

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Projects</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          New Project
        </Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && projects.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <AccountTreeIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">No projects yet</Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Create your first project to start building with AI agent swarms.
          </Typography>
          <Button variant="outlined" onClick={openCreate}>
            Create Project
          </Button>
        </Box>
      )}

      <Grid container spacing={3}>
        {projects.map((project) => (
          <Grid item xs={12} sm={6} md={4} key={project.id}>
            <Card
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                '&:hover': { boxShadow: 4 },
                transition: 'box-shadow 0.2s',
              }}
            >
              <CardContent sx={{ flexGrow: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="h6" gutterBottom>
                      {project.name}
                    </Typography>
                    <Chip
                      size="small"
                      label={project.status}
                      color={statusColors[project.status]}
                      icon={statusIcons[project.status]}
                      sx={{ textTransform: 'capitalize' }}
                    />
                  </Box>
                  <IconButton size="small" onClick={() => handleDelete(project.id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>

                {project.description && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {project.description}
                  </Typography>
                )}

                <Divider sx={{ my: 2 }} />

                <Stack spacing={1}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" color="text.secondary">
                      Tasks
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {project.taskCount}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" color="text.secondary">
                      Agents
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {project.agentCount}
                    </Typography>
                  </Box>
                  {project.repoUrl && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="caption" color="text.secondary">
                        <GitHubIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'text-bottom' }} />
                        Repo
                      </Typography>
                      <Tooltip title={project.repoUrl}>
                        <Typography variant="caption" sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {project.repoUrl.replace(/^.*[:/]([^/]+\/[^/]+?)(?:\.git)?$/, '$1')}
                        </Typography>
                      </Tooltip>
                    </Box>
                  )}
                  {project.startedAt && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="caption" color="text.secondary">
                        Started
                      </Typography>
                      <Typography variant="caption">
                        {new Date(project.startedAt).toLocaleString()}
                      </Typography>
                    </Box>
                  )}
                </Stack>
              </CardContent>

              <Box sx={{ p: 2, pt: 0, display: 'flex', gap: 1 }}>
                <Button
                  fullWidth
                  size="small"
                  variant="outlined"
                  startIcon={<VisibilityIcon />}
                  onClick={() => setDetailProject(project)}
                >
                  View
                </Button>
                {project.status === 'planning' && (
                  <Button
                    fullWidth
                    size="small"
                    variant="contained"
                    startIcon={<PlayArrowIcon />}
                    onClick={() => handleStartBuild(project.id)}
                  >
                    Build
                  </Button>
                )}
                {project.status === 'building' && (
                  <Button
                    fullWidth
                    size="small"
                    variant="outlined"
                    startIcon={<PauseIcon />}
                    onClick={() => handlePauseBuild(project.id)}
                  >
                    Pause
                  </Button>
                )}
                {project.status === 'paused' && (
                  <Button
                    fullWidth
                    size="small"
                    variant="contained"
                    startIcon={<PlayArrowIcon />}
                    onClick={() => handleResumeBuild(project.id)}
                  >
                    Resume
                  </Button>
                )}
              </Box>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Create Project Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Project</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Project Name"
              fullWidth
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <TextField
              label="Description"
              fullWidth
              multiline
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <TextField
              label="Repository URL"
              fullWidth
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="git@github.com:user/repo.git or https://github.com/user/repo.git"
              helperText="Optional — Git repository that agents will push to and pull from"
            />
            <Typography variant="body2" color="text.secondary">
              After creating the project, you'll enter planning mode to generate a PRD and define tasks.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} variant="contained" disabled={saving || !name.trim()}>
            {saving ? 'Creating...' : 'Create Project'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Project Detail Dialog */}
      <Dialog
        open={!!detailProject}
        onClose={() => setDetailProject(null)}
        maxWidth="xl"
        fullWidth
        fullScreen
        PaperProps={{ sx: { height: '100vh' } }}
      >
        {detailProject && (
          <>
            <DialogTitle>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="h5">{detailProject.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {detailProject.description}
                  </Typography>
                </Box>
                <IconButton onClick={() => setDetailProject(null)}>
                  <CloseIcon />
                </IconButton>
              </Box>
            </DialogTitle>
            <DialogContent sx={{ p: 3, height: 'calc(100% - 80px)' }}>
              {detailProject.status === 'planning' ? (
                <PlanningMode
                  projectId={detailProject.id}
                  projectName={detailProject.name}
                  onComplete={async (prd, tasks) => {
                    try {
                      // Save PRD
                      await fetch(`/api/projects?id=${detailProject.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prd }),
                      });

                      // Create tasks
                      for (const task of tasks) {
                        await fetch('/api/projects/tasks', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            projectId: detailProject.id,
                            ...task,
                          }),
                        });
                      }

                      // Start build
                      await handleStartBuild(detailProject.id);
                      setDetailProject(null);
                    } catch (error: any) {
                      setSnack({ open: true, message: error.message, severity: 'error' });
                    }
                  }}
                  onCancel={() => setDetailProject(null)}
                />
              ) : (
                <ExecutionView projectId={detailProject.id} />
              )}
            </DialogContent>
          </>
        )}
      </Dialog>

      <Snackbar
        open={snack.open}
        autoHideDuration={6000}
        onClose={() => setSnack({ ...snack, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snack.severity} variant="filled">
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
