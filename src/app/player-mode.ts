import type {} from "@/model/globals";
import { Controllers } from "@/controllers";
import { Military } from "@/model/political/military-generator";
import { Layers } from "@/renderers/layers";
import { Pack } from "@/model/graph/pack-generator";
import { Dialog } from "@/ui/dialog/dialog";
import { getPointer } from "@/utils/node-utils";
import {
  advanceClock,
  buildCityCitadel,
  buildCityFortification,
  buildMarket,
  citadelCostFor,
  fortificationCostFor,
  formatMoney,
  getAttitude,
  getCampaign,
  getFunds,
  getPlayerStateId,
  getStateIdentity,
  getStateEconomy,
  marketCostFor,
  negotiate,
  raiseRegiment,
  recruitRegiment,
  moveRegiment,
  relationScore,
  setBudget,
  setEmbargo,
  setPlayerState,
  setTaxes,
  upgradeCity,
  urbanUpgradeCostFor
} from "./player-mode-engine";

type MapClickDetail = MouseEvent;
type MoveOrder = {stateId: number; regimentId: number};

let playerStateId: number | null = null;
let campaignActive = false;
let paused = true;
let speed = 1;
let timer: number | null = null;
let lastTick = 0;
let hud: HTMLElement | null = null;
let clockLabel: HTMLElement | null = null;
let statusLabel: HTMLElement | null = null;
let pauseButton: HTMLButtonElement | null = null;
let speedButton: HTMLButtonElement | null = null;
let modeButton: HTMLButtonElement | null = null;
let pendingMove: MoveOrder | null = null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function actionButton(label: string, action: () => void, className = "player-campaign-button"): HTMLButtonElement {
  const button = element("button", className, label);
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}

function nativeActionButton(label: string, action: () => void, className = "player-city-action-button"): HTMLButtonElement {
  const button = element("button", className, label);
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}

function section(title: string, description = ""): HTMLElement {
  const wrapper = element("section", "player-campaign-section");
  wrapper.append(element("h3", "", title));
  if (description) wrapper.append(element("p", "player-campaign-muted", description));
  return wrapper;
}

function line(label: string, value: string): HTMLElement {
  const row = element("div", "player-campaign-row");
  row.append(element("span", "", label), element("strong", "", value));
  return row;
}

function notify(title: string, message: string): void {
  const body = element("div", "player-campaign-dialog-body");
  body.append(element("p", "", message));
  Dialog.message({id: "playerCampaignNotice", title, message: body, width: "24em"});
}

function runAction(title: string, action: () => void, refresh?: () => void): void {
  try {
    action();
    Layers.drawAll();
    refresh?.();
  } catch (error) {
    notify(title, error instanceof Error ? error.message : String(error));
  }
}


function formatClock(hours: number): string {
  const day = Math.floor(hours / 24) + 1;
  const hour = Math.floor(hours % 24);
  const minute = Math.floor((hours % 1) * 60);
  return "Jour " + day + " · " + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}

function updateHud(): void {
  if (!hud) return;
  const campaign = getCampaign();
  if (clockLabel) clockLabel.textContent = campaignActive ? formatClock(campaign.elapsedHours ?? 0) : "Sandbox";
  if (pauseButton) {
    pauseButton.hidden = !campaignActive;
    pauseButton.textContent = paused ? "▶" : "Ⅱ";
    pauseButton.title = paused ? "Reprendre le temps" : "Mettre en pause";
  }
  if (speedButton) {
    speedButton.hidden = !campaignActive;
    speedButton.textContent = "×" + speed;
    speedButton.title = "Changer la vitesse";
  }
  if (modeButton) modeButton.textContent = campaignActive ? "Sandbox" : (playerStateId ? "Reprendre" : "Jouer");
  if (statusLabel && !pendingMove) statusLabel.textContent = campaignActive ? (paused ? "En pause" : "Campagne") : "Outils Azgaar libres";
}

function applyCampaignMode(active: boolean): void {
  if (!active && campaignActive) {
    paused = true;
    pendingMove = null;
  }
  // Sandbox always restores the editable Azgaar map, even if an older campaign saved viewOnly=true.
  options.map.viewOnly = active;
  if (active) paused = false;
  campaignActive = active;
  document.body.classList.toggle("player-mode-campaign", active);
  lastTick = Date.now();
  updateHud();
}

function openCountryPicker(): void {
  const states = (globalThis.pack.states ?? []).filter(state => state?.i > 0 && !state.removed);
  if (!states.length) {
    notify("Aucun pays disponible", "Charge une carte comportant des États avant de commencer une campagne.");
    return;
  }
  const body = element("div", "player-campaign-dialog-body");
  body.append(element("p", "", "Choisis l'État que tu dirigeras. Ce choix restera verrouillé pendant la campagne."));
  const select = element("select", "player-campaign-select");
  select.append(new Option("Sélectionner un État…", ""));
  for (const state of states) select.append(new Option(state.fullName ?? state.name, String(state.i)));
  const preview = element("div", "player-campaign-preview", "La capitale, la culture, la religion et le régime politique s'afficheront ici.");
  select.addEventListener("change", () => {
    const state = states.find(candidate => candidate.i === Number(select.value));
    if (!state) return;
    const identity = getStateIdentity(state.i);
    preview.replaceChildren(
      line("Capitale", globalThis.pack.burgs[state.capital]?.name ?? "Non renseignée"),
      line("Population", new Intl.NumberFormat("fr-FR").format((state.rural ?? 0) + (state.urban ?? 0))),
      line("Gouvernement", identity.government),
      line("Culture", identity.cultureName + " · " + identity.cultureType),
      line("Religion", identity.religionName)
    );
  });
  body.append(select, preview);
  Dialog.message({
    id: "playerCountryPicker",
    title: "Commencer une campagne",
    message: body,
    width: "27em",
    buttons: [
      {
        label: "Commencer",
        className: "player-campaign-primary",
        onClick: () => {
          const id = Number(select.value);
          if (!states.some(candidate => candidate.i === id)) {
            preview.prepend(element("p", "player-campaign-error", "Sélectionne un État avant de continuer."));
            return false;
          }
          setPlayerState(id);
          playerStateId = id;
          applyCampaignMode(true);
        }
      },
      {label: "Annuler"}
    ]
  });
}

function toggleMode(): void {
  if (campaignActive) {
    applyCampaignMode(false);
    return;
  }
  if (playerStateId) {
    applyCampaignMode(true);
    return;
  }
  openCountryPicker();
}

function tick(): void {
  if (timer !== null) return;
  lastTick = Date.now();
  timer = window.setInterval(() => {
    const now = Date.now();
    const elapsed = Math.min(2, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    if (!campaignActive || paused || playerStateId === null || elapsed <= 0) {
      updateHud();
      return;
    }
    try {
      const result = advanceClock(playerStateId, elapsed * speed);
      updateHud();
      if (result.days > 0) {
        Layers.draw("military", "burgIcons", "labels");
      }
    } catch (error) {
      paused = true;
      updateHud();
      notify("Simulation interrompue", error instanceof Error ? error.message : String(error));
    }
  }, 1000);
}

function createHud(): void {
  if (document.getElementById("playerCampaignHud")) return;
  hud = element("div", "player-campaign-hud");
  hud.id = "playerCampaignHud";
  clockLabel = element("strong", "player-campaign-clock");
  statusLabel = element("span", "player-campaign-status");
  pauseButton = actionButton("Ⅱ", () => {
    paused = !paused;
    lastTick = Date.now();
    updateHud();
  }, "player-campaign-hud-button");
  speedButton = actionButton("×1", () => {
    speed = speed === 1 ? 2 : speed === 2 ? 4 : speed === 4 ? 8 : 1;
    updateHud();
  }, "player-campaign-hud-button");
  modeButton = actionButton("Jouer", toggleMode, "player-campaign-hud-button player-campaign-mode-button");
  hud.append(clockLabel, statusLabel, pauseButton, speedButton, modeButton);
  document.body.append(hud);
  updateHud();
}

function identityDescription(stateId: number): HTMLElement {
  const identity = getStateIdentity(stateId);
  const info = section("Identité de l'État", "Les caractéristiques sociales et politiques influencent l'IA et l'évolution du pays.");
  info.append(
    line("Régime", identity.government),
    line("Culture", identity.cultureName + " · " + identity.cultureType),
    line("Religion majoritaire", identity.religionName + (identity.religionShare ? " · " + Math.round(identity.religionShare * 100) + " %" : ""))
  );
  return info;
}

function showStateActions(stateId: number): void {
  const state = globalThis.pack.states[stateId];
  if (!state || state.removed || !playerStateId || !campaignActive) return;
  const isPlayer = stateId === playerStateId;
  const body = element("div", "player-campaign-dialog-body");
  const economy = getStateEconomy(stateId);
  body.append(line("Trésor", formatMoney(economy.balance)));
  body.append(line("Population", new Intl.NumberFormat("fr-FR").format((state.rural ?? 0) + (state.urban ?? 0))));
  body.append(identityDescription(stateId));

  if (isPlayer) {
    const finance = state.economy;
    const taxSection = section("Fiscalité et budget", "Les changements seront appliqués au prochain cycle économique.");
    const sales = element("input", "player-campaign-input");
    sales.type = "number";
    sales.min = "0";
    sales.max = "30";
    sales.step = "0.5";
    sales.value = String((finance.salesTax ?? 0) * 100);
    const poll = element("input", "player-campaign-input");
    poll.type = "number";
    poll.min = "0";
    poll.max = "2";
    poll.step = "0.01";
    poll.value = String(finance.pollTax ?? 0);
    taxSection.append(line("Taxe sur les ventes (%)", ""), sales, line("Impôt par habitant", ""), poll);
    const budgetInputs = new Map<string, HTMLInputElement>();
    for (const [key, label] of [["court", "Cour"], ["administration", "Administration"], ["infrastructure", "Infrastructures"], ["military", "Défense"]]) {
      const input = element("input", "player-campaign-input");
      input.type = "number";
      input.min = "0";
      input.max = "100";
      input.value = String(finance.budget[key as keyof typeof finance.budget] ?? 0);
      budgetInputs.set(key, input);
      taxSection.append(line(label + " (%)", ""), input);
    }
    taxSection.append(actionButton("Enregistrer les finances", () => {
      try {
        setTaxes(stateId, Number(sales.value) / 100, Number(poll.value));
        setBudget(stateId, Object.fromEntries([...budgetInputs].map(([key, input]) => [key, Number(input.value)])));
        Dialog.close("playerStateDecisions");
        showStateActions(stateId);
      } catch (error) {
        notify("Finances refusées", error instanceof Error ? error.message : String(error));
      }
    }, "player-campaign-primary"));
    body.append(taxSection);

    const army = section("Forces armées", "Recrute des régiments, puis clique dessus sur la carte pour leur donner des ordres.");
    const regiments = state.military ?? [];
    if (!regiments.length) army.append(element("p", "player-campaign-muted", "Aucun régiment n'a encore été levé."));
    for (const regiment of regiments) {
      const row = element("div", "player-campaign-army-row");
      row.append(element("span", "", regiment.name + " · " + Military.getTroops(regiment.a).toLocaleString("fr-FR") + " soldats"));
      row.append(actionButton("Gérer", () => {
        Dialog.close("playerStateDecisions");
        openRegimentCommand(stateId, regiment.i);
      }));
      army.append(row);
    }
    army.append(actionButton("Lever un régiment · " + formatMoney(90), () => {
      try {
        const regiment = raiseRegiment(stateId);
        Layers.draw("military");
        Dialog.close("playerStateDecisions");
        openRegimentCommand(stateId, regiment.i);
      } catch (error) {
        notify("Levée impossible", error instanceof Error ? error.message : String(error));
      }
    }, "player-campaign-primary"));
    body.append(army);
  } else {
    const diplomacy = section("Relations diplomatiques", "L'IA prend en compte la culture, la religion, le régime, les voisins et les échanges.");
    diplomacy.append(
      line("Relations actuelles", getAttitude(playerStateId, stateId)),
      line("Compatibilité", String(Math.round(relationScore(playerStateId, stateId))))
    );
    const actions: [string, "alliance" | "commerce" | "paix" | "guerre"][] = [
      ["Proposer une alliance", "alliance"],
      ["Proposer un traité commercial", "commerce"],
      ["Proposer la paix", "paix"],
      ["Déclarer la guerre", "guerre"]
    ];
    for (const [label, kind] of actions) {
      diplomacy.append(actionButton(label, () => {
        try {
          const result = negotiate(playerStateId!, stateId, kind);
          Layers.draw("states", "borders", "military");
          Dialog.close("playerStateDecisions");
          notify(kind === "guerre" ? "Conflit" : "Diplomatie", result.accepted ? (state.name + " accepte la proposition.") : (state.name + " refuse la proposition."));
        } catch (error) {
          notify("Décision impossible", error instanceof Error ? error.message : String(error));
        }
      }, kind === "guerre" ? "player-campaign-danger" : "player-campaign-button"));
    }
    diplomacy.append(actionButton("Décréter un embargo", () => {
      try {
        setEmbargo(playerStateId!, stateId);
        Dialog.close("playerStateDecisions");
        showStateActions(stateId);
      } catch (error) {
        notify("Embargo refusé", error instanceof Error ? error.message : String(error));
      }
    }));
    body.append(diplomacy);
  }

  Dialog.message({
    id: "playerStateDecisions",
    title: (state.fullName ?? state.name) + (isPlayer ? " · Gouvernement" : " · Relations"),
    message: body,
    width: "29em",
    maxHeight: 620
  });
}

function lockNativeBurgEditor(): void {
  const ids = ["burgName", "burgGroup", "burgType", "burgCulture", "burgPopulation", "burgTags", "burgRemove", "burgRelocate", "burgLock", "burgEditEmblem", "burgSetPreviewLink", "burgStyleShow", "burgStyleHide", "burgEditLabelStyle", "burgEditGroupStyle", "burgEditLabel", "burglLegend"];
  for (const id of ids) {
    const control = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null;
    if (control) control.disabled = true;
  }
  document.querySelectorAll<HTMLElement>("#burgBody .burgFeature, #burgNameReRandom, #burgNameReCulture, #burgGroupConfigure").forEach(node => {
    node.classList.add("player-campaign-disabled");
    node.setAttribute("aria-disabled", "true");
  });
}

function refreshNativeBurg(burgId: number): void {
  Layers.draw("burgIcons", "labels", "markets", "goods", "trade");
  Controllers.BurgEditor.open(String(burgId));
}

function attachBurgActions(burgId: number): void {
  if (!campaignActive) return;
  const burg = globalThis.pack.burgs[burgId];
  const body = document.getElementById("burgBody");
  if (!burg || !body) return;

  lockNativeBurgEditor();
  body.querySelector("#playerCampaignCityManagement")?.remove();

  const ownerId = Number(burg.state ?? 0);
  const owner = globalThis.pack.states[ownerId];
  const management = element("div", "player-city-management");
  management.id = "playerCampaignCityManagement";

  if (!playerStateId || ownerId !== playerStateId) {
    const ownership = element("div", "player-city-management-owner");
    ownership.append(
      element("div", "label", "Territoire :"),
      element("span", "", owner?.fullName ?? owner?.name ?? "Terres neutres")
    );
    management.append(ownership);
    if (ownerId > 0) {
      management.append(nativeActionButton("Gouvernement", () => showStateActions(ownerId)));
    } else {
      management.append(element("p", "player-campaign-muted", "Cette localité n'appartient à aucun État."));
    }
  } else {
    const fundsRow = element("div", "player-city-management-funds");
    fundsRow.append(
      element("div", "label", "Trésor :"),
      element("strong", "", formatMoney(getFunds(ownerId)))
    );
    management.append(fundsRow, element("div", "label", "Aménagements :"));

    const controls = element("div", "player-city-management-buttons");
    const hasMarket = globalThis.pack.markets.some(market => market.centerBurgId === burgId);

    const market = nativeActionButton(
      hasMarket ? "Marché construit" : "Marché · " + formatMoney(marketCostFor(burgId, ownerId)),
      () => runAction("Marché", () => buildMarket(burgId, ownerId), () => refreshNativeBurg(burgId))
    );
    market.disabled = hasMarket;
    controls.append(market);

    controls.append(nativeActionButton(
      "Développer · " + formatMoney(urbanUpgradeCostFor(burgId, ownerId)),
      () => runAction("Développement urbain", () => upgradeCity(burgId, ownerId), () => refreshNativeBurg(burgId))
    ));

    const walls = nativeActionButton(
      burg.walls ? "Remparts construits" : "Remparts · " + formatMoney(fortificationCostFor(burgId, ownerId)),
      () => runAction("Fortifications", () => buildCityFortification(burgId, ownerId), () => refreshNativeBurg(burgId))
    );
    walls.disabled = Boolean(burg.walls);
    controls.append(walls);

    const citadel = nativeActionButton(
      burg.citadel ? "Citadelle construite" : "Citadelle · " + formatMoney(citadelCostFor(burgId, ownerId)),
      () => runAction("Citadelle", () => buildCityCitadel(burgId, ownerId), () => refreshNativeBurg(burgId))
    );
    citadel.disabled = Boolean(burg.citadel);
    controls.append(citadel);

    management.append(
      controls,
      nativeActionButton("Gouvernement de " + (owner?.name ?? "l'État"), () => showStateActions(ownerId))
    );
  }

  const tagsRow = document.getElementById("burgTags")?.parentElement;
  if (tagsRow?.parentElement) tagsRow.insertAdjacentElement("afterend", management);
  else body.append(management);
}

function lockNativeRegimentEditor(stateId: number): void {
  const composition = document.getElementById("regimentComposition");
  composition?.querySelectorAll<HTMLInputElement>("input").forEach(input => { input.disabled = true; });

  const ids = [
    "regimentType", "regimentName", "regimentNameRestore", "regimentIconChange", "regimentTags",
    "regimentAdd", "regimentSplit", "regimentAttach", "regimentToggleVisibility",
    "regimentRegenerateLegend", "regimentLegend", "regimentRemove"
  ];
  for (const id of ids) {
    const control = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null;
    if (control) control.disabled = true;
  }
  const attack = document.getElementById("regimentAttack") as HTMLButtonElement | null;
  if (attack) {
    attack.disabled = stateId !== playerStateId;
    attack.title = "Choisir un régiment ennemi à attaquer";
  }
}

function openRegimentCommand(stateId: number, regimentId: number): void {
  if (!campaignActive || stateId !== playerStateId) return;
  const state = globalThis.pack.states[stateId];
  const regiment = state?.military?.find(item => item.i === regimentId);
  if (!state || !regiment) return;

  const body = element("div", "player-regiment-command");
  const summary = element("div", "player-regiment-summary");
  const addStat = (label: string, value: string) => {
    const stat = element("div", "player-regiment-stat");
    stat.append(element("span", "", label), element("strong", "", value));
    summary.append(stat);
  };
  addStat("Effectif", Military.getTroops(regiment.a).toLocaleString("fr-FR") + " soldats");
  addStat("Trésor", formatMoney(getFunds(stateId)));
  addStat("Type", regiment.n ? "Flotte navale" : "Régiment terrestre");
  addStat("Position", Math.round(regiment.x) + " · " + Math.round(regiment.y));
  body.append(summary);

  const composition = element("section", "player-regiment-section");
  composition.append(element("div", "player-regiment-section-title", "Composition"));
  const units = element("div", "player-regiment-composition");
  for (const unit of options.map.military.units) {
    const row = element("div", "player-regiment-row");
    row.append(
      element("span", "", unit.name),
      element("strong", "", Military.getTroops(regiment.u[unit.name]).toLocaleString("fr-FR"))
    );
    units.append(row);
  }
  composition.append(units);
  body.append(composition);

  const recruitment = element("section", "player-regiment-section");
  recruitment.append(
    element("div", "player-regiment-section-title", "Renforts"),
    element("p", "player-regiment-muted", "Les nouvelles troupes sont payées par le trésor de l'État.")
  );
  const recruitControls = element("div", "player-regiment-recruit-row");
  const unitSelect = element("select", "player-regiment-input");
  for (const unit of options.map.military.units) unitSelect.append(new Option(unit.name, unit.name));
  const quantity = element("input", "player-regiment-input");
  quantity.type = "number";
  quantity.min = "1";
  quantity.max = "50000";
  quantity.step = "1";
  quantity.value = "100";
  recruitControls.append(unitSelect, quantity);
  recruitment.append(recruitControls);
  recruitment.append(nativeActionButton("Recruter", () => {
    try {
      const cost = recruitRegiment(stateId, regimentId, unitSelect.value, Number(quantity.value));
      Layers.draw("military");
      Dialog.close("playerRegimentCommand");
      openRegimentCommand(stateId, regimentId);
      notify("Renforts recrutés", "Les troupes ont rejoint " + regiment.name + ". Coût : " + formatMoney(cost) + ".");
    } catch (error) {
      notify("Recrutement impossible", error instanceof Error ? error.message : String(error));
    }
  }, "player-regiment-button"));
  body.append(recruitment);

  const orders = element("section", "player-regiment-section");
  orders.append(element("div", "player-regiment-section-title", "Ordres"));
  const orderButtons = element("div", "player-regiment-order-buttons");
  orderButtons.append(nativeActionButton("Déplacer le régiment", () => {
    pendingMove = {stateId, regimentId};
    if (statusLabel) statusLabel.textContent = "Clique sur la destination de " + regiment.name;
    Dialog.close("playerRegimentCommand");
    updateHud();
  }, "player-regiment-button"));
  orderButtons.append(nativeActionButton("Attaquer un régiment ennemi", () => {
    Dialog.close("playerRegimentCommand");
    Controllers.RegimentEditor.open("#regiment" + stateId + "-" + regimentId);
    lockNativeRegimentEditor(stateId);
  }, "player-regiment-button"));
  orders.append(orderButtons);
  orders.append(element("p", "player-regiment-muted", "Le combat utilise l'écran de bataille natif d'Azgaar."));
  body.append(orders);

  Dialog.message({
    id: "playerRegimentCommand",
    title: "Commandement · " + regiment.name,
    message: body,
    width: "31em",
    maxHeight: 680
  });
}

function handleMapClick(event: Event): void {
  if (!campaignActive || !(event instanceof CustomEvent)) return;
  const mouse = event.detail as MapClickDetail;
  if (!(mouse instanceof MouseEvent)) return;
  const viewbox = document.getElementById("viewbox");
  if (!viewbox) return;
  event.preventDefault();

  if (pendingMove) {
    const point = getPointer(mouse, viewbox);
    const cell = Pack.findCell(point[0], point[1]);
    if (cell === undefined) return;
    const order = pendingMove;
    pendingMove = null;
    try {
      const cost = moveRegiment(order.stateId, order.regimentId, cell);
      Layers.draw("military");
      notify("Ordre exécuté", "Le régiment a atteint sa destination. Coût : " + formatMoney(cost) + ".");
    } catch (error) {
      notify("Déplacement refusé", error instanceof Error ? error.message : String(error));
    }
    updateHud();
    return;
  }

  const target = mouse.target instanceof Element ? mouse.target : null;
  const armyElement = target?.closest<SVGGElement>("#armies g[data-state][data-id]");
  if (armyElement) {
    const stateId = Number(armyElement.dataset.state);
    const regimentId = Number(armyElement.dataset.id);
    if (stateId === playerStateId) openRegimentCommand(stateId, regimentId);
    else showStateActions(stateId);
    return;
  }

  const burgElement = target?.closest<SVGElement>("#burgIcons [data-id], #labels text[data-label-type='burg']");
  const point = getPointer(mouse, viewbox);
  const cellId = Pack.findCell(point[0], point[1]);
  const burgId = burgElement
    ? Number(burgElement.getAttribute("data-id"))
    : (cellId === undefined ? 0 : Number(globalThis.pack.cells.burg?.[cellId] ?? 0));
  if (burgId > 0 && globalThis.pack.burgs[burgId] && !globalThis.pack.burgs[burgId].removed) {
    Controllers.BurgEditor.open(burgId);
    return;
  }
  if (cellId === undefined) return;
  const stateId = Number(globalThis.pack.cells.state?.[cellId] ?? 0);
  if (stateId > 0) showStateActions(stateId);
}

export const PlayerMode = {
  init(): void {
    if (document.getElementById("playerCampaignHud")) return;
    playerStateId = getPlayerStateId();
    createHud();
    window.addEventListener("azgaar:map-click", handleMapClick);
    window.addEventListener("azgaar:burg-editor-open", event => {
      const detail = (event as CustomEvent<{burgId: number}>).detail;
      if (detail?.burgId) attachBurgActions(detail.burgId);
    });
    window.addEventListener("azgaar:regiment-editor-open", event => {
      const detail = (event as CustomEvent<{stateId: number; regimentId: number}>).detail;
      if (detail && campaignActive) lockNativeRegimentEditor(detail.stateId);
    });
    window.addEventListener("map:generated", () => {
      playerStateId = getPlayerStateId();
      pendingMove = null;
      if (campaignActive && playerStateId) applyCampaignMode(true);
      else if (campaignActive) applyCampaignMode(false);
      else {
        options.map.viewOnly = false;
        updateHud();
      }
    });
    if (playerStateId) applyCampaignMode(true);
    tick();
  }
};
