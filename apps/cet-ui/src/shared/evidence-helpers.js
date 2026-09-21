'use strict';

function getEvidenceLevel(statement) {
  if (statement?.sicherheit === 'belegt') return 'belegt';
  if (statement?.sicherheit === 'klaerung') return 'klaerung_offen';
  return 'ungeprueft';
}

function formatSourceAge(source) {
  return source?.stand || source?.timestamp || 'Stand unbekannt';
}

function getReproducibilityStatus(statement) {
  return statement?.granularitaet === 'einzeldatensatz'
    ? 'nur_mit_quelle_reproduzierbar'
    : 'vollstaendig_reproduzierbar';
}

function shouldMaterializeStatement(statement) {
  return statement?.granularitaet === 'aggregat';
}

module.exports = {
  formatSourceAge,
  getEvidenceLevel,
  getReproducibilityStatus,
  shouldMaterializeStatement,
};
