'use strict';

// Selected-case lifecycle preview (#1148): a pure, closed, read-only planner over one
// already-authorized Workbench case. It receives only parent state flags plus closed child
// counts and returns enums/counts. It never deletes, archives, unlinks, discards or
// pseudonymizes anything; every row carries executionSupported=false. Unknown or invalid
// inputs fail closed to independent_retention_policy_required and are never reported as
// deleted or safe to delete.

const LIFECYCLE_PREVIEW_VIEW = 'lifecycle_preview';
const LIFECYCLE_PREVIEW_SCHEMA_VERSION = 'workbench-case-lifecycle-preview.v1';
const SAFETY_CLASS = 'protected_read_only_case_lifecycle_preview';
const PROCESS_FAMILY = 'workbench_case_lifecycle_governance';
const CONTROL_CASE = 'selected_case_child_lifecycle_review';
// Counts above this sentinel are reported as MAX_CHILD_COUNT with countCapped=true.
const MAX_CHILD_COUNT = 999;

const CASE_STATES = Object.freeze(['active', 'discarded', 'unavailable']);
const PARENT_BINDINGS = Object.freeze([
  'conversation_linked',
  'conversation_unlinked',
  'parent_unavailable',
]);
const DISPOSITIONS = Object.freeze([
  'retain_parent_record',
  'remove_link_only',
  'erase_with_parent_not_implemented',
  'pseudonymize_only_policy_required',
  'independent_retention_policy_required',
  'not_present',
]);
const AVAILABILITY = Object.freeze(['present', 'absent', 'unprovable']);
const NEXT_SAFE_GATES = Object.freeze([
  'none',
  'process_owner_hold_review',
  'data_governance_retention_review',
  'tenant_admin_separate_action_issue',
]);

// Fixed order; owner store/service is documented per class for the implementation analysis.
const CHILD_CLASSES = Object.freeze([
  // domain-router.db — the parent case record; discard keeps it with disposition=discarded.
  {
    childClass: 'domain_case_state',
    retentionClass: 'parent_case_record',
    whenPresent: 'retain_parent_record',
    blockerCode: 'parent_retention_policy_required',
    nextSafeGate: 'process_owner_hold_review',
    accountableRole: 'ROLE_PROCESS_OWNER',
  },
  // WorkbenchStore.conversationsDb workbench_conversation — unlinkConversation removes it.
  {
    childClass: 'conversation_mapping',
    retentionClass: 'link_only',
    whenPresent: 'remove_link_only',
    blockerCode: 'unlink_requires_separate_action',
    nextSafeGate: 'tenant_admin_separate_action_issue',
    accountableRole: 'ROLE_TENANT_ADMIN',
  },
  // workbench-conversation saveTurn — expiring, keyed by conversation identity, not case.
  {
    childClass: 'conversation_assistance',
    retentionClass: 'expiring_conversation_state',
    whenPresent: 'erase_with_parent_not_implemented',
    blockerCode: 'erasure_not_implemented',
    nextSafeGate: 'data_governance_retention_review',
    accountableRole: 'ROLE_DATA_GOVERNANCE',
  },
  // WorkbenchStore.conversationsDb case-display reference.
  operational('case_display_reference'),
  // workbench-conversation saveDraft/listDrafts — case-keyed internal drafts.
  operational('case_drafts'),
  // workbench-document-flow review jobs in conversationsDb (tenantId/caseId fields).
  operational('document_reviews'),
  // WorkbenchStore.evidenceDb.
  operational('evidence_refs'),
  // WorkbenchStore.toolRunDb; receipt pointers are properties of these rows.
  operational('tool_runs'),
  // WorkbenchStore.turnMemoryDb.
  operational('turn_memory'),
  // WorkbenchStore.inboxDb (caseId/cetCaseId bindings).
  operational('inbox_tasks'),
  // domain-router.eventsDb delivery events.
  {
    childClass: 'case_events',
    retentionClass: 'append_only_journal',
    whenPresent: 'independent_retention_policy_required',
    blockerCode: 'event_retention_policy_required',
    nextSafeGate: 'data_governance_retention_review',
    accountableRole: 'ROLE_DATA_GOVERNANCE',
  },
  // domain-router.eventsDb case-audit:* access/correction journal.
  {
    childClass: 'audit_records',
    retentionClass: 'audit_journal',
    whenPresent: 'pseudonymize_only_policy_required',
    blockerCode: 'audit_pseudonymization_policy_required',
    nextSafeGate: 'data_governance_retention_review',
    accountableRole: 'ROLE_DATA_GOVERNANCE',
  },
]);
const UNCLASSIFIED = Object.freeze({
  childClass: 'unclassified_children',
  retentionClass: 'unclassified',
  whenPresent: 'independent_retention_policy_required',
  blockerCode: 'unclassified_child_class',
  nextSafeGate: 'data_governance_retention_review',
  accountableRole: 'ROLE_DATA_GOVERNANCE',
});
const KNOWN = new Set(CHILD_CLASSES.map((entry) => entry.childClass));

function operational(childClass) {
  return {
    childClass,
    retentionClass: 'operational_case_child',
    whenPresent: 'erase_with_parent_not_implemented',
    blockerCode: 'erasure_not_implemented',
    nextSafeGate: 'data_governance_retention_review',
    accountableRole: 'ROLE_DATA_GOVERNANCE',
  };
}

function validCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function boundedCount(value) {
  return { count: Math.min(value, MAX_CHILD_COUNT), countCapped: value > MAX_CHILD_COUNT };
}

function row(entry, fields) {
  return Object.freeze({
    childClass: entry.childClass,
    count: null,
    countCapped: false,
    retentionClass: entry.retentionClass,
    currentAvailability: 'unprovable',
    plannedDisposition: 'independent_retention_policy_required',
    executionSupported: false,
    blockerCode: entry.blockerCode,
    nextSafeGate: 'data_governance_retention_review',
    accountableRole: 'ROLE_DATA_GOVERNANCE',
    ...fields,
  });
}

function unprovable(entry, blockerCode) {
  return row(entry, { blockerCode });
}

function counted(entry, value) {
  if (!validCount(value)) return unprovable(entry, 'child_count_unavailable');
  if (value === 0) {
    return row(entry, {
      ...boundedCount(0),
      currentAvailability: 'absent',
      plannedDisposition: 'not_present',
      blockerCode: null,
      nextSafeGate: 'none',
      accountableRole: null,
    });
  }
  return row(entry, {
    ...boundedCount(value),
    currentAvailability: 'present',
    plannedDisposition: entry.whenPresent,
    blockerCode: entry.blockerCode,
    nextSafeGate: entry.nextSafeGate,
    accountableRole: entry.accountableRole,
  });
}

function caseStateOf(parent) {
  if (!parent || parent.available !== true) return 'unavailable';
  return parent.discarded === true ? 'discarded' : 'active';
}

/**
 * @param {{available: boolean, discarded?: boolean, conversationLinked?: boolean}} parent
 * @param {Record<string, number|null>} childCounts closed counts keyed by childClass;
 *   conversation_assistance must be null when no live mapping proves the association.
 */
function planCaseLifecyclePreview(parent, childCounts = {}) {
  const caseState = caseStateOf(parent);
  const linked = caseState !== 'unavailable' && parent.conversationLinked === true;
  const parentBinding =
    caseState === 'unavailable'
      ? 'parent_unavailable'
      : linked
        ? 'conversation_linked'
        : 'conversation_unlinked';
  const counts = childCounts && typeof childCounts === 'object' ? childCounts : {};

  const children = CHILD_CLASSES.map((entry) => {
    if (caseState === 'unavailable') return unprovable(entry, 'parent_unavailable');
    if (entry.childClass === 'domain_case_state') return counted(entry, 1);
    if (entry.childClass === 'conversation_mapping') return counted(entry, linked ? 1 : 0);
    if (entry.childClass === 'conversation_assistance' && !linked) {
      // After unlink the conversation-to-case association cannot be proven retrospectively.
      return unprovable(entry, 'conversation_association_unprovable_after_unlink');
    }
    return counted(entry, Object.hasOwn(counts, entry.childClass) ? counts[entry.childClass] : NaN);
  });

  // Unknown classes fail closed into one bounded row; their names are never echoed.
  let unknownTotal = 0;
  let unknownInvalid = false;
  for (const [name, value] of Object.entries(counts)) {
    if (KNOWN.has(name)) continue;
    if (validCount(value)) unknownTotal += value;
    else unknownInvalid = true;
  }
  if (caseState === 'unavailable') {
    children.push(unprovable(UNCLASSIFIED, 'parent_unavailable'));
  } else if (unknownInvalid) {
    children.push(unprovable(UNCLASSIFIED, 'unclassified_child_class'));
  } else if (unknownTotal > 0) {
    children.push(counted(UNCLASSIFIED, unknownTotal));
  }

  const by = (disposition) =>
    children.filter((child) => child.plannedDisposition === disposition).length;
  return Object.freeze({
    view: LIFECYCLE_PREVIEW_VIEW,
    schemaVersion: LIFECYCLE_PREVIEW_SCHEMA_VERSION,
    safetyClass: SAFETY_CLASS,
    processFamily: PROCESS_FAMILY,
    controlCase: CONTROL_CASE,
    executionSupported: false,
    maxChildCount: MAX_CHILD_COUNT,
    caseState,
    parentBinding,
    children: Object.freeze(children),
    summary: Object.freeze({
      childClassCount: children.length,
      retainedCount: by('retain_parent_record'),
      linkOnlyCount: by('remove_link_only'),
      eraseEligibleCount: by('erase_with_parent_not_implemented'),
      pseudonymizationRequiredCount: by('pseudonymize_only_policy_required'),
      unresolvedPolicyCount: by('independent_retention_policy_required'),
      notPresentCount: by('not_present'),
    }),
  });
}

module.exports = {
  AVAILABILITY,
  CASE_STATES,
  CHILD_CLASSES,
  DISPOSITIONS,
  LIFECYCLE_PREVIEW_SCHEMA_VERSION,
  LIFECYCLE_PREVIEW_VIEW,
  MAX_CHILD_COUNT,
  NEXT_SAFE_GATES,
  PARENT_BINDINGS,
  planCaseLifecyclePreview,
};
