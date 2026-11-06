"use client";

/**
 * RackExport — export de l'onglet Rack, via le modal partagé `ExportMenu`.
 *
 * L'onglet Rack ne capture PLUS la vue courante du canvas : la colonne
 * d'aperçu du modal est un **éditeur de mise en page** (`RackExportComposer`)
 * où l'on pose des vues de contenants sur une feuille. Le document produit est
 * exactement cette composition — mêmes positions, mêmes tailles, même
 * cartouche. Il n'y a donc qu'une seule vérité : ce qui est à l'écran.
 *
 *  - **PDF**   : habillage choisi + chaque vue capturée à sa taille naturelle
 *      et posée à ses coordonnées page (`buildComposedBlueprintPdf`).
 *  - **Image** (PNG | JPG) : capture de la page composée, cartouche compris.
 *
 * Deux familles d'habillage, une seule mécanique : un calque pleine page
 * composité par-dessus la composition.
 *  - **Modèle standard** (défaut) : cartouche intégré, dessiné en SVG dans la
 *    grammaire « grille allégée » partagée avec l'inventaire
 *    (`lib/print/technical-frame`). Le MÊME SVG rasterisé sert à l'écran et au
 *    document — aucune divergence possible.
 *  - **Modèles de l'espace** : cartouches WYSIWYG de Paramètres › Impression,
 *    conservés ici (contrairement à l'inventaire).
 *
 * Réglages mémorisés par projet sous `export:rack:{projectId}` : modèle,
 * format papier, orientation et composition (`:layout`). Les objets dont la
 * cible a disparu du projet sont écartés au chargement.
 *
 * Nom de fichier : `Racks_{Projet}_{AAAA-MM-JJ}`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import {
  buildComposedBlueprintPdf,
  cartoucheHasLayout,
  rasterizeCartoucheLayout,
  type ComposedBlueprintOverlay,
} from "@/lib/print/export-with-cartouche";
import { svgStringToPngDataUrl } from "@/lib/print/render-print-layout";
import {
  CARTOUCHE_LAYER_DPI,
  loadImageAsDataUrl,
  standardCartoucheSvg,
} from "@/lib/print/technical-frame";
import type { Orientation, PaperFormat } from "@/lib/services/print-layout";
import type { ViewId } from "@/components/synoptique/lib/types";
import { slugifyName } from "@/lib/utils";

import { captureWithFlatten } from "../../reseau/_components/shared/export-capture";
import {
  ExportMenu,
  type ExportCategoryKey,
  type ExportResult,
} from "../../_components/export-menu";
import {
  buildSlotValues,
  buildSmartOverrides,
  CartouchePaperOptions,
  CartouchePicker,
  CartoucheSlotFields,
  TemplateChip,
  useCartoucheModels,
} from "../../_components/export-cartouche-options";
import { buildBaseOverrides } from "../../_components/export-pdf-model-options";

import { captureRackItems } from "./rack-export-capture";
import {
  RackExportComposer,
  RACK_COMPOSER_CHROME_SELECTOR,
  RACK_COMPOSER_PAGE_SELECTOR,
  standardComposerZone,
  type RackExportComposerActions,
  type RackExportContainer,
  type RackExportLocation,
} from "./rack-export-composer";
import {
  EMPTY_RACK_EXPORT_LAYOUT,
  exportableItems,
  isRackExportLayout,
  normalizeRackExportLayout,
  pageSizeMm,
  type RackExportLayout,
} from "./rack-export-layout";
import { RackExportViewsPanel } from "./rack-export-views-panel";
import type { RackRenderMode } from "./rack-export-stage";

// ── Validateurs des réglages restaurés ───────────────────────────────────────

/**
 * Formats proposés : la série A seule. Une planche d'élévations est un plan —
 * Letter et Legal n'y ont pas de sens et encombraient le sélecteur sur deux
 * lignes. Un format mémorisé hors de cette liste est rejeté par le validateur
 * et retombe donc sur A4.
 */
const PAPER_FORMATS: PaperFormat[] = ["A4", "A3", "A2", "A1", "A0"];

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}
function isPaperFormat(v: unknown): v is PaperFormat {
  return PAPER_FORMATS.includes(v as PaperFormat);
}
function isOrientation(v: unknown): v is Orientation {
  return v === "PORTRAIT" || v === "LANDSCAPE";
}

/** Délai avant re-rasterisation du cartouche (saisie des champs). */
const CARTOUCHE_DEBOUNCE_MS = 300;

/**
 * Identifiant du cartouche intégré. Ce n'est PAS un modèle de l'espace : il
 * vit dans la même liste de choix, mais son rendu est dessiné par
 * `standardCartoucheSvg`, pas par un layout WYSIWYG.
 */
const STANDARD_MODEL_ID = "standard";
/** Nature du document — cellule DOCUMENT du cartouche et pied de page. */
const DOCUMENT_LABEL = "Racks";

/**
 * Budget de pixels du calque du cartouche. DEUX budgets, parce que le même
 * calque sert deux usages qui n'ont pas les mêmes exigences :
 *  - à l'ÉCRAN, il est affiché à la taille de la feuille zoomée (quelques
 *    centaines de pixels) et régénéré à chaque frappe dans les champs ;
 *  - au DOCUMENT, c'est du trait et du texte destinés à l'impression, et c'est
 *    la première chose qui paraît molle quand on zoome dans le PDF.
 * Un budget unique arbitrait donc contre l'un ou l'autre.
 */
const OVERLAY_BUDGET_SCREEN_PX = 4_000_000;
const OVERLAY_BUDGET_EXPORT_PX = 36_000_000;

/**
 * Rasterisation du cartouche : plafond en dpi et en côté, PUIS rabattu dans un
 * budget de pixels absolu — mêmes bornes que `project-view-export`, pour que
 * les deux familles d'habillage aient la même finesse.
 */
function overlayPixelSize(
  pw: number,
  ph: number,
  budgetPx: number,
): { w: number; h: number } {
  const dpi = Math.min(CARTOUCHE_LAYER_DPI, (25.4 * 12000) / Math.max(pw, ph));
  let w = Math.round((pw * dpi) / 25.4);
  let h = Math.round((ph * dpi) / 25.4);
  const scale = Math.sqrt(budgetPx / Math.max(1, w * h));
  if (scale < 1) {
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
  }
  return { w, h };
}

export function RackExport({
  projectId,
  projectName,
  containers,
  locations,
  current,
  currentViews,
  renderMode,
  viewMode,
  open,
  onOpenChange,
}: {
  projectId: string;
  projectName: string;
  /** Contenants réels du projet (rackables, non virtuels). */
  containers: RackExportContainer[];
  /** Emplacements portant au moins un contenant rackable. */
  locations: RackExportLocation[];
  /**
   * Ce que l'onglet Rack affiche à l'instant où l'export s'ouvre. Sert de
   * composition de départ sur une feuille vide : ouvrir sur une page blanche
   * alors qu'on regardait un contenant obligerait à tout re-choisir.
   */
  current:
    | { kind: "rack"; rackId: string }
    | { kind: "location"; locationId: string }
    | null;
  /** Vues visibles dans l'onglet, dans l'ordre d'affichage. */
  currentViews: ViewId[];
  /** Mode de rendu des équipements — identique au canvas courant. */
  renderMode: RackRenderMode;
  /** Mode d'affichage du canvas (`schema` → infos textuelles sur les slots). */
  viewMode: "real" | "schema";
  /** État du panneau — piloté par le parent (bouton du footer). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { templates, templatesError, espace } = useCartoucheModels();

  const storageKey = `export:rack:${projectId}`;
  const [templateId, setTemplateId] = useLocalStorageState<string | null>(
    `${storageKey}:template`,
    STANDARD_MODEL_ID,
    { isValid: isStringOrNull },
  );
  const [paperFormat, setPaperFormat] = useLocalStorageState<PaperFormat>(
    `${storageKey}:paper`,
    "A4",
    { isValid: isPaperFormat },
  );
  const [orientation, setOrientation] = useLocalStorageState<Orientation>(
    `${storageKey}:orientation`,
    "LANDSCAPE",
    { isValid: isOrientation },
  );
  const [slotValues, setSlotValues] = useState<Record<string, string>>({});
  const [storedLayout, setStoredLayout] =
    useLocalStorageState<RackExportLayout>(
      `${storageKey}:layout`,
      EMPTY_RACK_EXPORT_LAYOUT,
      { isValid: isRackExportLayout },
    );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /**
   * Actions du composeur. Un ref et non un state : le composeur les publie
   * dans un effet, les stocker en state relancerait son rendu à chaque montage.
   */
  const composerActions = useRef<RackExportComposerActions | null>(null);
  const handleActionsReady = useCallback(
    (actions: RackExportComposerActions | null) => {
      composerActions.current = actions;
    },
    [],
  );

  const template =
    templateId === STANDARD_MODEL_ID
      ? null
      : (templates?.find((t) => t.id === templateId) ?? null);
  /** Cartouche intégré actif — y compris si le modèle mémorisé a disparu. */
  const isStandard = templateId === STANDARD_MODEL_ID || !template;

  // Modèle mémorisé disparu du catalogue → retour au cartouche intégré. On ne
  // bascule PAS sur un autre modèle de l'espace : le défaut du projet est le
  // modèle standard, pas le premier venu.
  useEffect(() => {
    if (!templates || templateId === STANDARD_MODEL_ID) return;
    if (!templates.some((t) => t.id === templateId)) {
      setTemplateId(STANDARD_MODEL_ID);
    }
  }, [templates, templateId, setTemplateId]);

  // Le papier suit le modèle CHOISI — mais seulement lors d'un vrai changement
  // de modèle : au premier rendu après restauration, on garde les réglages
  // mémorisés (sinon la composition changerait de feuille toute seule).
  const templateKey = template?.id ?? null;
  const lastAppliedTemplate = useRef<string | null>(null);
  useEffect(() => {
    if (!template) return;
    const isSwitch =
      lastAppliedTemplate.current !== null &&
      lastAppliedTemplate.current !== templateKey;
    lastAppliedTemplate.current = templateKey;
    if (isSwitch) {
      setPaperFormat(template.paperFormat);
      setOrientation(template.orientation);
    }
    setSlotValues(buildSmartOverrides(template, projectName, DOCUMENT_LABEL));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey, projectName]);

  /**
   * Composition effective : migration douce de la forme (les compositions
   * enregistrées avant les objets « lieu » n'ont pas de `kind`) et retrait des
   * objets dont la cible a disparu. On ne réécrit PAS le stockage — un
   * contenant absent d'un rendu transitoire ne doit pas détruire la
   * composition.
   */
  const layout = useMemo<RackExportLayout>(() => {
    if (containers.length === 0) return storedLayout;
    return normalizeRackExportLayout(storedLayout, {
      rackIds: new Set(containers.map((c) => c.id)),
      locationIds: new Set(locations.map((l) => l.id)),
    });
  }, [storedLayout, containers, locations]);

  const page = useMemo(
    () => pageSizeMm(paperFormat, orientation),
    [paperFormat, orientation],
  );

  /**
   * Composition de départ. Un lieu ne prend qu'une vue (il déploie déjà ses
   * contenants côte à côte), un contenant reprend toutes les vues affichées.
   * Calculée une fois à l'ouverture — la figer évite qu'un changement d'onglet
   * derrière le modal ne déplace la cible sous les pieds de l'utilisateur.
   */
  const seedRef = useRef<
    | { kind: "rack"; rackId: string; views: ViewId[] }
    | { kind: "location"; locationId: string; view: ViewId }
    | null
  >(null);
  if (seedRef.current === null && current) {
    const views = currentViews.length > 0 ? currentViews : ["FRONT" as ViewId];
    seedRef.current =
      current.kind === "rack"
        ? { kind: "rack", rackId: current.rackId, views }
        : { kind: "location", locationId: current.locationId, view: views[0]! };
  }
  const seed = seedRef.current;

  const stampRef = useRef(new Date().toISOString().slice(0, 10));
  const layoutOverrides = useMemo(
    () =>
      buildBaseOverrides({
        projectName,
        espace,
        stamp: stampRef.current,
        extra: { "{rack.name}": DOCUMENT_LABEL },
      }),
    [projectName, espace],
  );

  /**
   * Lieu affiché par le cartouche intégré : celui des objets posés. Un seul
   * lieu concerné → son nom ; plusieurs → « Plusieurs ». C'est l'information
   * utile sur une planche d'élévations, et elle se déduit de la composition —
   * rien à saisir.
   */
  const composedLocation = useMemo(() => {
    const names = new Set<string>();
    for (const item of layout.items) {
      const l =
        item.kind === "location"
          ? locations.find((x) => x.id === item.locationId)
          : item.kind === "rack"
            ? locations.find((x) => x.rackIds.includes(item.rackId))
            : undefined;
      if (l) names.add(l.name);
    }
    if (names.size === 1) return [...names][0]!;
    return names.size > 1 ? "Plusieurs" : null;
  }, [layout.items, locations]);

  // Logo de l'espace en dataURL : indispensable dans les deux rendus — jsPDF
  // n'accepte pas d'URL, et un SVG rasterisé via un blob ne charge aucune
  // ressource externe.
  const [logo, setLogo] = useState<{ dataUrl: string; ratio: number } | null>(
    null,
  );
  useEffect(() => {
    if (!espace.logoUrl) {
      setLogo(null);
      return;
    }
    let alive = true;
    void loadImageAsDataUrl(espace.logoUrl).then((r) => {
      if (alive) setLogo(r);
    });
    return () => {
      alive = false;
    };
  }, [espace.logoUrl]);

  /** SVG du cartouche intégré — source unique de l'écran ET du document. */
  const standardSvg = useMemo(
    () =>
      standardCartoucheSvg({
        pageW: page.w,
        pageH: page.h,
        projectName,
        location: composedLocation,
        documentLabel: DOCUMENT_LABEL,
        espaceName: espace.name,
        logo,
      }),
    [page.w, page.h, projectName, composedLocation, espace.name, logo],
  );

  /**
   * Zone utile déclarée par l'habillage. Connue seulement pour le cartouche
   * intégré : un cartouche WYSIWYG n'expose aucune géométrie exploitable (ses
   * blocs sont libres), l'éditeur retombe alors sur une marge générique.
   */
  const contentZone = useMemo(
    () => (isStandard ? standardComposerZone(page) : null),
    [isStandard, page],
  );

  // ── Habillage rasterisé pour l'éditeur ────────────────────────────────────
  // Exactement l'image que `buildComposedBlueprintPdf` composite sur la page :
  // l'éditeur montre donc où le cartouche mord, sans avoir à calculer une
  // « zone utile » qui n'existe nulle part dans le modèle de données.
  const [cartoucheUrl, setCartoucheUrl] = useState<string | null>(null);
  /**
   * Échec de rasterisation. Il DOIT remonter à l'écran : un habillage qui
   * échoue silencieusement donne une feuille nue, indiscernable d'un habillage
   * volontairement vide — c'est exactement ce qui a masqué le cartouche
   * standard quand son SVG était malformé.
   */
  const [overlayError, setOverlayError] = useState<string | null>(null);
  // Signature des valeurs saisies : l'objet change d'identité à chaque frappe,
  // c'est son CONTENU qui doit relancer la rasterisation.
  const slotValuesKey = JSON.stringify(slotValues);
  const slotValuesRef = useRef(slotValues);
  slotValuesRef.current = slotValues;

  /**
   * Rasterise l'habillage courant. `null` = modèle sans layout exploitable.
   * `forExport` choisit le budget : l'image d'écran n'a pas besoin de la
   * finesse d'impression, et elle est régénérée à chaque frappe.
   */
  const rasterizeOverlay = useCallback(
    (forExport = false): Promise<string | null> => {
      const budget = forExport
        ? OVERLAY_BUDGET_EXPORT_PX
        : OVERLAY_BUDGET_SCREEN_PX;
      if (isStandard) {
        const px = overlayPixelSize(page.w, page.h, budget);
        return svgStringToPngDataUrl(standardSvg, px.w, px.h, {
          transparent: true,
        });
      }
      if (template && cartoucheHasLayout(template)) {
        return rasterizeCartoucheLayout(
          template,
          { ...layoutOverrides, ...slotValuesRef.current },
          page.w,
          page.h,
          { maxPixels: budget },
        );
      }
      return Promise.resolve(null);
    },
    [isStandard, standardSvg, template, layoutOverrides, page.w, page.h],
  );

  useEffect(() => {
    if (!open) {
      setCartoucheUrl(null);
      setOverlayError(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void rasterizeOverlay()
        .then((url) => {
          if (!alive) return;
          setCartoucheUrl(url);
          setOverlayError(null);
        })
        .catch((e: unknown) => {
          if (!alive) return;
          // La composition reste manipulable, mais l'utilisateur doit savoir
          // que son habillage manque — et la console doit porter la cause.
          console.error("[rack-export] rasterisation du cartouche", e);
          setCartoucheUrl(null);
          setOverlayError("Cartouche illisible — habillage non affiché.");
        });
    }, CARTOUCHE_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // `slotValuesKey` : les valeurs saisies sont lues via une ref, c'est leur
    // CONTENU qui doit relancer la rasterisation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rasterizeOverlay, slotValuesKey]);

  /** Valeurs réellement saisies — les autres slots retombent sur le modèle. */
  const typedValues = useCallback((): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(slotValues)) if (v.trim()) out[k] = v;
    return out;
  }, [slotValues]);

  // ── Génération ────────────────────────────────────────────────────────────

  /**
   * Base des noms de fichiers : `Racks_{Projet}_{AAAA-MM-JJ}`. Le segment de
   * projet vient du MÊME slug que l'inventaire.
   */
  const fileBase = (stamp: string) =>
    `Racks_${slugifyName(projectName)}_${stamp}`;

  const onExport = async (
    category: ExportCategoryKey,
    variant?: string,
  ): Promise<ExportResult> => {
    const stamp = new Date().toISOString().slice(0, 10);

    if (category === "image") {
      const el = document.querySelector<HTMLElement>(
        RACK_COMPOSER_PAGE_SELECTOR,
      );
      if (!el) throw new Error("Page introuvable.");
      const canvas = await captureWithFlatten(el, {
        pixelRatio: 2,
        background: "#ffffff",
        hideSelectors: [RACK_COMPOSER_CHROME_SELECTOR],
      });
      const jpg = variant === "jpg";
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Capture image échouée"))),
          jpg ? "image/jpeg" : "image/png",
          jpg ? 0.9 : undefined,
        ),
      );
      return {
        blob,
        filename: `${fileBase(stamp)}.${jpg ? "jpg" : "png"}`,
      };
    }

    // Les emplacements pas encore configurés ne partent JAMAIS au document :
    // ils réservent une place à l'écran, ils ne représentent rien.
    const printable = exportableItems(layout);
    if (printable.length === 0) {
      throw new Error("Configurez au moins un objet de la page.");
    }

    const items = await captureRackItems(
      printable.map((i) => ({ id: i.id, x: i.x, y: i.y, w: i.w })),
    );
    // TOUTES les vues, ou aucune : un document amputé d'une élévation sans
    // rien dire vaut moins qu'un export qui refuse et invite à réessayer.
    if (items.length !== printable.length) {
      throw new Error("Vue non chargée — patientez puis réessayez.");
    }

    // L'habillage est rasterisé À L'EXPORT, pas repris de l'aperçu : celui-ci
    // est débouncé et pourrait être en retard d'une frappe.
    let overlay: ComposedBlueprintOverlay = { kind: "none" };
    if (isStandard) {
      // Un cartouche qui échoue ARRÊTE l'export : produire silencieusement un
      // plan sans son cartouche livrerait un document que l'utilisateur
      // croirait complet.
      const dataUrl = await rasterizeOverlay(true).catch((e: unknown) => {
        console.error("[rack-export] rasterisation du cartouche", e);
        throw new Error("Cartouche illisible — export interrompu.");
      });
      if (!dataUrl) throw new Error("Cartouche illisible — export interrompu.");
      overlay = { kind: "image", dataUrl };
    } else if (template) {
      overlay = {
        kind: "template",
        template,
        slotValues: buildSlotValues(template, typedValues()),
        overrides: layoutOverrides,
      };
    }

    const blob = await buildComposedBlueprintPdf({
      items,
      overlay,
      paperFormat,
      orientation,
    });
    return { blob, filename: `${fileBase(stamp)}.pdf`, pageCount: 1 };
  };

  // ── Colonne de réglages ───────────────────────────────────────────────────
  //
  // Deux blocs nettement séparés, et dans cet ordre :
  //   VUES     — ce qu'on compose, c'est là qu'on passe son temps ;
  //   DOCUMENT — le papier et son habillage, décidés une fois.
  //
  // Les mélanger obligeait à relire tout le panneau pour savoir si un réglage
  // portait sur la page ou sur la vue sélectionnée.
  const pageOptions = (
    <div className="space-y-4">
      <RackExportViewsPanel
        layout={layout}
        onLayoutChange={setStoredLayout}
        selectedIds={selectedIds}
        containers={containers}
        locations={locations}
        fallbackRenderMode={renderMode}
        actions={composerActions}
      />

      <section className="space-y-3 border-t border-[var(--border)]/60 pt-4">
        <p className="text-[10px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
          Document
        </p>
        <CartouchePicker
          templates={templates}
          templatesError={templatesError}
          selectedId={isStandard ? null : (template?.id ?? null)}
          onSelect={setTemplateId}
          compact
          leading={
            <TemplateChip
              label="Standard"
              active={isStandard}
              onClick={() => setTemplateId(STANDARD_MODEL_ID)}
            />
          }
        />
        <CartouchePaperOptions
          paperFormat={paperFormat}
          onPaperFormatChange={setPaperFormat}
          orientation={orientation}
          onOrientationChange={setOrientation}
          formats={PAPER_FORMATS}
        />
        {template && (
          <CartoucheSlotFields
            template={template}
            values={slotValues}
            onChange={(key, value) =>
              setSlotValues((prev) => ({ ...prev, [key]: value }))
            }
          />
        )}
      </section>
    </div>
  );

  // Un emplacement vide ne rend pas la page exportable : il n'y a rien dedans.
  const hasViews = exportableItems(layout).length > 0;

  return (
    <ExportMenu
      open={open}
      onOpenChange={onOpenChange}
      title="Exporter les élévations"
      // L'éditeur de mise en page se passe d'intitulé : il occupe toute la
      // colonne et son contenu dit ce qu'il est.
      previewLabel={null}
      customPreview={
        <RackExportComposer
          projectId={projectId}
          containers={containers}
          locations={locations}
          layout={layout}
          onLayoutChange={setStoredLayout}
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          onActionsReady={handleActionsReady}
          seed={seed}
          paperFormat={paperFormat}
          orientation={orientation}
          cartoucheUrl={cartoucheUrl}
          cartoucheError={overlayError}
          contentZone={contentZone}
          renderMode={renderMode}
          showInfo={viewMode === "schema"}
        />
      }
      formats={[
        {
          key: "pdf",
          label: "PDF",
          disabled: !hasViews,
          options: pageOptions,
        },
        {
          key: "image",
          label: "Image",
          variants: [
            { key: "png", label: "PNG" },
            { key: "jpg", label: "JPG" },
          ],
          disabled: !hasViews,
          options: pageOptions,
        },
      ]}
      onExport={onExport}
      storageKey={storageKey}
    />
  );
}
