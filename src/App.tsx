import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import Reports from "./pages/Reports";
import SettingsPage from "./pages/SettingsPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<TeacherLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/my-classes" element={<MyClasses />} />
            <Route path="/my-classes/class-detail" element={<ClassDetail />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/assignments" element={<Assignments />} />
            <Route path="/tests" element={<TestsExams />} />
            <Route path="/students" element={<Students />} />
            <Route path="/gradebook" element={<Gradebook />} />
            <Route path="/concept-mastery" element={<ConceptMastery />} />
            <Route path="/risks-alerts" element={<RisksAlerts />} />
            <Route path="/parent-notes" element={<ParentNotes />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
