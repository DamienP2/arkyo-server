"use client";

/**
 * Gérer › Câbles, mode tableau (spec v2 §4.2) : numéro, couleur et notes
 * saisis en série dans `TableEditor`, enregistrés par les routes existantes
 * de modification d'un câble, une requête par ligne modifiée
 * (`cableWrites`). Arkyo ne stocke pas de longueur (Ruling 9).
 *
 * `useCablesSave` tient l'enregistrement pour la page, qui le confie aussi au
 * garde des modifications non enregistrées. Une saisie faite pendant un
 * enregistrement n'est pas perdue : seuls les brouillons encore égaux à la
 * valeur enregistrée sont retirés.
 */

import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { RotateCcw, Save } from "@/components/ui/icons";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { Swatch } from "./cable-detail";
import {
  cableCellError,
  cableValue,
  cableWrites,
  type CableDraft,
  type CableField,
  type CableRow,
  type CableWrite,
} from "./cables-model";
import { plural } from "./format";
import { SMALL_BTN } from "./manage-ui";
import { TableEditor, type Drafts, type TableColumn } from "./table-editor";

/** Requêtes d'enregistrement simultanées. */
const SAVE_CONCURRENCY = 4;

const FIELD_OF: Record<string, CableField> = { label: "label", color: "color", notes: "notes" };

/** Exécute les écritures, `SAVE_CONCURRENCY` à la fois ; renvoie les échecs par câble. */
async function runWrites(writes: readonly CableWrite[]): Promise<Map<string, string>> {
  const failed = new Map<string, string>();
  let next = 0;
  const worker = async () => {
    while (next < writes.length) {
      const w = writes[next++];
      try {
        if (w.method === "PATCH") await api.patch(w.url, w.body);
        else await api.post(w.url, w.body);
      } catch (e) {
        for (const id of w.ids) failed.set(id, getApiErrorMessage(e));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SAVE_CONCURRENCY, writes.length) }, worker));
  return failed;
}

/** Retire des brouillons les valeurs enregistrées ; une valeur saisie depuis reste un brouillon. */
export function settleDrafts(current: Drafts, applied: ReadonlyMap<string, CableDraft>): Drafts {
  const next: Drafts = { ...current };
  for (const [id, saved] of applied) {
    const d = current[id];
    if (!d) continue;
    const rest = { ...d };
    for (const [k, v] of Object.entries(saved)) if (rest[k] === v) delete rest[k];
    if (Object.keys(rest).length) next[id] = rest;
    else delete next[id];
  }
  return next;
}

export type CablesSave = {
  /** Lignes modifiées (brouillons sur des câbles connus). */
  pending: number;
  /** Lignes dont une saisie est invalide. */
  errors: number;
  saving: boolean;
  failure: string | null;
  /** Enregistre ; `true` si tout est passé. */
  save: () => Promise<boolean>;
  discard: () => void;
};

export function useCablesSave({
  rows,
  projectId,
  canEdit,
  drafts,
  setDrafts,
  onSaved,
}: {
  rows: readonly CableRow[] | null;
  projectId: string;
  canEdit: (r: CableRow) => boolean;
  drafts: Drafts;
  setDrafts: Dispatch<SetStateAction<Drafts>>;
  onSaved: (applied: Map<string, CableDraft>) => void;
}): CablesSave {
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r])), [rows]);
  // Dernier état, pour un enregistrement lancé depuis le garde de navigation.
  const latest = useRef({ drafts, byId, canEdit, onSaved });
  latest.current = { drafts, byId, canEdit, onSaved };

  const entries = Object.entries(drafts).filter(([id]) => byId.has(id));
  const errors = entries.filter(([id, d]) =>
    Object.entries(d).some(([k, v]) => FIELD_OF[k] && cableCellError(byId.get(id)!, FIELD_OF[k], v)),
  ).length;

  const save = useCallback(async () => {
    const { drafts: snapshot, byId: rowsById, canEdit: allowed, onSaved: saved } = latest.current;
    const edits = Object.entries(snapshot)
      .filter(([id]) => rowsById.has(id))
      .map(([id, d]) => ({ row: rowsById.get(id)!, draft: { ...d } as CableDraft }))
      .filter((e) => allowed(e.row));
    setSaving(true);
    setFailure(null);
    const failed = await runWrites(cableWrites(edits, projectId));
    const applied = new Map<string, CableDraft>();
    for (const e of edits) if (!failed.has(e.row.id)) applied.set(e.row.id, e.draft);
    // Mise à jour fonctionnelle : une saisie faite pendant l'enregistrement reste.
    setDrafts((cur) => settleDrafts(cur, applied));
    saved(applied);
    setSaving(false);
    if (failed.size > 0) {
      const [first] = failed.values();
      setFailure(`${plural(failed.size, "ligne")} non enregistrée${failed.size > 1 ? "s" : ""} : ${first}`);
      return false;
    }
    return true;
  }, [projectId, setDrafts]);

  const discard = useCallback(() => {
    setDrafts({});
    setFailure(null);
  }, [setDrafts]);

  return { pending: entries.length, errors, saving, failure, save, discard };
}

export function CablesTable({
  rows,
  firstIndex,
  canEdit,
  drafts,
  onDraftsChange,
  saver,
}: {
  rows: readonly CableRow[];
  firstIndex: number;
  canEdit: (r: CableRow) => boolean;
  drafts: Drafts;
  onDraftsChange: (d: Drafts) => void;
  saver: CablesSave;
}) {
  const columns = useMemo<TableColumn<CableRow>[]>(() => {
    const field = (f: CableField) => ({
      get: (r: CableRow) => cableValue(r, f),
      editable: true,
      validate: (v: string, r: CableRow) => cableCellError(r, f, v),
    });
    return [
      { key: "label", title: "N°", width: "120px", mono: true, ...field("label") },
      { key: "from", title: "De", get: (r) => r.from.name },
      { key: "to", title: "Vers", get: (r) => r.to.name },
      { key: "type", title: "Type", width: "14%", get: (r) => r.type },
      {
        key: "color",
        title: "Couleur",
        width: "120px",
        mono: true,
        ...field("color"),
        render: (v) =>
          v ? (
            <span className="inline-flex items-center gap-1.5">
              <Swatch color={v} />
              {v}
            </span>
          ) : (
            ""
          ),
      },
      { key: "notes", title: "Notes", width: "22%", ...field("notes") },
    ];
  }, []);

  const { pending, errors, saving, failure, save, discard } = saver;

  return (
    <>
      {failure && (
        <p role="alert" className="m-0 mb-2 text-[12.5px] text-[var(--danger-text)]">
          {failure}
        </p>
      )}
      <TableEditor
        label="Câbles"
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        canEdit={canEdit}
        drafts={drafts}
        onDraftsChange={onDraftsChange}
        firstIndex={firstIndex}
        toolbar={
          <>
            {pending > 0 && (
              <span className="text-[var(--muted-foreground)]">{plural(pending, "ligne modifiée", "lignes modifiées")}</span>
            )}
            <button type="button" onClick={discard} disabled={pending === 0 || saving} className={SMALL_BTN}>
              <RotateCcw className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              Annuler les modifications
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={pending === 0 || saving || errors > 0}
              className={SMALL_BTN}
            >
              <Save className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </>
        }
      />
    </>
  );
}
