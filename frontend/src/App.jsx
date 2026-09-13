import React, { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "react-hot-toast";

/* ─── Lazy-loaded pages: only downloaded when the route is visited ─── */
const Landing          = lazy(() => import("./pages/Landing"));
const AdminLogin       = lazy(() => import("./pages/AdminLogin"));
const StudentLogin     = lazy(() => import("./pages/StudentLogin"));
const AdminDashboard   = lazy(() => import("./pages/AdminDashboard"));
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const ExcelUpload      = lazy(() => import("./pages/ExcelUpload"));
const UserManagement   = lazy(() => import("./pages/UserManagement"));
const VehicleManagement= lazy(() => import("./pages/VehicleManagement"));
const RouteManagement  = lazy(() => import("./pages/RouteManagement"));
const ScheduleManagement=lazy(() => import("./pages/ScheduleManagement"));
const AIAgent          = lazy(() => import("./pages/AIAgent"));

/* Minimal inline fallback — keeps the screen stable while the chunk loads */
const PageLoader = () => (
  <div style={{
    display: "flex", alignItems: "center", justifyContent: "center",
    minHeight: "100vh", background: "var(--bg, #0f172a)"
  }}>
    <div style={{
      width: 40, height: 40, borderRadius: "50%",
      border: "3px solid #334155", borderTopColor: "#6366f1",
      animation: "spin 0.7s linear infinite"
    }} />
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/"                element={<Landing />} />
          <Route path="/admin-login"     element={<AdminLogin />} />
          <Route path="/student-login"   element={<StudentLogin />} />
          <Route path="/admin-dashboard" element={<AdminDashboard />} />
          <Route path="/student-dashboard" element={<StudentDashboard />} />
          <Route path="/users"           element={<UserManagement />} />
          <Route path="/user-management" element={<UserManagement />} />
          <Route path="/vehicles"        element={<VehicleManagement />} />
          <Route path="/routes"          element={<RouteManagement />} />
          <Route path="/schedule"        element={<ScheduleManagement />} />
          <Route path="/excel-upload"    element={<ExcelUpload />} />
          <Route path="/ai-agent"        element={<AIAgent />} />
        </Routes>
      </Suspense>

      <Toaster
        position="top-center"
        reverseOrder={false}
        toastOptions={{
          duration: 2500,
          style: { borderRadius: "10px", fontSize: "14px" }
        }}
      />
    </BrowserRouter>
  );
}

export default App;