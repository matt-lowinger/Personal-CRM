import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // OAuth Endpoints (Placeholders for now)
  app.get("/api/auth/google/url", (req, res) => {
    // Logic to generate Google Auth URL
    res.json({ url: "#" });
  });

  app.get("/api/auth/linkedin/url", (req, res) => {
    // Logic to generate LinkedIn Auth URL
    res.json({ url: "#" });
  });

  // RSS Feed Proxy
  app.get("/api/rss", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL required" });
    try {
      // In a real app, use rss-parser here
      res.json({ items: [] });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch RSS" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
