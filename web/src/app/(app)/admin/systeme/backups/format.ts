/** Dates et tailles en français (Système › Sauvegardes). */

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("fr-FR");
}

export function formatSize(bytes: number): string {
  const units = ["octets", "Ko", "Mo", "Go"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  if (i === 0) return `${bytes} octets`;
  return `${value.toFixed(value >= 10 ? 0 : 1).replace(".", ",")} ${units[i]}`;
}
