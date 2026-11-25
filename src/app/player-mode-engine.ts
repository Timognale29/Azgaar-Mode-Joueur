import type {} from "@/model/globals";
import { Accounts } from "@/model/economy/accounts";
import { Burgs } from "@/model/political/burgs-generator";
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
export interface PlayerCampaign {
  key: string;
  turn: number;
  playerStateId: number | null;
  funds: Record<string, number>;
  treaties: PlayerTreaty[];
  wars: PlayerWar[];
  projects: PlayerProject[];
  log: PlayerLogEntry[];
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
  if (!Number.isInteger(campaign.turn) || campaign.turn < 1) campaign.turn = 1;

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
  const save = getOrCreateCampaign();
  save.playerStateId = stateId;
  persist();
}
export function getPlayerStateId(): number | null {
  return getOrCreateCampaign().playerStateId;
}
export function getFunds(stateId: number): number {
  const save = getOrCreateCampaign();
  return save.funds[String(stateId)] ?? 0;
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

export function relationScore(subjectId: number, objectId: number): number {
  const subject = stateById(subjectId);
  const object = stateById(objectId);
  let score = 0;
  if (subject.culture === object.culture) score += 28;
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
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      let subject = states[i];
      let object = states[j];
      if (subject.i === playerId) [subject, object] = [object, subject];
      const current = subject.diplomacy?.[object.i] ?? "Neutral";
      if (current === "Enemy" || current === "Vassal" || current === "Suzerain") continue;
      const score = relationScore(subject.i, object.i);
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

    if (atWar) changes.military = Math.min(100, Math.max(changes.military ?? finance.budget.military, finance.budget.military + 3));
    const taxChanged = salesTax !== currentSalesTax || pollTax !== currentPollTax;
    const budgetChanged = Object.entries(changes).some(([key, value]) => value !== finance.budget[key as keyof typeof finance.budget]);
    if (taxChanged) States.setTaxes(state.i, salesTax, pollTax);
    if (budgetChanged) States.setBudget(state.i, changes);
    if (taxChanged || budgetChanged)
      addLog("Le gouvernement de " + state.name + " ajuste sa fiscalité ou son budget en réaction à sa situation économique.");
  }
}

export function advanceTurn(playerId: number): {turn: number; changes: string[]} {
  stateById(playerId);
  const save = getOrCreateCampaign();
  if (!globalThis.pack.markets?.length) Markets.generate(true);

  // This is Azgaar's real daily economy: production, purchases, sales, taxes, tariffs and public orders.
  Production.regenerate();

  const changes: string[] = [];
  for (const state of livingStates()) {
    const id = String(state.i);
    const net = Number(state.economy?.treasury ?? 0);
    save.funds[id] = Math.round(((save.funds[id] ?? STARTING_GRANT) + net) * 100) / 100;
    const accounts = Accounts.ofState(state.i);
    const prosperity = accounts?.prosperity ?? 0.5;
    const growth = clamp(0.001 + (prosperity - 0.5) * 0.01, -0.004, 0.01);
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

  // City populations evolve independently, with a modest prosperity-sensitive rate.
  for (const burg of globalThis.pack.burgs.filter(item => item?.i && !item.removed && item.state)) {
    const state = livingStates().find(item => item.i === burg.state);
    const population = burg.population ?? 0;
    if (!state || population <= 0) continue;
    const prosperity = Accounts.ofState(state.i)?.prosperity ?? 0.5;
    const urbanProjects = save.projects.filter(project => project.kind === "urban_upgrade" && project.entityId === burg.i && project.stateId === state.i).length;
    const growth = clamp(0.001 + (prosperity - 0.5) * 0.012 + urbanProjects * 0.0008, -0.006, 0.012);
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
  addLog(`Tour ${save.turn - 1} terminé : production et commerce recalculés, fiscalité collectée, populations ajustées et diplomatie mise à jour.`);
  persist();
  return {turn: save.turn, changes};
}
