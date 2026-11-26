import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  productionRegenerate: vi.fn(),
  addMarket: vi.fn(),
  generateMarkets: vi.fn(),
  setTaxes: vi.fn(),
  setBudget: vi.fn(),
  setTariffs: vi.fn(),
  setRelation: vi.fn(),
  setPopulation: vi.fn(),
  militaryAdd: vi.fn(),
  militarySetUnits: vi.fn(),
  militaryMove: vi.fn(),
  militarySetBase: vi.fn(),
  militaryAttach: vi.fn(),
  setCells: vi.fn(),
  getPoles: vi.fn(),
  findNeighbors: vi.fn(),
  collectStatistics: vi.fn()
}));

vi.mock("@/model/economy/accounts", () => ({
  Accounts: {
    ofState: (_stateId: number) => ({prosperity: 0.6, product: 100, people: 200}),
    getTrade: () => ({exports: 0, imports: 0, partners: new Map()}),
    getOutput: () => []
  }
}));
vi.mock("@/model/economy/markets-generator", () => ({
  Markets: {
    generate: mocks.generateMarkets,
    addMarket: mocks.addMarket
  }
}));
vi.mock("@/model/economy/production-generator", () => ({
  Production: {regenerate: mocks.productionRegenerate}
}));
vi.mock("@/model/political/states-generator", () => ({
  States: {
    setTaxes: mocks.setTaxes,
    setBudget: mocks.setBudget,
    setTariffs: mocks.setTariffs,
    setRelation: mocks.setRelation,
    setPopulation: mocks.setPopulation,
    setCells: mocks.setCells,
    getPoles: mocks.getPoles,
    findNeighbors: mocks.findNeighbors,
    collectStatistics: mocks.collectStatistics
  }
}));
vi.mock("@/model/political/military-generator", () => ({
  Military: {
    add: mocks.militaryAdd,
    getTroops: (points = 0) => Math.ceil(points),
    setUnits: mocks.militarySetUnits,
    move: mocks.militaryMove,
    setBase: mocks.militarySetBase,
    attach: mocks.militaryAttach
  }
}));

import {
  advanceClock,
  advanceTurn,
  getStateIdentity,
  relationScore,
  buildMarket,
  buildRoad,
  buildCityFortification,
  buildCityCitadel,
  exportCampaignData,
  getCampaign,
  getFunds,
  getWarsForState,
  resetCampaign,
  setPlayerState,
  importCampaignData,
  negotiate,
  raiseRegiment,
  recruitRegiment,
  moveRegiment
} from "./player-mode-engine";

let mapNumber = 0;
const memory = new Map<string, string>();
let previousPack: typeof globalThis.pack;
let previousOptions: typeof globalThis.options;

function installStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, String(value)),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear()
    }
  });
}

function finance() {
  return {
    salesTax: 0.05,
    pollTax: 0.2,
    marketFee: 0,
    adjustments: [],
    budget: {court: 10, administration: 20, infrastructure: 20, military: 25, corruption: 0},
    collected: 0,
    spent: {court: 0, administration: 0, infrastructure: 0, military: 0},
    pocketed: 0,
    treasury: 0,
    tariffs: []
  };
}

function setupMap(): void {
  memory.clear();
  const states = [
    {i: 0, name: "Terres neutres", economy: finance(), diplomacy: []},
    {i: 1, name: "Aster", fullName: "Royaume d'Aster", capital: 1, center: 0, culture: 1, rural: 100, urban: 100, area: 30, alert: 2, neighbors: [2], diplomacy: [], economy: finance(), provinces: []},
    {i: 2, name: "Boreal", fullName: "Duché de Boréal", capital: 2, center: 2, culture: 2, rural: 100, urban: 100, area: 30, alert: 2, neighbors: [1], diplomacy: [], economy: finance(), provinces: []}
  ];
  const burgs = [
    {i: 0},
    {i: 1, name: "Aster-ville", state: 1, cell: 0, population: 100, capital: 1, feature: 1},
    {i: 2, name: "Boreal-ville", state: 2, cell: 2, population: 100, capital: 1, feature: 1}
  ];
  globalThis.pack = {
    states,
    burgs,
    markets: [],
    routes: [],
    deals: [],
    cells: {
      i: [0, 1, 2],
      state: [1, 0, 2],
      h: [30, 30, 30],
      pop: [0, 0, 0],
      p: [[100, 100], [120, 100], [140, 100]],
      c: [[1], [0, 2], [1]],
      biome: [0, 0, 0],
      burg: [1, 0, 2],
      province: [0, 0, 0],
      routes: [{}, {}, {}]
    },
    biomes: [{habitability: 100}],
    provinces: []
  } as any;
  globalThis.options = {
    map: {
      seed: "player-mode-test-" + ++mapNumber,
      goods: [],
      graph: {width: 1000, height: 800},
      units: {population: {scale: 1, urbanization: {rate: 1}}},
      military: {units: [{name: "infantry", power: 1}]}
    }
  } as any;

  mocks.addMarket.mockImplementation((burgId: number) => {
    const id = Math.max(0, ...pack.markets.map((market: any) => market.i)) + 1;
    const market = {i: id, centerBurgId: burgId, goods: {}};
    pack.markets.push(market as any);
    return market;
  });
  mocks.setTaxes.mockImplementation((stateId: number, salesTax: number, pollTax: number) => {
    pack.states[stateId]!.economy.salesTax = salesTax;
    pack.states[stateId]!.economy.pollTax = pollTax;
  });
  mocks.setBudget.mockImplementation((stateId: number, budget: Record<string, number>) => {
    Object.assign(pack.states[stateId]!.economy.budget, budget);
  });
  mocks.setTariffs.mockImplementation((stateId: number, tariffs: unknown[]) => {
    pack.states[stateId]!.economy.tariffs = tariffs as any;
  });
  mocks.setRelation.mockImplementation((a: number, b: number, relation: string) => {
    pack.states[a]!.diplomacy![b] = relation;
    pack.states[b]!.diplomacy![a] = relation;
  });
  mocks.setCells.mockImplementation((stateId: number, cellIds: number[]) => {
    for (const cellId of cellIds) {
      pack.cells.state[cellId] = stateId;
      const burgId = pack.cells.burg[cellId];
      if (burgId) pack.burgs[burgId]!.state = stateId;
    }
  });
  mocks.setPopulation.mockImplementation((stateId: number, rural: number, urban: number) => {
    pack.states[stateId]!.rural = rural;
    pack.states[stateId]!.urban = urban;
  });
  mocks.militaryAdd.mockImplementation((stateId: number, x: number, y: number) => {
    const state = pack.states[stateId]!;
    state.military ??= [];
    const i = state.military.length ? Math.max(...state.military.map((regiment: any) => regiment.i)) + 1 : 0;
    const cell = pack.cells.p.findIndex((point: number[]) => point[0] === x && point[1] === y);
    const safeCell = Math.max(0, cell);
    state.military.push({i, a: 0, cell: safeCell, x, y, bx: x, by: y, state: stateId, n: +(pack.cells.h[safeCell] < 20), u: {}, name: "Aster Guard"} as any);
    return i;
  });
  mocks.militarySetUnits.mockImplementation((stateId: number, regimentId: number, units: Record<string, number>) => {
    const regiment = pack.states[stateId]!.military!.find((item: any) => item.i === regimentId)!;
    regiment.u = Object.fromEntries(Object.entries(units).map(([name, count]) => [name, count]));
    regiment.a = Object.values(units).reduce((total, count) => total + count, 0);
  });
  mocks.militaryMove.mockImplementation((stateId: number, regimentId: number, x: number, y: number) => {
    const regiment = pack.states[stateId]!.military!.find((item: any) => item.i === regimentId)!;
    regiment.x = x;
    regiment.y = y;
  });
  mocks.militarySetBase.mockImplementation((stateId: number, regimentId: number, x: number, y: number) => {
    const regiment = pack.states[stateId]!.military!.find((item: any) => item.i === regimentId)!;
    regiment.bx = x;
    regiment.by = y;
  });
  mocks.militaryAttach.mockImplementation((stateId: number, regimentId: number, targetStateId: number, targetId: number) => {
    const sourceList = pack.states[stateId]!.military!;
    const targetList = pack.states[targetStateId]!.military!;
    const source = sourceList.find((item: any) => item.i === regimentId)!;
    const target = targetList.find((item: any) => item.i === targetId)!;
    for (const [unit, count] of Object.entries(source.u ?? {})) target.u[unit] = (target.u[unit] ?? 0) + Number(count);
    target.a = Object.values(target.u).reduce((total: number, count: any) => total + count, 0);
    sourceList.splice(sourceList.indexOf(source), 1);
  });
  mocks.productionRegenerate.mockImplementation(() => {
    for (const state of pack.states) if (state.i) state.economy.treasury = 120;
  });
}

describe("player mode campaign engine", () => {
  beforeEach(() => {
    previousPack = globalThis.pack;
    previousOptions = globalThis.options;
    installStorage();
    setupMap();
    vi.clearAllMocks();
  });

  afterEach(() => {
    memory.clear();
    globalThis.pack = previousPack;
    globalThis.options = previousOptions;
  });

  it("charges a market before construction and records recurring upkeep", () => {
    const initialFunds = getFunds(1);
    const cost = buildMarket(1, 1);

    expect(cost).toBe(268);
    expect(pack.markets).toHaveLength(1);
    expect(getFunds(1)).toBe(initialFunds - cost);
    expect(getCampaign().projects).toEqual([
      {kind: "market", stateId: 1, entityId: 1, upkeep: 4}
    ]);
  });

  it("builds paid city walls and records their recurring upkeep", () => {
    const initialFunds = getFunds(1);
    const cost = buildCityFortification(1, 1);

    expect(pack.burgs[1]!.walls).toBe(1);
    expect(getFunds(1)).toBe(initialFunds - cost);
    expect(getCampaign().projects).toContainEqual({kind: "fortification", stateId: 1, entityId: 1, upkeep: 3});
  });

  it("builds a paid citadel and records its recurring upkeep", () => {
    const initialFunds = getFunds(1);
    const cost = buildCityCitadel(1, 1);

    expect(pack.burgs[1]!.citadel).toBe(1);
    expect(getFunds(1)).toBe(initialFunds - cost);
    expect(getCampaign().projects).toContainEqual({kind: "citadel", stateId: 1, entityId: 1, upkeep: 5});
  });

  it("refuses a project when the selected state cannot afford it", () => {
    getCampaign().funds["1"] = 10;

    expect(() => buildMarket(1, 1)).toThrow("Fonds insuffisants");
    expect(pack.markets).toHaveLength(0);
    expect(getFunds(1)).toBe(10);
  });

  it("rolls back the construction charge if the market model refuses creation", () => {
    const initialFunds = getFunds(1);
    mocks.addMarket.mockReturnValueOnce(null);

    expect(() => buildMarket(1, 1)).toThrow("n'a pas pu créer");
    expect(getFunds(1)).toBe(initialFunds);
    expect(getCampaign().projects).toHaveLength(0);
  });

  it("builds a route only across own or neutral land and charges its length-based cost", () => {
    pack.burgs.push({i: 3, name: "Seconde", state: 1, cell: 2, population: 80, feature: 1} as any);
    pack.cells = {
      i: [0, 1, 2],
      state: [1, 0, 1],
      h: [30, 30, 30],
      p: [[0, 0], [10, 0], [20, 0]],
      c: [[1], [0, 2], [1]],
      biome: [0, 0, 0],
      routes: [{}, {}, {}]
    } as any;
    pack.biomes = [{habitability: 100}] as any;
    const initialFunds = getFunds(1);

    const cost = buildRoad(1, 3, 1);

    expect(cost).toBe(126);
    expect(getFunds(1)).toBe(initialFunds - cost);
    expect(pack.routes).toHaveLength(1);
    expect(pack.routes[0].cells).toEqual([0, 1, 2]);
    expect(pack.routes[0].tags).toContain("owner:1");
    expect(getCampaign().projects[0]).toMatchObject({kind: "road", stateId: 1, entityId: 1, upkeep: 1.6});
    expect(pack.cells.routes[0]?.[1]).toBe(1);
    expect(pack.cells.routes[2]?.[1]).toBe(1);
  });

  it("refuses to route through a foreign state's land without charging", () => {
    pack.burgs.push({i: 3, name: "Seconde", state: 1, cell: 2, population: 80, feature: 1} as any);
    pack.cells = {
      i: [0, 1, 2],
      state: [1, 2, 1],
      h: [30, 30, 30],
      p: [[0, 0], [10, 0], [20, 0]],
      c: [[1], [0, 2], [1]],
      biome: [0, 0, 0],
      routes: [{}, {}, {}]
    } as any;
    pack.biomes = [{habitability: 100}] as any;
    const initialFunds = getFunds(1);

    expect(() => buildRoad(1, 3, 1)).toThrow("Aucun chemin terrestre praticable");
    expect(getFunds(1)).toBe(initialFunds);
    expect(pack.routes).toHaveLength(0);
  });

  it("runs production only when the continuous clock crosses a full day", () => {
    const initialFunds = getFunds(1);
    const initialPopulation = pack.states[1]!.rural! + pack.states[1]!.urban!;

    const firstHalf = advanceClock(1, 12);
    expect(firstHalf.days).toBe(0);
    expect(mocks.productionRegenerate).not.toHaveBeenCalled();
    expect(getFunds(1)).toBe(initialFunds);

    const secondHalf = advanceClock(1, 12);
    expect(secondHalf.days).toBe(1);
    expect(mocks.productionRegenerate).toHaveBeenCalledOnce();
    expect(getCampaign().turn).toBe(2);
    expect(getCampaign().elapsedHours).toBe(24);
    expect(getFunds(1)).toBe(initialFunds + 120);
    expect(pack.states[1]!.rural! + pack.states[1]!.urban!).toBeGreaterThan(initialPopulation);
  });

  it("uses map culture, religion and government data in state identity and diplomacy", () => {
    pack.states[1]!.form = "Theocracy";
    pack.states[1]!.formName = "Theocracy";
    pack.states[2]!.form = "Anarchy";
    pack.states[2]!.formName = "Clans Union";
    pack.cultures = [
      {},
      {i: 1, name: "Asteri", type: "River", ancestry: "Aster", development: 60},
      {i: 2, name: "Boreal", type: "Nomadic", ancestry: "Boreal", development: 25}
    ] as any;
    pack.religions = [
      {},
      {i: 1, name: "Faith of the Dawn", type: "Organized"},
      {i: 2, name: "Ancestor Spirits", type: "Folk"}
    ] as any;
    pack.cells = {
      ...pack.cells,
      state: [1, 1, 2, 2],
      religion: [1, 1, 2, 2],
      pop: [20, 80, 75, 25]
    } as any;

    expect(getStateIdentity(1)).toMatchObject({
      cultureName: "Asteri",
      cultureType: "River",
      religionName: "Faith of the Dawn",
      religionShare: 1,
      governmentFamily: "theocracy"
    });
    expect(getStateIdentity(2).governmentFamily).toBe("clan");
    expect(relationScore(1, 2)).toBeLessThan(0);
  });

  it("raises a regiment at the capital and charges the treasury", () => {
    const initialFunds = getFunds(1);
    const regiment = raiseRegiment(1);

    expect(regiment.state).toBe(1);
    expect(regiment.x).toBe(100);
    expect(regiment.y).toBe(100);
    expect(getFunds(1)).toBe(initialFunds - 90);
    expect(pack.states[1]!.military).toHaveLength(1);
  });

  it("charges recruitment and updates the real regiment composition", () => {
    const regiment = raiseRegiment(1);
    const before = getFunds(1);
    const cost = recruitRegiment(1, regiment.i, "infantry", 100);

    expect(cost).toBe(77);
    expect(regiment.u.infantry).toBe(100);
    expect(regiment.a).toBe(100);
    expect(getFunds(1)).toBe(before - cost);
  });

  it("refuses recruitment into a foreign regiment without charging", () => {
    const before = getFunds(1);
    expect(() => recruitRegiment(2, 99, "infantry", 100)).toThrow("régiment");
    expect(getFunds(1)).toBe(before);
  });

  it("moves a regiment to neutral land and charges a distance-based order", () => {
    const regiment = raiseRegiment(1);
    const before = getFunds(1);
    const cost = moveRegiment(1, regiment.i, 1);

    expect(cost).toBe(8);
    expect(regiment.cell).toBe(1);
    expect(pack.cells.state[1]).toBe(1);
    expect(regiment.x).toBe(120);
    expect(regiment.y).toBe(100);
    expect(getFunds(1)).toBe(before - cost);
  });

  it("merges same-state regiments when they arrive on the same cell", () => {
    const moving = raiseRegiment(1);
    recruitRegiment(1, moving.i, "infantry", 100);
    const stationed = {
      i: 99, a: 200, cell: 1, x: 120, y: 100, bx: 120, by: 100,
      state: 1, n: 0, u: {infantry: 200}, name: "Garde d'Aster"
    };
    pack.states[1]!.military!.push(stationed as any);

    moveRegiment(1, moving.i, 1);

    expect(pack.states[1]!.military).toHaveLength(1);
    expect(pack.states[1]!.military![0]!.i).toBe(99);
    expect(pack.states[1]!.military![0]!.a).toBe(300);
    expect(mocks.militaryAttach).toHaveBeenCalledWith(1, moving.i, 1, 99);
  });

  it("refuses to enter enemy land before a war has been declared", () => {
    const regiment = raiseRegiment(1);
    pack.cells.state[1] = 2;
    const before = getFunds(1);

    expect(() => moveRegiment(1, regiment.i, 1)).toThrow("déclarer la guerre");
    expect(getFunds(1)).toBe(before);
    expect(regiment.cell).toBe(0);
  });

  it("uses enemy garrisons to defend a territory against invasion", () => {
    const attacker = raiseRegiment(1);
    recruitRegiment(1, attacker.i, "infantry", 100);
    const defender = raiseRegiment(2);
    recruitRegiment(2, defender.i, "infantry", 200);
    defender.cell = 1;
    pack.cells.state[1] = 2;
    negotiate(1, 2, "guerre");

    expect(() => moveRegiment(1, attacker.i, 1)).toThrow("Assaut trop faible");
    expect(pack.cells.state[1]).toBe(2);
    expect(attacker.cell).toBe(0);
  });

  it("captures an adjacent enemy cell during a declared war with enough troops", () => {
    const regiment = raiseRegiment(1);
    recruitRegiment(1, regiment.i, "infantry", 100);
    pack.cells.state[1] = 2;
    negotiate(1, 2, "guerre");

    const cost = moveRegiment(1, regiment.i, 1);

    expect(cost).toBeGreaterThan(8);
    expect(pack.cells.state[1]).toBe(1);
    expect(regiment.cell).toBe(1);
    expect(getWarsForState(1)[0].score).toBe(5);
  });

  it("recruits and moves an AI nation to defend its territory during a war", () => {
    setPlayerState(1);
    pack.cells.state[1] = 1;
    negotiate(1, 2, "guerre");

    advanceTurn(1);

    const aiArmy = pack.states[2]!.military ?? [];
    expect(aiArmy.length).toBeGreaterThan(0);
    expect(aiArmy.some((regiment: any) => regiment.cell === 1)).toBe(true);
    expect(pack.cells.state[1]).toBe(2);
    expect(getCampaign().aiNationTurns?.["2"]?.lastRecruitTurn).toBe(getCampaign().turn);
  });

  it("charges initial war mobilization, recurring upkeep and advances the abstract war", () => {
    const beforeWarFunds = getFunds(1);
    const mobilization = negotiate(1, 2, "guerre");
    expect(mobilization.accepted).toBe(true);
    expect(getFunds(1)).toBe(beforeWarFunds - 240);
    expect(pack.states[1]!.diplomacy![2]).toBe("Enemy");
    expect(getWarsForState(1)).toHaveLength(1);

    const fundsBeforeTurn = getFunds(1);
    advanceTurn(1);

    expect(getWarsForState(1)[0].turns).toBe(1);
    expect(getFunds(1)).toBeLessThan(fundsBeforeTurn + 120);
  });

  it("ends an active war after an accepted peace offer", () => {
    negotiate(1, 2, "guerre");
    advanceTurn(1);
    const offer = negotiate(1, 2, "paix");

    expect(offer.accepted).toBe(true);
    expect(getWarsForState(1)[0].status).toBe("ended");
    expect(pack.states[1]!.diplomacy![2]).toBe("Friendly");
    expect(getCampaign().treaties.some(treaty => treaty.kind === "paix" && treaty.status === "active")).toBe(true);
  });

  it("resets campaign progress and restores the map baseline", () => {
    setPlayerState(1);
    pack.cells.state[1] = 1;
    pack.states[1]!.economy.salesTax = 0.2;
    pack.burgs[1]!.walls = 1;
    const restored = resetCampaign();

    expect(restored).toBe(true);
    expect(pack.cells.state[1]).toBe(0);
    expect(pack.states[1]!.economy.salesTax).toBe(0.05);
    expect(pack.burgs[1]!.walls).toBeUndefined();
    expect(getCampaign().playerStateId).toBeNull();
  });

  it("exports and restores a campaign including a negative balance (debt)", () => {
    const save = getCampaign();
    save.funds["1"] = -42.5;
    save.turn = 8;
    save.log.push({turn: 8, text: "Dette de test"});

    const exported = exportCampaignData();
    save.funds["1"] = 900;
    save.turn = 2;
    importCampaignData(exported);

    expect(getCampaign().turn).toBe(8);
    expect(getFunds(1)).toBe(-42.5);
    expect(getCampaign().log.at(-1)?.text).toBe("Dette de test");
  });

  it("rejects a campaign backup made for another map", () => {
    const exported = exportCampaignData();
    const nextMap = {...globalThis.options.map, seed: "another-map"};
    globalThis.options.map = nextMap;

    expect(() => importCampaignData(exported)).toThrow("une autre carte");
  });
});
