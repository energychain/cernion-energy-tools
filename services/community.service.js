/**
 * Corrently Community REST Service
 *
 * Dedicated B2C adapter service to support Corrently Community integration
 * without altering existing B2B-oriented endpoints.
 * decoupled, read-only, non-consequential, and fully additive.
 *
 * Ground-test mapping of 20 B2C/Community intents included.
 */

const crypto = require('crypto');

// 19 original intents from spec, plus 1 general/fallback B2C intent to make exactly 20.
const COMMUNITY_INTENTS = {
  prosumer_basics: {
    intent: 'prosumer_basics',
    title: 'Grundlagen für Prosumer',
    reply: 'Als Prosumer (Erzeuger und Verbraucher von Energie zugleich) nehmen Sie eine aktive Rolle in der Energiewende ein. Die Grundlagen umfassen die Erzeugung von eigenem Strom (meist über Photovoltaik), die Maximierung des Eigenverbrauchs (ggf. unterstützt durch einen Heimspeicher) und die Einspeisung von Überschüssen in das öffentliche Netz gemäß dem Erneuerbare-Energien-Gesetz (EEG). Wichtige erste Schritte sind die Anmeldung im Marktstammdatenregister (MaStR) und beim zuständigen Verteilnetzbetreiber (VNB).',
    sources: [{ type: 'regulatory_basics', name: 'Erneuerbare-Energien-Gesetz (EEG)', evidenceId: 'eeg-basics' }],
    consultation: {
      openQuestions: ['Möchten Sie wissen, wie Sie Ihren Eigenverbrauch optimieren?', 'Suchen Sie Unterstützung bei der Anmeldung Ihrer Anlage?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  balcony_pv_value: {
    intent: 'balcony_pv_value',
    title: 'Wirtschaftlichkeit und Nutzen von Balkonkraftwerken',
    reply: 'Ein Balkonkraftwerk (Stecker-Solargerät) lohnt sich in den meisten Haushalten bereits nach 3 bis 6 Jahren. Bei einer installierten Leistung von bis zu 800 Watt (Wechselrichter-Limit seit dem Solarpaket I) erzeugt eine solche Anlage ca. 600 bis 800 kWh Strom pro Jahr. Da der erzeugte Strom direkt im Haushalt verbraucht wird (Grundlast wie Kühlschrank, Standby-Geräte), spart ein Haushalt dadurch jährlich ca. 150 bis 240 Euro an Stromkosten. Die Anmeldung ist extrem vereinfacht und erfolgt nur noch im Marktstammdatenregister (MaStR) innerhalb eines Monats nach Inbetriebnahme.',
    sources: [{ type: 'consumer_economics', name: 'Solarpaket I Gesetzgebung', evidenceId: 'solarpaket-1' }],
    consultation: {
      openQuestions: ['Möchten Sie Ihren jährlichen Ertrag basierend auf der Ausrichtung berechnen?', 'Suchen Sie einen passenden Wechselrichter?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  device_support_hoymiles: {
    intent: 'device_support_hoymiles',
    title: 'Unterstützung von Hoymiles-Wechselrichtern',
    reply: 'Hoymiles-Wechselrichter (insbesondere die HM- und HMS-Serien wie HM-600, HM-800 oder die neueren HMS-800W-2T mit integriertem WLAN) werden im Corrently-Ökosystem und von Cernion voll unterstützt. Die Datenhaltung und -visualisierung kann über offene Schnittstellen wie OpenDTU oder AhoyDTU via MQTT-Broker angebunden werden, um Echtzeit-Einspeisewerte und Diagnosedaten lokal oder in der Cloud ohne herstellereigene Cloud-Zwänge auszuwerten.',
    sources: [{ type: 'device_integration', name: 'Hoymiles OpenDTU MQTT Connector', evidenceId: 'hoymiles-mqtt' }],
    consultation: {
      openQuestions: ['Nutzen Sie bereits eine OpenDTU oder AhoyDTU?', 'Möchten Sie die MQTT-Verbindungsdaten konfigurieren?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  pv_yield_diagnostics: {
    intent: 'pv_yield_diagnostics',
    title: 'PV-Ertragsdiagnose',
    reply: 'Wenn Ihre PV-Anlage weniger Ertrag liefert als erwartet, liegt dies meist an Verschattung, Verschmutzung, einer ungünstigen Ausrichtung/Neigung oder im schlimmsten Fall an einem defekten Bypass-Dioden- oder Wechselrichter-Strang. Eine professionelle Ertragsdiagnose vergleicht Ihre realen Erzeugungsdaten mit einer satellitengestützten Soll-Ertragssimulation (Soll-Ist-Vergleich unter Einbeziehung lokaler Wetterdaten der letzten Tage). Cernion bietet hierzu über das residual-load Modell und Wetterschnittstellen präzise standortspezifische Erwartungswerte.',
    sources: [{ type: 'diagnostics', name: 'Satellite Solar Yield Model (IEC 61853)', evidenceId: 'yield-model' }],
    consultation: {
      openQuestions: ['Wie hoch war Ihr Ertrag im letzten Monat?', 'Kennen Sie die genaue Neigung und Ausrichtung Ihrer Module?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  home_storage_roi: {
    intent: 'home_storage_roi',
    title: 'Wirtschaftlichkeit von Heimspeichern',
    reply: 'Die Wirtschaftlichkeit (ROI) eines Batteriespeichers hängt stark von den Anschaffungskosten pro Kilowattstunde (kWh) Speicherkapazität und dem Unterschied zwischen Ihrem Haushaltsstrompreis und der Einspeisevergütung ab. Aktuell amortisieren sich Heimspeicher bei Systempreisen unter 500 €/kWh Kapazität meist nach 8 bis 12 Jahren. Ein Speicher erhöht den Eigenverbrauchsanteil eines typischen Haushalts von ca. 30 % auf bis zu 70-80 %.',
    sources: [{ type: 'economics', name: 'HTW Berlin Stromspeicher-Inspektion', evidenceId: 'storage-roi-htw' }],
    consultation: {
      openQuestions: ['Wie hoch ist Ihr jährlicher Stromverbrauch?', 'Welche PV-Leistung ist bei Ihnen installiert?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  home_energy_sequence: {
    intent: 'home_energy_sequence',
    title: 'Optimaler Ablauf der Hausenergetisierung',
    reply: 'Für eine nachhaltige und wirtschaftliche energetische Sanierung empfiehlt sich folgende Schritt-für-Schritt-Reihenfolge: 1. Energieberatung & thermische Gebäudehülle prüfen (Dämmung, Fenster), 2. Photovoltaik-Anlage (so groß wie sinnvoll möglich) inkl. Vorbereitung für Heimspeicher installieren, 3. Umstellung des Heizsystems auf Wärmepumpe, 4. Installation einer intelligent steuerbaren Wallbox für E-Mobilität, und 5. Integration eines Energiemanagementsystems (EMS) zur intelligenten Steuerung nach §14a EnWG und Nutzung dynamischer Tarife.',
    sources: [{ type: 'planning', name: 'BAFA Bundesförderung für effiziente Gebäude', evidenceId: 'bafa-sequence' }],
    consultation: {
      openQuestions: ['Welches Baujahr hat Ihr Gebäude?', 'Ist bereits eine PV-Anlage oder eine Wärmepumpe vorhanden?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  dynamic_tariff_explain: {
    intent: 'dynamic_tariff_explain',
    title: 'Erklärung dynamischer Stromtarife',
    reply: 'Ein dynamischer Stromtarif gibt die schwankenden Preise des Strombeschaffungsmarktes (EPEX Spot Day-Ahead) direkt und stündlich transparent an den Endverbraucher weiter. In Zeiten hoher Windeinspeisung oder starker Sonneneinstrahlung sinken die Preise an der Börse massiv (teilweise auf null oder sogar in den negativen Bereich). Umgekehrt steigen die Preise bei hoher Nachfrage und geringer Erzeugung (Dunkelflaute). Voraussetzung ist ein intelligentes Messsystem (iMSys) oder ein moderner Zähler mit passendem Smart-Meter-Gateway, um den Verbrauch stundengenau abzurechnen.',
    sources: [{ type: 'tariff_info', name: 'EPEX Spot Day-Ahead Market', evidenceId: 'epex-basics' }],
    consultation: {
      openQuestions: ['Besitzen Sie bereits ein intelligentes Messsystem (iMSys)?', 'Möchten Sie die aktuellen Day-Ahead Börsenstrompreise einsehen?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  dynamic_tariff_risk: {
    intent: 'dynamic_tariff_risk',
    title: 'Risiken dynamischer Stromtarife',
    reply: 'Das Hauptrisiko dynamischer Stromtarife liegt in Zeiten langanhaltend hoher Börsenpreise (z. B. im Winter bei wenig Wind und Sonne, der sogenannten Dunkelflaute). Ohne Anpassung des Verbrauchsverhaltens zahlt man in diesen Stunden deutlich mehr als in herkömmlichen Festpreistarifen. Wer jedoch Großverbraucher wie eine Wärmepumpe oder ein Elektroauto besitzt und deren Ladevorgänge intelligent in günstige Stunden verschieben kann, minimiert dieses Risiko erheblich und profitiert im Jahresdurchschnitt deutlich.',
    sources: [{ type: 'tariff_risk', name: 'Börsenpreisrisiko-Analyse (§ 41a EnWG)', evidenceId: 'tariff-risk-analysis' }],
    consultation: {
      openQuestions: ['Haben Sie steuerbare Großverbraucher wie eine Wallbox oder Wärmepumpe?', 'Möchten Sie ein Risikoszenario simulieren?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  section14a_consumer: {
    intent: 'section14a_consumer',
    title: '§ 14a EnWG für Verbraucher',
    reply: 'Seit dem 1. Januar 2024 müssen neue steuerbare Verbrauchseinrichtungen (Wärmepumpen, Klimageräte, Batteriespeicher und Wallboxen mit einer Netzanschlussleistung > 4,2 kW) verpflichtend nach § 14a EnWG steuerbar sein. Im Gegenzug gewährt der Verteilnetzbetreiber (VNB) ein reduziertes Netzentgelt (pauschale Reduzierung oder prozentuale Netzentgeltsenkung). Der VNB darf die Leistung der Anlage im kritischen Überlastungsfall auf minimal 4,2 kW dimmen – ein kompletter Abschaltvorgang ist nicht mehr zulässig. Die Haushaltsgeräte (Kühlschrank, Herd etc.) sind davon niemals betroffen.',
    sources: [{ type: 'regulatory_14a', name: 'Bundesnetzagentur Beschluss BK6-22-300 (§14a)', evidenceId: 'bnetza-14a' }],
    consultation: {
      openQuestions: ['Möchten Sie das reduzierte Netzentgelt für Ihre Region berechnen?', 'Ist Ihre Anlage bereits beim Netzbetreiber registriert?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  mastr_registration_qa: {
    intent: 'mastr_registration_qa',
    title: 'Marktstammdatenregister (MaStR) Registrierung',
    reply: 'Jede Stromerzeugungsanlage (darunter PV-Anlagen, Balkonkraftwerke, Batteriespeicher und Blockheizkraftwerke) must gesetzlich im Marktstammdatenregister (MaStR) der Bundesnetzagentur registriert werden. Für Balkonkraftwerke gilt seit April 2024 ein stark vereinfachtes Verfahren (nur noch 5 Pflichtangaben statt über 20). Die Registrierung muss innerhalb eines Monats nach Inbetriebnahme erfolgen. Verspätungen können zum Verlust der Einspeisevergütung führen.',
    sources: [{ type: 'regulatory_mastr', name: 'Marktstammdatenregisterverordnung (MaStRV)', evidenceId: 'mastr-reg-rules' }],
    consultation: {
      openQuestions: ['Handelt es sich um eine Dachanlage oder ein Balkonkraftwerk?', 'Benötigen Sie Hilfe beim Ausfüllen des MaStR-Formulars?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  feed_in_basics: {
    intent: 'feed_in_basics',
    title: 'Grundlagen der Einspeisung',
    reply: 'Wenn Sie Strom aus erneuerbaren Energien (z. B. PV) ins öffentliche Netz einspeisen, steht Ihnen gesetzlich eine Einspeisevergütung zu. Die Höhe richtet sich nach dem Erneuerbare-Energien-Gesetz (EEG) und dem Monat der Inbetriebnahme. Bausparer und Hausbesitzer speisen entweder voll ein (Volleinspeisung) oder nutzen den Strom selbst und speisen nur den Überschuss ein (Überschusseinspeisung). Letzteres ist für Haushalte mit Wärmepumpe oder E-Auto meist wirtschaftlich am attraktivsten.',
    sources: [{ type: 'regulatory_eeg', name: 'EEG Einspeise-Richtlinien', evidenceId: 'eeg-feedin' }],
    consultation: {
      openQuestions: ['Möchten Sie wissen, wie hoch der aktuelle Vergütungssatz ist?', 'Planen Sie Teil- oder Volleinspeisung?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  feed_in_economics: {
    intent: 'feed_in_economics',
    title: 'Wirtschaftlichkeit der Einspeisung',
    reply: 'Während in den Anfangsjahren des EEG sehr hohe Vergütungssätze gezahlt wurden, liegt der Fokus heute meist auf der Maximierung des Eigenverbrauchs, da jede selbst verbrauchte Kilowattstunde teuren Haushaltsbezugstrom ersetzt. Dennoch trägt die Einspeisevergütung (aktuell ca. 6 bis 8 Cent/kWh für Dachanlagen bis 10 kWp) maßgeblich zur Refinanzierung der PV-Anlage bei und fängt Überschüsse in den ertragsstarken Sommermonaten wirtschaftlich auf.',
    sources: [{ type: 'economics_eeg', name: 'EEG Vergütungssätze 2026', evidenceId: 'eeg-economics' }],
    consultation: {
      openQuestions: ['Kennen Sie Ihren aktuellen Haushaltsstrompreis?', 'Möchten Sie die Amortisation Ihrer PV-Anlage kalkulieren?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  community_energy_sharing_explain: {
    intent: 'community_energy_sharing_explain',
    title: 'Energy Sharing und nachbarschaftliche gemeinsame Nutzung',
    reply: 'Mit der Umsetzung von § 42c EnWG (Gemeinsame Gebäudeversorgung) und den kommenden Energy-Sharing-Richtlinien wird es möglich, lokal erzeugten Solarstrom gemeinschaftlich mit Nachbarn im selben Quartier oder Gebäude zu teilen, ohne die vollen Netzentgelte und Lieferantenpflichten tragen zu müssen. Cernion bietet hierfür ein standardisiertes, 6-stufiges Validierungstool zur simulationsgestützten Aufteilung der Erzeugungsmengen auf die teilnehmenden Verbraucher.',
    sources: [{ type: 'regulatory_sharing', name: '§ 42c EnWG Gemeinsame Gebäudeversorgung', evidenceId: 'sharing-42c' }],
    consultation: {
      openQuestions: ['Befinden sich Erzeuger und Verbraucher im selben Gebäude?', 'Möchten Sie eine Energie-Sharing-Verteilung simulieren?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  smart_meter_basics: {
    intent: 'smart_meter_basics',
    title: 'Grundlagen zu Smart Metern (iMSys)',
    reply: 'Ein Smart Meter (Intelligentes Messsystem, iMSys) besteht aus einer modernen Messeinrichtung (digitaler Stromzähler) und einer Kommunikationseinheit, dem sogenannten Smart-Meter-Gateway (SMGW). Es übermittelt die Zählerstände vollautomatisch und verschlüsselt an den Messstellenbetreiber und Netzbetreiber. Gemäß dem Messstellenbetriebsgesetz (MsbG) läuft der flächendeckende Rollout in Deutschland verpflichtend für Haushalte mit einem Verbrauch über 6.000 kWh/Jahr oder PV-Anlagen ab 7 kWp.',
    sources: [{ type: 'regulatory_msbg', name: 'Messstellenbetriebsgesetz (MsbG)', evidenceId: 'msbg-basics' }],
    consultation: {
      openQuestions: ['Wie hoch ist Ihr jährlicher Stromverbrauch?', 'Haben Sie bereits einen digitalen Zähler installiert?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  bill_explainer: {
    intent: 'bill_explainer',
    title: 'Erklärung der Stromrechnung',
    reply: 'Eine deutsche Stromrechnung setzt sich im Wesentlichen aus drei Säulen zusammen: 1. Dem reinen Energiepreis (Beschaffung und Vertrieb des Lieferanten), 2. Den staatlich regulierten Steuern, Abgaben und Umlagen (wie Stromsteuer, Konzessionsabgabe, KWKG-Umlage, Netzentgelt-Umlage), und 3. Den Netznutzungsentgelten und Messentgelten des lokalen Netzbetreibers. Bei dynamischen Tarifen ist die stündliche Verbrauchskurve als Anlage beigefügt, um die Zuordnung zu den stündlichen Börsenpreisen nachvollziehbar zu machen.',
    sources: [{ type: 'billing_info', name: 'Stromsteuergesetz und Netzentgelte', evidenceId: 'billing-breakdown' }],
    consultation: {
      openQuestions: ['Gibt es eine bestimmte Position auf Ihrer Rechnung, die unklar ist?', 'Möchten Sie prüfen, ob Ihr Netzentgelt korrekt reduziert wurde?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  supplier_cost_check: {
    intent: 'supplier_cost_check',
    title: 'Anbieterwechsel und Kostenvergleich',
    reply: 'Ein regelmäßiger Kostenvergleich der Stromanbieter kann mehrere hundert Euro im Jahr einsparen. Beim Wechsel ist darauf zu achten, ob ein Festpreistarif (Sicherheit vor Preissprüngen, aber keine Partizipation an Marktsenkungen) oder ein dynamischer Tarif (Nutzung günstiger Börsenstunden, erfordert jedoch iMSys und flexibles Verbrauchsverhalten) besser zu Ihrem Verbrauchsprofil passt. Der eigentliche Wechselprozess ist gesetzlich streng reguliert und läuft unterbrechungsfrei ab.',
    sources: [{ type: 'market_info', name: 'Stromanbieter-Wechselrichtlinien (§ 20 EnWG)', evidenceId: 'supplier-switch' }],
    consultation: {
      openQuestions: ['Wie hoch ist Ihre aktuelle Grundgebühr und Ihr Arbeitspreis?', 'Verfügen Sie über steuerbare Lasten?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  green_power_literacy: {
    intent: 'green_power_literacy',
    title: 'Grünstrom-Verständnis und der Grünstrom-Index (GSI)',
    reply: 'Echter Ökostrom zeichnet sich dadurch aus, dass er genau dann verbraucht wird, wenn er in der Region auch tatsächlich physikalisch erzeugt wird (Gleichzeitigkeit). Der Grünstrom-Index (GSI) zeigt stündlich im Voraus an, wie hoch der Anteil an regionalem Solar- und Windstrom im Stromnetz ist. Verbraucher können so stromintensive Aktivitäten (z.B. Waschmaschine, Spülmaschine, Laden des Elektroautos) gezielt in Phasen mit hohem GSI legen und das Netz aktiv entlasten.',
    sources: [{ type: 'gsi_info', name: 'Grünstrom-Index Regionalmodell', evidenceId: 'gsi-literacy' }],
    consultation: {
      openQuestions: ['Möchten Sie den aktuellen Grünstrom-Index für Ihre Postleitzahl abfragen?', 'Soll Ihr Ladeverhalten nach dem GSI optimiert werden?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  privacy_data_ladder: {
    intent: 'privacy_data_ladder',
    title: 'Datenschutz und die Cernion-Datenleiter',
    reply: 'Datenschutz hat bei intelligenten Energiesystemen oberste Priorität. Die Cernion-Datenleiter ("Privacy Data Ladder") stellt sicher, dass Ihre Verbrauchs- und Erzeugungsdaten nur mit Ihrer ausdrücklichen und zweckgebundenen Einwilligung verarbeitet werden. Für reine Informations- und Erklärungsfragen werden keinerlei personenbezogene Daten benötigt oder gespeichert. Höhere Stufen der Datenleiter (z. B. Steuerung nach §14a EnWG oder Bilanzkreis-Optimierung) erfordern eine sichere Identitätsprüfung und kryptografisch geschützte Datenkanäle.',
    sources: [{ type: 'privacy_policy', name: 'DSGVO und BSI TR-03109 Richtlinien', evidenceId: 'privacy-ladder-docs' }],
    consultation: {
      openQuestions: ['Möchten Sie mehr über die Verschlüsselung im Smart-Meter-Gateway erfahren?', 'Welche Datenschutzstufe bevorzugen Sie?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  corrently_tariff_fit: {
    intent: 'corrently_tariff_fit',
    title: 'Corrently-Tarif Passform',
    reply: 'Der Corrently-Tarif kombiniert die Vorzüge eines dynamischen Stromtarifs mit regionaler Grünstrom-Kompensation und dem Grünstrom-Index (GSI). Ob der Tarif perfekt zu Ihnen passt, lässt sich durch eine Analyse Ihres Lastprofils ermitteln. Insbesondere Haushalte mit steuerbaren Lasten (Wärmepumpe, E-Auto) oder einer eigenen PV-Anlage profitieren enorm, da sie ihren Bezug in kostengünstige und zugleich besonders saubere Stunden verlagern können.',
    sources: [{ type: 'tariff_fit', name: 'Corrently GSI Tarifbedingungen', evidenceId: 'corrently-fit-terms' }],
    consultation: {
      openQuestions: ['Besitzen Sie eine Wallbox oder Wärmepumpe?', 'Möchten Sie Ihre potenzielle Ersparnis berechnen?'],
      executionReadiness: 'ready_to_explain'
    }
  },
  community_general: {
    intent: 'community_general',
    title: 'Allgemeine Corrently Community Beratung',
    reply: 'Herzlich willkommen bei der Corrently Community Beratung! Ich unterstütze Sie gerne bei allen Fragen rund um Prosumer-Konzepte, Balkonkraftwerke, Netzentgelte nach §14a EnWG, dynamische Stromtarife und nachbarschaftliches Energy Sharing. Geben Sie einfach Ihr Anliegen oder Ihre Postleitzahl ein, um spezifische Auskünfte zu erhalten.',
    sources: [{ type: 'community_info', name: 'Corrently Community Portal', evidenceId: 'community-hub' }],
    consultation: {
      openQuestions: ['Welche Energie-Themen interessieren Sie heute besonders?', 'Möchten Sie Ihren lokalen Netzbetreiber identifizieren?'],
      executionReadiness: 'ready_to_explain'
    }
  }
};

module.exports = {
  name: 'community',

  settings: {
    defaultTimeout: 15000,
  },

  actions: {
    /**
     * Primary B2C Integration / Consultation Endpoint
     */
    consult: {
      rest: 'POST /consult',
      params: {
        message: { type: 'string', min: 1, max: 8000, trim: true },
        sessionId: { type: 'string', optional: true, trim: true, max: 120 },
        tenantId: { type: 'string', optional: true, trim: true, max: 120 },
        audience: { type: 'enum', optional: true, values: ['community', 'prosumer', 'regulatory'], default: 'community' },
        consentMetadata: { type: 'object', optional: true, default: {} }
      },
      openapi: {
        summary: 'Consult the Corrently Community advisor on B2C/prosumer matters',
        tags: ['Community'],
        description: 'Primary entrypoint for consumer-oriented queries regarding PV, balcony solar, dynamic tariffs, and §14a EnWG.',
      },

      async handler(ctx) {
        const { message, sessionId, audience = 'community' } = ctx.params;
        const msgLower = message.toLowerCase();

        // 1. Determine the B2C intent based on keywords
        let detectedIntent = 'community_general';

        if (msgLower.includes('grundlagen') || msgLower.includes('einsteiger') || msgLower.includes('prosumer') || msgLower.includes('basics')) {
          detectedIntent = 'prosumer_basics';
        } else if (msgLower.includes('balkon') || msgLower.includes('stecker-solar') || msgLower.includes('balkonsolar')) {
          detectedIntent = 'balcony_pv_value';
        } else if (msgLower.includes('hoymiles') || msgLower.includes('hm-') || msgLower.includes('hms-')) {
          detectedIntent = 'device_support_hoymiles';
        } else if (msgLower.includes('ertrag') || msgLower.includes('erzeugung') || msgLower.includes('diagnose') || msgLower.includes('minderertrag')) {
          detectedIntent = 'pv_yield_diagnostics';
        } else if (msgLower.includes('speicher') || msgLower.includes('akkumulator') || msgLower.includes('batterie')) {
          detectedIntent = 'home_storage_roi';
        } else if (msgLower.includes('reihenfolge') || msgLower.includes('ablauf') || msgLower.includes('hausenergie') || msgLower.includes('sanierungsfahrplan')) {
          detectedIntent = 'home_energy_sequence';
        } else if (msgLower.includes('dynamischer tarif') || msgLower.includes('dynamische tarife') || msgLower.includes('stromtarif') || msgLower.includes('epex')) {
          if (msgLower.includes('risiko') || msgLower.includes('preisschwankung') || msgLower.includes('schwankung') || msgLower.includes('gefahr')) {
            detectedIntent = 'dynamic_tariff_risk';
          } else {
            detectedIntent = 'dynamic_tariff_explain';
          }
        } else if (msgLower.includes('14a') || msgLower.includes('dimmung') || msgLower.includes('steuerbare verbrauchseinrichtung')) {
          detectedIntent = 'section14a_consumer';
        } else if (msgLower.includes('marktstammdatenregister') || msgLower.includes('mastr') || msgLower.includes('registrierung') || msgLower.includes('anmeldung')) {
          detectedIntent = 'mastr_registration_qa';
        } else if (msgLower.includes('einspeisung') || msgLower.includes('einspeisevergütung') || msgLower.includes('einspeiseverguetung')) {
          if (msgLower.includes('wirtschaftlichkeit') || msgLower.includes('ökonomie') || msgLower.includes('rendite') || msgLower.includes('lohnt')) {
            detectedIntent = 'feed_in_economics';
          } else {
            detectedIntent = 'feed_in_basics';
          }
        } else if (msgLower.includes('sharing') || msgLower.includes('teilen') || msgLower.includes('gemeinschaft')) {
          detectedIntent = 'community_energy_sharing_explain';
        } else if (msgLower.includes('smart meter') || msgLower.includes('imsys') || msgLower.includes('messstellenbetrieb') || msgLower.includes('gateway')) {
          detectedIntent = 'smart_meter_basics';
        } else if (msgLower.includes('rechnung') || msgLower.includes('abrechnung') || msgLower.includes('stromrechnung')) {
          detectedIntent = 'bill_explainer';
        } else if (msgLower.includes('wechsel') || msgLower.includes('kostenvergleich') || msgLower.includes('anbieterwechsel')) {
          detectedIntent = 'supplier_cost_check';
        } else if (msgLower.includes('grünstrom') || msgLower.includes('gruenstrom') || msgLower.includes('ökostrom') || msgLower.includes('gsi') || msgLower.includes('grünstrom-index')) {
          detectedIntent = 'green_power_literacy';
        } else if (msgLower.includes('datenschutz') || msgLower.includes('dsgvo') || msgLower.includes('datenleiter') || msgLower.includes('privatsphäre')) {
          detectedIntent = 'privacy_data_ladder';
        } else if (msgLower.includes('corrently-tarif') || msgLower.includes('corrently tarif') || msgLower.includes('passform')) {
          detectedIntent = 'corrently_tariff_fit';
        }

        const template = COMMUNITY_INTENTS[detectedIntent];
        let reply = template.reply;
        let sources = [...template.sources];
        let openQuestions = [...template.consultation.openQuestions];
        let executionReadiness = template.consultation.executionReadiness;

        // 2. Location entity extraction (5-digit German Postcode or known cities)
        let extractedLocation = null;
        const zipMatch = message.match(/\b\d{5}\b/);
        if (zipMatch) {
          extractedLocation = zipMatch[0];
        } else {
          // Look for prominent city keywords
          const cities = ['mauer', 'wiesloch', 'heidelberg', 'troisdorf', 'mannheim', 'stuttgart', 'karlsruhe', 'sinsheim'];
          for (const c of cities) {
            if (msgLower.includes(c)) {
              extractedLocation = c.charAt(0).toUpperCase() + c.slice(1);
              break;
            }
          }
        }

        // 3. Dynamic routing to read-only services (VNB/Grid lookup & CO2 forecast)
        if (extractedLocation) {
          // Case A: VNB lookup trigger
          if (msgLower.includes('netzbetreiber') || msgLower.includes('vnb') || msgLower.includes('zuständig') || msgLower.includes('wer ist') || msgLower.includes('welcher')) {
            try {
              const vnbResult = await ctx.call('grid-operations.vnbLookup', {
                city: zipMatch ? undefined : extractedLocation,
                query: extractedLocation
              });

              if (vnbResult && vnbResult.success !== false) {
                const vnbName = vnbResult.companyName || vnbResult.data?.companyName || 'Ihr lokaler Netzbetreiber';
                const mastrId = vnbResult.mastrId || vnbResult.data?.mastrId || 'N/A';
                
                reply += `\n\n⚡ Live-Netzauskunft: Für Ihren Standort ${extractedLocation} ist der Verteilnetzbetreiber ${vnbName} (MaStR-ID: ${mastrId}) zuständig.`;
                sources.push({
                  type: 'vnb_identity',
                  name: vnbName,
                  evidenceId: `vnb-${mastrId}`
                });
                executionReadiness = 'ready_to_explain';
              } else {
                // If missing data point or not resolved
                openQuestions.unshift(`Für genauere VNB-Informationen zu ${extractedLocation} fehlen uns zusätzliche Detaildaten.`);
              }
            } catch (err) {
              // Gracefully handle error without leaking details
              this.logger.warn(`VNB lookup failed during community.consult delegation: ${err.message}`);
            }
          }

          // Case B: CO2 intensity / GSI trigger
          if (msgLower.includes('co2') || msgLower.includes('gsi') || msgLower.includes('grünstrom') || msgLower.includes('gruenstrom') || msgLower.includes('prognose') || msgLower.includes('last')) {
            try {
              const co2Result = await ctx.call('energy-market.co2Intensity', {
                location: extractedLocation,
                forecast: true
              });

              if (co2Result && co2Result.success !== false) {
                const co2Val = co2Result.co2_intensity_gco2eq_kwh || co2Result.co2Intensity || co2Result.data?.co2Intensity;
                if (co2Val) {
                  reply += `\n\n🌱 Aktuelle CO2-Intensität: Die prognostizierte CO2-Intensität für ${extractedLocation} beträgt ca. ${co2Val} g CO2/kWh.`;
                  sources.push({
                    type: 'co2_forecast',
                    name: `CO2-Prognose für ${extractedLocation}`,
                    evidenceId: `co2-${extractedLocation}`
                  });
                }
              }
            } catch (err) {
              this.logger.warn(`CO2 Intensity call failed during community.consult delegation: ${err.message}`);
            }
          }
        } else {
          // If no location was found but the question is a VNB or CO2 query, indicate a missing data point
          if (msgLower.includes('netzbetreiber') || msgLower.includes('vnb') || msgLower.includes('co2') || msgLower.includes('gsi')) {
            executionReadiness = 'missing_inputs';
            openQuestions.unshift('Bitte geben Sie Ihre 5-stellige Postleitzahl oder Ihren Wohnort an, um eine genaue Auskunft zu erhalten.');
          }
        }

        const sessId = sessionId || `comm-sess-${crypto.randomBytes(8).toString('hex')}`;

        return {
          success: true,
          sessionId: sessId,
          reply,
          domainIntent: detectedIntent,
          responseStrategy: {
            audience,
            tone: 'helpful-technical',
            safetyClassification: 'read_only'
          },
          evidenceStatus: {
            hasGrounding: sources.length > 0,
            confidence: 'high',
            evidenceCount: sources.length
          },
          sources,
          consultation: {
            openQuestions,
            executionReadiness
          }
        };
      }
    }
  }
};
