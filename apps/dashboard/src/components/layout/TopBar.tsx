'use client';

import {
  AppBar, Toolbar, Typography, IconButton, Badge, Avatar, Box, useMediaQuery, useTheme,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import SearchIcon from '@mui/icons-material/Search';
import SmartToyIcon from '@mui/icons-material/SmartToy';

export default function TopBar() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  return (
    <AppBar
      position="fixed"
      color="inherit"
      elevation={0}
      sx={{ borderBottom: '1px solid', borderColor: 'divider', zIndex: (t) => t.zIndex.drawer + 1 }}
    >
      <Toolbar sx={{ gap: 1, minHeight: { xs: 56, sm: 64 } }}>
        {isMobile && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SmartToyIcon color="primary" />
            <Typography variant="h6" fontWeight={700}>AI Engine</Typography>
          </Box>
        )}

        <Box sx={{ flex: 1 }} />

        <IconButton size="large" aria-label="search">
          <SearchIcon />
        </IconButton>

        <IconButton size="large" aria-label="notifications">
          <Badge badgeContent={3} color="error">
            <NotificationsIcon />
          </Badge>
        </IconButton>

        <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', cursor: 'pointer' }}>
          A
        </Avatar>
      </Toolbar>
    </AppBar>
  );
}
