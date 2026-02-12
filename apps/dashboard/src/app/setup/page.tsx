'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Stepper, Step, StepLabel,
  Stack, Container, Alert, CircularProgress, Chip, LinearProgress, Divider,
  IconButton, Tooltip,
} from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import StorageIcon from '@mui/icons-material/Storage';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import LanguageIcon from '@mui/icons-material/Language';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const steps = [
  'Database',
  'Redis',
  'Initialize',
  'Admin Account',
  'Create Team',
  'API Keys',
  'Vault Passphrase',
  'Add Worker',
  'Done',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
type InstallStatus = 'idle' | 'installing' | 'done' | 'error';

interface FormData {
  databaseUrl: string;
  redisUrl: string;
  email: string;
  password: string;
  displayName: string;
  teamName: string;
  apiKey: string;
  passphrase: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SetupPage() {
  const [activeStep, setActiveStep] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ai-engine-setup-step');
      return saved ? parseInt(saved, 10) : 0;
    }
    return 0;
  });

  const [formData, setFormData] = useState<FormData>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ai-engine-setup-form');
      if (saved) return JSON.parse(saved);
    }
    return {
      databaseUrl: 'postgresql://ai_engine:ai_engine_password@localhost:5432/ai_engine',
      redisUrl: 'redis://localhost:6379',
      email: '', password: '', displayName: '',
      teamName: '', apiKey: '', passphrase: '',
    };
  });

  // -- Connection test state --
  const [pgStatus, setPgStatus] = useState<TestStatus>('idle');
  const [pgMessage, setPgMessage] = useState('');
  const [redisStatus, setRedisStatus] = useState<TestStatus>('idle');
  const [redisMessage, setRedisMessage] = useState('');

  // -- Auto-install state --
  const [pgInstallStatus, setPgInstallStatus] = useState<InstallStatus>('idle');
  const [pgInstallLog, setPgInstallLog] = useState('');
  const [redisInstallStatus, setRedisInstallStatus] = useState<InstallStatus>('idle');
  const [redisInstallLog, setRedisInstallLog] = useState('');

  // -- Initialize state --
  const [initStatus, setInitStatus] = useState<'idle' | 'running' | 'restarting' | 'done' | 'error'>('idle');
  const [initMessage, setInitMessage] = useState('');

  // -- Worker install command --
  const [copied, setCopied] = useState(false);

  // -- Tunnel URL --
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [tunnelCopied, setTunnelCopied] = useState(false);

  // Persist wizard state
  useEffect(() => {
    localStorage.setItem('ai-engine-setup-step', String(activeStep));
    localStorage.setItem('ai-engine-setup-form', JSON.stringify(formData));
  }, [activeStep, formData]);

  // Poll tunnel status for the remote access banner
  useEffect(() => {
    const poll = () => {
      fetch('/api/tunnel/status')
        .then((r) => r.json())
        .then((d) => { if (d.url) setTunnelUrl(d.url); })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  const updateField = (field: keyof FormData, value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handleNext = () => setActiveStep((prev) => Math.min(prev + 1, steps.length - 1));
  const handleBack = () => setActiveStep((prev) => Math.max(prev - 1, 0));

  // ── Test PostgreSQL ──
  const testPostgres = useCallback(async () => {
    setPgStatus('testing');
    setPgMessage('');
    try {
      const res = await fetch('/api/setup/test-postgres', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: formData.databaseUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setPgStatus('success');
        setPgMessage(data.warning ?? data.message);
      } else {
        setPgStatus('error');
        setPgMessage(data.error);
      }
    } catch (err: any) {
      setPgStatus('error');
      setPgMessage(err.message);
    }
  }, [formData.databaseUrl]);

  // ── Auto-install PostgreSQL ──
  const installPostgres = useCallback(async () => {
    setPgInstallStatus('installing');
    setPgInstallLog('Installing PostgreSQL and pgvector... This may take a few minutes.');
    try {
      const res = await fetch('/api/setup/install-postgres', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setPgInstallStatus('done');
        setPgInstallLog(data.message);
        // Auto-fill the connection URL
        updateField('databaseUrl', data.connectionUrl);
        // Auto-test
        setPgStatus('success');
        setPgMessage(data.message);
      } else {
        setPgInstallStatus('error');
        setPgInstallLog(data.error + (data.instructions ? '\n\n' + data.instructions.join('\n') : ''));
      }
    } catch (err: any) {
      setPgInstallStatus('error');
      setPgInstallLog(err.message);
    }
  }, []);

  // ── Test Redis ──
  const testRedis = useCallback(async () => {
    setRedisStatus('testing');
    setRedisMessage('');
    try {
      const res = await fetch('/api/setup/test-redis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: formData.redisUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setRedisStatus('success');
        setRedisMessage(data.message);
      } else {
        setRedisStatus('error');
        setRedisMessage(data.error);
      }
    } catch (err: any) {
      setRedisStatus('error');
      setRedisMessage(err.message);
    }
  }, [formData.redisUrl]);

  // ── Auto-install Redis ──
  const installRedis = useCallback(async () => {
    setRedisInstallStatus('installing');
    setRedisInstallLog('Installing Redis... This may take a minute.');
    try {
      const res = await fetch('/api/setup/install-redis', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setRedisInstallStatus('done');
        setRedisInstallLog(data.message);
        updateField('redisUrl', data.connectionUrl);
        setRedisStatus('success');
        setRedisMessage(data.message);
      } else {
        setRedisInstallStatus('error');
        setRedisInstallLog(data.error + (data.instructions ? '\n\n' + data.instructions.join('\n') : ''));
      }
    } catch (err: any) {
      setRedisInstallStatus('error');
      setRedisInstallLog(err.message);
    }
  }, []);

  // ── Initialize ──
  const runInitialize = useCallback(async () => {
    setInitStatus('running');
    setInitMessage('Writing configuration and running database migrations...');

    try {
      const res = await fetch('/api/setup/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseUrl: formData.databaseUrl, redisUrl: formData.redisUrl }),
      });
      const data = await res.json();

      if (!data.success) {
        setInitStatus('error');
        setInitMessage(data.error);
        return;
      }

      if (data.restart) {
        setInitStatus('restarting');
        setInitMessage('Migrations complete. Server is restarting...');
        await pollForRestart();
      } else {
        setInitStatus('done');
        setInitMessage('Database initialized successfully.');
        setTimeout(() => handleNext(), 1000);
      }
    } catch (err: any) {
      if (err.message.includes('fetch') || err.message.includes('Failed')) {
        setInitStatus('restarting');
        setInitMessage('Server is restarting...');
        await pollForRestart();
      } else {
        setInitStatus('error');
        setInitMessage(err.message);
      }
    }
  }, [formData.databaseUrl, formData.redisUrl]);

  const pollForRestart = async () => {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const healthRes = await fetch('/api/health');
        if (healthRes.ok) {
          setInitStatus('done');
          setInitMessage('Server restarted successfully. Database is ready.');
          setTimeout(() => handleNext(), 1000);
          return;
        }
      } catch { /* keep polling */ }
    }
    setInitStatus('error');
    setInitMessage('Server did not come back. Please refresh the page.');
  };

  // ── Helpers ──
  const isNextDisabled = () => {
    if (activeStep === 0) return pgStatus !== 'success';
    if (activeStep === 1) return redisStatus !== 'success';
    if (activeStep === 2) return initStatus !== 'done';
    if (activeStep === 3) return !formData.email || !formData.password || !formData.displayName;
    if (activeStep === 6) return !formData.passphrase;
    return false;
  };

  const getNextLabel = () => {
    if (activeStep === steps.length - 1) return 'Go to Dashboard';
    if (activeStep === 4) return 'Skip / Next';
    return 'Next';
  };

  const handleNextClick = () => {
    if (activeStep === steps.length - 1) {
      localStorage.removeItem('ai-engine-setup-step');
      localStorage.removeItem('ai-engine-setup-form');
      window.location.href = '/';
      return;
    }
    handleNext();
  };

  const serverUrl = tunnelUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com');
  const installCommand = `curl -sSL "${serverUrl}/api/worker/install-script?token=REPLACE_WITH_TOKEN" | bash`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const StatusIcon = ({ status }: { status: TestStatus }) => {
    if (status === 'testing') return <CircularProgress size={20} />;
    if (status === 'success') return <CheckCircleIcon color="success" />;
    if (status === 'error') return <ErrorIcon color="error" />;
    return null;
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', p: 2 }}>
      <Container maxWidth="sm">
        <Stack alignItems="center" spacing={2} mb={4}>
          <SmartToyIcon sx={{ fontSize: 48, color: 'primary.main' }} />
          <Typography variant="h4" fontWeight={700}>AI Engine Setup</Typography>
          <Typography color="text.secondary">Let&apos;s get your system configured</Typography>
        </Stack>

        {/* Tunnel remote access banner */}
        {tunnelUrl && (
          <Paper
            variant="outlined"
            sx={{
              p: 1.5, mb: 3, display: 'flex', alignItems: 'center', gap: 1.5,
              bgcolor: 'action.hover', borderColor: 'primary.main',
            }}
          >
            <LanguageIcon color="primary" sx={{ fontSize: 20 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">Remote access URL (HTTPS)</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {tunnelUrl}
              </Typography>
            </Box>
            <Tooltip title={tunnelCopied ? 'Copied!' : 'Copy URL'}>
              <IconButton
                size="small"
                onClick={() => {
                  navigator.clipboard.writeText(tunnelUrl);
                  setTunnelCopied(true);
                  setTimeout(() => setTunnelCopied(false), 2000);
                }}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Open in new tab">
              <IconButton size="small" component="a" href={tunnelUrl} target="_blank" rel="noopener">
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Paper>
        )}

        <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}><StepLabel>{label}</StepLabel></Step>
          ))}
        </Stepper>

        <Paper sx={{ p: 4 }}>

          {/* ── Step 0: PostgreSQL ─────────────────────────────── */}
          {activeStep === 0 && (
            <Stack spacing={2}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <StorageIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>Connect to PostgreSQL</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Provide your PostgreSQL 16+ connection string, or let us install it for you.
              </Typography>

              <TextField
                label="PostgreSQL Connection String"
                fullWidth
                value={formData.databaseUrl}
                onChange={(e) => { updateField('databaseUrl', e.target.value); setPgStatus('idle'); }}
                placeholder="postgresql://user:password@host:5432/database"
                inputProps={{ spellCheck: false }}
              />

              <Stack direction="row" alignItems="center" spacing={2}>
                <Button
                  variant="outlined"
                  onClick={testPostgres}
                  disabled={pgStatus === 'testing' || !formData.databaseUrl}
                >
                  {pgStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                </Button>
                <StatusIcon status={pgStatus} />
              </Stack>

              {pgMessage && (
                <Alert severity={pgStatus === 'success' ? 'success' : pgStatus === 'error' ? 'error' : 'info'}>
                  {pgMessage}
                </Alert>
              )}

              <Divider sx={{ my: 1 }} />

              <Typography variant="body2" color="text.secondary">
                Don&apos;t have PostgreSQL? We can install it on this machine automatically.
              </Typography>

              {pgInstallStatus === 'idle' && (
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={installPostgres}
                  startIcon={<DownloadIcon />}
                >
                  Install PostgreSQL + pgvector on this machine
                </Button>
              )}

              {pgInstallStatus === 'installing' && (
                <Stack spacing={1}>
                  <LinearProgress />
                  <Typography variant="body2" color="text.secondary">{pgInstallLog}</Typography>
                </Stack>
              )}

              {pgInstallStatus === 'done' && (
                <Alert severity="success">{pgInstallLog}</Alert>
              )}

              {pgInstallStatus === 'error' && (
                <Stack spacing={1}>
                  <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>{pgInstallLog}</Alert>
                  <Button variant="outlined" onClick={installPostgres}>Retry Installation</Button>
                </Stack>
              )}
            </Stack>
          )}

          {/* ── Step 1: Redis ─────────────────────────────────── */}
          {activeStep === 1 && (
            <Stack spacing={2}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <StorageIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>Connect to Redis</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Provide your Redis 7+ connection string, or let us install it for you.
              </Typography>

              <TextField
                label="Redis Connection String"
                fullWidth
                value={formData.redisUrl}
                onChange={(e) => { updateField('redisUrl', e.target.value); setRedisStatus('idle'); }}
                placeholder="redis://localhost:6379"
                inputProps={{ spellCheck: false }}
              />

              <Stack direction="row" alignItems="center" spacing={2}>
                <Button
                  variant="outlined"
                  onClick={testRedis}
                  disabled={redisStatus === 'testing' || !formData.redisUrl}
                >
                  {redisStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                </Button>
                <StatusIcon status={redisStatus} />
              </Stack>

              {redisMessage && (
                <Alert severity={redisStatus === 'success' ? 'success' : redisStatus === 'error' ? 'error' : 'info'}>
                  {redisMessage}
                </Alert>
              )}

              <Divider sx={{ my: 1 }} />

              <Typography variant="body2" color="text.secondary">
                Don&apos;t have Redis? We can install it on this machine automatically.
              </Typography>

              {redisInstallStatus === 'idle' && (
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={installRedis}
                  startIcon={<DownloadIcon />}
                >
                  Install Redis on this machine
                </Button>
              )}

              {redisInstallStatus === 'installing' && (
                <Stack spacing={1}>
                  <LinearProgress />
                  <Typography variant="body2" color="text.secondary">{redisInstallLog}</Typography>
                </Stack>
              )}

              {redisInstallStatus === 'done' && (
                <Alert severity="success">{redisInstallLog}</Alert>
              )}

              {redisInstallStatus === 'error' && (
                <Stack spacing={1}>
                  <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>{redisInstallLog}</Alert>
                  <Button variant="outlined" onClick={installRedis}>Retry Installation</Button>
                </Stack>
              )}
            </Stack>
          )}

          {/* ── Step 2: Initialize ────────────────────────────── */}
          {activeStep === 2 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={600}>Initialize Database</Typography>
              <Typography variant="body2" color="text.secondary">
                This will save your configuration and run database migrations.
                The server will restart briefly to apply the new settings.
              </Typography>

              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                <Typography variant="body2"><strong>PostgreSQL:</strong> {formData.databaseUrl.replace(/:[^@]*@/, ':***@')}</Typography>
                <Typography variant="body2"><strong>Redis:</strong> {formData.redisUrl}</Typography>
              </Paper>

              {initStatus === 'idle' && (
                <Button variant="contained" onClick={runInitialize} size="large">
                  Initialize &amp; Apply Configuration
                </Button>
              )}

              {(initStatus === 'running' || initStatus === 'restarting') && (
                <Stack spacing={1}>
                  <LinearProgress />
                  <Typography variant="body2" color="text.secondary">{initMessage}</Typography>
                </Stack>
              )}

              {initStatus === 'done' && <Alert severity="success">{initMessage}</Alert>}

              {initStatus === 'error' && (
                <Stack spacing={1}>
                  <Alert severity="error">{initMessage}</Alert>
                  <Button variant="outlined" onClick={runInitialize}>Retry</Button>
                </Stack>
              )}
            </Stack>
          )}

          {/* ── Step 3: Admin Account ─────────────────────────── */}
          {activeStep === 3 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={600}>Create Admin Account</Typography>
              <TextField label="Display Name" fullWidth value={formData.displayName} onChange={(e) => updateField('displayName', e.target.value)} />
              <TextField label="Email" fullWidth type="email" value={formData.email} onChange={(e) => updateField('email', e.target.value)} />
              <TextField label="Password" fullWidth type="password" value={formData.password} onChange={(e) => updateField('password', e.target.value)} />
            </Stack>
          )}

          {/* ── Step 4: Create Team ───────────────────────────── */}
          {activeStep === 4 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={600}>Create Your First Team</Typography>
              <Typography variant="body2" color="text.secondary">Optional. You can skip this and create teams later.</Typography>
              <TextField label="Team Name" fullWidth value={formData.teamName} onChange={(e) => updateField('teamName', e.target.value)} placeholder="e.g., Engineering, Personal" />
            </Stack>
          )}

          {/* ── Step 5: API Keys ──────────────────────────────── */}
          {activeStep === 5 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={600}>Add Claude API Keys</Typography>
              <Typography variant="body2" color="text.secondary">Add one or more Claude API keys. More keys = better load distribution.</Typography>
              <TextField label="Claude API Key" fullWidth value={formData.apiKey} onChange={(e) => updateField('apiKey', e.target.value)} placeholder="sk-ant-..." />
              <Alert severity="info">Each key is validated with a test call before saving.</Alert>
            </Stack>
          )}

          {/* ── Step 6: Vault Passphrase ──────────────────────── */}
          {activeStep === 6 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={600}>Vault Passphrase</Typography>
              <Typography variant="body2" color="text.secondary">This encrypts all stored credentials. Keep it safe — it cannot be recovered.</Typography>
              <TextField label="Passphrase" fullWidth type="password" value={formData.passphrase} onChange={(e) => updateField('passphrase', e.target.value)} />
            </Stack>
          )}

          {/* ── Step 7: Add Worker ────────────────────────────── */}
          {activeStep === 7 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={600}>Add Your First Worker</Typography>
              <Typography variant="body2" color="text.secondary">
                Run this command on any machine to install and join a worker.
                The worker downloads everything it needs from this dashboard and connects via WebSocket — no git repository, database, or Redis access required on the worker.
              </Typography>

              <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', borderRadius: 2, fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', position: 'relative' }}>
                {installCommand}
                <Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}>
                  <IconButton
                    size="small"
                    onClick={() => copyToClipboard(installCommand)}
                    sx={{ position: 'absolute', top: 4, right: 4, color: 'grey.400' }}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Paper>

              <Alert severity="info" variant="outlined">
                Replace <code>REPLACE_WITH_TOKEN</code> with a join token generated from the Workers page after setup.
                The install script will:
                <Box component="ol" sx={{ m: 0, pl: 2.5, mt: 0.5 }}>
                  <li>Install Node.js and pnpm if needed</li>
                  <li>Download the worker bundle from this dashboard</li>
                  <li>Install dependencies</li>
                  <li>Register with the dashboard (WebSocket authentication)</li>
                  <li>Register as a system service (auto-start on boot)</li>
                  <li>Start the worker</li>
                </Box>
              </Alert>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">Waiting for first worker to connect...</Typography>
              </Box>
            </Stack>
          )}

          {/* ── Step 8: Done ──────────────────────────────────── */}
          {activeStep === 8 && (
            <Stack spacing={2} alignItems="center">
              <Typography variant="h6" fontWeight={600}>All Set!</Typography>
              <Chip label="Setup Complete" color="success" />
              <Typography variant="body2" color="text.secondary" textAlign="center">
                Your AI Engine is ready. Click below to open the dashboard.
              </Typography>
            </Stack>
          )}

          {/* ── Navigation ────────────────────────────────────── */}
          {!(activeStep === 2 && (initStatus === 'running' || initStatus === 'restarting')) && (
            <Stack direction="row" justifyContent="space-between" sx={{ mt: 4 }}>
              <Button onClick={handleBack} disabled={activeStep === 0 || activeStep === 2}>Back</Button>
              <Button variant="contained" onClick={handleNextClick} disabled={isNextDisabled()}>
                {getNextLabel()}
              </Button>
            </Stack>
          )}
        </Paper>
      </Container>
    </Box>
  );
}
