const crypto = require('crypto');
const { convertToXLSX } = require('../src/format-response');
const { callWithAutoPoll } = require('../src/async-job-poller');
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId, tenantNamespace } = require('../src/tenant-context');
const { getDemoAsset, isDemoAssetId } = require('../src/rcs-demo-data');

const OEO_CLASS_KEY = 'x-oeo-class';
const PARAM_DESC_VNB_NAME = 'Name of grid operator';
const PARAM_DESC_BDEW_CODE = 'BDEW code (13 digits)';
const PARAM_DESC_LIMIT =
  'Max. number of results. Default: **1,000**. Use a high value (e.g. `1000000`) or `all` for the complete result set \u2014 the server paginates internally.';
const OEO_URL_POWER_PLANT = 'https://openenergyplatform.org/ontology/oeo/OEO_00000031';
const PARAM_DESC_PRUEFUNG_STATUS =
  'Filter by grid operator verification status code(s), comma-separated. Values: 2954=Gepr\u00fcft \u2705, 2955=In Pr\u00fcfung \u23f3, 3075=Nicht vorgesehen.';
const EXAMPLE_DATE = '2026-03-24';
const PARAM_DESC_GR_ID = 'MaStR grid operator ID';
const PARAM_DESC_LOCATION =
  'City/region/postal code for location-based search (e.g. "Mainz", "69115", "Baden-Württemberg"). ' +
  'Live MaStR filtering only supports an exact 5-digit postal code; a free-text city/region name that ' +
  'cannot be resolved to one does NOT return a bare empty array — the response includes a ' +
  '`locationResolutionWarning` instead (see response schema). Pass the postal code directly when known.';
const PARAM_DESC_YEAR = 'Commissioning year';
const PARAM_DESC_MIN_CAP = 'Min. capacity in kW';
const PARAM_DESC_MAX_CAP = 'Max. capacity in kW';
const PARAM_DESC_NAP = 'Include NAP data (MeLo, voltage level, bottleneck capacity). Default: true';
const PARAM_DESC_UPDATED_AFTER =
  'ISO date \u2014 only installations with lastUpdatedAt (DatumLetzteMeldung) after this date.';
const PARAM_DESC_FORMAT = 'Output format (default: json)';
const PARAM_DESC_DEFAULT_STATUS = '**Default: Only active installations (status 35).**';
const PARAM_DESC_OFFSET = 'Pagination offset \u2014 skip N records to fetch the next page.';
const PARAM_DESC_REDISPATCH = 'Redispatch 2.0 (\u2265100kW)';
const PARAM_DESC_OP_STATUS =
  'Operational status: 31=Planned, 35=In operation (default), 37=Temporarily decommissioned, 38=Permanently decommissioned, all=All statuses';
const PARAM_DESC_OP_STATUS_SHORT =
  'Operational status: 31=Planned, 35=In operation (default), 37=Temporarily decommissioned, 38=Permanently decommissioned, all=All';
const ASSET_QUERY_COUNT_SEMANTICS =
  'Count semantics: this endpoint returns an array. For questions like "How many ...", use the number of returned items (`array.length`).';
const ASSET_INSTALLATION_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    'Asset-ID': { type: 'string' },
    'SEE Nummer': { type: 'string' },
    Anlagentyp: { type: 'string' },
    'Leistung kW': { type: 'number' },
    Ort: { type: 'string', nullable: true },
    Postleitzahl: { type: 'string', nullable: true },
    Bundesland: { type: 'string', nullable: true },
  },
};
const ASSET_QUERY_ARRAY_RESPONSE = {
  200: {
    description:
      'Array of matching installations, OR — when `location` was a free-text city/region that could ' +
      'not be resolved to a postal code (#274) — an object reporting that resolution failure instead of ' +
      'a bare empty array. A bare `[]` always means a genuinely empty, location-resolved result set; ' +
      'count/aggregation for the array case can be derived via response length (`array.length`).',
    content: {
      'application/json': {
        schema: {
          oneOf: [
            {
              type: 'array',
              items: ASSET_INSTALLATION_ITEM_SCHEMA,
            },
            {
              type: 'object',
              description:
                'Returned instead of a bare array when `location` could not be resolved to an exact ' +
                'postal code. Never confuse this with "0 assets found" — re-issue the request with a ' +
                '5-digit postal code.',
              required: ['success', 'data', 'locationResolutionWarning'],
              properties: {
                success: { type: 'boolean', example: true },
                data: { type: 'array', items: ASSET_INSTALLATION_ITEM_SCHEMA },
                locationResolutionWarning: {
                  type: 'string',
                  example:
                    'Location "Meckesheim" could not be resolved to a postal code. The live MaStR backend only supports exact 5-digit postleitzahl filtering, not free-text city/region search. Pass "postleitzahl" directly, or resolve the postal code first (e.g. via grid-operations.marketPartners or OSM Geo).',
                },
              },
            },
          ],
        },
      },
    },
  },
  400: {
    description:
      'Invalid parameters (at least one of vnbName, bdewCode, gridOperatorId or location is required).',
  },
  500: {
    description: 'Internal server error during MaStR query.',
  },
};

const OVERRIDE_NAMESPACE = 'asset_overrides';
const OVERRIDEABLE_FIELDS = [
  'capacityKW',
  'voltageLevel',
  'commissionDate',
  'direktvermarktungActive',
];
const CRITICAL_OVERRIDE_FIELDS = ['voltageLevel', 'direktvermarktungActive'];

// Single-asset-type actions (solar/wind/storage/biomass/hydro/combustion) share an
// identical MaStR query shape and only differ in the asset type, OEO ontology class,
// and description copy — generated from ASSET_TYPE_CATALOG instead of hand-duplicated
// per type (previously ~130 near-identical lines each, flagged by SonarCloud).
const ASSET_TYPE_CATALOG = [
  {
    type: 'solar',
    oeoUrl: 'https://openenergyplatform.org/ontology/oeo/OEO_00000034', // solar power unit
    summary: 'List solar PV installations by grid operator or location',
    assetNoun: 'photovoltaic',
    locationQueryExample: 'Wie viele PV Anlagen gibt es in <Ort>?',
    descriptionSuffix: ' Example: /api/assets/solar?location=Mainz',
    opStatusDesc: PARAM_DESC_OP_STATUS,
    offsetDesc:
      'Pagination offset — skip this many records. Use `offset=1000` to fetch the next page.',
    redispatchDesc: 'Redispatch 2.0 filter (≥100kW)',
  },
  {
    type: 'wind',
    oeoUrl: 'https://openenergyplatform.org/ontology/oeo/OEO_00000044', // wind energy converting unit
    summary: 'List wind installations by grid operator or location',
    assetNoun: 'wind',
    locationQueryExample: 'Wie viele Windanlagen gibt es in <Ort>?',
  },
  {
    type: 'storage',
    oeoUrl: 'https://openenergyplatform.org/ontology/oeo/OEO_00000159', // energy storage object
    summary: 'List battery storage installations by grid operator or location',
    assetNoun: 'battery storage',
    locationQueryExample: 'Welche Speicheranlagen gibt es in <Ort>?',
  },
  {
    type: 'biomass',
    oeoUrl: 'https://openenergyplatform.org/ontology/oeo/OEO_00010214', // biomass power unit
    summary: 'List all biomass installations of a grid operator',
  },
  {
    type: 'hydro',
    oeoUrl: 'https://openenergyplatform.org/ontology/oeo/OEO_00010086', // hydro power plant
    summary: 'List all hydropower installations of a grid operator',
  },
  {
    type: 'combustion',
    oeoUrl: 'https://openenergyplatform.org/ontology/oeo/OEO_00140038', // combustion power plant
    summary: 'List all combustion installations of a grid operator',
  },
];

function buildAssetTypeDescription(def) {
  if (!def.assetNoun) {
    return PARAM_DESC_DEFAULT_STATUS;
  }
  return (
    `Retrieves ${def.assetNoun} installations from MaStR by grid operator context (\`vnbName\`, \`bdewCode\`, \`gridOperatorId\`) ` +
    'or directly by `location` (city/region/postal code). ' +
    PARAM_DESC_DEFAULT_STATUS +
    ' ' +
    ASSET_QUERY_COUNT_SEMANTICS +
    (def.descriptionSuffix || '')
  );
}

function buildAssetTypeLocationDescription(def) {
  if (!def.locationQueryExample) {
    return PARAM_DESC_LOCATION;
  }
  return `${PARAM_DESC_LOCATION}. Supports city-style queries like "${def.locationQueryExample}".`;
}

function buildAssetTypeAction(def) {
  return {
    rest: `GET /${def.type}`,
    params: {
      vnbName: { type: 'string', optional: true },
      bdewCode: { type: 'string', optional: true, convert: true },
      gridOperatorId: { type: 'string', optional: true, convert: true },
      location: { type: 'string', optional: true },
      commissioningYear: { type: 'number', optional: true, convert: true },
      minCapacityKW: { type: 'number', optional: true, convert: true },
      maxCapacityKW: { type: 'number', optional: true, convert: true },
      limit: { type: 'any', optional: true },
      offset: { type: 'number', optional: true, min: 0, convert: true },
      redispatch: { type: 'boolean', optional: true, convert: true },
      operationalStatus: { type: 'string', optional: true, default: '35', convert: true },
      netzbetreiberPruefungStatus: { type: 'string', optional: true, convert: true },
      format: { type: 'enum', values: ['json', 'csv', 'xlsx'], optional: true, default: 'json' },
      includeNapData: { type: 'boolean', optional: true, default: true, convert: true },
      updatedAfter: { type: 'string', optional: true, convert: true },
    },
    openapi: {
      operationId: `assets_${def.type}`,
      summary: def.summary,
      description: buildAssetTypeDescription(def),
      tags: ['Assets'],
      [OEO_CLASS_KEY]: [def.oeoUrl],
      parameters: [
        {
          name: 'vnbName',
          in: 'query',
          schema: { type: 'string', example: 'Netze BW' },
          description: PARAM_DESC_VNB_NAME,
        },
        {
          name: 'bdewCode',
          in: 'query',
          schema: { type: 'string', example: '4041407000008' },
          description: PARAM_DESC_BDEW_CODE,
        },
        {
          name: 'gridOperatorId',
          in: 'query',
          schema: { type: 'string', example: 'SNB948311994307' },
          description: PARAM_DESC_GR_ID,
        },
        {
          name: 'location',
          in: 'query',
          schema: { type: 'string', example: 'Heidelberg' },
          description: buildAssetTypeLocationDescription(def),
        },
        {
          name: 'commissioningYear',
          in: 'query',
          schema: { type: 'number', example: 2020 },
          description: PARAM_DESC_YEAR,
        },
        {
          name: 'minCapacityKW',
          in: 'query',
          schema: { type: 'number', example: 100 },
          description: PARAM_DESC_MIN_CAP,
        },
        {
          name: 'maxCapacityKW',
          in: 'query',
          schema: { type: 'number', example: 10000 },
          description: PARAM_DESC_MAX_CAP,
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'number', default: 1000, example: 1000 },
          description: PARAM_DESC_LIMIT,
        },
        {
          name: 'offset',
          in: 'query',
          schema: { type: 'number', default: 0, minimum: 0, example: 0 },
          description: def.offsetDesc || PARAM_DESC_OFFSET,
        },
        {
          name: 'redispatch',
          in: 'query',
          schema: { type: 'boolean', example: true },
          description: def.redispatchDesc || PARAM_DESC_REDISPATCH,
        },
        {
          name: 'operationalStatus',
          in: 'query',
          schema: { type: 'string', default: '35', example: '35' },
          description: def.opStatusDesc || PARAM_DESC_OP_STATUS_SHORT,
        },
        {
          name: 'netzbetreiberPruefungStatus',
          in: 'query',
          schema: { type: 'string', example: '2955' },
          description: PARAM_DESC_PRUEFUNG_STATUS,
        },
        {
          name: 'includeNapData',
          in: 'query',
          schema: { type: 'boolean', default: true },
          description: PARAM_DESC_NAP,
        },
        {
          name: 'updatedAfter',
          in: 'query',
          schema: { type: 'string', format: 'date', example: EXAMPLE_DATE },
          description: PARAM_DESC_UPDATED_AFTER,
        },
        {
          name: 'format',
          in: 'query',
          schema: { type: 'string', enum: ['json', 'csv', 'xlsx'], default: 'json' },
          description: PARAM_DESC_FORMAT,
        },
      ],
      responses: ASSET_QUERY_ARRAY_RESPONSE,
    },
    async handler(ctx) {
      return this._fetchAssets(ctx, [def.type]);
    },
  };
}

const GENERATED_ASSET_TYPE_ACTIONS = Object.fromEntries(
  ASSET_TYPE_CATALOG.map((def) => [def.type, buildAssetTypeAction(def)])
);

/**
 * Assets Service
 *
 * Extracts a list of assets for a Distribution Network Operator (VNB).
 */
module.exports = {
  name: 'assets',

  /**
   * Service settings
   */
  settings: {
    defaultLocation: 'Deutschland',
  },

  /**
   * Service dependencies
   */
  dependencies: ['energy-market', 'object-store', 'hitl'],

  /**
   * Methods
   */
  methods: {
    /**
     * Convert array of objects to CSV format
     */
    convertToCSV(data) {
      if (!data || data.length === 0) {
        return '';
      }

      // Get all unique keys from all objects (some objects might have different fields)
      const allKeys = [...new Set(data.flatMap((obj) => Object.keys(obj)))];

      // Create CSV header
      const header = allKeys.map((key) => `"${key}"`).join(',');

      // Create CSV rows
      const rows = data.map((obj) => {
        return allKeys
          .map((key) => {
            const value = obj[key];
            // Handle null/undefined
            if (value === null || value === undefined) return '';
            // Handle numbers
            if (typeof value === 'number') return value;
            // Handle strings (escape quotes and wrap in quotes)
            const stringValue = String(value).replace(/"/g, '""');
            return `"${stringValue}"`;
          })
          .join(',');
      });

      return [header, ...rows].join('\n');
    },

    _getOverrideNamespace(ctx) {
      const tenantId = getTenantId(ctx);
      return {
        tenantId,
        namespace: tenantNamespace(OVERRIDE_NAMESPACE, tenantId),
      };
    },

    _normalizeAssetId(value) {
      const normalized = String(value || '').trim();
      return normalized || null;
    },

    _resolveMastrIdentifier(item = {}) {
      return (
        this._normalizeAssetId(item.mastrNumber) ||
        this._normalizeAssetId(item.mastrNummer) ||
        this._normalizeAssetId(item.EinheitMastrNummer) ||
        this._normalizeAssetId(item.einheitMastrNummer) ||
        this._normalizeAssetId(item.id)
      );
    },

    _resolveBusinessAssetId(item = {}) {
      return this._normalizeAssetId(item.assetId) || this._resolveMastrIdentifier(item);
    },

    _isOverrideableField(field) {
      return OVERRIDEABLE_FIELDS.includes(field);
    },

    _isCriticalOverrideField(field) {
      return CRITICAL_OVERRIDE_FIELDS.includes(field);
    },

    _fieldCandidates(field) {
      if (field === 'capacityKW') {
        return ['capacityKW', 'acLeistung', 'bruttoleistung', 'NettoNennleistung'];
      }
      if (field === 'voltageLevel') {
        return ['voltageLevel', 'spannungsebene'];
      }
      if (field === 'commissionDate') {
        return ['commissionDate', 'commissioningDate', 'inbetriebnahmedatum', 'date'];
      }
      if (field === 'direktvermarktungActive') {
        return ['direktvermarktungActive', 'fernsteuerbarkeitDv'];
      }
      return [field];
    },

    _getFieldValue(item, field) {
      const candidates = this._fieldCandidates(field);
      for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(item, key)) {
          return item[key];
        }
      }
      return null;
    },

    _setFieldValue(item, field, value) {
      if (field === 'capacityKW') {
        item.capacityKW = value;
        item.acLeistung = value;
        item.bruttoleistung = value;
        return;
      }
      if (field === 'voltageLevel') {
        item.voltageLevel = value;
        item.spannungsebene = value;
        return;
      }
      if (field === 'commissionDate') {
        item.commissionDate = value;
        item.commissioningDate = value;
        item.inbetriebnahmedatum = value;
        return;
      }
      if (field === 'direktvermarktungActive') {
        item.direktvermarktungActive = value;
        item.fernsteuerbarkeitDv = value === true ? '1' : value === false ? '0' : value;
        return;
      }
      item[field] = value;
    },

    _hashPayload(payload) {
      return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    },

    async _queryOverrideDocs(ctx, selector = {}) {
      const { namespace } = this._getOverrideNamespace(ctx);
      const docs = [];
      const pageSize = 500;
      let skip = 0;

      while (true) {
        const page = await ctx.call('object-store.query', {
          namespace,
          selector,
          limit: pageSize,
          skip,
        });
        const chunk = Array.isArray(page?.docs) ? page.docs : [];
        docs.push(...chunk);
        if (chunk.length < pageSize) break;
        skip += chunk.length;
      }

      return docs.map((doc) => doc.payload).filter(Boolean);
    },

    _getLatestOverride(overrides = []) {
      const sorted = [...overrides].sort((a, b) =>
        String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      );
      return sorted[sorted.length - 1] || null;
    },

    _buildOverrideTrail(overrides = []) {
      return [...overrides]
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
        .map((override) => ({
          id: override.id,
          field: override.field,
          value: override.value,
          approvalStatus: override.approvalStatus,
          approvedBy: override.approvedBy || null,
          approvedAt: override.approvedAt || null,
          supersedes: override.supersedes || null,
          supersedesReverted: override.supersedesReverted === true,
          provenanceHash: override.provenanceHash,
        }));
    },

    _selectActiveOverrides(overrides = [], onlyApproved = true) {
      const byField = new Map();
      const sorted = [...overrides].sort((a, b) =>
        String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      );

      for (const override of sorted) {
        if (override.supersedesReverted === true) continue;
        if (onlyApproved && override.approvalStatus !== 'approved') continue;
        byField.set(override.field, override);
      }

      return [...byField.values()];
    },

    _applyOverrideDocsToInstallation(item, overrides = [], onlyApproved = true) {
      const cloned = { ...item };
      const active = this._selectActiveOverrides(overrides, onlyApproved);
      const appliedOverrideIds = [];

      for (const override of active) {
        this._setFieldValue(cloned, override.field, override.value);
        appliedOverrideIds.push(override.id);
      }

      cloned.assetId = this._resolveBusinessAssetId(cloned);
      cloned.__appliedOverrideIds = appliedOverrideIds;
      return cloned;
    },

    async _applyOverridesToInstallations(ctx, installations = [], onlyApproved = true) {
      if (!Array.isArray(installations) || installations.length === 0) return [];

      const assetIds = new Set();
      for (const item of installations) {
        const businessId = this._resolveBusinessAssetId(item);
        const mastr = this._resolveMastrIdentifier(item);
        if (businessId) assetIds.add(businessId);
        if (mastr) assetIds.add(mastr);
      }

      if (assetIds.size === 0) {
        return installations.map((item) => ({
          ...item,
          assetId: this._resolveBusinessAssetId(item),
          __appliedOverrideIds: [],
        }));
      }

      const lookupIds = [...assetIds];
      const overrideDocs = await this._queryOverrideDocs(ctx, {
        $or: [
          { 'payload.assetId': { $in: lookupIds } },
          { 'payload.mastrNummer': { $in: lookupIds } },
        ],
      });

      return installations.map((item) => {
        const businessId = this._resolveBusinessAssetId(item);
        const mastr = this._resolveMastrIdentifier(item);
        const relevant = overrideDocs.filter(
          (doc) =>
            doc.assetId === businessId ||
            doc.assetId === mastr ||
            doc.mastrNummer === mastr ||
            doc.mastrNummer === businessId
        );
        return this._applyOverrideDocsToInstallation(item, relevant, onlyApproved);
      });
    },

    /**
     * Map a raw MaStR installation item to the canonical German output format.
     *
     * @param {object} item       - Raw installation record from cernion_installations_local
     * @param {string} assetType  - Installation type string (solar|wind|storage|biomass|…|all)
     * @returns {object}          - Mapped output record
     */
    _mapInstallationItem(item, assetType) {
      const mastrNumber =
        item.mastrNumber || item.mastrNummer || item.EinheitMastrNummer || item.id || 'N/A';
      const capacityKW =
        Number(
          item.capacityKW ||
            item.acLeistung ||
            item.bruttoleistung ||
            item.nettonennleistung ||
            item.installierteleistung
        ) || 0;
      const capacityMW = capacityKW / 1000;

      const storageCapacity =
        Number(
          item.storageCapacityKWh ||
            item.nutzbareSpeicherkapazitaet ||
            item.speicherkapazitaet ||
            item.nutzbareKapazitaet
        ) || 0;

      let cRate = null;
      if (assetType === 'storage' && capacityKW > 0 && storageCapacity > 0) {
        cRate = parseFloat((capacityKW / storageCapacity).toFixed(2));
      }

      const inverterPower =
        item.inverterPowerKW || item.wechselrichterleistung
          ? Number(item.inverterPowerKW || item.wechselrichterleistung)
          : null;

      let commissionDate = item.commissioningDate || item.inbetriebnahmedatum || item.date || 'N/A';
      if (commissionDate !== 'N/A' && typeof commissionDate === 'string') {
        commissionDate = commissionDate.split('T')[0];
      }

      const statusCode = item.operationalStatus || item.einheitBetriebsstatus || null;
      const statusName =
        statusCode === '31'
          ? 'Geplant'
          : statusCode === '35'
            ? 'In Betrieb'
            : statusCode === '37'
              ? 'Vorübergehend stillgelegt'
              : statusCode === '38'
                ? 'Endgültig stillgelegt'
                : statusCode
                  ? `Status ${statusCode}`
                  : null;

      const nbpStatus =
        item.netzbetreiberpruefungStatus !== undefined ? item.netzbetreiberpruefungStatus : null;
      const nbpStatusName =
        nbpStatus === 2954
          ? 'Geprüft'
          : nbpStatus === 2955
            ? 'In Prüfung'
            : nbpStatus === 3075
              ? 'Nicht vorgesehen'
              : null;

      return {
        'Asset-ID': item.assetId || mastrNumber,
        'SEE Nummer': mastrNumber,
        'Einheit Systemstatus': item.einheitSystemstatus || item.systemStatus || null,

        Betreiber: item.operatorName || item.operator || item.name || item.betreiber || 'N/A',
        'Marktaktuer MaStR':
          item.marketActorId || item.marktakteurMastrNummer || item.marktakteur || null,
        'Marktakteuer Name':
          item.marketActorName ||
          item.marktakteurName ||
          item.nameMarktakteur ||
          item.marktakteurFirmenname ||
          null,
        'Marktakteur Adresse':
          item.marketActorAddress || item.marktakteurAdresse || item.marktakteurStrasse || null,

        'Netzbetreiber MaStR': item.netzbetreiberMastrNummer || item.gridOperatorMastrId || null,
        'Netzbetreiber Name': item.netzbetreiberName || item.gridOperatorName || null,

        Anlagentyp: assetType,
        'Leistung MW': capacityMW,
        'Leistung kW': capacityKW,
        Wechselrichterleistung: inverterPower,
        Technologie: item.technology || item.technologie || assetType,

        Speicherkapazität: assetType === 'storage' ? storageCapacity : null,
        C_Rate: cRate,
        'AC Nennleistung': item.acNennleistung || item.acNominalPower || null,
        'DC Nennleistung': item.dcNennleistung || item.dcNominalPower || null,
        Batterietechnologie: item.batterietechnologie || item.batteryTechnology || null,
        'Hersteller Batteriemodule':
          item.herstellerBatteriemodule || item.batteryModuleManufacturer || null,

        Hauptausrichtung:
          item.hauptausrichtung || item.hauptAusrichtung || item.orientation || null,
        Neigungswinkel: item.neigungswinkel || item.tiltAngle || null,
        Leistungsbegrenzung: item.leistungsbegrenzung || item.powerLimit || null,

        Nabenhöhe: item.nabenhoehe || item.hubHeight || null,
        Rotordurchmesser: item.rotordurchmesser || item.rotorDiameter || null,
        Hersteller: item.hersteller || item.manufacturer || null,
        Typenbezeichnung: item.typenbezeichnung || item.typeDesignation || null,

        Betriebsstatus: statusCode,
        'Betriebsstatus Name': statusName,
        'Datum Netzzugang': commissionDate,
        Registrierungsdatum: item.registrierungsdatum || item.registrationDate || null,
        Genehmigungsdatum: item.genehmigungsdatum || item.approvalDate || null,

        Kopplung: item.coupling || item.kopplung || (item.connectedToGrid ? 'AC' : 'DC'),
        Einspeiseart: item.feedInType || item.einspeiseart || 'Überschusseinspeisung',
        Spannungsebene: item.spannungsebene || item.voltageLevel || null,
        'Direktvermarktung Aktiv':
          item.direktvermarktungActive !== undefined ? item.direktvermarktungActive : null,
        Fernsteuerbarkeit: item.fernsteuerbarkeit || item.remoteControllability || null,
        Einsatzverantwortlicher: item.einsatzverantwortlicher || item.deploymentResponsible || null,

        Postleitzahl: item.postleitzahl || item.postalCode || null,
        Ort: item.ort || item.city || null,
        Gemeinde: item.gemeinde || item.municipality || null,
        Landkreis: item.landkreis || item.district || null,
        Bundesland: item.bundesland || item.state || null,
        Längengrad: item.laengengrad || item.longitude || null,
        Breitengrad: item.breitengrad || item.latitude || null,

        Fläche: item.inAnspruchGenommeneFlaeche || item.usedArea || null,
        'Anzahl Module': item.anzahlModule || item.moduleCount || null,
        'Leistung je Modul': item.leistungJeModul || item.powerPerModule || null,

        'Netzbetreiberpruefung Status': nbpStatus,
        'Netzbetreiberpruefung Status Name': nbpStatusName,

        'NAP MaStR Nummer': item.napData?.napMastrNummer || null,
        'Messlokation (MeLo)': item.napData?.messlokation || null,
        'Spannungsebene NAP': item.napData?.spannungsebeneLabel || null,
        'Nettoengpassleistung kW':
          item.napData?.nettoengpassleistung != null ? item.napData.nettoengpassleistung : null,
        'Netz MaStR Nummer': item.napData?.netzMastrNummer || null,
        'Netzbetreiber NAP MaStR': item.napData?.netzbetreiberMastrNummer || null,

        // Direktvermarktung fields (populated when item originates from a direktvermarkter query)
        Direktvermarkter: item.direktvermarkterName || null,
        'Direktvermarkter MaStR': item.direktvermarkterMastrNummer || null,
        'Direktvermarktung Beginn': item.direktvermarktungBeginn || null,
        'Direktvermarktung Status': item.direktvermarktungStatus || null,
      };
    },

    /**
     * Shared handler for fetching assets
     */
    async _fetchAssets(ctx, assetTypes) {
      const {
        vnbName,
        bdewCode,
        gridOperatorId,
        location,
        commissioningYear,
        minCapacityKW,
        maxCapacityKW,
        limit,
        offset,
        redispatch,
        operationalStatus,
        netzbetreiberPruefungStatus,
        format,
        includeNapData,
        updatedAfter,
      } = ctx.params;

      if (!vnbName && !bdewCode && !gridOperatorId && !location) {
        throw new Error(
          'Please provide either "vnbName", "bdewCode", "gridOperatorId", or "location".'
        );
      }

      // Redispatch 2.0 convenience: minCapacityKW=100 if redispatch=true
      const effectiveMinCapacity = redispatch ? 100 : minCapacityKW;

      // Resolve VNB name/BDEW code to MaStR Netzbetreiber-ID via market partners
      let resolvedMastrId = gridOperatorId;
      let resolvedBdewCode = bdewCode;

      if (!gridOperatorId && (vnbName || bdewCode)) {
        const searchQuery = bdewCode || vnbName;
        this.logger.info(`Resolving MaStR Netzbetreiber-ID for: ${searchQuery}`);

        try {
          const { callWithAutoPoll } = require('../src/async-job-poller');

          if (bdewCode) {
            this.logger.info(
              `Using BDEW code directly (resolved by installations_local): ${bdewCode}`
            );
          }

          if (!resolvedMastrId && vnbName) {
            this.logger.info(`Falling back to cernion_market_partners for VNB name: ${vnbName}`);

            const result = await callWithAutoPoll(
              'cernion_market_partners',
              { query: vnbName, limit: 5 },
              {
                maxWaitTime: 2 * 60 * 1000,
                pollInterval: 2000,
              },
              ctx.meta.cernionToken
            );

            if (result?.success && result?.data) {
              let jsonData = null;

              if (typeof result.data === 'object' && !Array.isArray(result.data)) {
                jsonData = result.data;
              } else {
                const rawText =
                  typeof result.data === 'string' ? result.data : JSON.stringify(result.data);

                try {
                  const jsonMatch =
                    rawText.match(/```json\s*([\s\S]*?)\s*```/) || rawText.match(/\{[\s\S]*\}/);
                  if (jsonMatch) {
                    jsonData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                  }
                } catch (err) {
                  this.logger?.warn(
                    `[assets.service] silent-catch-fallback (line 803): ${err && err.message}`
                  );
                  const bdewMatch =
                    rawText.match(/BDEW[:\s]*(\d{13})/i) || rawText.match(/\b(\d{13})\b/);
                  if (bdewMatch && !resolvedBdewCode) {
                    resolvedBdewCode = bdewMatch[1];
                  }
                }
              }

              if (jsonData) {
                const results = jsonData.results || jsonData.marketPartners || [];

                if (results.length > 0) {
                  const firstMatch = results[0];

                  // cernion_market_partners sometimes annotates the MaStR ID:
                  // "SNB935578300972 (strom, 100% Match)" → strip to "SNB935578300972".
                  // cernion_installations_local cannot match annotated IDs and
                  // silently returns 0 results when the annotation is present.
                  const rawMastrId =
                    firstMatch.mastrNetzbetreiberId || firstMatch.mastrId || firstMatch.mastr_id;
                  resolvedMastrId = rawMastrId ? rawMastrId.split(' ')[0].trim() : null;

                  if (!resolvedMastrId && typeof firstMatch.mastrIds === 'object') {
                    const mastrIds = firstMatch.mastrIds;
                    resolvedMastrId = mastrIds.SNB || mastrIds.GNB || mastrIds.snb || mastrIds.gnb;
                  }

                  const responseBdewCode = firstMatch.bdew || firstMatch.bdewCode;
                  if (responseBdewCode) {
                    resolvedBdewCode = responseBdewCode;
                  }

                  this.logger.info(
                    `Resolved: MaStR ID=${resolvedMastrId}, BDEW=${resolvedBdewCode}`
                  );
                }
              }
            }
          }
        } catch (err) {
          this.logger.warn(
            `VNB/Market partners search failed for "${searchQuery}": ${err.message}`
          );
        }
      }

      // Guard: if a VNB name was provided but could not be resolved to any MaStR ID or BDEW code,
      // refuse to execute without a VNB filter. cernion_installations_local does NOT implement
      // gridOperatorName fuzzy search — passing it silently ignores the filter and returns ALL
      // installations of the requested type in Germany (potentially millions of records).
      // This prevents session-oversize crashes (RangeError: Invalid string length in saveSession).
      if (!resolvedMastrId && !resolvedBdewCode && vnbName && !location && !gridOperatorId) {
        const notFoundErr = new Error(
          `Netzbetreiber "${vnbName}" konnte im MaStR nicht gefunden werden ` +
            `(cernion_market_partners lieferte 0 Treffer). ` +
            `Bitte BDEW-Code oder MaStR-SNB direkt angeben, oder den Namen prüfen.`
        );
        notFoundErr.code = 'VNB_NOT_FOUND';
        throw notFoundErr;
      }

      // Fetch assets for each type
      const allResults = [];
      // Bug fix (#274): energy-market.installations already reports
      // locationResolutionWarning when `location` is a free-text city/region
      // it cannot resolve to a postal code (see fix for cernion-openclaw-sidecar
      // issues/1). This loop previously discarded that field while flattening
      // `result.data.installations` into `allResults`, so a non-PLZ location
      // silently produced a bare `[]` indistinguishable from "0 real assets".
      let locationResolutionWarning = null;

      for (const assetType of assetTypes) {
        const callParams = {
          installationType: assetType,
        };

        if (location) {
          const normalizedLocation = String(location).trim();
          if (/^\d{5}$/.test(normalizedLocation)) {
            callParams.postleitzahl = normalizedLocation;
          } else {
            callParams.location = normalizedLocation;
          }
        }
        if (commissioningYear) callParams.commissioningYear = commissioningYear;
        if (effectiveMinCapacity !== undefined) callParams.minCapacityKW = effectiveMinCapacity;
        if (maxCapacityKW !== undefined) callParams.maxCapacityKW = maxCapacityKW;
        if (limit !== undefined) callParams.limit = limit;
        if (offset !== undefined) callParams.offset = offset;
        if (operationalStatus !== undefined) callParams.operationalStatus = operationalStatus;
        if (netzbetreiberPruefungStatus !== undefined)
          callParams.netzbetreiberPruefungStatus = netzbetreiberPruefungStatus;
        callParams.includeNapData = includeNapData;
        if (updatedAfter !== undefined) callParams.updatedAfter = updatedAfter;

        // VNB filtering now supported for all types (netzbetreiberMastrNummer added to database)
        if (resolvedMastrId) {
          callParams.gridOperatorId = resolvedMastrId;
        } else if (resolvedBdewCode) {
          callParams.gridOperatorBdewCode = resolvedBdewCode;
        } else if (vnbName && !location) {
          callParams.gridOperatorName = vnbName;
        }

        try {
          const result = await ctx.call('energy-market.installations', callParams);

          if (result?.data?.error) {
            const errorMsg = result.data.error;
            const details = result.data.details || '';
            const suggestions = result.data.suggestions
              ? '\n\nSuggestions:\n' + result.data.suggestions.map((s) => `- ${s}`).join('\n')
              : '';
            throw new Error(`${errorMsg}: ${details}${suggestions}`);
          }

          if (result?.success === false) {
            const message = result?.error?.message || 'Upstream MCP tool error.';
            throw new Error(message);
          }

          if (result?.data?.locationResolutionWarning && !locationResolutionWarning) {
            locationResolutionWarning = result.data.locationResolutionWarning;
          }

          let items = [];
          if (result) {
            if (Array.isArray(result)) {
              items = result;
            } else if (result.data) {
              if (Array.isArray(result.data)) items = result.data;
              else if (Array.isArray(result.data.results)) items = result.data.results;
              else if (Array.isArray(result.data.installations)) items = result.data.installations;
            } else if (Array.isArray(result.results)) {
              items = result.results;
            } else if (Array.isArray(result.installations)) {
              items = result.installations;
            }
          }

          if (
            items.length === 1 &&
            items[0] &&
            items[0].type === 'text' &&
            typeof items[0].text === 'string' &&
            items[0].text.toLowerCase().includes('error')
          ) {
            throw new Error(items[0].text);
          }

          const effectiveItems = await this._applyOverridesToInstallations(ctx, items, true);

          // Map items to German output format using shared _mapInstallationItem
          const mappedItems = effectiveItems.map((item) =>
            this._mapInstallationItem(item, assetType)
          );

          allResults.push(...mappedItems);
        } catch (err) {
          this.logger.error(`Failed to fetch ${assetType} assets:`, err);
          if (assetTypes.length === 1) {
            throw new Error(`Error extracting asset list: ${err.message}`);
          }
          // Continue with other types if fetching multiple
        }
      }

      // Handle CSV export if requested
      if (format === 'csv') {
        const csvContent = this.convertToCSV(allResults);

        // Set response headers for CSV download
        ctx.meta.$responseHeaders = {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="assets-${Date.now()}.csv"`,
        };

        return csvContent;
      }

      // Handle XLSX export if requested
      if (format === 'xlsx') {
        const xlsxBuffer = convertToXLSX(allResults, 'Assets');

        // Set response headers for XLSX download
        ctx.meta.$responseHeaders = {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="assets-${Date.now()}.xlsx"`,
        };

        return xlsxBuffer;
      }

      // Bug fix (#274): surface the location-resolution failure instead of a bare
      // empty array that a consuming agent could mistake for "0 real assets".
      // Only changes shape when resolution genuinely failed — a successful query
      // (including a real 0-result query against a resolvable PLZ) still returns
      // the plain array unchanged.
      if (locationResolutionWarning) {
        return { success: true, data: allResults, locationResolutionWarning };
      }

      return allResults;
    },
  },

  /**
   * Actions
   */
  actions: {
    /**
     * override
     */
    override: {
      rest: 'POST /:assetId/override',
      params: {
        assetId: { type: 'string', min: 1 },
        field: { type: 'string', min: 1 },
        value: { type: 'any' },
        reason: { type: 'string', min: 1 },
        approvedBy: { type: 'enum', values: ['user', 'agent'], optional: true, default: 'user' },
        mastrNummer: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Create persistent asset override',
        description:
          'Creates a tenant-scoped asset override with provenance hash. ' +
          'Critical fields are persisted with `pendingApproval` and linked HITL item.',
        tags: ['Assets'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['assetId', 'field', 'value', 'reason'],
                properties: {
                  assetId: { type: 'string', example: 'SEE900123456789' },
                  mastrNummer: { type: 'string', example: 'SEE900123456789' },
                  field: { type: 'string', example: 'capacityKW' },
                  value: { example: 1250 },
                  reason: { type: 'string', example: 'Manual correction from operator' },
                  approvedBy: { type: 'string', enum: ['user', 'agent'], example: 'user' },
                },
              },
              examples: {
                default: {
                  value: {
                    assetId: 'SEE900123456789',
                    field: 'capacityKW',
                    value: 1250,
                    reason: 'Manual correction from operator',
                    approvedBy: 'user',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const assetId = this._normalizeAssetId(ctx.params.assetId);
        const field = String(ctx.params.field || '').trim();
        const reason = String(ctx.params.reason || '').trim();

        if (!assetId) {
          throw new MoleculerClientError('assetId is required', 400, 'ASSET_ID_REQUIRED');
        }
        if (!this._isOverrideableField(field)) {
          throw new MoleculerClientError(
            `Unsupported override field "${field}"`,
            400,
            'ASSET_OVERRIDE_FIELD_NOT_ALLOWED',
            { allowedFields: OVERRIDEABLE_FIELDS }
          );
        }
        if (!reason) {
          throw new MoleculerClientError(
            'reason is required',
            400,
            'ASSET_OVERRIDE_REASON_REQUIRED'
          );
        }

        const isCritical = this._isCriticalOverrideField(field);
        const now = new Date().toISOString();
        const { tenantId, namespace } = this._getOverrideNamespace(ctx);
        const mastrNummer = this._normalizeAssetId(ctx.params.mastrNummer) || assetId;

        const existing = await this._queryOverrideDocs(ctx, {
          $or: [{ 'payload.assetId': assetId }, { 'payload.mastrNummer': mastrNummer }],
        });
        const sameField = existing.filter((doc) => doc.field === field);
        const previous = this._getLatestOverride(sameField);
        const supersedes = previous ? previous.id : null;
        const previousValue = previous ? previous.value : null;

        const idSeed = `${assetId}:${field}:${JSON.stringify(ctx.params.value)}:${now}`;
        const id = `ovr_${assetId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${this._hashPayload(idSeed).slice(0, 8)}`;

        const overrideDoc = {
          _id: id,
          id,
          assetId,
          mastrNummer,
          field,
          previousValue,
          value: ctx.params.value,
          reason,
          approvedBy: isCritical ? null : ctx.params.approvedBy,
          approvedAt: isCritical ? null : now,
          approvalStatus: isCritical ? 'pendingApproval' : 'approved',
          hitlItemId: null,
          hitlItem: null,
          appliedAt: isCritical ? null : now,
          agent_interventions: [
            {
              at: now,
              actor: ctx.params.approvedBy,
              action: 'override-created',
              field,
              reason,
            },
          ],
          supersedes,
          supersedesReverted: false,
          tenantId,
          createdAt: now,
          updatedAt: now,
        };

        if (isCritical) {
          const hitlResult = await ctx.call('hitl.create', {
            kind: 'asset-override-approval',
            originService: 'assets',
            originAction: 'override',
            severity: 'warning',
            payload: {
              overrideId: id,
              assetId,
              mastrNummer,
              field,
              value: ctx.params.value,
              reason,
            },
          });
          overrideDoc.hitlItemId = hitlResult?.item?.id || null;
          overrideDoc.hitlItem = hitlResult?.item || null;
        }

        overrideDoc.provenanceHash = this._hashPayload({
          id: overrideDoc.id,
          assetId: overrideDoc.assetId,
          mastrNummer: overrideDoc.mastrNummer,
          field: overrideDoc.field,
          value: overrideDoc.value,
          reason: overrideDoc.reason,
          approvalStatus: overrideDoc.approvalStatus,
          hitlItemId: overrideDoc.hitlItemId,
          supersedes: overrideDoc.supersedes,
          tenantId: overrideDoc.tenantId,
          createdAt: overrideDoc.createdAt,
        });

        await ctx.call('object-store.put', {
          namespace,
          key: id,
          payload: overrideDoc,
        });

        return {
          success: true,
          pendingApproval: isCritical,
          override: overrideDoc,
          hitlItem: overrideDoc.hitlItem,
        };
      },
    },

    overrides: {
      rest: 'GET /:assetId/overrides',
      params: {
        assetId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'List all overrides for an asset',
        tags: ['Assets'],
        parameters: [
          {
            name: 'assetId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'SEE900123456789' },
          },
        ],
      },
      async handler(ctx) {
        const assetId = this._normalizeAssetId(ctx.params.assetId);
        const docs = await this._queryOverrideDocs(ctx, {
          $or: [{ 'payload.assetId': assetId }, { 'payload.mastrNummer': assetId }],
        });
        const sorted = [...docs].sort((a, b) =>
          String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
        );

        return {
          success: true,
          assetId,
          count: sorted.length,
          overrides: sorted,
        };
      },
    },

    effective: {
      rest: 'GET /:assetId/effective',
      params: {
        assetId: { type: 'string', min: 1 },
        vnbName: { type: 'string', optional: true },
        bdewCode: { type: 'string', optional: true, convert: true },
        gridOperatorId: { type: 'string', optional: true, convert: true },
        location: { type: 'string', optional: true },
        assetType: {
          type: 'enum',
          values: ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion', 'all'],
          optional: true,
          default: 'all',
        },
      },
      openapi: {
        summary: 'Get effective asset view (MaStR + applied overrides)',
        tags: ['Assets'],
        parameters: [
          {
            name: 'assetId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'SEE900123456789' },
          },
          {
            name: 'vnbName',
            in: 'query',
            schema: { type: 'string', example: 'STROMDAO Netze' },
          },
          {
            name: 'bdewCode',
            in: 'query',
            schema: { type: 'string', example: '9907473000008' },
          },
          {
            name: 'gridOperatorId',
            in: 'query',
            schema: { type: 'string', example: 'SNB935578300972' },
          },
          {
            name: 'location',
            in: 'query',
            schema: { type: 'string', example: 'Ludwigshafen' },
          },
          {
            name: 'assetType',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion', 'all'],
              default: 'all',
            },
          },
        ],
      },
      async handler(ctx) {
        const assetId = this._normalizeAssetId(ctx.params.assetId);
        if (isDemoAssetId(assetId)) {
          const demoAsset = getDemoAsset(assetId);
          if (demoAsset) return demoAsset;
        }

        const assetType = ctx.params.assetType || 'all';
        const assetTypes =
          assetType === 'all'
            ? ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion']
            : [assetType];

        // _fetchAssets returns a bare array normally, or { data, locationResolutionWarning }
        // when `location` couldn't be resolved to a postal code (#274) — normalize either way.
        const fetchResult = await this._fetchAssets(ctx, assetTypes);
        const records = Array.isArray(fetchResult) ? fetchResult : fetchResult.data || [];
        const asset = records.find(
          (item) => item['Asset-ID'] === assetId || item['SEE Nummer'] === assetId
        );
        if (!asset) {
          throw new MoleculerClientError(
            `Asset "${assetId}" not found in provided scope`,
            404,
            'ASSET_NOT_FOUND'
          );
        }

        const docs = await this._queryOverrideDocs(ctx, {
          $or: [{ 'payload.assetId': assetId }, { 'payload.mastrNummer': asset['SEE Nummer'] }],
        });

        return {
          success: true,
          assetId,
          sourceTrail: {
            source: 'mastr+overrides',
            appliedOverrides: this._buildOverrideTrail(this._selectActiveOverrides(docs, true)),
          },
          asset,
        };
      },
    },

    applyOverride: {
      rest: 'POST /:assetId/overrides/:id/apply',
      params: {
        assetId: { type: 'string', min: 1 },
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Apply a persisted override after approval',
        tags: ['Assets'],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['assetId', 'id'],
                properties: {
                  assetId: { type: 'string', example: 'SEE900123456789' },
                  id: { type: 'string', example: 'ovr_SEE900123456789_1a2b3c4d' },
                },
              },
              examples: {
                default: {
                  value: {
                    assetId: 'SEE900123456789',
                    id: 'ovr_SEE900123456789_1a2b3c4d',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const assetId = this._normalizeAssetId(ctx.params.assetId);
        const id = String(ctx.params.id || '').trim();
        const { namespace } = this._getOverrideNamespace(ctx);
        const stored = await ctx.call('object-store.get', { namespace, key: id });
        const override = stored?.payload;

        if (!override) {
          throw new MoleculerClientError(
            `Override "${id}" not found`,
            404,
            'ASSET_OVERRIDE_NOT_FOUND'
          );
        }
        if (override.assetId !== assetId && override.mastrNummer !== assetId) {
          throw new MoleculerClientError(
            'Override does not belong to assetId',
            400,
            'ASSET_OVERRIDE_ASSET_MISMATCH'
          );
        }

        const now = new Date().toISOString();
        if (override.approvalStatus === 'pendingApproval' && override.hitlItemId) {
          const hitl = await ctx.call('hitl.get', { id: override.hitlItemId });
          const hitlStatus = String(hitl?.item?.status || '').toLowerCase();
          if (hitlStatus === 'approved') {
            override.approvalStatus = 'approved';
            override.approvedAt = now;
            override.approvedBy = 'user';
            override.appliedAt = now;
          } else {
            return {
              success: true,
              pendingApproval: true,
              override,
            };
          }
        }

        if (override.approvalStatus === 'approved') {
          override.appliedAt = override.appliedAt || now;
          override.updatedAt = now;
          override.agent_interventions = Array.isArray(override.agent_interventions)
            ? override.agent_interventions
            : [];
          override.agent_interventions.push({
            at: now,
            actor: 'agent',
            action: 'override-applied',
          });

          override.provenanceHash = this._hashPayload({
            id: override.id,
            assetId: override.assetId,
            approvalStatus: override.approvalStatus,
            appliedAt: override.appliedAt,
            updatedAt: override.updatedAt,
            tenantId: override.tenantId,
          });

          await ctx.call('object-store.put', { namespace, key: id, payload: override });
        }

        return {
          success: true,
          pendingApproval: override.approvalStatus !== 'approved',
          override,
        };
      },
    },

    removeOverride: {
      rest: 'DELETE /:assetId/overrides/:id',
      params: {
        assetId: { type: 'string', min: 1 },
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Soft-revert an override',
        tags: ['Assets'],
      },
      async handler(ctx) {
        const assetId = this._normalizeAssetId(ctx.params.assetId);
        const id = String(ctx.params.id || '').trim();
        const { namespace } = this._getOverrideNamespace(ctx);
        const stored = await ctx.call('object-store.get', { namespace, key: id });
        const override = stored?.payload;

        if (!override) {
          throw new MoleculerClientError(
            `Override "${id}" not found`,
            404,
            'ASSET_OVERRIDE_NOT_FOUND'
          );
        }
        if (override.assetId !== assetId && override.mastrNummer !== assetId) {
          throw new MoleculerClientError(
            'Override does not belong to assetId',
            400,
            'ASSET_OVERRIDE_ASSET_MISMATCH'
          );
        }

        const now = new Date().toISOString();
        override.supersedesReverted = true;
        override.revertedAt = now;
        override.updatedAt = now;
        override.agent_interventions = Array.isArray(override.agent_interventions)
          ? override.agent_interventions
          : [];
        override.agent_interventions.push({
          at: now,
          actor: 'user',
          action: 'override-soft-reverted',
        });
        override.provenanceHash = this._hashPayload({
          id: override.id,
          supersedesReverted: true,
          revertedAt: override.revertedAt,
          tenantId: override.tenantId,
        });

        await ctx.call('object-store.put', { namespace, key: id, payload: override });
        return { success: true, id, supersedesReverted: true };
      },
    },

    applyOverridesToInstallations: {
      params: {
        installations: { type: 'array', optional: true, default: [] },
        onlyApproved: { type: 'boolean', optional: true, default: true },
      },
      async handler(ctx) {
        const installations = Array.isArray(ctx.params.installations)
          ? ctx.params.installations
          : [];
        const effectiveInstallations = await this._applyOverridesToInstallations(
          ctx,
          installations,
          ctx.params.onlyApproved
        );
        return {
          success: true,
          installations: effectiveInstallations,
        };
      },
    },

    /**
     * list
     *
     * Extracts detailed asset list for a VNB.
     *
     * @param {String} vnbName - Name of the VNB
     * @param {String} bdewCode - BDEW Code of the VNB
     * @param {String} assetType - Type of asset (solar, wind, storage, etc.)
     * @param {String} location - City/Region/PLZ for narrowing search
     * @param {Number} commissioningYear - Filter by commissioning year
     * @param {Number} minCapacityKW - Minimum capacity filter
     * @param {Number} maxCapacityKW - Maximum capacity filter
     * @param {Number} limit - Limit results
     * @param {Boolean} redispatch - Redispatch 2.0 filter (sets minCapacityKW=100)
     */
    list: {
      rest: 'GET /list',
      params: {
        vnbName: {
          type: 'string',
          optional: true,
          description: 'Name of the Distribution Network Operator',
        },
        bdewCode: {
          type: 'string',
          optional: true,
          convert: true, // Convert number to string if passed as numeric value from URL
          description: 'BDEW Code of the VNB',
        },
        gridOperatorId: {
          type: 'string',
          optional: true,
          convert: true, // Convert number to string if passed as numeric value from URL
          description: 'MaStR Grid Operator ID (SNB/GNB)',
        },
        assetType: {
          type: 'enum',
          values: ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion'],
          description: 'Type of asset to extract',
        },
        location: {
          type: 'string',
          optional: true,
          min: 1,
          description: 'City, region or postal code to narrow search',
        },
        commissioningYear: {
          type: 'number',
          optional: true,
          min: 1900,
          max: 2100,
          convert: true,
        },
        minCapacityKW: {
          type: 'number',
          optional: true,
          min: 0,
          convert: true,
        },
        maxCapacityKW: {
          type: 'number',
          optional: true,
          min: 0,
          convert: true,
        },
        limit: {
          type: 'any',
          optional: true,
        },
        offset: {
          type: 'number',
          optional: true,
          min: 0,
          convert: true,
        },
        redispatch: {
          type: 'boolean',
          optional: true,
          convert: true,
          description: 'Redispatch 2.0 filter (automatically sets minCapacityKW=100)',
        },
        operationalStatus: {
          type: 'string',
          optional: true,
          default: '35',
          description:
            'Operational status filter: 31=Planned, 35=In operation (default), 37=Temporarily decommissioned, 38=Permanently decommissioned, all=All statuses, or comma-separated list',
        },
        netzbetreiberPruefungStatus: {
          type: 'string',
          optional: true,
          convert: true,
          description:
            'Grid operator verification status filter: 2954=Geprüft, 2955=In Prüfung, 3075=Nicht vorgesehen. Can be comma-separated.',
        },
        includeNapData: {
          type: 'boolean',
          optional: true,
          default: true,
          convert: true,
          description:
            'Include NAP (Netzanschlusspunkt) data: MeLo, voltage level, grid bottleneck capacity. Default: true',
        },
        updatedAfter: {
          type: 'string',
          optional: true,
          convert: true,
          description:
            'ISO date string (e.g. "2026-03-24"). Returns only installations updated after this date (MaStR: DatumLetzteMeldung).',
        },
      },
      openapi: {
        operationId: 'assets_list',
        summary: 'List assets of a distribution network operator (DNO/DSO)',
        description:
          'Retrieves complete installation data from the German Marktstammdatenregister (MaStR). Supports filtering by grid operator (BDEW code or name), asset type, capacity, commissioning year, and operational status. **Default behavior: Only active installations (status 35 - In operation) are returned.** No pagination required - can retrieve millions of installations.',
        tags: ['Assets'],
        // @OpenEnergyPlatform/ontology — OEO_00000031 power plant
        [OEO_CLASS_KEY]: [OEO_URL_POWER_PLANT],
        parameters: [
          {
            name: 'vnbName',
            in: 'query',
            schema: { type: 'string', example: 'Netze BW' },
            description: 'Name of the distribution network operator (fuzzy matching supported)',
          },
          {
            name: 'bdewCode',
            in: 'query',
            schema: { type: 'string', example: '4041407000008' },
            description: 'BDEW code (13 digits) - more precise than name',
          },
          {
            name: 'gridOperatorId',
            in: 'query',
            schema: { type: 'string', example: 'SNB948311994307' },
            description: 'MaStR grid operator ID (SNB/GNB format) - direct ID without resolution',
          },
          {
            name: 'assetType',
            in: 'query',
            required: true,
            schema: {
              type: 'string',
              enum: ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion'],
              example: 'solar',
            },
            description:
              'Asset type: solar (PV), wind, storage (battery), biomass (biogas), hydro (hydropower), combustion',
          },
          {
            name: 'location',
            in: 'query',
            schema: { type: 'string', example: 'Heidelberg' },
            description: 'City/region/postal code for geographic filtering (optional)',
          },
          {
            name: 'commissioningYear',
            in: 'query',
            schema: { type: 'number', example: 2020 },
            description: 'Filter by commissioning year (optional)',
          },
          {
            name: 'minCapacityKW',
            in: 'query',
            schema: { type: 'number', example: 100 },
            description: 'Minimum capacity in kW (optional)',
          },
          {
            name: 'maxCapacityKW',
            in: 'query',
            schema: { type: 'number', example: 10000 },
            description: 'Maximum capacity in kW (optional)',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'number', default: 1000, example: 1000 },
            description: PARAM_DESC_LIMIT,
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'number', default: 0, minimum: 0, example: 0 },
            description:
              'Pagination offset — number of records to skip. Use with `limit` to page through large result sets (e.g. `offset=1000&limit=1000` fetches records 1,001–2,000).',
          },
          {
            name: 'redispatch',
            in: 'query',
            schema: { type: 'boolean', example: true },
            description:
              'Redispatch 2.0 filter: Only installations ≥100kW (automatically sets minCapacityKW=100)',
          },
          {
            name: 'operationalStatus',
            in: 'query',
            schema: { type: 'string', default: '35', example: '35' },
            description: PARAM_DESC_OP_STATUS,
          },
          {
            name: 'netzbetreiberPruefungStatus',
            in: 'query',
            schema: { type: 'string', example: '2955' },
            description: PARAM_DESC_PRUEFUNG_STATUS,
          },
          {
            name: 'includeNapData',
            in: 'query',
            schema: { type: 'boolean', default: true, example: true },
            description:
              'Include NAP data (Netzanschlusspunkt): MeLo, voltage level, grid bottleneck capacity. Default: true. Set to false to speed up large queries.',
          },
          {
            name: 'updatedAfter',
            in: 'query',
            schema: { type: 'string', format: 'date', example: EXAMPLE_DATE },
            description:
              'ISO date (YYYY-MM-DD or full ISO 8601). Returns only installations where DatumLetzteMeldung (MaStR last-notification date) is after this date. Useful for incremental sync.',
          },
        ],
        responses: {
          200: {
            description: 'List of installations with complete MaStR data',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      // Core identification
                      'SEE Nummer': {
                        type: 'string',
                        description: 'MaStR unit ID (SEE/SBE/SWE format)',
                        example: 'SEE913735587817',
                      },
                      'Einheit Systemstatus': {
                        type: 'string',
                        nullable: true,
                        description: 'System status of the unit',
                      },

                      // Operator information
                      Betreiber: {
                        type: 'string',
                        description: 'Name of the installation operator',
                        example: 'PVA Langenenslingen',
                      },
                      'Marktaktuer MaStR': {
                        type: 'string',
                        nullable: true,
                        description: 'MaStR ID of direct marketer',
                      },
                      'Marktakteuer Name': {
                        type: 'string',
                        nullable: true,
                        description: 'Name of direct marketer',
                      },
                      'Marktakteur Adresse': {
                        type: 'string',
                        nullable: true,
                        description: 'Address of direct marketer',
                      },

                      // Grid operator information
                      'Netzbetreiber MaStR': {
                        type: 'string',
                        nullable: true,
                        description: 'MaStR ID of grid operator',
                      },
                      'Netzbetreiber Name': {
                        type: 'string',
                        nullable: true,
                        description: PARAM_DESC_VNB_NAME,
                      },

                      // Technical specifications
                      Anlagentyp: {
                        type: 'string',
                        description: 'Type of installation',
                        enum: ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion'],
                      },
                      'Leistung MW': {
                        type: 'number',
                        description: 'Gross capacity in megawatts (MW)',
                        example: 80.3088,
                      },
                      'Leistung kW': {
                        type: 'number',
                        description: 'Gross capacity in kilowatts (kW)',
                        example: 80308.8,
                      },
                      Wechselrichterleistung: {
                        type: 'number',
                        nullable: true,
                        description: 'Inverter capacity in kW (PV/storage only)',
                      },
                      Technologie: {
                        type: 'string',
                        description: 'Technology type (e.g., solar, wind)',
                        example: 'solar',
                      },

                      // Storage-specific fields
                      Speicherkapazität: {
                        type: 'number',
                        nullable: true,
                        description: 'Usable storage capacity in kWh (storage only)',
                      },
                      C_Rate: {
                        type: 'number',
                        nullable: true,
                        description: 'C-Rate for storage (power/capacity)',
                      },
                      'AC Nennleistung': {
                        type: 'number',
                        nullable: true,
                        description: 'AC nominal power in kW (storage only)',
                      },
                      'DC Nennleistung': {
                        type: 'number',
                        nullable: true,
                        description: 'DC nominal power in kW (storage only)',
                      },
                      Batterietechnologie: {
                        type: 'string',
                        nullable: true,
                        description: 'Battery technology type (storage only)',
                      },
                      'Hersteller Batteriemodule': {
                        type: 'string',
                        nullable: true,
                        description: 'Battery module manufacturer (storage only)',
                      },

                      // Solar-specific fields
                      Hauptausrichtung: {
                        type: 'string',
                        nullable: true,
                        description: 'Main orientation (solar only, e.g., Süd, Ost-West)',
                      },
                      Neigungswinkel: {
                        type: 'number',
                        nullable: true,
                        description: 'Tilt angle in degrees (solar only)',
                      },
                      Leistungsbegrenzung: {
                        type: 'string',
                        nullable: true,
                        description: 'Power limitation (solar only)',
                      },

                      // Wind-specific fields
                      Nabenhöhe: {
                        type: 'number',
                        nullable: true,
                        description: 'Hub height in meters (wind only)',
                      },
                      Rotordurchmesser: {
                        type: 'number',
                        nullable: true,
                        description: 'Rotor diameter in meters (wind only)',
                      },
                      Hersteller: {
                        type: 'string',
                        nullable: true,
                        description: 'Manufacturer (wind only)',
                      },
                      Typenbezeichnung: {
                        type: 'string',
                        nullable: true,
                        description: 'Type designation (wind only)',
                      },

                      // Status and dates
                      Betriebsstatus: {
                        type: 'string',
                        description:
                          'Operational status code: 31=Planned, 35=In operation, 37=Temporarily decommissioned, 38=Permanently decommissioned',
                        example: '35',
                        nullable: true,
                      },
                      'Betriebsstatus Name': {
                        type: 'string',
                        description: 'Operational status name in German',
                        example: 'In Betrieb',
                        nullable: true,
                      },
                      'Datum Netzzugang': {
                        type: 'string',
                        format: 'date',
                        description: 'Commissioning date (ISO 8601)',
                        example: '2025-05-27',
                      },
                      Registrierungsdatum: {
                        type: 'string',
                        format: 'date',
                        nullable: true,
                        description: 'Registration date',
                      },
                      Genehmigungsdatum: {
                        type: 'string',
                        format: 'date',
                        nullable: true,
                        description: 'Approval date',
                      },

                      // Grid connection
                      Kopplung: {
                        type: 'string',
                        nullable: true,
                        description: 'AC/DC coupling (storage only)',
                      },
                      Einspeiseart: {
                        type: 'string',
                        nullable: true,
                        description: 'Feed-in type (e.g., full feed-in, surplus feed-in)',
                        example: 'Überschusseinspeisung',
                      },
                      Spannungsebene: {
                        type: 'string',
                        nullable: true,
                        description: 'Voltage level (NS/MS/HS)',
                      },
                      Fernsteuerbarkeit: {
                        type: 'string',
                        nullable: true,
                        description: 'Remote controllability',
                      },
                      Einsatzverantwortlicher: {
                        type: 'string',
                        nullable: true,
                        description: 'Deployment responsible party',
                      },

                      // Location information
                      Postleitzahl: {
                        type: 'string',
                        nullable: true,
                        description: 'Postal code of installation location',
                        example: '88515',
                      },
                      Ort: {
                        type: 'string',
                        nullable: true,
                        description: 'City of installation location',
                        example: 'Langenenslingen',
                      },
                      Gemeinde: {
                        type: 'string',
                        nullable: true,
                        description: 'Municipality of installation location',
                        example: 'Langenenslingen',
                      },
                      Landkreis: {
                        type: 'string',
                        nullable: true,
                        description: 'District of installation location',
                        example: 'Biberach',
                      },
                      Bundesland: {
                        type: 'string',
                        nullable: true,
                        description: 'Federal state code',
                        example: '1402',
                      },
                      Längengrad: {
                        type: 'number',
                        nullable: true,
                        description: 'Longitude coordinate',
                      },
                      Breitengrad: {
                        type: 'number',
                        nullable: true,
                        description: 'Latitude coordinate',
                      },

                      // Additional fields
                      Fläche: { type: 'number', nullable: true, description: 'Used area in m²' },
                      'Anzahl Module': {
                        type: 'number',
                        nullable: true,
                        description: 'Number of modules (solar only)',
                      },
                      'Leistung je Modul': {
                        type: 'number',
                        nullable: true,
                        description: 'Power per module in W (solar only)',
                      },

                      // Netzbetreiberprüfung
                      'Netzbetreiberpruefung Status': {
                        type: 'number',
                        nullable: true,
                        description:
                          'Grid operator review status code: 2954=Geprüft, 2955=In Prüfung, 3075=Nicht vorgesehen, null=older record',
                        example: 2954,
                      },
                      'Netzbetreiberpruefung Status Name': {
                        type: 'string',
                        nullable: true,
                        description:
                          'Grid operator review status label: Geprüft / In Prüfung / Nicht vorgesehen',
                        example: 'Geprüft',
                      },

                      // NAP / MeLo (Netzanschlusspunkt)
                      'NAP MaStR Nummer': {
                        type: 'string',
                        nullable: true,
                        description: 'MaStR ID of the grid connection point (SAN format)',
                        example: 'SAN914634531048',
                      },
                      'Messlokation (MeLo)': {
                        type: 'string',
                        nullable: true,
                        description: 'Metering location ID (DE..., 33 chars)',
                        example: 'DE0003976706990000000000000073131',
                      },
                      'Spannungsebene NAP': {
                        type: 'string',
                        nullable: true,
                        description:
                          'Voltage level at grid connection: Niederspannung / Mittelspannung / Hochspannung / Höchstspannung',
                        example: 'Niederspannung (LV)',
                      },
                      'Nettoengpassleistung kW': {
                        type: 'number',
                        nullable: true,
                        description: 'Net bottleneck capacity in kW at grid connection point',
                        example: 6.15,
                      },
                      'Netz MaStR Nummer': {
                        type: 'string',
                        nullable: true,
                        description: 'MaStR ID of the connected grid (SNE format)',
                        example: 'SNE985057905075',
                      },
                      'Netzbetreiber NAP MaStR': {
                        type: 'string',
                        nullable: true,
                        description:
                          'MaStR ID of the grid operator at the connection point (SNB format)',
                        example: 'SNB935578300972',
                      },
                    },
                    required: [
                      'SEE Nummer',
                      'Betreiber',
                      'Anlagentyp',
                      'Leistung MW',
                      'Technologie',
                    ],
                  },
                },
                examples: {
                  netze_bw_solar: {
                    summary: 'Netze BW - Solar installations >100kW',
                    value: [
                      {
                        'SEE Nummer': 'SEE913735587817',
                        Betreiber: 'PVA Langenenslingen',
                        Anlagentyp: 'solar',
                        'Leistung MW': 80.3088,
                        'Datum Netzzugang': '2025-05-27',
                        Technologie: 'solar',
                        Einspeiseart: 'Überschusseinspeisung',
                        Postleitzahl: '88515',
                        Ort: 'Langenenslingen',
                        Gemeinde: 'Langenenslingen',
                        Landkreis: 'Biberach',
                        Bundesland: '1402',
                      },
                    ],
                  },
                },
              },
            },
          },
          400: {
            description: 'Invalid parameters (missing grid operator details or invalid assetType)',
          },
          500: {
            description: 'Internal server error during MaStR query',
          },
        },
      },
      async handler(ctx) {
        return this._fetchAssets(ctx, [ctx.params.assetType]);
      },
    },

    ...GENERATED_ASSET_TYPE_ACTIONS,

    /**
     * all
     *
     * Extracts all installation types for a VNB.
     */
    all: {
      rest: 'GET /all',
      params: {
        vnbName: { type: 'string', optional: true },
        bdewCode: { type: 'string', optional: true, convert: true },
        gridOperatorId: { type: 'string', optional: true, convert: true },
        location: { type: 'string', optional: true },
        commissioningYear: { type: 'number', optional: true, convert: true },
        minCapacityKW: { type: 'number', optional: true, convert: true },
        maxCapacityKW: { type: 'number', optional: true, convert: true },
        limit: { type: 'any', optional: true },
        offset: { type: 'number', optional: true, min: 0, convert: true },
        redispatch: { type: 'boolean', optional: true, convert: true },
        operationalStatus: { type: 'string', optional: true, default: '35', convert: true },
        netzbetreiberPruefungStatus: { type: 'string', optional: true, convert: true },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx'], optional: true, default: 'json' },
        types: {
          type: 'string',
          optional: true,
          description: 'Comma-separated list of asset types (default: all types)',
        },
        includeNapData: {
          type: 'boolean',
          optional: true,
          default: true,
          convert: true,
          description:
            'Include NAP (Netzanschlusspunkt) data: MeLo, voltage level, grid bottleneck capacity. Default: true',
        },
        updatedAfter: { type: 'string', optional: true, convert: true },
      },
      openapi: {
        operationId: 'assets_all',
        summary: 'List all installations by grid operator or location (all or selected types)',
        description:
          'Retrieves installations of all or selected types from MaStR by grid operator context (`vnbName`, `bdewCode`, `gridOperatorId`) ' +
          'or directly by `location` (city/region/postal code). ' +
          '**Default: Only active installations (status 35).** ' +
          'Ideal for portfolio overview and location-based queries across asset types. ' +
          ASSET_QUERY_COUNT_SEMANTICS +
          ' Example: /api/assets/all?location=Heidelberg&types=solar,wind,storage',
        tags: ['Assets'],
        // @OpenEnergyPlatform/ontology — OEO_00000031 power plant
        [OEO_CLASS_KEY]: [OEO_URL_POWER_PLANT],
        parameters: [
          {
            name: 'vnbName',
            in: 'query',
            schema: { type: 'string', example: 'Netze BW' },
            description: PARAM_DESC_VNB_NAME,
          },
          {
            name: 'bdewCode',
            in: 'query',
            schema: { type: 'string', example: '4041407000008' },
            description: PARAM_DESC_BDEW_CODE,
          },
          {
            name: 'gridOperatorId',
            in: 'query',
            schema: { type: 'string', example: 'SNB948311994307' },
            description: PARAM_DESC_GR_ID,
          },
          {
            name: 'location',
            in: 'query',
            schema: { type: 'string', example: 'Baden-Württemberg' },
            description:
              PARAM_DESC_LOCATION +
              '. Useful for cross-type location queries like "Wie viele Anlagen gibt es in <Ort>?".',
          },
          {
            name: 'commissioningYear',
            in: 'query',
            schema: { type: 'number', example: 2020 },
            description: PARAM_DESC_YEAR,
          },
          {
            name: 'minCapacityKW',
            in: 'query',
            schema: { type: 'number', example: 100 },
            description: PARAM_DESC_MIN_CAP,
          },
          {
            name: 'maxCapacityKW',
            in: 'query',
            schema: { type: 'number', example: 10000 },
            description: PARAM_DESC_MAX_CAP,
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'number', default: 1000, example: 1000 },
            description:
              'Max. number of results per type. Default: **1,000**. Use a high value (e.g. `1000000`) or `all` for the complete result set — the server paginates internally.',
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'number', default: 0, minimum: 0, example: 0 },
            description:
              'Pagination offset — skip N records to fetch the next page (applied per type).',
          },
          {
            name: 'redispatch',
            in: 'query',
            schema: { type: 'boolean', example: true },
            description: 'Redispatch 2.0 filter (≥100kW)',
          },
          {
            name: 'types',
            in: 'query',
            schema: { type: 'string', example: 'solar,wind,storage' },
            description:
              'Comma-separated list of installation types. Default: all types (solar,wind,storage,biomass,hydro,combustion)',
          },
          {
            name: 'operationalStatus',
            in: 'query',
            schema: { type: 'string', default: '35', example: '35' },
            description: PARAM_DESC_OP_STATUS,
          },
          {
            name: 'netzbetreiberPruefungStatus',
            in: 'query',
            schema: { type: 'string', example: '2955' },
            description: PARAM_DESC_PRUEFUNG_STATUS,
          },
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['json', 'csv', 'xlsx'], default: 'json' },
            description: PARAM_DESC_FORMAT,
          },
          {
            name: 'includeNapData',
            in: 'query',
            schema: { type: 'boolean', default: true },
            description: PARAM_DESC_NAP,
          },
          {
            name: 'updatedAfter',
            in: 'query',
            schema: { type: 'string', format: 'date', example: EXAMPLE_DATE },
            description: PARAM_DESC_UPDATED_AFTER,
          },
        ],
        responses: ASSET_QUERY_ARRAY_RESPONSE,
      },
      async handler(ctx) {
        const allTypes = ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion'];
        let types = allTypes;

        if (ctx.params.types) {
          types = ctx.params.types
            .split(',')
            .map((t) => t.trim())
            .filter((t) => allTypes.includes(t));
          if (types.length === 0) {
            throw new Error(
              'Invalid types parameter. Valid types: solar,wind,storage,biomass,hydro,combustion'
            );
          }
        }

        return this._fetchAssets(ctx, types);
      },
    },

    /**
     * redispatchCount
     *
     * Fast aggregation of redispatch-eligible installations (≥100 kW, InBetrieb)
     * for a specific grid operator. Returns count, total capacity in MW, and a
     * breakdown by installation type.
     *
     * Calls cernion_installations_local directly with type:'all' and
     * minCapacity:100 to avoid the per-type loop in energy-market.installations.
     * No NAP enrichment — this endpoint is optimised for speed, not detail.
     *
     * Used by dashboard-api.vnbOverview Phase 2 (parallel) to populate the
     * redispatchEligible KPI card introduced in v0.20.2.
     *
     * @param {String} gridOperatorId - MaStR grid operator ID (SNB/GNB)
     * @param {String} bdewCode       - BDEW code (alternative to gridOperatorId)
     */
    redispatchCount: {
      rest: 'GET /redispatch-count',
      params: {
        gridOperatorId: {
          type: 'string',
          optional: true,
          convert: true,
          pattern: /^[SG]NB\d+$/,
          messages: {
            stringPattern: 'gridOperatorId muss im Format SNBxxx oder GNBxxx sein',
          },
        },
        bdewCode: {
          type: 'string',
          optional: true,
          convert: true,
          pattern: /^\d{7,13}$/,
          messages: {
            stringPattern: 'bdewCode muss 7-13 Ziffern enthalten (Beispiel: 9907473000008)',
          },
        },
      },
      openapi: {
        summary: 'Count of redispatch-eligible installations (≥100 kW) for a grid operator',
        tags: ['Assets'],
        description:
          'Aggregation of installations ≥100 kW (InBetrieb) for a grid operator. ' +
          'Returns count + total capacity in MW + breakdown by type (solar, wind, etc.). ' +
          'Used by the Dashboard API `vnbOverview` Phase 2 to populate the ' +
          '`redispatchEligible` KPI card (v0.20.2). ' +
          'No NAP enrichment — faster than `assets.list` with `redispatch=true`.',
        parameters: [
          {
            name: 'gridOperatorId',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'SNB935578300972' },
            description: 'MaStR grid operator ID (SNB/GNB format)',
          },
          {
            name: 'bdewCode',
            in: 'query',
            required: false,
            schema: { type: 'string', example: '9907473000008' },
            description: 'BDEW code — resolved by local cache inside cernion_installations_local',
          },
        ],
        responses: {
          200: {
            description: 'Redispatch-eligible installation count and capacity',
            content: {
              'application/json': {
                example: {
                  count: 59,
                  totalCapacityMW: 73.4,
                  byType: {
                    solar: { count: 12, capacityKW: 8200 },
                    wind: { count: 15, capacityKW: 42000 },
                    combustion: { count: 25, capacityKW: 18500 },
                    biomass: { count: 7, capacityKW: 4700 },
                  },
                },
              },
            },
          },
        },
        [OEO_CLASS_KEY]: [OEO_URL_POWER_PLANT],
      },
      async handler(ctx) {
        const { gridOperatorId, bdewCode } = ctx.params;

        if (!gridOperatorId && !bdewCode) {
          return {
            count: null,
            totalCapacityMW: null,
            byType: {},
            error: 'gridOperatorId or bdewCode is required',
          };
        }

        const mcpParams = {
          type: 'all',
          minCapacity: 100,
          status: 'InBetrieb',
          format: 'detailed',
          limit: 10000,
        };

        if (gridOperatorId) {
          mcpParams.gridOperatorMastrId = gridOperatorId;
        } else {
          mcpParams.gridOperatorBdewCode = bdewCode;
        }

        let result;
        try {
          result = await callWithAutoPoll(
            'cernion_installations_local',
            mcpParams,
            { maxWaitTime: 2 * 60 * 1000, pollInterval: 2000 },
            ctx.meta.cernionToken
          );
        } catch (err) {
          this.logger.error(`redispatchCount: cernion_installations_local failed: ${err.message}`);
          return { count: null, totalCapacityMW: null, byType: {}, error: err.message };
        }

        // Normalise across the various MCP response shapes
        let items = [];
        if (result?.data) {
          if (Array.isArray(result.data)) items = result.data;
          else if (Array.isArray(result.data.installations)) items = result.data.installations;
          else if (Array.isArray(result.data.results)) items = result.data.results;
        } else if (Array.isArray(result?.installations)) {
          items = result.installations;
        } else if (Array.isArray(result)) {
          items = result;
        }

        // Translate raw MaStR Energieträger catalog codes to readable labels.
        // cernion_installations_local returns the numeric catalog code in item.type
        // for detailed format (e.g. '2495' for solar, '2484' for wind onshore).
        const TYPE_LABEL = {
          2495: 'solar',
          2483: 'wind',
          2484: 'wind',
          2485: 'biomass',
          2487: 'hydro',
          2488: 'hydro',
          2489: 'combustion',
          2490: 'combustion',
          2491: 'storage',
          2492: 'geothermal',
        };

        // Aggregate in-process: count, capacity (kW → MW), breakdown by type
        let totalKW = 0;
        const typeMap = {};
        for (const item of items) {
          const kw = item.bruttoleistung || 0;
          totalKW += kw;
          const raw = item.type || item.installationType;
          const type = TYPE_LABEL[raw] || raw || 'unknown';
          if (!typeMap[type]) typeMap[type] = { count: 0, capacityKW: 0 };
          typeMap[type].count++;
          typeMap[type].capacityKW += kw;
        }

        return {
          count: items.length,
          totalCapacityMW: Math.round((totalKW / 1000) * 10) / 10,
          byType: typeMap,
        };
      },
    },

    /**
     * byDirektvermarkter
     *
     * Returns all MaStR installations that are assigned to the given
     * Direktvermarkter (direct energy marketer).  This is step 2 of the
     * Direktvermarkter pipeline:
     *   grid-operations.direktvermarkterLookup  →  assets.byDirektvermarkter
     *
     * Calls cernion_installations_local with direktvermarkterName /
     * direktvermarkterMastrId filter parameters introduced in Phase 1 of
     * CR-Direktvermarktung.
     */
    byDirektvermarkter: {
      rest: 'POST /by-direktvermarkter',
      params: {
        direktvermarkterName: { type: 'string', optional: true, min: 1 },
        direktvermarkterMastrId: { type: 'string', optional: true, min: 1 },
        installationType: {
          type: 'enum',
          values: ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion', 'all'],
          optional: true,
          default: 'all',
        },
        minCapacityKW: { type: 'number', optional: true, min: 0, convert: true },
        maxCapacityKW: { type: 'number', optional: true, min: 0, convert: true },
        bundesland: { type: 'string', optional: true, min: 1 },
        limit: {
          type: 'number',
          optional: true,
          default: 1000,
          min: 1,
          max: 10000,
          convert: true,
        },
        offset: { type: 'number', optional: true, default: 0, min: 0, convert: true },
        format: {
          type: 'enum',
          values: ['json', 'csv', 'xlsx'],
          optional: true,
          default: 'json',
        },
      },
      openapi: {
        summary: 'List installations of a Direktvermarkter (direct energy marketer)',
        tags: ['Assets'],
        // @OpenEnergyPlatform/ontology — OEO_00000031 power plant, OEO_00010082 trade
        [OEO_CLASS_KEY]: [
          OEO_URL_POWER_PLANT,
          'https://openenergyplatform.org/ontology/oeo/OEO_00010082',
        ],
        description:
          'Retrieves MaStR installations assigned to a given direct energy marketer ' +
          '(Direktvermarkter) using the direktvermarkterName or direktvermarkterMastrId ' +
          'filter. Step 2 of the Direktvermarkter pipeline. ' +
          'Supports filtering by type, commissioning year, capacity, and Bundesland.\n\n' +
          '⚠️ **Data Availability Limitation**: The `DirektvermarkterMastrNummer` field is ' +
          'deliberately excluded from all public MaStR bulk exports (BNetzA policy — ' +
          'commercially sensitive data). As a result, the `direktvermarkterName` and ' +
          '`direktvermarkterMastrId` filter parameters are not populated in the local ' +
          'MongoDB and **will return 0 results** in practice. ' +
          'The best available public proxy for installations in Direktvermarktung is ' +
          '`fernsteuerbarkeitDv: true` combined with `minCapacity: 100` — ' +
          'available for Wind and Biomass only (field not present in Solar/Storage).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  direktvermarkterName: {
                    type: 'string',
                    description: 'Direktvermarkter company name (fuzzy match)',
                    example: 'Next Kraftwerke',
                  },
                  direktvermarkterMastrId: {
                    type: 'string',
                    description: 'Exact MaStR ID of the Direktvermarkter',
                    example: 'ABR123456789',
                  },
                  installationType: {
                    type: 'string',
                    enum: ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion', 'all'],
                    default: 'all',
                    description: 'Filter by installation type (default: all)',
                  },
                  minCapacityKW: {
                    type: 'number',
                    description: 'Minimum installed capacity in kW',
                    example: 100,
                  },
                  maxCapacityKW: {
                    type: 'number',
                    description: 'Maximum installed capacity in kW',
                    example: 5000,
                  },
                  bundesland: {
                    type: 'string',
                    description: 'Filter by federal state',
                    example: 'Bayern',
                  },
                  limit: {
                    type: 'integer',
                    default: 1000,
                    minimum: 1,
                    maximum: 10000,
                    description: 'Maximum number of results (default: 1000)',
                  },
                  offset: {
                    type: 'integer',
                    default: 0,
                    description: 'Pagination offset',
                  },
                  format: {
                    type: 'string',
                    enum: ['json', 'csv', 'xlsx'],
                    default: 'json',
                    description: 'Output format',
                  },
                },
              },
              examples: {
                byName: {
                  summary: 'All installations of Next Kraftwerke',
                  value: {
                    direktvermarkterName: 'Next Kraftwerke',
                    limit: 1000,
                  },
                },
                byMastrId: {
                  summary: 'Solar portfolio by exact Direktvermarkter MaStR ID',
                  value: {
                    direktvermarkterMastrId: 'ABR123456789',
                    installationType: 'solar',
                    minCapacityKW: 100,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const {
          direktvermarkterName,
          direktvermarkterMastrId,
          installationType = 'all',
          minCapacityKW,
          maxCapacityKW,
          bundesland,
          limit = 1000,
          offset = 0,
          format = 'json',
        } = ctx.params;

        if (!direktvermarkterName && !direktvermarkterMastrId) {
          throw new Error(
            'Please provide either "direktvermarkterName" or "direktvermarkterMastrId".'
          );
        }

        const mcpParams = {
          type: installationType,
          direktvermarkterName: direktvermarkterName || undefined,
          direktvermarkterMastrId: direktvermarkterMastrId || undefined,
          minCapacity: minCapacityKW || undefined,
          maxCapacity: maxCapacityKW || undefined,
          bundesland: bundesland || undefined,
          limit,
          offset,
          format: 'detailed',
          includeStats: true,
        };

        // Remove undefined keys to avoid confusing the MCP tool
        Object.keys(mcpParams).forEach((k) => {
          if (mcpParams[k] === undefined) delete mcpParams[k];
        });

        let result;
        try {
          result = await callWithAutoPoll(
            'cernion_installations_local',
            mcpParams,
            { maxWaitTime: 5 * 60 * 1000, pollInterval: 2000 },
            ctx.meta.cernionToken
          );
        } catch (err) {
          throw new Error(`Direktvermarkter installations query failed: ${err.message}`);
        }

        // Extract items from the MCP response
        let items = [];
        if (result?.data) {
          if (Array.isArray(result.data)) items = result.data;
          else if (Array.isArray(result.data.installations)) items = result.data.installations;
          else if (Array.isArray(result.data.results)) items = result.data.results;
        } else if (Array.isArray(result?.installations)) {
          items = result.installations;
        }

        // Map items using the shared mapper; derive per-item type where available
        const mappedItems = items.map((item) => {
          const itemType =
            item.type || item.installationType || item.einheitentyp || installationType;
          return this._mapInstallationItem(item, itemType);
        });

        if (format === 'csv') {
          const csvContent = this.convertToCSV(mappedItems);
          ctx.meta.$responseHeaders = {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="direktvermarkter-assets-${Date.now()}.csv"`,
          };
          return csvContent;
        }

        if (format === 'xlsx') {
          const xlsxBuffer = convertToXLSX(mappedItems, 'Assets');
          ctx.meta.$responseHeaders = {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="direktvermarkter-assets-${Date.now()}.xlsx"`,
          };
          return xlsxBuffer;
        }

        return mappedItems;
      },
    },

    /**
     * inferGridOperators
     *
     * Queries MaStR assets for a given location (PLZ / municipality / state)
     * and aggregates the grid operator (Netzbetreiber) from those assets to
     * produce a list of operator candidates.
     *
     * Domain rule: this fallback is NOT authoritative. It derives candidates
     * from existing installations — the actual grid area boundary requires a
     * formal Netzanschlussanfrage.
     *
     * Reuses: assets.all (existing action, no duplication)
     *
     * @param {string} [postalCode]   German PLZ (5 digits)
     * @param {string} [municipality] Gemeinde / city name
     * @param {string} [state]        Bundesland (optional additional filter)
     * @param {number} [limit=60]     Max assets to sample
     * @returns {object} { operatorCandidates[], sampleSize, ambiguous, authoritative: false, source, notes }
     */
    inferGridOperators: {
      rest: 'GET /infer-grid-operators',
      params: {
        postalCode: { type: 'string', optional: true, min: 1 },
        municipality: { type: 'string', optional: true, min: 1 },
        state: { type: 'string', optional: true, min: 1 },
        limit: { type: 'number', optional: true, default: 60, min: 1, max: 200, convert: true },
      },
      openapi: {
        summary: 'Infer grid operator candidates from MaStR assets at a location',
        description:
          'Queries MaStR installations for the given PLZ / municipality and aggregates ' +
          'the Netzbetreiber (grid operator) from those assets. ' +
          '⚠️ NOT authoritative: derives candidates only — does not confirm the grid area ' +
          'boundary. A formal Netzanschlussanfrage is required for binding VNB attribution.',
        tags: ['Assets'],
        parameters: [
          {
            name: 'postalCode',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'municipality',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'state',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 60, minimum: 1, maximum: 200 },
          },
        ],
      },
      async handler(ctx) {
        const { postalCode, municipality, state, limit = 60 } = ctx.params;

        if (!postalCode && !municipality && !state) {
          return {
            success: false,
            error: 'At least one of postalCode, municipality, or state is required',
            operatorCandidates: [],
            sampleSize: 0,
            ambiguous: false,
            authoritative: false,
            source: 'mastr_asset_fallback',
          };
        }

        const locationQuery = postalCode || municipality || state;

        let assets = [];
        try {
          assets = await ctx.call('assets.all', {
            location: locationQuery,
            limit,
            operationalStatus: '35',
          });
        } catch (err) {
          this.logger?.warn(
            `[inferGridOperators] MaStR query failed for ${locationQuery}: ${err.message}`
          );
          return {
            success: true,
            operatorCandidates: [],
            sampleSize: 0,
            ambiguous: false,
            authoritative: false,
            source: 'mastr_asset_fallback',
            notes: `MaStR asset query failed (${err.message}). No candidates available.`,
            queryFailed: true,
          };
        }

        if (!Array.isArray(assets) || assets.length === 0) {
          return {
            success: true,
            operatorCandidates: [],
            sampleSize: 0,
            ambiguous: false,
            authoritative: false,
            source: 'mastr_asset_fallback',
            notes: `No MaStR assets found for location "${locationQuery}".`,
          };
        }

        // Aggregate by Netzbetreiber MaStR ID or name
        const vnbMap = new Map();
        for (const asset of assets) {
          const mastrId = asset['Netzbetreiber MaStR'] || null;
          const name = asset['Netzbetreiber Name'] || asset['Netzbetreiber'] || null;
          if (!mastrId && !name) continue;

          const key = mastrId || name;
          if (!vnbMap.has(key)) {
            vnbMap.set(key, {
              name,
              mastrNetzbetreiberId: mastrId,
              assetCount: 0,
              assetTypes: new Set(),
              totalCapacityKW: 0,
            });
          }
          const entry = vnbMap.get(key);
          entry.assetCount += 1;
          if (asset.Anlagentyp) entry.assetTypes.add(String(asset.Anlagentyp));
          entry.totalCapacityKW += Number(asset['Leistung kW'] || 0);
        }

        const sorted = [...vnbMap.values()].sort((a, b) => b.assetCount - a.assetCount);
        const operatorCandidates = sorted.map((entry, idx) => ({
          name: entry.name,
          mastrNetzbetreiberId: entry.mastrNetzbetreiberId,
          bdewCode: null,
          assetCount: entry.assetCount,
          assetTypes: [...entry.assetTypes],
          totalCapacityKW: Math.round(entry.totalCapacityKW * 10) / 10,
          source: 'mastr_asset_fallback',
          confidence: parseFloat((entry.assetCount / assets.length).toFixed(2)),
          evidence: `${entry.assetCount} von ${assets.length} MaStR-Anlagen bei "${locationQuery}" zeigen diesen Netzbetreiber`,
          rank: idx + 1,
        }));

        const topShare = operatorCandidates[0]?.confidence ?? 0;
        const secondShare = operatorCandidates[1]?.confidence ?? 0;
        const ambiguous = operatorCandidates.length > 1 && (topShare < 0.7 || secondShare > 0.3);

        return {
          success: true,
          operatorCandidates,
          sampleSize: assets.length,
          ambiguous,
          authoritative: false,
          source: 'mastr_asset_fallback',
          notes: ambiguous
            ? 'Mehrere Netzbetreiber im MaStR-Bestand. Exakte Netzgebietsgrenze erfordert formellen Netzanschlussantrag.'
            : 'Netzbetreiber-Kandidat aus MaStR-Bestand — nicht authoritative. Formellen Netzanschlussantrag stellen.',
        };
      },
    },
  },
};
