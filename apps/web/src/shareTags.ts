export interface ShareTag {
  attr: "property" | "name";
  key: string;
  content: string;
}

/**
 * Share-card tags that need the site's absolute URL (X and others ignore relative image URLs).
 * Without VITE_SITE_URL there are none; a bad value fails the build instead of shipping a broken card.
 */
export function shareImageTags(siteUrl: string | undefined): ShareTag[] {
  if (!siteUrl) return [];
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    throw new Error("VITE_SITE_URL is not a valid URL");
  }
  if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password) {
    throw new Error("VITE_SITE_URL must be a plain https URL");
  }
  const base = url.href.endsWith("/") ? url.href : `${url.href}/`;
  const image = new URL("og-image.png", base).href;
  return [
    { attr: "property", key: "og:url", content: base },
    { attr: "property", key: "og:image", content: image },
    { attr: "property", key: "og:image:width", content: "1200" },
    { attr: "property", key: "og:image:height", content: "630" },
    { attr: "property", key: "og:image:alt", content: "SpactVault: autonomous spending, human rules. Paid instantly, waits for your OK, or refused." },
    { attr: "name", key: "twitter:image", content: image },
  ];
}
