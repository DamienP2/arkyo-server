/**
 * Système › Sauvegardes : trois blocs (points de restauration, export /
 * import, sauvegarde du site). Code propre à arkyo-server.
 */

import { RestorePoints } from "./restore-points";
import { SiteBackups } from "./site-backups";
import { TransferBlock } from "./transfer";

export function BackupsSection() {
  return (
    <section className="space-y-6">
      <h2 className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">
        Sauvegardes
      </h2>
      <RestorePoints />
      <TransferBlock />
      <SiteBackups />
    </section>
  );
}
