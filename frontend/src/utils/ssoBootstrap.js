/**
 * HRMS2 SSO Bootstrap
 * Reads hrms_lms_token + lms_user_type from URL query params,
 * stores token in the correct localStorage key, then strips params from URL.
 * Must be called before any LMS route rendering.
 */

const STORAGE_KEY_MAP = {
  trainee: "lms_token_trainee",
  coordinator: "lms_token_coordinator",
  admin: "lms_token_admin",
  management: "lms_token_management",
};

export function runSsoBootstrap() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("hrms_lms_token");
    const userType = params.get("lms_user_type") || "trainee";

    if (!token) return;

    const storageKey = STORAGE_KEY_MAP[userType] || STORAGE_KEY_MAP.trainee;
    localStorage.setItem(storageKey, token);

    // Strip SSO params from URL without reload
    params.delete("hrms_lms_token");
    params.delete("lms_user_type");
    const newSearch = params.toString() ? `?${params.toString()}` : "";
    const cleanUrl = `${window.location.pathname}${newSearch}${window.location.hash}`;
    window.history.replaceState(null, "", cleanUrl);
  } catch (e) {
    // Fail silently — LMS should still load normally
    console.warn("[ssoBootstrap] failed:", e);
  }
}
