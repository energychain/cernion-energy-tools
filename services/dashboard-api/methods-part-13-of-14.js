'use strict';

// dashboard-api methods chunk 13/14 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: resolveMunicipalVnbdigitalOperator, attachMunicipalGridOperator, buildMunicipalEnergyValueAnalysisStatus, buildSmgwConnectorReadinessStatus, buildVnbSpecialTopicWorkstateStatus, buildMonitoringNonEscalationStatus, buildLeadershipDeltaCockpitStatus, buildZaehlparkFinanzierungSzenarioCockpitStatus, buildTechCommercialOfferCockpitStatus, normalizeConfidenceScore, requiresOperatorConfirmation, extractRagEvidenceItems, buildEvidenceSourceClassBreakdown, buildEvidenceGroundingMissingEvidence, deriveEvidenceGroundingAnswerStatus, deriveEvidenceConfidenceScore

const {
  resolveMunicipalityProfile,
  estimateMunicipalAnnualLoad,
  deriveTechnologyCorrelation,
  buildIntermunicipalComparison,
} = require('./shared');

// resolveMunicipalVnbdigitalOperator chains two sequential external
// vnbdigital MCP calls with no local processing between them, so a slow or
// hanging upstream response previously blocked the whole
// municipal-energy-value-analysis endpoint for as long as the underlying MCP
// SDK transport allowed (up to 120s per attempt, more with retries) —
// reported live as a full 30-60s HTTP:000 (no response at all, not even
// headers) once the caller's own client/proxy gave up first. Each call is
// bounded so the endpoint degrades gracefully (existing 'missing-evidence'
// shape below) instead of hanging.
const VNBDIGITAL_CALL_TIMEOUT_MS = 12000;

module.exports = {
  async resolveMunicipalVnbdigitalOperator(ctx, analysis = {}) {
    if (
      !analysis?.ags ||
      !analysis?.municipality ||
      analysis.status === 'lagebild_municipality_unresolved'
    ) {
      return {
        gridOperatorName: null,
        evidenceStatus: 'missing-evidence',
        sourceLabel: 'Gemeinde nicht aufgelöst; VNBdigital-Lookup nicht ausgeführt',
        _errors: [],
      };
    }

    const errors = [];
    const searchTerm = analysis.postalCode || analysis.municipality;
    const search = await this.safeCall(
      ctx,
      'grid-operations.vnbdigitalSearch',
      { searchTerm },
      null,
      errors,
      'grid-operations.vnbdigitalSearch',
      VNBDIGITAL_CALL_TIMEOUT_MS
    );
    const searchResult = this.pickMunicipalVnbdigitalSearchResult(
      this.unwrapVnbdigitalSearchResults(search)
    );
    const lookupParams = this.vnbdigitalLookupParamsForSearchResult(searchResult);
    if (!lookupParams) {
      return {
        gridOperatorName: null,
        evidenceStatus: 'missing-evidence',
        sourceLabel: 'VNBdigital-Suche ohne nutzbaren Gemeinde-/PLZ-Treffer',
        _errors: errors,
      };
    }

    const lookup = await this.safeCall(
      ctx,
      'grid-operations.vnbdigitalLookup',
      lookupParams,
      null,
      errors,
      'grid-operations.vnbdigitalLookup',
      VNBDIGITAL_CALL_TIMEOUT_MS
    );
    const vnb = this.pickMunicipalVnb(this.unwrapVnbdigitalLookupVnbs(lookup));
    if (!vnb?.name) {
      return {
        gridOperatorName: null,
        evidenceStatus: 'missing-evidence',
        sourceLabel: 'VNBdigital-Lookup ohne eindeutigen Netzbetreiber',
        _errors: errors,
      };
    }

    return {
      gridOperatorName: String(vnb.name),
      gridOperatorVnbdigitalId: vnb.vnbdigitalId || vnb.entityId || vnb._id || vnb.id || null,
      gridOperatorProfileUrl: vnb.profileUrl || null,
      gridOperatorBdewCode: vnb.canonicalCodes?.bdewCode || vnb.bdewCode || null,
      gridOperatorBnr: vnb.canonicalCodes?.bnr || vnb.bnr || null,
      gridOperatorMastrId: vnb.canonicalCodes?.mastrId || vnb.mastrId || null,
      gridOperatorVoltageTypes: Array.isArray(vnb.voltageTypes)
        ? vnb.voltageTypes.join(', ')
        : null,
      evidenceStatus: 'available',
      sourceLabel: 'VNBdigital Gemeinde-/PLZ-Lookup',
      _errors: errors,
    };
  },

  attachMunicipalGridOperator(analysis = {}, operator = {}) {
    const gridOperatorName = operator?.gridOperatorName || null;
    const sourceLabel = gridOperatorName
      ? `Zuständiger Netzbetreiber laut ${operator.sourceLabel || 'VNBdigital'}: ${gridOperatorName}`
      : operator?.sourceLabel || 'VNBdigital-Lookup nicht verfügbar';
    const riskRows = (analysis.riskRows || []).map((row) => {
      if (!['ewk_anschlussdauer_risk', 'digitalization_index_risk'].includes(row.riskKey)) {
        return row;
      }
      return {
        ...row,
        gridOperatorName,
        gridOperatorVnbdigitalId: operator?.gridOperatorVnbdigitalId || null,
        sourceLabel: gridOperatorName
          ? `${sourceLabel}; Benchmarkwerte für Anschlussdauer/Digitalisierung noch erforderlich`
          : row.sourceLabel,
        assumptionLabel: gridOperatorName
          ? 'Netzbetreiber ist aufgelöst; offen bleiben belastbare Benchmark- und Falldaten zu Anschlussdauer und Prozessreife.'
          : row.assumptionLabel,
        nextGateLabel: gridOperatorName
          ? `Anschlussdauer und Prozessreife bei ${gridOperatorName} mit aktuellen Fällen belegen.`
          : row.nextGateLabel,
      };
    });
    const sourceRows = [
      ...(analysis.sourceRows || []),
      {
        sourceKey: 'vnbdigital_operator_identity',
        sourceLabel,
        sourceType: 'registry',
        availability: gridOperatorName ? 'public' : 'conditional',
        coverage: 'Gemeinde/PLZ',
        lastUpdated: null,
        evidenceStatus: gridOperatorName ? 'available' : 'missing-evidence',
      },
    ];
    const errors = [...(analysis._errors || []), ...(operator?._errors || [])];
    return {
      ...analysis,
      gridOperatorName,
      gridOperatorVnbdigitalId: operator?.gridOperatorVnbdigitalId || null,
      gridOperatorProfileUrl: operator?.gridOperatorProfileUrl || null,
      gridOperatorBdewCode: operator?.gridOperatorBdewCode || null,
      gridOperatorBnr: operator?.gridOperatorBnr || null,
      gridOperatorMastrId: operator?.gridOperatorMastrId || null,
      gridOperatorVoltageTypes: operator?.gridOperatorVoltageTypes || null,
      gridOperatorEvidenceStatus: operator?.evidenceStatus || 'missing-evidence',
      riskRows,
      sourceRows,
      _errors: [...new Set(errors)],
    };
  },

  buildMunicipalEnergyValueAnalysisStatus(params = {}) {
    const municipalityRaw = String(params.municipality || '').trim();
    const municipalityKey = municipalityRaw.toLowerCase();
    const agsParam = String(params.ags || '').trim();
    const year = Number(params.year) || 2025;
    const scenario = String(params.scenario || 'baseline')
      .trim()
      .toLowerCase();

    const profile = resolveMunicipalityProfile({ municipality: municipalityRaw, ags: agsParam });

    const resolvedName = profile.found ? profile.name : municipalityRaw || 'Unbekannte Gemeinde';
    const resolvedAgs = profile.found ? profile.ags : agsParam || null;
    const isKnown = profile.found;

    const analysisRunId = `municipal-lagebild:${resolvedAgs || municipalityKey}:${year}:${scenario}`;

    const assumedMarketPriceEurPerMwh =
      scenario === 'high-price' ? 110 : scenario === 'low-price' ? 45 : 70;
    const pvFullLoadHours = 1000;
    const biomassFullLoadHours = 7000;
    const windFullLoadHours = 1800;

    let annualLoad = null;
    let correlationResult = null;
    let totalLocalCorrelationEur = null;

    const valueRows = [];
    if (profile.found) {
      if (profile.pvCapacityKw > 0) {
        const genKwh = profile.pvCapacityKw * pvFullLoadHours;
        valueRows.push({
          rowKey: 'pv_generation_value',
          rowLabel: 'Photovoltaik: Erzeugungswert',
          technology: 'pv',
          installedCapacityKw: profile.pvCapacityKw,
          assumedFullLoadHours: pvFullLoadHours,
          estimatedGenerationKwhPerYear: genKwh,
          assumedMarketPriceEurPerMwh,
          grossMarketValueEurPerYear: Math.round((genKwh / 1000) * assumedMarketPriceEurPerMwh),
          localRetentionIndicator: 'bilanziell-szenario',
          evidenceStatus: 'assumption-backed',
          assumptionLabel: `MaStR-Bestand ${year} Annahme; Volllaststunden Standardwert`,
          sourceLabel: 'MaStR / interne Annahme',
        });
      }
      if (profile.biomassCapacityKw > 0) {
        const genKwh = profile.biomassCapacityKw * biomassFullLoadHours;
        valueRows.push({
          rowKey: 'biomass_generation_value',
          rowLabel: 'Biomasse: Erzeugungswert',
          technology: 'biomass',
          installedCapacityKw: profile.biomassCapacityKw,
          assumedFullLoadHours: biomassFullLoadHours,
          estimatedGenerationKwhPerYear: genKwh,
          assumedMarketPriceEurPerMwh,
          grossMarketValueEurPerYear: Math.round((genKwh / 1000) * assumedMarketPriceEurPerMwh),
          localRetentionIndicator: 'bilanziell-szenario',
          evidenceStatus: 'assumption-backed',
          assumptionLabel: `MaStR-Bestand ${year} Annahme; Volllaststunden Standardwert`,
          sourceLabel: 'MaStR / interne Annahme',
        });
      }
      if (profile.windCapacityKw > 0) {
        const genKwh = profile.windCapacityKw * windFullLoadHours;
        valueRows.push({
          rowKey: 'wind_generation_value',
          rowLabel: 'Windenergie: Erzeugungswert',
          technology: 'wind',
          installedCapacityKw: profile.windCapacityKw,
          assumedFullLoadHours: windFullLoadHours,
          estimatedGenerationKwhPerYear: genKwh,
          assumedMarketPriceEurPerMwh,
          grossMarketValueEurPerYear: Math.round((genKwh / 1000) * assumedMarketPriceEurPerMwh),
          localRetentionIndicator: 'bilanziell-szenario',
          evidenceStatus: 'assumption-backed',
          assumptionLabel: `MaStR-Bestand ${year} Annahme; Volllaststunden Standardwert`,
          sourceLabel: 'MaStR / interne Annahme',
        });
      }
      const totalGenKwh = valueRows.reduce(
        (sum, r) => sum + (r.estimatedGenerationKwhPerYear || 0),
        0
      );
      const totalGrossMarketValueEur = valueRows.reduce(
        (sum, r) => sum + (r.grossMarketValueEurPerYear || 0),
        0
      );
      annualLoad = estimateMunicipalAnnualLoad(profile);
      correlationResult = annualLoad
        ? deriveTechnologyCorrelation({ annualLoad, valueRows, assumedMarketPriceEurPerMwh })
        : null;
      totalLocalCorrelationEur = correlationResult
        ? correlationResult.techResults.reduce((sum, r) => sum + r.localCorrelationValueEur, 0)
        : null;

      valueRows.push({
        rowKey: 'local_value_capture_indicator',
        rowLabel: 'Lokale Werterfassung (EUR-Szenario)',
        technology: 'aggregated',
        installedCapacityKw: null,
        assumedFullLoadHours: null,
        estimatedGenerationKwhPerYear: totalGenKwh,
        assumedMarketPriceEurPerMwh: null,
        grossMarketValueEurPerYear: totalGrossMarketValueEur,
        localValueCaptureEur: totalLocalCorrelationEur,
        evidenceStatus: correlationResult ? 'derived-from-assets' : 'missing-evidence',
        assumptionLabel: correlationResult
          ? `Abgeleitete lokale Werterfassung: ${totalLocalCorrelationEur} EUR/a (H0/G0-SLP-Proxy; kein Messwert; nicht autarkie-relevant).`
          : 'Lokales Lastprofil und Zeitreihen-Korrelation fehlen; keine bilanziellen Deckungsaussagen ohne Zeitreihenbasis.',
        sourceLabel: correlationResult
          ? correlationResult.sourceLabel
          : 'Zeitreihen-Korrelation erforderlich',
      });
    } else {
      valueRows.push({
        rowKey: 'generation_value_missing',
        rowLabel: 'Erzeugungsdaten nicht verfügbar',
        technology: 'unknown',
        installedCapacityKw: null,
        assumedFullLoadHours: null,
        estimatedGenerationKwhPerYear: null,
        assumedMarketPriceEurPerMwh: null,
        grossMarketValueEurPerYear: null,
        localValueCaptureEur: null,
        evidenceStatus: 'missing-evidence',
        assumptionLabel: 'Gemeinde nicht im lokalen Profil; MaStR-Abfrage erforderlich',
        sourceLabel: 'keine Quelle verfügbar',
      });
    }

    const riskRows = [
      {
        riskKey: 'ewk_anschlussdauer_risk',
        riskLabel: 'Anschlussdauer beim Netzbetreiber',
        severity:
          isKnown && profile.gridOperatorBdewHint !== 'missing-evidence' ? 'medium' : 'high',
        severityScore: isKnown && profile.gridOperatorBdewHint !== 'missing-evidence' ? 45 : 70,
        valueAtRiskEurPerYear: null,
        economicImpactEurPerYear: null,
        delayRiskDays: isKnown ? 60 : null,
        evidenceStatus:
          isKnown && profile.gridOperatorBdewHint !== 'missing-evidence'
            ? 'assumption-backed'
            : 'missing-evidence',
        sourceLabel:
          'Netzbetreiber-Monitoring; BNr oder MaStR-Netzbetreiber-ID für Benchmark-Abgleich erforderlich',
        assumptionLabel:
          'Schätzung: ohne Benchmark-Kennung bleibt die tatsächliche Anschlussdauer im EWK-Monitoring offen.',
        nextGateLabel:
          'Anschlussdauer des zuständigen Netzbetreibers mit aktuellen Fällen belegen.',
      },
      {
        riskKey: 'digitalization_index_risk',
        riskLabel: 'Digitale Prozessreife des Netzbetreibers',
        severity: 'medium',
        severityScore: 40,
        valueAtRiskEurPerYear: null,
        economicImpactEurPerYear: null,
        delayRiskDays: null,
        evidenceStatus: 'missing-evidence',
        sourceLabel: 'Netzbetreiber-Monitoring; Prozessdaten erforderlich',
        assumptionLabel:
          'Schätzung: ohne Prozessdaten bleibt offen, wie transparent Anschluss- und Fristenprozesse laufen.',
        nextGateLabel: 'Prozessdaten und Ansprechpartner des Netzbetreibers prüfen.',
      },
      {
        riskKey: 'imsys_smgw_rollout_readiness_risk',
        riskLabel: 'Bereitschaft moderner Messsysteme',
        severity: 'medium',
        severityScore: 50,
        valueAtRiskEurPerYear: null,
        economicImpactEurPerYear: null,
        delayRiskDays: null,
        evidenceStatus: 'assumption-backed',
        sourceLabel: 'BNetzA- und Messstellenbetreiber-Daten; lokale Daten fehlen',
        assumptionLabel:
          'Schätzung: verzögerter Smart-Meter-Rollout kann flexible Tarife und steuerbare Anlagen bremsen.',
        nextGateLabel:
          'Rollout-Stand beim Messstellenbetreiber abfragen und auf kommunale Projekte beziehen.',
      },
      {
        riskKey: 'grid_capacity_constraint_risk',
        riskLabel: 'Netzkapazität für neue Projekte',
        severity: isKnown ? 'low' : 'medium',
        severityScore: isKnown ? 20 : 50,
        valueAtRiskEurPerYear: null,
        economicImpactEurPerYear: null,
        delayRiskDays: null,
        evidenceStatus: 'missing-evidence',
        sourceLabel: 'Netzkapazitätsanzeige oder konkrete Anschlussanfrage fehlt',
        assumptionLabel:
          'Ohne Kapazitätsauskunft bleibt offen, ob neue Projekte wirtschaftlich rechtzeitig ans Netz kommen.',
        nextGateLabel: 'Für priorisierte Flächen eine Anschluss- und Kapazitätsprüfung starten.',
      },
    ];

    const budgetImpactRows = [];
    if (profile.found && profile.population) {
      const totalHouseholds = Math.round(profile.population * profile.avgHouseholdsPerEinwohner);
      const residentialConsumptionKwh = totalHouseholds * profile.avgHouseholdConsumptionKwh;
      const kavRateNsCtPerKwh =
        profile.kavRateNsCtPerKwh != null
          ? profile.kavRateNsCtPerKwh
          : profile.konzessionsabgabeKategorie.includes('100.000')
            ? 1.99
            : 1.32;
      const kavSonderkundenCtPerKwh = 0.11;
      const kavNsEurPerYear = Math.round((residentialConsumptionKwh * kavRateNsCtPerKwh) / 100);
      const commercialConsumptionKwh =
        annualLoad?.commercialKwh != null
          ? Math.round(Number(annualLoad.commercialKwh) || 0)
          : Math.round(residentialConsumptionKwh * 0.35);
      const kavGewerbeEurPerYear = Math.round(
        (commercialConsumptionKwh * kavSonderkundenCtPerKwh) / 100
      );
      const kavNsLowEurPerYear = Math.round(kavNsEurPerYear * 0.95);
      const kavNsHighEurPerYear = kavNsEurPerYear;
      const kavGewerbeLowEurPerYear = Math.round(kavGewerbeEurPerYear * 0.5);
      const kavGewerbeHighEurPerYear = Math.round(kavGewerbeEurPerYear * 2);
      const kavTotalEurPerYear = kavNsEurPerYear + kavGewerbeEurPerYear;
      const kavTotalLowEurPerYear = kavNsLowEurPerYear + kavGewerbeLowEurPerYear;
      const kavTotalHighEurPerYear = kavNsHighEurPerYear + kavGewerbeHighEurPerYear;
      const kavReferenceMwhPerYear = Math.round(
        (residentialConsumptionKwh + commercialConsumptionKwh) / 1000
      );
      budgetImpactRows.push(
        {
          rowKey: 'konzessionsabgabe_ns_haushalt',
          rowLabel: 'Konzessionsabgabe private Haushalte (Schätzung)',
          budgetCategory: 'konzessionsabgabe',
          segment: 'NS-Haushalt',
          estimatedEurPerYear: kavNsEurPerYear,
          estimatedLowEurPerYear: kavNsLowEurPerYear,
          estimatedHighEurPerYear: kavNsHighEurPerYear,
          assumedKavCtPerKwh: kavRateNsCtPerKwh,
          assumedConsumptionMwhPerYear: Math.round(residentialConsumptionKwh / 1000),
          calculationStatus: 'assumption-scenario',
          assumptionStatus: `KAV-Kategorie: ${profile.konzessionsabgabeKategorie}; ${kavRateNsCtPerKwh} ct/kWh`,
          evidenceStatus: 'assumption-backed',
          assumptionLabel: `Einwohner ${profile.population}; ${totalHouseholds} Haushalte; ${profile.avgHouseholdConsumptionKwh} kWh/HH angenommen`,
          sourceLabel: 'KAV 1992 / interne Annahme; Schätzung, keine Schlussrechnung',
        },
        {
          rowKey: 'konzessionsabgabe_ns_gewerbe',
          rowLabel: 'Konzessionsabgabe Gewerbe (Schätzung)',
          budgetCategory: 'konzessionsabgabe',
          segment: 'NS-Gewerbe',
          estimatedEurPerYear: kavGewerbeEurPerYear,
          estimatedLowEurPerYear: kavGewerbeLowEurPerYear,
          estimatedHighEurPerYear: kavGewerbeHighEurPerYear,
          assumedKavCtPerKwh: kavSonderkundenCtPerKwh,
          assumedConsumptionMwhPerYear: Math.round(commercialConsumptionKwh / 1000),
          calculationStatus: 'assumption-scenario',
          assumptionStatus: `${kavSonderkundenCtPerKwh} ct/kWh Sonderkunden-Proxy; Gewerbestruktur unbekannt`,
          evidenceStatus: 'assumption-backed',
          assumptionLabel: annualLoad?.sectorModelLabel
            ? `${annualLoad.sectorModelLabel}; niedrigerer Sonderkunden-Satz statt pauschalem Aufschlag.`
            : 'Gewerbeverbrauch als Strukturproxy des Haushaltsverbrauchs geschätzt; niedrigerer Sonderkunden-Satz statt pauschalem Aufschlag.',
          sourceLabel: 'KAV / interne Annahme / Sektor-Strukturproxy',
        },
        {
          rowKey: 'konzessionsabgabe_total_estimate',
          rowLabel: 'Konzessionsabgabe gesamt (Jahresspanne)',
          budgetCategory: 'konzessionsabgabe',
          segment: 'NS-gesamt',
          estimatedEurPerYear: kavTotalEurPerYear,
          estimatedLowEurPerYear: kavTotalLowEurPerYear,
          estimatedHighEurPerYear: kavTotalHighEurPerYear,
          assumedKavCtPerKwh: kavRateNsCtPerKwh,
          assumedSpecialCustomerKavCtPerKwh: kavSonderkundenCtPerKwh,
          assumedConsumptionMwhPerYear: kavReferenceMwhPerYear,
          estimatedKavEurPerMwh: Number((kavTotalEurPerYear / kavReferenceMwhPerYear).toFixed(2)),
          calculationStatus: 'assumption-scenario',
          assumptionStatus: `Plausibilisiert gegen KAV-Sätze: ${kavRateNsCtPerKwh} ct/kWh Tarifkunden, ${kavSonderkundenCtPerKwh} ct/kWh Sonderkunden-Proxy`,
          evidenceStatus: 'scenario-based',
          assumptionLabel:
            'Konzessionsabgabe ist eine kommunale Einnahme des Konzessionsgebers; ' +
            'diese Zeile ist eine KAV-gedeckelte Schätzung, keine Schlussrechnung für den Haushalt.',
          sourceLabel: 'KAV / interne Szenario-Berechnung',
        }
      );
    } else {
      budgetImpactRows.push({
        rowKey: 'budget_impact_missing',
        rowLabel: 'Haushaltswirkung nicht berechenbar',
        budgetCategory: 'konzessionsabgabe',
        segment: 'unbekannt',
        estimatedEurPerYear: null,
        calculationStatus: 'missing-data',
        assumptionStatus: 'Gemeindeprofil nicht aufgelöst',
        evidenceStatus: 'missing-evidence',
        assumptionLabel:
          'Gemeinde nicht im lokalen Profil; Einwohnerzahl und KAV-Kategorie erforderlich',
        sourceLabel: 'keine Quelle verfügbar',
      });
    }

    const assumptionRows = [
      {
        assumptionKey: 'market_price_eur_per_mwh',
        assumptionLabel: 'Marktpreis Strom (Day-Ahead Szenario)',
        assumptionValue: String(assumedMarketPriceEurPerMwh),
        assumptionUnit: 'EUR/MWh',
        category: 'marktpreis',
        source: `ENTSO-E Day-Ahead Szenario ${scenario}`,
        evidenceStatus: 'assumption-backed',
      },
      {
        assumptionKey: 'pv_full_load_hours',
        assumptionLabel: 'PV Volllaststunden',
        assumptionValue: String(pvFullLoadHours),
        assumptionUnit: 'h/a',
        category: 'erzeugung',
        source: 'DWD / Branchenwert Süddeutschland',
        evidenceStatus: 'assumption-backed',
      },
      {
        assumptionKey: 'biomass_full_load_hours',
        assumptionLabel: 'Biomasse Volllaststunden',
        assumptionValue: String(biomassFullLoadHours),
        assumptionUnit: 'h/a',
        category: 'erzeugung',
        source: 'Branchenwert / DBFZ',
        evidenceStatus: 'assumption-backed',
      },
      {
        assumptionKey: 'local_value_capture_basis',
        assumptionLabel: 'Lokale Werterfassung - Datenbasis',
        assumptionValue: 'Lastprofil fehlt; Zeitreihen-Korrelation nicht möglich',
        assumptionUnit: 'Evidenzstatus',
        category: 'versorgung',
        source: 'Zeitreihen-Korrelation erforderlich',
        evidenceStatus: 'missing-evidence',
      },
      {
        assumptionKey: 'kav_category',
        assumptionLabel: 'KAV Gemeindekategorie',
        assumptionValue: profile.found ? profile.konzessionsabgabeKategorie : 'unbekannt',
        assumptionUnit: 'Kategorie',
        category: 'konzessionsabgabe',
        source: 'KAV 1992 § 2 Abs. 2',
        evidenceStatus: profile.found ? 'assumption-backed' : 'missing-evidence',
      },
    ];

    const sourceRows = [
      {
        sourceKey: 'mastr',
        sourceLabel: 'Marktstammdatenregister (MaStR)',
        sourceType: 'register',
        availability: 'public',
        coverage: 'deutschland-weit',
        lastUpdated: null,
        evidenceStatus: isKnown ? 'assumption-backed' : 'missing-evidence',
      },
      {
        sourceKey: 'ewk_monitoring',
        sourceLabel: 'Anschlussdauer-Monitoring beim Netzbetreiber',
        sourceType: 'regulatory',
        availability: 'conditional',
        coverage: 'je Netzbetreiber',
        lastUpdated: null,
        evidenceStatus: 'missing-evidence',
      },
      {
        sourceKey: 'vnb_digital',
        sourceLabel: 'vnb-digital / VNB-Digitalisierungsindex',
        sourceType: 'market-data',
        availability: 'conditional',
        coverage: 'je Netzbetreiber',
        lastUpdated: null,
        evidenceStatus: 'missing-evidence',
      },
      {
        sourceKey: 'kav_1992',
        sourceLabel: 'Konzessionsabgabenverordnung (KAV 1992)',
        sourceType: 'legal',
        availability: 'public',
        coverage: 'deutschland-weit',
        lastUpdated: '1992-01-01',
        evidenceStatus: 'available',
      },
      {
        sourceKey: 'entsoe_market',
        sourceLabel: 'ENTSO-E Day-Ahead Marktdaten',
        sourceType: 'market-data',
        availability: 'public',
        coverage: 'DE/AT/LU',
        lastUpdated: null,
        evidenceStatus: 'assumption-backed',
      },
      {
        sourceKey: 'bnetza_fca_storage_flex',
        sourceLabel:
          'Bundesnetzagentur: Flexible Netzanschlussvereinbarungen für Speicher und Verbrauchsanlagen',
        sourceType: 'regulatory',
        availability: 'public',
        coverage: 'deutschland-weit',
        lastUpdated: '2026-06-19',
        evidenceStatus: 'available',
      },
      {
        sourceKey: 'enwg_42c_energy_sharing',
        sourceLabel: 'EnWG §42c: gemeinsame Nutzung elektrischer Energie aus EE-Anlagen',
        sourceType: 'legal',
        availability: 'public',
        coverage: 'deutschland-weit',
        lastUpdated: '2026-06-01',
        evidenceStatus: 'available',
      },
    ];

    const totalGrossMarketValueEur = valueRows.reduce(
      (sum, r) => sum + (r.grossMarketValueEurPerYear || 0),
      0
    );

    const buildTsRow = (tech, rowKey, capacityKw, fullLoadHours, techLabel) => {
      const marketValueEur = Math.round(
        ((capacityKw * fullLoadHours) / 1000) * assumedMarketPriceEurPerMwh
      );
      const corrTech = correlationResult
        ? correlationResult.techResults.find((r) => r.technology === tech)
        : null;
      if (corrTech) {
        return {
          rowKey,
          technology: tech,
          timeWindow: `annual_${year}`,
          marketValueEur,
          localCorrelationValueEur: corrTech.localCorrelationValueEur,
          unmatchedGenerationValueEur: corrTech.unmatchedGenerationValueEur,
          importExposureEur: null,
          coincidenceFactor: corrTech.coincidenceFactor,
          confidence: 'low',
          evidenceStatus: 'derived-from-assets',
          sourceLabel: `${techLabel}: abgeleitete Zeitkorrelation via H0/G0-SLP-Proxy; kein Messwert`,
        };
      }
      return {
        rowKey,
        technology: tech,
        timeWindow: `annual_${year}`,
        marketValueEur,
        localCorrelationValueEur: null,
        unmatchedGenerationValueEur: marketValueEur,
        importExposureEur: null,
        confidence: 'low',
        evidenceStatus: 'missing-evidence',
        sourceLabel: 'Kein lokales Lastprofil; Zeitkorrelation nicht möglich',
      };
    };

    const timeSeriesValueRows = profile.found
      ? [
          ...(profile.pvCapacityKw > 0
            ? [buildTsRow('pv', 'ts_pv_annual', profile.pvCapacityKw, pvFullLoadHours, 'PV')]
            : []),
          ...(profile.biomassCapacityKw > 0
            ? [
                buildTsRow(
                  'biomass',
                  'ts_biomass_annual',
                  profile.biomassCapacityKw,
                  biomassFullLoadHours,
                  'Biomasse'
                ),
              ]
            : []),
          ...(profile.windCapacityKw > 0
            ? [
                buildTsRow(
                  'wind',
                  'ts_wind_annual',
                  profile.windCapacityKw,
                  windFullLoadHours,
                  'Wind'
                ),
              ]
            : []),
        ]
      : [
          {
            rowKey: 'ts_no_data',
            technology: 'unknown',
            timeWindow: `annual_${year}`,
            marketValueEur: null,
            localCorrelationValueEur: null,
            unmatchedGenerationValueEur: null,
            importExposureEur: null,
            confidence: 'none',
            evidenceStatus: 'missing-evidence',
            sourceLabel: 'Gemeindeprofil nicht aufgelöst',
          },
        ];

    const existingStoragePowerKw = Number(profile.storagePowerKw) || 0;
    const existingStorageCapacityKWh =
      profile.storageCapacityKWh != null && !Number.isNaN(Number(profile.storageCapacityKWh))
        ? Number(profile.storageCapacityKWh)
        : null;
    const unmatchedGenerationValueEur = timeSeriesValueRows.reduce(
      (sum, row) => sum + (Number(row.unmatchedGenerationValueEur) || 0),
      0
    );
    const pvUnmatchedValueEur = timeSeriesValueRows
      .filter((row) => row.technology === 'pv')
      .reduce((sum, row) => sum + (Number(row.unmatchedGenerationValueEur) || 0), 0);
    const flexReferenceValueEur =
      pvUnmatchedValueEur > 0 ? pvUnmatchedValueEur : unmatchedGenerationValueEur;
    const buildFlexScenario = (rowKey, rowLabel, captureShare, planningLever, nextGateLabel) => ({
      rowKey,
      rowLabel,
      scenarioType: 'storage_flex_fnav',
      existingStoragePowerKw,
      existingStorageCapacityKWh,
      storageEvidenceStatus: existingStoragePowerKw > 0 ? 'assumption-backed' : 'missing-evidence',
      referenceUnmatchedValueEur: flexReferenceValueEur || null,
      captureShare,
      potentialLocalRetentionEurPerYear:
        flexReferenceValueEur > 0 ? Math.round(flexReferenceValueEur * captureShare) : null,
      planningLever,
      evidenceStatus: flexReferenceValueEur > 0 ? 'scenario-based' : 'missing-evidence',
      assumptionLabel:
        'Szenario: Speicher, Lastverschiebung oder fNAV-Fahrweise können einen Teil des nicht zeitgleichen Erzeugungswerts lokal nutzbar machen; kein Dispatch- oder Netzanschlussnachweis.',
      sourceLabel:
        'BNetzA FCA/Flexible Netzanschlussvereinbarungen; abgeleitete Cernion-Zeitgleichkeitswerte; Speicherbestand nur bei belegtem Profilfeld.',
      nextGateLabel,
    });
    const flexibilityScenarioRows = profile.found
      ? [
          {
            rowKey: 'existing_storage_context',
            rowLabel:
              existingStoragePowerKw > 0
                ? 'Bestehender Speicherbestand'
                : 'Speicherbestand noch nicht belegt',
            scenarioType: 'storage_inventory',
            existingStoragePowerKw,
            existingStorageCapacityKWh,
            storageEvidenceStatus:
              existingStoragePowerKw > 0 ? 'assumption-backed' : 'missing-evidence',
            referenceUnmatchedValueEur: flexReferenceValueEur || null,
            captureShare: null,
            potentialLocalRetentionEurPerYear: null,
            planningLever:
              existingStoragePowerKw > 0
                ? 'Bestehenden Speicher in Flex-/fNAV-Prüfung und lokale Wertbindung einbeziehen.'
                : 'Speicherbestand per MaStR/Netzbetreiber prüfen, bevor ein Bestandsnutzen behauptet wird.',
            evidenceStatus: existingStoragePowerKw > 0 ? 'assumption-backed' : 'missing-evidence',
            assumptionLabel:
              existingStoragePowerKw > 0
                ? 'Speicherbestand aus kommunalem Profil belegt; Dispatch und Netzfahrweise noch offen.'
                : 'Kein Speicherbestand im kommunalen Profil belegt; öffentliche Live-Abfrage muss nachgeführt werden.',
            sourceLabel:
              existingStoragePowerKw > 0
                ? 'Kommunales Energieprofil / MaStR-nahe Overlaydaten'
                : 'Kein belegter Speicherbestand im aktuellen Profil',
            nextGateLabel:
              'Speicher-MaStR, Netzanschlusspunkt, Betreiberstruktur und Steuerbarkeit belegen.',
          },
          buildFlexScenario(
            'storage_flex_conservative',
            'Konservativ: Speicher/Flex als lokaler Puffer',
            0.15,
            'Kommunales Speicher- oder Lastverschiebungsprogramm zunächst auf Flächen mit hoher PV-Nähe prüfen.',
            'Bestands- und Projektliste Speicher, Wallboxen, Wärmepumpen und Gewerbelasten mit Netzbetreiber abstimmen.'
          ),
          buildFlexScenario(
            'storage_flex_balanced',
            'Planungspfad: fNAV und Speicher gemeinsam prüfen',
            0.3,
            'fNAV-Fenster, Speicherfahrplan und steuerbare Lasten als Paket für schneller anschlussfähige Projekte prüfen.',
            'Beim Netzbetreiber statische oder dynamische Leistungsfenster, Mess-/Steuerbarkeit und BKZ-Wirkung anfragen.'
          ),
          buildFlexScenario(
            'storage_flex_ambitious',
            'Ambitioniert: kommunale Flexibilitätszone',
            0.45,
            'Gemeinderat kann Förderung, Flächenpriorisierung oder beschleunigte bauliche Prüfung für netzdienliche Speicher vorbereiten.',
            'Vor politischer Zusage: Baurecht, Brandschutz, Netzverträglichkeit, Betreiber- und Erlösmodell getrennt prüfen.'
          ),
        ]
      : [];

    const totalLocalCorrelationValueEur = timeSeriesValueRows.reduce(
      (sum, row) => sum + (Number(row.localCorrelationValueEur) || 0),
      0
    );
    const energySharingAddressableValueEur =
      unmatchedGenerationValueEur > 0 ? unmatchedGenerationValueEur : totalGrossMarketValueEur;
    const buildEnergySharingScenario = (
      rowKey,
      rowLabel,
      scenarioType,
      captureShare,
      communityModel,
      municipalUseCase,
      nextGateLabel
    ) => ({
      rowKey,
      rowLabel,
      scenarioType,
      legalBasis: 'EnWG §42c',
      eligibilityWindow:
        'seit 01.06.2026 im VNB-Bilanzierungsgebiet möglich; ab 01.06.2028 auch direkt angrenzende VNB-Bilanzierungsgebiete derselben Regelzone',
      communityModel,
      municipalUseCase,
      referenceUnmatchedValueEur: energySharingAddressableValueEur || null,
      currentLocalCorrelationValueEur: totalLocalCorrelationValueEur || null,
      captureShare,
      potentialLocalCirculationEurPerYear:
        energySharingAddressableValueEur > 0
          ? Math.round(energySharingAddressableValueEur * captureShare)
          : null,
      evidenceStatus: energySharingAddressableValueEur > 0 ? 'scenario-based' : 'missing-evidence',
      assumptionLabel:
        'Szenario: Energy Sharing kann zeitgleich erzeugten oder aus EE zwischengespeicherten Strom zwischen getrennten Verbrauchsstellen vertraglich nutzbar machen; kein Liefer-, Tarif- oder Abrechnungsnachweis.',
      sourceLabel:
        'EnWG §42c; abgeleitete Cernion-Zeitgleichkeitswerte; kommunale Liegenschafts- und Teilnehmerdaten noch zu belegen.',
      nextGateLabel,
    });
    const energySharingCommunityRows = profile.found
      ? [
          {
            rowKey: 'energy_sharing_42c_context',
            rowLabel: 'Was Energy Sharing nach §42c bedeutet',
            scenarioType: 'legal_context',
            legalBasis: 'EnWG §42c',
            eligibilityWindow:
              'seit 01.06.2026 im VNB-Bilanzierungsgebiet möglich; ab 01.06.2028 auch direkt angrenzende VNB-Bilanzierungsgebiete derselben Regelzone',
            communityModel:
              'Betreiber und Abnehmer teilen EE-Strom über das öffentliche Verteilnetz; Reststrom bleibt separat zu beschaffen.',
            municipalUseCase:
              'PV am Bauhof, Schule, Rathaus und weitere Liegenschaften können in einem gemeinsamen Nutzungsmodell geprüft werden.',
            referenceUnmatchedValueEur: energySharingAddressableValueEur || null,
            currentLocalCorrelationValueEur: totalLocalCorrelationValueEur || null,
            captureShare: null,
            potentialLocalCirculationEurPerYear: null,
            evidenceStatus: 'available',
            assumptionLabel:
              'Aufklärungszeile: gemeinsame Nutzung braucht Liefervertrag, Vertrag zur gemeinsamen Nutzung, Aufteilungsschlüssel, 15-Minuten-Messung/RLM und Reststromregelung.',
            sourceLabel: 'Gesetze im Internet: EnWG §42c',
            nextGateLabel:
              'Liegenschaften, Betreiber, Messkonzept, Reststromlieferant und Bilanzierungsgebiet zu einem Pilot-Setup verdichten.',
          },
          buildEnergySharingScenario(
            'energy_sharing_municipal_estates',
            'Kommunale Liegenschaften zuerst',
            'municipal_estate_community',
            0.25,
            'Kommunale oder kommunal getragene Betreiberstruktur; Abnehmer sind kommunale Liegenschaften.',
            'PV am Bauhof oder auf der Kläranlage wird rechnerisch mit Schule, Rathaus, Sporthalle oder Wasserwerk gekoppelt.',
            'Liegenschaftsliste mit MaLo/Messkonzept, Lastprofil und Reststromvertrag vorbereiten.'
          ),
          buildEnergySharingScenario(
            'energy_sharing_mixed_community',
            'Gemischte Community',
            'mixed_public_private_community',
            0.4,
            'Private und gewerbliche EE-Betreiber plus kommunale Liegenschaften; KMU-Fähigkeit und Teilnehmerkreis prüfen.',
            'Kommunale Nachfrage wird Ankerabnehmer, private und gewerbliche Anlagen bringen zusätzliche lokale Erzeugung ein.',
            'Teilnehmerkreis, Betreiberform, Liefer-/Nutzungsverträge und Abrechnungspartner rechtlich und energiewirtschaftlich prüfen.'
          ),
          buildEnergySharingScenario(
            'energy_sharing_storage_enabled',
            'Energy Sharing mit Speicher und Flexibilität',
            'storage_enabled_community',
            0.55,
            'Community nutzt Speicher und steuerbare Lasten nur, wenn gespeicherte Energie aus erneuerbaren Energien stammt und §42c-/EEG-Anforderungen erfüllt sind.',
            'Speicher verschiebt PV-Mittagsspitzen in Verbrauchsfenster kommunaler Gebäude und stabilisiert die lokale Wertbindung.',
            'Speicherherkunft, Messung, Steuerbarkeit, fNAV/FCA-Fenster und Abrechnungslogik gemeinsam nachweisen.'
          ),
        ]
      : [];

    const totalBudgetRow = budgetImpactRows.find((r) => String(r.rowKey || '').includes('total'));
    const budgetTotalEur =
      totalBudgetRow?.estimatedEurPerYear != null
        ? Number(totalBudgetRow.estimatedEurPerYear) || 0
        : budgetImpactRows.reduce((sum, r) => sum + (r.estimatedEurPerYear || 0), 0);
    const euroKpiRows = [
      {
        rowKey: 'euro_kpi_gross_market_value',
        label: 'Brutto-Marktwert lokaler Erzeugung',
        valueEur: totalGrossMarketValueEur || null,
        description: `Marktpreis-gewichteter Jahreswert aller lokalen Erzeugungstechnologien; Szenario ${scenario}; keine physische Lieferzusage.`,
        evidenceStatus: totalGrossMarketValueEur > 0 ? 'assumption-backed' : 'missing-evidence',
      },
      {
        rowKey: 'euro_kpi_local_value_capture',
        label: 'Lokale Werterfassung (Zeitreihen-Korrelation)',
        valueEur: totalLocalCorrelationEur,
        description: correlationResult
          ? `Abgeleitete lokale Werterfassung auf Basis H0/G0-SLP-Proxy (Koinzidenzfaktor je Technologie); kein Messwert; ${correlationResult.evidenceStatus}. Keine Autarkie-Aussage.`
          : 'Erfordert Zeitreihen-Korrelation von Erzeugung und lokalem Verbrauch. Ohne Lastprofil keine belastbare Aussage zur lokalen Wertbindung.',
        evidenceStatus: correlationResult ? 'derived-from-assets' : 'missing-evidence',
      },
      {
        rowKey: 'euro_kpi_municipal_budget_effect',
        label: 'Kommunaler Haushaltseffekt (Szenario)',
        valueEur: budgetTotalEur > 0 ? budgetTotalEur : null,
        description:
          'Konzessionsabgabe und Szenario-Budgeteffekte als Schätzung; noch nicht haushalterisch geprüft.',
        evidenceStatus: budgetTotalEur > 0 ? 'assumption-backed' : 'missing-evidence',
      },
      {
        rowKey: 'euro_kpi_import_exposure',
        label: 'Importenergie-Kostenexponierung',
        valueEur: correlationResult ? correlationResult.importExposureEur : null,
        description: correlationResult
          ? `Abgeleitete Importexponierung: ${correlationResult.importDemandKwh} kWh/a Restbedarf nach lokaler Deckungsschätzung (kein Messwert; H0/G0-SLP-Proxy).`
          : 'Erfordert lokales Lastprofil und Zeitreihen-Korrelation. Ohne diese Daten keine Aussage zur Importexponierung.',
        evidenceStatus: correlationResult ? 'derived-from-assets' : 'missing-evidence',
      },
    ];

    const noAutarkyGuardrails = [
      'keine_autarkie_aussage_ohne_zeitreihen',
      'keine_haushaltsaequivalente_aus_mwh',
      'keine_lokale_versorgungsbehauptung_ohne_lastprofil',
      'keine_physische_lieferzusage',
      'kein_windpark_versorgt_x_haushalte',
      'lokale_deckung_nur_als_evidenzbasiertes_szenario',
      'kein_messwert_slp_proxy_nicht_abrechnungsrelevant',
    ];

    const missingEvidence = [];
    const addGap = (missingDataPoint, enablesDossierAddition) => {
      missingEvidence.push({ missingDataPoint, enablesDossierAddition });
    };

    if (!isKnown)
      addGap(
        'municipality_profile',
        'Gemeindeprofil (AGS, Einwohnerzahl, Fläche) ermöglicht das Grundlagenbild.'
      );
    if (!resolvedAgs)
      addGap('ags_code', 'AGS-Code ermöglicht MaStR-Abfrage und KAV-Kategorisierung.');
    if (!correlationResult) {
      addGap(
        'local_load_profile',
        'Lokales Lastprofil (Stundenauflösung) ermöglicht Zeitreihen-Korrelation und belastbare lokale Werterfassung in EUR.'
      );
      addGap(
        'generation_time_series',
        'Erzeugungszeitreihe je Technologie ermöglicht Zeitkorrelation; ohne sie bleiben localCorrelationValueEur und importExposureEur null.'
      );
    }
    addGap(
      'vnb_bnr',
      'BNr oder MaStR-Netzbetreiber-ID ermöglicht EWK-Anschlussdauer und Digitalisierungsindex.'
    );
    addGap(
      'mastr_live_data',
      'Live-MaStR-Abfrage ermöglicht belastbare Erzeugungskapazitäten statt Annahmen.'
    );
    addGap(
      'netzkapazitaetsnachweis',
      'Netzkapazitätsnachweis ermöglicht Kapazitätsengpass-Risikobewertung.'
    );
    addGap(
      'imsys_rollout_quote',
      'Lokale iMSys/SMGW-Rollout-Quote vom Netzbetreiber ermöglicht SMGW-Risikozeile.'
    );
    addGap(
      'storage_mastr_inventory',
      'Belegter Speicherbestand ermöglicht Bestandsszenarien statt reiner Speicher-/Flex-Hypothesen.'
    );
    addGap(
      'fnav_capacity_window',
      'fNAV-/FCA-Leistungsfenster des Netzbetreibers ermöglicht statische oder dynamische Flex-Szenarien.'
    );
    addGap(
      'building_permit_fast_track_policy',
      'Kommunale Genehmigungs- und Förderleitplanken ermöglichen eine belastbare Beschlussvorlage für Speicher/Flex-Projekte.'
    );
    addGap(
      'energy_sharing_malo_metering',
      'MaLo-/Messkonzept je Liegenschaft ermöglicht §42c-Allokation mit 15-Minuten-Messung oder RLM.'
    );
    addGap(
      'energy_sharing_participant_contracts',
      'Teilnehmer-, Liefer- und gemeinsame Nutzungsverträge ermöglichen ein belastbares Energy-Sharing-Pilotmodell.'
    );
    addGap(
      'energy_sharing_reststrom_supplier',
      'Reststromlieferant und Informationspflichten ermöglichen rechtskonforme Teilversorgung statt Vollversorgungsbehauptung.'
    );
    addGap(
      'energy_sharing_vnb_bilanzierungsgebiet',
      'Bilanzierungsgebiet und angrenzende VNB-Gebiete bestimmen, welche Liegenschaften und Teilnehmer ab 2026/2028 gemeinsam nutzbar sind.'
    );
    addGap(
      'operator_locality',
      'Belege zur Lokalität des Netzbetreibers ermöglichen kommunale Steuer-/Umsatzeffekt-Abschätzung.'
    );
    addGap(
      'local_tax_assumptions',
      'Lokale Gewerbesteuer-/Einkommensteuerannahmen ermöglichen kommunales Steuereffekt-Szenario.'
    );
    if (annualLoad?.sectorEvidenceStatus === 'heuristic-fallback') {
      addGap(
        'osm_mastr_sector_split',
        'OSM-Gebäudenutzung, MaStR-Anlagenstandorte und kommunale Liegenschaften ersetzen den Strukturproxy durch einen lokalen Sektor-Split.'
      );
    }

    const noCallGuards = [
      'billing.settlement',
      'tariff.mutate',
      'mako.dispatch',
      'konzessionsabgabe.finalSettle',
      'device-control.execute',
      'smgw.register',
      'smgw.control',
      'budibase.table.write',
      'personal-agent.execute',
      'rundeck.job.execute',
      'grid-connection.reserve',
      'building-permit.approve',
      'subsidy.grant',
      'energy-sharing.allocate',
      'energy-sharing.contract.sign',
      'energy-sharing.billing.execute',
      'tenant.provision',
      'tenant.reset',
      'external.data.export.unrestricted',
    ];

    const status = isKnown
      ? missingEvidence.some((g) => g.missingDataPoint === 'vnb_bnr')
        ? 'lagebild_partial'
        : 'lagebild_available'
      : 'lagebild_municipality_unresolved';

    const derivedLoadProfileRows = annualLoad
      ? [
          {
            rowKey: 'derived_load_summary',
            rowLabel: 'Abgeleitetes kommunales Jahres-Lastprofil',
            totalAnnualKwh: annualLoad.totalAnnualKwh,
            householdKwh: annualLoad.householdKwh,
            commercialKwh: annualLoad.commercialKwh,
            publicBuildingKwh: annualLoad.publicBuildingKwh,
            households: annualLoad.households,
            commercialFraction: annualLoad.commercialFraction,
            publicFraction: annualLoad.publicFraction,
            sectorModelLabel: annualLoad.sectorModelLabel,
            sectorEvidenceStatus: annualLoad.sectorEvidenceStatus,
            sectorEvidenceKey: annualLoad.sectorEvidenceKey,
            sectorEvidenceLabel: annualLoad.sectorEvidenceLabel,
            sectorNextGateLabel: annualLoad.sectorNextGateLabel,
            confidence: annualLoad.confidence,
            evidenceStatus: annualLoad.evidenceStatus,
            sourceLabel: annualLoad.sourceLabel,
          },
          ...annualLoad.derivedLoadBuckets.map((b) => ({
            rowKey: b.bucketKey,
            rowLabel: b.bucketLabel,
            totalAnnualKwh: b.annualKwh,
            slpProfileId: b.slpProfileId,
            basis: b.basis,
            evidenceStatus: b.evidenceStatus,
            confidence: b.confidence,
          })),
        ]
      : [];

    const sectorEvidenceRows = annualLoad
      ? [
          {
            rowKey: 'sector_split_evidence',
            rowLabel: 'Sektor-Split Gewerbe/Kommune',
            methodKey: annualLoad.sectorEvidenceKey || 'unknown',
            methodLabel: annualLoad.sectorModelLabel || 'Sektorproxy',
            commercialFraction: annualLoad.commercialFraction,
            publicFraction: annualLoad.publicFraction,
            evidenceStatus: annualLoad.sectorEvidenceStatus || 'unknown',
            evidenceLabel: annualLoad.sectorEvidenceLabel || annualLoad.sourceLabel || null,
            nextGateLabel: annualLoad.sectorNextGateLabel || null,
            sourceLabel:
              'REST-API: kommunales Lastmodell; OSM-/MaStR-Sektorevidenz als nächster Backend-Nachweis',
          },
        ]
      : [];

    const intermunicipalComparison = buildIntermunicipalComparison({
      profile,
      annualLoad,
      totalGrossMarketValueEur,
      year,
      scenario,
      marketPriceEurPerMwh: assumedMarketPriceEurPerMwh,
    });
    const generationOutlierGuardrail = (intermunicipalComparison.guardrailRows || []).find(
      (row) => row.guardrailKey === 'target_peer_method_outlier' && row.status === 'blocked'
    );
    const generationIntegrityWarning = generationOutlierGuardrail
      ? {
          status: 'review-required',
          warningKey: 'target_peer_method_outlier',
          headline: 'Erzeugungswerte vor politischer Nutzung prüfen',
          message:
            'Die abgeleitete lokale Erzeugung liegt außerhalb des Peer-Korridors. Vor Beschluss sollten Anlagenbestand, Volllaststunden und Peer-Methodik gegengeprüft werden.',
          affectedMetrics: [
            'gross_market_value',
            'local_value_capture',
            'import_exposure',
            'energy_sharing_potential',
          ],
          nextGateLabel:
            'MaStR-/Anlagenbestand der Zielkommune, Volllaststunden und Peer-Ableitung gegen reale Projekte prüfen.',
        }
      : null;

    if (generationIntegrityWarning) {
      addGap(
        'generation_peer_outlier_review',
        'Ausreißerprüfung für lokale Erzeugung ermöglicht belastbare Ratszahlen.'
      );
      for (const row of valueRows) {
        const rowKey = String(row.rowKey || '');
        if (rowKey.includes('generation_value') || rowKey === 'local_value_capture_indicator') {
          row.evidenceStatus = 'integrity-review-required';
          row.integrityWarningKey = generationIntegrityWarning.warningKey;
        }
      }
      for (const row of timeSeriesValueRows) {
        if (Number(row.marketValueEur) > 0 || Number(row.localCorrelationValueEur) > 0) {
          row.evidenceStatus = 'integrity-review-required';
          row.integrityWarningKey = generationIntegrityWarning.warningKey;
        }
      }
      for (const row of euroKpiRows) {
        if (
          [
            'euro_kpi_gross_market_value',
            'euro_kpi_local_value_capture',
            'euro_kpi_import_exposure',
          ].includes(row.rowKey)
        ) {
          row.evidenceStatus = 'integrity-review-required';
          row.integrityWarningKey = generationIntegrityWarning.warningKey;
        }
      }
      for (const row of energySharingCommunityRows) {
        if (
          Number(row.referenceUnmatchedValueEur) > 0 ||
          Number(row.potentialLocalCirculationEurPerYear) > 0
        ) {
          row.evidenceStatus = 'integrity-review-required';
          row.integrityWarningKey = generationIntegrityWarning.warningKey;
        }
      }
    }

    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'municipal_energy_value_analysis',
    }));

    return {
      capabilityKey: 'municipal_energy_value_analysis',
      status,
      municipality: resolvedName,
      ags: resolvedAgs || null,
      postalCode: profile.postalCode || null,
      postalCodes: Array.isArray(profile.postalCodes) ? profile.postalCodes : [],
      population: profile.population || null,
      state: profile.state || null,
      district: profile.district || null,
      kavCategory: profile.konzessionsabgabeKategorie || null,
      kavRateNsCtPerKwh: profile.kavRateNsCtPerKwh || null,
      year,
      scenario,
      analysisRunId,
      valueRows,
      timeSeriesValueRows,
      derivedLoadProfileRows,
      sectorEvidenceRows,
      flexibilityScenarioRows,
      energySharingCommunityRows,
      euroKpiRows,
      riskRows,
      budgetImpactRows,
      assumptionRows,
      sourceRows,
      missingEvidence,
      positiveFollowUps,
      noCallGuards,
      noAutarkyGuardrails,
      intermunicipalComparison,
      generationIntegrityWarning,
      _errors: [],
    };
  },

  buildSmgwConnectorReadinessStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const normalizeKey = (value, fallback) =>
      String(value || fallback || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    const missingMap = {
      integration_scope:
        'adds the concrete SMGW integration scope before connector readiness can be claimed.',
      tenant_auth_boundary: 'adds tenant/auth boundary evidence for a future SMGW adapter path.',
      adapter_class: 'adds target gateway or adapter class evidence without calling that adapter.',
      control_domain_intent:
        'adds the intended §14a control-domain boundary and non-execution reason.',
      nes2_module_evidence: 'adds NES2 tariff-module readiness classification evidence.',
      eebus_taf_evidence: 'adds EEBUS/TAF evidence for the planned gateway path.',
      audit_prerequisites:
        'adds compliance/audit prerequisite evidence before production connector work.',
      owner: 'adds the accountable owner for closing SMGW readiness gaps.',
    };
    const missingEvidence = [];
    const addGap = (id) => {
      if (!missingEvidence.some((gap) => gap.missingDataPoint === id)) {
        missingEvidence.push({
          missingDataPoint: id,
          enablesDossierAddition: missingMap[id],
        });
      }
    };

    if (!isProvided(params.integrationScope)) addGap('integration_scope');
    if (!isProvided(params.authBoundary) && !isProvided(params.tenantBoundary))
      addGap('tenant_auth_boundary');
    if (!isProvided(params.adapterClass) && !isProvided(params.gatewayClass))
      addGap('adapter_class');
    if (!isProvided(params.controlDomainIntent)) addGap('control_domain_intent');
    if (!isProvided(params.nes2ModuleEvidence)) addGap('nes2_module_evidence');
    if (!isProvided(params.eebusEvidence) && !isProvided(params.tafEvidence))
      addGap('eebus_taf_evidence');
    if (!isProvided(params.auditPrerequisites)) addGap('audit_prerequisites');
    if (!isProvided(params.ownerRole)) addGap('owner');

    const callerBlockers = toList(params.blocker);
    const blockers = [...callerBlockers, ...missingEvidence.map((gap) => gap.missingDataPoint)];
    const readinessScore = Number(Math.max(0, (8 - missingEvidence.length) / 8).toFixed(2));
    const status =
      readinessScore === 1
        ? 'ready_for_connector_design'
        : missingEvidence.some((gap) => gap.missingDataPoint === 'tenant_auth_boundary')
          ? 'blocked_by_auth_boundary'
          : 'needs_connector_evidence';
    const connectorReadiness = {
      integrationScope: params.integrationScope || '§14a SMGW connector readiness',
      scopeKey: normalizeKey(params.integrationScope, 'smgw_connector'),
      gatewayClass: params.gatewayClass || params.adapterClass || 'undeclared_gateway_class',
      adapterClass: params.adapterClass || params.gatewayClass || 'undeclared_adapter_class',
      controlDomainIntent: params.controlDomainIntent || 'control intent not yet evidenced',
      nes2ModuleEvidence: params.nes2ModuleEvidence || null,
      eebusEvidence: params.eebusEvidence || null,
      tafEvidence: params.tafEvidence || null,
      auditPrerequisites: params.auditPrerequisites || null,
      authBoundary: params.authBoundary || params.tenantBoundary || null,
      tenantBoundary: params.tenantBoundary || params.authBoundary || null,
      ownerRole: params.ownerRole || 'unassigned',
      fallbackReason:
        params.fallbackReason ||
        'readiness evidence only; connector/control execution remains out of scope',
      evidenceHints: toList(params.evidenceHints),
    };
    const sourceActions = {
      inspected: ['dashboard-api.smgwConnectorReadinessStatus'],
      referenced: [
        connectorReadiness.integrationScope,
        connectorReadiness.gatewayClass,
        connectorReadiness.adapterClass,
        connectorReadiness.controlDomainIntent,
      ].filter(Boolean),
      notCalled: [
        'smgw.register',
        'smgw.pairDevice',
        'smgw.control',
        'taf7.dispatch',
        'mqtt.publish',
        'eebus.bridge',
        'openmuc.adapter.call',
        'voltaris.adapter.call',
        'nes2.tariffEngine.calculate',
        'billing.import',
        'hitl.create',
        'external.connector.call',
        'secret.read',
        'personal-agent.execute',
      ],
    };
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'smgw_connector_readiness_status',
    }));
    const nextActions = positiveFollowUps.map((gap) => ({
      action: 'requestEvidence',
      missingDataPoint: gap.missingDataPoint,
      description: gap.enablesDossierAddition,
    }));
    const dossierFacts = [
      `SMGW Connector Readiness: ${status}`,
      `Readiness Score: ${readinessScore}`,
      `Integration Scope: ${connectorReadiness.integrationScope}`,
      `Adapter Class: ${connectorReadiness.adapterClass}`,
      `Auth Boundary: ${connectorReadiness.authBoundary || 'missing'}`,
      `Fallback Reason: ${connectorReadiness.fallbackReason}`,
    ];

    return {
      capabilityKey: 'smgw_connector_readiness_status',
      safety: 'read_only',
      status,
      readinessScore,
      connectorReadiness,
      blockers,
      missingEvidence,
      positiveFollowUps,
      nextActions,
      sourceActions,
      dossierEvidence: {
        capabilityKey: 'smgw_connector_readiness_status',
        status,
        readinessScore,
        connectorReadiness,
        blockers,
        missingEvidence,
        positiveFollowUps,
        nextActions,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
      _errors: [],
    };
  },

  buildVnbSpecialTopicWorkstateStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value))
        return value
          .filter(Boolean)
          .map((item) => String(item).trim())
          .filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };
    const normalize = (value) => String(value || '').trim();
    const hasValue = (value) => normalize(value) !== '';
    const normalizeDomain = (value) => {
      const domain = normalize(value).toLowerCase();
      const allowed = new Set(['anschluss', 'flexibility', 'energy_sharing', 'gas', 'asset']);
      return allowed.has(domain) ? domain : 'other';
    };
    const parseTimestamp = (value) => {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const ageDays = (timestampMs) => {
      if (!Number.isFinite(timestampMs)) return null;
      return Math.max(0, Number(((Date.now() - timestampMs) / (24 * 60 * 60 * 1000)).toFixed(2)));
    };
    const thresholdDays = Number.isFinite(Number(params.freshnessThresholdDays))
      ? Number(params.freshnessThresholdDays)
      : 45;
    const leadingSourceTimestampMs = parseTimestamp(params.leadingSourceTimestamp);
    const leadingSourceAgeDays = ageDays(leadingSourceTimestampMs);
    const leadingSourceStale = leadingSourceAgeDays != null && leadingSourceAgeDays > thresholdDays;
    const allowedSideSources = toList(params.allowedSideSources).map((source) => ({
      source,
      role: params.allowSideSourceOverride ? 'allowed_override_candidate' : 'side_evidence_only',
    }));
    const sideSourceFreshness = toList(params.sideSourceFreshness).map((entry) => {
      const [source, timestamp] = String(entry).split('@');
      const tsMs = parseTimestamp(timestamp);
      return {
        source: normalize(source || entry),
        timestamp: timestamp || null,
        ageDays: ageDays(tsMs),
        stale: tsMs == null ? null : ageDays(tsMs) > thresholdDays,
        canOverrideLeadingSource: Boolean(params.allowSideSourceOverride),
      };
    });

    const topic = {
      topicId: params.topicId || `vnb-workstate:${normalize(params.topicName) || 'sonderthema'}`,
      topicName: params.topicName || 'VNB Sonderthema',
      domain: normalizeDomain(params.domain),
      owner: params.owner || null,
      accountableRole: params.accountableRole || params.owner || null,
    };
    const sourceFreshness = {
      leadingSource: params.leadingSource || null,
      leadingSourceTimestamp: params.leadingSourceTimestamp || null,
      leadingSourceVersion: params.leadingSourceVersion || null,
      leadingSourceAgeDays,
      thresholdDays,
      leadingSourceStale,
      sideSourceOverrideAllowed: Boolean(params.allowSideSourceOverride),
    };
    const staleMarkers = [];
    if (leadingSourceStale) {
      staleMarkers.push({
        marker: 'leading_source_stale',
        message: `Leading source is older than ${thresholdDays} days.`,
      });
    }
    for (const side of sideSourceFreshness) {
      if (side.stale) {
        staleMarkers.push({
          marker: 'side_source_stale',
          source: side.source,
          message: 'Allowed side source is stale and cannot establish leading work state.',
        });
      }
    }

    const gapSpecs = [
      {
        id: 'missing_leading_source',
        ok: hasValue(params.leadingSource),
        enablesDossierAddition:
          'Fuehrende Quelle kann als verbindlicher Arbeitsstand im Dossier belegt werden.',
      },
      {
        id: 'missing_leading_source_timestamp',
        ok: leadingSourceTimestampMs != null,
        enablesDossierAddition:
          'Quellenfrische kann als Dossier-Fakt ergaenzt und gegen Stale-Marker geprueft werden.',
      },
      {
        id: 'missing_leading_source_version',
        ok: hasValue(params.leadingSourceVersion),
        enablesDossierAddition:
          'Versionsstand der fuehrenden Quelle kann fuer Audit und Wiederholbarkeit belegt werden.',
      },
      {
        id: 'missing_owner',
        ok: hasValue(topic.owner) || hasValue(topic.accountableRole),
        enablesDossierAddition:
          'Arbeitsstand kann mit verantwortlicher Rolle und Review-Anker belegt werden.',
      },
      {
        id: 'missing_side_source_policy',
        ok: allowedSideSources.length > 0,
        enablesDossierAddition: 'Nebenquellen-Regel kann Uebersteuerung nachvollziehbar machen.',
      },
    ];
    const missingEvidence = gapSpecs
      .filter((gap) => !gap.ok)
      .map((gap) => ({
        missingDataPoint: gap.id,
        enablesDossierAddition: gap.enablesDossierAddition,
        category: 'vnb_special_topic_workstate',
      }));
    if (leadingSourceStale) {
      missingEvidence.push({
        missingDataPoint: 'stale_leading_source_refresh',
        enablesDossierAddition:
          'Aktualisierte fuehrende Quelle kann Entscheidungsreife wiederherstellen.',
        category: 'vnb_special_topic_workstate',
      });
    }

    let status = 'current';
    if (!hasValue(params.leadingSource) || leadingSourceTimestampMs == null) {
      status = 'insufficient_evidence';
    } else if (!hasValue(topic.owner) && !hasValue(topic.accountableRole)) {
      status = 'needs_owner_review';
    } else if (leadingSourceStale) {
      status = 'stale';
    }
    const decisionReadiness = {
      status,
      canUseAsLeadingWorkstate: status === 'current',
      reason:
        status === 'current'
          ? 'Leading source, source freshness and owner/accountable role are present.'
          : status === 'stale'
            ? 'Leading source is older than the configured freshness threshold.'
            : status === 'needs_owner_review'
              ? 'Owner or accountable role is missing.'
              : 'Leading source or timestamp evidence is missing.',
    };
    const sourceActions = {
      inspected: ['dashboard-api.vnbSpecialTopicWorkstateStatus'],
      referenced: ['evidence-registry.lookup', 'dossier-hydration.registry'],
      notCalled: [
        'sharepoint.connector.read',
        'teams.connector.read',
        'outlook.connector.read',
        'mail.send',
        'task.create',
        'workflow.execute',
        'hitl.create',
        'budibase.apply',
        'external.connector.call',
        'object-store.write',
        'rag.ingest',
        'cernion.table.write',
        'personal-agent.execute',
        'mako.dispatch',
        'billing.prepareInvoice',
        'settlement.exportA96',
        'tariff.mutate',
        'device-control.execute',
      ],
    };
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      state: 'missing_or_stale_evidence',
    }));
    const dossierFacts = [
      `VNB Sonderthema Arbeitsstand: ${status}`,
      `Topic: ${topic.topicName}`,
      `Domain: ${topic.domain}`,
      `Leading Source: ${sourceFreshness.leadingSource || 'missing'}`,
      `Leading Source Version: ${sourceFreshness.leadingSourceVersion || 'missing'}`,
      `Leading Source Age Days: ${
        sourceFreshness.leadingSourceAgeDays == null
          ? 'unknown'
          : sourceFreshness.leadingSourceAgeDays
      }`,
      `Owner: ${topic.owner || 'missing'}`,
      `Accountable Role: ${topic.accountableRole || 'missing'}`,
      `Side Source Override Allowed: ${sourceFreshness.sideSourceOverrideAllowed}`,
    ];

    return {
      capabilityKey: 'vnb_special_topic_workstate',
      safety: 'read_only',
      status,
      topic,
      sourceFreshness,
      allowedSideSources,
      sideSourceFreshness,
      staleMarkers,
      missingEvidence,
      positiveFollowUps,
      decisionReadiness,
      sourceActions,
      dossierEvidence: {
        capabilityKey: 'vnb_special_topic_workstate',
        status,
        topic,
        sourceFreshness,
        allowedSideSources,
        sideSourceFreshness,
        staleMarkers,
        missingEvidence,
        positiveFollowUps,
        decisionReadiness,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
      _errors: [],
    };
  },

  buildMonitoringNonEscalationStatus(params = {}) {
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const normalize = (value) => String(value || '').trim();
    const sourceCheckedAtMs = Date.parse(params.sourceCheckedAt || '');
    const nextCheckAtMs = Date.parse(params.nextCheckAt || '');
    const hasValidSourceCheckedAt = Number.isFinite(sourceCheckedAtMs);
    const hasValidNextCheckAt = Number.isFinite(nextCheckAtMs);
    const normalizedBlockingFinding = normalize(params.blockingFinding).toLowerCase();
    const blockerAbsent =
      isProvided(params.blockingFinding) &&
      /^(none|absent|no|kein|keine|nicht vorhanden|ohne|unauffaellig|unauffällig|false)$/i.test(
        normalizedBlockingFinding
      );

    const signal = {
      signalId: params.signalId || 'monitoring-signal:unspecified',
      domain: params.domain || 'vnb_monitoring',
      assetContext: params.assetContext || null,
    };
    const checkedSource = {
      sourceName: params.sourceName || null,
      sourceCheckedAt: params.sourceCheckedAt || null,
      sourceCheckedAtValid: hasValidSourceCheckedAt,
    };
    const absentBlocker = {
      blockingFinding: params.blockingFinding || null,
      blockerAbsent,
      classification: blockerAbsent
        ? 'absent_blocker_documented'
        : isProvided(params.blockingFinding)
          ? 'blocking_finding_not_absent'
          : 'unknown_blocker_state',
    };
    const evidenceSpecs = [
      {
        id: 'checked_source',
        label: 'Checked source',
        value: params.sourceName,
        enablesDossierAddition: 'add checked monitoring source to the dossier evidence trail',
      },
      {
        id: 'source_checked_at',
        label: 'Source checked timestamp',
        value: hasValidSourceCheckedAt ? params.sourceCheckedAt : null,
        enablesDossierAddition: 'add audit-ready last-check timestamp',
      },
      {
        id: 'novelty',
        label: 'Novelty classification',
        value: params.novelty,
        enablesDossierAddition: 'add whether the signal is new, unchanged, stale or unknown',
      },
      {
        id: 'blocking_finding',
        label: 'Absent blocker evidence',
        value: blockerAbsent ? params.blockingFinding : null,
        enablesDossierAddition:
          'distinguish absent blocker from unresolved unknown or active blocker',
      },
      {
        id: 'next_check_at',
        label: 'Next check timestamp',
        value: hasValidNextCheckAt ? params.nextCheckAt : null,
        enablesDossierAddition: 'add next review gate for recurring monitoring',
      },
      {
        id: 'owner',
        label: 'Owner',
        value: params.owner,
        enablesDossierAddition: 'add accountable follow-up owner',
      },
      {
        id: 'rationale',
        label: 'Non-escalation rationale',
        value: params.rationale,
        enablesDossierAddition: 'add reviewable non-escalation justification',
      },
    ];
    const evidenceItems = evidenceSpecs
      .filter((spec) => isProvided(spec.value))
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.value,
        evidenceStatus: 'provided',
        sourceClass: 'monitoring_non_escalation_evidence',
      }));
    const missingEvidence = evidenceSpecs
      .filter((spec) => !isProvided(spec.value))
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        enablesDossierAddition: spec.enablesDossierAddition,
        category: 'non_escalation_control_evidence',
      }));
    const status =
      missingEvidence.length === 0
        ? 'non_escalation_evidence_complete'
        : !isProvided(params.sourceName) || !hasValidSourceCheckedAt
          ? 'needs_checked_source'
          : !blockerAbsent
            ? 'needs_absent_blocker_evidence'
            : !isProvided(params.owner)
              ? 'needs_owner'
              : !isProvided(params.rationale)
                ? 'needs_rationale'
                : 'partial_non_escalation_evidence';
    const sourceActions = {
      inspected: ['dashboard-api.monitoringNonEscalationStatus'],
      referenced: [
        'evidence-registry.lookup',
        'dossier-hydration.registry',
        'dashboard-api.vnbSpecialTopicWorkstateStatus',
        'dashboard-api.crossDomainSpecialTopicsQueueStatus',
      ],
      notCalled: [
        'monitoring.scheduler.run',
        'alerting.escalate',
        'hitl.create',
        'mail.send',
        'webhook.emit',
        'workflow.execute',
        'external.connector.call',
        'object-store.write',
        'rag.ingest',
        'budibase.apply',
        'cernion.table.write',
        'mako.dispatch',
        'billing.prepareInvoice',
        'settlement.exportA96',
        'tariff.mutate',
        'device-control.execute',
        'smgw.connector.call',
        'cls.control.execute',
        'personal-agent.execute',
      ],
    };
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      state: 'missing_non_escalation_evidence',
    }));
    const dossierFacts = [
      `Nicht-Eskalation Status: ${status}`,
      `Signal: ${signal.signalId}`,
      `Domain: ${signal.domain}`,
      `Checked Source: ${checkedSource.sourceName || 'missing'}`,
      `Novelty: ${params.novelty || 'missing'}`,
      `Absent Blocker: ${blockerAbsent}`,
      `Owner: ${params.owner || 'missing'}`,
      `Next Check: ${params.nextCheckAt || 'missing'}`,
    ];

    return {
      evidenceId: `nec:${Buffer.from(
        `${signal.signalId}:${checkedSource.sourceName || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'non_escalation_control_evidence',
      safety: 'read_only',
      status,
      signal,
      checkedSource,
      novelty: params.novelty || null,
      absentBlocker,
      nextCheckAt: params.nextCheckAt || null,
      owner: params.owner || null,
      nonEscalationRationale: params.rationale || null,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      sourceActions,
      validationFindings: missingEvidence.map((gap) => ({
        code: `NEC_${String(gap.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['checked_source', 'source_checked_at', 'blocking_finding'].includes(
          gap.missingDataPoint
        )
          ? 'high'
          : 'medium',
        message: gap.enablesDossierAddition,
      })),
      dossierEvidence: {
        capabilityKey: 'non_escalation_control_evidence',
        status,
        signal,
        checkedSource,
        novelty: params.novelty || null,
        absentBlocker,
        nextCheckAt: params.nextCheckAt || null,
        owner: params.owner || null,
        nonEscalationRationale: params.rationale || null,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
      _errors: [],
    };
  },

  buildLeadershipDeltaCockpitStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value))
        return value
          .filter(Boolean)
          .map((item) => String(item).trim())
          .filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const normalizeStatus = (
      value,
      evidenceStatus,
      blockedDecision,
      escalationState,
      newSignals
    ) => {
      const explicit = String(value || '').trim();
      const allowed = new Set([
        'known',
        'delta_detected',
        'evidence_gap',
        'blocked',
        'decision_ready',
        'escalated',
        'closed',
      ]);
      if (allowed.has(explicit)) return explicit;
      if (/escalat|eskal/i.test(String(escalationState || ''))) return 'escalated';
      if (isProvided(blockedDecision)) return 'blocked';
      if (/missing|partial|gap|luecke|lücke/i.test(String(evidenceStatus || '')))
        return 'evidence_gap';
      if (/ready|approval|entscheidungsreif/i.test(String(evidenceStatus || '')))
        return 'decision_ready';
      if (newSignals.length > 0) return 'delta_detected';
      return 'known';
    };

    const newSignals = toList(params.newSignals);
    const linkedEntities = toList(params.linkedEntities);
    const sourceSignals = toList(params.sourceSignals);
    const explicitErrors = params.includeDegradedSample
      ? ['leadership-delta-cockpit.sampleSource']
      : [];
    const topic = {
      topicId: params.topicId || `leadership-delta:${params.topic || params.domain || 'general'}`,
      title: params.topic || 'Fuehrungscockpit Delta Steuerung',
      domain: params.domain || 'management_steering',
      role: params.role || null,
      status: normalizeStatus(
        params.status,
        params.evidenceStatus,
        params.blockedDecision,
        params.escalationState,
        newSignals
      ),
      deltaSummary: {
        signalCount: newSignals.length,
        newestSignal: newSignals[0] || null,
        summary:
          newSignals.length > 0
            ? `${newSignals.length} new signal(s) require leadership attention`
            : 'No new signal supplied; baseline stays known.',
      },
      knownBaseline: params.knownBaseline || null,
      newSignals,
      owner: params.ownerRole ? { role: params.ownerRole } : null,
      dueAt: params.dueAt || params.dueBefore || null,
      evidenceStatus: params.evidenceStatus || (sourceSignals.length > 0 ? 'partial' : 'missing'),
      blockedDecision: params.blockedDecision || null,
      escalation: {
        state: params.escalationState || 'none',
        escalated: /escalat|eskal/i.test(String(params.escalationState || '')),
      },
      nextLever:
        params.nextLever ||
        (params.blockedDecision
          ? 'unblock_decision'
          : sourceSignals.length === 0
            ? 'resolve_evidence_gap'
            : newSignals.length > 0
              ? 'review_delta'
              : 'monitor_baseline'),
      linkedEntities,
      sourceSignals,
    };

    const missingMap = {
      missing_owner: 'adds responsible owner or role and escalation path.',
      missing_due_date: 'adds deadline and overdue classification.',
      missing_evidence: 'adds evidence status and required source.',
      missing_blocked_decision: 'adds blocked follow-up decision and unblock lever.',
      missing_linked_entity: 'adds linked project, asset or process reference.',
      missing_source_signal: 'adds source signal provenance for the leadership delta.',
    };
    const missingEvidence = [];
    const addGap = (id) => {
      if (!missingEvidence.some((gap) => gap.missingDataPoint === id)) {
        missingEvidence.push({
          missingDataPoint: id,
          enablesDossierAddition: missingMap[id],
        });
      }
    };
    if (!topic.owner) addGap('missing_owner');
    if (!topic.dueAt) addGap('missing_due_date');
    if (!isProvided(params.evidenceStatus)) addGap('missing_evidence');
    if (!topic.blockedDecision && topic.status === 'blocked') addGap('missing_blocked_decision');
    if (linkedEntities.length === 0) addGap('missing_linked_entity');
    if (sourceSignals.length === 0) addGap('missing_source_signal');

    const topics = [topic].slice(0, params.limit || 25);
    const statusDistribution = topics.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});
    const sourceActions = {
      inspected: ['dashboard-api.leadershipDeltaCockpitStatus'],
      referenced: [
        'decision-frame.list',
        'hitl.list',
        'hitl.summary',
        'nova.listDecisions',
        'evidence-planner.plan',
        'evidence-registry.lookup',
        'dashboard-api.vnbOverview',
        ...sourceSignals,
      ],
      notCalled: [
        'hitl.create',
        'hitl.escalate',
        'nova.apply',
        'nova.approveDecision',
        'vdmi.taskMutate',
        'decision-frame.create',
        'ms365.sync',
        'external.connector.call',
        'settlement.exportA96',
        'billing.prepareInvoice',
        'tariff.mutate',
        'mako.dispatch',
        'personal-agent.execute',
      ],
    };
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'leadership_delta_cockpit',
    }));
    const dossierFacts = [
      `Leadership Delta Status: ${topic.status}`,
      `Topic: ${topic.title}`,
      `Domain: ${topic.domain}`,
      `Owner: ${topic.owner?.role || 'missing'}`,
      `Due At: ${topic.dueAt || 'missing'}`,
      `Evidence: ${topic.evidenceStatus}`,
      `Blocked Decision: ${topic.blockedDecision || 'none'}`,
      `Escalation: ${topic.escalation.state}`,
      `Next Lever: ${topic.nextLever}`,
    ];

    return {
      capabilityKey: 'leadership_delta_cockpit',
      safety: 'read_only',
      status: topic.status,
      topicCount: topics.length,
      statusDistribution,
      topics,
      missingEvidence,
      positiveFollowUps,
      nextActions: positiveFollowUps.map((gap) => ({
        action: 'requestEvidence',
        missingDataPoint: gap.missingDataPoint,
        description: gap.enablesDossierAddition,
      })),
      sourceActions,
      dossierEvidence: {
        capabilityKey: 'leadership_delta_cockpit',
        status: topic.status,
        topicCount: topics.length,
        statusDistribution,
        highestPriorityDeltas: topics.filter((item) => item.status !== 'known'),
        blockedDecisions: topics.filter((item) => item.blockedDecision),
        escalations: topics.filter((item) => item.escalation?.escalated),
        missingEvidence,
        positiveFollowUps,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
      _errors: explicitErrors,
    };
  },

  buildZaehlparkFinanzierungSzenarioCockpitStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value)) return value.filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };

    const toNumber = (value) => {
      if (value === undefined || value === null || value === '') return null;
      const normalized =
        typeof value === 'string' ? value.replace(/\s/g, '').replace(',', '.') : value;
      const n = Number(normalized);
      return Number.isFinite(n) ? n : null;
    };

    const sourceRefs = toList(params.sourceRef);
    const investmentVolume = toNumber(params.investmentVolume);
    const imsysCount = toNumber(params.imsysCount);
    const opexAnnual = toNumber(params.opexAnnual);

    const evidenceSpecs = [
      {
        id: 'grid_operator_id',
        label: 'Netzbetreiber ID',
        value: params.gridOperatorId,
        sourceClass: 'grid_operator_identity',
        enablesDossierAddition: 'verify DSO identification and metering portfolio owner',
      },
      {
        id: 'scenario_id',
        label: 'Scenario ID',
        value: params.scenarioId,
        sourceClass: 'scenario_reference',
        enablesDossierAddition: 'bind rollout and financing assumptions to a named scenario',
      },
      {
        id: 'asset_scope',
        label: 'Asset Scope',
        value: params.assetScope,
        sourceClass: 'metering_asset_scope',
        enablesDossierAddition:
          'confirm whether iMSys, gateways, mME, water or heat meters are in scope',
      },
      {
        id: 'metering_scope',
        label: 'Metering Scope',
        value: params.meteringScope,
        sourceClass: 'metering_scope',
        enablesDossierAddition: 'confirm intelligent, standard or cross-sector metering scope',
      },
      {
        id: 'period',
        label: 'Period',
        value: params.period,
        sourceClass: 'scenario_period',
        enablesDossierAddition: 'add rollout period for CAPEX/OPEX timing',
      },
      {
        id: 'investment_volume',
        label: 'Investment Volume',
        value: investmentVolume,
        sourceClass: 'capex_budget',
        enablesDossierAddition: 'add total CAPEX budget for financing scenario comparison',
      },
      {
        id: 'imsys_count',
        label: 'iMSys Count',
        value: imsysCount,
        sourceClass: 'smart_meter_rollout_quantity',
        enablesDossierAddition: 'add target iMSys rollout quantity',
      },
      {
        id: 'financing_model',
        label: 'Financing Model',
        value: params.financingModel,
        sourceClass: 'financing_model',
        enablesDossierAddition:
          'add financing model such as own capital, leasing, credit or contracting',
      },
      {
        id: 'opex_annual',
        label: 'OPEX Annual',
        value: opexAnnual,
        sourceClass: 'annual_opex',
        enablesDossierAddition: 'add annual OPEX estimate for TOTEX view',
      },
      {
        id: 'regulatory_relevance',
        label: 'Regulatory Relevance',
        value: params.regulatoryRelevance,
        sourceClass: 'regulatory_context',
        enablesDossierAddition:
          'add regulatory context such as paragraph_14a, paragraph_14d or MaStR validation',
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition:
          'add source references for scenario assumptions and evidence status',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value !== undefined && spec.value !== null && spec.value !== false)
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue ?? spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => spec.value === undefined || spec.value === null || spec.value === false)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const status = !params.gridOperatorId
      ? 'needs_grid_operator'
      : !params.scenarioId
        ? 'needs_scenario'
        : !params.assetScope
          ? 'needs_asset_scope'
          : investmentVolume === null
            ? 'needs_investment_volume'
            : imsysCount === null
              ? 'needs_imsys_count'
              : !params.financingModel
                ? 'needs_financing_model'
                : sourceRefs.length === 0
                  ? 'needs_source_refs'
                  : 'ready_for_decision';

    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const complianceScore = Number(
      (
        evidenceItems.filter((item) =>
          [
            'grid_operator_id',
            'scenario_id',
            'asset_scope',
            'metering_scope',
            'regulatory_relevance',
            'source_refs',
          ].includes(item.id)
        ).length / 6
      ).toFixed(2)
    );

    const financingModel = String(params.financingModel || '').toLowerCase();
    const regulatory = String(params.regulatoryRelevance || '').toLowerCase();
    const capexPerImsys =
      investmentVolume !== null && imsysCount > 0
        ? Number((investmentVolume / imsysCount).toFixed(2))
        : null;

    let gateStatus = 'insufficient_data';
    if (status === 'ready_for_decision') {
      const debtOrLease = /leasing|credit|kredit|contracting|fremd/.test(financingModel);
      const regulatorySensitive = /14a|14d|mastr|regulatory|regulator/.test(regulatory);
      if (
        readinessScore >= 1 &&
        complianceScore >= 1 &&
        investmentVolume <= 5000000 &&
        !debtOrLease
      ) {
        gateStatus = 'committee_ready';
      } else if (
        readinessScore >= 1 &&
        complianceScore >= 0.83 &&
        (debtOrLease || regulatorySensitive || investmentVolume > 5000000)
      ) {
        gateStatus = 'review_required';
      } else {
        gateStatus = 'insufficient_data';
      }
    }

    const technical = {
      assetScope: params.assetScope || null,
      meteringScope: params.meteringScope || null,
      imsysCount,
      capexPerImsys,
    };
    const financial = {
      investmentVolume,
      financingModel: params.financingModel || null,
      opexAnnual,
      totexFirstYear:
        investmentVolume !== null || opexAnnual !== null
          ? Number(((investmentVolume || 0) + (opexAnnual || 0)).toFixed(2))
          : null,
    };
    const regulatoryContext = {
      regulatoryRelevance: params.regulatoryRelevance || null,
      paragraph14aRelevant: /14a/.test(regulatory),
      paragraph14dRelevant: /14d/.test(regulatory),
      mastrValidationRelevant: /mastr/.test(regulatory),
    };

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'zaehlpark_finanzierung_szenario_cockpit',
    }));

    const blockingFindings = missingEvidence.map((item) => ({
      code: `ZFS_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'grid_operator_id',
        'scenario_id',
        'asset_scope',
        'investment_volume',
        'imsys_count',
        'financing_model',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));

    const complianceContext = {
      scenarioId: params.scenarioId || null,
      period: params.period || null,
    };

    const complianceEvidence = {
      gridOperatorId: params.gridOperatorId || null,
      assetScope: params.assetScope || null,
      meteringScope: params.meteringScope || null,
      investmentVolume,
      imsysCount,
      financingModel: params.financingModel || null,
      opexAnnual,
      regulatoryRelevance: params.regulatoryRelevance || null,
    };

    const dossierFacts = [
      `Status: ${status}`,
      `Gate Status: ${gateStatus}`,
      `Readiness Score: ${readinessScore}`,
      `Provided Zaehlpark Finanzierung Szenario Cockpit evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.scenarioId) dossierFacts.push(`Scenario ID: ${params.scenarioId}`);

    return {
      zaehlparkFinanzierungSzenarioCockpitStatusId: `zfs:${Buffer.from(
        `${params.gridOperatorId || ''}:${params.scenarioId || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'zaehlpark_finanzierung_szenario_cockpit',
      safety: 'read_only',
      requestContext: {
        gridOperatorId: params.gridOperatorId || null,
        scenarioId: params.scenarioId || null,
        period: params.period || null,
      },
      status,
      gateStatus,
      overallStatus: gateStatus,
      readinessScore,
      complianceScore,
      technical,
      financial,
      regulatory: regulatoryContext,
      complianceContext,
      complianceEvidence,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.zaehlparkFinanzierungSzenarioCockpitStatus'],
        referenced: [
          'edm-messkonzept.evaluateAll',
          'edm-validation.validate',
          'datapoint.health',
          'datapoint.validateSnapshot',
          'eog-calculator.scenario',
          'finance-agent.analyze',
          'investment-planning.createPlan',
          'off_balancing_metering_pruefmatrix',
        ],
        notCalled: [
          'hitl.create',
          'vdmi.mutate',
          'investment-planning.createPlan',
          'finance-agent.mutate',
          'budget.release',
          'settlement.prepareBilling',
          'external.bank.call',
          'external.leasing.call',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        gateStatus,
        readinessScore,
        complianceScore,
        technical,
        financial,
        regulatory: regulatoryContext,
        complianceContext,
        complianceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  buildTechCommercialOfferCockpitStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value)) return value.filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };

    const sourceRefs = toList(params.sourceRef);

    const evidenceSpecs = [
      {
        id: 'connection_request_id',
        label: 'Request ID',
        value: params.connectionRequestId,
        sourceClass: 'connection_request_id',
        enablesDossierAddition: 'verify connection request reference ID',
      },
      {
        id: 'grid_operator_id',
        label: 'Netzbetreiber ID',
        value: params.gridOperatorId,
        sourceClass: 'grid_operator_identity',
        enablesDossierAddition: 'verify DSO identification and market partner metadata',
      },
      {
        id: 'znp_alignment',
        label: 'Zielnetzbezug',
        value: params.znpAlignment,
        sourceClass: 'znp_alignment',
        enablesDossierAddition: 'verify alignment with target grid planning (ZNP)',
      },
      {
        id: 'grid_node',
        label: 'Grid Node',
        value: params.gridNode,
        sourceClass: 'grid_node',
        enablesDossierAddition: 'verify grid substation or feed-in node association',
      },
      {
        id: 'technical_restriction',
        label: 'Technische Restriktion',
        value: params.technicalRestriction,
        sourceClass: 'technical_restriction_evaluation',
        enablesDossierAddition: 'verify technical restrictions and network capacity limitations',
      },
      {
        id: 'requested_capacity_kw',
        label: 'Anfrageleistung',
        value: params.requestedCapacityKW,
        sourceClass: 'requested_capacity',
        enablesDossierAddition: 'verify requested connection capacity in kW',
      },
      {
        id: 'technical_status',
        label: 'Technischer Status',
        value: params.technicalStatus,
        sourceClass: 'technical_status',
        enablesDossierAddition: 'verify technical connection feasibility status',
      },
      {
        id: 'capacity_utilization',
        label: 'Auslastung',
        value: params.capacityUtilization,
        sourceClass: 'capacity_utilization',
        enablesDossierAddition: 'verify capacity utilization and headroom context',
      },
      {
        id: 'fnav_contract_logic',
        label: 'fNAV Vertragslage',
        value: params.fnavContractLogic,
        sourceClass: 'fnav_contract_logic',
        enablesDossierAddition: 'verify fNAV agreement or flexible-capacity contract options',
      },
      {
        id: 'commercial_assumptions',
        label: 'Kaufmännische Annahmen',
        value: params.commercialAssumptions,
        sourceClass: 'commercial_assumptions',
        enablesDossierAddition: 'verify CAPEX, OPEX and pricing model parameters',
      },
      {
        id: 'legal_agreement_status',
        label: 'Rechtsstatus',
        value: params.legalAgreementStatus,
        sourceClass: 'legal_agreement_status',
        enablesDossierAddition: 'verify public-law permissions or municipal agreement status',
      },
      {
        id: 'legal_boundaries',
        label: 'Legal Boundaries',
        value: params.legalBoundaries,
        sourceClass: 'legal_boundaries',
        enablesDossierAddition: 'verify regulatory boundary rules or easement status',
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add regulatory sources or documentation reference credentials',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value !== undefined && spec.value !== null && spec.value !== false)
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue ?? spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => spec.value === undefined || spec.value === null || spec.value === false)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const status = !params.connectionRequestId
      ? 'needs_connection_request'
      : !params.gridOperatorId
        ? 'needs_grid_operator'
        : !params.znpAlignment
          ? 'needs_znp_alignment'
          : !params.gridNode
            ? 'needs_grid_node'
            : !params.technicalRestriction
              ? 'needs_technical_restriction'
              : !params.requestedCapacityKW
                ? 'needs_requested_capacity'
                : !params.technicalStatus
                  ? 'needs_technical_status'
                  : !params.capacityUtilization
                    ? 'needs_capacity_utilization'
                    : sourceRefs.length === 0
                      ? 'needs_source_refs'
                      : 'ready_for_offer_decision';

    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const complianceScore = readinessScore;

    let gateStatus = 'needs_evidence';
    if (status === 'ready_for_offer_decision') {
      const restriction = String(params.technicalRestriction || '').toLowerCase();
      const utilization = String(params.capacityUtilization || '').toLowerCase();
      const feasibility = String(params.technicalStatus || '').toLowerCase();

      const isOkOrLow = (str) => {
        return (
          str.includes('ok') ||
          str.includes('low') ||
          str.includes('niedrig') ||
          str.includes('none') ||
          str.includes('freigegeben') ||
          str.includes('approved') ||
          str.includes('feasible')
        );
      };

      const isConditionalOrFlexible = (str) => {
        return (
          str.includes('conditional') ||
          str.includes('flexible') ||
          str.includes('fnav') ||
          str.includes('monitor') ||
          str.includes('eingeschränkt')
        );
      };

      if ((isOkOrLow(restriction) || isOkOrLow(feasibility)) && isOkOrLow(utilization)) {
        gateStatus = 'invest';
      } else if (
        isConditionalOrFlexible(restriction) ||
        isConditionalOrFlexible(feasibility) ||
        isConditionalOrFlexible(utilization)
      ) {
        gateStatus = 'monitor';
      } else {
        gateStatus = 'reject';
      }
    } else {
      gateStatus = 'needs_evidence';
    }

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'tech_commercial_offer_cockpit',
    }));

    const blockingFindings = missingEvidence.map((item) => ({
      code: `TCOC_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'connection_request_id',
        'grid_operator_id',
        'technical_restriction',
        'requested_capacity_kw',
        'technical_status',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));

    const complianceContext = {
      connectionRequestId: params.connectionRequestId || null,
    };

    const complianceEvidence = {
      gridOperatorId: params.gridOperatorId || null,
      znpAlignment: params.znpAlignment || null,
      technicalRestriction: params.technicalRestriction || null,
      requestedCapacityKW: params.requestedCapacityKW || null,
      technicalStatus: params.technicalStatus || null,
      capacityUtilization: params.capacityUtilization || null,
      fnavContractLogic: params.fnavContractLogic || null,
      commercialAssumptions: params.commercialAssumptions || null,
      legalAgreementStatus: params.legalAgreementStatus || null,
      owner: params.owner || 'Assetmanagement Netzanschluss',
    };

    const dossierFacts = [
      `Status: ${status}`,
      `Gate Status: ${gateStatus}`,
      `Provided Technical & Commercial Offer Cockpit Gate evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.connectionRequestId)
      dossierFacts.push(`Connection Request ID: ${params.connectionRequestId}`);

    return {
      techCommercialOfferCockpitStatusId: `tcoc:${Buffer.from(`${params.connectionRequestId || ''}`)
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'tech_commercial_offer_cockpit',
      safety: 'read_only',
      requestContext: complianceContext,
      status,
      gateStatus,
      readinessScore,
      complianceScore,
      complianceContext,
      complianceEvidence,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.techCommercialOfferCockpitStatus'],
        referenced: [
          'grid-connection.validate',
          'grid-connection.fnavValidate',
          'grid-operations.connectionCapacityCheck',
          'grid-operations.capacityUtilization',
          'grid-operations.netzfahrplanGenerate',
          'finance-agent.analyze',
          'finance-agent.fnavEconomics',
          'investment-planning.createPlan',
          'znp.assessPortfolio',
          'datapoint.health',
          'mastr-quality.audit',
          'edm-validation.validate',
          'vdmi.dossier',
        ],
        notCalled: [
          'hitl.create',
          'vdmi.mutate',
          'investment-planning.createPlan',
          'finance-agent.mutate',
          'budget.release',
          'settlement.prepareBilling',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        gateStatus,
        readinessScore,
        complianceScore,
        complianceContext,
        complianceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  normalizeConfidenceScore(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    if (n > 1) return Math.max(0, Math.min(1, n / 100));
    return Math.max(0, Math.min(1, n));
  },

  requiresOperatorConfirmation(params) {
    const text =
      `${params.domain || ''} ${params.query || ''} ${params.sourceAction || ''}`.toLowerCase();
    return /grid|netz|vnb|dso|anschluss|kapazitaet|kapazität|redispatch|marktkommunikation/.test(
      text
    );
  },

  extractRagEvidenceItems(ragRes) {
    const raw =
      ragRes?.results ||
      ragRes?.items ||
      ragRes?.chunks ||
      ragRes?.documents ||
      ragRes?.sources ||
      [];
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 10).map((item) => ({
      sourceId: item.sourceId || item.id || item.documentId || null,
      sourceVersion: item.sourceVersion || item.version || null,
      collection: item.collection || item.collectionId || item.datasourceId || null,
      title: item.title || item.name || item.label || null,
      confidence: this.normalizeConfidenceScore(item.score ?? item.confidence ?? 0.55),
    }));
  },

  buildEvidenceSourceClassBreakdown({ params, ragItems, datapointRes, vdmiRes }) {
    const classes = {
      authoritative_registry: 0,
      internal_process_evidence: 0,
      rag_chunk: 0,
      datapoint_health: 0,
      user_or_prompt_hint: 0,
    };
    if (params.datasourceId || params.datapointId || params.networkOperatorConfirmed) {
      classes.authoritative_registry += params.networkOperatorConfirmed ? 1 : 0;
    }
    if (Array.isArray(vdmiRes?.findings) && vdmiRes.findings.length > 0) {
      classes.internal_process_evidence += vdmiRes.findings.length;
    }
    if (ragItems.length > 0) classes.rag_chunk += ragItems.length;
    if (datapointRes?.overview || params.datapointId) classes.datapoint_health += 1;
    if (params.query) classes.user_or_prompt_hint += 1;
    return classes;
  },

  buildEvidenceGroundingMissingEvidence({
    params,
    hasScope,
    hasDomainContext,
    toolFailures,
    ragItems,
  }) {
    const missing = [];
    const add = (missingDataPoint, enablesDossierAddition, category, severity = 'medium') => {
      missing.push({ missingDataPoint, enablesDossierAddition, category, severity });
    };
    if (!hasDomainContext) {
      add(
        'domain_or_capability_context',
        'Die Antwort kann einem Fachkontext oder einer Capability eindeutig zugeordnet werden',
        'routing',
        'high'
      );
    }
    if (!hasScope) {
      add(
        'scope_filter_grid_area',
        'Die Antwort kann auf Netzgebiet, Datenquelle oder Datenpunkt begrenzt werden',
        'scope',
        'high'
      );
    }
    if (this.requiresOperatorConfirmation(params) && !params.networkOperatorConfirmed) {
      add(
        'network_operator_confirmation',
        'Netzbetreiberbestaetigte Evidenz kann von Vorpruefung oder Annahme getrennt werden',
        'confirmation',
        'high'
      );
    }
    if (!params.datasourceId && !params.datapointId && ragItems.length === 0) {
      add(
        'claim_source_ref',
        'Claims koennen mit Datenpunkt, Receipt, RAG-Chunk oder ausgefuehrter Action belegt werden',
        'source',
        'medium'
      );
    }
    if (toolFailures.length > 0) {
      add(
        'tool_failure_status',
        'Degradierte Tools koennen als Confidence-Abzug und Wiederholvoraussetzung sichtbar werden',
        'tooling',
        'medium'
      );
    }
    return missing;
  },

  deriveEvidenceGroundingAnswerStatus({
    params,
    hasScope,
    hasDomainContext,
    toolFailures,
    requiresNetworkOperatorConfirmation,
  }) {
    if (toolFailures.length > 0) return 'tool_degraded';
    if (!hasDomainContext) return 'needs_clarification';
    if (!hasScope) return 'out_of_scope';
    const query = String(params.query || '').toLowerCase();
    if (/hypothetisch|szenario|scenario|annahme|was waere wenn/.test(query)) {
      return 'hypothetical_scenario';
    }
    if (requiresNetworkOperatorConfirmation) return 'requires_operator_confirmation';
    return 'ok';
  },

  deriveEvidenceConfidenceScore({
    answerStatus,
    hasScope,
    requiresNetworkOperatorConfirmation,
    sourceClassBreakdown,
    toolFailures,
  }) {
    if (toolFailures.length > 0) return 0.25;
    if (answerStatus === 'needs_clarification') return 0.35;
    if (!hasScope || answerStatus === 'out_of_scope') return 0.4;
    if (requiresNetworkOperatorConfirmation) return 0.45;
    let score = 0.55;
    if ((sourceClassBreakdown.authoritative_registry || 0) > 0) score += 0.18;
    if ((sourceClassBreakdown.datapoint_health || 0) > 0) score += 0.08;
    if ((sourceClassBreakdown.internal_process_evidence || 0) > 0) score += 0.06;
    if ((sourceClassBreakdown.rag_chunk || 0) > 0) score += 0.05;
    if (answerStatus === 'hypothetical_scenario') score = Math.min(score, 0.62);
    return Math.round(Math.min(0.9, score) * 100) / 100;
  },
};
