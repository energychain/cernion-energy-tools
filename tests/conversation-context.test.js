'use strict';

const { conversationHistory, HISTORY_INSTRUCTION } = require('../src/conversation-context');

describe('conversation history (AP1)', () => {
  test('keeps both roles in order and drops other entries', () => {
    const { turns, omitted } = conversationHistory([
      { role: 'system', content: 'intern' },
      { role: 'user', content: 'Erste Frage' },
      { role: 'assistant', content: 'Erste Antwort' },
      { role: 'user', content: '   ' },
      { role: 'user', content: { text: 'kein Text' } },
      { role: 'user', content: 'Zweite Frage' },
    ]);
    expect(turns).toEqual([
      { role: 'user', text: 'Erste Frage' },
      { role: 'assistant', text: 'Erste Antwort' },
      { role: 'user', text: 'Zweite Frage' },
    ]);
    expect(omitted).toBe(0);
  });

  test('recent turns stay full, older ones are condensed, the budget drops the oldest', () => {
    const long = (label) => `${label} ${'x'.repeat(5000)}`;
    const messages = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: long(`T${index + 1}`),
    }));
    const { turns, omitted } = conversationHistory(messages, { budget: 30000 });
    const last = turns[turns.length - 1];
    expect(last.text.startsWith('T20')).toBe(true);
    expect(last.text.length).toBeGreaterThan(3900);
    const older = turns.find((turn) => turn.text.length < 700);
    expect(older.text.endsWith('…')).toBe(true);
    expect(turns.reduce((sum, turn) => sum + turn.text.length, 0)).toBeLessThanOrEqual(30000);
    expect(omitted).toBe(20 - turns.length);
    expect(omitted).toBeGreaterThan(0);
  });

  test('the instruction marks own earlier answers as no evidence', () => {
    expect(HISTORY_INSTRUCTION).toMatch(/keine Belege/u);
  });
});
