'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Stack, Tabs, Tab,
  List, ListItem, ListItemText, Switch, Chip, Select, MenuItem,
  FormControl, InputLabel, ToggleButtonGroup, ToggleButton,
  LinearProgress, Alert, CircularProgress, Divider, Skeleton,
  IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions,
  Snackbar,
} from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import SystemUpdateIcon from '@mui/icons-material/SystemUpdate';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import NewReleasesIcon from '@mui/icons-material/NewReleases';
import LanguageIcon from '@mui/icons-material/Language';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import ClaudeMaxSetup from '../../../components/setup/ClaudeMaxSetup';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiKeyInfo {
  id: string;
  label: string;
  isActive: boolean;
  tierMapping: Record<string, string>;
  usageStats: Record<string, number>;
  createdAt: string;
}

interface UserInfo {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

interface SystemInfo {
  version: string;
  onlineWorkers: number;
  totalWorkers: number;
  lastSchedulerTick: string | null;
}

interface SettingsData {
  apiKeys: ApiKeyInfo[];
  user: UserInfo | null;
  config: Record<string, unknown>;
  system: SystemInfo;
}

interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion?: string;
  currentCommit?: string;
  remoteCommit?: string;
  branch?: string;
  commitsBehind?: number;
  newCommits?: Array<{ hash: string; message: string; date: string }>;
  error?: string;
}

interface TunnelStatus {
  status: string;
  url: string | null;
  mode: 'quick' | 'named';
  hostname: string | null;
  tunnelId: string | null;
  error: string | null;
}

interface CfZone {
  id: string;
  name: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'warning' }>({ open: false, message: '', severity: 'success' });

  // ── API Key dialog ──
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newKeyProvider, setNewKeyProvider] = useState<'anthropic-api' | 'setup-token'>('setup-token');
  const [addingKey, setAddingKey] = useState(false);
  const [deleteKeyId, setDeleteKeyId] = useState<string | null>(null);

  // ── Config editing state ──
  const [configEdits, setConfigEdits] = useState<Record<string, unknown>>({});
  const [savingConfig, setSavingConfig] = useState(false);

  // ── Account editing state ──
  const [displayNameEdit, setDisplayNameEdit] = useState('');
  const [savingAccount, setSavingAccount] = useState(false);

  // ── Password dialog ──
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // ── Vault passphrase dialog ──
  const [passphraseOpen, setPassphraseOpen] = useState(false);
  const [currentPassphrase, setCurrentPassphrase] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [changingPassphrase, setChangingPassphrase] = useState(false);

  // ── Update state ──
  const [checkStatus, setCheckStatus] = useState<'idle' | 'checking' | 'done' | 'error'>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [applyStatus, setApplyStatus] = useState<'idle' | 'applying' | 'restarting' | 'done' | 'error'>('idle');
  const [applyMessage, setApplyMessage] = useState('');

  // ── Tunnel state ──
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState(true);
  const [cfToken, setCfToken] = useState('');
  const [cfAccountId, setCfAccountId] = useState('');
  const [cfZones, setCfZones] = useState<CfZone[]>([]);
  const [cfZoneId, setCfZoneId] = useState('');
  const [cfHostname, setCfHostname] = useState('');
  const [zonesLoading, setZonesLoading] = useState(false);
  const [zonesError, setZonesError] = useState('');
  const [configureStatus, setConfigureStatus] = useState<'idle' | 'configuring' | 'done' | 'error'>('idle');
  const [configureMessage, setConfigureMessage] = useState('');
  const [copied, setCopied] = useState(false);

  const reload = useCallback(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setConfigEdits({});
        setDisplayNameEdit(d?.user?.displayName ?? '');
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
    const loadTunnel = () => {
      fetch('/api/tunnel/status')
        .then((r) => r.json())
        .then((d) => setTunnel(d))
        .catch(() => {})
        .finally(() => setTunnelLoading(false));
    };
    loadTunnel();
    const tunnelInterval = setInterval(loadTunnel, 5000);
    return () => clearInterval(tunnelInterval);
  }, [reload]);

  // Initialize edit states when data loads
  useEffect(() => {
    if (data?.user) {
      setDisplayNameEdit(data.user.displayName ?? '');
    }
  }, [data]);

  const getConfig = (key: string, fallback: string = '') => {
    if (key in configEdits) return configEdits[key] as string;
    return (data?.config?.[key] as string) ?? fallback;
  };

  const setConfig = (key: string, value: unknown) => {
    setConfigEdits((prev) => ({ ...prev, [key]: value }));
  };

  // ── Save config ──
  const saveConfig = useCallback(async (extraConfig?: Record<string, unknown>) => {
    setSavingConfig(true);
    try {
      const payload: Record<string, unknown> = { config: { ...configEdits, ...extraConfig } };
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (result.success) {
        setSnack({ open: true, message: 'Settings saved', severity: 'success' });
        reload();
      } else {
        setSnack({ open: true, message: result.error ?? 'Failed to save', severity: 'error' });
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSavingConfig(false);
    }
  }, [configEdits, reload]);

  // ── Save account ──
  const saveAccount = useCallback(async () => {
    setSavingAccount(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: displayNameEdit }),
      });
      const result = await res.json();
      if (result.success) {
        setSnack({ open: true, message: 'Account updated', severity: 'success' });
        reload();
      } else {
        setSnack({ open: true, message: result.error ?? 'Failed to save', severity: 'error' });
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSavingAccount(false);
    }
  }, [displayNameEdit, reload]);

  // ── Add API Key ──
  const handleAddKey = useCallback(async () => {
    if (!newKeyLabel.trim() || !newKeyValue.trim()) return;
    setAddingKey(true);
    try {
      const res = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newKeyLabel.trim(),
          key: newKeyValue.trim(),
          provider: 'anthropic',
          keyType: newKeyProvider === 'setup-token' ? 'bearer' : 'api-key',
        }),
      });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        const msg = result.warning
          ? result.warning
          : newKeyProvider === 'setup-token' ? 'Setup token added successfully' : 'API key added successfully';
        setSnack({ open: true, message: msg, severity: result.warning ? 'warning' : 'success' });
        setAddKeyOpen(false);
        setNewKeyLabel('');
        setNewKeyValue('');
        setNewKeyProvider('setup-token');
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setAddingKey(false);
    }
  }, [newKeyLabel, newKeyValue, newKeyProvider, reload]);

  // ── Delete API Key ──
  const handleDeleteKey = useCallback(async (keyId: string) => {
    try {
      const res = await fetch(`/api/settings/api-keys?id=${keyId}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.error) {
        setSnack({ open: true, message: result.error, severity: 'error' });
      } else {
        setSnack({ open: true, message: 'API key removed', severity: 'success' });
        setDeleteKeyId(null);
        reload();
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    }
  }, [reload]);

  // ── Toggle API Key ──
  const handleToggleKey = useCallback(async (keyId: string, isActive: boolean) => {
    try {
      await fetch('/api/settings/api-keys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: keyId, isActive }),
      });
      reload();
    } catch { /* ignore */ }
  }, [reload]);

  // ── Change password ──
  const handleChangePassword = useCallback(async () => {
    if (newPassword !== confirmPassword) {
      setSnack({ open: true, message: 'Passwords do not match', severity: 'error' });
      return;
    }
    if (newPassword.length < 8) {
      setSnack({ open: true, message: 'Password must be at least 8 characters', severity: 'error' });
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch('/api/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await res.json();
      if (result.success) {
        setSnack({ open: true, message: 'Password changed', severity: 'success' });
        setPasswordOpen(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setSnack({ open: true, message: result.error ?? 'Failed to change password', severity: 'error' });
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setChangingPassword(false);
    }
  }, [currentPassword, newPassword, confirmPassword]);

  // ── Change vault passphrase ──
  const handleChangePassphrase = useCallback(async () => {
    if (newPassphrase !== confirmPassphrase) {
      setSnack({ open: true, message: 'Passphrases do not match', severity: 'error' });
      return;
    }
    if (newPassphrase.length < 8) {
      setSnack({ open: true, message: 'Passphrase must be at least 8 characters', severity: 'error' });
      return;
    }
    setChangingPassphrase(true);
    try {
      const res = await fetch('/api/settings/vault-passphrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassphrase, newPassphrase }),
      });
      const result = await res.json();
      if (result.success) {
        setSnack({ open: true, message: 'Vault passphrase changed', severity: 'success' });
        setPassphraseOpen(false);
        setCurrentPassphrase('');
        setNewPassphrase('');
        setConfirmPassphrase('');
      } else {
        setSnack({ open: true, message: result.error ?? 'Failed to change passphrase', severity: 'error' });
      }
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    } finally {
      setChangingPassphrase(false);
    }
  }, [currentPassphrase, newPassphrase, confirmPassphrase]);

  // ── Tunnel helpers ──
  const loadZones = useCallback(async () => {
    if (!cfToken) return;
    setZonesLoading(true);
    setZonesError('');
    try {
      const res = await fetch('/api/tunnel/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiToken: cfToken, accountId: cfAccountId }),
      });
      const data = await res.json();
      if (data.error) {
        setZonesError(data.error);
      } else {
        setCfZones(data.zones ?? []);
        if (data.zones?.length > 0) setCfZoneId(data.zones[0].id);
      }
    } catch (err: any) {
      setZonesError(err.message);
    } finally {
      setZonesLoading(false);
    }
  }, [cfToken, cfAccountId]);

  const configureCustomDomain = useCallback(async () => {
    setConfigureStatus('configuring');
    setConfigureMessage('Creating tunnel, configuring DNS, and connecting...');
    try {
      const res = await fetch('/api/tunnel/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiToken: cfToken, accountId: cfAccountId, zoneId: cfZoneId, hostname: cfHostname }),
      });
      const data = await res.json();
      if (data.success) {
        setConfigureStatus('done');
        setConfigureMessage(`Custom domain configured! Your dashboard is now at ${data.url}`);
      } else {
        setConfigureStatus('error');
        setConfigureMessage(data.error);
      }
    } catch (err: any) {
      setConfigureStatus('error');
      setConfigureMessage(err.message);
    }
  }, [cfToken, cfAccountId, cfZoneId, cfHostname]);

  const removeCustomDomain = useCallback(async () => {
    try {
      await fetch('/api/tunnel/configure', { method: 'DELETE' });
      setConfigureStatus('idle');
      setConfigureMessage('');
    } catch { /* ignore */ }
  }, []);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Update helpers ──
  const checkForUpdates = useCallback(async () => {
    setCheckStatus('checking');
    try {
      const res = await fetch('/api/updates/check');
      const result: UpdateCheckResult = await res.json();
      setUpdateInfo(result);
      setCheckStatus('done');
    } catch (err: any) {
      setUpdateInfo({ updateAvailable: false, error: err.message });
      setCheckStatus('error');
    }
  }, []);

  const applyUpdate = useCallback(async () => {
    setApplyStatus('applying');
    setApplyMessage('Pulling code, installing dependencies, and rebuilding...');
    try {
      const res = await fetch('/api/updates/apply', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        setApplyStatus('restarting');
        setApplyMessage('Update applied! Server is restarting...');
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const healthRes = await fetch('/api/health');
            if (healthRes.ok) {
              setApplyStatus('done');
              setApplyMessage(`Updated to ${result.version} (${result.commit}). Workers will pull the new bundle automatically.`);
              return;
            }
          } catch { /* not back yet */ }
        }
        setApplyStatus('error');
        setApplyMessage('Server did not come back after update. Check logs and restart manually.');
      } else {
        setApplyStatus('error');
        setApplyMessage(result.error);
      }
    } catch {
      setApplyStatus('restarting');
      setApplyMessage('Server is restarting...');
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const healthRes = await fetch('/api/health');
          if (healthRes.ok) {
            setApplyStatus('done');
            setApplyMessage('Update applied successfully. Workers will pull the new bundle automatically.');
            return;
          }
        } catch { /* not back yet */ }
      }
      setApplyStatus('error');
      setApplyMessage('Server did not come back. Check logs manually.');
    }
  }, []);

  const schedulerAge = () => {
    if (!data?.system?.lastSchedulerTick) return 'No heartbeat detected';
    const ms = Date.now() - new Date(data.system.lastSchedulerTick).getTime();
    if (ms < 1000) return `Healthy (last tick ${ms}ms ago)`;
    return `Healthy (last tick ${(ms / 1000).toFixed(1)}s ago)`;
  };

  const hasConfigChanges = Object.keys(configEdits).length > 0;

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
      <Typography variant="h2" sx={{ mb: 3 }}>Settings</Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }} variant="scrollable" scrollButtons="auto">
        <Tab label="API Keys" />
        <Tab label="General" />
        <Tab label="Domain & Tunnel" />
        <Tab label="Updates" />
        <Tab label="Account" />
        <Tab label="Security" />
        <Tab label="About" />
      </Tabs>

      {/* ── Tab 0: API Keys ── */}
      {tab === 0 && (
        <Stack spacing={2}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h3" sx={{ mb: 2 }}>Claude Authentication</Typography>
            {loading ? (
              <Stack spacing={2}><Skeleton height={80} /><Skeleton height={80} /></Stack>
            ) : (data?.apiKeys?.length ?? 0) === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                No API keys or tokens configured. Add a setup-token or API key to enable AI features.
              </Typography>
            ) : (
              data!.apiKeys.map((key) => (
                <Box key={key.id} sx={{ mb: 2, p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography fontWeight={600}>{key.label}</Typography>
                      <Chip label={key.isActive ? 'Active' : 'Disabled'} size="small" color={key.isActive ? 'success' : 'default'} />
                    </Stack>
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title={key.isActive ? 'Disable' : 'Enable'}>
                        <Switch
                          size="small"
                          checked={key.isActive}
                          onChange={(e) => handleToggleKey(key.id, e.target.checked)}
                        />
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => setDeleteKeyId(key.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Stack>
                  {key.usageStats && (key.usageStats as any).tokensUsed != null && (
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        Usage: {((key.usageStats as any).tokensUsed ?? 0).toLocaleString()} tokens
                      </Typography>
                    </Box>
                  )}
                </Box>
              ))
            )}
            <Button variant="outlined" onClick={() => setAddKeyOpen(true)}>Add API Key / Token</Button>
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h3" sx={{ mb: 2 }}>Web Search</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Agents use a tiered search system: <strong>Tier 1</strong> (Serper — fast, cheap) for quick lookups,
              and <strong>Tier 2</strong> (xAI — comprehensive, AI-powered) for deep research. The agent automatically
              chooses the right tier based on query complexity.
            </Typography>

            <Divider sx={{ my: 2 }} />

            {/* Tier 1: Serper */}
            <Stack spacing={1.5} sx={{ mb: 3 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip label="Tier 1" size="small" color="success" variant="outlined" />
                <Typography variant="subtitle1" fontWeight={600}>Serper.dev — Lightweight Search</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Fast, cheap Google search API. Powers web search, images, videos, news, maps, shopping, scholar, patents, and more.
                Get an API key from{' '}
                <a href="https://serper.dev" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>serper.dev</a>.
              </Typography>
              <TextField
                label="Serper API Key"
                fullWidth
                type="password"
                size="small"
                value={getConfig('serperApiKey', '')}
                onChange={(e) => setConfig('serperApiKey', e.target.value)}
                placeholder="Enter your Serper.dev API key..."
                inputProps={{ spellCheck: false }}
              />
              {getConfig('serperApiKey', '') !== '' && configEdits.serperApiKey === undefined && (
                <Chip label="Configured" size="small" color="success" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
              )}
            </Stack>

            <Divider sx={{ my: 2 }} />

            {/* Tier 2: xAI */}
            <Stack spacing={1.5} sx={{ mb: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip label="Tier 2" size="small" color="warning" variant="outlined" />
                <Typography variant="subtitle1" fontWeight={600}>xAI (Grok) — Deep Search</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                AI-powered comprehensive search using Grok. Searches the web, reads pages, and synthesizes
                detailed answers with citations. Used when Tier 1 results are insufficient.
                Get an API key from{' '}
                <a href="https://console.x.ai" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>console.x.ai</a>.
              </Typography>
              <TextField
                label="xAI API Key"
                fullWidth
                type="password"
                size="small"
                value={getConfig('xaiApiKey', '')}
                onChange={(e) => setConfig('xaiApiKey', e.target.value)}
                placeholder="Enter your xAI API key..."
                inputProps={{ spellCheck: false }}
              />
              {getConfig('xaiApiKey', '') !== '' && configEdits.xaiApiKey === undefined && (
                <Chip label="Configured" size="small" color="success" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
              )}
            </Stack>

            {/* Tier 3: DataForSEO */}
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip label="Tier 3" size="small" color="error" variant="outlined" />
              <Typography variant="subtitle1" fontWeight={600}>Deep Research — DataForSEO</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Heavy-duty SEO research with 120+ tools: SERP analysis, keyword research, backlink analysis,
              competitor research, content analysis, app data, business data, and more.
              Get credentials at{' '}
              <a href="https://app.dataforseo.com/api-access" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
                app.dataforseo.com/api-access
              </a>.
            </Typography>
            <Stack spacing={1.5} sx={{ mt: 1.5 }}>
              <TextField
                label="DataForSEO Login (email)"
                fullWidth
                size="small"
                value={getConfig('dataForSeoLogin', '')}
                onChange={(e) => setConfig('dataForSeoLogin', e.target.value)}
                placeholder="your@email.com"
                inputProps={{ spellCheck: false }}
              />
              <TextField
                label="DataForSEO Password"
                fullWidth
                type="password"
                size="small"
                value={getConfig('dataForSeoPassword', '')}
                onChange={(e) => setConfig('dataForSeoPassword', e.target.value)}
                placeholder="Enter your DataForSEO API password..."
                inputProps={{ spellCheck: false }}
              />
              {getConfig('dataForSeoLogin', '') !== '' && getConfig('dataForSeoPassword', '') !== '' &&
               configEdits.dataForSeoLogin === undefined && configEdits.dataForSeoPassword === undefined && (
                <Chip label="Configured" size="small" color="success" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
              )}
            </Stack>

            {/* Save button for any search key changes */}
            {(configEdits.serperApiKey !== undefined || configEdits.xaiApiKey !== undefined ||
              configEdits.dataForSeoLogin !== undefined || configEdits.dataForSeoPassword !== undefined) && (
              <Button
                variant="contained"
                size="small"
                startIcon={savingConfig ? <CircularProgress size={16} /> : <SaveIcon />}
                onClick={() => saveConfig()}
                disabled={savingConfig}
                sx={{ mt: 2 }}
              >
                Save Search Keys
              </Button>
            )}
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h3" sx={{ mb: 2 }}>LLM Fallback Provider</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              When all primary API keys are exhausted or rate-limited, the system automatically falls back to
              <strong> NVIDIA NIM</strong> with tiered models matched to Claude equivalents:
              <strong> Nemotron Nano 8B</strong> (fast), <strong>Llama 3.3 70B</strong> (standard),
              and <strong>Nemotron Ultra 253B</strong> (heavy). All support tool calling natively.
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip label="Fallback" size="small" color="info" variant="outlined" />
                <Typography variant="subtitle1" fontWeight={600}>NVIDIA NIM — Tiered Models</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Tier-matched models on NVIDIA NIM: <strong>Nano 8B</strong> for fast lookups (like Haiku),{' '}
                <strong>Llama 3.3 70B</strong> for general tasks (like Sonnet), and{' '}
                <strong>Nemotron Ultra 253B</strong> for deep reasoning (like Opus).
                Used automatically when primary keys run out of tokens.
                Get an API key from{' '}
                <a href="https://build.nvidia.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>build.nvidia.com</a>.
              </Typography>
              <TextField
                label="NVIDIA NIM API Key"
                fullWidth
                type="password"
                size="small"
                value={getConfig('nvidiaApiKey', '')}
                onChange={(e) => setConfig('nvidiaApiKey', e.target.value)}
                placeholder="Enter your NVIDIA NIM API key (nvapi-...)..."
                inputProps={{ spellCheck: false }}
              />
              {getConfig('nvidiaApiKey', '') !== '' && configEdits.nvidiaApiKey === undefined && (
                <Chip label="Configured" size="small" color="success" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
              )}
            </Stack>

            {configEdits.nvidiaApiKey !== undefined && (
              <Button
                variant="contained"
                size="small"
                startIcon={savingConfig ? <CircularProgress size={16} /> : <SaveIcon />}
                onClick={() => saveConfig()}
                disabled={savingConfig}
                sx={{ mt: 2 }}
              >
                Save Fallback Key
              </Button>
            )}
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h3" sx={{ mb: 2 }}>Claude Max Accounts</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Manage Claude Max subscriptions for load-balanced, flat-rate AI access.
              Each account runs its own proxy and requests are distributed across all running proxies.
            </Typography>
            <ClaudeMaxSetup authToken={null} onError={(msg) => setSnack({ open: true, message: msg, severity: 'error' })} />
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h3" sx={{ mb: 2 }}>Load Balancing</Typography>
            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>Strategy</InputLabel>
              <Select
                label="Strategy"
                value={getConfig('loadBalancingStrategy', 'round-robin')}
                onChange={(e) => setConfig('loadBalancingStrategy', e.target.value)}
              >
                <MenuItem value="round-robin">Round Robin</MenuItem>
                <MenuItem value="least-active">Least Active</MenuItem>
                <MenuItem value="random">Random</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Model Tier Mapping</Typography>
            <Stack spacing={1}>
              <TextField size="small" label="Fast (Haiku)" value={getConfig('modelFast')} onChange={(e) => setConfig('modelFast', e.target.value)} placeholder="claude-3-5-haiku-20241022" />
              <TextField size="small" label="Standard (Sonnet)" value={getConfig('modelStandard')} onChange={(e) => setConfig('modelStandard', e.target.value)} placeholder="claude-sonnet-4-20250514" />
              <TextField size="small" label="Heavy (Opus)" value={getConfig('modelHeavy')} onChange={(e) => setConfig('modelHeavy', e.target.value)} placeholder="claude-opus-4-20250514" />
            </Stack>
            {hasConfigChanges && (
              <Button
                variant="contained"
                startIcon={savingConfig ? <CircularProgress size={16} /> : <SaveIcon />}
                onClick={() => saveConfig()}
                disabled={savingConfig}
                sx={{ mt: 2 }}
              >
                Save Changes
              </Button>
            )}
          </Paper>
        </Stack>
      )}

      {/* ── Tab 1: General ── */}
      {tab === 1 && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={3}>
            <TextField
              label="System Name"
              value={getConfig('systemName', '')}
              onChange={(e) => setConfig('systemName', e.target.value)}
              placeholder="AI Engine"
            />
            <FormControl fullWidth>
              <InputLabel>Default Approval Mode</InputLabel>
              <Select
                label="Default Approval Mode"
                value={getConfig('approvalMode', 'notify')}
                onChange={(e) => setConfig('approvalMode', e.target.value)}
              >
                <MenuItem value="auto">Auto-approve</MenuItem>
                <MenuItem value="notify">Notify on creation</MenuItem>
                <MenuItem value="approve">Require approval</MenuItem>
              </Select>
            </FormControl>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Theme</Typography>
              <ToggleButtonGroup
                exclusive
                value={getConfig('theme', 'system')}
                onChange={(_, v) => { if (v) setConfig('theme', v); }}
                sx={{ mb: 2 }}
              >
                <ToggleButton value="system"><SettingsBrightnessIcon sx={{ mr: 1 }} /> System</ToggleButton>
                <ToggleButton value="light"><LightModeIcon sx={{ mr: 1 }} /> Light</ToggleButton>
                <ToggleButton value="dark"><DarkModeIcon sx={{ mr: 1 }} /> Dark</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            {hasConfigChanges && (
              <Button
                variant="contained"
                startIcon={savingConfig ? <CircularProgress size={16} /> : <SaveIcon />}
                onClick={() => saveConfig()}
                disabled={savingConfig}
              >
                Save Changes
              </Button>
            )}
          </Stack>
        </Paper>
      )}

      {/* ── Tab 2: Domain & Tunnel ── */}
      {tab === 2 && (
        <Stack spacing={2}>
          <Paper sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
              <LanguageIcon color="primary" />
              <Typography variant="h3">Tunnel Status</Typography>
            </Stack>
            {tunnelLoading ? (
              <Stack spacing={1}><Skeleton width={300} /><Skeleton width={200} /></Stack>
            ) : !tunnel ? (
              <Alert severity="warning">Unable to fetch tunnel status.</Alert>
            ) : (
              <Stack spacing={1.5}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: tunnel.status === 'connected' ? 'success.main' : tunnel.status === 'starting' ? 'warning.main' : 'grey.500' }} />
                  <Typography variant="body1" fontWeight={600}>
                    {tunnel.status === 'connected' ? 'Connected' : tunnel.status === 'starting' ? 'Starting...' : 'Disconnected'}
                  </Typography>
                  <Chip label={tunnel.mode === 'named' ? 'Custom Domain' : 'Quick Tunnel'} size="small" color={tunnel.mode === 'named' ? 'primary' : 'default'} variant="outlined" />
                </Stack>
                {tunnel.url && (
                  <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'action.hover', fontFamily: 'monospace' }}>
                    <Typography variant="body2" sx={{ flex: 1, fontFamily: 'monospace', wordBreak: 'break-all' }}>{tunnel.url}</Typography>
                    <Tooltip title={copied ? 'Copied!' : 'Copy URL'}>
                      <IconButton size="small" onClick={() => copyToClipboard(tunnel.url!)}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Open in new tab">
                      <IconButton size="small" component="a" href={tunnel.url} target="_blank" rel="noopener">
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Paper>
                )}
                {tunnel.mode === 'quick' && tunnel.url && (
                  <Alert severity="info" variant="outlined" sx={{ fontSize: 13 }}>
                    Quick tunnel URLs change each time the server restarts. Configure a custom domain below for a permanent, static URL.
                  </Alert>
                )}
                {tunnel.error && <Alert severity="error">{tunnel.error}</Alert>}
              </Stack>
            )}
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h3" sx={{ mb: 1 }}>Custom Domain</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Connect your Cloudflare account to get a permanent domain with automatic SSL.
            </Typography>
            {tunnel?.mode === 'named' && tunnel?.hostname ? (
              <Stack spacing={2}>
                <Alert severity="success">Your dashboard is accessible at <strong>https://{tunnel.hostname}</strong></Alert>
                <Stack spacing={1}>
                  <Typography variant="body2"><strong>Tunnel ID:</strong> {tunnel.tunnelId}</Typography>
                  <Typography variant="body2"><strong>Hostname:</strong> {tunnel.hostname}</Typography>
                </Stack>
                <Divider />
                <Button variant="outlined" color="warning" onClick={removeCustomDomain} sx={{ alignSelf: 'flex-start' }}>Remove Custom Domain</Button>
              </Stack>
            ) : (
              <Stack spacing={2}>
                <TextField label="Cloudflare API Token" fullWidth type="password" value={cfToken} onChange={(e) => setCfToken(e.target.value)} helperText="Create a token at dash.cloudflare.com with Zone:DNS:Edit and Account:Cloudflare Tunnel:Edit permissions." inputProps={{ spellCheck: false }} />
                <TextField label="Account ID" fullWidth value={cfAccountId} onChange={(e) => setCfAccountId(e.target.value)} helperText="Found on the right sidebar of any zone's Overview page." inputProps={{ spellCheck: false }} />
                <Button variant="outlined" onClick={loadZones} disabled={!cfToken || zonesLoading} startIcon={zonesLoading ? <CircularProgress size={16} /> : undefined}>
                  {zonesLoading ? 'Loading...' : 'Load Domains'}
                </Button>
                {zonesError && <Alert severity="error">{zonesError}</Alert>}
                {cfZones.length > 0 && (
                  <>
                    <FormControl fullWidth>
                      <InputLabel>Domain (Zone)</InputLabel>
                      <Select label="Domain (Zone)" value={cfZoneId} onChange={(e) => setCfZoneId(e.target.value)}>
                        {cfZones.map((z) => <MenuItem key={z.id} value={z.id}>{z.name}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <TextField label="Hostname" fullWidth value={cfHostname} onChange={(e) => setCfHostname(e.target.value)} helperText={`e.g., dashboard.${cfZones.find((z) => z.id === cfZoneId)?.name ?? 'yourdomain.com'}`} inputProps={{ spellCheck: false }} />
                    <Button variant="contained" onClick={configureCustomDomain} disabled={!cfToken || !cfAccountId || !cfZoneId || !cfHostname || configureStatus === 'configuring'} startIcon={configureStatus === 'configuring' ? <CircularProgress size={16} /> : undefined}>
                      {configureStatus === 'configuring' ? 'Configuring...' : 'Configure Custom Domain'}
                    </Button>
                  </>
                )}
                {configureStatus === 'configuring' && <Stack spacing={1}><LinearProgress /><Typography variant="body2" color="text.secondary">{configureMessage}</Typography></Stack>}
                {configureStatus === 'done' && <Alert severity="success">{configureMessage}</Alert>}
                {configureStatus === 'error' && <Alert severity="error">{configureMessage}</Alert>}
              </Stack>
            )}
          </Paper>
        </Stack>
      )}

      {/* ── Tab 3: Updates ── */}
      {tab === 3 && (
        <Stack spacing={2}>
          <Paper sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
              <SystemUpdateIcon color="primary" />
              <Typography variant="h3">Dashboard Updates</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Check for new versions from the git repository. Updates pull the latest code, rebuild all packages, and re-create the worker bundle.
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <Button variant="outlined" onClick={checkForUpdates} disabled={checkStatus === 'checking'} startIcon={checkStatus === 'checking' ? <CircularProgress size={16} /> : undefined}>
                {checkStatus === 'checking' ? 'Checking...' : 'Check for Updates'}
              </Button>
              {updateInfo && !updateInfo.updateAvailable && !updateInfo.error && (
                <Chip icon={<CheckCircleIcon />} label={`Up to date (${updateInfo.currentCommit})`} color="success" variant="outlined" />
              )}
              {updateInfo?.updateAvailable && (
                <Chip icon={<NewReleasesIcon />} label={`${updateInfo.commitsBehind} commit${updateInfo.commitsBehind !== 1 ? 's' : ''} behind`} color="warning" />
              )}
            </Stack>
            {updateInfo?.error && <Alert severity="error" sx={{ mb: 2 }}>{updateInfo.error}</Alert>}
            {updateInfo?.updateAvailable && updateInfo.newCommits && updateInfo.newCommits.length > 0 && (
              <Paper variant="outlined" sx={{ mb: 2, maxHeight: 200, overflow: 'auto' }}>
                <List dense disablePadding>
                  {updateInfo.newCommits.map((commit, i) => (
                    <ListItem key={i} divider={i < updateInfo.newCommits!.length - 1}>
                      <ListItemText primary={commit.message} secondary={`${commit.hash} - ${new Date(commit.date).toLocaleDateString()}`} />
                    </ListItem>
                  ))}
                </List>
              </Paper>
            )}
            {updateInfo?.updateAvailable && applyStatus === 'idle' && (
              <Button variant="contained" color="warning" onClick={applyUpdate}>Apply Update &amp; Restart</Button>
            )}
            {(applyStatus === 'applying' || applyStatus === 'restarting') && (
              <Stack spacing={1}><LinearProgress /><Typography variant="body2" color="text.secondary">{applyMessage}</Typography></Stack>
            )}
            {applyStatus === 'done' && <Alert severity="success">{applyMessage}</Alert>}
            {applyStatus === 'error' && <Alert severity="error">{applyMessage}</Alert>}
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h3" sx={{ mb: 2 }}>Worker Updates</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              When you update the dashboard, a new worker bundle is automatically created. Workers check for updates periodically.
            </Typography>
            <List disablePadding>
              <ListItem secondaryAction={<Switch checked={getConfig('autoUpdateWorkers', 'true') === 'true'} onChange={(e) => { setConfig('autoUpdateWorkers', e.target.checked ? 'true' : 'false'); saveConfig({ autoUpdateWorkers: e.target.checked ? 'true' : 'false' }); }} />} sx={{ px: 0 }}>
                <ListItemText primary="Auto-update workers" secondary="Workers automatically download and install new bundles when available" />
              </ListItem>
            </List>
          </Paper>
        </Stack>
      )}

      {/* ── Tab 4: Account ── */}
      {tab === 4 && (
        <Paper sx={{ p: 3 }}>
          {loading ? (
            <Stack spacing={2}><Skeleton height={56} /><Skeleton height={56} /></Stack>
          ) : (
            <Stack spacing={2}>
              <TextField
                label="Display Name"
                value={displayNameEdit}
                onChange={(e) => setDisplayNameEdit(e.target.value)}
              />
              <TextField label="Email" value={data?.user?.email ?? ''} disabled />
              <Stack direction="row" spacing={2}>
                <Button
                  variant="contained"
                  startIcon={savingAccount ? <CircularProgress size={16} /> : <SaveIcon />}
                  onClick={saveAccount}
                  disabled={savingAccount || displayNameEdit === (data?.user?.displayName ?? '')}
                >
                  Save
                </Button>
                <Button variant="outlined" onClick={() => setPasswordOpen(true)}>Change Password</Button>
              </Stack>
            </Stack>
          )}
        </Paper>
      )}

      {/* ── Tab 5: Security ── */}
      {tab === 5 && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={3}>
            <Box>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>Vault Passphrase</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                The vault passphrase encrypts all stored credentials using AES-256-GCM.
              </Typography>
              <Button variant="outlined" color="warning" onClick={() => setPassphraseOpen(true)}>Change Vault Passphrase</Button>
            </Box>
            <Divider />
            <Box>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>Session Timeout</Typography>
              <FormControl sx={{ minWidth: 200 }}>
                <InputLabel>Session Timeout</InputLabel>
                <Select
                  label="Session Timeout"
                  value={getConfig('sessionTimeout', '7d')}
                  onChange={(e) => { setConfig('sessionTimeout', e.target.value); saveConfig({ sessionTimeout: e.target.value }); }}
                >
                  <MenuItem value="1d">1 day</MenuItem>
                  <MenuItem value="7d">7 days</MenuItem>
                  <MenuItem value="30d">30 days</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </Stack>
        </Paper>
      )}

      {/* ── Tab 6: About ── */}
      {tab === 6 && (
        <Paper sx={{ p: 3 }}>
          {loading ? (
            <Stack spacing={1}><Skeleton width={200} /><Skeleton width={200} /><Skeleton width={200} /></Stack>
          ) : (
            <Stack spacing={1}>
              <Typography variant="body2"><strong>Version:</strong> {data?.system?.version ?? 'Unknown'}</Typography>
              <Typography variant="body2"><strong>Workers:</strong> {data?.system?.onlineWorkers ?? 0} online / {data?.system?.totalWorkers ?? 0} total</Typography>
              <Typography variant="body2"><strong>Database:</strong> PostgreSQL + pgvector</Typography>
              <Typography variant="body2"><strong>Scheduler:</strong> {schedulerAge()}</Typography>
              {tunnel?.url && <Typography variant="body2"><strong>Tunnel:</strong> {tunnel.url} ({tunnel.mode})</Typography>}
            </Stack>
          )}
        </Paper>
      )}

      {/* ── Add API Key / Token Dialog ── */}
      <Dialog open={addKeyOpen} onClose={() => setAddKeyOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Claude Authentication</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="Authentication Type"
              fullWidth
              value={newKeyProvider}
              onChange={(e) => setNewKeyProvider(e.target.value as any)}
              SelectProps={{ native: true }}
            >
              <option value="setup-token">Claude Max Setup Token (recommended)</option>
              <option value="anthropic-api">Anthropic API Key (pay-per-token)</option>
            </TextField>

            <TextField
              label="Label"
              fullWidth
              value={newKeyLabel}
              onChange={(e) => setNewKeyLabel(e.target.value)}
              placeholder={newKeyProvider === 'setup-token' ? 'e.g., Max Account 1, Gary' : 'e.g., Primary Key'}
              autoFocus
            />

            <TextField
              label={newKeyProvider === 'setup-token' ? 'Setup Token' : 'API Key'}
              fullWidth
              value={newKeyValue}
              onChange={(e) => setNewKeyValue(e.target.value)}
              placeholder={newKeyProvider === 'setup-token' ? 'Paste token from claude setup-token...' : 'sk-ant-api03-...'}
              type="password"
              inputProps={{ spellCheck: false }}
              helperText={newKeyProvider === 'setup-token'
                ? 'Run "claude setup-token" on any machine, then paste the token here. Calls the Anthropic API directly.'
                : 'Get an API key from console.anthropic.com. Encrypted at rest.'
              }
            />

            {newKeyProvider === 'setup-token' && (
              <Alert severity="info" variant="outlined" sx={{ fontSize: 12 }}>
                <strong>How to get a setup-token:</strong><br />
                1. Install Claude Code: <code>npm i -g @anthropic-ai/claude-code</code><br />
                2. Log in: <code>claude auth login</code><br />
                3. Generate: <code>claude setup-token</code><br />
                4. Copy the token and paste above<br /><br />
                Add multiple tokens for load balancing across Claude Max accounts.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddKeyOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleAddKey}
            disabled={!newKeyLabel.trim() || !newKeyValue.trim() || addingKey}
            startIcon={addingKey ? <CircularProgress size={16} /> : undefined}
          >
            {addingKey ? 'Validating...' : newKeyProvider === 'setup-token' ? 'Add Token' : 'Add Key'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete API Key Confirmation ── */}
      <Dialog open={!!deleteKeyId} onClose={() => setDeleteKeyId(null)}>
        <DialogTitle>Delete API Key</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to remove this API key? This action cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteKeyId(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={() => deleteKeyId && handleDeleteKey(deleteKeyId)}>Delete</Button>
        </DialogActions>
      </Dialog>

      {/* ── Change Password Dialog ── */}
      <Dialog open={passwordOpen} onClose={() => setPasswordOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Change Password</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Current Password" type="password" fullWidth value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoFocus />
            <TextField label="New Password" type="password" fullWidth value={newPassword} onChange={(e) => setNewPassword(e.target.value)} helperText="At least 8 characters" />
            <TextField label="Confirm New Password" type="password" fullWidth value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasswordOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleChangePassword} disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword} startIcon={changingPassword ? <CircularProgress size={16} /> : undefined}>
            {changingPassword ? 'Changing...' : 'Change Password'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Change Vault Passphrase Dialog ── */}
      <Dialog open={passphraseOpen} onClose={() => setPassphraseOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Change Vault Passphrase</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Changing the vault passphrase will re-encrypt all stored credentials. This cannot be undone if you forget the new passphrase.
          </Alert>
          <Stack spacing={2}>
            <TextField label="Current Passphrase" type="password" fullWidth value={currentPassphrase} onChange={(e) => setCurrentPassphrase(e.target.value)} autoFocus />
            <TextField label="New Passphrase" type="password" fullWidth value={newPassphrase} onChange={(e) => setNewPassphrase(e.target.value)} helperText="At least 8 characters" />
            <TextField label="Confirm New Passphrase" type="password" fullWidth value={confirmPassphrase} onChange={(e) => setConfirmPassphrase(e.target.value)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPassphraseOpen(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={handleChangePassphrase} disabled={changingPassphrase || !currentPassphrase || !newPassphrase || !confirmPassphrase} startIcon={changingPassphrase ? <CircularProgress size={16} /> : undefined}>
            {changingPassphrase ? 'Changing...' : 'Change Passphrase'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Snackbar ── */}
      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))} variant="filled">
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
