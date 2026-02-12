'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  Box, Typography, useMediaQuery, useTheme,
  BottomNavigation, BottomNavigationAction, Paper,
} from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import DashboardIcon from '@mui/icons-material/Dashboard';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import ScheduleIcon from '@mui/icons-material/Schedule';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import MemoryIcon from '@mui/icons-material/Memory';
import LockIcon from '@mui/icons-material/Lock';
import DnsIcon from '@mui/icons-material/Dns';
import GroupIcon from '@mui/icons-material/Group';
import SettingsIcon from '@mui/icons-material/Settings';
import MenuIcon from '@mui/icons-material/Menu';

const DRAWER_WIDTH = 240;
const MINI_WIDTH = 72;

const navItems = [
  { label: 'Chat', icon: <ChatIcon />, path: '/chat' },
  { label: 'Boards', icon: <DashboardIcon />, path: '/boards' },
  { label: 'Agents', icon: <SmartToyIcon />, path: '/agents' },
  { label: 'Schedules', icon: <ScheduleIcon />, path: '/schedules' },
  { label: 'Skills', icon: <AutoFixHighIcon />, path: '/skills' },
  { label: 'Memory', icon: <MemoryIcon />, path: '/memory' },
  { label: 'Secrets', icon: <LockIcon />, path: '/secrets' },
  { label: 'Workers', icon: <DnsIcon />, path: '/workers' },
  { label: 'Team', icon: <GroupIcon />, path: '/team' },
  { label: 'Settings', icon: <SettingsIcon />, path: '/settings' },
];

export default function Sidebar() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isTablet = useMediaQuery(theme.breakpoints.between('md', 'lg'));
  const pathname = usePathname();
  const router = useRouter();
  const [mobileValue, setMobileValue] = useState(0);

  if (isMobile) {
    const mobileItems = navItems.slice(0, 4);
    return (
      <Paper
        sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1200, pb: 'env(safe-area-inset-bottom)' }}
        elevation={3}
      >
        <BottomNavigation
          value={mobileValue}
          onChange={(_, newValue) => {
            setMobileValue(newValue);
            if (newValue < mobileItems.length) {
              router.push(mobileItems[newValue].path);
            }
          }}
          showLabels
        >
          {mobileItems.map((item) => (
            <BottomNavigationAction key={item.path} label={item.label} icon={item.icon} />
          ))}
          <BottomNavigationAction label="More" icon={<MenuIcon />} />
        </BottomNavigation>
      </Paper>
    );
  }

  const mini = isTablet;

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: mini ? MINI_WIDTH : DRAWER_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: mini ? MINI_WIDTH : DRAWER_WIDTH,
          boxSizing: 'border-box',
          borderRight: '1px solid',
          borderColor: 'divider',
          transition: 'width 0.2s',
        },
      }}
    >
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <SmartToyIcon color="primary" />
        {!mini && <Typography variant="h6" fontWeight={700}>AI Engine</Typography>}
      </Box>
      <List sx={{ px: 1 }}>
        {navItems.map((item) => (
          <ListItemButton
            key={item.path}
            selected={pathname?.startsWith(item.path)}
            onClick={() => router.push(item.path)}
            sx={{
              borderRadius: 2,
              mb: 0.5,
              minHeight: 44,
              justifyContent: mini ? 'center' : 'initial',
              px: mini ? 2 : 2.5,
            }}
          >
            <ListItemIcon sx={{ minWidth: mini ? 0 : 40, justifyContent: 'center' }}>
              {item.icon}
            </ListItemIcon>
            {!mini && <ListItemText primary={item.label} />}
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  );
}
