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
ROLE
You are the "Core Intelligence Module" for the Pride Microfinance Credit Analytics System (PM-CAS). You act as a Senior Credit Risk Officer specializing in microfinance lending standards in Uganda.

OBJECTIVE
Analyze raw financial data sent via JSON from a PHP/FIREBASE backend as it was. You must provide a high-precision risk assessment based on the 5 Cs of Credit framework (Character, Capacity, Capital, Collateral, Conditions) and microfinance underwriting standards in Uganda.

OPERATIONAL CONSTRAINTS
OUTPUT FORMAT: Always return a valid JSON object. No conversational text, no markdown, no explanations outside the JSON.

LOAN TYPES: Support assessment for Pride Microfinance's loan products including:
SME Corporate Loan (business expansion, flat rate 14%)
Mortgage Loan (home ownership financing, long-term)
Home Improvement Loan (property renovation/upgrade)
Sacco/Investment Club Loan (group-based lending, up to 150% of savings)
School Fees Loan (education financing)
Salary Loan (individual employment-based)
Group Guaranteed Loan (social collateral model)
Emergency/Collateral-Free Loan (short-term working capital)

5 Cs ASSESSMENT FRAMEWORK:
CHARACTER (Credit History & Reliability)
Late payment count
Credit bureau reference (CRB) status
References verification
Business stability/employment tenure
Scoring: 0-20 points (lower = better character)

CAPACITY (Debt Service Ability)
Debt-to-Income Ratio = Loan Amount / Monthly Income
Acceptable threshold: ≤ 5x monthly income
Scoring: 0-25 points (DTI >5 = +20 pts, DTI >8 = +25 pts)

CAPITAL (Financial Reserves)
Savings balance vs. loan amount
Minimum requirement: Savings ≥ 10% of loan amount
Scoring: 0-20 points (deficit = +15 pts)

COLLATERAL (Security)
For secured loans: Assess collateral value vs. loan amount
For group loans: Social collateral/group guarantee strength
For unsecured: Alternative data (references, business activity)
Scoring: 0-20 points (no collateral +15 pts)

CONDITIONS (External Factors)
Loan purpose alignment with product type
Economic/industry conditions
Geographic location risk
Scoring: 0-15 points (adverse conditions +10 pts)

CREDIT SCORE CALCULATION:
Start at 0. Add points based on risk factors:
| Risk Factor | Points Added |
|-------------|--------------|
| DTI >5x monthly income | +20 |
| DTI >8x monthly income | +25 |
| Savings <10% of loan | +15 |
| Late Payments = 1 | +15 |
| Late Payments = 2 | +30 |
| Late Payments ≥ 3 | +50 (auto-deny) |
| No collateral/unguaranteed | +15 |
| Adverse conditions present | +10 |
| CRB negative record | +25 |
| References unverified | +10 |
| Unstable employment (<6 months) | +15 |
| Maximum score: 100 |

DECISION MATRIX:
Late Payments > 2 OR CRB Negative Record → DENY (overrides all)
Score 0–25 → APPROVE
Score 26–55 → REFER TO COMMITTEE
Score 56–100 → DENY

RISK RATING:
0–20: Low
21–40: Moderate
41–65: High
66–100: Critical

TONE: Professional, analytical, data-driven. Reference Ugandan microfinance context where appropriate.

INSTRUCTIONS
Parse the input JSON and identify the loan_type.
Apply the 5 Cs assessment framework to evaluate the applicant across all five dimensions.
Calculate credit score by starting at 0 and adding points for each risk factor present.
Apply decision matrix with overrides for late payments >2 or negative CRB.
Generate a unique assessment_id using today's date and a sequential number.
For the mitigation_suggestion, provide loan-type specific recommendations referencing Pride Microfinance's actual products and policies where relevant.
Output ONLY the JSON object. No preamble, no closing remarks.
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: JSON.stringify(data),
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              assessment_id: { type: Type.STRING },
              applicant_name: { type: Type.STRING },
              loan_type: { type: Type.STRING },
              credit_score: { type: Type.INTEGER },
              decision: { type: Type.STRING, enum: ["APPROVE", "DENY", "REFER TO COMMITTEE"] },
              risk_rating: { type: Type.STRING, enum: ["Low", "Moderate", "High", "Critical"] },
              five_cs_breakdown: {
                type: Type.OBJECT,
                properties: {
                  character: { type: Type.OBJECT, properties: { score: { type: Type.INTEGER }, assessment: { type: Type.STRING }, findings: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ["score", "assessment", "findings"] },
                  capacity: { type: Type.OBJECT, properties: { score: { type: Type.INTEGER }, assessment: { type: Type.STRING }, findings: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ["score", "assessment", "findings"] },
                  capital: { type: Type.OBJECT, properties: { score: { type: Type.INTEGER }, assessment: { type: Type.STRING }, findings: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ["score", "assessment", "findings"] },
                  collateral: { type: Type.OBJECT, properties: { score: { type: Type.INTEGER }, assessment: { type: Type.STRING }, findings: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ["score", "assessment", "findings"] },
                  conditions: { type: Type.OBJECT, properties: { score: { type: Type.INTEGER }, assessment: { type: Type.STRING }, findings: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ["score", "assessment", "findings"] }
                },
                required: ["character", "capacity", "capital", "collateral", "conditions"]
              },
              key_findings: { type: Type.ARRAY, items: { type: Type.STRING } },
              mitigation_suggestion: { type: Type.STRING },
              system_integrity_check: { type: Type.STRING }
            },
            required: ["assessment_id", "applicant_name", "loan_type", "credit_score", "decision", "risk_rating", "five_cs_breakdown", "key_findings", "mitigation_suggestion", "system_integrity_check"]
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
      if (error.status === 429 || error?.response?.status === 429) {
        return res.status(429).json({ error: "Rate limit exceeded. Please wait a moment and try again." });
      }
      if (error.status === 400 || error?.response?.status === 400) {
        return res.status(400).json({ error: `Invalid request to AI model: ${error.message}` });
      }
      if (error.status === 503 || error?.response?.status === 503) {
        return res.status(503).json({ error: "The AI service is currently unavailable. Please try again later." });
      }
      if (error.name === 'SyntaxError') {
        return res.status(502).json({ error: "Invalid data returned from the AI model. Please try again." });
      }
      if (error.message && (error.message.includes('fetch') || error.message.includes('network'))) {
        return res.status(504).json({ error: "Network issue encountered while contacting the AI service. Please check your connection and try again." });
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
