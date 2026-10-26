# Synthetische Abteilungsakte Netzwirtschaft

Erzeugt durch `node scripts/generate-netzwirtschaft-fixtures.js` (Prüfung mit `--check`). Alle Namen, Kennungen und Beträge sind erfunden. Stichtag: 2026-03-02.

## Erwartete Antworten

- Offene Netznutzungsrechnungen: NNA-SYN-003, NNA-SYN-005, NNA-SYN-008, NNA-SYN-011. Offener Betrag gesamt 5.385,00 €.
- Kürzung: NNA-SYN-003 mit offenem Rest 585,00 €.
- Abgelehnt wegen Zählerstand ohne Korrekturrechnung: NNA-SYN-005.
- Ohne Zahlungsavis: NNA-SYN-011. Überfällige Reklamationsantwort: REK-SYN-01.
- Längste mittlere Durchlaufzeit: Rechnungskorrektur. Höchste Fehlerquote: Stammdatenänderung.
  - Lieferantenwechsel: 6 Vorgänge, Ø 27,00 h, Fehlerquote 16,67 %
  - Stammdatenänderung: 6 Vorgänge, Ø 37,00 h, Fehlerquote 66,67 %
  - Rechnungskorrektur: 6 Vorgänge, Ø 167,00 h, Fehlerquote 16,67 %
  - Zählerwechsel: 6 Vorgänge, Ø 57,00 h, Fehlerquote 16,67 %
- MaKo-Klärfälle: 9 Zeilen, 8 eindeutige Vorgänge (Dublette MK-SYN-02), 7 offen, überfällig zum Stichtag: MK-SYN-01, MK-SYN-02, MK-SYN-04. Häufigster Fehlercode: Z10 ID unbekannt.
