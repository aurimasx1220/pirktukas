import { NextResponse } from "next/server";

type ParsedLabel = {
  name: string;
  brand: string;
  quantity: number;
  unit: "g" | "kg" | "ml" | "l" | "vnt";
  regular_price: number;
  promo_price: number | null;
  price_type: "regular" | "promo" | "loyalty_card";
};

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", ".").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeUnit(value: unknown): ParsedLabel["unit"] {
  const unit = typeof value === "string" ? value.trim().toLowerCase().replace(/\.$/, "") : "";
  if (unit === "kg" || unit === "ml" || unit === "l" || unit === "vnt" || unit === "vnt." || unit === "vienetas") {
    return unit === "vnt." || unit === "vienetas" ? "vnt" : unit as ParsedLabel["unit"];
  }
  return "g";
}

export async function POST(request: Request) {
  const password = request.headers.get("x-admin-password")?.trim() ?? "";
  const configuredPassword = process.env.ADMIN_PASSWORD?.trim() ?? "";

  if (!configuredPassword || password !== configuredPassword) {
    return NextResponse.json({ message: "Neteisingas administratoriaus slaptažodis" }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return NextResponse.json({ message: "GEMINI_API_KEY nėra sukonfigūruotas" }, { status: 500 });
  }

  let base64 = "";
  let mimeType = "image/jpeg";
  let storeName = "";

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("image");
    storeName = typeof formData.get("storeName") === "string" ? String(formData.get("storeName")) : "";

    if (!(file instanceof File)) {
      return NextResponse.json({ message: "Nuotrauka nepateikta" }, { status: 400 });
    }

    mimeType = file.type || "image/jpeg";
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    base64 = btoa(binary);
  } else {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "Netinkama užklausa" }, { status: 400 });
    }

    base64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    if (typeof body.mimeType === "string" && body.mimeType.trim()) mimeType = body.mimeType.trim();
    storeName = typeof body.storeName === "string" ? body.storeName : "";
  }

  base64 = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!base64) {
    return NextResponse.json({ message: "Nuotrauka nepateikta" }, { status: 400 });
  }

  const prompt = `Išanalizuok šią parduotuvių kainų etiketę, kainų leidinį arba kelių akcijų nuotrauką. ${storeName ? `Parduotuvė: ${storeName}.` : ""} Rask visas atskiras prekes ir grąžink tik JSON objektą lietuviškais laukais.

Grąžink struktūrą: { "items": [ { "name", "brand", "quantity", "unit", "regular_price", "promo_price", "price_type" } ] }

Kiekvienam elementui:
- name: prekės pavadinimas lietuviškai
- brand: prekės ženklas arba tuščia eilutė
- quantity: skaičius be matavimo vieneto
- unit: g, kg, ml, l arba vnt
- regular_price: įprasta kaina eurais kaip skaičius
- promo_price: akcijos kaina kaip skaičius arba null
- price_type: regular, promo arba loyalty_card

Jei nuotraukoje yra viena etiketė, items turi turėti vieną elementą. Jei yra kelių prekių leidinys, items turi apimti visas aiškiai matomas kainas. Jei kainos tiksliai neįskaitomos, quantity ir kainas nustatyk į 0 arba null.`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const geminiResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64 } },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });

  if (!geminiResponse.ok) {
    const detail = await geminiResponse.text();
    return NextResponse.json({ message: `Nepavyko nuskaityti etiketės: ${detail || "Gemini API klaida"}` }, { status: 502 });
  }

  const result = await geminiResponse.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = result.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
  if (!text) {
    return NextResponse.json({ message: "Gemini negrąžino nuskenuotų duomenų" }, { status: 502 });
  }

  let parsed: Record<string, unknown>;
  try {
    const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ message: "Nepavyko apdoroti Gemini atsakymo" }, { status: 502 });
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  if (items.length === 0) {
    return NextResponse.json({ message: "Nerasta jokių prekių" }, { status: 502 });
  }

  const output = items.map((item) => {
    const quantity = numberValue(item.quantity);
    const regularPrice = numberValue(item.regular_price);
    const promoPrice = numberValue(item.promo_price);
    const priceTypeValue = typeof item.price_type === "string" ? item.price_type : "regular";

    return {
      name: typeof item.name === "string" ? item.name.trim() : "",
      brand: typeof item.brand === "string" ? item.brand.trim() : "",
      quantity: quantity !== null && quantity > 0 ? quantity : 0,
      unit: normalizeUnit(item.unit),
      regular_price: regularPrice !== null && regularPrice >= 0 ? regularPrice : 0,
      promo_price: promoPrice !== null && promoPrice >= 0 ? promoPrice : null,
      price_type: priceTypeValue === "loyalty_card" ? "loyalty_card" : promoPrice !== null ? "promo" : "regular",
    };
  });

  return NextResponse.json({ items: output });
}
