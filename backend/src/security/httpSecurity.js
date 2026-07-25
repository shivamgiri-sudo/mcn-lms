function splitSources(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function uniqueSources(...groups) {
  return [...new Set(groups.flat().filter(Boolean))];
}

function safeSource(source) {
  return /^'(?:self|none|unsafe-inline|unsafe-eval|strict-dynamic)'$/.test(source)
    || /^(?:https?:|wss?:|data:|blob:)$/.test(source)
    || /^(?:https?|wss):\/\/[^\s;/]+(?::\d+)?$/.test(source);
}

function validatedSources(name, value) {
  const sources = splitSources(value);
  const invalid = sources.filter(source => !safeSource(source));
  if (invalid.length) throw new Error(`${name} contains invalid CSP sources: ${invalid.join(', ')}`);
  return sources;
}

export function buildHttpSecurityPolicy(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const frameAncestors = uniqueSources(["'self'"], validatedSources('CSP_FRAME_ANCESTORS', env.CSP_FRAME_ANCESTORS));
  const connectSrc = uniqueSources(["'self'"], validatedSources('CSP_CONNECT_SRC', env.CSP_CONNECT_SRC));
  const imgSrc = uniqueSources(["'self'", 'data:', 'blob:', 'https:'], validatedSources('CSP_IMG_SRC', env.CSP_IMG_SRC));
  const mediaSrc = uniqueSources(["'self'", 'blob:', 'https:'], validatedSources('CSP_MEDIA_SRC', env.CSP_MEDIA_SRC));
  const frameSrc = uniqueSources(
    ["'self'"],
    validatedSources('CSP_FRAME_SRC', env.CSP_FRAME_SRC),
    validatedSources('SCORM_CONTENT_ORIGIN', env.SCORM_CONTENT_ORIGIN),
  );

  const hasExternalFrameAncestor = frameAncestors.some(source => source !== "'self'");
  const directives = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors,
    scriptSrc: ["'self'"],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc,
    fontSrc: ["'self'", 'data:', 'https:'],
    connectSrc,
    mediaSrc,
    frameSrc,
    workerSrc: ["'self'", 'blob:'],
    manifestSrc: ["'self'"],
    formAction: ["'self'"],
  };
  if (production) directives.upgradeInsecureRequests = [];

  return {
    crossOriginResourcePolicy: { policy: 'same-site' },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    contentSecurityPolicy: { useDefaults: false, directives },
    frameguard: hasExternalFrameAncestor ? false : { action: 'sameorigin' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: production
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xDownloadOptions: true,
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
  };
}

export function securityPolicySummary(env = process.env) {
  const policy = buildHttpSecurityPolicy(env);
  const directives = policy.contentSecurityPolicy.directives;
  return {
    production: env.NODE_ENV === 'production',
    frameAncestors: directives.frameAncestors,
    connectSrc: directives.connectSrc,
    frameSrc: directives.frameSrc,
    frameguard: Boolean(policy.frameguard),
    hsts: Boolean(policy.strictTransportSecurity),
  };
}
