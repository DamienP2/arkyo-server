/**
 * Registry d'icônes par défaut pour les `CatalogType` (Classification > Type).
 *
 * Ces icônes sont utilisées comme :
 *  - placeholder dans l'éditeur équipement quand un CatalogEquipment n'a pas
 *    d'iconUrl propre (la classification donne une icône représentative)
 *  - dans la légende du drawing-editor (fallback typeIconId)
 *  - éventuellement comme icône grise dans les pickers / listes
 *
 * La liste est curated pour la broadcast/AV — pas une recherche libre dans
 * toute la lib `lucide`. Pour ajouter une icône, importer le composant et
 * pousser une entrée ci-dessous.
 */

import {
  Antenna,
  Bell,
  Box,
  Cable,
  Camera,
  Circle,
  Clapperboard,
  Cog,
  Cpu,
  Database,
  Drum,
  Film,
  Flame,
  Flashlight,
  Gauge,
  Globe,
  Hammer,
  Headphones,
  LampCeiling,
  LampDesk,
  Lightbulb,
  Mic,
  Mic2,
  Monitor,
  Music,
  MusicIcon,
  Music2,
  Music3,
  Music4,
  Network,
  Package,
  PartyPopper,
  Plug,
  Projector,
  Radio,
  Router,
  Scissors,
  Server,
  Settings,
  Speaker,
  Sparkles,
  Square,
  Sun,
  Tablet,
  Tv,
  Tv2,
  Triangle,
  Usb,
  Video,
  Videotape,
  Volume2,
  Wifi,
  Wrench,
  Zap,
} from "@/components/ui/icons";

export type TypeIconEntry = {
  /** Identifiant stocké en DB (CatalogType.iconId). */
  id: string;
  /** Libellé affiché dans le picker. */
  label: string;
  /** Composant Lucide à rendre. */
  Icon: React.ComponentType<{ className?: string }>;
  /** Tag pour filtrer/grouper dans le picker. */
  group: "video" | "audio" | "lighting" | "network" | "tools" | "generic";
};

export const TYPE_ICONS: TypeIconEntry[] = [
  // Vidéo / Caméras
  { id: "camera", label: "Caméra", Icon: Camera, group: "video" },
  { id: "video", label: "Vidéo", Icon: Video, group: "video" },
  { id: "videotape", label: "Magnéto", Icon: Videotape, group: "video" },
  { id: "clapperboard", label: "Clap", Icon: Clapperboard, group: "video" },
  { id: "film", label: "Film", Icon: Film, group: "video" },
  { id: "tv", label: "Écran TV", Icon: Tv, group: "video" },
  { id: "tv2", label: "Moniteur", Icon: Tv2, group: "video" },
  { id: "monitor", label: "Moniteur", Icon: Monitor, group: "video" },
  { id: "projector", label: "Projecteur vidéo", Icon: Projector, group: "video" },
  { id: "tablet", label: "Tablette / Touchscreen", Icon: Tablet, group: "video" },
  // Audio
  { id: "mic", label: "Micro main", Icon: Mic, group: "audio" },
  { id: "mic2", label: "Micro statique", Icon: Mic2, group: "audio" },
  { id: "headphones", label: "Casque", Icon: Headphones, group: "audio" },
  { id: "speaker", label: "Enceinte", Icon: Speaker, group: "audio" },
  { id: "volume2", label: "Volume", Icon: Volume2, group: "audio" },
  { id: "music", label: "Musique", Icon: Music, group: "audio" },
  { id: "music2", label: "Musique 2", Icon: Music2, group: "audio" },
  { id: "music3", label: "Musique 3", Icon: Music3, group: "audio" },
  { id: "music4", label: "Musique 4", Icon: Music4, group: "audio" },
  { id: "drum", label: "Tambour", Icon: Drum, group: "audio" },
  { id: "radio", label: "Radio / Intercom", Icon: Radio, group: "audio" },
  // Lumière
  { id: "lightbulb", label: "Ampoule", Icon: Lightbulb, group: "lighting" },
  { id: "sparkles", label: "Effet / Étincelles", Icon: Sparkles, group: "lighting" },
  { id: "sun", label: "Soleil / Wash", Icon: Sun, group: "lighting" },
  { id: "lamp-desk", label: "Lampe bureau", Icon: LampDesk, group: "lighting" },
  { id: "lamp-ceiling", label: "Plafonnier", Icon: LampCeiling, group: "lighting" },
  { id: "flashlight", label: "Découpe", Icon: Flashlight, group: "lighting" },
  { id: "flame", label: "Flamme / Pyrotechnie", Icon: Flame, group: "lighting" },
  { id: "party", label: "Party / Strobe", Icon: PartyPopper, group: "lighting" },
  // Réseau / IT
  { id: "server", label: "Serveur", Icon: Server, group: "network" },
  { id: "router", label: "Routeur", Icon: Router, group: "network" },
  { id: "network", label: "Réseau", Icon: Network, group: "network" },
  { id: "wifi", label: "Wi-Fi", Icon: Wifi, group: "network" },
  { id: "antenna", label: "Antenne / HF", Icon: Antenna, group: "network" },
  { id: "cable", label: "Câble", Icon: Cable, group: "network" },
  { id: "plug", label: "Prise / Alim", Icon: Plug, group: "network" },
  { id: "usb", label: "USB", Icon: Usb, group: "network" },
  { id: "database", label: "Stockage", Icon: Database, group: "network" },
  { id: "globe", label: "Internet", Icon: Globe, group: "network" },
  // Outils / Génériques
  { id: "cog", label: "Réglages", Icon: Cog, group: "tools" },
  { id: "settings", label: "Paramètres", Icon: Settings, group: "tools" },
  { id: "wrench", label: "Clé / Maintenance", Icon: Wrench, group: "tools" },
  { id: "hammer", label: "Marteau", Icon: Hammer, group: "tools" },
  { id: "scissors", label: "Découpe", Icon: Scissors, group: "tools" },
  { id: "cpu", label: "Processeur", Icon: Cpu, group: "tools" },
  { id: "gauge", label: "Jauge", Icon: Gauge, group: "tools" },
  { id: "bell", label: "Alerte", Icon: Bell, group: "tools" },
  { id: "zap", label: "Éclair", Icon: Zap, group: "tools" },
  // Génériques
  { id: "box", label: "Boîte", Icon: Box, group: "generic" },
  { id: "package", label: "Paquet", Icon: Package, group: "generic" },
  { id: "circle", label: "Cercle", Icon: Circle, group: "generic" },
  { id: "square", label: "Carré", Icon: Square, group: "generic" },
  { id: "triangle", label: "Triangle", Icon: Triangle, group: "generic" },
  // Alias rétro-compat
  { id: "musicicon", label: "Musique (alt)", Icon: MusicIcon, group: "audio" },
];

const ICON_INDEX = new Map(TYPE_ICONS.map((it) => [it.id.toLowerCase(), it]));

/**
 * Retourne l'entrée d'icône correspondant à un iconId stocké, ou null.
 * Tolérant à la casse. Ignore les URLs (qui devraient être rendues en `<img>`).
 */
export function getTypeIcon(iconId: string | null | undefined): TypeIconEntry | null {
  if (!iconId) return null;
  if (iconId.startsWith("/") || iconId.startsWith("http")) return null;
  return ICON_INDEX.get(iconId.toLowerCase()) ?? null;
}

/** True si la valeur représente une URL (uploadée) plutôt qu'un id curated. */
export function isIconUrl(iconId: string | null | undefined): boolean {
  if (!iconId) return false;
  return iconId.startsWith("/") || iconId.startsWith("http");
}

/** Groupes pour le picker (ordre d'affichage). */
export const TYPE_ICON_GROUPS: Array<{
  id: TypeIconEntry["group"];
  label: string;
}> = [
  { id: "video", label: "Vidéo" },
  { id: "audio", label: "Audio" },
  { id: "lighting", label: "Lumière" },
  { id: "network", label: "Réseau / IT" },
  { id: "tools", label: "Outils" },
  { id: "generic", label: "Génériques" },
];
