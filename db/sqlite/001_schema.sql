-- =====================================================================
--  Eirsha Ops — SQLite build (GENERATED from db/postgres/001_schema.sql).
--  Do not edit by hand: run  python3 db/tools/pg_to_sqlite.py
--  Use for local development, demos and offline branch caches.
--  Run with:  PRAGMA foreign_keys = ON;  (per connection)
--  Differences from PostgreSQL: no RLS, no LISTEN/NOTIFY (poll outbox_event),
--  updated_at is set by the API, money is NUMERIC affinity (use Decimal in code).
-- =====================================================================
PRAGMA foreign_keys = ON;

-- =====================================================================
-- 1. TENANCY & LOCALISATION
-- =====================================================================

-- organization — owner ADMIN · read by all.
-- The legal entity (Admin "Store profile"). One row today; the B2B
-- platform later hosts many organisations in the same database.
CREATE TABLE organization (
  id               text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  legal_name       text NOT NULL,                       -- "SEER Restaurant PLC"
  trade_name       text,
  tin_number       text NOT NULL,                       -- 10-digit ERCA/MoR TIN
  vat_number       text,
  license_number   text,                                -- trade licence
  address          text,
  phone            text,
  currency_code    text NOT NULL DEFAULT 'ETB' CHECK (length(currency_code) = 3),
  currency_symbol  text NOT NULL DEFAULT 'ETB' CHECK (currency_symbol IN ('ETB','Br')),
  is_vat_enabled   INTEGER NOT NULL DEFAULT true,
  vat_rate         NUMERIC NOT NULL DEFAULT 0.15 CHECK (vat_rate >= 0 AND vat_rate < 1),
  default_language text NOT NULL DEFAULT 'en',
  timezone         text NOT NULL DEFAULT 'Africa/Addis_Ababa',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- language — reference · en / am / om today.
CREATE TABLE language (
  code        text PRIMARY KEY,                         -- BCP-47 primary tag
  name_native text NOT NULL,                            -- "English", "አማርኛ", "Afaan Oromoo"
  is_active   INTEGER NOT NULL DEFAULT true
);

-- i18n_text — owner ADMIN · read by every frontend.
-- One row per (key, language). Keys match the frontends' registerText()
-- keys: "cogs.RAW_INGREDIENTS", "menu.doro-wat", "station.GRILL", "inv.onion".
-- org_id NULL = platform default; an org row overrides it.
CREATE TABLE i18n_text (
  id         text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id     text REFERENCES organization(id) ON DELETE CASCADE,
  key        text NOT NULL,
  lang       text NOT NULL REFERENCES language(code),
  text       text NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_i18n_text_platform ON i18n_text (key, lang) WHERE org_id IS NULL;
CREATE UNIQUE INDEX ux_i18n_text_org      ON i18n_text (org_id, key, lang) WHERE org_id IS NOT NULL;

-- branch — owner ADMIN · read by all.
CREATE TABLE branch (
  id          text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id      text NOT NULL REFERENCES organization(id),
  code        text NOT NULL,                            -- "BOL" — prefixes order/receipt numbers
  name        text NOT NULL,
  name_key    text,                                     -- i18n key, e.g. "branch.BR-BOLE"
  address     text,
  phone       text,
  timezone    text NOT NULL DEFAULT 'Africa/Addis_Ababa',
  is_active   INTEGER NOT NULL DEFAULT true,
  opened_on   date,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT,
  UNIQUE (org_id, id),                                  -- target of composite FKs
  UNIQUE (org_id, code)
);
-- manager_user_id is added after app_user exists (see §2).


-- =====================================================================
-- 2. IDENTITY & ACCESS  (one person = one app_user, in every module)
-- =====================================================================

-- role — reference · ADMIN seeds, all read.
CREATE TABLE role (
  code        text PRIMARY KEY,                         -- ADMIN, BRANCH_MANAGER, SALES_STAFF, KITCHEN_STAFF, INVENTORY_CLERK, …
  name_key    text NOT NULL,                            -- "role.BRANCH_MANAGER"
  scope       text NOT NULL DEFAULT 'BRANCH' CHECK (scope IN ('ORG','BRANCH')),
  is_system   INTEGER NOT NULL DEFAULT true,            -- system roles cannot be deleted
  sort_order  integer NOT NULL DEFAULT 0
);

-- permission — reference. Codes are "<module>.<action>".
-- The nine Admin matrix booleans are kept as codes (see docs/ARCHITECTURE.md §6).
CREATE TABLE permission (
  code        text PRIMARY KEY,                         -- "purchase.review", "kds.bump", "admin.access"
  module      text NOT NULL,                            -- SALES | MGR | FIN | HR | ADMIN | KDS | POS | OWNER
  name_key    text NOT NULL,
  legacy_flag text                                      -- Admin RolePermissions field, e.g. "canApproveDispatch"
);

-- role_permission — owner ADMIN (Access matrix).
-- Per-organisation grants; the platform defaults are seeded for each org.
CREATE TABLE role_permission (
  org_id          text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  role_code       text NOT NULL REFERENCES role(code),
  permission_code text NOT NULL REFERENCES permission(code),
  granted_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  granted_by      text,                                 -- app_user.id (no FK: survives user deletion)
  PRIMARY KEY (org_id, role_code, permission_code)
);

-- app_user — owner ADMIN (accounts) + HR (people) · read by all.
-- Every actor column in every module points here: purchases.logged_by,
-- attendance.employee, kds_ticket.bumped_by, audit_log.actor_user_id.
CREATE TABLE app_user (
  id                 text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id             text NOT NULL REFERENCES organization(id),
  staff_code         text,                              -- printed staff ID: "SS-104", "BM-001"
  full_name          text NOT NULL,
  initials           text,
  username           text,                              -- NULL for PIN-only floor staff
  email              text,
  phone              text,
  password_hash      text,                              -- PHC string (argon2id or scrypt); NULL = no password login
  pin_hash           text,                              -- PHC string of a 4–6 digit PIN for shared terminals
  role_code          text NOT NULL REFERENCES role(code),   -- primary role
  home_branch_id     text,
  preferred_language text NOT NULL DEFAULT 'en' REFERENCES language(code),
  is_active          INTEGER NOT NULL DEFAULT true,
  failed_logins      integer NOT NULL DEFAULT 0,
  locked_until       TEXT,
  last_login_at      TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at         TEXT,
  FOREIGN KEY (org_id, home_branch_id) REFERENCES branch (org_id, id)
);
CREATE UNIQUE INDEX ux_app_user_username   ON app_user (org_id, lower(username)) WHERE username IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX ux_app_user_staff_code ON app_user (org_id, staff_code)      WHERE staff_code IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_app_user_branch ON app_user (home_branch_id) WHERE deleted_at IS NULL;

ALTER TABLE branch ADD COLUMN manager_user_id text REFERENCES app_user(id);

-- user_branch_role — owner ADMIN.
-- Extra branch assignments: a manager covering two branches, a clerk who
-- also works the Piassa store room. The home branch + primary role are implied.
CREATE TABLE user_branch_role (
  org_id     text NOT NULL,
  user_id    text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  branch_id  text NOT NULL,
  role_code  text NOT NULL REFERENCES role(code),
  valid_from date,
  valid_to   date,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, branch_id, role_code),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
);

-- device — owner ADMIN · used by POS, KDS, HR (clock-in kiosk), printers.
-- A KDS screen or POS terminal signs in as a device, then a person
-- identifies with their PIN for each action.
CREATE TABLE device (
  id            text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id        text NOT NULL,
  branch_id     text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('POS','KDS','KIOSK','PRINTER','BACK_OFFICE')),
  name          text NOT NULL,                          -- "KDS-BOLE-01", "Epson TM-T20III (front counter)"
  station_code  text,                                   -- KDS: default station filter (FK added in §3)
  connection    text CHECK (connection IN ('USB','LAN','BT','CLOUD')),
  ip_address    text,
  secret_hash   text,                                   -- device credential (PHC hash)
  is_active     INTEGER NOT NULL DEFAULT true,
  last_seen_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id),
  UNIQUE (branch_id, name)
);

-- auth_session — API. Refresh-token sessions for people and devices.
CREATE TABLE auth_session (
  id                 text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id            text REFERENCES app_user(id) ON DELETE CASCADE,
  device_id          text REFERENCES device(id) ON DELETE CASCADE,
  active_branch_id   text REFERENCES branch(id),
  refresh_token_hash text NOT NULL UNIQUE,
  user_agent         text,
  ip_address         text,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at         TEXT NOT NULL,
  revoked_at         TEXT,
  CHECK (user_id IS NOT NULL OR device_id IS NOT NULL)
);
CREATE INDEX ix_auth_session_user ON auth_session (user_id) WHERE revoked_at IS NULL;

-- legacy_id_map — migration only.
-- Each frontend invented its own IDs for the same thing; this records
-- them so imports and old URLs/exports resolve to one canonical row.
--   ('SALES','user','u-hanna') → U-002   ('HR','employee','EMP-001') → U-002
--   ('HR','branch','BR-BOLE-01') → BR-BOLE   ('ADMIN','menu_item','DORO_WAT') → doro-wat
CREATE TABLE legacy_id_map (
  module      text NOT NULL,
  entity_type text NOT NULL,
  legacy_id   text NOT NULL,
  canonical_id text NOT NULL,
  note        text,
  PRIMARY KEY (module, entity_type, legacy_id)
);
CREATE INDEX ix_legacy_id_map_canonical ON legacy_id_map (entity_type, canonical_id);


-- =====================================================================
-- 3. SHARED REFERENCE DATA & CATALOGUES
-- =====================================================================

-- payment_method — reference · POS, SALES, MGR, FIN, OWNER.
CREATE TABLE payment_method (
  code              text PRIMARY KEY,                   -- CASH, TELEBIRR, CBE_BIRR (later: CARD, BANK_TRANSFER, CREDIT)
  name_key          text NOT NULL,                      -- "pay.CASH"
  default_account_kind text NOT NULL,                   -- where money lands: CASH_DRAWER, TELEBIRR, CBE_BIRR, BANK
  requires_reference INTEGER NOT NULL DEFAULT false,    -- Telebirr / CBE Birr transaction ID
  is_active         INTEGER NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0
);

-- money_account — owner FIN · read by POS, SALES, MGR, OWNER.
-- Where money sits. Manager's "PETTY_CASH" source and Finance's "BANK"
-- account are accounts, not payment methods.
CREATE TABLE money_account (
  id           text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id       text NOT NULL REFERENCES organization(id),
  branch_id    text,                                    -- NULL = head-office account
  kind         text NOT NULL CHECK (kind IN ('CASH_DRAWER','PETTY_CASH','SAFE','BANK','TELEBIRR','CBE_BIRR')),
  name         text NOT NULL,
  account_ref  text,                                    -- masked: "•••• 5678", merchant short code
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  opened_on    date,
  is_active    INTEGER NOT NULL DEFAULT true,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
);
CREATE UNIQUE INDEX ux_money_account_kind ON money_account (org_id, coalesce(branch_id, '-'), kind, name);

-- cost_category — reference · SALES, MGR, FIN, OWNER.
-- One list for COGS and OPEX so purchases, expenses, bills and budgets
-- all roll up the same way in the P&L.
CREATE TABLE cost_category (
  code        text PRIMARY KEY,                         -- RAW_INGREDIENTS … CLEANING_SANITATION, RENT, UTILITIES, PAYROLL …
  kind        text NOT NULL CHECK (kind IN ('COGS','OPEX')),
  name_key    text NOT NULL,
  owner_group text,                                     -- FFII budget bucket: FOOD_COST, LABOR, UTILITIES, RENT, MARKETING, SUPPLIES
  sort_order  integer NOT NULL DEFAULT 0
);

-- inventory_main_category — reference · SALES picker (VEGETABLES → Onion).
CREATE TABLE inventory_main_category (
  code               text PRIMARY KEY,                  -- VEGETABLES, MEAT_FISH, …
  cost_category_code text NOT NULL REFERENCES cost_category(code),
  name_key           text NOT NULL,
  sort_order         integer NOT NULL DEFAULT 0
);

-- expense_tag — reference · SALES custom expenses, MGR expenses.
CREATE TABLE expense_tag (
  code               text PRIMARY KEY,                  -- MAINTENANCE, TRANSPORT, UTILITIES, …
  cost_category_code text NOT NULL REFERENCES cost_category(code),
  name_key           text NOT NULL
);

-- waste_reason — reference · SALES, MGR.
CREATE TABLE waste_reason (
  code          text PRIMARY KEY,                       -- PREP_WASTE … OTHER
  name_key      text NOT NULL,
  requires_note INTEGER NOT NULL DEFAULT false,         -- INVENTORY_THEFT, OTHER
  is_controllable INTEGER NOT NULL DEFAULT true
);

-- unit — reference.
CREATE TABLE unit (
  code       text PRIMARY KEY,                          -- kg, g, l, ml, pcs, pack, crate, bottle, …
  name_key   text NOT NULL,
  dimension  text NOT NULL CHECK (dimension IN ('MASS','VOLUME','COUNT')),
  to_base    NUMERIC NOT NULL DEFAULT 1           -- factor to kg / l / pcs
);

-- vendor — owner FIN · picked in SALES purchases, reviewed by MGR.
CREATE TABLE vendor (
  id                 text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id             text NOT NULL REFERENCES organization(id),
  name               text NOT NULL,
  tin_number         text,                              -- NULL → 30 % withholding applies
  vat_registered     INTEGER NOT NULL DEFAULT false,    -- input VAT deductible
  supply_kind        text NOT NULL DEFAULT 'GOODS' CHECK (supply_kind IN ('GOODS','SERVICES')),
  default_cost_category text REFERENCES cost_category(code),
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  phone              text,
  telebirr_number    text,
  is_active          INTEGER NOT NULL DEFAULT true,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at         TEXT
);
CREATE UNIQUE INDEX ux_vendor_name ON vendor (org_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX ix_vendor_tin ON vendor (org_id, tin_number);

-- tax_rule — owner FIN/ADMIN · read by POS (VAT), FIN (WHT), HR (pension).
-- Dated so a rate change never rewrites history.
CREATE TABLE tax_rule (
  id         text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id     text REFERENCES organization(id),          -- NULL = national default
  code       text NOT NULL,                             -- VAT, WHT_GOODS, WHT_SERVICES, WHT_NO_TIN, PENSION_EMPLOYEE, PENSION_EMPLOYER, PROFIT_TAX
  rate       NUMERIC NOT NULL,
  threshold  NUMERIC,                             -- WHT: 20 000 goods / 10 000 services
  valid_from TEXT NOT NULL,
  valid_to   date,
  legal_ref  text,                                      -- "Proclamation 1395/2025"
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX ix_tax_rule_lookup ON tax_rule (code, valid_from);

-- paye_bracket — owner HR · monthly PAYE: tax = income × rate − deduction.
CREATE TABLE paye_bracket (
  id          text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  valid_from  TEXT NOT NULL,
  valid_to    date,
  upper_limit NUMERIC,                            -- NULL = no upper limit
  rate        NUMERIC NOT NULL,
  deduction   NUMERIC NOT NULL DEFAULT 0,
  legal_ref   text
);
CREATE INDEX ix_paye_bracket ON paye_bracket (valid_from, upper_limit);

-- shift_template — owner HR · read by MGR (shift-aware overview), POS (order.shift_code).
-- HR has MORNING / DAY / EVENING; Manager's MORNING / EVENING are a subset.
CREATE TABLE shift_template (
  id              text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id          text NOT NULL REFERENCES organization(id),
  branch_id       text,                                 -- NULL = org default
  code            text NOT NULL,                        -- MORNING, DAY, EVENING
  name_key        text NOT NULL,
  start_time      TEXT NOT NULL,
  end_time        TEXT NOT NULL,                        -- may be < start_time (crosses midnight)
  paid_hours      NUMERIC NOT NULL,
  coverage_target integer NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT true,
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
);
CREATE UNIQUE INDEX ux_shift_template ON shift_template (org_id, coalesce(branch_id, '-'), code);

-- kitchen_station — reference · owner ADMIN · read by KDS, POS.
CREATE TABLE kitchen_station (
  code       text PRIMARY KEY,                          -- GRILL, HOT_KITCHEN, SALAD, BAR
  name_key   text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);
-- (device.station_code FK; device was created before stations existed)
-- SQLite cannot ADD CONSTRAINT; device.station_code is validated by the API.


-- menu_category — reference · POS, MGR, FIN (food vs beverage revenue split).
CREATE TABLE menu_category (
  code          text PRIMARY KEY,                       -- MAINS, FASTING, BREAKFAST, HOT_DRINKS, COLD_DRINKS, BAR
  name_key      text NOT NULL,
  revenue_class text NOT NULL CHECK (revenue_class IN ('FOOD','BEVERAGE')),
  sort_order    integer NOT NULL DEFAULT 0
);

-- menu_item — owner ADMIN (price book) · read by POS, KDS, MGR, FIN, OWNER.
-- What customers buy. Prices are VAT-inclusive, as rung up at the register.
CREATE TABLE menu_item (
  id             text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),   -- slug: "doro-wat"
  org_id         text NOT NULL REFERENCES organization(id),
  sku            text,                                  -- "DORO_WAT" (Admin legacy key)
  name_key       text NOT NULL,                         -- "menu.doro-wat"
  category_code  text NOT NULL REFERENCES menu_category(code),
  station_code   text NOT NULL REFERENCES kitchen_station(code),   -- where KDS routes it
  base_price     NUMERIC NOT NULL CHECK (base_price >= 0),
  price_includes_vat INTEGER NOT NULL DEFAULT true,
  is_fasting     INTEGER NOT NULL DEFAULT false,        -- Orthodox fasting-day filter
  is_active      INTEGER NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT
);
CREATE UNIQUE INDEX ux_menu_item_sku ON menu_item (org_id, sku) WHERE sku IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_menu_item_category ON menu_item (org_id, category_code) WHERE deleted_at IS NULL;

-- menu_item_branch_price — owner ADMIN · Admin "overrides": branch price ≠ base price.
CREATE TABLE menu_item_branch_price (
  org_id       text NOT NULL,
  menu_item_id text NOT NULL REFERENCES menu_item(id) ON DELETE CASCADE,
  branch_id    text NOT NULL,
  price        NUMERIC NOT NULL CHECK (price >= 0),
  is_available INTEGER NOT NULL DEFAULT true,           -- 86'd at this branch
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by   text REFERENCES app_user(id),
  PRIMARY KEY (menu_item_id, branch_id),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
);

-- modifier — owner ADMIN · POS picks, KDS shows ("No onion", "Extra awaze").
CREATE TABLE modifier (
  id          text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id      text NOT NULL REFERENCES organization(id),
  name_key    text NOT NULL,
  price_delta NUMERIC NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT true
);

CREATE TABLE menu_item_modifier (
  menu_item_id text NOT NULL REFERENCES menu_item(id) ON DELETE CASCADE,
  modifier_id  text NOT NULL REFERENCES modifier(id) ON DELETE CASCADE,
  PRIMARY KEY (menu_item_id, modifier_id)
);

-- inventory_item — owner SALES (clerk adds custom items) · read by MGR, FIN.
-- What the business BUYS, wastes and counts. Not the same as menu_item.
CREATE TABLE inventory_item (
  id                 text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),  -- "onion", "beef"
  org_id             text NOT NULL REFERENCES organization(id),
  sku                text,
  name_key           text NOT NULL,                     -- "inv.onion"
  custom_name        text,                              -- free-text name for clerk-created items
  main_category_code text NOT NULL REFERENCES inventory_main_category(code),
  group_key          text,                              -- "group.produce"
  unit_code          text NOT NULL REFERENCES unit(code),
  standard_unit_cost NUMERIC NOT NULL DEFAULT 0,  -- catalogue cost used until a purchase sets one
  is_custom          INTEGER NOT NULL DEFAULT false,
  is_active          INTEGER NOT NULL DEFAULT true,
  created_by         text REFERENCES app_user(id),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at         TEXT
);
CREATE INDEX ix_inventory_item_main ON inventory_item (org_id, main_category_code) WHERE deleted_at IS NULL;

-- inventory_item_alias — SALES search ("shinkurt" → onion). Portable instead of text[].
CREATE TABLE inventory_item_alias (
  item_id text NOT NULL REFERENCES inventory_item(id) ON DELETE CASCADE,
  alias   text NOT NULL,
  PRIMARY KEY (item_id, alias)
);
CREATE INDEX ix_inventory_item_alias ON inventory_item_alias (lower(alias));

-- recipe_component — owner ADMIN/MGR · optional bill of materials.
-- Lets a sale deplete stock and gives theoretical vs actual COGS later.
CREATE TABLE recipe_component (
  menu_item_id      text NOT NULL REFERENCES menu_item(id) ON DELETE CASCADE,
  inventory_item_id text NOT NULL REFERENCES inventory_item(id),
  quantity          NUMERIC NOT NULL CHECK (quantity > 0),
  unit_code         text NOT NULL REFERENCES unit(code),
  PRIMARY KEY (menu_item_id, inventory_item_id)
);

-- stock_location — owner MGR · dispatch destinations inside a branch.
CREATE TABLE stock_location (
  id         text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id     text NOT NULL,
  branch_id  text NOT NULL,
  code       text NOT NULL,                             -- STORE_ROOM, BAR, KITCHEN_LINE, TAKEAWAY_COUNTER, CATERING, EVENT_HALL
  name_key   text NOT NULL,
  is_store_room INTEGER NOT NULL DEFAULT false,         -- the location whose stock MGR tracks
  is_active  INTEGER NOT NULL DEFAULT true,
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id),
  UNIQUE (branch_id, code)
);


-- =====================================================================
-- 4. INVENTORY, PURCHASING, WASTE, DISPATCH, EXPENSES  (SALES ⇄ MGR ⇄ FIN)
-- =====================================================================

-- branch_stock — projection of stock_movement · read by MGR (LOW STOCK), SALES.
-- Updated in the same transaction as each movement.
CREATE TABLE branch_stock (
  org_id            text NOT NULL,
  branch_id         text NOT NULL,
  item_id           text NOT NULL REFERENCES inventory_item(id),
  on_hand           NUMERIC NOT NULL DEFAULT 0,
  reorder_point     NUMERIC NOT NULL DEFAULT 0,
  last_unit_cost    NUMERIC,                      -- from the latest approved purchase
  avg_unit_cost     NUMERIC,                      -- moving weighted average (values waste)
  last_counted_at   TEXT,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (branch_id, item_id),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
);
CREATE INDEX ix_branch_stock_low ON branch_stock (branch_id) WHERE on_hand <= reorder_point;

-- purchase — owner SALES (create) → MGR (review) → FIN (bill/payable).
-- One stock line bought from a vendor. Approval adds stock and creates or
-- extends the vendor bill (bill_line.purchase_id).
CREATE TABLE purchase (
  id                  text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id              text NOT NULL,
  branch_id           text NOT NULL,
  item_id             text NOT NULL REFERENCES inventory_item(id),
  cost_category_code  text NOT NULL REFERENCES cost_category(code),  -- snapshot of item's COGS category
  quantity            NUMERIC NOT NULL CHECK (quantity > 0),
  unit_code           text NOT NULL REFERENCES unit(code),
  unit_cost           NUMERIC NOT NULL CHECK (unit_cost >= 0),
  total_cost          NUMERIC NOT NULL CHECK (total_cost >= 0),  -- what was paid / owed, VAT-inclusive
  vat_amount          NUMERIC NOT NULL DEFAULT 0,  -- input VAT on the receipt (0 if vendor not VAT-registered)
  has_vat_receipt     INTEGER NOT NULL DEFAULT false,
  receipt_no          text,
  vendor_id           text REFERENCES vendor(id),
  vendor_name         text NOT NULL,                     -- snapshot / free text from the Sales UI
  settlement          text NOT NULL DEFAULT 'PAID_NOW' CHECK (settlement IN ('PAID_NOW','ON_CREDIT')),
  payment_method_code text REFERENCES payment_method(code),        -- required when PAID_NOW
  money_account_id    text REFERENCES money_account(id),
  note                text NOT NULL DEFAULT '',
  logged_by           text NOT NULL REFERENCES app_user(id),
  purchased_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  business_date       TEXT NOT NULL,
  review_status       text NOT NULL DEFAULT 'PENDING' CHECK (review_status IN ('PENDING','APPROVED','FLAGGED','REJECTED')),
  reviewed_by         text REFERENCES app_user(id),
  reviewed_at         TEXT,
  flag_reason         text,
  client_ref          text,                              -- offline idempotency key from the tablet
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at          TEXT,
  deleted_by          text REFERENCES app_user(id),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id),
  CHECK (settlement = 'ON_CREDIT' OR payment_method_code IS NOT NULL),
  CHECK (review_status <> 'FLAGGED' OR flag_reason IS NOT NULL),
  CHECK (vat_amount >= 0 AND vat_amount <= total_cost)
);
CREATE INDEX ix_purchase_branch_date ON purchase (branch_id, business_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_purchase_review      ON purchase (branch_id, review_status, purchased_at) WHERE deleted_at IS NULL AND review_status IN ('PENDING','FLAGGED');
CREATE INDEX ix_purchase_vendor      ON purchase (vendor_id, business_date);
CREATE INDEX ix_purchase_item        ON purchase (item_id, purchased_at DESC);
CREATE UNIQUE INDEX ux_purchase_client_ref ON purchase (org_id, client_ref) WHERE client_ref IS NOT NULL;

-- waste_report — owner SALES (report) → MGR (approve) → FIN (P&L shrinkage).
CREATE TABLE waste_report (
  id                text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id            text NOT NULL,
  branch_id         text NOT NULL,
  item_id           text NOT NULL REFERENCES inventory_item(id),
  quantity_lost     NUMERIC NOT NULL CHECK (quantity_lost > 0),
  unit_code         text NOT NULL REFERENCES unit(code),
  unit_cost         NUMERIC NOT NULL CHECK (unit_cost >= 0),
  loss_value        NUMERIC GENERATED ALWAYS AS (round(quantity_lost * unit_cost, 2)) STORED,
  reason_code       text NOT NULL REFERENCES waste_reason(code),
  notes             text,
  reported_by       text NOT NULL REFERENCES app_user(id),   -- who witnessed it
  logged_by         text NOT NULL REFERENCES app_user(id),   -- who typed it (may differ)
  occurred_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  business_date     TEXT NOT NULL,
  approval_status   text NOT NULL DEFAULT 'PENDING' CHECK (approval_status IN ('PENDING','APPROVED','REJECTED')),
  decided_by        text REFERENCES app_user(id),
  decided_at        TEXT,
  rejection_reason  text,
  client_ref        text,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT,
  deleted_by        text REFERENCES app_user(id),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id),
  CHECK ((approval_status = 'PENDING') = (decided_at IS NULL))
);
CREATE INDEX ix_waste_branch_date ON waste_report (branch_id, business_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_waste_pending     ON waste_report (branch_id, occurred_at) WHERE approval_status = 'PENDING' AND deleted_at IS NULL;
CREATE UNIQUE INDEX ux_waste_client_ref ON waste_report (org_id, client_ref) WHERE client_ref IS NOT NULL;

-- dispatch_request — owner SALES/kitchen (request) → MGR (approve).
-- Stock leaving the store room for a station, an event, or another branch.
CREATE TABLE dispatch_request (
  id                text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id            text NOT NULL,
  branch_id         text NOT NULL,
  item_id           text NOT NULL REFERENCES inventory_item(id),
  quantity          NUMERIC NOT NULL CHECK (quantity > 0),
  unit_code         text NOT NULL REFERENCES unit(code),
  to_location_id    text REFERENCES stock_location(id),  -- BAR, KITCHEN_LINE, …
  to_branch_id      text REFERENCES branch(id),          -- inter-branch transfer (Manager's BRANCH_PIASSA)
  requested_by      text NOT NULL REFERENCES app_user(id),
  requested_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status            text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED','RECEIVED')),
  decided_by        text REFERENCES app_user(id),
  decided_at        TEXT,
  rejection_reason  text,
  received_by       text REFERENCES app_user(id),        -- transfer: receiving branch confirms
  received_at       TEXT,
  note              text,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id),
  CHECK ((to_location_id IS NULL) <> (to_branch_id IS NULL)),
  CHECK (to_branch_id IS NULL OR to_branch_id <> branch_id),
  CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL)
);
CREATE INDEX ix_dispatch_queue ON dispatch_request (branch_id, status, requested_at);

-- expense — owner SALES / MGR (log) → FIN (P&L, cash movement).
-- Non-stock spending paid on the spot (taxi, repairs, staff tea).
-- Larger supplier invoices go through bill instead.
CREATE TABLE expense (
  id                  text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id              text NOT NULL,
  branch_id           text NOT NULL,
  reason              text NOT NULL,
  tag_code            text NOT NULL REFERENCES expense_tag(code),
  cost_category_code  text NOT NULL REFERENCES cost_category(code),  -- from tag, overridable by FIN
  amount              NUMERIC NOT NULL CHECK (amount > 0),
  vat_amount          NUMERIC NOT NULL DEFAULT 0,
  has_vat_receipt     INTEGER NOT NULL DEFAULT false,
  payment_method_code text NOT NULL REFERENCES payment_method(code),
  money_account_id    text REFERENCES money_account(id),   -- petty cash, drawer, Telebirr wallet
  vendor_id           text REFERENCES vendor(id),
  note                text NOT NULL DEFAULT '',
  logged_by           text NOT NULL REFERENCES app_user(id),
  spent_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  business_date       TEXT NOT NULL,
  review_status       text NOT NULL DEFAULT 'PENDING' CHECK (review_status IN ('PENDING','APPROVED','FLAGGED','REJECTED')),
  reviewed_by         text REFERENCES app_user(id),
  reviewed_at         TEXT,
  client_ref          text,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at          TEXT,
  deleted_by          text REFERENCES app_user(id),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
);
CREATE INDEX ix_expense_branch_date ON expense (branch_id, business_date DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_expense_client_ref ON expense (org_id, client_ref) WHERE client_ref IS NOT NULL;

-- stock_movement — append-only stock ledger · written by SALES/MGR/POS flows.
CREATE TABLE stock_movement (
  id           text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id       text NOT NULL,
  branch_id    text NOT NULL,
  item_id      text NOT NULL REFERENCES inventory_item(id),
  qty_delta    NUMERIC NOT NULL CHECK (qty_delta <> 0),   -- + in, − out (in item unit)
  unit_cost    NUMERIC,
  kind         text NOT NULL CHECK (kind IN ('PURCHASE','WASTE','DISPATCH','TRANSFER_OUT','TRANSFER_IN','SALE_DEPLETION','COUNT_ADJUST','OPENING')),
  purchase_id  text REFERENCES purchase(id),
  waste_id     text REFERENCES waste_report(id),
  dispatch_id  text REFERENCES dispatch_request(id),
  order_line_id text,                                    -- FK added after order_line (§5)
  reason       text,                                     -- required for COUNT_ADJUST
  created_by   text REFERENCES app_user(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id),
  CHECK (kind <> 'COUNT_ADJUST' OR reason IS NOT NULL)
);
CREATE INDEX ix_stock_movement_item ON stock_movement (branch_id, item_id, created_at DESC);


-- =====================================================================
-- 5. POS ORDERS & KITCHEN DISPLAY  (POS → KDS → MGR sales → FIN revenue)
-- =====================================================================

-- till_session — owner POS · read by MGR (shift overview), FIN (reconciliation).
-- A cashier's drawer from open to close on one terminal.
CREATE TABLE till_session (
  id              text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id          text NOT NULL,
  branch_id       text NOT NULL,
  device_id       text REFERENCES device(id),
  money_account_id text REFERENCES money_account(id),    -- the CASH_DRAWER
  business_date   TEXT NOT NULL,
  shift_code      text NOT NULL,                         -- MORNING / DAY / EVENING
  opened_by       text NOT NULL REFERENCES app_user(id),
  opened_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  opening_float   NUMERIC NOT NULL DEFAULT 0,
  closed_by       text REFERENCES app_user(id),
  closed_at       TEXT,
  cash_counted    NUMERIC,
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
);
CREATE INDEX ix_till_session_day ON till_session (branch_id, business_date);
CREATE UNIQUE INDEX ux_till_session_open ON till_session (device_id) WHERE status = 'OPEN';

-- customer_order — owner POS · read by KDS (via kds_ticket), MGR (sales), FIN (Z-report), OWNER.
CREATE TABLE customer_order (
  id              text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id          text NOT NULL,
  branch_id       text NOT NULL,
  order_number    text NOT NULL,                         -- short daily number shown on KDS: "042"
  business_date   TEXT NOT NULL,
  shift_code      text NOT NULL,
  order_type      text NOT NULL CHECK (order_type IN ('DINE_IN','TAKEOUT','DELIVERY')),
  table_number    text,
  customer_name   text,
  guest_count     integer,
  till_session_id text REFERENCES till_session(id),
  opened_by       text NOT NULL REFERENCES app_user(id), -- KDS "submittedBy"
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SENT','PAID','VOIDED','REFUNDED')),
  -- totals are maintained by the API from order_line; VAT-inclusive pricing:
  total_gross     NUMERIC NOT NULL DEFAULT 0,      -- what the customer pays
  vat_amount      NUMERIC NOT NULL DEFAULT 0,      -- gross × rate / (1 + rate)
  total_net       NUMERIC GENERATED ALWAYS AS (total_gross - vat_amount) STORED,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  receipt_no      text,                                  -- fiscal receipt number once printed
  paid_at         TEXT,
  voided_by       text REFERENCES app_user(id),
  voided_at       TEXT,
  void_reason     text,
  client_ref      text,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id),
  UNIQUE (branch_id, business_date, order_number),
  CHECK (status <> 'VOIDED' OR void_reason IS NOT NULL)
);
CREATE INDEX ix_order_branch_day ON customer_order (branch_id, business_date, status);
CREATE INDEX ix_order_opened_by  ON customer_order (opened_by, business_date);
CREATE UNIQUE INDEX ux_order_receipt    ON customer_order (branch_id, receipt_no) WHERE receipt_no IS NOT NULL;
CREATE UNIQUE INDEX ux_order_client_ref ON customer_order (org_id, client_ref) WHERE client_ref IS NOT NULL;

-- order_line — owner POS · the MGR "SaleLine", the KDS item, the FIN revenue line.
CREATE TABLE order_line (
  id             text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  order_id       text NOT NULL REFERENCES customer_order(id) ON DELETE CASCADE,
  line_no        integer NOT NULL,
  menu_item_id   text NOT NULL REFERENCES menu_item(id),
  item_name      text NOT NULL,                          -- English snapshot for receipts/exports
  revenue_class  text NOT NULL CHECK (revenue_class IN ('FOOD','BEVERAGE')),  -- snapshot
  station_code   text NOT NULL REFERENCES kitchen_station(code),             -- snapshot
  quantity       NUMERIC NOT NULL CHECK (quantity > 0),
  unit_price     NUMERIC NOT NULL CHECK (unit_price >= 0),            -- VAT-inclusive, after branch override
  modifiers_total NUMERIC NOT NULL DEFAULT 0,
  line_total     NUMERIC GENERATED ALWAYS AS (round(quantity * (unit_price + modifiers_total), 2)) STORED,
  vat_rate       NUMERIC NOT NULL DEFAULT 0.15,
  note           text,
  course         integer NOT NULL DEFAULT 1,             -- fire later courses as separate tickets
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','VOIDED')),
  voided_by      text REFERENCES app_user(id),
  voided_at      TEXT,
  void_reason    text,                                   -- feeds HR performance_log VOID_INCIDENT
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (order_id, line_no)
);
CREATE INDEX ix_order_line_menu ON order_line (menu_item_id);
CREATE INDEX ix_order_line_voided ON order_line (voided_by, voided_at) WHERE status = 'VOIDED';


-- order_line_modifier — POS → KDS ("No onion").
CREATE TABLE order_line_modifier (
  id            text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  order_line_id text NOT NULL REFERENCES order_line(id) ON DELETE CASCADE,
  modifier_id   text REFERENCES modifier(id),            -- NULL = free-text note
  name          text NOT NULL,
  note          text,
  price_delta   NUMERIC NOT NULL DEFAULT 0
);
CREATE INDEX ix_order_line_modifier ON order_line_modifier (order_line_id);

-- order_payment — owner POS · read by MGR (payment reconciliation), FIN (Z-report, cash).
-- Split tender supported: one order, several payments.
CREATE TABLE order_payment (
  id                  text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  order_id            text NOT NULL REFERENCES customer_order(id),
  payment_method_code text NOT NULL REFERENCES payment_method(code),
  money_account_id    text REFERENCES money_account(id),
  amount              NUMERIC NOT NULL CHECK (amount <> 0),   -- negative = refund
  tendered            NUMERIC,                     -- cash given (change = tendered − amount)
  reference           text,                              -- Telebirr / CBE Birr transaction ID
  received_by         text NOT NULL REFERENCES app_user(id),
  received_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status              text NOT NULL DEFAULT 'CAPTURED' CHECK (status IN ('CAPTURED','REVERSED'))
);
CREATE INDEX ix_order_payment_order  ON order_payment (order_id);
CREATE INDEX ix_order_payment_method ON order_payment (payment_method_code, received_at);
CREATE UNIQUE INDEX ux_order_payment_ref ON order_payment (payment_method_code, reference) WHERE reference IS NOT NULL AND status = 'CAPTURED';

-- kds_ticket — owner KDS (status) · created by POS when an order is sent.
-- One order can fire several tickets (later courses, items added after send).
CREATE TABLE kds_ticket (
  id            text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id        text NOT NULL,
  branch_id     text NOT NULL,
  order_id      text NOT NULL REFERENCES customer_order(id),
  fire_seq      integer NOT NULL DEFAULT 1,
  order_number  text NOT NULL,                           -- snapshot for the board
  order_type    text NOT NULL CHECK (order_type IN ('DINE_IN','TAKEOUT','DELIVERY')),
  table_number  text,
  customer_name text,
  submitted_by  text NOT NULL REFERENCES app_user(id),
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PREPARING','READY','BUMPED','VOIDED')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at    TEXT,                             -- first move to PREPARING
  ready_at      TEXT,                             -- timer freezes here
  bumped_at     TEXT,                             -- picked up → leaves the board ("remove")
  bumped_by     text REFERENCES app_user(id),
  bumped_from_status text CHECK (bumped_from_status IN ('PENDING','PREPARING','READY')),  -- recall restores it
  recalled_at   TEXT,
  recalled_by   text REFERENCES app_user(id),
  version       integer NOT NULL DEFAULT 1,              -- optimistic concurrency for KDS commands
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id),
  UNIQUE (order_id, fire_seq)
);
-- The board query: everything not yet bumped/voided, oldest first.
CREATE INDEX ix_kds_ticket_active ON kds_ticket (branch_id, created_at) WHERE status IN ('PENDING','PREPARING','READY');
-- Recall list: the last N bumped tickets.
CREATE INDEX ix_kds_ticket_bumped ON kds_ticket (branch_id, bumped_at DESC) WHERE status = 'BUMPED';

-- kds_ticket_item — owner KDS · one per order_line on the ticket.
CREATE TABLE kds_ticket_item (
  id            text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  ticket_id     text NOT NULL REFERENCES kds_ticket(id) ON DELETE CASCADE,
  order_line_id text NOT NULL REFERENCES order_line(id),
  menu_item_id  text NOT NULL REFERENCES menu_item(id),
  item_name     text NOT NULL,
  quantity      NUMERIC NOT NULL CHECK (quantity > 0),
  station_code  text NOT NULL REFERENCES kitchen_station(code),
  is_completed  INTEGER NOT NULL DEFAULT false,
  completed_at  TEXT,
  completed_by  text REFERENCES app_user(id),
  is_voided     INTEGER NOT NULL DEFAULT false,
  UNIQUE (ticket_id, order_line_id)
);
CREATE INDEX ix_kds_ticket_item_station ON kds_ticket_item (station_code, ticket_id);

-- outbox_event — transactional outbox · written by every flow that others must hear about.
-- The realtime service LISTENs on channel 'eirsha_outbox' (PostgreSQL) or
-- polls WHERE published_at IS NULL (SQLite / fallback) and pushes to
-- WebSocket subscribers by (branch_id, topic). Payload is already in the
-- wire shape, e.g. KDS {type:'upsert', ticket:{…}} / {type:'remove', ticketId}.
CREATE TABLE outbox_event (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id         text NOT NULL,
  branch_id      text,
  topic          text NOT NULL,                          -- 'kds.ticket', 'mgr.review', 'fin.zreport', 'stock.low'
  event_type     text NOT NULL,                          -- 'upsert', 'remove', 'created', 'approved', …
  aggregate_type text NOT NULL,
  aggregate_id   text NOT NULL,
  payload        TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  published_at   TEXT,
  attempts       integer NOT NULL DEFAULT 0
);
CREATE INDEX ix_outbox_unpublished ON outbox_event (id) WHERE published_at IS NULL;
CREATE INDEX ix_outbox_replay      ON outbox_event (branch_id, topic, id);

-- idempotency_key — API · every mutating POST (KDS commands send Idempotency-Key).
CREATE TABLE idempotency_key (
  key           text NOT NULL,
  actor_id      text NOT NULL,                           -- user or device
  method_path   text NOT NULL,
  request_hash  text NOT NULL,
  status_code   integer,
  response_body TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (actor_id, key)
);
CREATE INDEX ix_idempotency_created ON idempotency_key (created_at);


-- =====================================================================
-- 6. FINANCE & ACCOUNTING
-- =====================================================================

-- daily_sales_summary — the Z-report · built by POS day-close → FIN, MGR, OWNER.
-- Frozen snapshot once CLOSED; live numbers come from v_daily_sales_live.
CREATE TABLE daily_sales_summary (
  org_id         text NOT NULL,
  branch_id      text NOT NULL,
  business_date  TEXT NOT NULL,
  gross          NUMERIC NOT NULL DEFAULT 0,       -- VAT-inclusive
  vat            NUMERIC NOT NULL DEFAULT 0,
  net            NUMERIC GENERATED ALWAYS AS (gross - vat) STORED,
  food_net       NUMERIC NOT NULL DEFAULT 0,       -- ex-VAT, as finance-main reports it
  beverage_net   NUMERIC NOT NULL DEFAULT 0,
  order_count    integer NOT NULL DEFAULT 0,
  guest_count    integer,
  void_count     integer NOT NULL DEFAULT 0,
  void_amount    NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  z_number       integer,                                -- fiscal Z counter
  status         text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  closed_by      text REFERENCES app_user(id),
  closed_at      TEXT,
  source         text NOT NULL DEFAULT 'POS' CHECK (source IN ('POS','IMPORT','MANUAL')),
  PRIMARY KEY (branch_id, business_date),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id),
  CHECK (abs(food_net + beverage_net - (gross - vat)) < 0.05 OR source = 'MANUAL')
);
CREATE INDEX ix_daily_sales_org_date ON daily_sales_summary (org_id, business_date);

-- daily_sales_payment — Z-report tender breakdown (Finance byMethod).
CREATE TABLE daily_sales_payment (
  branch_id           text NOT NULL,
  business_date       TEXT NOT NULL,
  payment_method_code text NOT NULL REFERENCES payment_method(code),
  amount              NUMERIC NOT NULL DEFAULT 0,
  txn_count           integer NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_id, business_date, payment_method_code),
  FOREIGN KEY (branch_id, business_date) REFERENCES daily_sales_summary (branch_id, business_date) ON DELETE CASCADE
);

-- bill — owner FIN · vendor invoice / payable (accrual by issue_date).
-- Created by FIN directly, or automatically when MGR approves a purchase.
CREATE TABLE bill (
  id                 text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id             text NOT NULL,
  branch_id          text,                               -- NULL = head-office cost
  vendor_id          text NOT NULL REFERENCES vendor(id),
  bill_no            text NOT NULL,                      -- vendor's invoice number
  cost_category_code text NOT NULL REFERENCES cost_category(code),  -- dominant category (lines may differ)
  issue_date         TEXT NOT NULL,
  due_date           TEXT NOT NULL,
  description        text NOT NULL DEFAULT '',
  subtotal           NUMERIC NOT NULL CHECK (subtotal >= 0),  -- before VAT
  vat                NUMERIC NOT NULL DEFAULT 0 CHECK (vat >= 0),
  total              NUMERIC GENERATED ALWAYS AS (subtotal + vat) STORED,
  has_vat_receipt    INTEGER NOT NULL DEFAULT false,     -- needed to claim input VAT
  source             text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','PURCHASE','IMPORT')),
  status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('DRAFT','OPEN','PAID','VOID')),
  entered_by         text NOT NULL REFERENCES app_user(id),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  voided_by          text REFERENCES app_user(id),
  voided_at          TEXT,
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id),
  UNIQUE (vendor_id, bill_no),
  CHECK (due_date >= issue_date)
);
CREATE INDEX ix_bill_open ON bill (org_id, due_date) WHERE status = 'OPEN';
CREATE INDEX ix_bill_issue ON bill (org_id, issue_date, cost_category_code);

-- bill_line — FIN · links a payable back to the SALES purchase(s) it covers.
CREATE TABLE bill_line (
  id                 text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  bill_id            text NOT NULL REFERENCES bill(id) ON DELETE CASCADE,
  purchase_id        text UNIQUE REFERENCES purchase(id),  -- a purchase is billed at most once
  description        text NOT NULL,
  cost_category_code text NOT NULL REFERENCES cost_category(code),
  quantity           NUMERIC,
  unit_code          text REFERENCES unit(code),
  amount             NUMERIC NOT NULL,             -- before VAT
  vat                NUMERIC NOT NULL DEFAULT 0
);
CREATE INDEX ix_bill_line_bill ON bill_line (bill_id);

-- bill_payment — FIN · settles a bill; withholding kept back for the tax office.
CREATE TABLE bill_payment (
  id                  text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  bill_id             text NOT NULL REFERENCES bill(id),
  paid_on             TEXT NOT NULL,
  amount              NUMERIC NOT NULL CHECK (amount > 0),     -- portion of the bill settled
  withholding_rate    NUMERIC NOT NULL DEFAULT 0,               -- 0, 0.03 or 0.30
  withheld            NUMERIC NOT NULL DEFAULT 0 CHECK (withheld >= 0),
  net_paid            NUMERIC GENERATED ALWAYS AS (amount - withheld) STORED,
  payment_method_code text NOT NULL REFERENCES payment_method(code),
  money_account_id    text REFERENCES money_account(id),
  reference           text,
  wht_receipt_no      text,                              -- withholding receipt issued to vendor
  paid_by             text NOT NULL REFERENCES app_user(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (withheld <= amount)
);
CREATE INDEX ix_bill_payment_bill ON bill_payment (bill_id);
CREATE INDEX ix_bill_payment_date ON bill_payment (paid_on);

-- cash_movement — FIN ledger of every account in/out · OWNER balances.
-- Written by: order_payment (SALES), purchase paid now (VENDOR), expense,
-- bill_payment (VENDOR), payroll (PAYROLL), tax_filing (TAX), deposits.
CREATE TABLE cash_movement (
  id               text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id           text NOT NULL REFERENCES organization(id),
  branch_id        text,
  money_account_id text NOT NULL REFERENCES money_account(id),
  occurred_on      TEXT NOT NULL,
  amount           NUMERIC NOT NULL CHECK (amount <> 0),       -- + in, − out
  kind             text NOT NULL CHECK (kind IN ('SALES','DEPOSIT','VENDOR','EXPENSE','PAYROLL','TAX','FEE','TRANSFER','OPENING','ADJUSTMENT')),
  label            text NOT NULL,
  transfer_group   text,                                 -- pairs the two legs of a DEPOSIT/TRANSFER
  source_type      text,                                 -- 'order_payment', 'bill_payment', 'expense', 'purchase', 'payroll_run', 'tax_filing'
  source_id        text,
  created_by       text REFERENCES app_user(id),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_cash_movement_account ON cash_movement (money_account_id, occurred_on);
CREATE INDEX ix_cash_movement_source  ON cash_movement (source_type, source_id);

-- cash_reconciliation — FIN (with MGR) · daily expected vs counted per channel.
CREATE TABLE cash_reconciliation (
  org_id             text NOT NULL,
  branch_id          text NOT NULL,
  business_date      TEXT NOT NULL,
  cash_expected      NUMERIC NOT NULL DEFAULT 0,
  cash_counted       NUMERIC,
  bank_deposit       NUMERIC NOT NULL DEFAULT 0,
  bank_confirmed     INTEGER NOT NULL DEFAULT false,
  telebirr_expected  NUMERIC NOT NULL DEFAULT 0,
  telebirr_received  NUMERIC,
  cbe_birr_expected  NUMERIC NOT NULL DEFAULT 0,
  cbe_birr_received  NUMERIC,
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','MATCHED','VARIANCE')),
  note               text NOT NULL DEFAULT '',
  reconciled_by      text REFERENCES app_user(id),
  reconciled_at      TEXT,
  PRIMARY KEY (branch_id, business_date),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
);

-- tax_filing — FIN · monthly VAT / withholding / PAYE / pension returns.
CREATE TABLE tax_filing (
  id            text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id        text NOT NULL REFERENCES organization(id),
  period_month  TEXT NOT NULL CHECK (strftime('%d', period_month) = '01'),   -- first day of month
  kind          text NOT NULL CHECK (kind IN ('VAT','WHT','PAYE','PENSION','TOT','PROFIT')),
  amount_due    NUMERIC,
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','FILED','PAID')),
  filed_by      text REFERENCES app_user(id),
  filed_at      TEXT,
  reference     text,                                    -- MoR e-filing reference
  UNIQUE (org_id, kind, period_month)
);

-- budget_line — owner OWNER (FFII Budgets) · compared with FIN actuals.
CREATE TABLE budget_line (
  id                 text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id             text NOT NULL REFERENCES organization(id),
  branch_id          text,                               -- NULL = whole business
  period_month       TEXT NOT NULL CHECK (strftime('%d', period_month) = '01'),
  cost_category_code text NOT NULL REFERENCES cost_category(code),
  allocated          NUMERIC NOT NULL CHECK (allocated >= 0),
  fixed_commitment   NUMERIC,                      -- e.g. rent contract amount
  updated_by         text REFERENCES app_user(id),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
);
CREATE UNIQUE INDEX ux_budget_line ON budget_line (org_id, coalesce(branch_id, '-'), period_month, cost_category_code);


-- =====================================================================
-- 7. HR & STAFF
-- =====================================================================

-- employee — owner HR · 1:1 extension of app_user (same person, same ID).
CREATE TABLE employee (
  user_id         text PRIMARY KEY REFERENCES app_user(id),
  org_id          text NOT NULL REFERENCES organization(id),
  employee_no     text NOT NULL,                         -- "EMP-001"
  hire_date       TEXT NOT NULL,
  termination_date date,
  employment_type text NOT NULL DEFAULT 'PERMANENT' CHECK (employment_type IN ('PERMANENT','CONTRACT','PROBATION','CASUAL')),
  pay_type        text NOT NULL CHECK (pay_type IN ('HOURLY','MONTHLY')),
  hourly_rate     NUMERIC NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),   -- MONTHLY staff: overtime base
  monthly_salary  NUMERIC CHECK (monthly_salary >= 0),
  tin_number      text,                                  -- employee TIN for PAYE
  pension_no      text,
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ON_LEAVE','INACTIVE','TERMINATED')),
  emergency_contact text,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (org_id, employee_no),
  CHECK (pay_type = 'HOURLY' OR monthly_salary IS NOT NULL)
);

-- schedule_entry — owner HR · read by MGR (who's on shift), KIOSK (expected clock-ins).
CREATE TABLE schedule_entry (
  id          text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id      text NOT NULL,
  branch_id   text NOT NULL,
  employee_id text NOT NULL REFERENCES employee(user_id),
  work_date   TEXT NOT NULL,
  shift_code  text NOT NULL,
  role_code   text REFERENCES role(code),                -- role worked on this shift
  status      text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','PUBLISHED','CANCELLED')),
  created_by  text REFERENCES app_user(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id),
  UNIQUE (employee_id, work_date, shift_code)
);
CREATE INDEX ix_schedule_branch_week ON schedule_entry (branch_id, work_date);

-- attendance_record — owner HR · clock in/out (self at kiosk, or manager).
CREATE TABLE attendance_record (
  id                  text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id              text NOT NULL,
  branch_id           text NOT NULL,
  employee_id         text NOT NULL REFERENCES employee(user_id),
  schedule_entry_id   text REFERENCES schedule_entry(id),
  work_date           TEXT NOT NULL,
  shift_code          text NOT NULL,
  scheduled_start     TEXT NOT NULL,
  scheduled_end       TEXT NOT NULL,
  clock_in            TEXT,
  clock_out           TEXT,
  status              text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','CLOCKED_IN','COMPLETED','ABSENT')),
  late_minutes        integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  overtime_hours      NUMERIC NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  overtime_multiplier NUMERIC NOT NULL DEFAULT 1.5 CHECK (overtime_multiplier IN (1.0, 1.5, 1.75, 2.0, 2.5)),
  clock_method        text CHECK (clock_method IN ('PIN','MANAGER','DEVICE','IMPORT')),
  device_id           text REFERENCES device(id),
  logged_by           text REFERENCES app_user(id),
  approved_by         text REFERENCES app_user(id),      -- manager sign-off on overtime
  note                text,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id),
  UNIQUE (employee_id, work_date, shift_code),
  CHECK (clock_out IS NULL OR clock_in IS NULL OR clock_out > clock_in),
  CHECK (status <> 'COMPLETED' OR clock_out IS NOT NULL)
);
CREATE INDEX ix_attendance_branch_date ON attendance_record (branch_id, work_date);
CREATE INDEX ix_attendance_open ON attendance_record (branch_id) WHERE status = 'CLOCKED_IN';

CREATE TABLE attendance_break (
  id            text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  attendance_id text NOT NULL REFERENCES attendance_record(id) ON DELETE CASCADE,
  start_at      TEXT NOT NULL,
  end_at        TEXT,
  is_paid       INTEGER NOT NULL DEFAULT false,
  CHECK (end_at IS NULL OR end_at > start_at)
);
CREATE INDEX ix_attendance_break ON attendance_break (attendance_id);

-- payroll_run — owner HR (calculate/approve) → FIN (payroll journal, cash out).
CREATE TABLE payroll_run (
  id                  text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id              text NOT NULL REFERENCES organization(id),
  branch_id           text,                              -- NULL = all branches
  period_month        TEXT NOT NULL CHECK (strftime('%d', period_month) = '01'),
  status              text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','PAID','VOID')),
  total_gross         NUMERIC NOT NULL DEFAULT 0,
  total_income_tax    NUMERIC NOT NULL DEFAULT 0,
  total_pension_employee NUMERIC NOT NULL DEFAULT 0,
  total_pension_employer NUMERIC NOT NULL DEFAULT 0,
  total_net           NUMERIC NOT NULL DEFAULT 0,
  approved_by         text REFERENCES app_user(id),
  approved_at         TEXT,
  paid_on             date,
  paid_from_account_id text REFERENCES money_account(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
);
CREATE UNIQUE INDEX ux_payroll_run ON payroll_run (org_id, coalesce(branch_id, '-'), period_month) WHERE status <> 'VOID';

CREATE TABLE payslip (
  id                text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  payroll_run_id    text NOT NULL REFERENCES payroll_run(id) ON DELETE CASCADE,
  employee_id       text NOT NULL REFERENCES employee(user_id),
  branch_id         text REFERENCES branch(id),          -- branch the cost is charged to
  regular_hours     NUMERIC NOT NULL DEFAULT 0,
  overtime_hours    NUMERIC NOT NULL DEFAULT 0,
  base_pay          NUMERIC NOT NULL DEFAULT 0,
  overtime_pay      NUMERIC NOT NULL DEFAULT 0,
  allowances        NUMERIC NOT NULL DEFAULT 0,
  gross_taxable     NUMERIC NOT NULL DEFAULT 0,
  income_tax        NUMERIC NOT NULL DEFAULT 0,
  pension_employee  NUMERIC NOT NULL DEFAULT 0,   -- 7 %
  pension_employer  NUMERIC NOT NULL DEFAULT 0,   -- 11 %
  other_deductions  NUMERIC NOT NULL DEFAULT 0,
  net_pay           NUMERIC NOT NULL DEFAULT 0,
  prorated          INTEGER NOT NULL DEFAULT false,
  UNIQUE (payroll_run_id, employee_id)
);

-- performance_log — owner HR · MGR can raise entries (void incidents, lateness).
CREATE TABLE performance_log (
  id           text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  org_id       text NOT NULL REFERENCES organization(id),
  employee_id  text NOT NULL REFERENCES employee(user_id),
  branch_id    text REFERENCES branch(id),
  log_type     text NOT NULL CHECK (log_type IN ('REVIEW','COMMENDATION','VOID_INCIDENT','LATENESS','WARNING','INCIDENT')),
  rating       integer CHECK (rating BETWEEN 1 AND 5),
  severity     text NOT NULL DEFAULT 'LOW' CHECK (severity IN ('LOW','MEDIUM','HIGH')),
  note         text NOT NULL,
  source       text NOT NULL DEFAULT 'HR' CHECK (source IN ('HR','MANAGER_MODULE','SYSTEM')),
  ref_type     text,                                     -- 'order_line', 'attendance_record', 'waste_report'
  ref_id       text,
  logged_by    text NOT NULL REFERENCES app_user(id),
  logged_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at   TEXT,
  CHECK (log_type <> 'REVIEW' OR rating IS NOT NULL)
);
CREATE INDEX ix_performance_employee ON performance_log (employee_id, logged_at DESC) WHERE deleted_at IS NULL;


-- =====================================================================
-- 8. SYSTEM ADMIN
-- =====================================================================

-- receipt_config — owner ADMIN · read by POS printing.
CREATE TABLE receipt_config (
  org_id              text NOT NULL,
  branch_id           text NOT NULL,
  paper_width_mm      integer NOT NULL DEFAULT 80 CHECK (paper_width_mm IN (58, 80)),
  header_message      text NOT NULL DEFAULT '',
  footer_message      text NOT NULL DEFAULT '',
  show_tin            INTEGER NOT NULL DEFAULT true,
  show_vat_breakdown  INTEGER NOT NULL DEFAULT true,
  printer_device_id   text REFERENCES device(id),
  updated_by          text REFERENCES app_user(id),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (branch_id),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
);


-- =====================================================================
-- 9. AUDIT  (every module writes here; append-only)
-- =====================================================================
-- action is "<entity>.<verb>" so all three existing vocabularies fit:
--   Sales   APPROVE + WASTE        → waste.approve
--   Manager APPROVE_DISPATCH       → dispatch.approve,  FLAG_PURCHASE → purchase.flag
--   Admin   kind PRICE             → menu_item.price_change
--   KDS     bump                   → kds_ticket.bump
-- summary_template + vars mirrors the Admin entry ("{user} changed {item} to {price}")
-- so every UI can re-render it in en / am / om.
CREATE TABLE audit_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id           text NOT NULL,
  branch_id        text,
  occurred_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  module           text NOT NULL CHECK (module IN ('SALES','MGR','FIN','HR','ADMIN','KDS','POS','OWNER','SYSTEM','AUTH')),
  action           text NOT NULL,                        -- 'purchase.approve', 'auth.sign_in', 'export.run'
  entity_type      text NOT NULL,                        -- table name: 'purchase', 'kds_ticket', 'session'
  entity_id        text,
  actor_user_id    text,                                 -- no FK: the log outlives users
  actor_name       text,                                 -- snapshot
  actor_role       text,                                 -- snapshot
  device_id        text,
  summary_template text NOT NULL,                        -- English template with {placeholders}
  vars             TEXT NOT NULL DEFAULT '{}',
  before_data      TEXT,                                -- changed fields only
  after_data       TEXT,
  request_id       text,
  ip_address       text
);
CREATE INDEX ix_audit_org_time    ON audit_log (org_id, occurred_at DESC);
CREATE INDEX ix_audit_branch_time ON audit_log (branch_id, occurred_at DESC);
CREATE INDEX ix_audit_entity      ON audit_log (entity_type, entity_id);
CREATE INDEX ix_audit_actor       ON audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX ix_audit_module      ON audit_log (org_id, module, occurred_at DESC);

CREATE TRIGGER trg_audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER trg_audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;



-- =====================================================================
-- 10. POSTGRESQL-ONLY: triggers, realtime notify, row-level security
-- =====================================================================
