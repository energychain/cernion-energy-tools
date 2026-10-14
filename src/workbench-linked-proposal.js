'use strict';

const conversation = require('./workbench-conversation');

async function confirmLinkedCase(service, ctx, { p, envelope, pending, meta }) {
  if (!/^Leg an[.!\s]*$/iu.test(envelope.userRequest.trim())) return null;
  return require('./workbench-case-continuation').withTenantCaseAssignment(service, p, async () => {
    const current = await conversation.readTurn(service.conversationsDb, p, envelope);
    const proposal = current ? current.linkedCaseProposal : pending?.linkedCaseProposal;
    if (!proposal?.parentCaseId)
      return {
        state: 'assistance',
        nonBinding: true,
        responseText: 'Es liegt kein verbundener Vorgangsvorschlag zur Bestätigung vor.',
      };
    const result = await ctx.call(
      'domain-router.createLinkedConfirmed',
      {
        parentCaseId: proposal.parentCaseId,
        confirmed: true,
        proposal,
        conversationId: envelope.conversationId,
      },
      { meta }
    );
    const displayRef = await service.store.caseDisplayRef({
      tenantId: p.tenantId,
      caseId: result.cetCaseId,
    });
    await conversation.saveTurn(service.conversationsDb, p, envelope, { linkedCaseProposal: null });
    return {
      ...result,
      state: 'linked_case_created',
      nonBinding: true,
      responseText: `Der verbundene Vorgang ${displayRef} ist nach ${current?.situation?.conversationPreferences?.register === 'Sie' ? 'Ihrer' : 'deiner'} Bestätigung angelegt: ${proposal.title}.\nOwner-Rolle: ${proposal.ownerRole || 'zur Abstimmung'}\nFrist: ${proposal.deadline || 'zur Abstimmung'}\nNächste Befassung: ${proposal.nextConsideration || 'zur Abstimmung'}\nWiedervorlage: ${proposal.reminder || 'zur Abstimmung'}`,
    };
  });
}

module.exports = { confirmLinkedCase };
