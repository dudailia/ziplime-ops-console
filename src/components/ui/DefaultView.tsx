import { PageSkeleton } from "./Skeleton";

// The view a page shows with no query in its address, rendered on the server
// (15 Oct 2026). Pages that read the address used to prerender a skeleton and
// paint after their scripts ran. Now the server renders the default view, and
// the address-driven one replaces it in the browser; with no query they match.
// With a query, the inline script in layout.tsx marks <html data-query>: the
// default view is hidden and a skeleton shows instead, so a deep link never
// flashes the wrong content; <html data-saved> does the same for a visitor whose
// saved demo state differs from the seed. FirstLoad clears both on the first
// page change.

export const NO_PARAMS = new URLSearchParams();

export function DefaultView({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div data-default-view="">{children}</div>
      <div data-deep-link-skeleton="">
        <PageSkeleton label={label} />
      </div>
    </>
  );
}
