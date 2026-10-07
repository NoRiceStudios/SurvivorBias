/**
 * The nations at war. Each has its own names and paint, and (in a campaign
 * started with factions) its own strengths and weaknesses: an economy, an air
 * force and a High Command that push it towards a way of fighting.
 *
 * A side without a `faction` (saves from before factions, or a classic game)
 * takes its names from its seat (Aldmere or the Directorate) and plays by the
 * symmetric rules.
 */
import { AIRCRAFT, type AircraftSpec, type ResearchItem, type TechKey } from './data';
import type { AircraftKind, Archetype, NationId, SideId, ZoneMap } from './types';

export interface NationRules {
  /** Developments in hand from the first week. */
  research: string[];
  /** Price multiplier on particular developments. */
  researchCost: Record<string, number>;
  /** Innate effects, added to what research gives (see `tech()`). */
  effects: Partial<Record<TechKey, number>>;
  /** Multiplier on High Command's weekly supplies. */
  supplies: number;
  /** Supplies that arrive every week whatever High Command thinks. */
  lendLease: number;
  /** Multiplier on weekly stores deliveries. */
  stores: number;
  storesCap: number;
  /** Multiplier on replacement aircrew posted. */
  replacements: number;
  /** Multiplier on the price of new aircraft. */
  aircraftCost: number;
  /** Plates added to (or taken from) each type's armor budget. */
  armor: Partial<Record<AircraftKind, number>>;
  /** Sectors added to (or taken from) the fighters' escort range. */
  escort: number;
  /** Multiplier on High Command's gains in confidence. */
  trustGain: number;
  /** Multiplier on every change in confidence, up or down. */
  trustSwing: number;
  /** How far leaders' reports stray from the truth (1 = as their archetype). */
  bias: number;
  /** Relative chance of each archetype when a leader is appointed. */
  leaders: Record<Archetype, number>;
  /** Hidden: multiplier on each zone's lethality, from how the nation builds its aircraft. */
  lethality: Partial<ZoneMap<number>>;
  /** Multiplier on hidden defects from the works. */
  defects: number;
  /** Multiplier on what crews learn from each operation. */
  experience: number;
  /** Strength of the home flak at the start (0.5 is the usual). */
  flak: number;
  /** The wing at the start of the war. */
  squadrons: [AircraftKind, number][];
  /** How the AI commands this nation (see `AiProfile`). */
  ai: AiProfile;
}

/**
 * How an AI commander plays a nation to its strengths: what it develops first,
 * how large a wing it keeps, how it spends and how it fights.
 */
export interface AiProfile {
  /** Developments pursued first, in order; anything else open follows, cheapest first. */
  research: string[];
  /** Fighters kept before bombers are bought, in the first act (two more each act). */
  fighters: number;
  /** Bombers wanted once the fighters are in hand. */
  bombers: number;
  /** Aircraft ordered in a week, at most. */
  orders: number;
  /** Supplies held back from aircraft orders. */
  reserve: number;
  /** Chance a bomber order is a heavy, once the four-engine airframe is in hand. */
  heavy: number;
  /** Supplies on hand before the works are enlarged. */
  factoryAt: number;
  /** Supplies on hand before the home flak is strengthened. */
  flakAt: number;
  /** Weeks between re-plating the squadrons. */
  replate: number;
  /** Share of the depot below which a convoy is bought. */
  convoyAt: number;
  /** Chance a recon sortie flies in a week. */
  recon: number;
  /** Multiplier on the chance the bombers go to close support rather than a strike. */
  support: number;
  /** Multiplier on strikes on the enemy's works (industry and fuel) when choosing a site. */
  works: number;
  /** Chance a second fighter squadron patrols over a site the enemy may strike. */
  cover: number;
  /** Added to every squadron's aggression. */
  aggression: number;
}

/** The AI as it played before nations: a balanced wing, the classic research order. */
export const CLASSIC_AI: AiProfile = {
  research: ['radar', 'gunneryManual', 'dropTanks', 'selfSealing', 'powerTurrets', 'gunCameras', 'photoRecon', 'gyroSight', 'engineTuning', 'armorAlloy', 'assembly1', 'radios', 'extinguishers', 'bombsight2', 'intelOfficer', 'radarChain', 'heavyAirframe'],
  fighters: 14,
  bombers: 12,
  orders: 4,
  reserve: 90,
  heavy: 0.5,
  factoryAt: 260,
  flakAt: 240,
  replate: 3,
  convoyAt: 0.4,
  recon: 0.6,
  support: 1,
  works: 1,
  cover: 0.65,
  aggression: 0,
};

export interface Nation {
  id: NationId;
  name: string;
  short: string;
  /** The wing a commander of this nation is given. */
  wing: string;
  /** How a human commander is addressed by default, and the AI's commander. */
  title: string;
  aiCommander: string;
  aircraft: Record<AircraftKind, string>;
  firstNames: string[];
  lastNames: string[];
  crewFirst: string[];
  crewLast: string[];
  /** Squadron commanders' ranks, most junior first. */
  ranks: string[];
  /** Aircrew ranks for captains, and the junior ones for men who appear in scenes. */
  crewRanks: string[];
  juniorRanks: string[];
  squadronNames: string[];
  callsigns: string[];
  serial: (n: number) => string;
  /** Station life, for the scenes between operations. */
  local: { mess: string; money: string; padre: string; drink: string; song: string; town: string; cards: string };
  /** For the choice of nation: one line, then what it is good and bad at. */
  blurb: string;
  strengths: string[];
  weaknesses: string[];
  rules: NationRules;
}

const EVEN: Record<Archetype, number> = { braggart: 1, pessimist: 1, gloryHunter: 1, byTheBook: 1, timid: 1 };

/** The symmetric rules every side played by before factions. */
export const CLASSIC: NationRules = {
  research: [],
  researchCost: {},
  effects: {},
  supplies: 1,
  lendLease: 0,
  stores: 1,
  /** Keep in step with STORES_CAP in `turn.ts` (a test checks it); importing it here would be a cycle. */
  storesCap: 150,
  replacements: 1,
  aircraftCost: 1,
  armor: {},
  escort: 0,
  trustGain: 1,
  trustSwing: 1,
  bias: 1,
  leaders: EVEN,
  lethality: {},
  defects: 1,
  experience: 1,
  flak: 0.5,
  squadrons: [['fighter', 8], ['fighter', 8], ['medium', 6], ['medium', 6]],
  ai: CLASSIC_AI,
};

const ALDMERE_LETTERS = 'ABCDEFGHJKLMNPRSTVWX';
const DIRECTORATE_LETTERS = 'ABCDEFGHKLMNPRSTUVWZ';
const VARN_LETTERS = 'ABDEFGHJKLMNOPRSTUVY';

export const NATIONS: Record<NationId, Nation> = {
  aldmere: {
    id: 'aldmere',
    name: 'Commonwealth of Aldmere',
    short: 'Aldmere',
    wing: 'No. 7 Composite Wing',
    title: 'Air Commodore',
    aiCommander: 'Air Commodore Hugh Penrose',
    aircraft: { fighter: 'Kestrel Mk.II', medium: 'Harrow B.III', heavy: 'Colossus B.I', recon: 'Swift PR.I' },
    firstNames: ['Arthur', 'Edmund', 'Hugh', 'Walter', 'Percy', 'Roland', 'Cecil', 'Douglas', 'Leonard', 'Harold', 'Ivor', 'Rupert', 'Giles', 'Neville', 'Clive', 'Desmond'],
    lastNames: ['Ashworth', 'Penrose', 'Hale', 'Brackley', 'Carrow', 'Thorne', 'Mabey', 'Fenwick', 'Lisle', 'Wexford', 'Dunmore', 'Ridley', 'Sallow', 'Pryce', 'Cobham', 'Garside', 'Aldridge', 'Bancroft', 'Blakeney', 'Brereton', 'Calloway', 'Carver', 'Chalcott', 'Coverley', 'Dacre', 'Danvers', 'Ellerby', 'Fairbairn', 'Farrant', 'Gilchrist', 'Granville', 'Hadley', 'Harcourt', 'Hensley', 'Keswick', 'Lancing', 'Latimer', 'Linley', 'Maitland', 'Marlowe', 'Melbury', 'Northcote', 'Ormsby', 'Pagett', 'Pelham', 'Quarrie', 'Radcliffe', 'Rawdon', 'Selwyn', 'Shelford', 'Stanmore', 'Tavener', 'Thursby', 'Trevelyan', 'Upton', 'Vane', 'Verity', 'Waverley', 'Westlake', 'Whitcombe', 'Wraxall', 'Yardley'],
    crewFirst: ['Albert', 'Alfred', 'Bernard', 'Charles', 'Colin', 'Dennis', 'Derek', 'Donald', 'Eric', 'Ernest', 'Frank', 'Frederick', 'Geoffrey', 'George', 'Gordon', 'Henry', 'Herbert', 'Jack', 'James', 'John', 'Kenneth', 'Lionel', 'Maurice', 'Norman', 'Patrick', 'Peter', 'Ralph', 'Raymond', 'Reginald', 'Robert', 'Ronald', 'Sidney', 'Stanley', 'Thomas', 'Victor', 'William'],
    crewLast: ['Abbott', 'Archer', 'Bailey', 'Barker', 'Bennett', 'Bishop', 'Booth', 'Bradshaw', 'Burton', 'Chapman', 'Clarke', 'Collins', 'Cooper', 'Dawson', 'Dixon', 'Ellis', 'Fletcher', 'Foster', 'Gibson', 'Graham', 'Harding', 'Harper', 'Hayes', 'Holmes', 'Hughes', 'Jennings', 'Kemp', 'Lawrence', 'Lloyd', 'Marsh', 'Mason', 'Morgan', 'Newman', 'Osborne', 'Parker', 'Payne', 'Porter', 'Reed', 'Rowe', 'Shaw', 'Spencer', 'Stevens', 'Turner', 'Walsh', 'Ward', 'Webb', 'Wells', 'Wood', 'Atkins', 'Baxter', 'Bell', 'Brooks', 'Carter', 'Cole', 'Cross', 'Dale', 'Day', 'Doyle', 'Edwards', 'Evans', 'Farmer', 'Ford', 'Fox', 'Gardner', 'Gray', 'Green', 'Hall', 'Hart', 'Hill', 'Hunt', 'Jarvis', 'Kelly', 'King', 'Knight', 'Lane', 'Long', 'Lucas', 'Mills', 'Moore', 'Nash', 'Nicholls', 'Owen', 'Page', 'Palmer', 'Pearce', 'Price', 'Rees', 'Rose', 'Ross', 'Russell', 'Simmons', 'Stone', 'Swift', 'Tucker', 'Wade', 'Watts', 'West', 'Wilkins', 'Wright', 'Young'],
    ranks: ['Flt Lt', 'Sqn Ldr', 'Wg Cdr'],
    crewRanks: ['Plt Off', 'Fg Off', 'Flt Lt', 'Sgt', 'Flt Sgt', 'WO'],
    juniorRanks: ['Plt Off', 'Sgt', 'Fg Off'],
    squadronNames: ['No. 41 "Lanterns"', 'No. 112 "Old Crows"', 'No. 9 "Ploughmen"', 'No. 207 "Nightjars"', 'No. 73 "Saints"', 'No. 18 "Ferrymen"', 'No. 304 "Harriers"', 'No. 61 "Long Odds"', 'No. 15 "Vespers"', 'No. 88 "Tinkers"'],
    callsigns: ['Lantern', 'Crow', 'Plough', 'Nightjar', 'Saint', 'Ferry', 'Harrier', 'Odds', 'Vesper', 'Tinker'],
    local: { mess: 'the mess', money: 'shillings', padre: 'the padre', drink: 'warm beer', song: '"A Nightingale Sang"', town: 'the village pub', cards: 'brag' },
    serial: (n) => `${ALDMERE_LETTERS[n % 20]}${ALDMERE_LETTERS[(n * 7) % 20]}-${100 + ((n * 37) % 900)}`,
    blurb: 'The radar net. Sees the enemy coming and the war more clearly than anyone, but hits back softly.',
    strengths: [
      'Ground radar and photo reconnaissance from the first week; defenders intercept 15% more often',
      'Disciplined leaders: reports stray from the truth a third less',
      'Photographs of every target: bombs do 10% more damage',
      'Staff work and cruise discipline: every sortie uses 8% fewer stores',
      'Recon aircraft are caught less often, and more lost crews come home',
    ],
    weaknesses: [
      'Bombers carry 5% less',
      'A sceptical Air Ministry: confidence grows only 90% as fast',
    ],
    rules: {
      ...CLASSIC,
      research: ['radar', 'photoRecon'],
      effects: { detection: 0.15, stealth: 0.2, escape: 0.1, accuracy: 0.1, economy: 0.08, payload: -0.05 },
      trustGain: 0.9,
      bias: 0.67,
      leaders: { braggart: 0.6, pessimist: 1, gloryHunter: 0.7, byTheBook: 1.6, timid: 1 },
      // Builds on the radar net and the cameras: meets raids over the target it expects,
      // photographs what it hits and goes after the enemy's works with accurate bombing
      // rather than the front. Crews that come home can be asked to press a little harder.
      ai: {
        ...CLASSIC_AI,
        research: ['gunneryManual', 'dropTanks', 'selfSealing', 'powerTurrets', 'bombsight2', 'gunCameras', 'gyroSight', 'radarChain', 'engineTuning', 'armorAlloy', 'assembly1', 'radios', 'extinguishers', 'targetMarkers', 'intelOfficer', 'heavyAirframe'],
        recon: 0.9,
        cover: 0.9,
        support: 0.6,
        works: 1.6,
        aggression: 0.15,
      },
    },
  },
  directorate: {
    id: 'directorate',
    name: 'Northern Directorate',
    short: 'Directorate',
    wing: 'Kampfgeschwader Nord',
    title: 'Oberst',
    aiCommander: 'Oberst Reinhold Kranz',
    aircraft: { fighter: 'Falke-7', medium: 'Kormoran K-2', heavy: 'Gigant G-4', recon: 'Elster A-1' },
    firstNames: ['Anton', 'Ewald', 'Gerrit', 'Lothar', 'Matthis', 'Konrad', 'Henrik', 'Jaro', 'Ulrich', 'Waldemar', 'Bastian', 'Falk', 'Emil', 'Reinhold', 'Torben', 'Viktor'],
    lastNames: ['Kessler', 'Brandt', 'Voigt', 'Ahlers', 'Reinke', 'Strahl', 'Lindqvist', 'Haber', 'Ostrow', 'Falkner', 'Merz', 'Rauch', 'Tiede', 'Brückner', 'Sommer', 'Kranz', 'Adler', 'Bergmann', 'Bohlen', 'Dorn', 'Eckhart', 'Falk', 'Gerlach', 'Hagen', 'Heller', 'Hollmann', 'Jäger', 'Kemper', 'Kohl', 'Landau', 'Lenz', 'Marquardt', 'Nagel', 'Oberle', 'Pfeiffer', 'Quandt', 'Reuter', 'Ritter', 'Sander', 'Seeger', 'Stein', 'Thalmann', 'Ulrich', 'Vogt', 'Wendt', 'Winkler', 'Zander', 'Arndt', 'Baumann', 'Dressler', 'Eichler', 'Fendt', 'Grote', 'Henning', 'Ihlenfeld', 'Kessel', 'Lüders', 'Mahler', 'Nolte', 'Pahl', 'Rehberg', 'Schott'],
    crewFirst: ['Alfons', 'Bruno', 'Dieter', 'Egon', 'Erich', 'Ernst', 'Franz', 'Friedrich', 'Fritz', 'Georg', 'Gerhard', 'Günther', 'Hans', 'Heinz', 'Helmut', 'Herbert', 'Horst', 'Johann', 'Josef', 'Karl', 'Klaus', 'Kurt', 'Ludwig', 'Manfred', 'Max', 'Otto', 'Paul', 'Peter', 'Richard', 'Rudolf', 'Siegfried', 'Walter', 'Werner', 'Wilhelm', 'Willi', 'Wolfgang'],
    crewLast: ['Albrecht', 'Bauer', 'Beck', 'Berger', 'Busch', 'Dietrich', 'Ebert', 'Engel', 'Fischer', 'Frank', 'Fuchs', 'Graf', 'Hahn', 'Hartmann', 'Hoffmann', 'Huber', 'Jung', 'Kaiser', 'Keller', 'Klein', 'Koch', 'König', 'Krause', 'Kuhn', 'Lang', 'Lehmann', 'Lorenz', 'Maier', 'Meyer', 'Möller', 'Neumann', 'Peters', 'Pohl', 'Richter', 'Roth', 'Schäfer', 'Schmitt', 'Schneider', 'Schulz', 'Schwarz', 'Seidel', 'Thiel', 'Vogel', 'Wagner', 'Weber', 'Werner', 'Winter', 'Wolf', 'Albers', 'Arnold', 'Bach', 'Beyer', 'Brandt', 'Dahl', 'Ernst', 'Franke', 'Friedrich', 'Geiger', 'Hesse', 'Horn', 'Jansen', 'Kraft', 'Krüger', 'Kühn', 'Lange', 'Lindner', 'Ludwig', 'Martin', 'Mayer', 'Otto', 'Paul', 'Pieper', 'Ramm', 'Rieger', 'Sauer', 'Scholz', 'Seidl', 'Simon', 'Sommerfeld', 'Stahl', 'Thomas', 'Unger', 'Vetter', 'Voss', 'Walter', 'Weiss', 'Wolff', 'Ziegler', 'Brauer', 'Fink', 'Haas', 'Kurz', 'Lindemann', 'Möbius', 'Nowak', 'Pohle', 'Reich', 'Schuster'],
    ranks: ['Hauptmann', 'Major', 'Oberst'],
    crewRanks: ['Leutnant', 'Oberleutnant', 'Feldwebel', 'Unteroffizier', 'Oberfeldwebel'],
    juniorRanks: ['Leutnant', 'Feldwebel', 'Unteroffizier'],
    squadronNames: ['Staffel Grau', 'Staffel Anker', 'Staffel Eis', 'Staffel Hammer', 'Staffel Ruß', 'Staffel Pflug', 'Staffel Nord', 'Staffel Auge', 'Staffel Hagel', 'Staffel Kreuz'],
    callsigns: ['Grau', 'Anker', 'Eis', 'Hammer', 'Ruß', 'Pflug', 'Nord', 'Auge', 'Hagel', 'Kreuz'],
    local: { mess: 'the Kasino', money: 'marks', padre: 'the chaplain', drink: 'thin coffee', song: '"Lili Marleen"', town: 'the inn in the valley', cards: 'Skat' },
    serial: (n) => `${10 + (n % 89)}+${DIRECTORATE_LETTERS[(n * 3) % 20]}${DIRECTORATE_LETTERS[(n * 11) % 20]}`,
    blurb: 'The elite. Few, superb, heavily armored aircraft, flown by crews who learn fast, on too little fuel.',
    strengths: [
      'One more armor plate on every type (two on the heavy bomber), and an armored seat as standard',
      'Fighters and gunners hit 5% more often; gyro sight and cannon at half price',
      'Stressed-skin airframes carry plate better: 30% less of its weight penalty',
      'Crews learn half as fast again from every operation',
    ],
    weaknesses: [
      'Short of fuel: 20% less of the weekly ration, and the depots hold only 110',
      'Aircraft cost a quarter more, and the works are 15% slower',
      'Few replacements: 30% fewer aircrew are posted',
      'A fanatical High Command: confidence swings half as hard again, both ways',
    ],
    rules: {
      ...CLASSIC,
      researchCost: { gyroSight: 0.5, cannon: 0.5 },
      effects: { hits: 0.05, production: -0.15, plateWeight: 0.3 },
      stores: 0.8,
      storesCap: 110,
      replacements: 0.7,
      aircraftCost: 1.25,
      armor: { fighter: 1, medium: 1, heavy: 2, recon: 1 },
      trustSwing: 1.5,
      lethality: { cockpit: 0.7 },
      experience: 1.5,
      // A small wing of dear, heavily plated aircraft whose crews are worth keeping alive:
      // guns and plate first, few orders, regular re-plating, and every drop of fuel watched.
      ai: {
        ...CLASSIC_AI,
        research: ['gunneryManual', 'gyroSight', 'cannon', 'fuelEconomy', 'armorAlloy', 'selfSealing', 'powerTurrets', 'pooledStores', 'dropTanks', 'escapeHatches', 'radar', 'heavyAirframe'],
        fighters: 12,
        bombers: 10,
        orders: 2,
        reserve: 120,
        heavy: 0.3,
        factoryAt: 320,
        replate: 2,
        convoyAt: 0.5,
        aggression: 0.05,
      },
    },
  },
  varn: {
    id: 'varn',
    name: 'League of Varn',
    short: 'Varn',
    wing: 'Flygruppe Vest',
    title: 'Oberstløytnant',
    aiCommander: 'Oberst Halvard Moe',
    aircraft: { fighter: 'Varg J-21', medium: 'Terne B-5', heavy: 'Mammut B-9', recon: 'Lom F-3' },
    firstNames: ['Arne', 'Bjørn', 'Einar', 'Finn', 'Gunnar', 'Halvard', 'Ivar', 'Jens', 'Knut', 'Leif', 'Magnus', 'Nils', 'Olav', 'Rune', 'Sverre', 'Trygve'],
    lastNames: ['Aasen', 'Bakke', 'Berge', 'Brekke', 'Dahle', 'Eide', 'Fjeld', 'Fossum', 'Gran', 'Haugen', 'Helle', 'Holm', 'Hovland', 'Kvam', 'Krogh', 'Lie', 'Lunde', 'Moe', 'Myhre', 'Nygaard', 'Opsahl', 'Rask', 'Rønning', 'Sandvik', 'Skaug', 'Solberg', 'Stene', 'Strand', 'Sæther', 'Tangen', 'Thorsen', 'Tveit', 'Ulvik', 'Vik', 'Wold', 'Aune', 'Bratli', 'Engen', 'Furu', 'Grønli', 'Hagerup', 'Jevne', 'Kleiven', 'Lien', 'Mork', 'Nesse', 'Olsrud', 'Ramberg', 'Rustad', 'Skjold'],
    crewFirst: ['Asbjørn', 'Birger', 'Dag', 'Egil', 'Erling', 'Frode', 'Geir', 'Hans', 'Harald', 'Helge', 'Hjalmar', 'Jon', 'Kåre', 'Kjell', 'Lars', 'Martin', 'Odd', 'Ole', 'Paul', 'Per', 'Ragnar', 'Reidar', 'Roald', 'Sigurd', 'Steinar', 'Svein', 'Terje', 'Thor', 'Torleif', 'Ulf'],
    crewLast: ['Andersen', 'Bakken', 'Berg', 'Christensen', 'Dahl', 'Eriksen', 'Evensen', 'Fredriksen', 'Gundersen', 'Halvorsen', 'Hansen', 'Henriksen', 'Iversen', 'Jacobsen', 'Johansen', 'Karlsen', 'Kristiansen', 'Larsen', 'Lund', 'Martinsen', 'Moen', 'Nielsen', 'Nilsen', 'Olsen', 'Paulsen', 'Pedersen', 'Ruud', 'Sørensen', 'Strøm', 'Svendsen', 'Thorvaldsen', 'Amundsen', 'Brun', 'Dalen', 'Ellingsen', 'Fosse', 'Hauge', 'Hegge', 'Jensen', 'Knutsen', 'Lia', 'Mathisen', 'Næss', 'Ottesen', 'Rasmussen', 'Sletten', 'Solheim', 'Torgersen', 'Vold', 'Østby'],
    ranks: ['Kaptein', 'Major', 'Oberstløytnant'],
    crewRanks: ['Fenrik', 'Løytnant', 'Sersjant', 'Korporal', 'Kvartermester'],
    juniorRanks: ['Fenrik', 'Sersjant', 'Korporal'],
    squadronNames: ['Skvadron Ørn', 'Skvadron Ravn', 'Skvadron Ulv', 'Skvadron Fjord', 'Skvadron Storm', 'Skvadron Bjørn', 'Skvadron Trane', 'Skvadron Lyn', 'Skvadron Måke', 'Skvadron Fyr'],
    callsigns: ['Ørn', 'Ravn', 'Ulv', 'Fjord', 'Storm', 'Bjørn', 'Trane', 'Lyn', 'Måke', 'Fyr'],
    local: { mess: 'the messe', money: 'kroner', padre: 'the pastor', drink: 'aquavit', song: '"Kjerringa med staven"', town: 'the harbour tavern', cards: 'whist' },
    serial: (n) => `${VARN_LETTERS[(n * 13) % 20]}-${200 + ((n * 41) % 800)}`,
    blurb: 'Mass and supply. Cheap aircraft by the hundred and convoys from overseas, built in a hurry and flown by braggarts.',
    strengths: [
      'Works 15% faster, aircraft 15% cheaper, and the four-engine airframe and assembly lines at half price',
      'Lend-lease: 25 supplies every week, whatever High Command thinks',
      '25% more replacement aircrew, and a third fighter squadron at the start',
    ],
    weaknesses: [
      'Hurried building: more hidden defects at every inspection standard',
      'One armor plate less on every type, and fuel tanks that burn more easily',
      'Weaker training and flak',
      'Showmen and glory-seekers lead more of the squadrons: the survivors\' picture is more flattering',
    ],
    rules: {
      ...CLASSIC,
      researchCost: { heavyAirframe: 0.5, assembly1: 0.5, assembly2: 0.5 },
      effects: { production: 0.15, training: -0.06 },
      lendLease: 25,
      replacements: 1.25,
      aircraftCost: 0.85,
      armor: { fighter: -1, medium: -1, heavy: -1 },
      leaders: { braggart: 1.8, pessimist: 0.7, gloryHunter: 1.6, byTheBook: 0.5, timid: 0.8 },
      lethality: { fuel: 1.2 },
      defects: 2,
      flak: 0.4,
      squadrons: [['fighter', 8], ['fighter', 8], ['fighter', 6], ['medium', 6], ['medium', 6]],
      // Numbers: assembly lines and the four-engine airframe first, the works enlarged early
      // and losses replaced fast, and crews that are expected to press home. Plate is thin, so
      // it is seldom moved; fire is its killer, so tanks and extinguishers come early.
      ai: {
        ...CLASSIC_AI,
        research: ['assembly1', 'heavyAirframe', 'assembly2', 'selfSealing', 'extinguishers', 'gunneryManual', 'dropTanks', 'groundCrews', 'radar', 'powerTurrets', 'dispersal'],
        orders: 5,
        heavy: 0.6,
        factoryAt: 200,
        flakAt: 300,
        replate: 6,
        aggression: 0.2,
      },
    },
  },
};

export const NATION_IDS: NationId[] = ['aldmere', 'directorate', 'varn'];

/** Anything that sits on one side of the war (a SideState, or just its seat and nation). */
export interface SideRef {
  id: SideId;
  faction?: NationId;
}

/** The nation whose names and paint a side carries. */
export function nationOf(side: SideRef): Nation {
  return NATIONS[side.faction ?? (side.id === 0 ? 'aldmere' : 'directorate')];
}

/** The rules a side plays by: its nation's, or the symmetric ones in a classic game. */
export function rulesOf(side: SideRef): NationRules {
  return side.faction ? NATIONS[side.faction].rules : CLASSIC;
}

/** An aircraft type as this side builds it. */
export function spec(side: SideRef, kind: AircraftKind): AircraftSpec {
  const base = AIRCRAFT[kind];
  const r = rulesOf(side);
  return {
    ...base,
    cost: Math.round(base.cost * r.aircraftCost),
    armorBudget: Math.max(1, base.armorBudget + (r.armor[kind] ?? 0)),
  };
}

export function aircraftLabel(side: SideRef, kind: AircraftKind): string {
  return nationOf(side).aircraft[kind];
}

export function researchCost(side: SideRef, item: Pick<ResearchItem, 'id' | 'cost'>): number {
  return Math.round(item.cost * (rulesOf(side).researchCost[item.id] ?? 1));
}

/** How the AI commands this side. */
export function aiProfile(side: SideRef): AiProfile {
  return rulesOf(side).ai;
}

export function storesCap(side: SideRef): number {
  return rulesOf(side).storesCap;
}
