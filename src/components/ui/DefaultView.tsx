// The view a page shows with no query in its address, rendered on the server
// (15 Oct 2026). Pages that read the address used to prerender a skeleton and
// paint after their scripts ran. Now the server renders the default view, and
// the address-driven one replaces it in the browser; with no query they match.
// With a query, the inline script in layout.tsx marks <html data-query>, and
// this view stays hidden so a deep link never flashes the default first.

export const NO_PARAMS = new URLSearchParams();

export function DefaultView({ children }: { children: React.ReactNode }) {
  return <div data-default-view="">{children}</div>;
}
