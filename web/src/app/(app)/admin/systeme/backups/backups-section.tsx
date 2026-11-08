/**
 * Système › Sauvegardes : trois blocs (points de restauration, export /
 * import, sauvegarde du site). Code propre à arkyo-server.
 */

import { RestorePoints } from "./restore-points";

export function BackupBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

export function BackupsSection() {
  return (
    <section className="space-y-6">
      <h2 className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">
        Sauvegardes
      </h2>
      <RestorePoints />
    </section>
  );
}
