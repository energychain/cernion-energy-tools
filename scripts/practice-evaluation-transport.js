'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { practiceDocument } = require('./generate-practice-evaluation-fixtures');

function evaluationConfig(env = process.env) {
  const supplied = [env.PRACTICE_BASE_URL, env.PRACTICE_GATEWAY_TOKEN, env.PRACTICE_TEST_TENANT];
  if (supplied.some(Boolean) && !supplied.every(Boolean))
    throw new Error('Remote mode requires base URL, gateway token and test tenant');
  const repeats = Number(env.PRACTICE_REPEATS || 3),
    memoryRepeats = Number(env.PRACTICE_MEMORY_REPEATS || 10);
  if (
    ![repeats, memoryRepeats].every(
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 20
    )
  )
    throw new Error('Invalid repetition count');
  const config = {
    mode: supplied.every(Boolean) ? 'http' : 'local',
    repeats,
    memoryRepeats,
    callLimit: Number(env.LIVE_MAX_MODEL_CALLS || 3000),
    tokenLimit: Number(env.LIVE_MAX_TOKENS || 20000000),
    requestTimeoutMs: Number(env.PRACTICE_TIMEOUT_MS || 120000),
    remoteTokenReservation: Number(env.PRACTICE_REMOTE_TOKEN_RESERVATION || 20000),
    costPerMillion: env.PRACTICE_COST_PER_MILLION_TOKENS
      ? Number(env.PRACTICE_COST_PER_MILLION_TOKENS)
      : null,
    currency: env.PRACTICE_COST_CURRENCY || 'EUR',
    selected: (env.PRACTICE_SCENARIOS || '').split(',').filter(Boolean),
  };
  for (const value of [
    config.callLimit,
    config.tokenLimit,
    config.requestTimeoutMs,
    config.remoteTokenReservation,
  ])
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid evaluation budget');
  if (
    config.costPerMillion != null &&
    (!Number.isFinite(config.costPerMillion) || config.costPerMillion < 0)
  )
    throw new Error('Invalid token cost');
  if (config.mode === 'http') {
    const url = new URL(env.PRACTICE_BASE_URL);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid evaluation URL');
    if (
      env.PRACTICE_NON_PRODUCTION !== 'true' ||
      !/^(?:test-|synthetic-|evaluation-)[a-zA-Z0-9-]+$/u.test(env.PRACTICE_TEST_TENANT)
    )
      throw new Error('Only explicitly acknowledged test tenants are permitted');
    if (!env.PRACTICE_ADMIN_TOKEN || !env.PRACTICE_ACTORS_JSON)
      throw new Error('Remote evaluation requires administration and pseudonymous actor mappings');
    const actors = JSON.parse(env.PRACTICE_ACTORS_JSON);
    if (
      !Array.isArray(actors) ||
      actors.length !== 2 ||
      actors.some(
        (actor, index) =>
          actor.id !== ['a', 'b'][index] ||
          !actor.externalUserId ||
          !actor.actorId ||
          !actor.cleanupToken ||
          actor.name !== `Sachbearbeitung ${['A', 'B'][index]}`
      )
    )
      throw new Error('Invalid pseudonymous actors or own-author cleanup tokens');
    Object.assign(config, {
      baseUrl: url.href.replace(/\/$/u, ''),
      tenantId: env.PRACTICE_TEST_TENANT,
      gatewayToken: env.PRACTICE_GATEWAY_TOKEN,
      adminToken: env.PRACTICE_ADMIN_TOKEN,
      orgId: env.PRACTICE_ORG_ID || env.PRACTICE_TEST_TENANT,
      actors,
    });
  }
  return config;
}

function actorMeta(run, actor, { admin = false } = {}) {
  return {
    apiToken: {
      id: actor.actorId,
      name: actor.name,
      tenantId: run.tenantId,
      roles: ['ROLE_GRID_OPERATOR', 'ROLE_EDM', ...(admin ? ['ROLE_TENANT_ADMIN'] : [])],
      scope: 'full-access',
      sensitivityFlags: [],
    },
    sharedServiceNoticesStructured: admin,
  };
}
function documentMessage(turn) {
  if (!turn.document) return turn.message;
  return `<context><source name="${turn.document.name}">${practiceDocument(turn.document)}</source></context><user_query>${turn.message}</user_query>`;
}

async function createLocalTransport({ budget }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-practice-'));
  process.env.WORKBENCH_DATASET_DB_PATH = path.join(directory, 'rows');
  process.env.JOB_STORE_DIR = path.join(directory, 'jobs');
  process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
  process.env.TENANT_MEMORY_RECOVERY = 'off';
  process.env.CET_FILE_SIGNING_KEY = randomBytes(32).toString('hex');
  process.env.WORKBENCH_LLM_TIMEOUT_MS ||= '15000,45000';
  const { createLiveHarness, isolatedSettings } = require('./workbench-live-harness');
  const projectFixtures = require('./generate-project-manifest-fixtures');
  const schemas = [
    'object-store',
    'shared-service-notices',
    'tenant-memory-policy',
    'datapoint',
    'dataset',
    'files',
    'shared-service-journal',
    'shared-service-learning',
    'project-file',
    'project-upload',
    'project-structure',
    'project-graph',
    'project-manifest',
  ].map((name) => require(`../services/${name}.service`));
  const app = createLiveHarness(directory, [
    ...schemas.map((schema) => ({
      ...schema,
      settings: isolatedSettings(schema, directory, {
        ...(schema.name === 'project-upload' ? { dataPath: path.join(directory, 'projects') } : {}),
        ...(['project-graph', 'project-manifest'].includes(schema.name)
          ? {
              catalog: projectFixtures.referenceCatalog,
              operations: [projectFixtures.referenceOperation],
              domains: [],
            }
          : {}),
      }),
    })),
    projectFixtures.referenceService,
    {
      ...require('../services/knowledge-rag.service'),
      name: 'knowledge-rag',
      actions: {
        query: () => ({ results: [] }),
        federatedSearch: () => ({ results: [] }),
      },
    },
    {
      name: 'capability-broker',
      actions: { recommend: () => ({ recommendedCapabilities: [], uncertain: true }) },
    },
    { name: 'agent-receipts', actions: { select: () => ({ data: { selected: false } }) } },
  ]);
  await app.broker.start();
  async function startRun(scenario) {
    const prefix = randomUUID();
    const run = {
      tenantId: `synthetic-practice-${prefix}`,
      prefix,
      actors: scenario.actors.map((actor) => ({
        ...actor,
        actorId: `practice-${prefix}-${actor.id}`,
      })),
      files: [],
      datasets: [],
      chats: new Map(),
    };
    for (const actor of run.actors)
      await app.workbench.store.saveUserContext({
        tenantId: run.tenantId,
        actorId: actor.actorId,
        displayName: actor.name,
        functionLabel: actor.functionLabel,
        roleFamilies: [actor.functionLabel],
      });
    await projectFixtures.prepareProjectFixtures(app, run, scenario, actorMeta(run, run.actors[0]));
    return run;
  }
  async function send(run, turn) {
    const actor = run.actors.find((item) => item.id === turn.actor);
    const chat = `practice-${run.prefix}-${turn.actor}-${turn.chat}`;
    if (!run.chats.has(chat)) await app.drainDescriptors();
    run.chats.set(chat, actor);
    if (turn.operation === 'admin-cleanup') {
      const admin = actorMeta(run, actor, { admin: true });
      const { statements } = await app.broker.call(
        'tenant-memory-policy.list',
        {},
        { meta: admin }
      );
      for (const fact of statements.filter((fact) => fact.status === 'valid'))
        await app.broker.call(
          'tenant-memory-policy.delete',
          { id: fact.id, reason: 'Praxis-Evaluation: administrative Bereinigung' },
          { meta: admin }
        );
      const author = run.actors[0];
      const queue = await app.broker.call(
        'notices.list',
        { tenantId: run.tenantId, actorId: author.actorId },
        { meta: actorMeta(run, author) }
      );
      return {
        responseText: 'Auditierte Bereinigung abgeschlossen.',
        metadata: { notices: queue.items || queue.notices || [] },
        noticeBlock: queue.block || '',
      };
    }
    let fileRefs;
    if (turn.upload) {
      const spec = {
        ...turn.upload,
        name: turn.upload.name.replace('.', `-${run.prefix.slice(0, 8)}.`),
      };
      const ref = await app.broker.call(
        'files.upload',
        {
          name: spec.name,
          mimeType: spec.kind === 'load' ? 'text/csv' : 'text/plain',
          contentBase64: Buffer.from(practiceDocument(spec)).toString('base64'),
        },
        { meta: actorMeta(run, actor) }
      );
      fileRefs = [ref];
      run.files.push({ actor, ref });
      if (spec.kind === 'load') run.datasets.push({ actor, name: spec.name, chat });
    }
    if (turn.document) run.datasets.push({ actor, name: turn.document.name, chat });
    budget.assertReady();
    const reply = await app.broker.call(
      'workbench.chat',
      {
        channel: 'api',
        conversationId: chat,
        userRequest: documentMessage(turn),
        ...(fileRefs ? { fileRefs } : {}),
        requestId: randomUUID(),
      },
      { meta: actorMeta(run, actor), timeout: 120000 }
    );
    await Promise.allSettled([...(app.workbench.tenantMemoryJobs || [])]);
    budget.assertReady();
    return reply;
  }
  async function cleanup(run) {
    const results = [];
    for (const projectId of run.projects || []) {
      try {
        await app.cleanupCall(
          'project-file.delete',
          { projectId },
          { meta: actorMeta(run, run.actors[0]) }
        );
        results.push({
          action: 'project-file.delete',
          passed: true,
          reason: 'Generierte Akte mit bestätigter Kaskade entfernt',
        });
      } catch (error) {
        results.push({
          action: 'project-file.delete',
          passed: false,
          reason: error.type || error.name,
        });
      }
    }
    for (const actor of run.actors) {
      try {
        const meta = actorMeta(run, actor, { admin: true });
        const { statements } = await app.cleanupCall('tenant-memory-policy.list', {}, { meta });
        for (const fact of statements.filter(
          (item) => item.status !== 'deleted' && item.person.actorId === actor.actorId
        ))
          await app.cleanupCall(
            'tenant-memory-policy.delete',
            { id: fact.id, reason: 'Praxis-Evaluation: eigene Testaussage bereinigen' },
            { meta }
          );
        results.push({
          action: 'tenant-memory-policy.delete',
          passed: true,
          reason: 'Nur eigene generierte Aussagen; auditierte Redaktion ohne Autorenhinweise',
        });
      } catch (error) {
        results.push({
          action: 'tenant-memory-policy.delete',
          passed: false,
          reason: error.type || error.name,
        });
      }
    }
    for (const item of run.datasets)
      try {
        const options = { meta: actorMeta(run, item.actor) };
        const records = await app.cleanupCall(
          'datapoint.datasetCatalog',
          { operation: 'list' },
          options
        );
        const owned = records.filter(
          (record) =>
            record.provenance?.conversationId === item.chat ||
            record.structured?.conversations?.includes(item.chat)
        );
        for (const record of owned) {
          const deleted = await app.cleanupCall(
            'dataset.turn',
            { question: `Bitte Datensatz ${record.id} löschen.`, conversationId: item.chat },
            options
          );
          if (deleted.handled !== true || !/gelöscht/iu.test(deleted.responseText || ''))
            throw new Error('Dataset cleanup not confirmed');
        }
        results.push({
          action: 'dataset.turn',
          passed: true,
          reason: owned.length
            ? 'Eigener Datensatz über auditierte Löschfunktion'
            : 'Kein persistierter Datensatz zu dieser Quelle',
        });
      } catch (error) {
        results.push({ action: 'dataset.turn', passed: false, reason: error.type || error.name });
      }
    for (const item of run.files)
      try {
        await app.cleanupCall(
          'files.remove',
          { fileId: item.ref.fileId },
          { meta: actorMeta(run, item.actor) }
        );
        results.push({ action: 'files.remove', passed: true, reason: 'Dateikanal mit Audit' });
      } catch (error) {
        results.push({ action: 'files.remove', passed: false, reason: error.type || error.name });
      }
    for (const [chat, actor] of run.chats)
      try {
        await app.cleanupCall(
          'workbench.chat',
          { channel: 'api', conversationId: chat, userRequest: 'Kein Fall' },
          { meta: actorMeta(run, actor, { admin: true }), timeout: 15000 }
        );
        results.push({
          action: 'workbench.chat',
          passed: true,
          reason: 'Kein Fall: dokumentierte Fallkorrektur; keine Modellanfrage',
        });
      } catch (error) {
        results.push({ action: 'workbench.chat', passed: false, reason: error.type || error.name });
      }
    return results;
  }
  return {
    mode: 'local',
    startRun,
    send,
    cleanup,
    async close() {
      await app.broker.stop();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function createHttpTransport({ config, budget, fetchImpl = fetch }) {
  const { GOVERNANCE_MODEL } = require('../src/openai-models');
  async function request(
    route,
    { method = 'GET', body, actor, admin = false, ownCleanup = false, budgeted = false } = {}
  ) {
    const settle = budgeted
      ? budget.reserveExternal(JSON.stringify(body), config.remoteTokenReservation * 4, {
          retainReservation: true,
        })
      : null;
    const token = ownCleanup ? actor.cleanupToken : admin ? config.adminToken : config.gatewayToken;
    const response = await fetchImpl(config.baseUrl + route, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(config.requestTimeoutMs),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(actor
          ? { 'x-openwebui-user-id': actor.externalUserId, 'x-openwebui-org-id': config.orgId }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await response.text();
    if (response.status === 429) {
      const error = Object.assign(new Error('Quota'), { status: 429 });
      budget.stopForQuota(error);
      throw error;
    }
    if (!response.ok)
      throw Object.assign(new Error('Evaluation HTTP request rejected'), {
        type: `HTTP_${response.status}`,
      });
    const data = JSON.parse(raw);
    if (/LLM_QUOTA_EXCEEDED/.test(raw)) {
      const error = Object.assign(new Error('Quota'), { type: 'LLM_QUOTA_EXCEEDED' });
      budget.stopForQuota(error);
      throw error;
    }
    if (data.tenantId && data.tenantId !== config.tenantId)
      throw new Error('Authenticated tenant mismatch');
    if (settle) settle(raw);
    return data;
  }
  const administrator = await request('/api/tokens/verify', {
    method: 'POST',
    admin: true,
    body: {
      token: config.adminToken,
      method: 'DELETE',
      path: '/api/tenant-memory-policy/statements/synthetic',
    },
  });
  if (
    !administrator.valid ||
    administrator.type === 'gateway' ||
    administrator.tenantId !== config.tenantId ||
    !administrator.roles?.includes('ROLE_TENANT_ADMIN')
  )
    throw new Error('Test administration token verification failed');
  const gateway = await request('/api/tokens/verify', {
    method: 'POST',
    admin: true,
    body: { token: config.gatewayToken, method: 'POST', path: '/v1/chat/completions' },
  });
  if (
    !gateway.valid ||
    gateway.type !== 'gateway' ||
    gateway.tenantId !== config.tenantId ||
    gateway.client !== 'open-webui' ||
    gateway.externalOrgId !== config.orgId
  )
    throw new Error('Gateway test tenant or organization verification failed');
  for (const actor of config.actors) {
    const verified = await request('/api/tokens/verify', {
      method: 'POST',
      admin: true,
      body: {
        token: actor.cleanupToken,
        method: 'DELETE',
        path: '/api/tenant-memory-policy/statements/synthetic',
      },
    });
    if (
      !verified.valid ||
      verified.type === 'gateway' ||
      verified.tenantId !== config.tenantId ||
      (verified.userId || verified.tokenId) !== actor.actorId ||
      !verified.roles?.includes('ROLE_TENANT_ADMIN')
    )
      throw new Error('Own-author test cleanup token verification failed');
  }
  const mappings = await request(
    `/api/workbench/admin/mappings?tenantId=${encodeURIComponent(config.tenantId)}`,
    { admin: true }
  );
  if (mappings.tenantId !== config.tenantId) throw new Error('Test tenant verification failed');
  for (const actor of config.actors)
    if (
      !(mappings.mappings || []).some(
        (item) =>
          item.externalUserId === actor.externalUserId &&
          item.cetActorId === actor.actorId &&
          item.cetTenantId === config.tenantId &&
          item.displayName === actor.name &&
          item.client === 'open-webui' &&
          item.externalOrgId === config.orgId &&
          ['ROLE_GRID_OPERATOR', 'ROLE_EDM'].every((role) => item.roles?.includes(role)) &&
          item.enabled !== false
      )
    )
      throw new Error('Synthetic actor mapping missing');
  async function startRun(scenario) {
    if (scenario.projectFixtures?.length)
      throw new Error(
        'Project manifest practice scenarios require the isolated local transport with synthetic read endpoints'
      );
    return {
      tenantId: config.tenantId,
      prefix: randomUUID(),
      actors: config.actors.map((actor, index) => ({ ...scenario.actors[index], ...actor })),
      files: [],
      datasets: [],
      chats: new Map(),
    };
  }
  async function send(run, turn) {
    const actor = run.actors.find((item) => item.id === turn.actor);
    const chat = `practice-${run.prefix}-${turn.actor}-${turn.chat}`;
    run.chats.set(chat, actor);
    if (turn.operation === 'admin-cleanup') {
      const { statements } = await request('/api/tenant-memory-policy/statements', { admin: true });
      for (const fact of statements.filter(
        (item) =>
          run.actors.some((person) => person.actorId === item.person.actorId) &&
          item.status === 'valid' &&
          String(item.text).includes(turn.anchor || run.anchor)
      ))
        await request(`/api/tenant-memory-policy/statements/${encodeURIComponent(fact.id)}`, {
          method: 'DELETE',
          admin: true,
          body: { reason: 'Praxis-Evaluation: administrative Bereinigung' },
        });
      return { responseText: 'Auditierte Bereinigung abgeschlossen.' };
    }
    let fileRefs;
    if (turn.upload) {
      const spec = {
        ...turn.upload,
        name: turn.upload.name.replace('.', `-${run.prefix.slice(0, 8)}.`),
      };
      const ref = await request('/api/v1/files', {
        method: 'POST',
        actor,
        body: {
          name: spec.name,
          mimeType: spec.kind === 'load' ? 'text/csv' : 'text/plain',
          contentBase64: Buffer.from(practiceDocument(spec)).toString('base64'),
        },
      });
      fileRefs = [ref];
      run.files.push({ actor, ref });
      if (spec.kind === 'load') run.datasets.push({ actor, name: spec.name, chat });
    }
    if (turn.document) run.datasets.push({ actor, name: turn.document.name, chat });
    const data = await request('/v1/chat/completions', {
      method: 'POST',
      actor,
      budgeted: true,
      body: {
        model: GOVERNANCE_MODEL,
        stream: false,
        messages: [{ role: 'user', content: documentMessage(turn) }],
        metadata: {
          client: 'open-webui',
          openWebuiOrgId: config.orgId,
          openWebuiUserId: actor.externalUserId,
          openWebuiConversationId: chat,
          requestId: randomUUID(),
        },
        ...(fileRefs ? { cet_file_refs: fileRefs } : {}),
      },
    });
    if (
      data.cernion?.tenantId !== config.tenantId ||
      !data.cernion?.result ||
      typeof data.choices?.[0]?.message?.content !== 'string'
    )
      throw new Error('Mapped Workbench response or test tenant missing');
    return {
      ...data.cernion.result,
      responseText: data.choices[0].message.content,
      metadata: data.metadata || data.cernion.result.metadata,
    };
  }

  async function cleanup(run) {
    const results = [];
    for (const actor of run.actors)
      try {
        const { statements } = await request('/api/tenant-memory-policy/statements', {
          actor,
          ownCleanup: true,
        });
        for (const fact of statements.filter(
          (item) =>
            item.person.actorId === actor.actorId &&
            item.status !== 'deleted' &&
            (String(item.text).includes(run.anchor) ||
              String(item.conversationId).startsWith(`practice-${run.prefix}-`))
        ))
          await request(`/api/tenant-memory-policy/statements/${encodeURIComponent(fact.id)}`, {
            method: 'DELETE',
            actor,
            ownCleanup: true,
            body: { reason: 'Praxis-Evaluation: eigene Testaussage bereinigen' },
          });
        results.push({
          action: 'tenant-memory-policy.delete',
          passed: true,
          reason: 'Eigene Testaussagen über Autoren-Admin-Token',
        });
      } catch (error) {
        results.push({
          action: 'tenant-memory-policy.delete',
          passed: false,
          reason: error.type || error.name,
        });
      }
    for (const item of run.datasets)
      try {
        const query = new URLSearchParams({
          conversationId: item.chat,
          question: `Welche Daten liegen im Datensatz ${item.name} vor?`,
        });
        const record = await request(`/api/dataset/query?${query}`, {
          actor: item.actor,
          ownCleanup: true,
        });
        if (!record.datasetId && record.datasets?.length)
          throw new Error('Dataset cleanup needs a unique reference');
        const deleted = record.datasetId
          ? await request('/api/workbench/chat', {
              method: 'POST',
              actor: item.actor,
              ownCleanup: true,
              body: {
                channel: 'open-webui',
                conversationId: item.chat,
                openWebuiOrgId: config.orgId,
                openWebuiUserId: item.actor.externalUserId,
                userRequest: `Bitte Datensatz ${record.datasetId} löschen.`,
                response_format: { type: 'json_object' },
              },
            })
          : null;
        results.push({
          action: 'dataset.turn',
          passed: !deleted || /gelöscht/iu.test(deleted.responseText || ''),
          reason: deleted
            ? 'Antwort der auditierten Datensatzlöschung geprüft'
            : 'Kein persistierter Datensatz zu dieser Quelle',
        });
      } catch (error) {
        results.push({ action: 'dataset.turn', passed: false, reason: error.type || error.name });
      }
    for (const item of run.files)
      try {
        await request(`/api/v1/files/${item.ref.fileId}`, { method: 'DELETE', actor: item.actor });
        results.push({ action: 'files.remove', passed: true, reason: 'Dateikanal mit Audit' });
      } catch (error) {
        results.push({ action: 'files.remove', passed: false, reason: error.type || error.name });
      }
    for (const [chat, actor] of run.chats)
      try {
        await request('/api/workbench/chat', {
          method: 'POST',
          actor,
          ownCleanup: true,
          body: {
            channel: 'open-webui',
            openWebuiOrgId: config.orgId,
            openWebuiUserId: actor.externalUserId,
            conversationId: chat,
            userRequest: 'Kein Fall',
            response_format: { type: 'json_object' },
          },
        });
        results.push({
          action: 'workbench.chat',
          passed: true,
          reason: 'Dokumentierte Fallkorrektur',
        });
      } catch (error) {
        results.push({ action: 'workbench.chat', passed: false, reason: error.type || error.name });
      }
    return results;
  }
  return { mode: 'http', startRun, send, cleanup, async close() {} };
}
module.exports = {
  evaluationConfig,
  actorMeta,
  documentMessage,
  createLocalTransport,
  createHttpTransport,
};
