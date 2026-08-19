import { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:5000/api';

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
  const [activeView, setActiveView] = useState<'profile' | 'buy' | 'sell' | 'gift' | 'branch-delivery' | 'home-delivery' | 'scanner' | 'sync'>('profile');

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
  const [hdArea, setHdArea] = useState('Shuwaikh Residential');
  const [hdBlock, setHdBlock] = useState('3');
  const [hdStreet, setHdStreet] = useState('Street 14');
  const [hdBuilding, setHdBuilding] = useState('Building 22 / House 5');
  const [hdFloor, setHdFloor] = useState('Floor 2, Flat 4');
  const [hdPhone, setHdPhone] = useState('+965 9988 7766');
  const [hdInstructions, setHdInstructions] = useState('Deliver before 5 PM. Call upon arrival.');
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

  // Translation Dictionary
  const t = {
    en: {
      gfs_title: "Gold Financial Services (GFS)",
      gfs_subtitle: "KFH Digital Customer Gold Portal & Settlement Gateway",
      back_to_pmims: "Switch to PMIMS Vault Ledger",
      active_customer: "Active Customer",
      cash_balance: "Cash Account Balance",
      gold_holdings: "Physical Gold in Custody",
      market_val: "Est. Market Value",
      bid_rate: "KFH Buyback (Bid)",
      ask_rate: "KFH Selling (Ask)",
      view_profile: "My Account & Custody",
      view_buy: "Buy Physical Gold",
      view_sell: "Sell from Custody",
      view_gift: "Gift Gold Transfer",
      view_branch_del: "Branch Delivery (UC04)",
      view_home_del: "Home Delivery (UC07)",
      view_scanner: "Live Bar Scanner (UC02)",
      view_sync: "EOD Settlement (UC08)",
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
      sync_now: "Run GFS EOD Sync"
    },
    ar: {
      gfs_title: "منصة الخدمات المالية للذهب (GFS)",
      gfs_subtitle: "بوابة بيت التمويل الكويتي لتداول وحفظ الذهب وتسليم الأمانات",
      back_to_pmims: "العودة إلى نظام الخزينة الرئيسي (PMIMS)",
      active_customer: "العميل الحالي",
      cash_balance: "رصيد الحساب النقدي",
      gold_holdings: "أمانات الذهب الفعلي بالخزينة",
      market_val: "القيمة السوقية التقديرية",
      bid_rate: "سعر الشراء من العميل (Bid)",
      ask_rate: "سعر البيع للعميل (Ask)",
      view_profile: "حسابي والأمانات",
      view_buy: "شراء ذهب مادي",
      view_sell: "بيع من الأمانات",
      view_gift: "إهداء ذهب لعميل آخر",
      view_branch_del: "طلب استلام بالفرع (UC04)",
      view_home_del: "التوصيل للمنزل (UC07)",
      view_scanner: "التحقق بمسح الباركود (UC02)",
      view_sync: "مطابقة نهاية اليوم (UC08)",
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
      submit_hd: "تأكيد طلب التوصيل للمنزل",
      otp_code: "رمز التحقق والتسليم (OTP)",
      hud_title: "تأثير PMIMS الفوري المباشر",
      sync_now: "تنفيذ مطابقة نهاية اليوم"
    }
  }[lang];

  // Fetch initial data
  const fetchCustomers = async () => {
    setLoadingCustomers(true);
    try {
      const res = await fetch(`${API_BASE}/kfhonline/customers`);
      if (res.ok) {
        const data = await res.json();
        setCustomers(data);
        if (data.length > 0) {
          setSelectedCustomer(prev => {
            if (!prev) return data[0];
            const updated = data.find((c: Customer) => c.customerId === prev.customerId);
            return updated || data[0];
          });
        }
      }
    } catch (e) {
      console.error('Failed to fetch customers', e);
    } finally {
      setLoadingCustomers(false);
    }
  };

  const fetchPriceFeed = async () => {
    try {
      const res = await fetch(`${API_BASE}/kfhonline/prices/gold`);
      if (res.ok) {
        const data = await res.json();
        setPriceFeed(data);
      }
    } catch (e) {
      console.error('Failed to fetch price feed', e);
    }
  };

  const fetchAvailableInventory = async () => {
    setLoadingInventory(true);
    try {
      const res = await fetch(`${API_BASE}/kfhonline/inventory/denominations`);
      if (res.ok) {
        const data = await res.json();
        setAvailableDenoms(data.denominations || []);
      }
    } catch (e) {
      console.error('Failed to fetch inventory', e);
    } finally {
      setLoadingInventory(false);
    }
  };

  const fetchDeliveries = async () => {
    try {
      const [brRes, hdRes] = await Promise.all([
        fetch(`${API_BASE}/gfs/delivery-requests`),
        fetch(`${API_BASE}/gfs/home-delivery`)
      ]);
      if (brRes.ok) setBranchDeliveryRequests(await brRes.json());
      if (hdRes.ok) setHomeDeliveryRequests(await hdRes.json());
    } catch (e) {
      console.error('Failed to fetch delivery requests', e);
    }
  };

  useEffect(() => {
    fetchCustomers();
    fetchPriceFeed();
    fetchAvailableInventory();
    fetchDeliveries();
    const interval = setInterval(fetchPriceFeed, 15000);
    return () => clearInterval(interval);
  }, []);

  // Set PMIMS Impact HUD helper
  const triggerImpact = (action: string, impactText: string, details: string) => {
    setPmimsImpact({
      action,
      impactText,
      details,
      timestamp: new Date().toLocaleTimeString()
    });
    // Refresh all data
    fetchCustomers();
    fetchAvailableInventory();
    fetchDeliveries();
  };

  // 1. Buy Gold Handler
  const handleBuyGold = async () => {
    if (!selectedCustomer || !selectedDenom) return;
    setBuying(true);
    try {
      const selectedBars = selectedDenom.bars.slice(0, buyQuantity).map(b => b.serialNumber);
      if (selectedBars.length === 0) {
        alert('No bars available for selected quantity');
        setBuying(false);
        return;
      }

      const totalGrams = selectedDenom.weightGrams * buyQuantity;
      const res = await fetch(`${API_BASE}/kfhonline/transactions/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomer.customerId.toString(),
          customerName: selectedCustomer.customerName,
          weightGrams: totalGrams,
          serialNumbers: selectedBars,
          purity: '99.99%',
          notes: `Purchased via GFS Portal - Denom: ${selectedDenom.denomination}`
        })
      });

      const data = await res.json();
      if (res.ok) {
        setBuySuccessModal({
          customer: selectedCustomer.customerName,
          denomination: selectedDenom.denomination,
          quantity: buyQuantity,
          totalGrams,
          amount: data.amount,
          serials: selectedBars,
          transactionId: data.transactionId
        });

        triggerImpact(
          'CUSTOMER_BUY',
          `PMIMS Proprietary Stock: -${(totalGrams/1000).toFixed(3)} KG | Customer Custody: +${(totalGrams/1000).toFixed(3)} KG`,
          `Allocated serial(s) ${selectedBars.join(', ')} to ${selectedCustomer.customerName} (Status: CUSTOMER_CUSTODY, Ownership: CUSTOMER_OWNED)`
        );

        setSelectedDenom(null);
        setBuyQuantity(1);
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
      const barsToSell = selectedCustomer.bars.filter(b => selectedBarsToSell.includes(b.itemId));
      const totalGrams = barsToSell.reduce((sum, b) => sum + b.weightGrams, 0);
      const serials = barsToSell.map(b => b.serialNumber);

      const res = await fetch(`${API_BASE}/kfhonline/transactions/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomer.customerId.toString(),
          customerName: selectedCustomer.customerName,
          weightGrams: totalGrams,
          serialNumbers: serials,
          purity: '99.99%',
          notes: 'Liquidated via GFS Portal'
        })
      });

      const data = await res.json();
      if (res.ok) {
        setSellSuccessModal({
          customer: selectedCustomer.customerName,
          totalGrams,
          payout: data.amount,
          serials,
          transactionId: data.transactionId
        });

        triggerImpact(
          'CUSTOMER_SELL',
          `PMIMS Proprietary Stock: +${(totalGrams/1000).toFixed(3)} KG | Customer Custody: -${(totalGrams/1000).toFixed(3)} KG`,
          `Returned serial(s) ${serials.join(', ')} back to KFH Main Vault inventory (Status: READY, Ownership: KFH_OWNED)`
        );

        setSelectedBarsToSell([]);
      } else {
        alert(data.error || 'Failed to sell gold');
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSelling(false);
    }
  };

  // 3. Gift Gold Handler
  const handleGiftGold = async () => {
    if (!selectedCustomer || selectedBarsToGift.length === 0 || !recipientCustomerId) return;
    setGifting(true);
    try {
      const recipient = customers.find(c => c.customerId.toString() === recipientCustomerId || c.civilId === recipientCustomerId);
      const res = await fetch(`${API_BASE}/kfhonline/transactions/transfer-gift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderCustomerId: selectedCustomer.customerId.toString(),
          senderCustomerName: selectedCustomer.customerName,
          recipientCustomerId: recipientCustomerId,
          recipientCustomerName: recipient?.customerName || 'Recipient Customer',
          itemIds: selectedBarsToGift,
          occasion: giftOccasion,
          giftMessage: giftMessage
        })
      });

      const data = await res.json();
      if (res.ok) {
        const giftedBars = selectedCustomer.bars.filter(b => selectedBarsToGift.includes(b.itemId));
        setGiftSuccessModal({
          sender: selectedCustomer.customerName,
          recipient: recipient?.customerName || recipientCustomerId,
          occasion: giftOccasion,
          message: giftMessage,
          bars: giftedBars,
          timestamp: new Date().toLocaleDateString()
        });

        triggerImpact(
          'CUSTOMER_GIFT_TRANSFER',
          `PMIMS Custody Title Reassigned: ${selectedBarsToGift.length} bar(s) transferred`,
          `Reassigned ownership from ${selectedCustomer.customerName} to ${recipient?.customerName || recipientCustomerId}. Logged in PMIMS immutable audit trail.`
        );

        setSelectedBarsToGift([]);
      } else {
        alert(data.error || 'Failed to transfer gift');
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setGifting(false);
    }
  };

  // 4. Branch Delivery Request Handler
  const handleBranchDelivery = async () => {
    if (!selectedCustomer || !selectedBarForBranchDelivery) return;
    setSubmittingBranchDelivery(true);
    try {
      const refNum = `GFS-BR-${Date.now().toString().slice(-6)}`;
      const res = await fetch(`${API_BASE}/gfs/delivery-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gfsRefNumber: refNum,
          barId: selectedBarForBranchDelivery,
          customerAccountNumber: selectedCustomer.accountNumber,
          destinationBranchId: destBranchId,
          routeDetails: routeNotes
        })
      });

      const data = await res.json();
      if (res.ok) {
        alert(`✓ Branch delivery request ${refNum} created! Visible on PMIMS Branch Delivery Workbench.`);
        triggerImpact(
          'GFS_BRANCH_DELIVERY_REQUEST',
          `New GFS Request: ${refNum} (Status: PENDING_DISPATCH)`,
          `Created delivery request for Bar #${selectedBarForBranchDelivery} to Branch #${destBranchId}. Ready for courier dispatch in PMIMS.`
        );
        setSelectedBarForBranchDelivery(null);
      } else {
        alert(data.error || 'Failed to submit request');
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmittingBranchDelivery(false);
    }
  };

  // 5. Home Delivery Request Handler
  const handleHomeDelivery = async () => {
    if (!selectedCustomer || !selectedBarForHomeDelivery) return;
    setSubmittingHomeDelivery(true);
    try {
      const delNum = `HD-KFH-${Date.now().toString().slice(-6)}`;
      const res = await fetch(`${API_BASE}/gfs/home-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryNumber: delNum,
          barId: selectedBarForHomeDelivery,
          customerAccountNumber: selectedCustomer.accountNumber,
          customerCivilId: selectedCustomer.civilId,
          customerName: selectedCustomer.customerName,
          customerPhone: hdPhone,
          governorate: hdGovernorate,
          area: hdArea,
          block: hdBlock,
          street: hdStreet,
          buildingHouse: hdBuilding,
          floorFlat: hdFloor,
          specialInstructions: hdInstructions
        })
      });

      const data = await res.json();
      if (res.ok) {
        setHdSuccessModal(data);
        triggerImpact(
          'GFS_HOME_DELIVERY_REQUEST',
          `New Home Delivery: ${delNum} (OTP: ${data.verificationOtp})`,
          `Generated secure delivery request. Ready for vault dispatch and courier verification in PMIMS.`
        );
        setSelectedBarForHomeDelivery(null);
      } else {
        alert(data.error || 'Failed to submit home delivery');
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmittingHomeDelivery(false);
    }
  };

  // 6. QR / Barcode Scanner Handler
  const handleScanQr = async () => {
    if (!scanQuery) return;
    setScanning(true);
    try {
      const res = await fetch(`${API_BASE}/inventory/items/scan-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNumber: scanQuery.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setScanResult(data);
      } else {
        alert(data.error || 'Bar not found in PMIMS');
        setScanResult(null);
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setScanning(false);
    }
  };

  // 7. EOD Sync Handler
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
      height: '100%',
      flex: 1,
      overflowY: 'auto',
      overflowX: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#070b14',
      color: '#f3f4f6',
      fontFamily: "'Segoe UI', Roboto, Helvetica, sans-serif",
      direction: lang === 'ar' ? 'rtl' : 'ltr'
    }}>
      {/* Top Header Bar */}
      <header style={{
        background: 'linear-gradient(135deg, #0b1324 0%, #0d1e38 100%)',
        borderBottom: '1px solid rgba(212, 175, 55, 0.3)',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #D4AF37 0%, #AA771C 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(212, 175, 55, 0.4)'
          }}>
            <i className="fa-solid fa-coins" style={{ color: '#0b1324', fontSize: '20px' }}></i>
          </div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '0.5px', color: '#F3BA2F' }}>
              {t.gfs_title}
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af' }}>
              {t.gfs_subtitle}
            </div>
          </div>
        </div>

        {/* Live Rates Ticker */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          background: 'rgba(0, 0, 0, 0.4)',
          padding: '6px 16px',
          borderRadius: '8px',
          border: '1px solid rgba(212, 175, 55, 0.2)'
        }}>
          <div>
            <span style={{ fontSize: '11px', color: '#9ca3af', display: 'block' }}>{t.bid_rate}</span>
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#10b981' }}>
              ${priceFeed?.bidPrice.toFixed(2) || '2,405.00'} /g ({kwdRate.toFixed(3)} KWD)
            </span>
          </div>
          <div style={{ width: '1px', height: '24px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
          <div>
            <span style={{ fontSize: '11px', color: '#9ca3af', display: 'block' }}>{t.ask_rate}</span>
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#F3BA2F' }}>
              ${priceFeed?.askPrice.toFixed(2) || '2,408.50'} /g ({(kwdRate * 1.002).toFixed(3)} KWD)
            </span>
          </div>
        </div>

        {/* Customer Selector & Language & Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Customer Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <i className="fa-solid fa-user-circle" style={{ color: '#F3BA2F', fontSize: '16px' }}></i>
            <select
              style={{
                background: '#111c33',
                color: '#fff',
                border: '1px solid rgba(212, 175, 55, 0.4)',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '13px',
                fontWeight: 'bold',
                cursor: loadingCustomers ? 'not-allowed' : 'pointer'
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
                  {c.customerName} ({c.civilId}) — {c.totalGoldGrams}g Gold
                </option>
              ))}
            </select>
          </div>

          {/* Lang toggle */}
          <button
            onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
            style={{
              background: '#1f293d',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '6px',
              padding: '6px 10px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            {lang === 'en' ? 'العربية' : 'English'}
          </button>

          {/* Switch to PMIMS */}
          {onBackToPmims && (
            <button
              onClick={onBackToPmims}
              style={{
                background: 'linear-gradient(135deg, #009B4E 0%, #006835 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '7px 14px',
                fontSize: '12px',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0, 155, 78, 0.4)'
              }}
            >
              <i className="fa-solid fa-vault"></i>
              {t.back_to_pmims}
            </button>
          )}
        </div>
      </header>

      {/* Live PMIMS Impact HUD Banner */}
      {pmimsImpact && (
        <div style={{
          background: 'linear-gradient(90deg, rgba(0, 155, 78, 0.25) 0%, rgba(212, 175, 55, 0.25) 100%)',
          borderBottom: '1px solid #009B4E',
          padding: '8px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '12px',
          animation: 'fadeIn 0.3s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              background: '#009B4E',
              color: '#fff',
              padding: '2px 8px',
              borderRadius: '4px',
              fontWeight: 'bold',
              fontSize: '11px'
            }}>
              {t.hud_title}
            </span>
            <span style={{ fontWeight: 'bold', color: '#F3BA2F' }}>
              {pmimsImpact.impactText}
            </span>
            <span style={{ color: '#d1d5db' }}>— {pmimsImpact.details}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#9ca3af', fontSize: '11px' }}>{pmimsImpact.timestamp}</span>
            {onBackToPmims && (
              <button
                onClick={onBackToPmims}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                Inspect in PMIMS <i className="fa-solid fa-arrow-right"></i>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sub-Navigation Tabs */}
      <nav style={{
        display: 'flex',
        gap: '4px',
        padding: '12px 24px 0',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: '#0a101d',
        overflowX: 'auto'
      }}>
        {[
          { id: 'profile', label: t.view_profile, icon: 'fa-id-card' },
          { id: 'buy', label: t.view_buy, icon: 'fa-cart-shopping' },
          { id: 'sell', label: t.view_sell, icon: 'fa-sack-dollar' },
          { id: 'gift', label: t.view_gift, icon: 'fa-gift' },
          { id: 'branch-delivery', label: t.view_branch_del, icon: 'fa-building-columns' },
          { id: 'home-delivery', label: t.view_home_del, icon: 'fa-truck-fast' },
          { id: 'scanner', label: t.view_scanner, icon: 'fa-qrcode' },
          { id: 'sync', label: t.view_sync, icon: 'fa-rotate' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id as any)}
            style={{
              padding: '10px 18px',
              fontSize: '13px',
              fontWeight: activeView === tab.id ? '700' : '500',
              color: activeView === tab.id ? '#F3BA2F' : '#9ca3af',
              background: activeView === tab.id ? 'rgba(243, 186, 47, 0.1)' : 'transparent',
              border: 'none',
              borderBottom: activeView === tab.id ? '3px solid #F3BA2F' : '3px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap'
            }}
          >
            <i className={`fa-solid ${tab.icon}`}></i>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Main Content Area */}
      <main style={{ padding: '24px 24px 100px 24px', maxWidth: '1400px', margin: '0 auto', minHeight: 'calc(100vh - 140px)' }}>

        {/* 1. CUSTOMER PROFILE HUB */}
        {activeView === 'profile' && selectedCustomer && (
          <div>
            {/* Wealth & Account Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              <div style={{
                background: 'linear-gradient(135deg, #111c33 0%, #152445 100%)',
                border: '1px solid rgba(212, 175, 55, 0.3)',
                borderRadius: '12px',
                padding: '18px',
                boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
              }}>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>{t.active_customer}</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#fff' }}>{selectedCustomer.customerName}</div>
                <div style={{ fontSize: '12px', color: '#F3BA2F', marginTop: '4px' }}>
                  PACI Civil ID: {selectedCustomer.civilId} • Acc: {selectedCustomer.accountNumber}
                </div>
              </div>

              <div style={{
                background: 'linear-gradient(135deg, #111c33 0%, #152445 100%)',
                border: '1px solid rgba(0, 155, 78, 0.3)',
                borderRadius: '12px',
                padding: '18px',
                boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
              }}>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>{t.cash_balance}</div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#10b981' }}>
                  {selectedCustomer.cashBalance.toLocaleString()} {t.currency}
                </div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                  Available for instant gold purchases
                </div>
              </div>

              <div style={{
                background: 'linear-gradient(135deg, #111c33 0%, #152445 100%)',
                border: '1px solid rgba(212, 175, 55, 0.4)',
                borderRadius: '12px',
                padding: '18px',
                boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
              }}>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>{t.gold_holdings}</div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#F3BA2F' }}>
                  {selectedCustomer.totalGoldGrams.toLocaleString()} Grams
                </div>
                <div style={{ fontSize: '12px', color: '#d1d5db', marginTop: '4px' }}>
                  {selectedCustomer.holdingsCount} physical bar(s) held in KFH Main Vault
                </div>
              </div>

              <div style={{
                background: 'linear-gradient(135deg, #111c33 0%, #152445 100%)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                padding: '18px',
                boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
              }}>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>{t.market_val}</div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#60a5fa' }}>
                  {(selectedCustomer.totalGoldGrams * kwdRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t.currency}
                </div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                  Based on live bid rate (${priceFeed?.bidPrice || '2405.00'}/g)
                </div>
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
              <button onClick={() => setActiveView('buy')} style={{ padding: '10px 18px', borderRadius: '8px', background: 'linear-gradient(135deg, #D4AF37, #AA771C)', color: '#070b14', border: 'none', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <i className="fa-solid fa-plus-circle"></i> {t.view_buy}
              </button>
              <button onClick={() => setActiveView('sell')} style={{ padding: '10px 18px', borderRadius: '8px', background: '#1f293d', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <i className="fa-solid fa-hand-holding-dollar"></i> {t.view_sell}
              </button>
              <button onClick={() => setActiveView('gift')} style={{ padding: '10px 18px', borderRadius: '8px', background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <i className="fa-solid fa-gift"></i> {t.view_gift}
              </button>
              <button onClick={() => setActiveView('branch-delivery')} style={{ padding: '10px 18px', borderRadius: '8px', background: '#1f293d', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <i className="fa-solid fa-building-columns"></i> {t.view_branch_del}
              </button>
              <button onClick={() => setActiveView('home-delivery')} style={{ padding: '10px 18px', borderRadius: '8px', background: '#1f293d', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <i className="fa-solid fa-truck-fast"></i> {t.view_home_del}
              </button>
            </div>

            {/* Custody Bars Table */}
            <div style={{
              background: '#0d1526',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
            }}>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <i className="fa-solid fa-vault" style={{ color: '#F3BA2F' }}></i>
                {t.owned_bars} ({selectedCustomer.bars.length})
              </div>

              {selectedCustomer.bars.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>
                  <i className="fa-solid fa-box-open" style={{ fontSize: '48px', color: '#374151', marginBottom: '12px' }}></i>
                  <div>{t.no_bars}</div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', textAlign: lang === 'ar' ? 'right' : 'left' }}>
                        <th style={{ padding: '10px' }}>{t.serial_num}</th>
                        <th style={{ padding: '10px' }}>{t.denomination}</th>
                        <th style={{ padding: '10px' }}>{t.weight}</th>
                        <th style={{ padding: '10px' }}>{t.purity}</th>
                        <th style={{ padding: '10px' }}>{t.vault_loc}</th>
                        <th style={{ padding: '10px' }}>{t.allocated_at}</th>
                        <th style={{ padding: '10px' }}>Status / Tag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedCustomer.bars.map((bar, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '12px 10px', fontWeight: 'bold', color: '#F3BA2F' }}>
                            <i className="fa-solid fa-barcode" style={{ marginRight: '6px' }}></i>
                            {bar.serialNumber}
                          </td>
                          <td style={{ padding: '12px 10px', color: '#fff' }}>{bar.denomination}</td>
                          <td style={{ padding: '12px 10px', fontWeight: 'bold' }}>{bar.weightGrams}g</td>
                          <td style={{ padding: '12px 10px', color: '#10b981' }}>{bar.purity}</td>
                          <td style={{ padding: '12px 10px', color: '#9ca3af' }}>
                            <i className="fa-solid fa-location-dot" style={{ color: '#ef4444', marginRight: '4px' }}></i>
                            {bar.vaultLocation}
                          </td>
                          <td style={{ padding: '12px 10px', color: '#9ca3af' }}>
                            {new Date(bar.allocationDate).toLocaleDateString()}
                          </td>
                          <td style={{ padding: '12px 10px' }}>
                            {bar.giftTag ? (
                              <span style={{ background: 'rgba(139, 92, 246, 0.2)', color: '#c084fc', border: '1px solid #8b5cf6', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>
                                <i className="fa-solid fa-gift"></i> {bar.giftTag}
                              </span>
                            ) : (
                              <span style={{ background: 'rgba(0, 155, 78, 0.2)', color: '#34d399', border: '1px solid #009B4E', padding: '2px 8px', borderRadius: '4px', fontSize: '11px' }}>
                                Custody Held
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. BUY GOLD VIEW */}
        {activeView === 'buy' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#F3BA2F' }}>
                <i className="fa-solid fa-cart-shopping"></i> {t.view_buy}
              </div>
              <span style={{ fontSize: '12px', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '3px 10px', borderRadius: '20px' }}>
                <i className="fa-solid fa-bolt"></i> Instant Physical Vault Allocation
              </span>
            </div>
            <div style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '20px' }}>
              Browse real-time available gold inventory in KFH Main Vault and buy with instant Sharia physical allocation.
            </div>

            {loadingInventory ? (
              <div style={{ padding: '60px', textAlign: 'center', color: '#9ca3af', background: '#0d1526', borderRadius: '12px' }}>
                <i className="fa-solid fa-circle-notch fa-spin" style={{ fontSize: '24px', color: '#F3BA2F', marginBottom: '12px', display: 'block' }}></i>
                Loading live PMIMS vault inventory...
              </div>
            ) : availableDenoms.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', background: '#0d1526', borderRadius: '12px', color: '#9ca3af' }}>
                <i className="fa-solid fa-vault" style={{ fontSize: '32px', color: '#6b7280', marginBottom: '12px', display: 'block' }}></i>
                No gold bars currently available for sale in PMIMS vault. Check back after incoming shipment intake.
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '24px',
                alignItems: 'start'
              }}>
                {/* Left Column: Denominations Catalog */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#e5e7eb', marginBottom: '-4px' }}>
                    Available Denominations ({availableDenoms.length})
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
                    {availableDenoms.map((denom, idx) => {
                      const isSelected = selectedDenom?.denomination === denom.denomination;
                      const itemCostKwd = denom.weightGrams * kwdRate;

                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            setSelectedDenom(denom);
                            setBuyQuantity(1);
                          }}
                          style={{
                            background: isSelected ? 'linear-gradient(135deg, #152445 0%, #1e335f 100%)' : '#0d1526',
                            border: isSelected ? '2px solid #F3BA2F' : '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '12px',
                            padding: '18px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            position: 'relative',
                            boxShadow: isSelected ? '0 0 20px rgba(243, 186, 47, 0.35)' : '0 2px 8px rgba(0,0,0,0.3)',
                            transform: isSelected ? 'translateY(-2px)' : 'none'
                          }}
                        >
                          {isSelected && (
                            <div style={{
                              position: 'absolute',
                              top: '-8px',
                              right: lang === 'ar' ? 'auto' : '12px',
                              left: lang === 'ar' ? '12px' : 'auto',
                              background: '#F3BA2F',
                              color: '#070b14',
                              fontSize: '10px',
                              fontWeight: '900',
                              padding: '2px 8px',
                              borderRadius: '10px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px'
                            }}>
                              Selected
                            </div>
                          )}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                            <div>
                              <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff' }}>{denom.denomination}</div>
                              <div style={{ fontSize: '12px', color: '#F3BA2F', fontWeight: 'bold', marginTop: '2px' }}>
                                {denom.weightGrams}g Gold • 99.99% Fine
                              </div>
                            </div>
                            <span style={{
                              background: 'rgba(0, 155, 78, 0.2)',
                              color: '#34d399',
                              border: '1px solid #009B4E',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 'bold'
                            }}>
                              {denom.availableQuantity} in vault
                            </span>
                          </div>

                          <div style={{ fontSize: '19px', fontWeight: '800', color: '#10b981', margin: '10px 0 4px' }}>
                            {itemCostKwd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t.currency}
                          </div>
                          <div style={{ fontSize: '11px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <i className="fa-solid fa-vault" style={{ color: '#F3BA2F' }}></i> KFH Main Vault • Shelf 1
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right Column: Sticky Purchase Order & Allocation Confirmation Panel */}
                <div style={{ position: 'sticky', top: '24px' }}>
                  {selectedDenom ? (
                    <div style={{
                      background: 'linear-gradient(180deg, #0d1526 0%, #111c33 100%)',
                      border: '2px solid #F3BA2F',
                      borderRadius: '16px',
                      padding: '24px',
                      boxShadow: '0 8px 30px rgba(0,0,0,0.6)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(243, 186, 47, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F3BA2F' }}>
                          <i className="fa-solid fa-receipt"></i>
                        </div>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                            Purchase & Allocation
                          </div>
                          <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                            Physical Sharia Gold Order
                          </div>
                        </div>
                      </div>

                      {/* Customer Info */}
                      {selectedCustomer && (
                        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px', fontSize: '12px' }}>
                          <div style={{ color: '#9ca3af', marginBottom: '2px' }}>Beneficiary Customer:</div>
                          <div style={{ fontWeight: 'bold', color: '#fff' }}>{selectedCustomer.customerName}</div>
                          <div style={{ color: '#6b7280', fontSize: '11px' }}>Civil ID: {selectedCustomer.civilId}</div>
                        </div>
                      )}

                      {/* Product details */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '13px' }}>
                        <span style={{ color: '#9ca3af' }}>Selected Bar:</span>
                        <span style={{ fontWeight: 'bold', color: '#fff' }}>{selectedDenom.denomination}</span>
                      </div>

                      {/* Quantity selector */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', fontSize: '13px' }}>
                        <span style={{ color: '#9ca3af' }}>{t.qty}:</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#0a0f1d', padding: '4px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)' }}>
                          <button
                            onClick={() => setBuyQuantity(Math.max(1, buyQuantity - 1))}
                            style={{ width: '28px', height: '28px', borderRadius: '4px', background: '#1f293d', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                          >-</button>
                          <span style={{ fontWeight: 'bold', padding: '0 8px', minWidth: '24px', textAlign: 'center', color: '#F3BA2F' }}>{buyQuantity}</span>
                          <button
                            onClick={() => setBuyQuantity(Math.min(selectedDenom.availableQuantity, buyQuantity + 1))}
                            style={{ width: '28px', height: '28px', borderRadius: '4px', background: '#1f293d', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                          >+</button>
                        </div>
                      </div>

                      {/* Total Weight */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', fontSize: '13px' }}>
                        <span style={{ color: '#9ca3af' }}>Total Physical Weight:</span>
                        <span style={{ fontWeight: 'bold', color: '#F3BA2F' }}>
                          {(selectedDenom.weightGrams * buyQuantity).toLocaleString()} g <span style={{ fontSize: '11px', color: '#9ca3af' }}>({((selectedDenom.weightGrams * buyQuantity) / 1000).toFixed(3)} KG)</span>
                        </span>
                      </div>

                      {/* Unit Price & Total Cost */}
                      <div style={{ background: 'rgba(0, 155, 78, 0.08)', border: '1px solid rgba(0, 155, 78, 0.25)', borderRadius: '10px', padding: '12px 14px', marginBottom: '18px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                          <span>Rate per gram:</span>
                          <span>{kwdRate.toFixed(3)} KWD/g</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 'bold', color: '#e5e7eb', fontSize: '14px' }}>{t.total_cost}:</span>
                          <span style={{ fontWeight: '900', color: '#10b981', fontSize: '22px' }}>
                            {(selectedDenom.weightGrams * buyQuantity * kwdRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t.currency}
                          </span>
                        </div>
                      </div>

                      {/* Buy Action Button */}
                      <button
                        onClick={handleBuyGold}
                        disabled={buying}
                        style={{
                          width: '100%',
                          padding: '14px',
                          borderRadius: '10px',
                          background: 'linear-gradient(135deg, #F3BA2F 0%, #D4AF37 50%, #AA771C 100%)',
                          color: '#070b14',
                          border: 'none',
                          fontSize: '15px',
                          fontWeight: '900',
                          cursor: buying ? 'not-allowed' : 'pointer',
                          boxShadow: '0 4px 20px rgba(243, 186, 47, 0.4)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {buying ? (
                          <>
                            <i className="fa-solid fa-circle-notch fa-spin"></i> Processing Allocation...
                          </>
                        ) : (
                          <>
                            <i className="fa-solid fa-lock"></i> {t.buy_btn}
                          </>
                        )}
                      </button>
                      <div style={{ fontSize: '10px', color: '#6b7280', textAlign: 'center', marginTop: '10px' }}>
                        <i className="fa-solid fa-shield-halved" style={{ color: '#10b981' }}></i> Instant serial reservation & custody certificate issued
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      background: '#0d1526',
                      border: '1px dashed rgba(255,255,255,0.15)',
                      borderRadius: '16px',
                      padding: '36px 24px',
                      textAlign: 'center',
                      color: '#9ca3af'
                    }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(243, 186, 47, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F3BA2F', margin: '0 auto 12px', fontSize: '20px' }}>
                        <i className="fa-solid fa-arrow-pointer"></i>
                      </div>
                      <div style={{ fontWeight: 'bold', color: '#fff', fontSize: '14px', marginBottom: '4px' }}>
                        Select a Gold Bar
                      </div>
                      <div style={{ fontSize: '12px' }}>
                        Click on any available gold denomination on the left to preview pricing, weight, and complete physical allocation.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3. SELL GOLD VIEW */}
        {activeView === 'sell' && selectedCustomer && (
          <div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#10b981', marginBottom: '8px' }}>
              <i className="fa-solid fa-hand-holding-dollar"></i> {t.view_sell}
            </div>
            <div style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '20px' }}>
              Liquidate physical gold bars from your custody back to KFH at live market bid rates. Funds are immediately credited to your account.
            </div>

            {selectedCustomer.bars.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', background: '#0d1526', borderRadius: '12px', color: '#9ca3af' }}>
                You do not currently own any gold bars in custody to sell.
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '24px',
                alignItems: 'start'
              }}>
                {/* Left Column: Bars in Custody */}
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#e5e7eb', marginBottom: '12px' }}>
                    Select Bars in Custody ({selectedCustomer.bars.length})
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
                    {selectedCustomer.bars.map((bar, idx) => {
                      const isChecked = selectedBarsToSell.includes(bar.itemId);
                      const barPayout = bar.weightGrams * kwdRate;

                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            if (isChecked) {
                              setSelectedBarsToSell(selectedBarsToSell.filter(id => id !== bar.itemId));
                            } else {
                              setSelectedBarsToSell([...selectedBarsToSell, bar.itemId]);
                            }
                          }}
                          style={{
                            background: isChecked ? 'linear-gradient(135deg, #152445 0%, #1e335f 100%)' : '#0d1526',
                            border: isChecked ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '12px',
                            padding: '18px',
                            cursor: 'pointer',
                            boxShadow: isChecked ? '0 0 15px rgba(16, 185, 129, 0.3)' : '0 2px 8px rgba(0,0,0,0.3)',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <div style={{ fontWeight: 'bold', color: '#F3BA2F' }}>
                              <i className="fa-solid fa-barcode" style={{ marginRight: '6px' }}></i>
                              {bar.serialNumber}
                            </div>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              style={{ transform: 'scale(1.2)', cursor: 'pointer' }}
                            />
                          </div>
                          <div style={{ fontSize: '13px', color: '#fff' }}>{bar.denomination} ({bar.weightGrams}g)</div>
                          <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>Location: {bar.vaultLocation}</div>
                          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#10b981', marginTop: '10px' }}>
                            Payout: {barPayout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t.currency}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right Column: Sticky Sell Confirmation */}
                <div style={{ position: 'sticky', top: '24px' }}>
                  {selectedBarsToSell.length > 0 ? (
                    <div style={{
                      background: 'linear-gradient(180deg, #0d1526 0%, #111c33 100%)',
                      border: '2px solid #10b981',
                      borderRadius: '16px',
                      padding: '24px',
                      boxShadow: '0 8px 30px rgba(0,0,0,0.6)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
                          <i className="fa-solid fa-hand-holding-dollar"></i>
                        </div>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                            Sale & Liquidation
                          </div>
                          <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                            Instant Account Credit
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
                        <span style={{ color: '#9ca3af' }}>Selected Bars:</span>
                        <span style={{ fontWeight: 'bold', color: '#fff' }}>{selectedBarsToSell.length} bar(s)</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '14px' }}>
                        <span style={{ color: '#9ca3af' }}>Total Weight to Sell:</span>
                        <span style={{ fontWeight: 'bold', color: '#F3BA2F' }}>
                          {selectedCustomer.bars.filter(b => selectedBarsToSell.includes(b.itemId)).reduce((sum, b) => sum + b.weightGrams, 0)} Grams
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', fontSize: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
                        <span style={{ fontWeight: 'bold' }}>{t.payout}:</span>
                        <span style={{ fontWeight: '800', color: '#10b981', fontSize: '20px' }}>
                          {(selectedCustomer.bars.filter(b => selectedBarsToSell.includes(b.itemId)).reduce((sum, b) => sum + b.weightGrams, 0) * kwdRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t.currency}
                        </span>
                      </div>
                      <button
                        onClick={handleSellGold}
                        disabled={selling}
                        style={{
                          width: '100%',
                          padding: '14px',
                          borderRadius: '10px',
                          background: 'linear-gradient(135deg, #10b981 0%, #047857 100%)',
                          color: '#fff',
                          border: 'none',
                          fontSize: '15px',
                          fontWeight: 'bold',
                          cursor: selling ? 'not-allowed' : 'pointer',
                          boxShadow: '0 4px 15px rgba(16, 185, 129, 0.4)'
                        }}
                      >
                        {selling ? 'Settling Sale...' : t.sell_btn}
                      </button>
                    </div>
                  ) : (
                    <div style={{
                      background: '#0d1526',
                      border: '1px dashed rgba(255,255,255,0.15)',
                      borderRadius: '16px',
                      padding: '36px 24px',
                      textAlign: 'center',
                      color: '#9ca3af'
                    }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981', margin: '0 auto 12px', fontSize: '20px' }}>
                        <i className="fa-solid fa-hand-holding-dollar"></i>
                      </div>
                      <div style={{ fontWeight: 'bold', color: '#fff', fontSize: '14px', marginBottom: '4px' }}>
                        Select Bars to Liquidate
                      </div>
                      <div style={{ fontSize: '12px' }}>
                        Select one or more gold bars from your custody to calculate payout and settle sale.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 4. GIFT GOLD TRANSFER VIEW */}
        {activeView === 'gift' && selectedCustomer && (
          <div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#c084fc', marginBottom: '8px' }}>
              <i className="fa-solid fa-gift"></i> {t.view_gift}
            </div>
            <div style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '20px' }}>
              Transfer physical gold bars securely from your custody to another KFH customer as a personalized digital gift card. The gold stays vaulted in KFH custody with ownership transferred immediately.
            </div>

            {selectedCustomer.bars.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', background: '#0d1526', borderRadius: '12px', color: '#9ca3af' }}>
                You do not currently own any gold bars to send as a gift.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
                {/* Step 1: Select Bars */}
                <div style={{ background: '#0d1526', borderRadius: '12px', padding: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff', marginBottom: '14px' }}>
                    1. Select Gold Bar(s) to Gift
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {selectedCustomer.bars.map((bar, idx) => {
                      const isChecked = selectedBarsToGift.includes(bar.itemId);
                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            if (isChecked) {
                              setSelectedBarsToGift(selectedBarsToGift.filter(id => id !== bar.itemId));
                            } else {
                              setSelectedBarsToGift([...selectedBarsToGift, bar.itemId]);
                            }
                          }}
                          style={{
                            background: isChecked ? 'rgba(139, 92, 246, 0.2)' : '#111c33',
                            border: isChecked ? '1px solid #8b5cf6' : '1px solid rgba(255,255,255,0.05)',
                            borderRadius: '8px',
                            padding: '12px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            cursor: 'pointer'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 'bold', color: '#F3BA2F', fontSize: '13px' }}>{bar.serialNumber}</div>
                            <div style={{ fontSize: '12px', color: '#9ca3af' }}>{bar.denomination} ({bar.weightGrams}g)</div>
                          </div>
                          <input type="checkbox" checked={isChecked} onChange={() => {}} style={{ transform: 'scale(1.2)' }} />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Step 2: Gift Details & Recipient */}
                <div style={{ background: '#0d1526', borderRadius: '12px', padding: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff', marginBottom: '14px' }}>
                    2. Recipient & Occasion Details
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>{t.recipient}</label>
                    <select
                      value={recipientCustomerId}
                      onChange={(e) => setRecipientCustomerId(e.target.value)}
                      style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '8px' }}
                    >
                      <option value="">-- Choose Recipient Customer --</option>
                      {customers.filter(c => c.customerId !== selectedCustomer.customerId).map(c => (
                        <option key={c.customerId} value={c.customerId}>
                          {c.customerName} (Civil ID: {c.civilId})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>{t.occasion}</label>
                    <select
                      value={giftOccasion}
                      onChange={(e) => setGiftOccasion(e.target.value)}
                      style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '8px' }}
                    >
                      <option value="Eid Mubarak">Eid Mubarak / عيد مبارك</option>
                      <option value="Wedding / Marriage">Wedding / تهنئة زواج</option>
                      <option value="Graduation">Graduation / تخرج ومبروك</option>
                      <option value="Newborn / Aqiqah">Newborn / مولود جديد</option>
                      <option value="Investment / Wealth Gift">Investment Gift / هدية استثمارية</option>
                      <option value="Corporate / Appreciation">Appreciation / شكر وتقدير</option>
                    </select>
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>{t.message}</label>
                    <textarea
                      value={giftMessage}
                      onChange={(e) => setGiftMessage(e.target.value)}
                      rows={3}
                      style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '8px', fontSize: '13px' }}
                      placeholder="Write your dedication message here..."
                    />
                  </div>

                  <button
                    onClick={handleGiftGold}
                    disabled={gifting || selectedBarsToGift.length === 0 || !recipientCustomerId}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '8px',
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                      color: '#fff',
                      border: 'none',
                      fontSize: '15px',
                      fontWeight: 'bold',
                      cursor: (gifting || selectedBarsToGift.length === 0 || !recipientCustomerId) ? 'not-allowed' : 'pointer',
                      boxShadow: '0 4px 15px rgba(139, 92, 246, 0.4)'
                    }}
                  >
                    {gifting ? 'Processing Gift Transfer...' : t.gift_btn}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 5. BRANCH DELIVERY (BRD UC04 / UC05) */}
        {activeView === 'branch-delivery' && selectedCustomer && (
          <div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#38bdf8', marginBottom: '8px' }}>
              <i className="fa-solid fa-building-columns"></i> {t.view_branch_del}
            </div>
            <div style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '20px' }}>
              Request physical dispatch of your gold bar from KFH Main Vault to any KFH Branch for in-person branch pickup.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '24px' }}>
              {/* Form */}
              <div style={{ background: '#0d1526', borderRadius: '12px', padding: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff', marginBottom: '14px' }}>
                  Create Branch Delivery Request
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>Select Gold Bar from Custody</label>
                  <select
                    value={selectedBarForBranchDelivery || ''}
                    onChange={(e) => setSelectedBarForBranchDelivery(Number(e.target.value))}
                    style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '8px' }}
                  >
                    <option value="">-- Choose Gold Bar --</option>
                    {selectedCustomer.bars.map(b => (
                      <option key={b.itemId} value={b.itemId}>
                        {b.serialNumber} - {b.denomination} ({b.weightGrams}g)
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>{t.destination_branch}</label>
                  <select
                    value={destBranchId}
                    onChange={(e) => setDestBranchId(Number(e.target.value))}
                    style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '8px' }}
                  >
                    <option value={2}>Shuwaikh Industrial Branch (Branch #2)</option>
                    <option value={3}>Sharq Financial District Branch (Branch #3)</option>
                    <option value={4}>Salmiya Commercial Branch (Branch #4)</option>
                    <option value={5}>Al-Rayyan Branch (Branch #5)</option>
                    <option value={6}>Ahmadi Governorate Branch (Branch #6)</option>
                  </select>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>Route Details & Transit Notes</label>
                  <textarea
                    value={routeNotes}
                    onChange={(e) => setRouteNotes(e.target.value)}
                    rows={2}
                    style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '8px', fontSize: '13px' }}
                  />
                </div>

                <button
                  onClick={handleBranchDelivery}
                  disabled={submittingBranchDelivery || !selectedBarForBranchDelivery}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                    color: '#fff',
                    border: 'none',
                    fontSize: '15px',
                    fontWeight: 'bold',
                    cursor: (submittingBranchDelivery || !selectedBarForBranchDelivery) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {submittingBranchDelivery ? 'Creating Request...' : t.dispatch_request}
                </button>
              </div>

              {/* In-Flight Delivery Log */}
              <div style={{ background: '#0d1526', borderRadius: '12px', padding: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff', marginBottom: '14px' }}>
                  Active Branch Delivery Tracking ({branchDeliveryRequests.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '350px', overflowY: 'auto' }}>
                  {branchDeliveryRequests.map((req, idx) => (
                    <div key={idx} style={{ background: '#111c33', borderRadius: '8px', padding: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 'bold', color: '#38bdf8' }}>{req.gfsRefNumber}</span>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          background: req.status === 'RECEIVED' ? 'rgba(0, 155, 78, 0.2)' : (req.status === 'DISPATCHED' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(243, 186, 47, 0.2)'),
                          color: req.status === 'RECEIVED' ? '#34d399' : (req.status === 'DISPATCHED' ? '#38bdf8' : '#F3BA2F')
                        }}>
                          {req.status}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#d1d5db', marginTop: '4px' }}>
                        Bar: {req.bar?.serialNumber || `#${req.barId}`} • Dest Branch: {req.destinationBranch?.branchName || `#${req.destinationBranchId}`}
                      </div>
                      {req.courierCompany && (
                        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                          Courier: {req.courierCompany} (Rep: {req.courierRepName}, Seal: {req.securitySealNumber})
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 6. HOME DELIVERY (BRD UC07) */}
        {activeView === 'home-delivery' && selectedCustomer && (
          <div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#ec4899', marginBottom: '8px' }}>
              <i className="fa-solid fa-truck-fast"></i> {t.view_home_del}
            </div>
            <div style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '20px' }}>
              Request secure physical home delivery of your gold bars to your residential address with 6-digit OTP verification upon courier handover.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '24px' }}>
              {/* Home Delivery Form */}
              <div style={{ background: '#0d1526', borderRadius: '12px', padding: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff', marginBottom: '14px' }}>
                  {t.home_address}
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>Select Gold Bar from Custody</label>
                  <select
                    value={selectedBarForHomeDelivery || ''}
                    onChange={(e) => setSelectedBarForHomeDelivery(Number(e.target.value))}
                    style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '8px' }}
                  >
                    <option value="">-- Choose Gold Bar --</option>
                    {selectedCustomer.bars.map(b => (
                      <option key={b.itemId} value={b.itemId}>
                        {b.serialNumber} - {b.denomination} ({b.weightGrams}g)
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: '#9ca3af', display: 'block' }}>{t.governorate}</label>
                    <input type="text" value={hdGovernorate} onChange={(e) => setHdGovernorate(e.target.value)} style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '6px' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#9ca3af', display: 'block' }}>{t.area}</label>
                    <input type="text" value={hdArea} onChange={(e) => setHdArea(e.target.value)} style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '6px' }} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: '#9ca3af', display: 'block' }}>{t.block}</label>
                    <input type="text" value={hdBlock} onChange={(e) => setHdBlock(e.target.value)} style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '6px' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#9ca3af', display: 'block' }}>{t.street}</label>
                    <input type="text" value={hdStreet} onChange={(e) => setHdStreet(e.target.value)} style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '6px' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#9ca3af', display: 'block' }}>{t.building}</label>
                    <input type="text" value={hdBuilding} onChange={(e) => setHdBuilding(e.target.value)} style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '6px' }} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: '#9ca3af', display: 'block' }}>Floor / Apartment</label>
                    <input type="text" value={hdFloor} onChange={(e) => setHdFloor(e.target.value)} style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '6px' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#9ca3af', display: 'block' }}>Contact Phone</label>
                    <input type="text" value={hdPhone} onChange={(e) => setHdPhone(e.target.value)} style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '6px' }} />
                  </div>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '11px', color: '#9ca3af', display: 'block' }}>Delivery Instructions</label>
                  <input type="text" value={hdInstructions} onChange={(e) => setHdInstructions(e.target.value)} style={{ width: '100%', background: '#111c33', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '6px' }} />
                </div>

                <button
                  onClick={handleHomeDelivery}
                  disabled={submittingHomeDelivery || !selectedBarForHomeDelivery}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
                    color: '#fff',
                    border: 'none',
                    fontSize: '15px',
                    fontWeight: 'bold',
                    cursor: (submittingHomeDelivery || !selectedBarForHomeDelivery) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {submittingHomeDelivery ? 'Submitting Delivery...' : t.submit_hd}
                </button>
              </div>

              {/* Active Home Deliveries Tracking */}
              <div style={{ background: '#0d1526', borderRadius: '12px', padding: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff', marginBottom: '14px' }}>
                  Home Delivery Tracking ({homeDeliveryRequests.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '350px', overflowY: 'auto' }}>
                  {homeDeliveryRequests.map((hd, idx) => (
                    <div key={idx} style={{ background: '#111c33', borderRadius: '8px', padding: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 'bold', color: '#ec4899' }}>{hd.deliveryNumber}</span>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          background: hd.status === 'DELIVERED_TO_CUSTOMER' ? 'rgba(0, 155, 78, 0.2)' : 'rgba(236, 72, 153, 0.2)',
                          color: hd.status === 'DELIVERED_TO_CUSTOMER' ? '#34d399' : '#ec4899'
                        }}>
                          {hd.status}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#d1d5db', marginTop: '4px' }}>
                        Bar: {hd.bar?.serialNumber || `#${hd.barId}`} • Addr: {hd.area}, Block {hd.block}
                      </div>
                      <div style={{ fontSize: '12px', color: '#F3BA2F', marginTop: '4px', fontWeight: 'bold' }}>
                        <i className="fa-solid fa-key" style={{ marginRight: '4px' }}></i> Verification OTP: {hd.verificationOtp}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 7. LIVE BAR SCANNER (BRD UC02 / UC12) */}
        {activeView === 'scanner' && (
          <div style={{ maxWidth: '800px' }}>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#F3BA2F', marginBottom: '8px' }}>
              <i className="fa-solid fa-qrcode"></i> {t.view_scanner}
            </div>
            <div style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '20px' }}>
              Scan or enter GS1/ISO gold bar barcode or serial number to query real-time GFS ownership, customer account, average purchase cost, and physical vault status.
            </div>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              <input
                type="text"
                value={scanQuery}
                onChange={(e) => setScanQuery(e.target.value)}
                placeholder="Enter bar serial (e.g. BAR-SUP-2015-01 or (01)06291100000017(21)...)"
                style={{ flex: 1, background: '#0d1526', color: '#fff', border: '1px solid rgba(212, 175, 55, 0.4)', borderRadius: '8px', padding: '12px', fontSize: '14px' }}
              />
              <button
                onClick={handleScanQr}
                disabled={scanning || !scanQuery}
                style={{ padding: '12px 24px', background: 'linear-gradient(135deg, #D4AF37, #AA771C)', color: '#070b14', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {scanning ? 'Looking up...' : 'Scan / Lookup'}
              </button>
            </div>

            {scanResult && (
              <div style={{ background: '#0d1526', border: '1px solid #009B4E', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#34d399', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-circle-check"></i> Verified Live Bar Record (GFS & PMIMS)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Serial Number:</span> <span style={{ fontWeight: 'bold', color: '#F3BA2F' }}>{scanResult.serialNumber}</span></div>
                  <div><span style={{ color: '#9ca3af' }}>Ownership:</span> <span style={{ fontWeight: 'bold', color: '#fff' }}>{scanResult.ownershipType}</span></div>
                  <div><span style={{ color: '#9ca3af' }}>Product:</span> <span style={{ fontWeight: 'bold' }}>{scanResult.product?.productName || 'Gold Bar'}</span></div>
                  <div><span style={{ color: '#9ca3af' }}>Status:</span> <span style={{ fontWeight: 'bold', color: '#10b981' }}>{scanResult.statusCode}</span></div>
                  <div><span style={{ color: '#9ca3af' }}>Customer Account:</span> <span style={{ fontWeight: 'bold', color: '#60a5fa' }}>{scanResult.customerAccountNumber || 'KFH Proprietary Inventory'}</span></div>
                  <div><span style={{ color: '#9ca3af' }}>Avg Purchase Cost:</span> <span style={{ fontWeight: 'bold' }}>${scanResult.averagePurchaseCost || '0.00'}</span></div>
                  <div><span style={{ color: '#9ca3af' }}>Physical Location:</span> <span style={{ fontWeight: 'bold' }}>{scanResult.location ? `${scanResult.location.zoneRoom} / ${scanResult.location.shelfRow} / ${scanResult.location.slotBin}` : 'Main Vault'}</span></div>
                  <div><span style={{ color: '#9ca3af' }}>Damage Status:</span> <span style={{ fontWeight: 'bold', color: scanResult.isDamaged ? '#ef4444' : '#10b981' }}>{scanResult.isDamaged ? 'DAMAGED' : 'INTACT / CERTIFIED'}</span></div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 8. GFS EOD SETTLEMENT (BRD UC08) */}
        {activeView === 'sync' && (
          <div style={{ maxWidth: '800px' }}>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#F3BA2F', marginBottom: '8px' }}>
              <i className="fa-solid fa-rotate"></i> {t.view_sync}
            </div>
            <div style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '20px' }}>
              Trigger automated End-of-Day (EOD) synchronization between GFS customer ledger and PMIMS physical bar vault registry to ensure zero-discrepancy inventory reconciliation.
            </div>

            <div style={{ background: '#0d1526', borderRadius: '12px', padding: '24px', border: '1px solid rgba(255,255,255,0.1)', marginBottom: '24px' }}>
              <button
                onClick={handleEodSync}
                disabled={syncing}
                style={{
                  padding: '14px 28px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #D4AF37 0%, #AA771C 100%)',
                  color: '#070b14',
                  border: 'none',
                  fontSize: '15px',
                  fontWeight: '800',
                  cursor: syncing ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <i className={`fa-solid fa-rotate ${syncing ? 'fa-spin' : ''}`}></i>
                {syncing ? 'Executing EOD Sync...' : t.sync_now}
              </button>
            </div>

            {/* Sync History */}
            {syncLogs.length > 0 && (
              <div style={{ background: '#0d1526', borderRadius: '12px', padding: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff', marginBottom: '14px' }}>
                  EOD Synchronization Audit Log
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {syncLogs.map((log, idx) => (
                    <div key={idx} style={{ background: '#111c33', borderRadius: '6px', padding: '10px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Sync #{log.syncId} • Executed by {log.executedBy}</span>
                      <span style={{ color: '#10b981', fontWeight: 'bold' }}>{log.totalItemsSynced} items synced ({log.status})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      {/* MODAL: BUY CERTIFICATE */}
      {buySuccessModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div style={{ background: '#0d1526', border: '2px solid #D4AF37', borderRadius: '16px', padding: '30px', maxWidth: '500px', width: '100%', boxShadow: '0 0 30px rgba(212,175,55,0.4)', textAlign: 'center' }}>
            <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(0, 155, 78, 0.2)', border: '2px solid #009B4E', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <i className="fa-solid fa-check" style={{ color: '#10b981', fontSize: '28px' }}></i>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#F3BA2F', marginBottom: '6px' }}>Physical Gold Purchase Confirmed!</div>
            <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '20px' }}>Sharia Physical Allocation Completed in KFH Main Vault</div>

            <div style={{ background: '#111c33', borderRadius: '8px', padding: '16px', textAlign: 'left', fontSize: '13px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span style={{ color: '#9ca3af' }}>Customer:</span> <span style={{ fontWeight: 'bold' }}>{buySuccessModal.customer}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span style={{ color: '#9ca3af' }}>Product:</span> <span>{buySuccessModal.denomination} (x{buySuccessModal.quantity})</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span style={{ color: '#9ca3af' }}>Total Weight:</span> <span style={{ color: '#F3BA2F', fontWeight: 'bold' }}>{buySuccessModal.totalGrams}g</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span style={{ color: '#9ca3af' }}>Allocated Serials:</span> <span style={{ color: '#34d399', fontWeight: 'bold' }}>{buySuccessModal.serials.join(', ')}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px' }}><span style={{ color: '#9ca3af' }}>Total Paid:</span> <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '15px' }}>${buySuccessModal.amount.toFixed(2)}</span></div>
            </div>

            <button onClick={() => setBuySuccessModal(null)} style={{ width: '100%', padding: '10px', background: 'linear-gradient(135deg, #D4AF37, #AA771C)', color: '#070b14', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
              Close Certificate
            </button>
          </div>
        </div>
      )}

      {/* MODAL: SELL SETTLEMENT CERTIFICATE */}
      {sellSuccessModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div style={{ background: '#0d1526', border: '2px solid #10b981', borderRadius: '16px', padding: '30px', maxWidth: '480px', width: '100%', textAlign: 'center' }}>
            <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.2)', border: '2px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#10b981', fontSize: '28px' }}>
              <i className="fa-solid fa-check"></i>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#10b981', marginBottom: '6px' }}>Gold Sale & Liquidation Settled!</div>
            <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '20px' }}>Proceeds credited to customer KFH Gold Account</div>

            <div style={{ background: '#111c33', borderRadius: '8px', padding: '16px', textAlign: 'left', fontSize: '13px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span style={{ color: '#9ca3af' }}>Customer:</span> <span style={{ fontWeight: 'bold' }}>{sellSuccessModal.customer}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span style={{ color: '#9ca3af' }}>Total Weight:</span> <span style={{ color: '#F3BA2F', fontWeight: 'bold' }}>{sellSuccessModal.totalGrams}g</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span style={{ color: '#9ca3af' }}>Liquidated Serials:</span> <span style={{ color: '#34d399', fontWeight: 'bold' }}>{sellSuccessModal.serials.join(', ')}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px' }}><span style={{ color: '#9ca3af' }}>Settlement Payout:</span> <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '15px' }}>${sellSuccessModal.payout.toFixed(2)}</span></div>
            </div>

            <button onClick={() => setSellSuccessModal(null)} style={{ width: '100%', padding: '10px', background: 'linear-gradient(135deg, #10b981, #047857)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* MODAL: GIFT CERTIFICATE */}
      {giftSuccessModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div style={{ background: 'linear-gradient(135deg, #131b2e 0%, #1c1538 100%)', border: '2px solid #8b5cf6', borderRadius: '20px', padding: '30px', maxWidth: '520px', width: '100%', boxShadow: '0 0 40px rgba(139, 92, 246, 0.4)', textAlign: 'center' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎁</div>
            <div style={{ fontSize: '22px', fontWeight: '800', color: '#c084fc', marginBottom: '4px' }}>Gold Gift Certificate</div>
            <div style={{ fontSize: '14px', color: '#F3BA2F', fontWeight: 'bold', marginBottom: '16px' }}>{giftSuccessModal.occasion}</div>

            <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px dashed #8b5cf6', borderRadius: '12px', padding: '20px', marginBottom: '20px', textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#9ca3af' }}>Presented to:</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#fff', margin: '4px 0 12px' }}>{giftSuccessModal.recipient}</div>
              <div style={{ fontSize: '14px', fontStyle: 'italic', color: '#d8b4fe', margin: '0 0 16px', lineHeight: '1.4' }}>
                "{giftSuccessModal.message}"
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px', fontSize: '12px', color: '#9ca3af', display: 'flex', justifyContent: 'space-between' }}>
                <span>From: <strong>{giftSuccessModal.sender}</strong></span>
                <span>Date: <strong>{giftSuccessModal.timestamp}</strong></span>
              </div>
            </div>

            <div style={{ fontSize: '12px', color: '#34d399', marginBottom: '16px' }}>
              ✓ Gold bar ownership transferred in KFH Vault registry & logged in PMIMS.
            </div>

            <button onClick={() => setGiftSuccessModal(null)} style={{ width: '100%', padding: '10px', background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* MODAL: HOME DELIVERY OTP */}
      {hdSuccessModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div style={{ background: '#0d1526', border: '2px solid #ec4899', borderRadius: '16px', padding: '30px', maxWidth: '480px', width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🚚</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#ec4899', marginBottom: '6px' }}>Home Delivery Scheduled</div>
            <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '20px' }}>Ref: {hdSuccessModal.deliveryNumber}</div>

            <div style={{ background: '#111c33', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '6px' }}>{t.otp_code} (Give to courier on arrival):</div>
              <div style={{ fontSize: '36px', fontWeight: '900', letterSpacing: '6px', color: '#F3BA2F' }}>
                {hdSuccessModal.verificationOtp}
              </div>
            </div>

            <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '20px' }}>
              The armored courier will verify this OTP along with your Civil ID upon physical handover.
            </div>

            <button onClick={() => setHdSuccessModal(null)} style={{ width: '100%', padding: '10px', background: 'linear-gradient(135deg, #ec4899, #db2777)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
              Got It
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
