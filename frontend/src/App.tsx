import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import BulkJobPage from "./pages/BulkJobPage";
import JobStatusPage from "./pages/JobStatusPage";
import SingleImagePage from "./pages/SingleImagePage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<SingleImagePage />} />
          <Route path="bulk" element={<BulkJobPage />} />
          <Route path="jobs/:jobId" element={<JobStatusPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
