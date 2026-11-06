"use client";

/**
 * ExportMenu — modal d'export partagé par les onglets projet.
 *
 * Contenant : un vrai modal (portal + overlay) basé sur le `Dialog` Radix
 * canonique, large et haut, en DEUX colonnes :
 *  - GAUCHE (~70 %) : aperçu de ce qui sera exporté — le DOCUMENT pour les
 *    formats rendus (PDF, image), les DONNÉES pour les formats tabulaires
 *    (CSV / XLSX, cf. `tablePreview`). Régénéré à l'ouverture et à chaque
 *    changement de réglage connu du menu (catégorie, type, `previewKey`),
 *    avec debounce et annulation des générations obsolètes.
 *  - DROITE (~30 %, défilante) : les réglages (sélecteur de catégorie
 *    segmenté, types, slot `options`) et, épinglée en bas, l'action unique —
 *    « Télécharger ».
 *
 * Une seule destination : le disque de l'utilisateur. La bibliothèque de
 * documents du projet a été retirée — elle recopiait sur le serveur des
 * fichiers déjà téléchargés, pour un coût de stockage sans contrepartie.
 *
 * Les générateurs sont censés être PURS (retourner `{ blob, filename }`) : le
 * modal se charge du téléchargement et de l'aperçu à partir du même blob.
 * `atomic` reste réservé aux rares générateurs qui téléchargent eux-mêmes
 * (blueprint multi-pages).
 *
 * Le déclencheur reste rendu par le parent, qui pilote `open`/`onOpenChange` —
 * contrat inchangé pour les consommateurs.
 *
 * Contrat générique : l'onglet déclare des **catégories** (PDF / Image /
 * Excel) ; seules les catégories déclarées apparaissent, les `disabled`
 * restent visibles mais non sélectionnables. `onExport(category, variant?)`
 * **génère** et retourne `{ blob, filename }` — ExportMenu ne connaît ni le
 * contenu ni le format, il orchestre génération → téléchargement + feedback.
 *
 * Le mode `children` remplace la colonne de réglages par un contenu custom
 * (ex. `ExportSlideContent` du Câblage) ; la colonne d'aperçu affiche alors son
 * état vide. Symétriquement, `customPreview` remplace la colonne d'aperçu —
 * pour les onglets où l'aperçu n'est pas un document généré mais une surface
 * d'ÉDITION (composeur de mise en page du Rack).
 */

import * as React from "react";
import {
  Download,
  FileImage,
  FileSpreadsheet,
  FileType,
  Loader2,
  RefreshCw,
  X,
} from "@/components/ui/icons";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { useToast } from "@/components/ui/toast";
import { downloadBlob } from "@/lib/export/download-blob";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { cn } from "@/lib/utils";


export type ExportCategoryKey = "pdf" | "image" | "excel";

/** Type de fichier au sein d'une catégorie (PNG | JPG, CSV | XLSX…). */
export type ExportVariantDef = {
  key: string;
  label: string;
};

export type ExportFormatDef = {
  key: ExportCategoryKey;
  label: string;
  /** Sous-titre court (« Capture visuelle », « Nomenclature »…). */
  description?: string;
  /**
   * Types proposés sous le sélecteur de catégorie (sélecteur segmenté). Le
   * premier est sélectionné par défaut. Absent ou singleton → pas de sélecteur.
   */
  variants?: ExportVariantDef[];
  /** Slot d'options propres à la catégorie (modèle PDF, périmètre…). */
  options?: React.ReactNode;
  /** Désactive cette catégorie (ex. données vides). */
  disabled?: boolean;
  /**
   * Catégorie « atomique » : le générateur gère lui-même le téléchargement
   * (ex. blueprint multi-pages). Le bouton est alors libellé « Exporter ».
   *
   * Conséquence pour l'aperçu : `onExport` a des EFFETS DE BORD (téléchargement
   * du fichier), il ne peut donc pas servir à prévisualiser. Pour afficher un
   * aperçu sur une catégorie atomique, fournir `previewExport`.
   */
  atomic?: boolean;
  /**
   * Aperçu maison propre à CETTE catégorie — même contrat que `customPreview`
   * global, mais ciblé. Le synoptique en a besoin : son PDF s'aperçoit par la
   * page vivante, alors que son PNG reste un document généré.
   */
  customPreview?: React.ReactNode;
};

/**
 * Résultat d'`onExport` :
 *  - `{ blob, filename }` : ExportMenu s'occupe du téléchargement / de la
 *    persistance selon le bouton cliqué.
 *  - `{ handled: true }`  : le générateur a déjà tout fait (formats atomiques).
 */
export type ExportResult =
  | {
      blob: Blob;
      filename: string;
      /** Nombre de pages du PDF — affiché dans le bandeau d'aperçu. */
      pageCount?: number;
    }
  | { handled: true };

/** Aperçu tabulaire des formats de données (CSV / XLSX). */
export type ExportTablePreview = {
  columns: string[];
  rows: Array<Array<string | number>>;
};

export type ExportMenuProps = {
  /** Titre du modal (« Exporter l'inventaire »). */
  title: string;
  /** Texte d'aide sous le titre. */
  description?: string;
  /**
   * Catégories déclarées par l'onglet (mode « catégories »). Ignoré si
   * `children` est fourni (mode corps custom).
   */
  formats?: ExportFormatDef[];
  /**
   * Génère l'export demandé → { blob, filename }. `variant` = type choisi
   * dans le panneau (ex. "png" | "jpg") quand la catégorie en déclare.
   * Requis en mode catégories.
   */
  onExport?: (
    category: ExportCategoryKey,
    variant?: string,
  ) => Promise<ExportResult>;
  /**
   * Génération SANS effet de bord destinée au seul aperçu. Optionnel :
   *  - absent + catégorie non atomique → l'aperçu réutilise `onExport` ;
   *  - absent + catégorie atomique → pas d'aperçu (appeler `onExport`
   *    déclencherait un vrai téléchargement) ;
   *  - présent → utilisé pour toutes les catégories.
   * Retourner `null` signifie « ce format ne se prévisualise pas ».
   */
  previewExport?: (
    category: ExportCategoryKey,
    variant?: string,
  ) => Promise<{ blob: Blob; filename: string; pageCount?: number } | null>;
  /**
   * Contenu tabulaire des formats de données (Excel) : le modal en rend les
   * premières lignes dans la colonne d'aperçu. Un fichier CSV/XLSX ne se
   * prévisualise pas comme un document — on montre donc les DONNÉES.
   */
  tablePreview?: ExportTablePreview;
  /**
   * Remplace TOUT le contenu de la colonne d'aperçu par un rendu maison —
   * pendant, côté aperçu, de ce que `children` fait côté réglages.
   *
   * Réservé aux onglets dont l'aperçu n'est pas un document généré mais une
   * surface d'ÉDITION (le composeur de mise en page du Rack : on compose la
   * page, le PDF final est cette composition). Quand il est fourni, aucune
   * génération d'aperçu n'est lancée — `onExport` n'est appelé que sur action
   * explicite de l'utilisateur.
   *
   * `tablePreview` est ignoré tant que ce slot est fourni.
   */
  customPreview?: React.ReactNode;
  /**
   * Intitulé de la colonne de gauche (défaut « Aperçu »). `null` le retire —
   * et si rien d'autre n'occupe le bandeau, celui-ci disparaît avec lui :
   * un aperçu maison qui se suffit n'a pas besoin d'être annoncé.
   */
  previewLabel?: string | null;
  /**
   * Clé de persistance des réglages portés par le modal (catégorie active et
   * type choisi) — convention `export:{onglet}:{projectId}`. Les réglages du
   * slot `options` restent à la charge du consommateur, qui les persiste sous
   * la même clé suffixée.
   */
  storageKey?: string;
  /**
   * Signature des réglages portés par le slot `options` (propriété du
   * consommateur, donc invisible d'ici). La faire changer relance l'aperçu.
   */
  previewKey?: string | number;
  /**
   * Corps custom de la colonne de réglages. Quand fourni, remplace le
   * sélecteur de catégories — utilisé par les onglets dont l'UI d'export (ex.
   * templates de colonnes du Câblage) est trop riche pour le modèle
   * format/actions générique.
   */
  children?: React.ReactNode;
  /** État ouvert/fermé — piloté par le parent (qui rend le bouton déclencheur). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Empêche la fermeture sur clic-extérieur / Échap — utile quand un sous-modal
   * (ex. gestion des templates de colonnes) est ouvert par-dessus.
   */
  lockClose?: boolean;
  /** Classes additionnelles sur le contenu du modal. */
  className?: string;
};

const FORMAT_ICON: Record<ExportCategoryKey, React.ComponentType<{ className?: string }>> = {
  pdf: FileType,
  image: FileImage,
  excel: FileSpreadsheet,
};

/** Délai avant régénération de l'aperçu — certaines captures sont lourdes. */
const PREVIEW_DEBOUNCE_MS = 600;

// ── Validateurs des réglages restaurés ───────────────────────────────────────

const CATEGORY_KEYS: ExportCategoryKey[] = ["pdf", "image", "excel"];

function isCategoryOrNull(v: unknown): v is ExportCategoryKey | null {
  return v === null || CATEGORY_KEYS.includes(v as ExportCategoryKey);
}

function isVariantMap(
  v: unknown,
): v is Partial<Record<ExportCategoryKey, string>> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  return Object.entries(v as Record<string, unknown>).every(
    ([k, val]) =>
      CATEGORY_KEYS.includes(k as ExportCategoryKey) && typeof val === "string",
  );
}

/** Nombre de lignes rendues dans l'aperçu tabulaire. */
const TABLE_PREVIEW_ROWS = 30;

/**
 * Aperçu des formats de données : on ne rend pas le fichier, on montre les
 * DONNÉES qu'il contiendra — colonnes réelles et premières lignes.
 */
function TablePreview({ table }: { table: ExportTablePreview }) {
  const shown = table.rows.slice(0, TABLE_PREVIEW_ROWS);
  const rest = table.rows.length - shown.length;
  return (
    <div className="min-w-0 flex-1">
      <div className="border-border overflow-hidden rounded-md border bg-[var(--card)]">
        <div className="max-h-full overflow-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th
                    key={c}
                    className="border-border/60 bg-[var(--secondary)]/50 border-b px-2 py-1.5 text-left font-semibold whitespace-nowrap"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((cells, i) => (
                <tr
                  key={i}
                  className="border-border/40 border-b last:border-b-0"
                >
                  {cells.map((cell, j) => (
                    <td
                      key={j}
                      className="max-w-[220px] truncate px-2 py-1 whitespace-nowrap text-[var(--muted-foreground)]"
                      title={String(cell ?? "")}
                    >
                      {String(cell ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {rest > 0 && (
        <p className="mt-2 px-1 text-[10px] text-[var(--muted-foreground)]">
          … et {rest} autre{rest > 1 ? "s" : ""} ligne{rest > 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

/** Nature de l'aperçu déductible d'une catégorie. */
type PreviewKind = "pdf" | "image" | "none";

function previewKindOf(category: ExportCategoryKey | null): PreviewKind {
  if (category === "pdf") return "pdf";
  if (category === "image") return "image";
  return "none";
}

export function ExportMenu({
  title,
  description,
  formats = [],
  onExport,
  previewExport,
  tablePreview,
  customPreview,
  previewLabel = "Aperçu",
  previewKey,
  storageKey,
  children,
  open,
  onOpenChange,
  lockClose = false,
  className,
}: ExportMenuProps) {
  const toast = useToast();
  const isOpen = !!open;
  const requestClose = React.useCallback(
    () => onOpenChange?.(false),
    [onOpenChange],
  );

  // Filet de sécurité au démontage. Radix pose `pointer-events: none` sur
  // <body> tant qu'un modal est ouvert et le retire à la fermeture. Si le
  // composant est démonté ALORS QU'IL EST OUVERT — parent qui conditionne son
  // montage, navigation d'onglet, hot-reload en dev — ce nettoyage n'a jamais
  // lieu et TOUTE l'application devient inerte au clic. On ne restaure que s'il
  // ne reste aucun autre dialog ouvert, pour ne pas déverrouiller à tort.
  React.useEffect(
    () => () => {
      if (typeof document === "undefined") return;
      if (document.body.style.pointerEvents !== "none") return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      document.body.style.pointerEvents = "";
    },
    [],
  );

  // Clé d'action en cours : `${catégorie}:${download|save|atomic}` — pour le spinner.
  const [busy, setBusy] = React.useState<string | null>(null);

  // Catégorie active — défaut : première catégorie non désactivée. Restaurée
  // d'une session à l'autre quand `storageKey` est fourni, puis TOUJOURS
  // re-validée contre les catégories réellement déclarées (une catégorie
  // disparue ou désactivée retombe sur la première disponible).
  const [activeKey, setActiveKey] = useLocalStorageState<ExportCategoryKey | null>(
    storageKey ? `${storageKey}:category` : "export-menu:category:volatile",
    null,
    { isValid: isCategoryOrNull },
  );
  React.useEffect(() => {
    if (!isOpen) return;
    // `formats` est recréé à chaque rendu du consommateur : on ne réécrit que
    // si la valeur change VRAIMENT, sinon chaque rendu écrirait dans
    // localStorage (le setter persiste à chaque appel).
    if (formats.some((f) => f.key === activeKey && !f.disabled)) return;
    const next = (formats.find((f) => !f.disabled) ?? formats[0])?.key ?? null;
    if (next !== activeKey) setActiveKey(next);
  }, [isOpen, formats, activeKey, setActiveKey]);

  // Type choisi par catégorie — défaut : premier variant déclaré. `selectedVariant`
  // retombe sur le premier variant si la valeur restaurée n'existe plus.
  const [variantByCategory, setVariantByCategory] = useLocalStorageState<
    Partial<Record<ExportCategoryKey, string>>
  >(
    storageKey ? `${storageKey}:variant` : "export-menu:variant:volatile",
    {},
    { isValid: isVariantMap },
  );
  const selectedVariant = (fmt: ExportFormatDef): ExportVariantDef | null => {
    if (!fmt.variants || fmt.variants.length === 0) return null;
    return (
      fmt.variants.find((v) => v.key === variantByCategory[fmt.key]) ??
      fmt.variants[0]!
    );
  };

  const active = formats.find((f) => f.key === activeKey) ?? null;
  const activeVariant = active ? selectedVariant(active) : null;
  const activeDisabled = !!active?.disabled;

  /**
   * Exécute l'action demandée sur la catégorie active.
   *
   * Une seule destination : le disque de l'utilisateur. La bibliothèque de
   * documents du projet a été retirée — elle dupliquait sur le serveur des
   * fichiers que l'utilisateur télécharge déjà, pour un coût de stockage sans
   * contrepartie. `handled` reste pour les générateurs qui téléchargent
   * eux-mêmes.
   */
  const run = async (fmt: ExportFormatDef, action: "download" | "atomic") => {
    if (busy || !onExport) return;
    const variant = selectedVariant(fmt);
    const doneLabel = variant?.label ?? fmt.label;
    const busyKey = `${fmt.key}:${action}`;
    setBusy(busyKey);
    // Laisse l'interface PEINDRE l'état occupé avant le premier travail lourd.
    // Sans cette cession, le fil principal enchaîne sur la génération : le
    // bouton reste inerte, rien ne tourne, et l'utilisateur conclut au blocage
    // alors que l'export a bel et bien démarré. `requestAnimationFrame` place
    // la reprise après la prochaine peinture.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => setTimeout(resolve, 0)),
    );
    try {
      const result = await onExport(fmt.key, variant?.key);
      if ("handled" in result) {
        // Catégorie atomique : le générateur a déjà téléchargé.
        toast.success(`${doneLabel} exporté`);
      } else {
        downloadBlob(result.blob, result.filename);
        toast.success(`${doneLabel} téléchargé`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'export");
    } finally {
      setBusy(null);
    }
  };

  // ── Aperçu ────────────────────────────────────────────────────────────────
  //
  // Les dépendances de régénération sont volontairement PRIMITIVES : `formats`
  // et `onExport` sont recréés à chaque rendu par la plupart des consommateurs,
  // les mettre en dépendance relancerait l'aperçu en boucle. On les lit donc
  // via des refs.
  const generatorsRef = React.useRef({ onExport, previewExport });
  generatorsRef.current = { onExport, previewExport };
  const activeRef = React.useRef(active);
  activeRef.current = active;

  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  /** Métadonnées du document généré — bandeau d'aperçu. */
  const [previewMeta, setPreviewMeta] = React.useState<{
    filename: string;
    pageCount?: number;
  } | null>(null);
  /**
   * Type MIME réellement produit. La catégorie ne suffit pas : le PDF « poster »
   * du synoptique peut sortir en PNG selon son réglage de sortie, et le rendre
   * dans un lecteur PDF donnerait un cadre vide.
   */
  const [previewMime, setPreviewMime] = React.useState<string | null>(null);
  /** Incrémenté à chaque demande : une génération obsolète est ignorée. */
  const previewRunRef = React.useRef(0);
  const previewUrlRef = React.useRef<string | null>(null);
  const setPreviewObjectUrl = React.useCallback((url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  }, []);
  // Révocation de la dernière URL au démontage.
  React.useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    },
    [],
  );

  const activeVariantKey = activeVariant?.key ?? null;
  const previewKind = previewKindOf(activeKey);
  // Aperçu maison → aucune génération : la surface d'édition EST l'aperçu.
  // La déclaration de la catégorie prime sur celle du modal : une vue peut
  // n'avoir d'aperçu maison que sur UNE de ses catégories.
  const activeCustomPreview = active?.customPreview ?? customPreview;
  const hasCustomPreview = !!activeCustomPreview;

  /** Relance manuelle : les réglages du slot `options` ne sont pas observables. */
  const [previewNonce, setPreviewNonce] = React.useState(0);

  const canPreview =
    !hasCustomPreview &&
    !!activeKey &&
    !activeDisabled &&
    previewKind !== "none" &&
    (!!previewExport || !active?.atomic);
  // Booléen et non `children` en dépendance : un ReactNode change d'identité à
  // chaque rendu du parent, l'effet tournerait pour rien.
  const hasCustomBody = !!children;

  React.useEffect(() => {
    if (!isOpen || !canPreview || hasCustomBody) {
      previewRunRef.current++;
      setPreviewLoading(false);
      setPreviewError(null);
      setPreviewObjectUrl(null);
      setPreviewMeta(null);
      setPreviewMime(null);
      return;
    }
    const runId = ++previewRunRef.current;
    setPreviewError(null);
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      const category = activeRef.current?.key;
      if (!category) {
        setPreviewLoading(false);
        return;
      }
      const { onExport: gen, previewExport: preview } = generatorsRef.current;
      const isAtomic = !!activeRef.current?.atomic;
      const variant = activeVariantKey ?? undefined;
      // `previewExport` d'abord ; s'il ne sait pas prévisualiser CETTE
      // catégorie (retour `null`), on retombe sur `onExport` — mais seulement
      // si la catégorie n'est pas atomique, auquel cas générer téléchargerait.
      const task = (async () => {
        if (preview) {
          const res = await preview(category, variant);
          if (res) return res;
        }
        if (!isAtomic && gen) {
          const res = await gen(category, variant);
          return "handled" in res ? null : res;
        }
        return null;
      })();
      void task
        .then((res) => {
          if (runId !== previewRunRef.current) return;
          setPreviewObjectUrl(res ? URL.createObjectURL(res.blob) : null);
          setPreviewMime(res?.blob.type || null);
          setPreviewMeta(
            res
              ? { filename: res.filename, pageCount: res.pageCount }
              : null,
          );
        })
        .catch((e: unknown) => {
          if (runId !== previewRunRef.current) return;
          setPreviewObjectUrl(null);
          setPreviewMeta(null);
          setPreviewMime(null);
          setPreviewError(
            e instanceof Error ? e.message : "Aperçu indisponible",
          );
        })
        .finally(() => {
          if (runId === previewRunRef.current) setPreviewLoading(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    isOpen,
    canPreview,
    activeKey,
    activeVariantKey,
    previewKey,
    previewNonce,
    hasCustomBody,
    setPreviewObjectUrl,
  ]);

  /** Aperçu tabulaire des formats de données — rendu à la place du document. */
  const showTablePreview =
    !hasCustomPreview &&
    previewKind === "none" &&
    !!tablePreview &&
    tablePreview.columns.length > 0 &&
    !activeDisabled &&
    !children;

  /**
   * Bandeau de l'aperçu : il n'existe que s'il a quelque chose à dire.
   * Un aperçu maison sans intitulé ne laisse rien — la surface d'édition prend
   * alors toute la colonne, sans liseré vide au-dessus.
   */
  const showPreviewHeader =
    !!previewLabel ||
    (!!previewMeta && !showTablePreview) ||
    (showTablePreview && !!tablePreview) ||
    (canPreview && !children);

  const previewBody = (() => {
    if (hasCustomPreview) return activeCustomPreview;
    if (showTablePreview) {
      return <TablePreview table={tablePreview!} />;
    }
    if (previewLoading) {
      return <LoadingState label="Génération de l'aperçu…" />;
    }
    if (previewError) {
      return (
        <EmptyState
          icon={<FileType />}
          title="Aperçu indisponible"
          description={previewError}
        />
      );
    }
    if (!previewUrl) {
      return (
        <EmptyState
          icon={<FileType />}
          title="Aperçu non disponible pour ce format"
        />
      );
    }
    // Le MIME du blob prime sur la catégorie : un « PDF » peut sortir en image
    // (poster synoptique en mode PNG), et l'inverse n'existe pas.
    const asPdf = previewMime
      ? previewMime === "application/pdf"
      : previewKind === "pdf";
    if (asPdf) {
      return (
        <object
          data={previewUrl}
          type="application/pdf"
          className="h-full w-full rounded-md border border-[var(--border)] bg-white shadow-sm"
          aria-label="Aperçu du document"
        />
      );
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={previewUrl}
        alt="Aperçu du document"
        className="max-h-full max-w-full rounded-md border border-[var(--border)] bg-white object-contain shadow-sm"
      />
    );
  })();

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next && lockClose) return;
        onOpenChange?.(next);
      }}
    >
      <DialogContent
        showClose={false}
        onInteractOutside={(e) => {
          if (lockClose) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (lockClose) e.preventDefault();
        }}
        className={cn(
          // `overflow-y-hidden` explicite : le `overflow-y-auto` de base de
          // DialogContent appartient à un autre groupe tailwind-merge et
          // survivrait à `overflow-hidden` seul.
          // `max-w-none` / `max-h-none` neutralisent les bornes de base
          // (`max-w-lg`, `max-h-[90vh]`) qui rogneraient les cotes ci-dessous.
          "flex max-h-none max-w-none flex-col gap-0 overflow-hidden overflow-y-hidden rounded-xl p-0",
          className,
        )}
        // Dimensions en style INLINE, volontairement.
        //
        // En classes utilitaires arbitraires (`w-[min(1440px,97vw)]`), la règle
        // n'existe que si le générateur a vu ce littéral exact ; sinon
        // tailwind-merge a déjà écarté le `w-[calc(100%-2rem)]` de base au
        // profit d'une classe sans définition, et l'élément se retrouve SANS
        // largeur du tout — donc dimensionné par son contenu, soit ~315 px.
        // Une cote unique et structurante ne doit pas dépendre de ce concours
        // de circonstances.
        //
        // Largeur : la colonne de réglages est plafonnée à 360 px, tout le
        // gain va donc à l'aperçu, qui est le sujet du modal.
        style={{
          width: "min(1440px, 97vw)",
          height: "min(900px, 94vh)",
          maxWidth: "97vw",
          maxHeight: "94vh",
        }}
      >
        <div className="border-border flex flex-none items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="text-sm leading-tight font-semibold">
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription className="mt-0.5 text-[11px] leading-relaxed">
                {description}
              </DialogDescription>
            )}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Fermer"
            className="text-muted-foreground hover:bg-muted hover:text-foreground -mr-1 shrink-0 rounded p-1 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* ── Colonne aperçu ─────────────────────────────────────────── */}
          <section className="border-border flex min-h-0 min-w-0 flex-1 flex-col border-r bg-[var(--secondary)]/25">
            {showPreviewHeader && (
            <div className="border-border/60 flex flex-none items-center justify-between gap-2 border-b px-3 py-1.5">
              <span className="flex min-w-0 items-baseline gap-2">
                {previewLabel && (
                  <span className="text-[10px] font-semibold tracking-[0.12em] text-[var(--muted-foreground)] uppercase">
                    {previewLabel}
                  </span>
                )}
                {/* Métadonnées du document qui sera produit : nom de fichier et
                    nombre de pages. Rien tant que rien n'a été généré. */}
                {previewMeta && !showTablePreview && (
                  <span
                    className="min-w-0 truncate text-[10px] text-[var(--muted-foreground)]"
                    style={{ fontFamily: "var(--font-mono)" }}
                    title={previewMeta.filename}
                  >
                    {previewMeta.filename}
                    {previewMeta.pageCount != null &&
                      ` · ${previewMeta.pageCount} page${previewMeta.pageCount > 1 ? "s" : ""}`}
                  </span>
                )}
                {showTablePreview && tablePreview && (
                  <span
                    className="text-[10px] text-[var(--muted-foreground)]"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {tablePreview.rows.length} ligne
                    {tablePreview.rows.length > 1 ? "s" : ""} ·{" "}
                    {tablePreview.columns.length} colonne
                    {tablePreview.columns.length > 1 ? "s" : ""}
                  </span>
                )}
              </span>
              {canPreview && !children && (
                <button
                  type="button"
                  onClick={() => setPreviewNonce((n) => n + 1)}
                  disabled={previewLoading}
                  aria-label="Régénérer l'aperçu"
                  title="Régénérer l'aperçu"
                  className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1 transition-colors disabled:opacity-40"
                >
                  <RefreshCw
                    className={cn(
                      "h-3.5 w-3.5",
                      previewLoading && "animate-spin",
                    )}
                  />
                </button>
              )}
            </div>
            )}
            <div
              className={cn(
                "flex min-h-0 flex-1",
                // L'aperçu maison porte sa propre mise en page (viewport
                // zoomable) : il prend toute la surface, sans marge ni
                // défilement imposés.
                hasCustomPreview
                  ? "overflow-hidden"
                  : showTablePreview
                    ? "items-start justify-stretch overflow-auto p-3"
                    : "items-center justify-center overflow-auto p-5",
              )}
            >
              {previewBody}
            </div>
          </section>

          {/* ── Colonne réglages ───────────────────────────────────────── */}
          {/* Volontairement étroite : l'aperçu domine. Le plancher à 300 px est
              la contrainte basse — c'est ce qu'il faut aux réglages les plus
              denses (cartouche + champs, options de contenu de l'inventaire)
              pour rester lisibles ; au-delà, la colonne défile. */}
          <aside
            className="flex min-h-0 shrink-0 flex-col"
            // Largeur en style inline, pour la même raison que celle du modal :
            // une cote structurante ne doit pas dépendre de la génération d'une
            // classe utilitaire arbitraire. `clamp` reproduit exactement les
            // anciennes bornes (30 %, plancher 300, plafond 360).
            style={{ width: "clamp(300px, 30%, 360px)" }}
          >
            {children ? (
              <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-auto p-3">
                  {formats.length === 0 ? (
                    <p className="text-center text-xs text-[var(--muted-foreground)]">
                      Aucun export disponible.
                    </p>
                  ) : (
                    <>
                      {/* Sélecteur de catégorie (PDF / Image / Excel). */}
                      <p className="mb-1.5 px-0.5 text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
                        Format
                      </p>
                      <div
                        className="grid gap-1.5"
                        style={{
                          gridTemplateColumns: `repeat(${Math.min(formats.length, 3)}, minmax(0, 1fr))`,
                        }}
                      >
                        {formats.map((fmt) => {
                          const Icon = FORMAT_ICON[fmt.key];
                          const isActive = fmt.key === active?.key;
                          return (
                            <button
                              key={fmt.key}
                              type="button"
                              disabled={!!fmt.disabled}
                              onClick={() => setActiveKey(fmt.key)}
                              className={cn(
                                "flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 transition-colors",
                                isActive
                                  ? "border-[var(--accent)]/60 bg-[var(--accent)]/10"
                                  : "border-[var(--border)]/60 hover:bg-[var(--secondary)]/40",
                                fmt.disabled &&
                                  "cursor-not-allowed opacity-40 hover:bg-transparent",
                              )}
                            >
                              <Icon
                                className={cn(
                                  "h-3.5 w-3.5 shrink-0",
                                  isActive
                                    ? "text-[var(--accent)]"
                                    : "text-[var(--muted-foreground)]",
                                )}
                              />
                              <span
                                className={cn(
                                  "truncate text-[11px] font-semibold",
                                  isActive
                                    ? "text-[var(--accent-strong)]" // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                                    : "text-[var(--foreground)]",
                                )}
                              >
                                {fmt.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {active && (
                        <div className="mt-3 space-y-3">
                          {active.description && (
                            <p className="px-0.5 text-[11px] leading-tight text-[var(--muted-foreground)]">
                              {active.description}
                            </p>
                          )}

                          {/* Sélecteur de type (PNG | JPG, CSV | XLSX…). */}
                          {active.variants && active.variants.length > 1 && (
                            <div className="flex gap-1.5">
                              {active.variants.map((v) => {
                                const isActive = v.key === activeVariant?.key;
                                return (
                                  <button
                                    key={v.key}
                                    type="button"
                                    disabled={activeDisabled}
                                    onClick={() =>
                                      setVariantByCategory((prev) => ({
                                        ...prev,
                                        [active.key]: v.key,
                                      }))
                                    }
                                    className={cn(
                                      "flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors",
                                      isActive
                                        // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                                        ? "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent-strong)]"
                                        : "border-[var(--border)]/60 text-[var(--foreground)] hover:bg-[var(--secondary)]/40",
                                    )}
                                  >
                                    {v.label}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* Options propres à la catégorie active. */}
                          {active.options && (
                            <div className="border-t border-[var(--border)]/60 pt-3">
                              {active.options}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Action de la catégorie active — épinglée en bas. Une seule
                    désormais : la bibliothèque de documents a été retirée, un
                    export va sur le disque de l'utilisateur et nulle part
                    ailleurs. Les générateurs « atomiques » téléchargent
                    eux-mêmes et gardent leur libellé propre. */}
                {active && (
                  <div className="border-border flex-none border-t p-3">
                    <button
                      type="button"
                      disabled={activeDisabled || busy !== null}
                      onClick={() =>
                        void run(active, active.atomic ? "atomic" : "download")
                      }
                      className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-transparent px-2.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] disabled:pointer-events-none disabled:opacity-50"
                    >
                      {busy !== null ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      {active.atomic ? "Exporter" : "Télécharger"}
                    </button>
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
