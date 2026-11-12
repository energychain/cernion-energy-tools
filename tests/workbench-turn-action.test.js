'use strict';

const {
  readTurnAction,
  lastAssistantMessage,
  correctionIntent,
  MAX_COMMAND_CHARS,
} = require('../src/workbench-turn-action');

const client = (data) => ({ generateStructured: jest.fn(async () => ({ data })) });

describe('turn action (conversation core v2)', () => {
  test('free wording of a responsibility correction becomes the correction intent', async () => {
    const llm = client({
      action: 'function',
      target: 'coverage',
      positive: true,
      phrase: 'Alpha Review',
    });
    const result = await readTurnAction(
      { message: 'Das Alpha Review mache ab sofort komplett ich.', tenantId: 't' },
      llm
    );
    expect(result.correction).toEqual({
      type: 'function',
      target: 'coverage',
      correction: { score: 1 },
      phrase: 'Alpha Review',
    });
    expect(JSON.parse(llm.generateStructured.mock.calls[0][1]).message).toContain('Alpha Review');
  });

  test('confirmation, case link and discarding the case offer carry their parameters', async () => {
    expect(
      (await readTurnAction({ message: 'Passt so.' }, client({ action: 'confirm' }))).correction
    ).toEqual({ type: 'confirm' });
    const link = await readTurnAction(
      { message: 'Mit F-12 hat das nichts zu tun.' },
      client({ action: 'case_link', positive: false, identifier: 'F-12' })
    );
    expect(link).toMatchObject({
      action: 'case_link',
      caseLink: { related: false, caseRef: 'F-12' },
    });
    expect(link.correction).toBeNull();
    expect(
      (
        await readTurnAction(
          { message: 'Lass das, keinen Fall.' },
          client({ action: 'discard_case' })
        )
      ).action
    ).toBe('discard_case');
  });

  test('a long message is a regular turn without a model call; a failed call changes nothing', async () => {
    const llm = client({ action: 'confirm' });
    expect((await readTurnAction({ message: 'x'.repeat(MAX_COMMAND_CHARS + 1) }, llm)).action).toBe(
      'content'
    );
    expect(llm.generateStructured).not.toHaveBeenCalled();
    const failing = { generateStructured: jest.fn(async () => Promise.reject(new Error('down'))) };
    const warn = jest.fn();
    expect((await readTurnAction({ message: 'Ja.', logger: { warn } }, failing)).action).toBe(
      'content'
    );
    expect(warn).toHaveBeenCalled();
    expect((await readTurnAction({ message: 'Ja.' }, client({ action: 'unknown' }))).action).toBe(
      'content'
    );
  });

  test('intents of proposals, lists, preferences and agent kinds', () => {
    expect(correctionIntent({ action: 'proposal', positive: false, identifier: 'v-3' })).toEqual({
      type: 'proposal',
      identifier: 'V-3',
      description: '',
      outcome: 'rejected',
    });
    expect(
      correctionIntent({ action: 'gap', positive: true, description: 'Zähler' })
    ).toMatchObject({ type: 'gap', kind: 'gap_done', description: 'Zähler' });
    expect(correctionIntent({ action: 'preference', preference: 'off' })).toEqual({
      type: 'preference',
      preference: 'off',
    });
    expect(
      correctionIntent({ action: 'function', target: 'agent', agentKind: 'pin', phrase: 'X' })
    ).toMatchObject({ target: 'agent', correction: { kind: 'pin' } });
    expect(
      correctionIntent({
        action: 'function',
        target: 'neighbor',
        positive: false,
        phrase: 'A',
        neighborPhrase: 'B',
      })
    ).toMatchObject({ correction: { weight: 0 }, neighborPhrase: 'B' });
    expect(correctionIntent({ action: 'function', target: '' })).toBeNull();
  });

  test('the previous CET message is the context of a short reply', () => {
    expect(
      lastAssistantMessage([
        { role: 'assistant', content: 'Soll ich einen Fall anlegen?' },
        { role: 'user', content: 'Ja' },
      ])
    ).toBe('Soll ich einen Fall anlegen?');
    expect(lastAssistantMessage([])).toBe('');
  });
});
