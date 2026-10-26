"use client";

/**
 * EquipmentIcon — composant unifié pour l'icône d'un équipement catalogue.
 *
 * Résolution :
 *   1. `iconUrl` (override sur CatalogEquipment) si défini
 *   2. `categoryIconId` (héritage CatalogEquipmentCategory) si défini
 *   3. Fallback `Package` (lucide)
 *
 * Chaque valeur (`iconUrl` / `categoryIconId`) peut être :
 *   - un nom lucide curated (cf. `BROADCAST_LUCIDE_ICONS`) → composant SVG
 *   - une URL (commence par `/` ou `http`) → balise `<img>`
 *
 * Pattern aligné sur `components/ui/connector-icon.tsx` (détection URL vs nom).
 */

import {
  Antenna,
  AudioWaveform,
  Battery,
  Box,
  Cable,
  Camera,
  Cpu,
  Disc,
  Fan,
  Film,
  Globe,
  HardDrive,
  Headphones,
  Headset,
  Image as ImageIcon,
  Lightbulb,
  Lock,
  MicVocal,
  Monitor,
  Package,
  Phone,
  PlayCircle,
  Plug,
  Radio,
  RectangleHorizontal,
  Router,
  Rss,
  Satellite,
  Server,
  Settings,
  SlidersHorizontal,
  Speaker,
  Tv,
  Video,
  Wifi,
  Zap,
  type LucideIcon,
} from "@/components/ui/icons";

// ── Curated set ──────────────────────────────────────────────────────────────
//
// Liste curated d'icônes broadcast pertinentes — utilisée pour :
//  - le rendu (lookup id → composant)
//  - le picker (grid affichée à l'utilisateur)
//
// Ajouter une icône ici la rend automatiquement disponible dans le picker.

export const BROADCAST_LUCIDE_ICONS: Array<{
  id: string;
  Component: LucideIcon;
  label: string;
}> = [
  { id: "camera", Component: Camera, label: "Caméra" },
  { id: "video", Component: Video, label: "Vidéo" },
  { id: "server", Component: Server, label: "Serveur" },
  { id: "router", Component: Router, label: "Switch / Routeur" },
  { id: "tv", Component: Tv, label: "Écran / TV" },
  { id: "monitor", Component: Monitor, label: "Moniteur" },
  { id: "mic-vocal", Component: MicVocal, label: "Micro" },
  { id: "speaker", Component: Speaker, label: "Enceinte" },
  { id: "headphones", Component: Headphones, label: "Casque" },
  { id: "lightbulb", Component: Lightbulb, label: "Lumière" },
  { id: "zap", Component: Zap, label: "Alimentation" },
  { id: "antenna", Component: Antenna, label: "Antenne" },
  { id: "satellite", Component: Satellite, label: "Satellite RF" },
  { id: "radio", Component: Radio, label: "Radio HF" },
  { id: "cable", Component: Cable, label: "Câble" },
  { id: "plug", Component: Plug, label: "Connecteur" },
  { id: "cpu", Component: Cpu, label: "Processeur" },
  { id: "hard-drive", Component: HardDrive, label: "Enregistreur / Stockage" },
  { id: "disc", Component: Disc, label: "Disque" },
  { id: "play-circle", Component: PlayCircle, label: "Player" },
  { id: "film", Component: Film, label: "Caméra cinéma" },
  { id: "image", Component: ImageIcon, label: "Image" },
  { id: "sliders-horizontal", Component: SlidersHorizontal, label: "Mixer / Console" },
  { id: "audio-waveform", Component: AudioWaveform, label: "Audio" },
  { id: "wifi", Component: Wifi, label: "Sans-fil" },
  { id: "rss", Component: Rss, label: "Diffusion" },
  { id: "globe", Component: Globe, label: "Internet" },
  { id: "phone", Component: Phone, label: "Téléphone" },
  { id: "headset", Component: Headset, label: "Intercom" },
  { id: "rectangle-horizontal", Component: RectangleHorizontal, label: "Patch panel" },
  { id: "box", Component: Box, label: "Contenant / Boîtier" },
  { id: "package", Component: Package, label: "Générique" },
  { id: "fan", Component: Fan, label: "Refroidissement" },
  { id: "battery", Component: Battery, label: "Batterie" },
  { id: "lock", Component: Lock, label: "Sécurité" },
  { id: "settings", Component: Settings, label: "Outil / Config" },
];

// Map id → composant pour lookup O(1).
const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  BROADCAST_LUCIDE_ICONS.map((i) => [i.id, i.Component]),
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Détecte si une valeur est une URL (uploadée ou externe) plutôt qu'un nom lucide. */
export function isIconUrl(value: string): boolean {
  return value.startsWith("/") || value.startsWith("http");
}

// ── Composant principal ──────────────────────────────────────────────────────

export function EquipmentIcon({
  iconUrl,
  categoryIconId,
  size = 16,
  className,
  color,
}: {
  /** Override équipement — nom lucide ou URL uploadée. */
  iconUrl?: string | null;
  /** Héritage catégorie — nom lucide ou URL uploadée. */
  categoryIconId?: string | null;
  /** Taille en pixels (côté carré). Défaut : 16. */
  size?: number;
  className?: string;
  /** Couleur du trait pour le rendu lucide. Défaut : currentColor. */
  color?: string;
}) {
  // Résolution : équipement > catégorie > fallback Package
  const resolved = iconUrl?.trim() || categoryIconId?.trim() || null;

  if (resolved && isIconUrl(resolved)) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={resolved}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{
          width: size,
          height: size,
          objectFit: "contain",
        }}
      />
    );
  }

  const Icon: LucideIcon = (resolved && ICON_MAP[resolved]) || Package;
  return <Icon size={size} className={className} color={color} strokeWidth={1.75} />;
}
