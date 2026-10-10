'use strict';
const { parentPort, workerData } = require('worker_threads');
const { runEvaluation } = require('./forecast-evaluation');
try {
  const result = runEvaluation(workerData.payload, (progress) => {
    parentPort.postMessage({ type: 'progress', progress });
  });
  parentPort.postMessage({ type: 'result', result });
} catch (error) {
  parentPort.postMessage({
    type: 'error',
    message: `${error.code || 'forecast_failed'}: ${error.message}`,
  });
}
