/**
 * Rack validation — cohérence BOM + graphe de câblage.
 *
 * Logique pure : reçoit un snapshot du rack (slots + connexions + adaptateurs
 * + signaux) et retourne une liste d'issues classées par sévérité. Aucun
 * accès Prisma / I/O. Les consumers (UI synoptique, API) composent l'input.
 */

export type IssueSeverity = "error" | "warning" | "info";

export type IssueKind =
  | "missing_slot"
  | "missing_port"
  | "duplicate_label"
  | "port_overused"
  | "signal_mismatch"
  | "unlabelled_cable"
  | "empty_slot"
  | "orphan_adapter"
  | "unnamed_zone"
  | "panel_unused"
  | "panel_partial"
  | "equipment_unused"
  | "empty_zone";

export type ValidationIssue = {
  id: string; // unique dans le rapport
  severity: IssueSeverity;
  kind: IssueKind;
  /** Nom court de l'élément concerné (slot, panel, câble label…) à afficher en gras. */
  subject?: string;
  message: string;
  /** Référence(s) pour permettre à l'UI de sélectionner l'élément fautif. */
  refs: {
    connectionIds?: string[];
    slotIds?: string[];
    adapterIds?: string[];
    zoneIds?: string[];
  };
};

export type ValidationInput = {
  slots: Array<{
    id: string;
    label: string | null;
    equipmentId: string | null;
    /** Si le slot représente une rangée de panel (virtuel), id du panel parent. */
    panelId?: string | null;
    /** Nom du panel (si applicable). */
    panelName?: string | null;
    /** ID unique de l'instance (rack slot réel parent). Permet de distinguer 2 panels du même type. */
    parentSlotId?: string | null;
    // connecteurs exposés (index → signalName/direction pour matching)
    ports: Array<{
      index: number;
      signalName: string | null;
      direction: string | null;
      /** Nom du type de connecteur (ex. "BNC", "XLR") pour check de compatibilité physique. */
      connectorTypeName?: string | null;
      /** Catégorie/famille du connecteur (ex. "Vidéo", "Audio") — alternative au signal. */
      connectorCategory?: string | null;
    }>;
  }>;
  connections: Array<{
    id: string;
    label: string | null;
    fromSlotId: string;
    fromConnectorIndex: number | null;
    toSlotId: string;
    toConnectorIndex: number | null;
  }>;
  adapters: Array<{
    id: string;
    /** Nom de l'adaptateur. */
    name?: string | null;
    /** Slot équipement auquel l'adaptateur est attaché. */
    attachedSlotId?: string | null;
    /** Nombre de connexions référençant cet adaptateur (via fromSlotId/toSlotId virtuels). */
    connectionCount: number;
  }>;
  zones: Array<{
    id: string;
    label: string | null;
    bounds?: { x: number; y: number; w: number; h: number } | null;
  }>;
  /**
   * Connexions externes (port marqué « sortie / entrée externe »). Comptées
   * comme câbles pour la validation : `unlabelled_cable` si label manquant
   * et `port_overused` si le port est simultanément câblé et marqué externe.
   *
   * `targetCableLabel` = label de la `ProjectConnection` correspondante (vue
   * GENERAL). Un ExternalPort est considéré « labellé » si soit `label`
   * (local), soit `targetCableLabel` (GENERAL) est défini.
   */
  externalPorts?: Array<{
    id: string;
    slotId: string;
    portIndex: number;
    label: string | null;
    targetCableLabel?: string | null;
  }>;
  /** Positions (centre) des slots sur le synoptique, pour détecter les zones vides. */
  slotPositions?: Map<string, { x: number; y: number }>;
  /**
   * Signaux par famille. Deux signaux sont "compatibles" s'ils partagent la
   * même famille (categoryName). `null` = famille inconnue → skip check.
   */
  signalFamilyByName: Map<string, string | null>;
  /**
   * Ensemble des noms de signaux taggés IP (`CatalogSignalType.isIp = true`).
   * Quand les deux extrémités d'une connexion sont IP, les checks de
   * compatibilité signal + connecteur sont relâchés (passage présumé par
   * un switch IT/IP qui transporte n'importe quelle essence).
   */
  ipSignalNames?: Set<string>;
};

export type ValidationReport = {
  issues: ValidationIssue[];
  counts: { error: number; warning: number; info: number };
};

export function validateRack(input: ValidationInput): ValidationReport {
  const issues: ValidationIssue[] = [];
  let seq = 0;
  const nextId = () => `iss-${++seq}`;
  const push = (i: Omit<ValidationIssue, "id">) => issues.push({ id: nextId(), ...i });

  const ADAPTER_PREFIX = "__a__:";
  const isAdapterVirtualId = (id: string) => id.startsWith(ADAPTER_PREFIX);
  const adapterById = new Map(input.adapters.map((a) => [a.id, a]));
  const resolveAdapterFromVirtualId = (id: string): { adapterId: string; side: string } | null => {
    if (!id.startsWith(ADAPTER_PREFIX)) return null;
    const rest = id.slice(ADAPTER_PREFIX.length);
    const i = rest.lastIndexOf(":");
    if (i < 0) return null;
    return { adapterId: rest.slice(0, i), side: rest.slice(i + 1) };
  };

  const slotById = new Map(input.slots.map((s) => [s.id, s]));
  const slotName = (id: string) => {
    if (isAdapterVirtualId(id)) {
      const parsed = resolveAdapterFromVirtualId(id);
      if (parsed) {
        const a = adapterById.get(parsed.adapterId);
        if (a?.name) return `${a.name} (adapt.)`;
      }
      return "un adaptateur";
    }
    return slotById.get(id)?.label ?? "un slot supprimé";
  };
  const cableRef = (c: {
    id: string;
    label: string | null;
    fromSlotId: string;
    toSlotId: string;
  }) => {
    if (c.label) return `« ${c.label} »`;
    return `le câble entre\n• ${slotName(c.fromSlotId)}\n• ${slotName(c.toSlotId)}`;
  };

  // ── Errors ───────────────────────────────────────────────────────────────
  // 1. missing slot / missing port
  for (const c of input.connections) {
    const fromIsAdapter = isAdapterVirtualId(c.fromSlotId);
    const toIsAdapter = isAdapterVirtualId(c.toSlotId);
    const fs = fromIsAdapter ? null : slotById.get(c.fromSlotId);
    const ts = toIsAdapter ? null : slotById.get(c.toSlotId);
    if ((!fs && !fromIsAdapter) || (!ts && !toIsAdapter)) {
      push({
        severity: "error",
        kind: "missing_slot",
        subject: c.label ?? undefined,
        message:
          "Un câble pointe vers un équipement/panel qui a été supprimé. Supprimer le câble ou reconnecter son extrémité.",
        refs: { connectionIds: [c.id] },
      });
      continue;
    }
    const fp =
      !fromIsAdapter && fs && c.fromConnectorIndex != null
        ? fs.ports.find((p) => p.index === c.fromConnectorIndex)
        : undefined;
    const tp =
      !toIsAdapter && ts && c.toConnectorIndex != null
        ? ts.ports.find((p) => p.index === c.toConnectorIndex)
        : undefined;
    if (!fromIsAdapter && c.fromConnectorIndex != null && !fp) {
      push({
        severity: "error",
        kind: "missing_port",
        subject: slotName(c.fromSlotId),
        message: `Port #${c.fromConnectorIndex + 1} introuvable sur cet élément (${cableRef(c)}).`,
        refs: { connectionIds: [c.id], slotIds: [c.fromSlotId] },
      });
    }
    if (!toIsAdapter && c.toConnectorIndex != null && !tp) {
      push({
        severity: "error",
        kind: "missing_port",
        subject: slotName(c.toSlotId),
        message: `Port #${c.toConnectorIndex + 1} introuvable sur cet élément (${cableRef(c)}).`,
        refs: { connectionIds: [c.id], slotIds: [c.toSlotId] },
      });
    }
  }

  // 2. duplicate labels
  const byLabel = new Map<string, string[]>();
  for (const c of input.connections) {
    if (!c.label) continue;
    const arr = byLabel.get(c.label) ?? [];
    arr.push(c.id);
    byLabel.set(c.label, arr);
  }
  for (const [label, ids] of byLabel) {
    if (ids.length > 1) {
      push({
        severity: "error",
        kind: "duplicate_label",
        subject: label,
        message: `Label utilisé par ${ids.length} câbles différents. Renuméroter ou renommer pour lever l'ambiguïté.`,
        refs: { connectionIds: ids },
      });
    }
  }

  // 3. port overused (même (slot, portIndex) connecté plusieurs fois).
  // Les ExternalPorts comptent comme une "connexion" sur le port — un même
  // port ne peut pas être simultanément câblé ET marqué externe.
  const portUse = new Map<string, string[]>();
  for (const c of input.connections) {
    if (c.fromConnectorIndex != null) {
      const k = `${c.fromSlotId}:${c.fromConnectorIndex}`;
      const a = portUse.get(k) ?? [];
      a.push(c.id);
      portUse.set(k, a);
    }
    if (c.toConnectorIndex != null) {
      const k = `${c.toSlotId}:${c.toConnectorIndex}`;
      const a = portUse.get(k) ?? [];
      a.push(c.id);
      portUse.set(k, a);
    }
  }
  for (const ext of input.externalPorts ?? []) {
    const k = `${ext.slotId}:${ext.portIndex}`;
    const a = portUse.get(k) ?? [];
    a.push(ext.id);
    portUse.set(k, a);
  }
  for (const [key, ids] of portUse) {
    if (ids.length > 1) {
      const [slotId, portIdx] = key.split(":");
      push({
        severity: "error",
        kind: "port_overused",
        subject: slotName(slotId),
        message: `Port #${Number(portIdx) + 1} connecté ${ids.length} fois sur ce même élément.`,
        refs: { connectionIds: ids, slotIds: [slotId] },
      });
    }
  }

  // 4. signal mismatch (familles différentes) — skip connections involving adapters
  const ipSignals = input.ipSignalNames ?? new Set<string>();
  for (const c of input.connections) {
    if (isAdapterVirtualId(c.fromSlotId) || isAdapterVirtualId(c.toSlotId)) continue;
    const fs = slotById.get(c.fromSlotId);
    const ts = slotById.get(c.toSlotId);
    if (!fs || !ts) continue;
    const fp =
      c.fromConnectorIndex != null
        ? fs.ports.find((p) => p.index === c.fromConnectorIndex)
        : undefined;
    const tp =
      c.toConnectorIndex != null ? ts.ports.find((p) => p.index === c.toConnectorIndex) : undefined;

    // Règles de compatibilité relâchées :
    // - Deux ports IP : on relâche tout (switch IT entre les deux gère le
    //   multi-essence et la conversion connectique RJ45/SFP/QSFP).
    // - Un port sans signal (switching/transit explicitement non typé dans
    //   l'équipement) : on relâche aussi — il transporte le signal du pair.
    const fSig = fp?.signalName ?? null;
    const tSig = tp?.signalName ?? null;
    const fIp = !!fSig && ipSignals.has(fSig);
    const tIp = !!tSig && ipSignals.has(tSig);
    if (fIp && tIp) continue;
    // « passe-tout » : si l'un des deux ports n'a pas de signal défini, on
    // ne check ni signal ni connecteur.
    if (!fSig || !tSig) continue;

    const sf = fp?.signalName ? input.signalFamilyByName.get(fp.signalName) : null;
    const sg = tp?.signalName ? input.signalFamilyByName.get(tp.signalName) : null;
    if (sf && sg && sf !== sg) {
      push({
        severity: "error",
        kind: "signal_mismatch",
        subject: c.label ?? `${slotName(c.fromSlotId)} ↔ ${slotName(c.toSlotId)}`,
        message: `Signaux incompatibles :\n• ${fp?.signalName ?? "?"} (${sf}) côté ${slotName(c.fromSlotId)}\n• ${tp?.signalName ?? "?"} (${sg}) côté ${slotName(c.toSlotId)}`,
        refs: { connectionIds: [c.id], slotIds: [c.fromSlotId, c.toSlotId] },
      });
      continue;
    }
    // Check connecteur physique : si les types de connecteurs diffèrent
    // (ex. BNC ↔ XLR), on lève aussi une erreur — utile pour panels typés
    // par connecteur où le signal n'est pas renseigné.
    const cf = fp?.connectorTypeName ?? null;
    const cg = tp?.connectorTypeName ?? null;
    if (cf && cg && cf !== cg) {
      push({
        severity: "error",
        kind: "signal_mismatch",
        subject: c.label ?? `${slotName(c.fromSlotId)} ↔ ${slotName(c.toSlotId)}`,
        message: `Connecteurs incompatibles :\n• ${cf} côté ${slotName(c.fromSlotId)}\n• ${cg} côté ${slotName(c.toSlotId)}`,
        refs: { connectionIds: [c.id], slotIds: [c.fromSlotId, c.toSlotId] },
      });
    }
  }

  // ── Warnings ─────────────────────────────────────────────────────────────
  // 5. unlabelled cable — câbles internes ET connexions externes sont
  // comptés (un ExternalPort = 1 câble vers l'extérieur).
  for (const c of input.connections) {
    if (!c.label || c.label.trim() === "") {
      push({
        severity: "warning",
        kind: "unlabelled_cable",
        subject: `${slotName(c.fromSlotId)}\n↔ ${slotName(c.toSlotId)}`,
        message: "Ce câble n'a pas de label. Lancer la renumérotation ou saisir un label manuel.",
        refs: { connectionIds: [c.id], slotIds: [c.fromSlotId, c.toSlotId] },
      });
    }
  }
  for (const ext of input.externalPorts ?? []) {
    // Un ExternalPort est « labellé » si son label local OU son label GENERAL
    // (targetCableLabel — ProjectConnection.label) est défini. Sinon warning.
    const localLabel = ext.label?.trim() ?? "";
    const generalLabel = ext.targetCableLabel?.trim() ?? "";
    if (localLabel === "" && generalLabel === "") {
      push({
        severity: "warning",
        kind: "unlabelled_cable",
        subject: `${slotName(ext.slotId)}\n↔ Externe`,
        message: "Cette connexion externe n'a pas de label. Lancer la renumérotation ou saisir un label manuel.",
        refs: { connectionIds: [ext.id], slotIds: [ext.slotId] },
      });
    }
  }

  // 6. empty slot (pas d'équipement + apparaît dans slots) — exclut panels
  for (const s of input.slots) {
    if (!s.equipmentId && !s.panelId) {
      push({
        severity: "info",
        kind: "empty_slot",
        subject: slotName(s.id),
        message: "Ce slot n'a pas d'équipement assigné.",
        refs: { slotIds: [s.id] },
      });
    }
  }

  // 6a. equipment_unused : équipement placé mais aucun câble branché.
  const slotUsage = new Map<string, number>();
  for (const c of input.connections) {
    // Direct slot usage
    if (c.fromSlotId && !isAdapterVirtualId(c.fromSlotId))
      slotUsage.set(c.fromSlotId, (slotUsage.get(c.fromSlotId) ?? 0) + 1);
    if (c.toSlotId && !isAdapterVirtualId(c.toSlotId))
      slotUsage.set(c.toSlotId, (slotUsage.get(c.toSlotId) ?? 0) + 1);
    // Adapter connections count toward the equipment the adapter is attached to
    const fromAdp = resolveAdapterFromVirtualId(c.fromSlotId);
    const toAdp = resolveAdapterFromVirtualId(c.toSlotId);
    if (fromAdp) {
      const a = input.adapters.find((ad) => ad.id === fromAdp.adapterId);
      if (a?.attachedSlotId)
        slotUsage.set(a.attachedSlotId, (slotUsage.get(a.attachedSlotId) ?? 0) + 1);
    }
    if (toAdp) {
      const a = input.adapters.find((ad) => ad.id === toAdp.adapterId);
      if (a?.attachedSlotId)
        slotUsage.set(a.attachedSlotId, (slotUsage.get(a.attachedSlotId) ?? 0) + 1);
    }
  }
  // Adapter attachments also count as usage
  for (const a of input.adapters) {
    if (a.attachedSlotId)
      slotUsage.set(a.attachedSlotId, (slotUsage.get(a.attachedSlotId) ?? 0) + 1);
  }
  // Connexions externes : un ExternalPort sur un slot compte comme usage de
  // l'équipement (il EST connecté, juste hors-rack).
  for (const ext of input.externalPorts ?? []) {
    slotUsage.set(ext.slotId, (slotUsage.get(ext.slotId) ?? 0) + 1);
  }
  for (const s of input.slots) {
    if (!s.equipmentId || s.panelId) continue;
    if ((slotUsage.get(s.id) ?? 0) === 0) {
      push({
        severity: "info",
        kind: "equipment_unused",
        subject: slotName(s.id),
        message: "Cet équipement est placé dans le rack mais aucun câble n'y est branché.",
        refs: { slotIds: [s.id] },
      });
    }
  }

  // 6b. panels : unused (0 cables) + partial ports (1 cable sur un port qui
  //     devrait être pass-through, donc attendu 2).
  // Groupe par instance de panel (parentSlotId unique) — pas par panelId (modèle)
  // afin de distinguer 2 panels du même type posés sur des slots différents.
  const panelSlotsByInstance = new Map<string, typeof input.slots>();
  for (const s of input.slots) {
    if (!s.panelId) continue;
    const instanceKey = s.parentSlotId ?? s.panelId;
    const arr = panelSlotsByInstance.get(instanceKey) ?? [];
    arr.push(s);
    panelSlotsByInstance.set(instanceKey, arr);
  }
  for (const [, rowSlots] of panelSlotsByInstance) {
    const panelLabel = rowSlots[0]?.panelName ?? "panel";
    // Comptage global d'utilisation du panel
    const rowIds = new Set(rowSlots.map((r) => r.id));
    let panelConnCount = 0;
    for (const c of input.connections) {
      if (rowIds.has(c.fromSlotId) || rowIds.has(c.toSlotId)) panelConnCount += 1;
    }
    if (panelConnCount === 0) {
      push({
        severity: "info",
        kind: "panel_unused",
        subject: panelLabel,
        message: "Aucun câble n'est connecté à ce panel de patch.",
        refs: { slotIds: rowSlots.map((r) => r.id) },
      });
      continue;
    }
    // Pass-through attendu : chaque port physique a 2 côtés (rear/front, indexes
    // consécutifs : pair = rear, impair = front). On regroupe par port physique
    // (floor(idx/2)) et on flagge partiel si exactement 1 côté est câblé.
    const pairHits = new Map<string, number>(); // key = `${slotId}:${physicalPort}`
    for (const c of input.connections) {
      if (c.fromConnectorIndex != null && rowIds.has(c.fromSlotId)) {
        const k = `${c.fromSlotId}:${Math.floor(c.fromConnectorIndex / 2)}`;
        pairHits.set(k, (pairHits.get(k) ?? 0) + 1);
      }
      if (c.toConnectorIndex != null && rowIds.has(c.toSlotId)) {
        const k = `${c.toSlotId}:${Math.floor(c.toConnectorIndex / 2)}`;
        pairHits.set(k, (pairHits.get(k) ?? 0) + 1);
      }
    }
    for (const [key, count] of pairHits) {
      if (count === 1) {
        const [sid, pairIdx] = key.split(":");
        push({
          severity: "warning",
          kind: "panel_partial",
          subject: panelLabel,
          message: `Le port #${Number(pairIdx) + 1} est partiellement connecté (un seul côté câblé).`,
          refs: { slotIds: [sid] },
        });
      }
    }
  }

  // 7. orphan adapters
  for (const a of input.adapters) {
    if (a.connectionCount === 0) {
      push({
        severity: "info",
        kind: "orphan_adapter",
        subject: a.name ?? undefined,
        message: `Un adaptateur est posé mais n'est connecté à aucun câble.`,
        refs: { adapterIds: [a.id] },
      });
    }
  }

  // 8. unnamed zones
  for (const z of input.zones) {
    if (!z.label || z.label.trim() === "") {
      push({
        severity: "info",
        kind: "unnamed_zone",
        message: `Zone sans nom.`,
        refs: { zoneIds: [z.id] },
      });
    }
  }

  // 9. empty zones : zone dessinée sans slot à l'intérieur.
  if (input.slotPositions) {
    for (const z of input.zones) {
      if (!z.bounds) continue;
      const { x, y, w, h } = z.bounds;
      let contains = false;
      for (const [, pos] of input.slotPositions) {
        if (pos.x >= x && pos.x <= x + w && pos.y >= y && pos.y <= y + h) {
          contains = true;
          break;
        }
      }
      if (!contains) {
        push({
          severity: "info",
          kind: "empty_zone",
          subject: z.label ?? undefined,
          message: "Cette zone ne contient aucun slot.",
          refs: { zoneIds: [z.id] },
        });
      }
    }
  }

  return {
    issues,
    counts: {
      error: issues.filter((i) => i.severity === "error").length,
      warning: issues.filter((i) => i.severity === "warning").length,
      info: issues.filter((i) => i.severity === "info").length,
    },
  };
}
