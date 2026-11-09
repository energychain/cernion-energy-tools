'use strict';
// CTX-01: across conversations only person attributes carry over, never the excerpt or content
// of an earlier message.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PouchDB = require('pouchdb');
const { WorkbenchStore } = require('../src/workbench-store');

test('the person context keeps role and preference but drops goal, basis and statement', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-person-'));
  const contextDb = new PouchDB(path.join(dir, 'context'));
  try {
    const store = new WorkbenchStore({ contextDb });
    await store.saveUserContext({
      tenantId: 't',
      actorId: 'a',
      conversationContext: {
        role: 'Abteilungsleitung',
        preference: 'kurz',
        mandate: 'Priorisierung',
        durable: true,
        goal: 'Fall SYN-CASE-1 aufnehmen',
        basis: 'Für das Objekt SYN-OBJ-1 fehlt seit Monat 3 die Abrechnung.',
        statement: 'Objekt SYN-OBJ-1 ohne Abrechnung',
      },
    });
    const [row] = (await contextDb.allDocs({ include_docs: true })).rows;
    const saved = row.doc;
    expect(saved.conversationContext).toEqual({
      role: 'Abteilungsleitung',
      preference: 'kurz',
      mandate: 'Priorisierung',
      durable: true,
      goal: '',
    });
    expect(JSON.stringify(saved)).not.toContain('SYN-OBJ-1');
    // A profile stored before the cleanup is cleaned when read.
    await contextDb.put({
      ...saved,
      conversationContext: { ...saved.conversationContext, basis: 'Altes Objekt SYN-OBJ-2' },
    });
    const read = await store.getUserContext({ tenantId: 't', actorId: 'a' });
    expect(JSON.stringify(read)).not.toContain('SYN-OBJ-2');
    expect(read.conversationContext.role).toBe('Abteilungsleitung');
  } finally {
    await contextDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
