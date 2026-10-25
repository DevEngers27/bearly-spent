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

// Short lessons = the "financial literacy challenges" a parent goal can require.
export const LESSONS = [
  {
    id: "needs_wants", title: "Needs vs. Wants", icon: "basket",
    questions: [
      { q: "Winter coat when it's cold outside", options: ["Need", "Want"], answer: 0 },
      { q: "A third video game", options: ["Need", "Want"], answer: 1 },
      { q: "Lunch for school", options: ["Need", "Want"], answer: 0 },
      { q: "Glow-in-the-dark sneakers", options: ["Need", "Want"], answer: 1 },
      { q: "Your only school shoes no longer fit. A pair that fits is a…", options: ["Want", "Need"], answer: 1 },
      { q: "You have water to drink but want a fancy smoothie. The smoothie is a…", options: ["Want", "Need"], answer: 0 },
    ],
  },
  {
    id: "saving_math", title: "Savings Math", icon: "abacus",
    questions: [
      { q: "You save $5 a week. How many weeks to save $20?", options: ["2", "4", "5"], answer: 1 },
      { q: "You have $12 and save $3 more. Total?", options: ["$15", "$9", "$36"], answer: 0 },
      { q: "Half of a $10 allowance goes to savings. How much is saved?", options: ["$2", "$5", "$8"], answer: 1 },
      { q: "You have $8 saved for a $14 book. How much more do you need?", options: ["$6", "$14", "$22"], answer: 0 },
      { q: "You save $2 on Monday and $4 on Friday. How much did you save?", options: ["$2", "$6", "$8"], answer: 1 },
      { q: "You put two quarters in your savings jar. How much did you add?", options: ["25 cents", "50 cents", "$2"], answer: 1 },
    ],
  },
  {
    id: "compare_prices", title: "Price Detective", icon: "magnifier",
    questions: [
      { q: "Which is a better deal for the same juice?", options: ["1 bottle for $2", "3 bottles for $5"], answer: 1 },
      { q: "A toy is $10 at one store and $8 at another. You save…", options: ["$2", "$8", "$18"], answer: 0 },
      { q: "Before buying, a smart shopper…", options: ["Buys right away", "Compares options"], answer: 1 },
      { q: "The same notebook is $3 at one shop and $5 at another. Which costs less?", options: ["The $5 notebook", "The $3 notebook"], answer: 1 },
      { q: "Two shops sell the same $6 ball. One adds $2 shipping. Which total is lower?", options: ["$6 with free pickup", "$6 plus $2 shipping"], answer: 0 },
      { q: "Two snack packs cost the same. What else helps you compare value?", options: ["Only the package color", "How much food each holds"], answer: 1 },
    ],
  },
  {
    id: "earning", title: "Ways to Earn", icon: "sprout",
    questions: [
      { q: "Which is a way kids can earn money?", options: ["Lemonade stand", "Asking strangers online"], answer: 0 },
      { q: "Money you get every week for helping is called…", options: ["An allowance", "A loan"], answer: 0 },
      { q: "If someone online promises free money for your password, you…", options: ["Share it", "Tell a grown-up"], answer: 1 },
      { q: "A grown-up offers $3 to water plants twice. What should you agree on first?", options: ["The job and when it is done", "What you will buy afterward"], answer: 0 },
      { q: "You earn $4 for each approved yard job and finish two. How much did you earn?", options: ["$6", "$8", "$2"], answer: 1 },
      { q: "A neighbor asks you to use a tool you have never used. What comes first?", options: ["Try it to finish faster", "Ask your grown-up about safety"], answer: 1 },
    ],
  },
  {
    id: "budgeting", title: "Budget Basics", icon: "chart",
    questions: [
      { q: "A budget is…", options: ["A plan for your money", "A kind of bank"], answer: 0 },
      { q: "If you spend more than you planned, you should…", options: ["Adjust your plan", "Give up"], answer: 0 },
      { q: "Saving a little every week is better than…", options: ["Saving nothing", "Saving a lot"], answer: 0 },
      { q: "You have $12. You plan $4 to save and $6 for needs. How much is left?", options: ["$2", "$10", "$12"], answer: 0 },
      { q: "Your plan adds up to $15, but you have $10. What helps?", options: ["Spend the full $15 anyway", "Trim $5 from the plan"], answer: 1 },
      { q: "You wrote a budget last week. When is a useful time to check it?", options: ["Before deciding what to spend next", "Only after every dollar is gone"], answer: 0 },
    ],
  },
  {
    id: "sales", title: "Sale Sleuth", icon: "magnifier",
    questions: [
      { q: "A $10 puzzle is 20% off. That saves $2. What do you pay before tax?", options: ["$2", "$8", "$12"], answer: 1 },
      { q: "A sale toy costs $8. The same toy costs $7 elsewhere. Which costs less?", options: ["The $8 sale toy", "The $7 toy"], answer: 1 },
      { q: "A sale ends today, but you don't need the item. What keeps your savings safe?", options: ["Skip it", "Buy it because the sale ends"], answer: 0 },
      { q: "A $6 sticker set is on sale for $4. How much less does it cost?", options: ["$2", "$4", "$10"], answer: 0 },
      { q: "Two sale books cost $5 each. You only planned $5 for books. What fits your plan?", options: ["Buy both for $10", "Buy one for $5"], answer: 1 },
      { q: "A sale sign covers the price. What should you do before paying?", options: ["Assume it fits your budget", "Ask for the price and check the total"], answer: 1 },
    ],
  },
  {
    id: "wait", title: "Sleep on It", icon: "hourglass",
    questions: [
      { q: "You suddenly want a $12 toy. What helps you decide calmly?", options: ["Buy before thinking", "Wait a day and check your plan"], answer: 1 },
      { q: "You still want a book after a week and saved enough for it. What's a thoughtful next step?", options: ["Check your list and budget", "Buy two because you waited"], answer: 0 },
      { q: "You save $4 each week toward a $16 game. Starting at $0, how long will it take?", options: ["2 weeks", "4 weeks", "8 weeks"], answer: 1 },
      { q: "You put a toy on your wish list and later stop wanting it. What did waiting help you do?", options: ["Keep money for something you value more", "Lose the money you saved"], answer: 0 },
      { q: "Your friends buy a new game. You are unsure you want it. What can you do?", options: ["Buy it just to match them", "Take time to decide for yourself"], answer: 1 },
      { q: "You wait two weeks and save $3 each week. How much have you added?", options: ["$3", "$5", "$6"], answer: 2 },
    ],
  },
  {
    id: "unit_price", title: "Price per Piece", icon: "abacus",
    questions: [
      { q: "Four pencils cost $2. What is the cost of each pencil?", options: ["50 cents", "$2", "$8"], answer: 0 },
      { q: "Six identical pencils cost $3; four cost $4. Which has the lower price per pencil?", options: ["Four for $4", "Six for $3"], answer: 1 },
      { q: "You need two apples. A big bag will spoil before you eat it. What should you compare?", options: ["Only the bag's size", "Cost and how much you'll use"], answer: 1 },
      { q: "Two erasers cost $2. What is the price per eraser?", options: ["$1", "$2", "$4"], answer: 0 },
      { q: "Four identical rolls cost $4; two cost $4. Which has the lower price per roll?", options: ["Two for $4", "Four for $4"], answer: 1 },
      { q: "A box has four bars for $2. A single identical bar costs $1. If you will use all four, which costs less per bar?", options: ["The single bar", "The box"], answer: 1 },
    ],
  },
  {
    id: "giving", title: "A Little to Share", icon: "gift",
    questions: [
      { q: "You plan $2 of your $10 allowance for giving. How much is left for other plans?", options: ["$8", "$10", "$12"], answer: 0 },
      { q: "You want to help but have no money to give. What could you offer?", options: ["Promise money you don't have", "Time to help with a grown-up"], answer: 1 },
      { q: "Someone online asks for a donation and your code. What should you do first?", options: ["Send the code so they can help", "Ask a trusted grown-up to check"], answer: 1 },
      { q: "You give $1 each week for four weeks. How much have you given?", options: ["$3", "$4", "$5"], answer: 1 },
      { q: "Your friend chooses a different cause to help. What is a kind response?", options: ["Respect their choice", "Say only your cause matters"], answer: 0 },
      { q: "You want to share some toys. What should you check with your grown-up?", options: ["Only which toys are biggest", "That they are yours to give and in good condition"], answer: 1 },
    ],
  },
  {
    id: "ads", title: "Ad Detective", icon: "magnifier",
    questions: [
      { q: "An ad says a toy will make everyone like you. What is the ad trying to do?", options: ["Make you want to buy", "Promise real friendships"], answer: 0 },
      { q: "An ad says 'Only today!' What helps you decide?", options: ["Hurry so you don't miss out", "Pause and compare with your plan"], answer: 1 },
      { q: "A big picture makes a tiny toy look huge. What can you check with a grown-up?", options: ["The real size and details", "Only the bright picture"], answer: 0 },
      { q: "A video creator is paid to show a game. What should you remember?", options: ["Their video is helping sell it", "Being in a video makes it a need"], answer: 0 },
      { q: "An ad calls a toy 'free' but asks for $5 shipping. What is the total cost?", options: ["$0", "$5", "$10"], answer: 1 },
      { q: "A toy ad looks exciting. What helps you learn whether the toy suits you?", options: ["Count how often the ad appears", "Check details and reviews with a grown-up"], answer: 1 },
    ],
  },
  {
    id: "big_goal", title: "Small Steps, Big Goal", icon: "target",
    questions: [
      { q: "Your goal costs $30 and you have $10. How much more do you need?", options: ["$10", "$20", "$40"], answer: 1 },
      { q: "You need $20 more and save $5 a week. How many weeks will that take?", options: ["4", "5", "10"], answer: 0 },
      { q: "Your goal feels far away. What helps you keep going?", options: ["Track each small step", "Stop checking your savings"], answer: 0 },
      { q: "You saved $15 toward a $25 goal. How much is left?", options: ["$10", "$15", "$40"], answer: 0 },
      { q: "You planned to save $5 but can save only $2 this week. What can you do?", options: ["Give up the whole goal", "Save $2 and adjust the timeline"], answer: 1 },
      { q: "You reach your savings goal. What helps before buying?", options: ["Check the current total price with a grown-up", "Spend extra just because you saved"], answer: 0 },
    ],
  },
  {
    id: "tax_tips", title: "More than the Price Tag", icon: "basket",
    questions: [
      { q: "A notebook is $5 and sales tax adds 40 cents. What is the total?", options: ["$4.60", "$5", "$5.40"], answer: 2 },
      { q: "Lunch costs $10 including tax. You plan a $2 tip with your grown-up. Total?", options: ["$10", "$12", "$8"], answer: 1 },
      { q: "You have exactly the price on a toy's tag. What should you check before buying?", options: ["Whether tax adds to the total", "Whether the tag is colorful"], answer: 0 },
      { q: "A book costs $8 plus $1 tax. You pay with $10. How much change?", options: ["$1", "$2", "$9"], answer: 0 },
      { q: "Your receipt lists a $4 snack and $1 drink, with no extra charges. Total?", options: ["$3", "$5", "$6"], answer: 1 },
      { q: "A restaurant bill is $15 including tax. You and your grown-up add a $3 tip. Total?", options: ["$12", "$15", "$18"], answer: 2 },
    ],
  },
  {
    id: "borrowing", title: "Borrow with Care", icon: "heart",
    questions: [
      { q: "A friend lends you a book until Friday. What is a fair plan?", options: ["Keep it until they ask", "Care for it and return it Friday"], answer: 1 },
      { q: "You can't return a borrowed game on time. What should you do?", options: ["Tell your friend and agree on a new day", "Wait quietly until they forget"], answer: 0 },
      { q: "A friend asks to borrow your saved money. You feel unsure. What can you do?", options: ["Say yes so they won't be upset", "Say no and talk to your grown-up"], answer: 1 },
      { q: "You spill juice on a borrowed book. What is fair?", options: ["Return it without saying anything", "Tell the owner and ask your grown-up how to help"], answer: 1 },
      { q: "You want to lend a friend's toy to someone else. What should you do first?", options: ["Ask the toy's owner", "Decide for the owner"], answer: 0 },
      { q: "You can borrow a puzzle for free instead of buying it for $6. How much can stay saved?", options: ["$3", "$6", "$12"], answer: 1 },
    ],
  },
  {
    id: "money_safe", title: "Keep It Safe", icon: "lock",
    questions: [
      { q: "You find a wallet at school. Who can help return it safely?", options: ["A trusted teacher", "Someone in an online chat"], answer: 0 },
      { q: "A message asks for your kid sign-in code. What should you do?", options: ["Send it if they seem friendly", "Keep it private and tell your grown-up"], answer: 1 },
      { q: "You're taking $5 to a school fair. What helps you keep track of it?", options: ["A secure pocket and a plan", "Leave it loose on a table"], answer: 0 },
      { q: "Someone asks you to post a photo of your money and home address. What is safest?", options: ["Keep them private and tell your grown-up", "Post them if the person seems kind"], answer: 0 },
      { q: "You think you lost your spending money. What is a helpful first step?", options: ["Hide it from everyone", "Tell your grown-up and retrace your steps"], answer: 1 },
      { q: "You keep cash in a jar. Where should it go?", options: ["On a public bench", "In a safe place agreed with your grown-up"], answer: 1 },
    ],
  },
  {
    id: "fair_swaps", title: "A Fair Swap", icon: "swap",
    questions: [
      { q: "Your friend offers a postcard swap. What makes it fair?", options: ["Both understand and freely agree", "One friend decides for both"], answer: 0 },
      { q: "A postcard is special to you. Your friend wants it. What can you say?", options: ["I have to swap if you want it", "I'd like to keep this one"], answer: 1 },
      { q: "Before a swap, you notice a card has a torn corner. What should happen?", options: ["Hide it until after the swap", "Point it out before anyone agrees"], answer: 1 },
      { q: "A friend changes their mind before a swap. What is fair?", options: ["Let them say no", "Insist because you already chose"], answer: 0 },
      { q: "Someone rushes you to swap a favorite toy. What can you do?", options: ["Agree before they leave", "Pause and ask your grown-up"], answer: 1 },
      { q: "Two cards look alike, but one is damaged. What helps both people decide?", options: ["Compare their condition openly", "Show only the nicer side"], answer: 0 },
    ],
  },
  {
    id: "coins_bills", title: "Coins and Bills", icon: "coin",
    questions: [
      { q: "You have two $1 bills and one $5 bill. How much money?", options: ["$3", "$7", "$8"], answer: 1 },
      { q: "How many quarters make $1?", options: ["2", "4", "5"], answer: 1 },
      { q: "You have two quarters. How much is that?", options: ["25 cents", "50 cents", "$2"], answer: 1 },
      { q: "Which has the same value as one $5 bill?", options: ["Five $1 bills", "Two $1 bills", "Ten $1 bills"], answer: 0 },
      { q: "You have $3 and find another $1 in your own wallet. Total?", options: ["$2", "$3", "$4"], answer: 2 },
      { q: "A larger coin is not always worth more. What helps you count?", options: ["Use only its size", "Check each coin's value"], answer: 1 },
    ],
  },
  {
    id: "making_change", title: "Change Check", icon: "abacus",
    questions: [
      { q: "A book costs $6 total. You pay $10. What change should you get?", options: ["$4", "$6", "$16"], answer: 0 },
      { q: "A snack costs $2 total. You pay $5. Your change is…", options: ["$2", "$3", "$7"], answer: 1 },
      { q: "A pencil costs 50 cents total. You pay $1. Your change is…", options: ["25 cents", "50 cents", "$1"], answer: 1 },
      { q: "Your change seems too small. What can you do?", options: ["Walk away without checking", "Politely check the receipt with a grown-up"], answer: 1 },
      { q: "You pay $10 for a $7 total. You get $2 back. What should you check?", options: ["Whether another $1 is owed", "Whether you should give back the $2"], answer: 0 },
      { q: "An item costs $4 total and you pay exactly $4. Your change is…", options: ["$0", "$4", "$8"], answer: 0 },
    ],
  },
  {
    id: "allowance_plan", title: "Plan Your Allowance", icon: "wallet",
    questions: [
      { q: "You get $10 and plan $3 to save. How much is left?", options: ["$3", "$7", "$13"], answer: 1 },
      { q: "Your allowance arrives weekly. What helps it last the week?", options: ["Plan before spending", "Spend it all on the first day"], answer: 0 },
      { q: "You plan $4 to save, $5 to spend and $1 to give. How much allowance does that use?", options: ["$9", "$10", "$11"], answer: 1 },
      { q: "You want a $12 book and save $3 from each allowance. How many weeks from $0?", options: ["3", "4", "6"], answer: 1 },
      { q: "Your allowance changes. What should you do with your plan?", options: ["Keep every amount even if it no longer fits", "Update it with your grown-up"], answer: 1 },
      { q: "You spent your fun money early. What helps next week?", options: ["Look back and plan smaller amounts per day", "Ignore where it went"], answer: 0 },
    ],
  },
  {
    id: "seasonal_needs", title: "Seasons and Needs", icon: "shirt",
    questions: [
      { q: "Your winter coat is too small and cold weather is coming. A warm coat is a…", options: ["Need", "Want"], answer: 0 },
      { q: "You already have warm gloves that fit. A second sparkly pair is usually a…", options: ["Need", "Want"], answer: 1 },
      { q: "Rainy days are coming. What is smart before buying new rain boots?", options: ["Buy a pair in every color", "Check whether your old pair still fits"], answer: 1 },
      { q: "Summer camp asks for a water bottle. You have a sturdy one. What helps your budget?", options: ["Use the bottle you have", "Buy a new one because camp is new"], answer: 0 },
      { q: "You set aside $2 each week for three weeks for needed school supplies. Total saved?", options: ["$5", "$6", "$8"], answer: 1 },
      { q: "Your family needs different things in different seasons. What helps you prepare?", options: ["Wait until every item runs out", "Make a list with your grown-up ahead of time"], answer: 1 },
    ],
  },
  {
    id: "whole_price", title: "The Whole Price", icon: "magnifier",
    questions: [
      { q: "A toy is $8 plus $3 shipping. Another shop offers it for $10 with free pickup nearby. Which total is lower?", options: ["$8 plus shipping", "$10 with pickup"], answer: 1 },
      { q: "A book is $6 plus $2 shipping. Total?", options: ["$4", "$6", "$8"], answer: 2 },
      { q: "A shop saves you $2, but the bus ride costs $4 extra. Does that trip save money?", options: ["Yes, it saves $2", "No, the extra ride costs more than the saving"], answer: 1 },
      { q: "You compare stores. Which costs belong in the comparison?", options: ["Item, shipping and extra travel costs", "Only the number on the tag"], answer: 0 },
      { q: "Two shops charge $9 total for the same puzzle. One needs a long extra trip. What else matters?", options: ["Your time and travel", "Only which sign is brighter"], answer: 0 },
      { q: "One shop charges $7 plus $1 shipping; another charges $6 plus $3 shipping. Which total is lower?", options: ["$7 plus $1", "$6 plus $3"], answer: 0 },
    ],
  },
  {
    id: "subscriptions", title: "Subscription Checkup", icon: "hourglass",
    questions: [
      { q: "A drawing club costs $3 each month. What does that mean?", options: ["Pay $3 only once", "Pay $3 every month while subscribed"], answer: 1 },
      { q: "A subscription is $2 each month. What do three months cost?", options: ["$2", "$5", "$6"], answer: 2 },
      { q: "You stopped using a paid club. What should you do?", options: ["Ask your grown-up to check how to cancel", "Assume payments stopped by themselves"], answer: 0 },
      { q: "A free trial becomes paid next month. What helps before joining?", options: ["Ignore next month's price", "Check the price and end date with your grown-up"], answer: 1 },
      { q: "Two clubs cost $4 and $3 each month. Monthly total?", options: ["$1", "$7", "$12"], answer: 1 },
      { q: "A subscription renews tomorrow. What is useful to check?", options: ["Whether you still use it and it fits the plan", "Only whether the app icon is cute"], answer: 0 },
    ],
  },
  {
    id: "opportunity_cost", title: "Choose One Thing", icon: "swap",
    questions: [
      { q: "You have $5. A book and a ball each cost $5. If you buy the book, what must wait?", options: ["The ball", "Nothing; you can buy both"], answer: 0 },
      { q: "Choosing one thing can mean giving up another. What helps you choose?", options: ["Buy whatever you see first", "Compare what matters most to you"], answer: 1 },
      { q: "You save your $4 instead of buying stickers. What did you choose?", options: ["Money toward a future goal", "Both the stickers and the saved $4"], answer: 0 },
      { q: "You have $10. A kite costs $7. How much stays for another choice?", options: ["$3", "$7", "$17"], answer: 0 },
      { q: "Two friends choose different treats with their money. Can both choices fit their plans?", options: ["No, everyone must choose alike", "Yes, people value different things"], answer: 1 },
      { q: "You buy a $6 toy from your $12 goal savings. How does that affect your goal?", options: ["You still have all $12 saved", "You have $6 left and may need more time"], answer: 1 },
    ],
  },
  {
    id: "group_gift", title: "A Gift Together", icon: "gift",
    questions: [
      { q: "Three friends each put in $4 for a gift. How much is collected?", options: ["$7", "$12", "$16"], answer: 1 },
      { q: "A group gift costs $12 total. Four friends share equally. Each gives…", options: ["$3", "$4", "$8"], answer: 0 },
      { q: "Before collecting money, what should the group agree on?", options: ["The gift, total budget and each person's share", "Only who gets to hold the bag"], answer: 0 },
      { q: "A friend cannot afford the planned share. What is kind?", options: ["Leave them out right away", "Find a smaller gift or another way they can help"], answer: 1 },
      { q: "The group collected $15 and spent $12. What should happen to the $3 left?", options: ["Whoever holds it keeps it quietly", "Tell everyone and agree what to do"], answer: 1 },
      { q: "Who can help a group keep gift money safe and track contributions?", options: ["A trusted grown-up", "Someone who messages strangers online"], answer: 0 },
    ],
  },
  {
    id: "bank_basics", title: "Meet Your Bank", icon: "lock",
    questions: [
      { q: "Which account is usually used for everyday payments?", options: ["Checking", "Savings"], answer: 0 },
      { q: "Which account is usually used to set money aside for later?", options: ["Checking", "Savings"], answer: 1 },
      { q: "You deposit $5 into an account holding $10. New balance?", options: ["$5", "$15", "$50"], answer: 1 },
      { q: "How does a bank help keep money safe?", options: ["It uses secure records and protects access", "It lets friends use your sign-in code to help"], answer: 0 },
      { q: "Who should help you open and understand a bank account?", options: ["A friend who has never opened one", "Your trusted grown-up"], answer: 1 },
      { q: "A bank statement shows money in and out. Why check it together?", options: ["To see the balance and spot mistakes", "To avoid ever tracking money you take out"], answer: 0 },
    ],
  },
  {
    id: "interest", title: "Savings Can Grow", icon: "sprout",
    questions: [
      { q: "Some savings accounts pay interest. What is it?", options: ["Extra money the bank pays on savings", "Money you deposited yourself"], answer: 0 },
      { q: "You have $20 saved and the bank adds $1 interest. New total?", options: ["$19", "$20", "$21"], answer: 2 },
      { q: "An account pays $2 interest over a year. You start with $30 and add or take out nothing. Ending balance?", options: ["$28", "$32", "$60"], answer: 1 },
      { q: "Do all savings accounts pay the same interest?", options: ["Yes, always", "No, check the account details with a grown-up"], answer: 1 },
      { q: "What helps you learn when interest is added?", options: ["Read the account terms with your grown-up", "Assume every account adds it at the same time"], answer: 0 },
      { q: "You have $10, add $5, and earn $1 interest. How much is saved now?", options: ["$14", "$15", "$16"], answer: 2 },
    ],
  },
  {
    id: "party_budget", title: "Party on a Plan", icon: "balloon",
    questions: [
      { q: "Your party budget is $20. Snacks cost $8 and decorations $5. How much is left?", options: ["$7", "$13", "$15"], answer: 0 },
      { q: "Your party plan costs $25 but you have $20. What helps?", options: ["Buy everything and ignore the difference", "Find $5 of costs to trim"], answer: 1 },
      { q: "Reusable decorations are already at home. What can using them do?", options: ["Leave more money for other party needs", "Let you skip counting snack costs"], answer: 0 },
      { q: "Four guests each need a $2 snack pack. Snack total?", options: ["$6", "$8", "$10"], answer: 1 },
      { q: "You spent $18 of a $20 party budget. How much remains?", options: ["$2", "$18", "$38"], answer: 0 },
      { q: "Before shopping for the party, what should you check?", options: ["Buy decorations first and count guests later", "Guest count, supplies at home and total budget"], answer: 1 },
    ],
  },
  {
    id: "sell_toys", title: "Toys Find a New Home", icon: "basket",
    questions: [
      { q: "You want to sell a toy. What comes first?", options: ["Ask your grown-up and check it is yours to sell", "Set a sale date before checking permission"], answer: 0 },
      { q: "A toy has a missing wheel. What should the buyer hear?", options: ["Only how shiny it is", "That the wheel is missing"], answer: 1 },
      { q: "You sell two books for $3 each. How much money comes in?", options: ["$3", "$6", "$9"], answer: 1 },
      { q: "What helps you choose a fair price for a used toy?", options: ["Its condition and prices of similar used toys", "Only what you wish you could earn"], answer: 0 },
      { q: "Someone you do not know wants to meet to buy a toy. What should you do?", options: ["Go alone to finish quickly", "Let your grown-up arrange and handle it"], answer: 1 },
      { q: "A buyer offers less than your price. What can you do?", options: ["Politely agree or say no with your grown-up", "You must accept any offer"], answer: 0 },
    ],
  },
  {
    id: "charity_choice", title: "Choose a Cause", icon: "heart",
    questions: [
      { q: "You love animals and want to help. What is a useful first step?", options: ["Send money to the first message you see", "Find a group with your grown-up and learn what it does"], answer: 1 },
      { q: "Before giving money online, who can help check the charity?", options: ["A trusted grown-up", "Only the person asking for money"], answer: 0 },
      { q: "You have $8 and choose to give $2. How much remains?", options: ["$6", "$8", "$10"], answer: 0 },
      { q: "Two causes matter to you, but your giving budget is small. What can you do?", options: ["Promise both more money than you have", "Choose an amount that fits and help in other ways"], answer: 1 },
      { q: "What question helps you learn about a charity?", options: ["How will my gift help?", "Will giving make me more popular?"], answer: 0 },
      { q: "A cause needs volunteers, and you have time to help. What is a good plan?", options: ["Arrange a safe activity with your grown-up", "Meet an unknown organizer alone"], answer: 0 },
    ],
  },
  {
    id: "quality", title: "Built to Last", icon: "target",
    questions: [
      { q: "A $3 toy breaks after one use. A sturdy $6 toy lasts many uses. What should you compare?", options: ["Only which price is smaller", "Price and how long each is likely to last"], answer: 1 },
      { q: "You buy a $2 bottle twice because the first breaks. Total spent?", options: ["$2", "$4", "$6"], answer: 1 },
      { q: "Does a higher price always mean better quality?", options: ["Yes, every time", "No, check how well the item is made"], answer: 1 },
      { q: "You need a backpack for school. What detail helps you judge quality?", options: ["Strong seams and a working zipper", "A picture you like on the front"], answer: 0 },
      { q: "A $5 item works as well and lasts as long as a $9 item. Which saves money?", options: ["The $5 item", "The $9 item"], answer: 0 },
      { q: "A toy stops working. What could you check with a grown-up before replacing it?", options: ["Whether it can be safely repaired", "Whether your friends bought newer toys"], answer: 0 },
    ],
  },
  {
    id: "rainy_day", title: "Rainy-Day Savings", icon: "piggy",
    questions: [
      { q: "What is a rainy-day fund for?", options: ["An unexpected need", "Every new toy you see"], answer: 0 },
      { q: "You save $2 each week for surprises. After five weeks, how much is there?", options: ["$5", "$7", "$10"], answer: 2 },
      { q: "Your school water bottle breaks unexpectedly. Which fits a rainy-day fund's purpose?", options: ["Replace the needed bottle with your grown-up's help", "Buy new stickers first"], answer: 0 },
      { q: "You use $4 from a $10 rainy-day fund. How much remains?", options: ["$4", "$6", "$14"], answer: 1 },
      { q: "After using some rainy-day savings, what is a useful next step?", options: ["Spend the rest on wants before replacing savings", "Build it back a little at a time"], answer: 1 },
      { q: "You want new stickers, but your rainy-day money is for unexpected needs. What fits that plan?", options: ["Use your planned fun money or wait", "Use rainy-day money because the stickers are on sale"], answer: 0 },
    ],
  },
];

// Wardrobe slots for the bear (art in client/public/bear/w3/items).
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
