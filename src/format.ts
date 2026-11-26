/** Display helpers. Kept free of DOM code so they can be tested. */

/**
 * Dollars for display. Amounts under a tenth of a cent show as "<$0.001" rather than a
 * misleading "$0.000"; amounts under 10 cents get three decimals so small calls stay visible.
 */
export function usd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n < 0.001) return "<$0.001";
  return `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
}

/** The line under "Start solving": which cap covers what, so the preview cap isn't mistaken for the project's. */
export function capNote(spentUsd: number, previewCapUsd: number, projectCapUsd: number): string {
  return `Solving is capped at ${usd(projectCapUsd)} for the whole project. The free preview so far used ${usd(spentUsd)} of its separate ${usd(previewCapUsd)} limit. Payments come later.`;
}
