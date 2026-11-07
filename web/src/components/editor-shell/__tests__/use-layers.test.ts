import { describe, it, expect } from "vitest";
import { deriveDesignLayers, deriveSynopticLayers } from "../hooks/use-layers";

describe("deriveDesignLayers", () => {
  it("groups slots by parent category and counts", () => {
    const layers = deriveDesignLayers(
      [
        { id: "s1", categoryId: "camera", parentCategoryId: "camera" },
        { id: "s2", categoryId: "camera", parentCategoryId: "camera" },
        { id: "s3", categoryId: "mixer-audio", parentCategoryId: "mixer" },
      ],
      [
        { id: "camera", name: "Caméras", parentId: null, color: "#3b82f6" },
        { id: "mixer", name: "Mélangeurs", parentId: null, color: "#f59e0b" },
      ],
    );
    expect(layers).toHaveLength(2);
    expect(layers.find((l) => l.id === "camera")?.count).toBe(2);
    expect(layers.find((l) => l.id === "mixer")?.count).toBe(1);
  });

  it("falls back on categoryId when parentCategoryId is null", () => {
    const layers = deriveDesignLayers(
      [{ id: "s1", categoryId: "camera", parentCategoryId: null }],
      [{ id: "camera", name: "Caméras", parentId: null, color: null }],
    );
    expect(layers[0]?.count).toBe(1);
    expect(layers[0]?.color).toBe("#64748b");
  });

  it("excludes categories with no slots", () => {
    const layers = deriveDesignLayers(
      [{ id: "s1", categoryId: "camera", parentCategoryId: "camera" }],
      [
        { id: "camera", name: "Caméras", parentId: null, color: "#3b82f6" },
        { id: "empty", name: "Vide", parentId: null, color: "#ef4444" },
      ],
    );
    expect(layers).toHaveLength(1);
  });
});

describe("deriveSynopticLayers", () => {
  it("groups cables by signal category", () => {
    const layers = deriveSynopticLayers(
      [
        { id: "c1", signalCategoryId: "video" },
        { id: "c2", signalCategoryId: "video" },
        { id: "c3", signalCategoryId: "audio" },
      ],
      [
        { id: "video", name: "Vidéo", color: "#3b82f6" },
        { id: "audio", name: "Audio", color: "#f59e0b" },
      ],
    );
    expect(layers.find((l) => l.id === "video")?.count).toBe(2);
    expect(layers.find((l) => l.id === "audio")?.count).toBe(1);
  });

  it("excludes categories with no cables", () => {
    const layers = deriveSynopticLayers(
      [{ id: "c1", signalCategoryId: "video" }],
      [
        { id: "video", name: "Vidéo", color: "#3b82f6" },
        { id: "data", name: "Data", color: "#8b5cf6" },
      ],
    );
    expect(layers).toHaveLength(1);
  });
});
