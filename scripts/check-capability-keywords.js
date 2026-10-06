'use strict';
const { CURATED_CAPABILITIES } = require('../src/capability-catalog');
const { keywordReport } = require('../src/capability-routing');
const threshold = Number(
  process.env.CAPABILITY_KEYWORD_THRESHOLD ||
    require('../capability-routing.parameters.json').commonKeywordThreshold
);
if (!Number.isInteger(threshold) || threshold < 1)
  throw new Error('Threshold must be a positive integer');
const report = keywordReport(CURATED_CAPABILITIES, threshold);
console.log(JSON.stringify({ threshold, affectedCapabilities: report.length, report }, null, 2));
