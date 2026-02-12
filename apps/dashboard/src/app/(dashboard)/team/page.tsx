'use client';

import {
  Box, Typography, Card, CardContent, Button, Avatar, Chip, Stack,
  List, ListItem, ListItemAvatar, ListItemText, Slider, TextField,
  Divider, Paper,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';

const DEMO_MEMBERS = [
  { name: 'Admin User', email: 'admin@example.com', role: 'owner', status: 'online' },
  { name: 'Sarah Dev', email: 'sarah@example.com', role: 'member', status: 'online' },
  { name: 'Mike QA', email: 'mike@example.com', role: 'member', status: 'offline' },
];

export default function TeamPage() {
  return (
    <Box>
      <Typography variant="h2" sx={{ mb: 3 }}>Team</Typography>

      <Stack spacing={3}>
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h3">Members</Typography>
            <Button startIcon={<PersonAddIcon />} variant="outlined" size="small">Invite</Button>
          </Box>
          <List>
            {DEMO_MEMBERS.map((member, i) => (
              <ListItem key={member.email} divider={i < DEMO_MEMBERS.length - 1}>
                <ListItemAvatar>
                  <Avatar>{member.name[0]}</Avatar>
                </ListItemAvatar>
                <ListItemText primary={member.name} secondary={member.email} />
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip label={member.role} size="small" variant="outlined" />
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: member.status === 'online' ? 'success.main' : 'grey.400' }} />
                </Stack>
              </ListItem>
            ))}
          </List>
        </Paper>

        <Paper sx={{ p: 3 }}>
          <Typography variant="h3" sx={{ mb: 2 }}>AI Response Settings</Typography>
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>Response Sensitivity</Typography>
            <Stack direction="row" spacing={2} alignItems="center">
              <Typography variant="caption">Reserved</Typography>
              <Slider defaultValue={50} sx={{ flex: 1 }} />
              <Typography variant="caption">Eager</Typography>
            </Stack>
          </Box>
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>Always-respond keywords</Typography>
            <TextField fullWidth size="small" placeholder="status update, run report, check portfolio" />
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>Quiet hours</Typography>
            <Stack direction="row" spacing={2}>
              <TextField size="small" label="Start" type="time" defaultValue="22:00" InputLabelProps={{ shrink: true }} />
              <TextField size="small" label="End" type="time" defaultValue="08:00" InputLabelProps={{ shrink: true }} />
            </Stack>
          </Box>
        </Paper>
      </Stack>
    </Box>
  );
}
