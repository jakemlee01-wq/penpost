import { useRoute } from "./lib/router";
import { useReader } from "./lib/useReader";
import { Article } from "./views/Article";
import { Deck } from "./views/Deck";
import { Onboarding } from "./views/Onboarding";
import { About, Account, Paper, Papers, Settings, Today } from "./views/Pages";
import { WriterProfile } from "./views/Writer";

export function App() {
  const route = useRoute();
  const reader = useReader();

  // First visit (or after a reset): ask where they want news from before showing an edition.
  // Article, writer and about pages still open directly from a shared link.
  if (reader.needsSetup && (route.name === "deck" || route.name === "today")) return <Onboarding reader={reader} />;

  switch (route.name) {
    case "setup":
      return <Onboarding reader={reader} redo />;
    case "story":
      return <Article slug={route.slug} />;
    case "writer":
      return <WriterProfile id={route.id} />;
    case "settings":
      return <Settings reader={reader} />;
    case "about":
      return <About />;
    case "papers":
      return <Papers reader={reader} />;
    case "paper":
      return <Paper reader={reader} id={route.id} />;
    case "account":
      return <Account />;
    case "today":
      // Before today's paper is asked for (or while it's being curated), the list has nothing to show yet.
      return reader.gated || reader.curating ? <Deck reader={reader} /> : <Today reader={reader} />;
    default:
      return <Deck reader={reader} />;
  }
}
