# CET UI RC2 app shell

This directory contains the RC2 UI implementation surface.

RC2 scope:

- Tagesfläche
- Vorgangsansicht
- Nachweisansicht
- Operationskonsole

Design rules:

- The UI consumes CET only through `/api/ui/v0/` REST contracts.
- User-facing wording uses `Vorgang`; `Laufkarte` remains system language.
- Not-projected operation JSON is displayed as `Nicht projiziert` without evidence or aggregation semantics.
- CET-internal writes are allowed through REST-governed actions; Fachsystem `execute` remains out of scope.
- Repertoire, Arbeitsfläche, Lernkurve and Beitragspfad are RC2 contracts only.
