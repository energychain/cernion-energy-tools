'use strict';

const { parseMakoEvidence } = require('../src/mako-evidence-parser');

describe('MaKo evidence parser', () => {
  test('extracts APERAK Z18 routing metadata', () => {
    const result = parseMakoEvidence({
      evidenceType: 'aperak_message',
      sourceType: 'willi_mako_ref',
      sourceRef: {
        messageType: 'APERAK',
        relatedMessageType: 'MSCONS',
        errorCode: 'z18',
        segmentRef: 'RFF+Z18',
        ahbVersion: '2024-10',
        maloId: 'DE00123456789',
        williCaseRef: 'willi-case-1',
      },
    });

    expect(result.extracts).toMatchObject({
      messageType: 'APERAK',
      relatedMessageType: 'MSCONS',
      errorCode: 'Z18',
      maloId: 'DE00123456789',
    });
    expect(result.routingSignals).toEqual(
      expect.arrayContaining(['market_communication', 'aperak', 'aperak_z18', 'market_master_data'])
    );
    expect(result.readinessReviewRequired).toBe(true);
  });

  test('extracts CONTRL status without finalizing the case', () => {
    const result = parseMakoEvidence({
      evidenceType: 'contrl_message',
      sourceType: 'manual_metadata',
      metadata: { status: 'accepted', processRef: 'proc-1' },
    });
    expect(result.extracts).toMatchObject({ messageType: 'CONTRL', status: 'accepted' });
    expect(result.routingSignals).toEqual(
      expect.arrayContaining(['market_communication', 'contrl'])
    );
  });

  test('extracts MSCONS and UTILMD hints', () => {
    const mscons = parseMakoEvidence({
      evidenceType: 'mscons_message_status',
      sourceType: 'manual_metadata',
      metadata: { maloId: 'DE001', obis: '1-1:1.29.0', plausibilityStatus: 'plausible' },
    });
    const utilmd = parseMakoEvidence({
      evidenceType: 'utilmd_master_data',
      sourceType: 'manual_metadata',
      metadata: { meloId: 'ME001', validFrom: '2026-01-01', changeReason: 'supplier_start' },
    });
    expect(mscons.routingSignals).toEqual(
      expect.arrayContaining(['market_communication', 'mscons', 'market_master_data'])
    );
    expect(utilmd.routingSignals).toEqual(
      expect.arrayContaining(['market_communication', 'utilmd', 'market_master_data'])
    );
  });

  test('ignores non-MaKo evidence types', () => {
    const result = parseMakoEvidence({
      evidenceType: 'grid_connection_document',
      sourceType: 'manual_metadata',
      metadata: { location: 'Mauer' },
    });
    expect(result).toEqual({ extracts: {}, routingSignals: [], readinessReviewRequired: false });
  });
});
