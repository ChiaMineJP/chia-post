export const CHAIN_COLORS = {
  cc: "#3fb950",
  icc: "#d29922",
  rc: "#58a6ff",
} as const;

const FARMER_PALETTE = [
  "#f778ba",
  "#a371f7",
  "#56d4dd",
  "#e3b341",
  "#ff7b72",
  "#7ee787",
  "#79c0ff",
];

export function farmerColor(id: number): string {
  return FARMER_PALETTE[id % FARMER_PALETTE.length];
}
