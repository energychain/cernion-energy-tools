'use strict';
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { gzipSync, gunzipSync } = require('zlib');
const { prepareDataset, EvaluationError } = require('./forecast-evaluation');
const hash = (data) => createHash('sha256').update(data).digest('hex');
function portfolioDirectory(meta = {}) {
  return path.join(
    process.env.FORECAST_PORTFOLIO_DATA_PATH || path.join(__dirname, '../data/forecast-portfolio'),
    hash(String(meta.tenantId || 'sandbox'))
  );
}
function savePortfolioDataset(dataset, meta) {
  const prepared = prepareDataset(dataset);
  if (prepared.validation.validation_status === 'fail' || prepared.rows.some((r) => r.value < 0))
    throw new EvaluationError(
      'validation_failed',
      'Portfolio requires valid nonnegative PT15M measurements.'
    );
  const bytes = Buffer.from(JSON.stringify(dataset));
  const id = hash(bytes);
  const dir = portfolioDirectory(meta);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(path.join(dir, `${id}.json.gz`), gzipSync(bytes), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return {
    status: 'data_validated',
    dataset_id: id,
    series_id: dataset.series_id,
    validation: prepared.validation,
  };
}
function loadPortfolioDatasets(ids, meta) {
  if (
    !Array.isArray(ids) ||
    ids.length < 2 ||
    ids.length > 16 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !/^[a-f0-9]{64}$/.test(id))
  )
    throw new EvaluationError('validation_failed', 'Supply 2–16 distinct dataset_ids.');
  return ids.map((id) => {
    try {
      const bytes = gunzipSync(
        fs.readFileSync(path.join(portfolioDirectory(meta), `${id}.json.gz`))
      );
      if (hash(bytes) !== id) throw new Error('digest');
      return JSON.parse(bytes);
    } catch {
      throw new EvaluationError(
        'dataset_not_found',
        'Portfolio dataset unavailable for this tenant.'
      );
    }
  });
}
module.exports = { savePortfolioDataset, loadPortfolioDatasets };
