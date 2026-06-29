'use strict';

const {
  KNOWN_CONTROL_CASES,
  validateVdmiMatrix,
  validateVdmiMatrixRow,
} = require('../src/vdmi-matrix-schema');
const { SYSTEM_TEMPLATES } = require('../src/vdmi-system-templates');

describe('vdmi-matrix-schema', () => {
  test('keeps existing VDMI system templates valid without new governance fields', () => {
    for (const template of SYSTEM_TEMPLATES) {
      const result = validateVdmiMatrix({ tasks: template.tasks }, { path: template.id });
      expect(result).toEqual({ valid: true, errors: [] });
    }
  });

  test('validates a technical control-case row with decision metadata', () => {
    const result = validateVdmiMatrixRow({
      taskId: 'redispatch-control-readiness',
      taskName: 'Redispatch Steuerbarkeit pruefen',
      controlCase: 'redispatch',
      verantwortlich: [{ actorType: 'role', actorId: 'REDISPATCH_OPERATOR' }],
      durchfuehrend: [{ actorType: 'role', actorId: 'INSTALLATION_OWNER' }],
      mitwirkend: [],
      information: [],
      evidenceRequirements: [
        'Anlagen-Stammdaten',
        { id: 'control-capability-proof', label: 'Nachweis Fernsteuerbarkeit', type: 'document' },
      ],
      decisionPolicy: {
        onMissingEvidence: 'evidence_gap',
        onConflictingSources: 'clarification',
      },
    });

    expect(KNOWN_CONTROL_CASES).toContain('redispatch');
    expect(result).toEqual({ valid: true, errors: [] });
  });

  test('validates an asset transformation row and the custom extension convention', () => {
    const result = validateVdmiMatrix({
      tasks: [
        {
          taskId: 'asset-validation',
          taskName: 'Asset Transformation fachlich validieren',
          controlCase: 'asset_transformation',
          verantwortlich: [{ actorType: 'role', actorId: 'ASSET_OWNER' }],
          durchfuehrend: [{ actorType: 'role', actorId: 'TECHNICAL_PLANNER' }],
          mitwirkend: [{ actorType: 'role', actorId: 'FINANCE' }],
          information: [{ actorType: 'role', actorId: 'REGULATORY_AFFAIRS' }],
          evidenceRequirements: [{ name: 'Asset-Zustandsbericht' }],
          decisionPolicy: {
            onHighFinancialImpact: 'mandatory_human_decision',
            onMissingEvidence: 'clarification',
          },
        },
        {
          taskId: 'local-special-case',
          taskName: 'Projektlokale Sonderpruefung',
          controlCase: 'project:stuttgart_heat_storage',
          evidenceRequirements: ['Lokaler Freigabevermerk'],
          decisionPolicy: { onMissingEvidence: 'none' },
        },
      ],
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });

  test('rejects invalid controlCase values deterministically', () => {
    expect(validateVdmiMatrixRow({ controlCase: 42 }).errors).toEqual([
      expect.objectContaining({ code: 'invalid_control_case', path: 'row.controlCase' }),
    ]);

    expect(validateVdmiMatrixRow({ controlCase: 'unsupported_case' }).errors).toEqual([
      expect.objectContaining({ code: 'unsupported_control_case', path: 'row.controlCase' }),
    ]);

    expect(validateVdmiMatrixRow({ controlCase: '   ' }).errors).toEqual([
      expect.objectContaining({ code: 'invalid_control_case', path: 'row.controlCase' }),
    ]);
  });

  test('rejects malformed evidence requirements', () => {
    const result = validateVdmiMatrixRow({
      evidenceRequirements: ['', {}, { id: 'ok', type: '' }, 17],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual([
      'invalid_evidence_requirement',
      'invalid_evidence_requirement_identity',
      'invalid_evidence_requirement_type',
      'invalid_evidence_requirement',
    ]);
  });

  test('rejects unsupported decisionPolicy keys and values', () => {
    const result = validateVdmiMatrixRow({
      decisionPolicy: {
        onMissingEvidence: 'invent_evidence',
        onFinancialImpact: 'mandatory_human_decision',
        onConflictingSources: 'evidence_gap',
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'unsupported_decision_policy_value',
        path: 'row.decisionPolicy.onMissingEvidence',
      }),
      expect.objectContaining({
        code: 'unsupported_decision_policy_key',
        path: 'row.decisionPolicy.onFinancialImpact',
      }),
    ]);
  });
});
