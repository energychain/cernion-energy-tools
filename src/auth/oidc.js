'use strict';

function validateOidcConfig(config) {
  const cfg = config && typeof config === 'object' ? config : {};
  const required = ['issuer', 'clientId', 'authorizationEndpoint', 'redirectUri'];
  const missing = required.filter((key) => !String(cfg[key] || '').trim());

  if (missing.length > 0) {
    const error = new Error(`OIDC config invalid. Missing: ${missing.join(', ')}`);
    error.code = 'OIDC_CONFIG_INVALID';
    throw error;
  }

  return {
    issuer: String(cfg.issuer).trim(),
    clientId: String(cfg.clientId).trim(),
    authorizationEndpoint: String(cfg.authorizationEndpoint).trim(),
    redirectUri: String(cfg.redirectUri).trim(),
    scope: String(cfg.scope || 'openid profile email groups').trim(),
  };
}

function buildAuthorizationUrl(config, options = {}) {
  const cfg = validateOidcConfig(config);
  const url = new URL(cfg.authorizationEndpoint);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', String(options.scope || cfg.scope).trim());
  if (options.state) url.searchParams.set('state', String(options.state));
  if (options.nonce) url.searchParams.set('nonce', String(options.nonce));

  // TODO(v0.48.x): replace with openid-client flow (discovery, PKCE, token exchange, ID token validation).
  return url.toString();
}

module.exports = {
  validateOidcConfig,
  buildAuthorizationUrl,
};
