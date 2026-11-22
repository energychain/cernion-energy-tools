'use strict';

/**
 * Registry of the domain packs (micro-agent tier, Phase 0). Packs announce themselves through
 * the metadata of their Moleculer service (`metadata.microAgent`, set by the pack mixin); the
 * registry links each pack to the functions of the function model whose domains or services it
 * names. No pack list is hard-coded here.
 */

const { getFunctionModel } = require('../function-model');

function packServices(broker) {
  const services = broker?.registry?.getServiceList
    ? broker.registry.getServiceList({
        onlyAvailable: true,
        skipInternal: true,
        withActions: false,
      })
    : [];
  const seen = new Set();
  return services
    .filter((service) => service?.metadata?.microAgent?.pack)
    .filter((service) => {
      if (seen.has(service.name)) return false;
      seen.add(service.name);
      return true;
    })
    .map((service) => ({ service: service.name, ...service.metadata.microAgent }));
}

// Function ids per pack: functions whose domains or services the pack names.
function linkFunctions(packs, model = getFunctionModel()) {
  const functions = Array.isArray(model?.functions) ? model.functions : [];
  return packs.map((pack) => {
    const domains = new Set(pack.functionDomains || []);
    const services = new Set(pack.functionServices || []);
    const functionIds = functions
      .filter(
        (fn) =>
          (fn.domains || []).some((domain) => domains.has(domain)) ||
          (fn.services || []).some((service) => services.has(service))
      )
      .map((fn) => fn.functionId);
    return { ...pack, functionIds };
  });
}

function discoverPacks(broker, { model } = {}) {
  return linkFunctions(packServices(broker), model);
}

// Which packs expand an object kind (declared expanders, the concern handled separately).
function packsForKind(packs, kind) {
  return packs.filter((pack) => (pack.expands || []).includes(kind));
}

module.exports = { discoverPacks, linkFunctions, packServices, packsForKind };
