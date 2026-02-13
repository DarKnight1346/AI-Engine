'use client';

import { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import {
  Box, TextField, IconButton, Typography, Paper, List, ListItemButton,
  ListItemText, Divider, Avatar, Chip, InputAdornment, Stack,
  CircularProgress, Tooltip, Snackbar, Alert, Popover, MenuItem,
  ListItemIcon, Fade, alpha, useTheme, Badge,
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
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

/* ─── Types ─────────────────────────────────────────────────────────── */

interface Attachment {
  id: string;
  name: string;
  type: string;      // MIME type
  url: string;       // data URL for preview, or uploaded URL
  size: number;
}

interface BackgroundTaskInfo {
  id: string;
  sessionId: string;
  toolName: string;
  description: string;
  status: 'running' | 'completed' | 'failed';
  result?: { success: boolean; output: string; data?: Record<string, unknown> };
  messageId?: string;
  agentName?: string;
  startedAt: string;
  completedAt?: string;
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
  // Regex for bold, italic, inline code, markdown links, and bare URLs
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)<>\]]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          const inner = part.slice(2, -2);
          // If the bold content is a URL, render as a link instead of just bold text
          if (/^https?:\/\//.test(inner)) {
            const cleaned = cleanUrl(inner);
            return <a key={i} href={cleaned} target="_blank" rel="noopener noreferrer" style={{ color: '#90caf9', fontWeight: 700, wordBreak: 'break-all' }}>{cleaned}</a>;
          }
          return <strong key={i}><FormattedText text={inner} /></strong>;
        }
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
        if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
          const inner = part.slice(1, -1);
          // If the italic content is a URL, render as a link
          if (/^https?:\/\//.test(inner)) {
            const cleaned = cleanUrl(inner);
            return <a key={i} href={cleaned} target="_blank" rel="noopener noreferrer" style={{ color: '#90caf9', fontStyle: 'italic', wordBreak: 'break-all' }}>{cleaned}</a>;
          }
          return <em key={i}><FormattedText text={inner} /></em>;
        }
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch)
          return <a key={i} href={cleanUrl(linkMatch[2])} target="_blank" rel="noopener noreferrer" style={{ color: '#90caf9' }}>{linkMatch[1]}</a>;
        // Bare URLs → clickable link opening in new tab
        if (/^https?:\/\//.test(part)) {
          const cleaned = cleanUrl(part);
          return <a key={i} href={cleaned} target="_blank" rel="noopener noreferrer" style={{ color: '#90caf9', wordBreak: 'break-all' }}>{cleaned}</a>;
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

/** Strip common trailing punctuation that regex might capture at end of URLs */
function cleanUrl(url: string): string {
  return url.replace(/[.,;:!?'")\]]+$/, '');
}

/** Detect image URLs in text (common extensions + known image hosting) */
function isImageUrl(url: string): boolean {
  const lower = cleanUrl(url).toLowerCase();
  // Direct image file extensions
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|tiff|avif)(\?|#|$)/i.test(lower)) return true;
  // Known image CDNs / hosting services
  if (/images\.x\.ai|imgen\.x\.ai|cdn\.x\.ai/i.test(lower)) return true;
  if (/images\.unsplash\.com/i.test(lower)) return true;
  if (/\.pexels\.com\/photo\//i.test(lower)) return true;
  if (/\.imgur\.com\//i.test(lower)) return true;
  if (/upload\.wikimedia\.org/i.test(lower)) return true;
  if (/\.googleusercontent\.com/i.test(lower)) return true;
  if (/\.pinimg\.com/i.test(lower)) return true;
  if (/\.freepik\.com.*\.(jpg|png|jpeg)/i.test(lower)) return true;
  if (/\.vecteezy\.com.*\.(jpg|png|jpeg)/i.test(lower)) return true;
  if (/\.hearstapps\.com.*\.(jpg|png|jpeg)/i.test(lower)) return true;
  if (/\.pethelpful\.com\/.image\//i.test(lower)) return true;
  return false;
}

/** Detect embeddable video file URLs (direct .mp4/.webm, not YouTube page links) */
function isVideoUrl(url: string): boolean {
  const lower = cleanUrl(url).toLowerCase();
  if (/\.(mp4|webm|mov|ogg)(\?|#|$)/i.test(lower)) return true;
  if (/vidgen\.x\.ai/i.test(lower)) return true;
  return false;
}

/** Match any URL in text — NOTE: intentionally no `g` flag at module scope; clone with `g` at call site */
const URL_PATTERN = /https?:\/\/[^\s)<>\]]+/;

/** Find all URLs in a string */
function findAllUrls(text: string): string[] {
  const regex = new RegExp(URL_PATTERN.source, 'g');
  const matches = text.match(regex) ?? [];
  return matches.map(cleanUrl);
}

/** Split text around URLs */
function splitAroundUrls(text: string): { parts: string[]; urls: string[] } {
  const regex = new RegExp(URL_PATTERN.source, 'g');
  const parts = text.split(regex);
  const rawUrls = text.match(regex) ?? [];
  return { parts, urls: rawUrls.map(cleanUrl) };
}

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

/* ─── Report Section State ──────────────────────────────────────────── */

interface ReportSectionState {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  content?: string;
  tier?: string;
}

interface ReportState {
  title: string;
  sections: ReportSectionState[];
  completed: number;
  total: number;
}

/* ─── SubtaskTracker ───────────────────────────────────────────────── */

function SubtaskTracker({ report }: { report: ReportState }) {
  const theme = useTheme();
  const progress = report.total > 0 ? (report.completed / report.total) * 100 : 0;
  const [expanded, setExpanded] = useState(true);

  const tierColors: Record<string, string> = {
    fast: '#66bb6a',
    standard: '#42a5f5',
    heavy: '#ab47bc',
  };

  return (
    <Box sx={{ mb: 2 }}>
      {/* Progress bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}>
        <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: alpha(theme.palette.common.white, 0.1), overflow: 'hidden' }}>
          <Box sx={{
            height: '100%', borderRadius: 3,
            background: `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
            width: `${progress}%`,
            transition: 'width 0.5s ease-out',
          }} />
        </Box>
        <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
          {report.completed}/{report.total} sections
        </Typography>
      </Box>

      {/* Expandable task list */}
      {expanded && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
          {report.sections.map((s) => {
            const statusIcon = s.status === 'complete' ? '\u2713'
              : s.status === 'failed' ? '\u2717'
              : s.status === 'running' ? '\u25CB'
              : '\u2022';
            const statusColor = s.status === 'complete' ? '#66bb6a'
              : s.status === 'failed' ? '#ef5350'
              : s.status === 'running' ? '#42a5f5'
              : 'text.disabled';
            return (
              <Chip
                key={s.id}
                size="small"
                label={`${statusIcon} ${s.title}`}
                sx={{
                  fontSize: '0.7rem',
                  height: 22,
                  color: statusColor,
                  borderColor: alpha(statusColor as string, 0.3),
                  bgcolor: alpha(statusColor as string, 0.08),
                  border: '1px solid',
                  '& .MuiChip-label': { px: 1 },
                }}
              />
            );
          })}
        </Box>
      )}
    </Box>
  );
}

/* ─── DynamicReport ────────────────────────────────────────────────── */

function DynamicReport({ report }: { report: ReportState }) {
  const theme = useTheme();

  return (
    <Box sx={{ mb: 2 }}>
      {/* Report header */}
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1, color: 'primary.main' }}>
        {report.title}
      </Typography>

      {/* Progress tracker */}
      <SubtaskTracker report={report} />

      {/* Sections */}
      {report.sections.map((section) => (
        <Box key={section.id} sx={{
          mb: 1.5,
          borderRadius: 2,
          border: '1px solid',
          borderColor: section.status === 'complete' ? alpha(theme.palette.success.main, 0.2)
            : section.status === 'failed' ? alpha(theme.palette.error.main, 0.2)
            : section.status === 'running' ? alpha(theme.palette.info.main, 0.2)
            : 'divider',
          overflow: 'hidden',
        }}>
          {/* Section header */}
          <Box sx={{
            px: 2, py: 1,
            bgcolor: section.status === 'running' ? alpha(theme.palette.info.main, 0.05)
              : section.status === 'complete' ? alpha(theme.palette.success.main, 0.03)
              : 'transparent',
            borderBottom: section.content ? '1px solid' : 'none',
            borderColor: 'divider',
            display: 'flex', alignItems: 'center', gap: 1,
          }}>
            {section.status === 'running' && (
              <CircularProgress size={14} thickness={5} sx={{ color: 'info.main' }} />
            )}
            {section.status === 'complete' && (
              <Typography sx={{ color: 'success.main', fontSize: 14, fontWeight: 700 }}>{'\u2713'}</Typography>
            )}
            {section.status === 'failed' && (
              <Typography sx={{ color: 'error.main', fontSize: 14, fontWeight: 700 }}>{'\u2717'}</Typography>
            )}
            {section.status === 'pending' && (
              <Typography sx={{ color: 'text.disabled', fontSize: 14 }}>{'\u2022'}</Typography>
            )}
            <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
              {section.title}
            </Typography>
            {section.tier && (
              <Chip size="small" label={section.tier}
                sx={{
                  fontSize: '0.6rem', height: 18,
                  bgcolor: alpha(section.tier === 'fast' ? '#66bb6a' : section.tier === 'heavy' ? '#ab47bc' : '#42a5f5', 0.1),
                  color: section.tier === 'fast' ? '#66bb6a' : section.tier === 'heavy' ? '#ab47bc' : '#42a5f5',
                }} />
            )}
          </Box>

          {/* Section content */}
          {section.status === 'running' && !section.content && (
            <Box sx={{ px: 2, py: 2 }}>
              {/* Skeleton shimmer */}
              {[80, 60, 90, 45].map((w, i) => (
                <Box key={i} sx={{
                  height: 12, mb: 1, borderRadius: 1,
                  width: `${w}%`,
                  bgcolor: alpha(theme.palette.common.white, 0.05),
                  animation: 'pulse 1.5s ease-in-out infinite',
                  '@keyframes pulse': {
                    '0%, 100%': { opacity: 0.4 },
                    '50%': { opacity: 0.8 },
                  },
                }} />
              ))}
            </Box>
          )}
          {section.content && (
            <Box sx={{ px: 2, py: 1.5 }}>
              <FormattedText text={section.content} />
            </Box>
          )}
          {section.status === 'failed' && !section.content && (
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography variant="body2" sx={{ color: 'error.main', fontStyle: 'italic' }}>
                This section failed to complete. The orchestrator will synthesize available results.
              </Typography>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

/* ─── ClarificationPanel ───────────────────────────────────────────── */

interface ClarificationState {
  questions: Array<{
    id: string;
    prompt: string;
    options?: Array<{ id: string; label: string }>;
    allowFreeText?: boolean;
  }>;
  answers: Record<string, string>;
  submitted: boolean;
}

function ClarificationPanel({
  state,
  sessionId,
  onSubmitted,
}: {
  state: ClarificationState;
  sessionId: string;
  onSubmitted: () => void;
}) {
  const theme = useTheme();
  const [answers, setAnswers] = useState<Record<string, string>>(state.answers);
  const [submitting, setSubmitting] = useState(false);

  if (state.submitted) return null;

  const setAnswer = (qId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [qId]: value }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await fetch('/api/chat/clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, answers }),
      });
      onSubmitted();
    } catch (err) {
      console.error('[ClarificationPanel] Submit failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{
      my: 2, p: 2, borderRadius: 2,
      border: '1px solid',
      borderColor: alpha(theme.palette.primary.main, 0.3),
      bgcolor: alpha(theme.palette.primary.main, 0.03),
    }}>
      <Typography variant="subtitle2" sx={{ mb: 2, color: 'primary.main', fontWeight: 700 }}>
        Before I proceed, I need a few details:
      </Typography>

      {state.questions.map((q) => (
        <Box key={q.id} sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
            {q.prompt}
          </Typography>

          {/* Option buttons */}
          {q.options && q.options.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: q.allowFreeText ? 1 : 0 }}>
              {q.options.map((opt) => (
                <Chip
                  key={opt.id}
                  label={opt.label}
                  clickable
                  onClick={() => setAnswer(q.id, opt.label)}
                  sx={{
                    borderRadius: '16px',
                    border: '1px solid',
                    borderColor: answers[q.id] === opt.label
                      ? 'primary.main'
                      : alpha(theme.palette.common.white, 0.15),
                    bgcolor: answers[q.id] === opt.label
                      ? alpha(theme.palette.primary.main, 0.15)
                      : 'transparent',
                    color: answers[q.id] === opt.label ? 'primary.main' : 'text.secondary',
                    fontWeight: answers[q.id] === opt.label ? 600 : 400,
                    fontSize: '0.8rem',
                    transition: 'all 0.2s',
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, 0.1),
                      borderColor: 'primary.main',
                    },
                  }}
                />
              ))}
            </Box>
          )}

          {/* Free text input */}
          {(q.allowFreeText || !q.options || q.options.length === 0) && (
            <TextField
              size="small"
              fullWidth
              placeholder="Type your answer..."
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              sx={{
                '& .MuiOutlinedInput-root': {
                  fontSize: '0.85rem',
                  bgcolor: alpha(theme.palette.common.white, 0.03),
                },
              }}
            />
          )}
        </Box>
      ))}

      <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
        <Chip
          label={submitting ? 'Submitting...' : 'Submit Answers'}
          clickable={!submitting}
          onClick={handleSubmit}
          disabled={submitting}
          sx={{
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            fontWeight: 600,
            '&:hover': { bgcolor: 'primary.dark' },
          }}
        />
        <Chip
          label="Skip"
          clickable={!submitting}
          onClick={() => {
            setAnswers({});
            handleSubmit();
          }}
          variant="outlined"
          sx={{ color: 'text.secondary', borderColor: alpha(theme.palette.common.white, 0.15) }}
        />
      </Box>
    </Box>
  );
}

/**
 * Image Gallery — responsive masonry-style grid for 2+ images.
 * Features: responsive columns, hover overlay with download, lightbox with
 * keyboard nav (arrow keys, ESC), download-all button, image counter.
 */
function ImageGallery({ urls }: { urls: string[] }) {
  const theme = useTheme();
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  // Keyboard navigation in lightbox
  useEffect(() => {
    if (lightboxIdx === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIdx(null);
      if (e.key === 'ArrowRight') setLightboxIdx((i) => (i !== null ? Math.min(i + 1, urls.length - 1) : null));
      if (e.key === 'ArrowLeft') setLightboxIdx((i) => (i !== null ? Math.max(i - 1, 0) : null));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxIdx, urls.length]);

  // Responsive column count based on image count
  const cols = urls.length <= 2 ? 2 : urls.length <= 4 ? 2 : urls.length <= 9 ? 3 : 4;

  return (
    <>
      <Box sx={{ my: 1.5 }}>
        {/* Header row */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>
            {urls.length} image{urls.length !== 1 ? 's' : ''}
          </Typography>
          <Tooltip title="Download all images">
            <IconButton
              size="small"
              onClick={() => urls.forEach((u, i) => setTimeout(() => downloadUrl(u, `image-${i + 1}.png`), i * 200))}
              sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
            >
              <DownloadIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Image grid */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 0.75,
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          {urls.map((url, i) => (
            <Box
              key={i}
              onClick={() => setLightboxIdx(i)}
              sx={{
                position: 'relative',
                aspectRatio: '1 / 1',
                cursor: 'pointer',
                overflow: 'hidden',
                bgcolor: alpha(theme.palette.background.paper, 0.3),
                '&:hover': {
                  '& img': { transform: 'scale(1.05)' },
                  '& .gallery-overlay': { opacity: 1 },
                },
              }}
            >
              <Box
                component="img"
                src={url}
                alt={`Image ${i + 1}`}
                loading="lazy"
                sx={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transition: 'transform 0.25s ease',
                }}
              />
              <Box
                className="gallery-overlay"
                sx={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(transparent 60%, rgba(0,0,0,0.5))',
                  opacity: 0,
                  transition: 'opacity 0.2s',
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'flex-end',
                  p: 0.75,
                }}
              >
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); downloadUrl(url, `image-${i + 1}.png`); }}
                  sx={{
                    bgcolor: 'rgba(0,0,0,0.6)', color: 'white',
                    backdropFilter: 'blur(4px)',
                    width: 28, height: 28,
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.85)' },
                  }}
                >
                  <DownloadIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Lightbox overlay */}
      {lightboxIdx !== null && (
        <Box
          onClick={() => setLightboxIdx(null)}
          sx={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            bgcolor: 'rgba(0,0,0,0.9)', zIndex: 9999,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          <Box
            component="img"
            src={urls[lightboxIdx]}
            alt={`Image ${lightboxIdx + 1}`}
            sx={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: 2, objectFit: 'contain' }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          />
          <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton
              disabled={lightboxIdx <= 0}
              onClick={(e) => { e.stopPropagation(); setLightboxIdx((i) => Math.max((i ?? 1) - 1, 0)); }}
              sx={{ color: 'white', '&.Mui-disabled': { color: 'rgba(255,255,255,0.2)' } }}
            >
              <Typography sx={{ fontSize: 20 }}>&larr;</Typography>
            </IconButton>
            <Typography sx={{ color: 'white', fontSize: 13, minWidth: 60, textAlign: 'center' }}>
              {lightboxIdx + 1} / {urls.length}
            </Typography>
            <IconButton
              disabled={lightboxIdx >= urls.length - 1}
              onClick={(e) => { e.stopPropagation(); setLightboxIdx((i) => Math.min((i ?? 0) + 1, urls.length - 1)); }}
              sx={{ color: 'white', '&.Mui-disabled': { color: 'rgba(255,255,255,0.2)' } }}
            >
              <Typography sx={{ fontSize: 20 }}>&rarr;</Typography>
            </IconButton>
            <IconButton
              onClick={(e) => { e.stopPropagation(); downloadUrl(urls[lightboxIdx], `image-${lightboxIdx + 1}.png`); }}
              sx={{ color: 'white', bgcolor: 'rgba(255,255,255,0.1)', ml: 1, '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}
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

function VideoGallery({ urls }: { urls: string[] }) {
  const cols = urls.length <= 2 ? 1 : 2;

  return (
    <Box sx={{ my: 1.5 }}>
      {/* Header row */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>
          {urls.length} video{urls.length !== 1 ? 's' : ''}
        </Typography>
        <Tooltip title="Download all videos">
          <IconButton
            size="small"
            onClick={() => urls.forEach((u, i) => setTimeout(() => downloadUrl(u, `video-${i + 1}.mp4`), i * 300))}
            sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
          >
            <DownloadIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Video grid */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 1,
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        {urls.map((url, i) => (
          <Box key={i} sx={{ position: 'relative', '&:hover .media-actions': { opacity: 1 } }}>
            <Box
              component="video"
              src={url}
              controls
              preload="metadata"
              sx={{
                width: '100%',
                maxHeight: 360,
                borderRadius: 1.5,
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
              <Tooltip title={`Download video ${i + 1}`}>
                <IconButton
                  size="small"
                  onClick={() => downloadUrl(url, `video-${i + 1}.mp4`)}
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
        ))}
      </Box>
    </Box>
  );
}

/** Video card from search results */
interface VideoCard {
  title: string;
  link: string;
  imageUrl: string;
  duration: string;
  channel: string;
}

/** Extract YouTube video ID from a URL */
function getYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** Check if a URL is a known video platform page (not a direct .mp4 file) */
function isVideoPageUrl(url: string): boolean {
  const lower = cleanUrl(url).toLowerCase();
  // Known video platforms
  if (/youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\//i.test(lower)) return true;
  if (/vimeo\.com\/\d+/i.test(lower)) return true;
  if (/dailymotion\.com\/video\//i.test(lower)) return true;
  if (/tiktok\.com\/@[^/]+\/video\//i.test(lower)) return true;
  if (/facebook\.com\/.*\/videos\//i.test(lower)) return true;
  if (/fb\.watch\//i.test(lower)) return true;
  if (/twitter\.com\/.*\/status\/|x\.com\/.*\/status\//i.test(lower)) return true;
  if (/twitch\.tv\//i.test(lower)) return true;
  if (/rumble\.com\/v/i.test(lower)) return true;
  if (/bitchute\.com\/video\//i.test(lower)) return true;
  if (/odysee\.com\/@/i.test(lower)) return true;
  if (/instagram\.com\/(reel|p)\//i.test(lower)) return true;
  if (/reddit\.com\/.*\/comments\//i.test(lower)) return true;
  if (/bilibili\.com\/video\//i.test(lower)) return true;
  return false;
}

/** Get a thumbnail URL for a video page URL (best-effort) */
function getVideoThumbnail(url: string): string {
  const ytId = getYouTubeId(url);
  if (ytId) return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
  // Vimeo thumbnails require an API call — no easy static URL
  // Other platforms: no reliable static thumbnail URL
  return '';
}

/** Parse <!--VIDEO_RESULTS-->...<!--/VIDEO_RESULTS--> blocks from content */
function extractVideoCards(text: string): { cards: VideoCard[]; cleaned: string } {
  const regex = /<!--VIDEO_RESULTS-->([\s\S]*?)<!--\/VIDEO_RESULTS-->/g;
  const allCards: VideoCard[] = [];
  const cleaned = text.replace(regex, (_match, json: string) => {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) allCards.push(...parsed);
    } catch { /* skip malformed */ }
    return '';
  });
  return { cards: allCards, cleaned };
}

/**
 * Auto-detect video listings in text and build VideoCards.
 * Works for ANY video platform — uses context clues (duration patterns,
 * markdown links in numbered lists, known video domains) rather than
 * only matching specific platforms.
 */
function autoDetectVideoCards(text: string): VideoCard[] {
  const cards: VideoCard[] = [];
  const seen = new Set<string>();

  // ── Strategy 1: Markdown links with known video platform URLs ──
  const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  while ((match = mdLinkRegex.exec(text)) !== null) {
    const title = match[1];
    const url = cleanUrl(match[2]);
    if (isVideoPageUrl(url) && !seen.has(url)) {
      seen.add(url);
      cards.push({ title, link: url, imageUrl: getVideoThumbnail(url), duration: '', channel: '' });
    }
  }

  // ── Strategy 2: Markdown links that have a duration nearby ──
  // This catches ANY platform. Pattern: [Title](url) ... (MM:SS)
  // Re-run the regex (stateful — reset)
  const mdLinkRegex2 = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  while ((match = mdLinkRegex2.exec(text)) !== null) {
    const title = match[1];
    const url = cleanUrl(match[2]);
    if (seen.has(url)) continue;
    // Check if there's a duration within ~60 chars after the link
    const afterLink = text.slice(match.index + match[0].length, match.index + match[0].length + 60);
    const durationNearby = afterLink.match(/\(?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\)?/);
    if (durationNearby) {
      seen.add(url);
      cards.push({ title, link: url, imageUrl: getVideoThumbnail(url), duration: durationNearby[1], channel: '' });
    }
  }

  // ── Strategy 3: Numbered list items with URLs and durations ──
  // Catches patterns like: "1. Title https://example.com/video (10:32)"
  // or "1. Title (10:32) - Channel\n   https://example.com/video"
  const numberedLineRegex = /^\s*\d+[.)]\s+(.+)$/gm;
  while ((match = numberedLineRegex.exec(text)) !== null) {
    const lineContent = match[1];
    const lineUrls = findAllUrls(lineContent);
    const durationMatch = lineContent.match(/\(?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\)?/);
    for (const url of lineUrls) {
      if (seen.has(url) || isImageUrl(url) || isVideoUrl(url)) continue; // skip image/direct-video URLs
      if (durationMatch || isVideoPageUrl(url)) {
        seen.add(url);
        // Extract title: text before the URL
        const titlePart = lineContent.split(url)[0]
          .replace(/\[[^\]]*\]\([^)]*\)/g, '')  // remove markdown links
          .replace(/\(?\d{1,2}:\d{2}(?::\d{2})?\)?/g, '') // remove durations
          .replace(/[-–—]\s*$/, '')
          .trim();
        cards.push({
          title: titlePart || url,
          link: url,
          imageUrl: getVideoThumbnail(url),
          duration: durationMatch ? durationMatch[1] : '',
          channel: '',
        });
      }
    }
  }

  // ── Strategy 4: Bare known video platform URLs not already captured ──
  const allUrls = findAllUrls(text);
  for (const url of allUrls) {
    if (seen.has(url) || isImageUrl(url) || isVideoUrl(url)) continue;
    if (isVideoPageUrl(url)) {
      seen.add(url);
      cards.push({ title: '', link: url, imageUrl: getVideoThumbnail(url), duration: '', channel: '' });
    }
  }

  // ── Enrich: try to find channel/source info near each card's URL ──
  for (const card of cards) {
    if (!card.duration) {
      const escaped = card.link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const dm = text.match(new RegExp(escaped + '[^\\n]{0,30}\\(?(\\d{1,2}:\\d{2}(?::\\d{2})?)\\)?'));
      if (dm) card.duration = dm[1];
    }
    if (!card.channel) {
      // Look for italic text near the card's URL: _Channel Name_ - Description
      const escaped = card.link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const afterUrl = text.split(card.link)[1]?.slice(0, 200) ?? '';
      const channelMatch = afterUrl.match(/\n\s*_([^_]+)_/);
      if (channelMatch) card.channel = channelMatch[1].trim();
    }
  }

  return cards;
}

/**
 * Gallery for video SEARCH results — displays thumbnail cards for any
 * video platform. YouTube videos get inline embeds; others open in a new tab.
 */
function VideoSearchGallery({ cards }: { cards: VideoCard[] }) {
  const theme = useTheme();
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const cols = cards.length <= 2 ? 1 : cards.length <= 4 ? 2 : 3;

  /** Extract a short domain label from a URL */
  const getDomain = (url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  };

  return (
    <Box sx={{ my: 1.5 }}>
      {/* Header */}
      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11, mb: 1, display: 'block' }}>
        {cards.length} video{cards.length !== 1 ? 's' : ''} found
      </Typography>

      {/* Card grid */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 1.25,
      }}>
        {cards.map((card, i) => {
          const ytId = getYouTubeId(card.link);
          const isPlaying = playingIdx === i && ytId;
          const hasThumbnail = !!card.imageUrl;
          const domain = getDomain(card.link);

          return (
            <Box
              key={i}
              sx={{
                borderRadius: 2,
                overflow: 'hidden',
                bgcolor: alpha(theme.palette.background.paper, 0.5),
                border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                transition: 'border-color 0.2s, box-shadow 0.2s',
                '&:hover': {
                  borderColor: alpha(theme.palette.primary.main, 0.3),
                  boxShadow: `0 2px 12px ${alpha(theme.palette.common.black, 0.25)}`,
                },
              }}
            >
              {/* Thumbnail / Embed area */}
              <Box sx={{ position: 'relative', aspectRatio: '16 / 9', bgcolor: '#111' }}>
                {isPlaying && ytId ? (
                  <Box
                    component="iframe"
                    src={`https://www.youtube.com/embed/${ytId}?autoplay=1`}
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                    sx={{ width: '100%', height: '100%', border: 'none' }}
                  />
                ) : (
                  <>
                    {hasThumbnail ? (
                      <Box
                        component="img"
                        src={card.imageUrl}
                        alt={card.title}
                        loading="lazy"
                        sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      /* Gradient placeholder for videos without thumbnails */
                      <Box sx={{
                        width: '100%', height: '100%',
                        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.dark, 0.3)} 0%, ${alpha(theme.palette.secondary.dark, 0.2)} 100%)`,
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 0.5,
                      }}>
                        <PlayArrowIcon sx={{ color: alpha(theme.palette.common.white, 0.5), fontSize: 40 }} />
                        {domain && (
                          <Typography variant="caption" sx={{ color: alpha(theme.palette.common.white, 0.4), fontSize: 10 }}>
                            {domain}
                          </Typography>
                        )}
                      </Box>
                    )}
                    {/* Play overlay */}
                    <Box
                      onClick={() => ytId ? setPlayingIdx(i) : window.open(card.link, '_blank')}
                      sx={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer',
                        bgcolor: hasThumbnail ? 'rgba(0,0,0,0.15)' : 'transparent',
                        transition: 'background-color 0.2s',
                        '&:hover': { bgcolor: 'rgba(0,0,0,0.35)' },
                      }}
                    >
                      {hasThumbnail && (
                        <Box sx={{
                          width: 48, height: 48, borderRadius: '50%',
                          bgcolor: 'rgba(0,0,0,0.7)', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          backdropFilter: 'blur(4px)',
                        }}>
                          <PlayArrowIcon sx={{ color: 'white', fontSize: 28 }} />
                        </Box>
                      )}
                    </Box>
                    {/* Duration badge */}
                    {card.duration && (
                      <Typography
                        variant="caption"
                        sx={{
                          position: 'absolute', bottom: 6, right: 6,
                          bgcolor: 'rgba(0,0,0,0.8)', color: 'white',
                          px: 0.75, py: 0.15, borderRadius: 0.5,
                          fontSize: 10, fontWeight: 600,
                          fontFamily: '"JetBrains Mono", monospace',
                        }}
                      >
                        {card.duration}
                      </Typography>
                    )}
                  </>
                )}
              </Box>

              {/* Info row */}
              <Box sx={{ px: 1.25, py: 1 }}>
                <Typography
                  variant="body2"
                  component="a"
                  href={card.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    color: 'text.primary',
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: 12.5,
                    lineHeight: 1.3,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    '&:hover': { color: 'primary.main' },
                  }}
                >
                  {card.title || domain || 'Video'}
                </Typography>
                {(card.channel || domain) && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11, mt: 0.25, display: 'block' }}>
                    {card.channel || domain}
                  </Typography>
                )}
                {/* Open in new tab link */}
                <Box
                  component="a"
                  href={card.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.4,
                    color: 'text.secondary', fontSize: 10.5, mt: 0.5,
                    textDecoration: 'none',
                    '&:hover': { color: 'primary.main' },
                  }}
                >
                  <OpenInNewIcon sx={{ fontSize: 12 }} />
                  Open
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function MessageContent({ content, attachments }: { content: string; attachments?: Attachment[] }) {
  // ── Extract structured video search results ──
  // First try the <!--VIDEO_RESULTS--> marker blocks (if the LLM passed them through)
  let { cards: videoSearchCards, cleaned: contentAfterVideoExtract } = extractVideoCards(content);

  // Fallback: auto-detect video page URLs (YouTube, Vimeo) from the content
  if (videoSearchCards.length === 0) {
    const autoCards = autoDetectVideoCards(contentAfterVideoExtract);
    if (autoCards.length >= 2) {
      videoSearchCards = autoCards;
    }
  }

  // ── Collect all media URLs across the entire content for galleries ──
  // Strip markdown image/link syntax first, then find all media URLs.
  // Also handle bold/italic wrappers around markdown images: **![alt](url)** → url
  let processedContent = contentAfterVideoExtract
    .replace(/\*{1,2}!\[[^\]]*\]\((https?:\/\/[^)]+)\)\*{1,2}/g, '$1')  // **![alt](url)** or *![alt](url)*
    .replace(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g, '$1')                  // ![alt](url)
    .replace(/\[[^\]]*\]\((https?:\/\/[^)]+\.(?:mp4|webm|mov|ogg|png|jpg|jpeg|gif|webp|svg)(?:\?[^)]*)?)\)/gi, '$1')
    .replace(/\*{1,2}(https?:\/\/[^\s*]+)\*{1,2}/g, '$1');               // **url** or *url* → url

  const allUrls = findAllUrls(processedContent);
  const imageUrls = allUrls.filter((u) => isImageUrl(u));
  const videoUrls = allUrls.filter((u) => isVideoUrl(u));
  const useImageGallery = imageUrls.length >= 2;
  const useVideoGallery = videoUrls.length >= 2;

  // If showing an image gallery, strip image URLs from the text
  if (useImageGallery) {
    for (const imgUrl of imageUrls) {
      processedContent = processedContent.split(imgUrl).join('');
    }
  }

  // If showing a video gallery (direct files), strip video URLs from the text
  if (useVideoGallery) {
    for (const vidUrl of videoUrls) {
      processedContent = processedContent.split(vidUrl).join('');
    }
  }

  // If showing a video search gallery, strip the video listing from the text
  // since the VideoSearchGallery component replaces it visually.
  if (videoSearchCards.length > 0) {
    for (const card of videoSearchCards) {
      // Strip markdown links: [Title](url)
      if (card.link && card.title) {
        const escapedUrl = card.link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedTitle = card.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Remove [Title](url) pattern
        processedContent = processedContent.replace(
          new RegExp(`\\[${escapedTitle}\\]\\(${escapedUrl}\\)`, 'g'), ''
        );
      }
      // Strip bare URLs
      if (card.link) processedContent = processedContent.split(card.link).join('');
      // Strip lines that are just the card title/metadata
      if (card.title) {
        const escapedTitle = card.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        processedContent = processedContent.replace(
          new RegExp(`^\\s*\\d+[.)\\s]+${escapedTitle}.*$`, 'gm'), ''
        );
      }
    }
    // Strip any remaining empty markdown link remnants like []() 
    processedContent = processedContent.replace(/\[\s*\]\(\s*\)/g, '');
  }

  // Clean up straggling list markers and near-empty lines left behind
  if (useImageGallery || useVideoGallery || videoSearchCards.length > 0) {
    processedContent = processedContent
      .replace(/^\s*\d+[.)]\s*[-–—]?\s*$/gm, '')     // empty numbered list items
      .replace(/^\s*\d+[.)]\s*\([^)]*\)\s*$/gm, '')   // numbered items that are just (duration)
      .replace(/^\s*[-*]\s*$/gm, '')                    // empty bullet items
      .replace(/^\s*\(\d{1,2}:\d{2}(?::\d{2})?\)\s*$/gm, '') // standalone duration lines
      .replace(/^\s*_[^_]+_\s*[-–—].*$/gm, (line) => {
        // Strip italic channel lines that are remnants of video listings
        if (videoSearchCards.length > 0) return '';
        return line;
      })
      .replace(/\n{3,}/g, '\n\n');                      // collapse excess blank lines
  }

  // Split by code blocks
  const segments = processedContent.split(/(```[\s\S]*?```)/g);

  return (
    <Box sx={{ '& > *:first-of-type': { mt: 0 }, '& > *:last-child': { mb: 0 } }}>
      {/* Render image gallery if 2+ image URLs were found */}
      {useImageGallery && <ImageGallery urls={imageUrls} />}

      {/* Render video search results as thumbnail cards */}
      {videoSearchCards.length > 0 && <VideoSearchGallery cards={videoSearchCards} />}

      {/* Render video gallery (direct .mp4 files) if 2+ video URLs were found */}
      {useVideoGallery && <VideoGallery urls={videoUrls} />}

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
              const urlMatches = findAllUrls(trimmed);
              const hasMediaUrls = urlMatches?.some(u => isImageUrl(u) || isVideoUrl(u));
              if (hasMediaUrls) {
                // Split around URLs and render media inline
                const { parts, urls } = splitAroundUrls(trimmed);
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
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTaskInfo[]>([]);
  const [activeReport, setActiveReport] = useState<ReportState | null>(null);
  const [clarification, setClarification] = useState<ClarificationState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const acknowledgedTasksRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const recoverySessionRef = useRef<string | null>(null);

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
  // Also starts recovery polling if the last message is a user message
  // with no AI response yet (the response might still be generating).
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

      // Check if the last message is from the user (AI response might be in-flight)
      if (loaded.length > 0 && loaded[loaded.length - 1].role === 'user') {
        const lastUserMsgTime = loaded[loaded.length - 1].timestamp.getTime();
        const ageMs = Date.now() - lastUserMsgTime;
        // Only poll if the user message is recent (within 10 minutes)
        if (ageMs < 10 * 60 * 1000) {
          recoverySessionRef.current = sid;
          setSending(true);
          // Poll in the background for the AI response
          (async () => {
            for (let attempt = 0; attempt < 10; attempt++) {
              await new Promise((r) => setTimeout(r, 3000));
              // Stop if the user navigated away from this session
              if (recoverySessionRef.current !== sid) return;
              try {
                const pollRes = await fetch(`/api/chat/messages?sessionId=${sid}`);
                const pollData = await pollRes.json();
                const pollMsgs = pollData.messages ?? [];
                const hasNewAi = pollMsgs.some(
                  (m: any) => m.role === 'ai' && new Date(m.timestamp).getTime() > lastUserMsgTime
                );
                if (hasNewAi) {
                  if (recoverySessionRef.current !== sid) return;
                  const refreshed = pollMsgs.map((m: any) => ({
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
                  setMessages(refreshed);
                  setContextTokens(estimateTokensFromMessages(refreshed));
                  setSending(false);
                  recoverySessionRef.current = null;
                  return;
                }
              } catch { /* polling error — retry */ }
            }
            // Timed out after ~30s — stop gracefully
            if (recoverySessionRef.current === sid) {
              setSending(false);
              recoverySessionRef.current = null;
            }
          })();
        }
      }
    } catch {
      setMessages([]);
      setContextTokens(0);
    }
  }, []);

  // ── Load background tasks for a session ──
  const loadBackgroundTasks = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/chat/tasks?sessionId=${sid}`);
      if (!res.ok) return;
      const data = await res.json();
      const tasks: BackgroundTaskInfo[] = data.tasks ?? [];
      if (tasks.length > 0) {
        setBackgroundTasks(tasks);
        // Pre-acknowledge tasks that are already completed so we don't
        // re-inject their messages (they're already in the DB)
        for (const task of tasks) {
          if (task.status === 'completed' || task.status === 'failed') {
            acknowledgedTasksRef.current.add(task.id);
          }
        }
      } else {
        setBackgroundTasks([]);
      }
    } catch {
      setBackgroundTasks([]);
    }
  }, []);

  // ── Switch session ──
  const switchSession = useCallback((sid: string) => {
    // Abort any in-flight stream or recovery polling
    abortRef.current?.abort();
    abortRef.current = null;
    recoverySessionRef.current = null;
    setSending(false);

    setSessionId(sid);
    acknowledgedTasksRef.current.clear();
    loadMessages(sid);
    loadBackgroundTasks(sid);
  }, [loadMessages, loadBackgroundTasks]);

  // ── New conversation ──
  const startNewConversation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    recoverySessionRef.current = null;
    setSending(false);

    setSessionId(null);
    setMessages([]);
    setInput('');
    setContextTokens(0);
    setBackgroundTasks([]);
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

  // ── Inline @mention system (multi-agent) ──

  /** Extract @mentioned agent names from message text */
  const parseMentions = useCallback((text: string): string[] => {
    const mentions: string[] = [];
    const re = /@(\w[\w\s]*?)(?=\s@|\s[^@]|$)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      mentions.push(m[1].trim().toLowerCase());
    }
    return mentions;
  }, []);

  /** Resolve mention strings to agent objects */
  const resolveMentionedAgents = useCallback((text: string): Agent[] => {
    const mentionNames = parseMentions(text);
    if (mentionNames.length === 0) return [];
    return agents.filter((a) =>
      mentionNames.some((mn) => a.name.toLowerCase() === mn || a.name.toLowerCase().startsWith(mn))
    );
  }, [agents, parseMentions]);

  const handleMentionClose = useCallback(() => {
    setMentionOpen(false);
    setMentionQuery('');
  }, []);

  // ── Input handling with inline @ detection ──
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);

    // Get cursor position
    const cursorPos = e.target.selectionStart ?? value.length;
    setMentionCursorPos(cursorPos);

    // Look for @query at the cursor position (not just end of string)
    const textBeforeCursor = value.slice(0, cursorPos);
    const match = textBeforeCursor.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1].toLowerCase());
      setMentionOpen(true);
    } else {
      handleMentionClose();
    }
  };

  /** Insert an @mention for the selected agent */
  const handleMentionSelect = useCallback((agent: Agent) => {
    // Replace the @query at cursor with @AgentName
    const textBeforeCursor = input.slice(0, mentionCursorPos);
    const textAfterCursor = input.slice(mentionCursorPos);
    const before = textBeforeCursor.replace(/@\w*$/, '');
    const newInput = `${before}@${agent.name} ${textAfterCursor}`;
    setInput(newInput);
    handleMentionClose();
    // Move cursor to after the inserted mention
    setTimeout(() => {
      const pos = before.length + agent.name.length + 2; // +2 for @ and space
      inputRef.current?.setSelectionRange(pos, pos);
      inputRef.current?.focus();
    }, 0);
  }, [input, mentionCursorPos, handleMentionClose]);

  const filteredAgents = agents.filter((a) =>
    !mentionQuery || a.name.toLowerCase().includes(mentionQuery)
  );

  // ── Send message (streaming via SSE — multi-agent) ──
  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || sending) return;

    const currentAttachments = [...attachments];
    const currentInput = input;

    // Parse @mentions to find which agents to invoke
    const mentionedAgents = resolveMentionedAgents(currentInput);
    const agentIds = mentionedAgents.map((a) => a.id);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: currentInput,
      timestamp: new Date(),
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setContextTokens((prev) => prev + Math.ceil(currentInput.length / 4));
    setInput('');
    setAttachments([]);
    setSending(true);
    setActiveReport(null);
    setClarification(null);

    // Track per-agent message IDs: the backend will tell us which slot maps
    // to which agent via `agent_start` events. We start with a single
    // placeholder for a "default" slot; the backend may add more.
    const slotMessages = new Map<string, string>(); // slotId -> msgId
    const slotContent = new Map<string, string>();   // slotId -> streamed text

    // Pre-create placeholders for explicitly mentioned agents
    if (mentionedAgents.length > 0) {
      for (const agent of mentionedAgents) {
        const msgId = crypto.randomUUID();
        slotMessages.set(agent.id, msgId);
        slotContent.set(agent.id, '');
        setMessages((prev) => [...prev, { id: msgId, role: 'ai', content: '', timestamp: new Date(), agentName: agent.name }]);
      }
    } else {
      // No explicit mentions — create a single placeholder (agent TBD by classifier)
      const defaultMsgId = crypto.randomUUID();
      slotMessages.set('__default__', defaultMsgId);
      slotContent.set('__default__', '');
      setMessages((prev) => [...prev, { id: defaultMsgId, role: 'ai', content: '', timestamp: new Date() }]);
    }

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
          agentIds: agentIds.length > 0 ? agentIds : undefined,
          attachments: currentAttachments.length > 0
            ? currentAttachments.map(a => ({ name: a.name, type: a.type, url: a.url, size: a.size }))
            : undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        // Error on all slots
        setMessages((prev) => prev.map((m) => {
          for (const msgId of slotMessages.values()) {
            if (m.id === msgId) return { ...m, content: `Error: ${errData.error}` };
          }
          return m;
        }));
        setSending(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType = '';
      let receivedDone = false;
      let streamSessionId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed.startsWith(':')) continue;
          if (trimmed.startsWith('event: ')) {
            currentEventType = trimmed.slice(7).trim();
            continue;
          }
          if (!trimmed) { currentEventType = ''; continue; }
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));

            // Resolve the slot (for multi-agent, events carry a `slot` field)
            const slot: string = data.slot ?? '__default__';

            switch (currentEventType) {
              case 'session':
                if (data.sessionId) {
                  streamSessionId = data.sessionId;
                  setSessionId(data.sessionId);
                  loadSessions();
                }
                break;

              case 'agent_start': {
                // Backend tells us which agent is responding in this slot.
                // If we have a __default__ placeholder, rebind it.
                const agentName = data.agentName || 'AI Engine';
                if (slot === '__default__' && slotMessages.has('__default__')) {
                  // Rename the default slot
                  const msgId = slotMessages.get('__default__')!;
                  slotMessages.delete('__default__');
                  slotMessages.set(slot, msgId);
                  slotContent.delete('__default__');
                  slotContent.set(slot, '');
                  setMessages((prev) => prev.map((m) =>
                    m.id === msgId ? { ...m, agentName } : m
                  ));
                } else if (!slotMessages.has(slot)) {
                  // New agent slot (was auto-classified) — create a new placeholder
                  const msgId = crypto.randomUUID();
                  slotMessages.set(slot, msgId);
                  slotContent.set(slot, '');
                  setMessages((prev) => [...prev, { id: msgId, role: 'ai', content: '', timestamp: new Date(), agentName }]);
                } else {
                  // Update name on an existing slot
                  const msgId = slotMessages.get(slot)!;
                  setMessages((prev) => prev.map((m) =>
                    m.id === msgId ? { ...m, agentName } : m
                  ));
                }
                break;
              }

              case 'token': {
                const msgId = slotMessages.get(slot);
                if (msgId) {
                  const prev = slotContent.get(slot) ?? '';
                  const next = prev + data.text;
                  slotContent.set(slot, next);
                  setMessages((msgs) => msgs.map((m) =>
                    m.id === msgId ? { ...m, content: next } : m
                  ));
                }
                break;
              }

              case 'background_task': {
                // A long-running tool was started in the background
                const newTask: BackgroundTaskInfo = {
                  id: data.taskId,
                  sessionId: sessionId ?? '',
                  toolName: data.toolName,
                  description: data.toolName === 'xaiGenerateVideo' ? 'Generating video' : `Running ${data.toolName}`,
                  status: 'running',
                  startedAt: new Date().toISOString(),
                };
                setBackgroundTasks((prev) => [...prev, newTask]);
                break;
              }

              case 'tool':
              case 'status':
                break;

              // ── Orchestration / sub-agent events ──

              case 'clarification_request': {
                const questions = data.questions ?? [];
                setClarification({
                  questions,
                  answers: {},
                  submitted: false,
                });
                break;
              }

              case 'report_outline': {
                const sections: ReportSectionState[] = (data.sections ?? []).map((s: any) => ({
                  id: s.id,
                  title: s.title,
                  status: 'pending' as const,
                  tier: s.tier,
                }));
                setActiveReport({
                  title: data.title ?? 'Report',
                  sections,
                  completed: 0,
                  total: sections.length,
                });
                break;
              }

              case 'report_section_update': {
                setActiveReport((prev) => {
                  if (!prev) return prev;
                  const sections = prev.sections.map((s) =>
                    s.id === data.sectionId
                      ? { ...s, status: data.status as ReportSectionState['status'], content: data.content ?? s.content, tier: data.tier ?? s.tier }
                      : s
                  );
                  const completed = sections.filter((s) => s.status === 'complete' || s.status === 'failed').length;
                  return { ...prev, sections, completed };
                });
                break;
              }

              case 'report_section_added': {
                setActiveReport((prev) => {
                  if (!prev) return prev;
                  const newSection: ReportSectionState = {
                    id: data.section.id,
                    title: data.section.title,
                    status: 'complete',
                    content: data.section.content,
                  };
                  return {
                    ...prev,
                    sections: [...prev.sections, newSection],
                    total: prev.total + 1,
                    completed: prev.completed + 1,
                  };
                });
                break;
              }

              case 'subtask_complete': {
                // Already handled by report_section_update, but we can update the count
                setActiveReport((prev) => {
                  if (!prev) return prev;
                  return { ...prev, completed: data.completed ?? prev.completed };
                });
                break;
              }

              case 'done': {
                receivedDone = true;
                const msgId = slotMessages.get(slot);
                if (msgId) {
                  setMessages((msgs) => msgs.map((m) =>
                    m.id === msgId
                      ? { ...m, content: data.content, agentName: data.agentName || m.agentName }
                      : m
                  ));
                }
                if (data.usage) {
                  const totalUsed = (data.usage.inputTokens ?? 0) + (data.usage.outputTokens ?? 0);
                  if (totalUsed > 0) setContextTokens((prev) => Math.max(prev, totalUsed));
                }
                break;
              }

              case 'error': {
                receivedDone = true; // Error is also a terminal event
                const msgId = slotMessages.get(slot);
                if (msgId) {
                  setMessages((msgs) => msgs.map((m) =>
                    m.id === msgId ? { ...m, content: `Error: ${data.message}` } : m
                  ));
                }
                break;
              }
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }

      // ── Stream ended — check if we got a proper termination ──
      // If the stream was cut (proxy timeout, network blip) without a
      // `done` or `error` event, the backend may still be processing.
      // Poll the messages API to recover the AI response from DB.
      if (!receivedDone && streamSessionId) {
        console.warn('[Chat] SSE stream ended without done event — attempting recovery via polling');

        const recoverSessionId = streamSessionId;
        const slotMsgEntries = Array.from(slotMessages.entries());

        // Retry up to 5 times with exponential backoff (2s, 4s, 8s, 16s, 32s)
        for (let attempt = 0; attempt < 5; attempt++) {
          const delay = 2000 * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));

          try {
            const pollRes = await fetch(`/api/chat/messages?sessionId=${recoverSessionId}`);
            if (!pollRes.ok) continue;
            const pollData = await pollRes.json();
            const dbMessages: Array<{ id: string; role: string; content: string; agentName?: string }> = pollData.messages ?? [];

            // Find the latest AI messages that weren't part of our local slots
            const localSlotIds = new Set(slotMsgEntries.map(([, id]) => id));
            const latestAiMsgs = dbMessages.filter(
              (m) => m.role === 'ai' && m.content && !localSlotIds.has(m.id)
            );

            if (latestAiMsgs.length > 0) {
              // The backend finished — replace our placeholder(s) with the DB content
              const lastAi = latestAiMsgs[latestAiMsgs.length - 1];
              // Update the first empty slot with the recovered content
              for (const [, msgId] of slotMsgEntries) {
                const slotText = slotContent.get(slotMsgEntries.find(([, id]) => id === msgId)?.[0] ?? '') ?? '';
                if (!slotText) {
                  setMessages((msgs) => msgs.map((m) =>
                    m.id === msgId
                      ? { ...m, content: lastAi.content, agentName: lastAi.agentName || m.agentName }
                      : m
                  ));
                  break;
                }
              }
              console.log(`[Chat] Recovery successful on attempt ${attempt + 1}`);
              break;
            }

            // Check if all our slot messages already have content (partial streaming succeeded)
            const allSlotsHaveContent = slotMsgEntries.every(
              ([slot]) => (slotContent.get(slot) ?? '').length > 0
            );
            if (allSlotsHaveContent) {
              console.log('[Chat] All slots have partial content — keeping streamed text');
              break;
            }
          } catch {
            // Poll failed — continue retrying
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        // ── Connection error recovery ──
        // If we got a network error but a session was established,
        // attempt to recover by polling the messages API.
        const recoverSessionId = sessionId;
        const slotMsgEntries = Array.from(slotMessages.entries());
        let recovered = false;

        if (recoverSessionId) {
          for (let attempt = 0; attempt < 3; attempt++) {
            await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
            try {
              const pollRes = await fetch(`/api/chat/messages?sessionId=${recoverSessionId}`);
              if (!pollRes.ok) continue;
              const pollData = await pollRes.json();
              const dbMessages: Array<{ id: string; role: string; content: string; agentName?: string }> = pollData.messages ?? [];
              const lastAi = [...dbMessages].reverse().find((m) => m.role === 'ai' && m.content);
              if (lastAi) {
                for (const [, msgId] of slotMsgEntries) {
                  const slotText = slotContent.get(slotMsgEntries.find(([, id]) => id === msgId)?.[0] ?? '') ?? '';
                  if (!slotText) {
                    setMessages((msgs) => msgs.map((m) =>
                      m.id === msgId
                        ? { ...m, content: lastAi.content, agentName: lastAi.agentName || m.agentName }
                        : m
                    ));
                    recovered = true;
                    break;
                  }
                }
                if (recovered) break;
              }
            } catch { /* continue */ }
          }
        }

        if (!recovered) {
          setMessages((prev) => {
            const emptySlotMsgIds = Array.from(slotMessages.values());
            return prev.map((m) => {
              if (emptySlotMsgIds.includes(m.id) && !m.content) {
                return { ...m, content: `Connection lost: ${err.message}. The agent may still be processing — check back shortly.` };
              }
              return m;
            });
          });
        }
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

  // ── Background task polling ──
  // When there are running tasks, poll /api/chat/tasks every 3 seconds.
  // On completion, inject the result message and acknowledge the task.
  useEffect(() => {
    const hasRunning = backgroundTasks.some((t) => t.status === 'running');
    if (!hasRunning || !sessionId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/chat/tasks?sessionId=${sessionId}`);
        if (!res.ok) return;
        const data = await res.json();
        const tasks: BackgroundTaskInfo[] = data.tasks ?? [];
        setBackgroundTasks(tasks);

        // Check for newly completed tasks
        for (const task of tasks) {
          if (
            (task.status === 'completed' || task.status === 'failed') &&
            !acknowledgedTasksRef.current.has(task.id)
          ) {
            acknowledgedTasksRef.current.add(task.id);

            // Inject the result as a new AI message in the chat
            const newMsg: Message = {
              id: task.messageId ?? crypto.randomUUID(),
              role: 'ai',
              content: task.result?.output ?? (task.status === 'failed' ? 'Background task failed.' : ''),
              timestamp: new Date(task.completedAt ?? Date.now()),
              agentName: task.agentName,
            };
            setMessages((prev) => [...prev, newMsg]);
            setSnack({
              open: true,
              message: task.status === 'completed'
                ? `Background task complete: ${task.description}`
                : `Background task failed: ${task.description}`,
              severity: task.status === 'completed' ? 'success' : 'error',
            });

            // Acknowledge the task to clean it up on the server
            fetch('/api/chat/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: task.id }),
            }).catch(() => { /* ignore ack errors */ });
          }
        }
      } catch {
        // Polling errors are non-fatal
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [backgroundTasks, sessionId]);

  /* ─── Render ────────────────────────────────────────────────────────── */

  const sidebarBg = alpha(theme.palette.background.paper, 0.6);
  const chatBg = theme.palette.background.default;

  return (
    <>
    {/* Global CSS for Siri-style animated glow border */}
    <style>{`
      @property --glow-angle {
        syntax: "<angle>";
        initial-value: 0deg;
        inherits: false;
      }
      @keyframes siriRotate {
        to { --glow-angle: 360deg; }
      }
      @keyframes siriPulse {
        0%, 100% { opacity: 0.45; }
        50% { opacity: 0.75; }
      }
    `}</style>
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
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', bgcolor: chatBg, minWidth: 0, position: 'relative' }}>

        {/* ── Background task indicator ─────────────────────────────── */}
        {backgroundTasks.filter((t) => t.status === 'running').length > 0 && (
          <Fade in timeout={400}>
            <Box
              sx={{
                position: 'absolute',
                top: 12,
                right: 16,
                zIndex: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 0.75,
                borderRadius: 3,
                bgcolor: alpha(theme.palette.background.paper, 0.85),
                backdropFilter: 'blur(8px)',
                border: '1px solid',
                borderColor: alpha(theme.palette.primary.main, 0.3),
                boxShadow: `0 0 16px ${alpha(theme.palette.primary.main, 0.15)}, 0 0 4px ${alpha(theme.palette.primary.main, 0.1)}`,
                animation: 'bgTaskPulse 2.5s ease-in-out infinite',
                '@keyframes bgTaskPulse': {
                  '0%, 100%': {
                    boxShadow: `0 0 16px ${alpha(theme.palette.primary.main, 0.15)}, 0 0 4px ${alpha(theme.palette.primary.main, 0.1)}`,
                    borderColor: alpha(theme.palette.primary.main, 0.3),
                  },
                  '50%': {
                    boxShadow: `0 0 24px ${alpha(theme.palette.primary.main, 0.3)}, 0 0 8px ${alpha(theme.palette.primary.main, 0.2)}`,
                    borderColor: alpha(theme.palette.primary.main, 0.5),
                  },
                },
              }}
            >
              <Badge
                badgeContent={backgroundTasks.filter((t) => t.status === 'running').length}
                color="primary"
                sx={{
                  '& .MuiBadge-badge': {
                    fontSize: 10,
                    minWidth: 16,
                    height: 16,
                    p: 0,
                  },
                }}
              >
                <HourglassTopIcon
                  sx={{
                    fontSize: 18,
                    color: 'primary.main',
                    animation: 'bgTaskSpin 2s linear infinite',
                    '@keyframes bgTaskSpin': {
                      '0%': { transform: 'rotate(0deg)' },
                      '100%': { transform: 'rotate(360deg)' },
                    },
                  }}
                />
              </Badge>
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 11, color: 'primary.main', lineHeight: 1.2, display: 'block' }}>
                  Working in background
                </Typography>
                <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary', lineHeight: 1.2 }}>
                  {backgroundTasks.filter((t) => t.status === 'running').map((t) => t.description).join(', ')}
                </Typography>
              </Box>
            </Box>
          </Fade>
        )}

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
                  Ask anything, or tag agents with @
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
                        variant="outlined"
                        onClick={() => setInput((prev) => `${prev}@${a.name} `)}
                        sx={{ fontSize: 12, cursor: 'pointer' }}
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

                // Detect if this AI message is still being actively generated
                // (any AI message after the last user message while still streaming)
                const lastUserIdx = messages.reduce((acc, m, i) => m.role === 'user' ? i : acc, -1);
                const isActiveAi = !isUser && sending && idx > lastUserIdx;

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
                        {/* Siri-style glow wrapper — only active during generation */}
                        <Box
                          className={isActiveAi ? 'siri-glow-active' : undefined}
                          sx={{
                            position: 'relative',
                            borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                            '&.siri-glow-active': {
                              // Animated gradient border
                              '&::before': {
                                content: '""',
                                position: 'absolute',
                                inset: -1,
                                borderRadius: 'inherit',
                                padding: '1.5px',
                                background: 'conic-gradient(from var(--glow-angle, 0deg), #6366f1, #06b6d4, #a855f7, #ec4899, #6366f1)',
                                WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                                WebkitMaskComposite: 'xor',
                                maskComposite: 'exclude',
                                animation: 'siriRotate 3s linear infinite',
                                opacity: 0.85,
                              },
                              // Ambient glow blur
                              '&::after': {
                                content: '""',
                                position: 'absolute',
                                inset: -6,
                                borderRadius: 'inherit',
                                background: 'conic-gradient(from var(--glow-angle, 0deg), rgba(99,102,241,0.3), rgba(6,182,212,0.3), rgba(168,85,247,0.3), rgba(236,72,153,0.3), rgba(99,102,241,0.3))',
                                filter: 'blur(14px)',
                                animation: 'siriRotate 3s linear infinite, siriPulse 2s ease-in-out infinite',
                                opacity: 0.6,
                                zIndex: -1,
                              },
                            },
                          }}
                        >
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
                              : isActiveAi
                                ? 'transparent'
                                : alpha(theme.palette.divider, 0.5),
                            position: 'relative',
                            zIndex: 1,
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
                            <>
                              {/* Clarification panel (shown when agent asks questions, on the last AI message) */}
                              {msg.role === 'ai' && clarification && !clarification.submitted && sending && idx === messages.length - 1 && (
                                <ClarificationPanel
                                  state={clarification}
                                  sessionId={sessionId ?? ''}
                                  onSubmitted={() => setClarification((prev) => prev ? { ...prev, submitted: true } : null)}
                                />
                              )}

                              {/* Dynamic report (shown when agent delegates tasks, on the last AI message) */}
                              {msg.role === 'ai' && activeReport && idx === messages.length - 1 && (
                                <DynamicReport report={activeReport} />
                              )}

                              <MessageContent content={msg.content} attachments={msg.attachments} />
                            </>
                          )}
                        </Paper>
                        </Box>
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
                  <Box
                    className="siri-glow-active"
                    sx={{
                      position: 'relative',
                      borderRadius: '16px 16px 16px 4px',
                      '&.siri-glow-active::before': {
                        content: '""',
                        position: 'absolute',
                        inset: -1,
                        borderRadius: 'inherit',
                        padding: '1.5px',
                        background: 'conic-gradient(from var(--glow-angle, 0deg), #6366f1, #06b6d4, #a855f7, #ec4899, #6366f1)',
                        WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                        WebkitMaskComposite: 'xor',
                        maskComposite: 'exclude',
                        animation: 'siriRotate 3s linear infinite',
                        opacity: 0.85,
                      },
                      '&.siri-glow-active::after': {
                        content: '""',
                        position: 'absolute',
                        inset: -6,
                        borderRadius: 'inherit',
                        background: 'conic-gradient(from var(--glow-angle, 0deg), rgba(99,102,241,0.3), rgba(6,182,212,0.3), rgba(168,85,247,0.3), rgba(236,72,153,0.3), rgba(99,102,241,0.3))',
                        filter: 'blur(14px)',
                        animation: 'siriRotate 3s linear infinite, siriPulse 2s ease-in-out infinite',
                        opacity: 0.6,
                        zIndex: -1,
                      },
                    }}
                  >
                    <Paper elevation={0} sx={{
                      px: 2, py: 1.25, borderRadius: '16px 16px 16px 4px',
                      bgcolor: alpha(theme.palette.background.paper, 0.5),
                      border: '1px solid', borderColor: 'transparent',
                      position: 'relative', zIndex: 1,
                    }}>
                      <TypingIndicator />
                    </Paper>
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>

        {/* ── Input area ──────────────────────────────────────────── */}
        <Box sx={{ px: { xs: 2, md: 3 }, pb: 2, pt: 1 }}>
          <Box sx={{ maxWidth: 800, mx: 'auto' }}>
            {/* Active @mentions indicator */}
            {(() => {
              const mentioned = resolveMentionedAgents(input);
              if (mentioned.length === 0) return null;
              return (
                <Box sx={{ mb: 0.75, display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                  <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 11, mr: 0.5 }}>
                    Responding:
                  </Typography>
                  {mentioned.map((a) => (
                    <Chip
                      key={a.id}
                      icon={<SmartToyIcon sx={{ fontSize: '12px !important' }} />}
                      label={a.name}
                      size="small"
                      color="primary"
                      variant="outlined"
                      sx={{ fontSize: 11, height: 22 }}
                    />
                  ))}
                </Box>
              );
            })()}

            <Box
              className={sending ? 'siri-glow-active' : undefined}
              sx={{
                position: 'relative',
                borderRadius: 3,
                '&.siri-glow-active::before': {
                  content: '""',
                  position: 'absolute',
                  inset: -1,
                  borderRadius: 'inherit',
                  padding: '2px',
                  background: 'conic-gradient(from var(--glow-angle, 0deg), #6366f1, #06b6d4, #a855f7, #ec4899, #6366f1)',
                  WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                  WebkitMaskComposite: 'xor',
                  maskComposite: 'exclude',
                  animation: 'siriRotate 3s linear infinite',
                  opacity: 0.9,
                  zIndex: 1,
                },
                '&.siri-glow-active::after': {
                  content: '""',
                  position: 'absolute',
                  inset: -8,
                  borderRadius: 'inherit',
                  background: 'conic-gradient(from var(--glow-angle, 0deg), rgba(99,102,241,0.25), rgba(6,182,212,0.25), rgba(168,85,247,0.25), rgba(236,72,153,0.25), rgba(99,102,241,0.25))',
                  filter: 'blur(16px)',
                  animation: 'siriRotate 3s linear infinite, siriPulse 2s ease-in-out infinite',
                  opacity: 0.5,
                  zIndex: 0,
                },
              }}
            >
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
                borderColor: sending
                  ? 'transparent'
                  : isDragOver
                    ? alpha(theme.palette.primary.main, 0.6)
                    : alpha(theme.palette.divider, 1),
                borderStyle: isDragOver ? 'dashed' : 'solid',
                bgcolor: isDragOver
                  ? alpha(theme.palette.primary.main, 0.04)
                  : alpha(theme.palette.background.paper, 0.6),
                transition: 'border-color 0.2s, background-color 0.2s',
                position: 'relative',
                zIndex: 2,
                '&:focus-within': {
                  borderColor: sending
                    ? 'transparent'
                    : isDragOver
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

                {/* @ mention button — inserts @ into input to trigger autocomplete */}
                <Tooltip title="Mention an agent (@)">
                  <IconButton
                    size="small"
                    onClick={() => {
                      setInput((prev) => prev + '@');
                      setMentionOpen(true);
                      setMentionQuery('');
                      inputRef.current?.focus();
                    }}
                    disabled={sending}
                    sx={{
                      mb: 0.25,
                      color: 'text.disabled',
                      '&:hover': { color: 'primary.main' },
                    }}
                  >
                    <AlternateEmailIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>

                <TextField
                  inputRef={inputRef}
                  fullWidth
                  placeholder="Message AI Engine... (type @ to mention agents)"
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
            </Box>

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

      {/* ── Inline @mention autocomplete ────────────────────────────── */}
      <Popover
        open={mentionOpen && filteredAgents.length > 0}
        anchorEl={inputRef.current}
        onClose={handleMentionClose}
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: -1, minWidth: 220, maxHeight: 260,
              borderRadius: 2, border: '1px solid', borderColor: 'divider',
              bgcolor: 'background.paper',
              boxShadow: 8,
            },
          },
        }}
      >
        <Box sx={{ p: 0.75 }}>
          <Typography variant="caption" sx={{ px: 1, py: 0.5, display: 'block', color: 'text.disabled', fontWeight: 600, fontSize: 10 }}>
            Mention an agent
          </Typography>
          {filteredAgents.map((agent) => (
            <MenuItem
              key={agent.id}
              onClick={() => handleMentionSelect(agent)}
              sx={{ borderRadius: 1, fontSize: 13, py: 0.75, minHeight: 0 }}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                <SmartToyIcon sx={{ fontSize: 16, color: 'primary.main' }} />
              </ListItemIcon>
              <Box>
                <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 500 }}>{agent.name}</Typography>
                {agent.rolePrompt && (
                  <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10, display: 'block', lineHeight: 1.2 }}>
                    {agent.rolePrompt.slice(0, 60)}{agent.rolePrompt.length > 60 ? '...' : ''}
                  </Typography>
                )}
              </Box>
            </MenuItem>
          ))}
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
    </>
  );
}
