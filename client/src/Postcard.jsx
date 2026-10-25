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
        <small className="album-value" title="A collecting score for swapping postcards. Every surprise trip costs 30 points.">Collector's value {place.cost}</small>
      </div>
    </button>
  );
}

/** Two-sided postcard. Tap to flip between picture and story. */
export function FlipPostcard({ id, place, bearName, to, collectedAt, startFlipped = false, surprise = false, revealDelay }) {
  const revealing = revealDelay !== undefined;
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [flipped, setFlipped] = useState(() => (revealing && !reducedMotion()) || startFlipped);
  const [revealed, setRevealed] = useState(() => !revealing || reducedMotion());
  useEffect(() => {
    if (!revealing) return;
    if (reducedMotion()) { setFlipped(false); setRevealed(true); return; }
    const flip = setTimeout(() => setFlipped(false), revealDelay + 1200);
    const finish = setTimeout(() => setRevealed(true), revealDelay + 2000);
    return () => { clearTimeout(flip); clearTimeout(finish); };
  }, [revealDelay]);
  const turn = () => { if (revealed) setFlipped((f) => !f); };
  return (
    <div className={`flip ${flipped ? "flipped" : ""} ${surprise ? "surprise" : ""}`}>
      <div className="flip-inner" role="button" tabIndex={revealed ? 0 : -1} aria-disabled={!revealed} onClick={turn}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), turn())}
        aria-label={flipped ? "Show picture" : "Turn postcard over to read the story"} aria-pressed={flipped}>
        <div className="flip-face front" aria-hidden={!revealed}>
          <img src={place.image} alt={revealed ? `${bearName} at ${place.name}` : ""} draggable="false" />
          {surprise && <span className="surprise-badge"><Icon name="sparkle" size={16} /> Surprise discovery!</span>}
          <span className="flip-hint">Tap to turn over</span>
        </div>
        <div className="flip-face back">
          {revealed ? <>
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
          </> : <p className="pc-greeting">A surprise from {bearName}…</p>}
        </div>
      </div>
      {revealing && revealed && <><h2 className="hand">{place.name}</h2><p className="story">{storyFor(place, bearName)}</p></>}
    </div>
  );
}
