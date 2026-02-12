'use client';

import { useState } from 'react';
import {
  Box, TextField, IconButton, Typography, Paper, List, ListItemButton,
  ListItemText, Divider, Avatar, Chip, InputAdornment, Stack,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import AddIcon from '@mui/icons-material/Add';
import SmartToyIcon from '@mui/icons-material/SmartToy';

interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  timestamp: Date;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null);

  const handleSend = () => {
    if (!input.trim()) return;
    const newMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMsg]);
    setInput('');
    setThinkingStatus('Thinking...');

    // Simulate AI response
    setTimeout(() => {
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'ai',
        content: 'This is a placeholder response. Connect to the backend to enable real AI responses.',
        timestamp: new Date(),
      }]);
      setThinkingStatus(null);
    }, 1500);
  };

  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 80px)', gap: 2 }}>
      {/* Sidebar - chat list */}
      <Paper
        sx={{ width: 280, flexShrink: 0, display: { xs: 'none', md: 'flex' }, flexDirection: 'column', overflow: 'auto' }}
      >
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="subtitle2" color="text.secondary">Personal</Typography>
          <IconButton size="small"><AddIcon /></IconButton>
        </Box>
        <List dense>
          <ListItemButton selected>
            <ListItemText primary="New conversation" secondary="Just now" />
          </ListItemButton>
        </List>
        <Divider />
        <Box sx={{ p: 2 }}>
          <Typography variant="subtitle2" color="text.secondary">Teams</Typography>
        </Box>
      </Paper>

      {/* Main chat area */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Messages */}
        <Box sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2, py: 2 }}>
          {messages.length === 0 && (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2 }}>
              <SmartToyIcon sx={{ fontSize: 64, color: 'text.disabled' }} />
              <Typography variant="h5" color="text.secondary">How can I help you today?</Typography>
              <Stack direction="row" spacing={1}>
                <Chip label="Check my portfolio" variant="outlined" onClick={() => setInput('Check my retirement portfolio')} />
                <Chip label="Create a workflow" variant="outlined" onClick={() => setInput('Help me create a software development workflow')} />
                <Chip label="Schedule a task" variant="outlined" onClick={() => setInput('Schedule a daily report at 9 AM')} />
              </Stack>
            </Box>
          )}
          {messages.map((msg) => (
            <Box
              key={msg.id}
              sx={{
                display: 'flex',
                gap: 1.5,
                px: 2,
                alignItems: 'flex-start',
                ...(msg.role === 'user' ? { flexDirection: 'row-reverse' } : {}),
              }}
            >
              <Avatar sx={{ width: 32, height: 32, bgcolor: msg.role === 'ai' ? 'primary.main' : 'secondary.main' }}>
                {msg.role === 'ai' ? <SmartToyIcon sx={{ fontSize: 18 }} /> : 'U'}
              </Avatar>
              <Paper
                elevation={0}
                sx={{
                  p: 2, maxWidth: '70%', borderRadius: 3,
                  bgcolor: msg.role === 'user' ? 'primary.main' : 'action.hover',
                  color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                }}
              >
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{msg.content}</Typography>
              </Paper>
            </Box>
          ))}
        </Box>

        {/* Thinking indicator */}
        {thinkingStatus && (
          <Box sx={{ px: 2, py: 0.5 }}>
            <Typography variant="caption" color="primary" sx={{ fontStyle: 'italic' }}>
              {thinkingStatus}
            </Typography>
          </Box>
        )}

        {/* Input */}
        <Box sx={{ p: 2 }}>
          <TextField
            fullWidth
            placeholder="Message AI Engine..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            multiline
            maxRows={4}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={handleSend} color="primary" disabled={!input.trim()}>
                    <SendIcon />
                  </IconButton>
                </InputAdornment>
              ),
              sx: { borderRadius: 3, bgcolor: 'background.paper' },
            }}
          />
        </Box>
      </Box>
    </Box>
  );
}
