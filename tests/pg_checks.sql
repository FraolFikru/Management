-- PostgreSQL-only behaviour: triggers, NOTIFY, row-level security.
-- Run against a database loaded with schema + views + reference + demo seed:
--   psql "$PG" -v ON_ERROR_STOP=1 -f tests/pg_checks.sql
SET search_path = eirsha, public;
\set QUIET on

-- 1. updated_at is maintained by trigger
DO $$
DECLARE before timestamptz; after timestamptz;
BEGIN
  SELECT updated_at INTO before FROM vendor WHERE id = 'V-01';
  PERFORM pg_sleep(0.01);
  UPDATE vendor SET phone = phone WHERE id = 'V-01';
  SELECT updated_at INTO after FROM vendor WHERE id = 'V-01';
  IF after <= before THEN RAISE EXCEPTION 'updated_at trigger did not fire'; END IF;
  RAISE NOTICE 'ok: updated_at trigger';
END $$;

-- 2. audit_log is append-only
DO $$
BEGIN
  BEGIN
    UPDATE audit_log SET action = 'tampered' WHERE id = (SELECT min(id) FROM audit_log);
    RAISE EXCEPTION 'audit_log accepted an UPDATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM audit_log WHERE id = (SELECT min(id) FROM audit_log);
    RAISE EXCEPTION 'audit_log accepted a DELETE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok: audit_log append-only';
END $$;

-- 3. kds_ticket.version moves on every change (optimistic locking for KDS screens)
DO $$
DECLARE v1 int; v2 int; tid text;
BEGIN
  SELECT id, version INTO tid, v1 FROM kds_ticket WHERE status = 'PENDING' LIMIT 1;
  UPDATE kds_ticket SET status = 'PREPARING', started_at = now() WHERE id = tid;
  SELECT version INTO v2 FROM kds_ticket WHERE id = tid;
  IF v2 <> v1 + 1 THEN RAISE EXCEPTION 'version % → % (expected +1)', v1, v2; END IF;
  UPDATE kds_ticket SET status = 'PENDING', started_at = NULL WHERE id = tid;
  RAISE NOTICE 'ok: kds_ticket.version';
END $$;

-- 4. constraints that carry business rules
DO $$
BEGIN
  BEGIN
    UPDATE purchase SET review_status = 'FLAGGED', flag_reason = NULL WHERE id = (SELECT min(id) FROM purchase);
    RAISE EXCEPTION 'FLAGGED without reason accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO dispatch_request (org_id, branch_id, item_id, quantity, unit_code, requested_by)
    VALUES ('STORE-01', 'BR-BOLE', 'onion', 1, 'kg', 'U-002');           -- no destination
    RAISE EXCEPTION 'dispatch without destination accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO purchase (org_id, branch_id, item_id, cost_category_code, quantity, unit_code, unit_cost, total_cost,
                          vendor_name, logged_by, business_date, settlement)
    VALUES ('STORE-01', 'BR-NOPE', 'onion', 'RAW_INGREDIENTS', 1, 'kg', 1, 1, 'x', 'U-002', CURRENT_DATE, 'ON_CREDIT');
    RAISE EXCEPTION 'purchase for unknown branch accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  RAISE NOTICE 'ok: business-rule constraints';
END $$;

-- 5. row-level security isolates organisations for the application role
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eirsha_app') THEN CREATE ROLE eirsha_app NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA eirsha TO eirsha_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA eirsha TO eirsha_app;
REVOKE UPDATE, DELETE ON audit_log FROM eirsha_app;
BEGIN;
SET LOCAL ROLE eirsha_app;
SELECT set_config('eirsha.org_id', 'SOME-OTHER-ORG', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM purchase) <> 0 THEN RAISE EXCEPTION 'RLS leak: other org sees purchases'; END IF;
END $$;
SELECT set_config('eirsha.org_id', 'STORE-01', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM purchase) = 0 THEN RAISE EXCEPTION 'RLS hides own org rows'; END IF;
  RAISE NOTICE 'ok: row-level security';
END $$;
COMMIT;

-- 6. outbox → NOTIFY (psql prints the notification after the INSERT)
LISTEN eirsha_outbox;
INSERT INTO outbox_event (org_id, branch_id, topic, event_type, aggregate_type, aggregate_id, payload)
VALUES ('STORE-01', 'BR-BOLE', 'kds.ticket', 'remove', 'kds_ticket', 'probe', '{"type":"remove","ticketId":"probe"}');
SELECT 'ok: outbox insert (expect an asynchronous notification line)' AS check;
DELETE FROM outbox_event WHERE aggregate_id = 'probe';

-- 7. read models answer on the demo data
SELECT 'v_pnl_monthly'        AS view, count(*) AS rows FROM v_pnl_monthly
UNION ALL SELECT 'v_bill_status',        count(*) FROM v_bill_status
UNION ALL SELECT 'v_sale_line',          count(*) FROM v_sale_line
UNION ALL SELECT 'v_manager_queue',      count(*) FROM v_manager_queue
UNION ALL SELECT 'v_branch_stock_status',count(*) FROM v_branch_stock_status
UNION ALL SELECT 'v_user_permission',    count(*) FROM v_user_permission;
