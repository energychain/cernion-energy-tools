'use strict';

function tableQualityMatrix(variant = false, withUnit = false) {
  const factor = variant ? 1.1 : 1;
  return [
    ['Key', 'Group', withUnit ? 'Amount [kg]' : 'Amount'],
    ['R001', 'a', 10 * factor],
    ['R002', 'a', 20 * factor],
    ['Check', '', 30 * factor],
    ['R003', 'b', 7 * factor],
    ['R004', '', 3 * factor],
    ['', '', 40 * factor],
    ['', '', 40 * factor],
  ];
}

function tableQualityText({ variant = false, withUnit = false, decimalComma = false } = {}) {
  return tableQualityMatrix(variant, withUnit)
    .map((row) =>
      row
        .map((cell) =>
          decimalComma && typeof cell === 'number'
            ? cell.toLocaleString('de-DE', {
                useGrouping: false,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : cell
        )
        .join(';')
    )
    .join('\n');
}

function tableQualityWorkbook({ identical = false, withUnit = false } = {}) {
  const XLSX = require('xlsx');
  const workbook = XLSX.utils.book_new();
  for (const [sheet, variant] of [
    ['Basis', false],
    ['Variant', !identical],
  ])
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(tableQualityMatrix(variant, withUnit)),
      sheet
    );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function tableQualityScenario(scenario, turn) {
  return scenario('table-quality', 'B.3', 'Export mit Summenzeilen und Variantenblatt', [
    turn(
      'ingest',
      'Bitte die Datei ablegen und beide Blätter auswerten.',
      'Unterscheidbare Blätter und ausgeschlossene Kontrollsummen bestätigen',
      { require: ['Basis', 'Variant', '3.*Summenzeilen', 'Summen stimmen'] },
      { document: { kind: 'table-quality', name: 'Export-A.xlsx' }, dataQuestion: true }
    ),
    turn(
      'compare',
      'Vergleiche die Summen in beiden Blättern.',
      'Datensummen und Differenz aus Abfragen, ohne doppelte Summenzeilen',
      {
        numeric: [
          { value: 40, tolerance: 0.01 },
          { value: 44, tolerance: 0.01 },
          { value: 4, tolerance: 0.01 },
        ],
        require: ['Differenz', 'Basis', 'Variant'],
      },
      { dataQuestion: true }
    ),
    turn(
      'units',
      'Die Einheit in beiden Blättern ist kg.',
      'Einheit gezielt einem Datensatz zuordnen oder nachfragen',
      { require: ['kg|Datensatz|Blatt'] },
      { dataQuestion: true }
    ),
    turn(
      'select',
      'Blatt Basis verwenden.',
      'Blattwahl bestätigen',
      { require: ['Basis'] },
      { dataQuestion: true }
    ),
    turn(
      'unit',
      'Einheit ist kg.',
      'Einheit im ausgewählten Datensatz speichern',
      { require: ['kg'] },
      { dataQuestion: true }
    ),
    turn(
      'sum',
      'Wie hoch ist die Summe?',
      'Bestätigtes Blatt und gespeicherte Einheit nutzen',
      {
        numeric: [{ value: 40, tolerance: 0.01 }],
        require: ['kg'],
        forbid: ['Welche Einheit', 'Einheit ungeklärt'],
      },
      { dataQuestion: true }
    ),
  ]);
}

module.exports = {
  tableQualityMatrix,
  tableQualityText,
  tableQualityWorkbook,
  tableQualityScenario,
};
