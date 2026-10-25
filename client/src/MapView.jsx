// Illustrated adventure map of the U.S. Pins are the bear's 15 destinations.
import { ICON_PATHS } from "./Icons.jsx";

const W = 960, H = 600;
const project = (lon, lat) => [40 + (lon + 125) * 15.2, 30 + (49.5 - lat) * 19];

// Coarse hand-traced outline of the contiguous U.S. (lon, lat).
const OUTLINE = [
  [-124.7, 48.4], [-123, 49], [-95.2, 49], [-94.8, 49.4], [-89.6, 48], [-84.5, 46.5], [-82.5, 45.3], [-82.4, 43], [-79, 43.4],
  [-76.5, 44.2], [-75, 45], [-71.5, 45], [-70, 46.7], [-67.8, 47.1], [-67, 44.8], [-70.2, 43.7], [-70.6, 41.7], [-74, 40.6],
  [-75.5, 39.5], [-76, 38], [-75.5, 35.5], [-77.9, 33.9], [-80.9, 32], [-81.4, 30.3], [-80, 26.8], [-80.4, 25.2], [-81.8, 26.1],
  [-82.8, 27.9], [-83.7, 29.9], [-85.3, 29.7], [-87.6, 30.3], [-89.6, 30.2], [-89.4, 29], [-91.3, 29.3], [-93.8, 29.7], [-95, 29.3],
  [-97.2, 27.6], [-97.4, 25.9], [-99.5, 27.5], [-101.4, 29.8], [-103.1, 29], [-104.7, 29.9], [-106.5, 31.8], [-108.2, 31.8],
  [-111.1, 31.3], [-114.8, 32.5], [-117.1, 32.5], [-118.5, 34], [-120.6, 34.6], [-121.9, 36.6], [-122.5, 37.8], [-123.8, 39.8],
  [-124.2, 41.9], [-124.1, 43.6], [-124, 46.2], [-124.7, 48.4],
];
const OUTLINE_D = OUTLINE.map(([lon, lat], i) => `${i ? "L" : "M"}${project(lon, lat).map((n) => n.toFixed(1)).join(" ")}`).join(" ") + "Z";

const LAKES = [[-88, 47.6, 34, 9, -8], [-87, 43.8, 8, 26, 4], [-82.6, 44.8, 14, 16, 0], [-81.2, 42.2, 22, 6, -18], [-77.8, 43.6, 18, 6, -8]];
const MOUNTAINS = [[-114, 45], [-111, 42], [-107.5, 39.5], [-105.5, 37], [-109, 46], [-116, 40], [-120, 41.5]];
const TREES = [[-121.5, 45], [-120, 47], [-122.5, 42], [-84.5, 37.5], [-81, 38.5], [-79, 40.5], [-72, 43.6], [-90, 46.5], [-93, 36]];

// Hand-placed nudges so neighbouring pins and labels don't collide.
const NUDGE = {
  seattle: [22, -4], olympic_national_park: [-14, 14], zion_national_park: [-8, -6], grand_canyon_national_park: [4, 8],
  yellowstone_national_park: [6, -8], grand_teton_national_park: [-8, 12],
};
const LABEL = {
  seattle: "right", olympic_national_park: "above", zion_national_park: "right", san_francisco: "below", yellowstone_national_park: "right",
  grand_teton_national_park: "left", yosemite_national_park: "above", glacier_national_park: "right", acadia_national_park: "left",
  new_york_city: "right", arches_national_park: "right",
};
const HAWAII_AT = [148, 520];

export function placeXY(id, p) {
  if (id === "hawaii_volcanoes_national_park") return HAWAII_AT;
  const [x, y] = project(p.lon, p.lat);
  const [dx, dy] = NUDGE[id] || [0, 0];
  return [x + dx, y + dy];
}

function trailD([x1, y1], [x2, y2]) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.min(120, Math.hypot(x2 - x1, y2 - y1) * 0.25);
  return { d: `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`, at: (t) => [
    (1 - t) ** 2 * x1 + 2 * (1 - t) * t * mx + t ** 2 * x2,
    (1 - t) ** 2 * y1 + 2 * (1 - t) * t * my + t ** 2 * y2,
  ] };
}

// The side-view bear faces left; mirror it when walking east.
function Walker({ facingRight }) {
  return (
    <g transform={facingRight ? "scale(-1 1)" : undefined}>
      <image href="/bear/poses/bear_side.png" x="-26" y="-56" width="52" height="56" />
    </g>
  );
}

export default function MapView({ places, home, owned, away, now, bear, selected, onSelect }) {
  const homeXY = project(home.lon, home.lat);
  const entries = Object.entries(places);
  let token = null, trail = null, facingRight = false;
  if (away) {
    const dest = placeXY(away.destId, places[away.destId]);
    trail = trailD(homeXY, dest);
    const p = Math.min(1, Math.max(0, (now - away.startedAt) / (away.returnsAt - away.startedAt)));
    const outbound = p < 0.5;
    token = trail.at(outbound ? p * 2 : 2 - p * 2);
    facingRight = outbound ? dest[0] > homeXY[0] : dest[0] < homeXY[0];
  }
  return (
    <svg className="adventure-map" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Adventure map">
      <g filter="url(#mq-wobble)" aria-hidden="true">
        <rect x="-20" y="-20" width={W + 40} height={H + 40} fill="#DCE8E6" />
        <path d={OUTLINE_D} fill="#EDE3C6" stroke="#514738" strokeWidth="3" strokeLinejoin="round" />
        {LAKES.map(([lon, lat, rx, ry, r], i) => {
          const [x, y] = project(lon, lat);
          return <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} transform={`rotate(${r} ${x} ${y})`} fill="#B9D3D2" stroke="#514738" strokeWidth="2" />;
        })}
        {MOUNTAINS.map(([lon, lat], i) => {
          const [x, y] = project(lon, lat);
          return <path key={i} d={`M${x - 18} ${y + 10} L${x - 4} ${y - 12} L${x + 4} ${y - 2} L${x + 10} ${y - 10} L${x + 22} ${y + 10}`} fill="#D3C7A4" stroke="#514738" strokeWidth="2" strokeLinejoin="round" />;
        })}
        {TREES.map(([lon, lat], i) => {
          const [x, y] = project(lon, lat);
          return <path key={i} d={`M${x} ${y - 14} L${x - 8} ${y + 4} L${x + 8} ${y + 4} Z`} fill="#A8B894" stroke="#514738" strokeWidth="1.8" strokeLinejoin="round" />;
        })}
        {/* Hawaiʻi inset */}
        <rect x="52" y="452" width="200" height="120" rx="10" fill="#D3E3E2" stroke="#514738" strokeWidth="2" strokeDasharray="6 6" />
        {[[90, 490, 8], [116, 500, 7], [136, 508, 6], [148, 522, 16]].map(([x, y, r], i) => (
          <ellipse key={i} cx={x} cy={y} rx={r} ry={r * 0.7} fill="#EDE3C6" stroke="#514738" strokeWidth="2" />
        ))}
        {/* compass */}
        <g transform="translate(880 520)">
          <circle r="32" fill="#F7F0DF" stroke="#514738" strokeWidth="2" />
          <path d="M0 -26 L7 0 L0 26 L-7 0 Z" fill="#D98D81" stroke="#514738" strokeWidth="1.5" />
          <text y="-36" textAnchor="middle" className="map-label">N</text>
        </g>
      </g>
      <defs><clipPath id="pin-clip"><circle r="15.5" /></clipPath></defs>
      <text x="66" y="472" className="map-label small">Hawaiʻi</text>

      {trail && <path d={trail.d} className="trail" />}
      <g transform={`translate(${homeXY[0]} ${homeXY[1]})`} className="home-pin" aria-label="Home cabin">
        <path d="M-16 4 L0 -12 L16 4 V18 H-16 Z" fill="#D98D81" stroke="#514738" strokeWidth="2.5" strokeLinejoin="round" />
        <rect x="-5" y="6" width="10" height="12" fill="#9C6A40" stroke="#514738" strokeWidth="2" />
        <text y="36" textAnchor="middle" className="map-label">Home</text>
      </g>

      {entries.map(([id, p]) => {
        if (p.hidden) {
          if (p.lon == null) return null;
          const [x, y] = HAWAII_AT;
          return (
            <g key={id} className="pin secret" transform={`translate(${x} ${y})`} onClick={() => onSelect(id)} role="button" tabIndex="0" aria-label="Undiscovered place" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(id); } }}>
              <circle className="pin-bg" r="20" />
              <text y="7" textAnchor="middle">?</text>
            </g>
          );
        }
        const [x, y] = placeXY(id, p);
        const visited = owned.has(id);
        const state = visited ? "visited" : p.open ? "open" : "locked";
        const side = LABEL[id] || "below";
        const lx = side === "right" ? 22 : side === "left" ? -22 : 0;
        const ly = side === "below" ? 34 : side === "above" ? -24 : 5;
        const anchor = side === "right" ? "start" : side === "left" ? "end" : "middle";
        return (
          <g key={id} className={`pin ${state} ${selected === id ? "selected" : ""} ${away?.destId === id ? "target" : ""}`} transform={`translate(${x} ${y})`}
            onClick={() => onSelect(id)} role="button" tabIndex="0" aria-label={`${p.name}: ${state === "visited" ? "visited" : state === "open" ? `${p.cost} points` : "locked"}`}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(id); } }}>
            <circle className="pin-bg" r="20" />
            {state === "locked" ? (
              <svg x="-11" y="-11" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">{ICON_PATHS.lock}</svg>
            ) : (
              <>
                <image href={p.image} x="-21" y="-17" width="42" height="35" clipPath="url(#pin-clip)" preserveAspectRatio="xMidYMid slice" />
                <circle className="pin-ring" r="15.5" />
              </>
            )}
            {visited && <g transform="translate(9 -24)"><circle r="8" className="tick-bg" /><path className="tick" d="M-4 0 l3 3 5 -6" /></g>}
            <text x={lx} y={ly} textAnchor={anchor} className="map-label">{p.name}</text>
          </g>
        );
      })}

      {token && (
        <g className="walker" transform={`translate(${token[0]} ${token[1] + 6})`}>
          <Walker facingRight={facingRight} />
        </g>
      )}
    </svg>
  );
}
