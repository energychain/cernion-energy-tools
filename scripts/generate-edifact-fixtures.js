'use strict';

// All identifiers, parties, values and dates are invented. Never import customer data.
function syntheticMessage(
  index,
  { mismatch = false, negative = false, type = 'INVOIC', badCount = false, padding = 0 } = {}
) {
  const ref = `SYN${index}`;
  const cents = negative ? -2500 : 120000 + index * 1000;
  const net = cents + (mismatch ? 700 : 0);
  const amount = (value) => (value / 100).toFixed(2);
  const body = [
    `UNH+${ref}+${type}:D:04B:UN:SYNTHETIC`,
    `BGM+380+SYN-INV-${String(index).padStart(3, '0')}+9`,
    'DTM+137:20250115:102',
    'DTM+163:20250101:102',
    'DTM+164:20250131:102',
    'NAD+MS+SYNTHETIC-SENDER::ZZZ',
    'NAD+MR+SYNTHETIC-RECEIVER::ZZZ',
    'LOC+172+SYNTHETIC-LOCATION',
    'CUX+2:EUR:4',
  ];
  if (type === 'INVOIC')
    body.push(
      'LIN+1',
      `MOA+203:${amount(cents)}`,
      'UNS+S',
      `MOA+79:${amount(net)}`,
      'MOA+124:0.00',
      `MOA+77:${amount(net)}`
    );
  if (type === 'MSCONS')
    body.push(
      'CCI+11++Z06',
      'QTY+220:4.25:KWH',
      'DTM+163:202501010000:303',
      'DTM+164:202501010015:303',
      'STS+7++67'
    );
  if (type === 'UTILMD') body.push(`IDE+24+SYNTHETIC-PROCESS-${index}`, 'STS+7++SYNTHETIC-STATUS');
  if (type === 'APERAK') body.push('ERC+SYNTHETIC-UNKNOWN');
  for (let i = 0; i < padding; i++) body.push('FTX+AAI+++SYNTHETIC-PADDING-ONLY');
  body.push(`UNT+${body.length + 1 + (badCount ? 1 : 0)}+${ref}`);
  return body.join("'") + "'";
}
function generateEdifactFixture(options = {}) {
  const count = options.count || 3;
  return (
    "UNA:+.? 'UNB+UNOC:3+SYNTHETIC-SENDER+SYNTHETIC-RECEIVER+250115:1200+SYNTHETIC-INTERCHANGE'" +
    Array.from({ length: count }, (_, i) =>
      syntheticMessage(i + 1, {
        ...options,
        mismatch: i === 1 && options.anomalies !== false,
        negative: i === 2 && options.anomalies !== false,
      })
    ).join('') +
    `UNZ+${count}+SYNTHETIC-INTERCHANGE'`
  );
}
function generateEscapedFixture(custom = false) {
  return custom
    ? 'UNA*;,! ~UNH;SYN;INVOIC*D*04B*UN~FTX;AAI;;;a!;b!*c!~d!!e~'
    : "UNH+SYN+INVOIC:D:04B:UN'FTX+AAI+++a?+b?:c?'d??e'";
}
function generateRoutingCatalogFixture(conversationId) {
  return [
    {
      id: 'synthetic-message',
      sourceName: 'Synthetic.edi',
      current: true,
      structuredFormat: 'edifact',
      structured: { conversations: ['message-chat'] },
      provenance: { conversationId: 'message-chat' },
    },
    {
      id: 'synthetic-table',
      sourceName: 'Synthetic.csv',
      current: true,
      provenance: { conversationId },
    },
  ];
}
if (require.main === module) process.stdout.write(generateEdifactFixture());
module.exports = {
  generateEdifactFixture,
  syntheticMessage,
  generateEscapedFixture,
  generateRoutingCatalogFixture,
};
