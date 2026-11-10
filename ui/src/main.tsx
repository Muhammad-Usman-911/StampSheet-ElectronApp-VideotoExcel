import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'next-themes';
import { MotionConfig } from 'motion/react';
import '@fontsource-variable/inter';
import './index.css';
import App from './App';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={250}>
          <App />
          <Toaster position="top-center" offset={72} richColors closeButton />
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  </StrictMode>,
);
