'use strict';

function validateSamlConfig(config) {
  const cfg = config && typeof config === 'object' ? config : {};
  const required = ['entryPoint', 'issuer', 'callbackUrl'];
  const missing = required.filter((key) => !String(cfg[key] || '').trim());

  if (missing.length > 0) {
    const error = new Error(`SAML config invalid. Missing: ${missing.join(', ')}`);
    error.code = 'SAML_CONFIG_INVALID';
    throw error;
  }

  return {
    entryPoint: String(cfg.entryPoint).trim(),
    issuer: String(cfg.issuer).trim(),
    callbackUrl: String(cfg.callbackUrl).trim(),
    cert: String(cfg.cert || '').trim() || null,
  };
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return [String(value).trim()].filter(Boolean);
}

// TODO: this trusts the caller-supplied ACS payload as-is — it does not parse or verify
// a real SAML assertion (no XML signature check, no issuer/audience/condition validation).
// A production integration needs a library like `samlify` or `passport-saml` doing real
// assertion verification before claims are extracted. Until then, the callback this feeds
// only runs under AUTH_FOUNDATION_MODE=true (see services/auth.service.js) and is disabled
// by default in production.
function extractClaimsFromAcsPayload(payload = {}) {
  const profile = payload && typeof payload === 'object' ? payload : {};

  const sub =
    profile.nameID ||
    profile.NameID ||
    profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'] ||
    profile.email ||
    null;

  const email =
    profile.email ||
    profile.mail ||
    profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] ||
    null;

  return {
    sub,
    email,
    name:
      profile.name ||
      profile.displayName ||
      profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ||
      null,
    groups: toArray(profile.groups || profile['http://schemas.xmlsoap.org/claims/Group']),
    roles: toArray(profile.roles),
  };
}

module.exports = {
  validateSamlConfig,
  extractClaimsFromAcsPayload,
};
