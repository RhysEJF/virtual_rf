# Remaining Questions

Before we fully unleash the autonomous loop, here are a few questions to clarify the "Definition of Done" for StravaDance:

1.  **AI Video Generation Provider**: The MD mentions "AI video generation engine" but doesn't specify a provider (e.g., Runway, Luma, Stable Video Diffusion). Do you have a specific API key or preference for the MVP, or should we mock this service initially?
    *   **Answered**: usage of Fal.ai (Kling v2.6) for video and Google Gemini (Imagen) for base image.
    *   **Keys**: Provided and moved to secure env.

2.  **Strava API Credentials**: Do you have the `Client ID` and `Client Secret` ready to put into `.env.local` once the scaffolding is up?
    *   **Answered**: Provided dev credentials.
    *   **Keys**: Provided and moved to secure env.

3.  **Supabase Setup**: Will you be creating the Supabase project manually and providing the URL/Anon Key, or do you expect the agent to use a CLI to set it up (which might require login)?
    *   **Answered**: Provided project credentials.
    *   **Keys**: Provided and moved to secure env.

4.  **Testing Strategy**: The Ralph method relies heavily on tests. For the visual parts (video generation), are you okay with us mocking the "success" of generation in the tests, or do you need E2E tests that actually hit APIs? (Mocking is recommended for cost/speed).
    *   **Answered**: "Absolutely not" mocking for the *real* pipeline, but agreed to split tests into Unit (Mock) vs Manual/Integration (Real) to save costs and time during the loop.
    *   **Requirement**: Video must include a watermark logo in bottom right.

5.  **Deployment**: The stack mentions Vercel. Should the loop include a deployment step/check, or just focus on getting the code committed and passing local builds?
    *   **Answered**: Local first.
