"use client";

/**
 * Éditeur d'équipement pleine page (interface Strata v2, spec v2 §4.3,
 * maquette `#catalogue-editer-<ref>` et `#catalogue-nouveau`).
 *
 * `EquipmentEditor` (arkyo, `admin/equipment/[id]/equipment-editor.tsx`) se
 * rend dans cette mise en page par une accroche unique ; son code n'est pas
 * réécrit :
 * - barre d'actions collante : retour et fil d'Ariane vers le catalogue Strata
 *   (`/admin/catalogue?tab=equipment&id=…`, la fiche y est sélectionnée), état
 *   d'enregistrement de `useEditorAutosave`, Annuler / Rétablir de
 *   `useEditorHistory`, Dupliquer et Supprimer (actions du catalogue Strata :
 *   mêmes routes, confirmation et message 409 que les panneaux d'arkyo) ; en
 *   création, Annuler et Enregistrer (l'enregistrement manuel d'arkyo). ⌘S
 *   reste le raccourci d'arkyo (`forceSave`, dans l'éditeur) ;
 * - bandeau des faces en direct (`FacesPanel`) ;
 * - colonne principale : le contenu de l'éditeur d'arkyo (onglets Généralités
 *   et Connectique), non découpé ;
 * - colonne d'aperçu : schéma de principe, ports par famille et totaux
 *   (U / W / kg), « Utilisé dans ».
 *
 * Lecture seule (mode consultation d'arkyo, ou pas de `catalog:write`) : la
 * barre n'a plus aucune action d'édition et le formulaire ne reçoit plus la
 * saisie (`inert`, comme l'opacité d'arkyo).
 *
 * « Utilisé dans » : aucune route ne donne l'usage d'une fiche (le 409 de la
 * suppression n'en donne que le total). La garde du serveur compte toutes les
 * lignes `RackInventoryItem` et `RackSlot` de la fiche ; chaque exemplaire
 * d'inventaire a son emplacement (fantôme tant qu'il n'est pas placé). On lit
 * donc, par des routes existantes, les régies (`GET /api/rigs`, leurs baies et
 * leurs emplacements), les baies hors régie (`GET /api/racks?unassigned=true`,
 * modèles de contenants) et les noms des projets (`GET /api/tenant/projects`).
 *
 * Hors Strata (`enabled` faux), rend `children` tel quel : aucun élément
 * ajouté au DOM.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormData } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import { EditorStatusBadge } from "@/components/catalogue/editor-status-badge";
import type { AutosaveStatus } from "@/components/catalogue/use-editor-autosave";
import { useTenantPermissions } from "@/components/tenant-permissions-context";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLeft, Copy, Folder, Loader2, Package, Redo2, Save, Trash2, Undo2 } from "@/components/ui/icons";
import { LoadingState } from "@/components/ui/loading-state";
import { useToast } from "@/components/ui/toast";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  drawingConnectorTypes,
  drawingSignals,
  fmtNumber,
  portFamilies,
  totalPorts,
  type CatalogueLookup,
} from "../catalogue-model";
import { useCatalogueActions } from "../catalogue/catalogue-actions";
import { ColorMark, DrawingWell, FamilyBar } from "../catalogue/catalogue-ui";
import { BlockDiagram } from "../drawings/block-diagram";
import { drawnName, FacesPanel } from "../faces-panel";
import { Box, Kv, Pill, PRIMARY_SMALL_BTN, SMALL_BTN } from "../manage/manage-ui";

export type EquipmentEditorLayoutProps = {
  /** Interface Strata : sinon, `children` est rendu tel quel. */
  enabled: boolean;
  /** Fiche éditée ; `null` en création. */
  equipmentId: string | null;
  /** Formulaire en cours de saisie (dessins et aperçu en direct). */
  form: FormData;
  lookup: CatalogueLookup;
  /** `useEditorAutosave` de l'éditeur. */
  autosave: { status: AutosaveStatus; lastSavedAt: Date | null; forceSave: () => Promise<void> };
  /** `useEditorHistory` de l'éditeur. */
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  /** Création : l'enregistrement manuel d'arkyo (`handleSave`). */
  create: { onSave: () => void | Promise<void>; saving: boolean };
  /** Mode consultation d'arkyo (fiche en lecture seule). */
  readOnly: boolean;
  children: ReactNode;
};

const CATALOGUE = "/admin/catalogue?tab=equipment";

export function EquipmentEditorLayout(props: EquipmentEditorLayoutProps) {
  if (!props.enabled) return <>{props.children}</>;
  return <StrataEquipmentEditor {...props} />;
}

function StrataEquipmentEditor({
  equipmentId,
  form,
  lookup,
  autosave,
  history,
  create,
  readOnly: consultation,
  children,
}: EquipmentEditorLayoutProps) {
  const router = useRouter();
  const toast = useToast();
  const { has } = useTenantPermissions();
  const readOnly = consultation || !has("catalog", "write");
  const isEdit = equipmentId !== null;
  const [hoverEntry, setHoverEntry] = useState<number | null>(null);
  const back = isEdit ? `${CATALOGUE}&id=${encodeURIComponent(equipmentId)}` : CATALOGUE;
  const title = isEdit ? form.name.trim() || "Sans nom" : "Nouvel équipement";

  const actions = useCatalogueActions("equipment", {
    reload: () => {},
    // Fiche supprimée : retour au catalogue.
    removeLocal: () => router.push(CATALOGUE),
  });

  const settled = useSettledStatus(autosave.status);
  const duplicate = async () => {
    if (!equipmentId) return;
    // La copie part de la fiche enregistrée : saisie en attente, enregistrement
    // en cours ou en échec, on enregistre d'abord (forceSave) et on attend
    // l'issue ; un échec annule la duplication.
    if (autosave.status === "dirty" || autosave.status === "saving" || autosave.status === "error") {
      await autosave.forceSave();
      const outcome = await settled();
      if (outcome === "error" || outcome === "timeout") {
        toast.error("Échec de l'enregistrement : la fiche n'a pas été dupliquée.");
        return;
      }
    }
    await actions.duplicate({ id: equipmentId });
  };

  return (
    <div data-strata-equipment-editor="" className="flex min-h-full flex-col bg-[var(--background)]">
      <div
        role="toolbar"
        aria-label="Barre d'actions"
        className="sticky top-0 z-20 flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--border)] bg-[var(--card)] px-7 py-2"
      >
        <Link
          href={back}
          aria-label="Retour au catalogue"
          title="Retour au catalogue"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors outline-none hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <nav aria-label="Fil d'Ariane" className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
          <Link href={back} className="text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]">
            Catalogue
          </Link>
          <span aria-hidden className="text-[var(--text-tertiary)]">
            ›
          </span>
          <Link href={back} className="text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]">
            Équipements
          </Link>
          <span aria-hidden className="text-[var(--text-tertiary)]">
            ›
          </span>
          <h1 className="m-0 truncate text-[14px] font-bold text-[var(--foreground)]">{title}</h1>
        </nav>
        <span className="flex-1" />

        {readOnly ? (
          <Pill tone="neutral">Lecture seule</Pill>
        ) : isEdit ? (
          <>
            <span role="status" className="inline-flex items-center gap-1.5">
              <EditorStatusBadge status={autosave.status} lastSavedAt={autosave.lastSavedAt} />
            </span>
            {autosave.status === "error" && (
              <button type="button" onClick={() => void autosave.forceSave()} className={SMALL_BTN}>
                Réessayer
              </button>
            )}
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={history.undo}
                disabled={!history.canUndo}
                aria-label="Annuler la dernière modification"
                title="Annuler la dernière modification (⌘Z)"
                className={SMALL_BTN}
              >
                <Undo2 className="h-3.5 w-3.5" />
                Annuler
              </button>
              <button type="button" onClick={history.redo} disabled={!history.canRedo} title="⌘⇧Z" className={SMALL_BTN}>
                <Redo2 className="h-3.5 w-3.5" />
                Rétablir
              </button>
            </span>
            <span aria-hidden className="h-5 w-px bg-[var(--border)]" />
            <button type="button" onClick={() => void duplicate()} className={SMALL_BTN}>
              <Copy className="h-3.5 w-3.5" />
              Dupliquer
            </button>
            <button
              type="button"
              onClick={() => void actions.remove({ id: equipmentId, name: form.name.trim() || "Cet équipement" })}
              className={cn(SMALL_BTN, "text-[var(--danger-text)]")}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Supprimer
            </button>
          </>
        ) : (
          <>
            <Pill tone="neutral">Non enregistré</Pill>
            <button type="button" onClick={() => router.push(CATALOGUE)} className={SMALL_BTN}>
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void create.onSave()}
              disabled={create.saving || !form.name.trim()}
              className={PRIMARY_SMALL_BTN}
            >
              {create.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Enregistrer
            </button>
          </>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-[18px] px-7 pt-[18px] pb-16">
        <FacesPanel form={form} lookup={lookup} hoverEntry={hoverEntry} onEntryHover={setHoverEntry} />
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section
            aria-label="Formulaire"
            className="min-w-0 overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--card)]"
          >
            {readOnly ? (
              <div inert className="pointer-events-none opacity-80">
                {children}
              </div>
            ) : (
              children
            )}
          </section>
          <Preview
            equipmentId={equipmentId}
            form={form}
            lookup={lookup}
            hoverEntry={hoverEntry}
            onEntryHover={setHoverEntry}
          />
        </div>
      </div>
    </div>
  );
}

/** Délai au-delà duquel un enregistrement qui ne se termine pas compte comme un échec. */
const SAVE_WAIT_MS = 15000;

/**
 * Attente de l'issue de l'autosave : la promesse se résout au premier état
 * stable (ni `dirty` ni `saving`) rendu après l'appel, ou à `"timeout"`
 * (enregistrement désactivé, par exemple sans nom). `forceSave` d'arkyo avale
 * ses erreurs : l'issue se lit dans l'état.
 */
function useSettledStatus(status: AutosaveStatus) {
  const statusRef = useRef(status);
  const waiters = useRef<((s: AutosaveStatus | "timeout") => void)[]>([]);
  useEffect(() => {
    statusRef.current = status;
    if (status === "dirty" || status === "saving") return;
    const pending = waiters.current;
    waiters.current = [];
    for (const resolve of pending) resolve(status);
  }, [status]);
  useEffect(() => () => waiters.current.splice(0).forEach((resolve) => resolve("timeout")), []);
  return useCallback(
    () =>
      new Promise<AutosaveStatus | "timeout">((resolve) => {
        const s = statusRef.current;
        if (s !== "dirty" && s !== "saving") return resolve(s);
        let done = false;
        const finish = (v: AutosaveStatus | "timeout") => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(v);
        };
        const timer = setTimeout(() => finish("timeout"), SAVE_WAIT_MS);
        waiters.current.push(finish);
      }),
    [],
  );
}

// ── Colonne d'aperçu ────────────────────────────────────────────────────────

function Preview({
  equipmentId,
  form,
  lookup,
  hoverEntry,
  onEntryHover,
}: {
  equipmentId: string | null;
  form: FormData;
  lookup: CatalogueLookup;
  hoverEntry: number | null;
  onEntryHover: (entry: number | null) => void;
}) {
  const connectors = form.connectorEntries;
  const { connectorTypes: types, signals: sigs, functions: fns } = lookup;
  const connectorTypes = useMemo(() => drawingConnectorTypes({ connectorTypes: types }), [types]);
  const signals = useMemo(() => drawingSignals({ signals: sigs, functions: fns }), [sigs, fns]);
  const families = portFamilies(connectors, lookup);
  const brand = lookup.brands?.find((b) => b.id === form.brandId)?.name ?? null;
  const num = (n: number | null | undefined, unit: string) =>
    typeof n === "number" && n > 0 ? `${fmtNumber(n)} ${unit}` : "—";

  return (
    <aside aria-label="Aperçu" className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-[70px]">
      <Box title="Schéma de principe">
        {connectors.length ? (
          <DrawingWell>
            <BlockDiagram
              connectors={connectors}
              connectorTypes={connectorTypes}
              signals={signals}
              name={drawnName(form)}
              brand={brand}
              is2110={form.is2110}
              hoverEntry={hoverEntry}
              onEntryHover={onEntryHover}
            />
          </DrawingWell>
        ) : (
          <p className="m-0 text-[12.5px] text-[var(--muted-foreground)]">Aucune connectique.</p>
        )}
      </Box>

      <Box title="Ports par famille de signal">
        <FamilyBar connectors={connectors} lookup={lookup} />
        {families.length ? (
          <ul aria-label="Ports par famille" className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
            {families.map((f) => (
              <li key={f.key} className="flex items-center gap-2">
                <ColorMark color={f.color} />
                <span className="flex-1 text-[var(--foreground)]">{f.label}</span>
                <span className="font-mono text-[11.5px] text-[var(--muted-foreground)] tabular-nums">{f.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[12.5px] text-[var(--muted-foreground)]">Aucun port.</p>
        )}
        <div role="group" aria-label="Totaux">
          <Kv
            rows={[
              ["Ports", String(totalPorts(connectors))],
              ["Hauteur", form.isRackable ? `${fmtNumber(form.heightU)} U` : "Pose libre"],
              ["Puissance", num(form.powerW, "W")],
              ["Poids", num(form.weight, "kg")],
            ]}
          />
        </div>
      </Box>

      {equipmentId !== null && <UsedIn equipmentId={equipmentId} />}
    </aside>
  );
}

// ── « Utilisé dans » ────────────────────────────────────────────────────────

type RigSlot = { id: string; catalogEquipmentId?: string | null };
type Rig = {
  id: string;
  name?: string | null;
  projectId?: string | null;
  rigRacks?: { rack?: { slots?: RigSlot[] } | null }[];
};
type LooseRack = { id: string; slots?: RigSlot[] };

export type Usage = { key: string; name: string; template: boolean; count: number };

/** Mention d'un groupe de modèles (rien pour un projet). */
function usageKind(u: Usage): string | null {
  if (!u.template) return null;
  return u.key === "contenants" ? null : "Modèle de régie";
}

/** Groupe des baies rattachées à aucune régie. */
const CONTAINERS = "Modèles de contenants";

/**
 * Exemplaires de la fiche `id` par projet (régies du projet), par modèle de
 * régie (régie hors projet) et, pour les baies rattachées à aucune régie, dans
 * « Modèles de contenants » : emplacements de leurs baies, fantômes
 * d'inventaire compris, chaque emplacement compté une fois par groupe.
 */
export function usageOf(
  id: string,
  rigs: readonly Rig[],
  projects: readonly { id: string; name: string }[],
  looseRacks: readonly LooseRack[] = [],
): Usage[] {
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const groups = new Map<string, { name: string; template: boolean; slots: Set<string> }>();
  for (const rig of rigs) {
    const slots = (rig.rigRacks ?? [])
      .flatMap((rr) => rr.rack?.slots ?? [])
      .filter((s) => s.catalogEquipmentId === id);
    if (slots.length === 0) continue;
    const key = rig.projectId ? `p:${rig.projectId}` : `g:${rig.id}`;
    const name = (rig.projectId ? projectName.get(rig.projectId) : null) ?? rig.name ?? "Sans nom";
    const g = groups.get(key) ?? { name, template: !rig.projectId, slots: new Set<string>() };
    for (const s of slots) g.slots.add(s.id);
    groups.set(key, g);
  }
  const loose = looseRacks.flatMap((r) => r.slots ?? []).filter((s) => s.catalogEquipmentId === id);
  if (loose.length) {
    groups.set("contenants", { name: CONTAINERS, template: true, slots: new Set(loose.map((s) => s.id)) });
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, name: g.name, template: g.template, count: g.slots.size }))
    .sort((a, b) => Number(a.template) - Number(b.template) || a.name.localeCompare(b.name, "fr"));
}

type UsageState = { kind: "loading" } | { kind: "ready"; usage: Usage[] } | { kind: "error"; message: string };

function UsedIn({ equipmentId }: { equipmentId: string }) {
  const [state, setState] = useState<UsageState>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    Promise.all([
      api.get<Rig[]>("/api/rigs"),
      api.get<{ projects?: { id: string; name: string }[] }>("/api/tenant/projects"),
      api.get<LooseRack[]>("/api/racks?unassigned=true"),
    ])
      .then(([rigs, projects, loose]) => {
        if (cancelled) return;
        setState({
          kind: "ready",
          usage: usageOf(equipmentId, rigs ?? [], projects?.projects ?? [], loose ?? []),
        });
      })
      .catch((e) => {
        if (!cancelled) setState({ kind: "error", message: getApiErrorMessage(e, "Lecture impossible.") });
      });
    return () => {
      cancelled = true;
    };
  }, [equipmentId]);

  const total = state.kind === "ready" ? state.usage.reduce((a, u) => a + u.count, 0) : null;
  return (
    <Box
      title="Utilisé dans"
      aside={
        total !== null ? (
          <span className="text-[12px] text-[var(--muted-foreground)] tabular-nums">
            {`${total} exemplaire${total > 1 ? "s" : ""}`}
          </span>
        ) : null
      }
    >
      {state.kind === "loading" ? (
        <LoadingState className="py-4" />
      ) : state.kind === "error" ? (
        <p className="m-0 text-[12.5px] text-[var(--muted-foreground)]">{state.message}</p>
      ) : state.usage.length === 0 ? (
        <EmptyState icon={<Package strokeWidth={1.5} />} title="Non utilisé" className="gap-2 py-4" />
      ) : (
        <ul aria-label="Utilisé dans" className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12.5px]">
          {state.usage.map((u) => (
            <li key={u.key} className="flex items-center gap-2">
              <Folder aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
              <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">{u.name}</span>
              {usageKind(u) && <span className="text-[11.5px] text-[var(--muted-foreground)]">{usageKind(u)}</span>}
              <span className="font-mono text-[11.5px] text-[var(--muted-foreground)] tabular-nums">{u.count}</span>
            </li>
          ))}
        </ul>
      )}
    </Box>
  );
}
