'use strict';

// personal-agent methods chunk 5/11 — extracted verbatim from
// services/personal-agent.service.js as part of the v0.99 file-size modularization.
// Contains: buildRecoveryReply, buildLocationAssumptionWarning, normalizeRecoveryText, isCompleteSentence, dedupeCompletedStepSummaries, humanizeCapabilityLabel, buildRecoveryStopText, detectAssumptionDrivenFollowUp, buildAssumptionContinuationNextText, mergeAssumptions, resolveMethodologyFallbackType, buildGenericMethodologicalNextText, buildRecoveryNextText, buildMarketMethodologicalNextText

module.exports = {
  buildRecoveryReply({
    message,
    plan = {},
    execution = {},
    fileIntro = '',
    assumptions = [],
    synthesisStyle = null,
    responseStrategy = null,
  }) {
    const taskTone =
      synthesisStyle === 'cautionary' || this.isFinanceRiskTask(message, plan, execution)
        ? 'finance-risk'
        : 'general';
    const completedStepSummaries = this.summarizeCompletedSteps(plan, execution);
    const stopPoint = execution?.stopPoint || {};
    const progressPrefix =
      taskTone === 'finance-risk' ? 'Für die Risikoprüfung' : 'Für die fachliche Bewertung';
    const styleLead = this.buildSynthesisStyleLead(synthesisStyle);
    const strategyLead = this.buildStrategyLead(responseStrategy);

    const progressText =
      completedStepSummaries.length > 0
        ? `${progressPrefix} habe ich bereits ${completedStepSummaries.length === 1 ? 'einen Prüfschritt' : `${completedStepSummaries.length} Prüfschritte`} abgeschlossen: ${completedStepSummaries.join('; ')}.`
        : `${progressPrefix} konnte ich noch keinen Prüfschritt abschließen.`;

    const locationAssumption = assumptions.find((a) => a.type === 'location_operator_unverified');
    const riskWarning = locationAssumption
      ? this.buildLocationAssumptionWarning(locationAssumption)
      : '';

    const stopText = this.buildRecoveryStopText({ plan, execution, stopPoint, taskTone });
    const nextText = this.buildRecoveryNextText({
      message,
      plan,
      execution,
      stopPoint,
      taskTone,
      assumptions,
    });

    const assumptionText =
      responseStrategy?.assumptions?.length > 0
        ? responseStrategy.assumptions
            .slice(0, 2)
            .map((assumption) => assumption?.statement)
            .filter(Boolean)
            .join(' ')
        : '';

    return this.normalizeRecoveryText(
      [
        styleLead,
        strategyLead,
        fileIntro,
        assumptionText,
        progressText,
        riskWarning,
        stopText,
        nextText,
      ]
        .filter(Boolean)
        .join(' ')
    );
  },

  buildLocationAssumptionWarning(assumption = {}) {
    if (!assumption || !assumption.assertedGridOperatorName) {
      return '';
    }
    return `Wichtig: Die Zuständigkeit des Netzbetreibers ${assumption.assertedGridOperatorName} am Standort ${assumption.location} ist noch nicht durch Evidenz belegt (nur Projektannahme mit Risikoflag).`;
  },

  normalizeRecoveryText(text = '') {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/\.{2,}/g, '.')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/([,.;:!?]){2,}/g, '$1')
      .trim();
  },

  isCompleteSentence(text = '') {
    return /[.!?]$/.test(String(text || '').trim());
  },

  dedupeCompletedStepSummaries(summaries = []) {
    const seen = new Set();
    const result = [];

    for (const summary of summaries) {
      const value = this.normalizeRecoveryText(summary);
      if (!value) continue;
      const key = value
        .toLowerCase()
        .replace(/\s*\(\s*\d+\s*treffer\s*\)\s*$/i, '')
        .trim();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }

    return result;
  },

  humanizeCapabilityLabel(label, fallback = 'fachlicher Prüfschritt') {
    const raw = String(label || '').trim();
    if (!raw) {
      return fallback;
    }

    const normalized = raw.toLowerCase();
    const mappings = [
      ['grid_operator_identity_resolution', 'Netzbetreiber-Zuordnung'],
      ['mastr_asset_inventory', 'Anlagenregister-/MaStR-Prüfung'],
      ['vnb_kpi_benchmark_comparison', 'Netzbetreiber-Benchmark-Prüfung'],
      ['interface_placeholder', 'fehlende Schnittstelle oder Evidenzquelle'],
      ['grid-operator-identity-resolution', 'Netzbetreiber-Zuordnung'],
      ['mastr-asset-inventory', 'Anlagenregister-/MaStR-Prüfung'],
      ['vnb-kpi-benchmark-comparison', 'Netzbetreiber-Benchmark-Prüfung'],
    ];

    for (const [needle, replacement] of mappings) {
      if (normalized.includes(needle)) {
        return replacement;
      }
    }

    if (/execute curated capability path/i.test(raw)) {
      return fallback;
    }

    const isTechnicalToken =
      /execute curated capability path/i.test(raw) ||
      /\binterface_placeholder\b/i.test(raw) ||
      /\b(grid_operator_identity_resolution|mastr_asset_inventory|vnb_kpi_benchmark_comparison)\b/i.test(
        raw
      ) ||
      /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b/i.test(raw);

    const stripped = raw
      .replace(/^execute curated capability path for\s+/i, '')
      .replace(/^execute curated capability path:\s*/i, '')
      .replace(/\binterface_placeholder\b/gi, 'fehlende Schnittstelle oder Evidenzquelle')
      .replace(
        /\b(grid_operator_identity_resolution|mastr_asset_inventory|vnb_kpi_benchmark_comparison)\b/gi,
        ''
      )
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!stripped) {
      return fallback;
    }

    if (isTechnicalToken) {
      return fallback;
    }

    return stripped;
  },

  buildRecoveryStopText({ plan = {}, execution = {}, stopPoint = {}, taskTone }) {
    const blockedStepLabel = this.describeBlockedStep(plan, stopPoint);

    if (stopPoint.reasonCode === 'MISSING_INPUTS' || execution?.status === 'awaiting-onboarding') {
      const missingText = this.describeMissingRecoveryInputs(stopPoint);
      const hasFullQuestion = this.isCompleteSentence(missingText);
      const missingSummary = hasFullQuestion ? 'die offene Evidenz' : missingText;
      return taskTone === 'finance-risk'
        ? `Es fehlt noch ${missingSummary}.`
        : `Mir fehlt noch ${missingSummary}.`;
    }

    if (
      stopPoint.status === 'interface-placeholder' ||
      stopPoint.reasonCode === 'UNSUPPORTED_CHAIN'
    ) {
      return taskTone === 'finance-risk'
        ? `Der Stopp liegt an einer fehlenden Schnittstelle oder Evidenzquelle beim Prüfpunkt "${blockedStepLabel}".`
        : `Der Stopp liegt an einer fehlenden Schnittstelle oder Evidenzquelle beim Schritt "${blockedStepLabel}".`;
    }

    if (stopPoint.reasonCode === 'ACTION_FAILED') {
      const detail = stopPoint.message
        ? ` Grund: ${this.normalizeRecoveryText(stopPoint.message)}`
        : '';
      return taskTone === 'finance-risk'
        ? `Der Prüfpunkt "${blockedStepLabel}" konnte fachlich nicht belastbar abgeschlossen werden.${detail}`
        : `Der Schritt "${blockedStepLabel}" konnte fachlich nicht belastbar abgeschlossen werden.${detail}`;
    }

    if (stopPoint.reasonCode) {
      return taskTone === 'finance-risk'
        ? `Der Prüfpunkt "${blockedStepLabel}" ist an einer offenen fachlichen Bedingung hängengeblieben.`
        : `Der Schritt "${blockedStepLabel}" ist an einer offenen fachlichen Bedingung hängengeblieben.`;
    }

    return taskTone === 'finance-risk'
      ? 'Für die Risikoprüfung fehlt noch ein belastbarer Anschlussprüfpunkt.'
      : 'Für die fachliche Bewertung fehlt noch ein belastbarer Anschlussprüfpunkt.';
  },

  detectAssumptionDrivenFollowUp(message = '') {
    const normalized = String(message || '').toLowerCase();

    if (!normalized) {
      return null;
    }

    if (
      /(risk assessment|risikoampel|kreditausschuss|condition precedent|due diligence|due-diligence|risikobewertung|risikoanalyse)/i.test(
        normalized
      )
    ) {
      return 'risk';
    }

    if (
      /(markt|regulator|preisdaten|preis|entso-e|netztransparenz|methodik|methodologie|datenquelle|day-ahead|negativpreis|volatilität|volatilitaet)/i.test(
        normalized
      )
    ) {
      return 'market';
    }

    if (
      /(vorläufigen annahme|vorlaeufigen annahme|arbeite .* weiter|weiterarbeiten|nächste fachliche schritte|naechste fachliche schritte|nächste schritte|naechste schritte|wie weiter|fortfahren|weiter vorgehen)/i.test(
        normalized
      )
    ) {
      return 'continuation';
    }

    return null;
  },

  buildAssumptionContinuationNextText(taskTone = 'general', assumption = null) {
    const assumptionNote = assumption
      ? ' Die Bewertung bleibt bis zur Evidenzprüfung ausdrücklich vorläufig.'
      : '';

    return taskTone === 'finance-risk'
      ? `Ich kann auf Basis der Working Assumption fachlich weiterarbeiten: zunächst offene Evidenzpunkte priorisieren, dann Markt-/Regulatorik-Annahmen dokumentieren und anschließend die Condition-Precedent-Themen für die Due Diligence strukturieren.${assumptionNote}`
      : `Ich kann auf Basis der Working Assumption fachlich weiterarbeiten: als Nächstes die Methodik, offene Evidenzpunkte und benötigten Anschlussunterlagen strukturiert auflisten.${assumptionNote}`;
  },

  mergeAssumptions(existing = [], incoming = []) {
    const merged = [];
    const seen = new Set();

    for (const item of [...(existing || []), ...(incoming || [])]) {
      if (!item || typeof item !== 'object' || !item.type) {
        continue;
      }

      const key = [
        item.type,
        item.location || '',
        item.assertedGridOperatorName || '',
        item.status || '',
      ]
        .join('::')
        .toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(item);
    }

    return merged;
  },

  resolveMethodologyFallbackType({ message, plan = {}, execution = {} }) {
    const routingSignals = [
      message,
      plan?.primaryIntent,
      plan?.routeKey,
      plan?.routeLabel,
      ...(Array.isArray(plan?.secondaryIntents) ? plan.secondaryIntents : []),
      ...(Array.isArray(plan?.requestedDomains) ? plan.requestedDomains : []),
      ...(Array.isArray(plan?.unsupportedDomains) ? plan.unsupportedDomains : []),
      ...(Array.isArray(plan?.steps)
        ? plan.steps.map((step) => `${step?.purpose || ''} ${step?.label || ''}`)
        : []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (
      /(market|markt|regulator|preis|pricing|preisdaten|entso-e|netztransparenz|day-ahead|negativpreis|volatil)/i.test(
        routingSignals
      )
    ) {
      return 'market';
    }

    if (
      /(risk assessment|risk|risiko|due diligence|due-diligence|kreditausschuss|kredit|loan|lender|investment committee|komitee|condition precedent)/i.test(
        routingSignals
      )
    ) {
      return 'risk';
    }

    if (this.isFinanceRiskTask(message, plan, execution)) {
      return 'finance-risk-generic';
    }

    return null;
  },

  buildGenericMethodologicalNextText(taskTone = 'finance-risk', assumption = null) {
    const assumptionNote = assumption
      ? ' Die Einordnung bleibt bis zur Evidenzprüfung ausdrücklich vorläufig.'
      : '';

    return taskTone === 'finance-risk'
      ? `Ohne angebundene Fachschnittstelle liefere ich zunächst eine belastbare Methodik: Annahmen offenlegen, Evidenzlücken priorisieren, Sensitivitäten dokumentieren und Entscheidungsvorbehalte sauber trennen.${assumptionNote}`
      : `Ohne angebundene Fachschnittstelle kann ich zunächst Methodik, Evidenzlücken und nächste Prüfschritte strukturiert benennen.${assumptionNote}`;
  },

  buildRecoveryNextText({
    message,
    plan = {},
    execution = {},
    stopPoint = {},
    taskTone,
    assumptions = [],
  }) {
    const locationAssumption = assumptions.find((a) => a.type === 'location_operator_unverified');
    const followUpType = locationAssumption ? this.detectAssumptionDrivenFollowUp(message) : null;

    if (followUpType === 'market') {
      return this.buildMarketMethodologicalNextText(taskTone, locationAssumption);
    }

    if (followUpType === 'risk') {
      return this.buildRiskAssessmentNextText(taskTone, locationAssumption);
    }

    if (followUpType === 'continuation') {
      return this.buildAssumptionContinuationNextText(taskTone, locationAssumption);
    }

    if (stopPoint.reasonCode === 'MISSING_INPUTS' || execution?.status === 'awaiting-onboarding') {
      const questionText = stopPoint?.onboardingQuestion?.questionText;
      if (questionText) {
        return this.isCompleteSentence(questionText)
          ? questionText
          : `Bitte beantworte konkret: ${this.normalizeRecoveryText(questionText)}`;
      }

      const missingText = this.describeMissingRecoveryInputs(stopPoint);
      return taskTone === 'finance-risk'
        ? `Bitte nenne ${missingText}, damit ich die Due-Diligence-Bedingung prüfen kann.`
        : `Bitte nenne ${missingText}, damit ich fortfahren kann.`;
    }

    if (
      stopPoint.status === 'interface-placeholder' ||
      stopPoint.reasonCode === 'UNSUPPORTED_CHAIN'
    ) {
      const fallbackType = this.resolveMethodologyFallbackType({
        message,
        plan,
        execution,
      });

      if (fallbackType === 'market') {
        return this.buildMarketMethodologicalNextText(taskTone, locationAssumption);
      }

      if (fallbackType === 'risk') {
        return this.buildRiskAssessmentNextText(taskTone, locationAssumption);
      }

      if (fallbackType === 'finance-risk-generic') {
        return this.buildGenericMethodologicalNextText(taskTone, locationAssumption);
      }

      const suggestion = this.getRecoveryNextSuggestion(stopPoint, plan);
      return taskTone === 'finance-risk'
        ? `Nächster Schritt: ${suggestion} oder die fehlende Evidenz nachreichen.`
        : `Nächster Schritt: ${suggestion} oder die fehlende Evidenz nachreichen.`;
    }

    if (stopPoint.reasonCode === 'ACTION_FAILED') {
      const failureText = String(stopPoint.message || '').toLowerCase();
      if (/vnblookup|vnb|bdew|netzbetreiber/.test(failureText)) {
        return 'Nächster Schritt: den BDEW-Code nennen oder zuerst eine eindeutige Marktpartner-/Netzbetreiber-Suche durchführen, damit die VNB-Zuordnung belastbar aufgelöst werden kann.';
      }
      return taskTone === 'finance-risk'
        ? 'Nächster Schritt: die offene Evidenz nachreichen oder den Prüfpunkt mit einer verfügbaren Capability neu anstoßen.'
        : 'Nächster Schritt: die offene Evidenz nachreichen oder den Prüfschritt mit einer verfügbaren Capability neu anstoßen.';
    }

    return taskTone === 'finance-risk'
      ? 'Bitte liefere die fehlende Evidenz für die belastbare Risikobewertung.'
      : 'Bitte liefere die fehlenden Angaben für den nächsten Prüfschritt.';
  },

  buildMarketMethodologicalNextText(taskTone = 'general', assumption = null) {
    const assumptionNote = assumption
      ? ` Die Auswertung unter unbestätigter Netzbetreiber-Zuständigkeit bleibt vorläufig.`
      : '';
    return taskTone === 'finance-risk'
      ? `Methodik für Preisdaten: Day-Ahead-Spreads, Negativpreisstunden und Volatilität separat auswerten. Erforderliche Datenquellen: ENTSO-E, Netztransparenz oder Market Snapshot.${assumptionNote}`
      : `Verfügbare Datenquellen: ENTSO-E, Netztransparenz, Market Snapshot. Ohne angebundene Live-Quelle nur Methodologie möglich.${assumptionNote}`;
  },
};
