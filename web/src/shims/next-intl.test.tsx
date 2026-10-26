import { describe, it, expect, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NextIntlClientProvider, useLocale, useTranslations } from "next-intl";
import fr from "@/messages/fr.json";

function setLocaleCookie(value: string | null) {
  document.cookie = value
    ? `locale=${value}; path=/`
    : "locale=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

function Probe({ ns = "auth" }: { ns?: string }) {
  const t = useTranslations(ns);
  const locale = useLocale();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="continue">{t("continue")}</span>
      <span data-testid="absent">{t("absent")}</span>
      <span data-testid="resend">{t("resendIn", { seconds: 12 })}</span>
    </div>
  );
}

afterEach(() => setLocaleCookie(null));

describe("shim next-intl", () => {
  it("useTranslations('ns') lit messages/fr.json et retombe sur la clé si absente", () => {
    render(
      <NextIntlClientProvider>
        <Probe />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("fr");
    expect(screen.getByTestId("continue").textContent).toBe(fr.auth.continue);
    expect(screen.getByTestId("continue").textContent).toBe("Continuer");
    expect(screen.getByTestId("absent").textContent).toBe("auth.absent");
    expect(screen.getByTestId("resend").textContent).toBe("Renvoyer dans 12s");
  });

  it("utilise la locale du cookie `locale`", () => {
    setLocaleCookie("en");
    render(
      <NextIntlClientProvider>
        <Probe />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("en");
    expect(screen.getByTestId("continue").textContent).toBe("Continue");
  });

  it("une locale inconnue retombe sur fr", () => {
    setLocaleCookie("xx");
    render(
      <NextIntlClientProvider>
        <Probe />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("fr");
  });

  it("relit le cookie sur arkyo:refresh (router.refresh après changement de langue)", async () => {
    render(
      <NextIntlClientProvider>
        <Probe />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("fr");
    setLocaleCookie("de");
    await act(async () => {
      window.dispatchEvent(new Event("arkyo:refresh"));
    });
    expect(screen.getByTestId("locale").textContent).toBe("de");
    expect(document.documentElement.lang).toBe("de");
  });

  it("accepte des messages et une locale explicites, sans namespace", () => {
    function Flat() {
      const t = useTranslations();
      return <span data-testid="flat">{t("common.x")}</span>;
    }
    render(
      <NextIntlClientProvider locale="it" messages={{ common: { x: "ciao" } }}>
        <Flat />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("flat").textContent).toBe("ciao");
  });
});
