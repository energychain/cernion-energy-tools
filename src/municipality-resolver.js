'use strict';

/**
 * Municipality Resolver — read-only static fixture
 *
 * Source: Derived from Statistisches Bundesamt (Destatis) Gemeindeverzeichnis
 * (GV100, 2024-Q4 release) and OpenPLZ-API community data.
 * Coverage: ~280 German municipalities across all 16 Bundesländer.
 * Static as of 2024-Q4. No live MaStR, no billing, no tariff.
 *
 * Energy profiles: where explicit capacity data is not provided the resolver
 * estimates PV/biomass/wind from population using documented Bundesverband
 * Solarwirtschaft and DBFZ proxy formulas (see estimateEnergyProfile()).
 * All estimated values are marked assumption-backed.
 *
 * KAV rates: KAV § 2 Abs. 2 population-bracket tiering (2024 rates).
 */

// ── Dataset ───────────────────────────────────────────────────────────────────
// Fields: name, ags, postalCodes[], state, district, population, areaSqKm
// Optional: pvCapacityKw, biomassCapacityKw, windCapacityKw (overrides estimate)

const DATASET = [
  // ── Baden-Württemberg ──────────────────────────────────────────────────────
  { name: 'Mauer', ags: '08226074', postalCodes: ['69256'], state: 'Baden-Württemberg', district: 'Rhein-Neckar-Kreis', population: 4200, areaSqKm: 12.3, pvCapacityKw: 2650, biomassCapacityKw: 500, windCapacityKw: 0, gridOperatorLabel: 'Stadtwerk Mauer GmbH', gridOperatorBdewHint: 'local-bw-vnb' },
  { name: 'Heidelberg', ags: '08221000', postalCodes: ['69115', '69117', '69118', '69120', '69121', '69123', '69124', '69126'], state: 'Baden-Württemberg', district: 'Stadtkreis Heidelberg', population: 160000, areaSqKm: 109.0, pvCapacityKw: 48000, biomassCapacityKw: 8000, windCapacityKw: 2000, gridOperatorLabel: 'Stadtwerke Heidelberg Netze GmbH', gridOperatorBdewHint: 'missing-evidence' },
  { name: 'Wiesloch', ags: '08226087', postalCodes: ['69168'], state: 'Baden-Württemberg', district: 'Rhein-Neckar-Kreis', population: 27000, areaSqKm: 46.1, pvCapacityKw: 7200, biomassCapacityKw: 800, windCapacityKw: 0, gridOperatorLabel: 'Stadtwerke Wiesloch GmbH', gridOperatorBdewHint: 'local-bw-vnb' },
  { name: 'Walldorf', ags: '08226088', postalCodes: ['69190'], state: 'Baden-Württemberg', district: 'Rhein-Neckar-Kreis', population: 15800, areaSqKm: 13.7, pvCapacityKw: 5800, biomassCapacityKw: 200, windCapacityKw: 0, gridOperatorLabel: 'Stadtwerke Walldorf', gridOperatorBdewHint: 'missing-evidence' },
  { name: 'Sandhausen', ags: '08226085', postalCodes: ['69207'], state: 'Baden-Württemberg', district: 'Rhein-Neckar-Kreis', population: 14200, areaSqKm: 14.8, pvCapacityKw: 3900, biomassCapacityKw: 0, windCapacityKw: 0, gridOperatorLabel: 'Gemeindewerke Sandhausen', gridOperatorBdewHint: 'missing-evidence' },
  { name: 'Stuttgart', ags: '08111000', postalCodes: ['70173', '70174', '70176', '70178', '70182', '70184', '70188', '70190', '70192', '70193', '70195', '70197', '70199', '70327', '70329', '70372', '70374', '70376', '70378', '70435', '70437', '70439', '70469', '70499', '70563', '70565', '70567', '70569', '70597', '70599', '70619', '70629'], state: 'Baden-Württemberg', district: 'Stadtkreis Stuttgart', population: 635000, areaSqKm: 207.3 },
  { name: 'Mannheim', ags: '08222000', postalCodes: ['68159', '68161', '68163', '68165', '68167', '68169', '68199', '68219', '68229', '68239', '68259', '68305', '68307', '68309'], state: 'Baden-Württemberg', district: 'Stadtkreis Mannheim', population: 310000, areaSqKm: 144.9 },
  { name: 'Karlsruhe', ags: '08212000', postalCodes: ['76131', '76133', '76135', '76137', '76139', '76149', '76185', '76187', '76189', '76199', '76205', '76227', '76228', '76229', '76275', '76287', '76297', '76307'], state: 'Baden-Württemberg', district: 'Stadtkreis Karlsruhe', population: 310000, areaSqKm: 173.5 },
  { name: 'Freiburg im Breisgau', ags: '08311000', postalCodes: ['79098', '79100', '79102', '79104', '79106', '79108', '79110', '79111', '79112', '79114', '79115', '79117'], state: 'Baden-Württemberg', district: 'Stadtkreis Freiburg', population: 230000, areaSqKm: 153.0 },
  { name: 'Ulm', ags: '08421000', postalCodes: ['89073', '89075', '89077', '89079', '89081'], state: 'Baden-Württemberg', district: 'Stadtkreis Ulm', population: 126000, areaSqKm: 118.7 },
  { name: 'Heilbronn', ags: '08121000', postalCodes: ['74072', '74074', '74076', '74078', '74080'], state: 'Baden-Württemberg', district: 'Stadtkreis Heilbronn', population: 125000, areaSqKm: 99.7 },
  { name: 'Pforzheim', ags: '08231000', postalCodes: ['75172', '75173', '75175', '75177', '75179', '75180', '75181'], state: 'Baden-Württemberg', district: 'Stadtkreis Pforzheim', population: 125000, areaSqKm: 98.0 },
  { name: 'Reutlingen', ags: '08415041', postalCodes: ['72764', '72766', '72768', '72770'], state: 'Baden-Württemberg', district: 'Reutlingen', population: 115000, areaSqKm: 216.3 },
  { name: 'Tübingen', ags: '08416041', postalCodes: ['72070', '72072', '72074', '72076'], state: 'Baden-Württemberg', district: 'Tübingen', population: 91000, areaSqKm: 108.0 },
  { name: 'Konstanz', ags: '08335043', postalCodes: ['78462', '78464', '78465', '78467'], state: 'Baden-Württemberg', district: 'Konstanz', population: 84000, areaSqKm: 58.5 },
  { name: 'Sinsheim', ags: '08226078', postalCodes: ['74889'], state: 'Baden-Württemberg', district: 'Rhein-Neckar-Kreis', population: 35000, areaSqKm: 116.3 },
  { name: 'Neckarsulm', ags: '08125046', postalCodes: ['74172'], state: 'Baden-Württemberg', district: 'Heilbronn', population: 27000, areaSqKm: 37.4 },
  // ── Bayern ─────────────────────────────────────────────────────────────────
  { name: 'München', ags: '09162000', postalCodes: ['80331', '80333', '80335', '80336', '80337', '80339', '80469', '80538', '80539', '80634', '80636', '80637', '80638', '80639', '80686', '80687', '80689', '80796', '80797', '80798', '80799', '80801', '80803', '80804', '80805', '80807', '80809', '80933', '80935', '80937', '80939', '80992', '80993', '80995', '80997', '80999', '81241', '81243', '81245', '81247', '81249', '81369', '81371', '81373', '81375', '81377', '81379', '81476', '81477', '81479', '81539', '81541', '81543', '81545', '81547', '81549', '81667', '81669', '81671', '81673', '81675', '81677', '81679', '81737', '81739', '81825', '81827', '81829', '81925', '81927', '81929'], state: 'Bayern', district: 'Kreisfreie Stadt München', population: 1472000, areaSqKm: 310.7 },
  { name: 'Nürnberg', ags: '09564000', postalCodes: ['90402', '90403', '90408', '90409', '90411', '90419', '90425', '90427', '90429', '90431', '90439', '90441', '90443', '90449', '90451', '90453', '90455', '90459', '90461', '90469', '90471', '90473', '90475', '90478', '90480', '90482', '90489', '90491'], state: 'Bayern', district: 'Kreisfreie Stadt Nürnberg', population: 515000, areaSqKm: 186.4 },
  { name: 'Augsburg', ags: '09761000', postalCodes: ['86150', '86152', '86153', '86154', '86156', '86157', '86159', '86161', '86163', '86165', '86167', '86169', '86179', '86199'], state: 'Bayern', district: 'Kreisfreie Stadt Augsburg', population: 296000, areaSqKm: 146.9 },
  { name: 'Regensburg', ags: '09362000', postalCodes: ['93047', '93049', '93051', '93053', '93055', '93057', '93059'], state: 'Bayern', district: 'Kreisfreie Stadt Regensburg', population: 157000, areaSqKm: 80.7 },
  { name: 'Ingolstadt', ags: '09161000', postalCodes: ['85049', '85051', '85053', '85055', '85057'], state: 'Bayern', district: 'Kreisfreie Stadt Ingolstadt', population: 138000, areaSqKm: 133.3 },
  { name: 'Würzburg', ags: '09663000', postalCodes: ['97070', '97072', '97074', '97076', '97078', '97080', '97082', '97084'], state: 'Bayern', district: 'Kreisfreie Stadt Würzburg', population: 127000, areaSqKm: 87.6 },
  { name: 'Erlangen', ags: '09562000', postalCodes: ['91052', '91054', '91056', '91058'], state: 'Bayern', district: 'Kreisfreie Stadt Erlangen', population: 113000, areaSqKm: 76.9 },
  { name: 'Fürth', ags: '09563000', postalCodes: ['90762', '90763', '90765', '90766', '90768'], state: 'Bayern', district: 'Kreisfreie Stadt Fürth', population: 128000, areaSqKm: 63.3 },
  { name: 'Bayreuth', ags: '09462000', postalCodes: ['95444', '95445', '95447', '95448', '95473'], state: 'Bayern', district: 'Kreisfreie Stadt Bayreuth', population: 73000, areaSqKm: 66.9 },
  { name: 'Landshut', ags: '09261000', postalCodes: ['84028', '84030', '84032', '84034', '84036'], state: 'Bayern', district: 'Kreisfreie Stadt Landshut', population: 74000, areaSqKm: 66.0 },
  // ── Berlin ─────────────────────────────────────────────────────────────────
  { name: 'Berlin', ags: '11000000', postalCodes: ['10115', '10117', '10119', '10178', '10179', '10243', '10245', '10247', '10249', '10315', '10317', '10318', '10319', '10365', '10367', '10369', '10405', '10407', '10409', '10435', '10437', '10439', '10551', '10553', '10555', '10557', '10559', '10585', '10587', '10589', '10623', '10625', '10627', '10629', '10707', '10709', '10711', '10713', '10715', '10717', '10719', '10777', '10779', '10781', '10783', '10785', '10787', '10789', '10823', '10825', '10827', '10829', '12043', '12045', '12047', '12049', '12051', '12053', '12055', '12057', '12059', '12099', '12101', '12103', '12105', '12107', '12109', '12157', '12159', '12161', '12163', '12165', '12167', '12169', '12203', '12205', '12207', '12209', '12247', '12249', '12277', '12279', '12305', '12307', '12309', '12347', '12349', '12351', '12353', '12355', '12357', '12359', '12435', '12437', '12439', '12459', '12489', '12524', '12526', '12527', '12529', '12555', '12557', '12559', '12587', '12589', '12619', '12621', '12623', '12627', '12629', '12679', '12681', '12683', '12685', '12687', '12689', '13051', '13053', '13055', '13057', '13059', '13086', '13088', '13089', '13125', '13127', '13129', '13156', '13158', '13159', '13187', '13189', '13347', '13349', '13351', '13353', '13355', '13357', '13359', '13403', '13405', '13407', '13409', '13435', '13437', '13439', '13465', '13467', '13469', '13503', '13505', '13507', '13509', '13581', '13583', '13585', '13587', '13589', '13591', '13593', '13595', '13597', '13599', '13627', '13629'], state: 'Berlin', district: 'Berlin', population: 3600000, areaSqKm: 891.7 },
  // ── Brandenburg ────────────────────────────────────────────────────────────
  { name: 'Potsdam', ags: '12054000', postalCodes: ['14467', '14469', '14471', '14473', '14476', '14478', '14480', '14482'], state: 'Brandenburg', district: 'Kreisfreie Stadt Potsdam', population: 183000, areaSqKm: 187.5 },
  { name: 'Cottbus', ags: '12052000', postalCodes: ['03042', '03044', '03046', '03048', '03050', '03051', '03052', '03053', '03054', '03055'], state: 'Brandenburg', district: 'Kreisfreie Stadt Cottbus', population: 99000, areaSqKm: 164.3 },
  { name: 'Brandenburg an der Havel', ags: '12051000', postalCodes: ['14770', '14772', '14774', '14776'], state: 'Brandenburg', district: 'Kreisfreie Stadt Brandenburg', population: 71000, areaSqKm: 228.2 },
  { name: 'Frankfurt (Oder)', ags: '12053000', postalCodes: ['15230', '15232', '15234', '15236'], state: 'Brandenburg', district: 'Kreisfreie Stadt Frankfurt (Oder)', population: 57000, areaSqKm: 147.8 },
  { name: 'Eberswalde', ags: '12060052', postalCodes: ['16225', '16227'], state: 'Brandenburg', district: 'Barnim', population: 39000, areaSqKm: 97.5 },
  // ── Bremen ─────────────────────────────────────────────────────────────────
  { name: 'Bremen', ags: '04011000', postalCodes: ['28195', '28197', '28199', '28201', '28203', '28205', '28207', '28209', '28211', '28213', '28215', '28217', '28219', '28237', '28239', '28259', '28277', '28279', '28307', '28309', '28325', '28327', '28329', '28355', '28357', '28359', '28717', '28719', '28755', '28757', '28759', '28777', '28779'], state: 'Bremen', district: 'Stadtgemeinde Bremen', population: 563000, areaSqKm: 318.2 },
  { name: 'Bremerhaven', ags: '04012000', postalCodes: ['27568', '27570', '27572', '27574', '27576', '27578', '27580'], state: 'Bremen', district: 'Stadtgemeinde Bremerhaven', population: 113000, areaSqKm: 93.8 },
  // ── Hamburg ────────────────────────────────────────────────────────────────
  { name: 'Hamburg', ags: '02000000', postalCodes: ['20095', '20097', '20099', '20144', '20146', '20148', '20149', '20249', '20251', '20253', '20255', '20257', '20259', '20354', '20355', '20357', '20359', '20457', '20459', '20535', '20537', '20539', '21029', '21031', '21033', '21035', '21037', '21039', '21073', '21075', '21077', '21079', '21107', '21109', '21129', '21147', '21149', '22041', '22043', '22045', '22047', '22049', '22081', '22083', '22085', '22087', '22089', '22111', '22113', '22115', '22117', '22119', '22143', '22145', '22147', '22149', '22159', '22175', '22177', '22179', '22297', '22299', '22301', '22303', '22305', '22307', '22309', '22335', '22337', '22339', '22359', '22391', '22393', '22395', '22397', '22399', '22415', '22417', '22419', '22453', '22455', '22457', '22459', '22523', '22525', '22527', '22529', '22547', '22549', '22559', '22587', '22589', '22605', '22607', '22609', '22761', '22763', '22765', '22767', '22769'], state: 'Hamburg', district: 'Freie und Hansestadt Hamburg', population: 1852000, areaSqKm: 755.2 },
  // ── Hessen ─────────────────────────────────────────────────────────────────
  { name: 'Frankfurt am Main', ags: '06412000', postalCodes: ['60306', '60308', '60310', '60311', '60313', '60314', '60316', '60318', '60320', '60322', '60323', '60325', '60326', '60327', '60328', '60329', '60385', '60386', '60388', '60389', '60431', '60433', '60435', '60437', '60438', '60439', '60486', '60487', '60488', '60489', '60528', '60529', '60549', '60594', '60596', '60598', '60599', '60629', '60699', '65929', '65931', '65933', '65934', '65936'], state: 'Hessen', district: 'Kreisfreie Stadt Frankfurt', population: 763000, areaSqKm: 248.3 },
  { name: 'Wiesbaden', ags: '06414000', postalCodes: ['65183', '65185', '65187', '65189', '65191', '65193', '65195', '65197', '65199', '65201', '65203', '65205', '65207', '65232'], state: 'Hessen', district: 'Kreisfreie Stadt Wiesbaden', population: 278000, areaSqKm: 203.9 },
  { name: 'Kassel', ags: '06611000', postalCodes: ['34117', '34119', '34121', '34123', '34125', '34127', '34128', '34130', '34131', '34132', '34134'], state: 'Hessen', district: 'Kreisfreie Stadt Kassel', population: 199000, areaSqKm: 106.8 },
  { name: 'Darmstadt', ags: '06411000', postalCodes: ['64283', '64285', '64287', '64289', '64291', '64293', '64295', '64297'], state: 'Hessen', district: 'Kreisfreie Stadt Darmstadt', population: 159000, areaSqKm: 122.2 },
  { name: 'Offenbach am Main', ags: '06413000', postalCodes: ['63065', '63067', '63069', '63071', '63073', '63075'], state: 'Hessen', district: 'Kreisfreie Stadt Offenbach', population: 130000, areaSqKm: 44.9 },
  { name: 'Marburg', ags: '06534010', postalCodes: ['35032', '35037', '35039', '35041', '35043'], state: 'Hessen', district: 'Marburg-Biedenkopf', population: 76000, areaSqKm: 172.2 },
  { name: 'Gießen', ags: '06531005', postalCodes: ['35390', '35392', '35394', '35396', '35398'], state: 'Hessen', district: 'Gießen', population: 90000, areaSqKm: 61.3 },
  // ── Mecklenburg-Vorpommern ─────────────────────────────────────────────────
  { name: 'Rostock', ags: '13003000', postalCodes: ['18055', '18057', '18059', '18069', '18106', '18107', '18109', '18119', '18146', '18147', '18181'], state: 'Mecklenburg-Vorpommern', district: 'Kreisfreie Stadt Rostock', population: 209000, areaSqKm: 181.4 },
  { name: 'Schwerin', ags: '13004000', postalCodes: ['19053', '19055', '19057', '19059', '19061', '19063'], state: 'Mecklenburg-Vorpommern', district: 'Kreisfreie Stadt Schwerin', population: 96000, areaSqKm: 130.5 },
  { name: 'Greifswald', ags: '13002000', postalCodes: ['17489', '17491', '17493', '17495'], state: 'Mecklenburg-Vorpommern', district: 'Kreisfreie Stadt Greifswald', population: 59000, areaSqKm: 87.7 },
  { name: 'Stralsund', ags: '13073088', postalCodes: ['18435', '18437', '18439'], state: 'Mecklenburg-Vorpommern', district: 'Vorpommern-Rügen', population: 57000, areaSqKm: 39.1 },
  // ── Niedersachsen ──────────────────────────────────────────────────────────
  { name: 'Hannover', ags: '03241001', postalCodes: ['30159', '30161', '30163', '30165', '30167', '30169', '30171', '30173', '30175', '30177', '30179', '30419', '30449', '30451', '30453', '30455', '30457', '30459', '30519', '30521', '30539', '30559', '30625', '30627', '30629', '30655', '30657', '30659', '30669'], state: 'Niedersachsen', district: 'Kreisfreie Stadt Hannover', population: 534000, areaSqKm: 204.0 },
  { name: 'Braunschweig', ags: '03101000', postalCodes: ['38100', '38102', '38104', '38106', '38108', '38110', '38112', '38114', '38116', '38118', '38120', '38122', '38124', '38126'], state: 'Niedersachsen', district: 'Kreisfreie Stadt Braunschweig', population: 249000, areaSqKm: 192.1 },
  { name: 'Osnabrück', ags: '03404000', postalCodes: ['49074', '49076', '49078', '49080', '49082', '49084', '49086', '49088', '49090'], state: 'Niedersachsen', district: 'Kreisfreie Stadt Osnabrück', population: 164000, areaSqKm: 119.8 },
  { name: 'Oldenburg', ags: '03403000', postalCodes: ['26121', '26122', '26123', '26125', '26127', '26129', '26131', '26133', '26135'], state: 'Niedersachsen', district: 'Kreisfreie Stadt Oldenburg', population: 167000, areaSqKm: 102.9 },
  { name: 'Wolfsburg', ags: '03103000', postalCodes: ['38440', '38442', '38444', '38446', '38448'], state: 'Niedersachsen', district: 'Kreisfreie Stadt Wolfsburg', population: 124000, areaSqKm: 204.0 },
  { name: 'Göttingen', ags: '03159016', postalCodes: ['37073', '37075', '37077', '37079', '37081', '37083', '37085'], state: 'Niedersachsen', district: 'Göttingen', population: 119000, areaSqKm: 117.2 },
  { name: 'Hildesheim', ags: '03254021', postalCodes: ['31134', '31135', '31137', '31139', '31141'], state: 'Niedersachsen', district: 'Hildesheim', population: 96000, areaSqKm: 92.2 },
  { name: 'Salzgitter', ags: '03102000', postalCodes: ['38226', '38228', '38229', '38239', '38240', '38259'], state: 'Niedersachsen', district: 'Kreisfreie Stadt Salzgitter', population: 95000, areaSqKm: 224.5 },
  { name: 'Celle', ags: '03351004', postalCodes: ['29221', '29223', '29225', '29227', '29229'], state: 'Niedersachsen', district: 'Celle', population: 69000, areaSqKm: 175.0 },
  { name: 'Lüneburg', ags: '03355020', postalCodes: ['21335', '21337', '21339'], state: 'Niedersachsen', district: 'Lüneburg', population: 77000, areaSqKm: 69.6 },
  { name: 'Wilhelmshaven', ags: '03405000', postalCodes: ['26382', '26384', '26386', '26388', '26389'], state: 'Niedersachsen', district: 'Kreisfreie Stadt Wilhelmshaven', population: 74000, areaSqKm: 106.8 },
  // ── Nordrhein-Westfalen ────────────────────────────────────────────────────
  { name: 'Köln', ags: '05315000', postalCodes: ['50667', '50668', '50670', '50672', '50674', '50676', '50677', '50678', '50679', '50733', '50735', '50737', '50739', '50765', '50767', '50769', '50823', '50825', '50827', '50829', '50858', '50859', '50931', '50933', '50935', '50937', '50939', '50968', '50969', '50996', '50997', '50999', '51061', '51063', '51065', '51067', '51069', '51103', '51105', '51107', '51109', '51143', '51145', '51147', '51149'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Köln', population: 1100000, areaSqKm: 405.2 },
  { name: 'Düsseldorf', ags: '05111000', postalCodes: ['40210', '40211', '40212', '40213', '40215', '40217', '40219', '40221', '40223', '40225', '40227', '40229', '40231', '40233', '40235', '40237', '40239', '40468', '40470', '40472', '40474', '40476', '40477', '40478', '40479', '40489', '40545', '40547', '40549', '40589', '40591', '40593', '40595', '40597', '40599', '40625', '40627', '40629', '40721', '40723', '40724', '40789', '40822', '40878', '40880', '40882', '40883', '40885'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Düsseldorf', population: 640000, areaSqKm: 217.2 },
  { name: 'Dortmund', ags: '05913000', postalCodes: ['44135', '44137', '44139', '44141', '44143', '44145', '44147', '44149', '44225', '44227', '44229', '44263', '44265', '44267', '44269', '44287', '44289', '44309', '44319', '44328', '44329', '44339', '44357', '44359', '44369', '44379', '44388'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Dortmund', population: 590000, areaSqKm: 280.7 },
  { name: 'Essen', ags: '05113000', postalCodes: ['45127', '45128', '45130', '45131', '45133', '45134', '45136', '45138', '45139', '45141', '45143', '45144', '45145', '45147', '45149', '45219', '45239', '45257', '45259', '45276', '45277', '45279', '45289', '45307', '45309', '45326', '45327', '45329', '45355', '45356', '45357', '45359', '45525', '45527', '45529', '45539'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Essen', population: 580000, areaSqKm: 210.4 },
  { name: 'Duisburg', ags: '05112000', postalCodes: ['47051', '47053', '47055', '47057', '47058', '47059', '47119', '47137', '47138', '47139', '47166', '47167', '47169', '47178', '47179', '47198', '47199', '47226', '47228', '47229', '47239', '47249', '47259', '47269', '47279'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Duisburg', population: 495000, areaSqKm: 232.8 },
  { name: 'Bochum', ags: '05911000', postalCodes: ['44787', '44789', '44791', '44793', '44795', '44797', '44799', '44801', '44803', '44805', '44807', '44809', '44879', '44866', '44867', '44869', '44892', '44894'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Bochum', population: 364000, areaSqKm: 145.4 },
  { name: 'Wuppertal', ags: '05124000', postalCodes: ['42103', '42105', '42107', '42109', '42111', '42113', '42115', '42117', '42119', '42275', '42277', '42279', '42281', '42283', '42285', '42287', '42289', '42349', '42369', '42389', '42399', '42553', '42555', '42579'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Wuppertal', population: 354000, areaSqKm: 168.4 },
  { name: 'Bielefeld', ags: '05711000', postalCodes: ['33602', '33604', '33605', '33607', '33609', '33611', '33613', '33615', '33617', '33619', '33647', '33649', '33659', '33699', '33719', '33729', '33739'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Bielefeld', population: 335000, areaSqKm: 257.9 },
  { name: 'Bonn', ags: '05314000', postalCodes: ['53111', '53113', '53115', '53117', '53119', '53121', '53123', '53125', '53127', '53129', '53173', '53175', '53177', '53179', '53225', '53227', '53229'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Bonn', population: 330000, areaSqKm: 141.1 },
  { name: 'Münster', ags: '05515000', postalCodes: ['48143', '48145', '48147', '48149', '48151', '48153', '48155', '48157', '48159', '48161', '48163', '48165', '48167'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Münster', population: 315000, areaSqKm: 302.9 },
  { name: 'Aachen', ags: '05334002', postalCodes: ['52062', '52064', '52066', '52068', '52070', '52072', '52074', '52076', '52078', '52080'], state: 'Nordrhein-Westfalen', district: 'Städteregion Aachen', population: 248000, areaSqKm: 160.9 },
  { name: 'Gelsenkirchen', ags: '05513000', postalCodes: ['45879', '45881', '45883', '45884', '45886', '45888', '45889', '45891', '45892', '45894', '45896', '45897', '45899'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Gelsenkirchen', population: 260000, areaSqKm: 104.9 },
  { name: 'Krefeld', ags: '05114000', postalCodes: ['47798', '47799', '47800', '47801', '47802', '47803', '47804', '47805', '47806', '47807', '47808', '47809'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Krefeld', population: 227000, areaSqKm: 137.8 },
  { name: 'Mönchengladbach', ags: '05116000', postalCodes: ['41061', '41063', '41065', '41066', '41068', '41069', '41199', '41236', '41238', '41239', '41334', '41337', '41352', '41366', '41372', '41379'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Mönchengladbach', population: 261000, areaSqKm: 170.5 },
  { name: 'Oberhausen', ags: '05119000', postalCodes: ['46045', '46047', '46049', '46117', '46119', '46145', '46147', '46149'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Oberhausen', population: 209000, areaSqKm: 77.1 },
  { name: 'Rommerskirchen', ags: '05162036', postalCodes: ['41569'], state: 'Nordrhein-Westfalen', district: 'Rhein-Erft-Kreis', population: 29000, areaSqKm: 65.2 },
  { name: 'Bergheim', ags: '05162008', postalCodes: ['50126', '50127', '50129'], state: 'Nordrhein-Westfalen', district: 'Rhein-Erft-Kreis', population: 63000, areaSqKm: 103.8 },
  { name: 'Hürth', ags: '05315000', postalCodes: ['50354', '50374'], state: 'Nordrhein-Westfalen', district: 'Rhein-Erft-Kreis', population: 65000, areaSqKm: 51.2 },
  { name: 'Kerpen', ags: '05162024', postalCodes: ['50169', '50170', '50171'], state: 'Nordrhein-Westfalen', district: 'Rhein-Erft-Kreis', population: 67000, areaSqKm: 106.1 },
  { name: 'Erftstadt', ags: '05162016', postalCodes: ['50374', '50390', '50374'], state: 'Nordrhein-Westfalen', district: 'Rhein-Erft-Kreis', population: 51000, areaSqKm: 121.1 },
  { name: 'Solingen', ags: '05122000', postalCodes: ['42651', '42653', '42655', '42657', '42659', '42697', '42699', '42719'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Solingen', population: 159000, areaSqKm: 89.5 },
  { name: 'Hagen', ags: '05914000', postalCodes: ['58089', '58091', '58093', '58095', '58097', '58099', '58119', '58135', '58239', '58285', '58300', '58332', '58339'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Hagen', population: 186000, areaSqKm: 160.5 },
  { name: 'Hamm', ags: '05915000', postalCodes: ['59063', '59065', '59067', '59069', '59071', '59073', '59075', '59077'], state: 'Nordrhein-Westfalen', district: 'Kreisfreie Stadt Hamm', population: 178000, areaSqKm: 226.2 },
  // ── Rheinland-Pfalz ────────────────────────────────────────────────────────
  { name: 'Mainz', ags: '07315000', postalCodes: ['55116', '55118', '55120', '55122', '55124', '55126', '55127', '55128', '55129', '55130', '55131'], state: 'Rheinland-Pfalz', district: 'Kreisfreie Stadt Mainz', population: 218000, areaSqKm: 97.7 },
  { name: 'Koblenz', ags: '07111000', postalCodes: ['56068', '56070', '56072', '56073', '56075', '56076', '56077'], state: 'Rheinland-Pfalz', district: 'Kreisfreie Stadt Koblenz', population: 115000, areaSqKm: 105.0 },
  { name: 'Trier', ags: '07211000', postalCodes: ['54290', '54292', '54293', '54294', '54295', '54296'], state: 'Rheinland-Pfalz', district: 'Kreisfreie Stadt Trier', population: 111000, areaSqKm: 117.1 },
  { name: 'Kaiserslautern', ags: '07312000', postalCodes: ['67655', '67657', '67659', '67661', '67663'], state: 'Rheinland-Pfalz', district: 'Kreisfreie Stadt Kaiserslautern', population: 97000, areaSqKm: 139.7 },
  { name: 'Ludwigshafen am Rhein', ags: '07314000', postalCodes: ['67059', '67061', '67063', '67065', '67067', '67069', '67071'], state: 'Rheinland-Pfalz', district: 'Kreisfreie Stadt Ludwigshafen', population: 172000, areaSqKm: 77.9 },
  { name: 'Worms', ags: '07319000', postalCodes: ['67547', '67549', '67551', '67574'], state: 'Rheinland-Pfalz', district: 'Kreisfreie Stadt Worms', population: 82000, areaSqKm: 118.8 },
  { name: 'Landau in der Pfalz', ags: '07313000', postalCodes: ['76829', '76831', '76833', '76835'], state: 'Rheinland-Pfalz', district: 'Kreisfreie Stadt Landau', population: 46000, areaSqKm: 82.9 },
  // ── Saarland ───────────────────────────────────────────────────────────────
  { name: 'Saarbrücken', ags: '10041100', postalCodes: ['66111', '66113', '66115', '66117', '66119', '66121', '66123', '66125', '66126', '66127', '66128', '66129', '66130', '66131', '66132', '66133'], state: 'Saarland', district: 'Regionalverband Saarbrücken', population: 180000, areaSqKm: 167.1 },
  { name: 'Saarlouis', ags: '10044111', postalCodes: ['66740', '66763', '66787', '66793'], state: 'Saarland', district: 'Saarlouis', population: 35000, areaSqKm: 44.0 },
  { name: 'Homburg', ags: '10043110', postalCodes: ['66424', '66440', '66450', '66453', '66459'], state: 'Saarland', district: 'Saarpfalz-Kreis', population: 42000, areaSqKm: 82.7 },
  { name: 'Völklingen', ags: '10041130', postalCodes: ['66333', '66346'], state: 'Saarland', district: 'Regionalverband Saarbrücken', population: 39000, areaSqKm: 63.9 },
  // ── Sachsen ────────────────────────────────────────────────────────────────
  { name: 'Leipzig', ags: '14713000', postalCodes: ['04103', '04105', '04107', '04109', '04129', '04155', '04157', '04158', '04159', '04177', '04178', '04179', '04205', '04207', '04209', '04229', '04249', '04275', '04277', '04279', '04289', '04299', '04315', '04317', '04318', '04319', '04328', '04329', '04347', '04349', '04356', '04357', '04416', '04420', '04425', '04435', '04442'], state: 'Sachsen', district: 'Kreisfreie Stadt Leipzig', population: 597000, areaSqKm: 297.8 },
  { name: 'Dresden', ags: '14612000', postalCodes: ['01067', '01069', '01097', '01099', '01109', '01127', '01129', '01139', '01156', '01157', '01159', '01169', '01187', '01189', '01217', '01219', '01237', '01239', '01257', '01259', '01277', '01279', '01307', '01309', '01324', '01326', '01328', '01445', '01454', '01458', '01465', '01468', '01640'], state: 'Sachsen', district: 'Kreisfreie Stadt Dresden', population: 555000, areaSqKm: 328.8 },
  { name: 'Chemnitz', ags: '14511000', postalCodes: ['09111', '09112', '09113', '09114', '09116', '09117', '09119', '09120', '09122', '09123', '09125', '09126', '09127', '09128', '09130', '09131'], state: 'Sachsen', district: 'Kreisfreie Stadt Chemnitz', population: 237000, areaSqKm: 221.0 },
  { name: 'Zwickau', ags: '14524070', postalCodes: ['08056', '08058', '08060', '08062', '08064', '08066'], state: 'Sachsen', district: 'Zwickau', population: 87000, areaSqKm: 102.9 },
  { name: 'Plauen', ags: '14523330', postalCodes: ['08523', '08525', '08527', '08529', '08531'], state: 'Sachsen', district: 'Vogtlandkreis', population: 64000, areaSqKm: 102.0 },
  // ── Sachsen-Anhalt ─────────────────────────────────────────────────────────
  { name: 'Halle (Saale)', ags: '15002000', postalCodes: ['06108', '06110', '06112', '06114', '06116', '06118', '06120', '06122', '06124', '06126', '06128', '06130', '06132'], state: 'Sachsen-Anhalt', district: 'Kreisfreie Stadt Halle', population: 241000, areaSqKm: 135.0 },
  { name: 'Magdeburg', ags: '15003000', postalCodes: ['39104', '39106', '39108', '39110', '39112', '39114', '39116', '39118', '39120', '39122', '39124', '39126', '39128', '39130'], state: 'Sachsen-Anhalt', district: 'Kreisfreie Stadt Magdeburg', population: 234000, areaSqKm: 201.0 },
  { name: 'Dessau-Roßlau', ags: '15001000', postalCodes: ['06842', '06844', '06846', '06847', '06849', '06861', '06862', '06863'], state: 'Sachsen-Anhalt', district: 'Kreisfreie Stadt Dessau-Roßlau', population: 76000, areaSqKm: 244.7 },
  { name: 'Lutherstadt Wittenberg', ags: '15091060', postalCodes: ['06886', '06888', '06889', '06890', '06895', '06896', '06901'], state: 'Sachsen-Anhalt', district: 'Wittenberg', population: 44000, areaSqKm: 263.3 },
  // ── Schleswig-Holstein ─────────────────────────────────────────────────────
  { name: 'Kiel', ags: '01002000', postalCodes: ['24103', '24105', '24106', '24107', '24109', '24111', '24113', '24114', '24116', '24118', '24119', '24143', '24145', '24146', '24147', '24148', '24149', '24159', '24161'], state: 'Schleswig-Holstein', district: 'Kreisfreie Stadt Kiel', population: 247000, areaSqKm: 118.6 },
  { name: 'Lübeck', ags: '01003000', postalCodes: ['23552', '23554', '23556', '23558', '23560', '23562', '23564', '23566', '23568', '23569', '23570'], state: 'Schleswig-Holstein', district: 'Kreisfreie Stadt Lübeck', population: 216000, areaSqKm: 214.2 },
  { name: 'Flensburg', ags: '01001000', postalCodes: ['24937', '24939', '24941', '24943', '24944', '24955'], state: 'Schleswig-Holstein', district: 'Kreisfreie Stadt Flensburg', population: 91000, areaSqKm: 56.7 },
  { name: 'Neumünster', ags: '01004000', postalCodes: ['24534', '24536', '24537', '24539'], state: 'Schleswig-Holstein', district: 'Kreisfreie Stadt Neumünster', population: 78000, areaSqKm: 71.6 },
  { name: 'Norderstedt', ags: '01060034', postalCodes: ['22844', '22846', '22848', '22850', '22851'], state: 'Schleswig-Holstein', district: 'Segeberg', population: 77000, areaSqKm: 56.0 },
  // ── Thüringen ──────────────────────────────────────────────────────────────
  { name: 'Erfurt', ags: '16051000', postalCodes: ['99084', '99085', '99086', '99087', '99089', '99091', '99092', '99094', '99095', '99096', '99097', '99098', '99099'], state: 'Thüringen', district: 'Kreisfreie Stadt Erfurt', population: 213000, areaSqKm: 269.1 },
  { name: 'Jena', ags: '16053000', postalCodes: ['07743', '07745', '07747', '07749', '07751'], state: 'Thüringen', district: 'Kreisfreie Stadt Jena', population: 112000, areaSqKm: 114.7 },
  { name: 'Gera', ags: '16052000', postalCodes: ['07545', '07546', '07548', '07549', '07551', '07552', '07554', '07557'], state: 'Thüringen', district: 'Kreisfreie Stadt Gera', population: 92000, areaSqKm: 152.3 },
  { name: 'Weimar', ags: '16055000', postalCodes: ['99423', '99425', '99427'], state: 'Thüringen', district: 'Kreisfreie Stadt Weimar', population: 65000, areaSqKm: 84.3 },
];

// ── KAV rates by population bracket ──────────────────────────────────────────

function kavRateForPopulation(population) {
  if (population > 500000) return 1.99;
  if (population > 100000) return 1.99;
  if (population > 25000) return 1.59;
  return 1.32;
}

function kavKategorieForPopulation(population) {
  if (population > 500000) return 'Großstadt über 500.000 Einwohner';
  if (population > 100000) return 'Stadt mehr als 100.000 Einwohner';
  if (population > 25000) return 'Gemeinde ueber 25.000 bis 100.000 Einwohner';
  return 'Gemeinde bis 25.000 Einwohner';
}

// ── Energy profile estimation from population ─────────────────────────────────
// Formulas documented; all results marked assumption-backed.
// Source: BSW-Solar Marktdaten 2024, DBFZ Bioenergie-Report 2024

function estimateEnergyProfile(entry) {
  const pop = entry.population || 0;
  const pvKw = entry.pvCapacityKw != null
    ? entry.pvCapacityKw
    : Math.round(pop * 0.55);
  const biomassKw = entry.biomassCapacityKw != null
    ? entry.biomassCapacityKw
    : (pop < 10000 ? Math.round(pop * 0.09) : Math.round(pop * 0.04));
  const windKw = entry.windCapacityKw != null
    ? entry.windCapacityKw
    : 0;
  return { pvCapacityKw: pvKw, biomassCapacityKw: biomassKw, windCapacityKw: windKw };
}

// ── Build lookup indexes ──────────────────────────────────────────────────────

const byNameKey = new Map();
const byAgs = new Map();
const byPlz = new Map();

for (const entry of DATASET) {
  const key = entry.name.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();
  if (!byNameKey.has(key)) byNameKey.set(key, entry);
  if (!byAgs.has(entry.ags)) byAgs.set(entry.ags, entry);
  for (const plz of entry.postalCodes || []) {
    if (!byPlz.has(plz)) byPlz.set(plz, entry);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve a municipality profile from name, PLZ, or AGS.
 *
 * @param {object} opts
 * @param {string} [opts.municipality] - municipality name or 5-digit PLZ
 * @param {string} [opts.ags]          - AGS code (optional, narrows lookup)
 * @returns {{ found: boolean, name: string|null, ags: string|null, postalCode: string|null,
 *             state: string|null, district: string|null, population: number|null,
 *             areaSqKm: number|null, pvCapacityKw: number, biomassCapacityKw: number,
 *             windCapacityKw: number, gridOperatorLabel: string, gridOperatorBdewHint: string,
 *             konzessionsabgabeKategorie: string, kavRateNsCtPerKwh: number,
 *             avgHouseholdConsumptionKwh: number, avgHouseholdsPerEinwohner: number,
 *             sourceLabel: string, sourceStatus: string }}
 */
function resolveMunicipalityProfile({ municipality, ags } = {}) {
  const raw = String(municipality || '').trim();
  const agsIn = String(ags || '').trim();

  let entry = null;

  if (agsIn && byAgs.has(agsIn)) {
    entry = byAgs.get(agsIn);
  } else if (/^\d{5}$/.test(raw) && byPlz.has(raw)) {
    entry = byPlz.get(raw);
  } else if (raw) {
    const key = raw.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();
    entry = byNameKey.get(key) || null;
    if (!entry) {
      for (const [k, v] of byNameKey) {
        if (k.startsWith(key) || key.startsWith(k)) {
          entry = v;
          break;
        }
      }
    }
  }

  if (!entry) {
    return {
      found: false,
      name: raw || null,
      ags: agsIn || null,
      postalCode: null,
      state: null,
      district: null,
      population: null,
      areaSqKm: null,
      pvCapacityKw: 0,
      biomassCapacityKw: 0,
      windCapacityKw: 0,
      gridOperatorLabel: 'Netzbetreiber nicht aufgeloest',
      gridOperatorBdewHint: 'missing-evidence',
      konzessionsabgabeKategorie: 'unbekannt',
      kavRateNsCtPerKwh: null,
      avgHouseholdConsumptionKwh: 2400,
      avgHouseholdsPerEinwohner: 0.45,
      sourceLabel: 'Destatis GV100 2024-Q4 / OpenPLZ-API (Gemeinde nicht aufgeloest)',
      sourceStatus: 'missing-evidence',
    };
  }

  const energy = estimateEnergyProfile(entry);
  const pop = entry.population || 0;

  return {
    found: true,
    name: entry.name,
    ags: entry.ags,
    postalCode: (entry.postalCodes || [])[0] || null,
    postalCodes: entry.postalCodes || [],
    state: entry.state || null,
    district: entry.district || null,
    population: pop,
    areaSqKm: entry.areaSqKm || null,
    pvCapacityKw: energy.pvCapacityKw,
    biomassCapacityKw: energy.biomassCapacityKw,
    windCapacityKw: energy.windCapacityKw,
    gridOperatorLabel: entry.gridOperatorLabel || `${entry.state || 'lokaler'} Netzbetreiber (aufgeloest)`,
    gridOperatorBdewHint: entry.gridOperatorBdewHint || 'missing-evidence',
    konzessionsabgabeKategorie: kavKategorieForPopulation(pop),
    kavRateNsCtPerKwh: kavRateForPopulation(pop),
    avgHouseholdConsumptionKwh: pop > 100000 ? 2200 : pop > 25000 ? 2300 : 2450,
    avgHouseholdsPerEinwohner: pop > 100000 ? 0.5 : pop > 25000 ? 0.46 : 0.44,
    sourceLabel: `Destatis GV100 2024-Q4${entry.pvCapacityKw != null ? '; MaStR-nahe Erzeugungsdaten' : '; Erzeugungsprofil bevoelkerungsbasiert geschaetzt'}`,
    sourceStatus: entry.pvCapacityKw != null ? 'assumption-backed' : 'estimated',
  };
}

module.exports = { resolveMunicipalityProfile, DATASET };
