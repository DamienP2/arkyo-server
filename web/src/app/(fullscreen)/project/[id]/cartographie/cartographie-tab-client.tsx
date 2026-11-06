// arkyo-server: bouchon phase 5, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/cartographie/cartographie-tab-client.tsx).
// Mêmes exports (`CartographieClient`, `CartographieClientHandle`,
// `CartographieClientProps`) ; « Bientôt disponible » dans le canvas.
import { forwardRef, useImperativeHandle } from "react";

import { ComingSoonCanvas } from "@/components/coming-soon";

export type CartographieClientHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  fitAll: () => void;
  center: () => void;
};

export type CartographieClientProps = {
  onZoomChange?: (zoom: number) => void;
  onRequestAddFloor?: () => void;
};

export const CartographieClient = forwardRef<
  CartographieClientHandle,
  CartographieClientProps
>(function CartographieClient(_props, ref) {
  useImperativeHandle(
    ref,
    () => ({ zoomIn: () => {}, zoomOut: () => {}, fitAll: () => {}, center: () => {} }),
    [],
  );
  return <ComingSoonCanvas />;
});
