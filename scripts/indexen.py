#!/usr/bin/env python3
"""Haalt de maandelijkse beursindexen (Belpex RLP en TTF RLP) op uit de parameterbladen van DATS24
en vult js/indexen.js aan met nieuwe maanden.

- Bestaande maanden worden nooit overschreven. Wijkt een gepubliceerde waarde af van wat er al
  staat, dan stopt het script met een fout (je krijgt dan een mail van GitHub) en verandert er niets.
- Geen nieuwe maanden: er verandert niets.
"""
import datetime, json, re, subprocess, sys, tempfile, urllib.request, pathlib

BASIS = 'https://api.colruytgroup.com/api/static/dats24/parameters/site/{j1}-{j2}_Parameters_{soort}_NL.pdf'
MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus',
           'september', 'oktober', 'november', 'december']
# Kolommen per jaar in het blad, en welke kolom we nodig hebben.
#   Elek: BE_SPOT RLP | BE_SPOT SPP | BE_SPOT | VNR afname | VNR teruggave  -> kolom 0
#   Gaz:  ZTP RLP | TTF RLP | VNR afname                                    -> kolom 1
SOORTEN = {'Elek': ('BELPEX_RLP', 5, 0), 'Gaz': ('TTF_RLP', 3, 1)}
BESTAND = pathlib.Path(__file__).resolve().parent.parent / 'js' / 'indexen.js'


def tekst(pdf: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix='.pdf') as f:
        f.write(pdf); f.flush()
        return subprocess.run(['pdftotext', '-layout', f.name, '-'], check=True, capture_output=True, text=True).stdout


def lees(soort: str, j1: int, pdf_tekst: str) -> dict:
    _, breedte, kolom = SOORTEN[soort]
    uit = {}
    for regel in pdf_tekst.splitlines():
        woorden = regel.split()
        if not woorden or woorden[0].lower() not in MAANDEN:
            continue
        m = MAANDEN.index(woorden[0].lower()) + 1
        getallen = [float(w.replace('.', '').replace(',', '.')) for w in woorden[1:] if re.fullmatch(r'-?\d+(?:[.,]\d+)?', w)]
        for blok, jaar in enumerate((j1, j1 + 1)):
            groep = getallen[blok * breedte:(blok + 1) * breedte]
            if len(groep) == breedte:
                uit[f'{jaar}-{m:02d}'] = groep[kolom]
    for ym, v in uit.items():
        if not 0 < v < 1000:
            sys.exit(f'Onwaarschijnlijke waarde {v} voor {ym} ({soort}); het parameterblad is misschien van vorm veranderd.')
    return uit


def huidige() -> dict:
    js = BESTAND.read_text()
    uit = {}
    for naam in ('BELPEX_RLP', 'TTF_RLP'):
        blok = re.search(naam + r' = \{(.*?)\};', js, re.S).group(1)
        uit[naam] = {k: float(v) for k, v in re.findall(r"'(\d{4}-\d{2})': ([\d.]+)", blok)}
    return uit


def schrijf(data: dict, bron: str):
    def obj(d):
        items = [f"'{k}': {d[k]:.2f}" for k in sorted(d)]
        regels = [', '.join(items[i:i + 4]) + ',' for i in range(0, len(items), 4)]
        return '{\n' + '\n'.join('  ' + r for r in regels) + '\n}'
    BESTAND.write_text(
        '// Maandelijkse beursindexen (€/MWh), RLP-gewogen.\n'
        f'// Bron: DATS24-parameterbladen ({bron}). Automatisch bijgewerkt door scripts/indexen.py.\n'
        '// Belpex RLP = BE_SPOT RLP-gewogen afname, TTF RLP = TTF RLP-gewogen afname.\n'
        '// Een maand verschijnt pas als de waarde gepubliceerd is (begin van de volgende maand).\n\n'
        f"export const BELPEX_RLP = {obj(data['BELPEX_RLP'])};\n\n"
        f"export const TTF_RLP = {obj(data['TTF_RLP'])};\n")


def main():
    data = huidige()
    nieuw, bronnen = 0, []
    jaar = datetime.date.today().year
    for j1 in (jaar - 1, jaar):
        for soort, (naam, _, _) in SOORTEN.items():
            url = BASIS.format(j1=j1, j2=j1 + 1, soort=soort)
            try:
                pdf = urllib.request.urlopen(url, timeout=60).read()
            except Exception as e:
                print(f'Niet gevonden: {url} ({e})')
                continue
            bronnen.append(f'{j1}-{j1 + 1} {soort}')
            for ym, v in lees(soort, j1, tekst(pdf)).items():
                oud = data[naam].get(ym)
                if oud is None:
                    data[naam][ym] = v; nieuw += 1
                    print(f'Nieuw: {naam} {ym} = {v}')
                elif abs(oud - v) > 0.011:
                    sys.exit(f'{naam} {ym}: blad zegt {v}, app heeft {oud}. Niets aangepast, controleer dit.')
    if not bronnen:
        sys.exit('Geen enkel parameterblad gevonden; is de adresstructuur van DATS24 veranderd?')
    if nieuw:
        schrijf(data, ', '.join(bronnen))
    print(f'{nieuw} nieuwe maand(en).')


if __name__ == '__main__':
    main()
