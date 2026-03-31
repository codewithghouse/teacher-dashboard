import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    server: {
      host: "::",
      port: 5173,
      hmr: { overlay: false },
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      {
        name: 'local-email-middleware',
        configureServer: (server: any) => {
          server.middlewares.use(async (req: any, res: any, next: any) => {
            if (req.url?.startsWith("/api/send-email") && req.method === "POST") {
              try {
                let body = "";
                req.on("data", (chunk: any) => { body += chunk.toString(); });
                req.on("end", async () => {
                  const { to, subject, html } = JSON.parse(body);
                  const apiKey = env.VITE_RESEND_API_KEY;

                  if (!apiKey) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: "VITE_RESEND_API_KEY is missing in .env" }));
                    return;
                  }

                  const response = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                      from: "EduIntellect <invite@edulant.dgion.com>",
                      to: Array.isArray(to) ? to : [to],
                      subject,
                      html,
                    }),
                  });

                  const result = await response.json();
                  res.setHeader("Content-Type", "application/json");
                  res.statusCode = response.status || 200;
                  res.end(JSON.stringify(result));
                });
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            } else {
              next();
            }
          });
        }
      }
    ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  };
});
