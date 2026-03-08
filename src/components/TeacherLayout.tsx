import { Outlet } from "react-router-dom";
import TeacherSidebar from "./TeacherSidebar";

const TeacherLayout = () => {
  return (
    <div className="flex min-h-screen w-full">
      <TeacherSidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default TeacherLayout;
