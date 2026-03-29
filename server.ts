import express from "express";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cors());

  // API Route for PM-CAS Risk Assessment
  app.get("/api/env", (req, res) => {
    res.json({
      status: "ok"
    });
  });

  app.post("/api/assess", async (req, res) => {
    try {
      const data = req.body;
      
      // Basic backend validation
      if (!data || Object.keys(data).length === 0) {
        return res.status(400).json({ error: "Invalid data: Request body is missing or empty." });
      }
      if (!data.applicant_name || typeof data.applicant_name !== 'string') {
        return res.status(400).json({ error: "Invalid data: Applicant name is required and must be a string." });
      }
      if (data.loan_amount === undefined || isNaN(Number(data.loan_amount)) || Number(data.loan_amount) <= 0) {
        return res.status(400).json({ error: "Invalid data: Loan amount must be a positive number." });
      }
      
      // Initialize the SDK. It will automatically use process.env.GEMINI_API_KEY
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const systemInstruction = `
## ROLE
You are the "Core Intelligence Module" for the Pride Microfinance Credit Analytics System (PM-CAS). You act as a Senior Credit Risk Officer.

## OBJECTIVE
Analyze raw financial data sent via JSON from a PHP/XAMPP backend. You must provide a high-precision risk assessment based on microfinance lending standards in Uganda.

## OPERATIONAL CONSTRAINTS
1. OUTPUT FORMAT: Always return a valid JSON object. No conversational text, no markdown, no "Here is your result."
2. RISK CALCULATION LOGIC:
   - Debt-to-Income (DTI): If Loan Amount > (Monthly Income * 5), Flag as HIGH RISK.
   - Liquidity: If Savings < (Loan Amount * 0.10), Flag as LOW CAPITAL.
   - History: If Late Payments > 2, Decision MUST be "DENY".
3. TONE: Professional, analytical, and data-driven.
`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: JSON.stringify(data),
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              assessment_id: { type: Type.STRING },
              credit_score: { type: Type.INTEGER, description: "0-100, (0=Perfect, 100=Critical Risk)" },
              decision: { type: Type.STRING, enum: ["APPROVE", "DENY", "REFER TO COMMITTEE"] },
              risk_rating: { type: Type.STRING, enum: ["Low", "Moderate", "High", "Critical"] },
              key_findings: { type: Type.ARRAY, items: { type: Type.STRING } },
              mitigation_suggestion: { type: Type.STRING },
              system_integrity_check: { type: Type.STRING }
            },
            required: ["assessment_id", "credit_score", "decision", "risk_rating", "key_findings", "mitigation_suggestion", "system_integrity_check"]
          }
        }
      });

      const resultText = response.text;
      if (!resultText) {
        throw new Error("No response from Gemini API");
      }

      const resultJson = JSON.parse(resultText);
      res.json(resultJson);
    } catch (error: any) {
      console.error("Error in /api/assess:", error);
      
      // Handle specific Gemini API errors if possible
      if (error.status === 429) {
        return res.status(429).json({ error: "Rate limit exceeded. Please try again later." });
      }
      if (error.status === 400) {
        return res.status(400).json({ error: `Invalid request to AI model: ${error.message}` });
      }

      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
