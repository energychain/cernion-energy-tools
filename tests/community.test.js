'use strict';

const { ServiceBroker } = require('moleculer');
const CommunityService = require('../services/community.service');

describe('Community Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({
      logger: false,
      transporter: null,
    });

    // Load actual community service
    broker.createService(CommunityService);

    // Mock dependent services for delegation testing
    broker.createService({
      name: 'grid-operations',
      actions: {
        vnbLookup: {
          handler(ctx) {
            return {
              success: true,
              companyName: 'Netze BW GmbH',
              mastrId: 'SNB12345678',
            };
          },
        },
      },
    });

    broker.createService({
      name: 'energy-market',
      actions: {
        co2Intensity: {
          handler(ctx) {
            return {
              success: true,
              co2_intensity_gco2eq_kwh: 120,
            };
          },
        },
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('Service Configuration', () => {
    it('should have correct name', () => {
      expect(CommunityService.name).toBe('community');
    });

    it('should expose consult action', () => {
      expect(CommunityService.actions.consult).toBeDefined();
    });
  });

  describe('B2C Intent Resolution', () => {
    it('should resolve prosumer_basics intent', async () => {
      const res = await broker.call('community.consult', {
        message: 'Was sind die Grundlagen für Prosumer?',
      });
      expect(res.success).toBe(true);
      expect(res.domainIntent).toBe('prosumer_basics');
      expect(res.reply).toContain('Erneuerbare-Energien-Gesetz');
      expect(res.responseStrategy.audience).toBe('community');
      expect(res.responseStrategy.safetyClassification).toBe('read_only');
    });

    it('should resolve balcony_pv_value intent', async () => {
      const res = await broker.call('community.consult', {
        message: 'Lohnt sich ein Balkonkraftwerk für mich?',
      });
      expect(res.success).toBe(true);
      expect(res.domainIntent).toBe('balcony_pv_value');
      expect(res.reply).toContain('Wechselrichter-Limit');
    });

    it('should resolve device_support_hoymiles intent', async () => {
      const res = await broker.call('community.consult', {
        message: 'Werden Hoymiles Wechselrichter unterstützt?',
      });
      expect(res.success).toBe(true);
      expect(res.domainIntent).toBe('device_support_hoymiles');
      expect(res.reply).toContain('OpenDTU');
    });

    it('should resolve pv_yield_diagnostics intent', async () => {
      const res = await broker.call('community.consult', {
        message: 'Wie mache ich eine Ertragsdiagnose meiner Solaranlage?',
      });
      expect(res.success).toBe(true);
      expect(res.domainIntent).toBe('pv_yield_diagnostics');
    });

    it('should resolve home_storage_roi intent', async () => {
      const res = await broker.call('community.consult', {
        message: 'Wie berechne ich die Wirtschaftlichkeit eines Batteriespeichers?',
      });
      expect(res.success).toBe(true);
      expect(res.domainIntent).toBe('home_storage_roi');
    });

    it('should resolve section14a_consumer intent', async () => {
      const res = await broker.call('community.consult', {
        message: 'Was besagt der §14a EnWG für Endverbraucher?',
      });
      expect(res.success).toBe(true);
      expect(res.domainIntent).toBe('section14a_consumer');
    });

    it('should resolve mastr_registration_qa intent', async () => {
      const res = await broker.call('community.consult', {
        message: 'Wie registriere ich mich im Marktstammdatenregister?',
      });
      expect(res.success).toBe(true);
      expect(res.domainIntent).toBe('mastr_registration_qa');
    });

    it('should resolve community_energy_sharing_explain intent', async () => {
      const res = await broker.call('community.consult', {
        message: 'Kann ich mit meinen Nachbarn Strom teilen über Energy Sharing?',
      });
      expect(res.success).toBe(true);
      expect(res.domainIntent).toBe('community_energy_sharing_explain');
    });

    it('should resolve green_power_literacy intent', async () => {
      const res = await broker.call('community.consult', {
        message: 'Wie funktioniert der Grünstrom-Index (GSI)?',
      });
      expect(res.success).toBe(true);
      expect(res.domainIntent).toBe('green_power_literacy');
    });
  });

  describe('Location Extraction and Dynamic Routing', () => {
    it('should extract postcode and perform VNB lookup delegation', async () => {
      const res = await broker.call('community.consult', {
        message: 'Wer ist mein Netzbetreiber in 69256 Mauer?',
      });
      expect(res.success).toBe(true);
      expect(res.reply).toContain('Live-Netzauskunft');
      expect(res.reply).toContain('Netze BW GmbH');
      expect(res.sources.some((s) => s.type === 'vnb_identity')).toBe(true);
    });

    it('should extract city name and perform VNB lookup delegation', async () => {
      const res = await broker.call('community.consult', {
        message: 'Zuständiger Verteilnetzbetreiber in Heidelberg?',
      });
      expect(res.success).toBe(true);
      expect(res.reply).toContain('Live-Netzauskunft');
      expect(res.reply).toContain('Netze BW GmbH');
    });

    it('should extract location and delegate CO2 forecast lookup', async () => {
      const res = await broker.call('community.consult', {
        message: 'Wie hoch ist die CO2-Intensität in Mauer?',
      });
      expect(res.success).toBe(true);
      expect(res.reply).toContain('CO2-Intensität');
      expect(res.reply).toContain('120');
      expect(res.sources.some((s) => s.type === 'co2_forecast')).toBe(true);
    });

    it('should flag missing inputs when requesting location-dependent facts without location', async () => {
      const res = await broker.call('community.consult', {
        message: 'Wer ist mein Netzbetreiber?',
      });
      expect(res.success).toBe(true);
      expect(res.consultation.executionReadiness).toBe('missing_inputs');
      expect(res.consultation.openQuestions[0]).toContain('Postleitzahl');
    });
  });
});
