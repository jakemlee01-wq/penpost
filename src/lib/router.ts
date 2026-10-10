import { useEffect, useState } from "react";

/** Hash routing keeps deep links working on static hosts without rewrite rules. */
export type Route =
  | { name: "deck" }
  | { name: "story"; slug: string }
  | { name: "writer"; id: string }
  | { name: "settings" }
  | { name: "about" }
  | { name: "today" }
  | { name: "setup" };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "story" && parts[1]) return { name: "story", slug: parts[1] };
  if (parts[0] === "writer" && parts[1]) return { name: "writer", id: parts[1] };
  if (parts[0] === "settings") return { name: "settings" };
  if (parts[0] === "about") return { name: "about" };
  if (parts[0] === "today") return { name: "today" };
  if (parts[0] === "setup") return { name: "setup" };
  return { name: "deck" };
}

export const href = {
  deck: () => "#/",
  story: (slug: string) => `#/story/${encodeURIComponent(slug)}`,
  writer: (id: string) => `#/writer/${encodeURIComponent(id)}`,
  settings: () => "#/settings",
  about: () => "#/about",
  today: () => "#/today",
  setup: () => "#/setup",
};

// In-memory history of hashes visited in this session, so "back" can
// return to the previous in-app view (deck, writer page) or fall back to the deck.
const stack: string[] = [window.location.hash || "#/"];

function track(hash: string) {
  if (stack.length > 1 && stack[stack.length - 2] === hash) stack.pop();
  else stack.push(hash);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      track(window.location.hash || "#/");
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function goBack(fallback = href.deck()) {
  if (stack.length > 1) window.history.back();
  else window.location.hash = fallback;
}
