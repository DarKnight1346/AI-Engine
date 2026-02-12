'use client';

import { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Chip, Stack, Avatar,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AppleIcon from '@mui/icons-material/Apple';
import TerminalIcon from '@mui/icons-material/Terminal';
import ComputerIcon from '@mui/icons-material/Computer';

interface Worker {
  id: string;
  hostname: string;
  ip: string;
  os: string;
  environment: string;
  capabilities: Record<string, unknown>;
  online: boolean;
  isLeader: boolean;
  lastHeartbeat: string;
  /** Extra fields from the live WebSocket hub */
  load?: number;
  activeTasks?: number;
  wsConnected?: boolean;
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        // Fetch DB records (registered nodes) and live WebSocket connections in parallel
        const [dbRes, hubRes] = await Promise.all([
          fetch('/api/workers').then((r) => r.json()).catch(() => ({ workers: [] })),
          fetch('/api/hub/workers').then((r) => r.json()).catch(() => ({ workers: [] })),
        ]);

        const dbWorkers: Worker[] = (dbRes.workers ?? []).map((w: any) => ({ ...w, wsConnected: false }));
        const liveWorkers: any[] = hubRes.workers ?? [];

        // Merge: overlay live WebSocket data onto DB records
        const liveMap = new Map(liveWorkers.map((w: any) => [w.workerId, w]));
        for (const w of dbWorkers) {
          const live = liveMap.get(w.id);
          if (live) {
            w.online = true;
            w.wsConnected = true;
            w.load = live.load;
            w.activeTasks = live.activeTasks;
            w.lastHeartbeat = live.lastHeartbeat;
            liveMap.delete(w.id);
          }
        }

        // Any live workers not yet in the DB (edge case during registration)
        for (const [id, live] of liveMap) {
          dbWorkers.push({
            id,
            hostname: live.hostname ?? 'unknown',
            ip: '—',
            os: live.capabilities?.os ?? 'linux',
            environment: live.capabilities?.environment ?? 'local',
            capabilities: live.capabilities ?? {},
            online: true,
            isLeader: false,
            lastHeartbeat: live.lastHeartbeat,
            load: live.load,
            activeTasks: live.activeTasks,
            wsConnected: true,
          });
        }

        setWorkers(dbWorkers);
      } catch {
        setWorkers([]);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  const OsIcon = ({ os }: { os: string }) => {
    if (os === 'darwin') return <AppleIcon sx={{ fontSize: 20 }} />;
    if (os === 'win32') return <ComputerIcon sx={{ fontSize: 20 }} />;
    return <TerminalIcon sx={{ fontSize: 20 }} />;
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Workers</Typography>
        <Button variant="contained" startIcon={<AddIcon />}>Add Worker</Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && workers.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <TerminalIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">No workers connected</Typography>
          <Typography variant="body2">Add a worker node to start processing tasks.</Typography>
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
        {workers.map((worker) => (
          <Card key={worker.id} sx={{ opacity: worker.online ? 1 : 0.5, cursor: 'pointer', '&:hover': { boxShadow: 4 } }}>
            <CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center" mb={1.5}>
                <Avatar sx={{ bgcolor: worker.os === 'darwin' ? 'grey.800' : 'primary.dark', width: 36, height: 36 }}>
                  <OsIcon os={worker.os} />
                </Avatar>
                <Box sx={{ flex: 1 }}>
                  <Typography fontWeight={600}>{worker.hostname}</Typography>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Chip label={worker.environment} size="small" color={worker.environment === 'cloud' ? 'info' : 'success'} sx={{ height: 20, fontSize: 11 }} />
                    {worker.isLeader && <Chip label="leader" size="small" color="warning" sx={{ height: 20, fontSize: 11 }} />}
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: worker.online ? 'success.main' : 'grey.400' }} />
                  </Stack>
                </Box>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {worker.ip} &middot; {worker.os}
              </Typography>
              {worker.wsConnected && (
                <Stack direction="row" spacing={1} mt={0.5}>
                  <Chip label="WebSocket" size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                  {typeof worker.activeTasks === 'number' && (
                    <Chip label={`${worker.activeTasks} task${worker.activeTasks === 1 ? '' : 's'}`} size="small" sx={{ height: 20, fontSize: 11 }} />
                  )}
                  {typeof worker.load === 'number' && (
                    <Chip label={`load: ${worker.load.toFixed(1)}`} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                  )}
                </Stack>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Last seen: {new Date(worker.lastHeartbeat).toLocaleString()}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>
    </Box>
  );
}
