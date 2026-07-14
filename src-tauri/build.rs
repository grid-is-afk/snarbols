fn main() {
    // All compile-time env passthroughs were for the removed Pluely-Cloud/
    // PostHog code (PAYMENT_ENDPOINT, API_ACCESS_KEY, APP_ENDPOINT,
    // POSTHOG_API_KEY) and have no readers left, so they're gone.
    tauri_build::build()
}
