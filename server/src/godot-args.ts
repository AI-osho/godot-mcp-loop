import { BridgeError } from "./errors.js";

/** Godot strips argument edges and replaces literal `%20` before its option parser sees the argv list. */
export function assertGodotValue(value: string, label: string, optionValue = false): void {
  if (!value || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value) || value.includes("%20") || (optionValue && value.startsWith("-"))) {
    throw new BridgeError(
      "INVALID_PARAMS",
      `${label} cannot be passed literally to Godot's command-line parser.`,
      "Rename it to remove control characters, edge whitespace, literal %20, or a preset's leading dash. Values are refused, never rewritten.",
    );
  }
}
