'use strict';

const fs = require('node:fs');
const catalog = require('./workbench-knowledge-sources.json');
const { scrubPromptText } = require('./prompt-scrubber');
const { ACTIVITIES } = require('./workbench-activity-taxonomy');
const { CURATED_CAPABILITIES } = require('./capability-catalog');
const publicWords = new Set(
  JSON.stringify([ACTIVITIES, CURATED_CAPABILITIES])
    .toLocaleLowerCase()
    .match(/[\p{L}]+/gu) || []
);

function knowledgeSourceAccess(ctx, sources = catalog.sources) {
  const tenantId =
    ctx.meta?.apiToken?.tenantId || ctx.meta?.authUser?.tenantId || ctx.meta?.tenantId;
  const file = process.env.CERNION_TENANT_REGISTRY_FILE || './uploads/.api-tenants.json';
  let settings = {};
  try {
    if (fs.existsSync(file)) {
      const tenants = JSON.parse(fs.readFileSync(file, 'utf8'));
      settings = tenants.find((tenant) => tenant.tenantId === tenantId)?.knowledgeSources || {};
    }
  } catch (_error) {
    return Object.fromEntries(
      sources.filter((source) => source.tenantSetting).map((source) => [source.id, false])
    );
  }
  return Object.fromEntries(
    sources
      .filter((source) => source.tenantSetting)
      .map((source) => [
        source.id,
        settings[source.tenantSetting] === undefined || settings[source.tenantSetting] === 'on',
      ])
  );
}

function knowledgeSearchText(situation = {}, question = '') {
  let query = [situation.concern || question, ...(situation.retrievalTerms || [])].join(' ');
  // Remove local identifiers before the shared free-text PII scrubber.
  for (const entry of situation.identifiers || []) {
    if (!/^(?:process|prozess|message|nachricht)(?:typ|type|code)?$/i.test(entry.kind || '')) {
      if (entry.value) query = query.split(entry.value).join(' ');
    }
  }
  query = scrubPromptText(query)
    .replace(/(?<!\d)\d{11,}(?!\d)/g, ' ')
    .replace(/\bDE\d{20,}\b/gi, ' ')
    .replace(
      /\b[\p{L}.-]*(?:straße|strasse|str\.|weg|gasse|allee|platz)\s*(?:\d+\s*[a-z]?)?/giu,
      ' '
    )
    .replace(/\b\d{5}\s+[\p{Lu}][\p{L}-]+\b/gu, ' ')
    .replace(/\b(?:Herrn?|Frau|Dr\.)\s+[\p{L}.-]+(?:\s+[\p{Lu}][\p{Ll}-]+)*/gu, ' ')
    .replace(
      /(?<!\p{L})(?!(?:Der|Die|Das|Ein|Eine|Welche|Welcher|Unser|Unsere)\b)[\p{Lu}][\p{Ll}][\p{L}\x27-]*\s+[\p{Lu}][\p{Ll}][\p{L}\x27-]*(?!\p{L})/gu,
      (pair) =>
        pair.split(/\s+/).every((word) => publicWords.has(word.toLocaleLowerCase())) ||
        /(?:code|typ|identifikator|nachricht|meldung|wechsel|beginn|prozess)$/i.test(pair)
          ? pair
          : ' '
    )
    .replace(/\[?(?:[A-Z]+-MASKED|MASKED-[\w-]+)\]?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return query.slice(0, 200).trim();
}

module.exports = { knowledgeSourceAccess, knowledgeSearchText };
