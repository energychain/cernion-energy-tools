test('a message of several sentences is no correction command', () => {
  const { isCorrectionTurn } = require('../src/workbench-corrections');
  expect(
    isCorrectionTurn(
      'Der Fachbereich meldet zurück: Der Scan gehört zu LOC-SYN-8326 und zum Vorgang 018. Zielvorgang 017 betrifft LOC-SYN-8327. Bitte verarbeite die Korrektur vollständig.'
    )
  ).toBe(false);
  expect(isCorrectionTurn('Rückgängig')).toBe(true);
});
