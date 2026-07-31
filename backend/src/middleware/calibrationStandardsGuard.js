function isEvaluatorSelfPath(req) {
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  return /^\/api\/calibration\/coordinator\/assignments\/[^/]+(?:\/submit)?$/.test(path)
    || /^\/api\/calibration\/admin\/assignments\/[^/]+\/self(?:\/submit)?$/.test(path);
}

function redactExpectedScores(detail) {
  if (!detail || !['ASSIGNED', 'IN_PROGRESS'].includes(String(detail.status))) return detail;
  const program = detail.program;
  if (!program) return detail;
  return {
    ...detail,
    program: {
      ...program,
      anchors: (program.anchors || []).map(anchor => ({
        ...anchor,
        evaluatorNotes: null,
        expectedScores: (anchor.expectedScores || []).map(expected => ({
          criterionId: expected.criterionId,
        })),
      })),
    },
  };
}

export function calibrationStandardsGuard(req, res, next) {
  if (!isEvaluatorSelfPath(req)) return next();
  const originalJson = res.json.bind(res);
  res.json = payload => {
    if (payload?.ok !== false && payload?.data) {
      return originalJson({ ...payload, data: redactExpectedScores(payload.data) });
    }
    return originalJson(payload);
  };
  return next();
}
