'use strict';

const { principal, deny } = require('./domain-router-policy');
const { tenantNamespace } = require('./tenant-context');
const writeCapability = Symbol('tenant-document-workflow');
const documentNamespace = (tenantId) => tenantNamespace('knowledge_rag_documents', tenantId);
const managed = (payload) =>
  payload?.type === 'tenant_document' || payload?.metadata?.workbenchDocument;

// Managed sources and their index are accessible only through the audited workflow.
// This also prevents direct generic-store reads/writes from bypassing visibility.
async function guardDocuments(ctx) {
  const ns = String(ctx.params.namespace || '');
  if (!/(?:^|:)knowledge_rag_(?:documents|chunks)$/.test(ns)) return;
  if (ctx.meta.documentKnowledgeWrite === writeCapability) {
    const p = principal(ctx);
    const expected = ns.endsWith('knowledge_rag_documents')
      ? documentNamespace(p.tenantId)
      : tenantNamespace('knowledge_rag_chunks', p.tenantId);
    if (ns !== expected) deny('Tenant mismatch');
    return;
  }
  if (ns.endsWith('knowledge_rag_documents') || managed(ctx.params.payload))
    deny('Use the document workflow');
  if (ctx.action.name.endsWith('.query'))
    ctx.params.selector = {
      $and: [
        { ns },
        ctx.params.selector || {},
        { 'payload.metadata.workbenchDocument': { $exists: false } },
      ],
    };
  if (ctx.params.key) {
    try {
      const current = await this.db.get(`${ns}:${ctx.params.key}`);
      if (managed(current.payload)) deny('Use the document workflow');
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
}
function filterDocuments(ctx, result) {
  if (
    result?.docs &&
    /(?:^|:)knowledge_rag_(?:documents|chunks)$/.test(String(ctx.params.namespace))
  ) {
    const docs = result.docs.filter(
      (doc) =>
        doc.namespace === ctx.params.namespace &&
        (ctx.meta.documentKnowledgeWrite === writeCapability || !managed(doc.payload))
    );
    return { ...result, docs, totalDocs: docs.length };
  }
  if (ctx.meta.documentKnowledgeWrite === writeCapability) return result;
  if (managed(result?.payload)) deny('Use the document workflow');
  return result;
}
module.exports = { writeCapability, documentNamespace, guardDocuments, filterDocuments };
