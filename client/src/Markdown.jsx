// Deliberately small: React escapes every text node; links and HTML stay text.
function inline(text) {
  const parts = [];
  const tokens = /(?<!`)`([^`\n]+)`(?!`)|(?<!\*)\*\*([^*\n]+)\*\*(?!\*)|(?<!\*)\*([^*\n]+)\*(?!\*)/g;
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    parts.push(text.slice(end, match.index));
    const Tag = match[1] !== undefined ? "code" : match[2] !== undefined ? "strong" : "em";
    parts.push(<Tag key={match.index}>{match[1] ?? match[2] ?? match[3]}</Tag>);
    end = match.index + match[0].length;
  }
  parts.push(text.slice(end));
  return parts;
}

export default function Markdown({ text = "" }) {
  const blocks = [];
  let lines = [], kind = null, start = 1;
  const flush = () => {
    if (!lines.length) return;
    const key = blocks.length;
    if (kind === "ul" || kind === "ol") {
      const List = kind;
      blocks.push(<List key={key} start={kind === "ol" ? start : undefined}>{lines.map((line, i) => <li key={i}>{inline(line)}</li>)}</List>);
    } else blocks.push(<p key={key}>{lines.map((line, i) => <span key={i}>{i > 0 && <br />}{inline(line)}</span>)}</p>);
    lines = [];
  };
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) { flush(); kind = null; continue; }
    const item = line.match(/^(?:- |(\d+)\. )(.+)$/);
    const nextKind = item ? item[1] ? "ol" : "ul" : "p";
    if (nextKind !== kind) { flush(); kind = nextKind; start = item?.[1] ? Number(item[1]) : 1; }
    lines.push(item ? item[2] : line);
  }
  flush();
  return <div className="markdown">{blocks}</div>;
}
