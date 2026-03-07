const { ServiceBroker } = require('moleculer');
const { FORMAT_PARAM_SCHEMA } = require('../src/format-response');
const fs = require('fs');
const broker = new ServiceBroker({ logger: false });
fs.readdirSync('../services')
  .filter((f) => f.endsWith('.service.js'))
  .forEach((f) => broker.loadService('../services/' + f));
broker
  .start()
  .then(() => {
    const services = broker.registry.getServiceList({ withActions: true });
    for (const svc of services) {
      if (!svc.actions) continue;
      for (const [aName, action] of Object.entries(svc.actions)) {
        if (!action.params) continue;
        for (const [k, v] of Object.entries(action.params)) {
          if (
            typeof v === 'object' &&
            v !== null &&
            v.values !== undefined &&
            !Array.isArray(v.values)
          ) {
            const valStr =
              typeof v.values === 'function' ? '[Function]' : String(v.values).slice(0, 120);
            console.log('PROBLEM:', svc.name, aName, k, '-> values type:', typeof v.values, valStr);
          }
        }
      }
    }
    console.log('FORMAT_PARAM_SCHEMA.values after load:', FORMAT_PARAM_SCHEMA.values);
    return broker.stop();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
