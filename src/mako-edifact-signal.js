'use strict';

// Source selection shares the Workbench taxonomy and catalog across Facade/MCP.
// An explicit situation can supply multiple hypotheses; text uses its strongest domain.
function hasMakoEdifactCodeContextSignal(text, situation = {}) {
  const { domainHintsForText } = require('./workbench-activity-taxonomy');
  const { selectSources } = require('./workbench-retrieval');
  const hypotheses = [
    ...(situation.hypotheses || []),
    // Physical connection planning alone must not become a MaKo capability request.
    ...(situation.hypotheses || situation.primaryDomain
      ? []
      : domainHintsForText(text, { limit: 1 })
    )
      .filter((hint) => hint.domain !== 'grid_connection')
      .map((hint) => ({
        kind: 'domain',
        id: hint.domain,
        confidence: 0.7,
      })),
  ];
  return selectSources({ ...situation, hypotheses }, { access: { 'willi-mako': true } }).includes(
    'willi-mako'
  );
}

module.exports = { hasMakoEdifactCodeContextSignal };
