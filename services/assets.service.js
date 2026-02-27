const { Service } = require('moleculer');
const XLSX = require('xlsx');

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
  dependencies: ['energy-market'],

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

    /**
     * Convert array of objects to XLSX format
     */
    convertToXLSX(data) {
      if (!data || data.length === 0) {
        // Create empty workbook with headers only
        const ws = XLSX.utils.aoa_to_sheet([['No data available']]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Assets');
        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      }

      // Create worksheet from JSON data
      const ws = XLSX.utils.json_to_sheet(data);

      // Auto-size columns
      const colWidths = [];
      const range = XLSX.utils.decode_range(ws['!ref']);

      for (let C = range.s.c; C <= range.e.c; ++C) {
        let maxWidth = 10;
        for (let R = range.s.r; R <= range.e.r; ++R) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = ws[cellAddress];
          if (cell && cell.v) {
            const cellLength = String(cell.v).length;
            if (cellLength > maxWidth) {
              maxWidth = cellLength;
            }
          }
        }
        colWidths.push({ wch: Math.min(maxWidth + 2, 50) });
      }
      ws['!cols'] = colWidths;

      // Create workbook and add worksheet
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Assets');

      // Return as buffer
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
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
        redispatch,
        operationalStatus,
        format,
        includeNapData,
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
                } catch (parseErr) {
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

                  resolvedMastrId =
                    firstMatch.mastrNetzbetreiberId || firstMatch.mastrId || firstMatch.mastr_id;

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

      // Fetch assets for each type
      const allResults = [];

      for (const assetType of assetTypes) {
        const callParams = {
          installationType: assetType,
        };

        if (location) callParams.postleitzahl = location;
        if (commissioningYear) callParams.commissioningYear = commissioningYear;
        if (effectiveMinCapacity !== undefined) callParams.minCapacityKW = effectiveMinCapacity;
        if (maxCapacityKW !== undefined) callParams.maxCapacityKW = maxCapacityKW;
        if (limit !== undefined) callParams.limit = limit;
        if (operationalStatus !== undefined) callParams.operationalStatus = operationalStatus;
        callParams.includeNapData = includeNapData;

        // VNB filtering now supported for all types (netzbetreiberMastrNummer added to database)
        if (resolvedMastrId) {
          callParams.gridOperatorId = resolvedMastrId;
        } else if (resolvedBdewCode && resolvedBdewCode.length === 13) {
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

          // Map items to German output format
          const mappedItems = items.map((item) => {
            // Handle both field naming conventions (camelCase and German)
            // For storage: check acLeistung (AC power) first, then bruttoleistung
            const capacityKW =
              Number(
                item.capacityKW ||
                  item.acLeistung ||
                  item.bruttoleistung ||
                  item.nettonennleistung ||
                  item.installierteleistung
              ) || 0;
            const capacityMW = capacityKW / 1000;

            // Storage capacity: check all possible field name variants
            const storageCapacity =
              Number(
                item.storageCapacityKWh ||
                  item.nutzbareSpeicherkapazitaet ||
                  item.speicherkapazitaet ||
                  item.nutzbareKapazitaet
              ) || 0;

            let cRate = null;
            if (assetType === 'storage') {
              if (capacityKW > 0 && storageCapacity > 0) {
                cRate = parseFloat((capacityKW / storageCapacity).toFixed(2));
              }
            }

            const inverterPower =
              item.inverterPowerKW || item.wechselrichterleistung
                ? Number(item.inverterPowerKW || item.wechselrichterleistung)
                : null;

            // Extract commission date (handle ISO format)
            let commissionDate =
              item.commissioningDate || item.inbetriebnahmedatum || item.date || 'N/A';
            if (commissionDate !== 'N/A' && typeof commissionDate === 'string') {
              // Convert ISO date to YYYY-MM-DD format
              commissionDate = commissionDate.split('T')[0];
            }

            // Map status code to readable name
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

            // Map Netzbetreiberprüfung status code to readable name
            const nbpStatus =
              item.netzbetreiberpruefungStatus !== undefined
                ? item.netzbetreiberpruefungStatus
                : null;
            const nbpStatusName =
              nbpStatus === 2954
                ? 'Geprüft'
                : nbpStatus === 2955
                  ? 'In Prüfung'
                  : nbpStatus === 3075
                    ? 'Nicht vorgesehen'
                    : null;

            return {
              'SEE Nummer':
                item.mastrNumber || item.mastrNummer || item.EinheitMastrNummer || item.id || 'N/A',
              'Einheit Systemstatus': item.einheitSystemstatus || item.systemStatus || null,

              // Operator information
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
                item.marketActorAddress ||
                item.marktakteurAdresse ||
                item.marktakteurStrasse ||
                null,

              // Grid operator information
              'Netzbetreiber MaStR':
                item.netzbetreiberMastrNummer || item.gridOperatorMastrId || null,
              'Netzbetreiber Name': item.netzbetreiberName || item.gridOperatorName || null,

              // Technical specifications
              Anlagentyp: assetType,
              'Leistung MW': capacityMW,
              'Leistung kW': capacityKW,
              Wechselrichterleistung: inverterPower,
              Technologie: item.technology || item.technologie || assetType,

              // Storage-specific fields
              Speicherkapazität: assetType === 'storage' ? storageCapacity : null,
              C_Rate: cRate,
              'AC Nennleistung': item.acNennleistung || item.acNominalPower || null,
              'DC Nennleistung': item.dcNennleistung || item.dcNominalPower || null,
              Batterietechnologie: item.batterietechnologie || item.batteryTechnology || null,
              'Hersteller Batteriemodule':
                item.herstellerBatteriemodule || item.batteryModuleManufacturer || null,

              // Solar-specific fields
              Hauptausrichtung:
                item.hauptausrichtung || item.hauptAusrichtung || item.orientation || null,
              Neigungswinkel: item.neigungswinkel || item.tiltAngle || null,
              Leistungsbegrenzung: item.leistungsbegrenzung || item.powerLimit || null,

              // Wind-specific fields
              Nabenhöhe: item.nabenhoehe || item.hubHeight || null,
              Rotordurchmesser: item.rotordurchmesser || item.rotorDiameter || null,
              Hersteller: item.hersteller || item.manufacturer || null,
              Typenbezeichnung: item.typenbezeichnung || item.typeDesignation || null,

              // Status and dates
              Betriebsstatus: statusCode,
              'Betriebsstatus Name': statusName,
              'Datum Netzzugang': commissionDate,
              Registrierungsdatum: item.registrierungsdatum || item.registrationDate || null,
              Genehmigungsdatum: item.genehmigungsdatum || item.approvalDate || null,

              // Grid connection
              Kopplung: item.coupling || item.kopplung || (item.connectedToGrid ? 'AC' : 'DC'),
              Einspeiseart: item.feedInType || item.einspeiseart || 'Überschusseinspeisung',
              Spannungsebene: item.spannungsebene || item.voltageLevel || null,
              Fernsteuerbarkeit: item.fernsteuerbarkeit || item.remoteControllability || null,
              Einsatzverantwortlicher:
                item.einsatzverantwortlicher || item.deploymentResponsible || null,

              // Location information
              Postleitzahl: item.postleitzahl || item.postalCode || null,
              Ort: item.ort || item.city || null,
              Gemeinde: item.gemeinde || item.municipality || null,
              Landkreis: item.landkreis || item.district || null,
              Bundesland: item.bundesland || item.state || null,
              Längengrad: item.laengengrad || item.longitude || null,
              Breitengrad: item.breitengrad || item.latitude || null,

              // Additional fields
              Fläche: item.inAnspruchGenommeneFlaeche || item.usedArea || null,
              'Anzahl Module': item.anzahlModule || item.moduleCount || null,
              'Leistung je Modul': item.leistungJeModul || item.powerPerModule || null,

              // Netzbetreiberprüfung
              'Netzbetreiberpruefung Status': nbpStatus,
              'Netzbetreiberpruefung Status Name': nbpStatusName,

              // Netzanschlusspunkt (NAP) / Messlokation (MeLo)
              'NAP MaStR Nummer': item.napData?.napMastrNummer || null,
              'Messlokation (MeLo)': item.napData?.messlokation || null,
              'Spannungsebene NAP': item.napData?.spannungsebeneLabel || null,
              'Nettoengpassleistung kW':
                item.napData?.nettoengpassleistung != null
                  ? item.napData.nettoengpassleistung
                  : null,
              'Netz MaStR Nummer': item.napData?.netzMastrNummer || null,
              'Netzbetreiber NAP MaStR': item.napData?.netzbetreiberMastrNummer || null,
            };
          });

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
        const xlsxBuffer = this.convertToXLSX(allResults);

        // Set response headers for XLSX download
        ctx.meta.$responseHeaders = {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="assets-${Date.now()}.xlsx"`,
        };

        return xlsxBuffer;
      }

      return allResults;
    },
  },

  /**
   * Actions
   */
  actions: {
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
          type: 'number',
          optional: true,
          min: 1,
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
        includeNapData: {
          type: 'boolean',
          optional: true,
          default: true,
          convert: true,
          description:
            'Include NAP (Netzanschlusspunkt) data: MeLo, voltage level, grid bottleneck capacity. Default: true',
        },
      },
      openapi: {
        summary: 'List assets of a distribution network operator (DNO/DSO)',
        description:
          'Retrieves complete installation data from the German Marktstammdatenregister (MaStR). Supports filtering by grid operator (BDEW code or name), asset type, capacity, commissioning year, and operational status. **Default behavior: Only active installations (status 35 - In operation) are returned.** No pagination required - can retrieve millions of installations.',
        tags: ['Assets'],
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
            schema: { type: 'number', example: 100 },
            description: 'Maximum number of results (optional, default: all)',
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
            description:
              'Operational status: 31=Planned, 35=In operation (default), 37=Temporarily decommissioned, 38=Permanently decommissioned, all=All statuses',
          },
          {
            name: 'includeNapData',
            in: 'query',
            schema: { type: 'boolean', default: true, example: true },
            description:
              'Include NAP data (Netzanschlusspunkt): MeLo, voltage level, grid bottleneck capacity. Default: true. Set to false to speed up large queries.',
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
                        description: 'Name of grid operator',
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
                        description: 'MaStR ID of the grid operator at the connection point (SNB format)',
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

    /**
     * solar
     *
     * Extracts all PV installations for a VNB.
     */
    solar: {
      rest: 'GET /solar',
      params: {
        vnbName: { type: 'string', optional: true },
        bdewCode: { type: 'string', optional: true, convert: true },
        gridOperatorId: { type: 'string', optional: true, convert: true },
        location: { type: 'string', optional: true },
        commissioningYear: { type: 'number', optional: true, convert: true },
        minCapacityKW: { type: 'number', optional: true, convert: true },
        maxCapacityKW: { type: 'number', optional: true, convert: true },
        limit: { type: 'number', optional: true, convert: true },
        redispatch: { type: 'boolean', optional: true, convert: true },
        operationalStatus: { type: 'string', optional: true, default: '35', convert: true },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx'], optional: true, default: 'json' },
        includeNapData: { type: 'boolean', optional: true, default: true, convert: true },
      },
      openapi: {
        summary: 'List all solar PV installations of a grid operator',
        description:
          'Retrieves all photovoltaic installations of a grid operator. **Default: Only active installations (status 35).** Example: /api/assets/solar?bdewCode=4041407000008&redispatch=true for Netze BW redispatch installations.',
        tags: ['Assets'],
        parameters: [
          {
            name: 'vnbName',
            in: 'query',
            schema: { type: 'string', example: 'Netze BW' },
            description: 'Name of grid operator',
          },
          {
            name: 'bdewCode',
            in: 'query',
            schema: { type: 'string', example: '4041407000008' },
            description: 'BDEW code (13 digits)',
          },
          {
            name: 'gridOperatorId',
            in: 'query',
            schema: { type: 'string', example: 'SNB948311994307' },
            description: 'MaStR grid operator ID',
          },
          {
            name: 'location',
            in: 'query',
            schema: { type: 'string', example: 'Heidelberg' },
            description: 'City/region/postal code',
          },
          {
            name: 'commissioningYear',
            in: 'query',
            schema: { type: 'number', example: 2020 },
            description: 'Commissioning year',
          },
          {
            name: 'minCapacityKW',
            in: 'query',
            schema: { type: 'number', example: 100 },
            description: 'Min. capacity in kW',
          },
          {
            name: 'maxCapacityKW',
            in: 'query',
            schema: { type: 'number', example: 10000 },
            description: 'Max. capacity in kW',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'number', example: 100 },
            description: 'Max. number of results',
          },
          {
            name: 'redispatch',
            in: 'query',
            schema: { type: 'boolean', example: true },
            description: 'Redispatch 2.0 filter (≥100kW)',
          },
          {
            name: 'operationalStatus',
            in: 'query',
            schema: { type: 'string', default: '35', example: '35' },
            description:
              'Operational status: 31=Planned, 35=In operation (default), 37=Temporarily decommissioned, 38=Permanently decommissioned, all=All statuses',
          },
          {
            name: 'includeNapData',
            in: 'query',
            schema: { type: 'boolean', default: true },
            description: 'Include NAP data (MeLo, voltage level, bottleneck capacity). Default: true',
          },
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['json', 'csv', 'xlsx'], default: 'json' },
            description: 'Output format (default: json)',
          },
        ],
      },
      async handler(ctx) {
        return this._fetchAssets(ctx, ['solar']);
      },
    },

    /**
     * wind
     *
     * Extracts all wind installations for a VNB.
     */
    wind: {
      rest: 'GET /wind',
      params: {
        vnbName: { type: 'string', optional: true },
        bdewCode: { type: 'string', optional: true, convert: true },
        gridOperatorId: { type: 'string', optional: true, convert: true },
        location: { type: 'string', optional: true },
        commissioningYear: { type: 'number', optional: true, convert: true },
        minCapacityKW: { type: 'number', optional: true, convert: true },
        maxCapacityKW: { type: 'number', optional: true, convert: true },
        limit: { type: 'number', optional: true, convert: true },
        redispatch: { type: 'boolean', optional: true, convert: true },
        operationalStatus: { type: 'string', optional: true, default: '35', convert: true },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx'], optional: true, default: 'json' },
        includeNapData: { type: 'boolean', optional: true, default: true, convert: true },
      },
      openapi: {
        summary: 'List all wind power installations of a grid operator',
        description: '**Default: Only active installations (status 35).**',
        tags: ['Assets'],
        parameters: [
          { name: 'vnbName', in: 'query', schema: { type: 'string', example: 'Netze BW' }, description: 'Name of grid operator' },
          { name: 'bdewCode', in: 'query', schema: { type: 'string', example: '4041407000008' }, description: 'BDEW code (13 digits)' },
          { name: 'gridOperatorId', in: 'query', schema: { type: 'string', example: 'SNB948311994307' }, description: 'MaStR grid operator ID' },
          { name: 'location', in: 'query', schema: { type: 'string', example: 'Heidelberg' }, description: 'City/region/postal code' },
          { name: 'commissioningYear', in: 'query', schema: { type: 'number', example: 2020 }, description: 'Commissioning year' },
          { name: 'minCapacityKW', in: 'query', schema: { type: 'number', example: 100 }, description: 'Min. capacity in kW' },
          { name: 'maxCapacityKW', in: 'query', schema: { type: 'number', example: 10000 }, description: 'Max. capacity in kW' },
          { name: 'limit', in: 'query', schema: { type: 'number', example: 100 }, description: 'Max. number of results' },
          {
            name: 'redispatch',
            in: 'query',
            schema: { type: 'boolean', example: true },
            description: 'Redispatch 2.0 (≥100kW)',
          },
          {
            name: 'operationalStatus',
            in: 'query',
            schema: { type: 'string', default: '35', example: '35' },
            description:
              'Operational status: 31=Planned, 35=In operation (default), 37=Temporarily decommissioned, 38=Permanently decommissioned, all=All',
          },
          {
            name: 'includeNapData',
            in: 'query',
            schema: { type: 'boolean', default: true },
            description: 'Include NAP data (MeLo, voltage level, bottleneck capacity). Default: true',
          },
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['json', 'csv', 'xlsx'], default: 'json' },
            description: 'Output format (default: json)',
          },
        ],
      },
      async handler(ctx) {
        return this._fetchAssets(ctx, ['wind']);
      },
    },

    /**
     * storage
     *
     * Extracts all storage installations for a VNB.
     */
    storage: {
      rest: 'GET /storage',
      params: {
        vnbName: { type: 'string', optional: true },
        bdewCode: { type: 'string', optional: true, convert: true },
        gridOperatorId: { type: 'string', optional: true, convert: true },
        location: { type: 'string', optional: true },
        commissioningYear: { type: 'number', optional: true, convert: true },
        minCapacityKW: { type: 'number', optional: true, convert: true },
        maxCapacityKW: { type: 'number', optional: true, convert: true },
        limit: { type: 'number', optional: true, convert: true },
        redispatch: { type: 'boolean', optional: true, convert: true },
        operationalStatus: { type: 'string', optional: true, default: '35', convert: true },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx'], optional: true, default: 'json' },
        includeNapData: { type: 'boolean', optional: true, default: true, convert: true },
      },
      openapi: {
        summary: 'List all battery storage installations of a grid operator',
        description: '**Default: Only active installations (status 35).**',
        tags: ['Assets'],
        parameters: [
          { name: 'vnbName', in: 'query', schema: { type: 'string', example: 'Netze BW' }, description: 'Name of grid operator' },
          { name: 'bdewCode', in: 'query', schema: { type: 'string', example: '4041407000008' }, description: 'BDEW code (13 digits)' },
          { name: 'gridOperatorId', in: 'query', schema: { type: 'string', example: 'SNB948311994307' }, description: 'MaStR grid operator ID' },
          { name: 'location', in: 'query', schema: { type: 'string', example: 'Heidelberg' }, description: 'City/region/postal code' },
          { name: 'commissioningYear', in: 'query', schema: { type: 'number', example: 2020 }, description: 'Commissioning year' },
          { name: 'minCapacityKW', in: 'query', schema: { type: 'number', example: 100 }, description: 'Min. capacity in kW' },
          { name: 'maxCapacityKW', in: 'query', schema: { type: 'number', example: 10000 }, description: 'Max. capacity in kW' },
          { name: 'limit', in: 'query', schema: { type: 'number', example: 100 }, description: 'Max. number of results' },
          {
            name: 'redispatch',
            in: 'query',
            schema: { type: 'boolean', example: true },
            description: 'Redispatch 2.0 (≥100kW)',
          },
          {
            name: 'operationalStatus',
            in: 'query',
            schema: { type: 'string', default: '35', example: '35' },
            description:
              'Operational status: 31=Planned, 35=In operation (default), 37=Temporarily decommissioned, 38=Permanently decommissioned, all=All',
          },
          {
            name: 'includeNapData',
            in: 'query',
            schema: { type: 'boolean', default: true },
            description: 'Include NAP data (MeLo, voltage level, bottleneck capacity). Default: true',
          },
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['json', 'csv', 'xlsx'], default: 'json' },
            description: 'Output format (default: json)',
          },
        ],
      },
      async handler(ctx) {
        return this._fetchAssets(ctx, ['storage']);
      },
    },

    /**
     * biomass
     *
     * Extracts all biomass installations for a VNB.
     */
    biomass: {
      rest: 'GET /biomass',
      params: {
        vnbName: { type: 'string', optional: true },
        bdewCode: { type: 'string', optional: true, convert: true },
        gridOperatorId: { type: 'string', optional: true, convert: true },
        location: { type: 'string', optional: true },
        commissioningYear: { type: 'number', optional: true, convert: true },
        minCapacityKW: { type: 'number', optional: true, convert: true },
        maxCapacityKW: { type: 'number', optional: true, convert: true },
        limit: { type: 'number', optional: true, convert: true },
        redispatch: { type: 'boolean', optional: true, convert: true },
        operationalStatus: { type: 'string', optional: true, default: '35', convert: true },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx'], optional: true, default: 'json' },
        includeNapData: { type: 'boolean', optional: true, default: true, convert: true },
      },
      openapi: {
        summary: 'List all biomass installations of a grid operator',
        description: '**Default: Only active installations (status 35).**',
        tags: ['Assets'],
        parameters: [
          { name: 'vnbName', in: 'query', schema: { type: 'string', example: 'Netze BW' }, description: 'Name of grid operator' },
          { name: 'bdewCode', in: 'query', schema: { type: 'string', example: '4041407000008' }, description: 'BDEW code (13 digits)' },
          { name: 'gridOperatorId', in: 'query', schema: { type: 'string', example: 'SNB948311994307' }, description: 'MaStR grid operator ID' },
          { name: 'location', in: 'query', schema: { type: 'string', example: 'Heidelberg' }, description: 'City/region/postal code' },
          { name: 'commissioningYear', in: 'query', schema: { type: 'number', example: 2020 }, description: 'Commissioning year' },
          { name: 'minCapacityKW', in: 'query', schema: { type: 'number', example: 100 }, description: 'Min. capacity in kW' },
          { name: 'maxCapacityKW', in: 'query', schema: { type: 'number', example: 10000 }, description: 'Max. capacity in kW' },
          { name: 'limit', in: 'query', schema: { type: 'number', example: 100 }, description: 'Max. number of results' },
          {
            name: 'redispatch',
            in: 'query',
            schema: { type: 'boolean', example: true },
            description: 'Redispatch 2.0 (≥100kW)',
          },
          {
            name: 'operationalStatus',
            in: 'query',
            schema: { type: 'string', default: '35', example: '35' },
            description:
              'Operational status: 31=Planned, 35=In operation (default), 37=Temporarily decommissioned, 38=Permanently decommissioned, all=All',
          },
          {
            name: 'includeNapData',
            in: 'query',
            schema: { type: 'boolean', default: true },
            description: 'Include NAP data (MeLo, voltage level, bottleneck capacity). Default: true',
          },
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['json', 'csv', 'xlsx'], default: 'json' },
            description: 'Output format (default: json)',
          },
        ],
      },
      async handler(ctx) {
        return this._fetchAssets(ctx, ['biomass']);
      },
    },

    /**
     * hydro
     *
     * Extracts all hydro installations for a VNB.
     */
    hydro: {
      rest: 'GET /hydro',
      params: {
        vnbName: { type: 'string', optional: true },
        bdewCode: { type: 'string', optional: true, convert: true },
        gridOperatorId: { type: 'string', optional: true, convert: true },
        location: { type: 'string', optional: true },
        commissioningYear: { type: 'number', optional: true, convert: true },
        minCapacityKW: { type: 'number', optional: true, convert: true },
        maxCapacityKW: { type: 'number', optional: true, convert: true },
        limit: { type: 'number', optional: true, convert: true },
        redispatch: { type: 'boolean', optional: true, convert: true },
        operationalStatus: { type: 'string', optional: true, default: '35', convert: true },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx'], optional: true, default: 'json' },
        includeNapData: { type: 'boolean', optional: true, default: true, convert: true },
      },
      openapi: {
        summary: 'List all hydropower installations of a grid operator',
        description: '**Default: Only active installations (status 35).**',
        tags: ['Assets'],
        parameters: [
          { name: 'vnbName', in: 'query', schema: { type: 'string', example: 'Netze BW' }, description: 'Name of grid operator' },
          { name: 'bdewCode', in: 'query', schema: { type: 'string', example: '4041407000008' }, description: 'BDEW code (13 digits)' },
          { name: 'gridOperatorId', in: 'query', schema: { type: 'string', example: 'SNB948311994307' }, description: 'MaStR grid operator ID' },
          { name: 'location', in: 'query', schema: { type: 'string', example: 'Heidelberg' }, description: 'City/region/postal code' },
          { name: 'commissioningYear', in: 'query', schema: { type: 'number', example: 2020 }, description: 'Commissioning year' },
          { name: 'minCapacityKW', in: 'query', schema: { type: 'number', example: 100 }, description: 'Min. capacity in kW' },
          { name: 'maxCapacityKW', in: 'query', schema: { type: 'number', example: 10000 }, description: 'Max. capacity in kW' },
          { name: 'limit', in: 'query', schema: { type: 'number', example: 100 }, description: 'Max. number of results' },
          {
            name: 'redispatch',
            in: 'query',
            schema: { type: 'boolean', example: true },
            description: 'Redispatch 2.0 (≥100kW)',
          },
          {
            name: 'operationalStatus',
            in: 'query',
            schema: { type: 'string', default: '35', example: '35' },
            description:
              'Operational status: 31=Planned, 35=In operation (default), 37=Temporarily decommissioned, 38=Permanently decommissioned, all=All',
          },
          {
            name: 'includeNapData',
            in: 'query',
            schema: { type: 'boolean', default: true },
            description: 'Include NAP data (MeLo, voltage level, bottleneck capacity). Default: true',
          },
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['json', 'csv', 'xlsx'], default: 'json' },
            description: 'Output format (default: json)',
          },
        ],
      },
      async handler(ctx) {
        return this._fetchAssets(ctx, ['hydro']);
      },
    },

    /**
     * combustion
     *
     * Extracts all combustion installations for a VNB.
     */
    combustion: {
      rest: 'GET /combustion',
      params: {
        vnbName: { type: 'string', optional: true },
        bdewCode: { type: 'string', optional: true, convert: true },
        gridOperatorId: { type: 'string', optional: true, convert: true },
        location: { type: 'string', optional: true },
        commissioningYear: { type: 'number', optional: true, convert: true },
        minCapacityKW: { type: 'number', optional: true, convert: true },
        maxCapacityKW: { type: 'number', optional: true, convert: true },
        limit: { type: 'number', optional: true, convert: true },
        redispatch: { type: 'boolean', optional: true, convert: true },
        operationalStatus: { type: 'string', optional: true, default: '35', convert: true },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx'], optional: true, default: 'json' },
        includeNapData: { type: 'boolean', optional: true, default: true, convert: true },
      },
      openapi: {
        summary: 'List all combustion installations of a grid operator',
        description: '**Default: Only active installations (status 35).**',
        tags: ['Assets'],
        parameters: [
          { name: 'vnbName', in: 'query', schema: { type: 'string', example: 'Netze BW' }, description: 'Name of grid operator' },
          { name: 'bdewCode', in: 'query', schema: { type: 'string', example: '4041407000008' }, description: 'BDEW code (13 digits)' },
          { name: 'gridOperatorId', in: 'query', schema: { type: 'string', example: 'SNB948311994307' }, description: 'MaStR grid operator ID' },
          { name: 'location', in: 'query', schema: { type: 'string', example: 'Heidelberg' }, description: 'City/region/postal code' },
          { name: 'commissioningYear', in: 'query', schema: { type: 'number', example: 2020 }, description: 'Commissioning year' },
          { name: 'minCapacityKW', in: 'query', schema: { type: 'number', example: 100 }, description: 'Min. capacity in kW' },
          { name: 'maxCapacityKW', in: 'query', schema: { type: 'number', example: 10000 }, description: 'Max. capacity in kW' },
          { name: 'limit', in: 'query', schema: { type: 'number', example: 100 }, description: 'Max. number of results' },
          {
            name: 'redispatch',
            in: 'query',
            schema: { type: 'boolean', example: true },
            description: 'Redispatch 2.0 (≥100kW)',
          },
          {
            name: 'operationalStatus',
            in: 'query',
            schema: { type: 'string', default: '35', example: '35' },
            description:
              'Operational status: 31=Planned, 35=In operation (default), 37=Temporarily decommissioned, 38=Permanently decommissioned, all=All',
          },
          {
            name: 'includeNapData',
            in: 'query',
            schema: { type: 'boolean', default: true },
            description: 'Include NAP data (MeLo, voltage level, bottleneck capacity). Default: true',
          },
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['json', 'csv', 'xlsx'], default: 'json' },
            description: 'Output format (default: json)',
          },
        ],
      },
      async handler(ctx) {
        return this._fetchAssets(ctx, ['combustion']);
      },
    },

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
        limit: { type: 'number', optional: true, convert: true },
        redispatch: { type: 'boolean', optional: true, convert: true },
        operationalStatus: { type: 'string', optional: true, default: '35', convert: true },
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
      },
      openapi: {
        summary: 'List all installations of a grid operator (all or selected types)',
        description:
          'Retrieves installations of all or selected types from a grid operator. **Default: Only active installations (status 35).** Ideal for asset management and portfolio overview. Example: /api/assets/all?bdewCode=4041407000008&types=solar,wind,storage&redispatch=true',
        tags: ['Assets'],
        parameters: [
          {
            name: 'vnbName',
            in: 'query',
            schema: { type: 'string', example: 'Netze BW' },
            description: 'Name of grid operator',
          },
          {
            name: 'bdewCode',
            in: 'query',
            schema: { type: 'string', example: '4041407000008' },
            description: 'BDEW code (13 digits)',
          },
          {
            name: 'gridOperatorId',
            in: 'query',
            schema: { type: 'string', example: 'SNB948311994307' },
            description: 'MaStR grid operator ID',
          },
          {
            name: 'location',
            in: 'query',
            schema: { type: 'string', example: 'Baden-Württemberg' },
            description: 'City/region/postal code',
          },
          {
            name: 'commissioningYear',
            in: 'query',
            schema: { type: 'number', example: 2020 },
            description: 'Commissioning year',
          },
          {
            name: 'minCapacityKW',
            in: 'query',
            schema: { type: 'number', example: 100 },
            description: 'Min. capacity in kW',
          },
          {
            name: 'maxCapacityKW',
            in: 'query',
            schema: { type: 'number', example: 10000 },
            description: 'Max. capacity in kW',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'number', example: 100 },
            description: 'Max. number of results per type',
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
            description:
              'Operational status: 31=Planned, 35=In operation (default), 37=Temporarily decommissioned, 38=Permanently decommissioned, all=All statuses',
          },
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['json', 'csv', 'xlsx'], default: 'json' },
            description: 'Output format (default: json)',
          },
          {
            name: 'includeNapData',
            in: 'query',
            schema: { type: 'boolean', default: true },
            description: 'Include NAP data (MeLo, voltage level, bottleneck capacity). Default: true',
          },
        ],
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
  },
};
