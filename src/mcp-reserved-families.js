'use strict';

/**
 * `cernion_prepare_process` routing for the 4 "reserved" operation families
 * (`services/copilot-process.service.js`'s `RESERVED_PROCESS_OPERATION_FAMILIES`).
 * The generic `prepareProcessIntent` action rejects these outright (409) —
 * each has its own dedicated `prepare*` action with a real execution case
 * in `_executeIntent`'s dispatch table, so callers must go through those
 * instead. This module maps each family's MCP-facing `payload` shape onto
 * the dedicated action's actual params, so `cernion_prepare_process` can
 * stay a single tool rather than growing 4 more.
 *
 * `cernion_execute_process` needs NO changes for these families: the
 * dedicated prepare actions store intents in the same `ProcessIntentStore`
 * shape as the generic path, so `copilot-process.executeProcessIntent`
 * already executes them for real (they're exactly the families that
 * *aren't* `UNKNOWN_OPERATION_FAMILY`).
 */

const { MoleculerClientError } = require('moleculer').Errors;

// Mirrors connection-rejection-evidence.service.js's DECISION enum.
// prepareConnectionRejectionEvidence itself only validates `decision` as a
// plain string (a pre-existing gap — a bad value there would otherwise
// pass prepare and only fail later, at executeProcessIntent time). Not
// fixed at the source to avoid touching existing call sites/tests that
// pre-date this MCP wiring; validated here instead so MCP callers get a
// clear error up front.
const CONNECTION_REJECTION_DECISION_VALUES = ['GO', 'CONDITIONAL', 'NO_GO', 'PENDING'];

function requireField(payload, field, family) {
  const value = payload?.[field];
  if (value === undefined || value === null || value === '') {
    throw new MoleculerClientError(
      `payload.${field} is required for operationFamily "${family}"`,
      422,
      'MCP_MISSING_RESERVED_FAMILY_FIELD',
      { family, field }
    );
  }
  return value;
}

const RESERVED_FAMILIES = {
  vdmi: {
    action: 'copilot-process.prepareVdmiEvidence',
    buildParams(payload, topLevel) {
      return {
        matrixId: requireField(payload, 'matrixId', 'vdmi'),
        evidenceType: requireField(payload, 'evidenceType', 'vdmi'),
        reference: requireField(payload, 'reference', 'vdmi'),
        content: payload.content,
        reason: topLevel.reason,
        correlationId: topLevel.correlationId,
        decisionFrameId: topLevel.decisionFrameId,
      };
    },
  },
  gridConnection: {
    action: 'copilot-process.prepareGridConnectionValidation',
    buildParams(payload, topLevel) {
      if (!payload?.gridOperatorId && !payload?.gridOperatorBdew && !payload?.gridOperatorName) {
        throw new MoleculerClientError(
          'payload must include one of gridOperatorId, gridOperatorBdew, gridOperatorName for operationFamily "gridConnection"',
          422,
          'MCP_MISSING_RESERVED_FAMILY_FIELD',
          { family: 'gridConnection' }
        );
      }
      return {
        gridOperatorId: payload.gridOperatorId,
        gridOperatorBdew: payload.gridOperatorBdew,
        gridOperatorName: payload.gridOperatorName,
        includeCapacityCheck: payload.includeCapacityCheck,
        reason: topLevel.reason,
        correlationId: topLevel.correlationId,
        // prepareGridConnectionValidation has no decisionFrameId param.
      };
    },
  },
  znp: {
    action: 'copilot-process.prepareZnpAssumption',
    buildParams(payload, topLevel) {
      return {
        projectId: requireField(payload, 'projectId', 'znp'),
        text: requireField(payload, 'text', 'znp'),
        reason: topLevel.reason,
        correlationId: topLevel.correlationId,
        decisionFrameId: topLevel.decisionFrameId,
      };
    },
  },
  connectionRejectionEvidence: {
    action: 'copilot-process.prepareConnectionRejectionEvidence',
    buildParams(payload, topLevel) {
      const decision = requireField(payload, 'decision', 'connectionRejectionEvidence');
      if (!CONNECTION_REJECTION_DECISION_VALUES.includes(decision)) {
        throw new MoleculerClientError(
          `payload.decision must be one of ${CONNECTION_REJECTION_DECISION_VALUES.join(', ')}`,
          422,
          'MCP_INVALID_RESERVED_FAMILY_FIELD',
          { family: 'connectionRejectionEvidence', field: 'decision', decision }
        );
      }
      return {
        gridOperatorId: requireField(payload, 'gridOperatorId', 'connectionRejectionEvidence'),
        applicantReference: requireField(
          payload,
          'applicantReference',
          'connectionRejectionEvidence'
        ),
        loadAssumptionKw: requireField(payload, 'loadAssumptionKw', 'connectionRejectionEvidence'),
        netzverknuepfungspunktId: requireField(
          payload,
          'netzverknuepfungspunktId',
          'connectionRejectionEvidence'
        ),
        voltageLevel: requireField(payload, 'voltageLevel', 'connectionRejectionEvidence'),
        bottleneckDescription: requireField(
          payload,
          'bottleneckDescription',
          'connectionRejectionEvidence'
        ),
        n1QualityStatus: requireField(payload, 'n1QualityStatus', 'connectionRejectionEvidence'),
        decision,
        reason: topLevel.reason,
        correlationId: topLevel.correlationId,
        decisionFrameId: topLevel.decisionFrameId,
      };
    },
  },
};

/**
 * The 4 dedicated prepare actions return `intentId` at the top level
 * (unlike the generic `prepareProcessIntent`, which nests it under
 * `receipt.intentId`) — normalize both shapes to one intent id.
 */
function resolveIntentId(result) {
  return result?.receipt?.intentId || result?.intentId || null;
}

module.exports = { RESERVED_FAMILIES, resolveIntentId, requireField };
