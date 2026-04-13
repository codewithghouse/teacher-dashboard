import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import TeacherLayout from "./components/TeacherLayout";
import Dashboard from "./pages/Dashboard";
import MyClasses from "./pages/MyClasses";
import ClassDetail from "./pages/ClassDetail";
import Attendance from "./pages/Attendance";
import Assignments from "./pages/Assignments";
import TestsExams from "./pages/TestsExams";
import Students from "./pages/Students";
import Gradebook from "./pages/Gradebook";
import ConceptMastery from "./pages/ConceptMastery";
import RisksAlerts from "./pages/RisksAlerts";
import ParentNotes from "./pages/ParentNotes";
import PrincipalNotes from "./pages/PrincipalNotes";
import Reports from "./pages/Reports";
import SettingsPage from "./pages/SettingsPage";
import LessonPlanGenerator from "./pages/LessonPlanGenerator";
import SummarizeLesson from "./pages/SummarizeLesson";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { GraduationCap, Loader2 } from "lucide-react";

const queryClient = new QueryClient();

const AppRoutes = () => {
  const { user, loading } = useAuth();

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
    return <Login />;
  }

  return (
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
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
