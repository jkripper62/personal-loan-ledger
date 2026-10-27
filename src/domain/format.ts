export const money = (cents: number) =>
  new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
export const date = (value: string) =>
  new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
