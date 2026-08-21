import React, { useState, useMemo, useRef } from 'react';
import Tesseract from 'tesseract.js';

interface TurkeyPurchaseScreenProps {
  turkeyInventory: {
    summary: {
      total_bars: number;
      total_weight_grams: number;
      total_weight_kg: number;
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
  const [searchQuery, setSearchQuery] = useState('');
  const [filterProduct, setFilterProduct] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  
  // Selection state
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  
  // Smart Tools Modal state (Range, Paste, OCR Scanner)
  const [showSmartModal, setShowSmartModal] = useState(false);
  const [smartTab, setSmartTab] = useState<'RANGE' | 'PASTE' | 'OCR'>('RANGE');

  // Range tool state
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');

  // Bulk paste state
  const [pasteText, setPasteText] = useState('');

  // OCR state
  const [ocrImage, setOcrImage] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatusText, setOcrStatusText] = useState('');
  const [extractedSerials, setExtractedSerials] = useState<{ serial: string; selected: boolean }[]>([]);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Manual Purchase Rate (KWD per Gram) — User manually enters the negotiated rate (Mandatory)
  const [unitPricePerGram, setUnitPricePerGram] = useState<string>('');
  const [purchaseNotes, setPurchaseNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableItems = turkeyInventory?.items || [];

  // Filtered items
  const filteredItems = useMemo(() => {
    return availableItems.filter(item => {
      const matchSearch = !searchQuery || 
        item.serial_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.refiner_name && item.refiner_name.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchProd = !filterProduct || item.product_code === filterProduct;
      const matchLoc = !filterLocation || (item.location_code && item.location_code.includes(filterLocation));
      return matchSearch && matchProd && matchLoc;
    });
  }, [availableItems, searchQuery, filterProduct, filterLocation]);

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
      setOcrStatusText(currentLang === 'en' ? 'Scanning laser-engraved serial number...' : 'قراءة الرقم التسلسلي المحفور بالليزر...');

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

      // Extract alphanumeric tokens matching gold bar serial format (e.g. B00570, TR-2026-001, etc.)
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
        // Fix OCR confusion: letter 'O' in numeric suffix -> '0'
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
    } catch (err: any) {
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
    } catch (err) {
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
  const handleApplyExtractedMatches = (serialsToSelect: string[]) => {
    const availableSet = new Set(availableItems.map(i => i.serial_number.toUpperCase()));
    const matched = serialsToSelect
      .map(s => s.trim().toUpperCase())
      .filter(s => availableSet.has(s));

    if (matched.length === 0) {
      alert(currentLang === 'en' 
        ? `None of the scanned serials (${serialsToSelect.join(', ')}) were found in active Turkey inventory.` 
        : `لم يتم العثور على الأرقام (${serialsToSelect.join(', ')}) في مخزون تركيا الحالي.`);
      return;
    }

    const newSet = new Set([...selectedSerials, ...matched]);
    setSelectedSerials(Array.from(newSet));
    setShowSmartModal(false);
    alert(currentLang === 'en' ? `Selected ${matched.length} matching Turkey bar(s).` : `تم تحديد ${matched.length} سبيكة تركية مطابقة.`);
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

  // Handle Range Selection
  const handleApplyRangeSelect = () => {
    if (!rangeStart.trim() || !rangeEnd.trim()) {
      alert(currentLang === 'en' ? 'Please enter Start and End serial numbers.' : 'يرجى إدخال رقم البداية والنهاية.');
      return;
    }

    const start = rangeStart.trim().toUpperCase();
    const end = rangeEnd.trim().toUpperCase();

    const matched = availableItems.filter(i => {
      const s = i.serial_number.toUpperCase();
      return s >= start && s <= end;
    }).map(i => i.serial_number);

    if (matched.length === 0) {
      alert(currentLang === 'en' ? 'No available Turkey bars found in the specified range.' : 'لم يتم العثور على سبائك تركية متاحة ضمن النطاق المحدد.');
      return;
    }

    const newSet = new Set([...selectedSerials, ...matched]);
    setSelectedSerials(Array.from(newSet));
    setShowSmartModal(false);
  };

  // Toggle single item
  const handleToggleItem = (serial: string) => {
    setSelectedSerials(prev => 
      prev.includes(serial) ? prev.filter(s => s !== serial) : [...prev, serial]
    );
  };

  // Select all filtered
  const handleSelectAllFiltered = () => {
    const filteredSerials = filteredItems.map(i => i.serial_number);
    const newSet = new Set([...selectedSerials, ...filteredSerials]);
    setSelectedSerials(Array.from(newSet));
  };

  // Clear selection
  const handleClearSelection = () => {
    setSelectedSerials([]);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 1. TOP HEADER SUMMARY & KPIS (Stock & Selection only) */}
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

      </div>

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

        <button className="btn btn-secondary" onClick={onRefresh} style={{ fontSize: '12px', padding: '6px 12px' }}>
          <i className="fa-solid fa-arrows-rotate"></i> {currentLang === 'en' ? 'Refresh Stock' : 'تحديث المخزون'}
        </button>
      </div>

      {/* 3. SUBTAB 1: SELECT & PURCHASE TURKEY GOLD */}
      {activeSubTab === 'STOCK_PURCHASE' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: '20px', alignItems: 'start' }}>
          
          {/* LEFT: TURKEY STOCK TABLE & FILTERS */}
          <div className="glass-card" style={{ padding: '20px' }}>
            
            {/* Quick Tools & Range Selector */}
            <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '14px', borderRadius: '8px', border: '1px solid var(--surface-border)', marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--kfh-green)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <i className="fa-solid fa-filter-circle-dollar"></i>
                  {currentLang === 'en' ? 'Quick Selection & Range Filter:' : 'التحديد السريع واختيار النطاق:'}
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowSmartModal(true)}
                  style={{ fontSize: '11px', padding: '5px 12px' }}
                >
                  <i className="fa-solid fa-wand-magic-sparkles"></i> {currentLang === 'en' ? 'Smart Scanner & Tools (OCR)' : 'الماسح الضوئي والأدوات الذكية'}
                </button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '130px' }}>
                  <label style={{ fontSize: '11px' }}>{currentLang === 'en' ? 'Start Serial' : 'من الرقم التسلسلي'}</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. TR-2026-0001"
                    value={rangeStart}
                    onChange={e => setRangeStart(e.target.value)}
                    style={{ fontSize: '12px', padding: '6px 8px' }}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '130px' }}>
                  <label style={{ fontSize: '11px' }}>{currentLang === 'en' ? 'End Serial' : 'إلى الرقم التسلسلي'}</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. TR-2026-0050"
                    value={rangeEnd}
                    onChange={e => setRangeEnd(e.target.value)}
                    style={{ fontSize: '12px', padding: '6px 8px' }}
                  />
                </div>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleApplyRangeSelect}
                  style={{ fontSize: '12px', padding: '6px 14px' }}
                >
                  <i className="fa-solid fa-check-double"></i> {currentLang === 'en' ? 'Select Range' : 'تحديد النطاق'}
                </button>

                <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={handleSelectAllFiltered}
                    style={{ fontSize: '11px', padding: '6px 10px', background: 'rgba(255,255,255,0.05)' }}
                  >
                    {currentLang === 'en' ? 'Select All' : 'تحديد الكل'}
                  </button>

                  {selectedSerials.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={handleClearSelection}
                      style={{ fontSize: '11px', padding: '6px 10px' }}
                    >
                      {currentLang === 'en' ? 'Clear' : 'إلغاء'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Search & Denomination Filters */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '180px' }}>
                <input
                  type="text"
                  className="form-control"
                  placeholder={currentLang === 'en' ? 'Search by Serial Number / Refiner...' : 'بحث بالرقم التسلسلي أو المصفاة...'}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{ fontSize: '12px', padding: '6px 10px' }}
                />
              </div>

              <select
                className="form-control"
                value={filterProduct}
                onChange={e => setFilterProduct(e.target.value)}
                style={{ width: '180px', fontSize: '12px', padding: '6px 8px' }}
              >
                <option value="">{currentLang === 'en' ? 'All Denominations' : 'جميع الفئات'}</option>
                {turkeyInventory?.summary?.by_product?.map(p => (
                  <option key={p.product_code} value={p.product_code}>
                    {p.denomination} ({p.count})
                  </option>
                ))}
              </select>
            </div>

            {/* Inventory Data Grid */}
            <div className="table-responsive" style={{ maxHeight: '520px', overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '40px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={filteredItems.length > 0 && filteredItems.every(i => selectedSerials.includes(i.serial_number))}
                        onChange={e => {
                          if (e.target.checked) handleSelectAllFiltered();
                          else {
                            const filteredSet = new Set(filteredItems.map(i => i.serial_number));
                            setSelectedSerials(selectedSerials.filter(s => !filteredSet.has(s)));
                          }
                        }}
                      />
                    </th>
                    <th>{currentLang === 'en' ? 'Serial Number' : 'الرقم التسلسلي'}</th>
                    <th>{currentLang === 'en' ? 'Denomination & Weight' : 'الفئة والوزن'}</th>
                    <th>{currentLang === 'en' ? 'Refiner / Brand' : 'المصفاة'}</th>
                    <th>{currentLang === 'en' ? 'Vault Location' : 'موقع الخزينة'}</th>
                    <th>{currentLang === 'en' ? 'Ownership' : 'الملكية'}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                        {currentLang === 'en' ? 'No Turkey consignment gold bars found in inventory.' : 'لا توجد سبائك تركية مطابقة في المخزون.'}
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map(item => {
                      const isSelected = selectedSerials.includes(item.serial_number);
                      return (
                        <tr
                          key={item.item_id}
                          style={{
                            backgroundColor: isSelected ? 'rgba(0, 155, 78, 0.08)' : 'transparent',
                            cursor: 'pointer'
                          }}
                          onClick={() => handleToggleItem(item.serial_number)}
                        >
                          <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleItem(item.serial_number)}
                            />
                          </td>
                          <td>
                            <strong style={{ color: isSelected ? 'var(--kfh-green)' : 'inherit' }}>
                              {item.serial_number}
                            </strong>
                          </td>
                          <td>
                            {item.denomination || `${item.weight_grams}g Bar`}
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                              ({item.weight_grams}g)
                            </span>
                          </td>
                          <td>{item.refiner_name || item.brand_name || 'Nadir Gold'}</td>
                          <td>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {item.location_code}
                            </span>
                          </td>
                          <td>
                            <span className="badge" style={{ background: 'rgba(225, 29, 72, 0.12)', color: '#E11D48', border: '1px solid rgba(225, 29, 72, 0.3)' }}>
                              🇹🇷 TURKEY_OWNED
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
              <span>{filteredItems.length} {currentLang === 'en' ? 'bars displayed' : 'سبيكة معروضة'}</span>
              <span>{selectedSerials.length} {currentLang === 'en' ? 'bars selected' : 'سبيكة محددة'}</span>
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
                <strong>{selectedItemsData.count} {currentLang === 'en' ? 'units' : 'قطعة'}</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Total Weight (g):' : 'الوزن الإجمالي (جرام):'}</span>
                <strong>{selectedItemsData.totalWeightGrams.toLocaleString()} g</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Total Weight (kg):' : 'الوزن الإجمالي (كجم):'}</span>
                <strong>{selectedItemsData.totalWeightKg} KG</strong>
              </div>
            </div>

            {/* Agreed Unit Price per gram input (Mandatory) */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
                <span>{currentLang === 'en' ? 'Agreed Purchase Rate (KWD / gram)' : 'سعر شراء الجرام المتفق عليه (دينار / جرام)'}</span>
                <span style={{ color: 'var(--accent-red)' }}>*</span>
              </label>
              <input
                type="number"
                step="0.001"
                min="0.001"
                className="form-control"
                placeholder={currentLang === 'en' ? 'Enter rate e.g. 24.500' : 'أدخل السعر مثلاً 24.500'}
                value={unitPricePerGram}
                onChange={e => setUnitPricePerGram(e.target.value)}
                disabled={!canModify}
                style={{ fontSize: '14px', fontWeight: 'bold' }}
                required
              />
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                <i className="fa-solid fa-asterisk" style={{ color: 'var(--accent-red)', fontSize: '8px' }}></i>{' '}
                {currentLang === 'en' 
                  ? 'Mandatory: Enter the exact agreed purchase rate per gram.' 
                  : 'إلزامي: أدخل سعر الشراء المتفق عليه للجرام.'}
              </div>
            </div>

            {/* Notes */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Notes / Purpose' : 'ملاحظات / غرض الشراء'}</label>
              <textarea
                rows={2}
                className="form-control"
                placeholder={currentLang === 'en' ? 'e.g. Consignment conversion for customer retail demand' : 'مثال: تحويل ملكية أمانة تركيا لتلبية مبيعات الفروع'}
                value={purchaseNotes}
                onChange={e => setPurchaseNotes(e.target.value)}
                disabled={!canModify}
                style={{ fontSize: '12px' }}
              />
            </div>

            {/* Selected Serials Badge Preview */}
            {selectedItemsData.items.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                  {currentLang === 'en' ? 'Selected Serials Preview:' : 'معاينة الأرقام المحددة:'}
                </label>
                <div style={{ maxHeight: '110px', overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '6px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid var(--surface-border)' }}>
                  {selectedItemsData.items.map(i => (
                    <span
                      key={i.serial_number}
                      style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        background: 'rgba(0, 155, 78, 0.15)',
                        border: '1px solid var(--kfh-green)',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      {i.serial_number}
                      <span
                        onClick={() => handleToggleItem(i.serial_number)}
                        style={{ cursor: 'pointer', color: 'var(--accent-red)' }}
                      >
                        &times;
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Submit Button */}
            {canModify ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={selectedSerials.length === 0 || isSubmitting}
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
                  <th>{currentLang === 'en' ? 'Unit Price' : 'سعر الجرام'}</th>
                  <th>{currentLang === 'en' ? 'Total Cost (KWD)' : 'إجمالي القيمة'}</th>
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
                        <td>{p.unit_price} KWD</td>
                        <td><strong style={{ color: 'var(--kfh-green)' }}>{(p.total_cost || 0).toLocaleString()} KWD</strong></td>
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

      {/* SMART SELECTION & SCANNER MODAL (RANGE, BULK PASTE, OCR) */}
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
                {currentLang === 'en' ? 'Turkey Stock Smart Tools & Scanner' : 'أدوات تحديد مخزون تركيا والماسح الضوئي'}
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

            {/* Navigation Tabs */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--surface-border)', paddingBottom: '10px', marginBottom: '16px' }}>
              <button
                type="button"
                className={`btn ${smartTab === 'RANGE' ? 'btn-primary' : ''}`}
                style={smartTab !== 'RANGE' ? { background: 'transparent' } : {}}
                onClick={() => setSmartTab('RANGE')}
              >
                <i className="fa-solid fa-arrow-down-1-9"></i> {currentLang === 'en' ? 'Range Selection' : 'تحديد نطاق متسلسل'}
              </button>
              <button
                type="button"
                className={`btn ${smartTab === 'PASTE' ? 'btn-primary' : ''}`}
                style={smartTab !== 'PASTE' ? { background: 'transparent' } : {}}
                onClick={() => setSmartTab('PASTE')}
              >
                <i className="fa-solid fa-paste"></i> {currentLang === 'en' ? 'Bulk Paste List' : 'لصق قائمة أرقام'}
              </button>
              <button
                type="button"
                className={`btn ${smartTab === 'OCR' ? 'btn-primary' : ''}`}
                style={smartTab !== 'OCR' ? { background: 'transparent' } : {}}
                onClick={() => setSmartTab('OCR')}
              >
                <i className="fa-solid fa-camera"></i> {currentLang === 'en' ? 'OCR Camera & Image' : 'الماسح الضوئي والكاميرا (OCR)'}
              </button>
            </div>

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
                  <button type="button" className="btn btn-primary" onClick={handleApplyRangeSelect}>
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
                    ? 'Scan physical gold bar serial engraving (e.g. B00570) using device camera or by uploading a photo.' 
                    : 'مسح وقراءة الرقم التسلسلي المحفور على السبيكة (مثل B00570) بالكاميرا أو بتحميل صورة.'}
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
                  <th>{currentLang === 'en' ? 'Unit Price' : 'سعر الجرام'}</th>
                  <th>{currentLang === 'en' ? 'Total Cost (KWD)' : 'إجمالي القيمة'}</th>
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
                        <td>{p.unit_price} KWD</td>
                        <td><strong style={{ color: 'var(--kfh-green)' }}>{(p.total_cost || 0).toLocaleString()} KWD</strong></td>
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

    </div>
  );
};
