import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import {
  notFound,
  NavigationErrorElement,
  redirect,
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import Link from "next/link";

function renderAt(routes: RouteObject[], url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<RouterProvider router={router} />);
  return router;
}

function PathProbe() {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div>
      <span data-testid="path">{pathname}</span>
      <button onClick={() => router.push("/projects?tab=1")}>push</button>
      <button onClick={() => router.replace("/dashboard")}>replace</button>
      <button onClick={() => router.back()}>back</button>
      <button onClick={() => router.refresh()}>refresh</button>
      <button onClick={() => router.prefetch("/x")}>prefetch</button>
    </div>
  );
}

describe("shim next/navigation", () => {
  it("useRouter().push change l'URL et usePathname suit", async () => {
    const router = renderAt([{ path: "*", element: <PathProbe /> }], "/dashboard");
    expect(screen.getByTestId("path").textContent).toBe("/dashboard");

    await act(async () => fireEvent.click(screen.getByText("push")));
    expect(screen.getByTestId("path").textContent).toBe("/projects");
    expect(router.state.location.search).toBe("?tab=1");

    await act(async () => fireEvent.click(screen.getByText("back")));
    expect(screen.getByTestId("path").textContent).toBe("/dashboard");

    await act(async () => fireEvent.click(screen.getByText("push")));
    await act(async () => fireEvent.click(screen.getByText("replace")));
    expect(screen.getByTestId("path").textContent).toBe("/dashboard");
    await act(async () => fireEvent.click(screen.getByText("back")));
    expect(screen.getByTestId("path").textContent).toBe("/dashboard");
  });

  it("refresh émet arkyo:refresh et prefetch ne fait rien", async () => {
    const onRefresh = vi.fn();
    window.addEventListener("arkyo:refresh", onRefresh);
    const router = renderAt([{ path: "*", element: <PathProbe /> }], "/dashboard");
    await act(async () => fireEvent.click(screen.getByText("refresh")));
    await act(async () => fireEvent.click(screen.getByText("prefetch")));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/dashboard");
    window.removeEventListener("arkyo:refresh", onRefresh);
  });

  it("useParams expose les paramètres de route", () => {
    function ParamsProbe() {
      const params = useParams<{ id: string }>();
      return <span data-testid="params">{JSON.stringify(params)}</span>;
    }
    renderAt([{ path: "/project/:id", element: <ParamsProbe /> }], "/project/abc");
    expect(JSON.parse(screen.getByTestId("params").textContent!)).toEqual({ id: "abc" });
  });

  it("useSearchParams lit la query", () => {
    function SearchProbe() {
      const sp = useSearchParams();
      return (
        <span data-testid="q">
          {sp.get("tab")}|{sp.get("absent") ?? "null"}
        </span>
      );
    }
    renderAt([{ path: "*", element: <SearchProbe /> }], "/admin?tab=roles");
    expect(screen.getByTestId("q").textContent).toBe("roles|null");
  });

  it("redirect() pendant le rendu est intercepté par le routeur", async () => {
    // React et react-router journalisent l'erreur interceptée : attendu ici.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    function Guarded(): React.ReactNode {
      redirect("/auth");
    }
    const router = renderAt(
      [
        { path: "/dashboard", element: <Guarded />, errorElement: <NavigationErrorElement /> },
        { path: "/auth", element: <p>connexion</p> },
      ],
      "/dashboard",
    );
    expect(await screen.findByText("connexion")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/auth");
    consoleError.mockRestore();
  });

  it("redirect() dans un loader est suivi par le routeur", async () => {
    const router = renderAt(
      [
        {
          path: "/",
          loader: () => redirect("/dashboard"),
          element: <p>racine</p>,
          errorElement: <NavigationErrorElement />,
        },
        { path: "/dashboard", element: <p>tableau</p> },
      ],
      "/",
    );
    expect(await screen.findByText("tableau")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/dashboard");
  });

  it("notFound() affiche la page 404", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    function Missing(): React.ReactNode {
      notFound();
    }
    renderAt(
      [{ path: "*", element: <Missing />, errorElement: <NavigationErrorElement /> }],
      "/racks/zzz",
    );
    expect(await screen.findByText("This page could not be found.")).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
    consoleError.mockRestore();
  });
});

describe("shim next/link", () => {
  it("rend un <a href> et navigue côté client", async () => {
    function Page() {
      return (
        <div>
          <span data-testid="path">{usePathname()}</span>
          <Link href="/racks" prefetch={false} className="lien">
            Baies
          </Link>
          <Link href={{ pathname: "/projects", query: { tab: "2" } }}>Projets</Link>
        </div>
      );
    }
    const router = renderAt([{ path: "*", element: <Page /> }], "/dashboard");
    const a = screen.getByText("Baies");
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe("/racks");
    expect(a.className).toBe("lien");
    expect(a.hasAttribute("prefetch")).toBe(false);
    expect(screen.getByText("Projets").getAttribute("href")).toBe("/projects?tab=2");

    await act(async () => fireEvent.click(a));
    expect(screen.getByTestId("path").textContent).toBe("/racks");

    await act(async () => fireEvent.click(screen.getByText("Projets")));
    expect(router.state.location.search).toBe("?tab=2");
  });
});
