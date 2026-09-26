import React, { useState, useMemo, useRef, useEffect } from 'react';
import Tesseract from 'tesseract.js';

const rawApiUrl = (import.meta as any).env?.VITE_API_URL;
const normalizeApiBase = (url?: string) => {
  if (!url) return null;
  const clean = url.replace(/\/+$/, '');
  return clean.endsWith('/api') ? clean : `${clean}/api`;
};

const API_BASE = (
  typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? (normalizeApiBase(rawApiUrl) || `http://${window.location.hostname}:8080/api`)
    : (normalizeApiBase(rawApiUrl) || 'https://api.aisoftwares.cloud/api')
);

// --- GS1 and ISO/IEC 18004 barcode/QR code parser ---
export const parseGs1Barcode = (rawInput: string): { serial: string; gtin: string; lot: string; denomination?: string; productType?: string } => {
  if (!rawInput) return { serial: '', gtin: '', lot: '' };

  // Check structured QR code payload:
  // Serial No: ...
  // Denomination: ...
  // Product Type: ...
  const serialMatch = rawInput.match(/(?:Serial\s*(?:No|Number)?|SN)[\s:]+([^\r\n]+)/i);
  if (serialMatch) {
    const denomMatch = rawInput.match(/Denomination[\s:]+([^\r\n]+)/i);
    const typeMatch = rawInput.match(/(?:Product(?:\s*Type)?|Type)[\s:]+([^\r\n]+)/i);
    return {
      gtin: '',
      serial: serialMatch[1].trim(),
      lot: '',
      denomination: denomMatch ? denomMatch[1].trim() : undefined,
      productType: typeMatch ? typeMatch[1].trim() : undefined
    };
  }

  // Standard GS1 string with parentheses e.g. (01)06291100000017(21)SN12345(10)LOT999
  const parenRegex = /^(?:\(01\)(\d{14}))?(?:\(21\)([^()]+))?(?:\(10\)([^()]+))?$/;
  const match = rawInput.match(parenRegex);
  if (match && (match[1] || match[2] || match[3])) {
    return {
      gtin: match[1] || '',
      serial: match[2] || '',
      lot: match[3] || ''
    };
  }

  // FNC1/raw GS1 syntax parsing
  const clean = rawInput.replace(/^\]Q3|^\]C1/, '');
  let serial = '';
  let gtin = '';
  let lot = '';
  
  let i = 0;
  while (i < clean.length) {
    if (clean.substring(i).startsWith('01') && clean.length >= i + 16) {
      gtin = clean.substring(i + 2, i + 16);
      i += 16;
    } else if (clean.substring(i).startsWith('21')) {
      const sub = clean.substring(i + 2);
      let gsIdx = sub.indexOf('\u001d');
      if (gsIdx === -1) gsIdx = sub.indexOf('|');
      const len = gsIdx !== -1 ? gsIdx : sub.length;
      serial = sub.substring(0, Math.min(len, 20));
      i += 2 + len + 1;
    } else if (clean.substring(i).startsWith('10')) {
      const sub = clean.substring(i + 2);
      let gsIdx = sub.indexOf('\u001d');
      if (gsIdx === -1) gsIdx = sub.indexOf('|');
      const len = gsIdx !== -1 ? gsIdx : sub.length;
      lot = sub.substring(0, Math.min(len, 20));
      i += 2 + len + 1;
    } else {
      i++;
    }
  }

  return {
    gtin,
    serial: serial || rawInput.trim(),
    lot
  };
};

interface TurkeyPurchaseScreenProps {
  turkeyInventory: {
    summary: {
      total_bars: number;
      total_weight_grams: number;
      total_weight_kg: number;
      qr_required_for_transfer?: boolean;
      total_qr_printed?: number;
      total_qr_missing?: number;
      by_product: any[];
    };
    items: any[];
  } | null;
  pendingPurchases: any[];
  onRefresh: () => void;
  onSubmitPurchase: (serials: string[], unitPrice: number, notes: string) => Promise<boolean>;
  goldRate: number; // USD per oz (Guidance only)
  currentLang: string;
  canModify: boolean;
  userRole: string;
  displayName: string;
}

export const TurkeyPurchaseScreen: React.FC<TurkeyPurchaseScreenProps> = ({
  turkeyInventory,
  pendingPurchases,
  onRefresh,
  onSubmitPurchase,
  goldRate,
  currentLang,
  canModify,
  userRole: _userRole,
  displayName: _displayName
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'STOCK_PURCHASE' | 'VIP_STOCK' | 'PENDING_BATCHES'>('STOCK_PURCHASE');
  
  // VIP & KFH Inventory State
  const [vipInventory, setVipInventory] = useState<{
    summary: { total_bars: number; total_weight_grams: number; total_weight_kg: number; by_product: any[] };
    items: any[];
  } | null>(null);
  const [kfhAvailableInventory, setKfhAvailableInventory] = useState<{
    summary: { total_bars: number; total_weight_grams: number; total_weight_kg: number; by_product: any[] };
    items: any[];
  } | null>(null);
  const [pendingVipAllocations, setPendingVipAllocations] = useState<any[]>([]);
  const [pendingVipDispenses, setPendingVipDispenses] = useState<any[]>([]);
  const [pendingVipDeallocations, setPendingVipDeallocations] = useState<any[]>([]);
  const [pendingTurkeyReturns, setPendingTurkeyReturns] = useState<any[]>([]);
  const [pendingMissingReports, setPendingMissingReports] = useState<any[]>([]);
  const [pendingBatchFilter, setPendingBatchFilter] = useState<'ALL' | 'TURKEY' | 'VIP_ALLOCATION' | 'VIP_DEALLOCATION' | 'VIP_DISPENSE' | 'TURKEY_RETURN' | 'MISSING_ITEMS'>('ALL');

  // Return VIP Stock to KFH Online Stock State
  const [showVipDeallocModal, setShowVipDeallocModal] = useState<boolean>(false);
  const [vipDeallocReason, setVipDeallocReason] = useState<string>('Surplus VIP reserve returned to general online retail stock');
  const [vipDeallocNotes, setVipDeallocNotes] = useState<string>('');
  const [isSubmittingVipDealloc, setIsSubmittingVipDealloc] = useState<boolean>(false);

  // Missing Items State
  const [showMissingModal, setShowMissingModal] = useState<boolean>(false);
  const [selectedMissingSerials, setSelectedMissingSerials] = useState<string[]>([]);
  const [missingDiscrepancyReason, setMissingDiscrepancyReason] = useState<string>('Physical bar missing upon customs receipt unpacking verification');
  const [missingNotes, setMissingNotes] = useState<string>('');
  const [missingLotFilter, setMissingLotFilter] = useState<string>('');
  const [missingSerialSearch, setMissingSerialSearch] = useState<string>('');
  const [isSubmittingMissing, setIsSubmittingMissing] = useState<boolean>(false);

  // Fetch VIP, KFH, and Return Data
  const fetchVipData = async () => {
    try {
      const [vipRes, kfhRes, allocRes, dispRes, deallocRes, retRes, missRes] = await Promise.all([
        fetch(`${API_BASE}/inventory/vip`),
        fetch(`${API_BASE}/inventory/kfh-available`),
        fetch(`${API_BASE}/inventory/vip/pending-allocations`),
        fetch(`${API_BASE}/inventory/vip/pending-dispenses`),
        fetch(`${API_BASE}/inventory/vip/pending-deallocations`),
        fetch(`${API_BASE}/inventory/turkey/pending-returns`),
        fetch(`${API_BASE}/inventory/turkey/pending-missing-reports`)
      ]);
      if (vipRes.ok) setVipInventory(await vipRes.json());
      if (kfhRes.ok) setKfhAvailableInventory(await kfhRes.json());
      if (allocRes.ok) setPendingVipAllocations(await allocRes.json());
      if (dispRes.ok) setPendingVipDispenses(await dispRes.json());
      if (deallocRes.ok) setPendingVipDeallocations(await deallocRes.json());
      if (retRes.ok) setPendingTurkeyReturns(await retRes.json());
      if (missRes.ok) setPendingMissingReports(await missRes.json());
    } catch (err) {
      console.error('Failed to fetch VIP and return data:', err);
    }
  };

  useEffect(() => {
    fetchVipData();
  }, []);

  // Return Gold to Turkey Consignment State
  const [showReturnModal, setShowReturnModal] = useState<boolean>(false);
  const [returnSourceOrigin, setReturnSourceOrigin] = useState<'KFH' | 'VIP' | 'ALL'>('KFH');
  const [returnReason, setReturnReason] = useState<string>('Consignment Rebalancing Agreement TR-2026');
  const [returnNotes, setReturnNotes] = useState<string>('');
  const [isSubmittingReturn, setIsSubmittingReturn] = useState<boolean>(false);

  // KFH to VIP Allocation Selection State
  const [selectedKfhSerials, setSelectedKfhSerials] = useState<string[]>([]);
  const [selectedKfhDenomCode, setSelectedKfhDenomCode] = useState<string>('');
  const [kfhSerialSearch, setKfhSerialSearch] = useState<string>('');
  const [kfhQuickQty, setKfhQuickQty] = useState<number>(1);
  const [kfhQrScanInput, setKfhQrScanInput] = useState<string>('');
  const [kfhScanFeedback, setKfhScanFeedback] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const [vipCategory, setVipCategory] = useState<string>('Private Banking / VIP Exclusive');
  const [vipAllocationNotes, setVipAllocationNotes] = useState<string>('');
  const [isSubmittingVipAlloc, setIsSubmittingVipAlloc] = useState<boolean>(false);

  // VIP Dispensation State
  const [selectedVipSerials, setSelectedVipSerials] = useState<string[]>([]);
  const [vipSerialSearch, setVipSerialSearch] = useState<string>('');
  const [showVipDispenseModal, setShowVipDispenseModal] = useState<boolean>(false);
  const [vipCustomerName, setVipCustomerName] = useState<string>('');
  const [vipCustomerCivilId, setVipCustomerCivilId] = useState<string>('');
  const [vipCustomerAccount, setVipCustomerAccount] = useState<string>('');
  const [vipSpecialInstructions, setVipSpecialInstructions] = useState<string>('VIP Private Vault Handover');
  const [vipDispenseNotes, setVipDispenseNotes] = useState<string>('');
  const [isSubmittingVipDispense, setIsSubmittingVipDispense] = useState<boolean>(false);

  // Denomination / Product Selection State (Turkey Purchase)
  const [selectedDenomCode, setSelectedDenomCode] = useState<string>('');
  const [denomSerialSearch, setDenomSerialSearch] = useState<string>('');
  const [quickQtyToSelect, setQuickQtyToSelect] = useState<number>(1);

  // Dedicated QR / Barcode Scanner Input State (Turkey Purchase)
  const [qrScanInput, setQrScanInput] = useState<string>('');
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

  // Selection state (Turkey Purchase)
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [showSmartModal, setShowSmartModal] = useState(false);
  const [smartTab, setSmartTab] = useState<'QR_SCAN' | 'RANGE' | 'PASTE' | 'OCR'>('QR_SCAN');
  const [smartProduct, setSmartProduct] = useState<string>('');

  // Range select state
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');

  // Bulk paste state
  const [pasteText, setPasteText] = useState('');

  // Camera & OCR state
  const [_ocrImage, setOcrImage] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatusText, setOcrStatusText] = useState('');
  const [extractedSerials, setExtractedSerials] = useState<{ serial: string; selected: boolean }[]>([]);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const qrInputRef = useRef<HTMLInputElement | null>(null);
  const kfhQrInputRef = useRef<HTMLInputElement | null>(null);

  // Manual Purchase Rate (Cost / Gram in KWD)
  const [unitPricePerGram, setUnitPricePerGram] = useState<string>('');
  const [purchaseNotes, setPurchaseNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isItemsListExpanded, setIsItemsListExpanded] = useState<boolean>(true);
  const [searchSelectedQuery, setSearchSelectedQuery] = useState('');

  const availableItems = useMemo(() => turkeyInventory?.items || [], [turkeyInventory?.items]);
  const isQrRequirementActive = !!turkeyInventory?.summary?.qr_required_for_transfer;
  const rateNum = parseFloat(unitPricePerGram) || 0;

  // Auto-select first denomination for Turkey purchase if none selected
  useEffect(() => {
    if (!selectedDenomCode && turkeyInventory?.summary?.by_product && turkeyInventory.summary.by_product.length > 0) {
      setSelectedDenomCode(turkeyInventory.summary.by_product[0].product_code);
    }
  }, [turkeyInventory, selectedDenomCode]);

  // Auto-select first denomination for KFH available if none selected
  useEffect(() => {
    if (!selectedKfhDenomCode && kfhAvailableInventory?.summary?.by_product && kfhAvailableInventory.summary.by_product.length > 0) {
      setSelectedKfhDenomCode(kfhAvailableInventory.summary.by_product[0].product_code);
    }
  }, [kfhAvailableInventory, selectedKfhDenomCode]);

  // Selected Denomination object (Turkey)
  const currentDenomObj = useMemo(() => {
    return turkeyInventory?.summary?.by_product?.find(p => p.product_code === selectedDenomCode) || null;
  }, [turkeyInventory, selectedDenomCode]);

  // Available items for the currently selected denomination (Turkey)
  const itemsForSelectedDenom = useMemo(() => {
    if (!selectedDenomCode) return availableItems;
    return availableItems.filter(i => i.product_code === selectedDenomCode || String(i.product_id) === String(selectedDenomCode));
  }, [availableItems, selectedDenomCode]);

  // Filtered available serials in the facilitator grid (Turkey)
  const displayedDenomSerials = useMemo(() => {
    if (!denomSerialSearch.trim()) return itemsForSelectedDenom;
    const q = denomSerialSearch.trim().toLowerCase();
    return itemsForSelectedDenom.filter(i => 
      i.serial_number.toLowerCase().includes(q) ||
      (i.location_code && i.location_code.toLowerCase().includes(q)) ||
      (i.refiner_name && i.refiner_name.toLowerCase().includes(q))
    );
  }, [itemsForSelectedDenom, denomSerialSearch]);

  // Count of items selected for current denomination (Turkey)
  const selectedCountForCurrentDenom = useMemo(() => {
    const selectedSet = new Set(selectedSerials);
    return itemsForSelectedDenom.filter(i => selectedSet.has(i.serial_number)).length;
  }, [itemsForSelectedDenom, selectedSerials]);

  // Selected items calculations (Turkey)
  const selectedItemsData = useMemo(() => {
    const selectedSet = new Set(selectedSerials);
    const items = availableItems.filter(i => selectedSet.has(i.serial_number));
    const totalWeightGrams = items.reduce((sum, i) => sum + (i.weight_grams || 0), 0);
    const totalWeightKg = Math.round((totalWeightGrams / 1000) * 1000) / 1000;
    return {
      items,
      count: items.length,
      totalWeightGrams,
      totalWeightKg
    };
  }, [availableItems, selectedSerials]);

  const unprintedSelectedItems = useMemo(() => {
    return selectedItemsData.items.filter(i => !i.has_qr_printed);
  }, [selectedItemsData.items]);

  // Search filter within selected items table (Turkey)
  const displayedSelectedItems = useMemo(() => {
    if (!searchSelectedQuery.trim()) return selectedItemsData.items;
    const q = searchSelectedQuery.toLowerCase();
    return selectedItemsData.items.filter(item => {
      return item.serial_number.toLowerCase().includes(q) ||
        (item.refiner_name && item.refiner_name.toLowerCase().includes(q)) ||
        (item.denomination && item.denomination.toLowerCase().includes(q)) ||
        (item.location_code && item.location_code.toLowerCase().includes(q)) ||
        (item.lot_number && item.lot_number.toLowerCase().includes(q));
    });
  }, [selectedItemsData.items, searchSelectedQuery]);

  // Purchasing Cost Breakdown per Denomination and Shipment Lot (Turkey)
  const selectedBreakdownByDenomination = useMemo(() => {
    const map = new Map<string, {
      product_code: string;
      denomination: string;
      metal_name: string;
      weight_grams: number;
      count: number;
      total_weight_grams: number;
      purchasing_cost_per_bar: number;
      subtotal_purchasing_cost: number;
      lots: Set<string>;
    }>();

    selectedItemsData.items.forEach(item => {
      const key = item.product_code || String(item.product_id) || 'UNKNOWN';
      const w = item.weight_grams || 0;
      const costPerBar = rateNum > 0 ? (w * rateNum) : 0;
      if (!map.has(key)) {
        map.set(key, {
          product_code: key,
          denomination: item.denomination || `${w}g Bar`,
          metal_name: item.metal_name || 'Gold',
          weight_grams: w,
          count: 0,
          total_weight_grams: 0,
          purchasing_cost_per_bar: costPerBar,
          subtotal_purchasing_cost: 0,
          lots: new Set()
        });
      }
      const entry = map.get(key)!;
      entry.count += 1;
      entry.total_weight_grams += w;
      entry.subtotal_purchasing_cost += costPerBar;
      if (item.lot_number) entry.lots.add(item.lot_number);
    });

    return Array.from(map.values());
  }, [selectedItemsData.items, rateNum]);

  // Distinct shipment lots in selection (Turkey)
  const selectedShipmentLots = useMemo(() => {
    const lots = new Set<string>();
    selectedItemsData.items.forEach(i => {
      if (i.lot_number) lots.add(i.lot_number);
    });
    return Array.from(lots);
  }, [selectedItemsData.items]);

  // Handle Quick Barcode / QR Scan (Turkey)
  const handleProcessScanInput = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    const parsed = parseGs1Barcode(trimmed);
    const targetSerial = (parsed.serial || trimmed).toUpperCase();

    // Look for matching item in Turkey inventory
    const matchedItem = availableItems.find(i => i.serial_number.trim().toUpperCase() === targetSerial);

    if (!matchedItem) {
      setScanFeedback({
        type: 'error',
        message: currentLang === 'en'
          ? `Bar "${targetSerial}" was not found in active Turkey consignment stock.`
          : `السبيكة "${targetSerial}" غير موجودة في مخزون الأمانات التركي المتاح.`
      });
      setQrScanInput('');
      return;
    }

    if (selectedSerials.includes(matchedItem.serial_number)) {
      setScanFeedback({
        type: 'warning',
        message: currentLang === 'en'
          ? `Bar "${matchedItem.serial_number}" is already added to the purchase selection.`
          : `السبيكة "${matchedItem.serial_number}" مضافة مسبقاً لقائمة الشراء.`
      });
      setQrScanInput('');
      return;
    }

    setSelectedSerials(prev => [...prev, matchedItem.serial_number]);
    if (matchedItem.product_code) {
      setSelectedDenomCode(matchedItem.product_code);
    }

    const itemCost = rateNum > 0 ? (matchedItem.weight_grams * rateNum) : 0;
    const costLabel = itemCost > 0 ? ` (Purchasing Cost: ${itemCost.toFixed(3)} KWD)` : '';

    setScanFeedback({
      type: 'success',
      message: currentLang === 'en'
        ? `Added: ${matchedItem.serial_number} — ${matchedItem.denomination || matchedItem.metal_name} (${matchedItem.weight_grams}g)${costLabel}`
        : `تمت الإضافة: ${matchedItem.serial_number} — ${matchedItem.denomination || matchedItem.metal_name} (${matchedItem.weight_grams} جم)${costLabel}`
    });

    setQrScanInput('');
    if (qrInputRef.current) {
      qrInputRef.current.focus();
    }
  };

  // Select first N unselected items for current Turkey denomination
  const handleSelectFirstNForDenom = (qty: number) => {
    if (qty <= 0) return;
    const selectedSet = new Set(selectedSerials);
    const unselected = itemsForSelectedDenom.filter(i => !selectedSet.has(i.serial_number));
    
    if (unselected.length === 0) {
      alert(currentLang === 'en' 
        ? 'All available bars for this denomination are already selected.' 
        : 'جميع السبائك المتاحة لهذه الفئة محددة بالفعل.');
      return;
    }

    const toAdd = unselected.slice(0, qty).map(i => i.serial_number);
    setSelectedSerials(prev => [...prev, ...toAdd]);
  };

  // Select all available for current Turkey denomination
  const handleSelectAllForDenom = () => {
    const denomSerials = itemsForSelectedDenom.map(i => i.serial_number);
    const newSet = new Set([...selectedSerials, ...denomSerials]);
    setSelectedSerials(Array.from(newSet));
  };

  // Deselect all for current Turkey denomination
  const handleDeselectAllForDenom = () => {
    const denomSerialsSet = new Set(itemsForSelectedDenom.map(i => i.serial_number));
    setSelectedSerials(prev => prev.filter(s => !denomSerialsSet.has(s)));
  };

  // Toggle single item (Turkey)
  const handleToggleItem = (serial: string) => {
    setSelectedSerials(prev => 
      prev.includes(serial) ? prev.filter(s => s !== serial) : [...prev, serial]
    );
  };

  // Select all available in Turkey stock
  const handleSelectAllAvailable = () => {
    const allSerials = availableItems.map(i => i.serial_number);
    setSelectedSerials(allSerials);
  };

  // Clear selection (Turkey)
  const handleClearSelection = () => {
    setSelectedSerials([]);
    setSearchSelectedQuery('');
  };

  // ===================== KFH -> VIP ALLOCATION HELPERS =====================
  const kfhAvailableItems = useMemo(() => kfhAvailableInventory?.items || [], [kfhAvailableInventory?.items]);
  
  const currentKfhDenomObj = useMemo(() => {
    return kfhAvailableInventory?.summary?.by_product?.find(p => p.product_code === selectedKfhDenomCode) || null;
  }, [kfhAvailableInventory, selectedKfhDenomCode]);

  const kfhItemsForSelectedDenom = useMemo(() => {
    if (!selectedKfhDenomCode) return kfhAvailableItems;
    return kfhAvailableItems.filter(i => i.product_code === selectedKfhDenomCode || String(i.product_id) === String(selectedKfhDenomCode));
  }, [kfhAvailableItems, selectedKfhDenomCode]);

  const displayedKfhSerials = useMemo(() => {
    if (!kfhSerialSearch.trim()) return kfhItemsForSelectedDenom;
    const q = kfhSerialSearch.trim().toLowerCase();
    return kfhItemsForSelectedDenom.filter(i =>
      i.serial_number.toLowerCase().includes(q) ||
      (i.location_code && i.location_code.toLowerCase().includes(q)) ||
      (i.refiner_name && i.refiner_name.toLowerCase().includes(q))
    );
  }, [kfhItemsForSelectedDenom, kfhSerialSearch]);

  const selectedKfhCountForCurrentDenom = useMemo(() => {
    const set = new Set(selectedKfhSerials);
    return kfhItemsForSelectedDenom.filter(i => set.has(i.serial_number)).length;
  }, [kfhItemsForSelectedDenom, selectedKfhSerials]);

  const selectedKfhItemsData = useMemo(() => {
    const set = new Set(selectedKfhSerials);
    const items = kfhAvailableItems.filter(i => set.has(i.serial_number));
    const totalWeightGrams = items.reduce((sum, i) => sum + (i.weight_grams || 0), 0);
    const totalWeightKg = Math.round((totalWeightGrams / 1000) * 1000) / 1000;
    return {
      items,
      count: items.length,
      totalWeightGrams,
      totalWeightKg
    };
  }, [kfhAvailableItems, selectedKfhSerials]);

  const handleToggleKfhItem = (serial: string) => {
    setSelectedKfhSerials(prev =>
      prev.includes(serial) ? prev.filter(s => s !== serial) : [...prev, serial]
    );
  };

  const handleSelectFirstNForKfh = (qty: number) => {
    if (qty <= 0) return;
    const selectedSet = new Set(selectedKfhSerials);
    const unselected = kfhItemsForSelectedDenom.filter(i => !selectedSet.has(i.serial_number));
    if (unselected.length === 0) {
      alert(currentLang === 'en' ? 'All available bars for this denomination are already selected.' : 'جميع السبائك المتاحة محددة بالفعل.');
      return;
    }
    const toAdd = unselected.slice(0, qty).map(i => i.serial_number);
    setSelectedKfhSerials(prev => [...prev, ...toAdd]);
  };

  const handleSelectAllForKfhDenom = () => {
    const denomSerials = kfhItemsForSelectedDenom.map(i => i.serial_number);
    setSelectedKfhSerials(Array.from(new Set([...selectedKfhSerials, ...denomSerials])));
  };

  const handleDeselectAllForKfhDenom = () => {
    const set = new Set(kfhItemsForSelectedDenom.map(i => i.serial_number));
    setSelectedKfhSerials(prev => prev.filter(s => !set.has(s)));
  };

  const handleProcessKfhScanInput = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parsed = parseGs1Barcode(trimmed);
    const targetSerial = (parsed.serial || trimmed).toUpperCase();

    const matched = kfhAvailableItems.find(i => i.serial_number.trim().toUpperCase() === targetSerial);
    if (!matched) {
      setKfhScanFeedback({
        type: 'error',
        message: currentLang === 'en'
          ? `Bar "${targetSerial}" was not found in active KFH online stock.`
          : `السبيكة "${targetSerial}" غير موجودة في مخزون بيتك المتاح.`
      });
      setKfhQrScanInput('');
      return;
    }
    if (selectedKfhSerials.includes(matched.serial_number)) {
      setKfhScanFeedback({
        type: 'warning',
        message: currentLang === 'en'
          ? `Bar "${matched.serial_number}" is already selected for VIP allocation.`
          : `السبيكة "${matched.serial_number}" محددة مسبقاً لتخصيص VIP.`
      });
      setKfhQrScanInput('');
      return;
    }
    setSelectedKfhSerials(prev => [...prev, matched.serial_number]);
    if (matched.product_code) setSelectedKfhDenomCode(matched.product_code);
    setKfhScanFeedback({
      type: 'success',
      message: currentLang === 'en'
        ? `Added: ${matched.serial_number} — ${matched.denomination || matched.metal_name} (${matched.weight_grams}g)`
        : `تمت الإضافة: ${matched.serial_number} — ${matched.denomination || matched.metal_name} (${matched.weight_grams} جم)`
    });
    setKfhQrScanInput('');
    if (kfhQrInputRef.current) kfhQrInputRef.current.focus();
  };

  const handleAllocateToVip = async () => {
    if (selectedKfhSerials.length === 0) {
      alert(currentLang === 'en' ? 'Please select at least one bar to allocate to VIP stock.' : 'يرجى تحديد سبيكة واحدة على الأقل لتخصيصها لمخزون كبار العملاء.');
      return;
    }
    setIsSubmittingVipAlloc(true);
    try {
      const res = await fetch(`${API_BASE}/inventory/vip/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial_numbers: selectedKfhSerials,
          serialNumbers: selectedKfhSerials,
          vip_category: vipCategory,
          vipCategory: vipCategory,
          notes: vipAllocationNotes
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || err.title || (res.status === 401 ? 'Unauthorized: Please log in again.' : res.status === 403 ? 'Forbidden: custody.write permission required.' : `Failed to submit VIP allocation (HTTP ${res.status})`));
      }
      const data = await res.json();
      alert(currentLang === 'en'
        ? `✅ VIP Allocation Workflow Initiated!\nBatch Reference: ${data.batch_reference || 'VIP-ALLOC'}\n${selectedKfhSerials.length} bar(s) submitted for Checker authorization.\nOnce approved, stock transitions to KFH Owned (Channel: OFFLINE / VIP Exclusive - GFS Only).`
        : `✅ تم إنشاء طلب تخصيص مخزون VIP بنجاح!\nالمرجع: ${data.batch_reference || 'VIP-ALLOC'}\nتم إرسال ${selectedKfhSerials.length} سبيكة لاعتماد المراجع.\nبمجرد الاعتماد ستتحول القناة إلى أوفلاين (OFFLINE) تحت ملكية بيتك.`);
      setSelectedKfhSerials([]);
      setVipAllocationNotes('');
      await fetchVipData();
      onRefresh();
      setActiveSubTab('PENDING_BATCHES');
      setPendingBatchFilter('VIP_ALLOCATION');
    } catch (err: any) {
      alert(currentLang === 'en' ? `Error: ${err.message}` : `خطأ: ${err.message}`);
    } finally {
      setIsSubmittingVipAlloc(false);
    }
  };

  const handleReturnVipToOnline = async () => {
    if (selectedVipSerials.length === 0) {
      alert(currentLang === 'en' ? 'Please select at least one VIP bar to return to KFH Online stock.' : 'يرجى تحديد سبيكة واحدة على الأقل لإرجاعها لمخزون بيتك أونلاين.');
      return;
    }
    setIsSubmittingVipDealloc(true);
    try {
      const res = await fetch(`${API_BASE}/inventory/vip/deallocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial_numbers: selectedVipSerials,
          serialNumbers: selectedVipSerials,
          deallocation_reason: vipDeallocReason,
          deallocationReason: vipDeallocReason,
          notes: vipDeallocNotes
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || err.title || (res.status === 401 ? 'Unauthorized: Please log in again.' : res.status === 403 ? 'Forbidden: custody.write permission required.' : `Failed to submit VIP return to online (HTTP ${res.status})`));
      }
      const data = await res.json();
      alert(currentLang === 'en'
        ? `✅ VIP Return to Online Stock Initiated!\nBatch Reference: ${data.batch_reference || 'VIP-DEALLOC'}\n${selectedVipSerials.length} bar(s) submitted for 4-Eyes Checker Authorization.\nOnce approved, items will transition to KFH ONLINE stock.`
        : `✅ تم إنشاء طلب إعادة مخزون VIP إلى أونلاين بنجاح!\nالمرجع: ${data.batch_reference || 'VIP-DEALLOC'}\nتم إرسال ${selectedVipSerials.length} سبيكة لاعتماد المراجع.\nبمجرد الاعتماد ستعود القناة إلى ONLINE تحت ملكية بيتك.`);
      setSelectedVipSerials([]);
      setShowVipDeallocModal(false);
      setVipDeallocNotes('');
      await fetchVipData();
      onRefresh();
      setActiveSubTab('PENDING_BATCHES');
      setPendingBatchFilter('VIP_DEALLOCATION');
    } catch (err: any) {
      alert(currentLang === 'en' ? `Error: ${err.message}` : `خطأ: ${err.message}`);
    } finally {
      setIsSubmittingVipDealloc(false);
    }
  };

  // ===================== VIP VAULT DISPENSATION HELPERS =====================
  const vipItems = useMemo(() => vipInventory?.items || [], [vipInventory?.items]);

  const displayedVipItems = useMemo(() => {
    if (!vipSerialSearch.trim()) return vipItems;
    const q = vipSerialSearch.trim().toLowerCase();
    return vipItems.filter(i =>
      i.serial_number.toLowerCase().includes(q) ||
      (i.denomination && i.denomination.toLowerCase().includes(q)) ||
      (i.location_code && i.location_code.toLowerCase().includes(q)) ||
      (i.refiner_name && i.refiner_name.toLowerCase().includes(q)) ||
      (i.vip_category && i.vip_category.toLowerCase().includes(q))
    );
  }, [vipItems, vipSerialSearch]);

  const selectedVipItemsData = useMemo(() => {
    const set = new Set(selectedVipSerials);
    const items = vipItems.filter(i => set.has(i.serial_number));
    const totalWeightGrams = items.reduce((sum, i) => sum + (i.weight_grams || 0), 0);
    const totalWeightKg = Math.round((totalWeightGrams / 1000) * 1000) / 1000;
    return {
      items,
      count: items.length,
      totalWeightGrams,
      totalWeightKg
    };
  }, [vipItems, selectedVipSerials]);

  const handleToggleVipItem = (serial: string) => {
    setSelectedVipSerials(prev =>
      prev.includes(serial) ? prev.filter(s => s !== serial) : [...prev, serial]
    );
  };

  const handleDispenseVip = async () => {
    if (selectedVipSerials.length === 0) {
      alert(currentLang === 'en' ? 'Please select at least one VIP bar to dispense.' : 'يرجى تحديد سبيكة واحدة على الأقل للصرف.');
      return;
    }
    if (!vipCustomerName.trim()) {
      alert(currentLang === 'en' ? 'Customer Name is required.' : 'اسم العميل مطلوب.');
      return;
    }
    if (!vipCustomerCivilId.trim()) {
      alert(currentLang === 'en' ? 'Civil ID / National ID is required.' : 'الرقم المدني مطلوب.');
      return;
    }
    if (!vipCustomerAccount.trim()) {
      alert(currentLang === 'en' ? 'Customer Account Number / IBAN is required.' : 'رقم الحساب / الآيبان مطلوب.');
      return;
    }

    setIsSubmittingVipDispense(true);
    try {
      const res = await fetch(`${API_BASE}/inventory/vip/dispense`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial_numbers: selectedVipSerials,
          serialNumbers: selectedVipSerials,
          customer_name: vipCustomerName.trim(),
          customerName: vipCustomerName.trim(),
          customer_civil_id: vipCustomerCivilId.trim(),
          customerCivilId: vipCustomerCivilId.trim(),
          customer_account_number: vipCustomerAccount.trim(),
          customerAccount: vipCustomerAccount.trim(),
          special_instructions: vipSpecialInstructions,
          specialInstructions: vipSpecialInstructions,
          notes: vipDispenseNotes
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || err.title || (res.status === 401 ? 'Unauthorized: Please log in again.' : res.status === 403 ? 'Forbidden: custody.write permission required.' : `Failed to submit VIP dispensation request (HTTP ${res.status})`));
      }
      const data = await res.json();
      alert(currentLang === 'en'
        ? `✅ VIP Dispense Workflow Initiated!\nReference: ${data.dispense_reference || 'VIP-DISP'}\nClient: ${vipCustomerName}\n${selectedVipSerials.length} bar(s) submitted for 4-Eyes Checker Authorization.`
        : `✅ تم إنشاء طلب صرف مخزون VIP بنجاح!\nالمرجع: ${data.dispense_reference || 'VIP-DISP'}\nالعميل: ${vipCustomerName}\nتم إرسال ${selectedVipSerials.length} سبيكة لاعتماد المراجع.`);
      setSelectedVipSerials([]);
      setShowVipDispenseModal(false);
      setVipCustomerName('');
      setVipCustomerCivilId('');
      setVipCustomerAccount('');
      setVipDispenseNotes('');
      await fetchVipData();
      onRefresh();
      setActiveSubTab('PENDING_BATCHES');
      setPendingBatchFilter('VIP_DISPENSE');
    } catch (err: any) {
      alert(currentLang === 'en' ? `Error: ${err.message}` : `خطأ: ${err.message}`);
    } finally {
      setIsSubmittingVipDispense(false);
    }
  };

  // ===================== RETURN GOLD TO TURKEY CONSIGNMENT HELPERS =====================
  const handleInitiateTurkeyReturn = async () => {
    const serialsToReturn = returnSourceOrigin === 'KFH'
      ? selectedKfhSerials
      : returnSourceOrigin === 'VIP'
        ? selectedVipSerials
        : Array.from(new Set([...selectedKfhSerials, ...selectedVipSerials]));

    if (serialsToReturn.length === 0) {
      alert(currentLang === 'en'
        ? 'Please select at least one gold bar to return to Turkey consignment.'
        : 'يرجى تحديد سبيكة واحدة على الأقل للإرجاع إلى مخزون أمانة تركيا.');
      return;
    }

    setIsSubmittingReturn(true);
    try {
      const res = await fetch(`${API_BASE}/inventory/turkey/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial_numbers: serialsToReturn,
          serialNumbers: serialsToReturn,
          return_reason: returnReason,
          returnReason: returnReason,
          notes: returnNotes
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || err.title || (res.status === 401 ? 'Unauthorized: Please log in again.' : res.status === 403 ? 'Forbidden: custody.write permission required.' : `Failed to initiate Turkey return workflow (HTTP ${res.status})`));
      }
      const data = await res.json();
      alert(currentLang === 'en'
        ? `✅ Turkey Return Workflow Initiated!\nBatch Reference: ${data.batch_reference || 'TR-RET'}\n${serialsToReturn.length} bar(s) submitted for Checker authorization.\nOnce approved, ownership transitions back to TURKEY_OWNED (Offline Consignment Stock).`
        : `✅ تم إنشاء طلب إرجاع الذهب إلى تركيا بنجاح!\nالمرجع: ${data.batch_reference || 'TR-RET'}\nتم إرسال ${serialsToReturn.length} سبيكة لاعتماد المراجع.\nبمجرد الاعتماد ستعود الملكية إلى مخزون تركيا كأمانة (TURKEY_OWNED).`);

      if (returnSourceOrigin === 'KFH') setSelectedKfhSerials([]);
      else if (returnSourceOrigin === 'VIP') setSelectedVipSerials([]);
      else { setSelectedKfhSerials([]); setSelectedVipSerials([]); }

      setShowReturnModal(false);
      setReturnNotes('');
      await fetchVipData();
      onRefresh();
      setActiveSubTab('PENDING_BATCHES');
      setPendingBatchFilter('TURKEY_RETURN');
    } catch (err: any) {
      alert(currentLang === 'en' ? `Error: ${err.message}` : `خطأ: ${err.message}`);
    } finally {
      setIsSubmittingReturn(false);
    }
  };

  const handleReportMissingItems = async () => {
    if (selectedMissingSerials.length === 0) {
      alert(currentLang === 'en' ? 'Please select at least one serial number to report as missing.' : 'يرجى اختيار رقم تسلسلي واحد على الأقل للإبلاغ عنه كمفقود.');
      return;
    }
    setIsSubmittingMissing(true);
    try {
      const res = await fetch(`${API_BASE}/inventory/turkey/missing-items/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serialNumbers: selectedMissingSerials,
          discrepancyReason: missingDiscrepancyReason,
          notes: missingNotes,
          requestedBy: _displayName || _userRole || 'Treasury Maker',
          ownershipType: 'TURKEY_OWNED'
        })
      });
      if (res.ok) {
        const data = await res.json();
        alert(currentLang === 'en'
          ? `✅ Missing Items Discrepancy Workflow Initiated!\nReference: ${data.report_reference}\n${data.total_items} bar(s) submitted for Checker authorization.\nOnce approved by the Checker, serials will transition to MISSING status and be deducted from Turkey Owner balance.`
          : `✅ تم إنشاء مسار تدقيق مفقودات الشحنة بنجاح!\nالمرجع: ${data.report_reference}\nتم إرسال ${data.total_items} سبيكة لاعتماد المعتمد.\nفور الاعتماد، ستتحول السبائك إلى مفقودة وتُخصم تلقائياً من رصيد محفظة تركيا.`);
        setShowMissingModal(false);
        setSelectedMissingSerials([]);
        setMissingNotes('');
        setActiveSubTab('PENDING_BATCHES');
        setPendingBatchFilter('MISSING_ITEMS');
        onRefresh();
        fetchVipData();
      } else {
        const err = await res.json();
        alert(err.error || (currentLang === 'en' ? 'Failed to submit missing items report.' : 'فشل إرسال تقرير المفقودات.'));
      }
    } catch (e: any) {
      alert(e.message || (currentLang === 'en' ? 'Network error submitting report.' : 'خطأ في الاتصال بالخادم.'));
    } finally {
      setIsSubmittingMissing(false);
    }
  };

  const missingModalCandidateItems = useMemo(() => {
    let list = availableItems;
    if (missingLotFilter) {
      list = list.filter(i => (i.lot_number || '').toLowerCase().includes(missingLotFilter.toLowerCase()));
    }
    if (missingSerialSearch) {
      const q = missingSerialSearch.trim().toLowerCase();
      list = list.filter(i => (i.serial_number || '').toLowerCase().includes(q));
    }
    return list;
  }, [availableItems, missingLotFilter, missingSerialSearch]);

  const selectedMissingItemsData = useMemo(() => {
    const selectedSet = new Set(selectedMissingSerials);
    const matched = availableItems.filter(i => selectedSet.has(i.serial_number));
    const totalWeightGrams = matched.reduce((sum, i) => sum + (i.weight_grams || 0), 0);
    return {
      count: selectedMissingSerials.length,
      totalWeightGrams,
      totalWeightKg: Math.round((totalWeightGrams / 1000) * 1000) / 1000,
      items: matched
    };
  }, [availableItems, selectedMissingSerials]);

  const returnItemsData = useMemo(() => {
    let items: any[] = [];
    if (returnSourceOrigin === 'KFH') {
      const set = new Set(selectedKfhSerials);
      items = kfhAvailableItems.filter(i => set.has(i.serial_number));
    } else if (returnSourceOrigin === 'VIP') {
      const set = new Set(selectedVipSerials);
      items = vipItems.filter(i => set.has(i.serial_number));
    } else {
      const kfhSet = new Set(selectedKfhSerials);
      const vipSet = new Set(selectedVipSerials);
      items = [
        ...kfhAvailableItems.filter(i => kfhSet.has(i.serial_number)),
        ...vipItems.filter(i => vipSet.has(i.serial_number))
      ];
    }
    const totalWeightGrams = items.reduce((sum, i) => sum + (i.weight_grams || 0), 0);
    const totalWeightKg = Math.round((totalWeightGrams / 1000) * 1000) / 1000;
    return {
      items,
      count: items.length,
      totalWeightGrams,
      totalWeightKg
    };
  }, [returnSourceOrigin, selectedKfhSerials, selectedVipSerials, kfhAvailableItems, vipItems]);

  // OCR Preprocessing: converts image to high-contrast grayscale to extract laser-engraved serials on gold
  const preprocessImage = (imageSrc: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(imageSrc);
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        // Grayscale + High-Contrast curves
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          const contrast = (gray - 128) * 1.8 + 128;
          const finalVal = Math.min(255, Math.max(0, contrast));
          data[i] = finalVal;
          data[i + 1] = finalVal;
          data[i + 2] = finalVal;
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(imageSrc);
      img.src = imageSrc;
    });
  };

  // Run OCR
  const processOcrImage = async (imageSrc: string) => {
    setOcrLoading(true);
    setOcrProgress(0);
    setOcrStatusText(currentLang === 'en' ? 'Preprocessing gold bar image...' : 'معالجة صورة السبيكة...');

    try {
      const processedSrc = await preprocessImage(imageSrc);
      setOcrStatusText(currentLang === 'en' ? 'Scanning laser-engraved serial number & QR...' : 'قراءة الرقم التسلسلي المحفور أو رمز الاستجابة...');

      const result = await Tesseract.recognize(
        processedSrc,
        'eng',
        {
          logger: m => {
            if (m.status === 'recognizing text') {
              setOcrProgress(Math.round(m.progress * 100));
            }
          }
        }
      );

      const rawText = result.data.text || '';
      const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
      const candidates: { serial: string; selected: boolean }[] = [];
      const seen = new Set<string>();

      const goldNoisePattern = /^(100\s*G|1000\s*G|1\s*KG|500\s*G|50\s*G|20\s*G|10\s*G|5\s*G|1\s*G|999\.?9?|995|GOLD|SILVER|FINE|PURITY|ESSAYEUR|FONDEUR|MELTER|ASSAYER|NADIR|VALCAMBI|SUISSE|TURKEY|REFINERY|NET|WEIGHT|BAR|AU|AG|ISO|CERTIFICATE)/i;

      // Extract alphanumeric tokens matching gold bar serial format
      const words = (result.data as any).words || [];
      const sortedTokens: { text: string; y: number }[] = [];

      words.forEach((w: any) => {
        const txt = (w.text || '').trim().replace(/[^a-zA-Z0-9-]/g, '').toUpperCase();
        if (txt.length >= 4 && !goldNoisePattern.test(txt)) {
          sortedTokens.push({ text: txt, y: w.bbox ? w.bbox.y0 : 0 });
        }
      });

      sortedTokens.sort((a, b) => b.y - a.y);

      sortedTokens.forEach(token => {
        let clean = token.text;
        if (/^[A-Z][O0-9]{4,8}$/.test(clean)) {
          clean = clean[0] + clean.slice(1).replace(/O/g, '0');
        }
        if (!seen.has(clean) && clean.length >= 4) {
          seen.add(clean);
          candidates.push({ serial: clean, selected: true });
        }
      });

      lines.forEach(line => {
        const tokens = line.split(/[\s,;|]+/).map(t => t.trim().replace(/[^a-zA-Z0-9-]/g, '').toUpperCase());
        tokens.forEach(t => {
          let clean = t;
          if (/^[A-Z][O0-9]{4,8}$/.test(clean)) {
            clean = clean[0] + clean.slice(1).replace(/O/g, '0');
          }
          if (clean.length >= 4 && !seen.has(clean) && !goldNoisePattern.test(clean)) {
            seen.add(clean);
            candidates.push({ serial: clean, selected: true });
          }
        });
      });

      setExtractedSerials(candidates);
      setOcrStatusText(
        candidates.length > 0
          ? (currentLang === 'en' ? `Identified ${candidates.length} serial token(s)` : `تم التعرف على ${candidates.length} رقم تسلسلي`)
          : (currentLang === 'en' ? 'No clear serial detected. Try adjusting camera angle.' : 'لم يتم التعرف على الرقم. حاول تعديل زاوية الكاميرا.')
      );
    } catch (_err: any) {
      setOcrStatusText(currentLang === 'en' ? 'OCR scanning failed.' : 'فشلت عملية القراءة الضوئية.');
    } finally {
      setOcrLoading(false);
    }
  };

  const startCamera = async () => {
    try {
      setCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (_err) {
      alert(currentLang === 'en' ? 'Cannot access camera. Please check browser permissions.' : 'تعذر تشغيل الكاميرا. يرجى مراجعة الصلاحيات.');
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const captureCameraFrame = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      setOcrImage(dataUrl);
      stopCamera();
      processOcrImage(dataUrl);
    }
  };

  // Apply OCR or Paste Matches to Selected Serials in Turkey Inventory
  const handleApplyExtractedMatches = (serialsToSelect: string[], targetProd?: string | any) => {
    const explicitProd = typeof targetProd === 'string' && targetProd.trim() ? targetProd.trim() : undefined;
    const productToFilter = explicitProd !== undefined ? explicitProd : (showSmartModal ? smartProduct : '');
    let pool = availableItems;
    if (productToFilter) {
      pool = pool.filter(i => i.product_code === productToFilter || String(i.product_id) === String(productToFilter));
    }

    const poolMap = new Map<string, any>();
    pool.forEach(i => poolMap.set(i.serial_number.trim().toUpperCase(), i));

    const matchedSerials: string[] = [];
    const missingSerials: string[] = [];

    serialsToSelect.forEach(raw => {
      const s = raw.trim().toUpperCase();
      if (!s) return;
      if (poolMap.has(s)) {
        matchedSerials.push(poolMap.get(s).serial_number);
      } else {
        missingSerials.push(raw);
      }
    });

    const prodObj = turkeyInventory?.summary?.by_product?.find(p => p.product_code === productToFilter || String(p.product_id) === String(productToFilter));
    const prodLabel = productToFilter ? ` for product [${prodObj?.denomination || (typeof productToFilter === 'string' ? productToFilter : '')}]` : '';
    const prodLabelAr = productToFilter ? ` للمنتج [${prodObj?.denomination || (typeof productToFilter === 'string' ? productToFilter : '')}]` : '';

    if (matchedSerials.length === 0) {
      alert(currentLang === 'en' 
        ? `None of the requested serials (${serialsToSelect.slice(0, 5).join(', ')}${serialsToSelect.length > 5 ? '...' : ''}) were found in active Turkey inventory${prodLabel}. Please verify the serial numbers and selected product.` 
        : `لم يتم العثور على أي من الأرقام التسلسلية المطلوبة في مخزون تركيا${prodLabelAr}. يرجى التحقق من الأرقام والمنتج المحدد.`);
      return;
    }

    const newSet = new Set([...selectedSerials, ...matchedSerials]);
    setSelectedSerials(Array.from(newSet));
    if (productToFilter) {
      setSelectedDenomCode(productToFilter);
    }
    setShowSmartModal(false);

    if (missingSerials.length > 0) {
      alert(currentLang === 'en'
        ? `Selected ${matchedSerials.length} matching Turkey bar(s)${prodLabel}. Note: ${missingSerials.length} serial(s) do not exist in inventory (${missingSerials.slice(0, 3).join(', ')}${missingSerials.length > 3 ? '...' : ''}).`
        : `تم تحديد ${matchedSerials.length} سبيكة مطابقة${prodLabelAr}. تنبيه: يوجد ${missingSerials.length} رقم غير موجود بالمخزون.`);
    } else {
      alert(currentLang === 'en'
        ? `Selected ${matchedSerials.length} matching Turkey bar(s)${prodLabel}.`
        : `تم تحديد ${matchedSerials.length} سبيكة مطابقة بنجاح${prodLabelAr}.`);
    }
  };

  // Apply Paste
  const handleApplyPasteSelect = () => {
    if (!pasteText.trim()) return;
    const rawList = pasteText
      .split(/[\r\n,;\t]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (rawList.length === 0) return;
    handleApplyExtractedMatches(rawList);
    setPasteText('');
  };

  // Helper for sequential range expansion
  const generateSerialRange = (start: string, end: string): string[] => {
    const startNumMatch = start.match(/^(.*?)(\d+)$/);
    const endNumMatch = end.match(/^(.*?)(\d+)$/);

    if (!startNumMatch || !endNumMatch) {
      return [start, end];
    }

    const prefixStart = startNumMatch[1];
    const prefixEnd = endNumMatch[1];

    if (prefixStart !== prefixEnd) {
      return [start, end];
    }

    const numStart = parseInt(startNumMatch[2], 10);
    const numEnd = parseInt(endNumMatch[2], 10);
    const padLen = startNumMatch[2].length;

    if (isNaN(numStart) || isNaN(numEnd) || numStart > numEnd || (numEnd - numStart) > 2000) {
      return [start, end];
    }

    const result: string[] = [];
    for (let i = numStart; i <= numEnd; i++) {
      const padded = String(i).padStart(padLen, '0');
      result.push(`${prefixStart}${padded}`);
    }
    return result;
  };

  // Apply Range
  const handleApplyRangeSelect = () => {
    const rawStart = rangeStart.trim().toUpperCase();
    const rawEnd = rangeEnd.trim().toUpperCase();

    if (!rawStart || !rawEnd) {
      alert(currentLang === 'en' ? 'Please provide both Start and End serial numbers.' : 'يرجى إدخال رقم البداية والنهاية.');
      return;
    }

    const expectedSerials = generateSerialRange(rawStart, rawEnd);
    const productToFilter = showSmartModal ? smartProduct : '';
    let pool = availableItems;
    if (productToFilter) {
      pool = pool.filter(i => i.product_code === productToFilter || String(i.product_id) === String(productToFilter));
    }

    const poolMap = new Map<string, any>();
    pool.forEach(i => poolMap.set(i.serial_number.trim().toUpperCase(), i));

    const matchedSerials: string[] = [];
    const missingSerials: string[] = [];

    expectedSerials.forEach(s => {
      if (poolMap.has(s)) {
        matchedSerials.push(poolMap.get(s).serial_number);
      } else {
        missingSerials.push(s);
      }
    });

    const prodObj = turkeyInventory?.summary?.by_product?.find(p => p.product_code === productToFilter || String(p.product_id) === String(productToFilter));
    const prodLabel = productToFilter ? ` for product [${prodObj?.denomination || productToFilter}]` : '';
    const prodLabelAr = productToFilter ? ` للمنتج [${prodObj?.denomination || productToFilter}]` : '';

    if (matchedSerials.length === 0) {
      if (expectedSerials.length === 1) {
        alert(currentLang === 'en'
          ? `Serial number "${expectedSerials[0]}" does not exist in active Turkey inventory${prodLabel}. Please verify the serial number and selected product.`
          : `الرقم التسلسلي "${expectedSerials[0]}" غير موجود في مخزون تركيا المتاح${prodLabelAr}.`);
      } else {
        alert(currentLang === 'en'
          ? `None of the requested serial numbers in range ${rawStart}..${rawEnd} (${expectedSerials.length} items) exist in active Turkey inventory${prodLabel}. Please verify the exact serial numbers.`
          : `لا توجد أي من الأرقام التسلسلية في النطاق ${rawStart}..${rawEnd} بمخزون تركيا المتاح${prodLabelAr}.`);
      }
      return;
    }

    const newSet = new Set([...selectedSerials, ...matchedSerials]);
    setSelectedSerials(Array.from(newSet));
    if (productToFilter) {
      setSelectedDenomCode(productToFilter);
    }
    setShowSmartModal(false);

    if (missingSerials.length > 0) {
      alert(currentLang === 'en'
        ? `Selected ${matchedSerials.length} matching Turkey bar(s) in range ${rawStart}..${rawEnd}${prodLabel}. Note: ${missingSerials.length} serial(s) do not exist in inventory (${missingSerials.slice(0, 3).join(', ')}${missingSerials.length > 3 ? '...' : ''}).`
        : `تم تحديد ${matchedSerials.length} سبيكة بالنطاق ${rawStart}..${rawEnd}${prodLabelAr}. تنبيه: ${missingSerials.length} سبيكة غير موجودة بالمخزون.`);
    } else {
      alert(currentLang === 'en'
        ? `Successfully selected all ${matchedSerials.length} Turkey bar(s) in range ${rawStart}..${rawEnd}${prodLabel}.`
        : `تم تحديد كافة السبائك البالغ عددها ${matchedSerials.length} في النطاق بنجاح${prodLabelAr}.`);
    }
  };

  // Handle Turkey Purchase Submit
  const handleSubmit = async () => {
    if (selectedSerials.length === 0) {
      alert(currentLang === 'en' ? 'Please select at least one Turkey bar to purchase.' : 'يرجى تحديد سبيكة تركية واحدة على الأقل للشراء.');
      return;
    }

    if (isNaN(rateNum) || rateNum <= 0) {
      alert(currentLang === 'en' ? 'Please enter a valid Agreed Purchase Rate per gram (KWD / gram).' : 'يرجى إدخال سعر شراء صحيح للجرام (د.ك / جم).');
      return;
    }

    if (isQrRequirementActive && unprintedSelectedItems.length > 0) {
      const sampleSerials = unprintedSelectedItems.slice(0, 5).map(i => i.serial_number).join(', ');
      alert(currentLang === 'en'
        ? `⚠️ Transfer Blocked by System Policy:\n\nQR Code has not been printed for ${unprintedSelectedItems.length} selected bar(s) (${sampleSerials}${unprintedSelectedItems.length > 5 ? '...' : ''}).\n\nPlease print QR code labels in Barcode & QR Labeling before transferring ownership.`
        : `⚠️ النقل محظور وفقاً لسياسة النظام:\n\nلم تتم طباعة ملصق QR لعدد ${unprintedSelectedItems.length} سبيكة محددة (${sampleSerials}${unprintedSelectedItems.length > 5 ? '...' : ''}).\n\nيرجى طباعة ملصقات QR من شاشة الباركود قبل نقل الملكية إلى بيتك.`);
      return;
    }

    setIsSubmitting(true);
    const success = await onSubmitPurchase(selectedSerials, rateNum, purchaseNotes);
    setIsSubmitting(false);

    if (success) {
      setSelectedSerials([]);
      setUnitPricePerGram('');
      setPurchaseNotes('');
      setActiveSubTab('PENDING_BATCHES');
      setPendingBatchFilter('TURKEY');
      onRefresh();
      fetchVipData();
    }
  };

  // Total agreed cost in KWD
  const totalAgreedCostKwd = useMemo(() => {
    if (isNaN(rateNum) || rateNum <= 0) return 0;
    return Math.round(selectedItemsData.totalWeightGrams * rateNum * 1000) / 1000;
  }, [selectedItemsData.totalWeightGrams, rateNum]);

  // Overall Total Precious Metals Metric Calculations
  const portfolioTotalBars = (turkeyInventory?.summary?.total_bars || 0) + (kfhAvailableInventory?.summary?.total_bars || 0) + (vipInventory?.summary?.total_bars || 0);
  const portfolioTotalWeightKg = Math.round(((turkeyInventory?.summary?.total_weight_kg || 0) + (kfhAvailableInventory?.summary?.total_weight_kg || 0) + (vipInventory?.summary?.total_weight_kg || 0)) * 1000) / 1000;
  const portfolioTotalWeightGrams = (turkeyInventory?.summary?.total_weight_grams || 0) + (kfhAvailableInventory?.summary?.total_weight_grams || 0) + (vipInventory?.summary?.total_weight_grams || 0);

  // Combined Pending Batches for Tab 3
  const totalPendingBatchesCount = (pendingPurchases.filter(p => p.status_code === 'PENDING_APPROVAL').length) +
    (pendingVipAllocations.filter(a => a.status_code === 'PENDING_MAKER' || a.status_code === 'PENDING_APPROVAL').length) +
    (pendingVipDispenses.filter(d => d.status_code === 'PENDING_MAKER' || d.status_code === 'PENDING_APPROVAL').length);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 1. TOP HEADER SUMMARY & 4 KPIS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        
        {/* KPI 1: Turkey Consignment Stock */}
        <div className="glass-card" style={{ padding: '18px', borderLeft: '4px solid #E11D48' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {currentLang === 'en' ? 'Turkey Consignment Stock' : 'مخزون الأمانات التركي المتاح'}
              </div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', marginTop: '6px', color: 'var(--text-primary)' }}>
                {turkeyInventory?.summary?.total_bars || 0} <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'bars' : 'سبيكة'}</span>
              </div>
              <div style={{ fontSize: '12px', color: '#E11D48', fontWeight: 600, marginTop: '2px' }}>
                {turkeyInventory?.summary?.total_weight_kg || 0} KG <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>({(turkeyInventory?.summary?.total_weight_grams || 0).toLocaleString()} g)</span>
              </div>
              <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px dashed rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: ((turkeyInventory?.summary as any)?.total_missing_bars || 0) > 0 ? '#EF4444' : 'var(--text-muted)' }}>
                  ⚠️ {currentLang === 'en' ? 'Missing / Discrepancies:' : 'المفقودات / الفروقات:'} <strong>{(turkeyInventory?.summary as any)?.total_missing_bars || 0} {currentLang === 'en' ? 'bars' : 'سبيكة'}</strong>
                </span>
                {canModify && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setSelectedMissingSerials([]);
                      setShowMissingModal(true);
                    }}
                    style={{ fontSize: '10px', padding: '2px 8px', background: 'rgba(239, 68, 68, 0.15)', color: '#EF4444', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '4px', cursor: 'pointer' }}
                    title={currentLang === 'en' ? 'Report missing serials after lot receipt / transfer' : 'تسجيل أرقام تسلسلية مفقودة بعد استلام اللوت'}
                  >
                    <i className="fa-solid fa-triangle-exclamation"></i> {currentLang === 'en' ? 'Report Missing' : 'تسجيل مفقودات'}
                  </button>
                )}
              </div>
            </div>
            <div style={{ width: '42px', height: '42px', borderRadius: '8px', background: 'rgba(225, 29, 72, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: '#E11D48' }}>
              🇹🇷
            </div>
          </div>
        </div>

        {/* KPI 2: KFH Online Retail Stock */}
        <div className="glass-card" style={{ padding: '18px', borderLeft: '4px solid var(--kfh-green)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {currentLang === 'en' ? 'KFH Online Retail Stock' : 'مخزون بيتك (متاح أونلاين)'}
              </div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', marginTop: '6px', color: 'var(--kfh-green)' }}>
                {kfhAvailableInventory?.summary?.total_bars || 0} <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'bars' : 'سبيكة'}</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--kfh-green)', fontWeight: 600, marginTop: '2px' }}>
                {kfhAvailableInventory?.summary?.total_weight_kg || 0} KG <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>({(kfhAvailableInventory?.summary?.total_weight_grams || 0).toLocaleString()} g)</span>
              </div>
            </div>
            <div style={{ width: '42px', height: '42px', borderRadius: '8px', background: 'rgba(0, 155, 78, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: 'var(--kfh-green)' }}>
              🇰🇼
            </div>
          </div>
        </div>

        {/* KPI 3: VIP Exclusive Vault Reserve */}
        <div className="glass-card" style={{ padding: '18px', borderLeft: '4px solid #6366f1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {currentLang === 'en' ? 'VIP Exclusive Vault Reserve' : 'مخزون كبار العملاء (VIP)'}
              </div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', marginTop: '6px', color: '#6366f1' }}>
                {vipInventory?.summary?.total_bars || 0} <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'bars' : 'سبيكة'}</span>
              </div>
              <div style={{ fontSize: '12px', color: '#6366f1', fontWeight: 600, marginTop: '2px' }}>
                {vipInventory?.summary?.total_weight_kg || 0} KG <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>({(vipInventory?.summary?.total_weight_grams || 0).toLocaleString()} g)</span>
              </div>
            </div>
            <div style={{ width: '42px', height: '42px', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: '#6366f1' }}>
              👑
            </div>
          </div>
        </div>

        {/* KPI 4: Total Portfolio Precious Metals */}
        <div className="glass-card" style={{ padding: '18px', borderLeft: '4px solid var(--accent-gold)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {currentLang === 'en' ? 'Total Precious Portfolio' : 'إجمالي محفظة المعادن الثمينة'}
              </div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', marginTop: '6px', color: 'var(--accent-gold)' }}>
                {portfolioTotalWeightKg} <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>KG</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {portfolioTotalBars} {currentLang === 'en' ? 'bars total' : 'سبيكة إجمالاً'} • {portfolioTotalWeightGrams.toLocaleString()} g
              </div>
            </div>
            <div style={{ width: '42px', height: '42px', borderRadius: '8px', background: 'rgba(212, 175, 55, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: 'var(--accent-gold)' }}>
              💎
            </div>
          </div>
        </div>

      </div>

      {/* QR Code Requirement Status Banner */}
      {isQrRequirementActive && (
        <div style={{
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.35)',
          borderRadius: '8px',
          padding: '12px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'rgba(245, 158, 11, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F59E0B', fontSize: '16px', flexShrink: 0 }}>
              <i className="fa-solid fa-qrcode"></i>
            </div>
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#F59E0B' }}>
                {currentLang === 'en' ? 'System Setting Enforced: QR Code Verification' : 'شرط نظام مفعل: التحقق من طباعة رمز QR'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {currentLang === 'en'
                  ? 'Transfer from Turkey ownership to KFH is blocked for any bar that does not have a printed QR label.'
                  : 'نقل الملكية من تركيا إلى بيتك محظور لأي سبيكة لم تتم طباعة ملصق QR لها مسبقاً.'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px' }}>
            <span className="badge badge-ready" style={{ fontSize: '12px', padding: '4px 10px' }}>
              <i className="fa-solid fa-check"></i> {turkeyInventory?.summary?.total_qr_printed || 0} {currentLang === 'en' ? 'QR Printed' : 'مطبوع QR'}
            </span>
            {(turkeyInventory?.summary?.total_qr_missing || 0) > 0 && (
              <span className="badge badge-sold" style={{ fontSize: '12px', padding: '4px 10px' }}>
                <i className="fa-solid fa-triangle-exclamation"></i> {turkeyInventory?.summary?.total_qr_missing} {currentLang === 'en' ? 'No QR' : 'بدون QR'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 2. SUB-TABS NAVIGATION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            className={`btn ${activeSubTab === 'STOCK_PURCHASE' ? 'btn-primary' : ''}`}
            style={activeSubTab !== 'STOCK_PURCHASE' ? { backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--surface-border)' } : {}}
            onClick={() => setActiveSubTab('STOCK_PURCHASE')}
          >
            <i className="fa-solid fa-layer-group"></i> {currentLang === 'en' ? '🇹🇷 Turkey Stock & Purchase Order' : '🇹🇷 مخزون تركيا وأمر الشراء'}
          </button>

          <button
            className={`btn ${activeSubTab === 'VIP_STOCK' ? 'btn-primary' : ''}`}
            style={activeSubTab !== 'VIP_STOCK' ? { backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: '#6366f1' } : { background: '#6366f1', borderColor: '#6366f1', color: '#fff' }}
            onClick={() => {
              setActiveSubTab('VIP_STOCK');
              fetchVipData();
            }}
          >
            <i className="fa-solid fa-crown"></i> {currentLang === 'en' ? '👑 KFH Stock & VIP Allocation' : '👑 مخزون بيتك وتخصيص كبار العملاء (VIP)'}
            {vipInventory?.summary?.total_bars ? (
              <span className="badge" style={{ marginLeft: '6px', fontSize: '10px', background: 'rgba(255,255,255,0.2)', color: '#fff' }}>
                {vipInventory.summary.total_bars}
              </span>
            ) : null}
          </button>

          <button
            className={`btn ${activeSubTab === 'PENDING_BATCHES' ? 'btn-primary' : ''}`}
            style={activeSubTab !== 'PENDING_BATCHES' ? { backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--surface-border)' } : {}}
            onClick={() => {
              setActiveSubTab('PENDING_BATCHES');
              fetchVipData();
            }}
          >
            <i className="fa-solid fa-clock-rotate-left"></i> {currentLang === 'en' ? '📋 Operations Log & Maker-Checker' : '📋 سجل العمليات والأعين الأربعة'}
            {totalPendingBatchesCount > 0 && (
              <span className="badge badge-reserved" style={{ marginLeft: '6px', fontSize: '10px' }}>
                {totalPendingBatchesCount}
              </span>
            )}
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {activeSubTab === 'STOCK_PURCHASE' && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setSmartProduct(selectedDenomCode);
                setShowSmartModal(true);
              }}
              style={{ fontSize: '12px', padding: '6px 14px' }}
            >
              <i className="fa-solid fa-wand-magic-sparkles" style={{ color: 'var(--accent-gold)' }}></i>{' '}
              {currentLang === 'en' ? 'Advanced Tools (Range / OCR / Paste)' : 'أدوات متقدمة (نطاق / OCR / لصق)'}
            </button>
          )}

          <button
            className="btn btn-secondary"
            onClick={() => {
              onRefresh();
              fetchVipData();
            }}
            style={{ fontSize: '12px', padding: '6px 12px' }}
          >
            <i className="fa-solid fa-arrows-rotate"></i> {currentLang === 'en' ? 'Refresh All' : 'تحديث الكل'}
          </button>
        </div>
      </div>

      {/* 3. SUBTAB 1: SELECT & PURCHASE TURKEY GOLD */}
      {activeSubTab === 'STOCK_PURCHASE' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 370px', gap: '20px', alignItems: 'start' }}>
          
          {/* LEFT: DENOMINATION SELECTOR + SERIAL FACILITATOR + QR SCANNER + SELECTED ITEMS */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* STEP 1: SELECT DENOMINATION & TYPE */}
            <div className="glass-card" style={{ padding: '20px', border: '1px solid rgba(0, 155, 78, 0.25)', background: 'linear-gradient(180deg, rgba(0, 155, 78, 0.04) 0%, rgba(255,255,255,0.01) 100%)' }}>
              
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--kfh-green)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 'bold' }}>
                    1
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '15px', color: 'var(--text-primary)' }}>
                      {currentLang === 'en' ? 'Select Denomination & Metal Type' : 'اختر فئة ونوع السبيكة'}
                    </h4>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {currentLang === 'en' ? 'Choose what you want to buy, and the app will display all available serial numbers.' : 'اختر الفئة المطلوبة وسيقوم النظام بتسهيل واختيار الأرقام التسلسلية المتاحة.'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={handleSelectAllAvailable}
                    style={{ fontSize: '11px', padding: '5px 10px', background: 'rgba(255,255,255,0.05)' }}
                  >
                    <i className="fa-solid fa-check-double"></i> {currentLang === 'en' ? `Select All Stock (${availableItems.length})` : `تحديد كل المخزون (${availableItems.length})`}
                  </button>
                  {canModify && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setSelectedMissingSerials([]);
                        setShowMissingModal(true);
                      }}
                      style={{ fontSize: '11px', padding: '5px 10px', background: 'rgba(239, 68, 68, 0.15)', color: '#EF4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}
                    >
                      <i className="fa-solid fa-triangle-exclamation"></i> {currentLang === 'en' ? 'Report Missing Serials' : 'تسجيل سبائك مفقودة'}
                    </button>
                  )}
                  {selectedSerials.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={handleClearSelection}
                      style={{ fontSize: '11px', padding: '5px 10px' }}
                    >
                      <i className="fa-solid fa-trash-can"></i> {currentLang === 'en' ? 'Clear All' : 'إلغاء الكل'}
                    </button>
                  )}
                </div>
              </div>

              {/* Denomination Choice Dropdown List */}
              <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '14px', alignItems: 'end', flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ margin: 0, flex: 1, minWidth: '280px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                      <i className="fa-solid fa-coins" style={{ color: 'var(--accent-gold)' }}></i>
                      {currentLang === 'en' ? 'Select Denomination & Metal Type' : 'اختر فئة ونوع السبيكة'}
                    </label>
                    <select
                      className="form-control"
                      value={selectedDenomCode}
                      onChange={e => {
                        setSelectedDenomCode(e.target.value);
                        setDenomSerialSearch('');
                      }}
                      style={{
                        fontSize: '13px',
                        padding: '10px 14px',
                        fontWeight: '600',
                        backgroundColor: 'var(--bg-secondary)',
                        borderColor: 'var(--kfh-green)',
                        color: 'var(--text-primary)',
                        width: '100%',
                        borderRadius: '6px'
                      }}
                    >
                      {turkeyInventory?.summary?.by_product?.map(p => {
                        const prodItems = availableItems.filter(i => i.product_code === p.product_code);
                        const selectedSet = new Set(selectedSerials);
                        const selectedInThis = prodItems.filter(i => selectedSet.has(i.serial_number)).length;
                        return (
                          <option key={p.product_code} value={p.product_code} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                            {p.denomination} — {p.metal_name} ({p.weight_grams}g) — [{p.count} {currentLang === 'en' ? 'in stock' : 'متاح'}{selectedInThis > 0 ? ` • ${selectedInThis} ${currentLang === 'en' ? 'selected' : 'محدد'}` : ''}]
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {currentDenomObj && (() => {
                    const prodItems = availableItems.filter(i => i.product_code === currentDenomObj.product_code);
                    const selectedSet = new Set(selectedSerials);
                    const selectedInThis = prodItems.filter(i => selectedSet.has(i.serial_number)).length;
                    const denomPurchasingCost = rateNum > 0 ? (currentDenomObj.weight_grams * rateNum) : 0;

                    return (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '14px',
                        padding: '8px 16px',
                        background: 'rgba(0, 155, 78, 0.08)',
                        border: '1px solid rgba(0, 155, 78, 0.25)',
                        borderRadius: '6px',
                        minHeight: '44px'
                      }}>
                        <div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Available Stock' : 'المخزون المتاح'}</div>
                          <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--kfh-green)' }}>
                            {currentDenomObj.count} {currentLang === 'en' ? 'bars' : 'سبيكة'} <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'normal' }}>({(currentDenomObj.count * currentDenomObj.weight_grams).toLocaleString()} g)</span>
                          </div>
                        </div>

                        {selectedInThis > 0 && (
                          <div style={{ borderLeft: '1px solid rgba(0, 155, 78, 0.25)', paddingLeft: '12px' }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Selected for Purchase' : 'المحدد للشراء'}</div>
                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--accent-gold)' }}>
                              ✓ {selectedInThis} {currentLang === 'en' ? 'bars' : 'سبيكة'}
                            </div>
                          </div>
                        )}

                        {denomPurchasingCost > 0 && (
                          <div style={{ borderLeft: '1px solid rgba(0, 155, 78, 0.25)', paddingLeft: '12px' }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Purchasing Cost / Bar' : 'تكلفة الشراء للسبيكة'}</div>
                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--kfh-green)' }}>
                              {denomPurchasingCost.toFixed(3)} KWD
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* STEP 2: FACILITATE AVAILABLE SERIALS FOR THE CHOSEN DENOMINATION */}
              {currentDenomObj && (
                <div style={{ background: 'rgba(0, 0, 0, 0.15)', borderRadius: '8px', padding: '14px', border: '1px solid rgba(255,255,255,0.06)' }}>
                  
                  {/* Top Bar inside Denomination: Quick Quantity Selector & Actions */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {currentLang === 'en' ? 'Quick Quantity Picker:' : 'تحديد سريع بالكمية:'}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="number"
                          min="1"
                          max={itemsForSelectedDenom.length}
                          value={quickQtyToSelect}
                          onChange={e => setQuickQtyToSelect(Math.max(1, parseInt(e.target.value) || 1))}
                          style={{ width: '60px', padding: '4px 8px', fontSize: '12px', borderRadius: '4px', textAlign: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: 'var(--text-primary)' }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => handleSelectFirstNForDenom(quickQtyToSelect)}
                          style={{ fontSize: '11px', padding: '5px 10px' }}
                        >
                          <i className="fa-solid fa-plus"></i> {currentLang === 'en' ? `Select First ${quickQtyToSelect}` : `تحديد أول ${quickQtyToSelect}`}
                        </button>
                      </div>

                      <div style={{ display: 'flex', gap: '4px', marginLeft: '6px' }}>
                        {[1, 5, 10, 25].filter(n => n <= itemsForSelectedDenom.length).map(n => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => {
                              setQuickQtyToSelect(n);
                              handleSelectFirstNForDenom(n);
                            }}
                            style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--surface-border)', color: 'var(--text-muted)', cursor: 'pointer' }}
                          >
                            +{n}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleSelectAllForDenom}
                        style={{ fontSize: '11px', padding: '4px 10px' }}
                      >
                        <i className="fa-solid fa-check"></i> {currentLang === 'en' ? `Select All ${currentDenomObj.denomination} (${itemsForSelectedDenom.length})` : `تحديد كل فئة ${currentDenomObj.denomination} (${itemsForSelectedDenom.length})`}
                      </button>
                      {selectedCountForCurrentDenom > 0 && (
                        <button
                          type="button"
                          className="btn"
                          onClick={handleDeselectAllForDenom}
                          style={{ fontSize: '11px', padding: '4px 10px', background: 'rgba(255,255,255,0.05)' }}
                        >
                          {currentLang === 'en' ? 'Deselect Denom' : 'إلغاء تحديد الفئة'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Search Bar for Serials in current denomination */}
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <input
                        type="text"
                        className="form-control"
                        placeholder={currentLang === 'en' ? `Search serials in ${currentDenomObj.denomination} (e.g. SN or TR-)... ` : `بحث في الأرقام التسلسلية لفئة ${currentDenomObj.denomination}...`}
                        value={denomSerialSearch}
                        onChange={e => setDenomSerialSearch(e.target.value)}
                        style={{ fontSize: '12px', padding: '6px 10px', paddingLeft: currentLang === 'en' ? '30px' : '10px', paddingRight: currentLang === 'ar' ? '30px' : '10px' }}
                      />
                      <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', top: '50%', [currentLang === 'en' ? 'left' : 'right']: '10px', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '11px' }}></i>
                    </div>
                    {denomSerialSearch && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setDenomSerialSearch('')}
                        style={{ fontSize: '11px', padding: '4px 10px' }}
                      >
                        {currentLang === 'en' ? 'Clear Filter' : 'مسح'}
                      </button>
                    )}
                  </div>

                  {/* Available Serials Chips Grid */}
                  <div style={{
                    maxHeight: '180px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    padding: '8px',
                    background: 'var(--bg-secondary)',
                    borderRadius: '6px',
                    border: '1px solid var(--surface-border)'
                  }}>
                    {displayedDenomSerials.length === 0 ? (
                      <div style={{ width: '100%', textAlign: 'center', padding: '14px', fontSize: '12px', color: 'var(--text-muted)' }}>
                        {denomSerialSearch
                          ? (currentLang === 'en' ? 'No serial numbers match your search query.' : 'لا توجد أرقام تسلسلية مطابقة لبحثك.')
                          : (currentLang === 'en' ? 'No available items in this denomination.' : 'لا توجد سبائك متاحة لهذه الفئة.')}
                      </div>
                    ) : (
                      displayedDenomSerials.map(item => {
                        const isSelected = selectedSerials.includes(item.serial_number);
                        return (
                          <div
                            key={item.serial_number}
                            onClick={() => handleToggleItem(item.serial_number)}
                            style={{
                              padding: '5px 9px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontFamily: 'monospace',
                              fontWeight: 600,
                              cursor: 'pointer',
                              userSelect: 'none',
                              transition: 'all 0.15s',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              background: isSelected ? 'rgba(0, 155, 78, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                              border: isSelected ? '1px solid var(--kfh-green)' : '1px solid var(--surface-border)',
                              color: isSelected ? 'var(--kfh-green)' : 'var(--text-primary)'
                            }}
                          >
                            <i className={`fa-solid ${isSelected ? 'fa-square-check' : 'fa-square'}`} style={{ color: isSelected ? 'var(--kfh-green)' : 'var(--text-muted)' }}></i>
                            <span>{item.serial_number}</span>
                            {item.has_qr_printed ? (
                              <span title="QR Printed" style={{ fontSize: '9px', color: 'var(--kfh-green)' }}>
                                <i className="fa-solid fa-qrcode"></i>
                              </span>
                            ) : (
                              <span title="No QR Label" style={{ fontSize: '9px', color: '#EF4444' }}>
                                <i className="fa-solid fa-triangle-exclamation"></i>
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Summary footer for current denomination */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <span>
                      {currentLang === 'en' ? 'Showing:' : 'عرض:'} <strong>{displayedDenomSerials.length}</strong> {currentLang === 'en' ? 'bars' : 'سبيكة'}
                    </span>
                    <span style={{ color: selectedCountForCurrentDenom > 0 ? 'var(--kfh-green)' : 'inherit', fontWeight: selectedCountForCurrentDenom > 0 ? 'bold' : 'normal' }}>
                      {currentLang === 'en' ? 'Selected in this denomination:' : 'المحدد من هذه الفئة:'} {selectedCountForCurrentDenom} / {itemsForSelectedDenom.length}
                    </span>
                  </div>

                </div>
              )}

            </div>

            {/* DEDICATED QR & BARCODE FAST SCANNER BOX */}
            <div className="glass-card" style={{ padding: '16px', borderLeft: '4px solid #3B82F6' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-barcode" style={{ color: '#3B82F6', fontSize: '18px' }}></i>
                  <div>
                    <h5 style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)' }}>
                      {currentLang === 'en' ? 'Barcode & QR Code Scanner (Fast Piece Addition)' : 'ماسح الباركود ورمز QR (إضافة سريعة بالقطعة)'}
                    </h5>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {currentLang === 'en' ? 'Scan physical bar QR/DataMatrix or enter serial number directly.' : 'امسح رمز الاستجابة السريعة QR أو أدخل الرقم التسلسلي للإضافة فوراً.'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setSmartProduct(selectedDenomCode);
                    setShowSmartModal(true);
                  }}
                  style={{ fontSize: '11px', padding: '4px 10px' }}
                >
                  <i className="fa-solid fa-camera"></i> {currentLang === 'en' ? 'Camera / OCR / Range' : 'الكاميرا / النطاق'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  ref={qrInputRef}
                  type="text"
                  className="form-control"
                  placeholder={currentLang === 'en' ? 'Scan or type bar serial number and hit Enter (e.g. B00570, TR-2026-0001)...' : 'امسح أو اكتب الرقم التسلسلي واضغط Enter...'}
                  value={qrScanInput}
                  onChange={e => setQrScanInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleProcessScanInput(qrScanInput);
                    }
                  }}
                  style={{ fontSize: '12px' }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleProcessScanInput(qrScanInput)}
                  style={{ fontSize: '12px', padding: '6px 16px' }}
                >
                  <i className="fa-solid fa-plus"></i> {currentLang === 'en' ? 'Add' : 'إضافة'}
                </button>
              </div>

              {scanFeedback && (
                <div style={{
                  marginTop: '8px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: scanFeedback.type === 'success' ? 'rgba(0, 155, 78, 0.15)' : scanFeedback.type === 'warning' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: scanFeedback.type === 'success' ? 'var(--kfh-green)' : scanFeedback.type === 'warning' ? '#F59E0B' : '#EF4444'
                }}>
                  <i className={`fa-solid ${scanFeedback.type === 'success' ? 'fa-circle-check' : scanFeedback.type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-xmark'}`}></i>
                  <span>{scanFeedback.message}</span>
                </div>
              )}
            </div>

            {/* STEP 3: SELECTED TURKEY GOLD ITEMS TABLE */}
            <div className="glass-card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--kfh-green)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 'bold' }}>
                    2
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '15px', color: 'var(--text-primary)' }}>
                      {currentLang === 'en' ? 'Selected Turkey Consignment Bars' : 'السبائك التركية المحددة للشراء'}
                      <span className="badge badge-ready" style={{ marginLeft: '8px', fontSize: '12px' }}>
                        {selectedItemsData.count} {currentLang === 'en' ? 'bars' : 'سبيكة'}
                      </span>
                    </h4>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {currentLang === 'en' ? `Total weight: ${selectedItemsData.totalWeightKg} KG (${selectedItemsData.totalWeightGrams.toLocaleString()} grams)` : `الوزن الإجمالي: ${selectedItemsData.totalWeightKg} كجم (${selectedItemsData.totalWeightGrams.toLocaleString()} جم)`}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {selectedItemsData.count > 0 && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setIsItemsListExpanded(prev => !prev)}
                      style={{ fontSize: '11px', padding: '5px 10px' }}
                    >
                      <i className={`fa-solid ${isItemsListExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i> {isItemsListExpanded ? (currentLang === 'en' ? 'Collapse Table' : 'طي الجدول') : (currentLang === 'en' ? 'Expand Table' : 'توسيع الجدول')}
                    </button>
                  )}
                </div>
              </div>

              {/* Denomination Breakdown Summary Pills */}
              {selectedBreakdownByDenomination.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px', marginBottom: '14px' }}>
                  {selectedBreakdownByDenomination.map(denom => (
                    <div key={denom.product_code} style={{ padding: '8px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--surface-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{denom.denomination}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{denom.count} bars • {denom.total_weight_grams.toLocaleString()} g</div>
                      </div>
                      {rateNum > 0 && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{denom.purchasing_cost_per_bar.toFixed(3)} KWD/bar</div>
                          <strong style={{ fontSize: '12px', color: 'var(--kfh-green)' }}>{denom.subtotal_purchasing_cost.toFixed(3)} KWD</strong>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Selected Items Table */}
              {isItemsListExpanded && (
                <>
                  {selectedItemsData.count > 0 && (
                    <div style={{ marginBottom: '10px' }}>
                      <input
                        type="text"
                        className="form-control"
                        placeholder={currentLang === 'en' ? 'Filter selected items by serial, refiner, lot, or location...' : 'تصفية السبائك المحددة...'}
                        value={searchSelectedQuery}
                        onChange={e => setSearchSelectedQuery(e.target.value)}
                        style={{ fontSize: '12px', padding: '6px 10px' }}
                      />
                    </div>
                  )}

                  <div className="table-responsive" style={{ maxHeight: '350px', overflowY: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: '40px' }}>#</th>
                          <th>{currentLang === 'en' ? 'Serial Number' : 'الرقم التسلسلي'}</th>
                          <th>{currentLang === 'en' ? 'Denomination' : 'الفئة'}</th>
                          <th>{currentLang === 'en' ? 'Weight (g)' : 'الوزن (جم)'}</th>
                          <th>{currentLang === 'en' ? 'Refiner' : 'المصفاة'}</th>
                          <th>{currentLang === 'en' ? 'Shipment / Lot' : 'الشحنة / التشغيلة'}</th>
                          <th>{currentLang === 'en' ? 'Purchasing Cost' : 'تكلفة الشراء'}</th>
                          <th>{currentLang === 'en' ? 'QR Status' : 'حالة QR'}</th>
                          <th style={{ width: '60px' }}>{currentLang === 'en' ? 'Remove' : 'إزالة'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedSelectedItems.length === 0 ? (
                          <tr>
                            <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                              <i className="fa-solid fa-cart-arrow-down" style={{ fontSize: '24px', marginBottom: '8px', display: 'block', opacity: 0.5 }}></i>
                              {currentLang === 'en' 
                                ? 'Select a Denomination / Type above, or use the Barcode & QR Code Scanner to add Turkey consignment bars to this purchase order.' 
                                : 'اختر فئة السبيكة بالأعلى أو استخدم ماسح الباركود و QR لإضافة السبائك التركية لأمر الشراء.'}
                            </td>
                          </tr>
                        ) : (
                          displayedSelectedItems.map((item, idx) => {
                            const barCost = rateNum > 0 ? (item.weight_grams * rateNum) : 0;
                            return (
                              <tr key={item.serial_number}>
                                <td>{idx + 1}</td>
                                <td><strong style={{ fontFamily: 'monospace', color: 'var(--kfh-green)' }}>{item.serial_number}</strong></td>
                                <td>{item.denomination || item.metal_name}</td>
                                <td>{item.weight_grams} g</td>
                                <td>{item.refiner_name || 'Nadir Refinery'}</td>
                                <td>
                                  <span style={{ fontSize: '11px', fontFamily: 'monospace', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px' }}>
                                    {item.lot_number || 'LOT-TR-2026'}
                                  </span>
                                </td>
                                <td>
                                  {barCost > 0 ? (
                                    <strong style={{ color: 'var(--kfh-green)' }}>{barCost.toFixed(3)} KWD</strong>
                                  ) : (
                                    <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>—</span>
                                  )}
                                </td>
                                <td>
                                  {item.has_qr_printed ? (
                                    <span className="badge badge-ready" style={{ fontSize: '10px' }}><i className="fa-solid fa-check"></i> Printed</span>
                                  ) : (
                                    <span className="badge badge-sold" style={{ fontSize: '10px' }}><i className="fa-solid fa-triangle-exclamation"></i> Missing</span>
                                  )}
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleItem(item.serial_number)}
                                    style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: '14px' }}
                                    title={currentLang === 'en' ? 'Remove' : 'إزالة'}
                                  >
                                    <i className="fa-solid fa-xmark"></i>
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

          </div>

          {/* RIGHT: PURCHASE RATE (COST / GRAM) & CONVERSION SUMMARY & SUBMIT */}
          <div className="glass-card" style={{ padding: '20px', position: 'sticky', top: '20px' }}>
            <h4 style={{ margin: 0, marginBottom: '16px', fontSize: '15px', color: 'var(--kfh-green)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="fa-solid fa-receipt"></i>
              {currentLang === 'en' ? 'Purchase Pricing & Terms' : 'تسعير الشراء وشروط التحويل'}
            </h4>

            {/* Selected Bars Count & Weight */}
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '14px', marginBottom: '16px', border: '1px solid var(--surface-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Selected Quantity:' : 'الكمية المحددة:'}</span>
                <strong>{selectedItemsData.count} {currentLang === 'en' ? 'bars' : 'سبيكة'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Total Weight (grams):' : 'الوزن الإجمالي (جرام):'}</span>
                <strong>{selectedItemsData.totalWeightGrams.toLocaleString()} g</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--surface-border)', paddingTop: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Total Weight (KG):' : 'الوزن الإجمالي (كجم):'}</span>
                <strong style={{ color: 'var(--kfh-green)', fontSize: '14px' }}>{selectedItemsData.totalWeightKg} KG</strong>
              </div>
            </div>

            {/* Agreed Purchase Rate (KWD / Gram) */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
                <span>{currentLang === 'en' ? 'Agreed Purchase Rate (KWD / gram) *' : 'سعر الشراء المتفق عليه (د.ك / جم) *'}</span>
                {goldRate > 0 && (
                  <span style={{ color: 'var(--accent-gold)', fontSize: '11px', fontWeight: 'normal' }}>
                    ~{((goldRate * 0.308) / 31.1035).toFixed(3)} KWD/g spot
                  </span>
                )}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  className="form-control"
                  placeholder="e.g. 26.450"
                  value={unitPricePerGram}
                  onChange={e => setUnitPricePerGram(e.target.value)}
                  style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--kfh-green)' }}
                  required
                />
                <span style={{ position: 'absolute', right: currentLang === 'en' ? '12px' : 'auto', left: currentLang === 'ar' ? '12px' : 'auto', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: 'var(--text-muted)' }}>
                  KWD / g
                </span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                {currentLang === 'en' 
                  ? 'Cost per gram registered with shipment lot and used to calculate purchasing cost by denomination.'
                  : 'تكلفة الجرام ستُسجل مع الشحنة وتُستخدم لاحتساب تكلفة الشراء لكل فئة.'}
              </span>
            </div>

            {/* Total Agreed Purchase Cost Card */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(0, 155, 78, 0.15) 0%, rgba(212, 175, 55, 0.1) 100%)',
              borderRadius: '8px',
              padding: '14px',
              border: '1px solid rgba(0, 155, 78, 0.3)',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {currentLang === 'en' ? 'Total Agreed Purchasing Cost' : 'إجمالي تكلفة الشراء المتفق عليها'}
              </div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--kfh-green)', marginTop: '4px' }}>
                {totalAgreedCostKwd.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} <span style={{ fontSize: '14px' }}>KWD</span>
              </div>
              {selectedShipmentLots.length > 0 && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                  {currentLang === 'en' ? 'Shipment Lots:' : 'تشغيلات الشحنة:'} {selectedShipmentLots.join(', ')}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Purchase Notes & Memo' : 'ملاحظات أمر الشراء'}</label>
              <textarea
                rows={3}
                className="form-control"
                placeholder={currentLang === 'en' ? 'e.g. Nadir Refinery consignment conversion agreement Ref TR-2026-Q1...' : 'مثال: اتفاقية تحويل أمانات مصفاة نادر رقم TR-2026-Q1...'}
                value={purchaseNotes}
                onChange={e => setPurchaseNotes(e.target.value)}
                style={{ fontSize: '12px' }}
              />
            </div>

            {/* QR Verification Warning if policy active and unprinted bars selected */}
            {isQrRequirementActive && unprintedSelectedItems.length > 0 && selectedSerials.length > 0 && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: '6px',
                padding: '10px 12px',
                fontSize: '11px',
                color: '#EF4444',
                marginBottom: '16px',
                lineHeight: '1.4'
              }}>
                <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: '6px' }}></i>
                <strong>{currentLang === 'en' ? 'QR Policy Enforcement:' : 'تطبيق سياسة رمز QR:'}</strong>{' '}
                {currentLang === 'en'
                  ? `${unprintedSelectedItems.length} selected bar(s) do not have printed QR codes. System settings require all bars to have printed QR labels before transfer.`
                  : `يوجد ${unprintedSelectedItems.length} سبيكة محددة بدون ملصق QR مطبوع. إعدادات النظام تمنع نقل الملكية حتى تتم طباعة ملصقات QR لجميع السبائك.`}
              </div>
            )}

            {/* Submit Button */}
            {canModify ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={selectedSerials.length === 0 || isSubmitting || (isQrRequirementActive && unprintedSelectedItems.length > 0)}
                style={{ width: '100%', padding: '12px', fontSize: '14px', fontWeight: 'bold' }}
              >
                {isSubmitting ? (
                  <><i className="fa-solid fa-spinner fa-spin"></i> {currentLang === 'en' ? 'Submitting...' : 'جاري الإرسال...'}</>
                ) : (
                  <><i className="fa-solid fa-paper-plane"></i> {currentLang === 'en' ? 'Submit Purchase for Approval' : 'إرسال طلب الشراء للاعتماد'}</>
                )}
              </button>
            ) : (
              <div style={{ fontSize: '12px', color: 'var(--accent-red)', textAlign: 'center' }}>
                <i className="fa-solid fa-lock"></i> {currentLang === 'en' ? 'Maker role required to initiate purchases.' : 'يتطلب صلاحية صانع لبدء طلبات الشراء.'}
              </div>
            )}

            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px', textAlign: 'center', lineHeight: '1.4' }}>
              <i className="fa-solid fa-shield-halved" style={{ color: 'var(--kfh-green)' }}></i>{' '}
              {currentLang === 'en' 
                ? 'Upon Checker approval, gold ownership will transition to KFH_OWNED and purchasing costs per denomination will register in inventory ledger.' 
                : 'بمجرد اعتماد المراجع، ستتحول ملكية الذهب إلى بيتك (KFH_OWNED) وتُسجل تكلفة الشراء حسب الفئة في سجلات المخزون.'}
            </div>

          </div>

        </div>
      )}

      {/* 4. SUBTAB 2: KFH STOCK & VIP ALLOCATION WORKBENCH */}
      {activeSubTab === 'VIP_STOCK' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* SECTION A: ALLOCATE KFH STOCK TO VIP RESERVE */}
          <div className="glass-card" style={{ padding: '22px', borderLeft: '4px solid #6366f1', background: 'linear-gradient(180deg, rgba(99, 102, 241, 0.04) 0%, rgba(255,255,255,0.01) 100%)' }}>
            
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>
                  👑
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '16px', color: '#6366f1' }}>
                    {currentLang === 'en' ? 'Allocate KFH Stock to VIP Reserve' : 'تخصيص مخزون بيتك لكبار العملاء (VIP)'}
                  </h4>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {currentLang === 'en' 
                      ? 'Select gold bars from KFH Owned stock to transition ownership to VIP_OWNED. This stock will be strictly isolated from online retail.' 
                      : 'حدد سبائك من مخزون بيتك لتحويل ملكيتها إلى كبار العملاء (VIP_OWNED). هذا المخزون لن يكون متاحاً للبيع أونلاين.'}
                  </span>
                </div>
              </div>

              {selectedKfhSerials.length > 0 && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setSelectedKfhSerials([])}
                  style={{ fontSize: '11px', padding: '5px 12px' }}
                >
                  <i className="fa-solid fa-trash-can"></i> {currentLang === 'en' ? `Clear Selection (${selectedKfhSerials.length})` : `إلغاء التحديد (${selectedKfhSerials.length})`}
                </button>
              )}
            </div>

            {/* Denomination Choice Dropdown List for KFH Stock */}
            <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '14px', alignItems: 'end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ margin: 0, flex: 1, minWidth: '280px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                    <i className="fa-solid fa-coins" style={{ color: '#6366f1' }}></i>
                    {currentLang === 'en' ? 'Select Denomination & Metal Type' : 'اختر فئة ونوع السبيكة'}
                  </label>
                  <select
                    className="form-control"
                    value={selectedKfhDenomCode}
                    onChange={e => {
                      setSelectedKfhDenomCode(e.target.value);
                      setKfhSerialSearch('');
                    }}
                    style={{
                      fontSize: '13px',
                      padding: '10px 14px',
                      fontWeight: '600',
                      backgroundColor: 'var(--bg-secondary)',
                      borderColor: '#6366f1',
                      color: 'var(--text-primary)',
                      width: '100%',
                      borderRadius: '6px'
                    }}
                  >
                    {kfhAvailableInventory?.summary?.by_product?.map(p => {
                      const prodItems = kfhAvailableItems.filter(i => i.product_code === p.product_code);
                      const selectedSet = new Set(selectedKfhSerials);
                      const selectedInThis = prodItems.filter(i => selectedSet.has(i.serial_number)).length;
                      return (
                        <option key={p.product_code} value={p.product_code} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                          {p.denomination} — {p.metal_name} ({p.weight_grams}g) — [{p.count} {currentLang === 'en' ? 'KFH stock' : 'متاح بيتك'}{selectedInThis > 0 ? ` • ${selectedInThis} ${currentLang === 'en' ? 'selected' : 'محدد'}` : ''}]
                        </option>
                      );
                    })}
                  </select>
                </div>

                {currentKfhDenomObj && (() => {
                  const prodItems = kfhAvailableItems.filter(i => i.product_code === currentKfhDenomObj.product_code);
                  const selectedSet = new Set(selectedKfhSerials);
                  const selectedInThis = prodItems.filter(i => selectedSet.has(i.serial_number)).length;

                  return (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                      padding: '8px 16px',
                      background: 'rgba(99, 102, 241, 0.08)',
                      border: '1px solid rgba(99, 102, 241, 0.25)',
                      borderRadius: '6px',
                      minHeight: '44px'
                    }}>
                      <div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'KFH Stock' : 'مخزون بيتك'}</div>
                        <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#6366f1' }}>
                          {currentKfhDenomObj.count} {currentLang === 'en' ? 'bars' : 'سبيكة'} <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'normal' }}>({(currentKfhDenomObj.count * currentKfhDenomObj.weight_grams).toLocaleString()} g)</span>
                        </div>
                      </div>

                      {selectedInThis > 0 && (
                        <div style={{ borderLeft: '1px solid rgba(99, 102, 241, 0.25)', paddingLeft: '12px' }}>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Selected for VIP' : 'المحدد للـ VIP'}</div>
                          <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#818cf8' }}>
                            ✓ {selectedInThis} {currentLang === 'en' ? 'bars' : 'سبيكة'}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* KFH Serials Facilitator & Quick Picker */}
            {currentKfhDenomObj && (
              <div style={{ background: 'rgba(0, 0, 0, 0.15)', borderRadius: '8px', padding: '14px', border: '1px solid rgba(255,255,255,0.06)', marginBottom: '16px' }}>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {currentLang === 'en' ? 'Quick Quantity Picker:' : 'تحديد سريع بالكمية:'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="number"
                        min="1"
                        max={kfhItemsForSelectedDenom.length}
                        value={kfhQuickQty}
                        onChange={e => setKfhQuickQty(Math.max(1, parseInt(e.target.value) || 1))}
                        style={{ width: '60px', padding: '4px 8px', fontSize: '12px', borderRadius: '4px', textAlign: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--surface-border)', color: 'var(--text-primary)' }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleSelectFirstNForKfh(kfhQuickQty)}
                        style={{ fontSize: '11px', padding: '5px 10px' }}
                      >
                        <i className="fa-solid fa-plus"></i> {currentLang === 'en' ? `Select First ${kfhQuickQty}` : `تحديد أول ${kfhQuickQty}`}
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: '4px', marginLeft: '6px' }}>
                      {[1, 5, 10, 25].filter(n => n <= kfhItemsForSelectedDenom.length).map(n => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => {
                            setKfhQuickQty(n);
                            handleSelectFirstNForKfh(n);
                          }}
                          style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--surface-border)', color: 'var(--text-muted)', cursor: 'pointer' }}
                        >
                          +{n}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleSelectAllForKfhDenom}
                      style={{ fontSize: '11px', padding: '4px 10px' }}
                    >
                      <i className="fa-solid fa-check"></i> {currentLang === 'en' ? `Select All ${currentKfhDenomObj.denomination} (${kfhItemsForSelectedDenom.length})` : `تحديد كل فئة ${currentKfhDenomObj.denomination} (${kfhItemsForSelectedDenom.length})`}
                    </button>
                    {selectedKfhCountForCurrentDenom > 0 && (
                      <button
                        type="button"
                        className="btn"
                        onClick={handleDeselectAllForKfhDenom}
                        style={{ fontSize: '11px', padding: '4px 10px', background: 'rgba(255,255,255,0.05)' }}
                      >
                        {currentLang === 'en' ? 'Deselect Denom' : 'إلغاء تحديد الفئة'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Search Bar for KFH serials */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input
                      type="text"
                      className="form-control"
                      placeholder={currentLang === 'en' ? `Search serials in KFH ${currentKfhDenomObj.denomination}... ` : `بحث في أرقام بيتك لفئة ${currentKfhDenomObj.denomination}...`}
                      value={kfhSerialSearch}
                      onChange={e => setKfhSerialSearch(e.target.value)}
                      style={{ fontSize: '12px', padding: '6px 10px', paddingLeft: currentLang === 'en' ? '30px' : '10px', paddingRight: currentLang === 'ar' ? '30px' : '10px' }}
                    />
                    <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', top: '50%', [currentLang === 'en' ? 'left' : 'right']: '10px', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '11px' }}></i>
                  </div>
                  {kfhSerialSearch && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setKfhSerialSearch('')}
                      style={{ fontSize: '11px', padding: '4px 10px' }}
                    >
                      {currentLang === 'en' ? 'Clear' : 'مسح'}
                    </button>
                  )}
                </div>

                {/* Available KFH Serials Chips Grid */}
                <div style={{
                  maxHeight: '160px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '6px',
                  padding: '8px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '6px',
                  border: '1px solid var(--surface-border)'
                }}>
                  {displayedKfhSerials.length === 0 ? (
                    <div style={{ width: '100%', textAlign: 'center', padding: '14px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      {currentLang === 'en' ? 'No KFH bars available in this denomination.' : 'لا توجد سبائك بيتك متاحة لهذه الفئة.'}
                    </div>
                  ) : (
                    displayedKfhSerials.map(item => {
                      const isSelected = selectedKfhSerials.includes(item.serial_number);
                      return (
                        <div
                          key={item.serial_number}
                          onClick={() => handleToggleKfhItem(item.serial_number)}
                          style={{
                            padding: '5px 9px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            cursor: 'pointer',
                            userSelect: 'none',
                            transition: 'all 0.15s',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            background: isSelected ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                            border: isSelected ? '1px solid #6366f1' : '1px solid var(--surface-border)',
                            color: isSelected ? '#6366f1' : 'var(--text-primary)'
                          }}
                        >
                          <i className={`fa-solid ${isSelected ? 'fa-square-check' : 'fa-square'}`} style={{ color: isSelected ? '#6366f1' : 'var(--text-muted)' }}></i>
                          <span>{item.serial_number}</span>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Denomination summary footer */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  <span>{currentLang === 'en' ? 'Showing:' : 'عرض:'} <strong>{displayedKfhSerials.length}</strong> {currentLang === 'en' ? 'bars' : 'سبيكة'}</span>
                  <span style={{ color: selectedKfhCountForCurrentDenom > 0 ? '#6366f1' : 'inherit', fontWeight: selectedKfhCountForCurrentDenom > 0 ? 'bold' : 'normal' }}>
                    {currentLang === 'en' ? 'Selected in this denomination:' : 'المحدد من هذه الفئة:'} {selectedKfhCountForCurrentDenom} / {kfhItemsForSelectedDenom.length}
                  </span>
                </div>

              </div>
            )}

            {/* Fast Scan input for KFH piece selection */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <input
                ref={kfhQrInputRef}
                type="text"
                className="form-control"
                placeholder={currentLang === 'en' ? 'Scan bar QR / Barcode to add to VIP allocation...' : 'امسح باركود أو رمز QR السبيكة للإضافة لتخصيص VIP...'}
                value={kfhQrScanInput}
                onChange={e => setKfhQrScanInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleProcessKfhScanInput(kfhQrScanInput);
                  }
                }}
                style={{ fontSize: '12px' }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => handleProcessKfhScanInput(kfhQrScanInput)}
                style={{ fontSize: '12px', padding: '6px 16px' }}
              >
                <i className="fa-solid fa-plus"></i> {currentLang === 'en' ? 'Add' : 'إضافة'}
              </button>
            </div>

            {kfhScanFeedback && (
              <div style={{
                marginBottom: '16px',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                background: kfhScanFeedback.type === 'success' ? 'rgba(0, 155, 78, 0.15)' : kfhScanFeedback.type === 'warning' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: kfhScanFeedback.type === 'success' ? 'var(--kfh-green)' : kfhScanFeedback.type === 'warning' ? '#F59E0B' : '#EF4444'
              }}>
                {kfhScanFeedback.message}
              </div>
            )}

            {/* Allocation Form Fields & Submit */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', alignItems: 'end', background: 'rgba(255,255,255,0.02)', padding: '14px', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
              
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#6366f1' }}>
                  {currentLang === 'en' ? 'VIP Category / Portfolio Tier:' : 'تصنيف محفظة كبار العملاء:'}
                </label>
                <select
                  className="form-control"
                  value={vipCategory}
                  onChange={e => setVipCategory(e.target.value)}
                  style={{ fontSize: '12px' }}
                >
                  <option value="Private Banking / VIP Exclusive">Private Banking / VIP Exclusive</option>
                  <option value="High Net Worth Wealth Management">High Net Worth Wealth Management</option>
                  <option value="Executive Board Reserve">Executive Board Reserve</option>
                  <option value="Custom VIP Custody">Custom VIP Custody</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  {currentLang === 'en' ? 'Allocation Memo & Reason:' : 'ملاحظات وسبب التخصيص:'}
                </label>
                <input
                  type="text"
                  className="form-control"
                  placeholder={currentLang === 'en' ? 'e.g. VIP client bulk reservation for Private Banking desk...' : 'مثال: حجز كمية لصالح عملاء الخدمات المصرفية الخاصة...'}
                  value={vipAllocationNotes}
                  onChange={e => setVipAllocationNotes(e.target.value)}
                  style={{ fontSize: '12px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {currentLang === 'en' ? 'Selected KFH Online Stock:' : 'المحدد من مخزون بيتك:'} <strong>{selectedKfhItemsData.count} bars ({selectedKfhItemsData.totalWeightKg} KG)</strong>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={handleAllocateToVip}
                    disabled={selectedKfhSerials.length === 0 || isSubmittingVipAlloc}
                    style={{ flex: 1, background: '#6366f1', borderColor: '#6366f1', color: '#fff', padding: '10px 14px', fontWeight: 'bold', fontSize: '12px' }}
                  >
                    {isSubmittingVipAlloc ? (
                      <><i className="fa-solid fa-spinner fa-spin"></i> {currentLang === 'en' ? 'Submitting...' : 'جاري الإرسال...'}</>
                    ) : (
                      <><i className="fa-solid fa-crown"></i> {currentLang === 'en' ? 'Allocate to VIP Stock' : 'تخصيص لمخزون VIP'}</>
                    )}
                  </button>

                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setReturnSourceOrigin('KFH');
                      setShowReturnModal(true);
                    }}
                    disabled={selectedKfhSerials.length === 0}
                    style={{
                      background: selectedKfhSerials.length > 0 ? '#F59E0B' : 'var(--bg-secondary)',
                      borderColor: selectedKfhSerials.length > 0 ? '#F59E0B' : 'var(--surface-border)',
                      color: selectedKfhSerials.length > 0 ? '#000' : 'var(--text-muted)',
                      padding: '10px 14px',
                      fontWeight: 'bold',
                      fontSize: '12px'
                    }}
                    title={currentLang === 'en' ? 'Return selected bars back to Turkey consignment (offline owner)' : 'إرجاع السبائك المحددة إلى مخزون أمانة تركيا'}
                  >
                    <i className="fa-solid fa-rotate-left"></i> {currentLang === 'en' ? 'Return to Turkey' : 'إرجاع لتركيا'}
                  </button>
                </div>
              </div>

            </div>

          </div>

          {/* SECTION B: ACTIVE VIP EXCLUSIVE VAULT STOCK & WORKFLOWS */}
          <div className="glass-card" style={{ padding: '22px' }}>
            
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '16px', color: '#6366f1', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-vault"></i>
                  {currentLang === 'en' ? 'Active VIP Exclusive Vault Stock (KFH Owned - OFFLINE Channel)' : 'مخزون كبار العملاء الفعلي بالخزنة (بيتك - أوفلاين)'}
                </h4>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {currentLang === 'en'
                    ? 'Isolated stock reserved for VIP private clients & GFS operations. Dispense to clients or return to general KFH online stock below.'
                    : 'مخزون معزول ومخصص لكبار العملاء وعمليات GFS. يمكن صرف السبائك للعميل أو إرجاعها للمخزون العام المتاح أونلاين عبر سير العمل.'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowVipDispenseModal(true)}
                  disabled={selectedVipSerials.length === 0}
                  style={{
                    background: selectedVipSerials.length > 0 ? '#6366f1' : 'var(--bg-secondary)',
                    borderColor: selectedVipSerials.length > 0 ? '#6366f1' : 'var(--surface-border)',
                    color: selectedVipSerials.length > 0 ? '#fff' : 'var(--text-muted)',
                    fontWeight: 'bold',
                    padding: '8px 16px'
                  }}
                >
                  <i className="fa-solid fa-hand-holding-dollar"></i>{' '}
                  {currentLang === 'en'
                    ? `Dispense Selected (${selectedVipSerials.length}) to VIP Client`
                    : `صرف السبائك المحددة (${selectedVipSerials.length}) لعميل VIP`}
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowVipDeallocModal(true)}
                  disabled={selectedVipSerials.length === 0}
                  style={{
                    background: selectedVipSerials.length > 0 ? 'var(--kfh-green)' : 'var(--bg-secondary)',
                    borderColor: selectedVipSerials.length > 0 ? 'var(--kfh-green)' : 'var(--surface-border)',
                    color: selectedVipSerials.length > 0 ? '#fff' : 'var(--text-muted)',
                    fontWeight: 'bold',
                    padding: '8px 16px'
                  }}
                  title={currentLang === 'en' ? 'Return selected VIP offline bars back to general KFH online stock' : 'إرجاع سبائك VIP الأوفلاين المحددة إلى مخزون بيتك أونلاين'}
                >
                  <i className="fa-solid fa-rotate-left"></i>{' '}
                  {currentLang === 'en'
                    ? `Return Selected (${selectedVipSerials.length}) to Online Stock`
                    : `إرجاع المحدد (${selectedVipSerials.length}) إلى أونلاين`}
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setReturnSourceOrigin('VIP');
                    setShowReturnModal(true);
                  }}
                  disabled={selectedVipSerials.length === 0}
                  style={{
                    background: selectedVipSerials.length > 0 ? '#F59E0B' : 'var(--bg-secondary)',
                    borderColor: selectedVipSerials.length > 0 ? '#F59E0B' : 'var(--surface-border)',
                    color: selectedVipSerials.length > 0 ? '#000' : 'var(--text-muted)',
                    fontWeight: 'bold',
                    padding: '8px 16px'
                  }}
                  title={currentLang === 'en' ? 'Return selected VIP bars back to Turkey consignment (offline owner)' : 'إرجاع سبائك VIP المحددة إلى مخزون أمانة تركيا'}
                >
                  <i className="fa-solid fa-truck-ramp-box"></i>{' '}
                  {currentLang === 'en'
                    ? `Return (${selectedVipSerials.length}) to Turkey`
                    : `إرجاع لتركيا (${selectedVipSerials.length})`}
                </button>
              </div>
            </div>

            {/* Offline Isolation Alert Banner */}
            <div style={{
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '8px',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '16px'
            }}>
              <i className="fa-solid fa-eye-slash" style={{ color: '#6366f1', fontSize: '18px' }}></i>
              <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                <strong>{currentLang === 'en' ? 'Offline Stock Isolation Active:' : 'حظر البيع عبر الإنترنت مفعل:'}</strong>{' '}
                {currentLang === 'en'
                  ? 'All bars listed below carry OFFLINE channel status under KFH ownership. They cannot be bought through internet/e-commerce retail channels; only via GFS Counter, VIP Handover, or by Maker-Checker workflow return to online stock.'
                  : 'كافة السبائك أدناه مسجلة بقناة أوفلاين (OFFLINE) تحت ملكية بيتك. لا يمكن شراؤها عبر المتجر الإلكتروني أو الإنترنت، وإنما تُصرف حصراً عبر GFS أو بتسليم VIP أو بإعادتها للمخزون الأونلاين عبر سير العمل.'}
              </div>
            </div>

            {/* VIP Search filter */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input
                type="text"
                className="form-control"
                placeholder={currentLang === 'en' ? 'Search VIP vault stock by serial, denomination, location, category...' : 'بحث في مخزون VIP بالرقم أو الفئة أو الموقع...'}
                value={vipSerialSearch}
                onChange={e => setVipSerialSearch(e.target.value)}
                style={{ fontSize: '12px', padding: '6px 10px' }}
              />
              {vipSerialSearch && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setVipSerialSearch('')}
                  style={{ fontSize: '11px', padding: '4px 10px' }}
                >
                  {currentLang === 'en' ? 'Clear' : 'مسح'}
                </button>
              )}
            </div>

            {/* VIP Table */}
            <div className="table-responsive" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>
                      <input
                        type="checkbox"
                        checked={vipItems.length > 0 && selectedVipSerials.length === vipItems.length}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedVipSerials(vipItems.map(i => i.serial_number));
                          } else {
                            setSelectedVipSerials([]);
                          }
                        }}
                      />
                    </th>
                    <th>{currentLang === 'en' ? 'Serial Number' : 'الرقم التسلسلي'}</th>
                    <th>{currentLang === 'en' ? 'Denomination' : 'الفئة'}</th>
                    <th>{currentLang === 'en' ? 'Weight' : 'الوزن'}</th>
                    <th>{currentLang === 'en' ? 'Refiner' : 'المصفاة'}</th>
                    <th>{currentLang === 'en' ? 'Vault Location' : 'موقع الخزنة'}</th>
                    <th>{currentLang === 'en' ? 'VIP Category' : 'تصنيف VIP'}</th>
                    <th>{currentLang === 'en' ? 'Status' : 'الحالة'}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedVipItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                        <i className="fa-solid fa-crown" style={{ fontSize: '24px', opacity: 0.4, display: 'block', marginBottom: '8px' }}></i>
                        {currentLang === 'en' ? 'No VIP exclusive bars currently held in vault reserve.' : 'لا توجد سبائك VIP محجوزة بالخزنة حالياً.'}
                      </td>
                    </tr>
                  ) : (
                    displayedVipItems.map(item => {
                      const isSelected = selectedVipSerials.includes(item.serial_number);
                      return (
                        <tr key={item.serial_number} style={{ background: isSelected ? 'rgba(99, 102, 241, 0.08)' : undefined }}>
                          <td>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleVipItem(item.serial_number)}
                            />
                          </td>
                          <td>
                            <strong style={{ fontFamily: 'monospace', color: '#6366f1' }}>{item.serial_number}</strong>
                          </td>
                          <td>{item.denomination || item.metal_name}</td>
                          <td>{item.weight_grams} g</td>
                          <td>{item.refiner_name || 'Valcambi Suisse'}</td>
                          <td>
                            <span style={{ fontSize: '11px', fontFamily: 'monospace', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px' }}>
                              {item.location_code || 'VAULT-VIP-01'}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(99, 102, 241, 0.15)', color: '#6366f1', fontWeight: 600 }}>
                              {item.vip_category || 'Private Banking'}
                            </span>
                          </td>
                          <td>
                            <span className="badge" style={{ background: 'rgba(99, 102, 241, 0.2)', color: '#6366f1', fontSize: '10px' }}>
                              🔒 VIP Isolated
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {selectedVipSerials.length > 0 && (
              <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#6366f1', fontWeight: 'bold' }}>
                <span>{currentLang === 'en' ? 'Selected for Dispense:' : 'المحدد للصرف:'} {selectedVipItemsData.count} bars ({selectedVipItemsData.totalWeightKg} KG)</span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowVipDispenseModal(true)}
                  style={{ background: '#6366f1', color: '#fff', fontSize: '12px', padding: '6px 14px' }}
                >
                  <i className="fa-solid fa-arrow-right-to-bracket"></i> {currentLang === 'en' ? 'Proceed to Dispense Workflow' : 'متابعة سير عمل الصرف'}
                </button>
              </div>
            )}

          </div>

        </div>
      )}

      {/* 5. SUBTAB 3: OPERATIONS LOG & MAKER-CHECKER WORKFLOWS */}
      {activeSubTab === 'PENDING_BATCHES' && (
        <div className="glass-card" style={{ padding: '20px' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <h4 style={{ margin: 0, fontSize: '15px', color: 'var(--kfh-green)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="fa-solid fa-list-check"></i>
              {currentLang === 'en' ? 'Operations Log & Maker-Checker Workflow Requests' : 'سجل العمليات وطلبات اعتماد الأعين الأربعة'}
            </h4>

            {/* Filter Chips */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn ${pendingBatchFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPendingBatchFilter('ALL')}
                style={{ fontSize: '11px', padding: '4px 10px' }}
              >
                {currentLang === 'en' ? 'All Operations' : 'كافة العمليات'}
              </button>
              <button
                type="button"
                className={`btn ${pendingBatchFilter === 'TURKEY' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPendingBatchFilter('TURKEY')}
                style={{ fontSize: '11px', padding: '4px 10px' }}
              >
                🇹🇷 {currentLang === 'en' ? 'Turkey Purchases' : 'شراء تركيا'} ({pendingPurchases.length})
              </button>
              <button
                type="button"
                className={`btn ${pendingBatchFilter === 'VIP_ALLOCATION' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPendingBatchFilter('VIP_ALLOCATION')}
                style={{ fontSize: '11px', padding: '4px 10px' }}
              >
                👑 {currentLang === 'en' ? 'VIP Allocations' : 'تخصيص VIP'} ({pendingVipAllocations.length})
              </button>
              <button
                type="button"
                className={`btn ${pendingBatchFilter === 'VIP_DEALLOCATION' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPendingBatchFilter('VIP_DEALLOCATION')}
                style={{ fontSize: '11px', padding: '4px 10px', ...(pendingBatchFilter === 'VIP_DEALLOCATION' ? { background: 'var(--kfh-green)', borderColor: 'var(--kfh-green)' } : {}) }}
              >
                ↩️ 🌐 {currentLang === 'en' ? 'VIP to Online' : 'إرجاع لأونلاين'} ({pendingVipDeallocations.length})
              </button>
              <button
                type="button"
                className={`btn ${pendingBatchFilter === 'VIP_DISPENSE' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPendingBatchFilter('VIP_DISPENSE')}
                style={{ fontSize: '11px', padding: '4px 10px' }}
              >
                📤 {currentLang === 'en' ? 'VIP Dispenses' : 'صرف VIP'} ({pendingVipDispenses.length})
              </button>
              <button
                type="button"
                className={`btn ${pendingBatchFilter === 'TURKEY_RETURN' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPendingBatchFilter('TURKEY_RETURN')}
                style={{ fontSize: '11px', padding: '4px 10px' }}
              >
                ↩️ {currentLang === 'en' ? 'Turkey Returns' : 'إرجاع تركيا'} ({pendingTurkeyReturns.length})
              </button>
              <button
                type="button"
                className={`btn ${pendingBatchFilter === 'MISSING_ITEMS' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPendingBatchFilter('MISSING_ITEMS')}
                style={{ fontSize: '11px', padding: '4px 10px', ...(pendingBatchFilter === 'MISSING_ITEMS' ? { background: '#EF4444', borderColor: '#EF4444' } : {}) }}
              >
                ⚠️ {currentLang === 'en' ? 'Missing Reports' : 'تقارير المفقودات'} ({pendingMissingReports.length})
              </button>
            </div>
          </div>

          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>{currentLang === 'en' ? 'Batch Reference' : 'مرجع العملية'}</th>
                  <th>{currentLang === 'en' ? 'Operation Type' : 'نوع العملية'}</th>
                  <th>{currentLang === 'en' ? 'Items Count' : 'عدد السبائك'}</th>
                  <th>{currentLang === 'en' ? 'Total Weight' : 'الوزن الإجمالي'}</th>
                  <th>{currentLang === 'en' ? 'Financials / Details' : 'التفاصيل / التكلفة'}</th>
                  <th>{currentLang === 'en' ? 'Requested By' : 'مقدم الطلب'}</th>
                  <th>{currentLang === 'en' ? 'Status' : 'الحالة'}</th>
                  <th>{currentLang === 'en' ? 'Created At' : 'تاريخ الإنشاء'}</th>
                  <th>{currentLang === 'en' ? 'Serials' : 'الأرقام التسلسلية'}</th>
                </tr>
              </thead>
              <tbody>
                {/* 1. Turkey Purchases */}
                {(pendingBatchFilter === 'ALL' || pendingBatchFilter === 'TURKEY') && pendingPurchases.map(p => {
                  let serialsList: string[] = [];
                  try { serialsList = JSON.parse(p.serials_json || '[]'); } catch (_) {}

                  return (
                    <tr key={`TR-${p.pending_purchase_id}`}>
                      <td><strong style={{ color: 'var(--text-primary)' }}>{p.batch_reference}</strong></td>
                      <td>
                        <span className="badge" style={{ background: 'rgba(225, 29, 72, 0.15)', color: '#E11D48', fontSize: '11px' }}>
                          🇹🇷 Turkey Purchase
                        </span>
                      </td>
                      <td>{p.total_items} {currentLang === 'en' ? 'bars' : 'سبيكة'}</td>
                      <td>{p.total_weight_grams} g ({(p.total_weight_grams / 1000).toFixed(3)} KG)</td>
                      <td>
                        <strong style={{ color: 'var(--kfh-green)' }}>
                          {p.total_cost ? Number(p.total_cost).toFixed(3) : (p.total_weight_grams * p.unit_price).toFixed(3)} KWD
                        </strong>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>@{p.unit_price} KWD/g</div>
                      </td>
                      <td>{p.requested_by}</td>
                      <td>
                        <span className={`badge ${p.status_code === 'APPROVED' ? 'badge-ready' : p.status_code === 'REJECTED' ? 'badge-sold' : 'badge-reserved'}`}>
                          {p.status_code === 'APPROVED' ? (currentLang === 'en' ? 'Approved & Converted' : 'معتمد ومحول') :
                           p.status_code === 'REJECTED' ? (currentLang === 'en' ? 'Rejected' : 'مرفوض') :
                           (currentLang === 'en' ? 'Pending Checker Approval' : 'بانتظار اعتماد المراجع')}
                        </span>
                      </td>
                      <td>{new Date(p.created_at).toLocaleString()}</td>
                      <td>
                        <div style={{ maxWidth: '200px', overflowX: 'auto', whiteSpace: 'nowrap', display: 'flex', gap: '4px' }}>
                          {serialsList.map((s, idx) => (
                            <span key={idx} style={{ fontSize: '10px', padding: '2px 5px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px' }}>
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* 2. VIP Allocations */}
                {(pendingBatchFilter === 'ALL' || pendingBatchFilter === 'VIP_ALLOCATION') && pendingVipAllocations.map(a => {
                  let serialsList: string[] = [];
                  try { serialsList = JSON.parse(a.serials_json || '[]'); } catch (_) {}

                  return (
                    <tr key={`ALLOC-${a.pending_allocation_id}`}>
                      <td><strong style={{ color: '#6366f1' }}>{a.batch_reference}</strong></td>
                      <td>
                        <span className="badge" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#6366f1', fontSize: '11px' }}>
                          👑 VIP Allocation
                        </span>
                      </td>
                      <td>{a.total_items} {currentLang === 'en' ? 'bars' : 'سبيكة'}</td>
                      <td>{a.total_weight_grams} g ({(a.total_weight_grams / 1000).toFixed(3)} KG)</td>
                      <td>
                        <span style={{ fontSize: '11px', color: '#6366f1', fontWeight: 600 }}>{a.vip_category || 'Private Banking'}</span>
                        {a.notes && <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{a.notes}</div>}
                      </td>
                      <td>{a.requested_by}</td>
                      <td>
                        <span className={`badge ${a.status_code === 'APPROVED' ? 'badge-ready' : a.status_code === 'REJECTED' ? 'badge-sold' : 'badge-reserved'}`}>
                          {a.status_code === 'APPROVED' ? (currentLang === 'en' ? 'Approved & Assigned' : 'معتمد ومخصص') :
                           a.status_code === 'REJECTED' ? (currentLang === 'en' ? 'Rejected' : 'مرفوض') :
                           (currentLang === 'en' ? 'Pending Checker' : 'بانتظار المراجع')}
                        </span>
                      </td>
                      <td>{new Date(a.created_at).toLocaleString()}</td>
                      <td>
                        <div style={{ maxWidth: '200px', overflowX: 'auto', whiteSpace: 'nowrap', display: 'flex', gap: '4px' }}>
                          {serialsList.map((s, idx) => (
                            <span key={idx} style={{ fontSize: '10px', padding: '2px 5px', background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1', borderRadius: '3px' }}>
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* 2.5. VIP to Online Deallocations */}
                {(pendingBatchFilter === 'ALL' || pendingBatchFilter === 'VIP_DEALLOCATION') && pendingVipDeallocations.map(d => {
                  let serialsList: string[] = [];
                  try { serialsList = JSON.parse(d.serials_json || '[]'); } catch (_) {}

                  return (
                    <tr key={`DEALLOC-${d.pending_deallocation_id}`}>
                      <td><strong style={{ color: 'var(--kfh-green)' }}>{d.batch_reference}</strong></td>
                      <td>
                        <span className="badge" style={{ background: 'rgba(0, 155, 78, 0.15)', color: 'var(--kfh-green)', fontSize: '11px' }}>
                          ↩️ VIP → 🌐 Online
                        </span>
                      </td>
                      <td>{d.total_items} {currentLang === 'en' ? 'bars' : 'سبيكة'}</td>
                      <td>{d.total_weight_grams} g ({(d.total_weight_grams / 1000).toFixed(3)} KG)</td>
                      <td>
                        <strong style={{ fontSize: '12px', color: 'var(--kfh-green)' }}>{d.deallocation_reason || 'Return to Online Retail'}</strong>
                        {d.notes && <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{d.notes}</div>}
                      </td>
                      <td>{d.requested_by}</td>
                      <td>
                        <span className={`badge ${d.status_code === 'APPROVED' ? 'badge-ready' : d.status_code === 'REJECTED' ? 'badge-sold' : 'badge-reserved'}`}>
                          {d.status_code === 'APPROVED' ? (currentLang === 'en' ? 'Approved & Returned' : 'معتمد وأُعيد لأونلاين') :
                           d.status_code === 'REJECTED' ? (currentLang === 'en' ? 'Rejected' : 'مرفوض') :
                           (currentLang === 'en' ? 'Pending Checker' : 'بانتظار المراجع')}
                        </span>
                      </td>
                      <td>{new Date(d.created_at).toLocaleString()}</td>
                      <td>
                        <div style={{ maxWidth: '200px', overflowX: 'auto', whiteSpace: 'nowrap', display: 'flex', gap: '4px' }}>
                          {serialsList.map((s, idx) => (
                            <span key={idx} style={{ fontSize: '10px', padding: '2px 5px', background: 'rgba(0, 155, 78, 0.1)', color: 'var(--kfh-green)', borderRadius: '3px' }}>
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* 3. VIP Dispenses */}
                {(pendingBatchFilter === 'ALL' || pendingBatchFilter === 'VIP_DISPENSE') && pendingVipDispenses.map(d => {
                  let serialsList: string[] = [];
                  try { serialsList = JSON.parse(d.serials_json || '[]'); } catch (_) {}

                  return (
                    <tr key={`DISP-${d.pending_dispense_id}`}>
                      <td><strong style={{ color: '#3B82F6' }}>{d.dispense_reference}</strong></td>
                      <td>
                        <span className="badge" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#3B82F6', fontSize: '11px' }}>
                          📤 VIP Dispense
                        </span>
                      </td>
                      <td>{d.total_items} {currentLang === 'en' ? 'bars' : 'سبيكة'}</td>
                      <td>{d.total_weight_grams} g ({(d.total_weight_grams / 1000).toFixed(3)} KG)</td>
                      <td>
                        <strong style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{d.customer_name}</strong>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>ID: {d.customer_civil_id} • Acc: {d.customer_account_number}</div>
                      </td>
                      <td>{d.requested_by}</td>
                      <td>
                        <span className={`badge ${d.status_code === 'APPROVED' ? 'badge-ready' : d.status_code === 'REJECTED' ? 'badge-sold' : 'badge-reserved'}`}>
                          {d.status_code === 'APPROVED' ? (currentLang === 'en' ? 'Delivered to VIP' : 'تم تسليم العميل') :
                           d.status_code === 'REJECTED' ? (currentLang === 'en' ? 'Rejected' : 'مرفوض') :
                           (currentLang === 'en' ? 'Pending Handover Approval' : 'بانتظار اعتماد التسليم')}
                        </span>
                      </td>
                      <td>{new Date(d.created_at).toLocaleString()}</td>
                      <td>
                        <div style={{ maxWidth: '200px', overflowX: 'auto', whiteSpace: 'nowrap', display: 'flex', gap: '4px' }}>
                          {serialsList.map((s, idx) => (
                            <span key={idx} style={{ fontSize: '10px', padding: '2px 5px', background: 'rgba(59, 130, 246, 0.1)', color: '#3B82F6', borderRadius: '3px' }}>
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* 4. Turkey Consignment Returns */}
                {(pendingBatchFilter === 'ALL' || pendingBatchFilter === 'TURKEY_RETURN') && pendingTurkeyReturns.map(r => {
                  let serialsList: string[] = [];
                  try { serialsList = JSON.parse(r.serials_json || '[]'); } catch (_) {}

                  return (
                    <tr key={`RET-${r.pending_return_id}`}>
                      <td><strong style={{ color: '#F59E0B' }}>{r.batch_reference}</strong></td>
                      <td>
                        <span className="badge" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B', fontSize: '11px' }}>
                          ↩️ Turkey Return ({r.source_ownership})
                        </span>
                      </td>
                      <td>{r.total_items} {currentLang === 'en' ? 'bars' : 'سبيكة'}</td>
                      <td>{r.total_weight_grams} g ({(r.total_weight_grams / 1000).toFixed(3)} KG)</td>
                      <td>
                        <strong style={{ fontSize: '12px', color: '#F59E0B' }}>{r.return_reason || 'Consignment Rebalancing'}</strong>
                        {r.notes && <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{r.notes}</div>}
                      </td>
                      <td>{r.requested_by}</td>
                      <td>
                        <span className={`badge ${r.status_code === 'APPROVED' ? 'badge-ready' : r.status_code === 'REJECTED' ? 'badge-sold' : 'badge-reserved'}`}>
                          {r.status_code === 'APPROVED' ? (currentLang === 'en' ? 'Approved & Reverted' : 'معتمد وأُرجع لتركيا') :
                           r.status_code === 'REJECTED' ? (currentLang === 'en' ? 'Rejected' : 'مرفوض') :
                           (currentLang === 'en' ? 'Pending Checker' : 'بانتظار المراجع')}
                        </span>
                      </td>
                      <td>{new Date(r.created_at).toLocaleString()}</td>
                      <td>
                        <div style={{ maxWidth: '200px', overflowX: 'auto', whiteSpace: 'nowrap', display: 'flex', gap: '4px' }}>
                          {serialsList.map((s, idx) => (
                            <span key={idx} style={{ fontSize: '10px', padding: '2px 5px', background: 'rgba(245, 158, 11, 0.1)', color: '#F59E0B', borderRadius: '3px' }}>
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {(pendingBatchFilter === 'ALL' || pendingBatchFilter === 'MISSING_ITEMS') && pendingMissingReports.map(m => {
                  let serialsList: string[] = [];
                  try {
                    serialsList = JSON.parse(m.serials_json || '[]');
                  } catch {
                    serialsList = [];
                  }
                  return (
                    <tr key={`miss-${m.pending_report_id}`}>
                      <td>
                        <strong style={{ fontFamily: 'monospace', color: '#EF4444' }}>{m.report_reference}</strong>
                        {m.lot_number && <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Lot: {m.lot_number}</div>}
                      </td>
                      <td>
                        <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#EF4444', fontSize: '11px' }}>
                          ⚠️ {currentLang === 'en' ? 'Missing Items Discrepancy' : 'تسجيل مفقودات الشحنة'}
                        </span>
                      </td>
                      <td>
                        <strong>{m.total_items}</strong> {currentLang === 'en' ? 'bars' : 'سبيكة'}
                      </td>
                      <td>
                        {Math.round((m.total_weight_grams / 1000) * 1000) / 1000} KG <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({m.total_weight_grams} g)</span>
                      </td>
                      <td>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{m.discrepancy_reason || 'Missing Verification'}</span>
                        {m.notes && <div style={{ fontSize: '10px', fontStyle: 'italic', color: 'var(--text-muted)' }}>{m.notes}</div>}
                      </td>
                      <td>
                        <span style={{ fontSize: '12px' }}>{m.requested_by}</span>
                      </td>
                      <td>
                        <span className={`badge ${m.status_code === 'APPROVED' ? 'badge-ready' : (m.status_code === 'REJECTED' ? 'badge-quarantined' : 'badge-reserved')}`}>
                          {m.status_code === 'APPROVED' ? '✓ APPROVED' : (m.status_code === 'REJECTED' ? '✗ REJECTED' : '⏳ PENDING CHECKER')}
                        </span>
                      </td>
                      <td style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {m.created_at ? new Date(m.created_at).toLocaleString() : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', maxWidth: '200px' }}>
                          {serialsList.slice(0, 4).map((s, idx) => (
                            <span key={idx} style={{ fontSize: '10px', padding: '2px 5px', background: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', borderRadius: '3px' }}>
                              {s}
                            </span>
                          ))}
                          {serialsList.length > 4 && (
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>+{serialsList.length - 4} more</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {pendingPurchases.length === 0 && pendingVipAllocations.length === 0 && pendingVipDeallocations.length === 0 && pendingVipDispenses.length === 0 && pendingTurkeyReturns.length === 0 && pendingMissingReports.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                      {currentLang === 'en' ? 'No operations or requests recorded yet.' : 'لا توجد طلبات أو عمليات مسجلة بعد.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* 6. VIP DISPENSATION MODAL */}
      {showVipDispenseModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '650px', maxHeight: '90vh', overflowY: 'auto', padding: '24px', borderLeft: '4px solid #6366f1' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-border)', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#6366f1', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <i className="fa-solid fa-crown"></i>
                {currentLang === 'en' ? 'Dispense Gold to VIP Client' : 'صرف سبائك الذهب لعميل VIP'}
              </h3>
              <button
                onClick={() => setShowVipDispenseModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                &times;
              </button>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 16px 0' }}>
              {currentLang === 'en'
                ? 'Submit a Maker-Checker workflow to dispense selected gold bars from VIP reserve to a Private Banking client.'
                : 'إنشاء طلب سير عمل لصرف السبائك المحددة من مخزون كبار العملاء لصالح عميل الخدمات الخاصة.'}
            </p>

            {/* Selected Bars Summary */}
            <div style={{ background: 'rgba(99, 102, 241, 0.08)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(99, 102, 241, 0.25)', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 'bold', color: '#6366f1', marginBottom: '6px' }}>
                <span>{currentLang === 'en' ? 'Selected VIP Bars:' : 'السبائك المحددة:'} {selectedVipItemsData.count} bars</span>
                <span>{selectedVipItemsData.totalWeightKg} KG ({selectedVipItemsData.totalWeightGrams.toLocaleString()} g)</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '80px', overflowY: 'auto' }}>
                {selectedVipSerials.map((s, idx) => (
                  <span key={idx} style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', fontFamily: 'monospace' }}>
                    {s}
                  </span>
                ))}
              </div>
            </div>

            {/* Client Information Form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  {currentLang === 'en' ? 'Client Full Name *' : 'اسم العميل بالكامل *'}
                </label>
                <input
                  type="text"
                  className="form-control"
                  placeholder={currentLang === 'en' ? 'e.g. Sheikh Nasser Al-Sabah' : 'مثال: الشيخ ناصر الصباح'}
                  value={vipCustomerName}
                  onChange={e => setVipCustomerName(e.target.value)}
                  style={{ fontSize: '13px' }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    {currentLang === 'en' ? 'Civil ID / National ID *' : 'الرقم المدني *'}
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. 290123456789"
                    value={vipCustomerCivilId}
                    onChange={e => setVipCustomerCivilId(e.target.value)}
                    style={{ fontSize: '13px' }}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>
                    {currentLang === 'en' ? 'Account Number / IBAN *' : 'رقم الحساب / الآيبان *'}
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. KFH-PB-99482"
                    value={vipCustomerAccount}
                    onChange={e => setVipCustomerAccount(e.target.value)}
                    style={{ fontSize: '13px' }}
                    required
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  {currentLang === 'en' ? 'Special Handover Instructions' : 'تعليمات التسليم الخاصة'}
                </label>
                <select
                  className="form-control"
                  value={vipSpecialInstructions}
                  onChange={e => setVipSpecialInstructions(e.target.value)}
                  style={{ fontSize: '12px' }}
                >
                  <option value="VIP Private Vault Handover">VIP Private Vault Handover</option>
                  <option value="Private Banking Suite Delivery">Private Banking Suite Delivery</option>
                  <option value="Armored Escort to Client Location">Armored Escort to Client Location</option>
                  <option value="Authorized Representative Pickup">Authorized Representative Pickup</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  {currentLang === 'en' ? 'Additional Notes / Custody Terms' : 'ملاحظات إضافية'}
                </label>
                <textarea
                  rows={2}
                  className="form-control"
                  placeholder={currentLang === 'en' ? 'Optional notes...' : 'ملاحظات اختيارية...'}
                  value={vipDispenseNotes}
                  onChange={e => setVipDispenseNotes(e.target.value)}
                  style={{ fontSize: '12px' }}
                />
              </div>

            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn"
                onClick={() => setShowVipDispenseModal(false)}
                disabled={isSubmittingVipDispense}
              >
                {currentLang === 'en' ? 'Cancel' : 'إلغاء'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleDispenseVip}
                disabled={isSubmittingVipDispense}
                style={{ background: '#6366f1', color: '#fff', fontWeight: 'bold' }}
              >
                {isSubmittingVipDispense ? (
                  <><i className="fa-solid fa-spinner fa-spin"></i> {currentLang === 'en' ? 'Submitting...' : 'جاري الإرسال...'}</>
                ) : (
                  <><i className="fa-solid fa-paper-plane"></i> {currentLang === 'en' ? 'Submit Dispensation for Approval' : 'إرسال طلب الصرف للاعتماد'}</>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 6.5. RETURN TO TURKEY CONSIGNMENT MODAL */}
      {showReturnModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '650px', maxHeight: '90vh', overflowY: 'auto', padding: '24px', borderLeft: '4px solid #F59E0B' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-border)', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#F59E0B', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <i className="fa-solid fa-rotate-left"></i>
                {currentLang === 'en' ? 'Return Gold to Turkey Consignment' : 'إرجاع الذهب إلى مخزون أمانة تركيا'}
              </h3>
              <button
                onClick={() => setShowReturnModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                &times;
              </button>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 16px 0' }}>
              {currentLang === 'en'
                ? 'Initiate a Maker-Checker 4-eyes authorization workflow to return selected bullion from KFH or VIP stock back to Turkey consignment (TURKEY_OWNED). Once approved by the Checker, ownership reverts and items become available under Turkey offline consignment stock.'
                : 'بدء سير عمل لاعتماد إرجاع السبائك المحددة من مخزون بيتك أو VIP إلى مخزون أمانة تركيا (TURKEY_OWNED). بمجرد اعتماد المراجع، ستعود الملكية إلى تركيا كأمانة أوفلاين.'}
            </p>

            {/* Source Origin Selector */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                {currentLang === 'en' ? 'Source Stock Pool to Return From:' : 'المخزون المصدر المراد الإرجاع منه:'}
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className={`btn ${returnSourceOrigin === 'KFH' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setReturnSourceOrigin('KFH')}
                  style={{ fontSize: '12px', padding: '6px 14px' }}
                >
                  🏦 {currentLang === 'en' ? 'KFH Online Stock' : 'مخزون بيتك المتاح'} ({selectedKfhSerials.length})
                </button>
                <button
                  type="button"
                  className={`btn ${returnSourceOrigin === 'VIP' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setReturnSourceOrigin('VIP')}
                  style={{ fontSize: '12px', padding: '6px 14px' }}
                >
                  👑 {currentLang === 'en' ? 'VIP Reserve Stock' : 'مخزون كبار العملاء'} ({selectedVipSerials.length})
                </button>
                <button
                  type="button"
                  className={`btn ${returnSourceOrigin === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setReturnSourceOrigin('ALL')}
                  style={{ fontSize: '12px', padding: '6px 14px' }}
                >
                  📦 {currentLang === 'en' ? 'Both Pools Combined' : 'كلا المخزونين معاً'} ({selectedKfhSerials.length + selectedVipSerials.length})
                </button>
              </div>
            </div>

            {/* Selected Bars Summary */}
            <div style={{ background: 'rgba(245, 158, 11, 0.08)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(245, 158, 11, 0.25)', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 'bold', color: '#F59E0B', marginBottom: '6px' }}>
                <span>{currentLang === 'en' ? 'Selected Bars for Consignment Reversion:' : 'السبائك المحددة للإرجاع:'} {returnItemsData.count} {currentLang === 'en' ? 'bars' : 'سبيكة'}</span>
                <span>{returnItemsData.totalWeightKg} KG ({returnItemsData.totalWeightGrams.toLocaleString()} g)</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '90px', overflowY: 'auto' }}>
                {returnItemsData.items.map((item, idx) => (
                  <span key={idx} style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', fontFamily: 'monospace' }}>
                    {item.serial_number} ({item.weight_grams}g - {item.ownership_type || item.ownership || 'KFH/VIP'})
                  </span>
                ))}
              </div>
            </div>

            {/* Return Details Form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  {currentLang === 'en' ? 'Return Reason / Agreement Reference *' : 'سبب الإرجاع / مرجع الاتفاقية *'}
                </label>
                <select
                  className="form-control"
                  value={returnReason}
                  onChange={e => setReturnReason(e.target.value)}
                  style={{ fontSize: '12px' }}
                >
                  <option value="Consignment Rebalancing Agreement TR-2026">Consignment Rebalancing Agreement TR-2026</option>
                  <option value="Defective / Assay Mismatch Reversion">Defective / Assay Mismatch Reversion</option>
                  <option value="Excess Bullion Reversion to Turkey Vault">Excess Bullion Reversion to Turkey Vault</option>
                  <option value="Treasury Liquidity Recall">Treasury Liquidity Recall</option>
                  <option value="Commercial Terms Adjustment">Commercial Terms Adjustment</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  {currentLang === 'en' ? 'Additional Notes & Justification' : 'ملاحظات إضافية وتبرير الإرجاع'}
                </label>
                <textarea
                  rows={2}
                  className="form-control"
                  placeholder={currentLang === 'en' ? 'e.g. Return of unallocated consignment bars per Nadir Precious Metals rebalancing contract...' : 'مثال: إرجاع سبائك أمانة غير مخصصة طبقاً لعقد موازنة الأمانة مع مصفاة نادر...'}
                  value={returnNotes}
                  onChange={e => setReturnNotes(e.target.value)}
                  style={{ fontSize: '12px' }}
                />
              </div>

            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn"
                onClick={() => setShowReturnModal(false)}
                disabled={isSubmittingReturn}
              >
                {currentLang === 'en' ? 'Cancel' : 'إلغاء'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleInitiateTurkeyReturn}
                disabled={returnItemsData.count === 0 || isSubmittingReturn}
                style={{ background: '#F59E0B', color: '#000', fontWeight: 'bold' }}
              >
                {isSubmittingReturn ? (
                  <><i className="fa-solid fa-spinner fa-spin"></i> {currentLang === 'en' ? 'Submitting...' : 'جاري الإرسال...'}</>
                ) : (
                  <><i className="fa-solid fa-rotate-left"></i> {currentLang === 'en' ? 'Submit Return for Checker Approval' : 'إرسال طلب الإرجاع لاعتماد المراجع'}</>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 6.6. REPORT MISSING ITEMS (CUSTOMS TO TURKEY INTAKE DISCREPANCY) MODAL */}
      {showMissingModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '680px', maxHeight: '92vh', overflowY: 'auto', padding: '24px', borderLeft: '4px solid #EF4444' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-border)', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#EF4444', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <i className="fa-solid fa-triangle-exclamation"></i>
                {currentLang === 'en' ? 'Report Missing Serials (Maker-Checker)' : 'تسجيل أرقام تسلسلية مفقودة (صانع / معتمد)'}
              </h3>
              <button
                onClick={() => setShowMissingModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                &times;
              </button>
            </div>

            <div style={{ padding: '10px 14px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', fontSize: '12px', color: '#EF4444', marginBottom: '16px' }}>
              <i className="fa-solid fa-shield-halved" style={{ marginRight: '6px' }}></i>
              {currentLang === 'en'
                ? 'Submitting this form initiates a 4-eyes Maker-Checker workflow. Upon Checker authorization, reported serials will be set to MISSING, deducted from the Turkey Owner balance, and reflected across all management dashboards and GL journals.'
                : 'إرسال هذا النموذج ينشئ مسار تدقيق صانع/معتمد. فور اعتماد المعتمد، ستتحول السبائك المسجلة إلى مفقودة وتُخصم تلقائياً من رصيد أمانات تركيا وتنعكس على لوحات المتابعة وسجلات القيود.'}
            </div>

            {/* Filters */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  {currentLang === 'en' ? 'Filter by Lot / Shipment Reference:' : 'تصفية برقم اللوت / الشحنة:'}
                </label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. LOT-2026 / BAYAN..."
                  value={missingLotFilter}
                  onChange={e => setMissingLotFilter(e.target.value)}
                  style={{ fontSize: '12px', padding: '6px 10px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  {currentLang === 'en' ? 'Search Bar Serial Number:' : 'بحث بالرقم التسلسلي:'}
                </label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. B00570..."
                  value={missingSerialSearch}
                  onChange={e => setMissingSerialSearch(e.target.value)}
                  style={{ fontSize: '12px', padding: '6px 10px' }}
                />
              </div>
            </div>

            {/* Candidate Items Table */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '12px' }}>
                <span style={{ fontWeight: 600 }}>{currentLang === 'en' ? 'Select Missing Bars from Turkey Stock:' : 'حدد السبائك المفقودة من مخزون تركيا:'}</span>
                <span style={{ color: 'var(--text-muted)' }}>{missingModalCandidateItems.length} {currentLang === 'en' ? 'available' : 'متاح'}</span>
              </div>
              
              <div className="table-responsive" style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--surface-border)', borderRadius: '6px' }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>
                        <input
                          type="checkbox"
                          checked={missingModalCandidateItems.length > 0 && selectedMissingSerials.length === missingModalCandidateItems.length}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedMissingSerials(missingModalCandidateItems.map(i => i.serial_number));
                            } else {
                              setSelectedMissingSerials([]);
                            }
                          }}
                        />
                      </th>
                      <th>{currentLang === 'en' ? 'Serial Number' : 'الرقم التسلسلي'}</th>
                      <th>{currentLang === 'en' ? 'Denomination' : 'الفئة'}</th>
                      <th>{currentLang === 'en' ? 'Weight' : 'الوزن'}</th>
                      <th>{currentLang === 'en' ? 'Lot Number' : 'رقم اللوت'}</th>
                      <th>{currentLang === 'en' ? 'Vault Location' : 'موقع الخزنة'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingModalCandidateItems.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                          {currentLang === 'en' ? 'No matching Turkey consignment bars found.' : 'لا توجد سبائك تركية مطابقة.'}
                        </td>
                      </tr>
                    ) : (
                      missingModalCandidateItems.map(item => {
                        const isSelected = selectedMissingSerials.includes(item.serial_number);
                        return (
                          <tr key={item.serial_number} style={{ background: isSelected ? 'rgba(239, 68, 68, 0.1)' : undefined }}>
                            <td>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  if (isSelected) {
                                    setSelectedMissingSerials(prev => prev.filter(s => s !== item.serial_number));
                                  } else {
                                    setSelectedMissingSerials(prev => [...prev, item.serial_number]);
                                  }
                                }}
                              />
                            </td>
                            <td>
                              <strong style={{ fontFamily: 'monospace', color: '#EF4444' }}>{item.serial_number}</strong>
                            </td>
                            <td>{item.denomination || item.metal_name}</td>
                            <td>{item.weight_grams}g</td>
                            <td><span style={{ fontSize: '11px', fontFamily: 'monospace' }}>{item.lot_number || 'N/A'}</span></td>
                            <td><span style={{ fontSize: '11px' }}>{item.location_code || 'Main Vault'}</span></td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Selected Summary */}
            {selectedMissingSerials.length > 0 && (
              <div style={{ background: 'rgba(239, 68, 68, 0.08)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(239, 68, 68, 0.25)', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 'bold', color: '#EF4444', marginBottom: '6px' }}>
                  <span>{currentLang === 'en' ? 'Selected Missing Bars:' : 'السبائك المحددة كمفقودة:'} {selectedMissingItemsData.count} {currentLang === 'en' ? 'bars' : 'سبيكة'}</span>
                  <span>{selectedMissingItemsData.totalWeightKg} KG ({selectedMissingItemsData.totalWeightGrams.toLocaleString()} g)</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '70px', overflowY: 'auto' }}>
                  {selectedMissingItemsData.items.map((item, idx) => (
                    <span key={idx} style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', fontFamily: 'monospace', color: '#EF4444' }}>
                      {item.serial_number} ({item.weight_grams}g)
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Form Inputs */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  {currentLang === 'en' ? 'Discrepancy Justification / Reason *' : 'سبب وتبرير فقدان السبيكة *'}
                </label>
                <select
                  className="form-control"
                  value={missingDiscrepancyReason}
                  onChange={e => setMissingDiscrepancyReason(e.target.value)}
                  style={{ fontSize: '12px' }}
                >
                  <option value="Physical bar missing upon customs receipt unpacking verification">Physical bar missing upon customs receipt unpacking verification</option>
                  <option value="Serial mismatch between delivery documentation and physical parcel">Serial mismatch between delivery documentation and physical parcel</option>
                  <option value="Short-shipped by Turkish supplier / missing in customs transit">Short-shipped by Turkish supplier / missing in customs transit</option>
                  <option value="Vault intake stocktake discrepancy">Vault intake stocktake discrepancy</option>
                  <option value="Assay inspection shortfall">Assay inspection shortfall</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  {currentLang === 'en' ? 'Investigation Notes & Reference Details' : 'ملاحظات التحقيق والمراجع'}
                </label>
                <textarea
                  rows={2}
                  className="form-control"
                  placeholder={currentLang === 'en' ? 'Details of unpacking committee, courier seal status, discrepancy report ref...' : 'تفاصيل محضر الفتح والمعاينة، حالة الختم، مرجع تقرير الفروقات...'}
                  value={missingNotes}
                  onChange={e => setMissingNotes(e.target.value)}
                  style={{ fontSize: '12px' }}
                />
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn"
                onClick={() => setShowMissingModal(false)}
                disabled={isSubmittingMissing}
              >
                {currentLang === 'en' ? 'Cancel' : 'إلغاء'}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleReportMissingItems}
                disabled={selectedMissingSerials.length === 0 || isSubmittingMissing}
                style={{ background: '#EF4444', borderColor: '#EF4444', fontWeight: 'bold' }}
              >
                {isSubmittingMissing ? (
                  <><i className="fa-solid fa-spinner fa-spin"></i> {currentLang === 'en' ? 'Submitting...' : 'جاري الإرسال...'}</>
                ) : (
                  <><i className="fa-solid fa-paper-plane"></i> {currentLang === 'en' ? 'Submit Missing Report for Checker Sign-off' : 'إرسال تقرير المفقودات للاعتماد'}</>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 7. SMART SELECTION & SCANNER MODAL (QR SCAN, RANGE, BULK PASTE, OCR) */}
      {showSmartModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '650px', maxHeight: '90vh', overflowY: 'auto', padding: '24px', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-border)', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: 'var(--kfh-green)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <i className="fa-solid fa-wand-magic-sparkles"></i>
                {currentLang === 'en' ? 'Turkey Stock Smart Selection Tools' : 'أدوات التحديد الذكي لمخزون تركيا'}
              </h3>
              <button
                onClick={() => {
                  stopCamera();
                  setShowSmartModal(false);
                }}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                &times;
              </button>
            </div>

            {/* Product / Denomination Filter in Smart Tools Modal */}
            <div style={{ marginBottom: '14px', background: 'rgba(255,255,255,0.02)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--surface-border)' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: 'var(--kfh-green)' }}>
                <i className="fa-solid fa-boxes-stacked"></i>
                {currentLang === 'en' ? 'Target Product / Denomination (Mandatory for Unique Serial Match):' : 'المنتج / فئة السبيكة (ضروري لضمان مطابقة الرقم الفريد للفئة):'}
              </label>
              <select
                className="form-control"
                value={smartProduct}
                onChange={e => setSmartProduct(e.target.value)}
                style={{ fontSize: '12px', padding: '6px 10px' }}
              >
                <option value="">{currentLang === 'en' ? '-- Select Product / Denomination --' : '-- اختر فئة المنتج --'}</option>
                {turkeyInventory?.summary?.by_product?.map(p => (
                  <option key={p.product_code} value={p.product_code}>
                    {p.denomination} - {p.metal_name} ({p.weight_grams}g) — {p.count} {currentLang === 'en' ? 'available' : 'متاح'}
                  </option>
                ))}
              </select>
            </div>

            {/* Navigation Tabs */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--surface-border)', paddingBottom: '10px', marginBottom: '16px', overflowX: 'auto' }}>
              <button
                type="button"
                className={`btn ${smartTab === 'QR_SCAN' ? 'btn-primary' : ''}`}
                style={smartTab !== 'QR_SCAN' ? { background: 'transparent' } : {}}
                onClick={() => {
                  stopCamera();
                  setSmartTab('QR_SCAN');
                }}
              >
                <i className="fa-solid fa-qrcode"></i> {currentLang === 'en' ? 'QR & Barcode' : 'رمز QR والباركود'}
              </button>
              <button
                type="button"
                className={`btn ${smartTab === 'RANGE' ? 'btn-primary' : ''}`}
                style={smartTab !== 'RANGE' ? { background: 'transparent' } : {}}
                onClick={() => {
                  stopCamera();
                  setSmartTab('RANGE');
                }}
              >
                <i className="fa-solid fa-arrow-down-1-9"></i> {currentLang === 'en' ? 'Range Selection' : 'نطاق متسلسل'}
              </button>
              <button
                type="button"
                className={`btn ${smartTab === 'PASTE' ? 'btn-primary' : ''}`}
                style={smartTab !== 'PASTE' ? { background: 'transparent' } : {}}
                onClick={() => {
                  stopCamera();
                  setSmartTab('PASTE');
                }}
              >
                <i className="fa-solid fa-paste"></i> {currentLang === 'en' ? 'Bulk Paste List' : 'لصق قائمة أرقام'}
              </button>
              <button
                type="button"
                className={`btn ${smartTab === 'OCR' ? 'btn-primary' : ''}`}
                style={smartTab !== 'OCR' ? { background: 'transparent' } : {}}
                onClick={() => setSmartTab('OCR')}
              >
                <i className="fa-solid fa-camera"></i> {currentLang === 'en' ? 'Camera & OCR' : 'الكاميرا والماسح الضوئي'}
              </button>
            </div>

            {/* TAB 0: QR & BARCODE FAST SCAN */}
            {smartTab === 'QR_SCAN' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  {currentLang === 'en'
                    ? 'Scan piece QR code, DataMatrix, or GS1 barcode. The system will match it against Turkey consignment stock.'
                    : 'امسح رمز QR أو باركود GS1 لمطابقته مباشرة من مخزون تركيا.'}
                </p>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder={currentLang === 'en' ? 'Scan or enter serial...' : 'امسح أو أدخل الرقم التسلسلي...'}
                    value={qrScanInput}
                    onChange={e => setQrScanInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleProcessScanInput(qrScanInput);
                      }
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleProcessScanInput(qrScanInput)}
                  >
                    {currentLang === 'en' ? 'Add' : 'إضافة'}
                  </button>
                </div>

                {scanFeedback && (
                  <div style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    background: scanFeedback.type === 'success' ? 'rgba(0, 155, 78, 0.15)' : scanFeedback.type === 'warning' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: scanFeedback.type === 'success' ? 'var(--kfh-green)' : scanFeedback.type === 'warning' ? '#F59E0B' : '#EF4444'
                  }}>
                    {scanFeedback.message}
                  </div>
                )}
              </div>
            )}

            {/* TAB 1: RANGE */}
            {smartTab === 'RANGE' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  {currentLang === 'en' ? 'Select all available Turkey inventory bars between Start and End serial numbers.' : 'تحديد جميع السبائك المتاحة بمخزون تركيا بين رقم البداية والنهاية.'}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Start Serial Number' : 'رقم البداية'}</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. TR-2026-0001"
                      value={rangeStart}
                      onChange={e => setRangeStart(e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'End Serial Number' : 'رقم النهاية'}</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. TR-2026-0050"
                      value={rangeEnd}
                      onChange={e => setRangeEnd(e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                  <button type="button" className="btn" onClick={() => setShowSmartModal(false)}>
                    {currentLang === 'en' ? 'Cancel' : 'إلغاء'}
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => handleApplyRangeSelect()}>
                    <i className="fa-solid fa-check-double"></i> {currentLang === 'en' ? 'Select Range from Inventory' : 'تحديد النطاق من المخزون'}
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: PASTE */}
            {smartTab === 'PASTE' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  {currentLang === 'en' ? 'Paste a list of serial numbers (separated by commas, lines, or spaces) to auto-match and select them in Turkey stock.' : 'الصق قائمة من الأرقام التسلسلية لمطابقتها وتحديدها تلقائياً من مخزون تركيا.'}
                </p>
                <textarea
                  rows={6}
                  className="form-control"
                  placeholder={currentLang === 'en' ? 'e.g.\nB00570\nTR-2026-0001\nTR-2026-0002' : 'مثال:\nB00570\nTR-2026-0001\nTR-2026-0002'}
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: '12px' }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button type="button" className="btn" onClick={() => setShowSmartModal(false)}>
                    {currentLang === 'en' ? 'Cancel' : 'إلغاء'}
                  </button>
                  <button type="button" className="btn btn-primary" onClick={handleApplyPasteSelect}>
                    <i className="fa-solid fa-check"></i> {currentLang === 'en' ? 'Match & Select Bars' : 'مطابقة وتحديد السبائك'}
                  </button>
                </div>
              </div>
            )}

            {/* TAB 3: OCR */}
            {smartTab === 'OCR' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  {currentLang === 'en' 
                    ? 'Scan physical gold bar serial engraving (e.g. B00570) or QR code using device camera or by uploading a photo.' 
                    : 'مسح وقراءة الرقم التسلسلي المحفور على السبيكة (مثل B00570) أو رمز QR بالكاميرا أو بتحميل صورة.'}
                </p>

                {/* Camera / File options */}
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <label className="btn btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
                    <i className="fa-solid fa-image"></i> {currentLang === 'en' ? 'Upload Photo' : 'تحميل صورة'}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = ev => {
                            const dataUrl = ev.target?.result as string;
                            setOcrImage(dataUrl);
                            processOcrImage(dataUrl);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>

                  {!cameraActive ? (
                    <button type="button" className="btn btn-secondary" onClick={startCamera}>
                      <i className="fa-solid fa-camera"></i> {currentLang === 'en' ? 'Open Camera' : 'تشغيل الكاميرا'}
                    </button>
                  ) : (
                    <>
                      <button type="button" className="btn btn-primary" onClick={captureCameraFrame}>
                        <i className="fa-solid fa-camera-retro"></i> {currentLang === 'en' ? 'Capture Frame' : 'التقاط الصورة'}
                      </button>
                      <button type="button" className="btn btn-danger" onClick={stopCamera}>
                        {currentLang === 'en' ? 'Stop Camera' : 'إيقاف الكاميرا'}
                      </button>
                    </>
                  )}
                </div>

                {/* Video Stream Preview */}
                {cameraActive && (
                  <div style={{ width: '100%', maxHeight: '240px', overflow: 'hidden', borderRadius: '8px', background: '#000', display: 'flex', justifyContent: 'center' }}>
                    <video ref={videoRef} autoPlay playsInline style={{ maxHeight: '240px', width: 'auto' }} />
                  </div>
                )}

                {/* OCR Progress Indicator */}
                {ocrLoading && (
                  <div style={{ textAlign: 'center', padding: '12px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--kfh-green)', marginBottom: '6px' }}>{ocrStatusText} ({ocrProgress}%)</div>
                    <div style={{ width: '100%', height: '6px', background: 'var(--surface-border)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${ocrProgress}%`, height: '100%', background: 'var(--kfh-green)', transition: 'width 0.2s' }}></div>
                    </div>
                  </div>
                )}

                {/* Extracted Tokens Candidate List */}
                {!ocrLoading && extractedSerials.length > 0 && (
                  <div style={{ border: '1px solid var(--surface-border)', borderRadius: '6px', padding: '12px', background: 'rgba(255,255,255,0.02)' }}>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--kfh-green)', display: 'block', marginBottom: '8px' }}>
                      {currentLang === 'en' ? 'Recognized Serials (Click to toggle):' : 'الأرقام المقروءة (انقر للتحديد):'}
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {extractedSerials.map((cand, idx) => (
                        <span
                          key={idx}
                          onClick={() => {
                            setExtractedSerials(prev => prev.map((c, i) => i === idx ? { ...c, selected: !c.selected } : c));
                          }}
                          style={{
                            fontSize: '12px',
                            fontWeight: 'bold',
                            padding: '4px 10px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            background: cand.selected ? 'rgba(0, 155, 78, 0.2)' : 'rgba(255,255,255,0.05)',
                            border: `1px solid ${cand.selected ? 'var(--kfh-green)' : 'var(--surface-border)'}`,
                            color: cand.selected ? 'var(--kfh-green)' : 'inherit'
                          }}
                        >
                          {cand.serial} {cand.selected ? '✓' : ''}
                        </span>
                      ))}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          const selected = extractedSerials.filter(c => c.selected).map(c => c.serial);
                          handleApplyExtractedMatches(selected);
                        }}
                      >
                        <i className="fa-solid fa-check"></i> {currentLang === 'en' ? 'Select Scanned Bars in Turkey Stock' : 'تحديد السبائك المقروءة من مخزون تركيا'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}

      {/* 6.7. RETURN VIP (OFFLINE) STOCK TO KFH ONLINE STOCK MODAL */}
      {showVipDeallocModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '650px', maxHeight: '90vh', overflowY: 'auto', padding: '24px', borderLeft: '4px solid var(--kfh-green)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-border)', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: 'var(--kfh-green)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <i className="fa-solid fa-rotate-left"></i>
                {currentLang === 'en' ? 'Return VIP Stock to KFH Online Stock' : 'إرجاع مخزون كبار العملاء إلى مخزون بيتك أونلاين'}
              </h3>
              <button
                onClick={() => setShowVipDeallocModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                &times;
              </button>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 16px 0' }}>
              {currentLang === 'en'
                ? 'Initiate a Maker-Checker 4-eyes authorization workflow to return selected bullion from VIP Offline stock back to general KFH Online stock (Channel: ONLINE). Once approved by the Checker, items become immediately visible and eligible for retail & e-commerce purchase.'
                : 'بدء سير عمل لاعتماد إعادة السبائك المحددة من مخزون كبار العملاء (أوفلاين) إلى مخزون بيتك العام (أونلاين). بمجرد اعتماد المراجع، ستعود القناة إلى ONLINE وتصبح متاحة فوراً للبيع والتداول عبر الإنترنت.'}
            </p>

            {/* Selected Bars Summary */}
            <div style={{ background: 'rgba(0, 155, 78, 0.08)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(0, 155, 78, 0.25)', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 'bold', color: 'var(--kfh-green)', marginBottom: '6px' }}>
                <span>{currentLang === 'en' ? 'Selected VIP Bars to Return to Online:' : 'السبائك المحددة لإعادتها إلى أونلاين:'} {selectedVipItemsData.count} {currentLang === 'en' ? 'bars' : 'سبيكة'}</span>
                <span>{selectedVipItemsData.totalWeightKg} KG ({selectedVipItemsData.totalWeightGrams.toLocaleString()} g)</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '110px', overflowY: 'auto' }}>
                {selectedVipItemsData.items.map((item, idx) => (
                  <span key={idx} style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', fontFamily: 'monospace' }}>
                    {item.serial_number} ({item.weight_grams}g - {item.denomination || '1kg'})
                  </span>
                ))}
              </div>
            </div>

            {/* Form Details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  {currentLang === 'en' ? 'Reason for Returning to Online Channel *' : 'سبب الإرجاع إلى القناة الإلكترونية *'}
                </label>
                <select
                  className="form-control"
                  value={vipDeallocReason}
                  onChange={e => setVipDeallocReason(e.target.value)}
                  style={{ fontSize: '12px' }}
                >
                  <option value="Surplus VIP reserve returned to general online retail stock">Surplus VIP reserve returned to general online retail stock</option>
                  <option value="E-Commerce replenishment from VIP vault allocation">E-Commerce replenishment from VIP vault allocation</option>
                  <option value="Branch retail replenishment">Branch retail replenishment</option>
                  <option value="Client unallocated cancellation / return">Client unallocated cancellation / return</option>
                  <option value="Treasury inventory re-balancing">Treasury inventory re-balancing</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  {currentLang === 'en' ? 'Additional Notes / Instructions' : 'ملاحظات إضافية'}
                </label>
                <textarea
                  rows={2}
                  className="form-control"
                  placeholder={currentLang === 'en' ? 'e.g. Returned to online channel to fulfill pending e-commerce orders...' : 'مثال: تمت إعادة السبائك لتلبية طلبات التداول الإلكتروني...'}
                  value={vipDeallocNotes}
                  onChange={e => setVipDeallocNotes(e.target.value)}
                  style={{ fontSize: '12px' }}
                />
              </div>

            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn"
                onClick={() => setShowVipDeallocModal(false)}
                disabled={isSubmittingVipDealloc}
              >
                {currentLang === 'en' ? 'Cancel' : 'إلغاء'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleReturnVipToOnline}
                disabled={selectedVipItemsData.count === 0 || isSubmittingVipDealloc}
                style={{ background: 'var(--kfh-green)', color: '#fff', fontWeight: 'bold' }}
              >
                {isSubmittingVipDealloc ? (
                  <><i className="fa-solid fa-spinner fa-spin"></i> {currentLang === 'en' ? 'Submitting...' : 'جاري الإرسال...'}</>
                ) : (
                  <><i className="fa-solid fa-rotate-left"></i> {currentLang === 'en' ? 'Submit Return for Checker Approval' : 'إرسال طلب الإرجاع لاعتماد المراجع'}</>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
