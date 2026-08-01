'use strict';

// personal-agent methods chunk 6/11 — extracted verbatim from
// services/personal-agent.service.js as part of the v0.99 file-size modularization.
// Contains: buildRiskAssessmentNextText, getRecoveryNextSuggestion, summarizeCompletedSteps, summarizeStepOutcome, describeBlockedStep, describeMissingRecoveryInputs, humanizeMissingParam, humanizeActionName, isFinanceRiskTask, getBrokerRecommendation, isEvCo2ChargingRequest, extractMultiTurnContextHints, buildPreferredReceiptsForTurn, isHitlApprovalIntent

const { isActionUnavailable } = require('./shared');

module.exports = {
  buildRiskAssessmentNextText(taskTone = 'finance-risk', assumption = null) {
    const assumptionCondition = assumption
      ? `\n• Condition Precedent: Vor Auszahlung muss Netzbetreiber-/Netzanschlusspunkt-Zuständigkeit durch BKZ, BDEW-Code oder Netzanschlusszusage verifiziert sein.`
      : '';
    return taskTone === 'finance-risk'
      ? `Ich stelle ein vorläufiges Risk Assessment zusammen basierend auf bisheriger Evidenz. Struktur: Projektverständnis, Risikoampel, offene Due-Diligence-Punkte, Kreditausschuss-Empfehlung.${assumptionCondition}`
      : `Risk Assessment mit bisheriger Evidenz (vorläufig).${assumptionCondition}`;
  },

  getRecoveryNextSuggestion(stopPoint = {}, plan = {}) {
    if (stopPoint?.onboardingQuestion?.questionText) {
      return stopPoint.onboardingQuestion.questionText;
    }

    const metadataSuggestions = Array.isArray(stopPoint?.placeholderMetadata?.suggestedNextSteps)
      ? stopPoint.placeholderMetadata.suggestedNextSteps.filter(
          (item) => typeof item === 'string' && item.trim()
        )
      : [];
    if (metadataSuggestions.length > 0) {
      return this.humanizeCapabilityLabel(
        metadataSuggestions[0],
        'die fehlende Evidenz nachreichen'
      );
    }

    const blockedStepLabel = this.describeBlockedStep(plan, stopPoint);
    return `den Prüfpunkt "${blockedStepLabel}" an eine verfügbare Schnittstelle oder Evidenzquelle übergeben`;
  },

  summarizeCompletedSteps(plan = {}, execution = {}) {
    const completedSteps = Array.isArray(execution?.steps)
      ? execution.steps.filter((step) => step && step.status === 'completed')
      : [];

    const summaries = completedSteps.slice(0, 3).map((step) => {
      const plannedStep = Array.isArray(plan?.steps)
        ? plan.steps.find((item) => item.step === step.step || item.action === step.action)
        : null;
      const label = this.humanizeCapabilityLabel(
        plannedStep?.purpose || plannedStep?.label || step.label || step.action,
        this.humanizeActionName(step.action)
      );
      const outcome = this.summarizeStepOutcome(step.result);
      return outcome ? `${label} (${outcome})` : label;
    });

    return this.dedupeCompletedStepSummaries(summaries);
  },

  summarizeStepOutcome(result) {
    if (!result || typeof result !== 'object') {
      return '';
    }

    const hints = [];
    if (typeof result.recommendation === 'string' && result.recommendation.trim()) {
      hints.push(result.recommendation.trim());
    }
    if (typeof result.decision === 'string' && result.decision.trim()) {
      hints.push(result.decision.trim());
    }
    if (typeof result.riskLevel === 'string' && result.riskLevel.trim()) {
      hints.push(`Risiko ${result.riskLevel.trim()}`);
    }
    if (Number.isFinite(result.paybackYears)) {
      hints.push(`Amortisation ${Number(result.paybackYears).toFixed(1)} Jahre`);
    }
    if (Array.isArray(result.findings)) {
      hints.push(`${result.findings.length} Befund${result.findings.length === 1 ? '' : 'e'}`);
    }
    const resultList = Array.isArray(result?.data?.results)
      ? result.data.results
      : Array.isArray(result?.results)
        ? result.results
        : null;
    if (Array.isArray(resultList)) {
      hints.push(resultList.length === 0 ? 'kein Treffer' : `${resultList.length} Treffer`);
    }
    if (typeof result.status === 'string') {
      const status = result.status.trim().toLowerCase();
      if (['eligible', 'ready', 'approved', 'ok', 'warning'].includes(status)) {
        hints.push(`Status ${result.status.trim()}`);
      }
    }

    return hints.slice(0, 2).join(', ');
  },

  describeBlockedStep(plan = {}, stopPoint = {}) {
    const blockedStepNumber = Number(stopPoint?.blockedStep || 0);
    const plannedStep = Array.isArray(plan?.steps)
      ? plan.steps.find(
          (step) => step.step === blockedStepNumber || step.action === stopPoint?.blockedAction
        )
      : null;

    if (plannedStep) {
      return this.humanizeCapabilityLabel(
        plannedStep.purpose || plannedStep.label || plannedStep.action,
        this.humanizeActionName(plannedStep.action)
      );
    }

    const rawBlocked = stopPoint?.placeholderMetadata?.title || stopPoint?.blockedAction;
    return this.humanizeCapabilityLabel(
      rawBlocked,
      blockedStepNumber > 0 ? `Schritt ${blockedStepNumber}` : 'der nächste fachliche Prüfschritt'
    );
  },

  describeMissingRecoveryInputs(stopPoint = {}) {
    const questionText = stopPoint?.onboardingQuestion?.questionText;
    if (questionText) {
      return questionText;
    }

    const missingParams = Array.isArray(stopPoint?.missingParams) ? stopPoint.missingParams : [];
    if (missingParams.length > 0) {
      const labels = missingParams.map((param) => this.humanizeMissingParam(param));
      if (labels.length === 1) {
        return labels[0];
      }
      return `${labels.slice(0, -1).join(', ')} und ${labels[labels.length - 1]}`;
    }

    return 'die fehlenden Angaben';
  },

  humanizeMissingParam(param) {
    const mapping = {
      taskId: 'die VDMI-Task-ID',
      agentId: 'den verantwortlichen Akteur',
      matrixId: 'die VDMI-Matrix-ID',
      processId: 'die Prozess-ID',
      projectId: 'die Projekt-ID',
      gridOperatorName: 'den Netzbetreiber',
      gridOperatorId: 'die Netzbetreiber-ID',
      gridOperatorBdew: 'den BDEW-Code',
      bdew: 'den BDEW-Code',
      city: 'den Ort',
      vnbName: 'den Netzbetreibernamen',
      query: 'einen belastbaren Suchhinweis (Netzbetreiber, BDEW-Code oder Ort)',
      operatorEvidence: 'den Netzbetreiber oder den BDEW-Code',
      fnavProfile: 'das fNAV-Profil',
      voltageLevel: 'die Spannungsebene',
      ownerContact: 'den Ansprechpartner',
      communityName: 'den Gemeinschaftsnamen',
      communityId: 'die Gemeinschafts-ID',
      generators: 'die Erzeugungsdaten',
      consumers: 'die Verbrauchsdaten',
      dateFrom: 'den Startzeitpunkt',
      dateTo: 'den Endzeitpunkt',
      annualFeeEur: 'den Jahresbetrag',
    };

    if (mapping[param]) {
      return mapping[param];
    }

    const fallback = String(param || 'Angabe')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim();

    return fallback ? `den Wert für ${fallback}` : 'die fehlende Angabe';
  },

  humanizeActionName(action) {
    const text = String(action || 'der nächste Schritt')
      .replace(/\./g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'der nächste Schritt';
  },

  isFinanceRiskTask(message, plan = {}, execution = {}) {
    const haystack = [
      message,
      plan?.primaryIntent,
      plan?.routeLabel,
      plan?.routeKey,
      ...(Array.isArray(plan?.steps)
        ? plan.steps.map((step) => `${step.action || ''} ${step.purpose || ''}`)
        : []),
      ...(Array.isArray(execution?.steps)
        ? execution.steps.map((step) => `${step.action || ''} ${step.purpose || ''}`)
        : []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return /(kredit|credit|loan|bank|finanz|finance|risk|risiko|due diligence|due-diligence|bewertung|invest|investment|lender|komitee)/i.test(
      haystack
    );
  },

  async getBrokerRecommendation(
    ctx,
    message,
    knownContext = {},
    resolvedParams = {},
    resolvedCapabilities = []
  ) {
    try {
      return await ctx.call(
        'capability-broker.recommend',
        {
          schemaVersion: 'cernion.capabilityRecommendation.v1',
          task: message,
          mode: 'initial',
          knownContext,
          resolvedParams,
          resolvedCapabilities,
        },
        { meta: { ...ctx.meta, $gateway: false } }
      );
    } catch (error) {
      if (isActionUnavailable(error)) {
        return null;
      }
      throw error;
    }
  },

  isEvCo2ChargingRequest(message = '', knownContext = {}, session = null) {
    const historyTexts = [];
    if (session?.l3?.history && Array.isArray(session.l3.history)) {
      // Include last 6 history entries (~3 prior turns) to detect multi-turn EV+CO2 intent
      session.l3.history.slice(-6).forEach((turn) => {
        if (turn?.role === 'user' && turn?.text) {
          historyTexts.push(turn.text);
        }
      });
    }

    const haystack = [
      message,
      knownContext?.message,
      knownContext?.intent,
      knownContext?.domainIntent,
      ...historyTexts,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const hasChargingIntent =
      /\b(?:ev|e-?auto|elektroauto|wallbox|laden|ladezeit|ladung|charging)\b/i.test(haystack);
    const hasCarbonIntent =
      /(?:\b(?:co2|kohlenstoff|emission|emissions|grünstrom|gruenstrom|gsi|strommix|klima)\b|co₂)/i.test(
        haystack
      );

    return hasChargingIntent && hasCarbonIntent;
  },

  extractMultiTurnContextHints(session = null) {
    if (!session?.l3?.history || !Array.isArray(session.l3.history)) {
      return {};
    }
    const hints = {};
    const recentUserTurns = session.l3.history
      .slice(-8)
      .filter((turn) => turn?.role === 'user' && turn?.text);

    for (const turn of recentUserTurns) {
      const text = String(turn.text);
      if (!hints.postalCode) {
        const plzMatch = text.match(/\b(\d{5})\b/);
        if (plzMatch) {
          hints.postalCode = plzMatch[1];
          hints.postleitzahl = plzMatch[1];
          const cityMatch = text.match(
            new RegExp(`\\b${plzMatch[1]}\\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+)`)
          );
          if (cityMatch) {
            hints.city = cityMatch[1];
            hints.location = cityMatch[1];
          }
        }
      }
    }
    return hints;
  },

  buildPreferredReceiptsForTurn(
    message = '',
    knownContext = {},
    explicitPreferred = [],
    session = null
  ) {
    const preferred = Array.isArray(explicitPreferred) ? [...explicitPreferred] : [];
    if (
      this.isEvCo2ChargingRequest(message, knownContext, session) &&
      !preferred.includes('ev-charging-co2-optimization-v1')
    ) {
      preferred.unshift('ev-charging-co2-optimization-v1');
    }
    return preferred;
  },

  isHitlApprovalIntent(message = '') {
    const normalized = String(message || '')
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss');

    return (
      /\b(?:ja|ok|okay|approve|approved|freigeben|freigabe|genehmigen|genehmigt|bestaetigen|bestaetigt|bestaetogt)\b/.test(
        normalized
      ) || /\bich\s+(?:gebe\s+frei|genehmige|bestaetige)\b/.test(normalized)
    );
  },
};
