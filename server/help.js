import { readFileSync } from "node:fs";
import { guides } from "./kb.js";

const guide = new URL("../docs/apple-cash-shortcut.md", import.meta.url);
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const inline = (value) => value.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part) => part.startsWith("`") ? `<code>${escape(part.slice(1, -1))}</code>` : part.startsWith("**") ? `<strong>${escape(part.slice(2, -2))}</strong>` : escape(part)).join("");

// Only the guide's small Markdown subset is supported. Raw HTML is always text.
export function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r/g, "").split("\n"), out = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      out.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`); i++; continue;
    }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) { out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i++; continue; }
    if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++].slice(1, -1).split("|").map((cell) => cell.trim()));
      out.push(`<div class="table-wrap"><table><thead><tr>${rows[0].map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.slice(2).map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`); continue;
    }
    const list = /^(\d+\. |[-*] )/.exec(line);
    if (list) {
      const tag = /^\d/.test(list[0]) ? "ol" : "ul", items = [];
      while (i < lines.length && /^(\d+\. |[-*] )/.test(lines[i])) {
        let item = lines[i++].replace(/^(\d+\. |[-*] )/, "");
        while (i < lines.length && /^\s+\S/.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<${tag}>${items.join("")}</${tag}>`); continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3} |```|\||\d+\. |[-*] )/.test(lines[i])) paragraph.push(lines[i++]);
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  return out.join("\n");
}

export function appleCashHelp(req) {
  const protocol = process.env.NODE_ENV === "production" || req.secure || req.protocol === "https" ? "https" : "http";
  // Only a plain hostname[:port] may appear in the guide; anything odd falls back to the request-less default.
  const rawHost = req.get("host") || "localhost";
  const host = /^[a-zA-Z0-9.-]+(:\d+)?$/.test(rawHost) ? rawHost : "localhost";
  // Host is inserted only into escaped text, never executable markup or a link.
  const markdown = readFileSync(guide, "utf8").replaceAll("https://YOUR_MONEYQUEST_SITE", `${protocol}://${host}`);
  return helpPage("Apple Cash tracking", markdown);
}

export function appHelp() {
  return helpPage("Help", `${guides.parent}\n\n${guides.kid}`.replaceAll("<bear>", "your bear"),
    '<p><a href="/help/apple-cash">Apple Cash Shortcut setup</a></p>');
}

function helpPage(title, markdown, extra = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · Bearly Spent</title><style>
    * { box-sizing: border-box; } body { margin: 0; background: #F7F0DF; color: #514738; font: 17px/1.6 ui-rounded, system-ui, sans-serif; padding: 24px 16px; }
    main { max-width: 760px; margin: auto; padding: 28px; background: #FCF8EE; border: 2px solid #514738; border-radius: 18px; box-shadow: 0 6px 14px -8px #514738; overflow-wrap: anywhere; }
    h1, h2 { font-family: "Comic Sans MS", cursive; line-height: 1.2; } h2 { margin-top: 32px; } a { color: #4F7389; } li { margin: 10px 0; }
    code { font-size: 0.9em; } pre { white-space: pre-wrap; background: #EFE5CC; padding: 16px; border-radius: 10px; } table { border-collapse: collapse; } th, td { text-align: left; vertical-align: top; padding: 10px; border: 1px solid #BBAE94; } .table-wrap { overflow-x: auto; }
    @media (max-width: 480px) { main { padding: 18px; } }
  </style></head><body><main><a href="/">Back to Bearly Spent</a>${extra}${renderMarkdown(markdown)}</main></body></html>`;
}
