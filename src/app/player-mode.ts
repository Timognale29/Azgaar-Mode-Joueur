import "@/model/globals";
import "./player-mode.css";
import type { Burg } from "@/model/political/burgs-generator";
import type { State } from "@/model/political/states-generator";

type PlayerTab = "overview" | "cities" | "finance" | "diplomacy";

let selectedStateId: number | null = null;
let activeTab: PlayerTab = "overview";
let panel: HTMLElement | null = null;
let content: HTMLElement | null = null;
let selector: HTMLSelectElement | null = null;
let tabButtons: HTMLButtonElement[] = [];

const tabs: {id: PlayerTab; label: string}[] = [
  {id: "overview", label: "Vue générale"},
  {id: "cities", label: "Villes"},
  {id: "finance", label: "Finances"},
  {id: "diplomacy", label: "Diplomatie"}
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = ""
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function getStates(): State[] {
  return (globalThis.pack?.states ?? []).filter(state => state && state.i > 0 && !state.removed);
}

function getSelectedState(): State | undefined {
  const states = getStates();
  return states.find(state => state.i === selectedStateId) ?? states[0];
}

function getStateBurgs(stateId: number): Burg[] {
  return (globalThis.pack?.burgs ?? []).filter(
    burg => burg && burg.i > 0 && !burg.removed && burg.state === stateId
  );
}

function number(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("fr-FR", {maximumFractionDigits: 1}).format(value);
}

function money(value: number | undefined | null): string {
  return value === undefined || value === null || !Number.isFinite(value)
    ? "—"
    : new Intl.NumberFormat("fr-FR", {maximumFractionDigits: 2}).format(value);
}

function statCard(label: string, value: string, detail = ""): HTMLElement {
  const card = el("div", "player-mode-stat");
  card.append(el("span", "player-mode-stat-label", label));
  card.append(el("strong", "player-mode-stat-value", value));
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

function setContent(node: HTMLElement): void {
  if (!content) return;
  content.replaceChildren(node);
}

function renderOverview(state: State): void {
  const burgs = getStateBurgs(state.i);
  const capital = globalThis.pack?.burgs?.[state.capital];
  const population = (state.rural ?? 0) + (state.urban ?? 0);
  const grid = el("div", "player-mode-stats-grid");
  grid.append(
    statCard("Population", number(population), "Valeur issue des statistiques de l'État"),
    statCard("Villes", number(burgs.length), "Établissements recensés"),
    statCard("Territoire", number(state.area), "Surface enregistrée par la carte"),
    statCard("Trésor", money(state.economy?.treasury), "Solde du dernier calcul économique")
  );

  const wrapper = el("div", "player-mode-page");
  wrapper.append(sectionTitle(state.fullName ?? state.name, state.formName ?? state.form ?? "État"));
  wrapper.append(grid);

  const info = el("div", "player-mode-card");
  info.append(sectionTitle("Informations politiques"));
  info.append(
    row("Capitale", capital?.name ?? "Non renseignée"),
    row("Culture principale", (state.culture === undefined ? undefined : globalThis.pack.cultures[state.culture]?.name) ?? "Non renseignée"),
    row("Villes et bourgs", number(burgs.length)),
    row("Pays voisins", number(state.neighbors?.length ?? 0))
  );
  wrapper.append(info);

  const note = el("p", "player-mode-note", "Cette première version lit directement les données de la carte active. Les commandes politiques, les décisions économiques et les tours de jeu seront ajoutés par étapes.");
  wrapper.append(note);
  setContent(wrapper);
}

function renderCities(state: State): void {
  const burgs = getStateBurgs(state.i).sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
  const wrapper = el("div", "player-mode-page");
  wrapper.append(sectionTitle("Villes et bourgs", `${burgs.length} établissement(s) associé(s) à cet État`));

  if (!burgs.length) {
    wrapper.append(el("p", "player-mode-empty", "Aucune ville n'est enregistrée pour cet État."));
    setContent(wrapper);
    return;
  }

  const list = el("div", "player-mode-list");
  for (const burg of burgs.slice(0, 60)) {
    const item = el("div", "player-mode-list-item");
    const name = el("div", "player-mode-list-main");
    name.append(
      el("strong", "", burg.name ?? `Établissement ${burg.i}`),
      el("span", "player-mode-muted", burg.capital ? "Capitale" : burg.type ?? "Ville")
    );
    item.append(name, el("strong", "player-mode-list-value", burg.population === undefined ? "Population inconnue" : number(burg.population)));
    list.append(item);
  }
  wrapper.append(list);
  if (burgs.length > 60) wrapper.append(el("p", "player-mode-note", "Affichage limité aux 60 établissements les plus peuplés."));
  setContent(wrapper);
}

function createTaxControl(
  label: string,
  initialValue: number,
  maxPercent: number,
  description: string
): { wrapper: HTMLElement; input: HTMLInputElement; output: HTMLElement } {
  const wrapper = el("div", "player-mode-tax-control");
  const heading = el("div", "player-mode-tax-heading");
  heading.append(el("strong", "", label));
  const output = el("strong", "player-mode-tax-output", `${number(initialValue * 100)} %`);
  const slider = el("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(maxPercent);
  slider.step = "0.5";
  slider.value = String(Math.min(maxPercent, Math.max(0, initialValue * 100)));
  slider.setAttribute("aria-label", label);
  slider.addEventListener("input", () => {
    output.textContent = `${number(Number(slider.value))} %`;
  });
  const hint = el("span", "player-mode-muted", description);
  heading.append(output);
  wrapper.append(heading, slider, hint);
  return {wrapper, input: slider, output};
}

function renderFinance(state: State): void {
  const finance = state.economy;
  const wrapper = el("div", "player-mode-page");
  wrapper.append(sectionTitle("Finances publiques", "Données économiques et décisions fiscales"));

  if (!finance) {
    wrapper.append(el("p", "player-mode-empty", "Aucune donnée financière n'est disponible pour cet État."));
    setContent(wrapper);
    return;
  }

  const cards = el("div", "player-mode-stats-grid");
  cards.append(
    statCard("Trésor", money(finance.treasury)),
    statCard("Recettes", money(finance.collected)),
    statCard("Dépenses", money(Object.values(finance.spent ?? {}).reduce((total, value) => total + value, 0))),
    statCard("Corruption prélevée", money(finance.pocketed))
  );
  wrapper.append(cards);

  const details = el("div", "player-mode-card");
  details.append(sectionTitle("Fiscalité de l'État", "Modifie les taux appliqués par le moteur économique"));
  const salesTax = createTaxControl(
    "Taxe sur les ventes",
    finance.salesTax,
    30,
    "Prélevée sur la valeur des ventes réalisées dans les marchés"
  );
  const pollTax = createTaxControl(
    "Impôt par habitant",
    finance.pollTax,
    25,
    "Contribution demandée à la population"
  );
  details.append(salesTax.wrapper, pollTax.wrapper);

  const status = el("p", "player-mode-note", "Les taux affichés sont ceux actuellement enregistrés dans la carte.");
  const apply = el("button", "player-mode-apply", "Appliquer les taux");
  apply.type = "button";
  apply.addEventListener("click", () => {
    const current = getStates().find(candidate => candidate.i === state.i);
    if (!current?.economy) return;
    current.economy.salesTax = Number(salesTax.input.value) / 100;
    current.economy.pollTax = Number(pollTax.input.value) / 100;
    status.textContent = "Fiscalité modifiée dans les données de la carte. Pense à utiliser « Save » dans Azgaar pour conserver ces changements dans ton fichier .map.";
    apply.textContent = "Taux appliqués";
    apply.disabled = true;
  });
  salesTax.input.addEventListener("input", () => {
    apply.textContent = "Appliquer les taux";
    apply.disabled = false;
  });
  pollTax.input.addEventListener("input", () => {
    apply.textContent = "Appliquer les taux";
    apply.disabled = false;
  });
  details.append(apply);
  wrapper.append(details, status);

  const explanation = el("p", "player-mode-note", "Le trésor et les recettes affichés proviennent du dernier calcul économique. Les nouveaux taux seront pris en compte lors du prochain recalcul de l'économie.");
  wrapper.append(explanation);
  setContent(wrapper);
}

function renderDiplomacy(state: State): void {
  const states = getStates();
  const neighbors = (state.neighbors ?? [])
    .map(id => states.find(candidate => candidate.i === id))
    .filter((candidate): candidate is State => Boolean(candidate));

  const wrapper = el("div", "player-mode-page");
  wrapper.append(sectionTitle("Relations extérieures", "États voisins recensés par la carte"));

  if (!neighbors.length) {
    wrapper.append(el("p", "player-mode-empty", "Aucun État voisin identifié dans les données actuelles."));
  } else {
    const list = el("div", "player-mode-list");
    for (const neighbor of neighbors) {
      const item = el("div", "player-mode-list-item");
      item.append(
        el("div", "player-mode-list-main", ""),
        el("strong", "player-mode-list-value", neighbor.formName ?? neighbor.form ?? "État")
      );
      const main = item.querySelector(".player-mode-list-main");
      main?.append(el("strong", "", neighbor.fullName ?? neighbor.name));
      list.append(item);
    }
    wrapper.append(list);
  }

  wrapper.append(el("p", "player-mode-note", "Les relations diplomatiques détaillées et les actions entre États ne sont pas encore activées."));
  setContent(wrapper);
}

function render(): void {
  if (!selector || !content) return;
  const states = getStates();

  selector.replaceChildren();
  if (!states.length) {
    selector.disabled = true;
    selector.append(new Option("Aucun État détecté", ""));
    content.replaceChildren(
      el("div", "player-mode-empty", "Charge ou génère une carte comportant des États, puis rouvre le mode joueur.")
    );
    return;
  }

  selector.disabled = false;
  if (!states.some(state => state.i === selectedStateId)) selectedStateId = states[0].i;

  for (const state of states) {
    selector.append(new Option(state.fullName ?? state.name, String(state.i), false, state.i === selectedStateId));
  }

  const state = getSelectedState();
  if (!state) return;

  for (const button of tabButtons) {
    const active = button.dataset.tab === activeTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }

  if (activeTab === "cities") renderCities(state);
  else if (activeTab === "finance") renderFinance(state);
  else if (activeTab === "diplomacy") renderDiplomacy(state);
  else renderOverview(state);
}

export const PlayerMode = {
  init(): void {
    if (document.getElementById("playerModeToggle")) return;

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
      el("p", "", "Prenez la direction d'un État de votre carte.")
    );
    const close = el("button", "player-mode-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Fermer le mode joueur");
    close.addEventListener("click", () => this.toggle());
    header.append(heading, close);

    const controls = el("div", "player-mode-controls");
    const selectLabel = el("label", "", "État dirigé");
    selector = el("select", "player-mode-select");
    selector.addEventListener("change", () => {
      selectedStateId = Number(selector?.value) || null;
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
    render();
  },

  toggle(): void {
    if (!panel) return;
    panel.hidden = !panel.hidden;
    document.getElementById("playerModeToggle")?.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) render();
  }
};
