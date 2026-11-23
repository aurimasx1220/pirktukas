"use client";

import { useEffect, useMemo, useState } from "react";
import {
  effectivePrice,
  lowestPrice,
  type Catalog,
  type ProductCard,
  type StoreOffer,
} from "@/lib/catalog";

const euro = new Intl.NumberFormat("lt-LT", {
  style: "currency",
  currency: "EUR",
});

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function unitPrice(price: number, quantity: number | null, unit: string | null) {
  if (quantity === null || quantity <= 0) return null;

  const normalizedUnit = normalizeText(unit ?? "").replace(/\.$/, "");
  let amount = quantity;
  let label = "";

  if (normalizedUnit === "g") {
    amount /= 1000;
    label = "kg";
  } else if (normalizedUnit === "ml") {
    amount /= 1000;
    label = "l";
  } else if (normalizedUnit === "kg") {
    label = "kg";
  } else if (normalizedUnit === "l") {
    label = "l";
  } else if (["vnt", "vnt.", "vienetas", "pcs", "gab"].includes(normalizedUnit)) {
    label = "vnt";
  } else {
    return null;
  }

  return { value: price / amount, label };
}

function LoyaltyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#1e3a5f]/20 bg-[#1e3a5f]/8 px-2 py-0.5 text-xs font-semibold text-[#1e3a5f]">
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
        <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.4" />
      </svg>
      Su kortele
    </span>
  );
}

type CartItem = { productId: string; quantity: number };

const CART_STORAGE_KEY = "pirktukas-cart-v1";
const CHECKED_STORAGE_KEY = "pirktukas-cart-picked-v1";
const STORE_FILTER_STORAGE_KEY = "pirktukas-store-filter-v1";

export function CatalogView({ catalog }: { catalog: Catalog }) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedStore, setSelectedStore] = useState("Visos");
  const allProductsForStores = useMemo(
    () => catalog.sections.flatMap((section) => section.products),
    [catalog.sections],
  );
  const storeOptions = ["Visos", ...Array.from(new Set(allProductsForStores.flatMap((product) => product.offers.map((offer) => offer.storeName))))];

  useEffect(() => {
    try {
      const savedStore = window.localStorage.getItem(STORE_FILTER_STORAGE_KEY);
      if (savedStore && ["Visos", "Lidl", "Norfa", "Maxima", "Rimi", "IKI"].includes(savedStore)) {
        if (savedStore === "Visos" || allProductsForStores.some((product) => product.offers.some((offer) => offer.storeName === savedStore))) {
          setSelectedStore(savedStore);
        }
      }

      const savedPicked = window.localStorage.getItem(CHECKED_STORAGE_KEY);
      if (savedPicked) {
        const parsedPicked = JSON.parse(savedPicked);
        if (Array.isArray(parsedPicked)) setPickedIds(parsedPicked.filter((id): id is string => typeof id === "string"));
      }

      const saved = window.localStorage.getItem(CART_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setCart(parsed.filter((item): item is CartItem =>
            item && typeof item.productId === "string" && Number.isInteger(item.quantity) && item.quantity > 0
          ));
        }
      }
    } catch {
      // Ignore invalid or unavailable browser storage.
    } finally {
      setCartLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (cartLoaded) {
      window.localStorage.setItem(STORE_FILTER_STORAGE_KEY, selectedStore);
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
      window.localStorage.setItem(CHECKED_STORAGE_KEY, JSON.stringify(pickedIds.filter((id) => cart.some((item) => item.productId === id))));
    }
  }, [cart, pickedIds, cartLoaded, selectedStore]);

  const visibleSections = useMemo(() => {
    const search = normalizeText(query.trim());

    return catalog.sections
      .filter((section) => activeCategory === "all" || section.id === activeCategory)
      .map((section) => ({
        ...section,
        products: section.products.filter((product) => {
          if (!search) return true;
          const searchable = normalizeText([product.name, product.brand ?? "", product.unit ?? ""].join(" "));
          return searchable.includes(search);
        }),
      }))
      .filter((section) => section.products.length > 0);
  }, [catalog.sections, query, activeCategory]);

  const visibleProductCount = visibleSections.reduce((total, section) => total + section.products.length, 0);

  const allProducts = useMemo(
    () => catalog.sections.flatMap((section) => section.products),
    [catalog.sections],
  );

  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);

  function setCartQuantity(productId: string, quantity: number) {
    setCart((current) => {
      if (quantity <= 0) return current.filter((item) => item.productId !== productId);
      const existing = current.find((item) => item.productId === productId);
      if (existing) {
        return current.map((item) => item.productId === productId ? { ...item, quantity } : item);
      }
      return [...current, { productId, quantity }];
    });
  }

  if (catalog.productCount === 0) {
    return (
      <section className="rounded-3xl border border-dashed border-line bg-card px-6 py-12 text-center">
        <h2 className="font-display text-3xl tracking-tight">Produktų dar nėra</h2>
        <p className="mx-auto mt-3 max-w-lg text-base leading-7 text-ink-soft">
          Ryšys su Supabase veikia, bet lentelėse kol kas nėra ką palyginti.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      {cartOpen ? (
        <CartPanel
          cart={cart}
          allProducts={allProducts}
          onClose={() => setCartOpen(false)}
          onSetQuantity={setCartQuantity}
          pickedIds={pickedIds}
          onTogglePicked={(productId) => setPickedIds((current) => current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId])}
          onClear={() => { setCart([]); setPickedIds([]); }}
          selectedStore={selectedStore}
        />
      ) : null}
      <div className="rounded-3xl border border-line bg-card p-4 shadow-[0_12px_32px_rgba(28,25,21,0.04)] sm:p-5">
        <label htmlFor="product-search" className="sr-only">Ieškoti produktų</label>
        <div className="flex gap-3">
          <div className="relative min-w-0 flex-1">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-soft">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              id="product-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ieškoti produktų, pvz., pienas, duona, sviestas..."
              className="h-12 w-full rounded-2xl border border-line bg-background pl-12 pr-4 text-base outline-none transition placeholder:text-ink-soft/75 focus:border-forest focus:ring-3 focus:ring-forest/10"
            />
          </div>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="relative flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-forest px-3.5 text-sm font-semibold text-white shadow-sm sm:px-5"
            aria-label={`Atidaryti krepšelį, ${cartCount} prekės`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
              <path d="M3 4h2l2.2 10.2A2 2 0 0 0 9.16 16h7.7a2 2 0 0 0 1.94-1.52L20 8H6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="9" cy="20" r="1.2" fill="currentColor" /><circle cx="17" cy="20" r="1.2" fill="currentColor" />
            </svg>
            <span className="hidden sm:inline">Krepšelis</span>
            <span className="flex size-6 items-center justify-center rounded-full bg-white text-xs font-bold text-forest tabular-nums">{cartCount}</span>
          </button>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Parduotuvės filtras">
          {storeOptions.map((storeName) => (
            <CategoryButton
              key={storeName}
              active={selectedStore === storeName}
              onClick={() => setSelectedStore(storeName)}
              label={storeName}
            />
          ))}
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Kategorijų filtras">
          <CategoryButton
            active={activeCategory === "all"}
            onClick={() => setActiveCategory("all")}
            label="Visi produktai"
          />
          {catalog.sections.map((section) => (
            <CategoryButton
              key={section.id}
              active={activeCategory === section.id}
              onClick={() => setActiveCategory(section.id)}
              label={section.name}
            />
          ))}
        </div>
      </div>

      {visibleProductCount === 0 ? (
        <section className="rounded-3xl border border-dashed border-line bg-card px-6 py-12 text-center">
          <h2 className="font-display text-2xl tracking-tight">Produktų nerasta</h2>
          <p className="mt-2 text-sm text-ink-soft">Pakeisk paieškos žodį arba pasirink kitą kategoriją.</p>
        </section>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3">
            <Stat label="Kategorijos" value={catalog.categoryCount} />
            <Stat label="Produktai" value={catalog.productCount} />
            <Stat label="Parduotuvės" value={catalog.storeCount} />
          </dl>
          {visibleSections.map((section) => (
            <section key={section.id} className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-display text-3xl tracking-tight">{section.name}</h2>
                <p className="text-sm text-ink-soft">{section.products.length}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {section.products.map((product) => (
                  <ProductCardView
                    key={product.id}
                    product={product}
                    cartQuantity={cart.find((item) => item.productId === product.id)?.quantity ?? 0}
                    onSetCartQuantity={(quantity) => setCartQuantity(product.id, quantity)}
                    selectedStore={selectedStore}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function CategoryButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition ${
        active
          ? "border-forest bg-forest text-white"
          : "border-line bg-card text-ink-soft hover:border-forest/40 hover:text-forest"
      }`}
    >
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-4 py-3">
      <dt className="text-xs font-semibold tracking-[0.14em] text-ink-soft uppercase">{label}</dt>
      <dd className="mt-1 font-display text-3xl text-forest tabular-nums">{value}</dd>
    </div>
  );
}

function ProductCardView({
  product,
  cartQuantity,
  onSetCartQuantity,
  selectedStore,
}: {
  product: ProductCard;
  cartQuantity: number;
  onSetCartQuantity: (quantity: number) => void;
  selectedStore: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleOffers = product.offers.filter((offer) => selectedStore === "Visos" || offer.storeName === selectedStore);
  const cheapest = lowestPrice(visibleOffers);
  const meta = [product.brand, product.unit ? `${product.quantity ?? ""}${product.unit}`.replace(/^/, "") : null].filter(Boolean).join(" ");

  return (
    <article
      onClick={() => setExpanded((current) => !current)}
      className="cursor-pointer flex flex-col rounded-2xl border border-line bg-card p-3 shadow-[0_8px_24px_rgba(28,25,21,0.035)] transition sm:p-4"
    >
      <div className="flex items-start gap-3">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt="" className="size-14 shrink-0 rounded-xl object-cover sm:size-16" />
        ) : (
          <div className="size-14 shrink-0 rounded-xl bg-background sm:size-16" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-base leading-5 font-semibold tracking-tight sm:text-lg">{product.name}</h3>
          {meta ? <p className="mt-1 text-xs text-ink-soft sm:text-sm">{meta}</p> : null}
        </div>
      </div>

      {visibleOffers.length === 0 ? (
        <p className="mt-3 rounded-xl bg-background px-3 py-2 text-sm text-ink-soft">Pasirinktose parduotuvėse kainų nėra.</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-1.5 border-t border-line pt-2">
          {(expanded ? visibleOffers : visibleOffers.slice(0, 1)).map((offer, index) => {
            const current = effectivePrice(offer);
            const isCheapest = cheapest !== null && current === cheapest;
            const showPromo = offer.promoPrice !== null && (offer.regularPrice === null || offer.promoPrice !== offer.regularPrice);
            const perUnit = current === null ? null : unitPrice(current, product.quantity, product.unit);

            return (
              <div key={`${offer.storeName}-${index}`} className={`flex items-center justify-between gap-3 rounded-xl px-2.5 py-2 ${isCheapest ? "bg-forest/8" : "bg-background/70"}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{offer.storeName}</p>
                    {isCheapest ? <span className="shrink-0 rounded-full bg-forest px-1.5 py-0.5 text-[10px] font-bold text-white">GERIAUSIA</span> : null}
                  </div>
                  {offer.loyaltyOnly ? <div className="mt-1"><LoyaltyBadge /></div> : null}
                </div>
                <div className="shrink-0 text-right">
                  <div className="flex items-baseline justify-end gap-2">
                    {offer.regularPrice !== null ? (
                      <span className={`tabular-nums ${showPromo ? "text-xs text-ink-soft line-through" : "text-base font-semibold"}`}>
                        {euro.format(offer.regularPrice)}
                      </span>
                    ) : null}
                    {showPromo && offer.promoPrice !== null ? (
                      <span className="text-base font-bold text-sale tabular-nums">{euro.format(offer.promoPrice)}</span>
                    ) : null}
                  </div>
                  {perUnit ? (
                    <span className="block text-[11px] text-ink-soft tabular-nums">
                      {euro.format(perUnit.value)} / {perUnit.label}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 sm:mt-auto sm:pt-1" onClick={(event) => event.stopPropagation()}>
        {cartQuantity === 0 ? (
          <button
            type="button"
            onClick={() => onSetCartQuantity(1)}
            className="h-11 w-full rounded-xl bg-forest px-4 text-sm font-semibold text-white transition hover:bg-[#163829]"
          >
            Į krepšelį
          </button>
        ) : (
          <div className="flex h-11 items-center justify-between rounded-xl border border-forest/25 bg-forest/5 px-2">
            <button type="button" onClick={() => onSetCartQuantity(cartQuantity - 1)} className="flex size-9 items-center justify-center rounded-lg text-xl font-semibold text-forest hover:bg-forest/10" aria-label={`Sumažinti ${product.name} kiekį`}>−</button>
            <span className="font-semibold tabular-nums" aria-label="Krepšelio kiekis">{cartQuantity}</span>
            <button type="button" onClick={() => onSetCartQuantity(cartQuantity + 1)} className="flex size-9 items-center justify-center rounded-lg text-xl font-semibold text-forest hover:bg-forest/10" aria-label={`Padidinti ${product.name} kiekį`}>+</button>
          </div>
        )}
      </div>
    </article>
  );
}

function CartPanel({
  cart,
  allProducts,
  onClose,
  onSetQuantity,
  pickedIds,
  onTogglePicked,
  onClear,
  selectedStore,
}: {
  cart: CartItem[];
  allProducts: ProductCard[];
  onClose: () => void;
  onSetQuantity: (productId: string, quantity: number) => void;
  pickedIds: string[];
  onTogglePicked: (productId: string) => void;
  onClear: () => void;
  selectedStore: string;
}) {
  const cartProducts = cart.flatMap((item) => {
    const product = allProducts.find((candidate) => candidate.id === item.productId);
    return product ? [{ product, quantity: item.quantity }] : [];
  });

  const storeNames = [...new Set(allProducts.flatMap((product) => product.offers.map((offer) => offer.storeName)))]
    .filter((storeName) => selectedStore === "Visos" || storeName === selectedStore)
    .sort((a, b) => a.localeCompare(b, "lt"));

  const comparisons = storeNames.map((storeName) => {
    let total = 0;
    const missing: ProductCard[] = [];

    for (const { product, quantity } of cartProducts) {
      const offer = product.offers.find((candidate) => candidate.storeName === storeName);
      const price = offer ? effectivePrice(offer) : null;
      if (price === null) missing.push(product);
      else total += price * quantity;
    }

    return { storeName, total, missing, complete: missing.length === 0 };
  });

  const availableComparisons = comparisons.filter((comparison) => comparison.missing.length < cartProducts.length);
  const cheapestTotal = availableComparisons.length
    ? Math.min(...availableComparisons.map((comparison) => comparison.total))
    : null;

  const mixedBasketTotal = cartProducts.reduce((total, { product, quantity }) => {
    const prices = product.offers
      .filter((offer) => selectedStore === "Visos" || offer.storeName === selectedStore)
      .map((offer) => effectivePrice(offer))
      .filter((price): price is number => price !== null);
    return prices.length > 0 ? total + Math.min(...prices) * quantity : total;
  }, 0);

  const mixedBasketMissing = cartProducts.filter(({ product }) =>
    product.offers
      .filter((offer) => selectedStore === "Visos" || offer.storeName === selectedStore)
      .every((offer) => effectivePrice(offer) === null)
  );

  const savings = cheapestTotal !== null ? cheapestTotal - mixedBasketTotal : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-foreground/35 backdrop-blur-[2px] sm:p-4" role="dialog" aria-modal="true" aria-label="Pirkinių krepšelis">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Uždaryti krepšelį" />
      <section className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-card shadow-2xl sm:max-w-md sm:rounded-3xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-card/95 px-5 py-4 backdrop-blur">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-forest uppercase">Pirkinių krepšelis</p>
            <h2 className="mt-1 font-display text-3xl tracking-tight">Jūsų krepšelis</h2>
            {cartProducts.length > 0 ? (
              <p className="mt-1 text-sm font-semibold text-forest">Paimta: {pickedIds.length} iš {cartProducts.length}</p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="flex size-10 items-center justify-center rounded-full border border-line text-xl text-ink-soft" aria-label="Uždaryti krepšelį">×</button>
        </header>

        <div className="flex flex-col gap-6 p-5">
          {cartProducts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line px-5 py-10 text-center">
              <p className="font-display text-2xl">Krepšelis tuščias</p>
              <p className="mt-2 text-sm text-ink-soft">Pasirinkite norimą produktą iš katalogo.</p>
            </div>
          ) : (
            <>
              <div className="flex justify-end">
                <button type="button" onClick={onClear} className="rounded-xl border border-sale/20 px-3 py-2 text-sm font-semibold text-sale">Išvalyti krepšelį</button>
              </div>
              <div className="flex flex-col gap-3">
                {cartProducts.map(({ product, quantity }) => {
                  const picked = pickedIds.includes(product.id);
                  return (
                  <article key={product.id} className={`flex items-center gap-3 rounded-2xl border p-3 transition ${picked ? "border-forest/20 bg-foreground/5 opacity-60" : "border-line"}`}>
                    <button type="button" role="checkbox" aria-checked={picked} onClick={() => onTogglePicked(product.id)} className={`flex size-7 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${picked ? "border-forest bg-forest text-white" : "border-line bg-card text-transparent"}`} aria-label={picked ? `Atžymėti ${product.name}` : `Pažymėti ${product.name}`}>✓</button>
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.imageUrl} alt="" className={`size-14 shrink-0 rounded-xl object-cover ${picked ? "grayscale" : ""}`} />
                    ) : (
                      <div className="size-14 shrink-0 rounded-xl bg-background" />
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className={`truncate font-semibold ${picked ? "line-through" : ""}`}>{product.name}</h3>
                      {product.brand ? <p className="mt-0.5 text-xs text-ink-soft">{product.brand}</p> : null}
                      <div className="mt-2 flex items-center gap-2">
                        <button type="button" onClick={() => onSetQuantity(product.id, quantity - 1)} className="flex size-8 items-center justify-center rounded-lg border border-line text-lg font-semibold" aria-label={`Sumažinti ${product.name} kiekį`}>−</button>
                        <span className="w-7 text-center text-sm font-semibold tabular-nums">{quantity}</span>
                        <button type="button" onClick={() => onSetQuantity(product.id, quantity + 1)} className="flex size-8 items-center justify-center rounded-lg border border-line text-lg font-semibold" aria-label={`Padidinti ${product.name} kiekį`}>+</button>
                        <button type="button" onClick={() => onSetQuantity(product.id, 0)} className="ml-auto text-xs font-semibold text-sale" aria-label={`Išimti ${product.name} iš krepšelio`}>Ištrinti</button>
                      </div>
                    </div>
                  </article>
                  );
                })}
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="font-display text-2xl tracking-tight">Kaina parduotuvėse</h3>
                {comparisons.map((comparison) => {
                  const isCheapest = cheapestTotal !== null && comparison.total === cheapestTotal;
                  return (
                    <article key={comparison.storeName} className={`rounded-2xl border p-4 ${isCheapest ? "border-forest bg-forest/5" : "border-line bg-card"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold">{comparison.storeName}</h4>
                            {isCheapest ? <span className="rounded-full bg-forest px-2 py-0.5 text-xs font-semibold text-white">Pigiausia</span> : null}
                          </div>
                          {comparison.complete ? (
                            <p className="mt-1 text-xs font-semibold text-forest">Visas krepšelis sukomplektuotas</p>
                          ) : (
                            <p className="mt-1 text-xs text-sale">Trūksta {comparison.missing.length} {comparison.missing.length === 1 ? "prekės" : "prekių"}: {comparison.missing.map((product) => product.name).join(", ")}</p>
                          )}
                        </div>
                        {comparison.missing.length === cartProducts.length ? (
                          <span className="text-sm font-semibold text-ink-soft">—</span>
                        ) : (
                          <strong className="shrink-0 text-lg tabular-nums">{euro.format(comparison.total)}</strong>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="font-display text-2xl tracking-tight">Parduotuvių palyginimo santrauka</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <article className="rounded-2xl border border-forest/20 bg-forest/5 p-4">
                    <p className="text-xs font-semibold tracking-[0.12em] text-forest uppercase">Pigiausias mišrus krepšelis</p>
                    <strong className="mt-1 block text-2xl text-forest tabular-nums">{euro.format(mixedBasketTotal)}</strong>
                    {mixedBasketMissing.length > 0 ? (
                      <p className="mt-1 text-xs text-sale">Trūksta {mixedBasketMissing.length} {mixedBasketMissing.length === 1 ? "prekės" : "prekių"}</p>
                    ) : (
                      <p className="mt-1 text-xs font-semibold text-forest">Visos prekės pasiekiamos įvairiose parduotuvėse</p>
                    )}
                  </article>
                  <article className="rounded-2xl border border-line bg-background p-4">
                    <p className="text-xs font-semibold tracking-[0.12em] text-ink-soft uppercase">Sutaupoma</p>
                    {savings !== null && savings > 0 ? (
                      <strong className="mt-1 block text-2xl text-sale tabular-nums">{euro.format(savings)}</strong>
                    ) : (
                      <strong className="mt-1 block text-2xl text-ink-soft tabular-nums">0,00 €</strong>
                    )}
                    <p className="mt-1 text-xs text-ink-soft">Lyginant su viena pigiausia parduotuve</p>
                  </article>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
