import React, { useState, useMemo } from 'react';

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
  goldRate: number; // USD per oz
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
  userRole,
  displayName
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'STOCK_PURCHASE' | 'PENDING_BATCHES'>('STOCK_PURCHASE');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterProduct, setFilterProduct] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  
  // Selection state
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  
  // Range selection tool state
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');

  // Purchase Order parameters
  // Convert goldRate (USD/oz) to KWD/gram approximate default: (goldRate / 31.1035) * 0.308
  const defaultKwdPerGram = useMemo(() => {
    return Math.round(((goldRate / 31.1035) * 0.308) * 100) / 100 || 22.50;
  }, [goldRate]);

  const [unitPricePerGram, setUnitPricePerGram] = useState<number>(defaultKwdPerGram);
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
    const totalCostKwd = Math.round(totalWeightGrams * unitPricePerGram * 100) / 100;
    return {
      items,
      count: items.length,
      totalWeightGrams,
      totalWeightKg,
      totalCostKwd
    };
  }, [availableItems, selectedSerials, unitPricePerGram]);

  // Handle Range Selection
  const handleApplyRangeSelect = () => {
    if (!rangeStart.trim() || !rangeEnd.trim()) {
      alert(currentLang === 'en' ? 'Please enter Start and End serial numbers.' : 'يرجى إدخال رقم البداية والنهاية.');
      return;
    }

    const start = rangeStart.trim().toUpperCase();
    const end = rangeEnd.trim().toUpperCase();

    // Match all available items whose serial falls lexicographically or sequentially within range
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
    if (unitPricePerGram <= 0) {
      alert(currentLang === 'en' ? 'Please specify a valid unit price per gram.' : 'يرجى إدخال سعر جرام صالح.');
      return;
    }

    setIsSubmitting(true);
    const success = await onSubmitPurchase(selectedSerials, unitPricePerGram, purchaseNotes);
    setIsSubmitting(false);

    if (success) {
      setSelectedSerials([]);
      setPurchaseNotes('');
      setActiveSubTab('PENDING_BATCHES');
      onRefresh();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 1. TOP HEADER SUMMARY & KPIS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        
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

        {/* KPI 3: Unit Price per gram */}
        <div className="glass-card" style={{ padding: '18px', borderLeft: '4px solid var(--accent-gold)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {currentLang === 'en' ? 'Settlement Unit Price' : 'سعر تسوية الشراء/جرام'}
              </div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', marginTop: '6px', color: 'var(--accent-gold)' }}>
                {unitPricePerGram.toFixed(2)} <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>KWD / g</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {currentLang === 'en' ? `Based on $${goldRate.toFixed(2)} / oz rate` : `بناءً على تسعير $${goldRate.toFixed(2)} للأونصة`}
              </div>
            </div>
            <div style={{ width: '42px', height: '42px', borderRadius: '8px', background: 'rgba(212, 160, 23, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', color: 'var(--accent-gold)' }}>
              <i className="fa-solid fa-coins"></i>
            </div>
          </div>
        </div>

        {/* KPI 4: Total Purchase Settlement */}
        <div className="glass-card" style={{ padding: '18px', borderLeft: '4px solid #3B82F6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {currentLang === 'en' ? 'Total Settlement Cost' : 'إجمالي قيمة صفقة الشراء'}
              </div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', marginTop: '6px', color: '#3B82F6' }}>
                {selectedItemsData.totalCostKwd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>KWD</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {currentLang === 'en' ? 'Requires Checker 4-Eyes Approval' : 'يتطلب اعتماد مراجع الخزينة'}
              </div>
            </div>
            <div style={{ width: '42px', height: '42px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', color: '#3B82F6' }}>
              <i className="fa-solid fa-receipt"></i>
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
              <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--kfh-green)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <i className="fa-solid fa-filter-circle-dollar"></i>
                {currentLang === 'en' ? 'Quick Selection & Range Filter:' : 'التحديد السريع واختيار النطاق:'}
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
                    {currentLang === 'en' ? 'Select All Filtered' : 'تحديد كل المفلتر'}
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
                    <th>{currentLang === 'en' ? 'Purity' : 'النقاوة'}</th>
                    <th>{currentLang === 'en' ? 'Refiner / Brand' : 'المصفاة'}</th>
                    <th>{currentLang === 'en' ? 'Vault Location' : 'موقع الخزينة'}</th>
                    <th>{currentLang === 'en' ? 'Ownership' : 'الملكية'}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
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
                          <td>{item.fineness_ppt || item.purity || '999.9'}</td>
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

            {/* Unit Price per gram input */}
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>
                {currentLang === 'en' ? 'Purchase Price (KWD / gram)' : 'سعر الشراء (دينار / جرام)'}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="form-control"
                value={unitPricePerGram}
                onChange={e => setUnitPricePerGram(parseFloat(e.target.value) || 0)}
                disabled={!canModify}
                style={{ fontSize: '14px', fontWeight: 'bold' }}
              />
            </div>

            {/* Total Cost Display */}
            <div style={{ backgroundColor: 'rgba(0, 155, 78, 0.08)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(0, 155, 78, 0.25)', marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{currentLang === 'en' ? 'Total Settlement Amount:' : 'إجمالي مبلغ الشراء المطلوب:'}</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--kfh-green)', marginTop: '4px' }}>
                {selectedItemsData.totalCostKwd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KWD
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

    </div>
  );
};
