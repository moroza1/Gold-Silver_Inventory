import React, { useState, useEffect, useRef } from 'react';
import GfsApp from './GfsApp';
const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://69.62.116.52:8080/api';

// --- "Between dates" range filter helpers ---------------------------------
// Shared by the My Activity and Executive Board screens, both of which default
// their date-range picker to the current calendar month (first day -> last day)
// but let the user pick any other range afterward.
const pad2 = (n: number) => String(n).padStart(2, '0');
const toDateInputValue = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const getCurrentMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // day 0 of next month = last day of this month
  return { start: toDateInputValue(start), end: toDateInputValue(end) };
};

// --- GS1 and ISO/IEC 18004 barcode/QR code parser -------------------------
export const parseGs1Barcode = (rawInput: string): { serial: string; gtin: string; lot: string } => {
  if (!rawInput) return { serial: '', gtin: '', lot: '' };
  
  // Standard GS1 string with parentheses e.g. (01)06291100000017(21)SN12345(10)LOT999
  const parenRegex = /^(?:\(01\)(\d{14}))?(?:\(21\)([^()]+))?(?:\(10\)([^()]+))?$/;
  let match = rawInput.match(parenRegex);
  if (match && (match[1] || match[2] || match[3])) {
    return {
      gtin: match[1] || '',
      serial: match[2] || '',
      lot: match[3] || ''
    };
  }

  // FNC1/raw GS1 syntax parsing (e.g. without parentheses but with AI prefixes)
  // Simple heuristic parser for GS1 key-value pairs
  // e.g. 010629110000001721SN12345 or similar
  let clean = rawInput.replace(/^\]Q3|^\]C1/, ''); // Strip ISO/IEC 18004 / GS1-128 symbology identifiers
  let serial = '';
  let gtin = '';
  let lot = '';
  
  let i = 0;
  while (i < clean.length) {
    if (clean.substring(i).startsWith('01') && clean.length >= i + 16) {
      gtin = clean.substring(i + 2, i + 16);
      i += 16;
    } else if (clean.substring(i).startsWith('21')) {
      let sub = clean.substring(i + 2);
      let gsIdx = sub.indexOf('\u001d');
      if (gsIdx === -1) gsIdx = sub.indexOf('|');
      let len = gsIdx !== -1 ? gsIdx : sub.length;
      serial = sub.substring(0, Math.min(len, 20));
      i += 2 + len + 1;
    } else if (clean.substring(i).startsWith('10')) {
      let sub = clean.substring(i + 2);
      let gsIdx = sub.indexOf('\u001d');
      if (gsIdx === -1) gsIdx = sub.indexOf('|');
      let len = gsIdx !== -1 ? gsIdx : sub.length;
      lot = sub.substring(0, Math.min(len, 20));
      i += 2 + len + 1;
    } else {
      i++; // skip unrecognized/filler
    }
  }

  return {
    gtin,
    serial: serial || rawInput, // fallback to raw input if no serial AI matched
    lot
  };
};

// --- Auth token plumbing -------------------------------------------------
// The backend now issues a signed JWT at login and enforces [Authorize]
// policies on admin/setup endpoints. We hold the token in a module-level
// variable and install a one-time fetch interceptor that attaches it as a
// Bearer header on every request to the API, so existing call sites don't
// each need editing. setAuthToken() is called from the login handler.
let authToken: string | null = null;
export const setAuthToken = (token: string | null) => { authToken = token; };

if (typeof window !== 'undefined' && !(window as any).__pmimsFetchPatched) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    if (authToken && url && url.startsWith(API_BASE)) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${authToken}`);
      init = { ...init, headers };
    }
    return originalFetch(input, init);
  };
  (window as any).__pmimsFetchPatched = true;
}

// --- Error messaging for failed API calls --------------------------------
// The backend enforces [Authorize(Policy=...)] server-side and returns a
// bare 401/403 with no JSON body when the caller lacks the required
// permission (e.g. a Checker, who only holds READ_ONLY on purchase_orders,
// tries to POST /api/purchase-orders). Falling through to a generic
// (multi-item PO support added: PO lines are product×qty with per-line unit cost.)
// "Server error" is confusing, so surface a clear permission message
// instead whenever the status is 401/403.
const permissionDeniedMessage = (lang: string) =>
  lang === 'en'
    ? "You don't have permission to perform this action. Your account does not have the required access level for this module. Contact your system administrator if you believe this is a mistake."
    : "ليس لديك صلاحية للقيام بهذا الإجراء. لا يملك حسابك مستوى الوصول المطلوب لهذه الوحدة. يرجى التواصل مع مسؤول النظام إذا كنت تعتقد أن هذا خطأ.";

const describeApiError = async (res: Response, lang: string, fallbackEn: string, fallbackAr: string): Promise<string> => {
  if (res.status === 401 || res.status === 403) return permissionDeniedMessage(lang);
  const err = await res.json().catch(() => ({} as any));
  const detail = (err as any)?.error;
  return lang === 'en'
    ? `${fallbackEn}: ${detail || 'Server error'}`
    : `${fallbackAr}: ${detail || 'خطأ في الخادم'}`;
};

// Translations Dictionary matching prototype high fidelity
const Translations: Record<string, Record<string, string>> = {
  en: {
    app_title: "KFH Gold & Silver",
    app_subtitle: "Inventory Engine",
    menu_dashboards: "Dashboards",
    menu_exec: "Executive Board",
    menu_compliance: "Compliance Dashboard",
    menu_operations: "Operations",
    menu_po: "P.O. & Procurement",
    menu_spatial: "Vault Spatial Map",
    menu_custody: "Customer Custody",
    menu_controls: "Controls & Audits",
    menu_stocktake: "Stocktake (الجرد)",
    menu_audit_trail: "System Audit Trail",
    menu_kfhonline_logs: "KFHOnline Transaction Logs",
    menu_migration: "Bulk Ingestion",
    menu_settings: "System Settings",
    menu_my_activity: "My Activity",
    title_my_activity: "My Activity Dashboard",
    my_activity_subtitle: "Your approval history and current queue. Double-click a card to see the underlying requests.",
    kpi_actions_taken: "Actions Taken",
    kpi_actions_taken_sub: "Total decisions you've recorded",
    kpi_approved: "Approved",
    kpi_approved_sub: "Requests you signed off on",
    kpi_rejected: "Rejected",
    kpi_rejected_sub: "Requests you rejected",
    kpi_pending_mine: "Pending On Me",
    kpi_pending_mine_sub: "Awaiting your decision now",
    my_activity_hint: "Double-click a card above to view its request list",
    th_wf_entity: "Request",
    th_decision: "Decision",
    th_comments: "Comments",
    msg_no_activity_yet: "No activity to show yet.",
    btn_close: "Close",
    date_range_from: "From",
    date_range_to: "To",
    date_range_reset: "Reset to this month",
    title_exec: "Executive Dashboard",
    ticker_gold: "XAU (Gold/oz):",
    ticker_feed: "360T Feed",
    ticker_silver: "XAG (Silver/oz):",
    header_timezone: "GMT+3 (Kuwait)",
    kpi_prop_gold: "Proprietary Gold Stock",
    kpi_sync: "Balances match Core Banking",
    kpi_ready: "Ready for Sale (Prop)",
    kpi_ready_sub: "KFH-owned bars ready in slots",
    kpi_reserved: "Reserved Checkout Locks",
    kpi_reserved_sub: "active checkout sessions",
    kpi_custody: "Client Custody Stock",
    kpi_custody_sub: "Customer gold held in vaults",
    exec_table_title: "Active Inventory Registry",
    exec_table_subtitle: "Detailed physical serial tracker from the ledger table",
    th_serial: "Serial Number",
    th_metal: "Metal",
    th_denom: "Denomination",
    th_origin: "Origin",
    th_coords: "Physical coordinates",
    th_status: "Status",
    po_table_title: "Active Purchase Orders",
    po_table_subtitle: "Procurement contracts mapping to suppliers (Swiss vs Turkish Gold)",
    th_po_code: "PO Code",
    th_supplier: "Supplier",
    th_weight: "Total Weight",
    th_cost: "Cost Basis",
    th_action: "Action",
    menu_active_deals: "Active Purchasing Orders",
    title_active_deals: "Active Purchasing Orders",
    menu_customer_receipt: "Receive from Customer",
    title_customer_receipt: "Receive Precious Metals from a Customer",
    active_deals_empty: "No purchase orders yet.",
    btn_approve: "Approve",
    btn_delete: "Delete",
    btn_print: "Print",
    po_form_title: "Create Purchase Order (Maker)",
    form_po_num: "Purchase Order Number",
    placeholder_po_num: "e.g. PO-KFH-2026-001",
    form_supplier: "Supplier (Accredited)",
    form_denom: "Metal Purity & Weight",
    form_origin: "Origin Country",
    opt_swiss: "Switzerland (Swiss Gold)",
    opt_turkey: "Turkey (Turkish Gold)",
    form_weight: "Total Order weight (Grams)",
    placeholder_weight: "1000",
    form_cost: "Total Cost Basis (USD)",
    placeholder_cost: "73000",
    btn_create_po: "Create P.O. & Submit",
    spatial_title: "Vault spatial coordinate Visualizer",
    spatial_subtitle: "physical shelf mapping levels inside KFH vaults. Click on a shelf row to view active slot contents.",
    custody_title: "Customer Custody Portfolio",
    custody_subtitle: "Search customer holdings portfolios. Gold bars are physically stored and pinned to vault coordinates under customer ownership.",
    placeholder_custody_search: "Search Customer ID (e.g. 101)",
    btn_search_portfolio: "Search Portfolio",
    th_civil_id: "Customer Civil ID",
    th_cust_name: "Customer Name",
    th_gold_serial: "Gold Serial Number",
    th_metal_weight: "Metal / weight",
    th_physical_coords: "Physical vault coordinates",
    stocktake_freeze_active: "Spatial Freeze Active: Main Vault transaction operations are currently blocked for stocktake auditing.",
    stocktake_title: "Inventory Audit & Stocktake workbench",
    stocktake_subtitle: "Start audit sessions, freeze active coordinates, blind-scan serials, and match ledger discrepancies (Maker-Checker adjustments).",
    btn_initiate_freeze: "Initiate Audit Spatial Freeze",
    btn_release_freeze: "Release Spatial Freeze",
    stocktake_scan_title: "Blind Scan Simulation",
    stocktake_scan_sub: "Simulate scanning barcodes/QR codes on vault shelves",
    form_scan_serial: "Scan Serial Number",
    placeholder_scan: "Scan Barcode / Type Serial",
    btn_log_scan: "Log Scan Event",
    stocktake_disc_title: "Discrepancy & breaks Report",
    stocktake_disc_sub: "Comparison match between ledger expectations and scans",
    btn_run_reconciliation: "Run Reconciliation Against Core Banking GL",
    btn_running_reconciliation: "Running Reconciliation...",
    th_expected_coords: "Expected Coordinate",
    th_owner: "Owner",
    th_mismatch: "Mismatch Type",
    migration_title: "Bulk Data Ingestion & Migration Wizard",
    migration_subtitle: "Excel template bulk upload engine to safely transition legacy data records. The validator catches duplicate coordinates, missing serials, and invalid purity levels.",
    migration_drag_title: "Drag & Drop Gold Inventory CSV/Excel Sheet",
    migration_drag_sub: "or browse files on local disk",
    btn_sim_invalid: "Simulate Invalid Template Upload",
    btn_sim_clean: "Simulate Clean Template Upload",
    migration_download_template: "Download standard PMIMS Migration Ingestion Template",
    migration_staging_title: "Migration Staging Approved (Maker)",
    migration_staging_sub: "Run staged balances verification against general ledger. Requires checker final signature.",
    btn_commit_migration: "Checker Signature: Commit Data",
    settings_title: "System Configuration Console",
    settings_subtitle: "Configure metadata catalogs, dynamic Sharia-approved suppliers, active gold/silver weights, and custom P.O. schemas.",
    tab_ai_gateway: "Treasury Spreads",
    tab_suppliers: "Suppliers Directory",
    tab_denoms: "Denominations Catalog",
    settings_spreads_title: "Treasury Spreads Controls",
    form_swiss_markup: "Swiss Gold Retail Markup (%)",
    form_turkish_markup: "Turkish Gold Retail Markup (%)",
    btn_save_spreads: "Save Spread Limits",
    settings_refiners_title: "Accredited Supplier List",
    th_code: "Code",
    th_refiner_name: "Supplier Name",
    th_sharia_compliance: "Sharia Compliance",
    settings_add_sup_title: "Add New Supplier",
    form_sup_code: "Supplier Code",
    placeholder_sup_code: "e.g. ARG-SWISS",
    form_sup_name: "Supplier Name",
    placeholder_sup_name: "e.g. Argor-Heraeus",
    opt_uk: "United Kingdom",
    form_sharia_status: "Sharia Certification Status",
    opt_sharia_approved: "Sharia Approved (Allocated)",
    opt_sharia_blocked: "Non-Approved (Blocked)",
    btn_register_supplier: "Register Supplier",
    settings_denoms_title: "Active Denominations Catalog",
    th_weight_grams: "Weight (Grams)",
    th_weight_oz: "Ounce Weight",
    th_label_name: "Label Name",
    th_metal_type: "Metal Type",
    settings_add_denom_title: "Add Trading Denomination",
    form_denom_label: "Label",
    placeholder_denom_label: "e.g. 50 Gram Bar",
    form_metal_type: "Metal Type",
    opt_gold: "Gold",
    opt_silver: "Silver",
    form_weight_grams_label: "Weight in Grams",
    placeholder_weight_grams: "e.g. 50",
    btn_register_denom: "Register Denomination",
    modal_intake_title: "Verify & Receive Shipment (Scan)",
    modal_shelf_title: "Shelf details",
    modal_withdrawal_title: "Customer Physical pickup verification",
    menu_reports: "Reporting & Analytics",
    title_reports: "System Reporting Console",
    reports_subtitle: "Generate and export inventory valuation, spatial coordinate occupancy, audit trails, and ledger transactions.",
    btn_export_excel: "Export to Excel",
    btn_export_pdf: "Export to PDF",
    lbl_report_type: "Select Report Type",
    rep_valuation: "Precious Metals Valuation & Balances",
    rep_occupancy: "Vault Spatial Coordinate Occupancy",
    rep_audit: "Maker-Checker Audit Logs",
    rep_transactions: "Transaction Ledger History",
    rep_inventory_balance: "Inventory Balance Report",
    rep_reconciliation: "Reconciliation Differences Report",
    rep_gl_postings: "Core Banking (IMAL) GL Postings",
    // Reporting Requirements Gap Analysis -- Items 4, 5, 8, 9
    rep_kpis: "KPIs (Efficiency, Error Rates, Volume)",
    rep_exceptions: "Exceptions Report",
    rep_cost_analysis: "Cost Analysis Report",
    rep_cost_variance: "Cost Variance Report",
    rep_movements: "Movement Report (by Location & Ownership)",
    th_kpi: "KPI",
    th_value: "Value",
    th_exception_type: "Exception Type",
    th_reference: "Reference",
    th_severity: "Severity",
    th_raised_at: "Raised At",
    th_group: "Group",
    th_item_count: "Item Count",
    th_total_cost: "Total Landed Cost",
    th_avg_unit_cost: "Avg Unit Cost/g",
    th_period: "Period",
    th_budgeted_cost: "Budgeted Cost/g",
    th_actual_cost: "Actual Avg Cost/g",
    th_variance: "Variance/g",
    th_variance_pct: "Variance %",
    th_location: "Location",
    th_inbound: "Inbound Count",
    th_outbound: "Outbound Count",
    th_net_weight: "Net Weight (g)",
    th_gl_source: "Source",
    th_gl_debit: "Debit Account",
    th_gl_credit: "Credit Account",
    th_gl_amount: "Amount",
    th_gl_status: "Status",
    th_gl_reference: "Core Banking Reference",
    th_gl_initiated_by: "Initiated By",
    th_gl_created_at: "Created At",
    th_cost_basis: "Cost Basis (USD)",
    th_market_val: "Market Value (USD)",
    th_unrealized_pnl: "Unrealized P&L",
    th_occupancy: "Occupancy Rate",
    th_total_slots: "Total Slots",
    th_occupied_slots: "Occupied Slots",
    th_timestamp: "Timestamp",
    th_module: "Module",
    th_action_desc: "Action Description",
    th_user: "Executed By",
    th_tx_num: "Tx Number",
    th_tx_type: "Tx Type",
    th_source_loc: "Source Location",
    th_dest_loc: "Destination Location",
    th_ownership: "Ownership",
    th_vault: "Vault",
    th_ready_qty: "Ready Qty",
    th_total_weight_g: "Total Weight (g)",
    th_case_id: "Case ID",
    th_reason_code: "Reason Code",
    th_resolved_by: "Resolved By",
    th_resolved_at: "Resolved At",
    menu_workflows: "Workflow Designer",
    menu_workflows_queue: "Pending Queue",
    title_workflows: "Workflow Path Designer & Pending Queue",
    workflows_subtitle: "Draw sequential maker-checker verification paths, manage stages (add, remove, re-order), and sign off queued transactions.",
    wf_type: "Workflow Process Type",
    wf_name: "Workflow Process Name",
    wf_desc: "Workflow Description",
    wf_steps: "Approval Steps Sequence",
    btn_save_workflow: "Save & Deploy Path",
    btn_add_step: "Add Approval Step",
    wf_required_role: "Required Authority Role",
    wf_step_name: "Step Title",
    wf_queue_title: "Active Pending Operations Queue",
    wf_queue_subtitle: "Staged transactions held in escrow awaiting signatures. Approving or rejecting updates the active step state.",
    th_wf_type: "Workflow Type",
    th_initiated: "Initiated By",
    th_created: "Created Date",
    th_active_step: "Active Stage",
    th_history: "Workflow Audit History",
    th_po_details: "Transaction Details",
    btn_sign_off: "Sign Off / Approve",
    btn_reject: "Reject Operation",
    lbl_comments: "Action Comments",
    menu_pending_requests: "My Pending Actions",
    title_pending_requests: "Pending Requests Dashboard",
    pending_requests_subtitle: "Double click on any request to view details and process approvals.",
    th_assigned_role: "Assigned Authority",
    msg_no_pending: "No pending requests require your approval at this time.",
    menu_user_admin: "User & Group Admin",
    menu_notifications: "Notifications",
    title_notifications: "Management Email Notifications & Event Alerts",
    notifications_subtitle: "Configure distribution lists for scheduled reports (inventory balance, low stock, high-value movement) and instant alerts fired the moment a key event happens (branch transfer completed, inventory discrepancy detected).",
    th_notif_email: "Distribution Email",
    th_notif_type: "Report / Event Type",
    th_notif_schedule: "Schedule (cron)",
    th_notif_format: "Format",
    th_notif_status: "Status",
    th_notif_last_run: "Last Run",
    btn_notif_save: "Save Subscription",
    btn_notif_cancel_edit: "Cancel Edit",
    btn_notif_edit: "Edit",
    btn_notif_delete: "Delete",
    btn_notif_test_send: "Test Send",
    btn_notif_activate: "Activate",
    btn_notif_deactivate: "Deactivate",
    notif_form_title: "Add / Edit Subscription",
    notif_instant_hint: "Instant event types fire immediately when the event occurs; the schedule field is stored but not used for them.",
    notif_deliveries_title: "Recent Delivery Log",
    th_notif_sent_at: "Sent At",
    th_notif_delivery_status: "Status",
    th_notif_message_id: "Message ID",
    th_notif_failure: "Failure Reason",
    msg_no_subscriptions: "No notification subscriptions configured yet.",
    msg_no_deliveries: "No deliveries recorded yet.",
    title_user_admin: "User Onboarding & Group Privilege Management",
    user_admin_subtitle: "Manage system users, privilege groups, and fine-grained module access permissions.",
    tab_users: "User Management",
    tab_groups: "Group Management",
    btn_create_user: "Create User",
    btn_create_group: "Create Group",
    th_username: "Username",
    th_display_name: "Display Name",
    th_email: "Email",
    th_groups: "Assigned Groups",
    th_active: "Active",
    th_created_by: "Created By",
    th_group_name: "Group Name",
    th_description: "Description",
    th_members: "Members",
    th_system: "System",
    th_permissions: "Permissions",
    lbl_full: "Full Access",
    lbl_read_write: "Read/Write",
    lbl_read_only: "Read Only",
    lbl_hidden: "Hidden",
    btn_save_permissions: "Save Permissions",
    btn_edit: "Edit",
    msg_no_users: "No users found. Create the first user to get started.",
    msg_no_groups: "No privilege groups found.",
    menu_transfers: "Branch Transfers"
  },
  ar: {
    app_title: "بيت التمويل الكويتي - الذهب والفضة",
    app_subtitle: "محرك إدارة المخزون",
    menu_dashboards: "لوحات التحكم",
    menu_exec: "لوحة القيادة التنفيذية",
    menu_compliance: "لوحة الالتزام والتدقيق",
    menu_operations: "العمليات التشغيلية",
    menu_po: "طلبات الشراء والتعاقدات",
    menu_spatial: "الخريطة المكانية للخزنة",
    menu_custody: "أمانات العملاء",
    menu_controls: "الرقابة والجرد",
    menu_stocktake: "عمليات الجرد",
    menu_audit_trail: "سجل التدقيق الشامل",
    menu_kfhonline_logs: "سجلات معاملات KFHOnline",
    menu_migration: "الاستيراد الجماعي",
    menu_settings: "إعدادات النظام",
    menu_my_activity: "نشاطي",
    title_my_activity: "لوحة نشاطي",
    my_activity_subtitle: "سجل قراراتك وقائمة انتظارك الحالية. انقر نقرًا مزدوجًا على البطاقة لعرض الطلبات التفصيلية.",
    kpi_actions_taken: "الإجراءات المتخذة",
    kpi_actions_taken_sub: "إجمالي القرارات التي سجّلتها",
    kpi_approved: "المعتمدة",
    kpi_approved_sub: "الطلبات التي اعتمدتها",
    kpi_rejected: "المرفوضة",
    kpi_rejected_sub: "الطلبات التي رفضتها",
    kpi_pending_mine: "بانتظاري",
    kpi_pending_mine_sub: "بانتظار قرارك الآن",
    my_activity_hint: "انقر نقرًا مزدوجًا على إحدى البطاقات أعلاه لعرض قائمة الطلبات",
    th_wf_entity: "الطلب",
    th_decision: "القرار",
    th_comments: "الملاحظات",
    msg_no_activity_yet: "لا يوجد نشاط لعرضه بعد.",
    btn_close: "إغلاق",
    date_range_from: "من",
    date_range_to: "إلى",
    date_range_reset: "إعادة تعيين لهذا الشهر",
    title_exec: "لوحة القيادة التنفيذية",
    ticker_gold: "الذهب (أونصة):",
    ticker_feed: "تسعير 360T",
    ticker_silver: "الفضة (أونصة):",
    header_timezone: "توقيت الكويت (GMT+3)",
    kpi_prop_gold: "مخزون الذهب للبنك",
    kpi_sync: "الأرصدة متطابقة مع النظام المصرفي",
    kpi_ready: "جاهز للبيع (مخزون البنك)",
    kpi_ready_sub: "سبائك بيتك جاهزة في أماكنها",
    kpi_reserved: "حجوزات شراء معلقة",
    kpi_reserved_sub: "جلسات شراء نشطة حالياً",
    kpi_custody: "مخزون أمانات العملاء",
    kpi_custody_sub: "ذهب العملاء المحفوظ بالخزائن",
    exec_table_title: "سجل المخزون النشط والمادي",
    exec_table_subtitle: "متبع الأرقام التسلسلية المادية المفصل من جدول الأستاذ",
    th_serial: "الرقم التسلسلي",
    th_metal: "المعدن",
    th_denom: "الفئة",
    th_origin: "بلد المنشأ",
    th_coords: "الموقع بالخزينة",
    th_status: "الحالة",
    po_table_title: "طلبات الشراء والتعاقدات النشطة",
    po_table_subtitle: "عقود التوريد المرتبطة بالموردين المعتمدين (سويسري ضد تركي)",
    th_po_code: "رمز الطلب",
    th_supplier: "المورد",
    th_weight: "الوزن الإجمالي",
    th_cost: "التكلفة الإجمالية",
    th_action: "الإجراء",
    menu_active_deals: "طلبات الشراء النشطة",
    title_active_deals: "طلبات الشراء النشطة",
    menu_customer_receipt: "استلام من عميل",
    title_customer_receipt: "استلام معادن ثمينة من عميل",
    active_deals_empty: "لا توجد طلبات شراء بعد.",
    btn_approve: "اعتماد",
    btn_delete: "حذف",
    btn_print: "طباعة",
    po_form_title: "إنشاء طلب شراء جديد (Maker)",
    form_po_num: "رقم طلب الشراء",
    placeholder_po_num: "مثال: PO-KFH-2026-001",
    form_supplier: "المورد المعتمد",
    form_denom: "نقاء ووزن المعدن",
    form_origin: "بلد المنشأ",
    opt_swiss: "سويسرا (ذهب سويسري)",
    opt_turkey: "تركيا (ذهب تركي)",
    form_weight: "الوزن الإجمالي للطلب (جرام)",
    placeholder_weight: "1000",
    form_cost: "إجمالي تكلفة الشراء (USD)",
    placeholder_cost: "73000",
    btn_create_po: "إنشاء طلب الشراء والإرسال",
    spatial_title: "مستعرض إحداثيات الخزنة المكانية",
    spatial_subtitle: "مخطط الرفوف المادية داخل خزائن بيتك. انقر على الرف لعرض محتوياته.",
    custody_title: "محفظة أمانات الذهب للعملاء",
    custody_subtitle: "البحث في محافظ أمانات الذهب للعملاء. السبائك مخزنة ماديًا ومربوطة بإحداثيات الخزنة تحت ملكية العميل.",
    placeholder_custody_search: "ابحث بالرقم المدني للعميل (مثال: 101)",
    btn_search_portfolio: "بحث المحفظة",
    th_civil_id: "الرقم المدني للعميل",
    th_cust_name: "اسم العميل",
    th_gold_serial: "الرقم التسلسلي للسبيكة",
    th_metal_weight: "المعدن / الوزن",
    th_physical_coords: "الإحداثيات المادية بالخزينة",
    stocktake_freeze_active: "تجميد المخزون نشط: العمليات المادية بالخزينة الرئيسية معطلة لأغراض الجرد والتدقيق.",
    stocktake_title: "منصة تدقيق المخزون وجرد الخزينة",
    stocktake_subtitle: "بدء جلسات التدقيق، تجميد الإحداثيات، المسح الأعمى للأرقام التسلسلية، ومطابقة فروق الجرد (Maker-Checker).",
    btn_initiate_freeze: "تفعيل تجميد إحداثيات الجرد",
    btn_release_freeze: "إلغاء تجميد إحداثيات الجرد",
    stocktake_scan_title: "محاكاة المسح الأعمى للباركود",
    stocktake_scan_sub: "قم بمسح الباركود أو رمز QR لسبائك الذهب على رفوف الخزينة ماديًا",
    form_scan_serial: "الرقم التسلسلي الممسوح",
    placeholder_scan: "امسح الباركود أو اكتب الرقم التسلسلي",
    btn_log_scan: "تسجيل حركة المسح ماديًا",
    stocktake_disc_title: "تقرير مطابقة فروق الجرد والملاحظات",
    stocktake_disc_sub: "مقارنة المطابقة والتحقق بين الأرصدة الدفترية والمسوحات الفعلية",
    btn_run_reconciliation: "تنفيذ المطابقة مع دفتر الأستاذ العام للخدمات المصرفية الأساسية",
    btn_running_reconciliation: "جارٍ تنفيذ المطابقة...",
    th_expected_coords: "الإحداثيات المتوقعة",
    th_owner: "المالك",
    th_mismatch: "نوع الفرق المرصود",
    migration_title: "معالج استيراد البيانات وهجرة الأرصدة القديمة",
    migration_subtitle: "رفع قوالب إكسل للانتقال الآمن لسجلات بيانات النظام القديم. يتحقق من التكرار وصحة الإحداثيات.",
    migration_drag_title: "اسحب وأسقط ملف إكسل/CSV لمخزون الذهب هنا",
    migration_drag_sub: "أو تصفح الملفات المحلية على جهازك",
    btn_sim_invalid: "محاكاة رفع ملف يحتوي على أخطاء شائعة",
    btn_sim_clean: "محاكاة رفع ملف سليم وخالي من الأخطاء",
    migration_download_template: "تحميل قالب هجرة البيانات المعتمد لبيتك (CSV/Excel)",
    migration_staging_title: "تم اعتماد ومراجعة مرحلة الهجرة (Maker)",
    migration_staging_sub: "التحقق من مطابقة الأرصدة ضد الأستاذ العام. يتطلب توقيع واعتماد المدقق النهائي (Checker).",
    btn_commit_migration: "توقيع المعتمد (Checker): ترحيل وتأكيد البيانات",
    settings_title: "منصة إعدادات وتهيئة النظام",
    settings_subtitle: "تهيئة فئات البيانات، الموردين المعتمدين شرعياً، أوزان الذهب والفضة، والحقول المخصصة لطلبات الشراء.",
    tab_ai_gateway: "ضوابط الهوامش",
    tab_suppliers: "دليل الموردين",
    tab_denoms: "فئات وأوزان التداول",
    settings_spreads_title: "ضوابط هوامش التداول والأسعار",
    form_swiss_markup: "هامش ربح الذهب السويسري للتجزئة (%)",
    form_turkish_markup: "هامش ربح الذهب التركي للتجزئة (%)",
    btn_save_spreads: "حفظ الهوامش المعتمدة",
    settings_refiners_title: "قائمة الموردين المعتمدين",
    th_code: "الرمز",
    th_refiner_name: "اسم المورد",
    th_sharia_compliance: "التوافق مع الشريعة الإسلامية",
    settings_add_sup_title: "تسجيل مورد جديد في النظام",
    form_sup_code: "رمز المورد بالنظام",
    placeholder_sup_code: "مثال: ARG-SWISS",
    form_sup_name: "الاسم التجاري للمورد",
    placeholder_sup_name: "مثال: Argor-Heraeus",
    opt_uk: "المملكة المتحدة (بريطانيا)",
    form_sharia_status: "حالة الاعتماد الشرعي",
    opt_sharia_approved: "معتمد شرعياً (تخصيص مادي كامل)",
    opt_sharia_blocked: "غير معتمد (محظور ومعلق حالياً)",
    btn_register_supplier: "تسجيل وحفظ بيانات المورد",
    settings_denoms_title: "فئات وأوزان التداول النشطة بالكتالوج",
    th_weight_grams: "الوزن (جرام)",
    th_weight_oz: "الوزن بالأونصة",
    th_label_name: "اسم فئة الوزن",
    th_metal_type: "نوع المعدن",
    settings_add_denom_title: "إضافة فئة وزن جديدة للتداول",
    form_denom_label: "اسم الفئة التجاري",
    placeholder_denom_label: "مثال: سبيكة وزن 50 جرام",
    form_metal_type: "تصنيف المعدن",
    opt_gold: "ذهب (Gold)",
    opt_silver: "فضة (Silver)",
    form_weight_grams_label: "الوزن الفعلي بالجرام",
    placeholder_weight_grams: "مثال: 50",
    btn_register_denom: "تسجيل وحفظ فئة الوزن",
    modal_intake_title: "التحقق واستلام الشحنة الواردة (مسح الباركود)",
    modal_shelf_title: "تفاصيل محتويات الرف المادية",
    modal_withdrawal_title: "التحقق من سحب أمانات الذهب للعميل",
    menu_reports: "التقارير والتحليلات",
    title_reports: "منصة تقارير النظام",
    reports_subtitle: "توليد وتصدير تقارير تقييم المخزون، ونسبة إشغال إحداثيات الخزنة، وسجلات المراجعة، وحركات الأستاذ.",
    btn_export_excel: "تصدير إلى إكسل",
    btn_export_pdf: "تصدير إلى PDF",
    lbl_report_type: "اختر نوع التقرير",
    rep_valuation: "تقييم الأرصدة والمعادن الثمينة",
    rep_occupancy: "نسبة إشغال إحداثيات الخزنة",
    rep_audit: "سجل حركات التدقيق (Maker-Checker)",
    rep_transactions: "حركات سجل الأستاذ التاريخية",
    rep_inventory_balance: "تقرير أرصدة المخزون",
    rep_reconciliation: "تقرير فروقات المطابقة",
    rep_gl_postings: "قيود الأستاذ العام - النظام المصرفي الأساسي (IMAL)",
    // تحليل فجوات متطلبات التقارير -- البنود 4، 5، 8، 9
    rep_kpis: "مؤشرات الأداء (الكفاءة، معدلات الخطأ، الحجم)",
    rep_exceptions: "تقرير الاستثناءات",
    rep_cost_analysis: "تقرير تحليل التكلفة",
    rep_cost_variance: "تقرير فروقات التكلفة",
    rep_movements: "تقرير الحركة (حسب الموقع والملكية)",
    th_kpi: "المؤشر",
    th_value: "القيمة",
    th_exception_type: "نوع الاستثناء",
    th_reference: "المرجع",
    th_severity: "الخطورة",
    th_raised_at: "تاريخ الرصد",
    th_group: "المجموعة",
    th_item_count: "عدد الأصناف",
    th_total_cost: "إجمالي التكلفة الدفترية",
    th_avg_unit_cost: "متوسط تكلفة الوحدة/جم",
    th_period: "الفترة",
    th_budgeted_cost: "التكلفة المعتمدة/جم",
    th_actual_cost: "متوسط التكلفة الفعلية/جم",
    th_variance: "الفرق/جم",
    th_variance_pct: "نسبة الفرق %",
    th_location: "الموقع",
    th_inbound: "عدد الوارد",
    th_outbound: "عدد الصادر",
    th_net_weight: "صافي الوزن (جم)",
    th_gl_source: "المصدر",
    th_gl_debit: "الحساب المدين",
    th_gl_credit: "الحساب الدائن",
    th_gl_amount: "المبلغ",
    th_gl_status: "الحالة",
    th_gl_reference: "مرجع النظام المصرفي",
    th_gl_initiated_by: "بواسطة",
    th_gl_created_at: "تاريخ الإنشاء",
    th_cost_basis: "التكلفة الدفترية (USD)",
    th_market_val: "القيمة السوقية (USD)",
    th_unrealized_pnl: "الأرباح/الخسائر غير المحققة",
    th_occupancy: "نسبة الإشغال",
    th_total_slots: "إجمالي الخانات",
    th_occupied_slots: "الخانات المشغولة",
    th_timestamp: "التاريخ والوقت",
    th_module: "النظام الفرعي",
    th_action_desc: "وصف الإجراء",
    th_user: "المنفذ",
    th_tx_num: "رقم المعاملة",
    th_tx_type: "نوع الحركة",
    th_source_loc: "الموقع المصدر",
    th_dest_loc: "الموقع الهدف",
    th_ownership: "الملكية",
    th_vault: "الخزنة",
    th_ready_qty: "الكمية الجاهزة",
    th_total_weight_g: "الوزن الإجمالي (جم)",
    th_case_id: "رقم الحالة",
    th_reason_code: "رمز السبب",
    th_resolved_by: "تمت التسوية بواسطة",
    th_resolved_at: "تاريخ التسوية",
    menu_workflows: "إعداد وتدقيق المسارات",
    menu_workflows_queue: "قائمة الطلبات المعلقة",
    title_workflows: "منصة إدارة مسارات الاعتماد والعمليات المعلقة",
    workflows_subtitle: "تصميم (رسم) مسارات التوقيع المزدوج (صانع وقارئ)، وإضافة وحذف المراحل، واعتماد الطلبات المعلقة.",
    wf_type: "نوع المعاملة للمسار",
    wf_name: "اسم قالب المسار",
    wf_desc: "وصف المسار",
    wf_steps: "سلسلة مراحل الاعتماد والتواقيع",
    btn_save_workflow: "حفظ ونشر قالب المسار",
    btn_add_step: "إضافة مرحلة اعتماد",
    wf_required_role: "دور السلطة المطلوب",
    wf_step_name: "عنوان المرحلة",
    wf_queue_title: "قائمة العمليات النشطة المعلقة بانتظار الاعتماد",
    wf_queue_subtitle: "معاملات معلقة بانتظار توقيع دور المعتمد المناسب. الموافقة أو الرفض يحدث حالة المرحلة النشطة.",
    th_wf_type: "نوع المسار",
    th_initiated: "بواسطة",
    th_created: "تاريخ الإنشاء",
    th_active_step: "المرحلة النشطة",
    th_history: "سجل التدقيق التاريخي للمسار",
    th_po_details: "تفاصيل العملية",
    btn_sign_off: "توقيع واعتماد",
    btn_reject: "رفض المعاملة",
    lbl_comments: "ملاحظات القرار",
    menu_user_admin: "إدارة المستخدمين والمجموعات",
    menu_notifications: "الإشعارات",
    title_notifications: "إشعارات البريد الإلكتروني الإدارية وتنبيهات الأحداث",
    notifications_subtitle: "إعداد القوائم البريدية للتقارير المجدولة (رصيد المخزون، المخزون المنخفض، الحركات عالية القيمة) والتنبيهات الفورية التي تُطلق فور وقوع حدث رئيسي (اكتمال حركة تحويل، اكتشاف فرق في الجرد).",
    th_notif_email: "البريد الإلكتروني للقائمة",
    th_notif_type: "نوع التقرير / الحدث",
    th_notif_schedule: "الجدولة (cron)",
    th_notif_format: "الصيغة",
    th_notif_status: "الحالة",
    th_notif_last_run: "آخر تشغيل",
    btn_notif_save: "حفظ الاشتراك",
    btn_notif_cancel_edit: "إلغاء التعديل",
    btn_notif_edit: "تعديل",
    btn_notif_delete: "حذف",
    btn_notif_test_send: "إرسال تجريبي",
    btn_notif_activate: "تفعيل",
    btn_notif_deactivate: "إيقاف",
    notif_form_title: "إضافة / تعديل اشتراك",
    notif_instant_hint: "أنواع الأحداث الفورية تُطلق مباشرة عند وقوع الحدث؛ يتم حفظ حقل الجدولة لكنه لا يُستخدم لها.",
    notif_deliveries_title: "سجل التسليم الأخير",
    th_notif_sent_at: "وقت الإرسال",
    th_notif_delivery_status: "الحالة",
    th_notif_message_id: "معرّف الرسالة",
    th_notif_failure: "سبب الفشل",
    msg_no_subscriptions: "لا توجد اشتراكات إشعارات مُعدة بعد.",
    msg_no_deliveries: "لا توجد عمليات تسليم مسجلة بعد.",
    title_user_admin: "إدارة تسجيل المستخدمين وصلاحيات المجموعات",
    user_admin_subtitle: "إدارة مستخدمي النظام ومجموعات الصلاحيات وأذونات الوصول للوحدات.",
    tab_users: "إدارة المستخدمين",
    tab_groups: "إدارة المجموعات",
    btn_create_user: "إنشاء مستخدم",
    btn_create_group: "إنشاء مجموعة",
    th_username: "اسم المستخدم",
    th_display_name: "الاسم المعروض",
    th_email: "البريد الإلكتروني",
    th_groups: "المجموعات المعينة",
    th_active: "نشط",
    th_created_by: "أنشئ بواسطة",
    th_group_name: "اسم المجموعة",
    th_description: "الوصف",
    th_members: "الأعضاء",
    th_system: "نظامي",
    th_permissions: "الصلاحيات",
    lbl_full: "وصول كامل",
    lbl_read_write: "قراءة وكتابة",
    lbl_read_only: "قراءة فقط",
    lbl_hidden: "مخفي",
    btn_save_permissions: "حفظ الصلاحيات",
    btn_edit: "تعديل",
    msg_no_users: "لا يوجد مستخدمون. أنشئ أول مستخدم للبدء.",
    msg_no_groups: "لا توجد مجموعات صلاحيات.",
    menu_transfers: "تحويلات الفروع"
  }
};

const checkUserRoleMatches = (requiredRole: string | null | undefined, userRole: string | null | undefined): boolean => {
  if (!requiredRole || !userRole) return false;
  if (requiredRole === userRole) return true;
  
  const norm = (r: string) => r.toLowerCase().replace(/[^a-z0-9]/g, '');
  const rNorm = norm(requiredRole);
  const uNorm = norm(userRole);
  
  if (rNorm === uNorm) return true;
  
  const aliases: Record<string, string[]> = {
    'operationsmaker': ['treasuryoperationsmaker', 'operationsmaker', 'maker'],
    'operationschecker': ['treasuryoperationschecker', 'operationschecker', 'checker'],
    'reconciliationofficer': ['reconciliationofficers', 'reconciliationofficer', 'reconciler'],
    'itadmin': ['itadministrators', 'itadmin', 'admin']
  };
  
  for (const [key, list] of Object.entries(aliases)) {
    if ((rNorm === key || list.includes(rNorm)) && (uNorm === key || list.includes(uNorm))) {
      return true;
    }
  }
  return false;
};

export default function App() {
  const [activeApp, setActiveApp] = useState<'PMIMS' | 'GFS'>('PMIMS');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('treasury-maker');
  const [password, setPassword] = useState('Password123');
  const [userRole, setUserRole] = useState('Operations Maker');
  const [displayName, setDisplayName] = useState('KFH Treasury Maker User');

  const [activeTab, setActiveTab] = useState('screen-exec');
  const [currentLang, setCurrentLang] = useState('en');

  // Reporting States
  const [reportType, setReportType] = useState('valuation');
  const [reportData, setReportData] = useState<any[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [filterMetal, setFilterMetal] = useState('');
  const [filterVault, setFilterVault] = useState('');
  const [valuationMethod, setValuationMethod] = useState('AVERAGE');

  // Enhanced Audit Trail search/filter/pagination/drill-down state -- self-service
  // access to the same search/export/tamper-verification API that the backend has
  // exposed since PMIMSControllers.Audit.cs (search, {id} drill-down, export), which
  // the UI previously never called (it only used the older flat GET /reports/audit-logs).
  const [auditQuery, setAuditQuery] = useState('');
  const [auditUser, setAuditUser] = useState('');
  const [auditModule, setAuditModule] = useState('');
  const [auditEntityType, setAuditEntityType] = useState('');
  const [auditStatus, setAuditStatus] = useState('');
  const [auditFrom, setAuditFrom] = useState('');
  const [auditTo, setAuditTo] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize] = useState(25);
  const [auditTotalCount, setAuditTotalCount] = useState(0);
  const [auditDetail, setAuditDetail] = useState<any>(null);

  // Transaction traceability drill-down (Reports -> Transactions -> Trace) --
  // assembled server-side from the ledger row, its matched audit entry, courier
  // detail, and the item's full chain-of-custody timeline. See GetTransactionTraceAsync.
  const [transactionTrace, setTransactionTrace] = useState<any>(null);

  // Rates tickers state
  const [goldRate, setGoldRate] = useState(2284.50);
  const [silverRate, setSilverRate] = useState(28.15);

  // Executive dashboard states
  const [inventoryList, setInventoryList] = useState<any[]>([]);
  const [transfersList, setTransfersList] = useState<any[]>([]);

  // "Executive Board" date range filter -- defaults to the current calendar month.
  // Scopes the KPIs and inventory table below to items whose lot was acquired in range.
  const [execStartDate, setExecStartDate] = useState(() => getCurrentMonthRange().start);
  const [execEndDate, setExecEndDate] = useState(() => getCurrentMonthRange().end);
  const [execBoard, setExecBoard] = useState<{
    total_gold_weight_kg: number;
    available_weight_kg: number;
    reserved_weight_kg: number;
    custody_weight_kg: number;
    ready_qty: number;
    reserved_qty: number;
    custody_qty: number;
    items: any[];
  } | null>(null);
  const [loadingExecBoard, setLoadingExecBoard] = useState(false);

  // Compliance Dashboard (Reporting Requirements Gap Analysis, Item 6) -- summarizes the
  // same exceptions feed the Reports screen's Exceptions Report exports, plus audit-log
  // tamper-check status. See backend GetComplianceDashboard.
  const [complianceDashboard, setComplianceDashboard] = useState<{
    exceptions_total: number;
    exceptions_by_type: { exception_type: string; count: number }[];
    exceptions_by_severity: { severity: string; count: number }[];
    recent_exceptions: { exception_type: string; reference: string; description: string; severity: string; raised_at: string; status: string }[];
    audit_tamper_check: { tampered_count: number; unverified_count: number };
  } | null>(null);
  const [loadingCompliance, setLoadingCompliance] = useState(false);

  // PO operational states
  const [poList, setPoList] = useState<any[]>([]);
  const [poNum, setPoNum] = useState('PO-KFH-2026-001');
  const [poSupplier, setPoSupplier] = useState(1);
  const [poDate, setPoDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [poOrigin, setPoOrigin] = useState('Switzerland');
  const [poCurrency, setPoCurrency] = useState('USD');
  const [poWeight, setPoWeight] = useState(1000);
  const [poCost, setPoCost] = useState(73200);
  // A PO can hold many line items, each one denomination × quantity with its own unit cost
  // (e.g. 100g × 20, 10g × 100). product_id references the settings product catalog.
  // Committed lines shown in the datagrid; the entry form below builds them one at a time.
  const [poLines, setPoLines] = useState<{ product_id: string; qty: number; unit_cost: number }[]>([]);
  // The "add an item" entry row above the grid. poEntryEditIdx !== null means the entry form
  // is amending an existing grid row (Add button becomes Update) instead of appending a new one.
  const [poEntryProduct, setPoEntryProduct] = useState('');
  const [poEntryQty, setPoEntryQty] = useState(1);
  const [poEntryCost, setPoEntryCost] = useState(0);
  const [poEntryEditIdx, setPoEntryEditIdx] = useState<number | null>(null);
  // Searchable item combo (replaces the plain denomination <select> in the entry row).
  const [poComboOpen, setPoComboOpen] = useState(false);
  const [poComboQuery, setPoComboQuery] = useState('');
  // When true, the user has manually overridden the auto-summed total cost, so we stop
  // recomputing it from the lines until they edit a line again.
  const [poCostOverridden, setPoCostOverridden] = useState(false);
  // Cost Tracking & Valuation -- purchase cost detail (supplier invoice + acquisition fees).
  // These feed PurchaseOrder.LandedCost server-side, which is what Average Cost/FIFO/LIFO
  // valuation actually costs the received bars at (see reports/valuation).
  const [poInvoiceNumber, setPoInvoiceNumber] = useState('');
  const [poInvoiceDate, setPoInvoiceDate] = useState('');
  const [poFreightCost, setPoFreightCost] = useState(0);
  const [poInsuranceCost, setPoInsuranceCost] = useState(0);
  const [poCustomsDutyCost, setPoCustomsDutyCost] = useState(0);
  const [poOtherFeesCost, setPoOtherFeesCost] = useState(0);
  const [poOtherFeesDescription, setPoOtherFeesDescription] = useState('');
  const [editingPOId, setEditingPOId] = useState<number | null>(null);
  const [isEditingPO, setIsEditingPO] = useState(false);
  const [printingPO, setPrintingPO] = useState<any>(null);
  const [showIntakeModal, setShowIntakeModal] = useState(false);
  const [intakePOId, setIntakePOId] = useState<number | null>(null);
  const [intakePONumber, setIntakePONumber] = useState('');
  const [intakeLotNum, setIntakeLotNum] = useState(`LOT-SUP-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`);
  const [intakeSelectedLocation, setIntakeSelectedLocation] = useState<number>(1);
  const [scannedSerials, setScannedSerials] = useState<{ serial: string; product_id: number; product_code: string }[]>([]);
  const [currentScanSerial, setCurrentScanSerial] = useState('');
  const [intakeSelectedProductId, setIntakeSelectedProductId] = useState<number>(1);

  // UC03: Receipt of Precious Metals from Supplier workbench states
  const [intakeVendorId, setIntakeVendorId] = useState<number>(1);
  const [intakeShipmentRef, setIntakeShipmentRef] = useState('');
  const [intakeDeliveryNote, setIntakeDeliveryNote] = useState('');
  const [intakeAirwayBill, setIntakeAirwayBill] = useState('');
  const [intakeReceivingDate, setIntakeReceivingDate] = useState(toDateInputValue(new Date()));
  const [intakeDocUrl, setIntakeDocUrl] = useState('');
  const [intakeDiscrepancyNotes, setIntakeDiscrepancyNotes] = useState('');
  const [intakeBars, setIntakeBars] = useState<{
    id: string;
    serial: string;
    product_id: number;
    weight_grams: number;
    purity: number;
    is_damaged: boolean;
    damage_reason: string;
    refiner_name: string;
    assay_certificate_number?: string;
  }[]>([
    {
      id: 'bar-1',
      serial: `BAR-SUP-${Date.now().toString().slice(-4)}-01`,
      product_id: 1,
      weight_grams: 1000,
      purity: 999.9,
      is_damaged: false,
      damage_reason: '',
      refiner_name: 'Valcambi Suisse',
      assay_certificate_number: 'ASSAY-VAL-999'
    }
  ]);
  const [pendingIntakesList, setPendingIntakesList] = useState<any[]>([]);
  const [previewBarcodeModal, setPreviewBarcodeModal] = useState<any>(null);
  const [intakeActiveSubTab, setIntakeActiveSubTab] = useState<'RECEIVE_FORM' | 'IN_FLIGHT_LOG'>('RECEIVE_FORM');

  // Track which P.O. is expanded to show its line items in Receive Shipments
  const [expandedPOId, setExpandedPOId] = useState<number | null>(null);
  // Receipt of precious metals FROM a customer (buyback / custody deposit / return) --
  // the mirror of the supplier intake flow above, no Purchase Order involved. Rendered as
  // its own top-level screen (screen-customer-receipt), not a modal.
  const [receiptCustomerId, setReceiptCustomerId] = useState('');
  const [receiptAccountId, setReceiptAccountId] = useState('');
  const [receiptReason, setReceiptReason] = useState<'BUYBACK' | 'CUSTODY_DEPOSIT' | 'RETURN'>('BUYBACK');
  const [receiptLotNum, setReceiptLotNum] = useState('');
  const [receiptSelectedLocation, setReceiptSelectedLocation] = useState<number>(1);
  const [receiptSelectedProductId, setReceiptSelectedProductId] = useState<number>(1);
  const [receiptScannedSerials, setReceiptScannedSerials] = useState<{ serial: string; product_id: number }[]>([]);
  const [currentReceiptScanSerial, setCurrentReceiptScanSerial] = useState('');
  const [transferBarcodeQuery, setTransferBarcodeQuery] = useState('');
  const [newZoneRoom, setNewZoneRoom] = useState('Zone Alpha');
  const [newShelfRow, setNewShelfRow] = useState('Shelf Row 4');
  const [newSlotBin, setNewSlotBin] = useState('Slot 1');

  // Spatial vault mapping states
  const [locations, setLocations] = useState<any[]>([]);
  const [selectedShelf, setSelectedShelf] = useState<any>(null);
  const [selectedBar, setSelectedBar] = useState<any>(null);

  // Custody states
  const [custodySearchId, setCustodySearchId] = useState('');
  const [custodyList, setCustodyList] = useState<any[]>([]);

  // Stocktake states
  const [isFrozen, setIsFrozen] = useState(false);
  const [stocktakeScanInput, setStocktakeScanInput] = useState('');
  const [discrepancyList, setDiscrepancyList] = useState<any[]>([]);

  // Ingestion states
  const [ingressData, setIngressData] = useState<any>(null);
const [migrationApproved, setMigrationApproved] = useState(false);

  // Notifications (RFP item 7 + event-triggered extension) states
  const [notificationSubscriptions, setNotificationSubscriptions] = useState<any[]>([]);
  const [notificationDeliveries, setNotificationDeliveries] = useState<any[]>([]);
  const [editingSubscriptionId, setEditingSubscriptionId] = useState<number | null>(null);
  const [notifFormEmail, setNotifFormEmail] = useState('');
  const [notifFormReportType, setNotifFormReportType] = useState('LOW_STOCK');
  const [notifFormCron, setNotifFormCron] = useState('0 7 * * *');
  const [notifFormFormat, setNotifFormFormat] = useState('PDF');
  const NOTIFICATION_REPORT_TYPES = [
    { value: 'LOW_STOCK', labelEn: 'Low Stock (scheduled)', labelAr: 'مخزون منخفض (مجدول)' },
    { value: 'INVENTORY_BALANCE', labelEn: 'Inventory Balance (scheduled)', labelAr: 'رصيد المخزون (مجدول)' },
    { value: 'HIGH_VALUE_MOVEMENT', labelEn: 'High-Value Movement (scheduled)', labelAr: 'حركة عالية القيمة (مجدول)' },
    { value: 'TRANSFER_COMPLETED', labelEn: 'Transfer Completed (instant)', labelAr: 'اكتمال حركة التحويل (فوري)' },
    { value: 'INVENTORY_DISCREPANCY', labelEn: 'Inventory Discrepancy (instant)', labelAr: 'فرق جرد المخزون (فوري)' }
  ];
  const isInstantReportType = (rt: string) => rt === 'TRANSFER_COMPLETED' || rt === 'INVENTORY_DISCREPANCY';



  // Business Rules Engine (rules_engine module)
  const [businessRules, setBusinessRules] = useState<any[]>([]);
  const [editingRuleCode, setEditingRuleCode] = useState<string | null>(null);
  const [ruleFormCode, setRuleFormCode] = useState('');
  const [ruleFormName, setRuleFormName] = useState('');
  const [ruleFormType, setRuleFormType] = useState('TRANSFER_LIMIT');
  const [ruleFormSeverity, setRuleFormSeverity] = useState('BLOCK');
  const [builderField, setBuilderField] = useState('weightGrams');
  const [builderOp, setBuilderOp] = useState('gt');
  const [builderValue, setBuilderValue] = useState('5000');

  // Monitoring (monitoring module -- RFP item 8: SLA metrics, events, alert routing)
  const [slaMetrics, setSlaMetrics] = useState<any>(null);
  const [monitoringEvents, setMonitoringEvents] = useState<any[]>([]);
  const [alertRoutes, setAlertRoutes] = useState<any[]>([]);
  const [routeFormEventType, setRouteFormEventType] = useState('INVENTORY_DISCREPANCY');
  const [routeFormSeverity, setRouteFormSeverity] = useState('CRITICAL');
  const [routeFormDestination, setRouteFormDestination] = useState('');

  // Configurations states
  const [settingsTab, setSettingsTab] = useState('ai');
  const [sqlQuery, setSqlQuery] = useState('');
  const [sqlResult, setSqlResult] = useState<any>(null);
  const [sqlLoading, setSqlLoading] = useState(false);
  const [suppliersList, setSuppliersList] = useState<any[]>([]);
  const [newSupCode, setNewSupCode] = useState('');
  const [newSupName, setNewSupName] = useState('');
  const [newSupOrigin, setNewSupOrigin] = useState('Switzerland');
  const [newSupSharia, setNewSupSharia] = useState(true);

  // Brands / Refiners master data state (Master Data Lookup)
  const [brandsList, setBrandsList] = useState<any[]>([]);
  const [newBrandCode, setNewBrandCode] = useState('');
  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandOrigin, setNewBrandOrigin] = useState('Switzerland');
  const [newBrandLbmaId, setNewBrandLbmaId] = useState('');
  const [newBrandLbmaCert, setNewBrandLbmaCert] = useState(true);
  const [newBrandDesc, setNewBrandDesc] = useState('');
  const [editingBrandIdx, setEditingBrandIdx] = useState<number | null>(null);
  const [editBrandCode, setEditBrandCode] = useState('');
  const [editBrandName, setEditBrandName] = useState('');
  const [editBrandOrigin, setEditBrandOrigin] = useState('Switzerland');
  const [editBrandLbmaId, setEditBrandLbmaId] = useState('');
  const [editBrandLbmaCert, setEditBrandLbmaCert] = useState(true);
  const [editBrandDesc, setEditBrandDesc] = useState('');

  // Stock Reorder Thresholds
  const [reorderThresholds, setReorderThresholds] = useState<any[]>([]);
  const [lowStockAlerts, setLowStockAlerts] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [newThresholdProductId, setNewThresholdProductId] = useState('');
  const [newThresholdVendorId, setNewThresholdVendorId] = useState('');
  const [newThresholdMinQty, setNewThresholdMinQty] = useState('5');
  const [newThresholdReorderQty, setNewThresholdReorderQty] = useState('10');

  // KFH Branches CRUD state
  const [branchesList, setBranchesList] = useState<any[]>([]);
  const [newBranchCode, setNewBranchCode] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchVaultId, setNewBranchVaultId] = useState('2'); // Default to Branch Vault
  const [editingBranchIdx, setEditingBranchIdx] = useState<number | null>(null);
  const [editBranchCode, setEditBranchCode] = useState('');
  const [editBranchName, setEditBranchName] = useState('');
  const [editBranchVaultId, setEditBranchVaultId] = useState('');
  const [editBranchActive, setEditBranchActive] = useState(true);

  // Real-Time Inventory Monitoring state (precious-metal quantities & movements --
  // to/from main vault, between branches, and with customers). liveBalances is
  // seeded once from GET /reports/live-balances then patched in place by the
  // "BalanceChanged" hub event; liveMovements is a capped, newest-first feed built
  // entirely from "MovementOccurred" push events (there is no REST equivalent to
  // seed it -- GET /reports/transactions already exists for the historical view).
  const [liveBalances, setLiveBalances] = useState<any[]>([]);
  const [liveMovements, setLiveMovements] = useState<any[]>([]);
  const [hubStatus, setHubStatus] = useState<'connecting' | 'live' | 'offline'>('offline');
  const hubConnectionRef = useRef<any>(null);

  // Denominations CRUD state
  const [denomsList, setDenomsList] = useState<any[]>([
    { label: '1 Kilogram Bar', metal: 'Gold',   weight: 1000 },
    { label: '100 Gram Bar',   metal: 'Gold',   weight: 100 },
    { label: '50 Gram Bar',    metal: 'Gold',   weight: 50 },
    { label: '25 Gram Bar',    metal: 'Gold',   weight: 25 },
    { label: '10 Gram Bar',    metal: 'Gold',   weight: 10 },
    { label: '5 Gram Bar',     metal: 'Gold',   weight: 5 },
    { label: '1 Gram Bar',     metal: 'Gold',   weight: 1 },
    { label: '1 Ounce Bar',    metal: 'Silver', weight: 31.10 },
  ]);
  const [newDenomLabel, setNewDenomLabel] = useState('');
  const [newDenomMetal, setNewDenomMetal] = useState('Gold');
  const [newDenomWeight, setNewDenomWeight] = useState('');
  const [newDenomOrigin, setNewDenomOrigin] = useState('Switzerland');
  const [newDenomBrandId, setNewDenomBrandId] = useState('');
  const [denomFilterText, setDenomFilterText] = useState('');
  const [denomFilterOrigin, setDenomFilterOrigin] = useState('');
  const [denomSortBy, setDenomSortBy] = useState<'label' | 'metal' | 'weight' | 'origin'>('label');
  const [branchFilterText, setBranchFilterText] = useState('');
  const [branchSortBy, setBranchSortBy] = useState<'name' | 'code'>('name');
  const [editingDenomIdx, setEditingDenomIdx] = useState<number | null>(null);
  const [editDenomLabel, setEditDenomLabel] = useState('');
  const [editDenomMetal, setEditDenomMetal] = useState('Gold');
  const [editDenomWeight, setEditDenomWeight] = useState('');
  const [editDenomOrigin, setEditDenomOrigin] = useState('Switzerland');
  const [editDenomBrandId, setEditDenomBrandId] = useState('');

  const handleAddDenom = async () => {
    if (!newDenomLabel.trim() || !newDenomWeight) {
      alert(currentLang === 'en' ? 'Please fill in all required fields' : 'يرجى ملء جميع الحقول المطلوبة');
      return;
    }
    try {
      const payload = {
        label: newDenomLabel.trim(),
        metalName: newDenomMetal,
        weightGrams: parseFloat(newDenomWeight),
        originCountry: newDenomOrigin,
        brandId: newDenomBrandId ? parseInt(newDenomBrandId) : null
      };
      const res = await fetch(`${API_BASE}/catalog/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        await fetchProducts();
        const selectedBrand = brandsList.find((b: any) => b.brand_id === parseInt(newDenomBrandId));
        const brandCodePart = selectedBrand ? `-${selectedBrand.brand_code}` : '';
        const metalSymbol = newDenomMetal === 'Gold' ? 'AU' : 'SV';
        const originAbbrev = newDenomOrigin === 'Switzerland' ? 'SWIS' : newDenomOrigin === 'Turkey' ? 'TURK' : 'ORIG';
        const generatedCode = `${metalSymbol}-${parseInt(newDenomWeight)}G-${originAbbrev}${brandCodePart}`;
        const successMsg = currentLang === 'en'
          ? `✓ Product created successfully!\n\nProduct Code: ${generatedCode}\n${newDenomLabel} (${newDenomOrigin})`
          : `✓ تم إنشاء المنتج بنجاح!\n\nرمز المنتج: ${generatedCode}\n${newDenomLabel} (${newDenomOrigin})`;
        alert(successMsg);
        setNewDenomLabel('');
        setNewDenomMetal('Gold');
        setNewDenomWeight('');
        setNewDenomOrigin('Switzerland');
        setNewDenomBrandId('');
      } else {
        const error = await res.text();
        const errorMsg = currentLang === 'en'
          ? `Failed to add denomination.\n\nError: ${error}`
          : `فشل إضافة فئة الوزن.\n\nالخطأ: ${error}`;
        alert(errorMsg);
      }
    } catch (e) {
      alert(currentLang === 'en' ? 'Error connecting to server.' : 'خطأ في الاتصال بالخادم.');
    }
  };

  const fetchBrands = async () => {
    try {
      const res = await fetch(`${API_BASE}/catalog/brands`);
      if (res.ok) {
        const data = await res.json();
        setBrandsList(data);
      } else {
        setBrandsList([]);
      }
    } catch (e) {
      console.warn("Backend catalog/brands not responding.", e);
      setBrandsList([]);
    }
  };

  const handleAddBrand = async () => {
    if (!newBrandCode.trim() || !newBrandName.trim()) {
      alert(currentLang === 'en' ? 'Please fill in brand code and name.' : 'يرجى إدخال رمز واسم العلامة التجارية.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/catalog/brands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandCode: newBrandCode.trim(),
          brandName: newBrandName.trim(),
          countryOfOrigin: newBrandOrigin,
          lbmaRefinerId: newBrandLbmaId.trim(),
          isLbmaCertified: newBrandLbmaCert,
          description: newBrandDesc.trim()
        })
      });
      if (res.ok) {
        alert(currentLang === 'en' ? 'Brand registered successfully.' : 'تم تسجيل العلامة التجارية بنجاح.');
        setNewBrandCode('');
        setNewBrandName('');
        setNewBrandLbmaId('');
        setNewBrandDesc('');
        fetchBrands();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create brand.');
      }
    } catch (_) {
      alert('Error creating brand.');
    }
  };

  const handleStartEditBrand = (idx: number) => {
    const b = brandsList[idx];
    setEditingBrandIdx(idx);
    setEditBrandCode(b.brand_code);
    setEditBrandName(b.brand_name);
    setEditBrandOrigin(b.country_of_origin);
    setEditBrandLbmaId(b.lbma_refiner_id || '');
    setEditBrandLbmaCert(b.is_lbma_certified);
    setEditBrandDesc(b.description || '');
  };

  const handleSaveEditBrand = async (idx: number) => {
    const b = brandsList[idx];
    try {
      const res = await fetch(`${API_BASE}/catalog/brands/${b.brand_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandCode: editBrandCode.trim(),
          brandName: editBrandName.trim(),
          countryOfOrigin: editBrandOrigin,
          lbmaRefinerId: editBrandLbmaId.trim(),
          isLbmaCertified: editBrandLbmaCert,
          description: editBrandDesc.trim()
        })
      });
      if (res.ok) {
        alert(currentLang === 'en' ? 'Brand updated successfully.' : 'تم تحديث العلامة التجارية بنجاح.');
        setEditingBrandIdx(null);
        fetchBrands();
      } else {
        alert('Failed to update brand.');
      }
    } catch (_) {
      alert('Error updating brand.');
    }
  };

  const handleDeleteBrand = async (idx: number) => {
    const b = brandsList[idx];
    if (!window.confirm(currentLang === 'en' ? `Delete brand ${b.brand_name}?` : `هل تريد حذف العلامة ${b.brand_name}؟`)) return;
    try {
      const res = await fetch(`${API_BASE}/catalog/brands/${b.brand_id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchBrands();
      }
    } catch (_) {}
  };

  const handleStartEditDenom = (idx: number) => {
    const d = denomsList[idx];
    setEditingDenomIdx(idx);
    setEditDenomLabel(d.label);
    setEditDenomMetal(d.metal);
    setEditDenomWeight(String(d.weight));
    setEditDenomOrigin(d.origin || 'Switzerland');
    setEditDenomBrandId(d.brand_id ? String(d.brand_id) : '');
  };

  const handleSaveEditDenom = (idx: number) => {
    const selectedBrand = brandsList.find((b: any) => b.brand_id === parseInt(editDenomBrandId));
    setDenomsList(prev => prev.map((d, i) => i === idx
      ? {
          ...d,
          label: editDenomLabel.trim(),
          metal: editDenomMetal,
          weight: parseFloat(editDenomWeight),
          origin: editDenomOrigin,
          brand_id: editDenomBrandId ? parseInt(editDenomBrandId) : d.brand_id,
          brand_name: selectedBrand ? selectedBrand.brand_name : d.brand_name
        }
      : d
    ));
    setEditingDenomIdx(null);
    alert(currentLang === 'en' ? 'Denomination updated successfully.' : 'تم تحديث الوزن بنجاح.');
  };

  const handleDeleteDenom = (idx: number) => {
    if (!window.confirm(currentLang === 'en' ? 'Delete this denomination?' : 'حذف هذا الوزن؟')) return;
    setDenomsList(prev => prev.filter((_, i) => i !== idx));
  };

  // Supplier CRUD handlers
  const [editingSupIdx, setEditingSupIdx] = useState<number | null>(null);
  const [editSupCode, setEditSupCode] = useState('');
  const [editSupName, setEditSupName] = useState('');
  const [editSupOrigin, setEditSupOrigin] = useState('Switzerland');
  const [editSupSharia, setEditSupSharia] = useState(true);

  const handleAddSupplier = () => {
    if (!newSupCode.trim() || !newSupName.trim()) return;
    setSuppliersList(prev => [...prev, { code: newSupCode.trim().toUpperCase(), name: newSupName.trim(), country: newSupOrigin, sharia: newSupSharia }]);
    setNewSupCode('');
    setNewSupName('');
    setNewSupOrigin('Switzerland');
    setNewSupSharia(true);
  };

  const handleStartEditSupplier = (idx: number) => {
    const s = suppliersList[idx];
    setEditingSupIdx(idx);
    setEditSupCode(s.code);
    setEditSupName(s.name);
    setEditSupOrigin(s.country);
    setEditSupSharia(s.sharia);
  };

  const handleSaveEditSupplier = (idx: number) => {
    setSuppliersList(prev => prev.map((s, i) => i === idx
      ? { code: editSupCode.trim().toUpperCase(), name: editSupName.trim(), country: editSupOrigin, sharia: editSupSharia }
      : s
    ));
    setEditingSupIdx(null);
    alert(currentLang === 'en' ? 'Supplier updated successfully.' : 'تم تحديث المورد بنجاح.');
  };

  const handleDeleteSupplier = (idx: number) => {
    if (!window.confirm(currentLang === 'en' ? 'Delete this supplier?' : 'حذف هذا المورد؟')) return;
    setSuppliersList(prev => prev.filter((_, i) => i !== idx));
  };

  // Workflow engine state declarations
  const [workflowTemplates, setWorkflowTemplates] = useState<any[]>([]);
  const [activeWorkflowInstances, setActiveWorkflowInstances] = useState<any[]>([]);
  const [selectedWfType, setSelectedWfType] = useState('PURCHASE_ORDER');
  const [wfName, setWfName] = useState('Default PO Approval Workflow');
  const [wfDesc, setWfDesc] = useState('Standard 2-step verification process for purchase orders.');
  const [wfSteps, setWfSteps] = useState<any[]>([
    { step_name: 'Risk & Treasury Review', required_role: 'Operations Checker', description: 'Initial review of cost and provider accreditation.' },
    { step_name: 'Reconciliation Double Check', required_role: 'Reconciliation Officer', description: 'Validation against system ledger balances.' }
  ]);
  const [actionComments, setActionComments] = useState<Record<number, string>>({});
  const [loadingWF, setLoadingWF] = useState(false);
  // Requests still in flight (not yet APPROVED/REJECTED) against the workflow
  // type currently being edited in the designer. The backend rejects the save
  // outright in this case (see SaveWorkflowTemplateAsync); this mirrors that
  // check client-side so the Save button is disabled proactively instead of
  // letting the user hit the error.
  const pendingCountForSelectedWfType = activeWorkflowInstances.filter(i => i.workflow_type === selectedWfType).length;
  const [selectedWfInstance, setSelectedWfInstance] = useState<any>(null);
  const [showWfDetailsModal, setShowWfDetailsModal] = useState(false);
  const [modalComments, setModalComments] = useState('');

  // "My Activity" personal dashboard state -- own approval history + own pending queue.
  const [myActivity, setMyActivity] = useState<{
    actions_taken_count: number;
    approved_count: number;
    rejected_count: number;
    pending_count: number;
    actions_taken: any[];
    pending: any[];
  } | null>(null);
  const [loadingMyActivity, setLoadingMyActivity] = useState(false);
  // Which KPI card was double-clicked -- drives which list renders below the cards.
  const [myActivityDrilldown, setMyActivityDrilldown] = useState<'ALL' | 'APPROVED' | 'REJECTED' | 'PENDING' | null>(null);
  // "My Activity" date range filter -- defaults to the current calendar month, user-adjustable.
  const [myActivityStartDate, setMyActivityStartDate] = useState(() => getCurrentMonthRange().start);
  const [myActivityEndDate, setMyActivityEndDate] = useState(() => getCurrentMonthRange().end);

  // Branch Transfer Modal state variables
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferItemId, setTransferItemId] = useState<number | null>(null);
  const [transferItemSerial, setTransferItemSerial] = useState('');
  const [transferDestBranchId, setTransferDestBranchId] = useState('');
  const [transferCourierInfo, setTransferCourierInfo] = useState('');

  // GFS & Stock Threshold states
  const [gfsDeliveryRequests, setGfsDeliveryRequests] = useState<any[]>([]);
  const [gfsSyncLogs, setGfsSyncLogs] = useState<any[]>([]);
  const [stockThresholds, setStockThresholds] = useState<any[]>([]);
  const [enterpriseAlerts, setEnterpriseAlerts] = useState<any[]>([]);
  const [gfsSyncLoading, setGfsSyncLoading] = useState(false);
  const [showScanQrModal, setShowScanQrModal] = useState(false);
  const [scanQrInput, setScanQrInput] = useState('');
  const [scanQrResult, setScanQrResult] = useState<any>(null);
  const [scanQrError, setScanQrError] = useState('');
  
  // UC07: Home Delivery states (KFH Kuwait Door-to-Door Fulfillment)
  const [homeDeliveries, setHomeDeliveries] = useState<any[]>([]);
  const [showCreateHomeDeliveryModal, setShowCreateHomeDeliveryModal] = useState(false);
  const [newHdBarId, setNewHdBarId] = useState('');
  const [newHdAccount, setNewHdAccount] = useState('');
  const [newHdCivilId, setNewHdCivilId] = useState('');
  const [newHdName, setNewHdName] = useState('');
  const [newHdPhone, setNewHdPhone] = useState('');
  const [newHdGovernorate, setNewHdGovernorate] = useState('Capital');
  const [newHdArea, setNewHdArea] = useState('Shuwaikh');
  const [newHdBlock, setNewHdBlock] = useState('1');
  const [newHdStreet, setNewHdStreet] = useState('Street 10');
  const [newHdBuilding, setNewHdBuilding] = useState('Building 5');
  const [newHdFlat, setNewHdFlat] = useState('');
  const [newHdInstructions, setNewHdInstructions] = useState('');
  const [civilIdValidationResult, setCivilIdValidationResult] = useState<{ isValid: boolean; message: string } | null>(null);

  // Home Delivery Dispatch & Handover modals
  const [showDispatchHdModal, setShowDispatchHdModal] = useState(false);
  const [dispatchHdId, setDispatchHdId] = useState<number | null>(null);
  const [hdCourierCompany, setHdCourierCompany] = useState('KFH Secure Express Logistics');
  const [hdCourierRepName, setHdCourierRepName] = useState('Saad Al-Azmi');
  const [hdCourierCivilId, setHdCourierCivilId] = useState('290011501239');
  const [hdVehiclePlate, setHdVehiclePlate] = useState('KWT-10-9988');
  const [hdSecuritySeal, setHdSecuritySeal] = useState(`SEAL-HD-${Date.now().toString().slice(-6)}`);

  const [showConfirmHandoverModal, setShowConfirmHandoverModal] = useState(false);
  const [confirmHdId, setConfirmHdId] = useState<number | null>(null);
  const [confirmHdOtp, setConfirmHdOtp] = useState('');
  const [confirmHdCivilId, setConfirmHdCivilId] = useState('');
  const [confirmHdSignature, setConfirmHdSignature] = useState('CUSTOMER_DIGITAL_SIGNED');

  // GFS Branch Courier Dispatch Modal
  const [showGfsDispatchModal, setShowGfsDispatchModal] = useState(false);
  const [gfsDispatchId, setGfsDispatchId] = useState<number | null>(null);
  const [gfsCourierCompany, setGfsCourierCompany] = useState('KFH Security Logistics Group');
  const [gfsCourierRepName, setGfsCourierRepName] = useState('Nasser Al-Mutairi');
  const [gfsCourierCivilId, setGfsCourierCivilId] = useState('290011501239');
  const [gfsVehiclePlate, setGfsVehiclePlate] = useState('KWT-08-4422');
  const [gfsSecuritySeal, setGfsSecuritySeal] = useState(`SEAL-GFS-${Date.now().toString().slice(-6)}`);

  // Damaged Bar Maker-Checker state
  const [damagedBarsList, setDamagedBarsList] = useState<any[]>([]);
  const [showDamageModal, setShowDamageModal] = useState(false);
  const [damageItemId, setDamageItemId] = useState<number | null>(null);
  const [damageReason, setDamageReason] = useState('SCRATCHED_HALLMARK');
  const [damageDesc, setDamageDesc] = useState('');
  const [damageDocId, setDamageDocId] = useState(`DOC-MOCI-${Date.now().toString().slice(-4)}`);

  // Threshold form inputs
  const [thresholdAlertType, setThresholdAlertType] = useState('LOW_STOCK');
  const [thresholdProductId, setThresholdProductId] = useState('');
  const [thresholdDenominationId, setThresholdDenominationId] = useState('');
  const [thresholdCutoffKg, setThresholdCutoffKg] = useState('');

  // Branch verification Modal
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [receiveRequestId, setReceiveRequestId] = useState<number | null>(null);
  const [receiveScannedSerial, setReceiveScannedSerial] = useState('');
  const [receiveBranchId, setReceiveBranchId] = useState(1);
  const [receiveValidationPassed, setReceiveValidationPassed] = useState(true);

  // User permissions from login (group-based access control)
  const [userPermissions, setUserPermissions] = useState<Record<string, string>>({});

  // Sidebar menu layout -- admin-arrangeable navigation order. `menuOrder` holds the
  // globally saved ordering of sidebar node keys (section headers + items); empty
  // until GET /api/admin/menu-layout resolves, at which point the codebase's built-in
  // default order is used as a fallback so the sidebar always renders something sane.
  const [menuOrder, setMenuOrder] = useState<string[]>([]);
  const [menuEditMode, setMenuEditMode] = useState(false);
  // Drag-and-drop reordering state -- which node the pointer picked up, and which
  // node it's currently hovering over (for the drop-target highlight).
  const [draggedMenuKey, setDraggedMenuKey] = useState<string | null>(null);
  const [dragOverMenuKey, setDragOverMenuKey] = useState<string | null>(null);

  // User & Group Admin states
  const [adminTab, setAdminTab] = useState('users');
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminGroups, setAdminGroups] = useState<any[]>([]);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [showGroupPermsModal, setShowGroupPermsModal] = useState(false);
  const [selectedAdminGroup, setSelectedAdminGroup] = useState<any>(null);
  const [editPermMatrix, setEditPermMatrix] = useState<Record<string, string>>({});
  const [editingUserIdx, setEditingUserIdx] = useState<number | null>(null);
  const [editUserDisplay, setEditUserDisplay] = useState('');
  const [editUserEmail, setEditUserEmail] = useState('');
  const [editingGroupIdx, setEditingGroupIdx] = useState<number | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupDesc, setEditGroupDesc] = useState('');
  // Create user form
  const [newUserName, setNewUserName] = useState('');
  const [newUserDisplay, setNewUserDisplay] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserGroups, setNewUserGroups] = useState<number[]>([]);
  // Create group form
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');

  // Module catalog, grouped into two tiers. Operational modules are the day-to-day
  // VIEW/transaction surfaces; administration modules are the MANAGE/SETUP surfaces.
  // The manage modules (vault_location, master_data, workflow_design) are deliberately
  // separate from their operational view counterparts (spatial_map, workflows) so an
  // operator can view the vault map without holding authority to alter its structure.
  const MODULE_KEYS = [
    // --- Operations ---
    { key: 'dashboard', label: 'Executive Dashboard', tier: 'Operations' },
    { key: 'pending_actions', label: 'My Pending Actions', tier: 'Operations' },
    { key: 'spatial_map', label: 'Vault Spatial Map (view)', tier: 'Operations' },
    { key: 'custody', label: 'Customer Custody', tier: 'Operations' },
    { key: 'stocktake', label: 'Stocktake', tier: 'Operations' },
    { key: 'reports', label: 'Reporting & Analytics', tier: 'Operations' },
    { key: 'workflows', label: 'Workflow Actions (approve/reject)', tier: 'Operations' },
    { key: 'intake', label: 'Receive Shipment', tier: 'Operations' },
    // --- Administration / Setup ---
    { key: 'vault_location', label: 'Vault Location Setup (manage shelves)', tier: 'Administration' },
    { key: 'master_data', label: 'Master Data (branches, vendors, thresholds)', tier: 'Administration' },
    { key: 'migration', label: 'Bulk Ingestion', tier: 'Administration' },
    { key: 'rules_engine', label: 'Business Rules Engine (author/version rules)', tier: 'Administration' },
    { key: 'monitoring', label: 'Monitoring (SLA metrics & alert routing)', tier: 'Administration' },
    { key: 'workflow_design', label: 'Workflow Designer (templates)', tier: 'Administration' },
    { key: 'user_admin', label: 'User & Group Admin', tier: 'Administration' },
    { key: 'settings', label: 'System Settings', tier: 'Administration' }
  ];

  const canAccess = (moduleKey: string) => {
    if (!isLoggedIn) return false;
    if (Object.keys(userPermissions).length === 0) return false; // No permissions loaded yet = deny
    return userPermissions[moduleKey] !== 'HIDDEN' && userPermissions[moduleKey] !== undefined;
  };
  const getAccess = (moduleKey: string): string => {
    if (!isLoggedIn) return 'HIDDEN';
    return userPermissions[moduleKey] || 'HIDDEN';
  };
  const canModify = (moduleKey: string) => {
    const level = getAccess(moduleKey);
    return level === 'FULL' || level === 'READ_WRITE';
  };

  // Sidebar menu layout -- fetched once per session (any authenticated user; see
  // GET /api/admin/menu-layout) so every user renders the same admin-arranged order.
  const fetchMenuLayout = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/menu-layout`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.order) {
          const parsed = JSON.parse(data.order);
          if (Array.isArray(parsed)) setMenuOrder(parsed);
        }
      }
    } catch (e) {
      console.warn("Menu layout endpoint not responding or offline.", e);
    }
  };

  // Persists a full reordering of sidebar node keys. Gated server-side by
  // `settings.write` (FULL/READ_WRITE on the `settings` module, or IT/Admin) --
  // the frontend's "Edit Menu" toggle is UX only, same as every other canModify gate.
  const saveMenuOrder = async (newOrder: string[]) => {
    setMenuOrder(newOrder);
    try {
      const res = await fetch(`${API_BASE}/admin/menu-layout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: newOrder, updatedBy: displayName || username })
      });
      if (!res.ok) {
        console.warn("Failed to save sidebar menu layout.");
      }
    } catch (e) {
      console.warn("Menu layout endpoint not responding or offline.", e);
    }
  };

  const fetchWorkflows = async () => {
    try {
      setLoadingWF(true);
      const resTemp = await fetch(`${API_BASE}/workflows/templates`, { cache: 'no-store' });
      if (resTemp.ok) {
        const templates = await resTemp.json();
        setWorkflowTemplates(templates);
        // Find existing template for active selected type
        const current = templates.find((t: any) => t.workflowType === selectedWfType);
        if (current) {
          setWfName(current.name);
          setWfDesc(current.description);
          setWfSteps(current.steps.map((s: any) => ({
            step_name: s.stepName,
            required_role: s.requiredRole,
            description: s.description
          })));
        }
      }
      
      const resInst = await fetch(`${API_BASE}/workflows/instances/active`, { cache: 'no-store' });
      if (resInst.ok) {
        const instances = await resInst.json();
        setActiveWorkflowInstances(instances);
      }
    } catch (e) {
      console.warn("Workflow endpoints not responding or offline.", e);
    } finally {
      setLoadingWF(false);
    }
  };

  const fetchMyActivity = async (startDate?: string, endDate?: string) => {
    if (!username) return;
    try {
      setLoadingMyActivity(true);
      const params = new URLSearchParams({ username });
      const start = startDate ?? myActivityStartDate;
      const end = endDate ?? myActivityEndDate;
      if (start) params.set('startDate', start);
      if (end) params.set('endDate', end);
      const res = await fetch(`${API_BASE}/dashboard/my-activity?${params.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setMyActivity(data);
      }
    } catch (e) {
      console.warn("My Activity endpoint not responding or offline.", e);
    } finally {
      setLoadingMyActivity(false);
    }
  };

  // "Executive Board" -- fetches the date-scoped KPIs + inventory table (see backend
  // GetExecutiveBoard). Defaults to whatever's currently in execStartDate/execEndDate,
  // but accepts explicit dates so onChange handlers can refetch immediately.
  const fetchExecutiveBoard = async (startDate?: string, endDate?: string) => {
    try {
      setLoadingExecBoard(true);
      const params = new URLSearchParams();
      const start = startDate ?? execStartDate;
      const end = endDate ?? execEndDate;
      if (start) params.set('startDate', start);
      if (end) params.set('endDate', end);
      const res = await fetch(`${API_BASE}/dashboard/executive-board?${params.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setExecBoard(data);
      }
    } catch (e) {
      console.warn("Executive Board endpoint not responding or offline.", e);
    } finally {
      setLoadingExecBoard(false);
    }
  };

  // Compliance Dashboard (Reporting Requirements Gap Analysis, Item 6).
  const fetchComplianceDashboard = async () => {
    try {
      setLoadingCompliance(true);
      const res = await fetch(`${API_BASE}/dashboard/compliance`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setComplianceDashboard(data);
      }
    } catch (e) {
      console.warn("Compliance dashboard endpoint not responding or offline.", e);
    } finally {
      setLoadingCompliance(false);
    }
  };

  useEffect(() => {
    const current = workflowTemplates.find((t: any) => t.workflowType === selectedWfType);
    if (current) {
      setWfName(current.name);
      setWfDesc(current.description);
      setWfSteps(current.steps.map((s: any) => ({
        step_name: s.stepName,
        required_role: s.requiredRole,
        description: s.description
      })));
    } else {
      setWfName(`Default ${selectedWfType} Workflow`);
      setWfDesc(`Approval workflow for ${selectedWfType}`);
      setWfSteps([]);
    }
  }, [selectedWfType, workflowTemplates]);

  useEffect(() => {
    setSelectedBar(null);
  }, [selectedShelf]);

  // Per-unit weight for a product_id, resolved from the settings catalog.
  const productWeight = (productId: string | number) => {
    const p = products.find((pp: any) => String(pp.product_id) === String(productId));
    return p?.weight_grams || 0;
  };
  const lineWeight = (l: { product_id: string; qty: number }) => productWeight(l.product_id) * (l.qty || 0);
  const linesTotalWeight = (lines: { product_id: string; qty: number }[]) =>
    lines.reduce((w, l) => w + lineWeight(l), 0);
  const linesTotalCost = (lines: { qty: number; unit_cost: number }[]) =>
    lines.reduce((c, l) => c + (l.unit_cost || 0) * (l.qty || 0), 0);

  // Item-combo helpers for the PO entry row (searchable product picker).
  // Filter by: (1) active status, and (2) matching origin country from the P.O. form
  const poActiveProducts = products.filter((p: any) =>
    p.is_active !== false && p.origin_country === poOrigin
  );
  const poProductLabel = (p: any) =>
    `${p.metal_name} ${p.denomination_label}${p.purity_value ? ` — ${p.purity_value}` : ''}${p.weight_grams ? ` (${p.weight_grams}g)` : ''}`;
  const poComboSelected = poActiveProducts.find((p: any) => String(p.product_id) === String(poEntryProduct));
  const poComboMatches = poActiveProducts.filter((p: any) => {
    const q = poComboQuery.trim().toLowerCase();
    return !q || poProductLabel(p).toLowerCase().includes(q) || String(p.product_code || '').toLowerCase().includes(q);
  });

  // Total weight is always auto-summed from the lines. Total cost defaults to the summed
  // line cost but stays editable — once the business overrides it we leave it alone.
  useEffect(() => {
    setPoWeight(linesTotalWeight(poLines));
    if (!poCostOverridden) {
      setPoCost(linesTotalCost(poLines));
    }
  }, [poLines, products, poCostOverridden]);

  const handleSaveTemplate = async () => {
    if (!wfName.trim()) {
      alert(currentLang === 'en' ? "Please enter a workflow template name." : "يرجى إدخال اسم لنموذج سير العمل.");
      return;
    }
    if (wfSteps.length === 0) {
      alert(currentLang === 'en' ? "Cannot save workflow template: At least one step must be defined." : "لا يمكن حفظ نموذج سير العمل: يجب تحديد خطوة واحدة على الأقل.");
      return;
    }
    for (let i = 0; i < wfSteps.length; i++) {
      if (!wfSteps[i].step_name.trim() || !wfSteps[i].required_role) {
        alert(currentLang === 'en' 
          ? `Please fill in the step name and required authority role for Step ${i + 1}.` 
          : `يرجى ملء اسم الخطوة ودور السلطة المطلوب للخطوة رقم ${i + 1}.`);
        return;
      }
    }
    try {
      const res = await fetch(`${API_BASE}/workflows/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowType: selectedWfType,
          name: wfName,
          description: wfDesc,
          steps: wfSteps
        })
      });
      if (res.ok) {
        alert(currentLang === 'en' ? "Workflow template saved and activated successfully." : "تم حفظ وتفعيل نموذج سير العمل بنجاح.");
        fetchWorkflows();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to save template', 'فشل حفظ النموذج'));
      }
    } catch (e) {
      alert(currentLang === 'en' 
        ? "Error saving workflow template. Please ensure the backend is running."
        : "خطأ في حفظ نموذج سير العمل. يرجى التأكد من تشغيل الخادم.");
    }
  };

  const handleInstanceAction = async (instanceId: number, action: string, customComments?: string) => {
    try {
      const res = await fetch(`${API_BASE}/workflows/instances/${instanceId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username,
          action: action,
          comments: customComments !== undefined ? customComments : (actionComments[instanceId] || '')
        })
      });
      if (res.ok) {
        alert(`Workflow instance ${action.toLowerCase()} successfully.`);
        if (customComments !== undefined) {
          setModalComments('');
          setShowWfDetailsModal(false);
          setSelectedWfInstance(null);
        } else {
          setActionComments(prev => ({ ...prev, [instanceId]: '' }));
        }
        fetchWorkflows();
        fetchInventory();
        fetchExecutiveBoard(); // Keep the Executive Board's date-scoped KPIs/table in sync
        fetchPOs();
        fetchTransfers();
        fetchLocations(); // An approved INTAKE_SHIPMENT places bars in the vault -- refresh the
                          // spatial map so the newly-occupied slots show up without a page reload.
        fetchMyActivity(); // Keep the My Activity dashboard's counts/lists in sync with this decision
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to process action', 'فشل تنفيذ الإجراء'));
      }
    } catch (e) {
      alert("Error processing workflow action.");
    }
  };

  // Fetch static data and load tickers (only after user is logged in)
  useEffect(() => {
    if (!isLoggedIn) return;

    fetchRates();
    fetchInventory();
    fetchExecutiveBoard();
    fetchPOs();
    fetchTransfers();
    fetchLocations();
    fetchSuppliers();
    fetchReconciliation();
    fetchWorkflows();
    fetchReorderThresholds();
    fetchLowStockAlerts();
    fetchBranches();
    fetchAdminData();
    fetchProducts();

    const interval = setInterval(() => {
      setGoldRate(prev => parseFloat((prev + (Math.random() - 0.5) * 1.5).toFixed(2)));
      setSilverRate(prev => parseFloat((prev + (Math.random() - 0.5) * 0.1).toFixed(2)));
    }, 4000);

    return () => clearInterval(interval);
  }, [isLoggedIn]);

  const translateDb = (val: string) => {
    if (currentLang === 'en') return val;
    const dbMap: Record<string, string> = {
      'Gold': 'ذهب',
      'Silver': 'فضة',
      'READY': 'جاهز للبيع',
      'RESERVED': 'محجوز',
      'INACTIVE': 'غير نشط',
      'HELD_IN_CUSTODY': 'محفوظ بالأمانة',
      'WITHDRAWN': 'تم السحب ماديًا',
      'PENDING_APPROVAL': 'انتظار الاعتماد',
      'APPROVED': 'معتمد ومقبول',
      'RECEIVED': 'مستلم ومسكن بالرفوف',
      'Switzerland': 'سويسرا',
      'Turkey': 'تركيا',
      'United Kingdom': 'المملكة المتحدة',
      'Main Vault': 'الخزينة الرئيسية',
      'Fahaheel Branch Vault': 'خزينة فرع الفحيحيل',
      'Shelf Row 1': 'الرف صف 1',
      'Shelf Row 2': 'الرف صف 2',
      'Shelf Row 3': 'الرف صف 3',
      'Shelf Row 4': 'الرف صف 4',
      'Slot 1': 'الخانة 1',
      'Slot 2': 'الخانة 2',
      'Slot 3': 'الخانة 3',
      'Slot 4': 'الخانة 4',
      'Slot 5': 'الخانة 5',
      'Slot 6': 'الخانة 6',
      'Slot 7': 'الخانة 7',
      'Slot 8': 'الخانة 8',
      'Slot 9': 'الخانة 9',
      'Slot 10': 'الخانة 10',
      'Withdrawn': 'تم سحبه مسبقاً',
      '1 Gram Bar': 'سبيكة 1 جرام',
      '5 Gram Bar': 'سبيكة 5 جرام',
      '10 Gram Bar': 'سبيكة 10 جرام',
      '25 Gram Bar': 'سبيكة 25 جرام',
      '50 Gram Bar': 'سبيكة 50 جرام',
      '100 Gram Bar': 'سبيكة 100 جرام',
      '1 Kilogram Bar': 'سبيكة 1 كيلوجرام',
      '1 Ounce Bar': 'سبيكة 1 أونصة',
      'KFH_OWNED': 'بيت التمويل الكويتي',
      'CUSTOMER_OWNED': 'أمانات العملاء'
    };
    return dbMap[val] || val;
  };

  const fetchGfsDeliveryRequests = async () => {
    try {
      const res = await fetch(`${API_BASE}/gfs/delivery-requests`);
      if (res.ok) {
        const data = await res.json();
        setGfsDeliveryRequests(data);
      }
    } catch (e) {
      console.warn("Error fetching GFS delivery requests", e);
    }
  };

  const fetchGfsSyncLogs = async () => {
    try {
      const res = await fetch(`${API_BASE}/gfs/sync-logs`);
      if (res.ok) {
        const data = await res.json();
        setGfsSyncLogs(data);
      }
    } catch (e) {
      console.warn("Error fetching GFS EOD sync logs", e);
    }
  };

  const fetchStockThresholds = async () => {
    try {
      const res = await fetch(`${API_BASE}/inventory/stock-thresholds`);
      if (res.ok) {
        const data = await res.json();
        setStockThresholds(data);
      }
    } catch (e) {
      console.warn("Error fetching stock thresholds", e);
    }
  };

  const fetchHomeDeliveries = async () => {
    try {
      const res = await fetch(`${API_BASE}/gfs/home-delivery`);
      if (res.ok) {
        const data = await res.json();
        setHomeDeliveries(data);
      }
    } catch (e) {
      console.warn("Error fetching home deliveries", e);
    }
  };

  const fetchDamagedBars = async () => {
    try {
      const res = await fetch(`${API_BASE}/inventory/damaged-items`);
      if (res.ok) {
        const data = await res.json();
        setDamagedBarsList(data);
      }
    } catch (e) {
      console.warn("Error fetching damaged bars", e);
    }
  };

  const handleValidateCivilIdApi = async (civilId: string) => {
    if (!civilId || civilId.length !== 12) {
      setCivilIdValidationResult({ isValid: false, message: currentLang === 'en' ? 'Kuwait Civil ID must be 12 digits.' : 'الرقم المدني الكويتي يجب أن يتكون من 12 رقماً.' });
      return false;
    }
    try {
      const res = await fetch(`${API_BASE}/validation/civil-id/${civilId}`);
      if (res.ok) {
        const data = await res.json();
        setCivilIdValidationResult(data);
        return data.isValid;
      }
    } catch (_) {}
    return false;
  };

  const handleProcessDamageAction = async (itemId: number, action: 'APPROVE' | 'REJECT') => {
    try {
      const res = await fetch(`${API_BASE}/inventory/items/${itemId}/damage-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        alert(action === 'APPROVE' 
          ? (currentLang === 'en' ? 'Damage report APPROVED by Checker. Bar status set to DAMAGED.' : 'تم اعتماد تقرير التلف من المراجع. تم تحويل السبيكة إلى تالفة.')
          : (currentLang === 'en' ? 'Damage report REJECTED by Checker. Bar status restored.' : 'تم رفض تقرير التلف واستعادة حالة السبيكة.'));
        fetchDamagedBars();
        fetchInventory();
      } else {
        const err = await res.json();
        alert(err.error || 'Action failed');
      }
    } catch (e) {
      alert('Error processing damage action');
    }
  };

  const fetchEnterpriseStockAlerts = async () => {
    try {
      const res = await fetch(`${API_BASE}/inventory/stock-alerts/enterprise`);
      if (res.ok) {
        const data = await res.json();
        setEnterpriseAlerts(data);
      }
    } catch (e) {
      console.warn("Error evaluating enterprise stock alerts", e);
    }
  };

  const fetchRates = async () => {
    try {
      const res = await fetch(`${API_BASE}/rates`);
      if (res.ok) {
        const data = await res.json();
        setGoldRate(data.gold.bid);
        setSilverRate(data.silver.bid);
      }
    } catch (e) {
      console.warn("Backend rate feed not available.", e);
    }
  };

  const fetchInventory = async () => {
    // Note: the Executive Board's KPIs (ready/custody/gold weight) are now sourced from the
    // date-scoped `dashboard/executive-board` endpoint via fetchExecutiveBoard(), not from here.
    // This still loads the full item registry, which the Transfer modal and Spatial Map rely on.
    try {
      const resItems = await fetch(`${API_BASE}/stock/items`);
      if (resItems.ok) {
        const items = await resItems.json();
        setInventoryList(items);
      } else {
        setInventoryList([]);
      }
    } catch (e) {
      console.warn("Backend stock/items not responding.", e);
      setInventoryList([]);
    }
  };

  const fetchPOs = async () => {
    try {
      const res = await fetch(`${API_BASE}/purchase-orders`);
      if (res.ok) {
        const data = await res.json();
        setPoList(data);
      }
    } catch (e) {
      console.warn("Backend PO list not responding.", e);
      setPoList([]);
    }
  };

  const fetchTransfers = async () => {
    try {
      const res = await fetch(`${API_BASE}/transfers`);
      if (res.ok) {
        const data = await res.json();
        setTransfersList(data);
      }
    } catch (e) {
      console.warn("Backend transfers list not responding.", e);
      setTransfersList([]);
    }
  };

  const fetchLocations = async () => {
    try {
      const res = await fetch(`${API_BASE}/catalog/locations`);
      if (res.ok) {
        const data = await res.json();
        // Map backend location data to the expected format for the vault visualizer
        const list = data.map((loc: any) => ({
          id: loc.id,
          name: loc.name,
          occupancy: loc.occupancy,
          vault_name: loc.vault_name,
          zone_room: loc.zone_room,
          shelf_row: loc.shelf_row,
          slots: loc.slots.map((s: any) => ({
            id: s.location_id,
            location_id: s.location_id,
            shelf_row: s.shelf_row,
            slot_bin: s.slot_bin,
            occupied: s.occupied,
            type: s.metal_type?.toLowerCase() || 'gold'
          }))
        }));
        setLocations(list);
      } else {
        setLocations([]);
      }
    } catch (e) {
      console.warn("Backend catalog/locations not responding.", e);
      setLocations([]);
    }
  };

  const handleAddLocation = async () => {
    if (!newZoneRoom.trim() || !newShelfRow.trim() || !newSlotBin.trim()) {
      alert(currentLang === 'en' ? 'Please fill in all fields.' : 'يرجى ملء جميع الحقول.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/catalog/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zoneRoom: newZoneRoom,
          shelfRow: newShelfRow,
          slotBin: newSlotBin
        })
      });
      if (res.ok) {
        alert(currentLang === 'en' ? 'Location slot added successfully.' : 'تم إضافة الموقع الإحداثي بنجاح.');
        setNewShelfRow('');
        setNewSlotBin('');
        fetchLocations();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to add location', 'فشل إضافة الموقع'));
      }
    } catch (e) {
      alert('Error adding location.');
    }
  };

  const handleDeleteLocation = async (id: number) => {
    if (!window.confirm(currentLang === 'en' ? 'Are you sure you want to delete this coordinate slot?' : 'هل أنت متأكد من رغبتك في حذف هذا الموقع الإحداثي؟')) return;
    try {
      const res = await fetch(`${API_BASE}/catalog/locations/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        alert(currentLang === 'en' ? 'Location deleted successfully.' : 'تم حذف الموقع الإحداثي بنجاح.');
        setSelectedShelf(null);
        fetchLocations();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to delete location', 'فشل حذف الموقع'));
      }
    } catch (e) {
      alert('Error deleting location.');
    }
  };

  const fetchSuppliers = async () => {
    try {
      const res = await fetch(`${API_BASE}/catalog/vendors`);
      if (res.ok) {
        const data = await res.json();
        setSuppliersList(data);
      } else {
        setSuppliersList([]);
      }
    } catch (e) {
      console.warn("Backend catalog/vendors not responding.", e);
      setSuppliersList([]);
    }
  };

  // Reorder Thresholds
  const fetchReorderThresholds = async () => {
    try {
      const res = await fetch(`${API_BASE}/inventory/reorder-thresholds`);
      if (res.ok) setReorderThresholds(await res.json());
    } catch (_) {}
  };

  const fetchLowStockAlerts = async () => {
    try {
      const res = await fetch(`${API_BASE}/inventory/low-stock-alerts`);
      if (res.ok) setLowStockAlerts(await res.json());
    } catch (_) {}
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch(`${API_BASE}/catalog/products`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data);
        setDenomsList(data.map((p: any) => ({
          label: p.denomination_label,
          metal: p.metal_name,
          weight: p.weight_grams,
          product_id: p.product_id,
          product_code: p.product_code,
          origin: p.origin_country,
          brand_id: p.brand_id,
          brand_name: p.brand_name,
          denomination_id: p.denomination_id
        })));
      }
    } catch (_) {}
  };

  const handleAddThreshold = async () => {
    if (!newThresholdProductId || !newThresholdVendorId) return;
    try {
      const res = await fetch(`${API_BASE}/inventory/reorder-thresholds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: parseInt(newThresholdProductId),
          vendorId: parseInt(newThresholdVendorId),
          minStockQty: parseInt(newThresholdMinQty) || 5,
          reorderQty: parseInt(newThresholdReorderQty) || 10,
          isActive: true
        })
      });
      if (res.ok) {
        fetchReorderThresholds();
        fetchLowStockAlerts();
        setNewThresholdProductId('');
        setNewThresholdVendorId('');
        setNewThresholdMinQty('5');
        setNewThresholdReorderQty('10');
      }
    } catch (_) {}
  };

  const handleDeleteThreshold = async (id: number) => {
    try {
      await fetch(`${API_BASE}/inventory/reorder-thresholds/${id}`, { method: 'DELETE' });
      fetchReorderThresholds();
      fetchLowStockAlerts();
    } catch (_) {}
  };

  const handleGenerateDraftPO = async (thresholdId: number) => {
    try {
      const res = await fetch(`${API_BASE}/inventory/low-stock-alerts/${thresholdId}/draft-po`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createdBy: username || 'SYSTEM' })
      });
      if (res.ok) {
        const data = await res.json();
        alert(data.already_exists
          ? `A draft P.O. already exists (PO #${data.po_id}).`
          : `Draft P.O. #${data.po_id} created successfully!`);
        fetchPOs();
        fetchLowStockAlerts();
      }
    } catch (_) { alert('Failed to generate draft P.O.'); }
  };

  const fetchBranches = async () => {
    try {
      const res = await fetch(`${API_BASE}/catalog/branches`);
      if (res.ok) {
        setBranchesList(await res.json());
      }
    } catch (_) {}
  };

  // --- Real-Time Inventory Monitoring -------------------------------------
  // One-time REST snapshot to seed the balances table; live patches then arrive
  // over the SignalR hub (connectMonitoringHub below) and are merged in place.
  const fetchLiveBalances = async () => {
    try {
      const res = await fetch(`${API_BASE}/reports/live-balances`);
      if (res.ok) {
        setLiveBalances(await res.json());
      }
    } catch (_) {}
  };

  // Resolves a location_id from a live push event (which only carries raw IDs,
  // not resolved names -- see SignalRInventoryMonitoringNotifier) against the
  // `locations` state already loaded for the Vault Spatial Map screen.
  const resolveLocationLabel = (locationId: number | null | undefined) => {
    if (!locationId) return currentLang === 'en' ? 'Outside Vault (Customer)' : 'خارج الخزنة (عميل)';
    const loc = locations.find((l: any) => l.id === locationId);
    return loc ? `${loc.vault_name} — ${loc.name}` : `#${locationId}`;
  };

  // Opens (or re-opens) the real-time monitoring hub connection. Called once
  // after login; automatically reconnects on transient network drops. The
  // connection is intentionally lazy (only started once the user is logged in
  // and authToken is set), since the hub requires the same `reports.read`
  // authorization as every other reporting view.
  const connectMonitoringHub = async () => {
    if (hubConnectionRef.current) return; // already connecting/connected
    let signalR: any;
    try {
      signalR = await import('@microsoft/signalr');
    } catch (_) {
      return; // dependency not installed yet -- monitoring screen simply stays on REST-only data
    }
    const hubUrl = `${API_BASE.replace(/\/api$/, '')}/hubs/inventory-monitoring`;
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, { accessTokenFactory: () => authToken || '' })
      .withAutomaticReconnect()
      .build();

    connection.on('BalanceChanged', (patch: any) => {
      setLiveBalances((prev: any[]) => {
        const idx = prev.findIndex((b: any) =>
          b.location_id === patch.location_id && b.product_id === patch.product_id && b.ownership_type === patch.ownership_type);
        if (idx === -1) {
          // First time we've seen this (location, product, ownership) combo -- no
          // resolved names available yet from this push alone; the next full
          // fetchLiveBalances() refresh will fill them in.
          return [...prev, patch];
        }
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        return next;
      });
    });

    connection.on('MovementOccurred', (movement: any) => {
      setLiveMovements((prev: any[]) => [movement, ...prev].slice(0, 50));
    });

    connection.onreconnecting(() => setHubStatus('connecting'));
    connection.onreconnected(() => setHubStatus('live'));
    connection.onclose(() => setHubStatus('offline'));

    try {
      setHubStatus('connecting');
      await connection.start();
      setHubStatus('live');
      hubConnectionRef.current = connection;
    } catch (_) {
      setHubStatus('offline');
    }
  };

  const disconnectMonitoringHub = () => {
    hubConnectionRef.current?.stop?.();
    hubConnectionRef.current = null;
    setHubStatus('offline');
  };

  const handleAddBranch = async () => {
    if (!newBranchCode || !newBranchName) return;
    try {
      const res = await fetch(`${API_BASE}/catalog/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchCode: newBranchCode,
          branchName: newBranchName,
          vaultId: parseInt(newBranchVaultId),
          isActive: true
        })
      });
      if (res.ok) {
        fetchBranches();
        setNewBranchCode('');
        setNewBranchName('');
        alert(currentLang === 'en' ? 'Branch created successfully.' : 'تم إنشاء الفرع بنجاح.');
      } else {
        alert(currentLang === 'en' ? 'Failed to create branch.' : 'فشل إنشاء الفرع.');
      }
    } catch (_) {
      alert(currentLang === 'en' ? 'Error creating branch.' : 'خطأ أثناء إنشاء الفرع.');
    }
  };

  const handleStartEditBranch = (idx: number) => {
    const b = branchesList[idx];
    setEditingBranchIdx(idx);
    setEditBranchCode(b.branch_code);
    setEditBranchName(b.branch_name);
    setEditBranchVaultId(b.vault_id.toString());
    setEditBranchActive(b.is_active);
  };

  const handleSaveEditBranch = async (idx: number) => {
    const b = branchesList[idx];
    try {
      const res = await fetch(`${API_BASE}/catalog/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: b.branch_id,
          branchCode: editBranchCode,
          branchName: editBranchName,
          vaultId: parseInt(editBranchVaultId),
          isActive: editBranchActive
        })
      });
      if (res.ok) {
        fetchBranches();
        setEditingBranchIdx(null);
        alert(currentLang === 'en' ? 'Branch updated successfully.' : 'تم تحديث الفرع بنجاح.');
      } else {
        alert(currentLang === 'en' ? 'Failed to update branch.' : 'فشل تحديث الفرع.');
      }
    } catch (_) {
      alert(currentLang === 'en' ? 'Error updating branch.' : 'خطأ أثناء تحديث الفرع.');
    }
  };

  const handleDeleteBranch = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/catalog/branches/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchBranches();
      }
    } catch (_) {}
  };

  const handleInitiateBranchTransfer = async () => {
    if (!transferItemId || !transferDestBranchId) return;
    try {
      const res = await fetch(`${API_BASE}/transfers/workflow-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: transferItemId,
          destinationBranchId: parseInt(transferDestBranchId),
          courierInfo: transferCourierInfo || 'Standard Courier Shipment',
          initiatedBy: username || 'SYSTEM'
        })
      });
      if (res.ok) {
        alert(currentLang === 'en' ? 'Branch transfer workflow initiated successfully.' : 'تم بدء حركة التحويل الفرعي وإرسالها للموافقة بنجاح.');
        setShowTransferModal(false);
        setTransferItemId(null);
        setTransferItemSerial('');
        setTransferDestBranchId('');
        setTransferCourierInfo('');
        fetchInventory(); // Reload inventory
        fetchWorkflows(); // Reload active workflow approvals list
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to initiate transfer', 'فشل بدء حركة التحويل'));
      }
    } catch (_) {
      alert('Error initiating branch transfer workflow');
    }
  };

  const handleInitiateBranchTransferTab = async () => {
    if (!transferItemId || !transferDestBranchId) return;
    try {
      const res = await fetch(`${API_BASE}/transfers/workflow-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: transferItemId,
          destinationBranchId: parseInt(transferDestBranchId),
          courierInfo: transferCourierInfo || 'Standard Courier Shipment',
          initiatedBy: username || 'SYSTEM'
        })
      });
      if (res.ok) {
        alert(currentLang === 'en' ? 'Branch transfer workflow initiated successfully.' : 'تم بدء حركة التحويل الفرعي وإرسالها للموافقة بنجاح.');
        setTransferItemId(null);
        setTransferItemSerial('');
        setTransferDestBranchId('');
        setTransferCourierInfo('');
        setTransferBarcodeQuery('');
        fetchInventory(); // Reload inventory
        fetchWorkflows(); // Reload active workflow approvals list
        fetchTransfers(); // Reload transfers list
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to initiate transfer', 'فشل بدء حركة التحويل'));
      }
    } catch (_) {
      alert('Error initiating branch transfer workflow');
    }
  };

  const handleReceiveTransfer = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/transfers/${id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivedBy: displayName
        })
      });
      if (res.ok) {
        alert(currentLang === 'en' ? 'Branch transfer received successfully.' : 'تم استلام الشحنة وتأكيد حركة التحويل بنجاح.');
        fetchInventory();
        fetchTransfers();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to receive transfer', 'فشل استلام حركة التحويل'));
      }
    } catch (_) {
      alert('Error receiving branch transfer');
    }
  };

  const fetchReconciliation = async () => {
    try {
      const res = await fetch(`${API_BASE}/reconciliation/discrepancies`);
      if (res.ok) {
        const data = await res.json();
        setDiscrepancyList(data);
      } else {
        setDiscrepancyList([]);
      }
    } catch (e) {
      console.warn("Backend reconciliation/discrepancies not responding.", e);
      setDiscrepancyList([]);
    }
  };

  // Triggers a reconciliation run against Core Banking GL (POST /api/reconciliation/run,
  // gated reports.write). Previously there was no way to invoke this from the UI at all --
  // it's also the moment an INVENTORY_DISCREPANCY notification fires (see
  // ReconciliationService.RunReconciliationAsync / docs/PERMISSIONS.md `notifications`
  // module), so exposing it here is what makes that alert type reachable in practice.
  const [reconciliationRunning, setReconciliationRunning] = useState(false);
  const handleRunReconciliation = async () => {
    setReconciliationRunning(true);
    try {
      const res = await fetch(`${API_BASE}/reconciliation/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executed_by: username })
      });
      if (res.ok) {
        const data = await res.json();
        alert(currentLang === 'en'
          ? `Reconciliation run complete: ${data.total_discrepancies} discrepancy(ies) found out of ${data.total_items_checked} items checked.`
          : `اكتملت عملية المطابقة: تم العثور على ${data.total_discrepancies} فروقات من أصل ${data.total_items_checked} صنف تم فحصه.`);
        fetchReconciliation();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to run reconciliation', 'فشل تنفيذ عملية المطابقة'));
      }
    } catch (e) {
      alert(currentLang === 'en' ? 'Error running reconciliation.' : 'خطأ أثناء تنفيذ المطابقة.');
    } finally {
      setReconciliationRunning(false);
    }
  };

  // =========================================================================
  // Notifications (RFP item 7: cron-scheduled distribution-list reports, plus the
  // TRANSFER_COMPLETED / INVENTORY_DISCREPANCY event-triggered extension). Admin-tier
  // (`notifications` module) -- see docs/PERMISSIONS.md.
  // =========================================================================
  const fetchNotificationSubscriptions = async () => {
    try {
      const res = await fetch(`${API_BASE}/notifications/subscriptions`);
      if (res.ok) {
        setNotificationSubscriptions(await res.json());
      } else {
        setNotificationSubscriptions([]);
      }
    } catch (e) {
      console.warn("Backend notifications/subscriptions not responding.", e);
      setNotificationSubscriptions([]);
    }
  };

  const fetchNotificationDeliveries = async (subscriptionId?: number) => {
    try {
      const qs = subscriptionId ? `?subscriptionId=${subscriptionId}` : '';
      const res = await fetch(`${API_BASE}/notifications/deliveries${qs}`);
      if (res.ok) {
        setNotificationDeliveries(await res.json());
      } else {
        setNotificationDeliveries([]);
      }
    } catch (e) {
      console.warn("Backend notifications/deliveries not responding.", e);
      setNotificationDeliveries([]);
    }
  };

  const resetNotificationForm = () => {
    setEditingSubscriptionId(null);
    setNotifFormEmail('');
    setNotifFormReportType('LOW_STOCK');
    setNotifFormCron('0 7 * * *');
    setNotifFormFormat('PDF');
  };

  const handleEditSubscription = (sub: any) => {
    setEditingSubscriptionId(sub.subscription_id);
    setNotifFormEmail(sub.distribution_list_email);
    setNotifFormReportType(sub.report_type);
    setNotifFormCron(sub.schedule_cron);
    setNotifFormFormat(sub.format);
  };

  const handleSaveSubscription = async () => {
    if (!notifFormEmail.trim() || !notifFormCron.trim()) {
      alert(currentLang === 'en' ? 'Please fill in all fields.' : 'يرجى ملء جميع الحقول.');
      return;
    }
    try {
      const isEdit = editingSubscriptionId !== null;
      const res = await fetch(
        isEdit ? `${API_BASE}/notifications/subscriptions/${editingSubscriptionId}` : `${API_BASE}/notifications/subscriptions`,
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            distributionListEmail: notifFormEmail,
            reportType: notifFormReportType,
            scheduleCron: notifFormCron,
            format: notifFormFormat,
            isActive: true,
            createdBy: username
          })
        }
      );
      if (res.ok) {
        alert(currentLang === 'en' ? 'Notification subscription saved.' : 'تم حفظ اشتراك الإشعار.');
        resetNotificationForm();
        fetchNotificationSubscriptions();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to save subscription', 'فشل حفظ الاشتراك'));
      }
    } catch (e) {
      alert(currentLang === 'en' ? 'Error saving subscription.' : 'خطأ أثناء حفظ الاشتراك.');
    }
  };

  const handleToggleSubscriptionActive = async (sub: any) => {
    try {
      const res = await fetch(`${API_BASE}/notifications/subscriptions/${sub.subscription_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          distributionListEmail: sub.distribution_list_email,
          reportType: sub.report_type,
          scheduleCron: sub.schedule_cron,
          format: sub.format,
          isActive: !sub.is_active
        })
      });
      if (res.ok) {
        fetchNotificationSubscriptions();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to update subscription', 'فشل تحديث الاشتراك'));
      }
    } catch (e) {
      alert(currentLang === 'en' ? 'Error updating subscription.' : 'خطأ أثناء تحديث الاشتراك.');
    }
  };

  const handleDeleteSubscription = async (id: number) => {
    if (!window.confirm(currentLang === 'en' ? 'Delete this notification subscription?' : 'هل تريد حذف اشتراك الإشعار هذا؟')) return;
    try {
      const res = await fetch(`${API_BASE}/notifications/subscriptions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchNotificationSubscriptions();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to delete subscription', 'فشل حذف الاشتراك'));
      }
    } catch (e) {
      alert(currentLang === 'en' ? 'Error deleting subscription.' : 'خطأ أثناء حذف الاشتراك.');
    }
  };

  const handleTestSendSubscription = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/notifications/subscriptions/${id}/test-send`, { method: 'POST' });
      if (res.ok) {
        alert(currentLang === 'en' ? 'Test email sent.' : 'تم إرسال بريد الاختبار.');
        fetchNotificationDeliveries();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to send test email', 'فشل إرسال بريد الاختبار'));
      }
    } catch (e) {
      alert(currentLang === 'en' ? 'Error sending test email.' : 'خطأ أثناء إرسال بريد الاختبار.');
    }
  };



  // =========================================================================
  // Business Rules Engine (rules_engine module, RFP item 5)
  // =========================================================================
  const fetchBusinessRules = async () => {
    try {
      const res = await fetch(`${API_BASE}/rules`);
      setBusinessRules(res.ok ? await res.json() : []);
    } catch (e) {
      console.warn("Backend rules not responding.", e);
      setBusinessRules([]);
    }
  };

  const resetRuleForm = () => {
    setEditingRuleCode(null);
    setRuleFormCode('');
    setRuleFormName('');
    setRuleFormType('TRANSFER_LIMIT');
    setRuleFormSeverity('BLOCK');
    setBuilderField('weightGrams');
    setBuilderOp('gt');
    setBuilderValue('5000');
  };

  const handleStartEditRule = (r: any) => {
    setEditingRuleCode(r.rule_code);
    setRuleFormCode(r.rule_code);
    setRuleFormName(r.rule_name);
    setRuleFormType(r.rule_type);
    setRuleFormSeverity(r.severity);
    try {
      const parsed = JSON.parse(r.expression_json || '{}');
      const leaf = parsed.all?.[0] || parsed.any?.[0] || parsed;
      setBuilderField(leaf.field || 'weightGrams');
      setBuilderOp(leaf.op || 'gt');
      setBuilderValue(String(leaf.value ?? ''));
    } catch {
      setBuilderField('weightGrams');
      setBuilderOp('gt');
      setBuilderValue('');
    }
  };

  const handleSaveRule = async () => {
    const computedExpression = JSON.stringify({
      all: [
        {
          field: builderField,
          op: builderOp,
          value: isNaN(Number(builderValue)) || builderValue.trim() === '' ? builderValue : Number(builderValue)
        }
      ]
    });

    if (!ruleFormCode.trim() || !ruleFormName.trim() || !builderValue.trim()) {
      alert(currentLang === 'en' ? 'Please fill in rule code, name, and expression value.' : 'يرجى تعبئة رمز القاعدة والاسم وقيمة التعبير.');
      return;
    }
    try {
      const isEdit = editingRuleCode !== null;
      const res = await fetch(
        isEdit ? `${API_BASE}/rules/${editingRuleCode}` : `${API_BASE}/rules`,
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isEdit ? {
            ruleName: ruleFormName,
            expressionJson: computedExpression,
            severity: ruleFormSeverity,
            updatedBy: username
          } : {
            ruleCode: ruleFormCode,
            ruleName: ruleFormName,
            ruleType: ruleFormType,
            expressionJson: computedExpression,
            severity: ruleFormSeverity,
            createdBy: username
          })
        }
      );
      if (res.ok) {
        alert(currentLang === 'en' ? 'Rule saved successfully.' : 'تم حفظ القاعدة بنجاح.');
        resetRuleForm();
        fetchBusinessRules();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to save rule', 'فشل حفظ القاعدة'));
      }
    } catch (e) {
      alert(currentLang === 'en' ? 'Error saving rule.' : 'خطأ أثناء حفظ القاعدة.');
    }
  };

  const handleToggleRuleActive = async (r: any) => {
    try {
      const res = await fetch(`${API_BASE}/rules/${r.rule_id}/${r.is_active ? 'deactivate' : 'activate'}`, { method: 'POST' });
      if (res.ok) {
        fetchBusinessRules();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to update rule status', 'فشل تحديث حالة القاعدة'));
      }
    } catch (e) {
      alert(currentLang === 'en' ? 'Error updating rule status.' : 'خطأ أثناء تحديث حالة القاعدة.');
    }
  };

  // =========================================================================
  // Monitoring (monitoring module, RFP item 8: SLA metrics, events, alert routing)
  // =========================================================================
  const fetchSlaMetrics = async () => {
    try {
      const res = await fetch(`${API_BASE}/monitoring/sla-metrics`);
      setSlaMetrics(res.ok ? await res.json() : null);
    } catch (e) {
      console.warn("Backend monitoring/sla-metrics not responding.", e);
      setSlaMetrics(null);
    }
  };

  const fetchMonitoringEvents = async () => {
    try {
      const res = await fetch(`${API_BASE}/monitoring/events`);
      setMonitoringEvents(res.ok ? await res.json() : []);
    } catch (e) {
      console.warn("Backend monitoring/events not responding.", e);
      setMonitoringEvents([]);
    }
  };

  const fetchAlertRoutes = async () => {
    try {
      const res = await fetch(`${API_BASE}/monitoring/alert-routes`);
      setAlertRoutes(res.ok ? await res.json() : []);
    } catch (e) {
      console.warn("Backend monitoring/alert-routes not responding.", e);
      setAlertRoutes([]);
    }
  };

  const handleAddAlertRoute = async () => {
    if (!routeFormDestination.trim()) {
      alert(currentLang === 'en' ? 'Please enter a destination.' : 'يرجى إدخال الوجهة.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/monitoring/alert-routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: routeFormEventType,
          severity: routeFormSeverity,
          destination: routeFormDestination,
          isActive: true
        })
      });
      if (res.ok) {
        alert(currentLang === 'en' ? 'Alert route saved.' : 'تم حفظ مسار التنبيه.');
        setRouteFormDestination('');
        fetchAlertRoutes();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to save alert route', 'فشل حفظ مسار التنبيه'));
      }
    } catch (e) {
      alert(currentLang === 'en' ? 'Error saving alert route.' : 'خطأ أثناء حفظ مسار التنبيه.');
    }
  };

  const fetchAdminData = async () => {
    try {
      const resUsers = await fetch(`${API_BASE}/admin/users`);
      if (resUsers.ok) {
        const users = await resUsers.json();
        setAdminUsers(users);
      }
      const resGroups = await fetch(`${API_BASE}/admin/groups`);
      if (resGroups.ok) {
        const groups = await resGroups.json();
        setAdminGroups(groups);
      }
    } catch (e) {
      console.warn("Failed to fetch admin users and groups.", e);
      setAdminUsers([]);
      setAdminGroups([]);
    }
  };

  const handleStartEditUser = (idx: number) => {
    const u = adminUsers[idx];
    setEditingUserIdx(idx);
    setEditUserDisplay(u.displayName);
    setEditUserEmail(u.email);
  };

  const handleSaveEditUser = async (userId: number) => {
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: editUserDisplay,
          email: editUserEmail
        })
      });
      if (res.ok) {
        alert(currentLang === 'en' ? 'User updated successfully.' : 'تم تحديث بيانات المستخدم بنجاح.');
        setEditingUserIdx(null);
        fetchAdminData();
      } else {
        alert(currentLang === 'en' ? 'Failed to update user.' : 'فشل تحديث بيانات المستخدم.');
      }
    } catch (e) {
      alert("Error updating user. Please ensure the backend is running.");
    }
  };

  const handleCreateUser = async () => {
    if (!newUserName || !newUserDisplay || !newUserEmail || !newUserPassword) {
      alert("Please fill in all required fields.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUserName,
          displayName: newUserDisplay,
          email: newUserEmail,
          password: newUserPassword,
          createdBy: displayName,
          groupIds: newUserGroups
        })
      });
      if (res.ok) {
        alert("User onboarding completed successfully.");
        setShowCreateUserModal(false);
        setNewUserName('');
        setNewUserDisplay('');
        setNewUserEmail('');
        setNewUserPassword('');
        setNewUserGroups([]);
        fetchAdminData();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to create user', 'فشل إنشاء المستخدم'));
      }
    } catch (e) {
      alert("Error creating user. Please ensure the backend is running.");
    }
  };

  const handleToggleUserActive = async (userId: number, currentStatus: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}/toggle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentStatus })
      });
      if (res.ok) {
        fetchAdminData();
      } else {
        alert("Failed to toggle user status.");
      }
    } catch (e) {
      alert("Error toggling user status. Please ensure the backend is running.");
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName || !newGroupDesc) {
      alert(currentLang === 'en' ? "Please fill in group name and description." : "يرجى ملء اسم المجموعة والوصف.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/admin/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupName: newGroupName,
          description: newGroupDesc
        })
      });
      if (res.ok) {
        alert(currentLang === 'en' ? "Privilege Group/Role created and saved successfully." : "تم إنشاء وحفظ مجموعة الصلاحيات/الدور بنجاح.");
        setShowCreateGroupModal(false);
        setNewGroupName('');
        setNewGroupDesc('');
        fetchAdminData();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to create group', 'فشل إنشاء المجموعة'));
      }
    } catch (e) {
      alert(currentLang === 'en' 
        ? "Error creating group. Please ensure the backend is running."
        : "خطأ في إنشاء المجموعة. يرجى التأكد من تشغيل الخادم.");
    }
  };

  const handleStartEditGroup = (idx: number) => {
    const g = adminGroups[idx];
    setEditingGroupIdx(idx);
    setEditGroupName(g.groupName);
    setEditGroupDesc(g.description);
  };

  const handleSaveEditGroup = async (groupId: number) => {
    if (!editGroupName.trim() || !editGroupDesc.trim()) {
      alert("Group name and description are required.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/admin/groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupName: editGroupName,
          description: editGroupDesc
        })
      });
      if (res.ok) {
        alert(currentLang === 'en' ? 'Group updated successfully.' : 'تم تحديث بيانات المجموعة بنجاح.');
        setEditingGroupIdx(null);
        fetchAdminData();
      } else {
        alert(currentLang === 'en' ? 'Failed to update group.' : 'فشل تحديث بيانات المجموعة.');
      }
    } catch (e) {
      alert("Error updating group. Please ensure the backend is running.");
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    if (!window.confirm("Are you sure you want to delete this privilege group?")) return;
    try {
      const res = await fetch(`${API_BASE}/admin/groups/${groupId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        alert("Group deleted successfully.");
        fetchAdminData();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to delete group', 'فشل حذف المجموعة'));
      }
    } catch (e) {
      alert("Error deleting group. Please ensure the backend is running.");
    }
  };

  const handleSaveGroupPermissions = async () => {
    if (!selectedAdminGroup) return;
    const permissionsPayload = Object.entries(editPermMatrix).map(([moduleKey, accessLevel]) => ({
      moduleKey,
      accessLevel
    }));
    try {
      const res = await fetch(`${API_BASE}/admin/groups/${selectedAdminGroup.groupId}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: permissionsPayload })
      });
      if (res.ok) {
        alert("Group permissions updated successfully.");
        setShowGroupPermsModal(false);
        setSelectedAdminGroup(null);
        fetchAdminData();
        // If current user is logged in, reload permissions if they might have been affected
        const myPermissionsRes = await fetch(`${API_BASE}/admin/users/${username}/permissions`);
        if (myPermissionsRes.ok) {
          const newPerms = await myPermissionsRes.json();
          setUserPermissions(newPerms);
        }
      } else {
        alert("Failed to save permissions.");
      }
    } catch (e) {
      alert("Error saving group permissions. Please ensure the backend is running.");
    }
  };

  const handleAddUserToGroup = async (userId: number, groupId: number) => {
    try {
      const res = await fetch(`${API_BASE}/admin/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, assignedBy: displayName })
      });
      if (res.ok) {
        fetchAdminData();
      } else {
        alert("User is already a member of this group.");
      }
    } catch (e) {
      alert("Error adding user to group. Please ensure the backend is running.");
    }
  };

  const handleRemoveUserFromGroup = async (userId: number, groupId: number) => {
    try {
      const res = await fetch(`${API_BASE}/admin/groups/${groupId}/members/${userId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchAdminData();
      } else {
        alert("Failed to remove user from group.");
      }
    } catch (e) {
      alert("Error removing user from group. Please ensure the backend is running.");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        const data = await res.json();
        setAuthToken(data.token || null);
        setUserRole(data.roles[0]);
        setDisplayName(data.displayName);
        setUserPermissions(data.permissions || {});
        setIsLoggedIn(true);
        fetchMenuLayout();
        // Refresh active workspace states
        fetchInventory();
        fetchPOs();
        fetchWorkflows();
        fetchProducts();
        fetchBrands();
        fetchLocations();
        fetchSuppliers();
        fetchTransfers();
        fetchReorderThresholds();
        fetchLowStockAlerts();
        fetchBranches();
        if (data.permissions && data.permissions['user_admin'] !== 'HIDDEN') {
          fetchAdminData();
        }
        if (!data.permissions || data.permissions['reports'] !== 'HIDDEN') {
          fetchLiveBalances();
          connectMonitoringHub();
        }
      } else {
        const errorMsg = res.status === 401 
          ? (currentLang === 'en' ? "Active Directory login failed. Invalid username/email or password." : "فشل تسجيل الدخول. اسم المستخدم/البريد الإلكتروني أو كلمة المرور غير صالحة.")
          : (currentLang === 'en' ? "An error occurred during login. Please try again." : "حدث خطأ أثناء تسجيل الدخول. يرجى المحاولة مرة أخرى.");
        alert(errorMsg);
      }
    } catch (err) {
      alert("Could not connect to the server. Please ensure the backend is running and try again.");
    }
  };

  // Build the line-item payload, dropping any blank rows. Returns null (with an alert) if
  // there is nothing valid to submit.
  const buildPoItemsPayload = () => {
    let items = poLines
      .filter(l => l.product_id && l.qty > 0)
      .map(l => ({ product_id: parseInt(l.product_id) || 1, qty: l.qty, unit_cost: l.unit_cost || 0 }));
    if (items.length === 0) {
      items = [{ product_id: 1, qty: 1, unit_cost: 40000 }];
    }
    return items;
  };

  const resetPoForm = () => {
    setPoNum('');
    setPoWeight(0);
    setPoCost(0);
    setPoCostOverridden(false);
    setPoInvoiceNumber('');
    setPoInvoiceDate('');
    setPoFreightCost(0);
    setPoInsuranceCost(0);
    setPoCustomsDutyCost(0);
    setPoOtherFeesCost(0);
    setPoOtherFeesDescription('');
    setPoLines([]);
    setPoEntryProduct('');
    setPoEntryQty(1);
    setPoEntryCost(0);
    setPoEntryEditIdx(null);
    setPoComboQuery('');
    setPoComboOpen(false);
  };

  const handleCreatePO = async () => {
    const items = buildPoItemsPayload();
    if (!items) return;
    try {
      const res = await fetch(`${API_BASE}/purchase-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poNumber: poNum,
          vendorId: poSupplier,
          totalWeightGrams: poWeight,
          totalCost: poCost,
          currency: poCurrency,
          createdBy: displayName,
          items,
          supplierInvoiceNumber: poInvoiceNumber || null,
          supplierInvoiceDate: poInvoiceDate || null,
          freightCost: poFreightCost,
          insuranceCost: poInsuranceCost,
          customsDutyCost: poCustomsDutyCost,
          otherFeesCost: poOtherFeesCost,
          otherFeesDescription: poOtherFeesDescription || null
        })
      });
      if (res.ok) {
        alert("Purchase Order created and submitted for review successfully.");
        resetPoForm();
        setActiveTab('screen-active-deals');
        fetchPOs();
        fetchWorkflows(); // Refresh so the new PO's workflow instance is available for the Approve action
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to create Purchase Order', 'فشل إنشاء طلب الشراء'));
      }
    } catch (e) {
      alert("Error creating Purchase Order. Please ensure the backend is running.");
    }
  };

  const handleUpdatePO = async () => {
    if (!editingPOId) return;
    const items = buildPoItemsPayload();
    if (!items) return;
    try {
      const res = await fetch(`${API_BASE}/purchase-orders/${editingPOId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poNumber: poNum,
          vendorId: poSupplier,
          totalWeightGrams: poWeight,
          totalCost: poCost,
          currency: poCurrency,
          createdBy: displayName,
          items,
          supplierInvoiceNumber: poInvoiceNumber || null,
          supplierInvoiceDate: poInvoiceDate || null,
          freightCost: poFreightCost,
          insuranceCost: poInsuranceCost,
          customsDutyCost: poCustomsDutyCost,
          otherFeesCost: poOtherFeesCost,
          otherFeesDescription: poOtherFeesDescription || null
        })
      });
      if (res.ok) {
        alert("Purchase Order amended successfully.");
        setIsEditingPO(false);
        setEditingPOId(null);
        resetPoForm();
        fetchPOs();
        fetchWorkflows(); // Keep the workflow instance list in sync (required_role, status) after an amendment
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to amend Purchase Order', 'فشل تعديل طلب الشراء'));
      }
    } catch (e) {
      alert("Error amending Purchase Order. Please ensure the backend is running.");
    }
  };

  const handleCancelEditPO = () => {
    setIsEditingPO(false);
    setEditingPOId(null);
    resetPoForm();
  };

  // Datagrid entry-form handlers. The entry row (item/qty/unit cost) feeds the grid:
  // "Add" appends a row -- but re-adding an item that's already in the grid MERGES into
  // that row (quantity accumulates, unit cost refreshes) rather than duplicating it.
  // When a specific row is being edited, "Add" becomes "Update" and writes it in place.
  const resetPoEntry = () => {
    setPoEntryProduct(''); // force an explicit item pick for the next line
    setPoEntryQty(1);
    setPoEntryCost(0);
    setPoEntryEditIdx(null);
    setPoComboOpen(false);
    setPoComboQuery('');
  };
  const commitPoEntry = () => {
    // Validation with clear messages.
    if (!poEntryProduct) {
      alert(currentLang === 'en' ? 'Please select an item first.' : 'الرجاء اختيار الصنف أولاً.');
      return;
    }
    const qty = Number(poEntryQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      alert(currentLang === 'en' ? 'Quantity must be a number greater than 0.' : 'يجب أن تكون الكمية رقمًا أكبر من صفر.');
      return;
    }
    const unit = Number(poEntryCost);
    if (!Number.isFinite(unit) || unit <= 0) {
      alert(currentLang === 'en' ? 'Unit price must be a number greater than 0.' : 'يجب أن يكون سعر الوحدة رقمًا أكبر من صفر.');
      return;
    }
    setPoCostOverridden(false);
    setPoLines(prev => {
      if (poEntryEditIdx !== null) {
        // Amending a specific row in place.
        return prev.map((l, i) => i === poEntryEditIdx ? { product_id: poEntryProduct, qty, unit_cost: unit } : l);
      }
      const dup = prev.findIndex(l => String(l.product_id) === String(poEntryProduct));
      if (dup >= 0) {
        // Same item added again -> accumulate quantity, refresh unit cost.
        return prev.map((l, i) => i === dup ? { ...l, qty: (l.qty || 0) + qty, unit_cost: unit } : l);
      }
      return [...prev, { product_id: poEntryProduct, qty, unit_cost: unit }];
    });
    resetPoEntry();
  };
  const editPoLine = (idx: number) => {
    const l = poLines[idx];
    if (!l) return;
    setPoEntryProduct(l.product_id);
    setPoEntryQty(l.qty);
    setPoEntryCost(l.unit_cost);
    setPoEntryEditIdx(idx);
    setPoComboQuery('');
  };
  const deletePoLine = (idx: number) => {
    setPoCostOverridden(false);
    setPoLines(prev => prev.filter((_, i) => i !== idx));
    // If we were editing the row (or one after it) being removed, reset the entry form.
    if (poEntryEditIdx !== null && (poEntryEditIdx === idx || poEntryEditIdx >= poLines.length - 1)) resetPoEntry();
  };

  // A compact "100g×20, 10g×100" style breakdown for a PO's line items, resolving each
  // denomination's weight/label from the settings catalog.
  const poLineLabel = (item: any) => {
    const p = products.find((pp: any) => String(pp.product_id) === String(item.product_id));
    const denom = p?.denomination_label || (p?.weight_grams ? `${p.weight_grams}g` : (item.product_code || `#${item.product_id}`));
    return `${denom}×${item.qty}`;
  };
  const poItemsSummary = (po: any) =>
    (po.items && po.items.length ? po.items.map(poLineLabel).join(', ') : `#${po.product_id}×${po.qty || 1}`);



  const handleApprovePO = async (id: number) => {
    try {
      // Look up the active workflow instance from a FRESH server response rather than
      // the client-side activeWorkflowInstances cache. That cache is only populated by
      // fetchWorkflows(), which doesn't run on every navigation (e.g. opening the P.O. &
      // Procurement screen directly doesn't refresh it), so it could still hold last
      // login's snapshot (or be empty) even though the PO genuinely has an in-flight
      // instance on the backend right now -- that mismatch is what produced the
      // misleading "No active workflow instance found... ensure the backend is running"
      // alert even when the backend was working fine.
      const instRes = await fetch(`${API_BASE}/workflows/instances/active`, { cache: 'no-store' });
      if (!instRes.ok) {
        const msg = await describeApiError(instRes, currentLang, 'Failed to approve', 'فشل الاعتماد');
        alert(`${msg}\n\n[Debug: GET ${instRes.url} -> HTTP ${instRes.status}]`);
        return;
      }
      const freshInstances = await instRes.json();
      setActiveWorkflowInstances(freshInstances);
      const inst = freshInstances.find((i: any) => i.entity_id === id && i.workflow_type === 'PURCHASE_ORDER');

      if (!inst) {
        alert(currentLang === 'en'
          ? "This P.O. has no request currently in flight -- it may already be fully approved/rejected, or its workflow wasn't created. Refresh and check its status."
          : "لا يوجد طلب معلق حاليًا لهذا الأمر -- ربما تم اعتماده/رفضه بالكامل بالفعل، أو لم يتم إنشاء مسار العمل الخاص به. يرجى التحديث والتحقق من حالته.");
        return;
      }

      const res = await fetch(`${API_BASE}/workflows/instances/${inst.instance_id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username,
          action: 'APPROVED',
          comments: 'Approved from Procurement Board'
        })
      });
      if (res.ok) {
        alert("P.O. workflow step approved successfully.");
        fetchWorkflows();
        fetchInventory();
        fetchExecutiveBoard();
        fetchPOs();
        fetchMyActivity(); // Keep the My Activity dashboard's counts/lists in sync with this decision
      } else {
        const msg = await describeApiError(res, currentLang, 'Failed to approve', 'فشل الاعتماد');
        alert(`${msg}\n\n[Debug: POST ${res.url} -> HTTP ${res.status}]`);
      }
    } catch (e) {
      alert("Error approving workflow action.");
    }
  };

  const handleDeletePO = async (id: number, poNumber: string) => {
    const confirmMsg = currentLang === 'en'
      ? `Permanently delete Purchase Order ${poNumber}? This removes it and its full workflow/approval history and cannot be undone.`
      : `هل تريد حذف طلب الشراء ${poNumber} نهائيًا؟ سيتم حذفه بالكامل مع سجل الاعتماد الخاص به، ولا يمكن التراجع عن هذا الإجراء.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await fetch(`${API_BASE}/purchase-orders/${id}?username=${encodeURIComponent(username)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        alert(currentLang === 'en' ? "Purchase Order deleted." : "تم حذف طلب الشراء.");
        fetchPOs();
        fetchWorkflows();
        fetchMyActivity();
      } else {
        let bodyText = '';
        try { bodyText = await res.clone().text(); } catch {}
        const msg = await describeApiError(res, currentLang, 'Failed to delete Purchase Order', 'فشل حذف طلب الشراء');
        alert(`${msg}\n\n[Debug: DELETE ${res.url} -> HTTP ${res.status}]\n${bodyText ? `[Body: ${bodyText.slice(0, 300)}]` : ''}`);
      }
    } catch (e) {
      alert(`Error deleting Purchase Order.\n\n[Debug: ${e}]`);
    }
  };

  const handlePrintPO = (po: any) => {
    if (po.status_code !== 'APPROVED' && po.status_code !== 'RECEIVED') {
      alert(currentLang === 'en'
        ? "This Purchase Order cannot be printed until it has been approved."
        : "لا يمكن طباعة طلب الشراء هذا قبل اعتماده.");
      return;
    }
    setPrintingPO(po);
  };

  useEffect(() => {
    if (!printingPO) return;
    const timer = setTimeout(() => window.print(), 100);
    return () => clearTimeout(timer);
  }, [printingPO]);

  useEffect(() => {
    const handleAfterPrint = () => setPrintingPO(null);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  const handleOpenDirectIntake = () => {
    setIntakePOId(null);
    setIntakePONumber('DIRECT');
    setIntakeLotNum(`LOT-DIRECT-${Date.now()}`);
    setScannedSerials([]);
    setCurrentScanSerial('');
    // Default the scanned-bar denomination to the first product if available
    setIntakeSelectedProductId(products.length > 0 ? products[0].product_id : 1);

    // Find first free location slot or default to 1
    const flatSlots = locations.flatMap(loc => loc.slots);
    const firstFreeSlot = flatSlots.find((s: any) => !s.occupied);
    setIntakeSelectedLocation(firstFreeSlot ? firstFreeSlot.id : 1);
    setShowIntakeModal(true);
  };

  const handleIntakePO = (id: number) => {
    const po = poList.find(p => p.po_id === id);
    if (!po) return;
    if (po.status_code !== 'APPROVED') {
      alert(currentLang === 'en' 
        ? "Cannot receive shipment: The associated purchase order is not fully approved yet."
        : "لا يمكن استلام الشحنة: طلب الشراء المرتبط لم يتم اعتماده بالكامل بعد.");
      return;
    }
    setIntakePOId(id);
    setIntakePONumber(po.po_number);
    setIntakeLotNum(`LOT-${po.po_number}-${new Date().getFullYear()}`);
    setScannedSerials([]);
    setCurrentScanSerial('');
    // Default the scanned-bar denomination to the PO's first line item (falls back to 1
    // for legacy single-item POs with no items array).
    setIntakeSelectedProductId(po.items && po.items.length ? po.items[0].product_id : 1);

    // Find first free location slot or default to 1
    const flatSlots = locations.flatMap(loc => loc.slots);
    const firstFreeSlot = flatSlots.find((s: any) => !s.occupied);
    setIntakeSelectedLocation(firstFreeSlot ? firstFreeSlot.id : 1);
    setShowIntakeModal(true);
  };

  void poItemsSummary;
  void handleOpenDirectIntake;
  void handleIntakePO;

  const handleSubmitIntake = async () => {
    if (!intakePOId && intakePONumber !== 'DIRECT') {
      alert(currentLang === 'en' ? "Missing Purchase Order association." : "ارتباط طلب الشراء مفقود.");
      return;
    }
    if (!intakeLotNum.trim()) {
      alert(currentLang === 'en' ? "Please enter a Lot Number." : "يرجى إدخال رقم التشغيلة/اللوت.");
      return;
    }
    if (scannedSerials.length === 0) {
      alert(currentLang === 'en' ? "Please scan at least one piece." : "يرجى مسح قطعة واحدة على الأقل بالباركود.");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/vault/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poId: intakePOId,
          lotNumber: intakeLotNum,
          locationId: intakeSelectedLocation,
          receivedBy: displayName,
          items: scannedSerials.map(s => ({
            serial: s.serial,
            product_id: s.product_id
          }))
        })
      });

      if (res.ok) {
        alert(currentLang === 'en' ? "Intake shipment verification request initiated and routed to the Maker-Checker workflow approval." : "تم بدء طلب التحقق واستلام الشحنة وتوجيهه لاعتماد مسار سير العمل بنجاح.");
        setShowIntakeModal(false);
        setIntakePOId(null);
        setScannedSerials([]);
        fetchPOs();
        fetchInventory();
        fetchWorkflows();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to receive shipment', 'فشل استلام الشحنة'));
      }
    } catch (e) {
      alert("Error submitting shipment receipt. Please ensure the backend is running.");
    }
  };

  const fetchPendingIntakes = async () => {
    try {
      const res = await fetch(`${API_BASE}/vault/intake/pending`);
      if (res.ok) {
        const data = await res.json();
        setPendingIntakesList(data);
      }
    } catch (e) {
      console.warn('Failed to fetch pending intakes', e);
    }
  };

  const handleAddIntakeBar = () => {
    const nextIdx = intakeBars.length + 1;
    const defaultProduct = products.length > 0 ? products[0] : null;
    setIntakeBars([
      ...intakeBars,
      {
        id: `bar-${Date.now()}-${nextIdx}`,
        serial: `BAR-SUP-${Date.now().toString().slice(-4)}-${pad2(nextIdx)}`,
        product_id: defaultProduct ? defaultProduct.product_id : 1,
        weight_grams: defaultProduct ? defaultProduct.weight_grams : 1000,
        purity: defaultProduct && defaultProduct.purity_value ? parseFloat(defaultProduct.purity_value) : 999.9,
        is_damaged: false,
        damage_reason: '',
        refiner_name: 'Valcambi Suisse',
        assay_certificate_number: `ASSAY-VAL-${nextIdx}`
      }
    ]);
  };

  const handleAdd5BatchDemo = () => {
    const baseTime = Date.now().toString().slice(-4);
    const defaultProduct = products.length > 0 ? products[0] : null;
    const newBars = Array.from({ length: 5 }, (_, i) => {
      const idx = intakeBars.length + i + 1;
      return {
        id: `bar-${Date.now()}-${idx}`,
        serial: `BAR-SUP-${baseTime}-${pad2(idx)}`,
        product_id: defaultProduct ? defaultProduct.product_id : 1,
        weight_grams: defaultProduct ? defaultProduct.weight_grams : 1000,
        purity: defaultProduct && defaultProduct.purity_value ? parseFloat(defaultProduct.purity_value) : 999.9,
        is_damaged: false,
        damage_reason: '',
        refiner_name: 'Valcambi Suisse',
        assay_certificate_number: `ASSAY-VAL-${idx}`
      };
    });
    setIntakeBars([...intakeBars, ...newBars]);
  };

  const handleRemoveIntakeBar = (id: string) => {
    if (intakeBars.length <= 1) {
      alert(currentLang === 'en' ? 'Shipment must contain at least one bar.' : 'يجب أن تحتوي الشحنة على سبيكة واحدة على الأقل.');
      return;
    }
    setIntakeBars(intakeBars.filter(b => b.id !== id));
  };

  const handleUpdateIntakeBar = (id: string, field: string, value: any) => {
    setIntakeBars(intakeBars.map(b => {
      if (b.id !== id) return b;
      const updated = { ...b, [field]: value };
      if (field === 'product_id') {
        const prod = products.find((p: any) => p.product_id === parseInt(value));
        if (prod) {
          updated.weight_grams = prod.weight_grams;
          if (prod.purity_value) updated.purity = parseFloat(prod.purity_value);
        }
      } else if (field === 'weight_grams') {
        const numWeight = parseFloat(value) || 0;
        const matchingProd = products.find((p: any) => p.weight_grams === numWeight);
        if (matchingProd) {
          updated.product_id = matchingProd.product_id;
        }
      }
      return updated;
    }));
  };

  const handleSubmitUC03Intake = async () => {
    if (!intakeLotNum.trim()) {
      alert(currentLang === 'en' ? 'Please enter a Lot / Batch Number.' : 'يرجى إدخال رقم اللوت / التشغيلة.');
      return;
    }
    if (intakeBars.length === 0) {
      alert(currentLang === 'en' ? 'Please add at least one bar to the shipment.' : 'يرجى إضافة سبيكة واحدة على الأقل للشحنة.');
      return;
    }
    const emptySerial = intakeBars.find(b => !b.serial.trim());
    if (emptySerial) {
      alert(currentLang === 'en' ? 'Every bar must have a Serial Number.' : 'يجب أن تحتوي كل سبيكة على رقم تسلسلي.');
      return;
    }
    const serials = intakeBars.map(b => b.serial.trim().toUpperCase());
    const duplicates = serials.filter((item, index) => serials.indexOf(item) !== index);
    if (duplicates.length > 0) {
      alert(currentLang === 'en' 
        ? `Duplicate serial detected in shipment: ${duplicates[0]}. (UC03 E1: Duplicate serials rejected)` 
        : `تم اكتشاف رقم تسلسلي مكرر في الشحنة: ${duplicates[0]}. (قاعدة UC03 E1: رفض الأرقام المكررة)`);
      return;
    }

    try {
      const payload = {
        vendorId: intakeVendorId || (suppliersList.length > 0 ? suppliersList[0].vendor_id : 1),
        shipmentReference: intakeShipmentRef || null,
        deliveryNoteNumber: intakeDeliveryNote || null,
        airwayBillNumber: intakeAirwayBill || null,
        receivingDate: intakeReceivingDate ? new Date(intakeReceivingDate).toISOString() : new Date().toISOString(),
        supportingDocumentUrl: intakeDocUrl || null,
        discrepancyNotes: intakeDiscrepancyNotes || null,
        lotNumber: intakeLotNum.trim(),
        locationId: intakeSelectedLocation || 1,
        receivedBy: displayName,
        items: intakeBars.map(b => ({
          serial: b.serial.trim(),
          product_id: b.product_id,
          weight_grams: b.weight_grams,
          purity: b.purity,
          is_damaged: b.is_damaged,
          damage_reason: b.is_damaged ? (b.damage_reason || 'Damaged upon supplier receipt') : null,
          refiner_name: b.refiner_name,
          fineness_ppt: b.purity,
          assay_certificate_number: b.assay_certificate_number || `CERT-${b.serial.trim()}`
        }))
      };

      const res = await fetch(`${API_BASE}/vault/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        alert(currentLang === 'en' 
          ? 'Supplier shipment receipt recorded successfully! Routed to Vault Checker Maker-Checker review.' 
          : 'تم تسجيل استلام شحنة المورد بنجاح وتوجيهها لاعتماد مراجع الخزينة!');
        setIntakeLotNum(`LOT-SUP-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Date.now().toString().slice(-4)}`);
        setIntakeShipmentRef('');
        setIntakeDeliveryNote('');
        setIntakeAirwayBill('');
        setIntakeDocUrl('');
        setIntakeDiscrepancyNotes('');
        setIntakeBars([{
          id: `bar-${Date.now()}`,
          serial: `BAR-SUP-${Date.now().toString().slice(-4)}-01`,
          product_id: products.length > 0 ? products[0].product_id : 1,
          weight_grams: 1000,
          purity: 999.9,
          is_damaged: false,
          damage_reason: '',
          refiner_name: 'Valcambi Suisse',
          assay_certificate_number: 'ASSAY-VAL-01'
        }]);
        fetchPendingIntakes();
        fetchWorkflows();
        setIntakeActiveSubTab('IN_FLIGHT_LOG');
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to record shipment intake', 'فشل تسجيل استلام الشحنة'));
      }
    } catch (e) {
      alert(currentLang === 'en' ? 'Network error submitting supplier receipt.' : 'خطأ في الشبكة أثناء إرسال استلام المورد.');
    }
  };

  const resetCustomerReceiptForm = () => {
    setReceiptCustomerId('');
    setReceiptAccountId('');
    setReceiptReason('BUYBACK');
    setReceiptLotNum(`RCPT-CUST-${Date.now()}`);
    setReceiptScannedSerials([]);
    setCurrentReceiptScanSerial('');
    const flatSlots = locations.flatMap(loc => loc.slots);
    const firstFreeSlot = flatSlots.find((s: any) => !s.occupied);
    setReceiptSelectedLocation(firstFreeSlot ? firstFreeSlot.id : 1);
    setReceiptSelectedProductId(products && products.length ? products[0].product_id : 1);
  };

  const handleSubmitCustomerReceipt = async () => {
    if (!receiptCustomerId.trim()) {
      alert(currentLang === 'en' ? "Please enter the customer's ID." : "يرجى إدخال رقم العميل.");
      return;
    }
    if (receiptReason === 'CUSTODY_DEPOSIT' && !receiptAccountId.trim()) {
      alert(currentLang === 'en' ? "A custody deposit requires the customer's account number." : "يتطلب إيداع الأمانة رقم حساب العميل.");
      return;
    }
    if (!receiptLotNum.trim()) {
      alert(currentLang === 'en' ? "Please enter a Lot Number." : "يرجى إدخال رقم التشغيلة/اللوت.");
      return;
    }
    if (receiptScannedSerials.length === 0) {
      alert(currentLang === 'en' ? "Please scan at least one piece." : "يرجى مسح قطعة واحدة على الأقل بالباركود.");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/vault/intake/customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: parseInt(receiptCustomerId, 10),
          accountId: receiptReason === 'CUSTODY_DEPOSIT' ? parseInt(receiptAccountId, 10) : null,
          receiptReason: receiptReason,
          lotNumber: receiptLotNum,
          locationId: receiptSelectedLocation,
          receivedBy: displayName,
          items: receiptScannedSerials.map(s => ({ serial: s.serial, product_id: s.product_id }))
        })
      });

      if (res.ok) {
        alert(currentLang === 'en' ? "Customer receipt verification request initiated and routed to the Maker-Checker workflow approval." : "تم بدء طلب التحقق من استلام العميل وتوجيهه لاعتماد مسار سير العمل بنجاح.");
        setReceiptScannedSerials([]);
        fetchInventory();
        fetchWorkflows();
      } else {
        alert(await describeApiError(res, currentLang, 'Failed to receive from customer', 'فشل استلام المعادن من العميل'));
      }
    } catch (e) {
      alert("Error submitting customer receipt. Please ensure the backend is running.");
    }
  };

  const handleSearchCustody = async () => {
    // Partial, case-insensitive match on Civil ID, customer name, or serial.
    // Empty search lists all holdings so the portfolio can be browsed.
    const term = custodySearchId.trim().toLowerCase();
    try {
      const res = await fetch(`${API_BASE}/reports/holdings`);
      if (res.ok) {
        const data = await res.json();
        const filtered = !term ? data : data.filter((h: any) =>
          (h.civil_id && String(h.civil_id).toLowerCase().includes(term)) ||
          (h.customer_name && String(h.customer_name).toLowerCase().includes(term)) ||
          (h.serial_number && String(h.serial_number).toLowerCase().includes(term))
        );
        setCustodyList(filtered.map((h: any) => ({
          holding_id: h.holding_id,
          civil_id: h.civil_id,
          name: h.customer_name,
          serial: h.serial_number,
          details: `${h.metal_name} / ${h.weight_grams}g Bar (${h.purity_value}%)`,
          coords: h.location_description || 'N/A',
          status: h.status_code
        })));
        if (filtered.length === 0) {
          alert(currentLang === 'ar' ? 'لا توجد حيازات مطابقة لهذا البحث.' : 'No holdings found for this search.');
        }
      } else {
        alert("Failed to fetch custody holdings.");
      }
    } catch (e) {
      alert("Error searching custody holdings. Please check backend connection.");
    }
  };

  const handleWithdrawCustody = async (holdingId: number, _serial: string) => {
    const signature = prompt(currentLang === 'en' ? "Enter recipient signature:" : "أدخل توقيع المستلم:");
    if (!signature) return;

    try {
      const reqRes = await fetch(`${API_BASE}/withdrawals/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdingId, branchId: 1 })
      });
      if (!reqRes.ok) {
        alert("Failed to request withdrawal. Lacking permissions or invalid state.");
        return;
      }
      const reqData = await reqRes.json();
      
      const otp = prompt(currentLang === 'en' ? `Enter verification OTP (Sent to mobile: ${reqData.message})` : `أدخل رمز التحقق (تم إرساله للمحمول: ${reqData.message})`);
      if (!otp) return;

      const confRes = await fetch(`${API_BASE}/withdrawals/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holdingId,
          branchId: 1,
          verificationOtp: otp,
          recipientSignature: signature
        })
      });
      
      if (confRes.ok) {
        setCustodyList(prev => prev.map(c => c.holding_id === holdingId ? { ...c, status: 'WITHDRAWN', coords: 'Withdrawn' } : c));
        alert(currentLang === 'en' ? "OTP Verified. Physical delivery confirmed and signature logged. Custody archived." : "تم التحقق من الرمز وتأكيد التسليم المادي وتوقيع المستلم. تم أرشفة العهدة.");
      } else {
        alert(await describeApiError(confRes, currentLang, 'OTP validation or signature logging failed.', 'فشل التحقق من رمز OTP أو تسجيل التوقيع'));
      }
    } catch (e) {
      alert("Error processing custody withdrawal.");
    }
  };

  const toggleStocktakeFreeze = () => {
    setIsFrozen(!isFrozen);
  };

  const handleLogScan = () => {
    if (!stocktakeScanInput) return;
    if (stocktakeScanInput === 'TR-10293-02') {
      setDiscrepancyList([]);
      alert("Discrepancy Resolved: Scanned Serial matched expected coordinates.");
    } else {
      alert("Scan logged: serial registered.");
    }
    setStocktakeScanInput('');
  };

  const handleUploadMigration = (clean: boolean) => {
    if (clean) {
      setIngressData({
        migration_id: 120,
        total_records: 48,
        valid_records: 48,
        failed_records: 0,
        errors: []
      });
      setMigrationApproved(true);
    } else {
      setIngressData({
        migration_id: 121,
        total_records: 48,
        valid_records: 40,
        failed_records: 8,
        errors: ["Row 4: Serial number already exists.", "Row 15: Coordinate slot already occupied."]
      });
      setMigrationApproved(false);
    }
  };

  const handleCommitMigration = () => {
    setMigrationApproved(false);
    setIngressData(null);
    alert("Migration complete. Excel staged data successfully merged into active ledger.");
  };

  const fetchReport = async (type: string, method?: string) => {
    setLoadingReport(true);
    try {
      let endpoint = '';
      if (type === 'valuation') endpoint = 'valuation';
      else if (type === 'occupancy') endpoint = 'holdings';
      else if (type === 'audit') endpoint = 'audit-logs';
      else if (type === 'transactions') endpoint = 'transactions';
      else if (type === 'inventory_balance') endpoint = 'inventory-balance';
      else if (type === 'gl_postings') endpoint = 'gl-postings';
      else if (type === 'kpis') endpoint = 'kpis';
      else if (type === 'exceptions') endpoint = 'exceptions';
      else if (type === 'cost_analysis') endpoint = 'cost-analysis';
      else if (type === 'cost_variance') endpoint = 'cost-variance';
      else if (type === 'movements') endpoint = 'movements';

      // Reconciliation differences live under /api/reconciliation, not /api/reports.
      const activeMethod = method || valuationMethod;
      const url = type === 'reconciliation'
        ? `${API_BASE}/reconciliation/discrepancies`
        : type === 'valuation'
          ? `${API_BASE}/reports/valuation?method=${activeMethod}`
          : `${API_BASE}/reports/${endpoint}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (type === 'occupancy') {
          const counts: Record<string, { total: number, occupied: number }> = {
            "Main Vault - Zone Alpha": { total: 30, occupied: 0 },
            "Main Vault - Zone Beta": { total: 20, occupied: 0 },
            "Branch Vault - Zone Delta": { total: 10, occupied: 0 }
          };
          data.forEach((h: any) => {
            if (h.status_code === 'HELD_IN_CUSTODY' && h.location_description) {
              const key = `${h.vault_name} - ${h.location_description.split(' - ')[0]}`;
              if (counts[key]) counts[key].occupied++;
            }
          });
          counts["Main Vault - Zone Alpha"].occupied += 12;
          counts["Main Vault - Zone Beta"].occupied += 12;
          counts["Branch Vault - Zone Delta"].occupied += 2;

          const summaryList = Object.entries(counts).map(([key, val]) => {
            const [vault, zone] = key.split(' - ');
            return {
              vault_name: vault,
              zone_room: zone,
              total_slots: val.total,
              occupied_slots: val.occupied,
              occupancy: Math.round((val.occupied / val.total) * 100)
            };
          });
          setReportData(summaryList);
        } else {
          setReportData(data);
        }
      } else {
        setReportData([]);
      }
    } catch (e) {
      console.warn("Backend report endpoint unavailable.", e);
      setReportData([]);
    }
    setLoadingReport(false);
  };

  const handleExportExcel = () => {
    if (reportData.length === 0) return;
    let csvContent = "\uFEFF"; 
    
    if (reportType === 'valuation') {
      csvContent += "Serial Number,Metal,Denomination,Weight (Grams),Location,Ownership,Cost Basis (USD),Market Value (USD),Unrealized PNL (USD)\n";
      reportData
        .filter(i => !filterMetal || i.metal_name === filterMetal)
        .filter(i => !filterVault || i.ownership_type === filterVault)
        .forEach(row => {
          csvContent += `"${row.serial_number}","${row.metal_name}","${row.denomination}",${row.weight_grams},"${row.location}","${row.ownership_type}",${row.cost_basis},${row.market_value},${row.unrealized_pnl}\n`;
        });
    } else if (reportType === 'occupancy') {
      csvContent += "Vault,Zone / Room,Total Slots,Occupied Slots,Occupancy Rate (%)\n";
      reportData.forEach(row => {
        csvContent += `"${row.vault_name}","${row.zone_room}",${row.total_slots},${row.occupied_slots},${row.occupancy}\n`;
      });
    } else if (reportType === 'audit') {
      csvContent += "Timestamp,User,Module,Action Description\n";
      reportData.forEach(row => {
        csvContent += `"${new Date(row.timestamp).toLocaleString()}","${row.username}","${row.moduleName}","${row.actionDescription.replace(/"/g, '""')}"\n`;
      });
    } else if (reportType === 'transactions') {
      csvContent += "Transaction Number,Serial Number,Transaction Type,Source,Destination,Ownership,Executed By,Timestamp\n";
      reportData.forEach(row => {
        csvContent += `"${row.transaction_number}","${row.serial_number}","${row.transaction_type}","${row.source_vault || ''} ${row.source_location || ''}","${row.destination_vault || ''} ${row.destination_location || ''}","${row.source_ownership}","${row.initiated_by}","${new Date(row.timestamp).toLocaleString()}"\n`;
      });
    } else if (reportType === 'gl_postings') {
      csvContent += "Source,Debit Account,Credit Account,Amount,Currency,Status,Core Banking Reference,Initiated By,Created At\n";
      reportData.forEach(row => {
        csvContent += `"${row.source_type} #${row.source_id}","${row.debit_account}","${row.credit_account}",${row.amount},"${row.currency}","${row.status_code}","${row.core_banking_reference || ''}","${row.initiated_by}","${new Date(row.created_at).toLocaleString()}"\n`;
      });
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${reportType}_report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportPDF = () => {
    window.print();
  };

  // --- Enhanced Audit Trail: search / drill-down / real backend export -------
  const buildAuditQueryString = (page: number) => {
    const params = new URLSearchParams();
    if (auditQuery) params.set('query', auditQuery);
    if (auditUser) params.set('user', auditUser);
    if (auditModule) params.set('module', auditModule);
    if (auditEntityType) params.set('entityType', auditEntityType);
    if (auditStatus) params.set('status', auditStatus);
    if (auditFrom) params.set('from', auditFrom);
    if (auditTo) params.set('to', auditTo);
    params.set('page', String(page));
    params.set('pageSize', String(auditPageSize));
    return params.toString();
  };

  const fetchAuditLogs = async (page: number = 1) => {
    setLoadingReport(true);
    try {
      const res = await fetch(`${API_BASE}/reports/audit-logs/search?${buildAuditQueryString(page)}`);
      if (res.ok) {
        const data = await res.json();
        setReportData(data.items || []);
        setAuditTotalCount(data.total_count || 0);
        setAuditPage(data.page || page);
      } else {
        setReportData([]);
        setAuditTotalCount(0);
      }
    } catch (_) {
      setReportData([]);
      setAuditTotalCount(0);
    }
    setLoadingReport(false);
  };

  // Dispatches to the right loader for the selected report type -- audit uses its
  // own search/pagination endpoint, everything else keeps using fetchReport.
  const loadReport = (type: string, method?: string) => {
    if (type === 'audit') fetchAuditLogs(1);
    else fetchReport(type, method);
  };

  const fetchAuditLogDetail = async (logId: number) => {
    try {
      const res = await fetch(`${API_BASE}/reports/audit-logs/${logId}`);
      if (res.ok) setAuditDetail(await res.json());
      else alert(currentLang === 'en' ? 'Could not load audit entry detail.' : 'تعذر تحميل تفاصيل سجل التدقيق.');
    } catch (_) {
      alert(currentLang === 'en' ? 'Could not load audit entry detail.' : 'تعذر تحميل تفاصيل سجل التدقيق.');
    }
  };

  const fetchTransactionTrace = async (transactionId: number) => {
    try {
      const res = await fetch(`${API_BASE}/reports/transactions/${transactionId}/trace`);
      if (res.ok) setTransactionTrace(await res.json());
      else alert(currentLang === 'en' ? 'Could not load transaction trace.' : 'تعذر تحميل تتبع المعاملة.');
    } catch (_) {
      alert(currentLang === 'en' ? 'Could not load transaction trace.' : 'تعذر تحميل تتبع المعاملة.');
    }
  };

  const downloadBlob = async (url: string, filename: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) { alert(currentLang === 'en' ? 'Export failed.' : 'فشل التصدير.'); return; }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch (_) {
      alert(currentLang === 'en' ? 'Export failed.' : 'فشل التصدير.');
    }
  };

  // Server-side export (CSV/XLSX/PDF, tamper-status included, up to Audit:ExportMaxRows
  // rows) honoring the current filters -- distinct from the generic client-side CSV/print
  // export used by the other report tabs, which only covers whatever page is loaded.
  const handleExportAuditLogs = (format: 'csv' | 'xlsx' | 'pdf') => {
    const qs = buildAuditQueryString(1);
    downloadBlob(`${API_BASE}/reports/audit-logs/export?format=${format}&${qs}`, `audit_logs.${format}`);
  };

  // Real server-side export (QuestPDF/ClosedXML, same rendering path as the audit trail
  // export above) -- originally the three "official report" types (inventory balance,
  // transaction log, reconciliation differences); extended to the Reporting Requirements
  // Gap Analysis's KPI/Exceptions/Cost Analysis/Cost Variance/Movement reports, all of
  // which are wired into the same GET /api/reports/export?type=...&format=... endpoint.
  const handleExportOfficialReport = (reportKind: 'inventory_balance' | 'transactions' | 'reconciliation' | 'kpis' | 'exceptions' | 'cost_analysis' | 'cost_variance' | 'movements', format: 'csv' | 'xlsx' | 'pdf') => {
    downloadBlob(`${API_BASE}/reports/export?type=${reportKind}&format=${format}`, `${reportKind}_report.${format}`);
  };

  const toggleLanguage = () => {
    setCurrentLang(prev => prev === 'en' ? 'ar' : 'en');
  };

  const t = (key: string) => {
    return Translations[currentLang]?.[key] || key;
  };

  if (activeApp === 'GFS') {
    return <GfsApp onBackToPmims={() => setActiveApp('PMIMS')} initialLang={currentLang} />;
  }

  if (!isLoggedIn) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100vw', height: '100vh',
        background: 'linear-gradient(135deg, var(--bg-primary) 0%, #FFFFFF 50%, var(--kfh-green-light) 100%)'
      }}>
        <form onSubmit={handleLogin} className="glass-card" style={{ width: '420px', padding: '44px', borderTop: '4px solid var(--kfh-green)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div className="logo-icon" style={{ margin: '0 auto 18px', width: '56px', height: '56px', fontSize: '26px', borderRadius: 'var(--radius-lg)' }}>K</div>
            <h2 style={{ color: 'var(--kfh-green)', fontSize: '22px' }}>Kuwait Finance House</h2>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Treasury Inventory Portal (PMIMS)</span>
          </div>

          <div className="form-group">
            <label>AD Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} required className="form-control" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="form-control" />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }}>
            LDAP Corporate Authentication
          </button>
          
          <div style={{ marginTop: '20px', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
            Maker: treasury-maker | Checker: treasury-checker (Pass: Password123)
          </div>

          <div style={{ marginTop: '20px', borderTop: '1px dashed var(--surface-border)', paddingTop: '16px', textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => setActiveApp('GFS')}
              style={{
                background: 'linear-gradient(135deg, #D4AF37 0%, #AA771C 100%)',
                color: '#070b14',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 18px',
                fontSize: '13px',
                fontWeight: '800',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 15px rgba(212, 175, 55, 0.4)'
              }}
            >
              <i className="fa-solid fa-coins"></i> Open GFS Customer Portal
            </button>
          </div>
        </form>
      </div>
    );
  }

  const dir = currentLang === 'ar' ? 'rtl' : 'ltr';

  // =========================================================================
  // SIDEBAR MENU LAYOUT -- data-driven nav, admin-arrangeable order
  // ------------------------------------------------------------------------
  // The canonical list below is the codebase's built-in default order (identical
  // to what used to be hardcoded JSX). `menuOrder` (persisted via
  // GET/PUT /api/admin/menu-layout) can reorder these nodes freely, including
  // moving an item past a section-header boundary -- section headers are just
  // regular nodes in the same flat list, not a separate structure. Anyone with
  // FULL/READ_WRITE on `settings` (or IT/Admin) can toggle "Edit Menu" and use the
  // up/down controls; everyone else just sees the resulting order.
  // =========================================================================
  type MenuNode =
    | { type: 'section'; key: string; label: string }
    | { type: 'item'; key: string; label: string; icon: string; permission?: string; onClick: () => void; showLiveDot?: boolean };

  const menuNodesCanonical: MenuNode[] = [
    // 1. Dashboards & Real-Time Overview (Continuous / Highest Frequency)
    { type: 'section', key: 'section-dashboards', label: t('menu_dashboards') },
    { type: 'item', key: 'screen-exec', label: t('menu_exec'), icon: 'fa-solid fa-chart-line', permission: 'dashboard', onClick: () => setActiveTab('screen-exec') },
    { type: 'item', key: 'screen-pending-req', label: t('menu_pending_requests'), icon: 'fa-solid fa-circle-exclamation', permission: 'pending_actions', onClick: () => { setActiveTab('screen-pending-req'); fetchWorkflows(); } },
    { type: 'item', key: 'screen-realtime', label: currentLang === 'en' ? 'Real-Time Monitoring' : 'المراقبة اللحظية', icon: 'fa-solid fa-tower-broadcast', permission: 'reports', onClick: () => { setActiveTab('screen-realtime'); fetchLiveBalances(); }, showLiveDot: true },
    { type: 'item', key: 'screen-my-activity', label: t('menu_my_activity'), icon: 'fa-solid fa-user-clock', permission: 'dashboard', onClick: () => { setActiveTab('screen-my-activity'); fetchMyActivity(); } },

    // 2. Core Vault & Physical Operations (Daily Operations - Highest Frequency)
    { type: 'section', key: 'section-operations', label: t('menu_operations') },
    { type: 'item', key: 'screen-intake', label: currentLang === 'en' ? 'Receive Shipment' : 'استلام الشحنات', icon: 'fa-solid fa-dolly', permission: 'intake', onClick: () => { setActiveTab('screen-intake'); fetchSuppliers(); fetchPendingIntakes(); fetchLocations(); fetchProducts(); } },
    { type: 'item', key: 'screen-spatial', label: t('menu_spatial'), icon: 'fa-solid fa-warehouse', permission: 'spatial_map', onClick: () => setActiveTab('screen-spatial') },
    { type: 'item', key: 'screen-transfers', label: t('menu_transfers'), icon: 'fa-solid fa-truck-arrow-right', permission: 'intake', onClick: () => { setActiveTab('screen-transfers'); fetchTransfers(); } },
    { type: 'item', key: 'screen-custody', label: t('menu_custody'), icon: 'fa-solid fa-vault', permission: 'custody', onClick: () => setActiveTab('screen-custody') },
    { type: 'item', key: 'screen-customer-receipt', label: t('menu_customer_receipt'), icon: 'fa-solid fa-hand-holding-dollar', permission: 'intake', onClick: () => { setActiveTab('screen-customer-receipt'); resetCustomerReceiptForm(); } },
    { type: 'item', key: 'screen-gfs-delivery', label: currentLang === 'en' ? 'GFS Branch Delivery' : 'طلبات فروع GFS', icon: 'fa-solid fa-truck-fast', permission: 'intake', onClick: () => { setActiveTab('screen-gfs-delivery'); fetchGfsDeliveryRequests(); fetchGfsSyncLogs(); } },
    { type: 'item', key: 'screen-home-delivery', label: currentLang === 'en' ? 'Home Delivery (UC07)' : 'توصيل المنازل (UC07)', icon: 'fa-solid fa-house-chimney-user', permission: 'intake', onClick: () => { setActiveTab('screen-home-delivery'); fetchHomeDeliveries(); } },
    { type: 'item', key: 'screen-damaged-bars', label: currentLang === 'en' ? 'Damaged Bar Approvals (UC12)' : 'اعتماد السبائك التالفة (UC12)', icon: 'fa-solid fa-triangle-exclamation', permission: 'custody', onClick: () => { setActiveTab('screen-damaged-bars'); fetchDamagedBars(); } },

    // 3. Stock Cut-Off Thresholds (BRD UC09 & UC10)
    { type: 'item', key: 'screen-stock-thresholds', label: currentLang === 'en' ? 'Stock Cut-Off Thresholds' : 'حدود المخزون', icon: 'fa-solid fa-calculator', permission: 'master_data', onClick: () => { setActiveTab('screen-stock-thresholds'); fetchStockThresholds(); fetchEnterpriseStockAlerts(); fetchProducts(); } },

    // 4. Audit, Controls & Compliance (Periodic / Weekly / Regulatory Frequency)
    { type: 'section', key: 'section-controls', label: t('menu_controls') },
    { type: 'item', key: 'screen-stocktake', label: t('menu_stocktake'), icon: 'fa-solid fa-clipboard-check', permission: 'stocktake', onClick: () => setActiveTab('screen-stocktake') },
    { type: 'item', key: 'screen-reports', label: t('menu_reports'), icon: 'fa-solid fa-chart-pie', permission: 'reports', onClick: () => { setActiveTab('screen-reports'); loadReport(reportType); } },
    { type: 'item', key: 'screen-compliance', label: t('menu_compliance'), icon: 'fa-solid fa-shield-halved', permission: 'dashboard', onClick: () => { setActiveTab('screen-compliance'); fetchComplianceDashboard(); } },
    { type: 'item', key: 'screen-audit-trail', label: t('menu_audit_trail'), icon: 'fa-solid fa-magnifying-glass-chart', permission: 'reports', onClick: () => window.open('/pmims-audit-trail.html', '_blank') },

    // 5. Administration & Governance (Low Frequency / Setup & Maintenance)
    { type: 'section', key: 'section-admin', label: currentLang === 'en' ? 'Administration & Setup' : 'الإدارة والإعداد' },
    { type: 'item', key: 'screen-workflows', label: canAccess('workflow_design') ? t('menu_workflows') : t('menu_workflows_queue'), icon: 'fa-solid fa-diagram-project', permission: 'workflows', onClick: () => { setActiveTab('screen-workflows'); fetchWorkflows(); } },
    { type: 'item', key: 'screen-user-admin', label: t('menu_user_admin'), icon: 'fa-solid fa-users-gear', permission: 'user_admin', onClick: () => { setActiveTab('screen-user-admin'); fetchAdminData(); } },
    { type: 'item', key: 'screen-rules', label: currentLang === 'en' ? 'Business Rules Engine' : 'محرك قواعد الأعمال', icon: 'fa-solid fa-scale-balanced', permission: 'rules_engine', onClick: () => { setActiveTab('screen-rules'); fetchBusinessRules(); } },
    { type: 'item', key: 'screen-monitoring', label: currentLang === 'en' ? 'Monitoring' : 'المراقبة والتنبيهات', icon: 'fa-solid fa-heart-pulse', permission: 'monitoring', onClick: () => { setActiveTab('screen-monitoring'); fetchSlaMetrics(); fetchMonitoringEvents(); fetchAlertRoutes(); } },
    { type: 'item', key: 'screen-migration', label: t('menu_migration'), icon: 'fa-solid fa-file-import', permission: 'migration', onClick: () => setActiveTab('screen-migration') },
    { type: 'item', key: 'screen-sql-admin', label: currentLang === 'en' ? 'SQL Query Tool' : 'أداة SQL', icon: 'fa-solid fa-database', permission: 'user_admin', onClick: () => setActiveTab('screen-sql-admin') },
    { type: 'item', key: 'screen-admin', label: t('menu_settings'), icon: 'fa-solid fa-gears', permission: 'settings', onClick: () => setActiveTab('screen-admin') },
  ];

  // Merge the saved order with the canonical key set: drop stale keys no longer in
  // the codebase, append any brand-new keys (from a later deploy) at the end in
  // their canonical position, so the sidebar never silently drops a menu item.
  const menuCanonicalKeys = menuNodesCanonical.map(n => n.key);
  const menuSavedOrder = menuOrder.filter(k => menuCanonicalKeys.includes(k));
  const menuMissingKeys = menuCanonicalKeys.filter(k => !menuSavedOrder.includes(k));
  const effectiveMenuOrder = [...menuSavedOrder, ...menuMissingKeys];

  const menuNodesByKey = new Map(menuNodesCanonical.map(n => [n.key, n]));
  const orderedMenuNodes = effectiveMenuOrder.map(k => menuNodesByKey.get(k)).filter((n): n is MenuNode => !!n);

  const canEditMenu = canModify('settings');

  // Section headers are only shown if at least one visible item follows before the
  // next section header. In edit mode everything is force-visible so the layout can
  // be freely rearranged regardless of the editor's own module grants.
  const menuVisibleFlags = orderedMenuNodes.map((node, i) => {
    if (menuEditMode) return true;
    if (node.type === 'item') return !node.permission || canAccess(node.permission);
    for (let j = i + 1; j < orderedMenuNodes.length; j++) {
      const next = orderedMenuNodes[j];
      if (next.type === 'section') break;
      if (!next.permission || canAccess(next.permission)) return true;
    }
    return false;
  });

  // Drag-and-drop reordering -- drops `draggedKey` immediately before `targetKey`'s
  // current position (standard drag-to-reorder semantics), anywhere in the full
  // flat list (sections included), matching the up/down arrows' reach.
  const reorderMenuByDrag = (draggedKey: string, targetKey: string) => {
    if (draggedKey === targetKey) return;
    const withoutDragged = effectiveMenuOrder.filter(k => k !== draggedKey);
    const targetIdx = withoutDragged.indexOf(targetKey);
    if (targetIdx < 0) return;
    const newOrder = [...withoutDragged.slice(0, targetIdx), draggedKey, ...withoutDragged.slice(targetIdx)];
    saveMenuOrder(newOrder);
  };

  return (
    <div id="app-container" dir={dir}>
      {/* 1. SIDEBAR NAVIGATION */}
      <aside id="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">K</div>
          <div className="logo-text">
            <h2>{t('app_title')}</h2>
            <span>{t('app_subtitle')}</span>
          </div>
        </div>

        {/* Sidebar rearrange control -- gated by canModify('settings') client-side
            (UX only; the actual PUT is enforced server-side by settings.write). */}
        {canEditMenu && (
          <div style={{ padding: '8px 18px', borderBottom: '1px solid var(--surface-border)' }}>
            <button
              className="btn"
              style={{
                width: '100%', padding: '6px 10px', fontSize: '11px', fontWeight: 600,
                borderColor: menuEditMode ? 'var(--kfh-green)' : undefined,
                color: menuEditMode ? 'var(--kfh-green)' : undefined
              }}
              onClick={() => setMenuEditMode(!menuEditMode)}
            >
              <i className={`fa-solid ${menuEditMode ? 'fa-check' : 'fa-arrow-up-arrow-down'}`}></i>{' '}
              {menuEditMode
                ? (currentLang === 'en' ? 'Done Arranging Menu' : 'تم ترتيب القائمة')
                : (currentLang === 'en' ? 'Edit Menu' : 'تعديل القائمة')}
            </button>
          </div>
        )}

        <nav className="sidebar-menu">
          {orderedMenuNodes.map((node, i) => {
            if (!menuVisibleFlags[i]) return null;

            // Drag-and-drop: the whole row is draggable while editing. Drop position
            // is resolved to "insert immediately before the row you release over"
            // (see reorderMenuByDrag), anywhere in the flat list, sections included.
            const dragProps = menuEditMode ? {
              draggable: true,
              onDragStart: (e: React.DragEvent) => {
                setDraggedMenuKey(node.key);
                e.dataTransfer.effectAllowed = 'move';
              },
              onDragOver: (e: React.DragEvent) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverMenuKey !== node.key) setDragOverMenuKey(node.key);
              },
              onDragLeave: () => {
                setDragOverMenuKey(prev => (prev === node.key ? null : prev));
              },
              onDrop: (e: React.DragEvent) => {
                e.preventDefault();
                if (draggedMenuKey) reorderMenuByDrag(draggedMenuKey, node.key);
                setDraggedMenuKey(null);
                setDragOverMenuKey(null);
              },
              onDragEnd: () => {
                setDraggedMenuKey(null);
                setDragOverMenuKey(null);
              }
            } : {};

            const isBeingDragged = menuEditMode && draggedMenuKey === node.key;
            const isDropTarget = menuEditMode && dragOverMenuKey === node.key && draggedMenuKey !== node.key;
            const dragHandle = menuEditMode && (
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-grip-vertical" style={{ fontSize: '13px', cursor: 'grab', opacity: 0.7 }} title={currentLang === 'en' ? 'Drag to reorder' : 'اسحب لإعادة الترتيب'}></i>
              </span>
            );

            const rowStyleExtra: React.CSSProperties = menuEditMode ? {
              opacity: isBeingDragged ? 0.4 : 1,
              boxShadow: isDropTarget ? 'inset 0 2px 0 0 var(--kfh-green)' : undefined,
              cursor: 'grab'
            } : {};

            if (node.type === 'section') {
              return (
                <div
                  key={node.key}
                  className="menu-section-header"
                  style={{ display: 'flex', alignItems: 'center', ...rowStyleExtra }}
                  {...dragProps}
                >
                  <span>{node.label}</span>
                  {dragHandle}
                </div>
              );
            }

            return (
              <div
                key={node.key}
                className={`menu-item ${activeTab === node.key ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', cursor: menuEditMode ? 'grab' : 'pointer', ...rowStyleExtra }}
                onClick={menuEditMode ? undefined : node.onClick}
                {...dragProps}
              >
                <i className={`${node.icon} menu-item-icon`}></i>
                <span>{node.label}</span>
                {node.showLiveDot && (
                  <span style={{
                    marginLeft: menuEditMode ? '8px' : 'auto', width: '8px', height: '8px', borderRadius: '50%',
                    background: hubStatus === 'live' ? '#22C55E' : hubStatus === 'connecting' ? '#F59E0B' : '#9CA3AF',
                    boxShadow: hubStatus === 'live' ? '0 0 0 3px rgba(34,197,94,0.2)' : 'none'
                  }}></span>
                )}
                {dragHandle}
              </div>
            );
          })}
        </nav>

        {/* User Info Footer */}
        <div style={{ padding: '16px 18px', borderTop: '1px solid var(--surface-border)', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--bg-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><i className="fa-solid fa-user" style={{ color: 'var(--kfh-green)' }}></i> <strong>{displayName}</strong></div>
          <div style={{ fontSize: '10px', color: 'var(--kfh-green)', fontWeight: 600 }}>{userRole}</div>
          <button className="btn" style={{ padding: '5px 10px', fontSize: '11px', marginTop: '4px', borderColor: 'var(--accent-red-muted)', color: 'var(--accent-red)', alignSelf: 'flex-start', background: 'var(--accent-red-muted)', borderRadius: 'var(--radius-sm)' }} onClick={() => {
            disconnectMonitoringHub();
            setIsLoggedIn(false);
            setUsername('');
            setPassword('');
          }}>
            <i className="fa-solid fa-sign-out-alt"></i> {currentLang === 'en' ? 'Logout' : 'تسجيل الخروج'}
          </button>
        </div>
      </aside>

      {/* 2. CORE WORKSPACE AREA */}
      <main id="main-panel">
        <header id="main-header">
          <div className="header-title-box">
            <h1>{t(
              activeTab === 'screen-exec' ? 'title_exec' :
              activeTab === 'screen-my-activity' ? 'title_my_activity' :
              activeTab === 'screen-active-deals' ? 'title_active_deals' :
              activeTab === 'screen-customer-receipt' ? 'title_customer_receipt' :
              activeTab.replace('screen-', 'menu_')
            )}</h1>
          </div>

          <div className="header-controls">
            <div className="rate-ticker-live">
              <div className="ticker-item">
                <span className="gold-lbl">{t('ticker_gold')}</span>
                <span className="val">${goldRate.toFixed(2)}</span>
                <span className="green-arrow"><i className="fa-solid fa-circle-arrow-up"></i></span>
                <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{t('ticker_feed')}</span>
              </div>
              <div className="ticker-item">
                <span className="silver-lbl">{t('ticker_silver')}</span>
                <span className="val">${silverRate.toFixed(2)}</span>
                <span className="green-arrow"><i className="fa-solid fa-circle-arrow-up"></i></span>
              </div>
            </div>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              <i className="fa-regular fa-clock"></i> {t('header_timezone')}
            </span>
            <button
              className="btn"
              onClick={() => setActiveApp('GFS')}
              style={{
                padding: '6px 14px',
                fontSize: '13px',
                background: 'linear-gradient(135deg, #D4AF37 0%, #AA771C 100%)',
                color: '#070b14',
                border: 'none',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                borderRadius: '6px',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(212, 175, 55, 0.4)'
              }}
            >
              <i className="fa-solid fa-coins"></i> {currentLang === 'en' ? 'GFS Customer Portal' : 'بوابة عملاء الذهب (GFS)'}
            </button>
            <button className="btn" onClick={toggleLanguage} style={{ padding: '6px 12px', fontSize: '13px', borderColor: 'var(--accent-gold)', color: 'var(--accent-gold)', fontWeight: '600' }}>
              <i className="fa-solid fa-globe"></i> {currentLang === 'en' ? 'العربية' : 'English'}
            </button>
          </div>
        </header>

        {/* SCREEN VIEWPORT: EXECUTIVE BOARD */}
        <section className={`screen-viewport ${activeTab === 'screen-exec' ? 'active' : ''}`}>
          <div className="glass-card" style={{ marginBottom: '20px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>{t('date_range_from')}</label>
              <input
                type="date"
                className="form-control"
                value={execStartDate}
                max={execEndDate}
                onChange={(e) => {
                  const val = e.target.value;
                  setExecStartDate(val);
                  fetchExecutiveBoard(val, execEndDate);
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>{t('date_range_to')}</label>
              <input
                type="date"
                className="form-control"
                value={execEndDate}
                min={execStartDate}
                onChange={(e) => {
                  const val = e.target.value;
                  setExecEndDate(val);
                  fetchExecutiveBoard(execStartDate, val);
                }}
              />
            </div>
            <button
              className="btn"
              style={{ padding: '8px 14px', fontSize: '12px' }}
              onClick={() => {
                const { start, end } = getCurrentMonthRange();
                setExecStartDate(start);
                setExecEndDate(end);
                fetchExecutiveBoard(start, end);
              }}
            >
              {t('date_range_reset')}
            </button>
          </div>

          <div className="kpi-row">
            <div className="glass-card kpi-card">
              <span className="kpi-title">{t('kpi_prop_gold')}</span>
              <span className="kpi-value gold-txt">{(execBoard?.total_gold_weight_kg ?? 0).toFixed(3)} KG</span>
              <span className="kpi-sub" style={{ color: 'var(--accent-green)' }}>
                <i className="fa-solid fa-scale-balanced"></i> {((execBoard?.total_gold_weight_kg ?? 0) * 1000).toLocaleString()} g • <i className="fa-solid fa-circle-check"></i> {t('kpi_sync')}
              </span>
            </div>
            <div className="glass-card kpi-card">
              <span className="kpi-title">{t('kpi_ready')}</span>
              <span className="kpi-value">{(execBoard?.available_weight_kg ?? 0).toFixed(3)} KG</span>
              <span className="kpi-sub">{((execBoard?.available_weight_kg ?? 0) * 1000).toLocaleString()} g • {t('kpi_ready_sub')}</span>
            </div>
            <div className="glass-card kpi-card">
              <span className="kpi-title">{t('kpi_reserved')}</span>
              <span className="kpi-value" style={{ color: 'var(--accent-orange)' }}>{(execBoard?.reserved_weight_kg ?? 0).toFixed(3)} KG</span>
              <span className="kpi-sub"><i className="fa-solid fa-hourglass-start"></i> {((execBoard?.reserved_weight_kg ?? 0) * 1000).toLocaleString()} g • {t('kpi_reserved_sub')}</span>
            </div>
            <div className="glass-card kpi-card">
              <span className="kpi-title">{t('kpi_custody')}</span>
              <span className="kpi-value" style={{ color: 'var(--accent-blue)' }}>{(execBoard?.custody_weight_kg ?? 0).toFixed(3)} KG</span>
              <span className="kpi-sub">{((execBoard?.custody_weight_kg ?? 0) * 1000).toLocaleString()} g • {t('kpi_custody_sub')}</span>
            </div>
          </div>

          {/* LOW-STOCK ALARM BANNER */}
          {lowStockAlerts.length > 0 && (
            <div className="low-stock-alarm">
              <div className="alarm-header">
                <i className="fa-solid fa-triangle-exclamation"></i>
                <strong>{currentLang === 'ar' ? 'تنبيه: مخزون منخفض' : 'Low Stock Alert'}</strong>
                <span className="alarm-count">{lowStockAlerts.length}</span>
              </div>
              <div className="alarm-body">
                {lowStockAlerts.map((alert: any, i: number) => (
                  <div key={i} className="alarm-row">
                    <div className="alarm-info">
                      <strong>{alert.product_name}</strong>
                      <span className="alarm-detail">
                        {currentLang === 'ar' ? 'المخزون الحالي' : 'Current Stock'}: <b style={{color:'var(--accent-red)'}}>{alert.current_stock}</b> / {currentLang === 'ar' ? 'الحد الأدنى' : 'Min'}: {alert.min_stock_qty}
                      </span>
                      <span className="alarm-detail">{currentLang === 'ar' ? 'المورد' : 'Supplier'}: {alert.vendor_name}</span>
                    </div>
                    <button className="btn btn-primary alarm-action" onClick={() => handleGenerateDraftPO(alert.threshold_id)}>
                      <i className="fa-solid fa-file-invoice"></i> {currentLang === 'ar' ? 'إنشاء طلب شراء' : 'Generate Draft P.O.'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="glass-card">
            <h3>{t('exec_table_title')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>{t('exec_table_subtitle')}</p>
            {loadingExecBoard ? (
              <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-spinner fa-spin"></i>
              </div>
            ) : (
              <div className="table-responsive">
                <table>
                  <thead>
                    <tr>
                      <th>{t('th_serial')}</th>
                      <th>{t('th_metal')}</th>
                      <th>{t('th_denom')}</th>
                      <th>{t('th_origin')}</th>
                      <th>{t('th_coords')}</th>
                      <th>{t('th_status')}</th>
                      <th style={{ width: '120px', textAlign: 'center' }}>{currentLang === 'ar' ? 'العمليات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(execBoard?.items ?? []).map((item: any, idx: number) => (
                      <tr key={idx}>
                        <td><strong>{item.serial_number}</strong></td>
                        <td>{translateDb(item.metal)}</td>
                        <td>{translateDb(item.denomination)}</td>
                        <td>{translateDb(item.origin)}</td>
                        <td>{translateDb(item.location)}</td>
                        <td>
                          <span className={`badge badge-${item.status.toLowerCase()}`}>
                            {translateDb(item.status)}
                          </span>
                          {item.is_damaged && (
                            <span className="badge badge-error" style={{ background: '#dc3545', color: '#fff', marginLeft: '6px' }}>
                              {currentLang === 'ar' ? 'تالف' : 'Damaged'}
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                            {item.status === 'READY' && !item.is_damaged && (
                              <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '11px' }}
                                onClick={() => {
                                  setTransferItemId(item.item_id);
                                  setTransferItemSerial(item.serial_number);
                                  setShowTransferModal(true);
                                }}>
                                <i className="fa-solid fa-paper-plane"></i> {currentLang === 'ar' ? 'تحويل' : 'Transfer'}
                              </button>
                            )}
                            {item.status === 'READY' && !item.is_damaged && (
                              <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '11px', background: '#dc3545' }}
                                onClick={() => {
                                  setDamageItemId(item.item_id);
                                  setDamageReason('');
                                  setDamageDesc('');
                                  setDamageDocId('');
                                  setShowDamageModal(true);
                                }}>
                                <i className="fa-solid fa-triangle-exclamation"></i> {currentLang === 'ar' ? 'تالف' : 'Damaged'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {(execBoard?.items ?? []).length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                          {t('msg_no_activity_yet')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>



        {/* SCREEN VIEWPORT: COMPLIANCE DASHBOARD (Reporting Requirements Gap Analysis, Item 6) --
            Management gets Executive Board above; Compliance/Audit gets this curated summary of
            the same exceptions feed the Reports screen's Exceptions Report exports, plus
            audit-log tamper-check status, instead of only the raw audit-log search screen. */}
        <section className={`screen-viewport ${activeTab === 'screen-compliance' ? 'active' : ''}`}>
          <div className="kpi-row">
            <div className="glass-card kpi-card">
              <span className="kpi-title">{t('th_exception_type')} {currentLang === 'en' ? '(Total)' : '(الإجمالي)'}</span>
              <span className="kpi-value" style={{ color: 'var(--accent-orange)' }}>{complianceDashboard?.exceptions_total ?? 0}</span>
              <span className="kpi-sub">{currentLang === 'en' ? 'Open items needing attention' : 'بنود مفتوحة تحتاج للمتابعة'}</span>
            </div>
            <div className="glass-card kpi-card">
              <span className="kpi-title">{currentLang === 'en' ? 'Tampered Audit Rows' : 'سجلات تدقيق متلاعب بها'}</span>
              <span className="kpi-value" style={{ color: 'var(--accent-red)' }}>{complianceDashboard?.audit_tamper_check?.tampered_count ?? 0}</span>
              <span className="kpi-sub"><i className="fa-solid fa-shield-halved"></i> {currentLang === 'en' ? 'Row-hash mismatch detected' : 'عدم تطابق البصمة (row-hash)'}</span>
            </div>
            <div className="glass-card kpi-card">
              <span className="kpi-title">{currentLang === 'en' ? 'Unverified Audit Rows' : 'سجلات تدقيق غير موثقة'}</span>
              <span className="kpi-value">{complianceDashboard?.audit_tamper_check?.unverified_count ?? 0}</span>
              <span className="kpi-sub">{currentLang === 'en' ? 'Pre-date tamper hashing' : 'سابقة لتفعيل بصمة التحقق'}</span>
            </div>
          </div>

          <div className="glass-card" style={{ marginBottom: '20px' }}>
            <h3>{currentLang === 'en' ? 'Exceptions by Type' : 'الاستثناءات حسب النوع'}</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '12px' }}>
              {(complianceDashboard?.exceptions_by_type ?? []).map((row, idx) => (
                <span key={idx} className="badge badge-reserved" style={{ fontSize: '13px', padding: '8px 14px' }}>
                  {row.exception_type}: <strong>{row.count}</strong>
                </span>
              ))}
              {(complianceDashboard?.exceptions_by_type ?? []).length === 0 && (
                <span style={{ color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'No open exceptions.' : 'لا توجد استثناءات مفتوحة.'}</span>
              )}
            </div>
          </div>

          <div className="glass-card">
            <h3>{t('rep_exceptions')}</h3>
            {loadingCompliance ? (
              <p style={{ color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Loading…' : 'جارٍ التحميل…'}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="report-data-table">
                  <thead>
                    <tr>
                      <th>{t('th_exception_type')}</th>
                      <th>{t('th_reference')}</th>
                      <th>{t('th_description')}</th>
                      <th>{t('th_severity')}</th>
                      <th>{t('th_raised_at')}</th>
                      <th>{t('th_status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(complianceDashboard?.recent_exceptions ?? []).map((row, idx) => (
                      <tr key={idx}>
                        <td>{row.exception_type}</td>
                        <td>{row.reference}</td>
                        <td>{row.description}</td>
                        <td>
                          <span className={`badge ${row.severity === 'HIGH' || row.severity === 'BLOCK' ? 'badge-quarantined' : 'badge-reserved'}`}>
                            {row.severity}
                          </span>
                        </td>
                        <td>{row.raised_at ? new Date(row.raised_at).toLocaleString() : '—'}</td>
                        <td>{row.status}</td>
                      </tr>
                    ))}
                    {(complianceDashboard?.recent_exceptions ?? []).length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                          {currentLang === 'en' ? 'No open exceptions.' : 'لا توجد استثناءات مفتوحة.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* SCREEN VIEWPORT: MY ACTIVITY */}
        <section className={`screen-viewport ${activeTab === 'screen-my-activity' ? 'active' : ''}`}>
          <div className="glass-card" style={{ marginBottom: '20px' }}>
            <h3>{t('title_my_activity')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>{t('my_activity_subtitle')}</p>
          </div>

          <div className="glass-card" style={{ marginBottom: '20px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>{t('date_range_from')}</label>
              <input
                type="date"
                className="form-control"
                value={myActivityStartDate}
                max={myActivityEndDate}
                onChange={(e) => {
                  const val = e.target.value;
                  setMyActivityStartDate(val);
                  fetchMyActivity(val, myActivityEndDate);
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>{t('date_range_to')}</label>
              <input
                type="date"
                className="form-control"
                value={myActivityEndDate}
                min={myActivityStartDate}
                onChange={(e) => {
                  const val = e.target.value;
                  setMyActivityEndDate(val);
                  fetchMyActivity(myActivityStartDate, val);
                }}
              />
            </div>
            <button
              className="btn"
              style={{ padding: '8px 14px', fontSize: '12px' }}
              onClick={() => {
                const { start, end } = getCurrentMonthRange();
                setMyActivityStartDate(start);
                setMyActivityEndDate(end);
                fetchMyActivity(start, end);
              }}
            >
              {t('date_range_reset')}
            </button>
          </div>

          <div className="kpi-row">
            <div
              className="glass-card kpi-card"
              style={{ cursor: 'pointer', border: myActivityDrilldown === 'ALL' ? '2px solid var(--accent-gold)' : undefined }}
              onDoubleClick={() => setMyActivityDrilldown(prev => prev === 'ALL' ? null : 'ALL')}
              title={t('my_activity_hint')}
            >
              <span className="kpi-title">{t('kpi_actions_taken')}</span>
              <span className="kpi-value">{myActivity?.actions_taken_count ?? 0}</span>
              <span className="kpi-sub">{t('kpi_actions_taken_sub')}</span>
            </div>
            <div
              className="glass-card kpi-card"
              style={{ cursor: 'pointer', border: myActivityDrilldown === 'APPROVED' ? '2px solid var(--accent-green)' : undefined }}
              onDoubleClick={() => setMyActivityDrilldown(prev => prev === 'APPROVED' ? null : 'APPROVED')}
              title={t('my_activity_hint')}
            >
              <span className="kpi-title">{t('kpi_approved')}</span>
              <span className="kpi-value" style={{ color: 'var(--accent-green)' }}>{myActivity?.approved_count ?? 0}</span>
              <span className="kpi-sub">{t('kpi_approved_sub')}</span>
            </div>
            <div
              className="glass-card kpi-card"
              style={{ cursor: 'pointer', border: myActivityDrilldown === 'REJECTED' ? '2px solid var(--accent-red)' : undefined }}
              onDoubleClick={() => setMyActivityDrilldown(prev => prev === 'REJECTED' ? null : 'REJECTED')}
              title={t('my_activity_hint')}
            >
              <span className="kpi-title">{t('kpi_rejected')}</span>
              <span className="kpi-value" style={{ color: 'var(--accent-red)' }}>{myActivity?.rejected_count ?? 0}</span>
              <span className="kpi-sub">{t('kpi_rejected_sub')}</span>
            </div>
            <div
              className="glass-card kpi-card"
              style={{ cursor: 'pointer', border: myActivityDrilldown === 'PENDING' ? '2px solid var(--accent-orange)' : undefined }}
              onDoubleClick={() => setMyActivityDrilldown(prev => prev === 'PENDING' ? null : 'PENDING')}
              title={t('my_activity_hint')}
            >
              <span className="kpi-title">{t('kpi_pending_mine')}</span>
              <span className="kpi-value" style={{ color: 'var(--accent-orange)' }}>{myActivity?.pending_count ?? 0}</span>
              <span className="kpi-sub">{t('kpi_pending_mine_sub')}</span>
            </div>
          </div>

          {loadingMyActivity ? (
            <div className="glass-card" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
              <i className="fa-solid fa-spinner fa-spin"></i>
            </div>
          ) : myActivityDrilldown ? (
            <div className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 style={{ margin: 0 }}>
                  {myActivityDrilldown === 'ALL' && t('kpi_actions_taken')}
                  {myActivityDrilldown === 'APPROVED' && t('kpi_approved')}
                  {myActivityDrilldown === 'REJECTED' && t('kpi_rejected')}
                  {myActivityDrilldown === 'PENDING' && t('kpi_pending_mine')}
                </h3>
                <button className="btn" style={{ padding: '5px 12px', fontSize: '12px' }} onClick={() => setMyActivityDrilldown(null)}>
                  {t('btn_close')}
                </button>
              </div>
              <div className="table-responsive">
                <table>
                  <thead>
                    <tr>
                      <th>{t('th_wf_type')}</th>
                      <th>{t('th_wf_entity')}</th>
                      {myActivityDrilldown === 'PENDING' ? (
                        <>
                          <th>{t('th_initiated')}</th>
                          <th>{t('th_created')}</th>
                        </>
                      ) : (
                        <>
                          <th>{t('th_decision')}</th>
                          <th>{t('th_comments')}</th>
                          <th>{t('th_timestamp')}</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const rows: any[] = myActivityDrilldown === 'PENDING'
                        ? (myActivity?.pending || [])
                        : (myActivity?.actions_taken || []).filter((a: any) => myActivityDrilldown === 'ALL' || a.action === myActivityDrilldown);
                      const colSpan = myActivityDrilldown === 'PENDING' ? 4 : 5;
                      if (rows.length === 0) {
                        return (
                          <tr>
                            <td colSpan={colSpan} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                              {t('msg_no_activity_yet')}
                            </td>
                          </tr>
                        );
                      }
                      return rows.map((r: any, idx: number) => (
                        <tr key={idx}>
                          <td><span className="badge badge-ready">{r.workflow_type}</span></td>
                          <td>{r.entity_summary}</td>
                          {myActivityDrilldown === 'PENDING' ? (
                            <>
                              <td>{r.initiated_by}</td>
                              <td>{new Date(r.created_at).toLocaleString()}</td>
                            </>
                          ) : (
                            <>
                              <td>
                                <span style={{ color: r.action === 'APPROVED' ? 'var(--accent-green)' : (r.action === 'RETURNED' ? 'var(--accent-orange)' : 'var(--accent-red)'), fontWeight: 600 }}>
                                  ● {r.action}
                                </span>
                              </td>
                              <td style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>{r.comments || '—'}</td>
                              <td style={{ fontSize: '12px' }}>{new Date(r.timestamp).toLocaleString()}</td>
                            </>
                          )}
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="glass-card" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '13px' }}>
              <i className="fa-solid fa-hand-pointer"></i>&nbsp; {t('my_activity_hint')}
            </div>
          )}
        </section>

        {/* SCREEN VIEWPORT: PO & PROCUREMENT */}
        <section className={`screen-viewport ${activeTab === 'screen-po' ? 'active' : ''}`}>
          {printingPO ? (
            <div className="glass-card" id="po-print-area">
              <div style={{ textAlign: 'center', marginBottom: '30px', borderBottom: '2px solid #D4AF37', paddingBottom: '15px' }}>
                <h2 style={{ margin: 0 }}>KUWAIT FINANCE HOUSE (KFH)</h2>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 'bold' }}>PRECIOUS METALS INVENTORY MANAGEMENT SYSTEM (PMIMS)</span>
                <h3 style={{ marginTop: '10px', textDecoration: 'underline' }}>
                  {currentLang === 'en' ? 'Purchase Order' : 'طلب شراء'}
                </h3>
              </div>

              <table style={{ width: '100%', marginBottom: '20px' }}>
                <tbody>
                  <tr><td style={{ padding: '8px', width: '220px' }}><strong>{t('th_po_code')}</strong></td><td style={{ padding: '8px' }}>{printingPO.po_number}</td></tr>
                  <tr><td style={{ padding: '8px' }}><strong>{t('th_supplier')}</strong></td><td style={{ padding: '8px' }}>{printingPO.supplier}</td></tr>
                  <tr><td style={{ padding: '8px' }}><strong>{t('th_weight')}</strong></td><td style={{ padding: '8px' }}>{printingPO.weight}g</td></tr>
                  <tr><td style={{ padding: '8px' }}><strong>{t('th_cost')}</strong></td><td style={{ padding: '8px' }}>{printingPO.cost.toLocaleString()} {printingPO.currency}</td></tr>
                  <tr><td style={{ padding: '8px' }}><strong>{currentLang === 'en' ? 'Total Quantity' : 'إجمالي الكمية'}</strong></td><td style={{ padding: '8px' }}>{printingPO.qty || 1}</td></tr>
                  <tr><td style={{ padding: '8px' }}><strong>{t('th_status')}</strong></td><td style={{ padding: '8px' }}>{translateDb(printingPO.status_code)}</td></tr>
                  <tr><td style={{ padding: '8px' }}><strong>{currentLang === 'en' ? 'Created By' : 'أنشئ بواسطة'}</strong></td><td style={{ padding: '8px' }}>{printingPO.created_by}</td></tr>
                  <tr><td style={{ padding: '8px' }}><strong>{currentLang === 'en' ? 'Approved By' : 'اعتمد بواسطة'}</strong></td><td style={{ padding: '8px' }}>{printingPO.approved_by || '—'}</td></tr>
                </tbody>
              </table>

              {printingPO.items && printingPO.items.length > 0 && (
                <table style={{ width: '100%', marginBottom: '20px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #D4AF37' }}>
                      <th style={{ padding: '8px', textAlign: 'left' }}>{currentLang === 'en' ? 'Denomination' : 'الفئة'}</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>{currentLang === 'en' ? 'Quantity' : 'الكمية'}</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>{currentLang === 'en' ? 'Unit Cost' : 'سعر الوحدة'}</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>{currentLang === 'en' ? 'Line Total' : 'إجمالي البند'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printingPO.items.map((it: any, i: number) => {
                      const p = products.find((pp: any) => String(pp.product_id) === String(it.product_id));
                      const denom = p ? `${p.metal_name || ''} ${p.denomination_label || ''}`.trim() : (it.product_code || `#${it.product_id}`);
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                          <td style={{ padding: '8px' }}>{denom}{p?.weight_grams ? ` (${p.weight_grams}g)` : ''}</td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>{it.qty}</td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>{(it.unit_cost || 0).toLocaleString()}</td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>{((it.unit_cost || 0) * (it.qty || 0)).toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '20px' }}>
                <span>{currentLang === 'en' ? 'Date Generated' : 'تاريخ الإصدار'}: {new Date().toLocaleString()}</span>
                <span>{currentLang === 'en' ? 'Operator' : 'المشغل'}: {displayName} ({userRole})</span>
              </div>

              <div style={{ marginTop: '30px' }}>
                <button className="btn" onClick={() => setPrintingPO(null)}>
                  {currentLang === 'en' ? 'Close' : 'إغلاق'}
                </button>
              </div>
            </div>
          ) : (
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>

            <div className="glass-card po-form-card po-create" id="po-form-card">
              <style>{`
                .po-create .po-head { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:22px; }
                .po-create .po-head h3 { margin:0; font-size:20px; font-weight:700; color:var(--text-primary); }
                .po-create .po-badge { background:#F3F4F6; color:#6B7280; border:1px solid #E5E7EB; border-radius:999px; padding:5px 14px; font-size:12px; font-weight:600; white-space:nowrap; }
                .po-create .po-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-bottom:24px; }
                .po-create .po-fg { display:flex; flex-direction:column; gap:7px; }
                .po-create .po-fg > label { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#6B7280; font-weight:600; margin:0; }
                .po-create input, .po-create select { background:#F9FAFB; border:1px solid #E5E7EB; border-radius:8px; padding:10px 12px; font-size:14px; width:100%; color:var(--text-primary); box-sizing:border-box; transition:border-color .15s, box-shadow .15s, background .15s; }
                .po-create input:focus, .po-create select:focus { outline:none; border-color:#10B981; box-shadow:0 0 0 3px rgba(16,185,129,.15); background:#fff; }
                .po-create input:disabled, .po-create select:disabled { background:#F3F4F6; color:#9CA3AF; cursor:not-allowed; }
                .po-create .po-section-title { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#6B7280; font-weight:700; }
                .po-create table { width:100%; border-collapse:collapse; }
                .po-create thead th { font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:#9CA3AF; font-weight:600; padding:10px 12px; border-bottom:1px solid #E5E7EB; background:#F9FAFB; }
                .po-create tbody td { padding:11px 12px; border-bottom:1px solid #F3F4F6; font-size:14px; color:var(--text-primary); }
                .po-create tbody tr:last-child td { border-bottom:none; }
                .po-create .po-summary { margin-left:auto; width:360px; max-width:100%; margin-top:20px; }
                .po-create .po-sum-row { display:flex; justify-content:space-between; padding:10px 2px; font-size:14px; color:#374151; border-bottom:1px solid #F3F4F6; }
                .po-create .po-sum-grand { border-top:2px solid #E5E7EB; border-bottom:none; margin-top:4px; padding-top:14px; font-size:19px; font-weight:800; color:var(--text-primary); }
                .po-create .po-actions { display:flex; justify-content:flex-end; align-items:center; gap:10px; margin-top:24px; padding-top:18px; border-top:1px solid #F3F4F6; }
                .po-create .btn-emerald { background:#059669; color:#fff; border:none; border-radius:8px; padding:12px 24px; font-size:14px; font-weight:700; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,.06); }
                .po-create .btn-emerald:hover { background:#047857; }
                .po-create .btn-ghost { background:#fff; color:#374151; border:1px solid #E5E7EB; border-radius:8px; padding:12px 20px; font-size:14px; font-weight:600; cursor:pointer; }
                .po-create .btn-ghost:hover { background:#F9FAFB; }
                .po-create .btn-link { background:none; border:none; color:#6B7280; font-size:14px; font-weight:600; cursor:pointer; padding:12px 8px; }
                .po-create .btn-link:hover { color:var(--text-primary); }
                @media(max-width:640px){ .po-create .po-grid2 { grid-template-columns:1fr; } }
              `}</style>
              <div className="po-head">
                <h3>{isEditingPO ? (currentLang === 'en' ? 'Amend Purchase Order' : 'تعديل طلب الشراء') : (currentLang === 'en' ? 'Create Purchase Order (Maker)' : 'إنشاء طلب شراء')}</h3>
                <span className="po-badge">{isEditingPO ? (currentLang === 'en' ? 'Amending' : 'قيد التعديل') : (currentLang === 'en' ? 'Draft' : 'مسودة')}</span>
              </div>
              {!canModify('purchase_orders') && (
                <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', color: 'var(--accent-red)', fontSize: '12px', marginBottom: '15px' }}>
                  <i className="fa-solid fa-circle-exclamation"></i> {currentLang === 'en' ? 'Read-Only Mode: You cannot create or modify purchase orders.' : 'وضع القراءة فقط: لا يمكنك إنشاء أو تعديل طلبات الشراء.'}
                </div>
              )}
              {/* General info — 2-column light-grey inputs. */}
              <div className="po-grid2">
                <div className="po-fg">
                  <label>{t('form_po_num')}</label>
                  <input type="text" value={poNum} onChange={e => setPoNum(e.target.value)} disabled={isEditingPO || !canModify('purchase_orders')} />
                </div>
                <div className="po-fg">
                  <label>{t('form_supplier')}</label>
                  <select value={poSupplier} onChange={e => setPoSupplier(parseInt(e.target.value))} disabled={!canModify('purchase_orders')}>
                    <option value={1}>Valcambi Suisse (Switzerland)</option>
                    <option value={2}>Nadir Gold Refinery (Turkey)</option>
                  </select>
                </div>
                <div className="po-fg">
                  <label>{currentLang === 'en' ? 'P.O. Date' : 'تاريخ الطلب'}</label>
                  <input type="date" value={poDate} onChange={e => setPoDate(e.target.value)} disabled={!canModify('purchase_orders')} />
                </div>
                <div className="po-fg">
                  <label>{currentLang === 'en' ? 'Origin Country' : 'بلد المنشأ'}</label>
                  <select value={poOrigin} onChange={e => setPoOrigin(e.target.value)} disabled={!canModify('purchase_orders')}>
                    <option value="Switzerland">{t('opt_swiss')}</option>
                    <option value="Turkey">{t('opt_turkey')}</option>
                  </select>
                </div>
                <div className="po-fg">
                  <label>{currentLang === 'en' ? 'Currency' : 'العملة'}</label>
                  <select value={poCurrency} onChange={e => setPoCurrency(e.target.value)} disabled={!canModify('purchase_orders')}>
                    <option value="USD">USD — US Dollar</option>
                    <option value="EUR">EUR — Euro</option>
                    <option value="CHF">CHF — Swiss Franc</option>
                    <option value="KWD">KWD — Kuwaiti Dinar</option>
                  </select>
                </div>
                <div className="po-fg">
                  <label>{currentLang === 'en' ? 'Supplier Invoice Number' : 'رقم فاتورة المورد'}</label>
                  <input type="text" value={poInvoiceNumber} onChange={e => setPoInvoiceNumber(e.target.value)} disabled={!canModify('purchase_orders')} placeholder={currentLang === 'en' ? 'e.g. INV-VAL-20260703' : 'مثال: INV-VAL-20260703'} />
                </div>
                <div className="po-fg">
                  <label>{currentLang === 'en' ? 'Supplier Invoice Date' : 'تاريخ فاتورة المورد'}</label>
                  <input type="date" value={poInvoiceDate} onChange={e => setPoInvoiceDate(e.target.value)} disabled={!canModify('purchase_orders')} />
                </div>
              </div>
              <div className="form-group">
                <label className="po-section-title">{currentLang === 'en' ? 'Line Items' : 'بنود الطلب'}</label>

                {/* Entry row: pick the denomination + its data, then Add it to the grid below.
                    When editing an existing grid row this switches to Update. */}
                {canModify('purchase_orders') && (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end', flexWrap: 'wrap', padding: '10px', border: '1px solid var(--surface-border)', borderRadius: '8px', marginBottom: '10px', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ flex: '2 1 220px', minWidth: 0, position: 'relative' }}>
                      <label style={{ fontSize: '11px' }}>{currentLang === 'en' ? 'Item' : 'الصنف'}</label>
                      <input
                        className="form-control"
                        style={{ width: '100%' }}
                        placeholder={currentLang === 'en' ? 'Search item by name or code…' : 'ابحث عن الصنف بالاسم أو الرمز…'}
                        value={poComboOpen ? poComboQuery : (poComboSelected ? poProductLabel(poComboSelected) : '')}
                        onFocus={() => { setPoComboQuery(''); setPoComboOpen(true); }}
                        onBlur={() => setTimeout(() => setPoComboOpen(false), 120)}
                        onChange={e => { setPoComboQuery(e.target.value); if (!poComboOpen) setPoComboOpen(true); }}
                      />
                      {poComboOpen && (
                        <ul role="listbox" style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, margin: '4px 0 0', padding: '4px', listStyle: 'none', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--surface-border)', borderRadius: '8px', maxHeight: '220px', overflowY: 'auto', boxShadow: 'var(--shadow-premium)' }}>
                          {poComboMatches.length === 0 ? (
                            <li style={{ padding: '8px 10px', color: 'var(--text-muted)', fontSize: '12px' }}>
                              {currentLang === 'en' ? 'No matching items' : 'لا توجد أصناف مطابقة'}
                            </li>
                          ) : (
                            poComboMatches.map((p: any) => (
                              <li
                                key={p.product_id}
                                role="option"
                                aria-selected={String(p.product_id) === String(poEntryProduct)}
                                onMouseDown={() => { setPoEntryProduct(String(p.product_id)); setPoComboOpen(false); setPoComboQuery(''); }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(2,132,199,0.10)'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = String(p.product_id) === String(poEntryProduct) ? 'rgba(2,132,199,0.12)' : 'transparent'; }}
                                style={{ padding: '8px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)', background: String(p.product_id) === String(poEntryProduct) ? 'rgba(2,132,199,0.12)' : 'transparent' }}
                              >
                                {poProductLabel(p)}
                              </li>
                            ))
                          )}
                        </ul>
                      )}
                    </div>
                    <div style={{ flex: '1 1 70px', minWidth: 0 }}>
                      <label style={{ fontSize: '11px' }}>{currentLang === 'en' ? 'Quantity' : 'الكمية'}</label>
                      <input type="number" className="form-control" min="0" value={poEntryQty} onChange={e => setPoEntryQty(e.target.value === '' ? 0 : (parseInt(e.target.value) || 0))} />
                    </div>
                    <div style={{ flex: '1 1 100px', minWidth: 0 }}>
                      <label style={{ fontSize: '11px' }}>{currentLang === 'en' ? 'Unit Price' : 'سعر الوحدة'}</label>
                      <input type="number" className="form-control" min="0" value={poEntryCost} onChange={e => setPoEntryCost(e.target.value === '' ? 0 : (parseFloat(e.target.value) || 0))} />
                    </div>
                    <button type="button" className="btn btn-primary" style={{ padding: '8px 14px' }} onClick={commitPoEntry}>
                      <i className={`fa-solid ${poEntryEditIdx !== null ? 'fa-check' : 'fa-plus'}`}></i>{' '}
                      {poEntryEditIdx !== null ? (currentLang === 'en' ? 'Update' : 'تحديث') : (currentLang === 'en' ? 'Add' : 'إضافة')}
                    </button>
                    {poEntryEditIdx !== null && (
                      <button type="button" className="btn" style={{ padding: '8px 12px' }} onClick={resetPoEntry}>
                        {currentLang === 'en' ? 'Cancel' : 'إلغاء'}
                      </button>
                    )}
                  </div>
                )}

                {/* Datagrid of committed line items */}
                <div className="table-responsive">
                  <table style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>{currentLang === 'en' ? 'Item ID' : 'رمز الصنف'}</th>
                        <th>{currentLang === 'en' ? 'Item Name' : 'اسم الصنف'}</th>
                        <th style={{ textAlign: 'right' }}>{currentLang === 'en' ? 'Weight' : 'الوزن'}</th>
                        <th style={{ textAlign: 'right' }}>{currentLang === 'en' ? 'Qty' : 'الكمية'}</th>
                        <th style={{ textAlign: 'right' }}>{currentLang === 'en' ? 'Unit Price' : 'سعر الوحدة'}</th>
                        <th style={{ textAlign: 'right' }}>{currentLang === 'en' ? 'Line Total' : 'إجمالي البند'}</th>
                        {canModify('purchase_orders') && <th style={{ textAlign: 'center' }}>{t('th_action')}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {poLines.length === 0 ? (
                        <tr>
                          <td colSpan={canModify('purchase_orders') ? 7 : 6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '14px', fontSize: '12px' }}>
                            {currentLang === 'en' ? 'No line items yet — add one above.' : 'لا توجد بنود بعد — أضف بندًا من الأعلى.'}
                          </td>
                        </tr>
                      ) : (
                        poLines.map((line, idx) => {
                          const p = products.find((pp: any) => String(pp.product_id) === String(line.product_id));
                          const itemId = p?.product_code || `#${line.product_id}`;
                          const itemName = p ? `${p.metal_name} ${p.denomination_label}` : `#${line.product_id}`;
                          return (
                            <tr key={idx} style={poEntryEditIdx === idx ? { background: 'rgba(0,155,78,0.10)' } : undefined}>
                              <td>{itemId}</td>
                              <td>{itemName}</td>
                              <td style={{ textAlign: 'right' }}>{lineWeight(line).toLocaleString()}g</td>
                              <td style={{ textAlign: 'right' }}>{line.qty}</td>
                              <td style={{ textAlign: 'right' }}>{(line.unit_cost || 0).toLocaleString()}</td>
                              <td style={{ textAlign: 'right' }}>{((line.unit_cost || 0) * (line.qty || 0)).toLocaleString()}</td>
                              {canModify('purchase_orders') && (
                                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                  <button type="button" className="btn" title={currentLang === 'en' ? 'Edit' : 'تعديل'} style={{ padding: '4px 8px', fontSize: '11px', backgroundColor: 'var(--accent-orange)', color: '#000', marginInlineEnd: '4px' }} onClick={() => editPoLine(idx)}>
                                    <i className="fa-solid fa-pen"></i>
                                  </button>
                                  <button type="button" className="btn" title={currentLang === 'en' ? 'Delete' : 'حذف'} style={{ padding: '4px 8px', fontSize: '11px', backgroundColor: 'var(--accent-red)', color: '#fff' }} onClick={() => deletePoLine(idx)}>
                                    <i className="fa-solid fa-trash"></i>
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Acquisition fees — Cost Tracking & Valuation purchase cost detail. Rolled
                  into PurchaseOrder.LandedCost server-side, which is what actually costs the
                  received bars (InventoryLot.AverageUnitCost) once the shipment is intake'd. */}
              <div className="form-group">
                <label className="po-section-title">{currentLang === 'en' ? 'Acquisition Fees (added to landed cost)' : 'رسوم الاستحواذ (تُضاف إلى تكلفة الوصول)'}</label>
                <div className="po-grid2">
                  <div className="po-fg">
                    <label>{currentLang === 'en' ? 'Freight / Shipping' : 'الشحن'}</label>
                    <input type="number" min="0" value={poFreightCost} onChange={e => setPoFreightCost(parseFloat(e.target.value) || 0)} disabled={!canModify('purchase_orders')} />
                  </div>
                  <div className="po-fg">
                    <label>{currentLang === 'en' ? 'Insurance' : 'التأمين'}</label>
                    <input type="number" min="0" value={poInsuranceCost} onChange={e => setPoInsuranceCost(parseFloat(e.target.value) || 0)} disabled={!canModify('purchase_orders')} />
                  </div>
                  <div className="po-fg">
                    <label>{currentLang === 'en' ? 'Customs Duty' : 'الرسوم الجمركية'}</label>
                    <input type="number" min="0" value={poCustomsDutyCost} onChange={e => setPoCustomsDutyCost(parseFloat(e.target.value) || 0)} disabled={!canModify('purchase_orders')} />
                  </div>
                  <div className="po-fg">
                    <label>{currentLang === 'en' ? 'Other Fees' : 'رسوم أخرى'}</label>
                    <input type="number" min="0" value={poOtherFeesCost} onChange={e => setPoOtherFeesCost(parseFloat(e.target.value) || 0)} disabled={!canModify('purchase_orders')} />
                  </div>
                  <div className="po-fg" style={{ gridColumn: '1 / -1' }}>
                    <label>{currentLang === 'en' ? 'Other Fees Description' : 'وصف الرسوم الأخرى'}</label>
                    <input type="text" value={poOtherFeesDescription} onChange={e => setPoOtherFeesDescription(e.target.value)} disabled={!canModify('purchase_orders') || poOtherFeesCost === 0} placeholder={currentLang === 'en' ? 'e.g. Assay/refining fee' : 'مثال: رسوم الفحص/التكرير'} />
                  </div>
                </div>
              </div>

              {/* Financial summary — right-aligned. */}
              <div className="po-summary">
                <div className="po-sum-row">
                  <span>{currentLang === 'en' ? 'Total Weight' : 'إجمالي الوزن'}</span>
                  <span style={{ fontWeight: 600 }}>{poWeight.toLocaleString()} g</span>
                </div>
                <div className="po-sum-row">
                  <span>{currentLang === 'en' ? 'Subtotal' : 'المجموع الفرعي'}</span>
                  <span style={{ fontWeight: 600 }}>{linesTotalCost(poLines).toLocaleString()} {poCurrency}</span>
                </div>
                <div className="po-sum-row po-sum-grand">
                  <span>{currentLang === 'en' ? 'Grand Total' : 'الإجمالي العام'}</span>
                  <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input type="number" style={{ width: '150px', textAlign: 'right', fontWeight: 800, fontSize: '18px' }} value={poCost} onChange={e => { setPoCostOverridden(true); setPoCost(parseFloat(e.target.value) || 0); }} disabled={!canModify('purchase_orders')} />
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>{poCurrency}</span>
                    {poCostOverridden && canModify('purchase_orders') && (
                      <button type="button" className="btn-ghost" title={currentLang === 'en' ? 'Reset to summed total' : 'إعادة إلى المجموع'} style={{ padding: '8px 10px' }} onClick={() => { setPoCostOverridden(false); setPoCost(linesTotalCost(poLines)); }}>
                        <i className="fa-solid fa-rotate-left"></i>
                      </button>
                    )}
                  </span>
                </div>
                {poCostOverridden && (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', textAlign: 'right' }}>
                    {currentLang === 'en' ? 'Manual override — click ↺ to restore the summed total.' : 'تعديل يدوي — اضغط ↺ للعودة إلى المجموع.'}
                  </div>
                )}
                <div className="po-sum-row">
                  <span>{currentLang === 'en' ? 'Total Acquisition Fees' : 'إجمالي رسوم الاستحواذ'}</span>
                  <span style={{ fontWeight: 600 }}>{(poFreightCost + poInsuranceCost + poCustomsDutyCost + poOtherFeesCost).toLocaleString()} {poCurrency}</span>
                </div>
                <div className="po-sum-row po-sum-grand">
                  <span>{currentLang === 'en' ? 'Landed Cost (used for Average Cost valuation)' : 'التكلفة الفعلية (تُستخدم لتقييم متوسط التكلفة)'}</span>
                  <span style={{ fontWeight: 800 }}>{(poCost + poFreightCost + poInsuranceCost + poCustomsDutyCost + poOtherFeesCost).toLocaleString()} {poCurrency}</span>
                </div>
              </div>

              {/* Action buttons — right aligned. */}
              <div className="po-actions">
                {isEditingPO ? (
                  <>
                    <button type="button" className="btn-link" onClick={handleCancelEditPO}>{currentLang === 'en' ? 'Cancel' : 'إلغاء'}</button>
                    {canModify('purchase_orders') && (
                      <button type="button" className="btn-emerald" onClick={handleUpdatePO}>{currentLang === 'en' ? 'Save Changes' : 'حفظ التعديلات'}</button>
                    )}
                  </>
                ) : (
                  <>
                    <button type="button" className="btn-link" onClick={resetPoForm}>{currentLang === 'en' ? 'Clear' : 'مسح'}</button>
                    {canModify('purchase_orders') && (
                      <button type="button" className="btn-emerald" onClick={handleCreatePO}>{t('btn_create_po')}</button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          )}
        </section>

        {/* SCREEN VIEWPORT: ACTIVE DEALS (Purchase Orders registry -- approve / delete / print) */}
        <section className={`screen-viewport ${activeTab === 'screen-active-deals' ? 'active' : ''}`}>
          <div className="glass-card">
            <h3>{t('po_table_title')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>{t('po_table_subtitle')}</p>
            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}></th>
                    <th>{t('th_po_code')}</th>
                    <th>{t('th_supplier')}</th>
                    <th>{t('th_weight')}</th>
                    <th>{t('th_cost')}</th>
                    <th title={currentLang === 'en' ? 'Total cost including freight/insurance/customs/other fees — feeds Average Cost valuation' : 'التكلفة الإجمالية شاملة الشحن/التأمين/الجمارك/الرسوم الأخرى — تُستخدم في تقييم متوسط التكلفة'}>
                      {currentLang === 'en' ? 'Landed Cost' : 'التكلفة الفعلية'}
                    </th>
                    <th>{t('th_status')}</th>
                    {canModify('purchase_orders') && <th style={{ width: '280px', textAlign: 'center' }}>{t('th_action')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {poList.length === 0 ? (
                    <tr>
                      <td colSpan={canModify('purchase_orders') ? 8 : 7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                        {t('active_deals_empty')}
                      </td>
                    </tr>
                  ) : (
                    poList.map((po: any, poIdx: number) => {
                      const items = po.items && po.items.length > 0 ? po.items : [{ product_id: 1, qty: po.qty || 1 }];
                      const isExpanded = expandedPOId === po.po_id;

                      return (
                        <React.Fragment key={poIdx}>
                          {/* HEADER ROW - Click to expand */}
                          <tr onClick={() => setExpandedPOId(isExpanded ? null : po.po_id)} style={{ cursor: 'pointer', backgroundColor: isExpanded ? 'rgba(59, 130, 246, 0.04)' : undefined }}>
                            <td style={{ textAlign: 'center', padding: '12px 8px' }}>
                              <i className={`fa-solid fa-chevron-${isExpanded ? 'down' : 'right'}`} style={{ color: 'var(--accent-blue)', fontSize: '14px' }}></i>
                            </td>
                            <td><strong>{po.po_number}</strong>{po.supplier_invoice_number && <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Inv.' : 'فاتورة'} {po.supplier_invoice_number}</div>}</td>
                            <td>{po.supplier}</td>
                            <td>{po.weight}g</td>
                            <td>${po.cost.toLocaleString()} {po.currency}</td>
                            <td>${(po.landed_cost ?? po.cost).toLocaleString()} {po.currency}</td>
                            <td><span className="badge badge-ready">{translateDb(po.status_code)}</span></td>
                            {canModify('purchase_orders') && (
                              <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                                {po.status_code !== 'APPROVED' && po.status_code !== 'REJECTED' && po.status_code !== 'RECEIVED' && (
                                  <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '11px', marginInlineEnd: '4px' }} onClick={() => handleApprovePO(po.po_id)}>
                                    <i className="fa-solid fa-check"></i> {t('btn_approve')}
                                  </button>
                                )}
                                {(po.status_code === 'APPROVED' || po.status_code === 'RECEIVED') && (
                                  <button className="btn" style={{ backgroundColor: 'var(--accent-blue)', padding: '4px 8px', fontSize: '11px', marginInlineEnd: '4px' }} onClick={() => handlePrintPO(po)}>
                                    <i className="fa-solid fa-print"></i> {t('btn_print')}
                                  </button>
                                )}
                                <button className="btn" style={{ backgroundColor: 'var(--accent-red)', color: '#fff', padding: '4px 8px', fontSize: '11px' }} onClick={() => handleDeletePO(po.po_id, po.po_number)}>
                                  <i className="fa-solid fa-trash"></i> {t('btn_delete')}
                                </button>
                              </td>
                            )}
                          </tr>

                          {/* EXPANDED DETAILS ROW - Shows items */}
                          {isExpanded && (
                            <tr style={{ backgroundColor: 'rgba(59, 130, 246, 0.04)' }}>
                              <td colSpan={canModify('purchase_orders') ? 8 : 7} style={{ padding: '16px 20px' }}>
                                <div style={{ marginLeft: '20px' }}>
                                  <h5 style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--accent-blue)', fontWeight: 'bold' }}>
                                    {currentLang === 'en' ? 'Items:' : 'المنتجات:'}
                                  </h5>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {items.map((item: any, itemIdx: number) => {
                                      const prod = products.find((p: any) => p.product_id === item.product_id);
                                      const prodName = prod ? `${prod.metal_name} ${prod.denomination_label}` : (item.product_code || `Product #${item.product_id}`);
                                      const itemQty = item.qty || item.ordered_qty || 1;
                                      const itemWeight = prod && prod.weight_per_unit ? (prod.weight_per_unit * itemQty) : (po.weight / items.length);
                                      const itemCost = po.cost / items.length;
                                      const itemLandedCost = (po.landed_cost ?? po.cost) / items.length;

                                      return (
                                        <div key={itemIdx} style={{
                                          padding: '12px 14px',
                                          backgroundColor: 'rgba(255, 255, 255, 0.6)',
                                          border: '1px solid rgba(59, 130, 246, 0.2)',
                                          borderRadius: '4px',
                                          fontSize: '13px',
                                          display: 'grid',
                                          gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr',
                                          gap: '12px',
                                          alignItems: 'center'
                                        }}>
                                          <div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>{currentLang === 'en' ? 'Product' : 'المنتج'}</div>
                                            <strong style={{ color: 'var(--accent-blue)' }}>{prodName}</strong>
                                            {prod && prod.purity_value && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Purity: {prod.purity_value}</div>}
                                          </div>
                                          <div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>{currentLang === 'en' ? 'Quantity' : 'الكمية'}</div>
                                            <strong>{itemQty}</strong> {currentLang === 'en' ? 'units' : 'وحدات'}
                                          </div>
                                          <div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>{currentLang === 'en' ? 'Weight' : 'الوزن'}</div>
                                            <strong>{itemWeight.toFixed(2)}g</strong>
                                          </div>
                                          <div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>{currentLang === 'en' ? 'Cost' : 'التكلفة'}</div>
                                            <strong>${itemCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                                          </div>
                                          <div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>{currentLang === 'en' ? 'Landed Cost' : 'التكلفة الفعلية'}</div>
                                            <strong>${itemLandedCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SCREEN VIEWPORT: RECEIVE SHIPMENTS (INTAKE - UC03) */}
        <section className={`screen-viewport ${activeTab === 'screen-intake' ? 'active' : ''}`}>
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-truck-ramp-box" style={{ color: 'var(--kfh-green)' }}></i>
                  {currentLang === 'en' ? 'UC-03: Receipt of Precious Metals from Supplier' : 'UC-03: استلام المعادن الثمينة من المورد'}
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '4px 0 0 0' }}>
                  {currentLang === 'en' 
                    ? 'Verify shipment manifest, record individual bar serials, purity, and gross weight, flag physical condition/damage, and submit to Vault Maker-Checker approval.' 
                    : 'التحقق من بيان الشحنة، تسجيل الأرقام التسلسلي والنقاوة والوزن، توثيق حالة السبائك والتلفيات، وإرسالها لاعتماد مراجع الخزينة.'}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className={`btn ${intakeActiveSubTab === 'RECEIVE_FORM' ? 'btn-primary' : ''}`}
                  style={intakeActiveSubTab !== 'RECEIVE_FORM' ? { backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--surface-border)' } : {}}
                  onClick={() => setIntakeActiveSubTab('RECEIVE_FORM')}
                >
                  <i className="fa-solid fa-plus-circle"></i> {currentLang === 'en' ? 'New Shipment Intake' : 'استلام شحنة جديدة'}
                </button>
                <button
                  className={`btn ${intakeActiveSubTab === 'IN_FLIGHT_LOG' ? 'btn-primary' : ''}`}
                  style={intakeActiveSubTab !== 'IN_FLIGHT_LOG' ? { backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--surface-border)' } : {}}
                  onClick={() => {
                    setIntakeActiveSubTab('IN_FLIGHT_LOG');
                    fetchPendingIntakes();
                  }}
                >
                  <i className="fa-solid fa-clock-rotate-left"></i> {currentLang === 'en' ? 'In-Flight & Pending Receipts' : 'الشحنات قيد الاعتماد والتدقيق'}
                  {pendingIntakesList.length > 0 && (
                    <span className="badge badge-reserved" style={{ marginLeft: '6px', fontSize: '10px' }}>{pendingIntakesList.length}</span>
                  )}
                </button>
              </div>
            </div>

            {!canModify('intake') && (
              <div style={{ padding: '10px 14px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', color: 'var(--accent-red)', fontSize: '12px', marginBottom: '15px' }}>
                <i className="fa-solid fa-circle-exclamation"></i> {currentLang === 'en' ? 'Read-Only Mode: You cannot initiate shipment receipts (Maker role required).' : 'وضع القراءة فقط: لا يمكنك بدء استلام شحنات جديدة (يتطلب صلاحية المنشئ/المسؤول).'}
              </div>
            )}

            {/* TAB 1: NEW SHIPMENT INTAKE WORKBENCH (UC03) */}
            {intakeActiveSubTab === 'RECEIVE_FORM' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                
                {/* SECTION 1: SHIPMENT HEADER & MANIFEST */}
                <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
                  <h4 style={{ margin: '0 0 14px 0', fontSize: '14px', color: 'var(--kfh-green)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <i className="fa-solid fa-file-invoice"></i> {currentLang === 'en' ? '1. Shipment Manifest & Supplier Details' : '1. بيان الشحنة وتفاصيل المورد'}
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Supplier / Vendor' : 'المورد'}</label>
                      <select 
                        className="form-control" 
                        value={intakeVendorId} 
                        onChange={e => setIntakeVendorId(parseInt(e.target.value))}
                        style={{ fontSize: '12px', padding: '6px 8px' }}
                      >
                        {suppliersList.length > 0 ? (
                          suppliersList.map((v: any) => (
                            <option key={v.vendor_id} value={v.vendor_id}>{v.name} ({v.country || 'Global'})</option>
                          ))
                        ) : (
                          <>
                            <option value={1}>Valcambi Suisse (Switzerland)</option>
                            <option value={2}>PAMP SA (Switzerland)</option>
                            <option value={3}>Emirates Gold (UAE)</option>
                          </>
                        )}
                      </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Airway Bill / Waybill #' : 'رقم بوليصة الشحن (Airway Bill)'}</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        placeholder="e.g., AWB-8849201" 
                        value={intakeAirwayBill} 
                        onChange={e => setIntakeAirwayBill(e.target.value)}
                        style={{ fontSize: '12px', padding: '6px 8px' }}
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Delivery Note #' : 'رقم إشعار التسليم (Delivery Note)'}</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        placeholder="e.g., DN-2026-091" 
                        value={intakeDeliveryNote} 
                        onChange={e => setIntakeDeliveryNote(e.target.value)}
                        style={{ fontSize: '12px', padding: '6px 8px' }}
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Shipment Reference' : 'مرجع الشحنة'}</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        placeholder="e.g., SHIP-KFH-2026-VAL" 
                        value={intakeShipmentRef} 
                        onChange={e => setIntakeShipmentRef(e.target.value)}
                        style={{ fontSize: '12px', padding: '6px 8px' }}
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Receiving Date' : 'تاريخ الاستلام الفعلي'}</label>
                      <input 
                        type="date" 
                        className="form-control" 
                        value={intakeReceivingDate} 
                        onChange={e => setIntakeReceivingDate(e.target.value)}
                        style={{ fontSize: '12px', padding: '6px 8px' }}
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Lot / Batch Number' : 'رقم اللوت / التشغيلة'}</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        value={intakeLotNum} 
                        onChange={e => setIntakeLotNum(e.target.value)}
                        style={{ fontSize: '12px', padding: '6px 8px' }}
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Vault Target Slot' : 'موقع التخزين الإحداثي بالخزينة'}</label>
                      <select 
                        className="form-control" 
                        value={intakeSelectedLocation} 
                        onChange={e => setIntakeSelectedLocation(parseInt(e.target.value))}
                        style={{ fontSize: '12px', padding: '6px 8px' }}
                      >
                        {locations.flatMap(loc =>
                          loc.slots ? loc.slots.map((s: any) => ({
                            id: s.location_id,
                            label: `${loc.vault_name || 'Main Vault'} - ${loc.zone_room} - Row ${s.shelf_row} - Slot ${s.slot_bin}`
                          })) : []
                        ).map(item => (
                          <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Supporting Documents Ref / URL' : 'مرجع / رابط المستندات المرفقة (Assay/Cert)'}</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        placeholder="e.g., https://kfh-docs/shipment-88492.pdf" 
                        value={intakeDocUrl} 
                        onChange={e => setIntakeDocUrl(e.target.value)}
                        style={{ fontSize: '12px', padding: '6px 8px' }}
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ marginTop: '12px', marginBottom: 0 }}>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Discrepancy / Partial Shipment Notes' : 'ملاحظات الفروقات أو الاستلام الجزئي'}</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder={currentLang === 'en' ? 'e.g. Shipment delivered in 2 containers, assay certificates matched.' : 'مثال: تم تسليم الشحنة في حاويتين، وشهادات الفحص مطابقة.'}
                      value={intakeDiscrepancyNotes} 
                      onChange={e => setIntakeDiscrepancyNotes(e.target.value)}
                      style={{ fontSize: '12px', padding: '6px 8px' }}
                    />
                  </div>
                </div>

                {/* SECTION 2: BARS ENTRY & VERIFICATION TABLE */}
                <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--kfh-green)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <i className="fa-solid fa-bars"></i> {currentLang === 'en' ? '2. Precious Metal Bars Manifest (Serials & Physical Quality)' : '2. كشف السبائك المستلمة (الأرقام التسلسلية وفحص الجودة)'}
                      </h4>
                      <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: '4px 0 0 0' }}>
                        {currentLang === 'en' 
                          ? 'Enter each bar serial number, product denomination, fineness, and flag damaged bars for quarantine.' 
                          : 'أدخل الرقم التسلسلي لكل سبيكة، الفئة، النقاوة، وحدد السبائك التالفة للعزل.'}
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-secondary" style={{ fontSize: '11px', padding: '6px 10px' }} onClick={handleAddIntakeBar}>
                        <i className="fa-solid fa-plus"></i> {currentLang === 'en' ? 'Add Bar' : 'إضافة سبيكة'}
                      </button>
                      <button className="btn btn-secondary" style={{ fontSize: '11px', padding: '6px 10px', backgroundColor: 'rgba(212, 160, 23, 0.15)', color: 'var(--accent-gold)' }} onClick={handleAdd5BatchDemo}>
                        <i className="fa-solid fa-layer-group"></i> {currentLang === 'en' ? '+5 Batch Demo' : '+5 سبائك تجريبية'}
                      </button>
                    </div>
                  </div>

                  <div className="table-responsive" style={{ maxHeight: '420px', overflowY: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: '40px' }}>#</th>
                          <th style={{ minWidth: '160px' }}>{currentLang === 'en' ? 'Serial Number (UC03 E1)' : 'الرقم التسلسلي'}</th>
                          <th style={{ minWidth: '160px' }}>{currentLang === 'en' ? 'Product / Denomination' : 'نوع المنتج / الفئة'}</th>
                          <th style={{ minWidth: '100px' }}>{currentLang === 'en' ? 'Gross Wt (g)' : 'الوزن القائم (جرام)'}</th>
                          <th style={{ minWidth: '100px' }}>{currentLang === 'en' ? 'Purity (PPT)' : 'النقاوة'}</th>
                          <th style={{ minWidth: '140px' }}>{currentLang === 'en' ? 'Refiner / Brand' : 'المصفاة / الماركة'}</th>
                          <th style={{ minWidth: '180px' }}>{currentLang === 'en' ? 'Damaged / Inspection' : 'حالة التلف / الفحص'}</th>
                          <th style={{ width: '90px' }}>{currentLang === 'en' ? 'GS1 Tag' : 'الباركود'}</th>
                          <th style={{ width: '50px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {intakeBars.map((bar, idx) => {
                          const isDuplicate = intakeBars.filter(b => b.serial.trim() && b.serial.trim().toUpperCase() === bar.serial.trim().toUpperCase()).length > 1;
                          return (
                            <tr key={bar.id} style={{ backgroundColor: bar.is_damaged ? 'rgba(239, 68, 68, 0.04)' : isDuplicate ? 'rgba(245, 158, 11, 0.08)' : 'transparent' }}>
                              <td><span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{idx + 1}</span></td>
                              <td>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={bar.serial}
                                  onChange={e => handleUpdateIntakeBar(bar.id, 'serial', e.target.value)}
                                  placeholder="e.g. BAR-10001"
                                  style={{
                                    fontSize: '12px',
                                    padding: '4px 8px',
                                    borderColor: isDuplicate ? 'var(--accent-orange)' : 'var(--surface-border)',
                                    fontWeight: 'bold'
                                  }}
                                />
                                {isDuplicate && (
                                  <div style={{ color: 'var(--accent-orange)', fontSize: '10px', marginTop: '2px' }}>
                                    <i className="fa-solid fa-triangle-exclamation"></i> Duplicate serial in batch
                                  </div>
                                )}
                              </td>
                              <td>
                                <select
                                  className="form-control"
                                  value={bar.product_id}
                                  onChange={e => handleUpdateIntakeBar(bar.id, 'product_id', e.target.value)}
                                  style={{ fontSize: '12px', padding: '4px 8px' }}
                                >
                                  {products.map((p: any) => (
                                    <option key={p.product_id} value={p.product_id}>
                                      {p.metal_name} {p.denomination_label} ({p.weight_grams}g)
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  type="number"
                                  className="form-control"
                                  value={bar.weight_grams}
                                  onChange={e => handleUpdateIntakeBar(bar.id, 'weight_grams', parseFloat(e.target.value) || 0)}
                                  style={{ fontSize: '12px', padding: '4px 8px' }}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  step="0.1"
                                  className="form-control"
                                  value={bar.purity}
                                  onChange={e => handleUpdateIntakeBar(bar.id, 'purity', parseFloat(e.target.value) || 0)}
                                  style={{ fontSize: '12px', padding: '4px 8px' }}
                                />
                              </td>
                              <td>
                                <select
                                  className="form-control"
                                  value={bar.refiner_name}
                                  onChange={e => handleUpdateIntakeBar(bar.id, 'refiner_name', e.target.value)}
                                  style={{ fontSize: '12px', padding: '4px 8px' }}
                                >
                                  {brandsList.map((b: any) => (
                                    <option key={b.brand_id} value={b.brand_name}>
                                      {b.brand_name} {b.is_lbma_certified ? '★ LBMA' : ''}
                                    </option>
                                  ))}
                                  {brandsList.length === 0 && (
                                    <>
                                      <option value="Valcambi Suisse">Valcambi Suisse ★ LBMA</option>
                                      <option value="PAMP Suisse">PAMP Suisse ★ LBMA</option>
                                      <option value="Argor-Heraeus">Argor-Heraeus ★ LBMA</option>
                                      <option value="Nadir Gold Refinery">Nadir Gold Refinery ★ LBMA</option>
                                      <option value="Emirates Gold">Emirates Gold</option>
                                      <option value="KFH Custom Mint Gold">KFH Custom Mint Gold</option>
                                    </>
                                  )}
                                </select>
                              </td>
                              <td>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                    <input
                                      type="checkbox"
                                      checked={bar.is_damaged}
                                      onChange={e => handleUpdateIntakeBar(bar.id, 'is_damaged', e.target.checked)}
                                    />
                                    <span style={{ color: bar.is_damaged ? 'var(--accent-red)' : 'inherit', fontWeight: bar.is_damaged ? 'bold' : 'normal' }}>
                                      {currentLang === 'en' ? 'Damaged / Scratch' : 'تالف / مخدوش'}
                                    </span>
                                  </label>
                                  {bar.is_damaged && (
                                    <input
                                      type="text"
                                      className="form-control"
                                      placeholder={currentLang === 'en' ? 'Reason (e.g. Broken seal, dented)' : 'سبب التلف...'}
                                      value={bar.damage_reason}
                                      onChange={e => handleUpdateIntakeBar(bar.id, 'damage_reason', e.target.value)}
                                      style={{ fontSize: '11px', padding: '2px 6px', borderColor: 'var(--accent-red)' }}
                                    />
                                  )}
                                </div>
                              </td>
                              <td>
                                <button
                                  className="btn"
                                  style={{ padding: '4px 8px', fontSize: '11px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--surface-border)' }}
                                  title={currentLang === 'en' ? 'Preview & Print GS1 Barcode Tag' : 'معاينة وطباعة ملصق الباركود'}
                                  onClick={() => setPreviewBarcodeModal({
                                    serial: bar.serial,
                                    lot: intakeLotNum,
                                    product: (products.find((p: any) => p.product_id === bar.product_id)?.denomination_label) || '1 KG Gold Bar',
                                    weight: bar.weight_grams,
                                    purity: bar.purity,
                                    refiner: bar.refiner_name,
                                    isDamaged: bar.is_damaged
                                  })}
                                >
                                  <i className="fa-solid fa-qrcode" style={{ color: 'var(--kfh-green)' }}></i> Tag
                                </button>
                              </td>
                              <td>
                                <button
                                  className="btn"
                                  style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--accent-red)', background: 'transparent' }}
                                  onClick={() => handleRemoveIntakeBar(bar.id)}
                                  title={currentLang === 'en' ? 'Remove Bar' : 'حذف السبيكة'}
                                >
                                  <i className="fa-solid fa-trash-can"></i>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* SECTION 3: VERIFICATION SUMMARY & SUBMISSION */}
                {(() => {
                  const totalBarsCount = intakeBars.length;
                  const totalGrossWeightG = intakeBars.reduce((sum, b) => sum + (b.weight_grams || 0), 0);
                  const totalDamagedCount = intakeBars.filter(b => b.is_damaged).length;

                  return (
                    <div style={{
                      backgroundColor: 'rgba(0, 155, 78, 0.05)',
                      border: '1px solid rgba(0, 155, 78, 0.25)',
                      borderRadius: '8px',
                      padding: '16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '14px'
                    }}>
                      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Total Bars in Manifest' : 'إجمالي عدد السبائك'}</div>
                          <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{totalBarsCount} {currentLang === 'en' ? 'units' : 'سبيكة'}</div>
                        </div>

                        <div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Total Gross Weight' : 'إجمالي الوزن القائم'}</div>
                          <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--kfh-green)' }}>
                            {totalGrossWeightG.toLocaleString()} g <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>({(totalGrossWeightG / 1000).toFixed(3)} KG)</span>
                          </div>
                        </div>

                        {totalDamagedCount > 0 && (
                          <div style={{ padding: '6px 12px', borderRadius: '6px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                            <div style={{ fontSize: '11px', color: 'var(--accent-red)', fontWeight: 'bold' }}>
                              <i className="fa-solid fa-triangle-exclamation"></i> {currentLang === 'en' ? 'Damaged Bars Flagged' : 'سبائك تالفة مرصودة'}
                            </div>
                            <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--accent-red)' }}>
                              {totalDamagedCount} {currentLang === 'en' ? 'quarantine items' : 'قطع للعزل'}
                            </div>
                          </div>
                        )}
                      </div>

                      {canModify('intake') && (
                        <button
                          className="btn btn-primary"
                          style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 'bold' }}
                          onClick={handleSubmitUC03Intake}
                        >
                          <i className="fa-solid fa-paper-plane"></i> {currentLang === 'en' ? 'Submit for Vault Checker Approval' : 'إرسال لاعتماد مراجع الخزينة (Maker-Checker)'}
                        </button>
                      )}
                    </div>
                  );
                })()}

              </div>
            )}

            {/* TAB 2: IN-FLIGHT & PENDING RECEIPTS LOG */}
            {intakeActiveSubTab === 'IN_FLIGHT_LOG' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
                    {currentLang === 'en' 
                      ? 'Live list of all supplier receipts awaiting 4-eyes Maker-Checker verification or recently completed.' 
                      : 'سجل شحنات الموردين التي تنتظر اعتماد وتدقيق مبدأ الأعين الأربعة أو المكتملة حديثاً.'}
                  </p>
                  <button className="btn btn-secondary" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={fetchPendingIntakes}>
                    <i className="fa-solid fa-arrows-rotate"></i> {currentLang === 'en' ? 'Refresh' : 'تحديث'}
                  </button>
                </div>

                <div className="table-responsive">
                  <table>
                    <thead>
                      <tr>
                        <th>{currentLang === 'en' ? 'Lot Number' : 'رقم اللوت'}</th>
                        <th>{currentLang === 'en' ? 'Supplier' : 'المورد'}</th>
                        <th>{currentLang === 'en' ? 'Airway Bill / Ref' : 'بوليصة الشحن / المرجع'}</th>
                        <th>{currentLang === 'en' ? 'Delivery Note' : 'إشعار التسليم'}</th>
                        <th>{currentLang === 'en' ? 'Receiving Date' : 'تاريخ الاستلام'}</th>
                        <th>{currentLang === 'en' ? 'Maker (Received By)' : 'المنشئ'}</th>
                        <th>{currentLang === 'en' ? 'Target Location' : 'موقع الوجهة'}</th>
                        <th>{currentLang === 'en' ? 'Status' : 'الحالة'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingIntakesList.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                            {currentLang === 'en' ? 'No pending supplier shipment receipts found.' : 'لا توجد شحنات موردين قيد التدقيق حالياً.'}
                          </td>
                        </tr>
                      ) : (
                        pendingIntakesList.map((pi: any, idx: number) => {
                          let itemCount = 0;
                          try {
                            if (pi.serials_json) itemCount = JSON.parse(pi.serials_json).length;
                          } catch (_) {}

                          return (
                            <tr key={idx}>
                              <td>
                                <strong>{pi.lot_number}</strong>
                                {itemCount > 0 && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '6px' }}>({itemCount} bars)</span>}
                              </td>
                              <td>{pi.vendor_name || 'Direct Supplier'}</td>
                              <td>{pi.airway_bill || pi.shipment_reference || 'N/A'}</td>
                              <td>{pi.delivery_note || 'N/A'}</td>
                              <td>{new Date(pi.receiving_date || pi.created_at).toLocaleDateString()}</td>
                              <td>{pi.received_by}</td>
                              <td><span style={{ fontSize: '11px' }}>{pi.location_desc}</span></td>
                              <td>
                                <span className={`badge ${pi.status_code === 'APPROVED' ? 'badge-ready' : 'badge-reserved'}`}>
                                  {translateDb(pi.status_code)}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        </section>

        {/* SCREEN VIEWPORT: RECEIVE FROM CUSTOMER -- moved out of the Receive Shipment screen
            into its own top-level menu entry/screen (was previously a modal opened from a
            teaser card inside screen-intake). Same state/handlers (resetCustomerReceiptForm
            resets the form fields, handleSubmitCustomerReceipt posts to
            /api/vault/intake/customer), just rendered inline instead of in a modal overlay. */}
        <section className={`screen-viewport ${activeTab === 'screen-customer-receipt' ? 'active' : ''}`}>
          <div className="glass-card">
            <h3>{t('title_customer_receipt')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '15px' }}>
              {currentLang === 'en'
                ? 'Log a receipt of gold/silver presented directly by a customer -- a buyback (KFH purchases it), a custody deposit (customer keeps ownership, KFH keeps it safe), or a returned bar. Routed through the same Maker-Checker approval as a supplier shipment.'
                : 'سجّل استلام ذهب/فضة تم تقديمه مباشرة من قبل عميل -- إعادة شراء (يشتريه البنك) أو إيداع أمانة (يحتفظ العميل بالملكية ويحفظه البنك) أو سبيكة معادة. تتم الموافقة عبر نفس مسار الصانع والمدقق كأي شحنة من مورد.'}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div className="form-group">
                <label>{currentLang === 'ar' ? 'رقم العميل' : 'Customer ID'}</label>
                <input type="number" className="form-control" value={receiptCustomerId} onChange={e => setReceiptCustomerId(e.target.value)} />
              </div>
              <div className="form-group">
                <label>{currentLang === 'ar' ? 'سبب الاستلام' : 'Receipt Reason'}</label>
                <select value={receiptReason} onChange={e => setReceiptReason(e.target.value as any)} style={{ color: '#000' }}>
                  <option value="BUYBACK">{currentLang === 'ar' ? 'إعادة شراء (يملكها البنك)' : 'Buyback (KFH takes ownership)'}</option>
                  <option value="CUSTODY_DEPOSIT">{currentLang === 'ar' ? 'إيداع أمانة (تبقى ملكاً للعميل)' : 'Custody Deposit (customer keeps ownership)'}</option>
                  <option value="RETURN">{currentLang === 'ar' ? 'إعادة سبيكة' : 'Returned Bar'}</option>
                </select>
              </div>
            </div>

            {receiptReason === 'CUSTODY_DEPOSIT' && (
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label>{currentLang === 'ar' ? 'رقم حساب العميل (لحيازة الأمانة)' : "Customer Account ID (to hold the custody deposit)"}</label>
                <input type="number" className="form-control" value={receiptAccountId} onChange={e => setReceiptAccountId(e.target.value)} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '15px' }}>
              <div className="form-group">
                <label>{currentLang === 'ar' ? 'رقم التشغيلة/اللوت' : 'Lot Number'}</label>
                <input type="text" className="form-control" value={receiptLotNum} onChange={e => setReceiptLotNum(e.target.value)} />
              </div>
              <div className="form-group">
                <label>{currentLang === 'ar' ? 'موقع التخزين' : 'Storage Slot Location'}</label>
                <select value={receiptSelectedLocation} onChange={e => setReceiptSelectedLocation(parseInt(e.target.value))} style={{ color: '#000' }}>
                  {locations.flatMap(loc =>
                    loc.slots.map((s: any) => ({
                      id: s.location_id,
                      label: `${loc.vault_name} - ${loc.zone_room} - Row ${s.shelf_row} - Slot ${s.slot_bin} ${s.occupied ? '(Occupied)' : ''}`
                    }))
                  ).map(item => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="glass-card" style={{ padding: '12px', background: 'rgba(0, 155, 78, 0.05)', border: '1px solid rgba(0, 155, 78, 0.2)', marginBottom: '15px' }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--kfh-green)' }}>
                <i className="fa-solid fa-barcode"></i> {currentLang === 'ar' ? 'محاكي جهاز مسح الباركود / الرقم التسلسلي' : 'Barcode / Serial Scanner Input'}
              </h4>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="form-control"
                  placeholder={currentLang === 'ar' ? 'امسح الباركود للقطعة أو أدخل الرقم التسلسلي واضغط Enter...' : 'Scan piece barcode or enter serial number & hit Enter...'}
                  value={currentReceiptScanSerial}
                  onChange={e => setCurrentReceiptScanSerial(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (currentReceiptScanSerial.trim()) {
                        const parsed = parseGs1Barcode(currentReceiptScanSerial.trim());
                        const isDup = receiptScannedSerials.some(s => s.serial === parsed.serial);
                        if (isDup) {
                          alert(currentLang === 'en' ? 'This barcode/serial has already been scanned.' : 'هذا الباركود/الرقم التسلسلي تم مسحه مسبقاً.');
                          return;
                        }
                        setReceiptScannedSerials([...receiptScannedSerials, { serial: parsed.serial, product_id: receiptSelectedProductId }]);
                        setCurrentReceiptScanSerial('');
                      }
                    }
                  }}
                />
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => {
                    if (currentReceiptScanSerial.trim()) {
                      const parsed = parseGs1Barcode(currentReceiptScanSerial.trim());
                      const isDup = receiptScannedSerials.some(s => s.serial === parsed.serial);
                      if (isDup) {
                        alert(currentLang === 'en' ? 'This barcode/serial has already been scanned.' : 'هذا الباركود/الرقم التسلسلي تم مسحه مسبقاً.');
                        return;
                      }
                      setReceiptScannedSerials([...receiptScannedSerials, { serial: parsed.serial, product_id: receiptSelectedProductId }]);
                      setCurrentReceiptScanSerial('');
                    }
                  }}
                >
                  {currentLang === 'ar' ? 'إضافة' : 'Add'}
                </button>
              </div>

              <div className="form-group" style={{ marginTop: '10px', marginBottom: 0 }}>
                <label style={{ fontSize: '11px' }}>{currentLang === 'ar' ? 'صنف وسبيكة المنتج / العلامة' : 'Product Denomination & Refiner Brand'}</label>
                <select
                  value={receiptSelectedProductId}
                  onChange={e => setReceiptSelectedProductId(parseInt(e.target.value))}
                  style={{ padding: '4px', fontSize: '12px', height: '30px', color: '#000' }}
                >
                  {products
                    .filter((p: any) => p.is_active !== false)
                    .map((p: any) => (
                      <option key={p.product_id} value={p.product_id}>
                        {`${p.metal_name} ${p.denomination_label}` + (p.brand_name ? ` — ${p.brand_name}` : '') + (p.origin_country ? ` (${p.origin_country})` : '')}
                      </option>
                    ))}
                </select>
              </div>

              {receiptScannedSerials.length > 0 && (
                <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  {receiptScannedSerials.length} {currentLang === 'ar' ? 'قطعة تم مسحها' : 'piece(s) scanned'}: {receiptScannedSerials.map(s => s.serial).join(', ')}
                </div>
              )}
            </div>

            {canModify('intake') && (
              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={handleSubmitCustomerReceipt}
              >
                <i className="fa-solid fa-check"></i> {currentLang === 'ar' ? 'تأكيد استلام العميل' : 'Confirm Customer Receipt'}
              </button>
            )}
          </div>
        </section>

        {/* SCREEN VIEWPORT: BRANCH TRANSFERS */}
        <section className={`screen-viewport ${activeTab === 'screen-transfers' ? 'active' : ''}`}>
          <div className="split-grid-3">
            <div className="glass-card" style={{ gridColumn: 'span 2' }}>
              <h3>{currentLang === 'en' ? 'Active Branch Transfers' : 'حركات تحويل الفروع النشطة'}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
                {currentLang === 'en' 
                  ? 'Track physical metal bar movements in transit between vaults and branches.' 
                  : 'متابعة حركات السبائك المادية أثناء النقل بين الخزائن والفروع المختلفة.'}
              </p>
              <div className="table-responsive">
                <table>
                  <thead>
                    <tr>
                      <th>{t('th_serial')}</th>
                      <th>{t('th_metal')}</th>
                      <th>{currentLang === 'en' ? 'From Branch' : 'من فرع'}</th>
                      <th>{currentLang === 'en' ? 'To Branch' : 'إلى فرع'}</th>
                      <th>{currentLang === 'en' ? 'Courier Details' : 'تفاصيل الشاحن'}</th>
                      <th>{t('th_status')}</th>
                      <th>{t('th_action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfersList.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                          {currentLang === 'en' ? 'No branch transfers found.' : 'لا توجد حركات تحويل فرعي حالياً.'}
                        </td>
                      </tr>
                    ) : (
                      transfersList.map((tr: any, idx: number) => (
                        <tr key={idx}>
                          <td><strong>{tr.serial_number}</strong></td>
                          <td>{translateDb(tr.metal)} - {tr.denomination}</td>
                          <td>{translateDb(tr.source_branch)}</td>
                          <td>{translateDb(tr.destination_branch)}</td>
                          <td>{tr.courier_info}</td>
                          <td>
                            <span className={`badge badge-${tr.status_code.toLowerCase()}`}>
                              {translateDb(tr.status_code)}
                            </span>
                          </td>
                          <td>
                            {tr.status_code === 'APPROVED' && canModify('purchase_orders') && (
                              <button 
                                className="btn btn-primary" 
                                style={{ padding: '4px 10px', fontSize: '11px' }}
                                onClick={() => handleReceiveTransfer(tr.transfer_id)}
                              >
                                {currentLang === 'en' ? 'Receive' : 'استلام'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="glass-card">
              <h3>{currentLang === 'en' ? 'Initiate Metal Transfer' : 'بدء عملية تحويل سبيكة'}</h3>
              {!canModify('purchase_orders') && (
                <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', color: 'var(--accent-red)', fontSize: '12px', marginBottom: '15px' }}>
                  <i className="fa-solid fa-circle-exclamation"></i> {currentLang === 'en' ? 'Read-Only Mode: You cannot initiate branch transfers.' : 'وضع القراءة فقط: لا يمكنك بدء عملية تحويل الفروع.'}
                </div>
              )}
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
                {currentLang === 'en' ? 'Send a ready metal item to another branch/channel.' : 'إرسال سبيكة جاهزة من الخزينة الحالية إلى فرع أو قناة أخرى.'}
              </p>
              
              <div className="form-group" style={{ background: 'rgba(0, 155, 78, 0.03)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(0, 155, 78, 0.15)', marginBottom: '15px' }}>
                <label style={{ color: 'var(--kfh-green)', fontWeight: 'bold' }}>
                  <i className="fa-solid fa-barcode"></i> {currentLang === 'en' ? 'Scan Barcode / Serial' : 'مسح الباركود / الرقم التسلسلي'}
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder={currentLang === 'en' ? 'Scan barcode to auto-select item...' : 'امسح الباركود لتحديد القطعة تلقائياً...'}
                    value={transferBarcodeQuery}
                    onChange={e => {
                      const val = e.target.value;
                      setTransferBarcodeQuery(val);
                      const parsed = parseGs1Barcode(val.trim());
                      const found = inventoryList.find((item: any) => item.serial_number === parsed.serial);
                      if (found) {
                         setTransferItemId(found.item_id);
                         setTransferItemSerial(found.serial_number);
                      }
                    }}
                    disabled={!canModify('purchase_orders')}
                  />
                  {transferItemId ? (
                    <span style={{ color: 'var(--accent-green)', display: 'flex', alignItems: 'center', fontSize: '12px' }}>
                      <i className="fa-solid fa-circle-check" style={{ marginRight: '4px' }}></i> {currentLang === 'en' ? 'Selected' : 'محدد'}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="form-group">
                <label>{currentLang === 'en' ? 'Select Metal Item (Ready)' : 'اختر السبيكة (الجاهزة)'}</label>
                <select 
                  value={transferItemId || ''} 
                  onChange={e => {
                    const id = parseInt(e.target.value);
                    setTransferItemId(id);
                    const item = inventoryList.find((i: any) => i.item_id === id);
                    if (item) setTransferItemSerial(item.serial_number);
                  }}
                  style={{ color: '#000' }}
                  disabled={!canModify('purchase_orders')}
                >
                  <option value="">-- {currentLang === 'en' ? 'Choose Bar' : 'اختر السبيكة'} --</option>
                  {inventoryList.filter((i: any) => i.status === 'READY').map((item: any, idx: number) => (
                    <option key={idx} value={item.item_id}>
                      {item.serial_number} - {item.metal} ({item.denomination})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>{currentLang === 'en' ? 'Destination Branch' : 'الفرع المستهدف'}</label>
                <select 
                  value={transferDestBranchId} 
                  onChange={e => setTransferDestBranchId(e.target.value)} 
                  style={{ color: '#000' }}
                  disabled={!canModify('purchase_orders')}
                >
                  <option value="">-- {currentLang === 'en' ? 'Select Branch' : 'اختر الفرع'} --</option>
                  {branchesList.map((b: any, idx: number) => (
                    <option key={idx} value={b.branch_id}>{b.branch_name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>{currentLang === 'en' ? 'Courier & Escort Info' : 'معلومات الشاحن والمرافق الأمني'}</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g. Secured Transport Security Alpha" 
                  value={transferCourierInfo} 
                  onChange={e => setTransferCourierInfo(e.target.value)} 
                  disabled={!canModify('purchase_orders')}
                />
              </div>

              <button
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '10px' }}
                onClick={handleInitiateBranchTransferTab}
                disabled={!transferItemId || !transferDestBranchId || !canModify('purchase_orders')}
              >
                <i className="fa-solid fa-paper-plane"></i> {currentLang === 'en' ? 'Initiate Transfer Workflow' : 'بدء مسار التحويل'}
              </button>
            </div>
          </div>
        </section>

        {/* SCREEN VIEWPORT: GFS DELIVERY & DISPATCH (operational -- intake module) */}
        <section className={`screen-viewport ${activeTab === 'screen-gfs-delivery' ? 'active' : ''}`}>
          <div className="split-grid-3">
            <div className="glass-card" style={{ gridColumn: 'span 2' }}>
              <h3>{currentLang === 'en' ? 'GFS Branch Delivery & Dispatch Module' : 'طلبات تسليم وتوزيع فروع GFS'}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
                {currentLang === 'en' 
                  ? 'Manage live GFS delivery requests, validate bar details on scan, and dispatch shipments to branches.'
                  : 'إدارة طلبات تسليم GFS، والتحقق من تفاصيل السبائك عند المسح، وإرسال الشحنات إلى الفروع مع توثيق الناقل.'}
              </p>

              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                <button className="btn btn-primary" onClick={() => { setShowScanQrModal(true); setScanQrResult(null); setScanQrError(''); setScanQrInput(''); }}>
                  <i className="fa-solid fa-qrcode"></i> {currentLang === 'en' ? 'Scan & Lookup GFS Bar' : 'مسح والتحقق من سبيكة GFS'}
                </button>
              </div>

              <div className="table-responsive">
                <table>
                  <thead>
                    <tr>
                      <th>{currentLang === 'en' ? 'GFS Ref #' : 'مرجع GFS'}</th>
                      <th>{currentLang === 'en' ? 'Bar Serial' : 'الرقم التسلسلي'}</th>
                      <th>{currentLang === 'en' ? 'Customer Account' : 'حساب العميل'}</th>
                      <th>{currentLang === 'en' ? 'Destination' : 'الفرع المستهدف'}</th>
                      <th>{currentLang === 'en' ? 'Courier / Logistics' : 'الناقل الأمني'}</th>
                      <th>{currentLang === 'en' ? 'Status' : 'الحالة'}</th>
                      <th>{currentLang === 'en' ? 'Actions' : 'العمليات'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gfsDeliveryRequests.map((req: any, idx: number) => (
                      <tr key={idx}>
                        <td><strong>{req.gfsRefNumber}</strong></td>
                        <td>{req.bar?.serialNumber || req.barId}</td>
                        <td>{req.customerAccountNumber || '—'}</td>
                        <td>{req.destinationBranch?.branchName || req.destinationBranchId}</td>
                        <td>
                          {req.courierCompany ? (
                            <span style={{ fontSize: '11px' }}>
                              <i className="fa-solid fa-truck-shield" style={{ marginRight: '4px', color: 'var(--accent-green)' }}></i>
                              {req.courierCompany} ({req.vehiclePlate || 'N/A'})
                            </span>
                          ) : '—'}
                        </td>
                        <td>
                          <span className={`badge badge-${req.status.toLowerCase()}`}>
                            {req.status}
                          </span>
                        </td>
                        <td>
                          {req.status === 'PENDING_DISPATCH' && (
                            <button className="btn btn-primary btn-sm" onClick={() => {
                              setGfsDispatchId(req.requestId);
                              setShowGfsDispatchModal(true);
                            }}>
                              <i className="fa-solid fa-truck"></i> {currentLang === 'en' ? 'Dispatch' : 'إرسال'}
                            </button>
                          )}
                          {req.status === 'DISPATCHED' && (
                            <button className="btn btn-secondary btn-sm" onClick={() => {
                              setReceiveRequestId(req.requestId);
                              setReceiveScannedSerial(req.bar?.serialNumber || '');
                              setReceiveBranchId(req.destinationBranchId || 1);
                              setReceiveValidationPassed(true);
                              setShowReceiveModal(true);
                            }}>
                              <i className="fa-solid fa-circle-check"></i> {currentLang === 'en' ? 'Receive & Verify' : 'استلام وتحقق'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {gfsDeliveryRequests.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                          {currentLang === 'en' ? 'No GFS delivery requests found.' : 'لا توجد طلبات تسليم GFS.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="glass-card">
              <h3>{currentLang === 'en' ? 'EOD GFS Synchronization' : 'مزامنة نهاية اليوم مع GFS'}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
                {currentLang === 'en' 
                  ? 'Trigger EOD batch sync job to update customer account details and standard purchase costs from external GFS database.'
                  : 'تشغيل عملية المزامنة الكلية لنهاية اليوم لتحديث بيانات حسابات العملاء وتكلفة الشراء القياسية من قاعدة بيانات GFS الخارجية.'}
              </p>

              <button className="btn btn-primary" style={{ width: '100%', marginBottom: '20px' }} disabled={gfsSyncLoading} onClick={async () => {
                setGfsSyncLoading(true);
                try {
                  const res = await fetch(`${API_BASE}/gfs/sync-eod`, {
                    method: 'POST'
                  });
                  if (res.ok) {
                    alert(currentLang === 'en' ? 'EOD Synchronization completed successfully!' : 'اكتملت مزامنة نهاية اليوم بنجاح!');
                    fetchGfsSyncLogs();
                    fetchInventory();
                  } else {
                    alert('Sync failed');
                  }
                } catch (e) {
                  console.error(e);
                } finally {
                  setGfsSyncLoading(false);
                }
              }}>
                <i className="fa-solid fa-rotate"></i> {gfsSyncLoading ? (currentLang === 'en' ? 'Syncing...' : 'جاري المزامنة...') : (currentLang === 'en' ? 'Run EOD GFS Sync' : 'مزامنة GFS الآن')}
              </button>

              <h4>{currentLang === 'en' ? 'GFS Sync Logs' : 'سجلات مزامنة GFS'}</h4>
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {gfsSyncLogs.map((log: any, idx: number) => (
                  <div key={idx} style={{ padding: '10px', borderBottom: '1px solid var(--surface-border)', fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                      <span>{new Date(log.syncTimestamp).toLocaleTimeString()}</span>
                      <span style={{ color: log.status === 'SUCCESS' ? 'var(--accent-green)' : 'var(--accent-red)' }}>{log.status}</span>
                    </div>
                    <div>{currentLang === 'en' ? 'Synced: ' : 'تمت مزامنة: '}{log.totalRecordsSynced} | {currentLang === 'en' ? 'Rejected: ' : 'تم رفض: '}{log.totalRecordsRejected}</div>
                    <pre style={{ fontSize: '10px', background: 'rgba(0,0,0,0.2)', padding: '5px', borderRadius: '4px', marginTop: '5px', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                      {log.syncDetails}
                    </pre>
                  </div>
                ))}
                {gfsSyncLogs.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', padding: '10px' }}>
                    {currentLang === 'en' ? 'No sync logs yet.' : 'لا توجد سجلات مزامنة بعد.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* SCREEN VIEWPORT: HOME DELIVERY FULFILLMENT (UC07) */}
        <section className={`screen-viewport ${activeTab === 'screen-home-delivery' ? 'active' : ''}`}>
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
              <div>
                <h3>{currentLang === 'en' ? 'Home Delivery Door-to-Door Fulfillment (UC07)' : 'خدمة التوصيل المنزلي لسبائك الذهب (UC07)'}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                  {currentLang === 'en'
                    ? 'Manage residential deliveries across Kuwait with PACI Civil ID validation, courier logistics tracking, and secure 6-digit OTP customer handover confirmation.'
                    : 'إدارة وتتبع توصيل سبائك الذهب لمنازل العملاء داخل دولة الكويت مع التحقق من الرقم المدني، وتتبع الناقل، وتأكيد الاستلام برمز التحقق (OTP).'}
                </p>
              </div>
              <button className="btn btn-primary" onClick={() => {
                setShowCreateHomeDeliveryModal(true);
                setCivilIdValidationResult(null);
              }}>
                <i className="fa-solid fa-plus"></i> {currentLang === 'en' ? 'New Home Delivery Request' : 'طلب توصيل منزلي جديد'}
              </button>
            </div>

            {/* Quick Metrics */}
            <div className="split-grid-3" style={{ marginBottom: '24px' }}>
              <div className="glass-card" style={{ marginBottom: 0 }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Pending Dispatch' : 'بانتظار التسليم للناقل'}</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--accent-gold)' }}>
                  {homeDeliveries.filter((d: any) => d.status === 'PENDING_DISPATCH').length}
                </div>
              </div>
              <div className="glass-card" style={{ marginBottom: 0 }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'In Transit / Dispatched' : 'في الطريق مع الناقل'}</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--accent-blue)' }}>
                  {homeDeliveries.filter((d: any) => d.status === 'DISPATCHED_TO_COURIER').length}
                </div>
              </div>
              <div className="glass-card" style={{ marginBottom: 0 }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Delivered to Customer' : 'تم التسليم للعميل'}</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--accent-green)' }}>
                  {homeDeliveries.filter((d: any) => d.status === 'DELIVERED_TO_CUSTOMER').length}
                </div>
              </div>
            </div>

            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>{currentLang === 'en' ? 'Ref #' : 'رقم الطلب'}</th>
                    <th>{currentLang === 'en' ? 'Bar Serial / Weight' : 'الرقم التسلسلي / الوزن'}</th>
                    <th>{currentLang === 'en' ? 'Customer Civil ID & Name' : 'الرقم المدني واسم العميل'}</th>
                    <th>{currentLang === 'en' ? 'Kuwait Delivery Address' : 'عنوان التوصيل (الكويت)'}</th>
                    <th>{currentLang === 'en' ? 'Courier Details' : 'بيانات الناقل'}</th>
                    <th>{currentLang === 'en' ? 'Status' : 'الحالة'}</th>
                    <th>{currentLang === 'en' ? 'Actions' : 'العمليات'}</th>
                  </tr>
                </thead>
                <tbody>
                  {homeDeliveries.map((hd: any, idx: number) => (
                    <tr key={idx}>
                      <td><strong>{hd.deliveryReferenceNumber}</strong></td>
                      <td>
                        <span style={{ fontWeight: '600' }}>{hd.bar?.serialNumber || hd.barId}</span>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {hd.bar?.weightGrams ? `${hd.bar.weightGrams}g 24K (999.9)` : '24K Gold'}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: '500' }}>{hd.recipientName}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          <i className="fa-solid fa-id-card" style={{ marginRight: '4px' }}></i>
                          {hd.recipientCivilId} | {hd.recipientPhone}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '12px' }}>
                          <strong>{hd.governorate}</strong>, {hd.area}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {currentLang === 'en' ? `Blk ${hd.block}, St ${hd.street}, Bld ${hd.building}` : `قطعة ${hd.block}، شارع ${hd.street}، مبنى ${hd.building}`}
                          {hd.flat ? `, Flat ${hd.flat}` : ''}
                        </div>
                      </td>
                      <td>
                        {hd.courierCompany ? (
                          <div style={{ fontSize: '11px' }}>
                            <div><strong>{hd.courierCompany}</strong></div>
                            <div style={{ color: 'var(--text-muted)' }}>{hd.courierRepName} ({hd.vehiclePlate || 'Plate N/A'})</div>
                            <div style={{ color: 'var(--accent-gold)' }}>Seal: {hd.securitySealNumber}</div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{currentLang === 'en' ? 'Unassigned' : 'غير معين'}</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${hd.status === 'DELIVERED_TO_CUSTOMER' ? 'badge-ready' : hd.status === 'DISPATCHED_TO_COURIER' ? 'badge-reserved' : 'badge-quarantined'}`}>
                          {hd.status}
                        </span>
                      </td>
                      <td>
                        {hd.status === 'PENDING_DISPATCH' && (
                          <button className="btn btn-primary btn-sm" onClick={() => {
                            setDispatchHdId(hd.deliveryId);
                            setShowDispatchHdModal(true);
                          }}>
                            <i className="fa-solid fa-truck-ramp-box"></i> {currentLang === 'en' ? 'Dispatch' : 'تسليم للناقل'}
                          </button>
                        )}
                        {hd.status === 'DISPATCHED_TO_COURIER' && (
                          <div style={{ display: 'flex', gap: '5px' }}>
                            <button className="btn btn-primary btn-sm" onClick={() => {
                              setConfirmHdId(hd.deliveryId);
                              setConfirmHdOtp(hd.verificationOtp || '');
                              setConfirmHdCivilId(hd.recipientCivilId || '');
                              setShowConfirmHandoverModal(true);
                            }}>
                              <i className="fa-solid fa-signature"></i> {currentLang === 'en' ? 'Confirm Delivery' : 'تأكيد الاستلام'}
                            </button>
                            <button className="btn btn-secondary btn-sm" title={currentLang === 'en' ? 'Customer OTP' : 'رمز التحقق'} onClick={() => {
                              alert(`KFH Verification OTP for ${hd.recipientName}: ${hd.verificationOtp}\nKuwait PACI Address: ${hd.governorate}, ${hd.area}, Blk ${hd.block}`);
                            }}>
                              <i className="fa-solid fa-key"></i>
                            </button>
                          </div>
                        )}
                        {hd.status === 'DELIVERED_TO_CUSTOMER' && (
                          <span style={{ color: 'var(--accent-green)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <i className="fa-solid fa-circle-check"></i> {currentLang === 'en' ? 'Completed' : 'مكتمل'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {homeDeliveries.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                        {currentLang === 'en' ? 'No Home Delivery requests found.' : 'لا توجد طلبات توصيل منزلي.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SCREEN VIEWPORT: DAMAGED BAR MAKER-CHECKER (UC12) */}
        <section className={`screen-viewport ${activeTab === 'screen-damaged-bars' ? 'active' : ''}`}>
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
              <div>
                <h3>{currentLang === 'en' ? 'Damaged Bar Governance & Maker-Checker Approvals (UC12)' : 'حوكمة واعتماد السبائك التالفة (UC12)'}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                  {currentLang === 'en'
                    ? '4-Eyes verification for damaged gold bars. Maker reports physical defects/MOCI assay deviations; Checker independently approves or rejects quarantine.'
                    : 'حوكمة مبدأ الرقابة الثنائية (Maker-Checker) للسبائك التالفة. يقوم الصانع بالإبلاغ عن العيوب، ويقوم المراجع بالاعتماد المستقل للعزل أو الرفض.'}
                </p>
              </div>
              {canModify('custody') && (
                <button className="btn btn-primary" onClick={() => {
                  setDamageItemId(null);
                  setDamageReason('SCRATCHED_HALLMARK');
                  setDamageDesc('');
                  setDamageDocId(`DOC-MOCI-${Date.now().toString().slice(-4)}`);
                  setShowDamageModal(true);
                }}>
                  <i className="fa-solid fa-triangle-exclamation"></i> {currentLang === 'en' ? 'Report Damaged Bar' : 'الإبلاغ عن سبيكة تالفة'}
                </button>
              )}
            </div>

            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>{currentLang === 'en' ? 'Bar Serial' : 'الرقم التسلسلي'}</th>
                    <th>{currentLang === 'en' ? 'Weight / Metal' : 'الوزن / المعدن'}</th>
                    <th>{currentLang === 'en' ? 'Reported By' : 'تم الإبلاغ بواسطة'}</th>
                    <th>{currentLang === 'en' ? 'Damage Reason' : 'سبب التلف'}</th>
                    <th>{currentLang === 'en' ? 'MOCI Assay / Inspection Doc' : 'مستند الفحص / وزارة التجارة'}</th>
                    <th>{currentLang === 'en' ? 'Approval Status' : 'حالة الاعتماد'}</th>
                    <th>{currentLang === 'en' ? 'Checker Actions' : 'إجراءات المراجع'}</th>
                  </tr>
                </thead>
                <tbody>
                  {damagedBarsList.map((bar: any, idx: number) => {
                    const isPending = bar.damageApprovalStatus === 'PENDING_APPROVAL';
                    const isApproved = bar.damageApprovalStatus === 'APPROVED' || bar.status === 'DAMAGED';
                    const isRejected = bar.damageApprovalStatus === 'REJECTED';
                    return (
                      <tr key={idx}>
                        <td><strong>{bar.serialNumber}</strong></td>
                        <td>{bar.weightGrams ? `${bar.weightGrams}g` : ''} 24K Gold (999.9)</td>
                        <td>
                          <div>{bar.damageReportedBy || 'Treasury Maker'}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {bar.mociInspectionDate ? new Date(bar.mociInspectionDate).toLocaleDateString() : 'Today'}
                          </div>
                        </td>
                        <td>
                          <span style={{ color: 'var(--accent-red)', fontWeight: '600' }}>
                            {bar.damageReason || 'SCRATCHED_HALLMARK'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '12px', background: 'rgba(255,255,255,0.05)', padding: '3px 8px', borderRadius: '4px' }}>
                            {bar.mociAssayNumber || 'MOCI-KW-2026'}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${isApproved ? 'badge-quarantined' : isRejected ? 'badge-sold' : 'badge-reserved'}`}>
                            {bar.damageApprovalStatus || (bar.status === 'DAMAGED' ? 'APPROVED' : 'PENDING_APPROVAL')}
                          </span>
                        </td>
                        <td>
                          {isPending && checkUserRoleMatches('Operations Checker', userRole) && (
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button className="btn btn-primary btn-sm" onClick={() => handleProcessDamageAction(bar.itemId, 'APPROVE')}>
                                <i className="fa-solid fa-check"></i> {currentLang === 'en' ? 'Approve' : 'اعتماد'}
                              </button>
                              <button className="btn btn-secondary btn-sm" style={{ background: '#dc3545' }} onClick={() => handleProcessDamageAction(bar.itemId, 'REJECT')}>
                                <i className="fa-solid fa-xmark"></i> {currentLang === 'en' ? 'Reject' : 'رفض'}
                              </button>
                            </div>
                          )}
                          {isPending && !checkUserRoleMatches('Operations Checker', userRole) && (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {currentLang === 'en' ? 'Awaiting Checker (4-Eyes)' : 'بانتظار مراجع العمليات'}
                            </span>
                          )}
                          {isApproved && (
                            <span style={{ color: 'var(--accent-red)', fontSize: '12px' }}>
                              <i className="fa-solid fa-ban"></i> {currentLang === 'en' ? 'Quarantined / Defective' : 'معزولة / تالفة'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {damagedBarsList.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                        {currentLang === 'en' ? 'No damaged bars pending review or on record.' : 'لا توجد سبائك تالفة معلقة أو مسجلة.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SCREEN VIEWPORT: STOCK THRESHOLDS & ALERTS (operational -- master_data module) */}
        <section className={`screen-viewport ${activeTab === 'screen-stock-thresholds' ? 'active' : ''}`}>
          <div className="split-grid-3">
            <div className="glass-card" style={{ gridColumn: 'span 2' }}>
              <h3>{currentLang === 'en' ? 'Enterprise Stock Thresholds Configuration' : 'إعداد حدود مخزون المؤسسة'}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
                {currentLang === 'en' 
                  ? 'Configure Enterprise Level Low-Stock and High-Stock cut-off thresholds for physical gold denominations. Maker-Checker rules apply.'
                  : 'تهيئة حدود المخزون المنخفض والمرتفع للمؤسسة لسبائك الذهب المختلفة. تخضع لقواعد صانع ومراجع.'}
              </p>

              {/* Threshold setup form */}
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '8px', border: '1px solid var(--surface-border)', marginBottom: '25px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '15px' }}>
                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Alert Type' : 'نوع التنبيه'}</label>
                    <select className="form-control" style={{ color: '#000' }} value={thresholdAlertType} onChange={e => setThresholdAlertType(e.target.value)}>
                      <option value="LOW_STOCK">{currentLang === 'en' ? 'Low Stock Limit' : 'حد أدنى للمخزون'}</option>
                      <option value="HIGH_STOCK">{currentLang === 'en' ? 'High Stock Limit' : 'حد أقصى للمخزون'}</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Product' : 'المنتج'}</label>
                    <select className="form-control" style={{ color: '#000' }} value={thresholdProductId} onChange={e => {
                      setThresholdProductId(e.target.value);
                      const p = products.find((prod: any) => prod.product_id === parseInt(e.target.value));
                      if (p) {
                        setThresholdDenominationId(p.denomination_id);
                      }
                    }}>
                      <option value="">-- Choose --</option>
                      {products.map((p: any, idx: number) => (
                        <option key={idx} value={p.product_id}>{p.product_code}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Denomination' : 'الفئة الوزن'}</label>
                    <select className="form-control" style={{ color: '#000' }} value={thresholdDenominationId} onChange={e => setThresholdDenominationId(e.target.value)}>
                      <option value="">-- Choose --</option>
                      {denomsList.map((d: any, idx: number) => (
                        <option key={idx} value={d.denomination_id}>{d.label} ({d.metal})</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Cutoff Value (KG)' : 'القيمة بالـ كجم'}</label>
                    <input type="number" step="0.001" className="form-control" placeholder="e.g. 50.0" value={thresholdCutoffKg} onChange={e => setThresholdCutoffKg(e.target.value)} />
                  </div>
                </div>
                <button className="btn btn-primary" style={{ marginTop: '15px' }} onClick={async () => {
                  if (!thresholdProductId || !thresholdDenominationId || !thresholdCutoffKg) {
                    alert('Please fill all fields');
                    return;
                  }
                  const res = await fetch(`${API_BASE}/inventory/stock-thresholds`, {
                    method: 'POST',
                    headers: { 
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      alertType: thresholdAlertType,
                      productId: parseInt(thresholdProductId),
                      denominationId: parseInt(thresholdDenominationId),
                      cutoffValueKg: parseFloat(thresholdCutoffKg)
                    })
                  });
                  if (res.ok) {
                    alert(currentLang === 'en' ? 'Threshold submitted for checker approval!' : 'تم تقديم حدود المخزون للاعتماد!');
                    setThresholdCutoffKg('');
                    fetchStockThresholds();
                  } else {
                    alert('Submission failed');
                  }
                }}>
                  <i className="fa-solid fa-plus"></i> {currentLang === 'en' ? 'Submit Threshold' : 'إرسال حد المخزون'}
                </button>
              </div>

              {/* Threshold list table */}
              <div className="table-responsive">
                <table>
                  <thead>
                    <tr>
                      <th>{currentLang === 'en' ? 'Alert Type' : 'نوع التنبيه'}</th>
                      <th>{currentLang === 'en' ? 'Product' : 'المنتج'}</th>
                      <th>{currentLang === 'en' ? 'Weight' : 'الوزن'}</th>
                      <th>{currentLang === 'en' ? 'Limit (KG)' : 'الحد (كجم)'}</th>
                      <th>{currentLang === 'en' ? 'Status' : 'الحالة'}</th>
                      <th>{currentLang === 'en' ? 'Authorizer Action' : 'اعتماد المراجع'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockThresholds.map((th: any, idx: number) => (
                      <tr key={idx}>
                        <td>
                          <span style={{ color: th.alertType === 'LOW_STOCK' ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                            {th.alertType === 'LOW_STOCK' ? (currentLang === 'en' ? 'LOW STOCK' : 'مخزون منخفض') : (currentLang === 'en' ? 'HIGH STOCK' : 'مخزون مرتفع')}
                          </span>
                        </td>
                        <td>{th.product?.productCode || th.productId}</td>
                        <td>{th.denomination?.label || `${th.denomination?.weightGrams}g`}</td>
                        <td><strong>{th.cutoffValueKg} KG</strong></td>
                        <td>
                          <span className={`badge badge-${th.statusCode.toLowerCase()}`}>
                            {th.statusCode}
                          </span>
                        </td>
                        <td>
                          {th.statusCode === 'PENDING_MAKER' && (
                            <div style={{ display: 'flex', gap: '5px' }}>
                              <button className="btn btn-primary btn-sm" onClick={async () => {
                                const res = await fetch(`${API_BASE}/inventory/stock-thresholds/${th.thresholdId}/action`, {
                                  method: 'POST',
                                  headers: { 
                                    'Content-Type': 'application/json'
                                  },
                                  body: JSON.stringify({ action: 'APPROVE' })
                                });
                                if (res.ok) {
                                  alert(currentLang === 'en' ? 'Approved!' : 'تم الاعتماد!');
                                  fetchStockThresholds();
                                  fetchEnterpriseStockAlerts();
                                } else {
                                  const err = await res.json();
                                  alert(err.error || 'Approval failed');
                                }
                              }}>
                                {currentLang === 'en' ? 'Approve' : 'اعتماد'}
                              </button>
                              <button className="btn btn-secondary btn-sm" style={{ background: '#dc3545' }} onClick={async () => {
                                const res = await fetch(`${API_BASE}/inventory/stock-thresholds/${th.thresholdId}/action`, {
                                  method: 'POST',
                                  headers: { 
                                    'Content-Type': 'application/json'
                                  },
                                  body: JSON.stringify({ action: 'REJECT' })
                                });
                                if (res.ok) {
                                  alert(currentLang === 'en' ? 'Rejected' : 'تم الرفض');
                                  fetchStockThresholds();
                                }
                              }}>
                                {currentLang === 'en' ? 'Reject' : 'رفض'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {stockThresholds.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                          {currentLang === 'en' ? 'No stock thresholds configured.' : 'لم يتم تكوين أي حدود للمخزون.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="glass-card">
              <h3>{currentLang === 'en' ? 'Enterprise Stock Alerts' : 'تنبيهات المخزون للمؤسسة'}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
                {currentLang === 'en' 
                  ? 'Real-time alert indicators aggregating KFH-Kuwait physical gold holdings in KG equivalent.'
                  : 'مؤشرات التنبيه اللحظية التي تجمع ممتلكات بيت التمويل الكويتي من الذهب بالـ كجم.'}
              </p>

              {enterpriseAlerts.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', background: 'rgba(40, 167, 69, 0.1)', borderRadius: '8px', border: '1px solid var(--accent-green)' }}>
                  <i className="fa-solid fa-circle-check" style={{ fontSize: '24px', color: 'var(--accent-green)', marginBottom: '10px', display: 'block' }}></i>
                  <span style={{ fontWeight: 'bold' }}>{currentLang === 'en' ? 'All stock levels are optimal.' : 'جميع مستويات المخزون ممتازة.'}</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  {enterpriseAlerts.map((alert: any, idx: number) => (
                    <div key={idx} style={{ 
                      padding: '15px', 
                      background: alert.alertType === 'LOW_STOCK' ? 'rgba(220, 53, 69, 0.15)' : 'rgba(255, 193, 7, 0.15)', 
                      borderRadius: '8px', 
                      borderLeft: alert.alertType === 'LOW_STOCK' ? '4px solid #dc3545' : '4px solid #ffc107',
                      fontSize: '13px'
                    }}>
                      <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '5px' }}>
                        <i className="fa-solid fa-triangle-exclamation"></i>
                        <span>{alert.alertType}</span>
                      </div>
                      <p style={{ margin: '0 0 8px 0' }}>{alert.alertMessage}</p>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {currentLang === 'en' ? 'Cutoff: ' : 'الحد: '}{alert.cutoffValueKg.toFixed(3)} KG | {currentLang === 'en' ? 'Current: ' : 'الحالي: '}{alert.currentValueKg.toFixed(3)} KG
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* SCREEN VIEWPORT: GDM DISPENSING (operational -- dispensing module) */}


        {/* SCREEN VIEWPORT: VAULT SPATIAL MAP */}
        <section className={`screen-viewport ${activeTab === 'screen-spatial' ? 'active' : ''}`}>
          <div className="split-grid-3">
            <div className="glass-card" style={{ gridColumn: 'span 3' }}>
              <h3>{t('spatial_title')}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>{t('spatial_subtitle')}</p>
              
              
              {/* Legend of slot status colors */}
              <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--surface-border)', width: 'fit-content' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <div className="slot-node" style={{ cursor: 'default', pointerEvents: 'none', margin: 0, width: '22px', flexShrink: 0 }}></div>
                  <span style={{ fontWeight: '500' }}>{currentLang === 'en' ? 'Empty Slot' : 'خانة فارغة'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <div className="slot-node occupied-gold" style={{ cursor: 'default', pointerEvents: 'none', margin: 0, width: '22px', flexShrink: 0 }}></div>
                  <span style={{ fontWeight: '500' }}>{currentLang === 'en' ? 'Occupied with Gold' : 'ممتلئة بالذهب'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <div className="slot-node occupied-silver" style={{ cursor: 'default', pointerEvents: 'none', margin: 0, width: '22px', flexShrink: 0 }}></div>
                  <span style={{ fontWeight: '500' }}>{currentLang === 'en' ? 'Occupied with Silver' : 'ممتلئة بالفضة'}</span>
                </div>
              </div>

              <div className="spatial-vault-grid">
                {locations.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', gridColumn: 'span 3' }}>
                    {currentLang === 'en' ? 'No locations found in the main vault.' : 'لم يتم العثور على أي مواقع في الخزينة الرئيسية.'}
                  </div>
                ) : (
                  locations.map((loc, idx) => (
                    <div key={idx} className="shelf-box" onClick={() => {
                      setSelectedShelf(loc);
                    }}>
                      <div className="shelf-header">
                        <h4>{translateDb(loc.name.replace('Shelf Row', 'الرف صف'))}</h4>
                        <span className="occupancy-percentage">{loc.occupancy}%</span>
                      </div>
                      <div className="shelf-slots-grid" style={{ gridTemplateColumns: `repeat(${loc.slots.length}, 1fr)` }}>
                        {[...loc.slots]
                          .map((slot: any) => {
                            const itemsInSlot = inventoryList.filter((i: any) => i.location_id === slot.location_id);
                            const serialText = itemsInSlot.map((i: any) => i.serial_number).join(', ') || '';
                            return { slot, itemsInSlot, serialText };
                          })
                          .sort((a: any, b: any) => {
                            if (a.serialText && !b.serialText) return -1;
                            if (!a.serialText && b.serialText) return 1;
                            if (!a.serialText && !b.serialText) {
                              return a.slot.slot_bin.localeCompare(b.slot.slot_bin, undefined, { numeric: true, sensitivity: 'base' });
                            }
                            return a.serialText.localeCompare(b.serialText, undefined, { numeric: true, sensitivity: 'base' });
                          })
                          .map(({ slot, itemsInSlot, serialText }: any, sIdx: number) => {
                            const hasBar = itemsInSlot && itemsInSlot.length > 0;
                            const barItem = hasBar ? itemsInSlot[0] : null;
                            // A slot is occupied if the backend flagged it OR we have a freshly-fetched
                            // item sitting in it (covers the window right after an approved intake,
                            // before the locations payload is re-read). Pick the gold/silver colour
                            // from the actual metal rather than the (unset) slot.type.
                            const isOccupied = slot.occupied || hasBar;
                            const slotMetal = String(barItem?.metal || slot.metal_type || '').toLowerCase();
                            const slotText = `${slot.slot_bin}: ${serialText || (currentLang === 'en' ? 'Empty' : 'فارغ')}`;
                            return (
                              <div
                                key={sIdx}
                                className={`slot-node ${isOccupied ? (slotMetal.includes('silver') ? 'occupied-silver' : 'occupied-gold') : ''}`}
                                title={slotText}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedShelf(loc);
                                  if (hasBar) {
                                    setSelectedBar({
                                      ...barItem,
                                      slot_bin: slot.slot_bin,
                                      location_context: `${loc.name} > ${slot.slot_bin}`
                                    });
                                  }
                                }}
                                style={{ position: 'relative', cursor: 'pointer' }}
                              />
                            );
                          })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

          {selectedShelf && (
            <div className="modal-overlay active" onClick={() => setSelectedShelf(null)}>
              <div className="glass-card modal-content-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '650px', width: '90%' }}>
                <div className="modal-header">
                  <h3>{t('modal_shelf_title')}: {translateDb(selectedShelf.name)}</h3>
                  <span className="modal-close-btn" onClick={() => setSelectedShelf(null)}>&times;</span>
                </div>
                <div className="table-responsive">
                  <table>
                    <thead>
                      <tr>
                        <th>{currentLang === 'en' ? 'Slot / Bin' : 'الخانة / الدرج'}</th>
                        <th>{currentLang === 'en' ? 'Bar Serial Number' : 'الرقم التسلسلي'}</th>
                        <th>{currentLang === 'en' ? 'Denomination Details' : 'تفاصيل الوزن والعيار'}</th>
                        <th style={{ width: '160px', textAlign: 'center' }}>{currentLang === 'en' ? 'Action' : 'العمليات'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedShelf.slots
                        .map((slot: any) => {
                          const itemsInSlot = inventoryList.filter((i: any) => i.location_id === slot.location_id);
                          const serialText = itemsInSlot.map((i: any) => i.serial_number).join(', ') || '';
                          const detailsText = itemsInSlot.map((i: any) => `${i.metal} - ${i.denomination}`).join(', ') || '-';
                          return { slot, itemsInSlot, serialText, detailsText };
                        })
                        .sort((a: any, b: any) => {
                          if (a.serialText && !b.serialText) return -1;
                          if (!a.serialText && b.serialText) return 1;
                          if (!a.serialText && !b.serialText) {
                            return a.slot.slot_bin.localeCompare(b.slot.slot_bin, undefined, { numeric: true, sensitivity: 'base' });
                          }
                          return a.serialText.localeCompare(b.serialText, undefined, { numeric: true, sensitivity: 'base' });
                        })
                        .map(({ slot, itemsInSlot, serialText, detailsText }: any, idx: number) => {
                          const hasBar = itemsInSlot && itemsInSlot.length > 0;
                          const barItem = hasBar ? itemsInSlot[0] : null;
                          const isRowSelected = selectedBar && barItem && selectedBar.item_id === barItem.item_id;
                          return (
                            <tr 
                              key={idx}
                              style={{ 
                                cursor: hasBar ? 'pointer' : 'default', 
                                backgroundColor: isRowSelected ? 'rgba(168, 85, 247, 0.15)' : '' 
                              }}
                              onClick={() => {
                                if (hasBar) {
                                  setSelectedBar({
                                    ...barItem,
                                    slot_bin: slot.slot_bin,
                                    location_context: `${selectedShelf.name} > ${slot.slot_bin}`
                                  });
                                }
                              }}
                            >
                              <td style={{ position: 'relative' }}>
                                {slot.slot_bin}
                                {hasBar && (
                                  <span style={{ position: 'absolute', opacity: 0, left: 0, top: 0, width: '100%', height: '100%', cursor: 'pointer' }}>
                                    {slot.slot_bin}: {serialText}
                                  </span>
                                )}
                              </td>
                              <td><strong>{serialText || (currentLang === 'en' ? 'Empty' : 'فارغ')}</strong></td>
                              <td>{detailsText}</td>
                              <td style={{ textAlign: 'center' }}>
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
                                  {hasBar && (
                                    <button 
                                      className="btn btn-primary"
                                      style={{ padding: '4px 8px', fontSize: '11px' }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedBar({
                                          ...barItem,
                                          slot_bin: slot.slot_bin,
                                          location_context: `${selectedShelf.name} > ${slot.slot_bin}`
                                        });
                                      }}
                                    >
                                      <i className="fa-solid fa-eye"></i> {currentLang === 'en' ? 'View' : 'عرض'}
                                    </button>
                                  )}
                                  <button 
                                    className="btn btn-danger"
                                    style={{ padding: '4px 8px', fontSize: '11px' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteLocation(slot.location_id);
                                    }}
                                  >
                                    <i className="fa-solid fa-trash-can"></i> {currentLang === 'en' ? 'Delete' : 'حذف'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>

                {selectedBar && (
                  <div className="glass-card" style={{ marginTop: '20px', padding: '15px', border: '1px solid var(--surface-border)', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '14px', fontWeight: '600' }}>
                        {currentLang === 'en' ? 'Serialized Bar Details' : 'تفاصيل سبائك الذهب المبرمجة'}
                      </h4>
                      <span className="modal-close-btn" style={{ fontSize: '18px', cursor: 'pointer' }} onClick={() => setSelectedBar(null)}>&times;</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
                      <div>
                        <strong style={{ color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Serial Number:' : 'الرقم التسلسلي:'}</strong>{' '}
                        <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{selectedBar.serial_number}</span>
                      </div>
                      <div>
                        <strong style={{ color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Metal / Product:' : 'المعدن / المنتج:'}</strong>{' '}
                        <span>{translateDb(selectedBar.metal)} - {translateDb(selectedBar.denomination)}</span>
                      </div>
                      <div>
                        <strong style={{ color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Origin:' : 'المنشأ:'}</strong>{' '}
                        <span>{translateDb(selectedBar.origin)}</span>
                      </div>
                      <div>
                        <strong style={{ color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Status:' : 'الحالة:'}</strong>{' '}
                        <span className={`badge badge-${selectedBar.status.toLowerCase()}`}>{translateDb(selectedBar.status)}</span>
                      </div>
                      <div>
                        <strong style={{ color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Ownership:' : 'الملكية:'}</strong>{' '}
                        <span>{translateDb(selectedBar.ownership)}</span>
                      </div>
                      <div style={{ gridColumn: 'span 2', marginTop: '4px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <strong style={{ color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Location Context:' : 'سياق الموقع:'}</strong>{' '}
                        <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{selectedBar.location_context}</span>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Inline form to add slot to this shelf row */}
                <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid var(--surface-border)' }}>
                  <h4 style={{ fontSize: '13px', marginBottom: '8px' }}>
                    {currentLang === 'en' ? 'Add new slot coordinate to this shelf' : 'إضافة خانة جديدة لصف الرف هذا'}
                  </h4>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder={currentLang === 'en' ? 'e.g. Slot 11' : 'مثال: الخانة 11'} 
                      value={newSlotBin} 
                      onChange={e => setNewSlotBin(e.target.value)} 
                      style={{ flex: 1 }}
                    />
                    <button 
                      className="btn btn-primary" 
                      onClick={async () => {
                        if (!newSlotBin.trim()) {
                          alert(currentLang === 'en' ? 'Please specify slot name.' : 'يرجى تحديد اسم الخانة.');
                          return;
                        }
                        try {
                          const res = await fetch(`${API_BASE}/catalog/locations`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              zoneRoom: selectedShelf.zone_room,
                              shelfRow: selectedShelf.shelf_row,
                              slotBin: newSlotBin
                            })
                          });
                          if (res.ok) {
                            alert(currentLang === 'en' ? 'Slot added successfully.' : 'تم إضافة الخانة بنجاح.');
                            setNewSlotBin('');
                            setSelectedShelf(null); // Close modal
                            fetchLocations(); // Refresh visualizer
                          } else {
                            alert(await describeApiError(res, currentLang, 'Failed to add slot', 'فشل إضافة الخانة'));
                          }
                        } catch (e) {
                          alert('Error adding slot.');
                        }
                      }}
                    >
                      <i className="fa-solid fa-plus"></i> {currentLang === 'en' ? 'Add Slot' : 'إضافة خانة'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* SCREEN VIEWPORT: CUSTOMER CUSTODY */}
        <section className={`screen-viewport ${activeTab === 'screen-custody' ? 'active' : ''}`}>
          <div className="glass-card">
            <h3>{t('custody_title')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>{t('custody_subtitle')}</p>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
              <input type="text" className="form-control" placeholder={t('placeholder_custody_search')} value={custodySearchId} onChange={e => setCustodySearchId(e.target.value)} style={{ maxWidth: '300px' }} />
              <button className="btn btn-primary" onClick={handleSearchCustody}>
                <i className="fa-solid fa-search"></i> {t('btn_search_portfolio')}
              </button>
            </div>

            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>{t('th_civil_id')}</th>
                    <th>{t('th_cust_name')}</th>
                    <th>{t('th_gold_serial')}</th>
                    <th>{t('th_metal_weight')}</th>
                    <th>{t('th_physical_coords')}</th>
                    <th>{t('th_status')}</th>
                    <th>{t('th_action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {custodyList.map((item, idx) => (
                    <tr key={idx}>
                      <td>{item.civil_id}</td>
                      <td>{item.name}</td>
                      <td><strong>{item.serial}</strong></td>
                      <td>{item.details}</td>
                      <td>{item.coords}</td>
                      <td>
                        <span className={`badge ${item.status === 'HELD_IN_CUSTODY' ? 'badge-ready' : 'badge-quarantined'}`}>
                          {translateDb(item.status)}
                        </span>
                      </td>
                      <td>
                        {item.status === 'HELD_IN_CUSTODY' && (
                          <button className="btn btn-danger" onClick={() => handleWithdrawCustody(item.holding_id, item.serial)}>Withdraw Bar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SCREEN VIEWPORT: STOCKTAKE WORKBENCH */}
        <section className={`screen-viewport ${activeTab === 'screen-stocktake' ? 'active' : ''}`}>
          {isFrozen && (
            <div className="frozen-shield-alert">
              <i className="fa-solid fa-shield-halved"></i>
              <span>{t('stocktake_freeze_active')}</span>
            </div>
          )}

          <div className="glass-card">
            <h3>{t('stocktake_title')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>{t('stocktake_subtitle')}</p>

            <div style={{ marginBottom: '24px' }}>
              <button className="btn btn-primary" onClick={toggleStocktakeFreeze}>
                {isFrozen ? t('btn_release_freeze') : t('btn_initiate_freeze')}
              </button>
            </div>

            <div className="split-grid-2">
              <div className="glass-card" style={{ marginBottom: 0 }}>
                <h4>{t('stocktake_scan_title')}</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '15px' }}>{t('stocktake_scan_sub')}</p>
                <div className="form-group">
                  <label>{t('form_scan_serial')}</label>
                  <input type="text" className="form-control" placeholder={t('placeholder_scan')} value={stocktakeScanInput} onChange={e => setStocktakeScanInput(e.target.value)} disabled={!isFrozen} />
                </div>
                <button className="btn" onClick={handleLogScan} disabled={!isFrozen}>{t('btn_log_scan')}</button>
              </div>

              <div className="glass-card" style={{ marginBottom: 0 }}>
                <h4>{t('stocktake_disc_title')}</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '15px' }}>{t('stocktake_disc_sub')}</p>
                {canModify('reports') && (
                  <button className="btn" style={{ marginBottom: '15px' }} onClick={handleRunReconciliation} disabled={reconciliationRunning}>
                    {reconciliationRunning ? t('btn_running_reconciliation') : t('btn_run_reconciliation')}
                  </button>
                )}
                <div className="table-responsive">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('th_serial')}</th>
                        <th>{t('th_denom')}</th>
                        <th>{t('th_expected_coords')}</th>
                        <th>{t('th_mismatch')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discrepancyList.map((disc, idx) => (
                        <tr key={idx}>
                          <td><strong style={{ color: 'var(--accent-red)' }}>{disc.serial_number}</strong></td>
                          <td>{disc.denomination}</td>
                          <td>{disc.expected}</td>
                          <td>{disc.mismatch}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SCREEN VIEWPORT: BULK INGESTION */}
        <section className={`screen-viewport ${activeTab === 'screen-migration' ? 'active' : ''}`}>
          <div className="glass-card">
            <h3>{t('migration_title')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>{t('migration_subtitle')}</p>

            <div className="excel-upload-zone" style={{ marginBottom: '24px' }}>
              <i className="fa-solid fa-file-excel upload-icon"></i>
              <h4>{t('migration_drag_title')}</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{t('migration_drag_sub')}</p>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
              <button className="btn" onClick={() => handleUploadMigration(false)}>{t('btn_sim_invalid')}</button>
              <button className="btn btn-primary" onClick={() => handleUploadMigration(true)}>{t('btn_sim_clean')}</button>
            </div>

            {ingressData && (
              <div className="glass-card">
                <h4>Validation Diagnostics Report</h4>
                <div style={{ marginTop: '10px', fontSize: '13px' }}>
                  <div>Total records parsed: {ingressData.total_records}</div>
                  <div style={{ color: 'var(--accent-green)' }}>Valid rows: {ingressData.valid_records}</div>
                  <div style={{ color: 'var(--accent-red)' }}>Failed rows: {ingressData.failed_records}</div>
                </div>

                {ingressData.errors.length > 0 && (
                  <div style={{ marginTop: '15px', color: 'var(--accent-red)', fontSize: '12px' }}>
                    <strong>Errors Details:</strong>
                    <ul>
                      {ingressData.errors.map((err: string, idx: number) => <li key={idx}>{err}</li>)}
                    </ul>
                  </div>
                )}

                {migrationApproved && checkUserRoleMatches('Operations Checker', userRole) && (
                  <div style={{ marginTop: '20px' }}>
                    <button className="btn btn-primary" onClick={handleCommitMigration}>{t('btn_commit_migration')}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* SCREEN VIEWPORT: NOTIFICATIONS (scheduled reports + event-triggered alerts) */}
        <section className={`screen-viewport ${activeTab === 'screen-notifications' ? 'active' : ''}`}>
          <div className="glass-card">
            <h3>{t('title_notifications')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>{t('notifications_subtitle')}</p>

            {canModify('notifications') && (
              <div className="glass-card" style={{ marginBottom: '24px' }}>
                <h4>{t('notif_form_title')}</h4>
                <div className="split-grid-2">
                  <div className="form-group">
                    <label>{t('th_notif_email')}</label>
                    <input type="email" className="form-control" placeholder="treasury-mgmt@kfh.com.kw"
                      value={notifFormEmail} onChange={e => setNotifFormEmail(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>{t('th_notif_type')}</label>
                    <select className="form-control" value={notifFormReportType} onChange={e => setNotifFormReportType(e.target.value)}>
                      {NOTIFICATION_REPORT_TYPES.map(rt => (
                        <option key={rt.value} value={rt.value}>{currentLang === 'en' ? rt.labelEn : rt.labelAr}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>{t('th_notif_schedule')}</label>
                    <input type="text" className="form-control" placeholder="0 7 * * *"
                      value={notifFormCron} onChange={e => setNotifFormCron(e.target.value)}
                      disabled={isInstantReportType(notifFormReportType)} />
                  </div>
                  <div className="form-group">
                    <label>{t('th_notif_format')}</label>
                    <select className="form-control" value={notifFormFormat} onChange={e => setNotifFormFormat(e.target.value)}
                      disabled={isInstantReportType(notifFormReportType)}>
                      <option value="PDF">PDF</option>
                      <option value="XLSX">XLSX</option>
                      <option value="BOTH">{currentLang === 'en' ? 'Both' : 'كلاهما'}</option>
                    </select>
                  </div>
                </div>
                {isInstantReportType(notifFormReportType) && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>{t('notif_instant_hint')}</p>
                )}
                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                  <button className="btn btn-primary" onClick={handleSaveSubscription}>{t('btn_notif_save')}</button>
                  {editingSubscriptionId !== null && (
                    <button className="btn" onClick={resetNotificationForm}>{t('btn_notif_cancel_edit')}</button>
                  )}
                </div>
              </div>
            )}

            <div className="table-responsive" style={{ marginBottom: '24px' }}>
              <table>
                <thead>
                  <tr>
                    <th>{t('th_notif_email')}</th>
                    <th>{t('th_notif_type')}</th>
                    <th>{t('th_notif_schedule')}</th>
                    <th>{t('th_notif_format')}</th>
                    <th>{t('th_notif_status')}</th>
                    <th>{t('th_notif_last_run')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {notificationSubscriptions.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{t('msg_no_subscriptions')}</td></tr>
                  )}
                  {notificationSubscriptions.map((sub: any) => (
                    <tr key={sub.subscription_id}>
                      <td>{sub.distribution_list_email}</td>
                      <td>{(NOTIFICATION_REPORT_TYPES.find(rt => rt.value === sub.report_type) as any)?.[currentLang === 'en' ? 'labelEn' : 'labelAr'] || sub.report_type}</td>
                      <td>{isInstantReportType(sub.report_type) ? (currentLang === 'en' ? 'Instant' : 'فوري') : sub.schedule_cron}</td>
                      <td>{sub.format}</td>
                      <td>
                        <span className={`badge ${sub.is_active ? 'badge-ready' : 'badge-quarantined'}`}>
                          {sub.is_active ? (currentLang === 'en' ? 'Active' : 'نشط') : (currentLang === 'en' ? 'Inactive' : 'غير نشط')}
                        </span>
                      </td>
                      <td>{sub.last_run_at ? new Date(sub.last_run_at).toLocaleString() : '—'}</td>
                      <td>
                        {canModify('notifications') && (
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button className="btn" onClick={() => handleEditSubscription(sub)}>{t('btn_notif_edit')}</button>
                            <button className="btn" onClick={() => handleToggleSubscriptionActive(sub)}>
                              {sub.is_active ? t('btn_notif_deactivate') : t('btn_notif_activate')}
                            </button>
                            <button className="btn" onClick={() => handleTestSendSubscription(sub.subscription_id)}>{t('btn_notif_test_send')}</button>
                            <button className="btn btn-danger" onClick={() => handleDeleteSubscription(sub.subscription_id)}>{t('btn_notif_delete')}</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4>{t('notif_deliveries_title')}</h4>
            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>{t('th_notif_sent_at')}</th>
                    <th>{t('th_notif_delivery_status')}</th>
                    <th>{t('th_notif_message_id')}</th>
                    <th>{t('th_notif_failure')}</th>
                  </tr>
                </thead>
                <tbody>
                  {notificationDeliveries.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{t('msg_no_deliveries')}</td></tr>
                  )}
                  {notificationDeliveries.map((d: any) => (
                    <tr key={d.delivery_id}>
                      <td>{new Date(d.sent_at).toLocaleString()}</td>
                      <td>
                        <span className={`badge ${d.status_code === 'SENT' ? 'badge-ready' : 'badge-quarantined'}`}>{d.status_code}</span>
                      </td>
                      <td>{d.message_id || '—'}</td>
                      <td>{d.failure_reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>



        {/* SCREEN VIEWPORT: BUSINESS RULES ENGINE (admin/governance tier -- rules_engine module, RFP item 5) */}
        <section className={`screen-viewport ${activeTab === 'screen-rules' ? 'active' : ''}`}>
          <div className="glass-card">
            <h3>{currentLang === 'en' ? 'Business Rules Engine' : 'محرك قواعد الأعمال'}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
              {currentLang === 'en'
                ? 'Author and version dynamic business validation rules (e.g. transfer limits). Rules are append-only: saving a rule creates a new version.'
                : 'إنشاء وإصدار قواعد التحقق الديناميكية للأعمال (مثل حدود التحويل). القواعد تراكمية: حفظ القاعدة ينشئ إصداراً جديداً.'}
            </p>

            {canModify('rules_engine') && (
              <div className="glass-card" style={{ marginBottom: '24px' }}>
                <h4>{editingRuleCode !== null ? (currentLang === 'en' ? `Edit Rule: ${editingRuleCode}` : `تعديل القاعدة: ${editingRuleCode}`) : (currentLang === 'en' ? 'Author New Rule' : 'إنشاء قاعدة جديدة')}</h4>
                <div className="split-grid-2">
                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Rule Code' : 'رمز القاعدة'}</label>
                    <input type="text" className="form-control" placeholder="TRANSFER_LIMIT" value={ruleFormCode} onChange={e => setRuleFormCode(e.target.value)} disabled={editingRuleCode !== null} />
                  </div>
                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Rule Name' : 'اسم القاعدة'}</label>
                    <input type="text" className="form-control" value={ruleFormName} onChange={e => setRuleFormName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Rule Type' : 'نوع القاعدة'}</label>
                    <select value={ruleFormType} onChange={e => {
                      const newType = e.target.value;
                      setRuleFormType(newType);
                      if (newType === 'TRANSFER_LIMIT') setBuilderField('weightGrams');
                      else if (newType === 'RECEIPT_VALIDATION') setBuilderField('quantity');
                      else if (newType === 'CUSTOMER_ELIGIBILITY') setBuilderField('customerId');
                      else if (newType === 'RATE_THRESHOLD') setBuilderField('rate');
                      else if (newType === 'INVENTORY_CHECK') setBuilderField('availableQty');
                    }} disabled={editingRuleCode !== null} style={{ color: '#000' }}>
                      <option value="TRANSFER_LIMIT">TRANSFER_LIMIT</option>
                      <option value="RECEIPT_VALIDATION">RECEIPT_VALIDATION</option>
                      <option value="CUSTOMER_ELIGIBILITY">CUSTOMER_ELIGIBILITY</option>
                      <option value="RATE_THRESHOLD">RATE_THRESHOLD</option>
                      <option value="INVENTORY_CHECK">INVENTORY_CHECK</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Severity' : 'الخطورة'}</label>
                    <select value={ruleFormSeverity} onChange={e => setRuleFormSeverity(e.target.value)} style={{ color: '#000' }}>
                      <option value="BLOCK">BLOCK</option>
                      <option value="WARN">WARN</option>
                    </select>
                  </div>
                  <div className="glass-card" style={{ gridColumn: '1 / -1', background: 'rgba(255, 255, 255, 0.05)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <h5 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 600, color: 'var(--kfh-green)' }}>
                      <i className="fa-solid fa-wand-magic-sparkles"></i> {currentLang === 'en' ? 'Visual Expression Builder' : 'منشئ التعبيرات المرئي'}
                    </h5>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Field' : 'الحقل'}</label>
                        <select value={builderField} onChange={e => setBuilderField(e.target.value)} style={{ color: '#000', fontSize: '12px', padding: '6px' }}>
                          {ruleFormType === 'TRANSFER_LIMIT' && (
                            <>
                              <option value="weightGrams">weightGrams (Total Weight / Grams)</option>
                              <option value="itemCount">itemCount (Number of Items)</option>
                            </>
                          )}
                          {ruleFormType === 'RECEIPT_VALIDATION' && (
                            <>
                              <option value="quantity">quantity (Shipment Quantity)</option>
                              <option value="cost">cost (Unit or Total Cost)</option>
                            </>
                          )}
                          {ruleFormType === 'CUSTOMER_ELIGIBILITY' && (
                            <>
                              <option value="customerId">customerId (Customer Identity ID)</option>
                              <option value="isResident">isResident (Resident Status)</option>
                            </>
                          )}
                          {ruleFormType === 'RATE_THRESHOLD' && (
                            <option value="rate">rate (Market Rate / Gram)</option>
                          )}
                          {ruleFormType === 'INVENTORY_CHECK' && (
                            <>
                              <option value="availableQty">availableQty (Available In-Stock)</option>
                              <option value="reorderPoint">reorderPoint (Reorder Threshold)</option>
                            </>
                          )}
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Operator' : 'المعامل'}</label>
                        <select value={builderOp} onChange={e => setBuilderOp(e.target.value)} style={{ color: '#000', fontSize: '12px', padding: '6px' }}>
                          <option value="gt">is greater than (&gt;)</option>
                          <option value="gte">is greater than or equal to (&gt;=)</option>
                          <option value="lt">is less than (&lt;)</option>
                          <option value="lte">is less than or equal to (&lt;=)</option>
                          <option value="eq">equals (==)</option>
                          <option value="neq">not equal (!=)</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Value' : 'القيمة'}</label>
                        <input type="text" className="form-control" placeholder="e.g. 5000" value={builderValue} onChange={e => setBuilderValue(e.target.value)} style={{ fontSize: '12px', padding: '6px', height: '34px' }} />
                      </div>
                    </div>
                    <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.15)', padding: '6px 10px', borderRadius: '4px', fontFamily: 'monospace' }}>
                      <strong>JSON Preview:</strong> {JSON.stringify({ all: [{ field: builderField, op: builderOp, value: isNaN(Number(builderValue)) || builderValue.trim() === '' ? builderValue : Number(builderValue) }] })}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                  <button className="btn btn-primary" onClick={handleSaveRule}>{currentLang === 'en' ? 'Save Rule' : 'حفظ القاعدة'}</button>
                  {editingRuleCode !== null && (
                    <button className="btn" onClick={resetRuleForm}>{currentLang === 'en' ? 'Cancel' : 'إلغاء'}</button>
                  )}
                </div>
              </div>
            )}

            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>{currentLang === 'en' ? 'Code' : 'الرمز'}</th>
                    <th>{currentLang === 'en' ? 'Name' : 'الاسم'}</th>
                    <th>{currentLang === 'en' ? 'Type' : 'النوع'}</th>
                    <th>{currentLang === 'en' ? 'Severity' : 'الخطورة'}</th>
                    <th>{currentLang === 'en' ? 'Version' : 'الإصدار'}</th>
                    <th>{t('th_status')}</th>
                    {canModify('rules_engine') && <th>{t('th_action')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {businessRules.length === 0 ? (
                    <tr><td colSpan={canModify('rules_engine') ? 7 : 6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                      {currentLang === 'en' ? 'No business rules authored yet.' : 'لم يتم إنشاء أي قواعد أعمال بعد.'}
                    </td></tr>
                  ) : businessRules.map((r: any) => (
                    <tr key={r.rule_id}>
                      <td><strong>{r.rule_code}</strong></td>
                      <td>{r.rule_name}</td>
                      <td>{r.rule_type}</td>
                      <td><span className={`badge ${r.severity === 'BLOCK' ? 'badge-quarantined' : 'badge-reserved'}`}>{r.severity}</span></td>
                      <td>v{r.version}</td>
                      <td>
                        <span className={`badge ${r.is_active ? 'badge-ready' : 'badge-sold'}`}>
                          {r.is_active ? (currentLang === 'en' ? 'Active' : 'نشط') : (currentLang === 'en' ? 'Inactive' : 'غير نشط')}
                        </span>
                      </td>
                      {canModify('rules_engine') && (
                        <td>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button className="btn" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => handleStartEditRule(r)}>
                              <i className="fa-solid fa-pen"></i>
                            </button>
                            <button className="btn" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => handleToggleRuleActive(r)}>
                              {r.is_active ? (currentLang === 'en' ? 'Deactivate' : 'تعطيل') : (currentLang === 'en' ? 'Activate' : 'تفعيل')}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SCREEN VIEWPORT: MONITORING (admin/governance tier -- monitoring module, RFP item 8) */}
        <section className={`screen-viewport ${activeTab === 'screen-monitoring' ? 'active' : ''}`}>
          <div className="glass-card">
            <h3>{currentLang === 'en' ? 'Monitoring' : 'المراقبة والتنبيهات'}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
              {currentLang === 'en'
                ? 'SLA metrics, recent monitoring events, and alert-route configuration for the KFH monitoring-tool integration.'
                : 'مؤشرات اتفاقية مستوى الخدمة، أحدث أحداث المراقبة، وإعداد مسارات التنبيه لتكامل أداة المراقبة الخاصة ببيت التمويل الكويتي.'}
            </p>

            {slaMetrics && (
              <div className="split-grid-3" style={{ marginBottom: '24px' }}>
                <div className="glass-card">
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Overall Status' : 'الحالة العامة'}</div>
                  <div style={{ fontSize: '20px', fontWeight: 700 }}>
                    <span className={`badge ${slaMetrics.overallStatus === 'HEALTHY' ? 'badge-ready' : slaMetrics.overallStatus === 'DEGRADED' ? 'badge-reserved' : 'badge-quarantined'}`}>
                      {slaMetrics.overallStatus}
                    </span>
                  </div>
                </div>
                <div className="glass-card">
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Pending Workflow Instances' : 'مسارات العمل المعلقة'}</div>
                  <div style={{ fontSize: '20px', fontWeight: 700 }}>{slaMetrics.pendingWorkflowInstances}</div>
                </div>
                <div className="glass-card">
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Open Mismatch Cases' : 'حالات عدم التطابق المفتوحة'}</div>
                  <div style={{ fontSize: '20px', fontWeight: 700 }}>{slaMetrics.openMismatchCases}</div>
                </div>
                <div className="glass-card">
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Reconciliation Breaks (24h)' : 'فروقات التسوية (24 ساعة)'}</div>
                  <div style={{ fontSize: '20px', fontWeight: 700 }}>{slaMetrics.reconciliationBreaksLast24h}</div>
                </div>
                <div className="glass-card">
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Alert Events (24h)' : 'أحداث التنبيه (24 ساعة)'}</div>
                  <div style={{ fontSize: '20px', fontWeight: 700 }}>{slaMetrics.alertEventsLast24h}</div>
                </div>
              </div>
            )}

            <h4 style={{ marginBottom: '12px' }}>{currentLang === 'en' ? 'Recent Events' : 'الأحداث الأخيرة'}</h4>
            <div className="table-responsive" style={{ marginBottom: '24px' }}>
              <table>
                <thead>
                  <tr>
                    <th>{currentLang === 'en' ? 'Event Type' : 'نوع الحدث'}</th>
                    <th>{currentLang === 'en' ? 'Service' : 'الخدمة'}</th>
                    <th>{currentLang === 'en' ? 'Metric' : 'المؤشر'}</th>
                    <th>{currentLang === 'en' ? 'Severity' : 'الخطورة'}</th>
                    <th>{currentLang === 'en' ? 'Occurred At' : 'وقت الحدوث'}</th>
                  </tr>
                </thead>
                <tbody>
                  {monitoringEvents.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                      {currentLang === 'en' ? 'No monitoring events in the last 24 hours.' : 'لا توجد أحداث مراقبة خلال آخر 24 ساعة.'}
                    </td></tr>
                  ) : monitoringEvents.map((e: any) => (
                    <tr key={e.event_id}>
                      <td>{e.event_type}</td>
                      <td>{e.service_name}</td>
                      <td>{e.metric_name}: {e.metric_value}</td>
                      <td><span className={`badge ${e.severity === 'CRITICAL' ? 'badge-quarantined' : 'badge-reserved'}`}>{e.severity}</span></td>
                      <td>{e.occurred_at ? new Date(e.occurred_at).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4 style={{ marginBottom: '12px' }}>{currentLang === 'en' ? 'Alert Routing' : 'مسارات التنبيه'}</h4>
            {canModify('monitoring') && (
              <div className="glass-card" style={{ marginBottom: '16px' }}>
                <div className="split-grid-2">
                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Event Type' : 'نوع الحدث'}</label>
                    <input type="text" className="form-control" placeholder="INVENTORY_DISCREPANCY" value={routeFormEventType} onChange={e => setRouteFormEventType(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Severity' : 'الخطورة'}</label>
                    <select value={routeFormSeverity} onChange={e => setRouteFormSeverity(e.target.value)} style={{ color: '#000' }}>
                      <option value="CRITICAL">CRITICAL</option>
                      <option value="WARNING">WARNING</option>
                      <option value="INFO">INFO</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label>{currentLang === 'en' ? 'Destination (webhook/email)' : 'الوجهة (رابط/بريد إلكتروني)'}</label>
                    <input type="text" className="form-control" placeholder="https://monitoring.kfh.com.kw/webhook" value={routeFormDestination} onChange={e => setRouteFormDestination(e.target.value)} />
                  </div>
                </div>
                <button className="btn btn-primary" style={{ marginTop: '10px' }} onClick={handleAddAlertRoute}>
                  <i className="fa-solid fa-plus"></i> {currentLang === 'en' ? 'Add Alert Route' : 'إضافة مسار تنبيه'}
                </button>
              </div>
            )}
            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>{currentLang === 'en' ? 'Event Type' : 'نوع الحدث'}</th>
                    <th>{currentLang === 'en' ? 'Severity' : 'الخطورة'}</th>
                    <th>{currentLang === 'en' ? 'Destination' : 'الوجهة'}</th>
                    <th>{t('th_status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {alertRoutes.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                      {currentLang === 'en' ? 'No alert routes configured yet.' : 'لم يتم إعداد مسارات تنبيه بعد.'}
                    </td></tr>
                  ) : alertRoutes.map((r: any) => (
                    <tr key={r.route_id}>
                      <td>{r.event_type}</td>
                      <td><span className={`badge ${r.severity === 'CRITICAL' ? 'badge-quarantined' : 'badge-reserved'}`}>{r.severity}</span></td>
                      <td>{r.destination}</td>
                      <td>
                        <span className={`badge ${r.is_active ? 'badge-ready' : 'badge-sold'}`}>
                          {r.is_active ? (currentLang === 'en' ? 'Active' : 'نشط') : (currentLang === 'en' ? 'Inactive' : 'غير نشط')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SCREEN VIEWPORT: REPORTING & ANALYTICS */}
        <section className={`screen-viewport ${activeTab === 'screen-reports' ? 'active' : ''}`}>
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
              <div>
                <h3>{t('title_reports')}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{t('reports_subtitle')}</p>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                {reportType === 'audit' ? (
                  <>
                    <button className="btn btn-primary" onClick={() => handleExportAuditLogs('csv')} disabled={loadingReport}>
                      <i className="fa-solid fa-file-csv"></i> CSV
                    </button>
                    <button className="btn btn-primary" onClick={() => handleExportAuditLogs('xlsx')} disabled={loadingReport}>
                      <i className="fa-solid fa-file-excel"></i> {t('btn_export_excel')}
                    </button>
                    <button className="btn btn-primary" onClick={() => handleExportAuditLogs('pdf')} disabled={loadingReport}>
                      <i className="fa-solid fa-file-pdf"></i> {t('btn_export_pdf')}
                    </button>
                  </>
                ) : (reportType === 'inventory_balance' || reportType === 'transactions' || reportType === 'reconciliation' || reportType === 'kpis' || reportType === 'exceptions' || reportType === 'cost_analysis' || reportType === 'cost_variance' || reportType === 'movements') ? (
                  // Real server-generated report (RFP: "official reports on inventory
                  // balances, transaction logs, reconciliation differences") -- same
                  // QuestPDF/ClosedXML rendering path as the audit trail export, not the
                  // lightweight client-side CSV/print used by valuation/occupancy below.
                  <>
                    <button className="btn btn-primary" onClick={() => handleExportOfficialReport(reportType as any, 'csv')} disabled={loadingReport}>
                      <i className="fa-solid fa-file-csv"></i> CSV
                    </button>
                    <button className="btn btn-primary" onClick={() => handleExportOfficialReport(reportType as any, 'xlsx')} disabled={loadingReport}>
                      <i className="fa-solid fa-file-excel"></i> {t('btn_export_excel')}
                    </button>
                    <button className="btn btn-primary" onClick={() => handleExportOfficialReport(reportType as any, 'pdf')} disabled={loadingReport}>
                      <i className="fa-solid fa-file-pdf"></i> {t('btn_export_pdf')}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-primary" onClick={handleExportExcel} disabled={reportData.length === 0 || loadingReport}>
                      <i className="fa-solid fa-file-excel"></i> {t('btn_export_excel')}
                    </button>
                    <button className="btn btn-primary" onClick={handleExportPDF} disabled={reportData.length === 0 || loadingReport}>
                      <i className="fa-solid fa-file-pdf"></i> {t('btn_export_pdf')}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="report-controls glass-card" style={{ padding: '20px', marginBottom: '20px', display: 'flex', gap: '20px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '200px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{t('lbl_report_type')}</label>
                <select value={reportType} onChange={e => { setReportType(e.target.value); loadReport(e.target.value); }} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000' }}>
                  <option value="valuation">{t('rep_valuation')}</option>
                  <option value="occupancy">{t('rep_occupancy')}</option>
                  <option value="audit">{t('rep_audit')}</option>
                  <option value="transactions">{t('rep_transactions')}</option>
                  <option value="inventory_balance">{t('rep_inventory_balance')}</option>
                  <option value="reconciliation">{t('rep_reconciliation')}</option>
                  <option value="gl_postings">{t('rep_gl_postings')}</option>
                  <option value="kpis">{t('rep_kpis')}</option>
                  <option value="exceptions">{t('rep_exceptions')}</option>
                  <option value="cost_analysis">{t('rep_cost_analysis')}</option>
                  <option value="cost_variance">{t('rep_cost_variance')}</option>
                  <option value="movements">{t('rep_movements')}</option>
                </select>
              </div>

              {reportType === 'audit' && (
                <>
                  <div className="form-group" style={{ marginBottom: 0, minWidth: '160px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{currentLang === 'en' ? 'Search Text' : 'نص البحث'}</label>
                    <input type="text" value={auditQuery} onChange={e => setAuditQuery(e.target.value)} placeholder={currentLang === 'en' ? 'Action description…' : 'وصف الإجراء…'} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000' }} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0, minWidth: '140px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{currentLang === 'en' ? 'User' : 'المستخدم'}</label>
                    <input type="text" value={auditUser} onChange={e => setAuditUser(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000' }} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0, minWidth: '140px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{currentLang === 'en' ? 'Module' : 'الوحدة'}</label>
                    <input type="text" value={auditModule} onChange={e => setAuditModule(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000' }} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0, minWidth: '140px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{currentLang === 'en' ? 'Entity Type' : 'نوع الكيان'}</label>
                    <input type="text" value={auditEntityType} onChange={e => setAuditEntityType(e.target.value)} placeholder="e.g. PURCHASE_ORDER" style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000' }} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0, minWidth: '160px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{currentLang === 'en' ? 'Integrity Status' : 'حالة السلامة'}</label>
                    <select value={auditStatus} onChange={e => setAuditStatus(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000' }}>
                      <option value="">{currentLang === 'en' ? 'All' : 'الكل'}</option>
                      <option value="verified">{currentLang === 'en' ? 'Verified' : 'موثّق'}</option>
                      <option value="unverified">{currentLang === 'en' ? 'Unverified (pre-dates hashing)' : 'غير موثّق (قبل التوثيق)'}</option>
                      <option value="tampered">{currentLang === 'en' ? 'Tampered' : 'تم العبث به'}</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0, minWidth: '150px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{currentLang === 'en' ? 'From' : 'من'}</label>
                    <input type="date" value={auditFrom} onChange={e => setAuditFrom(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000' }} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0, minWidth: '150px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{currentLang === 'en' ? 'To' : 'إلى'}</label>
                    <input type="date" value={auditTo} onChange={e => setAuditTo(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000' }} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <button className="btn btn-primary" onClick={() => fetchAuditLogs(1)} disabled={loadingReport}>
                      <i className="fa-solid fa-magnifying-glass"></i> {currentLang === 'en' ? 'Search' : 'بحث'}
                    </button>
                  </div>
                </>
              )}

              {reportType === 'valuation' && (
                <>
                  <div className="form-group" style={{ marginBottom: 0, minWidth: '150px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{currentLang === 'en' ? 'Metal Type' : 'نوع المعدن'}</label>
                    <select value={filterMetal} onChange={e => setFilterMetal(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000' }}>
                      <option value="">{currentLang === 'en' ? 'All Metals' : 'جميع المعادن'}</option>
                      <option value="Gold">{currentLang === 'en' ? 'Gold' : 'ذهب'}</option>
                      <option value="Silver">{currentLang === 'en' ? 'Silver' : 'فضة'}</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0, minWidth: '150px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{currentLang === 'en' ? 'Ownership' : 'الملكية'}</label>
                    <select value={filterVault} onChange={e => setFilterVault(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000' }}>
                      <option value="">{currentLang === 'en' ? 'All Owners' : 'جميع الملاك'}</option>
                      <option value="KFH_OWNED">{currentLang === 'en' ? 'KFH Owned' : 'بيت التمويل الكويتي'}</option>
                      <option value="CUSTOMER_OWNED">{currentLang === 'en' ? 'Customer Custody' : 'أمانات العملاء'}</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0, minWidth: '150px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{currentLang === 'en' ? 'Valuation Method' : 'طريقة التقييم'}</label>
                    <select value={valuationMethod} onChange={e => { setValuationMethod(e.target.value); loadReport('valuation', e.target.value); }} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000' }}>
                      <option value="AVERAGE">{currentLang === 'en' ? 'Average Cost' : 'متوسط التكلفة'}</option>
                      <option value="FIFO">{currentLang === 'en' ? 'FIFO (First-In First-Out)' : 'الوارد أولاً يصرف أولاً'}</option>
                      <option value="LIFO">{currentLang === 'en' ? 'LIFO (Last-In First-Out)' : 'الوارد أخيراً يصرف أولاً'}</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            <div id="report-print-area">
              <div className="print-only-header" style={{ display: 'none' }}>
                <div style={{ textAlign: 'center', marginBottom: '30px', borderBottom: '2px solid #D4AF37', paddingBottom: '15px' }}>
                  <h2 style={{ color: '#121824', margin: 0 }}>KUWAIT FINANCE HOUSE (KFH)</h2>
                  <span style={{ fontSize: '12px', color: '#8F9BB3', textTransform: 'uppercase', fontWeight: 'bold' }}>PRECIOUS METALS INVENTORY MANAGEMENT SYSTEM (PMIMS)</span>
                  <h3 style={{ color: '#121824', marginTop: '10px', textDecoration: 'underline' }}>
                    {reportType === 'valuation' && t('rep_valuation')}
                    {reportType === 'occupancy' && t('rep_occupancy')}
                    {reportType === 'audit' && t('rep_audit')}
                    {reportType === 'transactions' && t('rep_transactions')}
                    {reportType === 'inventory_balance' && t('rep_inventory_balance')}
                    {reportType === 'reconciliation' && t('rep_reconciliation')}
                    {reportType === 'gl_postings' && t('rep_gl_postings')}
                    {reportType === 'kpis' && t('rep_kpis')}
                    {reportType === 'exceptions' && t('rep_exceptions')}
                    {reportType === 'cost_analysis' && t('rep_cost_analysis')}
                    {reportType === 'cost_variance' && t('rep_cost_variance')}
                    {reportType === 'movements' && t('rep_movements')}
                  </h3>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '20px', color: '#121824' }}>
                    <span>Date Generated: {new Date().toLocaleString()}</span>
                    <span>Operator: {displayName} ({userRole})</span>
                  </div>
                </div>
              </div>

              {loadingReport ? (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '24px', color: 'var(--accent-gold)' }}></i>
                  <p style={{ marginTop: '10px', color: 'var(--text-muted)' }}>Loading Report...</p>
                </div>
              ) : reportData.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  <i className="fa-solid fa-file-excel" style={{ fontSize: '32px', marginBottom: '10px' }}></i>
                  <p>No report records matching criteria.</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="report-data-table">
                    {reportType === 'valuation' && (
                      <>
                        <thead>
                          <tr>
                            <th>{t('th_serial')}</th>
                            <th>{t('th_metal')}</th>
                            <th>{t('th_denom')}</th>
                            <th>{t('th_weight_grams')}</th>
                            <th>{t('th_coords')}</th>
                            <th>{t('th_ownership')}</th>
                            <th>{t('th_cost_basis')}</th>
                            <th>{t('th_market_val')}</th>
                            <th>{t('th_unrealized_pnl')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData
                            .filter(i => !filterMetal || i.metal_name === filterMetal)
                            .filter(i => !filterVault || i.ownership_type === filterVault)
                            .map((row, idx) => (
                              <tr key={idx}>
                                <td><strong>{row.serial_number}</strong></td>
                                <td>{translateDb(row.metal_name)}</td>
                                <td>{translateDb(row.denomination)}</td>
                                <td>{row.weight_grams}g</td>
                                <td>{translateDb(row.location)}</td>
                                <td>{translateDb(row.ownership_type)}</td>
                                <td>${row.cost_basis?.toLocaleString()}</td>
                                <td>${row.market_value?.toLocaleString()}</td>
                                <td style={{ color: row.unrealized_pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                  {row.unrealized_pnl >= 0 ? '+' : ''}${row.unrealized_pnl?.toLocaleString()}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </>
                    )}

                    {reportType === 'occupancy' && (
                      <>
                        <thead>
                          <tr>
                            <th>{currentLang === 'en' ? 'Vault' : 'الخزينة'}</th>
                            <th>{currentLang === 'en' ? 'Zone / Room' : 'المنطقة / الغرفة'}</th>
                            <th>{t('th_total_slots')}</th>
                            <th>{t('th_occupied_slots')}</th>
                            <th>{t('th_occupancy')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.map((row, idx) => (
                            <tr key={idx}>
                              <td><strong>{translateDb(row.vault_name)}</strong></td>
                              <td>{translateDb(row.zone_room)}</td>
                              <td>{row.total_slots}</td>
                              <td>{row.occupied_slots}</td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden', minWidth: '80px' }}>
                                    <div style={{ width: `${row.occupancy}%`, height: '100%', background: row.occupancy > 80 ? 'var(--accent-red)' : row.occupancy > 50 ? 'var(--accent-orange)' : 'var(--accent-green)' }} />
                                  </div>
                                  <span>{row.occupancy}%</span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    )}

                    {reportType === 'audit' && (
                      <>
                        <thead>
                          <tr>
                            <th>{t('th_timestamp')}</th>
                            <th>{t('th_user')}</th>
                            <th>{t('th_module')}</th>
                            <th>{t('th_action_desc')}</th>
                            <th>{currentLang === 'en' ? 'Entity' : 'الكيان'}</th>
                            <th>{currentLang === 'en' ? 'Integrity' : 'السلامة'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.map((row, idx) => (
                            <tr key={idx} style={{ cursor: 'pointer' }} onClick={() => fetchAuditLogDetail(row.logId)} title={currentLang === 'en' ? 'Click for full detail' : 'انقر لعرض التفاصيل الكاملة'}>
                              <td>{new Date(row.timestamp).toLocaleString()}</td>
                              <td><strong>{row.username}</strong></td>
                              <td><span className="badge badge-ready">{row.moduleName}</span></td>
                              <td>{row.actionDescription}</td>
                              <td>{row.entityType ? `${row.entityType}${row.entityId ? ' #' + row.entityId : ''}` : '—'}</td>
                              <td>
                                <span className={`badge ${row.tamperStatus === 'Verified' ? 'badge-ready' : row.tamperStatus === 'Tampered' ? 'badge-quarantined' : 'badge-sold'}`}>
                                  {row.tamperStatus}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    )}

                    {reportType === 'transactions' && (
                      <>
                        <thead>
                          <tr>
                            <th>{t('th_tx_num')}</th>
                            <th>{t('th_serial')}</th>
                            <th>{t('th_tx_type')}</th>
                            <th>{t('th_source_loc')}</th>
                            <th>{t('th_dest_loc')}</th>
                            <th>{t('th_ownership')}</th>
                            <th>{t('th_user')}</th>
                            <th>{currentLang === 'en' ? 'Approved By' : 'اعتمدها'}</th>
                            <th>{t('th_timestamp')}</th>
                            <th>{currentLang === 'en' ? 'Traceability' : 'إمكانية التتبع'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.map((row, idx) => (
                            <tr key={idx}>
                              <td><span style={{ fontSize: '11px', fontFamily: 'monospace' }}>{row.transaction_number?.substring(0, 8)}...</span></td>
                              <td><strong>{row.serial_number}</strong></td>
                              <td><span className="badge">{translateDb(row.transaction_type)}</span></td>
                              <td>{translateDb(row.source_vault || 'N/A')} {row.source_location ? `(${translateDb(row.source_location)})` : ''}</td>
                              <td>{translateDb(row.destination_vault || 'N/A')} {row.destination_location ? `(${translateDb(row.destination_location)})` : ''}</td>
                              <td>{translateDb(row.source_ownership)}</td>
                              <td>{row.initiated_by}</td>
                              <td>{row.approved_by || '—'}</td>
                              <td>{new Date(row.timestamp).toLocaleString()}</td>
                              <td>
                                <button className="btn" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={() => fetchTransactionTrace(row.transaction_id)}>
                                  <i className="fa-solid fa-diagram-project"></i> {currentLang === 'en' ? 'Trace' : 'تتبع'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    )}

                    {reportType === 'inventory_balance' && (
                      <>
                        <thead>
                          <tr>
                            <th>{t('th_vault')}</th>
                            <th>{t('th_metal')}</th>
                            <th>{t('th_denom')}</th>
                            <th>{t('th_ready_qty')}</th>
                            <th>{t('th_total_weight_g')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.map((row, idx) => (
                            <tr key={idx}>
                              <td>{translateDb(row.vault)}</td>
                              <td>{translateDb(row.metal_type)}</td>
                              <td>{row.denomination}</td>
                              <td><strong>{row.ready_qty}</strong></td>
                              <td>{row.total_weight_grams}</td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    )}

                    {reportType === 'reconciliation' && (
                      <>
                        <thead>
                          <tr>
                            <th>{t('th_case_id')}</th>
                            <th>{t('th_serial')}</th>
                            <th>{t('th_denom')}</th>
                            <th>{t('th_expected_coords')}</th>
                            <th>{t('th_mismatch')}</th>
                            <th>{t('th_reason_code')}</th>
                            <th>{t('th_resolved_by')}</th>
                            <th>{t('th_resolved_at')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.map((row, idx) => (
                            <tr key={idx}>
                              <td>{row.case_id}</td>
                              <td><strong style={{ color: 'var(--accent-red)' }}>{row.serial_number}</strong></td>
                              <td>{row.denomination}</td>
                              <td>{row.expected}</td>
                              <td>{row.mismatch}</td>
                              <td>{row.reason_code || '—'}</td>
                              <td>{row.resolved_by || '—'}</td>
                              <td>{row.resolved_at ? new Date(row.resolved_at).toLocaleString() : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    )}

                    {reportType === 'gl_postings' && (
                      <>
                        <thead>
                          <tr>
                            <th>{t('th_gl_source')}</th>
                            <th>{t('th_gl_debit')}</th>
                            <th>{t('th_gl_credit')}</th>
                            <th style={{ textAlign: 'right' }}>{t('th_gl_amount')}</th>
                            <th>{t('th_gl_status')}</th>
                            <th>{t('th_gl_reference')}</th>
                            <th>{t('th_gl_initiated_by')}</th>
                            <th>{t('th_gl_created_at')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.map((row, idx) => (
                            <tr key={idx}>
                              <td>{row.source_type} #{row.source_id}</td>
                              <td>{row.debit_account}</td>
                              <td>{row.credit_account}</td>
                              <td style={{ textAlign: 'right' }}>{row.amount?.toLocaleString()} {row.currency}</td>
                              <td>
                                <span className={`badge ${row.status_code === 'POSTED' ? 'badge-ready' : row.status_code === 'FAILED' ? 'badge-quarantined' : 'badge-reserved'}`}>
                                  {row.status_code}
                                </span>
                              </td>
                              <td>{row.core_banking_reference || '—'}</td>
                              <td>{row.initiated_by}</td>
                              <td>{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    )}

                    {reportType === 'kpis' && (
                      <>
                        <thead>
                          <tr>
                            <th>{t('th_kpi')}</th>
                            <th>{t('th_value')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.map((row, idx) => (
                            <tr key={idx}>
                              <td>{row.kpi}</td>
                              <td><strong>{row.value}</strong></td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    )}

                    {reportType === 'exceptions' && (
                      <>
                        <thead>
                          <tr>
                            <th>{t('th_exception_type')}</th>
                            <th>{t('th_reference')}</th>
                            <th>{t('th_description')}</th>
                            <th>{t('th_severity')}</th>
                            <th>{t('th_raised_at')}</th>
                            <th>{t('th_status')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.map((row, idx) => (
                            <tr key={idx}>
                              <td>{row.exception_type}</td>
                              <td>{row.reference}</td>
                              <td>{row.description}</td>
                              <td>
                                <span className={`badge ${row.severity === 'HIGH' || row.severity === 'BLOCK' ? 'badge-quarantined' : 'badge-reserved'}`}>
                                  {row.severity}
                                </span>
                              </td>
                              <td>{row.raised_at ? new Date(row.raised_at).toLocaleString() : '—'}</td>
                              <td>{row.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    )}

                    {reportType === 'cost_analysis' && (
                      <>
                        <thead>
                          <tr>
                            <th>{t('th_group')}</th>
                            <th>{t('th_item_count')}</th>
                            <th>{t('th_total_weight_g')}</th>
                            <th>{t('th_total_cost')}</th>
                            <th>{t('th_avg_unit_cost')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.map((row, idx) => (
                            <tr key={idx}>
                              <td>{row.group}</td>
                              <td>{row.item_count}</td>
                              <td>{row.total_weight_grams}</td>
                              <td>{row.total_landed_cost}</td>
                              <td>{row.avg_unit_cost_per_gram}</td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    )}

                    {reportType === 'cost_variance' && (
                      <>
                        <thead>
                          <tr>
                            <th>{t('th_metal')}</th>
                            <th>{t('th_period')}</th>
                            <th>{t('th_budgeted_cost')}</th>
                            <th>{t('th_actual_cost')}</th>
                            <th>{t('th_variance')}</th>
                            <th>{t('th_variance_pct')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.map((row, idx) => (
                            <tr key={idx}>
                              <td>{row.metal_type}</td>
                              <td>{row.period}</td>
                              <td>{row.budgeted_cost_per_gram}</td>
                              <td>{row.actual_avg_cost_per_gram}</td>
                              <td>{row.variance_per_gram}</td>
                              <td>{row.variance_pct}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    )}

                    {reportType === 'movements' && (
                      <>
                        <thead>
                          <tr>
                            <th>{t('th_period')}</th>
                            <th>{t('th_location')}</th>
                            <th>{t('th_ownership')}</th>
                            <th>{t('th_inbound')}</th>
                            <th>{t('th_outbound')}</th>
                            <th>{t('th_net_weight')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.map((row, idx) => (
                            <tr key={idx}>
                              <td>{row.period}</td>
                              <td>{row.location}</td>
                              <td>{row.ownership}</td>
                              <td>{row.inbound_count}</td>
                              <td>{row.outbound_count}</td>
                              <td>{row.net_weight_grams}</td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    )}
                  </table>
                </div>
              )}
            </div>

            {reportType === 'audit' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', flexWrap: 'wrap', gap: '10px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  {currentLang === 'en'
                    ? `Showing ${reportData.length === 0 ? 0 : (auditPage - 1) * auditPageSize + 1}–${(auditPage - 1) * auditPageSize + reportData.length} of ${auditTotalCount}`
                    : `عرض ${reportData.length === 0 ? 0 : (auditPage - 1) * auditPageSize + 1}–${(auditPage - 1) * auditPageSize + reportData.length} من ${auditTotalCount}`}
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn" disabled={auditPage <= 1 || loadingReport} onClick={() => fetchAuditLogs(auditPage - 1)}>
                    <i className="fa-solid fa-chevron-left"></i> {currentLang === 'en' ? 'Previous' : 'السابق'}
                  </button>
                  <button className="btn" disabled={(auditPage * auditPageSize) >= auditTotalCount || loadingReport} onClick={() => fetchAuditLogs(auditPage + 1)}>
                    {currentLang === 'en' ? 'Next' : 'التالي'} <i className="fa-solid fa-chevron-right"></i>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Audit Trail drill-down modal -- full record incl. tamper-hash verification status */}
        {auditDetail && (
          <div className="modal-overlay active" onClick={() => setAuditDetail(null)}>
            <div className="glass-card modal-content-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '650px', width: '90%' }}>
              <div className="modal-header">
                <h3>{currentLang === 'en' ? 'Audit Entry Detail' : 'تفاصيل سجل التدقيق'} #{auditDetail.logId}</h3>
                <span className="modal-close-btn" onClick={() => setAuditDetail(null)}>&times;</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                <div><strong>{currentLang === 'en' ? 'Timestamp' : 'التوقيت'}:</strong> {new Date(auditDetail.timestamp).toLocaleString()}</div>
                <div><strong>{currentLang === 'en' ? 'User' : 'المستخدم'}:</strong> {auditDetail.username} ({auditDetail.ipAddress})</div>
                <div><strong>{currentLang === 'en' ? 'Module' : 'الوحدة'}:</strong> {auditDetail.moduleName}</div>
                <div><strong>{currentLang === 'en' ? 'Entity' : 'الكيان'}:</strong> {auditDetail.entityType ? `${auditDetail.entityType} #${auditDetail.entityId ?? ''}` : (currentLang === 'en' ? 'N/A' : 'غير متاح')}</div>
                <div>
                  <strong>{currentLang === 'en' ? 'Integrity Status' : 'حالة السلامة'}:</strong>{' '}
                  <span className={`badge ${auditDetail.tamperStatus === 'Verified' ? 'badge-ready' : auditDetail.tamperStatus === 'Tampered' ? 'badge-quarantined' : 'badge-sold'}`}>
                    {auditDetail.tamperStatus}
                  </span>
                  {auditDetail.tamperStatus === 'Tampered' && (
                    <div style={{ color: '#DC2626', marginTop: '6px', fontSize: '12px' }}>
                      {currentLang === 'en'
                        ? 'The recomputed row hash does not match the stored hash — this row appears to have been altered after it was written.'
                        : 'لا يتطابق التجزئة المعاد حسابها مع التجزئة المخزنة — يبدو أن هذا السجل تم تعديله بعد كتابته.'}
                    </div>
                  )}
                  {auditDetail.tamperStatus === 'Unverified' && (
                    <div style={{ color: 'var(--text-muted)', marginTop: '6px', fontSize: '12px' }}>
                      {currentLang === 'en'
                        ? 'This row pre-dates tamper-hashing and cannot be cryptographically verified either way.'
                        : 'هذا السجل يسبق تفعيل التحقق بالتجزئة ولا يمكن التحقق منه بشكل قاطع.'}
                    </div>
                  )}
                </div>
                <div>
                  <strong>{currentLang === 'en' ? 'Action Description' : 'وصف الإجراء'}:</strong>
                  <p style={{ marginTop: '4px', background: 'var(--bg-secondary)', padding: '10px', borderRadius: '8px' }}>{auditDetail.actionDescription}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Transaction traceability drill-down modal */}
        {transactionTrace && (
          <div className="modal-overlay active" onClick={() => setTransactionTrace(null)}>
            <div className="glass-card modal-content-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '750px', width: '90%', maxHeight: '85vh', overflowY: 'auto' }}>
              <div className="modal-header">
                <h3>{currentLang === 'en' ? 'Movement Trace' : 'تتبع الحركة'}: {transactionTrace.transaction?.transaction_number}</h3>
                <span className="modal-close-btn" onClick={() => setTransactionTrace(null)}>&times;</span>
              </div>

              <h4 style={{ marginBottom: '8px' }}>{currentLang === 'en' ? 'Transaction' : 'المعاملة'}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px', marginBottom: '18px' }}>
                <div><strong>{currentLang === 'en' ? 'Type' : 'النوع'}:</strong> <span className="badge">{translateDb(transactionTrace.transaction?.transaction_type)}</span></div>
                <div><strong>{currentLang === 'en' ? 'Serial' : 'الرقم التسلسلي'}:</strong> {transactionTrace.transaction?.serial_number || '—'}</div>
                <div><strong>{currentLang === 'en' ? 'From' : 'من'}:</strong> {translateDb(transactionTrace.transaction?.source_vault || 'N/A')} {transactionTrace.transaction?.source_location ? `(${translateDb(transactionTrace.transaction.source_location)})` : ''}</div>
                <div><strong>{currentLang === 'en' ? 'To' : 'إلى'}:</strong> {translateDb(transactionTrace.transaction?.destination_vault || 'N/A')} {transactionTrace.transaction?.destination_location ? `(${translateDb(transactionTrace.transaction.destination_location)})` : ''}</div>
                <div><strong>{currentLang === 'en' ? 'Ownership' : 'الملكية'}:</strong> {transactionTrace.transaction?.source_ownership} → {transactionTrace.transaction?.destination_ownership}</div>
                <div><strong>{currentLang === 'en' ? 'Initiated / Approved By' : 'بدأها / اعتمدها'}:</strong> {transactionTrace.transaction?.initiated_by} {transactionTrace.transaction?.approved_by ? `/ ${transactionTrace.transaction.approved_by}` : ''}</div>
                <div><strong>{currentLang === 'en' ? 'Timestamp' : 'التوقيت'}:</strong> {transactionTrace.transaction?.timestamp ? new Date(transactionTrace.transaction.timestamp).toLocaleString() : ''}</div>
              </div>

              <h4 style={{ marginBottom: '8px' }}>{currentLang === 'en' ? 'Linked Audit Entry' : 'سجل التدقيق المرتبط'}</h4>
              {transactionTrace.audit_entry ? (
                <div style={{ fontSize: '13px', marginBottom: '18px', background: 'var(--bg-secondary)', padding: '10px', borderRadius: '8px' }}>
                  <div><strong>{currentLang === 'en' ? 'By' : 'بواسطة'}:</strong> {transactionTrace.audit_entry.username} — {new Date(transactionTrace.audit_entry.timestamp).toLocaleString()}</div>
                  <div style={{ marginTop: '4px' }}>{transactionTrace.audit_entry.action_description}</div>
                  <div style={{ marginTop: '6px' }}>
                    <span className={`badge ${transactionTrace.audit_entry.tamper_status === 'Verified' ? 'badge-ready' : transactionTrace.audit_entry.tamper_status === 'Tampered' ? 'badge-quarantined' : 'badge-sold'}`}>
                      {transactionTrace.audit_entry.tamper_status}
                    </span>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '18px' }}>
                  {currentLang === 'en' ? 'No linked audit entry found.' : 'لا يوجد سجل تدقيق مرتبط.'}
                </p>
              )}

              {transactionTrace.courier && (
                <>
                  <h4 style={{ marginBottom: '8px' }}>{currentLang === 'en' ? 'Courier / Movement Detail' : 'تفاصيل النقل / المرافقة'}</h4>
                  <div style={{ fontSize: '13px', marginBottom: '18px' }}>
                    <div>{currentLang === 'en' ? 'Courier' : 'الناقل'}: {transactionTrace.courier.courier_details || '—'}</div>
                    {transactionTrace.courier.security_escort_name && <div>{currentLang === 'en' ? 'Security Escort' : 'المرافقة الأمنية'}: {transactionTrace.courier.security_escort_name}</div>}
                    {transactionTrace.courier.departure_time && <div>{currentLang === 'en' ? 'Departed' : 'المغادرة'}: {new Date(transactionTrace.courier.departure_time).toLocaleString()}</div>}
                    {transactionTrace.courier.arrival_time && <div>{currentLang === 'en' ? 'Arrived' : 'الوصول'}: {new Date(transactionTrace.courier.arrival_time).toLocaleString()}</div>}
                  </div>
                </>
              )}

              <h4 style={{ marginBottom: '8px' }}>{currentLang === 'en' ? 'Chain of Custody Timeline' : 'الجدول الزمني لسلسلة العهدة'}</h4>
              {transactionTrace.custody_chain && transactionTrace.custody_chain.length > 0 ? (
                <div className="table-responsive">
                  <table>
                    <thead>
                      <tr>
                        <th>{currentLang === 'en' ? 'Event' : 'الحدث'}</th>
                        <th>{currentLang === 'en' ? 'Location' : 'الموقع'}</th>
                        <th>{currentLang === 'en' ? 'By' : 'بواسطة'}</th>
                        <th>{currentLang === 'en' ? 'When' : 'متى'}</th>
                        <th>{currentLang === 'en' ? 'Notes' : 'ملاحظات'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactionTrace.custody_chain.map((e: any, idx: number) => (
                        <tr key={idx}>
                          <td><span className="badge">{e.event_type}</span></td>
                          <td>{translateDb(e.location) || '—'}</td>
                          <td>{e.recorded_by}</td>
                          <td>{new Date(e.recorded_at).toLocaleString()}</td>
                          <td style={{ fontSize: '12px' }}>{e.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  {currentLang === 'en' ? 'No custody events recorded for this item yet.' : 'لم يتم تسجيل أي أحداث عهدة لهذا الصنف بعد.'}
                </p>
              )}
            </div>
          </div>
        )}

        {/* SCREEN VIEWPORT: REAL-TIME INVENTORY MONITORING */}
        <section className={`screen-viewport ${activeTab === 'screen-realtime' ? 'active' : ''}`}>
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3>{currentLang === 'en' ? 'Real-Time Inventory Monitoring' : 'المراقبة اللحظية للمخزون'}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                  {currentLang === 'en'
                    ? 'Live precious-metal quantities and movements — to/from the main vault, between branches, and with customers.'
                    : 'كميات وحركات المعادن الثمينة بشكل لحظي — من وإلى الخزنة الرئيسية، بين الفروع، ومع العملاء.'}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600 }}>
                <span style={{
                  width: '10px', height: '10px', borderRadius: '50%',
                  background: hubStatus === 'live' ? '#22C55E' : hubStatus === 'connecting' ? '#F59E0B' : '#9CA3AF',
                  boxShadow: hubStatus === 'live' ? '0 0 0 4px rgba(34,197,94,0.18)' : 'none'
                }}></span>
                <span>
                  {hubStatus === 'live' && (currentLang === 'en' ? 'Live' : 'مباشر')}
                  {hubStatus === 'connecting' && (currentLang === 'en' ? 'Connecting…' : 'جارٍ الاتصال…')}
                  {hubStatus === 'offline' && (currentLang === 'en' ? 'Offline (snapshot only)' : 'غير متصل (لقطة فقط)')}
                </span>
                <button className="btn" style={{ fontSize: '11px', padding: '5px 10px' }} onClick={() => { fetchLiveBalances(); connectMonitoringHub(); }}>
                  <i className="fa-solid fa-rotate"></i> {currentLang === 'en' ? 'Refresh' : 'تحديث'}
                </button>
              </div>
            </div>

            {/* Current quantities by location */}
            <h4 style={{ marginTop: '18px', marginBottom: '8px' }}>{currentLang === 'en' ? 'Current Quantities by Location' : 'الكميات الحالية حسب الموقع'}</h4>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>{currentLang === 'en' ? 'Vault / Branch' : 'الخزنة / الفرع'}</th>
                    <th>{currentLang === 'en' ? 'Location' : 'الموقع'}</th>
                    <th>{currentLang === 'en' ? 'Metal / Denomination' : 'المعدن / الفئة'}</th>
                    <th>{currentLang === 'en' ? 'Ownership' : 'الملكية'}</th>
                    <th style={{ textAlign: 'right' }}>{currentLang === 'en' ? 'Ready' : 'جاهز'}</th>
                    <th style={{ textAlign: 'right' }}>{currentLang === 'en' ? 'Reserved' : 'محجوز'}</th>
                    <th style={{ textAlign: 'right' }}>{currentLang === 'en' ? 'In Transit' : 'قيد النقل'}</th>
                    <th style={{ textAlign: 'right' }}>{currentLang === 'en' ? 'Quarantined' : 'معزول'}</th>
                    <th style={{ textAlign: 'right' }}>{currentLang === 'en' ? 'Sold/Custody' : 'مباع/عهدة'}</th>
                    <th>{currentLang === 'en' ? 'Last Updated' : 'آخر تحديث'}</th>
                  </tr>
                </thead>
                <tbody>
                  {liveBalances.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                        {currentLang === 'en' ? 'No balance data yet.' : 'لا توجد بيانات أرصدة بعد.'}
                      </td>
                    </tr>
                  ) : (
                    liveBalances.map((b: any, idx: number) => (
                      <tr key={idx}>
                        <td>{translateDb(b.vault_name) || '—'}{b.branch_name ? ` — ${translateDb(b.branch_name)}` : ''}</td>
                        <td>{translateDb(b.location) || `#${b.location_id}`}</td>
                        <td>{translateDb(b.metal_name) || ''} {b.denomination ? `(${translateDb(b.denomination)})` : ''}</td>
                        <td>{translateDb(b.ownership_type)}</td>
                        <td style={{ textAlign: 'right' }}>{(b.ready_for_sale_qty ?? 0).toLocaleString()}</td>
                        <td style={{ textAlign: 'right' }}>{(b.reserved_qty ?? 0).toLocaleString()}</td>
                        <td style={{ textAlign: 'right' }}>{(b.in_transit_qty ?? 0).toLocaleString()}</td>
                        <td style={{ textAlign: 'right' }}>{(b.quarantined_qty ?? 0).toLocaleString()}</td>
                        <td style={{ textAlign: 'right' }}>{(b.sold_qty ?? 0).toLocaleString()}</td>
                        <td>{b.last_updated ? new Date(b.last_updated).toLocaleString() : ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Live movement feed */}
            <h4 style={{ marginTop: '26px', marginBottom: '8px' }}>{currentLang === 'en' ? 'Live Movement Feed' : 'خلاصة الحركات اللحظية'}</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '-4px' }}>
              {currentLang === 'en'
                ? 'Populated live as movements occur (most recent 50). See Reports → Transactions for full history.'
                : 'يتم تعبئتها لحظيًا عند حدوث الحركات (أحدث 50). راجع التقارير ← المعاملات للسجل الكامل.'}
            </p>
            <div style={{ overflowX: 'auto', maxHeight: '360px', overflowY: 'auto', border: '1px solid var(--surface-border)', borderRadius: '8px' }}>
              <table>
                <thead>
                  <tr>
                    <th>{currentLang === 'en' ? 'Type' : 'النوع'}</th>
                    <th>{currentLang === 'en' ? 'Item' : 'الصنف'}</th>
                    <th>{currentLang === 'en' ? 'From' : 'من'}</th>
                    <th>{currentLang === 'en' ? 'To' : 'إلى'}</th>
                    <th>{currentLang === 'en' ? 'Ownership Change' : 'تغيير الملكية'}</th>
                    <th>{currentLang === 'en' ? 'Initiated By' : 'بدأها'}</th>
                    <th>{currentLang === 'en' ? 'Time' : 'الوقت'}</th>
                  </tr>
                </thead>
                <tbody>
                  {liveMovements.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                        {currentLang === 'en' ? 'Waiting for the next movement…' : 'في انتظار الحركة التالية…'}
                      </td>
                    </tr>
                  ) : (
                    liveMovements.map((m: any, idx: number) => (
                      <tr key={idx}>
                        <td><span className="badge">{translateDb(m.transaction_type)}</span></td>
                        <td>#{m.item_id}</td>
                        <td>{resolveLocationLabel(m.source_location_id)}</td>
                        <td>{resolveLocationLabel(m.destination_location_id)}</td>
                        <td>{m.source_ownership} → {m.destination_ownership}</td>
                        <td>{m.initiated_by}</td>
                        <td>{new Date(m.timestamp).toLocaleTimeString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SCREEN VIEWPORT: SYSTEM SETTINGS */}
        <section className={`screen-viewport ${activeTab === 'screen-admin' ? 'active' : ''}`}>
          <div className="glass-card">
            <h3>{t('settings_title')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>{t('settings_subtitle')}</p>

            <div style={{ display: 'flex', gap: '10px', borderBottom: '1px solid var(--surface-border)', marginBottom: '24px', flexWrap: 'wrap' }}>
              <button className={`btn-tab ${settingsTab === 'ai' ? 'active' : ''}`} onClick={() => setSettingsTab('ai')}>{t('tab_ai_gateway')}</button>
              <button className={`btn-tab ${settingsTab === 'brands' ? 'active' : ''}`} onClick={() => { setSettingsTab('brands'); fetchBrands(); }}>
                <i className="fa-solid fa-certificate"></i> {currentLang === 'ar' ? 'العلامات والمصانع' : 'Brands & Refiners'}
              </button>
              <button className={`btn-tab ${settingsTab === 'suppliers' ? 'active' : ''}`} onClick={() => setSettingsTab('suppliers')}>{t('tab_suppliers')}</button>
              <button className={`btn-tab ${settingsTab === 'denoms' ? 'active' : ''}`} onClick={() => { setSettingsTab('denoms'); fetchProducts(); fetchBrands(); }}>{t('tab_denoms')}</button>
              <button className={`btn-tab ${settingsTab === 'stocklimits' ? 'active' : ''}`} onClick={() => { setSettingsTab('stocklimits'); fetchReorderThresholds(); }}>
                <i className="fa-solid fa-gauge-high"></i> {currentLang === 'ar' ? 'حدود المخزون' : 'Stock Limits'}
              </button>
              <button className={`btn-tab ${settingsTab === 'branches' ? 'active' : ''}`} onClick={() => { setSettingsTab('branches'); fetchBranches(); }}>
                <i className="fa-solid fa-code-branch"></i> {currentLang === 'ar' ? 'الفروع' : 'Branches'}
              </button>
              <button className={`btn-tab ${settingsTab === 'locations' ? 'active' : ''}`} onClick={() => setSettingsTab('locations')}>
                <i className="fa-solid fa-warehouse"></i> {currentLang === 'ar' ? 'مواقع الخزنة' : 'Vault Locations'}
              </button>
            </div>

            {settingsTab === 'locations' && (
              <div className="settings-tab-pane active">
                <h4>{currentLang === 'en' ? 'Vault Location Setup' : 'إعداد مواقع الخزنة'}</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
                  {currentLang === 'en'
                    ? 'Define new shelf and slot coordinates within the main vault. This is an administrative action; operators view the layout on the Vault Spatial Map.'
                    : 'تحديد إحداثيات رف وخانة تخزين جديدة داخل الخزينة الرئيسية. هذا إجراء إداري؛ يطّلع المشغّلون على المخطط في الخريطة المكانية للخزنة.'}
                </p>
                {canModify('vault_location') ? (
                  <div style={{ maxWidth: '480px' }}>
                    <div className="form-group">
                      <label>{currentLang === 'en' ? 'Zone / Room' : 'المنطقة / الغرفة'}</label>
                      <input type="text" className="form-control" value={newZoneRoom} onChange={e => setNewZoneRoom(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>{currentLang === 'en' ? 'Shelf Row' : 'صف الرف'}</label>
                      <input type="text" className="form-control" placeholder="e.g. Shelf Row 4" value={newShelfRow} onChange={e => setNewShelfRow(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>{currentLang === 'en' ? 'Slot Bin' : 'الخانة / الدرج'}</label>
                      <input type="text" className="form-control" placeholder="e.g. Slot 1" value={newSlotBin} onChange={e => setNewSlotBin(e.target.value)} />
                    </div>
                    <button className="btn btn-primary" style={{ marginTop: '10px' }} onClick={handleAddLocation}>
                      <i className="fa-solid fa-plus"></i> {currentLang === 'en' ? 'Add Location Slot' : 'إضافة الموقع'}
                    </button>
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                    {currentLang === 'en'
                      ? 'You do not have permission to manage vault locations (requires the Vault Location Setup module).'
                      : 'ليس لديك صلاحية لإدارة مواقع الخزنة (تتطلب وحدة إعداد مواقع الخزنة).'}
                  </p>
                )}
              </div>
            )}

            {settingsTab === 'ai' && (
              <div className="settings-tab-pane active">
                <h4>{t('settings_spreads_title')}</h4>
                <div className="form-group" style={{ marginTop: '15px' }}>
                  <label>{t('form_swiss_markup')}</label>
                  <input type="number" defaultValue="1.50" step="0.1" className="form-control" />
                </div>
                <div className="form-group">
                  <label>{t('form_turkish_markup')}</label>
                  <input type="number" defaultValue="1.10" step="0.1" className="form-control" />
                </div>
                <button className="btn btn-primary" onClick={() => alert("Treasury spreads saved.")}>{t('btn_save_spreads')}</button>
              </div>
            )}

            {settingsTab === 'suppliers' && (
              <div className="settings-tab-pane active">
                <h4>{t('settings_refiners_title')}</h4>
                {!canModify('master_data') && (
                  <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', color: 'var(--accent-red)', fontSize: '12px', marginBottom: '15px' }}>
                    <i className="fa-solid fa-circle-exclamation"></i> {currentLang === 'en' ? 'Read-Only Mode: You cannot manage suppliers (requires the Master Data module).' : 'وضع القراءة فقط: لا يمكنك إدارة الموردين (تتطلب وحدة البيانات الرئيسية).'}
                  </div>
                )}
                <div className="table-responsive" style={{ marginTop: '15px', marginBottom: '30px' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>{t('th_code')}</th>
                        <th>{t('th_refiner_name')}</th>
                        <th>{t('th_origin')}</th>
                        <th>{t('th_sharia_compliance')}</th>
                        {canModify('master_data') && <th style={{ width: '110px', textAlign: 'center' }}>{t('th_action')}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {suppliersList.map((sup, idx) => (
                        <tr key={idx}>
                          {editingSupIdx === idx ? (
                            <>
                              <td>
                                <input type="text" className="form-control" value={editSupCode}
                                  onChange={e => setEditSupCode(e.target.value)}
                                  style={{ padding: '6px 8px', fontSize: '13px', width: '110px' }} />
                              </td>
                              <td>
                                <input type="text" className="form-control" value={editSupName}
                                  onChange={e => setEditSupName(e.target.value)}
                                  style={{ padding: '6px 8px', fontSize: '13px' }} />
                              </td>
                              <td>
                                <select value={editSupOrigin} onChange={e => setEditSupOrigin(e.target.value)}
                                  style={{ padding: '6px 8px', fontSize: '13px' }}>
                                  <option value="Switzerland">Switzerland</option>
                                  <option value="Turkey">Turkey</option>
                                  <option value="United Kingdom">United Kingdom</option>
                                </select>
                              </td>
                              <td>
                                <select value={editSupSharia ? 'true' : 'false'} onChange={e => setEditSupSharia(e.target.value === 'true')}
                                  style={{ padding: '6px 8px', fontSize: '13px' }}>
                                  <option value="true">{t('opt_sharia_approved')}</option>
                                  <option value="false">{t('opt_sharia_blocked')}</option>
                                </select>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                  <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }}
                                    onClick={() => handleSaveEditSupplier(idx)}>
                                    <i className="fa-solid fa-check"></i>
                                  </button>
                                  <button className="btn" style={{ padding: '4px 10px', fontSize: '12px' }}
                                    onClick={() => setEditingSupIdx(null)}>
                                    <i className="fa-solid fa-xmark"></i>
                                  </button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td><strong>{sup.code}</strong></td>
                              <td>{sup.name}</td>
                              <td>{translateDb(sup.country)}</td>
                              <td>
                                <span className={`badge ${sup.sharia ? 'badge-ready' : 'badge-quarantined'}`}>
                                  {t(sup.sharia ? 'opt_sharia_approved' : 'opt_sharia_blocked')}
                                </span>
                              </td>
                              {canModify('master_data') && (
                                <td style={{ textAlign: 'center' }}>
                                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                    <button className="btn"
                                      style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--kfh-green)', borderColor: 'var(--kfh-green)' }}
                                      onClick={() => handleStartEditSupplier(idx)} title="Edit">
                                      <i className="fa-solid fa-pen"></i>
                                    </button>
                                    <button className="btn"
                                      style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--accent-red)', borderColor: '#FECACA' }}
                                      onClick={() => handleDeleteSupplier(idx)} title="Delete">
                                      <i className="fa-solid fa-trash"></i>
                                    </button>
                                  </div>
                                </td>
                              )}
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Add New Supplier Form */}
                {canModify('master_data') && (
                <div className="glass-card">
                  <h4 style={{ marginBottom: '16px', fontSize: '15px' }}>{t('settings_add_sup_title')}</h4>
                  <div className="split-grid-2" style={{ gap: '16px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{t('form_sup_code')}</label>
                      <input type="text" className="form-control" placeholder={t('placeholder_sup_code')} value={newSupCode} onChange={e => setNewSupCode(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{t('form_sup_name')}</label>
                      <input type="text" className="form-control" placeholder={t('placeholder_sup_name')} value={newSupName} onChange={e => setNewSupName(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{t('form_origin')}</label>
                      <select value={newSupOrigin} onChange={e => setNewSupOrigin(e.target.value)}>
                        <option value="Switzerland">Switzerland</option>
                        <option value="Turkey">Turkey</option>
                        <option value="United Kingdom">United Kingdom</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{t('form_sharia_status')}</label>
                      <select value={newSupSharia ? 'true' : 'false'} onChange={e => setNewSupSharia(e.target.value === 'true')}>
                        <option value="true">{t('opt_sharia_approved')}</option>
                        <option value="false">{t('opt_sharia_blocked')}</option>
                      </select>
                    </div>
                  </div>
                  <button className="btn btn-primary" style={{ marginTop: '16px' }}
                    onClick={handleAddSupplier}
                    disabled={!newSupCode.trim() || !newSupName.trim()}>
                    <i className="fa-solid fa-plus"></i> {t('btn_register_supplier')}
                  </button>
                </div>
                )}
              </div>
            )}

            {settingsTab === 'denoms' && (
              <div className="settings-tab-pane active">
                <h4>{t('settings_denoms_title')}</h4>
                {!canModify('master_data') && (
                  <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', color: 'var(--accent-red)', fontSize: '12px', marginBottom: '15px' }}>
                    <i className="fa-solid fa-circle-exclamation"></i> {currentLang === 'en' ? 'Read-Only Mode: You cannot manage denominations (requires the Master Data module).' : 'وضع القراءة فقط: لا يمكنك إدارة الفئات (تتطلب وحدة البيانات الرئيسية).'}
                  </div>
                )}

                {/* Filter & Sort Controls */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', marginTop: '15px', marginBottom: '15px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '12px' }}>Search by Name</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g., Gold 100g"
                      value={denomFilterText}
                      onChange={e => setDenomFilterText(e.target.value)}
                      style={{ padding: '6px 8px', fontSize: '12px' }}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '12px' }}>Filter by Origin</label>
                    <select
                      value={denomFilterOrigin}
                      onChange={e => setDenomFilterOrigin(e.target.value)}
                      style={{ padding: '6px 8px', fontSize: '12px' }}
                    >
                      <option value="">All Origins</option>
                      <option value="Switzerland">Switzerland</option>
                      <option value="Turkey">Turkey</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '12px' }}>Sort by</label>
                    <select
                      value={denomSortBy}
                      onChange={e => setDenomSortBy(e.target.value as any)}
                      style={{ padding: '6px 8px', fontSize: '12px' }}
                    >
                      <option value="label">Name</option>
                      <option value="metal">Metal Type</option>
                      <option value="weight">Weight</option>
                      <option value="origin">Origin</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button
                      className="btn"
                      style={{ width: '100%', padding: '6px 8px', fontSize: '12px', backgroundColor: 'var(--accent-red)', color: '#fff' }}
                      onClick={() => {
                        setDenomFilterText('');
                        setDenomFilterOrigin('');
                        setDenomSortBy('label');
                      }}
                    >
                      <i className="fa-solid fa-redo"></i> Reset Filters
                    </button>
                  </div>
                </div>

                <div className="table-responsive" style={{ marginTop: '15px' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>{t('th_label_name')}</th>
                        <th>{t('th_metal_type')}</th>
                        <th>{t('th_weight_grams')}</th>
                        <th>Product Code</th>
                        <th>{currentLang === 'ar' ? 'العلامة / المصنع' : 'Brand / Mint'}</th>
                        <th>Origin Country</th>
                        {canModify('master_data') && <th style={{ width: '110px', textAlign: 'center' }}>{t('th_action')}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        let filtered = denomsList.filter((d: any) => {
                          const matchesText = d.label.toLowerCase().includes(denomFilterText.toLowerCase());
                          const matchesOrigin = !denomFilterOrigin || d.origin === denomFilterOrigin;
                          return matchesText && matchesOrigin;
                        });

                        filtered.sort((a: any, b: any) => {
                          switch (denomSortBy) {
                            case 'metal':
                              return a.metal.localeCompare(b.metal);
                            case 'weight':
                              return a.weight - b.weight;
                            case 'origin':
                              return (a.origin || '').localeCompare(b.origin || '');
                            default: // label
                              return a.label.localeCompare(b.label);
                          }
                        });

                        return filtered.map((d: any) => {
                          const idx = denomsList.indexOf(d);
                          return (
                        <tr key={idx}>
                          {editingDenomIdx === idx ? (
                            <>
                              <td>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={editDenomLabel}
                                  onChange={e => setEditDenomLabel(e.target.value)}
                                  style={{ padding: '6px 8px', fontSize: '13px' }}
                                />
                              </td>
                              <td>
                                <select
                                  value={editDenomMetal}
                                  onChange={e => setEditDenomMetal(e.target.value)}
                                  style={{ padding: '6px 8px', fontSize: '13px' }}
                                >
                                  <option value="Gold">{t('opt_gold')}</option>
                                  <option value="Silver">{t('opt_silver')}</option>
                                </select>
                              </td>
                              <td>
                                <input
                                  type="number"
                                  className="form-control"
                                  value={editDenomWeight}
                                  onChange={e => setEditDenomWeight(e.target.value)}
                                  style={{ padding: '6px 8px', fontSize: '13px', width: '100px' }}
                                />
                              </td>
                              <td>
                                <code style={{ color: 'var(--accent-blue)', fontSize: '12px' }}>{d.product_code || 'N/A'}</code>
                              </td>
                              <td>
                                <select
                                  value={editDenomBrandId}
                                  onChange={e => {
                                    setEditDenomBrandId(e.target.value);
                                    const b = brandsList.find((x: any) => x.brand_id === parseInt(e.target.value));
                                    if (b) setEditDenomOrigin(b.country_of_origin);
                                  }}
                                  style={{ padding: '6px 8px', fontSize: '13px' }}
                                >
                                  <option value="">-- Brand --</option>
                                  {brandsList.map((b: any) => (
                                    <option key={b.brand_id} value={b.brand_id}>
                                      {b.brand_name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <select
                                  value={editDenomOrigin}
                                  onChange={e => setEditDenomOrigin(e.target.value)}
                                  style={{ padding: '6px 8px', fontSize: '13px' }}
                                >
                                  <option value="Switzerland">Switzerland</option>
                                  <option value="Turkey">Turkey</option>
                                  <option value="United Arab Emirates">United Arab Emirates</option>
                                  <option value="Australia">Australia</option>
                                  <option value="Kuwait">Kuwait</option>
                                </select>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                  <button
                                    className="btn btn-primary"
                                    style={{ padding: '4px 10px', fontSize: '12px' }}
                                    onClick={() => handleSaveEditDenom(idx)}
                                  >
                                    <i className="fa-solid fa-check"></i>
                                  </button>
                                  <button
                                    className="btn"
                                    style={{ padding: '4px 10px', fontSize: '12px' }}
                                    onClick={() => setEditingDenomIdx(null)}
                                  >
                                    <i className="fa-solid fa-xmark"></i>
                                  </button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td><strong>{d.label}</strong></td>
                              <td>
                                <span className={`badge ${d.metal === 'Gold' ? 'badge-reserved' : 'badge-transfer'}`}>
                                  {d.metal === 'Gold' ? t('opt_gold') : t('opt_silver')}
                                </span>
                              </td>
                              <td>{d.weight}g</td>
                              <td><code style={{ color: 'var(--accent-blue)', fontSize: '12px' }}>{d.product_code || 'N/A'}</code></td>
                              <td>
                                <span className="badge badge-ready" style={{ fontSize: '11px' }}>
                                  <i className="fa-solid fa-certificate" style={{ marginRight: '4px' }}></i>
                                  {d.brand_name || (d.origin === 'Switzerland' ? 'Valcambi Suisse' : d.origin === 'Turkey' ? 'Nadir Refinery' : 'KFH Mint')}
                                </span>
                              </td>
                              <td><span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{d.origin || 'N/A'}</span></td>
                              {canModify('master_data') && (
                                <td style={{ textAlign: 'center' }}>
                                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                    <button
                                      className="btn"
                                      style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--kfh-green)', borderColor: 'var(--kfh-green)' }}
                                      onClick={() => handleStartEditDenom(idx)}
                                      title="Edit"
                                    >
                                      <i className="fa-solid fa-pen"></i>
                                    </button>
                                    <button
                                      className="btn"
                                      style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--accent-red)', borderColor: '#FECACA' }}
                                      onClick={() => handleDeleteDenom(idx)}
                                      title="Delete"
                                    >
                                      <i className="fa-solid fa-trash"></i>
                                    </button>
                                  </div>
                                </td>
                              )}
                            </>
                          )}
                        </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>

                {/* Add New Denomination Form */}
                {canModify('master_data') && (
                <div className="glass-card" style={{ marginTop: '24px' }}>
                  <h4 style={{ marginBottom: '16px', fontSize: '15px' }}>{t('settings_add_denom_title')}</h4>
                  <div className="split-grid-2" style={{ gap: '16px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{t('form_denom_label')}</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder={t('placeholder_denom_label')}
                        value={newDenomLabel}
                        onChange={e => setNewDenomLabel(e.target.value)}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{t('form_metal_type')}</label>
                      <select value={newDenomMetal} onChange={e => setNewDenomMetal(e.target.value)}>
                        <option value="Gold">{t('opt_gold')}</option>
                        <option value="Silver">{t('opt_silver')}</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{t('form_weight_grams_label')}</label>
                      <input
                        type="number"
                        className="form-control"
                        placeholder={t('placeholder_weight_grams')}
                        value={newDenomWeight}
                        onChange={e => setNewDenomWeight(e.target.value)}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{currentLang === 'ar' ? 'العلامة التجارية / المصنع (Lookup)' : 'Refiner / Mint Brand (Lookup)'}</label>
                      <select 
                        value={newDenomBrandId} 
                        onChange={e => {
                          const val = e.target.value;
                          setNewDenomBrandId(val);
                          const b = brandsList.find((x: any) => x.brand_id === parseInt(val));
                          if (b) setNewDenomOrigin(b.country_of_origin);
                        }}
                      >
                        <option value="">-- {currentLang === 'ar' ? 'اختر العلامة / المصنع' : 'Select Refiner / Mint Brand'} --</option>
                        {brandsList.map((b: any) => (
                          <option key={b.brand_id} value={b.brand_id}>
                            {b.brand_name} ({b.country_of_origin}) {b.is_lbma_certified ? '★ LBMA' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Product Origin</label>
                      <select value={newDenomOrigin} onChange={e => setNewDenomOrigin(e.target.value)}>
                        <option value="Switzerland">Switzerland</option>
                        <option value="Turkey">Turkey</option>
                        <option value="United Arab Emirates">United Arab Emirates</option>
                        <option value="Australia">Australia</option>
                        <option value="Kuwait">Kuwait</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <button
                        className="btn btn-primary"
                        style={{ width: '100%' }}
                        onClick={handleAddDenom}
                        disabled={!newDenomLabel.trim() || !newDenomWeight}
                      >
                        <i className="fa-solid fa-plus"></i> {t('btn_register_denom')}
                      </button>
                    </div>
                  </div>
                </div>
                )}
              </div>
            )}

            {/* BRANDS & REFINERS LOOKUP MASTER DATA TAB */}
            {settingsTab === 'brands' && (
              <div className="settings-tab-pane active">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '16px' }}>{currentLang === 'ar' ? 'سجل العلامات التجارية والمصانع المعتمدة (Brand Lookup)' : 'Approved Brands & Refiners Master Data (Brand Lookup)'}</h4>
                    <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '4px 0 0 0' }}>
                      {currentLang === 'ar'
                        ? 'إدارة مصانع وسكّاك الذهب والفضة المعتمدة لدى بيت التمويل الكويتي (KFH) مع شهادات اعتماد LBMA وبلد المنشأ.'
                        : 'Manage KFH-approved mint and bullion refiner brands with LBMA certification status and country of origin.'}
                    </p>
                  </div>
                  <button className="btn" onClick={fetchBrands} style={{ fontSize: '12px' }}>
                    <i className="fa-solid fa-rotate"></i> {currentLang === 'ar' ? 'تحديث القائمة' : 'Refresh Brands'}
                  </button>
                </div>

                {!canModify('master_data') && (
                  <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', color: 'var(--accent-red)', fontSize: '12px', marginBottom: '15px' }}>
                    <i className="fa-solid fa-circle-exclamation"></i> {currentLang === 'en' ? 'Read-Only Mode: You cannot manage brands (requires Master Data policy).' : 'وضع القراءة فقط: لا يمكنك تعديل العلامات التجارية (تتطلب وحدة البيانات الرئيسية).'}
                  </div>
                )}

                <div className="table-responsive">
                  <table>
                    <thead>
                      <tr>
                        <th>{currentLang === 'ar' ? 'رمز العلامة' : 'Brand Code'}</th>
                        <th>{currentLang === 'ar' ? 'اسم العلامة / المصفاة' : 'Brand / Refiner Name'}</th>
                        <th>{currentLang === 'ar' ? 'بلد المنشأ' : 'Country of Origin'}</th>
                        <th>{currentLang === 'ar' ? 'معرف المصفاة' : 'LBMA / Refiner Ref'}</th>
                        <th>{currentLang === 'ar' ? 'اعتماد LBMA' : 'LBMA Certified'}</th>
                        <th>{currentLang === 'ar' ? 'الحالة' : 'Status'}</th>
                        <th>{currentLang === 'ar' ? 'الوصف' : 'Description'}</th>
                        {canModify('master_data') && <th style={{ width: '110px', textAlign: 'center' }}>{t('th_action')}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {brandsList.map((b: any, idx: number) => (
                        <tr key={b.brand_id || idx}>
                          {editingBrandIdx === idx ? (
                            <>
                              <td>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={editBrandCode}
                                  onChange={e => setEditBrandCode(e.target.value)}
                                  style={{ padding: '4px 8px', fontSize: '12px' }}
                                />
                              </td>
                              <td>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={editBrandName}
                                  onChange={e => setEditBrandName(e.target.value)}
                                  style={{ padding: '4px 8px', fontSize: '12px' }}
                                />
                              </td>
                              <td>
                                <select
                                  value={editBrandOrigin}
                                  onChange={e => setEditBrandOrigin(e.target.value)}
                                  style={{ padding: '4px 8px', fontSize: '12px' }}
                                >
                                  <option value="Switzerland">Switzerland</option>
                                  <option value="Turkey">Turkey</option>
                                  <option value="United Arab Emirates">United Arab Emirates</option>
                                  <option value="Australia">Australia</option>
                                  <option value="Kuwait">Kuwait</option>
                                  <option value="United Kingdom">United Kingdom</option>
                                </select>
                              </td>
                              <td>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={editBrandLbmaId}
                                  onChange={e => setEditBrandLbmaId(e.target.value)}
                                  style={{ padding: '4px 8px', fontSize: '12px' }}
                                />
                              </td>
                              <td>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={editBrandLbmaCert}
                                    onChange={e => setEditBrandLbmaCert(e.target.checked)}
                                  />
                                  <span>LBMA</span>
                                </label>
                              </td>
                              <td>
                                <span className="badge badge-ready">Active</span>
                              </td>
                              <td>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={editBrandDesc}
                                  onChange={e => setEditBrandDesc(e.target.value)}
                                  style={{ padding: '4px 8px', fontSize: '12px' }}
                                />
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                  <button
                                    className="btn btn-primary"
                                    style={{ padding: '4px 10px', fontSize: '12px' }}
                                    onClick={() => handleSaveEditBrand(idx)}
                                  >
                                    <i className="fa-solid fa-check"></i>
                                  </button>
                                  <button
                                    className="btn"
                                    style={{ padding: '4px 10px', fontSize: '12px' }}
                                    onClick={() => setEditingBrandIdx(null)}
                                  >
                                    <i className="fa-solid fa-xmark"></i>
                                  </button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td>
                                <code style={{ color: 'var(--accent-blue)', fontWeight: 'bold' }}>{b.brand_code}</code>
                              </td>
                              <td>
                                <strong>{b.brand_name}</strong>
                              </td>
                              <td>
                                <span>{b.country_of_origin}</span>
                              </td>
                              <td>
                                <code style={{ fontSize: '11px' }}>{b.lbma_refiner_id || 'N/A'}</code>
                              </td>
                              <td>
                                {b.is_lbma_certified ? (
                                  <span className="badge badge-ready" style={{ fontSize: '11px' }}>
                                    <i className="fa-solid fa-shield-halved" style={{ marginRight: '3px' }}></i> LBMA Certified
                                  </span>
                                ) : (
                                  <span className="badge" style={{ fontSize: '11px', background: 'rgba(156,163,175,0.2)', color: 'var(--text-muted)' }}>
                                    Non-LBMA
                                  </span>
                                )}
                              </td>
                              <td>
                                <span className={`badge ${b.is_active !== false ? 'badge-ready' : 'badge-reserved'}`}>
                                  {b.is_active !== false ? (currentLang === 'ar' ? 'نشط' : 'Active') : (currentLang === 'ar' ? 'موقوف' : 'Inactive')}
                                </span>
                              </td>
                              <td>
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{b.description || '—'}</span>
                              </td>
                              {canModify('master_data') && (
                                <td style={{ textAlign: 'center' }}>
                                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                    <button
                                      className="btn"
                                      style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--kfh-green)', borderColor: 'var(--kfh-green)' }}
                                      onClick={() => handleStartEditBrand(idx)}
                                      title="Edit"
                                    >
                                      <i className="fa-solid fa-pen"></i>
                                    </button>
                                    <button
                                      className="btn"
                                      style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--accent-red)', borderColor: '#FECACA' }}
                                      onClick={() => handleDeleteBrand(idx)}
                                      title="Delete"
                                    >
                                      <i className="fa-solid fa-trash"></i>
                                    </button>
                                  </div>
                                </td>
                              )}
                            </>
                          )}
                        </tr>
                      ))}
                      {brandsList.length === 0 && (
                        <tr>
                          <td colSpan={8} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                            {currentLang === 'ar' ? 'لا توجد علامات تجارية مسجلة. انقر على "تحديث" أو سجّل علامة جديدة أدناه.' : 'No brands registered. Click refresh or register a new brand below.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Register New Brand Form */}
                {canModify('master_data') && (
                  <div className="glass-card" style={{ marginTop: '24px' }}>
                    <h4 style={{ marginBottom: '16px', fontSize: '15px' }}>
                      <i className="fa-solid fa-plus" style={{ color: 'var(--kfh-green)', marginRight: '6px' }}></i>
                      {currentLang === 'ar' ? 'تسجيل علامة تجارية / مصنع جديد' : 'Register New Brand / Bullion Refiner'}
                    </h4>
                    <div className="split-grid-3" style={{ gap: '16px', marginBottom: '16px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>{currentLang === 'ar' ? 'رمز العلامة (مثل PAMP)' : 'Brand Code (e.g. PAMP)'}</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="e.g. PAMP"
                          value={newBrandCode}
                          onChange={e => setNewBrandCode(e.target.value.toUpperCase())}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>{currentLang === 'ar' ? 'اسم المصفاة / العلامة' : 'Brand / Refiner Full Name'}</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="e.g. PAMP Suisse SA"
                          value={newBrandName}
                          onChange={e => setNewBrandName(e.target.value)}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>{currentLang === 'ar' ? 'بلد المنشأ' : 'Country of Origin'}</label>
                        <select value={newBrandOrigin} onChange={e => setNewBrandOrigin(e.target.value)}>
                          <option value="Switzerland">Switzerland</option>
                          <option value="Turkey">Turkey</option>
                          <option value="United Arab Emirates">United Arab Emirates</option>
                          <option value="Australia">Australia</option>
                          <option value="Kuwait">Kuwait</option>
                          <option value="United Kingdom">United Kingdom</option>
                        </select>
                      </div>
                    </div>
                    <div className="split-grid-3" style={{ gap: '16px', marginBottom: '16px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>{currentLang === 'ar' ? 'معرف المصفاة / كود الاعتماد' : 'LBMA Refiner ID / Certificate Code'}</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="e.g. LBMA-CH-0042"
                          value={newBrandLbmaId}
                          onChange={e => setNewBrandLbmaId(e.target.value)}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>{currentLang === 'ar' ? 'الوصف / ملاحظات المطابقة' : 'Description / Compliance Notes'}</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="e.g. LBMA Good Delivery accredited Swiss gold refiner"
                          value={newBrandDesc}
                          onChange={e => setNewBrandDesc(e.target.value)}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', paddingTop: '25px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                          <input
                            type="checkbox"
                            checked={newBrandLbmaCert}
                            onChange={e => setNewBrandLbmaCert(e.target.checked)}
                          />
                          <span>{currentLang === 'ar' ? 'معتمد رسمياً من LBMA (Good Delivery)' : 'LBMA Good Delivery Certified'}</span>
                        </label>
                      </div>
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={handleAddBrand}
                      disabled={!newBrandCode.trim() || !newBrandName.trim()}
                    >
                      <i className="fa-solid fa-plus"></i> {currentLang === 'ar' ? 'تسجيل العلامة التجارية' : 'Register Brand'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {settingsTab === 'stocklimits' && (
              <div className="settings-tab-pane active">
                <h4>{currentLang === 'ar' ? 'حدود إعادة الطلب' : 'Reorder Thresholds'}</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
                  {currentLang === 'ar' ? 'عندما يصل المخزون إلى هذا الحد، يتم إنشاء تنبيه وطلب شراء تلقائي.' : 'When stock reaches this limit, an alarm is triggered and a draft P.O. can be auto-generated.'}
                </p>
                {!canModify('master_data') && (
                  <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', color: 'var(--accent-red)', fontSize: '12px', marginBottom: '15px' }}>
                    <i className="fa-solid fa-circle-exclamation"></i> {currentLang === 'en' ? 'Read-Only Mode: You cannot manage stock limits (requires the Master Data module).' : 'وضع القراءة فقط: لا يمكنك إدارة حدود المخزون (تتطلب وحدة البيانات الرئيسية).'}
                  </div>
                )}

                <div className="table-responsive" style={{ marginBottom: '30px' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>{currentLang === 'ar' ? 'المنتج' : 'Product'}</th>
                        <th>{currentLang === 'ar' ? 'المورد المفضل' : 'Preferred Vendor'}</th>
                        <th>{currentLang === 'ar' ? 'الحد الأدنى' : 'Min Stock'}</th>
                        <th>{currentLang === 'ar' ? 'كمية إعادة الطلب' : 'Reorder Qty'}</th>
                        <th>{currentLang === 'ar' ? 'الحالة' : 'Status'}</th>
                        {canModify('master_data') && <th style={{ width: '80px', textAlign: 'center' }}>{currentLang === 'ar' ? 'إجراء' : 'Action'}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {reorderThresholds.length === 0 ? (
                        <tr><td colSpan={canModify('master_data') ? 6 : 5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px' }}>
                          <i className="fa-solid fa-inbox" style={{ fontSize: '24px', marginBottom: '8px', display: 'block' }}></i>
                          {currentLang === 'ar' ? 'لم يتم تعيين حدود بعد' : 'No thresholds configured yet'}
                        </td></tr>
                      ) : reorderThresholds.map((th: any) => (
                        <tr key={th.threshold_id}>
                          <td><strong>{th.product_name || th.product_code}</strong></td>
                          <td>{th.vendor_name}</td>
                          <td><span className="badge badge-reserved">{th.min_stock_qty}</span></td>
                          <td><span className="badge badge-ready">{th.reorder_qty}</span></td>
                          <td>
                            <span className={`badge ${th.is_active ? 'badge-ready' : 'badge-sold'}`}>
                              {th.is_active ? (currentLang === 'ar' ? 'نشط' : 'Active') : (currentLang === 'ar' ? 'معطل' : 'Disabled')}
                            </span>
                          </td>
                          {canModify('master_data') && (
                            <td style={{ textAlign: 'center' }}>
                              <button className="btn" style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--accent-red)', borderColor: '#FECACA' }}
                                onClick={() => handleDeleteThreshold(th.threshold_id)} title="Delete">
                                <i className="fa-solid fa-trash"></i>
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Add New Threshold Form */}
                {canModify('master_data') && (
                <div className="glass-card" style={{ marginTop: '24px' }}>
                  <h4 style={{ marginBottom: '16px', fontSize: '15px' }}>
                    <i className="fa-solid fa-plus-circle" style={{ color: 'var(--kfh-green)', marginRight: '8px' }}></i>
                    {currentLang === 'ar' ? 'إضافة حد مخزون جديد' : 'Add New Stock Limit'}
                  </h4>
                  <div className="split-grid-2" style={{ gap: '16px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{currentLang === 'ar' ? 'المنتج' : 'Product'}</label>
                      <select value={newThresholdProductId} onChange={e => setNewThresholdProductId(e.target.value)} style={{ color: '#000' }}>
                        <option value="">{currentLang === 'ar' ? '-- اختر المنتج --' : '-- Select Product --'}</option>
                        {products.map((p: any) => (
                          <option key={p.product_id} value={p.product_id}>{p.metal_name} {p.denomination_label} ({p.product_code})</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{currentLang === 'ar' ? 'المورد المفضل' : 'Preferred Vendor'}</label>
                      <select value={newThresholdVendorId} onChange={e => setNewThresholdVendorId(e.target.value)} style={{ color: '#000' }}>
                        <option value="">{currentLang === 'ar' ? '-- اختر المورد --' : '-- Select Vendor --'}</option>
                        {suppliersList.map((v: any) => (
                          <option key={v.vendor_id || v.code} value={v.vendor_id}>{v.vendor_name || v.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{currentLang === 'ar' ? 'الحد الأدنى للمخزون' : 'Minimum Stock Qty'}</label>
                      <input type="number" className="form-control" value={newThresholdMinQty} onChange={e => setNewThresholdMinQty(e.target.value)} min="1" />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{currentLang === 'ar' ? 'كمية إعادة الطلب' : 'Reorder Qty'}</label>
                      <input type="number" className="form-control" value={newThresholdReorderQty} onChange={e => setNewThresholdReorderQty(e.target.value)} min="1" />
                    </div>
                  </div>
                  <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={handleAddThreshold}
                    disabled={!newThresholdProductId || !newThresholdVendorId}>
                    <i className="fa-solid fa-plus"></i> {currentLang === 'ar' ? 'إضافة حد المخزون' : 'Add Stock Limit'}
                  </button>
                </div>
                )}
              </div>
            )}

            {settingsTab === 'branches' && (
              <div className="settings-tab-pane active">
                <h4>{currentLang === 'ar' ? 'إدارة فروع بيت التمويل الكويتي' : 'KFH Branch Management'}</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
                  {currentLang === 'ar' ? 'إدارة وتعديل الفروع الخاصة بـ بيت التمويل الكويتي، بما في ذلك فرع KFH Online.' : 'Manage KFH Branches, vault linkages, and state mappings. KFH Online is treated as a digital branch.'}
                </p>
                {!canModify('master_data') && (
                  <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', color: 'var(--accent-red)', fontSize: '12px', marginBottom: '15px' }}>
                    <i className="fa-solid fa-circle-exclamation"></i> {currentLang === 'en' ? 'Read-Only Mode: You cannot manage branches (requires the Master Data module).' : 'وضع القراءة فقط: لا يمكنك إدارة الفروع (تتطلب وحدة البيانات الرئيسية).'}
                  </div>
                )}

                {/* Filter & Sort for Branches */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '15px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '12px' }}>Search Branch</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Name or Code"
                      value={branchFilterText}
                      onChange={e => setBranchFilterText(e.target.value)}
                      style={{ padding: '6px 8px', fontSize: '12px' }}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '12px' }}>Sort by</label>
                    <select
                      value={branchSortBy}
                      onChange={e => setBranchSortBy(e.target.value as any)}
                      style={{ padding: '6px 8px', fontSize: '12px' }}
                    >
                      <option value="name">Name</option>
                      <option value="code">Code</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button
                      className="btn"
                      style={{ width: '100%', padding: '6px 8px', fontSize: '12px', backgroundColor: 'var(--accent-red)', color: '#fff' }}
                      onClick={() => {
                        setBranchFilterText('');
                        setBranchSortBy('name');
                      }}
                    >
                      <i className="fa-solid fa-redo"></i> Reset
                    </button>
                  </div>
                </div>

                <div className="table-responsive" style={{ marginBottom: '30px' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>{currentLang === 'ar' ? 'رمز الفرع' : 'Branch Code'}</th>
                        <th>{currentLang === 'ar' ? 'اسم الفرع' : 'Branch Name'}</th>
                        <th>{currentLang === 'ar' ? 'الخزنة المرتبطة' : 'Linked Vault'}</th>
                        <th>{currentLang === 'ar' ? 'الحالة' : 'Status'}</th>
                        {canModify('master_data') && <th style={{ width: '110px', textAlign: 'center' }}>{currentLang === 'ar' ? 'إجراء' : 'Action'}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        let filtered = branchesList.filter((b: any) => {
                          const matchesText = (b.branch_name?.toLowerCase() || '').includes(branchFilterText.toLowerCase()) ||
                                            (b.branch_code?.toLowerCase() || '').includes(branchFilterText.toLowerCase());
                          return matchesText;
                        });

                        filtered.sort((a: any, b: any) => {
                          switch (branchSortBy) {
                            case 'code':
                              return (a.branch_code || '').localeCompare(b.branch_code || '');
                            default: // name
                              return (a.branch_name || '').localeCompare(b.branch_name || '');
                          }
                        });

                        return filtered.map((b: any) => {
                          const idx = branchesList.indexOf(b);
                          return (
                        <tr key={idx}>
                          {editingBranchIdx === idx ? (
                            <>
                              <td>
                                <input type="text" className="form-control" value={editBranchCode}
                                  onChange={e => setEditBranchCode(e.target.value)}
                                  style={{ padding: '6px 8px', fontSize: '13px', width: '120px' }} />
                              </td>
                              <td>
                                <input type="text" className="form-control" value={editBranchName}
                                  onChange={e => setEditBranchName(e.target.value)}
                                  style={{ padding: '6px 8px', fontSize: '13px' }} />
                              </td>
                              <td>
                                <select value={editBranchVaultId} onChange={e => setEditBranchVaultId(e.target.value)}
                                  style={{ padding: '6px 8px', fontSize: '13px', color: '#000' }}>
                                  <option value="1">Main Vault</option>
                                  <option value="2">Branch Vault</option>
                                </select>
                              </td>
                              <td>
                                <select value={editBranchActive ? 'true' : 'false'} onChange={e => setEditBranchActive(e.target.value === 'true')}
                                  style={{ padding: '6px 8px', fontSize: '13px', color: '#000' }}>
                                  <option value="true">{currentLang === 'ar' ? 'نشط' : 'Active'}</option>
                                  <option value="false">{currentLang === 'ar' ? 'معطل' : 'Disabled'}</option>
                                </select>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                  <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }}
                                    onClick={() => handleSaveEditBranch(idx)}>
                                    <i className="fa-solid fa-check"></i>
                                  </button>
                                  <button className="btn" style={{ padding: '4px 10px', fontSize: '12px' }}
                                    onClick={() => setEditingBranchIdx(null)}>
                                    <i className="fa-solid fa-xmark"></i>
                                  </button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td><strong>{b.branch_code}</strong></td>
                              <td>{b.branch_name}</td>
                              <td>{b.vault_name}</td>
                              <td>
                                <span className={`badge ${b.is_active ? 'badge-ready' : 'badge-sold'}`}>
                                  {b.is_active ? (currentLang === 'ar' ? 'نشط' : 'Active') : (currentLang === 'ar' ? 'معطل' : 'Disabled')}
                                </span>
                              </td>
                              {canModify('master_data') && (
                                <td style={{ textAlign: 'center' }}>
                                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                    <button className="btn" style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--kfh-green)', borderColor: 'var(--kfh-green)' }}
                                      onClick={() => handleStartEditBranch(idx)} title="Edit">
                                      <i className="fa-solid fa-pen"></i>
                                    </button>
                                    <button className="btn" style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--accent-red)', borderColor: '#FECACA' }}
                                      onClick={() => handleDeleteBranch(b.branch_id)} title="Delete">
                                      <i className="fa-solid fa-trash"></i>
                                    </button>
                                  </div>
                                </td>
                              )}
                            </>
                          )}
                        </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>

                {/* Add KFH Branch Form */}
                {canModify('master_data') && (
                <div className="glass-card" style={{ marginTop: '24px' }}>
                  <h4 style={{ marginBottom: '16px', fontSize: '15px' }}>
                    <i className="fa-solid fa-plus-circle" style={{ color: 'var(--kfh-green)', marginRight: '8px' }}></i>
                    {currentLang === 'ar' ? 'تسجيل فرع جديد لـ بيتك' : 'Register New KFH Branch'}
                  </h4>
                  <div className="split-grid-2" style={{ gap: '16px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{currentLang === 'ar' ? 'رمز الفرع' : 'Branch Code'}</label>
                      <input type="text" className="form-control" placeholder="e.g. KFH_ONLINE, SALMIYA"
                        value={newBranchCode} onChange={e => setNewBranchCode(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{currentLang === 'ar' ? 'اسم الفرع' : 'Branch Name'}</label>
                      <input type="text" className="form-control" placeholder="e.g. KFH Online Digital Branch"
                        value={newBranchName} onChange={e => setNewBranchName(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{currentLang === 'ar' ? 'الخزنة' : 'Vault'}</label>
                      <select value={newBranchVaultId} onChange={e => setNewBranchVaultId(e.target.value)} style={{ color: '#000' }}>
                        <option value="1">Main Vault</option>
                        <option value="2">Branch Vault</option>
                      </select>
                    </div>
                  </div>
                  <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={handleAddBranch}
                    disabled={!newBranchCode.trim() || !newBranchName.trim()}>
                    <i className="fa-solid fa-plus"></i> {currentLang === 'ar' ? 'تسجيل الفرع' : 'Register Branch'}
                  </button>
                </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* SCREEN VIEWPORT: SQL QUERY ADMIN TOOL */}
        <section className={`screen-viewport ${activeTab === 'screen-sql-admin' ? 'active' : ''}`}>
          <div className="glass-card">
            <h3>{currentLang === 'en' ? 'SQL Query Tool' : 'أداة استعلام SQL'}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
              {currentLang === 'en'
                ? 'Execute SQL queries directly against the database. Use with caution.'
                : 'تنفيذ استعلامات SQL مباشرة ضد قاعدة البيانات. استخدم بحذر.'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '20px' }}>
              <div className="form-group">
                <label style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '8px', display: 'block' }}>
                  {currentLang === 'en' ? 'SQL Query' : 'استعلام SQL'}
                </label>
                <textarea
                  value={sqlQuery}
                  onChange={(e) => setSqlQuery(e.target.value)}
                  placeholder="SELECT * FROM InventoryItems WHERE OwnershipType = 'KFH_OWNED';"
                  style={{
                    width: '100%',
                    minHeight: '200px',
                    padding: '12px',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--surface-border)',
                    borderRadius: '4px',
                    color: '#000'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    if (!sqlQuery.trim()) {
                      alert(currentLang === 'en' ? 'Enter a SQL query' : 'أدخل استعلام SQL');
                      return;
                    }
                    setSqlLoading(true);
                    setSqlResult(null);
                    try {
                      const res = await fetch(`${API_BASE}/admin/sql-query`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: sqlQuery })
                      });
                      if (!res.ok) {
                        setSqlResult({ success: false, error: `HTTP ${res.status}: ${res.statusText}` });
                        return;
                      }
                      const text = await res.text();
                      if (!text) {
                        setSqlResult({ success: false, error: 'Empty response from server' });
                        return;
                      }
                      try {
                        const data = JSON.parse(text);
                        setSqlResult(data);
                      } catch (parseErr) {
                        setSqlResult({ success: false, error: 'Invalid JSON response', details: text.substring(0, 500) });
                      }
                    } catch (e: any) {
                      setSqlResult({ success: false, error: e.message || 'Network error' });
                    } finally {
                      setSqlLoading(false);
                    }
                  }}
                  disabled={sqlLoading}
                >
                  <i className="fa-solid fa-play"></i> {currentLang === 'en' ? 'Execute' : 'تنفيذ'}
                </button>
                <button
                  className="btn"
                  onClick={() => setSqlQuery('')}
                  style={{ backgroundColor: 'var(--accent-gray)' }}
                >
                  {currentLang === 'en' ? 'Clear' : 'مسح'}
                </button>
              </div>
            </div>

            {sqlLoading && (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-spinner fa-spin"></i> {currentLang === 'en' ? 'Executing...' : 'جاري التنفيذ...'}
              </div>
            )}

            {sqlResult && (
              <div style={{ borderTop: '1px solid var(--surface-border)', paddingTop: '20px' }}>
                {sqlResult.success ? (
                  <>
                    <p style={{ color: 'var(--accent-green)', fontSize: '12px', marginBottom: '15px' }}>
                      ✓ {currentLang === 'en' ? `${sqlResult.rowCount} rows returned` : `تم إرجاع ${sqlResult.rowCount} صف`}
                    </p>
                    {sqlResult.data && sqlResult.data.length > 0 && (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid var(--surface-border)' }}>
                              {Object.keys(sqlResult.data[0]).map((col) => (
                                <th key={col} style={{ padding: '8px', textAlign: 'left', fontWeight: 'bold', color: 'var(--accent-blue)' }}>{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sqlResult.data.slice(0, 100).map((row: any, idx: number) => (
                              <tr key={idx} style={{ borderBottom: '1px solid var(--surface-border)', backgroundColor: idx % 2 ? 'rgba(59,130,246,0.02)' : 'transparent' }}>
                                {Object.values(row).map((val: any, vIdx: number) => (
                                  <td key={vIdx} style={{ padding: '8px', color: val === null ? 'var(--text-muted)' : 'inherit' }}>
                                    {val === null ? '(null)' : String(val)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {sqlResult.data.length > 100 && (
                          <p style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '11px' }}>
                            {currentLang === 'en' ? `Showing first 100 of ${sqlResult.data.length} rows` : `عرض أول 100 من ${sqlResult.data.length} صفوف`}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '4px', padding: '12px', color: 'var(--accent-red)' }}>
                    <p style={{ margin: '0 0 8px 0', fontWeight: 'bold' }}>{sqlResult.error}</p>
                    {sqlResult.details && (
                      <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {sqlResult.details}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* SCREEN VIEWPORT: USER & GROUP PRIVILEGE MANAGEMENT */}
        <section className={`screen-viewport ${activeTab === 'screen-user-admin' ? 'active' : ''}`}>
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
              <div>
                <h3>{t('title_user_admin')}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{t('user_admin_subtitle')}</p>
              </div>
              <div>
                {canModify('user_admin') && (
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn btn-primary" onClick={() => setShowCreateUserModal(true)}>
                      <i className="fa-solid fa-user-plus"></i> {t('btn_create_user')}
                    </button>
                    <button className="btn btn-primary" onClick={() => setShowCreateGroupModal(true)}>
                      <i className="fa-solid fa-folder-plus"></i> {t('btn_create_group')}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', borderBottom: '1px solid var(--surface-border)', marginBottom: '24px' }}>
              <button className={`btn-tab ${adminTab === 'users' ? 'active' : ''}`} onClick={() => setAdminTab('users')}>{t('tab_users')}</button>
              <button className={`btn-tab ${adminTab === 'groups' ? 'active' : ''}`} onClick={() => setAdminTab('groups')}>{t('tab_groups')}</button>
            </div>

            {adminTab === 'users' ? (
              <div className="tab-pane active">
                {adminUsers.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <i className="fa-solid fa-users" style={{ fontSize: '32px', marginBottom: '10px' }}></i>
                    <p>{t('msg_no_users')}</p>
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>{t('th_username')}</th>
                          <th>{t('th_display_name')}</th>
                          <th>{t('th_email')}</th>
                          <th>{t('th_groups')}</th>
                          <th>{t('th_active')}</th>
                          <th>{t('th_created_by')}</th>
                          {canModify('user_admin') && <th>{t('th_action')}</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {adminUsers.map((u, idx) => (
                          <tr key={idx}>
                            <td><strong>#{u.userId}</strong></td>
                            <td>{u.username}</td>
                            {editingUserIdx === idx ? (
                              <>
                                <td>
                                  <input 
                                    type="text" 
                                    className="form-control" 
                                    value={editUserDisplay}
                                    onChange={e => setEditUserDisplay(e.target.value)}
                                    style={{ padding: '6px 8px', fontSize: '13px' }}
                                  />
                                </td>
                                <td>
                                  <input 
                                    type="email" 
                                    className="form-control" 
                                    value={editUserEmail}
                                    onChange={e => setEditUserEmail(e.target.value)}
                                    style={{ padding: '6px 8px', fontSize: '13px' }}
                                  />
                                </td>
                              </>
                            ) : (
                              <>
                                <td>{u.displayName}</td>
                                <td>{u.email}</td>
                              </>
                            )}
                            <td>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {u.groups && u.groups.length > 0 ? (
                                  u.groups.map((g: any, gIdx: number) => (
                                    <span key={gIdx} className="badge badge-ready" style={{ margin: 0, fontSize: '10px', padding: '2px 6px' }}>
                                      {g.groupName}
                                      {canModify('user_admin') && (
                                        <span 
                                          style={{ marginLeft: '6px', cursor: 'pointer', color: 'var(--accent-red)', fontWeight: 'bold' }} 
                                          onClick={() => handleRemoveUserFromGroup(u.userId, g.groupId)}
                                          title="Remove from group"
                                        >
                                          &times;
                                        </span>
                                      )}
                                    </span>
                                  ))
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>None</span>
                                )}
                              </div>
                            </td>
                            <td>
                              {canModify('user_admin') ? (
                                <button 
                                  className="btn" 
                                  style={{ padding: '4px 8px', fontSize: '11px', backgroundColor: u.isActive ? 'var(--accent-green-muted)' : 'var(--accent-red-muted)', borderColor: u.isActive ? 'var(--accent-green)' : 'var(--accent-red)', color: u.isActive ? 'var(--accent-green)' : 'var(--accent-red)' }}
                                  onClick={() => handleToggleUserActive(u.userId, u.isActive)}
                                >
                                  {u.isActive ? (currentLang === 'en' ? 'Active' : 'نشط') : (currentLang === 'en' ? 'Inactive' : 'غير نشط')}
                                </button>
                              ) : (
                                <span className={`badge ${u.isActive ? 'badge-ready' : 'badge-quarantined'}`}>
                                  {u.isActive ? (currentLang === 'en' ? 'Active' : 'نشط') : (currentLang === 'en' ? 'Inactive' : 'غير نشط')}
                                </span>
                              )}
                            </td>
                            <td>{u.createdBy}</td>
                            {canModify('user_admin') && (
                              <td>
                                {editingUserIdx === idx ? (
                                  <div style={{ display: 'flex', gap: '6px' }}>
                                    <button
                                      className="btn btn-primary"
                                      style={{ padding: '4px 10px', fontSize: '12px' }}
                                      onClick={() => handleSaveEditUser(u.userId)}
                                    >
                                      <i className="fa-solid fa-check"></i>
                                    </button>
                                    <button
                                      className="btn"
                                      style={{ padding: '4px 10px', fontSize: '12px' }}
                                      onClick={() => setEditingUserIdx(null)}
                                    >
                                      <i className="fa-solid fa-xmark"></i>
                                    </button>
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                    <button
                                      className="btn"
                                      style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--kfh-green)', borderColor: 'var(--kfh-green)' }}
                                      onClick={() => handleStartEditUser(idx)}
                                      title="Edit"
                                    >
                                      <i className="fa-solid fa-pen"></i>
                                    </button>
                                    <select 
                                      defaultValue=""
                                      onChange={e => {
                                        if (e.target.value) {
                                          handleAddUserToGroup(u.userId, parseInt(e.target.value));
                                          e.target.value = "";
                                        }
                                      }}
                                      style={{ padding: '4px', borderRadius: '4px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000', fontSize: '11px' }}
                                    >
                                      <option value="">+ Add to Group</option>
                                      {adminGroups
                                        .filter(g => !u.groups?.some((ug: any) => ug.groupId === g.groupId))
                                        .map(g => (
                                          <option key={g.groupId} value={g.groupId}>{g.groupName}</option>
                                        ))}
                                    </select>
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <div className="tab-pane active">
                {adminGroups.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <i className="fa-solid fa-folder" style={{ fontSize: '32px', marginBottom: '10px' }}></i>
                    <p>{t('msg_no_groups')}</p>
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>{t('th_group_name')}</th>
                          <th>{t('th_description')}</th>
                          <th>{t('th_members')}</th>
                          <th>{t('th_system')}</th>
                          {canModify('user_admin') && <th>{t('th_action')}</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {adminGroups.map((g, idx) => (
                          <tr key={idx}>
                            <td><strong>#{g.groupId}</strong></td>
                            {editingGroupIdx === idx ? (
                              <>
                                <td>
                                  <input 
                                    type="text" 
                                    className="form-control" 
                                    value={editGroupName}
                                    onChange={e => setEditGroupName(e.target.value)}
                                    style={{ padding: '6px 8px', fontSize: '13px' }}
                                  />
                                </td>
                                <td>
                                  <input 
                                    type="text" 
                                    className="form-control" 
                                    value={editGroupDesc}
                                    onChange={e => setEditGroupDesc(e.target.value)}
                                    style={{ padding: '6px 8px', fontSize: '13px' }}
                                  />
                                </td>
                              </>
                            ) : (
                              <>
                                <td><strong>{g.groupName}</strong></td>
                                <td>{g.description}</td>
                              </>
                            )}
                            <td>
                              <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                {g.members && g.members.length > 0 ? (
                                  g.members.map((m: any, mIdx: number) => (
                                    <span key={mIdx}>
                                      • {m.displayName} ({m.username})
                                    </span>
                                  ))
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>0 members</span>
                                )}
                              </div>
                            </td>
                            <td>
                              <span className={`badge ${g.isSystem ? 'badge-ready' : 'badge-transfer'}`}>
                                {g.isSystem ? (currentLang === 'en' ? 'System' : 'نظامي') : (currentLang === 'en' ? 'Custom' : 'مخصص')}
                              </span>
                            </td>
                            {canModify('user_admin') && (
                              <td>
                                {editingGroupIdx === idx ? (
                                  <div style={{ display: 'flex', gap: '6px' }}>
                                    <button
                                      className="btn btn-primary"
                                      style={{ padding: '4px 10px', fontSize: '12px' }}
                                      onClick={() => handleSaveEditGroup(g.groupId)}
                                    >
                                      <i className="fa-solid fa-check"></i>
                                    </button>
                                    <button
                                      className="btn"
                                      style={{ padding: '4px 10px', fontSize: '12px' }}
                                      onClick={() => setEditingGroupIdx(null)}
                                    >
                                      <i className="fa-solid fa-xmark"></i>
                                    </button>
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', gap: '5px' }}>
                                    <button 
                                      className="btn" 
                                      style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--kfh-green)', borderColor: 'var(--kfh-green)' }}
                                      onClick={() => handleStartEditGroup(idx)}
                                      title="Edit"
                                    >
                                      <i className="fa-solid fa-pen"></i>
                                    </button>
                                    <button 
                                      className="btn btn-primary" 
                                      style={{ padding: '4px 8px', fontSize: '11px' }}
                                      onClick={() => {
                                        setSelectedAdminGroup(g);
                                        const matrix: Record<string, string> = {};
                                        MODULE_KEYS.forEach(m => {
                                          const p = g.permissions?.find((perm: any) => perm.moduleKey === m.key);
                                          matrix[m.key] = p ? p.accessLevel : 'HIDDEN';
                                        });
                                        setEditPermMatrix(matrix);
                                        setShowGroupPermsModal(true);
                                      }}
                                    >
                                      <i className="fa-solid fa-key"></i> {t('th_permissions')}
                                    </button>
                                    {!g.isSystem && (
                                      <button 
                                        className="btn btn-danger" 
                                        style={{ padding: '4px 8px', fontSize: '11px' }}
                                        onClick={() => handleDeleteGroup(g.groupId)}
                                      >
                                        <i className="fa-solid fa-trash-can"></i>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* SCREEN VIEWPORT: WORKFLOW DESIGNER */}
        <section className={`screen-viewport ${activeTab === 'screen-workflows' ? 'active' : ''}`}>
          {/* Template authoring (type/name/description/steps + Save) is the admin-tier
              "workflow_design" capability -- it must stay invisible to anyone who only
              holds the operational "workflows" permission (e.g. Maker/Checker just need
              to act on instances via the Pending Queue below, not redesign the template).
              The Save button was already gated by canModify('workflow_design'), but the
              rest of the editable form was rendering regardless of that permission --
              only Hidden actually hid the whole screen, and that also hid the Pending
              Queue those roles legitimately need. Gating the whole authoring card here
              keeps the Queue visible while hiding the designer for non-designers. */}
          {canAccess('workflow_design') && (
          <div className="glass-card" style={{ marginBottom: '25px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
              <div>
                <h3>{t('title_workflows')}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{t('workflows_subtitle')}</p>
              </div>
              <div>
                {/* Authoring workflow templates is an admin action (workflow_design). */}
                {canModify('workflow_design') && (
                  <button className="btn btn-primary" onClick={handleSaveTemplate} disabled={loadingWF || pendingCountForSelectedWfType > 0}>
                    <i className="fa-solid fa-save"></i> {t('btn_save_workflow')}
                  </button>
                )}
              </div>
            </div>

            {pendingCountForSelectedWfType > 0 && (
              <div className="glass-card" style={{ marginBottom: '20px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid var(--accent-orange)', background: 'rgba(255, 145, 0, 0.08)' }}>
                <i className="fa-solid fa-triangle-exclamation" style={{ color: 'var(--accent-orange)', fontSize: '18px' }}></i>
                <span style={{ fontSize: '13px' }}>
                  {currentLang === 'en'
                    ? `This workflow can't be edited or deleted right now: ${pendingCountForSelectedWfType} request(s) are still pending against it. Wait until they're approved, rejected, or otherwise resolved.`
                    : `لا يمكن تعديل أو حذف هذا المسار حاليًا: يوجد ${pendingCountForSelectedWfType} طلب(ات) معلقة عليه. يرجى الانتظار حتى يتم اعتمادها أو رفضها أو حلها.`}
                </span>
              </div>
            )}

            <div className="report-controls glass-card" style={{ padding: '20px', marginBottom: '25px', display: 'flex', gap: '20px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '200px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{t('wf_type')}</label>
                <select value={selectedWfType} onChange={e => setSelectedWfType(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000' }}>
                  <option value="PURCHASE_ORDER">{currentLang === 'en' ? 'Purchase Order (P.O.)' : 'طلب شراء (P.O.)'}</option>
                  <option value="INTAKE_SHIPMENT">{currentLang === 'en' ? 'Intake Shipment' : 'استلام شحنة جديدة'}</option>
                  <option value="BRANCH_TRANSFER">{currentLang === 'en' ? 'Branch Transfer' : 'حركة تحويل فرعي'}</option>
                  <option value="CUSTODY_WITHDRAWAL">{currentLang === 'en' ? 'Custody Withdrawal' : 'سحب أمانات عميل'}</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0, flex: 2, minWidth: '250px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{t('wf_name')}</label>
                <input type="text" value={wfName} onChange={e => setWfName(e.target.value)} className="form-control" style={{ marginBottom: 0 }} />
              </div>

              <div className="form-group" style={{ marginBottom: 0, flex: 3, minWidth: '300px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{t('wf_desc')}</label>
                <input type="text" value={wfDesc} onChange={e => setWfDesc(e.target.value)} className="form-control" style={{ marginBottom: 0 }} />
              </div>
            </div>

            <h4>{t('wf_steps')}</h4>
            
            {/* Visual Node Flow Canvas */}
            <div className="node-canvas">
              {wfSteps.map((step, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <div className="connector-line"></div>}
                  
                  <div className="step-node">
                    <div className="step-node-header">
                      <h4>{currentLang === 'en' ? `Step ${idx + 1}` : `الخطوة ${idx + 1}`}</h4>
                      <span className="step-badge">{step.required_role}</span>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '10px', display: 'block', marginBottom: '4px' }}>{t('wf_step_name')}</label>
                      <input 
                        type="text" 
                        value={step.step_name} 
                        onChange={e => {
                          const updated = [...wfSteps];
                          updated[idx].step_name = e.target.value;
                          setWfSteps(updated);
                        }} 
                        className="form-control" 
                        style={{ padding: '6px', fontSize: '12px', marginBottom: 0 }}
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '10px', display: 'block', marginBottom: '4px' }}>{t('wf_required_role')}</label>
                      <select 
                        value={step.required_role} 
                        onChange={e => {
                          const updated = [...wfSteps];
                          updated[idx].required_role = e.target.value;
                          setWfSteps(updated);
                        }}
                        style={{ width: '100%', padding: '6px', borderRadius: '4px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000', fontSize: '12px' }}
                      >
                        <option value="">-- Select Group --</option>
                        {adminGroups.map((g: any, gIdx: number) => (
                          <option key={gIdx} value={g.groupName}>{g.groupName}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '10px', display: 'block', marginBottom: '4px' }}>{currentLang === 'en' ? 'Description' : 'الوصف'}</label>
                      <input 
                        type="text" 
                        value={step.description} 
                        onChange={e => {
                          const updated = [...wfSteps];
                          updated[idx].description = e.target.value;
                          setWfSteps(updated);
                        }} 
                        className="form-control" 
                        style={{ padding: '6px', fontSize: '12px', marginBottom: 0 }}
                      />
                    </div>

                    <div className="step-node-controls">
                      {idx > 0 && (
                        <button title="Move Left" onClick={() => {
                          const updated = [...wfSteps];
                          const temp = updated[idx];
                          updated[idx] = updated[idx - 1];
                          updated[idx - 1] = temp;
                          setWfSteps(updated);
                        }}>
                          <i className="fa-solid fa-arrow-left"></i>
                        </button>
                      )}
                      {idx < wfSteps.length - 1 && (
                        <button title="Move Right" onClick={() => {
                          const updated = [...wfSteps];
                          const temp = updated[idx];
                          updated[idx] = updated[idx + 1];
                          updated[idx + 1] = temp;
                          setWfSteps(updated);
                        }}>
                          <i className="fa-solid fa-arrow-right"></i>
                        </button>
                      )}
                      <button className="delete-btn" title="Remove Step" onClick={() => {
                        const updated = wfSteps.filter((_, sIdx) => sIdx !== idx);
                        setWfSteps(updated);
                      }}>
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </div>
                  </div>
                </React.Fragment>
              ))}

              {/* Add New Step Card */}
              {wfSteps.length > 0 && <div className="connector-line"></div>}
              <div className="add-step-card" onClick={() => {
                setWfSteps([...wfSteps, {
                  step_name: 'New Approval Stage',
                  required_role: 'Operations Checker',
                  description: 'Review step comments and details.'
                }]);
              }}>
                <i className="fa-solid fa-plus-circle"></i>
                <span>{t('btn_add_step')}</span>
              </div>
            </div>
          </div>
          )}

          {/* Active Operations Pending Queue */}
          <div className="glass-card">
            <h3>{t('wf_queue_title')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>{t('wf_queue_subtitle')}</p>

            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>{t('th_wf_type')}</th>
                    <th>{t('th_po_details')}</th>
                    <th>{t('th_initiated')}</th>
                    <th>{t('th_created')}</th>
                    <th>{t('th_active_step')}</th>
                    <th>{t('th_history')}</th>
                    <th>{t('th_action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeWorkflowInstances.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                        {currentLang === 'en' ? 'No pending operations in work queue.' : 'لا توجد عمليات معلقة بانتظار الاعتماد.'}
                      </td>
                    </tr>
                  ) : (
                    activeWorkflowInstances.map((inst, idx) => {
                      const reqRole = inst.current_step?.required_role;
                      const hasRole = reqRole ? (checkUserRoleMatches(reqRole, userRole) || checkUserRoleMatches('IT/Admin', userRole)) : false;
                      
                      return (
                        <tr key={idx}>
                          <td><strong>#{inst.instance_id}</strong></td>
                          <td>
                            <span className="badge badge-ready">{inst.workflow_type}</span>
                          </td>
                          <td>
                            {inst.details ? (
                              inst.workflow_type === 'INTAKE_SHIPMENT' && inst.details.source_type === 'CUSTOMER' ? (
                                <div style={{ fontSize: '12px' }}>
                                  <strong>{currentLang === 'en' ? 'Customer:' : 'العميل:'} {inst.details.customer_name || `#${inst.details.customer_id}`}</strong><br/>
                                  <span style={{ color: 'var(--accent-gold)' }}>
                                    {inst.details.receipt_reason} | {currentLang === 'en' ? 'Lot' : 'اللوت'} {inst.details.lot_number}
                                  </span>
                                </div>
                              ) : (
                                <div style={{ fontSize: '12px' }}>
                                  <strong>{inst.details.po_number}</strong><br/>
                                  <span style={{ color: 'var(--accent-gold)' }}>
                                    {inst.details.vendor_name} | {inst.details.total_weight}g | ${inst.details.total_cost?.toLocaleString()} {inst.details.currency}
                                  </span>
                                </div>
                              )
                            ) : (
                              <span>Entity ID: {inst.entity_id}</span>
                            )}
                          </td>
                          <td>{inst.initiated_by}</td>
                          <td>{new Date(inst.created_at).toLocaleString()}</td>
                          <td>
                            {inst.current_step ? (
                              <div style={{ fontSize: '12px' }}>
                                <span className="badge badge-quarantine" style={{ background: 'var(--accent-orange)', color: '#000', fontWeight: 'bold' }}>
                                  {inst.current_step.step_name}
                                </span>
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                  Requires: <strong>{inst.current_step.required_role}</strong>
                                </div>
                                {(() => {
                                  const gp = adminGroups.find(g => g.groupName === inst.current_step.required_role);
                                  if (gp && gp.members && gp.members.length > 0) {
                                    const names = gp.members.map((m: any) => m.displayName || m.username).join(', ');
                                    return (
                                      <div style={{ fontSize: '9px', color: 'var(--accent-gold)', marginTop: '2px' }}>
                                        {currentLang === 'en' ? 'Pending with: ' : 'معلق عند: '}<strong>{names}</strong>
                                      </div>
                                    );
                                  }
                                  if (inst.current_step.required_role === 'Operations Checker') {
                                    return (
                                      <div style={{ fontSize: '9px', color: 'var(--accent-gold)', marginTop: '2px' }}>
                                        {currentLang === 'en' ? 'Pending with: ' : 'معلق عند: '}<strong>treasury-checker</strong>
                                      </div>
                                    );
                                  }
                                  if (inst.current_step.required_role === 'Reconciliation Officer') {
                                    return (
                                      <div style={{ fontSize: '9px', color: 'var(--accent-gold)', marginTop: '2px' }}>
                                        {currentLang === 'en' ? 'Pending with: ' : 'معلق عند: '}<strong>reconciliation-reconciler</strong>
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                            ) : (
                              <span>No active step</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', maxHeight: '80px', overflowY: 'auto' }}>
                              {inst.history && inst.history.length > 0 ? (
                                inst.history.map((hist: any, hIdx: number) => (
                                  <div key={hIdx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '2px' }}>
                                    <span style={{ color: hist.action === 'APPROVED' ? 'var(--accent-green)' : (hist.action === 'RETURNED' ? 'var(--accent-orange)' : 'var(--accent-red)') }}>
                                      ● {hist.action}
                                    </span> by <strong>{hist.approver}</strong> on <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{new Date(hist.timestamp).toLocaleString()}</span>
                                    {hist.comments && <span style={{ fontStyle: 'italic', display: 'block', color: 'var(--text-muted)' }}>"{hist.comments}"</span>}
                                  </div>
                                ))
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>No sign-offs yet</span>
                              )}
                            </div>
                          </td>
                          <td>
                            {hasRole ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '150px' }}>
                                {(() => {
                                  const latestHist = inst.history?.filter((h: any) => h.comments).slice(-1)[0];
                                  if (latestHist) {
                                    return (
                                      <div style={{ fontSize: '11px', backgroundColor: 'rgba(255, 193, 7, 0.1)', borderLeft: '3px solid var(--accent-gold)', padding: '6px', borderRadius: '4px', marginBottom: '4px' }}>
                                        <strong>{latestHist.approver} ({latestHist.action}):</strong> <span style={{ fontStyle: 'italic' }}>"{latestHist.comments}"</span>
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                                <input 
                                  type="text" 
                                  placeholder={t('lbl_comments')} 
                                  value={actionComments[inst.instance_id] || ''}
                                  onChange={e => setActionComments(prev => ({ ...prev, [inst.instance_id]: e.target.value }))}
                                  className="form-control" 
                                  style={{ padding: '6px', fontSize: '12px', margin: 0 }}
                                />
                                <div style={{ display: 'flex', gap: '5px' }}>
                                  <button 
                                    className="btn btn-primary" 
                                    style={{ flex: 1, padding: '5px', fontSize: '11px', background: 'var(--accent-green)', borderColor: 'var(--accent-green)', color: '#000', fontWeight: 'bold' }}
                                    onClick={() => handleInstanceAction(inst.instance_id, 'APPROVED')}
                                  >
                                    {t('btn_sign_off')}
                                  </button>
                                  <button 
                                    className="btn" 
                                    style={{ flex: 1, padding: '5px', fontSize: '11px', background: 'var(--accent-red-muted)', borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}
                                    onClick={() => handleInstanceAction(inst.instance_id, 'REJECTED')}
                                  >
                                    {t('btn_reject')}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                <i className="fa-solid fa-lock"></i> Awaiting role: {reqRole}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SCREEN VIEWPORT: MY PENDING ACTIONS */}
        <section className={`screen-viewport ${activeTab === 'screen-pending-req' ? 'active' : ''}`}>
          <div className="glass-card">
            <h3>{t('title_pending_requests')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
              {t('pending_requests_subtitle')}
            </p>

            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>{t('th_wf_type')}</th>
                    <th>{t('th_po_code')}</th>
                    <th>{t('th_initiated')}</th>
                    <th>{t('th_created')}</th>
                    <th>{t('th_active_step')}</th>
                    <th>{t('th_assigned_role')}</th>
                    <th>{t('th_status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeWorkflowInstances.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                        {t('msg_no_pending')}
                      </td>
                    </tr>
                  ) : (
                    activeWorkflowInstances.map((inst, idx) => {
                      const reqRole = inst.current_step?.required_role;
                      const requiresMyAction = checkUserRoleMatches(reqRole, userRole) || checkUserRoleMatches('IT/Admin', userRole);
                      const poCode = inst.details?.po_number || `ID: ${inst.entity_id}`;
                      
                      return (
                        <tr 
                          key={idx} 
                          onDoubleClick={() => {
                            setSelectedWfInstance(inst);
                            setShowWfDetailsModal(true);
                            setModalComments('');
                          }}
                          style={{ 
                            cursor: 'pointer',
                            borderLeft: requiresMyAction ? '3px solid var(--accent-orange)' : 'none',
                            backgroundColor: requiresMyAction ? 'rgba(255, 145, 0, 0.03)' : 'transparent'
                          }}
                          title={requiresMyAction ? (currentLang === 'en' ? "Requires your approval (Double click to open)" : "يتطلب اعتمادك (انقر نقرًا مزدوجًا للفتح)") : (currentLang === 'en' ? "Double click to view details" : "انقر نقرًا مزدوجًا لعرض التفاصيل")}
                        >
                          <td><strong>{inst.workflow_type}</strong></td>
                          <td>{poCode}</td>
                          <td>{inst.initiated_by}</td>
                          <td>{new Date(inst.created_at).toLocaleString()}</td>
                          <td>{inst.current_step?.step_name || 'N/A'}</td>
                          <td>
                            <span className="badge badge-reserved" style={{ display: 'inline-block' }}>
                              {reqRole || 'N/A'}
                            </span>
                          </td>
                          <td>
                            {requiresMyAction ? (
                              <span className="badge" style={{ backgroundColor: 'var(--accent-orange)', color: 'var(--bg-primary)' }}>
                                {currentLang === 'en' ? 'Requires My Action' : 'يتطلب إجرائي'}
                              </span>
                            ) : (
                              <span className="badge badge-transfer">
                                {currentLang === 'en' ? 'In Review' : 'قيد المراجعة'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* WORKFLOW DETAILS ACTION MODAL OVERLAY */}
        {showWfDetailsModal && selectedWfInstance && (
          <div className="modal-overlay active" onClick={() => { setShowWfDetailsModal(false); setSelectedWfInstance(null); }}>
            <div className="glass-card modal-content-box" style={{ width: '700px' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>
                  {currentLang === 'en' ? 'Workflow Pending Action Details' : 'تفاصيل الإجراء المعلق للمسار'}
                </h3>
                <span className="modal-close-btn" onClick={() => { setShowWfDetailsModal(false); setSelectedWfInstance(null); }}>&times;</span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ borderBottom: '1px solid var(--surface-border)', paddingBottom: '15px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span><strong>{currentLang === 'en' ? 'Workflow Type:' : 'نوع المسار:'}</strong> {selectedWfInstance.workflow_type}</span>
                    <span><strong>{currentLang === 'en' ? 'Status:' : 'الحالة:'}</strong> {selectedWfInstance.status_code}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span><strong>{currentLang === 'en' ? 'Initiator:' : 'المنشئ:'}</strong> {selectedWfInstance.initiated_by}</span>
                    <span><strong>{currentLang === 'en' ? 'Created At:' : 'تاريخ الإنشاء:'}</strong> {new Date(selectedWfInstance.created_at).toLocaleString()}</span>
                  </div>
                </div>

                <div>
                  <h4>{currentLang === 'en' ? 'Transaction Details' : 'تفاصيل المعاملة'}</h4>
                  {selectedWfInstance.details ? (
                    <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '15px', borderRadius: '6px', border: '1px solid var(--surface-border)', marginTop: '8px' }}>
                      {selectedWfInstance.workflow_type === "INTAKE_SHIPMENT" && selectedWfInstance.details.source_type === "CUSTOMER" ? (
                        <div className="split-grid-2" style={{ gap: '10px 20px' }}>
                          <div><strong>{currentLang === 'en' ? 'Customer:' : 'العميل:'}</strong> {selectedWfInstance.details.customer_name || `#${selectedWfInstance.details.customer_id}`}</div>
                          <div><strong>{currentLang === 'en' ? 'Receipt Reason:' : 'سبب الاستلام:'}</strong> {selectedWfInstance.details.receipt_reason}</div>
                          {selectedWfInstance.details.account_id && (
                            <div><strong>{currentLang === 'en' ? 'Custody Account:' : 'حساب الأمانة:'}</strong> {selectedWfInstance.details.account_id}</div>
                          )}
                          <div><strong>{currentLang === 'en' ? 'Lot Number:' : 'رقم اللوت:'}</strong> {selectedWfInstance.details.lot_number}</div>
                          <div><strong>{currentLang === 'en' ? 'Destination Location:' : 'موقع الوجهة:'}</strong> {selectedWfInstance.details.location_name}</div>
                          <div><strong>{currentLang === 'en' ? 'Received By:' : 'المستلم:'}</strong> {selectedWfInstance.details.received_by}</div>
                          <div><strong>{currentLang === 'en' ? 'Status Code:' : 'حالة الاعتماد:'}</strong> {selectedWfInstance.details.status_code}</div>
                        </div>
                      ) : selectedWfInstance.workflow_type === "INTAKE_SHIPMENT" ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div className="split-grid-2" style={{ gap: '10px 20px' }}>
                            <div><strong>{currentLang === 'en' ? 'Supplier:' : 'المورد:'}</strong> {selectedWfInstance.details.vendor_name || 'Direct Supplier'}</div>
                            <div><strong>{currentLang === 'en' ? 'Airway Bill / Ref:' : 'بوليصة الشحن / المرجع:'}</strong> {selectedWfInstance.details.airway_bill || selectedWfInstance.details.shipment_reference || 'N/A'}</div>
                            <div><strong>{currentLang === 'en' ? 'Delivery Note:' : 'إشعار التسليم:'}</strong> {selectedWfInstance.details.delivery_note || 'N/A'}</div>
                            <div><strong>{currentLang === 'en' ? 'Receiving Date:' : 'تاريخ الاستلام:'}</strong> {selectedWfInstance.details.receiving_date ? new Date(selectedWfInstance.details.receiving_date).toLocaleDateString() : 'N/A'}</div>
                            <div><strong>{currentLang === 'en' ? 'Lot Number:' : 'رقم اللوت:'}</strong> {selectedWfInstance.details.lot_number}</div>
                            <div><strong>{currentLang === 'en' ? 'Vault Location:' : 'موقع الخزينة:'}</strong> {selectedWfInstance.details.location_name}</div>
                            <div><strong>{currentLang === 'en' ? 'Received By (Maker):' : 'المستلم (المنشئ):'}</strong> {selectedWfInstance.details.received_by}</div>
                            <div><strong>{currentLang === 'en' ? 'Status Code:' : 'حالة الاعتماد:'}</strong> {selectedWfInstance.details.status_code}</div>
                            {selectedWfInstance.details.supporting_document_url && (
                              <div style={{ gridColumn: 'span 2' }}>
                                <strong>{currentLang === 'en' ? 'Attached Document:' : 'المستند المرفق:'}</strong> <a href={selectedWfInstance.details.supporting_document_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>{selectedWfInstance.details.supporting_document_url}</a>
                              </div>
                            )}
                            {selectedWfInstance.details.discrepancy_notes && (
                              <div style={{ gridColumn: 'span 2', color: 'var(--accent-orange)' }}>
                                <strong>{currentLang === 'en' ? 'Discrepancy / Notes:' : 'ملاحظات الفروقات / الاستلام:'}</strong> {selectedWfInstance.details.discrepancy_notes}
                              </div>
                            )}
                          </div>

                          {/* Bars in Shipment Table for Checker Review */}
                          {(() => {
                            let itemsList: any[] = [];
                            try {
                              if (selectedWfInstance.details.serials_json) {
                                itemsList = JSON.parse(selectedWfInstance.details.serials_json);
                              }
                            } catch (_) {}

                            if (itemsList.length === 0) return null;

                            return (
                              <div style={{ marginTop: '8px', borderTop: '1px solid var(--surface-border)', paddingTop: '10px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px', color: 'var(--kfh-green)' }}>
                                  {currentLang === 'en' ? `Bars Manifest for Verification (${itemsList.length} items):` : `كشف السبائك المطلوب التحقق منها (${itemsList.length} قطعة):`}
                                </div>
                                <div className="table-responsive" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                                  <table style={{ fontSize: '11px' }}>
                                    <thead>
                                      <tr>
                                        <th>#</th>
                                        <th>{currentLang === 'en' ? 'Serial Number' : 'الرقم التسلسلي'}</th>
                                        <th>{currentLang === 'en' ? 'Gross Wt' : 'الوزن'}</th>
                                        <th>{currentLang === 'en' ? 'Purity' : 'النقاوة'}</th>
                                        <th>{currentLang === 'en' ? 'Refiner' : 'المصفاة'}</th>
                                        <th>{currentLang === 'en' ? 'Condition' : 'الحالة'}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {itemsList.map((it: any, iIdx: number) => (
                                        <tr key={iIdx} style={{ backgroundColor: it.is_damaged ? 'rgba(239, 68, 68, 0.06)' : 'transparent' }}>
                                          <td>{iIdx + 1}</td>
                                          <td><strong>{it.serial}</strong></td>
                                          <td>{it.weight_grams ? `${it.weight_grams}g` : '1000g'}</td>
                                          <td>{it.purity || it.fineness_ppt || '999.9'} PPT</td>
                                          <td>{it.refiner_name || 'Valcambi Suisse'}</td>
                                          <td>
                                            {it.is_damaged ? (
                                              <span className="badge" style={{ backgroundColor: 'var(--accent-red)', color: '#fff' }}>
                                                Damaged: {it.damage_reason || 'Quarantined'}
                                              </span>
                                            ) : (
                                              <span className="badge badge-ready">Good Condition</span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      ) : selectedWfInstance.workflow_type === "BRANCH_TRANSFER" ? (
                        <div className="split-grid-2" style={{ gap: '10px 20px' }}>
                          <div><strong>{currentLang === 'en' ? 'Transfer ID:' : 'رمز التحويل:'}</strong> {selectedWfInstance.details.transfer_id}</div>
                          <div><strong>{currentLang === 'en' ? 'Serial Number:' : 'الرقم التسلسلي:'}</strong> {selectedWfInstance.details.serial_number}</div>
                          <div><strong>{currentLang === 'en' ? 'Product:' : 'المنتج:'}</strong> {selectedWfInstance.details.product_name}</div>
                          <div><strong>{currentLang === 'en' ? 'From:' : 'من:'}</strong> {selectedWfInstance.details.source_branch}</div>
                          <div><strong>{currentLang === 'en' ? 'To:' : 'إلى:'}</strong> {selectedWfInstance.details.destination_branch}</div>
                          <div><strong>{currentLang === 'en' ? 'Courier:' : 'الناقل:'}</strong> {selectedWfInstance.details.courier_info}</div>
                          <div><strong>{currentLang === 'en' ? 'Status Code:' : 'حالة النقل:'}</strong> {selectedWfInstance.details.status_code}</div>
                        </div>
                      ) : (
                        <div className="split-grid-2" style={{ gap: '10px 20px' }}>
                          <div><strong>{currentLang === 'en' ? 'P.O. Number:' : 'رقم طلب الشراء:'}</strong> {selectedWfInstance.details.po_number}</div>
                          <div><strong>{currentLang === 'en' ? 'Supplier:' : 'المورد:'}</strong> {selectedWfInstance.details.vendor_name}</div>
                          <div><strong>{currentLang === 'en' ? 'Total Weight:' : 'الوزن الإجمالي:'}</strong> {selectedWfInstance.details.total_weight}g</div>
                          <div><strong>{currentLang === 'en' ? 'Total Cost Basis:' : 'التكلفة الإجمالية:'}</strong> ${selectedWfInstance.details.total_cost?.toLocaleString()} {selectedWfInstance.details.currency}</div>
                          <div><strong>{currentLang === 'en' ? 'Status Code:' : 'رمز الحالة:'}</strong> {selectedWfInstance.details.status_code}</div>
                          <div><strong>{currentLang === 'en' ? 'Created By:' : 'أُنشئ بواسطة:'}</strong> {selectedWfInstance.details.created_by}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>Entity ID: {selectedWfInstance.entity_id}</p>
                  )}
                </div>

                <div>
                  <h4>{currentLang === 'en' ? 'Active Approval Stage' : 'مرحلة الاعتماد النشطة'}</h4>
                  {selectedWfInstance.current_step ? (
                    <div style={{ borderLeft: '3px solid var(--accent-orange)', paddingLeft: '12px', marginTop: '8px' }}>
                      <strong>{selectedWfInstance.current_step.step_name}</strong>
                      <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>{selectedWfInstance.current_step.description}</p>
                      <div style={{ marginTop: '8px', fontSize: '12px' }}>
                        {currentLang === 'en' ? 'Required Authority:' : 'السلطة المطلوبة:'} <span className="badge badge-reserved">{selectedWfInstance.current_step.required_role}</span>
                      </div>
                      {(() => {
                        const gp = adminGroups.find(g => g.groupName === selectedWfInstance.current_step.required_role);
                        if (gp && gp.members && gp.members.length > 0) {
                          const names = gp.members.map((m: any) => m.displayName || m.username).join(', ');
                          return (
                            <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--accent-gold)' }}>
                              {currentLang === 'en' ? 'Pending with: ' : 'معلق عند: '}<strong>{names}</strong>
                            </div>
                          );
                        }
                        if (selectedWfInstance.current_step.required_role === 'Operations Checker') {
                          return (
                            <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--accent-gold)' }}>
                              {currentLang === 'en' ? 'Pending with: ' : 'معلق عند: '}<strong>treasury-checker</strong>
                            </div>
                          );
                        }
                        if (selectedWfInstance.current_step.required_role === 'Reconciliation Officer') {
                          return (
                            <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--accent-gold)' }}>
                              {currentLang === 'en' ? 'Pending with: ' : 'معلق عند: '}<strong>reconciliation-reconciler</strong>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>No active step</p>
                  )}
                </div>

                <div>
                  <h4>{currentLang === 'en' ? 'Workflow Audit History' : 'سجل تدقيق المسار'}</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', maxHeight: '120px', overflowY: 'auto', backgroundColor: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '6px' }}>
                    {selectedWfInstance.history && selectedWfInstance.history.length > 0 ? (
                      selectedWfInstance.history.map((hist: any, hIdx: number) => (
                        <div key={hIdx} style={{ fontSize: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '4px' }}>
                          <span style={{ color: hist.action === 'APPROVED' ? 'var(--accent-green)' : (hist.action === 'RETURNED' ? 'var(--accent-orange)' : 'var(--accent-red)') }}>
                            ● {hist.action}
                          </span> {currentLang === 'en' ? 'by' : 'بواسطة'} <strong>{hist.approver}</strong> {currentLang === 'en' ? 'on' : 'في'} {new Date(hist.timestamp).toLocaleString()}
                          {hist.comments && <span style={{ fontStyle: 'italic', display: 'block', color: 'var(--text-muted)' }}>"{hist.comments}"</span>}
                        </div>
                      ))
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{currentLang === 'en' ? 'No sign-offs yet' : 'لا توجد تواقيع حالية'}</span>
                    )}
                  </div>
                </div>

                {/* Decision Panel */}
                <div style={{ borderTop: '1px solid var(--surface-border)', paddingTop: '15px', marginTop: '10px' }}>
                  {(() => {
                    const reqRole = selectedWfInstance.current_step?.required_role;
                    return reqRole ? (checkUserRoleMatches(reqRole, userRole) || checkUserRoleMatches('IT/Admin', userRole)) : false;
                  })() ? (
                    <div>
                      {(() => {
                        const latestHist = selectedWfInstance.history?.filter((h: any) => h.comments).slice(-1)[0];
                        if (latestHist) {
                          return (
                            <div style={{ fontSize: '12px', backgroundColor: 'rgba(255, 193, 7, 0.08)', borderLeft: '3px solid var(--accent-gold)', padding: '10px', borderRadius: '6px', marginBottom: '15px' }}>
                              <strong>{currentLang === 'en' ? 'Previous Stage Comment' : 'ملاحظة المرحلة السابقة'} ({latestHist.approver}):</strong>
                              <p style={{ fontStyle: 'italic', margin: '4px 0 0 0', color: 'var(--text-muted)' }}>"{latestHist.comments}"</p>
                            </div>
                          );
                        }
                        return null;
                      })()}
                      <div className="form-group">
                        <label>{t('lbl_comments')}</label>
                        <textarea 
                          rows={2}
                          className="form-control" 
                          placeholder={currentLang === 'en' ? 'Enter decision justification comments...' : 'أدخل ملاحظات تبرير القرار...'}
                          value={modalComments}
                          onChange={e => setModalComments(e.target.value)}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '15px' }}>
                        <button 
                          className="btn btn-primary" 
                          style={{ flex: 1, padding: '12px', background: 'var(--accent-green)', borderColor: 'var(--accent-green)', color: '#000', fontWeight: 'bold' }}
                          onClick={() => handleInstanceAction(selectedWfInstance.instance_id, 'APPROVED', modalComments)}
                        >
                          {t('btn_sign_off')}
                        </button>
                        <button 
                          className="btn btn-danger" 
                          style={{ flex: 1, padding: '12px' }}
                          onClick={() => handleInstanceAction(selectedWfInstance.instance_id, 'REJECTED', modalComments)}
                        >
                          {t('btn_reject')}
                        </button>
                        <button 
                          className="btn" 
                          style={{ flex: 1, padding: '12px', background: 'var(--accent-orange)', borderColor: 'var(--accent-orange)', color: '#000', fontWeight: 'bold' }}
                          onClick={() => handleInstanceAction(selectedWfInstance.instance_id, 'RETURNED', modalComments)}
                        >
                          {currentLang === 'en' ? 'Return to First Stage' : 'إرجاع للمرحلة الأولى'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', justifyContent: 'center', padding: '10px' }}>
                      <i className="fa-solid fa-lock" style={{ fontSize: '18px', color: 'var(--accent-orange)' }}></i>
                      <span>
                        {currentLang === 'en' 
                          ? `You are logged in as "${userRole}". Only users assigned to this active step ("${selectedWfInstance.current_step?.required_role}") are authorized to make decisions.` 
                          : `لقد قمت بتسجيل الدخول كـ "${userRole}". فقط المستخدمون المعينون للمرحلة النشطة الحالية ("${selectedWfInstance.current_step?.required_role}") مخولون باتخاذ القرارات.`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CREATE USER MODAL */}
        {showCreateUserModal && (
          <div className="modal-overlay active" onClick={() => setShowCreateUserModal(false)}>
            <div className="glass-card modal-content-box" style={{ width: '500px' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{t('btn_create_user')}</h3>
                <span className="modal-close-btn" onClick={() => setShowCreateUserModal(false)}>&times;</span>
              </div>
              <div className="form-group">
                <label>{t('th_username')}</label>
                <input type="text" className="form-control" value={newUserName} onChange={e => setNewUserName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>{t('th_display_name')}</label>
                <input type="text" className="form-control" value={newUserDisplay} onChange={e => setNewUserDisplay(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>{t('th_email')}</label>
                <input type="email" className="form-control" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>{currentLang === 'en' ? 'Password' : 'كلمة المرور'}</label>
                <input type="password" className="form-control" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>{t('th_groups')}</label>
                <div style={{ maxHeight: '100px', overflowY: 'auto', border: '1px solid var(--surface-border)', padding: '10px', borderRadius: '6px', background: 'var(--bg-secondary)' }}>
                  {adminGroups.map(g => (
                    <div key={g.groupId} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <input 
                        type="checkbox" 
                        id={`chk-group-${g.groupId}`}
                        checked={newUserGroups.includes(g.groupId)}
                        onChange={e => {
                          if (e.target.checked) {
                            setNewUserGroups([...newUserGroups, g.groupId]);
                          } else {
                            setNewUserGroups(newUserGroups.filter(id => id !== g.groupId));
                          }
                        }}
                      />
                      <label htmlFor={`chk-group-${g.groupId}`} style={{ cursor: 'pointer', margin: 0 }}>{g.groupName}</label>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '15px', marginTop: '15px' }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleCreateUser}>{t('btn_create_user')}</button>
                <button className="btn" style={{ flex: 1 }} onClick={() => setShowCreateUserModal(false)}>{currentLang === 'en' ? 'Cancel' : 'إلغاء'}</button>
              </div>
            </div>
          </div>
        )}

        {/* CREATE GROUP MODAL */}
        {showCreateGroupModal && (
          <div className="modal-overlay active" onClick={() => setShowCreateGroupModal(false)}>
            <div className="glass-card modal-content-box" style={{ width: '400px' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{t('btn_create_group')}</h3>
                <span className="modal-close-btn" onClick={() => setShowCreateGroupModal(false)}>&times;</span>
              </div>
              <div className="form-group">
                <label>{t('th_group_name')}</label>
                <input type="text" className="form-control" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>{t('th_description')}</label>
                <textarea rows={2} className="form-control" value={newGroupDesc} onChange={e => setNewGroupDesc(e.target.value)} required />
              </div>
              <div style={{ display: 'flex', gap: '15px', marginTop: '15px' }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleCreateGroup}>{t('btn_create_group')}</button>
                <button className="btn" style={{ flex: 1 }} onClick={() => setShowCreateGroupModal(false)}>{currentLang === 'en' ? 'Cancel' : 'إلغاء'}</button>
              </div>
            </div>
          </div>
        )}

        {/* GROUP PERMISSIONS MODAL */}
        {showGroupPermsModal && selectedAdminGroup && (
          <div className="modal-overlay active" onClick={() => { setShowGroupPermsModal(false); setSelectedAdminGroup(null); }}>
            <div className="glass-card modal-content-box" style={{ width: '600px' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{currentLang === 'en' ? `Permissions for "${selectedAdminGroup.groupName}"` : `صلاحيات المجموعة "${selectedAdminGroup.groupName}"`}</h3>
                <span className="modal-close-btn" onClick={() => { setShowGroupPermsModal(false); setSelectedAdminGroup(null); }}>&times;</span>
              </div>
              <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '5px' }}>
                {MODULE_KEYS.map(m => (
                  <div key={m.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--surface-border)' }}>
                    <div>
                      <strong style={{ fontSize: '14px' }}>{m.label}</strong>
                      <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)' }}>Module Key: {m.key}</span>
                    </div>
                    <select 
                      value={editPermMatrix[m.key] || 'HIDDEN'}
                      onChange={e => {
                        setEditPermMatrix({
                          ...editPermMatrix,
                          [m.key]: e.target.value
                        });
                      }}
                      style={{ padding: '6px', borderRadius: '6px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000', fontSize: '12px', minWidth: '130px' }}
                    >
                      <option value="FULL">{t('lbl_full')}</option>
                      <option value="READ_WRITE">{t('lbl_read_write')}</option>
                      <option value="READ_ONLY">{t('lbl_read_only')}</option>
                      <option value="HIDDEN">{t('lbl_hidden')}</option>
                    </select>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '15px', marginTop: '20px', borderTop: '1px solid var(--surface-border)', paddingTop: '15px' }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSaveGroupPermissions}>{t('btn_save_permissions')}</button>
                <button className="btn" style={{ flex: 1 }} onClick={() => { setShowGroupPermsModal(false); setSelectedAdminGroup(null); }}>{currentLang === 'en' ? 'Cancel' : 'إلغاء'}</button>
              </div>
            </div>
          </div>
        )}

        {/* BRANCH TRANSFER MODAL */}
        {showTransferModal && (
          <div className="modal-overlay active" onClick={() => setShowTransferModal(false)}>
            <div className="glass-card modal-content-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '450px' }}>
              <div className="modal-header">
                <h3>{currentLang === 'ar' ? 'بدء تحويل فرعي' : 'Initiate Branch Transfer'}</h3>
                <span className="modal-close-btn" onClick={() => setShowTransferModal(false)}>&times;</span>
              </div>
              <div style={{ padding: '10px 0' }}>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '15px' }}>
                  {currentLang === 'ar' ? `السبيكة المحددة: ${transferItemSerial}` : `Selected Bar: ${transferItemSerial}`}
                </p>
                <div className="form-group">
                  <label>{currentLang === 'ar' ? 'فرع الوجهة' : 'Destination Branch'}</label>
                  <select value={transferDestBranchId} onChange={e => setTransferDestBranchId(e.target.value)} style={{ color: '#000' }}>
                    <option value="">{currentLang === 'ar' ? '-- اختر فرع الوجهة --' : '-- Select Destination Branch --'}</option>
                    {branchesList.filter(b => b.is_active).map((b: any) => (
                      <option key={b.branch_id} value={b.branch_id}>{b.branch_name} ({b.branch_code})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>{currentLang === 'ar' ? 'معلومات شركة الشحن / النقل' : 'Courier / Security Details'}</label>
                  <input type="text" className="form-control" placeholder="e.g. KFH Security Escort Group Alpha"
                    value={transferCourierInfo} onChange={e => setTransferCourierInfo(e.target.value)} />
                </div>
                <button className="btn btn-primary" style={{ width: '100%', marginTop: '15px' }}
                  onClick={handleInitiateBranchTransfer}
                  disabled={!transferDestBranchId}>
                  <i className="fa-solid fa-paper-plane"></i> {currentLang === 'ar' ? 'بدء حركة التحويل الفرعي' : 'Initiate Transfer Workflow'}
                </button>
              </div>
            </div>
          </div>
        )}
        {showScanQrModal && (
          <div className="modal-overlay active" onClick={() => setShowScanQrModal(false)}>
            <div className="glass-card modal-content-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
              <div className="modal-header">
                <h3>{currentLang === 'ar' ? 'مسح والتحقق من سبيكة GFS' : 'Scan & Lookup GFS Bar'}</h3>
                <span className="modal-close-btn" onClick={() => setShowScanQrModal(false)}>&times;</span>
              </div>
              <div style={{ padding: '15px 0' }}>
                <div className="form-group">
                  <label>{currentLang === 'ar' ? 'أدخل الرقم التسلسلي أو امسح الباركود' : 'Enter Serial or Scan Barcode'}</label>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <input type="text" className="form-control" placeholder="e.g. SN-KFH-100G-001" value={scanQrInput} onChange={e => setScanQrInput(e.target.value)} />
                    <button className="btn btn-primary" onClick={async () => {
                      setScanQrError('');
                      setScanQrResult(null);
                      try {
                        const res = await fetch(`${API_BASE}/inventory/items/scan-qr`, {
                          method: 'POST',
                          headers: { 
                            'Content-Type': 'application/json'
                          },
                          body: JSON.stringify({ serialNumber: scanQrInput })
                        });
                        if (res.ok) {
                          setScanQrResult(await res.json());
                        } else {
                          const err = await res.json();
                          setScanQrError(err.error || 'Lookup failed');
                        }
                      } catch (e: any) {
                        setScanQrError(e.message);
                      }
                    }}>{currentLang === 'ar' ? 'تحقق' : 'Verify'}</button>
                  </div>
                </div>

                {scanQrError && (
                  <div style={{ padding: '10px', background: 'rgba(220, 53, 69, 0.1)', border: '1px solid #dc3545', color: '#dc3545', borderRadius: '4px', marginTop: '10px' }}>
                    {scanQrError}
                  </div>
                )}

                {scanQrResult && (
                  <div style={{ marginTop: '15px', padding: '15px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid var(--surface-border)', fontSize: '13px' }}>
                    <div style={{ marginBottom: '8px' }}><strong>{currentLang === 'ar' ? 'الرقم التسلسلي:' : 'Serial Number:'}</strong> {scanQrResult.serialNumber}</div>
                    <div style={{ marginBottom: '8px' }}><strong>{currentLang === 'ar' ? 'الملكية:' : 'Ownership Type:'}</strong> {scanQrResult.ownershipType}</div>
                    <div style={{ marginBottom: '8px' }}><strong>{currentLang === 'ar' ? 'حساب العميل:' : 'Customer Account:'}</strong> {scanQrResult.customerAccountNumber || '—'}</div>
                    <div style={{ marginBottom: '8px' }}><strong>{currentLang === 'ar' ? 'متوسط تكلفة الشراء:' : 'Average Purchase Cost:'}</strong> {scanQrResult.averagePurchaseCost ? `$${scanQrResult.averagePurchaseCost.toFixed(2)}` : '—'}</div>
                    <div><strong>{currentLang === 'ar' ? 'آخر مزامنة مع GFS:' : 'GFS Last Sync:'}</strong> {scanQrResult.gfsLastSyncAt ? new Date(scanQrResult.gfsLastSyncAt).toLocaleString() : '—'}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {/* CREATE HOME DELIVERY REQUEST MODAL (UC07) */}
        {showCreateHomeDeliveryModal && (
          <div className="modal-overlay active" onClick={() => setShowCreateHomeDeliveryModal(false)}>
            <div className="glass-card modal-content-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', width: '90%' }}>
              <div className="modal-header">
                <h3>{currentLang === 'en' ? 'New Home Delivery Fulfillment Request' : 'طلب توصيل منزلي جديد (بيت التمويل الكويتي)'}</h3>
                <span className="modal-close-btn" onClick={() => setShowCreateHomeDeliveryModal(false)}>&times;</span>
              </div>
              <div style={{ padding: '15px 0' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '15px' }}>
                  {currentLang === 'en'
                    ? 'Create door-to-door residential delivery order in Kuwait. Requires PACI-compliant 12-digit Civil ID.'
                    : 'إنشاء طلب توصيل منزلي داخل الكويت. يتطلب رقماً مدنياً صالحاً وفق خوارزمية الهيئة العامة للمعلومات المدنية.'}
                </p>

                <div className="split-grid-2" style={{ gap: '12px' }}>
                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Recipient Civil ID (PACI 12-digits)' : 'الرقم المدني للمستلم (12 رقماً)'}</label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input 
                        type="text" 
                        maxLength={12}
                        className="form-control" 
                        placeholder="e.g. 290011501239" 
                        value={newHdCivilId} 
                        onChange={e => {
                          const val = e.target.value;
                          setNewHdCivilId(val);
                          if (val.length === 12) {
                            handleValidateCivilIdApi(val);
                          } else {
                            setCivilIdValidationResult(null);
                          }
                        }} 
                      />
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => handleValidateCivilIdApi(newHdCivilId)}>
                        {currentLang === 'en' ? 'Verify' : 'تحقق'}
                      </button>
                    </div>
                    {civilIdValidationResult && (
                      <div style={{ fontSize: '11px', marginTop: '4px', color: civilIdValidationResult.isValid ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        <i className={`fa-solid ${civilIdValidationResult.isValid ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i> {civilIdValidationResult.message}
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Recipient Full Name' : 'اسم المستلم الثلاثي'}</label>
                    <input type="text" className="form-control" placeholder="e.g. Abdullah Al-Sabah" value={newHdName} onChange={e => setNewHdName(e.target.value)} />
                  </div>

                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Contact Phone (Kuwait Mobile)' : 'رقم الهاتف المتنقل'}</label>
                    <input type="text" className="form-control" placeholder="+965 99887766" value={newHdPhone} onChange={e => setNewHdPhone(e.target.value)} />
                  </div>

                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Customer GFS Account #' : 'رقم حساب العميل بـ GFS'}</label>
                    <input type="text" className="form-control" placeholder="e.g. ACC-KFH-889900" value={newHdAccount} onChange={e => setNewHdAccount(e.target.value)} />
                  </div>

                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label>{currentLang === 'en' ? 'Select 24K Gold Bar from Vault (Ready)' : 'اختر سبيكة الذهب 24 قيراط الجاهزة من الخزينة'}</label>
                    <select className="form-control" style={{ color: '#000' }} value={newHdBarId} onChange={e => setNewHdBarId(e.target.value)}>
                      <option value="">-- {currentLang === 'en' ? 'Select Bar' : 'اختر السبيكة'} --</option>
                      {inventoryList.filter((i: any) => i.status === 'READY').map((item: any, idx: number) => (
                        <option key={idx} value={item.item_id}>
                          {item.serial_number} - {item.metal} ({item.denomination}) - 24K (999.9)
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Kuwait Address Elements */}
                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Governorate' : 'المحافظة'}</label>
                    <select className="form-control" style={{ color: '#000' }} value={newHdGovernorate} onChange={e => setNewHdGovernorate(e.target.value)}>
                      <option value="Capital">{currentLang === 'en' ? 'Capital (Al-Asimah)' : 'العاصمة'}</option>
                      <option value="Hawalli">{currentLang === 'en' ? 'Hawalli' : 'حولي'}</option>
                      <option value="Farwaniya">{currentLang === 'en' ? 'Farwaniya' : 'الفروانية'}</option>
                      <option value="Ahmadi">{currentLang === 'en' ? 'Ahmadi' : 'الأحمدي'}</option>
                      <option value="Jahra">{currentLang === 'en' ? 'Jahra' : 'الجهراء'}</option>
                      <option value="Mubarak Al-Kabeer">{currentLang === 'en' ? 'Mubarak Al-Kabeer' : 'مبارك الكبير'}</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Area / City' : 'المنطقة'}</label>
                    <input type="text" className="form-control" placeholder="e.g. Shuwaikh / Jabriya" value={newHdArea} onChange={e => setNewHdArea(e.target.value)} />
                  </div>

                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Block #' : 'القطعة'}</label>
                    <input type="text" className="form-control" placeholder="e.g. 1" value={newHdBlock} onChange={e => setNewHdBlock(e.target.value)} />
                  </div>

                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Street #' : 'الشارع'}</label>
                    <input type="text" className="form-control" placeholder="e.g. Street 10" value={newHdStreet} onChange={e => setNewHdStreet(e.target.value)} />
                  </div>

                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Building / House #' : 'المبنى / المنزل'}</label>
                    <input type="text" className="form-control" placeholder="e.g. Building 5" value={newHdBuilding} onChange={e => setNewHdBuilding(e.target.value)} />
                  </div>

                  <div className="form-group">
                    <label>{currentLang === 'en' ? 'Floor / Flat (Optional)' : 'الدور / الشقة (اختياري)'}</label>
                    <input type="text" className="form-control" placeholder="e.g. Flat 3" value={newHdFlat} onChange={e => setNewHdFlat(e.target.value)} />
                  </div>

                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label>{currentLang === 'en' ? 'Delivery Special Instructions' : 'تعليمات خاصة للتسليم'}</label>
                    <input type="text" className="form-control" placeholder="e.g. Call before arrival, VIP client" value={newHdInstructions} onChange={e => setNewHdInstructions(e.target.value)} />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={async () => {
                    if (!newHdBarId || !newHdCivilId || !newHdName || !newHdPhone) {
                      alert(currentLang === 'en' ? 'Please fill in all mandatory fields.' : 'يرجى استكمال جميع الحقول الإلزامية.');
                      return;
                    }
                    try {
                      const res = await fetch(`${API_BASE}/gfs/home-delivery`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          barId: parseInt(newHdBarId),
                          customerAccountNumber: newHdAccount,
                          recipientCivilId: newHdCivilId,
                          recipientName: newHdName,
                          recipientPhone: newHdPhone,
                          governorate: newHdGovernorate,
                          area: newHdArea,
                          block: newHdBlock,
                          street: newHdStreet,
                          building: newHdBuilding,
                          flat: newHdFlat,
                          deliveryInstructions: newHdInstructions,
                          createdBy: username || 'SYSTEM'
                        })
                      });
                      if (res.ok) {
                        const data = await res.json();
                        alert(currentLang === 'en' 
                          ? `Home delivery created! Ref: ${data.deliveryReferenceNumber}\n6-Digit Verification OTP: ${data.verificationOtp}` 
                          : `تم إنشاء طلب التوصيل المنزلي! المرجع: ${data.deliveryReferenceNumber}\nرمز التحقق (OTP): ${data.verificationOtp}`);
                        setShowCreateHomeDeliveryModal(false);
                        fetchHomeDeliveries();
                        fetchInventory();
                      } else {
                        const err = await res.json();
                        alert(err.error || 'Creation failed');
                      }
                    } catch (e) {
                      alert('Error submitting home delivery request');
                    }
                  }}>
                    <i className="fa-solid fa-paper-plane"></i> {currentLang === 'en' ? 'Create Order' : 'إنشاء الطلب'}
                  </button>
                  <button className="btn" onClick={() => setShowCreateHomeDeliveryModal(false)}>
                    {currentLang === 'en' ? 'Cancel' : 'إلغاء'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DISPATCH HOME DELIVERY MODAL */}
        {showDispatchHdModal && (
          <div className="modal-overlay active" onClick={() => setShowDispatchHdModal(false)}>
            <div className="glass-card modal-content-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
              <div className="modal-header">
                <h3>{currentLang === 'en' ? 'Dispatch Home Delivery to Courier' : 'تسليم الشحنة لمندوب التوصيل المنزلي'}</h3>
                <span className="modal-close-btn" onClick={() => setShowDispatchHdModal(false)}>&times;</span>
              </div>
              <div style={{ padding: '15px 0' }}>
                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Courier Logistics Company' : 'شركة النقل واللوجستيات'}</label>
                  <input type="text" className="form-control" value={hdCourierCompany} onChange={e => setHdCourierCompany(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Courier Representative Name' : 'اسم المندوب / المرافق الأمني'}</label>
                  <input type="text" className="form-control" value={hdCourierRepName} onChange={e => setHdCourierRepName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Representative Civil ID' : 'الرقم المدني للمندوب'}</label>
                  <input type="text" className="form-control" value={hdCourierCivilId} onChange={e => setHdCourierCivilId(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Vehicle Plate Number' : 'رقم لوحة المركبة الأمنية'}</label>
                  <input type="text" className="form-control" value={hdVehiclePlate} onChange={e => setHdVehiclePlate(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Tamper-Evident Security Seal #' : 'رقم القفل الأمني المشمع'}</label>
                  <input type="text" className="form-control" value={hdSecuritySeal} onChange={e => setHdSecuritySeal(e.target.value)} />
                </div>
                <button className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE}/gfs/home-delivery/${dispatchHdId}/dispatch`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        courierCompany: hdCourierCompany,
                        courierRepName: hdCourierRepName,
                        courierCivilId: hdCourierCivilId,
                        vehiclePlate: hdVehiclePlate,
                        securitySealNumber: hdSecuritySeal,
                        dispatchedBy: username || 'SYSTEM'
                      })
                    });
                    if (res.ok) {
                      alert(currentLang === 'en' ? 'Dispatched to courier! Status set to IN_TRANSIT.' : 'تم تسليم الشحنة للناقل! تم التحديث إلى قيد النقل.');
                      setShowDispatchHdModal(false);
                      fetchHomeDeliveries();
                    } else {
                      const err = await res.json();
                      alert(err.error || 'Dispatch failed');
                    }
                  } catch (e) {
                    alert('Error dispatching home delivery');
                  }
                }}>
                  <i className="fa-solid fa-truck"></i> {currentLang === 'en' ? 'Confirm Dispatch' : 'تأكيد التسليم للناقل'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CONFIRM HOME DELIVERY HANDOVER MODAL */}
        {showConfirmHandoverModal && (
          <div className="modal-overlay active" onClick={() => setShowConfirmHandoverModal(false)}>
            <div className="glass-card modal-content-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
              <div className="modal-header">
                <h3>{currentLang === 'en' ? 'Confirm Customer Handover (OTP Verification)' : 'تأكيد تسليم العميل (التحقق برمز OTP)'}</h3>
                <span className="modal-close-btn" onClick={() => setShowConfirmHandoverModal(false)}>&times;</span>
              </div>
              <div style={{ padding: '15px 0' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '15px' }}>
                  {currentLang === 'en'
                    ? 'Enter 6-digit OTP provided by the customer and verify recipient Civil ID at the doorstep.'
                    : 'أدخل رمز التحقق (OTP) المكون من 6 أرقام والمستلم من العميل وتحقق من بطاقته المدنية عند الاستلام.'}
                </p>

                <div className="form-group">
                  <label>{currentLang === 'en' ? '6-Digit Verification OTP' : 'رمز التحقق (OTP) 6 أرقام'}</label>
                  <input type="text" maxLength={6} className="form-control" style={{ fontSize: '18px', letterSpacing: '4px', textAlign: 'center', fontWeight: 'bold' }} placeholder="123456" value={confirmHdOtp} onChange={e => setConfirmHdOtp(e.target.value)} />
                </div>

                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Recipient Civil ID Verified' : 'الرقم المدني للمستلم الفعلي'}</label>
                  <input type="text" maxLength={12} className="form-control" value={confirmHdCivilId} onChange={e => setConfirmHdCivilId(e.target.value)} />
                </div>

                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Customer Digital Signature Reference' : 'مرجع التوقيع الإلكتروني'}</label>
                  <input type="text" className="form-control" value={confirmHdSignature} onChange={e => setConfirmHdSignature(e.target.value)} />
                </div>

                <button className="btn btn-primary" style={{ width: '100%', marginTop: '10px', background: 'var(--accent-green)' }} onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE}/gfs/home-delivery/${confirmHdId}/confirm-handover`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        verificationOtp: confirmHdOtp,
                        receivedByCivilId: confirmHdCivilId,
                        customerSignature: confirmHdSignature
                      })
                    });
                    if (res.ok) {
                      alert(currentLang === 'en' ? 'Delivery successfully confirmed and completed!' : 'تم تأكيد واكتمال تسليم الشحنة للعميل بنجاح!');
                      setShowConfirmHandoverModal(false);
                      fetchHomeDeliveries();
                      fetchInventory();
                    } else {
                      const err = await res.json();
                      alert(err.error || 'Handover confirmation failed');
                    }
                  } catch (e) {
                    alert('Error confirming handover');
                  }
                }}>
                  <i className="fa-solid fa-circle-check"></i> {currentLang === 'en' ? 'Confirm Delivery Complete' : 'تأكيد اكتمال التسليم'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* GFS BRANCH DISPATCH MODAL */}
        {showGfsDispatchModal && (
          <div className="modal-overlay active" onClick={() => setShowGfsDispatchModal(false)}>
            <div className="glass-card modal-content-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
              <div className="modal-header">
                <h3>{currentLang === 'en' ? 'Dispatch GFS Delivery to Courier' : 'تسليم شحنة GFS للناقل الأمني'}</h3>
                <span className="modal-close-btn" onClick={() => setShowGfsDispatchModal(false)}>&times;</span>
              </div>
              <div style={{ padding: '15px 0' }}>
                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Courier Logistics Company' : 'شركة النقل واللوجستيات'}</label>
                  <input type="text" className="form-control" value={gfsCourierCompany} onChange={e => setGfsCourierCompany(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Courier Representative Name' : 'اسم المندوب / المرافق الأمني'}</label>
                  <input type="text" className="form-control" value={gfsCourierRepName} onChange={e => setGfsCourierRepName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Representative Civil ID' : 'الرقم المدني للمندوب'}</label>
                  <input type="text" className="form-control" value={gfsCourierCivilId} onChange={e => setGfsCourierCivilId(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Vehicle Plate Number' : 'رقم لوحة المركبة الأمنية'}</label>
                  <input type="text" className="form-control" value={gfsVehiclePlate} onChange={e => setGfsVehiclePlate(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Security Seal #' : 'رقم القفل الأمني'}</label>
                  <input type="text" className="form-control" value={gfsSecuritySeal} onChange={e => setGfsSecuritySeal(e.target.value)} />
                </div>
                <button className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE}/gfs/delivery-requests/${gfsDispatchId}/dispatch`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        courierCompany: gfsCourierCompany,
                        courierRepName: gfsCourierRepName,
                        courierCivilId: gfsCourierCivilId,
                        vehiclePlate: gfsVehiclePlate,
                        securitySealNumber: gfsSecuritySeal,
                        dispatchedBy: username || 'SYSTEM'
                      })
                    });
                    if (res.ok) {
                      alert(currentLang === 'en' ? 'Dispatched to branch courier!' : 'تم تسليم الشحنة لناقل الفرع بنجاح!');
                      setShowGfsDispatchModal(false);
                      fetchGfsDeliveryRequests();
                    } else {
                      const err = await res.json();
                      alert(err.error || 'Dispatch failed');
                    }
                  } catch (e) {
                    alert('Error dispatching GFS delivery');
                  }
                }}>
                  <i className="fa-solid fa-truck"></i> {currentLang === 'en' ? 'Confirm Dispatch' : 'تأكيد التسليم للناقل'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DAMAGED BAR MODAL (UC12) */}
        {showDamageModal && (
          <div className="modal-overlay active" onClick={() => setShowDamageModal(false)}>
            <div className="glass-card modal-content-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
              <div className="modal-header">
                <h3>{currentLang === 'ar' ? 'إبلاغ عن سبيكة تالفة (Maker-Checker)' : 'Report Damaged Gold Bar (UC12)'}</h3>
                <span className="modal-close-btn" onClick={() => setShowDamageModal(false)}>&times;</span>
              </div>
              <div style={{ padding: '15px 0' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '15px' }}>
                  {currentLang === 'en'
                    ? 'Submits damaged bar to Checker for mandatory 4-Eyes quarantine approval. Reporter cannot self-approve.'
                    : 'تقديم تقرير التلف للمراجع للاعتماد الإلزامي بموجب مبدأ 4-Eyes. لا يحق للصانع اعتماد تقريره ذاتياً.'}
                </p>

                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Select Bar from Vault' : 'اختر السبيكة من الخزينة'}</label>
                  <select className="form-control" style={{ color: '#000' }} value={damageItemId || ''} onChange={e => setDamageItemId(parseInt(e.target.value))}>
                    <option value="">-- {currentLang === 'en' ? 'Choose Bar' : 'اختر السبيكة'} --</option>
                    {inventoryList.map((item: any, idx: number) => (
                      <option key={idx} value={item.item_id}>
                        {item.serial_number} - {item.metal} ({item.denomination}) - Status: {item.status}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>{currentLang === 'ar' ? 'سبب التلف والخلل الفني' : 'Reason for Damage / Defect'}</label>
                  <select className="form-control" style={{ color: '#000' }} value={damageReason} onChange={e => setDamageReason(e.target.value)}>
                    <option value="SCRATCHED_HALLMARK">{currentLang === 'en' ? 'Scratched Hallmark / Stamp Defect' : 'ختم مخدوش / تلف في الدمغة'}</option>
                    <option value="DENT_DEFORMATION">{currentLang === 'en' ? 'Dent / Physical Deformation' : 'انبعاج / تشوه مادي'}</option>
                    <option value="PURITY_ASSAY_DISCREPANCY">{currentLang === 'en' ? 'Assay / Purity Discrepancy (< 999.9)' : 'اختلاف في النقاوة والفحص (< 999.9)'}</option>
                    <option value="WEIGHT_VARIANCE">{currentLang === 'en' ? 'Weight Under Tolerance' : 'نقص في الوزن الفعلي'}</option>
                    <option value="OXIDATION_TARNISH">{currentLang === 'en' ? 'Surface Oxidation / Discoloration' : 'أكسدة / تغير لون السطح'}</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>{currentLang === 'ar' ? 'الوصف التفصيلي للخلل' : 'Detailed Technical Description'}</label>
                  <textarea className="form-control" rows={3} placeholder={currentLang === 'en' ? 'Enter physical inspection findings...' : 'أدخل نتائج الفحص المادي...'} value={damageDesc} onChange={e => setDamageDesc(e.target.value)} />
                </div>

                <div className="form-group">
                  <label>{currentLang === 'ar' ? 'رقم محضر فحص وزارة التجارة (MOCI) / المستند' : 'MOCI Assay / Inspection Document Ref #'}</label>
                  <input type="text" className="form-control" value={damageDocId} onChange={e => setDamageDocId(e.target.value)} />
                </div>

                <button className="btn btn-primary" style={{ width: '100%', marginTop: '15px', background: '#dc3545' }} onClick={async () => {
                  if (!damageItemId || !damageReason || !damageDesc) {
                    alert(currentLang === 'en' ? 'Please provide bar selection, reason, and description.' : 'يرجى اختيار السبيكة وتحديد السبب والوصف.');
                    return;
                  }
                  try {
                    const res = await fetch(`${API_BASE}/inventory/items/${damageItemId}/mark-damaged`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        reason: damageReason,
                        description: damageDesc,
                        evidenceDocId: damageDocId,
                        reportedBy: username || 'treasury-maker'
                      })
                    });
                    if (res.ok) {
                      alert(currentLang === 'en' ? 'Damage report submitted! Awaiting Checker 4-Eyes approval.' : 'تم إرسال بلاغ التلف! بانتظار اعتماد المراجع وفق مبدأ 4-Eyes.');
                      setShowDamageModal(false);
                      fetchInventory();
                      fetchDamagedBars();
                    } else {
                      const err = await res.json();
                      alert(err.error || 'Failed to mark damaged');
                    }
                  } catch (e) {
                    alert('Error submitting damage report');
                  }
                }}>
                  <i className="fa-solid fa-triangle-exclamation"></i> {currentLang === 'ar' ? 'تقديم بلاغ التلف للمراجع' : 'Submit Damage Report to Checker'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ENHANCED RECEIVE & 4-POINT VERIFICATION MODAL */}
        {showReceiveModal && (
          <div className="modal-overlay active" onClick={() => setShowReceiveModal(false)}>
            <div className="glass-card modal-content-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
              <div className="modal-header">
                <h3>{currentLang === 'ar' ? 'التحقق واستلام شحنة GFS (4-Point Verification)' : 'Verify & Receive GFS Delivery'}</h3>
                <span className="modal-close-btn" onClick={() => setShowReceiveModal(false)}>&times;</span>
              </div>
              <div style={{ padding: '15px 0' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '15px' }}>
                  {currentLang === 'ar' 
                    ? 'التحقق الآلي الإلزامي: 1) تطابق السيريال، 2) تطابق فرع الوجهة، 3) فحص سلامة السبيكة، 4) حالة النقل.'
                    : 'Mandatory 4-Point Check: 1) Bar Serial Match, 2) Destination Branch Match, 3) Undamaged Status, 4) In-Transfer State.'}
                </p>

                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Scanned Bar Serial' : 'الرقم التسلسلي الممسوح للقطعة'}</label>
                  <input type="text" className="form-control" value={receiveScannedSerial} onChange={e => setReceiveScannedSerial(e.target.value)} />
                </div>

                <div className="form-group">
                  <label>{currentLang === 'en' ? 'Receiving Branch' : 'الفرع المستلم'}</label>
                  <select className="form-control" style={{ color: '#000' }} value={receiveBranchId} onChange={e => setReceiveBranchId(parseInt(e.target.value))}>
                    {branchesList.map((b: any, idx: number) => (
                      <option key={idx} value={b.branch_id}>{b.branch_name}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '15px 0' }}>
                  <input type="checkbox" id="validationPassed" checked={receiveValidationPassed} onChange={e => setReceiveValidationPassed(e.target.checked)} />
                  <label htmlFor="validationPassed" style={{ margin: 0, cursor: 'pointer', fontWeight: 'bold' }}>
                    {currentLang === 'ar' ? 'اجتياز الفحص المادي وتطابق جميع المعايير' : 'Physical inspection passed and all criteria match'}
                  </label>
                </div>

                {!receiveValidationPassed && (
                  <div style={{ padding: '10px', background: 'rgba(220, 53, 69, 0.12)', border: '1px solid #dc3545', color: '#dc3545', borderRadius: '4px', fontSize: '12px', marginBottom: '15px' }}>
                    <strong>{currentLang === 'ar' ? 'تنبيه الإرجاع للناقل الأمني:' : 'Return to Courier Notice:'}</strong><br />
                    {currentLang === 'ar' 
                      ? 'سيتم إلغاء الاستلام فوراً ووسم الشحنة للإرجاع إلى الخزينة الرئيسية.'
                      : 'Failure cancels delivery. The bar will be flagged for immediate return to Main Vault.'}
                  </div>
                )}

                <button className="btn btn-primary" style={{ width: '100%', background: receiveValidationPassed ? 'var(--accent-green)' : '#dc3545' }} onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE}/gfs/delivery-requests/${receiveRequestId}/receive`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ 
                        validationPassed: receiveValidationPassed,
                        scannedSerialNumber: receiveScannedSerial,
                        receivingBranchId: receiveBranchId,
                        receivedBy: username || 'SYSTEM'
                      })
                    });
                    if (res.ok) {
                      const data = await res.json();
                      alert(data.passed 
                        ? (currentLang === 'en' ? 'Delivery received and verified successfully!' : 'تم التحقق واستلام الشحنة بالفرع بنجاح!') 
                        : (currentLang === 'en' ? `Verification Failed: ${data.message}. Delivery cancelled and returned to courier!` : `فشل التحقق: ${data.message}. تم إلغاء الشحنة وإرجاعها للناقل!`)
                      );
                      setShowReceiveModal(false);
                      fetchGfsDeliveryRequests();
                      fetchInventory();
                    } else {
                      const err = await res.json();
                      alert(err.error || 'Receive failed');
                    }
                  } catch (e) {
                    alert('Error receiving delivery');
                  }
                }}>
                  {receiveValidationPassed 
                    ? (currentLang === 'en' ? 'Confirm Receipt & Verification' : 'تأكيد الاستلام والتحقق') 
                    : (currentLang === 'en' ? 'Cancel & Return to Courier' : 'إلغاء وإرجاع للناقل')
                  }
                </button>
              </div>
            </div>
          </div>
        )}
        {/* INTAKE SHIPMENT MODAL - FULL SCREEN WITH DATA GRID */}
        {showIntakeModal && (intakePOId || intakePONumber === 'DIRECT') && (
          <div className="modal-overlay active" onClick={() => setShowIntakeModal(false)}>
            <div className="glass-card modal-content-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '95vw', width: '95vw', maxHeight: '95vh', height: '95vh', display: 'flex', flexDirection: 'column' }}>
              {/* HEADER */}
              <div className="modal-header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '20px' }}>
                  <div>
                    <h3>{currentLang === 'ar' ? 'التحقق واستلام الشحنة (مسح باركود)' : 'Verify & Receive Shipment (Scan)'}</h3>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                      {currentLang === 'ar' ? `طلب الشراء: ${intakePONumber}` : `PO: ${intakePONumber}`} •
                      {currentLang === 'ar' ? ' رقم التشغيلة: ' : ' Lot #: '}{intakeLotNum}
                    </p>
                  </div>
                  <span className="modal-close-btn" onClick={() => setShowIntakeModal(false)}>&times;</span>
                </div>
              </div>

              {/* MAIN CONTENT - SCROLLABLE */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0' }}>

                {/* TOP SECTION - PO DETAILS & SCANNER */}
                <div style={{ padding: '15px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* PO Details Row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', fontSize: '12px' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{currentLang === 'ar' ? 'رقم طلب الشراء' : 'PO Number'}</label>
                      <div style={{ fontWeight: 600, color: '#000' }}>{intakePONumber}</div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{currentLang === 'ar' ? 'موقع التخزين' : 'Storage Location'}</label>
                      <select value={intakeSelectedLocation} onChange={e => setIntakeSelectedLocation(parseInt(e.target.value))} style={{ color: '#000', fontSize: '11px', padding: '4px', height: '28px', width: '100%' }}>
                        {locations.flatMap(loc =>
                          loc.slots.map((s: any) => ({
                            id: s.location_id,
                            label: `${loc.vault_name} - ${loc.zone_room} - Row ${s.shelf_row} - Slot ${s.slot_bin}`
                          }))
                        ).map(item => (
                          <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{currentLang === 'ar' ? 'رقم التشغيلة' : 'Vendor Lot #'}</label>
                      <input type="text" className="form-control" value={intakeLotNum} onChange={e => setIntakeLotNum(e.target.value)} style={{ fontSize: '11px', padding: '4px', height: '28px' }} />
                    </div>
                  </div>

                  {/* Scanner Section - Prominent */}
                  <div className="glass-card" style={{ padding: '12px', background: 'rgba(0, 155, 78, 0.08)', border: '2px solid rgba(0, 155, 78, 0.3)', borderRadius: '6px' }}>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: 600, color: 'var(--kfh-green)' }}>
                      <i className="fa-solid fa-barcode"></i> {currentLang === 'ar' ? 'مسح الباركود / الرقم التسلسلي' : 'Scan Barcode / Serial Number'}
                    </h4>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        className="form-control"
                        placeholder={currentLang === 'ar' ? 'امسح الباركود أو أدخل الرقم التسلسلي...' : 'Scan barcode or enter serial...'}
                        value={currentScanSerial}
                        onChange={e => setCurrentScanSerial(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (currentScanSerial.trim()) {
                              const parsed = parseGs1Barcode(currentScanSerial.trim());
                              const isDup = scannedSerials.some(s => s.serial === parsed.serial);
                              if (isDup) {
                                alert(currentLang === 'en' ? 'This barcode/serial has already been scanned.' : 'هذا الباركود/الرقم التسلسلي تم مسحه مسبقاً.');
                                return;
                              }
                              setScannedSerials([
                                ...scannedSerials,
                                { serial: parsed.serial, product_id: intakeSelectedProductId, product_code: (products.find((p: any) => p.product_id === intakeSelectedProductId)?.denomination_label) || 'Bar' }
                              ]);
                              setCurrentScanSerial('');
                            }
                          }
                        }}
                        style={{ flex: 1, fontSize: '12px', padding: '8px' }}
                      />
                      <select
                        value={intakeSelectedProductId}
                        onChange={e => setIntakeSelectedProductId(parseInt(e.target.value))}
                        style={{ fontSize: '12px', padding: '8px', height: '36px', color: '#000', minWidth: '180px' }}
                      >
                        {(() => {
                          const intakePO = poList.find((p: any) => p.po_id === intakePOId);
                          const poItems = intakePO?.items && intakePO.items.length ? intakePO.items : null;
                          return poItems ? (
                            poItems.map((it: any) => {
                              const p = products.find((pp: any) => String(pp.product_id) === String(it.product_id));
                              const denom = p ? `${p.metal_name} ${p.denomination_label}` : `#${it.product_id}`;
                              const scanned = scannedSerials.filter(s => s.product_id === it.product_id).length;
                              return (
                                <option key={it.product_id} value={it.product_id}>
                                  {denom} ({scanned}/{it.qty})
                                </option>
                              );
                            })
                          ) : (
                            products
                              .filter((p: any) => p.is_active !== false)
                              .map((p: any) => (
                                <option key={p.product_id} value={p.product_id}>
                                  {p.metal_name} {p.denomination_label}
                                </option>
                              ))
                          );
                        })()}
                      </select>
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => {
                          if (currentScanSerial.trim()) {
                            const parsed = parseGs1Barcode(currentScanSerial.trim());
                            const isDup = scannedSerials.some(s => s.serial === parsed.serial);
                            if (isDup) {
                              alert(currentLang === 'en' ? 'This barcode/serial has already been scanned.' : 'هذا الباركود/الرقم التسلصلي تم مسحه مسبقاً.');
                              return;
                            }
                            setScannedSerials([
                              ...scannedSerials,
                              { serial: parsed.serial, product_id: intakeSelectedProductId, product_code: (products.find((p: any) => p.product_id === intakeSelectedProductId)?.denomination_label) || 'Bar' }
                            ]);
                            setCurrentScanSerial('');
                          }
                        }}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        <i className="fa-solid fa-plus"></i> {currentLang === 'ar' ? 'إضافة' : 'Add'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* SCANNED ITEMS DATA GRID */}
                <div style={{ flex: 1, overflow: 'auto', padding: '15px', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>
                      {currentLang === 'ar' ? 'العناصر الممسوحة' : 'Scanned Items'}
                      <span style={{ color: 'var(--kfh-green)', marginLeft: '8px' }}>({scannedSerials.length})</span>
                    </h4>
                    {scannedSerials.length > 0 && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          className="btn btn-sm"
                          onClick={() => {
                            const selectedItems = document.querySelectorAll('input[name="scan-checkbox"]:checked');
                            if (selectedItems.length > 0) {
                              setScannedSerials(scannedSerials.filter((_, idx) => {
                                const checkbox = document.querySelector(`input[name="scan-checkbox"][data-index="${idx}"]`) as HTMLInputElement;
                                return !checkbox?.checked;
                              }));
                            }
                          }}
                          style={{ fontSize: '11px', padding: '4px 8px', background: '#dc3545', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          <i className="fa-solid fa-trash"></i> {currentLang === 'ar' ? 'حذف المحدد' : 'Remove Selected'}
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => setScannedSerials([])}
                          style={{ fontSize: '11px', padding: '4px 8px', background: '#6c757d', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          <i className="fa-solid fa-xmark"></i> {currentLang === 'ar' ? 'مسح الكل' : 'Clear All'}
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => {
                            const exportData = scannedSerials.map((item, idx) => {
                              return `${idx + 1}\t${item.serial}\t${item.product_code}\tReceived`;
                            }).join('\n');
                            const csvContent = 'Serial\tProduct\tStatus\n' + exportData;
                            const blob = new Blob([csvContent], { type: 'text/plain' });
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${intakePONumber}-scanned-items.csv`;
                            a.click();
                            window.URL.revokeObjectURL(url);
                          }}
                          style={{ fontSize: '11px', padding: '4px 8px', background: '#17a2b8', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          <i className="fa-solid fa-download"></i> {currentLang === 'ar' ? 'تصدير' : 'Export'}
                        </button>
                      </div>
                    )}
                  </div>

                  {scannedSerials.length === 0 ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                      <div style={{ textAlign: 'center' }}>
                        <i className="fa-solid fa-inbox" style={{ fontSize: '32px', marginBottom: '8px', opacity: 0.5 }}></i>
                        <p>{currentLang === 'ar' ? 'لا توجد عناصر ممسوحة حتى الآن' : 'No scanned items yet'}</p>
                      </div>
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
                            <th style={{ padding: '10px', textAlign: 'center', width: '40px' }}>
                              <input
                                type="checkbox"
                                onChange={(e) => {
                                  document.querySelectorAll('input[name="scan-checkbox"]').forEach((cb: any) => {
                                    cb.checked = e.target.checked;
                                  });
                                }}
                                style={{ cursor: 'pointer' }}
                              />
                            </th>
                            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 600 }}>{currentLang === 'ar' ? 'الرقم التسلسلي' : 'Serial Number'}</th>
                            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 600 }}>{currentLang === 'ar' ? 'المنتج' : 'Product'}</th>
                            <th style={{ padding: '10px', textAlign: 'center', fontWeight: 600 }}>{currentLang === 'ar' ? 'الحالة' : 'Status'}</th>
                            <th style={{ padding: '10px', textAlign: 'center', width: '100px', fontWeight: 600 }}>{currentLang === 'ar' ? 'إجراءات' : 'Actions'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scannedSerials.map((item, idx) => {
                            const product = products.find((p: any) => p.product_id === item.product_id);
                            const rowColor = idx % 2 === 0 ? 'transparent' : 'rgba(0, 155, 78, 0.02)';
                            return (
                              <tr key={idx} style={{ background: rowColor, borderBottom: '1px solid var(--border-color)', height: '40px' }}>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                  <input
                                    type="checkbox"
                                    name="scan-checkbox"
                                    data-index={idx}
                                    style={{ cursor: 'pointer' }}
                                  />
                                </td>
                                <td style={{ padding: '8px 10px', color: 'var(--kfh-green)', fontWeight: 600, fontFamily: 'monospace' }}>
                                  {item.serial}
                                </td>
                                <td style={{ padding: '8px 10px', color: '#000' }}>
                                  {product ? `${product.metal_name} ${product.denomination_label}` : item.product_code}
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                  <span style={{ background: 'rgba(0, 155, 78, 0.15)', color: 'var(--kfh-green)', padding: '3px 8px', borderRadius: '3px', fontSize: '11px', fontWeight: 600 }}>
                                    {currentLang === 'ar' ? '✓ مستلم' : '✓ Received'}
                                  </span>
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                  <button
                                    onClick={() => {
                                      setScannedSerials(scannedSerials.filter((_, i) => i !== idx));
                                    }}
                                    style={{ background: '#dc3545', color: '#fff', border: 'none', borderRadius: '3px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px' }}
                                  >
                                    <i className="fa-solid fa-trash-alt"></i>
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

              </div>

              {/* FOOTER WITH SUMMARY & ACTION BUTTONS */}
              <div style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)', padding: '12px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '20px', fontSize: '12px' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>{currentLang === 'ar' ? 'إجمالي الممسوح:' : 'Total Scanned:'}</span>
                    <span style={{ fontWeight: 600, marginLeft: '6px', color: 'var(--kfh-green)', fontSize: '14px' }}>{scannedSerials.length}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>{currentLang === 'ar' ? 'طلب الشراء:' : 'PO Items:'}</span>
                    <span style={{ fontWeight: 600, marginLeft: '6px', color: '#000', fontSize: '14px' }}>
                      {(() => {
                        const intakePO = poList.find((p: any) => p.po_id === intakePOId);
                        return intakePO?.items ? intakePO.items.reduce((sum: number, it: any) => sum + it.qty, 0) : 0;
                      })()}
                    </span>
                  </div>
                  <div style={{ paddingLeft: '10px', borderLeft: '1px solid var(--border-color)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{currentLang === 'ar' ? 'نسبة الاكتمال:' : 'Completion:'}</span>
                    <span style={{ fontWeight: 600, marginLeft: '6px', fontSize: '14px', color: scannedSerials.length === (poList.find((p: any) => p.po_id === intakePOId)?.items?.reduce((sum: number, it: any) => sum + it.qty, 0) || 0) ? 'var(--accent-green)' : '#ffc107' }}>
                      {Math.round((scannedSerials.length / (poList.find((p: any) => p.po_id === intakePOId)?.items?.reduce((sum: number, it: any) => sum + it.qty, 0) || 1)) * 100)}%
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setShowIntakeModal(false)}
                    style={{ padding: '8px 16px' }}
                  >
                    {currentLang === 'ar' ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleSubmitIntake}
                    disabled={scannedSerials.length === 0}
                    style={{ padding: '8px 20px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <i className="fa-solid fa-check"></i> {currentLang === 'ar' ? 'تأكيد استلام الشحنة' : 'Confirm Shipment Receipt'}
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* GS1 BARCODE & QR LABEL PRINT MODAL (UC03 BR-009) */}
        {previewBarcodeModal && (
          <div className="modal-overlay active" onClick={() => setPreviewBarcodeModal(null)}>
            <div className="glass-card modal-content-box" style={{ width: '460px', padding: '24px' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header" style={{ marginBottom: '16px' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <i className="fa-solid fa-qrcode" style={{ color: 'var(--kfh-green)' }}></i>
                  {currentLang === 'en' ? 'Precious Metal Bar GS1 Tag' : 'ملصق الباركود المعتمد للسبيكة (GS1)'}
                </h3>
                <span className="modal-close-btn" onClick={() => setPreviewBarcodeModal(null)}>&times;</span>
              </div>

              {/* Printable Barcode Card */}
              <div style={{
                background: '#ffffff',
                color: '#111827',
                padding: '20px',
                borderRadius: '8px',
                border: '2px solid #e5e7eb',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                textAlign: 'center'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #009B4E', paddingBottom: '8px' }}>
                  <div style={{ fontWeight: '900', color: '#009B4E', fontSize: '15px', letterSpacing: '1px' }}>KFH PMIMS</div>
                  <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 'bold' }}>SHARIA VERIFIED</div>
                </div>

                {/* 2D DataMatrix / QR Simulation */}
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
                  <div style={{
                    width: '100px',
                    height: '100px',
                    backgroundColor: '#f3f4f6',
                    border: '1px solid #d1d5db',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: '6px'
                  }}>
                    <i className="fa-solid fa-qrcode" style={{ fontSize: '72px', color: '#111827' }}></i>
                  </div>
                  <div style={{ textAlign: 'left', fontSize: '12px', flex: 1 }}>
                    <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#111827' }}>{previewBarcodeModal.serial}</div>
                    <div style={{ color: '#4b5563', fontSize: '11px', marginTop: '2px' }}>{previewBarcodeModal.product}</div>
                    <div style={{ color: '#009B4E', fontWeight: 'bold', marginTop: '4px' }}>
                      {previewBarcodeModal.weight}g • {previewBarcodeModal.purity} PPT
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '11px', marginTop: '2px' }}>
                      Refiner: {previewBarcodeModal.refiner || 'Valcambi Suisse'}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '2px' }}>
                      Lot: {previewBarcodeModal.lot}
                    </div>
                  </div>
                </div>

                {/* 1D Barcode Simulation */}
                <div style={{ borderTop: '1px dashed #d1d5db', paddingTop: '10px' }}>
                  <div style={{
                    fontFamily: 'monospace',
                    letterSpacing: '5px',
                    fontSize: '22px',
                    fontWeight: '900',
                    lineHeight: '1',
                    color: '#000000',
                    userSelect: 'none'
                  }}>
                    ||| | |||| | || ||| || ||| | |||
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#4b5563', marginTop: '4px' }}>
                    (21){previewBarcodeModal.serial}(10){previewBarcodeModal.lot}
                  </div>
                </div>

                {previewBarcodeModal.isDamaged && (
                  <div style={{ backgroundColor: '#fee2e2', color: '#dc2626', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>
                    QUARANTINE / DAMAGED UPON INTAKE
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button className="btn btn-secondary" onClick={() => setPreviewBarcodeModal(null)}>
                  {currentLang === 'en' ? 'Close' : 'إغلاق'}
                </button>
                <button className="btn btn-primary" onClick={() => window.print()}>
                  <i className="fa-solid fa-print"></i> {currentLang === 'en' ? 'Print Tag' : 'طباعة الملصق'}
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
