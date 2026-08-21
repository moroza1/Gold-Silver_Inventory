import { useState, useEffect } from 'react';

const rawApiUrl = (import.meta as any).env?.VITE_API_URL;
const normalizeApiBase = (url?: string) => {
  if (!url) return null;
  const clean = url.replace(/\/+$/, '');
  return clean.endsWith('/api') ? clean : `${clean}/api`;
};

const API_BASE = normalizeApiBase(rawApiUrl) || (
  typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? (window.location.port === '80' || window.location.port === '8080' ? `http://${window.location.hostname}:8080/api` : 'http://localhost:5000/api')
    : 'https://api.aisoftwares.cloud/api'
);

interface Customer {
  customerId: number;
  civilId: string;
  customerName: string;
  mobileNumber: string;
  email?: string;
  isActive: boolean;
  accountNumber: string;
  currency: string;
  cashBalance: number;
  totalGoldGrams: number;
  holdingsCount: number;
  bars: CustomerBar[];
}

interface CustomerBar {
  holdingId: number;
  itemId: number;
  serialNumber: string;
  weightGrams: number;
  denomination: string;
  purity: string;
  status: string;
  vaultLocation: string;
  allocationDate: string;
  giftTag?: string;
}

interface AvailableDenomination {
  denomination: string;
  weightGrams: number;
  availableQuantity: number;
  totalWeightAvailable: number;
  bars: {
    serialNumber: string;
    vaultLocation: string;
    pmims_reference: string;
    weight: number;
  }[];
}

interface LivePrice {
  metal: string;
  pricePerGram: number;
  bidPrice: number;
  askPrice: number;
  source: string;
  currency: string;
  lastUpdated: string;
}

interface GfsAppProps {
  onBackToPmims?: () => void;
  initialLang?: string;
}

export default function GfsApp({ onBackToPmims, initialLang = 'en' }: GfsAppProps) {
  const [lang, setLang] = useState<'en' | 'ar'>(initialLang as 'en' | 'ar');
  const [topTab, setTopTab] = useState<'accounts' | 'deposits' | 'plans' | 'holds' | 'gold' | 'ibans' | 'children'>('gold');
  const [activeView, setActiveView] = useState<'profile' | 'buy' | 'sell' | 'gift' | 'branch-delivery' | 'home-delivery' | 'scanner' | 'sync'>('profile');

  // Sidebar Accordion states
  const [openAccordions, setOpenAccordions] = useState<{ [key: string]: boolean }>({
    accountServices: false,
    goldAccount: true,
    cards: false,
    transfers: false,
    cardless: false,
    standingOrders: false,
    finance: false
  });

  const toggleAccordion = (key: string) => {
    setOpenAccordions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // State
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [priceFeed, setPriceFeed] = useState<LivePrice | null>(null);
  const [availableDenoms, setAvailableDenoms] = useState<AvailableDenomination[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(false);

  // Telemetry HUD / PMIMS Impact
  const [pmimsImpact, setPmimsImpact] = useState<{
    action: string;
    impactText: string;
    details: string;
    timestamp: string;
  } | null>(null);

  // Buy State
  const [selectedDenom, setSelectedDenom] = useState<AvailableDenomination | null>(null);
  const [buyQuantity, setBuyQuantity] = useState<number>(1);
  const [buying, setBuying] = useState(false);
  const [buySuccessModal, setBuySuccessModal] = useState<any>(null);

  // Sell State
  const [selectedBarsToSell, setSelectedBarsToSell] = useState<number[]>([]);
  const [selling, setSelling] = useState(false);
  const [sellSuccessModal, setSellSuccessModal] = useState<any>(null);

  // Gift State
  const [selectedBarsToGift, setSelectedBarsToGift] = useState<number[]>([]);
  const [recipientCustomerId, setRecipientCustomerId] = useState<string>('');
  const [giftOccasion, setGiftOccasion] = useState<string>('Eid Mubarak');
  const [giftMessage, setGiftMessage] = useState<string>('May this precious gift bring prosperity and happiness!');
  const [gifting, setGifting] = useState(false);
  const [giftSuccessModal, setGiftSuccessModal] = useState<any>(null);

  // Branch Delivery State
  const [selectedBarForBranchDelivery, setSelectedBarForBranchDelivery] = useState<number | null>(null);
  const [destBranchId, setDestBranchId] = useState<number>(2);
  const [routeNotes, setRouteNotes] = useState<string>('Standard armored transit via Secure Transport Co.');
  const [branchDeliveryRequests, setBranchDeliveryRequests] = useState<any[]>([]);
  const [submittingBranchDelivery, setSubmittingBranchDelivery] = useState(false);

  // Home Delivery State
  const [selectedBarForHomeDelivery, setSelectedBarForHomeDelivery] = useState<number | null>(null);
  const [hdGovernorate, setHdGovernorate] = useState('Capital Governorate (Al Asimah)');
  const [hdArea, setHdArea] = useState('Shuwaikh Administrative');
  const [hdBlock, setHdBlock] = useState('1');
  const [hdStreet, setHdStreet] = useState('Abdullah Al-Mubarak St');
  const [hdBuilding, setHdBuilding] = useState('KFH Headquarters Tower');
  const [hdFloor, setHdFloor] = useState('14');
  const [hdInstructions, setHdInstructions] = useState('Call 10 mins prior to arrival. PACI biometric ID verification required.');
  const [homeDeliveryRequests, setHomeDeliveryRequests] = useState<any[]>([]);
  const [submittingHomeDelivery, setSubmittingHomeDelivery] = useState(false);
  const [hdSuccessModal, setHdSuccessModal] = useState<any>(null);

  // Scanner State
  const [scanQuery, setScanQuery] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanning, setScanning] = useState(false);

  // Sync State
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);

  // Notification modal state
  const [showMailModal, setShowMailModal] = useState(false);

  // Translation Dictionary
  const t = {
    en: {
      gfs_title: "KFH Online Banking",
      gfs_subtitle: "Precious Metals & Gold Custody Portal",
      back_to_pmims: "Switch to PMIMS Vault Ledger",
      active_customer: "Active Customer",
      cash_balance: "Cash Account Balance",
      gold_holdings: "Physical Gold in Custody",
      market_val: "Est. Market Value",
      bid_rate: "KFH Buyback (Bid)",
      ask_rate: "KFH Selling (Ask)",
      view_profile: "Gold Balance & Custody",
      view_statement: "Gold Account Statement",
      view_buy: "Buy Gold",
      view_sell: "Sell Gold",
      view_gift: "Gift Gold Transfer",
      view_branch_del: "Branch Delivery",
      view_home_del: "Home Delivery",
      view_scanner: "Live Bar Scanner",
      view_sync: "EOD Settlement",
      owned_bars: "Physical Gold Bars in KFH Main Vault Custody",
      no_bars: "No gold bars currently held in custody. Buy gold to start building your precious metals portfolio!",
      serial_num: "Serial Number",
      denomination: "Denomination",
      weight: "Weight",
      purity: "Purity",
      vault_loc: "Vault Location",
      allocated_at: "Allocated Date",
      actions: "Actions",
      buy_btn: "Confirm Purchase & Allocate",
      sell_btn: "Confirm Sale & Credit Account",
      gift_btn: "Send as Gift Card",
      request_delivery: "Request Delivery",
      qty: "Quantity",
      total_cost: "Total Amount",
      currency: "KWD",
      payout: "Total Payout",
      recipient: "Gift Recipient",
      occasion: "Occasion",
      message: "Personal Message / Dedication",
      preview_gift: "Preview Digital Gift Certificate",
      destination_branch: "Destination KFH Branch",
      dispatch_request: "Submit Branch Delivery Request",
      home_address: "PACI Kuwait Home Address",
      governorate: "Governorate",
      area: "Area",
      block: "Block",
      street: "Street",
      building: "Building / House",
      floor: "Floor / Flat",
      instructions: "Special Delivery Instructions",
      submit_hd: "Submit Home Delivery Request",
      otp_code: "Verification Handover OTP",
      hud_title: "PMIMS Live Telemetry",
      sync_now: "Run GFS EOD Sync",
      home: "Home",
      mail: "Mail",
      settings: "Settings",
      logout: "Logout",
      last_login: "Last Login : 20/08/2026 09:03:53 PM",
      tab_banking_accounts: "Banking Accounts",
      tab_investment_deposits: "Investment Deposits",
      tab_investment_plans: "Investment Plans",
      tab_holds: "Holds",
      tab_gold_account: "Gold Account",
      tab_ibans: "IBANs",
      tab_my_children: "My Children",
      th_account_no: "Account Number",
      th_account_type: "Account Type",
      th_currency: "Currency",
      th_total_balance: "Total Balance",
      th_available_balance: "Available Balance",
      th_holds_val: "Holds",
      th_status: "Status",
      sec_account_services: "Account Services",
      sec_gold_account: "Gold Account",
      sec_cards: "Cards",
      sec_transfers: "Transfers & Payments",
      sec_cardless: "Cardless",
      sec_standing_orders: "Standing Orders",
      sec_finance_services: "Finance Services"
    },
    ar: {
      gfs_title: "بيتك أونلاين - الخدمات المصرفية",
      gfs_subtitle: "بوابة تداول وحفظ المعادن الثمينة والذهب",
      back_to_pmims: "العودة إلى نظام الخزينة الرئيسي (PMIMS)",
      active_customer: "العميل الحالي",
      cash_balance: "رصيد الحساب النقدي",
      gold_holdings: "أمانات الذهب الفعلي بالخزينة",
      market_val: "القيمة السوقية التقديرية",
      bid_rate: "سعر الشراء من العميل (Bid)",
      ask_rate: "سعر البيع للعميل (Ask)",
      view_profile: "رصيد وأمانات الذهب",
      view_statement: "كشف حساب الذهب",
      view_buy: "شراء الذهب",
      view_sell: "بيع الذهب",
      view_gift: "إهداء ذهب",
      view_branch_del: "استلام من الفرع",
      view_home_del: "توصيل للمنزل",
      view_scanner: "مسح باركود السبائك",
      view_sync: "مطابقة نهاية اليوم",
      owned_bars: "سبائك الذهب المادية المحفوظة في خزينة بيتك المركزية",
      no_bars: "لا توجد سبائك ذهب في أماناتك حالياً. ابدأ الشراء الآن لبناء محفظتك من المعادن الثمينة!",
      serial_num: "الرقم التسلسلي",
      denomination: "فئة السبيكة",
      weight: "الوزن",
      purity: "درجة النقاء",
      vault_loc: "إحداثيات الخزنة",
      allocated_at: "تاريخ التخصيص",
      actions: "الإجراءات",
      buy_btn: "تأكيد الشراء والتخصيص المادي",
      sell_btn: "تأكيد البيع وإيداع المبلغ",
      gift_btn: "إرسال كبطاقة هدية فاخرة",
      request_delivery: "طلب تسليم",
      qty: "الكمية",
      total_cost: "إجمالي المبلغ",
      currency: "د.ك",
      payout: "صافي المبلغ المستحق",
      recipient: "العميل المستلم للهدية",
      occasion: "المناسبة",
      message: "الإهداء والرسالة الشخصية",
      preview_gift: "معاينة وثيقة الإهداء الرقمية",
      destination_branch: "فرع بيتك المستلم",
      dispatch_request: "إرسال طلب التحويل للفرع",
      home_address: "عنوان التوصيل المعتمد (PACI)",
      governorate: "المحافظة",
      area: "المنطقة",
      block: "القطعة",
      street: "الشارع",
      building: "المبنى / المنزل",
      floor: "الدور / الشقة",
      instructions: "ملاحظات التوصيل",
      submit_hd: "تأكيد طلب التوصيل الآمن",
      otp_code: "رمز التحقق والتسليم OTP",
      hud_title: "بيانات نظام الخزينة المباشر",
      sync_now: "تنفيذ مطابقة GFS مع الخزينة",
      home: "الرئيسية",
      mail: "البريد",
      settings: "الإعدادات",
      logout: "تسجيل الخروج",
      last_login: "آخر تسجيل دخول : 20/08/2026 09:03:53 م",
      tab_banking_accounts: "الحسابات المصرفية",
      tab_investment_deposits: "الودائع الاستثمارية",
      tab_investment_plans: "الخطط الاستثمارية",
      tab_holds: "المبالغ المحجوزة",
      tab_gold_account: "حساب الذهب",
      tab_ibans: "أرقام الآيبان IBAN",
      tab_my_children: "حسابات الأبناء",
      th_account_no: "رقم الحساب",
      th_account_type: "نوع الحساب",
      th_currency: "العملة",
      th_total_balance: "الرصيد الإجمالي",
      th_available_balance: "الرصيد المتوفر",
      th_holds_val: "الحجوزات",
      th_status: "الحالة",
      sec_account_services: "خدمات الحسابات",
      sec_gold_account: "حساب الذهب",
      sec_cards: "البطاقات",
      sec_transfers: "التحويلات والمدفوعات",
      sec_cardless: "السحب بدون بطاقة",
      sec_standing_orders: "الأوامر الدائمة",
      sec_finance_services: "الخدمات التمويلية"
    }
  }[lang];

  // Load Data on Mount
  useEffect(() => {
    fetchCustomers();
    fetchPriceFeed();
    fetchAvailableInventory();
    fetchDeliveries();
  }, []);

  const fetchCustomers = async () => {
    setLoadingCustomers(true);
    try {
      const res = await fetch(`${API_BASE}/gfs/customers`);
      if (res.ok) {
        const data = await res.json();
        setCustomers(data);
        if (data.length > 0) {
          setSelectedCustomer(data[0]);
        }
      }
    } catch (e) {
      console.error('Failed to load customers', e);
    } finally {
      setLoadingCustomers(false);
    }
  };

  const fetchPriceFeed = async () => {
    try {
      const res = await fetch(`${API_BASE}/gfs/rates/live`);
      if (res.ok) {
        setPriceFeed(await res.json());
      }
    } catch (e) {
      console.error('Failed to load live price feed', e);
    }
  };

  const fetchAvailableInventory = async () => {
    setLoadingInventory(true);
    try {
      const res = await fetch(`${API_BASE}/gfs/inventory/available`);
      if (res.ok) {
        const data = await res.json();
        setAvailableDenoms(data);
        if (data.length > 0) {
          setSelectedDenom(data[0]);
        }
      }
    } catch (e) {
      console.error('Failed to load available gold bars', e);
    } finally {
      setLoadingInventory(false);
    }
  };

  const fetchDeliveries = async () => {
    try {
      const [bRes, hRes] = await Promise.all([
        fetch(`${API_BASE}/gfs/deliveries/branch`),
        fetch(`${API_BASE}/gfs/deliveries/home`)
      ]);
      if (bRes.ok) setBranchDeliveryRequests(await bRes.json());
      if (hRes.ok) setHomeDeliveryRequests(await hRes.json());
    } catch (e) {
      console.error('Failed to load delivery logs', e);
    }
  };

  const triggerImpact = (action: string, impactText: string, details: string) => {
    setPmimsImpact({
      action,
      impactText,
      details,
      timestamp: new Date().toLocaleTimeString()
    });
    setTimeout(() => {
      setPmimsImpact(null);
    }, 12000);
  };

  // 1. Buy Gold Handler
  const handleBuyGold = async () => {
    if (!selectedCustomer || !selectedDenom) return;
    if (buyQuantity < 1) return alert('Please enter a valid quantity');

    setBuying(true);
    try {
      const res = await fetch(`${API_BASE}/gfs/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomer.customerId,
          denomination: selectedDenom.denomination,
          quantity: buyQuantity
        })
      });

      const data = await res.json();
      if (res.ok) {
        setBuySuccessModal(data);
        triggerImpact(
          'GFS_BUY_ALLOCATE',
          `Allocated ${data.purchasedBars?.length || buyQuantity} Gold Bar(s) (${selectedDenom.denomination}) to Customer Account #${selectedCustomer.accountNumber}`,
          `Pessimistic reservation lock transferred bar serial(s) from PMIMS unallocated pool to client sub-ledger custody coordinate.`
        );
        fetchCustomers();
        fetchAvailableInventory();
      } else {
        alert(data.error || 'Failed to complete purchase');
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBuying(false);
    }
  };

  // 2. Sell Gold Handler
  const handleSellGold = async () => {
    if (!selectedCustomer || selectedBarsToSell.length === 0) return;

    setSelling(true);
    try {
      const res = await fetch(`${API_BASE}/gfs/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomer.customerId,
          barIds: selectedBarsToSell
        })
      });

      const data = await res.json();
      if (res.ok) {
        setSellSuccessModal(data);
        triggerImpact(
          'GFS_SELL_DEALLOCATE',
          `Deallocated ${selectedBarsToSell.length} bar(s). Liquidated and credited ${(data.totalPayout || 0).toLocaleString()} KWD to customer cash account.`,
          `PMIMS GL Ledger credited Account #${selectedCustomer.accountNumber} and returned serial(s) to Treasury unencumbered physical stock.`
        );
        setSelectedBarsToSell([]);
        fetchCustomers();
        fetchAvailableInventory();
      } else {
        alert(data.error || 'Failed to sell bars');
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSelling(false);
    }
  };

  // 3. Gift Gold Handler
  const handleGiftGold = async () => {
    if (!selectedCustomer || selectedBarsToGift.length === 0 || !recipientCustomerId) {
      return alert('Please select bar(s) and enter a recipient customer ID / Civil ID.');
    }

    setGifting(true);
    try {
      const res = await fetch(`${API_BASE}/gfs/gift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderCustomerId: selectedCustomer.customerId,
          recipientCivilOrCustId: recipientCustomerId,
          barIds: selectedBarsToGift,
          occasion: giftOccasion,
          message: giftMessage
        })
      });

      const data = await res.json();
      if (res.ok) {
        setGiftSuccessModal(data);
        triggerImpact(
          'GFS_GIFT_TRANSFER',
          `Transferred ${selectedBarsToGift.length} gold bar(s) from ${selectedCustomer.customerName} to Recipient #${recipientCustomerId}`,
          `Custody ownership record re-assigned instantly in PMIMS database ledger without physical vault movement.`
        );
        setSelectedBarsToGift([]);
        setRecipientCustomerId('');
        fetchCustomers();
      } else {
        alert(data.error || 'Gift transfer failed');
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setGifting(false);
    }
  };

  // 4. Branch Delivery Request
  const handleBranchDelivery = async () => {
    if (!selectedCustomer || !selectedBarForBranchDelivery) return;

    setSubmittingBranchDelivery(true);
    try {
      const res = await fetch(`${API_BASE}/gfs/deliveries/branch/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomer.customerId,
          holdingId: selectedBarForBranchDelivery,
          destinationBranchId: destBranchId,
          notes: routeNotes
        })
      });

      const data = await res.json();
      if (res.ok) {
        alert(`✓ Branch Delivery Dispatched! Tracking Code: ${data.transferCode || 'TRF-BR-9901'}`);
        triggerImpact(
          'GFS_BRANCH_DISPATCH',
          `Generated secure armored transfer order for bar serial ${data.serialNumber || ''} to Branch #${destBranchId}`,
          `PMIMS transit log created with Maker-Checker dual authorization and GPS custody tracking.`
        );
        setSelectedBarForBranchDelivery(null);
        fetchCustomers();
        fetchDeliveries();
      } else {
        alert(data.error || 'Failed to dispatch branch delivery');
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmittingBranchDelivery(false);
    }
  };

  // 5. Home Delivery Request
  const handleHomeDelivery = async () => {
    if (!selectedCustomer || !selectedBarForHomeDelivery) return;

    setSubmittingHomeDelivery(true);
    try {
      const res = await fetch(`${API_BASE}/gfs/deliveries/home/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomer.customerId,
          holdingId: selectedBarForHomeDelivery,
          address: {
            governorate: hdGovernorate,
            area: hdArea,
            block: hdBlock,
            street: hdStreet,
            building: hdBuilding,
            floor: hdFloor,
            instructions: hdInstructions
          }
        })
      });

      const data = await res.json();
      if (res.ok) {
        setHdSuccessModal(data);
        triggerImpact(
          'GFS_HOME_DELIVERY_DISPATCH',
          `Dispatched Home Delivery Order #${data.deliveryId || 'HD-9821'} via KFH Armored Logistics`,
          `Generated 6-digit PACI Handover OTP [${data.otp || '592810'}] for client identity verification.`
        );
        setSelectedBarForHomeDelivery(null);
        fetchCustomers();
        fetchDeliveries();
      } else {
        alert(data.error || 'Home delivery request failed');
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmittingHomeDelivery(false);
    }
  };

  // 6. Live Bar Scanner
  const handleScanQr = async () => {
    if (!scanQuery.trim()) return;
    setScanning(true);
    try {
      const res = await fetch(`${API_BASE}/gfs/scanner/verify?serial=${encodeURIComponent(scanQuery.trim())}`);
      const data = await res.json();
      if (res.ok) {
        setScanResult(data);
        triggerImpact(
          'GFS_BAR_VERIFICATION',
          `Scanned Serial ${data.serialNumber || scanQuery} — Verified LBMA Refiner Origin & Coordinate: ${data.vaultLocation || 'Main Vault'}`,
          `Cryptographic signature verified against PMIMS ledger timestamp and audit trail.`
        );
      } else {
        setScanResult({ error: data.error || 'Bar serial not found in verified registry.' });
      }
    } catch (e: any) {
      setScanResult({ error: e.message });
    } finally {
      setScanning(false);
    }
  };

  // 7. EOD Sync
  const handleEodSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/gfs/sync-eod`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        alert(`✓ GFS EOD Sync Completed! Total items synced: ${data.totalItemsSynced}`);
        triggerImpact(
          'GFS_EOD_SYNC',
          `Synced ${data.totalItemsSynced} inventory items across GFS & PMIMS`,
          `Reconciled all customer account balances, average costs, and physical bar coordinates.`
        );
        const logRes = await fetch(`${API_BASE}/gfs/sync-logs`);
        if (logRes.ok) setSyncLogs(await logRes.json());
      } else {
        alert(data.error || 'Sync failed');
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const kwdRate = priceFeed ? (priceFeed.bidPrice * 0.308) : 68.50;

  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      backgroundColor: '#EAEAEA',
      color: '#1A202C',
      fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif",
      direction: lang === 'ar' ? 'rtl' : 'ltr',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* 1. TOP HEADER (AUTHENTIC KFH ONLINE HEADER) */}
      <header style={{
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #D1DCD4',
        padding: '12px 24px 8px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
      }}>
        {/* Left: KFH Emblem & Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* KFH Green Emblem */}
            <svg width="42" height="42" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M50 8L60 28L82 20L74 42L95 50L74 58L82 80L60 72L50 92L40 72L18 80L26 58L5 50L26 42L18 20L40 28L50 8Z" fill="#009B4E" stroke="#005A3E" strokeWidth="2"/>
              <circle cx="50" cy="50" r="16" fill="#FFFFFF" />
              <path d="M43 40L57 50L43 60Z" fill="#005A3E" />
            </svg>
            <div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: '#005A3E', letterSpacing: '-0.2px', lineHeight: 1.1 }}>
                بيت التمويل الكويتي
              </div>
              <div style={{ fontSize: '15px', fontWeight: '800', color: '#009B4E', letterSpacing: '0.8px' }}>
                KFH
              </div>
            </div>
          </div>
        </div>

        {/* Center / Right: User Greeting, Last Login & Action Icons */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: '12px', color: '#4B5563' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', color: '#111827' }}>
              <span style={{ display: 'inline-block', width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#009B4E' }}></span>
              {selectedCustomer?.customerName?.toUpperCase() || 'MOHAMED SALEM AL-AJMI'}
            </div>
            <div>
              {t.last_login}
            </div>
          </div>

          {/* Quick Action Navigation Bar (Home, Mail, Settings, Logout, Lang Switcher) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '4px' }}>
            <button
              onClick={() => { setTopTab('gold'); setActiveView('profile'); }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
              title={t.home}
            >
              <i className="fa-solid fa-house" style={{ fontSize: '16px', color: '#D97706' }}></i>
              <span style={{ fontSize: '10px', color: '#4B5563', marginTop: '2px' }}>{t.home}</span>
            </button>

            <button
              onClick={() => setShowMailModal(true)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
              title={t.mail}
            >
              <i className="fa-solid fa-envelope" style={{ fontSize: '16px', color: '#D97706' }}></i>
              <span style={{ fontSize: '10px', color: '#4B5563', marginTop: '2px' }}>{t.mail}</span>
            </button>

            {/* Customer Switcher Select */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: '#F3F4F6', padding: '3px 8px', borderRadius: '4px', border: '1px solid #D1D5DB' }}>
              <i className="fa-solid fa-user" style={{ fontSize: '12px', color: '#005A3E' }}></i>
              <select
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: '600',
                  color: '#111827',
                  cursor: 'pointer',
                  outline: 'none'
                }}
                disabled={loadingCustomers}
                value={selectedCustomer?.customerId || ''}
                onChange={(e) => {
                  const found = customers.find(c => c.customerId === Number(e.target.value));
                  if (found) setSelectedCustomer(found);
                }}
              >
                {customers.map(c => (
                  <option key={c.customerId} value={c.customerId}>
                    {c.customerName} ({c.accountNumber})
                  </option>
                ))}
              </select>
            </div>

            {/* Language Switcher */}
            <button
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
              style={{
                backgroundColor: '#005A3E',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              {lang === 'en' ? 'العربية' : 'English'}
            </button>

            {/* Logout / Switch to PMIMS */}
            {onBackToPmims ? (
              <button
                onClick={onBackToPmims}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                title={t.back_to_pmims}
              >
                <i className="fa-solid fa-arrow-right-from-bracket" style={{ fontSize: '16px', color: '#DC2626' }}></i>
                <span style={{ fontSize: '10px', color: '#4B5563', marginTop: '2px' }}>{t.logout}</span>
              </button>
            ) : (
              <button
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                title={t.logout}
              >
                <i className="fa-solid fa-arrow-right-from-bracket" style={{ fontSize: '16px', color: '#DC2626' }}></i>
                <span style={{ fontSize: '10px', color: '#4B5563', marginTop: '2px' }}>{t.logout}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Live PMIMS Impact HUD Banner */}
      {pmimsImpact && (
        <div style={{
          backgroundColor: '#E6F4EA',
          borderBottom: '2px solid #009B4E',
          padding: '6px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ backgroundColor: '#005A3E', color: '#FFF', padding: '1px 6px', borderRadius: '3px', fontWeight: 'bold', fontSize: '10px' }}>
              {t.hud_title}
            </span>
            <strong style={{ color: '#005A3E' }}>{pmimsImpact.impactText}</strong>
            <span style={{ color: '#4B5563' }}>— {pmimsImpact.details}</span>
          </div>
          <span style={{ color: '#6B7280', fontSize: '11px' }}>{pmimsImpact.timestamp}</span>
        </div>
      )}

      {/* 2. BODY LAYOUT (SIDEBAR + MAIN CONTENT AREA) */}
      <div style={{
        display: 'flex',
        flex: 1,
        padding: '16px 20px',
        gap: '16px',
        maxWidth: '1500px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        {/* LEFT SIDEBAR ACCORDION (KFH GREEN SIDEBAR) */}
        <aside style={{ width: '230px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          
          {/* 1. Account Services */}
          <div style={{ borderRadius: '4px', overflow: 'hidden' }}>
            <button
              onClick={() => toggleAccordion('accountServices')}
              style={{
                width: '100%',
                backgroundColor: '#005A3E',
                color: '#FFFFFF',
                border: 'none',
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: 'bold',
                textAlign: lang === 'ar' ? 'right' : 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer'
              }}
            >
              <span>{lang === 'ar' ? (openAccordions.accountServices ? '▼' : '◀') : (openAccordions.accountServices ? '▼' : '▶')} {t.sec_account_services}</span>
            </button>
            {openAccordions.accountServices && (
              <div style={{ backgroundColor: '#ECEEEB', padding: '6px 0', border: '1px solid #D1DCD4', borderTop: 'none' }}>
                <div
                  onClick={() => { setTopTab('accounts'); setActiveView('profile'); }}
                  style={{ padding: '6px 14px', fontSize: '12px', cursor: 'pointer', color: '#111827', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span style={{ color: '#009B4E' }}>●</span> {t.tab_banking_accounts}
                </div>
                <div
                  onClick={() => { setTopTab('deposits'); }}
                  style={{ padding: '6px 14px', fontSize: '12px', cursor: 'pointer', color: '#111827', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span style={{ color: '#009B4E' }}>●</span> {t.tab_investment_deposits}
                </div>
              </div>
            )}
          </div>

          {/* 2. Gold Account (Expanded by default) */}
          <div style={{ borderRadius: '4px', overflow: 'hidden', border: '1px solid #005A3E' }}>
            <button
              onClick={() => toggleAccordion('goldAccount')}
              style={{
                width: '100%',
                backgroundColor: '#005A3E',
                color: '#FFFFFF',
                border: 'none',
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: 'bold',
                textAlign: lang === 'ar' ? 'right' : 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer'
              }}
            >
              <span>{lang === 'ar' ? (openAccordions.goldAccount ? '▼' : '◀') : (openAccordions.goldAccount ? '▼' : '▶')} {t.sec_gold_account}</span>
            </button>

            {openAccordions.goldAccount && (
              <div style={{ backgroundColor: '#ECEEEB', padding: '6px 0' }}>
                {[
                  { id: 'profile', label: t.view_profile, sub: 'gold' },
                  { id: 'statement', label: t.view_statement, sub: 'profile' },
                  { id: 'buy', label: t.view_buy, sub: 'buy' },
                  { id: 'sell', label: t.view_sell, sub: 'sell' },
                  { id: 'branch-delivery', label: t.view_branch_del, sub: 'branch-delivery' },
                  { id: 'home-delivery', label: t.view_home_del, sub: 'home-delivery' },
                  { id: 'gift', label: t.view_gift, sub: 'gift' },
                  { id: 'scanner', label: t.view_scanner, sub: 'scanner' },
                  { id: 'sync', label: t.view_sync, sub: 'sync' }
                ].map(item => {
                  const isCurrent = activeView === item.sub && topTab === 'gold';
                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        setTopTab('gold');
                        setActiveView(item.sub as any);
                      }}
                      style={{
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: isCurrent ? 'bold' : 'normal',
                        color: isCurrent ? '#005A3E' : '#1F2937',
                        backgroundColor: isCurrent ? '#D8E2DC' : 'transparent',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'background-color 0.15s'
                      }}
                    >
                      <span style={{ color: '#009B4E' }}>●</span>
                      <span>{item.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. Cards */}
          <div style={{ borderRadius: '4px', overflow: 'hidden' }}>
            <button
              onClick={() => toggleAccordion('cards')}
              style={{
                width: '100%',
                backgroundColor: '#005A3E',
                color: '#FFFFFF',
                border: 'none',
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: 'bold',
                textAlign: lang === 'ar' ? 'right' : 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer'
              }}
            >
              <span>{lang === 'ar' ? (openAccordions.cards ? '▼' : '◀') : (openAccordions.cards ? '▼' : '▶')} {t.sec_cards}</span>
            </button>
            {openAccordions.cards && (
              <div style={{ backgroundColor: '#ECEEEB', padding: '6px 14px', fontSize: '12px', color: '#4B5563' }}>
                <div>● Debit & Prepaid Cards</div>
                <div>● Credit Cards</div>
              </div>
            )}
          </div>

          {/* 4. Transfers & Payments */}
          <div style={{ borderRadius: '4px', overflow: 'hidden' }}>
            <button
              onClick={() => toggleAccordion('transfers')}
              style={{
                width: '100%',
                backgroundColor: '#005A3E',
                color: '#FFFFFF',
                border: 'none',
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: 'bold',
                textAlign: lang === 'ar' ? 'right' : 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer'
              }}
            >
              <span>{lang === 'ar' ? (openAccordions.transfers ? '▼' : '◀') : (openAccordions.transfers ? '▼' : '▶')} {t.sec_transfers}</span>
            </button>
            {openAccordions.transfers && (
              <div style={{ backgroundColor: '#ECEEEB', padding: '6px 14px', fontSize: '12px', color: '#4B5563' }}>
                <div>● Local WAMDA Transfer</div>
                <div>● International Swift</div>
              </div>
            )}
          </div>

          {/* 5. Cardless */}
          <div style={{ borderRadius: '4px', overflow: 'hidden' }}>
            <button
              onClick={() => toggleAccordion('cardless')}
              style={{
                width: '100%',
                backgroundColor: '#005A3E',
                color: '#FFFFFF',
                border: 'none',
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: 'bold',
                textAlign: lang === 'ar' ? 'right' : 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer'
              }}
            >
              <span>{lang === 'ar' ? (openAccordions.cardless ? '▼' : '◀') : (openAccordions.cardless ? '▼' : '▶')} {t.sec_cardless}</span>
            </button>
          </div>

          {/* 6. Standing Orders */}
          <div style={{ borderRadius: '4px', overflow: 'hidden' }}>
            <button
              onClick={() => toggleAccordion('standingOrders')}
              style={{
                width: '100%',
                backgroundColor: '#005A3E',
                color: '#FFFFFF',
                border: 'none',
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: 'bold',
                textAlign: lang === 'ar' ? 'right' : 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer'
              }}
            >
              <span>{lang === 'ar' ? (openAccordions.standingOrders ? '▼' : '◀') : (openAccordions.standingOrders ? '▼' : '▶')} {t.sec_standing_orders}</span>
            </button>
          </div>

          {/* 7. Finance Services */}
          <div style={{ borderRadius: '4px', overflow: 'hidden' }}>
            <button
              onClick={() => toggleAccordion('finance')}
              style={{
                width: '100%',
                backgroundColor: '#005A3E',
                color: '#FFFFFF',
                border: 'none',
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: 'bold',
                textAlign: lang === 'ar' ? 'right' : 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer'
              }}
            >
              <span>{lang === 'ar' ? (openAccordions.finance ? '▼' : '◀') : (openAccordions.finance ? '▼' : '▶')} {t.sec_finance_services}</span>
            </button>
          </div>

        </aside>

        {/* RIGHT MAIN CONTENT AREA */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          
          {/* Top Horizontal Capsule Tabs Container */}
          <div style={{
            backgroundColor: '#D1DCD4',
            padding: '4px',
            borderRadius: '8px 8px 0 0',
            display: 'flex',
            gap: '3px',
            overflowX: 'auto',
            border: '1px solid #BDCBD0',
            borderBottom: 'none'
          }}>
            {[
              { id: 'accounts', label: t.tab_banking_accounts },
              { id: 'deposits', label: t.tab_investment_deposits },
              { id: 'plans', label: t.tab_investment_plans },
              { id: 'holds', label: t.tab_holds },
              { id: 'gold', label: t.tab_gold_account },
              { id: 'ibans', label: t.tab_ibans },
              { id: 'children', label: t.tab_my_children }
            ].map(tab => {
              const isActive = topTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setTopTab(tab.id as any);
                    if (tab.id === 'gold') setActiveView('profile');
                  }}
                  style={{
                    backgroundColor: isActive ? '#FFFFFF' : '#005A3E',
                    color: isActive ? '#111827' : '#FFFFFF',
                    border: 'none',
                    borderRadius: '5px',
                    padding: '8px 14px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    transition: 'all 0.15s'
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Content Card Viewport */}
          <div style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #BDCBD0',
            borderRadius: '0 0 6px 6px',
            padding: '18px',
            minHeight: '520px',
            boxShadow: '0 2px 5px rgba(0,0,0,0.03)'
          }}>

            {/* TAB: BANKING ACCOUNTS OVERVIEW (EXACT AS SCREENSHOT) */}
            {topTab === 'accounts' && selectedCustomer && (
              <div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#005A3E', color: '#FFFFFF', textAlign: lang === 'ar' ? 'right' : 'left' }}>
                      <th style={{ padding: '8px 12px', fontWeight: 'bold' }}>{t.th_account_no}</th>
                      <th style={{ padding: '8px 12px', fontWeight: 'bold' }}>{t.th_account_type}</th>
                      <th style={{ padding: '8px 12px', fontWeight: 'bold' }}>{t.th_currency}</th>
                      <th style={{ padding: '8px 12px', fontWeight: 'bold', textAlign: 'right' }}>{t.th_total_balance}</th>
                      <th style={{ padding: '8px 12px', fontWeight: 'bold', textAlign: 'right' }}>{t.th_available_balance}</th>
                      <th style={{ padding: '8px 12px', fontWeight: 'bold', textAlign: 'right' }}>{t.th_holds_val}</th>
                      <th style={{ padding: '8px 12px', fontWeight: 'bold', textAlign: 'center' }}>{t.th_status}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #E5E7EB', backgroundColor: '#FFFFFF' }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 'bold' }}>XXXXXXXX4381</td>
                      <td style={{ padding: '8px 12px' }}>Current</td>
                      <td style={{ padding: '8px 12px' }}>🇰🇼 KWD</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 'bold' }}>136.410</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 'bold' }}>136.410</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6B7280' }}>0.000</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}><span style={{ color: '#009B4E', fontWeight: 'bold' }}>Active</span></td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAF9' }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 'bold' }}>XXXXXXXX4052</td>
                      <td style={{ padding: '8px 12px' }}>Electronic</td>
                      <td style={{ padding: '8px 12px' }}>🇰🇼 KWD</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 'bold' }}>0.000</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 'bold' }}>0.000</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6B7280' }}>0.000</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}><span style={{ color: '#009B4E', fontWeight: 'bold' }}>Active</span></td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #E5E7EB', backgroundColor: '#FFFFFF' }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 'bold' }}>{selectedCustomer.accountNumber}</td>
                      <td style={{ padding: '8px 12px' }}>Saving Premium Account</td>
                      <td style={{ padding: '8px 12px' }}>🇰🇼 KWD</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 'bold' }}>{selectedCustomer.cashBalance.toFixed(3)}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 'bold' }}>{selectedCustomer.cashBalance.toFixed(3)}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6B7280' }}>0.000</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}><span style={{ color: '#009B4E', fontWeight: 'bold' }}>Active</span></td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAF9' }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 'bold' }}>XXXXXXXX3116</td>
                      <td style={{ padding: '8px 12px' }}>Gold Custody & Settlement Account</td>
                      <td style={{ padding: '8px 12px' }}>🇰🇼 KWD</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 'bold', color: '#005A3E' }}>{(selectedCustomer.totalGoldGrams * kwdRate).toFixed(3)}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 'bold', color: '#005A3E' }}>{(selectedCustomer.totalGoldGrams * kwdRate).toFixed(3)}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6B7280' }}>0.000</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}><span style={{ color: '#009B4E', fontWeight: 'bold' }}>Active</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB: GOLD ACCOUNT VIEW */}
            {topTab === 'gold' && (
              <div>
                {/* 1. GOLD HOLDINGS & PROFILE VIEW */}
                {activeView === 'profile' && selectedCustomer && (
                  <div>
                    {/* Live Gold Rates Ribbon */}
                    <div style={{
                      backgroundColor: '#F3F8F5',
                      border: '1px solid #C4D7CC',
                      borderRadius: '6px',
                      padding: '10px 16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '16px',
                      flexWrap: 'wrap',
                      gap: '12px'
                    }}>
                      <div style={{ display: 'flex', gap: '24px' }}>
                        <div>
                          <span style={{ fontSize: '11px', color: '#6B7280', display: 'block' }}>{t.bid_rate}</span>
                          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#005A3E' }}>
                            ${priceFeed?.bidPrice.toFixed(2) || '2,405.00'} /g • {kwdRate.toFixed(3)} KWD
                          </span>
                        </div>
                        <div style={{ width: '1px', backgroundColor: '#D1DCD4' }}></div>
                        <div>
                          <span style={{ fontSize: '11px', color: '#6B7280', display: 'block' }}>{t.ask_rate}</span>
                          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#D97706' }}>
                            ${priceFeed?.askPrice.toFixed(2) || '2,408.50'} /g • {(kwdRate * 1.002).toFixed(3)} KWD
                          </span>
                        </div>
                      </div>

                      {/* Quick Action Navigation */}
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => setActiveView('buy')}
                          style={{ backgroundColor: '#005A3E', color: '#FFF', border: 'none', borderRadius: '4px', padding: '6px 12px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                          <i className="fa-solid fa-plus-circle"></i> {t.view_buy}
                        </button>
                        <button
                          onClick={() => setActiveView('sell')}
                          style={{ backgroundColor: '#FFFFFF', color: '#005A3E', border: '1px solid #005A3E', borderRadius: '4px', padding: '6px 12px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                          <i className="fa-solid fa-hand-holding-dollar"></i> {t.view_sell}
                        </button>
                        <button
                          onClick={() => setActiveView('gift')}
                          style={{ backgroundColor: '#FFFFFF', color: '#6D28D9', border: '1px solid #6D28D9', borderRadius: '4px', padding: '6px 12px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                          <i className="fa-solid fa-gift"></i> {t.view_gift}
                        </button>
                      </div>
                    </div>

                    {/* Summary Metric Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '18px' }}>
                      <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #D1DCD4', borderLeft: '4px solid #005A3E', borderRadius: '6px', padding: '12px' }}>
                        <div style={{ fontSize: '11px', color: '#6B7280' }}>{t.cash_balance}</div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#005A3E', marginTop: '2px' }}>
                          {selectedCustomer.cashBalance.toLocaleString(undefined, { minimumFractionDigits: 3 })} {t.currency}
                        </div>
                      </div>

                      <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #D1DCD4', borderLeft: '4px solid #D97706', borderRadius: '6px', padding: '12px' }}>
                        <div style={{ fontSize: '11px', color: '#6B7280' }}>{t.gold_holdings}</div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#D97706', marginTop: '2px' }}>
                          {selectedCustomer.totalGoldGrams.toLocaleString()} Grams
                        </div>
                        <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                          {selectedCustomer.holdingsCount} physical gold bar(s) in Vault
                        </div>
                      </div>

                      <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #D1DCD4', borderLeft: '4px solid #2563EB', borderRadius: '6px', padding: '12px' }}>
                        <div style={{ fontSize: '11px', color: '#6B7280' }}>{t.market_val}</div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#2563EB', marginTop: '2px' }}>
                          {(selectedCustomer.totalGoldGrams * kwdRate).toLocaleString(undefined, { minimumFractionDigits: 3 })} {t.currency}
                        </div>
                      </div>
                    </div>

                    {/* Physical Gold Bars Custody Ledger Table */}
                    <div style={{ marginTop: '8px' }}>
                      <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#005A3E', fontWeight: 'bold' }}>
                        {t.owned_bars} ({selectedCustomer.bars.length} items)
                      </h4>

                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#005A3E', color: '#FFFFFF', textAlign: lang === 'ar' ? 'right' : 'left' }}>
                            <th style={{ padding: '8px 10px', width: '30px' }}>#</th>
                            <th style={{ padding: '8px 10px' }}>{t.serial_num}</th>
                            <th style={{ padding: '8px 10px' }}>{t.denomination}</th>
                            <th style={{ padding: '8px 10px' }}>{t.weight}</th>
                            <th style={{ padding: '8px 10px' }}>{t.vault_loc}</th>
                            <th style={{ padding: '8px 10px' }}>{t.allocated_at}</th>
                            <th style={{ padding: '8px 10px', textAlign: 'center' }}>{t.actions}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCustomer.bars.length === 0 ? (
                            <tr>
                              <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: '#6B7280' }}>
                                {t.no_bars}
                              </td>
                            </tr>
                          ) : (
                            selectedCustomer.bars.map((bar, idx) => (
                              <tr key={bar.holdingId || idx} style={{ borderBottom: '1px solid #E5E7EB', backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAF9' }}>
                                <td style={{ padding: '8px 10px', color: '#6B7280' }}>{idx + 1}</td>
                                <td style={{ padding: '8px 10px', fontWeight: 'bold', color: '#005A3E', fontFamily: 'monospace' }}>
                                  {bar.serialNumber}
                                </td>
                                <td style={{ padding: '8px 10px' }}>{bar.denomination || '100g Bar'}</td>
                                <td style={{ padding: '8px 10px', fontWeight: 'bold' }}>{bar.weightGrams}g</td>
                                <td style={{ padding: '8px 10px', fontSize: '11px', color: '#4B5563' }}>{bar.vaultLocation || 'Main Vault'}</td>
                                <td style={{ padding: '8px 10px', fontSize: '11px', color: '#6B7280' }}>{new Date(bar.allocationDate).toLocaleDateString()}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                  <div style={{ display: 'flex', justifyContent: 'center', gap: '4px' }}>
                                    <button
                                      onClick={() => { setSelectedBarsToSell([bar.holdingId]); setActiveView('sell'); }}
                                      style={{ backgroundColor: '#F3F4F6', color: '#005A3E', border: '1px solid #D1D5DB', borderRadius: '3px', padding: '2px 6px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}
                                    >
                                      {t.view_sell}
                                    </button>
                                    <button
                                      onClick={() => { setSelectedBarForBranchDelivery(bar.holdingId); setActiveView('branch-delivery'); }}
                                      style={{ backgroundColor: '#F3F4F6', color: '#2563EB', border: '1px solid #D1D5DB', borderRadius: '3px', padding: '2px 6px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}
                                    >
                                      {t.request_delivery}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 2. BUY GOLD VIEW */}
                {activeView === 'buy' && selectedCustomer && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <h3 style={{ margin: 0, fontSize: '15px', color: '#005A3E', fontWeight: 'bold' }}>
                        {t.view_buy} — Sharia-Compliant Instant Physical Vault Allocation
                      </h3>
                      <button
                        onClick={() => setActiveView('profile')}
                        style={{ backgroundColor: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: '4px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer' }}
                      >
                        ← Back to Holdings
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                      {/* Left: Denomination Selector */}
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#374151', display: 'block', marginBottom: '6px' }}>
                          Select Gold Bar Denomination:
                        </label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {availableDenoms.map((d, idx) => {
                            const isSelected = selectedDenom?.denomination === d.denomination;
                            const cost = d.weightGrams * (kwdRate * 1.002);
                            return (
                              <div
                                key={idx}
                                onClick={() => setSelectedDenom(d)}
                                style={{
                                  padding: '10px 14px',
                                  borderRadius: '6px',
                                  border: `2px solid ${isSelected ? '#005A3E' : '#E5E7EB'}`,
                                  backgroundColor: isSelected ? '#F0F7F3' : '#FFFFFF',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center'
                                }}
                              >
                                <div>
                                  <div style={{ fontWeight: 'bold', color: '#111827' }}>{d.denomination}</div>
                                  <div style={{ fontSize: '11px', color: '#6B7280' }}>Weight: {d.weightGrams}g • Available: {d.availableQuantity} pcs</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontWeight: 'bold', color: '#005A3E' }}>{cost.toFixed(3)} KWD</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Right: Order Summary & Execution */}
                      {selectedDenom && (
                        <div style={{ backgroundColor: '#F9FAF9', border: '1px solid #D1DCD4', borderRadius: '6px', padding: '16px' }}>
                          <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#005A3E' }}>Purchase & Settlement Summary</h4>
                          
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px' }}>
                            <span>Selected Item:</span>
                            <strong>{selectedDenom.denomination}</strong>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '12px' }}>
                            <span>{t.qty}:</span>
                            <input
                              type="number"
                              min="1"
                              max={selectedDenom.availableQuantity || 10}
                              value={buyQuantity}
                              onChange={e => setBuyQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                              style={{ width: '60px', padding: '4px', fontSize: '12px', border: '1px solid #D1D5DB', borderRadius: '4px', textAlign: 'center' }}
                            />
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px' }}>
                            <span>Gold Price Rate:</span>
                            <span>{(kwdRate * 1.002).toFixed(3)} KWD / gram</span>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #D1DCD4', paddingTop: '10px', marginTop: '10px', fontSize: '14px', fontWeight: 'bold' }}>
                            <span>{t.total_cost}:</span>
                            <span style={{ color: '#005A3E' }}>
                              {(selectedDenom.weightGrams * buyQuantity * (kwdRate * 1.002)).toFixed(3)} KWD
                            </span>
                          </div>

                          <button
                            onClick={handleBuyGold}
                            disabled={buying}
                            style={{
                              width: '100%',
                              backgroundColor: '#005A3E',
                              color: '#FFFFFF',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '10px',
                              fontSize: '13px',
                              fontWeight: 'bold',
                              marginTop: '16px',
                              cursor: buying ? 'not-allowed' : 'pointer'
                            }}
                          >
                            {buying ? 'Processing Purchase...' : t.buy_btn}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 3. SELL GOLD VIEW */}
                {activeView === 'sell' && selectedCustomer && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <h3 style={{ margin: 0, fontSize: '15px', color: '#005A3E', fontWeight: 'bold' }}>
                        {t.view_sell} — Instant Payout at KFH Buyback Bid Rate
                      </h3>
                      <button
                        onClick={() => setActiveView('profile')}
                        style={{ backgroundColor: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: '4px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer' }}
                      >
                        ← Back to Holdings
                      </button>
                    </div>

                    <p style={{ fontSize: '12px', color: '#4B5563', marginBottom: '12px' }}>
                      Select the gold bar(s) from your custody that you want to liquidate. Funds will be credited immediately to your KFH account.
                    </p>

                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginBottom: '16px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#005A3E', color: '#FFFFFF', textAlign: lang === 'ar' ? 'right' : 'left' }}>
                          <th style={{ padding: '8px', width: '30px' }}>Select</th>
                          <th style={{ padding: '8px' }}>{t.serial_num}</th>
                          <th style={{ padding: '8px' }}>{t.denomination}</th>
                          <th style={{ padding: '8px' }}>{t.weight}</th>
                          <th style={{ padding: '8px', textAlign: 'right' }}>Estimated Payout</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedCustomer.bars.map((b, idx) => {
                          const isSelected = selectedBarsToSell.includes(b.holdingId);
                          const estVal = b.weightGrams * kwdRate;
                          return (
                            <tr key={idx} style={{ borderBottom: '1px solid #E5E7EB', backgroundColor: isSelected ? '#F0F7F3' : '#FFFFFF' }}>
                              <td style={{ padding: '8px', textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={e => {
                                    if (e.target.checked) setSelectedBarsToSell([...selectedBarsToSell, b.holdingId]);
                                    else setSelectedBarsToSell(selectedBarsToSell.filter(id => id !== b.holdingId));
                                  }}
                                />
                              </td>
                              <td style={{ padding: '8px', fontWeight: 'bold', fontFamily: 'monospace' }}>{b.serialNumber}</td>
                              <td style={{ padding: '8px' }}>{b.denomination || 'Gold Bar'}</td>
                              <td style={{ padding: '8px' }}>{b.weightGrams}g</td>
                              <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: '#005A3E' }}>
                                {estVal.toFixed(3)} KWD
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {selectedBarsToSell.length > 0 && (
                      <div style={{ backgroundColor: '#F3F8F5', border: '1px solid #C4D7CC', borderRadius: '6px', padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>{selectedBarsToSell.length} bar(s) selected</strong>
                        </div>
                        <button
                          onClick={handleSellGold}
                          disabled={selling}
                          style={{
                            backgroundColor: '#005A3E',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '8px 18px',
                            fontSize: '13px',
                            fontWeight: 'bold',
                            cursor: selling ? 'not-allowed' : 'pointer'
                          }}
                        >
                          {selling ? 'Processing Sale...' : t.sell_btn}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. OTHER GOLD VIEWS (BRANCH DELIVERY, HOME DELIVERY, GIFT, SCANNER, SYNC) */}
                {activeView === 'branch-delivery' && selectedCustomer && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <h3 style={{ margin: 0, fontSize: '15px', color: '#005A3E', fontWeight: 'bold' }}>
                        {t.view_branch_del} — Armored Transit to KFH Branch
                      </h3>
                      <button onClick={() => setActiveView('profile')} style={{ backgroundColor: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: '4px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer' }}>
                        ← Back
                      </button>
                    </div>

                    <div style={{ maxWidth: '500px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Select Gold Bar:</label>
                      <select
                        value={selectedBarForBranchDelivery || ''}
                        onChange={e => setSelectedBarForBranchDelivery(Number(e.target.value))}
                        style={{ padding: '6px', fontSize: '12px', border: '1px solid #D1D5DB', borderRadius: '4px' }}
                      >
                        <option value="">-- Select Bar from Custody --</option>
                        {selectedCustomer.bars.map(b => (
                          <option key={b.holdingId} value={b.holdingId}>{b.serialNumber} ({b.weightGrams}g)</option>
                        ))}
                      </select>

                      <label style={{ fontSize: '12px', fontWeight: 'bold' }}>{t.destination_branch}:</label>
                      <select
                        value={destBranchId}
                        onChange={e => setDestBranchId(Number(e.target.value))}
                        style={{ padding: '6px', fontSize: '12px', border: '1px solid #D1D5DB', borderRadius: '4px' }}
                      >
                        <option value={1}>Main Branch (Mubarakiya)</option>
                        <option value={2}>Al-Faiha Branch</option>
                        <option value={3}>Al-Ahmadi Branch</option>
                        <option value={4}>Hawalli Commercial Branch</option>
                      </select>

                      <button
                        onClick={handleBranchDelivery}
                        disabled={submittingBranchDelivery || !selectedBarForBranchDelivery}
                        style={{
                          backgroundColor: '#005A3E',
                          color: '#FFFFFF',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '10px',
                          fontSize: '13px',
                          fontWeight: 'bold',
                          marginTop: '10px',
                          cursor: submittingBranchDelivery || !selectedBarForBranchDelivery ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {submittingBranchDelivery ? 'Submitting...' : t.dispatch_request}
                      </button>
                    </div>
                  </div>
                )}

                {activeView === 'home-delivery' && selectedCustomer && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <h3 style={{ margin: 0, fontSize: '15px', color: '#005A3E', fontWeight: 'bold' }}>
                        {t.view_home_del} — Secure PACI Verified Home Handover
                      </h3>
                      <button onClick={() => setActiveView('profile')} style={{ backgroundColor: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: '4px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer' }}>
                        ← Back
                      </button>
                    </div>

                    <div style={{ maxWidth: '500px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Select Gold Bar:</label>
                      <select
                        value={selectedBarForHomeDelivery || ''}
                        onChange={e => setSelectedBarForHomeDelivery(Number(e.target.value))}
                        style={{ padding: '6px', fontSize: '12px', border: '1px solid #D1D5DB', borderRadius: '4px' }}
                      >
                        <option value="">-- Select Bar from Custody --</option>
                        {selectedCustomer.bars.map(b => (
                          <option key={b.holdingId} value={b.holdingId}>{b.serialNumber} ({b.weightGrams}g)</option>
                        ))}
                      </select>

                      <label style={{ fontSize: '12px', fontWeight: 'bold' }}>{t.governorate}:</label>
                      <input type="text" value={hdGovernorate} onChange={e => setHdGovernorate(e.target.value)} style={{ padding: '6px', fontSize: '12px', border: '1px solid #D1D5DB', borderRadius: '4px' }} />

                      <label style={{ fontSize: '12px', fontWeight: 'bold' }}>{t.area}:</label>
                      <input type="text" value={hdArea} onChange={e => setHdArea(e.target.value)} style={{ padding: '6px', fontSize: '12px', border: '1px solid #D1D5DB', borderRadius: '4px' }} />

                      <button
                        onClick={handleHomeDelivery}
                        disabled={submittingHomeDelivery || !selectedBarForHomeDelivery}
                        style={{
                          backgroundColor: '#005A3E',
                          color: '#FFFFFF',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '10px',
                          fontSize: '13px',
                          fontWeight: 'bold',
                          marginTop: '10px',
                          cursor: submittingHomeDelivery || !selectedBarForHomeDelivery ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {submittingHomeDelivery ? 'Submitting...' : t.submit_hd}
                      </button>
                    </div>
                  </div>
                )}

                {activeView === 'gift' && selectedCustomer && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <h3 style={{ margin: 0, fontSize: '15px', color: '#6D28D9', fontWeight: 'bold' }}>
                        {t.view_gift} — Digital Certificate Transfer
                      </h3>
                      <button onClick={() => setActiveView('profile')} style={{ backgroundColor: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: '4px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer' }}>
                        ← Back
                      </button>
                    </div>

                    <div style={{ maxWidth: '500px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Recipient Civil ID / Account #:</label>
                      <input type="text" placeholder="e.g. 290120109981" value={recipientCustomerId} onChange={e => setRecipientCustomerId(e.target.value)} style={{ padding: '6px', fontSize: '12px', border: '1px solid #D1D5DB', borderRadius: '4px' }} />

                      <label style={{ fontSize: '12px', fontWeight: 'bold' }}>{t.occasion}:</label>
                      <input type="text" value={giftOccasion} onChange={e => setGiftOccasion(e.target.value)} style={{ padding: '6px', fontSize: '12px', border: '1px solid #D1D5DB', borderRadius: '4px' }} />

                      <label style={{ fontSize: '12px', fontWeight: 'bold' }}>{t.message}:</label>
                      <textarea rows={3} value={giftMessage} onChange={e => setGiftMessage(e.target.value)} style={{ padding: '6px', fontSize: '12px', border: '1px solid #D1D5DB', borderRadius: '4px' }} />

                      <button
                        onClick={handleGiftGold}
                        disabled={gifting}
                        style={{
                          backgroundColor: '#6D28D9',
                          color: '#FFFFFF',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '10px',
                          fontSize: '13px',
                          fontWeight: 'bold',
                          marginTop: '10px',
                          cursor: gifting ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {gifting ? 'Processing Gift...' : t.gift_btn}
                      </button>
                    </div>
                  </div>
                )}

                {activeView === 'scanner' && (
                  <div>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', color: '#005A3E' }}>{t.view_scanner}</h3>
                    <div style={{ display: 'flex', gap: '8px', maxWidth: '400px', marginBottom: '14px' }}>
                      <input
                        type="text"
                        placeholder="Enter Bar Serial (e.g. B00570, VAL-2026)"
                        value={scanQuery}
                        onChange={e => setScanQuery(e.target.value)}
                        style={{ flex: 1, padding: '6px 10px', fontSize: '12px', border: '1px solid #D1D5DB', borderRadius: '4px' }}
                      />
                      <button
                        onClick={handleScanQr}
                        disabled={scanning}
                        style={{ backgroundColor: '#005A3E', color: '#FFF', border: 'none', borderRadius: '4px', padding: '6px 14px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        {scanning ? 'Verifying...' : 'Verify'}
                      </button>
                    </div>

                    {scanResult && (
                      <div style={{ backgroundColor: '#F9FAF9', border: '1px solid #D1DCD4', borderRadius: '6px', padding: '14px', maxWidth: '500px' }}>
                        {scanResult.error ? (
                          <div style={{ color: '#DC2626', fontWeight: 'bold' }}>{scanResult.error}</div>
                        ) : (
                          <div>
                            <div style={{ color: '#009B4E', fontWeight: 'bold', marginBottom: '6px' }}>✓ Verified LBMA Gold Bar</div>
                            <div>Serial: <strong>{scanResult.serialNumber}</strong></div>
                            <div>Location: <strong>{scanResult.vaultLocation || 'Main Vault'}</strong></div>
                            <div>Purity: <strong>{scanResult.purity || '999.9 PPT'}</strong></div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {activeView === 'sync' && (
                  <div>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', color: '#005A3E' }}>{t.view_sync}</h3>
                    <button
                      onClick={handleEodSync}
                      disabled={syncing}
                      style={{ backgroundColor: '#005A3E', color: '#FFF', border: 'none', borderRadius: '4px', padding: '8px 16px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '14px' }}
                    >
                      {syncing ? 'Running Sync...' : t.sync_now}
                    </button>
                  </div>
                )}

              </div>
            )}

            {/* OTHER TOP TABS (PLACEHOLDERS STYLED AS AUTHENTIC BANKING CARDS) */}
            {topTab === 'deposits' && (
              <div style={{ padding: '24px', textAlign: 'center', color: '#6B7280' }}>
                <i className="fa-solid fa-vault" style={{ fontSize: '36px', color: '#005A3E', marginBottom: '10px' }}></i>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#111827' }}>Investment Deposits Portfolio</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>Active Al-Kawthar & Sharia Investment term deposits.</div>
              </div>
            )}

            {topTab === 'plans' && (
              <div style={{ padding: '24px', textAlign: 'center', color: '#6B7280' }}>
                <i className="fa-solid fa-chart-line" style={{ fontSize: '36px', color: '#005A3E', marginBottom: '10px' }}></i>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#111827' }}>Investment Plans</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>Automated monthly gold accumulation and saving plans.</div>
              </div>
            )}

            {topTab === 'holds' && (
              <div style={{ padding: '24px', textAlign: 'center', color: '#6B7280' }}>
                <i className="fa-solid fa-lock" style={{ fontSize: '36px', color: '#005A3E', marginBottom: '10px' }}></i>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#111827' }}>Active Account Holds</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>No active financial holds or reservations on your accounts.</div>
              </div>
            )}

            {topTab === 'ibans' && (
              <div style={{ padding: '24px', textAlign: 'center', color: '#6B7280' }}>
                <i className="fa-solid fa-receipt" style={{ fontSize: '36px', color: '#005A3E', marginBottom: '10px' }}></i>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#111827' }}>International Bank Account Numbers (IBAN)</div>
                <div style={{ fontSize: '13px', marginTop: '8px', fontFamily: 'monospace', fontWeight: 'bold', color: '#005A3E' }}>KW82 KFH0 0000 0000 0000 0043 81</div>
              </div>
            )}

            {topTab === 'children' && (
              <div style={{ padding: '24px', textAlign: 'center', color: '#6B7280' }}>
                <i className="fa-solid fa-users" style={{ fontSize: '36px', color: '#005A3E', marginBottom: '10px' }}></i>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#111827' }}>My Children Minor Accounts</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>Manage junior savings and minor gold gifts under guardianship.</div>
              </div>
            )}

          </div>
        </main>
      </div>

      {/* SUCCESS MODALS */}
      {buySuccessModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#FFFFFF', borderRadius: '8px', padding: '20px', maxWidth: '420px', width: '90%', border: '2px solid #005A3E' }}>
            <div style={{ color: '#009B4E', fontWeight: 'bold', fontSize: '16px', marginBottom: '10px' }}>
              ✓ Purchase & Allocation Confirmed!
            </div>
            <p style={{ fontSize: '12px', color: '#374151' }}>
              Your gold purchase has been completed and allocated directly into your KFH vault custody coordinate.
            </p>
            <button
              onClick={() => { setBuySuccessModal(null); setActiveView('profile'); }}
              style={{ width: '100%', backgroundColor: '#005A3E', color: '#FFF', border: 'none', borderRadius: '4px', padding: '8px', fontWeight: 'bold', cursor: 'pointer', marginTop: '12px' }}
            >
              View in Custody
            </button>
          </div>
        </div>
      )}

      {sellSuccessModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#FFFFFF', borderRadius: '8px', padding: '20px', maxWidth: '420px', width: '90%', border: '2px solid #005A3E' }}>
            <div style={{ color: '#009B4E', fontWeight: 'bold', fontSize: '16px', marginBottom: '10px' }}>
              ✓ Sale & Settlement Completed!
            </div>
            <p style={{ fontSize: '12px', color: '#374151' }}>
              Proceeds credited to your KFH account: <strong>{(sellSuccessModal.totalPayout || 0).toLocaleString()} KWD</strong>.
            </p>
            <button
              onClick={() => { setSellSuccessModal(null); setActiveView('profile'); }}
              style={{ width: '100%', backgroundColor: '#005A3E', color: '#FFF', border: 'none', borderRadius: '4px', padding: '8px', fontWeight: 'bold', cursor: 'pointer', marginTop: '12px' }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showMailModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#FFFFFF', borderRadius: '8px', padding: '20px', maxWidth: '460px', width: '90%', border: '1px solid #D1DCD4' }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#005A3E' }}>KFH Secure Message Center</h4>
            <div style={{ fontSize: '12px', color: '#4B5563', padding: '8px 0', borderBottom: '1px solid #E5E7EB' }}>
              <strong>KFH Treasury:</strong> Monthly Gold Custody statement ready for inspection.
            </div>
            <div style={{ fontSize: '12px', color: '#4B5563', padding: '8px 0' }}>
              <strong>Security Alert:</strong> Login verified from IP 192.168.1.50 (Kuwait City).
            </div>
            <button
              onClick={() => setShowMailModal(false)}
              style={{ width: '100%', backgroundColor: '#005A3E', color: '#FFF', border: 'none', borderRadius: '4px', padding: '8px', fontWeight: 'bold', cursor: 'pointer', marginTop: '14px' }}
            >
              Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
