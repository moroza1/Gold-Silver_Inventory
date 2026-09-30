import React, { useState, useEffect } from 'react';

export interface GeneratedSerialItem {
  serial: string;
  product_id: number;
  weight_grams: number;
  purity: number;
  refiner_name: string;
}

export const getSupplierAffiliatedBrands = (
  vendorId?: number,
  suppliers: any[] = [],
  brands: any[] = []
): any[] => {
  if (!vendorId || suppliers.length === 0 || brands.length === 0) return brands;
  const vendor = suppliers.find((v: any) => v.vendor_id === vendorId);
  if (!vendor) return brands;

  const vName = (vendor.name || vendor.vendor_name || '').toLowerCase();
  const vCode = (vendor.code || vendor.vendor_code || '').toLowerCase();
  const vCountry = (vendor.country || vendor.country_of_origin || '').toLowerCase();

  const matching = brands.filter((b: any) => {
    const bName = (b.brand_name || '').toLowerCase();
    const bCode = (b.brand_code || '').toLowerCase();
    const bCountry = (b.country_of_origin || '').toLowerCase();

    // Direct name or code match
    if (bName.includes(vName) || vName.includes(bName) || (bCode && vCode && bCode === vCode)) return true;

    // Known vendor affiliations & country matches
    if (vName.includes('nadir') || vCode.includes('nad') || vCountry.includes('turk')) {
      return bCountry.includes('turk') || bName.includes('nadir') || bName.includes('igr') || bCode.includes('nad') || bCode.includes('igr');
    }
    if (vName.includes('valcambi') || vCode.includes('val') || vCountry.includes('switz')) {
      return bCountry.includes('switz') || bName.includes('valcambi') || bName.includes('pamp') || bName.includes('argor') || bCode.includes('val') || bCode.includes('pamp') || bCode.includes('arg');
    }
    if (vName.includes('emirates') || vCountry.includes('emirates') || vCountry.includes('uae')) {
      return bCountry.includes('emirates') || bCountry.includes('uae') || bName.includes('emirates');
    }
    if (vName.includes('perth') || vCountry.includes('australia')) {
      return bCountry.includes('australia') || bName.includes('perth');
    }
    if (vName.includes('kfh') || vCountry.includes('kwt') || vCountry.includes('kuwait')) {
      return bCountry.includes('kuwait') || bName.includes('kfh');
    }

    // Generic country match
    if (vCountry && bCountry && (vCountry === bCountry || bCountry.includes(vCountry) || vCountry.includes(bCountry))) {
      return true;
    }

    return false;
  });

  return matching.length > 0 ? matching : brands;
};

interface ExistingSerialDetail {
  serial: string;
  source: 'table' | 'inventory' | 'pending' | 'existing';
  ref?: string;
}

interface SerialToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSerials: (items: GeneratedSerialItem[], purchasingCost?: number) => void;
  products: any[];
  brands: any[];
  suppliers?: any[];
  selectedVendorId?: number;
  currentLang: string;
  existingSerials?: (string | ExistingSerialDetail)[];
  denominationPurchasingCosts?: { [productId: number]: number };
  onUpdatePurchasingCost?: (productId: number, cost: number) => void;
}

export const SerialToolsModal: React.FC<SerialToolsModalProps> = ({
  isOpen,
  onClose,
  onAddSerials,
  products,
  brands,
  suppliers = [],
  selectedVendorId,
  currentLang,
  existingSerials = [],
  denominationPurchasingCosts = {},
  onUpdatePurchasingCost
}) => {
  // Range generator state
  const [prefix, setPrefix] = useState('TR-2026-');
  const [startNum, setStartNum] = useState('1');
  const [endNum, setEndNum] = useState('50');
  const [padLength, setPadLength] = useState(4);
  const [usePadding, setUsePadding] = useState(true);
  const [selectedProductId, setSelectedProductId] = useState<number>(products[0]?.product_id || 1);
  const [selectedBrandName, setSelectedBrandName] = useState<string>(brands[0]?.brand_name || 'Nadir Gold Refinery');
  const [purchasingCost, setPurchasingCost] = useState<string>('');
  const [showAllBrands, setShowAllBrands] = useState<boolean>(false);

  const currentVendor = (suppliers || []).find((v: any) => v.vendor_id === selectedVendorId);
  const affiliatedBrands = getSupplierAffiliatedBrands(selectedVendorId, suppliers, brands);
  const displayedBrands = showAllBrands ? brands : affiliatedBrands;

  useEffect(() => {
    if (isOpen) {
      setShowAllBrands(false);
      const aff = getSupplierAffiliatedBrands(selectedVendorId, suppliers, brands);
      if (aff.length > 0) {
        const bestMatch = aff[0]?.brand_name;
        if (bestMatch) {
          setSelectedBrandName(bestMatch);
          const lower = bestMatch.toLowerCase();
          if (lower.includes('nadir')) setPrefix('TR-2026-');
          else if (lower.includes('valcambi')) setPrefix('VAL-');
          else if (lower.includes('pamp')) setPrefix('PAMP-');
          else if (lower.includes('argor')) setPrefix('ARG-');
          else if (lower.includes('igr')) setPrefix('IGR-');
          else if (lower.includes('emirates')) setPrefix('EG-');
          else if (lower.includes('perth')) setPrefix('PM-');
          else if (lower.includes('kfh')) setPrefix('KFH-');
        }
      }
    }
  }, [isOpen, selectedVendorId, suppliers, brands]);

  useEffect(() => {
    if (products.length > 0 && !selectedProductId) {
      setSelectedProductId(products[0].product_id);
    }
  }, [products]);

  useEffect(() => {
    if (selectedProductId && denominationPurchasingCosts) {
      const existing = denominationPurchasingCosts[selectedProductId];
      if (existing !== undefined && existing !== null && !isNaN(existing)) {
        setPurchasingCost(String(existing));
      } else {
        setPurchasingCost('');
      }
    }
  }, [selectedProductId, denominationPurchasingCosts, isOpen]);

  if (!isOpen) return null;

  const currentProduct = products.find(p => p.product_id === selectedProductId) || products[0];
  const weightGrams = currentProduct?.weight_grams || 1000;

  const start = parseInt(startNum);
  const end = endNum.trim() !== '' ? parseInt(endNum) : start;
  const isValidRange = !isNaN(start) && !isNaN(end) && start <= end && (end - start + 1) <= 5000;
  const count = isValidRange ? end - start + 1 : 0;
  const totalWeightGrams = count * weightGrams;
  const totalWeightKg = Math.round((totalWeightGrams / 1000) * 1000) / 1000;
  const parsedCost = parseFloat(purchasingCost) || 0;
  const isValidCost = purchasingCost.trim() !== '' && !isNaN(parsedCost) && parsedCost > 0;
  const totalCost = count * parsedCost;

  // Generate Sample Preview
  const sampleSerials: string[] = [];
  if (isValidRange) {
    if (count <= 6) {
      for (let i = start; i <= end; i++) {
        const numStr = usePadding ? String(i).padStart(padLength, '0') : String(i);
        sampleSerials.push(`${prefix.trim()}${numStr}`);
      }
    } else {
      for (let i = start; i <= start + 2; i++) {
        const numStr = usePadding ? String(i).padStart(padLength, '0') : String(i);
        sampleSerials.push(`${prefix.trim()}${numStr}`);
      }
      sampleSerials.push('...');
      for (let i = end - 2; i <= end; i++) {
        const numStr = usePadding ? String(i).padStart(padLength, '0') : String(i);
        sampleSerials.push(`${prefix.trim()}${numStr}`);
      }
    }
  }

  const handleGenerateRange = () => {
    if (!isValidRange) {
      alert(currentLang === 'en' ? 'Please enter a valid Start and End serial number.' : 'يرجى إدخال رقم بداية ونهاية صالحين.');
      return;
    }

    if (!isValidCost) {
      alert(currentLang === 'en'
        ? 'Please enter a valid Production Cost / Value (must be greater than 0) before submitting.'
        : 'يرجى إدخال تكلفة إنتاج / قيمة صالحة (يجب أن تكون أكبر من 0) قبل الإضافة.');
      return;
    }

    const existingMap = new Map<string, { source: string; ref?: string }>();
    (existingSerials || []).forEach(item => {
      if (typeof item === 'string') {
        const trimmed = item.trim().toUpperCase();
        if (trimmed) existingMap.set(trimmed, { source: 'existing' });
      } else if (item && item.serial) {
        const trimmed = item.serial.trim().toUpperCase();
        if (trimmed) existingMap.set(trimmed, { source: item.source || 'existing', ref: item.ref });
      }
    });

    // Resolve matching product based on selected denomination weight and selected brand origin
    const selectedBrand = (brands || []).find((b: any) => b.brand_name === selectedBrandName);
    const bNameLower = (selectedBrandName || '').toLowerCase();
    const bCountryLower = (selectedBrand?.country_of_origin || '').toLowerCase();
    const isTurkishBrand = bNameLower.includes('nadir') || bNameLower.includes('igr') || bNameLower.includes('istanbul') || bNameLower.includes('turk') || bNameLower.includes('kuveyt') || bNameLower.includes('ahlatci') || bCountryLower.includes('turk') || prefix.toUpperCase().startsWith('TR-');
    
    let targetProductId = selectedProductId;
    if (isTurkishBrand) {
      const turkeyProd = products.find((p: any) => (p.weight_grams === weightGrams || p.denomination_weight === weightGrams) && (p.origin_country === 'Turkey' || p.product_code?.includes('TURK') || p.origin === 'Turkey'));
      if (turkeyProd) targetProductId = turkeyProd.product_id;
    } else {
      const swissProd = products.find((p: any) => (p.weight_grams === weightGrams || p.denomination_weight === weightGrams) && (p.origin_country === 'Switzerland' || p.product_code?.includes('SWISS') || p.origin === 'Switzerland'));
      if (swissProd) targetProductId = swissProd.product_id;
    }

    const generatedSet = new Set<string>();
    const items: GeneratedSerialItem[] = [];

    for (let i = start; i <= end; i++) {
      const numStr = usePadding ? String(i).padStart(padLength, '0') : String(i);
      const serial = `${prefix.trim()}${numStr}`;
      const upperSerial = serial.trim().toUpperCase();

      if (generatedSet.has(upperSerial)) {
        alert(currentLang === 'en'
          ? `Duplicate serial number detected in generated range: "${serial}".`
          : `تم اكتشاف تكرار للرقم التسلسلي في النطاق المُولّد: "${serial}".`);
        return;
      }
      generatedSet.add(upperSerial);

      const dup = existingMap.get(upperSerial);
      if (dup) {
        let reason = '';
        if (dup.source === 'table') {
          reason = currentLang === 'en'
            ? `is already listed in the current manifest table on your screen. Click "Remove All" or delete that row first.`
            : `موجود بالفعل في جدول كشف الشحنة على شاشتك. اضغط "حذف الكل" أو احذف السطر أولاً.`;
        } else if (dup.source === 'pending') {
          reason = currentLang === 'en'
            ? `is already part of an in-flight pending intake request ${dup.ref ? `(Ref: ${dup.ref})` : ''} awaiting Checker approval.`
            : `مسجل في طلب شحنة قيد الاعتماد ${dup.ref ? `(المرجع: ${dup.ref})` : ''} بانتظار موافقة المدقق.`;
        } else if (dup.source === 'inventory') {
          reason = currentLang === 'en'
            ? `already exists in active vault inventory.`
            : `مسجل بالفعل في مخزون الخزينة النشط.`;
        } else {
          reason = currentLang === 'en'
            ? `already exists in shipment manifest / records.`
            : `موجود بالفعل في كشف الشحنة أو السجلات.`;
        }

        alert(currentLang === 'en'
          ? `Cannot add range: Serial number "${serial}" ${reason}`
          : `لا يمكن إضافة النطاق: الرقم التسلسلي "${serial}" ${reason}`);
        return;
      }

      items.push({
        serial,
        product_id: targetProductId,
        weight_grams: weightGrams,
        purity: 999.9,
        refiner_name: selectedBrandName
      });
    }

    const costNum = parsedCost;
    if (onUpdatePurchasingCost) {
      onUpdatePurchasingCost(targetProductId, costNum);
    }

    onAddSerials(items, costNum);
    onClose();
  };

  return (
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
      <div className="glass-card" style={{ width: '100%', maxWidth: '760px', maxHeight: '92vh', overflowY: 'auto', padding: '24px', position: 'relative' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-border)', paddingBottom: '12px', marginBottom: '18px' }}>
          <h3 style={{ margin: 0, color: 'var(--kfh-green)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '17px' }}>
            <i className="fa-solid fa-layer-group"></i>
            {currentLang === 'en' ? 'Add Serial Numbers & Denomination' : 'إضافة أرقام تسلسلية وبيانات الفئة'}
          </h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
            {currentLang === 'en'
              ? 'Enter serial numbers, select denomination, refiner brand, and set the production cost for this denomination.'
              : 'أدخل الأرقام التسلسلية، واختر الفئة والمصفاة، وحدد تكلفة الإنتاج المخصصة لهذه الفئة.'}
          </p>

          {/* Form Fields */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            
            {/* Column 1: Serial Specification */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Serial Prefix' : 'بادئة الرقم التسلسلي'}</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. TR-2026- or VAL-"
                  value={prefix}
                  onChange={e => setPrefix(e.target.value)}
                  style={{ fontSize: '13px', fontWeight: 'bold' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Start Number' : 'رقم البداية'}</label>
                  <input
                    type="number"
                    className="form-control"
                    min="1"
                    placeholder="1"
                    value={startNum}
                    onChange={e => setStartNum(e.target.value)}
                    style={{ fontSize: '13px' }}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'End Number' : 'رقم النهاية'}</label>
                  <input
                    type="number"
                    className="form-control"
                    min="1"
                    placeholder="50"
                    value={endNum}
                    onChange={e => setEndNum(e.target.value)}
                    style={{ fontSize: '13px' }}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid var(--surface-border)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={usePadding}
                    onChange={e => setUsePadding(e.target.checked)}
                  />
                  {currentLang === 'en' ? 'Zero Padding (e.g. 0001)' : 'تنسيق الخانات بأصفار (مثل 0001)'}
                </label>
                {usePadding && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Digits:' : 'عدد الخانات:'}</span>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={padLength}
                      onChange={e => setPadLength(parseInt(e.target.value) || 4)}
                      style={{ width: '60px', padding: '2px 6px', fontSize: '12px' }}
                      className="form-control"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Column 2: Metal / Product Specification & Purchasing Value */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Product / Denomination' : 'نوع المنتج / الفئة'}</label>
                <select
                  className="form-control"
                  value={selectedProductId}
                  onChange={e => setSelectedProductId(parseInt(e.target.value))}
                  style={{ fontSize: '12px', width: '100%' }}
                >
                  {products.map((p: any) => (
                    <option key={p.product_id} value={p.product_id}>
                      {p.metal_name} {p.denomination_label} ({p.weight_grams}g)
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px', flexWrap: 'wrap', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                    <span>{currentLang === 'en' ? 'Refiner / Brand' : 'المصفاة / الماركة'}</span>
                    {currentVendor && !showAllBrands && (
                      <span style={{ fontSize: '11px', color: 'var(--kfh-green)', fontWeight: 'bold' }}>
                        ({currentVendor.name || currentVendor.vendor_name})
                      </span>
                    )}
                  </label>
                  {affiliatedBrands.length < brands.length && (
                    <button
                      type="button"
                      onClick={() => setShowAllBrands(!showAllBrands)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-gold)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        padding: 0,
                        textDecoration: 'underline',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {showAllBrands
                        ? (currentLang === 'en' ? 'Filter by Supplier' : 'فلترة حسب المورد')
                        : (currentLang === 'en' ? 'Show All' : 'عرض الكل')}
                    </button>
                  )}
                </div>
                <select
                  className="form-control"
                  value={selectedBrandName}
                  onChange={e => setSelectedBrandName(e.target.value)}
                  style={{ fontSize: '12px', width: '100%' }}
                >
                  {displayedBrands.map((b: any) => (
                    <option key={b.brand_id} value={b.brand_name}>
                      {b.brand_name} {b.is_lbma_certified ? '★ LBMA' : ''} {b.country_of_origin ? `(${b.country_of_origin})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Production Cost / Value per Denomination */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <i className="fa-solid fa-coins" style={{ color: 'var(--accent-gold)' }}></i>
                    {currentLang === 'en' ? 'Production Cost / Value (KWD)' : 'تكلفة الإنتاج للفئة (د.ك)'}
                  </span>
                  <span style={{ color: '#EF4444', fontWeight: 'bold' }}>*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    className="form-control"
                    placeholder={currentLang === 'en' ? 'e.g. 23500.000 (Required)' : 'مثال: 23500.000 (مطلوب)'}
                    value={purchasingCost}
                    onChange={e => setPurchasingCost(e.target.value)}
                    style={{
                      fontSize: '13px',
                      fontWeight: 'bold',
                      color: 'var(--kfh-green)',
                      borderColor: !isValidCost && purchasingCost.trim() !== '' ? '#EF4444' : undefined,
                      width: '100%'
                    }}
                  />
                </div>
                {!isValidCost ? (
                  <span style={{ fontSize: '11px', color: '#EF4444', marginTop: '4px', display: 'flex', alignItems: 'flex-start', gap: '6px', fontWeight: 600, lineHeight: 1.35, wordBreak: 'break-word' }}>
                    <i className="fa-solid fa-circle-exclamation" style={{ marginTop: '2px', flexShrink: 0 }}></i>
                    <span>{currentLang === 'en' ? 'Production cost > 0 is mandatory to add bars.' : 'تكلفة الإنتاج أكبر من 0 إلزامية لإضافة السبائك.'}</span>
                  </span>
                ) : (
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px', display: 'block', lineHeight: 1.35 }}>
                    {currentLang === 'en' ? 'Production cost per bar for this denomination in this shipment' : 'تكلفة الإنتاج للسبيكة الواحدة لهذه الفئة في هذه الشحنة'}
                  </span>
                )}
              </div>
            </div>

          </div>

          {/* Batch Summary Box */}
          {isValidRange && (
            <div style={{ backgroundColor: 'rgba(0, 155, 78, 0.08)', padding: '12px 16px', borderRadius: '8px', border: '1px solid rgba(0, 155, 78, 0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Total Bars:' : 'إجمالي السبائك:'}</span>&nbsp;
                  <strong style={{ fontSize: '15px', color: 'var(--kfh-green)' }}>{count} {currentLang === 'en' ? 'bars' : 'سبيكة'} ({totalWeightKg} KG)</strong>
                </div>
                {parsedCost > 0 && (
                  <div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Batch Cost:' : 'إجمالي تكلفة الدفعة:'}</span>&nbsp;
                    <strong style={{ fontSize: '15px', color: '#F59E0B' }}>{totalCost.toFixed(3)} KWD</strong>
                  </div>
                )}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                <span>{currentLang === 'en' ? 'Preview:' : 'معاينة:'}</span>
                {sampleSerials.map((s, idx) => (
                  <span key={idx} style={{ padding: '2px 6px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 'bold' }}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            <button type="button" className="btn" onClick={onClose}>
              {currentLang === 'en' ? 'Cancel' : 'إلغاء'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleGenerateRange}
              disabled={!isValidRange || !isValidCost}
              style={{
                padding: '8px 18px',
                fontSize: '13px',
                fontWeight: 'bold',
                opacity: (!isValidRange || !isValidCost) ? 0.5 : 1,
                cursor: (!isValidRange || !isValidCost) ? 'not-allowed' : 'pointer'
              }}
            >
              <i className="fa-solid fa-plus"></i> {count === 1
                ? (currentLang === 'en' ? 'Add 1 Bar to Manifest' : 'إضافة سبيكة واحدة إلى الكشف')
                : (currentLang === 'en' ? `Add ${count} Bars to Manifest` : `إضافة ${count} سبيكة إلى الكشف`)}
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};
