'use client';

import { useState, useEffect } from 'react';
import {
  AppBar, Toolbar, Typography, IconButton, Badge, Avatar, Box, useMediaQuery, useTheme,
  Menu, MenuItem, ListItemIcon, Divider, Tooltip,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import SearchIcon from '@mui/icons-material/Search';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/Person';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { useDashboardWS } from '@/hooks/useDashboardWS';

export default function TopBar() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [userName, setUserName] = useState('A');
  const [userEmail, setUserEmail] = useState('');

  // Establish WebSocket connection as soon as any dashboard page loads.
  // The singleton manager keeps a single connection regardless of how many
  // components also call useDashboardWS (chat, planning, etc.).
  const { connected: wsConnected } = useDashboardWS();

  useEffect(() => {
    try {
      const stored = localStorage.getItem('ai-engine-user');
      if (stored) {
        const user = JSON.parse(stored);
        setUserName(user.displayName?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || 'A');
        setUserEmail(user.email || '');
      }
    } catch { /* ignore */ }
  }, []);

  const handleSignOut = () => {
    localStorage.removeItem('ai-engine-token');
    localStorage.removeItem('ai-engine-user');
    document.cookie = 'ai-engine-token=; path=/; max-age=0';
    window.location.href = '/login';
  };

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

        <Tooltip title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}>
          <FiberManualRecordIcon
            sx={{
              fontSize: 10,
              color: wsConnected ? 'success.main' : 'text.disabled',
              transition: 'color 0.3s ease',
            }}
          />
        </Tooltip>

        <IconButton size="large" aria-label="search">
          <SearchIcon />
        </IconButton>

        <IconButton size="large" aria-label="notifications">
          <Badge badgeContent={0} color="error">
            <NotificationsIcon />
          </Badge>
        </IconButton>

        <Avatar
          sx={{ width: 32, height: 32, bgcolor: 'primary.main', cursor: 'pointer', fontSize: 14 }}
          onClick={(e) => setAnchorEl(e.currentTarget)}
        >
          {userName}
        </Avatar>

        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={() => setAnchorEl(null)}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        >
          {userEmail && (
            <MenuItem disabled>
              <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>
              <Typography variant="body2">{userEmail}</Typography>
            </MenuItem>
          )}
          {userEmail && <Divider />}
          <MenuItem onClick={handleSignOut}>
            <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
            Sign Out
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
