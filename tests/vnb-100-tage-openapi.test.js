'use strict';

const { ServiceBroker } = require('moleculer');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ApiService = require('../services/api.service');
const Vnb100TageAssessmentService = require('../services/vnb-100-tage-assessment.service');

describe('VNB 100-Tage Assessment OpenAPI contract', () => {
  let broker;
  let dbPath;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `vnb-100-tage-openapi-${Date.now()}`);
    process.env.VNB_100_TAGE_ASSESSMENT_DB_PATH = dbPath;

    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      ...ApiService,
      settings: {
        ...ApiService.settings,
        port: 0,
      },
    });
    broker.createService({
      ...Vnb100TageAssessmentService,
      settings: {
        ...Vnb100TageAssessmentService.settings,
        dbPath,
      },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    delete process.env.VNB_100_TAGE_ASSESSMENT_DB_PATH;
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  it('documents assess request body with object and array field shapes', async () => {
    const openapi = await broker.call('api.openapi');
    const operation = openapi.paths['/api/vnb-100-tage-assessment/assessments'].post;
    const schema = operation.requestBody.content['application/json'].schema;

    expect(operation.requestBody.required).toBe(true);
    expect(schema.required).toEqual(expect.arrayContaining(['gridOperatorId', 'kpiValues']));
    expect(schema.properties.gridOperatorId.type).toBe('string');
    expect(schema.properties.kpiValues.type).toBe('object');
    expect(schema.properties.roiMeasures.type).toBe('array');
    expect(schema.properties.roiMeasures.items.type).toBe('object');
    expect(schema.properties.forbiddenAssumptions.type).toBe('array');
    expect(schema.properties.forbiddenAssumptions.items.type).toBe('string');
    expect(schema.properties.kpiValues.type).not.toBe('string');
    expect(schema.properties.roiMeasures.type).not.toBe('string');
    expect(schema.properties.forbiddenAssumptions.type).not.toBe('string');
  });
});
