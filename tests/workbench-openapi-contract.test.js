'use strict';

const fs = require('fs');
const path = require('path');

const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi-export.json'), 'utf8'));

function operation(openapiPath, method = 'post') {
  const op = spec.paths?.[openapiPath]?.[method];
  if (!op) throw new Error(`Missing OpenAPI operation ${method.toUpperCase()} ${openapiPath}`);
  return op;
}

function requestProperties(openapiPath, method = 'post') {
  return (
    operation(openapiPath, method).requestBody?.content?.['application/json']?.schema?.properties ||
    {}
  );
}

function responseProperties(openapiPath, method = 'post') {
  return (
    operation(openapiPath, method).responses?.['200']?.content?.['application/json']?.schema
      ?.properties || {}
  );
}

describe('Workbench OpenAPI contract (#624)', () => {
  it('documents the Workbench chat request and response fields needed by Open WebUI', () => {
    const req = requestProperties('/api/workbench/chat');
    expect(Object.keys(req)).toEqual(
      expect.arrayContaining([
        'client',
        'channel',
        'openWebuiConversationId',
        'openWebuiUserId',
        'openWebuiOrgId',
        'clientId',
        'message',
        'asyncDelivery',
      ])
    );
    expect(req.asyncDelivery.properties).toEqual(
      expect.objectContaining({
        mode: expect.any(Object),
        clientId: expect.any(Object),
        ackMode: expect.any(Object),
      })
    );

    const res = responseProperties('/api/workbench/chat');
    expect(Object.keys(res)).toEqual(
      expect.arrayContaining([
        'cetCaseId',
        'caseStateVersion',
        'usedOperation',
        'primaryDomain',
        'readinessState',
        'responseText',
        'eventSummary',
        'pendingEvents',
      ])
    );
  });

  it('documents tenant/user mapping and delivery-client provisioning contracts', () => {
    const tenant = requestProperties('/api/workbench/admin/tenant-mappings');
    expect(Object.keys(tenant)).toEqual(
      expect.arrayContaining(['externalOrgId', 'cetTenantId', 'defaultClientId', 'enabled'])
    );

    const user = requestProperties('/api/workbench/admin/user-mappings');
    expect(Object.keys(user)).toEqual(
      expect.arrayContaining([
        'externalOrgId',
        'externalUserId',
        'cetTenantId',
        'cetActorId',
        'roles',
        'sensitivityClearance',
      ])
    );

    const delivery = requestProperties('/api/workbench/delivery-clients');
    expect(Object.keys(delivery)).toEqual(
      expect.arrayContaining(['clientId', 'clientType', 'deliveryMode', 'ackMode', 'eventTypes'])
    );
  });

  it('documents Workbench events and EvidenceRef attach contracts', () => {
    const events = responseProperties('/api/workbench/events', 'get');
    expect(Object.keys(events)).toEqual(expect.arrayContaining(['items', 'nextCursor']));
    expect(events.items.items.properties).toEqual(
      expect.objectContaining({
        eventId: expect.any(Object),
        title: expect.any(Object),
        safeDisplayText: expect.any(Object),
        conversationRef: expect.any(Object),
      })
    );

    const evidence = requestProperties('/api/workbench/cases/:caseId/evidence');
    expect(Object.keys(evidence)).toEqual(
      expect.arrayContaining([
        'evidenceType',
        'sourceType',
        'sensitivityLevel',
        'sourceRef',
        'extracts',
      ])
    );

    const evidenceResponse = responseProperties('/api/workbench/cases/:caseId/evidence');
    expect(evidenceResponse.evidenceRef.properties).toEqual(
      expect.objectContaining({
        evidenceId: expect.any(Object),
        sourceFingerprint: expect.any(Object),
        hashStatus: expect.any(Object),
        provenance: expect.any(Object),
      })
    );
  });
});
