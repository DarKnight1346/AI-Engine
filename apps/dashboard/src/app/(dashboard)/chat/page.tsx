'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box, TextField, IconButton, Typography, Paper, List, ListItemButton,
  ListItemText, Divider, Avatar, Chip, InputAdornment, Stack,
  CircularProgress, Tooltip, Snackbar, Alert,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import AddIcon from '@mui/icons-material/Add';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import DeleteIcon from '@mui/icons-material/Delete';

interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  timestamp: Date;
}

interface ChatSession {
  id: string;
  title: string;
  type: string;
  messageCount: number;
  lastMessage: string | null;
  lastMessageAt: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // ── Load session list ──
  const loadSessions = useCallback(() => {
    fetch('/api/chat/sessions')
      .then((res) => res.json())
      .then((data) => setSessions(data.sessions ?? []))
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── Load messages for a session ──
  const loadMessages = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/chat/messages?sessionId=${sid}`);
      const data = await res.json();
      setMessages((data.messages ?? []).map((m: any) => ({
        id: m.id,
        role: m.role as 'user' | 'ai',
        content: m.content,
        timestamp: new Date(m.timestamp),
      })));
    } catch {
      setMessages([]);
    }
  }, []);

  // ── Switch to a session ──
  const switchSession = useCallback((sid: string) => {
    setSessionId(sid);
    loadMessages(sid);
  }, [loadMessages]);

  // ── New conversation ──
  const startNewConversation = () => {
    setSessionId(null);
    setMessages([]);
  };

  // ── Delete a session ──
  const deleteSession = useCallback(async (sid: string) => {
    try {
      await fetch(`/api/chat/sessions?id=${sid}`, { method: 'DELETE' });
      if (sessionId === sid) {
        setSessionId(null);
        setMessages([]);
      }
      loadSessions();
      setSnack({ open: true, message: 'Conversation deleted', severity: 'success' });
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    }
  }, [sessionId, loadSessions]);

  // ── Send message ──
  const handleSend = async () => {
    if (!input.trim() || sending) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    const currentInput = input;
    setInput('');
    setSending(true);

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: currentInput, sessionId }),
      });
      const data = await res.json();

      if (data.sessionId) {
        setSessionId(data.sessionId);
        // Refresh session list to show the new/updated session
        loadSessions();
      }

      if (data.aiMessage) {
        setMessages((prev) => [...prev, {
          id: data.aiMessage.id,
          role: 'ai',
          content: data.aiMessage.content,
          timestamp: new Date(data.aiMessage.createdAt),
        }]);
      } else if (data.error) {
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'ai',
          content: `Error: ${data.error}`,
          timestamp: new Date(),
        }]);
      }
    } catch (err: any) {
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'ai',
        content: `Failed to connect to the server: ${err.message}`,
        timestamp: new Date(),
      }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 80px)', gap: 2 }}>
      {/* Sidebar */}
      <Paper sx={{ width: 280, flexShrink: 0, display: { xs: 'none', md: 'flex' }, flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="subtitle2" color="text.secondary">Conversations</Typography>
          <Tooltip title="New conversation">
            <IconButton size="small" onClick={startNewConversation}><AddIcon /></IconButton>
          </Tooltip>
        </Box>
        <Divider />
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {sessionsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={20} /></Box>
          ) : sessions.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ p: 2, display: 'block', textAlign: 'center' }}>
              No conversations yet
            </Typography>
          ) : (
            <List dense disablePadding>
              {sessions.filter((s) => s.type === 'personal').map((session) => (
                <ListItemButton
                  key={session.id}
                  selected={sessionId === session.id}
                  onClick={() => switchSession(session.id)}
                  sx={{ pr: 1 }}
                >
                  <ListItemText
                    primary={session.title || 'Untitled'}
                    secondary={session.lastMessage?.slice(0, 50) ?? `${session.messageCount} messages`}
                    primaryTypographyProps={{ noWrap: true, fontSize: 13 }}
                    secondaryTypographyProps={{ noWrap: true, fontSize: 11 }}
                  />
                  <Tooltip title="Delete">
                    <IconButton
                      size="small"
                      onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                      sx={{ opacity: 0.3, '&:hover': { opacity: 1 } }}
                    >
                      <DeleteIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
        <Divider />
        <Box sx={{ p: 2 }}>
          <Typography variant="subtitle2" color="text.secondary">Teams</Typography>
          {sessions.filter((s) => s.type === 'team').length > 0 ? (
            <List dense disablePadding>
              {sessions.filter((s) => s.type === 'team').map((session) => (
                <ListItemButton key={session.id} selected={sessionId === session.id} onClick={() => switchSession(session.id)}>
                  <ListItemText primary={session.title || 'Team Chat'} primaryTypographyProps={{ noWrap: true, fontSize: 13 }} />
                </ListItemButton>
              ))}
            </List>
          ) : (
            <Typography variant="caption" color="text.disabled">No team chats</Typography>
          )}
        </Box>
      </Paper>

      {/* Main chat */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Box ref={scrollRef} sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2, py: 2 }}>
          {messages.length === 0 && (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2 }}>
              <SmartToyIcon sx={{ fontSize: 64, color: 'text.disabled' }} />
              <Typography variant="h5" color="text.secondary">How can I help you today?</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center">
                <Chip label="Check my portfolio" variant="outlined" onClick={() => setInput('Check my retirement portfolio')} />
                <Chip label="Create a workflow" variant="outlined" onClick={() => setInput('Help me create a software development workflow')} />
                <Chip label="Schedule a task" variant="outlined" onClick={() => setInput('Schedule a daily report at 9 AM')} />
              </Stack>
            </Box>
          )}
          {messages.map((msg) => (
            <Box key={msg.id} sx={{ display: 'flex', gap: 1.5, px: 2, alignItems: 'flex-start', ...(msg.role === 'user' ? { flexDirection: 'row-reverse' } : {}) }}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: msg.role === 'ai' ? 'primary.main' : 'secondary.main' }}>
                {msg.role === 'ai' ? <SmartToyIcon sx={{ fontSize: 18 }} /> : 'U'}
              </Avatar>
              <Paper elevation={0} sx={{ p: 2, maxWidth: '70%', borderRadius: 3, bgcolor: msg.role === 'user' ? 'primary.main' : 'action.hover', color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary' }}>
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{msg.content}</Typography>
              </Paper>
            </Box>
          ))}
          {sending && (
            <Box sx={{ display: 'flex', gap: 1.5, px: 2, alignItems: 'center' }}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
                <SmartToyIcon sx={{ fontSize: 18 }} />
              </Avatar>
              <CircularProgress size={20} />
            </Box>
          )}
        </Box>

        <Box sx={{ p: 2 }}>
          <TextField
            fullWidth
            placeholder="Message AI Engine..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            multiline
            maxRows={4}
            disabled={sending}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={handleSend} color="primary" disabled={!input.trim() || sending}>
                    <SendIcon />
                  </IconButton>
                </InputAdornment>
              ),
              sx: { borderRadius: 3, bgcolor: 'background.paper' },
            }}
          />
        </Box>
      </Box>

      <Snackbar open={snack.open} autoHideDuration={3000} onClose={() => setSnack((s) => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))} variant="filled">{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
