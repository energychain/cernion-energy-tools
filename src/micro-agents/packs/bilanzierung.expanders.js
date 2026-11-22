'use strict';

/**
 * Expanders of the balancing pack (micro-agent tier, Phase 1). Every call is a read action of an
 * existing service (see operation-capability-index.json: data_read or advisory, no side effects,
 * no writes):
 * - bilanzkreis.list               register of the tenant's balance groups (object store query);
 * - eic-codes.search               ENTSO-E / AGSI EIC directory (read-only MCP tool);
 * - slp.listProfiles, slp.getProfile  load profile catalog and its quarter-hour values;
 * - regulatorische-entgeltlogik.list  registered rule sets of type BALANCING_ENERGY.
 * A failing call yields a negative with result "service_unavailable", never an error.
 */

const { eicCodes, tokens } = require('./detectors');

const CALL_TIMEOUT_MS = 3000;
const MAX_PARTICIPANTS = 8;
const MAX_MATCHES = 3;
const MAX_RULE_SETS = 6;
const MIN_NAME_LENGTH = 6;
const GROUP_REF_PREFIX = 'bilanzkreis:';

const REGISTER_SCOPE = 'Bilanzkreis-Register des Mandanten (bilanzkreis.list: ID, Name, Metadaten)';
const EIC_SCOPE = 'EIC-Verzeichnis von ENTSO-E und AGSI/GIE (eic-codes.search)';
const PROFILE_SCOPE = 'Im System hinterlegte Standard- und Mandantenprofile (slp.listProfiles)';
const RULE_SCOPE =
  'Registrierte Regelwerke vom Typ BALANCING_ENERGY des Mandanten (regulatorische-entgeltlogik.list)';

// ENTSO-E EIC Reference Manual: object type character (third position) and the local issuing
// offices whose codes this pack meets in the German market.
const EIC_SOURCE = 'ENTSO-E EIC Reference Manual';
const EIC_OBJECT_TYPES = {
  X: 'Marktteilnehmer (Party)',
  Y: 'Bereich (Area)',
  Z: 'Messpunkt (Measurement point)',
  W: 'Ressource (Resource object)',
  V: 'Ort (Location)',
  T: 'Kuppelleitung (Tie line)',
  A: 'Umspannwerk (Substation)',
};
const EIC_ISSUING_OFFICES = {
  10: 'ENTSO-E (Central Issuing Office)',
  11: 'BDEW (Local Issuing Office Deutschland, Strom)',
  37: 'DVGW (Local Issuing Office Deutschland, Gas)',
};
const PARTICIPANT_ROLES = { producer: 'Erzeuger', consumer: 'Verbraucher', prosumer: 'Prosumer' };

const lower = (value) => String(value ?? '').toLowerCase();

async function read(ctx, action, params) {
  try {
    return { ok: true, data: await ctx.call(action, params, { timeout: CALL_TIMEOUT_MS }) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

const unavailable = (searched, scope) => ({ searched, scope, result: 'service_unavailable' });

// Optional clause of a statement: the clause built from a present value, otherwise nothing.
const clause = (value, build) => (value ? build(value) : '');

// ── EIC format (check character per the ENTSO-E reference manual) ────────────────────────────

const isEic = (value) => eicCodes(value).some((hit) => hit.value === value);
const eicValue = (ch) => {
  if (ch >= '0' && ch <= '9') return ch.codePointAt(0) - 48;
  if (ch === '-') return 36;
  return ch.codePointAt(0) - 55;
};
const eicChar = (value) => {
  if (value < 10) return String(value);
  if (value === 36) return '-';
  return String.fromCodePoint(value + 55);
};

function eicCheckCharacter(code) {
  let sum = 0;
  for (let index = 0; index < 15; index++) sum += eicValue(code[index]) * (16 - index);
  return eicChar(36 - ((((sum - 1) % 37) + 37) % 37));
}

function eicFacts(code) {
  const expected = eicCheckCharacter(code);
  const facts = [
    {
      statement:
        expected === code[15]
          ? `Das Prüfzeichen der EIC-Kennung ${code} ist gültig.`
          : `Das Prüfzeichen der EIC-Kennung ${code} ist ungültig: berechnet ${expected}, angegeben ${code[15]}.`,
      value: code,
      role: 'status',
      basis: 'parsed',
      provenance: { source: 'eic-format', ref: `${EIC_SOURCE}: Prüfzeichen`, quote: code },
    },
  ];
  const type = EIC_OBJECT_TYPES[code[2]];
  if (type)
    facts.push({
      statement: `Objekttyp der EIC-Kennung ${code} (3. Stelle ${code[2]}): ${type}.`,
      value: code[2],
      role: 'classification',
      basis: 'rule',
      provenance: { source: EIC_SOURCE, ref: 'Objekttyp-Kennbuchstabe', quote: code },
    });
  const office = EIC_ISSUING_OFFICES[code.slice(0, 2)];
  if (office)
    facts.push({
      statement: `Vergabestelle der EIC-Kennung ${code} (Stellen 1–2): ${office}.`,
      value: code.slice(0, 2),
      role: 'classification',
      basis: 'rule',
      provenance: { source: EIC_SOURCE, ref: 'Issuing Office', quote: code },
    });
  return facts;
}

function eicRows(response) {
  const candidates = [
    response?.results,
    response?.data?.results,
    Array.isArray(response?.data) ? response.data[0]?.json?.results : null,
  ];
  return candidates.find(Array.isArray) || [];
}

async function eicDirectory(ctx, code) {
  const response = await read(ctx, 'eic-codes.search', { code, limit: 5 });
  if (!response.ok) return { facts: [], negatives: [unavailable(code, EIC_SCOPE)] };
  const hit = eicRows(response.data).find((row) => lower(row?.code) === lower(code));
  if (!hit)
    return { facts: [], negatives: [{ searched: code, scope: EIC_SCOPE, result: 'no_hit' }] };
  const details = [hit.type, hit.country].filter(Boolean).join(', ');
  const detailText = clause(details, (text) => ` (${text})`);
  return {
    facts: [
      {
        statement: `Im EIC-Verzeichnis ist ${hit.code} geführt als ${hit.name || 'ohne Namen'}${detailText}.`,
        value: hit.code,
        role: 'identifier',
        basis: 'source',
        provenance: { source: 'eic-codes.search', ref: hit.code },
      },
    ],
    negatives: [],
  };
}

// ── Balance group register (bilanzkreis.list) ───────────────────────────────────────────────

async function readRegister(ctx) {
  const response = await read(ctx, 'bilanzkreis.list', {});
  if (!response.ok) return null;
  return (Array.isArray(response.data?.data) ? response.data.data : [])
    .map((doc) => ({ id: String(doc?.key || doc?.payload?.id || ''), payload: doc?.payload || {} }))
    .filter((entry) => entry.id);
}

const metadataStrings = (payload) =>
  Object.entries(payload.metadata || {}).filter(([, value]) => typeof value === 'string' && value);

// The object names one register entry: by its ID, its name or a metadata value (e.g. its EIC).
function namesEntry(value, entry) {
  const wanted = lower(value).trim();
  const name = lower(entry.payload.name);
  if (!wanted) return false;
  if (lower(entry.id) === wanted || name === wanted) return true;
  if (metadataStrings(entry.payload).some(([, meta]) => lower(meta) === wanted)) return true;
  return (
    (wanted.length >= MIN_NAME_LENGTH && name.includes(wanted)) ||
    (name.length >= MIN_NAME_LENGTH && wanted.includes(name))
  );
}

// A text mentions an entry literally: its ID as a token or its name; metadata values only when
// asked (EIC codes in a message are recognized as objects of their own already).
function mentionsEntry(text, entry, { metadata = false } = {}) {
  const words = new Set(tokens(text).map(lower));
  const name = lower(entry.payload.name);
  if (words.has(lower(entry.id))) return true;
  if (name.length >= MIN_NAME_LENGTH && lower(text).includes(name)) return true;
  return metadata && metadataStrings(entry.payload).some(([, meta]) => words.has(lower(meta)));
}

function entryFacts(entry, { participants = true } = {}) {
  const { id, payload } = entry;
  const source = { source: 'bilanzkreis.list', ref: id };
  const nameText = clause(payload.name, (name) => ` („${name}“)`);
  const facts = [
    {
      statement: `Bilanzkreis ${id}${nameText} ist im Bilanzkreis-Register geführt: Typ ${payload.type || 'ohne Angabe'}, Status ${payload.status || 'ohne Angabe'}.`,
      value: id,
      role: 'identifier',
      basis: 'source',
      validFrom: payload.validFrom || '',
      validTo: payload.validTo || '',
      provenance: source,
    },
  ];
  const relations = [];
  if (payload.gridOperatorMastrId)
    facts.push({
      statement: `Netzbetreiber des Bilanzkreises ${id} (MaStR-Nummer): ${payload.gridOperatorMastrId}.`,
      value: payload.gridOperatorMastrId,
      role: 'reference',
      basis: 'source',
      provenance: source,
    });
  for (const [key, value] of metadataStrings(payload).slice(0, 3))
    facts.push({
      statement: `Bilanzkreis ${id}, Stammdatum ${key}: ${value}.`,
      value,
      role: 'reference',
      basis: 'source',
      provenance: source,
    });
  if (!participants) return { facts, relations };
  const members = Array.isArray(payload.participants) ? payload.participants : [];
  facts.push({
    statement: `Bilanzkreis ${id} hat ${members.length} Teilnehmer.`,
    value: String(members.length),
    role: 'quantity',
    basis: 'source',
    provenance: source,
  });
  for (const member of members.slice(0, MAX_PARTICIPANTS)) {
    if (!member?.meloId) continue;
    const share = Number(member.share ?? 1);
    const roleText = PARTICIPANT_ROLES[member.role] || member.role || 'Teilnehmer';
    const shareText = share === 1 ? '' : ` (Anteil ${share})`;
    facts.push({
      statement: `Marktlokation ${member.meloId} ist ${roleText} im Bilanzkreis ${id}${shareText}.`,
      value: member.meloId,
      role: 'identifier',
      basis: 'source',
      provenance: source,
    });
    relations.push({ from: member.meloId, rel: 'belongs_to', to: `${GROUP_REF_PREFIX}${id}` });
  }
  return { facts, relations };
}

// Literal mentions of registered balance groups in a text, as facts with a refers_to relation.
function mentionedGroups(text, register, from, options) {
  const facts = [];
  const relations = [];
  for (const entry of register
    .filter((row) => mentionsEntry(text, row, options))
    .slice(0, MAX_MATCHES)) {
    facts.push(...entryFacts(entry, { participants: false }).facts);
    relations.push({ from, rel: 'refers_to', to: `${GROUP_REF_PREFIX}${entry.id}` });
  }
  return { facts, relations };
}

async function expandGroup(ctx, object) {
  const value = object.value.trim();
  const eic = isEic(value);
  const [register, directory] = await Promise.all([
    readRegister(ctx),
    eic ? eicDirectory(ctx, value) : Promise.resolve({ facts: [], negatives: [] }),
  ]);
  const facts = eic ? eicFacts(value) : [];
  const relations = [];
  const negatives = [...directory.negatives];
  facts.push(...directory.facts);
  if (!register) negatives.push(unavailable(value, REGISTER_SCOPE));
  else {
    const matches = register.filter((entry) => namesEntry(value, entry)).slice(0, MAX_MATCHES);
    if (!matches.length)
      negatives.push({ searched: value, scope: REGISTER_SCOPE, result: 'no_hit' });
    for (const entry of matches) {
      const found = entryFacts(entry);
      facts.push(...found.facts);
      relations.push(...found.relations);
    }
  }
  const registered = facts.some((fact) => fact.provenance.source === 'bilanzkreis.list');
  let confidence = 0.3;
  if (registered) confidence = 0.9;
  else if (facts.length) confidence = 0.6;
  return {
    facts,
    relations,
    negatives,
    openQuestions: registered
      ? [
          {
            question:
              'Für welchen Zeitraum sollen Datenvollständigkeit und Abrechnungsreife des Bilanzkreises geprüft werden?',
            resolves: 'Abrechnungsreife je Teilnehmer (bilanzkreis.checkReadiness braucht from/to)',
          },
        ]
      : [],
    confidence,
  };
}

// ── Load profiles (slp.listProfiles, slp.getProfile) ────────────────────────────────────────

function namesProfile(value, profile) {
  const wanted = lower(value);
  const name = lower(profile.name);
  if (tokens(value).map(lower).includes(lower(profile.id))) return true;
  return (
    (name.length >= 4 && wanted.includes(name)) || (wanted.length >= 4 && name.includes(wanted))
  );
}

function quarterHour(index) {
  const minutes = index * 15;
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  const rest = String(minutes % 60).padStart(2, '0');
  return `${hours}:${rest}`;
}

async function profileFacts(ctx, profile) {
  const kind = profile.type === 'custom' ? 'Mandantenprofil' : 'Standardprofil';
  const descriptionText = clause(profile.description, (text) => `: ${text}`);
  const baseText = clause(profile.baseProfile, (base) => `; Basisprofil ${base}`);
  const facts = [
    {
      statement: `Lastprofil ${profile.id} („${profile.name}“, ${kind})${descriptionText}${baseText}.`,
      value: profile.id,
      role: 'classification',
      basis: 'source',
      provenance: { source: 'slp.listProfiles', ref: profile.id },
    },
  ];
  const response = await read(ctx, 'slp.getProfile', { profileId: profile.id });
  const values = Array.isArray(response.data?.values) ? response.data.values.map(Number) : [];
  if (!response.ok || !values.length)
    return {
      facts,
      negatives: [
        response.ok
          ? { searched: `Profilwerte ${profile.id}`, scope: 'slp.getProfile', result: 'no_values' }
          : unavailable(`Profilwerte ${profile.id}`, 'slp.getProfile'),
      ],
    };
  const peak = values.indexOf(Math.max(...values));
  const period = [response.data.season, response.data.dayType].filter(Boolean).join(', ');
  const periodText = clause(period, (text) => ` (${text})`);
  const periodRef = clause(period, (text) => ` ${text}`);
  facts.push({
    statement: `Profilwerte ${profile.id}${periodText}: ${values.length} Viertelstundenwerte, höchster Anteil ${values[peak]} im Intervall ab ${quarterHour(peak)} Uhr.`,
    value: quarterHour(peak),
    role: 'quantity',
    basis: 'source',
    provenance: { source: 'slp.getProfile', ref: `${profile.id}${periodRef}` },
  });
  return { facts, negatives: [] };
}

const profileLabel = (profile) => `${profile.id} (${profile.name})`;

async function expandProfile(ctx, object) {
  const value = object.value.trim();
  const listing = await read(ctx, 'slp.listProfiles', {});
  if (!listing.ok) return { negatives: [unavailable(value, PROFILE_SCOPE)], confidence: 0.2 };
  const profiles = (Array.isArray(listing.data?.profiles) ? listing.data.profiles : []).filter(
    (profile) => profile?.id
  );
  const matches = profiles.filter((profile) => namesProfile(value, profile)).slice(0, MAX_MATCHES);
  if (!matches.length) {
    const profileList = profiles.map(profileLabel).join(', ');
    return {
      facts: profiles.length
        ? [
            {
              statement: `Im System hinterlegte Lastprofile: ${profileList}.`,
              value: profiles.map((profile) => profile.id).join(', '),
              role: 'classification',
              basis: 'source',
              provenance: { source: 'slp.listProfiles' },
            },
          ]
        : [],
      negatives: [{ searched: value, scope: PROFILE_SCOPE, result: 'no_hit' }],
      confidence: 0.4,
    };
  }
  const found = await Promise.all(matches.map((profile) => profileFacts(ctx, profile)));
  return {
    facts: found.flatMap((row) => row.facts),
    negatives: found.flatMap((row) => row.negatives),
    confidence: 0.85,
  };
}

// ── Deviations (Mehr-/Mindermengen, Ausgleichsenergie) ──────────────────────────────────────

function ruleSetFact(ruleSet) {
  const tests = ruleSet.testResults;
  const labelText = clause(ruleSet.label, (label) => ` „${label}“`);
  const toText = clause(ruleSet.effectiveTo, (to) => ` bis ${to}`);
  const legalText = clause(ruleSet.legalBasis, (basis) => `; Rechtsgrundlage: ${basis}`);
  const testText = tests?.total ? `; Testfälle ${tests.passed}/${tests.total} bestanden` : '';
  return {
    statement: `Regelwerk Ausgleichsenergie${labelText} für Netzbetreiber ${ruleSet.gridOperatorId || 'ohne Angabe'}, gültig ab ${ruleSet.effectiveFrom || 'ohne Angabe'}${toText}${legalText}${testText}.`,
    value: String(ruleSet._id || ''),
    role: 'classification',
    basis: 'source',
    validFrom: ruleSet.effectiveFrom || '',
    validTo: ruleSet.effectiveTo || '',
    provenance: { source: 'regulatorische-entgeltlogik.list', ref: String(ruleSet._id || '') },
  };
}

async function expandDeviation(ctx, object) {
  const value = object.value.trim();
  const [rules, register] = await Promise.all([
    read(ctx, 'regulatorische-entgeltlogik.list', { ruleType: 'BALANCING_ENERGY', limit: 20 }),
    readRegister(ctx),
  ]);
  const facts = [];
  const negatives = [];
  let relations = [];
  if (!rules.ok) negatives.push(unavailable('Regelwerke Ausgleichsenergie', RULE_SCOPE));
  else {
    const ruleSets = Array.isArray(rules.data?.ruleSets) ? rules.data.ruleSets : [];
    if (!ruleSets.length)
      negatives.push({
        searched: 'Regelwerke Ausgleichsenergie',
        scope: RULE_SCOPE,
        result: 'no_hit',
      });
    facts.push(...ruleSets.slice(0, MAX_RULE_SETS).map(ruleSetFact));
  }
  if (register) {
    const mentioned = mentionedGroups(value, register, object.objectId);
    facts.push(...mentioned.facts);
    relations = mentioned.relations;
  }
  return {
    facts,
    relations,
    negatives,
    // No service holds Mehr-/Mindermengen, Bilanzkreisabrechnungen or balancing energy prices
    // as readable data; the answer has to ask for the case data instead.
    openQuestions: relations.length
      ? []
      : [
          {
            question:
              'Zu welchem Bilanzkreis, welcher Marktlokation und welchem Zeitraum gehört die Abweichung?',
            resolves: 'Zuordnung der Mehr-/Mindermenge zu Bilanzkreis-Register und Messwerten',
          },
        ],
    confidence: facts.length ? 0.7 : 0.3,
  };
}

// ── Concern ─────────────────────────────────────────────────────────────────────────────────

function registerSummary(register) {
  const byType = {};
  for (const entry of register) {
    const type = entry.payload.type || 'ohne Typ';
    byType[type] = (byType[type] || 0) + 1;
  }
  const counts = Object.entries(byType)
    .map(([type, count]) => `${type}: ${count}`)
    .join(', ');
  return {
    statement: `Das Bilanzkreis-Register des Mandanten führt ${register.length} Bilanzkreise (${counts}).`,
    value: String(register.length),
    role: 'quantity',
    basis: 'source',
    provenance: { source: 'bilanzkreis.list' },
  };
}

async function expandConcern(ctx, object, context = {}) {
  const consequenceOf = String(context.consequenceOf || '').trim();
  const text = [object.value, consequenceOf].filter(Boolean).join('\n');
  const register = await readRegister(ctx);
  if (!register)
    return {
      negatives: [unavailable('Bilanzkreise des Mandanten', REGISTER_SCOPE)],
      confidence: 0.2,
    };
  if (!register.length)
    return {
      negatives: [
        { searched: 'Bilanzkreise des Mandanten', scope: REGISTER_SCOPE, result: 'empty' },
      ],
      confidence: 0.3,
    };
  const mentioned = mentionedGroups(text, register, object.objectId, {
    metadata: Boolean(consequenceOf),
  });
  const negatives = [];
  const openQuestions = [];
  if (consequenceOf) {
    const known = new Set(
      register.flatMap((entry) => metadataStrings(entry.payload).map(([, v]) => v))
    );
    for (const hit of eicCodes(consequenceOf).filter((row) => !known.has(row.value)))
      negatives.push({ searched: hit.value, scope: REGISTER_SCOPE, result: 'no_hit' });
    if (!mentioned.relations.length) {
      negatives.push({
        searched: 'Im Befund genannte Bilanzkreise (ID, Name, EIC)',
        scope: REGISTER_SCOPE,
        result: 'no_hit',
      });
      openQuestions.push({
        question: 'Welcher Bilanzkreis ist von dem Befund betroffen?',
        resolves: consequenceOf,
      });
    }
  }
  return {
    facts: [...mentioned.facts, registerSummary(register)],
    relations: mentioned.relations,
    negatives,
    openQuestions,
    confidence: mentioned.relations.length ? 0.8 : 0.5,
  };
}

// ── Playbooks ───────────────────────────────────────────────────────────────────────────────

const referencedGroups = (finding) =>
  (finding?.relations || [])
    .filter((row) => row.rel === 'refers_to' && String(row.to).startsWith(GROUP_REF_PREFIX))
    .map((row) => ({
      kind: 'balancing.group',
      value: String(row.to).slice(GROUP_REF_PREFIX.length),
      label: 'Bilanzkreis',
    }));

const playbooks = [
  // The participants of a balance group are market locations: their master data and metering
  // values belong to the market communication pack.
  {
    from: 'balancing.group',
    next: (finding) =>
      (finding?.relations || [])
        .filter((row) => row.rel === 'belongs_to' && String(row.to).startsWith(GROUP_REF_PREFIX))
        .map((row) => ({ kind: 'mako.location_id', value: row.from, label: 'Marktlokation' })),
  },
  // A deviation or a question that literally names a registered balance group: expand it.
  { from: 'balancing.deviation', next: referencedGroups },
  { from: 'concern', next: referencedGroups },
];

module.exports = {
  expanders: {
    'balancing.group': expandGroup,
    'balancing.profile': expandProfile,
    'balancing.deviation': expandDeviation,
    concern: expandConcern,
  },
  playbooks,
  eicCheckCharacter,
};
