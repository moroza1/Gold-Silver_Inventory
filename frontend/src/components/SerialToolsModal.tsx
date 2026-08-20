import React, { useState, useRef, useEffect } from 'react';
import Tesseract from 'tesseract.js';

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
  const [activeTab, setActiveTab] = useState<'RANGE' | 'PASTE' | 'OCR'>('RANGE');

  // Range generator state
  const [prefix, setPrefix] = useState('TR-2026-');
  const [startNum, setStartNum] = useState('1');
  const [endNum, setEndNum] = useState('50');
  const [padLength, setPadLength] = useState(4);
  const [usePadding, setUsePadding] = useState(true);
  const [selectedProductId, setSelectedProductId] = useState<number>(products[0]?.product_id || 1);
  const [selectedBrandName, setSelectedBrandName] = useState<string>(brands[0]?.brand_name || 'Nadir Gold Refinery');
  const [purityVal, setPurityVal] = useState<number>(999.9);

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

  useEffect(() => {
    if (products.length > 0 && !selectedProductId) {
      setSelectedProductId(products[0].product_id);
    }
  }, [products]);

  useEffect(() => {
    if (!isOpen && cameraActive) {
      stopCamera();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentProduct = products.find(p => p.product_id === selectedProductId) || products[0];
  const weightGrams = currentProduct?.weight_grams || 1000;

  // 1. Generate Range
  const handleGenerateRange = () => {
    const start = parseInt(startNum);
    const end = parseInt(endNum);

    if (isNaN(start) || isNaN(end) || start > end) {
      alert(currentLang === 'en' ? 'Please enter a valid Start and End serial number.' : 'يرجى إدخال رقم بداية ونهاية صالحين.');
      return;
    }

    const count = end - start + 1;
    if (count > 5000) {
      alert(currentLang === 'en' ? 'Maximum range expansion is 5,000 items at a time.' : 'الحد الأقصى لتوليد النطاق هو 5000 سبيكة دفعة واحدة.');
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
        purity: purityVal,
        refiner_name: selectedBrandName
      });
    }

    onAddSerials(items);
    onClose();
  };

  // 2. Parse Paste
  const handleParsePaste = () => {
    if (!pasteText.trim()) return;

    // Split by newlines, commas, or semicolons
    const rawTokens = pasteText.split(/[\r\n,;]+/).map(s => s.trim()).filter(Boolean);
    const items: GeneratedSerialItem[] = rawTokens.map(serial => ({
      serial: serial.toUpperCase(),
      product_id: selectedProductId,
      weight_grams: weightGrams,
      purity: purityVal,
      refiner_name: selectedBrandName
    }));

    onAddSerials(items);
    onClose();
  };

  // 3. OCR Camera & Recognition
  const startCamera = async () => {
    try {
      setCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err) {
      console.error('Camera access error', err);
      alert(currentLang === 'en' ? 'Unable to access camera. Please upload an image instead.' : 'تعذر الوصول إلى الكاميرا. يرجى رفع صورة بدلاً من ذلك.');
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

  const captureCameraSnapshot = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      setOcrImage(dataUrl);
      stopCamera();
      processOcrImage(dataUrl);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        setOcrImage(dataUrl);
        processOcrImage(dataUrl);
      };
      reader.readAsDataURL(file);
    }
  };

  const processOcrImage = async (imageSrc: string) => {
    try {
      setOcrLoading(true);
      setOcrProgress(0);
      setOcrStatusText(currentLang === 'en' ? 'Initializing OCR engine...' : 'تهيئة محرك التعرف الضوئي...');

      const result = await Tesseract.recognize(imageSrc, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setOcrProgress(Math.round(m.progress * 100));
            setOcrStatusText(currentLang === 'en' ? `Recognizing text (${Math.round(m.progress * 100)}%)...` : `جاري قراءة النصوص (${Math.round(m.progress * 100)}%)...`);
          }
        }
      });

      const fullText = result.data.text;
      
      // Regex to find potential serial patterns (e.g. TR-2026-001, BAR12345, 999901, etc.)
      const lines = fullText.split(/[\r\n]+/);
      const foundSerials = new Set<string>();

      lines.forEach(line => {
        // Extract words matching typical bar serial formats (alphanumeric + dashes, 4-20 chars)
        const matches = line.match(/\b(?:[A-Z]{1,6}[-_]?)?[0-9A-Z]{4,20}\b/gi);
        if (matches) {
          matches.forEach(m => {
            const clean = m.trim().toUpperCase();
            // Filter out common noise words
            if (!['GOLD', 'SILVER', 'PURITY', 'WEIGHT', 'GRAMS', 'REFINER', 'NADIR', 'VALCAMBI', 'SWISS', 'TURKEY', 'ASSAY', 'CERTIFICATE'].includes(clean)) {
              if (clean.length >= 4) {
                foundSerials.add(clean);
              }
            }
          });
        }
      });

      const serialsArray = Array.from(foundSerials).map(serial => ({ serial, selected: true }));
      setExtractedSerials(serialsArray);

      if (serialsArray.length === 0) {
        setOcrStatusText(currentLang === 'en' ? 'No serials recognized. Try taking a closer, clearer photo.' : 'لم يتم التعرف على أرقام تسلسلية. حاول التقاط صورة أوضح وأقرب.');
      } else {
        setOcrStatusText(currentLang === 'en' ? `Successfully detected ${serialsArray.length} potential serial numbers!` : `تم التعرف بنجاح على ${serialsArray.length} أرقام تسلسلية!`);
      }
    } catch (err) {
      console.error('OCR Processing error', err);
      setOcrStatusText(currentLang === 'en' ? 'Error processing OCR image.' : 'حدث خطأ أثناء معالجة الصورة.');
    } finally {
      setOcrLoading(false);
    }
  };

  const handleApplyOcrSerials = () => {
    const selected = extractedSerials.filter(s => s.selected);
    if (selected.length === 0) {
      alert(currentLang === 'en' ? 'Please select at least one serial number.' : 'يرجى تحديد رقم تسلسلي واحد على الأقل.');
      return;
    }

    const items: GeneratedSerialItem[] = selected.map(s => ({
      serial: s.serial,
      product_id: selectedProductId,
      weight_grams: weightGrams,
      purity: purityVal,
      refiner_name: selectedBrandName
    }));

    onAddSerials(items);
    onClose();
  };

  return (
    <div className="modal-overlay active" onClick={onClose} style={{ zIndex: 10000 }}>
      <div
        className="glass-card modal-content-box"
        style={{ width: '700px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', borderBottom: '1px solid var(--surface-border)', paddingBottom: '12px' }}>
          <div>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="fa-solid fa-wand-magic-sparkles" style={{ color: 'var(--accent-gold)' }}></i>
              {currentLang === 'en' ? 'Smart Serial Ingestion & Range Tool' : 'أداة إضافة الأرقام التسلسلية الذكية والمسح الضوئي'}
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              {currentLang === 'en' 
                ? 'Generate consecutive serial ranges, paste bulk lists, or scan engraved serials via OCR camera.' 
                : 'توليد نطاقات الأرقام المتسلسلة للشحنات الكبيرة، اللصق الجماعي، أو القراءة بالكاميرا والتعرف الضوئي OCR.'}
            </p>
          </div>
          <span className="modal-close-btn" onClick={onClose} style={{ cursor: 'pointer', fontSize: '20px' }}>&times;</span>
        </div>

        {/* Top Common Configuration (Product, Refiner, Purity) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', backgroundColor: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px', marginBottom: '18px', border: '1px solid var(--surface-border)' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '11px', fontWeight: 600 }}>{currentLang === 'en' ? 'Product / Denomination' : 'نوع المنتج والفئة'}</label>
            <select
              className="form-control"
              value={selectedProductId}
              onChange={e => setSelectedProductId(parseInt(e.target.value))}
              style={{ fontSize: '12px', padding: '6px 8px' }}
            >
              {products.map(p => (
                <option key={p.product_id} value={p.product_id}>
                  {p.metal_name} {p.denomination_label} ({p.weight_grams}g)
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '11px', fontWeight: 600 }}>{currentLang === 'en' ? 'Refiner / Brand' : 'المصفاة / العلامة التجارية'}</label>
            <select
              className="form-control"
              value={selectedBrandName}
              onChange={e => setSelectedBrandName(e.target.value)}
              style={{ fontSize: '12px', padding: '6px 8px' }}
            >
              <option value="Nadir Gold Refinery">Nadir Gold Refinery (Turkey) ★ LBMA</option>
              <option value="Istanbul Gold Refinery">Istanbul Gold Refinery (Turkey) ★ LBMA</option>
              <option value="Valcambi Suisse">Valcambi Suisse ★ LBMA</option>
              <option value="PAMP Suisse">PAMP Suisse ★ LBMA</option>
              {brands.map(b => (
                <option key={b.brand_id} value={b.brand_name}>{b.brand_name}</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '11px', fontWeight: 600 }}>{currentLang === 'en' ? 'Purity (PPT)' : 'النقاوة'}</label>
            <input
              type="number"
              step="0.1"
              className="form-control"
              value={purityVal}
              onChange={e => setPurityVal(parseFloat(e.target.value) || 999.9)}
              style={{ fontSize: '12px', padding: '6px 8px' }}
            />
          </div>
        </div>

        {/* Mode Tabs */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--surface-border)', marginBottom: '18px' }}>
          <button
            type="button"
            className={`btn ${activeTab === 'RANGE' ? 'btn-primary' : ''}`}
            style={activeTab !== 'RANGE' ? { backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)' } : {}}
            onClick={() => setActiveTab('RANGE')}
          >
            <i className="fa-solid fa-arrow-down-1-9"></i> {currentLang === 'en' ? 'Consecutive Range (From - To)' : 'نطاق متسلسل (من - إلى)'}
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'PASTE' ? 'btn-primary' : ''}`}
            style={activeTab !== 'PASTE' ? { backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)' } : {}}
            onClick={() => setActiveTab('PASTE')}
          >
            <i className="fa-solid fa-paste"></i> {currentLang === 'en' ? 'Bulk Paste List' : 'لصق قائمة الأرقام'}
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'OCR' ? 'btn-primary' : ''}`}
            style={activeTab !== 'OCR' ? { backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)' } : {}}
            onClick={() => setActiveTab('OCR')}
          >
            <i className="fa-solid fa-camera"></i> {currentLang === 'en' ? 'OCR Camera Scanner' : 'مسح ضوئي بالكاميرا (OCR)'}
          </button>
        </div>

        {/* TAB 1: RANGE BUILDER */}
        {activeTab === 'RANGE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
              <div className="form-group">
                <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Prefix / Base' : 'البادئة / الرمز الثابت'}</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. TR-2026-"
                  value={prefix}
                  onChange={e => setPrefix(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Start Number (From)' : 'رقم البداية (من)'}</label>
                <input
                  type="number"
                  min="1"
                  className="form-control"
                  placeholder="1"
                  value={startNum}
                  onChange={e => setStartNum(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'End Number (To)' : 'رقم النهاية (إلى)'}</label>
                <input
                  type="number"
                  min="1"
                  className="form-control"
                  placeholder="50"
                  value={endNum}
                  onChange={e => setEndNum(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '12px', fontWeight: 600 }}>{currentLang === 'en' ? 'Zero Padding Digits' : 'عدد خانات الأصفار'}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    checked={usePadding}
                    onChange={e => setUsePadding(e.target.checked)}
                    id="chk-padding"
                  />
                  <input
                    type="number"
                    min="1"
                    max="10"
                    className="form-control"
                    value={padLength}
                    onChange={e => setPadLength(parseInt(e.target.value) || 4)}
                    disabled={!usePadding}
                    style={{ width: '70px', padding: '6px' }}
                  />
                </div>
              </div>
            </div>

            {/* Live Preview Box */}
            {(() => {
              const start = parseInt(startNum) || 0;
              const end = parseInt(endNum) || 0;
              const count = Math.max(0, end - start + 1);
              const sample1 = start > 0 ? `${prefix}${usePadding ? String(start).padStart(padLength, '0') : start}` : '';
              const sample2 = end >= start ? `${prefix}${usePadding ? String(end).padStart(padLength, '0') : end}` : '';

              return (
                <div style={{ backgroundColor: 'rgba(0, 155, 78, 0.08)', border: '1px solid rgba(0, 155, 78, 0.25)', borderRadius: '8px', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    <div>
                      <div style={{ fontSize: '12px', color: 'var(--kfh-green)', fontWeight: 'bold' }}>
                        {currentLang === 'en' ? 'Range Expansion Preview:' : 'معاينة توليد النطاق:'}
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 600, marginTop: '4px' }}>
                        {count > 0 ? (
                          <>
                            <span>{sample1}</span> <span style={{ color: 'var(--text-muted)' }}>&rarr;</span> <span>{sample2}</span>
                            <span className="badge badge-ready" style={{ marginLeft: '10px' }}>{count} {currentLang === 'en' ? 'bars total' : 'سبيكة'} ({(count * weightGrams / 1000).toFixed(2)} KG)</span>
                          </>
                        ) : (
                          <span style={{ color: 'var(--accent-red)' }}>{currentLang === 'en' ? 'Invalid start/end numbers' : 'أرقام البداية والنهاية غير صالحة'}</span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleGenerateRange}
                      disabled={count <= 0}
                      style={{ padding: '8px 18px', fontWeight: 'bold' }}
                    >
                      <i className="fa-solid fa-plus-circle"></i> {currentLang === 'en' ? `Generate & Add ${count} Bars` : `توليد وإضافة ${count} سبيكة`}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB 2: BULK PASTE */}
        {activeTab === 'PASTE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {currentLang === 'en' 
                ? 'Paste serial numbers below (one per line, or comma-separated):' 
                : 'الصق الأرقام التسلسلية أدناه (رقم في كل سطر أو مفصولة بفواصل):'}
            </label>
            <textarea
              className="form-control"
              rows={8}
              placeholder="TR-2026-001&#10;TR-2026-002&#10;TR-2026-003"
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: '13px' }}
            />
            {(() => {
              const count = pasteText.split(/[\r\n,;]+/).map(s => s.trim()).filter(Boolean).length;
              return (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: 'var(--kfh-green)', fontWeight: 600 }}>
                    {count} {currentLang === 'en' ? 'serials detected' : 'رقم تسلسلي تم رصده'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleParsePaste}
                    disabled={count === 0}
                    style={{ padding: '8px 18px', fontWeight: 'bold' }}
                  >
                    <i className="fa-solid fa-check"></i> {currentLang === 'en' ? `Add ${count} Serials` : `إضافة ${count} سبيكة`}
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB 3: OCR SCANNER */}
        {activeTab === 'OCR' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {!cameraActive ? (
                <button type="button" className="btn btn-secondary" onClick={startCamera}>
                  <i className="fa-solid fa-video"></i> {currentLang === 'en' ? 'Open Camera Stream' : 'فتح بث الكاميرا'}
                </button>
              ) : (
                <button type="button" className="btn btn-danger" onClick={stopCamera}>
                  <i className="fa-solid fa-video-slash"></i> {currentLang === 'en' ? 'Stop Camera' : 'إيقاف الكاميرا'}
                </button>
              )}

              <label className="btn btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
                <i className="fa-solid fa-upload"></i> {currentLang === 'en' ? 'Upload Bar Image' : 'رفع صورة السبيكة'}
                <input type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>
            </div>

            {/* Live Camera Viewport */}
            {cameraActive && (
              <div style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', background: '#000', textAlign: 'center' }}>
                <video ref={videoRef} style={{ width: '100%', maxHeight: '280px', objectFit: 'contain' }} autoPlay playsInline />
                <div style={{ position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={captureCameraSnapshot}
                    style={{ padding: '10px 20px', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}
                  >
                    <i className="fa-solid fa-camera-retro"></i> {currentLang === 'en' ? 'Snap & Read Serial' : 'التقاط وقراءة الرقم'}
                  </button>
                </div>
              </div>
            )}

            {/* Image Preview & OCR Status */}
            {ocrImage && (
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ width: '160px', height: '120px', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--surface-border)', background: '#000' }}>
                  <img src={ocrImage} alt="OCR Target" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--kfh-green)', marginBottom: '6px' }}>
                    {ocrStatusText}
                  </div>
                  {ocrLoading && (
                    <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '999px', height: '10px', overflow: 'hidden', width: '100%' }}>
                      <div style={{ width: `${ocrProgress}%`, height: '100%', background: 'var(--kfh-green)', transition: 'width 0.2s' }}></div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Extracted Serials Checkbox List */}
            {extractedSerials.length > 0 && (
              <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '14px', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 'bold' }}>
                    {currentLang === 'en' ? 'Recognized Serials (Check to import):' : 'الأرقام المتعرف عليها (حدد للاستيراد):'}
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                      onClick={() => setExtractedSerials(extractedSerials.map(s => ({ ...s, selected: true })))}
                    >
                      {currentLang === 'en' ? 'Select All' : 'تحديد الكل'}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                      onClick={() => setExtractedSerials(extractedSerials.map(s => ({ ...s, selected: false })))}
                    >
                      {currentLang === 'en' ? 'Deselect All' : 'إلغاء التحديد'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                  {extractedSerials.map((item, idx) => (
                    <label
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 10px',
                        background: item.selected ? 'rgba(0, 155, 78, 0.15)' : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${item.selected ? 'var(--kfh-green)' : 'var(--surface-border)'}`,
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        margin: 0
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={e => {
                          const updated = [...extractedSerials];
                          updated[idx].selected = e.target.checked;
                          setExtractedSerials(updated);
                        }}
                      />
                      <span>{item.serial}</span>
                    </label>
                  ))}
                </div>

                <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleApplyOcrSerials}
                    style={{ padding: '8px 18px', fontWeight: 'bold' }}
                  >
                    <i className="fa-solid fa-arrow-down-to-bracket"></i> {currentLang === 'en' ? `Import Selected (${extractedSerials.filter(s => s.selected).length})` : `استيراد المحدد (${extractedSerials.filter(s => s.selected).length})`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};
