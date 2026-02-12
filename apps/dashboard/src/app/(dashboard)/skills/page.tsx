'use client';

import {
  Box, Typography, Grid, Card, CardContent, Button, Chip, Stack, Tabs, Tab,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

const DEMO_SKILLS = [
  { id: '1', name: 'Deploy to AWS ECS', category: 'DevOps', usageCount: 42, createdBy: 'user', active: true },
  { id: '2', name: 'Parse CSV Data', category: 'Data', usageCount: 18, createdBy: 'agent', active: true },
  { id: '3', name: 'Write Unit Tests', category: 'Development', usageCount: 67, createdBy: 'user', active: true },
  { id: '4', name: 'Monitor Stock Price', category: 'Finance', usageCount: 31, createdBy: 'agent', active: true },
];

export default function SkillsPage() {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h2">Skills</Typography>
        <Button variant="contained" startIcon={<AddIcon />}>New Skill</Button>
      </Box>
      <Tabs value={0} sx={{ mb: 3 }}>
        <Tab label="All Skills" />
        <Tab label="Draft Skills" />
      </Tabs>
      <Grid container spacing={2}>
        {DEMO_SKILLS.map((skill) => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={skill.id}>
            <Card sx={{ cursor: 'pointer', '&:hover': { boxShadow: 4 } }}>
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
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
