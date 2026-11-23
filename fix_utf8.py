from pathlib import Path

paths = [
    Path(r"app/admin/page.tsx"),
    Path(r"app/api/admin/route.ts"),
]

known = {
    "Ä¯raÅ¡yti": "įrašyti",
    "TrÅ«ksta": "Trūksta",
    "Å½emiau": "Žemiau",
    "paruoÅ¡tas": "paruoštas",
    "ParduotuvÄ—": "Parduotuvė",
    "nÄ—ra sukonfigÅ«ruoti": "nėra sukonfigūruoti",
    "UÅ¾pildykite": "Užpildykite",
    "pavadinimÄ…": "pavadinimą",
    "kategorijÄ…": "kategoriją",
    "kiekÄ¯": "kiekį",
    "bÅ«ti teigiamas skaiÄius": "būti teigiamas skaičius",
    "Ä®veskite": "Įveskite",
    "slaptaÅ¾odÄ¯": "slaptažodį",
    "teisingÄ… Ä¯prastÄ… kainÄ…": "teisingą įprastą kainą",
    "Neteisingas slaptaÅ¾odis": "Neteisingas slaptažodis",
    "pridÄ—ti": "pridėti",
    "pridÄ—tas": "pridėtas",
    "sÄ—kmingai": "sėkmingai",
    "ŠvieÅ¾ia": "Šviežia",
    "krÅ«tinÄ—lÄ—s": "krūtinėlės",
    "filÄ—": "filė",
    "prekÄ—s": "prekės",
    "Å¾enklas": "ženklas",
    "nebÅ«tina": "nebūtina",
    "Ä®prasta": "Įprasta",
    "TuÅ¡Äia": "Tuščia",
    "nÄ—ra": "nėra",
    "NebÅ«tina": "Nebūtina",
    "ProduktÅ³": "Produktų",
    "Ä¯raÅ¡yti": "įrašyti",
    "IÅ¡saugoti": "Išsaugoti",
    "kainÄ…": "kainą",
    "Ä¯traukti": "Įtraukti",
    "PrekÄ—s": "Prekės",
    "paruoÅ¡tas": "paruoštas",
    "teisiÅ³": "teisių",
    "netinkama": "netinkama",
    "uÅ¾klausa": "užklausa",
    "konfigÅ«racija": "konfigūracija",
    "neÅ¾inoma": "nežinoma",
    "sÄ—kmingai": "sėkmingai",
    "UÅžpildykite": "Užpildykite",
}

for path in paths:
    text = path.read_text(encoding="utf-8")

    for _ in range(3):
        try:
            recovered = text.encode("cp1252").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            break
        if recovered == text:
            break
        text = recovered

    for broken, fixed in known.items():
        text = text.replace(broken, fixed)

    text = text.replace("â€ž", "„").replace("“", "“").replace("â€œ", "“")
    text = text.replace("â†", "←").replace("Â·", "·")

    path.write_text(text, encoding="utf-8", newline="")
