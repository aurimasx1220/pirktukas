import { getSupabase } from "@/lib/supabase";

export type StoreOffer = {
  storeName: string;
  regularPrice: number | null;
  promoPrice: number | null;
  loyaltyOnly: boolean;
  validUntil: string | null;
};

export type ProductCard = {
  id: string;
  name: string;
  brand: string | null;
  quantity: number | null;
  unit: string | null;
  imageUrl: string | null;
  offers: StoreOffer[];
};

export type CategorySection = {
  id: string;
  name: string;
  products: ProductCard[];
};

export type Catalog = {
  sections: CategorySection[];
  productCount: number;
  storeCount: number;
  categoryCount: number;
};

export type CatalogResult =
  | { ok: true; catalog: Catalog }
  | { ok: false, message: string };

type Row = Record<string, unknown>;

const UNCATEGORIZED_ID = "kitos";

function asRow(value: unknown): Row | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Row;
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const row = asRow(item);
    return row ? [row] : [];
  }) : [];
}

function text(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identifier(row: Row) {
  const value = row.id;
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function flag(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function timestamp(row: Row) {
  const raw = text(row, "valid_from") ?? text(row, "recorded_at") ?? text(row, "created_at") ?? text(row, "updated_at");
  if (!raw) return 0;
  const time = Date.parse(raw);
  return Number.isNaN(time) ? 0 : time;
}

function embeddedStore(row: Row) {
  const embedded = row.stores;
  const store = Array.isArray(embedded) ? asRow(embedded[0]) : asRow(embedded);
  if (!store) return null;

  const name = text(store, "name");
  if (!name) return null;

  return { id: identifier(store), name };
}

export async function loadCatalog(): Promise<CatalogResult> {
  const supabase = getSupabase();

  if (!supabase) {
    return {
      ok: false,
      message: "Supabase raktai neįrašyti.",
    };
  }

  const [categoriesResult, productsResult, storeProductsResult, pricesResult] = await Promise.all([
    supabase.from("categories").select("*"),
    supabase.from("products").select("*"),
    supabase.from("store_products").select("*, stores(*)"),
    supabase.from("prices").select("*"),
  ]);

  const failures = [
    ["categories", categoriesResult.error],
    ["products", productsResult.error],
    ["store_products", storeProductsResult.error],
    ["prices", pricesResult.error],
  ].filter((entry) => entry[1]);

  if (failures.length > 0) {
    const details = failures
      .map(([table, error]) => `${table}: ${error && typeof error === "object" && "message" in error ? String(error.message) : "nežinoma klaida"}`)
      .join(" ");

    return {
      ok: false,
      message: `Nepavyko nuskaityti duomenų. ${details}`,
    };
  }

  const categories = asRows(categoriesResult.data);
  const products = asRows(productsResult.data);
  const storeProducts = asRows(storeProductsResult.data);
  const prices = asRows(pricesResult.data);

  const latestPrice = new Map<string, Row>();

  for (const price of prices) {
    const storeProductId = text(price, "store_product_id") ?? (typeof price.store_product_id === "number" ? String(price.store_product_id) : null);
    if (!storeProductId) continue;

    const current = latestPrice.get(storeProductId);
    if (!current || timestamp(price) >= timestamp(current)) {
      latestPrice.set(storeProductId, price);
    }
  }

  const offersByProduct = new Map<string, StoreOffer[]>();

  for (const storeProduct of storeProducts) {
    const productId = text(storeProduct, "product_id") ?? (typeof storeProduct.product_id === "number" ? String(storeProduct.product_id) : null);
    const storeProductId = identifier(storeProduct);
    if (!productId || !storeProductId) continue;

    const store = embeddedStore(storeProduct);
    const price = latestPrice.get(storeProductId);
    const offer: StoreOffer = {
      storeName: store?.name ?? "Nežinoma parduotuvė",
      regularPrice: price ? numberValue(price.regular_price) : null,
      promoPrice: price ? numberValue(price.promo_price) : null,
      loyaltyOnly: price ? flag(price.loyalty_only) : false,
      validUntil: price ? text(price, "valid_until") : null,
    };

    const offers = offersByProduct.get(productId) ?? [];
    offers.push(offer);
    offersByProduct.set(productId, offers);
  }

  const categoryName = new Map<string, string>();
  const categoryOrder = new Map<string, number>();

  categories.forEach((category, index) => {
    const id = identifier(category);
    if (!id) return;
    categoryName.set(id, text(category, "name") ?? "Be pavadinimo");
    categoryOrder.set(id, numberValue(category.sort_order) ?? index);
  });

  const sections = new Map<string, CategorySection>();

  for (const product of products) {
    const id = identifier(product);
    if (!id) continue;

    const categoryId = text(product, "category_id") ?? (typeof product.category_id === "number" ? String(product.category_id) : null);
    const sectionId = categoryId && categoryName.has(categoryId) ? categoryId : UNCATEGORIZED_ID;

    if (!sections.has(sectionId)) {
      sections.set(sectionId, {
        id: sectionId,
        name: sectionId === UNCATEGORIZED_ID ? "Kitos prekės" : categoryName.get(sectionId) ?? "Kitos prekės",
        products: [],
      });
    }

    const offers = (offersByProduct.get(id) ?? []).slice().sort((a, b) => {
      const left = effectivePrice(a);
      const right = effectivePrice(b);
      if (left === null && right === null) return a.storeName.localeCompare(b.storeName, "lt");
      if (left === null) return 1;
      if (right === null) return -1;
      if (left !== right) return left - right;
      return a.storeName.localeCompare(b.storeName, "lt");
    });

    const imageUrl = text(product, "image_url");

    sections.get(sectionId)?.products.push({
      id,
      name: text(product, "name") ?? "Be pavadinimo",
      brand: text(product, "brand"),
      quantity: numberValue(product.quantity),
      unit: text(product, "unit"),
      imageUrl: imageUrl && /^https?:\/\//.test(imageUrl) ? imageUrl : null,
      offers,
    });
  }

  const orderedSections = [...sections.values()]
    .map((section) => ({
      ...section,
      products: section.products.sort((a, b) => a.name.localeCompare(b.name, "lt")),
    }))
    .sort((a, b) => {
      if (a.id === UNCATEGORIZED_ID) return 1;
      if (b.id === UNCATEGORIZED_ID) return -1;
      const order = (categoryOrder.get(a.id) ?? 0) - (categoryOrder.get(b.id) ?? 0);
      if (order !== 0) return order;
      return a.name.localeCompare(b.name, "lt");
    });

  const storeNames = new Set<string>();
  for (const offers of offersByProduct.values()) {
    for (const offer of offers) storeNames.add(offer.storeName);
  }

  return {
    ok: true,
    catalog: {
      sections: orderedSections,
      productCount: products.length,
      storeCount: storeNames.size,
      categoryCount: categories.length,
    },
  };
}

export function effectivePrice(offer: StoreOffer) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (offer.validUntil) {
    const validUntil = new Date(`${offer.validUntil}T00:00:00`);
    if (!Number.isNaN(validUntil.getTime()) && validUntil < today) {
      return offer.regularPrice;
    }
  }
  if (offer.promoPrice !== null && offer.promoPrice >= 0) return offer.promoPrice;
  if (offer.regularPrice !== null && offer.regularPrice >= 0) return offer.regularPrice;
  return null;
}

export function lowestPrice(offers: StoreOffer[]) {
  const prices = offers
    .map(effectivePrice)
    .filter((price): price is number => price !== null);

  return prices.length > 0 ? Math.min(...prices) : null;
}
