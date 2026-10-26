"use client";

import { useRouter } from "next/navigation";
import { locales, type Locale } from "@/i18n/config";
import { useTranslations, useLocale } from "next-intl";

type Variant = "inline" | "dropdown";

export function LocaleSelector({ variant = "inline" }: { variant?: Variant }) {
  const router = useRouter();
  const t = useTranslations("language");
  const currentLocale = useLocale();

  async function handleChange(locale: Locale) {
    await fetch("/api/platform/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    router.refresh();
  }

  if (variant === "dropdown") {
    return (
      <select
        onChange={(e) => handleChange(e.target.value as Locale)}
        defaultValue=""
        // arkyo-server: habillage Strata
        className="cursor-pointer bg-transparent text-xs text-[var(--muted-foreground)] outline-none"
      >
        <option value="" disabled>
          🌐
        </option>
        {locales.map((l) => (
          <option key={l} value={l}>
            {t(l)}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {locales.map((l) => (
        <button
          key={l}
          onClick={() => handleChange(l)}
          className={`text-[10px] font-medium tracking-wider uppercase transition-colors ${
            l === currentLocale
              ? "font-bold text-[var(--accent)]" /* arkyo-server: habillage Strata */
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          }`}
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
