import { updateSlmSettings } from './server/store.mjs';

(async () => {
    try {
        await updateSlmSettings({
            provider: "openai-compatible",
            baseUrl: "http://127.0.0.1:8000",
            model: "llama3.2:3b",
            timeoutMs: 60000
        });
        console.log("Updated config in DB to openai-compatible, 8000");
    } catch (e) {
        console.error("Error updating config:", e);
        process.exit(1);
    }
    process.exit(0);
})();
