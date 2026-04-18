'use strict';

const {
  PROFILE_TEMPLATES,
  getTemplate,
  listTemplates,
} = require('../src/cya-profile-templates');

describe('cya-profile-templates', () => {
  it('PROFILE_TEMPLATES has at least 6 entries', () => {
    expect(Object.keys(PROFILE_TEMPLATES).length).toBeGreaterThanOrEqual(6);
  });

  it('each template has required fields', () => {
    const templates = Object.values(PROFILE_TEMPLATES);
    templates.forEach((template) => {
      expect(template).toHaveProperty('templateId');
      expect(template).toHaveProperty('name');
      expect(template).toHaveProperty('actor');
      expect(template.actor).toHaveProperty('role');
      expect(Array.isArray(template.strategic_goals)).toBe(true);
      expect(template.strategic_goals.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('getTemplate(vnb_defensiv) returns template', () => {
    const template = getTemplate('vnb_defensiv');
    expect(template).toBeTruthy();
    expect(template.templateId).toBe('vnb_defensiv');
  });

  it('getTemplate(nonexistent) returns null', () => {
    expect(getTemplate('nonexistent')).toBeNull();
  });

  it('listTemplates returns 6+ template IDs', () => {
    const templateIds = listTemplates();
    expect(Array.isArray(templateIds)).toBe(true);
    expect(templateIds.length).toBeGreaterThanOrEqual(6);
  });
});
