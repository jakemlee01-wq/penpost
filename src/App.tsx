import { useRoute } from "./lib/router";
import { useReader } from "./lib/useReader";
import { Article } from "./views/Article";
import { Deck } from "./views/Deck";
import { About, Settings, Today } from "./views/Pages";
import { WriterProfile } from "./views/Writer";

export function App() {
  const route = useRoute();
  const reader = useReader();

  switch (route.name) {
    case "story":
      return <Article slug={route.slug} />;
    case "writer":
      return <WriterProfile id={route.id} />;
    case "settings":
      return <Settings reader={reader} />;
    case "about":
      return <About />;
    case "today":
      return <Today reader={reader} />;
    default:
      return <Deck reader={reader} />;
  }
}
