/**
 * MCN LMS UI Components (v2)
 * Phase 1: UI Foundation
 * 
 * Usage:
 *   import { Button, Card, Badge, LinearProgress } from '../components/ui-v2';
 * 
 * Note: These components are additive - existing components unchanged
 */

// Design tokens (import in main.jsx)
import './tokens.css';

// Components
export { Button } from './Button';
export { Card, CardHeader, GlassCard } from './Card';
export { Badge, StatusBadge } from './Badge';
export { LinearProgress, RadialProgress, XPBar } from './Progress';

// Re-export everything as default object for convenience
import { Button } from './Button';
import { Card, CardHeader, GlassCard } from './Card';
import { Badge, StatusBadge } from './Badge';
import { LinearProgress, RadialProgress, XPBar } from './Progress';

export default {
  Button,
  Card,
  CardHeader,
  GlassCard,
  Badge,
  StatusBadge,
  LinearProgress,
  RadialProgress,
  XPBar,
};
export { ThemeProvider, useTheme, ThemeToggle } from './ThemeProvider';
