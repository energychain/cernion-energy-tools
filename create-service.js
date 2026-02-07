#!/usr/bin/env node

/**
 * Service Creation Tool
 *
 * This tool creates or updates microservices based on the skeleton template.
 * It uses Gemini to generate a service that can orchestrate existing services
 * based on a business case and defined inputs/outputs.
 *
 * Usage:
 *   npm run create -- <service-name>
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');
const { spawnSync } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const MAX_ATTEMPTS = 3;
const TEST_FIX_ATTEMPTS = 2;
const CORE_SERVICES_DIR = path.join(__dirname, 'services');
const CUSTOM_SERVICES_DIR = path.join(__dirname, 'custom-services');
const CORE_TESTS_DIR = path.join(__dirname, 'tests');
const CUSTOM_TESTS_DIR = path.join(__dirname, 'custom-tests');
const CUSTOM_FIXTURES_DIR = path.join(CUSTOM_TESTS_DIR, 'fixtures');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve((answer || '').trim()));
  });
}

async function questionJson(prompt) {
  const raw = await question(prompt);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('Invalid JSON input');
  }
}

function sanitizeServiceName(input) {
  return (input || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
}

function loadSkeletonTemplate() {
  const templatePath = path.join(__dirname, 'templates', 'skeleton.service.js');
  if (!fs.existsSync(templatePath)) {
    throw new Error('Skeleton template not found');
  }
  return fs.readFileSync(templatePath, 'utf-8');
}

function loadServiceCatalog() {
  const serviceDirs = [CORE_SERVICES_DIR, CUSTOM_SERVICES_DIR];
  const files = serviceDirs
    .filter((dir) => fs.existsSync(dir))
    .flatMap((dir) =>
      fs.readdirSync(dir).filter((file) => file.endsWith('.service.js')).map((file) => ({
        dir,
        file,
      }))
    );

  return files
    .map((entry) => {
      const servicePath = path.join(entry.dir, entry.file);
      try {
        delete require.cache[require.resolve(servicePath)];
        const service = require(servicePath);
        const actions = service.actions || {};
        const actionList = Object.keys(actions).map((actionName) => {
          const action = actions[actionName] || {};
          return {
            name: actionName,
            rest: action.rest || null,
            params: action.params || null,
            openapi: action.openapi || null,
          };
        });

        return {
          name: service.name,
          version: service.version || null,
          file: entry.file,
          folder: path.basename(entry.dir),
          actions: actionList,
        };
      } catch (error) {
        return {
          name: null,
          version: null,
          file: entry.file,
          folder: path.basename(entry.dir),
          error: error.message,
        };
      }
    })
    .filter((service) => service.name);
}

function buildPrompt({
  serviceName,
  businessCase,
  inputData,
  outputData,
  skeletonTemplate,
  serviceCatalog,
  existingServiceCode,
  updateRequest,
}) {
  const catalogText = JSON.stringify(serviceCatalog, null, 2);
  return `You are an expert Moleculer service generator.

Requirements:
- Create a service named "${serviceName}".
- Do not set a service version unless explicitly requested.
- Follow the skeleton style and 2-space indentation.
- Use CommonJS and module.exports.
- The service should orchestrate existing services using ctx.call when needed.
- Validate inputs with Moleculer params.
- Provide OpenAPI documentation in action.openapi.
- Be resilient to MCP response shapes; handle both result.data.* and top-level fields (e.g., forecast arrays).

Business Case:
${businessCase}

Available Input Data:
${inputData}

Expected Output Data:
${outputData}

Existing Services Catalog (from OpenAPI):
${catalogText}

Skeleton Template (for reference):
${skeletonTemplate}

${existingServiceCode ? `Existing Service Code:\n${existingServiceCode}` : ''}
${updateRequest ? `Update Request:\n${updateRequest}` : ''}

Return ONLY a valid JSON object with keys:
- "serviceCode": full JS content for services/${serviceName}.service.js
- "testCode": full JS content for tests/${serviceName}.service.test.js
- "summary": short summary of actions and service calls

Do not wrap the JSON in Markdown.`;
}

function fetchAvailableModels(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.models || []);
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
}

function toShortModelName(name) {
  return (name || '').replace(/^models\//, '');
}

function pickFallbackModel(models) {
  const preferred = ['gemini-pro-latest', 'gemini-2.5-pro', 'gemini-2.5-flash'];
  const available = new Set(models.map((model) => toShortModelName(model.name)));
  const match = preferred.find((name) => available.has(name));
  return match || (models[0] ? toShortModelName(models[0].name) : 'gemini-pro-latest');
}

async function resolveModelName(requestedName, apiKey) {
  const aliasMap = {
    'gemini-3.0-pro': 'gemini-3-pro-preview',
    'gemini-3.0-flash': 'gemini-3-flash-preview',
  };

  try {
    const models = await fetchAvailableModels(apiKey);
    const available = new Set(models.map((model) => toShortModelName(model.name)));
    const requestedShort = toShortModelName(requestedName);

    if (requestedShort && available.has(requestedShort)) {
      return { modelName: requestedShort, reason: 'requested' };
    }

    const alias = aliasMap[requestedShort];
    if (alias && available.has(alias)) {
      return { modelName: alias, reason: `alias:${requestedShort}` };
    }

    return { modelName: pickFallbackModel(models), reason: 'fallback' };
  } catch (error) {
    return { modelName: requestedName || 'gemini-pro-latest', reason: 'unverified' };
  }
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const requestedModel = process.env.GEMINI_MODEL || 'gemini-pro-latest';
  const { modelName, reason } = await resolveModelName(requestedModel, apiKey);
  if (reason !== 'requested') {
    console.warn(`⚠️  Using model: ${modelName} (reason: ${reason})`);
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text();
}

function parseGeminiResponse(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Invalid JSON response from Gemini');
  }

  const jsonText = text.slice(start, end + 1);
  const parsed = JSON.parse(jsonText);

  if (!parsed.serviceCode || typeof parsed.serviceCode !== 'string') {
    throw new Error('Gemini response missing serviceCode');
  }

  return parsed;
}

function validateServiceCode(serviceCode, serviceName) {
  const errors = [];
  if (!serviceCode.includes('module.exports')) {
    errors.push('Missing module.exports');
  }
  if (
    !serviceCode.includes(`name: '${serviceName}'`) &&
    !serviceCode.includes(`name: "${serviceName}"`)
  ) {
    errors.push('Missing or incorrect service name');
  }
  if (!serviceCode.includes('actions')) {
    errors.push('Missing actions section');
  }
  if (serviceCode.includes('version:')) {
    errors.push('Remove service version to avoid v1 routing');
  }
  if (!serviceCode.includes('ctx.call')) {
    errors.push('Missing ctx.call usage to orchestrate existing services');
  }
  if (!serviceCode.includes('openapi:')) {
    errors.push('Missing openapi definitions for actions');
  }
  return errors;
}

function buildTestCode(serviceName, serviceModule, serviceFolder) {
  const dependencies = Array.isArray(serviceModule?.dependencies)
    ? serviceModule.dependencies
    : [];
  const dependencySetup = dependencies
    .map((dependency) => `    broker.createService({ name: '${dependency}', actions: {} });`)
    .join('\n');
  const actionNames = serviceModule?.actions ? Object.keys(serviceModule.actions) : [];
  const actionAssertions = actionNames
    .map((actionName) => `    expect(service.actions.${actionName}).toBeDefined();`)
    .join('\n');

  return `/**
 * ${capitalize(serviceName)} Service Tests
 */

const { ServiceBroker } = require('moleculer');
const Service = require('../${serviceFolder}/${serviceName}.service');

describe('${capitalize(serviceName)} Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({
      logger: false,
      transporter: null,
    });
${dependencySetup || '    // No dependencies to mock'}
    broker.createService(Service);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('should have correct service name', () => {
    expect(Service.name).toBe('${serviceName}');
  });

  it('should expose actions', () => {
    const service = broker.getLocalService('${serviceName}');
${actionAssertions || '    expect(Object.keys(service.actions).length).toBeGreaterThan(0);'}
  });
});
`;
}

function buildIntegrationTestCode(serviceName, actionName, params) {
  return `/**
 * ${capitalize(serviceName)} Integration Test (live MCP)
 */

const path = require('path');
const { ServiceBroker } = require('moleculer');

describe('${capitalize(serviceName)} Integration', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({
      logger: false,
      transporter: null,
    });
    broker.loadServices(path.join(__dirname, '..', 'services'));
    broker.loadServices(path.join(__dirname, '..', 'custom-services'));
    await broker.start();
  }, 60000);

  afterAll(async () => {
    await broker.stop();
  });

  it('should return data from live MCP', async () => {
    const response = await broker.call('${serviceName}.${actionName}', ${JSON.stringify(
      params,
      null,
      2
    )});

    if (Array.isArray(response)) {
      expect(response.length).toBeGreaterThan(0);
      expect(response[0]).toHaveProperty('gCO2eqPerKWh');
    } else {
      expect(response).toBeTruthy();
    }
  }, 60000);
});
`;
}

function runServiceTest(testFilePath) {
  const jestBin = path.join(__dirname, 'node_modules', '.bin', 'jest');
  const args = ['--runTestsByPath', testFilePath, '--coverage=false'];
  const result = spawnSync(jestBin, args, {
    encoding: 'utf-8',
    env: {
      ...process.env,
    },
  });

  return {
    success: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function truncateLog(text, maxLength = 4000) {
  if (!text || text.length <= maxLength) {
    return text || '';
  }
  return `${text.slice(0, maxLength)}\n... [truncated]`;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function capitalize(str) {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

async function generateService({
  serviceName,
  businessCase,
  inputData,
  outputData,
  skeletonTemplate,
  serviceCatalog,
  existingServiceCode,
  updateRequest,
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`\n🧠 Planning draft (attempt ${attempt}/${MAX_ATTEMPTS})...`);
      const prompt = buildPrompt({
        serviceName,
        businessCase,
        inputData,
        outputData,
        skeletonTemplate,
        serviceCatalog,
        existingServiceCode,
        updateRequest,
      });

      console.log('🤖 Calling Gemini to generate service...');
      const responseText = await callGemini(prompt);
      console.log('🧪 Validating generated service...');
      const parsed = parseGeminiResponse(responseText);

      const validationErrors = validateServiceCode(parsed.serviceCode, serviceName);
      if (validationErrors.length > 0) {
        console.log(`⚠️  Draft validation failed: ${validationErrors.join(', ')}`);
        lastError = new Error(`Validation failed: ${validationErrors.join(', ')}`);
        updateRequest = `Fix the following issues: ${validationErrors.join(', ')}.`;
        existingServiceCode = parsed.serviceCode;
        continue;
      }

      console.log('✅ Draft validation passed.');
      return parsed;
    } catch (error) {
      console.log(`⚠️  Draft generation error: ${error.message}`);
      lastError = error;
    }
  }

  throw lastError || new Error('Failed to generate service');
}

async function main() {
  console.log('🔨 Cernion Energy Tools - Service Creator\n');

  let serviceName = sanitizeServiceName(process.argv[2]);
  if (!serviceName) {
    serviceName = sanitizeServiceName(await question('Enter service name (e.g., energy-data): '));
  }

  if (!serviceName) {
    console.error('❌ Service name is required');
    process.exit(1);
  }

  const serviceFileName = `${serviceName}.service.js`;
  ensureDir(CUSTOM_SERVICES_DIR);
  ensureDir(CUSTOM_TESTS_DIR);
  ensureDir(CUSTOM_FIXTURES_DIR);

  const serviceFilePath = path.join(CUSTOM_SERVICES_DIR, serviceFileName);
  const serviceExists = fs.existsSync(serviceFilePath);

  if (serviceExists) {
    const updateAnswer = await question(
      `Service ${serviceFileName} already exists. Update it? (y/N): `
    );
    if (!['y', 'yes'].includes(updateAnswer.toLowerCase())) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  const businessCase = await question('Describe the business case: ');
  const inputData = await question('Available input data (short description): ');
  const outputData = await question('Expected output data (short description): ');

  if (!businessCase) {
    console.error('❌ Business case is required');
    process.exit(1);
  }

  const skeletonTemplate = loadSkeletonTemplate();
  console.log('📚 Loading existing service catalog...');
  const serviceCatalog = loadServiceCatalog();
  console.log(`📦 Loaded ${serviceCatalog.length} services from catalog.`);
  let currentServiceCode = serviceExists ? fs.readFileSync(serviceFilePath, 'utf-8') : '';

  let updateRequest = '';
  let generated;

  while (true) {
    generated = await generateService({
      serviceName,
      businessCase,
      inputData,
      outputData,
      skeletonTemplate,
      serviceCatalog,
      existingServiceCode: currentServiceCode,
      updateRequest,
    });

    console.log('\n✅ Draft generated. Summary:');
    console.log(generated.summary || 'No summary provided.');

    const accept = await question('Accept this draft? (y/N/update): ');
    const acceptNormalized = accept.toLowerCase();
    if (['y', 'yes'].includes(acceptNormalized)) {
      break;
    }

    updateRequest = await question('Describe the update you want: ');
    if (!updateRequest) {
      console.log('No update provided. Aborting.');
      process.exit(0);
    }
    currentServiceCode = generated.serviceCode;
  }

  const integrationAnswer = await question(
    'Generate live MCP integration test using real data? (y/N): '
  );
  let integrationTestPath = null;
  if (['y', 'yes'].includes(integrationAnswer.toLowerCase())) {
    const actionName = await question('Action name to test (e.g., forecast): ');
    if (!actionName) {
      console.log('No action provided. Skipping integration test.');
    } else {
      const params = await questionJson('Action params JSON (e.g., {"plz":"10115"}): ');
      if (!params) {
        console.log('No params provided. Skipping integration test.');
      } else {
        const fixturePath = path.join(
          CUSTOM_FIXTURES_DIR,
          `${serviceName}.${actionName}.input.json`
        );
        fs.writeFileSync(fixturePath, JSON.stringify(params, null, 2));

        const integrationTestCode = buildIntegrationTestCode(serviceName, actionName, params);
        integrationTestPath = path.join(
          CUSTOM_TESTS_DIR,
          `${serviceName}.integration.test.js`
        );
        fs.writeFileSync(integrationTestPath, integrationTestCode);
        console.log(`✅ Integration test added: ${integrationTestPath}`);
      }
    }
  }

  fs.writeFileSync(serviceFilePath, generated.serviceCode);

  let testCode = generated.testCode;
  try {
    delete require.cache[require.resolve(serviceFilePath)];
    const serviceModule = require(serviceFilePath);
    testCode = buildTestCode(serviceName, serviceModule, path.basename(CUSTOM_SERVICES_DIR));
  } catch (error) {
    if (!testCode || typeof testCode !== 'string') {
      testCode = buildTestCode(serviceName, null, path.basename(CUSTOM_SERVICES_DIR));
    }
  }

  const testFilePath = path.join(CUSTOM_TESTS_DIR, `${serviceName}.service.test.js`);
  fs.writeFileSync(testFilePath, testCode);

  let testAttempt = 1;
  while (testAttempt <= TEST_FIX_ATTEMPTS) {
    console.log(`\n🧪 Running tests (attempt ${testAttempt}/${TEST_FIX_ATTEMPTS})...`);
    const testResult = runServiceTest(testFilePath);
    if (testResult.success) {
      console.log('✅ Tests passed.');
      if (integrationTestPath) {
        console.log('🧪 Running integration test...');
        const integrationResult = runServiceTest(integrationTestPath);
        if (!integrationResult.success) {
          console.log('⚠️  Integration test failed.');
          console.log(truncateLog(`${integrationResult.stdout}\n${integrationResult.stderr}`));
        } else {
          console.log('✅ Integration test passed.');
        }
      }
      break;
    }

    const combinedOutput = `${testResult.stdout}\n${testResult.stderr}`.trim();
    console.log('⚠️  Tests failed. Attempting to auto-fix...');

    const fixRequest = `Fix failing tests. Test output:\n${truncateLog(combinedOutput)}`;
    const fixed = await generateService({
      serviceName,
      businessCase,
      inputData,
      outputData,
      skeletonTemplate,
      serviceCatalog,
      existingServiceCode: fs.readFileSync(serviceFilePath, 'utf-8'),
      updateRequest: fixRequest,
    });

    fs.writeFileSync(serviceFilePath, fixed.serviceCode);

    let updatedTestCode = fixed.testCode;
    try {
      delete require.cache[require.resolve(serviceFilePath)];
      const serviceModule = require(serviceFilePath);
      updatedTestCode = buildTestCode(serviceName, serviceModule, path.basename(CUSTOM_SERVICES_DIR));
    } catch (error) {
      if (!updatedTestCode || typeof updatedTestCode !== 'string') {
        updatedTestCode = buildTestCode(serviceName, null, path.basename(CUSTOM_SERVICES_DIR));
      }
    }

    fs.writeFileSync(testFilePath, updatedTestCode);
    testAttempt += 1;
  }

  console.log(`\n✅ Service saved: ${serviceFilePath}`);
  console.log(`✅ Test added: ${testFilePath}`);
  console.log('\nNext steps:');
  console.log('1. Review the generated service and test');
  console.log('2. Start services: npm start');
  console.log(`3. Run tests: npm run test:custom -- ${serviceName}.service.test.js`);

  rl.close();
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
