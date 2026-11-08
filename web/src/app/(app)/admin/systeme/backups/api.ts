/**
 * Routes `/api/system/backups/*` et `/api/system/transfer/*` (Système ›
 * Sauvegardes), typées. Code propre à arkyo-server.
 */

import { ApiError, api } from "@/lib/api-client";

// ── Types ────────────────────────────────────────────────────────────────────

export type RootKind = "project" | "rack" | "rig" | "panel";
export type RootRef = { kind: RootKind; id: string };

export type TransferItem = { id: string; name: string; updatedAt: string };
export type TransferObjects = {
  projects: TransferItem[];
  racks: TransferItem[];
  rigs: TransferItem[];
  panels: TransferItem[];
};

export type Author = { id: string; name: string | null; email: string | null };

export type Manifest = {
  format: string;
  version: number;
  appVersion: string;
  createdAt: string;
  createdBy?: Author | null;
  roots: { kind: RootKind; id: string; name: string }[];
  counts: Record<string, number>;
  label?: string | null;
};

export type RootPreview = {
  kind: RootKind;
  id: string;
  name: string;
  /** L'identifiant existe ici : un mode doit être choisi. */
  exists: boolean;
  counts: Record<string, number>;
};
export type ImportPreview = { manifest: Manifest; roots: RootPreview[] };
export type InspectResult = { token: string; preview: ImportPreview };

export type ImportMode = "insert" | "replace" | "copy";
export type RootReport = {
  kind: RootKind;
  id: string;
  name: string;
  mode: ImportMode;
  inserted: Record<string, number>;
};
export type ImportReport = {
  roots: RootReport[];
  catalogueAdded: Record<string, number>;
  uploadsCopied: number;
  warnings: string[];
};

export type PointKind = "auto" | "manual" | "beforeRestore";
export type Point = {
  id: string;
  projectId: string;
  projectName: string;
  kind: PointKind;
  label: string | null;
  createdAt: string;
  author: Author | null;
  digest: string;
  size: number;
};
export type PointProject = {
  id: string;
  name: string;
  deleted: boolean;
  lastPoint: Point | null;
  count: number;
};
export type ProjectSettings = {
  enabled: boolean;
  /** 1, 6 ou 24. */
  intervalHours: number;
  keep: number;
};

export type SiteSettings = {
  enabled: boolean;
  /** Heure locale de la sauvegarde quotidienne (0–23). */
  hour: number;
  dir: string | null;
  keep: number;
};
export type SiteBackup = { name: string; size: number; createdAt: string };
export type RestoreStatus = {
  ok: boolean;
  at: string;
  archive: string;
  error?: string;
  backupCreatedAt?: string;
  pending?: { size: number; modifiedNs: number };
};
export type SiteList = {
  settings: SiteSettings;
  backups: SiteBackup[];
  dir: string;
  lastRestore: RestoreStatus | null;
};
export type SiteRestoreResult = { restarting: boolean; warning?: string };

// ── Téléchargement ───────────────────────────────────────────────────────────

function fileNameOf(res: Response, fallback: string): string {
  const header = res.headers.get("content-disposition") ?? "";
  const m = /filename="?([^";]+)"?/i.exec(header);
  return m ? m[1] : fallback;
}

/**
 * Télécharge `url` (mêmes cookies) : `fetch`, `Blob`, lien temporaire. Le nom
 * est celui du `Content-Disposition`, à défaut `fallbackName`.
 */
export async function downloadFile(
  url: string,
  fallbackName: string,
  init?: { method?: string; body?: unknown },
): Promise<void> {
  const hasBody = init?.body !== undefined;
  const res = await fetch(url, {
    credentials: "include",
    method: init?.method ?? "GET",
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(init?.body) : undefined,
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      const text = await res.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    throw new ApiError(res.status, body);
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileNameOf(res, fallbackName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari/Firefox peuvent annuler le téléchargement si l'URL est révoquée trop tôt.
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

// ── Routes ───────────────────────────────────────────────────────────────────

const enc = encodeURIComponent;
const T = "/api/system/transfer";
const B = "/api/system/backups";

export const backupsApi = {
  // Export / import
  objects: () => api.get<TransferObjects>(`${T}/objects`),
  exportObjects: (roots: RootRef[]) =>
    downloadFile(`${T}/export`, "Arkyo-export.arkyo", {
      method: "POST",
      body: { roots },
    }),
  /** Corps brut = le fichier ; renvoie le jeton et l'aperçu. */
  inspect: (file: Blob) => api.post<InspectResult>(`${T}/inspect`, file),
  /** `modes` : identifiant de racine → mode, pour les racines présentes ici. */
  importFile: (token: string, modes: Record<string, ImportMode>) =>
    api.post<ImportReport>(`${T}/import`, { token, modes }),

  // Points de restauration
  points: {
    projects: () => api.get<PointProject[]>(`${B}/projects`),
    list: (projectId: string) =>
      api.get<Point[]>(`${B}/projects/${enc(projectId)}/points`),
    create: (projectId: string, label?: string) =>
      api.post<Point>(
        `${B}/projects/${enc(projectId)}/points`,
        label ? { label } : {},
      ),
    restore: (projectId: string, pointId: string) =>
      api.post<ImportReport>(
        `${B}/projects/${enc(projectId)}/points/${enc(pointId)}/restore`,
      ),
    download: (projectId: string, pointId: string) =>
      downloadFile(
        `${B}/projects/${enc(projectId)}/points/${enc(pointId)}/download`,
        `${pointId}.arkyo`,
      ),
    remove: (projectId: string, pointId: string) =>
      api.delete<void>(
        `${B}/projects/${enc(projectId)}/points/${enc(pointId)}`,
      ),
    settings: () => api.get<ProjectSettings>(`${B}/settings/projects`),
    saveSettings: (s: ProjectSettings) =>
      api.put<ProjectSettings>(`${B}/settings/projects`, s),
  },

  // Sauvegarde du site
  site: {
    list: () => api.get<SiteList>(`${B}/site`),
    create: () => api.post<SiteBackup>(`${B}/site`),
    download: (name: string) =>
      downloadFile(`${B}/site/${enc(name)}/download`, name),
    remove: (name: string) => api.delete<void>(`${B}/site/${enc(name)}`),
    saveSettings: (s: SiteSettings) =>
      api.put<SiteSettings>(`${B}/settings/site`, s),
    /** Corps brut = l'archive ; le serveur redémarre ensuite. */
    restore: (file: Blob) =>
      api.post<SiteRestoreResult>(`${B}/site/restore`, file),
  },
};
