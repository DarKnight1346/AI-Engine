'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Box, Typography, Paper, Grid, LinearProgress, Chip, Card,
  CardContent, List, ListItem, ListItemText, Divider, Stack,
  CircularProgress, IconButton, Tooltip, Button, Alert, TextField,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PendingIcon from '@mui/icons-material/Pending';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import LockIcon from '@mui/icons-material/Lock';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RefreshIcon from '@mui/icons-material/Refresh';
import GitHubIcon from '@mui/icons-material/GitHub';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';

interface ExecutionViewProps {
  projectId: string;
}

interface ProjectDetail {
  id: string;
  name: string;
  status: string;
  repoUrl: string | null;
  tasks: ProjectTask[];
  agents: ProjectAgent[];
  iterations: ProjectIteration[];
  logs: ProjectLog[];
}

interface ProjectTask {
  id: string;
  title: string;
  description: string;
  taskType: string;
  status: string;
  priority: number;
  assignedAgentId: string | null;
  lockedBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

interface ProjectAgent {
  id: string;
  agentId: string;
  role: string;
  status: string;
  currentTask: string | null;
  statsJson: any;
  lastActiveAt: string;
}

interface ProjectIteration {
  id: string;
  iteration: number;
  phase: string;
  status: string;
  summary: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface ProjectLog {
  id: string;
  level: string;
  message: string;
  timestamp: string;
  agentId: string | null;
}

const taskStatusColors: Record<string, 'default' | 'primary' | 'success' | 'error' | 'warning'> = {
  pending: 'default',
  locked: 'warning',
  in_progress: 'primary',
  completed: 'success',
  failed: 'error',
  blocked: 'error',
};

const taskStatusIcons: Record<string, JSX.Element> = {
  pending: <PendingIcon />,
  locked: <LockIcon />,
  in_progress: <CircularProgress size={16} />,
  completed: <CheckCircleIcon />,
  failed: <ErrorIcon />,
  blocked: <ErrorIcon />,
};

export default function ExecutionView({ projectId }: ExecutionViewProps) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [resuming, setResuming] = useState(false);
  const [editingRepoUrl, setEditingRepoUrl] = useState(false);
  const [repoUrlDraft, setRepoUrlDraft] = useState('');
  const [savingRepoUrl, setSavingRepoUrl] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const loadProject = async () => {
    try {
      const res = await fetch(`/api/projects?id=${projectId}`);
      const data = await res.json();
      if (data.project) {
        setProject(data.project);
      }
    } catch (error) {
      console.error('Failed to load project:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    if (!confirm('Resume this project? Stuck tasks will be reset and agents will be re-launched.')) return;
    setResuming(true);
    try {
      const res = await fetch('/api/projects/build', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, agentCount: 4 }),
      });
      const result = await res.json();
      if (!result.error) {
        await loadProject();
      }
    } catch (err) {
      console.error('Failed to resume project:', err);
    } finally {
      setResuming(false);
    }
  };

  const startEditingRepoUrl = () => {
    setRepoUrlDraft(project?.repoUrl ?? '');
    setEditingRepoUrl(true);
  };

  const cancelEditingRepoUrl = () => {
    setEditingRepoUrl(false);
    setRepoUrlDraft('');
  };

  const saveRepoUrl = async () => {
    setSavingRepoUrl(true);
    try {
      const res = await fetch(`/api/projects?id=${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repoUrlDraft.trim() || null }),
      });
      const result = await res.json();
      if (!result.error) {
        setEditingRepoUrl(false);
        await loadProject();
      }
    } catch (err) {
      console.error('Failed to save repo URL:', err);
    } finally {
      setSavingRepoUrl(false);
    }
  };

  useEffect(() => {
    loadProject();
  }, [projectId]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadProject, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, [autoRefresh, projectId]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [project?.logs]);

  if (loading || !project) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    );
  }

  const taskStats = {
    total: project.tasks.length,
    pending: project.tasks.filter((t) => t.status === 'pending').length,
    inProgress: project.tasks.filter((t) => t.status === 'in_progress' || t.status === 'locked').length,
    completed: project.tasks.filter((t) => t.status === 'completed').length,
    failed: project.tasks.filter((t) => t.status === 'failed').length,
  };

  const progress = taskStats.total > 0 ? (taskStats.completed / taskStats.total) * 100 : 0;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
      {/* Header Stats */}
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box>
            <Typography variant="h6">{project.name}</Typography>
            {editingRepoUrl ? (
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
                <GitHubIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <TextField
                  size="small"
                  variant="outlined"
                  value={repoUrlDraft}
                  onChange={(e) => setRepoUrlDraft(e.target.value)}
                  placeholder="git@github.com:user/repo.git"
                  sx={{ minWidth: 350, '& .MuiInputBase-input': { fontSize: '0.8rem', fontFamily: 'monospace', py: 0.5 } }}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRepoUrl();
                    if (e.key === 'Escape') cancelEditingRepoUrl();
                  }}
                  disabled={savingRepoUrl}
                />
                <IconButton size="small" onClick={saveRepoUrl} disabled={savingRepoUrl} color="primary">
                  <CheckIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" onClick={cancelEditingRepoUrl} disabled={savingRepoUrl}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
            ) : project.repoUrl ? (
              <Stack direction="row" spacing={0.5} alignItems="center">
                <GitHubIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                  {project.repoUrl}
                </Typography>
                {project.status === 'paused' && (
                  <IconButton size="small" onClick={startEditingRepoUrl} sx={{ ml: 0.5 }}>
                    <EditIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                )}
              </Stack>
            ) : project.status === 'paused' ? (
              <Button
                size="small"
                variant="text"
                startIcon={<GitHubIcon sx={{ fontSize: 14 }} />}
                onClick={startEditingRepoUrl}
                sx={{ mt: 0.5, textTransform: 'none', fontSize: '0.75rem' }}
              >
                Set repository URL
              </Button>
            ) : null}
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip label={project.status} color={project.status === 'paused' ? 'default' : 'primary'} />
            {project.status === 'paused' && (
              <Button
                size="small"
                variant="contained"
                startIcon={<PlayArrowIcon />}
                onClick={handleResume}
                disabled={resuming}
              >
                {resuming ? 'Resuming...' : 'Resume'}
              </Button>
            )}
            <IconButton size="small" onClick={loadProject}>
              <RefreshIcon />
            </IconButton>
          </Stack>
        </Box>

        <Box sx={{ mb: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Overall Progress
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {taskStats.completed} / {taskStats.total} tasks
            </Typography>
          </Box>
          <LinearProgress variant="determinate" value={progress} sx={{ height: 8, borderRadius: 4 }} />
        </Box>

        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Chip label={`Pending: ${taskStats.pending}`} size="small" />
          <Chip label={`In Progress: ${taskStats.inProgress}`} size="small" color="primary" />
          <Chip label={`Completed: ${taskStats.completed}`} size="small" color="success" />
          {taskStats.failed > 0 && <Chip label={`Failed: ${taskStats.failed}`} size="small" color="error" />}
        </Stack>
      </Paper>

      <Grid container spacing={2} sx={{ flexGrow: 1, overflow: 'hidden' }}>
        {/* Agents Column */}
        <Grid item xs={12} md={3} sx={{ height: '100%', overflow: 'auto' }}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              Agents ({project.agents.length})
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <List dense>
              {project.agents.map((agent) => (
                <Card key={agent.id} sx={{ mb: 1 }}>
                  <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <SmartToyIcon fontSize="small" />
                      <Typography variant="subtitle2">Agent {agent.agentId.slice(0, 8)}</Typography>
                    </Box>
                    <Stack direction="row" spacing={0.5} sx={{ mb: 1 }}>
                      <Chip label={agent.status} size="small" color={agent.status === 'working' ? 'primary' : 'default'} />
                      <Chip label={agent.role} size="small" variant="outlined" />
                    </Stack>
                    {agent.currentTask && (
                      <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                        Task: {project.tasks.find((t) => t.id === agent.currentTask)?.title}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                      Last active: {new Date(agent.lastActiveAt).toLocaleTimeString()}
                    </Typography>
                  </CardContent>
                </Card>
              ))}
              {project.agents.length === 0 && (
                <Alert severity="info">No agents running yet</Alert>
              )}
            </List>
          </Paper>
        </Grid>

        {/* Tasks Column */}
        <Grid item xs={12} md={5} sx={{ height: '100%', overflow: 'auto' }}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              Tasks
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <List dense>
              {project.tasks.map((task) => (
                <Card key={task.id} sx={{ mb: 1 }}>
                  <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="subtitle2" gutterBottom>
                          {task.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                          {task.description}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
                          <Chip
                            label={task.status}
                            size="small"
                            color={taskStatusColors[task.status]}
                            icon={taskStatusIcons[task.status]}
                          />
                          <Chip label={task.taskType} size="small" variant="outlined" />
                          {task.assignedAgentId && (
                            <Chip label={`Agent ${task.assignedAgentId.slice(0, 6)}`} size="small" variant="outlined" />
                          )}
                        </Box>
                        {task.errorMessage && (
                          <Alert severity="error" sx={{ mt: 1 }}>
                            {task.errorMessage}
                          </Alert>
                        )}
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </List>
          </Paper>
        </Grid>

        {/* Logs Column */}
        <Grid item xs={12} md={4} sx={{ height: '100%', overflow: 'auto' }}>
          <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Typography variant="h6" gutterBottom>
              Activity Log
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
              <List dense>
                {project.logs.map((log) => (
                  <ListItem key={log.id} sx={{ px: 0 }}>
                    <Box sx={{ width: '100%' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {log.level === 'error' && <ErrorIcon fontSize="small" color="error" />}
                        {log.level === 'success' && <CheckCircleIcon fontSize="small" color="success" />}
                        {log.level === 'info' && <PendingIcon fontSize="small" color="info" />}
                        <Typography variant="caption" color="text.secondary">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </Typography>
                      </Box>
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        {log.message}
                      </Typography>
                    </Box>
                  </ListItem>
                ))}
                <div ref={logsEndRef} />
              </List>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
