import { supabase, personalnummerZuEmail } from './supabaseClient.js';

(function () {
  const STORAGE_KEY = 'dienstplanung_gehalt_static_v2';
  const APP_VERSION = '1.37 Lohn-Automatik';
  const WEEKDAYS = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];
  const TEMPLATE_TYPES = ['fixed','frv','free'];
  const STATUSES = ['planned','open','assigned','final'];
  const ACTUAL_TYPES = ['fixed','extra_work','frv_open','frv_assigned','free','vacation','sick','split_shift','holiday_work','betriebsversammlung'];
  const LINE_CATEGORIES = [
    'manual','correction','variable_special','tariff_special','christmas_bonus','vacation_money','vacation_bonus','lfz_bonus','reimbursement'
  ];
  const CLOUD_SAVE_DELAY_MS = 900;

  const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

  const TAX_CLASS_PROFILES = {
    '1': { label: 'I', estimatedTaxPercent: 8.0 },
    '2': { label: 'II', estimatedTaxPercent: 6.0 },
    '3': { label: 'III', estimatedTaxPercent: 3.0 },
    '4': { label: 'IV', estimatedTaxPercent: 8.0 },
    '5': { label: 'V', estimatedTaxPercent: 15.0 },
    '6': { label: 'VI', estimatedTaxPercent: 20.0 }
  };

  const HEALTH_INSURANCE_PROFILES = [
    { key: 'custom', label: 'Manuell / andere Krankenkasse', additionalPercent: null },
    { key: 'aok_die_gesundheitskasse_fuer_niedersachsen', label: 'AOK - Die Gesundheitskasse für Niedersachsen', additionalPercent: 2.98 },
    { key: 'aok_die_gesundheitskasse_in_hessen', label: 'AOK - Die Gesundheitskasse in Hessen', additionalPercent: 2.98 },
    { key: 'aok_baden_wuerttemberg', label: 'AOK Baden-Württemberg', additionalPercent: 2.99 },
    { key: 'aok_bayern_die_gesundheitskasse', label: 'AOK Bayern - Die Gesundheitskasse', additionalPercent: 2.69 },
    { key: 'aok_bremen_bremerhaven', label: 'AOK Bremen / Bremerhaven', additionalPercent: 3.29 },
    { key: 'aok_nordost_die_gesundheitskasse', label: 'AOK Nordost - Die Gesundheitskasse', additionalPercent: 3.50 },
    { key: 'aok_nordwest_die_gesundheitskasse', label: 'AOK NordWest - Die Gesundheitskasse', additionalPercent: 2.99 },
    { key: 'aok_plus_die_gesundheitskasse_fuer_sachsen_und_thueringen', label: 'AOK PLUS - Die Gesundheitskasse für Sachsen und Thüringen', additionalPercent: 3.10 },
    { key: 'aok_rheinland_hamburg_die_gesundheitskasse', label: 'AOK Rheinland/Hamburg - Die Gesundheitskasse', additionalPercent: 3.29 },
    { key: 'aok_rheinland_pfalz_saarland_die_gesundheitskasse', label: 'AOK Rheinland-Pfalz/Saarland-Die Gesundheitskasse', additionalPercent: 2.47 },
    { key: 'aok_sachsen_anhalt_die_gesundheitskasse', label: 'AOK Sachsen-Anhalt - Die Gesundheitskasse', additionalPercent: 2.89 },
    { key: 'audi_bkk', label: 'Audi BKK', additionalPercent: 2.60 },
    { key: 'bahn_bkk', label: 'BAHN-BKK', additionalPercent: 3.65 },
    { key: 'barmer', label: 'BARMER', additionalPercent: 3.29 },
    { key: 'bergische_krankenkasse', label: 'BERGISCHE KRANKENKASSE', additionalPercent: 3.79 },
    { key: 'bertelsmann_bkk', label: 'Bertelsmann BKK', additionalPercent: 3.20 },
    { key: 'betriebskrankenkasse_der_g_m_pfaff_ag', label: 'Betriebskrankenkasse der G.M. Pfaff AG', additionalPercent: 2.78 },
    { key: 'betriebskrankenkasse_ewe', label: 'Betriebskrankenkasse EWE', additionalPercent: 3.19 },
    { key: 'betriebskrankenkasse_miele', label: 'Betriebskrankenkasse Miele', additionalPercent: 3.20 },
    { key: 'betriebskrankenkasse_mobil', label: 'Betriebskrankenkasse Mobil', additionalPercent: 3.89 },
    { key: 'betriebskrankenkasse_pricewaterhousecoopers', label: 'Betriebskrankenkasse PricewaterhouseCoopers', additionalPercent: 2.80 },
    { key: 'betriebskrankenkasse_technoform', label: 'Betriebskrankenkasse Technoform', additionalPercent: 3.49 },
    { key: 'big_direkt_gesund', label: 'BIG direkt gesund', additionalPercent: 3.69 },
    { key: 'bkk_akzo_nobel_bayern', label: 'BKK Akzo Nobel Bayern', additionalPercent: 3.39 },
    { key: 'bkk_b_braun_aesculap', label: 'BKK B. Braun Aesculap', additionalPercent: 3.65 },
    { key: 'bkk_deutsche_bank_ag', label: 'BKK Deutsche Bank AG', additionalPercent: 3.40 },
    { key: 'bkk_diakonie', label: 'BKK Diakonie', additionalPercent: 3.80 },
    { key: 'bkk_euregio', label: 'BKK EUREGIO', additionalPercent: 3.39 },
    { key: 'bkk_evm', label: 'BKK evm', additionalPercent: 2.50 },
    { key: 'bkk_exklusiv', label: 'BKK exklusiv', additionalPercent: 3.49 },
    { key: 'bkk_faber_castell_partner', label: 'BKK Faber-Castell & Partner', additionalPercent: 2.48 },
    { key: 'bkk_firmus', label: 'BKK firmus', additionalPercent: 2.18 },
    { key: 'bkk_freudenberg', label: 'BKK Freudenberg', additionalPercent: 2.99 },
    { key: 'bkk_gildemeister_seidensticker', label: 'BKK GILDEMEISTER SEIDENSTICKER', additionalPercent: 3.40 },
    { key: 'bkk_groz_beckert', label: 'BKK Groz-Beckert', additionalPercent: 3.40 },
    { key: 'bkk_herkules', label: 'BKK Herkules', additionalPercent: 4.38 },
    { key: 'bkk_linde', label: 'BKK Linde', additionalPercent: 2.99 },
    { key: 'bkk_mahle', label: 'BKK MAHLE', additionalPercent: 4.20 },
    { key: 'bkk_melitta_hmr', label: 'bkk melitta hmr', additionalPercent: 3.90 },
    { key: 'bkk_mkk_meine_krankenkasse', label: 'BKK mkk - meine krankenkasse', additionalPercent: 3.50 },
    { key: 'bkk_mtu', label: 'BKK MTU', additionalPercent: 2.80 },
    { key: 'bkk_pfalz', label: 'BKK Pfalz', additionalPercent: 3.90 },
    { key: 'bkk_provita', label: 'BKK ProVita', additionalPercent: 3.79 },
    { key: 'bkk_public', label: 'BKK Public', additionalPercent: 2.50 },
    { key: 'bkk_rieker_ricosta_weisser', label: 'BKK Rieker.RICOSTA.Weisser', additionalPercent: 4.20 },
    { key: 'bkk_salzgitter', label: 'BKK Salzgitter', additionalPercent: 3.50 },
    { key: 'bkk_scheufelen', label: 'BKK Scheufelen', additionalPercent: 3.99 },
    { key: 'bkk_schwarzwald_baar_heuberg', label: 'BKK Schwarzwald-Baar-Heuberg', additionalPercent: 2.79 },
    { key: 'bkk_vdn', label: 'BKK VDN', additionalPercent: 3.19 },
    { key: 'bkk_verbundplus', label: 'BKK VerbundPlus', additionalPercent: 3.89 },
    { key: 'bkk_werra_meissner', label: 'BKK WERRA-MEISSNER', additionalPercent: 4.35 },
    { key: 'bkk_wirtschaft_und_finanzen', label: 'BKK WIRTSCHAFT UND FINANZEN', additionalPercent: 3.99 },
    { key: 'bkk_duerkoppadler', label: 'BKK_DürkoppAdler', additionalPercent: 3.88 },
    { key: 'bkk24', label: 'BKK24', additionalPercent: 4.39 },
    { key: 'bkk_wuerth', label: 'BKK-Würth', additionalPercent: 3.40 },
    { key: 'bmw_bkk', label: 'BMW BKK', additionalPercent: 3.90 },
    { key: 'bosch_bkk', label: 'Bosch BKK', additionalPercent: 3.18 },
    { key: 'continentale_betriebskrankenkasse', label: 'Continentale Betriebskrankenkasse', additionalPercent: 3.33 },
    { key: 'dak_gesundheit', label: 'DAK-Gesundheit', additionalPercent: 3.20 },
    { key: 'debeka_bkk', label: 'Debeka BKK', additionalPercent: 3.25 },
    { key: 'energie_betriebskrankenkasse', label: 'energie-Betriebskrankenkasse', additionalPercent: 3.98 },
    { key: 'ey_betriebskrankenkasse', label: 'EY Betriebskrankenkasse', additionalPercent: 2.75 },
    { key: 'handelskrankenkasse_hkk', label: 'Handelskrankenkasse (hkk)', additionalPercent: 2.59 },
    { key: 'heimat_krankenkasse', label: 'Heimat Krankenkasse', additionalPercent: 3.90 },
    { key: 'hek_hanseatische_krankenkasse', label: 'HEK - Hanseatische Krankenkasse', additionalPercent: 2.89 },
    { key: 'ikk_die_innovationskasse', label: 'IKK - Die Innovationskasse', additionalPercent: 4.30 },
    { key: 'ikk_classic', label: 'IKK classic', additionalPercent: 3.40 },
    { key: 'ikk_gesund_plus', label: 'IKK gesund plus', additionalPercent: 3.39 },
    { key: 'ikk_suedwest', label: 'IKK Südwest', additionalPercent: 3.87 },
    { key: 'innungskrankenkasse_brandenburg_und_berlin', label: 'INNUNGSKRANKENKASSE BRANDENBURG UND BERLIN', additionalPercent: 4.35 },
    { key: 'karl_mayer_bkk', label: 'KARL MAYER BKK', additionalPercent: 2.99 },
    { key: 'kaufmaennische_krankenkasse_kkh', label: 'Kaufmännische Krankenkasse - KKH', additionalPercent: 3.78 },
    { key: 'knappschaft', label: 'KNAPPSCHAFT', additionalPercent: 4.30 },
    { key: 'koenig_bauer_bkk', label: 'Koenig & Bauer BKK', additionalPercent: 3.18 },
    { key: 'krones_betriebskrankenkasse', label: 'Krones Betriebskrankenkasse', additionalPercent: 2.20 },
    { key: 'mercedes_benz_bkk', label: 'Mercedes-Benz BKK', additionalPercent: 3.20 },
    { key: 'merck_bkk', label: 'Merck BKK', additionalPercent: 3.97 },
    { key: 'mhplus_betriebskrankenkasse', label: 'mhplus Betriebskrankenkasse', additionalPercent: 3.86 },
    { key: 'novitas_bkk', label: 'novitas bkk', additionalPercent: 3.60 },
    { key: 'pronova_bkk', label: 'Pronova BKK', additionalPercent: 3.70 },
    { key: 'r_v_betriebskrankenkasse', label: 'R+V Betriebskrankenkasse', additionalPercent: 3.49 },
    { key: 'salus_bkk', label: 'Salus BKK', additionalPercent: 3.29 },
    { key: 'securvita_bkk', label: 'SECURVITA BKK', additionalPercent: 3.90 },
    { key: 'siemens_betriebskrankenkasse_sbk', label: 'Siemens-Betriebskrankenkasse (SBK)', additionalPercent: 3.80 },
    { key: 'skd_bkk', label: 'SKD BKK', additionalPercent: 2.98 },
    { key: 'sozialversicherung_fuer_landwirtschaft_forsten_und_gartenbau', label: 'Sozialversicherung für Landwirtschaft, Forsten und Gartenbau (SVLFG)', additionalPercent: 0.00 },
    { key: 'suedzucker_bkk', label: 'Südzucker BKK', additionalPercent: 2.90 },
    { key: 'techniker_krankenkasse', label: 'Techniker Krankenkasse', additionalPercent: 2.69 },
    { key: 'tui_bkk', label: 'TUI BKK', additionalPercent: 2.50 },
    { key: 'viactiv_krankenkasse', label: 'VIACTIV Krankenkasse', additionalPercent: 4.19 },
    { key: 'vivida_bkk', label: 'vivida bkk', additionalPercent: 3.79 },
    { key: 'wmf_bkk', label: 'WMF BKK', additionalPercent: 2.85 },
    { key: 'zf_bkk', label: 'ZF BKK', additionalPercent: 3.40 },
  ];

  const TEMPLATE_LABELS = { fixed:'fest', frv:'FRV', free:'frei' };
  const STATUS_LABELS = { planned:'geplant', open:'offen', assigned:'zugeteilt', final:'final' };
  const ACTUAL_LABELS = {
    fixed:'fest', extra_work:'Zusatzdienst / Einspringen', frv_open:'FRV offen', frv_assigned:'FRV zugeteilt', free:'frei',
    vacation:'Urlaub', sick:'krank', split_shift:'geteilter Dienst',
    holiday_work:'Feiertagsdienst', betriebsversammlung:'Betriebsversammlung'
  };
  const LINE_CATEGORY_LABELS = {
    manual:'manuell', correction:'Korrektur', variable_special:'variable Sonderzahlung',
    tariff_special:'tarifliche Sonderzahlung', christmas_bonus:'Weihnachtsgeld',
    vacation_money:'Urlaubsgeld', vacation_bonus:'Urlaubszuschlag',
    lfz_bonus:'LFZ-Zuschlag', reimbursement:'Erstattung'
  };

  const payMatrix = {
    BASE_PAY: cfg(true, true, true, true),
    OVERTIME_30: cfg(true, true, true, true),
    EXTRA_WORK_BASE: cfg(true, true, true, true),
    SATURDAY: cfg(true, true, true, true),
    SUNDAY: cfg(true, false, false, false),
    NIGHT: cfg(true, false, false, false),
    HOLIDAY_100: cfg(true, true, true, false),
    HOLIDAY_35: cfg(true, false, false, false),
    VORFESTTAG: cfg(true, true, true, false),
    FAHRDIENST: cfg(true, true, true, true),
    ATTENDANCE: cfg(true, true, true, true),
    SPLIT_SHIFT: cfg(true, true, true, true),
    VACATION_BONUS: cfg(true, true, true, true),
    VACATION_MONEY: cfg(true, true, true, false),
    LFZ_BONUS: cfg(true, true, true, true),
    BETRIEBSVERSAMMLUNG_HOURS: cfg(true, true, true, true),
    BETRIEBSVERSAMMLUNG_TRAVEL: cfg(false, false, false, false, true),
    VARIABLE_SPECIAL: cfg(true, true, true, true),
    TARIFF_SPECIAL: cfg(true, true, true, true),
    CHRISTMAS_BONUS: cfg(true, true, true, true),
    CORRECTION: cfg(true, true, true, true),
    MANUAL: cfg(true, true, true, true)
  };

  const ELIGIBLE_AVERAGE_CODES = new Set(['SATURDAY','SUNDAY','NIGHT','HOLIDAY_100','HOLIDAY_35','VORFESTTAG']);


  const TVN_BRB_TARIFF_TABLES = {
    '2025-01-01_39': {
      label: 'TV-N BRB ab 01.01.2025 · 39 Std./Woche · offiziell',
      validFrom: '2025-01-01',
      weeklyHours: 39,
      kind: 'official',
      source: 'KAV Brandenburg, TV-N BRB i.d.F. ÄndTV Nr. 9 vom 04.03.2024, Anlagen 2 und 3',
      monthly: {
        15:[6710,6900,7091,7283,7475],14:[6121,6293,6466,6639,6868],13:[5587,5743,5898,6054,6284],12:[5132,5261,5392,5557,5781],11:[4724,4840,4956,5073,5235],10:[4351,4456,4560,4664,4771],
        9:[4014,4107,4200,4296,4389],8:[3730,3814,3898,3983,4068],7:[3482,3557,3632,3708,3783],6:[3228,3296,3362,3429,3496],5:[3022,3082,3142,3202,3286],4:[2895,2946,2997,3053,3121],3:[2832,2880,2930,2979,3029],2:[2679,2722,2766,2810,2854],1:[2519]
      },
      hourly: {
        15:[39.57,40.69,41.82,42.95,44.08],14:[36.10,37.11,38.13,39.15,40.50],13:[32.95,33.87,34.78,35.70,37.06],12:[30.26,31.03,31.80,32.77,34.09],11:[27.86,28.54,29.23,29.92,30.87],10:[25.66,26.28,26.89,27.50,28.14],
        9:[23.67,24.22,24.77,25.33,25.88],8:[22.00,22.49,22.99,23.49,23.99],7:[20.53,20.98,21.42,21.87,22.31],6:[19.04,19.44,19.83,20.22,20.62],5:[17.82,18.18,18.53,18.88,19.38],4:[17.07,17.37,17.67,18.00,18.41],3:[16.70,16.98,17.28,17.57,17.86],2:[15.80,16.05,16.31,16.57,16.83],1:[14.86]
      }
    },
    '2025-01-01_38': {
      label: 'TV-N BRB ab 01.01.2025 · 38 Std./Woche · offiziell',
      validFrom: '2025-01-01',
      weeklyHours: 38,
      kind: 'official',
      source: 'KAV Brandenburg, TV-N BRB i.d.F. ÄndTV Nr. 9 vom 04.03.2024, Anlagen 2a und 3a',
      monthly: {
        15:[6580.96,6767.31,6954.63,7142.94,7331.25],14:[6003.29,6171.98,6341.65,6511.33,6735.92],13:[5479.56,5632.56,5784.58,5937.58,6163.15],12:[5033.31,5159.83,5288.31,5450.13,5669.83],11:[4633.15,4746.92,4860.69,4975.44,5134.33],10:[4267.33,4370.31,4472.31,4574.31,4679.25],
        9:[3936.81,4028.02,4119.23,4213.38,4304.60],8:[3658.27,3740.65,3823.04,3906.40,3989.77],7:[3415.04,3488.60,3562.15,3636.69,3710.25],6:[3165.92,3232.62,3297.35,3363.06,3428.77],5:[2963.88,3022.73,3081.58,3140.42,3222.81],4:[2839.33,2889.35,2939.37,2994.29,3060.98],3:[2777.54,2824.62,2873.65,2921.71,2970.75],2:[2627.48,2669.65,2712.81,2755.96,2799.12],1:[2470.56]
      },
      hourly: {
        15:[39.83,40.96,42.09,43.23,44.37],14:[36.33,37.36,38.38,39.41,40.77],13:[33.16,34.09,35.01,35.94,37.30],12:[30.46,31.23,32.01,32.99,34.32],11:[28.04,28.73,29.42,30.11,31.07],10:[25.83,26.45,27.07,27.69,28.32],
        9:[23.83,24.38,24.93,25.50,26.05],8:[22.14,22.64,23.14,23.64,24.15],7:[20.67,21.11,21.56,22.01,22.46],6:[19.16,19.57,19.96,20.35,20.75],5:[17.94,18.29,18.65,19.01,19.51],4:[17.18,17.49,17.79,18.12,18.53],3:[16.81,17.10,17.39,17.68,17.98],2:[15.90,16.16,16.42,16.68,16.94],1:[14.95]
      }
    },
    '2026-04-01_39': {
      label: 'TV-N BRB ab 01.04.2026 · 39 Std./Woche · Tabelle',
      validFrom: '2026-04-01', weeklyHours: 39, kind: 'official',
      source: 'TV-N Brandenburg Entgelttabelle, gültig ab 01.04.2026 (vom Nutzer bereitgestellt)',
      monthly: {
        15:[6925,7121,7318,7516,7714],14:[6317,6494,6673,6851,7088],13:[5766,5927,6087,6248,6485],12:[5296,5429,5565,5735,5966],11:[4875,4995,5115,5235,5403],10:[4490,4599,4706,4813,4924],
        9:[4142,4238,4334,4433,4529],8:[3849,3936,4023,4110,4198],7:[3593,3671,3748,3827,3904],6:[3331,3401,3470,3539,3608],5:[3119,3181,3243,3304,3391],4:[2988,3040,3093,3151,3221],3:[2923,2972,3024,3074,3126],2:[2765,2809,2855,2900,2945],1:[2600]
      },
      hourly: makeHourlyFromMonthly({
        15:[6925,7121,7318,7516,7714],14:[6317,6494,6673,6851,7088],13:[5766,5927,6087,6248,6485],12:[5296,5429,5565,5735,5966],11:[4875,4995,5115,5235,5403],10:[4490,4599,4706,4813,4924],
        9:[4142,4238,4334,4433,4529],8:[3849,3936,4023,4110,4198],7:[3593,3671,3748,3827,3904],6:[3331,3401,3470,3539,3608],5:[3119,3181,3243,3304,3391],4:[2988,3040,3093,3151,3221],3:[2923,2972,3024,3074,3126],2:[2765,2809,2855,2900,2945],1:[2600]
      }, 39)
    },
    '2026-04-01_39_calc': { aliasTo: '2026-04-01_39', hidden: true },
    '2026-04-01_38_calc': {
      label: 'TV-N BRB ab 01.04.2026 · 38 Std./Woche · Rechenstand +3,2 %',
      validFrom: '2026-04-01', weeklyHours: 38, kind: 'calculated', base: '2025-01-01_38', multiplier: 1.032,
      source: 'Aus 2025-Tabelle rechnerisch fortgeführt, bis eine 38-Stunden-Tabelle vorliegt'
    },
    '2027-04-01_39': {
      label: 'TV-N BRB ab 01.04.2027 · 39 Std./Woche · Tabelle',
      validFrom: '2027-04-01', weeklyHours: 39, kind: 'official',
      source: 'TV-N Brandenburg Entgelttabelle, gültig ab 01.04.2027 (vom Nutzer bereitgestellt; Hinweis: ab 01.01.2028 38,5 Std./Woche)',
      monthly: {
        15:[7098,7299,7501,7704,7907],14:[6475,6656,6840,7022,7265],13:[5910,6075,6239,6404,6647],12:[5428,5565,5704,5878,6115],11:[4997,5120,5243,5366,5538],10:[4602,4714,4824,4933,5047],
        9:[4246,4344,4442,4544,4642],8:[3945,4034,4124,4213,4303],7:[3683,3763,3842,3923,4002],6:[3414,3486,3557,3627,3698],5:[3197,3261,3324,3387,3476],4:[3063,3116,3170,3230,3302],3:[2996,3046,3100,3151,3204],2:[2834,2879,2926,2973,3019],1:[2665]
      },
      hourly: makeHourlyFromMonthly({
        15:[7098,7299,7501,7704,7907],14:[6475,6656,6840,7022,7265],13:[5910,6075,6239,6404,6647],12:[5428,5565,5704,5878,6115],11:[4997,5120,5243,5366,5538],10:[4602,4714,4824,4933,5047],
        9:[4246,4344,4442,4544,4642],8:[3945,4034,4124,4213,4303],7:[3683,3763,3842,3923,4002],6:[3414,3486,3557,3627,3698],5:[3197,3261,3324,3387,3476],4:[3063,3116,3170,3230,3302],3:[2996,3046,3100,3151,3204],2:[2834,2879,2926,2973,3019],1:[2665]
      }, 39)
    },
    '2028-01-01_38_5': {
      label: 'TV-N BRB ab 01.01.2028 · 38,5 Std./Woche · voller Lohnausgleich',
      validFrom: '2028-01-01', weeklyHours: 38.5, kind: 'official',
      source: 'TV-N Brandenburg: ab 01.01.2028 38,5 Std./Woche bei vollem Lohnausgleich; Monatsentgelte bleiben aus Tabelle ab 01.04.2027, Stundenwerte werden mit 38,5 Std./Woche berechnet.',
      monthly: {
        15:[7098,7299,7501,7704,7907],14:[6475,6656,6840,7022,7265],13:[5910,6075,6239,6404,6647],12:[5428,5565,5704,5878,6115],11:[4997,5120,5243,5366,5538],10:[4602,4714,4824,4933,5047],
        9:[4246,4344,4442,4544,4642],8:[3945,4034,4124,4213,4303],7:[3683,3763,3842,3923,4002],6:[3414,3486,3557,3627,3698],5:[3197,3261,3324,3387,3476],4:[3063,3116,3170,3230,3302],3:[2996,3046,3100,3151,3204],2:[2834,2879,2926,2973,3019],1:[2665]
      },
      hourly: makeHourlyFromMonthly({
        15:[7098,7299,7501,7704,7907],14:[6475,6656,6840,7022,7265],13:[5910,6075,6239,6404,6647],12:[5428,5565,5704,5878,6115],11:[4997,5120,5243,5366,5538],10:[4602,4714,4824,4933,5047],
        9:[4246,4344,4442,4544,4642],8:[3945,4034,4124,4213,4303],7:[3683,3763,3842,3923,4002],6:[3414,3486,3557,3627,3698],5:[3197,3261,3324,3387,3476],4:[3063,3116,3170,3230,3302],3:[2996,3046,3100,3151,3204],2:[2834,2879,2926,2973,3019],1:[2665]
      }, 38.5)
    },
    '2027-04-01_39_calc': { aliasTo: '2027-04-01_39', hidden: true },
    '2027-04-01_38_calc': {
      label: 'TV-N BRB ab 01.04.2027 · 38 Std./Woche · Rechenstand +2,5 %',
      validFrom: '2027-04-01', weeklyHours: 38, kind: 'calculated', base: '2025-01-01_38', multiplier: 1.032 * 1.025,
      source: 'Aus 2025-Tabelle rechnerisch fortgeführt, bis eine 38-Stunden-Tabelle vorliegt'
    }
  };

  function roundTariffMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function makeHourlyFromMonthly(monthlyRows, weeklyHours = 39) {
    const divisor = Number(weeklyHours || 39) * 52.1785714286 / 12;
    return Object.fromEntries(Object.entries(monthlyRows).map(([group, values]) => [group, values.map(v => roundTariffMoney(Number(v || 0) / divisor))]));
  }

  function groupNumber(value) {
    const match = String(value ?? '').match(/\d+/);
    return match ? Number(match[0]) : 5;
  }

  function normalizeTariffTableKey(key) {
    const table = TVN_BRB_TARIFF_TABLES[key];
    return table?.aliasTo || key;
  }

  function getTariffTable(key) {
    const normalizedKey = normalizeTariffTableKey(key || '2025-01-01_39');
    const table = TVN_BRB_TARIFF_TABLES[normalizedKey] || TVN_BRB_TARIFF_TABLES['2025-01-01_39'];
    if (!table.base) return table;
    const base = getTariffTable(table.base);
    const convertRows = (rows) => Object.fromEntries(Object.entries(rows).map(([group, values]) => [group, values.map(v => roundTariffMoney(v * table.multiplier))]));
    return { ...table, monthly: convertRows(base.monthly), hourly: convertRows(base.hourly) };
  }

  function tariffTableOptionKeys() {
    return Object.keys(TVN_BRB_TARIFF_TABLES).filter((key) => {
      const table = TVN_BRB_TARIFF_TABLES[key];
      return table && !table.aliasTo && !table.hidden;
    });
  }

  function getTariffSelection() {
    const key = document.getElementById('setTariffTable')?.value || state.settings.tariffTableKey || '2025-01-01_39';
    const group = groupNumber(document.getElementById('setGroup')?.value || state.settings.entgeltgruppe || 'EG 5');
    const step = Number(document.getElementById('setStep')?.value || state.settings.stufe || 1);
    const table = getTariffTable(key);
    const monthlyRow = table.monthly[group];
    const hourlyRow = table.hourly[group];
    if (!monthlyRow || !hourlyRow || step < 1 || step > monthlyRow.length) {
      return { key, table, group, step, monthly: null, hourly: null };
    }
    return { key, table, group, step, monthly: monthlyRow[step - 1], hourly: hourlyRow[step - 1] };
  }

  function getTariffGroupAndStep() {
    const group = groupNumber(document.getElementById('setGroup')?.value || state.settings.entgeltgruppe || 'EG 5');
    const step = Number(document.getElementById('setStep')?.value || state.settings.stufe || 1);
    return { group, step };
  }

  function tariffMonthStart(monthOrDate) {
    const raw = String(monthOrDate || currentMonth());
    if (/^\d{4}-\d{2}$/.test(raw)) return raw + '-01';
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    return currentMonth() + '-01';
  }

  function selectedTariffWeeklyHours() {
    const table = getTariffTable(state.settings.tariffTableKey || '2025-01-01_39');
    return Number(table.weeklyHours || state.settings.weeklyHoursContract || 39);
  }

  function findEffectiveTariffTableKey(monthOrDate) {
    const target = tariffMonthStart(monthOrDate);
    const weeklyHours = selectedTariffWeeklyHours();
    const isWeeklyHoursCompatible = (tableHours) => {
      const selected = Number(weeklyHours);
      const candidate = Number(tableHours);
      if (candidate === selected) return true;
      // TV-N BRB: ab 01.01.2028 sinkt die 39-Stunden-Woche auf 38,5 Stunden
      // bei vollem Lohnausgleich. Nutzer, die bisher die 39-Stunden-Tabelle gewählt
      // haben, sollen ab diesem Stichtag automatisch in die 38,5-Stunden-Basis laufen.
      if (target >= '2028-01-01' && selected === 39 && candidate === 38.5) return true;
      return false;
    };
    const keys = tariffTableOptionKeys()
      .filter((key) => {
        const table = getTariffTable(key);
        return isWeeklyHoursCompatible(table.weeklyHours) && table.validFrom && table.validFrom <= target;
      })
      .sort((a, b) => String(getTariffTable(b).validFrom).localeCompare(String(getTariffTable(a).validFrom)));
    return keys[0] || normalizeTariffTableKey(state.settings.tariffTableKey || '2025-01-01_39');
  }

  function getEffectiveTariffForMonth(monthOrDate) {
    const key = findEffectiveTariffTableKey(monthOrDate);
    const table = getTariffTable(key);
    const group = groupNumber(state.settings.entgeltgruppe || 'EG 5');
    const step = Number(state.settings.stufe || 1);
    const monthlyRow = table.monthly?.[group];
    const hourlyRow = table.hourly?.[group];
    if (monthlyRow && hourlyRow && step >= 1 && step <= monthlyRow.length) {
      const baseStepIndex = Math.min(Math.max(step, 1), hourlyRow.length) - 1;
      // TV-N Brandenburg: Zeitzuschläge werden seit 07/2022 mindestens auf Basis des
      // jeweiligen Stundenentgelts der 2. Stufe berechnet. Das Monatsentgelt bleibt
      // trotzdem bei der tatsächlich gewählten Stufe, z. B. EG 5 Stufe 1.
      const bonusStep = Math.min(Math.max(step, 2), hourlyRow.length);
      const bonusStepIndex = bonusStep - 1;
      const hourly = Number(hourlyRow[baseStepIndex]);
      const bonusHourly = Number(hourlyRow[bonusStepIndex]);
      return {
        key,
        table,
        group,
        step,
        bonusStep,
        fixedMonthlyBasePay: Number(monthlyRow[step - 1]),
        baseHourRate: hourly,
        bonusHourRate: bonusHourly,
        source: table.source || table.label || key
      };
    }
    return {
      key: 'manual',
      table: null,
      group,
      step,
      bonusStep: Math.max(step, 2),
      fixedMonthlyBasePay: Number(state.settings.fixedMonthlyBasePay || 3022),
      baseHourRate: Number(state.settings.baseHourRate || 17.82),
      bonusHourRate: Number(state.settings.bonusHourRate || state.settings.baseHourRate || 17.82),
      source: 'Manuelle Werte aus den Einstellungen'
    };
  }

  function getEffectiveTariffForDate(date) {
    return getEffectiveTariffForMonth(dateToMonth(date || currentDate()));
  }

  function updateTariffPreview() {
    const box = document.getElementById('tariffPreview');
    if (!box) return;
    const sel = getTariffSelection();
    if (sel.monthly == null || sel.hourly == null) {
      box.innerHTML = `<strong>Keine Tabellenwerte gefunden.</strong><br>Für EG ${sel.group}, Stufe ${sel.step} ist in dieser Tabelle kein Wert hinterlegt. Hinweis: EG 1 ist in der offiziellen Tabelle nur mit einem Wert ausgewiesen.`;
      return;
    }
    const calc = sel.table.kind === 'calculated' ? ' <span class="badge warning">Rechenstand</span>' : ' <span class="badge ok">Tabelle</span>';
    const effectiveNow = getEffectiveTariffForMonth(currentMonth());
    const bonusStep = Math.min(Math.max(sel.step, 2), sel.table.hourly?.[sel.group]?.length || sel.step);
    const bonusHourly = Number(sel.table.hourly?.[sel.group]?.[bonusStep - 1] ?? sel.hourly);
    box.innerHTML = `<strong>TV-N BRB Tabellenwert:</strong> EG ${sel.group}, Stufe ${sel.step} · ${sel.table.weeklyHours} Std./Woche${calc}<br>Monatsentgelt Auswahl: <strong>${euro(sel.monthly)}</strong> · Stundenentgelt Stufe ${sel.step}: <strong>${euro(sel.hourly)}</strong><br>Zuschlagsbasis automatisch: <strong>EG ${sel.group} Stufe ${bonusStep} · ${euro(bonusHourly)}</strong><br><span class="muted">${escapeHtml(sel.table.source)}</span><br><span class="muted"><strong>Automatik aktiv:</strong> Die Lohnberechnung nimmt für jeden Abrechnungsmonat automatisch die zu diesem Datum gültige Tabelle. Aktuell wirksam: ${escapeHtml(effectiveNow.table?.label || effectiveNow.source)} · Monatsentgelt ${euro(effectiveNow.fixedMonthlyBasePay)} · Zuschlagsbasis EG ${effectiveNow.group} Stufe ${effectiveNow.bonusStep} ${euro(effectiveNow.bonusHourRate)}.</span><br><span class="muted">Geplante Stichtage: 01.04.2026 neue Tabelle · 01.04.2027 neue Tabelle · 01.01.2028 38,5 Std./Woche bei vollem Lohnausgleich. Vergangene Monate bleiben beim damaligen Tabellenstand.</span>`;
  }

  function applyTariffSelectionToSettings() {
    if (!canEditSettings()) return showRoleDenied('Tarifwerte übernehmen');
    const sel = getTariffSelection();
    if (sel.monthly == null || sel.hourly == null) return alert('Für diese Entgeltgruppe/Stufe ist kein Tabellenwert hinterlegt.');
    state.settings.tariffName = 'TV-N Brandenburg';
    state.settings.tariffTableKey = sel.key;
    state.settings.entgeltgruppe = 'EG ' + sel.group;
    state.settings.stufe = sel.step;
    state.settings.weeklyHoursContract = sel.table.weeklyHours;
    state.settings.fixedMonthlyBasePay = sel.monthly;
    state.settings.baseHourRate = sel.hourly;
    const bonusStep = Math.min(Math.max(sel.step, 2), sel.table.hourly?.[sel.group]?.length || sel.step);
    state.settings.bonusHourRate = Number(sel.table.hourly?.[sel.group]?.[bonusStep - 1] ?? sel.hourly);
    renderSettings();
    saveState();
    refreshPayrollViews();
    setSyncStatus('TV-N BRB Automatik aktiviert: EG/Stufe gespeichert, gültige Tabelle wird je Monat automatisch gewählt.', 'ok');
  }

  function cfg(gesamt, steuer, sv, zv, reimbursement=false) {
    return { gesamt, steuer, sv, zv, reimbursement };
  }

  function defaultState() {
    return {
      settings: {
        tariffName: 'TV-N Brandenburg',
        tariffTableKey: '2025-01-01_39',
        entgeltgruppe: 'EG 5',
        stufe: 1,
        weeklyHoursContract: 39,
        weeklyHoursCycleAvg: '40:05',
        fixedMonthlyBasePay: 3022,
        baseHourRate: 17.82,
        bonusHourRate: 17.82,
        isFahrdienst: true,
        isShiftWork: false,
        frvPlaceholderMinutes: 468,
        kvbbgUmlagePercent: 0.55,
        kvbbgZusatzPercent: 2.40,
        taxClass: '1',
        estimatedTaxPercent: 8.0,
        healthInsurance: 'custom',
        healthAdditionalPercent: 1.70,
        estimatedHealthPercent: 8.15,
        estimatedPensionPercent: 9.30,
        estimatedUnemploymentPercent: 1.30,
        estimatedCarePercent: 2.40,
        estimatedChurchPercent: 0,
        estimatedSoliPercent: 0,
        preferActualDeductions: true,
        calendarName: 'Arbeit',
        reminderMinutes: 30,
        currentRotationWeek: 1,
        currentRotationAnchorDate: currentDate()
      },
      rotationWeeks: createDefaultRotationWeeks(),
      rotationTypes: [
        { id: 'standard', name: 'Standard-Umlauf', weeks: createDefaultRotationWeeks() }
      ],
      dayEntries: {},
      employees: [],
      employeeDayEntries: {},
      dailyAssignments: {},
      statements: {},
      statementLines: []
    };
  }


  function createDefaultRotationWeeks() {
    return Array.from({ length: 40 }, (_, i) => ({
      weekNumber: i + 1,
      days: WEEKDAYS.map((name, idx) => ({
        weekdayName: name,
        weekdayIndex: idx,
        templateType: idx < 5 ? 'fixed' : 'free',
        defaultStartTime: idx < 5 ? '05:00' : '',
        defaultEndTime: idx < 5 ? '13:18' : '',
        defaultBreakMinutes: idx < 5 ? 30 : 0,
        defaultPaidMinutes: idx < 5 ? 468 : 0,
        defaultPaidMode: 'auto',
        serviceNumber: '',
        notes: ''
      }))
    }));
  }

  function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function makeId(prefix = 'umlauf') {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function sanitizeRotationWeeks(weeks) {
    const base = createDefaultRotationWeeks();
    const incoming = Array.isArray(weeks) ? weeks : [];
    return base.map((baseWeek, weekIdx) => {
      const srcWeek = incoming[weekIdx] || {};
      const srcDays = Array.isArray(srcWeek.days) ? srcWeek.days : [];
      return {
        ...baseWeek,
        ...srcWeek,
        weekNumber: weekIdx + 1,
        days: baseWeek.days.map((baseDay, dayIdx) => ({
          ...baseDay,
          ...(srcDays[dayIdx] || {}),
          weekdayName: WEEKDAYS[dayIdx],
          weekdayIndex: dayIdx
        }))
      };
    });
  }

  function getActiveRotationWeeksFrom(value) {
    const type = (value.rotationTypes || []).find(x => x.id === value.settings?.activeRotationTypeId) || (value.rotationTypes || [])[0];
    return sanitizeRotationWeeks(type?.weeks);
  }

  function rotationWeeksSignature(weeks) {
    return JSON.stringify(sanitizeRotationWeeks(weeks));
  }

  function hasCustomRotationWeeks(weeks) {
    return rotationWeeksSignature(weeks) !== rotationWeeksSignature(createDefaultRotationWeeks());
  }

  function rotationTypesAreOnlyDefault(rotationTypes) {
    if (!Array.isArray(rotationTypes) || rotationTypes.length !== 1) return false;
    const only = rotationTypes[0] || {};
    return String(only.id || 'standard') === 'standard' && !hasCustomRotationWeeks(only.weeks);
  }

  function normalizeStateObject(value) {
    const incoming = value && typeof value === 'object' ? value : {};
    const normalized = stripRemovedFeatures(deepMerge(defaultState(), incoming));
    normalized.settings = normalized.settings && typeof normalized.settings === 'object' ? normalized.settings : {};
    normalized.settings.tariffTableKey = normalizeTariffTableKey(normalized.settings.tariffTableKey || '2025-01-01_39');

    // Reparatur 1.17 -> 1.18:
    // Wenn der alte 40-Wochen-Umlauf noch in rotationWeeks steckt, aber durch die neue
    // Umlaufarten-Struktur nur ein leerer Standard-Umlauf sichtbar wäre, wird der alte
    // Umlauf automatisch als Standard-Umlauf wiederhergestellt.
    const legacyWeeks = sanitizeRotationWeeks(incoming.rotationWeeks || normalized.rotationWeeks);
    const incomingHadRotationTypes = Array.isArray(incoming.rotationTypes) && incoming.rotationTypes.length > 0;
    const onlyDefaultRotationType = rotationTypesAreOnlyDefault(normalized.rotationTypes);
    if (!incomingHadRotationTypes || (hasCustomRotationWeeks(legacyWeeks) && onlyDefaultRotationType)) {
      normalized.rotationTypes = [{ id: 'standard', name: 'Standard-Umlauf', weeks: legacyWeeks }];
      normalized.settings.activeRotationTypeId = 'standard';
    }

    if (!Array.isArray(normalized.rotationTypes) || !normalized.rotationTypes.length) {
      normalized.rotationTypes = [{ id: 'standard', name: 'Standard-Umlauf', weeks: legacyWeeks }];
      normalized.settings.activeRotationTypeId = 'standard';
    }

    normalized.rotationTypes = normalized.rotationTypes.map((type, idx) => ({
      id: type?.id || (idx === 0 ? 'standard' : makeId('umlauf')),
      name: String(type?.name || (idx === 0 ? 'Standard-Umlauf' : `Umlaufart ${idx + 1}`)).trim(),
      weeks: sanitizeRotationWeeks(type?.weeks || (idx === 0 ? legacyWeeks : null))
    }));
    if (!normalized.rotationTypes.some(type => type.id === normalized.settings.activeRotationTypeId)) {
      normalized.settings.activeRotationTypeId = normalized.rotationTypes[0].id;
    }
    normalized.rotationWeeks = getActiveRotationWeeksFrom(normalized);
    normalized.employees = Array.isArray(normalized.employees) ? normalized.employees : [];
    normalized.employeeDayEntries = normalized.employeeDayEntries && typeof normalized.employeeDayEntries === 'object' ? normalized.employeeDayEntries : {};
    normalized.dailyAssignments = normalized.dailyAssignments && typeof normalized.dailyAssignments === 'object' ? normalized.dailyAssignments : {};
    normalizeFrvAssignmentsInMap(normalized.dayEntries);
    Object.values(normalized.employeeDayEntries || {}).forEach((employeeMap) => normalizeFrvAssignmentsInMap(employeeMap));
    return normalized;
  }
  function getActiveRotationType() {
    const type = (state.rotationTypes || []).find(x => x.id === state.settings.activeRotationTypeId) || (state.rotationTypes || [])[0];
    return type || { id: 'standard', name: 'Standard-Umlauf', weeks: createDefaultRotationWeeks() };
  }

  function getActiveRotationWeeks() {
    const type = getActiveRotationType();
    type.weeks = sanitizeRotationWeeks(type.weeks);
    state.rotationWeeks = type.weeks;
    return type.weeks;
  }

  function activeRotationTypeName() {
    return getActiveRotationType().name || 'Standard-Umlauf';
  }

  let state = loadState();
  let cloudSession = null;
  let cloudProfile = null;
  let cloudSaveTimer = null;
  let isCloudLoading = false;
  let lastCloudSavedAt = null;


  const ROLE_CONFIG = {
    admin: {
      label: 'Admin',
      tabs: ['overview','rotation','daily','days','payroll','statements','year','settings'],
      canEditRotation: true,
      canEditDays: true,
      canEditPayroll: true,
      canEditSettings: true,
      canBackup: true,
      canPersist: true
    },
    payroll: {
      label: 'Gehaltsabteilung',
      tabs: ['payroll','statements','year'],
      canEditRotation: false,
      canEditDays: false,
      canEditPayroll: true,
      canEditSettings: false,
      canBackup: false,
      canPersist: true
    },
    dispatch: {
      label: 'Dienstzuteilung / Einsatzleitung',
      tabs: ['rotation','daily','days'],
      canEditRotation: true,
      canEditDays: true,
      canEditPayroll: false,
      canEditSettings: false,
      canBackup: false,
      canPersist: true
    },
    driver: {
      label: 'Fahrer',
      tabs: ['days'],
      canEditRotation: false,
      canEditDays: false,
      canEditPayroll: false,
      canEditSettings: false,
      canBackup: false,
      canPersist: false
    },
    viewer: {
      label: 'Nur Lesen',
      tabs: ['days'],
      canEditRotation: false,
      canEditDays: false,
      canEditPayroll: false,
      canEditSettings: false,
      canBackup: false,
      canPersist: false
    }
  };

  function currentRole() {
    const raw = String(cloudProfile?.role || 'driver').trim().toLowerCase();
    if (raw === 'dienstzuteilung' || raw === 'einsatzleitung') return 'dispatch';
    if (raw === 'gehalt' || raw === 'lohn' || raw === 'gehaltsabteilung' || raw === 'entgeltabrechnung' || raw === 'payroll') return 'payroll';
    if (raw === 'fahrer' || raw === 'employee' || raw === 'user') return 'driver';
    return ROLE_CONFIG[raw] ? raw : 'driver';
  }

  function roleConfig() { return ROLE_CONFIG[currentRole()] || ROLE_CONFIG.driver; }
  function roleLabel() { return roleConfig().label; }
  function canViewTab(tab) { return roleConfig().tabs.includes(tab); }
  function defaultTabForRole() { return roleConfig().tabs[0] || 'days'; }
  function canEditRotation() { return !!roleConfig().canEditRotation; }
  function canEditDays() { return !!roleConfig().canEditDays; }
  function canEditPayroll() { return !!roleConfig().canEditPayroll; }
  function canEditSettings() { return !!roleConfig().canEditSettings; }
  function canBackupData() { return !!roleConfig().canBackup; }
  function canPersistData() { return !!roleConfig().canPersist; }

  function applyRoleAccess() {
    const cfg = roleConfig();
    const role = currentRole();
    document.body.dataset.role = role;

    document.querySelectorAll('.nav-btn').forEach((btn) => {
      const tab = btn.dataset.tab;
      const allowed = !!tab && cfg.tabs.includes(tab);
      btn.classList.toggle('role-hidden', !allowed);
      btn.disabled = !allowed;
    });

    document.querySelectorAll('.role-edit-days').forEach((el) => {
      el.hidden = !canEditDays();
    });

    const driverInfo = document.getElementById('driverDayInfo');
    if (driverInfo) driverInfo.hidden = canEditDays();

    const help = document.getElementById('daysCalendarHelp');
    if (help) {
      help.textContent = canEditDays()
        ? 'Klicke auf einen Tag, um direkt die Eingabemaske zu öffnen. Gesetzliche Feiertage in Brandenburg werden sofort angezeigt und automatisch als Feiertag markiert.'
        : 'Fahreransicht: Du siehst deinen Monatskalender und kannst die Kalenderdatei für iPhone, Android oder andere Kalenderprogramme herunterladen. Bearbeitung ist nicht möglich.';
    }

    const exportBtn = document.getElementById('exportDaysMonthIcsBtn');
    if (exportBtn) exportBtn.textContent = canEditDays() ? 'Monat als ICS exportieren' : 'Kalenderdatei für iPhone/Android laden';

    const saveNowBtn = document.getElementById('cloudSaveNowBtn');
    if (saveNowBtn) saveNowBtn.hidden = !canPersistData();

    ['exportBtn','importFile','loadDemoBtn','resetBtn'].forEach((id) => {
      const el = document.getElementById(id);
      const wrap = el?.closest('label') || el;
      if (wrap) wrap.hidden = !canBackupData();
    });

    const activePanel = document.querySelector('.tab-panel.active');
    const activeTab = activePanel?.id?.replace('tab-', '');
    if (!activeTab || !canViewTab(activeTab)) {
      switchTab(defaultTabForRole());
    }
  }

  function showRoleDenied(label = 'Diese Funktion') {
    alert(label + ' ist für deine Rolle nicht freigegeben.');
  }


  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return normalizeStateObject(defaultState());
      return normalizeStateObject(stripRemovedFeatures(JSON.parse(raw))); 
    } catch (e) {
      console.error(e);
      return normalizeStateObject(defaultState());
    }
  }

  function stripRemovedFeatures(value) {
    if (!value || typeof value !== 'object') return value;
    delete value.commuteMonths;
    delete value.expenses;
    if (value.settings && typeof value.settings === 'object') {
      delete value.settings.homeAddress;
      delete value.settings.depotAddress;
      delete value.settings.distanceKmOneWay;
    }
    return value;
  }

  
  function renderAppVersion() {
    const el = document.getElementById('appVersionBadge');
    if (el) el.textContent = APP_VERSION;
    const loginEl = document.getElementById('loginVersionBadge');
    if (loginEl) loginEl.textContent = APP_VERSION;
  }

  function setLoginMessage(text, tone = '') {
    const el = document.getElementById('loginAuthMessage');
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('ok', 'warning', 'danger');
    if (tone) el.classList.add(tone);
  }

  function lockApp(message = 'Bitte einloggen, um deine Daten zu laden.', tone = 'warning') {
    const shell = document.getElementById('appShell');
    const login = document.getElementById('loginScreen');
    document.body.classList.add('auth-locked');
    if (shell) shell.hidden = true;
    if (login) login.hidden = false;
    setLoginMessage(message, tone);
  }

  function unlockApp() {
    const shell = document.getElementById('appShell');
    const login = document.getElementById('loginScreen');
    document.body.classList.remove('auth-locked');
    if (login) login.hidden = true;
    if (shell) shell.hidden = false;
  }

function saveState(options = {}) {
    if (hasCloudLogin() && !canPersistData()) {
      setSyncStatus('Nur Lesemodus · keine Änderungen gespeichert', 'ok');
      return;
    }
    state = normalizeStateObject(stripRemovedFeatures(state));
    const time = new Date().toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'});
    if (hasCloudLogin()) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSyncStatus('Lokal zwischengespeichert · Cloud wartet · ' + time, 'warning');
    } else {
      setSyncStatus('Nicht angemeldet · keine Daten sichtbar', 'warning');
    }
    if (!options.skipCloud) scheduleCloudSave();
  }

  function setSyncStatus(text, tone = '') {
    const el = document.getElementById('syncState');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('ok', 'warning', 'danger');
    if (tone) el.classList.add(tone);
  }

  function hasCloudLogin() {
    return !!cloudSession?.user && !!cloudProfile?.active;
  }

  async function initCloud() {
    renderAppVersion();
    lockApp('Cloud-Verbindung wird geprüft …', 'warning');
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      cloudSession = data.session || null;
      if (cloudSession) {
        await loadCloudProfile();
        await syncCloudAfterLogin(false);
      } else {
        cloudProfile = null;
        lockApp('Bitte mit Personalnummer und Passwort einloggen.', 'warning');
      }
    } catch (error) {
      console.error(error);
      cloudSession = null;
      cloudProfile = null;
      lockApp('Cloud-Verbindung fehlgeschlagen. Login später erneut versuchen.', 'danger');
    }
  }

  async function loadCloudProfile() {
    cloudProfile = null;
    if (!cloudSession?.user) return null;
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, personalnummer, display_name, role, active')
      .eq('id', cloudSession.user.id)
      .maybeSingle();
    if (error) throw error;
    cloudProfile = data || null;
    if (!cloudProfile?.active) {
      await supabase.auth.signOut();
      cloudSession = null;
      cloudProfile = null;
      throw new Error('Benutzer ist nicht aktiv oder hat kein Profil.');
    }
    return cloudProfile;
  }

  function renderCloudAuth() {
    const panel = document.getElementById('cloudAuthPanel');
    if (!panel) return;

    if (!cloudSession || !cloudProfile) {
      panel.innerHTML = `
        <div class="cloud-user-box">
          <span class="badge warning">Nicht angemeldet</span>
        </div>
        <div id="cloudAuthMessage" class="cloud-auth-message"></div>
      `;
      return;
    }

    const roleName = roleLabel();
    const name = cloudProfile.display_name || cloudProfile.personalnummer || 'Benutzer';
    panel.innerHTML = `
      <div class="cloud-user-box">
        <span class="badge ok">Cloud: ${escapeHtml(name)} · ${escapeHtml(roleName)}</span>
        <button type="button" id="cloudSaveNowBtn" class="secondary">Jetzt speichern</button>
        <button type="button" id="cloudRefreshBtn" class="secondary">Aktualisieren</button>
        <button type="button" id="cloudLogoutBtn" class="secondary">Abmelden</button>
      </div>
      <div id="cloudAuthMessage" class="cloud-auth-message"></div>
    `;
  }

  async function handleCloudLogin(e) {
    e.preventDefault();
    const personalnummer = document.getElementById('loginPersonalnummer')?.value
      || document.getElementById('cloudPersonalnummer')?.value
      || '';
    const password = document.getElementById('loginPassword')?.value
      || document.getElementById('cloudPassword')?.value
      || '';
    const message = document.getElementById('cloudAuthMessage');

    try {
      if (message) message.textContent = 'Anmeldung läuft …';
      setLoginMessage('Anmeldung läuft …', 'warning');
      setSyncStatus('Cloud-Anmeldung läuft …', 'warning');
      const { data, error } = await supabase.auth.signInWithPassword({
        email: personalnummerZuEmail(personalnummer),
        password
      });
      if (error) throw error;
      cloudSession = data.session;
      await loadCloudProfile();
      await syncCloudAfterLogin(true);
    } catch (error) {
      console.error(error);
      if (message) message.textContent = 'Anmeldung fehlgeschlagen. Personalnummer oder Passwort prüfen.';
      setLoginMessage('Anmeldung fehlgeschlagen. Personalnummer oder Passwort prüfen.', 'danger');
      setSyncStatus('Cloud-Anmeldung fehlgeschlagen', 'danger');
    }
  }

  async function handleCloudLogout() {
    await supabase.auth.signOut();
    cloudSession = null;
    cloudProfile = null;
    if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    lockApp('Abgemeldet. Die lokalen Zwischendaten wurden von diesem Gerät entfernt.', 'ok');
  }

  async function cloudLaden() {
    if (!cloudSession?.user) return null;
    const { data, error } = await supabase
      .from('app_state')
      .select('data, updated_at')
      .eq('user_id', cloudSession.user.id)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function cloudSpeichern() {
    if (!hasCloudLogin() || !canPersistData()) return;
    state = normalizeStateObject(stripRemovedFeatures(state));
    const { error } = await supabase
      .from('app_state')
      .upsert({
        user_id: cloudSession.user.id,
        data: state,
        updated_at: new Date().toISOString()
      });
    if (error) throw error;
    lastCloudSavedAt = new Date();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setSyncStatus('Online gespeichert · ' + lastCloudSavedAt.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'}), 'ok');
    renderCloudStatusDetails();
  }

  function scheduleCloudSave() {
    if (!hasCloudLogin() || isCloudLoading) return;
    if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => {
      cloudSpeichern().catch((error) => {
        console.error(error);
        setSyncStatus('Online-Speicherung fehlgeschlagen · lokal gespeichert', 'danger');
      });
    }, CLOUD_SAVE_DELAY_MS);
  }

  async function syncCloudAfterLogin(isManualLogin) {
    if (!hasCloudLogin()) return;
    isCloudLoading = true;
    try {
      setSyncStatus('Cloud wird geladen …', 'warning');
      const cloudRecord = await cloudLaden();
      if (cloudRecord?.data && Object.keys(cloudRecord.data).length) {
        state = normalizeStateObject(stripRemovedFeatures(cloudRecord.data));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        const when = cloudRecord.updated_at
          ? new Date(cloudRecord.updated_at).toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'})
          : 'gerade';
        unlockApp();
        renderAll();
        setSyncStatus('Cloud geladen · ' + when, 'ok');
      } else {
        state = loadState();
        unlockApp();
        renderAll();
        await cloudSpeichern();
        setSyncStatus(isManualLogin ? 'Lokale Daten in Cloud angelegt' : 'Cloud-Speicher angelegt', 'ok');
      }
      setLoginMessage('Angemeldet.', 'ok');
    } catch (error) {
      console.error(error);
      lockApp('Cloud-Sync fehlgeschlagen. Bitte RLS/Tabellen prüfen und erneut einloggen.', 'danger');
      setSyncStatus('Cloud-Sync fehlgeschlagen', 'danger');
    } finally {
      isCloudLoading = false;
      renderCloudAuth();
      renderCloudStatusDetails();
    }
  }


  async function refreshFromCloud() {
    if (!hasCloudLogin()) {
      renderAll();
      setSyncStatus('Ansicht aktualisiert', 'ok');
      return;
    }
    if (isCloudLoading) return;
    isCloudLoading = true;
    try {
      setSyncStatus('Cloud wird aktualisiert …', 'warning');
      const cloudRecord = await cloudLaden();
      if (cloudRecord?.data && Object.keys(cloudRecord.data).length) {
        state = normalizeStateObject(stripRemovedFeatures(cloudRecord.data));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        renderAll();
        const when = cloudRecord.updated_at
          ? new Date(cloudRecord.updated_at).toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'})
          : 'gerade';
        setSyncStatus('Aktualisiert aus Cloud · ' + when, 'ok');
      } else {
        renderAll();
        setSyncStatus('Keine Cloud-Daten gefunden · Ansicht aktualisiert', 'warning');
      }
    } catch (error) {
      console.error(error);
      renderAll();
      setSyncStatus('Aktualisieren fehlgeschlagen · Ansicht lokal neu gezeichnet', 'danger');
    } finally {
      isCloudLoading = false;
      renderCloudAuth();
      renderCloudStatusDetails();
    }
  }


  function deepMerge(base, patch) {
    if (Array.isArray(base)) return Array.isArray(patch) ? patch : base;
    if (typeof base !== 'object' || base === null) return patch ?? base;
    const out = { ...base };
    for (const key of Object.keys(patch || {})) {
      if (key in base) out[key] = deepMerge(base[key], patch[key]);
      else out[key] = patch[key];
    }
    return out;
  }

  function euro(amount) {
    return (Number(amount || 0)).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  }
  function fixed2(n) { return Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function minToHours(minutes) {
    const m = Math.max(0, Number(minutes || 0));
    return fixed2(m / 60) + ' Std.';
  }
  function dateToMonth(date) { return date.slice(0,7); }
  function monthStart(month) { return new Date(month + '-01T00:00:00'); }
  function monthEnd(month) { const d = monthStart(month); return new Date(d.getFullYear(), d.getMonth()+1, 0); }
  function toLocalDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function toLocalMonth(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
  function currentMonth() { return toLocalMonth(new Date()); }
  function currentDate() { return toLocalDate(new Date()); }
  function prevMonth(month) {
    const d = monthStart(month);
    d.setMonth(d.getMonth() - 1);
    return toLocalMonth(d);
  }
  function formatMonth(month) { const [y,m] = month.split('-').map(Number); return MONTH_NAMES[m-1] + ' ' + y; }
  function parseTime(s) {
    if (!s) return null;
    const parts = String(s).trim().split(':').map(Number);
    const h = parts[0];
    const m = parts[1];
    const sec = Number.isFinite(parts[2]) ? parts[2] : 0;
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(sec)) return null;
    return h * 60 + m + sec / 60;
  }
  function parseDurationMinutes(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    if (/^\d+(?:[,.]\d+)?$/.test(raw)) return Number(raw.replace(',', '.'));
    const match = raw.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]) + Number(match[3] || 0) / 60;
  }
  function formatMinutes(mins) {
    const totalSeconds = Math.max(0, Math.round(Number(mins || 0) * 60));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const sec = totalSeconds % 60;
    const base = `${h}:${String(m).padStart(2,'0')}`;
    return sec ? `${base}:${String(sec).padStart(2,'0')}` : base;
  }
  function formatDateLong(dateStr) { const d = new Date(dateStr + 'T00:00:00'); return d.toLocaleDateString('de-DE', { weekday:'long', day:'2-digit', month:'2-digit', year:'numeric' }); }
  function formatDateShort(dateStr) { const d = new Date(dateStr + 'T00:00:00'); return d.toLocaleDateString('de-DE', { weekday:'short', day:'2-digit', month:'2-digit' }); }

  const holidayCache = {};
  function formatIsoDate(year, month, day) {
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }
  function addDateDays(dateObj, days) {
    const d = new Date(dateObj);
    d.setDate(d.getDate() + days);
    return d;
  }
  function getBrandenburgHolidayMap(year) {
    if (holidayCache[year]) return holidayCache[year];
    const easter = easterSunday(year);
    const map = {};
    const addHoliday = (dateObj, name) => {
      map[formatIsoDate(dateObj.getFullYear(), dateObj.getMonth() + 1, dateObj.getDate())] = name;
    };
    addHoliday(new Date(year, 0, 1), 'Neujahr');
    addHoliday(addDateDays(easter, -2), 'Karfreitag');
    addHoliday(addDateDays(easter, 0), 'Ostersonntag');
    addHoliday(addDateDays(easter, 1), 'Ostermontag');
    addHoliday(new Date(year, 4, 1), 'Tag der Arbeit');
    addHoliday(addDateDays(easter, 39), 'Christi Himmelfahrt');
    addHoliday(addDateDays(easter, 49), 'Pfingstsonntag');
    addHoliday(addDateDays(easter, 50), 'Pfingstmontag');
    addHoliday(new Date(year, 9, 3), 'Tag der Deutschen Einheit');
    addHoliday(new Date(year, 9, 31), 'Reformationstag');
    addHoliday(new Date(year, 11, 25), '1. Weihnachtstag');
    addHoliday(new Date(year, 11, 26), '2. Weihnachtstag');
    holidayCache[year] = map;
    return map;
  }
  function getHolidayName(dateStr) {
    if (!dateStr) return '';
    const year = Number(String(dateStr).slice(0, 4));
    return getBrandenburgHolidayMap(year)[dateStr] || '';
  }
  function isBrandenburgHoliday(dateStr) {
    return !!getHolidayName(dateStr);
  }

  function templateLabel(v) { return TEMPLATE_LABELS[v] || v || '—'; }
  function statusLabel(v) { return STATUS_LABELS[v] || v || '—'; }
  function actualLabel(v) { return ACTUAL_LABELS[v] || templateLabel(v) || v || '—'; }
  function lineCategoryLabel(v) { return LINE_CATEGORY_LABELS[v] || v || '—'; }
  function describeEntry(entry) {
    const nr = entry.serviceNumber ? `Dienst ${entry.serviceNumber}` : actualLabel(entry.actualType || entry.plannedType);
    return entry.serviceNumber ? `${nr} · ${actualLabel(entry.actualType || entry.plannedType)}` : nr;
  }

  function overlap(startA, endA, startB, endB) {
    const s = Math.max(startA, startB); const e = Math.min(endA, endB); return Math.max(0, e - s);
  }

  function buildSegmentsForEntry(entry) {
    if (isOpenFrvWithoutAssignment(entry)) {
      return [{ start: 0, end: Number(entry.frvMinutes || state.settings.frvPlaceholderMinutes), weekday: new Date(entry.date + 'T00:00:00').getDay() }];
    }
    if (entry.isVacation || entry.actualType === 'vacation' || entry.isSick || entry.actualType === 'sick' || entry.actualType === 'free') return [];
    const weekday = new Date(entry.date + 'T00:00:00').getDay();
    if (entry.isSplitShift || entry.actualType === 'split_shift') {
      return (entry.parts || []).map(p => ({
        start: parseTime(p.startTime) || 0,
        end: normalizeEnd(parseTime(p.startTime), parseTime(p.endTime)),
        breakMinutes: Number(p.breakMinutes || 0),
        weekday
      }));
    }
    const s = parseTime(entry.startTime);
    const e = parseTime(entry.endTime);
    if (s == null || e == null) return [];
    return [{ start: s, end: normalizeEnd(s, e), breakMinutes: Number(entry.breakMinutes || 0), weekday }];
  }

  function normalizeEnd(start, end) { return end < start ? end + 1440 : end; }

  function entryHasTimeValues(entry) {
    if (!entry) return false;
    if (entry.startTime && entry.endTime) return true;
    return (entry.parts || []).some(p => p.startTime && p.endTime);
  }

  function entryHasActualService(entry) {
    if (!entry) return false;
    return !!(entry.serviceNumber || entryHasTimeValues(entry) || entry.isSplitShift || entry.actualType === 'split_shift');
  }

  function isOpenFrvWithoutAssignment(entry) {
    return !!entry && entry.actualType === 'frv_open' && !entryHasActualService(entry);
  }

  function normalizeFrvActualAssignment(entry) {
    if (!entry) return entry;
    if (entry.isVacation || entry.isSick || entry.actualType === 'vacation' || entry.actualType === 'sick' || entry.actualType === 'free') return entry;
    if ((entry.plannedType === 'frv' || entry.actualType === 'frv_open' || entry.actualType === 'frv_assigned') && entryHasActualService(entry)) {
      // Ein echter Dienst auf einem FRV-Tag bleibt als FRV-Zuteilung erkennbar,
      // damit Kopieren, Kalender und Lohn nicht wieder auf die FRV-Pauschale zurückfallen.
      if (entry.actualType === 'frv_open' || (entry.plannedType === 'frv' && entry.actualType === 'fixed')) entry.actualType = 'frv_assigned';
      if (['open', 'planned'].includes(entry.status)) entry.status = 'assigned';
      entry.usesTemplatePaidMinutes = false;
      if (entry.paidMinutes != null) delete entry.paidMinutes;
    }
    return entry;
  }

  function normalizeFrvAssignmentsInMap(map) {
    if (!map || typeof map !== 'object') return 0;
    let count = 0;
    Object.values(map).forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const before = `${entry.actualType || ''}|${entry.status || ''}|${entry.usesTemplatePaidMinutes ? 1 : 0}|${entry.paidMinutes ?? ''}`;
      normalizeFrvActualAssignment(entry);
      const after = `${entry.actualType || ''}|${entry.status || ''}|${entry.usesTemplatePaidMinutes ? 1 : 0}|${entry.paidMinutes ?? ''}`;
      if (before !== after) count += 1;
    });
    return count;
  }

  function calculatePaidMinutes(entry) {
    if (isOpenFrvWithoutAssignment(entry)) return Number(entry.frvMinutes || state.settings.frvPlaceholderMinutes);
    if (entry.isVacation || entry.actualType === 'vacation' || entry.isSick || entry.actualType === 'sick' || entry.actualType === 'free') return 0;
    if (entry.usesTemplatePaidMinutes && Number(entry.paidMinutes || 0) > 0) return Number(entry.paidMinutes || 0);
    const segs = buildSegmentsForEntry(entry);
    return segs.reduce((sum, seg) => sum + Math.max(0, seg.end - seg.start - Number(seg.breakMinutes || 0)), 0);
  }

  function getCompleteSplitParts(entry) {
    return (entry?.parts || []).filter((part) => part.startTime && part.endTime);
  }

  function calculateSplitShiftCompensation(entry) {
    if (!(entry?.isSplitShift || entry?.actualType === 'split_shift')) return null;
    const parts = getCompleteSplitParts(entry);
    if (parts.length < 2) return { amount: 0, label: 'Geteilter Dienst', days: 0, note: '' };

    const splitCount = Math.max(1, parts.length - 1);
    const baseAmount = splitCount > 1 ? 9 : 7;

    // TV-N Brandenburg ab 01.07.2024: +1 €, wenn ein Dienstteil unter 2 Stunden liegt
    // und dieser Teil nicht mit 2 Stunden Arbeitszeit angerechnet wird.
    const hasShortUncreditedPart = parts.some((part) => {
      const s = parseTime(part.startTime);
      const eRaw = parseTime(part.endTime);
      if (s == null || eRaw == null) return false;
      const paid = Math.max(0, normalizeEnd(s, eRaw) - s - Number(part.breakMinutes || 0));
      return paid > 0 && paid < 120;
    });
    const shortPartAmount = hasShortUncreditedPart ? 1 : 0;
    const amount = baseAmount + shortPartAmount;
    const label = splitCount > 1 ? 'Geteilter Dienst mehrmalig' : 'Geteilter Dienst';
    const note = shortPartAmount ? 'inkl. Kurzteil +1 €' : '';
    return { amount, label, days: 1, splitCount, shortPartAmount, note };
  }

  function isExtraWorkEntry(entry) {
    return !!(entry && (entry.isExtraWork || entry.actualType === 'extra_work'));
  }

  function calculateOvertimeSupplement(entry, paidHours = null) {
    const manualHours = Number(entry?.orderedOvertimeHours || 0);
    const workedHours = paidHours == null ? calculatePaidMinutes(entry) / 60 : Number(paidHours || 0);
    // Zusatzdienste/Einspringen zählen automatisch als angeordnete Mehrarbeit,
    // freiwillige Tausche dagegen nicht (§ 9 Abs. 15 TV-N BRB).
    const autoExtraHours = (isExtraWorkEntry(entry) && !entry.isVoluntarySwap && workedHours > 0) ? workedHours : 0;
    const hours = Math.max(manualHours, autoExtraHours);
    if (hours <= 0) return { hours: 0, label: 'Überstd. 30%', note: '' };
    const label = autoExtraHours > 0 ? 'Überstd. Zusatzdienst 30%' : 'Überstd. 30%';
    let note = '';
    if (autoExtraHours > 0 && manualHours > 0 && manualHours !== autoExtraHours) {
      note = `Zusatzdienst automatisch ${fixed2(autoExtraHours)} Std.; manuell ${fixed2(manualHours)} Std.; berechnet ${fixed2(hours)} Std.`;
    } else if (autoExtraHours > 0) {
      note = 'Automatisch aus Zusatzdienst / Einspringen';
    }
    return { hours: round2(hours), label, note, autoExtraHours: round2(autoExtraHours), manualHours: round2(manualHours) };
  }

  function calculateTemplatePaidMinutes(day) {
    if (!day) return 0;
    if (day.templateType === 'free' || day.templateType === 'vacation' || day.templateType === 'sick') return 0;
    const stored = Number(day.defaultPaidMinutes || 0);
    if (stored > 0) return stored;
    if (day.templateType === 'frv') return Number(state.settings.frvPlaceholderMinutes || 468);
    const start = parseTime(day.defaultStartTime);
    const end = parseTime(day.defaultEndTime);
    if (start == null || end == null) return 0;
    return Math.max(0, normalizeEnd(start, end) - start - Number(day.defaultBreakMinutes || 0));
  }

  function syncDayPaidPreview() {
    const previewField = document.getElementById('dayPaidPreview');
    if (!previewField) return;
    const actualType = document.getElementById('actualType')?.value || 'fixed';
    const isVacation = !!document.getElementById('flagVacation')?.checked;
    const isSick = !!document.getElementById('flagSick')?.checked;
    const isSplit = !!document.getElementById('flagSplit')?.checked || actualType === 'split_shift';
    let minutes = 0;
    if (actualType === 'frv_open' && !document.getElementById('dayServiceNumber')?.value?.trim() && !document.getElementById('dayStart')?.value && !document.getElementById('dayEnd')?.value && !hasSplitInlineValues()) {
      minutes = parseDurationMinutes(document.getElementById('frvMinutes')?.value) ?? Number(state.settings.frvPlaceholderMinutes || 468);
    } else if (isVacation || isSick || actualType === 'vacation' || actualType === 'sick' || actualType === 'free') {
      minutes = 0;
    } else if (isSplit) {
      minutes = readSplitInlineParts({ completeOnly: true }).reduce((sum, part) => {
        const s = parseTime(part.startTime || '');
        const eRaw = parseTime(part.endTime || '');
        const b = Number(part.breakMinutes || 0);
        if (s == null || eRaw == null) return sum;
        const e = normalizeEnd(s, eRaw);
        return sum + Math.max(0, e - s - b);
      }, 0);
    } else {
      const s = parseTime(document.getElementById('dayStart')?.value || '');
      const eRaw = parseTime(document.getElementById('dayEnd')?.value || '');
      const b = Number(document.getElementById('dayBreak')?.value || 0);
      if (s != null && eRaw != null) minutes = Math.max(0, normalizeEnd(s, eRaw) - s - b);
    }
    previewField.value = formatMinutes(minutes);
  }

  function eligibleHoursSaturday(entry) {
    const d = new Date(entry.date + 'T00:00:00');
    if (d.getDay() !== 6) return 0;
    return buildSegmentsForEntry(entry).reduce((sum, seg) => sum + overlap(seg.start, seg.end, 13*60, 24*60)/60, 0);
  }
  function eligibleHoursSunday(entry) {
    const d = new Date(entry.date + 'T00:00:00');
    if (d.getDay() !== 0) return 0;
    return calculatePaidMinutes(entry)/60;
  }
  function eligibleHoursNight(entry) {
    return buildSegmentsForEntry(entry).reduce((sum, seg) => {
      let total = 0;
      // Nachtarbeit zählt von 21:00 bis 06:00. Deshalb müssen auch Frühdienste
      // wie 03:30–12:30 sauber mit 03:30–06:00 berücksichtigt werden.
      total += overlap(seg.start, seg.end, 0, 6*60) / 60;
      total += overlap(seg.start, seg.end, 21*60, 24*60) / 60;
      if (seg.end > 1440) {
        total += overlap(seg.start-1440, seg.end-1440, 0, 6*60) / 60;
        total += overlap(seg.start-1440, seg.end-1440, 21*60, 24*60) / 60;
      }
      return sum + total;
    }, 0);
  }

  function monthShift(month, delta) {
    const d = monthStart(month);
    d.setMonth(d.getMonth() + delta);
    return toLocalMonth(d);
  }

  function absenceReferencePaidMonths(date) {
    const eventMonth = dateToMonth(date);
    return [monthShift(eventMonth, -3), monthShift(eventMonth, -2), monthShift(eventMonth, -1)];
  }

  function scheduledAbsenceMinutes(date) {
    const template = getTemplateForDate(date);
    if (!template || template.templateType === 'free') return 0;
    if (template.templateType === 'frv') return Number(state.settings.frvPlaceholderMinutes || 468);
    return calculateTemplatePaidMinutes(template);
  }

  function isActualWorkForAverage(entry) {
    if (!entry) return false;
    if (entry.actualType === 'free' || entry.actualType === 'frv_open') return false;
    if (entry.isVacation || entry.actualType === 'vacation') return false;
    if (entry.isSick || entry.actualType === 'sick') return false;
    return calculatePaidMinutes(entry) > 0;
  }

  function calculateCalendarDaySupplementAmount(entry, rate) {
    // TV-N Brandenburg § 11: Beim Zusammentreffen der Zuschläge c bis f
    // (Sonntag, Feiertag, 24./31.12., Samstag ab 13 Uhr) wird nur der höchste gezahlt.
    // Überstunden (a) und Nachtarbeit (b) bleiben zusätzlich möglich.
    const paidHours = calculatePaidMinutes(entry) / 60;
    if (paidHours <= 0) return 0;
    if (entry.isHoliday) return paidHours * rate * 1.35;
    if (entry.isVorfesttag) return paidHours * rate * 0.35;
    const sunHours = eligibleHoursSunday(entry);
    if (sunHours > 0) return sunHours * rate * 0.25;
    const satHours = eligibleHoursSaturday(entry);
    if (satHours > 0) return satHours * rate * 0.20;
    return 0;
  }

  function calculateEligibleAverageAmountForEntry(entry) {
    const rate = getEffectiveTariffForDate(entry.date).bonusHourRate;
    let amount = 0;
    const nightHours = eligibleHoursNight(entry);
    if (nightHours > 0) amount += nightHours * rate * 0.25;
    amount += calculateCalendarDaySupplementAmount(entry, rate);
    return round2(amount);
  }

  function calculateAverageVariableSupplementsForAbsence(date) {
    const referencePaidMonths = absenceReferencePaidMonths(date);
    let totalEligible = 0;
    let totalWorkedMinutes = 0;

    referencePaidMonths.forEach((paidMonth) => {
      const earnedMonth = prevMonth(paidMonth);
      monthDateRange(earnedMonth).forEach((refDate) => {
        const refEntry = getPayrollSourceEntry(refDate);
        if (!isActualWorkForAverage(refEntry)) return;
        totalWorkedMinutes += calculatePaidMinutes(refEntry);
        totalEligible += calculateEligibleAverageAmountForEntry(refEntry);
      });
    });

    const totalHours = totalWorkedMinutes / 60;
    const averagePerHour = totalHours > 0 ? round2(totalEligible / totalHours) : 0;
    return {
      referencePaidMonths,
      totalEligible: round2(totalEligible),
      totalWorkedHours: round2(totalHours),
      averagePerHour
    };
  }

  function buildEarnedItems(month) {
    const items = [];
    const rate = getEffectiveTariffForMonth(month).bonusHourRate;
    const dates = monthDateRange(month);
    let attendanceDays = 0;
    for (const date of dates) {
      const entry = getPayrollSourceEntry(date);
      if (!entry) continue;
      const paidMinutes = calculatePaidMinutes(entry);
      const paidHours = paidMinutes / 60;
      const plannedWorkingDay = isPlannedWorkingDay(date);
      const isActualWork = paidMinutes > 0 && !entry.isVacation && !entry.isSick && entry.actualType !== 'free' && entry.actualType !== 'frv_open';
      if (isActualWork) attendanceDays += 1;

      const nightHours = eligibleHoursNight(entry);
      if (nightHours > 0) items.push(item('NIGHT','Nachtzuschlag', nightHours * rate * 0.25, nightHours, 25, month, nextMonth(month)));

      // TV-N Brandenburg § 11: Sonntag/Feiertag/24.12.-31.12./Samstag ab 13 Uhr
      // schließen sich gegenseitig aus; gezahlt wird nur der höchste Zuschlag aus c bis f.
      if (entry.isHoliday && paidHours > 0) {
        items.push(item('HOLIDAY_100','Feiertag 100%', paidHours * rate * 1.00, paidHours, 100, month, nextMonth(month)));
        items.push(item('HOLIDAY_35','Feiertag 35%', paidHours * rate * 0.35, paidHours, 35, month, nextMonth(month)));
      } else if (entry.isVorfesttag && paidHours > 0) {
        items.push(item('VORFESTTAG','Vorfesttag', paidHours * rate * 0.35, paidHours, 35, month, nextMonth(month)));
      } else {
        const sunHours = eligibleHoursSunday(entry);
        if (sunHours > 0) items.push(item('SUNDAY','Sonntagszuschlag', sunHours * rate * 0.25, sunHours, 25, month, nextMonth(month)));
        const satHours = eligibleHoursSaturday(entry);
        if (satHours > 0) items.push(item('SATURDAY','Samstagszulage', satHours * rate * 0.20, satHours, 20, month, nextMonth(month)));
      }
      const overtime = calculateOvertimeSupplement(entry, paidHours);
      if (isExtraWorkEntry(entry) && !entry.isVoluntarySwap && paidHours > 0) {
        const baseRate = getEffectiveTariffForDate(date).baseHourRate;
        const extraBaseItem = item('EXTRA_WORK_BASE', 'Zusatzstunden Auszahlung', paidHours * baseRate, paidHours, null, month, nextMonth(month), baseRate);
        extraBaseItem.note = 'Grundvergütung für Zusatzdienst / Einspringen';
        items.push(extraBaseItem);
      }
      if (overtime.hours > 0) {
        const overtimeItem = item('OVERTIME_30', overtime.label, overtime.hours * rate * 0.30, overtime.hours, 30, month, nextMonth(month));
        if (overtime.note) overtimeItem.note = overtime.note;
        overtimeItem.autoExtraHours = overtime.autoExtraHours;
        overtimeItem.manualHours = overtime.manualHours;
        items.push(overtimeItem);
      }
      if (entry.isFahrdienst && isActualWork) items.push(item('FAHRDIENST','Fahrdienstzulage', 5, null, null, month, nextMonth(month), null, 1));
      const splitCompensation = calculateSplitShiftCompensation(entry);
      if (splitCompensation && splitCompensation.amount > 0) {
        const splitItem = item('SPLIT_SHIFT', splitCompensation.label, splitCompensation.amount, null, null, month, nextMonth(month), null, splitCompensation.days);
        if (splitCompensation.note) splitItem.note = splitCompensation.note;
        splitItem.splitCount = splitCompensation.splitCount;
        splitItem.shortPartAmount = splitCompensation.shortPartAmount;
        items.push(splitItem);
      }

      // TV-N Brandenburg § 6 Abs. 3: Urlaub/Krankheit erhalten nur den Durchschnitt der variablen Zeitzuschläge.
      // Das feste Monatsentgelt ist bereits im Grundlohn enthalten und wird hier nicht erneut angesetzt.
      if ((entry.isVacation || entry.actualType === 'vacation') && plannedWorkingDay) {
        const targetMinutes = scheduledAbsenceMinutes(date);
        if (targetMinutes > 0) {
          const avg = calculateAverageVariableSupplementsForAbsence(date);
          const amount = round2(avg.averagePerHour * (targetMinutes / 60));
          if (amount > 0) items.push(item('VACATION_BONUS','Urlaubszuschlag', amount, targetMinutes / 60, null, month, nextMonth(month), avg.averagePerHour, 1));
        }
      }
      if ((entry.isSick || entry.actualType === 'sick') && plannedWorkingDay) {
        const targetMinutes = scheduledAbsenceMinutes(date);
        if (targetMinutes > 0) {
          const avg = calculateAverageVariableSupplementsForAbsence(date);
          const amount = round2(avg.averagePerHour * (targetMinutes / 60));
          if (amount > 0) items.push(item('LFZ_BONUS','Krankenzuschlag / LFZ-Zuschlag', amount, targetMinutes / 60, null, month, nextMonth(month), avg.averagePerHour, 1));
        }
      }
      if (entry.isBetriebsversammlung && paidHours > 0) items.push(item('BETRIEBSVERSAMMLUNG_HOURS','Std. Betriebsversammlung', paidHours * getEffectiveTariffForDate(date).baseHourRate, paidHours, null, month, nextMonth(month)));
      if (entry.isBetriebsversammlung && Number(entry.betriebsversammlungTravelAmount || 0) > 0) items.push(item('BETRIEBSVERSAMMLUNG_TRAVEL','FK Betriebsversammlung', Number(entry.betriebsversammlungTravelAmount), null, null, month, nextMonth(month), null, null, true));
    }
    if (attendanceDays > 0) items.push(item('ATTENDANCE','Anwesenheitsprämie', attendanceDays * 2, null, null, month, nextMonth(month), null, attendanceDays));
    return items;
  }

  function nextMonth(month) { const d = monthStart(month); d.setMonth(d.getMonth() + 1); return toLocalMonth(d); }

  function item(code,label,amount,hours,percent,earnedMonth,paidMonth,factor=null,days=null,reimbursement=false) {
    const m = payMatrix[code] || cfg(true,true,true,true,reimbursement);
    return { code, label, amount: round2(amount), hours, percent, earnedMonth, paidMonth, factor, days, reimbursement: reimbursement || m.reimbursement, counts: m };
  }

  function groupPayItems(items) {
    const grouped = new Map();
    items.forEach((x) => {
      const key = [
        x.code || '',
        x.label || '',
        x.earnedMonth || '',
        x.paidMonth || '',
        x.percent == null ? '' : x.percent,
        x.factor == null ? '' : x.factor,
        !!x.reimbursement,
        !!x.counts?.gesamt,
        !!x.counts?.steuer,
        !!x.counts?.sv,
        !!x.counts?.zv
      ].join('|');

      if (!grouped.has(key)) {
        grouped.set(key, {
          ...x,
          amount: 0,
          hours: null,
          days: null
        });
      }

      const g = grouped.get(key);
      g.amount = round2(Number(g.amount || 0) + Number(x.amount || 0));

      if (x.hours != null && Number(x.hours) > 0) {
        g.hours = round2(Number(g.hours || 0) + Number(x.hours || 0));
      }

      if (x.days != null && Number(x.days) > 0) {
        g.days = round2(Number(g.days || 0) + Number(x.days || 0));
      }
    });

    return [...grouped.values()];
  }

  function round2(v) { return Math.round((Number(v)||0)*100)/100; }

  function manualLinesForPaidMonth(month) {
    return state.statementLines.filter(x => x.paidMonth === month).map(x => ({
      code: x.code || 'MANUAL', label: x.label, amount: Number(x.amount || 0), hours: null, percent: null,
      earnedMonth: x.earnedMonth || month, paidMonth: x.paidMonth || month, factor: null, days: null,
      reimbursement: !!x.isReimbursement,
      counts: { gesamt: !!x.countsGesamt, steuer: !!x.countsSteuer, sv: !!x.countsSv, zv: !!x.countsZv, reimbursement: !!x.isReimbursement }
    }));
  }

  function tariffSpecialPaymentsForPaidMonth(month) {
    const lines = [];
    if (month === '2026-05') {
      const manualDuplicate = state.statementLines.some(x =>
        x.paidMonth === month &&
        String(x.category || x.code || '').toLowerCase().includes('tariff') &&
        Math.abs(Number(x.amount || 0) - 160) < 0.01
      );
      if (!manualDuplicate) {
        lines.push(item('TARIFF_SPECIAL', 'Sonderzahlung Tarifabschluss Mai 2026', 160, null, null, month, month));
      }
    }
    return lines;
  }

  function calculatePayroll(month) {
    const earnedItemsRaw = buildEarnedItems(month);
    const effectiveTariff = getEffectiveTariffForMonth(month);
    const paidMonth = month;
    const previous = prevMonth(month);
    const paidItemsRaw = [
      item('BASE_PAY','Grundvergütung', effectiveTariff.fixedMonthlyBasePay, null, null, month, month)
    ];
    paidItemsRaw.push(...buildEarnedItems(previous).filter(x => x.paidMonth === month));
    paidItemsRaw.push(...tariffSpecialPaymentsForPaidMonth(month));
    paidItemsRaw.push(...manualLinesForPaidMonth(month));
    const earnedItems = groupPayItems(earnedItemsRaw);
    const paidItems = groupPayItems(paidItemsRaw);

    const gross = { gesamt: 0, steuer: 0, sv: 0, zv: 0 };
    for (const x of paidItems) {
      if (x.counts.gesamt) gross.gesamt += x.amount;
      if (x.counts.steuer) gross.steuer += x.amount;
      if (x.counts.sv) gross.sv += x.amount;
      if (x.counts.zv) gross.zv += x.amount;
    }
    gross.gesamt = round2(gross.gesamt); gross.steuer = round2(gross.steuer); gross.sv = round2(gross.sv); gross.zv = round2(gross.zv);
    const kvbbgUmlage = round2(gross.zv * (Number(state.settings.kvbbgUmlagePercent || 0.55) / 100));
    const kvbbgZusatz = round2(gross.zv * (Number(state.settings.kvbbgZusatzPercent || 2.4) / 100));
    const statement = state.statements[month] || {};

    const estimated = {
      lohnsteuer: round2(gross.steuer * (Number(state.settings.estimatedTaxPercent || 0) / 100)),
      kv: round2(gross.sv * (Number(state.settings.estimatedHealthPercent || 0) / 100)),
      rv: round2(gross.sv * (Number(state.settings.estimatedPensionPercent || 0) / 100)),
      av: round2(gross.sv * (Number(state.settings.estimatedUnemploymentPercent || 0) / 100)),
      pv: round2(gross.sv * (Number(state.settings.estimatedCarePercent || 0) / 100))
    };
    estimated.kirchensteuer = round2(estimated.lohnsteuer * (Number(state.settings.estimatedChurchPercent || 0) / 100));
    estimated.soli = round2(estimated.lohnsteuer * (Number(state.settings.estimatedSoliPercent || 0) / 100));
    estimated.kvbbgUmlage = kvbbgUmlage;
    estimated.kvbbgZusatz = kvbbgZusatz;
    estimated.other = round2(Number(statement.other || 0));

    const hasActualCore = ['lohnsteuer','kv','rv','av','pv'].some(k => Number(statement[k] || 0) > 0);
    const preferActual = !!state.settings.preferActualDeductions;
    const deductions = {
      lohnsteuer: preferActual && Number(statement.lohnsteuer || 0) > 0 ? round2(Number(statement.lohnsteuer || 0)) : estimated.lohnsteuer,
      kirchensteuer: preferActual && Number(statement.kirchensteuer || 0) > 0 ? round2(Number(statement.kirchensteuer || 0)) : estimated.kirchensteuer,
      soli: preferActual && Number(statement.soli || 0) > 0 ? round2(Number(statement.soli || 0)) : estimated.soli,
      kv: preferActual && Number(statement.kv || 0) > 0 ? round2(Number(statement.kv || 0)) : estimated.kv,
      rv: preferActual && Number(statement.rv || 0) > 0 ? round2(Number(statement.rv || 0)) : estimated.rv,
      av: preferActual && Number(statement.av || 0) > 0 ? round2(Number(statement.av || 0)) : estimated.av,
      pv: preferActual && Number(statement.pv || 0) > 0 ? round2(Number(statement.pv || 0)) : estimated.pv,
      kvbbgUmlage,
      kvbbgZusatz,
      other: round2(Number(statement.other || 0))
    };
    const deductionMode = hasActualCore && preferActual ? 'Abrechnung + KVBbg' : 'Schätzung + KVBbg';
    const totalDeductions = round2(Object.values(deductions).reduce((s, x) => s + Number(x || 0), 0));
    const paidGrossTotal = round2(paidItems.reduce((s, x) => s + (x.reimbursement ? 0 : Number(x.amount || 0)), 0));
    const paidAllowancesTotal = round2(paidItems.filter(x => x.code !== 'BASE_PAY').reduce((s, x) => s + Number(x.amount || 0), 0));
    const payoutPreview = round2(gross.gesamt - totalDeductions);

    return { month, effectiveTariff, earnedItems, paidItems, gross, paidGrossTotal, paidAllowancesTotal, kvbbgUmlage, kvbbgZusatz, estimatedDeductions: estimated, deductions, totalDeductions, deductionMode, payoutPreview, statement };
  }

  function ensureEntry(date) {
    if (!state.dayEntries[date]) {
      const template = getTemplateForDate(date);
      state.dayEntries[date] = {
        date,
        plannedType: template.templateType,
        status: template.templateType === 'frv' ? 'open' : 'planned',
        actualType: template.templateType === 'frv' ? 'frv_open' : template.templateType,
        serviceNumber: template.serviceNumber || '',
        startTime: template.defaultStartTime || '',
        endTime: template.defaultEndTime || '',
        breakMinutes: Number(template.defaultBreakMinutes || 0),
        frvMinutes: Number(state.settings.frvPlaceholderMinutes || 468),
        isFahrdienst: state.settings.isFahrdienst,
        isHoliday: isBrandenburgHoliday(date),
        isVorfesttag: false,
        isSplitShift: false,
        isVacation: template.templateType === 'vacation',
        isSick: template.templateType === 'sick',
        isBetriebsversammlung: false,
        isVoluntarySwap: false,
        isExtraWork: false,
        isFinal: false,
        orderedOvertimeHours: 0,
        factorValue: 0,
        vacationDays: template.templateType === 'vacation' ? 1 : 0,
        sickDays: template.templateType === 'sick' ? 1 : 0,
        parts: [],
        notes: '',
        betriebsversammlungTravelAmount: 0
      };
    }
    return state.dayEntries[date];
  }

  function startOfIsoWeek(dateObj) {
    const d = new Date(dateObj);
    const day = (d.getDay() + 6) % 7;
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() - day);
    return d;
  }

  function getRotationWeekNumberForDate(date) {
    const actual = new Date(date + 'T00:00:00');
    const anchorDate = state.settings.currentRotationAnchorDate || currentDate();
    const anchorWeek = Math.min(40, Math.max(1, Number(state.settings.currentRotationWeek || 1)));
    const actualWeekStart = startOfIsoWeek(actual);
    const anchorWeekStart = startOfIsoWeek(new Date(anchorDate + 'T00:00:00'));
    const diffWeeks = Math.round((actualWeekStart - anchorWeekStart) / 604800000);
    return (((anchorWeek - 1) + diffWeeks) % 40 + 40) % 40 + 1;
  }

  function getTemplateForDate(date) {
    const actual = new Date(date + 'T00:00:00');
    const weekNumber = getRotationWeekNumberForDate(date);
    const weekIndex = weekNumber - 1;
    const weekday = (actual.getDay() + 6) % 7;
    return getActiveRotationWeeks()[weekIndex].days[weekday];
  }

  function isPlannedWorkingDay(date) {
    const template = getTemplateForDate(date);
    return !!template && template.templateType !== 'free';
  }

  function isoWeekdayIndex(dateStr) {
    return (new Date(dateStr + 'T00:00:00').getDay() + 6) % 7;
  }

  function getRotationFreezeStartDate() {
    const year = Number(currentDate().slice(0, 4));
    const defaultStart = `${year - 1}-01-01`;
    const candidates = [defaultStart];
    if (state.settings.currentRotationAnchorDate) candidates.push(state.settings.currentRotationAnchorDate);
    const existingDates = Object.keys(state.dayEntries || {}).filter(Boolean).sort();
    if (existingDates.length) candidates.push(existingDates[0]);
    return candidates.sort()[0];
  }

  function freezePastRotationDaysBeforeEdit() {
    const yesterday = addDaysIso(currentDate(), -1);
    if (state.settings.rotationPastFrozenUntil && state.settings.rotationPastFrozenUntil >= yesterday) return 0;
    const start = getRotationFreezeStartDate();
    if (!start || start > yesterday) {
      state.settings.rotationPastFrozenUntil = yesterday;
      return 0;
    }
    let count = 0;
    const cursor = new Date(start + 'T00:00:00');
    const end = new Date(yesterday + 'T00:00:00');
    while (cursor <= end) {
      const date = formatIsoDate(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
      if (!state.dayEntries[date]) {
        ensureEntry(date);
        count += 1;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    state.settings.rotationPastFrozenUntil = yesterday;
    return count;
  }

  function entryLooksAutoFromTemplate(entry, templateDay) {
    if (!entry || !templateDay) return false;
    if (entry.isFinal || entry.isVacation || entry.isSick || entry.isBetriebsversammlung || entry.isVoluntarySwap) return false;
    if (entry.isSplitShift || entry.actualType === 'split_shift') return false;
    const templateType = templateDay.templateType || 'fixed';
    const expectedActual = templateType === 'frv' ? 'frv_open' : templateType;
    const sameType = (entry.plannedType || templateType) === templateType && (entry.actualType || expectedActual) === expectedActual;
    const sameService = String(entry.serviceNumber || '') === String(templateDay.serviceNumber || '');
    const sameNotes = !entry.notes || String(entry.notes || '') === String(templateDay.notes || '');
    if (!sameType || !sameService || !sameNotes) return false;
    if (templateType === 'free' || templateType === 'frv') return true;
    return String(entry.startTime || '') === String(templateDay.defaultStartTime || '') &&
      String(entry.endTime || '') === String(templateDay.defaultEndTime || '') &&
      Number(entry.breakMinutes || 0) === Number(templateDay.defaultBreakMinutes || 0);
  }

  function updateFutureAutoEntriesForRotationSlot(weekNumber, weekdayIndex, oldTemplateDay) {
    const today = currentDate();
    const until = addDaysIso(today, 730);
    const cursor = new Date(today + 'T00:00:00');
    const end = new Date(until + 'T00:00:00');
    let count = 0;
    while (cursor <= end) {
      const date = formatIsoDate(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
      if (getRotationWeekNumberForDate(date) === weekNumber && isoWeekdayIndex(date) === weekdayIndex) {
        const saved = state.dayEntries[date];
        if (entryLooksAutoFromTemplate(saved, oldTemplateDay)) {
          delete state.dayEntries[date];
          count += 1;
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  }


  function buildTemplateDayEntry(date) {
    const template = getTemplateForDate(date);
    if (!template) return null;
    return {
      date,
      plannedType: template.templateType,
      status: template.templateType === 'frv' ? 'open' : 'planned',
      actualType: template.templateType === 'frv' ? 'frv_open' : template.templateType,
      serviceNumber: template.serviceNumber || '',
      startTime: template.defaultStartTime || '',
      endTime: template.defaultEndTime || '',
      breakMinutes: Number(template.defaultBreakMinutes || 0),
      frvMinutes: Number(state.settings.frvPlaceholderMinutes || 468),
      paidMinutes: Number(template.defaultPaidMinutes || 0),
      usesTemplatePaidMinutes: true,
      isFahrdienst: state.settings.isFahrdienst,
      isHoliday: isBrandenburgHoliday(date),
      isVorfesttag: false,
      isSplitShift: false,
      isVacation: false,
      isSick: false,
      isBetriebsversammlung: false,
      isVoluntarySwap: false,
      isExtraWork: false,
      isFinal: false,
      orderedOvertimeHours: 0,
      factorValue: 0,
      vacationDays: 0,
      sickDays: 0,
      parts: [],
      notes: template.notes || '',
      betriebsversammlungTravelAmount: 0
    };
  }

  function getPayrollSourceEntry(date) {
    const saved = state.dayEntries[date];
    const template = getTemplateForDate(date);
    const templateEntry = template ? buildTemplateDayEntry(date) : null;

    if (saved) {
      // FRV ohne echten zugeteilten Dienst zählt noch nicht für die Lohnberechnung.
      if (
        saved.actualType === 'frv_open' &&
        !saved.isVacation &&
        !saved.isSick &&
        !saved.isBetriebsversammlung &&
        !(saved.isSplitShift || saved.actualType === 'split_shift') &&
        !entryHasActualService(saved)
      ) {
        return null;
      }

      const merged = normalizeFrvActualAssignment({ ...(templateEntry || {}), ...saved, payrollSource: 'tage' });

      // Wenn ein fester Umlaufdienst nur als Feiertag/Abweichung markiert wurde,
      // aber keine neuen Zeiten eingetragen sind, bleiben die Umlaufzeiten die Grundlage.
      if (templateEntry) {
        if (!saved.serviceNumber) merged.serviceNumber = templateEntry.serviceNumber || '';
        if (!saved.startTime) merged.startTime = templateEntry.startTime || '';
        if (!saved.endTime) merged.endTime = templateEntry.endTime || '';
        if (saved.breakMinutes == null || saved.breakMinutes === '') merged.breakMinutes = templateEntry.breakMinutes || 0;
        const savedHasTimes = !!(saved.startTime && saved.endTime);
        const savedMatchesTemplateTimes = savedHasTimes &&
          saved.startTime === (templateEntry.startTime || '') &&
          saved.endTime === (templateEntry.endTime || '') &&
          Number(saved.breakMinutes || 0) === Number(templateEntry.breakMinutes || 0);
        const isRealFrvAssignment = template?.templateType === 'frv' || saved.plannedType === 'frv' || saved.actualType === 'frv_assigned';
        if (saved.paidMinutes == null && templateEntry.paidMinutes != null && !isRealFrvAssignment && (!savedHasTimes || savedMatchesTemplateTimes)) {
          merged.paidMinutes = templateEntry.paidMinutes;
          merged.usesTemplatePaidMinutes = true;
        } else if (saved.paidMinutes == null) {
          merged.usesTemplatePaidMinutes = false;
        }
        if (!saved.notes) merged.notes = templateEntry.notes || '';
        if (saved.isFahrdienst == null) merged.isFahrdienst = templateEntry.isFahrdienst;
      }

      return merged;
    }

    // Nur feste Dienste aus dem Umlauf sind direkte Lohnbasis.
    if (!template || template.templateType !== 'fixed') return null;
    return { ...buildTemplateDayEntry(date), payrollSource: 'umlauf' };
  }

  function renderAll() {
    renderAppVersion();
    renderCloudAuth();
    applyRoleAccess();
    renderCloudStatusDetails();
    if (canViewTab('overview')) renderOverview();
    if (canViewTab('rotation')) renderRotation();
    if (canViewTab('daily')) renderDailyServices();
    if (canViewTab('days')) {
      if (canEditDays()) renderDayForm();
      else renderDriverDaysView();
    }
    if (canViewTab('payroll')) renderPayroll();
    if (canViewTab('statements')) renderStatements();
    if (canViewTab('year')) renderYear();
    if (canViewTab('settings')) renderSettings();
    applyRoleAccess();
  }

  function setSelectedMonthPill(month) {
    document.getElementById('selectedMonthPill').textContent = formatMonth(month);
  }

  function renderCloudStatusDetails() {
    const details = document.getElementById('cloudStatusDetails');
    const badge = document.getElementById('cloudStatusBadge');
    if (!details || !badge) return;
    details.innerHTML = '';
    if (hasCloudLogin()) {
      badge.textContent = 'Cloud aktiv';
      badge.className = 'badge ok';
      const name = cloudProfile?.display_name || cloudProfile?.personalnummer || 'Benutzer';
      details.appendChild(dataRow('Angemeldet als', escapeHtml(name)));
      details.appendChild(dataRow('Rolle', escapeHtml(roleLabel())));
      details.appendChild(dataRow('Speicherart', 'Online in Supabase + lokaler Zwischenspeicher'));
      details.appendChild(dataRow('Letzte Cloud-Speicherung', lastCloudSavedAt ? lastCloudSavedAt.toLocaleString('de-DE') : 'noch nicht in dieser Sitzung'));
      details.appendChild(dataRow('Sicherheitsmodus', 'App erst nach Login sichtbar'));
    } else {
      badge.textContent = 'Nicht angemeldet';
      badge.className = 'badge warning';
      details.appendChild(dataRow('Status', 'Keine Daten sichtbar'));
      details.appendChild(dataRow('Speicherart', 'gesperrt bis Login'));
    }
  }

  function renderOverview() {
    const monthInput = document.getElementById('overviewMonth');
    if (!monthInput.value) monthInput.value = currentMonth();
    const month = monthInput.value;
    setSelectedMonthPill(month);
    const payroll = calculatePayroll(month);
    const next = Object.keys(state.dayEntries).filter(d => d >= currentDate()).sort()[0];
    document.getElementById('metricNextDuty').textContent = next ? formatDateLong(next) : '—';
    document.getElementById('metricNextDutySub').textContent = next ? describeEntry(state.dayEntries[next]) : 'Keine Einträge';
    const openFrv = Object.values(state.dayEntries).filter(x => x.date.startsWith(month) && x.actualType === 'frv_open').length;
    document.getElementById('metricOpenFrv').textContent = String(openFrv);
    document.getElementById('metricPayout').textContent = euro(payroll.payoutPreview);
    document.getElementById('metricEarned').textContent = euro(payroll.earnedItems.reduce((s,x)=>s+x.amount,0));
    const summary = document.getElementById('overviewSummary');
    summary.innerHTML = '';
    [
      ['Fixer Monatslohn', euro(payroll.effectiveTariff.fixedMonthlyBasePay)],
      ['Wirksame TV-N Tabelle', escapeHtml(payroll.effectiveTariff.table?.label || payroll.effectiveTariff.source)],
      ['Zuschlagsbasis', euro(payroll.effectiveTariff.bonusHourRate)],
      ['Aktive Umlaufart', escapeHtml(activeRotationTypeName())],
      ['Heute berechnete Umlaufwoche', `Woche ${getRotationWeekNumberForDate(currentDate())}`],
      ['Umlauf-Anker', `${state.settings.currentRotationAnchorDate || currentDate()} = Woche ${state.settings.currentRotationWeek || 1}`],
      ['Erarbeitet im Monat', euro(payroll.earnedItems.reduce((s,x)=>s+x.amount,0))],
      ['Aus Vormonat ausgezahlt', euro(payroll.paidItems.filter(x=>x.code!=='BASE_PAY').reduce((s,x)=>s+x.amount,0))],
      ['Gesamtbrutto', euro(payroll.gross.gesamt)],
      ['Steuerbrutto', euro(payroll.gross.steuer)],
      ['SV-Brutto', euro(payroll.gross.sv)],
      ['ZV-Brutto', euro(payroll.gross.zv)],
      ['Abzüge gesamt', euro(payroll.totalDeductions)],
      ['Berechnungsmodus', payroll.deductionMode]
    ].forEach(([a,b])=>summary.appendChild(dataRow(a,b)));
    const warnings = document.getElementById('overviewWarnings'); warnings.innerHTML='';
    const list = [];
    if (openFrv) list.push(`${openFrv} offene FRV-Tage im Monat ${formatMonth(month)}.`);
    if (!Object.keys(state.dayEntries).length) list.push('Noch keine Tagesdaten erfasst.');
    if (!list.length) list.push('Keine offenen Warnungen.');
    list.forEach(text => { const li=document.createElement('li'); li.textContent=text; warnings.appendChild(li); });
  }

  function dataRow(label, value) {
    const div=document.createElement('div'); div.className='data-row'; div.innerHTML=`<span>${label}</span><strong>${value}</strong>`; return div;
  }

  
  function calculateRotationWeekTotals(week) {
    const totals = { paidMinutes: 0, fixedDays: 0, frvDays: 0, freeDays: 0 };
    (week?.days || []).forEach((day) => {
      const type = day.templateType || 'fixed';
      if (type === 'fixed') totals.fixedDays += 1;
      if (type === 'frv') totals.frvDays += 1;
      if (type === 'free') totals.freeDays += 1;
      totals.paidMinutes += Number(day.defaultPaidMinutes || 0);
    });
    return totals;
  }

  function renderRotationWeekTotals(week) {
    const el = document.getElementById('rotationWeekTotals');
    if (!el) return;
    const totals = calculateRotationWeekTotals(week);
    el.innerHTML = `
      <div class="totals-card">
        <span>Gesamtarbeitszeit der Woche</span>
        <strong>${formatMinutes(totals.paidMinutes)}</strong>
      </div>
      <div class="totals-card">
        <span>Feste Dienste</span>
        <strong>${totals.fixedDays}</strong>
      </div>
      <div class="totals-card">
        <span>FRV-Tage</span>
        <strong>${totals.frvDays}</strong>
      </div>
      <div class="totals-card">
        <span>Freie Tage</span>
        <strong>${totals.freeDays}</strong>
      </div>
    `;
  }


  function renderRotationTypeControls() {
    const select = document.getElementById('rotationTypeSelect');
    if (!select) return;
    const previous = select.value;
    select.innerHTML = '';
    (state.rotationTypes || []).forEach((type) => {
      const opt = document.createElement('option');
      opt.value = type.id;
      opt.textContent = type.name || type.id;
      select.appendChild(opt);
    });
    select.value = state.settings.activeRotationTypeId || previous || (state.rotationTypes?.[0]?.id || 'standard');
  }

  function changeRotationType() {
    if (!canEditRotation()) return showRoleDenied('Umlaufart wechseln');
    const select = document.getElementById('rotationTypeSelect');
    if (!select?.value) return;
    state.settings.activeRotationTypeId = select.value;
    getActiveRotationWeeks();
    saveState();
    renderRotation();
    renderDaysCalendar();
    refreshPayrollViews();
  }

  function addRotationType() {
    if (!canEditRotation()) return showRoleDenied('Umlaufart anlegen');
    const name = prompt('Name der neuen Umlaufart:', 'Neue Umlaufart');
    if (!name) return;
    const id = makeId('umlauf');
    state.rotationTypes.push({ id, name: name.trim(), weeks: createDefaultRotationWeeks() });
    state.settings.activeRotationTypeId = id;
    saveState();
    renderRotation();
  }

  function duplicateRotationType() {
    if (!canEditRotation()) return showRoleDenied('Umlaufart duplizieren');
    const current = getActiveRotationType();
    const name = prompt('Name der kopierten Umlaufart:', `${current.name || 'Umlaufart'} Kopie`);
    if (!name) return;
    const id = makeId('umlauf');
    state.rotationTypes.push({ id, name: name.trim(), weeks: cloneData(getActiveRotationWeeks()) });
    state.settings.activeRotationTypeId = id;
    saveState();
    renderRotation();
  }

  function renameRotationType() {
    if (!canEditRotation()) return showRoleDenied('Umlaufart umbenennen');
    const current = getActiveRotationType();
    const name = prompt('Neuer Name der Umlaufart:', current.name || 'Umlaufart');
    if (!name) return;
    current.name = name.trim();
    saveState();
    renderRotation();
  }

  function deleteRotationType() {
    if (!canEditRotation()) return showRoleDenied('Umlaufart löschen');
    if ((state.rotationTypes || []).length <= 1) {
      alert('Die letzte Umlaufart kann nicht gelöscht werden.');
      return;
    }
    const current = getActiveRotationType();
    if (!confirm(`Umlaufart "${current.name}" wirklich löschen?`)) return;
    state.rotationTypes = state.rotationTypes.filter(type => type.id !== current.id);
    state.settings.activeRotationTypeId = state.rotationTypes[0].id;
    getActiveRotationWeeks();
    saveState();
    renderRotation();
    renderDaysCalendar();
    refreshPayrollViews();
  }

function renderRotation() {
    renderRotationTypeControls();
    const select = document.getElementById('rotationWeekSelect');
    const currentSelect = document.getElementById('currentRotationWeekSelect');
    if (!select.options.length) {
      getActiveRotationWeeks().forEach(w => {
        const opt=document.createElement('option'); opt.value=String(w.weekNumber); opt.textContent=`Woche ${w.weekNumber}`; select.appendChild(opt);
      });
      select.value='1';
    }
    if (currentSelect && !currentSelect.options.length) {
      getActiveRotationWeeks().forEach(w => {
        const opt=document.createElement('option'); opt.value=String(w.weekNumber); opt.textContent=`Woche ${w.weekNumber}`; currentSelect.appendChild(opt);
      });
    }
    if (currentSelect) currentSelect.value = String(state.settings.currentRotationWeek || 1);
    const anchorInput = document.getElementById('currentRotationAnchorDate');
    if (anchorInput) anchorInput.value = state.settings.currentRotationAnchorDate || currentDate();
    const rotationInfo = document.getElementById('rotationReferenceInfo');
    if (rotationInfo) {
      const todayWeek = getRotationWeekNumberForDate(currentDate());
      rotationInfo.textContent = `Aktive Umlaufart: ${activeRotationTypeName()}. Automatik aktiv: ${state.settings.currentRotationAnchorDate || currentDate()} = Woche ${state.settings.currentRotationWeek || 1}. Heute berechnet die App automatisch Woche ${todayWeek}; nach Woche 40 geht es wieder mit Woche 1 weiter. Änderungen am Umlauf gelten ab heute; vergangene Tage werden vorher gesichert.`;
    }
    const week = getActiveRotationWeeks()[Number(select.value)-1];
    const tbody = document.getElementById('rotationTableBody'); tbody.innerHTML='';
    renderRotationWeekTotals(week);
    week.days.forEach((day, idx) => {
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td>${day.weekdayName}</td>
        <td><input type="text" data-field="serviceNumber" data-idx="${idx}" value="${escapeHtml(day.serviceNumber||'')}" placeholder="4011" /></td>
        <td><select data-field="templateType" data-idx="${idx}">${TEMPLATE_TYPES.map(t=>`<option value="${t}" ${day.templateType===t?'selected':''}>${templateLabel(t)}</option>`).join('')}</select></td>
        <td><input type="time" step="30" data-field="defaultStartTime" data-idx="${idx}" value="${day.defaultStartTime||''}" /></td>
        <td><input type="time" step="30" data-field="defaultEndTime" data-idx="${idx}" value="${day.defaultEndTime||''}" /></td>
        <td><select data-field="defaultBreakMinutes" data-idx="${idx}">${[0,30,40].map(n=>`<option value="${n}" ${Number(day.defaultBreakMinutes||0)===n?'selected':''}>${n} Min</option>`).join('')}</select></td>
        <td>
          <div class="paid-cell">
            <input type="text" data-field="defaultPaidDisplay" data-idx="${idx}" value="${formatMinutes(day.defaultPaidMinutes||0)}" placeholder="7:48 oder 7:22:30" />
            <label class="mini-check"><input type="checkbox" data-field="defaultPaidAuto" data-idx="${idx}" ${day.defaultPaidMode !== 'manual' ? 'checked' : ''} /> Auto</label>
          </div>
        </td>
        <td><input type="text" data-field="notes" data-idx="${idx}" value="${escapeHtml(day.notes||'')}" /></td>
        <td><button type="button" class="secondary copy-day-template" data-idx="${idx}">Auf Tage übernehmen</button></td>`;
      tbody.appendChild(tr);
    });
  }


  function ensureEmployeeCollections() {
    if (!Array.isArray(state.employees)) state.employees = [];
    if (!state.employeeDayEntries || typeof state.employeeDayEntries !== 'object') state.employeeDayEntries = {};
    if (!state.dailyAssignments || typeof state.dailyAssignments !== 'object') state.dailyAssignments = {};
  }

  function rotationTypeOptionsHtml(selectedId = '') {
    return (state.rotationTypes || []).map((type) => {
      const selected = String(type.id) === String(selectedId || state.settings.activeRotationTypeId || 'standard') ? ' selected' : '';
      return `<option value="${escapeHtml(type.id)}"${selected}>${escapeHtml(type.name || type.id)}</option>`;
    }).join('');
  }

  function getRotationTypeById(id) {
    return (state.rotationTypes || []).find(type => String(type.id) === String(id)) || getActiveRotationType();
  }

  function getEmployeeDisplayName(employee) {
    if (!employee) return '—';
    const name = String(employee.name || '').trim();
    const nr = String(employee.personalnummer || '').trim();
    if (name && nr) return `${name} (${nr})`;
    return name || nr || 'Fahrer ohne Namen';
  }

  function getEmployeeById(id) {
    ensureEmployeeCollections();
    return state.employees.find(emp => String(emp.id) === String(id));
  }

  function getRotationWeekNumberForEmployee(date, employee) {
    const actual = new Date(date + 'T00:00:00');
    const anchorDate = employee?.currentRotationAnchorDate || state.settings.currentRotationAnchorDate || currentDate();
    const anchorWeek = Math.min(40, Math.max(1, Number(employee?.currentRotationWeek || state.settings.currentRotationWeek || 1)));
    const actualWeekStart = startOfIsoWeek(actual);
    const anchorWeekStart = startOfIsoWeek(new Date(anchorDate + 'T00:00:00'));
    const diffWeeks = Math.round((actualWeekStart - anchorWeekStart) / 604800000);
    return (((anchorWeek - 1) + diffWeeks) % 40 + 40) % 40 + 1;
  }

  function getTemplateForEmployeeDate(employee, date) {
    const type = getRotationTypeById(employee?.rotationTypeId || state.settings.activeRotationTypeId || 'standard');
    const weeks = sanitizeRotationWeeks(type?.weeks || createDefaultRotationWeeks());
    const weekNumber = getRotationWeekNumberForEmployee(date, employee);
    const weekday = isoWeekdayIndex(date);
    return weeks[weekNumber - 1]?.days?.[weekday] || createDefaultRotationWeeks()[0].days[weekday];
  }

  function buildEmployeeTemplateEntry(employee, date) {
    const template = getTemplateForEmployeeDate(employee, date);
    return {
      date,
      employeeId: employee.id,
      plannedType: template.templateType,
      status: template.templateType === 'frv' ? 'open' : 'planned',
      actualType: template.templateType === 'frv' ? 'frv_open' : template.templateType,
      serviceNumber: template.serviceNumber || '',
      startTime: template.defaultStartTime || '',
      endTime: template.defaultEndTime || '',
      breakMinutes: Number(template.defaultBreakMinutes || 0),
      frvMinutes: Number(state.settings.frvPlaceholderMinutes || 468),
      paidMinutes: Number(template.defaultPaidMinutes || 0),
      usesTemplatePaidMinutes: true,
      isFahrdienst: state.settings.isFahrdienst,
      isHoliday: isBrandenburgHoliday(date),
      isVorfesttag: false,
      isSplitShift: false,
      isVacation: false,
      isSick: false,
      isBetriebsversammlung: false,
      isVoluntarySwap: false,
      isExtraWork: false,
      isFinal: false,
      orderedOvertimeHours: 0,
      factorValue: 0,
      vacationDays: 0,
      sickDays: 0,
      parts: [],
      notes: template.notes || '',
      betriebsversammlungTravelAmount: 0
    };
  }

  function getEmployeeDayEntry(employeeId, date) {
    ensureEmployeeCollections();
    return state.employeeDayEntries?.[employeeId]?.[date] || null;
  }

  function setEmployeeDayEntry(employeeId, date, entry) {
    ensureEmployeeCollections();
    if (!state.employeeDayEntries[employeeId]) state.employeeDayEntries[employeeId] = {};
    state.employeeDayEntries[employeeId][date] = { ...entry, employeeId, date };
  }

  function removeEmployeeDayEntryIfAssignment(employeeId, date, serviceNumber) {
    const entry = getEmployeeDayEntry(employeeId, date);
    if (!entry) return;
    if (String(entry.assignmentSource || '') === 'daily_services' && String(entry.serviceNumber || '') === String(serviceNumber || '')) {
      delete state.employeeDayEntries[employeeId][date];
    }
  }

  function getEffectiveEmployeeEntry(employee, date) {
    const planned = buildEmployeeTemplateEntry(employee, date);
    const saved = getEmployeeDayEntry(employee.id, date);
    return { ...planned, ...(saved || {}), date, employeeId: employee.id, plannedEntry: planned };
  }

  function isAbsenceEntry(entry) {
    return !!entry && (entry.isVacation || entry.isSick || entry.actualType === 'vacation' || entry.actualType === 'sick' || entry.actualType === 'free');
  }

  function dailyDutyKey(employee, plannedEntry) {
    const nr = plannedEntry.serviceNumber || `ohne-nr-${employee.id}`;
    return `${employee.id}__${nr}`;
  }

  function serviceTimeText(entry) {
    const splitParts = (entry.parts || []).filter(p => p.startTime && p.endTime);
    if (splitParts.length) return splitParts.map((p, idx) => `${idx + 1}. ${p.startTime}–${p.endTime}`).join(' / ');
    if (entry.startTime && entry.endTime) return `${entry.startTime}–${entry.endTime}`;
    if (isOpenFrvWithoutAssignment(entry)) return `FRV ${formatMinutes(entry.frvMinutes || state.settings.frvPlaceholderMinutes || 468)}`;
    return '—';
  }

  function getDailyAssignmentsForDate(date) {
    ensureEmployeeCollections();
    if (!state.dailyAssignments[date]) state.dailyAssignments[date] = {};
    return state.dailyAssignments[date];
  }

  function buildDailyData(date) {
    ensureEmployeeCollections();
    const employees = state.employees.filter(emp => emp.active !== false);
    const assignments = getDailyAssignmentsForDate(date);
    const assignedReplacementIds = new Set(Object.values(assignments).map(a => String(a.replacementEmployeeId || '')).filter(Boolean));
    const rows = [];
    const frv = [];

    employees.forEach((employee) => {
      const plannedEntry = buildEmployeeTemplateEntry(employee, date);
      const effectiveEntry = getEffectiveEmployeeEntry(employee, date);
      const plannedIsService = plannedEntry.plannedType === 'fixed' || plannedEntry.plannedType === 'holiday_work' || !!plannedEntry.serviceNumber;
      const effectiveIsFrv = (effectiveEntry.actualType === 'frv_open' || effectiveEntry.plannedType === 'frv') && !isAbsenceEntry(effectiveEntry);
      if (effectiveIsFrv && !assignedReplacementIds.has(String(employee.id))) frv.push({ employee, entry: effectiveEntry });
      if (plannedIsService) {
        const key = dailyDutyKey(employee, plannedEntry);
        rows.push({ key, employee, plannedEntry, effectiveEntry, assignment: assignments[key] || null, isAbsent: isAbsenceEntry(effectiveEntry) });
      }
    });
    rows.sort((a,b) => String(a.plannedEntry.startTime || '').localeCompare(String(b.plannedEntry.startTime || '')) || String(a.plannedEntry.serviceNumber || '').localeCompare(String(b.plannedEntry.serviceNumber || '')));
    return { employees, rows, frv };
  }

  function renderDailySummary(date, data) {
    const el = document.getElementById('dailySummary');
    if (!el) return;
    const open = data.rows.filter(r => r.isAbsent && !r.assignment?.replacementEmployeeId).length;
    const covered = data.rows.filter(r => r.isAbsent && r.assignment?.replacementEmployeeId).length;
    el.innerHTML = `
      <article class="card metric"><span>Datum</span><strong>${escapeHtml(formatDateShort(date))}</strong><small>${escapeHtml(formatDateLong(date))}</small></article>
      <article class="card metric"><span>Dienste</span><strong>${data.rows.length}</strong><small>laut Umlaufzuordnung</small></article>
      <article class="card metric"><span>Offen</span><strong>${open}</strong><small>Ausfall ohne Vertretung</small></article>
      <article class="card metric"><span>FRV verfügbar</span><strong>${data.frv.length}</strong><small>nicht bereits zugeteilt</small></article>
    `;
  }

  function renderDailyFrvList(data) {
    const el = document.getElementById('dailyFrvList');
    if (!el) return;
    if (!data.frv.length) {
      el.innerHTML = '<strong>FRV verfügbar:</strong> keine freien FRV-Fahrer im gewählten Tag.';
      el.classList.add('warning');
      return;
    }
    el.classList.remove('warning');
    el.innerHTML = '<strong>FRV verfügbar:</strong> ' + data.frv.map(x => escapeHtml(getEmployeeDisplayName(x.employee))).join(' · ');
  }

  function renderDailyDutyRows(date, data) {
    const tbody = document.getElementById('dailyDutyTableBody');
    if (!tbody) return;
    if (!data.rows.length) {
      tbody.innerHTML = '<tr><td colspan="6">Für diesen Tag wurden noch keine Dienste aus Fahrer-Umläufen gefunden. Lege unten Fahrer mit Umlaufart und aktueller Woche an.</td></tr>';
      return;
    }
    const frvOptions = (selected = '') => '<option value="">nicht eingeteilt</option>' + data.frv.map(({ employee }) => `<option value="${escapeHtml(employee.id)}"${String(employee.id) === String(selected) ? ' selected' : ''}>${escapeHtml(getEmployeeDisplayName(employee))}</option>`).join('');
    tbody.innerHTML = data.rows.map((row) => {
      const service = row.plannedEntry.serviceNumber || 'ohne Dienstnr.';
      const replacement = row.assignment?.replacementEmployeeId || '';
      const replacementEmployee = replacement ? getEmployeeById(replacement) : null;
      const status = row.isAbsent
        ? (replacementEmployee ? `Vertreten durch ${escapeHtml(getEmployeeDisplayName(replacementEmployee))}` : 'Ausfall · Vertretung offen')
        : 'planmäßig besetzt';
      const statusClass = row.isAbsent ? (replacementEmployee ? 'ok' : 'warning') : 'ok';
      const absenceValue = row.effectiveEntry.isVacation || row.effectiveEntry.actualType === 'vacation'
        ? 'vacation'
        : (row.effectiveEntry.isSick || row.effectiveEntry.actualType === 'sick' ? 'sick' : (row.effectiveEntry.actualType === 'free' ? 'free' : 'none'));
      return `
        <tr data-duty-key="${escapeHtml(row.key)}" data-employee-id="${escapeHtml(row.employee.id)}" data-service-number="${escapeHtml(service)}">
          <td><strong>Dienst ${escapeHtml(service)}</strong><br><small>${escapeHtml(actualLabel(row.plannedEntry.actualType || row.plannedEntry.plannedType))}</small></td>
          <td>${escapeHtml(serviceTimeText(row.plannedEntry))}<br><small>bezahlt: ${escapeHtml(formatMinutes(calculatePaidMinutes(row.plannedEntry)))}</small></td>
          <td>${escapeHtml(getEmployeeDisplayName(row.employee))}<br><select class="daily-absence-select"><option value="none"${absenceValue==='none'?' selected':''}>anwesend</option><option value="sick"${absenceValue==='sick'?' selected':''}>krank</option><option value="vacation"${absenceValue==='vacation'?' selected':''}>Urlaub</option><option value="free"${absenceValue==='free'?' selected':''}>frei/sonstiges</option></select></td>
          <td><span class="badge ${statusClass}">${status}</span></td>
          <td><select class="daily-replacement-select" ${row.isAbsent ? '' : 'disabled'}>${frvOptions(replacement)}</select></td>
          <td><button type="button" class="secondary daily-assign-btn" ${row.isAbsent ? '' : 'disabled'}>Übernehmen</button></td>
        </tr>`;
    }).join('');
  }

  function renderDailyEmployees() {
    ensureEmployeeCollections();
    const rotationSelect = document.getElementById('dailyEmployeeRotationType');
    if (rotationSelect) rotationSelect.innerHTML = rotationTypeOptionsHtml(rotationSelect.value || state.settings.activeRotationTypeId || 'standard');
    const tbody = document.getElementById('dailyEmployeeList');
    if (!tbody) return;
    if (!state.employees.length) {
      tbody.innerHTML = '<tr><td colspan="7">Noch keine Fahrer angelegt.</td></tr>';
      return;
    }
    tbody.innerHTML = state.employees.map((emp) => {
      const type = getRotationTypeById(emp.rotationTypeId);
      return `<tr data-employee-id="${escapeHtml(emp.id)}">
        <td>${escapeHtml(emp.name || '—')}</td>
        <td>${escapeHtml(emp.personalnummer || '—')}</td>
        <td>${escapeHtml(type?.name || 'Standard-Umlauf')}</td>
        <td>Woche ${Number(emp.currentRotationWeek || 1)}</td>
        <td>${escapeHtml(emp.currentRotationAnchorDate || '—')}</td>
        <td><span class="badge ${emp.active === false ? 'warning' : 'ok'}">${emp.active === false ? 'inaktiv' : 'aktiv'}</span></td>
        <td><button type="button" class="secondary daily-edit-employee">Bearbeiten</button> <button type="button" class="danger daily-delete-employee">Löschen</button></td>
      </tr>`;
    }).join('');
  }

  function renderDailyServices() {
    if (!canViewTab('daily')) return;
    ensureEmployeeCollections();
    const dateInput = document.getElementById('dailyDate');
    if (!dateInput) return;
    if (!dateInput.value) dateInput.value = currentDate();
    const date = dateInput.value;
    const data = buildDailyData(date);
    renderDailySummary(date, data);
    renderDailyFrvList(data);
    renderDailyDutyRows(date, data);
    renderDailyEmployees();
  }

  function clearDailyEmployeeForm() {
    ['dailyEmployeeId','dailyEmployeeName','dailyEmployeePersonalnummer'].forEach(id => setVal(id, ''));
    setVal('dailyEmployeeRotationType', state.settings.activeRotationTypeId || 'standard');
    setVal('dailyEmployeeCurrentWeek', state.settings.currentRotationWeek || 1);
    setVal('dailyEmployeeAnchorDate', state.settings.currentRotationAnchorDate || currentDate());
    const active = document.getElementById('dailyEmployeeActive');
    if (active) active.checked = true;
  }

  function saveDailyEmployee(e) {
    e.preventDefault();
    if (!canEditDays() && currentRole() !== 'dispatch') return showRoleDenied('Fahrer speichern');
    ensureEmployeeCollections();
    const idInput = document.getElementById('dailyEmployeeId');
    const existingId = idInput?.value || '';
    const personalnummer = document.getElementById('dailyEmployeePersonalnummer')?.value.trim() || '';
    const name = document.getElementById('dailyEmployeeName')?.value.trim() || '';
    if (!name && !personalnummer) {
      alert('Bitte mindestens Name oder Personalnummer eintragen.');
      return;
    }
    const id = existingId || makeId('fahrer');
    const employee = {
      id,
      name,
      personalnummer,
      rotationTypeId: document.getElementById('dailyEmployeeRotationType')?.value || state.settings.activeRotationTypeId || 'standard',
      currentRotationWeek: Math.min(40, Math.max(1, Number(document.getElementById('dailyEmployeeCurrentWeek')?.value || 1))),
      currentRotationAnchorDate: document.getElementById('dailyEmployeeAnchorDate')?.value || currentDate(),
      active: !!document.getElementById('dailyEmployeeActive')?.checked
    };
    const idx = state.employees.findIndex(emp => String(emp.id) === String(id) || (personalnummer && String(emp.personalnummer) === personalnummer));
    if (idx >= 0) state.employees[idx] = { ...state.employees[idx], ...employee, id: state.employees[idx].id };
    else state.employees.push(employee);
    clearDailyEmployeeForm();
    saveState();
    renderDailyServices();
  }

  function handleDailyEmployeeClick(e) {
    const row = e.target.closest('tr[data-employee-id]');
    if (!row) return;
    const emp = getEmployeeById(row.dataset.employeeId);
    if (!emp) return;
    if (e.target.closest('.daily-edit-employee')) {
      setVal('dailyEmployeeId', emp.id);
      setVal('dailyEmployeeName', emp.name || '');
      setVal('dailyEmployeePersonalnummer', emp.personalnummer || '');
      setVal('dailyEmployeeRotationType', emp.rotationTypeId || state.settings.activeRotationTypeId || 'standard');
      setVal('dailyEmployeeCurrentWeek', emp.currentRotationWeek || 1);
      setVal('dailyEmployeeAnchorDate', emp.currentRotationAnchorDate || currentDate());
      const active = document.getElementById('dailyEmployeeActive');
      if (active) active.checked = emp.active !== false;
    }
    if (e.target.closest('.daily-delete-employee')) {
      if (!confirm(`${getEmployeeDisplayName(emp)} wirklich löschen?`)) return;
      state.employees = state.employees.filter(x => String(x.id) !== String(emp.id));
      delete state.employeeDayEntries[emp.id];
      Object.values(state.dailyAssignments || {}).forEach((daily) => {
        Object.keys(daily || {}).forEach((key) => {
          if (String(daily[key].replacementEmployeeId || '') === String(emp.id)) delete daily[key];
        });
      });
      saveState();
      renderDailyServices();
    }
  }

  function setOriginalAbsenceFromDaily(row, absence) {
    const employee = getEmployeeById(row.dataset.employeeId);
    if (!employee) return;
    const date = document.getElementById('dailyDate')?.value || currentDate();
    const planned = buildEmployeeTemplateEntry(employee, date);
    if (absence === 'none') {
      const existing = getEmployeeDayEntry(employee.id, date);
      if (existing && ['vacation','sick','free'].includes(existing.actualType)) delete state.employeeDayEntries[employee.id][date];
      return;
    }
    const entry = { ...planned, status: 'planned', startTime: '', endTime: '', breakMinutes: 0, parts: [], isFahrdienst: false, isSplitShift: false };
    entry.actualType = absence === 'free' ? 'free' : absence;
    entry.isVacation = absence === 'vacation';
    entry.isSick = absence === 'sick';
    entry.vacationDays = entry.isVacation ? 1 : 0;
    entry.sickDays = entry.isSick ? 1 : 0;
    entry.notes = absence === 'vacation' ? 'Urlaub laut Tagesdienste' : (absence === 'sick' ? 'Krank laut Tagesdienste' : 'Abwesend laut Tagesdienste');
    setEmployeeDayEntry(employee.id, date, entry);
  }

  function assignDailyReplacement(row) {
    const date = document.getElementById('dailyDate')?.value || currentDate();
    const key = row.dataset.dutyKey;
    const original = getEmployeeById(row.dataset.employeeId);
    const replacementId = row.querySelector('.daily-replacement-select')?.value || '';
    if (!original || !key) return;
    const planned = buildEmployeeTemplateEntry(original, date);
    const assignments = getDailyAssignmentsForDate(date);
    const previousId = assignments[key]?.replacementEmployeeId;
    if (previousId && previousId !== replacementId) removeEmployeeDayEntryIfAssignment(previousId, date, planned.serviceNumber);
    if (!replacementId) {
      delete assignments[key];
      saveState();
      renderDailyServices();
      return;
    }
    const replacement = getEmployeeById(replacementId);
    if (!replacement) return;
    const assigned = {
      ...planned,
      employeeId: replacement.id,
      status: 'assigned',
      actualType: planned.isSplitShift ? 'split_shift' : 'fixed',
      isVacation: false,
      isSick: false,
      isFinal: false,
      assignmentSource: 'daily_services',
      assignmentOriginalEmployeeId: original.id,
      notes: `Vertretung für ${getEmployeeDisplayName(original)}`
    };
    setEmployeeDayEntry(replacement.id, date, assigned);
    assignments[key] = {
      originalEmployeeId: original.id,
      replacementEmployeeId: replacement.id,
      serviceNumber: planned.serviceNumber || '',
      updatedAt: new Date().toISOString()
    };
    saveState();
    renderDailyServices();
  }

  function handleDailyDutyChange(e) {
    const row = e.target.closest('tr[data-duty-key]');
    if (!row) return;
    if (e.target.classList.contains('daily-absence-select')) {
      setOriginalAbsenceFromDaily(row, e.target.value);
      saveState();
      renderDailyServices();
    }
  }

  function handleDailyDutyClick(e) {
    const row = e.target.closest('tr[data-duty-key]');
    if (!row) return;
    if (e.target.closest('.daily-assign-btn')) assignDailyReplacement(row);
  }

  function renderDayForm() {
    fillSelect('plannedType', TEMPLATE_TYPES, TEMPLATE_TYPES.map(templateLabel));
    fillSelect('dayStatus', STATUSES, STATUSES.map(statusLabel));
    fillSelect('actualType', ACTUAL_TYPES, ACTUAL_TYPES.map(actualLabel));
    fillSelect('dayBreak', [0,30,40], ['0 Min','30 Min','40 Min']);
    const dateInput = document.getElementById('dayDate');
    if (!dateInput.value) dateInput.value = currentDate();
    const dayMonthInput = document.getElementById('daysMonth');
    if (dayMonthInput && !dayMonthInput.value) dayMonthInput.value = dateToMonth(dateInput.value);
    const entry = ensureEntry(dateInput.value);
    const holidayName = getHolidayName(entry.date);
    if (holidayName && !entry.isHoliday) {
      entry.isHoliday = true;
      saveState();
    }
    document.getElementById('plannedType').value = entry.plannedType || 'fixed';
    document.getElementById('dayStatus').value = entry.status || 'planned';
    document.getElementById('actualType').value = entry.actualType || 'fixed';
    document.getElementById('dayServiceNumber').value = entry.serviceNumber || '';
    document.getElementById('dayStart').value = entry.startTime || '';
    document.getElementById('dayEnd').value = entry.endTime || '';
    document.getElementById('dayBreak').value = String(entry.breakMinutes || 0);
    document.getElementById('frvMinutes').value = formatMinutes(entry.frvMinutes || state.settings.frvPlaceholderMinutes);
    document.getElementById('orderedOvertimeHours').value = String(entry.orderedOvertimeHours || 0);
    document.getElementById('dayFactor').value = String(entry.factorValue || 0);
    document.getElementById('dayVacationDays').value = String(entry.vacationDays || 0);
    document.getElementById('daySickDays').value = String(entry.sickDays || 0);
    document.getElementById('dayRangeFrom').value = entry.rangeFrom || entry.date;
    document.getElementById('dayRangeTo').value = entry.rangeTo || entry.date;
    const quickFrom = document.getElementById('quickAbsenceFrom');
    const quickTo = document.getElementById('quickAbsenceTo');
    if (quickFrom && !quickFrom.value) quickFrom.value = entry.date;
    if (quickTo && !quickTo.value) quickTo.value = entry.date;
    const copyFrom = document.getElementById('copyDayRangeFrom');
    const copyTo = document.getElementById('copyDayRangeTo');
    if (copyFrom) copyFrom.value = entry.date;
    if (copyTo) copyTo.value = entry.date;
    const copyOnlyFrv = document.getElementById('copyDayOnlyFrvDays');
    if (copyOnlyFrv) copyOnlyFrv.checked = isFrvTargetDay(entry.date);
    document.getElementById('dayBvTravel').value = String(entry.betriebsversammlungTravelAmount || 0);
    document.getElementById('dayNotes').value = entry.notes || '';
    document.getElementById('flagFahrdienst').checked = !!entry.isFahrdienst;
    document.getElementById('flagHoliday').checked = holidayName ? true : !!entry.isHoliday;
    document.getElementById('flagVorfesttag').checked = !!entry.isVorfesttag;
    document.getElementById('flagSplit').checked = !!entry.isSplitShift;
    document.getElementById('flagVacation').checked = !!entry.isVacation;
    document.getElementById('flagSick').checked = !!entry.isSick;
    document.getElementById('flagBv').checked = !!entry.isBetriebsversammlung;
    document.getElementById('flagSwap').checked = !!entry.isVoluntarySwap;
    const extraFlag = document.getElementById('flagExtraWork');
    if (extraFlag) extraFlag.checked = !!entry.isExtraWork || entry.actualType === 'extra_work';
    document.getElementById('flagFinal').checked = !!entry.isFinal;
    const holidayInfo = document.getElementById('dayHolidayInfo');
    if (holidayInfo) {
      if (holidayName) {
        holidayInfo.style.display = 'inline-flex';
        holidayInfo.textContent = `Gesetzlicher Feiertag in Brandenburg: ${holidayName}`;
      } else {
        holidayInfo.style.display = 'none';
        holidayInfo.textContent = '';
      }
    }
    setSplitInlineValues(entry.parts || []);
    updateSplitFieldsVisibility();
    syncDayPaidPreview();
    renderDaysCalendar();
    const preview = document.getElementById('dayPreview'); preview.innerHTML='';
    const paidMinutes = calculatePaidMinutes(entry);
    [
      ['Datum', formatDateLong(entry.date)],
      ['Berechnete Umlaufwoche', `Woche ${getRotationWeekNumberForDate(entry.date)}`],
      ['Dienstnummer', entry.serviceNumber || '—'],
      ['Geplant', templateLabel(entry.plannedType)],
      ['Tatsächlich', actualLabel(entry.actualType)],
      ['Bezahlte Zeit', formatMinutes(paidMinutes)],
      ['Nachtstunden', fixed2(eligibleHoursNight(entry))],
      ['Sonntagsstunden', fixed2(eligibleHoursSunday(entry))],
      ['Samstagsstunden ab 13 Uhr', fixed2(eligibleHoursSaturday(entry))],
      ['Feiertag', holidayName ? holidayName : (entry.isHoliday ? 'Ja' : 'Nein')],
      ['Vorfesttag', entry.isVorfesttag ? 'Ja' : 'Nein'],
      ['Zusatzdienst / Einspringen', (entry.isExtraWork || entry.actualType === 'extra_work') ? 'Ja' : 'Nein'],
      ['Freier Tag getauscht', entry.isVoluntarySwap ? 'Ja' : 'Nein'],
      ['Zeitraum', (entry.rangeFrom || entry.date) + ((entry.rangeTo || entry.date) !== (entry.rangeFrom || entry.date) ? ' bis ' + (entry.rangeTo || entry.date) : '')]
    ].forEach(([a,b])=>preview.appendChild(dataRow(a,b)));
    updateSwapDayPreview();
  }

  function renderDaysCalendar() {
    const monthInput = document.getElementById('daysMonth');
    const calendar = document.getElementById('daysCalendar');
    const selectedDate = document.getElementById('dayDate')?.value || currentDate();
    if (!monthInput || !calendar) return;
    if (!monthInput.value) monthInput.value = dateToMonth(selectedDate);
    const month = monthInput.value;
    const first = monthStart(month);
    const last = monthEnd(month);
    const firstWeekday = (first.getDay() + 6) % 7;
    const headers = WEEKDAYS.map(day => `<div>${day.slice(0,2)}</div>`).join('');
    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push('<div class="calendar-empty"></div>');
    for (let day = 1; day <= last.getDate(); day++) {
      const iso = formatIsoDate(first.getFullYear(), first.getMonth() + 1, day);
      const holidayName = getHolidayName(iso);
      const entry = state.dayEntries[iso];
      const plannedTemplate = getTemplateForDate(iso);
      const typeLabel = entry ? actualLabel(entry.actualType || entry.plannedType) : templateLabel(plannedTemplate.templateType);
      const service = entry?.serviceNumber || plannedTemplate.serviceNumber || '';
      const note = holidayName || service || '';
      const classes = ['calendar-day'];
      if (iso === selectedDate) classes.push('selected');
      if (iso === currentDate()) classes.push('today');
      if (holidayName) classes.push('holiday');
      cells.push(`
        <button type="button" class="${classes.join(' ')}" data-calendar-date="${iso}">
          <div class="calendar-day-top">
            <span class="calendar-day-number">${day}</span>
            ${service ? `<span class="calendar-day-service">${escapeHtml(service)}</span>` : ''}
          </div>
          <div class="calendar-day-type">${escapeHtml(typeLabel)}</div>
          ${holidayName ? `<span class="holiday-tag">${escapeHtml(holidayName)}</span>` : ''}
          ${!holidayName && service ? `<div class="calendar-day-note">Dienst ${escapeHtml(service)}</div>` : ''}
        </button>`);
    }
    calendar.innerHTML = `
      <div class="month-calendar">
        <div class="month-calendar-head">${headers}</div>
        <div class="month-calendar-grid">${cells.join('')}</div>
      </div>`;
  }


  function renderDriverDaysView(selectedDate = '') {
    const dateInput = document.getElementById('dayDate');
    const monthInput = document.getElementById('daysMonth');
    const date = selectedDate || dateInput?.value || currentDate();
    if (dateInput) dateInput.value = date;
    if (monthInput && !monthInput.value) monthInput.value = dateToMonth(date);
    renderDaysCalendar();
    renderDriverDayInfo(date);
  }

  function renderDriverDayInfo(dateStr) {
    const info = document.getElementById('driverDayInfo');
    if (!info) return;
    const template = getTemplateForDate(dateStr);
    const templateEntry = template ? buildTemplateDayEntry(dateStr) : null;
    const saved = state.dayEntries[dateStr];
    const entry = { ...(templateEntry || {}), ...(saved || {}), date: dateStr };
    const holidayName = getHolidayName(dateStr);
    const isFree = (entry.actualType || entry.plannedType) === 'free' || template?.templateType === 'free';
    const splitParts = (entry.parts || []).filter(p => p.startTime && p.endTime);
    const timeText = splitParts.length
      ? splitParts.map((p, idx) => `${idx + 1}. Teil: ${p.startTime}–${p.endTime}`).join(' / ')
      : (entry.startTime && entry.endTime ? `${entry.startTime}–${entry.endTime}` : '—');
    const breakText = splitParts.length
      ? splitParts.map((p, idx) => `Pause ${idx + 1}: ${Number(p.breakMinutes || 0)} Min`).join(' / ')
      : (entry.breakMinutes != null ? `${entry.breakMinutes} Min` : '—');
    const rows = [
      ['Datum', formatDateLong(dateStr)],
      ['Umlaufwoche', 'Woche ' + getRotationWeekNumberForDate(dateStr)],
      ['Status', statusLabel(entry.status || (template?.templateType === 'frv' ? 'open' : 'planned'))],
      ['Dienst', isFree ? 'frei' : (entry.serviceNumber || '—')],
      ['Typ', actualLabel(entry.actualType || entry.plannedType || template?.templateType || 'free')],
      ['Zeit', timeText],
      ['Pause', breakText],
      ['Feiertag', holidayName || (entry.isHoliday ? 'Ja' : 'Nein')],
      ['Notiz', entry.notes || '—']
    ];
    info.hidden = false;
    info.innerHTML = `<div class="card-head split"><div><h3>Ausgewählter Tag</h3><p>Nur-Lesen-Ansicht für Fahrer.</p></div><span class="badge">${escapeHtml(roleLabel())}</span></div>`;
    rows.forEach(([a,b]) => info.appendChild(dataRow(a,b)));
  }

  function selectCalendarDate(dateStr) {
    const dateInput = document.getElementById('dayDate');
    const monthInput = document.getElementById('daysMonth');
    if (dateInput) dateInput.value = dateStr;
    if (monthInput) monthInput.value = dateToMonth(dateStr);
    if (canEditDays()) renderDayForm();
    else renderDriverDaysView(dateStr);
  }

  function setSplitInlineValues(parts = []) {
    const p1 = parts[0] || {};
    const p2 = parts[1] || {};
    const values = {
      splitPartStart1: p1.startTime || '',
      splitPartEnd1: p1.endTime || '',
      splitPartBreak1: String(Number(p1.breakMinutes || 0)),
      splitPartStart2: p2.startTime || '',
      splitPartEnd2: p2.endTime || '',
      splitPartBreak2: String(Number(p2.breakMinutes || 0))
    };
    Object.entries(values).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    });
  }

  function readSplitInlineParts(options = {}) {
    const parts = [];
    [1, 2].forEach((n) => {
      const start = document.getElementById(`splitPartStart${n}`)?.value || '';
      const end = document.getElementById(`splitPartEnd${n}`)?.value || '';
      const brk = Number(document.getElementById(`splitPartBreak${n}`)?.value || 0);
      if (options.completeOnly) {
        if (start && end) parts.push({ startTime: start, endTime: end, breakMinutes: brk });
      } else if (start || end || brk) {
        parts.push({ startTime: start, endTime: end, breakMinutes: brk });
      }
    });
    return parts;
  }

  function hasSplitInlineValues() {
    return readSplitInlineParts().some(p => p.startTime || p.endTime || Number(p.breakMinutes || 0) > 0);
  }

  function updateSplitFieldsVisibility() {
    const box = document.getElementById('splitInlineBox');
    if (!box) return;
    const actualType = document.getElementById('actualType')?.value || 'fixed';
    const flag = !!document.getElementById('flagSplit')?.checked;
    box.hidden = !(flag || actualType === 'split_shift' || hasSplitInlineValues());
  }

  function onSplitInlineInput() {
    if (!canEditDays()) return;
    if (hasSplitInlineValues()) {
      const actualTypeEl = document.getElementById('actualType');
      const flagSplitEl = document.getElementById('flagSplit');
      const statusEl = document.getElementById('dayStatus');
      if (actualTypeEl) actualTypeEl.value = 'split_shift';
      if (flagSplitEl) flagSplitEl.checked = true;
      if (statusEl && ['planned', 'open'].includes(statusEl.value)) statusEl.value = 'assigned';
    }
    updateSplitFieldsVisibility();
    syncDayPaidPreview();
  }

  function clearSplitInlineParts() {
    if (!canEditDays()) return showRoleDenied('Geteilten Dienst leeren');
    ['splitPartStart1','splitPartEnd1','splitPartStart2','splitPartEnd2'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    ['splitPartBreak1','splitPartBreak2'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '0';
    });
    const flag = document.getElementById('flagSplit');
    if (flag) flag.checked = false;
    const actual = document.getElementById('actualType');
    if (actual?.value === 'split_shift') actual.value = 'fixed';
    updateSplitFieldsVisibility();
    syncDayPaidPreview();
  }

  function monthDateRange(month) {
    const lastDate = new Date(Number(month.slice(0,4)), Number(month.slice(5,7)), 0).getDate();
    const dates = [];
    for (let day = 1; day <= lastDate; day += 1) {
      dates.push(`${month}-${String(day).padStart(2,'0')}`);
    }
    return dates;
  }

  function monthDateRangeForIcs(month) {
    const today = currentDate();
    const lastDate = new Date(Number(month.slice(0,4)), Number(month.slice(5,7)), 0).getDate();
    let startDay = 1;
    if (month === today.slice(0,7)) startDay = Number(today.slice(8,10)) + 1;
    const dates = [];
    for (let day = startDay; day <= lastDate; day += 1) {
      dates.push(`${month}-${String(day).padStart(2,'0')}`);
    }
    return dates;
  }

  function buildTemplateExportEntry(date) {
    const template = getTemplateForDate(date);
    if (!template) return null;
    return {
      date,
      plannedType: template.templateType,
      actualType: template.templateType === 'frv' ? 'frv_open' : template.templateType,
      serviceNumber: template.serviceNumber || '',
      startTime: template.defaultStartTime || '',
      endTime: template.defaultEndTime || '',
      breakMinutes: Number(template.defaultBreakMinutes || 0),
      frvMinutes: Number(state.settings.frvPlaceholderMinutes || 468),
      isFahrdienst: state.settings.isFahrdienst,
      isHoliday: isBrandenburgHoliday(date),
      isVorfesttag: false,
      isSplitShift: false,
      isVacation: false,
      isSick: false,
      isBetriebsversammlung: false,
      notes: template.notes || ''
    };
  }

  function buildCalendarExportEntries(month) {
    const dates = monthDateRangeForIcs(month);
    const entries = [];
    dates.forEach((date) => {
      const saved = state.dayEntries[date];
      if (saved) {
        const effectiveSaved = normalizeFrvActualAssignment({ ...saved });
        const savedEntries = calendarEntriesForDay(effectiveSaved);
        if (savedEntries.length) {
          entries.push(...savedEntries);
          return;
        }
      }
      const template = getTemplateForDate(date);
      if (!template) return;
      const type = template.templateType || 'fixed';
      const serviceNumber = (template.serviceNumber || '').trim();
      const notes = template.notes || '';
      if (type === 'free') {
        entries.push({ type:'allDay', date, title:'Frei', description: notes || '', location:'' });
        return;
      }
      if (type === 'frv') {
        entries.push({ type:'allDay', date, title:'FRV', description: notes || '', location:'' });
        return;
      }
      const startTime = template.defaultStartTime || '';
      const endTime = template.defaultEndTime || '';
      const breakMinutes = Number(template.defaultBreakMinutes || 0);
      const paidMinutes = calculateTemplatePaidMinutes(template);
      const title = serviceNumber ? `Arbeit Dienst ${serviceNumber}` : 'Arbeit Dienst';
      const descriptionLines = [];
      if (serviceNumber) descriptionLines.push(`Dienstnummer: ${serviceNumber}`);
      if (startTime && endTime) descriptionLines.push(`Zeit: ${startTime}–${endTime}`);
      if (breakMinutes > 0) descriptionLines.push(`Pause: ${breakMinutes} Minuten`);
      if (paidMinutes > 0) descriptionLines.push(`Bezahlte Zeit: ${formatMinutes(paidMinutes)}`);
      if (notes) descriptionLines.push(`Notiz: ${notes}`);
      if (startTime && endTime) {
        entries.push({ type:'timed', date, startTime, endTime, title, description: descriptionLines.join('\\n'), location: '' });
      } else {
        entries.push({ type:'allDay', date, title, description: descriptionLines.join('\n'), location:'' });
      }
    });
    return entries;
  }

  function calendarEntriesForDay(entry) {
    if (!entry) return [];
    if (entry.actualType === 'free' || entry.plannedType === 'free') {
      return [{ type:'allDay', date: entry.date, title:'Frei', description: buildCalendarDescription(entry), location: '' }];
    }
    if (entry.isVacation || entry.actualType === 'vacation') {
      return [{ type:'allDay', date: entry.date, title:'Urlaub', description: buildCalendarDescription(entry), location: '' }];
    }
    if (entry.isSick || entry.actualType === 'sick') {
      return [{ type:'allDay', date: entry.date, title:'Krank', description: buildCalendarDescription(entry), location: '' }];
    }
    if (isOpenFrvWithoutAssignment(entry)) {
      return [{ type:'allDay', date: entry.date, title:'FRV', description: buildCalendarDescription(entry), location: '' }];
    }
    if (entry.isSplitShift || entry.actualType === 'split_shift') {
      const parts = (entry.parts || []).filter(p => p.startTime && p.endTime);
      if (!parts.length) return [];
      return parts.map((part, idx) => ({
        type:'timed',
        date: entry.date,
        startTime: part.startTime,
        endTime: part.endTime,
        title: buildCalendarTitle(entry, `Teil ${idx+1}`),
        description: buildCalendarDescription(entry, part, idx+1),
        location: ''
      }));
    }
    if (entry.startTime && entry.endTime) {
      return [{
        type:'timed',
        date: entry.date,
        startTime: entry.startTime,
        endTime: entry.endTime,
        title: buildCalendarTitle(entry),
        description: buildCalendarDescription(entry),
        location: ''
      }];
    }
    return [];
  }

  function buildCalendarTitle(entry, suffix='') {
    const service = entry.serviceNumber ? ` ${entry.serviceNumber}` : '';
    let base = 'Arbeit Dienst';
    if (entry.isBetriebsversammlung || entry.actualType === 'betriebsversammlung') base = 'Arbeit Betriebsversammlung';
    else if (entry.isHoliday || entry.actualType === 'holiday_work') base = 'Arbeit Feiertagsdienst';
    else if (entry.isVorfesttag) base = 'Arbeit Vorfesttag';
    else if (entry.actualType === 'frv_assigned') base = 'Arbeit Dienst';
    else if (entry.isSplitShift || entry.actualType === 'split_shift') base = 'Arbeit Dienst';
    return `${base}${service}${suffix ? ' · ' + suffix : ''}`.trim();
  }

  function buildCalendarDescription(entry, part=null, partNumber=null) {
    const lines = [];
    if (entry.serviceNumber) lines.push(`Dienstnummer: ${entry.serviceNumber}`);
    if (part && part.startTime && part.endTime) lines.push(`Dienstteil ${partNumber}: ${part.startTime}–${part.endTime}`);
    else if (entry.startTime && entry.endTime) lines.push(`Zeit: ${entry.startTime}–${entry.endTime}`);
    if (part && part.breakMinutes != null && part.breakMinutes !== '') lines.push(`Pause Dienstteil ${partNumber}: ${Number(part.breakMinutes || 0)} Minuten`);
    else if (entry.breakMinutes != null && entry.breakMinutes !== '') lines.push(`Pause: ${entry.breakMinutes} Minuten`);
    const paid = calculatePaidMinutes(entry);
    if (paid > 0) lines.push(`Bezahlte Zeit: ${formatMinutes(paid)}`);
    if (entry.isFahrdienst) lines.push('Fahrdienst');
    if (entry.isHoliday) lines.push('Feiertag');
    if (entry.isVorfesttag) lines.push('Vorfesttag');
    if (entry.isBetriebsversammlung) lines.push('Betriebsversammlung');
    if (entry.isExtraWork || entry.actualType === 'extra_work') lines.push('Zusatzdienst / Einspringen');
    if (entry.isVoluntarySwap) lines.push('Freier Tag getauscht');
    if (entry.notes) lines.push(`Notiz: ${entry.notes}`);
    return lines.join('\n');
  }

  function icsEscape(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  function toIcsDate(dateStr) {
    return String(dateStr || '').replace(/-/g, '');
  }

  function addDaysIso(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function toIcsDateTime(dateStr, timeStr) {
    const parts = String(timeStr || '00:00').split(':');
    const h = String(parts[0] || '00').padStart(2, '0');
    const m = String(parts[1] || '00').padStart(2, '0');
    const sec = String(parts[2] || '00').padStart(2, '0');
    return `${toIcsDate(dateStr)}T${h}${m}${sec}`;
  }

  function buildMonthIcs(month) {
    const entries = buildCalendarExportEntries(month);
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ChatGPT//Dienstplanung und Gehalt//DE',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-TIMEZONE:Europe/Berlin',
      `X-WR-CALNAME:${icsEscape(state.settings.calendarName || 'Arbeit')}`,
      'BEGIN:VTIMEZONE',
      'TZID:Europe/Berlin',
      'X-LIC-LOCATION:Europe/Berlin',
      'BEGIN:DAYLIGHT',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0200',
      'TZNAME:CEST',
      'DTSTART:19700329T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'TZOFFSETFROM:+0200',
      'TZOFFSETTO:+0100',
      'TZNAME:CET',
      'DTSTART:19701025T030000',
      'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
      'END:STANDARD',
      'END:VTIMEZONE'
    ];
    const stamp = new Date();
    const dtstamp = `${stamp.getUTCFullYear()}${String(stamp.getUTCMonth()+1).padStart(2,'0')}${String(stamp.getUTCDate()).padStart(2,'0')}T${String(stamp.getUTCHours()).padStart(2,'0')}${String(stamp.getUTCMinutes()).padStart(2,'0')}${String(stamp.getUTCSeconds()).padStart(2,'0')}Z`;

    entries.forEach((entry, idx) => {
      lines.push('BEGIN:VEVENT');
      const uidBase = `${entry.date}-${entry.type}-${idx}`;
      lines.push(`UID:${icsEscape(uidBase)}@dienstplanung-gehalt`);
      lines.push(`DTSTAMP:${dtstamp}`);
      lines.push('SEQUENCE:0');
      lines.push('STATUS:CONFIRMED');
      if (entry.type === 'allDay') {
        lines.push(`DTSTART;VALUE=DATE:${toIcsDate(entry.date)}`);
        lines.push(`DTEND;VALUE=DATE:${toIcsDate(addDaysIso(entry.date, 1))}`);
      } else {
        lines.push(`DTSTART;TZID=Europe/Berlin:${toIcsDateTime(entry.date, entry.startTime)}`);
        lines.push(`DTEND;TZID=Europe/Berlin:${toIcsDateTime(entry.date, entry.endTime)}`);
        lines.push('TRANSP:OPAQUE');
        const reminder = Number(state.settings.reminderMinutes || 0);
        if (reminder > 0) {
          lines.push('BEGIN:VALARM');
          lines.push(`TRIGGER:-PT${Math.round(reminder)}M`);
          lines.push('ACTION:DISPLAY');
          lines.push(`DESCRIPTION:${icsEscape(entry.title)}`);
          lines.push('END:VALARM');
        }
      }
      lines.push(`SUMMARY:${icsEscape(entry.title)}`);
      if (entry.description) lines.push(`DESCRIPTION:${icsEscape(entry.description)}`);
      if (entry.location) lines.push(`LOCATION:${icsEscape(entry.location)}`);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return { entries, content: lines.join('\r\n') };
  }

  function exportMonthIcs(monthOverride = '') {
    const payrollMonthInput = document.getElementById('payrollMonth');
    const daysMonthInput = document.getElementById('daysMonth');
    const month = monthOverride || (daysMonthInput && daysMonthInput.value) || (payrollMonthInput && payrollMonthInput.value) || currentMonth();
    const result = buildMonthIcs(month);
    if (!result.entries.length) {
      alert('Für diesen Monat konnten keine Kalendereinträge erzeugt werden.');
      return;
    }
    const blob = new Blob([result.content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dienstkalender-${month}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderPayroll() {
    const input = document.getElementById('payrollMonth'); if (!input.value) input.value = currentMonth();
    const month = input.value; const payroll = calculatePayroll(month);
    document.getElementById('payrollBase').textContent = euro(payroll.effectiveTariff.fixedMonthlyBasePay);
    document.getElementById('payrollEarned').textContent = euro(payroll.earnedItems.reduce((s,x)=>s+x.amount,0));
    document.getElementById('payrollPaid').textContent = euro(payroll.payoutPreview);
    renderItemTable(document.getElementById('earnedTable'), payroll.earnedItems);
    renderItemTable(document.getElementById('paidTable'), payroll.paidItems);
    const gross = document.getElementById('grossBuckets'); gross.innerHTML='';
    [['Gesamtbrutto', payroll.gross.gesamt],['Steuerbrutto', payroll.gross.steuer],['SV-Brutto', payroll.gross.sv],['ZV-Brutto', payroll.gross.zv]].forEach(([a,b])=>gross.appendChild(dataRow(a,euro(b))));
    const ded = document.getElementById('deductionsTable'); ded.innerHTML='';
    ded.appendChild(dataRow('Berechnungsmodus', payroll.deductionMode));
    [
      ['Lohnsteuer', payroll.deductions.lohnsteuer],
      ['Kirchensteuer', payroll.deductions.kirchensteuer],
      ['Soli', payroll.deductions.soli],
      ['KV', payroll.deductions.kv],
      ['RV', payroll.deductions.rv],
      ['AV', payroll.deductions.av],
      ['PV', payroll.deductions.pv],
      ['KVBbg Umlage', payroll.deductions.kvbbgUmlage],
      ['KVBbg Zusatz', payroll.deductions.kvbbgZusatz],
      ['Sonstige Abzüge', payroll.deductions.other],
      ['Abzüge gesamt', payroll.totalDeductions],
      ['Geschätzte Auszahlung', payroll.payoutPreview]
    ].forEach(([a,b])=>ded.appendChild(dataRow(a, typeof b === 'string' ? b : euro(b))));
    const notes = document.getElementById('payrollNotes'); notes.innerHTML='';
    notes.appendChild(dataRow('Monat', formatMonth(month)));
    notes.appendChild(dataRow('Vormonat für Zuschläge', formatMonth(prevMonth(month))));
    notes.appendChild(dataRow('Zuschläge/Zulagen aus Vormonat', euro(payroll.paidAllowancesTotal)));
    notes.appendChild(dataRow('Brutto vor Abzügen', euro(payroll.paidGrossTotal)));
    notes.appendChild(dataRow('Manuelle Lohnarten im Monat', String(manualLinesForPaidMonth(month).length)));
    const exportWrap = document.getElementById('calendarExportInfo');
    if (exportWrap) {
      const exportEntries = buildCalendarExportEntries(month);
      exportWrap.innerHTML = '';
      exportWrap.appendChild(dataRow('Export-Monat', formatMonth(month)));
      exportWrap.appendChild(dataRow('Einträge in der ICS-Datei', String(exportEntries.length)));
      exportWrap.appendChild(dataRow('Quelle', 'ICS: Umlauf ab morgen · Lohn: voller Monat'));
      if (!exportEntries.length) {
        const hint = document.createElement('div');
        hint.className = 'badge warning';
        hint.textContent = 'Für diesen Monat konnten aus dem Umlauf keine exportierbaren Einträge erzeugt werden.';
        exportWrap.appendChild(hint);
      }
    }
  }

  function renderItemTable(container, items) {
    container.innerHTML='';
    if (!items.length) { container.innerHTML='<p class="small-text">Keine Einträge.</p>'; return; }
    items.forEach(x => {
      const card=document.createElement('div'); card.className='item-card';
      const details = [];
      if (x.hours != null && Number(x.hours) > 0) details.push(`<div class="data-row"><span>Stunden</span><strong>${fixed2(x.hours)} Std.</strong></div>`);
      if (x.percent != null) details.push(`<div class="data-row"><span>Zuschlag</span><strong>${fixed2(x.percent)} %</strong></div>`);
      if (x.days != null && Number(x.days) > 0) details.push(`<div class="data-row"><span>Tage</span><strong>${fixed2(x.days)}</strong></div>`);
      if (x.factor != null && Number(x.factor) > 0) details.push(`<div class="data-row"><span>Ø Zuschlag/Std.</span><strong>${fixed2(x.factor)} €/Std.</strong></div>`);
      card.innerHTML=`<h4>${escapeHtml(x.label)}</h4>
        <div class="data-row"><span>Betrag</span><strong>${euro(x.amount)}</strong></div>
        ${details.join('')}
        <div class="data-row"><span>Erarbeitet</span><strong>${x.earnedMonth || '—'}</strong></div>
        <div class="data-row"><span>Ausgezahlt</span><strong>${x.paidMonth || '—'}</strong></div>
        <div class="data-row"><span>Brutto-Zuordnung</span><strong>${bruttoLabel(x.counts)}</strong></div>`;
      container.appendChild(card);
    });
  }
  function bruttoLabel(counts) {
    if (counts.reimbursement) return 'Erstattung';
    const arr=[]; if(counts.gesamt) arr.push('GE'); if(counts.steuer) arr.push('ST'); if(counts.sv) arr.push('SV'); if(counts.zv) arr.push('ZV'); return arr.join('/') || '—';
  }

  function renderStatements() {
    const monthInput = document.getElementById('statementMonth'); if (!monthInput.value) monthInput.value = currentMonth();
    const month = monthInput.value;
    const stmt = state.statements[month] || {};
    setVal('stmtGesamtBrutto', stmt.gesamtBrutto); setVal('stmtSteuerBrutto', stmt.steuerBrutto); setVal('stmtSvBrutto', stmt.svBrutto);
    setVal('stmtZvBrutto', stmt.zvBrutto); setVal('stmtPayout', stmt.payout); setVal('stmtTax', stmt.lohnsteuer); setVal('stmtKv', stmt.kv);
    setVal('stmtRv', stmt.rv); setVal('stmtAv', stmt.av); setVal('stmtPv', stmt.pv); setVal('stmtOther', stmt.other);
    document.getElementById('stmtCorrection').checked = !!stmt.isCorrection;
    document.getElementById('stmtNotes').value = stmt.notes || '';
    if (!document.getElementById('stmtLineMonth').value) document.getElementById('stmtLineMonth').value = month;
    if (!document.getElementById('stmtPaidMonth').value) document.getElementById('stmtPaidMonth').value = month;
    if (!document.getElementById('stmtEarnedMonth').value) document.getElementById('stmtEarnedMonth').value = prevMonth(month);
    fillSelect('stmtLineCategory', LINE_CATEGORIES, LINE_CATEGORIES.map(lineCategoryLabel));
    const list = document.getElementById('statementLinesList'); list.innerHTML='';
    state.statementLines.filter(x => x.paidMonth === month || x.earnedMonth === month).forEach((x, idx) => {
      const card=document.createElement('div'); card.className='item-card';
      card.innerHTML=`<h4>${escapeHtml(x.label)}</h4>
        <div class="data-row"><span>Betrag</span><strong>${euro(x.amount)}</strong></div>
        <div class="data-row"><span>Monat</span><strong>${x.paidMonth || x.month || '—'}</strong></div>
        <div class="data-row"><span>Zuordnung</span><strong>${[x.countsGesamt?'GE':'',x.countsSteuer?'ST':'',x.countsSv?'SV':'',x.countsZv?'ZV':''].filter(Boolean).join('/') || (x.isReimbursement?'Erstattung':'—')}</strong></div>
        <div class="inline-actions mt-16"><button type="button" class="danger delete-line" data-idx="${idx}">Löschen</button></div>`;
      list.appendChild(card);
    });
  }

  function renderYear() {
    const yearEl = document.getElementById('yearInput');
    if (!yearEl) return;
    if (!yearEl.value) yearEl.value = new Date().getFullYear();
    const year = Number(yearEl.value);
    let gross = 0;
    let payout = 0;
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const month = `${year}-${String(m).padStart(2,'0')}`;
      const payroll = calculatePayroll(month);
      const stmt = state.statements[month] || {};
      gross += payroll.gross.gesamt;
      payout += payroll.payoutPreview;
      rows.push({
        month,
        appPayout: payroll.payoutPreview,
        stmtPayout: Number(stmt.payout || 0),
        gross: payroll.gross.gesamt,
        stmtGross: Number(stmt.gesamtBrutto || 0)
      });
    }
    const grossEl = document.getElementById('yearGross');
    const payoutEl = document.getElementById('yearPayout');
    const table = document.getElementById('yearTable');
    if (grossEl) grossEl.textContent = euro(gross);
    if (payoutEl) payoutEl.textContent = euro(payout);
    if (table) {
      table.innerHTML = `<table><thead><tr><th>Monat</th><th>App Auszahlung</th><th>Ist Auszahlung</th><th>App Gesamtbrutto</th><th>Ist Gesamtbrutto</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${formatMonth(r.month)}</td><td>${euro(r.appPayout)}</td><td>${euro(r.stmtPayout)}</td><td>${euro(r.gross)}</td><td>${euro(r.stmtGross)}</td></tr>`).join('')}</tbody></table>`;
    }
  }

  function applyTaxClassToFields() {
    const select = document.getElementById('setTaxClass');
    const taxInput = document.getElementById('setTaxPercent');
    if (!select || !taxInput) return;
    taxInput.value = fixed2(getTaxProfile(select.value).estimatedTaxPercent).replace(',', '.');
    refreshPayrollViews();
  }
  function applyHealthInsuranceToFields() {
    const select = document.getElementById('setHealthInsurance');
    const addInput = document.getElementById('setHealthAdditionalPercent');
    const healthInput = document.getElementById('setHealthPercent');
    if (!select || !addInput || !healthInput) return;
    const profile = getHealthInsuranceProfile(select.value);
    if (profile.additionalPercent != null) addInput.value = String(profile.additionalPercent);
    const additional = Number(addInput.value || 0);
    healthInput.value = String(calculateHealthEmployeePercent(additional));
    refreshPayrollViews();
  }

  function renderSettings() {
    fillSelect('setTaxClass', Object.keys(TAX_CLASS_PROFILES), Object.values(TAX_CLASS_PROFILES).map(x => 'Steuerklasse ' + x.label));
    fillSelect('setHealthInsurance', HEALTH_INSURANCE_PROFILES.map(x => x.key), HEALTH_INSURANCE_PROFILES.map(x => x.label));
    { const keys = tariffTableOptionKeys(); fillSelect('setTariffTable', keys, keys.map(k => getTariffTable(k).label)); }
    fillSelect('setGroup', Array.from({length:15}, (_,i)=>'EG ' + (i+1)), Array.from({length:15}, (_,i)=>'EG ' + (i+1)));
    fillSelect('setStep', [1,2,3,4,5], ['Stufe 1','Stufe 2','Stufe 3','Stufe 4','Stufe 5']);
    setVal('setTariffName', state.settings.tariffName);
    setVal('setTariffTable', state.settings.tariffTableKey || '2025-01-01_39');
    setVal('setGroup', String(state.settings.entgeltgruppe || 'EG 5').startsWith('EG') ? state.settings.entgeltgruppe : 'EG ' + groupNumber(state.settings.entgeltgruppe));
    setVal('setStep', state.settings.stufe);
    setVal('setWeeklyHours', state.settings.weeklyHoursContract);
    setVal('setCycleAvg', state.settings.weeklyHoursCycleAvg);
    setVal('setBasePay', state.settings.fixedMonthlyBasePay);
    setVal('setBaseRate', state.settings.baseHourRate);
    setVal('setBonusRate', state.settings.bonusHourRate);
    setVal('setFrvMinutes', formatMinutes(state.settings.frvPlaceholderMinutes));
    setVal('setKvbbgUmlage', state.settings.kvbbgUmlagePercent);
    setVal('setKvbbgZusatz', state.settings.kvbbgZusatzPercent);
    setVal('setTaxClass', state.settings.taxClass || '1');
    setVal('setTaxPercent', state.settings.estimatedTaxPercent);
    setVal('setHealthInsurance', state.settings.healthInsurance || 'custom');
    setVal('setHealthAdditionalPercent', state.settings.healthAdditionalPercent);
    setVal('setHealthPercent', state.settings.estimatedHealthPercent);
    setVal('setPensionPercent', state.settings.estimatedPensionPercent);
    setVal('setUnemploymentPercent', state.settings.estimatedUnemploymentPercent);
    setVal('setCarePercent', state.settings.estimatedCarePercent);
    setVal('setChurchPercent', state.settings.estimatedChurchPercent);
    setVal('setSoliPercent', state.settings.estimatedSoliPercent);
    const preferActual = document.getElementById('setPreferActualDeductions'); if (preferActual) preferActual.checked = !!state.settings.preferActualDeductions;
    setVal('setCalendarName', state.settings.calendarName);
    setVal('setReminder', state.settings.reminderMinutes);
    updateTariffPreview();
  }

  function setVal(id, value) { const el=document.getElementById(id); if (!el) return; el.value = value ?? ''; }
  function fillSelect(id, values, labels) {
    const select=document.getElementById(id); if (select.dataset.ready==='1') return;
    select.innerHTML = values.map((v,i)=>`<option value="${v}">${labels[i] ?? v}</option>`).join('');
    select.dataset.ready='1';
  }
  function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  
  function refreshPayrollViews() {
    if (document.getElementById('tab-payroll')?.classList.contains('active')) renderPayroll();
    if (document.getElementById('tab-overview')?.classList.contains('active')) renderOverview();
    if (document.getElementById('tab-year')?.classList.contains('active')) renderYear();
  }

function bindEvents() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-btn');
      if (btn) {
        e.preventDefault();
        switchTab(btn.dataset.tab);
      }
    });
    document.addEventListener('submit', (e) => {
      if (e.target?.id === 'cloudLoginForm' || e.target?.id === 'loginForm') handleCloudLogin(e);
    });
    document.addEventListener('click', (e) => {
      if (e.target?.id === 'cloudLogoutBtn') handleCloudLogout();
      if (e.target?.id === 'cloudSaveNowBtn') {
        setSyncStatus('Cloud wird gespeichert …', 'warning');
        cloudSpeichern().catch((error) => {
          console.error(error);
          setSyncStatus('Online-Speicherung fehlgeschlagen · lokal gespeichert', 'danger');
        });
      }
      if (e.target?.id === 'cloudRefreshBtn' || e.target?.id === 'refreshDaysBtn' || e.target?.id === 'sidebarRefreshBtn') {
        refreshFromCloud();
      }
    });
    document.getElementById('overviewMonth').addEventListener('change', renderOverview);
    document.getElementById('rotationWeekSelect').addEventListener('change', renderRotation);
    document.getElementById('rotationTypeSelect')?.addEventListener('change', changeRotationType);
    document.getElementById('addRotationTypeBtn')?.addEventListener('click', addRotationType);
    document.getElementById('duplicateRotationTypeBtn')?.addEventListener('click', duplicateRotationType);
    document.getElementById('renameRotationTypeBtn')?.addEventListener('click', renameRotationType);
    document.getElementById('deleteRotationTypeBtn')?.addEventListener('click', deleteRotationType);
    document.getElementById('currentRotationWeekSelect').addEventListener('change', saveCurrentRotationReference);
    document.getElementById('currentRotationAnchorDate').addEventListener('change', saveCurrentRotationReference);
    document.getElementById('saveCurrentRotationBtn').addEventListener('click', saveCurrentRotationReference);
    document.getElementById('rotationTableBody').addEventListener('input', onRotationTableInput);
    document.getElementById('rotationTableBody').addEventListener('change', onRotationTableInput);
    document.getElementById('rotationTableBody').addEventListener('click', onRotationTableClick);
    document.getElementById('copyWeekBtn').addEventListener('click', copyWeek);
    document.getElementById('dayDate').addEventListener('change', () => { const m = document.getElementById('daysMonth'); if (m) m.value = dateToMonth(document.getElementById('dayDate').value); if (canEditDays()) renderDayForm(); else renderDriverDaysView(); });
    document.getElementById('daysMonth').addEventListener('change', renderDaysCalendar);
    document.getElementById('daysCalendar').addEventListener('click', (e) => { const btn = e.target.closest('[data-calendar-date]'); if (btn) selectCalendarDate(btn.dataset.calendarDate); });
    document.getElementById('dailyDate')?.addEventListener('change', renderDailyServices);
    document.getElementById('dailyEmployeeForm')?.addEventListener('submit', saveDailyEmployee);
    document.getElementById('dailyEmployeeClearBtn')?.addEventListener('click', clearDailyEmployeeForm);
    document.getElementById('dailyEmployeeList')?.addEventListener('click', handleDailyEmployeeClick);
    document.getElementById('dailyDutyTableBody')?.addEventListener('change', handleDailyDutyChange);
    document.getElementById('dailyDutyTableBody')?.addEventListener('click', handleDailyDutyClick);
    document.getElementById('dayForm').addEventListener('submit', saveDayForm);
    document.getElementById('dayForm').addEventListener('input', syncDayPaidPreview);
    document.getElementById('actualType')?.addEventListener('change', () => { updateSplitFieldsVisibility(); syncDayPaidPreview(); const f=document.getElementById('flagExtraWork'); if (f) f.checked = document.getElementById('actualType')?.value === 'extra_work'; });
    document.getElementById('flagSplit')?.addEventListener('change', () => { updateSplitFieldsVisibility(); syncDayPaidPreview(); });
    ['splitPartStart1','splitPartEnd1','splitPartBreak1','splitPartStart2','splitPartEnd2','splitPartBreak2'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', onSplitInlineInput);
      document.getElementById(id)?.addEventListener('change', onSplitInlineInput);
    });
    document.getElementById('clearSplitInlineBtn')?.addEventListener('click', clearSplitInlineParts);
    const quickAbsenceForm = document.getElementById('quickAbsenceForm');
    if (quickAbsenceForm) {
      quickAbsenceForm.addEventListener('submit', saveQuickAbsence);
      quickAbsenceForm.addEventListener('input', updateQuickAbsencePreview);
      quickAbsenceForm.addEventListener('change', updateQuickAbsencePreview);
    }
    const copyDayRangeBox = document.querySelector('.copy-day-box');
    if (copyDayRangeBox) {
      copyDayRangeBox.addEventListener('input', updateCopyDayPreview);
      copyDayRangeBox.addEventListener('change', updateCopyDayPreview);
    }
    const copyDayRangeBtn = document.getElementById('copyDayRangeBtn');
    if (copyDayRangeBtn) copyDayRangeBtn.addEventListener('click', copyCurrentDayToRange);
    document.getElementById('swapDayTarget')?.addEventListener('change', updateSwapDayPreview);
    document.getElementById('swapDayBtn')?.addEventListener('click', swapSelectedDayWithTarget);

    document.getElementById('payrollMonth').addEventListener('change', renderPayroll);
    const payrollIcsBtn = document.getElementById('exportMonthIcsBtn'); if (payrollIcsBtn) payrollIcsBtn.addEventListener('click', () => exportMonthIcs());
    const payrollCsvBtn = document.getElementById('exportPayrollMonthCsvBtn'); if (payrollCsvBtn) payrollCsvBtn.addEventListener('click', exportPayrollMonthCsv);
    const payrollJsonBtn = document.getElementById('exportPayrollMonthJsonBtn'); if (payrollJsonBtn) payrollJsonBtn.addEventListener('click', exportPayrollMonthJson);
    const payrollYearCsvBtn = document.getElementById('exportPayrollYearCsvBtn'); if (payrollYearCsvBtn) payrollYearCsvBtn.addEventListener('click', exportPayrollYearCsv);
    const exportDaysBtn = document.getElementById('exportDaysMonthIcsBtn'); if (exportDaysBtn) exportDaysBtn.addEventListener('click', () => exportMonthIcs(document.getElementById('daysMonth').value || currentMonth()));
    document.getElementById('statementMonth').addEventListener('change', renderStatements);
    document.getElementById('statementSummaryForm').addEventListener('submit', saveStatementSummary);
    document.getElementById('statementLineForm').addEventListener('submit', saveStatementLine);
    document.getElementById('statementLinesList').addEventListener('click', deleteStatementLine);
    document.getElementById('yearInput').addEventListener('change', renderYear);
    document.getElementById('settingsForm').addEventListener('submit', saveSettings);
    ['setTariffTable','setGroup','setStep'].forEach((id) => document.getElementById(id)?.addEventListener('change', updateTariffPreview));
    document.getElementById('tariffApplyBtn')?.addEventListener('click', applyTariffSelectionToSettings);
    const taxClassSelect = document.getElementById('setTaxClass'); if (taxClassSelect) taxClassSelect.addEventListener('change', applyTaxClassToFields);
    const healthSelect = document.getElementById('setHealthInsurance'); if (healthSelect) healthSelect.addEventListener('change', applyHealthInsuranceToFields);
    const healthAdditional = document.getElementById('setHealthAdditionalPercent'); if (healthAdditional) healthAdditional.addEventListener('input', applyHealthInsuranceToFields);
    document.getElementById('loadDemoBtn')?.addEventListener('click', loadDemo);
    document.getElementById('exportBtn')?.addEventListener('click', exportBackup);
    document.getElementById('importFile')?.addEventListener('change', importBackup);
    document.getElementById('resetBtn')?.addEventListener('click', resetAll);
    const mobileToggle = document.getElementById('mobileMenuToggle');
    if (mobileToggle) mobileToggle.addEventListener('click', toggleMobileMenu);
    window.addEventListener('resize', handleResponsiveMenuState);
  }

  function toggleMobileMenu(forceOpen) {
    const sidebar = document.querySelector('.sidebar');
    const btn = document.getElementById('mobileMenuToggle');
    if (!sidebar || !btn) return;
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !sidebar.classList.contains('mobile-open');
    sidebar.classList.toggle('mobile-open', shouldOpen);
    btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    btn.textContent = shouldOpen ? 'Menü schließen' : 'Menü';
  }

  function handleResponsiveMenuState() {
    if (window.innerWidth > 920) {
      const sidebar = document.querySelector('.sidebar');
      const btn = document.getElementById('mobileMenuToggle');
      if (sidebar) sidebar.classList.remove('mobile-open');
      if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = 'Menü';
      }
    }
  }

  function switchTab(tab) {
    if (!tab) return;
    if (!canViewTab(tab)) tab = defaultTabForRole();
    document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active', x.dataset.tab===tab));
    document.querySelectorAll('.tab-panel').forEach(x=>x.classList.toggle('active', x.id===`tab-${tab}`));
    const titleMap = {
      overview:['Übersicht','Schneller Monatsblick, offene FRV-Tage und zentrale Warnungen.'],
      rotation:['Umlauf','40-Wochen-Vorlagen nur für feste Dienste, FRV und freie Tage. Urlaub, krank und anderes trägst du erst bei Tage ein.'],
      daily:['Tagesdienste','Dienste des Tages, geplante Fahrer, Ausfälle, FRV-Verfügbarkeit und Vertretung.'],
      days: canEditDays() ? ['Tage','Echte Dienste pro Datum erfassen und prüfen.'] : ['Kalender','Dienstkalender ansehen und Kalenderdatei für iPhone/Android herunterladen.'],
      payroll:['Lohn','Fixer Monatslohn, erarbeitete Zuschläge und KVBbg.'],
      statements:['Abrechnungen','Ist-Werte aus echten Abrechnungen und manuelle Lohnarten.'],
      year:['Jahresauswertung','Plan/Ist-Vergleich über das komplette Jahr.'],
      settings:['Einstellungen','Tarifdaten, FRV, Kalender und Standardwerte.']
    };
    const meta = titleMap[tab] || ['Dienstplanung & Gehalt',''];
    document.getElementById('tabTitle').textContent = meta[0];
    document.getElementById('tabSubtitle').textContent = meta[1];
    if (tab === 'rotation') renderRotation();
    if (tab === 'daily') renderDailyServices();
    if (tab === 'days') { if (canEditDays()) renderDayForm(); else renderDriverDaysView(); }
    if (tab === 'payroll') renderPayroll();
    if (tab === 'statements') renderStatements();
    if (tab === 'year') renderYear();
    if (tab === 'settings') renderSettings();
    if (tab === 'overview') renderOverview();
    if (window.innerWidth <= 920) toggleMobileMenu(false);
  }

  function onRotationTableInput(e) {
    if (!canEditRotation()) return showRoleDenied('Umlauf bearbeiten');
    const target = e.target; if (!target.dataset.idx) return;
    const weekNumber = Number(document.getElementById('rotationWeekSelect').value);
    const weekdayIndex = Number(target.dataset.idx);
    const week = getActiveRotationWeeks()[weekNumber - 1];
    const day = week.days[weekdayIndex];
    const oldTemplateDay = cloneData(day);
    freezePastRotationDaysBeforeEdit();
    const field = target.dataset.field;

    if (field === 'defaultPaidAuto') {
      day.defaultPaidMode = target.checked ? 'auto' : 'manual';
      if (target.checked) {
        day.defaultPaidMinutes = calculateTemplatePaidMinutes(day);
        renderRotation();
      }
      updateFutureAutoEntriesForRotationSlot(weekNumber, weekdayIndex, oldTemplateDay);
      saveState();
      renderRotationWeekTotals(week);
      refreshPayrollViews();
      return;
    }
    if (field === 'defaultPaidDisplay') {
      const parsed = parseDurationMinutes(target.value);
      if (parsed != null) day.defaultPaidMinutes = parsed;
      day.defaultPaidMode = 'manual';
      const autoBox = target.closest('.paid-cell')?.querySelector('[data-field="defaultPaidAuto"]');
      if (autoBox) autoBox.checked = false;
      updateFutureAutoEntriesForRotationSlot(weekNumber, weekdayIndex, oldTemplateDay);
      saveState();
      renderRotationWeekTotals(week);
      refreshPayrollViews();
      return;
    }
    day[field] = target.type === 'number' ? Number(target.value || 0) : target.value;
    if (day.defaultPaidMode !== 'manual' && ['templateType','defaultStartTime','defaultEndTime','defaultBreakMinutes'].includes(field)) {
      day.defaultPaidMinutes = calculateTemplatePaidMinutes(day);
      const paidInput = target.closest('tr')?.querySelector('[data-field="defaultPaidDisplay"]');
      if (paidInput) paidInput.value = formatMinutes(day.defaultPaidMinutes || 0);
    }
    updateFutureAutoEntriesForRotationSlot(weekNumber, weekdayIndex, oldTemplateDay);
    saveState();
    renderRotationWeekTotals(week);
    refreshPayrollViews();
  }


  function onRotationTableClick(e) {
    if (!canEditRotation()) return showRoleDenied('Umlauf bearbeiten');
    const btn = e.target.closest('.copy-day-template');
    if (!btn) return;
    copyRotationDay(Number(btn.dataset.idx));
  }

  function copyRotationDay(sourceIdx) {
    const week = getActiveRotationWeeks()[Number(document.getElementById('rotationWeekSelect').value)-1];
    const source = week.days[sourceIdx];
    const raw = prompt(`Auf welche Tage übernehmen?\nBeispiele: Di,Mi,Do oder 2,3,4`, '');
    if (!raw) return;
    const targets = parseWeekdayTargets(raw, sourceIdx);
    if (!targets.length) {
      alert('Keine gültigen Zieltage erkannt. Erlaubt sind Mo, Di, Mi, Do, Fr, Sa, So oder 1-7.');
      return;
    }
    const weekNumber = Number(document.getElementById('rotationWeekSelect').value);
    freezePastRotationDaysBeforeEdit();
    targets.forEach(idx => {
      const target = week.days[idx];
      const oldTemplateDay = cloneData(target);
      week.days[idx] = {
        ...target,
        templateType: source.templateType,
        defaultStartTime: source.defaultStartTime,
        defaultEndTime: source.defaultEndTime,
        defaultBreakMinutes: source.defaultBreakMinutes,
        defaultPaidMinutes: source.defaultPaidMinutes,
        defaultPaidMode: source.defaultPaidMode,
        serviceNumber: source.serviceNumber || '',
        notes: source.notes || ''
      };
      updateFutureAutoEntriesForRotationSlot(weekNumber, idx, oldTemplateDay);
    });
    saveState();

    renderRotation();
    refreshPayrollViews();
  }

  function parseWeekdayTargets(raw, sourceIdx) {
    const map = { mo:0, montag:0, 1:0, di:1, dienstag:1, 2:1, mi:2, mittwoch:2, 3:2, do:3, donnerstag:3, 4:3, fr:4, freitag:4, 5:4, sa:5, samstag:5, 6:5, so:6, sonntag:6, 7:6 };
    return [...new Set(String(raw).split(/[;,\s]+/).map(x => map[x.trim().toLowerCase()]).filter(x => Number.isInteger(x) && x !== sourceIdx))];
  }

  function copyWeek() {
    if (!canEditRotation()) return showRoleDenied('Umlauf kopieren');
    const current = Number(document.getElementById('rotationWeekSelect').value);
    const to = Number(prompt('Auf welche Woche kopieren? (1-40)', String(Math.min(40, current+1))));
    if (!to || to < 1 || to > 40 || to === current) return;
    freezePastRotationDaysBeforeEdit();
    const oldDays = cloneData(getActiveRotationWeeks()[to-1].days);
    getActiveRotationWeeks()[to-1].days = cloneData(getActiveRotationWeeks()[current-1].days);
    oldDays.forEach((oldDay, idx) => updateFutureAutoEntriesForRotationSlot(to, idx, oldDay));
    saveState(); renderRotation();
  }

  function saveCurrentRotationReference() {
    if (!canEditRotation()) return showRoleDenied('Aktuelle Umlaufwoche speichern');
    freezePastRotationDaysBeforeEdit();
    const weekSelect = document.getElementById('currentRotationWeekSelect');
    const anchorInput = document.getElementById('currentRotationAnchorDate');
    state.settings.currentRotationWeek = Math.min(40, Math.max(1, Number(weekSelect?.value || 1)));
    state.settings.currentRotationAnchorDate = anchorInput?.value || currentDate();
    saveState();
    renderOverview();
    renderRotation();
    if (document.getElementById('dayDate')?.value) renderDayForm();
  }

  function dateRangeInclusive(from, to) {
    const start = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
    const realStart = start <= end ? start : end;
    const realEnd = start <= end ? end : start;
    const dates = [];
    const cursor = new Date(realStart);
    while (cursor <= realEnd) {
      dates.push(formatIsoDate(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  function buildDayEntryFromCurrentForm(baseDate, targetDate = baseDate, options = {}) {
    const template = getTemplateForDate(targetDate);
    const target = ensureEntry(targetDate);
    const copyAutoHoliday = options.copyAutoHoliday !== false;
    let actualType = document.getElementById('actualType').value;
    const extraWorkChecked = !!document.getElementById('flagExtraWork')?.checked;
    if (extraWorkChecked && !['free','vacation','sick','split_shift'].includes(actualType)) actualType = 'extra_work';
    const isVacation = document.getElementById('flagVacation').checked;
    const isSick = document.getElementById('flagSick').checked;
    const isFree = actualType === 'free' && !isVacation && !isSick;
    const entry = {
      ...target,
      date: targetDate,
      plannedType: template?.templateType || target.plannedType || 'fixed',
      status: document.getElementById('dayStatus').value,
      actualType,
      serviceNumber: document.getElementById('dayServiceNumber').value.trim(),
      startTime: document.getElementById('dayStart').value,
      endTime: document.getElementById('dayEnd').value,
      breakMinutes: Number(document.getElementById('dayBreak').value || 0),
      frvMinutes: parseDurationMinutes(document.getElementById('frvMinutes').value) ?? Number(state.settings.frvPlaceholderMinutes || 468),
      orderedOvertimeHours: Number(document.getElementById('orderedOvertimeHours').value || 0),
      factorValue: Number(document.getElementById('dayFactor').value || 0),
      vacationDays: Number(document.getElementById('dayVacationDays').value || 0),
      sickDays: Number(document.getElementById('daySickDays').value || 0),
      betriebsversammlungTravelAmount: Number(document.getElementById('dayBvTravel').value || 0),
      notes: document.getElementById('dayNotes').value,
      isFahrdienst: document.getElementById('flagFahrdienst').checked,
      isHoliday: copyAutoHoliday ? isBrandenburgHoliday(targetDate) : document.getElementById('flagHoliday').checked,
      isVorfesttag: document.getElementById('flagVorfesttag').checked,
      isSplitShift: document.getElementById('flagSplit').checked,
      isVacation,
      isSick,
      isBetriebsversammlung: document.getElementById('flagBv').checked,
      isVoluntarySwap: document.getElementById('flagSwap').checked,
      isExtraWork: extraWorkChecked || actualType === 'extra_work',
      isFinal: document.getElementById('flagFinal').checked,
      rangeFrom: targetDate,
      rangeTo: targetDate,
      parts: readSplitInlineParts({ completeOnly: true })
    };
    entry.vacationDays = entry.isVacation ? (entry.vacationDays || 1) : 0;
    entry.sickDays = entry.isSick ? (entry.sickDays || 1) : 0;
    const splitHasAnyInput = hasSplitInlineValues();
    const isSplitEntry = entry.isSplitShift || entry.actualType === 'split_shift' || splitHasAnyInput;
    if (isSplitEntry) {
      entry.actualType = 'split_shift';
      entry.isSplitShift = true;
      entry.parts = readSplitInlineParts({ completeOnly: true });
      entry.startTime = '';
      entry.endTime = '';
      entry.breakMinutes = 0;
      if (['planned', 'open'].includes(entry.status)) entry.status = 'assigned';
    } else {
      entry.parts = [];
    }
    if (isFree) {
      entry.serviceNumber = '';
      entry.startTime = '';
      entry.endTime = '';
      entry.breakMinutes = 0;
      entry.orderedOvertimeHours = 0;
      entry.isFahrdienst = false;
      entry.isExtraWork = false;
      entry.isSplitShift = false;
      entry.parts = [];
    }
    normalizeFrvActualAssignment(entry);
    return entry;
  }

  function assignDayEntry(date, values) {
    state.dayEntries[date] = { ...values, date };
  }

  function isFrvTargetDay(date) {
    const template = getTemplateForDate(date);
    const entry = state.dayEntries?.[date];
    return !!(
      template?.templateType === 'frv' ||
      entry?.plannedType === 'frv' ||
      entry?.actualType === 'frv_open' ||
      entry?.actualType === 'frv_assigned'
    );
  }

  function shouldApplyToDate(date, onlyWorkdays, options = {}) {
    if (options.onlyFrvDays && !isFrvTargetDay(date)) return false;
    return !onlyWorkdays || isPlannedWorkingDay(date);
  }

  function getApplicableDates(from, to, onlyWorkdays, options = {}) {
    return dateRangeInclusive(from, to).filter((date) => shouldApplyToDate(date, !!onlyWorkdays, options));
  }

  function renderDatePreview(targetId, dates, emptyText) {
    const el = document.getElementById(targetId);
    if (!el) return;
    if (!dates.length) {
      el.textContent = emptyText || 'Keine passenden Tage gefunden.';
      el.classList.add('warning');
      return;
    }
    el.classList.remove('warning');
    const visible = dates.slice(0, 8).map(formatDateShort).join(', ');
    const suffix = dates.length > 8 ? ` … +${dates.length - 8} weitere` : '';
    el.textContent = `${dates.length} Tag(e): ${visible}${suffix}`;
  }

  function updateQuickAbsencePreview() {
    const from = document.getElementById('quickAbsenceFrom')?.value || document.getElementById('dayDate')?.value || currentDate();
    const to = document.getElementById('quickAbsenceTo')?.value || from;
    const onlyWorkdays = document.getElementById('quickAbsenceOnlyWorkdays')?.checked;
    const dates = getApplicableDates(from, to, onlyWorkdays);
    renderDatePreview('quickAbsencePreview', dates, 'Keine geplanten Arbeitstage in diesem Zeitraum.');
  }

  function updateCopyDayPreview() {
    const sourceDate = document.getElementById('dayDate')?.value || currentDate();
    const from = document.getElementById('copyDayRangeFrom')?.value || sourceDate;
    const to = document.getElementById('copyDayRangeTo')?.value || from;
    const onlyWorkdays = document.getElementById('copyDayOnlyWorkdays')?.checked;
    const onlyFrvDays = document.getElementById('copyDayOnlyFrvDays')?.checked;
    const dates = getApplicableDates(from, to, onlyWorkdays, { onlyFrvDays });
    renderDatePreview('copyDayPreview', dates, onlyFrvDays ? 'Keine FRV-Ziel-Tage in diesem Zeitraum.' : 'Keine passenden Ziel-Tage in diesem Zeitraum.');
  }

  function applyAbsenceRange(mode, rangeFrom, rangeTo, baseValues, options = {}) {
    const dates = dateRangeInclusive(rangeFrom, rangeTo);
    dates.forEach((date) => {
      if (!shouldApplyToDate(date, !!options.onlyWorkdays)) return;
      const entry = ensureEntry(date);
      entry.status = baseValues.status;
      entry.factorValue = baseValues.factorValue;
      entry.notes = baseValues.notes;
      entry.isFinal = baseValues.isFinal;
      entry.isHoliday = isBrandenburgHoliday(date);
      entry.isVorfesttag = false;
      entry.isSplitShift = false;
      entry.isBetriebsversammlung = false;
      entry.isVoluntarySwap = false;
      entry.isExtraWork = false;
      entry.serviceNumber = '';
      entry.startTime = '';
      entry.endTime = '';
      entry.breakMinutes = 0;
      entry.parts = [];
      entry.frvMinutes = Number(state.settings.frvPlaceholderMinutes || 468);
      entry.orderedOvertimeHours = 0;
      entry.betriebsversammlungTravelAmount = 0;
      entry.isFahrdienst = false;
      if (mode === 'vacation') {
        entry.actualType = 'vacation';
        entry.isVacation = true;
        entry.isSick = false;
        entry.vacationDays = 1;
        entry.sickDays = 0;
      } else if (mode === 'sick') {
        entry.actualType = 'sick';
        entry.isVacation = false;
        entry.isSick = true;
        entry.vacationDays = 0;
        entry.sickDays = 1;
      }
    });
  }

  function saveQuickAbsence(e) {
    e.preventDefault();
    if (!canEditDays()) return showRoleDenied('Urlaub/Krankheit eintragen');
    const mode = document.getElementById('quickAbsenceType').value;
    const from = document.getElementById('quickAbsenceFrom').value || document.getElementById('dayDate').value || currentDate();
    const to = document.getElementById('quickAbsenceTo').value || from;
    const notes = document.getElementById('quickAbsenceNotes').value || '';
    const onlyWorkdays = document.getElementById('quickAbsenceOnlyWorkdays').checked;
    const isFinal = document.getElementById('quickAbsenceFinal').checked;
    const targetDates = getApplicableDates(from, to, onlyWorkdays);
    if (!targetDates.length) {
      alert('In diesem Zeitraum wurden keine passenden Tage gefunden.');
      updateQuickAbsencePreview();
      return;
    }
    const label = mode === 'vacation' ? 'Urlaub' : 'Krankheit';
    if (!confirm(`${label} für ${targetDates.length} Tag(e) eintragen?`)) return;
    applyAbsenceRange(mode, from, to, { status: 'planned', factorValue: 0, notes, isFinal }, { onlyWorkdays });
    saveState();
    document.getElementById('dayDate').value = from;
    const m = document.getElementById('daysMonth');
    if (m) m.value = dateToMonth(from);
    renderAll();
  }


  function appendNote(existing, extra) {
    const parts = [String(existing || '').trim(), String(extra || '').trim()].filter(Boolean);
    return [...new Set(parts)].join(' · ');
  }

  function getEffectiveEntryForDate(date) {
    const templateEntry = buildTemplateDayEntry(date);
    const saved = state.dayEntries?.[date];
    if (saved) return normalizeFrvActualAssignment({ ...(templateEntry || {}), ...cloneData(saved), date });
    if (templateEntry) return cloneData(templateEntry);
    return {
      date,
      plannedType: 'free',
      status: 'planned',
      actualType: 'free',
      serviceNumber: '',
      startTime: '',
      endTime: '',
      breakMinutes: 0,
      frvMinutes: Number(state.settings.frvPlaceholderMinutes || 468),
      paidMinutes: 0,
      usesTemplatePaidMinutes: false,
      isFahrdienst: false,
      isHoliday: isBrandenburgHoliday(date),
      isVorfesttag: false,
      isSplitShift: false,
      isVacation: false,
      isSick: false,
      isBetriebsversammlung: false,
      isVoluntarySwap: false,
      isExtraWork: false,
      isFinal: false,
      orderedOvertimeHours: 0,
      factorValue: 0,
      vacationDays: 0,
      sickDays: 0,
      parts: [],
      notes: '',
      betriebsversammlungTravelAmount: 0
    };
  }

  function isSwapFreeEntry(entry) {
    if (!entry) return true;
    if (entry.isVacation || entry.isSick || entry.actualType === 'vacation' || entry.actualType === 'sick') return false;
    if (entry.actualType === 'free') return true;
    if ((entry.plannedType === 'free' || entry.actualType === 'frv_open') && !entryHasActualService(entry) && calculatePaidMinutes(entry) === 0) return true;
    return false;
  }

  function makeSwapFreeEntry(date, otherDate) {
    const template = getTemplateForDate(date);
    return {
      date,
      plannedType: template?.templateType || 'free',
      status: 'assigned',
      actualType: 'free',
      serviceNumber: '',
      startTime: '',
      endTime: '',
      breakMinutes: 0,
      frvMinutes: Number(state.settings.frvPlaceholderMinutes || 468),
      paidMinutes: 0,
      usesTemplatePaidMinutes: false,
      isFahrdienst: false,
      isHoliday: isBrandenburgHoliday(date),
      isVorfesttag: false,
      isSplitShift: false,
      isVacation: false,
      isSick: false,
      isBetriebsversammlung: false,
      isVoluntarySwap: true,
      isExtraWork: false,
      isFinal: false,
      orderedOvertimeHours: 0,
      factorValue: 0,
      vacationDays: 0,
      sickDays: 0,
      parts: [],
      notes: `Freier Tag getauscht mit ${formatDateShort(otherDate)}`,
      betriebsversammlungTravelAmount: 0
    };
  }

  function cloneEntryAsSwapWork(entry, newDate, oldDate) {
    const template = getTemplateForDate(newDate);
    const copy = cloneData(entry || {});
    copy.date = newDate;
    copy.plannedType = template?.templateType || copy.plannedType || 'free';
    if (!copy.actualType || ['free','vacation','sick','frv_open'].includes(copy.actualType)) copy.actualType = 'fixed';
    copy.status = 'assigned';
    copy.isVacation = false;
    copy.isSick = false;
    copy.vacationDays = 0;
    copy.sickDays = 0;
    copy.isVoluntarySwap = true;
    copy.isExtraWork = false;
    copy.isHoliday = isBrandenburgHoliday(newDate);
    copy.isFinal = false;
    copy.rangeFrom = newDate;
    copy.rangeTo = newDate;
    copy.notes = appendNote(copy.notes, `Dienst durch freien Tag getauscht von ${formatDateShort(oldDate)}`);
    return normalizeFrvActualAssignment(copy);
  }

  function updateSwapDayPreview() {
    const el = document.getElementById('swapDayPreview');
    if (!el) return;
    const sourceDate = document.getElementById('dayDate')?.value || currentDate();
    const targetDate = document.getElementById('swapDayTarget')?.value || '';
    if (!targetDate) {
      el.textContent = 'Wähle den zweiten Tag für den Tausch.';
      el.classList.remove('warning');
      return;
    }
    if (targetDate === sourceDate) {
      el.textContent = 'Bitte einen anderen Tag wählen.';
      el.classList.add('warning');
      return;
    }
    const sourceEntry = getEffectiveEntryForDate(sourceDate);
    const targetEntry = getEffectiveEntryForDate(targetDate);
    const sourceFree = isSwapFreeEntry(sourceEntry);
    const targetFree = isSwapFreeEntry(targetEntry);
    if (sourceFree === targetFree) {
      el.textContent = 'Für einen einfachen Tausch bitte genau einen Arbeitstag und genau einen freien Tag wählen.';
      el.classList.add('warning');
      return;
    }
    const workDate = sourceFree ? targetDate : sourceDate;
    const freeDate = sourceFree ? sourceDate : targetDate;
    const workEntry = sourceFree ? targetEntry : sourceEntry;
    el.textContent = `Dienst ${workEntry.serviceNumber || actualLabel(workEntry.actualType || workEntry.plannedType)} wird von ${formatDateShort(workDate)} auf den freien Tag ${formatDateShort(freeDate)} gelegt.`;
    el.classList.remove('warning');
  }

  function swapSelectedDayWithTarget() {
    if (!canEditDays()) return showRoleDenied('Freien Tag tauschen');
    const sourceDate = document.getElementById('dayDate')?.value || currentDate();
    const targetDate = document.getElementById('swapDayTarget')?.value || '';
    if (!targetDate || targetDate === sourceDate) {
      alert('Bitte ein anderes Tauschdatum auswählen.');
      updateSwapDayPreview();
      return;
    }
    const sourceEntry = getEffectiveEntryForDate(sourceDate);
    const targetEntry = getEffectiveEntryForDate(targetDate);
    const sourceFree = isSwapFreeEntry(sourceEntry);
    const targetFree = isSwapFreeEntry(targetEntry);
    if (sourceFree === targetFree) {
      alert('Für den einfachen Tausch muss ein Tag ein Dienst/Arbeitstag sein und der andere Tag frei. Zwei freie Tage oder zwei Arbeitstage werden nicht getauscht.');
      updateSwapDayPreview();
      return;
    }
    const workDate = sourceFree ? targetDate : sourceDate;
    const freeDate = sourceFree ? sourceDate : targetDate;
    const workEntry = sourceFree ? targetEntry : sourceEntry;
    const serviceLabel = workEntry.serviceNumber ? `Dienst ${workEntry.serviceNumber}` : actualLabel(workEntry.actualType || workEntry.plannedType);
    if (!confirm(`${serviceLabel} von ${formatDateShort(workDate)} auf ${formatDateShort(freeDate)} tauschen?\n\n${formatDateShort(workDate)} wird danach als frei gespeichert.`)) return;
    assignDayEntry(freeDate, cloneEntryAsSwapWork(workEntry, freeDate, workDate));
    assignDayEntry(workDate, makeSwapFreeEntry(workDate, freeDate));
    saveState();
    document.getElementById('dayDate').value = freeDate;
    const m = document.getElementById('daysMonth');
    if (m) m.value = dateToMonth(freeDate);
    renderAll();
    alert('Freier Tag wurde getauscht.');
  }

  function copyCurrentDayToRange() {
    if (!canEditDays()) return showRoleDenied('Tagesänderung kopieren');
    const sourceDate = document.getElementById('dayDate').value || currentDate();
    const from = document.getElementById('copyDayRangeFrom').value || sourceDate;
    const to = document.getElementById('copyDayRangeTo').value || from;
    const onlyWorkdays = document.getElementById('copyDayOnlyWorkdays').checked;
    const onlyFrvDays = document.getElementById('copyDayOnlyFrvDays')?.checked;
    const copyAutoHoliday = document.getElementById('copyDayKeepAutoHolidays').checked;
    const dates = getApplicableDates(from, to, onlyWorkdays, { onlyFrvDays });
    if (!dates.length) {
      alert(onlyFrvDays ? 'In diesem Zeitraum wurden keine FRV-Ziel-Tage gefunden.' : 'In diesem Zeitraum wurden keine passenden Ziel-Tage gefunden.');
      updateCopyDayPreview();
      return;
    }
    const copyingSplit = document.getElementById('flagSplit')?.checked || document.getElementById('actualType')?.value === 'split_shift' || hasSplitInlineValues();
    if (copyingSplit && readSplitInlineParts({ completeOnly: true }).length < 2) {
      alert('Bitte beim geteilten Dienst beide Arbeitszeiträume vollständig eintragen, bevor du den Tag kopierst.');
      updateSplitFieldsVisibility();
      return;
    }
    if (!confirm(`${onlyFrvDays ? 'Diesen FRV-Dienst' : 'Diese Tagesänderung'} auf ${dates.length} Tag(e) übernehmen?`)) return;
    let count = 0;
    dates.forEach((targetDate) => {
      const values = buildDayEntryFromCurrentForm(sourceDate, targetDate, { copyAutoHoliday });
      assignDayEntry(targetDate, values);
      count += 1;
    });
    saveState();
    renderAll();
    alert(`${count} Tag(e) wurden übernommen.`);
  }

  function saveDayForm(e) {
    e.preventDefault();
    if (!canEditDays()) return showRoleDenied('Tag speichern');
    const date = document.getElementById('dayDate').value;
    const entry = ensureEntry(date);
    entry.plannedType = document.getElementById('plannedType').value;
    entry.status = document.getElementById('dayStatus').value;
    entry.actualType = document.getElementById('actualType').value;
    const extraWorkChecked = !!document.getElementById('flagExtraWork')?.checked;
    if (extraWorkChecked && !['free','vacation','sick','split_shift'].includes(entry.actualType)) entry.actualType = 'extra_work';
    entry.serviceNumber = document.getElementById('dayServiceNumber').value.trim();
    entry.startTime = document.getElementById('dayStart').value;
    entry.endTime = document.getElementById('dayEnd').value;
    entry.breakMinutes = Number(document.getElementById('dayBreak').value || 0);
    entry.frvMinutes = parseDurationMinutes(document.getElementById('frvMinutes').value) ?? Number(state.settings.frvPlaceholderMinutes);
    entry.orderedOvertimeHours = Number(document.getElementById('orderedOvertimeHours').value || 0);
    entry.factorValue = Number(document.getElementById('dayFactor').value || 0);
    entry.vacationDays = Number(document.getElementById('dayVacationDays').value || 0);
    entry.sickDays = Number(document.getElementById('daySickDays').value || 0);
    entry.rangeFrom = document.getElementById('dayRangeFrom').value || date;
    entry.rangeTo = document.getElementById('dayRangeTo').value || date;
    entry.betriebsversammlungTravelAmount = Number(document.getElementById('dayBvTravel').value || 0);
    entry.notes = document.getElementById('dayNotes').value;
    entry.isFahrdienst = document.getElementById('flagFahrdienst').checked;
    entry.isHoliday = document.getElementById('flagHoliday').checked || isBrandenburgHoliday(date);
    entry.isVorfesttag = document.getElementById('flagVorfesttag').checked;
    entry.isSplitShift = document.getElementById('flagSplit').checked;
    entry.isVacation = document.getElementById('flagVacation').checked;
    entry.isSick = document.getElementById('flagSick').checked;
    entry.isBetriebsversammlung = document.getElementById('flagBv').checked;
    entry.isVoluntarySwap = document.getElementById('flagSwap').checked;
    entry.isExtraWork = extraWorkChecked || entry.actualType === 'extra_work';
    entry.isFinal = document.getElementById('flagFinal').checked;
    entry.vacationDays = entry.isVacation ? (entry.vacationDays || 1) : 0;
    entry.sickDays = entry.isSick ? (entry.sickDays || 1) : 0;

    const splitValues = readSplitInlineParts({ completeOnly: true });
    const splitHasAnyInput = hasSplitInlineValues();
    const isSplitEntry = entry.isSplitShift || entry.actualType === 'split_shift' || splitHasAnyInput;
    if (isSplitEntry) {
      if (splitValues.length < 2) {
        alert('Bitte beim geteilten Dienst beide Arbeitszeiträume vollständig eintragen.');
        updateSplitFieldsVisibility();
        syncDayPaidPreview();
        return;
      }
      entry.actualType = 'split_shift';
      entry.isSplitShift = true;
      entry.parts = splitValues;
      entry.startTime = '';
      entry.endTime = '';
      entry.breakMinutes = 0;
      if (['planned', 'open'].includes(entry.status)) entry.status = 'assigned';
    } else {
      entry.parts = [];
    }

    if (entry.actualType === 'free' && !entry.isVacation && !entry.isSick) {
      entry.serviceNumber = '';
      entry.startTime = '';
      entry.endTime = '';
      entry.breakMinutes = 0;
      entry.orderedOvertimeHours = 0;
      entry.isFahrdienst = false;
      entry.isExtraWork = false;
      entry.isSplitShift = false;
      entry.parts = [];
    }

    normalizeFrvActualAssignment(entry);

    if (entry.isVacation || entry.isSick) {
      const mode = entry.isVacation ? 'vacation' : 'sick';
      const baseValues = {
        status: entry.status,
        factorValue: entry.factorValue,
        notes: entry.notes,
        isFinal: entry.isFinal
      };
      applyAbsenceRange(mode, entry.rangeFrom || date, entry.rangeTo || date, baseValues);
      saveState();
      renderAll();
      return;
    }

    saveState(); renderAll();
  }

  function csvValue(value) {
    const raw = value == null ? '' : String(value);
    return '"' + raw.replace(/"/g, '""') + '"';
  }

  function downloadTextFile(filename, content, type = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function buildPayrollDayExportRows(month) {
    return monthDateRange(month).map((date) => {
      const entry = getPayrollSourceEntry(date);
      const template = getTemplateForDate(date);
      const plannedType = template?.templateType || '';
      const holidayName = getHolidayName(date);
      if (!entry) {
        return {
          date,
          weekday: formatDateShort(date),
          plannedType,
          actualType: plannedType === 'free' ? 'free' : '',
          serviceNumber: template?.serviceNumber || '',
          startTime: template?.defaultStartTime || '',
          endTime: template?.defaultEndTime || '',
          breakMinutes: Number(template?.defaultBreakMinutes || 0),
          paidHours: 0,
          holidayName,
          source: plannedType ? 'umlauf' : '',
          final: false,
          vacation: plannedType === 'vacation',
          sick: plannedType === 'sick',
          splitShift: false,
          fahrdienst: !!state.settings.isFahrdienst,
          notes: template?.notes || ''
        };
      }
      return {
        date,
        weekday: formatDateShort(date),
        plannedType: entry.plannedType || plannedType || '',
        actualType: entry.actualType || '',
        serviceNumber: entry.serviceNumber || '',
        startTime: entry.startTime || '',
        endTime: entry.endTime || '',
        breakMinutes: Number(entry.breakMinutes || 0),
        paidHours: round2(calculatePaidMinutes(entry) / 60),
        holidayName,
        source: entry.payrollSource || 'tage',
        final: !!entry.isFinal,
        vacation: !!(entry.isVacation || entry.actualType === 'vacation'),
        sick: !!(entry.isSick || entry.actualType === 'sick'),
        splitShift: !!(entry.isSplitShift || entry.actualType === 'split_shift'),
        fahrdienst: !!entry.isFahrdienst,
        extraWork: !!(entry.isExtraWork || entry.actualType === 'extra_work'),
        voluntarySwap: !!entry.isVoluntarySwap,
        notes: entry.notes || ''
      };
    });
  }

  function buildPayrollExportPayload(month) {
    const payroll = calculatePayroll(month);
    return {
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      month,
      role: currentRole(),
      settings: {
        tariffName: state.settings.tariffName,
        entgeltgruppe: state.settings.entgeltgruppe,
        stufe: state.settings.stufe,
        fixedMonthlyBasePay: state.settings.fixedMonthlyBasePay,
        baseHourRate: state.settings.baseHourRate,
        bonusHourRate: state.settings.bonusHourRate,
        effectiveTariff: payroll.effectiveTariff,
        weeklyHoursContract: state.settings.weeklyHoursContract,
        kvbbgUmlagePercent: state.settings.kvbbgUmlagePercent,
        kvbbgZusatzPercent: state.settings.kvbbgZusatzPercent
      },
      days: buildPayrollDayExportRows(month),
      earnedItems: payroll.earnedItems,
      paidItems: payroll.paidItems,
      gross: payroll.gross,
      deductions: payroll.deductions,
      totalDeductions: payroll.totalDeductions,
      payoutPreview: payroll.payoutPreview,
      statement: payroll.statement || {},
      statementLines: state.statementLines.filter((x) => x.paidMonth === month || x.earnedMonth === month)
    };
  }

  function exportPayrollMonthCsv() {
    if (!canEditPayroll()) return showRoleDenied('Lohnexport');
    const month = document.getElementById('payrollMonth')?.value || currentMonth();
    const payroll = calculatePayroll(month);
    const rows = [];
    rows.push(['Bereich','Monat','Datum','Code','Bezeichnung','Dienst','Status','Beginn','Ende','PauseMin','Stunden','Tage','Prozent','Betrag','Erarbeitet','Ausgezahlt','GE','ST','SV','ZV','Hinweis']);

    buildPayrollDayExportRows(month).forEach((d) => {
      rows.push([
        'Tagesdaten', month, d.date, '', actualLabel(d.actualType || d.plannedType), d.serviceNumber, d.final ? 'final' : 'offen',
        d.startTime, d.endTime, d.breakMinutes, d.paidHours, '', '', '', '', '', '', '', '', '',
        [d.source, d.holidayName, d.vacation ? 'Urlaub' : '', d.sick ? 'Krank' : '', d.splitShift ? 'geteilt' : '', d.extraWork ? 'Zusatzdienst/Einspringen' : '', d.voluntarySwap ? 'frei getauscht' : '', d.notes].filter(Boolean).join(' · ')
      ]);
    });

    payroll.earnedItems.forEach((x) => {
      rows.push(['Erarbeitet', month, '', x.code || '', x.label || '', '', '', '', '', '', x.hours ?? '', x.days ?? '', x.percent ?? '', x.amount ?? '', x.earnedMonth || '', x.paidMonth || '', !!x.counts?.gesamt, !!x.counts?.steuer, !!x.counts?.sv, !!x.counts?.zv, x.reimbursement ? 'Erstattung' : '']);
    });

    payroll.paidItems.forEach((x) => {
      rows.push(['Ausgezahlt', month, '', x.code || '', x.label || '', '', '', '', '', '', x.hours ?? '', x.days ?? '', x.percent ?? '', x.amount ?? '', x.earnedMonth || '', x.paidMonth || '', !!x.counts?.gesamt, !!x.counts?.steuer, !!x.counts?.sv, !!x.counts?.zv, x.reimbursement ? 'Erstattung' : '']);
    });

    Object.entries(payroll.gross).forEach(([key, value]) => rows.push(['Brutto', month, '', key, key, '', '', '', '', '', '', '', '', value, '', month, '', '', '', '', '']));
    Object.entries(payroll.deductions).forEach(([key, value]) => rows.push(['Abzug', month, '', key, key, '', '', '', '', '', '', '', '', value, '', month, '', '', '', '', payroll.deductionMode]));
    rows.push(['Auszahlung', month, '', 'PAYOUT_PREVIEW', 'Geschätzte Auszahlung', '', '', '', '', '', '', '', '', payroll.payoutPreview, '', month, '', '', '', '', '']);

    const csv = rows.map((row) => row.map(csvValue).join(';')).join('\r\n');
    downloadTextFile(`lohnexport-${month}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function exportPayrollMonthJson() {
    if (!canEditPayroll()) return showRoleDenied('Lohnexport');
    const month = document.getElementById('payrollMonth')?.value || currentMonth();
    const payload = buildPayrollExportPayload(month);
    downloadTextFile(`lohnexport-${month}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  }

  function exportPayrollYearCsv() {
    if (!canEditPayroll()) return showRoleDenied('Jahresexport');
    const yRaw = document.getElementById('yearInput')?.value || String(new Date().getFullYear());
    const year = Number(yRaw);
    const rows = [];
    rows.push(['Monat','Plan Gesamtbrutto','Plan Steuerbrutto','Plan SV-Brutto','Plan ZV-Brutto','Plan Abzüge','Plan Auszahlung','Ist Gesamtbrutto','Ist Steuerbrutto','Ist SV-Brutto','Ist ZV-Brutto','Ist Auszahlung','Manuelle Lohnarten']);
    for (let m = 1; m <= 12; m += 1) {
      const month = `${year}-${String(m).padStart(2,'0')}`;
      const payroll = calculatePayroll(month);
      const stmt = state.statements[month] || {};
      rows.push([
        month,
        payroll.gross.gesamt,
        payroll.gross.steuer,
        payroll.gross.sv,
        payroll.gross.zv,
        payroll.totalDeductions,
        payroll.payoutPreview,
        stmt.gesamtBrutto || '',
        stmt.steuerBrutto || '',
        stmt.svBrutto || '',
        stmt.zvBrutto || '',
        stmt.payout || '',
        manualLinesForPaidMonth(month).length
      ]);
    }
    const csv = rows.map((row) => row.map(csvValue).join(';')).join('\r\n');
    downloadTextFile(`jahres-lohnexport-${year}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function saveStatementSummary(e) {
    e.preventDefault();
    if (!canEditPayroll()) return showRoleDenied('Abrechnung speichern');
    const month = document.getElementById('statementMonth').value;
    state.statements[month] = {
      gesamtBrutto: Number(document.getElementById('stmtGesamtBrutto').value || 0),
      steuerBrutto: Number(document.getElementById('stmtSteuerBrutto').value || 0),
      svBrutto: Number(document.getElementById('stmtSvBrutto').value || 0),
      zvBrutto: Number(document.getElementById('stmtZvBrutto').value || 0),
      payout: Number(document.getElementById('stmtPayout').value || 0),
      lohnsteuer: Number(document.getElementById('stmtTax').value || 0),
      kv: Number(document.getElementById('stmtKv').value || 0),
      rv: Number(document.getElementById('stmtRv').value || 0),
      av: Number(document.getElementById('stmtAv').value || 0),
      pv: Number(document.getElementById('stmtPv').value || 0),
      other: Number(document.getElementById('stmtOther').value || 0),
      isCorrection: document.getElementById('stmtCorrection').checked,
      notes: document.getElementById('stmtNotes').value
    };
    saveState(); renderAll();
  }

  function saveStatementLine(e) {
    e.preventDefault();
    if (!canEditPayroll()) return showRoleDenied('Lohnart speichern');
    state.statementLines.push({
      month: document.getElementById('stmtLineMonth').value,
      label: document.getElementById('stmtLineLabel').value,
      amount: Number(document.getElementById('stmtLineAmount').value || 0),
      category: document.getElementById('stmtLineCategory').value,
      earnedMonth: document.getElementById('stmtEarnedMonth').value,
      paidMonth: document.getElementById('stmtPaidMonth').value,
      countsGesamt: document.getElementById('stmtCountGesamt').checked,
      countsSteuer: document.getElementById('stmtCountSteuer').checked,
      countsSv: document.getElementById('stmtCountSv').checked,
      countsZv: document.getElementById('stmtCountZv').checked,
      isOneTime: document.getElementById('stmtIsOneTime').checked,
      isReimbursement: document.getElementById('stmtIsReimbursement').checked
    });
    e.target.reset();
    document.getElementById('stmtCountGesamt').checked = true;
    saveState(); renderStatements(); renderPayroll(); renderYear();
  }
  function deleteStatementLine(e) {
    if (!canEditPayroll()) return showRoleDenied('Lohnart löschen');
    if (!e.target.classList.contains('delete-line')) return;
    state.statementLines.splice(Number(e.target.dataset.idx),1);
    saveState(); renderStatements(); renderPayroll(); renderYear();
  }

  function saveSettings(e) {
    e.preventDefault();
    if (!canEditSettings()) return showRoleDenied('Einstellungen speichern');
    state.settings.tariffName = document.getElementById('setTariffName').value;
    state.settings.tariffTableKey = document.getElementById('setTariffTable')?.value || state.settings.tariffTableKey || '2025-01-01_39';
    state.settings.entgeltgruppe = document.getElementById('setGroup').value;
    state.settings.stufe = Number(document.getElementById('setStep').value || 1);
    state.settings.weeklyHoursContract = Number(document.getElementById('setWeeklyHours').value || 39);
    state.settings.weeklyHoursCycleAvg = document.getElementById('setCycleAvg').value;
    state.settings.fixedMonthlyBasePay = Number(document.getElementById('setBasePay').value || 3022);
    state.settings.baseHourRate = Number(document.getElementById('setBaseRate').value || 17.82);
    state.settings.bonusHourRate = Number(document.getElementById('setBonusRate').value || 18.18);
    state.settings.frvPlaceholderMinutes = parseDurationMinutes(document.getElementById('setFrvMinutes').value) ?? 468;
    state.settings.kvbbgUmlagePercent = Number(document.getElementById('setKvbbgUmlage').value || 0.55);
    state.settings.kvbbgZusatzPercent = Number(document.getElementById('setKvbbgZusatz').value || 2.40);
    state.settings.taxClass = document.getElementById('setTaxClass')?.value || '1';
    state.settings.estimatedTaxPercent = Number(document.getElementById('setTaxPercent').value || getTaxProfile(state.settings.taxClass).estimatedTaxPercent || 0);
    state.settings.healthInsurance = document.getElementById('setHealthInsurance')?.value || 'custom';
    const selectedHealthProfile = getHealthInsuranceProfile(state.settings.healthInsurance);
    let healthAdditional = Number(document.getElementById('setHealthAdditionalPercent')?.value || state.settings.healthAdditionalPercent || 0);
    if (selectedHealthProfile.additionalPercent != null) healthAdditional = selectedHealthProfile.additionalPercent;
    state.settings.healthAdditionalPercent = healthAdditional;
    state.settings.estimatedHealthPercent = Number(document.getElementById('setHealthPercent').value || calculateHealthEmployeePercent(healthAdditional));
    state.settings.estimatedPensionPercent = Number(document.getElementById('setPensionPercent').value || 0);
    state.settings.estimatedUnemploymentPercent = Number(document.getElementById('setUnemploymentPercent').value || 0);
    state.settings.estimatedCarePercent = Number(document.getElementById('setCarePercent').value || 0);
    state.settings.estimatedChurchPercent = Number(document.getElementById('setChurchPercent').value || 0);
    state.settings.estimatedSoliPercent = Number(document.getElementById('setSoliPercent').value || 0);
    state.settings.preferActualDeductions = !!document.getElementById('setPreferActualDeductions').checked;
    state.settings.calendarName = document.getElementById('setCalendarName').value;
    state.settings.reminderMinutes = Number(document.getElementById('setReminder').value || 30);
    saveState(); renderAll();
  }

  function exportBackup() {
    if (!canBackupData()) return showRoleDenied('Backup exportieren');
    state = normalizeStateObject(stripRemovedFeatures(state));
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'dienstplanung-gehalt-backup.json'; a.click();
    URL.revokeObjectURL(url);
  }
  function importBackup(e) {
    if (!canBackupData()) return showRoleDenied('Backup wiederherstellen');
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { state = normalizeStateObject(stripRemovedFeatures(JSON.parse(String(reader.result)))); saveState(); renderAll(); alert('Backup importiert.'); }
      catch { alert('Backup konnte nicht gelesen werden.'); }
    };
    reader.readAsText(file);
  }
  async function resetAll() {
    if (!canBackupData()) return showRoleDenied('App-Daten zurücksetzen');
    const confirmation = prompt('Zum Zurücksetzen bitte exakt LÖSCHEN eingeben. Dadurch werden lokale Zwischendaten und der Cloud-Stand auf den leeren Standard gesetzt.');
    if (confirmation !== 'LÖSCHEN') return;
    state = defaultState();
    saveState({ skipCloud: true });
    renderAll();
    try {
      await cloudSpeichern();
      alert('App-Daten wurden zurückgesetzt und online gespeichert.');
    } catch (error) {
      console.error(error);
      alert('Lokal zurückgesetzt, aber die Cloud konnte nicht aktualisiert werden.');
      setSyncStatus('Zurückgesetzt · Cloud-Update fehlgeschlagen', 'danger');
    }
  }

  function loadDemo() {
    if (!canBackupData()) return showRoleDenied('Demo-Daten laden');
    state = defaultState();
    state.settings.taxClass = '1';
    state.settings.estimatedTaxPercent = 8.0;
    state.settings.healthInsurance = 'custom';
    state.settings.healthAdditionalPercent = 1.70;
    state.settings.estimatedHealthPercent = 8.15;
    state.settings.estimatedPensionPercent = 9.30;
    state.settings.estimatedUnemploymentPercent = 1.30;
    state.settings.estimatedCarePercent = 2.40;
    getActiveRotationWeeks()[0].days[0] = { weekdayName:'Montag', weekdayIndex:0, templateType:'fixed', defaultStartTime:'05:12', defaultEndTime:'13:46', defaultBreakMinutes:30, defaultPaidMinutes:484, serviceNumber:'4011', notes:'Frühdienst' };
    getActiveRotationWeeks()[0].days[1] = { weekdayName:'Dienstag', weekdayIndex:1, templateType:'frv', defaultStartTime:'', defaultEndTime:'', defaultBreakMinutes:0, defaultPaidMinutes:468, serviceNumber:'', notes:'FRV offen' };
    getActiveRotationWeeks()[0].days[2] = { weekdayName:'Mittwoch', weekdayIndex:2, templateType:'fixed', defaultStartTime:'12:10', defaultEndTime:'20:55', defaultBreakMinutes:40, defaultPaidMinutes:485, serviceNumber:'4022', notes:'Spätdienst' };
    state.dayEntries['2026-05-05'] = {
      date:'2026-05-05', plannedType:'fixed', serviceNumber:'4011', status:'final', actualType:'fixed', startTime:'05:12', endTime:'13:46', breakMinutes:30,
      frvMinutes:468, isFahrdienst:true, isHoliday:false, isVorfesttag:false, isSplitShift:false, isVacation:false, isSick:false,
      isBetriebsversammlung:false, isVoluntarySwap:false, isFinal:true, orderedOvertimeHours:0, factorValue:0, vacationDays:0, sickDays:0, parts:[], notes:'', betriebsversammlungTravelAmount:0
    };
    state.dayEntries['2026-05-06'] = {
      date:'2026-05-06', plannedType:'frv', serviceNumber:'', status:'open', actualType:'frv_open', startTime:'', endTime:'', breakMinutes:0,
      frvMinutes:468, isFahrdienst:true, isHoliday:false, isVorfesttag:false, isSplitShift:false, isVacation:false, isSick:false,
      isBetriebsversammlung:false, isVoluntarySwap:false, isFinal:false, orderedOvertimeHours:0, factorValue:0, vacationDays:0, sickDays:0, parts:[], serviceNumber:'', notes:'FRV offen', betriebsversammlungTravelAmount:0
    };
    state.dayEntries['2026-05-10'] = {
      date:'2026-05-10', plannedType:'fixed', serviceNumber:'4701', status:'final', actualType:'holiday_work', startTime:'06:00', endTime:'13:27', breakMinutes:0,
      frvMinutes:468, isFahrdienst:true, isHoliday:true, isVorfesttag:false, isSplitShift:false, isVacation:false, isSick:false,
      isBetriebsversammlung:false, isVoluntarySwap:false, isFinal:true, orderedOvertimeHours:0, factorValue:0, vacationDays:0, sickDays:0, parts:[], notes:'Feiertag', betriebsversammlungTravelAmount:0
    };
    state.dayEntries['2026-05-12'] = {
      date:'2026-05-12', plannedType:'fixed', serviceNumber:'5102', status:'final', actualType:'split_shift', startTime:'', endTime:'', breakMinutes:0,
      frvMinutes:468, isFahrdienst:true, isHoliday:false, isVorfesttag:false, isSplitShift:true, isVacation:false, isSick:false,
      isBetriebsversammlung:false, isVoluntarySwap:false, isFinal:true, orderedOvertimeHours:1.25, factorValue:0, vacationDays:0, sickDays:0,
      parts:[{startTime:'04:55',endTime:'09:10',breakMinutes:0},{startTime:'13:20',endTime:'17:05',breakMinutes:0}], notes:'Geteilter Dienst', betriebsversammlungTravelAmount:0
    };
    state.dayEntries['2026-05-20'] = {
      date:'2026-05-20', plannedType:'vacation', serviceNumber:'', status:'final', actualType:'vacation', startTime:'', endTime:'', breakMinutes:0,
      frvMinutes:468, isFahrdienst:false, isHoliday:false, isVorfesttag:false, isSplitShift:false, isVacation:true, isSick:false,
      isBetriebsversammlung:false, isVoluntarySwap:false, isFinal:true, orderedOvertimeHours:0, factorValue:0.87, vacationDays:4, sickDays:0, parts:[], notes:'Urlaub', betriebsversammlungTravelAmount:0
    };
    state.dayEntries['2026-05-26'] = {
      date:'2026-05-26', plannedType:'sick', serviceNumber:'', status:'final', actualType:'sick', startTime:'', endTime:'', breakMinutes:0,
      frvMinutes:468, isFahrdienst:false, isHoliday:false, isVorfesttag:false, isSplitShift:false, isVacation:false, isSick:true,
      isBetriebsversammlung:false, isVoluntarySwap:false, isFinal:true, orderedOvertimeHours:0, factorValue:0.41, vacationDays:0, sickDays:2, parts:[], notes:'Krank', betriebsversammlungTravelAmount:0
    };
    state.statementLines.push({ month:'2026-05', label:'Tarifliche Sonderzahlung', amount:160, category:'tariff_special', earnedMonth:'2026-05', paidMonth:'2026-05', countsGesamt:true, countsSteuer:true, countsSv:true, countsZv:true, isOneTime:true, isReimbursement:false });
    state.statementLines.push({ month:'2026-05', label:'FK Betriebsversammlung', amount:35.66, category:'reimbursement', earnedMonth:'2026-05', paidMonth:'2026-05', countsGesamt:false, countsSteuer:false, countsSv:false, countsZv:false, isOneTime:false, isReimbursement:true });
    state.statements['2026-05'] = { gesamtBrutto: 3480.22, steuerBrutto: 3290.35, svBrutto: 3290.35, zvBrutto: 3365.91, payout: 2304.66, lohnsteuer: 352.16, kv: 270.58, rv: 299.93, av: 41.93, pv: 77.40, other: 35.66, isCorrection:false, notes:'Demo-Abrechnung' };
    saveState(); renderAll(); alert('Demo-Daten geladen.');
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    handleResponsiveMenuState();
    renderAppVersion();
    initCloud();
  });
})();
