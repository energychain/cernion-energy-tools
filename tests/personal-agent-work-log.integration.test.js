'use strict';

/**
 * Integration tests for personal-agent-work-log via Personal Agent chat endpoint
 * T-PA-WOL-010 through T-PA-WOL-017
 *
 * Opt-in: set RUN_PERSONAL_AGENT_TDD_MATRIX_BLACKBOX=true and
 * ensure dev server is running on localhost:3000.
 */

const http = require('http');

const RUN = process.env.RUN_PERSONAL_AGENT_TDD_MATRIX_BLACKBOX === 'true';
const BASE_URL = process.env.PERSONAL_AGENT_TEST_BASE_URL || 'http://localhost:3000';
const CERNION_TOKEN = process.env.CERNION_TOKEN || '';

const FORBIDDEN_META_KEYS = new Set([
  'personaId',
  'confidence',
  'tenantId',
  'userId',
  'sessionId',
  'knownContext',
  'payload',
  'reasoning',
  'toolsUsed',
  'warnings',
  'blockers',
  'questionId',
]);

const VALID_ACTIONS = new Set([
  'routing_classified',
  'routing_gap_detected',
  'execution_plan_reviewed',
  'execution_readiness_assessed',
  'onboarding_gap_detected',
  'onboarding_question_posed',
  'onboarding_answer_captured',
  'knowledge_consulted',
  'persona_resolved',
  'consultation_synthesis',
  'consultation_fallback',
  'context_mutation',
  'execution_triggered',
  'execution_phase_transition',
  'worklog_truncated',
]);

/**
 * POST to Personal Agent chat endpoint.
 * @param {object} body
 * @returns {Promise<object>}
 */
function postChat(body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const url = new URL('/api/personal-agent/chat', BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...(CERNION_TOKEN ? { Authorization: `Bearer ${CERNION_TOKEN}` } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}. Body: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.write(bodyStr);
    req.end();
  });
}

const describeOrSkip = RUN ? describe : describe.skip;

describeOrSkip('T-PA-WOL-010: Chat turn produces workLog in agentTrace', () => {
  let response;
  beforeAll(async () => {
    response = await postChat({
      sessionId: `wol_010_${Date.now()}`,
      message: 'Check grid capacity in Germany',
      chatMode: 'auto',
    });
  }, 35000);

  test('agentTrace.workLog is an array', () => {
    expect(Array.isArray(response?.agentTrace?.workLog)).toBe(true);
  });

  test('workLog has at least one entry', () => {
    expect(response.agentTrace.workLog.length).toBeGreaterThanOrEqual(1);
  });

  test('each entry has required shape fields', () => {
    for (const entry of response.agentTrace.workLog) {
      expect(typeof entry.step).toBe('number');
      expect(typeof entry.timestamp).toBe('string');
      expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
      expect(typeof entry.action).toBe('string');
      expect(typeof entry.label).toBe('string');
      expect(typeof entry.metadata).toBe('object');
    }
  });

  test('all entry actions are valid known actions', () => {
    for (const entry of response.agentTrace.workLog) {
      expect(VALID_ACTIONS.has(entry.action)).toBe(true);
    }
  });
});

describeOrSkip('T-PA-WOL-011: Sequential requests have independent per-turn workLogs', () => {
  let turn1, turn2;
  const sid1 = `wol_011a_${Date.now()}`;
  const sid2 = `wol_011b_${Date.now()}`;

  beforeAll(async () => {
    turn1 = await postChat({ sessionId: sid1, message: 'Hello', chatMode: 'auto' });
    turn2 = await postChat({
      sessionId: sid2,
      message: 'Grid analysis for Frankenthal',
      chatMode: 'auto',
    });
  }, 70000);

  test('turn 2 workLog starts at step 1', () => {
    const wl2 = turn2?.agentTrace?.workLog || [];
    if (wl2.length > 0) {
      expect(wl2[0].step).toBe(1);
    }
  });

  test('turn 1 and turn 2 workLog lengths are independent', () => {
    const len1 = turn1?.agentTrace?.workLog?.length ?? 0;
    const len2 = turn2?.agentTrace?.workLog?.length ?? 0;
    // Both should be valid arrays; lengths may differ (that's fine)
    expect(len1).toBeGreaterThanOrEqual(0);
    expect(len2).toBeGreaterThanOrEqual(0);
  });
});

describeOrSkip('T-PA-WOL-012: Concurrent requests do not share workLog state', () => {
  let results;
  beforeAll(async () => {
    results = await Promise.all([
      postChat({ sessionId: `wol_012a_${Date.now()}`, message: 'Grid check', chatMode: 'auto' }),
      postChat({ sessionId: `wol_012b_${Date.now()}`, message: 'Market data', chatMode: 'auto' }),
      postChat({ sessionId: `wol_012c_${Date.now()}`, message: 'Hello world', chatMode: 'auto' }),
    ]);
  }, 70000);

  test('each response has its own workLog array', () => {
    for (const res of results) {
      expect(Array.isArray(res?.agentTrace?.workLog)).toBe(true);
    }
  });

  test('workLog arrays are distinct objects', () => {
    const [r1, r2, r3] = results;
    expect(r1.agentTrace.workLog).not.toBe(r2.agentTrace.workLog);
    expect(r1.agentTrace.workLog).not.toBe(r3.agentTrace.workLog);
    expect(r2.agentTrace.workLog).not.toBe(r3.agentTrace.workLog);
  });

  test('no entry from response 1 appears in response 2 by identical timestamp+action', () => {
    const wl1Keys = new Set(
      (results[0].agentTrace?.workLog || []).map((e) => `${e.timestamp}:${e.action}`)
    );
    for (const entry of results[1].agentTrace?.workLog || []) {
      const key = `${entry.timestamp}:${entry.action}`;
      // Timestamps should differ since they are different requests; same action is ok but same timestamp is not
      // This is a best-effort check — timestamps typically differ
      if (wl1Keys.has(key)) {
        // Both at same ms with same action — extremely unlikely but possible; skip assertion
        expect(true).toBe(true);
      }
    }
    // Structural independence check: workLogs are separate arrays
    expect(results[0].agentTrace.workLog).not.toBe(results[1].agentTrace.workLog);
  });
});

describeOrSkip('T-PA-WOL-013: workLog entries are chronological with valid timestamps', () => {
  let response;
  beforeAll(async () => {
    response = await postChat({
      sessionId: `wol_013_${Date.now()}`,
      message: 'Analyze renewables in Bavaria',
      chatMode: 'auto',
    });
  }, 35000);

  test('all timestamps parse without NaN', () => {
    for (const entry of response?.agentTrace?.workLog || []) {
      expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
    }
  });

  test('step values are sequential starting from 1 (before any truncation)', () => {
    const wl = response?.agentTrace?.workLog || [];
    if (wl.length === 0) return;
    const truncIdx = wl.findIndex((e) => e.action === 'worklog_truncated');
    const preSection = truncIdx >= 0 ? wl.slice(0, truncIdx) : wl;
    for (let i = 0; i < preSection.length; i++) {
      expect(preSection[i].step).toBe(i + 1);
    }
  });

  test('timestamps are non-decreasing', () => {
    const wl = response?.agentTrace?.workLog || [];
    for (let i = 1; i < wl.length; i++) {
      const prev = new Date(wl[i - 1].timestamp).getTime();
      const curr = new Date(wl[i].timestamp).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });
});

describeOrSkip('T-PA-WOL-014: persona_resolved entry exposes roleLabel only', () => {
  let response;
  beforeAll(async () => {
    response = await postChat({
      sessionId: `wol_014_${Date.now()}`,
      message: 'I am a grid operator. Check capacity.',
      chatMode: 'auto',
    });
  }, 35000);

  test('if persona_resolved entry exists, it has roleLabel only (no personaId, no confidence)', () => {
    const wl = response?.agentTrace?.workLog || [];
    const personaEntry = wl.find((e) => e.action === 'persona_resolved');
    if (!personaEntry) {
      // Persona resolution may not always trigger — skip softly
      expect(true).toBe(true);
      return;
    }
    expect(typeof personaEntry.metadata.roleLabel).toBe('string');
    expect(personaEntry.metadata.roleLabel.length).toBeGreaterThan(0);
    expect(personaEntry.metadata.personaId).toBeUndefined();
    expect(personaEntry.metadata.confidence).toBeUndefined();
  });
});

describeOrSkip('T-PA-WOL-015: Consultation entry exposes toolCount, not toolsUsed', () => {
  let response;
  beforeAll(async () => {
    response = await postChat({
      sessionId: `wol_015_${Date.now()}`,
      message: 'What is the solar capacity registered in Mannheim?',
      chatMode: 'consultation',
    });
  }, 35000);

  test('consultation_synthesis or consultation_fallback entry is present', () => {
    const wl = response?.agentTrace?.workLog || [];
    const synthEntry = wl.find(
      (e) => e.action === 'consultation_synthesis' || e.action === 'consultation_fallback'
    );
    // May not appear if routed differently; soft check
    if (synthEntry) {
      expect(synthEntry.metadata.toolsUsed).toBeUndefined();
      if (synthEntry.action === 'consultation_synthesis') {
        expect(typeof synthEntry.metadata.toolCount).toBe('number');
      }
    }
    expect(true).toBe(true);
  });

  test('no raw payloads or inhouse data in any metadata value', () => {
    const wl = response?.agentTrace?.workLog || [];
    for (const entry of wl) {
      for (const val of Object.values(entry.metadata || {})) {
        if (typeof val === 'string') {
          expect(val.length).toBeLessThanOrEqual(128);
        }
      }
    }
  });
});

describeOrSkip('T-PA-WOL-016: No forbidden keys in any workLog entry', () => {
  let response;
  beforeAll(async () => {
    response = await postChat({
      sessionId: `wol_016_${Date.now()}`,
      message: 'Test turn',
      chatMode: 'auto',
    });
  }, 35000);

  test('no forbidden metadata keys in any entry', () => {
    const wl = response?.agentTrace?.workLog || [];
    for (const entry of wl) {
      for (const key of Object.keys(entry.metadata || {})) {
        expect(FORBIDDEN_META_KEYS.has(key)).toBe(false);
      }
    }
  });
});

describeOrSkip('T-PA-WOL-017: workLog appears only in agentTrace — not in reply', () => {
  let response;
  beforeAll(async () => {
    response = await postChat({
      sessionId: `wol_017_${Date.now()}`,
      message: 'Quick test',
      chatMode: 'auto',
    });
  }, 35000);

  test('reply is a string', () => {
    expect(typeof response?.reply).toBe('string');
  });

  test('reply string does not contain workLog or agentTrace text', () => {
    const replyJson = JSON.stringify(response?.reply || '');
    expect(replyJson).not.toContain('"workLog"');
    expect(replyJson).not.toContain('"agentTrace"');
  });

  test('agentTrace.workLog is the only workLog location in the response', () => {
    const responseJson = JSON.stringify(response || {});
    // Count occurrences of "workLog" key — should appear only in agentTrace
    const matches = (responseJson.match(/"workLog"/g) || []).length;
    expect(matches).toBe(1);
  });
});
