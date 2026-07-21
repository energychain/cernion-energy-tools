'use strict';

const NO_CALL_GUARDS = Object.freeze([
  'mapping.write',
  'mapping.releaseExecute',
  'mako.submit',
  'billing.release',
  'settlement.prepareBilling',
  'settlement.exportA96',
  'tariff.mutate',
  'hitl.create',
  'workflow.execute',
  'webhook.emit',
  'mail.send',
  'device-control.execute',
  'smgw-cls.execute',
  'external.connector.call',
  'budibase.table.write',
  'personal-agent.execute',
  'production.mutate',
]);

const PROCESS_IMPACT_DEFAULTS = Object.freeze([
  {
    processFamily: 'market_communication',
    impact: 'descriptive_only',
    boundary: 'no MaKo message submission or partner master-data mutation',
  },
  {
    processFamily: 'metering',
    impact: 'descriptive_only',
    boundary: 'no MeLo/MaLo write and no meter operation',
  },
  {
    processFamily: 'billing',
    impact: 'descriptive_only',
    boundary: 'no billing release, tariff mutation or settlement export',
  },
]);

function asTrimmed(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function boolParam(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function evidenceStatus(value) {
  const normalized = String(value || '').toLowerCase();
  if (['complete', 'evidence_complete', 'source_versioned', 'verified'].includes(normalized)) {
    return 'source_versioned';
  }
  if (['partial', 'reviewable', 'needs_review'].includes(normalized)) {
    return 'needs_review';
  }
  if (['missing', 'none', 'unknown'].includes(normalized)) {
    return 'missing_source_version';
  }
  return asTrimmed(value) || 'synthetic_demo_evidence';
}

function approvalStatus(value) {
  const normalized = String(value || '').toLowerCase();
  if (['approved', 'freigegeben', 'release-approved'].includes(normalized)) {
    return 'approved';
  }
  if (['rejected', 'blocked', 'abgelehnt'].includes(normalized)) {
    return 'blocked';
  }
  if (['pending', 'review', 'in_review', 'in-pruefung'].includes(normalized)) {
    return 'in_review';
  }
  return asTrimmed(value) || 'needs_release_owner_review';
}

function releaseStatusFrom({ evidence, approval, missingEvidence }) {
  if (approval === 'approved' && evidence === 'source_versioned' && missingEvidence.length === 0) {
    return 'release_file_ready';
  }
  if (approval === 'blocked') return 'release_file_blocked';
  if (missingEvidence.length > 0) return 'needs_release_evidence';
  return 'reviewable_release_file';
}

function missingEvidenceFor(params, evidence, approval) {
  const gaps = [];
  const addGap = (missingDataPoint, enablesDossierAddition, severity = 'medium') => {
    gaps.push({
      missingDataPoint,
      enablesDossierAddition,
      severity,
      safeFollowUp: enablesDossierAddition,
    });
  };

  if (!asTrimmed(params.koppelpunktId)) {
    addGap('koppelpunkt_id', 'add Koppelpunkt identifier to bind the release-file subject');
  }
  if (!asTrimmed(params.marketPartnerId)) {
    addGap('market_partner_id', 'add Marktpartner identifier to document assignment context');
  }
  if (!asTrimmed(params.timeseriesId)) {
    addGap('timeseries_id', 'add Zeitreihen identifier to document the mapped time series');
  }
  if (!asTrimmed(params.mappingVersion)) {
    addGap('mapping_version', 'add mapping version to make the release file revision-safe');
  }
  if (!asTrimmed(params.sourceSystem) || evidence === 'missing_source_version') {
    addGap(
      'evidence_source_version',
      'add source system and version carrying the mapping evidence'
    );
  }
  if (!asTrimmed(params.owner)) {
    addGap('approval_owner', 'add approval owner or accountable role for the release decision');
  }
  if (approval === 'needs_release_owner_review') {
    addGap(
      'approval_status',
      'add approval status to separate reviewable evidence from released mapping'
    );
  }
  if (!asTrimmed(params.nextChangeGate)) {
    addGap(
      'next_change_gate',
      'add next change gate to make later mapping changes auditable',
      'low'
    );
  }
  return gaps;
}

function buildInterconnectionReleaseFileStatus(params = {}) {
  const tenantId = asTrimmed(params.tenantId) || 'public';
  const syntheticDemo = ![
    'koppelpunktId',
    'marketPartnerId',
    'timeseriesId',
    'mappingVersion',
    'sourceSystem',
    'evidenceStatus',
    'approvalStatus',
    'owner',
  ].some((key) => asTrimmed(params[key]));

  const subject = {
    caseId: asTrimmed(params.caseId) || 'smm-koppelpunkt-release-demo',
    koppelpunktId: asTrimmed(params.koppelpunktId) || 'KP-SYN-MAUER-01',
    marketPartnerId: asTrimmed(params.marketPartnerId) || 'MP-SYN-MAUER-01',
    timeseriesId: asTrimmed(params.timeseriesId) || 'TS-SYN-MAUER-01',
    mappingVersion: asTrimmed(params.mappingVersion) || 'synthetic-demo-v1',
    tenantId,
  };

  const evidence = evidenceStatus(params.evidenceStatus);
  const approval = approvalStatus(params.approvalStatus);
  const owner = asTrimmed(params.owner) || 'missing_release_owner';
  const nextChangeGate = asTrimmed(params.nextChangeGate) || 'missing_next_change_gate';
  const missingEvidence = missingEvidenceFor(params, evidence, approval);
  const status = releaseStatusFrom({ evidence, approval, missingEvidence });
  const includeFallbacks = boolParam(params.includeFallbacks);

  const summaryRows = [
    { key: 'status', label: 'Release-file status', value: status },
    { key: 'case_id', label: 'Case', value: subject.caseId },
    { key: 'owner', label: 'Approval owner', value: owner },
    { key: 'mapping_version', label: 'Mapping version', value: subject.mappingVersion },
    { key: 'next_change_gate', label: 'Next change gate', value: nextChangeGate },
    {
      key: 'evidence_basis',
      label: 'Evidence basis',
      value: syntheticDemo ? 'synthetic_demo_read_model' : 'request_provided_read_model',
    },
  ];

  const mappingRows = [
    {
      key: 'koppelpunkt',
      label: 'Koppelpunkt',
      value: subject.koppelpunktId,
      evidenceStatus: evidence,
    },
    {
      key: 'market_partner',
      label: 'Marktpartner',
      value: subject.marketPartnerId,
      evidenceStatus: evidence,
    },
    {
      key: 'timeseries',
      label: 'Zeitreihe',
      value: subject.timeseriesId,
      evidenceStatus: evidence,
    },
  ];

  const evidenceRows = [
    {
      sourceSystem: asTrimmed(params.sourceSystem) || 'synthetic-demo-source',
      sourceReference: `${subject.koppelpunktId}:${subject.marketPartnerId}:${subject.timeseriesId}`,
      mappingVersion: subject.mappingVersion,
      evidenceStatus: evidence,
      confidence: syntheticDemo ? 'demo_only' : evidence === 'source_versioned' ? 'high' : 'medium',
    },
  ];

  const approvalRows = [
    {
      owner,
      approvalStatus: approval,
      reviewerRole: asTrimmed(params.reviewerRole) || owner,
      openCheck:
        approval === 'approved'
          ? 'none'
          : 'release owner must confirm evidence source, process impact and next change gate',
    },
  ];

  const hintedImpacts = asTrimmed(params.affectedProcess)
    ? String(params.affectedProcess)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((processFamily) => ({
          processFamily,
          impact: 'descriptive_only',
          boundary: 'no downstream process execution in this read-only slice',
        }))
    : [];
  const processImpactRows = includeFallbacks
    ? [...PROCESS_IMPACT_DEFAULTS, ...hintedImpacts]
    : hintedImpacts.length
      ? hintedImpacts
      : [...PROCESS_IMPACT_DEFAULTS];

  const positiveFollowUps = missingEvidence.map((gap) => ({
    category: 'interconnection_release_file',
    missingDataPoint: gap.missingDataPoint,
    enablesDossierAddition: gap.enablesDossierAddition,
  }));

  const sourceActions = {
    inspected: ['dashboard-api.interconnectionReleaseFileStatus'],
    referenced: ['interconnection_release_file', 'capability-catalog', 'evidence-registry'],
    notCalled: [...NO_CALL_GUARDS],
  };

  const dossierFacts = [
    `Interconnection Release File Status: ${status}`,
    `Case: ${subject.caseId}`,
    `Koppelpunkt: ${subject.koppelpunktId}`,
    `Market Partner: ${subject.marketPartnerId}`,
    `Timeseries: ${subject.timeseriesId}`,
    `Mapping Version: ${subject.mappingVersion}`,
    `Approval Owner: ${owner}`,
    `Leading Gap: ${missingEvidence[0]?.missingDataPoint || 'none'}`,
    'Safety: read_only',
  ];

  return {
    releaseFileStatusId: `irf:${Buffer.from(
      `${tenantId}:${subject.caseId}:${subject.koppelpunktId}:${subject.mappingVersion}`
    )
      .toString('base64url')
      .slice(0, 28)}`,
    capabilityKey: 'interconnection_release_file',
    safety: 'read_only',
    found: true,
    status,
    syntheticDemo,
    subject,
    summaryRows,
    mappingRows,
    evidenceRows,
    approvalRows,
    processImpactRows,
    missingEvidence,
    positiveFollowUps,
    sourceActions,
    decisionBoundary: {
      advisoryOnly: true,
      mappingWritten: false,
      releaseWorkflowExecuted: false,
      downstreamProcessExecuted: false,
      externalConnectorCalled: false,
      productionMutation: false,
      personalAgentHardcoded: false,
    },
    dossierEvidence: {
      capabilityKey: 'interconnection_release_file',
      status,
      syntheticDemo,
      subject,
      summaryRows,
      mappingRows,
      evidenceRows,
      approvalRows,
      processImpactRows,
      missingEvidence,
      positiveFollowUps,
      sourceActions: { notCalled: sourceActions.notCalled },
      dossierFacts,
    },
  };
}

module.exports = {
  NO_CALL_GUARDS,
  buildInterconnectionReleaseFileStatus,
};
