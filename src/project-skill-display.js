'use strict';

const lifecycles = {
  draft: 'Entwurf',
  active: 'aktiv',
  degraded: 'herabgestuft',
  retired: 'stillgelegt',
};
const reasons = {
  repeated_evidenced_question: 'zwei bedeutungsähnliche belegte Fragen',
  manifest_without_skill: 'Fragetyp ohne gelernten Check',
  degraded_skill: 'Neuentwurf nach Herabstufung',
  automatic_validation_passed: 'automatische Prüfung bestanden',
  automatic_validation_failed: 'automatische Prüfung fehlgeschlagen',
  revalidation_passed: 'erneute Prüfung bestanden',
  revalidation_failed: 'Datenänderung lässt Prüffälle scheitern',
  execution_validation_failed: 'Ausführungsprüfung fehlgeschlagen',
  user_retired: 'auf Wunsch stillgelegt',
  user_reported_incorrect: 'Ergebnis als falsch korrigiert',
  used: 'für eine Antwort verwendet',
  transfer_requested: 'neuer Entwurf für eine andere Akte angefordert',
  transferred_skill: 'Übertragung mit eigener Aktenprüfung',
  parent_retired: 'Ausgangscheck stillgelegt',
  superseded_evidence: 'neuere belegte Antwort ersetzt den fehlgeschlagenen Entwurf',
};
const kinds = {
  created: 'angelegt',
  decided: 'geprüft',
  corrected: 'korrigiert',
  retired: 'stillgelegt',
};
function resultText(result) {
  if (!result.rows) return String(result.value);
  return result.rows
    .map((row) =>
      Object.entries(row)
        .map(
          ([key, value]) =>
            `${key.replaceAll('_', ' ')}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
        )
        .join('; ')
    )
    .join('\n');
}
module.exports = { lifecycles, reasons, kinds, resultText };
