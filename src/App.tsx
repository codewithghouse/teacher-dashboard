import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OfflineBanner } from "./components/OfflineBanner";
import { GraduationCap, Loader2 } from "lucide-react";
import TeacherLayout from "./components/TeacherLayout";

// Reload once on chunk-load failure (stale deployed HTML referencing a
// hashed chunk that no longer exists). Prevents white-screens after deploys.
const lazyWithRetry = <T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) =>
  lazy(async () => {
    const RELOAD_KEY = "teacher-dash:chunk-reload";
    try {
      return await factory();
    } catch (err: any) {
      const isChunkError =
        err?.name === "ChunkLoadError" ||
        /Loading chunk [\d]+ failed/.test(err?.message ?? "") ||
        /Failed to fetch dynamically imported module/.test(err?.message ?? "");
      if (isChunkError && !sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, "1");
        window.location.reload();
        return { default: (() => null) as unknown as T };
      }
      throw err;
    }
  });

// ── Lazy-loaded pages (code splitting) ────────────────────────────────────────
const Dashboard          = lazyWithRetry(() => import("./pages/Dashboard"));
const MyClasses          = lazyWithRetry(() => import("./pages/MyClasses"));
const ClassDetail        = lazyWithRetry(() => import("./pages/ClassDetail"));
const Attendance         = lazyWithRetry(() => import("./pages/Attendance"));
const Assignments        = lazyWithRetry(() => import("./pages/Assignments"));
const TestsExams         = lazyWithRetry(() => import("./pages/TestsExams"));
const Students           = lazyWithRetry(() => import("./pages/Students"));
const Gradebook          = lazyWithRetry(() => import("./pages/Gradebook"));
const ConceptMastery     = lazyWithRetry(() => import("./pages/ConceptMastery"));
const RisksAlerts        = lazyWithRetry(() => import("./pages/RisksAlerts"));
const ParentNotes        = lazyWithRetry(() => import("./pages/ParentNotes"));
const PrincipalNotes     = lazyWithRetry(() => import("./pages/PrincipalNotes"));
const Reports            = lazyWithRetry(() => import("./pages/Reports"));
const SettingsPage       = lazyWithRetry(() => import("./pages/SettingsPage"));
const LessonPlanGenerator = lazyWithRetry(() => import("./pages/LessonPlanGenerator"));
const SummarizeLesson    = lazyWithRetry(() => import("./pages/SummarizeLesson"));
const Syllabus           = lazyWithRetry(() => import("./pages/Syllabus"));
const NotFound           = lazyWithRetry(() => import("./pages/NotFound"));
const Login              = lazyWithRetry(() => import("./pages/Login"));

const REDIRECT_KEY = "teacher-dash:post-login-redirect";

// ── Page loader ───────────────────────────────────────────────────────────────
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <Loader2 className="w-8 h-8 animate-spin text-[#1e3272]" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const AppRoutes = () => {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Persist the intended destination while the user is logged out so that
  // after Google sign-in they land on the page they originally requested.
  useEffect(() => {
    if (!loading && !user) {
      const target = location.pathname + location.search + location.hash;
      if (target && target !== "/") {
        sessionStorage.setItem(REDIRECT_KEY, target);
      }
    }
    if (user) {
      const target = sessionStorage.getItem(REDIRECT_KEY);
      if (target && location.pathname === "/") {
        sessionStorage.removeItem(REDIRECT_KEY);
        window.history.replaceState(null, "", target);
      }
    }
  }, [loading, user, location]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 rounded-3xl bg-[#1e3272] flex items-center justify-center text-white animate-bounce shadow-xl">
          <GraduationCap className="w-8 h-8" />
        </div>
        <div className="flex flex-col items-center gap-1">
          <Loader2 className="w-6 h-6 animate-spin text-[#1e3272]" />
          <p className="text-xs font-black text-[#1e294b] uppercase tracking-widest mt-2">Checking Access</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Login />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<TeacherLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/my-classes" element={<MyClasses />} />
          <Route path="/my-classes/:classId" element={<ClassDetail />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/assignments" element={<Assignments />} />
          <Route path="/tests" element={<TestsExams />} />
          <Route path="/students" element={<Students />} />
          <Route path="/gradebook" element={<Gradebook />} />
          <Route path="/concept-mastery" element={<ConceptMastery />} />
          <Route path="/risks-alerts" element={<RisksAlerts />} />
          <Route path="/parent-notes" element={<ParentNotes />} />
          <Route path="/principal-notes" element={<PrincipalNotes />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/lesson-planner" element={<LessonPlanGenerator />} />
          <Route path="/summarize-lesson" element={<SummarizeLesson />} />
          <Route path="/syllabus" element={<Syllabus />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ErrorBoundary>
            <OfflineBanner />
            <AppRoutes />
          </ErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;