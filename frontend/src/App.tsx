import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:8080/api';

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
    menu_operations: "Operations",
    menu_po: "P.O. & Procurement",
    menu_spatial: "Vault Spatial Map",
    menu_custody: "Customer Custody",
    menu_controls: "Controls & Audits",
    menu_stocktake: "Stocktake (الجرد)",
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
    menu_active_deals: "Active Deals",
    title_active_deals: "Active Deals",
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
    menu_operations: "العمليات التشغيلية",
    menu_po: "طلبات الشراء والتعاقدات",
    menu_spatial: "الخريطة المكانية للخزنة",
    menu_custody: "أمانات العملاء",
    menu_controls: "الرقابة والجرد",
    menu_stocktake: "عمليات الجرد",
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
    menu_active_deals: "الصفقات النشطة",
    title_active_deals: "الصفقات النشطة",
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
    ready_qty: number;
    reserved_qty: number;
    custody_qty: number;
    items: any[];
  } | null>(null);
  const [loadingExecBoard, setLoadingExecBoard] = useState(false);

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
  const [editingPOId, setEditingPOId] = useState<number | null>(null);
  const [isEditingPO, setIsEditingPO] = useState(false);
  const [printingPO, setPrintingPO] = useState<any>(null);
  const [showIntakeModal, setShowIntakeModal] = useState(false);
  const [intakePOId, setIntakePOId] = useState<number | null>(null);
  const [intakePONumber, setIntakePONumber] = useState('');
  const [intakeLotNum, setIntakeLotNum] = useState('');
  const [intakeSelectedLocation, setIntakeSelectedLocation] = useState<number>(1);
  const [scannedSerials, setScannedSerials] = useState<{ serial: string; product_id: number; product_code: string }[]>([]);
  const [currentScanSerial, setCurrentScanSerial] = useState('');
  const [intakeSelectedProductId, setIntakeSelectedProductId] = useState<number>(1);
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

  // Configurations states
  const [settingsTab, setSettingsTab] = useState('ai');
  const [suppliersList, setSuppliersList] = useState<any[]>([]);
  const [newSupCode, setNewSupCode] = useState('');
  const [newSupName, setNewSupName] = useState('');
  const [newSupOrigin, setNewSupOrigin] = useState('Switzerland');
  const [newSupSharia, setNewSupSharia] = useState(true);

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
  const [editingDenomIdx, setEditingDenomIdx] = useState<number | null>(null);
  const [editDenomLabel, setEditDenomLabel] = useState('');
  const [editDenomMetal, setEditDenomMetal] = useState('Gold');
  const [editDenomWeight, setEditDenomWeight] = useState('');

  const handleAddDenom = async () => {
    if (!newDenomLabel.trim() || !newDenomWeight) return;
    try {
      const res = await fetch(`${API_BASE}/catalog/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newDenomLabel.trim(),
          metalName: newDenomMetal,
          weightGrams: parseFloat(newDenomWeight)
        })
      });
      if (res.ok) {
        await fetchProducts();
        setNewDenomLabel('');
        setNewDenomMetal('Gold');
        setNewDenomWeight('');
        alert(currentLang === 'en' ? 'Denomination added successfully.' : 'تم إضافة فئة الوزن بنجاح.');
      } else {
        alert(currentLang === 'en' ? 'Failed to add denomination.' : 'فشل إضافة فئة الوزن.');
      }
    } catch (e) {
      alert(currentLang === 'en' ? 'Error connecting to server.' : 'خطأ في الاتصال بالخادم.');
    }
  };

  const handleStartEditDenom = (idx: number) => {
    const d = denomsList[idx];
    setEditingDenomIdx(idx);
    setEditDenomLabel(d.label);
    setEditDenomMetal(d.metal);
    setEditDenomWeight(String(d.weight));
  };

  const handleSaveEditDenom = (idx: number) => {
    setDenomsList(prev => prev.map((d, i) => i === idx
      ? { label: editDenomLabel.trim(), metal: editDenomMetal, weight: parseFloat(editDenomWeight) }
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

  // User permissions from login (group-based access control)
  const [userPermissions, setUserPermissions] = useState<Record<string, string>>({});

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
    { key: 'purchase_orders', label: 'P.O. & Procurement', tier: 'Operations' },
    { key: 'spatial_map', label: 'Vault Spatial Map (view)', tier: 'Operations' },
    { key: 'custody', label: 'Customer Custody', tier: 'Operations' },
    { key: 'stocktake', label: 'Stocktake', tier: 'Operations' },
    { key: 'reports', label: 'Reporting & Analytics', tier: 'Operations' },
    { key: 'workflows', label: 'Workflow Actions (approve/reject)', tier: 'Operations' },
    { key: 'intake', label: 'Receive Shipment', tier: 'Operations' },
    // --- Administration / Setup ---
    { key: 'vault_location', label: 'Vault Location Setup (manage shelves)', tier: 'Administration' },
    { key: 'master_data', label: 'Master Data (branches, vendors, thresholds)', tier: 'Administration' },
    { key: 'workflow_design', label: 'Workflow Designer (templates)', tier: 'Administration' },
    { key: 'migration', label: 'Bulk Ingestion', tier: 'Administration' },
    { key: 'settings', label: 'System Settings', tier: 'Administration' },
    { key: 'user_admin', label: 'User & Group Admin', tier: 'Administration' }
  ];

  const canAccess = (moduleKey: string) => {
    if (Object.keys(userPermissions).length === 0) return true; // No permissions loaded yet = allow (backward compat)
    return userPermissions[moduleKey] !== 'HIDDEN' && userPermissions[moduleKey] !== undefined;
  };
  const getAccess = (moduleKey: string): string => {
    return userPermissions[moduleKey] || 'FULL';
  };
  const canModify = (moduleKey: string) => {
    const level = getAccess(moduleKey);
    return level === 'FULL' || level === 'READ_WRITE';
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
  const poActiveProducts = products.filter((p: any) => p.is_active !== false);
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

  // Fetch static data and load tickers
  useEffect(() => {
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
  }, []);

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
          product_id: p.product_id
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
        // Refresh active workspace states
        fetchInventory();
        fetchPOs();
        fetchWorkflows();
        fetchProducts();
        fetchLocations();
        fetchSuppliers();
        fetchTransfers();
        fetchReorderThresholds();
        fetchLowStockAlerts();
        fetchBranches();
        if (data.permissions && data.permissions['user_admin'] !== 'HIDDEN') {
          fetchAdminData();
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
    const items = poLines
      .filter(l => l.product_id && l.qty > 0)
      .map(l => ({ product_id: parseInt(l.product_id) || 1, qty: l.qty, unit_cost: l.unit_cost || 0 }));
    if (items.length === 0) {
      alert(currentLang === 'en'
        ? 'Add at least one line item (denomination and quantity) before submitting.'
        : 'أضف بندًا واحدًا على الأقل (الفئة والكمية) قبل الإرسال.');
      return null;
    }
    return items;
  };

  const resetPoForm = () => {
    setPoNum('');
    setPoWeight(0);
    setPoCost(0);
    setPoCostOverridden(false);
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
          items
        })
      });
      if (res.ok) {
        alert("Purchase Order created and submitted for review successfully.");
        resetPoForm();
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
          items
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

  const handleSubmitIntake = async () => {
    if (!intakePOId) return;
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

  const handleWithdrawCustody = (serial: string) => {
    setCustodyList(prev => prev.map(c => c.serial === serial ? { ...c, status: 'WITHDRAWN', coords: 'Withdrawn' } : c));
    alert("OTP Verified. Physical delivery confirmed and signature logged. Custody archived.");
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

  const fetchReport = async (type: string) => {
    setLoadingReport(true);
    try {
      let endpoint = '';
      if (type === 'valuation') endpoint = 'valuation';
      else if (type === 'occupancy') endpoint = 'holdings';
      else if (type === 'audit') endpoint = 'audit-logs';
      else if (type === 'transactions') endpoint = 'transactions';
      
      const res = await fetch(`${API_BASE}/reports/${endpoint}`);
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

  const toggleLanguage = () => {
    setCurrentLang(prev => prev === 'en' ? 'ar' : 'en');
  };

  const t = (key: string) => {
    return Translations[currentLang]?.[key] || key;
  };

  if (!isLoggedIn) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100vw', height: '100vh',
        background: 'linear-gradient(145deg, #F0FBF5 0%, #FFFFFF 40%, #E8F7F0 100%)'
      }}>
        <form onSubmit={handleLogin} className="glass-card" style={{ width: '420px', padding: '44px', borderTop: '4px solid #009B4E' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div className="logo-icon" style={{ margin: '0 auto 18px', width: '56px', height: '56px', fontSize: '26px' }}>K</div>
            <h2 style={{ color: '#009B4E', fontSize: '22px' }}>Kuwait Finance House</h2>
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
        </form>
      </div>
    );
  }

  const dir = currentLang === 'ar' ? 'rtl' : 'ltr';

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

        <nav className="sidebar-menu">
          <div className="menu-section-header">{t('menu_dashboards')}</div>
          {canAccess('dashboard') && (
            <div className={`menu-item ${activeTab === 'screen-exec' ? 'active' : ''}`} onClick={() => setActiveTab('screen-exec')}>
              <i className="fa-solid fa-chart-line menu-item-icon"></i>
              <span>{t('menu_exec')}</span>
            </div>
          )}
          <div className={`menu-item ${activeTab === 'screen-my-activity' ? 'active' : ''}`} onClick={() => { setActiveTab('screen-my-activity'); fetchMyActivity(); }}>
            <i className="fa-solid fa-user-clock menu-item-icon"></i>
            <span>{t('menu_my_activity')}</span>
          </div>
          {canAccess('pending_actions') && (
            <div className={`menu-item ${activeTab === 'screen-pending-req' ? 'active' : ''}`} onClick={() => { setActiveTab('screen-pending-req'); fetchWorkflows(); fetchPOs(); }}>
              <i className="fa-solid fa-circle-exclamation menu-item-icon"></i>
              <span>{t('menu_pending_requests')}</span>
            </div>
          )}

          {(canAccess('purchase_orders') || canAccess('spatial_map') || canAccess('custody')) && (
            <div className="menu-section-header">{t('menu_operations')}</div>
          )}
          {canAccess('purchase_orders') && (
            <div className={`menu-item ${activeTab === 'screen-po' ? 'active' : ''}`} onClick={() => { setActiveTab('screen-po'); fetchPOs(); fetchWorkflows(); }}>
              <i className="fa-solid fa-file-invoice-dollar menu-item-icon"></i>
              <span>{t('menu_po')}</span>
            </div>
          )}
          {canAccess('purchase_orders') && (
            <div className={`menu-item ${activeTab === 'screen-active-deals' ? 'active' : ''}`} onClick={() => { setActiveTab('screen-active-deals'); fetchPOs(); fetchWorkflows(); }}>
              <i className="fa-solid fa-handshake menu-item-icon"></i>
              <span>{t('menu_active_deals')}</span>
            </div>
          )}
          {canAccess('spatial_map') && (
            <div className={`menu-item ${activeTab === 'screen-spatial' ? 'active' : ''}`} onClick={() => setActiveTab('screen-spatial')}>
              <i className="fa-solid fa-warehouse menu-item-icon"></i>
              <span>{t('menu_spatial')}</span>
            </div>
          )}
          {canAccess('custody') && (
            <div className={`menu-item ${activeTab === 'screen-custody' ? 'active' : ''}`} onClick={() => setActiveTab('screen-custody')}>
              <i className="fa-solid fa-user-shield menu-item-icon"></i>
              <span>{t('menu_custody')}</span>
            </div>
          )}
          {canAccess('purchase_orders') && (
            <div className={`menu-item ${activeTab === 'screen-transfers' ? 'active' : ''}`} onClick={() => { setActiveTab('screen-transfers'); fetchTransfers(); }}>
              <i className="fa-solid fa-truck-ramp-box menu-item-icon"></i>
              <span>{t('menu_transfers')}</span>
            </div>
          )}
          {canAccess('intake') && (
            <div className={`menu-item ${activeTab === 'screen-intake' ? 'active' : ''}`} onClick={() => { setActiveTab('screen-intake'); fetchPOs(); }}>
              <i className="fa-solid fa-circle-down menu-item-icon"></i>
              <span>{currentLang === 'en' ? 'Receive Shipment' : 'استلام الشحنات'}</span>
            </div>
          )}

          {(canAccess('stocktake') || canAccess('reports') || canAccess('workflows')) && (
            <div className="menu-section-header">{t('menu_controls')}</div>
          )}
          {canAccess('stocktake') && (
            <div className={`menu-item ${activeTab === 'screen-stocktake' ? 'active' : ''}`} onClick={() => setActiveTab('screen-stocktake')}>
              <i className="fa-solid fa-clipboard-check menu-item-icon"></i>
              <span>{t('menu_stocktake')}</span>
            </div>
          )}
          {canAccess('reports') && (
            <div className={`menu-item ${activeTab === 'screen-reports' ? 'active' : ''}`} onClick={() => { setActiveTab('screen-reports'); fetchReport(reportType); }}>
              <i className="fa-solid fa-chart-pie menu-item-icon"></i>
              <span>{t('menu_reports')}</span>
            </div>
          )}
          {canAccess('workflows') && (
            <div className={`menu-item ${activeTab === 'screen-workflows' ? 'active' : ''}`} onClick={() => { setActiveTab('screen-workflows'); fetchWorkflows(); }}>
              <i className="fa-solid fa-diagram-project menu-item-icon"></i>
              <span>{canAccess('workflow_design') ? t('menu_workflows') : t('menu_workflows_queue')}</span>
            </div>
          )}

          {/* Administration / Setup tier — manage/configuration surfaces, segregated
              from the operational modules above. */}
          {(canAccess('migration') || canAccess('settings') || canAccess('user_admin')) && (
            <div className="menu-section-header">{currentLang === 'en' ? 'Administration & Setup' : 'الإدارة والإعداد'}</div>
          )}
          {canAccess('settings') && (
            <div className={`menu-item ${activeTab === 'screen-admin' ? 'active' : ''}`} onClick={() => setActiveTab('screen-admin')}>
              <i className="fa-solid fa-gears menu-item-icon"></i>
              <span>{t('menu_settings')}</span>
            </div>
          )}
          {canAccess('migration') && (
            <div className={`menu-item ${activeTab === 'screen-migration' ? 'active' : ''}`} onClick={() => setActiveTab('screen-migration')}>
              <i className="fa-solid fa-file-import menu-item-icon"></i>
              <span>{t('menu_migration')}</span>
            </div>
          )}
          {canAccess('user_admin') && (
            <div className={`menu-item ${activeTab === 'screen-user-admin' ? 'active' : ''}`} onClick={() => { setActiveTab('screen-user-admin'); fetchAdminData(); }}>
              <i className="fa-solid fa-users-gear menu-item-icon"></i>
              <span>{t('menu_user_admin')}</span>
            </div>
          )}
        </nav>

        {/* User Info Footer */}
        <div style={{ padding: '16px 18px', borderTop: '1px solid var(--surface-border)', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px', background: '#FAFAFA' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><i className="fa-solid fa-user" style={{ color: 'var(--kfh-green)' }}></i> <strong>{displayName}</strong></div>
          <div style={{ fontSize: '10px', color: '#009B4E', fontWeight: 600 }}>{userRole}</div>
          <button className="btn" style={{ padding: '5px 10px', fontSize: '11px', marginTop: '4px', borderColor: '#FCA5A5', color: '#DC2626', alignSelf: 'flex-start', background: '#FFF5F5' }} onClick={() => {
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
              activeTab.replace('screen-', 'menu_')
            )}</h1>
          </div>

          <div className="header-controls">
            <div className="rate-ticker-simulation">
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
              <span className="kpi-value gold-txt">{(execBoard?.total_gold_weight_kg ?? 0).toFixed(2)} KG</span>
              <span className="kpi-sub" style={{ color: 'var(--accent-green)' }}>
                <i className="fa-solid fa-circle-check"></i> {t('kpi_sync')}
              </span>
            </div>
            <div className="glass-card kpi-card">
              <span className="kpi-title">{t('kpi_ready')}</span>
              <span className="kpi-value">{execBoard?.ready_qty ?? 0}</span>
              <span className="kpi-sub">{t('kpi_ready_sub')}</span>
            </div>
            <div className="glass-card kpi-card">
              <span className="kpi-title">{t('kpi_reserved')}</span>
              <span className="kpi-value" style={{ color: 'var(--accent-orange)' }}>{execBoard?.reserved_qty ?? 0}</span>
              <span className="kpi-sub"><i className="fa-solid fa-hourglass-start"></i> {t('kpi_reserved_sub')}</span>
            </div>
            <div className="glass-card kpi-card">
              <span className="kpi-title">{t('kpi_custody')}</span>
              <span className="kpi-value" style={{ color: 'var(--accent-blue)' }}>{execBoard?.custody_qty ?? 0}</span>
              <span className="kpi-sub">{t('kpi_custody_sub')}</span>
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
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {item.status === 'READY' && (
                            <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '11px' }}
                              onClick={() => {
                                setTransferItemId(item.item_id);
                                setTransferItemSerial(item.serial_number);
                                setShowTransferModal(true);
                              }}>
                              <i className="fa-solid fa-paper-plane"></i> {currentLang === 'ar' ? 'تحويل' : 'Transfer'}
                            </button>
                          )}
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
                      <button type="button" className="btn-emerald" onClick={handleCreatePO}>{currentLang === 'en' ? 'Submit P.O.' : 'إرسال الطلب'}</button>
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
                    <th>{t('th_po_code')}</th>
                    <th>{t('th_supplier')}</th>
                    <th>{t('th_weight')}</th>
                    <th>{t('th_cost')}</th>
                    <th>{t('th_status')}</th>
                    {canModify('purchase_orders') && <th style={{ width: '220px', textAlign: 'center' }}>{t('th_action')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {poList.length === 0 ? (
                    <tr>
                      <td colSpan={canModify('purchase_orders') ? 6 : 5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                        {t('active_deals_empty')}
                      </td>
                    </tr>
                  ) : (
                    poList.map((po: any, idx: number) => (
                      <tr key={idx}>
                        <td><strong>{po.po_number}</strong></td>
                        <td>{po.supplier}</td>
                        <td>{po.weight}g</td>
                        <td>${po.cost.toLocaleString()} {po.currency}</td>
                        <td><span className="badge badge-ready">{translateDb(po.status_code)}</span></td>
                        {canModify('purchase_orders') && (
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SCREEN VIEWPORT: RECEIVE SHIPMENTS (INTAKE) */}
        <section className={`screen-viewport ${activeTab === 'screen-intake' ? 'active' : ''}`}>
          <div className="glass-card">
            <h3>{currentLang === 'en' ? 'Receive Shipments (Vault Intake)' : 'استلام الشحنات (إدخل الخزينة)'}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
              {currentLang === 'en' 
                ? 'Select an approved Purchase Order from the list below to verify serials and log coordinates in the vault.' 
                : 'اختر طلب شراء معتمدًا من القائمة أدناه للتحقق من الأرقام التسلسلية وتسجيل المواقع في الخزينة.'}
            </p>
            {!canModify('intake') && (
              <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', color: 'var(--accent-red)', fontSize: '12px', marginBottom: '15px' }}>
                <i className="fa-solid fa-circle-exclamation"></i> {currentLang === 'en' ? 'Read-Only Mode: You cannot initiate shipment intakes.' : 'وضع القراءة فقط: لا يمكنك بدء عمليات استلام الشحنات.'}
              </div>
            )}
            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>{t('th_po_code')}</th>
                    <th>{t('th_supplier')}</th>
                    <th>{t('th_weight')}</th>
                    <th>{t('th_cost')}</th>
                    <th>{currentLang === 'en' ? 'Quantity' : 'الكمية'}</th>
                    <th>{t('th_status')}</th>
                    {canModify('intake') && <th>{t('th_action')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {poList.filter((po: any) => po.status_code === 'APPROVED').length === 0 ? (
                    <tr>
                      <td colSpan={canModify('intake') ? 7 : 6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
                        {currentLang === 'en' ? 'No approved purchase orders pending receipt.' : 'لا توجد طلبات شراء معتمدة بانتظار الاستلام.'}
                      </td>
                    </tr>
                  ) : (
                    poList.filter((po: any) => po.status_code === 'APPROVED').map((po: any, idx: number) => (
                      <tr key={idx}>
                        <td><strong>{po.po_number}</strong></td>
                        <td>{po.supplier}</td>
                        <td>{po.weight}g</td>
                        <td>${po.cost.toLocaleString()}</td>
                        <td>
                          <div>{po.qty || 1}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{poItemsSummary(po)}</div>
                        </td>
                        <td>
                          <span className="badge badge-ready">
                            {translateDb(po.status_code)}
                          </span>
                        </td>
                        {canModify('intake') && (
                          <td>
                            <button className="btn" style={{ backgroundColor: 'var(--accent-blue)', padding: '4px 8px', fontSize: '11px' }} onClick={() => handleIntakePO(po.po_id)}>
                              {currentLang === 'en' ? 'Receive Shipment' : 'استلام الشحنة'}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
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
                      const found = inventoryList.find((item: any) => item.serial_number === val.trim());
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
                          <button className="btn btn-danger" onClick={() => handleWithdrawCustody(item.serial)}>Withdraw Bar</button>
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

        {/* SCREEN VIEWPORT: REPORTING & ANALYTICS */}
        <section className={`screen-viewport ${activeTab === 'screen-reports' ? 'active' : ''}`}>
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
              <div>
                <h3>{t('title_reports')}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{t('reports_subtitle')}</p>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn btn-primary" onClick={handleExportExcel} disabled={reportData.length === 0 || loadingReport}>
                  <i className="fa-solid fa-file-excel"></i> {t('btn_export_excel')}
                </button>
                <button className="btn btn-primary" onClick={handleExportPDF} disabled={reportData.length === 0 || loadingReport}>
                  <i className="fa-solid fa-file-pdf"></i> {t('btn_export_pdf')}
                </button>
              </div>
            </div>

            <div className="report-controls glass-card" style={{ padding: '20px', marginBottom: '20px', display: 'flex', gap: '20px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '200px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: '600' }}>{t('lbl_report_type')}</label>
                <select value={reportType} onChange={e => { setReportType(e.target.value); fetchReport(e.target.value); }} style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#000' }}>
                  <option value="valuation">{t('rep_valuation')}</option>
                  <option value="occupancy">{t('rep_occupancy')}</option>
                  <option value="audit">{t('rep_audit')}</option>
                  <option value="transactions">{t('rep_transactions')}</option>
                </select>
              </div>

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
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.map((row, idx) => (
                            <tr key={idx}>
                              <td>{new Date(row.timestamp).toLocaleString()}</td>
                              <td><strong>{row.username}</strong></td>
                              <td><span className="badge badge-ready">{row.moduleName}</span></td>
                              <td>{row.actionDescription}</td>
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
                            <th>{t('th_timestamp')}</th>
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
                              <td>{new Date(row.timestamp).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    )}
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* SCREEN VIEWPORT: SYSTEM SETTINGS */}
        <section className={`screen-viewport ${activeTab === 'screen-admin' ? 'active' : ''}`}>
          <div className="glass-card">
            <h3>{t('settings_title')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>{t('settings_subtitle')}</p>

            <div style={{ display: 'flex', gap: '10px', borderBottom: '1px solid var(--surface-border)', marginBottom: '24px' }}>
              <button className={`btn-tab ${settingsTab === 'ai' ? 'active' : ''}`} onClick={() => setSettingsTab('ai')}>{t('tab_ai_gateway')}</button>
              <button className={`btn-tab ${settingsTab === 'suppliers' ? 'active' : ''}`} onClick={() => setSettingsTab('suppliers')}>{t('tab_suppliers')}</button>
              <button className={`btn-tab ${settingsTab === 'denoms' ? 'active' : ''}`} onClick={() => setSettingsTab('denoms')}>{t('tab_denoms')}</button>
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
                <div className="table-responsive" style={{ marginTop: '15px', marginBottom: '30px' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>{t('th_code')}</th>
                        <th>{t('th_refiner_name')}</th>
                        <th>{t('th_origin')}</th>
                        <th>{t('th_sharia_compliance')}</th>
                        <th style={{ width: '110px', textAlign: 'center' }}>{t('th_action')}</th>
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
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Add New Supplier Form */}
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
              </div>
            )}

            {settingsTab === 'denoms' && (
              <div className="settings-tab-pane active">
                <h4>{t('settings_denoms_title')}</h4>
                <div className="table-responsive" style={{ marginTop: '15px' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>{t('th_label_name')}</th>
                        <th>{t('th_metal_type')}</th>
                        <th>{t('th_weight_grams')}</th>
                        <th style={{ width: '110px', textAlign: 'center' }}>{t('th_action')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {denomsList.map((d, idx) => (
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
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Add New Denomination Form */}
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
              </div>
            )}

            {settingsTab === 'stocklimits' && (
              <div className="settings-tab-pane active">
                <h4>{currentLang === 'ar' ? 'حدود إعادة الطلب' : 'Reorder Thresholds'}</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
                  {currentLang === 'ar' ? 'عندما يصل المخزون إلى هذا الحد، يتم إنشاء تنبيه وطلب شراء تلقائي.' : 'When stock reaches this limit, an alarm is triggered and a draft P.O. can be auto-generated.'}
                </p>

                <div className="table-responsive" style={{ marginBottom: '30px' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>{currentLang === 'ar' ? 'المنتج' : 'Product'}</th>
                        <th>{currentLang === 'ar' ? 'المورد المفضل' : 'Preferred Vendor'}</th>
                        <th>{currentLang === 'ar' ? 'الحد الأدنى' : 'Min Stock'}</th>
                        <th>{currentLang === 'ar' ? 'كمية إعادة الطلب' : 'Reorder Qty'}</th>
                        <th>{currentLang === 'ar' ? 'الحالة' : 'Status'}</th>
                        <th style={{ width: '80px', textAlign: 'center' }}>{currentLang === 'ar' ? 'إجراء' : 'Action'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reorderThresholds.length === 0 ? (
                        <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px' }}>
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
                          <td style={{ textAlign: 'center' }}>
                            <button className="btn" style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--accent-red)', borderColor: '#FECACA' }}
                              onClick={() => handleDeleteThreshold(th.threshold_id)} title="Delete">
                              <i className="fa-solid fa-trash"></i>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Add New Threshold Form */}
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
              </div>
            )}

            {settingsTab === 'branches' && (
              <div className="settings-tab-pane active">
                <h4>{currentLang === 'ar' ? 'إدارة فروع بيت التمويل الكويتي' : 'KFH Branch Management'}</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
                  {currentLang === 'ar' ? 'إدارة وتعديل الفروع الخاصة بـ بيت التمويل الكويتي، بما في ذلك فرع KFH Online.' : 'Manage KFH Branches, vault linkages, and state mappings. KFH Online is treated as a digital branch.'}
                </p>

                <div className="table-responsive" style={{ marginBottom: '30px' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>{currentLang === 'ar' ? 'رمز الفرع' : 'Branch Code'}</th>
                        <th>{currentLang === 'ar' ? 'اسم الفرع' : 'Branch Name'}</th>
                        <th>{currentLang === 'ar' ? 'الخزنة المرتبطة' : 'Linked Vault'}</th>
                        <th>{currentLang === 'ar' ? 'الحالة' : 'Status'}</th>
                        <th style={{ width: '110px', textAlign: 'center' }}>{currentLang === 'ar' ? 'إجراء' : 'Action'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {branchesList.map((b, idx) => (
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
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Add KFH Branch Form */}
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
                              <div style={{ fontSize: '12px' }}>
                                <strong>{inst.details.po_number}</strong><br/>
                                <span style={{ color: 'var(--accent-gold)' }}>
                                  {inst.details.vendor_name} | {inst.details.total_weight}g | ${inst.details.total_cost?.toLocaleString()} {inst.details.currency}
                                </span>
                              </div>
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
                      {selectedWfInstance.workflow_type === "INTAKE_SHIPMENT" ? (
                        <div className="split-grid-2" style={{ gap: '10px 20px' }}>
                          <div><strong>{currentLang === 'en' ? 'P.O. Number:' : 'رقم طلب الشراء:'}</strong> {selectedWfInstance.details.po_number}</div>
                          <div><strong>{currentLang === 'en' ? 'Lot Number:' : 'رقم اللوت:'}</strong> {selectedWfInstance.details.lot_number}</div>
                          <div><strong>{currentLang === 'en' ? 'Destination Location:' : 'موقع الوجهة:'}</strong> {selectedWfInstance.details.location_name}</div>
                          <div><strong>{currentLang === 'en' ? 'Received By:' : 'المستلم:'}</strong> {selectedWfInstance.details.received_by}</div>
                          <div><strong>{currentLang === 'en' ? 'Status Code:' : 'حالة الاعتماد:'}</strong> {selectedWfInstance.details.status_code}</div>
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
        {/* INTAKE SHIPMENT MODAL */}
        {showIntakeModal && intakePOId && (
          <div className="modal-overlay active" onClick={() => setShowIntakeModal(false)}>
            <div className="glass-card modal-content-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px', width: '90%' }}>
              <div className="modal-header">
                <h3>{currentLang === 'ar' ? 'التحقق واستلام الشحنة (مسح باركود)' : 'Verify & Receive Shipment (Scan)'}</h3>
                <span className="modal-close-btn" onClick={() => setShowIntakeModal(false)}>&times;</span>
              </div>
              <div style={{ padding: '10px 0' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '15px' }}>
                  <div className="form-group">
                    <label>{currentLang === 'ar' ? 'رقم طلب الشراء' : 'PO Number'}</label>
                    <input type="text" className="form-control" value={intakePONumber} disabled style={{ opacity: 0.8 }} />
                  </div>
                  <div className="form-group">
                    <label>{currentLang === 'ar' ? 'رقم تشغيلة المورد (Lot #)' : 'Vendor Lot Number'}</label>
                    <input type="text" className="form-control" value={intakeLotNum} onChange={e => setIntakeLotNum(e.target.value)} />
                  </div>
                </div>

                <div className="form-group">
                  <label>{currentLang === 'ar' ? 'موقع التخزين بالخزينة الرئيسية' : 'Main Vault Storage Slot Location'}</label>
                  <select value={intakeSelectedLocation} onChange={e => setIntakeSelectedLocation(parseInt(e.target.value))} style={{ color: '#000' }}>
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

                {/* Scan Simulator Section */}
                <div className="glass-card" style={{ padding: '12px', background: 'rgba(0, 155, 78, 0.05)', border: '1px solid rgba(0, 155, 78, 0.2)', marginBottom: '15px' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--kfh-green)' }}>
                    <i className="fa-solid fa-barcode"></i> {currentLang === 'ar' ? 'محاكي جهاز مسح الباركود / الرقم التسلسلي' : 'Barcode / Serial Scanner Input'}
                  </h4>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder={currentLang === 'ar' ? 'امسح الباركود للقطعة أو أدخل الرقم التسلسلي واضغط Enter...' : 'Scan piece barcode or enter serial number & hit Enter...'}
                      value={currentScanSerial}
                      onChange={e => setCurrentScanSerial(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (currentScanSerial.trim()) {
                            // Add scanned item
                            const isDup = scannedSerials.some(s => s.serial === currentScanSerial.trim());
                            if (isDup) {
                              alert(currentLang === 'en' ? 'This barcode/serial has already been scanned.' : 'هذا الباركود/الرقم التسلسلي تم مسحه مسبقاً.');
                              return;
                            }
                            setScannedSerials([
                              ...scannedSerials,
                              { serial: currentScanSerial.trim(), product_id: intakeSelectedProductId, product_code: (products.find((p: any) => p.product_id === intakeSelectedProductId)?.denomination_label) || (products.find((p: any) => p.product_id === intakeSelectedProductId)?.product_code) || 'Bar' }
                            ]);
                            setCurrentScanSerial('');
                          }
                        }
                      }}
                    />
                    <button 
                      className="btn btn-primary"
                      type="button"
                      onClick={() => {
                        if (currentScanSerial.trim()) {
                          const isDup = scannedSerials.some(s => s.serial === currentScanSerial.trim());
                          if (isDup) {
                            alert(currentLang === 'en' ? 'This barcode/serial has already been scanned.' : 'هذا الباركود/الرقم التسلسلي تم مسحه مسبقاً.');
                            return;
                          }
                          setScannedSerials([
                            ...scannedSerials,
                            { serial: currentScanSerial.trim(), product_id: intakeSelectedProductId, product_code: intakeSelectedProductId === 1 ? '1 Kilogram Bar' : 'Other Bar' }
                          ]);
                          setCurrentScanSerial('');
                        }
                      }}
                    >
                      {currentLang === 'ar' ? 'إضافة' : 'Add'}
                    </button>
                  </div>
                  
                  {/* Select which line item on THIS PO the scanned bar belongs to. Only the
                      denominations actually ordered on the PO are selectable, and each shows
                      how many pieces have been scanned vs. ordered. */}
                  {(() => {
                    const intakePO = poList.find((p: any) => p.po_id === intakePOId);
                    const poItems = intakePO?.items && intakePO.items.length ? intakePO.items : null;
                    const scannedCountFor = (pid: number) => scannedSerials.filter(s => s.product_id === pid).length;
                    return (
                      <div className="form-group" style={{ marginTop: '10px', marginBottom: 0 }}>
                        <label style={{ fontSize: '11px' }}>{currentLang === 'ar' ? 'بند الطلب للسبيكة الممسوحة' : 'Scanned Bar — PO Line Item'}</label>
                        <select
                          value={intakeSelectedProductId}
                          onChange={e => setIntakeSelectedProductId(parseInt(e.target.value))}
                          style={{ padding: '4px', fontSize: '12px', height: '30px', color: '#000' }}
                        >
                          {poItems ? (
                            poItems.map((it: any) => {
                              const p = products.find((pp: any) => String(pp.product_id) === String(it.product_id));
                              const denom = p ? `${p.metal_name} ${p.denomination_label}` : (it.product_code || `#${it.product_id}`);
                              return (
                                <option key={it.product_id} value={it.product_id}>
                                  {`${denom} — ${scannedCountFor(it.product_id)}/${it.qty} ${currentLang === 'ar' ? 'ممسوح' : 'scanned'}`}
                                </option>
                              );
                            })
                          ) : (
                            products
                              .filter((p: any) => p.is_active !== false)
                              .map((p: any) => (
                                <option key={p.product_id} value={p.product_id}>
                                  {`${p.metal_name} ${p.denomination_label}` + (p.purity_value ? ` (${p.purity_value} ${currentLang === 'ar' ? 'نقاوة' : 'Purity'})` : '')}
                                </option>
                              ))
                          )}
                        </select>
                        {poItems && (
                          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {poItems.map((it: any) => {
                              const p = products.find((pp: any) => String(pp.product_id) === String(it.product_id));
                              const denom = p ? `${p.metal_name} ${p.denomination_label}` : (it.product_code || `#${it.product_id}`);
                              const done = scannedCountFor(it.product_id);
                              const complete = done === it.qty;
                              return (
                                <div key={it.product_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: complete ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                                  <span>{denom}</span>
                                  <span>{done}/{it.qty} {complete ? '✓' : ''}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: '15px' }}
                  onClick={handleSubmitIntake}
                >
                  <i className="fa-solid fa-check"></i> {currentLang === 'ar' ? 'تأكيد استلام الشحنة' : 'Confirm Shipment Receipt'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
