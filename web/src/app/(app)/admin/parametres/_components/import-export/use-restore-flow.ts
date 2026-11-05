"use client";

import { useCallback, useState } from "react";

import { useToast } from "@/components/ui/toast";
import { api, getApiErrorMessage } from "@/lib/api-client";
import type {
  ArkyoBackup,
  BackupSectionKey,
  RestoreMode,
  RestoreReport,
} from "@/lib/services/backup";

/** État du mini-parcours de restauration, superposé au hub. */
export type RestoreStep = "idle" | "verify" | "report";

export type RestoreModes = Partial<Record<BackupSectionKey, RestoreMode>>;

export function useRestoreFlow() {
  const toast = useToast();
  const [step, setStep] = useState<RestoreStep>("idle");
  const [backup, setBackup] = useState<ArkyoBackup | null>(null);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const [busy, setBusy] = useState(false);

  const openVerify = useCallback((b: ArkyoBackup) => {
    setBackup(b);
    setReport(null);
    setStep("verify");
  }, []);

  const cancel = useCallback(() => {
    setBackup(null);
    setReport(null);
    setStep("idle");
  }, []);

  const submit = useCallback(
    async (modes: RestoreModes) => {
      if (!backup) return;
      setBusy(true);
      try {
        const res = await api.post<{ report: RestoreReport }>(
          "/api/tenant/parametres/backup/restore",
          { modes, backup },
        );
        setReport(res.report);
        setStep("report");
        toast.success("Restauration terminée.");
      } catch (err) {
        toast.error(getApiErrorMessage(err, "Restauration impossible."));
      } finally {
        setBusy(false);
      }
    },
    [backup, toast],
  );

  return { step, backup, report, busy, openVerify, cancel, submit };
}
