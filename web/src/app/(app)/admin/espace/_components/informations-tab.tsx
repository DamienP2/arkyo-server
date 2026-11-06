"use client";

/**
 * InformationsTab — onglet unique « Informations » de la page Espace.
 *
 * Layout multi-colonnes :
 *   - Rangée haute : Identité (large, éditable) + Détails (étroit, lecture seule)
 *   - Zone dangereuse : Purge des référentiels + Suppression de l'espace (2 col.)
 *
 * arkyo-server: Détails ne garde que l'adresse (celle du serveur local, à la
 * place du sous-domaine arkyo.app) ; plan, statut et date de création (SaaS)
 * sont retirés, comme la suppression de l'espace (décision 9).
 *
 * Panels compacts à en-tête iconé (icône tintée + titre), cohérents avec le
 * reste de l'application.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
// arkyo-server: date-fns retiré (date de création de l'espace, SaaS)
import {
  AlertTriangle,
  Building2,
  CheckCircle,
  Eraser,
  Globe,
  Info,
  Loader2,
  Save,
  Trash2,
} from "@/components/ui/icons"; // arkyo-server: Activity, Calendar, CreditCard retirés (plan, statut, création)

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
// arkyo-server: Dialog retiré (demande de suppression de l'espace, SaaS)
import { ImageUpload } from "@/components/ui/image-upload";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { AdminTabLayout } from "../../_components/admin-tab-layout";
import type { EspaceTenant } from "../espace-client";

// arkyo-server: PLAN_LABEL, STATUS_LABEL et STATUS_COLOR retirés (plan et
// statut de l'espace, SaaS).

const schema = z.object({
  name: z.string().min(1, "Le nom est requis").max(200),
  logoUrl: z.string().nullable(),
});

type FormValues = z.infer<typeof schema>;

// ── Panel (carte à en-tête iconé compact) ────────────────────────────────────

function Panel({
  icon: Icon,
  title,
  tone = "default",
  className,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tone?: "default" | "danger";
  className?: string;
  children: React.ReactNode;
}) {
  const danger = tone === "danger";
  return (
    <Card className={cn("overflow-hidden", danger && "border-[var(--destructive)]/30", className)}>
      <div className="flex items-center gap-2.5 border-b border-[var(--border)]/60 px-4 py-3">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            danger
              ? "bg-[var(--destructive)]/10 text-[var(--danger-text)]" // arkyo-server: habillage Strata
              : "bg-[var(--accent)]/10 text-[var(--accent)]",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h3
          className={cn(
            "text-sm font-semibold leading-tight",
            danger && "text-[var(--danger-text)]", // arkyo-server: habillage Strata
          )}
        >
          {title}
        </h3>
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

function MetaItem({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--border)]/50 bg-[var(--secondary)]/30 px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--card)] text-[var(--muted-foreground)]">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-bold tracking-wider text-[var(--muted-foreground)]/70 uppercase">
          {label}
        </p>
        <div className="mt-0.5 truncate text-sm font-medium text-[var(--foreground)]">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Composant principal ──────────────────────────────────────────────────────

type Props = {
  tenant: EspaceTenant;
  isOwner: boolean;
};

export function InformationsTab({ tenant, isOwner }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [tenantState, setTenantState] = useState(tenant);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: tenantState.name, logoUrl: tenantState.logoUrl },
  });

  useEffect(() => {
    form.reset({ name: tenantState.name, logoUrl: tenantState.logoUrl });
  }, [tenantState.id, tenantState.name, tenantState.logoUrl, form]);

  const {
    handleSubmit,
    register,
    watch,
    setValue,
    formState: { errors, isDirty, isSubmitting },
  } = form;

  const logoUrl = watch("logoUrl") ?? "";

  const onSubmit = handleSubmit(async (values) => {
    try {
      const updated = await api.patch<{
        id: string;
        name: string;
        logoUrl: string | null;
      }>("/api/tenant/espace/informations", { // arkyo-server: ni slug, ni statut, ni plan (SaaS)
        name: values.name,
        logoUrl: values.logoUrl === "" ? null : values.logoUrl,
      });
      setTenantState((prev) => ({ ...prev, ...updated }));
      toast.success("Informations enregistrées");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string } | null;
        toast.error(body?.error ?? "Échec de l'enregistrement");
      } else {
        toast.error("Erreur réseau");
      }
    }
  });

  // arkyo-server: date de création et couleur de statut retirées (SaaS).

  return (
    <AdminTabLayout
      toolbar={
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold leading-tight">
              Informations de l&apos;espace
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Identité, paramètres et gestion de votre organisation.
            </p>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {!isOwner && (
          <p className="text-xs italic text-[var(--muted-foreground)]">
            Lecture seule — réservé au propriétaire de l&apos;espace.
          </p>
        )}

        {/* ── Identité (large) + Détails (étroit) ── */}
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <form onSubmit={onSubmit} className="lg:col-span-2">
            <Panel icon={Building2} title="Identité">
              <div className="space-y-5">
                <ImageUpload
                  previewSize="lg"
                  value={logoUrl ?? ""}
                  onChange={(url) =>
                    setValue("logoUrl", url === "" ? null : url, { shouldDirty: true })
                  }
                  folder="tenant-logos"
                  label="Logo de l'espace"
                />

                <div className="space-y-2">
                  <label
                    htmlFor="tenant-name"
                    className="text-xs font-medium text-[var(--muted-foreground)]"
                  >
                    Nom de l&apos;espace
                  </label>
                  <Input
                    id="tenant-name"
                    {...register("name")}
                    disabled={!isOwner || isSubmitting}
                    placeholder="Acme Broadcast"
                  />
                  {errors.name?.message && (
                    // arkyo-server: habillage Strata
                    <p className="text-[11px] text-[var(--danger-text)]">
                      {errors.name.message}
                    </p>
                  )}
                </div>

                {isOwner && isDirty && (
                  <div className="flex justify-end gap-2 border-t border-[var(--border)]/60 pt-4">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        form.reset({
                          name: tenantState.name,
                          logoUrl: tenantState.logoUrl,
                        })
                      }
                      disabled={isSubmitting}
                    >
                      Annuler
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? (
                        <>
                          <Loader2 className="animate-spin" />
                          Enregistrement…
                        </>
                      ) : (
                        <>
                          <Save />
                          Enregistrer
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </Panel>
          </form>

          <Panel icon={Info} title="Détails" className="lg:col-span-1">
            <div className="space-y-2.5">
              <MetaItem icon={Globe} label="Adresse">
                <span className="font-mono tabular-nums">
                  {/* arkyo-server: adresse du serveur local (pas de sous-domaine arkyo.app) */}
                  {window.location.host}
                </span>
              </MetaItem>
              {/* arkyo-server: Plan, Statut et Créé le retirés (SaaS) */}
            </div>
          </Panel>
        </div>

        {/* ── Zone dangereuse ── */}
        <div>
          <div className="mb-4 flex items-center gap-2.5">
            {/* arkyo-server: habillage Strata */}
            <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--danger-text)]" />
            {/* arkyo-server: habillage Strata */}
            <h3 className="text-xs font-bold tracking-widest text-[var(--danger-text)] uppercase">
              Zone dangereuse
            </h3>
            <div className="h-px flex-1 bg-[var(--destructive)]/20" />
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <PurgeCard />
            {/* arkyo-server: « Supprimer mon espace » retiré (décision 9, SaaS) */}
          </div>
        </div>
      </div>
    </AdminTabLayout>
  );
}

// ── Zone dangereuse : purge des référentiels ─────────────────────────────────

const PURGE_ITEMS = [
  { target: "equipment", label: "Équipements" },
  { target: "adapters", label: "Adaptateurs" },
  { target: "brands", label: "Fabricants" },
  { target: "connectors", label: "Connecteurs" },
  { target: "signals", label: "Signaux" },
  { target: "signal-categories", label: "Catégories de signaux" },
  { target: "categories", label: "Catégories d'équip." },
  { target: "symbols", label: "Symboles" },
];

function PurgeCard() {
  const confirmDialog = useConfirm();
  const toast = useToast();
  const [purging, setPurging] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const handlePurge = async (target: string, label: string) => {
    const ok = await confirmDialog({
      title: `Vider "${label}" ?`,
      description:
        "Tous les éléments de ce type seront supprimés. Cette action est irréversible.",
      confirmLabel: "Vider",
      variant: "destructive",
    });
    if (!ok) return;
    setPurging(target);
    try {
      await api.post("/api/admin/purge", { target });
      setDone(target);
      setTimeout(() => setDone((d) => (d === target ? null : d)), 2000);
    } catch (err) {
      toast.error(err instanceof ApiError ? "Échec de la purge" : "Erreur réseau");
    } finally {
      setPurging(null);
    }
  };

  const handlePurgeAll = async () => {
    const ok = await confirmDialog({
      title: "Vider tous les référentiels ?",
      description:
        // arkyo-server: catalogue unique — les référentiels de départ sont réinstallés (décision 9)
        "Équipements, signaux, connecteurs, marques, catégories, adaptateurs et symboles seront supprimés. Les projets et racks sont conservés. Les référentiels de départ sont ensuite réinstallés.",
      confirmLabel: "Tout vider",
      variant: "destructive",
    });
    if (!ok) return;
    setPurging("all");
    try {
      await api.post("/api/admin/purge", { target: "all" });
      setDone("all");
      setTimeout(() => setDone((d) => (d === "all" ? null : d)), 2000);
    } catch (err) {
      toast.error(err instanceof ApiError ? "Échec de la purge" : "Erreur réseau");
    } finally {
      setPurging(null);
    }
  };

  return (
    <Panel icon={Eraser} title="Vider les référentiels">
      <p className="mb-3 text-xs leading-snug text-[var(--muted-foreground)]">
        Supprime vos éléments personnels (équipements, cordons, adaptateurs…). Les
        projets et racks sont conservés.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {PURGE_ITEMS.map((item) => {
          const isLoading = purging === item.target;
          const isDone = done === item.target;
          return (
            <button
              key={item.target}
              type="button"
              onClick={() => void handlePurge(item.target, item.label)}
              disabled={purging !== null}
              className="group flex items-center justify-between gap-2 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] px-2.5 py-2 text-left transition-colors hover:border-[var(--destructive)]/40 hover:bg-[var(--destructive)]/5 disabled:opacity-50"
            >
              <span className="truncate text-xs text-[var(--foreground)]">
                {item.label}
              </span>
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--muted-foreground)]" />
              ) : isDone ? (
                <CheckCircle className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" /> // arkyo-server: habillage Strata
              ) : (
                <Trash2 className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]/40 transition-colors group-hover:text-[var(--destructive)]" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex justify-end border-t border-[var(--border)]/60 pt-3">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => void handlePurgeAll()}
          disabled={purging !== null}
        >
          {purging === "all" ? (
            <>
              <Loader2 className="animate-spin" />
              Suppression…
            </>
          ) : done === "all" ? (
            <>
              <CheckCircle />
              Terminé
            </>
          ) : (
            <>
              <Trash2 />
              Tout vider
            </>
          )}
        </Button>
      </div>
    </Panel>
  );
}

// ── Zone dangereuse : suppression de l'espace ────────────────────────────────

// arkyo-server: DeletionCard, OwnerOnlyCard et DeletionDialog retirés — la
// suppression de l'espace était une demande à l'équipe Arkyo (SaaS, décision 9).
