"use client";

/**
 * Gérer › Fiche (spec v2 §4.2) : la fiche du projet et ce qui s'y rattache,
 * en onglets :
 *   - Informations : champs de la fiche (`ProjectFicheData`) ; « Modifier les
 *     caractéristiques » ouvre le dialogue existant d'arkyo
 *     (`ProjectCharacteristicsDialog`, monté par l'éditeur), seul chemin
 *     d'édition de la fiche en Classique ;
 *   - Équipe : arkyo n'a pas d'équipe par projet, seul le créateur est
 *     désigné (`createdById` de `GET /api/tenant/projects/{id}`, nommé par
 *     `GET /api/tenant/members?inactive=1`) ;
 *   - Tâches, Messages : comptes en lecture (aucune route de modification) ;
 *   - Documents : liste en lecture ;
 *   - Journal : l'historique du projet d'arkyo (`AuditPanelContent`).
 */

import { useEffect, useState } from "react";
import { ClipboardList, FileText, MessageSquare, Settings2, Users } from "@/components/ui/icons";
import { AuditPanelContent } from "@/components/synoptique/components/audit-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { api } from "@/lib/api-client";
import { INTERVENTION_LABEL, RIG_LABEL, fmtDay, plural } from "./format";
import { safeDocumentHref } from "../safe-href";
import { Box, Kv, PageHead, Pill, SMALL_BTN, TabPanel, Tabs, useTabIds } from "./manage-ui";
import { missingFicheFields } from "./todo-model";
import type { ManageState } from "./use-manage";

type FicheTab = "infos" | "equipe" | "taches" | "messages" | "documents" | "journal";

const range = (a: string | null, b: string | null) => {
  const from = fmtDay(a);
  const to = fmtDay(b);
  if (from && to) return `du ${from} au ${to}`;
  return from ?? to ?? "—";
};

function size(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

export function FichePage({ data, onEditCharacteristics }: { data: ManageState; onEditCharacteristics: () => void }) {
  const { fiche } = data;
  const [tab, setTab] = useState<FicheTab>("infos");
  const idBase = useTabIds();
  const prestation = fiche.interventionType === "PRESTATION";
  const missing = missingFicheFields(fiche);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <PageHead
        title="Fiche"
        subtitle={[fiche.clientName, INTERVENTION_LABEL[fiche.interventionType]].filter(Boolean).join(" · ")}
      >
        <Tabs
          label="Fiche du projet"
          idBase={idBase}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "infos", label: "Informations" },
            { id: "equipe", label: "Équipe" },
            { id: "taches", label: "Tâches", count: fiche.counts.tasks },
            { id: "messages", label: "Messages", count: fiche.counts.messages },
            { id: "documents", label: "Documents", count: fiche.documents.length },
            { id: "journal", label: "Journal" },
          ]}
        />
      </PageHead>
      <TabPanel idBase={idBase} value={tab} className="max-w-[1100px] px-6 pt-4 pb-24">
        {tab === "infos" && (
          <Box
            title="Informations"
            aside={
              <button type="button" onClick={onEditCharacteristics} className={SMALL_BTN}>
                <Settings2 className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                Modifier les caractéristiques
              </button>
            }
          >
            {missing.length > 0 && (
              <div>
                <Pill tone="warn">{`À compléter : ${missing.join(", ")}`}</Pill>
              </div>
            )}
            <Kv
              rows={[
                ["Nom", fiche.name],
                ["Client", fiche.clientName || "—"],
                ["Lieu", fiche.location || "—"],
                ["Intervention", INTERVENTION_LABEL[fiche.interventionType] ?? fiche.interventionType],
                ["Type de régie", fiche.rigType ? (RIG_LABEL[fiche.rigType] ?? fiche.rigType) : "—"],
                ...(prestation ? ([["Type de prestation", fiche.prestationType || "—"]] as [string, string][]) : []),
                ["Planification", range(fiche.planningStart, fiche.planningEnd)],
                prestation
                  ? ["Tournage", range(fiche.shootingDate, fiche.shootingEndDate)]
                  : ["Mise en service", fmtDay(fiche.commissioningDate) ?? "—"],
                ["Description", fiche.description ? <span className="whitespace-pre-line">{fiche.description}</span> : "—"],
              ]}
            />
          </Box>
        )}
        {tab === "equipe" && <Team projectId={data.projectId} />}
        {tab === "taches" && (
          <Box title="Tâches">
            <EmptyState
              icon={<ClipboardList strokeWidth={1.5} />}
              title={fiche.counts.tasks > 0 ? plural(fiche.counts.tasks, "tâche") : "Aucune tâche"}
            />
          </Box>
        )}
        {tab === "messages" && (
          <Box title="Messages">
            <EmptyState
              icon={<MessageSquare strokeWidth={1.5} />}
              title={fiche.counts.messages > 0 ? plural(fiche.counts.messages, "message") : "Aucun message"}
            />
          </Box>
        )}
        {tab === "documents" && (
          <Box title="Documents" flush>
            {fiche.documents.length === 0 ? (
              <EmptyState icon={<FileText strokeWidth={1.5} />} title="Aucun document" />
            ) : (
              <ul className="m-0 list-none p-0">
                {fiche.documents.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center gap-2.5 border-b border-[var(--border)] px-3.5 py-2.5 text-[12.5px] last:border-b-0"
                  >
                    <FileText aria-hidden className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                    {safeDocumentHref(d.url) ? (
                      <a
                        href={safeDocumentHref(d.url)!}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate font-medium text-[var(--foreground)] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                      >
                        {d.name}
                      </a>
                    ) : (
                      // Adresse non sûre (`javascript:`…) : le nom seul, sans lien.
                      <span className="min-w-0 flex-1 truncate font-medium text-[var(--foreground)]">{d.name}</span>
                    )}
                    <span className="shrink-0 text-[var(--muted-foreground)]">
                      {[size(d.sizeBytes), fmtDay(d.uploadedAt)].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Box>
        )}
        {tab === "journal" && (
          <Box title="Journal" flush>
            <div className="h-[560px]">
              <AuditPanelContent projectId={data.projectId} />
            </div>
          </Box>
        )}
      </TabPanel>
    </div>
  );
}

type Member = { id: string; name: string | null; email: string };

/** Créateur du projet, seul membre qu'un projet d'arkyo désigne. */
function Team({ projectId }: { projectId: string }) {
  const [state, setState] = useState<{ member: Member | null } | "loading" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ createdById?: string | null }>(`/api/tenant/projects/${projectId}`),
      api.get<Member[]>("/api/tenant/members?inactive=1"),
    ])
      .then(([project, members]) => {
        if (cancelled) return;
        setState({ member: members.find((m) => m.id === project.createdById) ?? null });
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <Box title="Équipe" flush>
      {state === "loading" ? (
        <LoadingState className="py-10" />
      ) : state === "error" || !state.member ? (
        <EmptyState icon={<Users strokeWidth={1.5} />} title="Équipe indisponible" />
      ) : (
        <div className="flex items-center gap-3 px-3.5 py-3 text-[12.5px]">
          <span
            aria-hidden
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] text-[12px] font-semibold text-[var(--foreground)]"
          >
            {(state.member.name || state.member.email).slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate font-semibold text-[var(--foreground)]">
              {state.member.name || state.member.email}
            </strong>
            {state.member.name && (
              <span className="block truncate text-[var(--muted-foreground)]">{state.member.email}</span>
            )}
          </span>
          <span className="shrink-0 text-[var(--muted-foreground)]">Créateur du projet</span>
        </div>
      )}
    </Box>
  );
}
