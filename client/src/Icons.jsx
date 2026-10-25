// Hand-drawn style icon set for Bearly Spent (no emoji). 24×24, ink outline,
// soft palette fills. To swap in your own art for any icon, save a PNG as
// client/public/icons/ui/<name>.png and add the name to CUSTOM below.
const CUSTOM = new Set([]);

const INK = "#514738";
const C = { honey: "#E4AD58", sage: "#A8B894", rose: "#D98D81", sky: "#7296AB", teal: "#84B7B4", bear: "#B77E50", cream: "#F7F0DF" };
const s = { stroke: INK, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

// Illustrated assets from the bear pack, used where a picture reads better.
const ART = {
  magnifier: "/bear/w3/thumbs/magnifying_glass.png",
  map: "/bear/w3/thumbs/map.png",
  bear: "/bear/w3/poses/bear_front.png",
  bee: "/bear/w3/thumbs/bee_friend.png",
};

const PATHS = {
  book: <><path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1z" {...s} fill={C.cream} /><path d="M12 6v14" {...s} /></>,
  more: <>{[5, 12, 19].map((x) => <circle key={x} cx={x} cy="12" r="2" {...s} fill={C.honey} />)}</>,
  home: <><path d="M3.5 11.5 12 4l8.5 7.5" {...s} fill="none" /><path d="M6 10v9.5h12V10" {...s} fill={C.cream} /><path d="M10 19.5v-5h4v5" {...s} fill={C.rose} /></>,
  star: <path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" {...s} fill={C.honey} />,
  mapNav: <><path d="M3.5 6.5 9 4l6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5z" {...s} fill={C.cream} /><path d="M9 4v13.5M15 6.5V20" {...s} /></>,
  album: <><rect x="3.5" y="5" width="17" height="14" rx="2" {...s} fill={C.cream} /><path d="M3.5 9h17" {...s} /><rect x="14.5" y="11.5" width="4" height="5" {...s} fill={C.rose} /><path d="M6.5 13h5M6.5 16h4" {...s} /></>,
  chat: <><path d="M4 5.5h16v10H9l-4 3.5v-3.5H4z" {...s} fill={C.cream} /><circle cx="8.5" cy="10.5" r="1" fill={INK} /><circle cx="12" cy="10.5" r="1" fill={INK} /><circle cx="15.5" cy="10.5" r="1" fill={INK} /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" {...s} fill={C.honey} /><path d="M10 20.5a2 2 0 0 0 4 0" {...s} fill="none" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2.5" {...s} fill={C.honey} /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" {...s} fill="none" /><circle cx="12" cy="15.3" r="1.4" fill={INK} /></>,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...s} strokeWidth="2.4" fill="none" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" {...s} strokeWidth="2.6" fill="none" />,
  sparkle: <path d="M12 2.5c.8 4.6 2.3 6.5 7 7.5-4.7 1-6.2 2.9-7 7.5-.8-4.6-2.3-6.5-7-7.5 4.7-1 6.2-2.9 7-7.5z" {...s} fill={C.honey} />,
  target: <><circle cx="12" cy="12" r="8.5" {...s} fill={C.rose} /><circle cx="12" cy="12" r="5" {...s} fill={C.cream} /><circle cx="12" cy="12" r="1.8" fill={INK} /></>,
  hourglass: <><path d="M7 3.5h10M7 20.5h10" {...s} fill="none" /><path d="M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5h8c0-5-8-5-8-8.5s8-3.5 8-8.5z" {...s} fill={C.cream} /><path d="M10 18.5h4l-2-2.5z" fill={C.honey} /></>,
  backpack: <><path d="M6.5 9.5a5.5 5.5 0 0 1 11 0v9a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2z" {...s} fill={C.sage} /><path d="M9 4.8V3.5h6v1.3" {...s} fill="none" /><rect x="9" y="13" width="6" height="4.5" rx="1" {...s} fill={C.cream} /></>,
  paws: <><g fill={C.bear} stroke={INK} strokeWidth="1.2"><ellipse cx="7" cy="15" rx="2.6" ry="2.2" /><circle cx="4.6" cy="11.6" r="1" /><circle cx="7" cy="10.6" r="1" /><circle cx="9.4" cy="11.6" r="1" /><ellipse cx="17" cy="10" rx="2.6" ry="2.2" /><circle cx="14.6" cy="6.6" r="1" /><circle cx="17" cy="5.6" r="1" /><circle cx="19.4" cy="6.6" r="1" /></g></>,
  speakerOff: <><path d="M11 5 6 9H3v6h3l5 4V5Z" {...s} fill={C.cream} /><path d="m16 9 6 6m0-6-6 6" {...s} strokeWidth="2.4" fill="none" /></>,
  speaker: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" {...s} fill={C.honey} /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" {...s} fill="none" /></>,
  heart: <path d="M12 19.5s-7.5-4.6-7.5-9.6A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.3c0 5-7.5 9.6-7.5 9.6z" {...s} fill={C.rose} />,
  balloon: <><ellipse cx="12" cy="9.5" rx="5.5" ry="6.5" {...s} fill={C.sky} /><path d="M11 16h2l-1 1.8z" {...s} fill={C.sky} /><path d="M12 17.8c-1 1.5 1 2.4 0 4" {...s} fill="none" /><path d="M9.6 6.6a3 3 0 0 1 2-1.6" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" fill="none" /></>,
  abacus: <><rect x="3.5" y="4" width="17" height="16" rx="2" {...s} fill={C.cream} /><path d="M3.5 9h17M3.5 14.5h17" {...s} fill="none" />{[[7, 9], [10, 9], [15, 14.5], [12, 14.5]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.8" {...s} strokeWidth="1.3" fill={i % 2 ? C.rose : C.honey} />)}</>,
  sprout: <><path d="M12 20.5v-8" {...s} fill="none" /><path d="M12 13c0-3.5-2.5-6-7-6 0 4 2.7 6 7 6z" {...s} fill={C.sage} /><path d="M12 11c0-3 2.2-5.5 6.5-5.5 0 3.6-2.4 5.5-6.5 5.5z" {...s} fill={C.sage} /><path d="M7 20.5h10" {...s} fill="none" /></>,
  chart: <><path d="M4 4v16h16" {...s} fill="none" /><rect x="7" y="12" width="3" height="5.5" {...s} strokeWidth="1.4" fill={C.honey} /><rect x="11.5" y="8.5" width="3" height="9" {...s} strokeWidth="1.4" fill={C.sage} /><rect x="16" y="10.5" width="3" height="7" {...s} strokeWidth="1.4" fill={C.rose} /></>,
  bike: <><circle cx="6" cy="16" r="3.8" {...s} fill="none" /><circle cx="18" cy="16" r="3.8" {...s} fill="none" /><path d="M6 16l4-7h6l2 7M10 9l3.5 7H6M16 9l-1-2.5h-2.5M9 9H7.5" {...s} fill="none" /><circle cx="13.5" cy="16" r="1" fill={INK} /></>,
  medal: <><path d="M8.5 3.5l3.5 6 3.5-6" {...s} fill={C.rose} /><circle cx="12" cy="14.5" r="5.5" {...s} fill={C.honey} /><path d="m12 11.6 1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3z" fill="#fff" stroke={INK} strokeWidth="1" /></>,
  acorn: <><path d="M6.5 11h11c0 5-2.7 9-5.5 9.5C9.2 20 6.5 16 6.5 11z" {...s} fill={C.bear} /><path d="M5.5 11.5c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5z" {...s} fill="#8A6B4A" /><path d="M12 6V3.5" {...s} fill="none" /></>,
  swap: <><path d="M5 9h13l-3.5-3.5M19 15H6l3.5 3.5" {...s} strokeWidth="2.2" fill="none" /></>,
  envelope: <><rect x="3.5" y="6" width="17" height="12" rx="1.5" {...s} fill={C.cream} /><path d="M3.5 7l8.5 6.5L20.5 7" {...s} fill="none" /><circle cx="17.5" cy="15" r="1.8" fill={C.rose} /></>,
  gift: <><rect x="4" y="10" width="16" height="10" rx="1.5" {...s} fill={C.rose} /><rect x="3" y="7" width="18" height="4" rx="1" {...s} fill={C.honey} /><path d="M12 7v13" {...s} fill="none" /><path d="M12 7c-1-3-5-3.5-5-1.2C7 7 9.5 7 12 7zM12 7c1-3 5-3.5 5-1.2C17 7 14.5 7 12 7z" {...s} fill={C.honey} /></>,
  piggy: <><ellipse cx="12" cy="13" rx="7.5" ry="5.5" {...s} fill="#F4C6C0" /><path d="M6.5 9 5.5 6l3 1.6" {...s} fill="#F4C6C0" /><ellipse cx="19" cy="13" rx="1.6" ry="1.9" {...s} fill="#F4C6C0" /><path d="M9 18v2M15 18v2M10.5 8.2h3" {...s} fill="none" /><circle cx="9" cy="11.5" r=".9" fill={INK} /></>,
  coin: <><circle cx="12" cy="12" r="8" {...s} fill={C.honey} /><circle cx="12" cy="12" r="5.5" {...s} strokeWidth="1.2" fill="none" /><path d="M12 9v6M10.2 10.4c.4-1 3.6-1 3.6.5s-3.6 1-3.6 2.6 3.2 1.4 3.6.5" stroke={INK} strokeWidth="1.3" strokeLinecap="round" fill="none" /></>,
  wallet: <><rect x="3.5" y="7" width="17" height="12" rx="2.5" {...s} fill={C.sage} /><path d="M5.5 7l9-3 1.5 3" {...s} fill="none" /><rect x="14" y="11" width="6.5" height="4.5" rx="1.5" {...s} fill={C.cream} /><circle cx="16.5" cy="13.2" r=".9" fill={INK} /></>,
  tent: <><path d="M3 19.5 12 5l9 14.5z" {...s} fill={C.rose} /><path d="M12 5v14.5M9.5 19.5 12 14l2.5 5.5" {...s} fill={C.cream} /></>,
  eyes: <><circle cx="8" cy="12" r="3.5" {...s} fill={C.cream} /><circle cx="16" cy="12" r="3.5" {...s} fill={C.cream} /><path d="M11.5 12h1M4.5 11 3 10M19.5 11l1.5-1" {...s} fill="none" /></>,
  hat: <><path d="M7 15c0-5 2-9 5-9s5 4 5 9" {...s} fill={C.rose} /><path d="M3.5 15.5h17" {...s} strokeWidth="2.6" /><circle cx="12" cy="5.5" r="1.6" {...s} fill={C.cream} /></>,
  bowtie: <><path d="M12 12 4.5 8v8zM12 12l7.5-4v8z" {...s} fill={C.rose} /><circle cx="12" cy="12" r="1.8" {...s} fill={C.rose} /></>,
  shirt: <><path d="M8.5 4.5 4 7l1.8 4 2-1V19.5h8.4V10l2 1L20 7l-4.5-2.5c-.5 1.5-1.8 2.3-3.5 2.3S9 6 8.5 4.5z" {...s} fill={C.sage} /></>,
  hand: <><path d="M8 13V6.5a1.3 1.3 0 0 1 2.6 0V11V5a1.3 1.3 0 0 1 2.6 0v6-4.5a1.3 1.3 0 0 1 2.6 0V12v-2.5a1.3 1.3 0 0 1 2.6 0V14c0 4-2.4 6.5-6 6.5-2.6 0-4-1-5.4-3L5 14a1.3 1.3 0 0 1 2-1.6z" {...s} fill={C.bear} /></>,
  butterfly: <><path d="M12 8c-1.5-3-7-4.5-7.5-1.5S7 12 12 12c5 0 8-2.5 7.5-5.5S13.5 5 12 8z" {...s} fill={C.sky} /><path d="M12 12c-3 0-6 1.5-5 4.5s4 1 5-2.5c1 3.5 4 5.5 5 2.5s-2-4.5-5-4.5z" {...s} fill={C.teal} /><path d="M12 7.5v8" {...s} fill="none" /></>,
  scene: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" {...s} fill="#F3E9D2" /><path d="M3.5 16l5-6 4 4.5 2.5-2.5 5 5" {...s} fill={C.sage} /><circle cx="16.5" cy="8.5" r="1.8" fill={C.honey} /></>,
  map: <><path d="M3.5 6.5 9 4l6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5z" {...s} fill={C.cream} /><path d="M9 4v13.5M15 6.5V20" {...s} /><path d="M6 13l3-2 3 2 4-4" stroke={C.rose} strokeWidth="1.6" strokeDasharray="1.5 2" fill="none" /></>,
};

export const ICON_NAMES = [...Object.keys(PATHS), ...Object.keys(ART), "honey", "basket"];
// Raw paths, for drawing icons inside other SVGs (e.g. map pins).
export const ICON_PATHS = PATHS;

/** <Icon name="lock" size={20} /> — decorative unless `label` is given. `art={false}` forces the line drawing. */
export function Icon({ name, size = 22, label, className = "", art = true }) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" };
  if (CUSTOM.has(name)) return <img src={`/icons/ui/${name}.png`} width={size} height={size} className={`icon ${className}`} alt={label || ""} {...(label ? {} : { "aria-hidden": "true" })} />;
  if (art && ART[name]) {
    return <img src={ART[name]} className={`icon icon-art ${className}`} style={{ width: size, height: size }} alt={label || ""} draggable="false" {...(label ? {} : { "aria-hidden": "true" })} />;
  }
  const paths = PATHS[name] || (name === "honey" ? PATHS.coin : name === "basket" ? PATHS.wallet : PATHS.sparkle);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={`icon ${className}`} {...a11y}>
      {paths}
    </svg>
  );
}
