'use strict';

const { getFunctionModel } = require('../../src/function-model');
const regressions = [
  ['Was macht CET gerade beim Netzanschluss?', 'fn-anschlusskapazitaet-evidence-queue'],
  ['Woran arbeitest du beim Redispatch?', 'fn-redispatch-asset-register'],
  ['Kümmerst du dich um Energy Sharing?', 'fn-energy-sharing-collective-approval'],
  ['Was passiert gerade mit der Bilanzkreis-Bewirtschaftung?', 'fn-bilanzkreis-slp-edm-operations'],
  ['Was macht die Investitionsplanung?', 'fn-finance-nkp-capex-reinvest-governance'],
  ['Was macht eigentlich die Zielnetzplanung gerade?', 'fn-znp-portfolio-assessment'],
  ['Welche Agents laufen gerade?', null],
];
const patterns = [
  (x) => `Woran arbeitest du bei ${x}?`,
  (x) => `Kümmerst du dich um ${x}?`,
  (x) => `Was passiert gerade mit ${x}?`,
  (x) => `Was macht CET bei ${x}?`,
  (x) => `Was macht die ${x}?`,
  (x) => `Was macht eigentlich die ${x} gerade?`,
  (x) => `What are you working on with ${x}?`,
  (x) => `Are you working on ${x}?`,
  (x) => `What is ${x} doing right now?`,
  (x) => `Woran arbeitet CET momentan bei ${x}?`,
];
function corpus() {
  const functions = getFunctionModel().functions;
  const rows = [];
  let seed = 721;
  for (let i = 0; i < 60; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const fn = functions[seed % functions.length];
    const descriptions = [fn.label, ...(fn.domains || []), ...(fn.departments || [])];
    const x = descriptions[i % descriptions.length];
    for (const pattern of patterns) rows.push([pattern(x), fn.functionId]);
  }
  return rows;
}
module.exports = { corpus, regressions };
