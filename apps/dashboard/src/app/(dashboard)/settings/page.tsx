'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Stack, Tabs, Tab,
  List, ListItem, ListItemText, Switch, Chip, Select, MenuItem,
  FormControl, InputLabel, ToggleButtonGroup, ToggleButton,
  LinearProgress, Alert, CircularProgress, Divider, Skeleton,
  IconButton, Tooltip,
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

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));

    // Poll tunnel status
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
  }, []);

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
        body: JSON.stringify({
          apiToken: cfToken,
          accountId: cfAccountId,
          zoneId: cfZoneId,
          hostname: cfHostname,
        }),
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

  return (
    <Box>
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
            <Typography variant="h3" sx={{ mb: 2 }}>Claude API Keys</Typography>
            {loading ? (
              <Stack spacing={2}><Skeleton height={80} /><Skeleton height={80} /></Stack>
            ) : (data?.apiKeys?.length ?? 0) === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                No API keys configured. Add a Claude API key to enable AI features.
              </Typography>
            ) : (
              data!.apiKeys.map((key) => (
                <Box key={key.id} sx={{ mb: 2, p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography fontWeight={600}>{key.label}</Typography>
                    <Chip label={key.isActive ? 'Active' : 'Disabled'} size="small" color={key.isActive ? 'success' : 'default'} />
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
            <Button variant="outlined">Add API Key</Button>
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h3" sx={{ mb: 2 }}>Load Balancing</Typography>
            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>Strategy</InputLabel>
              <Select label="Strategy" value={(data?.config?.loadBalancingStrategy as string) ?? 'round-robin'}>
                <MenuItem value="round-robin">Round Robin</MenuItem>
                <MenuItem value="least-active">Least Active</MenuItem>
                <MenuItem value="random">Random</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Model Tier Mapping</Typography>
            <Stack spacing={1}>
              <TextField size="small" label="Fast (Haiku)" value={(data?.config?.modelFast as string) ?? ''} placeholder="claude-3-5-haiku-20241022" />
              <TextField size="small" label="Standard (Sonnet)" value={(data?.config?.modelStandard as string) ?? ''} placeholder="claude-sonnet-4-20250514" />
              <TextField size="small" label="Heavy (Opus)" value={(data?.config?.modelHeavy as string) ?? ''} placeholder="claude-opus-4-20250514" />
            </Stack>
          </Paper>
        </Stack>
      )}

      {/* ── Tab 1: General ── */}
      {tab === 1 && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={3}>
            <TextField label="System Name" value={(data?.config?.systemName as string) ?? ''} placeholder="AI Engine" />
            <FormControl fullWidth>
              <InputLabel>Default Approval Mode</InputLabel>
              <Select label="Default Approval Mode" value={(data?.config?.approvalMode as string) ?? 'notify'}>
                <MenuItem value="auto">Auto-approve</MenuItem>
                <MenuItem value="notify">Notify on creation</MenuItem>
                <MenuItem value="approve">Require approval</MenuItem>
              </Select>
            </FormControl>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Theme</Typography>
              <ToggleButtonGroup exclusive value={(data?.config?.theme as string) ?? 'system'} sx={{ mb: 2 }}>
                <ToggleButton value="system"><SettingsBrightnessIcon sx={{ mr: 1 }} /> System</ToggleButton>
                <ToggleButton value="light"><LightModeIcon sx={{ mr: 1 }} /> Light</ToggleButton>
                <ToggleButton value="dark"><DarkModeIcon sx={{ mr: 1 }} /> Dark</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Stack>
        </Paper>
      )}

      {/* ── Tab 2: Domain & Tunnel ── */}
      {tab === 2 && (
        <Stack spacing={2}>
          {/* Current tunnel status */}
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
                  <Box sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: tunnel.status === 'connected' ? 'success.main'
                      : tunnel.status === 'starting' ? 'warning.main'
                      : 'grey.500',
                  }} />
                  <Typography variant="body1" fontWeight={600}>
                    {tunnel.status === 'connected' ? 'Connected' : tunnel.status === 'starting' ? 'Starting...' : 'Disconnected'}
                  </Typography>
                  <Chip
                    label={tunnel.mode === 'named' ? 'Custom Domain' : 'Quick Tunnel'}
                    size="small"
                    color={tunnel.mode === 'named' ? 'primary' : 'default'}
                    variant="outlined"
                  />
                </Stack>

                {tunnel.url && (
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 1.5, display: 'flex', alignItems: 'center', gap: 1,
                      bgcolor: 'action.hover', fontFamily: 'monospace',
                    }}
                  >
                    <Typography variant="body2" sx={{ flex: 1, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {tunnel.url}
                    </Typography>
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
                    Quick tunnel URLs change each time the server restarts.
                    Configure a custom domain below for a permanent, static URL.
                  </Alert>
                )}

                {tunnel.error && <Alert severity="error">{tunnel.error}</Alert>}
              </Stack>
            )}
          </Paper>

          {/* Configure custom domain */}
          <Paper sx={{ p: 3 }}>
            <Typography variant="h3" sx={{ mb: 1 }}>Custom Domain</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Connect your Cloudflare account to get a permanent domain with automatic SSL.
              This creates a named tunnel that persists across restarts.
            </Typography>

            {tunnel?.mode === 'named' && tunnel?.hostname ? (
              /* Already configured */
              <Stack spacing={2}>
                <Alert severity="success">
                  Your dashboard is accessible at <strong>https://{tunnel.hostname}</strong>
                </Alert>
                <Stack spacing={1}>
                  <Typography variant="body2"><strong>Tunnel ID:</strong> {tunnel.tunnelId}</Typography>
                  <Typography variant="body2"><strong>Hostname:</strong> {tunnel.hostname}</Typography>
                </Stack>
                <Divider />
                <Button variant="outlined" color="warning" onClick={removeCustomDomain} sx={{ alignSelf: 'flex-start' }}>
                  Remove Custom Domain
                </Button>
                <Typography variant="caption" color="text.secondary">
                  This will revert to a quick tunnel with a random URL. The Cloudflare tunnel
                  and DNS record will remain in your Cloudflare account for manual cleanup.
                </Typography>
              </Stack>
            ) : (
              /* Not configured — show form */
              <Stack spacing={2}>
                <TextField
                  label="Cloudflare API Token"
                  fullWidth
                  type="password"
                  value={cfToken}
                  onChange={(e) => setCfToken(e.target.value)}
                  helperText="Create a token at dash.cloudflare.com with Zone:DNS:Edit and Account:Cloudflare Tunnel:Edit permissions."
                  inputProps={{ spellCheck: false }}
                />
                <TextField
                  label="Account ID"
                  fullWidth
                  value={cfAccountId}
                  onChange={(e) => setCfAccountId(e.target.value)}
                  helperText="Found on the right sidebar of any zone's Overview page in the Cloudflare dashboard."
                  inputProps={{ spellCheck: false }}
                />

                <Button
                  variant="outlined"
                  onClick={loadZones}
                  disabled={!cfToken || zonesLoading}
                  startIcon={zonesLoading ? <CircularProgress size={16} /> : undefined}
                >
                  {zonesLoading ? 'Loading...' : 'Load Domains'}
                </Button>

                {zonesError && <Alert severity="error">{zonesError}</Alert>}

                {cfZones.length > 0 && (
                  <>
                    <FormControl fullWidth>
                      <InputLabel>Domain (Zone)</InputLabel>
                      <Select
                        label="Domain (Zone)"
                        value={cfZoneId}
                        onChange={(e) => setCfZoneId(e.target.value)}
                      >
                        {cfZones.map((z) => (
                          <MenuItem key={z.id} value={z.id}>{z.name}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <TextField
                      label="Hostname"
                      fullWidth
                      value={cfHostname}
                      onChange={(e) => setCfHostname(e.target.value)}
                      helperText={`e.g., dashboard.${cfZones.find((z) => z.id === cfZoneId)?.name ?? 'yourdomain.com'}`}
                      inputProps={{ spellCheck: false }}
                    />

                    <Button
                      variant="contained"
                      onClick={configureCustomDomain}
                      disabled={
                        !cfToken || !cfAccountId || !cfZoneId || !cfHostname
                        || configureStatus === 'configuring'
                      }
                      startIcon={configureStatus === 'configuring' ? <CircularProgress size={16} /> : undefined}
                    >
                      {configureStatus === 'configuring' ? 'Configuring...' : 'Configure Custom Domain'}
                    </Button>
                  </>
                )}

                {configureStatus === 'configuring' && (
                  <Stack spacing={1}>
                    <LinearProgress />
                    <Typography variant="body2" color="text.secondary">{configureMessage}</Typography>
                  </Stack>
                )}
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
              Check for new versions from the git repository. Updates pull the latest code,
              rebuild all packages, and re-create the worker bundle.
            </Typography>

            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <Button
                variant="outlined"
                onClick={checkForUpdates}
                disabled={checkStatus === 'checking'}
                startIcon={checkStatus === 'checking' ? <CircularProgress size={16} /> : undefined}
              >
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
              When you update the dashboard, a new worker bundle is automatically created.
              Workers check for updates periodically and download the new bundle.
            </Typography>
            <List disablePadding>
              <ListItem secondaryAction={<Switch defaultChecked />} sx={{ px: 0 }}>
                <ListItemText primary="Auto-update workers" secondary="Workers automatically download and install new bundles when available" />
              </ListItem>
              <Divider />
              <ListItem sx={{ px: 0 }}>
                <ListItemText primary="Worker bundle" secondary="Rebuild the worker bundle without pulling new code" />
                <Button variant="outlined" size="small" sx={{ ml: 2 }}>Rebuild Bundle</Button>
              </ListItem>
            </List>
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h3" sx={{ mb: 2 }}>Auto-Update Schedule</Typography>
            <List disablePadding>
              <ListItem secondaryAction={<Switch />} sx={{ px: 0 }}>
                <ListItemText primary="Automatically check for updates" secondary="Check the git remote for new commits every hour" />
              </ListItem>
              <Divider />
              <ListItem secondaryAction={<Switch />} sx={{ px: 0 }}>
                <ListItemText primary="Automatically apply updates" secondary="Pull, build, and restart when new commits are detected (requires auto-check)" />
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
              <TextField label="Display Name" value={data?.user?.displayName ?? ''} />
              <TextField label="Email" value={data?.user?.email ?? ''} disabled />
              <Button variant="outlined">Change Password</Button>
            </Stack>
          )}
        </Paper>
      )}

      {/* ── Tab 5: Security ── */}
      {tab === 5 && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Button variant="outlined" color="warning">Change Vault Passphrase</Button>
            <FormControl fullWidth>
              <InputLabel>Session Timeout</InputLabel>
              <Select label="Session Timeout" value={(data?.config?.sessionTimeout as string) ?? '7d'}>
                <MenuItem value="1d">1 day</MenuItem>
                <MenuItem value="7d">7 days</MenuItem>
                <MenuItem value="30d">30 days</MenuItem>
              </Select>
            </FormControl>
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
              <Typography variant="body2">
                <strong>Workers:</strong> {data?.system?.onlineWorkers ?? 0} online / {data?.system?.totalWorkers ?? 0} total
              </Typography>
              <Typography variant="body2"><strong>Database:</strong> PostgreSQL + pgvector</Typography>
              <Typography variant="body2"><strong>Scheduler:</strong> {schedulerAge()}</Typography>
              {tunnel?.url && (
                <Typography variant="body2"><strong>Tunnel:</strong> {tunnel.url} ({tunnel.mode})</Typography>
              )}
            </Stack>
          )}
        </Paper>
      )}
    </Box>
  );
}
