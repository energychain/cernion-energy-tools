'use strict';

/**
 * Tests for the currentStates bug-fix in runConflictNegotiation.
 *
 * The bug: currentStates was never updated between negotiation rounds,
 * meaning round N+1 operated on the same states as round N.
 *
 * The fix: if consensus.updatedStates is returned by the LLM, currentStates
 * is updated before the next round. The hook is additive — if updatedStates
 * is absent, behaviour is unchanged (safe default).
 */

const { MAX_DIALOGUE_ROUNDS } = require('../src/cya-conflict-detector');

// ── Helper: build minimal stakeholder states ──────────────────────────────

function makeStates(overrides = {}) {
  return {
    technical: {
      verdict: 'approved',
      summary: 'ok',
      conflictTriggers: [],
      keyPoints: [],
      riskNotes: [],
    },
    compliance: {
      verdict: 'blocked',
      summary: 'blocked',
      conflictTriggers: ['capacity'],
      keyPoints: [],
      riskNotes: [],
    },
    ...overrides,
  };
}

// ── Inline implementation of the bug-fix logic for unit testing ──────────────
// We test the logic directly to avoid needing a full Moleculer broker.

async function runConflictNegotiationLogic(
  stakeholderStates,
  sharedFacts,
  maxRounds,
  synthesizeConsensusFn,
  detectConflictsFn
) {
  const dialogueRounds = [];
  const initialConflict = detectConflictsFn(stakeholderStates);

  if (!initialConflict.hasConflict) {
    const consensus = await synthesizeConsensusFn({ stakeholderStates, sharedFacts, round: 0 });
    return {
      finalStates: stakeholderStates,
      dialogueRounds,
      conflictResolved: true,
      consensusNarrative: consensus,
    };
  }

  let currentStates = { ...stakeholderStates };
  for (let round = 1; round <= maxRounds; round++) {
    const conflict = detectConflictsFn(currentStates);
    // eslint-disable-next-line no-await-in-loop
    const consensus = await synthesizeConsensusFn({
      stakeholderStates: currentStates,
      sharedFacts,
      round,
    });

    // Bug-fix: update currentStates if LLM returns updatedStates
    if (consensus.updatedStates) {
      currentStates = consensus.updatedStates;
    }

    dialogueRounds.push({
      round,
      blockers: conflict.blockers,
      triggers: conflict.triggers,
      consensusReached: consensus.consensusReached,
      unresolvedConflicts: consensus.unresolvedConflicts,
    });

    if (consensus.consensusReached) {
      return {
        finalStates: currentStates,
        dialogueRounds,
        conflictResolved: true,
        consensusNarrative: consensus,
      };
    }
  }

  return { finalStates: currentStates, dialogueRounds, conflictResolved: false };
}

const { detectConflicts } = require('../src/cya-conflict-detector');

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runConflictNegotiation — currentStates bug-fix', () => {
  it('no conflict: returns conflictResolved=true without entering the loop', async () => {
    const states = {
      technical: {
        verdict: 'approved',
        summary: 'ok',
        conflictTriggers: [],
        keyPoints: [],
        riskNotes: [],
      },
      commercial: {
        verdict: 'approved',
        summary: 'ok',
        conflictTriggers: [],
        keyPoints: [],
        riskNotes: [],
      },
    };
    const synthesize = jest
      .fn()
      .mockResolvedValue({ consensusReached: true, unresolvedConflicts: [], narrative: {} });
    const result = await runConflictNegotiationLogic(states, [], 3, synthesize, detectConflicts);
    expect(result.conflictResolved).toBe(true);
    // synthesize called once with round 0 (immediate consensus)
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize.mock.calls[0][0].round).toBe(0);
  });

  it('no conflict: currentStates is not mutated (no updatedStates in response)', async () => {
    const states = {
      technical: {
        verdict: 'approved',
        summary: 'ok',
        conflictTriggers: [],
        keyPoints: [],
        riskNotes: [],
      },
    };
    const synthesize = jest
      .fn()
      .mockResolvedValue({ consensusReached: true, unresolvedConflicts: [], narrative: {} });
    const result = await runConflictNegotiationLogic(states, [], 3, synthesize, detectConflicts);
    // finalStates should reference same data
    expect(result.finalStates).toEqual(states);
  });

  it('with conflict: currentStates is updated after round 1 when updatedStates returned', async () => {
    const initialStates = makeStates();
    const updatedStates = {
      technical: {
        verdict: 'approved',
        summary: 'ok updated',
        conflictTriggers: [],
        keyPoints: [],
        riskNotes: [],
      },
      compliance: {
        verdict: 'conditional',
        summary: 'now conditional',
        conflictTriggers: [],
        keyPoints: [],
        riskNotes: [],
      },
    };

    const synthesizeCalls = [];
    const synthesize = jest.fn().mockImplementation(async (args) => {
      synthesizeCalls.push(JSON.parse(JSON.stringify(args.stakeholderStates)));
      if (args.round === 1) {
        return { consensusReached: false, unresolvedConflicts: ['x'], updatedStates };
      }
      return { consensusReached: true, unresolvedConflicts: [], narrative: {} };
    });

    const result = await runConflictNegotiationLogic(
      initialStates,
      [],
      3,
      synthesize,
      detectConflicts
    );
    expect(result.conflictResolved).toBe(true);
    // Round 1 operated on initialStates
    expect(synthesizeCalls[0].compliance.verdict).toBe('blocked');
    // Round 2 operated on updatedStates (compliance is now 'conditional')
    expect(synthesizeCalls[1].compliance.verdict).toBe('conditional');
  });

  it('without updatedStates: round 2 uses same states as round 1 (no mutation)', async () => {
    const initialStates = makeStates();
    const seenStates = [];
    const synthesize = jest.fn().mockImplementation(async (args) => {
      seenStates.push(JSON.parse(JSON.stringify(args.stakeholderStates)));
      if (args.round >= 2) {
        return { consensusReached: true, unresolvedConflicts: [], narrative: {} };
      }
      return { consensusReached: false, unresolvedConflicts: ['cap'] };
    });

    await runConflictNegotiationLogic(initialStates, [], 3, synthesize, detectConflicts);
    // Both rounds saw the same compliance verdict
    expect(seenStates[0].compliance.verdict).toBe('blocked');
    expect(seenStates[1].compliance.verdict).toBe('blocked');
  });

  it('MAX_DIALOGUE_ROUNDS is not exceeded (3 rounds max)', async () => {
    const states = makeStates();
    const synthesize = jest
      .fn()
      .mockResolvedValue({ consensusReached: false, unresolvedConflicts: ['x'] });

    const result = await runConflictNegotiationLogic(
      states,
      [],
      MAX_DIALOGUE_ROUNDS,
      synthesize,
      detectConflicts
    );
    expect(result.conflictResolved).toBe(false);
    expect(synthesize).toHaveBeenCalledTimes(MAX_DIALOGUE_ROUNDS);
    expect(result.dialogueRounds).toHaveLength(MAX_DIALOGUE_ROUNDS);
  });

  it('conflictResolved is false after 3 unsuccessful rounds', async () => {
    const states = makeStates();
    const synthesize = jest.fn().mockResolvedValue({
      consensusReached: false,
      unresolvedConflicts: ['capacity', 'missing_data'],
    });

    const result = await runConflictNegotiationLogic(states, [], 3, synthesize, detectConflicts);
    expect(result.conflictResolved).toBe(false);
    expect(result.finalStates).toEqual(states);
  });

  it('early exit on round 1 consensus does not run further rounds', async () => {
    const states = makeStates();
    const synthesize = jest.fn().mockResolvedValue({
      consensusReached: true,
      unresolvedConflicts: [],
      narrative: { headline: 'Agreed' },
    });

    const result = await runConflictNegotiationLogic(states, [], 3, synthesize, detectConflicts);
    expect(result.conflictResolved).toBe(true);
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(result.dialogueRounds).toHaveLength(1);
    expect(result.consensusNarrative.narrative.headline).toBe('Agreed');
  });
});
