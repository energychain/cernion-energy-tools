'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const {
  VERSION: HYBRID_VERSION,
  EXTENDED_VERSION,
  ADAPTIVE_VERSION,
  LEGACY_CONTEXT_VERSION,
} = require('./forecast-hybrid-state-model');
const { hash, VERSION } = require('./forecast-state-model');

// Immutable content-addressed versions, isolated by trusted gateway tenant metadata.
function createStateStore(
  root = process.env.FORECAST_STATE_MODEL_DIR || path.resolve('data/forecast-state-models')
) {
  function location(tenant, series, version) {
    if (!/^[a-f0-9]{64}$/.test(version)) throw new Error('Invalid model version ID.');
    return path.join(root, hash(String(tenant)), hash(String(series)), `${version}.json`);
  }
  return {
    save(tenant, artifact) {
      const envelope = { schema_version: 1, ...artifact };
      const version = hash(envelope);
      const target = location(tenant, artifact.series_id, version);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      const temporary = `${target}.${randomUUID()}.partial`;
      try {
        fs.writeFileSync(temporary, JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, target);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
      return {
        series_id: artifact.series_id,
        artifact_version: version,
        model_version: artifact.model.version,
        training_data_until: [
          artifact.model.training_data_until,
          artifact.model.reference_training_data_until,
        ]
          .filter(Boolean)
          .sort()
          .at(-1),
        state_training_data_until: artifact.model.training_data_until,
        reference_training_data_until: artifact.model.reference_training_data_until,
        context_as_of: artifact.context_as_of,
        state_features_enabled: artifact.model.state_features_enabled,
      };
    },
    load(tenant, series, version) {
      const artifact = JSON.parse(fs.readFileSync(location(tenant, series, version), 'utf8'));
      if (
        hash(artifact) !== version ||
        artifact.schema_version !== 1 ||
        ![
          VERSION,
          HYBRID_VERSION,
          EXTENDED_VERSION,
          ADAPTIVE_VERSION,
          LEGACY_CONTEXT_VERSION,
        ].includes(artifact.model.version) ||
        artifact.series_id !== series
      )
        throw new Error('Model artifact integrity/version mismatch.');
      return artifact;
    },
  };
}
module.exports = { createStateStore };
