import { Box } from '@mui/material';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <TopBar />
      <Sidebar />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          // Top padding accounts for the fixed AppBar height
          pt: { xs: '56px', sm: '64px' },
          // Bottom padding for the mobile bottom nav
          pb: { xs: '80px', md: 0 },
          maxWidth: '100%',
          overflow: 'auto',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
