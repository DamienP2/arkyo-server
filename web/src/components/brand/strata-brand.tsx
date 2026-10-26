import "./strata-brand.css";

export const MODULE = "Arkyo";

/** Lockup « Strata Arkyo » (sans signature), repris de cg:web/src/ui/Brand.tsx. */
export function StrataBrand({ stacked }: { stacked?: boolean }) {
  return (
    <div className={stacked ? "brand stacked" : "brand"} aria-label={`Strata ${MODULE}`}>
      <span className="brand-lockup">
        <span className="brand-name">Strata</span>
        <span className="brand-module">{MODULE}</span>
      </span>
    </div>
  );
}
