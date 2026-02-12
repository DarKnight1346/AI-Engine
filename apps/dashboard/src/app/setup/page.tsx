'use client';

import { useState } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Stepper, Step, StepLabel,
  Stack, Container, Alert, CircularProgress, Chip,
} from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';

const steps = ['Admin Account', 'Create Team', 'API Keys', 'Vault Passphrase', 'Add Worker', 'Done'];

export default function SetupPage() {
  const [activeStep, setActiveStep] = useState(0);
  const [formData, setFormData] = useState({
    email: '', password: '', displayName: '',
    teamName: '', apiKey: '', passphrase: '',
  });

  const handleNext = () => setActiveStep((prev) => Math.min(prev + 1, steps.length - 1));
  const handleBack = () => setActiveStep((prev) => Math.max(prev - 1, 0));
  const updateField = (field: string, value: string) => setFormData((prev) => ({ ...prev, [field]: value }));

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', p: 2 }}>
      <Container maxWidth="sm">
        <Stack alignItems="center" spacing={2} mb={4}>
          <SmartToyIcon sx={{ fontSize: 48, color: 'primary.main' }} />
          <Typography variant="h4" fontWeight={700}>AI Engine Setup</Typography>
          <Typography color="text.secondary">Let's get your system configured</Typography>
        </Stack>

        <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}><StepLabel>{label}</StepLabel></Step>
          ))}
        </Stepper>

        <Paper sx={{ p: 4 }}>
          {activeStep === 0 && (
            <Stack spacing={2}>
              <Typography variant="h3">Create Admin Account</Typography>
              <TextField label="Display Name" fullWidth value={formData.displayName} onChange={(e) => updateField('displayName', e.target.value)} />
              <TextField label="Email" fullWidth type="email" value={formData.email} onChange={(e) => updateField('email', e.target.value)} />
              <TextField label="Password" fullWidth type="password" value={formData.password} onChange={(e) => updateField('password', e.target.value)} />
            </Stack>
          )}

          {activeStep === 1 && (
            <Stack spacing={2}>
              <Typography variant="h3">Create Your First Team</Typography>
              <Typography variant="body2" color="text.secondary">Optional. You can skip this and create teams later.</Typography>
              <TextField label="Team Name" fullWidth value={formData.teamName} onChange={(e) => updateField('teamName', e.target.value)} placeholder="e.g., Engineering, Personal" />
            </Stack>
          )}

          {activeStep === 2 && (
            <Stack spacing={2}>
              <Typography variant="h3">Add Claude API Keys</Typography>
              <Typography variant="body2" color="text.secondary">Add one or more Claude API keys. More keys = better load distribution.</Typography>
              <TextField label="Claude API Key" fullWidth value={formData.apiKey} onChange={(e) => updateField('apiKey', e.target.value)} placeholder="sk-ant-..." />
              <Alert severity="info">Each key is validated with a test call before saving.</Alert>
            </Stack>
          )}

          {activeStep === 3 && (
            <Stack spacing={2}>
              <Typography variant="h3">Vault Passphrase</Typography>
              <Typography variant="body2" color="text.secondary">This encrypts all stored credentials. Keep it safe — it cannot be recovered.</Typography>
              <TextField label="Passphrase" fullWidth type="password" value={formData.passphrase} onChange={(e) => updateField('passphrase', e.target.value)} />
            </Stack>
          )}

          {activeStep === 4 && (
            <Stack spacing={2}>
              <Typography variant="h3">Add Your First Worker</Typography>
              <Typography variant="body2" color="text.secondary">Run this command on any machine to join it to the cluster:</Typography>
              <Paper sx={{ p: 2, bgcolor: 'grey.900', color: 'grey.100', borderRadius: 2, fontFamily: 'monospace', fontSize: 14 }}>
                npx @ai-engine/join-worker --server https://your-domain.com --token eyJhb...
              </Paper>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">Waiting for first worker to connect...</Typography>
              </Box>
            </Stack>
          )}

          {activeStep === 5 && (
            <Stack spacing={2} alignItems="center">
              <Typography variant="h3">All Set!</Typography>
              <Chip label="Setup Complete" color="success" />
              <Typography variant="body2" color="text.secondary" textAlign="center">
                Your AI Engine is ready. You'll be redirected to the dashboard.
              </Typography>
            </Stack>
          )}

          <Stack direction="row" justifyContent="space-between" sx={{ mt: 4 }}>
            <Button onClick={handleBack} disabled={activeStep === 0}>Back</Button>
            <Button variant="contained" onClick={handleNext}>
              {activeStep === steps.length - 1 ? 'Go to Dashboard' : activeStep === 1 ? 'Skip / Next' : 'Next'}
            </Button>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
