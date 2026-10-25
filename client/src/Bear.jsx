// The bear companion, built from the illustrated assets in /public/bear.
// The front pose is the "dress-up doll": each accessory is its own image,
// positioned in percent of the bear so it scales with any size. The other
// poses (back, side, three-quarter) are used for travel and reveal moments.

const POSES = {
  front: { src: "/bear/poses/bear_front.png", w: 428, h: 414 },
  back: { src: "/bear/poses/bear_back.png", w: 356, h: 384 },
  side: { src: "/bear/poses/bear_side.png", w: 359, h: 388 },
  threeQuarter: { src: "/bear/poses/bear_three_quarter.png", w: 340, h: 391 },
};

// All layers share the front canvas. Never offset, resize or rotate individual art.
export const ITEMS = {
  explorer_hat: { slot: "hat", x: 50, y: 50, w: 100, z: 5 },
  straw_hat: { slot: "hat", x: 50, y: 50, w: 100, z: 5 },
  beanie: { slot: "hat", x: 50, y: 50, w: 100, z: 5 },
  flower_crown: { slot: "hat", x: 50, y: 50, w: 100, z: 5 },
  baseball_cap: { slot: "hat", x: 50, y: 50, w: 100, z: 5 },
  sleep_cap: { slot: "hat", x: 50, y: 50, w: 100, z: 5 },
  round_glasses: { slot: "eyes", x: 50, y: 50, w: 100, z: 4 },
  sunglasses: { slot: "eyes", x: 50, y: 50, w: 100, z: 4 },
  red_scarf: { slot: "neck", x: 50, y: 50, w: 100, z: 3 },
  checkered_scarf: { slot: "neck", x: 50, y: 50, w: 100, z: 3 },
  bow_tie: { slot: "neck", x: 50, y: 50, w: 100, z: 3 },
  bandana: { slot: "neck", x: 50, y: 50, w: 100, z: 3 },
  explorer_jacket: { slot: "outfit", x: 50, y: 50, w: 100, z: 1 },
  raincoat: { slot: "outfit", x: 50, y: 50, w: 100, z: 1 },
  sweater: { slot: "outfit", x: 50, y: 50, w: 100, z: 1 },
  striped_shirt: { slot: "outfit", x: 50, y: 50, w: 100, z: 1 },
  overalls: { slot: "outfit", x: 50, y: 50, w: 100, z: 1 },
  cardigan: { slot: "outfit", x: 50, y: 50, w: 100, z: 1 },
  camera: { slot: "bag", x: 50, y: 50, w: 100, z: 2 },
  small_purse: { slot: "bag", x: 50, y: 50, w: 100, z: 2 },
  map: { slot: "held", x: 50, y: 50, w: 100, z: 0, fullBody: true },
  magnifying_glass: { slot: "held", x: 50, y: 50, w: 100, z: 0, fullBody: true },
  leaf: { slot: "held", x: 50, y: 50, w: 100, z: 0, fullBody: true },
  mug: { slot: "held", x: 50, y: 50, w: 100, z: 0, fullBody: true },
  butterfly_friend: { slot: "friend", x: 50, y: 50, w: 100, z: 7, float: true },
  bee_friend: { slot: "friend", x: 50, y: 50, w: 100, z: 7, float: true },
};

// Travel and reveal poses show the plain bear.
const POSE_ITEMS = {};

function placeItem(id, pose) {
  const item = ITEMS[id];
  if (!item || pose === "front") return item;
  const at = POSE_ITEMS[pose]?.[id];
  return at ? { ...item, ...at } : null;
}

const SLOTS = ["outfit", "bag", "neck", "held", "eyes", "hat", "friend"];

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
    if (mood === "happy" && !worn.held) worn.held = "map";
    if (mood === "eating" && !worn.held) worn.held = "mug";
    if (mood === "resting" && !worn.hat) worn.hat = "sleep_cap";
  }
  const fullBody = pose === "front" && ITEMS[worn.held]?.fullBody ? worn.held : null;
  const label = pose === "back" ? "walking away on an adventure" : pose === "side" ? "walking" : {
    thinking: "thinking", idle: "saying hi", happy: "feeling happy", eating: "having some cocoa", celebrate: "celebrating", resting: "taking a nap",
  }[mood] || "saying hi";
  return (
    <div className={`bear pose-${pose} mood-${mood} ${className}`} style={{ width: size, aspectRatio: `${p.w} / ${p.h}` }} role="img" aria-label={`${bear.name} the bear, ${label}`}>
      <div className="bear-body" style={{ transform: flip ? "scaleX(-1)" : undefined }}>
        <img className="bear-base" src={fullBody ? `/bear/items/${fullBody}.png` : p.src} alt="" draggable="false" />
        {SLOTS.map((slot) => {
          if (fullBody && ["held", "outfit", "neck", "bag"].includes(slot)) return null;
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
    </>
  );
}

export function bearScale(savingsCents, targetCents) {
  // 0.72 at $0 → 1.0 at the goal, a touch more beyond it.
  const p = Math.max(0, savingsCents) / Math.max(1, targetCents);
  return Math.min(1.08, 0.72 + 0.28 * Math.min(1, p) + 0.08 * Math.max(0, Math.min(1, p - 1)));
}
