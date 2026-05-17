'use strict';

const {
  ONBOARDING_QUESTION_STATUS,
  buildOnboardingQuestion,
  captureOnboardingAnswer,
  findPendingOnboardingQuestion,
  listAnsweredOnboardingFacts,
  markStaleQuestions,
  resolveParamKeyFromMissing,
} = require('../src/personal-agent-onboarding');

describe('personal-agent-onboarding', () => {
  test('buildOnboardingQuestion returns structured question', () => {
    const q = buildOnboardingQuestion({
      paramKey: 'gridOperatorName',
      action: 'grid-connection.validate',
    });

    expect(q.questionId).toMatch(/^oq_/);
    expect(q.paramKey).toBe('gridOperatorName');
    expect(q.questionText).toContain('Netzbetreiber');
    expect(q.status).toBe(ONBOARDING_QUESTION_STATUS.PENDING);
    expect(q.answeredAt).toBeNull();
    expect(q.answer).toBeNull();
  });

  test('captureOnboardingAnswer accepts heuristically valid answer', () => {
    const question = buildOnboardingQuestion({ paramKey: 'gridOperatorName' });
    const answered = captureOnboardingAnswer({
      question,
      message: 'Stadtwerke Troisdorf GmbH',
    });

    expect(answered).toBeDefined();
    expect(answered.answer).toBe('Stadtwerke Troisdorf GmbH');
    expect(answered.status).toBe(ONBOARDING_QUESTION_STATUS.ANSWERED);
    expect(answered.answeredAt).toBeTruthy();
  });

  test('captureOnboardingAnswer rejects slash commands and very short messages', () => {
    const question = buildOnboardingQuestion({ paramKey: 'gridOperatorName' });

    expect(captureOnboardingAnswer({ question, message: '/help' })).toBeNull();
    expect(captureOnboardingAnswer({ question, message: 'ok' })).toBeNull();
  });

  test('findPendingOnboardingQuestion returns first pending entry', () => {
    const sessionL3 = {
      onboardingQuestions: [
        { questionId: 'q1', status: ONBOARDING_QUESTION_STATUS.ANSWERED },
        { questionId: 'q2', status: ONBOARDING_QUESTION_STATUS.PENDING },
      ],
    };

    const pending = findPendingOnboardingQuestion(sessionL3);
    expect(pending.questionId).toBe('q2');
  });

  test('listAnsweredOnboardingFacts maps answered questions to facts', () => {
    const sessionL3 = {
      onboardingQuestions: [
        {
          questionId: 'q1',
          paramKey: 'gridOperatorName',
          status: ONBOARDING_QUESTION_STATUS.ANSWERED,
          answer: 'Stadtwerke A',
          answeredAt: '2026-05-15T10:00:00Z',
        },
      ],
    };

    const facts = listAnsweredOnboardingFacts(sessionL3);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      paramKey: 'gridOperatorName',
      value: 'Stadtwerke A',
      source: 'onboarding-chat',
    });
  });

  test('markStaleQuestions marks old pending questions as stale', () => {
    const oldTs = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    const sessionL3 = {
      onboardingQuestions: [
        {
          questionId: 'q1',
          ts: oldTs,
          status: ONBOARDING_QUESTION_STATUS.PENDING,
        },
      ],
    };

    const updated = markStaleQuestions(sessionL3, 24);
    expect(updated[0].status).toBe(ONBOARDING_QUESTION_STATUS.STALE);
  });

  test('resolveParamKeyFromMissing prefers gridOperatorName for oneOf tokens', () => {
    const key = resolveParamKeyFromMissing([
      'oneOf:gridOperatorId|gridOperatorBdew|gridOperatorName',
    ]);
    expect(key).toBe('gridOperatorName');
  });

  test('buildOnboardingQuestion humanizes operatorEvidence prompts', () => {
    const q = buildOnboardingQuestion({
      paramKey: 'operatorEvidence',
      action: 'grid-operations.vnbLookup',
    });

    expect(q.questionText).toMatch(/Netzbetreiber|BDEW/i);
    expect(q.questionText).not.toMatch(/operatorEvidence/i);
  });
});
