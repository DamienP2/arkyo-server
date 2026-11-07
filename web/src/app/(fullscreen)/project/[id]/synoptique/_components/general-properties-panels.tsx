"use client";

/**
 * Panneaux de propriétés pour la vue Générale du synoptique projet.
 *
 * - GeneralRackPropertiesPanel : affichage simple d'un rack sélectionné
 *   (nom, type, nb marques externes, bouton "Ouvrir ce rack").
 * - GeneralConnectionPropertiesPanel : connexion ProjectConnection inter-rack
 *   (source rack/équipement/port → cible rack/équipement/port, supprimer).
 *
 * Ces panneaux sont plus simples que ceux du rack focus : pas de longueur
 * estimée, pas de style de tracé, pas d'historique d'adapter hop, pas de
 * numérotation manuelle. Ils visent la parité d'expérience minimale.
 */

import { Trash2, ArrowRight, ExternalLink } from "@/components/ui/icons";
import { SectionTitle, ActionButton } from "@/components/synoptique/components/property-patterns";

// ── Types exposées ──────────────────────────────────────────────────────────

/**
 * Bloc sélectionné en vue Générale : un emplacement (cas nominal) ou un
 * contenant sans lieu (« À affecter »). Le nom historique du type est conservé
 * pour ne pas propager un rename dans tout le tab-client.
 */
export type GeneralRackSelection = {
  id: string;
  name: string;
  /** Défaut `"rack"` (compat avec les appels antérieurs). */
  kind?: "location" | "rack";
  rackType?: string;
  totalU?: number | null;
  /** Emplacement : code court de numérotation. */
  cableCode?: string | null;
  /** Emplacement : nombre de contenants rattachés. */
  containerCount?: number | null;
  externalConnectorsCount: number;
};

export type GeneralConnectionSelection = {
  id: string;
  label: string | null;
  color: string | null;
  /** Nom du signal résolu (HD-SDI, AES…) — pris depuis le port source en
   * priorité, fallback target. Null si aucun des deux ports n'a de signal. */
  signalName: string | null;
  /** Style de tracé persisté côté ProjectConnection. Null = défaut (ortho). */
  cableStyle: "ortho" | "rounded" | "arrow" | null;
  from: {
    rackName: string;
    equipmentName: string | null;
    portLabel: string;
  };
  to: {
    rackName: string;
    equipmentName: string | null;
    portLabel: string;
  };
};

const RACK_TYPE_LABEL: Record<string, string> = {
  STANDARD: 'Baie 19"',
  FLIGHT_CASE_CLASSIC: "Flight case",
  FLIGHT_CASE_SKB: "SKB",
  PELICAN: "Pelicase",
  CAP: "Mobilier",
};

// ── Rack panel ──────────────────────────────────────────────────────────────

export function GeneralRackPropertiesPanel({
  rack,
  onOpen,
}: {
  rack: GeneralRackSelection;
  /**
   * Ouvre la vue dédiée au bloc. Non fourni pour un contenant « À affecter » :
   * la vue focus par contenant n'existe plus (phase 3) → la section Actions
   * n'est alors pas rendue.
   */
  onOpen?: (blockId: string) => void;
}) {
  const isLocation = rack.kind === "location";
  const subtitle = isLocation
    ? [
        rack.cableCode?.trim() || null,
        rack.containerCount != null
          ? `${rack.containerCount} contenant${rack.containerCount > 1 ? "s" : ""}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : [
        rack.rackType ? (RACK_TYPE_LABEL[rack.rackType] ?? rack.rackType) : null,
        rack.totalU != null ? `${rack.totalU}U` : null,
      ]
        .filter(Boolean)
        .join(" · ");
  return (
    <div className="flex flex-col gap-4 text-xs">
      <div>
        <SectionTitle>{isLocation ? "Emplacement" : "Contenant"}</SectionTitle>
        <div
          className="text-foreground text-sm font-semibold"
          style={{ wordBreak: "break-word" }}
        >
          {rack.name}
        </div>
        {subtitle ? (
          <div
            className="text-muted-foreground mt-0.5 text-[11px]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>

      <div>
        <SectionTitle>Marques externes</SectionTitle>
        <div
          className="border-border/60 rounded-md border bg-transparent p-2.5"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          <div className="text-sm font-semibold">
            {rack.externalConnectorsCount}
            <span className="text-muted-foreground text-[11px] font-normal">
              {" "}
              port{rack.externalConnectorsCount > 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {onOpen && (
        <div>
          <SectionTitle>Actions</SectionTitle>
          <ActionButton
            icon={<ExternalLink className="h-3.5 w-3.5" />}
            label="Ouvrir cet emplacement"
            onClick={() => onOpen(rack.id)}
          />
        </div>
      )}
    </div>
  );
}

// ── Connection panel ────────────────────────────────────────────────────────

export function GeneralConnectionPropertiesPanel({
  connection,
  onSetStyle,
  onDelete,
}: {
  connection: GeneralConnectionSelection;
  /** Change le style de tracé. Si absent, la section Style du tracé n'est pas
   *  affichée (le panneau reste passif). */
  onSetStyle?: (id: string, style: "ortho" | "rounded" | "arrow") => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4 text-xs">
      <div>
        <SectionTitle>Câble inter-contenant</SectionTitle>
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
            style={{ background: connection.color ?? "#71717a" }}
          />
          <div
            className="text-foreground text-sm font-semibold"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {connection.label ?? "—"}
          </div>
        </div>
        {connection.signalName && (
          <div
            className="mt-1 text-[11px]"
            style={{
              color: connection.color ?? "var(--muted-foreground)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {connection.signalName}
          </div>
        )}
      </div>

      <div>
        <SectionTitle>Parcours</SectionTitle>
        <div className="border-border/60 flex flex-col gap-2 rounded-md border bg-transparent p-2.5">
          <div>
            <div className="text-muted-foreground text-[10px] tracking-[0.1em] uppercase">
              Source
            </div>
            <div className="truncate text-[12px] font-medium">
              {connection.from.rackName}
            </div>
            {connection.from.equipmentName && (
              <div className="text-muted-foreground mt-0.5 truncate text-[10px]">
                {connection.from.equipmentName}
              </div>
            )}
            <div
              className="text-muted-foreground mt-0.5 text-[10px]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {connection.from.portLabel}
            </div>
          </div>
          <div className="text-muted-foreground flex items-center justify-center">
            <ArrowRight className="h-3 w-3" />
          </div>
          <div>
            <div className="text-muted-foreground text-[10px] tracking-[0.1em] uppercase">
              Cible
            </div>
            <div className="truncate text-[12px] font-medium">
              {connection.to.rackName}
            </div>
            {connection.to.equipmentName && (
              <div className="text-muted-foreground mt-0.5 truncate text-[10px]">
                {connection.to.equipmentName}
              </div>
            )}
            <div
              className="text-muted-foreground mt-0.5 text-[10px]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {connection.to.portLabel}
            </div>
          </div>
        </div>
      </div>

      {/* Style du tracé — réutilise le pattern segmented des panneaux rack
          focus (cohérence visuelle). Affiché seulement si un handler est
          fourni (le panneau reste passif sinon). Modèle (catalogCableModel)
          non exposé en mode général : pas encore supporté côté API/canvas
          adapter (allowed list dans general-canvas). */}
      {onSetStyle && (
        <div>
          <SectionTitle>Style du tracé</SectionTitle>
          <div className="border-border bg-card flex items-center gap-0.5 rounded-md border p-0.5">
            {(
              [
                { id: "ortho", label: "Orthogonal" },
                { id: "rounded", label: "Arrondi" },
                { id: "arrow", label: "Flèches" },
              ] as const
            ).map((s) => {
              const active = (connection.cableStyle ?? "ortho") === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSetStyle(connection.id, s.id)}
                  className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-all active:scale-95 ${active ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]" : "text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]"}`} // arkyo-server: habillage Strata (accent sur l'accent à 10 % : --accent-strong)
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <SectionTitle>Actions</SectionTitle>
        <ActionButton
          icon={<Trash2 className="h-3.5 w-3.5" />}
          label="Supprimer le câble"
          onClick={() => onDelete(connection.id)}
          danger
        />
      </div>
    </div>
  );
}
