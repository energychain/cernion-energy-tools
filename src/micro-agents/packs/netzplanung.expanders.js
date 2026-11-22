'use strict';

/**
 * Expanders of the netzplanung pack (micro-agent tier, Phase 1): Zielnetzplanung,
 * Netzanschluss, Engpässe, MaStR units, Gasnetz/Wärmeplanung.
 *
 * Every call is a read action of an existing service (operation-capability-index.json:
 * operationKind data_read, writesTo [], sideEffects []; implementation checked):
 * - osm-geo.validate (skipOsmLayer), osm-geo.substationFinder – MCP read tools (MaStR/VNBdigital/OSM);
 * - municipality.lookup – offline Destatis GV100 lookup;
 * - znp.listProjects, znp.getProjectAssets – tenant-scoped reads of the ZNP graphs;
 * - agnes-bottleneck.list, gasnetz-waermeplanung.list – tenant-scoped stored assessments;
 * - vnb-monitor.snapshot – public EWK/MaStR KPIs of a grid operator (in-memory cache only).
 * Not used: write/process actions (znp layers, grid-connection.validate, mastr-quality.audit,
 * agnes-bottleneck.assess, …) and stores without tenant filter (grid-connection.list,
 * mastr-quality.list, mastr-monitor watches), so no other tenant's reports reach the answer.
 *
 * No model call: every fact is a service value or a format parse of the person's text.
 */

const { registerUnitNumbers, marketPartnerCodes, tokens } = require('./detectors');

const CALL_TIMEOUT_MS = 3000;
const MIN_CALL_MS = 200;
// Below the mixin's default budget (4000 ms), so the expander returns what it has in time.
const EXPAND_BUDGET_MS = 3500;
const MAX_PROJECTS = 5;
const ASSET_PAGE = 1000;
const MAX_ASSET_PAGES = 2;
const LIST_LIMIT = 50;
const OVERVIEW_LIMIT = 3;
const NODE_PREFIX = 'grid.node:';

// Capacity units of a connection request and their factor to kW.
const CAPACITY_UNITS = { kW: 1, kWp: 1, kVA: 1, MW: 1000, MWp: 1000, MVA: 1000 };
// Voltage level codes as the OSM layer filters them (NS, MS, HS, EHS); HöS is the German code of EHS.
const VOLTAGE_CODES = { NS: 'NS', MS: 'MS', HS: 'HS', EHS: 'EHS', HöS: 'EHS' };

const isDigit = (ch) => ch >= '0' && ch <= '9';
const allDigits = (value) => value.length > 0 && [...value].every(isDigit);
const lower = (value) => String(value ?? '').toLowerCase();
const present = (value) => value !== undefined && value !== null && value !== '';
const unique = (values) => [...new Set(values)];

// ─── Read calls ──────────────────────────────────────────────────────────────

// One bounded read; a timeout or error is a result, never a thrown error. The tenant of the
// turn travels in the call meta, so tenant-scoped services filter by it.
async function read(ctx, action, params, context = {}) {
  // Every read ends before the expander's own budget, so partial results survive a slow source.
  const left = context.deadline ? context.deadline - Date.now() : CALL_TIMEOUT_MS;
  if (left < MIN_CALL_MS) return { ok: false, error: 'budget_exhausted' };
  const opts = { timeout: Math.min(CALL_TIMEOUT_MS, left) };
  if (context.tenantId && !ctx.meta?.tenantId) opts.meta = { tenantId: context.tenantId };
  try {
    return { ok: true, data: await ctx.call(action, params, opts) };
  } catch (error) {
    return { ok: false, error: error?.message || 'error' };
  }
}

const unavailable = (searched, scope) => ({ searched, scope, result: 'source_unavailable' });

// ─── Format parsing (no word lists) ──────────────────────────────────────────

function parseNumber(raw) {
  const value = String(raw);
  if (!value || ![...value].every((ch) => isDigit(ch) || ch === ',' || ch === '.')) return null;
  let normalized = value;
  if (value.includes(',')) normalized = value.split('.').join('').replace(',', '.');
  else if (value.includes('.') && value.split('.').pop().length === 3)
    normalized = value.split('.').join('');
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// "750 kW", "1,5 MW", "630kVA": number and unit, as written.
function capacities(text) {
  const parts = tokens(text);
  const rows = [];
  for (let index = 0; index < parts.length; index++) {
    const token = parts[index];
    const unitInToken = Object.keys(CAPACITY_UNITS).find(
      (unit) => token.endsWith(unit) && parseNumber(token.slice(0, -unit.length)) !== null
    );
    if (unitInToken) {
      const number = parseNumber(token.slice(0, -unitInToken.length));
      rows.push({
        number,
        unit: unitInToken,
        kW: number * CAPACITY_UNITS[unitInToken],
        quote: token,
      });
      continue;
    }
    const next = parts[index + 1];
    const number = parseNumber(token);
    if (number !== null && next && CAPACITY_UNITS[next]) {
      rows.push({
        number,
        unit: next,
        kW: number * CAPACITY_UNITS[next],
        quote: `${token} ${next}`,
      });
      index++;
    }
  }
  return rows.filter((row) => String(text).includes(row.quote));
}

// Five-digit tokens that are not the number of a capacity.
function postalCodes(text) {
  const numbersOfCapacities = new Set(capacities(text).map((row) => row.quote.split(' ')[0]));
  return unique(
    tokens(text).filter(
      (token) => token.length === 5 && allDigits(token) && !numbersOfCapacities.has(token)
    )
  );
}

function voltageLevels(text) {
  const codes = [];
  for (const token of tokens(text))
    for (const part of token.split('/')) if (VOLTAGE_CODES[part]) codes.push(part);
  return unique(codes);
}

function textFact(object, statement, value, role, unit) {
  return {
    statement,
    value: String(value),
    ...(unit ? { unit } : {}),
    role,
    basis: 'parsed',
    provenance: {
      source: object.provenance?.ref || object.provenance?.origin || 'message',
      quote: object.provenance?.quote || object.value,
    },
  };
}

// ─── Shared lookups ──────────────────────────────────────────────────────────

const payload = (response) => response?.data ?? response;
const projectName = (project) => project.name || project.projectId;

async function listProjects(ctx, context) {
  const res = await read(ctx, 'znp.listProjects', {}, context);
  if (!res.ok) return { ok: false, projects: [] };
  const projects = Array.isArray(res.data?.projects) ? res.data.projects : [];
  return { ok: true, projects, total: projects.length };
}

// Searches the Layer-0 assets of the tenant's ZNP projects for MaStR unit numbers.
async function findUnitsInProjects(ctx, numbers, context) {
  const listed = await listProjects(ctx, context);
  const result = { ok: listed.ok, projects: listed.projects, hits: [], scanned: [], truncated: [] };
  if (!listed.ok || !numbers.length) return result;
  const wanted = new Set(numbers);
  await Promise.all(
    listed.projects.slice(0, MAX_PROJECTS).map(async (project) => {
      let offset = 0;
      for (let page = 0; page < MAX_ASSET_PAGES; page++) {
        const res = await read(
          ctx,
          'znp.getProjectAssets',
          { projectId: project.projectId, limit: ASSET_PAGE, offset },
          context
        );
        if (!res.ok) return;
        const assets = Array.isArray(res.data?.assets) ? res.data.assets : [];
        for (const asset of assets)
          if (wanted.has(asset.mastrNummer)) result.hits.push({ project, asset });
        offset += assets.length;
        if (offset >= Number(res.data?.totalCount || 0) || !assets.length) {
          result.scanned.push(projectName(project));
          return;
        }
      }
      result.scanned.push(projectName(project));
      result.truncated.push(projectName(project));
    })
  );
  if (listed.projects.length > MAX_PROJECTS)
    result.truncated.push(`${listed.projects.length - MAX_PROJECTS} weitere Projekte`);
  return result;
}

function projectScope(found) {
  const names = found.scanned.length ? found.scanned.join(', ') : 'keine';
  const cut = found.truncated.length
    ? `; nicht vollständig durchsucht: ${found.truncated.join(', ')}`
    : '';
  return `ZNP-Projekte des Mandanten (Layer-0-Anlagen): ${names}${cut}`;
}

function projectHitFact(hit) {
  const { project, asset } = hit;
  const details = [
    present(asset.capacity) ? `${asset.capacity} kW` : '',
    asset.assetType || '',
    asset.status ? `Status ${asset.status}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return {
    statement: `MaStR-Einheit ${asset.mastrNummer} ist im ZNP-Projekt „${projectName(project)}“ als Layer-0-Anlage geführt${details ? ` (${details})` : ''}.`,
    value: asset.mastrNummer,
    role: 'reference',
    basis: 'source',
    provenance: { source: 'znp.getProjectAssets', ref: `projectId=${project.projectId}` },
  };
}

// PLZ → municipality (offline) → ZNP projects of that municipality key.
async function municipalityAndProjects(ctx, plz, context) {
  const facts = [];
  const negatives = [];
  const relations = [];
  const res = await read(ctx, 'municipality.lookup', { municipality: plz }, context);
  if (!res.ok) {
    negatives.push(unavailable(`Gemeinde zur PLZ ${plz}`, 'municipality.lookup (Destatis GV100)'));
    return { facts, negatives, relations };
  }
  const profile = res.data || {};
  if (!profile.found) {
    negatives.push({
      searched: `Gemeinde zur PLZ ${plz}`,
      scope: 'municipality.lookup (Destatis GV100 2022, offline)',
      result: 'no_hit',
    });
    return { facts, negatives, relations };
  }
  facts.push({
    statement: `PLZ ${plz} gehört zur Gemeinde ${profile.name}${profile.state ? ` (${profile.state})` : ''}${profile.ags ? `, Gemeindeschlüssel ${profile.ags}` : ''}.`,
    value: profile.ags || profile.name,
    role: 'reference',
    basis: 'source',
    provenance: {
      source: 'municipality.lookup',
      ref: `PLZ ${plz}; ${profile.sourceStatus || 'Destatis GV100'}`,
    },
  });
  if (!profile.ags) return { facts, negatives, relations };
  const listed = await listProjects(ctx, context);
  if (!listed.ok) {
    negatives.push(unavailable(`ZNP-Projekt der Gemeinde ${profile.ags}`, 'znp.listProjects'));
    return { facts, negatives, relations };
  }
  const matching = listed.projects.filter((project) => project.municipalityKey === profile.ags);
  for (const project of matching) {
    facts.push({
      statement: `Für ${profile.name} besteht das ZNP-Projekt „${projectName(project)}“ (Layer: ${(project.layers || []).join(', ') || 'keine'}; ${project.graphStats?.nodes ?? '?'} Knoten).`,
      value: project.projectId,
      role: 'reference',
      basis: 'source',
      provenance: { source: 'znp.listProjects', ref: `projectId=${project.projectId}` },
    });
    relations.push({ from: plz, rel: 'belongs_to', to: `ZNP-Projekt ${projectName(project)}` });
  }
  if (!matching.length)
    negatives.push({
      searched: `ZNP-Projekt mit Gemeindeschlüssel ${profile.ags}`,
      scope: `ZNP-Projekte des Mandanten (${listed.total})`,
      result: 'no_hit',
    });
  return { facts, negatives, relations };
}

// OSM substations of a postal code area; names that occur in the text are named nodes.
async function substationsOfArea(ctx, plz, levels, text, context) {
  const facts = [];
  const negatives = [];
  const named = [];
  const params = { postalCode: plz, maxResults: 200 };
  if (levels.length === 1) params.voltageLevel = VOLTAGE_CODES[levels[0]];
  const scope = `OpenStreetMap über osm-geo.substationFinder, PLZ ${plz}${params.voltageLevel ? `, Ebene ${params.voltageLevel}` : ''}`;
  const res = await read(ctx, 'osm-geo.substationFinder', params, context);
  if (!res.ok)
    return { facts, negatives: [unavailable(`Umspannwerke/Stationen ${plz}`, scope)], named };
  if (res.data?.success === false) {
    negatives.push({
      searched: `Umspannwerke/Stationen im PLZ-Gebiet ${plz}`,
      scope,
      result: `degraded_${res.data.degradedReason || 'unknown'}`,
    });
    return { facts, negatives, named };
  }
  const data = payload(res.data) || {};
  const summary = data.summary || {};
  const coverage = data.dataQuality?.coverageLabel;
  const ref = `postalCode=${plz}${coverage ? `; OSM-Abdeckung ${coverage}` : ''}`;
  if (!Number(summary.totalSubstations)) {
    negatives.push({
      searched: `Umspannwerke/Stationen im PLZ-Gebiet ${plz}`,
      scope,
      result: 'no_hit',
    });
    return { facts, negatives, named };
  }
  const levelsText = Object.entries(summary.byVoltageLevel || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([level, count]) => `${level} ${count}`)
    .join(', ');
  facts.push({
    statement: `In OpenStreetMap sind im PLZ-Gebiet ${plz} ${summary.totalSubstations} Umspannwerke/Stationen erfasst${levelsText ? ` (${levelsText})` : ''}; OSM bildet das Netz nicht vollständig ab.`,
    value: String(summary.totalSubstations),
    role: 'quantity',
    basis: 'source',
    provenance: { source: 'osm-geo.substationFinder', ref },
  });
  if (summary.dominantOperator)
    facts.push({
      statement: `Häufigster Betreiber-Tag der Stationen im PLZ-Gebiet ${plz}: ${summary.dominantOperator}${present(summary.dominantOperatorShare) ? ` (Anteil ${Math.round(Number(summary.dominantOperatorShare) * 100)} %)` : ''}.`,
      value: summary.dominantOperator,
      role: 'reference',
      basis: 'source',
      provenance: { source: 'osm-geo.substationFinder', ref },
    });
  const haystack = lower(text);
  for (const station of Array.isArray(data.substations) ? data.substations : []) {
    const name = String(station.name || '').trim();
    if (name.length < 4 || !haystack.includes(lower(name))) continue;
    named.push(name);
    facts.push({
      statement: `Station „${name}“ (${station.subtype || station.type || 'Station'}, Ebene ${station.voltageLevel || 'unbekannt'}${station.operator ? `, Betreiber-Tag ${station.operator}` : ''}) ist in OpenStreetMap erfasst.`,
      value: name,
      role: 'reference',
      basis: 'source',
      provenance: {
        source: 'osm-geo.substationFinder',
        ref: `${ref}; ${station.osmId || ''}`,
        quote: name,
      },
    });
  }
  return { facts, negatives, named: unique(named) };
}

// ─── Expanders ───────────────────────────────────────────────────────────────

async function expandRegisterUnit(ctx, object, context) {
  const number = String(object.value || '').trim();
  if (!registerUnitNumbers(number).some((row) => row.value === number))
    return {
      openQuestions: [
        {
          question: 'Wie lautet die MaStR-Nummer der Einheit?',
          resolves: 'Stammdaten, Netzbetreiberzuordnung und Lage in der Zielnetzplanung',
        },
      ],
      confidence: 0.2,
    };
  const facts = [
    {
      statement: `${number} hat das Format einer MaStR-Nummer (Präfix ${number.slice(0, 3)}, zwölf Ziffern).`,
      value: number,
      role: 'identifier',
      basis: 'parsed',
      provenance: { source: 'detectors.registerUnitNumbers', quote: number },
    },
  ];
  const negatives = [];
  const relations = [];
  const validateScope = 'osm-geo.validate (MaStR-Daten und VNBdigital, ohne OSM-Schicht)';
  const [validated, found] = await Promise.all([
    read(ctx, 'osm-geo.validate', { mastrNummer: number, skipOsmLayer: true }, context),
    findUnitsInProjects(ctx, [number], context),
  ]);

  let location = null;
  if (!validated.ok) negatives.push(unavailable(`Stammdaten der Einheit ${number}`, validateScope));
  else if (validated.data?.success === false)
    negatives.push({
      searched: `Stammdaten der Einheit ${number}`,
      scope: validateScope,
      result: `degraded_${validated.data.degradedReason || 'unknown'}`,
    });
  else {
    const data = payload(validated.data) || {};
    const installation = data.installation;
    if (!installation || (data.mastrNummer && data.mastrNummer !== number))
      negatives.push({
        searched: `Stammdaten der Einheit ${number}`,
        scope: validateScope,
        result: 'no_hit',
      });
    else {
      const provenance = { source: 'osm-geo.validate', ref: `mastrNummer=${number}` };
      if (installation.installationType)
        facts.push({
          statement: `Einheit ${number}: Anlagenart laut MaStR ${installation.installationType}.`,
          value: installation.installationType,
          role: 'classification',
          basis: 'source',
          provenance,
        });
      if (present(installation.bruttoleistungKW))
        facts.push({
          statement: `Einheit ${number}: Bruttoleistung ${installation.bruttoleistungKW} kW laut MaStR.`,
          value: String(installation.bruttoleistungKW),
          unit: 'kW',
          role: 'quantity',
          basis: 'source',
          provenance,
        });
      if (installation.registeredGridOperator)
        facts.push({
          statement: `Einheit ${number} ist im MaStR dem Netzbetreiber ${installation.registeredGridOperator}${installation.registeredGridOperatorId ? ` (${installation.registeredGridOperatorId})` : ''} zugeordnet.`,
          value: installation.registeredGridOperatorId || installation.registeredGridOperator,
          role: 'reference',
          basis: 'source',
          provenance,
        });
      const lat = Number(installation.location?.lat);
      const lon = Number(installation.location?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) location = { lat, lon };
      const validation = data.validation || {};
      if (validation.verdict)
        facts.push({
          statement: `Prüfung der Netzbetreiberzuordnung von ${number} (VNBdigital): ${validation.verdict}${present(validation.confidenceScore) ? `, Score ${validation.confidenceScore}` : ''}${validation.layer1_vnbdigital?.vnbFound ? `; VNBdigital nennt ${validation.layer1_vnbdigital.vnbFound}` : ''}.`,
          value: validation.verdict,
          role: 'status',
          basis: 'source',
          provenance,
        });
    }
  }

  if (!found.ok)
    negatives.push(unavailable(`${number} in der Zielnetzplanung`, 'znp.listProjects'));
  else if (!found.projects.length)
    negatives.push({
      searched: `${number} in der Zielnetzplanung`,
      scope: 'ZNP-Projekte des Mandanten (znp.listProjects)',
      result: 'no_projects',
    });
  else if (found.hits.length)
    for (const hit of found.hits) {
      facts.push(projectHitFact(hit));
      relations.push({
        from: object.objectId,
        rel: 'belongs_to',
        to: `ZNP-Projekt ${projectName(hit.project)}`,
      });
    }
  else {
    negatives.push({ searched: number, scope: projectScope(found), result: 'no_hit' });
    // The unit lies inside a project's area but is missing from its Layer 0.
    for (const project of location ? found.projects : []) {
      const box = project.bbox || {};
      const inside =
        location.lat >= Number(box.south) &&
        location.lat <= Number(box.north) &&
        location.lon >= Number(box.west) &&
        location.lon <= Number(box.east);
      if (!inside) continue;
      facts.push({
        statement: `Der MaStR-Standort von ${number} liegt im Planungsgebiet des ZNP-Projekts „${projectName(project)}“, die Einheit fehlt dort aber in Layer 0.`,
        value: project.projectId,
        role: 'status',
        basis: 'source',
        provenance: {
          source: 'znp.listProjects',
          ref: `projectId=${project.projectId}; Standort aus osm-geo.validate`,
        },
      });
    }
  }
  return { facts, negatives, relations, confidence: facts.length > 1 ? 0.8 : 0.4 };
}

async function expandConnectionRequest(ctx, object, context) {
  const text = String(object.value || '');
  const facts = [];
  const negatives = [];
  const relations = [];
  const openQuestions = [];
  const caps = capacities(text);
  const plzs = postalCodes(text);
  const levels = voltageLevels(text);
  for (const cap of caps)
    facts.push(
      textFact(
        object,
        `Beantragte Leistung laut Anschlussbegehren: ${cap.quote}.`,
        cap.kW,
        'quantity',
        'kW'
      )
    );
  for (const level of levels)
    facts.push(textFact(object, `Genannte Anschlussebene: ${level}.`, level, 'classification'));
  for (const plz of plzs)
    facts.push(textFact(object, `Genannter Ort: PLZ ${plz}.`, plz, 'reference'));
  if (!caps.length)
    openQuestions.push({
      question: 'Welche Anschlussleistung (kW oder MW) wird beantragt?',
      resolves: 'Anschlussebene und Kapazitätsprüfung',
    });
  if (!plzs.length)
    openQuestions.push({
      question: 'Wo liegt der gewünschte Anschlusspunkt (PLZ oder Adresse)?',
      resolves: 'Netzgebiet, Stationen im Gebiet und ZNP-Projekt der Gemeinde',
    });
  if (!levels.length)
    openQuestions.push({
      question: 'Auf welcher Spannungsebene soll angeschlossen werden (NS, MS, HS)?',
      resolves: 'Zuständige Station und Kapazitätsprüfung der Ebene',
    });

  const parts = await Promise.all(
    plzs
      .slice(0, 2)
      .flatMap((plz) => [
        municipalityAndProjects(ctx, plz, context),
        substationsOfArea(ctx, plz, levels, text, context),
      ])
  );
  for (const part of parts) {
    facts.push(...part.facts);
    negatives.push(...part.negatives);
    for (const row of part.relations || [])
      relations.push({ from: object.objectId, rel: row.rel, to: row.to });
    // A station the request names is its connection point: a grid node to expand.
    for (const name of part.named || [])
      relations.push({ from: object.objectId, rel: 'refers_to', to: `${NODE_PREFIX}${name}` });
  }
  if (plzs.length)
    openQuestions.push({
      question: 'Liegt für das Netzgebiet eine aktuelle Netzanschlussprüfung (Go/No-Go) vor?',
      resolves: 'Kapazitätsaussage; der Prüflauf ist ein Prozess und wird hier nicht gestartet',
    });
  return { facts, negatives, relations, openQuestions, confidence: plzs.length ? 0.7 : 0.4 };
}

function matchesElement(text, elementId) {
  const id = lower(elementId).trim();
  if (id.length < 3) return false;
  // A one-word id matches a whole token (UW1 is not UW10); a longer id matches as written.
  return id.includes(' ') ? lower(text).includes(id) : tokens(lower(text)).includes(id);
}

async function bottlenecksFor(ctx, texts, context) {
  const facts = [];
  const negatives = [];
  const matched = [];
  const scope = `Engpassbewertungen des Mandanten (agnes-bottleneck.list, neueste ${LIST_LIMIT})`;
  const res = await read(ctx, 'agnes-bottleneck.list', { limit: LIST_LIMIT }, context);
  if (!res.ok) return { facts, negatives: [unavailable(texts[0], scope)], matched };
  for (const assessment of Array.isArray(res.data?.assessments) ? res.data.assessments : []) {
    for (const bottleneck of assessment.bottlenecks || []) {
      if (!texts.some((value) => matchesElement(value, bottleneck.elementId))) continue;
      matched.push(bottleneck.elementId);
      const ref = `assessment=${assessment._id}; element=${bottleneck.elementId}; ${assessment.createdAt || ''}`;
      facts.push({
        statement: `Netzelement ${bottleneck.elementId}${bottleneck.voltageLevel ? ` (${bottleneck.voltageLevel})` : ''} ist in der Engpassbewertung${assessment.label ? ` „${assessment.label}“` : ''} als ${bottleneck.severity} eingestuft.`,
        value: bottleneck.severity,
        role: 'status',
        basis: 'source',
        provenance: { source: 'agnes-bottleneck.list', ref },
      });
      for (const finding of (bottleneck.findings || []).slice(0, 2))
        facts.push({
          statement: `${bottleneck.elementId}: ${finding.message || finding.code}`,
          value: present(finding.value) ? String(finding.value) : '',
          role: 'quantity',
          basis: 'source',
          provenance: { source: 'agnes-bottleneck.list', ref, quote: finding.message || '' },
        });
      const coverage = (assessment.fnavCoverage || []).find(
        (row) => row.elementId === bottleneck.elementId
      );
      if (coverage?.coverageStatus)
        facts.push({
          statement: `fNAV-Deckung für ${bottleneck.elementId}: ${coverage.coverageStatus}.`,
          value: coverage.coverageStatus,
          role: 'status',
          basis: 'source',
          provenance: { source: 'agnes-bottleneck.list', ref },
        });
    }
  }
  if (!matched.length)
    negatives.push({ searched: texts.join('; ').slice(0, 300), scope, result: 'no_hit' });
  return { facts, negatives, matched: unique(matched) };
}

async function gasSegmentsFor(ctx, text, context) {
  const facts = [];
  const scope = `Abgleiche Gasnetz/Wärmeplanung des Mandanten (gasnetz-waermeplanung.list, neueste ${LIST_LIMIT})`;
  const res = await read(ctx, 'gasnetz-waermeplanung.list', { limit: LIST_LIMIT }, context);
  if (!res.ok) return { facts, negatives: [unavailable(text, scope)] };
  for (const row of Array.isArray(res.data?.reconciliations) ? res.data.reconciliations : []) {
    for (const segment of row.segmentResults || []) {
      if (!matchesElement(text, segment.segmentId)) continue;
      facts.push({
        statement: `Gasnetzabschnitt ${segment.segmentId}: Stranded-Asset-Risiko ${segment.strandedRisk}${segment.decommissionHorizon ? `, Stilllegungshorizont ${segment.decommissionHorizon}` : ''}${segment.totexSignal ? `, Investitionssignal ${segment.totexSignal}` : ''} (Abgleich mit der Wärmeplanung${row.planningYear ? ` ${row.planningYear}` : ''}).`,
        value: segment.strandedRisk || '',
        role: 'status',
        basis: 'source',
        provenance: {
          source: 'gasnetz-waermeplanung.list',
          ref: `reconciliation=${row._id}; segment=${segment.segmentId}`,
        },
      });
    }
  }
  return { facts, negatives: facts.length ? [] : [{ searched: text, scope, result: 'no_hit' }] };
}

async function expandGridNode(ctx, object, context) {
  const text = String(object.value || '');
  const facts = [];
  const negatives = [];
  const openQuestions = [];
  const levels = voltageLevels(text);
  const plzs = postalCodes(text);
  for (const level of levels)
    facts.push(textFact(object, `Genannte Spannungsebene: ${level}.`, level, 'classification'));
  const parts = await Promise.all([
    bottlenecksFor(ctx, [text], context),
    gasSegmentsFor(ctx, text, context),
    ...plzs.slice(0, 1).map((plz) => substationsOfArea(ctx, plz, levels, text, context)),
  ]);
  for (const part of parts) {
    facts.push(...part.facts);
    negatives.push(...part.negatives);
  }
  if (!plzs.length)
    openQuestions.push({
      question: 'Zu welchem Ort (PLZ) gehört der Netzknoten?',
      resolves: 'Abgleich mit den in OpenStreetMap erfassten Stationen des Gebiets',
    });
  return { facts, negatives, openQuestions, confidence: facts.length > levels.length ? 0.7 : 0.3 };
}

async function areaOverview(ctx, object, context) {
  const facts = [];
  const negatives = [];
  const text = String(object.value || '');
  const [listed, critical, gas] = await Promise.all([
    listProjects(ctx, context),
    read(
      ctx,
      'agnes-bottleneck.list',
      { overallSeverity: 'CRITICAL', limit: OVERVIEW_LIMIT },
      context
    ),
    read(ctx, 'gasnetz-waermeplanung.list', { limit: OVERVIEW_LIMIT }, context),
  ]);
  if (!listed.ok) negatives.push(unavailable('ZNP-Projekte', 'znp.listProjects'));
  else if (!listed.projects.length)
    negatives.push({
      searched: 'ZNP-Projekte',
      scope: 'znp.listProjects des Mandanten',
      result: 'no_hit',
    });
  for (const project of listed.projects.slice(0, OVERVIEW_LIMIT))
    facts.push({
      statement: `ZNP-Projekt „${projectName(project)}“${project.municipalityKey ? ` (Gemeindeschlüssel ${project.municipalityKey})` : ''}: Layer ${(project.layers || []).join(', ') || 'keine'}, ${project.graphStats?.nodes ?? '?'} Knoten.`,
      value: project.projectId,
      role: 'status',
      basis: 'source',
      provenance: { source: 'znp.listProjects', ref: `projectId=${project.projectId}` },
    });
  const criticalScope =
    'Engpassbewertungen des Mandanten mit Gesamtstufe CRITICAL (agnes-bottleneck.list)';
  if (!critical.ok) negatives.push(unavailable('kritische Engpässe', criticalScope));
  else {
    const rows = Array.isArray(critical.data?.assessments) ? critical.data.assessments : [];
    if (!rows.length)
      negatives.push({ searched: 'kritische Engpässe', scope: criticalScope, result: 'no_hit' });
    for (const row of rows)
      facts.push({
        statement: `Engpassbewertung${row.label ? ` „${row.label}“` : ''} vom ${String(row.createdAt || '').slice(0, 10)}: ${row.summary?.criticalCount ?? '?'} kritische, ${row.summary?.warningCount ?? '?'} Warn-Engpässe, ${row.summary?.uncoveredBottlenecks ?? '?'} ohne ausreichende fNAV-Deckung.`,
        value: row.overallSeverity || 'CRITICAL',
        role: 'status',
        basis: 'source',
        provenance: { source: 'agnes-bottleneck.list', ref: `assessment=${row._id}` },
      });
  }
  const gasScope = 'Abgleiche Gasnetz/Wärmeplanung des Mandanten (gasnetz-waermeplanung.list)';
  if (!gas.ok) negatives.push(unavailable('Abgleiche Gasnetz/Wärmeplanung', gasScope));
  else
    for (const row of (Array.isArray(gas.data?.reconciliations)
      ? gas.data.reconciliations
      : []
    ).filter((entry) => Number(entry.kpis?.highRiskCount) > 0))
      facts.push({
        statement: `Abgleich Gasnetz/Wärmeplanung${row.label ? ` „${row.label}“` : ''}${row.planningYear ? ` (${row.planningYear})` : ''}: ${row.kpis.highRiskCount} von ${row.kpis.totalSegments} Abschnitten mit hohem Stranded-Asset-Risiko.`,
        value: String(row.kpis.highRiskCount),
        role: 'quantity',
        basis: 'source',
        provenance: { source: 'gasnetz-waermeplanung.list', ref: `reconciliation=${row._id}` },
      });
  const operators = await Promise.all(
    marketPartnerCodes(text)
      .slice(0, 1)
      .map((row) => operatorConnectionKpis(ctx, row.value, context))
  );
  for (const part of operators) {
    facts.push(...part.facts);
    negatives.push(...part.negatives);
  }
  const places = await Promise.all(
    postalCodes(text)
      .slice(0, 1)
      .map((plz) => municipalityAndProjects(ctx, plz, context))
  );
  for (const part of places) {
    facts.push(...part.facts);
    negatives.push(...part.negatives);
  }
  return { facts, negatives, confidence: facts.length ? 0.6 : 0.3 };
}

// Connection durations of a grid operator from the EWK monitoring (public KPIs).
async function operatorConnectionKpis(ctx, bdewCode, context) {
  const scope = 'vnb-monitor.snapshot (EWK-Monitoring, öffentliche Kennzahlen)';
  const res = await read(ctx, 'vnb-monitor.snapshot', { bdewCode, alerts: false }, context);
  if (!res.ok)
    return { facts: [], negatives: [unavailable(`Anschlusskennzahlen ${bdewCode}`, scope)] };
  const snapshot = res.data || {};
  const durations = snapshot.ewk?.anschlussdauer;
  if (!durations)
    return {
      facts: [],
      negatives: [
        { searched: `Anschlussdauer des Netzbetreibers ${bdewCode}`, scope, result: 'no_hit' },
      ],
    };
  const name =
    snapshot.identity?.name && snapshot.identity.name !== 'Unknown'
      ? snapshot.identity.name
      : bdewCode;
  const ref = `bdewCode=${bdewCode}; ${snapshot.timestamp || ''}`;
  const facts = [];
  if (present(durations.eeNS_weeks))
    facts.push({
      statement: `Anschlussdauer EE-Anlagen in der Niederspannung bei ${name}: ${durations.eeNS_weeks} Wochen${present(durations.bundesmedianEeNS_weeks) ? ` (Bundesmedian ${durations.bundesmedianEeNS_weeks} Wochen)` : ''}.`,
      value: String(durations.eeNS_weeks),
      unit: 'Wochen',
      role: 'quantity',
      basis: 'source',
      provenance: { source: 'vnb-monitor.snapshot', ref },
    });
  if (present(durations.eeMS_weeks))
    facts.push({
      statement: `Anschlussdauer EE-Anlagen in der Mittelspannung bei ${name}: ${durations.eeMS_weeks} Wochen.`,
      value: String(durations.eeMS_weeks),
      unit: 'Wochen',
      role: 'quantity',
      basis: 'source',
      provenance: { source: 'vnb-monitor.snapshot', ref },
    });
  return { facts, negatives: [] };
}

// Consequence check: does a finding of another area touch the target grid planning?
async function consequence(ctx, object, context) {
  const text = String(context.consequenceOf || '');
  const facts = [];
  const negatives = [];
  const relations = [];
  const units = registerUnitNumbers(text).map((row) => row.value);
  const plzs = postalCodes(text);
  const [found, bottlenecks, ...places] = await Promise.all([
    findUnitsInProjects(ctx, units, context),
    bottlenecksFor(ctx, [text], context),
    ...plzs.slice(0, 1).map((plz) => municipalityAndProjects(ctx, plz, context)),
  ]);
  for (const hit of found.hits) {
    facts.push(projectHitFact(hit));
    relations.push({
      from: object.objectId,
      rel: 'affects',
      to: `ZNP-Projekt ${projectName(hit.project)}`,
    });
  }
  if (units.length && !found.ok) negatives.push(unavailable(units.join(', '), 'znp.listProjects'));
  else if (units.length && !found.hits.length)
    negatives.push({ searched: units.join(', '), scope: projectScope(found), result: 'no_hit' });
  facts.push(...bottlenecks.facts);
  negatives.push(...bottlenecks.negatives.filter((row) => row.result === 'source_unavailable'));
  for (const element of bottlenecks.matched)
    relations.push({ from: object.objectId, rel: 'affects', to: `Netzelement ${element}` });
  for (const part of places) {
    facts.push(...part.facts);
    negatives.push(...part.negatives);
    for (const row of part.relations)
      relations.push({ from: object.objectId, rel: 'affects', to: row.to });
  }
  if (!facts.length)
    negatives.push({
      searched: `Bezug zur Zielnetzplanung: ${text.slice(0, 200)}`,
      scope:
        'MaStR-Nummern in ZNP-Projekten, PLZ zu ZNP-Projekt der Gemeinde, Netzelemente der Engpassbewertungen des Mandanten',
      result: units.length || plzs.length ? 'no_hit' : 'no_identifier_in_finding',
    });
  return { facts, negatives, relations, confidence: facts.length ? 0.7 : 0.3 };
}

const bounded =
  (expander) =>
  (ctx, object, context = {}) =>
    expander(ctx, object, { ...context, deadline: Date.now() + EXPAND_BUDGET_MS });

const expanders = {
  'plant.register_unit': bounded(expandRegisterUnit),
  'grid.connection_request': bounded(expandConnectionRequest),
  'grid.node': bounded(expandGridNode),
  concern: bounded((ctx, object, context) =>
    context.consequenceOf ? consequence(ctx, object, context) : areaOverview(ctx, object, context)
  ),
};

// A connection request that names a station of its area connects there: expand that grid node.
const playbooks = [
  {
    from: 'grid.connection_request',
    next: (finding) =>
      unique(
        (finding?.relations || [])
          .filter((row) => row.rel === 'refers_to' && String(row.to).startsWith(NODE_PREFIX))
          .map((row) => String(row.to).slice(NODE_PREFIX.length))
      ).map((value) => ({ kind: 'grid.node', value, label: 'Anschlusspunkt des Begehrens' })),
  },
];

module.exports = {
  expanders,
  playbooks,
  // Exposed for tests of the format parsing.
  parsing: { capacities, postalCodes, voltageLevels },
};
