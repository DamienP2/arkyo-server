/**
 * Shim de `next-intl` (côté client) lisant les mêmes `messages/*.json`.
 *
 * Comme `arkyo:i18n/request.ts`, la locale vient du cookie `locale` (posé par
 * `POST /api/platform/locale`), `fr` par défaut. Sans `messages`,
 * `NextIntlClientProvider` charge le fichier de cette locale et relit le cookie
 * à chaque `router.refresh()` (`arkyo:refresh`).
 *
 * `useTranslations(ns?)` : `t(key, values?)` avec interpolation `{nom}` ; une
 * clé absente rend son chemin complet (`ns.key`), comme next-intl.
 */

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { defaultLocale, locales, type Locale } from "@/i18n/config";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import fr from "@/messages/fr.json";
import it from "@/messages/it.json";

export type AbstractIntlMessages = { [key: string]: string | AbstractIntlMessages };

const MESSAGES: Record<Locale, AbstractIntlMessages> = { fr, en, es, de, it };

const REFRESH_EVENT = "arkyo:refresh";

/** Locale de l'utilisateur : cookie `locale`, sinon `fr`. */
export function readLocaleCookie(): Locale {
  const match = document.cookie.match(/(?:^|;\s*)locale=([^;]*)/);
  const value = match ? decodeURIComponent(match[1]) : "";
  return (locales as readonly string[]).includes(value) ? (value as Locale) : defaultLocale;
}

export function getMessages(locale: string): AbstractIntlMessages {
  return MESSAGES[locale as Locale] ?? MESSAGES[defaultLocale];
}

type IntlContextValue = { locale: string; messages: AbstractIntlMessages };

const IntlContext = createContext<IntlContextValue | null>(null);

export function NextIntlClientProvider({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale?: string;
  messages?: AbstractIntlMessages;
  timeZone?: string;
  now?: Date;
}) {
  const [cookieLocale, setCookieLocale] = useState<Locale>(() => readLocaleCookie());
  const auto = messages === undefined;

  useEffect(() => {
    if (!auto) return;
    const onRefresh = () => setCookieLocale(readLocaleCookie());
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(REFRESH_EVENT, onRefresh);
  }, [auto]);

  const effectiveLocale = locale ?? cookieLocale;

  useEffect(() => {
    if (auto) document.documentElement.lang = effectiveLocale;
  }, [auto, effectiveLocale]);

  const value = useMemo<IntlContextValue>(
    () => ({ locale: effectiveLocale, messages: messages ?? getMessages(effectiveLocale) }),
    [effectiveLocale, messages],
  );

  return <IntlContext.Provider value={value}>{children}</IntlContext.Provider>;
}

function useIntl(): IntlContextValue {
  const ctx = useContext(IntlContext);
  if (!ctx) {
    throw new Error("[next-intl]: No intl context found. Have you configured the provider?");
  }
  return ctx;
}

export function useLocale(): string {
  return useIntl().locale;
}

export function useMessages(): AbstractIntlMessages {
  return useIntl().messages;
}

type Values = Record<string, string | number | boolean | Date | null | undefined>;

function lookup(messages: AbstractIntlMessages, path: string): unknown {
  let node: unknown = messages;
  for (const part of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function format(template: string, values?: Values): string {
  if (!values) return template;
  return template.replace(/\{\s*(\w+)\s*\}/g, (whole, name: string) => {
    const v = values[name];
    if (v === undefined || v === null) return whole;
    return v instanceof Date ? v.toLocaleString() : String(v);
  });
}

export type Translator = {
  (key: string, values?: Values): string;
  has: (key: string) => boolean;
  raw: (key: string) => unknown;
};

export function useTranslations(namespace?: string): Translator {
  const { messages } = useIntl();
  return useMemo(() => {
    const full = (key: string) => (namespace ? `${namespace}.${key}` : key);
    const t = ((key: string, values?: Values) => {
      const msg = lookup(messages, full(key));
      return typeof msg === "string" ? format(msg, values) : full(key);
    }) as Translator;
    t.has = (key) => typeof lookup(messages, full(key)) === "string";
    t.raw = (key) => lookup(messages, full(key));
    return t;
  }, [messages, namespace]);
}
