'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Stack, Divider,
  CircularProgress, Chip, IconButton, Alert, Card, CardContent,
  Grid, Badge, Tooltip, LinearProgress,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ImageIcon from '@mui/icons-material/Image';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DescriptionIcon from '@mui/icons-material/Description';
import CloseIcon from '@mui/icons-material/Close';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import PersonIcon from '@mui/icons-material/Person';

interface PlanningModeProps {
  projectId: string;
  projectName: string;
  onComplete: (prd: string, tasks: ProjectTask[]) => void;
  onCancel: () => void;
}

interface ProjectTask {
  title: string;
  description: string;
  taskType: 'feature' | 'bugfix' | 'test' | 'qa' | 'documentation';
  priority: number;
  dependencies: string[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
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

export default function PlanningMode({ projectId, projectName, onComplete, onCancel }: PlanningModeProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [prd, setPrd] = useState('');
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [readyToBuild, setReadyToBuild] = useState(false);
  const [progress, setProgress] = useState(0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load conversation history
  useEffect(() => {
    loadConversationHistory();
    loadAttachments();
  }, [projectId]);

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

  const handleSend = async () => {
    if ((!input.trim() && pendingAttachments.length === 0) || loading) return;

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
        content: input.trim(),
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
      const aiResponseText = await generateAIResponse(newMessages, uploadedAttachments);
      
      const aiMessage: Message = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: aiResponseText,
        timestamp: new Date(),
      };
      
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
    }
  };

  const generateAIResponse = async (conversationHistory: Message[], newAttachments: Attachment[]) => {
    setProgress(10);

    try {
      // Call memory-based planning API
      const response = await fetch('/api/projects/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          userMessage: conversationHistory[conversationHistory.length - 1].content,
          attachments: newAttachments.map(a => a.id),
        }),
      });

      setProgress(30);

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setProgress(60);

      // Build context info about attachments
      let contextInfo = '';
      if (newAttachments.length > 0) {
        contextInfo = '\n\n**Attachments received:**\n';
        newAttachments.forEach(att => {
          contextInfo += `- ${att.filename} (${att.attachmentType})\n`;
        });
      }

      setProgress(80);

      // Use AI response from server (which used memory-based context)
      const aiResponseText = data.response || await generateFallbackResponse(conversationHistory, contextInfo);

      setProgress(100);

      return aiResponseText;
    } catch (error) {
      console.error('AI generation error:', error);
      // Fallback to client-side simulation if API fails
      return await generateFallbackResponse(conversationHistory, '');
    }
  };

  const generateFallbackResponse = async (conversationHistory: Message[], contextInfo: string): Promise<string> => {
    setProgress(60);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Generate response based on conversation depth
    const userMessageCount = conversationHistory.filter(m => m.role === 'user').length;
    let aiResponse = '';

    // Check if any uploaded attachments include images (use component-level state)
    const hasImageAttachments = attachments.some(a => a.attachmentType === 'image');

    if (userMessageCount === 1) {
      // First response - ask clarifying questions
      aiResponse = `Great! I understand you want to build this application.${contextInfo}

Let me ask a few clarifying questions to better understand your vision:

## Target Audience
- Who are the primary users?
- What problem does this solve for them?

## Core Features
- What are the must-have features for the MVP?
- What features can wait for later versions?

## Technical Constraints
- Any preferred technologies or frameworks?
- Platform requirements (web, mobile, desktop)?
- Any integration requirements?

## Design & UX
${hasImageAttachments ? '- I see you\'ve shared UI references! These are helpful. Should we follow this design style?' : '- Do you have a design system or brand guidelines?'}
- Any specific UX patterns or interactions you want?

Please share as much detail as you'd like - the more I know, the better!`;
    } else if (userMessageCount < 4) {
      // Middle conversation - continue gathering requirements
      aiResponse = `Excellent! This is becoming clearer.${contextInfo}

Based on what you've shared, I'm building a picture of:
- **Primary goal**: [Summarize user's goal]
- **Key features**: [List mentioned features]
- **Target users**: [Describe users]

## Next Questions

To create a comprehensive plan, I'd like to understand:

1. **Data & Storage**: What data needs to be stored? Any specific data models?
2. **Authentication**: Do users need accounts? What login methods?
3. **Performance**: Expected number of users? Any performance requirements?
4. **Deployment**: Where should this be hosted? Any DevOps preferences?

Keep sharing - we're making great progress!`;
    } else {
      // Ready to generate PRD
      aiResponse = `Perfect! I now have a comprehensive understanding of your project.${contextInfo}

Let me generate the **Product Requirements Document (PRD)** and break this down into actionable tasks for the agent swarm.

## Summary

Based on our conversation, here's what we're building:
- **Project**: ${projectName}
- **Goal**: [Synthesized from conversation]
- **Key Features**: [List all discussed features]
- **Tech Stack**: [Proposed stack based on requirements]

## Generating...

Creating detailed PRD and task breakdown now...`;

      // Generate PRD and tasks
      setTimeout(() => {
        generatePRDAndTasks();
      }, 2000);
    }

    setProgress(100);
    return aiResponse;
  };

  const generatePRDAndTasks = () => {
    // Generate comprehensive PRD
    const generatedPRD = `# Product Requirements Document: ${projectName}

## Executive Summary
[Generated from conversation]

## Goals & Objectives
- Primary goal: [From user input]
- Success metrics: [Based on discussion]

## User Stories
[Generated from conversation about users and their needs]

## Functional Requirements
### Must-Have (MVP)
1. [Feature 1 from conversation]
2. [Feature 2 from conversation]

### Nice-to-Have
1. [Future features discussed]

## Technical Specifications
- **Frontend**: [Based on requirements]
- **Backend**: [Based on requirements]
- **Database**: [Based on data needs]
- **Authentication**: [Based on discussion]
- **Hosting**: [Based on preferences]

## Design Requirements
${attachments.some(a => a.attachmentType === 'image') ? '- Follow design patterns from provided mockups' : '- Modern, clean UI following best practices'}

## Success Criteria
- All MVP features implemented
- Test coverage > 80%
- Performance meets requirements
- Deployed and accessible

## Timeline
Estimated completion with agent swarm: [Based on task count]
`;

    setPrd(generatedPRD);

    // Generate tasks
    const generatedTasks: ProjectTask[] = [
      {
        title: 'Project setup and initialization',
        description: 'Initialize project structure, dependencies, and configuration',
        taskType: 'feature',
        priority: 10,
        dependencies: [],
      },
      {
        title: 'Database schema design and implementation',
        description: 'Create database models based on PRD requirements',
        taskType: 'feature',
        priority: 9,
        dependencies: ['Project setup and initialization'],
      },
      {
        title: 'Authentication system',
        description: 'Implement user authentication and authorization',
        taskType: 'feature',
        priority: 9,
        dependencies: ['Database schema design and implementation'],
      },
      {
        title: 'Core API endpoints',
        description: 'Build RESTful API endpoints for core functionality',
        taskType: 'feature',
        priority: 8,
        dependencies: ['Authentication system'],
      },
      {
        title: 'Frontend UI components',
        description: 'Create reusable UI components following design system',
        taskType: 'feature',
        priority: 7,
        dependencies: ['Project setup and initialization'],
      },
      {
        title: 'Integration testing',
        description: 'Write integration tests for all features',
        taskType: 'test',
        priority: 6,
        dependencies: ['Core API endpoints', 'Frontend UI components'],
      },
      {
        title: 'Code documentation',
        description: 'Add comprehensive inline documentation',
        taskType: 'documentation',
        priority: 4,
        dependencies: ['Core API endpoints'],
      },
    ];

    setTasks(generatedTasks);
    setReadyToBuild(true);

    // Add final message
    const finalMessage: Message = {
      id: `final-${Date.now()}`,
      role: 'assistant',
      content: `## ✅ PRD Complete!

I've generated a comprehensive Product Requirements Document and broken it down into **${generatedTasks.length} actionable tasks**.

### What Happens Next

When you click **"Start Building"**:
1. **Agent swarm launches** - Multiple AI agents will start working in parallel
2. **Autonomous execution** - Agents will work continuously until complete
3. **Real-time monitoring** - You can watch progress as they work
4. **Quality assurance** - Specialized QA agents will test everything

The swarm will run autonomously - this could take hours or days depending on complexity. You can pause anytime and resume later.

**Ready to bring your vision to life?**`,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, finalMessage]);
  };

  const getAttachmentIcon = (type: string) => {
    switch (type) {
      case 'image': return <ImageIcon />;
      case 'pdf': return <PictureAsPdfIcon />;
      case 'document': return <DescriptionIcon />;
      default: return <AttachFileIcon />;
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {progress > 0 && (
        <LinearProgress variant="determinate" value={progress} sx={{ height: 2 }} />
      )}

      <Box sx={{ display: 'flex', gap: 2, flexGrow: 1, overflow: 'hidden' }}>
        {/* Chat Interface */}
        <Paper sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Messages */}
          <Box sx={{ flexGrow: 1, overflow: 'auto', p: 3 }}>
            {messages.map((msg) => (
              <Box
                key={msg.id}
                sx={{
                  mb: 3,
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <Paper
                  sx={{
                    p: 2,
                    maxWidth: '75%',
                    bgcolor: msg.role === 'user' ? 'primary.main' : 'background.paper',
                    color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                    borderRadius: 2,
                  }}
                  elevation={msg.role === 'user' ? 3 : 1}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    {msg.role === 'assistant' ? <SmartToyIcon fontSize="small" /> : <PersonIcon fontSize="small" />}
                    <Typography variant="caption" fontWeight={600}>
                      {msg.role === 'assistant' ? 'AI Planning Agent' : 'You'}
                    </Typography>
                  </Box>
                  
                  <Typography
                    variant="body1"
                    sx={{ whiteSpace: 'pre-wrap', '& h1': { fontSize: '1.5rem', mt: 2, mb: 1 }, '& h2': { fontSize: '1.25rem', mt: 2, mb: 1 } }}
                    component="div"
                  >
                    {msg.content.split('\n').map((line, i) => {
                      if (line.startsWith('# ')) return <Typography key={i} variant="h5" gutterBottom>{line.slice(2)}</Typography>;
                      if (line.startsWith('## ')) return <Typography key={i} variant="h6" gutterBottom sx={{ mt: 2 }}>{line.slice(3)}</Typography>;
                      if (line.startsWith('- ')) return <Typography key={i} component="li" sx={{ ml: 2 }}>{line.slice(2)}</Typography>;
                      return <Typography key={i}>{line || ' '}</Typography>;
                    })}
                  </Typography>

                  {msg.attachments && msg.attachments.length > 0 && (
                    <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {msg.attachments.map((att) => (
                        <Chip
                          key={att.id}
                          icon={getAttachmentIcon(att.attachmentType)}
                          label={att.filename}
                          size="small"
                          variant="outlined"
                        />
                      ))}
                    </Box>
                  )}
                </Paper>
              </Box>
            ))}
            
            {loading && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <CircularProgress size={20} />
                <Typography variant="body2" color="text.secondary">
                  {uploading ? 'Uploading files...' : 'AI is thinking...'}
                </Typography>
              </Box>
            )}
            
            <div ref={messagesEndRef} />
          </Box>

          {/* Input Area */}
          <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
            {pendingAttachments.length > 0 && (
              <Box sx={{ mb: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
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
            
            <Stack direction="row" spacing={1}>
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
                  disabled={loading || readyToBuild}
                >
                  <Badge badgeContent={pendingAttachments.length} color="primary">
                    <AttachFileIcon />
                  </Badge>
                </IconButton>
              </Tooltip>
              
              <TextField
                fullWidth
                multiline
                maxRows={4}
                placeholder="Describe your project, ask questions, share ideas..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={loading || readyToBuild}
              />
              
              <Button
                variant="contained"
                onClick={handleSend}
                disabled={(!input.trim() && pendingAttachments.length === 0) || loading || readyToBuild}
                sx={{ minWidth: 100 }}
                startIcon={loading ? <CircularProgress size={20} /> : <SendIcon />}
              >
                Send
              </Button>
            </Stack>
          </Box>
        </Paper>

        {/* Tasks Preview (shown when ready) */}
        {readyToBuild && tasks.length > 0 && (
          <Paper sx={{ width: 400, overflow: 'auto', p: 2 }}>
            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CheckCircleIcon color="success" />
              Ready to Build
            </Typography>
            <Divider sx={{ mb: 2 }} />
            
            <Alert severity="success" sx={{ mb: 2 }}>
              <Typography variant="body2" fontWeight={600}>
                {tasks.length} tasks generated
              </Typography>
              <Typography variant="caption">
                Agent swarm will work autonomously
              </Typography>
            </Alert>

            <Typography variant="subtitle2" gutterBottom>
              Task Breakdown
            </Typography>
            <Stack spacing={1}>
              {tasks.map((task, idx) => (
                <Card key={idx} variant="outlined">
                  <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="subtitle2" gutterBottom>
                      {task.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {task.description}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, mt: 1 }}>
                      <Chip label={task.taskType} size="small" />
                      <Chip label={`P${task.priority}`} size="small" color="primary" />
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Stack>

            <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
              <Button onClick={onCancel} fullWidth>
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={() => onComplete(prd, tasks)}
                fullWidth
                startIcon={<AutoAwesomeIcon />}
              >
                Start Building
              </Button>
            </Stack>
          </Paper>
        )}
      </Box>
    </Box>
  );
}
