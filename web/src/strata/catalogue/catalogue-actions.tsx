"use client";

/**
 * Dupliquer, supprimer et supprimer en lot une fiche du catalogue (Strata
 * v2) : mêmes routes, mêmes confirmations et mêmes messages que les panneaux
 * d'arkyo (`{equipment,cables,adapters}-list-panel.tsx`, `handleDuplicate`,
 * `handleDelete`, `handleBulkDelete`), avec `useConfirm` et `useToast`
 * d'arkyo.
 */

import { useRouter } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { useRowSelection } from "@/components/catalogue/use-row-selection";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import type { RowCheckHandlers } from "./catalogue-ui";
import type { CatalogueKind } from "./use-catalogue-items";

const s = (n: number) => (n > 1 ? "s" : "");

type Wording = {
  duplicated: string;
  deleteTitle: string;
  deleteDescription: (name: string) => ReactNode;
  deleted: string;
  inUse: string;
  bulkTitle: (n: number) => string;
  bulkDeleted: (n: number) => string;
  /** Raisons citées quand il y a peu d'échecs (cordons seulement, comme arkyo). */
  bulkReasons: boolean;
};

const WORDING: Record<CatalogueKind, Wording> = {
  equipment: {
    duplicated: "Équipement dupliqué.",
    deleteTitle: "Supprimer l'équipement",
    deleteDescription: (name) => (
      <>
        <strong>{name}</strong> sera supprimé définitivement. Cette action
        est bloquée si l&apos;équipement est utilisé dans un projet.
      </>
    ),
    deleted: "Équipement supprimé.",
    inUse: "Équipement utilisé — suppression impossible.",
    bulkTitle: (n) => `Supprimer ${n} élément${s(n)} ?`,
    bulkDeleted: (n) => `${n} élément${s(n)} supprimé${s(n)}.`,
    bulkReasons: false,
  },
  cables: {
    duplicated: "Cordon dupliqué.",
    deleteTitle: "Supprimer le cordon",
    deleteDescription: (name) => (
      <>
        <strong>{name}</strong> sera supprimé définitivement.
      </>
    ),
    deleted: "Cordon supprimé.",
    inUse: "Cordon utilisé — suppression impossible.",
    bulkTitle: (n) => `Supprimer ${n} cordon${s(n)} ?`,
    bulkDeleted: (n) => `${n} cordon${s(n)} supprimé${s(n)}.`,
    bulkReasons: true,
  },
  adapters: {
    duplicated: "Adaptateur dupliqué.",
    deleteTitle: "Supprimer l'adaptateur",
    deleteDescription: (name) => (
      <>
        <strong>{name}</strong> sera supprimé définitivement.
      </>
    ),
    deleted: "Adaptateur supprimé.",
    inUse: "Adaptateur utilisé — suppression impossible.",
    bulkTitle: (n) => `Supprimer ${n} élément${s(n)} ?`,
    bulkDeleted: (n) => `${n} élément${s(n)} supprimé${s(n)}.`,
    bulkReasons: false,
  },
};

export type CatalogueActions = {
  duplicate: (item: { id: string }) => Promise<void>;
  remove: (item: { id: string; name: string }) => Promise<void>;
  /** `true` si la suppression a été lancée (la sélection est alors vidée). */
  bulkRemove: (ids: string[]) => Promise<boolean>;
};

export function useCatalogueActions(
  kind: CatalogueKind,
  { reload, removeLocal }: { reload: () => void; removeLocal: (ids: string[]) => void },
): CatalogueActions {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const w = WORDING[kind];
  const base = `/api/tenant/catalogue/${kind}`;

  const duplicate = async (item: { id: string }) => {
    try {
      const created = await api.post<{ id: string }>(`${base}/${item.id}/duplicate`, {});
      toast.success(w.duplicated);
      if (created?.id) router.push(`/admin/catalogue/${kind}/${created.id}`);
      else reload();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la duplication."));
    }
  };

  const remove = async (item: { id: string; name: string }) => {
    const ok = await confirm({
      title: w.deleteTitle,
      description: w.deleteDescription(item.name),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`${base}/${item.id}`);
      removeLocal([item.id]);
      toast.success(w.deleted);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        toast.error(body?.error ?? w.inUse);
      } else {
        toast.error(getApiErrorMessage(e, "Échec de la suppression."));
      }
    }
  };

  const bulkRemove = async (ids: string[]) => {
    if (ids.length === 0) return false;
    const ok = await confirm({
      title: w.bulkTitle(ids.length),
      description: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return false;
    try {
      const res = await api.post<{ deleted: number; failed: { id: string; reason: string }[] }>(
        `${base}/bulk-delete`,
        { ids },
      );
      const deleted = res?.deleted ?? 0;
      const failed = res?.failed ?? [];
      if (failed.length === 0) {
        toast.success(w.bulkDeleted(deleted));
      } else {
        const detail = w.bulkReasons && failed.length <= 3 ? ` (${failed.map((f) => f.reason).join(" · ")})` : "";
        toast.info(`${deleted} supprimé${s(deleted)}, ${failed.length} échec${s(failed.length)}${detail}.`);
      }
      reload();
      return true;
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la suppression groupée."));
      return false;
    }
  };

  return { duplicate, remove, bulkRemove };
}

/**
 * Sélection multiple d'une liste filtrée (`useRowSelection` d'arkyo : Maj
 * pour une plage, glisser sur les coches, Échap pour vider) et sa
 * suppression en lot. Sans droit
 * d'écriture, rien n'est sélectionnable.
 */
export function useListSelection(
  filtered: readonly { id: string }[],
  canWrite: boolean,
  actions: CatalogueActions,
) {
  const ids = useMemo(() => (canWrite ? filtered.map((it) => it.id) : []), [filtered, canWrite]);
  const selection = useRowSelection(ids);
  const { onCheckboxClick, onDragStart, onDragEnter } = selection;
  // Gestes des coches (clic, glisser), stables : les lignes mémoïsées ne sont pas redessinées.
  const checks = useMemo<RowCheckHandlers>(
    () => ({ onClick: onCheckboxClick, onDragStart, onDragEnter }),
    [onCheckboxClick, onDragStart, onDragEnter],
  );
  const bulkDelete = async () => {
    if (await actions.bulkRemove(Array.from(selection.selected))) selection.clear();
  };
  return { selection, checks, bulkDelete, total: ids.length };
}
