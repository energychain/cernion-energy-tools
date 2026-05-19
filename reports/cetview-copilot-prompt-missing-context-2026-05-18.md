# Context
We are working on the Cernion Energy Tools (`cernion-energy-tools`) Personal Agent (v0.52). 
Currently, when a required parameter for a multi-domain routing chain is missing (e.g., `fnavProfile` for `finance-agent.fnavEconomics`), the system aborts execution and triggers the "Conversational Onboarding". 

However, the response it generates is purely the static string from `ONBOARDING_PARAM_QUESTIONS` (e.g., "Bitte beschreiben Sie kurz das fNAV-Profil oder geben Sie den Profilnamen an."). This is a jarring experience for users, especially in a new chat session where they just provided a lot of context (e.g., "We are planning a 15 MW data center..."). They receive a dry, out-of-context technical question without knowing *why* it is being asked or what happens if they don't know the answer.

# Task
We need to evolve the "Missing Context / Conversational Onboarding" mechanism to be empathetic, contextual, and helpful, both for new users (onboarding) and experienced users starting a new session.

Please modify `services/personal-agent.service.js` (and `src/personal-agent-onboarding.js` if necessary) so that when `execution.status === 'awaiting-onboarding'` (or missing inputs are detected), the response object includes:

1. **Contextual Reasoning (Prosa):** The system must generate a short, contextual explanation (using the LLM synthesis via `this.synthesizeTurn` or similar) of *why* it is asking this specific question based on the user's initial message. (e.g., "Um die Wirtschaftlichkeit der flexiblen Vereinbarung für den Leinetal-Campus zu prüfen, benötige ich...").
2. **Alternative Actions / Next Steps:** The response must provide alternative options if the user cannot answer the question directly. This should be added to the `presentation.structuredData.nextActions` or similar fields (e.g., "Wenn das Profil noch unklar ist, können wir zunächst die technische N-1 Kapazität nach §17 EnWG prüfen").
3. **Integration into Final Response:** Ensure that the final `reply` or `presentation.markdown` seamlessly combines this empathetic reasoning, the actual required question, and the proposed alternatives, rather than just returning the static `questionText`.

# Constraints
- Maintain the strict structural L0-L4 context management. The missing parameter state must still be accurately tracked so the flow can resume.
- Do not break the existing deterministic presentation layer (`presentationApplied`, `presentationType`). The presentation should still correctly identify as an onboarding/missing context state, but the rendered output must be greatly improved.
