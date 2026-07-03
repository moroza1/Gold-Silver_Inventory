-- ============================================================================
-- KFH Precious Metals Inventory Management System (PMIMS)
-- Core Database Schema DDL for SQL Server
-- ============================================================================

CREATE DATABASE KFH_PMIMS;
GO
USE KFH_PMIMS;
GO

-- ============================================================================
-- 1. REFERENCE TABLES & LOOKUPS
-- ============================================================================

CREATE TABLE status_codes (
    status_code VARCHAR(30) PRIMARY KEY,
    description NVARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL -- e.g., 'INVENTORY', 'RESERVATION', 'WORKFLOW'
);

CREATE TABLE reason_codes (
    reason_code VARCHAR(30) PRIMARY KEY,
    description NVARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL -- e.g., 'QUARANTINE', 'ADJUSTMENT', 'REJECTION'
);

CREATE TABLE metal_types (
    metal_type_id INT IDENTITY(1,1) PRIMARY KEY,
    metal_name NVARCHAR(50) NOT NULL UNIQUE -- 'Gold', 'Silver'
);

CREATE TABLE metal_purity_levels (
    purity_id INT IDENTITY(1,1) PRIMARY KEY,
    purity_value DECIMAL(5,2) NOT NULL UNIQUE, -- e.g., 99.99, 99.50
    description NVARCHAR(100) NULL
);

CREATE TABLE metal_denominations (
    denomination_id INT IDENTITY(1,1) PRIMARY KEY,
    weight_grams DECIMAL(10,3) NOT NULL, -- Standard weight in grams
    weight_ounces DECIMAL(10,4) NOT NULL, -- Standard weight in ounces
    label NVARCHAR(50) NOT NULL UNIQUE, -- e.g., '1 Gram Bar', '1 Kilogram Bar', '1 Ounce Bar'
    metal_type_id INT FOREIGN KEY REFERENCES metal_types(metal_type_id)
);

CREATE TABLE metal_products (
    product_id INT IDENTITY(1,1) PRIMARY KEY,
    product_code VARCHAR(50) NOT NULL UNIQUE,
    metal_type_id INT FOREIGN KEY REFERENCES metal_types(metal_type_id),
    denomination_id INT FOREIGN KEY REFERENCES metal_denominations(denomination_id),
    purity_id INT FOREIGN KEY REFERENCES metal_purity_levels(purity_id),
    origin_country NVARCHAR(100) NOT NULL, -- 'Switzerland' (Swiss), 'Turkey' (Turkish)
    is_active BIT NOT NULL DEFAULT 1
);

-- ============================================================================
-- 2. PARTNERS, CUSTOMERS & LOCATIONS
-- ============================================================================

CREATE TABLE vendors (
    vendor_id INT IDENTITY(1,1) PRIMARY KEY,
    vendor_code VARCHAR(50) NOT NULL UNIQUE,
    vendor_name NVARCHAR(255) NOT NULL,
    country_of_origin NVARCHAR(100) NOT NULL,
    is_sharia_compliant BIT NOT NULL DEFAULT 1,
    contact_email VARCHAR(255) NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE()
);

CREATE TABLE vaults (
    vault_id INT IDENTITY(1,1) PRIMARY KEY,
    vault_name NVARCHAR(100) NOT NULL,
    location_description NVARCHAR(255) NOT NULL,
    max_weight_capacity_kg DECIMAL(12,2) NOT NULL,
    is_active BIT NOT NULL DEFAULT 1
);

CREATE TABLE branches (
    branch_id INT IDENTITY(1,1) PRIMARY KEY,
    branch_code VARCHAR(20) NOT NULL UNIQUE,
    branch_name NVARCHAR(255) NOT NULL,
    vault_id INT FOREIGN KEY REFERENCES vaults(vault_id),
    is_active BIT NOT NULL DEFAULT 1
);

CREATE TABLE channels (
    channel_id INT IDENTITY(1,1) PRIMARY KEY,
    channel_name VARCHAR(50) NOT NULL UNIQUE, -- 'Branch', 'Mobile', 'Online', 'XTM', 'API'
    is_active BIT NOT NULL DEFAULT 1
);

CREATE TABLE inventory_locations (
    location_id INT IDENTITY(1,1) PRIMARY KEY,
    vault_id INT FOREIGN KEY REFERENCES vaults(vault_id),
    branch_id INT NULL FOREIGN KEY REFERENCES branches(branch_id),
    zone_room NVARCHAR(50) NOT NULL,  -- e.g., 'Zone A', 'Room 2'
    shelf_row NVARCHAR(50) NOT NULL,  -- e.g., 'Shelf 3', 'Row B'
    slot_bin NVARCHAR(50) NOT NULL,   -- e.g., 'Slot 12', 'Bin C'
    description AS (zone_room + ' - ' + shelf_row + ' - ' + slot_bin) PERSISTED
);

CREATE TABLE customers (
    customer_id INT IDENTITY(1,1) PRIMARY KEY,
    civil_id VARCHAR(12) NOT NULL UNIQUE, -- Kuwait Civil ID
    customer_name NVARCHAR(255) NOT NULL,
    mobile_number VARCHAR(20) NOT NULL,
    email VARCHAR(255) NULL,
    is_active BIT NOT NULL DEFAULT 1
);

CREATE TABLE customer_accounts (
    account_id INT IDENTITY(1,1) PRIMARY KEY,
    customer_id INT FOREIGN KEY REFERENCES customers(customer_id),
    account_number VARCHAR(30) NOT NULL UNIQUE,
    currency CHAR(3) NOT NULL DEFAULT 'KWD'
);

-- ============================================================================
-- 3. INVENTORY LEDGER
-- ============================================================================

CREATE TABLE purchase_orders (
    po_id INT IDENTITY(1,1) PRIMARY KEY,
    po_number VARCHAR(50) NOT NULL UNIQUE,
    vendor_id INT FOREIGN KEY REFERENCES vendors(vendor_id),
    order_date DATETIME2 NOT NULL,
    expected_delivery_date DATETIME2 NULL,
    total_weight_grams DECIMAL(12,3) NOT NULL,
    total_cost DECIMAL(18,3) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    status_code VARCHAR(30) FOREIGN KEY REFERENCES status_codes(status_code),
    created_by VARCHAR(100) NOT NULL,
    approved_by VARCHAR(100) NULL,
    created_at DATETIME2 DEFAULT GETDATE()
);

CREATE TABLE po_items (
    po_item_id INT IDENTITY(1,1) PRIMARY KEY,
    po_id INT FOREIGN KEY REFERENCES purchase_orders(po_id),
    product_id INT FOREIGN KEY REFERENCES metal_products(product_id),
    ordered_quantity INT NOT NULL,
    received_quantity INT NOT NULL DEFAULT 0,
    unit_cost DECIMAL(18,3) NOT NULL
);

CREATE TABLE inventory_lots (
    lot_id INT IDENTITY(1,1) PRIMARY KEY,
    lot_number VARCHAR(100) NOT NULL UNIQUE,
    po_id INT NULL FOREIGN KEY REFERENCES purchase_orders(po_id),
    vendor_id INT FOREIGN KEY REFERENCES vendors(vendor_id),
    acquisition_date DATETIME2 NOT NULL,
    total_items INT NOT NULL,
    average_unit_cost DECIMAL(18,3) NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE()
);

CREATE TABLE inventory_items (
    item_id INT IDENTITY(1,1) PRIMARY KEY,
    serial_number VARCHAR(100) NOT NULL UNIQUE,
    product_id INT FOREIGN KEY REFERENCES metal_products(product_id),
    lot_id INT FOREIGN KEY REFERENCES inventory_lots(lot_id),
    location_id INT FOREIGN KEY REFERENCES inventory_locations(location_id),
    ownership_type VARCHAR(30) NOT NULL, -- 'KFH_OWNED', 'CUSTOMER_OWNED'
    status_code VARCHAR(30) FOREIGN KEY REFERENCES status_codes(status_code),
    row_version ROWVERSION NOT NULL
);

CREATE TABLE inventory_balances (
    balance_id INT IDENTITY(1,1) PRIMARY KEY,
    location_id INT FOREIGN KEY REFERENCES inventory_locations(location_id),
    product_id INT FOREIGN KEY REFERENCES metal_products(product_id),
    ownership_type VARCHAR(30) NOT NULL, -- 'KFH_OWNED', 'CUSTOMER_OWNED'
    ready_for_sale_qty INT NOT NULL DEFAULT 0,
    reserved_qty INT NOT NULL DEFAULT 0,
    sold_qty INT NOT NULL DEFAULT 0,
    quarantined_qty INT NOT NULL DEFAULT 0,
    in_transit_qty INT NOT NULL DEFAULT 0,
    last_updated DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT UQ_Balances UNIQUE (location_id, product_id, ownership_type)
);

-- ============================================================================
-- 4. CUSTOMER HOLDINGS & RESERVATIONS
-- ============================================================================

CREATE TABLE customer_holdings (
    holding_id INT IDENTITY(1,1) PRIMARY KEY,
    customer_id INT FOREIGN KEY REFERENCES customers(customer_id),
    account_id INT FOREIGN KEY REFERENCES customer_accounts(account_id),
    item_id INT FOREIGN KEY REFERENCES inventory_items(item_id) UNIQUE,
    allocation_date DATETIME2 NOT NULL DEFAULT GETDATE(),
    custody_agreement_number VARCHAR(100) NULL,
    custody_fee_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0000, -- Annual percentage rate
    status_code VARCHAR(30) FOREIGN KEY REFERENCES status_codes(status_code)
);

CREATE TABLE customer_allocations (
    allocation_id INT IDENTITY(1,1) PRIMARY KEY,
    holding_id INT FOREIGN KEY REFERENCES customer_holdings(holding_id),
    assigned_location_id INT FOREIGN KEY REFERENCES inventory_locations(location_id),
    assigned_at DATETIME2 DEFAULT GETDATE(),
    released_at DATETIME2 NULL
);

CREATE TABLE reservation_requests (
    reservation_id INT IDENTITY(1,1) PRIMARY KEY,
    reservation_token UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() UNIQUE,
    customer_id INT FOREIGN KEY REFERENCES customers(customer_id),
    item_id INT FOREIGN KEY REFERENCES inventory_items(item_id),
    channel_id INT FOREIGN KEY REFERENCES channels(channel_id),
    reserved_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    expires_at DATETIME2 NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    status_code VARCHAR(30) FOREIGN KEY REFERENCES status_codes(status_code)
);

-- ============================================================================
-- 5. TRANSACTIONS & TRANSFERS
-- ============================================================================

CREATE TABLE inventory_transactions (
    transaction_id INT IDENTITY(1,1) PRIMARY KEY,
    transaction_number VARCHAR(100) NOT NULL UNIQUE,
    item_id INT FOREIGN KEY REFERENCES inventory_items(item_id),
    transaction_type VARCHAR(50) NOT NULL, -- 'PO_RECEIVE', 'TRANSFER', 'SALE', 'REDEMPTION'
    source_location_id INT NULL FOREIGN KEY REFERENCES inventory_locations(location_id),
    destination_location_id INT NULL FOREIGN KEY REFERENCES inventory_locations(location_id),
    source_ownership VARCHAR(30) NOT NULL,
    destination_ownership VARCHAR(30) NOT NULL,
    rate_used DECIMAL(18,4) NULL,
    fees_applied DECIMAL(18,3) NULL,
    initiated_by VARCHAR(100) NOT NULL,
    approved_by VARCHAR(100) NULL,
    transaction_timestamp DATETIME2 NOT NULL DEFAULT GETDATE()
);

CREATE TABLE movement_transactions (
    movement_id INT IDENTITY(1,1) PRIMARY KEY,
    transaction_id INT FOREIGN KEY REFERENCES inventory_transactions(transaction_id),
    courier_details NVARCHAR(255) NULL,
    security_escort_name NVARCHAR(255) NULL,
    shipment_ref_number VARCHAR(100) NULL,
    departure_time DATETIME2 NULL,
    arrival_time DATETIME2 NULL
);

CREATE TABLE sales_orders (
    order_id INT IDENTITY(1,1) PRIMARY KEY,
    order_number VARCHAR(100) NOT NULL UNIQUE,
    customer_id INT FOREIGN KEY REFERENCES customers(customer_id),
    account_id INT FOREIGN KEY REFERENCES customer_accounts(account_id),
    item_id INT FOREIGN KEY REFERENCES inventory_items(item_id),
    channel_id INT FOREIGN KEY REFERENCES channels(channel_id),
    sale_price DECIMAL(18,3) NOT NULL,
    markup_amount DECIMAL(18,3) NOT NULL,
    invoice_number VARCHAR(100) NULL UNIQUE,
    sold_at DATETIME2 NOT NULL DEFAULT GETDATE()
);

CREATE TABLE redemption_requests (
    redemption_id INT IDENTITY(1,1) PRIMARY KEY,
    redemption_number VARCHAR(100) NOT NULL UNIQUE,
    holding_id INT FOREIGN KEY REFERENCES customer_holdings(holding_id),
    requested_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    status_code VARCHAR(30) FOREIGN KEY REFERENCES status_codes(status_code),
    approved_by VARCHAR(100) NULL
);

CREATE TABLE withdrawal_requests (
    withdrawal_id INT IDENTITY(1,1) PRIMARY KEY,
    redemption_id INT NULL FOREIGN KEY REFERENCES redemption_requests(redemption_id),
    holding_id INT FOREIGN KEY REFERENCES customer_holdings(holding_id),
    destination_branch_id INT FOREIGN KEY REFERENCES branches(branch_id),
    verification_otp VARCHAR(10) NOT NULL,
    withdrawn_at DATETIME2 NULL,
    recipient_signature NVARCHAR(255) NULL,
    status_code VARCHAR(30) FOREIGN KEY REFERENCES status_codes(status_code)
);

-- ============================================================================
-- 6. AUDITING, RECONCILIATION & STOCKTAKE (الجرد)
-- ============================================================================

CREATE TABLE stocktake_sessions (
    session_id INT IDENTITY(1,1) PRIMARY KEY,
    session_code VARCHAR(50) NOT NULL UNIQUE,
    vault_id INT FOREIGN KEY REFERENCES vaults(vault_id),
    started_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    completed_at DATETIME2 NULL,
    initiated_by VARCHAR(100) NOT NULL,
    approved_by VARCHAR(100) NULL,
    status_code VARCHAR(30) FOREIGN KEY REFERENCES status_codes(status_code)
);

CREATE TABLE stocktake_freezes (
    freeze_id INT IDENTITY(1,1) PRIMARY KEY,
    session_id INT FOREIGN KEY REFERENCES stocktake_sessions(session_id),
    location_id INT FOREIGN KEY REFERENCES inventory_locations(location_id),
    frozen_at DATETIME2 DEFAULT GETDATE(),
    released_at DATETIME2 NULL
);

CREATE TABLE stocktake_scans (
    scan_id INT IDENTITY(1,1) PRIMARY KEY,
    session_id INT FOREIGN KEY REFERENCES stocktake_sessions(session_id),
    scanned_serial VARCHAR(100) NOT NULL,
    location_id INT FOREIGN KEY REFERENCES inventory_locations(location_id),
    scanned_by VARCHAR(100) NOT NULL,
    scanned_at DATETIME2 DEFAULT GETDATE()
);

CREATE TABLE reconciliation_runs (
    run_id INT IDENTITY(1,1) PRIMARY KEY,
    run_timestamp DATETIME2 DEFAULT GETDATE(),
    executed_by VARCHAR(100) NOT NULL,
    total_items_checked INT NOT NULL,
    total_discrepancies INT NOT NULL,
    status_code VARCHAR(30) FOREIGN KEY REFERENCES status_codes(status_code)
);

CREATE TABLE reconciliation_items (
    recon_item_id INT IDENTITY(1,1) PRIMARY KEY,
    run_id INT FOREIGN KEY REFERENCES reconciliation_runs(run_id),
    item_id INT NULL FOREIGN KEY REFERENCES inventory_items(item_id),
    pmims_balance INT NOT NULL,
    core_balance INT NOT NULL,
    mismatch_detected BIT NOT NULL
);

CREATE TABLE mismatch_cases (
    case_id INT IDENTITY(1,1) PRIMARY KEY,
    recon_item_id INT FOREIGN KEY REFERENCES reconciliation_items(recon_item_id),
    investigator_comments NVARCHAR(MAX) NULL,
    reason_code VARCHAR(30) FOREIGN KEY REFERENCES reason_codes(reason_code),
    resolved_by VARCHAR(100) NULL,
    resolved_at DATETIME2 NULL,
    status_code VARCHAR(30) FOREIGN KEY REFERENCES status_codes(status_code)
);

-- ============================================================================
-- 7. RATES, VALUATION & ACCOUNTING
-- ============================================================================

CREATE TABLE exchange_rates (
    rate_id INT IDENTITY(1,1) PRIMARY KEY,
    metal_type_id INT FOREIGN KEY REFERENCES metal_types(metal_type_id),
    rate_source VARCHAR(50) NOT NULL, -- '360T', 'IMAL_FALLBACK'
    bid_rate DECIMAL(18,6) NOT NULL,
    ask_rate DECIMAL(18,6) NOT NULL,
    captured_at DATETIME2 NOT NULL DEFAULT GETDATE()
);

CREATE TABLE rate_source_audit (
    audit_id INT IDENTITY(1,1) PRIMARY KEY,
    transaction_id INT FOREIGN KEY REFERENCES inventory_transactions(transaction_id),
    rate_id INT FOREIGN KEY REFERENCES exchange_rates(rate_id),
    applied_markup DECIMAL(10,5) NOT NULL,
    final_unit_price DECIMAL(18,3) NOT NULL,
    time_of_calculation DATETIME2 DEFAULT GETDATE()
);

CREATE TABLE valuation_snapshots (
    snapshot_id INT IDENTITY(1,1) PRIMARY KEY,
    snapshot_timestamp DATETIME2 DEFAULT GETDATE(),
    total_gold_weight_grams DECIMAL(18,3) NOT NULL,
    total_silver_weight_grams DECIMAL(18,3) NOT NULL,
    gold_valuation_kwd DECIMAL(18,3) NOT NULL,
    silver_valuation_kwd DECIMAL(18,3) NOT NULL,
    calculated_by VARCHAR(100) NOT NULL
);

-- ============================================================================
-- 8. WORKFLOWS, ALERTS & SYSTEM SECURITY
-- ============================================================================

CREATE TABLE workflow_instances (
    instance_id INT IDENTITY(1,1) PRIMARY KEY,
    workflow_type VARCHAR(50) NOT NULL, -- 'PO_APPROVAL', 'STOCK_ADJUSTMENT'
    entity_id INT NOT NULL, -- Generic ID matching purchase_orders or mismatch_cases
    status_code VARCHAR(30) FOREIGN KEY REFERENCES status_codes(status_code),
    initiated_by VARCHAR(100) NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE()
);

CREATE TABLE approval_actions (
    action_id INT IDENTITY(1,1) PRIMARY KEY,
    instance_id INT FOREIGN KEY REFERENCES workflow_instances(instance_id),
    approver_username VARCHAR(100) NOT NULL,
    action_taken VARCHAR(50) NOT NULL, -- 'APPROVED', 'REJECTED', 'CORRECTION'
    comments NVARCHAR(1000) NULL,
    action_timestamp DATETIME2 DEFAULT GETDATE()
);

CREATE TABLE alert_rules (
    rule_id INT IDENTITY(1,1) PRIMARY KEY,
    rule_name NVARCHAR(100) NOT NULL,
    metric_name VARCHAR(50) NOT NULL, -- 'LOW_STOCK', 'STALE_RATE', 'MISMATCH'
    threshold_value DECIMAL(12,2) NOT NULL,
    is_active BIT NOT NULL DEFAULT 1,
    recipient_group VARCHAR(100) NOT NULL
);

CREATE TABLE notifications (
    notification_id INT IDENTITY(1,1) PRIMARY KEY,
    rule_id INT NULL FOREIGN KEY REFERENCES alert_rules(rule_id),
    title NVARCHAR(255) NOT NULL,
    message_body NVARCHAR(MAX) NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    sent_at DATETIME2 NULL,
    status_code VARCHAR(30) FOREIGN KEY REFERENCES status_codes(status_code)
);

CREATE TABLE document_uploads (
    document_id INT IDENTITY(1,1) PRIMARY KEY,
    file_name NVARCHAR(255) NOT NULL,
    file_path NVARCHAR(500) NOT NULL,
    sha256_hash VARCHAR(64) NOT NULL,
    uploaded_by VARCHAR(100) NOT NULL,
    uploaded_at DATETIME2 DEFAULT GETDATE()
);

CREATE TABLE extracted_document_fields (
    field_id INT IDENTITY(1,1) PRIMARY KEY,
    document_id INT FOREIGN KEY REFERENCES document_uploads(document_id),
    field_name VARCHAR(100) NOT NULL, -- e.g., 'PO_NUMBER', 'TOTAL_COST'
    extracted_value NVARCHAR(500) NOT NULL,
    confidence_score DECIMAL(5,2) NOT NULL
);

CREATE TABLE api_clients (
    client_id INT IDENTITY(1,1) PRIMARY KEY,
    client_name VARCHAR(100) NOT NULL UNIQUE,
    api_key_hash VARCHAR(256) NOT NULL,
    whitelisted_ips VARCHAR(500) NOT NULL,
    is_active BIT NOT NULL DEFAULT 1
);

CREATE TABLE api_transactions (
    api_tx_id INT IDENTITY(1,1) PRIMARY KEY,
    client_id INT FOREIGN KEY REFERENCES api_clients(client_id),
    endpoint VARCHAR(255) NOT NULL,
    request_payload NVARCHAR(MAX) NULL,
    response_code INT NOT NULL,
    execution_time_ms INT NOT NULL,
    tx_timestamp DATETIME2 DEFAULT GETDATE()
);

CREATE TABLE user_roles (
    role_id INT IDENTITY(1,1) PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    description NVARCHAR(255) NULL
);

CREATE TABLE user_permissions (
    permission_id INT IDENTITY(1,1) PRIMARY KEY,
    role_id INT FOREIGN KEY REFERENCES user_roles(role_id),
    permission_name VARCHAR(100) NOT NULL,
    is_granted BIT NOT NULL DEFAULT 1
);

CREATE TABLE role_scope_rules (
    scope_id INT IDENTITY(1,1) PRIMARY KEY,
    role_id INT FOREIGN KEY REFERENCES user_roles(role_id),
    scope_type VARCHAR(50) NOT NULL, -- 'BRANCH_LEVEL', 'GLOBAL_LEVEL'
    restricted_branch_id INT NULL FOREIGN KEY REFERENCES branches(branch_id)
);

CREATE TABLE release_uat_cycles (
    cycle_id INT IDENTITY(1,1) PRIMARY KEY,
    cycle_code VARCHAR(50) NOT NULL UNIQUE,
    stage_description NVARCHAR(255) NOT NULL,
    approved_by_qa VARCHAR(100) NULL,
    qa_signoff_at DATETIME2 NULL
);

CREATE TABLE release_signoffs (
    signoff_id INT IDENTITY(1,1) PRIMARY KEY,
    cycle_id INT FOREIGN KEY REFERENCES release_uat_cycles(cycle_id),
    signoff_type VARCHAR(50) NOT NULL, -- 'SHARIA_APPROVAL', 'BUSINESS_SIGNOFF'
    approver_username VARCHAR(100) NOT NULL,
    document_hash VARCHAR(64) NOT NULL, -- SHA256 file verification hash
    signed_at DATETIME2 DEFAULT GETDATE()
);

CREATE TABLE audit_logs (
    log_id INT IDENTITY(1,1) PRIMARY KEY,
    timestamp DATETIME2 NOT NULL DEFAULT GETDATE(),
    username VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    module_name VARCHAR(100) NOT NULL,
    action_description NVARCHAR(MAX) NOT NULL,
    sql_executed VARCHAR(MAX) NULL
);

-- ----------------------------------------------------------------------------
-- 8a. User & Group Privilege Management (AppUser / PrivilegeGroup)
-- Backs the group-based RBAC model documented in docs/PERMISSIONS.md. Was
-- previously only present in the EF Core model (AppDbContext.cs) -- added
-- here so the reference DDL matches the application schema, and so the FIM
-- Integration Module tables below (which target app_users/privilege_groups
-- directly) have valid FK targets in this script.
-- ----------------------------------------------------------------------------

CREATE TABLE app_users (
    user_id INT IDENTITY(1,1) PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    display_name NVARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(512) NOT NULL,
    password_algorithm VARCHAR(20) NOT NULL DEFAULT 'SHA256', -- SHA256 (legacy demo) | BCRYPT | AES256
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    created_by VARCHAR(100) NOT NULL DEFAULT 'SYSTEM'
);

CREATE TABLE privilege_groups (
    group_id INT IDENTITY(1,1) PRIMARY KEY,
    group_name NVARCHAR(150) NOT NULL UNIQUE,
    description NVARCHAR(500) NOT NULL DEFAULT '',
    is_system BIT NOT NULL DEFAULT 0,
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE()
);

CREATE TABLE group_permissions (
    permission_id INT IDENTITY(1,1) PRIMARY KEY,
    group_id INT NOT NULL FOREIGN KEY REFERENCES privilege_groups(group_id) ON DELETE CASCADE,
    module_key VARCHAR(50) NOT NULL,
    access_level VARCHAR(20) NOT NULL DEFAULT 'HIDDEN', -- HIDDEN | READ_ONLY | READ_WRITE | FULL
    CONSTRAINT UQ_group_permissions_group_module UNIQUE (group_id, module_key)
);

CREATE TABLE user_group_memberships (
    membership_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL FOREIGN KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
    group_id INT NOT NULL FOREIGN KEY REFERENCES privilege_groups(group_id) ON DELETE CASCADE,
    assigned_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    assigned_by VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT UQ_user_group_memberships_user_group UNIQUE (user_id, group_id)
);

-- ----------------------------------------------------------------------------
-- 8b. FIM (Forefront Identity Manager) Integration Module
-- Maps FIM's User / Profile / Right concepts onto app_users / privilege_groups
-- (Profile == PrivilegeGroup) plus a dedicated fine-grained Right layer, a
-- generic attribute bag for arbitrary FIM-pushed user attributes, and a
-- delta-sync change ledger. See database/procedures.sql (sp_FIM_* procs) and
-- docs/FIM_INTEGRATION.md for the full function-to-procedure mapping.
-- ----------------------------------------------------------------------------

CREATE TABLE fim_user_attributes (
    attribute_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL FOREIGN KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
    attribute_name VARCHAR(100) NOT NULL,
    attribute_value NVARCHAR(1000) NOT NULL,
    updated_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_fim_user_attributes_user_name UNIQUE (user_id, attribute_name)
);

CREATE TABLE fim_rights (
    right_id INT IDENTITY(1,1) PRIMARY KEY,
    right_code VARCHAR(100) NOT NULL UNIQUE,
    right_name NVARCHAR(255) NOT NULL,
    description NVARCHAR(500) NULL,
    module_key VARCHAR(50) NULL,
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE()
);

CREATE TABLE fim_user_rights (
    user_right_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL FOREIGN KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
    right_id INT NOT NULL FOREIGN KEY REFERENCES fim_rights(right_id) ON DELETE CASCADE,
    granted_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    granted_by VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT UQ_fim_user_rights_user_right UNIQUE (user_id, right_id)
);

CREATE TABLE fim_sync_logs (
    sync_log_id INT IDENTITY(1,1) PRIMARY KEY,
    entity_type VARCHAR(30) NOT NULL,  -- USER, PROFILE, RIGHT, USER_PROFILE, USER_RIGHT, PASSWORD
    entity_key VARCHAR(100) NOT NULL,
    change_type VARCHAR(20) NOT NULL,  -- CREATE, UPDATE, DELETE
    changed_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    changed_by VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
    source VARCHAR(20) NOT NULL DEFAULT 'APPLICATION', -- APPLICATION | FIM
    details_json NVARCHAR(MAX) NULL
);

CREATE NONCLUSTERED INDEX IX_fim_sync_logs_changed_at ON fim_sync_logs(changed_at);
CREATE NONCLUSTERED INDEX IX_fim_user_rights_user ON fim_user_rights(user_id);
CREATE NONCLUSTERED INDEX IX_fim_user_rights_right ON fim_user_rights(right_id);
CREATE NONCLUSTERED INDEX IX_user_group_memberships_user ON user_group_memberships(user_id);
CREATE NONCLUSTERED INDEX IX_group_permissions_group ON group_permissions(group_id);

-- ----------------------------------------------------------------------------
-- 8c. Enhanced Audit Trail UI (RFP item 6) -- extends the existing audit_logs
-- table (section 8 above) rather than replacing it. All three columns are
-- nullable so every pre-existing row remains valid; rows with row_hash NULL
-- are reported "Unverified (pre-dates hashing)" by the search API, not a
-- false tamper flag. See database/procedures.sql sp_SearchAuditLogs.
-- ----------------------------------------------------------------------------
ALTER TABLE audit_logs ADD entity_type VARCHAR(50) NULL;
ALTER TABLE audit_logs ADD entity_id VARCHAR(50) NULL;
ALTER TABLE audit_logs ADD row_hash CHAR(64) NULL; -- SHA-256 hex digest, tamper-detection fingerprint

CREATE NONCLUSTERED INDEX IX_audit_logs_entity ON audit_logs(entity_type, entity_id);
-- Full-text search across action_description requires a full-text catalog; created separately
-- by a DBA (CREATE FULLTEXT CATALOG ... ; CREATE FULLTEXT INDEX ON audit_logs(action_description)
-- KEY INDEX <pk_index_name>) since catalog placement is environment-specific.

-- ----------------------------------------------------------------------------
-- 8d. Dynamic Business Validation Rules Engine (RFP item 5)
-- ----------------------------------------------------------------------------
CREATE TABLE business_rules (
    rule_id INT IDENTITY(1,1) PRIMARY KEY,
    rule_code VARCHAR(100) NOT NULL,
    rule_name NVARCHAR(255) NOT NULL,
    rule_type VARCHAR(50) NOT NULL, -- TRANSFER_LIMIT, RECEIPT_VALIDATION, CUSTOMER_ELIGIBILITY, RATE_THRESHOLD, INVENTORY_CHECK
    expression_json NVARCHAR(MAX) NOT NULL, -- structured predicate tree, never executable code
    severity VARCHAR(10) NOT NULL DEFAULT 'BLOCK', -- BLOCK | WARN
    version INT NOT NULL DEFAULT 1,
    is_active BIT NOT NULL DEFAULT 1,
    effective_from DATETIME2 NOT NULL DEFAULT GETDATE(),
    effective_to DATETIME2 NULL,
    created_by VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_business_rules_code_version UNIQUE (rule_code, version)
);

CREATE TABLE business_rule_evaluations (
    evaluation_id INT IDENTITY(1,1) PRIMARY KEY,
    rule_id INT NOT NULL FOREIGN KEY REFERENCES business_rules(rule_id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(50) NOT NULL,
    result VARCHAR(10) NOT NULL, -- PASS, FAIL, WARN
    evaluated_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    context_json NVARCHAR(MAX) NULL
);

CREATE NONCLUSTERED INDEX IX_business_rules_type_active ON business_rules(rule_type, is_active);
CREATE NONCLUSTERED INDEX IX_business_rule_evaluations_rule ON business_rule_evaluations(rule_id);

-- ----------------------------------------------------------------------------
-- 8e. Automatic Management Email Notifications (RFP item 7)
-- ----------------------------------------------------------------------------
CREATE TABLE notification_subscriptions (
    subscription_id INT IDENTITY(1,1) PRIMARY KEY,
    distribution_list_email VARCHAR(255) NOT NULL,
    report_type VARCHAR(50) NOT NULL, -- INVENTORY_BALANCE, LOW_STOCK, HIGH_VALUE_MOVEMENT
    schedule_cron VARCHAR(50) NOT NULL,
    format VARCHAR(10) NOT NULL DEFAULT 'PDF', -- PDF, XLSX, BOTH
    is_active BIT NOT NULL DEFAULT 1,
    last_run_at DATETIME2 NULL,
    unsubscribed_at DATETIME2 NULL,
    created_by VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
    created_at DATETIME2 NOT NULL DEFAULT GETDATE()
);

CREATE TABLE notification_deliveries (
    delivery_id INT IDENTITY(1,1) PRIMARY KEY,
    subscription_id INT NOT NULL FOREIGN KEY REFERENCES notification_subscriptions(subscription_id) ON DELETE CASCADE,
    sent_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    status_code VARCHAR(20) NOT NULL DEFAULT 'SENT', -- SENT, FAILED, BOUNCED
    message_id VARCHAR(255) NULL,
    failure_reason NVARCHAR(500) NULL
);

CREATE NONCLUSTERED INDEX IX_notification_deliveries_subscription ON notification_deliveries(subscription_id);

-- ----------------------------------------------------------------------------
-- 8f. KFH Existing Monitoring Tool Integration (RFP item 8)
-- ----------------------------------------------------------------------------
CREATE TABLE monitoring_events (
    event_id INT IDENTITY(1,1) PRIMARY KEY,
    event_type VARCHAR(30) NOT NULL, -- HEALTH_CHECK, SLA_METRIC, ALERT
    service_name VARCHAR(100) NOT NULL DEFAULT 'PMIMS',
    metric_name VARCHAR(100) NOT NULL,
    metric_value NVARCHAR(255) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'INFO', -- INFO, WARNING, CRITICAL
    occurred_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    pushed_at DATETIME2 NULL,
    push_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' -- PENDING, SENT, FAILED, DISABLED
);

CREATE TABLE monitoring_alert_routes (
    route_id INT IDENTITY(1,1) PRIMARY KEY,
    event_type VARCHAR(30) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    destination NVARCHAR(500) NOT NULL, -- webhook URL, on-call group name, etc.
    is_active BIT NOT NULL DEFAULT 1
);

CREATE NONCLUSTERED INDEX IX_monitoring_events_occurred_at ON monitoring_events(occurred_at);
CREATE NONCLUSTERED INDEX IX_monitoring_events_type_severity ON monitoring_events(event_type, severity);

-- ============================================================================
-- 9. AI COPILOT & DATA MIGRATION SPECIFIC TABLES
-- ============================================================================

CREATE TABLE ai_model_configs (
    config_id INT IDENTITY(1,1) PRIMARY KEY,
    provider_name VARCHAR(50) NOT NULL, -- 'GEMINI', 'OPENAI', 'CLAUDE'
    model_name VARCHAR(100) NOT NULL,
    api_endpoint VARCHAR(500) NOT NULL,
    encrypted_api_key VARCHAR(512) NOT NULL,
    temperature DECIMAL(3,2) NOT NULL DEFAULT 0.2,
    is_active BIT NOT NULL DEFAULT 0
);

CREATE TABLE ai_query_logs (
    query_log_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    user_role VARCHAR(50) NOT NULL,
    natural_language_prompt NVARCHAR(MAX) NOT NULL,
    generated_sql VARCHAR(MAX) NOT NULL,
    execution_success BIT NOT NULL,
    timestamp DATETIME2 NOT NULL DEFAULT GETDATE()
);

CREATE TABLE migration_staging_items (
    staging_id INT IDENTITY(1,1) PRIMARY KEY,
    serial_number VARCHAR(100) NOT NULL,
    product_code VARCHAR(50) NOT NULL,
    acquisition_cost DECIMAL(18,3) NOT NULL,
    vault_name NVARCHAR(100) NOT NULL,
    zone_room NVARCHAR(50) NOT NULL,
    shelf_row NVARCHAR(50) NOT NULL,
    slot_bin NVARCHAR(50) NOT NULL,
    ownership_type VARCHAR(30) NOT NULL,
    customer_civil_id VARCHAR(12) NULL,
    validation_errors NVARCHAR(1000) NULL,
    is_valid BIT NOT NULL DEFAULT 1
);

CREATE TABLE migration_logs (
    migration_id INT IDENTITY(1,1) PRIMARY KEY,
    uploaded_by VARCHAR(100) NOT NULL,
    file_name NVARCHAR(255) NOT NULL,
    total_records INT NOT NULL,
    valid_records INT NOT NULL,
    failed_records INT NOT NULL,
    status_code VARCHAR(30) FOREIGN KEY REFERENCES status_codes(status_code),
    approved_by VARCHAR(100) NULL,
    completed_at DATETIME2 NULL
);

-- ============================================================================
-- INDEXES FOR CORE SYSTEM PERFORMANCE
-- ============================================================================

CREATE NONCLUSTERED INDEX IX_inventory_items_status ON inventory_items(status_code);
CREATE NONCLUSTERED INDEX IX_inventory_items_location ON inventory_items(location_id);
CREATE NONCLUSTERED INDEX IX_inventory_balances_lookup ON inventory_balances(location_id, product_id, ownership_type);
CREATE NONCLUSTERED INDEX IX_reservation_requests_expiry ON reservation_requests(expires_at) WHERE status_code = 'ACTIVE';
CREATE NONCLUSTERED INDEX IX_customer_holdings_customer ON customer_holdings(customer_id);
CREATE NONCLUSTERED INDEX IX_audit_logs_timestamp ON audit_logs(timestamp);
CREATE NONCLUSTERED INDEX IX_stocktake_scans_session ON stocktake_scans(session_id);
GO
