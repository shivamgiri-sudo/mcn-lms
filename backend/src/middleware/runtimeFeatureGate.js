import { requireSession } from './auth.js';
import { evaluateFeatureFlag } from '../services/runtimeGovernance.js';

async function enforce(featureKey, req, res, next) {
  try {
    const decision = await evaluateFeatureFlag(featureKey, {
      userId: req.userId,
      branch: req.userBranch,
      processName: req.userProcess,
      lobName: req.userLob,
    });
    req.featureDecisions = { ...(req.featureDecisions || {}), [featureKey]: decision };
    res.setHeader(`X-LMS-Feature-${featureKey.replace(/[^a-z0-9]/gi, '-')}`, decision.enabled ? 'enabled' : 'disabled');
    if (!decision.enabled) {
      return res.status(503).json({
        ok: false,
        code: 'FEATURE_UNAVAILABLE',
        featureKey,
        reason: decision.reason,
        message: 'This LMS capability is not currently available for your rollout scope.',
      });
    }
    return next();
  } catch (error) {
    console.error(`[FEATURE-GATE] ${featureKey}:`, error.message);
    return res.status(503).json({
      ok: false,
      code: 'FEATURE_DECISION_FAILED',
      featureKey,
      message: 'Feature rollout decision could not be verified.',
    });
  }
}

export function calibrationFeatureGate(req, res, next) {
  if (/^\/certificates\/verify\//.test(String(req.path || ''))) return next();
  return requireSession(req, res, () => {
    enforce('evaluator_quality', req, res, () => {
      if (String(req.path || '').includes('/governance/')) {
        return enforce('calibration_appeals', req, res, next);
      }
      return next();
    });
  });
}
