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
  onAddSerials: (items: GeneratedSerialItem[]) => void;
  products: any[];
  brands: any[];
  currentLang: string;
}

export const SerialToolsModal: React.FC<SerialToolsModalProps> = ({
  isOpen,
  onClose,
  onAddSerials,
  products,
  brands,
  currentLang
}) => {
  // Range generator state
  const [prefix, setPrefix] = useState('TR-2026-');
  const [startNum, setStartNum] = useState('1');
  const [endNum, setEndNum] = useState('50');
  const [padLength, setPadLength] = useState(4);
  const [usePadding, setUsePadding] = useState(true);
  const [selectedProductId, setSelectedProductId] = useState<number>(products[0]?.product_id || 1);
  const [selectedBrandName, setSelectedBrandName] = useState<string>(brands[0]?.brand_name || 'Nadir Gold Refinery');

  useEffect(() => {
    if (products.length > 0 && !selectedProductId) {
      setSelectedProductId(products[0].product_id);
    }
  }, [products]);

  if (!isOpen) return null;

  const currentProduct = products.find(p => p.product_id === selectedProductId) || products[0];
  const weightGrams = currentProduct?.weight_grams || 1000;

  const start = parseInt(startNum);
  const end = parseInt(endNum);
  const isValidRange = !isNaN(start) && !isNaN(end) && start <= end && (end - start + 1) <= 5000;
  const count = isValidRange ? end - start + 1 : 0;
  const totalWeightGrams = count * weightGrams;
  const totalWeightKg = Math.round((totalWeightGrams / 1000) * 1000) / 1000;

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

    const items: GeneratedSerialItem[] = [];
    for (let i = start; i <= end; i++) {
      const numStr = usePadding ? String(i).padStart(padLength, '0') : String(i);
      const serial = `${prefix.trim()}${numStr}`;
      items.push({
        serial,
        product_id: selectedProductId,
        weight_grams: weightGrams,
        purity: 999.9,
        refiner_name: selectedBrandName
      });
    }

    onAddSerials(items);
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
      <div className="glass-card" style={{ width: '100%', maxWidth: '580px', padding: '24px', position: 'relative' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-border)', paddingBottom: '12px', marginBottom: '18px' }}>
          <h3 style={{ margin: 0, color: 'var(--kfh-green)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '17px' }}>
            <i className="fa-solid fa-arrow-down-1-9"></i>
            {currentLang === 'en' ? 'Add Serial Number Range' : 'إضافة نطاق أرقام تسلسلية'}
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
              ? 'Quickly generate a contiguous sequential batch of gold bars for the shipment manifest.'
              : 'توليد كشف متسلسل من السبائك الذهبية لإضافتها لكشف الشحنة المستلمة.'}
          </p>

          {/* Form Fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            
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

            <div className="form-group" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
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

          {/* Batch Summary Box */}
          {isValidRange && (
            <div style={{ backgroundColor: 'rgba(0, 155, 78, 0.08)', padding: '12px 16px', borderRadius: '8px', border: '1px solid rgba(0, 155, 78, 0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Total Bars to Add:' : 'إجمالي السبائك للتوليد:'}</span>
                <strong style={{ fontSize: '15px', color: 'var(--kfh-green)' }}>{count} {currentLang === 'en' ? 'bars' : 'سبيكة'} ({totalWeightKg} KG)</strong>
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
              disabled={!isValidRange}
              style={{ padding: '8px 18px', fontSize: '13px', fontWeight: 'bold' }}
            >
              <i className="fa-solid fa-plus"></i> {currentLang === 'en' ? `Add ${count} Bars to Manifest` : `إضافة ${count} سبيكة إلى الكشف`}
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};
