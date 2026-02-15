'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Stack, Divider,
  CircularProgress, Chip, IconButton, Alert, Card, CardContent,
  Badge, Tooltip, LinearProgress, Tabs, Tab, alpha, useTheme,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ImageIcon from '@mui/icons-material/Image';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DescriptionIcon from '@mui/icons-material/Description';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import PersonIcon from '@mui/icons-material/Person';
import ArticleIcon from '@mui/icons-material/Article';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ListAltIcon from '@mui/icons-material/ListAlt';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import DashboardIcon from '@mui/icons-material/Dashboard';
import RichMarkdown from '../RichMarkdown';
import DependencyGraph from './DependencyGraph';
import WireframeGallery from './WireframeGallery';
import WireframeEditor from './WireframeEditor';
import type { Wireframe } from './WireframeEditor';

interface PlanningModeProps {
  projectId: string;
  projectName: string;
  onComplete: (prd: string, tasks: ProjectTask[]) => void;
  onCancel: () => void;
}

interface ProjectTask {
  id?: string;
  title: string;
  description: string;
  taskType: 'feature' | 'bugfix' | 'test' | 'qa' | 'documentation';
  priority: number;
  status?: string;
  dependencies: string[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  /** Structured questions attached to an assistant message (for clickable responses). */
  questions?: PlanningQuestion[];
  timestamp: Date;
}

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  storageUrl: string;
  attachmentType: 'image' | 'pdf' | 'document' | 'other';
  uploadedAt: string;
}

/** Structured question from the planning agent with clickable options. */
interface PlanningQuestion {
  id: string;
  prompt: string;
  options?: Array<{ id: string; label: string }>;
  allowFreeText?: boolean;
}

// Color map for task types
const TASK_TYPE_COLORS: Record<string, string> = {
  feature: '#818cf8',
  bugfix: '#f87171',
  test: '#34d399',
  qa: '#fbbf24',
  documentation: '#38bdf8',
};

export default function PlanningMode({ projectId, projectName, onComplete, onCancel }: PlanningModeProps) {
  const theme = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [prd, setPrd] = useState('');
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [wireframes, setWireframes] = useState<Wireframe[]>([]);
  const [wireframeEditorOpen, setWireframeEditorOpen] = useState(false);
  const [editingWireframe, setEditingWireframe] = useState<Wireframe | null>(null);
  // Right panel is visible whenever we have PRD content, tasks, or wireframes
  const hasPrdOrTasks = prd.length > 0 || tasks.length > 0 || wireframes.length > 0;
  const [progress, setProgress] = useState(0);
  const [rightTab, setRightTab] = useState(0); // 0=PRD, 1=Wireframes, 2=Graph, 3=Task List
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      const el = chatScrollRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
      }
    });
  }, []);

  // Scroll on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Re-scroll when the layout shifts (PRD/tasks panel appears/disappears causing
  // the chat column to resize). Fire immediately + after the 300ms CSS transition.
  useEffect(() => {
    scrollToBottom(false);
    const timer = setTimeout(() => scrollToBottom(false), 350);
    return () => clearTimeout(timer);
  }, [hasPrdOrTasks, scrollToBottom]);

  // Load conversation history and existing PRD/tasks/wireframes
  useEffect(() => {
    loadConversationHistory();
    loadAttachments();
    loadPrdAndTasks();
    loadWireframes();
  }, [projectId]);

  /** Load existing PRD and tasks from the database. */
  const loadPrdAndTasks = async () => {
    try {
      const res = await fetch(`/api/projects/plan?projectId=${projectId}`);
      const data = await res.json();
      if (data.prd) setPrd(data.prd);
      if (data.tasks?.length > 0) setTasks(data.tasks);
    } catch (err) {
      console.warn('Failed to load PRD/tasks:', err);
    }
  };

  /** Load wireframes for this project. */
  const loadWireframes = async () => {
    try {
      const res = await fetch(`/api/projects/wireframes?projectId=${projectId}`);
      const data = await res.json();
      if (data.wireframes) setWireframes(data.wireframes);
    } catch (err) {
      console.warn('Failed to load wireframes:', err);
    }
  };

  const loadConversationHistory = async () => {
    try {
      const res = await fetch(`/api/projects/conversations?projectId=${projectId}`);
      const data = await res.json();
      if (data.conversations?.length > 0) {
        setMessages(
          data.conversations.map((c: any) => ({
            id: c.id,
            role: c.role,
            content: c.content,
            timestamp: new Date(c.createdAt),
          }))
        );
      } else {
        // Initialize with welcome message
        initializeConversation();
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
      initializeConversation();
    }
  };

  const initializeConversation = () => {
    const welcomeMessage: Message = {
      id: 'welcome',
      role: 'assistant',
      content: `# Welcome to Planning Mode for "${projectName}"!

I'm here to help you plan and build your dream application. Let's work together to understand exactly what you want to create.

## How This Works

1. **Tell me your vision** - Describe what you want to build
2. **Share references** - Upload UI mockups, PDFs, wireframes, or documentation
3. **Iterate together** - We'll refine requirements until everything is clear
4. **Generate PRD & Tasks** - I'll create a detailed plan and break it into tasks
5. **Launch build** - Start the autonomous agent swarm to build it

## Let's Start!

What would you like to build? Feel free to:
- Describe your idea in detail
- Share reference images or UI designs
- Upload PDFs with specifications
- Provide any documentation you have

The more context you provide, the better I can help you build exactly what you envision.`,
      timestamp: new Date(),
    };
    setMessages([welcomeMessage]);
  };

  const loadAttachments = async () => {
    try {
      const res = await fetch(`/api/projects/attachments?projectId=${projectId}`);
      const data = await res.json();
      setAttachments(data.attachments || []);
    } catch (error) {
      console.error('Failed to load attachments:', error);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setPendingAttachments([...pendingAttachments, ...files]);
  };

  const removePendingAttachment = (index: number) => {
    setPendingAttachments(pendingAttachments.filter((_, i) => i !== index));
  };

  const uploadAttachment = async (file: File): Promise<Attachment | null> => {
    const formData = new FormData();
    formData.append('projectId', projectId);
    formData.append('file', file);

    try {
      const res = await fetch('/api/projects/attachments', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      return data.attachment;
    } catch (error) {
      console.error('Failed to upload:', error);
      return null;
    }
  };

  const handleSend = async (overrideMessage?: string) => {
    const messageText = overrideMessage || input.trim();
    if ((!messageText && pendingAttachments.length === 0) || loading) return;

    setLoading(true);
    setUploading(pendingAttachments.length > 0);

    try {
      // Upload pending attachments
      const uploadedAttachments: Attachment[] = [];
      for (const file of pendingAttachments) {
        const attachment = await uploadAttachment(file);
        if (attachment) {
          uploadedAttachments.push(attachment);
        }
      }
      setPendingAttachments([]);
      setUploading(false);

      // Add user message
      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: messageText,
        attachments: uploadedAttachments,
        timestamp: new Date(),
      };
      
      setInput('');
      const newMessages = [...messages, userMessage];
      setMessages(newMessages);

      // Save user message
      await fetch('/api/projects/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          role: 'user',
          content: userMessage.content,
          metadata: uploadedAttachments.length > 0 ? { attachments: uploadedAttachments.map(a => a.id) } : null,
        }),
      });

      // Call AI planning agent
      const aiResult = await generateAIResponse(newMessages, uploadedAttachments);
      
      const aiMessage: Message = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: aiResult.text,
        questions: aiResult.questions,
        timestamp: new Date(),
      };

      // Reset question answers for new set of questions
      if (aiResult.questions && aiResult.questions.length > 0) {
        setQuestionAnswers({});
      }
      
      setMessages([...newMessages, aiMessage]);

    } catch (error: any) {
      console.error('Error:', error);
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `I encountered an error: ${error.message}. Please try again.`,
        timestamp: new Date(),
      };
      setMessages([...messages, errorMessage]);
    } finally {
      setLoading(false);
      // Auto-focus the chat input after the agent finishes responding
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const generateAIResponse = async (
    conversationHistory: Message[],
    newAttachments: Attachment[],
  ): Promise<{ text: string; questions?: PlanningQuestion[] }> => {
    setProgress(10);

    try {
      // Call the real planning agent API (runs LLM with planning tools)
      const response = await fetch('/api/projects/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          userMessage: conversationHistory[conversationHistory.length - 1].content,
          attachments: newAttachments.map(a => a.id),
        }),
      });

      setProgress(60);

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      // Update PRD, tasks, and wireframes from the database state returned by the agent
      if (data.prd) setPrd(data.prd);
      if (data.tasks) setTasks(data.tasks);
      if (data.wireframes) setWireframes(data.wireframes);
      else loadWireframes(); // Refresh wireframes in case the agent created any

      setProgress(100);
      return {
        text: data.response,
        questions: data.questions ?? undefined,
      };
    } catch (error: any) {
      console.error('AI generation error:', error);
      setProgress(100);
      return { text: `I encountered an issue while processing your message: ${error.message}. Please try again.` };
    }
  };

  /**
   * Trigger PRD & task generation by sending a prompt to the planning agent.
   * The agent will use save_prd and add_task tools to persist everything to the DB.
   */
  const generatePRDAndTasks = () => {
    const promptMessage = 'Please generate a comprehensive PRD now using save_prd, and create all the tasks using add_task. ' +
      'First call get_comprehensive_context to gather everything we have discussed, then write the full PRD and create a complete task breakdown with proper dependencies.';
    setInput(promptMessage);
    // Trigger send on next tick so the input state is set
    setTimeout(() => {
      handleSend(promptMessage);
    }, 0);
  };

  /**
   * Submit answers to the agent's clarification questions.
   * Formats the answers and sends them as a user message.
   */
  const handleSubmitAnswers = async (questions: PlanningQuestion[], answers: Record<string, string>) => {
    // Format the answers as a clear user response
    const answerLines = questions.map((q) => {
      const answer = answers[q.id];
      if (!answer) return null;
      return `**${q.prompt}**\n${answer}`;
    }).filter(Boolean);

    if (answerLines.length === 0) return;

    const formattedMessage = answerLines.join('\n\n');

    // Set as input and trigger send
    setInput(formattedMessage);
    setQuestionAnswers({});

    // Clear questions from the last message to mark them as answered
    setMessages((prev) => prev.map((msg, idx) => {
      if (idx === prev.length - 1 && msg.questions) {
        return { ...msg, questions: undefined };
      }
      return msg;
    }));

    // Small delay to let the state update, then send
    setTimeout(async () => {
      // Manually trigger send with the formatted message
      setLoading(true);
      try {
        const userMessage: Message = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: formattedMessage,
          timestamp: new Date(),
        };

        setInput('');
        const newMessages = [...messages.map((msg, idx) =>
          idx === messages.length - 1 && msg.questions ? { ...msg, questions: undefined } : msg
        ), userMessage];
        setMessages(newMessages);

        await fetch('/api/projects/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, role: 'user', content: formattedMessage }),
        });

        const aiResult = await generateAIResponse(newMessages, []);
        const aiMessage: Message = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: aiResult.text,
          questions: aiResult.questions,
          timestamp: new Date(),
        };

        if (aiResult.questions && aiResult.questions.length > 0) {
          setQuestionAnswers({});
        }

        setMessages([...newMessages, aiMessage]);
      } catch (error: any) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    }, 50);
  };

  const getAttachmentIcon = (type: string) => {
    switch (type) {
      case 'image': return <ImageIcon />;
      case 'pdf': return <PictureAsPdfIcon />;
      case 'document': return <DescriptionIcon />;
      default: return <AttachFileIcon />;
    }
  };

  // ── Wireframe CRUD handlers ──

  const existingFeatureTags = useMemo(() => {
    const tags = new Set<string>();
    for (const wf of wireframes) {
      const ft = Array.isArray(wf.featureTags) ? wf.featureTags : [];
      ft.forEach((t: string) => tags.add(t));
    }
    return Array.from(tags);
  }, [wireframes]);

  const handleWireframeCreate = () => {
    setEditingWireframe(null);
    setWireframeEditorOpen(true);
  };

  const handleWireframeEdit = (wf: Wireframe) => {
    setEditingWireframe(wf);
    setWireframeEditorOpen(true);
  };

  const handleWireframeSave = async (wf: Wireframe) => {
    try {
      if (wf.id) {
        await fetch('/api/projects/wireframes', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: wf.id, ...wf }),
        });
      } else {
        await fetch('/api/projects/wireframes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...wf, projectId }),
        });
      }
      await loadWireframes();
    } catch (err) {
      console.error('Failed to save wireframe:', err);
    }
  };

  const handleWireframeDelete = async (wf: Wireframe, force?: boolean) => {
    if (!wf.id) return;
    try {
      const res = await fetch(`/api/projects/wireframes?id=${wf.id}${force ? '&force=true' : ''}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.warning && !force) return; // Dialog handled by gallery
      await loadWireframes();
    } catch (err) {
      console.error('Failed to delete wireframe:', err);
    }
  };

  const handleWireframeDuplicate = async (wf: Wireframe) => {
    try {
      let newName = `${wf.name} (copy)`;
      let counter = 2;
      while (wireframes.some((w) => w.name === newName)) {
        newName = `${wf.name} (copy ${counter++})`;
      }
      await fetch('/api/projects/wireframes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: newName,
          description: wf.description,
          wireframeType: wf.wireframeType,
          elements: wf.elements,
          featureTags: wf.featureTags,
          canvasWidth: wf.canvasWidth,
          canvasHeight: wf.canvasHeight,
        }),
      });
      await loadWireframes();
    } catch (err) {
      console.error('Failed to duplicate wireframe:', err);
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {progress > 0 && progress < 100 && (
        <LinearProgress variant="determinate" value={progress} sx={{ height: 2 }} />
      )}

      <Box sx={{ display: 'flex', gap: 2, flexGrow: 1, overflow: 'hidden', p: 2 }}>
        {/* ── Chat Interface (left side) ── */}
        <Paper
          sx={{
            flex: hasPrdOrTasks ? '0 0 420px' : 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            transition: 'flex 0.3s ease',
          }}
          elevation={0}
          variant="outlined"
        >
          {/* Messages */}
          <Box ref={chatScrollRef} sx={{ flexGrow: 1, overflow: 'auto', p: 2.5 }}>
            {messages.map((msg) => (
              <Box
                key={msg.id}
                sx={{
                  mb: 2.5,
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <Box
                  sx={{
                    maxWidth: hasPrdOrTasks ? '95%' : '75%',
                    minWidth: 0,
                  }}
                >
                  {/* Sender label */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, px: 0.5 }}>
                    {msg.role === 'assistant'
                      ? <SmartToyIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                      : <PersonIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    }
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      {msg.role === 'assistant' ? 'AI Planning Agent' : 'You'}
                    </Typography>
                  </Box>

                  <Paper
                    sx={{
                      p: 2,
                      bgcolor: msg.role === 'user'
                        ? alpha(theme.palette.primary.main, 0.15)
                        : alpha(theme.palette.background.paper, 0.6),
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: msg.role === 'user'
                        ? alpha(theme.palette.primary.main, 0.25)
                        : 'divider',
                    }}
                    elevation={0}
                  >
                    {/* Use RichMarkdown for assistant messages, plain text for user */}
                    {msg.role === 'assistant' ? (
                      <RichMarkdown content={msg.content} />
                    ) : (
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                        {msg.content}
                      </Typography>
                    )}

                    {msg.attachments && msg.attachments.length > 0 && (
                      <Box sx={{ mt: 1.5, display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                        {msg.attachments.map((att) => (
                          <Chip
                            key={att.id}
                            icon={getAttachmentIcon(att.attachmentType)}
                            label={att.filename}
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: 11 }}
                          />
                        ))}
                      </Box>
                    )}
                  </Paper>

                  {/* ── Clarification Questions Panel ── */}
                  {msg.questions && msg.questions.length > 0 && !loading && (
                    <Box sx={{
                      mt: 1.5, p: 2, borderRadius: 2,
                      border: '1px solid',
                      borderColor: alpha(theme.palette.primary.main, 0.3),
                      bgcolor: alpha(theme.palette.primary.main, 0.03),
                    }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main', mb: 1.5, display: 'block' }}>
                        Please answer to continue:
                      </Typography>

                      {msg.questions.map((q) => (
                        <Box key={q.id} sx={{ mb: 2, '&:last-child': { mb: 0 } }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
                            {q.prompt}
                          </Typography>

                          {/* Option chips */}
                          {q.options && q.options.length > 0 && (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: q.allowFreeText ? 1 : 0 }}>
                              {q.options.map((opt) => (
                                <Chip
                                  key={opt.id}
                                  label={opt.label}
                                  clickable
                                  onClick={() => setQuestionAnswers((prev) => ({ ...prev, [q.id]: opt.label }))}
                                  sx={{
                                    borderRadius: '16px',
                                    border: '1px solid',
                                    borderColor: questionAnswers[q.id] === opt.label
                                      ? 'primary.main'
                                      : alpha(theme.palette.common.white, 0.15),
                                    bgcolor: questionAnswers[q.id] === opt.label
                                      ? alpha(theme.palette.primary.main, 0.15)
                                      : 'transparent',
                                    color: questionAnswers[q.id] === opt.label ? 'primary.main' : 'text.secondary',
                                    fontWeight: questionAnswers[q.id] === opt.label ? 600 : 400,
                                    fontSize: '0.8rem',
                                    transition: 'all 0.15s ease',
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
                              value={questionAnswers[q.id] ?? ''}
                              onChange={(e) => setQuestionAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
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

                      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                        <Button
                          variant="contained"
                          size="small"
                          onClick={() => handleSubmitAnswers(msg.questions!, questionAnswers)}
                          disabled={Object.keys(questionAnswers).length === 0}
                          startIcon={<SendIcon />}
                        >
                          Submit Answers
                        </Button>
                        <Button
                          variant="text"
                          size="small"
                          color="inherit"
                          onClick={() => {
                            // Skip — clear the questions
                            setMessages((prev) => prev.map((m) =>
                              m.id === msg.id ? { ...m, questions: undefined } : m
                            ));
                          }}
                          sx={{ color: 'text.secondary' }}
                        >
                          Skip
                        </Button>
                      </Stack>
                    </Box>
                  )}
                </Box>
              </Box>
            ))}
            
            {loading && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  {uploading ? 'Uploading files...' : 'AI is thinking...'}
                </Typography>
              </Box>
            )}
            
            <div ref={messagesEndRef} />
          </Box>

          {/* Input Area */}
          <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
            {pendingAttachments.length > 0 && (
              <Box sx={{ mb: 1, display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {pendingAttachments.map((file, index) => (
                  <Chip
                    key={index}
                    label={file.name}
                    onDelete={() => removePendingAttachment(index)}
                    size="small"
                  />
                ))}
              </Box>
            )}
            
            <Stack direction="row" spacing={1} alignItems="flex-end">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.txt,.md"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
              <Tooltip title="Attach files (images, PDFs, docs)">
                <IconButton
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  size="small"
                >
                  <Badge badgeContent={pendingAttachments.length} color="primary">
                    <AttachFileIcon fontSize="small" />
                  </Badge>
                </IconButton>
              </Tooltip>
              
              <TextField
                inputRef={inputRef}
                fullWidth
                multiline
                maxRows={4}
                size="small"
                placeholder="Describe your project, ask questions, share ideas..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={loading}
              />
              
              <Button
                variant="contained"
                onClick={() => handleSend()}
                disabled={(!input.trim() && pendingAttachments.length === 0) || loading}
                size="small"
                sx={{ minWidth: 80 }}
                startIcon={loading ? <CircularProgress size={16} /> : <SendIcon />}
              >
                Send
              </Button>

              {/* Show "Generate PRD" button after at least 2 user messages and no PRD yet */}
              {messages.filter(m => m.role === 'user').length >= 2 && !prd && (
                <Tooltip title="Generate PRD and task breakdown from the planning conversation">
                  <Button
                    variant="outlined"
                    color="secondary"
                    onClick={generatePRDAndTasks}
                    disabled={loading}
                    size="small"
                    sx={{ minWidth: 130, whiteSpace: 'nowrap' }}
                    startIcon={loading ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
                  >
                    Generate PRD
                  </Button>
                </Tooltip>
              )}
            </Stack>
          </Box>
        </Paper>

        {/* ── PRD & Tasks Panel (right side, shown when PRD or tasks exist) ── */}
        {hasPrdOrTasks && (
          <Paper
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minWidth: 0,
            }}
            elevation={0}
            variant="outlined"
          >
            {/* Header with tabs */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Tabs
                  value={rightTab}
                  onChange={(_, v) => setRightTab(v)}
                  sx={{
                    minHeight: 42,
                    '& .MuiTab-root': { minHeight: 42, py: 0.5, textTransform: 'none', fontSize: 13 },
                  }}
                >
                  <Tab icon={<ArticleIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="PRD" />
                  <Tab icon={<DashboardIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={`Wireframes${wireframes.length > 0 ? ` (${wireframes.length})` : ''}`} />
                  <Tab icon={<AccountTreeIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Dependency Graph" />
                  <Tab icon={<ListAltIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={`Tasks (${tasks.length})`} />
                </Tabs>

                <Chip
                  icon={<CheckCircleIcon sx={{ fontSize: 14 }} />}
                  label="Ready to build"
                  size="small"
                  color="success"
                  variant="outlined"
                  sx={{ mr: 1 }}
                />
              </Stack>
            </Box>

            {/* Tab content */}
            <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
              {/* ── PRD Tab ── */}
              {rightTab === 0 && (
                <Box sx={{ p: 3 }}>
                  {prd ? (
                    <RichMarkdown content={prd} />
                  ) : (
                    <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
                      <ArticleIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
                      <Typography variant="body2">No PRD generated yet.</Typography>
                    </Box>
                  )}
                </Box>
              )}

              {/* ── Wireframes Tab ── */}
              {rightTab === 1 && (
                <WireframeGallery
                  wireframes={wireframes}
                  onEdit={handleWireframeEdit}
                  onCreate={handleWireframeCreate}
                  onDelete={handleWireframeDelete}
                  onDuplicate={handleWireframeDuplicate}
                />
              )}

              {/* ── Dependency Graph Tab ── */}
              {rightTab === 2 && (
                <Box sx={{ p: 2 }}>
                  {tasks.length > 0 ? (
                    <>
                      {/* Task-type legend */}
                      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2, px: 1 }}>
                        {Object.entries(TASK_TYPE_COLORS).map(([type, color]) => (
                          <Box key={type} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
                            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                              {type}
                            </Typography>
                          </Box>
                        ))}
                      </Box>

                      {/* Interactive dependency graph */}
                      <DependencyGraph tasks={tasks} taskTypeColors={TASK_TYPE_COLORS} />

                      {/* Stats bar */}
                      <Box sx={{
                        mt: 2, p: 1.5, borderRadius: 1.5,
                        bgcolor: alpha(theme.palette.background.default, 0.5),
                        border: '1px solid',
                        borderColor: 'divider',
                        display: 'flex', gap: 3, flexWrap: 'wrap',
                      }}>
                        <Box>
                          <Typography variant="caption" color="text.secondary">Total Tasks</Typography>
                          <Typography variant="subtitle2">{tasks.length}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">Root Tasks</Typography>
                          <Typography variant="subtitle2">
                            {tasks.filter(t => t.dependencies.length === 0).length}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">Max Depth</Typography>
                          <Typography variant="subtitle2">
                            {(() => {
                              const titleToTask = new Map(tasks.map(t => [t.title, t]));
                              const memo = new Map<string, number>();
                              const getDepth = (title: string): number => {
                                if (memo.has(title)) return memo.get(title)!;
                                const task = titleToTask.get(title);
                                if (!task || task.dependencies.length === 0) { memo.set(title, 0); return 0; }
                                const d = 1 + Math.max(...task.dependencies.map(dep => getDepth(dep)));
                                memo.set(title, d);
                                return d;
                              };
                              return Math.max(0, ...tasks.map(t => getDepth(t.title)));
                            })()}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">Highest Priority</Typography>
                          <Typography variant="subtitle2">P{Math.max(...tasks.map(t => t.priority))}</Typography>
                        </Box>
                      </Box>
                    </>
                  ) : (
                    <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
                      <AccountTreeIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
                      <Typography variant="body2">No tasks to visualize.</Typography>
                    </Box>
                  )}
                </Box>
              )}

              {/* ── Task List Tab ── */}
              {rightTab === 3 && (
                <Box sx={{ p: 2 }}>
                  {tasks.length > 0 ? (
                    <Stack spacing={1}>
                      {tasks.map((task, idx) => (
                        <Card
                          key={idx}
                          variant="outlined"
                          sx={{
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            borderColor: selectedTask === idx
                              ? TASK_TYPE_COLORS[task.taskType] || 'primary.main'
                              : 'divider',
                            bgcolor: selectedTask === idx
                              ? alpha(TASK_TYPE_COLORS[task.taskType] || '#818cf8', 0.06)
                              : 'transparent',
                            '&:hover': {
                              borderColor: alpha(TASK_TYPE_COLORS[task.taskType] || '#818cf8', 0.5),
                              bgcolor: alpha(TASK_TYPE_COLORS[task.taskType] || '#818cf8', 0.03),
                            },
                          }}
                          onClick={() => setSelectedTask(selectedTask === idx ? null : idx)}
                        >
                          <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                            <Stack direction="row" alignItems="flex-start" spacing={1.5}>
                              {/* Priority badge */}
                              <Box sx={{
                                minWidth: 32, height: 32, borderRadius: 1,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                bgcolor: alpha(TASK_TYPE_COLORS[task.taskType] || '#818cf8', 0.15),
                                color: TASK_TYPE_COLORS[task.taskType] || '#818cf8',
                                fontWeight: 700, fontSize: 12,
                                flexShrink: 0,
                              }}>
                                P{task.priority}
                              </Box>

                              <Box sx={{ minWidth: 0, flex: 1 }}>
                                <Typography variant="subtitle2" sx={{ lineHeight: 1.3, mb: 0.25 }}>
                                  {task.title}
                                </Typography>

                                {/* Expanded details */}
                                {selectedTask === idx && (
                                  <Box sx={{ mt: 1 }}>
                                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1, lineHeight: 1.5 }}>
                                      {task.description}
                                    </Typography>

                                    {task.dependencies.length > 0 && (
                                      <Box sx={{ mt: 0.75 }}>
                                        <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                          Depends on:
                                        </Typography>
                                        <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.25 }}>
                                          {task.dependencies.map((dep, di) => (
                                            <Chip
                                              key={di}
                                              label={dep}
                                              size="small"
                                              icon={<ArrowForwardIcon />}
                                              sx={{ fontSize: 10, height: 22, '& .MuiChip-icon': { fontSize: 12 } }}
                                              variant="outlined"
                                            />
                                          ))}
                                        </Stack>
                                      </Box>
                                    )}
                                  </Box>
                                )}
                              </Box>

                              {/* Task type chip */}
                              <Chip
                                label={task.taskType}
                                size="small"
                                sx={{
                                  fontSize: 10, height: 20, flexShrink: 0,
                                  bgcolor: alpha(TASK_TYPE_COLORS[task.taskType] || '#818cf8', 0.15),
                                  color: TASK_TYPE_COLORS[task.taskType] || '#818cf8',
                                  fontWeight: 600,
                                  textTransform: 'capitalize',
                                }}
                              />
                            </Stack>
                          </CardContent>
                        </Card>
                      ))}
                    </Stack>
                  ) : (
                    <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
                      <ListAltIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
                      <Typography variant="body2">No tasks generated yet.</Typography>
                    </Box>
                  )}
                </Box>
              )}
            </Box>

            {/* Action buttons (always visible at bottom) */}
            <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
              <Alert
                severity={tasks.length > 0 ? 'success' : 'info'}
                sx={{ mb: 2, py: 0.5 }}
                icon={<AutoAwesomeIcon fontSize="small" />}
              >
                <Typography variant="body2" fontWeight={600}>
                  {tasks.length > 0
                    ? `${tasks.length} tasks ready — keep chatting to refine, or start building`
                    : 'Keep chatting to build out the task tree'}
                </Typography>
              </Alert>
              <Stack direction="row" spacing={2}>
                <Button onClick={onCancel} fullWidth variant="outlined" color="inherit">
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  onClick={() => onComplete(prd, tasks)}
                  fullWidth
                  startIcon={<AutoAwesomeIcon />}
                  size="large"
                  disabled={tasks.length === 0}
                >
                  Start Building
                </Button>
              </Stack>
            </Box>
          </Paper>
        )}
      </Box>

      {/* ── Wireframe Editor Modal ── */}
      <WireframeEditor
        open={wireframeEditorOpen}
        onClose={() => setWireframeEditorOpen(false)}
        onSave={handleWireframeSave}
        wireframe={editingWireframe}
        allWireframes={wireframes}
        existingFeatureTags={existingFeatureTags}
      />
    </Box>
  );
}
