import {
  advanceTurn,
  buildMarket,
  buildRoad,
  formatMoney,
  getFunds,
  getStateEconomy,
  negotiate,
  setBudget,
  setEmbargo,
  setTaxes
} from "./player-mode-engine";
import { get, isConnected } from "@/services/assistant/provider/connection";
import {
  complete,
  type Message,
  type ToolDefinition
} from "@/services/assistant/provider/providers";

const tools: ToolDefinition[] = [
  {
    name: "read_government",
    description: "Read the selected state's treasury, population, production, trade and city list.",
    input_schema: {type: "object", properties: {}, additionalProperties: false}
  },
  {
    name: "advance_turn",
    description: "End one game turn. This runs the real Azgaar economy, applies population growth, project upkeep, AI decisions and war upkeep.",
    input_schema: {type: "object", properties: {}, additionalProperties: false}
  },
  {
    name: "build_market",
    description: "Build a market in one of the selected state's cities. The treasury is charged before construction and the market has recurring upkeep.",
    input_schema: {type: "object", properties: {burgId: {type: "integer"}}, required: ["burgId"], additionalProperties: false}
  },
  {
    name: "build_road",
    description: "Build a paid land road between two cities belonging to the selected state. The route cannot cross another state's territory. It has recurring upkeep.",
    input_schema: {type: "object", properties: {fromBurgId: {type: "integer"}, toBurgId: {type: "integer"}}, required: ["fromBurgId", "toBurgId"], additionalProperties: false}
  },
  {
    name: "set_taxes",
    description: "Set the selected state's sales-tax rate from 0 to 0.3 and poll tax as a money amount per person. Changes take effect on the next turn.",
    input_schema: {type: "object", properties: {salesTax: {type: "number", minimum: 0, maximum: 0.3}, pollTax: {type: "number", minimum: 0, maximum: 2}}, required: ["salesTax", "pollTax"], additionalProperties: false}
  },
  {
    name: "set_budget",
    description: "Set public-spending shares in whole percents from 0 to 100. Spending is paid through goods actually purchased by the state's public buyers during the next economic turn.",
    input_schema: {
      type: "object",
      properties: {
        court: {type: "integer", minimum: 0, maximum: 100},
        administration: {type: "integer", minimum: 0, maximum: 100},
        infrastructure: {type: "integer", minimum: 0, maximum: 100},
        military: {type: "integer", minimum: 0, maximum: 100}
      },
      additionalProperties: false
    }
  },
  {
    name: "negotiate",
    description: "Pay for a diplomatic mission to propose an alliance, commercial treaty, peace or declare an abstract war with another state.",
    input_schema: {
      type: "object",
      properties: {
        targetStateId: {type: "integer"},
        kind: {type: "string", enum: ["alliance", "commerce", "paix", "guerre"]}
      },
      required: ["targetStateId", "kind"],
      additionalProperties: false
    }
  },
  {
    name: "set_embargo",
    description: "Pay to embargo imports from a target state. This breaks an active alliance or trade agreement with that state.",
    input_schema: {type: "object", properties: {targetStateId: {type: "integer"}}, required: ["targetStateId"], additionalProperties: false}
  }
];

const integer = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(name + " doit être un identifiant entier.");
  return value;
};
const numeric = (value: unknown, name: string, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(name + " doit être compris entre " + min + " et " + max + ".");
  return value;
};

function stateContext(stateId: number): string {
  const state = globalThis.pack.states.find(item => item?.i === stateId && !item.removed);
  if (!state) throw new Error("L'État dirigé n'existe plus.");
  const cities = globalThis.pack.burgs
    .filter(burg => burg?.i && !burg.removed && burg.state === stateId)
    .map(burg => ({id: burg.i, name: burg.name, population: burg.population ?? 0}));
  const others = globalThis.pack.states
    .filter(item => item?.i && !item.removed && item.i !== stateId)
    .map(item => ({id: item.i, name: item.fullName ?? item.name}));
  const economy = getStateEconomy(stateId);
  return [
    "Carte et état courant (données réelles, ne pas inventer les identifiants) :",
    "État dirigé : " + (state.fullName ?? state.name) + " (ID " + stateId + ")",
    "Trésor de campagne : " + formatMoney(getFunds(stateId)),
    "Dernier solde économique : " + formatMoney(economy.dailyBalance),
    "Population : " + Math.round(economy.people),
    "Trésor négatif = dette ; ne pas proposer de chantier impossible à financer.",
    "Villes de l'État : " + JSON.stringify(cities),
    "Autres États : " + JSON.stringify(others),
    "Règles : chaque chantier, entretien de route/marché, mission et conflit coûte de l'argent. Ne prétends pas qu'une action a réussi avant un outil. Utilise read_government pour vérifier les fonds."
  ].join("\n");
}

function executeTool(name: string, input: Record<string, unknown>, stateId: number): string {
  if (name === "read_government") {
    const summary = getStateEconomy(stateId);
    const state = globalThis.pack.states[stateId];
    const trade = summary.trade;
    return JSON.stringify({
      state: state.fullName ?? state.name,
      campaignTreasury: summary.balance,
      latestDailyNet: summary.dailyBalance,
      people: summary.people,
      prosperity: summary.prosperity,
      output: summary.output,
      exports: trade.exports,
      imports: trade.imports,
      partners: trade.partners
    });
  }
  if (name === "advance_turn") {
    const result = advanceTurn(stateId);
    return "Tour " + (result.turn - 1) + " terminé. " + (result.changes.join(" ; ") || "Cycle économique exécuté.");
  }
  if (name === "build_market") {
    const burgId = integer(input.burgId, "burgId");
    const cost = buildMarket(burgId, stateId);
    return "Marché créé. Coût initial : " + formatMoney(cost) + ". Entretien par tour : 4.";
  }
  if (name === "build_road") {
    const from = integer(input.fromBurgId, "fromBurgId");
    const to = integer(input.toBurgId, "toBurgId");
    const cost = buildRoad(from, to, stateId);
    return "Route construite. Coût initial : " + formatMoney(cost) + ". Entretien par tour enregistré.";
  }
  if (name === "set_taxes") {
    const salesTax = numeric(input.salesTax, "salesTax", 0, 0.3);
    const pollTax = numeric(input.pollTax, "pollTax", 0, 2);
    setTaxes(stateId, salesTax, pollTax);
    return "Fiscalité enregistrée. Elle s'appliquera au prochain tour.";
  }
  if (name === "set_budget") {
    const expenses: Record<string, number> = {};
    for (const key of ["court", "administration", "infrastructure", "military"]) {
      const value = input[key];
      if (value !== undefined) expenses[key] = numeric(value, key, 0, 100);
    }
    if (!Object.keys(expenses).length) throw new Error("Indique au moins un poste budgétaire.");
    setBudget(stateId, expenses as never);
    return "Budget public enregistré. Les commandes seront payées selon les achats réalisés au prochain tour.";
  }
  if (name === "negotiate") {
    const targetId = integer(input.targetStateId, "targetStateId");
    const kind = input.kind;
    if (kind !== "alliance" && kind !== "commerce" && kind !== "paix" && kind !== "guerre")
      throw new Error("Type de négociation inconnu.");
    const result = negotiate(stateId, targetId, kind);
    return (result.accepted ? "Proposition acceptée ou conflit engagé." : "La proposition est refusée.") +
      " Coût de mission : " + formatMoney(result.cost) + ". Score relationnel : " + result.score + ".";
  }
  if (name === "set_embargo") {
    const targetId = integer(input.targetStateId, "targetStateId");
    setEmbargo(stateId, targetId);
    return "Embargo enregistré. Coût : 85.";
  }
  throw new Error("Action inconnue : " + name);
}

export async function askPlayerAI(
  question: string,
  stateId: number,
  history: Message[]
): Promise<string> {
  if (!isConnected()) throw new Error("Aucune IA n'est configurée. Ouvre l'assistant Azgaar pour connecter un fournisseur.");
  const userQuestion = question.trim();
  if (!userQuestion) throw new Error("Écris une demande avant d'envoyer.");
  history.push({role: "user", content: [{type: "text", text: stateContext(stateId) + "\n\nDemande du joueur : " + userQuestion}]});

  let finalAnswer = "";
  const maxToolRounds = 4;
  for (let round = 0; round < maxToolRounds; round++) {
    const response = await complete({
      ...get(),
      system: [{
        type: "text",
        text: [
          "Tu es le conseiller de gouvernement du Mode Joueur d'Azgaar.",
          "Réponds en français, de façon claire et concrète.",
          "Tu peux consulter et modifier uniquement l'État dirigé en utilisant les outils autorisés.",
          "Ne propose jamais de code libre, de scripts, de commandes arbitraires ou d'identifiants inventés.",
          "Chaque chantier, entretien, négociation, embargo et conflit a un coût réel. Ne tente une action qu'après avoir vérifié qu'elle est pertinente.",
          "Un outil qui renvoie une erreur signifie que l'action n'a pas été appliquée.",
          "N'affirme jamais qu'un changement est appliqué sans résultat positif de l'outil.",
          "Demande des précisions au lieu de choisir une ville ou un pays si la cible est ambiguë.",
          "Les guerres sont abstraites : force économique, budget militaire, approvisionnement, score stratégique et coûts d'entretien ; pas de tactique militaire réelle."
        ].join("\n")
      }],
      messages: history.slice(-16),
      tools
    });

    if (response.content.length) history.push({role: "assistant", content: response.content});
    const text = response.content.filter(block => block.type === "text").map(block => block.text).join("\n\n").trim();
    const calls = response.content.filter(block => block.type === "tool_use");
    if (text) finalAnswer = text;
    if (!calls.length) return finalAnswer || "Le modèle n'a pas fourni de réponse textuelle.";
    const results = calls.map(call => {
      try {
        const outcome = executeTool(call.name, call.input, stateId);
        return {type: "tool_result" as const, tool_use_id: call.id, content: outcome};
      } catch (error) {
        return {
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: error instanceof Error ? error.message : String(error),
          is_error: true
        };
      }
    });
    history.push({role: "user", content: results});
  }
  return finalAnswer || "J'ai atteint la limite d'actions pour une demande. Reformule en plusieurs étapes.";
}
