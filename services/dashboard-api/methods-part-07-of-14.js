'use strict';

// dashboard-api methods chunk 7/14 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: buildOwnerDeadlineEvidenceGateStatus, buildAutomationRiskGateStatus, buildRedispatchProjectControllingKpiCockpitStatus, buildStadtwerkMauerVdmiProfileStatus, buildStadtwerkMauerCapabilityProjectionStatus, buildStadtwerkMauerEventReplayPreviewStatus, buildMissingStadtwerkMauerSandboxRuntimeStatus, buildMissingStadtwerkMauerExternalInterfaceStubsStatus, buildMissingStadtwerkMauerE2eProcessDemoStatus, buildStadtwerkMauerCaseDetailStatus, buildStadtwerkMauerBlueprintPackVerifyStatus, buildStadtwerkMauerTransferReadinessStatus, buildStadtwerkMauerLandingRegistryDraftStatus, buildMissingStadtwerkMauerCaseAnnotationStatus, buildStadtwerkMauerCaseEvidence, buildStadtwerkMauerCaseEvidenceRows

const {
  buildDemoProcessMatrixSync,
  buildLandingRegistryDraftFromBlueprintSeed,
  buildWorkbenchClarificationItems,
  getVdmiBlueprintPackSeed,
  stadtwerkMauerSubstationLoadAssessment,
  stadtwerkMauerPvMissingNap,
  validateVdmiBlueprintPackSeed,
} = require('./shared');

module.exports = {
  buildOwnerDeadlineEvidenceGateStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value))
        return value.map((item) => String(item || '').trim()).filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };
    const normalizeStatus = (value) => {
      const text = String(value || '')
        .trim()
        .toLowerCase();
      if (!text) return 'missing';
      if (
        /^(ready|ok|green|gruen|grün|complete|completed|valid|validiert|confirmed|bestaetigt|bestätigt|approved|freigegeben|present|vorhanden|cleared|attached|linked)$/.test(
          text
        )
      )
        return 'ready';
      if (
        /^(partial|partly|pending|open|offen|in_progress|in-progress|review|review_required|unklar|unknown|scheduled)$/.test(
          text
        )
      )
        return 'partial';
      if (/^(missing|fehlt|absent|not_available|not-available)$/.test(text)) return 'missing';
      if (
        /^(blocked|blockiert|red|rot|failed|rejected|denied|expired|overdue|ueberfaellig|überfällig|not_ready|not-ready|stop)$/.test(
          text
        )
      )
        return 'blocked';
      if (
        /(block|denied|reject|expired|overdue|ueberfaellig|überfällig|gesperrt|abgelehnt)/.test(
          text
        )
      )
        return 'blocked';
      return text;
    };
    const flagIsTrue = (value) =>
      value === true ||
      /^(true|yes|ja|1|blocked|blockiert|overdue|ueberfaellig|überfällig)$/i.test(
        String(value || '').trim()
      );
    const isReady = (status) => status === 'ready';
    const isBlocked = (status) => status === 'blocked';
    const sourceRefs = toList(params.sourceRef);
    const suppliedEvidenceGaps = [
      ...toList(params.missingEvidence),
      ...toList(params.evidenceGaps),
    ];
    const signalContext = {
      signalId: params.signalId || params.caseId || null,
      sourceType: params.sourceType || null,
      processType: params.processType || null,
      riskLevel: params.riskLevel || null,
      blockedDecision: params.blockedDecision || null,
      linkedEntity: params.linkedEntity || null,
      sourceRef: sourceRefs,
    };
    const ownerContext = {
      ownerRole: params.ownerRole || null,
      ownerContact: params.ownerContact || null,
      dueAt: params.dueAt || null,
    };
    const sourceActions = {
      inspected: ['dashboard-api.ownerDeadlineEvidenceGateStatus'],
      referenced: [
        'vdmi.myResponsibilities',
        'copilot-process.listProcessIntents',
        'decision-frame.list',
        'evidence-registry.findings',
        'dashboard-api.rolePermissionAccessReadinessGateStatus',
      ],
      notCalled: [
        'mail.fetch',
        'teams.fetch',
        'loop.fetch',
        'external.connector.call',
        'workflow.execute',
        'notification.send',
        'deadline.mutate',
        'task.create',
        'owner.assign',
        'hitl.create',
        'vdmi.mutate',
        'decision-frame.mutate',
        'copilot-process.mutate',
        'personal-agent.execute',
      ],
    };
    const signalSpecs = [
      {
        code: 'signal_context',
        label: 'Signal Context',
        value: params.signalContextStatus || (params.signalId && params.sourceType ? 'ready' : ''),
        enablesDossierAddition: 'add signal provenance and process context',
        statusWhenMissing: 'needs_signal_context',
      },
      {
        code: 'owner',
        label: 'Owner',
        value: params.ownerRole || params.ownerContact ? 'ready' : '',
        enablesDossierAddition: 'add accountable VNB owner role or contact evidence',
        statusWhenMissing: 'needs_owner',
      },
      {
        code: 'deadline',
        label: 'Deadline',
        value: params.dueAt ? 'ready' : '',
        enablesDossierAddition: 'add deadline tracking evidence',
        statusWhenMissing: 'needs_deadline',
      },
      {
        code: 'evidence_ref',
        label: 'Evidence Reference',
        value: params.evidenceRef ? 'ready' : params.evidenceStatus,
        enablesDossierAddition: 'attach the blocking evidence proof',
        statusWhenMissing: 'needs_evidence_ref',
      },
      {
        code: 'blocked_decision',
        label: 'Blocked Decision',
        value: params.blockedDecision ? 'ready' : '',
        enablesDossierAddition: 'explain which operational decision is blocked',
        statusWhenMissing: 'needs_signal_context',
      },
      {
        code: 'linked_entity',
        label: 'Linked Entity',
        value: params.linkedEntity ? 'ready' : '',
        enablesDossierAddition:
          'link the signal to asset, process, market role, Redispatch, security, finance, or governance context',
        statusWhenMissing: 'needs_signal_context',
      },
    ];
    const readinessSignals = signalSpecs.map((signal) => {
      const status = normalizeStatus(signal.value);
      return {
        code: signal.code,
        label: signal.label,
        status,
        rawStatus: signal.value || null,
        ownerRole: params.ownerRole || null,
        dueAt: params.dueAt || null,
        finding: isReady(status) ? null : signal.enablesDossierAddition,
        enablesDossierAddition: signal.enablesDossierAddition,
        statusWhenMissing: signal.statusWhenMissing,
      };
    });
    const missingFromSignals = readinessSignals
      .filter((signal) => !isReady(signal.status))
      .map((signal) => ({
        missingDataPoint: signal.code,
        status: signal.status,
        value: signal.rawStatus,
        enablesDossierAddition: signal.enablesDossierAddition,
      }));
    const missingFromParams = suppliedEvidenceGaps.map((value) => ({
      missingDataPoint: 'supplied_evidence_gap',
      value,
      status: 'missing',
      enablesDossierAddition: `add evidence for ${value}`,
    }));
    const sourceGap =
      sourceRefs.length === 0
        ? [
            {
              missingDataPoint: 'source_ref',
              value: null,
              status: 'missing',
              enablesDossierAddition: 'add source reference for auditability',
            },
          ]
        : [];
    const evidenceStatus = normalizeStatus(params.evidenceStatus);
    const blockedByMissingEvidence =
      flagIsTrue(params.blockedByMissingEvidence) || isBlocked(evidenceStatus);
    const overdue = flagIsTrue(params.overdue);
    const blockerGaps = [
      blockedByMissingEvidence
        ? {
            missingDataPoint: 'blocked_by_missing_evidence',
            value: params.evidenceStatus || params.blockedByMissingEvidence || true,
            status: 'blocked',
            enablesDossierAddition:
              'document missing evidence before the blocked decision can proceed',
          }
        : null,
      overdue
        ? {
            missingDataPoint: 'overdue_deadline',
            value: params.dueAt || params.overdue,
            status: 'blocked',
            enablesDossierAddition: 'document overdue deadline handling and owner follow-up',
          }
        : null,
    ].filter(Boolean);
    const evidenceGaps = [
      ...missingFromSignals,
      ...missingFromParams,
      ...sourceGap,
      ...blockerGaps,
    ];

    let status = 'unknown';
    if (overdue) status = 'blocked_by_overdue_deadline';
    else if (blockedByMissingEvidence) status = 'blocked_by_missing_evidence';
    else if (!params.signalId || !params.sourceType) status = 'needs_signal_context';
    else if (!params.ownerRole && !params.ownerContact) status = 'needs_owner';
    else if (!params.dueAt) status = 'needs_deadline';
    else if (!params.evidenceRef && !params.evidenceStatus) status = 'needs_evidence_ref';
    else if (
      readinessSignals.every((signal) => isReady(signal.status)) &&
      sourceGap.length === 0 &&
      suppliedEvidenceGaps.length === 0
    ) {
      status = 'ready_for_decision_followup';
    } else if (missingFromSignals.length > 0) {
      status =
        readinessSignals.find((signal) => signal.code === missingFromSignals[0].missingDataPoint)
          ?.statusWhenMissing || 'unknown';
    } else if (sourceGap.length > 0 || suppliedEvidenceGaps.length > 0) {
      status = 'needs_evidence_ref';
    }
    const blockers = evidenceGaps
      .filter((gap) => gap.status === 'blocked')
      .map((gap) => ({
        code: gap.missingDataPoint,
        ownerRole: params.ownerRole || null,
        dueAt: params.dueAt || null,
        blockedDecision: params.blockedDecision || null,
        message: gap.enablesDossierAddition,
      }));
    const positiveFollowUps = evidenceGaps.map((gap) => ({
      missingDataPoint: gap.missingDataPoint,
      status: gap.status,
      value: gap.value,
      enablesDossierAddition: gap.enablesDossierAddition,
      category: 'owner_deadline_evidence_gate',
    }));
    const nextActions = positiveFollowUps.map((followUp) => ({
      ownerRole: params.ownerRole || null,
      dueAt: params.dueAt || null,
      action: followUp.enablesDossierAddition,
      missingDataPoint: followUp.missingDataPoint,
    }));
    const validationFindings = evidenceGaps.map((gap, index) => ({
      code: `ODEG_${String(gap.missingDataPoint).toUpperCase()}_${index + 1}`,
      severity:
        gap.status === 'blocked' || /critical|hoch|high/i.test(String(params.riskLevel || ''))
          ? 'high'
          : 'medium',
      message: gap.enablesDossierAddition,
    }));
    const dossierFacts = [
      `Status: ${status}`,
      `Signal: ${params.signalId || params.caseId || 'unknown'}`,
      `Owner: ${params.ownerRole || params.ownerContact || 'unknown'}`,
      `Open gaps: ${evidenceGaps.length}`,
    ];
    if (params.blockedDecision) dossierFacts.push(`Blocked Decision: ${params.blockedDecision}`);

    return {
      ownerDeadlineEvidenceGateStatusId: `odeg:${Buffer.from(
        `${params.signalId || params.caseId || ''}:${params.ownerRole || params.ownerContact || ''}:${params.dueAt || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'owner_deadline_evidence_gate',
      safety: 'read_only',
      status,
      signalContext,
      ownerContext,
      readinessSignals,
      evidenceGaps,
      missingEvidence: evidenceGaps,
      blockers,
      nextActions,
      positiveFollowUps,
      sourceActions,
      validationFindings,
      dossierEvidence: {
        status,
        signalContext,
        ownerContext,
        readinessSignals,
        evidenceGaps,
        blockers,
        nextActions,
        positiveFollowUps,
        validationFindings,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildAutomationRiskGateStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value))
        return value.map((item) => String(item || '').trim()).filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };
    const normalizeStatus = (value) => {
      const text = String(value || '')
        .trim()
        .toLowerCase();
      if (!text) return 'missing';
      if (
        /^(ready|ok|green|gruen|grün|complete|completed|valid|validiert|confirmed|bestaetigt|bestätigt|approved|freigegeben|present|vorhanden|covered|documented|ja|yes)$/.test(
          text
        )
      )
        return 'ready';
      if (
        /^(partial|partly|pending|open|offen|in_progress|in-progress|review|review_required|unklar|unknown|scheduled)$/.test(
          text
        )
      )
        return 'partial';
      if (/^(missing|fehlt|absent|not_available|not-available|none|nein|no)$/.test(text))
        return 'missing';
      if (
        /^(blocked|blockiert|red|rot|failed|rejected|denied|uncontrolled|critical|kritisch|stop|no_rollback|no-stop)$/.test(
          text
        )
      )
        return 'blocked';
      if (
        /(block|reject|uncontrolled|kritisch|critical|fehlend|missing|ohne rollback|no rollback|ohne stopp|no stop)/.test(
          text
        )
      )
        return 'blocked';
      return text;
    };
    const toNumber = (value) => {
      if (value === undefined || value === null || value === '') return null;
      const normalized =
        typeof value === 'string' ? value.replace(/\s/g, '').replace(',', '.') : value;
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const isReady = (status) => status === 'ready';
    const isBlocked = (status) => status === 'blocked';
    const suppliedEvidenceGaps = toList(params.missingEvidence);
    const affectedDomains = toList(params.affectedDomains);
    const sourceRefs = toList(params.sourceRef || params.source);
    const massRunVolume = toNumber(params.massRunVolume);
    const sourceActions = {
      inspected: ['dashboard-api.automationRiskGateStatus'],
      referenced: [
        'vdmi.dossier',
        'datapoint.health',
        'datasource-registry.list',
        'interface-placeholder.listGaps',
        'presentation.generate',
      ],
      notCalled: [
        'rpa.execute',
        'bot.run',
        'mass-run.trigger',
        'workflow.execute',
        'hitl.create',
        'vdmi.mutate',
        'customer-communication.send',
        'settlement.prepareBilling',
        'settlement.exportA96',
        'market-communication.send',
        'notification.send',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const processContext = {
      processId: params.processId || null,
      processName: params.processName || null,
      processClass: params.processClass || null,
      runFrequency: params.runFrequency || null,
      massRunVolume,
      affectedDomains,
      blockedDecision: params.blockedDecision || null,
      sourceRef: sourceRefs,
    };
    const riskContext = {
      riskLevel: params.riskLevel || null,
      customerCommunicationImpact: params.customerCommunicationImpact || null,
      billingImpact: params.billingImpact || null,
      marketCommunicationImpact: params.marketCommunicationImpact || null,
      massDataImpact: params.massDataImpact || null,
    };
    const signalSpecs = [
      {
        code: 'process_context',
        label: 'Process Context',
        value: params.processId || params.processName ? 'ready' : '',
        enablesDossierAddition:
          'add process id, process name, class, frequency, mass-run scope, and affected domains',
        statusWhenMissing: 'needs_process_context',
      },
      {
        code: 'process_owner',
        label: 'Process Owner',
        value: params.processOwner || params.operationsOwner ? 'ready' : '',
        enablesDossierAddition: 'add accountable automation and operations owners',
        statusWhenMissing: 'needs_process_owner',
      },
      {
        code: 'test_case_coverage',
        label: 'Test Coverage',
        value: params.testCaseCoverage,
        enablesDossierAddition: 'add test-case coverage and acceptance confidence',
        statusWhenMissing: 'needs_test_coverage',
      },
      {
        code: 'edge_case_catalog',
        label: 'Edge Case Catalog',
        value: params.edgeCaseCatalog,
        enablesDossierAddition: 'add Sonderfall / edge-case catalog completeness',
        statusWhenMissing: 'needs_edge_case_catalog',
      },
      {
        code: 'stop_criteria',
        label: 'Stop Criteria',
        value: params.stopCriteria,
        enablesDossierAddition: 'add documented stop criteria and operational kill switch evidence',
        statusWhenMissing: 'needs_stop_criteria',
      },
      {
        code: 'rollback_path',
        label: 'Rollback Path',
        value: params.rollbackPath,
        enablesDossierAddition: 'add rollback path and damage containment evidence',
        statusWhenMissing: 'needs_rollback_path',
      },
      {
        code: 'monitoring_signals',
        label: 'Monitoring Signals',
        value: params.monitoringSignals,
        enablesDossierAddition: 'add monitoring signals and operational observability evidence',
        statusWhenMissing: 'needs_monitoring',
      },
    ];
    const readinessSignals = signalSpecs.map((signal) => {
      const status = normalizeStatus(signal.value);
      return {
        code: signal.code,
        label: signal.label,
        status,
        rawStatus: signal.value || null,
        finding: isReady(status) ? null : signal.enablesDossierAddition,
        enablesDossierAddition: signal.enablesDossierAddition,
        statusWhenMissing: signal.statusWhenMissing,
      };
    });
    const missingFromSignals = readinessSignals
      .filter((signal) => !isReady(signal.status))
      .map((signal) => ({
        missingDataPoint: signal.code,
        status: signal.status,
        value: signal.rawStatus,
        enablesDossierAddition: signal.enablesDossierAddition,
      }));
    const missingFromParams = suppliedEvidenceGaps.map((value) => ({
      missingDataPoint: 'supplied_evidence_gap',
      value,
      status: 'missing',
      enablesDossierAddition: `add evidence for ${value}`,
    }));
    const hasCriticalDomain = [
      params.customerCommunicationImpact,
      params.billingImpact,
      params.marketCommunicationImpact,
      params.massDataImpact,
      params.riskLevel,
    ].some((value) =>
      /critical|kritisch|hoch|high|blocked|blockiert|uncontrolled|unkontrolliert|mass/i.test(
        String(value || '')
      )
    );
    const uncontrolledMassRun =
      (massRunVolume !== null && massRunVolume >= 1000 && hasCriticalDomain) ||
      readinessSignals.some(
        (signal) =>
          ['stop_criteria', 'rollback_path'].includes(signal.code) && isBlocked(signal.status)
      );
    const blockerGaps = [
      uncontrolledMassRun
        ? {
            missingDataPoint: 'uncontrolled_mass_run',
            value: massRunVolume || params.riskLevel || true,
            status: 'blocked',
            enablesDossierAddition:
              'document stop criteria, rollback path, monitoring, and risk acceptance before any mass automation run',
          }
        : null,
    ].filter(Boolean);
    const evidenceGaps = [...missingFromSignals, ...missingFromParams, ...blockerGaps];
    let status = 'unknown';
    if (uncontrolledMassRun) status = 'blocked_by_uncontrolled_mass_run';
    else if (!params.processId && !params.processName) status = 'needs_process_context';
    else if (!params.processOwner && !params.operationsOwner) status = 'needs_process_owner';
    else if (!isReady(normalizeStatus(params.testCaseCoverage))) status = 'needs_test_coverage';
    else if (!isReady(normalizeStatus(params.edgeCaseCatalog))) status = 'needs_edge_case_catalog';
    else if (!isReady(normalizeStatus(params.stopCriteria))) status = 'needs_stop_criteria';
    else if (!isReady(normalizeStatus(params.rollbackPath))) status = 'needs_rollback_path';
    else if (!isReady(normalizeStatus(params.monitoringSignals))) status = 'needs_monitoring';
    else if (evidenceGaps.length === 0) status = 'ready_for_automation_decision';
    else if (missingFromSignals.length > 0) {
      status =
        readinessSignals.find((signal) => signal.code === missingFromSignals[0].missingDataPoint)
          ?.statusWhenMissing || 'unknown';
    }
    const blockers = evidenceGaps
      .filter((gap) => gap.status === 'blocked')
      .map((gap) => ({
        code: gap.missingDataPoint,
        processOwner: params.processOwner || null,
        operationsOwner: params.operationsOwner || null,
        blockedDecision: params.blockedDecision || null,
        message: gap.enablesDossierAddition,
      }));
    const positiveFollowUps = evidenceGaps.map((gap) => ({
      missingDataPoint: gap.missingDataPoint,
      status: gap.status,
      value: gap.value,
      enablesDossierAddition: gap.enablesDossierAddition,
      category: 'automation_risk_gate',
    }));
    const nextActions = positiveFollowUps.map((followUp) => ({
      owner: params.processOwner || params.operationsOwner || null,
      action: followUp.enablesDossierAddition,
      missingDataPoint: followUp.missingDataPoint,
    }));
    const validationFindings = evidenceGaps.map((gap, index) => ({
      code: `ARG_${String(gap.missingDataPoint).toUpperCase()}_${index + 1}`,
      severity:
        gap.status === 'blocked' ||
        /critical|kritisch|hoch|high/i.test(String(params.riskLevel || ''))
          ? 'high'
          : 'medium',
      message: gap.enablesDossierAddition,
    }));
    const dossierFacts = [
      `Status: ${status}`,
      `Process: ${params.processId || params.processName || 'unknown'}`,
      `Risk: ${params.riskLevel || 'unknown'}`,
      `Open gaps: ${evidenceGaps.length}`,
    ];
    if (params.blockedDecision) dossierFacts.push(`Blocked Decision: ${params.blockedDecision}`);

    return {
      automationRiskGateStatusId: `arg:${Buffer.from(
        `${params.processId || params.processName || ''}:${params.processOwner || params.operationsOwner || ''}:${params.riskLevel || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'automation_risk_gate',
      safety: 'read_only',
      status,
      processContext,
      riskContext,
      readinessSignals,
      evidenceGaps,
      missingEvidence: evidenceGaps,
      blockers,
      nextActions,
      positiveFollowUps,
      sourceActions,
      validationFindings,
      dossierEvidence: {
        status,
        processContext,
        riskContext,
        readinessSignals,
        evidenceGaps,
        blockers,
        nextActions,
        positiveFollowUps,
        validationFindings,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildRedispatchProjectControllingKpiCockpitStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value))
        return value.map((item) => String(item || '').trim()).filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };
    const normalizeStatus = (value) => {
      const text = String(value || '')
        .trim()
        .toLowerCase();
      if (!text) return 'missing';
      if (
        /^(ready|ok|green|gruen|grün|complete|completed|valid|validiert|confirmed|bestaetigt|bestätigt|approved|freigegeben|present|vorhanden|covered|documented|ja|yes|true)$/.test(
          text
        )
      )
        return 'ready';
      if (
        /^(partial|partly|pending|open|offen|in_progress|in-progress|review|review_required|unklar|unknown|scheduled)$/.test(
          text
        )
      )
        return 'partial';
      if (/^(missing|fehlt|absent|not_available|not-available|none|nein|no|false)$/.test(text))
        return 'missing';
      if (/^(stale|veraltet|expired|outdated)$/.test(text)) return 'stale';
      if (
        /^(blocked|blockiert|red|rot|failed|rejected|denied|conflicting|conflict|stop)$/.test(text)
      )
        return 'blocked';
      if (/(block|reject|conflict|stale|veraltet|expired|fehlend|missing)/.test(text))
        return text.includes('stale') || text.includes('veraltet') || text.includes('expired')
          ? 'stale'
          : 'blocked';
      return text;
    };
    const flagIsReady = (value) => value === true || normalizeStatus(value) === 'ready';
    const isReady = (status) => status === 'ready';
    const isBlocked = (status) => status === 'blocked';
    const suppliedEvidenceGaps = toList(params.missingEvidence);
    const affectedAssets = toList(params.affectedAssets);
    const staleSources = toList(params.staleSources);
    const projectContext = {
      cockpitId: params.cockpitId || params.redispatchAuditId || null,
      gridOperatorId: params.gridOperatorId || null,
      period: params.period || null,
      redispatchAuditId: params.redispatchAuditId || null,
      settlementRef: params.settlementRef || null,
      vdmiProcessId: params.vdmiProcessId || null,
    };
    const taskSignals = [
      {
        taskId: params.taskId || null,
        status: params.taskStatus || null,
        owner: params.taskOwner || null,
        dueDate: params.dueDate || null,
        blockedDecision: params.blockedDecision || null,
        decisionBlocker: params.decisionBlocker || null,
        affectedAssets,
      },
      ...toList(params.tasks).map((task) => ({
        taskId: task,
        status: null,
        owner: null,
        dueDate: null,
      })),
    ].filter(
      (task) =>
        task.taskId ||
        task.status ||
        task.owner ||
        task.dueDate ||
        task.blockedDecision ||
        task.decisionBlocker ||
        task.affectedAssets?.length
    );
    const kpiSignals = toList(params.kpiSignals);
    if (params.hasKpiReference || params.settlementRef) {
      kpiSignals.unshift(params.settlementRef || 'supplied-kpi-reference');
    }
    const sourceHealth = toList(params.sourceHealth);
    if (params.datasourceHealth || params.sourceFreshness || params.qualityStatus) {
      sourceHealth.unshift(
        `datasource=${params.datasourceHealth || 'unknown'}; freshness=${params.sourceFreshness || 'unknown'}; quality=${params.qualityStatus || 'unknown'}`
      );
    }
    const sourceActions = {
      inspected: ['dashboard-api.redispatchProjectControllingKpiCockpitStatus'],
      referenced: [
        'redispatch-expost.audit',
        'redispatch-expost.list',
        'settlement.calculateRedispatch',
        'datapoint.health',
        'datasource-registry.get',
        'mastr-quality.audit',
        'assets.effective',
        'vdmi.dossier',
        'vdmi.findings',
        'hitl.list',
        'presentation.render',
      ],
      notCalled: [
        'redispatch.execute',
        'redispatch.order.create',
        'settlement.calculateRedispatch',
        'settlement.prepareBilling',
        'settlement.exportA96',
        'billing.release',
        'task.create',
        'workflow.execute',
        'hitl.create',
        'vdmi.mutate',
        'notification.send',
        'datasource.ingest',
        'datapoint.write',
        'mastr.import',
        'assets.applyOverride',
        'tariff.mutate',
        'grid-operations.executeControl',
        'device-control.execute',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const signalSpecs = [
      {
        code: 'redispatch_audit',
        label: 'Redispatch Audit',
        ready: params.redispatchAuditId || flagIsReady(params.hasRedispatchAudit),
        value: params.redispatchAuditId || params.hasRedispatchAudit,
        enablesDossierAddition:
          'add Redispatch audit chain, steps, findings, and audit-readiness summary',
        statusWhenMissing: 'needs_redispatch_audit',
      },
      {
        code: 'source_health',
        label: 'Datasource Health',
        ready:
          flagIsReady(params.datasourceHealth) &&
          (flagIsReady(params.sourceFreshness) || !params.sourceFreshness),
        value: params.datasourceHealth || params.sourceFreshness,
        enablesDossierAddition: 'add source quality, freshness, and provenance evidence',
        statusWhenMissing: 'needs_source_health',
      },
      {
        code: 'asset_evidence',
        label: 'Asset / MaStR Evidence',
        ready: flagIsReady(params.hasAssetEvidence) && flagIsReady(params.hasMastrEvidence),
        value: `${params.hasAssetEvidence || ''}/${params.hasMastrEvidence || ''}`,
        enablesDossierAddition: 'add affected asset and MaStR evidence context',
        statusWhenMissing: 'needs_asset_evidence',
      },
      {
        code: 'load_profile_evidence',
        label: 'Load Profile Evidence',
        ready: flagIsReady(params.hasLoadProfileEvidence),
        value: params.hasLoadProfileEvidence,
        enablesDossierAddition: 'add load-profile / Lastgang evidence for the controlling period',
        statusWhenMissing: 'needs_load_profile_evidence',
      },
      {
        code: 'settlement_readiness',
        label: 'Settlement Readiness',
        ready: params.settlementRef || flagIsReady(params.hasSettlementReadiness),
        value: params.settlementRef || params.hasSettlementReadiness,
        enablesDossierAddition:
          'add settlement-readiness and KPI-impact evidence without executing settlement',
        statusWhenMissing: 'needs_settlement_readiness',
      },
      {
        code: 'owner',
        label: 'Task Owner',
        ready: Boolean(params.taskOwner),
        value: params.taskOwner,
        enablesDossierAddition: 'add owner/accountability context',
        statusWhenMissing: 'needs_owner',
      },
      {
        code: 'due_date',
        label: 'Due Date',
        ready: Boolean(params.dueDate),
        value: params.dueDate,
        enablesDossierAddition: 'add urgency and deadline evidence',
        statusWhenMissing: 'needs_owner',
      },
      {
        code: 'kpi_reference',
        label: 'KPI Reference',
        ready: flagIsReady(params.hasKpiReference) || kpiSignals.length > 0,
        value: params.hasKpiReference || kpiSignals[0],
        enablesDossierAddition: 'add KPI definition/source traceability',
        statusWhenMissing: 'needs_settlement_readiness',
      },
    ];
    const readinessSignals = signalSpecs.map((signal) => {
      const normalized = signal.ready ? 'ready' : normalizeStatus(signal.value);
      return {
        code: signal.code,
        label: signal.label,
        status: signal.ready ? 'ready' : normalized,
        rawStatus: signal.value || null,
        finding: signal.ready ? null : signal.enablesDossierAddition,
        enablesDossierAddition: signal.enablesDossierAddition,
        statusWhenMissing: signal.statusWhenMissing,
      };
    });
    const missingFromSignals = readinessSignals
      .filter((signal) => !isReady(signal.status))
      .map((signal) => ({
        missingDataPoint: signal.code,
        status: signal.status,
        value: signal.rawStatus,
        enablesDossierAddition: signal.enablesDossierAddition,
      }));
    const missingFromParams = suppliedEvidenceGaps.map((value) => ({
      missingDataPoint: 'supplied_evidence_gap',
      value,
      status: 'missing',
      enablesDossierAddition: `add evidence for ${value}`,
    }));
    const staleSourceGaps = staleSources.map((value) => ({
      missingDataPoint: 'stale_source',
      value,
      status: 'stale',
      enablesDossierAddition: `refresh stale Redispatch source ${value}`,
    }));
    const datasourceStatus = normalizeStatus(
      params.datasourceHealth || params.qualityStatus || params.sourceFreshness
    );
    const blockedGap =
      params.blockedDecision || params.decisionBlocker
        ? [
            {
              missingDataPoint: 'blocked_decision',
              value: params.blockedDecision || params.decisionBlocker,
              status: 'blocked',
              enablesDossierAddition: 'add explicit blocker and required decision context',
            },
          ]
        : [];
    const staleHealthGap =
      datasourceStatus === 'stale'
        ? [
            {
              missingDataPoint: 'source_health',
              value: params.datasourceHealth || params.sourceFreshness || params.qualityStatus,
              status: 'stale',
              enablesDossierAddition:
                'refresh stale datasource or quality signal before project review',
            },
          ]
        : [];
    const evidenceGaps = [
      ...missingFromSignals,
      ...missingFromParams,
      ...staleSourceGaps,
      ...staleHealthGap,
      ...blockedGap,
    ];

    let status = 'unknown';
    if (blockedGap.length > 0) status = 'blocked_by_decision_gap';
    else if (!params.redispatchAuditId && !flagIsReady(params.hasRedispatchAudit))
      status = 'needs_redispatch_audit';
    else if (
      !flagIsReady(params.datasourceHealth) ||
      datasourceStatus === 'stale' ||
      staleSources.length > 0
    )
      status = 'needs_source_health';
    else if (!flagIsReady(params.hasAssetEvidence) || !flagIsReady(params.hasMastrEvidence))
      status = 'needs_asset_evidence';
    else if (!flagIsReady(params.hasLoadProfileEvidence)) status = 'needs_load_profile_evidence';
    else if (!params.settlementRef && !flagIsReady(params.hasSettlementReadiness))
      status = 'needs_settlement_readiness';
    else if (!params.taskOwner || !params.dueDate) status = 'needs_owner';
    else if (!flagIsReady(params.hasKpiReference) && kpiSignals.length === 0)
      status = 'needs_settlement_readiness';
    else if (
      evidenceGaps.length === 0 &&
      readinessSignals.every((signal) => isReady(signal.status))
    )
      status = 'ready_for_project_review';
    else if (missingFromSignals.length > 0)
      status =
        readinessSignals.find((signal) => signal.code === missingFromSignals[0].missingDataPoint)
          ?.statusWhenMissing || 'unknown';

    const decisionBlockers = evidenceGaps
      .filter((gap) => isBlocked(gap.status))
      .map((gap) => ({
        code: gap.missingDataPoint,
        blockedDecision: params.blockedDecision || null,
        decisionBlocker: params.decisionBlocker || null,
        owner: params.taskOwner || null,
        message: gap.enablesDossierAddition,
      }));
    const positiveFollowUps = evidenceGaps.map((gap) => ({
      missingDataPoint: gap.missingDataPoint,
      status: gap.status,
      value: gap.value,
      enablesDossierAddition: gap.enablesDossierAddition,
      category: 'redispatch_project_controlling_kpi_cockpit',
    }));
    const nextActions = positiveFollowUps.map((followUp) => ({
      owner: params.taskOwner || null,
      dueDate: params.dueDate || null,
      action: followUp.enablesDossierAddition,
      missingDataPoint: followUp.missingDataPoint,
    }));
    const validationFindings = evidenceGaps.map((gap, index) => ({
      code: `RDPKPI_${String(gap.missingDataPoint).toUpperCase()}_${index + 1}`,
      severity: gap.status === 'blocked' || gap.status === 'stale' ? 'high' : 'medium',
      message: gap.enablesDossierAddition,
    }));
    const dossierFacts = [
      `Status: ${status}`,
      `Cockpit: ${projectContext.cockpitId || 'unknown'}`,
      `Period: ${params.period || 'unknown'}`,
      `Open gaps: ${evidenceGaps.length}`,
    ];
    if (params.blockedDecision) dossierFacts.push(`Blocked Decision: ${params.blockedDecision}`);

    return {
      redispatchProjectControllingKpiCockpitStatusId: `rdpck:${Buffer.from(
        `${projectContext.cockpitId || ''}:${params.period || ''}:${params.redispatchAuditId || ''}:${params.taskOwner || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'redispatch_project_controlling_kpi_cockpit',
      safety: 'read_only',
      status,
      projectContext,
      taskSignals,
      kpiSignals,
      sourceHealth,
      evidenceGaps,
      missingEvidence: evidenceGaps,
      decisionBlockers,
      blockers: decisionBlockers,
      nextActions,
      positiveFollowUps,
      sourceActions,
      validationFindings,
      dossierEvidence: {
        status,
        projectContext,
        taskSignals,
        kpiSignals,
        sourceHealth,
        evidenceGaps,
        decisionBlockers,
        nextActions,
        positiveFollowUps,
        validationFindings,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildStadtwerkMauerVdmiProfileStatus(params = {}) {
    const normalizeBoolean = (value, defaultValue = true) => {
      if (value === undefined || value === null || value === '') return defaultValue;
      if (typeof value === 'boolean') return value;
      return /^(1|true|yes|ja|include|with)$/i.test(String(value).trim());
    };
    const focusSparte = String(params.focusSparte || '')
      .trim()
      .toLowerCase();
    const includeRoles = normalizeBoolean(params.includeRoles, true);
    const includeEvidenceGaps = normalizeBoolean(params.includeEvidenceGaps, true);
    const tenantId = params.tenantId || 'stadtwerk-mauer';
    const allSparten = [
      {
        id: 'strom',
        label: 'Strom',
        primaryMarketRoles: ['VNB', 'MSB', 'LF', 'BKV', 'EDM', 'MaKo'],
      },
      {
        id: 'gas',
        label: 'Gas',
        primaryMarketRoles: ['VNB', 'LF', 'BKV', 'Beschaffung', 'Asset Management'],
      },
      {
        id: 'wasser',
        label: 'Wasser',
        primaryMarketRoles: ['Infrastrukturbetreiber', 'Billing', 'Asset Management', 'Management'],
      },
      {
        id: 'waerme',
        label: 'Waerme',
        primaryMarketRoles: [
          'Infrastrukturbetreiber',
          'Erzeugungsplanung',
          'Beschaffung',
          'Billing',
        ],
      },
    ];
    const sparten = focusSparte
      ? allSparten.filter((sparte) => [sparte.id, sparte.label.toLowerCase()].includes(focusSparte))
      : allSparten;
    const roleSpecs = [
      [
        'management',
        'Management',
        'internal',
        'Decides portfolio priorities, committee readiness, and escalation boundaries.',
      ],
      [
        'regulierung',
        'Regulierung',
        'internal',
        'Owns regulatory evidence for paragraph 14a, 14d, 42c, A96, and audit readiness.',
      ],
      [
        'asset_management',
        'Asset Management',
        'internal',
        'Owns cross-sparte asset facts, valuation context, and investment readiness.',
      ],
      [
        'netzplanung',
        'Netzplanung',
        'internal',
        'Owns ZNP, grid bottleneck, target-network, and municipal planning evidence.',
      ],
      [
        'netzbetrieb',
        'Netzbetrieb',
        'internal',
        'Owns operational constraints, outage/maintenance context, and source-action guards.',
      ],
      [
        'edm',
        'EDM',
        'market',
        'Owns load profiles, schedules, metering time series, and data-quality evidence.',
      ],
      [
        'mako',
        'MaKo',
        'market',
        'Owns market-communication evidence chains and A96/MSCONS/GPKE-adjacent gaps.',
      ],
      [
        'billing',
        'Billing',
        'market',
        'Owns settlement, billing, water/heat price and grid-fee impact evidence.',
      ],
      [
        'vnb',
        'VNB',
        'market',
        'Owns DSO network process, connection, capacity, and bottleneck responsibility.',
      ],
      [
        'msb',
        'MSB',
        'market',
        'Owns metering concept, iMSys/SMGW readiness, and device-data evidence.',
      ],
      ['lf', 'LF', 'market', 'Owns supplier/customer contract and tariff consequence evidence.'],
      [
        'bkv',
        'BKV/Bilanzkreismanagement',
        'market',
        'Owns balancing group, procurement schedule, and imbalance-risk evidence.',
      ],
      [
        'esa',
        'ESA/Einsatz-/Steuerungsverantwortung',
        'market',
        'Owns Redispatch, flexibility, generation schedule, and dispatch-responsibility evidence.',
      ],
      [
        'beschaffung',
        'Beschaffung',
        'internal',
        'Owns procurement assumptions for Strom, Gas, and Waerme quantity/price risks.',
      ],
      [
        'erzeugungsplanung',
        'Erzeugungsplanung',
        'internal',
        'Owns local generation, heat generation and municipal supply planning evidence.',
      ],
    ];
    const roles = roleSpecs.map(([id, label, type, responsibility], index) => ({
      id,
      label,
      type,
      vdmiResponsibility: responsibility,
      involvement: index < 5 ? 'core_ring' : 'market_role',
      decisionBoundary: 'advisory_only_in_phase_1',
      evidenceNeeds: [`${id}_source_evidence`, `${id}_owner_confirmation`],
    }));
    const matrix = sparten.map((sparte) => ({
      sparte: sparte.id,
      label: sparte.label,
      responsibleRoles: sparte.primaryMarketRoles,
      vdmiView: {
        verantwortlich: sparte.primaryMarketRoles[0],
        durchfuehrend: sparte.primaryMarketRoles.slice(1, 3),
        mitwirkend: ['Management', 'Regulierung', 'Asset Management'],
        informiert: ['Netzplanung', 'Netzbetrieb', 'EDM', 'MaKo', 'Billing'],
      },
      transformationRiskAreas: [
        `${sparte.label} asset and data quality`,
        `${sparte.label} investment and capacity assumptions`,
        `${sparte.label} market / billing / evidence handover`,
      ],
    }));
    const baseGaps = [
      [
        'sparte_asset_facts',
        'missing sparte-specific asset facts',
        'add a more precise asset and network-risk section',
      ],
      [
        'mako_edm_evidence',
        'missing MaKo / EDM evidence',
        'add market-communication and data-quality risk assessment',
      ],
      [
        'billing_bkv_evidence',
        'missing Billing / BKV evidence',
        'add settlement, procurement, and balancing impact assessment',
      ],
      [
        'role_owner_confirmation',
        'missing VDMI role owner confirmation',
        'add accountable owner and escalation boundary',
      ],
      [
        'capability_projection',
        'missing role-scoped capability projection',
        'enable Phase 2 Eve-compatible capability projection',
      ],
    ];
    const evidenceGaps = includeEvidenceGaps
      ? baseGaps.map(([missingDataPoint, label, enablesDossierAddition]) => ({
          missingDataPoint,
          label,
          status: 'partial',
          enablesDossierAddition,
          category: 'stadtwerk_mauer_vdmi_profile',
        }))
      : [];
    const positiveFollowUps = evidenceGaps.map((gap) => ({
      missingDataPoint: gap.missingDataPoint,
      status: gap.status,
      enablesDossierAddition: gap.enablesDossierAddition,
      category: gap.category,
    }));
    const sourceActions = {
      inspected: ['dashboard-api.stadtwerkMauerVdmiProfileStatus'],
      referenced: [
        'capability-broker.recommend',
        'dossier-hydration.registry',
        'llm-descriptor.generated',
        'vdmi.dossier',
      ],
      notCalled: [
        'tenant.create',
        'user.create',
        'token.create',
        'eve.runtime.execute',
        'agent-directory.write',
        'scheduler.create',
        'channel.open',
        'approval.create',
        'task.create',
        'workflow.execute',
        'notification.send',
        'hitl.create',
        'nova.mutate',
        'vdmi.mutate',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const demoQuestion =
      params.demoQuestion ||
      'Welche Transformations- und Netzrisiken hat Stadtwerk Mauer fuer Strom, Gas, Wasser und Waerme, und welche Rollen muessen als naechstes Evidenz liefern?';
    const demoQuestionAnswer = {
      question: demoQuestion,
      summary:
        'Stadtwerk Mauer is modeled as one read-only MVP profile for PLZ 69256 with Strom, Gas, Wasser, and Waerme. The next evidence owners are Management, Regulierung, Asset Management, Netzplanung, Netzbetrieb, EDM, MaKo, Billing, VNB/MSB/LF/BKV/ESA, Beschaffung, and Erzeugungsplanung.',
      transformationRiskAreas: matrix.flatMap((entry) => entry.transformationRiskAreas),
      nextEvidenceRoles: roles.slice(0, 8).map((role) => role.label),
    };
    const dossierFacts = [
      'Profile: stadtwerk_mauer_vdmi_profile',
      `Tenant: ${tenantId}`,
      'Municipality: Mauer',
      'Postcode: 69256',
      `Sparten: ${sparten.map((sparte) => sparte.label).join(', ')}`,
      `Roles: ${roles.length}`,
      `Open evidence gaps: ${evidenceGaps.length}`,
    ];

    return {
      stadtwerkMauerVdmiProfileStatusId: `smv:${Buffer.from(`${tenantId}:${focusSparte || 'all'}`)
        .toString('base64url')
        .slice(0, 28)}`,
      profileId: 'stadtwerk_mauer_vdmi_profile',
      capabilityKey: 'stadtwerk_mauer_vdmi_profile',
      safety: 'read_only',
      status: evidenceGaps.length > 0 ? 'partial_profile_with_evidence_gaps' : 'profile_ready',
      tenantId,
      municipality: 'Mauer',
      postcode: '69256',
      region: {
        country: 'DE',
        municipality: 'Mauer',
        postcode: '69256',
      },
      sparten,
      roles: includeRoles ? roles : [],
      matrix,
      evidenceGaps,
      missingEvidence: evidenceGaps,
      positiveFollowUps,
      decisionBoundaries: [
        'read-only and advisory-first in Phase 1',
        'consequential actions become later VDMI/NOVA/task proposals only',
        'no Eve runtime, no tenant provisioning, no Personal-Agent hardcoding',
      ],
      demoQuestionAnswer,
      sourceActions,
      validationFindings: evidenceGaps.map((gap, index) => ({
        code: `SMV_${String(gap.missingDataPoint).toUpperCase()}_${index + 1}`,
        severity: 'medium',
        message: gap.enablesDossierAddition,
      })),
      dossierEvidence: {
        status: evidenceGaps.length > 0 ? 'partial_profile_with_evidence_gaps' : 'profile_ready',
        profileId: 'stadtwerk_mauer_vdmi_profile',
        tenantId,
        municipality: 'Mauer',
        postcode: '69256',
        sparten,
        roles: includeRoles ? roles : [],
        matrix,
        evidenceGaps,
        positiveFollowUps,
        decisionBoundaries: [
          'read-only and advisory-first in Phase 1',
          'consequential actions become later VDMI/NOVA/task proposals only',
          'no Eve runtime, no tenant provisioning, no Personal-Agent hardcoding',
        ],
        demoQuestionAnswer,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildStadtwerkMauerCapabilityProjectionStatus(params = {}) {
    const normalizeBoolean = (value, defaultValue = true) => {
      if (value === undefined || value === null || value === '') return defaultValue;
      if (typeof value === 'boolean') return value;
      return /^(1|true|yes|ja|include|with)$/i.test(String(value).trim());
    };
    const toList = (value) => {
      if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };
    const tenantId = params.tenantId || 'stadtwerk-mauer';
    const includeConsequential = normalizeBoolean(params.includeConsequential, true);
    const includeDescriptorSources = normalizeBoolean(params.includeDescriptorSources, true);
    const requestedRoles = toList(params.roles).map((role) => role.toLowerCase());
    const defaultRoleOrder = ['management', 'grid-planning', 'asset-management', 'regulatory'];
    const roleOrder = requestedRoles.length > 0 ? requestedRoles : defaultRoleOrder;
    const profile = this.buildStadtwerkMauerVdmiProfileStatus({
      tenantId,
      includeRoles: true,
      includeEvidenceGaps: true,
    });
    const roleSpecs = {
      management: {
        roleId: 'management',
        label: 'Management',
        profileRoleIds: ['management'],
        vdmiResponsibilities: [
          'Portfolio priorities and escalation boundaries',
          'Cross-sparte decision readiness for Strom, Gas, Wasser, and Waerme',
        ],
        readOnlyCapabilities: [
          'stadtwerk_mauer_vdmi_profile',
          'owner_deadline_evidence_gate',
          'investment_committee_steering_cards',
          'budget_waterfall_governance',
        ],
        advisoryCapabilities: [
          'process_sensitization_readiness_map',
          'automation_risk_gate',
          'netzprozess_readiness_gate',
        ],
        consequentialFollowUps: [
          'nova_proposal_for_portfolio_decision',
          'vdmi_task_for_management_approval',
          'budget_committee_followup',
        ],
        evidenceGaps: [
          [
            'missing_consequential_boundary',
            'add explicit NOVA/VDMI/task handoff classification for management decisions',
          ],
          [
            'missing_demo_question_context',
            'enable Phase-4 demo dossier grounding for management review',
          ],
        ],
      },
      'grid-planning': {
        roleId: 'grid-planning',
        label: 'Grid Planning',
        profileRoleIds: ['netzplanung', 'vnb'],
        vdmiResponsibilities: [
          'ZNP, grid bottleneck, target-network, and municipal planning evidence',
          'Readiness handover for NAP, fNAV, and storage/flex Anschluss contexts',
        ],
        readOnlyCapabilities: [
          'znp_production_readiness_evidence_gate',
          'grossspeicher_anschluss_readiness_gate',
          'netzprozess_readiness_gate',
          'grid_connection_transformation_gate',
        ],
        advisoryCapabilities: [
          'stadtwerk_mauer_vdmi_profile',
          'e2e_controllability_check_governance',
          'controllability_asset_handover',
        ],
        consequentialFollowUps: [
          'nova_handoff_for_znp_review',
          'vdmi_followup_for_grid_planning_owner',
          'fnav_decision_proposal',
        ],
        evidenceGaps: [
          [
            'missing_capability_descriptor',
            'add catalog and hydration provenance for ZNP/grid-planning capabilities',
          ],
          [
            'missing_evidence_source',
            'add Layer 1/2, G-Factor, NAP, or fNAV evidence source references',
          ],
        ],
      },
      'asset-management': {
        roleId: 'asset-management',
        label: 'Asset Management',
        profileRoleIds: ['asset_management', 'msb', 'esa'],
        vdmiResponsibilities: [
          'Cross-sparte asset facts, valuation context, and investment readiness',
          'Controllability, feedback capability, and asset handover evidence',
        ],
        readOnlyCapabilities: [
          'controllability_asset_handover',
          'imsys_taf2_compliance',
          'cls_digital_twin_compliance_gate',
          'legacy_control_technology_transition',
        ],
        advisoryCapabilities: [
          'grossspeicher_anschluss_readiness_gate',
          'owner_deadline_evidence_gate',
          'automation_risk_gate',
        ],
        consequentialFollowUps: [
          'asset_override_proposal',
          'vdmi_handover_task_for_asset_owner',
          'device_control_change_request',
        ],
        evidenceGaps: [
          [
            'missing_role_context',
            'add role-specific VDMI responsibility evidence for asset ownership',
          ],
          [
            'missing_evidence_source',
            'add asset, feedback capability, and source snapshot evidence references',
          ],
        ],
      },
      regulatory: {
        roleId: 'regulatory',
        label: 'Regulatory',
        profileRoleIds: ['regulierung', 'mako', 'billing', 'edm'],
        vdmiResponsibilities: [
          'Regulatory evidence for paragraph 14a, 14d, 42c, A96, and audit readiness',
          'MaKo, EDM, settlement, and compliance boundary visibility',
        ],
        readOnlyCapabilities: [
          'market_communication_evidence_chain',
          'mastr_quality_oemetadata',
          'energy_tax_information_package',
          'regulatory_change_readiness',
        ],
        advisoryCapabilities: [
          'owner_deadline_evidence_gate',
          'process_sensitization_readiness_map',
          'automation_risk_gate',
        ],
        consequentialFollowUps: [
          'legal_review_task',
          'regulatory_submission_proposal',
          'billing_or_mako_change_request',
        ],
        evidenceGaps: [
          [
            'missing_consequential_boundary',
            'add explicit legal/regulatory handoff classification',
          ],
          [
            'missing_evidence_source',
            'add MaKo, EDM, audit, or regulatory source evidence references',
          ],
        ],
      },
    };
    const sourceActions = {
      inspected: [
        'dashboard-api.stadtwerkMauerCapabilityProjectionStatus',
        'dashboard-api.stadtwerkMauerVdmiProfileStatus',
      ],
      referenced: [
        'capability-broker.recommend',
        'src/capability-catalog.js',
        'src/answer-dossier-hydration-rules.json',
        'llm.txt',
        'vdmi.dossier',
      ],
      notCalled: [
        'tenant.create',
        'user.create',
        'token.create',
        'eve.runtime.execute',
        'eve.agent.write',
        'agent-directory.write',
        'scheduler.create',
        'channel.open',
        'approval.create',
        'task.create',
        'workflow.execute',
        'notification.send',
        'hitl.create',
        'nova.mutate',
        'vdmi.mutate',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const roles = roleOrder
      .filter((roleId) => roleSpecs[roleId])
      .map((roleId) => {
        const spec = roleSpecs[roleId];
        const profileRoles = profile.roles.filter((role) => spec.profileRoleIds.includes(role.id));
        const evidenceGaps = spec.evidenceGaps.map(
          ([missingDataPoint, enablesDossierAddition]) => ({
            missingDataPoint,
            status: 'partial',
            enablesDossierAddition,
            category: 'stadtwerk_mauer_capability_projection',
            roleId: spec.roleId,
          })
        );
        return {
          roleId: spec.roleId,
          label: spec.label,
          vdmiResponsibilities: spec.vdmiResponsibilities,
          profileRoles: profileRoles.map((role) => ({
            id: role.id,
            label: role.label,
            type: role.type,
            vdmiResponsibility: role.vdmiResponsibility,
          })),
          readOnlyCapabilities: spec.readOnlyCapabilities.map((capability) => ({
            capability,
            classification: 'read_only',
            handoff: 'dossier_hydration_allowed',
          })),
          advisoryCapabilities: spec.advisoryCapabilities.map((capability) => ({
            capability,
            classification: 'advisory',
            handoff: 'dossier_or_vdmi_context_only',
          })),
          consequentialFollowUps: includeConsequential
            ? spec.consequentialFollowUps.map((followUp) => ({
                capability: followUp,
                classification: 'consequential_follow_up',
                handoff: 'proposal_task_vdmi_or_nova_only',
                executable: false,
              }))
            : [],
          evidenceGaps,
          positiveFollowUps: evidenceGaps.map((gap) => ({
            missingDataPoint: gap.missingDataPoint,
            status: gap.status,
            enablesDossierAddition: gap.enablesDossierAddition,
            category: gap.category,
          })),
          descriptorSources: includeDescriptorSources
            ? [
                'stadtwerk_mauer_vdmi_profile',
                'capability-catalog',
                'hydration-registry',
                'llm-descriptor',
              ]
            : [],
        };
      });
    const allEvidenceGaps = roles.flatMap((role) => role.evidenceGaps);
    const readOnlyCount = roles.reduce((sum, role) => sum + role.readOnlyCapabilities.length, 0);
    const advisoryCount = roles.reduce((sum, role) => sum + role.advisoryCapabilities.length, 0);
    const consequentialCount = roles.reduce(
      (sum, role) => sum + role.consequentialFollowUps.length,
      0
    );
    const dossierFacts = [
      'Projection: stadtwerk_mauer_capability_projection',
      `Tenant: ${tenantId}`,
      'Municipality: Mauer',
      'Postcode: 69256',
      `Roles: ${roles.map((role) => role.roleId).join(', ')}`,
      `Read-only capabilities: ${readOnlyCount}`,
      `Advisory capabilities: ${advisoryCount}`,
      `Consequential follow-ups: ${consequentialCount}`,
    ];

    return {
      stadtwerkMauerCapabilityProjectionStatusId: `smcp:${Buffer.from(
        `${tenantId}:${roles.map((role) => role.roleId).join(',') || 'none'}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      profileId: 'stadtwerk_mauer_vdmi_profile',
      projectionId: 'stadtwerk_mauer_capability_projection',
      capabilityKey: 'stadtwerk_mauer_capability_projection',
      safety: 'read_only',
      status: roles.length >= 4 ? 'projection_ready' : 'partial_role_projection',
      tenantId,
      municipality: 'Mauer',
      postcode: '69256',
      roles,
      classificationSummary: {
        readOnly: readOnlyCount,
        advisory: advisoryCount,
        consequentialFollowUps: consequentialCount,
        executableConsequentialActions: 0,
      },
      evidenceGaps: allEvidenceGaps,
      missingEvidence: allEvidenceGaps,
      positiveFollowUps: roles.flatMap((role) => role.positiveFollowUps),
      decisionBoundaries: [
        'read-only/advisory capabilities may be used for dossier grounding',
        'consequential capabilities are proposal/task/VDMI/NOVA handoff classes only',
        'Eve runtime, agent skeletons, event simulation, and artifact placement stay out of this slice',
      ],
      descriptorSources: includeDescriptorSources
        ? [
            'stadtwerk_mauer_vdmi_profile',
            'capability-catalog',
            'hydration-registry',
            'llm-descriptor',
          ]
        : [],
      sourceActions,
      validationFindings: allEvidenceGaps.map((gap, index) => ({
        code: `SMCP_${String(gap.missingDataPoint).toUpperCase()}_${index + 1}`,
        severity: 'medium',
        message: gap.enablesDossierAddition,
      })),
      dossierEvidence: {
        status: roles.length >= 4 ? 'projection_ready' : 'partial_role_projection',
        profileId: 'stadtwerk_mauer_vdmi_profile',
        projectionId: 'stadtwerk_mauer_capability_projection',
        tenantId,
        municipality: 'Mauer',
        postcode: '69256',
        roles,
        classificationSummary: {
          readOnly: readOnlyCount,
          advisory: advisoryCount,
          consequentialFollowUps: consequentialCount,
          executableConsequentialActions: 0,
        },
        evidenceGaps: allEvidenceGaps,
        positiveFollowUps: roles.flatMap((role) => role.positiveFollowUps),
        decisionBoundaries: [
          'read-only/advisory capabilities may be used for dossier grounding',
          'consequential capabilities are proposal/task/VDMI/NOVA handoff classes only',
          'Eve runtime, agent skeletons, event simulation, and artifact placement stay out of this slice',
        ],
        descriptorSources: includeDescriptorSources
          ? [
              'stadtwerk_mauer_vdmi_profile',
              'capability-catalog',
              'hydration-registry',
              'llm-descriptor',
            ]
          : [],
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildStadtwerkMauerEventReplayPreviewStatus(params = {}) {
    const normalize = (value) =>
      String(value || '')
        .trim()
        .toLowerCase();
    const hashString = (value) => {
      let hash = 2166136261;
      for (const char of String(value)) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36).padStart(7, '0');
    };
    const toCount = (value, max) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return Math.min(5, max);
      return Math.max(1, Math.min(max, Math.floor(parsed)));
    };
    const tenantId = 'stadtwerk-mauer';
    const seed = params.seed || 'stadtwerk-mauer-demo';
    const templates = [
      [
        'pv_anmeldung_elektriker',
        'PV-Anmeldung Elektriker',
        'strom',
        'VNB',
        'Elektriker',
        'PV-Anlage mit unvollstaendiger NAP-Referenz',
        ['vnb', 'netzplanung'],
        ['grid_connection_transformation_gate', 'owner_deadline_evidence_gate'],
        'Netzanschluss/Einspeiser-Dossier',
        'netzanschluss',
        'partial',
        'advisory_only',
      ],
      [
        'pv_speicher_wallbox_kombi',
        'PV + Speicher + Wallbox Kombination',
        'strom',
        'VNB',
        'Elektriker',
        'Kombinierter Anschlussfall mit Speicher und steuerbarer Verbrauchseinrichtung',
        ['vnb', 'asset_management', 'esa'],
        ['grossspeicher_anschluss_readiness_gate', 'controllability_asset_handover'],
        'Flex-/Asset-Handover-Dossier',
        'asset-management',
        'partial',
        'consequential_requires_followup',
      ],
      [
        'pv_erweiterung_bestand',
        'PV-Erweiterung Bestand',
        'strom',
        'VNB',
        'Betreiber',
        'Erweiterung einer bestehenden PV-Anlage mit MaStR-Abgleich',
        ['vnb', 'netzplanung'],
        ['mastr_quality_oemetadata', 'grid_connection_transformation_gate'],
        'MaStR/Netzanschluss-Klaerfall',
        'netzplanung',
        'partial',
        'advisory_only',
      ],
      [
        'waermepumpe_wallbox_last',
        'Waermepumpe/Wallbox/Gewerbe-Last',
        'strom',
        'VNB',
        'Kunde',
        'Anschlussbegehren fuer neue flexible Last',
        ['vnb', 'netzplanung', 'edm'],
        ['znp_production_readiness_evidence_gate', 'owner_deadline_evidence_gate'],
        'Last-/ZNP-Folgefrage',
        'netzplanung',
        'missing',
        'advisory_only',
      ],
      [
        'lieferantenwechsel_mako',
        'Lieferantenwechsel per MaKo',
        'strom',
        'MaKo',
        'Lieferant',
        'Lieferantenwechsel mit fehlender MaLo-/MeLo-Pruefung',
        ['mako', 'lf', 'msb'],
        ['market_communication_evidence_chain'],
        'MaKo-Evidenzkette',
        'mako',
        'partial',
        'advisory_only',
      ],
      [
        'malo_melo_widerspruch',
        'MaLo/MeLo Widerspruch',
        'strom',
        'MSB',
        'MSB',
        'Widerspruechliche MaLo-/MeLo-/MSB-Daten',
        ['msb', 'mako', 'edm'],
        ['market_communication_evidence_chain', 'controllability_asset_handover'],
        'Messwesen-Klaerfall',
        'edm',
        'missing',
        'advisory_only',
      ],
      [
        'gpke_mscons_status',
        'GPKE/MSCONS Statusmeldung',
        'strom',
        'MaKo',
        'Lieferant',
        'Statusmeldung mit offenem Zaehlerstand',
        ['mako', 'edm', 'billing'],
        ['market_communication_evidence_chain'],
        'MaKo/Abrechnung-Evidenz',
        'mako',
        'partial',
        'advisory_only',
      ],
      [
        'zaehlerablesung_unplausibel',
        'Unplausible Zaehlerablesung',
        'strom',
        'EDM',
        'Kunde',
        'Manuelle Zaehlerablesung kommt verspaetet oder widerspruechlich',
        ['edm', 'billing', 'msb'],
        ['owner_deadline_evidence_gate'],
        'EDM-Plausibilitaets-Follow-up',
        'edm',
        'partial',
        'advisory_only',
      ],
      [
        'imsys_luecken_lastgang',
        'iMSys lueckenhafter Lastgang',
        'strom',
        'MSB',
        'MSB',
        'Viertelstundenwerte enthalten Luecken',
        ['msb', 'edm', 'esa'],
        ['imsys_taf2_compliance', 'cls_digital_twin_compliance_gate'],
        'Messdatenqualitaet-Dossier',
        'msb',
        'partial',
        'advisory_only',
      ],
      [
        'zaehlerwechsel_gateway_stoerung',
        'Zaehlerwechsel / Gateway-Stoerung',
        'strom',
        'MSB',
        'MSB',
        'Geraetewechsel mit Gateway-Stoerungsmeldung',
        ['msb', 'asset_management'],
        ['controllability_asset_handover'],
        'Asset-/Messstellen-Handover',
        'msb',
        'partial',
        'advisory_only',
      ],
      [
        'kundenservice_netzanschlussstatus',
        'Kundenfrage Netzanschlussstatus',
        'uebergreifend',
        'VNB',
        'Kunde',
        'Kunde fragt nach Bearbeitungsstand',
        ['vnb', 'kundenservice'],
        ['netzprozess_readiness_gate', 'owner_deadline_evidence_gate'],
        'Owner-Frist-Evidenzsicht',
        'kundenservice',
        'missing',
        'read_only_event',
      ],
      [
        'kundenservice_falsche_rechnung',
        'Kundenmeldung falsche Rechnung',
        'strom',
        'Billing',
        'Kunde',
        'Rechnung wirkt falsch wegen unklarer Messwerte',
        ['billing', 'edm', 'mako'],
        ['market_communication_evidence_chain'],
        'Billing-Grenzfall ohne Abrechnungsausloesung',
        'billing',
        'partial',
        'consequential_requires_followup',
      ],
      [
        'umzug_zaehlerstand_fehlt',
        'Umzug mit fehlendem Zaehlerstand',
        'strom',
        'LF',
        'Kunde',
        'Einzug/Auszug ohne belastbaren Zaehlerstand',
        ['lf', 'mako', 'billing'],
        ['market_communication_evidence_chain', 'owner_deadline_evidence_gate'],
        'Umzugs-/MaKo-Klaerfall',
        'mako',
        'missing',
        'advisory_only',
      ],
      [
        'gas_kapazitaetsannahme_aendert',
        'Gas-Kapazitaetsannahme aendert sich',
        'gas',
        'VNB',
        'Kommune',
        'Neue Annahme fuer Gasnetz-Kapazitaet im Fotojahr',
        ['vnb', 'regulierung', 'asset_management'],
        ['gas_capacity_order_revision_gate', 'gas_transformation_dependency_map'],
        'Gasnetz-Transformationsdossier',
        'asset-management',
        'partial',
        'advisory_only',
      ],
      [
        'waermeplanung_gasfolgefrage',
        'Kommunale Waermeplanung erzeugt Gasfolgefrage',
        'waerme',
        'VNB',
        'Kommune',
        'Waermeplanung kollidiert mit Gasnetzrueckbauannahme',
        ['regulierung', 'netzplanung', 'management'],
        ['heat_transformation_line_asset_model', 'gas_decommissioning_roadmap'],
        'Waerme/Gas-Abhaengigkeitsdossier',
        'management',
        'partial',
        'advisory_only',
      ],
      [
        'wasserablesung_unplausibel',
        'Wasserzaehlerablesung unplausibel',
        'wasser',
        'VNB',
        'Kunde',
        'Wasserzaehlerablesung fehlt oder wirkt unplausibel',
        ['asset_management', 'billing'],
        ['owner_deadline_evidence_gate'],
        'Wasser-Evidenzklaerung',
        'asset-management',
        'missing',
        'read_only_event',
      ],
      [
        'fernwaerme_anschluss_tarif',
        'Fernwaerme Anschluss-/Tariffrage',
        'waerme',
        'VNB',
        'Kunde',
        'Anschlussbegehren mit Tarif-/Asset-Folgefrage',
        ['vnb', 'billing', 'asset_management'],
        ['heat_asset_tariff_steering'],
        'Waerme Asset/Tarif-Dossier',
        'billing',
        'partial',
        'advisory_only',
      ],
      [
        'waermepumpe_ersetzt_gas',
        'Waermepumpe ersetzt Gasheizung',
        'uebergreifend',
        'VNB',
        'Kunde',
        'Spartenuebergreifender Fall mit Stromnetz-, Gasnetz- und Waermefolge',
        ['vnb', 'netzplanung', 'asset_management', 'management'],
        ['stadtwerk_mauer_capability_projection', 'gas_transformation_dependency_map'],
        'Spartenuebergreifendes Transformationsdossier',
        'management',
        'partial',
        'advisory_only',
      ],
      [
        'ns_engpass_hinweis',
        'Niederspannungsengpass-Hinweis',
        'strom',
        'VNB',
        'Netzbetrieb',
        'Operativer Engpasshinweis ohne Steuerhandlung',
        ['netzplanung', 'netzbetrieb', 'esa'],
        ['znp_production_readiness_evidence_gate', 'redispatch_readiness_gate'],
        'Netzsignal-Dossier',
        'netzbetrieb',
        'partial',
        'consequential_requires_followup',
      ],
      [
        'trafo_auslastungswarnung',
        'Ortsnetztransformator Auslastungswarnung',
        'strom',
        'VNB',
        'Netzbetrieb',
        'Trafostation zeigt Auslastungswarnung',
        ['netzplanung', 'asset_management'],
        ['grossspeicher_anschluss_readiness_gate', 'owner_deadline_evidence_gate'],
        'Asset-/ZNP-Risikodossier',
        'asset-management',
        'partial',
        'advisory_only',
      ],
      [
        'redispatch_speicher_gemeldet',
        'Redispatch-relevanter Speicher gemeldet',
        'strom',
        'ESA',
        'Erzeuger',
        'Speicher wird als flexibilitaetsrelevant gemeldet',
        ['esa', 'vnb', 'asset_management'],
        ['redispatch_readiness_gate', 'battery_redispatch_special_gate'],
        'Redispatch-Speicher-Dossier',
        'esa',
        'partial',
        'consequential_requires_followup',
      ],
      [
        'wartungsfenster_kollision',
        'Wartungsfenster kollidiert mit MaKo/Kundenprozess',
        'uebergreifend',
        'VNB',
        'Netzbetrieb',
        'Wartung ueberschneidet sich mit MaKo- und Kundenservice-Fall',
        ['netzbetrieb', 'mako', 'kundenservice'],
        ['process_sensitization_readiness_map', 'owner_deadline_evidence_gate'],
        'Betriebskoordination-Dossier',
        'netzbetrieb',
        'partial',
        'advisory_only',
      ],
      [
        'bilanzkreis_prognoseabweichung',
        'Bilanzkreis Prognoseabweichung',
        'strom',
        'BKV',
        'BKV',
        'Prognoseabweichung erzeugt Beschaffungs-/Erzeugungsfolge',
        ['bkv', 'beschaffung', 'erzeugungsplanung'],
        ['energy_market_price_risk', 'owner_deadline_evidence_gate'],
        'BKV/Beschaffung-Dossier',
        'beschaffung',
        'partial',
        'advisory_only',
      ],
      [
        'kommunale_erzeugung_ausfall',
        'Kommunale Erzeugungsanlage faellt aus',
        'strom',
        'Erzeugung',
        'Erzeuger',
        'Erzeugungsfahrplan passt nicht zur Lastannahme',
        ['erzeugungsplanung', 'bkv', 'edm'],
        ['market_communication_evidence_chain'],
        'Erzeugungs-/EDM-Klaerfall',
        'erzeugungsplanung',
        'partial',
        'advisory_only',
      ],
      [
        'energy_sharing_42c_fall',
        'Energy-Sharing / §42c Folgefall',
        'uebergreifend',
        'LF',
        'Kommune',
        'Energy-Sharing-Fall erzeugt Bilanzierungs-/Settlement-Folge',
        ['lf', 'bkv', 'billing', 'regulierung'],
        ['energy_sharing_simulation_gate', 'market_communication_evidence_chain'],
        '§42c/Bilanzierungs-Dossier',
        'regulierung',
        'partial',
        'consequential_requires_followup',
      ],
    ].map(
      ([
        eventType,
        title,
        sparte,
        marketRole,
        sourceActor,
        payloadSummary,
        vdmiRoles,
        capabilities,
        dossierPath,
        nextOwner,
        evidenceQuality,
        sideEffectPolicy,
      ]) => ({
        templateId: `sm-event:${eventType}`,
        eventType,
        title,
        sparte,
        marketRole,
        sourceActor,
        payload: { summary: payloadSummary, municipality: 'Mauer', postcode: '69256' },
        expectedRouting: {
          vdmiRoles,
          capabilities,
          dossierPath,
          nextOwner,
        },
        evidenceQuality,
        sideEffectPolicy,
        positiveFollowUps: [
          {
            missingDataPoint: `${eventType}_evidence`,
            status: evidenceQuality === 'missing' ? 'missing' : 'partial',
            enablesDossierAddition: `add supplied evidence for ${title} to ${dossierPath}`,
            category: 'stadtwerk_mauer_event_replay_preview',
          },
        ],
      })
    );
    const match = (value, filter) => !filter || normalize(value) === normalize(filter);
    const filteredTemplates = templates.filter(
      (template) =>
        match(template.eventType, params.eventType) &&
        match(template.sparte, params.sparte) &&
        match(template.marketRole, params.marketRole) &&
        match(template.sourceActor, params.sourceActor)
    );
    const activeTemplates = filteredTemplates.length > 0 ? filteredTemplates : templates;
    const count = toCount(params.count, activeTemplates.length);
    const replayPreview = activeTemplates
      .map((template) => ({ template, rank: hashString(`${seed}:${template.templateId}`) }))
      .sort((a, b) => a.rank.localeCompare(b.rank))
      .slice(0, count)
      .map(({ template }, index) => ({
        eventId: `sme:${hashString(`${seed}:${template.templateId}:${index}`)}`,
        tenantId,
        occurredAt: new Date(Date.UTC(2026, 0, 1, index, 0, 0)).toISOString(),
        eventType: template.eventType,
        sparte: template.sparte,
        marketRole: template.marketRole,
        sourceActor: template.sourceActor,
        payload: template.payload,
        expectedRouting: template.expectedRouting,
        evidenceQuality: template.evidenceQuality,
        sideEffectPolicy: template.sideEffectPolicy,
        followUpClass:
          template.sideEffectPolicy === 'consequential_requires_followup'
            ? 'proposal_task_vdmi_or_nova_only'
            : 'dossier_or_owner_evidence_followup',
      }));
    const countBy = (items, field) =>
      items.reduce((acc, item) => {
        acc[item[field]] = (acc[item[field]] || 0) + 1;
        return acc;
      }, {});
    const sourceActions = {
      inspected: ['dashboard-api.stadtwerkMauerEventReplayPreviewStatus'],
      referenced: [
        'dashboard-api.stadtwerkMauerCapabilityProjectionStatus',
        'dashboard-api.stadtwerkMauerVdmiProfileStatus',
        'capability-broker.recommend',
        'dossier-hydration.registry',
      ],
      notCalled: [
        'scheduler.create',
        'cron.schedule',
        'event.inject',
        'event.persist',
        'queue.publish',
        'stream.publish',
        'eve.runtime.execute',
        'agent.execute',
        'customer-communication.send',
        'market-communication.send',
        'msb.portal.call',
        'lieferant.portal.call',
        'elektriker.portal.call',
        'external.connector.call',
        'workflow.execute',
        'task.create',
        'notification.send',
        'hitl.create',
        'nova.mutate',
        'vdmi.mutate',
        'grid-operations.executeControl',
        'device-control.execute',
        'billing.release',
        'settlement.exportA96',
        'tariff.mutate',
        'switching.execute',
        'personal-agent.execute',
      ],
    };
    const positiveFollowUps = activeTemplates.flatMap((template) => template.positiveFollowUps);
    const dossierFacts = [
      'Capability: stadtwerk_mauer_event_replay_preview',
      `Tenant: ${tenantId}`,
      `Templates: ${templates.length}`,
      `Replay seed: ${seed}`,
      `Replay count: ${replayPreview.length}`,
      `First event: ${replayPreview[0]?.eventType || 'none'}`,
    ];

    return {
      stadtwerkMauerEventReplayPreviewStatusId: `smerp:${hashString(`${seed}:${count}:${activeTemplates.length}`)}`,
      capabilityKey: 'stadtwerk_mauer_event_replay_preview',
      safety: 'read_only',
      status: templates.length >= 20 ? 'catalog_ready' : 'catalog_incomplete',
      catalogStatus: 'deterministic_read_only_preview',
      tenantId,
      municipality: 'Mauer',
      postcode: '69256',
      seed,
      count,
      templateCount: templates.length,
      filteredTemplateCount: activeTemplates.length,
      taxonomyCoverage: {
        bySparte: countBy(templates, 'sparte'),
        byMarketRole: countBy(templates, 'marketRole'),
        bySourceActor: countBy(templates, 'sourceActor'),
        byEvidenceQuality: countBy(templates, 'evidenceQuality'),
        bySideEffectPolicy: countBy(templates, 'sideEffectPolicy'),
      },
      eventTemplates: activeTemplates,
      replayPreview,
      evidenceGaps: positiveFollowUps,
      missingEvidence: positiveFollowUps.filter((followUp) => followUp.status === 'missing'),
      positiveFollowUps,
      decisionBoundaries: [
        'deterministic replay preview only',
        'no scheduler, persistence, injection, queue, stream, Eve runtime, or agent execution',
        'consequential outcomes stay proposal/task/VDMI/NOVA follow-up classes only',
        'no real customer, MaKo, MSB, supplier, electrician, billing, settlement, tariff, switching, or device-control action',
      ],
      sourceActions,
      validationFindings: positiveFollowUps.map((followUp, index) => ({
        code: `SMERP_${String(followUp.missingDataPoint).toUpperCase()}_${index + 1}`,
        severity: followUp.status === 'missing' ? 'medium' : 'info',
        message: followUp.enablesDossierAddition,
      })),
      dossierEvidence: {
        status: templates.length >= 20 ? 'catalog_ready' : 'catalog_incomplete',
        capabilityKey: 'stadtwerk_mauer_event_replay_preview',
        tenantId,
        municipality: 'Mauer',
        postcode: '69256',
        seed,
        templateCount: templates.length,
        replayPreview,
        taxonomyCoverage: {
          bySparte: countBy(templates, 'sparte'),
          byMarketRole: countBy(templates, 'marketRole'),
          bySourceActor: countBy(templates, 'sourceActor'),
          byEvidenceQuality: countBy(templates, 'evidenceQuality'),
        },
        positiveFollowUps: positiveFollowUps.slice(0, 10),
        decisionBoundaries: [
          'deterministic replay preview only',
          'consequential outcomes stay proposal/task/VDMI/NOVA follow-up classes only',
        ],
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildMissingStadtwerkMauerSandboxRuntimeStatus(tenantId = 'stadtwerk-mauer') {
    const missingLifecycleEvidence = [
      {
        missingDataPoint: 'sandbox_runtime_status',
        enablesDossierAddition: 'add Stadtwerk Mauer sandbox runtime status evidence',
      },
    ];
    return {
      capabilityKey: 'stadtwerk_mauer_sandbox_runtime',
      safety: 'read_only_status_for_non_consequential_sandbox_runtime',
      tenantId,
      requiredTenantId: 'stadtwerk-mauer',
      sandboxBoundaryAllowed: tenantId === 'stadtwerk-mauer',
      status: 'sandbox_runtime_status_unavailable',
      eventCount: 0,
      artifactCount: 0,
      derivedStateInventory: {
        event_instance: 0,
        dossier_addition: 0,
        follow_up_proposal: 0,
        stub_transcript_placeholder: 0,
        outbox_queue_placeholder: 0,
        audit_artifact: 0,
      },
      resetDeleteReadiness: {
        canReset: false,
        canDelete: false,
        idempotent: true,
        scopedToTenant: 'stadtwerk-mauer',
        wouldDeleteArtifactCount: 0,
      },
      lastResetResult: null,
      missingLifecycleEvidence,
      positiveFollowUps: missingLifecycleEvidence.map((item) => ({
        ...item,
        category: 'stadtwerk_mauer_sandbox_runtime',
      })),
      sourceActions: {
        inspected: ['dashboard-api.stadtwerkMauerSandboxRuntimeStatus'],
        referenced: ['stadtwerk-mauer-sandbox-runtime.status'],
        notCalled: [
          'mako.dispatch',
          'customer-service.send',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'switching.execute',
          'webhook.emit',
          'device-control.execute',
          'external.connector.call',
          'hitl.create',
          'personal-agent.execute',
          'tenant.delete.production',
        ],
      },
      dossierEvidence: {
        status: 'sandbox_runtime_status_unavailable',
        tenantId,
        eventCount: 0,
        artifactCount: 0,
        missingLifecycleEvidence,
        positiveFollowUps: missingLifecycleEvidence.map((item) => ({
          ...item,
          category: 'stadtwerk_mauer_sandbox_runtime',
        })),
        dossierFacts: [
          'Status: sandbox_runtime_status_unavailable',
          'Sandbox events: 0',
          'Sandbox artifacts: 0',
        ],
      },
    };
  },

  buildMissingStadtwerkMauerExternalInterfaceStubsStatus(tenantId = 'stadtwerk-mauer') {
    const missingEvidence = [
      {
        missingDataPoint: 'stub_status',
        enablesDossierAddition: 'add Stadtwerk Mauer external-interface stub status evidence',
      },
    ];
    const sourceActions = {
      inspected: ['dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus'],
      referenced: ['stadtwerk-mauer-external-interface-stubs.getStatus'],
      notCalled: [
        'mako.dispatch',
        'msb.connector.call',
        'edm.connector.call',
        'customer-service.send',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'contract.execute',
        'webhook.emit',
        'device-control.execute',
        'smgw.connector.call',
        'eebus.connector.call',
        'nes2.connector.call',
        'cls.control.execute',
        'external.connector.call',
        'hitl.create',
        'personal-agent.execute',
      ],
    };
    return {
      capabilityKey: 'stadtwerk_mauer_external_interface_stubs',
      safety: 'sandbox_only_non_consequential_stubs_with_read_only_status',
      tenantId,
      requiredTenantId: 'stadtwerk-mauer',
      sandboxBoundaryAllowed: tenantId === 'stadtwerk-mauer',
      status: 'stub_status_unavailable',
      transcriptCount: 0,
      artifactCount: 0,
      familyCounts: {},
      variantCounts: {},
      recentTranscripts: [],
      missingEvidence,
      positiveFollowUps: missingEvidence.map((item) => ({
        ...item,
        category: 'stadtwerk_mauer_external_interface_stubs',
      })),
      resetBoundary: {
        service: 'stadtwerk-mauer-sandbox-runtime.reset',
        scopedToTenant: 'stadtwerk-mauer',
      },
      sourceActions,
      dossierEvidence: {
        status: 'stub_status_unavailable',
        tenantId,
        transcriptCount: 0,
        artifactCount: 0,
        missingEvidence,
        positiveFollowUps: missingEvidence.map((item) => ({
          ...item,
          category: 'stadtwerk_mauer_external_interface_stubs',
        })),
        sourceActions,
        dossierFacts: [
          'Stub Status: stub_status_unavailable',
          `Tenant: ${tenantId}`,
          'Transcripts: 0',
        ],
      },
    };
  },

  buildMissingStadtwerkMauerE2eProcessDemoStatus(tenantId = 'stadtwerk-mauer', caseId = null) {
    const missingEvidence = [
      {
        missingDataPoint: 'e2e_demo_status',
        enablesDossierAddition: 'add Stadtwerk Mauer E2E demo trace status evidence',
      },
    ];
    const sourceActions = {
      inspected: ['dashboard-api.stadtwerkMauerE2eProcessDemoStatus'],
      referenced: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
      notCalled: [
        'mako.dispatch',
        'msb.connector.call',
        'edm.connector.call',
        'customer-service.send',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'switching.execute',
        'webhook.emit',
        'device-control.execute',
        'smgw.connector.call',
        'cls.control.execute',
        'external.connector.call',
        'hitl.create',
        'personal-agent.execute',
        'tenant.delete.production',
      ],
    };
    return {
      capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
      safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
      tenantId,
      requiredTenantId: 'stadtwerk-mauer',
      sandboxBoundaryAllowed: tenantId === 'stadtwerk-mauer',
      status: 'e2e_demo_status_unavailable',
      demoPath: 'pv_registration_electrician_missing_nap',
      caseId,
      traceCount: 0,
      artifactCount: 0,
      recentTraces: [],
      rolesAndCapabilities: [],
      evidenceQuality: 'unavailable',
      missingEvidence,
      positiveFollowUps: missingEvidence.map((item) => ({
        ...item,
        category: 'stadtwerk_mauer_e2e_process_demo',
      })),
      resetBoundary: {
        service: 'stadtwerk-mauer-sandbox-runtime.reset',
        scopedToTenant: 'stadtwerk-mauer',
      },
      sourceActions,
      dossierEvidence: {
        status: 'e2e_demo_status_unavailable',
        tenantId,
        demoPath: 'pv_registration_electrician_missing_nap',
        caseId,
        traceCount: 0,
        artifactCount: 0,
        missingEvidence,
        positiveFollowUps: missingEvidence.map((item) => ({
          ...item,
          category: 'stadtwerk_mauer_e2e_process_demo',
        })),
        sourceActions,
        dossierFacts: [
          'E2E Demo Status: e2e_demo_status_unavailable',
          `Tenant: ${tenantId}`,
          'Traces: 0',
        ],
      },
    };
  },

  buildStadtwerkMauerCaseDetailStatus({
    tenantId = 'stadtwerk-mauer',
    caseId,
    e2eStatus = {},
    annotationStatus = null,
  }) {
    const seed = stadtwerkMauerPvMissingNap;
    const requiredCaseId = caseId || 'smm-budibase-workbench';
    const sandboxBoundaryAllowed = tenantId === seed.demoTenant.tenantId;
    const traces = Array.isArray(e2eStatus.recentTraces) ? e2eStatus.recentTraces : [];
    const selectedTrace =
      traces.find((trace) => trace.caseId === requiredCaseId) ||
      (e2eStatus.caseId === requiredCaseId && traces[0] ? traces[0] : null);
    const hasCase =
      sandboxBoundaryAllowed &&
      (selectedTrace != null || requiredCaseId === 'smm-budibase-workbench');

    const evidence = this.buildStadtwerkMauerCaseEvidence(seed, e2eStatus);
    const missingEvidence = evidence
      .filter((item) => item.state !== 'present')
      .map((item) => ({
        missingDataPoint: item.id,
        enablesDossierAddition: item.enablesDossierAddition,
        dataClass: item.dataClass,
        state: item.state,
      }));
    if (!sandboxBoundaryAllowed) {
      missingEvidence.unshift({
        missingDataPoint: 'stadtwerk_mauer_tenant_scope',
        enablesDossierAddition:
          'select the synthetic tenant stadtwerk-mauer before rendering demo case details',
        dataClass: 'syntheticTenantSeed',
        state: 'clarification',
      });
    }

    const positiveFollowUps = missingEvidence.map((item) => ({
      ...item,
      category: 'stadtwerk_mauer_case_detail',
    }));
    const traceSummaries = traces.slice(0, 5).map((trace) => ({
      traceId: trace.traceId || null,
      caseId: trace.caseId || null,
      demoPath: trace.demoPath || seed.processFamily,
      status: trace.status || null,
      evidenceQuality: trace.evidenceQuality || null,
      transcriptId: trace.transcriptId || null,
      dataClass: 'sandboxRuntimeArtifact',
    }));
    const artifactSummaries = [
      {
        artifactKind: 'blueprint_seed',
        label: seed.title,
        sourceRef: seed.id,
        dataClass: 'syntheticTenantSeed',
      },
      {
        artifactKind: 'operations_runbook_hint',
        label: 'Blueprint Pack verify endpoint',
        sourceRef: '/api/operations-runbook/vdmi-blueprint-packs/verify',
        dataClass: 'sandboxRuntimeArtifact',
        execution: 'not_executed',
      },
      ...traceSummaries.map((trace) => ({
        artifactKind: 'process_trace_summary',
        label: trace.traceId || 'selected trace summary',
        sourceRef: trace.traceId || null,
        dataClass: 'sandboxRuntimeArtifact',
      })),
    ];
    const roleWorkbenchHints = seed.roles.map((role) => ({
      roleId: role.roleId,
      relation: role.relation,
      responsibility: role.responsibility,
      workbenchHint:
        role.roleId === 'ROLE_NETZPLANUNG'
          ? 'inspect NAP clarification and grid-capacity context'
          : role.roleId === 'ROLE_GRID_OPERATOR'
            ? 'inspect grid-operation plausibility without control execution'
            : 'inspect commercial/audit evidence gaps without billing or settlement action',
    }));
    const annotationRows = Array.isArray(annotationStatus?.annotationRows)
      ? annotationStatus.annotationRows
      : [];
    const annotationAuditRows = Array.isArray(annotationStatus?.auditRows)
      ? annotationStatus.auditRows
      : [];
    const noCallGuards = Array.from(
      new Set([
        ...(seed.forbiddenActions || []),
        ...(e2eStatus.sourceActions?.notCalled || []),
        'budibase.table.write',
        'budibase.api.call',
        'rundeck.job.execute',
        'operations-runbook.execute',
        'mako.dispatch',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'device-control.execute',
        'hitl.create',
        'public-context.mutate',
        'personal-agent.execute',
      ])
    );
    const status = !sandboxBoundaryAllowed
      ? 'case_detail_blocked_outside_sandbox_tenant'
      : hasCase
        ? missingEvidence.length > 0
          ? 'case_detail_needs_evidence'
          : 'case_detail_ready'
        : 'case_detail_not_found';
    const found = sandboxBoundaryAllowed && hasCase;
    const dataClasses = Object.entries(seed.dataClasses || {}).map(([id, value]) => ({
      id,
      description: value.description,
      examples: value.examples || [],
    }));
    const dossierFacts = [
      `Case Detail Status: ${status}`,
      `Tenant: ${tenantId}`,
      `Case: ${requiredCaseId}`,
      `Blueprint Seed: ${seed.id}`,
      `Evidence gaps: ${missingEvidence.length}`,
    ];
    const nextGates = [
      {
        id: 'verify_blueprint_seed',
        label: 'Verify Blueprint Pack seed',
        endpoint: '/api/operations-runbook/vdmi-blueprint-packs/verify',
        execution: 'hint_only',
      },
      {
        id: 'inspect_missing_nap',
        label: 'Inspect missing NAP and evidence gaps',
        execution: 'read_only_workbench',
      },
      {
        id: 'review_role_workbench_item',
        label: 'Review generated role-workbench handover item',
        execution: 'read_only_workbench',
      },
    ];

    return {
      capabilityKey: 'stadtwerk_mauer_case_detail',
      safety: 'read_only',
      found,
      status,
      tenantId,
      requiredTenantId: seed.demoTenant.tenantId,
      sandboxBoundaryAllowed,
      caseId: requiredCaseId,
      demoPath: 'pv_registration_electrician_missing_nap',
      processFamily: seed.processFamily,
      controlCase: seed.controlCase,
      blueprintSeedId: seed.id,
      realWorldClaim: seed.realWorldClaim,
      dataClasses,
      caseSummary: {
        status,
        currentDemoStatus: annotationStatus?.currentDemoStatus || 'needs_evidence',
        annotationCount: annotationRows.length,
        evidenceQuality: e2eStatus.evidenceQuality || 'no_demo_trace_yet',
        traceCount: e2eStatus.traceCount || 0,
        artifactCount: e2eStatus.artifactCount || 0,
        syntheticIdDisclaimer:
          'Stadtwerk Mauer case, MaLo, MeLo, meter, consent and device-control values are synthetic demo identifiers unless explicitly marked as public context.',
      },
      evidence,
      evidenceRows: this.buildStadtwerkMauerCaseEvidenceRows(evidence),
      missingEvidence,
      positiveFollowUps,
      traceSummaries: found ? traceSummaries : [],
      artifactSummaries: found ? artifactSummaries : [],
      annotationRows: found ? annotationRows : [],
      annotationAuditRows: found ? annotationAuditRows : [],
      roleWorkbenchHints,
      nextGates,
      nextGateRows: this.buildStadtwerkMauerNextGateRows(nextGates),
      operationsRunbookHints: [
        {
          id: 'vdmi-blueprint-pack-verify',
          method: 'GET',
          path: '/api/operations-runbook/vdmi-blueprint-packs/verify?seedId=stadtwerk-mauer-pv-missing-nap-v1',
          execution: 'not_executed_by_case_detail',
        },
        {
          id: 'stadtwerk-mauer-e2e-smoke',
          method: 'POST',
          path: '/api/operations-runbook/stadtwerk-mauer/e2e-smoke',
          execution: 'curated_runbook_only_not_budibase_table_write',
        },
      ],
      capabilityBroker: {
        exposed: false,
        reason:
          'First slice is a Workbench/dashboard read model; no broad broker route or case-editing intent is registered.',
      },
      hydrationRegistry: {
        exposed: false,
        reason:
          'No Personal-Agent dossier hydration rule is added in this first Workbench-only slice.',
      },
      forbiddenActions: seed.forbiddenActions || [],
      sourceActions: {
        inspected: ['dashboard-api.stadtwerkMauerCaseDetailStatus'],
        referenced: [
          'stadtwerk-mauer-e2e-process-demo.getStatus',
          'stadtwerk-mauer-sandbox-runtime.listCaseAnnotations',
          'src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-pv-missing-nap-v1.json',
          'operations-runbook.verifyVdmiBlueprintPackSeed',
          'governance.roleWorkbenchProjection',
        ],
        notCalled: noCallGuards,
      },
      noCallGuards,
      dossierFacts,
      dossierEvidence: {
        status,
        tenantId,
        caseId: requiredCaseId,
        processFamily: seed.processFamily,
        controlCase: seed.controlCase,
        evidence,
        missingEvidence,
        positiveFollowUps,
        roleWorkbenchHints,
        annotationRows: found ? annotationRows : [],
        annotationAuditRows: found ? annotationAuditRows : [],
        traceSummaries: found ? traceSummaries : [],
        nextGates: ['verify_blueprint_seed', 'inspect_missing_nap', 'review_role_workbench_item'],
        noCallGuards,
        dossierFacts,
      },
      meta: {
        inspected: [
          'dashboard-api.stadtwerkMauerCaseDetailStatus',
          'stadtwerk-mauer-e2e-process-demo.getStatus',
          'vdmi-blueprint-pack-seeds',
        ],
      },
    };
  },

  buildStadtwerkMauerBlueprintPackVerifyStatus({
    tenantId = 'stadtwerk-mauer',
    seedId = stadtwerkMauerPvMissingNap.id,
  } = {}) {
    const seed = tenantId === 'stadtwerk-mauer' ? getVdmiBlueprintPackSeed(seedId) : null;
    const validation = validateVdmiBlueprintPackSeed(seed);
    const warnings = validation.valid ? [] : validation.errors;
    const evidenceRequirements = Array.isArray(seed?.evidenceRequirements)
      ? seed.evidenceRequirements
      : [];
    const roles = Array.isArray(seed?.roles) ? seed.roles : [];
    const forbiddenActions = Array.isArray(seed?.forbiddenActions) ? seed.forbiddenActions : [];
    const commandHints = Array.isArray(seed?.allowedCommandHints) ? seed.allowedCommandHints : [];
    const clarificationItems = seed ? buildWorkbenchClarificationItems(seed) : [];
    const matrixSync = seed ? buildDemoProcessMatrixSync(seed) : null;
    const dataClasses = seed?.dataClasses || {};
    const requiredEvidence = evidenceRequirements.map((item) => item.id).filter(Boolean);
    const missingEvidence = evidenceRequirements
      .filter((item) => item.required !== false)
      .map((item) => ({
        missingDataPoint: item.id,
        state: item.missingState || 'evidence_gap',
        enablesDossierAddition: item.enablesDossierAddition || null,
      }));
    const budibaseHint = commandHints.find((hint) => String(hint.id || '').startsWith('budibase:'));
    const runbookHint = commandHints.find((hint) => String(hint.id || '').startsWith('rundeck:'));
    const data = {
      seedId,
      tenantId,
      seedFound: Boolean(seed),
      classification: seed?.demoTenant?.classification || null,
      processFamily: seed?.processFamily || null,
      controlCase: seed?.controlCase || null,
      safetyClassification: 'read_only',
      requiredScope: 'none_for_dashboard_read_model',
      validation,
      publicContextLayer: {
        present: Boolean(dataClasses.publicContextLayer),
        mutable: false,
        description: dataClasses.publicContextLayer?.description || null,
        examples: dataClasses.publicContextLayer?.examples || [],
      },
      syntheticTenantSeed: {
        present: Boolean(dataClasses.syntheticTenantSeed),
        syntheticOnly: seed?.realWorldClaim === 'synthetic_demo_only',
        description: dataClasses.syntheticTenantSeed?.description || null,
        examples: dataClasses.syntheticTenantSeed?.examples || [],
      },
      sandboxRuntimeArtifacts: {
        present: Boolean(dataClasses.sandboxRuntimeArtifact),
        ignoredByVerify: true,
        resettable: true,
        description: dataClasses.sandboxRuntimeArtifact?.description || null,
        examples: dataClasses.sandboxRuntimeArtifact?.examples || [],
      },
      requiredEvidence,
      missingEvidence,
      roleRelations: roles.map((role) => ({
        roleId: role.roleId,
        relation: role.relation,
        responsibility: role.responsibility,
      })),
      workbenchClarificationItems: clarificationItems,
      workbenchProjectionHint: {
        role: 'ROLE_NETZPLANUNG',
        targetEndpoint: '/api/governance/role-workbench',
        sourceSeedId: seed?.id || seedId,
      },
      demoProcessMatrixSync: matrixSync || {
        slug: null,
        expectedSlug: null,
        synced: false,
        rowCount: 0,
        rowCountValid: false,
        roleLegendM: null,
        roleCellsClean: false,
        dataClassesLimited: false,
        rows: [],
        downstreamHandoff: {
          blueprintPack: 'missing_seed',
          landingRegistry: 'pending',
          productiveDemoRoom: 'pending',
        },
      },
      budibaseRenderTarget: budibaseHint?.id || 'budibase:stadtwerk-mauer-workbench',
      rundeckHint: runbookHint?.id || null,
      forbiddenActions,
      sourceActions: {
        inspected: ['dashboard-api.stadtwerkMauerBlueprintPackVerifyStatus'],
        referenced: [
          seed?.id
            ? `src/vdmi-blueprint-pack-seeds/${seed.id}.json`
            : 'src/vdmi-blueprint-pack-seeds',
          'validateVdmiBlueprintPackSeed',
          'operations-runbook.verifyVdmiBlueprintPackSeed',
        ],
        notCalled: [
          'blueprint-pack.load',
          'tenant.provision',
          'seed.import',
          'sandbox.reset',
          'rundeck.execute',
          'budibase.table.write',
          'budibase.api.call',
          'hitl.create',
          'external.connector.call',
          'mako.write',
          'billing.prepare',
          'settlement.export',
          'tariff.mutate',
          'device-control.execute',
          'public-context.mutate',
          'personal-agent.execute',
        ],
      },
      brokerDossierHydration: {
        exposed: false,
        reason:
          'Dashboard Workbench verify slice only; Capability Broker and Hydration Registry exposure is intentionally deferred.',
      },
    };

    return {
      capabilityKey: 'stadtwerk_mauer_blueprint_pack_verify',
      safety: 'read_only_workbench_projection',
      success: validation.valid,
      runbookId: 'vdmi-blueprint-pack-verify',
      status: validation.valid ? 'completed' : 'blocked',
      riskClass: 'read_only',
      tenantId,
      title: 'VDMI Blueprint Pack verification',
      summary: {
        title: 'VDMI Blueprint Pack verification',
        counts: {
          seedsFound: seed ? 1 : 0,
          validationErrors: validation.errors.length,
          requiredEvidence: requiredEvidence.length,
          roleRelations: roles.length,
          forbiddenActions: forbiddenActions.length,
          workbenchClarificationItems: clarificationItems.length,
          demoProcessMatrixRows: matrixSync?.rowCount || 0,
        },
      },
      data,
      warnings,
      nextActions: validation.valid
        ? [
            'Render the verify read model in Budibase',
            'Use /api/governance/role-workbench for role-specific case projection',
          ]
        : ['Fix the Blueprint Pack seed contract before exposing it to Rundeck or Budibase'],
    };
  },

  buildStadtwerkMauerTransferReadinessStatus({
    tenantId = 'stadtwerk-mauer',
    seedId = stadtwerkMauerPvMissingNap.id,
    caseId = 'smm-budibase-workbench',
    includeBlockedBoundaries = true,
    includeSafeNextSteps = true,
  } = {}) {
    const verify = this.buildStadtwerkMauerBlueprintPackVerifyStatus({ tenantId, seedId });
    const seed = tenantId === 'stadtwerk-mauer' ? getVdmiBlueprintPackSeed(seedId) : null;
    const dataClasses = seed?.dataClasses || {};
    const roleRows = Array.isArray(verify.data?.roleRelations) ? verify.data.roleRelations : [];
    const evidenceRows = Array.isArray(verify.data?.requiredEvidence)
      ? verify.data.requiredEvidence
      : [];
    const forbiddenActions = Array.isArray(verify.data?.forbiddenActions)
      ? verify.data.forbiddenActions
      : [];
    const disabledActionClasses = [
      'tenant.provision',
      'seed.import',
      'sandbox.reset',
      'rundeck.execute',
      'budibase.table.write',
      'public-context.mutate',
      'external.connector.call',
      'mako.write',
      'billing.prepare',
      'settlement.export',
      'tariff.mutate',
      'device-control.execute',
    ];
    const gridOperatorHint =
      'Syna GmbH (MaStR baseline); Stadtwerk Mauer is virtual demo overlay only';
    const transferSummaryRows = [
      {
        rowKey: 'transfer_readiness',
        label: 'Transfer Readiness',
        status: seed ? 'ready_for_onboarding_discussion' : 'seed_not_found',
        tenantId,
        seedId,
        caseId,
        municipality: 'Mauer',
        ags: '08226048',
        postcode: '69256',
        gridOperatorHint,
        safety: 'read_only_workbench_projection',
        sourceClass: 'transfer_readiness_summary',
      },
    ];
    const dataClassRows = [
      {
        rowKey: 'public_context_layer',
        category: 'public_context',
        transferState: 'reusable_read_only',
        label: 'Public context layer',
        description:
          dataClasses.publicContextLayer?.description ||
          'Public MaStR/municipal context can be reused as read-only baseline.',
        examples: (
          dataClasses.publicContextLayer?.examples || ['MaStR baseline', 'municipality profile']
        ).join(', '),
        syntheticOnly: false,
        tenantParameter: false,
        productionBlocked: false,
        safeNextAction: 'inspect_public_context_baseline',
        sourceClass: 'transfer_data_class',
      },
      {
        rowKey: 'synthetic_tenant_seed',
        category: 'synthetic_seed',
        transferState: 'replace_for_real_tenant',
        label: 'Synthetic Stadtwerk Mauer seed',
        description:
          dataClasses.syntheticTenantSeed?.description ||
          'Invented demo tenant and case facts only.',
        examples: (dataClasses.syntheticTenantSeed?.examples || [tenantId, caseId, seedId]).join(
          ', '
        ),
        syntheticOnly: true,
        tenantParameter: true,
        productionBlocked: false,
        safeNextAction: 'replace_with_tenant_parameters_before_onboarding',
        sourceClass: 'transfer_data_class',
      },
      {
        rowKey: 'sandbox_runtime_artifacts',
        category: 'sandbox_runtime',
        transferState: 'do_not_transfer',
        label: 'Sandbox runtime artifacts',
        description:
          dataClasses.sandboxRuntimeArtifact?.description ||
          'Demo output and replay artifacts are resettable sandbox state.',
        examples: (
          dataClasses.sandboxRuntimeArtifact?.examples || [
            'annotations',
            'verify runs',
            'event replay preview',
          ]
        ).join(', '),
        syntheticOnly: true,
        tenantParameter: false,
        productionBlocked: true,
        safeNextAction: 'discard_or_regenerate_in_customer_sandbox',
        sourceClass: 'transfer_data_class',
      },
      {
        rowKey: 'reusable_workbench_blueprint',
        category: 'blueprint_workbench',
        transferState: 'reusable_with_parameters',
        label: 'Blueprint and Workbench structure',
        description:
          'Role, evidence, no-call guard and Workbench read-model patterns can transfer after tenant parameters are supplied.',
        examples: 'role catalog, evidence requirements, no-call guards, safe next-gate hints',
        syntheticOnly: false,
        tenantParameter: true,
        productionBlocked: false,
        safeNextAction: 'review_parameter_rows_and_required_evidence',
        sourceClass: 'transfer_data_class',
      },
    ];
    const tenantParameterRows = [
      ['tenant_id', 'Tenant ID', tenantId, 'replace_with_real_tenant_id'],
      ['tenant_name', 'Tenant name', 'Stadtwerk Mauer', 'replace_with_real_stadtwerk_name'],
      [
        'municipality_profile',
        'AGS/PLZ/municipality profile',
        '08226048 / 69256 / Mauer',
        'confirm_real_municipality_profile',
      ],
      [
        'grid_operator_hint',
        'Grid operator label/BDEW hint',
        gridOperatorHint,
        'confirm_real_grid_operator_context',
      ],
      [
        'seed_case_label',
        'Seed case label',
        `${caseId} / ${seed?.controlCase || 'electrician_missing_nap'}`,
        'replace_with_real_or_customer_sandbox_case',
      ],
      [
        'role_names',
        'Role names',
        roleRows
          .map((row) => row.roleId)
          .filter(Boolean)
          .join(', '),
        'map_to_customer_roles',
      ],
      [
        'public_context_baseline_refs',
        'Public context baseline refs',
        'MaStR overlay, municipal profile, VDMI profile',
        'refresh_or_verify_public_baseline_read_only',
      ],
      [
        'evidence_requirements',
        'Evidence requirements',
        evidenceRows.join(', '),
        'collect_customer_specific_evidence_before_production_use',
      ],
    ].map(([rowKey, label, currentDemoValue, replacementRule]) => ({
      rowKey,
      label,
      currentDemoValue,
      replacementRule,
      requiredForTransfer: true,
      syntheticDemoValue: true,
      safeNextAction: 'collect_parameter_then_refresh_transfer_readiness',
      sourceClass: 'tenant_parameter',
    }));
    const reusableElementRows = [
      [
        'workbench_manifest',
        'Generated Budibase Workbench manifest',
        'reuse_generated_render_shell',
        'integrations/budibase/manifests/stadtwerk-mauer-workbench.json',
      ],
      [
        'blueprint_seed_contract',
        'VDMI Blueprint seed contract',
        'reuse_with_new_seed_values',
        seed?.id
          ? `src/vdmi-blueprint-pack-seeds/${seed.id}.json`
          : 'src/vdmi-blueprint-pack-seeds',
      ],
      [
        'dashboard_read_models',
        'Cernion dashboard read models',
        'reuse_read_only_facades',
        'services/dashboard-api.service.js',
      ],
      [
        'apply_script',
        'Controlled Budibase apply script',
        'reuse_for_generated_apply_only',
        'integrations/budibase/scripts/apply-stadtwerk-mauer-workbench.js',
      ],
    ].map(([rowKey, label, transferState, sourceRef]) => ({
      rowKey,
      label,
      transferState,
      sourceRef,
      productionMutation: false,
      safeNextAction: 'inspect_generated_source_before_customer_cut',
      sourceClass: 'reusable_workbench_element',
    }));
    const productionBoundaryRows = disabledActionClasses.map((action) => ({
      rowKey: action,
      boundary: action,
      status: 'blocked_in_transfer_readiness_slice',
      disabled: true,
      safeAlternative: 'read_or_verify_readiness_only',
      sourceClass: 'blocked_production_boundary',
    }));
    const safeNextGateRows = [
      ['inspect_blueprint_verify', 'Inspect Blueprint verify panel', 'safe_read_only'],
      ['refresh_public_context_view', 'Refresh public-context view', 'safe_read_only'],
      [
        'validate_transfer_parameters',
        'Validate tenant parameters for onboarding discussion',
        'safe_read_only',
      ],
      [
        'verify_readiness_with_cernion_runbook_wrapper',
        'Verify readiness through curated Cernion wrapper',
        'safe_verify_only',
      ],
    ].map(([rowKey, label, safety]) => ({
      rowKey,
      label,
      safety,
      allowed: true,
      createsProductionState: false,
      sourceClass: 'safe_next_gate',
    }));

    return {
      capabilityKey: 'stadtwerk_mauer_transfer_readiness',
      safety: 'read_only_workbench_projection',
      status: seed ? 'ready_for_onboarding_discussion' : 'seed_not_found',
      riskClass: 'read_only',
      tenantId,
      seedId,
      caseId,
      title: 'Stadtwerk Mauer transfer readiness',
      transferSummaryRows,
      dataClassRows,
      tenantParameterRows,
      reusableElementRows,
      productionBoundaryRows: includeBlockedBoundaries ? productionBoundaryRows : [],
      disabledActionClassRows: includeBlockedBoundaries
        ? productionBoundaryRows.concat(
            forbiddenActions.map((action) => ({
              rowKey: action,
              boundary: action,
              status: 'forbidden_by_blueprint_seed',
              disabled: true,
              safeAlternative: 'readiness_discussion_only',
              sourceClass: 'blueprint_forbidden_action',
            }))
          )
        : [],
      safeNextGateRows: includeSafeNextSteps ? safeNextGateRows : [],
      sourceActions: {
        inspected: [
          'dashboard-api.stadtwerkMauerTransferReadinessStatus',
          'dashboard-api.stadtwerkMauerBlueprintPackVerifyStatus',
          'dashboard-api.stadtwerkMauerWorkbenchLandingStatus',
          'dashboard-api.stadtwerkMauerWorkbenchHubStatus',
          'dashboard-api.stadtwerkMauerAdministratorInventoryStatus',
          'dashboard-api.stadtwerkMauerTenantDatabrowserStatus',
          'dashboard-api.stadtwerkMauerCaseDetailStatus',
          'dashboard-api.stadtwerkMauerRoleWorkbenchCatalogStatus',
          'dashboard-api.stadtwerkMauerMastrDataOverlayStatus',
          'dashboard-api.stadtwerkMauerVdmiProfileStatus',
          'dashboard-api.stadtwerkMauerCapabilityProjectionStatus',
          'dashboard-api.stadtwerkMauerEventReplayPreviewStatus',
        ],
        referenced: [
          'integrations/budibase/README.md',
          'integrations/budibase/manifests/stadtwerk-mauer-workbench.json',
          'integrations/budibase/scripts/apply-stadtwerk-mauer-workbench.js',
          seed?.id
            ? `src/vdmi-blueprint-pack-seeds/${seed.id}.json`
            : 'src/vdmi-blueprint-pack-seeds',
        ],
        notCalled: disabledActionClasses.concat([
          'hitl.create',
          'personal-agent.execute',
          'secret.read',
          'wallet.keyMaterial',
        ]),
      },
      brokerDossierHydration: {
        exposed: false,
        reason:
          'Budibase Workbench transfer-readiness slice only; Capability Broker, Hydration Registry and slim dossier formatter are intentionally deferred.',
      },
    };
  },

  buildStadtwerkMauerLandingRegistryDraftStatus({
    tenantId = 'stadtwerk-mauer',
    seedId = stadtwerkMauerSubstationLoadAssessment.id,
  } = {}) {
    const seed = tenantId === 'stadtwerk-mauer' ? getVdmiBlueprintPackSeed(seedId) : null;
    const validation = validateVdmiBlueprintPackSeed(seed);
    const draft = seed ? buildLandingRegistryDraftFromBlueprintSeed(seed) : null;
    const found = Boolean(seed);
    const status = !found
      ? 'seed_not_found'
      : validation.valid
        ? 'landing_registry_draft_ready'
        : 'landing_registry_draft_blocked';
    const sourceActions = draft?.sourceActions || {
      inspected: ['dashboard-api.stadtwerkMauerLandingRegistryDraftStatus'],
      referenced: ['src/vdmi-blueprint-pack-seeds'],
      notCalled: [
        'cernion.de.publish',
        'landing-registry.write',
        'budibase.table.write',
        'operations-runbook.execute',
        'external.connector.call',
        'hitl.create',
        'settlement.export',
        'device-control.execute',
        'personal-agent.execute',
      ],
    };

    return {
      capabilityKey: 'stadtwerk_mauer_landing_registry_draft',
      safety: 'read_only_workbench_projection',
      status,
      riskClass: 'read_only',
      tenantId,
      seedId,
      found,
      title: 'Stadtwerk Mauer Landing-Registry draft sync proof',
      draft,
      rowCount: draft?.rowCount || 0,
      roleHeaders: draft?.roleHeaders || [],
      syncProof: draft?.syncProof || {
        blueprintPack: { status: found ? 'blocked' : 'missing_seed' },
        landingRegistryDraft: { status: 'pending' },
        productiveDemoRoom: { status: 'pending' },
      },
      publicationBlockers: draft?.publicationBlockers || [],
      positiveFollowUps: draft?.positiveFollowUps || [],
      sourceActions: {
        inspected: [
          'dashboard-api.stadtwerkMauerLandingRegistryDraftStatus',
          ...sourceActions.inspected,
        ],
        referenced: sourceActions.referenced,
        notCalled: sourceActions.notCalled,
      },
      brokerDossierHydration: {
        exposed: false,
        reason:
          'Landing-Registry draft sync-proof slice only; Capability Broker and Hydration Registry exposure are intentionally deferred until a dossier-facing capability is cut.',
      },
      warnings: validation.valid ? [] : validation.errors,
    };
  },

  buildMissingStadtwerkMauerCaseAnnotationStatus(
    tenantId = 'stadtwerk-mauer',
    caseId = 'smm-budibase-workbench'
  ) {
    return {
      capabilityKey: 'stadtwerk_mauer_case_annotations',
      safety: 'read_only_sandbox_annotation_readback',
      tenantId,
      requiredTenantId: 'stadtwerk-mauer',
      caseId,
      requiredCaseId: 'smm-budibase-workbench',
      sandboxBoundaryAllowed: tenantId === 'stadtwerk-mauer',
      selectedCaseAllowed: caseId === 'smm-budibase-workbench',
      found: tenantId === 'stadtwerk-mauer' && caseId === 'smm-budibase-workbench',
      status: 'case_annotations_unavailable',
      currentDemoStatus: 'needs_evidence',
      annotationCount: 0,
      annotationRows: [],
      auditRows: [],
      sourceActions: {
        inspected: ['dashboard-api.stadtwerkMauerCaseDetailStatus'],
        referenced: ['stadtwerk-mauer-sandbox-runtime.listCaseAnnotations'],
        notCalled: [
          'budibase.table.write',
          'budibase.system_of_record',
          'public-context.mutate',
          'production.mutate',
          'personal-agent.execute',
        ],
      },
    };
  },

  buildStadtwerkMauerCaseEvidence(seed, e2eStatus = {}) {
    const missing = new Set((e2eStatus.missingEvidence || []).map((item) => item.missingDataPoint));
    const clarificationItems = buildWorkbenchClarificationItems(seed);
    return (seed.evidenceRequirements || []).map((item) => {
      const clarification = clarificationItems.find(
        (candidate) => candidate.evidenceId === item.id
      );
      const state = missing.has(item.id)
        ? item.missingState
        : e2eStatus.traceCount > 0
          ? 'present'
          : item.missingState;
      return {
        id: item.id,
        required: item.required,
        dataClass: item.dataClass,
        state,
        present: state === 'present',
        roleHint: clarification?.roleHint || 'ROLE_GRID_OPERATOR',
        enablesDossierAddition: item.enablesDossierAddition,
        sourceSeedId: seed.id,
      };
    });
  },

  buildStadtwerkMauerCaseEvidenceRows(evidence = []) {
    return evidence.map((item) => ({
      state: item.state || 'unknown',
      evidenceId: item.id || null,
      label: this.humanizeWorkbenchLabel(item.id),
      roleLabel: this.humanizeWorkbenchLabel(item.roleHint || 'ROLE_GRID_OPERATOR'),
      sourceClass: item.dataClass || null,
      nextGateLabel: item.present
        ? 'Evidence present'
        : this.humanizeWorkbenchLabel(item.enablesDossierAddition || item.id),
      required: item.required === true,
      present: item.present === true,
    }));
  },
};
