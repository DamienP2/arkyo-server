"use client";

/**
 * ProjectViewExport — export unifié partagé par les onglets VISUELS (Synoptique,
 * Cartographie), via le modal partagé `ExportMenu` :
 *
 *  - **Image** (PNG | JPG) : capture raster de l'élément de vue
 *      (`captureSelector`). JPG : qualité 0.9, fond blanc.
 *  - **PDF** : sortie blueprint via un modèle **Cartouche**
 *      (`TenantPrintTemplate`). Options : modèle, format papier, orientation,
 *      slots VARIABLE (pré-remplis depuis le projet). Génération PURE via
 *      `buildBlueprintPdf` : `ExportMenu` télécharge et prévisualise à partir
 *      du même blob.
 *  - **Mode poster** (prop `poster`, Synoptique) : la génération est déléguée
 *      au canvas (plan A0→A4). Options : format, cadrage, rendu, révision +
 *      modèle Cartouche transmis en spec au générateur.
 *
 * L'élément capturé est résolu à l'export (`document.querySelector`) pour rester
 * indépendant du cycle de rendu du canvas (agent-canvas). Les préfixes de
 * fichier (`SYNOPTIQUE_`, `CARTO_`…) restent une convention de NOMMAGE — la
 * bibliothèque de documents qui s'en servait pour deviner l'origine a été
 * retirée.
 */

import React, { useEffect, useState } from "react";

import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";

import {
  buildBlueprintPdf,
  buildComposedBlueprintPdf,
  cartoucheHasLayout,
  rasterizeCartoucheLayout,
  type CartoucheTemplate,
} from "@/lib/print/export-with-cartouche";
import {
  ExportLivePage,
  ExportFramingActions,
  type ExportPageClone,
  type ExportPageCamera,
  type ExportPageFrame,
  type ExportPageFramingActions,
} from "./export-live-page";
import { svgStringToPngDataUrl } from "@/lib/print/render-print-layout";
import {
  CARTOUCHE_LAYER_DPI,
  loadImageAsDataUrl,
  standardCartoucheContentZone,
  standardCartoucheSvg,
  wysiwygContentZone,
} from "@/lib/print/technical-frame";
import {
  getPaperDimensionsMm,
  type Orientation,
  type PaperFormat,
} from "@/lib/services/print-layout";
import { slugifyName } from "@/lib/utils";

import { ExportMenu, type ExportCategoryKey, type ExportResult } from "./export-menu";
import {
  buildSlotValues,
  buildSmartOverrides,
  CartouchePaperOptions,
  CartouchePicker,
  CartoucheSlotFields,
  TemplateChip,
  useCartoucheModels,
} from "./export-cartouche-options";
import {
  PosterExportOptions,
  buildBaseOverrides,
  type PosterFormat,
  type PosterKind,
  type PosterRender,
} from "./export-pdf-model-options";
import { captureWithFlatten } from "../reseau/_components/shared/export-capture";

/**
 * Générateur d'export « grand format » (poster). Fourni par l'onglet qui
 * dispose d'un canvas capable de produire un plan A0→A4 (Synoptique via
 * `synopticRef.exportPdf`). La spec `cartouche` (modèle + valeurs de slots)
 * remplace les champs codés en dur du cartouche poster quand elle est fournie.
 */
export type PosterExporter = (opts: {
  format: PosterFormat;
  /**
   * Cadrage à reproduire : la boîte de rendu et la caméra choisis dans
   * l'aperçu. C'est la définition du périmètre exporté — l'ancien choix entre
   * « vue actuelle » et « vue complète » a disparu au profit d'un cadrage
   * direct sur la page.
   */
  frame?: ExportPageFrame;
  revision: string;
  kind: PosterKind;
  /** Plan en objets vectoriels ou en image. Voir `PosterRender`. */
  render?: PosterRender;
  cartouche?: {
    template?: CartoucheTemplate;
    slotValues?: Record<string, string>;
    /** Variables `{namespace.champ}` pour le layout WYSIWYG du modèle. */
    overrides?: Record<string, string | null | undefined>;
    /** Calque pleine page sous sa forme source (Modèle standard). */
    overlaySvg?: string;
    /**
     * Aplatissement du même calque, À LA DEMANDE. Le rendu vectoriel n'en a
     * pas besoin, et le calculer d'office figeait le fil plusieurs secondes
     * pour un résultat jeté.
     */
    rasterizeOverlay?: () => Promise<string>;
  };
  /** Résolution de capture — abaissée pour l'aperçu, pleine à l'export. */
  pixelRatio?: number;
  /**
   * Plafond ABSOLU de pixels pour la capture. La surface source dépend de la
   * taille du plan : un ratio seul ne borne pas la mémoire.
   */
  maxCapturePixels?: number;
  /**
   * Générateur PUR : il RENVOIE le document, il ne le télécharge pas. C'est ce
   * qui permet au modal d'en faire un aperçu et de proposer les deux actions
   * habituelles — le poster était le seul export du produit à en être privé.
   */
}) => Promise<{ blob: Blob; pageCount?: number }>;

// ── Validateurs des réglages restaurés ───────────────────────────────────────

const PAPER_FORMATS: PaperFormat[] = [
  "A4",
  "A3",
  "A2",
  "A1",
  "A0",
  "LETTER",
  "LEGAL",
];

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}
function isPaperFormat(v: unknown): v is PaperFormat {
  return PAPER_FORMATS.includes(v as PaperFormat);
}
function isOrientation(v: unknown): v is Orientation {
  return v === "PORTRAIT" || v === "LANDSCAPE";
}

/**
 * Cartouche intégré — même grammaire « grille allégée » que l'inventaire et
 * l'export Rack (`lib/print/technical-frame`). Ce n'est PAS un modèle de
 * l'espace : il vit dans la même liste de choix, mais son rendu est dessiné en
 * SVG, pas par un layout WYSIWYG.
 */
const STANDARD_MODEL_ID = "standard";

/**
 * Budget de pixels du calque : plein à l'export, réduit pour l'aperçu.
 *
 * 36 Mpx à l'export donne ~153 dpi en A0, ~215 en A1 et 300 en A4 — le
 * cartouche est du TRAIT et du TEXTE, c'est là que la mollesse au zoom se voit
 * en premier. Le budget reste absolu : c'est la seule borne qui dise quelque
 * chose de la mémoire, la surface source dépendant du format de page.
 */
const OVERLAY_BUDGET_EXPORT_PX = 36_000_000;
const OVERLAY_BUDGET_PREVIEW_PX = 2_000_000;

/**
 * Rasterisation du calque : plafond en dpi ET plafond de côté, PUIS rabattu
 * dans un budget de pixels absolu.
 *
 * Le seul plafond en dpi ne suffisait pas : un A1 y donnait déjà ~25 Mpx, soit
 * un canvas et une dataURL base64 de plusieurs dizaines de mégaoctets — alloués
 * à CHAQUE régénération d'aperçu. C'est ce qui épuisait la mémoire de l'onglet.
 * À l'inverse, l'ancien plafond de 6000 px de côté bridait les grands formats
 * à ~128 dpi et le budget n'entrait jamais en jeu : c'est lui qui rendait les
 * A0/A1 mous. Les deux bornes sont donc desserrées, le budget arbitre.
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

/** Letterbox d'un ratio dans une zone, centré. */
function fitInto(
  ratio: number,
  zone: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const zoneRatio = zone.w / zone.h;
  const w = ratio > zoneRatio ? zone.w : zone.h * ratio;
  const h = ratio > zoneRatio ? zone.w / ratio : zone.h;
  return {
    x: zone.x + (zone.w - w) / 2,
    y: zone.y + (zone.h - h) / 2,
    w,
    h,
  };
}

export function ProjectViewExport({
  projectId,
  projectName,
  filePrefix,
  title,
  description,
  viewLabel,
  captureSelector,
  captureMissingMessage,
  hideSelectors,
  canExport,
  open,
  onOpenChange,
  poster,
  fileStem,
  locationLabel,
  buildPreviewClone,
}: {
  projectId: string;
  projectName: string;
  /**
   * Racine du nom de fichier : `{fileStem}_{Projet}_{AAAA-MM-JJ}`. Absent →
   * ancien schéma `{filePrefix}{date}`.
   */
  fileStem?: string;
  /** Valeur de la cellule LIEU du cartouche intégré. « — » si absente. */
  locationLabel?: string | null;
  /**
   * Copie inerte de la vue, pour l'aperçu VIVANT. Quand elle est fournie, la
   * colonne d'aperçu devient la page elle-même — plus de document généré à
   * attendre. Réservée aux onglets dont le canvas sait se cloner (Synoptique).
   */
  buildPreviewClone?: (opts: {
    box: { w: number; h: number };
    camera?: ExportPageCamera;
  }) => ExportPageClone | null;
  /** Préfixe stable des fichiers générés (ex. `SYNOPTIQUE_`, `CARTO_`). */
  filePrefix: string;
  title: string;
  description?: string;
  /** Nom de la vue (« Synoptique », « Cartographie »…) — pré-remplit les slots. */
  viewLabel: string;
  /** Sélecteur CSS de l'élément de vue à capturer. */
  captureSelector: string;
  captureMissingMessage: string;
  /** Éléments à masquer pendant la capture (grille, règles, chrome d'édition…). */
  hideSelectors?: string[];
  /** Formats désactivés si false (pas de vue exportable). */
  canExport: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Générateur poster « grand format » (optionnel). Quand fourni, le format PDF
   * est généré par le canvas (plan A0→A4 / PNG HD) avec la spec cartouche.
   */
  poster?: PosterExporter;
}) {
  const { templates, templatesError, espace } = useCartoucheModels();

  // ── Modèle Cartouche + format papier + slots ──────────────────────────────
  // Modèle / papier / orientation sont mémorisés par vue et par projet ; les
  // valeurs de slots restent volatiles (elles dépendent de l'export du moment).
  // `filePrefix` distingue les vues qui partagent ce composant (synoptique,
  // cartographie, rack…).
  const storageKey = `export:${filePrefix.replace(/_+$/, "").toLowerCase() || "vue"}:${projectId}`;
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

  const template =
    templateId === STANDARD_MODEL_ID
      ? null
      : (templates?.find((t) => t.id === templateId) ?? null);
  /** Cartouche intégré actif — y compris si le modèle mémorisé a disparu. */
  const isStandard = templateId === STANDARD_MODEL_ID || !template;

  // Modèle mémorisé disparu du catalogue → retour au cartouche intégré. On ne
  // bascule PAS sur un autre modèle de l'espace : le défaut est le standard,
  // pas le premier venu.
  useEffect(() => {
    if (!templates || templateId === STANDARD_MODEL_ID) return;
    if (!templates.some((t) => t.id === templateId)) {
      setTemplateId(STANDARD_MODEL_ID);
    }
  }, [templates, templateId, setTemplateId]);

  // ── Cartouche intégré ─────────────────────────────────────────────────────
  // Logo en dataURL : un SVG rasterisé via un blob ne charge aucune ressource
  // externe, seule une image embarquée y est visible.
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

  /**
   * Calque du cartouche intégré, rasterisé pour un format donné. Le mode
   * poster impose son propre papier (toujours paysage) : la taille de page ne
   * peut pas être figée ici.
   */
  /**
   * Source SVG du cartouche intégré. Séparée de la rasterisation : le rendu
   * vectoriel la consomme telle quelle, sans passer par l'aplat.
   */
  const standardSvgFor = React.useCallback(
    (pw: number, ph: number): string =>
      standardCartoucheSvg({
        pageW: pw,
        pageH: ph,
        projectName,
        location: locationLabel ?? null,
        documentLabel: viewLabel,
        espaceName: espace.name,
        logo,
      }),
    [projectName, locationLabel, viewLabel, espace.name, logo],
  );

  const rasterizeStandard = React.useCallback(
    async (pw: number, ph: number, budgetPx: number): Promise<string> => {
      const px = overlayPixelSize(pw, ph, budgetPx);
      return svgStringToPngDataUrl(standardSvgFor(pw, ph), px.w, px.h, {
        transparent: true,
      });
    },
    [standardSvgFor],
  );

  // Le format papier / l'orientation / les slots suivent le modèle CHOISI —
  // un changement de modèle réinitialise la mise en page à celle du modèle.
  const templateKey = template?.id ?? null;
  const lastAppliedTemplate = React.useRef<string | null>(null);
  useEffect(() => {
    if (!template) return;
    // Au premier rendu après restauration, ne pas écraser le papier/orientation
    // mémorisés : on ne réaligne que lors d'un VRAI changement de modèle.
    const isSwitch =
      lastAppliedTemplate.current !== null &&
      lastAppliedTemplate.current !== templateKey;
    lastAppliedTemplate.current = templateKey;
    if (isSwitch) {
      setPaperFormat(template.paperFormat);
      setOrientation(template.orientation);
    }
    setSlotValues(buildSmartOverrides(template, projectName, viewLabel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey, projectName, viewLabel]);

  // ── Mode poster (Synoptique) : format / révision ──────────────────────────
  const [posterFormat, setPosterFormat] = useState<PosterFormat>("A1");
  /**
   * Cadrage courant de l'aperçu. En ref : il change à chaque cran de molette,
   * et rien à l'écran n'en dépend hors de la page elle-même, qui l'applique
   * directement. Le mettre en état ferait un rendu par image de geste.
   */
  const frameRef = React.useRef<ExportPageFrame | null>(null);
  /**
   * Commandes de cadrage publiées par la page vivante. En ÉTAT et non en ref :
   * la colonne de réglages doit se re-rendre quand elles apparaissent.
   */
  const [framingActions, setFramingActions] =
    useState<ExportPageFramingActions | null>(null);
  /**
   * Le poster ne produit plus que du PDF. Le PNG reste accessible par la
   * catégorie « Image » du modal — c'était la même décision proposée deux fois,
   * à deux endroits, avec deux vocabulaires.
   */
  const posterKind: PosterKind = "pdf";
  /**
   * Rendu du plan. Défaut IMAGE : le vectoriel est neuf, et un défaut qui
   * change la sortie de tout le monde avant validation visuelle n'est pas un
   * défaut, c'est un pari. Il se bascule d'un clic dans le panneau.
   */
  const [posterRender, setPosterRender] = useState<PosterRender>("raster");
  const [posterRevision, setPosterRevision] = useState("A");

  /**
   * Préchauffage des bibliothèques d'export dès l'ouverture du modal.
   *
   * Sans lui, le clic sur « Télécharger » commence par attendre deux scripts
   * distants : l'interface paraît figée alors que rien n'a encore commencé. Le
   * temps de réglage du cadrage suffit largement à les charger. Les deux sont
   * mémoïsés, l'appel est donc sans effet aux ouvertures suivantes.
   */
  useEffect(() => {
    if (!open || !poster) return;
    void import("@/lib/pdf/synoptic-vector")
      .then((m) => m.ensureSvg2Pdf())
      .catch(() => {
        // Silencieux : l'échec sera signalé au moment de l'export, avec sa
        // cause. Prévenir ici d'un problème qui n'en est peut-être pas un
        // (l'utilisateur peut vouloir un rendu image) serait du bruit.
      });
  }, [open, poster]);

  /** Valeurs réellement saisies (trim non vide) — les autres slots retombent
   *  sur le défaut du modèle puis l'exemple. */
  const typedValues = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(slotValues)) {
      if (v.trim()) out[k] = v;
    }
    return out;
  };

  const getEl = (): HTMLElement => {
    const el = document.querySelector<HTMLElement>(captureSelector);
    if (!el) throw new Error(captureMissingMessage);
    return el;
  };

  /**
   * Base du nom de fichier. Avec `fileStem` : `{Stem}_{Projet}_{date}`, même
   * schéma que l'inventaire et le rack. Sans : ancien `{PREFIX}{date}`, pour
   * ne rien changer aux onglets qui ne l'ont pas demandé.
   */
  const fileBase = (stamp: string) =>
    fileStem
      ? `${fileStem}_${slugifyName(projectName)}_${stamp}`
      : `${filePrefix}${stamp}`;

  /**
   * Génération « poster » (plan A0→A4 / PNG HD), déléguée au canvas.
   *
   * Le poster impose son propre papier, TOUJOURS paysage : le calque du
   * cartouche intégré est donc rasterisé à SA taille, pas à celle du sélecteur
   * de papier.
   *
   * Cette fonction ne sert plus QUE l'export réel : l'aperçu est la page
   * vivante, il ne génère rien. Chaque allocation reste plafonnée par un budget
   * de pixels ABSOLU — capture ET calque du cartouche. Un ratio relatif ne
   * protégeait de rien : la surface source dépend de la taille du plan, pas
   * d'un facteur.
   */
  const runPoster = async (
    stamp: string,
    layoutOverrides: Record<string, string | null | undefined>,
  ): Promise<{ blob: Blob; filename: string; pageCount?: number }> => {
    if (!poster) throw new Error("Générateur indisponible.");
    const posterPage = getPaperDimensionsMm(posterFormat, "LANDSCAPE");
    const overlayBudget = OVERLAY_BUDGET_EXPORT_PX;
    const cartouche =
      posterKind !== "pdf"
        ? undefined
        : isStandard
          ? {
              // Le même habillage, décrit une fois. Le générateur choisit sa
              // forme selon le rendu : la source en vectoriel, l'aplat sinon —
              // et l'aplat n'est calculé QUE s'il sert.
              overlaySvg: standardSvgFor(posterPage.w, posterPage.h),
              rasterizeOverlay: () =>
                rasterizeStandard(posterPage.w, posterPage.h, overlayBudget),
            }
          : template
            ? {
                template,
                slotValues: buildSlotValues(template, typedValues()),
                overrides: layoutOverrides,
              }
            : undefined;
    if (posterKind === "pdf" && !cartouche) {
      throw new Error("Sélectionnez un modèle.");
    }
    const { blob, pageCount } = await poster({
      format: posterFormat,
      // Le cadrage de l'aperçu, transmis verbatim : le document est ce que la
      // page montre, sans recalcul intermédiaire qui pourrait en dévier.
      frame: frameRef.current ?? undefined,
      revision: posterRevision,
      kind: posterKind,
      render: posterRender,
      // Résolution d'impression. 64 Mpx ≈ 200 dpi en A0 et ≈ 280 en A1 : c'est
      // ce qui manquait, l'ancien plafond de 24 Mpx retombait à ~124 dpi sur un
      // A0 et se voyait dès qu'on zoomait dans le PDF. L'allocation est
      // transitoire (un canvas, une dataURL, tous deux relâchés aussitôt) — ce
      // n'est pas elle qui faisait tomber l'onglet, mais la rasterisation
      // RÉPÉTÉE de l'aperçu, qui ne génère plus rien.
      pixelRatio: 4,
      maxCapturePixels: 64_000_000,
      cartouche,
    });
    return {
      blob,
      filename: `${fileBase(stamp)}.pdf`,
      pageCount,
    };
  };

  const onExport = async (
    category: ExportCategoryKey,
    variant?: string,
  ): Promise<ExportResult> => {
    const stamp = new Date().toISOString().slice(0, 10);
    // Variables du layout WYSIWYG du cartouche (nom projet, espace, dates).
    const layoutOverrides = buildBaseOverrides({
      projectName,
      espace,
      stamp,
      extra: { "{rack.name}": viewLabel },
    });

    if (category === "image") {
      const el = getEl();
      const canvas = await captureWithFlatten(el, {
        pixelRatio: 2,
        background: "#ffffff",
        hideSelectors,
      });
      const jpg = variant === "jpg";
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Capture image échouée"))),
          jpg ? "image/jpeg" : "image/png",
          jpg ? 0.9 : undefined,
        ),
      );
      return { blob, filename: `${fileBase(stamp)}.${jpg ? "jpg" : "png"}` };
    }

    if (category === "pdf" && poster) {
      return runPoster(stamp, layoutOverrides);
    }

    // ── PDF blueprint (cartouche) ─────────────────────────────────────────
    // Génération PURE : `ExportMenu` télécharge, et réutilise la même sortie
    // pour l'aperçu.
    const { w: PW, h: PH } = getPaperDimensionsMm(paperFormat, orientation);

    if (isStandard) {
      // Le cartouche intégré a des bandes OPAQUES : la capture se pose dans sa
      // zone de composition, pas pleine page. Même mécanique que l'export Rack
      // — un seul objet occupant toute la zone.
      const canvas = await captureWithFlatten(getEl(), {
        pixelRatio: 2,
        background: "#ffffff",
        hideSelectors,
      });
      const zone = standardCartoucheContentZone(PW, PH);
      const INSET = 4;
      const rect = fitInto(canvas.width / Math.max(1, canvas.height), {
        x: zone.x + INSET,
        y: zone.y + INSET,
        w: zone.w - INSET * 2,
        h: zone.h - INSET * 2,
      });
      const blob = await buildComposedBlueprintPdf({
        items: [{ dataUrl: canvas.toDataURL("image/jpeg", 0.85), ...rect }],
        overlay: {
          kind: "image",
          dataUrl: await rasterizeStandard(PW, PH, OVERLAY_BUDGET_EXPORT_PX),
        },
        paperFormat,
        orientation,
      });
      return { blob, filename: `${fileBase(stamp)}.pdf`, pageCount: 1 };
    }

    if (!template) throw new Error("Sélectionnez un modèle.");
    const blob = await buildBlueprintPdf({
      el: getEl(),
      template,
      slotValues: buildSlotValues(template, typedValues()),
      paperFormat,
      orientation,
      background: "#ffffff",
      hideSelectors,
      overrides: layoutOverrides,
    });
    return { blob, filename: `${fileBase(stamp)}.pdf`, pageCount: 1 };
  };

  /**
   * Calque du cartouche pour l'aperçu vivant. Rasterisé à petit budget — c'est
   * une image d'écran, pas une planche d'impression — et re-généré quand la
   * page ou le modèle change.
   */
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const slotValuesKey = JSON.stringify(typedValues());
  // Booléen et non la fonction : `buildPreviewClone` est une lambda du parent,
  // son identité change à chaque rendu de l'onglet. En dépendance directe,
  // elle relancerait une rasterisation à chaque frappe ailleurs dans la page.
  const hasLivePreview = !!buildPreviewClone;
  useEffect(() => {
    if (!open || !poster || !hasLivePreview) {
      setOverlayUrl(null);
      return;
    }
    let alive = true;
    const page = getPaperDimensionsMm(posterFormat, "LANDSCAPE");
    const stamp = new Date().toISOString().slice(0, 10);
    const task = isStandard
      ? rasterizeStandard(page.w, page.h, OVERLAY_BUDGET_PREVIEW_PX)
      : template && cartoucheHasLayout(template)
        ? rasterizeCartoucheLayout(
            template,
            {
              ...buildBaseOverrides({
                projectName,
                espace,
                stamp,
                extra: { "{rack.name}": viewLabel },
              }),
              ...buildSlotValues(template, typedValues()),
            },
            page.w,
            page.h,
            { maxPixels: OVERLAY_BUDGET_PREVIEW_PX },
          )
        : Promise.resolve(null);
    void task
      .then((url) => {
        if (alive) setOverlayUrl(url);
      })
      .catch(() => {
        if (alive) setOverlayUrl(null);
      });
    return () => {
      alive = false;
    };
    // `typedValues` est lu au moment du rendu ; c'est sa SIGNATURE qui doit
    // relancer la rasterisation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    poster,
    hasLivePreview,
    posterFormat,
    isStandard,
    template,
    rasterizeStandard,
    slotValuesKey,
  ]);

  // ── Aperçu VIVANT ─────────────────────────────────────────────────────────
  // Quand l'onglet sait cloner sa vue, la colonne d'aperçu devient la page :
  // rien à générer, rien à attendre. Le document reste produit par le pipeline
  // de capture, sur le MÊME clone et le MÊME cadrage — il ne peut donc pas
  // diverger de l'aperçu.
  const posterPage = getPaperDimensionsMm(posterFormat, "LANDSCAPE");
  // Le plan occupe TOUTE la feuille — le cartouche le masque là où ses bandes
  // sont opaques. Cette zone ne sert donc pas à découper : elle sert de cible
  // à l'ajustement, pour qu'« Ajuster » place le plan là où il se VOIT, et non
  // pour moitié sous l'en-tête.
  const posterZone = isStandard
    ? standardCartoucheContentZone(posterPage.w, posterPage.h)
    : wysiwygContentZone(posterPage.w, posterPage.h);
  const livePreview =
    poster && buildPreviewClone ? (
      <ExportLivePage
        buildClone={buildPreviewClone}
        pageW={posterPage.w}
        pageH={posterPage.h}
        fitZone={posterZone}
        cartoucheUrl={overlayUrl}
        onFrameChange={(f) => {
          frameRef.current = f;
        }}
        onActionsChange={setFramingActions}
        // La copie est un instantané : elle est refaite à chaque changement de
        // réglage qui modifie la forme de la page.
        refreshKey={`${posterFormat}:${templateId ?? "none"}`}
      />
    ) : null;

  /** Le cartouche intégré vit dans la même liste que les modèles de l'espace. */
  const modelPicker = (
    <CartouchePicker
      templates={templates}
      templatesError={templatesError}
      selectedId={isStandard ? null : (template?.id ?? null)}
      onSelect={setTemplateId}
      compact
      leading={
        // « Intégré » et non « Standard » : un modèle de l'espace peut
        // légitimement s'appeler « Standard », et les deux pastilles étaient
        // alors indiscernables.
        <TemplateChip
          label="Intégré"
          active={isStandard}
          onClick={() => setTemplateId(STANDARD_MODEL_ID)}
        />
      }
    />
  );

  const cartoucheOptions = (
    <>
      {modelPicker}
      {template && (
        <CartoucheSlotFields
          template={template}
          values={slotValues}
          onChange={(key, value) =>
            setSlotValues((prev) => ({ ...prev, [key]: value }))
          }
        />
      )}
    </>
  );

  return (
    <ExportMenu
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      formats={[
        {
          key: "pdf",
          label: "PDF",
          // Pas de sous-titre : le panneau montre déjà format et modèle, et
          // l'aperçu montre le résultat.
          // Le cartouche intégré est toujours disponible : plus de dépendance
          // à l'existence d'un modèle de l'espace.
          disabled: !canExport,
          // Plus aucune catégorie atomique : le poster renvoie un blob comme
          // les autres. Son aperçu, lui, ne passe plus par une génération :
          // c'est la page vivante — portée par la catégorie, pour que le PNG
          // garde le sien.
          customPreview: livePreview,
          options: poster ? (
            <div className="space-y-3">
              <PosterExportOptions
                kind={posterKind}
                format={posterFormat}
                onFormatChange={setPosterFormat}
                render={posterRender}
                onRenderChange={setPosterRender}
                revision={posterRevision}
                onRevisionChange={setPosterRevision}
                // Le cartouche intégré n'imprime pas de révision : le champ
                // n'apparaît qu'avec un modèle de l'espace, qui la consomme.
                showRevision={!isStandard}
              />
              {/* Le cadrage se règle à la main sur la page ; ces deux commandes
                  en sont les repères — même rangée d'actions que le composeur
                  Rack, à la même place dans la colonne. */}
              {buildPreviewClone && (
                <ExportFramingActions actions={framingActions} />
              )}
              {posterKind === "pdf" && cartoucheOptions}
            </div>
          ) : (
            <div className="space-y-3">
              {modelPicker}
              <CartouchePaperOptions
                paperFormat={paperFormat}
                onPaperFormatChange={setPaperFormat}
                orientation={orientation}
                onOrientationChange={setOrientation}
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
            </div>
          ),
        },
        {
          key: "image",
          label: "Image",
          description: "Capture de la vue",
          variants: [
            { key: "png", label: "PNG" },
            { key: "jpg", label: "JPG" },
          ],
          disabled: !canExport,
        },
      ]}
      onExport={onExport}
      storageKey={storageKey}
      // Tout ce qui change la sortie : modèle, papier, orientation, valeurs de
      // slots saisies — le slot `options` est opaque pour le modal — plus les
      // réglages du mode poster (format, révision). Le cartouche intégré
      // dépend en outre du lieu et du logo de l'espace, résolus en asynchrone :
      // sans eux, l'aperçu resterait figé sur la première version.
      previewKey={[
        templateId ?? "none",
        paperFormat,
        orientation,
        posterKind,
        posterFormat,
        posterRender,
        posterRevision,
        locationLabel ?? "",
        logo ? "logo" : "-",
        espace.name ?? "",
        JSON.stringify(typedValues()),
      ].join(":")}
    />
  );
}
