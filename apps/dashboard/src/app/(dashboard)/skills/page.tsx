'use client';

import { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Chip, Stack, Tabs, Tab,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';

interface Skill {
  id: string;
  name: string;
  category: string;
  usageCount: number;
  createdBy: string;
  isActive: boolean;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    fetch('/api/skills')
      .then((res) => res.json())
      .then((data) => setSkills(data.skills ?? []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = tab === 0 ? skills : skills.filter((s) => !s.isActive);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Skills</Typography>
        <Button variant="contained" startIcon={<AddIcon />}>New Skill</Button>
      </Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label={`All Skills (${skills.length})`} />
        <Tab label="Drafts" />
      </Tabs>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && filtered.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <AutoFixHighIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6">No skills yet</Typography>
          <Typography variant="body2">Skills are reusable patterns that agents can discover and execute.</Typography>
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr', lg: '1fr 1fr 1fr 1fr' }, gap: 2 }}>
        {filtered.map((skill) => (
          <Card key={skill.id} sx={{ cursor: 'pointer', '&:hover': { boxShadow: 4 } }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600}>{skill.name}</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Chip label={skill.category} size="small" variant="outlined" />
                <Chip label={`${skill.usageCount} uses`} size="small" />
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Created by {skill.createdBy}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>
    </Box>
  );
}
