"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";

const euro = new Intl.NumberFormat("lt-LT", { style: "currency", currency: "EUR" });

type Row = Record<string, unknown>;
type StoreDraft = {
  storeId: string;
  name: string;
  regular: string;
  promo: string;
  priceType: "regular" | "promo_all" | "loyalty_card" | "multi_buy";
};
type ScannedItem = {
  selected: boolean;
  name: string;
  brand: string;
  quantity: number;
  unit: "g" | "kg" | "ml" | "l" | "vnt";
  regular_price: number;
  promo_price: number | null;
  price_type: "regular" | "promo" | "loyalty_card";
};
type ExistingProduct = {
  id: string;
  name: string;
  brand: string | null;
  quantity: number | null;
  unit: string | null;
  categoryName: string;
  offers: {
    productId: string;
    storeId: string;
    storeName: string;
    storeProductId: string;
    priceId: string | null;
    regular: number | null;
    promo: number | null;
    priceType: string;
  }[];
};

function text(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function id(row: Row) {
  const value = row.id;
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function timestamp(row: Row) {
  const raw = text(row, "valid_from") ?? text(row, "recorded_at") ?? text(row, "created_at") ?? text(row, "updated_at");
  const time = raw ? Date.parse(raw) : 0;
  return Number.isNaN(time) ? 0 : time;
}

function friendlyError(error: unknown) {
  if (!error || typeof error !== "object") return "Nepavyko įrašyti duomenų.";
  const record = error as Row;
  const message = typeof record.message === "string" ? record.message : "Nepavyko įrašyti duomenų.";
  const code = typeof record.code === "string" ? record.code : "";
  if (code === "42501" || /permission|policy|row-level security/i.test(message)) {
    return "Trūksta INSERT/UPDATE teisių Supabase. Žemiau puslapio yra paruoštas SQL komentaras.";
  }
  return message;
}

export default function AdminPage() {
  const supabase = useMemo(() => getSupabase(), []);
  const [categories, setCategories] = useState<Row[]>([]);
  const [stores, setStores] = useState<Row[]>([]);
  const [products, setProducts] = useState<Row[]>([]);
  const [storeProducts, setStoreProducts] = useState<Row[]>([]);
  const [prices, setPrices] = useState<Row[]>([]);
  const [storeDrafts, setStoreDrafts] = useState<StoreDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("vnt");
  const [brand, setBrand] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [labelStoreName, setLabelStoreName] = useState("");
  const [scanningLabel, setScanningLabel] = useState(false);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const savedPassword = window.sessionStorage.getItem("pirktukas-admin-password");
    const savedAuth = window.sessionStorage.getItem("pirktukas-admin-auth") === "true";
    if (savedPassword) setAdminPassword(savedPassword);
    setAuthenticated(savedAuth && Boolean(savedPassword));
    setCheckingAuth(false);
  }, []);

  useEffect(() => {
    if (authenticated) void loadAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  async function loadAdminData() {
    if (!supabase) return;
    setLoading(true);

    const [categoriesResult, storesResult, productsResult, storeProductsResult, pricesResult] = await Promise.all([
      supabase.from("categories").select("*"),
      supabase.from("stores").select("*"),
      supabase.from("products").select("*"),
      supabase.from("store_products").select("*"),
      supabase.from("prices").select("*"),
    ]);

    const error = [categoriesResult.error, storesResult.error, productsResult.error, storeProductsResult.error, pricesResult.error].find(Boolean);
    if (error) {
      setMessage({ type: "error", text: friendlyError(error) });
      setLoading(false);
      return;
    }

    const categoryRows = Array.isArray(categoriesResult.data) ? categoriesResult.data as Row[] : [];
    const storeRows = (Array.isArray(storesResult.data) ? storesResult.data as Row[] : []).filter((store) => {
      const activeValue = store.active ?? store.is_active;
      return activeValue === undefined || activeValue === null || activeValue === true || activeValue === "true" || activeValue === 1 || activeValue === "1";
    });

    setCategories(categoryRows);
    setStores(storeRows);
    setProducts(Array.isArray(productsResult.data) ? productsResult.data as Row[] : []);
    setStoreProducts(Array.isArray(storeProductsResult.data) ? storeProductsResult.data as Row[] : []);
    setPrices(Array.isArray(pricesResult.data) ? pricesResult.data as Row[] : []);
    setStoreDrafts(storeRows.map((store) => ({
      storeId: id(store) ?? "",
      name: text(store, "name") ?? "Parduotuvė",
      regular: "",
      promo: "",
      priceType: "regular" as const,
    })).filter((store) => store.storeId));

    if (!categoryId && categoryRows.length > 0) setCategoryId(id(categoryRows[0]) ?? "");
    if (storeRows.length > 0) {
      setLabelStoreName((current) => current || text(storeRows[0], "name") || "");
    }
    setLoading(false);
  }

  const existingProducts = useMemo<ExistingProduct[]>(() => {
    const categoryNames = new Map(categories.flatMap((category) => {
      const categoryId = id(category);
      return categoryId ? [[categoryId, text(category, "name") ?? "Be kategorijos"] as const] : [];
    }));

    const latestPrices = new Map<string, Row>();
    for (const price of prices) {
      const storeProductIdValue = price.store_product_id;
      const storeProductId = typeof storeProductIdValue === "string" ? storeProductIdValue : typeof storeProductIdValue === "number" ? String(storeProductIdValue) : null;
      if (!storeProductId) continue;
      const current = latestPrices.get(storeProductId);
      if (!current || timestamp(price) >= timestamp(current)) latestPrices.set(storeProductId, price);
    }

    const storeNames = new Map(stores.flatMap((store) => {
      const storeId = id(store);
      return storeId ? [[storeId, text(store, "name") ?? "Parduotuvė"] as const] : [];
    }));

    return products.map((product) => {
      const productId = id(product);
      if (!productId) return null;
      const offers = storeProducts
        .filter((storeProduct) => {
          const linkedProductId = storeProduct.product_id;
          return String(linkedProductId ?? "") === productId;
        })
        .map((storeProduct) => {
          const storeProductId = id(storeProduct);
          const storeIdValue = storeProduct.store_id;
          const storeId = typeof storeIdValue === "string" ? storeIdValue : typeof storeIdValue === "number" ? String(storeIdValue) : null;
          if (!storeProductId || !storeId) return null;
          const price = latestPrices.get(storeProductId);
          const priceType = price ? (text(price, "price_type") ?? text(price, "type") ?? "regular") : "regular";
          return {
            productId: productId,
            storeId,
            storeName: storeNames.get(storeId) ?? "Parduotuvė",
            storeProductId,
            priceId: price ? id(price) : null,
            regular: price ? numberValue(price.regular_price) : null,
            promo: price ? numberValue(price.promo_price) : null,
            priceType: priceType ?? "regular",
          };
        })
        .filter((offer): offer is ExistingProduct["offers"][number] => offer !== null);

      const categoryIdValue = product.category_id;
      const categoryId = typeof categoryIdValue === "string" ? categoryIdValue : typeof categoryIdValue === "number" ? String(categoryIdValue) : null;
      return {
        id: productId,
        name: text(product, "name") ?? "Be pavadinimo",
        brand: text(product, "brand"),
        quantity: numberValue(product.quantity),
        unit: text(product, "unit"),
        categoryName: categoryId ? categoryNames.get(categoryId) ?? "Be kategorijos" : "Be kategorijos",
        offers,
      };
    }).filter((product): product is ExistingProduct => product !== null)
      .sort((a, b) => a.name.localeCompare(b.name, "lt"));
  }, [categories, stores, products, storeProducts, prices]);

  async function handleAddProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setMessage({ type: "error", text: "Supabase raktai nėra sukonfigūruoti." });
      return;
    }
    if (!name.trim() || !categoryId || !quantity.trim()) {
      setMessage({ type: "error", text: "Užpildykite produkto pavadinimą, kategoriją ir kiekį." });
      return;
    }

    setSaving(true);
    setMessage(null);

    const quantityNumber = Number(quantity.replace(",", "."));
    if (!Number.isFinite(quantityNumber) || quantityNumber <= 0) {
      setMessage({ type: "error", text: "Kiekis turi būti teigiamas skaičius." });
      setSaving(false);
      return;
    }

    const productPayload: Row = {
      name: name.trim(),
      category_id: categoryId,
      quantity: quantityNumber,
      unit,
    };
    if (brand.trim()) productPayload.brand = brand.trim();

    if (!adminPassword) {
      setMessage({ type: "error", text: "Įveskite administratoriaus slaptažodį." });
      setSaving(false);
      return;
    }

    const storesPayload = storeDrafts
      .filter((draft) => draft.regular.trim())
      .map((draft) => ({
        storeId: draft.storeId,
        regular: Number(draft.regular.replace(",", ".")),
        promo: draft.promo.trim() ? Number(draft.promo.replace(",", ".")) : null,
        priceType: draft.priceType,
      }))
      .filter((draft) => Number.isFinite(draft.regular));

    const response = await fetch("/api/admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": adminPassword,
      },
      body: JSON.stringify({
        action: "createProduct",
        password: adminPassword,
        product: { name: name.trim(), categoryId, quantity: quantityNumber, unit, brand: brand.trim() },
        stores: storesPayload,
      }),
    });

    const result = await response.json().catch(() => ({ message: "Nepavyko apdoroti serverio atsakymo." })) as { message?: string };
    if (!response.ok) {
      setMessage({ type: "error", text: result.message ?? "Nepavyko pridėti produkto." });
      setSaving(false);
      return;
    }

    setMessage({ type: "success", text: `Produktas „${name.trim()}“ sėkmingai pridėtas.` });
    setName("");
    setQuantity("");
    setBrand("");
    setStoreDrafts((drafts) => drafts.map((draft) => ({ ...draft, regular: "", promo: "", priceType: "regular" })));
    await loadAdminData();
    setSaving(false);
  }

  async function updateOffer(offer: ExistingProduct["offers"][number], regular: string, promo: string, priceType: string) {
    const regularNumber = regular.trim() ? Number(regular.replace(",", ".")) : null;
    const promoNumber = promo.trim() ? Number(promo.replace(",", ".")) : null;
    if (regularNumber === null || !Number.isFinite(regularNumber) || regularNumber < 0) {
      setMessage({ type: "error", text: "Įveskite teisingą įprastą kainą." });
      return;
    }
    if (!adminPassword) {
      setMessage({ type: "error", text: "Įveskite administratoriaus slaptažodį." });
      return;
    }

    setSaving(true);
    setMessage(null);

    const response = await fetch("/api/admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": adminPassword,
      },
      body: JSON.stringify({
        action: "updatePrice",
        password: adminPassword,
        storeId: offer.storeId,
        storeProductId: offer.storeProductId || undefined,
        priceId: offer.priceId,
        regular: regularNumber,
        promo: promoNumber,
        priceType,
        productId: offer.productId,
      }),
    });

    const result = await response.json().catch(() => ({ message: "Nepavyko apdoroti serverio atsakymo." })) as { message?: string };
    if (!response.ok) {
      setMessage({ type: "error", text: result.message ?? "Nepavyko atnaujinti kainos." });
    } else {
      setMessage({ type: "success", text: result.message ?? `„${offer.storeName}“ kainos sėkmingai atnaujintos.` });
      await loadAdminData();
    }
    setSaving(false);
  }

  function saveAdminPassword(value: string) {
    setAdminPassword(value);
  }

  async function scanLabel(file: File | null) {
    if (!file) return;
    if (!adminPassword) {
      setMessage({ type: "error", text: "Įveskite administratoriaus slaptažodį." });
      return;
    }

    setScanningLabel(true);
    setMessage(null);

    const formData = new FormData();
    formData.append("image", file);
    formData.append("storeName", labelStoreName);

    const response = await fetch("/api/parse-label", {
      method: "POST",
      headers: { "x-admin-password": adminPassword },
      body: formData,
    });

    const result = await response.json().catch(() => ({ message: "Nepavyko apdoroti serverio atsakymo." })) as {
      message?: string;
      items?: ScannedItem[];
      name?: string;
      brand?: string;
      quantity?: number;
      unit?: "g" | "kg" | "ml" | "l" | "vnt";
      regular_price?: number;
      promo_price?: number | null;
      price_type?: "regular" | "promo" | "loyalty_card";
    };

    if (!response.ok) {
      setMessage({ type: "error", text: result.message ?? "Nepavyko nuskaityti kainos etiketės." });
      setScanningLabel(false);
      return;
    }

    const items = Array.isArray(result.items)
      ? result.items
      : typeof result.name === "string"
        ? [{ selected: true, name: result.name, brand: result.brand ?? "", quantity: result.quantity ?? 0, unit: result.unit ?? "vnt", regular_price: result.regular_price ?? 0, promo_price: result.promo_price ?? null, price_type: result.price_type ?? "regular" }]
        : [];

    if (items.length > 1) {
      setScannedItems(items.map((item) => ({ ...item, selected: true })));
      setMessage({ type: "success", text: `Nuskaityta ${items.length} prekės – patikrinkite pažymėtas prekes.` });
      setScanningLabel(false);
      return;
    }

    const oneItem = items[0];
    setScannedItems([]);
    if (oneItem) {
      setName(oneItem.name);
      setBrand(oneItem.brand);
      if (oneItem.quantity > 0) setQuantity(String(oneItem.quantity));
      setUnit(oneItem.unit);

      if (oneItem.regular_price >= 0) {
        setStoreDrafts((drafts) => drafts.map((draft) => {
          if (draft.name !== labelStoreName) return draft;
          const priceType = oneItem.price_type === "loyalty_card"
            ? "loyalty_card"
            : oneItem.price_type === "promo"
              ? "promo_all"
              : "regular";
          return {
            ...draft,
            regular: String(oneItem.regular_price),
            promo: typeof oneItem.promo_price === "number" ? String(oneItem.promo_price) : "",
            priceType,
          };
        }));
      }
    }

    setMessage({ type: "success", text: "Duomenys nuskaityti – patikrinkite ir paspauskite Išsaugoti" });
    setScanningLabel(false);
  }

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adminPassword) return;

    setSaving(true);
    setMessage(null);
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-password": adminPassword },
      body: JSON.stringify({ action: "verify", password: adminPassword }),
    });

    if (!response.ok) {
      setAuthenticated(false);
      window.sessionStorage.removeItem("pirktukas-admin-auth");
      window.sessionStorage.removeItem("pirktukas-admin-password");
      setMessage({ type: "error", text: "Neteisingas slaptažodis" });
    } else {
      window.sessionStorage.setItem("pirktukas-admin-password", adminPassword);
      window.sessionStorage.setItem("pirktukas-admin-auth", "true");
      setAuthenticated(true);
      setMessage(null);
    }
    setSaving(false);
  }

  function signOut() {
    setAuthenticated(false);
    setAdminPassword("");
    window.sessionStorage.removeItem("pirktukas-admin-password");
    window.sessionStorage.removeItem("pirktukas-admin-auth");
  }

  async function saveScannedItems() {
    const selectedItems = scannedItems.filter((item) => item.selected);
    if (selectedItems.length === 0) {
      setMessage({ type: "error", text: "Pažymėkite bent vieną nuskaitytą prekę." });
      return;
    }

    const selectedStore = stores.find((store) => text(store, "name") === labelStoreName);
    const storeId = selectedStore ? id(selectedStore) : null;
    if (!storeId || !categoryId) {
      setMessage({ type: "error", text: "Pasirinkite kategoriją ir parduotuvę." });
      return;
    }

    setSaving(true);
    setMessage(null);

    for (const item of selectedItems) {
      const priceType = item.price_type === "loyalty_card" ? "loyalty_card" : item.price_type === "promo" ? "promo_all" : "regular";
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": adminPassword },
        body: JSON.stringify({
          action: "createProduct",
          password: adminPassword,
          product: { name: item.name, categoryId, quantity: item.quantity, unit: item.unit, brand: item.brand },
          stores: [{ storeId, regular: item.regular_price, promo: item.promo_price, priceType }],
        }),
      });
      const result = await response.json().catch(() => ({ message: "Nepavyko apdoroti serverio atsakymo." })) as { message?: string };
      if (!response.ok) {
        setMessage({ type: "error", text: result.message ?? `Nepavyko išsaugoti prekės „${item.name}“.` });
        setSaving(false);
        return;
      }
    }

    setMessage({ type: "success", text: `Išsaugota pažymėtų prekių: ${selectedItems.length}.` });
    setScannedItems([]);
    await loadAdminData();
    setSaving(false);
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-8 sm:px-8">
      {checkingAuth ? (
        <p className="rounded-2xl border border-line bg-card p-5 text-ink-soft">Tikrinamas prisijungimas...</p>
      ) : !authenticated ? (
        <section className="mx-auto w-full max-w-md rounded-3xl border border-line bg-card p-6 shadow-[0_16px_40px_rgba(28,25,21,0.05)] sm:p-8">
          <Link href="/" className="text-sm font-semibold text-forest">← Grįžti į parduotuvę</Link>
          <h1 className="mt-6 font-display text-3xl tracking-tight text-forest">Prisijungimas prie administravimo</h1>
          <form onSubmit={signIn} className="mt-5 flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink-soft">
              Administratoriaus slaptažodis
              <input type="password" value={adminPassword} onChange={(event) => saveAdminPassword(event.target.value)} autoComplete="current-password" className="input" placeholder="Įveskite slaptažodį" />
            </label>
            {message ? (
              <p className="rounded-xl border border-sale/20 bg-sale/8 px-4 py-3 text-sm text-sale" role="alert">{message.text}</p>
            ) : null}
            <button type="submit" disabled={saving || !adminPassword} className="h-12 rounded-xl bg-forest px-5 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? "Tikrinama..." : "Prisijungti"}
            </button>
          </form>
        </section>
      ) : (
        <>
      <header className="flex flex-col gap-4">
        <Link href="/" className="w-fit text-sm font-semibold text-forest">← Grįžti į parduotuvę</Link>
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-forest uppercase">Administravimas</p>
          <h1 className="mt-2 font-display text-4xl tracking-tight text-forest sm:text-5xl">Pirktukas administravimas</h1>
        </div>
        <button type="button" onClick={signOut} className="w-fit rounded-xl border border-line bg-card px-4 py-2 text-sm font-semibold text-forest">Atsijungti</button>
      </header>

      {message ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${message.type === "success" ? "border-forest/20 bg-forest/8 text-forest" : "border-sale/20 bg-sale/8 text-sale"}`} role="status">
          {message.text}
        </div>
      ) : null}

      <section className="rounded-3xl border border-line bg-card p-5 shadow-[0_12px_32px_rgba(28,25,21,0.04)] sm:p-7">
        <h2 className="font-display text-2xl tracking-tight">Nuskaityti kainos etiketę iš nuotraukos</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-[14rem_1fr] sm:items-end">
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink-soft">
            Parduotuvė
            <select value={labelStoreName} onChange={(event) => setLabelStoreName(event.target.value)} className="input">
              {stores.map((store) => {
                const storeName = text(store, "name") ?? "Parduotuvė";
                return <option key={id(store) ?? storeName} value={storeName}>{storeName}</option>;
              })}
            </select>
          </label>
          <label className="flex h-12 cursor-pointer items-center justify-center rounded-xl border border-forest/20 bg-forest/5 px-4 text-sm font-semibold text-forest">
            <input type="file" accept="image/*" capture="environment" className="hidden" disabled={scanningLabel} onChange={(event) => void scanLabel(event.target.files?.[0] ?? null)} />
            {scanningLabel ? "Nuskaitoma..." : "Pasirinkti nuotrauką / fotografuoti"}
          </label>
        </div>
      </section>

      <section className="rounded-3xl border border-line bg-card p-5 shadow-[0_12px_32px_rgba(28,25,21,0.04)] sm:p-7">
        <h2 className="font-display text-3xl tracking-tight">Pridėti naują produktą ir kainas</h2>
        <form onSubmit={handleAddProduct} className="mt-6 flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Produkto pavadinimas">
              <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Šviežia vištienos krūtinėlės filė" className="input" />
            </Field>
            <Field label="Kategorija">
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="input" required>
                {categories.map((category) => {
                  const categoryIdValue = id(category);
                  return categoryIdValue ? <option key={categoryIdValue} value={categoryIdValue}>{text(category, "name") ?? "Be pavadinimo"}</option> : null;
                })}
              </select>
            </Field>
            <Field label="Kiekis">
              <input required inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="500" className="input" />
            </Field>
            <Field label="Matavimo vienetas">
              <select value={unit} onChange={(event) => setUnit(event.target.value)} className="input">
                {["g", "kg", "ml", "l", "vnt"].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <Field label="Gamintojas / prekės ženklas (nebūtina)">
              <input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="Pavyzdys" className="input sm:col-span-2" />
            </Field>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {storeDrafts.map((draft, index) => (
              <article key={draft.storeId} className="rounded-2xl border border-line bg-background p-4">
                <h3 className="font-semibold">{draft.name}</h3>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-xs font-semibold text-ink-soft">Įprasta kaina
                    <input inputMode="decimal" value={draft.regular} onChange={(event) => setStoreDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, regular: event.target.value } : item))} placeholder="Tuščia = nėra" className="input mt-1" />
                  </label>
                  <label className="text-xs font-semibold text-ink-soft">Akcijos kaina
                    <input inputMode="decimal" value={draft.promo} onChange={(event) => setStoreDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, promo: event.target.value } : item))} placeholder="Nebūtina" className="input mt-1" />
                  </label>
                </div>
                <label className="mt-3 block text-xs font-semibold text-ink-soft">Kainos tipas
                  <select value={draft.priceType} onChange={(event) => setStoreDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, priceType: event.target.value as StoreDraft["priceType"] } : item))} className="input mt-1">
                    <option value="regular">regular</option>
                    <option value="promo_all">promo_all</option>
                    <option value="loyalty_card">loyalty_card</option>
                    <option value="multi_buy">multi_buy</option>
                  </select>
                </label>
              </article>
            ))}
          </div>

          <button type="submit" disabled={saving || loading} className="h-12 rounded-xl bg-forest px-5 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? "Saugoma..." : "Pridėti produktą"}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-3xl tracking-tight">Esami produktai ir kainos</h2>
        {loading ? (
          <p className="rounded-2xl border border-line bg-card p-5 text-ink-soft">Kraunami duomenys...</p>
        ) : existingProducts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line bg-card p-6 text-center text-ink-soft">Produktų dar nėra.</p>
        ) : (
          <div className="grid gap-4">
            {existingProducts.map((product) => (
              <ExistingProductEditor key={product.id} product={product} stores={stores} saving={saving} onSave={updateOffer} />
            ))}
          </div>
        )}
      </section>

      {scannedItems.length > 0 ? (
        <section className="rounded-3xl border border-line bg-card p-5 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl tracking-tight">Nuskaitytos prekės</h2>
            <span className="text-sm font-semibold text-forest">Pažymėta: {scannedItems.filter((item) => item.selected).length}</span>
          </div>
          <div className="mt-4 grid gap-3">
            {scannedItems.map((item, index) => (
              <article key={`${item.name}-${index}`} className="rounded-2xl border border-line bg-background p-4">
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={item.selected} onChange={(event) => setScannedItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, selected: event.target.checked } : entry))} className="mt-1 size-5" />
                  <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                    <Field label="Prekės pavadinimas"><input value={item.name} onChange={(event) => setScannedItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, name: event.target.value } : entry))} className="input" /></Field>
                    <Field label="Gamintojas"><input value={item.brand} onChange={(event) => setScannedItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, brand: event.target.value } : entry))} className="input" /></Field>
                    <Field label="Kiekis"><input inputMode="decimal" value={item.quantity || ""} onChange={(event) => setScannedItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantity: Number(event.target.value.replace(",", ".")) } : entry))} className="input" /></Field>
                    <Field label="Vienetas"><select value={item.unit} onChange={(event) => setScannedItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, unit: event.target.value as ScannedItem["unit"] } : entry))} className="input">{["g", "kg", "ml", "l", "vnt"].map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></Field>
                    <Field label="Įprasta kaina"><input inputMode="decimal" value={item.regular_price || ""} onChange={(event) => setScannedItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, regular_price: Number(event.target.value.replace(",", ".")) } : entry))} className="input" /></Field>
                    <Field label="Akcijos kaina"><input inputMode="decimal" value={item.promo_price ?? ""} onChange={(event) => setScannedItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, promo_price: event.target.value ? Number(event.target.value.replace(",", ".")) : null } : entry))} className="input" /></Field>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <button type="button" disabled={saving} onClick={() => void saveScannedItems()} className="mt-4 h-12 w-full rounded-xl bg-forest px-5 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? "Saugoma..." : "Išsaugoti pažymėtas prekes"}
          </button>
        </section>
      ) : null}

      <details className="rounded-2xl border border-line bg-card p-5">
        <summary className="cursor-pointer font-semibold text-forest">Supabase SQL teisėms suteikti</summary>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-foreground p-4 text-xs leading-5 text-white">{`-- Paleiskite Supabase SQL redaktoriuje, jei anon rolei trūksta INSERT/UPDATE teisių.
GRANT INSERT, UPDATE, SELECT ON TABLE public.products TO anon;
GRANT INSERT, UPDATE, SELECT ON TABLE public.store_products TO anon;
GRANT INSERT, UPDATE, SELECT ON TABLE public.prices TO anon;

-- Jei lentelėms įjungtos RLS politikos, sukuriamos atitinkamos anon politikos:
CREATE POLICY "anon can insert products" ON public.products FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can update products" ON public.products FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon can insert store products" ON public.store_products FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can update store products" ON public.store_products FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon can insert prices" ON public.prices FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can update prices" ON public.prices FOR UPDATE TO anon USING (true) WITH CHECK (true);`}</pre>
      </details>
        </>
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-sm font-semibold text-ink-soft">{label}{children}</label>;
}

function ExistingProductEditor({
  product,
  stores,
  saving,
  onSave,
}: {
  product: ExistingProduct;
  stores: Row[];
  saving: boolean;
  onSave: (offer: ExistingProduct["offers"][number], regular: string, promo: string, priceType: string) => Promise<void>;
}) {
  const storeNames = new Map(stores.flatMap((store) => {
    const storeIdValue = id(store);
    return storeIdValue ? [[storeIdValue, text(store, "name") ?? "Parduotuvė"] as const] : [];
  }));

  return (
    <article className="rounded-3xl border border-line bg-card p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold">{product.name}</h3>
          <p className="text-sm text-ink-soft">{[product.brand, product.quantity && product.unit ? `${product.quantity}${product.unit}` : null, product.categoryName].filter(Boolean).join(" · ")}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {stores.map((store) => {
          const storeIdValue = id(store);
          if (!storeIdValue) return null;
          const offer = product.offers.find((item) => item.storeId === storeIdValue);
          return (
            <OfferEditor
              key={storeIdValue}
              storeName={storeNames.get(storeIdValue) ?? "Parduotuvė"}
              offer={offer ?? {
                productId: product.id,
                storeId: storeIdValue,
                storeName: storeNames.get(storeIdValue) ?? "Parduotuvė",
                storeProductId: "",
                priceId: null,
                regular: null,
                promo: null,
                priceType: "regular",
              }}
              saving={saving}
              onSave={onSave}
              hasStoreProduct={Boolean(offer)}
            />
          );
        })}
      </div>
    </article>
  );
}

function OfferEditor({
  storeName,
  offer,
  saving,
  onSave,
  hasStoreProduct,
}: {
  storeName: string;
  offer: ExistingProduct["offers"][number];
  saving: boolean;
  onSave: (offer: ExistingProduct["offers"][number], regular: string, promo: string, priceType: string) => Promise<void>;
  hasStoreProduct: boolean;
}) {
  const [regular, setRegular] = useState(offer.regular === null ? "" : String(offer.regular));
  const [promo, setPromo] = useState(offer.promo === null ? "" : String(offer.promo));
  const [priceType, setPriceType] = useState(offer.priceType || "regular");

  useEffect(() => {
    setRegular(offer.regular === null ? "" : String(offer.regular));
    setPromo(offer.promo === null ? "" : String(offer.promo));
    setPriceType(offer.priceType || "regular");
  }, [offer]);

  return (
    <div className="rounded-2xl border border-line bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">{storeName}</h4>
        {!hasStoreProduct ? <span className="text-xs text-ink-soft">Prekės nėra</span> : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-ink-soft">Įprasta
          <input inputMode="decimal" value={regular} onChange={(event) => setRegular(event.target.value)} className="input mt-1" />
        </label>
        <label className="text-xs font-semibold text-ink-soft">Akcija
          <input inputMode="decimal" value={promo} onChange={(event) => setPromo(event.target.value)} className="input mt-1" />
        </label>
      </div>
      <label className="mt-3 block text-xs font-semibold text-ink-soft">Kainos tipas
        <select value={priceType} onChange={(event) => setPriceType(event.target.value)} className="input mt-1">
          <option value="regular">regular</option>
          <option value="promo_all">promo_all</option>
          <option value="loyalty_card">loyalty_card</option>
          <option value="multi_buy">multi_buy</option>
        </select>
      </label>
      <button
        type="button"
        disabled={saving || !hasStoreProduct && !offer.storeProductId}
        onClick={() => void onSave(offer, regular, promo, priceType)}
        className="mt-3 h-10 w-full rounded-lg border border-forest/20 text-sm font-semibold text-forest disabled:opacity-50"
      >
        {hasStoreProduct ? "Išsaugoti kainą" : "Įtraukti kainą"}
      </button>
    </div>
  );
}

