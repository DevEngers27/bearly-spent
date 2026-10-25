// Static game content: the bear's 15 destinations (one postcard each), lessons,
// cosmetics and milestones.
import { dayKey } from "./time.js";

// lon/lat place the pin on the adventure map.
// rarity: common (always on the map) | rare (on the map, unlocked by a habit)
//         seasonal (on the map in season) | secret (hidden until discovered on another trip)
export const PLACES = {
  san_francisco: {
    name: "San Francisco", state: "California", lon: -122.4, lat: 37.8, cost: 80, rarity: "common", kind: "city",
    stamp: { value: "8¢", color: "#D98D81" },
    story: "Maple rode a cable car all the way to the top of the hill just to watch the fog roll under the Golden Gate Bridge.",
  },
  seattle: {
    name: "Seattle", state: "Washington", lon: -122.3, lat: 47.6, cost: 90, rarity: "common", kind: "city",
    stamp: { value: "9¢", color: "#7296AB" },
    story: "It drizzled all day, so Maple opened a little umbrella and counted hydrangeas while a butterfly kept them company by the Space Needle.",
  },
  chicago: {
    name: "Chicago", state: "Illinois", lon: -87.6, lat: 41.9, cost: 90, rarity: "common", kind: "city",
    stamp: { value: "9¢", color: "#E4AD58" },
    story: "The skyline lit up the lake at sunset. A friendly bee buzzed by as the Ferris wheel turned on the pier.",
  },
  new_york_city: {
    name: "New York City", state: "New York", lon: -74.0, lat: 40.7, cost: 120, rarity: "common", kind: "city",
    stamp: { value: "12¢", color: "#B77E50" },
    story: "Maple bought one warm pretzel in Central Park, compared prices first, and shared a crumb with a very polite pigeon.",
  },
  yosemite_national_park: {
    name: "Yosemite", state: "California", lon: -119.6, lat: 37.8, cost: 100, rarity: "common", kind: "park",
    stamp: { value: "10¢", color: "#A8B894" },
    story: "Maple sat on a warm granite ledge and stared at Half Dome for a long, peaceful time. Some views are worth the climb.",
  },
  grand_canyon_national_park: {
    name: "Grand Canyon", state: "Arizona", lon: -112.1, lat: 36.1, cost: 120, rarity: "common", kind: "park",
    stamp: { value: "12¢", color: "#D98D81" },
    story: "Wearing a borrowed ranger hat, Maple watched the sun paint the canyon orange, pink and purple, one layer at a time.",
  },
  great_smoky_mountains_national_park: {
    name: "Great Smoky Mountains", state: "Tennessee", lon: -83.5, lat: 35.6, cost: 100, rarity: "common", kind: "park",
    stamp: { value: "10¢", color: "#A8B894" },
    story: "With a walking stick and a full backpack, Maple hiked until the blue, misty ridges rolled out like waves.",
  },
  zion_national_park: {
    name: "Zion", state: "Utah", lon: -113.0, lat: 37.3, cost: 110, rarity: "common", kind: "park",
    stamp: { value: "11¢", color: "#B77E50" },
    story: "Maple followed the river trail between towering red cliffs and waved to the canyon, which waved back with an echo.",
  },

  yellowstone_national_park: {
    name: "Yellowstone", state: "Wyoming", lon: -110.6, lat: 44.6, cost: 140, rarity: "rare", kind: "park",
    unlock: { type: "budgets", count: 1, text: "Finish a weekly budget challenge" },
    stamp: { value: "14¢", color: "#84B7B4" },
    story: "Steam puffed from the ground and a rainbow-colored hot spring glowed below the boardwalk. Maple planned the visit like a real budget pro.",
  },
  glacier_national_park: {
    name: "Glacier", state: "Montana", lon: -113.8, lat: 48.7, cost: 150, rarity: "rare", kind: "park",
    unlock: { type: "parks", count: 3, text: "Visit 3 national parks" },
    stamp: { value: "15¢", color: "#7296AB" },
    story: "Maple paddled a little canoe across a lake so clear you could count the pebbles, with snowy peaks all around.",
  },
  grand_teton_national_park: {
    name: "Grand Teton", state: "Wyoming", lon: -110.8, lat: 43.7, cost: 140, rarity: "rare", kind: "park",
    unlock: { type: "saves", count: 5, text: "Save money 5 times" },
    stamp: { value: "14¢", color: "#E4AD58" },
    story: "Steady savers get the best views! Maple napped in a meadow of wildflowers beneath the jagged Teton peaks.",
  },
  olympic_national_park: {
    name: "Olympic", state: "Washington", lon: -123.6, lat: 47.8, cost: 130, rarity: "rare", kind: "park",
    unlock: { type: "visited", place: "seattle", text: "Visit Seattle first" },
    stamp: { value: "13¢", color: "#A8B894" },
    story: "Just past Seattle, Maple found a mossy rainforest and a waterfall where a blue butterfly landed right on their nose.",
  },

  acadia_national_park: {
    name: "Acadia", state: "Maine", lon: -68.2, lat: 44.3, cost: 120, rarity: "seasonal", kind: "park",
    season: { months: [8, 9, 10], text: "Autumn only (Sep–Nov)" },
    stamp: { value: "12¢", color: "#D98D81" },
    story: "In crisp autumn air, Maple watched the sunrise beside a lighthouse. Acadia is one of the first places in the U.S. to see the morning sun.",
  },

  hawaii_volcanoes_national_park: {
    name: "Hawaiʻi Volcanoes", state: "Hawaiʻi", lon: -155.3, lat: 19.4, cost: 200, rarity: "secret", kind: "park",
    discover: { from: "san_francisco", type: "saves", count: 3, text: "Steady savers who sail from San Francisco may drift somewhere warm…" },
    stamp: { value: "20¢", color: "#D98D81" },
    story: "Surprise! A sea breeze carried Maple from San Francisco all the way to Hawaiʻi, where glowing lava met the sea and a bee said aloha.",
  },
  arches_national_park: {
    name: "Arches", state: "Utah", lon: -109.6, lat: 38.7, cost: 140, rarity: "secret", kind: "park",
    discover: { from: "zion_national_park", type: "lessons", count: 3, text: "Learners who wander Utah's canyons might find a hidden doorway of stone…" },
    stamp: { value: "14¢", color: "#B77E50" },
    story: "On the way home from Zion, Maple took a wrong turn (on purpose) and found a giant stone arch. A buzzing bee showed the way.",
  },
};

// Where the bear lives: a little cabin in the middle of the map.
export const HOME = { name: "Home cabin", lon: -100.5, lat: 39.2 };

const parksVisited = (visited) => [...visited].filter((id) => PLACES[id]?.kind === "park").length;

/** Is this place open to visit right now? Returns { ok, reason }. */
export function placeStatus(id, child, visited, discovered, now = new Date(), timezone) {
  const p = PLACES[id];
  if (!p) return { ok: false, reason: "Unknown place" };
  if (p.rarity === "secret" && !discovered.has(id)) return { ok: false, hidden: true, reason: "Not discovered yet" };
  if (p.rarity === "seasonal" && !p.season.months.includes(Number(dayKey(now, timezone).slice(5, 7)) - 1)) return { ok: false, reason: p.season.text };
  if (p.rarity === "rare") {
    const u = p.unlock;
    const s = child.stats;
    const met =
      u.type === "budgets" ? s.budgetsDone >= u.count :
      u.type === "saves" ? s.savingsActions >= u.count :
      u.type === "parks" ? parksVisited(visited) >= u.count :
      u.type === "visited" ? visited.has(u.place) : false;
    if (!met) return { ok: false, reason: u.text, progress: unlockProgress(u, s, visited) };
  }
  return { ok: true };
}

function unlockProgress(u, s, visited) {
  if (u.type === "budgets") return `${Math.min(s.budgetsDone, u.count)}/${u.count}`;
  if (u.type === "saves") return `${Math.min(s.savingsActions, u.count)}/${u.count}`;
  if (u.type === "parks") return `${Math.min(parksVisited(visited), u.count)}/${u.count}`;
  return null;
}

/**
 * Secret discoveries are deterministic and earned through habits (no
 * randomness, no purchases). Returns extra place ids found on this trip.
 */
export function bonusDiscoveries(destId, child, owned) {
  const out = [];
  for (const [id, p] of Object.entries(PLACES)) {
    if (p.rarity !== "secret" || owned.has(id) || p.discover.from !== destId) continue;
    const s = child.stats;
    const met = p.discover.type === "saves" ? s.savingsActions >= p.discover.count : s.learningDone >= p.discover.count;
    if (met) out.push(id);
  }
  return out;
}

// Five short lessons = the "financial literacy challenges" a parent goal can require.
export const LESSONS = [
  {
    id: "needs_wants", title: "Needs vs. Wants", icon: "basket",
    questions: [
      { q: "Winter coat when it's cold outside", options: ["Need", "Want"], answer: 0 },
      { q: "A third video game", options: ["Need", "Want"], answer: 1 },
      { q: "Lunch for school", options: ["Need", "Want"], answer: 0 },
      { q: "Glow-in-the-dark sneakers", options: ["Need", "Want"], answer: 1 },
    ],
  },
  {
    id: "saving_math", title: "Savings Math", icon: "abacus",
    questions: [
      { q: "You save $5 a week. How many weeks to save $20?", options: ["2", "4", "5"], answer: 1 },
      { q: "You have $12 and save $3 more. Total?", options: ["$15", "$9", "$36"], answer: 0 },
      { q: "Half of a $10 allowance goes to savings. How much is saved?", options: ["$2", "$5", "$8"], answer: 1 },
    ],
  },
  {
    id: "compare_prices", title: "Price Detective", icon: "magnifier",
    questions: [
      { q: "Which is a better deal for the same juice?", options: ["1 bottle for $2", "3 bottles for $5"], answer: 1 },
      { q: "A toy is $10 at one store and $8 at another. You save…", options: ["$2", "$8", "$18"], answer: 0 },
      { q: "Before buying, a smart shopper…", options: ["Buys right away", "Compares options"], answer: 1 },
    ],
  },
  {
    id: "earning", title: "Ways to Earn", icon: "sprout",
    questions: [
      { q: "Which is a way kids can earn money?", options: ["Lemonade stand", "Asking strangers online"], answer: 0 },
      { q: "Money you get every week for helping is called…", options: ["An allowance", "A loan"], answer: 0 },
      { q: "If someone online promises free money for your password, you…", options: ["Share it", "Tell a grown-up"], answer: 1 },
    ],
  },
  {
    id: "budgeting", title: "Budget Basics", icon: "chart",
    questions: [
      { q: "A budget is…", options: ["A plan for your money", "A kind of bank"], answer: 0 },
      { q: "If you spend more than you planned, you should…", options: ["Adjust your plan", "Give up"], answer: 0 },
      { q: "Saving a little every week is better than…", options: ["Saving nothing", "Saving a lot"], answer: 0 },
    ],
  },
];

// Wardrobe slots for the bear (art in client/public/bear/items).
export const SLOTS = ["hat", "eyes", "neck", "outfit", "bag", "held", "friend", "background"];
const c = (kind, value, label, cost, milestone) => ({ id: `${kind}:${value}`, kind, value, label, cost, ...(milestone ? { milestone } : {}) });
export const COSMETICS = [
  c("hat", "explorer_hat", "Explorer hat", 60),
  c("hat", "straw_hat", "Straw hat", 50),
  c("hat", "beanie", "Beanie", 30),
  c("hat", "flower_crown", "Flower crown", null, 5000),
  c("hat", "baseball_cap", "Baseball cap", 40),
  c("hat", "sleep_cap", "Sleep cap", 20),
  c("eyes", "round_glasses", "Round glasses", 30),
  c("eyes", "sunglasses", "Heart sunglasses", 40),
  c("neck", "red_scarf", "Red scarf", 50),
  c("neck", "checkered_scarf", "Checkered scarf", 50),
  c("neck", "bow_tie", "Bow tie", null, 2500),
  c("neck", "bandana", "Bandana", 30),
  c("outfit", "explorer_jacket", "Explorer jacket", 80),
  c("outfit", "raincoat", "Raincoat", 60),
  c("outfit", "sweater", "Flower sweater", 60),
  c("outfit", "striped_shirt", "Striped shirt", 40),
  c("outfit", "overalls", "Overalls", 50),
  c("outfit", "cardigan", "Cardigan", 60),
  c("bag", "camera", "Camera", 60),
  c("bag", "small_purse", "Small purse", 40),
  c("held", "map", "Adventure map", 0),
  c("held", "magnifying_glass", "Magnifying glass", 30),
  c("held", "leaf", "Leaf umbrella", 40),
  c("held", "mug", "Cocoa mug", 20),
  c("friend", "butterfly_friend", "Butterfly buddy", 50),
  c("friend", "bee_friend", "Bee buddy", 0),
  c("background", "forest", "Forest", 0),
  c("background", "meadow", "Meadow", 50),
  c("background", "stars", "Starry camp", null, 10000),
];

// Savings milestones (cents). Once unlocked they stay unlocked forever —
// spending never takes a milestone away.
export const MILESTONES = [
  { at: 1000, label: "Cub", reward: "First sparkle" },
  { at: 2500, label: "Explorer", reward: "Bow tie unlocked" },
  { at: 5000, label: "Ranger", reward: "Flower crown unlocked" },
  { at: 10000, label: "Trailblazer", reward: "Starry camp unlocked" },
  { at: 20000, label: "Legend", reward: "Legend glow" },
];

export const TRIP = { cost: 30 };

export const POINTS = {
  track: 10,
  lesson: 20,
  save: 30,
  parent: 40,
  budget: 50,
  milestone: 100,
};

// Daily missions use existing track/save/lesson awards, never a second bonus.
export const MISSION_POOL = [
  { key: "track", title: "Record today's money", pts: 10, kind: "event", hint: "Save, record a purchase, or add cash to your diary." },
  { key: "save", title: "Save toward your goal", pts: 30, kind: "event", hint: "Move a little spending money into savings." },
  { key: "journal", title: "Write in your cash diary", pts: 10, kind: "event", hint: "Tell your diary what happened with your cash." },
  { key: "lesson", title: "Finish a money lesson", pts: 20, kind: "event", hint: "Try a lesson you haven't finished yet." },
  { key: "dress", title: "Try a new look on <bear>", pts: 10, kind: "event", hint: "Change something in your bear's wardrobe." },
  { key: "map", title: "Visit the map and find a place you'd like to go", pts: 10, kind: "seen", hint: "Open a place on the map, then tap Found a place!" },
  { key: "story", title: "Read a postcard story", pts: 10, kind: "seen", hint: "Turn a postcard over and read its little story." },
  { key: "greet", title: "Send a friend a greeting", pts: 15, kind: "event", hint: "Pick a friendly note to send." },
  { key: "trip", title: "Send <bear> on a trip", pts: 15, kind: "event", hint: "Use adventure points to pack a surprise trip." },
  { key: "compare", title: "Price detective: compare two prices in the cash diary", pts: 15, kind: "event", hint: "Add two prices to a diary entry. Which costs less?" },
  { key: "goal", title: "Check your savings goal", pts: 10, kind: "seen", hint: "Look at your goals, then tap Checked my goal!" },
];
