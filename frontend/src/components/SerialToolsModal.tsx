import React, { useState, useEffect } from 'react';

export interface GeneratedSerialItem {
  serial: string;
  product_id: number;
  weight_grams: number;
  purity: number;
  refiner_name: string;
}

interface SerialToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSerials: (items: GeneratedSerialItem[], purchasingCost?: number) => void;
  products: any[];
  brands: any[];
  currentLang: string;
  existingSerials?: string[];
  denominationPurchasingCosts?: { [productId: number]: number };
  onUpdatePurchasingCost?: (productId: number, cost: number) => void;
}

export const SerialToolsModal: React.FC<SerialToolsModalProps> = ({
  isOpen,
  onClose,
  onAddSerials,
  products,
  brands,
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
        ? 'Please enter a valid Purchasing Cost / Value (must be greater than 0) before submitting.'
        : 'يرجى إدخال تكلفة شراء / قيمة صالحة (يجب أن تكون أكبر من 0) قبل الإضافة.');
      return;
    }

    const existingSet = new Set((existingSerials || []).map(s => s.trim().toUpperCase()));
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

      if (existingSet.has(upperSerial)) {
        alert(currentLang === 'en'
          ? `Cannot add range: Serial number "${serial}" already exists in the shipment manifest. Duplicate serial numbers are not allowed across all products.`
          : `لا يمكن إضافة النطاق: الرقم التسلسلي "${serial}" موجود بالفعل في كشف الشحنة. لا يُسمح بتكرار الأرقام التسلسلية لأي فئة.`);
        return;
      }

      items.push({
        serial,
        product_id: selectedProductId,
        weight_grams: weightGrams,
        purity: 999.9,
        refiner_name: selectedBrandName
      });
    }

    const costNum = parsedCost;
    if (onUpdatePurchasingCost) {
      onUpdatePurchasingCost(selectedProductId, costNum);
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
      <div className="glass-card" style={{ width: '100%', maxWidth: '600px', padding: '24px', position: 'relative' }}>
        
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
              ? 'Enter serial numbers, select denomination, refiner brand, and set the purchasing cost for this denomination.'
              : 'أدخل الأرقام التسلسلية، واختر الفئة والمصفاة، وحدد تكلفة الشراء المخصصة لهذه الفئة.'}
          </p>

          {/* Form Fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            
            {/* Column 1: Serial Specification */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Product / Denomination' : 'نوع المنتج / الفئة'}</label>
                <select
                  className="form-control"
                  value={selectedProductId}
                  onChange={e => setSelectedProductId(parseInt(e.target.value))}
                  style={{ fontSize: '12px' }}
                >
                  {products.map((p: any) => (
                    <option key={p.product_id} value={p.product_id}>
                      {p.metal_name} {p.denomination_label} ({p.weight_grams}g)
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Refiner / Brand' : 'المصفاة / الماركة'}</label>
                <select
                  className="form-control"
                  value={selectedBrandName}
                  onChange={e => setSelectedBrandName(e.target.value)}
                  style={{ fontSize: '12px' }}
                >
                  {brands.map((b: any) => (
                    <option key={b.brand_id} value={b.brand_name}>
                      {b.brand_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Purchasing Cost / Value per Denomination */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <i className="fa-solid fa-coins" style={{ color: 'var(--accent-gold)' }}></i>
                  {currentLang === 'en' ? 'Purchasing Cost / Value (KWD)' : 'تكلفة الشراء للفئة (د.ك)'}
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
                      borderColor: !isValidCost && purchasingCost.trim() !== '' ? '#EF4444' : undefined
                    }}
                  />
                </div>
                {!isValidCost ? (
                  <span style={{ fontSize: '11px', color: '#EF4444', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                    <i className="fa-solid fa-circle-exclamation"></i>
                    {currentLang === 'en' ? 'Purchasing cost > 0 is mandatory to add bars.' : 'تكلفة الشراء أكبر من 0 إلزامية لإضافة السبائك.'}
                  </span>
                ) : (
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px', display: 'block' }}>
                    {currentLang === 'en' ? 'Cost per bar for this denomination in this shipment' : 'تكلفة السبيكة الواحدة لهذه الفئة في هذه الشحنة'}
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
