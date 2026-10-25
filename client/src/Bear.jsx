// The bear companion, built from the illustrated assets in /public/bear.
// The front pose is the "dress-up doll": each accessory is its own image,
// positioned in percent of the bear so it scales with any size. The other
// poses (back, side, three-quarter) are used for travel and reveal moments.

const POSES = {
  front: { src: "/bear/poses/bear_front.png", w: 362, h: 379 },
  back: { src: "/bear/poses/bear_back.png", w: 356, h: 384 },
  side: { src: "/bear/poses/bear_side.png", w: 359, h: 388 },
  threeQuarter: { src: "/bear/poses/bear_three_quarter.png", w: 340, h: 391 },
};

// x/y = centre of the item, w = width; all in % of the front pose.
// z orders the layers: outfit < neck < held < eyes < hat < friend; below 0
// sits behind the bear (the umbrella, so the paw is drawn over its stem).
export const ITEMS = {
  // hats
  knit_beanie: { slot: "hat", x: 50, y: -3, w: 70, z: 5 },
  ranger_hat: { slot: "hat", x: 50, y: 0, w: 86, z: 5 },
  flower_sunhat: { slot: "hat", x: 50, y: 2, w: 100, z: 5 },
  flower_crown: { slot: "hat", x: 50, y: 4, w: 64, z: 5 },
  sleeping_cap: { slot: "hat", x: 55, y: -1, w: 82, z: 5 },
  yellow_bow: { slot: "hat", x: 76, y: 6, w: 36, z: 5, rot: 14 },
  // eyes
  round_glasses: { slot: "eyes", x: 50, y: 29.5, w: 56, z: 4 },
  heart_glasses: { slot: "eyes", x: 50, y: 29.5, w: 58, z: 4 },
  // neck
  red_bow_tie: { slot: "neck", x: 50, y: 50, w: 32, z: 3 },
  red_scarf: { slot: "neck", x: 50, y: 61, w: 72, z: 3 },
  camera: { slot: "neck", x: 50, y: 61, w: 66, z: 3 },
  // outfits
  striped_shirt: { slot: "outfit", x: 50, y: 70, w: 88, z: 1 },
  green_hoodie: { slot: "outfit", x: 50, y: 69, w: 96, z: 1 },
  // held items (bear's left paw, our right)
  adventure_map: { slot: "held", x: 82, y: 70, w: 50, z: 3, rot: -8 },
  magnifying_glass: { slot: "held", x: 94, y: 60, w: 36, z: 3, rot: 12 },
  green_book: { slot: "held", x: 90, y: 74, w: 38, z: 3, rot: 6 },
  honey_jar: { slot: "held", x: 92, y: 76, w: 32, z: 3 },
  picnic_basket: { slot: "held", x: 96, y: 80, w: 44, z: 3 },
  leaf_umbrella: { slot: "held", x: 100, y: 46, w: 66, z: -1 },
  // little friends that float by the shoulder (the side away from held items)
  bee_friend: { slot: "friend", x: -4, y: 40, w: 44, z: 7, float: true, flip: true },
  butterfly_friend: { slot: "friend", x: -2, y: 38, w: 42, z: 7, float: true, flip: true },
};

// The other poses reuse the same art, so each one says where an item sits
// from that angle, in % of that pose's own box (any of x/y/w/z/rot/flip
// replaces the front value). An item left out is hidden in that pose: glasses
// and bow ties are on the face, and a shirt would paint over the backpack.
// Side is not drawn through BearFigure today (the map walker is a plain image)
// but is kept tuned so it can be.
const POSE_ITEMS = {
  threeQuarter: {
    knit_beanie: { x: 48, y: 2, w: 66, rot: 10 },
    ranger_hat: { x: 48, y: -1, w: 84, rot: 8 },
    flower_sunhat: { x: 48, y: 2, w: 98, rot: 8 },
    flower_crown: { x: 48, y: 6, w: 64, rot: 10 },
    sleeping_cap: { x: 52, y: -2, w: 80, rot: 10 },
    yellow_bow: { x: 80, y: 14, w: 34, rot: 30 },
    red_bow_tie: { x: 22, y: 50, w: 26, rot: -8 },
    red_scarf: { x: 34, y: 58, w: 54, rot: -4 },
    camera: { x: 28, y: 62, w: 50, rot: -6 },
    adventure_map: { x: 12, y: 66, w: 44, rot: -10 },
    magnifying_glass: { x: 0, y: 50, w: 30 },
    green_book: { x: 10, y: 68, w: 32, rot: -6 },
    honey_jar: { x: 10, y: 70, w: 28 },
    picnic_basket: { x: 8, y: 74, w: 38 },
    leaf_umbrella: { x: 88, y: 28, w: 56, rot: 25 },
    bee_friend: { x: 88, y: 34, flip: false },
    butterfly_friend: { x: 88, y: 32, flip: false },
  },
  side: {
    knit_beanie: { x: 52, y: 1, w: 70, rot: 6 },
    ranger_hat: { x: 52, y: -1, w: 86, rot: 4 },
    flower_sunhat: { x: 52, y: 2, w: 100, rot: 4 },
    flower_crown: { x: 52, y: 6, w: 66, rot: 6 },
    sleeping_cap: { x: 58, y: -2, w: 82, rot: 6 },
    yellow_bow: { x: 60, y: 3, w: 34, rot: 20 },
    red_bow_tie: { x: 26, y: 51, w: 26 },
    red_scarf: { x: 40, y: 59, w: 54 },
    camera: { x: 34, y: 63, w: 50 },
    adventure_map: { x: 42, y: 70, w: 44, rot: -6 },
    magnifying_glass: { x: 46, y: 60, w: 30, rot: 10 },
    green_book: { x: 44, y: 72, w: 32 },
    honey_jar: { x: 44, y: 74, w: 28 },
    picnic_basket: { x: 44, y: 78, w: 38 },
    leaf_umbrella: { x: 94, y: 28, w: 60, rot: 25 },
    bee_friend: { x: 100, y: 38, flip: false },
    butterfly_friend: { x: 100, y: 36, flip: false },
  },
  back: {
    knit_beanie: { x: 51, y: -2, w: 70 },
    ranger_hat: { x: 51, y: 0, w: 86 },
    flower_sunhat: { x: 51, y: 2, w: 100, flip: true },
    flower_crown: { x: 51, y: 4, w: 64 },
    sleeping_cap: { x: 46, y: -1, w: 82, flip: true },
    yellow_bow: { x: 27, y: 7, w: 36, rot: -14, flip: true },
    adventure_map: { x: 4, y: 70, w: 44, z: -1, flip: true },
    magnifying_glass: { x: 6, y: 60, w: 34, z: -1, rot: -12, flip: true },
    green_book: { x: 8, y: 72, w: 36, z: -1, flip: true },
    honey_jar: { x: 6, y: 74, w: 30, z: -1, flip: true },
    picnic_basket: { x: 4, y: 78, w: 42, z: -1, flip: true },
    leaf_umbrella: { x: 10, y: 32, w: 52, rot: -18, flip: true },
    bee_friend: { x: 94, y: 36, flip: false },
    butterfly_friend: { x: 94, y: 34, flip: false },
  },
};

function placeItem(id, pose) {
  const item = ITEMS[id];
  if (!item || pose === "front") return item;
  const at = POSE_ITEMS[pose]?.[id];
  return at ? { ...item, ...at } : null;
}

const SLOTS = ["outfit", "neck", "held", "eyes", "hat", "friend"];

function Layer({ id, item }) {
  const style = {
    left: `${item.x}%`,
    top: `${item.y}%`,
    width: `${item.w}%`,
    zIndex: item.z,
    transform: `translate(-50%, -50%) rotate(${item.rot || 0}deg) scaleX(${item.flip ? -1 : 1})`,
  };
  return <img className={`bear-item slot-${item.slot} ${item.float ? "floaty" : ""}`} src={`/bear/items/${id}.png`} alt="" style={style} draggable="false" />;
}

/**
 * pose: front | back | side | threeQuarter
 * mood (front only): idle | happy | eating | celebrate | resting — adds a prop
 * or effect without replacing anything the child chose.
 */
export function BearFigure({ bear, pose = "front", mood = "idle", size = 200, flip = false, className = "" }) {
  if (mood === "thinking") pose = "threeQuarter";
  const p = POSES[pose] || POSES.front;
  const worn = { ...pickWorn(bear) };
  if (pose === "front") {
    if (mood === "happy" && !worn.held) worn.held = "adventure_map";
    if (mood === "eating" && !worn.held) worn.held = "honey_jar";
    if (mood === "resting" && !worn.hat) worn.hat = "sleeping_cap";
  }
  const label = pose === "back" ? "walking away on an adventure" : pose === "side" ? "walking" : {
    thinking: "thinking", idle: "saying hi", happy: "feeling happy", eating: "having a honey snack", celebrate: "celebrating", resting: "taking a nap",
  }[mood] || "saying hi";
  return (
    <div className={`bear pose-${pose} mood-${mood} ${className}`} style={{ width: size, aspectRatio: `${p.w} / ${p.h}` }} role="img" aria-label={`${bear.name} the bear, ${label}`}>
      <div className="bear-body" style={{ transform: flip ? "scaleX(-1)" : undefined }}>
        <img className="bear-base" src={p.src} alt="" draggable="false" />
        {SLOTS.map((slot) => {
          const id = worn[slot];
          const item = id && placeItem(id, pose);
          return item ? <Layer key={slot} id={id} item={item} /> : null;
        })}
      </div>
      {mood === "thinking" && <div className="thought-dots" aria-hidden="true"><i /><i /><i /></div>}
      {pose === "front" && mood === "celebrate" && (
        <div className="sparkles" aria-hidden="true"><i /><i /><i /></div>
      )}
      {pose === "front" && mood === "resting" && (
        <div className="zzz" aria-hidden="true"><span>z</span><span>z</span><span>Z</span></div>
      )}
    </div>
  );
}

function pickWorn(bear) {
  const out = {};
  for (const s of SLOTS) out[s] = bear?.[s] || null;
  return out;
}

// Shared SVG filter for the hand-drawn wobble on scenes and the adventure map.
export function SketchDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <filter id="mq-wobble">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="7" result="w" />
          <feDisplacementMap in="SourceGraphic" in2="w" scale="4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

// ------------------------------------------------------------------ home scenes
const SCENES = {
  forest: (
    <>
      <rect x="-20" y="-20" width="440" height="340" fill="#F3E9D2" />
      <circle cx="318" cy="66" r="26" fill="#E4AD58" opacity=".85" />
      <path d="M-20 196 Q90 150 190 182 T420 170 V320 H-20 Z" fill="#C5CFA8" />
      {[[40, 190, 1.1], [78, 176, 0.8], [322, 174, 1], [360, 186, 1.2], [290, 190, 0.7]].map(([x, y, s], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
          <path d="M0 -70 L-24 -16 L-12 -16 L-30 18 L30 18 L12 -16 L24 -16 Z" fill="#8FA67A" stroke="#514738" strokeWidth="2.5" strokeLinejoin="round" />
          <rect x="-4" y="18" width="8" height="12" fill="#9C6A40" />
        </g>
      ))}
      <path d="M-20 236 Q140 212 260 236 T420 230 V320 H-20 Z" fill="#A8B894" />
    </>
  ),
  meadow: (
    <>
      <rect x="-20" y="-20" width="440" height="340" fill="#E5EEF0" />
      <path d="M-20 150 L70 90 L120 130 L180 70 L260 140 L320 100 L420 150 Z" fill="#B8C7CF" stroke="#514738" strokeWidth="2" opacity=".7" />
      <path d="M-20 200 Q120 170 240 196 T420 190 V320 H-20 Z" fill="#C5CFA8" />
      <path d="M-20 240 Q160 220 420 244 V320 H-20 Z" fill="#A8B894" />
      {[[40, 250], [90, 268], [300, 258], [350, 272], [250, 280], [140, 284]].map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          {[0, 90, 180, 270].map((a) => <circle key={a} cx="0" cy="-4" r="3.5" transform={`rotate(${a})`} fill={i % 2 ? "#F7F0DF" : "#F4C6C0"} />)}
          <circle r="2.2" fill="#E4AD58" />
        </g>
      ))}
    </>
  ),
  stars: (
    <>
      <rect x="-20" y="-20" width="440" height="340" fill="#4E5F7A" />
      {[[40, 40], [110, 70], [190, 30], [270, 56], [350, 34], [70, 120], [320, 110], [230, 96]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y - 5} l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5 Z`} fill="#E4AD58" />
      ))}
      <circle cx="320" cy="64" r="18" fill="#F7F0DF" />
      <path d="M-20 210 Q200 180 420 210 V320 H-20 Z" fill="#5F7A4D" />
      <path d="M296 230 L336 170 L376 230 Z" fill="#D98D81" stroke="#514738" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M336 170 L336 230" stroke="#514738" strokeWidth="2" />
    </>
  ),
};

export function SceneBackdrop({ scene }) {
  return (
    <>
      <svg className="scene-backdrop" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g filter="url(#mq-wobble)">{SCENES[scene] || SCENES.forest}</g>
      </svg>
      {(scene === "forest" || scene === "meadow" || !SCENES[scene]) && <img className="scene-mushroom" src="/bear/items/mushroom.png" alt="" aria-hidden="true" />}
    </>
  );
}

export function bearScale(savingsCents, targetCents) {
  // 0.72 at $0 → 1.0 at the goal, a touch more beyond it.
  const p = Math.max(0, savingsCents) / Math.max(1, targetCents);
  return Math.min(1.08, 0.72 + 0.28 * Math.min(1, p) + 0.08 * Math.max(0, Math.min(1, p - 1)));
}
