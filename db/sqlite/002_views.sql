-- Eirsha Ops — SQLite views (GENERATED from db/postgres/002_views.sql).
-- Do not edit by hand: run  python3 db/tools/pg_to_sqlite.py --views

-- MGR stock screen: LOW STOCK badge (InventoryItem.currentQuantity <= reorderPoint).
DROP VIEW IF EXISTS v_branch_stock_status;
CREATE VIEW v_branch_stock_status AS
SELECT s.org_id, s.branch_id, s.item_id, i.name_key, i.main_category_code,
       m.cost_category_code, i.unit_code, s.on_hand, s.reorder_point,
       coalesce(s.last_unit_cost, i.standard_unit_cost) AS unit_cost,
       round(s.on_hand * coalesce(s.avg_unit_cost, s.last_unit_cost, i.standard_unit_cost), 2) AS stock_value,
       (s.on_hand <= s.reorder_point) AS is_low_stock
FROM branch_stock s
JOIN inventory_item i ON i.id = s.item_id
JOIN inventory_main_category m ON m.code = i.main_category_code
WHERE i.deleted_at IS NULL;

-- ADMIN price book / POS menu: effective price per branch.
DROP VIEW IF EXISTS v_branch_menu;
CREATE VIEW v_branch_menu AS
SELECT b.org_id, b.id AS branch_id, mi.id AS menu_item_id, mi.sku, mi.name_key,
       mi.category_code, mc.revenue_class, mi.station_code,
       coalesce(bp.price, mi.base_price) AS price,
       mi.base_price, (bp.price IS NOT NULL) AS is_override,
       (mi.is_active AND coalesce(bp.is_available, true)) AS is_available
FROM branch b
JOIN menu_item mi ON mi.org_id = b.org_id AND mi.deleted_at IS NULL
JOIN menu_category mc ON mc.code = mi.category_code
LEFT JOIN menu_item_branch_price bp ON bp.menu_item_id = mi.id AND bp.branch_id = b.id
WHERE b.deleted_at IS NULL;

-- FIN payables: Bill status exactly as finance-main derives it
-- (OPEN / PARTIAL / DUE_SOON within 7 days / OVERDUE / PAID).
DROP VIEW IF EXISTS v_bill_status;
CREATE VIEW v_bill_status AS
SELECT b.*, v.name AS vendor_name,
       coalesce(p.settled, 0)  AS amount_settled,
       coalesce(p.withheld, 0) AS amount_withheld,
       b.total - coalesce(p.settled, 0) AS balance_due,
       CASE
         WHEN b.status IN ('VOID','DRAFT')                   THEN b.status
         WHEN b.total - coalesce(p.settled, 0) <= 0.004      THEN 'PAID'
         WHEN b.due_date < date('now')                      THEN 'OVERDUE'
         WHEN b.due_date <= date('now', '+7 days')                 THEN 'DUE_SOON'
         WHEN coalesce(p.settled, 0) > 0                     THEN 'PARTIAL'
         ELSE 'OPEN'
       END AS display_status
FROM bill b
JOIN vendor v ON v.id = b.vendor_id
LEFT JOIN (SELECT bill_id, sum(amount) AS settled, sum(withheld) AS withheld
           FROM bill_payment GROUP BY bill_id) p ON p.bill_id = b.id;

-- MGR payment reconciliation (PaymentSummary) + FIN live day: from POS payments.
DROP VIEW IF EXISTS v_daily_payments;
CREATE VIEW v_daily_payments AS
SELECT o.org_id, o.branch_id, o.business_date, op.payment_method_code,
       sum(op.amount) AS amount, count(*) AS txn_count
FROM order_payment op
JOIN customer_order o ON o.id = op.order_id
WHERE op.status = 'CAPTURED' AND o.status IN ('PAID','REFUNDED')
GROUP BY o.org_id, o.branch_id, o.business_date, op.payment_method_code;

-- Live Z-report for an open day (what POS day-close freezes into daily_sales_summary).
DROP VIEW IF EXISTS v_daily_sales_live;
CREATE VIEW v_daily_sales_live AS
SELECT o.org_id, o.branch_id, o.business_date,
       sum(o.total_gross) FILTER (WHERE o.status = 'PAID')                      AS gross,
       sum(o.vat_amount)  FILTER (WHERE o.status = 'PAID')                      AS vat,
       count(*)           FILTER (WHERE o.status = 'PAID')                      AS order_count,
       count(*)           FILTER (WHERE o.status = 'VOIDED')                    AS void_count,
       round(coalesce(sum(l.food), 0), 2)     AS food_net,
       round(coalesce(sum(l.beverage), 0), 2) AS beverage_net
FROM customer_order o
LEFT JOIN (SELECT order_id,
                  sum(line_total / (1 + vat_rate)) FILTER (WHERE revenue_class = 'FOOD')     AS food,
                  sum(line_total / (1 + vat_rate)) FILTER (WHERE revenue_class = 'BEVERAGE') AS beverage
           FROM order_line WHERE status = 'ACTIVE' GROUP BY order_id) l
       ON l.order_id = o.id AND o.status = 'PAID'
GROUP BY o.org_id, o.branch_id, o.business_date;

-- MGR sales overview: one row per sold line (the old SaleLine shape).
DROP VIEW IF EXISTS v_sale_line;
CREATE VIEW v_sale_line AS
SELECT ol.id, o.org_id, o.branch_id, o.order_number AS ticket_no, ol.menu_item_id,
       ol.quantity, ol.unit_price, ol.line_total AS total,
       (SELECT op.payment_method_code FROM order_payment op
         WHERE op.order_id = o.id AND op.status = 'CAPTURED'
         ORDER BY op.amount DESC LIMIT 1)          AS payment_method,   -- main tender
       o.shift_code AS shift, o.opened_by AS logged_by, o.paid_at AS timestamp, o.business_date
FROM order_line ol
JOIN customer_order o ON o.id = ol.order_id
WHERE o.status = 'PAID' AND ol.status = 'ACTIVE';

-- MGR overview: what is waiting for this manager.
DROP VIEW IF EXISTS v_manager_queue;
CREATE VIEW v_manager_queue AS
SELECT org_id, branch_id, 'purchase' AS entity_type, id AS entity_id, purchased_at AS requested_at, total_cost AS amount
  FROM purchase WHERE review_status = 'PENDING' AND deleted_at IS NULL
UNION ALL
SELECT org_id, branch_id, 'waste_report', id, occurred_at, loss_value
  FROM waste_report WHERE approval_status = 'PENDING' AND deleted_at IS NULL
UNION ALL
SELECT org_id, branch_id, 'dispatch_request', id, requested_at, NULL
  FROM dispatch_request WHERE status = 'PENDING'
UNION ALL
SELECT org_id, branch_id, 'expense', id, spent_at, amount
  FROM expense WHERE review_status = 'PENDING' AND deleted_at IS NULL;

-- FIN cash position / OWNER balances.
DROP VIEW IF EXISTS v_account_balance;
CREATE VIEW v_account_balance AS
SELECT a.org_id, a.branch_id, a.id AS money_account_id, a.kind, a.name,
       a.opening_balance + coalesce(sum(m.amount) FILTER (WHERE m.kind <> 'OPENING'), 0) AS balance,
       max(m.occurred_on) AS last_movement_on
FROM money_account a
LEFT JOIN cash_movement m ON m.money_account_id = a.id
GROUP BY a.org_id, a.branch_id, a.id, a.kind, a.name, a.opening_balance;

-- FIN P&L by month (accrual). Revenue net of VAT from Z-reports; COGS/OPEX
-- from bills by issue date, plus on-the-spot purchases/expenses not billed,
-- approved waste as shrinkage, and payroll gross + employer pension.
DROP VIEW IF EXISTS v_pnl_monthly;
CREATE VIEW v_pnl_monthly AS
WITH lines AS (
  SELECT org_id, branch_id, strftime('%Y-%m-01', business_date) AS month,
         'REVENUE' AS section, 'SALES' AS category, net AS amount
    FROM daily_sales_summary WHERE status = 'CLOSED' OR source = 'IMPORT'
  UNION ALL
  SELECT b.org_id, b.branch_id, strftime('%Y-%m-01', b.issue_date), c.kind, bl.cost_category_code, bl.amount
    FROM bill b JOIN bill_line bl ON bl.bill_id = b.id JOIN cost_category c ON c.code = bl.cost_category_code
   WHERE b.status <> 'VOID'
  UNION ALL   -- bills entered without lines (manual / imported): use the header
  SELECT b.org_id, b.branch_id, strftime('%Y-%m-01', b.issue_date), c.kind, b.cost_category_code, b.subtotal
    FROM bill b JOIN cost_category c ON c.code = b.cost_category_code
   WHERE b.status <> 'VOID' AND NOT EXISTS (SELECT 1 FROM bill_line bl WHERE bl.bill_id = b.id)
  UNION ALL   -- approved purchases not (yet) on a bill
  SELECT p.org_id, p.branch_id, strftime('%Y-%m-01', p.business_date), 'COGS', p.cost_category_code, p.total_cost - p.vat_amount
    FROM purchase p
   WHERE p.review_status = 'APPROVED' AND p.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM bill_line bl WHERE bl.purchase_id = p.id)
  UNION ALL
  SELECT e.org_id, e.branch_id, strftime('%Y-%m-01', e.business_date), c.kind, e.cost_category_code, e.amount - e.vat_amount
    FROM expense e JOIN cost_category c ON c.code = e.cost_category_code
   WHERE e.review_status IN ('PENDING','APPROVED') AND e.deleted_at IS NULL
  UNION ALL
  SELECT w.org_id, w.branch_id, strftime('%Y-%m-01', w.business_date), 'WASTE', w.reason_code, w.loss_value
    FROM waste_report w WHERE w.approval_status = 'APPROVED' AND w.deleted_at IS NULL
  UNION ALL
  SELECT r.org_id, r.branch_id, r.period_month, 'OPEX', 'PAYROLL', r.total_gross + r.total_pension_employer
    FROM payroll_run r WHERE r.status IN ('APPROVED','PAID')
)
SELECT org_id, branch_id, month, section, category, round(sum(amount), 2) AS amount
FROM lines
GROUP BY org_id, branch_id, month, section, category;

-- FIN tax: monthly VAT position (output on sales, input on receipted bills).
DROP VIEW IF EXISTS v_vat_monthly;
CREATE VIEW v_vat_monthly AS
SELECT org_id, month, round(sum(output_vat), 2) AS output_vat, round(sum(input_vat), 2) AS input_vat,
       round(sum(output_vat) - sum(input_vat), 2) AS vat_payable
FROM (
  SELECT org_id, strftime('%Y-%m-01', business_date) AS month, vat AS output_vat, 0 AS input_vat
    FROM daily_sales_summary
  UNION ALL
  SELECT org_id, strftime('%Y-%m-01', issue_date), 0, vat
    FROM bill WHERE has_vat_receipt AND status <> 'VOID'
) x GROUP BY org_id, month;

-- FIN tax: withholding collected per month (to remit to MoR).
DROP VIEW IF EXISTS v_wht_monthly;
CREATE VIEW v_wht_monthly AS
SELECT b.org_id, strftime('%Y-%m-01', p.paid_on) AS month,
       round(sum(p.withheld), 2) AS withheld, count(*) AS payment_count
FROM bill_payment p JOIN bill b ON b.id = p.bill_id
WHERE p.withheld > 0
GROUP BY b.org_id, strftime('%Y-%m-01', p.paid_on);

-- Auth: effective permissions per user (primary role + extra branch roles).
DROP VIEW IF EXISTS v_user_permission;
CREATE VIEW v_user_permission AS
SELECT u.id AS user_id, u.org_id, u.home_branch_id AS branch_id, rp.permission_code
  FROM app_user u JOIN role_permission rp ON rp.org_id = u.org_id AND rp.role_code = u.role_code
 WHERE u.is_active AND u.deleted_at IS NULL
UNION
SELECT u.id, u.org_id, ubr.branch_id, rp.permission_code
  FROM app_user u
  JOIN user_branch_role ubr ON ubr.user_id = u.id
   AND (ubr.valid_from IS NULL OR ubr.valid_from <= date('now'))
   AND (ubr.valid_to   IS NULL OR ubr.valid_to   >= date('now'))
  JOIN role_permission rp ON rp.org_id = u.org_id AND rp.role_code = ubr.role_code
 WHERE u.is_active AND u.deleted_at IS NULL;
