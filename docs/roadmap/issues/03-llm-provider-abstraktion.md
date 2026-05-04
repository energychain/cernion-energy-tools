# Issue 03 — LLM-Provider-Abstraktion für lokale/On-Prem-Modelle

**Bereich:** Architektur · **Priorität:** Hoch · **Ziel-Release:** v0.43

## Problem

Mit v0.40.5 wurden Finance-Agent-Aufrufe auf den zentralen `src/llm-client.js` umgestellt — der Client selbst spricht aber weiterhin exklusiv die Google-Gemini-API. Für strikte KRITIS-/Air-Gap-Deployments und Azure-EU-Tenants ist das ein harter Blocker. Das ältere Issue #35 (geschlossen 2026-03-31) hat den Bedarf bereits dokumentiert; die in v0.40 sichtbaren `LLM_NOT_CONFIGURED`-Fallbacks zeigen, dass die Plattform implizit darauf reagieren muss.

## Vorschlag

1. **Provider-Interface** in `src/llm-client.js`:
   - `generateStructured(schema, prompt, options)`
   - `generateText(prompt, options)`
   - `embeddings(texts, options)` (Voraussetzung für Issue 04)
2. **Adapter:**
   - `adapters/gemini.js` (default, bestehend)
   - `adapters/openai-compat.js` (deckt OpenAI, Azure OpenAI, vLLM, llamacpp ab)
   - `adapters/ollama.js`
3. **Konfiguration:**
   - `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`
   - `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES`
   - `LLM_STRUCTURED_MODE=schema|json|tool` (Provider-Capability-Flag)
4. **Capability-Matrix:** `client.capabilities()` → `{ structured, embeddings, vision, contextWindow }`. Aufrufer wählen Fallback bei fehlender Capability.
5. **Health-Probe:** `GET /api/system/llm/health` mit `embeddings(['ping'])` + `generateText('ping')`, Timeout 5 s.

## Akzeptanzkriterien

- Identische Finance-Agent-Pipeline läuft gegen Gemini, Azure OpenAI und Ollama (Llama-3) ohne Code-Anpassung.
- ≥25 Mock-Tests + 1 Integrationstest pro Provider hinter `LLM_INTEGRATION=true`.
- README + `BACKEND_CONTEXT.md` dokumentieren Provider-Wahl + KRITIS-Implikation.
- `prompt-scrubber.js` greift transparent vor jedem Adapter.

## Bezug

- Geschlossenes Issue #35
- v0.40.5 — `src/llm-client.js`-Refactor
- KRITIS-Constraints in `docs/BACKEND_CONTEXT.md`
