/**
 * GeoJSON Connector Plugin
 */

const fs = require('fs');
const path = require('path');

function centroidFromCoordinates(coordinates) {
  const points = [];

  function walk(value) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      points.push([value[0], value[1]]);
      return;
    }
    value.forEach((child) => walk(child));
  }

  walk(coordinates);

  if (!points.length) return { longitude: null, latitude: null };

  const sum = points.reduce(
    (acc, pair) => {
      acc.longitude += pair[0];
      acc.latitude += pair[1];
      return acc;
    },
    { longitude: 0, latitude: 0 }
  );

  return {
    longitude: sum.longitude / points.length,
    latitude: sum.latitude / points.length,
  };
}

function resolvePath(obj, expression) {
  if (!expression) return obj;
  return expression.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), obj);
}

function inferSchema(rows) {
  if (!rows.length) return { fields: [] };
  return {
    fields: Object.keys(rows[0]).map((name) => ({
      name,
      type: typeof rows[0][name] === 'number' ? 'number' : 'string',
      example: rows[0][name],
    })),
  };
}

module.exports = {
  type: 'geojson',
  description: 'Read GeoJSON files and flatten features into row records.',
  configSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string' },
      featureCollection: { type: 'string' },
    },
  },

  async read(connectorConfig, options = {}) {
    const resolvedPath = path.resolve(connectorConfig.path);
    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    const json = JSON.parse(raw);

    const selected = resolvePath(json, connectorConfig.featureCollection);

    let features = [];
    if (Array.isArray(selected)) {
      features = selected;
    } else if (selected && Array.isArray(selected.features)) {
      features = selected.features;
    } else if (json && Array.isArray(json.features)) {
      features = json.features;
    }

    const limit = Number.isInteger(options.limit) ? options.limit : undefined;

    const rows = features.slice(0, limit || features.length).map((feature) => {
      const properties =
        feature?.properties && typeof feature.properties === 'object' ? feature.properties : {};
      const geometryType = feature?.geometry?.type || null;
      const coords = centroidFromCoordinates(feature?.geometry?.coordinates);

      return {
        ...properties,
        geometry_type: geometryType,
        longitude: coords.longitude,
        latitude: coords.latitude,
      };
    });

    return {
      rows,
      inferredSchema: inferSchema(rows),
    };
  },
};
