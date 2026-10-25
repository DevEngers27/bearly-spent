import { GameError } from "./domain.js";

function number(v) {
  if (typeof v !== "number" && (typeof v !== "string" || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim()))) {
    throw new GameError("Enter a number");
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new GameError("Enter a number");
  return n;
}

// HTTP money values are dollars; the game and ledger use integer cents.
export function money(v, { min = 0, max = 1000000 } = {}) {
  const cents = number(v) * 100;
  if (!Number.isFinite(cents) || cents < min || cents > max) throw new GameError("That amount is out of range");
  return Math.round(cents);
}

export function integer(v, { min = 0, max = 1000000 } = {}) {
  const n = number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new GameError("Pick a whole number in range");
  return n;
}

export function str(v, { max = 120, required = true } = {}) {
  if (typeof v !== "string") throw new GameError("Enter some words");
  const text = v.trim();
  if (required && !text) throw new GameError("Enter some words");
  if (text.length > max) throw new GameError(`Keep it under ${max + 1} characters`);
  return text;
}

export function bool(v) {
  if (typeof v !== "boolean") throw new GameError("Choose yes or no");
  return v;
}

export function id(v) {
  const value = str(v, { max: 64 });
  if (value.includes("/")) throw new GameError("Pick a valid item");
  return value;
}

export function oneOf(v, values) {
  const value = id(v);
  if (!values.includes(value)) throw new GameError("Pick one of the choices");
  return value;
}

export function object(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new GameError("Send the form fields together");
  return v;
}
