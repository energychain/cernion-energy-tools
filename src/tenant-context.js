/**
 * Tenant Context — Cernion Energy Tools v0.38.0
 *
 * Stellt Namespace-Isolation für Multi-Tenant-Betrieb bereit.
 * Rückwärtskompatibel: ohne tenantId läuft alles wie bisher.
 *
 * Hinweis: tenantNamespace() erzeugt Strings der Form
 * 'tenant:{tenantId}:{base}'. Diese können erst dann direkt
 * an object-store.* übergeben werden, wenn NS_PATTERN in
 * object-store.service.js um Doppelpunkte und Bindestriche
 * erweitert wird (folgt in einer späteren Iteration).
 * Für den CYA-PoC (v0.38.0) werden die Namespace-Strings
 * bereits korrekt erzeugt und in Tests validiert.
 */

'use strict';

const DEFAULT_TENANT = 'default';

/**
 * Extrahiert tenantId aus Moleculer ctx.meta.
 * Gibt DEFAULT_TENANT zurück wenn kein tenantId gesetzt ist.
 *
 * @param {object|null} ctx  Moleculer Context
 * @returns {string}
 */
function getTenantId(ctx) {
  return ctx?.meta?.tenantId || DEFAULT_TENANT;
}

/**
 * Baut einen namespace-isolierten Namespace-String.
 *
 * Mit tenantId:   'tenant:stadtwerk-a:cya_profiles'
 * Ohne tenantId:  'cya_profiles' (identisch zu bisherigem Verhalten)
 *
 * @param {string} baseNamespace  z.B. 'cya_profiles'
 * @param {string} tenantId
 * @returns {string}
 */
function tenantNamespace(baseNamespace, tenantId) {
  if (!tenantId || tenantId === DEFAULT_TENANT) return baseNamespace;
  return `tenant:${tenantId}:${baseNamespace}`;
}

/**
 * Baut einen namespace-isolierten Object-Store-Key.
 *
 * Mit tenantId:   'stadtwerk-a:my-profile'
 * Ohne tenantId:  'my-profile' (unverändert)
 *
 * @param {string} baseKey
 * @param {string} tenantId
 * @returns {string}
 */
function tenantKey(baseKey, tenantId) {
  if (!tenantId || tenantId === DEFAULT_TENANT) return baseKey;
  return `${tenantId}:${baseKey}`;
}

/**
 * Liste erlaubter Tenants aus der Umgebung.
 * CERNION_ALLOWED_TENANTS = comma-separated, e.g. "default,public,agentic-hackathon"
 * Wenn nicht gesetzt (oder leer), sind alle formatgültigen Tenants erlaubt
 * (Rückwärtskompatibilität).
 */
const ALLOWED_TENANTS = (() => {
  const raw = process.env.CERNION_ALLOWED_TENANTS || '';
  if (!raw.trim()) return null; // no restriction
  const list = raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  return new Set(list);
})();

/**
 * Prüft, ob ein Tenant in der Installations-Allowlist steht.
 * Gibt true zurück, wenn kein CERNION_ALLOWED_TENANTS gesetzt ist.
 *
 * @param {string|null|undefined} tenantId
 * @returns {boolean}
 */
function isTenantAllowed(tenantId) {
  if (!ALLOWED_TENANTS) return true; // unrestricted
  if (!tenantId) return true; // default handled elsewhere
  return ALLOWED_TENANTS.has(tenantId.toLowerCase());
}

/**
 * Validiert eine tenantId.
 * Erlaubt: a–z, 0–9, Bindestrich; max. 64 Zeichen.
 * Gibt true zurück wenn tenantId leer/null (optional).
 * Wirft Error mit Code INVALID_TENANT_ID bei ungültigem Wert.
 *
 * @param {string|null|undefined} tenantId
 * @returns {true}
 */
function validateTenantId(tenantId) {
  if (!tenantId) return true; // optional
  if (!/^[a-z0-9-]{1,64}$/.test(tenantId)) {
    const err = new Error(
      `INVALID_TENANT_ID: '${tenantId}' — nur a-z, 0-9, - erlaubt, max 64 Zeichen`
    );
    err.code = 'INVALID_TENANT_ID';
    throw err;
  }
  return true;
}

module.exports = {
  getTenantId,
  tenantNamespace,
  tenantKey,
  validateTenantId,
  isTenantAllowed,
  DEFAULT_TENANT,
};
