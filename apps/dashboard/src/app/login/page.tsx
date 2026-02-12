'use client';

import { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Stack, Container, Alert,
  CircularProgress,
} from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // On mount, check if setup has been completed. If not, redirect to /setup.
  // Also check if user already has a valid token.
  useEffect(() => {
    (async () => {
      try {
        // Check if already logged in
        const token = localStorage.getItem('ai-engine-token');
        if (token) {
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]));
            if (payload.exp * 1000 > Date.now()) {
              // Token still valid — redirect to dashboard
              const params = new URLSearchParams(window.location.search);
              window.location.href = params.get('redirect') || '/chat';
              return;
            }
          }
        }

        // Check if setup is complete
        const res = await fetch('/api/setup/status');
        const data = await res.json();
        if (!data.setupComplete) {
          window.location.href = '/setup';
          return;
        }
      } catch {
        // If the API fails, show login anyway
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }

      // Store the JWT token in both localStorage and cookie
      localStorage.setItem('ai-engine-token', data.token);
      localStorage.setItem('ai-engine-user', JSON.stringify(data.user));
      // Set cookie so middleware can read it (7 days to match JWT expiry)
      document.cookie = `ai-engine-token=${data.token}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;

      // Redirect to the originally requested page, or default to /chat
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect') || '/chat';
      window.location.href = redirect;
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
      }}
    >
      <Container maxWidth="xs">
        <Stack alignItems="center" spacing={2} mb={4}>
          <SmartToyIcon sx={{ fontSize: 48, color: 'primary.main' }} />
          <Typography variant="h4" fontWeight={700}>AI Engine</Typography>
          <Typography color="text.secondary">Sign in to your dashboard</Typography>
        </Stack>

        <Paper sx={{ p: 4 }}>
          <form onSubmit={handleLogin}>
            <Stack spacing={2.5}>
              <TextField
                label="Email"
                fullWidth
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                required
              />
              <TextField
                label="Password"
                fullWidth
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />

              {error && <Alert severity="error">{error}</Alert>}

              <Button
                variant="contained"
                type="submit"
                size="large"
                disabled={loading || !email || !password}
                fullWidth
                sx={{ py: 1.5 }}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Sign In'}
              </Button>
            </Stack>
          </form>
        </Paper>
      </Container>
    </Box>
  );
}
