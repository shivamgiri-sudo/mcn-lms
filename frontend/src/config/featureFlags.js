/**
 * Feature Flags for LMS Upgrade
 * All flags default to false — flip to true after testing
 * 
 * Usage:
 *   import { isEnabled } from '../config/featureFlags';
 *   if (isEnabled('darkMode')) { ... }
 */

export const FEATURES = {
  // Phase 1: UI Foundation
  newUI: false,           // New component library (ui-v2)
  darkMode: false,        // Dark mode toggle in header
  
  // Phase 2: Gamification
  gamification: false,    // XP, levels, achievements
  streaks: false,         // Daily streak tracking
  leaderboardV2: false,   // Enhanced leaderboard
  
  // Phase 3: Coordinator
  batchTemplates: false,  // Save/clone batch configs
  bulkActions: false,     // Multi-select bulk operations
  riskHeatmap: false,     // At-risk trainee visualization
  
  // Phase 4: Analytics
  execDashboard: false,   // Executive KPI dashboard
  trainingROI: false,     // ROI calculator
  
  // Phase 5: Content
  videoModules: false,    // Embedded video player
  aiQuestions: false,     // AI question generation
  practiceMode: false,    // No-grade practice attempts
  
  // Phase 6: Integrations
  whatsappNotify: false,  // WhatsApp notifications
  calendarSync: false,    // Google/Outlook calendar
  webhookAPI: false,      // External webhook subscriptions
};

/**
 * Check if a feature is enabled
 * Checks localStorage override first, then default
 */
export function isEnabled(flag) {
  if (typeof window === 'undefined') return FEATURES[flag] ?? false;
  
  // Check localStorage override (for testing)
  const override = localStorage.getItem(`lms_ff_${flag}`);
  if (override !== null) return override === 'true';
  
  return FEATURES[flag] ?? false;
}

/**
 * Enable a feature flag (for testing)
 */
export function enableFeature(flag) {
  localStorage.setItem(`lms_ff_${flag}`, 'true');
}

/**
 * Disable a feature flag
 */
export function disableFeature(flag) {
  localStorage.setItem(`lms_ff_${flag}`, 'false');
}

/**
 * Reset feature flag to default
 */
export function resetFeature(flag) {
  localStorage.removeItem(`lms_ff_${flag}`);
}

/**
 * Get all feature flags with current values
 */
export function getAllFlags() {
  return Object.keys(FEATURES).reduce((acc, key) => {
    acc[key] = isEnabled(key);
    return acc;
  }, {});
}
