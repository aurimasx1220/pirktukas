import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type Row = Record<string, unknown>;

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

export async function POST(request: Request) {
  let body: Row = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Netinkama užklausa" }, { status: 400 });
  }

  const password = request.headers.get("x-admin-password")?.trim() ||
    (typeof body.password === "string" ? body.password.trim() : "");
  const configuredPassword = process.env.ADMIN_PASSWORD?.trim() ?? "";

  if (!configuredPassword || password !== configuredPassword) {
    return NextResponse.json(
      { message: "Neteisingas administratoriaus slaptažodis" },
      { status: 401 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { message: "Supabase serverio konfigūracija nepilna. Patikrinkite NEXT_PUBLIC_SUPABASE_URL ir SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 },
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const action = typeof body.action === "string" ? body.action : "";
  if (action === "verify") {
    return NextResponse.json({ authenticated: true, message: "Prisijungimas patvirtintas" });
  }

  if (action === "createProduct") {
    const product = body.product && typeof body.product === "object"
      ? body.product as Row
      : null;
    if (!product) return NextResponse.json({ message: "Nepateikti produkto duomenys" }, { status: 400 });

    const name = typeof product.name === "string" ? product.name.trim() : "";
    const categoryId = typeof product.categoryId === "string" ? product.categoryId : null;
    const quantity = numberValue(product.quantity);
    const unit = typeof product.unit === "string" ? product.unit : null;
    const brand = typeof product.brand === "string" && product.brand.trim() ? product.brand.trim() : null;

    if (!name || !categoryId || quantity === null || quantity <= 0 || !unit) {
      return NextResponse.json({ message: "Užpildykite teisingus produkto duomenis" }, { status: 400 });
    }

    const productPayload: Row = { name, category_id: categoryId, quantity, unit };
    if (brand) productPayload.brand = brand;

    const created = await supabase.from("products").insert(productPayload).select("*").single();
    if (created.error || !created.data) {
      return NextResponse.json({ message: `Nepavyko sukurti produkto: ${created.error?.message ?? "nežinoma klaida"}` }, { status: 400 });
    }

    const productId = identifier(created.data as Row);
    if (!productId) {
      return NextResponse.json({ message: "Produktas sukurtas, bet nepavyko gauti jo identifikatoriaus" }, { status: 500 });
    }

    const storeDrafts = Array.isArray(body.stores) ? body.stores : [];
    for (const rawStore of storeDrafts) {
      if (!rawStore || typeof rawStore !== "object") continue;
      const store = rawStore as Row;
      const storeId = typeof store.storeId === "string" ? store.storeId : null;
      const regular = numberValue(store.regular);
      if (!storeId || regular === null || regular < 0) continue;

      const promo = numberValue(store.promo);
      const priceType = typeof store.priceType === "string" ? store.priceType : "regular";
      const validUntil = typeof store.validUntil === "string" ? store.validUntil : null;

      const storeProduct = await supabase.from("store_products").insert({
        product_id: productId,
        store_id: storeId,
      }).select("*").single();

      if (storeProduct.error || !storeProduct.data) {
        return NextResponse.json({ message: `Produktas sukurtas, bet nepavyko įrašyti parduotuvės kainos: ${storeProduct.error?.message ?? "nežinoma klaida"}` }, { status: 400 });
      }

      const storeProductId = identifier(storeProduct.data as Row);
      if (!storeProductId) continue;

      const price = await supabase.from("prices").insert({
        store_product_id: storeProductId,
        regular_price: regular,
        promo_price: promo,
        price_type: priceType,
        loyalty_only: priceType === "loyalty_card",
        valid_until: validUntil,
      });

      if (price.error) {
        return NextResponse.json({ message: `Produktas sukurtas, bet nepavyko įrašyti kainos: ${price.error.message}` }, { status: 400 });
      }
    }

    return NextResponse.json({ message: `Produktas „${name}“ sėkmingai pridėtas.`, productId });
  }

  if (action === "updatePrice") {
    const productId = typeof body.productId === "string" ? body.productId : null;
    const storeId = typeof body.storeId === "string" ? body.storeId : null;
    const regular = numberValue(body.regular);
    const promo = numberValue(body.promo);
    const priceType = typeof body.priceType === "string" ? body.priceType : "regular";
    const validUntil = typeof body.validUntil === "string" ? body.validUntil : null;
    const priceId = typeof body.priceId === "string" ? body.priceId : null;

    if (!productId || !storeId || regular === null || regular < 0) {
      return NextResponse.json({ message: "Neteisingi kainos duomenys" }, { status: 400 });
    }

    let storeProductId = typeof body.storeProductId === "string" ? body.storeProductId : null;
    if (!storeProductId) {
      const existing = await supabase
        .from("store_products")
        .select("id")
        .eq("product_id", productId)
        .eq("store_id", storeId)
        .maybeSingle();

      if (existing.error) {
        return NextResponse.json({ message: `Nepavyko patikrinti parduotuvės produkto: ${existing.error.message}` }, { status: 400 });
      }

      if (existing.data) {
        storeProductId = identifier(existing.data as Row);
      } else {
        const created = await supabase
          .from("store_products")
          .insert({ product_id: productId, store_id: storeId })
          .select("*")
          .single();
        if (created.error || !created.data) {
          return NextResponse.json({ message: `Nepavyko sukurti parduotuvės produkto: ${created.error?.message ?? "nežinoma klaida"}` }, { status: 400 });
        }
        storeProductId = identifier(created.data as Row);
      }
    }

    if (!storeProductId) {
      return NextResponse.json({ message: "Nepavyko nustatyti parduotuvės produkto" }, { status: 500 });
    }

    const payload = {
      store_product_id: storeProductId,
      regular_price: regular,
      promo_price: promo,
      price_type: priceType,
      loyalty_only: priceType === "loyalty_card",
      valid_until: validUntil,
    };

    const result = priceId
      ? await supabase.from("prices").update(payload).eq("id", priceId)
      : await supabase.from("prices").insert(payload);

    if (result.error) {
      return NextResponse.json({ message: `Nepavyko atnaujinti kainos: ${result.error.message}` }, { status: 400 });
    }

    return NextResponse.json({ message: "Parduotuvės kainos sėkmingai atnaujintos." });
  }

  return NextResponse.json({ message: "Nepalaikomas administravimo veiksmas" }, { status: 400 });
}

