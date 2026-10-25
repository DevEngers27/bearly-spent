import { readFileSync } from "node:fs";

const audiences = ["kid", "parent"];
export const guides = Object.freeze(Object.fromEntries(audiences.map((audience) => [audience,
  readFileSync(new URL(`../docs/help/${audience}.md`, import.meta.url), "utf8"),
])));
const sections = Object.fromEntries(audiences.map((audience) => [audience,
  [...guides[audience].matchAll(/^## (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].map((match) => ({ title: match[1], text: match[2].trim() })),
]));
const stop = new Set("a an the i my me your you our do does can how where is are to in on it of for and or with about have put use get set what when something moneyquest bear".split(" "));
const synonyms = {
  buddies: "friend", buddy: "friend", friends: "friend", friendship: "friend",
  cash: "money", trips: "trip", adventure: "trip", adventures: "trip", travel: "trip",
  codes: "code", children: "kid", child: "kid", kids: "kid", device: "devices",
  clothes: "dress", clothing: "dress", outfit: "dress", wardrobe: "dress",
  goals: "goal", lessons: "lesson", missions: "mission", swaps: "swap", trading: "swap",
  signin: "sign", signing: "sign", login: "sign", logout: "out",
  talk: "chat", talking: "chat", profile: "profiles",
};
const tokens = (value) => new Set((String(value).toLowerCase().replace(/\bbearly\s+spent\b/g, "").match(/[a-z0-9]+/g) || [])
  .filter((token) => !stop.has(token)).map((token) => synonyms[token] || token));

// Deliberately stem-free and local: only audience-approved guide excerpts leave here.
export function lookup_help(question, audience = "kid", bearName = "your bear") {
  if (!audiences.includes(audience)) return [];
  // The map's "pin" is not a parent PIN. Kid help never supplies PIN setup.
  if (audience === "kid" && /\b(?:set|change|reset|forgot)\b.*\bpin\b/i.test(question)) return [];
  const words = tokens(question);
  const ranked = (sections[audience] || []).map((section, index) => {
    const heading = tokens(section.title), body = tokens(section.text);
    const score = [...words].reduce((sum, word) => sum + (heading.has(word) ? 4 : body.has(word) ? 1 : 0), 0);
    return { ...section, score, index };
  }).filter((section) => section.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.filter((section) => section.score >= ranked[0].score * 0.6).slice(0, 2)
    .map(({ title, text }) => ({ audience, title: title.replaceAll("<bear>", bearName), text: text.replaceAll("<bear>", bearName) }));
}

export function helpAnswer(question, audience, bearName) {
  const found = lookup_help(question, audience, bearName);
  return found.length ? found.map(({ title, text }) => `${title}\n\n${text}`).join("\n\n")
    : audience === "kid" ? "I couldn't find that in the guide. Please ask a grown-up to help."
      : "I couldn't find that in the Bearly Spent guide. Try a question about a screen or feature, or open /help.";
}

export const HELP_TOOL = {
  name: "lookup_help",
  description: "Find the best one or two Bearly Spent guide sections for an app-use question. Read-only.",
  input_schema: { type: "object", properties: { question: { type: "string", maxLength: 500 } }, required: ["question"], additionalProperties: false },
};
