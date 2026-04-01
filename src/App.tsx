import React, { useState, useRef, useEffect, useMemo } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "./constants";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, AlertCircle, CheckCircle2, ShieldAlert, FileText, Download, FileSpreadsheet, Search, Filter, UploadCloud, Trash2, LogOut, User as UserIcon, Users, Moon, Sun, DownloadCloud, RefreshCw, Plus, Circle, Calendar, ExternalLink, ArrowUpDown } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, formatDistanceToNow } from "date-fns";
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "firebase/auth";
import type { User } from "firebase/auth";
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
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuGroup, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuPortal, DropdownMenuSubContent } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend, LineChart, Line, AreaChart, Area } from "recharts";

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
  applicant_name: string;
  loan_type: string;
  credit_score: number;
  decision: "APPROVE" | "DENY" | "REFER TO COMMITTEE";
  risk_rating: "Low" | "Moderate" | "High" | "Critical";
  five_cs_breakdown: {
    character: { score: number; assessment: string; findings: string[] };
    capacity: { score: number; assessment: string; findings: string[] };
    capital: { score: number; assessment: string; findings: string[] };
    collateral: { score: number; assessment: string; findings: string[] };
    conditions: { score: number; assessment: string; findings: string[] };
  };
  key_findings: string[];
  mitigation_suggestion: string;
  system_integrity_check: string;
};

type PastAssessment = AssessmentResult & {
  applicant_id: string;
  date: string;
  uid?: string;
  officer_uid?: string;
  officer_name?: string;
  officer_email?: string;
  loan_amount?: number;
  business_sector?: string;
  late_payments_count?: number;
};

const applicantFormSchema = z.object({
  loan_type: z.string().min(1, "Please select a loan type."),
  loan_amount: z.coerce.number().min(1000, "Minimum amount is 1000."),
  loan_purpose: z.string().min(5, "Please provide a brief purpose."),
  monthly_income: z.coerce.number().min(100, "Minimum income is 100."),
  savings_balance: z.coerce.number().min(0, "Cannot be negative."),
  employment_tenure_months: z.coerce.number().min(0, "Cannot be negative."),
  collateral_type: z.string().min(1, "Please select collateral type."),
  collateral_value: z.coerce.number().min(0, "Cannot be negative."),
  collateral_valuation_date: z.string().min(1, "Please specify valuation date."),
  collateral_location: z.string().min(1, "Please specify collateral location."),
  group_guarantee: z.boolean().default(false),
  business_sector: z.string().min(1, "Please specify business sector."),
  location: z.string().min(1, "Please specify location."),
});

const profileFormSchema = z.object({
  displayName: z.string().min(2, "Name must be at least 2 characters."),
  phone: z.string().min(10, "Phone number must be at least 10 characters."),
  address: z.string().min(5, "Address must be at least 5 characters."),
});

const taskFormSchema = z.object({
  applicationId: z.string().min(1, "Please select an application."),
  title: z.string().min(3, "Title must be at least 3 characters."),
  description: z.string().optional(),
  dueDate: z.string().min(1, "Please select a due date."),
  assignedTo: z.string().min(1, "Please select an assignee."),
  progress: z.coerce.number().min(0).max(100).default(0),
});

const officerReviewSchema = z.object({
  late_payments_count: z.coerce.number().min(0, "Cannot be negative."),
  crb_status: z.string().min(1, "Please select CRB status."),
  references_verified: z.boolean().default(false),
});

type LoanApplication = z.infer<typeof applicantFormSchema> & {
  id: string;
  uid: string;
  applicant_name: string;
  applicant_email: string;
  status: "pending" | "assessed" | "approved" | "denied";
  assessment_id?: string;
  createdAt: string;
};

type Task = {
  id: string;
  applicationId: string;
  title: string;
  description?: string;
  status: "pending" | "completed";
  progress: number;
  dueDate: string;
  assignedTo: string;
  createdAt: string;
};

type UserProfile = {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  role: "admin" | "loan_officer" | "admin_assistant" | "credit_analyst" | "applicant";
  createdAt: string;
  phone?: string;
  address?: string;
};

const COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899'];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<UserProfile["role"] | null>(null);
  const [actualRole, setActualRole] = useState<UserProfile["role"] | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pastAssessments, setPastAssessments] = useState<PastAssessment[]>([]);
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskSortBy, setTaskSortBy] = useState<'dueDate' | 'assignee'>('dueDate');
  const [taskSortOrder, setTaskSortOrder] = useState<'asc' | 'desc'>('asc');
  const [taskToComplete, setTaskToComplete] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDecision, setFilterDecision] = useState("ALL");
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "assessments" | "users" | "applications" | "manual" | "profile" | "tasks">("applications");
  
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<LoanApplication | null>(null);
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
            const initialRole = isBootstrapAdmin ? "admin" : "applicant";
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
            let mappedRole = currentRole;
            // Migration: if role is 'officer', map to 'loan_officer'
            if (currentRole === "officer" || currentRole === "user") mappedRole = "loan_officer";
            
            if (isBootstrapAdmin && mappedRole !== "admin") {
              await updateDoc(userRef, { role: "admin" });
              setUserRole("admin");
              setActualRole("admin");
            } else {
              setUserRole(mappedRole as UserProfile["role"]);
              setActualRole(mappedRole as UserProfile["role"]);
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
    if (userRole === "admin" || userRole === "credit_analyst") {
      q = query(collection(db, "assessments"), orderBy("date", "desc"));
    } else {
      q = query(
        collection(db, "assessments"),
        where("officer_uid", "==", user.uid),
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

  // Firestore Data Listener for Applications
  useEffect(() => {
    if (!isAuthReady || !user || !userRole) return;

    let q;
    if (userRole === "admin" || userRole === "loan_officer" || userRole === "admin_assistant" || userRole === "credit_analyst") {
      q = query(collection(db, "loanApplications"), orderBy("createdAt", "desc"));
    } else {
      q = query(
        collection(db, "loanApplications"),
        where("uid", "==", user.uid),
        orderBy("createdAt", "desc")
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const apps: LoanApplication[] = [];
      snapshot.forEach((doc) => {
        apps.push(doc.data() as LoanApplication);
      });
      setApplications(apps);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, "loanApplications");
    });

    return () => unsubscribe();
  }, [user, isAuthReady, userRole]);

  // Firestore Data Listener for Tasks
  useEffect(() => {
    if (!isAuthReady || !user || !userRole) return;

    let q;
    if (userRole === "admin" || userRole === "loan_officer" || userRole === "admin_assistant") {
      q = query(collection(db, "tasks"), orderBy("createdAt", "desc"));
    } else {
      // Applicants don't see tasks for now, or maybe only their own?
      // For now, only staff see tasks.
      return;
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const taskList: Task[] = [];
      snapshot.forEach((doc) => {
        taskList.push(doc.data() as Task);
      });
      setTasks(taskList);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, "tasks");
    });

    return () => unsubscribe();
  }, [user, isAuthReady, userRole]);

  const applicantForm = useForm<z.infer<typeof applicantFormSchema>>({
    resolver: zodResolver(applicantFormSchema) as any,
    defaultValues: {
      loan_type: "",
      loan_amount: 1000,
      loan_purpose: "",
      monthly_income: 100,
      savings_balance: 0,
      employment_tenure_months: 0,
      collateral_type: "",
      collateral_value: 0,
      collateral_valuation_date: format(new Date(), "yyyy-MM-dd"),
      collateral_location: "",
      group_guarantee: false,
      business_sector: "",
      location: "",
    },
  });

  const profileForm = useForm<z.infer<typeof profileFormSchema>>({
    resolver: zodResolver(profileFormSchema) as any,
    defaultValues: {
      displayName: "",
      phone: "",
      address: "",
    },
  });

  const taskForm = useForm<z.infer<typeof taskFormSchema>>({
    resolver: zodResolver(taskFormSchema) as any,
    defaultValues: {
      applicationId: "",
      title: "",
      description: "",
      dueDate: format(new Date(), "yyyy-MM-dd"),
      assignedTo: "",
      progress: 0,
    },
  });

  // Sync profile form when user data changes
  useEffect(() => {
    if (user && allUsers.length > 0) {
      const currentUserProfile = allUsers.find(u => u.uid === user.uid);
      if (currentUserProfile) {
        profileForm.reset({
          displayName: currentUserProfile.displayName || user.displayName || "",
          phone: currentUserProfile.phone || "",
          address: currentUserProfile.address || "",
        });
      }
    }
  }, [user, allUsers]);

  const officerForm = useForm<z.infer<typeof officerReviewSchema>>({
    resolver: zodResolver(officerReviewSchema) as any,
    defaultValues: {
      late_payments_count: 0,
      crb_status: "",
      references_verified: false,
    },
  });

  const onApplySubmit = async (values: z.infer<typeof applicantFormSchema>) => {
    if (!user) return;
    setIsLoading(true);
    try {
      const newAppRef = doc(collection(db, "loanApplications"));
      const newApp: any = {
        ...values,
        id: newAppRef.id,
        uid: user.uid,
        applicant_id: user.uid,
        applicant_name: user.displayName || "Unknown",
        applicant_email: user.email || "unknown@example.com",
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      await setDoc(newAppRef, newApp);
      setIsApplyModalOpen(false);
      applicantForm.reset();
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, "loanApplications");
    } finally {
      setIsLoading(false);
    }
  };

  const onReviewSubmit = async (values: z.infer<typeof officerReviewSchema>) => {
    if (!user || !selectedApplication) return;
    setIsLoading(true);
    setError(null);
    try {
      const payload = {
        applicant_name: selectedApplication.applicant_name,
        loan_amount: selectedApplication.loan_amount,
        loan_purpose: selectedApplication.loan_purpose,
        monthly_income: selectedApplication.monthly_income,
        savings_balance: selectedApplication.savings_balance,
        employment_tenure_months: selectedApplication.employment_tenure_months,
        late_payments_count: values.late_payments_count,
        collateral_type: selectedApplication.collateral_type,
        collateral_value: selectedApplication.collateral_value,
        group_guarantee: selectedApplication.group_guarantee,
        crb_status: values.crb_status,
        business_sector: selectedApplication.business_sector,
        location: selectedApplication.location,
        references_verified: values.references_verified,
        loan_type: selectedApplication.loan_type,
      };

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: JSON.stringify(payload),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
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

      const data = JSON.parse(resultText);
      
      const assessmentRef = doc(collection(db, "assessments"));
      const pastAssessment: PastAssessment = {
        ...data,
        applicant_id: selectedApplication.id,
        date: new Date().toISOString(),
        uid: user.uid,
        officer_uid: user.uid,
        officer_name: user.displayName || "Unknown",
        officer_email: user.email || "Unknown",
        loan_amount: selectedApplication.loan_amount,
        business_sector: selectedApplication.business_sector,
        late_payments_count: values.late_payments_count,
      };
      
      try {
        await setDoc(assessmentRef, pastAssessment);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, "assessments");
      }
      
      try {
        await updateDoc(doc(db, "loanApplications", selectedApplication.id), {
          status: "assessed",
          assessment_id: assessmentRef.id,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, "loanApplications");
      }

      setResult(data);
      setIsReviewModalOpen(false);
      officerForm.reset();
      setActiveTab("assessments");
    } catch (err: any) {
      setError(err.message || "An error occurred during assessment.");
    } finally {
      setIsLoading(false);
    }
  };

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

  const handleStatusUpdate = async (appId: string, newStatus: "approved" | "denied") => {
    try {
      const appRef = doc(db, "loanApplications", appId);
      await updateDoc(appRef, { status: newStatus });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `loanApplications/${appId}`);
    }
  };

  const handleRoleChange = async (uid: string, newRole: UserProfile["role"]) => {
    try {
      const userRef = doc(db, "users", uid);
      await updateDoc(userRef, { role: newRole });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const handleProfileUpdate = async (values: z.infer<typeof profileFormSchema>) => {
    if (!user) return;
    setIsLoading(true);
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        displayName: values.displayName,
        phone: values.phone,
        address: values.address,
      });
      setError(null);
      // Success toast or alert would be nice, but I'll just clear error
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsLoading(false);
    }
  };

  const onTaskSubmit = async (values: z.infer<typeof taskFormSchema>) => {
    if (!user) return;
    setIsLoading(true);
    try {
      const newTaskRef = doc(collection(db, "tasks"));
      const newTask: Task = {
        ...values,
        id: newTaskRef.id,
        status: "pending",
        progress: values.progress || 0,
        createdAt: new Date().toISOString(),
      };
      await setDoc(newTaskRef, newTask);
      setIsTaskModalOpen(false);
      taskForm.reset();
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, "tasks");
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleTask = async (taskId: string, currentStatus: "pending" | "completed") => {
    try {
      const taskRef = doc(db, "tasks", taskId);
      await updateDoc(taskRef, {
        status: currentStatus === "pending" ? "completed" : "pending"
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `tasks/${taskId}`);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const taskRef = doc(db, "tasks", taskId);
      await deleteDoc(taskRef);
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `tasks/${taskId}`);
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
        contents: JSON.stringify(values),
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

      const data = JSON.parse(resultText);
      setResult(data);
      
      // Save to Firestore if logged in
      if (user) {
        const assessmentData: PastAssessment = {
          ...data,
          applicant_id,
          date: new Date().toISOString(),
          uid: user.uid,
          officer_name: user.displayName || 'Unknown Officer',
          officer_email: user.email || 'Unknown Email'
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

    if (userRole === "admin") {
      headers.push("Loan Officer Name", "Loan Officer Email");
    }
    
    const rows = pastAssessments.map(assessment => {
      const row = [
        format(new Date(assessment.date), 'yyyy-MM-dd HH:mm:ss'),
        assessment.assessment_id,
        assessment.applicant_name,
        assessment.credit_score.toString(),
        assessment.decision,
        assessment.risk_rating
      ];

      if (userRole === "admin") {
        const officerName = assessment.officer_name || (allUsers.find(u => u.uid === assessment.uid)?.displayName) || 'Unknown Officer';
        const officerEmail = assessment.officer_email || (allUsers.find(u => u.uid === assessment.uid)?.email) || 'Unknown Email';
        row.push(officerName, officerEmail);
      }

      return row;
    });
    
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
        ['Credit Score', assessment.credit_score.toString() + ' / 100'],
        ['Risk Rating', assessment.risk_rating],
      ],
      headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42] },
      theme: 'grid'
    });

    const fiveCsBody = Object.entries(assessment.five_cs_breakdown).map(([c, details]: [string, any]) => [
      c.toUpperCase(),
      `${details.score} pts`,
      details.assessment,
      details.findings.join('\n')
    ]);

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 10,
      head: [['5 Cs of Credit', 'Score', 'Assessment', 'Findings']],
      body: fiveCsBody,
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

  const analyticsData = useMemo(() => {
    if (pastAssessments.length === 0) return null;

    // 1. Approval Rates by Loan Type
    const loanTypes = Array.from(new Set(pastAssessments.map(a => a.loan_type)));
    const approvalByLoanType = loanTypes.map(type => {
      const typeAssessments = pastAssessments.filter(a => a.loan_type === type);
      const approvedCount = typeAssessments.filter(a => a.decision === 'APPROVE').length;
      return {
        name: type,
        approvalRate: Math.round((approvedCount / typeAssessments.length) * 100)
      };
    });

    // 2. Average Loan Amounts by Sector
    const sectors = Array.from(new Set(pastAssessments.map(a => a.business_sector).filter(Boolean)));
    const avgAmountBySector = sectors.map(sector => {
      const sectorAssessments = pastAssessments.filter(a => a.business_sector === sector);
      const totalAmount = sectorAssessments.reduce((sum, a) => sum + (a.loan_amount || 0), 0);
      return {
        name: sector,
        avgAmount: Math.round(totalAmount / sectorAssessments.length)
      };
    });

    // 3. Delinquency Rates (Proxy: late_payments_count > 0)
    const delinquentCount = pastAssessments.filter(a => (a.late_payments_count || 0) > 0).length;
    const delinquencyData = [
      { name: 'Delinquent', value: delinquentCount },
      { name: 'On Time', value: pastAssessments.length - delinquentCount }
    ];

    // 4. Decision Distribution
    const decisions = ['APPROVE', 'DENY', 'REFER TO COMMITTEE'];
    const decisionDistribution = decisions.map(d => ({
      name: d,
      value: pastAssessments.filter(a => a.decision === d).length
    }));

    return {
      approvalByLoanType,
      avgAmountBySector,
      delinquencyData,
      decisionDistribution
    };
  }, [pastAssessments]);

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

  const sortedTasks = [...tasks].sort((a, b) => {
    if (taskSortBy === 'dueDate') {
      const dateA = new Date(a.dueDate).getTime();
      const dateB = new Date(b.dueDate).getTime();
      return taskSortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    } else if (taskSortBy === 'assignee') {
      const nameA = allUsers.find(u => u.uid === a.assignedTo)?.displayName || '';
      const nameB = allUsers.find(u => u.uid === b.assignedTo)?.displayName || '';
      return taskSortOrder === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    }
    return 0;
  });

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
                    {userRole === "admin" ? "Admin Interface" : userRole.replace('_', ' ')}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium hidden sm:block">Pride Microfinance Credit Analytics System</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto justify-between sm:justify-end min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50 shrink-0"
              >
                {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
              {userRole !== "applicant" && (
                <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-lg overflow-x-auto scrollbar-hide w-full sm:w-auto">
                  {userRole === "loan_officer" && (
                    <button
                      onClick={() => setActiveTab("dashboard")}
                      className={`px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${activeTab === "dashboard" ? "bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-sm" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-50"}`}
                    >
                      Dashboard
                    </button>
                  )}
                  {(userRole === "loan_officer" || userRole === "admin_assistant" || userRole === "credit_analyst" || userRole === "admin") && (
                    <button
                      onClick={() => setActiveTab("applications")}
                      className={`px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${activeTab === "applications" ? "bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-sm" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-50"}`}
                    >
                      Applications
                    </button>
                  )}
                  {userRole === "admin" && (
                    <button
                      onClick={() => setActiveTab("assessments")}
                      className={`px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${activeTab === "assessments" ? "bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-sm" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-50"}`}
                    >
                      Analytics
                    </button>
                  )}
                  {(userRole === "loan_officer" || userRole === "admin_assistant" || userRole === "credit_analyst" || userRole === "admin") && (
                    <button
                      onClick={() => setActiveTab("manual")}
                      className={`px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${activeTab === "manual" ? "bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-sm" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-50"}`}
                    >
                      Data Entry
                    </button>
                  )}
                  {(userRole === "loan_officer" || userRole === "admin_assistant" || userRole === "admin") && (
                    <button
                      onClick={() => setActiveTab("tasks")}
                      className={`px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${activeTab === "tasks" ? "bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-sm" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-50"}`}
                    >
                      Tasks
                    </button>
                  )}
                  {userRole === "admin" && (
                    <button
                      onClick={() => setActiveTab("users")}
                      className={`px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${activeTab === "users" ? "bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-sm" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-50"}`}
                    >
                      <Users className="w-4 h-4 hidden sm:block" />
                      User Management
                    </button>
                  )}
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
                  <DropdownMenuItem onClick={() => setActiveTab("profile")}>
                    <UserIcon className="mr-2 h-4 w-4" />
                    <span>Profile</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator className="dark:bg-slate-800" />
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
                {(actualRole === "admin" || actualRole === "loan_officer") && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="cursor-pointer focus:bg-slate-100 dark:focus:bg-slate-800">
                      <RefreshCw className="mr-2 h-4 w-4" />
                      <span>View as Role</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent className="dark:bg-slate-900 dark:border-slate-800">
                        <DropdownMenuItem onClick={() => { setUserRole("applicant"); setActiveTab("applications"); }} className="cursor-pointer">
                          Applicant
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setUserRole("loan_officer"); setActiveTab("applications"); }} className="cursor-pointer">
                          Loan Officer
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setUserRole("credit_analyst"); setActiveTab("applications"); }} className="cursor-pointer">
                          Credit Analyst
                        </DropdownMenuItem>
                        {actualRole === "admin" && (
                          <>
                            <DropdownMenuItem onClick={() => { setUserRole("admin_assistant"); setActiveTab("applications"); }} className="cursor-pointer">
                              Admin Assistant
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setUserRole("admin"); setActiveTab("assessments"); }} className="cursor-pointer">
                              Admin
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                )}
                <DropdownMenuItem onClick={handleLogout} className="text-red-600 dark:text-red-400 cursor-pointer focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950 dark:hover:bg-slate-800">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {activeTab === "dashboard" && userRole === "loan_officer" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Loan Officer Dashboard</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Overview of your pending tasks and applications.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Pending Applications</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {applications.filter(a => a.status === 'pending').length}
                  </div>
                </CardContent>
              </Card>
              <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Recent Assessments</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {pastAssessments.length}
                  </div>
                </CardContent>
              </Card>
              <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Assigned Tasks</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {tasks.filter(t => t.assignedTo === user?.uid && t.status !== 'completed').length}
                  </div>
                </CardContent>
              </Card>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold text-slate-800 dark:text-slate-200">My Tasks</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {tasks.filter(t => t.assignedTo === user?.uid && t.status !== 'completed').slice(0, 5).map(task => (
                      <div key={task.id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800">
                        <div>
                          <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{task.title}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Due: {format(new Date(task.dueDate), 'PP')}</p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setActiveTab("tasks")}>View</Button>
                      </div>
                    ))}
                    {tasks.filter(t => t.assignedTo === user?.uid && t.status !== 'completed').length === 0 && (
                      <p className="text-sm text-slate-500 dark:text-slate-400">No pending tasks assigned to you.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
              
              <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold text-slate-800 dark:text-slate-200">Recent Applications</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {applications.filter(a => a.status === 'pending').slice(0, 5).map(app => (
                      <div key={app.id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800">
                        <div>
                          <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{app.applicant_name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{app.loan_type} - {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(app.loan_amount)}</p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setActiveTab("applications")}>View</Button>
                      </div>
                    ))}
                    {applications.filter(a => a.status === 'pending').length === 0 && (
                      <p className="text-sm text-slate-500 dark:text-slate-400">No pending applications.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {activeTab === "applications" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Loan Applications</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">View and manage loan applications.</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500 dark:text-slate-400" />
                  <Input
                    type="search"
                    placeholder="Search applicant name or ID..."
                    className="pl-8 w-[250px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <Select value={filterDecision} onValueChange={setFilterDecision}>
                  <SelectTrigger className="w-[180px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending Review</SelectItem>
                    <SelectItem value="assessed">Assessed</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="denied">Denied</SelectItem>
                  </SelectContent>
                </Select>
                {userRole === "applicant" && (
                  <Dialog open={isApplyModalOpen} onOpenChange={setIsApplyModalOpen}>
                    <DialogTrigger render={<Button className="bg-blue-600 hover:bg-blue-700 text-white" />}>
                      Apply for Loan
                    </DialogTrigger>
                  <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Loan Application</DialogTitle>
                      <DialogDescription>
                        Fill out the details below to apply for a loan.
                      </DialogDescription>
                    </DialogHeader>
                    <Form {...applicantForm}>
                      <form onSubmit={applicantForm.handleSubmit(onApplySubmit)} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={applicantForm.control}
                            name="loan_type"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Loan Type</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select type" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="SME Corporate Loan">SME Corporate Loan</SelectItem>
                                    <SelectItem value="Mortgage Loan">Mortgage Loan</SelectItem>
                                    <SelectItem value="Home Improvement Loan">Home Improvement Loan</SelectItem>
                                    <SelectItem value="Sacco/Investment Club Loan">Sacco/Investment Club Loan</SelectItem>
                                    <SelectItem value="School Fees Loan">School Fees Loan</SelectItem>
                                    <SelectItem value="Agriculture/Agribusiness Loan">Agriculture/Agribusiness Loan</SelectItem>
                                    <SelectItem value="Salary Loan">Salary Loan</SelectItem>
                                    <SelectItem value="Asset Financing Loan">Asset Financing Loan</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={applicantForm.control}
                            name="loan_amount"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Amount (UGX)</FormLabel>
                                <FormControl>
                                  <Input type="number" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={applicantForm.control}
                            name="loan_purpose"
                            render={({ field }) => (
                              <FormItem className="col-span-2">
                                <FormLabel>Purpose</FormLabel>
                                <FormControl>
                                  <Input {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={applicantForm.control}
                            name="monthly_income"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Monthly Income (UGX)</FormLabel>
                                <FormControl>
                                  <Input type="number" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={applicantForm.control}
                            name="savings_balance"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Savings Balance (UGX)</FormLabel>
                                <FormControl>
                                  <Input type="number" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={applicantForm.control}
                            name="employment_tenure_months"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Employment/Business Tenure (Months)</FormLabel>
                                <FormControl>
                                  <Input type="number" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={applicantForm.control}
                            name="collateral_type"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Collateral Type</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select collateral" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="Land Title">Land Title</SelectItem>
                                    <SelectItem value="Vehicle Logbook">Vehicle Logbook</SelectItem>
                                    <SelectItem value="Business Assets">Business Assets</SelectItem>
                                    <SelectItem value="Guarantors">Guarantors</SelectItem>
                                    <SelectItem value="None">None</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={applicantForm.control}
                            name="collateral_value"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Collateral Value (UGX)</FormLabel>
                                <FormControl>
                                  <Input type="number" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={applicantForm.control}
                            name="collateral_valuation_date"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Valuation Date</FormLabel>
                                <FormControl>
                                  <Input type="date" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={applicantForm.control}
                            name="collateral_location"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Collateral Location</FormLabel>
                                <FormControl>
                                  <Input {...field} placeholder="e.g. Plot 123, Kampala" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={applicantForm.control}
                            name="business_sector"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Business Sector</FormLabel>
                                <FormControl>
                                  <Input {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={applicantForm.control}
                            name="location"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Location</FormLabel>
                                <FormControl>
                                  <Input {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <DialogFooter>
                          <Button type="submit" disabled={isLoading}>
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Submit Application
                          </Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
          <Card className="border-slate-200 dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50 dark:bg-slate-950">
                    <TableRow className="dark:border-slate-800">
                      <TableHead className="dark:text-slate-400 whitespace-nowrap">Date</TableHead>
                      <TableHead className="dark:text-slate-400 whitespace-nowrap">Applicant</TableHead>
                      <TableHead className="dark:text-slate-400 whitespace-nowrap">Loan Type</TableHead>
                      <TableHead className="dark:text-slate-400 whitespace-nowrap">Amount</TableHead>
                      <TableHead className="dark:text-slate-400 whitespace-nowrap">Status</TableHead>
                      <TableHead className="text-right dark:text-slate-400 whitespace-nowrap">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="bg-white dark:bg-slate-900">
                    {applications.filter(app => {
                      const matchesSearch = app.applicant_name.toLowerCase().includes(searchQuery.toLowerCase()) || app.id.toLowerCase().includes(searchQuery.toLowerCase());
                      const matchesStatus = filterDecision === "ALL" || app.status === filterDecision;
                      return matchesSearch && matchesStatus;
                    }).length === 0 ? (
                      <TableRow className="dark:border-slate-800">
                        <TableCell colSpan={6} className="text-center py-8 text-slate-500 dark:text-slate-400">
                          No applications found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      applications.filter(app => {
                        const matchesSearch = app.applicant_name.toLowerCase().includes(searchQuery.toLowerCase()) || app.id.toLowerCase().includes(searchQuery.toLowerCase());
                        const matchesStatus = filterDecision === "ALL" || app.status === filterDecision;
                        return matchesSearch && matchesStatus;
                      }).map((app) => (
                        <TableRow key={app.id} className="dark:border-slate-800 dark:hover:bg-slate-800/50">
                          <TableCell className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                          </TableCell>
                          <TableCell className="font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {app.applicant_name}
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {app.loan_type}
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(app.loan_amount)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <Badge variant={app.status === "pending" ? "secondary" : app.status === "approved" ? "default" : app.status === "denied" ? "destructive" : "outline"}>
                              {app.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            {userRole !== "applicant" && app.status === "pending" && (
                              <Dialog open={isReviewModalOpen && selectedApplication?.id === app.id} onOpenChange={(open) => {
                                setIsReviewModalOpen(open);
                                if (open) setSelectedApplication(app);
                                else setSelectedApplication(null);
                              }}>
                                <DialogTrigger render={<Button size="sm" variant="outline" />}>
                                  Review
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>Review Application</DialogTitle>
                                    <DialogDescription>
                                      Provide officer details to assess this application.
                                    </DialogDescription>
                                  </DialogHeader>
                                  <Form {...officerForm}>
                                    <form onSubmit={officerForm.handleSubmit(onReviewSubmit)} className="space-y-4">
                                      <FormField
                                        control={officerForm.control}
                                        name="late_payments_count"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Late Payments Count</FormLabel>
                                            <FormControl>
                                              <Input type="number" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={officerForm.control}
                                        name="crb_status"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>CRB Status</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                              <FormControl>
                                                <SelectTrigger>
                                                  <SelectValue placeholder="Select status" />
                                                </SelectTrigger>
                                              </FormControl>
                                              <SelectContent>
                                                <SelectItem value="Clear">Clear</SelectItem>
                                                <SelectItem value="Listed">Listed</SelectItem>
                                                <SelectItem value="Unknown">Unknown</SelectItem>
                                              </SelectContent>
                                            </Select>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <DialogFooter>
                                        <Button type="submit" disabled={isLoading}>
                                          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                          Assess Application
                                        </Button>
                                      </DialogFooter>
                                    </form>
                                  </Form>
                                </DialogContent>
                              </Dialog>
                            )}
                            {userRole !== "applicant" && app.status === "assessed" && (
                              <div className="flex justify-end gap-2">
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="h-8 text-xs bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-900/50 hover:bg-green-100 dark:hover:bg-green-900/50" 
                                  onClick={() => handleStatusUpdate(app.id, "approved")}
                                >
                                  Approve
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="h-8 text-xs bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-900/50 hover:bg-red-100 dark:hover:bg-red-900/50" 
                                  onClick={() => handleStatusUpdate(app.id, "denied")}
                                >
                                  Deny
                                </Button>
                              </div>
                            )}
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

        {activeTab === "assessments" && (
          <>
            {/* Analytics Dashboard */}
            <div className="mb-2">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                {userRole === "admin" ? "Global Analytics" : "My Analytics"}
              </h2>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <Card className="border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader>
                  <CardTitle className="text-sm font-medium dark:text-slate-100">Approval Rate by Loan Type</CardTitle>
                </CardHeader>
                <CardContent className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={Object.entries(applications.reduce((acc, app) => {
                      if (!acc[app.loan_type]) acc[app.loan_type] = { total: 0, approved: 0 };
                      acc[app.loan_type].total++;
                      if (app.status === 'Approved') acc[app.loan_type].approved++;
                      return acc;
                    }, {} as Record<string, { total: number, approved: number }>)).map(([type, stats]) => ({
                      name: type,
                      rate: (stats as { total: number, approved: number }).total > 0 ? Math.round(((stats as { total: number, approved: number }).approved / (stats as { total: number, approved: number }).total) * 100) : 0
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
                      <YAxis fontSize={10} axisLine={false} tickLine={false} unit="%" />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                        itemStyle={{ color: '#60a5fa' }}
                      />
                      <Bar dataKey="rate" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader>
                  <CardTitle className="text-sm font-medium dark:text-slate-100">Loan Distribution by Sector</CardTitle>
                </CardHeader>
                <CardContent className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={Object.entries(applications.reduce((acc, app) => {
                          acc[app.business_sector] = (acc[app.business_sector] || 0) + app.loan_amount;
                          return acc;
                        }, {} as Record<string, number>)).map(([sector, amount]) => ({
                          name: sector,
                          value: amount
                        }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'].map((color, index) => (
                          <Cell key={`cell-${index}`} fill={color} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        formatter={(value: number) => `UGX ${value.toLocaleString()}`}
                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                      />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
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
          </>
        )}

        {activeTab === "manual" && (
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
              {user?.email === "wamalaandrew632@gmail.com" && (
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
              )}
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

            {!isLoading && (
              <Card className={`flex flex-col items-center justify-center text-center p-6 border-dashed border-2 border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shadow-none ${!result ? 'h-full p-8' : 'mb-6'}`}>
                <div 
                  className={`w-full max-w-md p-6 border-2 border-dashed rounded-xl transition-colors cursor-pointer flex flex-col items-center justify-center ${!result ? 'mb-8' : ''} ${isDragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900'}`}
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
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-full mb-3">
                    <UploadCloud className="w-6 h-6 text-blue-500 dark:text-blue-400" />
                  </div>
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Drag & drop financial documents</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Support for JSON profile data</p>
                  <Button variant="outline" size="sm" className="text-xs dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>Browse Files</Button>
                </div>
                {!result && (
                  <>
                    <ShieldAlert className="w-8 h-8 text-slate-300 dark:text-slate-700 mb-3" />
                    <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300">Awaiting Data</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mt-2">
                      Submit applicant financial data or upload documents to generate a high-precision risk assessment.
                    </p>
                  </>
                )}
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
                        <span className="text-xs text-slate-400">/100</span>
                      </div>
                    </div>
                  </div>

                  {/* 5 Cs Breakdown */}
                  <div className="p-6 bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 uppercase tracking-wider mb-4 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                      5 Cs of Credit Breakdown
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {Object.entries(result.five_cs_breakdown).map(([c, details]: [string, any]) => (
                        <Card key={c} className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-950">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-bold uppercase text-slate-700 dark:text-slate-300 flex justify-between">
                              {c}
                              <span className="text-blue-600 dark:text-blue-400">{details.score} pts</span>
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">{details.assessment}</p>
                            <ul className="space-y-1">
                              {details.findings.map((f, i) => (
                                <li key={i} className="text-xs text-slate-500 dark:text-slate-500 flex items-start gap-1">
                                  <span className="mt-1 w-1 h-1 rounded-full bg-slate-400 shrink-0" />
                                  {f}
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                      ))}
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
        )}

        {activeTab === "assessments" && (
        <div className="space-y-8">
          {/* Analytics Dashboard Section */}
          {analyticsData && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="p-6 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-6">Approval Rate by Loan Type (%)</h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analyticsData.approvalByLoanType}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" fontSize={10} tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} fontSize={10} tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                        itemStyle={{ color: '#3b82f6' }}
                      />
                      <Bar dataKey="approvalRate" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-6 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-6">Decision Distribution</h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={analyticsData.decisionDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {analyticsData.decisionDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                      />
                      <Legend verticalAlign="bottom" height={36} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-6 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-6">Average Loan Amount by Sector</h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analyticsData.avgAmountBySector} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis type="number" fontSize={10} tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis dataKey="name" type="category" fontSize={10} tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} width={100} />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                      />
                      <Bar dataKey="avgAmount" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-6 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-6">Delinquency Status</h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={analyticsData.delinquencyData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        <Cell fill="#ef4444" />
                        <Cell fill="#22c55e" />
                      </Pie>
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                      />
                      <Legend verticalAlign="bottom" height={36} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          )}

          {/* Past Assessments Section */}
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
                    {userRole === "admin" && <TableHead className="dark:text-slate-400 whitespace-nowrap">Loan Officer</TableHead>}
                    {userRole === "admin" && <TableHead className="text-right dark:text-slate-400 whitespace-nowrap">Admin Action</TableHead>}
                    <TableHead className="text-right dark:text-slate-400 whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="bg-white dark:bg-slate-900">
                  {filteredAssessments.length === 0 ? (
                    <TableRow className="dark:border-slate-800">
                      <TableCell colSpan={userRole === "admin" ? 10 : 8} className="text-center py-8 text-slate-500 dark:text-slate-400">
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
                          <TableCell className="whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                {assessment.officer_name || (allUsers.find(u => u.uid === assessment.uid)?.displayName) || 'Unknown Officer'}
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {assessment.officer_email || (allUsers.find(u => u.uid === assessment.uid)?.email) || ''}
                              </span>
                            </div>
                          </TableCell>
                        )}
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
        )}

        {activeTab === "users" && userRole === "admin" && (
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
                            <Select value={u.role || ""} onValueChange={(value) => handleRoleChange(u.uid, value)}>
                              <SelectTrigger className="w-[120px] bg-white dark:bg-slate-950 dark:border-slate-800 dark:text-slate-100">
                                <SelectValue placeholder="Select role" />
                              </SelectTrigger>
                              <SelectContent className="dark:bg-slate-900 dark:border-slate-800">
                                <SelectItem value="applicant" className="dark:text-slate-300 dark:focus:bg-slate-800">Applicant</SelectItem>
                                <SelectItem value="loan_officer" className="dark:text-slate-300 dark:focus:bg-slate-800">Loan Officer</SelectItem>
                                <SelectItem value="admin_assistant" className="dark:text-slate-300 dark:focus:bg-slate-800">Admin Assistant</SelectItem>
                                <SelectItem value="credit_analyst" className="dark:text-slate-300 dark:focus:bg-slate-800">Credit Analyst</SelectItem>
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

        {activeTab === "tasks" && (userRole === "admin" || userRole === "loan_officer" || userRole === "admin_assistant" || userRole === "credit_analyst") && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Tasks & Follow-ups</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Manage your loan application related tasks.</p>
              </div>
              <div className="flex items-center gap-2">
                <Select value={taskSortBy} onValueChange={(v: any) => setTaskSortBy(v)}>
                  <SelectTrigger className="w-[140px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-xs">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dueDate">Due Date</SelectItem>
                    <SelectItem value="assignee">Assignee</SelectItem>
                  </SelectContent>
                </Select>
                <Button 
                  variant="outline" 
                  size="icon" 
                  onClick={() => setTaskSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                  className="h-10 w-10 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                >
                  <ArrowUpDown className="h-4 w-4 text-slate-500" />
                </Button>
                <Dialog>
                  <DialogTrigger render={<Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm" />}>
                    <Plus className="w-4 h-4 mr-2" />
                    New Task
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px] dark:bg-slate-900 dark:border-slate-800">
                  <DialogHeader>
                    <DialogTitle className="dark:text-slate-100">Create New Task</DialogTitle>
                    <DialogDescription className="dark:text-slate-400">Add a follow-up action for a loan application.</DialogDescription>
                  </DialogHeader>
                  <Form {...taskForm}>
                    <form onSubmit={taskForm.handleSubmit(onTaskSubmit)} className="space-y-4">
                      <FormField
                        control={taskForm.control}
                        name="applicationId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Related Application</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select application" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {applications.map(app => (
                                  <SelectItem key={app.id} value={app.id}>
                                    {app.applicant_name} ({app.id})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={taskForm.control}
                        name="assignedTo"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Assign To</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select staff member" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {allUsers.filter(u => u.role !== 'applicant').map(u => (
                                  <SelectItem key={u.uid} value={u.uid}>
                                    {u.displayName || u.email} ({u.role.replace('_', ' ')})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={taskForm.control}
                        name="title"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Task Title</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="e.g. Call applicant for missing ID" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={taskForm.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Description</FormLabel>
                            <FormControl>
                              <Textarea {...field} placeholder="Details about the task..." />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={taskForm.control}
                        name="progress"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Progress (%)</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" min="0" max="100" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={taskForm.control}
                        name="dueDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Due Date</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <DialogFooter>
                        <Button type="submit" disabled={isLoading}>
                          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Create Task
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Pending</h3>
                {sortedTasks.filter(t => t.status === 'pending').length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No pending tasks.</p>
                ) : (
                  sortedTasks.filter(t => t.status === 'pending').map(task => (
                    <Card key={task.id} className="border-slate-200 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
                      <CardHeader className="pb-2">
                        <div className="flex justify-between items-start">
                          <CardTitle className="text-sm font-bold dark:text-slate-100">{task.title}</CardTitle>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setTaskToComplete(task.id)}>
                            <Circle className="h-4 w-4 text-slate-400" />
                          </Button>
                        </div>
                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          Progress: {task.progress}%
                          <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-1">
                            <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${task.progress}%` }} />
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pb-2">
                        <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{task.description}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            <span>Due: {format(new Date(task.dueDate), 'PP')}</span>
                          </div>
                          {task.assignedTo && (
                            <div className="flex items-center gap-1">
                              <UserIcon className="w-3 h-3" />
                              <span>Assigned: {allUsers.find(u => u.uid === task.assignedTo)?.displayName || 'Unknown'}</span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                      <CardFooter className="pt-0 flex justify-between items-center">
                        <Button 
                          variant="link" 
                          className="text-[10px] p-0 h-auto text-blue-600 dark:text-blue-400 flex items-center gap-1"
                          onClick={() => {
                            const app = applications.find(a => a.id === task.applicationId);
                            if (app) {
                              setSelectedApplication(app);
                              setIsReviewModalOpen(true);
                            }
                          }}
                        >
                          <ExternalLink className="w-3 h-3" />
                          App: {task.applicationId.substring(0, 8)}...
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => handleDeleteTask(task.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </CardFooter>
                    </Card>
                  ))
                )}
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Completed</h3>
                {sortedTasks.filter(t => t.status === 'completed').length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No completed tasks.</p>
                ) : (
                  sortedTasks.filter(t => t.status === 'completed').map(task => (
                    <Card key={task.id} className="border-slate-200 dark:border-slate-800 dark:bg-slate-900 shadow-sm opacity-75">
                      <CardHeader className="pb-2">
                        <div className="flex justify-between items-start">
                          <CardTitle className="text-sm font-bold dark:text-slate-100 line-through text-slate-500">{task.title}</CardTitle>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleToggleTask(task.id, 'pending')}>
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          </Button>
                        </div>
                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          Progress: {task.progress}%
                          <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-1">
                            <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${task.progress}%` }} />
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pb-2">
                        <p className="text-xs text-slate-500 dark:text-slate-500 line-clamp-2">{task.description}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
                          {task.assignedTo && (
                            <div className="flex items-center gap-1">
                              <UserIcon className="w-3 h-3" />
                              <span>Assigned: {allUsers.find(u => u.uid === task.assignedTo)?.displayName || 'Unknown'}</span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                      <CardFooter className="pt-0 flex justify-between items-center">
                        <Button 
                          variant="link" 
                          className="text-[10px] p-0 h-auto text-slate-500 dark:text-slate-400 flex items-center gap-1"
                          onClick={() => {
                            const app = applications.find(a => a.id === task.applicationId);
                            if (app) {
                              setSelectedApplication(app);
                              setIsReviewModalOpen(true);
                            }
                          }}
                        >
                          <ExternalLink className="w-3 h-3" />
                          App: {task.applicationId.substring(0, 8)}...
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => handleDeleteTask(task.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </CardFooter>
                    </Card>
                  ))
                )}
              </div>
            </div>
            
            <Dialog open={!!taskToComplete} onOpenChange={(open) => !open && setTaskToComplete(null)}>
              <DialogContent className="sm:max-w-[425px] dark:bg-slate-900 dark:border-slate-800">
                <DialogHeader>
                  <DialogTitle className="dark:text-slate-100">Confirm Task Completion</DialogTitle>
                  <DialogDescription className="dark:text-slate-400">
                    Are you sure you want to mark this task as completed?
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="mt-4">
                  <Button variant="outline" onClick={() => setTaskToComplete(null)}>Cancel</Button>
                  <Button onClick={() => {
                    if (taskToComplete) {
                      handleToggleTask(taskToComplete, 'completed');
                      setTaskToComplete(null);
                    }
                  }}>Confirm</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {activeTab === "profile" && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">My Profile</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Manage your personal information and account settings.</p>
            </div>

            <Card className="border-slate-200 dark:border-slate-800 dark:bg-slate-900">
              <CardHeader>
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16 border-2 border-blue-100 dark:border-blue-900">
                    <AvatarImage src={user.photoURL || ''} />
                    <AvatarFallback className="text-xl bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                      {user.displayName?.charAt(0) || user.email?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle className="text-lg dark:text-slate-100">{user.displayName}</CardTitle>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
                    <Badge className="mt-2 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border-none">
                      {userRole.replace('_', ' ').toUpperCase()}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Form {...profileForm}>
                  <form onSubmit={profileForm.handleSubmit(handleProfileUpdate)} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField
                        control={profileForm.control}
                        name="displayName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Full Name</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={profileForm.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone Number</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="+256..." />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={profileForm.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Physical Address</FormLabel>
                          <FormControl>
                            <Textarea {...field} placeholder="Your current residence..." />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="pt-4">
                      <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save Changes
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>

            <Card className="border-slate-200 dark:border-slate-800 dark:bg-slate-900 bg-slate-50/50 dark:bg-slate-950/50">
              <CardHeader>
                <CardTitle className="text-sm font-semibold dark:text-slate-100">Account Security</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                  Your account is secured via Google Authentication. To change your password or security settings, please visit your Google Account.
                </p>
                <Button variant="outline" className="text-xs" onClick={() => window.open('https://myaccount.google.com/security', '_blank')}>
                  Manage Google Account
                  <ExternalLink className="ml-2 h-3 w-3" />
                </Button>
              </CardContent>
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
