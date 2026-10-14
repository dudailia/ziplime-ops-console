// Re-mounts on every route change, so the main column fades in quickly
// (160 ms). The rail and tab bar live in the layout and stay still.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
