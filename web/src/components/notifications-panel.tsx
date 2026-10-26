"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell } from "@/components/ui/icons";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { LoadingState } from "@/components/ui/loading-state";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  readAt: string | null;
  createdAt: string;
};

export function NotificationsPanel() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/count");
      if (res.ok) {
        const data = await res.json();
        setCount(data.count);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, [fetchCount]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleOpen() {
    setOpen(!open);
    if (!open) {
      setLoading(true);
      const res = await fetch("/api/notifications?limit=10");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications);
      }
      setLoading(false);
    }
  }

  async function markAsRead(id: string) {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    setCount((prev) => Math.max(0, prev - 1));
  }

  async function markAllAsRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "read-all" }),
    });
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
    );
    setCount(0);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleOpen}
        // arkyo-server: habillage Strata
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <Bell className="h-3.5 w-3.5" />
        {count > 0 && ( // arkyo-server: habillage Strata
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--destructive)] text-[8px] font-bold text-[var(--destructive-foreground)]">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
            <span className="text-xs font-semibold">Notifications</span>
            {count > 0 && (
              <button
                onClick={markAllAsRead}
                // arkyo-server: habillage Strata
                className="text-[10px] text-[var(--accent)] hover:underline"
              >
                Tout marquer comme lu
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading && (
              <LoadingState className="px-4 py-6" />
            )}
            {!loading && notifications.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
                Aucune notification
              </div>
            )}
            {!loading &&
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => !n.readAt && markAsRead(n.id)}
                  // arkyo-server: habillage Strata
                  className={`w-full border-b border-[var(--border)] px-4 py-3 text-left transition-colors last:border-0 hover:bg-[var(--secondary)]/50 ${!n.readAt ? "bg-[var(--accent)]/5" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && ( // arkyo-server: habillage Strata
                      <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-xs ${!n.readAt ? "font-semibold" : ""}`}>
                        {n.title}
                      </p>
                      {n.message && (
                        <p className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">
                          {n.message}
                        </p>
                      )}
                      <p className="mt-1 text-[9px] text-[var(--muted-foreground)]">
                        {formatDistanceToNow(new Date(n.createdAt), {
                          addSuffix: true,
                          locale: fr,
                        })}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
