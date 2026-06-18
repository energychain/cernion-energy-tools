'use strict';

module.exports = {
  intent: 'financier_due_diligence_assessment',
  audience: 'bank_credit_committee',
  preferredFormat: 'auto',
  context: {
    location: 'Frankenthal / Rhein-Neckar',
    assertedGridOperator: 'STROMDAO Netze GmbH',
  },
  domainResult: {
    project: {
      name: 'SpeicherPark Frankenthal GmbH & Co. KG',
      location: 'Frankenthal',
      region: 'Rhein-Neckar',
    },
    asset: {
      type: 'BESS',
      powerMW: 12,
      energyMWh: 24,
    },
    financingRequest: {
      amountEur: 18500000,
      currency: 'EUR',
    },
    decisionStatus: 'decision_blocked_until_evidence',
    expectedStatus: 'conditional_go',
    risks: [
      {
        risk: 'Grid connection risk',
        severity: 'high',
        impact: 'Payout and COD delay',
        mitigation: 'Binding grid confirmation as payout condition',
      },
      {
        risk: 'Revenue volatility risk',
        severity: 'high',
        impact: 'DSCR pressure in downside case',
        mitigation: 'Downside revenue model and covenant buffer',
      },
      {
        risk: 'Regulatory risk',
        severity: 'medium',
        impact: 'Market access and remuneration uncertainty',
        mitigation: 'Regulatory memo and sensitivity cases',
      },
      {
        risk: 'Network operator/process delay risk',
        severity: 'medium',
        impact: 'Schedule slippage',
        mitigation: 'Milestone-linked drawdown schedule',
      },
      {
        risk: 'Technology/degradation risk',
        severity: 'medium',
        impact: 'Lower available capacity over time',
        mitigation: 'Independent technical advisor report',
      },
    ],
    evidenceGaps: [
      { label: 'Binding grid connection confirmation / BKZ', reason: 'not yet provided' },
      { label: 'Battery degradation report', reason: 'independent report missing' },
      { label: 'FCR/prequalification evidence', reason: 'claim not evidenced' },
      { label: 'Insurance evidence (all-risk / BI)', reason: 'policy schedule missing' },
      { label: 'Shareholder/SPV structure evidence', reason: 'KYC/legal pack incomplete' },
    ],
    evidenceRequirements: [
      { label: 'Grid confirmation as payout condition' },
      { label: 'DSCR downside case and covenant plan' },
      { label: 'Technical advisor review package' },
      { label: 'Insurance and KYC evidence package' },
    ],
    forbiddenAssumptions: [
      'Do not treat grid connection as secured without binding confirmation',
      'Do not treat Redispatch/FCR revenues as guaranteed without contract or market evidence',
      'Do not treat user-provided project data as independently verified',
    ],
    nextActions: [
      {
        id: 'dd-1',
        type: 'payout_condition',
        label: 'Grid connection confirmation as payout condition',
      },
      { id: 'dd-2', type: 'financial_model', label: 'Require DSCR downside revenue case' },
      { id: 'dd-3', type: 'technical_dd', label: 'Require independent technical advisor review' },
      {
        id: 'dd-4',
        type: 'insurance_kyc',
        label: 'Require insurance and shareholder/KYC evidence',
      },
    ],
    warnings: [
      'fixture_unverified_user_assertions',
      'fixture_assumed_grid_operator_not_independently_verified',
    ],
  },
};
