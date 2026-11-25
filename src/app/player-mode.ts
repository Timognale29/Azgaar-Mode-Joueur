import type {} from "@/model/globals";
import "./player-mode.css";
import { Controllers } from "@/controllers";
import { Layers } from "@/renderers/layers";
import type { Burg } from "@/model/political/burgs-generator";
import type { State } from "@/model/political/states-generator";
import {
  advanceTurn,
  buildMarket,
  buildRoad,
  exportCampaignData,
  formatMoney,
  getAttitude,
  getCampaign,
  getFunds,
  getPlayerStateId,
  getProjectsForState,
  getStateEconomy,
  getWarsForState,
  importCampaignData,
  negotiate,
  marketCostFor,
  roadCostFor,
  setBudget,
  setEmbargo,
  setPlayerState,
  setTaxes,
  upgradeCity,
  urbanUpgradeCostFor
} from "./player-mode-engine";
import * as Connection from "@/services/assistant/provider/connection";
import type { Message } from "@/services/assistant/provider/providers";
import { askPlayerAI } from "./player-mode-ai";

type PlayerTab = "overview" | "cities" | "finance" | "commerce" | "diplomacy" | "construction" | "assistant";
type SliderControl = { wrapper: HTMLElement; input: HTMLInputElement };

let selectedStateId: number | null = null;
let activeTab: PlayerTab = "overview";
let panel: HTMLElement | null = null;
let content: HTMLElement | null = null;
let selector: HTMLSelectElement | null = null;
let tabButtons: HTMLButtonElement[] = [];
let assistantInput: HTMLTextAreaElement | null = null;
let assistantTranscript: HTMLElement | null = null;
let assistantMessages: {role: "user" | "assistant"; text: string}[] = [];
let assistantHistory: Message[] = [];
let assistantHistoryStateId: number | null = null;
let assistantBusy = false;

const tabs: {id: PlayerTab; label: string}[] = [
  {id: "overview", label: "État"},
  {id: "cities", label: "Villes"},
  {id: "finance", label: "Finances"},
  {id: "commerce", label: "Commerce"},
  {id: "diplomacy", label: "Diplomatie"},
  {id: "construction", label: "Chantiers"},
  {id: "assistant", label: "Assistant"}
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function getStates(): State[] {
  return (globalThis.pack?.states ?? []).filter(state => state && state.i > 0 && !state.removed);
}
function getSelectedState(): State | undefined {
  return getStates().find(state => state.i === selectedStateId) ?? getStates()[0];
}
function getStateBurgs(stateId: number): Burg[] {
  return (globalThis.pack?.burgs ?? []).filter(burg => burg && burg.i > 0 && !burg.removed && burg.state === stateId);
}
function number(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("fr-FR", {maximumFractionDigits: 1}).format(value);
}
function money(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return formatMoney(value);
}
function statCard(label: string, value: string, detail = ""): HTMLElement {
  const card = el("div", "player-mode-stat");
  card.append(el("span", "player-mode-stat-label", label), el("strong", "player-mode-stat-value", value));
  if (detail) card.append(el("span", "player-mode-stat-detail", detail));
  return card;
}
function sectionTitle(title: string, description = ""): HTMLElement {
  const wrapper = el("div", "player-mode-section-heading");
  wrapper.append(el("h3", "", title));
  if (description) wrapper.append(el("p", "", description));
  return wrapper;
}
function row(label: string, value: string): HTMLElement {
  const line = el("div", "player-mode-data-row");
  line.append(el("span", "", label), el("strong", "", value));
  return line;
}
function makeButton(label: string, onClick: () => void, className = "player-mode-action"): HTMLButtonElement {
  const button = el("button", className, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}
function setContent(node: HTMLElement): void {
  if (content) content.replaceChildren(node);
}
function appendMessage(container: HTMLElement, role: "user" | "assistant", text: string): void {
  const item = el("div", "player-mode-chat-message " + role);
  item.append(el("span", "player-mode-chat-role", role === "user" ? "Vous" : "Assistant"));
  item.append(el("p", "", text));
  container.append(item);
}
function showActionError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const notice = el("p", "player-mode-error", message);
  content?.prepend(notice);
}
function createSlider(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  formatter: (value: number) => string
): SliderControl {
  const wrapper = el("div", "player-mode-tax-control");
  const heading = el("div", "player-mode-tax-heading");
  const amount = el("strong", "player-mode-tax-output", formatter(value));
  heading.append(el("strong", "", label), amount);
  const input = el("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(Math.max(min, Math.min(max, value)));
  input.addEventListener("input", () => amount.textContent = formatter(Number(input.value)));
  wrapper.append(heading, input);
  return {wrapper, input};
}
function callAdvanceTurn(stateId: number): void {
  try {
    const result = advanceTurn(stateId);
    Layers.drawAll();
    render();
    const summary = result.changes.length ? result.changes.slice(0, 5).join(" · ") : "Aucun changement démographique notable.";
    const note = el("p", "player-mode-note", "Tour " + (result.turn - 1) + " terminé. " + summary);
    content?.prepend(note);
  } catch (error) {
    showActionError(error);
  }
}

function renderOverview(state: State): void {
  const campaign = getCampaign();
  const economy = getStateEconomy(state.i);
  const burgs = getStateBurgs(state.i);
  const capital = globalThis.pack.burgs[state.capital];
  const population = (state.rural ?? 0) + (state.urban ?? 0);
  const wrapper = el("div", "player-mode-page");
  wrapper.append(sectionTitle(state.fullName ?? state.name, (state.formName ?? state.form ?? "État") + " · Tour " + campaign.turn));

  const grid = el("div", "player-mode-stats-grid");
  grid.append(
    statCard("Trésor de campagne", money(economy.balance), "Fonds disponibles pour les décisions"),
    statCard("Solde économique", money(economy.dailyBalance), "Résultat du dernier cycle journalier"),
    statCard("Population", number(population), "Évolution à chaque tour"),
    statCard("Établissements", number(burgs.length), "Villes et bourgs")
  );
  wrapper.append(grid);

  const publicInfo = el("div", "player-mode-card");
  publicInfo.append(sectionTitle("Situation de l'État"));
  publicInfo.append(
    row("Capitale", capital?.name ?? "Non renseignée"),
    row("Territoire", number(state.area)),
    row("États voisins", number(state.neighbors?.length ?? 0)),
    row("Prospérité", economy.prosperity === null ? "En attente du premier cycle économique" : number(economy.prosperity * 100) + " / 100")
  );
  wrapper.append(publicInfo);

  const controls = el("div", "player-mode-turn-card");
  controls.append(
    el("strong", "", "Votre prochain ordre"),
    el("p", "", "Terminez un tour pour déclencher la production, les ventes, les achats, les impôts, les dépenses publiques et l'évolution des populations.")
  );
  controls.append(makeButton("Terminer le tour", () => callAdvanceTurn(state.i), "player-mode-primary"));
  wrapper.append(controls);

  const lastEvents = el("div", "player-mode-card");
  lastEvents.append(sectionTitle("Chronique récente"));
  const entries = campaign.log.slice(0, 4);
  if (!entries.length) lastEvents.append(el("p", "player-mode-empty", "Aucun événement. Les décisions et les tours apparaîtront ici."));
  else for (const entry of entries) lastEvents.append(row("Tour " + entry.turn, entry.text));
  wrapper.append(lastEvents);

  const note = el("p", "player-mode-note", "Le trésor de campagne est enregistré dans le navigateur. Les fonds de départ sont une dotation de lancement ; les travaux, marchés, routes, entretiens et missions diplomatiques sont ensuite débités de ce trésor.");
  wrapper.append(note);

  const saveCard = el("div", "player-mode-card");
  saveCard.append(sectionTitle("Sauvegarde de campagne", "Export et import du tour, des trésors, des traités, des guerres et des entretiens."));
  const saveActions = el("div", "player-mode-action-grid");
  const download = makeButton("Exporter la campagne", () => {
    const data = exportCampaignData();
    const blob = new Blob([data], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const link = el("a");
    link.href = url;
    const fileName = (state.name || "azgaar").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    link.download = "azgaar-" + fileName + "-campagne.json";
    link.click();
    URL.revokeObjectURL(url);
  });
  const fileInput = el("input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.hidden = true;
  const upload = makeButton("Importer une campagne", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const selectedFile = fileInput.files?.[0];
    if (!selectedFile) return;
    try {
      importCampaignData(await selectedFile.text());
      render();
      content?.prepend(el("p", "player-mode-success", "Campagne importée. La carte correspondante doit toujours être chargée séparément avec son fichier .map."));
    } catch (error) {
      showActionError(error);
    } finally {
      fileInput.value = "";
    }
  });
  saveActions.append(download, upload);
  saveCard.append(saveActions, fileInput);
  wrapper.append(saveCard);
  setContent(wrapper);
}

function renderCities(state: State): void {
  const burgs = getStateBurgs(state.i).sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
  const wrapper = el("div", "player-mode-page");
  wrapper.append(sectionTitle("Villes et bourgs", burgs.length + " établissement(s) associé(s) à cet État"));
  if (!burgs.length) {
    wrapper.append(el("p", "player-mode-empty", "Aucune ville n'est enregistrée pour cet État."));
    setContent(wrapper);
    return;
  }
  const list = el("div", "player-mode-list");
  for (const burg of burgs.slice(0, 80)) {
    const item = el("div", "player-mode-list-item");
    const name = el("div", "player-mode-list-main");
    name.append(
      el("strong", "", burg.name ?? ("Établissement " + burg.i)),
      el("span", "player-mode-muted", burg.capital ? "Capitale" : (burg.type ?? "Ville"))
    );
    const market = globalThis.pack.markets.some(entry => entry.centerBurgId === burg.i);
    const cityActions = el("div", "player-mode-city-actions");
    cityActions.append(
      el("span", "player-mode-list-value", number(burg.population) + " hab. · " + (market ? "Marché" : "Sans marché")),
      makeButton("Améliorer · " + money(urbanUpgradeCostFor(burg.i, state.i)), () => {
        try {
          const cost = upgradeCity(burg.i, state.i);
          Layers.drawAll();
          render();
          content?.prepend(el("p", "player-mode-success", "Projet urbain lancé. Coût : " + money(cost) + " ; entretien : 2 par tour."));
        } catch (error) { showActionError(error); }
      }),
      makeButton("Ouvrir l'éditeur Azgaar", () => Controllers.BurgEditor.open(burg.i))
    );
    item.append(name, cityActions);
    list.append(item);
  }
  wrapper.append(list);
  wrapper.append(el("p", "player-mode-note", "Les populations sont mises à jour à la fin de chaque tour selon la prospérité calculée par le moteur économique."));
  setContent(wrapper);
}

function renderFinance(state: State): void {
  const finance = state.economy;
  const economy = getStateEconomy(state.i);
  const wrapper = el("div", "player-mode-page");
  wrapper.append(sectionTitle("Finances publiques", "Fiscalité et budget exécutés au prochain cycle économique"));

  const cards = el("div", "player-mode-stats-grid");
  cards.append(
    statCard("Trésor de campagne", money(economy.balance)),
    statCard("Recettes du cycle", money(finance.collected)),
    statCard("Dépenses du cycle", money(Object.values(finance.spent ?? {}).reduce((total, value) => total + value, 0))),
    statCard("Corruption", money(finance.pocketed))
  );
  wrapper.append(cards);

  const taxCard = el("div", "player-mode-card");
  taxCard.append(sectionTitle("Fiscalité", "L'impôt par habitant est une somme par personne, pas un pourcentage."));
  const sales = createSlider("Taxe sur les ventes", finance.salesTax, 0, 0.3, 0.005, value => number(value * 100) + " %");
  const poll = createSlider("Impôt par habitant", finance.pollTax, 0, 2, 0.01, value => money(value) + " / personne");
  taxCard.append(sales.wrapper, poll.wrapper);
  taxCard.append(makeButton("Appliquer la fiscalité", () => {
    try {
      setTaxes(state.i, Number(sales.input.value), Number(poll.input.value));
      render();
      content?.prepend(el("p", "player-mode-success", "Fiscalité enregistrée. Elle sera prise en compte au prochain tour."));
    } catch (error) { showActionError(error); }
  }));
  wrapper.append(taxCard);

  const budgetCard = el("div", "player-mode-card");
  budgetCard.append(sectionTitle("Répartition des dépenses publiques", "Azgaar utilise ces parts pour commander des biens et services sur les marchés."));
  const budgetFields: {key: "court" | "administration" | "infrastructure" | "military"; label: string}[] = [
    {key: "court", label: "Cour"},
    {key: "administration", label: "Administration"},
    {key: "infrastructure", label: "Infrastructures"},
    {key: "military", label: "Défense"}
  ];
  const controls = budgetFields.map(field => ({
    key: field.key,
    control: createSlider(field.label, finance.budget[field.key] ?? 0, 0, 100, 1, value => number(value) + " %")
  }));
  for (const item of controls) budgetCard.append(item.control.wrapper);
  budgetCard.append(makeButton("Enregistrer le budget", () => {
    try {
      const values: Partial<Record<"court" | "administration" | "infrastructure" | "military", number>> = {};
      for (const item of controls) values[item.key] = Number(item.control.input.value);
      setBudget(state.i, values);
      render();
      content?.prepend(el("p", "player-mode-success", "Budget enregistré. Les commandes publiques seront passées au prochain tour."));
    } catch (error) { showActionError(error); }
  }));
  wrapper.append(budgetCard);
  wrapper.append(el("p", "player-mode-note", "Augmenter les dépenses d'infrastructure ne crée pas gratuitement des bâtiments : le moteur public achète des biens de construction sur les marchés, ce qui est comptabilisé dans les dépenses du gouvernement."));
  setContent(wrapper);
}

function renderCommerce(state: State): void {
  const economy = getStateEconomy(state.i);
  const wrapper = el("div", "player-mode-page");
  wrapper.append(sectionTitle("Commerce et marchés", "Exportations, importations, stocks et réseau de transport"));
  const cards = el("div", "player-mode-stats-grid");
  cards.append(
    statCard("Exportations", money(economy.trade.exports), "Ventes vers les autres marchés"),
    statCard("Importations", money(economy.trade.imports), "Achats depuis les autres marchés"),
    statCard("Marchés", number(globalThis.pack.markets.filter(market => globalThis.pack.burgs[market.centerBurgId]?.state === state.i).length)),
    statCard("Routes", number(globalThis.pack.routes.length), "Routes enregistrées sur la carte")
  );
  wrapper.append(cards);

  const marketsCard = el("div", "player-mode-card");
  marketsCard.append(sectionTitle("Marchés de l'État"));
  const markets = globalThis.pack.markets.filter(market => globalThis.pack.burgs[market.centerBurgId]?.state === state.i);
  if (!markets.length) marketsCard.append(el("p", "player-mode-empty", "Aucun marché n'a encore été créé pour cet État."));
  else {
    const list = el("div", "player-mode-list");
    for (const market of markets) {
      const burg = globalThis.pack.burgs[market.centerBurgId];
      const goodsCount = Object.keys(market.goods ?? {}).length;
      const item = el("div", "player-mode-list-item");
      item.append(
        el("div", "player-mode-list-main", burg?.name ?? ("Marché " + market.i)),
        el("span", "player-mode-list-value", goodsCount + " produits · frais " + money(market.feePaid ?? 0))
      );
      list.append(item);
    }
    marketsCard.append(list);
  }
  wrapper.append(marketsCard);

  const partnersCard = el("div", "player-mode-card");
  partnersCard.append(sectionTitle("Partenaires commerciaux"));
  if (!economy.trade.partners.length) partnersCard.append(el("p", "player-mode-empty", "Aucun échange extérieur recensé. Termine un tour pour recalculer les marchés."));
  else {
    const list = el("div", "player-mode-list");
    for (const partner of economy.trade.partners.slice(0, 12)) {
      const item = el("div", "player-mode-list-item");
      item.append(
        el("div", "player-mode-list-main", partner.name),
        el("span", "player-mode-list-value", "E " + money(partner.exports) + " · I " + money(partner.imports))
      );
      list.append(item);
    }
    partnersCard.append(list);
  }
  wrapper.append(partnersCard);

  const outputCard = el("div", "player-mode-card");
  outputCard.append(sectionTitle("Production de ressources"));
  if (!economy.output.length) outputCard.append(el("p", "player-mode-empty", "La production sera connue après le premier cycle économique."));
  else for (const item of economy.output) outputCard.append(row(item.name, money(item.value)));
  wrapper.append(outputCard);

  const routeCard = el("div", "player-mode-card");
  routeCard.append(sectionTitle("Réseau de transport"));
  const stateRoutes = globalThis.pack.routes.filter(route => route.group === "roads" || route.group === "searoutes" || route.group === "trails");
  if (!stateRoutes.length) routeCard.append(el("p", "player-mode-empty", "Aucune route cartographiée."));
  else for (const route of stateRoutes.slice(0, 20)) routeCard.append(row(route.name ?? ("Route " + route.i), (route.group === "searoutes" ? "Maritime" : route.group === "trails" ? "Sentier" : "Route terrestre") + " · " + number(route.length)));
  wrapper.append(routeCard);
  wrapper.append(el("p", "player-mode-note", "Les importations, exportations, prix, stocks, tarifs et coûts de transport proviennent du moteur de commerce d'Azgaar, recalculé à chaque tour."));
  setContent(wrapper);
}

function stateSelect(excludedId: number, className = "player-mode-select"): HTMLSelectElement {
  const select = el("select", className);
  const states = getStates().filter(state => state.i !== excludedId);
  for (const state of states) select.append(new Option(state.fullName ?? state.name, String(state.i)));
  return select;
}
function runDiplomaticAction(state: State, targetId: number, kind: "alliance" | "commerce" | "paix" | "guerre"): void {
  try {
    const result = negotiate(state.i, targetId, kind);
    Layers.drawAll();
    const target = getStates().find(item => item.i === targetId);
    const label = kind === "alliance" ? "alliance" : kind === "commerce" ? "traité commercial" : kind === "paix" ? "paix" : "mobilisation";
    const message = kind === "guerre"
      ? "Conflit engagé contre " + (target?.name ?? "cet État") + ". Le score stratégique, les budgets, le ravitaillement et l'entretien seront calculés à chaque tour."
      : result.accepted
        ? (target?.name ?? "L'État") + " accepte le " + label + "."
        : (target?.name ?? "L'État") + " refuse le " + label + ".";
    render();
    content?.prepend(el(result.accepted ? "p" : "p", result.accepted ? "player-mode-success" : "player-mode-note", message + " Coût : " + money(result.cost) + "."));
  } catch (error) { showActionError(error); }
}

function renderDiplomacy(state: State): void {
  const campaign = getCampaign();
  const wrapper = el("div", "player-mode-page");
  wrapper.append(sectionTitle("Diplomatie", "Les pays réagissent à la culture, aux frontières, au commerce et aux relations passées."));

  const targetCard = el("div", "player-mode-card");
  targetCard.append(sectionTitle("Négocier avec un État"));
  const target = stateSelect(state.i);
  const actions = el("div", "player-mode-action-grid");
  actions.append(
    makeButton("Proposer une alliance · 65", () => runDiplomaticAction(state, Number(target.value), "alliance")),
    makeButton("Traité commercial · 65", () => runDiplomaticAction(state, Number(target.value), "commerce")),
    makeButton("Négocier la paix · 65", () => runDiplomaticAction(state, Number(target.value), "paix")),
    makeButton("Déclarer un conflit · 240", () => runDiplomaticAction(state, Number(target.value), "guerre"), "player-mode-danger"),
    makeButton("Décréter un embargo · 85", () => {
      try {
        setEmbargo(state.i, Number(target.value));
        Layers.drawAll();
        render();
        content?.prepend(el("p", "player-mode-success", "Embargo enregistré. Il sera appliqué aux échanges du prochain tour."));
      } catch (error) { showActionError(error); }
    })
  );
  targetCard.append(target, actions);
  wrapper.append(targetCard);

  const attitudeCard = el("div", "player-mode-card");
  attitudeCard.append(sectionTitle("Attitudes des IA"));
  const list = el("div", "player-mode-list");
  const neighbors = [...getStates()].sort((a, b) => {
    const aNeighbor = state.neighbors?.includes(a.i) ? 0 : 1;
    const bNeighbor = state.neighbors?.includes(b.i) ? 0 : 1;
    return aNeighbor - bNeighbor || a.name.localeCompare(b.name);
  });
  for (const other of neighbors) {
    if (other.i === state.i) continue;
    const attitude = getAttitude(state.i, other.i);
    const item = el("div", "player-mode-list-item");
    item.append(
      el("div", "player-mode-list-main", other.fullName ?? other.name),
      el("span", "player-mode-list-value", attitude + (state.neighbors?.includes(other.i) ? " · voisin" : ""))
    );
    list.append(item);
  }
  attitudeCard.append(list);
  wrapper.append(attitudeCard);

  const treaties = campaign.treaties.filter(treaty => treaty.status === "active" && (treaty.a === state.i || treaty.b === state.i));
  const treatyCard = el("div", "player-mode-card");
  treatyCard.append(sectionTitle("Traités en vigueur"));
  if (!treaties.length) treatyCard.append(el("p", "player-mode-empty", "Aucun traité enregistré."));
  else {
    for (const treaty of treaties) {
      const otherId = treaty.a === state.i ? treaty.b : treaty.a;
      const otherName = getStates().find(item => item.i === otherId)?.name ?? "État inconnu";
      const name = treaty.kind === "alliance" ? "Alliance" : treaty.kind === "commerce" ? "Accord commercial" : "Traité de paix";
      treatyCard.append(row(name, otherName + " · signé au tour " + treaty.signedTurn));
    }
  }
  wrapper.append(treatyCard);

  const wars = getWarsForState(state.i).filter(war => war.status === "active");
  const warCard = el("div", "player-mode-card");
  warCard.append(sectionTitle("Conflits en cours", "Les affrontements sont résolus par un score stratégique abstrait."));
  if (!wars.length) warCard.append(el("p", "player-mode-empty", "Aucun conflit actif pour cet État."));
  else for (const war of wars) {
    const ownAdvantage = war.attacker === state.i ? war.score : -war.score;
    const otherId = war.attacker === state.i ? war.defender : war.attacker;
    const other = getStates().find(item => item.i === otherId);
    const label = ownAdvantage > 5 ? "Avantage de votre État" : ownAdvantage < -5 ? "Avantage adverse" : "Situation équilibrée";
    const totalPopulation = (state.rural ?? 0) + (state.urban ?? 0);
    const upkeep = Math.min(180, Math.round(35 + Math.sqrt(Math.max(0, totalPopulation)) * 0.8));
    const item = el("div", "player-mode-war");
    item.append(el("strong", "", other?.name ?? "État inconnu"));
    item.append(el("span", "player-mode-muted", label + " · Score " + number(ownAdvantage) + " · tour " + war.turns));
    const track = el("div", "player-mode-war-track");
    const fill = el("div", "player-mode-war-fill");
    fill.style.width = Math.max(0, Math.min(100, 50 + ownAdvantage / 2)) + "%";
    track.append(fill);
    item.append(track);
    item.append(el("p", "player-mode-muted", "Entretien estimé de votre armée : " + money(upkeep) + " par tour."));
    item.append(makeButton("Proposer la paix · 65", () => runDiplomaticAction(state, otherId, "paix")));
    warCard.append(item);
  }
  wrapper.append(warCard);
  wrapper.append(el("p", "player-mode-note", "Une guerre dure au maximum 12 tours avant une trêve automatique, sauf victoire stratégique plus tôt. Le vainqueur peut recevoir des réparations plafonnées ; aucun territoire n'est annexé automatiquement."));
  setContent(wrapper);
}

function renderConstruction(state: State): void {
  const burgs = getStateBurgs(state.i);
  const available = getFunds(state.i);
  const wrapper = el("div", "player-mode-page");
  wrapper.append(sectionTitle("Chantiers et investissements", "Aucun chantier n'est gratuit : le prix est payé sur le trésor de campagne avant la construction."));
  const balance = statCard("Fonds disponibles", money(available), "Les projets refusés ne sont pas débités.");
  wrapper.append(balance);

  const marketCard = el("div", "player-mode-card");
  marketCard.append(sectionTitle("Construire un marché"));
  const candidates = burgs.filter(burg => !globalThis.pack.markets.some(market => market.centerBurgId === burg.i));
  const marketSelect = el("select", "player-mode-select");
  for (const burg of candidates) marketSelect.append(new Option(burg.name ?? ("Ville " + burg.i), String(burg.i)));
  const marketCost = el("p", "player-mode-note", candidates.length ? "Coût estimé : " + money(marketCostFor(candidates[0].i, state.i)) : "Toutes les villes disposent déjà d'un marché.");
  marketSelect.addEventListener("change", () => {
    const id = Number(marketSelect.value);
    const burg = candidates.find(item => item.i === id);
    if (burg) marketCost.textContent = "Coût estimé : " + money(marketCostFor(id, state.i));
  });
  marketCard.append(marketSelect, marketCost);
  marketCard.append(makeButton("Lancer la construction", () => {
    try {
      const id = Number(marketSelect.value);
      const cost = buildMarket(id, state.i);
      Layers.drawAll();
      render();
      content?.prepend(el("p", "player-mode-success", "Marché créé. " + money(cost) + " ont été débités du trésor."));
    } catch (error) { showActionError(error); }
  }, "player-mode-primary"));
  if (!candidates.length) marketCard.append(el("p", "player-mode-muted", "Aucune ville disponible pour ce chantier."));
  wrapper.append(marketCard);

  const roadCard = el("div", "player-mode-card");
  roadCard.append(sectionTitle("Construire une route depuis la capitale"));
  const capital = globalThis.pack.burgs[state.capital];
  const destinations = burgs.filter(burg => burg.i !== state.capital && burg.i !== capital?.i);
  const roadSelect = el("select", "player-mode-select");
  for (const burg of destinations) roadSelect.append(new Option(burg.name ?? ("Ville " + burg.i), String(burg.i)));
  const roadCost = el("p", "player-mode-note", "Coût estimé : calculé selon la distance et le terrain.");
  const updateRoadPrice = () => {
    try {
      if (!capital || !destinations.length) throw new Error("La capitale ou les destinations ne sont pas disponibles.");
      const cost = roadCostFor(capital.i, Number(roadSelect.value), state.i);
      roadCost.textContent = "Coût estimé : " + money(cost) + ". Tracé terrestre calculé à partir des cellules praticables.";
    } catch (error) {
      roadCost.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  roadSelect.addEventListener("change", updateRoadPrice);
  if (destinations.length) updateRoadPrice();
  roadCard.append(roadSelect, roadCost);
  roadCard.append(makeButton("Construire la route", () => {
    try {
      if (!capital) throw new Error("La capitale n'est pas disponible.");
      const cost = buildRoad(capital.i, Number(roadSelect.value), state.i);
      Layers.drawAll();
      render();
      content?.prepend(el("p", "player-mode-success", "Route construite. " + money(cost) + " ont été débités du trésor."));
    } catch (error) { showActionError(error); }
  }, "player-mode-primary"));
  if (!destinations.length) roadCard.append(el("p", "player-mode-muted", "Il faut au moins deux villes dans cet État pour construire une route."));
  wrapper.append(roadCard);

  const projects = getProjectsForState(state.i);
  const projectList = el("div", "player-mode-card");
  const upkeepTotal = projects.reduce((total, project) => total + project.upkeep, 0);
  projectList.append(sectionTitle("Entretien des infrastructures", "Ces frais sont débités automatiquement à chaque tour."));
  projectList.append(row("Entretien par tour", money(upkeepTotal)));
  if (!projects.length) projectList.append(el("p", "player-mode-empty", "Aucun chantier financé par le mode joueur."));
  else for (const project of projects) {
    const entityName = project.kind === "market"
      ? globalThis.pack.markets.find(item => item.i === project.entityId)?.name ?? ("Marché " + project.entityId)
      : globalThis.pack.routes.find(item => item.i === project.entityId)?.name ?? ("Route " + project.entityId);
    projectList.append(row((project.kind === "market" ? "Marché · " : "Route · ") + entityName, money(project.upkeep) + " / tour"));
  }
  const playerRoutes = globalThis.pack.routes.filter(route => {
    const routeCells = route.cells ?? [];
    return routeCells.some(cellId => globalThis.pack.cells.state[cellId] === state.i);
  });
  if (!playerRoutes.length) projectList.append(el("p", "player-mode-empty", "Aucune route ne traverse actuellement cet État."));
  else for (const route of playerRoutes.slice(0, 20)) projectList.append(row(route.name ?? ("Route " + route.i), money(route.length ?? 0) + " unités de carte"));
  wrapper.append(projectList);
  setContent(wrapper);
}

function findNamedBurg(name: string, stateId: number): Burg {
  const normalized = normalizeText(name);
  const burgs = getStateBurgs(stateId);
  const burg = burgs.find(item => normalizeText(item.name ?? "") === normalized)
    ?? burgs.find(item => normalizeText(item.name ?? "").includes(normalized));
  if (!burg) throw new Error("Je ne trouve pas de ville nommée « " + name + " » dans cet État.");
  return burg;
}
function findNamedState(name: string, stateId: number): State {
  const normalized = normalizeText(name);
  const states = getStates().filter(item => item.i !== stateId);
  const target = states.find(item => normalizeText(item.name) === normalized || normalizeText(item.fullName ?? "") === normalized)
    ?? states.find(item => normalizeText(item.name).includes(normalized) || normalizeText(item.fullName ?? "").includes(normalized));
  if (!target) throw new Error("Je ne trouve pas l'État « " + name + " ».");
  return target;
}
function normalizeText(value: string): string {
  return value.toLocaleLowerCase("fr-FR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}
function executePlayerCommand(raw: string, state: State): string {
  const command = normalizeText(raw).replace(/[.!?]+$/g, "").trim();
  let match: RegExpMatchArray | null;

  if (/^(fin du tour|tour suivant|termine le tour|terminer le tour|avance un tour|passe le tour)$/.test(command)) {
    const result = advanceTurn(state.i);
    return "Tour " + (result.turn - 1) + " terminé. " + (result.changes.slice(0, 5).join(" ; ") || "Les données économiques ont été recalculées.");
  }
  if ((match = command.match(/^(?:construis|construire|batis|batir)\s+(?:un\s+)?marche\s+(?:a|dans)\s+(.+)$/))) {
    const burg = findNamedBurg(match[1], state.i);
    const cost = buildMarket(burg.i, state.i);
    Layers.drawAll();
    return "Marché construit à " + (burg.name ?? "la ville") + ". " + money(cost) + " débités du trésor.";
  }
  if ((match = command.match(/^construis\s+(?:une\s+)?route\s+entre\s+(.+?)\s+et\s+(.+)$/))) {
    const a = findNamedBurg(match[1], state.i);
    const b = findNamedBurg(match[2], state.i);
    const cost = buildRoad(a.i, b.i, state.i);
    Layers.drawAll();
    return "Route construite entre " + a.name + " et " + b.name + ". Coût : " + money(cost) + ".";
  }
  if ((match = command.match(/^construis\s+(?:une\s+)?route\s+(?:vers|jusqu?a)\s+(.+)$/))) {
    const capital = globalThis.pack.burgs[state.capital];
    if (!capital) throw new Error("La capitale n'est pas disponible.");
    const target = findNamedBurg(match[1], state.i);
    const cost = buildRoad(capital.i, target.i, state.i);
    Layers.drawAll();
    return "Route construite entre " + capital.name + " et " + target.name + ". Coût : " + money(cost) + ".";
  }
  if ((match = command.match(/^(?:fixe|regle|modifie|augmente|baisse)\s+(?:la\s+)?taxe\s+(?:sur\s+les\s+ventes|de\s+vente)\s+(?:a|a\s+)?([0-9]+(?:[.,][0-9]+)?)\s*%?$/))) {
    const rate = Number(match[1].replace(",", ".")) / 100;
    setTaxes(state.i, rate, state.economy.pollTax);
    return "Taxe sur les ventes fixée à " + number(rate * 100) + " %. Le nouveau taux prendra effet au prochain tour.";
  }
  if ((match = command.match(/^budget\s+infrastructure\s+(?:a|a\s+)?([0-9]{1,3})\s*%?$/))) {
    const value = Number(match[1]);
    if (value > 100) throw new Error("Le budget doit rester entre 0 et 100 %.");
    setBudget(state.i, {infrastructure: value});
    return "Part du budget consacrée aux infrastructures fixée à " + value + " %. Les commandes de matériaux seront payées par l'État au prochain tour.";
  }
  if ((match = command.match(/^(?:propose\s+une\s+)?alliance\s+(?:a|avec)\s+(.+)$/))) {
    const target = findNamedState(match[1], state.i);
    const result = negotiate(state.i, target.i, "alliance");
    return result.accepted ? target.name + " accepte l'alliance. Coût diplomatique : " + money(result.cost) + "." : target.name + " refuse l'alliance. La mission diplomatique a coûté " + money(result.cost) + ".";
  }
  if ((match = command.match(/^(?:signe\s+un\s+)?(?:traite|accord)\s+commercial\s+(?:avec|a)\s+(.+)$/))) {
    const target = findNamedState(match[1], state.i);
    const result = negotiate(state.i, target.i, "commerce");
    return result.accepted ? "Accord commercial signé avec " + target.name + ". Coût : " + money(result.cost) + "." : target.name + " refuse l'accord. Coût de mission : " + money(result.cost) + ".";
  }
  if ((match = command.match(/^(?:declare|declares)\s+(?:la\s+)?guerre\s+(?:a|contre)\s+(.+)$/))) {
    const target = findNamedState(match[1], state.i);
    const result = negotiate(state.i, target.i, "guerre");
    return "Conflit engagé contre " + target.name + ". Mobilisation initiale : " + money(result.cost) + ". Les coûts d'entretien et le score stratégique évolueront à chaque tour.";
  }
  if ((match = command.match(/^(?:negocie\s+)?(?:la\s+)?paix\s+(?:avec|a)\s+(.+)$/))) {
    const target = findNamedState(match[1], state.i);
    const result = negotiate(state.i, target.i, "paix");
    return result.accepted ? "Traité de paix signé avec " + target.name + ". Coût : " + money(result.cost) + "." : target.name + " refuse la paix. Mission : " + money(result.cost) + ".";
  }
  if ((match = command.match(/^(?:decrete|decreter|impose)\s+(?:un\s+)?embargo\s+(?:contre|sur)\s+(.+)$/))) {
    const target = findNamedState(match[1], state.i);
    setEmbargo(state.i, target.i);
    return "Embargo appliqué aux échanges avec " + target.name + ". Coût : 85.";
  }
  if (/^(combien|quel est).*(argent|tresor|fonds)/.test(command) || command === "tresor") {
    return "Le trésor de campagne contient " + money(getFunds(state.i)) + ". Le dernier solde économique journalier était de " + money(state.economy.treasury) + ".";
  }
  if (/^(aide|commandes|que peux tu faire)$/.test(command)) {
    return "Commandes reconnues : « construis un marché à [ville] », « construis une route entre [ville] et [ville] », « taxe sur les ventes à 10 % », « budget infrastructure à 25 % », « alliance avec [État] », « traité commercial avec [État] », « déclare la guerre à [État] », « paix avec [État] », « embargo contre [État] », « fin du tour ». Les chantiers et missions sont débités du trésor.";
  }
  return "Je n'ai pas reconnu cet ordre. Écris « aide » pour voir les commandes disponibles. Les ordres inconnus ne modifient jamais la carte.";
}

function renderAssistant(state: State): void {
  if (assistantHistoryStateId !== state.i) {
    assistantHistory = [];
    assistantHistoryStateId = state.i;
  }
  const wrapper = el("div", "player-mode-page");
  const connected = Connection.isConnected();
  wrapper.append(sectionTitle("Assistant de gouvernement", connected
    ? "L'IA connectée peut analyser ta demande et utiliser les outils du jeu."
    : "Mode local actif : les commandes reconnues déclenchent directement les actions autorisées."));
  assistantTranscript = el("div", "player-mode-chat");
  if (!assistantMessages.length) {
    appendMessage(assistantTranscript, "assistant", connected
      ? "Bonjour. Je peux consulter la situation, proposer une politique et exécuter les ordres autorisés. Les actions payantes sont vérifiées avant leur réalisation."
      : "Bonjour. Je peux gérer les tours, les taxes, les budgets, construire des marchés et des routes payantes, ou lancer des négociations. Écris « aide » pour connaître les commandes.");
  } else {
    for (const message of assistantMessages.slice(-12)) appendMessage(assistantTranscript, message.role, message.text);
  }
  wrapper.append(assistantTranscript);

  assistantInput = el("textarea", "player-mode-chat-input");
  assistantInput.rows = 3;
  assistantInput.placeholder = "Ex. : " + (connected ? "analyse mes finances et propose une amélioration…" : "construis un marché à " + (getStateBurgs(state.i)[0]?.name ?? "ma capitale") + "…");
  const send = makeButton(connected ? "Envoyer à l'IA" : "Exécuter l'ordre local", () => {
    const text = assistantInput?.value.trim();
    if (!text || assistantBusy) return;
    assistantMessages.push({role: "user", text});
    assistantInput!.value = "";
    if (!Connection.isConnected()) {
      try {
        assistantMessages.push({role: "assistant", text: executePlayerCommand(text, state)});
      } catch (error) {
        assistantMessages.push({role: "assistant", text: error instanceof Error ? error.message : String(error)});
      }
      render();
      activeTab = "assistant";
      for (const button of tabButtons) button.classList.toggle("active", button.dataset.tab === "assistant");
      return;
    }

    assistantBusy = true;
    render();
    activeTab = "assistant";
    void askPlayerAI(text, state.i, assistantHistory).then(answer => {
      assistantMessages.push({role: "assistant", text: answer});
    }).catch(error => {
      assistantMessages.push({role: "assistant", text: error instanceof Error ? error.message : String(error)});
    }).finally(() => {
      assistantBusy = false;
      render();
      activeTab = "assistant";
      for (const button of tabButtons) button.classList.toggle("active", button.dataset.tab === "assistant");
    });
  }, "player-mode-primary");
  send.disabled = assistantBusy;
  wrapper.append(assistantInput, send);
  if (assistantBusy) wrapper.append(el("p", "player-mode-note", "L'assistant analyse la demande et exécute uniquement les outils autorisés…"));

  wrapper.append(el("p", "player-mode-note", connected
    ? "L'IA utilise le fournisseur et le modèle configurés dans l'assistant d'Azgaar. Les fournisseurs externes peuvent facturer les requêtes ; la clé reste dans le stockage local de ce navigateur. Une connexion ChatGPT Plus n'est pas un jeton API."
    : "Mode local sans appel réseau : les commandes inconnues ne changent jamais la carte. Pour activer le langage naturel avec une IA générative, configure un fournisseur dans Azgaar Assistant ; les appels à un fournisseur externe peuvent être payants."));
  wrapper.append(makeButton("Ouvrir les réglages / l'assistant IA d'Azgaar", () => Controllers.Assistant.toggle()));
}

function render(): void {
  if (!selector || !content) return;
  const states = getStates();
  selector.replaceChildren();

  if (!states.length) {
    selector.disabled = true;
    selector.append(new Option("Aucun État détecté", ""));
    content.replaceChildren(el("div", "player-mode-empty", "Charge ou génère une carte comportant des États, puis rouvre le mode joueur."));
    return;
  }

  selector.disabled = false;
  const lockedStateId = getPlayerStateId();
  if (lockedStateId === null) {
    selectedStateId = null;
    const controls = panel?.querySelector<HTMLElement>(".player-mode-controls");
    if (controls) controls.hidden = true;
    const chooser = el("div", "player-mode-page player-mode-start");
    chooser.append(sectionTitle("Choisis ton pays", "Ce choix définit ta campagne : tu garderas cet État pendant toute la partie."));
    const countrySelect = el("select", "player-mode-select");
    countrySelect.append(new Option("Choisir un État…", ""));
    for (const candidate of states) countrySelect.append(new Option(candidate.fullName ?? candidate.name, String(candidate.i)));
    const preview = el("p", "player-mode-note", "Sélectionne un pays pour afficher sa capitale, sa population et son trésor de départ.");
    countrySelect.addEventListener("change", () => {
      const candidate = states.find(item => item.i === Number(countrySelect.value));
      preview.textContent = candidate
        ? (candidate.fullName ?? candidate.name) + " · " + number((candidate.rural ?? 0) + (candidate.urban ?? 0)) + " habitants · capitale : " + (globalThis.pack.burgs[candidate.capital]?.name ?? "non renseignée")
        : "Sélectionne un pays pour afficher ses informations.";
    });
    const start = makeButton("Commencer la campagne", () => {
      const id = Number(countrySelect.value);
      if (!states.some(item => item.i === id)) {
        preview.textContent = "Choisis un État avant de commencer.";
        return;
      }
      setPlayerState(id);
      selectedStateId = id;
      const controls = panel?.querySelector<HTMLElement>(".player-mode-controls");
      if (controls) controls.hidden = true;
      render();
    }, "player-mode-primary");
    chooser.append(countrySelect, preview, start);
    content.replaceChildren(chooser);
    return;
  }
  selectedStateId = lockedStateId;
  const controls = panel?.querySelector<HTMLElement>(".player-mode-controls");
  if (controls) controls.hidden = true;
  selector.disabled = true;
  selector.replaceChildren(new Option(getStates().find(item => item.i === lockedStateId)?.fullName ?? getStates().find(item => item.i === lockedStateId)?.name ?? "État dirigé", String(lockedStateId)));
  const state = getSelectedState();
  if (!state) return;
  for (const button of tabButtons) {
    const active = button.dataset.tab === activeTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }

  if (activeTab === "cities") renderCities(state);
  else if (activeTab === "finance") renderFinance(state);
  else if (activeTab === "commerce") renderCommerce(state);
  else if (activeTab === "diplomacy") renderDiplomacy(state);
  else if (activeTab === "construction") renderConstruction(state);
  else if (activeTab === "assistant") renderAssistant(state);
  else renderOverview(state);
}

export const PlayerMode = {
  init(): void {
    if (document.getElementById("playerModeToggle")) return;
    const states = getStates();
    selectedStateId = getPlayerStateId();

    const toggle = el("button", "player-mode-toggle", "⚑ JOUER");
    toggle.id = "playerModeToggle";
    toggle.type = "button";
    toggle.setAttribute("aria-controls", "playerModePanel");
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => this.toggle());

    panel = el("aside", "player-mode-panel");
    panel.id = "playerModePanel";
    panel.setAttribute("aria-label", "Mode joueur");
    panel.hidden = true;

    const header = el("div", "player-mode-header");
    const heading = el("div", "player-mode-heading");
    heading.append(
      el("span", "player-mode-eyebrow", "AZGAAR • STRATÉGIE"),
      el("h2", "", "Mode joueur"),
      el("p", "", "Dirige un État, investis et fais évoluer ta carte.")
    );
    const headerActions = el("div", "player-mode-header-actions");
    const turn = makeButton("Tour suivant", () => {
      if (selectedStateId !== null) callAdvanceTurn(selectedStateId);
    }, "player-mode-header-turn");
    const close = el("button", "player-mode-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Fermer le mode joueur");
    close.addEventListener("click", () => this.toggle());
    headerActions.append(turn, close);
    header.append(heading, headerActions);

    const controls = el("div", "player-mode-controls");
    const selectLabel = el("label", "", "État dirigé");
    selector = el("select", "player-mode-select");
    selector.disabled = true;
    selector.addEventListener("change", () => {
      // The player nation is immutable after campaign creation.
      render();
    });
    selectLabel.append(selector);
    controls.append(selectLabel);

    const nav = el("div", "player-mode-tabs");
    tabButtons = tabs.map(tab => {
      const button = el("button", "", tab.label);
      button.type = "button";
      button.dataset.tab = tab.id;
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => {
        activeTab = tab.id;
        render();
      });
      nav.append(button);
      return button;
    });

    content = el("div", "player-mode-content");
    panel.append(header, controls, nav, content);
    document.body.append(toggle, panel);

    // The shell boots before the first map is generated or loaded.
    // registerMap dispatches this event after both operations, so attach the player state then.
    window.addEventListener("map:generated", () => {
      const availableStates = getStates();
      if (!availableStates.length) return;
      const savedStateId = getPlayerStateId();
      selectedStateId = availableStates.some(candidate => candidate.i === savedStateId) ? savedStateId : null;
      render();
    });

    render();
  },
  toggle(): void {
    if (!panel) return;
    panel.hidden = !panel.hidden;
    document.getElementById("playerModeToggle")?.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) render();
  }
};
