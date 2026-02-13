'use client';

import { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import {
  Box, TextField, IconButton, Typography, Paper, List, ListItemButton,
  ListItemText, Divider, Avatar, Chip, InputAdornment, Stack,
  CircularProgress, Tooltip, Snackbar, Alert, Popover, MenuItem,
  ListItemIcon, Fade, alpha, useTheme,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import AddIcon from '@mui/icons-material/Add';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import DeleteIcon from '@mui/icons-material/Delete';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import CloseIcon from '@mui/icons-material/Close';
import PersonIcon from '@mui/icons-material/Person';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import DownloadIcon from '@mui/icons-material/Download';

/* ─── Types ─────────────────────────────────────────────────────────── */

interface Attachment {
  id: string;
  name: string;
  type: string;      // MIME type
  url: string;       // data URL for preview, or uploaded URL
  size: number;
}

interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  timestamp: Date;
  agentName?: string;
  attachments?: Attachment[];
}

interface ChatSession {
  id: string;
  title: string;
  type: string;
  messageCount: number;
  lastMessage: string | null;
  lastMessageAt: string;
}

interface Agent {
  id: string;
  name: string;
  rolePrompt: string;
  status: string;
}

/* ─── Markdown rendering ────────────────────────────────────────────── */

function CodeBlock({ content }: { content: string }) {
  const theme = useTheme();
  const inner = content.slice(3, -3);
  const firstNewline = inner.indexOf('\n');
  const langLine = firstNewline > -1 ? inner.slice(0, firstNewline).trim() : '';
  const lang = langLine && !langLine.includes(' ') ? langLine : '';
  const code = lang ? inner.slice(firstNewline + 1).trimEnd() : inner.trimEnd();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box sx={{ position: 'relative', my: 1.5 }}>
      {lang && (
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: 2, py: 0.75,
          bgcolor: alpha(theme.palette.common.black, 0.3),
          borderTopLeftRadius: 8, borderTopRightRadius: 8,
          borderBottom: '1px solid', borderColor: 'divider',
        }}>
          <Typography variant="caption" sx={{ color: 'text.disabled', fontFamily: 'monospace', fontSize: 11 }}>
            {lang}
          </Typography>
          <Tooltip title={copied ? 'Copied!' : 'Copy'}>
            <IconButton size="small" onClick={handleCopy} sx={{ color: 'text.disabled', p: 0.25 }}>
              <ContentCopyIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 2,
          bgcolor: alpha(theme.palette.common.black, 0.25),
          borderRadius: lang ? '0 0 8px 8px' : 2,
          overflow: 'auto',
          fontSize: 13,
          lineHeight: 1.6,
          fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
          '& code': { fontFamily: 'inherit' },
        }}
      >
        <code>{code}</code>
      </Box>
      {!lang && (
        <Tooltip title={copied ? 'Copied!' : 'Copy'}>
          <IconButton
            size="small"
            onClick={handleCopy}
            sx={{ position: 'absolute', top: 6, right: 6, color: 'text.disabled', opacity: 0.5, '&:hover': { opacity: 1 } }}
          >
            <ContentCopyIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

function FormattedText({ text }: { text: string }) {
  // Regex for bold, italic, inline code, and links
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`'))
          return (
            <Box key={i} component="code" sx={{
              bgcolor: 'rgba(255,255,255,0.06)', px: 0.6, py: 0.2,
              borderRadius: 0.5, fontSize: '0.87em',
              fontFamily: '"JetBrains Mono", monospace',
            }}>
              {part.slice(1, -1)}
            </Box>
          );
        if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**'))
          return <em key={i}>{part.slice(1, -1)}</em>;
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch)
          return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" style={{ color: '#90caf9' }}>{linkMatch[1]}</a>;
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

/** Detect image URLs in text (common image hosting patterns + xAI image CDN) */
/** Detect image URLs in text (common extensions + xAI CDN) */
function isImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(lower)) return true;
  if (/images\.x\.ai|imgen\.x\.ai|cdn\.x\.ai/i.test(lower)) return true;
  return false;
}

/** Detect video URLs in text */
function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (/\.(mp4|webm|mov|ogg)(\?|$)/i.test(lower)) return true;
  if (/vidgen\.x\.ai/i.test(lower)) return true;
  return false;
}

/** Match any URL in text */
const URL_REGEX = /https?:\/\/[^\s)<>]+/g;

/** Trigger a download for a URL */
function downloadUrl(url: string, filename?: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || url.split('/').pop()?.split('?')[0] || 'download';
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Render an inline image with lightbox + download */
function InlineImage({ url }: { url: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <Box sx={{ position: 'relative', display: 'inline-block', my: 1, '&:hover .media-actions': { opacity: 1 } }}>
        <Box
          component="img"
          src={url}
          alt="Generated image"
          onClick={() => setExpanded(true)}
          sx={{
            maxWidth: '100%',
            maxHeight: 400,
            borderRadius: 2,
            cursor: 'pointer',
            display: 'block',
            transition: 'transform 0.2s',
            '&:hover': { transform: 'scale(1.01)', boxShadow: 3 },
          }}
        />
        <Box
          className="media-actions"
          sx={{
            position: 'absolute', bottom: 8, right: 8,
            display: 'flex', gap: 0.5,
            opacity: 0, transition: 'opacity 0.2s',
          }}
        >
          <Tooltip title="Download image">
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); downloadUrl(url, 'generated-image.png'); }}
              sx={{
                bgcolor: 'rgba(0,0,0,0.65)', color: 'white',
                backdropFilter: 'blur(4px)',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.85)' },
              }}
            >
              <DownloadIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      {expanded && (
        <Box
          onClick={() => setExpanded(false)}
          sx={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            bgcolor: 'rgba(0,0,0,0.85)', zIndex: 9999,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out', p: 4,
          }}
        >
          <Box
            component="img"
            src={url}
            alt="Generated image (full)"
            sx={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 2 }}
          />
          <Box sx={{ mt: 2 }}>
            <IconButton
              onClick={(e) => { e.stopPropagation(); downloadUrl(url, 'generated-image.png'); }}
              sx={{ color: 'white', bgcolor: 'rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}
            >
              <DownloadIcon />
            </IconButton>
          </Box>
        </Box>
      )}
    </>
  );
}

/** Render an inline video player with controls + download */
function InlineVideo({ url }: { url: string }) {
  return (
    <Box sx={{ position: 'relative', my: 1, '&:hover .media-actions': { opacity: 1 } }}>
      <Box
        component="video"
        src={url}
        controls
        preload="metadata"
        sx={{
          maxWidth: '100%',
          maxHeight: 400,
          borderRadius: 2,
          display: 'block',
          bgcolor: 'black',
        }}
      />
      <Box
        className="media-actions"
        sx={{
          position: 'absolute', top: 8, right: 8,
          display: 'flex', gap: 0.5,
          opacity: 0, transition: 'opacity 0.2s',
        }}
      >
        <Tooltip title="Download video">
          <IconButton
            size="small"
            onClick={() => downloadUrl(url, 'generated-video.mp4')}
            sx={{
              bgcolor: 'rgba(0,0,0,0.65)', color: 'white',
              backdropFilter: 'blur(4px)',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.85)' },
            }}
          >
            <DownloadIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

function MessageContent({ content, attachments }: { content: string; attachments?: Attachment[] }) {
  // Split by code blocks first
  const segments = content.split(/(```[\s\S]*?```)/g);

  return (
    <Box sx={{ '& > *:first-of-type': { mt: 0 }, '& > *:last-child': { mb: 0 } }}>
      {/* Render any explicit attachments (images, videos, files) */}
      {attachments && attachments.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1.5 }}>
          {attachments.filter(a => a.type.startsWith('image/')).map((att) => (
            <InlineImage key={att.id} url={att.url} />
          ))}
          {attachments.filter(a => a.type.startsWith('video/')).map((att) => (
            <InlineVideo key={att.id} url={att.url} />
          ))}
          {attachments.filter(a => !a.type.startsWith('image/') && !a.type.startsWith('video/')).map((att) => (
            <Chip
              key={att.id}
              icon={<InsertDriveFileIcon />}
              label={att.name}
              size="small"
              component="a"
              href={att.url}
              target="_blank"
              clickable
              deleteIcon={<DownloadIcon sx={{ fontSize: '16px !important' }} />}
              onDelete={() => downloadUrl(att.url, att.name)}
              sx={{ maxWidth: 280 }}
            />
          ))}
        </Box>
      )}

      {segments.map((segment, idx) => {
        if (segment.startsWith('```')) return <CodeBlock key={idx} content={segment} />;
        if (!segment.trim()) return null;

        // Split into paragraphs
        const paragraphs = segment.split(/\n\n+/);
        return (
          <Fragment key={idx}>
            {paragraphs.map((para, pIdx) => {
              const trimmed = para.trim();
              if (!trimmed) return null;

              // Headers
              const h3Match = trimmed.match(/^###\s+(.+)/);
              if (h3Match) return (
                <Typography key={pIdx} variant="subtitle2" sx={{ mt: 2, mb: 0.5, fontWeight: 700 }}>
                  <FormattedText text={h3Match[1]} />
                </Typography>
              );
              const h2Match = trimmed.match(/^##\s+(.+)/);
              if (h2Match) return (
                <Typography key={pIdx} variant="subtitle1" sx={{ mt: 2, mb: 0.5, fontWeight: 700 }}>
                  <FormattedText text={h2Match[1]} />
                </Typography>
              );
              const h1Match = trimmed.match(/^#\s+(.+)/);
              if (h1Match) return (
                <Typography key={pIdx} variant="h6" sx={{ mt: 2, mb: 0.5, fontWeight: 700 }}>
                  <FormattedText text={h1Match[1]} />
                </Typography>
              );

              // Lists (bullet or numbered)
              const lines = trimmed.split('\n');
              const isBulletList = lines.every(l => /^\s*[-*•]\s/.test(l) || !l.trim());
              const isNumberedList = lines.every(l => /^\s*\d+[.)]\s/.test(l) || !l.trim());

              if (isBulletList) return (
                <Box component="ul" key={pIdx} sx={{ my: 1, pl: 2.5, '& li': { mb: 0.5 } }}>
                  {lines.filter(l => l.trim()).map((line, j) => (
                    <li key={j}>
                      <Typography variant="body2" component="span" sx={{ lineHeight: 1.7 }}>
                        <FormattedText text={line.replace(/^\s*[-*•]\s/, '')} />
                      </Typography>
                    </li>
                  ))}
                </Box>
              );

              if (isNumberedList) return (
                <Box component="ol" key={pIdx} sx={{ my: 1, pl: 2.5, '& li': { mb: 0.5 } }}>
                  {lines.filter(l => l.trim()).map((line, j) => (
                    <li key={j}>
                      <Typography variant="body2" component="span" sx={{ lineHeight: 1.7 }}>
                        <FormattedText text={line.replace(/^\s*\d+[.)]\s/, '')} />
                      </Typography>
                    </li>
                  ))}
                </Box>
              );

              // Check for media URLs (images, videos) in the paragraph
              const urlMatches = trimmed.match(URL_REGEX);
              const hasMediaUrls = urlMatches?.some(u => isImageUrl(u) || isVideoUrl(u));
              if (hasMediaUrls) {
                // Split around URLs and render media inline
                const parts = trimmed.split(URL_REGEX);
                const urls = trimmed.match(URL_REGEX) ?? [];
                const elements: React.ReactNode[] = [];
                for (let pi = 0; pi < parts.length; pi++) {
                  if (parts[pi].trim()) {
                    elements.push(
                      <Typography key={`t${pi}`} variant="body2" component="span" sx={{ lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
                        <FormattedText text={parts[pi]} />
                      </Typography>
                    );
                  }
                  if (pi < urls.length) {
                    if (isVideoUrl(urls[pi])) {
                      elements.push(<InlineVideo key={`vid${pi}`} url={urls[pi]} />);
                    } else if (isImageUrl(urls[pi])) {
                      elements.push(<InlineImage key={`img${pi}`} url={urls[pi]} />);
                    } else {
                      elements.push(
                        <Typography key={`u${pi}`} variant="body2" component="span" sx={{ lineHeight: 1.75 }}>
                          <a href={urls[pi]} target="_blank" rel="noopener noreferrer" style={{ color: '#90caf9' }}>{urls[pi]}</a>
                        </Typography>
                      );
                    }
                  }
                }
                return <Box key={pIdx} sx={{ my: 0.75 }}>{elements}</Box>;
              }

              // Regular paragraph
              return (
                <Typography key={pIdx} variant="body2" sx={{ my: 0.75, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
                  <FormattedText text={trimmed} />
                </Typography>
              );
            })}
          </Fragment>
        );
      })}
    </Box>
  );
}

/* ─── Typing indicator ──────────────────────────────────────────────── */

function TypingIndicator() {
  return (
    <Box sx={{ display: 'flex', gap: 0.6, alignItems: 'center', p: 1 }}>
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: 7, height: 7, borderRadius: '50%',
            bgcolor: 'text.disabled',
            animation: 'typing-bounce 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`,
            '@keyframes typing-bounce': {
              '0%, 80%, 100%': { transform: 'scale(0.6)', opacity: 0.3 },
              '40%': { transform: 'scale(1)', opacity: 1 },
            },
          }}
        />
      ))}
    </Box>
  );
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

function formatTime(date: Date) {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/* ─── Context indicator ────────────────────────────────────────────── */

const CONTEXT_WINDOW_LIMIT = 180_000; // tokens – matches DEFAULT_CONFIG.memory.contextWindowTokenLimit

function estimateTokensFromMessages(msgs: { content: string }[]) {
  // Rough estimate: 1 token ≈ 4 characters (same heuristic used in context-builder)
  return msgs.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
}

function ContextIndicator({ tokens, maxTokens }: { tokens: number; maxTokens: number }) {
  const theme = useTheme();
  const percentage = Math.min((tokens / maxTokens) * 100, 100);
  const tokensK = tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}K` : `${tokens}`;
  const maxK = `${(maxTokens / 1000).toFixed(0)}K`;

  // Color shifts as context fills up
  let ringColor = theme.palette.primary.main;
  if (percentage > 75) ringColor = theme.palette.warning.main;
  if (percentage > 90) ringColor = theme.palette.error.main;

  return (
    <Tooltip
      title={`Context: ~${tokensK} / ${maxK} tokens (${percentage.toFixed(0)}%)`}
      arrow
      placement="top"
    >
      <Box sx={{ position: 'relative', display: 'inline-flex', width: 28, height: 28, cursor: 'default' }}>
        {/* Background track */}
        <CircularProgress
          variant="determinate"
          value={100}
          size={28}
          thickness={3}
          sx={{ color: alpha(theme.palette.text.disabled, 0.12), position: 'absolute' }}
        />
        {/* Filled arc */}
        <CircularProgress
          variant="determinate"
          value={percentage}
          size={28}
          thickness={3}
          sx={{
            color: ringColor,
            transition: 'color 0.4s ease',
            '& .MuiCircularProgress-circle': {
              transition: 'stroke-dashoffset 0.6s ease-in-out',
            },
          }}
        />
        {/* Center label */}
        <Box
          sx={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Typography
            sx={{
              fontSize: 7.5,
              fontWeight: 700,
              color: 'text.secondary',
              lineHeight: 1,
              letterSpacing: '-0.02em',
            }}
          >
            {tokensK}
          </Typography>
        </Box>
      </Box>
    </Tooltip>
  );
}

/* ─── Main Component ────────────────────────────────────────────────── */

export default function ChatPage() {
  const theme = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [contextTokens, setContextTokens] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [mentionAnchor, setMentionAnchor] = useState<HTMLElement | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File attachment handlers ──
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
  const ACCEPTED_TYPES = 'image/*,video/*,.pdf,.txt,.csv,.json,.md,.html,.xml,.doc,.docx,.xls,.xlsx';

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setSnack({ open: true, message: `File "${file.name}" exceeds 20 MB limit`, severity: 'error' });
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setAttachments((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            name: file.name,
            type: file.type || 'application/octet-stream',
            url: dataUrl,
            size: file.size,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }

    // Reset file input so the same file can be re-selected
    e.target.value = '';
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Handle paste events (paste images from clipboard)
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);

    if (files.length === 0) return;
    // Don't prevent default for text paste
    e.preventDefault();

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setSnack({ open: true, message: `Pasted file exceeds 20 MB limit`, severity: 'error' });
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            name: file.name || `pasted-${file.type.split('/')[1] || 'file'}`,
            type: file.type || 'application/octet-stream',
            url: reader.result as string,
            size: file.size,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  // Handle drag and drop
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback(() => setIsDragOver(false), []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setSnack({ open: true, message: `File "${file.name}" exceeds 20 MB limit`, severity: 'error' });
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            name: file.name,
            type: file.type || 'application/octet-stream',
            url: reader.result as string,
            size: file.size,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // ── Load sessions ──
  const loadSessions = useCallback(() => {
    fetch('/api/chat/sessions')
      .then((res) => res.json())
      .then((data) => setSessions(data.sessions ?? []))
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
  }, []);

  // ── Load agents ──
  const loadAgents = useCallback(() => {
    fetch('/api/agents')
      .then((res) => res.json())
      .then((data) => setAgents(data.agents ?? []))
      .catch(() => setAgents([]));
  }, []);

  useEffect(() => { loadSessions(); loadAgents(); }, [loadSessions, loadAgents]);

  // ── Load messages for a session ──
  const loadMessages = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/chat/messages?sessionId=${sid}`);
      const data = await res.json();
      const loaded = (data.messages ?? []).map((m: any) => ({
        id: m.id,
        role: m.role as 'user' | 'ai',
        content: m.content,
        timestamp: new Date(m.timestamp),
        agentName: m.agentName,
        attachments: m.attachments?.map((a: any) => ({
          id: a.id || crypto.randomUUID(),
          name: a.name,
          type: a.type,
          url: a.url,
          size: a.size ?? 0,
        })),
      }));
      setMessages(loaded);
      setContextTokens(estimateTokensFromMessages(loaded));
    } catch {
      setMessages([]);
      setContextTokens(0);
    }
  }, []);

  // ── Switch session ──
  const switchSession = useCallback((sid: string) => {
    setSessionId(sid);
    setSelectedAgent(null);
    loadMessages(sid);
  }, [loadMessages]);

  // ── New conversation ──
  const startNewConversation = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setSelectedAgent(null);
    setInput('');
    setContextTokens(0);
    inputRef.current?.focus();
  }, []);

  // ── Delete session ──
  const deleteSession = useCallback(async (sid: string) => {
    try {
      await fetch(`/api/chat/sessions?id=${sid}`, { method: 'DELETE' });
      if (sessionId === sid) {
        setSessionId(null);
        setMessages([]);
        setContextTokens(0);
      }
      loadSessions();
      setSnack({ open: true, message: 'Conversation deleted', severity: 'success' });
    } catch (err: any) {
      setSnack({ open: true, message: err.message, severity: 'error' });
    }
  }, [sessionId, loadSessions]);

  // ── Agent mention ──
  const handleMentionOpen = (e: React.MouseEvent<HTMLElement>) => {
    setMentionAnchor(e.currentTarget);
    setMentionQuery('');
  };

  const handleMentionClose = () => {
    setMentionAnchor(null);
    setMentionQuery('');
  };

  const handleAgentSelect = (agent: Agent | null) => {
    setSelectedAgent(agent);
    handleMentionClose();
    inputRef.current?.focus();
  };

  // ── Input handling with @ detection ──
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);

    // Detect @mention at end of input
    const match = value.match(/@(\w*)$/);
    if (match && inputRef.current) {
      setMentionQuery(match[1].toLowerCase());
      setMentionAnchor(inputRef.current);
    } else if (mentionAnchor && !value.includes('@')) {
      handleMentionClose();
    }
  };

  const handleMentionSelect = (agent: Agent) => {
    // Replace @query with nothing and set the agent
    const cleaned = input.replace(/@\w*$/, '').trim();
    setInput(cleaned);
    setSelectedAgent(agent);
    handleMentionClose();
    inputRef.current?.focus();
  };

  const filteredAgents = agents.filter((a) =>
    !mentionQuery || a.name.toLowerCase().includes(mentionQuery)
  );

  // ── Active SSE abort controller (to cancel streaming on unmount or new send) ──
  const abortRef = useRef<AbortController | null>(null);

  // ── Send message (streaming via SSE) ──
  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || sending) return;

    const currentAttachments = [...attachments];
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: new Date(),
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    // Update estimated context with the new user message
    setContextTokens((prev) => prev + Math.ceil(input.length / 4));
    const currentInput = input;
    const currentAgent = selectedAgent;
    setInput('');
    setAttachments([]);
    setSending(true);

    // Create a placeholder AI message that we'll stream into
    const aiMsgId = crypto.randomUUID();
    const aiMsg: Message = {
      id: aiMsgId,
      role: 'ai',
      content: '',
      timestamp: new Date(),
      agentName: currentAgent?.name,
    };
    setMessages((prev) => [...prev, aiMsg]);

    // Abort any previous stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: currentInput,
          sessionId,
          agentId: currentAgent?.id ?? null,
          attachments: currentAttachments.length > 0
            ? currentAttachments.map(a => ({ name: a.name, type: a.type, url: a.url, size: a.size }))
            : undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        setMessages((prev) => prev.map((m) =>
          m.id === aiMsgId ? { ...m, content: `Error: ${errData.error}` } : m
        ));
        setSending(false);
        return;
      }

      // Read the SSE stream with proper event: / data: correlation
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let streamedContent = '';
      let currentEventType = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();

          // Skip comments (keep-alive pings)
          if (trimmed.startsWith(':')) continue;

          // Track event type
          if (trimmed.startsWith('event: ')) {
            currentEventType = trimmed.slice(7).trim();
            continue;
          }

          // Empty line = end of event block, reset
          if (!trimmed) {
            currentEventType = '';
            continue;
          }

          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));

            switch (currentEventType) {
              case 'session':
                if (data.sessionId) {
                  setSessionId(data.sessionId);
                  loadSessions();
                }
                break;

              case 'token':
                streamedContent += data.text;
                setMessages((prev) => prev.map((m) =>
                  m.id === aiMsgId ? { ...m, content: streamedContent } : m
                ));
                break;

              case 'tool':
                // Tool lifecycle events — could show in UI later
                break;

              case 'status':
                // Status updates (e.g., "Using tool X...")
                break;

              case 'done':
                // Finalize with the full content from the server
                setMessages((prev) => prev.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: data.content, agentName: data.agentName || m.agentName }
                    : m
                ));
                // Update context tokens with actual usage from the LLM
                if (data.usage) {
                  const totalUsed = (data.usage.inputTokens ?? 0) + (data.usage.outputTokens ?? 0);
                  if (totalUsed > 0) setContextTokens(totalUsed);
                }
                break;

              case 'error':
                setMessages((prev) => prev.map((m) =>
                  m.id === aiMsgId ? { ...m, content: `Error: ${data.message}` } : m
                ));
                break;
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === aiMsgId);
          if (existing && !existing.content) {
            return prev.map((m) =>
              m.id === aiMsgId ? { ...m, content: `Failed to connect: ${err.message}` } : m
            );
          }
          return prev;
        });
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  // Clean up streaming on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // ── Keyboard shortcut ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        startNewConversation();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [startNewConversation]);

  /* ─── Render ────────────────────────────────────────────────────────── */

  const sidebarBg = alpha(theme.palette.background.paper, 0.6);
  const chatBg = theme.palette.background.default;

  return (
    <Box sx={{ display: 'flex', height: { xs: 'calc(100vh - 56px)', sm: 'calc(100vh - 64px)' }, overflow: 'hidden' }}>
      {/* ── Sidebar ────────────────────────────────────────────────── */}
      <Box
        sx={{
          width: 280, flexShrink: 0,
          display: { xs: 'none', md: 'flex' }, flexDirection: 'column',
          bgcolor: sidebarBg, borderRight: '1px solid', borderColor: 'divider',
        }}
      >
        {/* New Chat button */}
        <Box sx={{ p: 1.5 }}>
          <Box
            onClick={startNewConversation}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.5,
              px: 2, py: 1.25, borderRadius: 2,
              cursor: 'pointer', transition: 'all 0.15s',
              border: '1px solid', borderColor: 'divider',
              '&:hover': {
                bgcolor: alpha(theme.palette.primary.main, 0.08),
                borderColor: alpha(theme.palette.primary.main, 0.3),
              },
            }}
          >
            <AddIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.secondary' }}>
              New chat
            </Typography>
            <Typography variant="caption" sx={{ ml: 'auto', color: 'text.disabled', fontSize: 10 }}>
              Ctrl+N
            </Typography>
          </Box>
        </Box>

        <Divider />

        {/* Conversations list */}
        <Box sx={{ flex: 1, overflow: 'auto', py: 0.5 }}>
          {sessionsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={20} sx={{ color: 'text.disabled' }} />
            </Box>
          ) : sessions.length === 0 ? (
            <Typography
              variant="caption"
              sx={{ display: 'block', textAlign: 'center', color: 'text.disabled', py: 4, px: 2 }}
            >
              No conversations yet. Start a new chat!
            </Typography>
          ) : (
            <List disablePadding>
              {sessions.map((session) => (
                <ListItemButton
                  key={session.id}
                  selected={sessionId === session.id}
                  onClick={() => switchSession(session.id)}
                  sx={{
                    mx: 0.75, borderRadius: 1.5, mb: 0.25,
                    py: 1, px: 1.5, minHeight: 0,
                    '&.Mui-selected': {
                      bgcolor: alpha(theme.palette.primary.main, 0.1),
                      '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.15) },
                    },
                    '& .delete-btn': { opacity: 0 },
                    '&:hover .delete-btn': { opacity: 0.5 },
                  }}
                >
                  <ListItemText
                    primary={session.title || 'Untitled'}
                    secondary={session.lastMessage?.slice(0, 45) || `${session.messageCount} messages`}
                    primaryTypographyProps={{
                      noWrap: true, fontSize: 13, fontWeight: sessionId === session.id ? 600 : 400,
                    }}
                    secondaryTypographyProps={{
                      noWrap: true, fontSize: 11, sx: { mt: 0.25 },
                    }}
                  />
                  <Tooltip title="Delete">
                    <IconButton
                      className="delete-btn"
                      size="small"
                      onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                      sx={{ '&:hover': { opacity: 1, color: 'error.main' } }}
                    >
                      <DeleteIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  </Tooltip>
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      </Box>

      {/* ── Main chat area ──────────────────────────────────────────── */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', bgcolor: chatBg, minWidth: 0 }}>

        {/* Messages */}
        <Box
          ref={scrollRef}
          sx={{
            flex: 1, overflow: 'auto', px: { xs: 2, md: 0 },
            display: 'flex', flexDirection: 'column',
          }}
        >
          {messages.length === 0 ? (
            /* ── Empty state ─────────────────────────────────── */
            <Box sx={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 3, pb: 8,
            }}>
              <Box sx={{
                width: 72, height: 72, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.15)}, ${alpha(theme.palette.secondary.main, 0.15)})`,
                border: '1px solid', borderColor: alpha(theme.palette.primary.main, 0.2),
              }}>
                <AutoAwesomeIcon sx={{ fontSize: 32, color: 'primary.main' }} />
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>
                  How can I help you today?
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {selectedAgent
                    ? `Talking to ${selectedAgent.name}`
                    : 'Ask anything, or tag an agent with @'}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center" sx={{ maxWidth: 500, gap: 1 }}>
                {[
                  { label: 'Check my portfolio', prompt: 'Check my retirement portfolio' },
                  { label: 'Create a workflow', prompt: 'Help me create a software development workflow' },
                  { label: 'Schedule a task', prompt: 'Schedule a daily report at 9 AM' },
                ].map((s) => (
                  <Chip
                    key={s.label}
                    label={s.label}
                    variant="outlined"
                    onClick={() => setInput(s.prompt)}
                    sx={{
                      borderColor: alpha(theme.palette.primary.main, 0.2),
                      '&:hover': {
                        borderColor: alpha(theme.palette.primary.main, 0.5),
                        bgcolor: alpha(theme.palette.primary.main, 0.05),
                      },
                    }}
                  />
                ))}
              </Stack>
              {agents.length > 0 && (
                <Box sx={{ mt: 1, textAlign: 'center' }}>
                  <Typography variant="caption" color="text.disabled" sx={{ mb: 1, display: 'block' }}>
                    Available agents
                  </Typography>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" justifyContent="center">
                    {agents.map((a) => (
                      <Chip
                        key={a.id}
                        icon={<SmartToyIcon sx={{ fontSize: '14px !important' }} />}
                        label={a.name}
                        size="small"
                        variant={selectedAgent?.id === a.id ? 'filled' : 'outlined'}
                        color={selectedAgent?.id === a.id ? 'primary' : 'default'}
                        onClick={() => setSelectedAgent(selectedAgent?.id === a.id ? null : a)}
                        sx={{ fontSize: 12 }}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
            </Box>
          ) : (
            /* ── Message list ─────────────────────────────────── */
            <Box sx={{ maxWidth: 800, width: '100%', mx: 'auto', py: 3, px: { xs: 0, md: 3 } }}>
              {messages.map((msg, idx) => {
                const isUser = msg.role === 'user';

                // Skip rendering AI placeholder messages with no content yet
                // (the typing indicator below handles the visual for this state)
                if (!isUser && !msg.content && (!msg.attachments || msg.attachments.length === 0)) return null;

                const showAvatar = idx === 0 || messages[idx - 1].role !== msg.role;

                return (
                  <Fade in key={msg.id} timeout={300}>
                    <Box sx={{
                      display: 'flex', gap: 1.5, mb: showAvatar ? 2 : 0.5,
                      mt: showAvatar && idx > 0 ? 2.5 : 0,
                      flexDirection: isUser ? 'row-reverse' : 'row',
                      alignItems: 'flex-start',
                    }}>
                      {/* Avatar */}
                      {showAvatar ? (
                        <Avatar sx={{
                          width: 30, height: 30, mt: 0.5,
                          bgcolor: isUser ? 'secondary.main' : alpha(theme.palette.primary.main, 0.15),
                          color: isUser ? 'secondary.contrastText' : 'primary.main',
                          fontSize: 14,
                        }}>
                          {isUser ? <PersonIcon sx={{ fontSize: 16 }} /> : <SmartToyIcon sx={{ fontSize: 16 }} />}
                        </Avatar>
                      ) : (
                        <Box sx={{ width: 30, flexShrink: 0 }} />
                      )}

                      {/* Message bubble */}
                      <Box sx={{ maxWidth: '75%', minWidth: 0 }}>
                        {/* Agent name + time */}
                        {showAvatar && (
                          <Box sx={{
                            display: 'flex', alignItems: 'center', gap: 1, mb: 0.5,
                            flexDirection: isUser ? 'row-reverse' : 'row',
                          }}>
                            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 12 }}>
                              {isUser ? 'You' : msg.agentName || 'AI Engine'}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 11 }}>
                              {formatTime(msg.timestamp)}
                            </Typography>
                          </Box>
                        )}
                        <Paper
                          elevation={0}
                          sx={{
                            px: 2, py: 1.5,
                            borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                            bgcolor: isUser
                              ? alpha(theme.palette.primary.main, 0.12)
                              : alpha(theme.palette.background.paper, 0.5),
                            border: '1px solid',
                            borderColor: isUser
                              ? alpha(theme.palette.primary.main, 0.15)
                              : alpha(theme.palette.divider, 0.5),
                          }}
                        >
                          {isUser ? (
                            <Box>
                              {/* User attachments (images, videos, files) */}
                              {msg.attachments && msg.attachments.length > 0 && (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: msg.content ? 1 : 0 }}>
                                  {msg.attachments.filter(a => a.type.startsWith('image/')).map((att) => (
                                    <Box
                                      key={att.id}
                                      component="img"
                                      src={att.url}
                                      alt={att.name}
                                      sx={{ maxWidth: 200, maxHeight: 150, borderRadius: 1.5, objectFit: 'cover' }}
                                    />
                                  ))}
                                  {msg.attachments.filter(a => a.type.startsWith('video/')).map((att) => (
                                    <Box
                                      key={att.id}
                                      component="video"
                                      src={att.url}
                                      controls
                                      preload="metadata"
                                      sx={{ maxWidth: 250, maxHeight: 180, borderRadius: 1.5, bgcolor: 'black' }}
                                    />
                                  ))}
                                  {msg.attachments.filter(a => !a.type.startsWith('image/') && !a.type.startsWith('video/')).map((att) => (
                                    <Chip
                                      key={att.id}
                                      icon={<InsertDriveFileIcon />}
                                      label={att.name}
                                      size="small"
                                      variant="outlined"
                                      sx={{ maxWidth: 200 }}
                                    />
                                  ))}
                                </Box>
                              )}
                              {msg.content && (
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                                  {msg.content}
                                </Typography>
                              )}
                            </Box>
                          ) : (
                            <MessageContent content={msg.content} attachments={msg.attachments} />
                          )}
                        </Paper>
                      </Box>
                    </Box>
                  </Fade>
                );
              })}

              {/* Typing indicator — only show when AI message is still empty (queued/processing) */}
              {sending && messages.length > 0 && messages[messages.length - 1].role === 'ai' && !messages[messages.length - 1].content && (
                <Box sx={{ display: 'flex', gap: 1.5, mt: 2, alignItems: 'flex-start' }}>
                  <Avatar sx={{
                    width: 30, height: 30,
                    bgcolor: alpha(theme.palette.primary.main, 0.15),
                    color: 'primary.main',
                  }}>
                    <SmartToyIcon sx={{ fontSize: 16 }} />
                  </Avatar>
                  <Paper elevation={0} sx={{
                    px: 2, py: 1.25, borderRadius: '16px 16px 16px 4px',
                    bgcolor: alpha(theme.palette.background.paper, 0.5),
                    border: '1px solid', borderColor: alpha(theme.palette.divider, 0.5),
                  }}>
                    <TypingIndicator />
                  </Paper>
                </Box>
              )}
            </Box>
          )}
        </Box>

        {/* ── Input area ──────────────────────────────────────────── */}
        <Box sx={{ px: { xs: 2, md: 3 }, pb: 2, pt: 1 }}>
          <Box sx={{ maxWidth: 800, mx: 'auto' }}>
            {/* Selected agent chip */}
            {selectedAgent && (
              <Box sx={{ mb: 1, display: 'flex', alignItems: 'center' }}>
                <Chip
                  icon={<SmartToyIcon sx={{ fontSize: '14px !important' }} />}
                  label={selectedAgent.name}
                  size="small"
                  color="primary"
                  variant="outlined"
                  onDelete={() => setSelectedAgent(null)}
                  deleteIcon={<CloseIcon sx={{ fontSize: 14 }} />}
                  sx={{ fontSize: 12, height: 26 }}
                />
                <Typography variant="caption" sx={{ ml: 1, color: 'text.disabled' }}>
                  will respond to this conversation
                </Typography>
              </Box>
            )}

            <Paper
              elevation={0}
              onPaste={handlePaste}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              sx={{
                display: 'flex', flexDirection: 'column',
                p: 0.75,
                borderRadius: 3,
                border: '2px solid',
                borderColor: isDragOver
                  ? alpha(theme.palette.primary.main, 0.6)
                  : alpha(theme.palette.divider, 1),
                borderStyle: isDragOver ? 'dashed' : 'solid',
                bgcolor: isDragOver
                  ? alpha(theme.palette.primary.main, 0.04)
                  : alpha(theme.palette.background.paper, 0.6),
                transition: 'border-color 0.2s, background-color 0.2s',
                '&:focus-within': {
                  borderColor: isDragOver
                    ? alpha(theme.palette.primary.main, 0.6)
                    : alpha(theme.palette.primary.main, 0.4),
                },
              }}
            >
              {/* Attachment previews */}
              {attachments.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, px: 0.75, pt: 0.5, pb: 0.75 }}>
                  {attachments.map((att) => (
                    <Box
                      key={att.id}
                      sx={{
                        position: 'relative',
                        display: 'inline-flex',
                        borderRadius: 1.5,
                        overflow: 'hidden',
                        border: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      {att.type.startsWith('image/') ? (
                        <Box
                          component="img"
                          src={att.url}
                          alt={att.name}
                          sx={{ width: 64, height: 64, objectFit: 'cover' }}
                        />
                      ) : (
                        <Box sx={{
                          width: 64, height: 64,
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center',
                          bgcolor: alpha(theme.palette.primary.main, 0.06),
                          px: 0.5,
                        }}>
                          <InsertDriveFileIcon sx={{ fontSize: 20, color: 'text.secondary', mb: 0.25 }} />
                          <Typography variant="caption" sx={{
                            fontSize: 8, maxWidth: 56,
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap', textAlign: 'center',
                          }}>
                            {att.name}
                          </Typography>
                        </Box>
                      )}
                      <IconButton
                        size="small"
                        onClick={() => removeAttachment(att.id)}
                        sx={{
                          position: 'absolute', top: 1, right: 1,
                          bgcolor: 'rgba(0,0,0,0.6)', color: 'white',
                          width: 18, height: 18,
                          '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' },
                        }}
                      >
                        <CloseIcon sx={{ fontSize: 12 }} />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}

              <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5 }}>
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES}
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />

                {/* Attach file button */}
                <Tooltip title="Attach files or images">
                  <IconButton
                    size="small"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending}
                    sx={{
                      mb: 0.25,
                      color: 'text.disabled',
                      '&:hover': { color: 'primary.main' },
                    }}
                  >
                    <AttachFileIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>

                {/* @ mention button */}
                <Tooltip title="Tag an agent">
                  <IconButton
                    size="small"
                    onClick={handleMentionOpen}
                    sx={{
                      mb: 0.25,
                      color: selectedAgent ? 'primary.main' : 'text.disabled',
                      '&:hover': { color: 'primary.main' },
                    }}
                  >
                    <AlternateEmailIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>

                <TextField
                  inputRef={inputRef}
                  fullWidth
                  placeholder={selectedAgent ? `Message ${selectedAgent.name}...` : 'Message AI Engine...'}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  multiline
                  maxRows={6}
                  disabled={sending}
                  variant="standard"
                  InputProps={{
                    disableUnderline: true,
                    sx: {
                      fontSize: 14, py: 0.75, px: 0.5,
                      '& textarea': { lineHeight: 1.6 },
                    },
                  }}
                />

                <IconButton
                  onClick={handleSend}
                  disabled={(!input.trim() && attachments.length === 0) || sending}
                  sx={{
                    mb: 0.25,
                    bgcolor: (input.trim() || attachments.length > 0) && !sending
                      ? 'primary.main'
                      : 'transparent',
                    color: (input.trim() || attachments.length > 0) && !sending
                      ? 'primary.contrastText'
                      : 'text.disabled',
                    width: 32, height: 32,
                    '&:hover': {
                      bgcolor: (input.trim() || attachments.length > 0) ? 'primary.dark' : 'transparent',
                    },
                    '&.Mui-disabled': {
                      color: 'text.disabled',
                    },
                  }}
                >
                  <SendIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            </Paper>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mt: 1, position: 'relative' }}>
              <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 11 }}>
                AI Engine may make mistakes. Verify important information.
              </Typography>
              {/* Context usage ring — bottom right */}
              <Box sx={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}>
                <ContextIndicator tokens={contextTokens} maxTokens={CONTEXT_WINDOW_LIMIT} />
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* ── Agent mention popover ───────────────────────────────────── */}
      <Popover
        open={Boolean(mentionAnchor)}
        anchorEl={mentionAnchor}
        onClose={handleMentionClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: -1, minWidth: 220, maxHeight: 300,
              borderRadius: 2, border: '1px solid', borderColor: 'divider',
              bgcolor: 'background.paper',
            },
          },
        }}
      >
        <Box sx={{ p: 1 }}>
          <Typography variant="caption" sx={{ px: 1, py: 0.5, display: 'block', color: 'text.disabled', fontWeight: 600 }}>
            Select an agent
          </Typography>
          <MenuItem
            onClick={() => handleAgentSelect(null)}
            selected={!selectedAgent}
            sx={{ borderRadius: 1, fontSize: 13, py: 0.75, minHeight: 0 }}
          >
            <ListItemIcon sx={{ minWidth: 28 }}>
              <AutoAwesomeIcon sx={{ fontSize: 16 }} />
            </ListItemIcon>
            <Typography variant="body2" sx={{ fontSize: 13 }}>Default AI</Typography>
          </MenuItem>
          {(mentionQuery ? filteredAgents : agents).map((agent) => (
            <MenuItem
              key={agent.id}
              onClick={() => mentionAnchor === inputRef.current ? handleMentionSelect(agent) : handleAgentSelect(agent)}
              selected={selectedAgent?.id === agent.id}
              sx={{ borderRadius: 1, fontSize: 13, py: 0.75, minHeight: 0 }}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                <SmartToyIcon sx={{ fontSize: 16 }} />
              </ListItemIcon>
              <Typography variant="body2" sx={{ fontSize: 13 }}>{agent.name}</Typography>
            </MenuItem>
          ))}
          {agents.length === 0 && (
            <Typography variant="caption" sx={{ px: 1, py: 1, display: 'block', color: 'text.disabled' }}>
              No agents created yet. Create one in the Agents page.
            </Typography>
          )}
        </Box>
      </Popover>

      {/* ── Snackbar ──────────────────────────────────────────────── */}
      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
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
