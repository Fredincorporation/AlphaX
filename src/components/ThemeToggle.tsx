import React from 'react';
import { useMediatorStore } from '../store/useMediatorStore';
import { Sun, Moon } from 'lucide-react';

export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useMediatorStore();
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/60 transition-all flex items-center justify-center relative group"
      title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      aria-label="Toggle Theme"
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-amber-400 group-hover:rotate-45 transition-transform duration-300" />
      ) : (
        <Moon className="h-4 w-4 text-cyan-600 group-hover:-rotate-12 transition-transform duration-300" />
      )}
    </button>
  );
};
