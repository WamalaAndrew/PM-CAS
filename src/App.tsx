import React, { useState, useRef, useEffect } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, AlertCircle, CheckCircle2, ShieldAlert, FileText, Download, FileSpreadsheet, Search, Filter, UploadCloud, Trash2, LogOut, User as UserIcon, Users, Moon, Sun, DownloadCloud, RefreshCw } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, formatDistanceToNow } from "date-fns";
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from "firebase/auth";
import { doc, setDoc, getDoc, collection, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, deleteDoc } from "firebase/firestore";
import { auth, db, handleFirestoreError, OperationType } from "./firebase";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuGroup } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";

const formSchema = z.object({
  applicant_name: z.string().min(2, {
    message: "Applicant name must be at least 2 characters.",
  }),
  employment_type: z.string().min(2, {
    message: "Please select an employment type.",
  }),
  loan_amount: z.coerce.number().min(1000, {
    message: "Loan amount must be at least 1,000.",
  }),
  monthly_income: z.coerce.number().min(100, {
    message: "Monthly income must be at least 100.",
  }),
  savings: z.coerce.number().min(0, {
    message: "Savings cannot be negative.",
  }),
  late_payments: z.coerce.number().min(0, {
    message: "Late payments cannot be negative.",
  }),
  purpose: z.string().min(5, {
    message: "Please provide a brief purpose for the loan.",
  }),
  loan_purpose_details: z.string().min(10, {
    message: "Please provide more details about the loan purpose.",
  }),
});

type AssessmentResult = {
  assessment_id: string;
  credit_score: number;
  decision: "APPROVE" | "DENY" | "REFER TO COMMITTEE";
  risk_rating: "Low" | "Moderate" | "High" | "Critical";
  key_findings: string[];
  mitigation_suggestion: string;
  system_integrity_check: string;
};

type PastAssessment = AssessmentResult & {
  applicant_name: string;
  applicant_id: string;
  date: string;
  uid?: string;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<"admin" | "user" | null>(null);
  const [actualRole, setActualRole] = useState<"admin" | "user" | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pastAssessments, setPastAssessments] = useState<PastAssessment[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDecision, setFilterDecision] = useState("ALL");
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<"assessments" | "users">("assessments");
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('pmcas-dark-mode');
    return saved ? JSON.parse(saved) : false;
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Theme Listener
  useEffect(() => {
    localStorage.setItem('pmcas-dark-mode', JSON.stringify(isDarkMode));
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        // Ensure user document exists in Firestore
        const userRef = doc(db, "users", currentUser.uid);
        try {
          const userSnap = await getDoc(userRef);
          const isBootstrapAdmin = currentUser.email === "wamalaandrew632@gmail.com";
          
          if (!userSnap.exists()) {
            const initialRole = isBootstrapAdmin ? "admin" : "user";
            try {
              await setDoc(userRef, {
                uid: currentUser.uid,
                email: currentUser.email,
                displayName: currentUser.displayName,
                photoURL: currentUser.photoURL,
                role: initialRole,
                createdAt: new Date().toISOString()
              });
              setUserRole(initialRole);
              setActualRole(initialRole);
            } catch (e) {
              handleFirestoreError(e, OperationType.CREATE, `users/${currentUser.uid}`);
            }
          } else {
            const currentRole = userSnap.data().role;
            if (isBootstrapAdmin && currentRole !== "admin") {
              await updateDoc(userRef, { role: "admin" });
              setUserRole("admin");
              setActualRole("admin");
            } else {
              setUserRole(currentRole as "admin" | "user");
              setActualRole(currentRole as "admin" | "user");
            }
          }
        } catch (e) {
          handleFirestoreError(e, OperationType.GET, `users/${currentUser.uid}`);
        }
      } else {
        setPastAssessments([]); // Clear assessments on logout
        setAllUsers([]);
        setUserRole(null);
        setActualRole(null);
      }
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  // Firestore Data Listener for Assessments
  useEffect(() => {
    if (!isAuthReady || !user || !userRole) return;

    let q;
    if (userRole === "admin") {
      q = query(collection(db, "assessments"), orderBy("date", "desc"));
    } else {
      q = query(
        collection(db, "assessments"),
        where("uid", "==", user.uid),
        orderBy("date", "desc")
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const assessments: PastAssessment[] = [];
      snapshot.forEach((doc) => {
        assessments.push(doc.data() as PastAssessment);
      });
      setPastAssessments(assessments);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, "assessments");
    });

    return () => unsubscribe();
  }, [user, isAuthReady, userRole]);

  // Firestore Data Listener for Users (Admin Only)
  useEffect(() => {
    if (!isAuthReady || !user || userRole !== "admin") return;

    const q = query(collection(db, "users"), orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersList: any[] = [];
      snapshot.forEach((doc) => {
        usersList.push(doc.data());
      });
      setAllUsers(usersList);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, "users");
    });

    return () => unsubscribe();
  }, [user, isAuthReady, userRole]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error("Login error:", err);
      setError(err.message || "Failed to log in.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setResult(null);
      form.reset();
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const handleRoleChange = async (uid: string, newRole: string) => {
    try {
      const userRef = doc(db, "users", uid);
      await updateDoc(userRef, { role: newRole });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const handleDeleteUser = async (uid: string) => {
    if (userRole !== "admin") return;
    try {
      const userRef = doc(db, "users", uid);
      await deleteDoc(userRef);
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `users/${uid}`);
    }
  };

  const handleAdminOverride = async (assessmentId: string, newDecision: "APPROVE" | "DENY") => {
    if (userRole !== "admin") return;
    try {
      const assessmentRef = doc(db, "assessments", assessmentId);
      await updateDoc(assessmentRef, { 
        decision: newDecision,
        overriddenBy: user?.uid,
        overrideDate: new Date().toISOString()
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `assessments/${assessmentId}`);
    }
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      applicant_name: "",
      employment_type: "",
      loan_amount: 0,
      monthly_income: 0,
      savings: 0,
      late_payments: 0,
      purpose: "",
      loan_purpose_details: "",
    },
  });

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        form.reset({ ...form.getValues(), ...data });
        setError(null);
      } catch (err) {
        setError("Invalid file format. Please upload a valid JSON file containing applicant data.");
      }
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    setError(null);
    setResult(null);

    const applicant_id = `APP-${Math.floor(100000 + Math.random() * 900000)}`;

    try {
      // Initialize the SDK. It will automatically use process.env.GEMINI_API_KEY depending on the environment.
      // For Vercel deployments, use import.meta.env.VITE_GEMINI_API_KEY
      const apiKey = (import.meta as any).env.VITE_GEMINI_API_KEY || (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined);
      if (!apiKey) {
        throw new Error("An API Key must be set. If running on Vercel, please add VITE_GEMINI_API_KEY to your environment variables.");
      }
      const ai = new GoogleGenAI({ apiKey });
      
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
        contents: JSON.stringify(values),
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

      const data = JSON.parse(resultText);
      setResult(data);
      
      // Save to Firestore if logged in
      if (user) {
        const assessmentData: PastAssessment = {
          ...data,
          applicant_name: values.applicant_name,
          applicant_id,
          date: new Date().toISOString(),
          uid: user.uid
        };
        
        try {
          await setDoc(doc(db, "assessments", data.assessment_id), assessmentData);
        } catch (dbErr) {
          handleFirestoreError(dbErr, OperationType.CREATE, `assessments/${data.assessment_id}`);
        }
      }

    } catch (err: any) {
      console.error("Error generating assessment:", err);
      // Handle network errors (e.g., CORS, DNS resolution failure, server down)
      if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
        setError("Network error: Unable to connect to the server. Please check your internet connection and ensure the server is running.");
      } else {
        setError(err.message || "An unexpected error occurred during the assessment.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  const loadSampleData = (type: 'high' | 'low' | 'borderline') => {
    if (type === 'high') {
      form.reset({
        applicant_name: "John Doe (High Risk)",
        employment_type: "Self-Employed",
        loan_amount: 50000,
        monthly_income: 2000,
        savings: 1000,
        late_payments: 4,
        purpose: "Business Expansion",
        loan_purpose_details: "Buying new inventory for the shop but currently struggling with cash flow."
      });
    } else if (type === 'low') {
      form.reset({
        applicant_name: "Jane Smith (Low Risk)",
        employment_type: "Salaried",
        loan_amount: 5000,
        monthly_income: 3000,
        savings: 15000,
        late_payments: 0,
        purpose: "Home Renovation",
        loan_purpose_details: "Fixing the roof before the rainy season starts. Have stable job for 5 years."
      });
    } else if (type === 'borderline') {
      form.reset({
        applicant_name: "Alice Johnson (Borderline)",
        employment_type: "Contract",
        loan_amount: 15000,
        monthly_income: 3500,
        savings: 2000,
        late_payments: 1,
        purpose: "Medical Emergency",
        loan_purpose_details: "Need funds for unexpected medical bills. Have some savings but not enough."
      });
    }
  };

  const getDecisionColor = (decision: string) => {
    switch (decision) {
      case "APPROVE":
        return "bg-green-500 hover:bg-green-600";
      case "DENY":
        return "bg-red-500 hover:bg-red-600";
      case "REFER TO COMMITTEE":
        return "bg-amber-500 hover:bg-amber-600";
      default:
        return "bg-gray-500";
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "Low":
        return "text-green-600 border-green-200 bg-green-50";
      case "Moderate":
        return "text-amber-600 border-amber-200 bg-amber-50";
      case "High":
        return "text-orange-600 border-orange-200 bg-orange-50";
      case "Critical":
        return "text-red-600 border-red-200 bg-red-50";
      default:
        return "text-gray-600 border-gray-200 bg-gray-50";
    }
  };

  const exportToCSV = () => {
    if (!result) return;
    const headers = ["Assessment ID", "Applicant Name", "Credit Score", "Decision", "Risk Rating", "Key Findings", "Mitigation Suggestion"];
    const row = [
      result.assessment_id,
      form.getValues("applicant_name"),
      result.credit_score,
      result.decision,
      result.risk_rating,
      result.key_findings.join("; "),
      result.mitigation_suggestion
    ];
    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + row.map(e => `"${e}"`).join(",");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `assessment_${result.assessment_id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportAllToCSV = () => {
    if (pastAssessments.length === 0) return;
    
    const headers = [
      "Date", 
      "Assessment ID", 
      "Applicant Name", 
      "Credit Score", 
      "Decision", 
      "Risk Rating"
    ];
    
    const rows = pastAssessments.map(assessment => [
      format(new Date(assessment.date), 'yyyy-MM-dd HH:mm:ss'),
      assessment.assessment_id,
      assessment.applicant_name,
      assessment.credit_score.toString(),
      assessment.decision,
      assessment.risk_rating
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n" 
      + rows.map(row => row.map(e => `"${String(e).replace(/"/g, '""')}"`).join(",")).join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `pmcas_assessments_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const generatePDFReport = (assessment: AssessmentResult, applicantName: string, dateStr: string) => {
    const doc = new jsPDF();
    
    // Header
    doc.setFillColor(37, 99, 235); // blue-600
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.text("PM-CAS", 14, 20);
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text("Pride Microfinance Credit Analytics System", 14, 28);
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.text("Credit Assessment Report", 140, 24);
    
    // Details
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(11);
    doc.text(`Assessment ID: ${assessment.assessment_id}`, 14, 50);
    doc.text(`Applicant Name: ${applicantName}`, 14, 58);
    doc.text(`Date: ${dateStr}`, 14, 66);
    
    // Status Badge Simulation
    let decisionColor = [100, 116, 139]; // Default slate
    if (assessment.decision === 'APPROVE') decisionColor = [34, 197, 94]; // green
    if (assessment.decision === 'DENY') decisionColor = [239, 68, 68]; // red
    if (assessment.decision === 'REFER TO COMMITTEE') decisionColor = [245, 158, 11]; // amber
    
    doc.setFillColor(decisionColor[0], decisionColor[1], decisionColor[2]);
    doc.rect(140, 45, 55, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.text(assessment.decision, 167.5, 51.5, { align: 'center' });

    doc.setTextColor(50, 50, 50);
    doc.setFont("helvetica", "normal");

    autoTable(doc, {
      startY: 75,
      head: [['Metric', 'Value']],
      body: [
        ['Credit Score', assessment.credit_score.toString() + ' / 1000'],
        ['Risk Rating', assessment.risk_rating],
      ],
      headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42] },
      theme: 'grid'
    });

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 10,
      head: [['Key Findings']],
      body: assessment.key_findings.map(finding => [finding]),
      headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42] },
      theme: 'grid'
    });

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 10,
      head: [['Mitigation Suggestion']],
      body: [[assessment.mitigation_suggestion]],
      headStyles: { fillColor: [239, 246, 255], textColor: [30, 58, 138] },
      theme: 'grid'
    });
    
    // Footer
    const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text(`System Integrity: ${assessment.system_integrity_check}`, 14, pageHeight - 15);
    doc.text(`Generated on: ${format(new Date(), 'PPpp')}`, 14, pageHeight - 10);

    doc.save(`PMCAS_Report_${assessment.assessment_id}.pdf`);
  };

  const exportToPDF = () => {
    if (!result) return;
    generatePDFReport(result, form.getValues("applicant_name"), format(new Date(), 'PPpp'));
  };

  const filteredAssessments = pastAssessments.filter(assessment => {
    const matchesSearch = assessment.applicant_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          assessment.assessment_id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterDecision === "ALL" || assessment.decision === filterDecision;
    return matchesSearch && matchesFilter;
  });

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg border-slate-200">
          <CardHeader className="text-center space-y-2 pb-6">
            <div className="mx-auto p-3 bg-blue-600 rounded-xl w-fit mb-2">
              <ShieldAlert className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight text-slate-900">PM-CAS</CardTitle>
            <CardDescription className="text-base">
              Pride Microfinance Credit Analytics System
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive" className="bg-red-50 text-red-800 border-red-200">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button 
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-6 text-lg" 
              onClick={handleLogin}
              disabled={isLoggingIn}
            >
              {isLoggingIn ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <UserIcon className="mr-2 h-5 w-5" />
              )}
              Sign in with Google
            </Button>
            <p className="text-center text-sm text-slate-500 mt-4">
              Secure access restricted to authorized personnel.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8 font-sans text-slate-900 dark:text-slate-50 transition-colors duration-300">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-600 rounded-lg shrink-0">
              <ShieldAlert className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">PM-CAS</h1>
                {userRole && (
                  <Badge variant={userRole === "admin" ? "destructive" : "secondary"} className="text-xs uppercase tracking-wider">
                    {userRole === "admin" ? "Admin Interface" : "Loan Officer"}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium hidden sm:block">Pride Microfinance Credit Analytics System</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto justify-between sm:justify-end">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50"
              >
                {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
              {userRole === "admin" && (
                <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-lg">
                  <button
                    onClick={() => setActiveTab("assessments")}
                    className={`px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors ${activeTab === "assessments" ? "bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-sm" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-50"}`}
                  >
                    Assessments
                  </button>
                  <button
                    onClick={() => setActiveTab("users")}
                    className={`px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === "users" ? "bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-sm" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-50"}`}
                  >
                    <Users className="w-4 h-4 hidden sm:block" />
                    Users
                  </button>
                </div>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger className="relative h-10 w-10 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">
                <Avatar className="h-10 w-10 border border-slate-200 dark:border-slate-800">
                  <AvatarImage src={user.photoURL || ''} alt={user.displayName || 'User'} />
                  <AvatarFallback className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium">
                    {user.displayName?.charAt(0) || user.email?.charAt(0) || 'U'}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 dark:bg-slate-900 dark:border-slate-800" align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none dark:text-slate-100">{user.displayName}</p>
                      <p className="text-xs leading-none text-slate-500 dark:text-slate-400">
                        {user.email}
                      </p>
                      {userRole === "admin" && (
                        <Badge variant="outline" className="w-fit mt-2 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800">Admin</Badge>
                      )}
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator className="dark:bg-slate-800" />
                {actualRole === "admin" && (
                  <DropdownMenuItem 
                    onClick={() => {
                      setUserRole(userRole === "admin" ? "user" : "admin");
                      if (userRole === "admin") setActiveTab("assessments");
                    }} 
                    className="cursor-pointer focus:bg-slate-100 dark:focus:bg-slate-800"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    <span>View as {userRole === "admin" ? "Loan Officer" : "Admin"}</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleLogout} className="text-red-600 dark:text-red-400 cursor-pointer focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950 dark:hover:bg-slate-800">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {activeTab === "assessments" ? (
          <>
            {/* Analytics Dashboard */}
            <div className="mb-2">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                {userRole === "admin" ? "Global Analytics" : "My Analytics"}
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Assessments</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold dark:text-slate-100">{pastAssessments.length}</div>
                </CardContent>
              </Card>
              <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Approval Rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {pastAssessments.length > 0 
                      ? Math.round((pastAssessments.filter(a => a.decision === "APPROVE").length / pastAssessments.length) * 100) 
                      : 0}%
                  </div>
                </CardContent>
              </Card>
              <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">High Risk Applications</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {pastAssessments.filter(a => a.risk_rating === "High" || a.risk_rating === "Critical").length}
                  </div>
                </CardContent>
              </Card>
              <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Decisions Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="h-24 pb-0">
                  {pastAssessments.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Approve', value: pastAssessments.filter(a => a.decision === "APPROVE").length },
                            { name: 'Deny', value: pastAssessments.filter(a => a.decision === "DENY").length },
                            { name: 'Refer', value: pastAssessments.filter(a => a.decision === "REFER TO COMMITTEE").length }
                          ].filter(d => d.value > 0)}
                          cx="50%"
                          cy="50%"
                          innerRadius={20}
                          outerRadius={40}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          <Cell fill="#22c55e" />
                          <Cell fill="#ef4444" />
                          <Cell fill="#f59e0b" />
                        </Pie>
                        <RechartsTooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">No data</div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Input Form */}
          <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
            <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800 pb-4 flex flex-row items-start justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2 dark:text-slate-100">
                  <FileText className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                  Applicant Data Entry
                </CardTitle>
                <CardDescription className="mt-1 dark:text-slate-400">
                  Enter raw financial data for Gemini-PHP Bridge analysis.
                </CardDescription>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="h-8 text-xs dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" />}>
                  Load Sample Data
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="dark:bg-slate-900 dark:border-slate-800">
                  <DropdownMenuItem onClick={() => loadSampleData('low')} className="dark:text-slate-300 dark:focus:bg-slate-800">
                    Low Risk Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => loadSampleData('borderline')} className="dark:text-slate-300 dark:focus:bg-slate-800">
                    Borderline Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => loadSampleData('high')} className="dark:text-slate-300 dark:focus:bg-slate-800">
                    High Risk Profile
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent className="pt-6">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="applicant_name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-700 dark:text-slate-300">Applicant Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. John Doe" {...field} className="bg-white dark:bg-slate-950 dark:border-slate-800 dark:text-slate-100" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="employment_type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-700 dark:text-slate-300">Employment Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="bg-white dark:bg-slate-950 dark:border-slate-800 dark:text-slate-100">
                                <SelectValue placeholder="Select employment type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="dark:bg-slate-900 dark:border-slate-800">
                              <SelectItem value="Salaried" className="dark:text-slate-300 dark:focus:bg-slate-800">Salaried</SelectItem>
                              <SelectItem value="Self-Employed" className="dark:text-slate-300 dark:focus:bg-slate-800">Self-Employed</SelectItem>
                              <SelectItem value="Business Owner" className="dark:text-slate-300 dark:focus:bg-slate-800">Business Owner</SelectItem>
                              <SelectItem value="Unemployed" className="dark:text-slate-300 dark:focus:bg-slate-800">Unemployed</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="loan_amount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-700 dark:text-slate-300">Loan Amount (UGX)</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} className="bg-white dark:bg-slate-950 dark:border-slate-800 dark:text-slate-100 font-mono" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="monthly_income"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-700 dark:text-slate-300">Monthly Income (UGX)</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} className="bg-white dark:bg-slate-950 dark:border-slate-800 dark:text-slate-100 font-mono" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="savings"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-700 dark:text-slate-300">Total Savings (UGX)</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} className="bg-white dark:bg-slate-950 dark:border-slate-800 dark:text-slate-100 font-mono" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="late_payments"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-700 dark:text-slate-300">Historical Late Payments</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} className="bg-white dark:bg-slate-950 dark:border-slate-800 dark:text-slate-100 font-mono" />
                          </FormControl>
                          <FormDescription className="text-xs dark:text-slate-400">Count of &gt;30 days late</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="purpose"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-700 dark:text-slate-300">Loan Purpose</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Business Expansion" {...field} className="bg-white dark:bg-slate-950 dark:border-slate-800 dark:text-slate-100" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="loan_purpose_details"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-700 dark:text-slate-300">Loan Purpose Details</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Buying new equipment for bakery" {...field} className="bg-white dark:bg-slate-950 dark:border-slate-800 dark:text-slate-100" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="flex gap-4">
                    <Button 
                      type="button" 
                      variant="outline" 
                      className="w-1/3 text-slate-600 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800"
                      onClick={() => {
                        form.reset();
                        setResult(null);
                        setError(null);
                      }}
                      disabled={isLoading}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Clean Data
                    </Button>
                    <Button type="submit" className="w-1/3 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600" disabled={isLoading}>
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Running...
                        </>
                      ) : (
                        "Run Risk Assessment"
                      )}
                    </Button>
                    <Button 
                      type="button" 
                      variant="outline" 
                      className="w-1/3 text-slate-600 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800"
                      onClick={() => {
                        const data = form.getValues();
                        const jsonContent = JSON.stringify(data, null, 2);
                        const blob = new Blob([jsonContent], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = `applicant_data_${data.applicant_name || 'data'}.json`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                      }}
                      disabled={isLoading}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download JSON
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          {/* Results Panel */}
          <div className="space-y-6">
            {error && (
              <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Assessment Failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {isLoading && (
              <Card className="h-full flex flex-col items-center justify-center text-center p-8 border-dashed border-2 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 shadow-none animate-pulse">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-blue-400 dark:bg-blue-600 rounded-full blur-xl opacity-20 animate-pulse"></div>
                  <Loader2 className="w-12 h-12 text-blue-600 dark:text-blue-500 animate-spin relative z-10" />
                </div>
                <h3 className="text-lg font-medium text-blue-900 dark:text-blue-300">Processing Assessment</h3>
                <p className="text-sm text-blue-700 dark:text-blue-400 max-w-xs mt-2">
                  Analyzing financial data, calculating risk metrics, and generating decision matrix...
                </p>
                <div className="w-full max-w-xs mt-6 bg-blue-100 dark:bg-blue-900/50 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-blue-600 dark:bg-blue-500 h-1.5 rounded-full animate-progress w-full"></div>
                </div>
              </Card>
            )}

            {!result && !error && !isLoading && (
              <Card className="h-full flex flex-col items-center justify-center text-center p-8 border-dashed border-2 border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shadow-none">
                <div 
                  className={`w-full max-w-md p-8 border-2 border-dashed rounded-xl transition-colors cursor-pointer flex flex-col items-center justify-center mb-8 ${isDragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900'}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept=".json" 
                    onChange={handleFileChange} 
                  />
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/30 rounded-full mb-4">
                    <UploadCloud className="w-8 h-8 text-blue-500 dark:text-blue-400" />
                  </div>
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Drag & drop financial documents</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Support for JSON profile data</p>
                  <Button variant="outline" size="sm" className="text-xs dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>Browse Files</Button>
                </div>
                <ShieldAlert className="w-8 h-8 text-slate-300 dark:text-slate-700 mb-3" />
                <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300">Awaiting Data</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mt-2">
                  Submit applicant financial data or upload documents to generate a high-precision risk assessment.
                </p>
              </Card>
            )}

            {result && (
              <Card className="shadow-md border-slate-200 dark:border-slate-800 overflow-hidden dark:bg-slate-900">
                <div className="bg-slate-900 dark:bg-slate-950 text-white p-4 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-blue-400" />
                    <h3 className="font-semibold tracking-wide">ASSESSMENT REPORT</h3>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-mono text-slate-400">ID: {result.assessment_id}</span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => window.print()} className="h-8 bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white">
                        <FileText className="w-4 h-4 mr-2" />
                        Print
                      </Button>
                      <Button variant="outline" size="sm" onClick={exportToCSV} className="h-8 bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white">
                        <FileSpreadsheet className="w-4 h-4 mr-2" />
                        CSV
                      </Button>
                      <Button variant="outline" size="sm" onClick={exportToPDF} className="h-8 bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white">
                        <Download className="w-4 h-4 mr-2" />
                        PDF
                      </Button>
                    </div>
                  </div>
                </div>
                
                <CardContent className="p-0">
                  {/* Top Stats */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 dark:divide-slate-800 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950">
                    <div className="p-4 text-center">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Decision</p>
                      <Badge className={`${getDecisionColor(result.decision)} text-white px-3 py-1`}>
                        {result.decision}
                      </Badge>
                    </div>
                    <div className="p-4 text-center">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Risk Rating</p>
                      <Badge variant="outline" className={`${getRiskColor(result.risk_rating)} px-3 py-1 font-bold`}>
                        {result.risk_rating}
                      </Badge>
                    </div>
                    <div className="p-4 text-center">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Credit Score</p>
                      <div className="flex items-baseline justify-center gap-1">
                        <span className="text-3xl font-bold font-mono text-slate-800 dark:text-slate-100">{result.credit_score}</span>
                        <span className="text-xs text-slate-400">/1000</span>
                      </div>
                    </div>
                  </div>

                  {/* Findings */}
                  <div className="p-6 bg-white dark:bg-slate-950 space-y-6">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                        Key Findings
                      </h4>
                      <ul className="space-y-3">
                        {result.key_findings.map((finding, idx) => (
                          <li key={idx} className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 p-3 rounded-md border border-slate-100 dark:border-slate-800">
                            <span className="mt-1 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                            <span className="leading-relaxed">{finding}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-5 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-100 dark:border-blue-900/50">
                      <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                        Mitigation Suggestion
                      </h4>
                      <ul className="space-y-3">
                        {result.mitigation_suggestion.split('. ').filter(Boolean).map((suggestion, idx) => (
                          <li key={idx} className="flex items-start gap-3 text-sm text-blue-800 dark:text-blue-200 bg-white/50 dark:bg-slate-900/50 p-3 rounded-md border border-blue-100/50 dark:border-blue-800/50">
                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                            <span className="leading-relaxed">{suggestion}{suggestion.endsWith('.') ? '' : '.'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardContent>
                
                <CardFooter className="bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 p-4 flex justify-between items-center">
                  <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    {result.system_integrity_check}
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 font-mono">
                    Generated: {new Date().toISOString()}
                  </div>
                </CardFooter>
              </Card>
            )}
          </div>
        </div>

        {/* Past Assessments Section */}
        <div className="mt-12 space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Past Assessments</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">History of previous credit assessments.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500 dark:text-slate-400" />
                <Input
                  placeholder="Search by name or ID..."
                  className="pl-9 bg-white dark:bg-slate-950 dark:border-slate-800 dark:text-slate-100"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Select value={filterDecision} onValueChange={setFilterDecision}>
                <SelectTrigger className="w-[180px] bg-white dark:bg-slate-950 dark:border-slate-800 dark:text-slate-100">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                    <SelectValue placeholder="Filter by Decision" />
                  </div>
                </SelectTrigger>
                <SelectContent className="dark:bg-slate-900 dark:border-slate-800">
                  <SelectItem value="ALL" className="dark:text-slate-300 dark:focus:bg-slate-800">All Decisions</SelectItem>
                  <SelectItem value="APPROVE" className="dark:text-slate-300 dark:focus:bg-slate-800">Approve</SelectItem>
                  <SelectItem value="DENY" className="dark:text-slate-300 dark:focus:bg-slate-800">Deny</SelectItem>
                  <SelectItem value="REFER TO COMMITTEE" className="dark:text-slate-300 dark:focus:bg-slate-800">Refer to Committee</SelectItem>
                </SelectContent>
              </Select>
              <Button 
                variant="outline" 
                className="bg-white dark:bg-slate-950 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-900"
                onClick={exportAllToCSV}
                disabled={pastAssessments.length === 0}
              >
                <DownloadCloud className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>

          <Card className="border-slate-200 dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50 dark:bg-slate-950">
                  <TableRow className="dark:border-slate-800">
                    <TableHead className="dark:text-slate-400 whitespace-nowrap">Date</TableHead>
                    <TableHead className="dark:text-slate-400 whitespace-nowrap">Assessment ID</TableHead>
                    <TableHead className="dark:text-slate-400 whitespace-nowrap">Applicant ID</TableHead>
                    <TableHead className="dark:text-slate-400 whitespace-nowrap">Applicant</TableHead>
                    <TableHead className="dark:text-slate-400 whitespace-nowrap">Score</TableHead>
                    <TableHead className="dark:text-slate-400 whitespace-nowrap">Risk Rating</TableHead>
                    <TableHead className="dark:text-slate-400 whitespace-nowrap">Decision</TableHead>
                    {userRole === "admin" && <TableHead className="text-right dark:text-slate-400 whitespace-nowrap">Admin Action</TableHead>}
                    <TableHead className="text-right dark:text-slate-400 whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="bg-white dark:bg-slate-900">
                  {filteredAssessments.length === 0 ? (
                    <TableRow className="dark:border-slate-800">
                      <TableCell colSpan={userRole === "admin" ? 9 : 8} className="text-center py-8 text-slate-500 dark:text-slate-400">
                        No past assessments found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAssessments.map((assessment) => (
                      <TableRow key={assessment.assessment_id} className="dark:border-slate-800 dark:hover:bg-slate-800/50">
                        <TableCell className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap" title={format(new Date(assessment.date), 'PPpp')}>
                          {formatDistanceToNow(new Date(assessment.date), { addSuffix: true })}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-500 dark:text-slate-500 whitespace-nowrap">
                          {assessment.assessment_id.substring(0, 8)}...
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {assessment.applicant_id}
                        </TableCell>
                        <TableCell className="font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {assessment.applicant_name}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="font-mono dark:text-slate-300">{assessment.credit_score}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge variant="outline" className={`${getRiskColor(assessment.risk_rating)}`}>
                            {assessment.risk_rating}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge className={`${getDecisionColor(assessment.decision)} text-white`}>
                            {assessment.decision}
                          </Badge>
                        </TableCell>
                        {userRole === "admin" && (
                          <TableCell className="text-right whitespace-nowrap">
                            {assessment.decision === "REFER TO COMMITTEE" ? (
                              <div className="flex justify-end gap-2">
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="h-7 text-xs bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-900/50 hover:bg-green-100 dark:hover:bg-green-900/50" 
                                  onClick={() => handleAdminOverride(assessment.assessment_id, "APPROVE")}
                                >
                                  Approve
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="h-7 text-xs bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-900/50 hover:bg-red-100 dark:hover:bg-red-900/50" 
                                  onClick={() => handleAdminOverride(assessment.assessment_id, "DENY")}
                                >
                                  Deny
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400 dark:text-slate-500">Resolved</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell className="text-right whitespace-nowrap">
                          <div className="flex justify-end gap-1">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400"
                              onClick={() => generatePDFReport(assessment, assessment.applicant_name, format(new Date(assessment.date), 'PPpp'))}
                              title="Download PDF Report"
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
        </>
        ) : (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">User Management</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">View and manage all users in the system.</p>
            </div>
            <Card className="border-slate-200 dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50 dark:bg-slate-950">
                    <TableRow className="dark:border-slate-800">
                      <TableHead className="dark:text-slate-400 whitespace-nowrap">User</TableHead>
                      <TableHead className="dark:text-slate-400 whitespace-nowrap">Email</TableHead>
                      <TableHead className="dark:text-slate-400 whitespace-nowrap">Role</TableHead>
                      <TableHead className="dark:text-slate-400 whitespace-nowrap">Joined</TableHead>
                      <TableHead className="dark:text-slate-400 whitespace-nowrap text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="bg-white dark:bg-slate-900">
                    {allUsers.length === 0 ? (
                      <TableRow className="dark:border-slate-800">
                        <TableCell colSpan={5} className="text-center py-8 text-slate-500 dark:text-slate-400">
                          No users found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      allUsers.map((u) => (
                        <TableRow key={u.uid} className="dark:border-slate-800 dark:hover:bg-slate-800/50">
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={u.photoURL || ''} />
                                <AvatarFallback className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs">
                                  {u.displayName?.charAt(0) || u.email?.charAt(0) || 'U'}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium text-slate-900 dark:text-slate-100">{u.displayName || 'Unknown User'}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400 whitespace-nowrap">{u.email}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <Select value={u.role} onValueChange={(value) => handleRoleChange(u.uid, value)}>
                              <SelectTrigger className="w-[120px] bg-white dark:bg-slate-950 dark:border-slate-800 dark:text-slate-100">
                                <SelectValue placeholder="Select role" />
                              </SelectTrigger>
                              <SelectContent className="dark:bg-slate-900 dark:border-slate-800">
                                <SelectItem value="user" className="dark:text-slate-300 dark:focus:bg-slate-800">User</SelectItem>
                                <SelectItem value="admin" className="dark:text-slate-300 dark:focus:bg-slate-800">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-sm text-slate-500 dark:text-slate-500 whitespace-nowrap">
                            {u.createdAt ? format(new Date(u.createdAt), 'PP') : 'Unknown'}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
                              onClick={() => {
                                if (window.confirm(`Are you sure you want to delete user ${u.email}?`)) {
                                  handleDeleteUser(u.uid);
                                }
                              }}
                              title="Delete User"
                              disabled={u.uid === user?.uid} // Prevent self-deletion
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </div>
        )}
        
        <footer className="mt-16 pt-8 border-t border-slate-200 dark:border-slate-800 text-center sm:text-left flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-green-600 dark:text-green-500" />
            <span>Bank-Grade Security & Compliance Active</span>
          </div>
          <div className="flex gap-4">
            <span>&copy; {new Date().getFullYear()} Pride Microfinance</span>
            <span className="hidden sm:inline">&bull;</span>
            <span className="hidden sm:inline">v2.4.1 (Enterprise)</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
