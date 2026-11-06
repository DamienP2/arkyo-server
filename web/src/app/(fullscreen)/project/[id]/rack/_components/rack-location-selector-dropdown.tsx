// arkyo-server: bouchon phase 4b, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/rack/_components/rack-location-selector-dropdown.tsx).
// Mêmes props ; rien n'est rendu.
import type {
  InventaireLocation,
  InventaireRack,
} from "../../inventaire/inventaire-client";

export function RackLocationSelectorDropdown(_props: {
  locations: InventaireLocation[];
  racks: InventaireRack[];
  selectedLocationId: string | null;
  onSelectLocation: (id: string) => void;
}) {
  return null;
}
