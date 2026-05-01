'use strict';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(toNumber(value) * factor) / factor;
}

function toTsMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row?.ts) continue;
    const key = new Date(row.ts).toISOString();
    const value = toNumber(row.value);
    map.set(key, toNumber(map.get(key), 0) + value);
  }
  return map;
}

function collectSortedKeys(...maps) {
  const keys = new Set();
  for (const map of maps) {
    for (const key of map.keys()) keys.add(key);
  }
  return [...keys].sort((a, b) => String(a).localeCompare(String(b)));
}

function intervalHours(interval) {
  if (interval === 'hourly' || interval === '1h' || interval === '60min') return 1;
  if (interval === '30min') return 0.5;
  return 0.25;
}

function calculateBalance(feedinData, consumptionData, interval = '15min') {
  const feedinMap = toTsMap(feedinData);
  const consumptionMap = toTsMap(consumptionData);
  const keys = collectSortedKeys(feedinMap, consumptionMap);
  const hours = intervalHours(interval);

  const intervals = [];
  let totalFeedin = 0;
  let totalConsumption = 0;
  let exportHours = 0;
  let importHours = 0;
  let peakExportKw = 0;
  let peakImportKw = 0;
  let selfConsumed = 0;

  for (const ts of keys) {
    const feedin = toNumber(feedinMap.get(ts), 0);
    const consumption = toNumber(consumptionMap.get(ts), 0);
    const balance = feedin - consumption;
    const direction = balance >= 0 ? 'export' : 'import';

    totalFeedin += feedin;
    totalConsumption += consumption;
    selfConsumed += Math.min(feedin, consumption);

    if (balance > 0) {
      exportHours += hours;
      peakExportKw = Math.max(peakExportKw, balance / hours);
    } else if (balance < 0) {
      importHours += hours;
      peakImportKw = Math.max(peakImportKw, Math.abs(balance) / hours);
    }

    intervals.push({
      ts,
      feedin_kwh: round(feedin),
      consumption_kwh: round(consumption),
      balance_kwh: round(balance),
      direction,
    });
  }

  const netBalance = totalFeedin - totalConsumption;

  return {
    intervals,
    summary: {
      totalFeedin_kwh: round(totalFeedin),
      totalConsumption_kwh: round(totalConsumption),
      netBalance_kwh: round(netBalance),
      exportHours: round(exportHours, 2),
      importHours: round(importHours, 2),
      peakExport_kw: round(peakExportKw, 2),
      peakImport_kw: round(peakImportKw, 2),
      selfConsumptionRate: round(totalFeedin > 0 ? selfConsumed / totalFeedin : 0, 4),
      autarkyRate: round(totalConsumption > 0 ? selfConsumed / totalConsumption : 0, 4),
    },
  };
}

function calculateVirtualBkBalance(participants, interval = '15min') {
  const producers = [];
  const consumers = [];

  for (const participant of participants || []) {
    const role = participant.role;
    if (role === 'producer') {
      producers.push({ ...participant, map: toTsMap(participant.data || []) });
    } else if (role === 'consumer') {
      consumers.push({ ...participant, map: toTsMap(participant.data || []) });
    } else if (role === 'prosumer') {
      producers.push({ ...participant, map: toTsMap(participant.feedinData || participant.data || []) });
      consumers.push({ ...participant, map: toTsMap(participant.consumptionData || participant.data || []) });
    }
  }

  const allMaps = [
    ...producers.map((item) => item.map),
    ...consumers.map((item) => item.map),
  ];
  const keys = collectSortedKeys(...allMaps);
  const _hours = intervalHours(interval);

  const intervals = [];
  let totalShared = 0;
  let totalResidual = 0;
  let totalConsumption = 0;

  for (const ts of keys) {
    const totalProduction = producers.reduce((sum, producer) => {
      return sum + toNumber(producer.map.get(ts), 0);
    }, 0);

    const totalCons = consumers.reduce((sum, consumer) => {
      return sum + toNumber(consumer.map.get(ts), 0);
    }, 0);

    const sharedEnergy = Math.min(totalProduction, totalCons);
    const residualGrid = Math.max(0, totalCons - sharedEnergy);

    const consumerShareSum = consumers.reduce((sum, consumer) => {
      return sum + toNumber(consumer.share, 1);
    }, 0) || 1;

    const participantRows = [];

    for (const producer of producers) {
      const produced = toNumber(producer.map.get(ts), 0);
      participantRows.push({
        meloId: producer.meloId,
        role: producer.role,
        allocated_kwh: round(produced),
      });
    }

    for (const consumer of consumers) {
      const share = toNumber(consumer.share, 1) / consumerShareSum;
      participantRows.push({
        meloId: consumer.meloId,
        role: consumer.role,
        allocated_kwh: round(sharedEnergy * share),
      });
    }

    totalShared += sharedEnergy;
    totalResidual += residualGrid;
    totalConsumption += totalCons;

    intervals.push({
      ts,
      totalProduction_kwh: round(totalProduction),
      totalConsumption_kwh: round(totalCons),
      sharedEnergy_kwh: round(sharedEnergy),
      residualGrid_kwh: round(residualGrid),
      participants: participantRows,
    });
  }

  return {
    intervals,
    summary: {
      totalShared_kwh: round(totalShared),
      totalResidual_kwh: round(totalResidual),
      sharingQuote: round(totalConsumption > 0 ? totalShared / totalConsumption : 0, 4),
      participantCount: (participants || []).length,
      producerCount: producers.length,
      consumerCount: consumers.length,
    },
  };
}

function calculateSettlementReadiness(bkData, bilanzkreis = {}) {
  const participants = Array.isArray(bkData?.participants) ? bkData.participants : [];
  const issues = [];

  for (const participant of participants) {
    if (!participant.hasData) {
      issues.push(`missing_data:${participant.meloId}`);
    }
    if (toNumber(participant.dataQuality, 0) < 0.95) {
      issues.push(`low_data_quality:${participant.meloId}`);
    }
    if (toNumber(participant.gapHours, 0) > 1) {
      issues.push(`large_gaps:${participant.meloId}`);
    }
    if (participant.msconsComplete === false) {
      issues.push(`mscons_incomplete:${participant.meloId}`);
    }
  }

  const dataQuality = participants.length
    ? participants.reduce((sum, participant) => sum + toNumber(participant.dataQuality, 0), 0) / participants.length
    : 0;

  const result = {
    ready: issues.length === 0,
    issues,
    dataQuality: round(dataQuality, 4),
  };

  // §42c-spezifische KPIs — nur für Energieteilen-Bilanzkreise
  const isEnergySharing = typeof bilanzkreis?.type === 'string' &&
    bilanzkreis.type.includes('energy_sharing');
  if (isEnergySharing) {
    const hasMissingData = issues.some((i) => i.startsWith('missing_data'));
    const hasQualityIssue = issues.some(
      (i) => i.startsWith('low_data_quality') || i.startsWith('mscons_incomplete')
    );
    result.PARAGRAF_42C_KONFORM = !hasMissingData;
    result.A96_FAEHIG = !hasMissingData && !hasQualityIssue;
  }

  return result;
}

module.exports = {
  calculateBalance,
  calculateVirtualBkBalance,
  calculateSettlementReadiness,
};
