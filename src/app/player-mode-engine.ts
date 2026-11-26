import type {} from "@/model/globals";
import { Accounts } from "@/model/economy/accounts";
import { Burgs } from "@/model/political/burgs-generator";
import { Military, type Regiment } from "@/model/political/military-generator";
import { Markets } from "@/model/economy/markets-generator";
import { Production } from "@/model/economy/production-generator";
import type { Route } from "@/model/economy/routes-generator";
import { States } from "@/model/political/states-generator";
import type { State } from "@/model/political/states-generator";
import { FlatQueue } from "@/utils/flat-queue";

export type TreatyKind = "alliance" | "commerce" | "paix";
export interface PlayerTreaty {
  kind: TreatyKind;
  a: number;
  b: number;
  signedTurn: number;
  status: "active" | "refused" | "ended" | "broken";
}
export interface PlayerWar {
  attacker: number;
  defender: number;
  startedTurn: number;
  turns: number;
  score: number;
  status: "active" | "ended";
  winner?: number;
  endReason?: "victory" | "stalemate" | "peace";
}
export interface PlayerProject {
  kind: "market" | "road" | "urban_upgrade" | "fortification" | "citadel";
  stateId: number;
  entityId: number;
  upkeep: number;
  suspended?: boolean;
}
export interface PlayerLogEntry {
  turn: number;
  text: string;
}
export interface CampaignMapSnapshot {
  cellStates: number[];
  cellProvinces: number[];
  cellMarkets: number[];
  states: Array<{
    i: number;
    center: number;
    capital: number;
    diplomacy: string[];
    economy: State["economy"];
    military: Regiment[];
    provinces: number[];
  }>;
  burgs: Array<{i: number; state: number; population?: number; walls?: number; citadel?: number; capital?: number; group?: string}>;
  provinces: unknown[];
  markets: unknown[];
  routes: Route[];
  routeLinks: unknown;
}
export interface PlayerCampaign {
  key: string;
  turn: number;
  elapsedHours: number;
  playerStateId: number | null;
  funds: Record<string, number>;
  treaties: PlayerTreaty[];
  wars: PlayerWar[];
  projects: PlayerProject[];
  log: PlayerLogEntry[];
  initialMap?: CampaignMapSnapshot;
}
export interface TradeSummary {
  exports: number;
  imports: number;
  partners: { stateId: number; name: string; exports: number; imports: number }[];
}
export interface StateEconomySummary {
  balance: number;
  dailyBalance: number;
  product: number;
  people: number;
  prosperity: number | null;
  output: { goodId: number; name: string; value: number }[];
  trade: TradeSummary;
}

const STORAGE_PREFIX = "azgaar-player-campaign-v1";
const STARTING_GRANT = 1500;
const MARKET_BASE_COST = 260;
const ROAD_BASE_COST = 90;
const DIPLOMACY_COST = 65;
const WAR_MOBILIZATION_COST = 240;

let campaign: PlayerCampaign | null = null;

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function captureInitialMap(): CampaignMapSnapshot {
  const cells = globalThis.pack.cells;
  return {
    cellStates: Array.from(cells.state),
    cellProvinces: Array.from(cells.province ?? []),
    cellMarkets: Array.from(cells.market ?? []),
    states: livingStates().map(state => ({
      i: state.i,
      center: state.center,
      capital: state.capital,
      diplomacy: cloneData(state.diplomacy ?? []),
      economy: cloneData(state.economy),
      military: cloneData(state.military ?? []),
      provinces: cloneData(state.provinces ?? [])
    })),
    burgs: globalThis.pack.burgs.filter(burg => burg?.i && !burg.removed).map(burg => ({
      i: burg.i,
      state: burg.state ?? 0,
      population: burg.population,
      walls: burg.walls,
      citadel: burg.citadel,
      capital: burg.capital,
      group: burg.group
    })),
    provinces: cloneData(globalThis.pack.provinces ?? []),
    markets: cloneData(globalThis.pack.markets ?? []),
    routes: cloneData(globalThis.pack.routes ?? []),
    routeLinks: cloneData(cells.routes ?? {})
  };
}

function restoreInitialMap(snapshot: CampaignMapSnapshot): void {
  const {cells, states, burgs} = globalThis.pack;
  if (snapshot.cellStates.length !== cells.state.length || snapshot.states.length !== livingStates().length)
    throw new Error("La sauvegarde initiale ne correspond plus à cette carte.");

  snapshot.cellStates.forEach((stateId, cellId) => { cells.state[cellId] = stateId; });
  snapshot.cellProvinces.forEach((provinceId, cellId) => { if (cells.province) cells.province[cellId] = provinceId; });
  globalThis.pack.provinces = cloneData(snapshot.provinces) as typeof globalThis.pack.provinces;
  for (const saved of snapshot.states) {
    const state = states[saved.i];
    if (!state || state.removed) continue;
    state.center = saved.center;
    state.capital = saved.capital;
    state.diplomacy = cloneData(saved.diplomacy);
    state.economy = cloneData(saved.economy);
    state.military = cloneData(saved.military);
    state.provinces = cloneData(saved.provinces);
  }
  for (const saved of snapshot.burgs) {
    const burg = burgs[saved.i];
    if (!burg || burg.removed) continue;
    burg.state = saved.state;
    burg.population = saved.population;
    burg.walls = saved.walls;
    burg.citadel = saved.citadel;
    burg.capital = saved.capital;
    burg.group = saved.group;
  }
  if (cells.market) snapshot.cellMarkets.forEach((marketId, cellId) => { cells.market[cellId] = marketId; });
  globalThis.pack.markets = cloneData(snapshot.markets) as typeof globalThis.pack.markets;
  globalThis.pack.routes = cloneData(snapshot.routes);
  cells.routes = cloneData(snapshot.routeLinks) as typeof cells.routes;
  States.getPoles();
  States.findNeighbors();
  States.collectStatistics();
}

function livingStates(): State[] {
  return (globalThis.pack?.states ?? []).filter(state => state && state.i > 0 && !state.removed);
}
function stateById(id: number): State {
  const state = livingStates().find(candidate => candidate.i === id);
  if (!state) throw new Error("Cet État n'existe plus sur la carte.");
  return state;
}
function mapKey(): string {
  const signature = livingStates().map(state => `${state.i}:${state.name}`).join("|");
  const seed = typeof options !== "undefined" ? String(options.map.seed) : "sans-graine";
  return `${STORAGE_PREFIX}:${seed}:${signature}`;
}
function persist(): void {
  if (!campaign) return;
  try {
    localStorage.setItem(campaign.key, JSON.stringify(campaign));
  } catch (error) {
    console.warn("Le journal de campagne n'a pas pu être enregistré dans le navigateur.", error);
  }
}
function addLog(text: string): void {
  if (!campaign) return;
  campaign.log.unshift({turn: campaign.turn, text});
  campaign.log = campaign.log.slice(0, 80);
  persist();
}
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
function getOrCreateCampaign(): PlayerCampaign {
  const key = mapKey();
  if (campaign?.key === key) return campaign;

  let saved: PlayerCampaign | null = null;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && (parsed as PlayerCampaign).key === key) saved = parsed as PlayerCampaign;
    }
  } catch {
    saved = null;
  }

  campaign = saved ?? {
    key,
    turn: 1,
    elapsedHours: 0,
    playerStateId: null,
    funds: {},
    treaties: [],
    wars: [],
    projects: [],
    log: []
  };

  campaign.treaties ??= [];
  campaign.wars ??= [];
  campaign.projects ??= [];
  campaign.log ??= [];
  // Upgrade saves created before reset snapshots existed: preserve the map as it is now as a reset point.
  if (campaign.playerStateId && !campaign.initialMap) campaign.initialMap = captureInitialMap();
  if (!Number.isInteger(campaign.turn) || campaign.turn < 1) campaign.turn = 1;
  if (!Number.isFinite(campaign.elapsedHours) || campaign.elapsedHours < 0) campaign.elapsedHours = (campaign.turn - 1) * 24;

  for (const state of livingStates()) {
    const id = String(state.i);
    if (campaign.funds[id] === undefined) {
      const recentSurplus = Math.max(0, state.economy?.treasury ?? 0);
      campaign.funds[id] = Math.max(STARTING_GRANT, recentSurplus * 20);
    }
  }
  const activeIds = new Set(livingStates().map(state => String(state.i)));
  for (const id of Object.keys(campaign.funds)) if (!activeIds.has(id)) delete campaign.funds[id];
  if (campaign.playerStateId && !activeIds.has(String(campaign.playerStateId))) campaign.playerStateId = null;
  persist();
  return campaign;
}

export function getCampaign(): PlayerCampaign {
  return getOrCreateCampaign();
}
export function setPlayerState(stateId: number): void {
  stateById(stateId);
  clearStateIdentityCache();
  const save = getOrCreateCampaign();
  if (!save.playerStateId && !save.initialMap) save.initialMap = captureInitialMap();
  save.playerStateId = stateId;
  persist();
}

export function resetCampaign(): boolean {
  const save = getOrCreateCampaign();
  const restoredMap = Boolean(save.initialMap);
  if (save.initialMap) restoreInitialMap(save.initialMap);
  try {
    localStorage.removeItem(save.key);
  } catch (error) {
    console.warn("La sauvegarde de campagne n'a pas pu être effacée.", error);
  }
  campaign = null;
  clearStateIdentityCache();
  return restoredMap;
}

export function saveCampaign(): void {
  persist();
}
export function getPlayerStateId(): number | null {
  return getOrCreateCampaign().playerStateId;
}
export function getFunds(stateId: number): number {
  const save = getOrCreateCampaign();
  return save.funds[String(stateId)] ?? 0;
}

const REGIMENT_RAISE_COST = 90;

/** Raise an empty regiment at the state's capital. Troops must then be recruited and paid for. */
export function raiseRegiment(stateId: number): Regiment {
  const state = stateById(stateId);
  const capital = globalThis.pack.burgs[state.capital];
  if (!capital || capital.removed) throw new Error("Cet État n'a pas de capitale utilisable.");
  const cell = capital.cell;
  const point = globalThis.pack.cells.p[cell];
  if (!point) throw new Error("La position de la capitale est introuvable.");
  charge(stateId, REGIMENT_RAISE_COST, "Levée d'un nouveau régiment");
  try {
    const regimentId = Military.add(stateId, point[0], point[1]);
    const regiment = state.military?.find(candidate => candidate.i === regimentId);
    if (!regiment) throw new Error("Azgaar n'a pas pu créer le régiment.");
    addLog("Nouveau régiment levé à " + capital.name + " : " + regiment.name + ".");
    return regiment;
  } catch (error) {
    const save = getOrCreateCampaign();
    save.funds[String(stateId)] = (save.funds[String(stateId)] ?? 0) + REGIMENT_RAISE_COST;
    persist();
    throw error;
  }
}

/** Recruit a positive number of troops of one existing Azgaar unit type, after charging the treasury. */
export function recruitRegiment(stateId: number, regimentId: number, unitName: string, quantity: number): number {
  const state = stateById(stateId);
  const regiment = state.military?.find(candidate => candidate.i === regimentId);
  if (!regiment) throw new Error("Ce régiment n'appartient pas à votre État.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50000)
    throw new Error("Le recrutement doit être compris entre 1 et 50 000 soldats.");
  const unit = options.map.military.units.find(candidate => candidate.name === unitName);
  if (!unit) throw new Error("Ce type d'unité n'existe plus dans le registre militaire.");
  const previous = Military.getTroops(regiment.u[unitName] ?? 0);
  const costPerTroop = Math.max(0.5, Math.min(2.5, 0.65 + Math.max(0, Number(unit.power) || 0) * 0.12));
  const cost = Math.ceil(quantity * costPerTroop);
  charge(stateId, cost, "Recrutement de " + quantity + " " + unitName);
  try {
    const composition = Object.fromEntries(
      Object.entries(regiment.u).map(([name, amount]) => [name, Military.getTroops(amount)])
    );
    composition[unitName] = previous + quantity;
    Military.setUnits(stateId, regimentId, composition);
    addLog(regiment.name + " recrute " + quantity + " " + unitName + " pour " + formatMoney(cost) + ".");
    return cost;
  } catch (error) {
    const save = getOrCreateCampaign();
    save.funds[String(stateId)] = (save.funds[String(stateId)] ?? 0) + cost;
    persist();
    throw error;
  }
}

function prepareStateCenterForCapture(ownerId: number, targetCell: number): void {
  const owner = stateById(ownerId);
  const burgId = globalThis.pack.cells.burg[targetCell];
  const burg = burgId ? globalThis.pack.burgs[burgId] : undefined;
  if (burg?.capital) {
    const replacement = globalThis.pack.burgs.find(candidate =>
      candidate?.i && !candidate.removed && candidate.state === ownerId && candidate.i !== burgId
    );
    if (!replacement) throw new Error("Cette capitale est le dernier centre urbain de l'État. Il faut d'abord prendre une autre ville.");
    Burgs.setCapital(replacement.i);
  } else if (owner.center === targetCell) {
    const replacementCell = globalThis.pack.cells.i.find(cell =>
      cell !== targetCell && globalThis.pack.cells.h[cell] >= 20 && globalThis.pack.cells.state[cell] === ownerId
    );
    if (replacementCell === undefined) throw new Error("Cette cellule est le dernier centre territorial de l'État.");
    owner.center = replacementCell;
  }
}

/** Move a regiment. Neutral cells can be occupied; enemy cells can only be taken during a declared war. */
export function moveRegiment(stateId: number, regimentId: number, targetCell: number): number {
  const state = stateById(stateId);
  const regiment = state.military?.find(candidate => candidate.i === regimentId);
  if (!regiment) throw new Error("Ce régiment n'appartient pas à votre État.");
  const cells = globalThis.pack.cells;
  if (!Number.isInteger(targetCell) || targetCell < 0 || targetCell >= cells.i.length)
    throw new Error("Cellule de destination invalide.");

  const targetOwner = Number(cells.state[targetCell] ?? 0);
  const hostile = targetOwner > 0 && targetOwner !== stateId && getAttitude(stateId, targetOwner) !== "Ally";
  const neutralLand = targetOwner === 0 && cells.h[targetCell] >= 20;
  if (hostile && !getActiveWar(stateId, targetOwner))
    throw new Error("Il faut d'abord déclarer la guerre à cet État depuis son panneau diplomatique.");
  if (hostile || neutralLand) {
    const neighbors = cells.c?.[regiment.cell] ?? [];
    if (!neighbors.includes(targetCell))
      throw new Error("Pour conquérir, avance de cellule en cellule : choisis une case qui touche la position actuelle du régiment.");
  }
  if (targetOwner !== 0 && targetOwner !== stateId && !hostile && getAttitude(stateId, targetOwner) !== "Ally")
    throw new Error("Le passage sur ce territoire n'est pas autorisé.");
  const isWater = cells.h[targetCell] < 20;
  if (Boolean(regiment.n) !== isWater)
    throw new Error(regiment.n ? "Une flotte doit rester en mer ou sur un lac navigable." : "Un régiment terrestre ne peut pas être envoyé sur l'eau.");

  const [x, y] = cells.p[targetCell];
  const distance = Math.hypot(x - regiment.x, y - regiment.y);
  const range = Math.max(20, Math.min(options.map.graph.width, options.map.graph.height) * 0.22);
  if (distance > range)
    throw new Error("Destination trop éloignée pour un seul ordre. Choisis une étape plus proche.");

  const troopCount = Military.getTroops(regiment.a);
  let defence = 0;
  if (hostile) {
    const defender = stateById(targetOwner);
    const burgId = cells.burg[targetCell];
    const burg = burgId ? globalThis.pack.burgs[burgId] : undefined;
    defence = Math.ceil(
      18 +
      Math.sqrt(Math.max(0, Number(cells.pop?.[targetCell] ?? 0))) * 0.35 +
      Math.sqrt(Math.max(0, Number(burg?.population ?? 0))) * 0.5 +
      (burg?.walls ? 55 : 0) +
      (burg?.citadel ? 100 : 0) +
      (defender.economy.budget.military ?? 0) * 0.25
    );
    if (troopCount < defence)
      throw new Error("Assaut trop faible : il faut environ " + defence.toLocaleString("fr-FR") + " soldats pour prendre cette case. Renforce le régiment ou vise une autre case.");
  }

  const cost = Math.max(8, Math.ceil(distance * 0.28)) + (hostile ? 30 + Math.ceil(defence * 0.12) : 0);
  const previous = {x: regiment.x, y: regiment.y, bx: regiment.bx, by: regiment.by, cell: regiment.cell};
  charge(stateId, cost, hostile ? "Assaut territorial de " + regiment.name : "Ordre de déplacement de " + regiment.name);
  try {
    if (hostile || neutralLand) {
      if (hostile) prepareStateCenterForCapture(targetOwner, targetCell);
    }
    Military.move(stateId, regimentId, x, y);
    Military.setBase(stateId, regimentId, x, y);
    regiment.cell = targetCell;
    if (hostile || neutralLand) {
      States.setCells(stateId, [targetCell]);
      if (hostile) {
        const war = getActiveWar(stateId, targetOwner);
        if (war) war.score = clamp(war.score + (war.attacker === stateId ? 5 : -5), -100, 100);
        addLog(regiment.name + " prend une case à " + stateById(stateId).name + " sur " + stateById(targetOwner).name + ". Résistance estimée : " + defence + " ; effectif engagé : " + troopCount + ".");
      } else {
        addLog(regiment.name + " occupe une case neutre.");
      }
    } else {
      addLog(regiment.name + " se déplace vers la cellule " + targetCell + ".");
    }
    return cost;
  } catch (error) {
    regiment.x = previous.x;
    regiment.y = previous.y;
    regiment.bx = previous.bx;
    regiment.by = previous.by;
    regiment.cell = previous.cell;
    const save = getOrCreateCampaign();
    save.funds[String(stateId)] = (save.funds[String(stateId)] ?? 0) + cost;
    persist();
    throw error;
  }
}

export function getRegimentsForState(stateId: number): Regiment[] {
  return [...(stateById(stateId).military ?? [])];
}
export function exportCampaignData(): string {
  const save = getOrCreateCampaign();
  return JSON.stringify({format: "azgaar-player-campaign", version: 1, campaign: save}, null, 2);
}
export function importCampaignData(raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Fichier de campagne invalide : le JSON ne peut pas être lu.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Fichier de campagne invalide.");
  const file = parsed as {format?: unknown; version?: unknown; campaign?: unknown};
  if (file.format !== "azgaar-player-campaign" || file.version !== 1 || !file.campaign || typeof file.campaign !== "object")
    throw new Error("Ce fichier n'est pas une sauvegarde compatible du mode joueur.");
  const imported = file.campaign as PlayerCampaign;
  const expectedKey = mapKey();
  if (imported.key !== expectedKey)
    throw new Error("Cette sauvegarde appartient à une autre carte. Charge la carte correspondante avant de l'importer.");
  if (!Number.isInteger(imported.turn) || imported.turn < 1 || !imported.funds || typeof imported.funds !== "object")
    throw new Error("Les données de campagne sont incomplètes.");
  const validIds = new Set(livingStates().map(state => String(state.i)));
  const funds: Record<string, number> = {};
  for (const [id, value] of Object.entries(imported.funds)) {
    if (!validIds.has(id) || typeof value !== "number" || !Number.isFinite(value))
      throw new Error("La sauvegarde contient un trésor invalide.");
    funds[id] = Math.round(value * 100) / 100;
  }
  for (const id of validIds) if (funds[id] === undefined) funds[id] = STARTING_GRANT;
  const stateExists = (id: number) => validIds.has(String(id));
  const treaties = Array.isArray(imported.treaties) ? imported.treaties.filter(treaty =>
    treaty && stateExists(treaty.a) && stateExists(treaty.b) && treaty.a !== treaty.b &&
    ["alliance", "commerce", "paix"].includes(treaty.kind) &&
    ["active", "refused", "ended", "broken"].includes(treaty.status)
  ) : [];
  const wars = Array.isArray(imported.wars) ? imported.wars.filter(war =>
    war && stateExists(war.attacker) && stateExists(war.defender) && war.attacker !== war.defender &&
    Number.isFinite(war.score) && Number.isInteger(war.turns) && ["active", "ended"].includes(war.status)
  ) : [];
  const projects = Array.isArray(imported.projects) ? imported.projects.filter(project =>
    project && stateExists(project.stateId) && Number.isInteger(project.entityId) &&
    Number.isFinite(project.upkeep) && project.upkeep >= 0 &&
    (["market", "road", "urban_upgrade", "fortification", "citadel"] as string[]).includes(project.kind)
  ) : [];
  campaign = {
    key: expectedKey,
    turn: imported.turn,
    elapsedHours: Number.isFinite(imported.elapsedHours) && imported.elapsedHours >= 0 ? imported.elapsedHours : (imported.turn - 1) * 24,
    playerStateId: imported.playerStateId && stateExists(imported.playerStateId) ? imported.playerStateId : null,
    funds,
    treaties,
    wars,
    projects,
    log: Array.isArray(imported.log) ? imported.log.filter(entry => entry && Number.isInteger(entry.turn) && typeof entry.text === "string").slice(0, 80) : []
  };
  persist();
}
export function canAfford(stateId: number, cost: number): boolean {
  return getFunds(stateId) + 1e-6 >= cost;
}
function charge(stateId: number, cost: number, reason: string): void {
  if (!Number.isFinite(cost) || cost < 0) throw new Error("Coût de projet invalide.");
  const save = getOrCreateCampaign();
  const id = String(stateId);
  const available = save.funds[id] ?? 0;
  if (available + 1e-6 < cost)
    throw new Error(`Fonds insuffisants : il faut ${formatMoney(cost)} et le trésor ne contient que ${formatMoney(available)}.`);
  save.funds[id] = Math.round((available - cost) * 100) / 100;
  addLog(`${reason} : −${formatMoney(cost)}.`);
  persist();
}
export function formatMoney(value: number): string {
  return new Intl.NumberFormat("fr-FR", {maximumFractionDigits: 2}).format(value);
}
export function getStateEconomy(stateId: number): StateEconomySummary {
  const state = stateById(stateId);
  const accounts = Accounts.ofState(stateId);
  const trade = Accounts.getTrade(stateId);
  const goods = options.map.goods ?? [];
  const output = Accounts.getOutput(stateId)
    .map((value, goodId) => ({
      goodId,
      name: goods.find(good => good?.i === goodId)?.name ?? `Ressource ${goodId}`,
      value: value || 0
    }))
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const partners = [...trade.partners.entries()].map(([partnerId, values]) => ({
    stateId: partnerId,
    name: partnerId ? globalThis.pack.states[partnerId]?.name ?? "État inconnu" : "Terres neutres",
    exports: values.exports,
    imports: values.imports
  })).sort((a, b) => b.exports + b.imports - (a.exports + a.imports));
  return {
    balance: getFunds(stateId),
    dailyBalance: state.economy?.treasury ?? 0,
    product: accounts?.product ?? 0,
    people: accounts?.people ?? ((state.rural ?? 0) + (state.urban ?? 0)),
    prosperity: accounts?.prosperity ?? null,
    output,
    trade: {exports: trade.exports, imports: trade.imports, partners}
  };
}

export function setTaxes(stateId: number, salesTax: number, pollTax: number): void {
  stateById(stateId);
  States.setTaxes(stateId, salesTax, pollTax);
  addLog(`Fiscalité modifiée pour ${stateById(stateId).name} : ventes ${(salesTax * 100).toFixed(1)} %, impôt par habitant ${pollTax.toFixed(2)}.`);
}
export function setBudget(stateId: number, expenses: Partial<Record<"court" | "administration" | "infrastructure" | "military", number>>): void {
  stateById(stateId);
  States.setBudget(stateId, expenses);
  addLog(`Budget public révisé pour ${stateById(stateId).name}.`);
}

function findBurg(burgId: number, stateId: number) {
  const burg = globalThis.pack.burgs[burgId];
  if (!burg || !burg.i || burg.removed || burg.state !== stateId) throw new Error("Cette ville n'appartient pas à l'État dirigé.");
  return burg;
}
export function marketCostFor(burgId: number, stateId: number): number {
  const burg = findBurg(burgId, stateId);
  return Math.round(MARKET_BASE_COST + (burg.population ?? 0) * 0.08);
}
export function buildMarket(burgId: number, stateId: number): number {
  const burg = findBurg(burgId, stateId);
  if (globalThis.pack.markets.some(market => market.centerBurgId === burgId))
    throw new Error("Cette ville possède déjà un marché.");
  const cost = marketCostFor(burgId, stateId);
  charge(stateId, cost, `Construction d'un marché à ${burg.name ?? "la ville"}`);
  try {
    const market = Markets.addMarket(burgId);
    if (!market) throw new Error("Azgaar n'a pas pu créer ce marché.");
    getOrCreateCampaign().projects.push({kind: "market", stateId, entityId: market.i, upkeep: 4});
    persist();
    addLog(`Le marché de ${burg.name ?? "la ville"} est ouvert. Entretien par tour : 4. Les échanges seront recalculés au prochain tour.`);
    return cost;
  } catch (error) {
    const partialMarket = globalThis.pack.markets.find(market => market.centerBurgId === burgId);
    if (partialMarket) Markets.removeMarket(partialMarket.i);
    const save = getOrCreateCampaign();
    save.funds[String(stateId)] += cost;
    persist();
    throw error;
  }
}


const URBAN_UPGRADE_BASE_COST = 180;
export function urbanUpgradeCostFor(burgId: number, stateId: number): number {
  const burg = findBurg(burgId, stateId);
  const level = getOrCreateCampaign().projects.filter(project => project.kind === "urban_upgrade" && project.stateId === stateId && project.entityId === burgId).length;
  return Math.round(URBAN_UPGRADE_BASE_COST * (1 + level * 0.65) + Math.max(0, burg.population ?? 0) * 0.025);
}
export function upgradeCity(burgId: number, stateId: number): number {
  const burg = findBurg(burgId, stateId);
  const cost = urbanUpgradeCostFor(burgId, stateId);
  charge(stateId, cost, "Amélioration urbaine à " + (burg.name ?? "la ville"));
  getOrCreateCampaign().projects.push({kind: "urban_upgrade", stateId, entityId: burgId, upkeep: 2});
  persist();
  addLog("Projet urbain lancé à " + (burg.name ?? "la ville") + " : coût " + formatMoney(cost) + ", entretien 2 par tour.");
  return cost;
}


const FORTIFICATION_BASE_COST = 340;
const CITADEL_BASE_COST = 620;
export function fortificationCostFor(burgId: number, stateId: number): number {
  const burg = findBurg(burgId, stateId);
  if (burg.walls) throw new Error("Cette ville possède déjà des fortifications.");
  return Math.round(FORTIFICATION_BASE_COST + Math.max(0, burg.population ?? 0) * 0.045);
}
export function citadelCostFor(burgId: number, stateId: number): number {
  const burg = findBurg(burgId, stateId);
  if (burg.citadel) throw new Error("Cette ville possède déjà une citadelle.");
  return Math.round(CITADEL_BASE_COST + Math.max(0, burg.population ?? 0) * 0.07);
}
export function buildCityFortification(burgId: number, stateId: number): number {
  const burg = findBurg(burgId, stateId);
  const cost = fortificationCostFor(burgId, stateId);
  charge(stateId, cost, "Construction de fortifications à " + (burg.name ?? "la ville"));
  try {
    Burgs.setBuilding(burgId, "walls", true);
    getOrCreateCampaign().projects.push({kind: "fortification", stateId, entityId: burgId, upkeep: 3});
    persist();
    addLog("Les remparts de " + (burg.name ?? "la ville") + " sont achevés. Entretien : 3 par tour.");
    return cost;
  } catch (error) {
    getOrCreateCampaign().funds[String(stateId)] += cost;
    persist();
    throw error;
  }
}
export function buildCityCitadel(burgId: number, stateId: number): number {
  const burg = findBurg(burgId, stateId);
  const cost = citadelCostFor(burgId, stateId);
  charge(stateId, cost, "Construction d'une citadelle à " + (burg.name ?? "la ville"));
  try {
    Burgs.setBuilding(burgId, "citadel", true);
    getOrCreateCampaign().projects.push({kind: "citadel", stateId, entityId: burgId, upkeep: 5});
    persist();
    addLog("La citadelle de " + (burg.name ?? "la ville") + " est achevée. Entretien : 5 par tour.");
    return cost;
  } catch (error) {
    getOrCreateCampaign().funds[String(stateId)] += cost;
    persist();
    throw error;
  }
}

function findLandPath(startCell: number, goalCell: number, stateId: number): {cells: number[]; length: number} {
  const cells = globalThis.pack.cells;
  const count = cells.i.length;
  const distance = new Float64Array(count).fill(Infinity);
  const previous = new Int32Array(count).fill(-1);
  const visited = new Uint8Array(count);
  const queue = new FlatQueue();
  distance[startCell] = 0;
  queue.push(startCell, 0);

  while (queue.length) {
    const best = queue.peekValue();
    const current = queue.pop();
    if (visited[current] || best > distance[current]) continue;
    if (current === goalCell) break;
    visited[current] = 1;
    const [x1, y1] = cells.p[current];
    for (const next of cells.c[current]) {
      if (visited[next] || cells.h[next] < 20) continue;
      const owner = cells.state[next];
      if (owner && owner !== stateId) continue;
      const habitability = globalThis.pack.biomes[cells.biome[next]]?.habitability ?? 0;
      if (habitability <= 0) continue;
      const [x2, y2] = cells.p[next];
      const step = Math.hypot(x2 - x1, y2 - y1) * (1 + (100 - habitability) / 70 + Math.max(0, cells.h[next] - 50) / 100);
      const candidate = best + step;
      if (candidate >= distance[next]) continue;
      distance[next] = candidate;
      previous[next] = current;
      queue.push(next, candidate);
    }
  }

  if (!Number.isFinite(distance[goalCell])) throw new Error("Aucun chemin terrestre praticable ne relie ces deux villes.");
  const path: number[] = [];
  for (let cell = goalCell; cell !== -1; cell = previous[cell]) {
    path.push(cell);
    if (cell === startCell) break;
  }
  path.reverse();
  if (path[0] !== startCell) throw new Error("Le chemin terrestre n'a pas pu être reconstruit.");
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    const [x1, y1] = cells.p[path[i - 1]];
    const [x2, y2] = cells.p[path[i]];
    length += Math.hypot(x2 - x1, y2 - y1);
  }
  return {cells: path, length};
}
export function roadCostFor(fromBurgId: number, toBurgId: number, stateId: number): number {
  const from = findBurg(fromBurgId, stateId);
  const to = findBurg(toBurgId, stateId);
  if (fromBurgId === toBurgId) throw new Error("Choisis deux villes différentes.");
  const path = findLandPath(from.cell, to.cell, stateId);
  return Math.round(ROAD_BASE_COST + path.length * 1.8);
}
export function buildRoad(fromBurgId: number, toBurgId: number, stateId: number): number {
  const from = findBurg(fromBurgId, stateId);
  const to = findBurg(toBurgId, stateId);
  if (fromBurgId === toBurgId) throw new Error("Choisis deux villes différentes.");
  const path = findLandPath(from.cell, to.cell, stateId);
  const cost = Math.round(ROAD_BASE_COST + path.length * 1.8);

  const routeId = Math.max(0, ...globalThis.pack.routes.map(route => route.i)) + 1;
  const points = path.cells.map(cellId => {
    const [x, y] = globalThis.pack.cells.p[cellId];
    return [x, y, cellId];
  });
  const route: Route = {
    i: routeId,
    name: `${from.name ?? "Ville"} – ${to.name ?? "Ville"}`,
    group: "roads",
    feature: from.feature ?? to.feature ?? 0,
    points,
    cells: path.cells,
    length: path.length,
    tags: ["player-mode", `owner:${stateId}`]
  };

  const links = globalThis.pack.cells.routes as Record<number, Record<number, number>>;
  const previousLinks = path.cells.slice(1).map((cell, index) => ({
    a: path.cells[index],
    b: cell,
    ab: links[path.cells[index]]?.[cell],
    ba: links[cell]?.[path.cells[index]]
  }));
  charge(stateId, cost, `Construction d'une route entre ${from.name ?? from.i} et ${to.name ?? to.i}`);
  try {
    globalThis.pack.routes.push(route);
    for (const {a, b} of previousLinks) {
      links[a] ??= {};
      links[b] ??= {};
      if (links[a][b] === undefined) links[a][b] = routeId;
      if (links[b][a] === undefined) links[b][a] = routeId;
    }
    const save = getOrCreateCampaign();
    save.projects.push({kind: "road", stateId, entityId: routeId, upkeep: Math.max(1, Math.round(path.length * 0.08 * 100) / 100)});
  } catch (error) {
    globalThis.pack.routes = globalThis.pack.routes.filter(item => item.i !== routeId);
    for (const {a, b, ab, ba} of previousLinks) {
      if (ab === undefined) delete links[a]?.[b];
      if (ba === undefined) delete links[b]?.[a];
    }
    const save = getOrCreateCampaign();
    save.funds[String(stateId)] += cost;
    persist();
    throw error;
  }
  addLog(`La route entre ${from.name ?? "la première ville"} et ${to.name ?? "la seconde ville"} est construite. Entretien par tour : ${formatMoney(Math.max(1, Math.round(path.length * 0.08 * 100) / 100))}. Coût initial : ${formatMoney(cost)}.`);
  return cost;
}

export interface StateIdentitySummary {
  cultureName: string;
  cultureType: string;
  cultureAncestry: string;
  religionName: string;
  religionType: string;
  religionShare: number;
  government: string;
  governmentFamily: "theocracy" | "clan" | "republic" | "monarchy" | "other";
}

function getGovernmentFamily(state: State): StateIdentitySummary["governmentFamily"] {
  const words = [state.form, state.formName, state.fullName, state.type, state.name].filter(Boolean).join(" ").toLowerCase();
  if (/theocr|caliph|bishop|imamah|shaman|priest|patriarch|diocese|eparchy|holy state/.test(words)) return "theocracy";
  if (/clan|tribe|chiefdom|horde|khagan|khanate|nomad|ulus|tribal/.test(words)) return "clan";
  if (/republic|commune|council|federat|confeder|union|oligarch|democr|junta|city-state|free city|trade company/.test(words)) return "republic";
  if (/kingdom|monarch|empire|duchy|duke|principality|sultanate|emirate|satrap|shogun|tsardom|dominion|march|beylik|despotate|viceroyalty/.test(words)) return "monarchy";
  if (state.form === "Theocracy") return "theocracy";
  if (state.form === "Union") return "republic";
  if (state.form === "Republic") return "republic";
  if (state.form === "Monarchy") return "monarchy";
  return "other";
}

let identityCachePack: unknown = null;
const identityCache = new Map<number, StateIdentitySummary>();

export function clearStateIdentityCache(): void {
  identityCache.clear();
  identityCachePack = globalThis.pack;
}

function dominantReligion(stateId: number): {id: number; share: number} {
  const cells = globalThis.pack?.cells;
  if (!cells?.state || !cells.religion) return {id: 0, share: 0};
  const totals = new Map<number, number>();
  let population = 0;
  const count = Math.min(cells.state.length, cells.religion.length);
  for (let cell = 0; cell < count; cell++) {
    if (cells.state[cell] !== stateId) continue;
    const weight = Math.max(0, Number(cells.pop?.[cell] ?? 1));
    if (!weight) continue;
    population += weight;
    const religionId = Number(cells.religion[cell] ?? 0);
    if (religionId > 0) totals.set(religionId, (totals.get(religionId) ?? 0) + weight);
  }
  let id = 0;
  let amount = 0;
  for (const [religionId, value] of totals) if (value > amount) [id, amount] = [religionId, value];
  return {id, share: population ? amount / population : 0};
}

/** The map's own culture, religion and government are used by diplomatic and demographic simulation. */
export function getStateIdentity(stateId: number): StateIdentitySummary {
  if (identityCachePack !== globalThis.pack) {
    identityCache.clear();
    identityCachePack = globalThis.pack;
  }
  const cached = identityCache.get(stateId);
  if (cached) return cached;

  const state = stateById(stateId);
  const culture = globalThis.pack?.cultures?.[state.culture];
  const faith = dominantReligion(stateId);
  const religion = globalThis.pack?.religions?.[faith.id];
  const governmentFamily = getGovernmentFamily(state);
  const identity: StateIdentitySummary = {
    cultureName: culture?.name ?? "Culture inconnue",
    cultureType: culture?.type ?? "inconnue",
    cultureAncestry: culture?.ancestry ?? "",
    religionName: religion?.name ?? "Pluralité religieuse",
    religionType: religion?.type ?? "",
    religionShare: faith.share,
    government: state.formName ?? state.form ?? state.type ?? "Gouvernement inconnu",
    governmentFamily
  };
  identityCache.set(stateId, identity);
  return identity;
}

export function relationScore(subjectId: number, objectId: number): number {
  const subject = stateById(subjectId);
  const object = stateById(objectId);
  let score = 0;
  const subjectIdentity = getStateIdentity(subjectId);
  const objectIdentity = getStateIdentity(objectId);
  if (subject.culture === object.culture) score += 22;
  else if (subjectIdentity.cultureAncestry && subjectIdentity.cultureAncestry === objectIdentity.cultureAncestry) score += 10;
  if (subjectIdentity.cultureType && subjectIdentity.cultureType === objectIdentity.cultureType) score += 5;
  if (subjectIdentity.religionName === objectIdentity.religionName && subjectIdentity.religionShare > 0.25 && objectIdentity.religionShare > 0.25) score += 22;
  else if (subjectIdentity.religionShare > 0.65 && objectIdentity.religionShare > 0.65) score -= 8;
  if (subjectIdentity.governmentFamily === objectIdentity.governmentFamily && subjectIdentity.governmentFamily !== "other") score += 8;
  if ((subjectIdentity.governmentFamily === "theocracy" && objectIdentity.governmentFamily === "clan") ||
      (subjectIdentity.governmentFamily === "clan" && objectIdentity.governmentFamily === "theocracy")) score -= 14;
  if (subject.neighbors?.includes(objectId)) score += 18;
  const trade = Accounts.getTrade(subjectId).partners.get(objectId);
  const tradeValue = (trade?.exports ?? 0) + (trade?.imports ?? 0);
  score += Math.min(20, Math.log1p(Math.max(0, tradeValue)) * 3);
  const existing = subject.diplomacy?.[objectId] ?? "Neutral";
  if (existing === "Friendly") score += 10;
  if (existing === "Ally") score += 20;
  if (existing === "Suspicion") score -= 12;
  if (existing === "Rival") score -= 28;
  if (existing === "Enemy") score -= 60;
  if (!object.neighbors?.includes(subjectId) && !subject.neighbors?.includes(objectId)) score -= 5;
  return score;
}

function breakTreatiesBetween(a: number, b: number): void {
  const save = getOrCreateCampaign();
  for (const treaty of save.treaties) {
    if (treaty.status !== "active") continue;
    if ((treaty.a === a && treaty.b === b) || (treaty.a === b && treaty.b === a)) treaty.status = "broken";
  }
}

function getActiveWar(a: number, b: number): PlayerWar | undefined {
  return getOrCreateCampaign().wars.find(war =>
    war.status === "active" &&
    ((war.attacker === a && war.defender === b) || (war.attacker === b && war.defender === a))
  );
}

function signPeace(a: number, b: number, war?: PlayerWar, result: "peace" | "stalemate" | "victory" = "peace", winner?: number): void {
  if (war) {
    war.status = "ended";
    war.endReason = result;
    war.winner = winner;
  }
  States.setRelation(a, b, "Friendly");
  const save = getOrCreateCampaign();
  if (!treatyExists("paix", a, b))
    save.treaties.push({kind: "paix", a, b, signedTurn: save.turn, status: "active"});
  persist();
}

function warPower(stateId: number): number {
  const state = stateById(stateId);
  const population = Math.max(0, (state.rural ?? 0) + (state.urban ?? 0));
  const militaryBudget = state.economy.budget.military ?? 0;
  const alert = state.alert ?? 1;
  const activeAllies = getOrCreateCampaign().treaties.filter(treaty =>
    treaty.status === "active" &&
    treaty.kind === "alliance" &&
    (treaty.a === stateId || treaty.b === stateId)
  ).length;
  return 10 + militaryBudget * 0.55 + alert * 3 + Math.log10(population + 10) * 5 + activeAllies * 4;
}

function finishWar(war: PlayerWar, reason: "victory" | "stalemate", winner?: number): void {
  const save = getOrCreateCampaign();
  const {attacker, defender} = war;
  if (winner) {
    const loser = winner === attacker ? defender : attacker;
    const loserFunds = Math.max(0, save.funds[String(loser)] ?? 0);
    const reparations = Math.min(200, Math.round(loserFunds * 0.05));
    if (reparations > 0) {
      save.funds[String(loser)] -= reparations;
      save.funds[String(winner)] = (save.funds[String(winner)] ?? 0) + reparations;
    }
    signPeace(winner, loser, war, reason, winner);
    addLog(`Fin du conflit entre ${stateById(attacker).name} et ${stateById(defender).name} : victoire de ${stateById(winner).name}. Réparations : ${formatMoney(reparations)}. Aucun territoire n'est annexé automatiquement.`);
  } else {
    signPeace(attacker, defender, war, "stalemate");
    addLog(`Fin du conflit entre ${stateById(attacker).name} et ${stateById(defender).name} : trêve après ${war.turns} tours sans vainqueur décisif.`);
  }
  persist();
}

function processWars(): void {
  const save = getOrCreateCampaign();
  for (const war of save.wars) {
    if (war.status !== "active") continue;
    const attacker = stateById(war.attacker);
    const defender = stateById(war.defender);
    const upkeep = (state: State) => Math.min(180, Math.round(35 + Math.sqrt(Math.max(0, (state.rural ?? 0) + (state.urban ?? 0))) * 0.8));
    const attackerUpkeep = upkeep(attacker);
    const defenderUpkeep = upkeep(defender);
    save.funds[String(attacker.i)] = (save.funds[String(attacker.i)] ?? 0) - attackerUpkeep;
    save.funds[String(defender.i)] = (save.funds[String(defender.i)] ?? 0) - defenderUpkeep;
    war.turns++;
    const attackerSupply = save.funds[String(attacker.i)] >= 0 ? 1 : -Math.min(5, Math.abs(save.funds[String(attacker.i)]) / 250);
    const defenderSupply = save.funds[String(defender.i)] >= 0 ? 1 : -Math.min(5, Math.abs(save.funds[String(defender.i)]) / 250);
    const advantage = (warPower(attacker.i) - warPower(defender.i)) * 0.12 + (attackerSupply - defenderSupply) * 1.5;
    war.score = clamp(war.score + clamp(advantage, -8, 8), -100, 100);

    addLog(`Conflit : ${attacker.name} contre ${defender.name}. Entretien militaire : ${formatMoney(attackerUpkeep)} / ${formatMoney(defenderUpkeep)}. Score stratégique : ${numberText(war.score)}.`);
    if (war.score >= 100) finishWar(war, "victory", attacker.i);
    else if (war.score <= -100) finishWar(war, "victory", defender.i);
    else if (war.turns >= 12) finishWar(war, "stalemate");
  }
  persist();
}

function numberText(value: number): string {
  return new Intl.NumberFormat("fr-FR", {maximumFractionDigits: 1, signDisplay: "always"}).format(value);
}

function applyProjectUpkeep(): void {
  const save = getOrCreateCampaign();
  const activeProjects = [];
  for (const project of save.projects) {
    const exists = project.kind === "market"
      ? globalThis.pack.markets.some(market => market.i === project.entityId && globalThis.pack.burgs[market.centerBurgId]?.state === project.stateId)
      : project.kind === "road"
        ? globalThis.pack.routes.some(route => route.i === project.entityId && route.tags?.includes(`owner:${project.stateId}`))
        : Boolean(globalThis.pack.burgs[project.entityId]?.i && !globalThis.pack.burgs[project.entityId]?.removed && globalThis.pack.burgs[project.entityId]?.state === project.stateId);
    if (!exists) {
      addLog(`Un chantier entretenu par ${stateById(project.stateId).name} a disparu de la carte ; son entretien est supprimé.`);
      continue;
    }
    const before = save.funds[String(project.stateId)] ?? 0;
    save.funds[String(project.stateId)] = Math.round((before - project.upkeep) * 100) / 100;
    if (before >= 0 && save.funds[String(project.stateId)] < 0)
      addLog(`${stateById(project.stateId).name} passe en déficit à cause de l'entretien de ses infrastructures.`);
    activeProjects.push(project);
  }
  save.projects = activeProjects;
}

function removeTariffsAgainst(stateId: number, partnerId: number): void {

  const state = stateById(stateId);
  const tariffs = state.economy.tariffs.flatMap(rule => {
    if (rule.states === "all" || !rule.states.includes(partnerId)) return [rule];
    const remaining = rule.states.filter(id => id !== partnerId);
    return remaining.length ? [{...rule, states: remaining}] : [];
  });
  // An explicit zero tariff overrides any broad "all countries" tax rule.
  tariffs.push({states: [partnerId], goods: "all", rate: 0});
  States.setTariffs(stateId, tariffs);
}

function treatyExists(kind: TreatyKind, a: number, b: number): boolean {
  const save = getOrCreateCampaign();
  return save.treaties.some(treaty => treaty.kind === kind && treaty.status === "active" &&
    ((treaty.a === a && treaty.b === b) || (treaty.a === b && treaty.b === a)));
}
export function negotiate(playerId: number, targetId: number, kind: TreatyKind | "guerre"): {accepted: boolean; score: number; cost: number} {
  const player = stateById(playerId);
  const target = stateById(targetId);
  if (playerId === targetId) throw new Error("Un État ne peut pas négocier avec lui-même.");
  const cost = kind === "guerre" ? WAR_MOBILIZATION_COST : DIPLOMACY_COST;
  charge(playerId, cost, kind === "guerre" ? "Mobilisation diplomatique" : "Mission diplomatique");
  if (kind === "guerre") {
    if (getActiveWar(playerId, targetId)) throw new Error("Un conflit est déjà en cours entre ces deux États.");
    breakTreatiesBetween(playerId, targetId);
    States.setRelation(playerId, targetId, "Enemy");
    getOrCreateCampaign().wars.push({
      attacker: playerId,
      defender: targetId,
      startedTurn: getOrCreateCampaign().turn,
      turns: 0,
      score: 0,
      status: "active"
    });
    addLog(`Conflit déclaré entre ${player.name} et ${target.name}. Chaque camp paie un entretien militaire à chaque tour ; la puissance, le budget et le ravitaillement déterminent un score stratégique abstrait.`);
    persist();
    return {accepted: true, score: relationScore(playerId, targetId), cost};
  }

  const score = relationScore(playerId, targetId);
  const war = kind === "paix" ? getActiveWar(playerId, targetId) : undefined;
  const playerAdvantage = war ? (war.attacker === playerId ? war.score : -war.score) : 0;
  const targetAdvantage = -playerAdvantage;
  const required = kind === "alliance" ? 34 : kind === "commerce" ? 4 : -4;
  const accepted = kind === "paix" && war
    ? targetAdvantage < 70
    : score >= required;
  if (!accepted) {
    addLog(`${target.name} refuse la proposition de ${kind === "alliance" ? "alliance" : kind === "commerce" ? "traité commercial" : "paix"}.`);
    return {accepted: false, score, cost};
  }

  if (kind === "alliance") {
    States.setRelation(playerId, targetId, "Ally");
    removeTariffsAgainst(playerId, targetId);
    removeTariffsAgainst(targetId, playerId);
  } else if (kind === "paix") {
    if (war) signPeace(playerId, targetId, war, "peace");
    else States.setRelation(playerId, targetId, "Friendly");
  } else {
    if ((player.diplomacy?.[targetId] ?? "Neutral") === "Neutral")
      States.setRelation(playerId, targetId, "Friendly");
    removeTariffsAgainst(playerId, targetId);
    removeTariffsAgainst(targetId, playerId);
  }

  const save = getOrCreateCampaign();
  if (!treatyExists(kind, playerId, targetId))
    save.treaties.push({kind, a: playerId, b: targetId, signedTurn: save.turn, status: "active"});
  addLog(`${target.name} accepte le traité ${kind === "alliance" ? "d'alliance" : kind === "commerce" ? "commercial" : "de paix"}.`);
  persist();
  return {accepted: true, score, cost};
}

export function setEmbargo(playerId: number, targetId: number): void {
  stateById(playerId);
  stateById(targetId);
  charge(playerId, 85, "Mise en place d'un embargo");
  try {
    States.setTariffs(playerId, [
      ...stateById(playerId).economy.tariffs.filter(rule => !(rule.states !== "all" && rule.states.includes(targetId))),
      {states: [targetId], goods: "all", rate: "embargo"}
    ]);
    breakTreatiesBetween(playerId, targetId);
    addLog(`Embargo commercial décrété contre ${stateById(targetId).name}.`);
  } catch (error) {
    const save = getOrCreateCampaign();
    save.funds[String(playerId)] += 85;
    persist();
    throw error;
  }
}

function updateAIDiplomacy(playerId: number): void {
  const states = livingStates();
  // Cache identity and trade data once per state instead of recomputing it for every possible pair.
  const identities = new Map(states.map(state => [state.i, getStateIdentity(state.i)]));
  const trades = new Map(states.map(state => [state.i, Accounts.getTrade(state.i).partners]));
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      let subject = states[i];
      let object = states[j];
      if (subject.i === playerId) [subject, object] = [object, subject];
      const current = subject.diplomacy?.[object.i] ?? "Neutral";
      if (current === "Enemy" || current === "Vassal" || current === "Suzerain") continue;
      const a = identities.get(subject.i)!;
      const b = identities.get(object.i)!;
      let score = 0;
      if (subject.culture === object.culture) score += 22;
      else if (a.cultureAncestry && a.cultureAncestry === b.cultureAncestry) score += 10;
      if (a.cultureType && a.cultureType === b.cultureType) score += 5;
      if (a.religionName === b.religionName && a.religionShare > 0.25 && b.religionShare > 0.25) score += 22;
      else if (a.religionShare > 0.65 && b.religionShare > 0.65) score -= 8;
      if (a.governmentFamily === b.governmentFamily && a.governmentFamily !== "other") score += 8;
      if ((a.governmentFamily === "theocracy" && b.governmentFamily === "clan") ||
          (a.governmentFamily === "clan" && b.governmentFamily === "theocracy")) score -= 14;
      if (subject.neighbors?.includes(object.i)) score += 18;
      const trade = trades.get(subject.i)?.get(object.i);
      score += Math.min(20, Math.log1p(Math.max(0, (trade?.exports ?? 0) + (trade?.imports ?? 0))) * 3);
      if (current === "Friendly") score += 10;
      if (current === "Ally") score += 20;
      if (current === "Suspicion") score -= 12;
      if (current === "Rival") score -= 28;
      if (current === "Enemy") score -= 60;
      if (!object.neighbors?.includes(subject.i) && !subject.neighbors?.includes(object.i)) score -= 5;
      if (current === "Ally" && score >= 8) continue;
      if (current === "Friendly" && score >= 8) continue;
      if (current === "Rival" && score <= -8) continue;
      if (current === "Suspicion" && score <= -3) continue;
      const next = score >= 54 ? "Ally" : score >= 20 ? "Friendly" : score <= -27 ? "Rival" : score <= -8 ? "Suspicion" : "Neutral";
      if (next !== current) {
        States.setRelation(subject.i, object.i, next);
        if (subject.i !== playerId)
          addLog(`L'IA de ${subject.name} fait évoluer ses relations avec ${object.name} : ${next.toLowerCase()}.`);
      }
    }
  }
}
export function getAttitude(fromId: number, toId: number): string {
  return stateById(fromId).diplomacy?.[toId] ?? "Neutral";
}
export function getWarsForState(stateId: number): PlayerWar[] {
  return getOrCreateCampaign().wars.filter(war =>
    war.attacker === stateId || war.defender === stateId
  );
}
export function getProjectsForState(stateId: number): PlayerProject[] {
  return getOrCreateCampaign().projects.filter(project => project.stateId === stateId);
}

function updateAIEconomicPolicies(playerId: number): void {
  for (const state of livingStates()) {
    if (state.i === playerId) continue;
    const finance = state.economy;
    const accounts = Accounts.ofState(state.i);
    const prosperity = accounts?.prosperity ?? 0.5;
    const currentSalesTax = finance.salesTax;
    const currentPollTax = finance.pollTax;
    const changes: Partial<Record<"court" | "administration" | "infrastructure" | "military", number>> = {};
    let salesTax = currentSalesTax;
    let pollTax = currentPollTax;
    const atWar = (state.diplomacy ?? []).includes("Enemy");

    if (finance.treasury < -20) {
      salesTax = Math.min(0.25, salesTax + 0.005);
      pollTax = Math.min(2, pollTax + 0.01);
      changes.court = Math.max(0, finance.budget.court - 2);
      changes.administration = Math.max(0, finance.budget.administration - 1);
      if (!atWar) changes.military = Math.max(0, finance.budget.military - 2);
    } else if (prosperity < 0.4 && finance.treasury > 0) {
      changes.infrastructure = Math.min(100, finance.budget.infrastructure + 3);
      salesTax = Math.max(0, salesTax - 0.002);
    } else if (finance.treasury > 100 && prosperity > 0.65) {
      salesTax = Math.max(0, salesTax - 0.002);
    }

    const identity = getStateIdentity(state.i);
    // Government institutions have distinct priorities even when the treasury is healthy.
    if (identity.governmentFamily === "theocracy") {
      changes.court = Math.max(changes.court ?? finance.budget.court, 18);
      if (identity.religionShare < 0.5) changes.administration = Math.max(changes.administration ?? finance.budget.administration, 22);
    } else if (identity.governmentFamily === "clan") {
      changes.military = Math.max(changes.military ?? finance.budget.military, 28);
      changes.administration = Math.min(changes.administration ?? finance.budget.administration, 12);
    } else if (identity.governmentFamily === "republic") {
      changes.administration = Math.max(changes.administration ?? finance.budget.administration, 20);
      changes.infrastructure = Math.max(changes.infrastructure ?? finance.budget.infrastructure, 18);
    }
    if (atWar) changes.military = Math.min(100, Math.max(changes.military ?? finance.budget.military, finance.budget.military + 3));
    const taxChanged = salesTax !== currentSalesTax || pollTax !== currentPollTax;
    const budgetChanged = Object.entries(changes).some(([key, value]) => value !== finance.budget[key as keyof typeof finance.budget]);
    if (taxChanged) States.setTaxes(state.i, salesTax, pollTax);
    if (budgetChanged) States.setBudget(state.i, changes);
    if (taxChanged || budgetChanged)
      addLog("Le gouvernement de " + state.name + " ajuste sa fiscalité ou son budget en réaction à sa situation économique.");
  }
}

function simulateDay(playerId: number): {turn: number; changes: string[]} {
  stateById(playerId);
  const save = getOrCreateCampaign();
  if (!globalThis.pack.markets?.length) Markets.generate(true);

  // Azgaar's native economy is recalculated once per in-game day.
  Production.regenerate();

  const changes: string[] = [];
  const states = livingStates();
  const statesById = new Map(states.map(state => [state.i, state]));
  const urbanProjectCounts = new Map<number, number>();
  for (const project of save.projects) {
    if (project.kind !== "urban_upgrade") continue;
    urbanProjectCounts.set(project.entityId, (urbanProjectCounts.get(project.entityId) ?? 0) + 1);
  }
  for (const state of states) {
    const id = String(state.i);
    const net = Number(state.economy?.treasury ?? 0);
    save.funds[id] = Math.round(((save.funds[id] ?? STARTING_GRANT) + net) * 100) / 100;
    const accounts = Accounts.ofState(state.i);
    const prosperity = accounts?.prosperity ?? 0.5;
    const identity = getStateIdentity(state.i);
    const cultureDevelopment = globalThis.pack.cultures?.[state.culture]?.development ?? 30;
    const culturalEffect = (cultureDevelopment - 30) * 0.000015;
    const religiousEffect = identity.religionShare > 0.8 ? 0.00012 : identity.religionShare < 0.3 ? -0.00008 : 0;
    const governmentEffect = identity.governmentFamily === "clan" ? -0.00005 : identity.governmentFamily === "theocracy" ? 0.00005 : 0;
    const growth = clamp(0.001 + (prosperity - 0.5) * 0.01 + culturalEffect + religiousEffect + governmentEffect, -0.004, 0.01);
    const oldPopulation = (state.rural ?? 0) + (state.urban ?? 0);
    if (oldPopulation > 0) {
      const rural = Math.max(0, (state.rural ?? 0) * (1 + growth * 0.8));
      const urban = Math.max(0, (state.urban ?? 0) * (1 + growth * 1.2));
      States.setPopulation(state.i, rural, urban);
      const nextPopulation = (state.rural ?? 0) + (state.urban ?? 0);
      const difference = nextPopulation - oldPopulation;
      if (Math.abs(difference) >= 1) changes.push(`${state.name} : population ${difference >= 0 ? "+" : ""}${Math.round(difference)}`);
    }
    if (net < 0) changes.push(`${state.name} : déficit quotidien de ${formatMoney(Math.abs(net))}`);
  }

  // City growth is affected by local prosperity and the state's cultural development.
  for (const burg of globalThis.pack.burgs.filter(item => item?.i && !item.removed && item.state)) {
    const state = statesById.get(burg.state);
    const population = burg.population ?? 0;
    if (!state || population <= 0) continue;
    const prosperity = Accounts.ofState(state.i)?.prosperity ?? 0.5;
    const identity = getStateIdentity(state.i);
    const urbanProjects = urbanProjectCounts.get(burg.i) ?? 0;
    const cultureDevelopment = globalThis.pack.cultures?.[state.culture]?.development ?? 30;
    const identityEffect = (cultureDevelopment - 30) * 0.00001 + (identity.governmentFamily === "clan" ? -0.00005 : 0);
    const growth = clamp(0.001 + (prosperity - 0.5) * 0.012 + urbanProjects * 0.0008 + identityEffect, -0.006, 0.012);
    const populationUnits = typeof options !== "undefined" ? options.map?.units?.population : undefined;
    if (populationUnits?.scale && populationUnits.urbanization?.rate) {
      const people = population * populationUnits.scale * populationUnits.urbanization.rate;
      Burgs.setPopulation(burg.i, Math.max(1, Math.round(people * (1 + growth))));
    } else {
      burg.population = Math.max(1, Math.round(population * (1 + growth)));
    }
  }
  applyProjectUpkeep();
  save.turn++;
  updateAIEconomicPolicies(playerId);
  updateAIDiplomacy(playerId);
  processWars();
  addLog(`Jour ${save.turn - 1} : production, commerce, fiscalité, populations et diplomatie actualisés.`);
  persist();
  return {turn: save.turn, changes};
}

/** Advance the continuous campaign clock; one in-game day is simulated every 24 game hours. */
export function advanceClock(playerId: number, elapsedHours: number): {elapsedHours: number; days: number; changes: string[]} {
  stateById(playerId);
  if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) return {elapsedHours: getOrCreateCampaign().elapsedHours, days: 0, changes: []};
  const save = getOrCreateCampaign();
  const previousDay = Math.floor(save.elapsedHours / 24);
  save.elapsedHours += Math.min(elapsedHours, 24 * 30);
  const newDay = Math.floor(save.elapsedHours / 24);
  const days = newDay - previousDay;
  const changes: string[] = [];
  for (let day = 0; day < days; day++) changes.push(...simulateDay(playerId).changes);
  if (days > 0) persist(); // avoid synchronous localStorage serialization on every 1-second clock tick
  return {elapsedHours: save.elapsedHours, days, changes};
}

/** Compatibility helper for automated tests and old integrations; gameplay uses advanceClock. */
export function advanceTurn(playerId: number): {turn: number; changes: string[]} {
  const save = getOrCreateCampaign();
  save.elapsedHours += 24;
  return simulateDay(playerId);
}
