// Postcards from the bear's travels: album thumbnails, postage stamps, and a
// flip card that shows the illustration on the front and the story on the back.
import { useEffect, useState } from "react";
import { Icon } from "./Icons.jsx";

export const RARITY_LABEL = { common: "Common", rare: "Rare", secret: "Secret", seasonal: "Seasonal" };

export const storyFor = (place, bearName) => (place.story || "").replaceAll("Maple", bearName);
const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** A postage stamp cut from the place's own postcard illustration. */
export function Stamp({ stamp, name, image, size = "md" }) {
  return (
    <div className={`stamp stamp-${size}`} style={{ "--stamp": stamp.color }} role="img" aria-label={`${name} stamp`}>
      <div className="stamp-inner">
        <span className="stamp-pic" style={{ backgroundImage: `url(${image})` }} aria-hidden="true" />
        <span className="stamp-value">{stamp.value}</span>
        {size !== "sm" && <span className="stamp-name">{name}</span>}
      </div>
    </div>
  );
}

/** Album tile. Locked cards appear as a faded silhouette with a clue. */
export function PostcardTile({ id, place, count, onOpen, isNew = false, tilt = 0 }) {
  if (place.hidden) {
    return (
      <div className="pc-tile secret-tile" style={{ "--tilt": `${tilt}deg` }}>
        <div className="pc-photo mystery" aria-hidden="true"><span>?</span></div>
        <div className="pc-caption">
          <strong>A secret place</strong>
          <p className="clue">{place.clue}</p>
        </div>
      </div>
    );
  }
  const owned = count > 0;
  return (
    <button type="button" className={`pc-tile ${owned ? "owned" : "faded"} rarity-${place.rarity}`} style={{ "--tilt": `${tilt}deg` }} onClick={() => onOpen(id)}
      aria-label={`${place.name} postcard${owned ? "" : ", not collected yet"}`}>
      <span className="tape" aria-hidden="true" />
      {isNew && <span className="new-card-badge">New</span>}
      <img className="pc-photo" src={place.image} alt="" loading="lazy" draggable="false" />
      <div className="pc-caption">
        <strong>{place.name}</strong>
        <span className={`rarity-chip ${place.rarity}`}>{RARITY_LABEL[place.rarity]}</span>
        {count > 1 && <span className="count-chip">×{count}</span>}
        {!owned && <small>{place.lockReason || "A future adventure"}</small>}
        <small className="album-value" title="Postcard value. Every surprise trip costs 30 points.">Album value · {place.cost} pts</small>
      </div>
    </button>
  );
}

/** Two-sided postcard. Tap to flip between picture and story. */
export function FlipPostcard({ id, place, bearName, to, collectedAt, startFlipped = false, surprise = false, revealDelay }) {
  const [flipped, setFlipped] = useState(revealDelay !== undefined || startFlipped);
  useEffect(() => {
    if (revealDelay === undefined) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setFlipped(false); return; }
    const timer = setTimeout(() => setFlipped(false), revealDelay + 1200);
    return () => clearTimeout(timer);
  }, [revealDelay]);
  return (
    <div className={`flip ${flipped ? "flipped" : ""} ${surprise ? "surprise" : ""}`}>
      <div className="flip-inner" role="button" tabIndex="0" onClick={() => setFlipped((f) => !f)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setFlipped((f) => !f))}
        aria-label={flipped ? "Show picture" : "Turn postcard over to read the story"} aria-pressed={flipped}>
        <div className="flip-face front">
          <img src={place.image} alt={`${bearName} at ${place.name}`} draggable="false" />
          {surprise && <span className="surprise-badge"><Icon name="sparkle" size={16} /> Surprise discovery!</span>}
          <span className="flip-hint">Tap to turn over</span>
        </div>
        <div className="flip-face back">
          <div className="pc-back-left">
            <p className="pc-greeting">Dear {to},</p>
            <p className="pc-story">{storyFor(place, bearName)}</p>
            <p className="pc-sign">Love, {bearName} <Icon name="paws" size={22} /></p>
          </div>
          <div className="pc-back-right">
            <Stamp stamp={place.stamp} name={place.name} image={place.image} />
            {collectedAt && (
              <div className="postmark" aria-label={`Collected ${fmtDate(collectedAt)}`}>
                <span>{place.state}</span>
                <b>{fmtDate(collectedAt)}</b>
              </div>
            )}
            <div className="address-lines" aria-hidden="true"><i /><i /><i /></div>
            <p className="pc-place">{place.name}<br /><small>{place.state}</small></p>
          </div>
        </div>
      </div>
    </div>
  );
}
