/**
 * HRMS SSO bootstrap.
 *
 * Trusted HRMS handoff values must be placed in the URL fragment:
 *   #hrms_lms_token=<token>&lms_user_type=<type>
 *
 * Fragments are not sent to web servers or in HTTP referrer headers. The values
 * are removed from browser history immediately after capture.
 */
const STORAGE_KEY_MAP = {
  trainee: 'lms_token_trainee',
  coordinator: 'lms_token_coordinator',
  admin: 'lms_token_admin',
  management: 'lms_token_management',
};

let bootstrapped = false;

export function runSsoBootstrap() {
  if (bootstrapped || typeof window === 'undefined') return;
  bootstrapped = true;

  try {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const params = new URLSearchParams(hash);
    const token = params.get('hrms_lms_token');
    if (!token) return;

    const userType = params.get('lms_user_type') || 'trainee';
    const storageKey = STORAGE_KEY_MAP[userType];
    if (!storageKey) throw new Error('Unsupported LMS SSO user type.');

    localStorage.setItem(storageKey, token);
    params.delete('hrms_lms_token');
    params.delete('lms_user_type');
    const remainingHash = params.toString() ? `#${params.toString()}` : '';
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${remainingHash}`);
  } catch (error) {
    console.warn('[ssoBootstrap] rejected handoff:', error.message);
  }
}
