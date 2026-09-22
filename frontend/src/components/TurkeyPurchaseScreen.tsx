import React, { useState, useMemo, useRef, useEffect } from 'react';
import Tesseract from 'tesseract.js';

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
  const [activeSubTab, setActiveSubTab] = useState<'STOCK_PURCHASE' | 'PENDING_BATCHES'>('STOCK_PURCHASE');
  
  // Denomination / Product Selection State
  const [selectedDenomCode, setSelectedDenomCode] = useState<string>('');
  const [denomSerialSearch, setDenomSerialSearch] = useState<string>('');
  const [quickQtyToSelect, setQuickQtyToSelect] = useState<number>(1);

  // Dedicated QR / Barcode Scanner Input State
  const [qrScanInput, setQrScanInput] = useState<string>('');
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

  // Selection state
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

  // Manual Purchase Rate (KWD per Gram)
  const [unitPricePerGram, setUnitPricePerGram] = useState<string>('');
  const [purchaseNotes, setPurchaseNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isItemsListExpanded, setIsItemsListExpanded] = useState<boolean>(true);
  const [searchSelectedQuery, setSearchSelectedQuery] = useState('');

  const availableItems = useMemo(() => turkeyInventory?.items || [], [turkeyInventory?.items]);
  const isQrRequirementActive = !!turkeyInventory?.summary?.qr_required_for_transfer;

  // Auto-select first denomination if none selected
  useEffect(() => {
    if (!selectedDenomCode && turkeyInventory?.summary?.by_product && turkeyInventory.summary.by_product.length > 0) {
      setSelectedDenomCode(turkeyInventory.summary.by_product[0].product_code);
    }
  }, [turkeyInventory, selectedDenomCode]);

  // Selected Denomination object
  const currentDenomObj = useMemo(() => {
    return turkeyInventory?.summary?.by_product?.find(p => p.product_code === selectedDenomCode) || null;
  }, [turkeyInventory, selectedDenomCode]);

  // Available items for the currently selected denomination
  const itemsForSelectedDenom = useMemo(() => {
    if (!selectedDenomCode) return availableItems;
    return availableItems.filter(i => i.product_code === selectedDenomCode || String(i.product_id) === String(selectedDenomCode));
  }, [availableItems, selectedDenomCode]);

  // Filtered available serials in the facilitator grid
  const displayedDenomSerials = useMemo(() => {
    if (!denomSerialSearch.trim()) return itemsForSelectedDenom;
    const q = denomSerialSearch.trim().toLowerCase();
    return itemsForSelectedDenom.filter(i => 
      i.serial_number.toLowerCase().includes(q) ||
      (i.location_code && i.location_code.toLowerCase().includes(q)) ||
      (i.refiner_name && i.refiner_name.toLowerCase().includes(q))
    );
  }, [itemsForSelectedDenom, denomSerialSearch]);

  // Count of items selected for current denomination
  const selectedCountForCurrentDenom = useMemo(() => {
    const selectedSet = new Set(selectedSerials);
    return itemsForSelectedDenom.filter(i => selectedSet.has(i.serial_number)).length;
  }, [itemsForSelectedDenom, selectedSerials]);

  // Selected items calculations
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

  // Search filter within selected items table
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

  // Breakdown of selected items by denomination and shipment lot
  const selectedBreakdownByDenomination = useMemo(() => {
    const rateNum = parseFloat(unitPricePerGram) || 0;
    const map = new Map<string, {
      product_code: string;
      denomination: string;
      metal_name: string;
      weight_grams: number;
      count: number;
      total_weight_grams: number;
      unit_cost_per_bar: number;
      subtotal_cost: number;
      lots: Set<string>;
    }>();

    selectedItemsData.items.forEach(item => {
      const key = item.product_code || String(item.product_id) || 'UNKNOWN';
      const w = item.weight_grams || 0;
      const unitCost = rateNum > 0 ? (w * rateNum) : 0;
      if (!map.has(key)) {
        map.set(key, {
          product_code: key,
          denomination: item.denomination || `${w}g Bar`,
          metal_name: item.metal_name || 'Gold',
          weight_grams: w,
          count: 0,
          total_weight_grams: 0,
          unit_cost_per_bar: unitCost,
          subtotal_cost: 0,
          lots: new Set()
        });
      }
      const entry = map.get(key)!;
      entry.count += 1;
      entry.total_weight_grams += w;
      entry.subtotal_cost += unitCost;
      if (item.lot_number) entry.lots.add(item.lot_number);
    });

    return Array.from(map.values());
  }, [selectedItemsData.items, unitPricePerGram]);

  // Distinct shipment lots in selection
  const selectedShipmentLots = useMemo(() => {
    const lots = new Set<string>();
    selectedItemsData.items.forEach(i => {
      if (i.lot_number) lots.add(i.lot_number);
    });
    return Array.from(lots);
  }, [selectedItemsData.items]);

  // Handle Quick Barcode / QR Scan
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

    // Successfully add
    setSelectedSerials(prev => [...prev, matchedItem.serial_number]);
    // Also switch denomination view to this item's denomination so user sees it highlighted
    if (matchedItem.product_code) {
      setSelectedDenomCode(matchedItem.product_code);
    }

    setScanFeedback({
      type: 'success',
      message: currentLang === 'en'
        ? `Added: ${matchedItem.serial_number} (${matchedItem.denomination || matchedItem.metal_name} - ${matchedItem.weight_grams}g) [Lot: ${matchedItem.lot_number || 'TR'}]`
        : `تمت الإضافة: ${matchedItem.serial_number} (${matchedItem.denomination || matchedItem.metal_name} - ${matchedItem.weight_grams} جم) [الشحنة: ${matchedItem.lot_number || 'TR'}]`
    });

    setQrScanInput('');
    if (qrInputRef.current) {
      qrInputRef.current.focus();
    }
  };

  // Select first N unselected items for current denomination
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

  // Select all available for current denomination
  const handleSelectAllForDenom = () => {
    const denomSerials = itemsForSelectedDenom.map(i => i.serial_number);
    const newSet = new Set([...selectedSerials, ...denomSerials]);
    setSelectedSerials(Array.from(newSet));
  };

  // Deselect all for current denomination
  const handleDeselectAllForDenom = () => {
    const denomSerialsSet = new Set(itemsForSelectedDenom.map(i => i.serial_number));
    setSelectedSerials(prev => prev.filter(s => !denomSerialsSet.has(s)));
  };

  // Toggle single item
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

  // Clear selection
  const handleClearSelection = () => {
    setSelectedSerials([]);
    setSearchSelectedQuery('');
  };

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

      // Sort by vertical position (bottom-first)
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

      // Fallback lines
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
        : `لم يتم العثور على الأرقام التسلسلية (${serialsToSelect.slice(0, 5).join(', ')}${serialsToSelect.length > 5 ? '...' : ''}) في مخزون تركيا الحالي${prodLabelAr}. يرجى التحقق من صحة الأرقام والمنتج المختار.`);
      return;
    }

    const newSet = new Set([...selectedSerials, ...matchedSerials]);
    setSelectedSerials(Array.from(newSet));
    setShowSmartModal(false);

    if (missingSerials.length > 0) {
      alert(currentLang === 'en'
        ? `Selected ${matchedSerials.length} matching Turkey bar(s)${prodLabel}. Note: ${missingSerials.length} serial(s) do not exist in inventory (${missingSerials.slice(0, 3).join(', ')}${missingSerials.length > 3 ? '...' : ''}).`
        : `تم تحديد ${matchedSerials.length} سبيكة مطابقة${prodLabelAr}. تنبيه: ${missingSerials.length} رقم تسلسلي غير موجود في المخزون (${missingSerials.slice(0, 3).join(', ')}${missingSerials.length > 3 ? '...' : ''}).`);
    } else {
      alert(currentLang === 'en'
        ? `Selected ${matchedSerials.length} matching Turkey bar(s)${prodLabel}.`
        : `تم تحديد ${matchedSerials.length} سبيكة تركية مطابقة${prodLabelAr}.`);
    }
  };

  // Handle Bulk Paste Select
  const handleApplyPasteSelect = () => {
    if (!pasteText.trim()) {
      alert(currentLang === 'en' ? 'Please paste serial numbers.' : 'يرجى لصق الأرقام التسلسلية.');
      return;
    }
    const lines = pasteText.split(/[\n,;|\s]+/).map(s => s.trim()).filter(Boolean);
    handleApplyExtractedMatches(lines);
  };

  const splitSerial = (s: string) => {
    const match = s.trim().toUpperCase().match(/^([A-Za-z0-9_-]*?)(\d+)([A-Za-z0-9_-]*)$/);
    if (!match) return null;
    return {
      prefix: match[1],
      numStr: match[2],
      num: parseInt(match[2], 10),
      padLen: match[2].length,
      suffix: match[3]
    };
  };

  // Handle Range Selection
  const handleApplyRangeSelect = (targetProd?: string | any) => {
    const rawStart = rangeStart.trim().toUpperCase();
    const rawEnd = (rangeEnd.trim() || rangeStart.trim()).toUpperCase();
    const explicitProd = typeof targetProd === 'string' && targetProd.trim() ? targetProd.trim() : undefined;
    const productToFilter = explicitProd !== undefined ? explicitProd : (showSmartModal ? smartProduct : '');

    if (!rawStart) {
      alert(currentLang === 'en' ? 'Please enter Start and End serial numbers.' : 'يرجى إدخال رقم البداية والنهاية.');
      return;
    }

    let pool = availableItems;
    if (productToFilter) {
      pool = pool.filter(i => i.product_code === productToFilter || String(i.product_id) === String(productToFilter));
    }

    const startSplit = splitSerial(rawStart);
    const endSplit = splitSerial(rawEnd);

    let expectedSerials: string[] = [];

    if (rawStart === rawEnd) {
      expectedSerials = [rawStart];
    } else if (startSplit && endSplit && startSplit.prefix === endSplit.prefix && startSplit.suffix === endSplit.suffix) {
      if (startSplit.padLen !== endSplit.padLen) {
        alert(currentLang === 'en' 
          ? `Mismatched padding in range: "${rawStart}" has ${startSplit.padLen} digits while "${rawEnd}" has ${endSplit.padLen} digits. Please specify matching zero-padding.` 
          : `اختلاف في عدد خانات الأرقام: "${rawStart}" يحتوي على ${startSplit.padLen} أرقام بينما "${rawEnd}" يحتوي على ${endSplit.padLen} أرقام. يرجى استخدام نفس عدد الخانات.`);
        return;
      }

      const minNum = Math.min(startSplit.num, endSplit.num);
      const maxNum = Math.max(startSplit.num, endSplit.num);
      const count = maxNum - minNum + 1;

      if (count > 5000) {
        alert(currentLang === 'en' ? 'Range is too large (maximum 5,000 items at once).' : 'النطاق كبير جداً (الحد الأقصى 5000 سبيكة في المرة الواحدة).');
        return;
      }

      for (let n = minNum; n <= maxNum; n++) {
        const numFormatted = String(n).padStart(startSplit.padLen, '0');
        expectedSerials.push(`${startSplit.prefix}${numFormatted}${startSplit.suffix}`);
      }
    } else {
      alert(currentLang === 'en'
        ? `Invalid serial range format. Start ("${rawStart}") and End ("${rawEnd}") must share the same prefix, suffix, and structure.`
        : `صيغة نطاق الأرقام التسلسلية غير صحيحة. يجب أن يتطابق رقم البداية ("${rawStart}") ورقم النهاية ("${rawEnd}") في البادئة واللاحقة والبنية.`);
      return;
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
    const prodLabel = productToFilter ? ` for product [${prodObj?.denomination || (typeof productToFilter === 'string' ? productToFilter : '')}]` : '';
    const prodLabelAr = productToFilter ? ` للمنتج [${prodObj?.denomination || (typeof productToFilter === 'string' ? productToFilter : '')}]` : '';

    if (matchedSerials.length === 0) {
      if (expectedSerials.length === 1) {
        alert(currentLang === 'en'
          ? `Serial number "${expectedSerials[0]}" does not exist in active Turkey inventory${prodLabel}. Please verify the serial number and selected product.`
          : `الرقم التسلسلي "${expectedSerials[0]}" غير موجود في مخزون تركيا الحالي${prodLabelAr}. يرجى التحقق من صحة الرقم والمنتج المختار.`);
      } else {
        alert(currentLang === 'en'
          ? `None of the requested serial numbers in range ${rawStart}..${rawEnd} (${expectedSerials.length} items) exist in active Turkey inventory${prodLabel}. Please verify the exact serial numbers.`
          : `جميع الأرقام التسلسلية المحددة في النطاق ${rawStart}..${rawEnd} (${expectedSerials.length} قطعة) غير موجودة في مخزون تركيا الحالي${prodLabelAr}. يرجى التأكد من دقة الأرقام.`);
      }
      return;
    }

    const newSet = new Set([...selectedSerials, ...matchedSerials]);
    setSelectedSerials(Array.from(newSet));
    setShowSmartModal(false);

    if (missingSerials.length > 0) {
      alert(currentLang === 'en'
        ? `Selected ${matchedSerials.length} matching Turkey bar(s) in range ${rawStart}..${rawEnd}${prodLabel}. Note: ${missingSerials.length} serial(s) do not exist in inventory (${missingSerials.slice(0, 3).join(', ')}${missingSerials.length > 3 ? '...' : ''}).`
        : `تم تحديد ${matchedSerials.length} سبيكة مطابقة ضمن النطاق ${rawStart}..${rawEnd}${prodLabelAr}. تنبيه: ${missingSerials.length} رقم تسلسلي غير موجود في المخزون (${missingSerials.slice(0, 3).join(', ')}${missingSerials.length > 3 ? '...' : ''}).`);
    } else {
      alert(currentLang === 'en'
        ? `Successfully selected all ${matchedSerials.length} Turkey bar(s) in range ${rawStart}..${rawEnd}${prodLabel}.`
        : `تم بنجاح تحديد جميع السبائك (${matchedSerials.length} قطعة) ضمن النطاق ${rawStart}..${rawEnd}${prodLabelAr}.`);
    }
  };

  // Submit Purchase
  const handleSubmit = async () => {
    if (selectedSerials.length === 0) {
      alert(currentLang === 'en' ? 'Please select at least one Turkey bar to purchase.' : 'يرجى تحديد سبيكة تركية واحدة على الأقل للشراء.');
      return;
    }
    const rateNum = parseFloat(unitPricePerGram);
    if (isNaN(rateNum) || rateNum <= 0) {
      alert(currentLang === 'en' ? 'Please enter the agreed purchase rate (KWD/gram).' : 'يرجى إدخال سعر الشراء المتفق عليه للجرام (دينار/جرام).');
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
      onRefresh();
    }
  };

  // Total agreed cost in KWD
  const totalAgreedCostKwd = useMemo(() => {
    const rate = parseFloat(unitPricePerGram);
    if (isNaN(rate) || rate <= 0) return 0;
    return Math.round(selectedItemsData.totalWeightGrams * rate * 1000) / 1000;
  }, [selectedItemsData.totalWeightGrams, unitPricePerGram]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 1. TOP HEADER SUMMARY & KPIS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        
        {/* KPI 1: Turkey Stock Available */}
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
            </div>
            <div style={{ width: '42px', height: '42px', borderRadius: '8px', background: 'rgba(225, 29, 72, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: '#E11D48' }}>
              🇹🇷
            </div>
          </div>
        </div>

        {/* KPI 2: Selected for Purchase */}
        <div className="glass-card" style={{ padding: '18px', borderLeft: '4px solid var(--kfh-green)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {currentLang === 'en' ? 'Selected for KFH Purchase' : 'المحدد للشراء لصالح بيتك'}
              </div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', marginTop: '6px', color: 'var(--kfh-green)' }}>
                {selectedItemsData.count} <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'bars' : 'سبيكة'}</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--kfh-green)', fontWeight: 600, marginTop: '2px' }}>
                {selectedItemsData.totalWeightKg} KG <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>({selectedItemsData.totalWeightGrams.toLocaleString()} g)</span>
              </div>
            </div>
            <div style={{ width: '42px', height: '42px', borderRadius: '8px', background: 'rgba(0, 155, 78, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: 'var(--kfh-green)' }}>
              <i className="fa-solid fa-cart-shopping"></i>
            </div>
          </div>
        </div>

        {/* KPI 3: Live Guidance Rate */}
        <div className="glass-card" style={{ padding: '18px', borderLeft: '4px solid var(--accent-gold)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {currentLang === 'en' ? 'Indicative Gold Rate' : 'سعر الذهب الإرشادي (أونصة)'}
              </div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', marginTop: '6px', color: 'var(--accent-gold)' }}>
                ${goldRate ? goldRate.toLocaleString() : '—'} <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>/ oz</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {currentLang === 'en' ? 'Negotiate & enter manual KWD rate per gram' : 'يتم إدخال السعر المتفق عليه يدوياً بدينار/جرام'}
              </div>
            </div>
            <div style={{ width: '42px', height: '42px', borderRadius: '8px', background: 'rgba(212, 175, 55, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: 'var(--accent-gold)' }}>
              <i className="fa-solid fa-chart-line"></i>
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
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            className={`btn ${activeSubTab === 'STOCK_PURCHASE' ? 'btn-primary' : ''}`}
            style={activeSubTab !== 'STOCK_PURCHASE' ? { backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--surface-border)' } : {}}
            onClick={() => setActiveSubTab('STOCK_PURCHASE')}
          >
            <i className="fa-solid fa-layer-group"></i> {currentLang === 'en' ? 'Turkey Stock & Purchase Order' : 'مخزون تركيا وأمر الشراء'}
          </button>

          <button
            className={`btn ${activeSubTab === 'PENDING_BATCHES' ? 'btn-primary' : ''}`}
            style={activeSubTab !== 'PENDING_BATCHES' ? { backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--surface-border)' } : {}}
            onClick={() => setActiveSubTab('PENDING_BATCHES')}
          >
            <i className="fa-solid fa-clock-rotate-left"></i> {currentLang === 'en' ? 'Purchase Requests & History' : 'طلبات الشراء وسجل العمليات'}
            {pendingPurchases.length > 0 && (
              <span className="badge badge-reserved" style={{ marginLeft: '6px', fontSize: '10px' }}>
                {pendingPurchases.filter(p => p.status_code === 'PENDING_APPROVAL').length}
              </span>
            )}
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
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

          <button className="btn btn-secondary" onClick={onRefresh} style={{ fontSize: '12px', padding: '6px 12px' }}>
            <i className="fa-solid fa-arrows-rotate"></i> {currentLang === 'en' ? 'Refresh Stock' : 'تحديث المخزون'}
          </button>
        </div>
      </div>

      {/* 3. SUBTAB 1: SELECT & PURCHASE TURKEY GOLD */}
      {activeSubTab === 'STOCK_PURCHASE' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: '20px', alignItems: 'start' }}>
          
          {/* LEFT: DENOMINATION SELECTOR + SERIAL FACILITATOR + QR SCANNER + SELECTED ITEMS */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* STEP 1: SELECT DENOMINATION & TYPE (Simplified Explorer) */}
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

              {/* Denomination Choice Pills / Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                {turkeyInventory?.summary?.by_product?.map(p => {
                  const isSelected = selectedDenomCode === p.product_code;
                  // count selected for this product
                  const prodItems = availableItems.filter(i => i.product_code === p.product_code);
                  const selectedSet = new Set(selectedSerials);
                  const selectedInThis = prodItems.filter(i => selectedSet.has(i.serial_number)).length;

                  return (
                    <div
                      key={p.product_code}
                      onClick={() => {
                        setSelectedDenomCode(p.product_code);
                        setDenomSerialSearch('');
                      }}
                      style={{
                        padding: '12px 14px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        border: isSelected ? '2px solid var(--kfh-green)' : '1px solid var(--surface-border)',
                        background: isSelected ? 'rgba(0, 155, 78, 0.12)' : 'rgba(255,255,255,0.02)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', fontWeight: 'bold', color: isSelected ? 'var(--kfh-green)' : 'var(--text-primary)' }}>
                          {p.denomination}
                        </span>
                        <span style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '10px', background: isSelected ? 'var(--kfh-green)' : 'rgba(255,255,255,0.08)', color: isSelected ? '#fff' : 'var(--text-muted)', fontWeight: 600 }}>
                          {p.count} {currentLang === 'en' ? 'in stock' : 'متاح'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
                        <span>{p.metal_name} ({p.weight_grams}g)</span>
                        {selectedInThis > 0 && (
                          <span style={{ color: 'var(--kfh-green)', fontWeight: 'bold' }}>
                            ✓ {selectedInThis} {currentLang === 'en' ? 'selected' : 'محدد'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
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
                        <i className="fa-solid fa-check"></i> {currentLang === 'en' ? `Select All (${itemsForSelectedDenom.length})` : `تحديد كل الفئة (${itemsForSelectedDenom.length})`}
                      </button>
                      {selectedCountForCurrentDenom > 0 && (
                        <button
                          type="button"
                          className="btn"
                          onClick={handleDeselectAllForDenom}
                          style={{ fontSize: '11px', padding: '4px 10px', background: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                        >
                          {currentLang === 'en' ? 'Deselect Denomination' : 'إلغاء تحديد الفئة'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Serial Search / Filter Input */}
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ position: 'relative' }}>
                      <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: currentLang === 'ar' ? 'auto' : '10px', right: currentLang === 'ar' ? '10px' : 'auto', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '12px' }}></i>
                      <input
                        type="text"
                        className="form-control"
                        placeholder={currentLang === 'en' ? `Filter available serials in ${currentDenomObj.denomination}... (e.g. 570 or B00)` : `تصفية الأرقام التسلسلية المتاحة لـ ${currentDenomObj.denomination}...`}
                        value={denomSerialSearch}
                        onChange={e => setDenomSerialSearch(e.target.value)}
                        style={{ fontSize: '12px', padding: currentLang === 'ar' ? '6px 30px 6px 10px' : '6px 10px 6px 30px' }}
                      />
                    </div>
                  </div>

                  {/* Serials Badges Facilitator Grid */}
                  <div style={{
                    maxHeight: '180px',
                    overflowY: 'auto',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                    gap: '6px',
                    padding: '8px',
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: '6px',
                    border: '1px solid rgba(255,255,255,0.04)'
                  }}>
                    {displayedDenomSerials.length === 0 ? (
                      <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '12px' }}>
                        {currentLang === 'en' ? 'No serials match your search filter in this denomination.' : 'لا توجد أرقام تسلسلية مطابقة لبحثك في هذه الفئة.'}
                      </div>
                    ) : (
                      displayedDenomSerials.map(item => {
                        const isSelected = selectedSerials.includes(item.serial_number);
                        return (
                          <div
                            key={item.item_id || item.serial_number}
                            onClick={() => handleToggleItem(item.serial_number)}
                            style={{
                              padding: '6px 8px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                              border: isSelected ? '1px solid var(--kfh-green)' : '1px solid rgba(255,255,255,0.08)',
                              background: isSelected ? 'rgba(0, 155, 78, 0.25)' : 'rgba(255,255,255,0.03)',
                              transition: 'all 0.15s'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '11px', fontWeight: 'bold', color: isSelected ? 'var(--kfh-green)' : 'var(--text-primary)', fontFamily: 'monospace' }}>
                                {item.serial_number}
                              </span>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {}} // handled by div click
                                style={{ accentColor: 'var(--kfh-green)', cursor: 'pointer' }}
                              />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '9px', color: 'var(--text-muted)' }}>
                              <span>{item.location_code || 'Vault'}</span>
                              {item.has_qr_printed ? (
                                <span title="QR Label Printed" style={{ color: 'var(--kfh-green)' }}><i className="fa-solid fa-qrcode"></i></span>
                              ) : (
                                <span title="No QR Label" style={{ color: '#EF4444' }}><i className="fa-solid fa-triangle-exclamation"></i></span>
                              )}
                            </div>
                            {item.lot_number && (
                              <div style={{ fontSize: '8.5px', color: 'var(--accent-gold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {item.lot_number}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                    <span>{displayedDenomSerials.length} {currentLang === 'en' ? 'serials shown' : 'رقم معروض'}</span>
                    <span style={{ color: 'var(--kfh-green)', fontWeight: 600 }}>
                      {selectedCountForCurrentDenom} / {itemsForSelectedDenom.length} {currentLang === 'en' ? 'selected in this denomination' : 'محدد من هذه الفئة'}
                    </span>
                  </div>

                </div>
              )}

            </div>

            {/* STEP 2: DEDICATED QR & BARCODE QUICK SCANNER (USB Gun or Camera) */}
            <div className="glass-card" style={{ padding: '16px 20px', border: '1px solid rgba(212, 175, 55, 0.3)', background: 'linear-gradient(180deg, rgba(212, 175, 55, 0.05) 0%, rgba(255,255,255,0.01) 100%)' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--accent-gold)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 'bold' }}>
                    <i className="fa-solid fa-qrcode"></i>
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary)' }}>
                      {currentLang === 'en' ? 'Barcode & QR Code Scanner' : 'ماسح الباركود ورمز QR المباشر'}
                    </h4>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {currentLang === 'en' ? 'Scan physical bar labels with a barcode gun or camera to instantly add them to your purchase batch.' : 'امسح ملصق الباركود أو رمز QR بجهاز المسح أو الكاميرا لإضافتها مباشرة لطلب الشراء.'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  {!cameraActive ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setSmartTab('OCR');
                        setShowSmartModal(true);
                      }}
                      style={{ fontSize: '11px', padding: '5px 12px' }}
                    >
                      <i className="fa-solid fa-camera"></i> {currentLang === 'en' ? 'Live Camera Scanner' : 'مسح بالكاميرا'}
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Fast Barcode/QR Input Form */}
              <form
                onSubmit={e => {
                  e.preventDefault();
                  handleProcessScanInput(qrScanInput);
                }}
                style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
              >
                <div style={{ position: 'relative', flex: 1 }}>
                  <i className="fa-solid fa-barcode" style={{ position: 'absolute', left: currentLang === 'ar' ? 'auto' : '12px', right: currentLang === 'ar' ? '12px' : 'auto', top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-gold)', fontSize: '14px' }}></i>
                  <input
                    ref={qrInputRef}
                    type="text"
                    className="form-control"
                    placeholder={currentLang === 'en' ? 'Scan barcode / QR code or enter serial number & hit Enter...' : 'امسح الباركود / رمز QR أو أدخل الرقم واضغط Enter...'}
                    value={qrScanInput}
                    onChange={e => setQrScanInput(e.target.value)}
                    style={{ fontSize: '13px', padding: currentLang === 'ar' ? '8px 36px 8px 12px' : '8px 12px 8px 36px', height: '38px' }}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ height: '38px', padding: '0 16px', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                >
                  <i className="fa-solid fa-plus"></i> {currentLang === 'en' ? 'Scan & Add' : 'مسح وإضافة'}
                </button>
              </form>

              {/* Scanner feedback message */}
              {scanFeedback && (
                <div style={{
                  marginTop: '10px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: scanFeedback.type === 'success' ? 'rgba(0, 155, 78, 0.15)' : scanFeedback.type === 'warning' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: scanFeedback.type === 'success' ? 'var(--kfh-green)' : scanFeedback.type === 'warning' ? '#F59E0B' : '#EF4444',
                  border: `1px solid ${scanFeedback.type === 'success' ? 'rgba(0, 155, 78, 0.3)' : scanFeedback.type === 'warning' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <i className={`fa-solid ${scanFeedback.type === 'success' ? 'fa-circle-check' : scanFeedback.type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-xmark'}`}></i>
                    <span>{scanFeedback.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setScanFeedback(null)}
                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '14px' }}
                  >
                    &times;
                  </button>
                </div>
              )}

            </div>

            {/* STEP 3: SELECTED TURKEY GOLD ITEMS TABLE */}
            <div className="glass-card" style={{ padding: '20px' }}>
              
              {/* Header with Title, Count Badge, and Collapse/Expand Toggle */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isItemsListExpanded ? '16px' : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--kfh-green)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 'bold' }}>
                    3
                  </div>
                  <h4 style={{ margin: 0, fontSize: '15px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <i className="fa-solid fa-cart-shopping" style={{ color: 'var(--kfh-green)' }}></i>
                    {currentLang === 'en' ? 'Selected Items for Purchase' : 'السبائك المحددة لأمر الشراء'}
                  </h4>
                  <span className="badge" style={{ background: selectedItemsData.count > 0 ? 'rgba(0, 155, 78, 0.15)' : 'rgba(255,255,255,0.06)', color: selectedItemsData.count > 0 ? 'var(--kfh-green)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 'bold', border: selectedItemsData.count > 0 ? '1px solid rgba(0, 155, 78, 0.3)' : 'none' }}>
                    {selectedItemsData.count} {currentLang === 'en' ? 'selected' : 'محددة'} ({selectedItemsData.totalWeightKg} KG)
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {selectedSerials.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={handleClearSelection}
                      style={{ fontSize: '11px', padding: '4px 10px' }}
                    >
                      <i className="fa-solid fa-trash-can"></i> {currentLang === 'en' ? 'Clear List' : 'تفريغ القائمة'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsItemsListExpanded(!isItemsListExpanded)}
                    style={{ fontSize: '12px', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <i className={`fa-solid ${isItemsListExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
                    <span>{isItemsListExpanded ? (currentLang === 'en' ? 'Collapse' : 'طي القائمة') : (currentLang === 'en' ? 'Expand' : 'توسيع القائمة')}</span>
                  </button>
                </div>
              </div>

              {isItemsListExpanded && (
                <>
                  {/* Filter within selected items */}
                  {selectedItemsData.items.length > 0 && (
                    <div style={{ marginBottom: '14px' }}>
                      <input
                        type="text"
                        className="form-control"
                        placeholder={currentLang === 'en' ? 'Search within selected bars by serial, refiner, denomination, shipment lot...' : 'بحث ضمن السبائك المحددة بالرقم أو المصفاة أو الفئة أو الشحنة...'}
                        value={searchSelectedQuery}
                        onChange={e => setSearchSelectedQuery(e.target.value)}
                        style={{ fontSize: '12px', padding: '7px 12px' }}
                      />
                    </div>
                  )}

                  {/* Selected Items Data Grid */}
                  <div className="table-responsive" style={{ maxHeight: '420px', overflowY: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                          <th>{currentLang === 'en' ? 'Serial Number' : 'الرقم التسلسلي'}</th>
                          <th>{currentLang === 'en' ? 'Denomination & Weight' : 'الفئة والوزن'}</th>
                          <th>{currentLang === 'en' ? 'Shipment / Lot' : 'الشحنة / اللوت'}</th>
                          <th>{currentLang === 'en' ? 'Registered Cost (KWD)' : 'التكلفة المسجلة'}</th>
                          <th>{currentLang === 'en' ? 'Refiner / Brand' : 'المصفاة'}</th>
                          <th>{currentLang === 'en' ? 'Vault Location' : 'موقع الخزينة'}</th>
                          <th>{currentLang === 'en' ? 'QR Status' : 'حالة QR'}</th>
                          <th style={{ width: '60px', textAlign: 'center' }}>{currentLang === 'en' ? 'Action' : 'إجراء'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedSelectedItems.length === 0 ? (
                          <tr>
                            <td colSpan={9} style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--text-muted)' }}>
                              <i className="fa-solid fa-cart-arrow-down" style={{ fontSize: '32px', marginBottom: '12px', color: 'var(--accent-gold)', opacity: 0.6, display: 'block' }}></i>
                              <strong style={{ fontSize: '14px', color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                                {selectedItemsData.items.length === 0 
                                  ? (currentLang === 'en' ? 'No Bars Selected Yet' : 'لم يتم تحديد أي سبائك بعد')
                                  : (currentLang === 'en' ? 'No matching bars found in current search' : 'لا توجد سبائك مطابقة للبحث المحدد')}
                              </strong>
                              <span style={{ fontSize: '12px' }}>
                                {selectedItemsData.items.length === 0
                                  ? (currentLang === 'en' 
                                      ? 'Select a Denomination / Type above, or use the Barcode & QR Code Scanner to add Turkey consignment bars to this purchase order.' 
                                      : 'اختر فئة السبيكة أعلاه أو استخدم ماسح الباركود ورمز QR لإضافة السبائك التركية لأمر الشراء.')
                                  : (currentLang === 'en' ? 'Try changing your search keywords.' : 'جرب تغيير كلمات البحث.')}
                              </span>
                            </td>
                          </tr>
                        ) : (
                          displayedSelectedItems.map((item, index) => {
                            const rateNum = parseFloat(unitPricePerGram) || 0;
                            const barCost = rateNum > 0 ? (item.weight_grams * rateNum) : 0;
                            return (
                              <tr key={item.item_id || item.serial_number}>
                                <td style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                                  {index + 1}
                                </td>
                                <td>
                                  <strong style={{ color: 'var(--kfh-green)', fontFamily: 'monospace' }}>
                                    {item.serial_number}
                                  </strong>
                                </td>
                                <td>
                                  {item.denomination || `${item.weight_grams}g Bar`}
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                                    ({item.weight_grams}g)
                                  </span>
                                </td>
                                <td>
                                  <span style={{ fontSize: '11px', padding: '2px 6px', background: 'rgba(212, 175, 55, 0.1)', color: 'var(--accent-gold)', borderRadius: '4px', border: '1px solid rgba(212, 175, 55, 0.25)', fontWeight: 600 }}>
                                    {item.lot_number || 'TR-CONSIGNMENT'}
                                  </span>
                                </td>
                                <td>
                                  {barCost > 0 ? (
                                    <strong style={{ color: 'var(--kfh-green)', fontSize: '12px' }}>
                                      {barCost.toFixed(3)} KWD
                                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', fontWeight: 'normal' }}>
                                        @{rateNum.toFixed(3)}/g
                                      </span>
                                    </strong>
                                  ) : (
                                    <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>—</span>
                                  )}
                                </td>
                                <td>{item.refiner_name || item.brand_name || 'Nadir Gold'}</td>
                                <td>
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                    {item.location_code}
                                  </span>
                                </td>
                                <td>
                                  {item.has_qr_printed ? (
                                    <span className="badge badge-ready" style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                      <i className="fa-solid fa-qrcode"></i> {currentLang === 'en' ? 'Printed' : 'مطبوع'}
                                    </span>
                                  ) : (
                                    <span className="badge" style={{ fontSize: '11px', background: 'rgba(239, 68, 68, 0.12)', color: '#EF4444', border: '1px solid rgba(239, 68, 68, 0.3)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                      <i className="fa-solid fa-triangle-exclamation"></i> {currentLang === 'en' ? 'No QR' : 'غير مطبوع'}
                                    </span>
                                  )}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <button
                                    type="button"
                                    className="btn btn-danger"
                                    onClick={() => handleToggleItem(item.serial_number)}
                                    title={currentLang === 'en' ? 'Remove from selection' : 'إزالة من التحديد'}
                                    style={{ padding: '3px 8px', fontSize: '11px' }}
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

                  <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{displayedSelectedItems.length} {currentLang === 'en' ? 'bars displayed' : 'سبيكة معروضة'}</span>
                    <span><strong>{selectedItemsData.count}</strong> {currentLang === 'en' ? 'total bars selected' : 'إجمالي السبائك المحددة'} ({selectedItemsData.totalWeightKg} KG)</span>
                  </div>
                </>
              )}

            </div>

          </div>

          {/* RIGHT: PURCHASE ORDER WORKBENCH PANEL */}
          <div className="glass-card" style={{ padding: '20px', position: 'sticky', top: '20px' }}>
            <h4 style={{ margin: '0 0 16px 0', fontSize: '15px', color: 'var(--kfh-green)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="fa-solid fa-file-signature"></i>
              {currentLang === 'en' ? 'Purchase Order Summary' : 'ملخص أمر الشراء (Maker)'}
            </h4>

            {/* Selected Breakdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderBottom: '1px solid var(--surface-border)', paddingBottom: '14px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Total Bars:' : 'عدد السبائك:'}</span>
                <strong style={{ color: 'var(--kfh-green)', fontSize: '14px' }}>{selectedItemsData.count} {currentLang === 'en' ? 'units' : 'قطعة'}</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Total Weight (g):' : 'الوزن الإجمالي (جرام):'}</span>
                <strong>{selectedItemsData.totalWeightGrams.toLocaleString()} g</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Total Weight (kg):' : 'الوزن الإجمالي (كجم):'}</span>
                <strong>{selectedItemsData.totalWeightKg} KG</strong>
              </div>

              {selectedShipmentLots.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Shipment Lots:' : 'شحنات اللوت:'}</span>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {selectedShipmentLots.map((lot, i) => (
                      <span key={i} style={{ fontSize: '10px', padding: '1px 6px', background: 'rgba(212, 175, 55, 0.12)', color: 'var(--accent-gold)', borderRadius: '3px', border: '1px solid rgba(212, 175, 55, 0.3)' }}>
                        {lot}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Agreed Unit Price per gram input (Mandatory) */}
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
                <span>{currentLang === 'en' ? 'Agreed Purchase Rate (KWD / gram)' : 'سعر شراء الجرام المتفق عليه (دينار / جرام)'}</span>
                <span style={{ color: 'var(--accent-red)' }}>*</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                className="form-control"
                placeholder={currentLang === 'en' ? 'Enter rate e.g. 24.500' : 'أدخل السعر مثلاً 24.500'}
                value={unitPricePerGram}
                onChange={e => {
                  const val = e.target.value;
                  if (val === '' || /^\d*\.?\d*$/.test(val)) {
                    setUnitPricePerGram(val);
                  }
                }}
                disabled={!canModify}
                style={{ fontSize: '14px', fontWeight: 'bold' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                {currentLang === 'en'
                  ? 'This agreed rate/g is registered with each denomination & shipment lot in inventory records.'
                  : 'يتم تسجيل سعر الجرام هذا مع كل فئة وشحنة في سجلات المخزون والتكلفة.'}
              </span>
            </div>

            {/* REGISTERED COST BREAKDOWN PER DENOMINATION & SHIPMENT */}
            {selectedBreakdownByDenomination.length > 0 && parseFloat(unitPricePerGram) > 0 && (
              <div style={{ background: 'rgba(0, 155, 78, 0.05)', border: '1px solid rgba(0, 155, 78, 0.25)', borderRadius: '8px', padding: '12px', marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--kfh-green)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <i className="fa-solid fa-calculator"></i>
                  {currentLang === 'en' ? 'Registered Cost per Denomination & Shipment:' : 'التكلفة المسجلة حسب الفئة والشحنة:'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {selectedBreakdownByDenomination.map(d => (
                    <div key={d.product_code} style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid var(--surface-border)', fontSize: '11px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginBottom: '3px' }}>
                        <span>{d.denomination} ({d.weight_grams}g)</span>
                        <span style={{ color: 'var(--kfh-green)' }}>{d.subtotal_cost.toFixed(3)} KWD</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '10.5px' }}>
                        <span>{d.count} {currentLang === 'en' ? 'bars' : 'سبائك'} × {d.unit_cost_per_bar.toFixed(3)} KWD/bar</span>
                        <span>@{parseFloat(unitPricePerGram).toFixed(3)} KWD/g</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Total Estimated Cost calculation */}
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '6px', border: '1px solid var(--surface-border)', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Total Purchase Value:' : 'إجمالي قيمة الشراء:'}</span>
                <strong style={{ fontSize: '16px', color: 'var(--kfh-green)' }}>
                  {totalAgreedCostKwd > 0 ? `${totalAgreedCostKwd.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} KWD` : '—'}
                </strong>
              </div>
            </div>

            {/* Maker Notes */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', display: 'block' }}>
                {currentLang === 'en' ? 'Maker Notes / Trade Reference' : 'ملاحظات الصانع / مرجع الصفقة'}
              </label>
              <textarea
                className="form-control"
                rows={2}
                placeholder={currentLang === 'en' ? 'Optional trade reference or notes...' : 'مرجع الصفقة أو ملاحظات اختيارية...'}
                value={purchaseNotes}
                onChange={e => setPurchaseNotes(e.target.value)}
                disabled={!canModify}
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
                ? 'Upon Checker approval, gold ownership will transition to KFH_OWNED and become available for retail sales & customer delivery.' 
                : 'بمجرد اعتماد المراجع، ستتحول ملكية الذهب إلى بيتك (KFH_OWNED) وتصبح متاحة للبيع والتسليم للعملاء.'}
            </div>

          </div>

        </div>
      )}

      {/* 4. SUBTAB 2: PENDING PURCHASES & TRACKER */}
      {activeSubTab === 'PENDING_BATCHES' && (
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h4 style={{ margin: 0, fontSize: '15px', color: 'var(--kfh-green)' }}>
              <i className="fa-solid fa-list-check"></i> {currentLang === 'en' ? 'Turkey Purchase Requests & Maker-Checker Log' : 'طلبات شراء ذهب تركيا وسجل تدقيق الأعين الأربعة'}
            </h4>
          </div>

          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>{currentLang === 'en' ? 'Batch Reference' : 'مرجع الدفعة'}</th>
                  <th>{currentLang === 'en' ? 'Items Count' : 'عدد السبائك'}</th>
                  <th>{currentLang === 'en' ? 'Total Weight' : 'الوزن الإجمالي'}</th>
                  <th>{currentLang === 'en' ? 'Agreed Buy Rate' : 'سعر الشراء المتفق عليه'}</th>
                  <th>{currentLang === 'en' ? 'Total Cost (KWD)' : 'إجمالي القيمة (د.ك)'}</th>
                  <th>{currentLang === 'en' ? 'Requested By' : 'مقدم الطلب'}</th>
                  <th>{currentLang === 'en' ? 'Status' : 'الحالة'}</th>
                  <th>{currentLang === 'en' ? 'Created At' : 'تاريخ الإنشاء'}</th>
                  <th>{currentLang === 'en' ? 'Serials Preview' : 'الأرقام التسلسلية'}</th>
                </tr>
              </thead>
              <tbody>
                {pendingPurchases.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      {currentLang === 'en' ? 'No purchase requests recorded yet.' : 'لا توجد طلبات شراء مسجلة بعد.'}
                    </td>
                  </tr>
                ) : (
                  pendingPurchases.map(p => {
                    let serialsList: string[] = [];
                    try {
                      serialsList = JSON.parse(p.serials_json || '[]');
                    } catch (_) {}

                    return (
                      <tr key={p.pending_purchase_id}>
                        <td><strong>{p.batch_reference}</strong></td>
                        <td>{p.total_items} {currentLang === 'en' ? 'bars' : 'سبيكة'}</td>
                        <td>
                          {p.total_weight_grams} g
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                            ({(p.total_weight_grams / 1000).toFixed(3)} KG)
                          </span>
                        </td>
                        <td><strong style={{ color: 'var(--kfh-green)' }}>{p.unit_price} KWD / g</strong></td>
                        <td><strong>{p.total_cost ? Number(p.total_cost).toFixed(3) : (p.total_weight_grams * p.unit_price).toFixed(3)} KWD</strong></td>
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
                          <div style={{ maxWidth: '240px', overflowX: 'auto', whiteSpace: 'nowrap', display: 'flex', gap: '4px' }}>
                            {serialsList.map((s, idx) => (
                              <span key={idx} style={{ fontSize: '10px', padding: '2px 5px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px' }}>
                                {s}
                              </span>
                            ))}
                          </div>
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

      {/* SMART SELECTION & SCANNER MODAL (QR SCAN, RANGE, BULK PASTE, OCR) */}
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

    </div>
  );
};
