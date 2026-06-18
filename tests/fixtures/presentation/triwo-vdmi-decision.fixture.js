'use strict';

module.exports = {
  intent: 'vdmi_role_boundary_governance',
  audience: 'management',
  preferredFormat: 'auto',
  domainResult: {
    matrix: {
      id: 'matrix-triwo-step3-001',
      name: 'TRIWO Areal – Netzanschluss §17 EnWG',
      status: 'decision_blocked_pending_formal_request',
      tasks: [
        {
          taskId: 'triwo-step-3-network-operator-decision',
          taskName: 'Netzbetreiberentscheidung zum Anschlussbegehren',
          verantwortlich: [{ actorId: 'STROMDAO_Netze', displayName: 'STROMDAO Netze' }],
          durchfuehrend: [{ actorId: 'STROMDAO_AG_TE', displayName: 'STROMDAO AG TE' }],
          mitwirkend: [{ actorId: 'MVV', displayName: 'MVV' }],
          information: [{ actorId: 'TRIWO', displayName: 'TRIWO (Applicant)' }],
          evidenceRequirements: [
            { id: 'formal-request', label: 'Formaler §17-EnWG-Antrag' },
            { id: 'load-profile', label: 'Lastgang und Anschlussleistung' },
          ],
          evidenceGaps: [
            {
              id: 'formal-request',
              label: 'Formaler §17-EnWG-Antrag',
              reason: 'nicht eingereicht',
            },
          ],
          forbiddenAssumptions: ['Keine belastbare Anschlusszusage ohne formalen Antrag'],
          nextActions: [
            {
              id: 'na-1',
              type: 'formal_request',
              label: 'Formalen Antrag bei STROMDAO Netze einreichen',
            },
          ],
        },
      ],
    },
    expectedStatus: 'decision_blocked_pending_formal_request',
    decisionStatus: 'decision_blocked_until_evidence',
    evidenceRequirements: [
      { id: 'operator-confirmation', label: 'Verbindliche Bestätigung Netzbetreiberzuständigkeit' },
    ],
    evidenceGaps: [
      {
        id: 'operator-confirmation',
        label: 'Verbindliche Bestätigung Netzbetreiberzuständigkeit',
        reason: 'noch offen',
      },
    ],
    forbiddenAssumptions: [
      'User-Angabe zum Netzbetreiber darf nicht als verifizierte Evidenz gelten',
    ],
    nextActions: [
      {
        id: 'na-2',
        type: 'evidence',
        label: 'Zuständigkeitsnachweis und BKZ-Unterlagen nachreichen',
      },
    ],
    warnings: ['fixture_assumption_unverified_operator_mapping'],
    sources: ['fixture:triwo-vdmi-step3'],
    asOf: '2026-05-18',
  },
};
