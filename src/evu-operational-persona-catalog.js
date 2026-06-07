'use strict';

/**
 * Deklarativer Katalog der operativen EVU-/Energiedienstleister-Standard-Personas.
 *
 * Jeder Eintrag beschreibt genau eine Standardrolle. Die IDs sind deterministisch
 * (Schema: evu-<roleKey>) und tenant-neutral — beim Seed werden sie in den Ziel-
 * Tenant kopiert. Die Rollen-Strings in assignedRoles sind die kanonischen Werte,
 * die in resolveByRole und notification.dispatch als responsibleRole genutzt werden.
 *
 * Kein tenant-spezifischer Code, keine Prompts, keine Kundendaten.
 */

const CATALOG = [
  {
    roleKey: 'customer-service',
    defaultId: 'evu-customer-service',
    personaName: 'Kundendienst',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-customer-service' },
  },
  {
    roleKey: 'complaint-management',
    defaultId: 'evu-complaint-management',
    personaName: 'Beschwerdemanagement',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-complaint-management' },
  },
  {
    roleKey: 'sales',
    defaultId: 'evu-sales',
    personaName: 'Vertrieb',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-sales' },
  },
  {
    roleKey: 'key-account',
    defaultId: 'evu-key-account',
    personaName: 'Key Account Management',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-key-account' },
  },
  {
    roleKey: 'mako',
    defaultId: 'evu-mako',
    personaName: 'Marktkommunikation (MaKo)',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-mako' },
  },
  {
    roleKey: 'edm',
    defaultId: 'evu-edm',
    personaName: 'Energiedatenmanagement (EDM)',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-edm' },
  },
  {
    roleKey: 'billing',
    defaultId: 'evu-billing',
    personaName: 'Abrechnung',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-billing' },
  },
  {
    roleKey: 'metering-operations',
    defaultId: 'evu-metering-operations',
    personaName: 'Messstellenbetrieb',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-metering-operations' },
  },
  {
    roleKey: 'grid-operations',
    defaultId: 'evu-grid-operations',
    personaName: 'Netzbetrieb',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-grid-operations' },
  },
  {
    roleKey: 'grid-planning',
    defaultId: 'evu-grid-planning',
    personaName: 'Netzplanung',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-grid-planning' },
  },
  {
    roleKey: 'asset-management',
    defaultId: 'evu-asset-management',
    personaName: 'Asset Management',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-asset-management' },
  },
  {
    roleKey: 'redispatch',
    defaultId: 'evu-redispatch',
    personaName: 'Redispatch',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-redispatch' },
  },
  {
    roleKey: 'project-development',
    defaultId: 'evu-project-development',
    personaName: 'Projektentwicklung',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-project-development' },
  },
  {
    roleKey: 'product-development',
    defaultId: 'evu-product-development',
    personaName: 'Produktentwicklung',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-product-development' },
  },
  {
    roleKey: 'regulatory',
    defaultId: 'evu-regulatory',
    personaName: 'Regulierung',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-regulatory' },
  },
  {
    roleKey: 'management',
    defaultId: 'evu-management',
    personaName: 'Geschaeftsfuehrung',
    personaType: 'specialized-agent',
    communicationChannel: { type: 'openclaw-chat', address: 'ops-management' },
  },
];

/** Indexed by roleKey for O(1) lookup. */
const CATALOG_BY_ROLE = new Map(CATALOG.map((entry) => [entry.roleKey, entry]));

/** Ordered list of all canonical role keys. */
const ALL_ROLE_KEYS = CATALOG.map((entry) => entry.roleKey);

module.exports = { CATALOG, CATALOG_BY_ROLE, ALL_ROLE_KEYS };
