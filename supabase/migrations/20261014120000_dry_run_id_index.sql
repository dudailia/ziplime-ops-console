-- The ingest store settles a cancel's session from its place, looked up by
-- dry_run_id (src/lib/ingest/store.ts). Without this index that lookup reads
-- every stored line of the deployment.
create index dry_run_events_order_idx on public.dry_run_events (deployment_id, dry_run_id, line_no) where status = 'accepted';
