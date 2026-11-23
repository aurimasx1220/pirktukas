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

  const prompt = `Išanalizuok šioje parduotuvės kainos etiketės nuotraukoje pateiktą informaciją. ${storeName ? `Parduotuvė: ${storeName}.` : ""} Atsakyk tik JSON objektu lietuviškais laukais ir reikšmėmis.

Reikalingos reikšmės:
- name: prekės pavadinimas lietuviškai
- brand: prekės ženklas arba tuščia eilutė
- quantity: skaičius be matavimo vieneto
- unit: g, kg, ml, l arba vnt
- regular_price: įprasta kaina kaip skaičius, eurais
- promo_price: akcijos kaina kaip skaičius arba null
- price_type: regular, promo arba loyalty_card; naudok loyalty_card, jei matoma kortelės sąlyga (Ačiū, Mano Rimi, IKI kortelė, su kortele ir pan.)

Jei akcijos kainos nėra, promo_price turi būti null, o price_type turi būti regular arba loyalty_card. Jei kainos nepavyksta tiksliai perskaityti, quantity ir kainas naudok kaip 0 arba null.`;

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

  const quantity = numberValue(parsed.quantity);
  const regularPrice = numberValue(parsed.regular_price);
  const promoPrice = numberValue(parsed.promo_price);
  const priceTypeValue = typeof parsed.price_type === "string" ? parsed.price_type : "regular";

  const output: ParsedLabel = {
    name: typeof parsed.name === "string" ? parsed.name.trim() : "",
    brand: typeof parsed.brand === "string" ? parsed.brand.trim() : "",
    quantity: quantity !== null && quantity > 0 ? quantity : 0,
    unit: normalizeUnit(parsed.unit),
    regular_price: regularPrice !== null && regularPrice >= 0 ? regularPrice : 0,
    promo_price: promoPrice !== null && promoPrice >= 0 ? promoPrice : null,
    price_type: priceTypeValue === "loyalty_card" ? "loyalty_card" : promoPrice !== null ? "promo" : "regular",
  };

  return NextResponse.json(output);
}
