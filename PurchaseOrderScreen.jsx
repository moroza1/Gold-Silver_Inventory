/**
 * PurchaseOrderScreen.jsx
 * ------------------------------------------------------------------
 * A self-contained Purchase Order entry screen (no external deps beyond React).
 *
 * WORKFLOW
 *  1. Header       : P.O. Number, Vendor drop-down, P.O. Date, Status.
 *  2. Item entry   : searchable item combo + Quantity, Unit Price + "Add Item".
 *  3. DataGrid     : one row per item (Item ID, Name, Qty, Unit Price, Line Total).
 *                    Re-adding an item MERGES into the existing row (quantity is
 *                    incremented, price refreshed) instead of creating a duplicate.
 *                    Each row has a Remove button.
 *  4. Totals       : Grand Total — recomputed on every change.
 *
 * KEY FORMULAS (single source of truth — see computeLine / totals memo)
 *      lineTotal  = quantity * unitPrice
 *      grandTotal = Σ lineTotal
 *
 * The grid stores only RAW inputs (qty, unitPrice); every money figure is DERIVED
 * at render time, so there is never a stale/!=totals bug to keep in sync.
 * ------------------------------------------------------------------
 */

import React, { useMemo, useRef, useState, useEffect } from "react";

/* ----------------------------- Backend API Configuration ----------------------------- */
const API_BASE = "http://localhost:8080/api";  // Change to your backend URL

/* ---- Fallback demo data (used if API is unavailable) ---- */
const DEMO_PRODUCTS = [
  { id: "GLD-100G", name: "Gold Bar 100g (999.9)", defaultPrice: 7320 },
  { id: "GLD-050G", name: "Gold Bar 50g (999.9)", defaultPrice: 3665 },
  { id: "GLD-010G", name: "Gold Bar 10g (999.9)", defaultPrice: 735 },
  { id: "GLD-001K", name: "Gold Bar 1kg (999.9)", defaultPrice: 73000 },
  { id: "SLV-001K", name: "Silver Bar 1kg (999)", defaultPrice: 900 },
  { id: "SLV-100G", name: "Silver Bar 100g (999)", defaultPrice: 92 },
];

const DEMO_VENDORS = [
  { id: 1, name: "Valcambi Suisse (Switzerland)" },
  { id: 2, name: "Nadir Gold Refinery (Turkey)" },
  { id: 3, name: "PAMP (Switzerland)" },
];

const STATUSES = ["Draft", "Pending Approval", "Approved", "Received"];

/* --------------------------------- Helpers --------------------------------- */
const money = (n) =>
  (Number.isFinite(n) ? n : 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Derive the money figures for a single raw row. One function = one place to change math.
function computeLine(row) {
  const total = (Number(row.quantity) || 0) * (Number(row.unitPrice) || 0);
  return { total };
}

/* ============================== Searchable combo ============================== */
function ItemCombo({ products, value, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef(null);

  const selected = products.find((p) => p.id === value) || null;
  const text = open ? query : selected ? `${selected.id} — ${selected.name}` : "";

  const matches = products.filter((p) => {
    const q = query.trim().toLowerCase();
    return !q || p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
  });

  // Close when clicking outside.
  React.useEffect(() => {
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="po-combo" ref={boxRef}>
      <input
        className="po-input"
        placeholder="Search item by code or name…"
        value={text}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
      />
      {open && (
        <ul className="po-combo-list" role="listbox">
          {matches.length === 0 ? (
            <li className="po-combo-empty">No matching items</li>
          ) : (
            matches.map((p) => (
              <li
                key={p.id}
                role="option"
                aria-selected={p.id === value}
                className={"po-combo-item" + (p.id === value ? " is-selected" : "")}
                onMouseDown={() => {
                  onSelect(p);
                  setOpen(false);
                }}
              >
                <span className="po-combo-code">{p.id}</span>
                <span className="po-combo-name">{p.name}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/* ============================== Main component ============================== */
export default function PurchaseOrderScreen() {
  /* ---- Fetched data from backend ---- */
  const [products, setProducts] = useState(DEMO_PRODUCTS);
  const [vendors, setVendors] = useState(DEMO_VENDORS);
  const [loadingData, setLoadingData] = useState(true);

  /* ---- Fetch products and vendors from PMIMS backend ---- */
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch products from backend
        const productsRes = await fetch(`${API_BASE}/catalog/products`);
        if (productsRes.ok) {
          const productsData = await productsRes.json();
          // Transform backend product format to match component expectations
          const mapped = productsData.map((p) => ({
            id: p.product_code,  // Use product code as ID
            name: `${p.metal_type} Bar ${p.denomination_label} (${p.purity_value})`,
            defaultPrice: 0,  // Backend doesn't have unit price; user enters it
            productId: p.product_id,  // Store internal ID for API calls
            origin: p.origin_country,  // Origin country for filtering
          }));
          setProducts(mapped);
        } else {
          console.warn("Failed to fetch products, using demo data");
        }

        // Fetch vendors from backend
        const vendorsRes = await fetch(`${API_BASE}/master-data/vendors`);
        if (vendorsRes.ok) {
          const vendorsData = await vendorsRes.json();
          // Transform backend vendor format
          const mapped = vendorsData.map((v) => ({
            id: v.vendor_id,
            name: `${v.vendor_name} (${v.country_of_origin})`,
          }));
          setVendors(mapped);
        } else {
          console.warn("Failed to fetch vendors, using demo data");
        }
      } catch (error) {
        console.warn("Error fetching master data, using demo data:", error);
        // Keep demo data as fallback
      } finally {
        setLoadingData(false);
      }
    };

    fetchData();
  }, []);

  /* ---- Header state ---- */
  const [header, setHeader] = useState({
    poNumber: "PO-2026-001",
    vendorId: vendors[0]?.id || 1,
    poDate: new Date().toISOString().slice(0, 10),
    status: STATUSES[0],
    originCountry: "Switzerland",  // Filter products by origin
  });
  const setH = (patch) => setHeader((h) => ({ ...h, ...patch }));

  /* ---- Item-entry state ---- */
  const [entry, setEntry] = useState({ itemId: "", quantity: 1, unitPrice: 0 });
  const setE = (patch) => setEntry((s) => ({ ...s, ...patch }));

  /* ---- Filtered products by origin ---- */
  const filteredProducts = useMemo(() => {
    return products.filter(p => !p.origin || p.origin === header.originCountry);
  }, [products, header.originCountry]);

  /* ---- Grid rows (raw inputs only) ---- */
  /* Each row now has a unique rowId to allow multiple rows with the same itemId */
  const [rows, setRows] = useState([]);
  const [nextRowId, setNextRowId] = useState(1);

  /* ---- Add Item Logic (No Merging - Each Add Is A Separate Row) ---- */
  const handleAddItem = () => {
    // Validation: item must be chosen and quantity must be > 0.
    if (!entry.itemId) return alert("Please select an item first.");
    const qty = Number(entry.quantity);
    if (!(qty > 0)) return alert("Quantity must be greater than zero.");

    const product = filteredProducts.find((p) => p.id === entry.itemId);

    // Always add as a new row (no merging with existing items of the same type)
    setRows((prev) => [
      ...prev,
      {
        rowId: nextRowId,  // Unique identifier for this row
        itemId: product.id,
        itemName: product.name,
        quantity: qty,
        unitPrice: Number(entry.unitPrice) || 0,
      },
    ]);

    setNextRowId((id) => id + 1);  // Increment for next row

    // Reset the entry row for the next item.
    setEntry({ itemId: "", quantity: 1, unitPrice: 0 });
  };

  /* Remove by unique rowId (not itemId) to preserve other rows of the same item */
  const handleRemove = (rowId) => setRows((prev) => prev.filter((r) => r.rowId !== rowId));

  /* ---- Totals (recomputed whenever rows change) ---- */
  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.grandTotal += computeLine(r).total;
        return acc;
      },
      { grandTotal: 0 }
    );
  }, [rows]);

  const onPickItem = (product) =>
    setE({ itemId: product.id, unitPrice: product.defaultPrice ?? entry.unitPrice });

  /* --------------------------------- Render --------------------------------- */
  if (loadingData) {
    return (
      <div className="po-screen">
        <Style />
        <h2 className="po-title">Purchase Order</h2>
        <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>
          Loading product catalog and vendors... <i className="fa-solid fa-spinner fa-spin"></i>
        </div>
      </div>
    );
  }

  return (
    <div className="po-screen">
      <Style />

      <h2 className="po-title">Purchase Order</h2>

      {/* 1) HEADER ---------------------------------------------------------- */}
      <section className="po-card">
        <div className="po-grid-4">
          <Field label="P.O. Number">
            <input
              className="po-input"
              value={header.poNumber}
              onChange={(e) => setH({ poNumber: e.target.value })}
            />
          </Field>
          <Field label="Supplier / Vendor">
            <select
              className="po-input"
              value={header.vendorId}
              onChange={(e) => setH({ vendorId: Number(e.target.value) })}
            >
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="P.O. Date">
            <input
              type="date"
              className="po-input"
              value={header.poDate}
              onChange={(e) => setH({ poDate: e.target.value })}
            />
          </Field>
          <Field label="Status">
            <select
              className="po-input"
              value={header.status}
              onChange={(e) => setH({ status: e.target.value })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Product Origin">
            <select
              className="po-input"
              value={header.originCountry}
              onChange={(e) => {
                setH({ originCountry: e.target.value });
                setE({ itemId: "" }); // Reset item selection when origin changes
              }}
            >
              <option value="Switzerland">Switzerland</option>
              <option value="Turkey">Turkey</option>
              <option value="USA">USA</option>
              <option value="Germany">Germany</option>
              <option value="France">France</option>
              <option value="UK">UK</option>
              <option value="Canada">Canada</option>
              <option value="Australia">Australia</option>
              <option value="China">China</option>
              <option value="India">India</option>
              <option value="Russia">Russia</option>
            </select>
          </Field>
        </div>
      </section>

      {/* 2) ITEM ENTRY ------------------------------------------------------ */}
      <section className="po-card">
        <div className="po-entry">
          <Field label="Item" grow>
            <ItemCombo products={filteredProducts} value={entry.itemId} onSelect={onPickItem} />
          </Field>
          <Field label="Quantity">
            <input
              type="number"
              min="1"
              className="po-input po-num"
              value={entry.quantity}
              onChange={(e) => setE({ quantity: e.target.value })}
            />
          </Field>
          <Field label="Unit Price">
            <input
              type="number"
              min="0"
              step="0.01"
              className="po-input po-num"
              value={entry.unitPrice}
              onChange={(e) => setE({ unitPrice: e.target.value })}
            />
          </Field>
          <button className="po-btn po-btn-primary" onClick={handleAddItem}>
            + Add Item
          </button>
        </div>
      </section>

      {/* 3) DATA GRID ------------------------------------------------------- */}
      <section className="po-card">
        <table className="po-table">
          <thead>
            <tr>
              <th>Item ID</th>
              <th>Item Name</th>
              <th className="r">Qty</th>
              <th className="r">Unit Price</th>
              <th className="r">Line Total</th>
              <th className="c">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="po-empty">
                  No items yet — add one above.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const { total } = computeLine(r);
                return (
                  <tr key={r.rowId}>
                    <td>{r.itemId}</td>
                    <td>{r.itemName}</td>
                    <td className="r">{r.quantity}</td>
                    <td className="r">{money(Number(r.unitPrice))}</td>
                    <td className="r strong">{money(total)}</td>
                    <td className="c">
                      <button className="po-btn po-btn-danger" onClick={() => handleRemove(r.rowId)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* 4) TOTALS -------------------------------------------------------- */}
        <div className="po-totals">
          <TotalRow label="Grand Total" value={totals.grandTotal} grand />
        </div>
      </section>
    </div>
  );
}

/* ------------------------------ Small UI atoms ------------------------------ */
function Field({ label, children, grow }) {
  return (
    <label className={"po-field" + (grow ? " grow" : "")}>
      <span className="po-field-label">{label}</span>
      {children}
    </label>
  );
}

function TotalRow({ label, value, grand }) {
  return (
    <div className={"po-total-row" + (grand ? " grand" : "")}>
      <span>{label}</span>
      <span>{money(value)}</span>
    </div>
  );
}

/* --------------------------------- Styling --------------------------------- */
/* Scoped, dependency-free. Drop-in dark theme; tweak the CSS vars to reskin.    */
function Style() {
  return (
    <style>{`
      .po-screen{--bg:#0f1720;--card:#161f2b;--line:#26313f;--muted:#8aa0b6;--txt:#e7eef6;
        --accent:#009b4e;--accent2:#1e73ff;--danger:#e5484d;--gold:#d4af37;
        color:var(--txt);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        max-width:1000px;margin:0 auto;padding:20px;}
      .po-title{margin:0 0 16px;font-size:22px;border-bottom:2px solid var(--gold);padding-bottom:8px;}
      .po-card{background:var(--card);border:1px solid var(--line);border-radius:12px;
        padding:16px;margin-bottom:16px;}
      .po-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
      .po-field{display:flex;flex-direction:column;gap:6px;min-width:0;}
      .po-field.grow{flex:1;}
      .po-field-label{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);}
      .po-input{background:#0d141d;border:1px solid var(--line);border-radius:8px;color:var(--txt);
        padding:9px 10px;font-size:14px;width:100%;box-sizing:border-box;outline:none;}
      .po-input:focus{border-color:var(--accent2);}
      .po-num{text-align:right;}
      .po-entry{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;}
      .po-entry .po-field{width:130px;}
      .po-entry .po-field.grow{width:auto;min-width:240px;}
      .po-btn{border:none;border-radius:8px;padding:9px 14px;font-size:13px;font-weight:600;
        cursor:pointer;white-space:nowrap;}
      .po-btn-primary{background:var(--accent);color:#04120a;}
      .po-btn-primary:hover{filter:brightness(1.1);}
      .po-btn-danger{background:transparent;border:1px solid var(--danger);color:var(--danger);
        padding:5px 10px;font-size:12px;}
      .po-btn-danger:hover{background:var(--danger);color:#fff;}
      .po-combo{position:relative;}
      .po-combo-list{position:absolute;z-index:20;top:calc(100% + 4px);left:0;right:0;margin:0;padding:4px;
        list-style:none;background:#0d141d;border:1px solid var(--line);border-radius:8px;
        max-height:220px;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.4);}
      .po-combo-item{display:flex;gap:10px;align-items:baseline;padding:8px 10px;border-radius:6px;cursor:pointer;}
      .po-combo-item:hover,.po-combo-item.is-selected{background:rgba(30,115,255,.15);}
      .po-combo-code{font-family:ui-monospace,monospace;font-size:12px;color:var(--gold);min-width:74px;}
      .po-combo-name{font-size:13px;}
      .po-combo-empty{padding:10px;color:var(--muted);font-size:13px;}
      .po-table{width:100%;border-collapse:collapse;font-size:14px;}
      .po-table th,.po-table td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;}
      .po-table th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);}
      .po-table td.r,.po-table th.r{text-align:right;}
      .po-table td.c,.po-table th.c{text-align:center;}
      .po-table td.strong{font-weight:700;color:var(--gold);}
      .po-empty{text-align:center;color:var(--muted);padding:22px;}
      .po-totals{margin-top:14px;margin-left:auto;width:300px;max-width:100%;}
      .po-total-row{display:flex;justify-content:space-between;padding:8px 4px;font-size:14px;
        border-bottom:1px dashed var(--line);}
      .po-total-row.grand{font-size:18px;font-weight:800;color:var(--gold);border-bottom:none;
        border-top:2px solid var(--gold);margin-top:4px;padding-top:12px;}
      @media(max-width:720px){.po-grid-4{grid-template-columns:1fr 1fr;}}
    `}</style>
  );
}
