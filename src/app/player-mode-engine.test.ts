import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  productionRegenerate: vi.fn(),
  addMarket: vi.fn(),
  generateMarkets: vi.fn(),
  setTaxes: vi.fn(),
  setBudget: vi.fn(),
  setTariffs: vi.fn(),
  setRelation: vi.fn(),
  setPopulation: vi.fn()
}));

vi.mock("@/model/economy/accounts", () => ({
  Accounts: {
    ofState: (stateId: number) => ({prosperity: 0.6, product: 100, people: 200}),
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
    setPopulation: mocks.setPopulation
  }
}));

import {
  advanceTurn,
  buildMarket,
  exportCampaignData,
  getCampaign,
  getFunds,
  getWarsForState,
  importCampaignData,
  negotiate
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
    {i: 1, name: "Aster", fullName: "Royaume d'Aster", culture: 1, rural: 100, urban: 100, area: 30, alert: 2, neighbors: [2], diplomacy: [], economy: finance()},
    {i: 2, name: "Boreal", fullName: "Duché de Boréal", culture: 2, rural: 100, urban: 100, area: 30, alert: 2, neighbors: [1], diplomacy: [], economy: finance()}
  ];
  const burgs = [
    {i: 0},
    {i: 1, name: "Aster-ville", state: 1, cell: 0, population: 100, capital: 1, feature: 1},
    {i: 2, name: "Boreal-ville", state: 2, cell: 1, population: 100, capital: 1, feature: 1}
  ];
  globalThis.pack = {
    states,
    burgs,
    markets: [],
    routes: [],
    deals: [],
    cells: {i: [], state: [], h: [], pop: [], p: [], c: [], biome: [], routes: []},
    biomes: [],
    provinces: []
  } as any;
  globalThis.options = {map: {seed: "player-mode-test-" + ++mapNumber, goods: []}} as any;

  mocks.addMarket.mockImplementation((burgId: number) => {
    const id = Math.max(0, ...pack.markets.map((market: any) => market.i)) + 1;
    const market = {i: id, centerBurgId: burgId, goods: {}};
    pack.markets.push(market);
    return market;
  });
  mocks.setTaxes.mockImplementation((stateId: number, salesTax: number, pollTax: number) => {
    pack.states[stateId].economy.salesTax = salesTax;
    pack.states[stateId].economy.pollTax = pollTax;
  });
  mocks.setBudget.mockImplementation((stateId: number, budget: Record<string, number>) => {
    Object.assign(pack.states[stateId].economy.budget, budget);
  });
  mocks.setTariffs.mockImplementation((stateId: number, tariffs: unknown[]) => {
    pack.states[stateId].economy.tariffs = tariffs;
  });
  mocks.setRelation.mockImplementation((a: number, b: number, relation: string) => {
    pack.states[a].diplomacy[b] = relation;
    pack.states[b].diplomacy[a] = relation;
  });
  mocks.setPopulation.mockImplementation((stateId: number, rural: number, urban: number) => {
    pack.states[stateId].rural = rural;
    pack.states[stateId].urban = urban;
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
    pack.burgs.push({i: 3, name: "Seconde", state: 1, cell: 2, population: 80, feature: 1});
    pack.cells = {
      i: [0, 1, 2],
      state: [1, 0, 1],
      h: [30, 30, 30],
      p: [[0, 0], [10, 0], [20, 0]],
      c: [[1], [0, 2], [1]],
      biome: [0, 0, 0],
      routes: [{}, {}, {}]
    };
    pack.biomes = [{habitability: 100}];
    const initialFunds = getFunds(1);

    const cost = buildRoad(1, 3, 1);

    expect(cost).toBe(126);
    expect(getFunds(1)).toBe(initialFunds - cost);
    expect(pack.routes).toHaveLength(1);
    expect(pack.routes[0].cells).toEqual([0, 1, 2]);
    expect(pack.routes[0].tags).toContain("owner:1");
    expect(getCampaign().projects[0]).toMatchObject({kind: "road", stateId: 1, entityId: 1, upkeep: 1.6});
    expect(pack.cells.routes[0][1]).toBe(1);
    expect(pack.cells.routes[2][1]).toBe(1);
  });

  it("refuses to route through a foreign state's land without charging", () => {
    pack.burgs.push({i: 3, name: "Seconde", state: 1, cell: 2, population: 80, feature: 1});
    pack.cells = {
      i: [0, 1, 2],
      state: [1, 2, 1],
      h: [30, 30, 30],
      p: [[0, 0], [10, 0], [20, 0]],
      c: [[1], [0, 2], [1]],
      biome: [0, 0, 0],
      routes: [{}, {}, {}]
    };
    pack.biomes = [{habitability: 100}];
    const initialFunds = getFunds(1);

    expect(() => buildRoad(1, 3, 1)).toThrow("Aucun chemin terrestre praticable");
    expect(getFunds(1)).toBe(initialFunds);
    expect(pack.routes).toHaveLength(0);
  });

  it("runs Azgaar production and advances population and the campaign balance", () => {
    const initialFunds = getFunds(1);
    const initialPopulation = pack.states[1].rural + pack.states[1].urban;

    const result = advanceTurn(1);

    expect(mocks.productionRegenerate).toHaveBeenCalledOnce();
    expect(result.turn).toBe(2);
    expect(getFunds(1)).toBe(initialFunds + 120);
    expect(pack.states[1].rural + pack.states[1].urban).toBeGreaterThan(initialPopulation);
  });

  it("charges initial war mobilization, recurring upkeep and advances the abstract war", () => {
    const beforeWarFunds = getFunds(1);
    const mobilization = negotiate(1, 2, "guerre");
    expect(mobilization.accepted).toBe(true);
    expect(getFunds(1)).toBe(beforeWarFunds - 240);
    expect(pack.states[1].diplomacy[2]).toBe("Enemy");
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
    expect(pack.states[1].diplomacy[2]).toBe("Friendly");
    expect(getCampaign().treaties.some(treaty => treaty.kind === "paix" && treaty.status === "active")).toBe(true);
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
