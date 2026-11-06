"use client";

/**
 * LocationSelectorDropdown — sélecteur d'emplacement de la sous-topbar
 * Inventaire. Même geste et même grammaire visuelle que le sélecteur de
 * contenant de l'onglet Rack (`RackSelectorDropdown`).
 *
 *  - Items : lieux du projet (nom + code + « N cont. · M libres »)
 *  - Entrée « À affecter (n) » tant qu'il reste des contenants sans lieu
 *  - Bouton dashed « + » APRÈS le dropdown → dialog « Nouvel emplacement »
 */

import { useMemo, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ChevronDown,
  Loader2,
  MapPin,
  PackageOpen,
  Plus,
} from "@/components/ui/icons";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  UNASSIGNED_LOCATION_ID,
  useInventaireScope,
} from "./inventaire-scope";

const schema = z.object({
  name: z.string().min(1, "Nom requis"),
  cableCode: z.string().max(5).optional(),
});
type FormValues = z.infer<typeof schema>;

export function LocationSelectorDropdown() {
  const {
    locations,
    racks,
    selectedLocationId,
    setSelectedLocationId,
    createLocation,
    updateLocation,
  } = useInventaireScope();
  const [createOpen, setCreateOpen] = useState(false);

  // Compteurs par lieu, calculés depuis l'état courant (pas de compteur figé).
  const stats = useMemo(() => {
    const map = new Map<string, { containers: number; free: number }>();
    for (const loc of locations) {
      const containers = racks.filter(
        (r) => !r.isVirtual && r.locationId === loc.id,
      ).length;
      const free = loc.virtualRackId
        ? (racks.find((r) => r.id === loc.virtualRackId)?.bom ?? []).filter(
            (it) => it.hostItemId == null,
          ).length
        : 0;
      map.set(loc.id, { containers, free });
    }
    return map;
  }, [locations, racks]);

  const unassignedCount = racks.filter(
    (r) => !r.isVirtual && !r.locationId,
  ).length;

  const current = locations.find((l) => l.id === selectedLocationId) ?? null;
  const isUnassignedView = selectedLocationId === UNASSIGNED_LOCATION_ID;
  const currentStats = current ? stats.get(current.id) : null;

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="border-border bg-card hover:bg-secondary/40 inline-flex h-7 max-w-[320px] shrink-0 items-center gap-2 rounded-md border px-2.5 text-[11px] font-medium transition-colors"
          >
            {isUnassignedView ? (
              // arkyo-server: habillage Strata (alerte « À affecter » : --warning)
              <PackageOpen className="h-3 w-3 shrink-0 text-[var(--warning)]" />
            ) : (
              <MapPin
                className="text-muted-foreground h-3 w-3 shrink-0"
                strokeWidth={1.75}
              />
            )}
            {isUnassignedView ? (
              <>
                <span className="truncate uppercase">À affecter</span>
                <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                  {unassignedCount} contenant{unassignedCount > 1 ? "s" : ""}
                </span>
              </>
            ) : current ? (
              <>
                <span className="truncate uppercase">{current.name}</span>
                <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                  {current.cableCode ? `${current.cableCode} · ` : ""}
                  {currentStats?.containers ?? 0} cont. ·{" "}
                  {currentStats?.free ?? 0} libre
                  {(currentStats?.free ?? 0) > 1 ? "s" : ""}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                Aucun emplacement
              </span>
            )}
            <ChevronDown className="text-muted-foreground ml-1 h-3 w-3 shrink-0" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="border-border bg-card z-50 max-h-[60vh] min-w-[280px] overflow-auto rounded-lg border p-1 shadow-md"
          >
            {locations.map((loc) => {
              const active = loc.id === selectedLocationId;
              const st = stats.get(loc.id);
              return (
                <DropdownMenu.Item
                  key={loc.id}
                  onSelect={() => setSelectedLocationId(loc.id)}
                  className={cn(
                    "cursor-pointer rounded-md px-2 py-1.5 text-[11px] outline-none transition-colors",
                    active
                      ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]" // arkyo-server: habillage Strata
                      : "data-[highlighted]:bg-secondary/60 text-foreground",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium uppercase">{loc.name}</p>
                      <p className="text-muted-foreground mt-0.5 truncate font-mono text-[10px]">
                        {loc.cableCode ? `${loc.cableCode} · ` : ""}
                        {st?.containers ?? 0} contenant
                        {(st?.containers ?? 0) > 1 ? "s" : ""} ·{" "}
                        {st?.free ?? 0} équipement{(st?.free ?? 0) > 1 ? "s" : ""}{" "}
                        libre{(st?.free ?? 0) > 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                </DropdownMenu.Item>
              );
            })}

            {unassignedCount > 0 && (
              <DropdownMenu.Item
                onSelect={() => setSelectedLocationId(UNASSIGNED_LOCATION_ID)}
                className={cn(
                  "cursor-pointer rounded-md px-2 py-1.5 text-[11px] outline-none transition-colors",
                  isUnassignedView
                    ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]" // arkyo-server: habillage Strata
                    : "data-[highlighted]:bg-secondary/60 text-foreground",
                )}
              >
                <div className="flex items-center gap-2">
                  {/* arkyo-server: habillage Strata (alerte « À affecter » : --warning) */}
                  <PackageOpen className="h-3 w-3 shrink-0 text-[var(--warning)]" />
                  <span className="font-medium uppercase">
                    À affecter ({unassignedCount})
                  </span>
                </div>
              </DropdownMenu.Item>
            )}

          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Ajout d'un emplacement — bouton dashed labellisé, même gabarit que
          le dropdown (h-7, texte 11px), convention « Ajouter » en pointillé. */}
      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border-2 border-dashed border-[var(--border)] px-2.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        <Plus className="h-3.5 w-3.5" />
        Nouvel emplacement
      </button>

      <NewLocationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={async (values) => {
          const created = await createLocation(values.name);
          if (!created) return false;
          const code = values.cableCode?.trim();
          if (code && code.toUpperCase() !== (created.cableCode ?? "")) {
            await updateLocation(created.id, { cableCode: code });
          }
          return true;
        }}
      />
    </>
  );
}

// ── Dialog de création ───────────────────────────────────────────────────────

function NewLocationDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (values: FormValues) => Promise<boolean>;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", cableCode: "" },
  });
  const submitting = form.formState.isSubmitting;

  const submit = form.handleSubmit(async (values) => {
    const ok = await onCreate(values);
    if (!ok) return;
    form.reset({ name: "", cableCode: "" });
    onOpenChange(false);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) form.reset({ name: "", cableCode: "" });
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md p-0">
        <div className="flex items-start gap-4 border-b border-[var(--border)] px-6 py-5 pr-14">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <MapPin className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold leading-tight">
              Nouvel emplacement
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-sm text-[var(--muted-foreground)]">
              Régie, nodal, plateau, car…
            </DialogDescription>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 px-6 py-5">
          <FormField
            label="Nom"
            required
            error={form.formState.errors.name?.message}
          >
            <Input
              autoFocus
              className="h-10 text-sm"
              placeholder="Ex. Régie principale"
              {...form.register("name")}
            />
          </FormField>

          <FormField
            label="Code câbles"
            error={form.formState.errors.cableCode?.message}
          >
            <Input
              className="h-10 font-mono text-sm uppercase"
              maxLength={5}
              placeholder="REG"
              {...form.register("cableCode")}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button type="submit" variant="accent" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Créer
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
