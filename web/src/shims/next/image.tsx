/**
 * Shim de `next/image` : un `<img>` simple (pas d'optimisation d'image).
 *
 * `fill` → `absolute inset-0 w-full h-full object-cover` (la `className` de
 * l'appelant l'emporte, ex. `object-contain`). Les props propres à Next
 * (`priority`, `quality`, `unoptimized`, `placeholder`, `blurDataURL`,
 * `loader`, `fill`) ne sont pas passées au DOM.
 */

import type { ImgHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/utils";

type StaticImport = { src: string; width?: number; height?: number };

export type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> & {
  src: string | StaticImport;
  alt: string;
  width?: number | `${number}`;
  height?: number | `${number}`;
  fill?: boolean;
  priority?: boolean;
  quality?: number | `${number}`;
  unoptimized?: boolean;
  placeholder?: string;
  blurDataURL?: string;
  loader?: unknown;
  ref?: Ref<HTMLImageElement>;
};

export default function Image({
  src,
  alt,
  width,
  height,
  fill,
  className,
  priority,
  quality: _quality,
  unoptimized: _unoptimized,
  placeholder: _placeholder,
  blurDataURL: _blurDataURL,
  loader: _loader,
  loading,
  ...rest
}: ImageProps) {
  const url = typeof src === "string" ? src : src.src;
  return (
    <img
      src={url}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      loading={loading ?? (priority ? "eager" : "lazy")}
      decoding="async"
      className={fill ? cn("absolute inset-0 w-full h-full object-cover", className) : className}
      {...rest}
    />
  );
}
