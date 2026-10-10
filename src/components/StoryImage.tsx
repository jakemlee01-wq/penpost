import { photoUrl } from "../lib/content";
import type { Story } from "../lib/schema";
import { Illustration } from "./Illustration";

/** The story's licensed photo when one is available, otherwise its illustration. */
export function StoryImage({ story, className, variant }: { story: Story; className: string; variant: "card" | "article" }) {
  const image = story.image;
  if (!image) return <div className={`${className} placeholder`} />;
  const src = photoUrl(story);
  if (src && image.photo) {
    return <img className={`${className} photo`} src={src} alt={image.alt} loading={variant === "card" ? "eager" : "lazy"} decoding="async" draggable={false} />;
  }
  return <Illustration scene={image.scene} alt={image.alt} className={className} fit={variant === "card" ? "meet" : "slice"} />;
}

/** Caption line for the article: what it shows, and who took it. */
export function imageCaption(story: Story): { text: string; credit?: string; link?: string } | null {
  const image = story.image;
  if (!image) return null;
  if (photoUrl(story) && image.photo) {
    return { text: image.photo.caption, credit: `Photo: ${image.photo.credit}`, link: image.photo.pageUrl };
  }
  return { text: "Illustration: Penpost" };
}

/** Small label for the card when the picture is generic, so it never reads as the actual event. */
export function isStockShown(story: Story): boolean {
  return Boolean(photoUrl(story) && story.image?.photo?.kind === "stock");
}
