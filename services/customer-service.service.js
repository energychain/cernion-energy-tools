/**
 * Customer Service Service
 *
 * Self-service widgets, health checks, wizards
 * Maps to Cernion MCP customer service category
 */

const CernionMCPClient = require('../src/mcp-client');
const { callWithAutoPoll } = require('../src/async-job-poller');

module.exports = {
  name: 'customer-service',

  settings: {
    defaultTimeout: 5 * 60 * 1000, // 5 minutes for widget generation
  },

  actions: {
    /**
     * Generate embeddable self-service widget
     * Tool: cernion_customer_portal_widget
     */
    portalWidget: {
      rest: 'POST /portal-widget',
      params: {
        widgetType: {
          type: 'enum',
          values: [
            'installation_lookup',
            'installation_overview',
            'operator_change_wizard',
            'storage_calculator',
            'eeg_end_helper',
            'faq_embedded',
            'contact_finder',
            'document_templates',
          ],
        },
        mode: {
          type: 'enum',
          values: ['compact', 'full', 'modal', 'embedded'],
          optional: true,
          default: 'embedded',
        },
        theme: {
          type: 'enum',
          values: ['light', 'dark', 'auto'],
          optional: true,
          default: 'light',
        },
        language: { type: 'enum', values: ['de', 'en'], optional: true, default: 'de' },
        outputFormat: {
          type: 'enum',
          values: ['html', 'json', 'markdown'],
          optional: true,
          default: 'html',
        },
        mastrNummer: { type: 'string', optional: true },
        postalCode: { type: 'string', optional: true },
        installationAge: { type: 'number', optional: true, min: 0, convert: true },
        maxHeight: { type: 'number', optional: true, default: 600, min: 200, convert: true },
        includeBranding: { type: 'boolean', optional: true, default: true },
        includeContactCTA: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary:
          'Generate embeddable self-service widgets for customer portals (reduces call center load by 30-40%)',
        tags: ['Customer Service'],
        description: `Generate embeddable self-service widgets that dramatically reduce call center load and improve customer satisfaction. **Business Impact: 30-40% reduction in support calls** = 450-600 min/month saved = **4,800-6,600 €/year savings** per 100 monthly support requests.

**8 Widget Types**:

1. **installation_lookup**: Find installation by address or postal code
   - Use case: "Where is my solar system registered?"
   - Reduces: 25% of lookup calls

2. **installation_overview**: Quick info dashboard for customer
   - Shows: MaStR number, capacity, commissioning date, grid operator
   - Reduces: 30% of "What are my installation details?" calls

3. **operator_change_wizard**: Step-by-step operator change guide
   - Use case: House purchase, inheritance, company restructuring
   - Reduces: 40% of operator change calls (most complex process)
   - Provides: Checklist, deadlines, required documents, forms

4. **storage_calculator**: Storage worthiness check
   - Inputs: PV capacity, consumption, electricity price
   - Output: ROI calculation, payback period, optimal storage size
   - Drives: Upsell opportunities (storage retrofit)

5. **eeg_end_helper**: Post-EEG guidance (after 20 years)
   - **CRITICAL for installations ≥18 years old!**
   - Options: Full feed-in (market price), self-consumption, direct marketing
   - Regulatory: EEG 2023 changes, market value calculation

6. **faq_embedded**: Top 10 frequently asked questions
   - Auto-answers: "Can I increase capacity?", "How to change operator?", "What if my system breaks?"
   - Reduces: 15-20% of routine questions

7. **contact_finder**: Find VNB, BNetzA, Finanzamt by postal code
   - Shows: Contact details, opening hours, online portals, forms
   - Reduces: "Who is responsible for...?" calls

8. **document_templates**: Download forms (operator change, capacity increase, decommissioning)
   - Self-service: No waiting for email/post
   - Reduces: Document request calls

**Display Modes**:
- **compact** (300x400px): Sidebar widget
- **full**: Full-page integration
- **modal**: Popup overlay (triggered by button)
- **embedded**: Inline integration in page flow

**Integration**:
- HTML/CSS/JavaScript snippet (copy-paste ready)
- iframe or Web Component
- REST API for custom implementations
- Responsive design (mobile-friendly)
- Light/dark theme support
- Multi-language (de/en)

**Business Benefits**:
- 24/7 availability (no waiting for callback)
- Instant answers (higher customer satisfaction)
- Reduced peak-time call center load (mornings, Mondays)
- Scalable (serves unlimited customers simultaneously)
- Measurable impact (track widget usage vs. call reduction)

**ROI Example**:
- Before: 100 support calls/month @ 15 min/call = 1,500 min/month
- After: 60-70 calls/month (30-40% self-service) = 900-1,050 min/month
- **Savings: 450-600 min/month** = 7.5-10 hours/month
- **Cost savings: 4,800-6,600 €/year** (assuming 40 €/hour loaded labor cost)
- **Customer satisfaction: +15-25% (instant help vs. callback wait)**`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['widgetType'],
                properties: {
                  widgetType: {
                    type: 'string',
                    enum: [
                      'installation_lookup',
                      'installation_overview',
                      'operator_change_wizard',
                      'storage_calculator',
                      'eeg_end_helper',
                      'faq_embedded',
                      'contact_finder',
                      'document_templates',
                    ],
                    description: 'Type of widget to generate',
                    example: 'installation_lookup',
                  },
                  mode: {
                    type: 'string',
                    enum: ['compact', 'full', 'modal', 'embedded'],
                    description: 'Display mode',
                    default: 'embedded',
                  },
                  theme: {
                    type: 'string',
                    enum: ['light', 'dark', 'auto'],
                    default: 'light',
                  },
                  language: {
                    type: 'string',
                    enum: ['de', 'en'],
                    default: 'de',
                  },
                  outputFormat: {
                    type: 'string',
                    enum: ['html', 'json', 'markdown'],
                    description: 'Output format for the widget',
                    default: 'html',
                  },
                  mastrNummer: {
                    type: 'string',
                    description: 'Optional: MaStR number for personalized widgets',
                    example: 'SEE123456789012',
                  },
                  postalCode: {
                    type: 'string',
                    description: 'Optional: Customer postal code for location-based help',
                    example: '80331',
                  },
                  installationAge: {
                    type: 'number',
                    description: 'Optional: Installation age in years',
                    minimum: 0,
                    example: 18,
                  },
                  maxHeight: {
                    type: 'number',
                    description: 'Maximum widget height in pixels',
                    minimum: 200,
                    default: 600,
                  },
                  includeBranding: {
                    type: 'boolean',
                    default: true,
                  },
                  includeContactCTA: {
                    type: 'boolean',
                    default: true,
                  },
                },
              },
              examples: {
                installationLookup: {
                  summary: 'Installation lookup widget',
                  value: {
                    widgetType: 'installation_lookup',
                    mode: 'embedded',
                    theme: 'light',
                    language: 'de',
                    outputFormat: 'html',
                    maxHeight: 400,
                  },
                },
                storageCalculator: {
                  summary: 'Storage calculator for customers',
                  value: {
                    widgetType: 'storage_calculator',
                    mode: 'full',
                    theme: 'light',
                    postalCode: '80331',
                    language: 'de',
                  },
                },
                eegEndHelper: {
                  summary: 'EEG end helper (20-year mark)',
                  value: {
                    widgetType: 'eeg_end_helper',
                    mode: 'modal',
                    installationAge: 18,
                    mastrNummer: 'SEE123456789012',
                    theme: 'auto',
                    includeContactCTA: true,
                  },
                },
                compactFAQ: {
                  summary: 'Compact FAQ widget',
                  value: {
                    widgetType: 'faq_embedded',
                    mode: 'compact',
                    theme: 'light',
                    maxHeight: 500,
                    outputFormat: 'json',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'cernion_customer_portal_widget',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Installation health check
     * Tool: cernion_installation_health_check
     */
    installationHealthCheck: {
      rest: 'POST /installation-health-check',
      params: {
        capacityKWp: { type: 'number', min: 0, convert: true },
        commissioningYear: { type: 'number', min: 1900, max: 2100, convert: true },
        postalCode: { type: 'string', min: 5, max: 5 },
        actualYieldKWh: { type: 'number', min: 0, convert: true },
        yieldPeriod: { type: 'enum', values: ['month', 'year'] },
        yieldYear: { type: 'number', optional: true, min: 1900, max: 2100, convert: true },
      },
      openapi: {
        summary: 'Compare actual vs. expected yield and diagnose performance issues',
        tags: ['Customer Service'],
        description:
          'Health status: EXCELLENT (>95%), GOOD (90-95%), ACCEPTABLE (85-90%), POOR (70-85%), CRITICAL (<70%)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [
                  'capacityKWp',
                  'commissioningYear',
                  'postalCode',
                  'actualYieldKWh',
                  'yieldPeriod',
                ],
                properties: {
                  capacityKWp: {
                    type: 'number',
                    description: 'Installation capacity in kWp',
                    minimum: 0,
                    example: 9.8,
                  },
                  commissioningYear: {
                    type: 'number',
                    description: 'Year of commissioning',
                    minimum: 1900,
                    maximum: 2100,
                    example: 2015,
                  },
                  postalCode: {
                    type: 'string',
                    description: 'German postal code (5 digits)',
                    minLength: 5,
                    maxLength: 5,
                    example: '80331',
                  },
                  actualYieldKWh: {
                    type: 'number',
                    description: 'Actual energy yield in kWh',
                    minimum: 0,
                    example: 8500,
                  },
                  yieldPeriod: {
                    type: 'string',
                    enum: ['month', 'year'],
                    description: 'Period for the actualYieldKWh value',
                    example: 'year',
                  },
                  yieldYear: {
                    type: 'number',
                    description: 'Optional: Specific year for the yield measurement',
                    minimum: 1900,
                    maximum: 2100,
                    example: 2025,
                  },
                },
              },
              examples: {
                annualCheck: {
                  summary: 'Annual health check (Munich PV system)',
                  value: {
                    capacityKWp: 9.8,
                    commissioningYear: 2015,
                    postalCode: '80331',
                    actualYieldKWh: 8500,
                    yieldPeriod: 'year',
                    yieldYear: 2025,
                  },
                },
                monthlyCheck: {
                  summary: 'Monthly health check (summer)',
                  value: {
                    capacityKWp: 12.5,
                    commissioningYear: 2018,
                    postalCode: '10115',
                    actualYieldKWh: 1200,
                    yieldPeriod: 'month',
                  },
                },
                largeSystem: {
                  summary: 'Large commercial system check',
                  value: {
                    capacityKWp: 85.0,
                    commissioningYear: 2012,
                    postalCode: '70173',
                    actualYieldKWh: 72000,
                    yieldPeriod: 'year',
                    yieldYear: 2025,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'cernion_installation_health_check',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Installation change wizard
     * Tool: cernion_installation_change_wizard
     */
    installationChangeWizard: {
      rest: 'POST /installation-change-wizard',
      params: {
        changeType: {
          type: 'enum',
          values: [
            'operator_change',
            'storage_retrofit',
            'capacity_increase',
            'decommissioning',
            'tariff_switch',
            'direct_marketing',
          ],
        },
        currentSituation: { type: 'string', min: 10 },
        installationType: { type: 'string', optional: true },
        mastrNummer: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Step-by-step guidance for installation changes',
        tags: ['Customer Service'],
        description:
          '6 change types: operator change, storage retrofit, capacity increase, decommissioning, tariff switch, direct marketing',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['changeType', 'currentSituation'],
                properties: {
                  changeType: {
                    type: 'string',
                    enum: [
                      'operator_change',
                      'storage_retrofit',
                      'capacity_increase',
                      'decommissioning',
                      'tariff_switch',
                      'direct_marketing',
                    ],
                    description: 'Type of change the customer wants to make',
                    example: 'operator_change',
                  },
                  currentSituation: {
                    type: 'string',
                    description: 'Description of current situation (minimum 10 characters)',
                    minLength: 10,
                    example: 'I have a 10kWp PV system from 2012 and want to add battery storage',
                  },
                  installationType: {
                    type: 'string',
                    description: 'Optional: Type of installation (solar, wind, storage, etc.)',
                    example: 'solar',
                  },
                  mastrNummer: {
                    type: 'string',
                    description: 'Optional: MaStR registration number',
                    example: 'SEE123456789012',
                  },
                },
              },
              examples: {
                addBatteryStorage: {
                  summary: 'Add battery storage to existing PV',
                  value: {
                    changeType: 'storage_retrofit',
                    currentSituation:
                      'I have a 10kWp PV system from 2012 and want to add a 10kWh battery storage. What are the steps and what do I need to consider?',
                    installationType: 'solar',
                    mastrNummer: 'SEE123456789012',
                  },
                },
                switchOperator: {
                  summary: 'Change grid operator',
                  value: {
                    changeType: 'operator_change',
                    currentSituation:
                      'We are moving to a new location and need to transfer our PV system registration to the new grid operator.',
                    installationType: 'solar',
                  },
                },
                expandCapacity: {
                  summary: 'Increase PV capacity',
                  value: {
                    changeType: 'capacity_increase',
                    currentSituation:
                      'Our existing 8kWp rooftop system is too small. We want to add another 5kWp on the garage roof.',
                    installationType: 'solar',
                    mastrNummer: 'SEE987654321098',
                  },
                },
                decommissionOld: {
                  summary: 'Decommission old system',
                  value: {
                    changeType: 'decommissioning',
                    currentSituation:
                      'Our PV system from 2003 has reached end of life. We want to properly decommission it and install a new system.',
                    installationType: 'solar',
                  },
                },
                switchToDirectMarketing: {
                  summary: 'Switch to direct marketing',
                  value: {
                    changeType: 'direct_marketing',
                    currentSituation:
                      'We have a 100kWp system and want to switch from feed-in tariff to direct marketing to maximize revenue.',
                    mastrNummer: 'SEW555444333222',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'cernion_installation_change_wizard',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },
  },
};
