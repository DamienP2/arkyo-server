export interface LayerView {
  id: string;
  name: string;
  color: string;
  count: number;
}

interface DesignSlot {
  id: string;
  categoryId: string;
  parentCategoryId: string | null;
}
interface DesignCategory {
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
}

export function deriveDesignLayers(slots: DesignSlot[], categories: DesignCategory[]): LayerView[] {
  const parents = categories.filter((c) => c.parentId === null);
  return parents
    .map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color ?? "#64748b",
      count: slots.filter((s) => (s.parentCategoryId ?? s.categoryId) === p.id).length,
    }))
    .filter((l) => l.count > 0);
}

interface SynopticCable {
  id: string;
  signalCategoryId: string | null;
}
interface SignalCategory {
  id: string;
  name: string;
  color: string | null;
}

export function deriveSynopticLayers(
  cables: SynopticCable[],
  categories: SignalCategory[],
): LayerView[] {
  return categories
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color ?? "#64748b",
      count: cables.filter((x) => x.signalCategoryId === c.id).length,
    }))
    .filter((l) => l.count > 0);
}
